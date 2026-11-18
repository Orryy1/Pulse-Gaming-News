import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { testDb, tmpDir } from "./helpers.ts";
import {
  factVaultMode,
  vaultEnforces,
  vaultReads,
  vaultWrites,
} from "../src/factvault/mode.ts";
import {
  aliasKeys,
  entityKey,
  sourceAllowed,
  sourceTypeOf,
  spokenYear,
  wordsToNumber,
  yearsIn,
  normaliseQuote,
} from "../src/factvault/normalise.ts";
import { extractClaims } from "../src/factvault/claims.ts";
import { FactVault, type FactInput } from "../src/factvault/store.ts";
import {
  applyFixes,
  parseBlocker,
  repeatsDispute,
  resolveBlocker,
  type VaultContext,
} from "../src/factvault/check.ts";
import {
  enforceBlockers,
  loadContext,
  vaultBrief,
  disputeWarnings,
} from "../src/factvault/vault.ts";
import {
  citedClaims,
  harvestArticle,
  harvestBlockers,
  harvestCited,
  harvestSteam,
  reviewTable,
  verifiedBy,
  type PageReader,
} from "../src/factvault/harvest.ts";
import {
  runIntegrity,
  stillSays,
  integrityDue,
} from "../src/factvault/integrity.ts";
import { openSession } from "../src/factvault/session.ts";
import { seedOnce } from "../src/factvault/nightly.ts";
import { refMark } from "../src/discovery/wikirefs.ts";

const NOW = new Date("2026-11-14T12:00:00Z");
const BOS = {
  kind: "game" as const,
  name: "Fallout: Brotherhood of Steel",
  aliases: ["Brotherhood of Steel"],
};
const GAMESPOT_REVIEW =
  "https://www.gamespot.com/reviews/fallout-brotherhood-of-steel-review/1900-6085733/";

async function vaultWith(
  facts: Array<
    Partial<FactInput> & Pick<FactInput, "kind" | "claim" | "value">
  >,
  entity: { kind: "game"; name: string; aliases?: string[] } = BOS,
) {
  const db = await testDb();
  const vault = new FactVault(db);
  for (const f of facts)
    await vault.addFact({
      entity,
      sourceUrl: GAMESPOT_REVIEW,
      sourceType: "review",
      origin: "seed",
      confidence: 0.9,
      checkedAt: NOW,
      ...f,
    });
  return { db, vault };
}

const ctxFor = async (
  vault: FactVault,
  names: string[],
  texts: string[] = [],
) => loadContext(vault, names, texts, NOW);

// ---------------------------------------------------------------- settings and parsing

test("FACT_VAULT is off unless set to a known mode, and each mode includes the ones below it", () => {
  assert.equal(factVaultMode(undefined), "off");
  assert.equal(factVaultMode(""), "off");
  assert.equal(factVaultMode("enforec"), "off");
  assert.equal(factVaultMode(" Enforce "), "enforce");
  assert.equal(factVaultMode("on"), "read");
  assert.deepEqual(
    ["off", "read", "write", "enforce"].map((m) => [
      vaultReads(m as never),
      vaultWrites(m as never),
      vaultEnforces(m as never),
    ]),
    [
      [false, false, false],
      [true, false, false],
      [true, true, false],
      [true, true, true],
    ],
  );
});

test("names, spoken numbers and years normalise the way scripts say them", () => {
  assert.equal(entityKey("Grand Theft Auto VI"), "grand-theft-auto-6");
  assert.ok(aliasKeys("Grand Theft Auto VI").includes("gta-6"));
  assert.ok(
    aliasKeys("Call of Duty 4: Modern Warfare").includes(
      "cod-4-modern-warfare",
    ),
  );
  assert.equal(wordsToNumber(["twenty-five", "million"]), 25_000_000);
  assert.equal(wordsToNumber(["one", "hundred", "and", "ninety-nine"]), 199);
  assert.equal(spokenYear("twenty nineteen"), 2019);
  assert.equal(spokenYear("nineteen ninety-seven"), 1997);
  assert.equal(spokenYear("two thousand and eight"), 2008);
  assert.deepEqual(
    yearsIn("It first launched in China in twenty nineteen.").map(
      (y) => y.year,
    ),
    [2019],
  );
  assert.equal(normaliseQuote("“Very repetitive.”"), "very repetitive");
});

