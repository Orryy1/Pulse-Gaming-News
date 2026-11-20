import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseRobots,
  robotsAllows,
  robotsFromResponse,
  pinnedRobots,
} from "../src/wikiart/robots.ts";
import {
  classifyFile,
  kindOf,
  type FileFacts,
} from "../src/wikiart/classify.ts";
import {
  bestImage,
  lookupArt,
  lookupInIndex,
  matchEntities,
  normName,
} from "../src/wikiart/lookup.ts";
import {
  duplicateOf,
  hashBits,
  type ArtImage,
  type ArtIndex,
} from "../src/wikiart/store.ts";
import {
  categoryOfGame,
  franchiseFor,
  rootCategoryCandidates,
  guessWikis,
  boringCategory,
} from "../src/wikiart/wikis.ts";
import {
  entityType,
  fileAboutPage,
  nameFromFile,
} from "../src/wikiart/crawl.ts";
import { wikiartFile } from "../src/wikiart/serve.ts";
import {
  HostRested,
  PoliteClient,
  RobotsDenied,
  USER_AGENT,
} from "../src/wikiart/http.ts";

// ---- robots.txt

test("robots: longest rule wins, Allow wins a tie, wildcards and $ work", () => {
  const r = parseRobots(
    `User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /api.php\nAllow: /api.php?action=query\nDisallow: /*.gif$\nCrawl-delay: 2\n`,
  );
  assert.equal(robotsAllows(r, "/api.php?action=query&list=x"), true);
  assert.equal(robotsAllows(r, "/api.php?action=parse"), false);
  assert.equal(robotsAllows(r, "/wiki/Foo"), true);
  assert.equal(robotsAllows(r, "/img/a.gif"), false);
  assert.equal(robotsAllows(r, "/img/a.gif?x"), true);
  assert.equal(r.crawlDelay, 2);
});

test("robots: Super Mario Wiki style rules keep us off api.php", () => {
  const r = parseRobots(
    `User-agent: *\nCrawl-delay: 1\nAllow: /load.php\nDisallow: /api.php\nDisallow: /*?\n`,
  );
  assert.equal(robotsAllows(r, "/api.php?action=query"), false);
});

test("robots: a group for our own token applies before *", () => {
  const r = parseRobots(
    `User-agent: *\nAllow: /\n\nUser-agent: PulseWikiArt\nDisallow: /\n`,
  );
  assert.equal(robotsAllows(r, "/api.php?action=query"), false);
});

test("robots: Fandom's pinned rules allow the API and keep us off Special: and User:", () => {
  const r = pinnedRobots("gta.fandom.com")!;
  assert.ok(r);
  assert.equal(
    robotsAllows(r, "/api.php?action=query&list=categorymembers"),
    true,
  );
  assert.equal(robotsAllows(r, "/wiki/Special:AllPages"), false);
  assert.equal(robotsAllows(r, "/wiki/User:Someone"), false);
  assert.equal(pinnedRobots("zeldawiki.wiki"), undefined);
});

test("robots: 4xx means no rules, 5xx or a challenge page means keep off, Fandom uses the pinned copy", () => {
  assert.equal(
    robotsFromResponse("cdn.example", 404, "text/html", "").blocked,
    undefined,
  );
  assert.equal(
    robotsFromResponse("x.example", 503, "text/html", "").blocked,
    true,
  );
  assert.equal(
    robotsFromResponse("x.example", undefined, "", "").blocked,
    true,
  );
  assert.equal(
    robotsFromResponse(
      "x.example",
      200,
      "text/html",
      "<html>Just a moment</html>",
    ).blocked,
    true,
  );
  const f = robotsFromResponse(
    "eldenring.fandom.com",
    403,
    "text/html",
    "<html>",
  );
  assert.match(f.source, /pinned/);
  assert.equal(robotsAllows(f, "/api.php?action=query"), true);
});

// ---- the polite client

function fakeClock() {
  let t = 1_000_000;
  const waits: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    waits,
  };
}

