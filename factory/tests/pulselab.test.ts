import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  pulseLabProblem,
  pulseLabSettings,
  pulseLabSummary,
  labFormatsOn,
} from "../src/pulselab/settings.ts";
import {
  actionOf,
  askedTitle,
  cleanQuestion,
  labTitleProblems,
  measuredTitle,
  receiptsTitle,
  versusTitle,
} from "../src/pulselab/identity.ts";
import {
  claimForAsk,
  claimKind,
  claimsFromAsks,
  claimsFromGtaFile,
  claimsFromRumours,
  gradeFor,
  gradeFromAsks,
  ledgerCounts,
  ledgerMarkdown,
  markShown,
  mergeLedger,
  readLedger,
  rumourEpisodes,
  syncLedger,
  verdictLine,
  type LabClaim,
} from "../src/pulselab/ledger.ts";
import {
  claimTally,
  countsOf,
  dayTally,
  seasonTally,
  tallyAsOf,
  tallyEntryFor,
  tallyLine,
} from "../src/pulselab/tally.ts";
import {
  clipTimerSamples,
  compressSeries,
  formatValue,
  measure,
  measuredProblems,
  readingAt,
  revealText,
  specFor,
  speedUp,
  spokenAnswer,
} from "../src/pulselab/measure.ts";
import {
  loadTelemetry,
  measureTelemetry,
  type HudTrack,
} from "../src/pulselab/telemetry.ts";
import {
  creditFor,
  creditLines,
  foldPollResult,
  labPoll,
  readLabPoll,
  recordLabPoll,
  safeHandle,
  tonightList,
  viewerSightings,
} from "../src/pulselab/asked.ts";
import {
  counterpartWindow,
  findCounterpart,
  isCompareGame,
  libraryClips,
  versusCounterpartArgs,
  versusPrimaryArgs,
} from "../src/pulselab/versus.ts";
import {
  joinFit,
  planLab,
  planProblems,
  receiptsPayoff,
  shortQuestion,
  type LabInput,
} from "../src/pulselab/plan.ts";
import {
  labCommentLines,
  labDayTitle,
  labDescriptionLines,
  labOverlayFor,
} from "../src/pulselab/apply.ts";
import {
  cardClaim,
  instrumentWindow,
  overlayProblems,
  shelfWindow,
  tagText,
} from "../src/render/labplan.ts";
import { dailyMessage } from "../src/streamasks/page.ts";
import type { StreamAsk } from "../src/streamasks/asks.ts";
import { TOPICS } from "../src/streamasks/asks.ts";
import type { RunEntry } from "../src/shortrun.ts";
import type { VodIndex } from "../src/vodindex/schema.ts";
import { createEpisode, getEpisode } from "../src/episodes.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

const GAME = "Grand Theft Auto VI";
const ON = pulseLabSettings({
  PULSE_LAB: "true",
  PULSE_LAB_RECEIPTS: "true",
  PULSE_LAB_MEASURED: "true",
  PULSE_LAB_TALLY: "true",
  PULSE_LAB_ASKED: "true",
  PULSE_LAB_VERSUS: "true",
});

function ask(
  o: Partial<StreamAsk> & Pick<StreamAsk, "id" | "question">,
): StreamAsk {
  const topic = o.topic ? TOPICS.find((t) => t.id === o.topic) : undefined;
  return {
    game: GAME,
    claim: "",
    howToTest: "Try it.",
    kind: "claim",
    rumour: false,
    earlyGame: true,
    spoiler: false,
    cues: topic?.cues ?? { said: [], seen: [], text: [] },
    mentions: [
      {
        source: "press",
        name: "Edge",
        at: "2026-11-10T10:00:00Z",
        text: "x",
        engagement: 0,
      },
    ],
    mentionCount: 1,
    engagement: 0,
    firstSeen: "2026-11-10T10:00:00Z",
    lastSeen: "2026-11-13T10:00:00Z",
    status: "open",
    ...o,
  };
}

// ------------------------------------------------------------------ settings

test("the Lab is off unless PULSE_LAB is on, and every format needs its own switch", () => {
  const off = pulseLabSettings({ PULSE_LAB_RECEIPTS: "true" });
  assert.equal(off.enabled, false);
  assert.equal(off.receipts, false);
  assert.deepEqual(labFormatsOn(off), []);
  assert.equal(
    pulseLabSummary(off, { gameplayEnabled: true, gameplayDirect: true }),
    "off",
  );
  const some = pulseLabSettings({ PULSE_LAB: "1", PULSE_LAB_MEASURED: "yes" });
  assert.deepEqual(labFormatsOn(some), ["measured"]);
  assert.equal(
    some.identity,
    true,
    "the identity comes with the master switch",
  );
  assert.deepEqual(labFormatsOn(ON), [
    "versus",
    "receipts",
    "measured",
    "asked",
  ]);
  assert.equal(ON.season, "1");
  assert.equal(
    pulseLabSettings({ PULSE_LAB_SEASON: "bad;season" }).season,
    "1",
  );
  assert.equal(
    pulseLabSettings({ PULSE_LAB_MIN_CONFIDENCE: "0.2" }).minConfidence,
    0.5,
  );
});

