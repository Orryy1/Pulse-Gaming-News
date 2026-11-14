// The series look (format plan, 11 Nov 2026, items 5, 7 and 8): the cover strip and part number, Buy, Wait or Skip,
// and the channel page. Every flag defaults off, and off changes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coverPrice,
  seriesCoverFor,
  seriesCoverOf,
  seriesEpisodeNumber,
  seriesTagOf,
} from "../src/seriescover.ts";
import { stripFontSize, stripText } from "../src/render/seriesstrip.ts";
import {
  atLowest,
  decideVerdict,
  dollars,
  euroPrice,
  narrationOfVerdict,
  reviewsShort,
  stampWord,
  validateVerdict,
  verdictBrief,
  verdictTitle,
  verdictToScript,
  type VerdictData,
  type VerdictDraft,
} from "../src/editorial/verdict.ts";
import { pickVerdict, verdictPool } from "../src/discovery/verdicts.ts";
import {
  recentVerdicts,
  stepScriptVerdict,
  verdictCluster,
  verdictSelection,
} from "../src/verdictstep.ts";
import {
  buyPassColumns,
  buyPassWidth,
  ENTRY_TEXT_FLOOR,
} from "../src/render/rankcard.ts";
import {
  channelDescription,
  channelPage,
  dayList,
  planSections,
  SHELF_ORDER,
  slotLabel,
  type ChannelPageYouTube,
} from "../src/channelpage.ts";
import { seriesFor, uploadsLeftToday } from "../src/pipeline.ts";
import { staleAfterHours } from "../src/lanes.ts";
import {
  evergreenTitle,
  keywordLead,
  pinnedComment,
} from "../src/editorial/seo.ts";
import { createEpisode, getEpisode, type Episode } from "../src/episodes.ts";
import type { Services } from "../src/pipeline.ts";
import { goodScript, testConfig, testDb, tmpDir } from "./helpers.ts";

const ON = { seriesCoverStyle: "strip" as const, seriesEpisodeNumbers: true };
const OFF = { seriesCoverStyle: "off" as const, seriesEpisodeNumbers: false };

const ETS2: VerdictData = {
  appId: 227300,
  name: "Euro Truck Simulator 2",
  year: 2012,
  usd: { final: "$4.99", initial: "$19.99", pct: 75 },
  gbp: "£4.24",
  eur: "4,99€",
  rating: 97,
  reviews: 147541,
  metacritic: 79,
  lowest: "$1.99",
  lowestDate: "2019-06-25",
  checkedAt: "2026-11-11T21:00:00.000Z",
};

const draft = (over: Partial<VerdictDraft> = {}): VerdictDraft => ({
  hook: "Euro Truck Simulator 2 is $4.99 right now. Buy it, wait, or skip it?",
  what_you_get:
    "You get a huge map of Europe, real trucking jobs and a calm, steady rhythm that eats whole evenings without you noticing the clock.",
  price_line:
    "On Steam it's $4.99, down from $19.99, which is 75% off the usual price.",
  score_line:
    "Players adore it: 97% of almost 150,000 Steam reviews are positive, and critics gave it a 79.",
  buy_if: "You want a calm long-haul game",
  pass_if: "You need action or a story",
  buy_pass_line:
    "If you want something slow and soothing to sink hours into, this is it. If you need explosions or a plot, pass.",
  verdict_line:
    "At this price I'd buy it, because the reviews are glowing and the cut is deep.",
  loop_line: "So, Euro Truck Simulator 2 for $4.99: are you buying?",
  description: "Euro Truck Simulator 2 is $4.99 on Steam. Our verdict: buy it.",
  tags: ["euro truck simulator 2"],
  ...over,
});

// ------------------------------------------------------------------ item 5: the cover strip

test("series cover: off by default, so every cover stays as it is", () => {
  assert.equal(seriesCoverFor(OFF, "why", { number: 24 }), undefined);
  assert.equal(
    seriesCoverFor({ ...OFF, seriesEpisodeNumbers: true }, "why", {
      number: 24,
    }),
    undefined,
  );
});