test("client: names the tool, waits its gap between requests to one site, reads robots.txt once", async () => {
  const clock = fakeClock();
  const seen: Array<{ url: string; ua: string }> = [];
  const c = new PoliteClient({
    gapMs: 1500,
    now: clock.now,
    sleep: clock.sleep,
    log: () => {},
    fetchImpl: async (url, init) => {
      seen.push({
        url,
        ua: String((init.headers as Record<string, string>)["user-agent"]),
      });
      return url.endsWith("/robots.txt")
        ? new Response("User-agent: *\nAllow: /\n", {
            headers: { "content-type": "text/plain" },
          })
        : Response.json({ query: {} });
    },
  });
  await c.api("https://w.example/api.php", { list: "x" });
  await c.api("https://w.example/api.php", { list: "y" });
  assert.equal(seen.filter((s) => s.url.endsWith("/robots.txt")).length, 1);
  assert.ok(seen.every((s) => s.ua === USER_AGENT));
  assert.doesNotMatch(USER_AGENT, /@|gmail|martin/i);
  assert.ok(clock.waits.filter((w) => w >= 1500).length >= 2);
});

test("client: never under a 1 s gap, honours a longer Crawl-delay", async () => {
  const clock = fakeClock();
  const c = new PoliteClient({
    gapMs: 10,
    now: clock.now,
    sleep: clock.sleep,
    log: () => {},
    fetchImpl: async (url) =>
      url.endsWith("/robots.txt")
        ? new Response("User-agent: *\nCrawl-delay: 5\n", {
            headers: { "content-type": "text/plain" },
          })
        : Response.json({}),
  });
  assert.equal(c.gapMs, 1000);
  await c.get("https://w.example/a");
  await c.get("https://w.example/b");
  assert.ok(clock.waits.some((w) => w >= 5000));
});

test("client: backs off on 429 with Retry-After, rests a site after a 403, refuses what robots.txt forbids", async () => {
  const clock = fakeClock();
  let n = 0;
  const c = new PoliteClient({
    now: clock.now,
    sleep: clock.sleep,
    log: () => {},
    fetchImpl: async (url) => {
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nDisallow: /secret\n", {
          headers: { "content-type": "text/plain" },
        });
      if (url.includes("/busy"))
        return ++n < 2
          ? new Response("", { status: 429, headers: { "retry-after": "40" } })
          : new Response("ok");
      if (url.includes("/nope")) return new Response("", { status: 403 });
      return new Response("ok");
    },
  });
  assert.equal((await c.get("https://w.example/busy")).status, 200);
  assert.ok(clock.waits.includes(40_000));
  await assert.rejects(c.get("https://w.example/secret/x"), RobotsDenied);
  await assert.rejects(c.get("https://w.example/nope"), HostRested);
  await assert.rejects(c.get("https://w.example/fine"), HostRested);
  assert.match(c.restedWhy("w.example")!, /403/);
});

// ---- what is kept

const file = (o: Partial<FileFacts>): FileFacts => ({
  title: "File:Thing.png",
  mime: "image/png",
  width: 1200,
  height: 800,
  categories: [],
  wikitext: "",
  description: "",
  licence: "",
  ...o,
});

test("classify: official art, in-game screenshots and logos are kept", () => {
  const art = classifyFile(
    file({
      title: "File:Artwork-JasonDuval-GTAVI.jpg",
      mime: "image/jpeg",
      wikitext: "== Licensing ==\n{{Fairuse}}",
    }),
  );
  assert.equal(art.keep, true);
  assert.equal(art.kind, "artwork");
  assert.equal(art.origin, "official");
  const shot = classifyFile(
    file({
      title: "File:Clique-GTAO-front.png",
      wikitext: "== Licensing ==\n{{Gtao screenshot}}",
      categories: ["Category:Images of GTA Online"],
    }),
  );
  assert.equal(shot.keep, true);
  assert.equal(shot.origin, "in-game");
  const logo = classifyFile(
    file({
      title: "File:ScooterBrothers-GTAO-Logo.png",
      width: 293,
      height: 135,
      wikitext: "{{Gtao screenshot}}",
    }),
  );
  assert.equal(logo.keep, true);
  assert.equal(logo.kind, "logo");
});