test("Wikipedia is never a source; an archive counts only as its original", () => {
  assert.equal(sourceAllowed("https://en.wikipedia.org/wiki/Fallout_2"), false);
  assert.equal(
    sourceAllowed("https://en.m.wikipedia.org/wiki/Fallout_2"),
    false,
  );
  assert.equal(sourceAllowed("https://web.archive.org/web/2004/"), false);
  assert.equal(
    sourceAllowed(
      "https://web.archive.org/web/20040101000000/http://www.gamespot.com/x",
    ),
    true,
  );
  assert.equal(sourceTypeOf(GAMESPOT_REVIEW), "review");
  assert.equal(
    sourceTypeOf(
      "https://www.nintendo.co.jp/ir/en/finance/software/index.html",
    ),
    "earnings_call",
  );
  assert.equal(
    sourceTypeOf("https://store.steampowered.com/app/38410/"),
    "store_page",
  );
  assert.equal(
    sourceTypeOf("https://blog.playstation.com/2025/01/01/x"),
    "publisher_post",
  );
});

test("claims: a quoted outlet, spoken and written prices, a release year and a sales count", () => {
  const q = extractClaims(
    "GameSpot's review called the gameplay “very repetitive.”",
  );
  assert.deepEqual(
    q.map((c) => [c.kind, c.span]),
    [["quote", "“very repetitive.”"]],
  );
  assert.equal((q[0] as { outlet?: string }).outlet, "GameSpot");
  const p = extractClaims(
    "Borderlands 2 brings better value at two dollars, and Doom is $4.99.",
  );
  assert.deepEqual(
    p.map((c) => [c.kind, c.span, (c as { amount?: number }).amount]),
    [
      ["price", "$4.99", 4.99],
      ["price", "two dollars", 2],
    ],
  );
  assert.equal(
    extractClaims("about two dollars").find((c) => c.kind === "price")?.hedge,
    "about",
  );
  assert.equal(
    extractClaims("It made $750 million in pre-sales.").filter(
      (c) => c.kind === "price",
    ).length,
    0,
  );
  const y = extractClaims("It first launched in China in twenty nineteen.");
  assert.deepEqual(
    y.map((c) => [
      c.kind,
      c.span,
      (c as { year?: number }).year,
      (c as { region?: string }).region,
    ]),
    [["year", "twenty nineteen", 2019, "CN"]],
  );
  const s = extractClaims("It's sold over 25 million copies.");
  assert.deepEqual(
    s.map((c) => [
      c.kind,
      (c as { count?: number }).count,
      (c as { hedge?: string }).hedge,
    ]),
    [["sales", 25_000_000, "at_least"]],
  );
});

// ---------------------------------------------------------------- the store

test("the store refuses Wikipedia, keeps one fact per value and source, and finds a game by its alias", async () => {
  const db = await testDb();
  const vault = new FactVault(db);
  const base = {
    entity: { kind: "game" as const, name: "Grand Theft Auto VI" },
    kind: "release_date" as const,
    claim: "GTA VI comes out on 19 November 2026",
    value: "2026-11-19",
    valueJson: { year: 2026, month: 11, day: 19 },
    origin: "seed" as const,
    confidence: 0.95,
    sourceType: "publisher_post" as const,
  };
  assert.equal(
    await vault.addFact({
      ...base,
      sourceUrl: "https://en.wikipedia.org/wiki/Grand_Theft_Auto_VI",
    }),
    undefined,
  );
  const a = await vault.addFact({
    ...base,
    sourceUrl: "https://www.rockstargames.com/newswire/article/gta-vi",
  });
  const b = await vault.addFact({
    ...base,
    sourceUrl: "https://www.rockstargames.com/newswire/article/gta-vi",
    confidence: 0.99,
  });
  assert.equal(a?.created, true);
  assert.equal(b?.created, false);
  assert.equal(a?.id, b?.id);
  const found = await vault.findEntities(["GTA 6"]);
  assert.deepEqual(
    found.map((e) => e.id),
    ["game:grand-theft-auto-6"],
  );
  const facts = await vault.factsFor(["game:grand-theft-auto-6"]);
  assert.equal(facts.length, 1);
  assert.equal(facts[0]!.confidence.toFixed(2), "0.99");
  const stats = await vault.stats();
  assert.equal(stats.facts, 1);
  // The export loads into a fresh database unchanged.
  const db2 = await testDb();
  const again = new FactVault(db2);
  assert.deepEqual(await again.importAll(await vault.exportAll()), {
    entities: 1,
    facts: 1,
  });
  assert.equal((await again.stats()).facts, 1);
});

