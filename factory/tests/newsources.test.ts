// The new source harvesters (20 Nov 2026): polite fetching, press kits (PRESS_KITS), achievement art
// (ACHIEVEMENT_ART) and wiki leads (WIKI_LEADS), in src/sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FANDOM_ROBOTS,
  LOGIN_WALL,
  parseRobots,
  politeFetcher,
  robotsAllows,
  RobotsRefused,
} from "../src/sources/polite.ts";
import {
  assetKind,
  entityIndex,
  harvestPressKits,
  kitImages,
  kitProvenance,
  PRESS_KIT_SOURCES,
  pressWithKits,
  readPressIndex,
  toAssets,
  writePressIndex,
  type PressKitSource,
} from "../src/sources/presskits.ts";
import {
  achievementsNamed,
  cardFilter,
  cardText,
  fitLine,
  mergeSchema,
  rarityTier,
  shareText,
  steamAchievements,
  TA_TT_VERDICT,
} from "../src/sources/achievementart.ts";
import {
  backs,
  findWikiLeads,
  isWikiUrl,
  leadNeeds,
  leadPrimaries,
  leadsFromHtml,
  leadText,
  sectionKind,
  splitMarked,
  standsAlone,
  wikiFor,
  type WikiLeadFile,
} from "../src/sources/wikileads.ts";
import {
  pickForLines,
  sourceBonus,
  PRESS_KIT_BONUS,
  type GameLibrary,
  type LibItem,
} from "../src/assets/gamelib.ts";
import { gameWords, PRESS_SITES } from "../src/assets/press.ts";
import { photoCreditOf, photoProvenance } from "../src/assets/libraries.ts";
import { packInput } from "../src/roomstep.ts";

const res = (body: string, status = 200, type = "text/plain") =>
  new Response(body, { status, headers: { "content-type": type } });

// ---------------------------------------------------------------- polite fetching

test("robots: our own group wins over *, the longest rule wins and Allow wins a tie", () => {
  const r = parseRobots(
    "User-agent: *\nDisallow: /\n\nUser-agent: PulseGamingFactory\nDisallow: /private/\nAllow: /private/open\nCrawl-delay: 3\n",
  );
  assert.equal(r.crawlDelaySeconds, 3);
  assert.equal(robotsAllows(r, "https://x.com/news"), true);
  assert.equal(robotsAllows(r, "https://x.com/private/a"), false);
  assert.equal(robotsAllows(r, "https://x.com/private/open/1"), true);
  const star = parseRobots(
    "User-agent: *\nDisallow: /search/\nDisallow: /?s=*\nAllow: /api.php?\nDisallow: /*.pdf$\n",
  );
  assert.equal(
    robotsAllows(star, "https://blog.playstation.com/search/gta/feed/rss2/"),
    false,
  );
  assert.equal(robotsAllows(star, "https://x.com/?s=gta"), false);
  assert.equal(robotsAllows(star, "https://x.com/a.pdf"), false);
  assert.equal(robotsAllows(star, "https://x.com/a.pdf?x=1"), true);
  assert.equal(robotsAllows(star, "https://x.com/feed/"), true);
  // Named bots' groups do not apply to us; an empty Disallow allows everything.
  const named = parseRobots(
    "User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n",
  );
  assert.equal(robotsAllows(named, "https://rockstargames.com/VI/media"), true);
});

