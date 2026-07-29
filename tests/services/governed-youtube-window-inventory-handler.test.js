"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  runGovernedYoutubeWindowInventoryMonitor,
} = require("../../lib/services/governed-youtube-window-inventory-handler");
const { handlers } = require("../../lib/job-handlers");

function report({
  status = "AT_RISK",
  verdict = "HOLD",
  escalation = "WARNING",
  blockers = [
    "governed_window_primary_authority_required",
    "governed_window_standby_authority_required",
  ],
} = {}) {
  const next = {
    window_id: "youtube:2026-07-28T19:00:00.000Z",
    scheduled_for: "2026-07-28T19:00:00.000Z",
    coverage_status: status,
    verdict,
    escalation,
    minutes_remaining: 240,
    supply_deficit: verdict === "GREEN" ? 0 : 2,
    blockers,
    primary: verdict === "GREEN" ? { story_id: "primary" } : null,
    standby: verdict === "GREEN" ? { story_id: "reserve" } : null,
    primary_admission_job:
      verdict === "GREEN" ? { id: 88 } : null,
    catch_up_allowed: false,
    publish_authority: false,
    external_posting: false,
  };
  return {
    schema_version:
      "pulse-governed-youtube-window-inventory-report-v1",
    generated_at: "2026-07-28T15:00:00.000Z",
    verdict,
    windows: [next],
    next_window: next,
    blockers,
    catch_up_allowed: false,
    publish_authority: false,
    external_posting: false,
  };
}

function safePayload(root) {
  return {
    scheduler_profile: "governed_multi_lane",
    horizon_hours: 36,
    human_review_required: true,
    catch_up_allowed: false,
    publish_authority: false,
    external_posting: false,
    state_root: root,
    now: "2026-07-28T15:00:00.000Z",
  };
}

function idempotentJobs() {
  const byKey = new Map();
  return {
    enqueue(request) {
      if (!byKey.has(request.idempotency_key)) {
        byKey.set(request.idempotency_key, {
          id: byKey.size + 1,
          status: "pending",
          ...request,
        });
      }
      return byKey.get(request.idempotency_key);
    },
    values() {
      return [...byKey.values()];
    },
  };
}

test("an uncovered window durably queues bounded replenishment and emits one state-bound alert", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-window-inventory-handler-"),
  );
  t.after(() => fs.remove(root));
  const jobs = idempotentJobs();
  const alerts = [];
  const options = {
    payload: safePayload(root),
    repos: { db: {}, jobs },
    readReport: () => report(),
    notify: async (message) => alerts.push(message),
  };

  const first =
    await runGovernedYoutubeWindowInventoryMonitor(options);
  const second =
    await runGovernedYoutubeWindowInventoryMonitor(options);
  const reminder =
    await runGovernedYoutubeWindowInventoryMonitor({
      ...options,
      payload: {
        ...options.payload,
        now: "2026-07-28T15:31:00.000Z",
      },
    });

  assert.equal(first.status, "AT_RISK");
  assert.equal(first.verdict, "HOLD");
  assert.equal(first.notification_sent, true);
  assert.equal(second.notification_sent, false);
  assert.equal(second.notification_reused, true);
  assert.equal(reminder.notification_sent, true);
  assert.notEqual(
    reminder.alert_receipt_json,
    first.alert_receipt_json,
  );
  assert.equal(alerts.length, 2);
  assert.match(alerts[0], /2026-07-28T19:00:00\.000Z/);
  assert.match(alerts[0], /PRIMARY authority/);
  assert.deepEqual(
    jobs
      .values()
      .map((job) => job.kind)
      .sort(),
    [
      "evergreen_candidate_builder",
      "governed_editorial_evidence_backfill",
      "governed_multi_lane_plan",
      "hunt",
      "reconcile_editorial_inventory",
    ].sort(),
  );
  assert.ok(
    jobs.values().every(
      (job) =>
        job.payload.publish_authority === false &&
        job.payload.external_posting === false &&
        job.payload.human_review_required === true,
    ),
  );
  assert.equal(
    await fs.pathExists(first.report_json),
    true,
  );
  assert.equal(
    await fs.pathExists(first.report_markdown),
    true,
  );
  assert.equal(
    await fs.pathExists(first.alert_receipt_json),
    true,
  );
});

test("a covered window writes proof without replenishment or alert noise", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-window-inventory-covered-"),
  );
  t.after(() => fs.remove(root));
  const jobs = idempotentJobs();
  let notified = false;

  const result =
    await runGovernedYoutubeWindowInventoryMonitor({
      payload: safePayload(root),
      repos: { db: {}, jobs },
      readReport: () =>
        report({
          status: "COVERED",
          verdict: "GREEN",
          escalation: "NONE",
          blockers: [],
        }),
      notify: async () => {
        notified = true;
      },
    });

  assert.equal(result.status, "COVERED");
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.notification_sent, false);
  assert.equal(notified, false);
  assert.deepEqual(jobs.values(), []);
});

test("inventory monitoring rejects any payload that could imply publishing authority", async () => {
  await assert.rejects(
    runGovernedYoutubeWindowInventoryMonitor({
      payload: {
        ...safePayload("C:/safe-state"),
        publish_authority: true,
      },
      repos: { db: {}, jobs: idempotentJobs() },
      readReport: () => report(),
      notify: async () => {},
    }),
    /governed_window_inventory_monitor_safety_contract_invalid/,
  );
});

test("a failed alert is retried because no delivery receipt is written", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-window-inventory-alert-retry-"),
  );
  t.after(() => fs.remove(root));
  const jobs = idempotentJobs();
  let attempts = 0;
  const options = {
    payload: safePayload(root),
    repos: { db: {}, jobs },
    readReport: () => report(),
    notify: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("alert_transport_down");
    },
  };

  await assert.rejects(
    runGovernedYoutubeWindowInventoryMonitor(options),
    /alert_transport_down/,
  );
  const retried =
    await runGovernedYoutubeWindowInventoryMonitor(options);

  assert.equal(attempts, 2);
  assert.equal(retried.notification_sent, true);
  assert.equal(
    await fs.pathExists(retried.alert_receipt_json),
    true,
  );
});

test("the scheduled job map invokes the production inventory monitor with lease fencing", async () => {
  const calls = [];
  const result =
    await handlers.governed_youtube_window_inventory_monitor(
      {
        kind: "governed_youtube_window_inventory_monitor",
        payload: {
          scheduler_profile: "governed_multi_lane",
          human_review_required: true,
          catch_up_allowed: false,
          publish_authority: false,
          external_posting: false,
        },
      },
      {
        repos: { db: {}, jobs: {} },
        assertLeaseHealthy() {
          calls.push("lease");
        },
        async runGovernedYoutubeWindowInventoryMonitor(input) {
          calls.push(input);
          return { status: "COVERED", verdict: "GREEN" };
        },
      },
    );

  assert.equal(result.verdict, "GREEN");
  assert.equal(calls[0], "lease");
  assert.equal(calls[2], "lease");
  assert.equal(
    calls[1].payload.scheduler_profile,
    "governed_multi_lane",
  );
});
