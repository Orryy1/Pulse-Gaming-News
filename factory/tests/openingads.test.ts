// Item 15's finish: one or two caption words over the footage opening, and the gate that fails a Short whose first
// seven seconds or cover frame shows a graphic kill (SHORT_OPEN_WORDS, SHORT_AD_SAFE_GATE).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adSafeGateProblems,
  coverProblem,
  openingCaption,
  type OpeningLook,
} from "../src/openingstep.ts";

const look = (over: Partial<OpeningLook> = {}): OpeningLook => ({
  gameplay: true,
  gore: false,
  nudity: false,
  weapon: false,
  shocking: false,
  strength: 7,
  ...over,
});

test("the opening caption is the writer's hook words, at most two", () => {
  assert.equal(
    openingCaption(
      { thumbText: "Delayed again to 2027", headline: "x", game: "GTA VI" },
      2,
    ),
    "DELAYED AGAIN",
  );
  assert.equal(
    openingCaption(
      { thumbText: "The servers are gone", headline: "x", game: "Anthem" },
      1,
    ),
    "SERVERS",
  );
});

test("with no hook words the caption comes from the headline, without the game's name", () => {
  assert.equal(
    openingCaption(
      { headline: "Anthem's Servers Shut Down For Good", game: "Anthem" },
      2,
    ),
    "SERVERS SHUT",
  );
  assert.equal(
    openingCaption(
      {
        headline: "Hollow Knight Silksong: $20 Again",
        game: "Hollow Knight Silksong",
      },
      2,
    ),
    "$20 AGAIN",
  );
});

test("a caption never runs past two words and may be empty", () => {
  const c = openingCaption(
    { thumbText: "one two three four", headline: "", game: "" },
    5,
  );
  assert.equal(c.split(" ").length, 2);
  assert.equal(
    openingCaption({ headline: "The Witcher 4", game: "The Witcher 4" }, 2),
    "",
  );
});

test("a graphic kill on the cover fails it; an unscreened cover claims nothing", () => {
  assert.equal(coverProblem(look()), undefined);
  assert.equal(coverProblem(look({ gore: true })), "gore or blood");
  assert.equal(coverProblem(undefined), undefined);
});

test("the gate fails an unreplaced shot in the window and a bad cover, not a replaced or unscreened one", () => {
  const problems = adSafeGateProblems(
    {
      replaced: [
        { shot: 2, problem: "gore or blood" },
        {
          shot: 3,
          problem: "a weapon aimed at the viewer",
          with: "assets/safe.jpg",
        },
        { shot: 4, problem: "not screened" },
      ],
    },
    look({ shocking: true }),
  );
  assert.deepEqual(problems, [
    "ad safety: shot 2 in the first 7 seconds shows gore or blood",
    "ad safety: the cover frame shows shocking imagery",
  ]);
  assert.deepEqual(adSafeGateProblems(undefined, look()), []);
});
