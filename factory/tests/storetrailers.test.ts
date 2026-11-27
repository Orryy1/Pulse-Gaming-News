// STORE_TRAILERS: parsers, matcher, robots.txt and the polite client, on answers recorded from the stores on 25 Nov
// 2026 (tests/fixtures/storetrailers). No test makes a network call: the client's fetch is a fake.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PoliteClient,
  STORE_USER_AGENT,
  cacheVideo,
  coreWords,
  findEpic,
  findNintendo,
  findPlayStation,
  findXbox,
  matchStoreProduct,
  ownerFromStorePublisher,
  parseEpicProduct,
  parseHlsMedia,
  parseNintendoPage,
  parsePsGamePage,
  parsePsProductPage,
  parseRobots,
  parseXboxProducts,
  parseXboxSuggest,
  pruneCache,
  pickHlsVariant,
  rankVideos,
  rightsLabel,
  singleFile,
  sitemapSlugs,
  slugCandidates,
  storeOrder,
  storeTrailersFor,
} from "../src/assets/storetrailers.ts";
import { officialMedia, ownerCapSeconds, trailerFrames } from "../src/assets/officialTrailer.ts";

const FIX = path.join(import.meta.dirname, "fixtures", "storetrailers");
const fx = (f: string) => fs.readFile(path.join(FIX, f), "utf8");

/** A fake fetch over a URL table; every call is logged with its time and headers. */
function fakeWeb(
  table: Record<
    string,
    string | { status: number; body?: string; headers?: Record<string, string> }
  >,
  clock: { t: number },
) {
  const calls: Array<{ url: string; at: number; ua?: string }> = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({
      url,
      at: clock.t,
      ua: (init.headers as Record<string, string>)["user-agent"],
    });
    const hit = table[url];
    if (hit === undefined) return new Response("not found", { status: 404 });
    const r = typeof hit === "string" ? { status: 200, body: hit } : hit;
    return new Response(r.body ?? "", { status: r.status, headers: r.headers });
  };
  return { calls, fetchImpl };
}

const temps: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return d;
}
after(async () => {
  for (const d of temps) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});

async function client(table: Parameters<typeof fakeWeb>[0]) {
  const clock = { t: 1_800_000_000_000 };
  const web = fakeWeb(table, clock);
  const cacheDir = await tmp("storetrailers-");
  const http = new PoliteClient({
    cacheDir,
    fetchImpl: web.fetchImpl,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
  });
  return { http, clock, web, cacheDir };
}

// ------------------------------------------------------------------ matching

test("the matcher takes the game and its editions, never another game, a remake or an add-on", () => {
  assert.equal(
    matchStoreProduct(
      "Grand Theft Auto VI",
      2026,
      "Grand Theft Auto VI: Ultimate Edition",
      2026,
    ),
    "same",
  );
  assert.equal(
    matchStoreProduct(
      "Marvel's Spider-Man 2",
      2023,
      "Marvel’s Spider-Man 2",
      2023,
    ),
    "same",
  );
  assert.equal(
    matchStoreProduct(
      "Zelda: Tears of the Kingdom",
      2023,
      "The Legend of Zelda™: Tears of the Kingdom",
      2023,
    ),
    "same",
  );
  assert.equal(
    matchStoreProduct("Spider-Man 2", 2023, "Marvel's Spider-Man 2", 2023),
    "same",
  );
  // Another entry or another product of the series.
  assert.equal(
    matchStoreProduct(
      "Marvel's Spider-Man 2",
      2023,
      "Marvel's Spider-Man Remastered",
      2022,
    ),
    undefined,
  );
  assert.equal(
    matchStoreProduct("Grand Theft Auto VI", 2026, "Grand Theft Auto V", 2013),
    undefined,
  );
  assert.equal(
    matchStoreProduct("Fortnite", 2017, "Fortnite Festival", 2023),
    undefined,
  );
  assert.equal(
    matchStoreProduct("Fortnite", 2017, "LEGO Fortnite", 2023),
    undefined,
  );
  assert.equal(
    matchStoreProduct(
      "Grand Theft Auto VI",
      2026,
      "Grand Theft Auto VI: Vintage Vice City Pack",
      2026,
    ),
    undefined,
  );
  assert.equal(
    matchStoreProduct(
      "Grand Theft Auto VI",
      2026,
      "Grand Theft Auto VI: Ultimate Edition Upgrade",
      2026,
    ),
    undefined,
  );
  // A remake with the old name, by its year; an older game for a newer one.
  assert.equal(
    matchStoreProduct("Resident Evil 4", 2005, "Resident Evil 4", 2023),
    undefined,
  );
  assert.equal(
    matchStoreProduct("Resident Evil 4", 2023, "Resident Evil 4", 2005),
    undefined,
  );
  assert.equal(
    matchStoreProduct(
      "Shadow of the Colossus",
      2005,
      "Shadow of the Colossus Remake",
      2018,
    ),
    undefined,
  );
});

