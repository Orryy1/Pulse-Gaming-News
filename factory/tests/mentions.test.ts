import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { buildSegments, type SegmentInput } from "../src/render/timeline.ts";
import {
  arbitrate,
  overlaySpans,
  settleMentions,
  shortLayout,
} from "../src/render/cleanframe.ts";
import { auditShortGraphics, type ShortGfxInput } from "../src/qa/gfxaudit.ts";
import {
  MENTION_MIN_FRAMES,
  attributedTimes,
  insetFrame,
  mentionCap,
  mentionSlots,
  pairGames,
  phraseTimes,
  placePairAt,
  platformRuns,
  type MentionInset,
} from "../src/render/mentions.ts";
import {
  characterTags,
  companiesSaid,
  exactGame,
  findMentions,
  gameAliases,
  gameCandidates,
  logoAllowed,
  mentionsOnWords,
  receiptDate,
  receiptSources,
  type MentionAsset,
} from "../src/assets/mentions.ts";
import { mentionKinds, mentionPlacement } from "../src/pipeline.ts";
import { loadConfig } from "../src/config.ts";
import { tmpDir } from "./helpers.ts";

function wordsOf(text: string, per = 0.36, from = 0) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({
      text: w,
      start: from + i * per,
      end: from + i * per + per * 0.85,
    }));
}

const game = (key: string, at: number, label = key): MentionInset => ({
  kind: "game",
  key,
  at,
  pictures: [{ src: `${key}.jpg`, label }],
});

// ---- Matching names to words -------------------------------------------------------------------------------

test("a name lands on its first spoken word: numbers as words or numerals, possessives, 'the' and aligner splits", () => {
  const w = wordsOf(
    "It looks bigger than Grand Theft Auto five's map, and The Witcher three on PS 5 too.",
  );
  assert.deepEqual(phraseTimes(w, "Grand Theft Auto V"), [w[4]!.start]);
  assert.deepEqual(phraseTimes(w, "Grand Theft Auto 5"), [w[4]!.start]);
  assert.deepEqual(phraseTimes(w, "Witcher 3"), [w[11]!.start]);
  assert.deepEqual(phraseTimes(w, "PS5"), [w[14]!.start]);
  assert.deepEqual(phraseTimes(w, "Red Dead Redemption 2"), []);
  // Every time it is said, in order.
  const twice = wordsOf("Elden Ring sold well. Elden Ring's DLC too.");
  assert.equal(phraseTimes(twice, "Elden Ring").length, 2);
});

test("a receipt needs an attribution: 'Bloomberg's Jason Schreier reports', 'according to IGN'; a bare name is not one", () => {
  const w = wordsOf(
    "Bloomberg's Jason Schreier reports it is late. According to IGN, it slipped. Bloomberg is a newspaper. Rockstar confirmed it.",
  );
  const b = attributedTimes(w, ["Bloomberg"]);
  assert.equal(b.length, 1);
  assert.equal(b[0]!.at, w[0]!.start);
  assert.equal(b[0]!.verb, "REPORTED");
  assert.equal(attributedTimes(w, ["IGN"])[0]?.at, w[9]!.start);
  assert.equal(attributedTimes(w, ["Rockstar"])[0]?.verb, "CONFIRMED");
});

test("a platform row needs a list: two or more platforms close together, each mark once, Steam Deck is not PC", () => {
  const w = wordsOf(
    "It launches on PS5, Xbox Series X and PC in May. Later a PS5 Pro patch.",
  );
  const runs = platformRuns(w);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0]!.platforms, ["PS5", "XBOX SERIES X|S", "PC"]);
  assert.equal(runs[0]!.at, w[3]!.start);
  assert.deepEqual(platformRuns(wordsOf("Only on PS5 for now.")), []);
  assert.deepEqual(
    platformRuns(wordsOf("It runs on Steam Deck and Nintendo Switch 2."))[0]
      ?.platforms,
    ["STEAM DECK", "SWITCH 2"],
  );
});

