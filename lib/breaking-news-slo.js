"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const EDITORIAL_DECISION_TARGET_MINUTES = 30;
const SCHEDULER_AUTHORITY_TARGET_MINUTES = 90;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : value ? [clean(value)] : [];
}

function parseTimestamp(value, label, required = false) {
  if (!value) {
    if (required) throw new Error(`breaking-news SLO requires ${label}`);
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid ${label}: ${value}`);
  return parsed;
}

function iso(value) {
  return value ? value.toISOString() : null;
}

function roundMinutes(value) {
  return Number(value.toFixed(2));
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  return roundMinutes((end.getTime() - start.getTime()) / 60_000);
}

function rootCausesFor(rootCauses, stage, fallback) {
  const causes = asArray(rootCauses?.[stage]);
  return causes.length ? causes : [fallback];
}

function timedStage({
  name,
  startedAt,
  completedAt,
  deadlineAt,
  generatedAt,
  target,
  rootCauses,
}) {
  const completedLate = completedAt && completedAt.getTime() > deadlineAt.getTime();
  const deadlinePassed = generatedAt.getTime() > deadlineAt.getTime();
  const status = completedAt
    ? completedLate
      ? "missed"
      : "pass"
    : deadlinePassed
      ? "missed"
      : "pending";
  return {
    status,
    target,
    started_at: iso(startedAt),
    completed_at: iso(completedAt),
    deadline_at: iso(deadlineAt),
    latency_minutes: minutesBetween(startedAt, completedAt),
    elapsed_minutes: minutesBetween(startedAt, completedAt || generatedAt),
    root_causes:
      status === "missed"
        ? rootCausesFor(rootCauses, name, `${name}_deadline_missed`)
        : [],
  };
}

function endOfUtcDay(value) {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  ));
}

function buildBreakingNewsSloReport({
  storyId,
  announcementAt,
  nextFeedPollAt,
  detectedAt,
  editorialDecisionAt,
  schedulerCandidateAt,
  safeDispatchOpportunityAt,
  dispatchGatesPermit = false,
  generatedAt = new Date().toISOString(),
  rootCauses = {},
} = {}) {
  const id = clean(storyId);
  if (!id) throw new Error("breaking-news SLO requires storyId");
  const announcement = parseTimestamp(announcementAt, "announcementAt", true);
  const nextPoll = parseTimestamp(nextFeedPollAt, "nextFeedPollAt", true);
  const detected = parseTimestamp(detectedAt, "detectedAt");
  const editorial = parseTimestamp(editorialDecisionAt, "editorialDecisionAt");
  const candidate = parseTimestamp(schedulerCandidateAt, "schedulerCandidateAt");
  const dispatch = parseTimestamp(safeDispatchOpportunityAt, "safeDispatchOpportunityAt");
  const generated = parseTimestamp(generatedAt, "generatedAt", true);

  const detection = timedStage({
    name: "detection",
    startedAt: announcement,
    completedAt: detected,
    deadlineAt: nextPoll,
    generatedAt: generated,
    target: "detected_by_next_feed_poll",
    rootCauses,
  });
  const decisionStart = detected || nextPoll;
  const editorialDeadline = new Date(
    decisionStart.getTime() + EDITORIAL_DECISION_TARGET_MINUTES * 60_000,
  );
  const editorialDecision = timedStage({
    name: "editorial_decision",
    startedAt: decisionStart,
    completedAt: editorial,
    deadlineAt: editorialDeadline,
    generatedAt: generated,
    target: `within_${EDITORIAL_DECISION_TARGET_MINUTES}_minutes_of_detection`,
    rootCauses,
  });
  const schedulerDeadline = new Date(
    decisionStart.getTime() + SCHEDULER_AUTHORITY_TARGET_MINUTES * 60_000,
  );
  const schedulerAuthority = timedStage({
    name: "scheduler_authority",
    startedAt: decisionStart,
    completedAt: candidate,
    deadlineAt: schedulerDeadline,
    generatedAt: generated,
    target: `within_${SCHEDULER_AUTHORITY_TARGET_MINUTES}_minutes_of_detection`,
    rootCauses,
  });

  let dispatchStatus = "blocked_by_gate";
  if (dispatchGatesPermit) {
    if (dispatch) {
      dispatchStatus = dispatch.getTime() < endOfUtcDay(announcement).getTime()
        ? "pass"
        : "missed";
    } else {
      dispatchStatus = generated.getTime() >= endOfUtcDay(announcement).getTime()
        ? "missed"
        : "pending";
    }
  }
  const dispatchOpportunity = {
    status: dispatchStatus,
    target: "same_utc_day_when_rights_platform_and_human_gates_permit",
    gates_permit: dispatchGatesPermit === true,
    started_at: iso(announcement),
    completed_at: iso(dispatch),
    deadline_at: iso(endOfUtcDay(announcement)),
    latency_minutes: minutesBetween(announcement, dispatch),
    elapsed_minutes: minutesBetween(announcement, dispatch || generated),
    root_causes:
      dispatchStatus === "missed"
        ? rootCausesFor(rootCauses, "dispatch_opportunity", "same_day_dispatch_opportunity_missed")
        : dispatchStatus === "blocked_by_gate"
          ? rootCausesFor(rootCauses, "dispatch_opportunity", "required_publish_gates_not_green")
          : [],
  };

  const stages = {
    detection,
    editorial_decision: editorialDecision,
    scheduler_authority: schedulerAuthority,
    dispatch_opportunity: dispatchOpportunity,
  };
  const missedStages = Object.entries(stages)
    .filter(([, stage]) => stage.status === "missed")
    .map(([name]) => name);
  const nonGreenStages = Object.entries(stages)
    .filter(([, stage]) => stage.status !== "pass")
    .map(([name]) => name);
  const verdict = missedStages.length ? "RED" : nonGreenStages.length ? "AMBER" : "GREEN";
  const incident = missedStages.length
    ? {
        schema_version: 1,
        incident_type: "breaking_news_slo_miss",
        story_id: id,
        detected_at: iso(detected),
        generated_at: iso(generated),
        verdict: "RED",
        missed_stages: missedStages,
        stage_latency: Object.fromEntries(
          Object.entries(stages).map(([name, stage]) => [name, {
            status: stage.status,
            latency_minutes: stage.latency_minutes,
            elapsed_minutes: stage.elapsed_minutes,
            deadline_at: stage.deadline_at,
          }]),
        ),
        root_cause_by_stage: Object.fromEntries(
          missedStages.map((name) => [name, stages[name].root_causes]),
        ),
        safety: {
          no_gate_bypass_authorised: true,
          no_publish_triggered: true,
          no_db_mutation: true,
        },
      }
    : null;

  return {
    schema_version: 1,
    story_id: id,
    generated_at: iso(generated),
    verdict,
    slo_met: verdict === "GREEN",
    targets: {
      detection: "next_feed_poll",
      editorial_decision_minutes: EDITORIAL_DECISION_TARGET_MINUTES,
      scheduler_authority_minutes: SCHEDULER_AUTHORITY_TARGET_MINUTES,
      dispatch_opportunity: "same_day_when_gates_permit",
    },
    stages,
    missed_stages: missedStages,
    incident,
    safety: {
      operational_target_not_publish_permission: true,
      strict_green_rights_policy_human_and_platform_gates_unchanged: true,
    },
  };
}

function renderBreakingNewsSloMarkdown(report = {}) {
  const lines = [
    "# Breaking News SLO",
    "",
    `Story: ${report.story_id || "unknown"}`,
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "unknown"}`,
    "",
    "## Stages",
  ];
  for (const [name, stage] of Object.entries(report.stages || {})) {
    const latency = stage.latency_minutes == null ? "pending" : `${stage.latency_minutes}m`;
    lines.push(`- ${name}: ${stage.status} (${latency})`);
    for (const cause of asArray(stage.root_causes)) lines.push(`  - ${cause}`);
  }
  lines.push(
    "",
    "This is an operating SLO. It does not bypass rights, policy, human review, platform readiness or control-tower authority.",
  );
  return `${lines.join("\n")}\n`;
}

async function writeBreakingNewsSloReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeBreakingNewsSloReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "breaking_news_slo.json");
  const markdownPath = path.join(outDir, "breaking_news_slo.md");
  const incidentPath = report.incident
    ? path.join(outDir, "breaking_news_slo_incident.json")
    : null;
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderBreakingNewsSloMarkdown(report), "utf8");
  if (incidentPath) await fs.writeJson(incidentPath, report.incident, { spaces: 2 });
  return { outputDir: outDir, reportPath, markdownPath, incidentPath };
}

module.exports = {
  EDITORIAL_DECISION_TARGET_MINUTES,
  SCHEDULER_AUTHORITY_TARGET_MINUTES,
  buildBreakingNewsSloReport,
  renderBreakingNewsSloMarkdown,
  writeBreakingNewsSloReport,
};
