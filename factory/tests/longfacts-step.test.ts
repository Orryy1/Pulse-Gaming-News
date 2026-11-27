// LONG_FACT_DISCIPLINE through the long ranking step itself, with a fake model (no paid calls): the "every" title is
// counted before the fact-check reads it, the pre-check's named lines ride along with the one rewrite, and a blocker
// that survives the rewrite is cut as the last resort instead of failing the episode. Off, the same model run fails
// exactly as it did on 22-23 Nov ("fact-check still failing after a rewrite").
import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, type Services } from "../src/pipeline.ts";
import { getEpisode } from "../src/episodes.ts";
import { sentencesOf } from "../src/editorial/longform.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

const plan = {
  theme: "Zelda",
  title: "Every Zelda Game, Ranked",
  criterion: "How well each one plays today",
  intro: {
    narration:
      "A sword in a cave. Number one waits until the end, and one placement will start an argument.",
    on_screen: "Hyrule's best",
  },
  outro: {
    narration:
      "G1 wins because it plays best today. The top three are close. The hardest call was the middle.",
    on_screen: "G1 wins",
  },
  youtube: {
    title: "Every Zelda Game, Ranked",
    description:
      "Every Zelda game ranked from worst to best. Which one tops it?",
    tags: [],
    thumb_text: "NOT OCARINA?",
  },
  entries: [3, 2, 1].map((rank) => ({
    rank,
    game_title: `G${rank}`,
    steam_search_term: "",
    year: 2010,
    platforms: "Switch",
    verdict_chip: "Holds up",
    angle: "a",
  })),
};

const LINE = (rank: number) =>
  `Guards in G${rank} could see exactly what you did from any distance and through any wall in the castle.`;
const narration = (rank: number) =>
  `Number ${rank} is G${rank}, from 2010. It holds up well for its age and its size. ${LINE(rank)} It sits here for the story it tells and the way it ends.`;

const BLOCK = (rank: number) => ({
  severity: "blocker",
  // Most of the sentence but not 70% of it, after no clause joint: the line repair refuses it.
  quote: `Guards in G${rank} could see exactly what you did`,
  problem: `False: G${rank}'s guards have no such sight.`,
});

