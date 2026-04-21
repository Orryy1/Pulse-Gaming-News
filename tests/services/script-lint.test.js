const { test } = require("node:test");
const assert = require("node:assert");

const {
  lintScript,
  buildRetryFeedback,
  countWords,
  findRepeatedNGrams,
  countFillerPhrases,
  BANNED_PHRASES,
  DEFAULT_MIN_WORDS,
  DEFAULT_MAX_WORDS,
} = require("../../lib/services/script-lint");

// A realistic clean script — 130 words, curiosity marker in the
// hook, no banned phrases, 24h time. Used as the baseline for
// "pass" assertions so we don't accidentally trip an unrelated
// rule.
const CLEAN_SCRIPT =
  "A dead franchise just got resurrected and nobody saw it coming. " +
  "Big studios are responding to a shift in the market that took three years " +
  "to build and thirty seconds to explode. The numbers are staggering and " +
  "the timing is surgical. Ubisoft confirmed the reveal is set for later this month " +
  "and the embargo lifts at midday across every major territory. Sources have " +
  "verified the timeline through two separate trade outlets and an internal " +
  "calendar invite that leaked last week. Players are already speculating about " +
  "what this means for the series going forward, and the marketing team is " +
  "quietly scrubbing old posts in preparation for the new positioning. Follow " +
  "Pulse Gaming so you never miss a drop, because this one moves fast.";

// ---------- happy path ----------

test("lintScript: clean baseline script → pass", () => {
  const r = lintScript(CLEAN_SCRIPT);
  assert.strictEqual(r.result, "pass", JSON.stringify(r));
  assert.deepStrictEqual(r.failures, []);
});

// ---------- hard-fail cases ----------

test("lintScript: missing/empty script → fail:script_missing", () => {
  for (const s of ["", "   ", null, undefined, 42]) {
    const r = lintScript(s);
    assert.strictEqual(r.result, "fail");
    assert.ok(r.failures.includes("script_missing"));
  }
});

test("lintScript: below min word count → fail:script_too_short", () => {
  const r = lintScript("One two three four five six seven eight nine ten.");
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.some((f) => f.startsWith("script_too_short")));
});

test("lintScript: each banned phrase → fail", () => {
  const variants = [
    "let me know in the comments below what you think",
    "Don't forget to smash that like button",
    "Hey guys, welcome back to the channel",
    "In this video I'll show you the details",
    "Buckle up folks, this is a wild one",
    "Today we're going to explore everything",
  ];
  for (const bad of variants) {
    const r = lintScript(CLEAN_SCRIPT + " " + bad);
    assert.strictEqual(r.result, "fail", `expected fail for: ${bad}`);
    assert.ok(
      r.failures.some((f) => f.startsWith("banned_phrase:")),
      `got: ${r.failures.join(", ")}`,
    );
  }
});

test("lintScript: glued sentence token → fail:glued_sentence", () => {
  // Insert a glued boundary by removing the space after "month."
  const bad = CLEAN_SCRIPT.replace(
    "later this month and",
    "later this month.And",
  );
  const r = lintScript(bad);
  assert.strictEqual(r.result, "fail");
  assert.ok(r.failures.includes("glued_sentence"));
});

test("lintScript: generic first word → fail:generic_opener", () => {
  const opener = "So here's the thing that nobody saw coming. ";
  const r = lintScript(opener + CLEAN_SCRIPT);
  assert.strictEqual(r.result, "fail");
  assert.ok(
    r.failures.some((f) => f.startsWith("generic_opener:")),
    `got: ${r.failures.join(", ")}`,
  );
});

// ---------- warnings (don't block) ----------

test("lintScript: long script → warn:script_too_long", () => {
  // Pad to 200 words, max is 170.
  const long = (CLEAN_SCRIPT + " ").repeat(2).trim();
  const r = lintScript(long);
  // Long scripts can also accidentally trigger other warnings;
  // just confirm the script_too_long warning fires and it's not
  // a hard fail.
  assert.notStrictEqual(r.result, "fail");
  assert.ok(r.warnings.some((w) => w.startsWith("script_too_long")));
});

test("lintScript: American time format → warn:american_time_format", () => {
  const r = lintScript(CLEAN_SCRIPT + " The reveal is at 12:15 PM ET today.");
  assert.notStrictEqual(r.result, "fail");
  assert.ok(r.warnings.includes("american_time_format"));
});

test("lintScript: no curiosity marker → warn:no_curiosity_marker", () => {
  // Build a script of the right length with zero curiosity markers.
  // Use neutral factual sentences that don't hit any of the marker
  // regexes.
  // Needs 110+ words AND zero curiosity markers. Use neutral
  // factual sentences long enough to clear the floor.
  const dry =
    "The game launches in March with full crossplay enabled from day one. " +
    "It includes cooperative multiplayer, ranked ladders, and limited private lobbies. " +
    "The price is set at the standard AAA tier across every region. " +
    "Preorders open today and carry a small digital bonus pack. " +
    "Rewards are offered for players who opt into community feedback. " +
    "The engine is a custom fork with ray-traced reflections baked in. " +
    "The studio expanded staffing by fifteen percent during the final year. " +
    "Reviews from embargoed outlets will follow approximately two weeks after launch. " +
    "Fans are discussing options, cosmetics, and accessibility features. " +
    "The embargo ends soon and marketing will shift to long-form gameplay previews. " +
    "Updates will ship monthly with a rolling patch cadence through the first year. " +
    "Follow Pulse Gaming so you never miss a drop on weekend windows.";
  const r = lintScript(dry);
  // Not a fail — curiosity-marker absence is a warn only.
  assert.notStrictEqual(r.result, "fail");
  assert.ok(r.warnings.includes("no_curiosity_marker"));
});

