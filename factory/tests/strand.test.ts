import { test } from "node:test";
import assert from "node:assert/strict";
import { testConfig, goodScript } from "./helpers.ts";
import {
  aboutFranchise,
  isStrandSlot,
  openOnOwnClip,
  rankForStrand,
  strandAngle,
  strandBrief,
  strandClip,
  strandEditorNote,
  strandFrom,
  strandProblem,
  strandProblems,
  strandSummary,
} from "../src/strand.ts";
import { redactedConfig } from "../src/config.ts";
import { seriesFor } from "../src/pipeline.ts";

const on = {
  strandName: "GTA 6, Checked",
  strandSlot: "17:00",
  strandFranchise: "GTA VI|GTA 6|Grand Theft Auto VI",
  newsSlots: ["13:00", "17:00"],
};

test("the strand is off by default and when any of its settings is missing", () => {
  const cfg = testConfig("/tmp/x");
  assert.equal(strandFrom(cfg), undefined);
  assert.equal(strandProblem(cfg), undefined, "never asked for: no complaint");
  assert.equal(strandSummary(cfg), "off");
  assert.equal(redactedConfig(cfg).strand, "off");
  assert.equal(strandFrom({ ...on, strandName: "" }), undefined);
  assert.equal(strandFrom({ ...on, strandFranchise: " | " }), undefined);
  assert.match(
    strandSummary({ ...on, strandName: "" }),
    /^off: STRAND_NAME is empty/,
  );
});

test("the strand never adds a slot: STRAND_SLOT has to be one of the news slots already", () => {
  const s = strandFrom(on);
  assert.deepEqual(s, {
    name: "GTA 6, Checked",
    slot: "17:00",
    franchise: "GTA VI",
    aliases: ["GTA VI", "GTA 6", "Grand Theft Auto VI"],
  });
  assert.equal(strandSummary(on), '"GTA 6, Checked" at 17:00 on GTA VI');
  const extra = { ...on, strandSlot: "20:00" };
  assert.equal(strandFrom(extra), undefined);
  assert.match(strandProblem(extra)!, /not one of NEWS_SLOTS \(13:00,17:00\)/);
  assert.match(strandProblem({ ...on, strandSlot: "5pm" })!, /not HH:MM/);
});

test("the strand's slot is matched on local wall-clock time", () => {
  const s = strandFrom(on)!;
  // 18 Nov 2026 is GMT, so London 17:00 is 17:00Z; New York is five hours behind.
  assert.equal(
    isStrandSlot(s, new Date("2026-11-18T17:00:00Z"), "Europe/London"),
    true,
  );
  assert.equal(
    isStrandSlot(s, new Date("2026-11-18T13:00:00Z"), "Europe/London"),
    false,
  );
  assert.equal(
    isStrandSlot(s, new Date("2026-11-18T22:00:00Z"), "America/New_York"),
    true,
  );
});

test("a story is the franchise's when it names it by any of its names, as whole words", () => {
  const s = strandFrom(on)!;
  assert.ok(
    aboutFranchise(s, "GTA 6 lets you lose the cops by changing clothes"),
  );
  assert.ok(aboutFranchise(s, "gta vi: the map is bigger than you think"));
  assert.ok(aboutFranchise(s, "Grand Theft Auto VI preload opens tonight"));
  assert.ok(
    aboutFranchise(s, "Rockstar's GTA6 trailer"),
    "spacing does not matter",
  );
  assert.ok(!aboutFranchise(s, "GTA 5 Enhanced gets a patch"));
  assert.ok(
    !aboutFranchise(s, "GTA 60 fps mod"),
    "a longer number is another thing",
  );
  assert.ok(!aboutFranchise(s, "Starfield expansion delayed"));
});

test("company numbers rank last, unless they answer a player's question", () => {
  assert.equal(
    strandAngle("Take-Two raises GTA 6 sales forecast"),
    "corporate",
  );
  assert.equal(
    strandAngle("GTA 6 pre-order record: Sensor Tower estimate"),
    "corporate",
  );
  assert.equal(
    strandAngle("Is it true GTA 6 sold 10 million copies on day one?"),
    "player",
  );
  assert.equal(
    strandAngle("GTA 6 police forget you if you change clothes"),
    "player",
  );
  assert.equal(strandAngle("Rockstar posts a new GTA 6 screenshot"), "neutral");
  const s = strandFrom(on)!;
  const stories = [
    "Take-Two raises GTA 6 sales forecast after record pre-orders",
    "Starfield second expansion delayed to early 2027",
    "Rockstar posts a new GTA 6 screenshot",
    "GTA 6 lets you lose the police by changing clothes",
    "GTA VI revenue passes $1 billion, analysts say",
  ];
  assert.deepEqual(
    rankForStrand(s, stories, (t) => t),
    [
      "GTA 6 lets you lose the police by changing clothes",
      "Rockstar posts a new GTA 6 screenshot",
      "Take-Two raises GTA 6 sales forecast after record pre-orders",
      "GTA VI revenue passes $1 billion, analysts say",
    ],
    "the franchise's stories only; player-facing first, company numbers last, each group in its old order",
  );
});