test("a real place shows only alongside its game version", () => {
  const pair = { game: ["Vice City"], real: ["Miami"] };
  const w = wordsOf("Vice City is Rockstar's version of Miami, sun and neon.");
  assert.equal(placePairAt(w, pair), w[0]!.start);
  assert.equal(
    placePairAt(
      wordsOf("Miami has great weather and beaches all year long."),
      pair,
    ),
    undefined,
  );
});

test("a game is the store title only when it is exactly that game", () => {
  assert.equal(
    exactGame("Dragon Age The Veilguard", "Dragon Age™: The Veilguard"),
    true,
  );
  assert.equal(
    exactGame("Red Dead Redemption 2", "Red Dead Redemption 2"),
    true,
  );
  assert.equal(
    exactGame("Grand Theft Auto V", "Grand Theft Auto V Enhanced"),
    true,
  );
  assert.equal(exactGame("Star Wars", "STAR WARS Jedi: Survivor™"), false);
  assert.equal(exactGame("Battlefront 3", "STAR WARS™ Battlefront™ II"), false);
  assert.equal(exactGame("Hades", "Hades II"), false);
  assert.ok(gameAliases("Grand Theft Auto V").includes("gta v"));
  const c = gameCandidates({
    spoken:
      "Mass Effect 5 reportedly lost to Battlefront 3 at EA. BioWare's Dragon Age The Veilguard reportedly missed sales. That's not the whole story.",
    listed: ["Dragon Age The Veilguard", "Rook", "clone troopers"],
    mainGame: "Mass Effect 5",
  });
  assert.ok(c.includes("Battlefront 3"), JSON.stringify(c));
  assert.ok(c.some((x) => /Dragon Age The Veilguard/.test(x)));
  assert.ok(
    !c.some((x) => /Mass Effect 5/.test(x)),
    "the video's own game is left out",
  );
  assert.ok(!c.includes("That's"));
  // A writer's keyword the narration never says is not a candidate.
  assert.ok(!c.includes("Rook") && !c.includes("clone troopers"));
});

test("companies are matched as whole names on their own name only", () => {
  assert.deepEqual(
    companiesSaid(
      "It's really real: EA confirmed BioWare's fate, and Rockstar stayed quiet.",
    ).map((c) => c.key),
    ["ea", "bioware", "rockstar"],
  );
  assert.deepEqual(companiesSaid("A leak with no studio named."), []);
  assert.equal(
    logoAllowed({
      title: "File:EA logo.svg",
      license: "Public domain",
      width: 800,
      height: 400,
    }).ok,
    true,
  );
  assert.equal(
    logoAllowed({
      title: "File:X.png",
      license: "Fair use",
      width: 800,
      height: 400,
    }).ok,
    false,
  );
  assert.equal(
    logoAllowed({
      title: "File:X.png",
      license: "CC BY-NC 4.0",
      width: 800,
      height: 400,
    }).ok,
    false,
  );
});

test("characters come only from the publisher's own named gallery pictures, places left out", () => {
  const still = (tag: string) => ({
    kind: "still" as const,
    tags: [tag],
    url: `https://www.rockstargames.com/VI/${tag.replace(/ /g, "_")}_01.jpg`,
    name: `${tag} 01`,
    listedAt: "https://www.rockstargames.com/VI",
    publisher: "Rockstar Games",
  });
  const tags = characterTags([
    still("Jason Duval"),
    still("Lucia Caminos"),
    still("Vice City"),
    still("Leonida Keys"),
    still("Ambrosia"),
  ]);
  assert.deepEqual(
    tags.map((t) => t.name),
    ["Jason Duval", "Lucia Caminos"],
  );
  assert.deepEqual(tags[0]!.aliases, ["Jason Duval", "Jason"]);
});

// ---- Receipts never invent a source ---------------------------------------------------------------------

