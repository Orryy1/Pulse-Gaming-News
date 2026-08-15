#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { google } = require("googleapis");
const {
  buildScheduledReleaseMonitorRun,
  canonicalSha256,
} = require("../lib/runtime/scheduled-release-monitor");

function text(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function required(args, key) {
  const value = String(args[key] || "").trim();
  if (!value) throw new Error(`--${key} is required`);
  return path.resolve(value);
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temp, file);
}

function ensureExternalStateRoot(stateRoot, checkoutRoot) {
  const source = fs.realpathSync(checkoutRoot);
  fs.mkdirSync(stateRoot, { recursive: true });
  const target = fs.realpathSync(stateRoot);
  const relative = path.relative(source, target);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("release_monitor_state_root_inside_checkout");
  }
  if (fs.lstatSync(target).isSymbolicLink()) {
    throw new Error("release_monitor_state_root_symbolic_link");
  }
  return target;
}

function acquireLock(stateRoot, now) {
  const file = path.join(stateRoot, "release-monitor.lock.json");
  const token = crypto.randomUUID();
  const body = {
    schema: "pulse-release-monitor-lock-v1",
    token,
    pid: process.pid,
    acquired_at: now.toISOString(),
  };
  const attempt = () => {
    const handle = fs.openSync(file, "wx");
    try {
      fs.writeFileSync(handle, `${JSON.stringify(body, null, 2)}\n`);
    } finally {
      fs.closeSync(handle);
    }
  };
  try {
    attempt();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = readJson(file, {});
    const acquired = Date.parse(existing.acquired_at || "");
    if (!Number.isFinite(acquired) || now.getTime() - acquired <= 15 * 60 * 1000) {
      const busy = new Error("release_monitor_already_running");
      busy.code = "BUSY";
      throw busy;
    }
    fs.unlinkSync(file);
    attempt();
  }
  return {
    file,
    token,
    release() {
      const existing = readJson(file, {});
      if (existing.token === token) fs.unlinkSync(file);
    },
  };
}

function loadEnvironment(authRoot) {
  const envFile = path.join(authRoot, ".env");
  if (fs.existsSync(envFile)) {
    require("dotenv").config({ path: envFile, override: false });
  }
  process.env.PULSE_YOUTUBE_AUTH_ROOT = authRoot;
}

async function youtubeClient(authRoot) {
  loadEnvironment(authRoot);
  const uploadModule = require(path.join(authRoot, "upload_youtube.js"));
  const auth = await uploadModule.getAuthClient();
  return google.youtube({ version: "v3", auth });
}

async function fetchRemoteVideos(youtube, ids) {
  const response = await youtube.videos.list({
    part: [
      "snippet",
      "status",
      "contentDetails",
      "processingDetails",
      "fileDetails",
      "statistics",
    ],
    id: ids,
  }, { retry: false, timeout: 30000 });
  return new Map((response.data.items || []).map((video) => [video.id, video]));
}

function expectedVideoMap(manifest) {
  const entries = manifest.active_videos || manifest.videos || [];
  return new Map(entries.map((entry) => [entry.youtube.video_id, {
    bytes: Number(entry.local.bytes || 0),
    sha256: entry.local.sha256,
    path: entry.local.path || entry.local.video,
  }]));
}

function verifyReviewedMasters(expectedMap, priorState) {
  const prior = priorState.local_verification?.files || {};
  const files = {};
  for (const [videoId, expected] of expectedMap.entries()) {
    if (!expected.path || !fs.existsSync(expected.path)) {
      throw new Error(`reviewed_master_missing:${videoId}`);
    }
    const stat = fs.statSync(expected.path);
    if (!stat.isFile() || stat.size !== expected.bytes) {
      throw new Error(`reviewed_master_size_drift:${videoId}`);
    }
    const previous = prior[videoId];
    let actualSha = previous?.sha256 || null;
    if (
      !previous
      || previous.path !== expected.path
      || previous.bytes !== stat.size
      || previous.mtime_ms !== stat.mtimeMs
      || previous.sha256 !== expected.sha256
    ) {
      actualSha = sha256File(expected.path);
    }
    if (actualSha !== expected.sha256) {
      throw new Error(`reviewed_master_hash_drift:${videoId}`);
    }
    files[videoId] = {
      path: expected.path,
      bytes: stat.size,
      mtime_ms: stat.mtimeMs,
      sha256: actualSha,
    };
  }
  return { verified_at: new Date().toISOString(), files };
}

