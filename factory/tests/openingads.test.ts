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

test("with no hook words the caption is the headline's subject, never a cut-off fragment", () => {
  // Short writers give no hook words, so from 14 to 27 Nov these came out as "TARGETS GTA'S", "ADDS 21", "TV KEEPS".
  const cases: [string, string, string][] = [
    ["The Witcher 4 targets GTA's leap", "The Witcher 4", "WITCHER 4"],
    ["Xbox adds 21 more PC classics", "", "XBOX"],
    ["God of War TV keeps Faye's actor", "God of War", "GOD OF WAR"],
    ["Why God of War Gave Kratos a Son", "God of War", "GOD OF WAR"],
    ["Garry's Mod at $4.99", "Garry's Mod", "GARRY'S MOD"],
    ["Bread & Fred is free on Epic", "Bread & Fred", "BREAD & FRED"],
    ["Ratchet & Clank Returns For PS6", "Ratchet & Clank", "RATCHET & CLANK"],
    ["Call of Duty 4's setting dispute", "Call of Duty 4: Modern Warfare", "CALL OF DUTY 4"],
    ["Zelda Leads US Physical Sales", "The Legend of Zelda", "ZELDA"],
    ["How Rockstar found CJ's voice", "Grand Theft Auto: San Andreas", "ROCKSTAR"],
    ["Anthem's Servers Shut Down For Good", "Anthem", "ANTHEM"],
    ["Hollow Knight Silksong: $20 Again", "Hollow Knight Silksong", "HOLLOW KNIGHT SILKSONG"],
    // The game's words wherever they stand, and in the forms headlines use.
    ["Who Killed Anthem", "Anthem", "ANTHEM"],
    ["I tried Elden Ring Nightreign", "Elden Ring Nightreign", "ELDEN RING NIGHTREIGN"],
    ["GTA 6 Radio Now Plays On Foot", "Grand Theft Auto VI", "GTA 6"],
    ["GTA 6's map goes beyond missions", "Grand Theft Auto VI", "GTA 6"],
    // A name too long whole gives a whole part of it, never a cut in its middle.
    ["Call of Duty Black Ops 7 Beta Dates", "Call of Duty: Black Ops 7", "BLACK OPS 7"],
    ["The Legend of Zelda Tears of the Kingdom tops charts", "The Legend of Zelda: Tears of the Kingdom", "TEARS OF THE KINGDOM"],
    ["Clair Obscur: Expedition 33 wins GOTY", "Clair Obscur: Expedition 33", "EXPEDITION 33"],
    // A stray number or short word earlier in the headline never beats the name.
    ["Take-Two says 6 million preorders for GTA 6", "Grand Theft Auto VI", "GTA 6"],
    ["Sony sold 2 million copies of Death Stranding 2", "Death Stranding 2", "DEATH STRANDING 2"],
    ["CD Projekt hires Call of Duty veteran", "Call of Duty: Black Ops 7", "CALL OF DUTY"],
    ["Dark days for Doom fans", "Doom: The Dark Ages", "DOOM"],
  ];
  for (const [headline, game, want] of cases)
    assert.equal(openingCaption({ headline, game }, 2), want, headline);
});

test("with no subject the footage opens with no words, never a fragment or a lone word", () => {
  for (const headline of [
    "A new Zelda is coming",
    "Your PS5 just got faster",
    "Players hate the new patch",
    "21 classics land on Game Pass",
    "$70 games are back, says Nintendo",
    "Nintendo Raises Prices in the US",
    "Six Years of Open-World Winners",
  ])
    assert.equal(openingCaption({ headline, game: "" }, 2), "", headline);
  // A short word shared with the game's name ("US" in The Last of Us) is not the game.
  assert.equal(openingCaption({ headline: "Nintendo leads US sales again", game: "The Last of Us Part II" }, 2), "NINTENDO");
});

test("a caption from hook words never runs past two; a headline that is only the name shows the name", () => {
  const c = openingCaption(
    { thumbText: "one two three four", headline: "", game: "" },
    5,
  );
  assert.equal(c.split(" ").length, 2);
  assert.equal(
    openingCaption({ headline: "The Witcher 4", game: "The Witcher 4" }, 2),
    "WITCHER 4",
  );
  assert.equal(openingCaption({ headline: "", game: "" }, 2), "");
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
