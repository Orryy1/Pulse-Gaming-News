const { test } = require("node:test");
const assert = require("node:assert");

const {
  filterMentionsForOverlay,
  DEFAULT_MAX_OVERLAYS_PER_VIDEO,
  DEFAULT_OVERLAY_MIN_START_SECONDS,
} = require("../../entities");

// Fixtures — minimal mention objects. image_path presence is the
// "Wikipedia found a photo" signal.
function m(
  name,
  start,
  end = start + 1,
  { image = true, type = "person" } = {},
) {
  return {
    name,
    type,
    image_path: image ? `/tmp/${name}.jpg` : null,
    start,
    end,
  };
}

// ---------- opening-title guard ----------

test("filterMentionsForOverlay: rejects mentions whose start is inside the opening title block", () => {
  const out = filterMentionsForOverlay([
    m("Alex Garland", 0.5), // under the 1.2s floor
    m("Alex Garland", 5.0), // fine
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].start, 5.0);
});

test("filterMentionsForOverlay: exact boundary at minStart is accepted", () => {
  const out = filterMentionsForOverlay([
    m("Alex", DEFAULT_OVERLAY_MIN_START_SECONDS),
  ]);
  assert.strictEqual(out.length, 1);
});

test("filterMentionsForOverlay: custom minStart via opts", () => {
  const out = filterMentionsForOverlay([m("Alex", 1.0), m("Alex", 3.0)], {
    minStart: 2.0,
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].start, 3.0);
});

// ---------- cap ----------

test("filterMentionsForOverlay: caps to DEFAULT_MAX_OVERLAYS_PER_VIDEO (5)", () => {
  const many = Array.from({ length: 10 }, (_, i) => m("E" + i, 5 + i));
  const out = filterMentionsForOverlay(many);
  assert.strictEqual(out.length, DEFAULT_MAX_OVERLAYS_PER_VIDEO);
});

test("filterMentionsForOverlay: custom cap via opts.maxOverlays", () => {
  const many = Array.from({ length: 8 }, (_, i) => m("E" + i, 5 + i));
  const out = filterMentionsForOverlay(many, { maxOverlays: 3 });
  assert.strictEqual(out.length, 3);
});

// ---------- distinct-entity preservation ----------

test("filterMentionsForOverlay: preserves the FIRST mention of each distinct entity under the cap", () => {
  // 7 mentions: 3 Alex, 2 Cailee, 1 Ben, 1 Nick. Cap = 5.
  // Every entity should get at least one overlay.
  const mentions = [
    m("Alex Garland", 5),
    m("Alex Garland", 10),
    m("Alex Garland", 15),
    m("Cailee Spaeny", 20),
    m("Cailee Spaeny", 25),
    m("Ben Whishaw", 30),
    m("Nick Offerman", 35),
  ];
  const out = filterMentionsForOverlay(mentions, { maxOverlays: 5 });
  const names = new Set(out.map((o) => o.name));
  assert.ok(names.has("Alex Garland"));
  assert.ok(names.has("Cailee Spaeny"));
  assert.ok(names.has("Ben Whishaw"));
  assert.ok(names.has("Nick Offerman"));
  assert.strictEqual(out.length, 5);
});

test("filterMentionsForOverlay: output is ordered by start time", () => {
  const out = filterMentionsForOverlay([m("B", 10), m("A", 5), m("C", 15)]);
  const starts = out.map((o) => o.start);
  assert.deepStrictEqual(
    starts,
    [...starts].sort((a, b) => a - b),
  );
});

// ---------- image-missing guard ----------

test("filterMentionsForOverlay: rejects mentions with no image_path", () => {
  const out = filterMentionsForOverlay([
    m("With image", 5),
    m("No image", 6, 7, { image: false }),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, "With image");
});

// ---------- outro guard ----------

test("filterMentionsForOverlay: rejects mentions after outroStart", () => {
  const out = filterMentionsForOverlay(
    [
      m("Alex", 20),
      m("Alex", 48), // past the 45s outro
    ],
    { outroStart: 45 },
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].start, 20);
});

// ---------- defensive ----------

test("filterMentionsForOverlay: non-array input returns []", () => {
  assert.deepStrictEqual(filterMentionsForOverlay(null), []);
  assert.deepStrictEqual(filterMentionsForOverlay(undefined), []);
  assert.deepStrictEqual(filterMentionsForOverlay({}), []);
  assert.deepStrictEqual(filterMentionsForOverlay("nope"), []);
});

test("filterMentionsForOverlay: skips malformed mention entries without crashing", () => {
  const out = filterMentionsForOverlay([
    null,
    undefined,
    "string",
    { name: "Partial" /* no start/end */ },
    m("Valid", 5),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, "Valid");
});

// ---------- defaults ----------

test("DEFAULT_MAX_OVERLAYS_PER_VIDEO and DEFAULT_OVERLAY_MIN_START_SECONDS are sane", () => {
  assert.ok(
    DEFAULT_MAX_OVERLAYS_PER_VIDEO >= 3 && DEFAULT_MAX_OVERLAYS_PER_VIDEO <= 10,
  );
  assert.ok(
    DEFAULT_OVERLAY_MIN_START_SECONDS >= 0.5 &&
      DEFAULT_OVERLAY_MIN_START_SECONDS <= 2.5,
  );
});