test("the writer's brief: one test, how-to or check; never an announcement; own footage and the long lane when they apply", () => {
  const base = strandBrief({
    name: "GTA 6, Checked",
    franchise: "GTA VI",
    ownFootage: false,
  });
  assert.match(base, /"GTA 6, Checked"/);
  assert.match(
    base,
    /one test, one how-to or one "is it true" check about GTA VI/,
  );
  assert.match(base, /what the player can do, or why the studio did it/);
  assert.match(base, /Never as an announcement/);
  assert.match(base, /Sales, forecasts, revenue/);
  assert.doesNotMatch(base, /own gameplay|60 to 75/);
  const own = strandBrief({
    name: "x",
    franchise: "GTA VI",
    ownFootage: true,
    longLane: true,
  });
  assert.match(own, /opens on the owner's own gameplay of GTA VI/);
  assert.match(own, /runs 60 to 75 seconds/);
  assert.ok(!/[—–]/.test(base + own), "no em or en dashes");
  assert.match(
    strandEditorNote(strandFrom(on)!),
    /sales, forecast and revenue stories last/,
  );
});

test("a strand hook or title that reads as an announcement is sent back", () => {
  assert.deepEqual(
    strandProblems(
      goodScript({
        hook: "Can you really lose GTA 6's cops by changing clothes?",
      }),
    ),
    [],
  );
  const bad = strandProblems(
    goodScript({
      hook: "Rockstar just announced a new GTA 6 feature.",
      youtube: {
        ...goodScript().youtube,
        title: "Rockstar Reveals GTA 6 Police",
      },
    }),
  );
  assert.equal(bad.length, 2);
  assert.match(bad[0]!, /hook reads as an announcement \("announced"\)/);
  assert.match(bad[1]!, /title reads as an announcement \("Reveals"\)/);
});

test("the strand opens on the owner's clip: it takes the hook and a trailer's hook moment goes back to the pool", () => {
  const s = strandFrom(on)!;
  const files = [
    { game: "Elden Ring", file: "a.mp4" },
    { game: "Grand Theft Auto VI", file: "b.mp4" },
  ];
  assert.equal(strandClip(s, files)?.file, "b.mp4");
  assert.equal(strandClip(s, files.slice(0, 1)), undefined);
  const clips = [
    { file: "trailer_hook.mp4", role: "hook" as const },
    { file: "trailer_beat.mp4", beatIndex: 0 },
  ];
  const out = openOnOwnClip<{
    file: string;
    role?: "hook";
    beatIndex?: number;
  }>(clips, {
    file: "own.mp4",
    beatIndex: 2,
  });
  assert.deepEqual(
    out.map((c) => [c.file, c.role, c.beatIndex]),
    [
      ["own.mp4", "hook", undefined],
      ["trailer_hook.mp4", undefined, undefined],
      ["trailer_beat.mp4", undefined, 0],
    ],
  );
});

test("a strand Short also joins the strand's own playlist; other Shorts are filed as before", () => {
  const cfg = testConfig("/tmp/x");
  const ep = (strand?: {
    name: string;
    franchise: string;
    ownFootage: boolean;
  }) =>
    ({
      lane: "news",
      story_hash: "h1",
      story_json: { headline: "x", items: [], ...(strand ? { strand } : {}) },
      script_json: goodScript(),
    }) as never;
  const titles = (e: never) =>
    seriesFor(cfg, e, new Date()).map((x) => x.title);
  assert.deepEqual(titles(ep()), ["Gaming News Today"]);
  assert.deepEqual(
    titles(
      ep({ name: "GTA 6, Checked", franchise: "GTA VI", ownFootage: true }),
    ),
    ["Gaming News Today", "GTA 6, Checked"],
  );
});
