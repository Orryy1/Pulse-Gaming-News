const { test } = require("node:test");
const assert = require("node:assert");

const {
  wordsFromCharacterTimestamps,
  findMentionWindows,
} = require("../../entities");

// ElevenLabs returns per-character start/end times. Most of the tests
// in this file first build a minimal "timestamps" object by hand (so
// the assertions are readable) and feed it through
// wordsFromCharacterTimestamps to recover a words[] array. The second
// pass then exercises findMentionWindows on that reconstructed list.

function buildTimestamps(words) {
  // words: [{ text, start }]  — we assume each word takes 0.5s
  const chars = [];
  const starts = [];
  const ends = [];
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    const start = w.start;
    const perChar = 0.5 / Math.max(1, w.text.length);
    for (let ci = 0; ci < w.text.length; ci++) {
      chars.push(w.text[ci]);
      starts.push(start + ci * perChar);
      ends.push(start + (ci + 1) * perChar);
    }
    if (wi < words.length - 1) {
      chars.push(" ");
      starts.push(start + 0.5);
      ends.push(start + 0.51);
    }
  }
  return {
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

test("word reconstruction groups characters into whitespace-separated words", () => {
  const ts = buildTimestamps([
    { text: "Alex", start: 1.0 },
    { text: "Garland", start: 1.6 },
    { text: "directs", start: 2.2 },
  ]);
  const words = wordsFromCharacterTimestamps(ts);
  assert.strictEqual(words.length, 3);
  assert.strictEqual(words[0].text, "Alex");
  assert.strictEqual(words[1].text, "Garland");
  assert.strictEqual(words[2].text, "directs");
  assert.ok(Math.abs(words[0].start - 1.0) < 0.01);
});

test("findMentionWindows matches a multi-word name in the narration", () => {
  const ts = buildTimestamps([
    { text: "Director", start: 0.5 },
    { text: "Alex", start: 1.1 },
    { text: "Garland", start: 1.7 },
    { text: "returns", start: 2.3 },
  ]);
  const words = wordsFromCharacterTimestamps(ts);
  const windows = findMentionWindows(words, "Alex Garland");
  assert.strictEqual(windows.length, 1);
  assert.ok(windows[0].start >= 1.0 && windows[0].start < 1.2);
  assert.ok(windows[0].end > 2.0 && windows[0].end < 2.3);
});

test("findMentionWindows ignores punctuation and case when matching", () => {
  const ts = buildTimestamps([
    { text: "Wait,", start: 0.0 },
    { text: "ALEX", start: 0.6 },
    { text: "garland!", start: 1.2 },
  ]);
  const words = wordsFromCharacterTimestamps(ts);
  const windows = findMentionWindows(words, "Alex Garland");
  assert.strictEqual(windows.length, 1);
});

test("findMentionWindows returns every occurrence, not just the first", () => {
  const ts = buildTimestamps([
    { text: "Cailee", start: 0.0 },
    { text: "Spaeny", start: 0.6 },
    { text: "stars", start: 1.2 },
    { text: "and", start: 1.8 },
    { text: "Cailee", start: 2.4 },
    { text: "Spaeny", start: 3.0 },
    { text: "ends", start: 3.6 },
  ]);
  const words = wordsFromCharacterTimestamps(ts);
  const windows = findMentionWindows(words, "Cailee Spaeny");
  assert.strictEqual(windows.length, 2);
  assert.ok(windows[0].start < windows[1].start);
});

test("findMentionWindows returns empty array when the name isn't spoken", () => {
  const ts = buildTimestamps([
    { text: "The", start: 0.0 },
    { text: "game", start: 0.6 },
    { text: "launched", start: 1.2 },
  ]);
  const words = wordsFromCharacterTimestamps(ts);
  const windows = findMentionWindows(words, "Ben Whishaw");
  assert.strictEqual(windows.length, 0);
});

test("findMentionWindows handles an empty or malformed name gracefully", () => {
  const ts = buildTimestamps([{ text: "hello", start: 0.0 }]);
  const words = wordsFromCharacterTimestamps(ts);
  assert.deepStrictEqual(findMentionWindows(words, ""), []);
  assert.deepStrictEqual(findMentionWindows(words, null), []);
  assert.deepStrictEqual(findMentionWindows(words, "   "), []);
});

test("wordsFromCharacterTimestamps returns empty on malformed input", () => {
  assert.deepStrictEqual(wordsFromCharacterTimestamps(null), []);
  assert.deepStrictEqual(wordsFromCharacterTimestamps({}), []);
  assert.deepStrictEqual(
    wordsFromCharacterTimestamps({ characters: "oops" }),
    [],
  );
});