test("polite fetcher: keeps to robots.txt, refuses login walls and bot challenges, and paces each host", async () => {
  const asked: string[] = [];
  let clock = 0;
  const slept: number[] = [];
  const challenge = () =>
    res("<html><title>Just a moment...</title></html>", 403, "text/html");
  const f = politeFetcher({
    gapMs: 1000,
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    fetchFn: async (url) => {
      asked.push(url);
      if (url === "https://a.com/robots.txt")
        return res("User-agent: *\nDisallow: /search/\n");
      if (url === "https://cf.com/robots.txt") return challenge();
      if (url === "https://wiki.fandom.com/robots.txt") return challenge();
      if (url === "https://none.com/robots.txt")
        return res("<html>not found</html>", 404, "text/html");
      return res("ok");
    },
  });
  assert.equal((await f("https://a.com/feed/")).status, 200);
  assert.equal((await f("https://a.com/feed/2")).status, 200);
  await assert.rejects(f("https://a.com/search/gta/"), RobotsRefused);
  await assert.rejects(f("https://cf.com/page"), /bot challenge/);
  await assert.rejects(f("https://a.com/user/login?next=/"), /login wall/);
  assert.equal((await f("https://none.com/anything")).status, 200);
  // Fandom: the challenge is replaced by the rules read by hand, the API only.
  assert.equal(
    (await f("https://wiki.fandom.com/api.php?action=parse&page=X")).status,
    200,
  );
  await assert.rejects(f("https://wiki.fandom.com/wiki/X"), RobotsRefused);
  assert.equal(
    robotsAllows(FANDOM_ROBOTS, "https://gta.fandom.com/api.php?action=parse"),
    true,
  );
  // robots.txt is read once per host, and the second request to a host waited for the gap.
  assert.equal(asked.filter((u) => u === "https://a.com/robots.txt").length, 1);
  assert.ok(slept.some((ms) => ms > 0));
  assert.equal(asked.includes("https://a.com/search/gta/"), false);
  assert.ok(LOGIN_WALL.test("https://press.ea.com/signin"));
});