// ---------------------------------------------------------------- 14 Nov: the GameSpot quote

const GAMESPOT_BLOCKER =
  "Fact-check: \"GameSpot's review called the gameplay “very repetitive.”\" - The supplied GameSpot article concerns Interplay's distribution dispute, not a review. The review attribution and exact quotation are unsupported.";

test("14 Nov GameSpot blocker: a stored GameSpot review quote passes it", async () => {
  const { vault } = await vaultWith([
    {
      kind: "review_quote",
      claim: "GameSpot on Brotherhood of Steel",
      value: "q",
      quote: "The combat is very repetitive, and the levels blur together.",
      outlet: "GameSpot",
    },
  ]);
  const ctx = await ctxFor(vault, ["Fallout: Brotherhood of Steel"]);
  const r = resolveBlocker(parseBlocker(GAMESPOT_BLOCKER)!, ctx);
  assert.equal(r.status, "supported");
  assert.match(r.why, /gamespot\.com\/reviews/);
});

test("14 Nov GameSpot blocker: GameSpot reviewed it in other words, so the line is paraphrased without quotation marks", async () => {
  const { vault } = await vaultWith([
    {
      kind: "review_quote",
      claim: "GameSpot on Brotherhood of Steel",
      value: "q",
      quote: "Brotherhood of Steel plays it safe and grows tiresome.",
      outlet: "GameSpot",
    },
  ]);
  const ctx = await ctxFor(vault, ["Fallout: Brotherhood of Steel"]);
  const script = {
    beats: [
      {
        narration:
          "GameSpot's review called the gameplay “very repetitive.” Still, it's a curio.",
      },
    ],
    youtube: { title: "Ranking EVERY Fallout Game" },
  };
  const e = enforceBlockers(script, [GAMESPOT_BLOCKER], ctx);
  assert.deepEqual(e.remaining, []);
  assert.equal(e.resolutions[0]!.status, "fixed");
  assert.equal(
    e.script.beats[0]!.narration,
    "GameSpot's review called the gameplay very repetitive Still, it's a curio.",
  );
});

test("14 Nov GameSpot blocker: with no GameSpot review in the vault, the blocker stands", async () => {
  const { vault } = await vaultWith([
    {
      kind: "review_quote",
      claim: "IGN on it",
      value: "q",
      quote: "A shallow hack and slash.",
      outlet: "IGN",
      sourceUrl:
        "https://www.ign.com/articles/2004/01/14/fallout-brotherhood-of-steel-review",
    },
  ]);
  const ctx = await ctxFor(vault, ["Fallout: Brotherhood of Steel"]);
  const e = enforceBlockers({ t: "x" }, [GAMESPOT_BLOCKER], ctx);
  assert.equal(e.remaining.length, 1);
  assert.equal(e.resolutions[0]!.status, "unresolved");
});

// ---------------------------------------------------------------- prices, years, sales

const BL2 = { kind: "game" as const, name: "Borderlands 2" };

test("a rounded spoken price is fixed with the vault's fresh Steam price, never with a stale one", async () => {
  const blocker =
    'Fact-check: "Borderlands 2 brings better value at two dollars" - The supplied price is $1.99. Use that price or explicitly qualify $2 as approximate.';
  const { vault } = await vaultWith(
    [
      {
        kind: "price",
        claim: "Borderlands 2 costs $1.99",
        value: "$1.99",
        valueJson: { amount: 1.99, currency: "USD" },
        sourceUrl: "https://store.steampowered.com/app/49520/",
        sourceType: "store_page",
      },
    ],
    BL2,
  );
  const ctx = await ctxFor(vault, ["Borderlands 2"]);
  const e = enforceBlockers(
    { n: "Borderlands 2 brings better value at two dollars." },
    [blocker],
    ctx,
  );
  assert.equal(e.script.n, "Borderlands 2 brings better value at $1.99.");
  assert.deepEqual(e.remaining, []);
  const stale = { ...ctx, now: new Date(NOW.getTime() + 5 * 86_400_000) };
  assert.equal(
    resolveBlocker(parseBlocker(blocker)!, stale).status,
    "unresolved",
  );
});

