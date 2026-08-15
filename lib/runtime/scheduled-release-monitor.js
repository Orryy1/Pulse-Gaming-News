"use strict";

const crypto = require("node:crypto");

const SCHEMA_VERSION = "pulse-scheduled-release-monitor-v1";
const RELEASE_GRACE_MS = 10 * 60 * 1000;
const EARLY_TOLERANCE_MS = 30 * 1000;
const MILESTONES = Object.freeze([
  { id: "release", offsetMs: 0 },
  { id: "1h", offsetMs: 60 * 60 * 1000 },
  { id: "24h", offsetMs: 24 * 60 * 60 * 1000 },
  { id: "72h", offsetMs: 72 * 60 * 60 * 1000 },
]);

function text(value) {
  return String(value ?? "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function instant(value, code) {
  const raw = text(value);
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return parsed;
}

function sortedTags(value) {
  return [...new Set(Array.isArray(value) ? value.map(text).filter(Boolean) : [])]
    .sort((left, right) => left.localeCompare(right));
}

function sameInstant(left, right, toleranceMs = 1000) {
  if (!left || !right) return false;
  return Math.abs(instant(left, "invalid_left_time").getTime()
    - instant(right, "invalid_right_time").getTime()) <= toleranceMs;
}

function addIncident(incidents, code, severity, detail = {}) {
  incidents.push({ code, severity, detail });
}

function metadataChecks(spec, remote) {
  return {
    title: text(remote?.snippet?.title) === text(spec.title),
    description: text(remote?.snippet?.description) === text(spec.description),
    tags:
      JSON.stringify(sortedTags(remote?.snippet?.tags))
      === JSON.stringify(sortedTags(spec.tags)),
    category: text(remote?.snippet?.categoryId) === "20",
    language: text(remote?.snippet?.defaultLanguage) === "en-GB",
    audio_language:
      text(remote?.snippet?.defaultAudioLanguage) === "en-GB",
  };
}

function mediaChecks(expected, remote) {
  return {
    upload_processed: remote?.status?.uploadStatus === "processed",
    processing_succeeded:
      remote?.processingDetails?.processingStatus === "succeeded",
    no_failure_reason: !text(remote?.status?.failureReason),
    no_rejection_reason: !text(remote?.status?.rejectionReason),
    file_size:
      Number(expected?.bytes || 0) > 0
      && Number(remote?.fileDetails?.fileSize || 0) === Number(expected.bytes),
  };
}

function classifyReleaseState({ spec, expected, remote, now }) {
  const incidents = [];
  const checks = {
    remote_present: Boolean(remote),
    metadata: metadataChecks(spec, remote),
    media: mediaChecks(expected, remote),
  };
  if (!remote) {
    addIncident(incidents, "youtube_object_missing", "CRITICAL");
    return { phase: "MISSING", verdict: "RED", incidents, checks };
  }

  for (const [name, passed] of Object.entries(checks.metadata)) {
    if (!passed) addIncident(incidents, `metadata_${name}_drift`, "HIGH");
  }
  for (const [name, passed] of Object.entries(checks.media)) {
    if (!passed) addIncident(incidents, `media_${name}_failed`, "CRITICAL");
  }
  if (remote.contentDetails?.regionRestriction) {
    addIncident(incidents, "region_restriction_detected", "HIGH", {
      regionRestriction: remote.contentDetails.regionRestriction,
    });
  }
  const publishAt = instant(spec.publishAt, "schedule_publish_at_invalid");
  const nowMs = now instanceof Date ? now.getTime() : instant(now, "monitor_now_invalid").getTime();
  const deltaMs = nowMs - publishAt.getTime();
  const privacy = text(remote.status?.privacyStatus);
  const remotePublishAt = remote.status?.publishAt || null;
  let phase;

  if (deltaMs < -EARLY_TOLERANCE_MS) {
    phase = "PRE_RELEASE";
    if (privacy !== "private") {
      addIncident(incidents, "released_before_scheduled_window", "CRITICAL", {
        privacy,
        expected: publishAt.toISOString(),
      });
    }
    if (!sameInstant(remotePublishAt, publishAt.toISOString())) {
      addIncident(incidents, "scheduled_time_drift", "CRITICAL", {
        remotePublishAt,
        expected: publishAt.toISOString(),
      });
    }
  } else if (deltaMs < RELEASE_GRACE_MS) {
    phase = privacy === "public" ? "PUBLIC" : "TRANSITION_GRACE";
    if (privacy === "private" && !sameInstant(remotePublishAt, publishAt.toISOString())) {
      addIncident(incidents, "transition_schedule_drift", "CRITICAL", {
        remotePublishAt,
        expected: publishAt.toISOString(),
      });
    } else if (!["private", "public"].includes(privacy)) {
      addIncident(incidents, "transition_privacy_invalid", "CRITICAL", { privacy });
    }
  } else {
    phase = privacy === "public" ? "PUBLIC" : "MISSED_RELEASE";
    if (privacy !== "public") {
      addIncident(incidents, "not_public_after_release_grace", "CRITICAL", {
        privacy,
        expected: publishAt.toISOString(),
      });
    }
  }

  const verdict = incidents.some((incident) => incident.severity === "CRITICAL")
    ? "RED"
    : incidents.length
      ? "AMBER"
      : "GREEN";
  return {
    phase,
    verdict,
    incidents,
    checks,
    scheduled_for: publishAt.toISOString(),
    delta_ms: deltaMs,
    remote: {
      privacy,
      publish_at: remotePublishAt,
      upload_status: remote.status?.uploadStatus || null,
      processing_status: remote.processingDetails?.processingStatus || null,
      duration: remote.contentDetails?.duration || null,
      file_size: remote.fileDetails?.fileSize || null,
      caption: remote.contentDetails?.caption || null,
      statistics: {
        views: Number(remote.statistics?.viewCount || 0),
        likes: Number(remote.statistics?.likeCount || 0),
        comments: Number(remote.statistics?.commentCount || 0),
      },
    },
  };
}

function milestoneEvents({ spec, observation, previous, now }) {
  if (observation.phase !== "PUBLIC") return [];
  const publishAt = instant(spec.publishAt, "milestone_publish_at_invalid");
  const nowMs = now instanceof Date ? now.getTime() : instant(now, "milestone_now_invalid").getTime();
  const captured = previous?.milestones || {};
  return MILESTONES
    .filter((milestone) => milestone.id !== "release")
    .filter((milestone) => nowMs >= publishAt.getTime() + milestone.offsetMs)
    .filter((milestone) => !captured[milestone.id])
    .map((milestone) => ({
      kind: "ANALYTICS_MILESTONE",
      severity: "INFO",
      video_id: spec.id,
      story: spec.story,
      title: spec.title,
      milestone: milestone.id,
      scheduled_for: publishAt.toISOString(),
      observed_at: new Date(nowMs).toISOString(),
      statistics: observation.remote.statistics,
    }));
}

function eventIdentity(event) {
  return canonicalSha256({
    kind: event.kind,
    video_id: event.video_id || null,
    code: event.code || null,
    milestone: event.milestone || null,
    scheduled_for: event.scheduled_for || null,
    digest_date: event.digest_date || null,
  });
}

function londonClock(now) {
  const date = now instanceof Date ? now : instant(now, "digest_now_invalid");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    hour: Number(value.hour),
    minute: Number(value.minute),
  };
}