test("later editions and asked-for collections follow STEAM_EDITIONS", () => {
  assert.equal(
    matchStoreProduct(
      "Mass Effect 2",
      2010,
      "Mass Effect™ Legendary Edition",
      2021,
      { asked: "Mass Effect Legendary Edition" },
    ),
    "collection",
  );
  // Not asked for by name: a series collection is not taken.
  assert.equal(
    matchStoreProduct(
      "Mass Effect 2",
      2010,
      "Mass Effect™ Legendary Edition",
      2021,
    ),
    undefined,
  );
  // STEAM_EDITIONS off: only the game itself.
  assert.equal(
    matchStoreProduct(
      "Mass Effect 2",
      2010,
      "Mass Effect Legendary Edition",
      2021,
      { asked: "Mass Effect Legendary Edition", editions: false },
    ),
    undefined,
  );
  assert.equal(
    matchStoreProduct(
      "Grand Theft Auto V",
      2013,
      "Grand Theft Auto V: Premium Edition",
      2014,
    ),
    "same",
  );
  assert.equal(
    matchStoreProduct(
      "Grand Theft Auto V",
      2013,
      "Grand Theft Auto V Enhanced",
      2022,
    ),
    "edition",
  );
});

test("core words drop platforms, editions and trademarks but keep sequel numbers", () => {
  assert.deepEqual(coreWords("Grand Theft Auto VI: Ultimate Edition"), [
    "grand",
    "theft",
    "auto",
    "6",
  ]);
  assert.deepEqual(
    coreWords(
      "The Legend of Zelda™: Tears of the Kingdom – Nintendo Switch 2 Edition",
    ),
    ["legend", "of", "zelda", "tears", "of", "kingdom"],
  );
  assert.deepEqual(coreWords("Halo Infinite (Xbox Series X|S)"), [
    "halo",
    "infinite",
  ]);
});

// ------------------------------------------------------------------ parsers

test("Microsoft catalog: games only from autosuggest; trailers with their hosts from products", async () => {
  assert.deepEqual(
    parseXboxSuggest(JSON.parse(await fx("xbox_suggest_halo.json"))).map(
      (x) => x.id,
    ),
    ["9NP1P1WFS0LB", "9PP5G1F0C2B6"],
  );
  const [gta, fn] = parseXboxProducts(
    JSON.parse(await fx("xbox_products_gta6_fortnite.json")),
  );
  assert.equal(gta!.name, "Grand Theft Auto VI");
  assert.equal(gta!.videos.length, 4);
  assert.ok(
    gta!.videos.every(
      (v) =>
        v.kind === "hls" &&
        v.height === 1080 &&
        v.url.startsWith("https://cdn.trailers.xboxservices.com/"),
    ),
  );
  assert.equal(gta!.videos[0]!.caption, "Grand Theft Auto VI Trailer 1");
  assert.equal(fn!.name, "Fortnite");
  const halo = parseXboxProducts(
    JSON.parse(await fx("xbox_products_halo.json")),
  );
  // Halo's trailers are on the host that refuses this PC by IP: present in the data, filtered by findXbox.
  assert.ok(
    halo[0]!.videos.every((v) =>
      v.url.includes("cdn-dynmedia-1.microsoft.com"),
    ),
  );
});