const ITEMS = [
  {
    url: "https://www.pushsquare.com/news/2026/10/x",
    title: "New Mass Effect cancelled",
    source: "Push Square",
    summary: "So says new Bloomberg report.",
    publishedAt: "2026-10-30T15:30:00.000Z",
  },
  {
    url: "https://www.pcgamer.com/x",
    title: "EA reportedly canned BioWare",
    source: "PC Gamer",
    summary: "One last bitter drop.",
    publishedAt: "2026-10-30T16:43:23.000Z",
  },
  {
    url: "https://www.rockstargames.com/newswire/x",
    title: "GTA VI date",
    source: "Rockstar Newswire",
    sourceKind: "official",
    publishedAt: "2026-05-02T12:00:00.000Z",
  },
];

test("receipts come only from the story's own sources, dated by the article; a cited report is carried by its article", () => {
  const r = receiptSources({
    items: ITEMS,
    attribution: "Source: Bloomberg via Push Square / PC Gamer",
  });
  const by = new Map(r.map((x) => [x.outlet, x]));
  assert.equal(by.get("Push Square")?.date, "2026-10-30T15:30:00.000Z");
  assert.equal(by.get("Bloomberg")?.via, "Push Square");
  assert.ok(by.get("Rockstar Newswire")?.aliases.includes("Rockstar"));
  assert.ok(!by.has("IGN"));
  assert.equal(receiptDate("2026-10-30T15:30:00.000Z"), "OCT 30, 2026");
  assert.equal(receiptDate("2026-10"), "OCT 2026");
  assert.equal(receiptDate(undefined), undefined);
  // On the words: IGN is attributed in the narration but is not a source, so no chip.
  const items: MentionAsset[] = r.map((x) => ({
    kind: "receipt",
    key: `receipt:${x.outlet.toLowerCase()}`,
    aliases: x.aliases,
    pictures: [],
    receipt: { outlet: x.outlet, date: x.date, via: x.via },
  }));
  const w = wordsOf(
    "Bloomberg's Jason Schreier reports it. According to IGN, it slipped. PC Gamer says sources agree.",
  );
  const on = mentionsOnWords(items, w, { kinds: new Set(["receipt"]) });
  assert.deepEqual(
    on.map((m) => m.label),
    ["Bloomberg", "PC Gamer"],
  );
  assert.equal(on[0]!.sub, "REPORTED · OCT 30, 2026");
  assert.equal(on[0]!.note, "via Push Square");
  assert.equal(on[1]!.sub, "SAID · OCT 30, 2026");
});

test("a game in a comparison stands beside the video's own game; otherwise alone; a kind switched off shows nothing", () => {
  const items: MentionAsset[] = [
    {
      kind: "game",
      key: "game:1",
      aliases: ["Grand Theft Auto 6", "GTA 6"],
      mainGame: true,
      pictures: [
        {
          file: "main.jpg",
          label: "Grand Theft Auto VI",
          provenance: "",
          sourceUrl: "",
        },
      ],
    },
    {
      kind: "game",
      key: "game:2",
      aliases: ["Red Dead Redemption 2", "Red Dead 2"],
      pictures: [
        {
          file: "rdr2.jpg",
          label: "Red Dead Redemption 2",
          provenance: "",
          sourceUrl: "",
        },
      ],
    },
  ];
  const w = wordsOf(
    "GTA 6's map is bigger than Red Dead 2's. Red Dead 2 still looks great.",
  );
  const on = mentionsOnWords(items, w, { kinds: new Set(["game"]) });
  assert.equal(on.length, 2);
  assert.deepEqual(
    on[0]!.pictures.map((p) => p.label),
    ["Grand Theft Auto VI", "Red Dead Redemption 2"],
  );
  assert.deepEqual(
    on[1]!.pictures.map((p) => p.label),
    ["Red Dead Redemption 2"],
  );
  assert.deepEqual(mentionsOnWords(items, w, { kinds: new Set(["logo"]) }), []);
  // Two games named in one breath share one inset.
  const paired = pairGames([game("a", 2), game("b", 3.5), game("c", 20)]);
  assert.equal(paired.length, 2);
  assert.equal(paired[0]!.pictures.length, 2);
});