test("series cover: the strip names the series, the number only with numbering on, the price only on a verdict", () => {
  assert.deepEqual(seriesCoverFor(ON, "why", { number: 24 }), {
    label: "THE WHY",
    number: 24,
  });
  assert.deepEqual(
    seriesCoverFor({ ...ON, seriesEpisodeNumbers: false }, "gta_file", {
      number: 7,
    }),
    { label: "THE GTA FILE" },
  );
  assert.deepEqual(
    seriesCoverFor(ON, "verdict", { number: 3, price: "$4.99" }),
    {
      label: "BUY, WAIT OR SKIP?",
      number: 3,
      price: "$4.99",
    },
  );
  assert.deepEqual(seriesCoverFor(ON, "why", { price: "$4.99" }), {
    label: "THE WHY",
  });
  // The control arm keeps today's cover; no series, no strip; a nonsense number is dropped.
  assert.equal(seriesCoverFor(ON, "news_control", { number: 4 }), undefined);
  assert.equal(seriesCoverFor(ON, undefined), undefined);
  assert.deepEqual(seriesCoverFor(ON, "why", { number: 0 }), {
    label: "THE WHY",
  });
});

test("series cover: the strip reads the series tag first, then what the Short is", () => {
  assert.equal(
    seriesTagOf({ series: "gta_file" } as never, "why:gta"),
    "gta_file",
  );
  assert.equal(seriesTagOf({ evergreen_format: "buy_wait_skip" }), "verdict");
  assert.equal(seriesTagOf({}, "why:gta-san-andreas"), "why");
  assert.equal(seriesTagOf({ series: "nonsense" } as never), undefined);
  assert.equal(seriesTagOf(goodScript(), "news:abc"), undefined);
  assert.equal(seriesTagOf(null), undefined);
});

test("series cover: strip words and type size", () => {
  assert.equal(stripText({ label: "the why", number: 24 }), "THE WHY #24");
  assert.equal(stripText({ label: "THE GTA FILE" }), "THE GTA FILE");
  assert.equal(stripText({ label: "THE WHY", number: 2.5 }), "THE WHY");
  assert.equal(stripFontSize("THE WHY #24", 900, 62), 62);
  assert.ok(stripFontSize("BUY, WAIT OR SKIP? #120", 300, 62) < 62);
  assert.equal(stripFontSize("X".repeat(200), 100, 62, 34), 34);
});

test("series cover: the part number counts the series' Shorts that went out before this one", async () => {
  const db = await testDb();
  const cluster = (hash: string) => ({
    hash,
    headline: hash,
    items: [],
    sources: [],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: new Date().toISOString(),
    score: 1,
  });
  const add = async (
    id: string,
    hash: string,
    status: string,
    day: number,
    script: object,
  ) => {
    await createEpisode(db, id, cluster(hash));
    await db.query(
      `UPDATE episodes SET status = $2, script_json = $3, created_at = $4 WHERE id = $1`,
      [id, status, JSON.stringify(script), new Date(Date.UTC(2026, 10, day))],
    );
  };
  await add("w1", "why:a", "published", 1, goodScript());
  await add("w2", "why:b", "uploaded", 2, goodScript());
  await add("w3", "why:c", "failed", 3, goodScript()); // never went out: no number
  await add("g1", "news:g", "published", 4, {
    ...goodScript(),
    series: "gta_file",
  });
  await add("w4", "why:d", "selected", 5, goodScript());
  await add("w5", "why:e", "published", 6, goodScript()); // after this one: not counted
  assert.equal(await seriesEpisodeNumber(db, "why", "w4"), 3);
  assert.equal(await seriesEpisodeNumber(db, "gta_file", "g1"), 1);
  assert.equal(await seriesEpisodeNumber(db, "verdict", "w4"), 1);
  const ep = (await getEpisode(db, "w4"))!;
  assert.deepEqual(await seriesCoverOf(db, ON, ep, goodScript()), {
    label: "THE WHY",
    number: 3,
  });
  assert.equal(await seriesCoverOf(db, OFF, ep, goodScript()), undefined);
  // A GTA File part and a numbered Why show the number their title already says, not a count.
  const part = { ...ep, story_json: { ...ep.story_json, gtaFile: { part: 7 } } } as typeof ep;
  assert.deepEqual(await seriesCoverOf(db, ON, part, { ...goodScript(), series: "gta_file" } as any), {
    label: "THE GTA FILE",
    number: 7,
  });
  const serial = { ...ep, story_json: { ...ep.story_json, why: { question: "?", angle: "", serial: { number: 12, home: false } } } } as typeof ep;
  assert.equal((await seriesCoverOf(db, ON, serial, goodScript()))?.number, 12);
  await db.close();
});