function eventMessage(event) {
  if (event.kind === "MONITOR_ARMED") {
    return [
      "?? Pulse release monitor armed",
      `${event.video_count} scheduled Shorts are under read-only reconciliation.`,
      `Next release: ${event.next_title} ? ${event.next_local_time}`,
      "Incidents will engage the local external-mutation kill switch.",
    ].join("\n");
  }
  if (event.kind === "INCIDENT") {
    return [
      `🚨 Pulse release incident — ${event.title}`,
      `Code: ${event.code}`,
      `Severity: ${event.severity}`,
      `Phase: ${event.phase}`,
      `Scheduled: ${event.scheduled_for}`,
      "Future external mutations have been suspended locally.",
    ].join("\n");
  }
  if (event.kind === "RELEASE_PUBLIC") {
    return [
      `✅ Pulse Short is live — ${event.title}`,
      `https://youtube.com/watch?v=${event.video_id}`,
      `Views: ${event.statistics.views} · Likes: ${event.statistics.likes} · Comments: ${event.statistics.comments}`,
    ].join("\n");
  }
  if (event.kind === "ANALYTICS_MILESTONE") {
    return [
      `📊 ${event.milestone} Pulse snapshot — ${event.title}`,
      `Views: ${event.statistics.views} · Likes: ${event.statistics.likes} · Comments: ${event.statistics.comments}`,
      `https://youtube.com/watch?v=${event.video_id}`,
    ].join("\n");
  }
  const counts = event.counts || {};
  return [
    `🧭 Pulse daily status — ${event.digest_date}`,
    `GREEN ${counts.GREEN || 0} · AMBER ${counts.AMBER || 0} · RED ${counts.RED || 0}`,
    `Pre-release ${counts.PRE_RELEASE || 0} · Public ${counts.PUBLIC || 0} · Transition ${counts.TRANSITION_GRACE || 0}`,
  ].join("\n");
}

function queueEvents(stateRoot, events) {
  const outbox = path.join(stateRoot, "discord-outbox");
  fs.mkdirSync(outbox, { recursive: true });
  const queued = [];
  for (const event of events) {
    const file = path.join(outbox, `${event.event_id}.json`);
    if (!fs.existsSync(file)) {
      atomicWriteJson(file, {
        schema: "pulse-discord-outbox-event-v1",
        event,
        status: "PENDING",
        attempts: 0,
        queued_at: new Date().toISOString(),
      });
    }
    queued.push(file);
  }
  return queued;
}

async function postDiscord(webhook, content) {
  const url = new URL(webhook);
  url.searchParams.set("wait", "true");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "Pulse Gaming Ops",
      content: content.slice(0, 1900),
      allowed_mentions: { parse: [] },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`discord_http_${response.status}`);
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

async function deliverDiscordOutbox(stateRoot) {
  const outbox = path.join(stateRoot, "discord-outbox");
  fs.mkdirSync(outbox, { recursive: true });
  const webhook = text(
    process.env.PULSE_GAMING_DISCORD_WEBHOOK
      || process.env.DISCORD_WEBHOOK_URL
      || process.env.DISCORD_WEBHOOK,
  );
  const results = [];
  for (const file of fs.readdirSync(outbox).filter((name) => name.endsWith(".json")).sort()) {
    const fullPath = path.join(outbox, file);
    const item = readJson(fullPath, {});
    if (item.status === "SENT") continue;
    if (!webhook) {
      atomicWriteJson(fullPath, {
        ...item,
        status: "DEFERRED_NO_WEBHOOK",
        last_attempt_at: new Date().toISOString(),
      });
      results.push({ event_id: item.event?.event_id, status: "DEFERRED_NO_WEBHOOK" });
      continue;
    }
    try {
      const response = await postDiscord(webhook, eventMessage(item.event));
      atomicWriteJson(fullPath, {
        ...item,
        status: "SENT",
        attempts: Number(item.attempts || 0) + 1,
        sent_at: new Date().toISOString(),
        discord_message_id: response.id || null,
        last_error: null,
      });
      results.push({ event_id: item.event.event_id, status: "SENT", message_id: response.id || null });
    } catch (error) {
      atomicWriteJson(fullPath, {
        ...item,
        status: "RETRY",
        attempts: Number(item.attempts || 0) + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: String(error.message || error).slice(0, 300),
      });
      results.push({ event_id: item.event?.event_id, status: "RETRY" });
    }
  }
  return results;
}