test("a hedged price that matches passes; a regional release year is fixed; two years in a line are left alone", async () => {
  const shelter = { kind: "game" as const, name: "Fallout Shelter Online" };
  const { vault } = await vaultWith(
    [
      {
        kind: "release_date",
        claim: "Fallout Shelter Online launched in China in June 2020",
        value: "2020-06",
        valueJson: { year: 2020, month: 6 },
        region: "CN",
        sourceUrl:
          "https://www.bethesda.net/en/article/fallout-shelter-online-china",
        sourceType: "publisher_post",
      },
    ],
    shelter,
  );
  const ctx = await ctxFor(vault, ["Fallout Shelter Online"]);
  const r = resolveBlocker(
    {
      quote: "It first launched in China in twenty nineteen.",
      problem:
        "The supplied Online source documents the June 2020 regional launch, not an earlier Chinese debut.",
    },
    ctx,
  );
  assert.equal(r.status, "fixed");
  assert.deepEqual(
    r.fixes.map((f) => [f.from, f.to]),
    [["twenty nineteen", "2020"]],
  );
  const two = resolveBlocker(
    {
      quote: "It launched in China in 2019 and in Japan in 2021.",
      problem: "release dates unsupported",
    },
    ctx,
  );
  assert.equal(two.status, "unresolved");
});

test("a sales floor the record clears passes; a superlative beside it never does", async () => {
  const odyssey = { kind: "game" as const, name: "Super Mario Odyssey" };
  const { vault } = await vaultWith(
    [
      {
        kind: "sales",
        claim:
          "Super Mario Odyssey had sold 29.62 million units by 30 September 2025",
        value: "29.62 million",
        valueJson: { count: 29_620_000, asOf: "2025-09-30" },
        outlet: "Nintendo",
        sourceUrl:
          "https://www.nintendo.co.jp/ir/en/finance/software/index.html",
        sourceType: "earnings_call",
      },
    ],
    odyssey,
  );
  const ctx = await ctxFor(vault, ["Super Mario Odyssey"]);
  assert.equal(
    resolveBlocker(
      {
        quote: "Super Mario Odyssey has sold over 25 million copies.",
        problem: "The sources give no sales figure for Super Mario Odyssey.",
      },
      ctx,
    ).status,
    "supported",
  );
  assert.equal(
    resolveBlocker(
      {
        quote:
          "It's sold over 25 million copies, the best-selling 3D Mario by a distance.",
        problem:
          "The sources give no sales figure for Super Mario Odyssey and do not establish it as best-selling.",
      },
      ctx,
    ).status,
    "unresolved",
  );
  const over = resolveBlocker(
    {
      quote: "Super Mario Odyssey has sold 40 million copies.",
      problem: "No sales figure is supplied.",
    },
    ctx,
  );
  assert.equal(over.status, "fixed");
  assert.equal(over.fixes[0]!.to, "30 million");
});

test("a blocker about something the vault does not hold (a mechanic, an opinion) is never touched", async () => {
  const { vault } = await vaultWith([
    {
      kind: "review_quote",
      claim: "x",
      value: "q",
      quote: "Fine.",
      outlet: "GameSpot",
    },
  ]);
  const ctx = await ctxFor(vault, ["Fallout: Brotherhood of Steel"]);
  const r = resolveBlocker(
    {
      quote: "You can dodge attacks with a roll.",
      problem: "This gameplay mechanic is not in the supplied facts.",
    },
    ctx,
  );
  assert.equal(r.status, "unresolved");
});