test("PlayStation: the game page names its products and videos; the store page its previews", async () => {
  const gta = parsePsGamePage(await fx("ps_game_gta6.html"));
  assert.equal(gta.products[0]!.name, "Grand Theft Auto VI: Ultimate Edition");
  assert.equal(gta.products[0]!.productType, "GAME_BUNDLE");
  const sm = parsePsGamePage(await fx("ps_game_spiderman2.html"));
  assert.ok(
    sm.products.some(
      (p) => p.productId === "UP9000-PPSA03016_00-MARVELSPIDERMAN2",
    ),
  );
  assert.ok(
    sm.videos.length >= 3 &&
      sm.videos.every(
        (v) => !/-ma-/.test(v.url) && v.host === "PlayStation.com",
      ),
  );
  const sp = parsePsProductPage(
    await fx("ps_product_spiderman2.html"),
    "UP9000-PPSA03016_00-MARVELSPIDERMAN2",
  );
  assert.equal(sp.name, "Marvel’s Spider-Man 2");
  assert.equal(sp.releaseDate, "2023-10-20T04:00:00Z");
  assert.equal(sp.videos.length, 3);
  assert.ok(
    sp.videos.every(
      (v) =>
        v.url.startsWith("https://vulcan.dl.playstation.net/") &&
        v.kind === "mp4",
    ),
  );
});

test("Epic and Nintendo product data give their trailer files", async () => {
  const ep = parseEpicProduct(
    JSON.parse(await fx("epic_mele.json")),
    "mass-effect-legendary-edition",
  )!;
  assert.equal(ep.name, "Mass Effect Legendary Edition");
  assert.equal(ep.videos.length, 1);
  assert.match(
    ep.videos[0]!.url,
    /^https:\/\/media-cdn\.epicgames\.com\/.+\.m3u8$/,
  );
  const nz = parseNintendoPage(
    await fx("nintendo_totk.html"),
    "the-legend-of-zelda-tears-of-the-kingdom-switch",
  )!;
  assert.match(nz.name, /Tears of the Kingdom/);
  assert.ok(nz.videos.length >= 7);
  assert.ok(
    nz.videos.some(
      (v) =>
        v.url ===
        "https://assets.nintendo.com/video/upload/Microsites/zelda-tears-of-the-kingdom/videos/totk_microsite_officialtrailer1.mp4",
    ),
  );
  assert.ok(nz.videos.every((v) => !v.url.includes("upload//")));
});

test("sitemaps give slugs; the candidates are the game's own pages", async () => {
  const ps = sitemapSlugs(await fx("ps_sitemap.xml"), "/en-us/games/");
  assert.ok(ps.includes("grand-theft-auto-vi"));
  assert.deepEqual(slugCandidates(ps, "Grand Theft Auto VI"), [
    "grand-theft-auto-vi",
  ]);
  assert.equal(
    slugCandidates(ps, "Marvel's Spider-Man 2")[0],
    "marvels-spider-man-2",
  );
  assert.ok(
    !slugCandidates(ps, "Fortnite").includes("lego-fortnite") ||
      slugCandidates(ps, "Fortnite")[0] === "fortnite",
  );
  assert.equal(
    slugCandidates(ps, "Mass Effect 2", "Mass Effect Legendary Edition")[0],
    "mass-effect-legendary-edition",
  );
  const n = sitemapSlugs(
    await fx("nintendo_sitemap.xml"),
    "/us/store/products/",
  );
  assert.equal(
    slugCandidates(n, "The Legend of Zelda: Tears of the Kingdom")[0],
    "the-legend-of-zelda-tears-of-the-kingdom-switch",
  );
  assert.equal(
    slugCandidates(n, "Zelda: Tears of the Kingdom")[0],
    "the-legend-of-zelda-tears-of-the-kingdom-switch",
  );
});

test("HLS: the best variant up to 1080p, and a byte-ranged single file is one request", () => {
  const master = [
    "#EXTM3U",
    '#EXT-X-STREAM-INF:BANDWIDTH=3308108,RESOLUTION=1280x720,AUDIO="audio"',
    "Video/4/manifest.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=4574225,RESOLUTION=1920x1080,AUDIO="audio"',
    "Video/5/manifest.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=5902890,RESOLUTION=1920x1080,AUDIO="audio"',
    "Video/6/manifest.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=19000000,RESOLUTION=3840x2160",
    "Video/7/manifest.m3u8",
  ].join("\n");
  assert.equal(pickHlsVariant(master), "Video/6/manifest.m3u8");
  const ranged = parseHlsMedia(
    "#EXTM3U\n#EXTINF:6.006,\n#EXT-X-BYTERANGE:100@0\nv.ts\n#EXTINF:6.006,\n#EXT-X-BYTERANGE:50@100\nv.ts\n#EXTINF:3,\n#EXT-X-BYTERANGE:25\nv.ts\n",
  );
  assert.deepEqual(singleFile(ranged), { uri: "v.ts", bytes: 175 });
  const fmp4 = parseHlsMedia(
    '#EXTM3U\n#EXT-X-MAP:URI="init.cmfi"\n#EXTINF:7,\nsegment_1.cmfv\n#EXT-X-MAP:URI="init.cmfi"\n#EXTINF:7,\nsegment_2.cmfv\n',
  );
  assert.equal(fmp4.init, "init.cmfi");
  assert.equal(fmp4.segments.length, 2);
  assert.equal(singleFile(fmp4), undefined);
});

