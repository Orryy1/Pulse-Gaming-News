// MENTION_OUTLETS and MENTION_INWORLD (20 Nov 2026): an outlet the story cites shows its own masthead on its name, and
// an in-game thing the script names shows its real in-game picture.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  outletsCited,
  storySourcesText,
  outletFileOk,
  mentionsOnWords,
} from "../src/assets/mentions.ts";
import {
  inworldCandidates,
  pageInGame,
  infoboxPicture,
  wikiFileOk,
  libraryNaming,
  shotsNaming,
} from "../src/assets/inworld.ts";
import type { LibItem } from "../src/assets/gamelib.ts";

function wordsOf(text: string, per = 0.36) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({ text: w, start: i * per, end: i * per + per * 0.85 }));
}

const SCOOTER =
  "In GTA 6, your car could come to you. Edge's preview describes Scooter Bros, a handy phone app that delivers your own car for a fee. A driver arrives within a few seconds. Then they leave on a scooter they brought along. Edge says your weapons are stored in the trunk. Even better, delivery brings your weapons back too. Paying to skip the walk makes sense. I'd use the app. My verdict: Edge's preview makes Scooter Bros sound worth using. For your next robbery, your car could come straight to you.";

test("outlets: Edge, a source of the Scooter Bros story, gets its masthead on its name; never on 'the edge'", () => {
  const sourcesText = storySourcesText({
    items: [
      {
        source:
          "GTA BOOM, summarising Edge issue 430's hands-on preview (29 Oct 2026)",
        title: "GTA 6 Edge preview",
      },
    ],
    attribution: "Source: Edge issue 430 via GTA BOOM",
  });
  assert.deepEqual(
    outletsCited({ spoken: SCOOTER, sourcesText }).map((c) => c.key),
    ["edge"],
  );
  // Named but neither a source of the story nor credited in the line: nothing.
  assert.deepEqual(
    outletsCited({
      spoken: "IGN has a map of the city.",
      sourcesText: "Rockstar Newswire",
    }).map((c) => c.key),
    [],
  );
  // Credited in the line itself ("according to IGN"): a source.
  const said = "According to IGN the map is huge.";
  assert.deepEqual(
    outletsCited({ spoken: said, sourcesText: "", words: wordsOf(said) }).map(
      (c) => c.key,
    ),
    ["ign"],
  );
  assert.equal(outletFileOk({ names: ["Edge"] }, "File:EDGE logo.svg"), true);
  assert.equal(
    outletFileOk({ names: ["Pure Xbox"] }, "File:Logo Gamer Network.svg"),
    false,
    "a parent company's logo is not the outlet's",
  );
  const item = {
    kind: "outlet" as const,
    key: "outlet:edge",
    aliases: ["Edge"],
    pictures: [
      {
        file: "assets/mention_outlet_edge.png",
        label: "Edge",
        provenance: "x",
        sourceUrl: "y",
      },
    ],
  };
  const w = wordsOf(SCOOTER);
  const on = mentionsOnWords([item], w, { kinds: new Set(["outlet"]) });
  assert.deepEqual(
    on.map((m) => w.find((x) => x.start === m.at)!.text),
    ["Edge's", "Edge", "Edge's"],
  );
  const lower = wordsOf("You drive right to the edge of the map.");
  assert.equal(
    mentionsOnWords([item], lower, { kinds: new Set(["outlet"]) }).length,
    0,
  );
});

test("in-world names: brands, stations and places, never headings, products, outlets or the game itself", () => {
  assert.deepEqual(
    inworldCandidates({
      spoken: SCOOTER,
      mainGame: "Grand Theft Auto VI",
      exclude: ["Edge"],
    }),
    ["Scooter Bros"],
  );
  assert.deepEqual(
    inworldCandidates({
      spoken:
        "Rockstar previews six stations. Flash FM pairs Robyn and Alex with pop, while Dirty South Classics has Trick and Trina.",
      mainGame: "Grand Theft Auto VI",
      exclude: ["Rockstar"],
    }),
    ["Flash FM", "Dirty South Classics"],
  );
  assert.deepEqual(
    inworldCandidates({
      spoken:
        "Claims That Fail. Finding Your Way. If Grand Theft Auto VI ships, the Vintage Vice City Pack is in the Ultimate Edition. What is GTA 6's WAINK app? Port Gellhorn sits north.",
      mainGame: "Grand Theft Auto VI",
      exclude: [],
    }),
    ["WAINK", "Port Gellhorn"],
  );
});