test("fixes reach every string in a script, cards and description included", () => {
  const { value, applied } = applyFixes(
    { a: ["two dollars", { b: "now two dollars" }], n: 3 },
    [{ from: "two dollars", to: "$1.99", factId: 1, why: "" }],
  );
  assert.deepEqual(value, { a: ["$1.99", { b: "now $1.99" }], n: 3 });
  assert.equal(applied, 2);
});

// ---------------------------------------------------------------- disputes and the brief

test("a rejected claim becomes a dispute, the writer is told, and a reworded repeat is caught", async () => {
  const f76 = { kind: "game" as const, name: "Fallout 76" };
  const { vault } = await vaultWith(
    [
      {
        kind: "release_date",
        claim: "Fallout 76 was released on 14 November 2018",
        value: "2018-11-14",
        valueJson: { year: 2018, month: 11, day: 14 },
        sourceUrl: "https://bethesda.net/en/article/fallout-76-launch",
        sourceType: "publisher_post",
      },
    ],
    f76,
  );
  let ctx = await ctxFor(vault, ["Fallout 76"]);
  await harvestBlockers(
    vault,
    ctx,
    [
      'Fact-check: "Fallout 76 launched without a single human character." - Player characters were human at launch.',
    ],
    "ep_1",
  );
  ctx = await ctxFor(vault, ["Fallout 76"]);
  assert.equal(ctx.disputes.length, 1);
  assert.ok(
    repeatsDispute(
      "So how does Fallout 76, which launched without a single human character, climb past it?",
      ctx.disputes,
    ),
  );
  assert.equal(
    disputeWarnings(["Fallout 76 launched without one human character."], ctx)
      .length,
    1,
  );
  const brief = vaultBrief(ctx);
  assert.match(brief, /Fallout 76:/);
  assert.match(brief, /Released 14 November 2018/);
  assert.match(brief, /never say again/);
  assert.match(brief, /Quotation rule/);
  assert.doesNotMatch(brief, /wikipedia\.org/);
});

// ---------------------------------------------------------------- growth

test("a cited Wikipedia sentence is stored only when its own source says it, credited to that source", async () => {
  const db = await testDb();
  const vault = new FactVault(db);
  const text = [
    `Fallout was released in North America on September 30, 1997.${refMark(1)}`,
    `GameSpot's Trent Ward called it "one of the best role-playing games in years".${refMark(2)}`,
    `The game sold 5 million copies by 2001.${refMark(3)}`,
    `It won the Game of the Year award from GameSpot.${refMark(4)}`,
  ].join("\n");
  const refs = [
    {
      n: 1,
      url: "https://interplay.com/press/fallout-ships",
      outlet: "Interplay",
    },
    {
      n: 2,
      url: "https://www.gamespot.com/reviews/fallout-review/1900-2533313/",
      outlet: "GameSpot",
    },
    {
      n: 3,
      url: "https://example-news.com/fallout-sales",
      outlet: "Example News",
    },
    { n: 4, url: "https://en.wikipedia.org/wiki/Other", outlet: "Wikipedia" },
  ];
  const pages: Record<string, string> = {
    "https://interplay.com/press/fallout-ships":
      "Interplay announced today that Fallout shipped on September 30, 1997 to stores across North America. ".repeat(
        4,
      ),
    "https://www.gamespot.com/reviews/fallout-review/1900-2533313/":
      "Fallout is one of the best role-playing games in years, a dark and funny adventure. ".repeat(
        5,
      ),
    // The sales page never gives the figure: nothing is stored from it.
    "https://example-news.com/fallout-sales":
      "Fallout has sold very well for Interplay according to the company. ".repeat(
        6,
      ),
  };
  const read: PageReader = async (url) =>
    pages[url] ? { url, title: "t", text: pages[url]! } : undefined;
  const h = await harvestCited(
    vault,
    { name: "Fallout" },
    { url: "https://en.wikipedia.org/wiki/Fallout_(video_game)", text, refs },
    read,
    { now: NOW },
  );
  assert.equal(h.stored, 2);
  const facts = await vault.factsFor(["game:fallout"]);
  const byKind = Object.fromEntries(facts.map((f) => [f.kind, f]));
  assert.equal(byKind.release_date?.value, "1997-09-30");
  assert.equal(byKind.release_date?.region, "NA");
  assert.equal(
    byKind.release_date?.source_url,
    "https://interplay.com/press/fallout-ships",
  );
  assert.equal(
    byKind.release_date?.discovered_via,
    "https://en.wikipedia.org/wiki/Fallout_(video_game)",
  );
  assert.equal(
    byKind.review_quote?.quote,
    "one of the best role-playing games in years",
  );
  assert.equal(byKind.review_quote?.outlet, "GameSpot");
  assert.equal(byKind.sales, undefined);
  assert.ok(facts.every((f) => !/wikipedia/.test(f.source_url)));
});