test("rights labels, store order and publisher owners", () => {
  assert.equal(
    rightsLabel("PlayStation Store"),
    "Official trailer (PlayStation Store)",
  );
  assert.deepEqual(storeOrder("PlayStation"), [
    "playstation",
    "xbox",
    "epic",
    "nintendo",
  ]);
  assert.deepEqual(storeOrder("Nintendo"), [
    "nintendo",
    "playstation",
    "xbox",
    "epic",
  ]);
  assert.deepEqual(storeOrder("Xbox", ["playstation", "xbox"]), [
    "xbox",
    "playstation",
  ]);
  assert.equal(
    ownerFromStorePublisher("Sony Interactive Entertainment"),
    "PlayStation",
  );
  assert.equal(ownerFromStorePublisher("Electronic Arts Inc"), "EA");
  assert.equal(ownerFromStorePublisher("Rockstar Games"), "Rockstar Games");
  assert.equal(
    rankVideos([
      { caption: "hero banner loop", url: "a", kind: "mp4", host: "x" },
      { caption: "Launch Trailer", url: "b", kind: "mp4", host: "x" },
    ])[0]!.url,
    "b",
  );
});

// ------------------------------------------------------------------ robots.txt and the polite client

test("robots.txt: named bots refused, everyone else allowed; wildcards, anchors and crawl delay", async () => {
  const n = parseRobots(await fx("nintendo_robots.txt"));
  assert.equal(n.allowed("/us/store/products/x/"), true);
  assert.equal(
    parseRobots(await fx("nintendo_robots.txt"), "nutch").allowed("/us/"),
    false,
  );
  const r = parseRobots(
    "User-agent: *\nDisallow: /*search?q*\nDisallow: /chihiro-api/\nAllow: /chihiro-api/ok$\nCrawl-delay: 5\n\nUser-agent: other\nDisallow: /\n",
  );
  assert.equal(r.allowed("/en-us/search?q=x"), false);
  assert.equal(r.allowed("/chihiro-api/x"), false);
  assert.equal(r.allowed("/chihiro-api/ok"), true);
  assert.equal(r.allowed("/en-us/games/fortnite/"), true);
  assert.equal(r.crawlDelay, 5);
  assert.equal(
    parseRobots(
      "User-agent: PulseGamingNewsBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n",
    ).allowed("/x"),
    false,
  );
});

test("the client waits 1.5 s per host (longer when robots.txt asks), caches, and names itself", async () => {
  const { http, web } = await client({
    "https://a.example/robots.txt": "User-agent: *\nAllow: /\n",
    "https://a.example/1": "one",
    "https://a.example/2": "two",
    "https://b.example/robots.txt": "User-agent: *\nCrawl-delay: 5\n",
    "https://b.example/1": "b1",
    "https://b.example/2": "b2",
  });
  assert.equal(await http.text("https://a.example/1", 24), "one");
  assert.equal(await http.text("https://a.example/2", 24), "two");
  assert.equal(await http.text("https://b.example/1", 24), "b1");
  assert.equal(await http.text("https://b.example/2", 24), "b2");
  const a = web.calls.filter((c) => c.url.startsWith("https://a."));
  for (let i = 1; i < a.length; i++)
    assert.ok(
      a[i]!.at - a[i - 1]!.at >= 1500,
      `gap ${a[i]!.at - a[i - 1]!.at}`,
    );
  const b = web.calls.filter(
    (c) => c.url.startsWith("https://b.") && !c.url.endsWith("robots.txt"),
  );
  assert.ok(b[1]!.at - b[0]!.at >= 5000);
  assert.ok(
    web.calls.every(
      (c) => c.ua === STORE_USER_AGENT && !/mozilla|chrome|safari/i.test(c.ua!),
    ),
  );
  const before = web.calls.length;
  assert.equal(await http.text("https://a.example/1", 24), "one");
  assert.equal(
    web.calls.length,
    before,
    "the second ask is answered from the cache",
  );
});

