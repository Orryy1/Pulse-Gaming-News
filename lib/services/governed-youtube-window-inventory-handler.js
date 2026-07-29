"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  readGovernedYoutubeWindowInventoryReport,
  renderGovernedYoutubeWindowInventoryMarkdown,
} = require("./governed-youtube-window-inventory-monitor");

const REPLENISHMENT_JOBS = Object.freeze([
  Object.freeze({ kind: "hunt", priority: 5 }),
  Object.freeze({
    kind: "governed_editorial_evidence_backfill",
    priority: 7,
  }),
  Object.freeze({
    kind: "reconcile_editorial_inventory",
    priority: 8,
  }),
  Object.freeze({
    kind: "governed_multi_lane_plan",
    priority: 10,
  }),
  Object.freeze({
    kind: "evergreen_candidate_builder",
    priority: 20,
  }),
]);

function text(value) {
  return String(value ?? "").trim();
}

function safetyContract(payload) {
  return (
    payload?.scheduler_profile === "governed_multi_lane" &&
    payload?.human_review_required === true &&
    payload?.catch_up_allowed === false &&
    payload?.publish_authority === false &&
    payload?.external_posting === false
  );
}

function safeSegment(value) {
  const segment = text(value)
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!segment) {
    throw new Error(
      "governed_window_inventory_monitor_window_id_required",
    );
  }
  return segment;
}

function alertBucket(value, bucketMinutes = 30) {
  const parsed = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      "governed_window_inventory_monitor_alert_time_invalid",
    );
  }
  parsed.setUTCMinutes(
    Math.floor(parsed.getUTCMinutes() / bucketMinutes) *
      bucketMinutes,
    0,
    0,
  );
  return parsed.toISOString();
}

async function atomicWrite(filename, contents) {
  await fs.ensureDir(path.dirname(filename));
  const temporary = `${filename}.tmp-${process.pid}-${crypto
    .randomBytes(6)
    .toString("hex")}`;
  await fs.writeFile(temporary, contents);
  await fs.rename(temporary, filename);
}