test("citedClaims skips quoted names and series totals; verifiedBy needs every figure", () => {
  assert.equal(
    citedClaims(`IGN named it "Best Platformer" of 2017.`, "Odyssey").filter(
      (c) => c.kind === "review_quote",
    ).length,
    0,
  );
  assert.equal(
    citedClaims(
      "The series has sold 5 million copies combined.",
      "Fallout",
    ).filter((c) => c.kind === "sales").length,
    0,
  );
  assert.equal(
    citedClaims(
      "Fallout 2 was ported to macOS in 2002 and released on May 3, 2002.",
      "Fallout 2",
    ).filter((c) => c.kind === "release_date").length,
    0,
  );
  assert.ok(
    verifiedBy("It sold 5.2 million units.", {
      kind: "sales",
      claim: "",
      value: "",
      needs: ["5.2"],
    }),
  );
  assert.ok(
    !verifiedBy("It sold 15.2 million units.", {
      kind: "sales",
      claim: "",
      value: "",
      needs: ["5.2"],
    }),
  );
});

test("the reception table leads to each outlet's own review page", () => {
  const html = `<table class="wikitable video-game-reviews"><tr><th>Publication</th><th>Score</th></tr>
    <tr><td>GameSpot</td><td>6.4/10<sup class="reference"><a href="#cite_note-gs-3">[3]</a></sup></td></tr>
    <tr><td>Metacritic</td><td>64/100<sup class="reference"><a href="#cite_note-mc-4">[4]</a></sup></td></tr></table>
    <ol class="references"><li id="cite_note-gs-3"><a class="external" href="${GAMESPOT_REVIEW}">Review</a> <a class="external" href="https://web.archive.org/web/2004/${GAMESPOT_REVIEW}">Archived</a></li>
    <li id="cite_note-mc-4"><a class="external" href="https://www.metacritic.com/game/x">MC</a></li></ol>`;
  const rows = reviewTable(html);
  assert.deepEqual(
    rows.map((r) => [r.outlet, r.score, r.url]),
    [
      ["GameSpot", "6.4/10", GAMESPOT_REVIEW],
      ["Metacritic", "64/100", "https://www.metacritic.com/game/x"],
    ],
  );
  assert.match(rows[0]!.archive ?? "", /web\.archive\.org/);
});

test("a review's verdict sentences are kept word for word; Steam's store data becomes prices and studios", async () => {
  const db = await testDb();
  const vault = new FactVault(db);
  const text =
    "Brotherhood of Steel is a console action game set in the Fallout universe with a lot of fighting.\nThe combat quickly becomes very repetitive, and the levels blur into one another before long.\nUltimately it is a forgettable spin-off that fans of the series can skip.";
  const n = await harvestArticle(
    vault,
    "Fallout: Brotherhood of Steel",
    {
      url: GAMESPOT_REVIEW,
      title: "Fallout: Brotherhood of Steel Review",
      text: text.repeat(1),
      outlet: "GameSpot",
      review: true,
    },
    { now: NOW },
  );
  assert.ok(n >= 2);
  const quotes = (
    await vault.factsFor(
      ["game:fallout-brotherhood-of-steel"],
      ["review_quote"],
    )
  ).map((f) => f.quote);
  assert.ok(
    quotes.includes(
      "The combat quickly becomes very repetitive, and the levels blur into one another before long.",
    ),
  );
  const s = await harvestSteam(
    vault,
    "Borderlands 2",
    {
      name: "Borderlands 2",
      storeUrl: "https://store.steampowered.com/app/49520/",
      price: "$1.99",
      prices: { usd: "$1.99", gbp: "£1.49", eur: "€1.99" },
      releaseDate: "18 Sep, 2012",
      metacritic: 89,
      fetchedAt: NOW.toISOString(),
    },
    {
      developers: ["Gearbox Software"],
      publishers: ["2K"],
      metacritic: {
        score: 89,
        url: "https://www.metacritic.com/game/pc/borderlands-2?ftag=MCD",
      },
    },
  );
  assert.equal(s, 7);
  const bl = await vault.factsFor(["game:borderlands-2"]);
  assert.deepEqual(
    bl
      .filter((f) => f.kind === "price")
      .map((f) => f.value)
      .sort(),
    ["$1.99", "£1.49", "€1.99"],
  );
  assert.equal(
    bl.find((f) => f.kind === "review_score")?.source_url,
    "https://www.metacritic.com/game/pc/borderlands-2",
  );
  assert.equal(
    bl.find((f) => f.kind === "platform")?.value,
    "PC (Steam) 2012-09-18",
  );
});