test("classify: fan art, edits, cosplay, memes, leaks, AI and real-world photos are turned down", () => {
  const cases: Array<Partial<FileFacts>> = [
    { title: "File:Jason fan art.jpg", wikitext: "{{Fairuse}}" },
    { title: "File:Lucia.png", wikitext: "== Licensing ==\n{{Self}}" },
    {
      title: "File:Lucia.png",
      categories: ["Category:Fan art"],
      wikitext: "{{Fairuse}}",
    },
    { title: "File:Lucia cosplay.jpg", wikitext: "{{Fairuse}}" },
    { title: "File:Vice City meme.png", wikitext: "{{Screenshot}}" },
    { title: "File:GTA6 leaked build.png", wikitext: "{{Screenshot}}" },
    { title: "File:Leonida midjourney.png", wikitext: "{{Fairuse}}" },
    {
      title: "File:Miami beach.jpg",
      description: "A real-life photograph of Miami Beach",
      wikitext: "{{Fairuse}}",
    },
    {
      title: "File:Jason.png",
      description: "I made this render in Blender",
      wikitext: "{{Fairuse}}",
    },
    { title: "File:Car photoshopped.png", wikitext: "{{Screenshot}}" },
    { title: "File:Skyrim ENB modded.png", wikitext: "{{Screenshot}}" },
    { title: "File:Jason-render.png", wikitext: "" },
  ];
  for (const c of cases)
    assert.equal(
      classifyFile(file(c)).keep,
      false,
      `${c.title} ${c.description ?? ""}`,
    );
});

test("classify: a file with no sign of being official or in-game is left out; tiny files too", () => {
  assert.equal(classifyFile(file({ title: "File:Image0042.jpg" })).keep, false);
  assert.equal(
    classifyFile(file({ title: "File:Artwork-X.jpg", width: 100, height: 80 }))
      .keep,
    false,
  );
  assert.equal(
    classifyFile(file({ title: "File:X.pdf", mime: "application/pdf" })).keep,
    false,
  );
  assert.equal(
    classifyFile(
      file({ title: "File:InvisibleHeroImage.png", wikitext: "{{Fairuse}}" }),
    ).keep,
    false,
  );
});

test("kindOf reads the picture's kind from its name", () => {
  assert.equal(kindOf("File:Leonida-Map-GTAVI.png", []), "map");
  assert.equal(kindOf("File:GTAVI-Cover.jpg", []), "boxart");
  assert.equal(kindOf("File:Pisswasser-billboard.png", []), "sign");
  assert.equal(kindOf("File:Something.jpg", ["Category:Logos"]), "logo");
});

// ---- lookup: never invent a picture

const img = (
  id: string,
  kind: ArtImage["kind"],
  o: Partial<ArtImage> = {},
): ArtImage => ({
  id,
  file: `img/${id}.jpg`,
  kind,
  origin: "official",
  width: 1000,
  height: 600,
  bytes: 1,
  wiki: "GTA Wiki",
  filePage: `https://w/File:${id}`,
  fileUrl: "",
  fileTitle: `File:${id}`,
  licence: "Fairuse",
  credit: "Grand Theft Auto VI artwork, via GTA Wiki",
  addedAt: "",
  ...o,
});
const index: ArtIndex = {
  version: 1,
  game: "Grand Theft Auto VI",
  slug: "grand-theft-auto-vi",
  wikis: [],
  updatedAt: "",
  images: [
    img("aaaaaaaaaaaa", "logo"),
    img("bbbbbbbbbbbb", "screenshot", { origin: "in-game" }),
    img("cccccccccccc", "artwork"),
    img("dddddddddddd", "screenshot", { origin: "in-game" }),
  ],
  entities: [
    {
      name: "Scooter Brothers",
      aliases: ["Scooter Bros"],
      type: "brand",
      page: "https://gta.fandom.com/wiki/Scooter_Brothers",
      wiki: "GTA Wiki",
      ofGame: false,
      images: ["bbbbbbbbbbbb", "aaaaaaaaaaaa"],
    },
    {
      name: "Jason Duval",
      aliases: [],
      type: "character",
      page: "p",
      wiki: "GTA Wiki",
      ofGame: true,
      images: ["dddddddddddd", "cccccccccccc"],
    },
    {
      name: "Empty",
      aliases: [],
      type: "thing",
      page: "p",
      wiki: "GTA Wiki",
      ofGame: true,
      images: [],
    },
  ],
};

