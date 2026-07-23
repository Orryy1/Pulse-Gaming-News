"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildOAuthUptimePlan,
} = require("../../lib/platforms/oauth-uptime");
const {
  runOAuthUptimeMaintenance,
} = require("../../lib/platforms/oauth-uptime-runner");
const {
  mergeRotatedToken,
  writeTokenJsonAtomic,
} = require("../../lib/platforms/durable-token-store");
const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");
const { handlers } = require("../../lib/job-handlers");

test("OAuth uptime refreshes renewable credentials before the publishing horizon", () => {
  const now = Date.parse("2026-07-23T08:00:00.000Z");
  const plan = buildOAuthUptimePlan({
    now,
    platforms: {
      youtube: {
        enabled: true,
        access_expires_at: now + 2 * 60 * 60 * 1000,
        refresh_available: true,
      },
      tiktok: {
        enabled: true,
        access_expires_at: now + 8 * 60 * 60 * 1000,
        refresh_expires_at: now + 300 * 24 * 60 * 60 * 1000,
        refresh_available: true,
      },
      instagram: {
        enabled: true,
        access_expires_at: now + 20 * 24 * 60 * 60 * 1000,
        refresh_available: true,
      },
    },
  });

  assert.deepEqual(
    plan.actions.map((action) => [action.platform, action.action]),
    [
      ["youtube", "refresh"],
      ["tiktok", "refresh"],
      ["instagram", "refresh"],
    ],
  );
  assert.equal(plan.requires_human_reauth, false);
  assert.equal(plan.safety.social_posting_triggered, false);
  assert.equal(plan.safety.token_values_exposed, false);
});

test("durable token rotation preserves an omitted refresh credential and replaces atomically", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-token-store-"));
  const tokenPath = path.join(root, "nested", "token.json");
  const previous = {
    access_token: "old-access",
    refresh_token: "long-lived-refresh",
    expiry_date: 100,
  };
  const rotated = mergeRotatedToken(previous, {
    access_token: "new-access",
    expiry_date: 200,
  });

  assert.equal(rotated.refresh_token, "long-lived-refresh");
  await writeTokenJsonAtomic(tokenPath, rotated);
  assert.deepEqual(await fs.readJson(tokenPath), rotated);
  assert.equal(
    (await fs.readdir(path.dirname(tokenPath))).some((name) => name.includes(".tmp-")),
    false,
  );
});

test("OAuth uptime runner refreshes only renewable platforms and emits redacted evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-oauth-uptime-"));
  const now = Date.parse("2026-07-23T08:00:00.000Z");
  const calls = [];
  const result = await runOAuthUptimeMaintenance({
    now,
    outDir: root,
    allowTokenMutation: true,
    platformAdapters: {
      youtube: {
        async inspect() {
          return {
            enabled: true,
            access_expires_at: now + 60 * 60 * 1000,
            refresh_available: true,
            access_token: "must-not-leak",
          };
        },
        async refresh() {
          calls.push("youtube");
          return { ok: true, access_token: "new-secret" };
        },
      },
      x: {
        async inspect() {
          return { enabled: true, credential_kind: "oauth1" };
        },
        async validate() {
          calls.push("x");
          return { ok: true };
        },
      },
    },
  });

  assert.deepEqual(calls, ["youtube", "x"]);
  assert.equal(result.report.results.youtube.status, "refreshed");
  assert.equal(result.report.results.x.status, "valid");
  const raw = await fs.readFile(
    path.join(root, "oauth_uptime_report.json"),
    "utf8",
  );
  assert.doesNotMatch(raw, /must-not-leak|new-secret|access_token/i);
});

test("Instagram Page credentials are validated rather than sent to the Basic Display refresh endpoint", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-oauth-meta-"));
  const calls = [];
  const result = await runOAuthUptimeMaintenance({
    now: Date.parse("2026-07-23T10:00:00.000Z"),
    outDir: root,
    allowTokenMutation: true,
    platformAdapters: {
      instagram: {
        async inspect() {
          return {
            enabled: true,
            access_expires_at: 0,
            refresh_available: false,
            credential_kind: "page_access_token",
          };
        },
        async refresh() {
          calls.push("refresh");
          throw new Error("wrong_endpoint");
        },
        async validate() {
          calls.push("validate");
          return { ok: true };
        },
      },
    },
  });

  assert.deepEqual(calls, ["validate"]);
  assert.equal(result.report.results.instagram.status, "valid");
  assert.equal(result.report.requires_human_reauth, false);
});

test("persistent scheduler registers six-hour OAuth uptime maintenance", () => {
  const schedule = DEFAULT_SCHEDULES.find(
    (item) => item.name === "oauth_uptime_6h",
  );
  assert.equal(schedule.kind, "oauth_uptime_maintenance");
  assert.equal(schedule.cron_expr, "20 */6 * * *");
  assert.equal(schedule.payload.allow_token_refresh, true);
  assert.equal(schedule.payload.no_social_posting, true);
  assert.equal(typeof handlers.oauth_uptime_maintenance, "function");
});

test("OAuth uptime sidecar requests credential maintenance without a posting route", async () => {
  const script = await fs.readFile(
    path.resolve(
      __dirname,
      "..",
      "..",
      "scripts",
      "task-scheduler",
      "pulse-oauth-uptime.ps1",
    ),
    "utf8",
  );
  assert.match(script, /oauth-uptime-maintenance\.js/i);
  assert.match(script, /--refresh/i);
  assert.match(script, /WindowStyle\s+Hidden/i);
  assert.doesNotMatch(script, /\b(?:publish|upload)\b/i);
});
