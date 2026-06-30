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

test("local sqlite content worker parses explicit kind and worker options", () => {
  const args = parseArgs(
    ["--worker-id", "content-test", "--kinds", "fresh_production_refill,local_tts_doctor", "--gpu"],
    {},
  );
  assert.equal(args.workerId, "content-test");
  assert.deepEqual(args.kinds, ["fresh_production_refill", "local_tts_doctor"]);
  assert.equal(args.gpu, true);
});

test("local sqlite content worker rejects publish-related explicit kinds", () => {
  assert.throws(
    () => parseArgs(["--kinds", "fresh_production_refill,publish"], {}),
    /forbidden publish-related job kind: publish/i,
  );
  assert.throws(
    () => parseArgs(["--kinds", "publish_window_watchdog"], {}),
    /forbidden publish-related job kind: publish_window_watchdog/i,
  );
});

test("local sqlite content worker usage states it does not run publish lanes", () => {
  const text = usage();
  assert.match(text, /non-publish content jobs/i);
  assert.match(text, /does not start the HTTP server, scheduler, publish watchdog or publish runner/i);
});