test("normName evens out spelling", () => {
  assert.equal(normName("Scooter Bros."), normName("Scooter Brothers"));
  assert.equal(normName("The Pokémon Company"), "pokemon company");
  assert.equal(normName("Mandy (GTA 6)"), "mandy");
  assert.equal(normName("Raul's Bar & Grill"), "rauls bar and grill");
});

test("lookup: a name matches only an entity's own name or aliases; no match means no picture", () => {
  assert.equal(
    matchEntities(index, "Scooter Bros")[0]!.name,
    "Scooter Brothers",
  );
  assert.equal(lookupInIndex(index, "Scooter"), undefined);
  assert.equal(lookupInIndex(index, "Brothers"), undefined);
  assert.equal(lookupInIndex(index, "Empty"), undefined);
  assert.equal(lookupInIndex(index, "Lucia Caminos"), undefined);
});

test("lookup: a brand gets its logo, a character its official artwork, with credit and source", () => {
  const brand = lookupInIndex(index, "scooter brothers", {
    base: "http://pc:8793/wikiart",
  })!;
  assert.equal(brand.kind, "logo");
  assert.equal(
    brand.url,
    "http://pc:8793/wikiart/grand-theft-auto-vi/img/aaaaaaaaaaaa.jpg",
  );
  assert.match(brand.credit, /via GTA Wiki/);
  const jason = lookupInIndex(index, "Jason Duval")!;
  assert.equal(jason.kind, "artwork");
  assert.equal(jason.origin, "official");
  const images = new Map(index.images.map((i) => [i.id, i]));
  assert.equal(
    bestImage(index.entities[1]!, images, ["screenshot"])!.id,
    "dddddddddddd",
  );
});

test("lookupArt reads a local library and answers undefined for an unknown game or name", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wikiart-test-"));
  await fs.mkdir(path.join(root, "grand-theft-auto-vi"), { recursive: true });
  await fs.writeFile(
    path.join(root, "grand-theft-auto-vi", "index.json"),
    JSON.stringify(index),
  );
  const hit = await lookupArt("GTA 6", "Scooter Bros", { root, remote: "" });
  assert.equal(hit?.name, "Scooter Brothers");
  assert.equal(
    hit?.file,
    path.join(root, "grand-theft-auto-vi", "img", "aaaaaaaaaaaa.jpg"),
  );
  assert.equal(
    await lookupArt("GTA 6", "Nobody", { root, remote: "" }),
    undefined,
  );
  assert.equal(
    await lookupArt("Unknown Game", "Scooter Bros", { root, remote: "" }),
    undefined,
  );
  await fs.rm(root, { recursive: true, force: true });
});

// ---- dedupe

test("duplicateOf: exact copies and near repeats within an entity; plain logos are never merged across entities", () => {
  const a = img("a00000000000", "screenshot", {
    dhash: "f0f0f0f0a5a5a5a5",
    sha1: "s1",
  });
  const blank = img("b00000000000", "logo", { dhash: "0000000000000001" });
  assert.equal(duplicateOf(undefined, "s1", [], [a])?.id, a.id);
  assert.equal(duplicateOf("f0f0f0f0a5a5a5a4", undefined, [a], [a])?.id, a.id);
  assert.equal(duplicateOf("f0f0f0f0a5a5a5a4", undefined, [], [a])?.id, a.id);
  assert.equal(
    duplicateOf("0000000000000003", undefined, [], [blank]),
    undefined,
  );
  assert.equal(hashBits("ffff"), 16);
});

// ---- which wiki and which pages