test("polite fetcher: an unreachable robots.txt allows nothing and is asked again; redirects meet robots.txt; fetchers share a pace", async () => {
  let robotsCalls = 0;
  let down = true;
  const fetchFn = async (url: string) => {
    if (url === "https://b.com/robots.txt") {
      robotsCalls++;
      return down ? res("oops", 503) : res("User-agent: *\nDisallow: /private/\n");
    }
    if (url === "https://b.com/go") return new Response("", { status: 302, headers: { location: "/private/x" } });
    if (url === "https://b.com/go2") return new Response("", { status: 301, headers: { location: "https://b.com/ok" } });
    return res("fine");
  };
  const f = politeFetcher({ fetchFn, gapMs: 0 });
  await assert.rejects(f("https://b.com/page"), RobotsRefused);
  down = false;
  assert.equal((await f("https://b.com/page")).status, 200);
  assert.equal(robotsCalls, 2);
  await assert.rejects(f("https://b.com/go"), /robots\.txt/);
  assert.equal(await (await f("https://b.com/go2")).text(), "fine");
  const { newPoliteState } = await import("../src/sources/polite.ts");
  const state = newPoliteState();
  let clock = 0;
  const waits: number[] = [];
  const opts = {
    fetchFn: async () => res(""),
    gapMs: 1000,
    state,
    now: () => clock,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
  const one = politeFetcher(opts);
  const two = politeFetcher(opts);
  await one("https://c.com/a");
  await two("https://c.com/b");
  assert.ok(waits.some((ms) => ms > 0), "the second fetcher waited its turn");
  // A queue longer than the wait limit refuses instead of stalling a video.
  const slow = politeFetcher({ ...opts, state: newPoliteState(), gapMs: 60_000, maxWaitMs: 1000 });
  await assert.rejects(slow("https://d.com/a"), /too long/); // robots.txt took the host's turn
});

// ---------------------------------------------------------------- press kits

test("press kits: every source is recorded with checked terms; only editorial ones are harvested", () => {
  for (const s of PRESS_KIT_SOURCES) {
    assert.ok(s.terms.url.startsWith("https://"), s.id);
    assert.equal(s.terms.checked, "2026-11-20", s.id);
    assert.equal(Boolean(s.list), s.access === "auto", s.id);
    assert.equal(
      s.terms.allowedUse,
      s.access === "auto" ? "editorial" : "none",
      s.id,
    );
  }
  const ids = PRESS_KIT_SOURCES.map((s) => s.id);
  for (const want of [
    "rockstar",
    "xbox",
    "playstation",
    "nintendo",
    "capcom",
    "ea",
    "ubisoft",
    "squareenix",
    "sega",
    "bethesda",
    "steamdeck",
  ])
    assert.ok(ids.includes(want), want);
});

test("press kits: kinds, entities and the terms filter", () => {
  assert.equal(
    assetKind({ url: "https://x/GTAVI_Logo.png", title: "Logo", tags: [] }),
    "logo",
  );
  assert.equal(
    assetKind({ url: "https://x/keyart.jpg", title: "Key Art", tags: [] }),
    "key_art",
  );
  assert.equal(
    assetKind({
      url: "https://x/Vice_City_01.jpg",
      title: "Vice City 01",
      tags: [],
    }),
    "screenshot",
  );
  assert.equal(
    assetKind({ url: "https://x/t.mp4", title: "Trailer", tags: [] }),
    "video",
  );
  const src = PRESS_KIT_SOURCES.find((s) => s.id === "rockstar")!;
  const a = toAssets("GTA 6", src, [
    {
      url: "https://x/Vice_City_01.jpg",
      pageUrl: "https://p",
      title: "Vice City 01",
      tags: ["Vice City"],
    },
    {
      url: "https://x/Vice_City_01.jpg",
      pageUrl: "https://p",
      title: "dup",
      tags: [],
    },
    {
      url: "http://insecure/x.jpg",
      pageUrl: "https://p",
      title: "x",
      tags: [],
    },
  ]);
  assert.equal(a.length, 1);
  assert.equal(a[0]!.game, "Grand Theft Auto VI");
  assert.deepEqual(a[0]!.entities, ["Grand Theft Auto VI", "Vice City"]);
  assert.equal(a[0]!.terms.allowedUse, "editorial");
  const login = PRESS_KIT_SOURCES.find((s) => s.id === "nintendo")!;
  assert.equal(
    toAssets("Mario", login, [
      { url: "https://x/a.jpg", pageUrl: "https://p", title: "a", tags: [] },
    ]).length,
    0,
  );
  assert.equal(entityIndex({ assets: a }).get("vice city")?.length, 1);
  // The provenance keeps the existing press credit: "Image: Rockstar Games press".
  assert.equal(
    photoCreditOf({ kind: "article", provenance: kitProvenance(a[0]!) }),
    "Image: Rockstar Games press",
  );
});

test("press kits: harvest asks auto sources only, records refusals, and the index merges and feeds news Shorts first", async () => {
  const fake = (
    id: string,
    list: PressKitSource["list"],
    access: PressKitSource["access"] = "auto",
  ): PressKitSource => ({
    id,
    publisher: id.toUpperCase(),
    site: id,
    access,
    terms: {
      url: "https://t",
      summary: "editorial",
      allowedUse: access === "auto" ? "editorial" : "none",
      checked: "2026-11-20",
    },
    ...(list ? { list } : {}),
  });
  const idx = await harvestPressKits("Test Game", {
    fetch: politeFetcher({ fetchFn: async () => res("") }),
    sources: [
      fake("one", async () => [
        {
          url: "https://cdn/one.jpg",
          pageUrl: "https://p/1",
          title: "One",
          tags: [],
        },
        {
          url: "https://cdn/logo.png",
          pageUrl: "https://p/1",
          title: "Logo",
          tags: [],
        },
      ]),
      fake("two", async () => {
        throw new RobotsRefused("https://two/search", "robots.txt");
      }),
      fake("three", undefined, "login"),
    ],
  });
  assert.deepEqual(
    idx.sources.map((s) => [s.id, s.status, s.count]),
    [
      ["one", "ok", 2],
      ["two", "refused", 0],
      ["three", "skipped", 0],
    ],
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "presskit-"));
  await writePressIndex(root, idx);
  await writePressIndex(root, { ...idx, assets: [] }); // a later run that saw nothing keeps what was found
  const back = await readPressIndex(root, "Test Game");
  assert.equal(back?.assets.length, 2);
  const imgs = kitImages(back);
  assert.deepEqual(
    imgs.map((i) => i.url),
    ["https://cdn/one.jpg"],
  ); // logos are not scene pictures
  assert.equal(imgs[0]!.source, "press");
  const got = await pressWithKits({
    root,
    game: "Test Game",
    kits: true,
    live: async () => [{ ...imgs[0]!, url: "https://live/a.jpg" }, imgs[0]!],
  });
  assert.deepEqual(
    got.map((i) => i.url),
    ["https://cdn/one.jpg", "https://live/a.jpg"],
  );
  assert.deepEqual(
    await pressWithKits({ root, game: "Test Game", kits: false }),
    [],
  );
  assert.match(photoProvenance(imgs[0]!), /^Press image from ONE press/);
});