function dailyDigestEvent({ observations, priorState, now }) {
  const clock = londonClock(now);
  if (clock.hour < 8 || priorState?.digests?.[clock.date]) return null;
  const counts = observations.reduce((accumulator, row) => {
    accumulator[row.observation.phase] = (accumulator[row.observation.phase] || 0) + 1;
    accumulator[row.observation.verdict] = (accumulator[row.observation.verdict] || 0) + 1;
    return accumulator;
  }, {});
  return {
    kind: "DAILY_DIGEST",
    severity: counts.RED ? "HIGH" : counts.AMBER ? "MEDIUM" : "INFO",
    digest_date: clock.date,
    observed_at: (now instanceof Date ? now : new Date(now)).toISOString(),
    counts,
    videos: observations.map((row) => ({
      video_id: row.spec.id,
      title: row.spec.title,
      phase: row.observation.phase,
      verdict: row.observation.verdict,
      scheduled_for: row.observation.scheduled_for,
      statistics: row.observation.remote?.statistics || null,
    })),
  };
}

function buildScheduledReleaseMonitorRun({
  plan,
  expectedByVideoId,
  remoteByVideoId,
  priorState = {},
  now = new Date(),
}) {
  if (!plan || !Array.isArray(plan.videos) || plan.videos.length < 1) {
    throw new Error("scheduled_release_plan_invalid");
  }
  const nowDate = now instanceof Date ? now : instant(now, "monitor_now_invalid");
  const expectedMap = expectedByVideoId instanceof Map
    ? expectedByVideoId
    : new Map(Object.entries(expectedByVideoId || {}));
  const remoteMap = remoteByVideoId instanceof Map
    ? remoteByVideoId
    : new Map(Object.entries(remoteByVideoId || {}));
  const previousVideos = priorState.videos || {};
  const knownEvents = priorState.events || {};
  const observations = [];
  const proposedEvents = [];

  for (const spec of plan.videos) {
    const expected = expectedMap.get(spec.id);
    if (!expected) throw new Error(`reviewed_master_missing:${spec.id}`);
    const observation = classifyReleaseState({
      spec,
      expected,
      remote: remoteMap.get(spec.id) || null,
      now: nowDate,
    });
    const previous = previousVideos[spec.id] || {};
    observations.push({ spec, expected, observation });
    for (const incident of observation.incidents) {
      proposedEvents.push({
        kind: "INCIDENT",
        severity: incident.severity,
        code: incident.code,
        detail: incident.detail,
        video_id: spec.id,
        story: spec.story,
        title: spec.title,
        scheduled_for: observation.scheduled_for || spec.publishAt,
        observed_at: nowDate.toISOString(),
        phase: observation.phase,
      });
    }
    if (observation.phase === "PUBLIC" && previous.phase !== "PUBLIC") {
      proposedEvents.push({
        kind: "RELEASE_PUBLIC",
        severity: "INFO",
        video_id: spec.id,
        story: spec.story,
        title: spec.title,
        scheduled_for: observation.scheduled_for,
        observed_at: nowDate.toISOString(),
        statistics: observation.remote.statistics,
      });
    }
    proposedEvents.push(...milestoneEvents({
      spec,
      observation,
      previous,
      now: nowDate,
    }));
  }

  const digest = dailyDigestEvent({ observations, priorState, now: nowDate });
  if (digest) proposedEvents.push(digest);

  const events = proposedEvents
    .map((event) => ({ ...event, event_id: eventIdentity(event) }))
    .filter((event) => !knownEvents[event.event_id]);
  const nextEvents = { ...knownEvents };
  for (const event of events) {
    nextEvents[event.event_id] = {
      kind: event.kind,
      queued_at: nowDate.toISOString(),
      video_id: event.video_id || null,
      code: event.code || null,
      milestone: event.milestone || null,
      digest_date: event.digest_date || null,
    };
  }

  const nextVideos = { ...previousVideos };
  for (const row of observations) {
    const prior = previousVideos[row.spec.id] || {};
    const milestones = { ...(prior.milestones || {}) };
    for (const event of events) {
      if (event.video_id === row.spec.id && event.kind === "ANALYTICS_MILESTONE") {
        milestones[event.milestone] = event.observed_at;
      }
    }
    nextVideos[row.spec.id] = {
      phase: row.observation.phase,
      verdict: row.observation.verdict,
      last_observed_at: nowDate.toISOString(),
      public_observed_at:
        row.observation.phase === "PUBLIC"
          ? prior.public_observed_at || nowDate.toISOString()
          : prior.public_observed_at || null,
      milestones,
      statistics: row.observation.remote?.statistics || null,
      incident_codes: row.observation.incidents.map((incident) => incident.code),
    };
  }

  const digests = { ...(priorState.digests || {}) };
  for (const event of events) {
    if (event.kind === "DAILY_DIGEST") digests[event.digest_date] = event.observed_at;
  }
  const criticalIncidents = observations.flatMap((row) =>
    row.observation.incidents
      .filter((incident) => incident.severity === "CRITICAL")
      .map((incident) => ({ video_id: row.spec.id, ...incident })),
  );
  const highIncidents = observations.flatMap((row) =>
    row.observation.incidents
      .filter((incident) => incident.severity === "HIGH")
      .map((incident) => ({ video_id: row.spec.id, ...incident })),
  );
  const summary = {
    total: observations.length,
    green: observations.filter((row) => row.observation.verdict === "GREEN").length,
    amber: observations.filter((row) => row.observation.verdict === "AMBER").length,
    red: observations.filter((row) => row.observation.verdict === "RED").length,
    pre_release: observations.filter((row) => row.observation.phase === "PRE_RELEASE").length,
    transition: observations.filter((row) => row.observation.phase === "TRANSITION_GRACE").length,
    public: observations.filter((row) => row.observation.phase === "PUBLIC").length,
    missed: observations.filter((row) => row.observation.phase === "MISSED_RELEASE").length,
  };
  const verdict = criticalIncidents.length ? "RED" : highIncidents.length ? "AMBER" : "GREEN";
  const engageKillSwitch = criticalIncidents.length > 0 || highIncidents.length > 0;
  const nextState = {
    schema_version: SCHEMA_VERSION,
    updated_at: nowDate.toISOString(),
    run_count: Number(priorState.run_count || 0) + 1,
    plan_sha256: canonicalSha256(plan),
    videos: nextVideos,
    events: nextEvents,
    digests,
    kill_switch_engaged:
      priorState.kill_switch_engaged === true || engageKillSwitch,
  };
  const report = {
    schema_version: SCHEMA_VERSION,
    generated_at: nowDate.toISOString(),
    verdict,
    summary,
    critical_incidents: criticalIncidents,
    high_incidents: highIncidents,
    observations: observations.map((row) => ({
      video_id: row.spec.id,
      story: row.spec.story,
      title: row.spec.title,
      observation: row.observation,
    })),
    new_events: events,
    engage_kill_switch: engageKillSwitch,
  };
  return { report, nextState, events };
}

module.exports = {
  EARLY_TOLERANCE_MS,
  MILESTONES,
  RELEASE_GRACE_MS,
  SCHEMA_VERSION,
  buildScheduledReleaseMonitorRun,
  canonicalSha256,
  classifyReleaseState,
  dailyDigestEvent,
  eventIdentity,
  londonClock,
  metadataChecks,
  milestoneEvents,
};
