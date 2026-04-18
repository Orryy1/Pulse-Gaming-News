/**
 * tests/services/news-mirror.test.js
 *
 * Pins the hunt-resilience fix for the recurring
 * RangeError("Invalid string length") that killed the 17-Apr 22:38
 * and 18-Apr 04:47 hunts.
 *
 * Covers:
 *   * decideMirrorStrategy skips JSON under USE_SQLITE=true — prod
 *     can never hit the big JSON.stringify that triggered the bug.
 *   * decideMirrorStrategy keeps JSON under USE_SQLITE=false — dev
 *     without a DB still works.
 *   * tryStringify never throws: small inputs serialise; an input
 *     that throws inside JSON.stringify returns ok:false with a
 *     structured reason + rowCount.
 *   * Integration-style: a synthetic "impossible to stringify"
 *     payload returns ok:false (uses toJSON throwing RangeError to
 *     prove the ok:false path without materialising 512 MB).
 *
 * Run: node --test tests/services/news-mirror.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decideMirrorStrategy,
  tryStringify,
} = require("../../lib/services/news-mirror");

test("decideMirrorStrategy: USE_SQLITE=true -> sqlite-only (no JSON stringify in prod)", () => {
  const r = decideMirrorStrategy([{ id: "s1" }], { useSqlite: true });
  assert.equal(r.strategy, "sqlite-only");
  assert.equal(r.reason, "sqlite_canonical_skip_json_mirror");
});

test("decideMirrorStrategy: USE_SQLITE=false -> json-mirror (dev path)", () => {
  const r = decideMirrorStrategy([{ id: "s1" }], { useSqlite: false });
  assert.equal(r.strategy, "json-mirror");
  assert.equal(r.reason, "sqlite_off_json_is_canonical");
});

test("decideMirrorStrategy: missing useSqlite defaults to json-mirror (never silently becomes sqlite-only)", () => {
  const r = decideMirrorStrategy([], {});
  assert.equal(r.strategy, "json-mirror");
});

test("decideMirrorStrategy: works on empty array (no special-case crash)", () => {
  const r = decideMirrorStrategy([], { useSqlite: true });
  assert.equal(r.strategy, "sqlite-only");
});

test("tryStringify: serialises a small array", () => {
  const r = tryStringify([{ id: "s1", title: "hello" }]);
  assert.equal(r.ok, true);
  assert.equal(r.rowCount, 1);
  assert.match(r.serialised, /"id":\s*"s1"/);
});

test("tryStringify: reports rowCount=-1 for non-array input", () => {
  const r = tryStringify({ not: "an array" });
  assert.equal(r.ok, true);
  assert.equal(r.rowCount, -1);
});

test("tryStringify: catches a RangeError thrown during serialisation and returns ok:false", () => {
  // Simulate V8's "Invalid string length" without materialising half a
  // gig of memory. JSON.stringify calls toJSON() on objects; throwing
  // RangeError from there reproduces the exact failure mode of the
  // 17-Apr / 18-Apr hunts at a scale that fits in a unit test.
  const poison = {
    toJSON() {
      throw new RangeError("Invalid string length");
    },
  };
  const r = tryStringify([poison]);
  assert.equal(r.ok, false);
  assert.equal(r.rowCount, 1);
  assert.match(r.reason, /RangeError/);
  assert.match(r.reason, /Invalid string length/);
});

test("tryStringify: catches circular references without throwing", () => {
  const a = { id: "a" };
  const b = { id: "b", back: a };
  a.ref = b; // JSON.stringify throws TypeError("circular")
  const r = tryStringify([a, b]);
  assert.equal(r.ok, false);
  assert.equal(r.rowCount, 2);
  assert.match(r.reason, /TypeError|circular/i);
});

test("tryStringify: never throws (contract)", () => {
  // Exercise a grab-bag of values, none may escape as an exception.
  for (const input of [null, undefined, 42, "s", [1, 2], { a: 1 }, [], {}]) {
    const r = tryStringify(input);
    assert.equal(
      typeof r.ok,
      "boolean",
      `input ${JSON.stringify(input)} must return {ok}`,
    );
  }
});