/** The fake model: the writer sites, and a fact-check that answers from a queue (each answer once). */
function services(
  db: Services["db"],
  cfg: Services["cfg"],
  checks: Array<Record<string, unknown>>,
) {
  const sites: Array<{ site: string; content: string; system: string }> = [];
  const llm = {
    async structured(o: Record<string, unknown>) {
      const content = String(o.content ?? "");
      sites.push({
        site: String(o.site),
        content,
        system: String(o.system ?? ""),
      });
      if (content.includes("YOUR DRAFT")) return { edits: [] };
      switch (o.site) {
        case "longform.plan":
          return plan;
        case "longform.write": {
          const rank = Number(content.match(/Write entry #(\d+)/)?.[1] ?? 1);
          return {
            year: 2010,
            narration: narration(rank),
            footage: { want: "gameplay", keywords: ["x"] },
            claims: [],
          };
        }
        case "longform.shots": {
          const n = (content.match(/^\d+\. /gm) ?? []).length;
          return {
            moments: Array.from({ length: n }, () => ({
              show: "the scene",
              keywords: ["scene"],
              graphic: { kind: "none", primary: "", secondary: "", items: [] },
              emphasis: "",
            })),
          };
        }
        case "factcheck.ranking":
          return (
            checks.shift() ?? { verdict: "pass", issues: [], summary: "ok" }
          );
        default:
          return {};
      }
    },
  };
  const s = {
    db,
    cfg,
    llm,
    now: () => new Date("2026-11-25T02:00:00Z"),
    notify: async () => true,
    findGame: async () => undefined,
    gameFacts: async () => undefined,
    research: async () => undefined,
  } as unknown as Services;
  return { s, sites };
}

async function run(discipline: boolean, failures = 2) {
  const db = await testDb();
  const data = await tmpDir();
  const cfg = testConfig(data, {
    longformEnabled: true,
    longFactDiscipline: discipline,
  });
  // Attempt 0 fails on G2's line; the rewrite still has it (the real failure mode); then any re-check passes.
  const fail = (rank: number) => ({
    verdict: "fail",
    issues: [BLOCK(rank)],
    summary: "a false mechanic",
  });
  const { s, sites } = services(
    db,
    cfg,
    Array.from({ length: failures }, () => fail(2)),
  );
  const topic = {
    theme: "Zelda",
    title_idea: "Every Zelda Game, Ranked",
    criterion: "c",
    format: "ranking",
  };
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, factcheck_json)
     VALUES ('ep_lf', 'longform:lf', 'selected', $1, 'longform', $2)`,
    [
      JSON.stringify({
        headline: "Zelda",
        items: [],
        sources: [],
        hash: "longform:lf",
        gameHint: "Zelda",
      }),
      JSON.stringify({ topic }),
    ],
  );
  await advance(s, (await getEpisode(db, "ep_lf"))!).catch(() => undefined);
  const ep = (await getEpisode(db, "ep_lf"))!;
  const events = await db.query<{
    kind: string;
    data: Record<string, unknown>;
  }>(
    `SELECT kind, detail AS data FROM events WHERE episode_id = 'ep_lf' ORDER BY id`,
  );
  return { db, ep, events, sites };
}

test("LONG_FACT_DISCIPLINE on: the blocker that survives the rewrite is cut and the ranking is scripted", async () => {
  const { db, ep, events, sites } = await run(true);
  try {
    assert.equal(ep.status, "scripted", ep.last_error ?? "");
    const script = ep.script_json as unknown as {
      youtube: { title: string; description: string };
      entries: Array<{ game_title: string; moments: unknown[] }>;
      beats: Array<{ narration: string }>;
    };
    // Rule (a): no complete list in the facts, so the title and description are counted.
    assert.equal(script.youtube.title, "3 Zelda Games, Ranked");
    assert.match(
      script.youtube.description,
      /^Each of these 3 Zelda games ranked/,
    );
    // The fact-check read the counted title, never the "Every" one.
    const checks = sites.filter((x) => x.site === "factcheck.ranking");
    assert.equal(
      checks.length,
      3,
      "attempt 0, the rewrite, the re-check after the cut",
    );
    assert.ok(checks.every((c) => !/YouTube title: Every/.test(c.content)));
    // The rewrite got the pre-check's named lines along with the fact-check's.
    const plans = sites.filter((x) => x.site === "longform.plan");
    assert.equal(plans.length, 2);
    assert.match(
      plans[1]!.content,
      /Pre-check: "Guards in G\d could see exactly what you did/,
    );
    assert.match(
      plans[1]!.content,
      /Fact-check: "Guards in G2 could see exactly what you did"/,
    );
    // The writers were given the discipline rules: the plan, each entry and the shot list.
    for (const site of ["longform.plan", "longform.write", "longform.shots"])
      assert.ok(
        sites
          .filter((x) => x.site === site)
          .every((x) =>
            /Fact discipline|A graphic shows only this game/.test(x.system),
          ),
        site,
      );
    assert.ok(
      plans.every((x) => !/what was weighed: sales, reviews/.test(x.system)),
      "no invented trust line asked for",
    );
    // G2's false line is gone; the other entries keep theirs; every entry still has one moment per sentence.
    const g2 = script.beats.find((b) => b.narration.startsWith("Number 2"))!;
    assert.doesNotMatch(g2.narration, /could see exactly/);
    assert.match(
      script.beats.find((b) => b.narration.startsWith("Number 3"))!.narration,
      /could see exactly/,
    );
    for (const [i, e] of script.entries.entries())
      assert.equal(
        e.moments.length,
        sentencesOf(script.beats[i]!.narration).length,
        e.game_title,
      );
    const repairs = events
      .filter((e) => e.kind === "fact_repair")
      .map((e) => e.data.outcome);
    assert.deepEqual(repairs, ["not_repairable", "repaired_by_cut"]);
    assert.ok(events.some((e) => e.kind === "long_precheck"));
  } finally {
    await db.close();
  }
});

test("LONG_FACT_DISCIPLINE off: the same run fails at the fact-check as before, with nothing new called or recorded", async () => {
  const { db, ep, events, sites } = await run(false);
  try {
    assert.notEqual(ep.status, "scripted");
    assert.match(
      ep.last_error ?? "",
      /fact-check still failing after a rewrite/,
    );
    assert.ok(!events.some((e) => e.kind === "long_precheck"));
    assert.ok(
      !events.some(
        (e) => e.kind === "fact_repair" && (e.data as { long?: boolean }).long,
      ),
    );
    assert.ok(sites.every((x) => !x.content.includes("Pre-check:")));
    assert.ok(
      sites.every(
        (x) =>
          !x.system.includes("Fact discipline") &&
          !x.system.includes("A graphic shows only this game"),
      ),
    );
    assert.equal(ep.status, "failed");
    assert.equal(sites.filter((x) => x.site === "factcheck.ranking").length, 2);
  } finally {
    await db.close();
  }
});

test("LONG_FACT_DISCIPLINE on: when the re-check after the cut still fails, the episode fails and nothing cut ships", async () => {
  // A checker that never passes: attempt 0, the rewrite and the re-check after the last-resort cut all fail.
  const { db, ep, events } = await run(true, 3);
  try {
    assert.equal(ep.status, "failed");
    assert.match(ep.last_error ?? "", /fact-check still failing after a rewrite/);
    const outcomes = events.filter((e) => e.kind === "fact_repair").map((e) => e.data.outcome);
    assert.deepEqual(outcomes, ["not_repairable", "cut_recheck_failed"]);
    assert.equal(ep.script_json, null);
  } finally {
    await db.close();
  }
});