// ---- The schedule: cap, no overlap, reading time, no verified picture -----------------------------------

test("the cap keeps the strongest kinds, never two at once, each up long enough to read", () => {
  const ms: MentionInset[] = [
    game("g1", 2),
    {
      kind: "logo",
      key: "l1",
      at: 5,
      pictures: [{ src: "l.png", label: "EA" }],
    },
    {
      kind: "receipt",
      key: "r1",
      at: 8,
      pictures: [],
      label: "Bloomberg",
      sub: "REPORTED · OCT 30, 2026",
    },
    game("g2", 8.4),
    {
      kind: "platform",
      key: "p",
      at: 14,
      pictures: [],
      platforms: ["PS5", "PC"],
    },
    game("g3", 18),
    game("g4", 24),
    game("g5", 30),
    game("g6", 36),
  ];
  const slots = mentionSlots(ms, {
    fps: 30,
    totalFrames: 45 * 30,
    max: 5,
    layout: "short",
  });
  assert.equal(slots.length, 5);
  // The receipt outranks the game said at the same moment, the platform row and the logo go first under the cap.
  assert.ok(slots.some((s) => s.m.key === "r1"));
  assert.ok(!slots.some((s) => s.m.kind === "platform" || s.m.kind === "logo"));
  for (let k = 1; k < slots.length; k++)
    assert.ok(slots[k]!.from >= slots[k - 1]!.to, "never two at once");
  for (const s of slots) {
    assert.ok(s.to - s.from >= MENTION_MIN_FRAMES, "at least 1.2 s");
    assert.equal(s.from, Math.round(s.m.at * 30), "on its word");
  }
  assert.equal(mentionCap("short", 5, 50), 5);
  assert.equal(mentionCap("long", 5, 600), 15);
});

test("no verified picture, no inset: a missing file, half a place pair or an empty row is never shown", () => {
  const ms: MentionInset[] = [
    { kind: "game", key: "nopic", at: 2, pictures: [] },
    {
      kind: "character",
      key: "blank",
      at: 6,
      pictures: [{ src: "", label: "Jason" }],
    },
    {
      kind: "realplace",
      key: "half",
      at: 10,
      pictures: [{ src: "miami.jpg", label: "Miami" }],
    },
    { kind: "platform", key: "one", at: 14, pictures: [], platforms: ["PS5"] },
    { kind: "receipt", key: "anon", at: 18, pictures: [], label: " " },
  ];
  assert.deepEqual(
    mentionSlots(ms, { fps: 30, totalFrames: 900, max: 5, layout: "short" }),
    [],
  );
});

test("the same thing shows once in a Short; a long video may repeat it after four minutes; taken spans are never entered", () => {
  const ms = [game("a", 2), game("a", 20), game("a", 300)];
  assert.equal(
    mentionSlots(ms, {
      fps: 30,
      totalFrames: 400 * 30,
      max: 5,
      layout: "short",
    }).length,
    1,
  );
  assert.equal(
    mentionSlots(ms, { fps: 30, totalFrames: 400 * 30, max: 5, layout: "long" })
      .length,
    2,
  );
  const held = mentionSlots([game("b", 10)], {
    fps: 30,
    totalFrames: 900,
    max: 5,
    layout: "long",
    taken: [{ from: 280, to: 340 }],
  });
  assert.equal(held.length, 0, "starts inside a taken span: not shown late");
  const cut = mentionSlots([game("b", 10)], {
    fps: 30,
    totalFrames: 900,
    max: 5,
    layout: "long",
    taken: [{ from: 360, to: 400 }],
  });
  assert.equal(cut[0]!.to, 360);
  // A newcomer cuts the one before short only after that one has been read.
  const close = mentionSlots([game("x", 2), game("y", 2.5)], {
    fps: 30,
    totalFrames: 900,
    max: 5,
    layout: "short",
  });
  assert.equal(close.length, 1, "within the pairing window two games pair");
  assert.equal(close[0]!.m.pictures.length, 2);
  const later = mentionSlots(
    [
      game("x", 2),
      {
        kind: "logo",
        key: "l",
        at: 4,
        pictures: [{ src: "l.png", label: "EA" }],
      },
    ],
    { fps: 30, totalFrames: 900, max: 5, layout: "short" },
  );
  assert.deepEqual(
    later.map((s) => [s.from, s.to]),
    [
      [60, 120],
      [120, 204],
    ],
  );
});