test("wikis: GTA games go to GTA Wiki under their short names; GTA V never takes GTA VI's categories", () => {
  const rule = franchiseFor("Grand Theft Auto VI")!;
  assert.equal(rule.wiki.api, "https://gta.fandom.com/api.php");
  assert.ok(
    rootCategoryCandidates("Grand Theft Auto VI", rule).includes(
      "Category:GTA VI",
    ),
  );
  assert.ok(
    rootCategoryCandidates("Grand Theft Auto: San Andreas", rule).includes(
      "Category:GTA San Andreas",
    ),
  );
  assert.equal(categoryOfGame("Category:Vehicles in GTA VI", ["GTA VI"]), true);
  assert.equal(categoryOfGame("Category:Vehicles in GTA VI", ["GTA V"]), false);
  assert.equal(
    categoryOfGame("Category:Vehicles in GTA Vice City", ["GTA V"]),
    false,
  );
  assert.equal(boringCategory("Category:Beta changes in GTA VI"), true);
  assert.equal(
    franchiseFor("The Legend of Zelda: Ocarina of Time")!.wiki.api,
    "https://zeldawiki.wiki/w/api.php",
  );
  assert.deepEqual(
    guessWikis("Hades II").map((w) => w.api),
    [
      "https://hades.fandom.com/api.php",
      "https://hades.wiki.gg/api.php",
      "https://hadesii.fandom.com/api.php",
      "https://hadesii.wiki.gg/api.php",
    ],
  );
});

test("pages: a file belongs to a page when it carries the page's name; gallery files are named by their file name", () => {
  assert.equal(
    fileAboutPage("File:ScooterBrothers-GTAO-Logo.png", "Scooter Brothers"),
    true,
  );
  assert.equal(
    fileAboutPage(
      "File:Clique-GTAO-front-ScooterBro'sRacer.png",
      "Scooter Brothers",
    ),
    false,
  );
  assert.equal(
    fileAboutPage("File:Bleeter-GTAV-Icon.png", "Scooter Brothers"),
    false,
  );
  assert.equal(
    fileAboutPage("File:JasonDuval-GTAVI-Trailer.jpg", "Jason Duval"),
    true,
  );
  assert.equal(
    nameFromFile("File:Artwork-JasonDuval-GTAVI.jpg", ["GTAVI"]),
    "Jason Duval",
  );
  assert.equal(
    nameFromFile("File:Artwork-BoobieIke-GTAVI.jpg", ["GTAVI"]),
    "Boobie Ike",
  );
  assert.equal(
    nameFromFile("File:Artwork-MountKalaga-BG-GTAVI.jpg", ["GTAVI"]),
    "Mount Kalaga",
  );
  assert.equal(entityType(["Category:Characters in GTA VI"]), "character");
  assert.equal(
    entityType([
      "Category:Mod shop brands",
      "Category:Businesses in GTA Online",
    ]),
    "brand",
  );
  assert.equal(entityType(["Category:Radio Stations in GTA VI"]), "radio");
  assert.equal(
    entityType(["Category:Locations in GTA VI in Vice City"]),
    "place",
  );
});

// ---- serving

test("serve: only index.json and pictures under img/ inside the library", () => {
  const root = path.resolve("lib-root");
  assert.equal(
    wikiartFile(root, "grand-theft-auto-vi/index.json"),
    path.join(root, "grand-theft-auto-vi", "index.json"),
  );
  assert.equal(
    wikiartFile(root, "grand-theft-auto-vi/img/aaaaaaaaaaaa.jpg"),
    path.join(root, "grand-theft-auto-vi", "img", "aaaaaaaaaaaa.jpg"),
  );
  assert.equal(wikiartFile(root, "grand-theft-auto-vi/state.json"), undefined);
  assert.equal(wikiartFile(root, "../secret/index.json"), undefined);
  assert.equal(
    wikiartFile(root, "grand-theft-auto-vi/img/../../x.jpg"),
    undefined,
  );
});

// ---- structured file pages, game ties, galleries, the publisher's own stills

import { templateKind, templateGame } from "../src/wikiart/classify.ts";
import {
  fileOfGame,
  gameCodes,
  isGallery,
  withoutGameNames,
} from "../src/wikiart/crawl.ts";
import { nameTag } from "../src/wikiart/libimport.ts";
import { STRATEGYWIKI } from "../src/wikiart/wikis.ts";