test("lintScript: heavy filler phrases → warn:filler_dense", () => {
  const r = lintScript(
    CLEAN_SCRIPT + " At the end of the day, to be honest, needless to say.",
  );
  assert.notStrictEqual(r.result, "fail");
  assert.ok(r.warnings.some((w) => w.startsWith("filler_dense")));
});

test("lintScript: repeated 4-gram at mid-roll → warn:repeated_phrase", () => {
  // "nobody saw it coming" appears once in CLEAN_SCRIPT. Add two
  // more copies to push it past the 2-occurrence threshold.
  const r = lintScript(
    CLEAN_SCRIPT + " But nobody saw it coming. And truly nobody saw it coming.",
  );
  assert.notStrictEqual(r.result, "fail");
  assert.ok(
    r.warnings.some((w) => w.startsWith("repeated_phrase")),
    `got: ${r.warnings.join(", ")}`,
  );
});

// ---------- helper behaviour ----------

test("countWords: handles whitespace + non-string input", () => {
  assert.strictEqual(countWords("one two three"), 3);
  assert.strictEqual(countWords("  one   two  "), 2);
  assert.strictEqual(countWords(""), 0);
  assert.strictEqual(countWords(null), 0);
  assert.strictEqual(countWords(12345), 0);
});

test("findRepeatedNGrams: returns empty when nothing repeats 3+ times", () => {
  const out = findRepeatedNGrams(
    "one two three four five six seven eight nine ten",
  );
  assert.deepStrictEqual(out, []);
});

test("findRepeatedNGrams: detects phrase repeated 3 times", () => {
  const text =
    "alpha beta gamma delta again alpha beta gamma delta once more alpha beta gamma delta";
  const out = findRepeatedNGrams(text);
  assert.ok(
    out.some((r) => r.ngram === "alpha beta gamma delta" && r.count >= 3),
  );
});

test("countFillerPhrases: counts each occurrence including overlaps", () => {
  assert.strictEqual(
    countFillerPhrases(
      "at the end of the day, to be honest, at the end of the day",
    ),
    3,
  );
  assert.strictEqual(countFillerPhrases("nothing here"), 0);
});

// ---------- buildRetryFeedback ----------

test("buildRetryFeedback: returns empty string on pass", () => {
  const feedback = buildRetryFeedback({
    result: "pass",
    failures: [],
    warnings: [],
  });
  assert.strictEqual(feedback, "");
});

test("buildRetryFeedback: lists each failure + warning", () => {
  const feedback = buildRetryFeedback({
    result: "fail",
    failures: ["banned_phrase:generic_youtube_opener", "glued_sentence"],
    warnings: ["american_time_format"],
  });
  assert.match(feedback, /PREVIOUS DRAFT WAS REJECTED/);
  assert.match(feedback, /banned_phrase:generic_youtube_opener/);
  assert.match(feedback, /glued_sentence/);
  assert.match(feedback, /american_time_format/);
});

test("buildRetryFeedback: never includes the original script body", () => {
  // Feedback is enum-tag only — the caller already has the draft.
  // Pinning this so a future refactor doesn't accidentally echo
  // the draft back into the retry prompt (which would burn tokens
  // and potentially leak secrets from a mis-prompted draft).
  const feedback = buildRetryFeedback({
    result: "fail",
    failures: ["banned_phrase:x"],
    warnings: [],
  });
  assert.strictEqual(feedback.includes("CLEAN"), false);
  assert.strictEqual(feedback.includes("script body"), false);
});

test("buildRetryFeedback: safe on null input", () => {
  assert.strictEqual(buildRetryFeedback(null), "");
  assert.strictEqual(buildRetryFeedback(undefined), "");
  assert.strictEqual(buildRetryFeedback({}), "");
});

// ---------- defaults ----------

test("DEFAULT_MIN_WORDS / DEFAULT_MAX_WORDS hug the Pulse 120-150 target", () => {
  // The lint bounds should be looser than the exact target so
  // every 130-word script passes but a 50- or 300-word Claude
  // drift still trips.
  assert.ok(DEFAULT_MIN_WORDS < 130);
  assert.ok(DEFAULT_MAX_WORDS > 150);
});

test("BANNED_PHRASES: every entry has { re, reason }", () => {
  for (const entry of BANNED_PHRASES) {
    assert.ok(entry.re instanceof RegExp);
    assert.ok(typeof entry.reason === "string" && entry.reason.length > 0);
  }
});