// ------------------------------------------------------------------ item 7: Buy, Wait or Skip

test("verdict: prices read as numbers, euros the English way, the lowest price compared to the cent", () => {
  assert.equal(dollars("$4.99"), 4.99);
  assert.equal(dollars("$1,299.00"), 1299);
  assert.ok(Number.isNaN(dollars("£4.24")));
  assert.equal(euroPrice("4,99€"), "€4.99");
  assert.equal(euroPrice("1.299,00€"), "€1299.00");
  assert.equal(
    atLowest({
      usd: { final: "$1.99", initial: "$19.99", pct: 90 },
      lowest: "$1.99",
    }),
    true,
  );
  assert.equal(
    atLowest({
      usd: { final: "$4.99", initial: "$19.99", pct: 75 },
      lowest: "$1.99",
    }),
    false,
  );
  assert.equal(
    atLowest({ usd: { final: "$4.99", initial: "$19.99", pct: 75 } }),
    false,
  );
  assert.equal(reviewsShort(147541), "148K");
  assert.equal(reviewsShort(1500), "1.5K");
  assert.equal(reviewsShort(2_400_000), "2.4M");
});

test("verdict: one fixed rule decides, never the writer", () => {
  const d = (
    rating: number,
    pct: number,
    final = "$9.99",
    lowest?: string,
  ) => ({
    rating,
    usd: { final, initial: "$39.99", pct },
    lowest,
  });
  assert.equal(decideVerdict(d(65, 90)).verdict, "SKIP");
  assert.equal(decideVerdict(d(92, 50)).verdict, "BUY");
  assert.equal(decideVerdict(d(92, 30, "$9.99", "$9.99")).verdict, "BUY"); // the lowest ever
  assert.equal(decideVerdict(d(92, 30, "$9.99", "$4.99")).verdict, "WAIT");
  assert.match(
    decideVerdict(d(92, 30, "$9.99", "$4.99")).reason,
    /\$4\.99 before/,
  );
  assert.equal(decideVerdict(d(75, 80, "$9.99", "$9.99")).verdict, "BUY");
  assert.equal(decideVerdict(d(75, 80, "$9.99", "$5.99")).verdict, "WAIT");
  assert.equal(decideVerdict(ETS2).verdict, "BUY");
});

test("verdict: the title keeps the series pattern and stays short", () => {
  assert.equal(
    verdictTitle(ETS2),
    "Euro Truck Simulator 2 at $4.99: buy, wait or skip?",
  );
  const long = verdictTitle({ ...ETS2, name: "A".repeat(120) + "™" });
  assert.ok(long.length <= 90, long);
  assert.match(long, /… at \$4\.99: buy, wait or skip\?$/);
});

