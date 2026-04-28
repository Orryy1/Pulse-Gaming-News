const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  runContentQa,
  DEFAULT_MIN_MP4_BYTES,
  BANNED_STOCK_PHRASES,
  GLUED_SENTENCE_RE,
  AMERICAN_TIME_RE,
} = require("../../lib/services/content-qa");

// Helpers to produce a known-good / known-bad fixture. All tests
// pass a fake `fs` so we don't touch the real filesystem unless
// the test is specifically about on-disk size.

function fakeFs(map) {
  // map: { "/path": { size: bytes } | null  }
  return {
    async pathExists(p) {
      return Object.prototype.hasOwnProperty.call(map, p) && map[p] !== null;
    },
    async stat(p) {
      if (!map[p]) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { size: map[p].size };
    },
  };
}

function goodStory(overrides = {}) {
  return {
    id: "test_good",
    title: "Test Story",
    exported_path: "/tmp/out.mp4",
    // ~130 words — mirrors the real Pulse target of 120-150 so
    // the word-count check passes without tripping the max bound.
    full_script:
      "A dead franchise just got resurrected and nobody saw it coming. Big studios are responding to a shift in the market that took three years to build and thirty seconds to explode. The numbers are staggering and the timing is surgical. Ubisoft confirmed the reveal is set for later this month and the embargo lifts at midday across every major territory. Sources have verified the timeline through two separate trade outlets and an internal calendar invite that leaked last week. Players are already speculating about what this means for the series going forward, and the marketing team is quietly scrubbing old posts in preparation for the new positioning. Follow Pulse Gaming so you never miss a drop, because this one moves fast.",
    tts_script: "Short clean tts variant for TTS pass.",
    image_path: "/tmp/card.png",
    downloaded_images: [
      { path: "/tmp/hero.jpg", type: "article_hero" },
      { path: "/tmp/logo.png", type: "company_logo" },
    ],
    ...overrides,
  };
}

// ---------- happy path ----------

test("runContentQa: a healthy story → pass", async () => {
  const story = goodStory();
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "pass");
  assert.deepStrictEqual(qa.failures, []);
  assert.deepStrictEqual(qa.warnings, []);
});

// ---------- hard-fail cases ----------

test("runContentQa: missing exported_path → fail:exported_mp4_missing", async () => {
  const story = goodStory({ exported_path: undefined });
  const qa = await runContentQa(story, { fs: fakeFs({}) });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("exported_mp4_missing"));
});

test("runContentQa: exported_path set but file absent → fail", async () => {
  const story = goodStory();
  const qa = await runContentQa(story, { fs: fakeFs({}) });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("exported_mp4_not_on_disk"));
});

