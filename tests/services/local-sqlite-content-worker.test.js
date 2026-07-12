const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_CONTENT_KINDS,
  parseArgs,
  usage,
} = require("../../tools/local-sqlite-content-worker");

test("local sqlite content worker defaults to non-publish content job kinds", () => {
  const args = parseArgs([], {});
  assert.ok(args.kinds.includes("fresh_production_refill"));
  assert.ok(args.kinds.includes("fresh_review_script_repair"));
  assert.ok(args.kinds.includes("candidate_supply_monitor"));
  assert.equal(args.kinds.includes("publish"), false);
  assert.equal(args.kinds.includes("publish_window_watchdog"), false);
  assert.deepEqual(args.kinds, DEFAULT_CONTENT_KINDS);
});

test("local sqlite content worker covers scheduled learning and quality loops", () => {
  const args = parseArgs([], {});
  for (const kind of [
    "live_performance_analyst",
    "studio_analytics_loop",
    "commercial_learning_loop",
    "competitor_forensics_lab",
    "competitor_quality_gate",
  ]) {
    assert.ok(args.kinds.includes(kind), `expected default content worker to claim ${kind}`);
  }
});

test("local sqlite content worker covers safe scheduled operations that keep Discord and evidence current", () => {
  const args = parseArgs([], {});
  for (const kind of [
    "scoring_digest",
    "blog_rebuild",
    "db_backup",
    "instagram_pending_verify",
    "overnight_produce_sweep",
    "overnight_analytics_backfill",
    "overnight_claude_analyst",
    "overnight_morning_digest",
  ]) {
    assert.ok(args.kinds.includes(kind), `expected default content worker to claim ${kind}`);
  }
});

test("local sqlite content worker parses explicit kind and worker options", () => {
  const args = parseArgs(
    ["--worker-id", "content-test", "--kinds", "fresh_production_refill,local_tts_doctor", "--gpu"],
    {},
  );
  assert.equal(args.workerId, "content-test");
  assert.deepEqual(args.kinds, ["fresh_production_refill", "local_tts_doctor"]);
  assert.equal(args.gpu, true);
});

test("local sqlite content worker uses a long lease for synchronous repair tools", () => {
  assert.equal(parseArgs([], {}).leaseMs, 30 * 60 * 1000);
  assert.equal(
    parseArgs([], { PULSE_CONTENT_WORKER_LEASE_MS: "2400000" }).leaseMs,
    2400000,
  );
});

test("local sqlite content worker rejects live publish and credential explicit kinds", () => {
  assert.throws(
    () => parseArgs(["--kinds", "fresh_production_refill,publish"], {}),
    /forbidden live publish or credential job kind: publish/i,
  );
  assert.throws(
    () => parseArgs(["--kinds", "publish_window_watchdog"], {}),
    /forbidden live publish or credential job kind: publish_window_watchdog/i,
  );
  assert.throws(
    () => parseArgs(["--kinds", "instagram_token_refresh"], {}),
    /forbidden live publish or credential job kind: instagram_token_refresh/i,
  );
  assert.throws(
    () => parseArgs(["--kinds", "tiktok_auth_check"], {}),
    /forbidden live publish or credential job kind: tiktok_auth_check/i,
  );
});

test("local sqlite content worker usage states it does not run publish lanes", () => {
  const text = usage();
  assert.match(text, /non-publish content jobs/i);
  assert.match(text, /does not start the HTTP server, scheduler, publish watchdog or publish runner/i);
});