test("verdict: the brief carries every figure and its source, pounds and euros marked as screen only", () => {
  const b = verdictBrief(ETS2, "BUY", "97% positive and 75% off");
  assert.match(
    b,
    /Steam US price now: \$4\.99, down from \$19\.99 \(75% off\)/,
  );
  assert.match(b, /£4\.24, €4\.99/);
  assert.match(b, /not spoken/);
  assert.match(b, /97% positive from 147,541 reviews/);
  assert.match(b, /Metacritic score on the Steam store page: 79/);
  assert.match(b, /CheapShark, across stores: \$1\.99/);
  assert.match(b, /Our verdict, by the series' fixed rule: BUY/);
});

test("verdict: a draft that keeps to the data passes the house rules", () => {
  assert.deepEqual(validateVerdict(draft(), ETS2, "BUY"), []);
});

test("verdict: an invented price, a wrong verdict word, a second 'I' or a spoken pound is sent back", () => {
  const has = (p: string[], re: RegExp) =>
    assert.ok(
      p.some((x) => re.test(x)),
      p.join(" | "),
    );
  has(
    validateVerdict(
      draft({ price_line: "On Steam it's $4.99, down from $24.99 at launch." }),
      ETS2,
      "BUY",
    ),
    /\$24\.99" is not a price/,
  );
  has(
    validateVerdict(draft(), ETS2, "WAIT"),
    /verdict_line must say the verdict "wait"/,
  );
  has(
    validateVerdict(draft(), ETS2, "WAIT"),
    /says "buy" but the verdict is WAIT/,
  );
  has(
    validateVerdict(
      draft({ loop_line: "I think you should buy it too." }),
      ETS2,
      "BUY",
    ),
    /Say "I" only in the verdict line/,
  );
  has(
    validateVerdict(
      draft({ verdict_line: "Buy it, the cut is deep." }),
      ETS2,
      "BUY",
    ),
    /exactly once/,
  );
  has(
    validateVerdict(
      draft({ score_line: "It costs £4.24 in the UK and 97% love it." }),
      ETS2,
      "BUY",
    ),
    /US dollars only/,
  );
  has(
    validateVerdict(
      draft({ score_line: "Players adore it: 89% of reviews are positive." }),
      ETS2,
      "BUY",
    ),
    /"89%" is not a figure/,
  );
  has(
    validateVerdict(
      draft({ hook: "Is this trucking game worth buying today?" }),
      ETS2,
      "BUY",
    ),
    /hook must say the US price/,
  );
  has(
    validateVerdict(
      draft({ loop_line: "Hurry, the sale ends soon, so grab it." }),
      ETS2,
      "BUY",
    ),
    /ends soon/,
  );
  has(
    validateVerdict(
      draft({
        buy_if: "Anyone at all who has ever enjoyed driving games of any kind",
      }),
      ETS2,
      "BUY",
    ),
    /buy_if must be 3-7 words/,
  );
});

test("verdict: the Short shows Steam's figures, dollars first with pounds and euros beside, and the stamp", () => {
  const sc = verdictToScript(ETS2, draft(), "BUY");
  assert.equal(sc.evergreen_format, "buy_wait_skip");
  assert.equal(
    sc.youtube.title,
    "Euro Truck Simulator 2 at $4.99: buy, wait or skip?",
  );
  assert.equal(sc.headline, "Euro Truck Simulator 2 at $4.99");
  const kinds = sc.beats.map((b) => b.visual.kind);
  assert.deepEqual(kinds, ["none", "price", "score", "versus"]);
  const price = sc.beats[1]!.visual;
  assert.equal(price.primary, "$4.99");
  assert.equal(price.was, "$19.99");
  assert.deepEqual(price.items, ["£4.24", "€4.99"]);
  assert.equal(coverPrice(sc), "$4.99");
  const score = sc.beats[2]!.visual;
  assert.equal(score.value_a, 97);
  assert.equal(score.primary, "97%");
  assert.match(score.secondary, /148K Steam reviews/);
  assert.deepEqual(score.items, ["Metacritic 79"]);
  assert.deepEqual(sc.beats[3]!.visual.items, [
    "*Buy if:You want a calm long-haul game",
    "Pass if:You need action or a story",
  ]);
  assert.equal(sc.pulse_take.label, "OUR VERDICT");
  assert.deepEqual(sc.stamp, {
    word: "buy",
    text: "BUY IT",
    sub: "OUR VERDICT",
    tone: "confirm",
  });
  assert.equal(sc.is_rumour, false);
  assert.match(sc.attribution, /CheapShark/);
  // Not on sale: no old price on the card, and the card says so.
  const full = verdictToScript(
    { ...ETS2, usd: { final: "$19.99", initial: "$19.99", pct: 0 } },
    draft(),
    "WAIT",
  );
  assert.equal(full.beats[1]!.visual.was, undefined);
  assert.equal(full.beats[1]!.visual.secondary, "on Steam");
  assert.equal(full.stamp!.text, "WAIT");
  assert.equal(full.stamp!.tone, "price");
  assert.equal(stampWord("Honestly, I'd skip it.", "SKIP"), "skip");
  assert.match(
    narrationOfVerdict(draft()),
    /^Euro Truck Simulator 2 is \$4\.99/,
  );
});

test("verdict: SEO keeps the series title and says prices change", () => {
  const sc = verdictToScript(ETS2, draft(), "BUY");
  assert.equal(
    evergreenTitle(sc),
    "Euro Truck Simulator 2 at $4.99: buy, wait or skip?",
  );
  assert.match(
    keywordLead(sc),
    /^Is Euro Truck Simulator 2 worth buying at \$4\.99\?/,
  );
  assert.match(pinnedComment(sc), /can change/);
});

test("verdict: the pool takes known games on a real cut, one row each, and leaves out recent ones", () => {
  const row = (
    title: string,
    id: number,
    savings: number,
    rating: number,
    count: number,
  ) => ({
    title,
    steamAppID: String(id),
    gameID: String(id + 1),
    savings: String(savings),
    steamRatingPercent: String(rating),
    steamRatingCount: String(count),
    releaseDate: 1_350_000_000,
  });
  const pool = verdictPool(
    [
      row("Big Game", 1, 50.2, 90, 200_000),
      row("Big Game", 9, 60, 90, 200_000), // a second edition: one row per game
      row("Tiny Cut", 2, 10, 95, 50_000),
      row("Unknown", 3, 70, 95, 300),
      row("Split", 4, 80, 55, 90_000),
      row("Recent", 5, 75, 92, 80_000),
      row("Mid", 6, 40, 72, 60_000),
    ],
    ["recent"],
  );
  assert.deepEqual(
    pool.map((p) => p.name),
    ["Big Game", "Mid"],
  );
  assert.equal(pool[0]!.pct, 50);
  assert.equal(pool[0]!.year, 2012);
});

test("verdict: the pick avoids a third verdict in a row the same", () => {
  const wait = {
    ...ETS2,
    name: "Waity",
    usd: { final: "$9.99", initial: "$14.99", pct: 33 },
    lowest: "$4.99",
  };
  assert.equal(pickVerdict([ETS2, wait], [])!.data.name, ETS2.name);
  assert.equal(pickVerdict([ETS2, wait], ["BUY", "BUY"])!.data.name, "Waity");
  assert.equal(pickVerdict([ETS2], ["BUY", "BUY"])!.data.name, ETS2.name); // nothing else: still a Short
  assert.equal(pickVerdict([], []), undefined);
  const sel = verdictSelection([ETS2], [])!;
  assert.equal(sel.topic.format, "buy_wait_skip");
  assert.equal(sel.verdict.verdict, "BUY");
  assert.match(sel.brief, /\$4\.99/);
  const c = verdictCluster("2026-11-24", sel, new Date("2026-11-24T15:00:00Z"));
  assert.equal(c.hash, "series:verdict:2026-11-24");
  assert.equal(c.gameHint, "Euro Truck Simulator 2");
});

test("verdict: the script step writes from the stored data, checks the facts and files the stamp", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const sel = verdictSelection([ETS2], [])!;
  await createEpisode(db, "v1", verdictCluster("2026-11-24", sel, new Date()), {
    lane: "evergreen",
    priority: 30,
  });
  await db.query(`UPDATE episodes SET factcheck_json = $2 WHERE id = $1`, [
    "v1",
    JSON.stringify(sel),
  ]);
  const drafts = [draft({ price_line: "It's $3.99 today." }), draft()];
  const feedback: string[][] = [];
  const s = {
    db,
    cfg: testConfig(dir),
    notify: async () => undefined,
    llm: {
      structured: async (o: { content: string }) => {
        feedback.push([o.content]);
        return drafts.shift() ?? draft();
      },
    },
  } as unknown as Services;
  let checks = 0;
  await stepScriptVerdict(
    s,
    (await getEpisode(db, "v1")) as Episode,
    async (script) => {
      checks++;
      assert.equal(script.beats[1]!.visual.primary, "$4.99");
      return [];
    },
  );
  const ep = (await getEpisode(db, "v1"))!;
  assert.equal(ep.status, "scripted");
  assert.equal(ep.script_json!.evergreen_format, "buy_wait_skip");
  assert.equal(ep.script_json!.stamp!.text, "BUY IT");
  assert.equal(checks, 1);
  assert.match(
    feedback[1]![0]!,
    /\$3\.99" is not a price/,
    "the rewrite is told what was wrong",
  );
  assert.deepEqual(await recentVerdicts(db, new Date()), {
    games: ["Euro Truck Simulator 2"],
    verdicts: ["BUY"],
  });
  await db.close();
});

