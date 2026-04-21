const { test } = require("node:test");
const assert = require("node:assert");

const {
  DEFAULT_CHANNEL_ID,
  resolveChannelId,
  filterStoriesByChannel,
} = require("../../lib/channel-context");

// ---------- resolveChannelId ----------

test("resolveChannelId: default is pulse-gaming when explicit + env both unset", () => {
  assert.strictEqual(resolveChannelId(undefined, { env: {} }), "pulse-gaming");
  assert.strictEqual(DEFAULT_CHANNEL_ID, "pulse-gaming");
});

test("resolveChannelId: explicit wins over env", () => {
  assert.strictEqual(
    resolveChannelId("stacked", { env: { CHANNEL: "pulse-gaming" } }),
    "stacked",
  );
});

test("resolveChannelId: env used when explicit is empty/null/undefined", () => {
  assert.strictEqual(
    resolveChannelId(undefined, { env: { CHANNEL: "the-signal" } }),
    "the-signal",
  );
  assert.strictEqual(
    resolveChannelId(null, { env: { CHANNEL: "the-signal" } }),
    "the-signal",
  );
  assert.strictEqual(
    resolveChannelId("", { env: { CHANNEL: "the-signal" } }),
    "the-signal",
  );
});

test("resolveChannelId: whitespace is trimmed", () => {
  assert.strictEqual(resolveChannelId("   stacked  ", { env: {} }), "stacked");
  assert.strictEqual(
    resolveChannelId(undefined, { env: { CHANNEL: "   stacked  " } }),
    "stacked",
  );
});

test("resolveChannelId: whitespace-only strings fall back like empty", () => {
  assert.strictEqual(
    resolveChannelId("   ", { env: { CHANNEL: "pulse-gaming" } }),
    "pulse-gaming",
  );
});

test("resolveChannelId: ignores non-string types", () => {
  assert.strictEqual(
    resolveChannelId(123, { env: { CHANNEL: "pulse-gaming" } }),
    "pulse-gaming",
  );
  assert.strictEqual(
    resolveChannelId({ id: "x" }, { env: { CHANNEL: "pulse-gaming" } }),
    "pulse-gaming",
  );
});

// ---------- filterStoriesByChannel ----------

const SAMPLE = [
  { id: "a", channel_id: "pulse-gaming" },
  { id: "b", channel_id: "stacked" },
  { id: "c", channel_id: "the-signal" },
  { id: "d", channel_id: null }, // legacy pre-migration row
  { id: "e" /* channel_id undefined */ },
];

test("filterStoriesByChannel: defaults to pulse-gaming, includes legacy NULL rows", () => {
  const r = filterStoriesByChannel(SAMPLE);
  const ids = r.map((s) => s.id).sort();
  assert.deepStrictEqual(ids, ["a", "d", "e"]);
});

test("filterStoriesByChannel: explicit stacked returns only stacked rows", () => {
  const r = filterStoriesByChannel(SAMPLE, "stacked");
  assert.deepStrictEqual(
    r.map((s) => s.id),
    ["b"],
  );
});

test("filterStoriesByChannel: channelId=null returns unfiltered list", () => {
  const r = filterStoriesByChannel(SAMPLE, null);
  assert.strictEqual(r.length, SAMPLE.length);
});

test("filterStoriesByChannel: unknown channel returns empty", () => {
  const r = filterStoriesByChannel(SAMPLE, "nonexistent");
  assert.deepStrictEqual(r, []);
});

test("filterStoriesByChannel: non-array input returns []", () => {
  assert.deepStrictEqual(filterStoriesByChannel(null), []);
  assert.deepStrictEqual(filterStoriesByChannel(undefined), []);
  assert.deepStrictEqual(filterStoriesByChannel({}), []);
  assert.deepStrictEqual(filterStoriesByChannel("nope"), []);
});

test("filterStoriesByChannel: skips non-object entries safely", () => {
  const r = filterStoriesByChannel(
    [null, undefined, "str", 42, { id: "ok", channel_id: "pulse-gaming" }],
    "pulse-gaming",
  );
  assert.deepStrictEqual(
    r.map((s) => s.id),
    ["ok"],
  );
});