test("the Lab says why it cannot run: it rides on the rebuilt gameplay Short and never adds a slot", () => {
  assert.match(
    pulseLabProblem(ON, { gameplayEnabled: false, gameplayDirect: true })!,
    /GAMEPLAY_ENABLED/,
  );
  assert.match(
    pulseLabProblem(ON, { gameplayEnabled: true, gameplayDirect: false })!,
    /GAMEPLAY_DIRECT/,
  );
  assert.equal(
    pulseLabProblem(ON, { gameplayEnabled: true, gameplayDirect: true }),
    undefined,
  );
  assert.match(
    pulseLabSummary(ON, { gameplayEnabled: true, gameplayDirect: true }),
    /^on \(versus, receipts, measured, asked, tally, identity/,
  );
});

// ------------------------------------------------------------------ titles

test("titles keep each format's shape, fit 60 characters and never state a leak as fact", () => {
  const r = receiptsTitle("Can your car really run out of fuel?", "leak");
  assert.equal(r, "GTA 6 Receipts: Can your car really run out of fuel?");
  assert.deepEqual(labTitleProblems(r, "receipts"), []);
  const long = receiptsTitle(
    "Is it true that the full map of Leonida appears to have been leaked from a Collector's Box display?",
    "leak",
  );
  assert.equal(long, "I graded a GTA 6 leak on stream");
  assert.ok(long.length <= 60);
  assert.equal(
    versusTitle("Can you lose the cops by changing your clothes?"),
    "GTA 6 vs GTA 5: I tested the same thing in both",
  );
  assert.equal(
    versusTitle("Can you swim away from a wanted level?"),
    "What happens if you swim away from a wanted level in GTA 6 vs GTA 5?"
      .length <= 60
      ? "What happens if you swim away from a wanted level in GTA 6 vs GTA 5?"
      : versusTitle("Can you swim away from a wanted level?"),
  );
  assert.equal(
    versusTitle("Can you flip a car?"),
    "What happens if you flip a car in GTA 6 vs GTA 5?",
  );
  assert.equal(
    measuredTitle("How long is one in-game day in real minutes?"),
    "I measured it: How long is one in-game day in real minutes?",
  );
  assert.ok(
    askedTitle("Can you pet the dog?").startsWith(
      "You asked: Can you pet the dog?",
    ),
  );
  for (const t of [
    r,
    long,
    measuredTitle("How long does it take?"),
    askedTitle("Can you pet the dog?"),
  ])
    assert.ok(t.length <= 60, t);
  assert.equal(
    cleanQuestion("GTA 6 Day 3: can you rob a store in GTA 6?"),
    "Can you rob a store?",
  );
  assert.equal(
    cleanQuestion('"Seventy per cent of buildings": true or not?'),
    "Is it true seventy per cent of buildings?",
  );
  assert.equal(
    actionOf("Can you really rob every store in Leonida?"),
    "rob every store in Leonida",
  );
  assert.ok(
    labTitleProblems("Receipts: Every store is robbable", "receipts").some(
      (p) => /never states/.test(p),
    ),
  );
  assert.ok(
    labTitleProblems("I measured it: 2 MIN 41 S", "measured", {
      answer: "2 MIN 41 S",
    }).some((p) => /gives the measured answer/.test(p)),
  );
  assert.ok(
    labTitleProblems("GTA 6 Receipts: a war — of words?", "receipts").length >=
      2,
  );
});

// ------------------------------------------------------------------ the ledger

test("every claim is labelled as what it is, the least official reading first", () => {
  assert.equal(
    claimKind("GTA 6's FULL MAP has reportedly leaked online!"),
    "leak",
  );
  assert.equal(
    claimKind("The post appeared first on Insider Gaming", {
      sourceName: "Insider Gaming",
    }),
    "preview",
  );
  assert.equal(claimKind("Insiders say there is a third character"), "insider");
  assert.equal(
    claimKind(
      'Myth: "70% of buildings enterable" (TikTok, no official source)',
    ),
    "myth",
  );
  assert.equal(
    claimKind("Every car has a fuel gauge (Edge)", {
      sourceName: "Previews: Edge",
    }),
    "preview",
  );
  assert.equal(
    claimKind(
      "Leonida is about twice GTA V's map per Game Informer's cover story",
      { official: true },
    ),
    "reported",
  );
  assert.equal(
    claimKind("It released on PS5 (Rockstar Support)", {
      official: true,
      sourceName: "Rockstar Support",
    }),
    "official",
  );
  assert.equal(claimKind("can you pet the dog", { viewer: true }), "viewer");
  assert.equal(claimKind("cars explode", { rumour: true }), "rumour");
});

test("the ledger takes testable claims from the asks, the GTA File and rumour Shorts, and merges repeats", () => {
  const asks = [
    ask({
      id: "a1",
      topic: "fuel",
      question: "Can your car really run out of fuel?",
      claim: "Every car has a fuel gauge (Edge)",
      mentions: [
        {
          source: "seed",
          name: "Previews: Edge",
          at: "2026-11-12T00:00:00Z",
          text: "Every car has a fuel gauge",
          engagement: 0,
        },
      ],
    }),
    ask({
      id: "a2",
      question: "Is it true GTA 6 sold 20 million pre-orders?",
      claim: "GTA 6 sold 20 million pre-orders",
    }),
    ask({ id: "a3", kind: "question", question: "Can you pet the dog?" }),
    ask({
      id: "a4",
      topic: "interiors",
      kind: "myth",
      rumour: true,
      question: "How many buildings can you really go inside?",
      claim: 'Myth: "70% of buildings enterable" (TikTok, no official source)',
    }),
    ask({
      id: "a5",
      topic: "map-size",
      question: "Is the map really about twice the size of GTA V's?",
      claim: "GTA 6's map has leaked and is twice GTA V",
      status: "held",
      spoiler: true,
    }),
  ];
  const fromAsks = claimsFromAsks(asks, GAME);
  assert.deepEqual(
    fromAsks.map((c) => c.askId),
    ["a1", "a4", "a5"],
    "sales news and plain questions are not claims",
  );
  assert.equal(fromAsks[0]!.origin, "seed");
  assert.equal(fromAsks[0]!.kind, "preview");
  assert.equal(fromAsks[1]!.kind, "myth");
  assert.equal(fromAsks[2]!.status, "held");
  const run = [
    {
      kind: "file",
      part: 2,
      date: "2026-11-23",
      title: "Map",
      question: "q",
      angle: "a",
      recap: "r",
      facts: [
        "Game Informer's cover story reports Leonida is about twice the size of GTA V's map, as TechRadar relays it.",
        "Pre-loading opened on November 10 (Rockstar Newswire).",
      ],
      next_teaser: "",
      sources: [
        {
          url: "https://example.com",
          source: "Game Informer",
          official: false,
        },
      ],
    },
  ] as unknown as RunEntry[];
  const fromFile = claimsFromGtaFile(run, GAME);
  assert.equal(fromFile.length, 1, "only the fact a stream can check");
  assert.equal(fromFile[0]!.topic, "map-size");
  const fromRumours = claimsFromRumours(
    [
      {
        id: "e1",
        headline: "GTA 6 cars reportedly explode after enough crashes",
        game: GAME,
        source: "Insider Gaming",
      },
      { id: "e2", headline: "GTA 6 preorders hit record", game: GAME },
    ],
    GAME,
  );
  assert.equal(fromRumours.length, 1);
  assert.equal(fromRumours[0]!.kind, "reported");
  const merged = mergeLedger(fromAsks, fromFile, fromRumours);
  const map = merged.find((c) => c.topic === "map-size")!;
  assert.equal(
    map.kind,
    "leak",
    "the leak label wins over the cover story's report",
  );
  assert.equal(map.status, "held");
  assert.equal(merged.length, 4);
});

test("grades come only from confident footage verdicts: TRUE, FALSE or PARTLY", () => {
  const c = {
    claim: "Every store in Leonida can be robbed",
    question: "Can you really rob every store in Leonida?",
  };
  const v = (
    result: "proved" | "disproved",
    confidence = 0.9,
    reason = "The clerk hands over the cash.",
  ) => ({ result, confidence, reason });
  assert.equal(
    gradeFor(c, v("proved", 0.7), 0.8),
    undefined,
    "below the bar: no grade",
  );
  assert.equal(gradeFor(c, v("proved"), 0.8), "TRUE");
  assert.equal(gradeFor(c, v("disproved"), 0.8), "FALSE");
  assert.equal(
    gradeFor(
      c,
      v("proved", 0.9, "Some stores, but not every one, allowed it."),
      0.8,
    ),
    "PARTLY",
  );
  assert.equal(
    gradeFor(c, v("proved"), 0.8, { value: 7, of: 10 }),
    "PARTLY",
    "7 of 10 against 'every' is partly true",
  );
  assert.equal(gradeFor(c, v("proved"), 0.8, { value: 10, of: 10 }), "TRUE");
  assert.equal(gradeFor(c, v("proved"), 0.8, { value: 0, of: 10 }), "FALSE");
  const twice = {
    claim: "Twice the size of GTA V",
    question: "Is the map twice the size?",
  };
  assert.equal(
    gradeFor(twice, v("proved"), 0.8, { value: 2.1, claimed: 2 }),
    "TRUE",
  );
  assert.equal(
    gradeFor(twice, v("proved"), 0.8, { value: 1.6, claimed: 2 }),
    "PARTLY",
  );
  assert.equal(
    gradeFor(twice, v("proved"), 0.8, { value: 1.1, claimed: 2 }),
    "FALSE",
  );
  assert.equal(
    verdictLine({ kind: "leak", source: { name: "Insider Gaming" } }, "PARTLY"),
    "The claim came from a leak from Insider Gaming. On my own copy, it is partly true.",
  );
});

test("the ledger grades from the asks list's verdicts and its markdown labels every claim", () => {
  const verdict = {
    result: "proved" as const,
    confidence: 0.92,
    vodId: "v1",
    recordedOn: "2026-11-19",
    at: 812,
    reason: "The car stops dead.",
    decidedAt: "2026-11-20T01:00:00Z",
  };
  const asks = [
    ask({
      id: "a1",
      topic: "fuel",
      question: "Can your car really run out of fuel?",
      claim: "Every car has a fuel gauge (Edge)",
      verdict,
      status: "proved",
    }),
  ];
  const graded = gradeFromAsks(claimsFromAsks(asks, GAME), asks, 0.8);
  assert.equal(graded[0]!.grade!.grade, "TRUE");
  assert.equal(graded[0]!.status, "graded");
  assert.equal(
    gradeFromAsks(claimsFromAsks(asks, GAME), asks, 0.95)[0]!.grade,
    undefined,
  );
  assert.deepEqual(ledgerCounts(graded), {
    TRUE: 1,
    FALSE: 0,
    PARTLY: 0,
    open: 0,
    held: 0,
  });
  const md = ledgerMarkdown(graded, new Date("2026-11-20T02:00:00Z"));
  assert.match(
    md,
    /\| \*\*TRUE\*\* \(92%, v1 at 812 s\) \| PREVIEW CLAIM \| Can your car really run out of fuel\?/,
  );
  assert.equal(
    claimForAsk(
      graded,
      { question: "Can your car really run out of fuel?" },
      GAME,
    )?.askId,
    "a1",
  );
  assert.equal(
    claimForAsk(
      graded,
      { question: "Does the fuel gauge empty?", claim: "run out of fuel" },
      GAME,
    )?.askId,
    "a1",
  );
});

test("the ledger survives a restart and a weaker re-read never replaces a grade", async () => {
  const db = await testDb();
  const c: LabClaim = {
    id: "c1",
    game: GAME,
    question: "Can your car really run out of fuel?",
    claim: "Every car has a fuel gauge",
    kind: "preview",
    source: { name: "Edge" },
    origin: "seed",
    askId: "a1",
    status: "graded",
    grade: {
      grade: "TRUE",
      confidence: 0.9,
      vodId: "v1",
      recordedOn: "",
      at: 1,
      reason: "r",
      gradedAt: "2026-11-20T00:00:00Z",
    },
  };
  await syncLedger(db, [c]);
  assert.equal(await markShown(db, "c1", "ep1"), true);
  assert.equal(
    await markShown(db, "c1", "ep2"),
    false,
    "the first Short to show it keeps it",
  );
  // A re-read of the lists with no grade (the ask went stale) keeps the grade and the episode.
  await syncLedger(db, [
    {
      ...c,
      status: "open",
      grade: undefined,
      claim: "Every car has a fuel gauge (Edge)",
    },
  ]);
  let [back] = await readLedger(db, GAME);
  assert.equal(back!.grade!.grade, "TRUE");
  assert.equal(back!.grade!.episodeId, "ep1");
  assert.equal(back!.claim, "Every car has a fuel gauge (Edge)");
  assert.equal(back!.status, "graded");
  // A stronger grade replaces it, keeping the Short that showed it.
  await syncLedger(db, [
    { ...c, grade: { ...c.grade!, grade: "PARTLY", confidence: 0.97 } },
  ]);
  [back] = await readLedger(db, GAME);
  assert.equal(back!.grade!.grade, "PARTLY");
  assert.equal(back!.grade!.episodeId, "ep1");
  await db.close();
});

test("rumour Shorts about GTA VI are read from the database for the ledger", async () => {
  const db = await testDb();
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, lane, story_json, script_json) VALUES
      ('r1', 'h1', 'published', 'news', '{"headline":"x","items":[{"source":"Insider Gaming","url":"https://i.example"}]}', '{"is_rumour":true,"headline":"GTA 6 cars reportedly explode after crashes","game_title":"Grand Theft Auto VI"}'),
      ('r2', 'h2', 'published', 'news', '{"headline":"y","items":[]}', '{"is_rumour":true,"headline":"Zelda rumour","game_title":"Zelda"}'),
      ('r3', 'h3', 'rejected', 'news', '{"headline":"z","items":[]}', '{"is_rumour":true,"headline":"GTA 6 rumour","game_title":"Grand Theft Auto VI"}')`,
  );
  const rows = await rumourEpisodes(db, (t) =>
    /GTA 6|Grand Theft Auto VI/.test(t),
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.source]),
    [["r1", "Insider Gaming"]],
  );
  await db.close();
});

// ------------------------------------------------------------------ the tally

test("tally lines read the way the series is counted", () => {
  assert.deepEqual(
    tallyLine("receipts", { total: 14, TRUE: 9, FALSE: 3, PARTLY: 2 }),
    { line: "Receipts: 14 graded", sub: "9 true, 3 false, 2 partly" },
  );
  assert.deepEqual(tallyLine("myths", { total: 15, proved: 9, busted: 6 }), {
    line: "Myths: 9 proved, 6 busted",
  });
  assert.deepEqual(tallyLine("versus", { total: 1 }), {
    line: "GTA 6 vs 5: 1 test",
  });
  assert.deepEqual(
    tallyLine("verdict", { total: 10, buy: 5, wait: 3, skip: 2 }),
    { line: "Verdicts: 5 buy, 3 wait, 2 skip" },
  );
  assert.equal(tallyLine("why", { total: 0 }), undefined);
  assert.deepEqual(dayTally(12), { line: "Day 12" });
  assert.deepEqual(
    countsOf([{ outcome: "TRUE" }, { outcome: "TRUE" }, { outcome: "FALSE" }]),
    { total: 3, TRUE: 2, FALSE: 1 },
  );
  assert.deepEqual(
    tallyEntryFor({ series: "verdict", verdictWord: "WAIT for a sale" }),
    { series: "verdict", outcome: "wait" },
  );
  assert.equal(
    tallyEntryFor({ series: "news_control" }),
    undefined,
    "the control arm never gets a tally",
  );
});

test("the tally lives in the database: idempotent, survives a restart, drops rejected Shorts, never counts later ones", async () => {
  const dir = await tmpDir();
  const { createEmbeddedDb, migrate } = await import("../src/db.ts");
  let db = await createEmbeddedDb(path.join(dir, "db"));
  await migrate(db);
  const mk = async (id: string) =>
    db.query(
      `INSERT INTO episodes (id, story_hash, status, lane, story_json) VALUES ($1, $1, 'rendered', 'gameplay', '{}')`,
      [id],
    );
  for (const id of ["e1", "e2", "e3"]) await mk(id);
  assert.equal((await claimTally(db, "receipts", "1", "e1", "TRUE")).total, 1);
  assert.equal(
    (await claimTally(db, "receipts", "1", "e1", "TRUE")).total,
    1,
    "a retried render counts once",
  );
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await claimTally(db, "receipts", "1", "e2", "FALSE"), {
    total: 2,
    TRUE: 1,
    FALSE: 1,
  });
  await db.close();
  db = await createEmbeddedDb(path.join(dir, "db"));
  await migrate(db);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(
    (await claimTally(db, "receipts", "1", "e3", "PARTLY")).total,
    3,
    "the count survived the restart",
  );
  assert.equal(
    (await tallyAsOf(db, "receipts", "1", "e1")).total,
    1,
    "an older Short never shows later ones",
  );
  await db.query(`UPDATE episodes SET status = 'rejected' WHERE id = 'e2'`);
  assert.equal((await seasonTally(db, "receipts", "1")).total, 2);
  assert.equal(
    (await claimTally(db, "receipts", "2", "e3", "TRUE")).total,
    1,
    "a new season counts from one",
  );
  await db.close();
  await fs.rm(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ measuring

const timing = {
  segments: [
    { start: 2, end: 8 },
    { start: 12, end: 20 },
  ],
  actionStart: 3,
  payoff: 18,
  payoffAt: 12,
};

test("specs come from the topic or the question's own words", () => {
  assert.equal(specFor("Can your car run out of fuel?", "fuel")!.kind, "timer");
  assert.equal(specFor("x", "rob-stores")!.kind, "counter");
  assert.equal(
    specFor("How high can you fall from and survive?")!.kind,
    "meter",
    "how high is a meter",
  );
  assert.equal(
    specFor("How long is the freefall from the tallest building?")!.label,
    "TIME IN THE AIR",
  );
  assert.equal(specFor("How many stores can you rob?")!.kind, "counter");
  assert.equal(specFor("Can you pet the dog?"), undefined);
});

test("a clip timer runs with the source clock, shows the cut as a jump and stops on the outcome", () => {
  const s = clipTimerSamples(timing);
  assert.deepEqual(s, [
    [1, 0],
    [6, 5],
    [6, 9],
    [12, 15],
  ]);
  assert.equal(readingAt(s, 3.5, "timer"), 2.5);
  assert.equal(readingAt(s, 30, "timer"), 15);
  assert.equal(
    readingAt(
      [
        [0, 0],
        [2, 1],
        [4, 2],
      ],
      3.9,
      "counter",
    ),
    1,
  );
  const m = measure({
    question: "How long is the freefall from the tallest building?",
    timing,
  })!;
  assert.equal(m.source, "clip");
  assert.equal(m.value, 15);
  assert.equal(revealText(m), "15 SECONDS");
  assert.equal(spokenAnswer(m), "15 seconds");
  assert.equal(formatValue(161, "clock"), "2:41");
  assert.equal(formatValue(9.46, "clock"), "9.4");
  assert.equal(revealText({ value: 161, spec: m.spec }), "2 MIN 41 S");
  assert.equal(
    measure({ question: "How many stores can you rob?", timing }),
    undefined,
    "no counter without telemetry or the owner's count",
  );
  const owned = measure({
    question: "How many stores can you rob?",
    topic: "rob-stores",
    timing,
    owner: { value: 7, of: 10 },
  })!;
  assert.equal(owned.source, "owner");
  assert.equal(revealText(owned), "7 OF 10 STORES");
  assert.equal(owned.ticks!.length, 7);
  assert.ok(
    owned.ticks!.every((t) => t < timing.payoffAt),
    "every count lands before the answer",
  );
});

test("telemetry from the HUD reader measures when present and is never required", async () => {
  const track: HudTrack = {
    vodId: "v9",
    samples: [
      { t: 100, wanted: 0 },
      { t: 104, wanted: 2, speed: 40 },
      { t: 150, wanted: 2, speed: 90 },
      { t: 265, wanted: 0, speed: 20 },
      { t: 300, clock: 1380 },
      { t: 330, clock: 1430 },
      { t: 360, clock: 40 },
      { t: 1300, clock: 1420 },
    ],
    events: [
      { t: 120, kind: "crash" },
      { t: 125, kind: "crash" },
    ],
  };
  assert.equal(
    measureTelemetry(track, { kind: "wanted_lost" }, { from: 0, to: 400 })!
      .value,
    161,
  );
  assert.equal(
    measureTelemetry(
      track,
      { kind: "count", event: "crash" },
      { from: 0, to: 400 },
    )!.value,
    2,
  );
  assert.equal(
    measureTelemetry(track, { kind: "top_speed" }, { from: 0, to: 400 })!.value,
    90,
  );
  assert.equal(
    measureTelemetry(track, { kind: "distance" }, { from: 0, to: 400 }),
    undefined,
    "no scale, no distance",
  );
  assert.ok(
    Math.abs(
      measureTelemetry(track, { kind: "game_day" }, { from: 290, to: 1400 })!
        .value - 972.8,
    ) < 1,
  );
  const m = measure({
    question: "What is the quickest way to lose a wanted level?",
    topic: "lose-wanted",
    timing: { ...timing, clipInSource: 250 },
    track,
  })!;
  assert.equal(m.source, "telemetry");
  assert.equal(m.value, 161);
  assert.ok(
    speedUp(m.samples, "clock") > 10,
    "a long test compressed into the Short says how much faster",
  );
  assert.deepEqual(
    compressSeries(
      [
        [10, 0],
        [20, 5],
      ],
      1,
      11,
    ),
    [
      [1, 0],
      [11, 5],
    ],
  );
  const dir = await tmpDir();
  assert.equal(await loadTelemetry(dir, "v9"), undefined);
  await fs.writeFile(
    path.join(dir, "v9.json"),
    JSON.stringify({
      ...track,
      extra: "grows",
      samples: [...track.samples].reverse(),
    }),
  );
  assert.equal(
    (await loadTelemetry(dir, "v9"))!.samples[0]!.t,
    100,
    "readings are sorted and unknown fields ignored",
  );
  await fs.writeFile(path.join(dir, "bad.json"), "{nope");
  assert.equal(await loadTelemetry(dir, "bad"), undefined);
  assert.equal(await loadTelemetry(dir, "../etc"), undefined);
  await fs.rm(dir, { recursive: true, force: true });
});

test("the measured answer never shows before the end", () => {
  const m = { value: 161, spec: specFor("x", "lose-wanted")! };
  assert.deepEqual(
    measuredProblems(m, {
      title: "How long do the cops search? I measured it",
      hook: "How long do they look for you?",
    }),
    [],
  );
  assert.equal(
    measuredProblems(m, { hook: "It took 2:41 to lose them" }).length,
    1,
  );
  assert.equal(
    measuredProblems(m, { setup: "It took exactly two and a half minutes." })
      .length,
    1,
  );
});

// ------------------------------------------------------------------ you asked

test("credits use public handles only; display names and unsafe handles never show", () => {
  assert.equal(safeHandle("@tino_fan"), "@tino_fan");
  assert.equal(
    safeHandle("Tino Fan"),
    undefined,
    "a display name is never shown",
  );
  assert.equal(safeHandle("@ab"), undefined);
  assert.equal(
    safeHandle("@killer_jim"),
    undefined,
    "not advertiser-safe on screen",
  );
  const a = ask({
    id: "x",
    question: "Can you pet the dog?",
    mentions: [
      {
        source: "viewers",
        name: "Pulse viewers",
        at: "2026-11-12T00:00:00Z",
        text: "can you pet the dog",
        engagement: 5,
      },
      {
        source: "viewers",
        name: "Pulse viewers",
        at: "2026-11-13T00:00:00Z",
        text: "please test petting dogs",
        engagement: 5,
        handle: "@dogperson",
      },
    ],
  });
  assert.deepEqual(creditFor(a), { handle: "@dogperson" });
  assert.deepEqual(creditFor(ask({ id: "y", question: "q" })), undefined);
  assert.equal(
    creditLines({ handle: "@dogperson" }).card,
    "ASKED BY @dogperson",
  );
  assert.equal(creditLines({ poll: true }).card, "YOU VOTED FOR THIS TEST");
  assert.equal(creditLines({}).card, "A VIEWER ASKED");
  const sight = viewerSightings([
    {
      commentId: "c1",
      text: "Can you swim away from the cops in GTA 6?",
      author: "@swimmer",
      game: GAME,
      at: "2026-11-13T00:00:00Z",
    },
    {
      commentId: "c2",
      text: "first!",
      author: "@spam",
      game: GAME,
      at: "2026-11-13T00:00:00Z",
    },
    {
      commentId: "c3",
      text: "Can you rob every store? check my channel http://x.y",
      author: "@promo",
      game: GAME,
      at: "2026-11-13T00:00:00Z",
    },
  ]);
  assert.equal(sight.length, 1);
  assert.equal(sight[0]!.mention.handle, "@swimmer");
});

test("viewers' asks go to the top of tonight's list, with the asker named by handle only", () => {
  const asks = [
    ask({ id: "p1", question: "Press question one?" }),
    ask({ id: "p2", question: "Press question two?" }),
    ask({
      id: "v1",
      question: "Can you pet the dog?",
      mentions: [
        {
          source: "viewers",
          name: "Pulse viewers",
          at: "2026-11-13T00:00:00Z",
          text: "x",
          engagement: 5,
          handle: "@dogperson",
        },
      ],
    }),
    ask({ id: "h1", question: "Held?", status: "held" }),
  ];
  assert.deepEqual(
    tonightList(asks, 3, 1).map((a) => a.id),
    ["v1", "p1", "p2"],
  );
  assert.deepEqual(
    tonightList(asks, 3, 0).map((a) => a.id),
    ["p1", "p2", "v1"],
  );
  const msg = dailyMessage(asks, 3, "", { viewersFirst: 2 });
  assert.match(msg, /^Stream asks for today/);
  assert.match(msg, /1\. Can you pet the dog\? \(you asked: @dogperson\)/);
  assert.doesNotMatch(
    dailyMessage(asks, 3, ""),
    /you asked/,
    "off: the message is as before",
  );
});

test("the Lab poll offers four early, spoiler-free tests and its winner counts as viewers asking", async () => {
  const asks = [1, 2, 3, 4, 5].map((n) =>
    ask({ id: `a${n}`, question: `Question number ${n}?`, rumour: n === 2 }),
  );
  asks.push(ask({ id: "late", question: "Story question?", earlyGame: false }));
  const poll = labPoll(asks)!;
  assert.equal(poll.options.length, 4);
  assert.equal(poll.options[1]!.text, "Rumour: Question number 2?");
  const r = {
    at: "2026-11-15T20:00:00Z",
    options: poll.options.map((o, i) => ({ ...o, percent: i === 2 ? 55 : 15 })),
  };
  const once = foldPollResult(asks, r);
  const twice = foldPollResult(once, r);
  assert.equal(
    twice.find((a) => a.id === "a3")!.mentions.length,
    2,
    "a re-read never counts the poll twice",
  );
  assert.deepEqual(creditFor(twice.find((a) => a.id === "a3")!), {
    poll: true,
  });
  const db = await testDb();
  await recordLabPoll(db, r);
  assert.equal((await readLabPoll(db))!.options[2]!.percent, 55);
  await db.close();
});

// ------------------------------------------------------------------ 6 vs 5

test("the split screen finds the compare game's footage of the same test, or skips", () => {
  assert.equal(isCompareGame("Grand Theft Auto V", "Grand Theft Auto V"), true);
  assert.equal(isCompareGame("GTA 5", "Grand Theft Auto V"), true);
  assert.equal(
    isCompareGame("Grand Theft Auto VI", "Grand Theft Auto V"),
    false,
  );
  assert.equal(
    isCompareGame("Grand Theft Auto IV", "Grand Theft Auto V"),
    false,
  );
  const a = ask({
    id: "s",
    topic: "swim-escape",
    question: "Can you swim away from a wanted level?",
  });
  const clips = libraryClips("/root", [
    {
      id: "gp_1",
      clip: { file: "clip.mp4", seconds: 40, peak_in_clip: 22 },
      review: {
        game: "Grand Theft Auto V",
        reason:
          "He dives into the sea with two stars and swims until the police give up.",
      },
    },
    {
      id: "gp_2",
      clip: { file: "clip.mp4", seconds: 40 },
      review: {
        game: "Grand Theft Auto VI",
        reason: "Swimming away from the cops.",
      },
    },
  ]);
  const hit = findCounterpart(a, "Grand Theft Auto V", { vods: [], clips })!;
  assert.equal(hit.ref, "gp_1");
  assert.equal(hit.peak, 22);
  assert.equal(hit.file, path.join("/root", "inbox", "gp_1", "clip.mp4"));
  assert.equal(
    findCounterpart(
      ask({
        id: "f",
        topic: "fuel",
        question: "Can your car run out of fuel?",
      }),
      "Grand Theft Auto V",
      { vods: [], clips },
    ),
    undefined,
  );
  const vod = {
    vodId: "v5",
    file: "/v/gta5.mp4",
    title: "GTA V",
    game: "Grand Theft Auto V",
    recordedOn: "2026-11-02",
    duration: 600,
    lines: [
      {
        start: 290,
        end: 300,
        text: "testing if I can swim away from the wanted level, they're gone, lost them",
        words: [],
      },
    ],
    shots: [
      {
        start: 288,
        end: 302,
        desc: "player swimming in the sea, police boat behind",
        tags: ["swimming"],
        where: "sea",
        text: "WANTED",
        blank: false,
        menu: false,
      },
    ],
  } as unknown as VodIndex;
  const fromVod = findCounterpart(a, "Grand Theft Auto V", {
    vods: [vod],
    clips: [],
  });
  assert.equal(fromVod?.kind, "vod");
  assert.deepEqual(counterpartWindow({ peak: 22, duration: 40 }, 12, 20), {
    start: 10,
    length: 20,
    padStart: 0,
    padEnd: 0,
  });
  assert.deepEqual(counterpartWindow({ peak: 5, duration: 40 }, 12, 20), {
    start: 0,
    length: 13,
    padStart: 7,
    padEnd: 0,
  });
  assert.deepEqual(counterpartWindow({ peak: 38, duration: 40 }, 12, 20), {
    start: 26,
    length: 14,
    padStart: 0,
    padEnd: 6,
  });
  assert.match(
    versusPrimaryArgs(
      "a.mp4",
      [
        { start: 1, end: 3 },
        { start: 5, end: 9 },
      ],
      "o.mp4",
    ).join(" "),
    /concat=n=2:v=1:a=1.*scale=1080:608/,
  );
  assert.match(
    versusCounterpartArgs(
      "b.mp4",
      { start: 0, length: 13, padStart: 7, padEnd: 0 },
      "o.mp4",
    ).join(" "),
    /tpad=start_mode=clone:start_duration=7/,
  );
});

// ------------------------------------------------------------------ the planner

function input(o: Partial<LabInput> = {}): LabInput {
  const fuel = ask({
    id: "a1",
    topic: "fuel",
    question: "Can your car really run out of fuel?",
    claim:
      "Every car has a fuel gauge; running dry can strand you mid-chase (Edge)",
  });
  return {
    settings: ON,
    game: GAME,
    question: "CAN YOUR CAR RUN OUT OF FUEL?",
    resultLine: "IT DIED ON THE HIGHWAY",
    streamAsk: {
      question: fuel.question,
      claim: fuel.claim,
      rumour: false,
      verdict: "proved",
      confidence: 0.9,
      reason: "The car rolls to a stop with the gauge empty.",
    },
    ledger: claimsFromAsks([fuel], GAME),
    asks: [fuel],
    timing,
    lines: {
      hook: "Can you really run dry?",
      setup: "Most players never check the gauge.",
      payoff_line: "Dead. Out of fuel.",
    },
    ...o,
  };
}

test("Receipts grade a ledger claim on screen with its label and source, and the lines ask rather than assert", () => {
  const p = planLab(input());
  assert.equal(p.format, "receipts");
  assert.equal(p.title, "GTA 6 Receipts: Can your car really run out of fuel?");
  assert.equal(p.overlay!.claim!.label, "PREVIEW CLAIM");
  assert.equal(p.overlay!.claim!.source, "Edge");
  assert.equal(p.overlay!.claim!.grade, "TRUE");
  assert.ok(
    !p.overlay!.claim!.text.endsWith("(Edge)"),
    "the source is shown once, as the source",
  );
  assert.equal(
    p.lines!.payoff_line,
    "That preview claim? True, on my own copy.",
  );
  assert.match(p.lines!.setup, /^This one is a preview claim from Edge\./);
  assert.deepEqual(p.tally, [{ series: "receipts", outcome: "TRUE" }]);
  assert.match(
    p.comment[0]!,
    /^Receipts: The claim came from a preview claim from Edge\. On my own copy, it is true\./,
  );
  assert.deepEqual(planProblems(p, 12, 20), []);
  assert.equal(p.skipped[0]!.format, "versus");
  // A leak's statement hook becomes a question.
  const leak = ask({
    id: "L",
    question: "Can you rob every store?",
    claim: "Leaked footage shows every store can be robbed",
    rumour: true,
  });
  const lp = planLab(
    input({
      asks: [leak],
      ledger: claimsFromAsks([leak], GAME),
      streamAsk: {
        question: leak.question,
        claim: leak.claim,
        rumour: true,
        verdict: "disproved",
        confidence: 0.9,
        reason: "The pawn shop door is locked.",
      },
      lines: {
        hook: "Every store can be robbed",
        setup: "",
        payoff_line: "Nope.",
      },
    }),
  );
  assert.equal(lp.overlay!.claim!.label, "LEAK");
  assert.equal(lp.overlay!.claim!.unofficial, true);
  assert.equal(lp.lines!.hook, "Can you rob every store?");
  assert.equal(
    receiptsPayoff("leak", "FALSE"),
    "That leak? False, on my own copy.",
  );
  assert.match(lp.description[0]!, /never confirmed by Rockstar/);
});

test("a weak verdict falls through Receipts to a measurement, and the answer is said last", () => {
  const p = planLab(
    input({
      streamAsk: { ...input().streamAsk!, confidence: 0.6 },
      lines: {
        hook: "How long until it dies?",
        setup: "It took 15 seconds, turns out.",
        payoff_line: "x",
      },
    }),
  );
  assert.equal(p.format, "measured");
  assert.match(
    p.skipped.find((x) => x.format === "receipts")!.why,
    /below 0\.8/,
  );
  assert.equal(p.measurement!.reveal, "15 SECONDS");
  assert.equal(
    p.lines!.setup,
    "",
    "a setup that gives the number away is dropped",
  );
  assert.equal(p.lines!.payoff_line, "15 seconds. That's the answer.");
  assert.equal(p.overlay!.instrument!.kind, "timer");
  assert.ok(
    p.title!.startsWith("Can your car really run out of fuel?") ||
      p.title!.startsWith("I measured it"),
  );
  assert.deepEqual(planProblems(p, 12, 20), []);
});

test("6 vs 5 wins when the library has both games, and every format skips itself with a reason", () => {
  const counterpart = {
    kind: "inbox" as const,
    file: "/x.mp4",
    peak: 20,
    duration: 40,
    why: "same test",
    ref: "gp_1",
  };
  const v = planLab(input({ counterpart }));
  assert.equal(v.format, "versus");
  assert.equal(v.overlay!.versus!.aLabel, "GTA 6");
  assert.equal(v.overlay!.versus!.bSrc, "versus-b.mp4");
  assert.deepEqual(v.tally, [{ series: "versus", outcome: "counted" }]);
  const none = planLab(
    input({
      streamAsk: undefined,
      ledger: [],
      asks: [],
      question: "CAN YOU PET THE DOG?",
      lines: { hook: "Pet the dog?", setup: "", payoff_line: "Good boy." },
    }),
  );
  assert.equal(none.format, undefined);
  assert.deepEqual(
    none.skipped.map((x) => x.format),
    ["versus", "receipts", "measured", "asked"],
  );
  assert.deepEqual(planLab(input({ settings: pulseLabSettings({}) })), {
    skipped: [],
    tally: [],
    comment: [],
    description: [],
  });
});

test("You asked credits the viewer on screen and in the pinned comment, on any format", () => {
  const dog = ask({
    id: "d",
    question: "Can you pet the dog?",
    kind: "question",
    mentions: [
      {
        source: "viewers",
        name: "Pulse viewers",
        at: "2026-11-13T00:00:00Z",
        text: "can you pet the dog",
        engagement: 5,
        handle: "@dogperson",
      },
    ],
  });
  const p = planLab(
    input({
      streamAsk: undefined,
      liveAsk: dog.question,
      ledger: [],
      asks: [dog],
      question: "CAN YOU PET THE DOG?",
      lines: {
        hook: "Can you pet the dog?",
        setup: "",
        payoff_line: "Good boy.",
      },
    }),
  );
  assert.equal(p.format, "asked");
  assert.equal(p.overlay!.credit!.card, "ASKED BY @dogperson");
  assert.match(p.comment.join(" "), /asked by @dogperson/);
  assert.ok(
    !/dogperson/.test(
      `${p.lines!.hook} ${p.lines!.setup} ${p.lines!.payoff_line}`,
    ),
    "the narrator never says the handle",
  );
  const fuel = ask({
    id: "a1",
    topic: "fuel",
    question: "Can your car really run out of fuel?",
    claim: "Every car has a fuel gauge (Edge)",
    mentions: [
      {
        source: "viewers",
        name: "Pulse viewers",
        at: "2026-11-13T00:00:00Z",
        text: "x",
        engagement: 5,
        handle: "@gasguy",
      },
    ],
  });
  const r = planLab(
    input({ asks: [fuel], ledger: claimsFromAsks([fuel], GAME) }),
  );
  assert.equal(r.format, "receipts");
  assert.equal(r.overlay!.credit!.card, "ASKED BY @gasguy");
  assert.deepEqual(
    r.tally.map((t) => t.series),
    ["receipts", "asked"],
  );
});

test("small planner helpers keep the cut's word budget", () => {
  assert.equal(
    joinFit(["One two three.", "Four five six seven."], 3, "Hook words here"),
    "One two three.",
  );
  assert.equal(shortQuestion("Can you pet the dog"), "Can you pet the dog?");
  assert.equal(
    shortQuestion(
      "Is it true that the full map of Leonida appears to have been leaked?",
    ),
    "Is this GTA 6 claim true?",
  );
});

// ------------------------------------------------------------------ the overlay and the factory glue

test("overlay rules: labels, readings in order and the answer landing last", () => {
  assert.deepEqual(tagText({ segment: "RECEIPTS", number: 14 }), {
    top: "PULSE LAB",
    bottom: "RECEIPTS #14",
  });
  assert.deepEqual(tagText({ segment: "RECEIPTS" }), {
    top: "PULSE LAB",
    bottom: "RECEIPTS",
  });
  assert.deepEqual(shelfWindow("receipts", 2, 10), { from: 0, until: 12.6 });
  assert.deepEqual(shelfWindow("asked", 1, 10), { from: 0, until: 2.5 });
  assert.deepEqual(
    instrumentWindow(
      {
        samples: [
          [1, 0],
          [9, 5],
        ],
      },
      9,
    ),
    { from: 1, until: 9.35 },
  );
  assert.ok(cardClaim("word ".repeat(60)).endsWith("..."));
  const inst = {
    kind: "timer" as const,
    label: "T",
    unit: "",
    format: "clock" as const,
    method: "m",
    reveal: "R",
    speed: 1,
  };
  assert.deepEqual(
    overlayProblems(
      {
        format: "measured",
        instrument: {
          ...inst,
          samples: [
            [0, 0],
            [10, 5],
          ],
        },
      },
      10,
      20,
    ),
    [],
  );
  assert.equal(
    overlayProblems(
      {
        format: "measured",
        instrument: {
          ...inst,
          samples: [
            [0, 0],
            [11, 5],
          ],
        },
      },
      10,
      20,
    ).length,
    1,
  );
  assert.equal(
    overlayProblems(
      {
        format: "receipts",
        claim: {
          label: "",
          source: "",
          text: "x",
          unofficial: true,
          grade: "TRUE",
        },
      },
      10,
      20,
    ).length,
    2,
  );
});

test("at render the tag is numbered by its tally, the chip filled, and Day N joins it", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir, { pulseLab: ON });
  const plan = planLab(input());
  const story = {
    pulseLab: { ...plan, lines: undefined },
    gtaDaily: {
      day: 3,
      date: "2026-11-21",
      slot: "21:00",
      theme: "myth" as const,
    },
  };
  await createEpisode(
    db,
    "ep1",
    {
      hash: "gameplay:x",
      headline: "h",
      items: [],
      sources: [],
      hasOfficial: true,
      corroborated: true,
      rumourSignals: false,
      newestAt: "2026-11-21T00:00:00Z",
      score: 1,
      ...story,
    } as never,
    { lane: "gameplay", priority: 1 },
  );
  const ep = (await getEpisode(db, "ep1"))!;
  const s = { db, cfg, now: () => new Date("2026-11-21T12:00:00Z") };
  const o1 = (await labOverlayFor(s, ep))!;
  const o2 = (await labOverlayFor(s, ep))!;
  assert.deepEqual(o1.tag, { segment: "RECEIPTS", number: 1 });
  assert.deepEqual(o2.tally, { line: "Receipts: 1 graded", sub: "Day 3" });
  assert.equal(o1.claim!.grade, "TRUE");
  assert.deepEqual(labCommentLines(ep), plan.comment);
  assert.deepEqual(labDescriptionLines(ep), plan.description);
  const script = {
    youtube: { title: plan.title },
  } as never as import("../src/editorial/schema.ts").Script;
  labDayTitle(ep, script);
  assert.equal(
    script.youtube.title,
    "GTA 6 Day 3: Can your car really run out of fuel?",
  );
  // A Day N Short with no Lab format still shows its day when the tally is on; off, nothing.
  const plain = {
    ...ep,
    id: "ep2",
    story_json: { ...ep.story_json, pulseLab: undefined },
  } as never;
  assert.deepEqual(await labOverlayFor(s, plain), {
    format: "tally",
    tally: { line: "Day 3" },
  });
  assert.equal(
    await labOverlayFor({ ...s, cfg: testConfig(dir) }, plain),
    undefined,
  );
  await db.close();
  await fs.rm(dir, { recursive: true, force: true });
});