test("press feeds: PlayStation Blog is read from its main feed, never the search robots.txt forbids, and accents match", () => {
  const ps = PRESS_SITES.find((s) => s.id === "playstation")!;
  assert.equal(ps.url("gta"), "https://blog.playstation.com/feed/");
  assert.equal(
    ps.hosts.test("https://blog.playstation.com/tachyon/2026/x.jpg"),
    false,
  );
  assert.equal(
    ps.hosts.test("https://live.staticflickr.com/65535/1_o.jpg"),
    true,
  );
  assert.deepEqual(gameWords("Ghost of Yōtei"), ["ghost", "yotei"]);
});

test("picture choice: a press kit still beats IGDB and wiki art of the same fit; own footage still leads", () => {
  const item = (
    id: string,
    source: string,
    extra: Partial<LibItem> = {},
  ): LibItem => ({
    id,
    kind: "still",
    file: `${id}.jpg`,
    sourceUrl: id,
    provenance: id,
    source,
    named: [],
    tags: ["beach"],
    seen: "beach",
    addedAt: "",
    ...extra,
  });
  assert.equal(
    sourceBonus({ source: "Rockstar Games press kit", pressKit: true }),
    PRESS_KIT_BONUS,
  );
  assert.ok(sourceBonus({ source: "Fandom wiki" }) < 0);
  assert.equal(sourceBonus({ source: "IGDB" }), 0);
  const lib: GameLibrary = {
    version: 1,
    game: "Grand Theft Auto VI",
    updatedAt: "",
    items: [
      item("wiki", "GTA Wiki (Fandom)"),
      item("igdb", "IGDB"),
      item("kit", "Rockstar Games press kit", { pressKit: true }),
    ],
  };
  const want = {
    key: "beat:0",
    sentence: "the beach",
    game: "Grand Theft Auto VI",
    tags: ["beach"],
    names: [],
  };
  const libs = new Map([["Grand Theft Auto VI", lib]]);
  assert.equal(
    pickForLines(libs, [want], { preferVideo: false })[0]!.item.id,
    "kit",
  );
  lib.items.push(item("own", "own"));
  assert.equal(
    pickForLines(libs, [want], { preferVideo: false })[0]!.item.id,
    "own",
  );
});

// ---------------------------------------------------------------- achievements

test("achievements: the Web API schema merged with the global shares, and the keyless fallback", async () => {
  const schema = {
    game: {
      availableGameStats: {
        achievements: [
          {
            name: "A",
            displayName: "First Steps",
            description: "Start",
            hidden: 0,
            icon: "https://cdn/a.jpg",
          },
          {
            name: "B",
            displayName: "Elden Lord",
            description: "Secret",
            hidden: 1,
            icon: "b.jpg",
          },
          {
            name: "C",
            displayName: "No Share",
            description: "x",
            hidden: 0,
            icon: "c.jpg",
          },
        ],
      },
    },
  };
  const pct = {
    achievementpercentages: {
      achievements: [
        { name: "A", percent: "74.94" },
        { name: "B", percent: 0.83 },
      ],
    },
  };
  const list = mergeSchema(schema, pct, 42);
  assert.deepEqual(
    list.map((a) => [a.name, a.percent, a.hidden]),
    [
      ["Elden Lord", 0.8, true],
      ["First Steps", 74.9, false],
    ],
  );
  assert.equal(
    list[0]!.icon,
    "https://shared.akamai.steamstatic.com/community_assets/images/apps/42/b.jpg",
  );
  const asked: string[] = [];
  const viaApi = await steamAchievements(42, {
    apiKey: "k",
    fetchFn: async (u) => {
      asked.push(u);
      return new Response(
        JSON.stringify(/GetSchemaForGame/.test(u) ? schema : pct),
        { status: 200 },
      );
    },
    page: async () => assert.fail("the page is not read when the API answers"),
  });
  assert.equal(viaApi.via, "web api");
  assert.equal(asked.length, 2);
  assert.equal(
    (await steamAchievements(42, { page: async () => list })).via,
    "community page",
  );
  assert.equal(
    (await steamAchievements(42, { page: async () => [] })).via,
    "none",
  );
});