function replenishmentRequest({
  definition,
  nextWindow,
  payload,
}) {
  const scheduledFor = text(nextWindow.scheduled_for);
  const coverageStatus = text(
    nextWindow.coverage_status,
  );
  return {
    kind: definition.kind,
    channel_id: text(
      payload.channel_id ||
        process.env.CHANNEL ||
        "pulse-gaming",
    ),
    payload: {
      scheduler_profile: "governed_multi_lane",
      governed_multi_lane: true,
      window_supply_repair: true,
      target_scheduled_for: scheduledFor,
      observed_coverage_status: coverageStatus,
      observed_supply_deficit: Number(
        nextWindow.supply_deficit || 0,
      ),
      human_review_required: true,
      planning_only: definition.kind !== "hunt",
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
    priority: definition.priority,
    requires_gpu: false,
    max_attempts: 3,
    idempotency_key:
      `window-supply:${scheduledFor}:${coverageStatus}:` +
      definition.kind,
  };
}

function alertMessage(nextWindow) {
  const primaryMissing = !nextWindow.primary;
  const standbyMissing = !nextWindow.standby;
  const missing = [
    ...(primaryMissing ? ["PRIMARY authority"] : []),
    ...(standbyMissing ? ["STANDBY authority"] : []),
    ...(!nextWindow.primary_admission_job
      ? ["exact T-75 admission"]
      : []),
  ];
  return [
    `Pulse Gaming exact-window warning: ${nextWindow.scheduled_for}`,
    `Coverage: ${nextWindow.coverage_status} (${nextWindow.verdict})`,
    `Missing: ${missing.join(", ") || "canonical evidence drifted"}`,
    `Blockers: ${(nextWindow.blockers || []).join(", ") || "unknown"}`,
    "Catch-up publishing remains forbidden.",
  ].join("\n");
}

async function runGovernedYoutubeWindowInventoryMonitor({
  payload = {},
  repos,
  readReport = readGovernedYoutubeWindowInventoryReport,
  notify,
} = {}) {
  if (!safetyContract(payload)) {
    throw new Error(
      "governed_window_inventory_monitor_safety_contract_invalid",
    );
  }
  if (!repos?.jobs || typeof repos.jobs.enqueue !== "function") {
    throw new Error(
      "governed_window_inventory_monitor_jobs_repository_required",
    );
  }
  const report = await readReport({
    db: repos.db,
    now: payload.now || new Date(),
    horizonHours: Number(payload.horizon_hours || 36),
  });
  const nextWindow = report?.next_window;
  if (!nextWindow) {
    throw new Error(
      "governed_window_inventory_monitor_next_window_required",
    );
  }
  const stateRoot = path.resolve(
    text(
      payload.state_root ||
        process.env.PULSE_STATE_ROOT ||
        path.join(
          __dirname,
          "..",
          "..",
          "output",
          "window-inventory",
        ),
    ),
  );
  const windowDir = path.join(
    stateRoot,
    "governed-youtube-window-inventory",
    safeSegment(nextWindow.scheduled_for),
  );
  const reportJson = path.join(windowDir, "latest.json");
  const reportMarkdown = path.join(windowDir, "latest.md");
  await atomicWrite(
    reportJson,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await atomicWrite(
    reportMarkdown,
    renderGovernedYoutubeWindowInventoryMarkdown(report),
  );

  const repairJobs = [];
  if (nextWindow.verdict !== "GREEN") {
    for (const definition of REPLENISHMENT_JOBS) {
      const request = replenishmentRequest({
        definition,
        nextWindow,
        payload,
      });
      const queued = repos.jobs.enqueue(request);
      repairJobs.push({
        id: Number(queued?.id) || null,
        kind: request.kind,
        status: queued?.status || null,
        idempotency_key: request.idempotency_key,
      });
    }
  }

  const shouldNotify =
    nextWindow.verdict !== "GREEN" &&
    ["WARNING", "CRITICAL", "INCIDENT"].includes(
      nextWindow.escalation,
    );
  const notificationBucket = shouldNotify
    ? alertBucket(payload.now || report.generated_at || new Date())
    : null;
  const alertReceiptJson = shouldNotify
    ? path.join(
        windowDir,
        `alert-${safeSegment(nextWindow.escalation)}-` +
          `${safeSegment(notificationBucket)}.json`,
      )
    : null;
  let notificationSent = false;
  let notificationReused = false;
  if (shouldNotify) {
    if (await fs.pathExists(alertReceiptJson)) {
      notificationReused = true;
    } else {
      const message = alertMessage(nextWindow);
      const notifier =
        typeof notify === "function"
          ? notify
          : require("../../notify");
      await notifier(message);
      await atomicWrite(
        alertReceiptJson,
        `${JSON.stringify(
          {
            schema_version:
              "pulse-governed-youtube-window-inventory-alert-receipt-v1",
            delivered_at:
              report.generated_at || new Date().toISOString(),
            window_id: nextWindow.window_id,
            scheduled_for: nextWindow.scheduled_for,
            coverage_status: nextWindow.coverage_status,
            escalation: nextWindow.escalation,
            notification_bucket: notificationBucket,
            message_sha256: crypto
              .createHash("sha256")
              .update(message)
              .digest("hex"),
          },
          null,
          2,
        )}\n`,
      );
      notificationSent = true;
    }
  }

  return {
    schema_version:
      "pulse-governed-youtube-window-inventory-handler-result-v1",
    status: nextWindow.coverage_status,
    verdict: nextWindow.verdict,
    scheduled_for: nextWindow.scheduled_for,
    blockers: nextWindow.blockers,
    supply_deficit: nextWindow.supply_deficit,
    report_json: reportJson,
    report_markdown: reportMarkdown,
    repair_jobs: repairJobs,
    notification_sent: notificationSent,
    notification_reused: notificationReused,
    notification_bucket: notificationBucket,
    alert_receipt_json: alertReceiptJson,
    database_jobs_enqueued: repairJobs.length > 0,
    human_review_required: true,
    catch_up_allowed: false,
    publish_authority: false,
    external_posting: false,
  };
}

module.exports = {
  REPLENISHMENT_JOBS,
  alertBucket,
  alertMessage,
  runGovernedYoutubeWindowInventoryMonitor,
};