// ---------------------------------------------------------------- the nightly integrity job

test("integrity: confirmed facts gain trust, missing ones lose it and are retracted after three misses, moved prices are replaced", async () => {
  const { db, vault } = await vaultWith([
    {
      kind: "review_quote",
      claim: "a",
      value: "q",
      quote: "The combat quickly becomes very repetitive.",
      outlet: "GameSpot",
      confidence: 0.5,
    },
    {
      kind: "review_quote",
      claim: "b",
      value: "q",
      quote: "A quote that is gone.",
      outlet: "GameSpot",
      sourceUrl: "https://www.gamespot.com/gone",
      confidence: 0.5,
    },
    {
      kind: "price",
      claim: "Borderlands 2 costs $1.99 on Steam (USD)",
      value: "$1.99",
      valueJson: { amount: 1.99, currency: "USD" },
      sourceUrl: "https://store.steampowered.com/app/49520/",
      sourceType: "store_page",
      checkedAt: new Date("2026-11-10T00:00:00Z"),
    },
  ]);
  const read: PageReader = async (url) =>
    url === GAMESPOT_REVIEW
      ? {
          url,
          title: "",
          text: "The combat quickly becomes very repetitive. More words.",
        }
      : url.includes("gone")
        ? { url, title: "", text: "Nothing here now." }
        : undefined;
  const prices = async () => ({ usd: "$19.99" });
  for (let night = 0; night < 3; night++)
    await runIntegrity(vault, read, { now: NOW, prices });
  const rows = await db.query<{
    quote: string | null;
    value: string;
    status: string;
    confidence: number;
  }>(`SELECT quote, value, status, confidence FROM fact_vault ORDER BY id`);
  assert.equal(rows[0]!.status, "active");
  assert.ok(Number(rows[0]!.confidence) > 0.5);
  assert.equal(rows[1]!.status, "retracted");
  assert.equal(rows[2]!.status, "superseded");
  assert.equal(rows[3]!.value, "$19.99");
  assert.equal(rows[3]!.status, "active");
  assert.ok(
    stillSays("GameSpot: 6.4 out of 10", {
      kind: "review_score",
      value: "6.4/10",
      value_json: { score: 6.4 },
    } as never),
  );
});

test("integrity runs once a day from 04:00 local", async () => {
  const db = await testDb();
  assert.equal(
    await integrityDue(db, "Europe/London", new Date("2026-11-14T03:30:00Z")),
    undefined,
  );
  assert.equal(
    await integrityDue(db, "Europe/London", new Date("2026-11-14T04:10:00Z")),
    "2026-11-14",
  );
});

// ---------------------------------------------------------------- the pipeline seam

