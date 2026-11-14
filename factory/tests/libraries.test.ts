import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  interleave,
  isPressProvenance,
  librariesNote,
  librarySummary,
  openLicence,
  parseOpenverse,
  parsePixabayImages,
  photoCreditLine,
  photoCreditOf,
  photoProvenance,
  photoSourcesLine,
  searchLicensedPhotos,
} from "../src/assets/libraries.ts";
import {
  aboutGame,
  fullSize,
  gameWords,
  parsePressFeed,
  parsePressKit,
  PRESS_SITES,
  pressPosts,
  searchPress,
  shareImageOf,
  siteImages,
} from "../src/assets/press.ts";
import {
  archiveLicence,
  archiveSeconds,
  parseArchiveItem,
  parsePixabayVideos,
  stockCandidates,
  stockCredit,
  stockCreditLines,
  stockProvenance,
  type StockVideo,
} from "../src/assets/stock.ts";
import { ccCredit } from "../src/render/cleanframe.ts";
import { breaker } from "../src/lib/breaker.ts";
import {
  pressForShort,
  pressUsable,
  reportLibraries,
} from "../src/assets/librarystep.ts";
import { announcementLines } from "../src/assets/fill.ts";
import { footageCredits, photoCredit } from "../src/pipeline.ts";
import { stockLibraries } from "../src/services.ts";
import { testDb, tmpDir } from "./helpers.ts";
import type { CommonsImage } from "../src/assets/commons.ts";

const xbox = PRESS_SITES.find((s) => s.id === "xbox")!;

test("libraries: only CC0, the public domain mark, CC BY and CC BY-SA are free for a commercial channel", () => {
  assert.equal(openLicence("by", "2.0"), "CC BY 2.0");
  assert.equal(openLicence("by-sa", "4.0"), "CC BY-SA 4.0");
  assert.equal(openLicence("cc0", "1.0"), "CC0 1.0");
  assert.equal(openLicence("pdm"), "Public domain");
  for (const bad of [
    "by-nc",
    "by-nd",
    "by-nc-sa",
    "by-nc-nd",
    "sampling+",
    "nc-sampling+",
    "",
    undefined,
  ])
    assert.equal(openLicence(bad, "2.0"), undefined, String(bad));
});

test("libraries: Openverse results keep only free, large, landscape photos, Flickr named, Commons left to its own search", () => {
  const r = (o: Record<string, unknown>) => ({
    title: "Gamescom 2019 show floor",
    url: "https://live.staticflickr.com/1/a.jpg",
    foreign_landing_url: "https://www.flickr.com/photos/x/1",
    creator: "Dirk V",
    license: "by",
    license_version: "2.0",
    source: "flickr",
    width: 2000,
    height: 1200,
    tags: [{ name: "gamescom" }, { name: "crowd" }],
    ...o,
  });
  const out = parseOpenverse({
    results: [
      r({}),
      r({ license: "by-nc", title: "NC photo" }),
      r({ license: "by-nd", title: "ND photo" }),
      r({ source: "wikimedia", title: "Commons copy" }),
      r({ width: 800, height: 600, title: "small" }),
      r({ width: 1200, height: 2000, title: "portrait" }),
      r({ title: "Gamescom logo" }),
      r({ mature: true, title: "mature" }),
      r({
        license: "by-sa",
        license_version: "4.0",
        title: "BY-SA hall",
        source: "geographorguk",
      }),
      r({
        license: "cc0",
        license_version: "1.0",
        title: "CC0 hall",
        width: 0,
        height: 0,
      }),
    ],
  });
  assert.deepEqual(
    out.map((x) => x.title),
    ["CC0 hall", "Gamescom 2019 show floor", "BY-SA hall"],
  );
  assert.equal(out[1]!.source, "flickr");
  assert.equal(out[1]!.via, "Flickr");
  assert.equal(out[1]!.license, "CC BY 2.0");
  assert.equal(out[2]!.via, "Geograph");
  assert.match(out[1]!.description, /gamescom, crowd/);
});