function engageKillSwitch(stateRoot, report) {
  const controlRoot = path.join(stateRoot, "control");
  const historyRoot = path.join(controlRoot, "history");
  fs.mkdirSync(historyRoot, { recursive: true });
  const currentPath = path.join(controlRoot, "external-mutations.json");
  const prior = readJson(currentPath, null);
  const incident = {
    schema: "pulse-external-mutation-switch-event-v1",
    event_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    from_state: prior?.state || null,
    to_state: "ENGAGED",
    actor_id: "SCHEDULED_RELEASE_MONITOR",
    reason: "YOUTUBE_RELEASE_RECONCILIATION_INCIDENT",
    report_sha256: canonicalSha256(report),
    critical_incidents: report.critical_incidents,
    high_incidents: report.high_incidents,
  };
  const historyPath = path.join(historyRoot, `${incident.created_at.replace(/[:.]/g, "-")}-${incident.event_id}.json`);
  atomicWriteJson(historyPath, incident);
  atomicWriteJson(currentPath, {
    schema: "pulse-external-mutation-switch-v1",
    state: "ENGAGED",
    version: Number(prior?.version || 0) + 1,
    engaged_at: prior?.engaged_at || incident.created_at,
    updated_at: incident.created_at,
    actor_id: incident.actor_id,
    reason: incident.reason,
    latest_event: historyPath,
    latest_event_sha256: sha256File(historyPath),
  });
  return { current: currentPath, history: historyPath };
}

function addArmedEvent(result, plan, priorState, now) {
  if (Number(priorState.run_count || 0) > 0) return;
  const next = [...plan.videos]
    .sort((left, right) => Date.parse(left.publishAt) - Date.parse(right.publishAt))
    .find((video) => Date.parse(video.publishAt) > now.getTime()) || plan.videos[0];
  const event = {
    kind: "MONITOR_ARMED",
    severity: "INFO",
    event_id: canonicalSha256({
      kind: "MONITOR_ARMED",
      plan_sha256: canonicalSha256(plan),
    }),
    video_count: plan.videos.length,
    next_title: next.title,
    next_local_time: next.localTime || next.publishAt,
    observed_at: now.toISOString(),
  };
  result.events.push(event);
  result.report.new_events.push(event);
  result.nextState.events[event.event_id] = {
    kind: event.kind,
    queued_at: now.toISOString(),
    video_id: null,
    code: null,
    milestone: null,
    digest_date: null,
  };
}

function runReceiptFile(stateRoot, now, report) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const hash = canonicalSha256(report).slice(0, 16);
  return path.join(stateRoot, "runs", `${stamp}-${hash}.json`);
}

