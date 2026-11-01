import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distinctAngles,
  shapedTitleSwap,
  titleAngle,
  titleShapeProblems,
  winningAngle,
} from "../src/editorial/titleshape.ts";
import { titleVariants } from "../src/editorial/titles.ts";
import { applyTitleShape, writerTitleProblems } from "../src/titlestep.ts";
import { goodScript, testDb } from "./helpers.ts";

test("Top N, years, leading counts and History of titles break the rule; the winning shapes pass", () => {
  assert.equal(titleShapeProblems("Top 10 GTA Games").length, 1);
  assert.match(titleShapeProblems("The Best Shooters of 2026")[0]!, /year/);
  assert.match(
    titleShapeProblems(
      "All 15 Halo Campaigns Ranked by How They Play Today",
    )[0]!,
    /count/,
  );
  assert.match(
    titleShapeProblems("The Complete History of Grand Theft Auto")[0]!,
    /History of/,
  );
  for (const ok of [
    "How Cyberpunk 2077 Saved Itself From Dying",
    "Why GTA 6 Took Thirteen Years",
    "The Halo That Never Was",
    "Every Halo Campaign Ranked, and Halo 3 Isn't Number One",
    "Skyrim: 15 Years Later",
  ])
    assert.deepEqual(titleShapeProblems(ok), [], ok);
  // A test that showed a year works lets it back in.
  assert.deepEqual(
    titleShapeProblems("Is The Witcher 3 Still Good in 2026", ["year"]),
    [],
  );
});

test("a title's angle is read from its words", () => {
  assert.equal(
    titleAngle("How Cyberpunk 2077 Saved Itself From Dying"),
    "comeback",
  );
  assert.equal(
    titleAngle("What Really Happened to Rockstar's Agent"),
    "hidden",
  );
  assert.equal(
    titleAngle("How Anthem Ended BioWare's Winning Streak"),
    "downfall",
  );
  assert.equal(titleAngle("Why GTA 6 Took Thirteen Years"), "why");
  assert.equal(
    titleAngle("Every Halo Campaign Ranked, and Halo 3 Isn't Number One"),
    "claim",
  );
  assert.equal(titleAngle("Every Halo Campaign Ranked Worst to Best"), "list");
  assert.equal(titleAngle("The Complete History of Doom"), "history");
  assert.equal(winningAngle("list"), false);
  assert.equal(winningAngle("comeback"), true);
});

test("the test keeps two alternatives of different angles from the current title and each other", () => {
  const out = distinctAngles("Why GTA 6 Took Thirteen Years", [
    { title: "Why Rockstar Needed Thirteen Years for GTA 6", angle: "why" },
    { title: "The GTA 6 Nobody Saw Before the Leak", angle: "hidden" },
    { title: "Top 5 Reasons GTA 6 Took So Long", angle: "claim" },
    {
      title: "How GTA Online's Money Nearly Ended Single-Player GTA",
      angle: "downfall",
    },
  ]);
  assert.deepEqual(
    out.map((x) => x.angle),
    ["hidden", "downfall"],
  );
});

test("a failing title gives way to a passing alternative; a passing one stays", () => {
  const swap = shapedTitleSwap("The Complete History of Halo", [
    "Halo's Lost Decade After Bungie",
    "Top 10 Halo Moments",
  ]);
  assert.equal(swap?.title, "Halo's Lost Decade After Bungie");
  assert.deepEqual(swap?.alternatives, [
    "The Complete History of Halo",
    "Top 10 Halo Moments",
  ]);
  assert.equal(
    shapedTitleSwap("Why GTA 6 Took Thirteen Years", ["Top 10"]),
    undefined,
  );
});

test("the writers get title feedback only for opinion formats and only with TITLE_SHAPES on", () => {
  const on = { titleShapes: true, titleShapeAllow: [] };
  assert.equal(writerTitleProblems(on, "Top 10 Resident Evil Games").length, 1);
  assert.equal(
    writerTitleProblems(on, "7 Big Games Out This Week", "release_radar")
      .length,
    0,
  );
  assert.equal(
    writerTitleProblems(on, "Is Skyrim Still Good in 2026", "still_good")
      .length,
    1,
  );
  assert.equal(
    writerTitleProblems(
      { ...on, titleShapes: false },
      "Top 10 Resident Evil Games",
    ).length,
    0,
  );
});

test("before upload a failing long title is replaced, logged and told to the owner; the failing one leaves the test", async () => {
  const db = await testDb();
  const script = goodScript();
  script.youtube.title = "The Complete History of Halo";
  script.youtube.title_variants = [
    "Halo's Lost Decade After Bungie",
    "Top 10 Halo Moments",
  ];
  const said: string[] = [];
  const changed = await applyTitleShape(
    {
      cfg: { titleShapes: true, titleShapeAllow: [] },
      db,
      notify: async (m) => void said.push(m.content),
    },
    { id: "ep_t" },
    script,
  );
  assert.equal(changed, true);
  assert.equal(script.youtube.title, "Halo's Lost Decade After Bungie");
  assert.deepEqual(script.youtube.title_variants, []);
  assert.match(said[0]!, /Title changed before upload/);
  const [ev] = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE episode_id = 'ep_t'`,
  );
  assert.equal(ev?.kind, "title_shaped");
  await db.close();
});

test("with angles on, three angle titles are asked for and two distinct ones kept", async () => {
  let system = "";
  const llm = {
    structured: async (o: { system: string }) => {
      system = o.system;
      return {
        titles: [
          {
            angle: "hidden",
            title: "What Really Happened to Halo After Bungie",
          },
          {
            angle: "downfall",
            title: "How Halo Lost Its Crown After Bungie Left",
          },
          { angle: "comeback", title: "Top 10 Halo Moments Ever" },
        ],
      };
    },
  } as never;
  const script = goodScript();
  script.youtube.title = "Why Halo Changed After Bungie";
  const out = await titleVariants(llm, script, { angles: true });
  assert.match(system, /three/);
  assert.deepEqual(out, [
    "What Really Happened to Halo After Bungie",
    "How Halo Lost Its Crown After Bungie Left",
  ]);
});