test("runContentQa: tiny MP4 → fail", async () => {
  const story = goodStory();
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) => f.startsWith("exported_mp4_too_small")),
    `expected exported_mp4_too_small, got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: missing full_script → fail:script_missing", async () => {
  const story = goodStory({ full_script: "", tts_script: "" });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("script_missing"));
});

test("runContentQa: tiny script word count → fail:script_too_short", async () => {
  const story = goodStory({
    full_script: "One two three four five six seven eight nine ten.",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) => f.startsWith("script_too_short")),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: banned 'let me know in the comments' → fail", async () => {
  const story = goodStory({
    full_script:
      goodStory().full_script + " Let me know in the comments what you think.",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) => f.startsWith("banned_phrase")),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: glued sentence token in full_script → fail", async () => {
  const story = goodStory({
    full_script: goodStory().full_script.replace(". Ubisoft", ".Ubisoft"),
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("glued_sentence_in_full_script"));
});

test("runContentQa: glued sentence in tts_script → fail", async () => {
  const story = goodStory({ tts_script: "The game launched.Players rushed." });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("glued_sentence_in_tts_script"));
});

// ---------- warnings (don't block) ------------------------------

test("runContentQa: American time format → warn, not fail", async () => {
  const story = goodStory({
    full_script:
      "The reveal lifts at 12:15 PM ET today. " + goodStory().full_script,
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "warn");
  assert.ok(qa.warnings.includes("american_time_format"));
  assert.deepStrictEqual(qa.failures, []);
});

test("runContentQa: only logo image available → warn", async () => {
  const story = goodStory({
    downloaded_images: [{ path: "/tmp/logo.png", type: "company_logo" }],
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "warn");
  assert.ok(qa.warnings.includes("only_logo_image_available"));
});

test("runContentQa: story_card_path set but file missing → warn", async () => {
  const story = goodStory({ story_image_path: "/tmp/card.png" });
  // MP4 exists, card does not.
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "warn");
  assert.ok(qa.warnings.includes("story_card_path_set_but_missing"));
});

test("runContentQa: entity overlay coverage <50% → warn", async () => {
  const story = goodStory({
    mentions_computed: true,
    mentions: [
      { name: "Alex Garland", image_path: "/tmp/alex.jpg", start: 10, end: 11 },
      { name: "Cailee Spaeny", image_path: null, start: 20, end: 21 },
      { name: "Ben Whishaw", image_path: null, start: 30, end: 31 },
    ],
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "warn");
  assert.ok(
    qa.warnings.some((w) => w.startsWith("entity_overlay_coverage_low")),
    `got: ${qa.warnings.join(", ")}`,
  );
});

test("runContentQa: no mentions at all (not a people story) → no warn", async () => {
  const story = goodStory({ mentions_computed: true, mentions: [] });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "pass");
});

// ---------- safety / defensive ----------------------------------

test("runContentQa: null story → fail:no_story", async () => {
  const qa = await runContentQa(null);
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("no_story"));
});

test("runContentQa: regex whitelist sanity — BANNED_STOCK_PHRASES catches the common ones", () => {
  const shouldMatch = [
    "Hey guys, welcome back to the channel",
    "Don't forget to smash that like button",
    "In this video I'll show you",
  ];
  for (const s of shouldMatch) {
    assert.ok(
      BANNED_STOCK_PHRASES.some((re) => re.test(s)),
      `expected banned-phrase match for: ${s}`,
    );
  }
});

test("runContentQa: GLUED_SENTENCE_RE doesn't false-match legitimate abbreviations", () => {
  const legitimate = [
    "U.S. gaming market grew",
    "e.g. Nintendo",
    "i.e. the new console",
    "No period.No space either — this SHOULD match",
  ];
  assert.strictEqual(GLUED_SENTENCE_RE.test(legitimate[0]), false);
  assert.strictEqual(GLUED_SENTENCE_RE.test(legitimate[1]), false);
  assert.strictEqual(GLUED_SENTENCE_RE.test(legitimate[2]), false);
  assert.strictEqual(GLUED_SENTENCE_RE.test(legitimate[3]), true);
});

test("runContentQa: AMERICAN_TIME_RE doesn't match 24h time", () => {
  assert.strictEqual(AMERICAN_TIME_RE.test("at 14:30"), false);
  assert.strictEqual(AMERICAN_TIME_RE.test("at 14:30 UTC"), false);
  assert.strictEqual(AMERICAN_TIME_RE.test("at 2:30 PM"), true);
});

test("DEFAULT_MIN_MP4_BYTES is conservative (200KB)", () => {
  assert.strictEqual(DEFAULT_MIN_MP4_BYTES, 200 * 1024);
});

// ---------- real filesystem check ------------------------------
// Single smoke test with a real temp file to confirm the
// production code path works end-to-end with actual fs-extra.

test("runContentQa: real filesystem path — happy case", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024)); // 5MB
  try {
    const story = goodStory({ exported_path: mp4 });
    const qa = await runContentQa(story);
    assert.strictEqual(qa.result, "pass", JSON.stringify(qa));
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});