test("achievements: the card's words, rarity and filter (text from files, no expansion)", () => {
  assert.equal(rarityTier(0.4), "Ultra rare");
  assert.equal(rarityTier(4.9), "Very rare");
  assert.equal(rarityTier(12), "Rare");
  assert.equal(rarityTier(30), "Uncommon");
  assert.equal(rarityTier(70), "Common");
  assert.equal(shareText(0.05), "under 0.1%");
  assert.equal(shareText(5), "5%");
  assert.equal(shareText(5.94), "5.9%");
  assert.equal(shareText(12.6), "13%");
  assert.ok(fitLine("word ".repeat(60), 20).length <= 20);
  const hidden = cardText(
    {
      apiName: "B",
      name: "Elden Lord",
      description: "Achieved the ending",
      hidden: true,
      percent: 0.8,
    },
    "Elden Ring",
  );
  assert.equal(hidden.description, "Hidden achievement");
  assert.equal(hidden.share, "Unlocked by 0.8% of Steam players");
  assert.equal(hidden.credit, "Achievement data: Steam");
  const f = cardFilter(
    "C:/Windows/Fonts/arialbd.ttf",
    {
      game: "g",
      name: "n",
      description: "d",
      share: "s",
      tier: "t",
      credit: "c",
    },
    0.5,
  );
  assert.match(f, /expansion=none/);
  assert.match(f, /textfile=/);
  assert.match(f, /C\\:\/Windows/);
  const named = achievementsNamed(
    "Getting Elden Lord took me ages, then First Steps",
    [
      {
        apiName: "A",
        name: "First Steps",
        description: "",
        hidden: false,
        percent: 70,
      },
      {
        apiName: "B",
        name: "Elden Lord",
        description: "",
        hidden: true,
        percent: 1,
      },
      {
        apiName: "C",
        name: "Lord",
        description: "",
        hidden: false,
        percent: 1,
      },
    ],
  );
  assert.deepEqual(
    named.map((a) => a.name),
    ["Elden Lord", "First Steps"],
  );
});

test("TrueAchievements and TrueTrophies: not used, with their terms on record", () => {
  assert.equal(TA_TT_VERDICT.use, false);
  assert.equal(TA_TT_VERDICT.terms.length, 2);
  for (const t of TA_TT_VERDICT.terms) {
    assert.match(
      t.url,
      /^https:\/\/www\.true(achievements|trophies)\.com\/termsandconditions\.aspx$/,
    );
    assert.ok(t.quotes.some((q) => /Unauthorised use/.test(q)));
  }
});

// ---------------------------------------------------------------- wiki leads

const WIKI_HTML = `<div class="mw-parser-output">
<p>Grand Theft Auto VI is a game.</p>
<div class="mw-heading mw-heading2"><h2>Development</h2></div>
<p>In 2015, developers from Rockstar North made their first trips to Miami, Florida, for research.<sup class="reference"><a href="#cite_note-1">[1]</a></sup> The trailer drew 90 million views in 24 hours on YouTube. Some say it might be the biggest launch ever.<sup class="reference"><a href="#cite_note-2">[2]</a></sup></p>
<h2>Trivia</h2>
<ul><li>This is the equivalent of 20 movies.<sup class="reference"><a href="#cite_note-1">[1]</a></sup></li>
<li>Lucia Caminos is the first female protagonist in the series since 1997, according to Rockstar Games.<sup class="reference"><a href="#cite_note-3">[3]</a></sup></li>
<li>Jason Duval was a soldier before the events of the game, and lives in the Keys with his friends.</li></ul>
<h2>Gallery</h2><p>Ignored section text that is long enough to count as a lead otherwise, with 2030 in it.</p>
<ol class="references">
<li id="cite_note-1"><a href="https://www.theguardian.com/games/making-of">Guardian</a></li>
<li id="cite_note-2"><a href="https://www.livemint.com/gta-6-trailer-record">Mint</a> <a href="https://gta.fandom.com/wiki/Trailer">wiki</a></li>
<li id="cite_note-3"><a href="https://en.wikipedia.org/wiki/GTA">Wikipedia</a></li>
</ol></div>`;