test("a 429 or 403 stops all asking of that host for a day, remembered across clients; robots.txt refusals are kept", async () => {
  const { http, web, cacheDir, clock } = await client({
    "https://c.example/robots.txt": "User-agent: *\nDisallow: /private/\n",
    "https://c.example/limited": {
      status: 429,
      headers: { "retry-after": "60" },
    },
    "https://c.example/fine": "ok",
  });
  assert.equal(await http.text("https://c.example/private/x", 24), undefined);
  assert.ok(
    !web.calls.some((c) => c.url.includes("/private/")),
    "robots.txt refused it: never asked",
  );
  assert.equal((await http.get("https://c.example/limited", 24)).status, 429);
  const n = web.calls.length;
  assert.equal(
    (await http.get("https://c.example/fine", 24)).refused,
    "blocked",
  );
  assert.equal(web.calls.length, n, "no request while backed off");
  // A new client on the same cache folder keeps the stop.
  const again = new PoliteClient({
    cacheDir,
    fetchImpl: web.fetchImpl,
    now: () => clock.t,
    sleep: async () => undefined,
  });
  assert.equal(await again.isBlocked("c.example"), true);
  clock.t += 25 * 3_600_000;
  assert.equal(await again.isBlocked("c.example"), false);
});

test("robots.txt per RFC 9309: a server error keeps us out; a 4xx allows, and a 403 on the real request stops the host", async () => {
  const { http, web } = await client({ "https://down.example/robots.txt": { status: 503 }, "https://down.example/api": "x" });
  assert.equal(await http.text("https://down.example/api", 24), undefined);
  assert.ok(!web.calls.some((c) => c.url.endsWith("/api")));
  const s3 = await client({ "https://s3.example/robots.txt": { status: 403, body: "AccessDenied" }, "https://s3.example/a": "ok", "https://s3.example/b": { status: 403 } });
  assert.equal(await s3.http.text("https://s3.example/a", 24), "ok");
  assert.equal(await s3.http.text("https://s3.example/b", 24), undefined);
  assert.equal(await s3.http.isBlocked("s3.example"), true);
});

// ------------------------------------------------------------------ the store flows on recorded data

async function recordedWeb() {
  const xboxSuggest = await fx("xbox_suggest_halo.json");
  return {
    "https://displaycatalog.mp.microsoft.com/robots.txt": { status: 404 },
    "https://www.playstation.com/robots.txt":
      "User-agent: *\nDisallow: */search/?q*\n",
    "https://store.playstation.com/robots.txt":
      "User-agent: *\nDisallow: /chihiro-api/\n",
    "https://store-content-ipv4.ak.epicgames.com/robots.txt": { status: 404 },
    "https://www.nintendo.com/robots.txt": await fx("nintendo_robots.txt"),
    "https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?market=US&languages=en-us&query=Halo%20Infinite&productFamilyNames=Games":
      xboxSuggest,
    "https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=9NP1P1WFS0LB,9PP5G1F0C2B6&market=US&languages=en-us":
      await fx("xbox_products_halo.json"),
    "https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?market=US&languages=en-us&query=Grand%20Theft%20Auto%20VI&productFamilyNames=Games":
      JSON.stringify({
        Results: [
          {
            Products: [
              {
                ProductId: "9NP019G7NZXT",
                Type: "Game",
                Title: "Grand Theft Auto VI",
              },
              { ProductId: "BT5P2X999VH2", Type: "Game", Title: "Fortnite" },
              {
                ProductId: "9PN4LLBR8RCH",
                Type: "Durable",
                Title: "Grand Theft Auto VI: Ultimate Edition Upgrade",
              },
            ],
          },
        ],
      }),
    "https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=9NP019G7NZXT&market=US&languages=en-us":
      JSON.stringify({
        Products: JSON.parse(
          await fx("xbox_products_gta6_fortnite.json"),
        ).Products.slice(0, 1),
      }),
    "https://www.playstation.com/en-us/sitemap.xml": await fx("ps_sitemap.xml"),
    "https://www.playstation.com/en-us/games/marvels-spider-man-2/": await fx(
      "ps_game_spiderman2.html",
    ),
    "https://store.playstation.com/en-us/product/UP9000-PPSA03016_00-MARVELSPIDERMAN2":
      await fx("ps_product_spiderman2.html"),
    "https://store-content-ipv4.ak.epicgames.com/api/en-US/content/products/mass-effect-legendary-edition":
      await fx("epic_mele.json"),
    "https://www.nintendo.com/us/store/sitemap.xml": await fx(
      "nintendo_sitemap.xml",
    ),
    "https://www.nintendo.com/us/store/products/the-legend-of-zelda-tears-of-the-kingdom-switch/":
      await fx("nintendo_totk.html"),
  } as Parameters<typeof fakeWeb>[0];
}