// ---- The clean frame: an inset replaces its beat's card, a logo gives way -----------------------------------

function newsShort() {
  const inputs: SegmentInput[] = [
    {
      kind: "hook",
      text: "Mass Effect 5 reportedly lost to Battlefront 3 at EA.",
    },
    {
      kind: "beat",
      text: "Bloomberg's Jason Schreier reports Battlefront 3 hasn't even started development.",
      visual: {
        kind: "title",
        primary: "NOT EVEN STARTED",
        secondary: "Battlefront 3, per Bloomberg",
      },
    },
    {
      kind: "beat",
      text: "That's not the whole story. EA owes $18 billion after its buyout, and executives saw Star Wars as safer.",
      visual: {
        kind: "stat",
        primary: "$18 BILLION",
        secondary: "EA's leveraged debt",
      },
    },
    {
      kind: "beat",
      text: "BioWare's Dragon Age The Veilguard reportedly missed sales expectations by 50%.",
      visual: {
        kind: "stat",
        primary: "-50%",
        secondary: "Veilguard vs sales target",
      },
    },
    { kind: "loop", text: "Which would you have greenlit?" },
  ];
  const words = inputs
    .flatMap((s) => s.text.split(/\s+/))
    .map((w, i) => ({ text: w, start: i * 0.36, end: i * 0.36 + 0.3 }));
  const seconds = words.at(-1)!.end + 1;
  return {
    inputs,
    words,
    segments: buildSegments(inputs, words, seconds),
    totalFrames: Math.round(seconds * 30),
  };
}

