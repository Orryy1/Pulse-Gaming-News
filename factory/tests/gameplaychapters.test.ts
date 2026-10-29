// Gameplay is downloaded from the chapter of a playthrough that the lines name, not its opening minutes
// (29 Oct 2026 review: every documentary gameplay clip came from the first five minutes of a video).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterFor, videoChapters } from "../src/assets/gameplay.ts";

const description = `Full playthrough, no commentary.
0:00 Intro
4:12 - The Party
19:40 Back Alley Brawl
1:02:03 Phnom Penh '86
1:30:10 Keep Your Friends Close (Final Mission)
Subscribe for more!`;

test("a description's chapter list is read in order, times in seconds", () => {
  assert.deepEqual(videoChapters(description), [
    { at: 0, title: "Intro" },
    { at: 252, title: "The Party" },
    { at: 1180, title: "Back Alley Brawl" },
    { at: 3723, title: "Phnom Penh '86" },
    { at: 5410, title: "Keep Your Friends Close (Final Mission)" },
  ]);
  // Two timestamps are not a chapter list.
  assert.deepEqual(videoChapters("0:00 Start\n2:00 End"), []);
});

test("the chapter the lines name is chosen; the game's own name never counts", () => {
  const ch = videoChapters(description);
  const pick = chapterFor(
    ch,
    [{ text: "In Phnom Penh, Tommy's past catches up (show: the Phnom Penh mission)", keywords: ["Vice City", "Phnom Penh"] }],
    "Grand Theft Auto: Vice City",
  );
  assert.equal(pick?.title, "Phnom Penh '86");
  assert.equal(
    chapterFor(ch, [{ text: "Vice City sold well.", keywords: ["Vice City"] }], "Grand Theft Auto: Vice City"),
    undefined,
  );
});