test("wiki leads: sentences under lead sections with their own citations; wikis never count as a source", () => {
  assert.equal(sectionKind("Behind the scenes"), "development");
  assert.equal(sectionKind("Trivia"), "trivia");
  assert.equal(sectionKind("Gallery"), undefined);
  const leads = leadsFromHtml(
    WIKI_HTML,
    "GTA 6",
    "https://gta.fandom.com/wiki/Grand_Theft_Auto_VI",
  );
  const by = (start: string) => leads.find((l) => l.text.startsWith(start));
  assert.deepEqual(by("In 2015")?.refs, [
    "https://www.theguardian.com/games/making-of",
  ]);
  // A sentence with no citation takes its paragraph's next one; the wiki link in that note is dropped.
  assert.deepEqual(by("The trailer drew")?.refs, [
    "https://www.livemint.com/gta-6-trailer-record",
  ]);
  assert.equal(by("Some say")?.status, "speculative");
  assert.equal(by("This is the equivalent"), undefined); // leans on the sentence before it
  assert.equal(by("Lucia Caminos")?.status, "unsourced"); // its only citation is Wikipedia
  assert.equal(by("Jason Duval")?.status, "unsourced");
  assert.equal(
    leads.some((l) => /Ignored section/.test(l.text)),
    false,
  );
  assert.equal(by("In 2015")?.game, "Grand Theft Auto VI");
  assert.ok(isWikiUrl("https://terraria.wiki.gg/wiki/X"));
  assert.ok(!isWikiUrl("https://www.ign.com/articles/x"));
});

test("wiki leads: what a source must say, and lines that cannot stand alone", () => {
  assert.deepEqual(splitMarked("A did B. [[ref:x]] Then C did D. [[ref:y]]"), [
    { text: "A did B.", ids: ["x"] },
    { text: "Then C did D.", ids: ["y"] },
  ]);
  assert.equal(standsAlone('When that will be, God only knows."'), false);
  assert.equal(
    standsAlone(
      "According to writer Drew Karpyshyn, this is the equivalent of 20 movies.",
    ),
    false,
  );
  assert.equal(
    standsAlone("Fallout 4 shipped 12 million copies to meet day one demand."),
    true,
  );
  const n = leadNeeds(
    "Cyberpunk 2077 had more than 8 million preorders on Thursday, said CD Projekt.",
    "Cyberpunk 2077",
  );
  assert.deepEqual(n.figures, ["8 million"]); // the title's own number is not evidence, "8 million" is
  assert.deepEqual(n.names, ["CD Projekt"]);
  const lead = {
    text: "In 2015, developers from Rockstar North made their first trips to Miami, Florida.",
    game: "Grand Theft Auto VI",
  };
  assert.ok(
    backs(
      "Back in 2015 a Rockstar North team flew to Miami and toured Florida's Keys.",
      lead,
    ),
  );
  assert.equal(backs("Rockstar North flew to Miami in 2016.", lead), undefined); // the year is wrong
  assert.equal(backs("In 2015 someone went somewhere.", lead), undefined); // the names are missing
  // Figures are checked with their units and as whole numbers.
  const sold = { text: "Fallout 4 shipped 12 million copies to meet day one demand, said Bethesda.", game: "Fallout 4" };
  assert.ok(backs("Bethesda says Fallout 4 shipped 12 million units on day one.", sold));
  assert.equal(backs("Bethesda spent 12 years on Fallout 4.", sold), undefined);
  assert.equal(backs("Bethesda shipped 12.5 million copies.", sold), undefined);
  assert.equal(backs("Bethesda shipped 120 million copies.", sold), undefined);
  const dec = { text: "The game sold 8.5 million copies by March, Capcom said.", game: "Monster Hunter Wilds" };
  assert.ok(backs("Capcom: the game has sold 8.5 million copies.", dec));
  assert.equal(backs("Capcom: the game has sold 8 million copies and 5 more.", dec), undefined);
  // Every name is needed (all but one from four).
  const many = { text: "Dan Houser, Sam Houser, Leslie Benzies and Aaron Garbut founded Rockstar North in 2002.", game: "Grand Theft Auto VI" };
  assert.equal(backs("In 2002 Dan Houser and Sam Houser founded it.", many), undefined);
  assert.ok(backs("In 2002 Dan Houser, Sam Houser, Leslie Benzies and Rockstar North did it, said Aaron.", many));
  // A bare year is not enough on its own, and a borrowed citation needs a name and a figure.
  assert.equal(backs("It happened in 2019.", { text: "The first patch arrived in 2019 after much waiting.", game: "X" }), undefined);
  assert.equal(backs("Rockstar North and Miami.", { text: "Rockstar North scouted Miami for the city.", game: "Grand Theft Auto VI", borrowed: true }), undefined);
  assert.ok(isWikiUrl("https://www.ign.com/wikis/gta-6/Trivia"));
  assert.ok(isWikiUrl("https://www.pcgamingwiki.com/wiki/X"));
  assert.ok(isWikiUrl("https://web.archive.org/web/2020/https://en.wikipedia.org/wiki/X"));
});