test("an inset never adds a layer: a game or a receipt replaces its beat's card, a logo gives way to the card", () => {
  const sh = newsShort();
  const plan = {
    fps: 30,
    totalFrames: sh.totalFrames,
    tailFrames: 30,
    shelf: [],
    craft: undefined,
  };
  const items: MentionAsset[] = [
    {
      kind: "receipt",
      key: "receipt:bloomberg",
      aliases: ["Bloomberg"],
      pictures: [],
      receipt: { outlet: "Bloomberg", date: "2026-10-30", via: "Push Square" },
    },
    {
      kind: "logo",
      key: "logo:ea",
      aliases: ["EA"],
      pictures: [
        { file: "ea.png", label: "EA", provenance: "", sourceUrl: "" },
      ],
    },
    {
      kind: "game",
      key: "game:veil",
      aliases: ["Dragon Age The Veilguard"],
      pictures: [
        {
          file: "v.jpg",
          label: "Dragon Age: The Veilguard",
          provenance: "",
          sourceUrl: "",
        },
      ],
    },
  ];
  const cfg = {
    ...loadConfig(),
    mentionGames: true,
    mentionLogos: true,
    mentionReceipts: true,
    mentionMaxPerShort: 5,
  };
  const { slots } = mentionPlacement(
    cfg,
    { kinds: mentionKinds(cfg), items },
    sh.words,
    plan,
    "short",
    [{ from: 0, to: shortLayout(sh.segments, 30, sh.totalFrames, 30).hookEnd }],
  );
  // Nothing in the hook: its headline holds the frame.
  assert.ok(
    !slots.some(
      (s) => s.from < shortLayout(sh.segments, 30, sh.totalFrames, 30).hookEnd,
    ),
  );
  const settled = settleMentions({
    segments: sh.segments,
    words: sh.words,
    plan,
    mentions: slots,
  });
  const kinds = settled.slots.map((s) => s.m.kind);
  assert.ok(
    kinds.includes("receipt") && kinds.includes("game"),
    JSON.stringify(kinds),
  );
  // "EA owes": the stat card on the debt keeps its beat; the EA logo (also said in the hook, where the headline holds) goes.
  assert.ok(!kinds.includes("logo"));
  assert.ok(settled.replaced.has(1) && settled.replaced.has(3));
  assert.ok(!settled.replaced.has(2));
  const layout = shortLayout(sh.segments, 30, sh.totalFrames, 30);
  const spans = overlaySpans({
    segments: sh.segments,
    words: sh.words,
    plan,
    layout,
    stamps: [],
    sting: false,
    mentions: slots,
  });
  assert.ok(
    !spans.some((s) => s.key === "card1") &&
      !spans.some((s) => s.key === "card3"),
  );
  assert.ok(spans.some((s) => s.key === "card2"));
  const kept = arbitrate(spans);
  for (let k = 1; k < kept.length; k++)
    assert.ok(
      kept[k]!.from >= kept[k - 1]!.to,
      `${kept[k - 1]!.key} / ${kept[k]!.key}`,
    );
  // Kept insets stay on their words (or are dropped), and none sits in the hook.
  for (const m of kept.filter((x) => x.kind === "mention")) {
    const slot = slots.find((s) => s.key === m.key)!;
    assert.ok(m.from - slot.from <= 12);
    assert.ok(m.from >= layout.hookEnd);
  }
  // The graphics audit sees the insets, reads them in time and checks no figures on them.
  const input: ShortGfxInput = {
    segments: sh.segments,
    words: sh.words,
    plan,
    stamps: [],
    clean: true,
    headline: "EA Reportedly Chose Battlefront 3",
    narration: sh.inputs.map((s) => s.text).join(" "),
    sources: "",
    mentions: slots,
  };
  const a = auditShortGraphics(input);
  const els = a.elements.filter((e) => e.kind === "mention");
  assert.ok(els.length >= 2);
  for (const e of els.filter((x) => x.shown > 0))
    assert.ok(e.shown >= e.need, `${e.key} ${e.shown} < ${e.need}`);
  assert.ok(
    !a.findings.some((f) => f.kind === "mention" && f.check === "figures"),
  );
  assert.ok(els.some((e) => /Bloomberg/.test(e.text)));
});

test("insets sit top right, inside the frame and above the captions", () => {
  const s = insetFrame("short");
  assert.ok(s.right <= 1080 - 64 && s.top >= 300 && s.top + 620 < 1180);
  const l = insetFrame("long");
  assert.ok(l.right <= 1920 - 64 && l.top >= 100);
});

// ---- Finding pictures: nothing unverified ---------------------------------------------------------------

test("findMentions keeps only verified pictures: the wrong store game and a non-free logo give nothing", async () => {
  const dir = await tmpDir();
  const jpg = Buffer.alloc(20_000, 1);
  const fetchFn = (async (url: string) => {
    const u = String(url);
    if (u.includes("steamstatic")) return new Response(jpg, { status: 200 });
    if (u.includes("en.wikipedia.org"))
      return Response.json({
        query: { pages: { 1: { pageprops: { wikibase_item: "Q1" } } } },
      });
    if (u.includes("wikidata.org"))
      return Response.json({
        entities: {
          Q1: {
            claims: {
              P154: [{ mainsnak: { datavalue: { value: "Logo.png" } } }],
            },
          },
        },
      });
    if (u.includes("commons.wikimedia.org"))
      return Response.json({
        query: {
          pages: {
            1: {
              title: "File:Logo.png",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/logo.png",
                  width: 800,
                  height: 300,
                  extmetadata: { LicenseShortName: { value: "Fair use" } },
                },
              ],
            },
          },
        },
      });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const found = await findMentions(
    {
      dir,
      kinds: ["game", "logo"],
      spoken:
        "It is bigger than Red Dead Redemption 2 and Star Wars. EA said so.",
      listed: [],
      mainGame: "Grand Theft Auto VI",
      items: [],
    },
    {
      fetchFn,
      // Steam answers every search with a near miss for one, the real game for the other.
      findSteamApp: async (term) =>
        /red dead/i.test(term)
          ? { appId: 1174180, name: "Red Dead Redemption 2", details: {} }
          : { appId: 1, name: "STAR WARS Jedi: Survivor", details: {} },
    },
  );
  assert.deepEqual(
    found.map((f) => f.key),
    ["game:1174180"],
  );
  assert.match(
    found[0]!.pictures[0]!.provenance,
    /Steam store library capsule/,
  );
  assert.ok(
    (await fs.stat(path.join(dir, found[0]!.pictures[0]!.file))).size > 0,
  );
});

