import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gateCandidates,
  premiseArmFor,
  premiseFlag,
} from "../src/editorial/premisegate.ts";
import { loadConfig } from "../src/config.ts";

// STORY_PREMISE_GATE (frontier check 25 Nov 2026): 7 of the 10 lowest-marked Shorts were "nothing known" or shopping
// stories. The headlines below are real Pulse Shorts from 26 Oct to 23 Nov.

test("flags real 'nothing known', price-list, patch-note and outage stories", () => {
  const cases: Array<[string, string]> = [
    [
      "Elder Scrolls 6 is officially Sentinel, still with no date",
      "nothing_known",
    ],
    ["GTA 6 PS5 graphics presets remain unconfirmed", "nothing_known"],
    ["GTA 6 New Zealand time trick unconfirmed", "nothing_known"],
    ["Is GTA 6 Pre-Order Worth It?", "price_list"],
    ["GTA 6 how much cash to carry? Standard costs $79.99", "price_list"],
    [
      "What GTA 6 bonus do you miss after November 19? The bonus cutoff explained",
      "price_list",
    ],
    ["GTA 6's reported 34-track album isn't the full soundtrack", "price_list"],
    ["Phantom Blade Zero Needs 300 GB Free Just to Pre-load", "price_list"],
    ["Helldivers 2 patch notes 1.4.2: every change", "patch_notes"],
    ["GTA Online servers down: PSN outage hits launch night", "outage"],
  ];
  for (const [h, kind] of cases) assert.equal(premiseFlag(h)?.kind, kind, h);
});

test("a conflict or surprise keeps the story, whatever else it is", () => {
  for (const h of [
    "Rockstar layoffs remain unconfirmed as union speaks out",
    "GTA VI PC recompilation project shut down by Take-Two",
    "Xbox raises the price of Game Pass Ultimate again",
    "Starfield second expansion delayed to early 2027",
    "Sony pulls Cyberpunk 2077 from the PlayStation Store",
    "GTA 6 is officially the biggest launch in PlayStation history",
    "Nintendo sues Palworld maker over patents",
  ])
    assert.equal(premiseFlag(h), undefined, h);
});

test("ordinary news passes", () => {
  for (const h of [
    "Tomb Raider's Atlantis remake holds February 12 in new trailer",
    "Kojima Returns in Cyberpunk: Edgerunners 2",
    "Hollow Knight Silksong Cherry Time and the Booklet Clue",
    "GTA 6 runs steadier on Series X than base PS5",
    "",
  ])
    assert.equal(premiseFlag(h), undefined, h);
});

test("the gate drops flagged candidates on its side only, and never empties a slot", () => {
  const list = [
    { headline: "Is GTA 6 Pre-Order Worth It?" },
    { headline: "Starfield second expansion delayed to early 2027" },
    { headline: "Elder Scrolls 6 still with no date" },
  ];
  const open = gateCandidates(list, "open");
  assert.deepEqual(open.kept, list);
  assert.equal(open.dropped.length, 0);

  const gate = gateCandidates(list, "gate");
  assert.deepEqual(
    gate.kept.map((c) => c.headline),
    ["Starfield second expansion delayed to early 2027"],
  );
  assert.deepEqual(
    gate.dropped.map((d) => d.kind),
    ["price_list", "nothing_known"],
  );
  assert.equal(gate.allFlagged, false);

  const weak = [list[0]!, list[2]!];
  const all = gateCandidates(weak, "gate");
  assert.deepEqual(all.kept, weak, "a slot with only weak stories keeps them");
  assert.equal(all.dropped.length, 0);
  assert.equal(all.allFlagged, true);
  assert.equal(gateCandidates([], "gate").allFlagged, false);
});

test("premiseArmFor splits by share; 0 is always open", () => {
  assert.equal(premiseArmFor(0.2, 0.5), "gate");
  assert.equal(premiseArmFor(0.7, 0.5), "open");
  assert.equal(premiseArmFor(0, 0), "open");
  assert.equal(premiseArmFor(0.99, 1), "gate");
});

test("STORY_PREMISE_GATE_SHARE defaults to 0 and is clamped", () => {
  const before = process.env.STORY_PREMISE_GATE_SHARE;
  const share = (v: string | undefined) => {
    if (v === undefined) delete process.env.STORY_PREMISE_GATE_SHARE;
    else process.env.STORY_PREMISE_GATE_SHARE = v;
    return loadConfig().storyPremiseGateShare;
  };
  try {
    assert.equal(share(undefined), 0);
    assert.equal(share("0.5"), 0.5);
    assert.equal(share("3"), 1);
    assert.equal(share("nope"), 0);
  } finally {
    share(before);
  }
});

// Code review, 26 Nov: strong stories the first patterns would have dropped.
test("price moves, edition reveals, falling numbers and big updates are not shopping or outages", () => {
  for (const h of [
    "Sony announces PS5 price hikes across Europe",
    "Xbox raises prices on Series X again",
    "Game Pass price increases hit UK today",
    "PS5 Pro price cut announced for Black Friday",
    "Valve reveals Steam Machine price",
    "Microsoft removes Xbox Series S edition",
    "Zelda Tears of the Kingdom Nintendo Switch 2 Edition revealed",
    "Red Dead Redemption 2 Definitive Edition announced for PS5",
    "GTA 6 cost $2 billion to make, report says",
    "Nintendo confirms Switch 2 bundle with Mario Kart World",
    "Concord player count is down 90% in a week",
    "Switch 2 sales are down in Japan",
    "Anthem servers are offline for good next month",
    "Cyberpunk 2077 update 2.0 overhauls the whole game",
    "Baldur's Gate 3 Patch 8 adds 12 new subclasses",
    "Silksong sales show no sign of slowing down",
  ])
    assert.equal(premiseFlag(h), undefined, h);
});

test("the narrowed patterns still catch the shopping and status stories", () => {
  const cases: Array<[string, string]> = [
    ["GTA 6 editions compared: which edition should you buy?", "price_list"],
    ["PSN is down: PlayStation Network having issues tonight", "outage"],
    ["Steam is down for maintenance", "outage"],
    ["Elden Ring Nightreign hotfix 1.02 is live", "patch_notes"],
    ["Still no sign of a Hollow Knight Silksong DLC trailer", "nothing_known"],
  ];
  for (const [h, kind] of cases) assert.equal(premiseFlag(h)?.kind, kind, h);
});