test("wiki leads: checked at the primary source, then given to the writers as the primary's words only", async () => {
  const api = "https://gta.fandom.com/api.php";
  const fetchFn = async (url: string) => {
    if (url.endsWith("/robots.txt"))
      return res("<html>Just a moment...</html>", 403, "text/html");
    if (url.startsWith(api) && url.includes("page=Grand+Theft+Auto+VI&"))
      return new Response(
        JSON.stringify({
          parse: { title: "Grand Theft Auto VI", text: WIKI_HTML },
        }),
        { status: 200 },
      );
    if (url.startsWith(api))
      return new Response(JSON.stringify({ error: { code: "missingtitle" } }), {
        status: 200,
      });
    return res("", 404);
  };
  const read = async (url: string) =>
    url.includes("theguardian")
      ? {
          url,
          title: "Inside the making of GTA VI",
          text: "In 2015 a team from Rockstar North made trips to Miami, Florida to research the city.\n".repeat(
            5,
          ),
        }
      : url.includes("livemint")
        ? {
            url,
            title: "GTA 6 trailer record",
            text: "The trailer passed 90 million views on YouTube within 24 hours, a record.\n".repeat(
              5,
            ),
          }
        : undefined;
  const f = await findWikiLeads("GTA 6", {
    fetch: politeFetcher({ fetchFn, gapMs: 0 }),
    read,
  });
  assert.equal(f.wiki, api);
  const verified = f.leads.filter((l) => l.status === "verified");
  assert.deepEqual(verified.map((l) => l.primary!.url).sort(), [
    "https://www.livemint.com/gta-6-trailer-record",
    "https://www.theguardian.com/games/making-of",
  ]);
  const prim = leadPrimaries(f);
  assert.equal(prim.length, 2);
  for (const p of prim) {
    assert.equal(isWikiUrl(p.url), false);
    assert.doesNotMatch(`${p.title} ${p.text}`, /wiki|fandom/i);
    // Only the primary's own words: never the wiki's sentence.
    for (const l of f.leads) assert.equal(p.text.includes(l.text), false, l.text);
  }
  // Given the story, only leads it mentions.
  assert.equal(leadPrimaries(f, 3, "Rockstar North opens a new office").length, 1);
  assert.match(leadText(f), /90 million views/);
  // The writers' room reads them as primary sources.
  const input = await packInput({
    llm: {} as never,
    cfg: {
      scriptRoomViewer: false,
      scriptRoomRounds: 1,
      scriptRoomMin: 0,
      scriptRoomLinks: false,
    },
    cluster: { headline: "h", items: [], gameHint: "GTA 6" } as never,
    articles: [],
    mustLabelRumour: false,
    leadPrimaries: prim,
  });
  assert.equal(input.primaries?.length, 2);
});

test("wiki leads: the right wiki per game", () => {
  assert.equal(wikiFor("GTA 6").api, "https://gta.fandom.com/api.php");
  assert.deepEqual(wikiFor("GTA 6").pages, [
    "Grand Theft Auto VI",
    "Grand Theft Auto VI/Trivia",
    "Grand Theft Auto VI/Development",
  ]);
  assert.equal(wikiFor("Terraria").api, "https://terraria.wiki.gg/api.php");
  assert.equal(wikiFor("Hades II").api, "https://hades.fandom.com/api.php");
  const empty: WikiLeadFile = {
    version: 1,
    game: "x",
    wiki: "",
    updatedAt: "",
    leads: [],
  };
  assert.deepEqual(leadPrimaries(empty), []);
});

test("background refresh: a missing or week-old file is refreshed once, never twice within six hours", async () => {
  const { due, inBackground } = await import("../src/sources/refresh.ts");
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.equal(due(undefined, now), true);
  assert.equal(due("2026-11-19T12:00:00Z", now), false);
  assert.equal(due("2026-11-10T12:00:00Z", now), true);
  let runs = 0;
  const work = async () => {
    runs++;
  };
  assert.equal(inBackground("t:one", work, now), true);
  assert.equal(inBackground("t:one", work, now + 3_600_000), false);
  await new Promise((r) => setTimeout(r, 10)); // the first run has finished
  assert.equal(inBackground("t:one", work, now + 7 * 3_600_000), true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(runs, 2);
});
