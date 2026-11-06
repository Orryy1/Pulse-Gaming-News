import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docCandidates,
  docPickLine,
  findPegs,
  gatherDocSignals,
  namesCandidate,
  pickBreakoutDoc,
  rankDocCandidates,
  scoreArc,
  scoreFame,
  scoreFreshness,
  scorePeg,
  topicFromScore,
  emptySignals,
  type DocCandidate,
} from "../src/docpick.ts";
import { demandOf, docDemandLookup } from "../src/docdemand.ts";
import { testDb } from "./helpers.ts";

const NOW = new Date("2026-11-01T12:00:00Z");
const cand = (
  subject: string,
  aliases = [subject],
  angle = "",
): DocCandidate => ({
  kind: "story",
  index: 0,
  subject,
  angle,
  aliases,
  steam: subject,
});

test("a collapse with a comeback outscores a collapse alone, which outscores no arc", () => {
  const full = scoreArc(
    "The launch was pulled from the store after the backlash, refunds followed, and the 2.0 update and expansion brought a redemption",
  );
  const fall = scoreArc(
    "The launch was pulled from the store after the backlash and refunds followed",
  );
  const none = scoreArc("Every game in the series in release order");
  assert.ok(full.score > fall.score, `${full.score} > ${fall.score}`);
  assert.ok(fall.score > none.score);
  assert.deepEqual(full.families.slice(0, 2), ["collapse", "comeback"]);
  assert.equal(none.score, 0);
});

test("a news peg is found by alias and kind, and fades over three weeks", () => {
  const c = cand("Cyberpunk 2077", ["Cyberpunk 2077", "CD Projekt"]);
  const pegs = findPegs(c, [
    {
      headline: "Cyberpunk 2077 gets update 2.3 with new cars",
      at: "2026-10-30T10:00:00Z",
    },
    { headline: "The Witcher 4 trailer lands", at: "2026-10-31T10:00:00Z" },
    {
      headline:
        "CD Projekt talks about Cyberpunk 2077 sales: 35 million copies",
      at: "2026-10-01T10:00:00Z",
    },
  ]);
  assert.equal(pegs.length, 2);
  assert.equal(pegs[0]!.kind, "update");
  assert.equal(pegs[1]!.kind, "sales");
  const fresh = scorePeg([pegs[0]!], NOW);
  const old = scorePeg([{ ...pegs[0]!, at: "2026-10-05T00:00:00Z" }], NOW);
  assert.ok(fresh > 0.7 && old < fresh, `${fresh} ${old}`);
  assert.equal(scorePeg([], NOW), 0);
});

test("a short acronym only matches in its own case, a name in any case", () => {
  assert.equal(
    namesCandidate("GTA 6 trailer three", { aliases: ["GTA"] }),
    true,
  );
  assert.equal(
    namesCandidate("a vegetable patch", { aliases: ["GTA"] }),
    false,
  );
  assert.equal(
    namesCandidate("no man's sky expedition", { aliases: ["No Man's Sky"] }),
    true,
  );
});

test("fame rises with the Steam fanbase and Pulse's own results", () => {
  const small = scoreFame({
    newsMentions: 2,
    arcText: "",
    pegs: [],
    steamReviews: 900,
  });
  const big = scoreFame({
    newsMentions: 40,
    arcText: "",
    pegs: [],
    steamReviews: 700_000,
    pulseViews: 2000,
    channelMedian: 300,
  });
  assert.ok(big > small + 0.3, `${big} ${small}`);
});

test("a topic the big channels already told well is less fresh, and close to a Pulse video less again", () => {
  const crowded = scoreFreshness(
    cand("Cyberpunk 2077"),
    emptySignals({ angle: "" }),
  );
  const open = scoreFreshness(cand("Fallout 76"), emptySignals({ angle: "" }));
  const near = scoreFreshness(cand("Fallout 76"), {
    ...emptySignals({ angle: "" }),
    relatedPulse: "Every Fallout Ranked",
  });
  assert.ok(open > crowded && open > near);
});