test("each store finds its product from recorded answers", async () => {
  const { http } = await client(await recordedWeb());
  const gta = await findXbox(http, { game: "Grand Theft Auto VI", year: 2026 });
  assert.equal(gta?.name, "Grand Theft Auto VI");
  assert.equal(gta?.videos.length, 4);
  // Halo's only trailers are on the host that refuses this PC: none are offered.
  const halo = await findXbox(http, { game: "Halo Infinite", year: 2021 });
  assert.equal(halo?.videos.length, 0);
  const sm = await findPlayStation(http, {
    game: "Marvel's Spider-Man 2",
    year: 2023,
  });
  assert.equal(sm?.id, "UP9000-PPSA03016_00-MARVELSPIDERMAN2");
  assert.ok(
    sm!.videos.length >= 6,
    "store previews and playstation.com videos",
  );
  const me = await findEpic(http, {
    game: "Mass Effect 2",
    year: 2010,
    asked: "Mass Effect Legendary Edition",
  });
  assert.equal(me?.name, "Mass Effect Legendary Edition");
  assert.equal(
    await findEpic(http, { game: "Mass Effect 2", year: 2010 }),
    undefined,
    "the collection only when asked for",
  );
  const z = await findNintendo(http, {
    game: "The Legend of Zelda: Tears of the Kingdom",
    year: 2023,
  });
  assert.match(z!.name, /Tears of the Kingdom/);
});

test("storeTrailersFor downloads into the cache, labels by store and respects the disk floor", async () => {
  const web = await recordedWeb();
  const big = "x".repeat(150_000);
  web[
    "https://vulcan.dl.playstation.net/img/rnd/202310/1911/581f17941d507be4a206e2a44d4d96ff57f98ad78204be58.mp4"
  ] = big;
  web[
    "https://vulcan.dl.playstation.net/img/rnd/202308/0718/243775ff67d6c5c667d061b7d49804dbef0575286570cf18.mp4"
  ] = big;
  web["https://vulcan.dl.playstation.net/robots.txt"] = { status: 404 };
  web["https://gmedia.playstation.com/robots.txt"] = { status: 404 };
  const { http } = await client(web);
  const remux = async (src: string, dest: string) => {
    await fs.copyFile(src, dest);
  };
  const report: NonNullable<Parameters<typeof storeTrailersFor>[0]["report"]> =
    {};
  const got = await storeTrailersFor({
    http,
    game: "Marvel's Spider-Man 2",
    year: 2023,
    stores: ["playstation"],
    max: 2,
    publisher: "PlayStation",
    remux,
    report,
  });
  assert.equal(got.length, 2);
  assert.ok(
    got.every(
      (t) =>
        t.store === "playstation" &&
        t.host === "PlayStation Store" &&
        t.publisher === "PlayStation",
    ),
  );
  assert.match(got[0]!.name, /^Marvel’s Spider-Man 2: /);
  assert.equal(report.playstation?.downloaded, 2);
  // Downloaded once: a second lookup reuses the files.
  const files = got.map((t) => t.file);
  const again = await storeTrailersFor({
    http,
    game: "Marvel's Spider-Man 2",
    year: 2023,
    stores: ["playstation"],
    max: 2,
    remux,
  });
  assert.deepEqual(
    again.map((t) => t.file),
    files,
  );
  // Below the free-space floor nothing new is downloaded.
  const none = await storeTrailersFor({
    http,
    game: "The Legend of Zelda: Tears of the Kingdom",
    year: 2023,
    stores: ["nintendo"],
    max: 1,
    remux,
    minFreeBytes: Number.MAX_SAFE_INTEGER,
    report,
  });
  assert.equal(none.length, 0);
  assert.equal(report.nintendo?.why, "disk below its free-space floor");
});