test("in-world pictures: wiki pages must place the thing in this game; file pages must not be fan work", () => {
  const flash = [
    "{{Infobox media",
    "|type = radiostation",
    "|name = Flash FM",
    "|logo = ",
    "|image = Flash-logo.04o~oki.8dgm0.png",
    "|caption = '''Flash FM''' logo in {{VI}}.",
    "|games = {{Games|VI=y}}",
    "}}",
  ].join("\n");
  assert.equal(pageInGame(flash, "VI"), true);
  assert.equal(
    pageInGame("{{Infobox business\n|games = {{games|V=y|O=y}}\n}}", "VI"),
    false,
    "Scooter Brothers is a GTA V and Online brand, not GTA VI's",
  );
  assert.deepEqual(infoboxPicture(flash), {
    file: "Flash-logo.04o~oki.8dgm0.png",
    field: "image",
    caption: "'''Flash FM''' logo in {{VI}}.",
  });
  assert.deepEqual(wikiFileOk("== Licensing ==\n{{Gtao screenshot}}"), {
    ok: true,
    by: "file page",
  });
  assert.equal(
    wikiFileOk("A fan render made by me\n{{Gtao screenshot}}").ok,
    false,
  );
  assert.equal(
    wikiFileOk("").ok,
    false,
    "an empty file page is not checked by itself",
  );
  assert.deepEqual(
    wikiFileOk("", { caption: "'''Flash FM''' logo in {{VI}}.", code: "VI" }),
    { ok: true, by: "caption" },
  );
  assert.equal(
    wikiFileOk("", { caption: "Fan-made logo concept in {{VI}}", code: "VI" })
      .ok,
    false,
  );
  const still = (id: string, o: Partial<LibItem>): LibItem => ({
    id,
    kind: "still",
    file: `stills/${id}.jpg`,
    sourceUrl: id,
    provenance: id,
    source: "Rockstar Games",
    named: [],
    tags: [],
    seen: "",
    addedAt: "",
    ...o,
  });
  const items = [
    still("motel", {
      named: ["Port Gellhorn"],
      seen: "Night scene of Starlet Motel with neon sign",
      unusable: "large lettering",
    }),
    still("pg", { named: ["Port Gellhorn"], seen: "Sunset over a small town" }),
    still("bad", { seen: "Starlet Motel sign", unusable: "not ad-safe" }),
  ];
  assert.deepEqual(
    libraryNaming(items, "Port Gellhorn")
      .map((h) => h.item.id)
      .sort(),
    ["motel", "pg"],
  );
  assert.deepEqual(
    libraryNaming(items, "Starlet Motel").map((h) => h.item.id),
    ["motel"],
    "a sign's lettering is the point; not ad-safe stays out",
  );
  const shots = [
    {
      id: 1,
      start: 0,
      end: 4,
      keyframes: [1],
      desc: "A man drives",
      who: [],
      where: "",
      mood: "",
      tags: [],
      text: "THE RUSTY ANCHOR",
      luma: 90,
      motion: 4,
    },
    {
      id: 2,
      start: 4,
      end: 8,
      keyframes: [5],
      desc: "Rusty anchor on a beach",
      who: [],
      where: "",
      mood: "",
      tags: [],
      text: "SALE",
      luma: 90,
      motion: 4,
    },
  ];
  assert.deepEqual(
    shotsNaming({ shots } as never, "The Rusty Anchor").map((x) => x.id),
    [1],
  );
});

test("wiki checks: recreations and fan logos are refused; a linked infobox value is the same file", () => {
  assert.equal(wikiFileOk("Logo recreated by a user\n{{Logo}}").ok, false);
  assert.equal(wikiFileOk("{{Fan logo}}").ok, false);
  assert.equal(wikiFileOk("{{Official notice about something}}").ok, false, "not a licence template that says what the picture is");
  assert.deepEqual(infoboxPicture("|sign = [[File:Sign-GTAVI.png|thumb]]\n|games = {{Games|VI=y}}")?.file, "Sign-GTAVI.png");
});

test("outlets: 'according to the Guardian' mid-sentence counts; a Title Case headline never makes Edge a source", () => {
  const said = "According to the Guardian the map is huge.";
  assert.deepEqual(
    outletsCited({ spoken: said, sourcesText: "The Guardian" }).map((c) => c.key),
    ["guardian"],
  );
  const text = storySourcesText({ items: [{ source: "IGN", title: "GTA 6 Pushes The Edge Of Open Worlds" }] });
  assert.deepEqual(
    outletsCited({ spoken: "Edge of the map is where you spawn.", sourcesText: text }).map((c) => c.key),
    [],
  );
});

test("the wiki art library's answer is read as it is sent: its credit and page, and never another game's picture", async () => {
  const { wikiArt } = await import("../src/assets/inworld.ts");
  const prev = process.env.WIKIART_LOOKUP_URL;
  process.env.WIKIART_LOOKUP_URL = "http://10.77.0.1:8793/wikiart/lookup";
  const hit = (forGame: boolean) =>
    (async () =>
      new Response(
        JSON.stringify({
          game: "Grand Theft Auto VI",
          name: "Vice City",
          type: "place",
          kind: "screenshot",
          origin: "library",
          forGame,
          url: "http://10.77.0.1:8793/wikiart/gta-vi/img/abc.jpg",
          width: 1600,
          height: 900,
          credit: "Rockstar Games official screenshot",
          licence: "official",
          sourcePage: "https://www.rockstargames.com/VI",
          filePage: "https://www.rockstargames.com/VI",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
  try {
    const a = await wikiArt("Grand Theft Auto VI", "Vice City", hit(true));
    assert.equal(a?.url, "http://10.77.0.1:8793/wikiart/gta-vi/img/abc.jpg");
    assert.equal(a?.credit, "Image: Rockstar Games official screenshot");
    assert.equal(a?.pageUrl, "https://www.rockstargames.com/VI");
    const b = await wikiArt("Grand Theft Auto VI", "Vice City", hit(false));
    assert.notEqual(b?.url, "http://10.77.0.1:8793/wikiart/gta-vi/img/abc.jpg");
  } finally {
    if (prev === undefined) delete process.env.WIKIART_LOOKUP_URL;
    else process.env.WIKIART_LOOKUP_URL = prev;
  }
});