test("classify: Zelda Wiki style {{FileInfo}} pages: type, game and licensing are read; models need an official source", () => {
  const art =
    "{{FileInfo\n|summary= Official artwork of [[Ganondorf]]\n|type= Artwork\n|game= OoT\n|licensing= Copyright\n}}";
  assert.equal(templateKind(art), "artwork");
  assert.equal(templateGame(art), "OoT");
  const v = classifyFile(
    file({ title: "File:OoT Ganondorf Artwork.png", wikitext: art }),
  );
  assert.equal(v.keep, true);
  assert.match(v.licence!, /Copyright/);
  const model =
    "{{FileInfo\n|type= Model\n|game= OoT3D\n|licensing= Copyright\n}}";
  assert.equal(
    classifyFile(
      file({ title: "File:OoT3D Ganondorf Model.png", wikitext: model }),
    ).keep,
    false,
  );
  const official =
    "{{FileInfo\n|type= Render\n|source= {{Cite Web|url= https://www.nintendo.com/jp/games/switch2/aa9ja/index.html}}\n|licensing= Copyright\n}}";
  assert.equal(
    classifyFile(
      file({ title: "File:OoTNS2 Navi Render.png", wikitext: official }),
    ).keep,
    true,
  );
  assert.equal(
    classifyFile(
      file({
        title: "File:X Render.png",
        wikitext: `${official}\n{{Watermark}}`,
      }),
    ).keep,
    false,
  );
  assert.equal(
    classifyFile(
      file({ title: "File:MM3D Deku Mask Printable.png", wikitext: art }),
    ).keep,
    false,
  );
});

test("game codes: initials keep numerals whole, so GTA V never claims GTA VI's files; remakes count as the game", () => {
  const vi = gameCodes(["GTA VI", "Grand Theft Auto VI"]);
  assert.ok(vi.includes("gtavi"));
  assert.ok(!vi.includes("gtav"));
  const oot = gameCodes([
    "Ocarina of Time",
    "The Legend of Zelda: Ocarina of Time",
  ]);
  assert.ok(oot.includes("oot"));
  assert.equal(
    fileOfGame(
      "File:OoT3D Navi Artwork.png",
      oot,
      undefined,
      [],
      ["Ocarina of Time"],
    ),
    true,
  );
  assert.equal(
    fileOfGame(
      "File:OoTNS2 Kakariko Village.png",
      oot,
      undefined,
      [],
      ["Ocarina of Time"],
    ),
    true,
  );
  assert.equal(
    fileOfGame("File:HW Navi Cameo.png", oot, "HW", [], ["Ocarina of Time"]),
    false,
  );
  assert.equal(
    fileOfGame("File:Navi.png", oot, "OoT", [], ["Ocarina of Time"]),
    true,
  );
  assert.equal(
    fileOfGame(
      "File:Navi.png",
      oot,
      undefined,
      ["Category:Ocarina of Time Artwork"],
      ["Ocarina of Time"],
    ),
    true,
  );
  const v = gameCodes(["GTA V", "Grand Theft Auto V"]);
  assert.equal(
    fileOfGame(
      "File:Artwork-JasonDuval-GTAVI.jpg",
      v,
      undefined,
      [],
      ["GTA V"],
    ),
    false,
  );
});

test("galleries: StrategyWiki subpages and /Artwork pages; game names come out of file names", () => {
  assert.equal(isGallery(STRATEGYWIKI, "Grand Theft Auto V/Characters"), true);
  assert.equal(isGallery(STRATEGYWIKI, "Grand Theft Auto V"), false);
  assert.equal(
    isGallery({ id: "gta.fandom" }, "Grand Theft Auto VI/Artwork"),
    true,
  );
  assert.equal(isGallery({ id: "gta.fandom" }, "Jason Duval"), false);
  assert.equal(
    nameFromFile(
      withoutGameNames("File:Elden Ring Malenia.png", ["Elden Ring"]),
      [],
    ),
    "Malenia",
  );
});

test("library import: only real names become entities", () => {
  assert.equal(nameTag("Jason Duval"), true);
  assert.equal(nameTag("Vice City"), true);
  assert.equal(nameTag("screenshot"), false);
  assert.equal(nameTag("VINTAGE VICE CITY WEAPON PATTERN"), false);
});