test("cacheVideo fetches a byte-ranged HLS file in one request and skips files the host will not give", async () => {
  const web = {
    "https://cdn.example/robots.txt": { status: 404 },
    "https://cdn.example/v/master.m3u8":
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x1080\nhigh.m3u8\n",
    "https://cdn.example/v/high.m3u8":
      "#EXTM3U\n#EXTINF:6,\n#EXT-X-BYTERANGE:100000@0\nhigh.ts\n#EXTINF:6,\n#EXT-X-BYTERANGE:60000@100000\nhigh.ts\n",
    "https://cdn.example/v/high.ts": "t".repeat(160_000),
    "https://cdn.example/w/master.m3u8": {
      status: 403,
      body: "Client IP address forbidden.",
    },
  } as Parameters<typeof fakeWeb>[0];
  const { http, web: w, cacheDir } = await client(web);
  const remux = async (src: string, dest: string) => fs.copyFile(src, dest);
  const file = await cacheVideo(
    http,
    {
      caption: "t",
      url: "https://cdn.example/v/master.m3u8",
      kind: "hls",
      host: "Epic Games Store",
    },
    path.join(cacheDir, "files"),
    remux,
  );
  assert.ok(file && (await fs.stat(file)).size === 160_000);
  assert.equal(w.calls.filter((c) => c.url.endsWith("high.ts")).length, 1);
  assert.equal(
    await cacheVideo(
      http,
      {
        caption: "w",
        url: "https://cdn.example/w/master.m3u8",
        kind: "hls",
        host: "x",
      },
      path.join(cacheDir, "files"),
      remux,
    ),
    undefined,
  );
  assert.equal(await http.isBlocked("cdn.example"), true);
});

test("officialMedia asks the stores before any YouTube search, and YouTube still runs when they give nothing", async () => {
  const order: string[] = [];
  const dir = await tmp("storeom-");
  const target = { key: "beat:0", text: "x", want: "gameplay", energy: "medium", keywords: ["x"] } as never;
  await officialMedia({
    token: async () => "t",
    gameTitle: "Marvel's Spider-Man 2",
    episodeDir: dir,
    targets: [target],
    maxClips: 2,
    quotaOk: async () => (order.push("youtube"), false),
    storeTrailers: async () => (order.push("stores"), []),
  });
  assert.deepEqual(order, ["stores", "youtube"]);
});

test("an owner that takes no moving footage is not asked of the stores at all", async () => {
  let asked = 0;
  const was = process.env.PUBLISHER_FOOTAGE_SECONDS;
  delete process.env.PUBLISHER_FOOTAGE_SECONDS;
  try {
    const dir = await tmp("storenin-");
    const target = { key: "beat:0", text: "x", want: "gameplay", energy: "medium", keywords: ["x"] } as never;
    await officialMedia({ token: async () => "t", gameTitle: "The Legend of Zelda: Tears of the Kingdom", episodeDir: dir, targets: [target], maxClips: 2, quotaOk: async () => false, storeTrailers: async () => (asked++, []) });
    assert.equal(asked, 0);
  } finally {
    if (was !== undefined) process.env.PUBLISHER_FOOTAGE_SECONDS = was;
  }
});

test("the store trailers count under PUBLISHER_FOOTAGE_SECONDS, and the site route's default is unchanged", () => {
  const was = process.env.PUBLISHER_FOOTAGE_SECONDS;
  try {
    delete process.env.PUBLISHER_FOOTAGE_SECONDS;
    assert.equal(ownerCapSeconds("PlayStation", true), 14);
    assert.equal(ownerCapSeconds("Some Indie", true), 14);
    process.env.PUBLISHER_FOOTAGE_SECONDS = "PlayStation=30,*=180";
    assert.equal(ownerCapSeconds("PlayStation", true), 30);
    assert.equal(ownerCapSeconds("Some Indie", true), 180);
    assert.equal(ownerCapSeconds("Some Indie", false), 14, "the site route keeps its 14 s default");
  } finally {
    if (was === undefined) delete process.env.PUBLISHER_FOOTAGE_SECONDS;
    else process.env.PUBLISHER_FOOTAGE_SECONDS = was;
  }
});