test("verdict: a price goes stale within the day, and the slot counts against the quota only when on", () => {
  assert.equal(staleAfterHours("evergreen", "buy_wait_skip"), 20);
  const now = new Date("2026-11-24T08:00:00Z"); // Tuesday morning London
  const base = testConfig("/tmp", {
    newsSlots: [],
    whyEnabled: false,
    longformEnabled: false,
  });
  const on = testConfig("/tmp", {
    newsSlots: [],
    whyEnabled: false,
    longformEnabled: false,
    seriesVerdictEnabled: true,
  });
  assert.equal(uploadsLeftToday(on, now) - uploadsLeftToday(base, now), 1);
});

test("verdict: the two-column card fits readable type, and other versus cards keep the VS layout", () => {
  const cols = buyPassColumns([
    "*Buy if:You want a calm long-haul game",
    "Pass if:You need action or a story",
  ])!;
  assert.equal(cols.buy.label, "BUY IF");
  assert.equal(cols.pass.label, "PASS IF");
  assert.ok(cols.buy.size >= ENTRY_TEXT_FLOOR);
  assert.ok(cols.buy.lines.length >= 1 && cols.buy.lines.length <= 4);
  assert.ok(buyPassWidth() > 300);
  assert.equal(buyPassColumns(["*Switch 2:$449", "PS5:$499"]), undefined);
  assert.equal(buyPassColumns(["Buy if:x"]), undefined);
  const long = buyPassColumns([
    "Buy if:" +
      "an extremely long reason that will never fit in four lines ".repeat(4),
    "Skip if:you hate trucks",
  ])!;
  assert.ok(long.buy.size >= ENTRY_TEXT_FLOOR);
  assert.match(long.buy.text, /\.\.\.$/);
});