test("an earlier Pulse documentary on the subject is excluded, the rest ranked best first", () => {
  const a = cand(
    "Fallout 76",
    ["Fallout 76"],
    "the worst launch, the backlash, then the comeback with Wastelanders and a redemption",
  );
  const b = cand("Grand Theft Auto VI", ["GTA 6"], "delays and a leak");
  const signals = new Map([
    [
      "Fallout 76",
      {
        ...emptySignals(a),
        pegs: findPegs(a, [
          {
            headline: "Fallout 76 update adds a new region",
            at: "2026-10-31T00:00:00Z",
          },
        ]),
      },
    ],
    [
      "Grand Theft Auto VI",
      {
        ...emptySignals(b),
        newsMentions: 90,
        coveredByPulse: "Grand Theft Auto VI",
      },
    ],
  ]);
  const ranked = rankDocCandidates([b, a], signals, NOW);
  assert.equal(ranked[0]!.candidate.subject, "Fallout 76");
  assert.match(ranked[1]!.excluded ?? "", /already made/);
  const topic = topicFromScore(ranked[0]!);
  assert.equal(topic.kind, "story");
  assert.equal(topic.franchise, "Fallout 76");
  assert.match(topic.reason, /^Breakout pick/);
  assert.match(
    docPickLine(ranked[0]!, ranked[1]),
    /^Next documentary: Fallout 76 \(score [\d.]+: fame/,
  );
});

test("only the best candidates get the slow lookups, at most the limit", async () => {
  const cands = [
    cand("A one", ["A one"], "collapse backlash refunds comeback redemption"),
    cand("B two"),
    cand("C three"),
  ];
  const looked: string[] = [];
  const signals = await gatherDocSignals(cands, {
    headlines: [],
    videos: [],
    coveredSubjects: [],
    longTitles: [],
    steam: async (t) => {
      looked.push(t);
      return { reviews: 50_000 };
    },
    lookups: 1,
    now: NOW,
  });
  assert.deepEqual(looked, ["A one"]);
  assert.equal(signals.get("A one")!.steamReviews, 50_000);
  assert.equal(signals.get("B two")!.steamReviews, undefined);
});

test("the demand stub is unknown until the services carry the search page, then reads it", async () => {
  assert.equal(
    docDemandLookup({}, () => NOW),
    undefined,
  );
  const rows = [
    {
      videoId: "aaaaaaaaaaa",
      views: 900_000,
      channel: "x",
      title: "Fallout 76 in 2026 is wild",
    },
    {
      videoId: "bbbbbbbbbbb",
      views: 5_000_000,
      channel: "y",
      title: "A cooking video",
    },
  ];
  const lookup = docDemandLookup(
    { searchDemand: async () => rows },
    () => NOW,
  )!;
  const d = await lookup("Fallout 76");
  assert.equal(d?.views, 900_000);
  assert.equal(d?.level, "medium");
  assert.equal(demandOf("Fallout 76", [], NOW).level, "none");
});

test("the pick reads the database and skips a subject Pulse already made", async () => {
  const db = await testDb();
  const at = "2026-10-30T10:00:00Z";
  await db.query(
    `INSERT INTO cluster_sightings (hash, headline, first_seen, last_seen, item_count, has_official, max_score, cluster_json) VALUES ('h1', 'Fallout 76 update brings the biggest expansion yet', $1, $1, 3, true, 80, '{}'), ('h2', 'GTA 6 trailer 3 date', $1, $1, 9, true, 99, '{}')`,
    [at],
  );
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, factcheck_json, lane, created_at) VALUES ('ep1', 'doc1', 'published', '{"headline":"Why GTA 6 Took Thirteen Years"}', '{"doc":true,"topic":{"franchise":"Grand Theft Auto VI"}}', 'longform', $1)`,
    [at],
  );
  const pick = await pickBreakoutDoc({
    db,
    cfg: { docPickLookups: 3 },
    now: () => NOW,
    findGame: async () => undefined,
    gameFacts: async () => {
      throw new Error("not called");
    },
    research: async () => undefined,
  });
  assert.ok(pick);
  assert.notEqual(pick!.topic.franchise, "Grand Theft Auto VI");
  assert.ok(docCandidates().some((c) => c.subject === pick!.topic.franchise));
  assert.equal(
    (pick!.detail as { demand_check: string }).demand_check,
    "stub (unknown)",
  );
  await db.close();
});

test("a famous, pegged survey with no arc loses to a story with a fall and a return", () => {
  const survey: DocCandidate = { ...cand("Big Series"), kind: "franchise" };
  const story = cand("Comeback Game", ["Comeback Game"], "the launch backlash, refunds and a broken game, then the 2.0 update, the expansion and a redemption");
  const ranked = rankDocCandidates(
    [survey, story],
    new Map([
      ["Big Series", { ...emptySignals(survey), newsMentions: 99, steamReviews: 900_000, demand: { query: "x", views: 9e6, hits: 9, level: "high" as const, at: "" } }],
      ["Comeback Game", { ...emptySignals(story), newsMentions: 8, steamReviews: 90_000 }],
    ]),
    NOW,
  );
  assert.equal(ranked[0]!.candidate.subject, "Comeback Game");
});