async function main() {
  const args = parseArgs(process.argv);
  const planPath = required(args, "plan");
  const manifestPath = required(args, "manifest");
  const authRoot = required(args, "auth-root");
  const checkoutRoot = path.resolve(__dirname, "..");
  const stateRoot = ensureExternalStateRoot(required(args, "state-root"), checkoutRoot);
  const now = new Date();
  const lock = acquireLock(stateRoot, now);
  try {
    const plan = readJson(planPath);
    const manifest = readJson(manifestPath);
    if (!plan || !manifest) throw new Error("monitor_input_missing");
    if (!String(manifest.status || "").startsWith("GREEN_")) {
      throw new Error("reviewed_manifest_not_green");
    }
    const planFileSha = sha256File(planPath);
    const manifestFileSha = sha256File(manifestPath);
    const statePath = path.join(stateRoot, "state.json");
    const priorState = readJson(statePath, {});
    if (priorState.plan_file_sha256 && priorState.plan_file_sha256 !== planFileSha) {
      throw new Error("schedule_plan_changed_without_state_transition");
    }
    if (
      priorState.manifest_file_sha256
      && priorState.manifest_file_sha256 !== manifestFileSha
    ) {
      throw new Error("reviewed_manifest_changed_without_state_transition");
    }
    const expected = expectedVideoMap(manifest);
    const planIds = plan.videos.map((video) => video.id);
    if (new Set(planIds).size !== planIds.length) {
      throw new Error("schedule_plan_duplicate_video_id");
    }
    for (const id of planIds) {
      if (!expected.has(id)) throw new Error(`reviewed_manifest_video_missing:${id}`);
    }
    if (expected.size !== planIds.length) {
      throw new Error("reviewed_manifest_cardinality_mismatch");
    }
    const localVerification = verifyReviewedMasters(expected, priorState);
    const youtube = await youtubeClient(authRoot);
    const remote = await fetchRemoteVideos(youtube, planIds);
    const result = buildScheduledReleaseMonitorRun({
      plan,
      expectedByVideoId: expected,
      remoteByVideoId: remote,
      priorState,
      now,
    });
    addArmedEvent(result, plan, priorState, now);
    result.nextState.plan_file_sha256 = planFileSha;
    result.nextState.manifest_file_sha256 = manifestFileSha;
    result.nextState.local_verification = localVerification;
    const queuedFiles = queueEvents(stateRoot, result.events);
    let killSwitch = null;
    if (result.report.engage_kill_switch) {
      killSwitch = engageKillSwitch(stateRoot, result.report);
    }
    result.nextState.pending_run_id = crypto.randomUUID();
    result.nextState.pending_run_started_at = now.toISOString();
    atomicWriteJson(statePath, result.nextState);

    const discord = await deliverDiscordOutbox(stateRoot);
    const deliveryFailures = discord.filter((row) => row.status === "RETRY").length;
    const receipt = {
      schema: "pulse-scheduled-release-monitor-run-v1",
      generated_at: now.toISOString(),
      verdict: result.report.verdict,
      report: result.report,
      inputs: {
        plan: planPath,
        plan_sha256: planFileSha,
        manifest: manifestPath,
        manifest_sha256: manifestFileSha,
      },
      local_verification: localVerification,
      outbox: {
        queued_files: queuedFiles,
        delivery: discord,
        retry_count: deliveryFailures,
      },
      kill_switch: killSwitch,
    };
    const receiptPath = runReceiptFile(stateRoot, now, receipt);
    atomicWriteJson(receiptPath, receipt);
    const finalState = {
      ...result.nextState,
      pending_run_id: null,
      pending_run_started_at: null,
      last_run_receipt: receiptPath,
      last_run_receipt_sha256: sha256File(receiptPath),
      last_verdict: result.report.verdict,
    };
    atomicWriteJson(statePath, finalState);
    const status = {
      schema: "pulse-scheduled-release-monitor-status-v1",
      generated_at: new Date().toISOString(),
      verdict: result.report.verdict,
      summary: result.report.summary,
      kill_switch_engaged: finalState.kill_switch_engaged,
      discord_retry_count: deliveryFailures,
      receipt: receiptPath,
      receipt_sha256: finalState.last_run_receipt_sha256,
      next_release: plan.videos
        .filter((video) => Date.parse(video.publishAt) > now.getTime())
        .sort((left, right) => Date.parse(left.publishAt) - Date.parse(right.publishAt))[0] || null,
    };
    atomicWriteJson(path.join(stateRoot, "current-status.json"), status);
    console.log(JSON.stringify(status, null, 2));
    if (result.report.verdict !== "GREEN") process.exitCode = 2;
  } finally {
    lock.release();
  }
}

main().catch((error) => {
  if (error.code === "BUSY") {
    console.log(JSON.stringify({ verdict: "BUSY", blocker: error.message }));
    process.exit(0);
  }
  console.error(JSON.stringify({
    verdict: "RED",
    error: String(error.message || error).slice(0, 1000),
  }));
  process.exit(2);
});