// ------------------------------------------------------------------ item 8: playlists and the channel page

test("series playlists: GTA File parts and verdicts get their own shelves only with SERIES_PLAYLISTS on", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  const ep = (script: object, hash = "news:x", lane = "news") =>
    ({
      id: "e",
      lane,
      story_hash: hash,
      script_json: script,
    }) as unknown as Episode;
  const titles = (cfgOn: boolean, e: Episode) =>
    seriesFor(testConfig("/tmp", { seriesPlaylists: cfgOn }), e, now).map(
      (x) => x.title,
    );
  const gta = ep({ ...goodScript(), series: "gta_file" }, "why:gta-6");
  const bws = ep(
    verdictToScript(ETS2, draft(), "BUY"),
    "series:verdict:2026-11-24",
    "evergreen",
  );
  assert.deepEqual(titles(true, gta), ["The GTA File"]);
  assert.deepEqual(titles(true, bws), ["Buy, Wait or Skip"]);
  // Off: as before (a Why-hashed part is filed as a Why; a verdict joins no ranking shelf).
  assert.deepEqual(titles(false, gta), ["The Why: Gaming's Biggest Questions"]);
  assert.deepEqual(titles(false, bws), []);
});

test("channel page: the description leads with the positioning line, the three series and US times first", () => {
  const cfg = testConfig("/tmp", {
    whySlots: ["12:00"],
    siteUrl: "https://pulsegmg.com",
  });
  const d = channelDescription(cfg, new Date("2026-11-24T12:00:00Z"), "18:30");
  const lines = d.split("\n");
  assert.equal(
    lines[0],
    "The why behind the games you love. One straight verdict, every day.",
  );
  assert.match(lines[2]!, /^The Why: .*Every day, 7am ET \/ 12pm UK\.$/);
  assert.match(lines[3]!, /^The GTA File: .*1:30pm ET \/ 6:30pm UK\.$/);
  assert.match(
    lines[4]!,
    /^Buy, Wait or Skip: .*Tuesday, Thursday and Saturday, 11:30am ET \/ 4:30pm UK\.$/,
  );
  assert.match(d, /AI-generated synthetic voice/);
  assert.equal(lines.at(-1), "https://pulsegmg.com");
  assert.ok(d.length <= 1000);
  assert.equal(
    dayList(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
    "every day",
  );
  assert.equal(dayList(["sat"]), "Saturday");
  // Summer time moves both clocks together.
  assert.equal(
    slotLabel("12:00", "Europe/London", new Date("2027-07-01T12:00:00Z")),
    "7am ET / 12pm UK",
  );
});

test("channel page: the shelf plan moves what is out of place and adds what is missing", () => {
  assert.deepEqual(SHELF_ORDER, [
    "The GTA File",
    "The Why: Gaming's Biggest Questions",
    "Buy, Wait or Skip",
    "Gaming Documentaries",
    "Every Game Ranked: Worst to Best",
  ]);
  const ops = planSections(
    [
      { id: "s1", type: "singlePlaylist", position: 0, playlists: ["PLwhy"] },
      { id: "s2", type: "singlePlaylist", position: 2, playlists: ["PLbws"] },
      { id: "s3", type: "recentUploads", position: 1, playlists: [] },
    ],
    [
      { title: "The GTA File", playlistId: "PLgta" },
      { title: "The Why", playlistId: "PLwhy" },
      { title: "Buy, Wait or Skip", playlistId: "PLbws" },
    ],
  );
  assert.deepEqual(ops, [
    { playlistId: "PLgta", position: 0, title: "The GTA File" },
    { id: "s1", playlistId: "PLwhy", position: 1, title: "The Why" },
  ]);
});

function fakeChannel() {
  const calls: string[] = [];
  const yt: ChannelPageYouTube = {
    findOrCreatePlaylist: async (t) => {
      calls.push(`create:${t}`);
      return { id: `PL:${t}`, created: t === "The GTA File" };
    },
    findPlaylist: async (t) => (t === "The GTA File" ? undefined : `PL:${t}`),
    listSections: async () => [],
    putSection: async (op) => {
      calls.push(`shelf:${op.position}:${op.title}`);
    },
    setText: async (o) => {
      calls.push(`text:${o.trailer ?? ""}`);
    },
    setBanner: async (f) => {
      calls.push(`banner:${f}`);
    },
  };
  return { yt, calls };
}

test("channel page: off, or without --apply, it only reads and nothing on the page changes", async () => {
  for (const [enabled, apply] of [
    [false, false],
    [false, true],
    [true, false],
  ] as const) {
    const { yt, calls } = fakeChannel();
    const report = await channelPage({
      cfg: testConfig("/tmp", { seriesChannelPage: enabled }),
      now: new Date("2026-11-24T12:00:00Z"),
      yt,
      apply,
      bannerFile: "banner.png",
    });
    assert.deepEqual(calls, [], `enabled=${enabled} apply=${apply}`);
    assert.equal(report.apply, false);
    assert.equal(
      report.playlists.find((p) => p.title === "The GTA File")!.id,
      null,
    );
    if (apply) assert.match(report.errors[0]!, /SERIES_CHANNEL_PAGE is off/);
  }
});

test("channel page: the owner's hold stops it too", async () => {
  const { yt, calls } = fakeChannel();
  const report = await channelPage({
    cfg: testConfig("/tmp", { seriesChannelPage: true }),
    now: new Date(),
    yt,
    apply: true,
    bannerFile: "banner.png",
    held: true,
  });
  assert.deepEqual(calls, []);
  assert.match(report.errors.join(" "), /publishing hold/);
});

test("channel page: on and applied, it makes the playlists, sets the banner, text and featured Short, then the shelves", async () => {
  const { yt, calls } = fakeChannel();
  const report = await channelPage({
    cfg: testConfig("/tmp", {
      seriesChannelPage: true,
      seriesFeaturedVideo: "vidWHY",
    }),
    now: new Date("2026-11-24T12:00:00Z"),
    yt,
    apply: true,
    bannerFile: "banner.png",
  });
  assert.equal(report.apply, true);
  assert.deepEqual(calls, [
    ...SHELF_ORDER.map((t) => `create:${t}`),
    "banner:banner.png",
    "text:vidWHY",
    ...SHELF_ORDER.map((t, i) => `shelf:${i}:${t}`),
  ]);
  assert.deepEqual(report.errors, []);
  assert.equal(report.playlists[0]!.created, true);
});