test("the session does nothing when off, advises when read, and settles only when enforce", async () => {
  const { db } = await vaultWith([
    {
      kind: "review_quote",
      claim: "x",
      value: "q",
      quote: "The combat is very repetitive, honestly.",
      outlet: "GameSpot",
    },
  ]);
  assert.equal(
    await openSession(db, "off", ["Fallout: Brotherhood of Steel"]),
    undefined,
  );
  const read = await openSession(
    db,
    "read",
    ["Fallout: Brotherhood of Steel"],
    [],
    NOW,
  );
  assert.ok(read?.brief.includes("very repetitive"));
  const r = await read!.settle({}, [GAMESPOT_BLOCKER], "ep_r", "test");
  assert.equal(r.remaining.length, 1);
  const enforce = await openSession(
    db,
    "enforce",
    ["Fallout: Brotherhood of Steel"],
    [],
    NOW,
  );
  const e = await enforce!.settle({}, [GAMESPOT_BLOCKER], "ep_e", "test");
  assert.equal(e.remaining.length, 0);
  const [ev] = await db.query<{ detail: { settled: unknown[] } }>(
    `SELECT detail FROM events WHERE kind = 'factvault' AND episode_id = 'ep_e'`,
  );
  assert.equal(ev!.detail.settled.length, 1);
  // Write mode records an unsettled blocker as a dispute; read mode never writes.
  const write = await openSession(
    db,
    "write",
    ["Fallout: Brotherhood of Steel"],
    [],
    NOW,
  );
  await write!.settle(
    {},
    [
      'Fact-check: "Brotherhood of Steel has a secret ending." - Not in the sources.',
    ],
    "ep_w",
    "test",
  );
  const [d] = await db.query<{ n: string }>(
    `SELECT count(*) n FROM fact_vault_disputes`,
  );
  assert.equal(Number(d!.n), 1);
});

test("the seed loads once, the first time the vault is read", async () => {
  const dir = await tmpDir();
  const { vault } = await vaultWith([
    {
      kind: "review_quote",
      claim: "x",
      value: "q",
      quote: "Fine enough.",
      outlet: "GameSpot",
    },
  ]);
  const file = path.join(dir, "seed.json.gz");
  fs.writeFileSync(
    file,
    zlib.gzipSync(JSON.stringify(await vault.exportAll())),
  );
  const db = await testDb();
  assert.equal(await seedOnce(db, file), 1);
  assert.equal(await seedOnce(db, file), 0);
  assert.equal((await new FactVault(db).stats()).facts, 1);
});

test("loadContext finds games a script names even when the step did not name them", async () => {
  const { vault } = await vaultWith([
    {
      kind: "review_quote",
      claim: "x",
      value: "q",
      quote: "Fine enough here.",
      outlet: "GameSpot",
    },
  ]);
  const ctx: VaultContext = await loadContext(
    vault,
    [],
    ["Brotherhood of Steel was a console spin-off."],
    NOW,
  );
  assert.deepEqual(
    ctx.entities.map((e) => e.id),
    ["game:fallout-brotherhood-of-steel"],
  );
});

test("a quote whose line names no game is placed by the entry it sits in, or by being one game's exact words", async () => {
  const db = await testDb();
  const vault = new FactVault(db);
  const add = (name: string, quote: string) =>
    vault.addFact({ entity: { kind: "game", name }, kind: "review_quote", claim: "q", value: "q", quote, outlet: "GameSpot", sourceUrl: `https://www.gamespot.com/reviews/${entityKey(name)}-review/`, sourceType: "review", origin: "seed", confidence: 0.9, checkedAt: NOW });
  await add("Fallout: Brotherhood of Steel", "The combat is very repetitive.");
  await add("Fallout Tactics: Brotherhood of Steel", "Squad tactics done right.");
  const ctx = await loadContext(vault, ["Fallout: Brotherhood of Steel", "Fallout Tactics: Brotherhood of Steel"], [], NOW);
  // Exact words of one game's review settle which game the line is about.
  assert.equal(resolveBlocker(parseBlocker(GAMESPOT_BLOCKER)!, ctx).status, "supported");
  // Words in neither review: the entry the line sits in decides, and the fix is a paraphrase.
  const other = 'Fact-check: "GameSpot called it “a slog.”" - The review attribution and exact quotation are unsupported.';
  assert.equal(resolveBlocker(parseBlocker(other)!, ctx).status, "unresolved");
  const full = "Number nine is Fallout Tactics: Brotherhood of Steel, a squad game. GameSpot called it “a slog.” Moving on.";
  const e = enforceBlockers({ n: full }, [other], ctx, full);
  assert.equal(e.remaining.length, 0);
  assert.match(e.script.n, /GameSpot called it a slog Moving on/);
});