test("MENTION_ settings: outlets and in-world pictures on by default, every other kind off; MENTION_MAX_PER_SHORT is 5", () => {
  const keys = [
    "MENTION_GAMES",
    "MENTION_LOGOS",
    "MENTION_CHARACTERS",
    "MENTION_REALPLACES",
    "MENTION_PLATFORMS",
    "MENTION_RECEIPTS",
    "MENTION_OUTLETS",
    "MENTION_INWORLD",
    "MENTION_MAX_PER_SHORT",
  ];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  const c = loadConfig();
  assert.deepEqual(
    [
      c.mentionGames,
      c.mentionLogos,
      c.mentionCharacters,
      c.mentionRealPlaces,
      c.mentionPlatforms,
      c.mentionReceipts,
    ],
    [false, false, false, false, false, false],
  );
  assert.equal(c.mentionMaxPerShort, 5);
  // Outlet logos and in-world pictures are on by default (owner, 20 Nov 2026).
  assert.deepEqual(mentionKinds(c), ["outlet", "inworld"]);
  process.env.MENTION_OUTLETS = "false";
  process.env.MENTION_INWORLD = "false";
  assert.deepEqual(mentionKinds(loadConfig()), []);
  process.env.MENTION_GAMES = "true";
  assert.deepEqual(mentionKinds(loadConfig()), ["game"]);
  for (const k of keys)
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
});

test("the small print: store editions trimmed, a logo never on another name, no encyclopedia receipts, no everyday first names", async () => {
  const { storeTitle, namesSomethingElse } = await import("../src/assets/mentions.ts");
  assert.equal(storeTitle("Grand Theft Auto IV: The Complete Edition"), "Grand Theft Auto IV");
  assert.equal(storeTitle("Grand Theft Auto V Enhanced"), "Grand Theft Auto V");
  assert.equal(storeTitle("Dragon Age™: The Veilguard"), "Dragon Age: The Veilguard");
  const w = wordsOf("Rockstar North built it. Then Rockstar announced it, and EA Sports FC sold.");
  assert.equal(namesSomethingElse(w, w[0]!.start, ["Rockstar Games", "Rockstar"]), true);
  assert.equal(namesSomethingElse(w, w[5]!.start, ["Rockstar Games", "Rockstar"]), false);
  assert.equal(namesSomethingElse(w, w[9]!.start, ["Electronic Arts", "EA"]), true);
  const r = receiptSources({ items: [{ source: "Wikipedia", url: "https://en.wikipedia.org/wiki/X" }, { source: "IGN", publishedAt: "2026-11-01" }], attribution: "Sources: Wikipedia, Pulse Gaming" });
  assert.deepEqual(
    r.map((x) => x.outlet),
    ["IGN"],
  );
  const still = (tag: string) => ({ kind: "still" as const, tags: [tag], url: "u", name: tag, listedAt: "l", publisher: "Rockstar Games" });
  assert.deepEqual(characterTags([still("Real Dimez")])[0]!.aliases, ["Real Dimez"]);
  assert.deepEqual(platformRuns(wordsOf("It came out on PlayStation 3 and Xbox 360 in 2013."))[0]?.platforms, ["PS3", "XBOX 360"]);
});