test("a store trailer file is never handed to yt-dlp for frames", async () => {
  const dir = await tmp("storeframes-");
  const got = await trailerFrames({ episodeDir: dir, gameTitle: "Grand Theft Auto VI", ytdlp: "definitely-not-a-binary" }, { videoId: "https://cdn.trailers.xboxservices.com/x/manifest.m3u8", title: "t", channelTitle: "Official trailer (Microsoft Store)", url: "https://cdn.trailers.xboxservices.com/x/manifest.m3u8" }, 3, false);
  assert.deepEqual(got, []);
});

test("a store page with no year stands for an old game only when nothing could be a remake", () => {
  assert.equal(matchStoreProduct("Resident Evil 4", 2005, "Resident Evil 4", undefined, { nowYear: 2026 }), undefined);
  assert.equal(matchStoreProduct("Marvel's Spider-Man 2", 2023, "Marvel's Spider-Man 2", undefined, { nowYear: 2026 }), "same");
  assert.equal(matchStoreProduct("Fortnite", undefined, "Fortnite", undefined), "same");
  assert.equal(matchStoreProduct("Mafia", 2002, "Mafia: Definitive Edition", undefined, { nowYear: 2026 }), undefined);
});

test("redirects are asked again through robots.txt, the gap and the stop of their own host", async () => {
  const { http, web } = await client({
    "https://a.example/robots.txt": { status: 404 },
    "https://a.example/go": { status: 302, headers: { location: "https://b.example/private/file" } },
    "https://a.example/go2": { status: 301, headers: { location: "https://b.example/ok" } },
    "https://b.example/robots.txt": ["User-agent: *", "Disallow: /private/", ""].join("\n"),
    "https://b.example/ok": { status: 429 },
  });
  assert.equal(await http.text("https://a.example/go", 24), undefined);
  assert.ok(!web.calls.some((c) => c.url === "https://b.example/private/file"), "robots.txt of the target refused it");
  assert.equal(await http.text("https://a.example/go2", 24), undefined);
  assert.equal(await http.isBlocked("b.example"), true, "the host that said 429 is the one stopped");
  assert.equal(await http.isBlocked("a.example"), false);
});

test("byte-ranged playlists that are not one whole file, and encrypted ones, are skipped", async () => {
  const { http, web, cacheDir } = await client({
    "https://cdn.example/robots.txt": { status: 404 },
    "https://cdn.example/a.m3u8": ["#EXTM3U", '#EXT-X-MAP:URI="v.mp4",BYTERANGE="800@0"', "#EXTINF:6,", "#EXT-X-BYTERANGE:1000@800", "v.mp4", ""].join("\n"),
    "https://cdn.example/b.m3u8": ["#EXTM3U", '#EXT-X-KEY:METHOD=AES-128,URI="k"', "#EXTINF:6,", "s1.ts", ""].join("\n"),
  });
  const remux = async (src: string, dest: string) => fs.copyFile(src, dest);
  assert.equal(await cacheVideo(http, { caption: "a", url: "https://cdn.example/a.m3u8", kind: "hls", host: "x" }, path.join(cacheDir, "f"), remux), undefined);
  assert.equal(await cacheVideo(http, { caption: "b", url: "https://cdn.example/b.m3u8", kind: "hls", host: "x" }, path.join(cacheDir, "f"), remux), undefined);
  assert.ok(!web.calls.some((c) => c.url.endsWith("v.mp4") || c.url.endsWith("s1.ts")));
});

test("robots.txt groups match our token exactly, not any word inside it", () => {
  assert.equal(parseRobots(["User-agent: bot", "Disallow: /", "", "User-agent: *", "Allow: /", ""].join("\n")).allowed("/x"), true);
  assert.equal(parseRobots(["User-agent: PulseGamingNewsBot", "Disallow: /a", ""].join("\n")).allowed("/a"), false);
});


test("old cache files and stray part files are pruned", async () => {
  const dir = await tmp("storeprune-");
  const files = path.join(dir, "files", "xbox");
  await fs.mkdir(files, { recursive: true });
  const old = path.join(files, "old.mp4");
  const fresh = path.join(files, "fresh.mp4");
  await fs.writeFile(old, "x");
  await fs.writeFile(fresh, "x");
  const t = new Date(Date.now() - 40 * 86_400_000);
  await fs.utimes(old, t, t);
  assert.equal(await pruneCache(dir), 1);
  assert.ok(await fs.stat(fresh));
});
