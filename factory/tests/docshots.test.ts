// Documentary footage is asked for sentence by sentence (29 Oct 2026 review: barely one shot in ten showed
// what the narrator said, because chapters only ever asked for footage by paragraph).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterSentences, docShotTargets } from "../src/pipeline.ts";

const moment = (show: string, extra: Record<string, unknown> = {}) => ({
  show,
  keywords: ["Vice City"],
  broll: "",
  graphic: { kind: "none", primary: "", secondary: "", items: [] },
  emphasis: "",
  person: "",
  ...extra,
});

test("a chapter's sentences are its own paragraphs', and every in-game sentence asks for its own shot", () => {
  const script = {
    beats: [
      { narration: "Welcome. This is the intro.", visual: { kind: "title" } },
      { narration: "Vice City launched in 2002. It sold well.", visual: { kind: "chapter" } },
      { narration: "Sam Houser led it. The office was in New York.", visual: { kind: "beat" } },
      { narration: "Then came San Andreas.", visual: { kind: "chapter" } },
    ],
  } as never;
  assert.deepEqual(chapterSentences(script, 0), [
    "Vice City launched in 2002.",
    "It sold well.",
    "Sam Houser led it.",
    "The office was in New York.",
  ]);
  const entry = {
    game_title: "Grand Theft Auto: Vice City",
    moments: [
      moment("the Vice City skyline at launch"),
      moment("sales chart"),
      moment("Sam Houser", { person: "Sam Houser", keywords: ["Sam Houser", "Rockstar"] }),
      moment("an office at night", { broll: "office at night" }),
    ],
  } as never;
  const t = docShotTargets(entry, chapterSentences(script, 0), 1);
  // The B-roll sentence is left to stock and photos.
  assert.deepEqual(t.map((x) => x.key), ["beat:1#m0", "beat:1#m1", "beat:1#m2"]);
  assert.match(t[0]!.text, /^Vice City launched in 2002\. \(show: the Vice City skyline at launch\)$/);
  // A named person leads the keywords after the game, once.
  assert.deepEqual(t[2]!.keywords, ["Grand Theft Auto: Vice City", "Sam Houser", "Rockstar"]);
});