test("libraries: Pixabay photos carry their tags as the title and the Pixabay licence", () => {
  const out = parsePixabayImages({
    hits: [
      {
        pageURL: "https://pixabay.com/photos/arcade-1/",
        largeImageURL: "https://pixabay.com/get/a.jpg",
        imageWidth: 1920,
        imageHeight: 1080,
        tags: "arcade, retro, games",
        user: "kim",
        type: "photo",
      },
      {
        pageURL: "https://pixabay.com/photos/b/",
        largeImageURL: "https://pixabay.com/get/b.jpg",
        imageWidth: 640,
        imageHeight: 480,
        tags: "small",
        user: "kim",
        type: "photo",
      },
      {
        pageURL: "https://pixabay.com/photos/c/",
        largeImageURL: "https://pixabay.com/get/c.jpg",
        imageWidth: 1920,
        imageHeight: 1080,
        tags: "vector icon",
        user: "kim",
        type: "vector/svg",
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, "arcade, retro, games");
  assert.equal(out[0]!.license, "Pixabay Content License");
  assert.equal(out[0]!.source, "pixabay");
});

test("libraries: one search asks every library, interleaves them Commons first and drops a failing one", async () => {
  assert.deepEqual(
    interleave([[1, 2, 3], [10], [20, 21]]),
    [1, 10, 20, 2, 21, 3],
  );
  const img = (
    title: string,
    pageUrl: string,
    source?: CommonsImage["source"],
  ): CommonsImage => ({
    title,
    url: `${pageUrl}.jpg`,
    width: 2000,
    height: 1200,
    artist: "a",
    license: "CC BY 2.0",
    pageUrl,
    description: "",
    source,
  });
  const out = await searchLicensedPhotos(
    {
      commons: async () => [img("c1", "https://c/1"), img("c2", "https://c/2")],
      openverse: async () => [
        img("o1", "https://o/1", "flickr"),
        img("dup", "https://c/1", "flickr"),
      ],
      pixabay: async () => {
        throw new Error("down");
      },
    },
    "rockstar north",
  );
  assert.deepEqual(
    out.map((x) => x.title),
    ["c1", "o1", "c2"],
  );
});

test("libraries: provenance records library, author and licence; the credit reads it back", () => {
  const base = {
    title: "t",
    url: "https://x/a.jpg",
    width: 2000,
    height: 1200,
    artist: "Dirk V",
    license: "CC BY 2.0",
    pageUrl: "https://www.flickr.com/photos/x/1",
    description: "",
  };
  // Commons keeps the wording older episodes carry.
  const commons = photoProvenance({
    ...base,
    license: "CC BY-SA 4.0",
    pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
  });
  assert.equal(
    commons,
    "Wikimedia Commons photo by Dirk V, CC BY-SA 4.0: https://commons.wikimedia.org/wiki/File:A.jpg",
  );
  assert.equal(
    photoCreditOf({ kind: "photo", provenance: commons }),
    "Dirk V / CC BY-SA 4.0 / Wikimedia Commons",
  );
  assert.equal(
    photoCredit({ kind: "photo", provenance: commons }),
    "Dirk V / CC BY-SA 4.0 / Wikimedia Commons",
  );
  const flickr = photoProvenance({ ...base, source: "flickr", via: "Flickr" });
  assert.equal(
    flickr,
    "Flickr photo by Dirk V, CC BY 2.0: https://www.flickr.com/photos/x/1 (found through Openverse)",
  );
  assert.equal(
    photoCreditOf({ kind: "photo", provenance: flickr }),
    "Dirk V / CC BY 2.0 / Flickr",
  );
  const pix = photoProvenance({
    ...base,
    license: "Pixabay Content License",
    source: "pixabay",
    via: "Pixabay",
    artist: "kim",
  });
  assert.equal(
    photoCreditOf({ kind: "photo", provenance: pix }),
    "kim / Pixabay",
  );
  const press = photoProvenance({
    ...base,
    artist: "Xbox",
    via: "Xbox",
    source: "press",
    license: "editorial use, offered to the press on Xbox Wire",
    pageUrl: "https://news.xbox.com/en-us/2026/10/01/post/",
  });
  assert.equal(isPressProvenance(press), true);
  assert.match(
    press,
    /^Press image from Xbox press \(editorial use, offered to the press on Xbox Wire\): https:\/\/news\.xbox\.com/,
  );
  // A press picture is credited whatever its kind; official game art is not.
  assert.equal(
    photoCreditOf({ kind: "article", provenance: press }),
    "Image: Xbox press",
  );
  assert.equal(
    photoCredit({ kind: "article", provenance: press }),
    "Image: Xbox press",
  );
  assert.equal(
    photoCreditOf({ kind: "hero", provenance: "Steam hero art" }),
    undefined,
  );
  assert.equal(
    photoCreditOf({
      kind: "article",
      provenance: "Official press image from Xbox Wire (u)",
    }),
    undefined,
    "the older newsroom images are unchanged",
  );
  assert.equal(
    photoCreditOf({ kind: "photo", provenance: "something else" }),
    "Wikimedia Commons",
  );
});

test("libraries: the Short's credit strip and the description line keep their old text for Commons alone", () => {
  assert.equal(
    photoCreditLine([
      "A / CC BY 2.0 / Wikimedia Commons",
      undefined,
      "A / CC BY 2.0 / Wikimedia Commons",
    ]),
    "Photo: A / CC BY 2.0 / Wikimedia Commons",
  );
  assert.equal(
    photoCreditLine(["A / CC BY 2.0 / Flickr", "Image: Xbox press"]),
    "Photo: A / CC BY 2.0 / Flickr   Image: Xbox press",
  );
  assert.equal(photoCreditLine([undefined]), "");
  const commons = [
    {
      kind: "photo",
      provenance: "Wikimedia Commons photo by A, CC BY 2.0: https://c",
    },
  ];
  assert.equal(
    photoSourcesLine(commons, "https://x/credits/1"),
    "\nPhotos: Wikimedia Commons, credited on screen. Full photo and footage credits: https://x/credits/1",
  );
  assert.equal(
    photoSourcesLine(
      [
        ...commons,
        {
          kind: "photo",
          provenance:
            "Flickr photo by B, CC BY 2.0: https://f (found through Openverse)",
        },
        {
          kind: "article",
          provenance:
            "Press image from PlayStation press (editorial use, offered to the press on PlayStation Blog): https://p [https://i]",
        },
      ],
      "u",
    ),
    "\nPhotos: Wikimedia Commons, Flickr, PlayStation press site, credited on screen. Full photo and footage credits: u",
  );
  assert.equal(
    photoSourcesLine([{ kind: "screenshot", provenance: "Steam" }], "u"),
    "",
  );
});

test("libraries: the summary counts what the newer libraries gave, and the note names their settings", () => {
  const counts = librarySummary(
    [
      {
        kind: "photo",
        provenance: "Wikimedia Commons photo by A, CC BY 2.0: https://c",
      },
      {
        kind: "photo",
        provenance:
          "Flickr photo by B, CC BY 2.0: https://f (found through Openverse)",
      },
      {
        kind: "photo",
        provenance: "Pixabay photo by k, Pixabay Content License: https://p",
      },
      {
        kind: "article",
        provenance:
          "Press image from Xbox press (editorial use, offered to the press on Xbox Wire): https://x [https://i]",
      },
    ],
    [
      {
        provenance:
          "Illustrative stock footage from Pexels (https://pexels) by a, free to use under the Pexels licence; chosen for k",
      },
      {
        provenance:
          "Illustrative stock footage from Pixabay (https://pixabay) by a, free to use under the Pixabay Content License; chosen for k",
      },
      {
        provenance:
          'Archive footage from the Internet Archive (https://archive.org/details/x): "Film" by B, public domain; chosen for k',
      },
    ],
  );
  assert.deepEqual(counts, {
    "Flickr photos": 1,
    "Pixabay photos": 1,
    "Xbox press": 1,
    "Pixabay clips": 1,
    "Internet Archive clips": 1,
  });
  assert.match(
    librariesNote('Short "X"', counts)!,
    /^Short "X": the newer picture libraries supplied 1 Flickr photos, 1 Pixabay photos, 1 Xbox press, .*Settings: LIBRARY_PRESS/,
  );
  assert.equal(librariesNote("x", {}), undefined);
});

const FEED = `<?xml version="1.0"?><rss><channel><title>XBOX Wire</title>
<item><title>Gears of War: E-Day &#8211; Surviving the First Night</title><link>https://news.xbox.com/en-us/2026/10/14/gears/</link><pubDate>Wed, 14 Oct 2026</pubDate>
<content:encoded><![CDATA[<img src="https://xboxwire.thesourcemediaassets.com/sites/2/2026/10/GoW_A-1024x576.jpg"><img src="https://i0.wp.com/xboxwire.thesourcemediaassets.com/sites/2/2026/10/GoW_A.jpg?resize=1"><img src="https://xboxwire.thesourcemediaassets.com/sites/2/2019/12/Nexus_logo.png"><img src="https://assets.onestore.ms/store/badge.png"><img src="https://xboxwire.thesourcemediaassets.com/sites/2/2026/10/GoW_B.jpg">]]></content:encoded></item>
<item><title>Coming to XBOX Game Pass: Battlefield 6, Gears of War: E-Day, Forever Ago, and More</title><link>https://news.xbox.com/en-us/2026/10/20/gp/</link><content:encoded><![CDATA[<img src="https://xboxwire.thesourcemediaassets.com/sites/2/2026/10/GP.jpg">]]></content:encoded></item>
<item><title>Watch the Gears of War: E-Day Official Launch Trailer</title><link>https://news.xbox.com/en-us/2026/10/06/trailer/</link><content:encoded><![CDATA[<img src="https://xboxwire.thesourcemediaassets.com/sites/2/2026/10/GoW_T.jpg">]]></content:encoded></item>
<item><title>Gears of War: E-Day and XBOX Unleash The Emergence Pie with Prince St. Pizza</title><link>https://news.xbox.com/en-us/2026/10/08/pie/</link></item>
<item><title>Halo Infinite Season 9</title><link>https://news.xbox.com/en-us/2026/10/01/halo/</link></item>
</channel></rss>`;

test("press: the feed's posts, the site's own pictures at full size, no logos, badges or resized copies", () => {
  assert.equal(
    fullSize(
      "https://xboxwire.thesourcemediaassets.com/a/GoW-2048x1152-1-ab-1024x576.jpg",
    ),
    "https://xboxwire.thesourcemediaassets.com/a/GoW-2048x1152-1-ab.jpg",
  );
  assert.equal(
    fullSize(
      "https://blog.playstation.com/tachyon/2026/10/x.jpg?resize=1088%2C612",
    ),
    "https://blog.playstation.com/tachyon/2026/10/x.jpg",
  );
  const items = parsePressFeed(FEED, xbox);
  assert.equal(items.length, 5);
  assert.equal(
    items[0]!.title,
    "Gears of War: E-Day - Surviving the First Night",
  );
  assert.deepEqual(items[0]!.images, [
    "https://xboxwire.thesourcemediaassets.com/sites/2/2026/10/GoW_A.jpg",
    "https://xboxwire.thesourcemediaassets.com/sites/2/2026/10/GoW_B.jpg",
  ]);
  assert.deepEqual(
    siteImages('<img src="https://elsewhere.com/x.jpg">', xbox.hosts),
    [],
  );
});

test("press: a post counts only when its title names the game and is not a roundup or tie-in; announcements first", () => {
  assert.deepEqual(gameWords("Gears of War: E-Day"), ["gears", "war", "e-day"]);
  assert.equal(
    aboutGame(
      "Gears of War: E-Day - Surviving the First Night",
      "Gears of War: E-Day",
    ),
    true,
  );
  assert.equal(
    aboutGame(
      "Coming to XBOX Game Pass: Battlefield 6, Gears of War: E-Day, Forever Ago, and More",
      "Gears of War: E-Day",
    ),
    false,
  );
  assert.equal(
    aboutGame(
      "Gears of War: E-Day and XBOX Unleash The Emergence Pie with Prince St. Pizza",
      "Gears of War: E-Day",
    ),
    false,
  );
  assert.equal(
    aboutGame(
      "PlayStation Now games for February 2022: Grand Theft Auto: Vice City",
      "Grand Theft Auto: Vice City",
    ),
    false,
  );
  assert.equal(
    aboutGame("Gears of War 4 is free this weekend", "Gears of War: E-Day"),
    false,
    "another entry",
  );
  assert.equal(
    aboutGame("Halo Infinite Season 9", "Gears of War: E-Day"),
    false,
  );
  assert.equal(
    aboutGame(
      "Call of Duty: Modern Warfare 4 arrives on Xbox Series X and PC",
      "Call of Duty: Modern Warfare 4",
    ),
    true,
    "Series X is not a tie-in",
  );
  const posts = pressPosts(parsePressFeed(FEED, xbox), "Gears of War: E-Day");
  assert.deepEqual(
    posts.map((p) => p.link),
    [
      "https://news.xbox.com/en-us/2026/10/06/trailer/",
      "https://news.xbox.com/en-us/2026/10/14/gears/",
    ],
  );
});

test("press: a share image is read only from the site's own host; a kit page lists its pictures", () => {
  const sie = PRESS_SITES.find((s) => s.id === "sie")!;
  assert.equal(
    shareImageOf(
      '<meta property="og:image" content="https://sonyinteractive.com/tachyon/2026/07/Header-1200x630.png" />',
      sie.hosts,
    ),
    "https://sonyinteractive.com/tachyon/2026/07/Header.png",
  );
  assert.equal(
    shareImageOf(
      '<meta property="og:image" content="https://cdn.other.com/x.png" />',
      sie.hosts,
    ),
    undefined,
  );
  const deck = PRESS_SITES.find((s) => s.id === "steamdeck")!;
  const kit = parsePressKit(
    '<a href="https://cdn.fastly.steamstatic.com/steamdeck/images/press/renderings/press_oled_top.jpg"><img src="https://cdn.fastly.steamstatic.com/steamdeck/images/press/renderings/press_oled_top_thumb.jpg"></a>',
    deck,
    "https://www.steamdeck.com/en/press",
  );
  assert.deepEqual(
    kit.map((k) => k.title),
    ["press oled top"],
  );
});

test("press: every site is asked once, results interleave, a failing site gives nothing, the kit only for its subject", async () => {
  const asked: string[] = [];
  const fetchFn = (async (url: string) => {
    asked.push(url);
    if (url.includes("news.xbox.com")) return new Response(FEED);
    if (url.includes("blog.playstation.com"))
      return new Response(
        `<rss><item><title>Gears of War: E-Day launches on PS5</title><link>https://blog.playstation.com/2026/10/1/g/</link><content:encoded><![CDATA[<img src="https://live.staticflickr.com/65535/1_o.jpg">]]></content:encoded></item></rss>`,
      );
    if (url.includes("sonyinteractive.com")) throw new Error("down");
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const got = await searchPress("Gears of War: E-Day", { fetchFn, max: 4 });
  assert.deepEqual(
    got.map((g) => `${g.via}:${g.url.split("/").pop()}`),
    [
      "Xbox:GoW_T.jpg",
      "PlayStation:1_o.jpg",
      "Xbox:GoW_A.jpg",
      "Xbox:GoW_B.jpg",
    ],
  );
  assert.equal(got[0]!.source, "press");
  assert.match(
    got[0]!.license,
    /editorial use, offered to the press on Xbox Wire/,
  );
  assert.equal(
    asked.some((u) => u.includes("steamdeck")),
    false,
    "the Steam Deck kit is for Steam Deck lines only",
  );
  assert.equal(
    asked.filter((u) => u.includes("/search/gears%20war%20e-day/")).length,
    4,
  );
});

test("press for a Short: downloaded, too-small pictures dropped, credited; nothing without the setting", async () => {
  const dir = await tmpDir();
  const img = (url: string): CommonsImage => ({
    title: "t",
    url,
    width: 0,
    height: 0,
    artist: "Xbox",
    license: "editorial use, offered to the press on Xbox Wire",
    pageUrl: "https://news.xbox.com/p",
    description: "",
    source: "press",
    via: "Xbox",
  });
  const deps = {
    searchPress: async () => [
      img("https://x/big.jpg"),
      img("https://x/small.jpg"),
      img("https://x/have.jpg"),
    ],
    downloadPhoto: async (_i: CommonsImage, dest: string) => {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, "x");
      return true;
    },
    measure: async (f: string) =>
      f.includes("press_") && (await fs.readFile(f, "utf8"))
        ? sizes.shift()!
        : {},
  };
  const sizes = [
    { width: 1920, height: 1080 },
    { width: 640, height: 360 },
  ];
  const out = await pressForShort(
    deps,
    dir,
    "Gears of War: E-Day",
    new Set(["https://x/have.jpg"]),
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.kind, "article");
  assert.equal(out[0]!.sourceUrl, "https://x/big.jpg");
  assert.equal(photoCredit(out[0]!), "Image: Xbox press");
  assert.equal(pressUsable(1920, 1080), true);
  assert.equal(pressUsable(900, 600), false);
  assert.equal(pressUsable(1920, 400), false);
  assert.deepEqual(
    await pressForShort(
      { downloadPhoto: deps.downloadPhoto },
      dir,
      "Gears",
      new Set(),
    ),
    [],
  );
});

test("press for a documentary: only chapters with an open sentence about an announcement ask for it", () => {
  const ch = {
    entry: 0,
    game: "GTA",
    moments: [
      { show: "Tommy on a bike" },
      { show: "the reveal trailer" },
      { show: "x" },
    ],
    sentences: [
      "He rides.",
      "Rockstar showed it first in May.",
      "It launched in 2002.",
    ],
  };
  assert.deepEqual(announcementLines(ch, [0, 1, 2]), [1, 2]);
  assert.deepEqual(announcementLines(ch, [0]), []);
});

test("stock libraries: the archive takes only public domain, CC0 and plain CC BY", () => {
  assert.equal(
    archiveLicence("https://creativecommons.org/publicdomain/mark/1.0/"),
    "public domain",
  );
  assert.equal(
    archiveLicence("http://creativecommons.org/licenses/publicdomain/"),
    "public domain",
  );
  assert.equal(
    archiveLicence("https://creativecommons.org/publicdomain/zero/1.0/"),
    "public domain (CC0)",
  );
  assert.equal(
    archiveLicence("https://creativecommons.org/licenses/by/4.0/"),
    "CC BY 4.0",
  );
  for (const bad of [
    "http://creativecommons.org/licenses/by-nc-sa/2.5/",
    "https://creativecommons.org/licenses/by-sa/4.0/",
    "https://creativecommons.org/licenses/by-nd/3.0/",
    "http://example.com/licence",
    "",
    undefined,
  ])
    assert.equal(archiveLicence(bad), undefined, String(bad));
  assert.equal(archiveSeconds("123.5"), 123.5);
  assert.equal(archiveSeconds("02:03"), 123);
  assert.equal(archiveSeconds("1:02:03"), 3723);
  assert.equal(archiveSeconds(""), 0);
});

test("stock libraries: an archive item gives its sharpest clip-ready film, never an advert, gameplay or a review", () => {
  const meta = (o: Record<string, unknown> = {}, files?: unknown[]) => ({
    metadata: {
      identifier: "computer-history-1983",
      title: "The Computer Programme (1983)",
      creator: "BBC Open University",
      licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/",
      mediatype: "movies",
      ...o,
    },
    files: files ?? [
      { name: "film.mp4", format: "h.264", height: "480", length: "1200" },
      {
        name: "film_512kb.mp4",
        format: "512Kb MPEG4",
        height: "240",
        length: "1200",
      },
      { name: "film.ogv", format: "Ogg Video", height: "480" },
    ],
  });
  const v = parseArchiveItem(meta())!;
  assert.equal(
    v.fileUrl,
    "https://archive.org/download/computer-history-1983/film.mp4",
  );
  assert.equal(v.duration, 1200);
  assert.equal(v.remote, true);
  assert.equal(v.licence, "public domain");
  assert.equal(v.url, "https://archive.org/details/computer-history-1983");
  assert.equal(
    parseArchiveItem(
      meta({ licenseurl: "https://creativecommons.org/licenses/by-nc/4.0/" }),
    ),
    undefined,
  );
  assert.equal(
    parseArchiveItem(meta({ title: "Fox Kids reclameblok 2003" })),
    undefined,
  );
  assert.equal(
    parseArchiveItem(meta({ title: "Forza Motorsport Xbox PAL Gameplay" })),
    undefined,
  );
  assert.equal(
    parseArchiveItem(meta({ title: "Alien Syndrome review for the NES" })),
    undefined,
  );
  assert.equal(
    parseArchiveItem(meta({ title: "Arcade TV commercial 1982" })),
    undefined,
  );
  assert.equal(
    parseArchiveItem(meta({ mediatype: "texts" })),
    undefined,
    "no magazine scans",
  );
  assert.equal(
    parseArchiveItem(
      meta({}, [
        { name: "a.mp4", format: "h.264", height: "480", length: "3" },
      ]),
    ),
    undefined,
    "too short",
  );
});

test("stock libraries: Pixabay videos pick the smallest file still 1080p, with a preview", () => {
  const out = parsePixabayVideos({
    hits: [
      {
        id: 7,
        pageURL: "https://pixabay.com/videos/office-7/",
        duration: 20,
        user: "kim",
        tags: "office, night",
        videos: {
          large: { url: "L", width: 3840, height: 2160, thumbnail: "tl" },
          medium: { url: "M", width: 1920, height: 1080, thumbnail: "tm" },
          small: { url: "S", width: 960, height: 540 },
        },
      },
      {
        id: 8,
        pageURL: "https://pixabay.com/videos/short-8/",
        duration: 3,
        videos: { medium: { url: "M", width: 1920, height: 1080 } },
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.fileUrl, "M");
  assert.equal(out[0]!.image, "tm");
  assert.equal(out[0]!.library, "Pixabay");
});

test("stock libraries: one line's candidates interleave Pexels first, never a used or already placed video", () => {
  const v = (library: StockVideo["library"], id: string): StockVideo => ({
    library,
    id,
    url: `https://${library}/${id}`,
    duration: 20,
    fileUrl: "f",
  });
  const got = stockCandidates(
    [
      [v("Pexels", "1"), v("Pexels", "2")],
      [v("Pixabay", "1")],
      [v("Internet Archive", "a")],
    ],
    new Set(["Pexels:2"]),
    new Set(["https://Internet Archive/a"]),
  );
  assert.deepEqual(
    got.map((x) => `${x.library}:${x.id}`),
    ["Pexels:1", "Pixabay:1"],
  );
});

test("stock libraries: provenance, on-screen credit and description line per library; Pexels unchanged", () => {
  const pexels = stockProvenance(
    {
      library: "Pexels",
      id: "1",
      url: "https://www.pexels.com/video/1/",
      duration: 9,
      user: "Ann",
      fileUrl: "f",
    },
    "beat:2#m3",
  );
  assert.equal(
    pexels,
    "Illustrative stock footage from Pexels (https://www.pexels.com/video/1/) by Ann, free to use under the Pexels licence; chosen for beat:2#m3",
  );
  assert.equal(stockCredit(pexels), "ILLUSTRATIVE · STOCK FOOTAGE: PEXELS");
  const pix = stockProvenance(
    {
      library: "Pixabay",
      id: "7",
      url: "https://pixabay.com/videos/7/",
      duration: 9,
      user: "kim",
      fileUrl: "f",
    },
    "k",
  );
  assert.equal(stockCredit(pix), "ILLUSTRATIVE · STOCK FOOTAGE: PIXABAY");
  const pd = stockProvenance(
    {
      library: "Internet Archive",
      id: "a",
      url: "https://archive.org/details/a",
      duration: 900,
      user: "Prelinger",
      title: 'The "Computer" Age',
      licence: "public domain",
      fileUrl: "f",
    },
    "k",
  );
  assert.equal(
    stockCredit(pd),
    "ILLUSTRATIVE · ARCHIVE FOOTAGE: INTERNET ARCHIVE (PUBLIC DOMAIN)",
  );
  const by = stockProvenance(
    {
      library: "Internet Archive",
      id: "b",
      url: "https://archive.org/details/b",
      duration: 900,
      user: "Jane Roe",
      title: "Arcade 1981",
      licence: "CC BY 4.0",
      fileUrl: "f",
    },
    "k",
  );
  assert.equal(
    stockCredit(by),
    "ILLUSTRATIVE · ARCHIVE FOOTAGE: JANE ROE / CC BY 4.0 / INTERNET ARCHIVE",
  );
  // On a Short, the licence that asks for a name gets one.
  assert.equal(
    ccCredit(by),
    "Footage: Jane Roe · CC BY 4.0 · Internet Archive",
  );
  assert.equal(ccCredit(pd), undefined);
  assert.deepEqual(stockCreditLines([{ provenance: pexels }]), [
    "Illustrative stock footage (not the real event): Pexels, https://www.pexels.com/video/1/.",
  ]);
  const lines = stockCreditLines([
    { provenance: pexels },
    { provenance: pix },
    { provenance: by },
  ]);
  assert.equal(lines.length, 3);
  assert.equal(
    lines[1],
    "Illustrative stock footage (not the real event): Pixabay, https://pixabay.com/videos/7/.",
  );
  assert.equal(
    lines[2],
    'Archive footage (illustrative, not the real event): Internet Archive, "Arcade 1981" by Jane Roe, CC BY 4.0 (https://archive.org/details/b).',
  );
  // And the description builder carries them.
  const desc = footageCredits(
    { game_title: "GTA" } as never,
    [{ provenance: pexels }, { provenance: pix }],
    undefined,
    "Rockstar",
    "h",
  );
  assert.match(desc, /Pexels, https:\/\/www\.pexels\.com\/video\/1\/\./);
  assert.match(desc, /Pixabay, https:\/\/pixabay\.com\/videos\/7\/\./);
});

test("stock libraries: each behind its setting and key, Pexels first", () => {
  const names = (c: Partial<Parameters<typeof stockLibraries>[0]>) =>
    stockLibraries({
      pexelsApiKey: "",
      libraryPixabay: true,
      pixabayApiKey: "",
      libraryArchive: false,
      ...c,
    }).map((l) => l.name);
  assert.deepEqual(
    names({ pexelsApiKey: "k", pixabayApiKey: "p", libraryArchive: true }),
    ["Pexels", "Pixabay", "Internet Archive"],
  );
  assert.deepEqual(
    names({ pexelsApiKey: "k" }),
    ["Pexels"],
    "no Pixabay key: skipped",
  );
  assert.deepEqual(
    names({ pexelsApiKey: "k", pixabayApiKey: "p", libraryPixabay: false }),
    ["Pexels"],
  );
  assert.deepEqual(names({}), []);
});

test("breaker: two failures in a row skip a library for a while; a success resets", async () => {
  let t = 0;
  const b = breaker("x", 2, 1000, () => t);
  let calls = 0;
  const fail = () => {
    calls++;
    return Promise.reject(new Error("down"));
  };
  assert.deepEqual(await b.call(fail, []), []);
  assert.deepEqual(await b.call(() => Promise.resolve([1]), []), [1]);
  await b.call(fail, []);
  await b.call(fail, []);
  assert.equal(b.open(), true);
  assert.deepEqual(await b.call(fail, ["skip"]), ["skip"]);
  assert.equal(calls, 3);
  t = 2000;
  assert.equal(b.open(), false);
  assert.deepEqual(await b.call(() => Promise.resolve([2]), []), [2]);
});

test("libraries report: the episode log and the owner's note, only when the libraries gave something", async () => {
  const db = await testDb();
  await db
    .query(
      `INSERT INTO episodes (id, lane, status, story_json) VALUES ('ep1', 'news', 'selected', '{}')`,
    )
    .catch(() => undefined);
  const notes: string[] = [];
  const s = {
    db,
    notify: async (m: { content: string }) => void notes.push(m.content),
  };
  await reportLibraries(
    s,
    "ep1",
    'Short "X"',
    [{ kind: "screenshot", provenance: "Steam" }],
    [],
  );
  assert.equal(notes.length, 0);
  const counts = await reportLibraries(
    s,
    "ep1",
    'Short "X"',
    [
      {
        kind: "article",
        provenance:
          "Press image from Xbox press (editorial use, offered to the press on Xbox Wire): u [i]",
      },
    ],
    [],
  );
  assert.deepEqual(counts, { "Xbox press": 1 });
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /1 Xbox press/);
  const ev = await db.query<{ kind: string }>(
    `SELECT kind FROM events WHERE kind = 'libraries'`,
  );
  assert.equal(ev.length, 1);
});
