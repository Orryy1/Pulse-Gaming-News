import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { buildSegments, type SegmentInput } from "../src/render/timeline.ts";
import {
  arbitrate,
  overlaySpans,
  shortLayout,
  yieldingSpans,
} from "../src/render/cleanframe.ts";
import {
  auditShortGraphics,
  fixShortGraphics,
  type ShortGfxInput,
} from "../src/qa/gfxaudit.ts";
import {
  INSET_HOLD_FRAMES,
  INSET_RIGHT,
  insetBox,
  nameSpokenAt,
  pageFrames,
  peopleGroups,
  placeTracklist,
  soundtrackStory,
  tracklistSeconds,
} from "../src/render/people.ts";
import {
  faceSquare,
  humanWithImage,
  insetCredit,
  nameCandidates,
  peopleCandidates,
  portraitAllowed,
  resolvePerson,
  tracksFromScript,
  type PortraitMeta,
} from "../src/assets/people.ts";
import { peopleOnWords, tracklistOf } from "../src/pipeline.ts";
import { loadConfig } from "../src/config.ts";
import { tmpDir } from "./helpers.ts";

// The soundtrack Short the owner asked about (ep_20261115_f877a1b9, "GTA 6's Reported 34-track Album Isn't the Full
// Soundtrack"), as its script was written.
const SOUNDTRACK = {
  headline: "GTA 6 leak isn't the full soundtrack",
  game_title: "Grand Theft Auto VI",
  attribution: "Sources: Insider Gaming / PC Gamer",
  is_rumour: true,
  person: "",
  hook: "Is Grand Theft Auto 6's leak a fair radio preview?",
  beats: [
    {
      narration:
        "Insider Gaming reports 34 tracks. That's promising, with Dua Lipa, Blackpink's Jennie and Lana Del Rey reportedly on the leaked album.",
    },
    {
      narration:
        "PC Gamer says sources for Rolling Stone and Billboard backed the leaked album's vinyl listing.",
    },
    {
      narration:
        "The reported album focuses on new songs recorded specifically for GTA 6, including two Justice collaborations.",
    },
    {
      narration:
        "The radio includes licensed songs. Justice's original score is separate from the album.",
    },
  ],
  pulse_take: {
    narration:
      "Judging the radio already is unfair. I'd stay open-minded, because this reported album isn't the full soundtrack.",
  },
  loop_line: "Give GTA 6's stations a listen first.",
  claims: [
    {
      claim:
        "Insider Gaming reports an apparent GTA 6 album leak with 34 tracks.",
    },
    {
      claim:
        "The reported album listing includes Dua Lipa, Blackpink's Jennie and Lana Del Rey.",
    },
    {
      claim:
        "PC Gamer says Rolling Stone's and Billboard's sources confirmed the leaked vinyl track listing as accurate.",
    },
    {
      claim:
        "The reported listing includes two Justice collaborations, Starting from Zero and Flower in a Hurricane.",
    },
    { claim: "GTA 6's radio stations will include licensed songs." },
  ],
};

// ---- Who is named ------------------------------------------------------------------------------------------

test("names in the narration: whole names with particles, a qualified single name, outlets and the game left out", () => {
  const found = nameCandidates(
    SOUNDTRACK.beats.map((b) => b.narration).join(" "),
    ["Grand Theft Auto VI", "Insider Gaming / PC Gamer"],
  );
  assert.deepEqual(found, [
    { name: "Dua Lipa" },
    { name: "Jennie", qualifier: "Blackpink" },
    { name: "Lana Del Rey" },
  ]);
  const more = nameCandidates(
    "PC Gamer says new songs come from Lana Del Rey, Playboi Carti and Keith Richards. Sam Houser's team agreed.",
  );
  assert.deepEqual(
    more.map((c) => c.name),
    ["Lana Del Rey", "Playboi Carti", "Keith Richards", "Sam Houser"],
  );
  // A sentence's first word, a month, a studio and a lone capitalised word are not names.
  assert.deepEqual(
    nameCandidates(
      "The trailer lands in March. Rockstar Games confirmed it. Justice scored it.",
    ),
    [],
  );
});

test("the people to check come in spoken order, the writer's list first, and only names actually said", () => {
  const c = peopleCandidates({
    ...SOUNDTRACK,
    people: ["Lana Del Rey", "Hideo Kojima"],
  });
  // Kojima is in the list but never said: no inset can land on his name.
  assert.deepEqual(
    c.map((x) => x.name),
    ["Dua Lipa", "Jennie", "Lana Del Rey"],
  );
  assert.equal(c.find((x) => x.name === "Lana Del Rey")?.listed, true);
  assert.equal(c.find((x) => x.name === "Jennie")?.qualifier, "Blackpink");
});

/** A stub of Wikipedia and Wikidata for the names the tests use. */
function wikiStub(): typeof fetch {
  const items: Record<string, { p31: string; image?: string }> = {
    Q21914464: { p31: "Q5", image: "Dua Lipa-69798 (cropped).jpg" },
    Q28128723: { p31: "Q482994" }, // her self-titled album
    Q1077: { p31: "Q41298" }, // Rolling Stone, a magazine
    Q26262599: { p31: "Q5", image: "Jennie 2026 GDA 1.jpg" },
    Q999: { p31: "Q5" }, // a person with no photo
  };
  const pages: Record<string, string> = {
    "Dua Lipa": "Q21914464",
    "Rolling Stone": "Q1077",
    "Jennie (singer)": "Q26262599",
    "No Photo Person": "Q999",
  };
  return (async (url: string | URL) => {
    const u = new URL(String(url));
    const q = u.searchParams;
    let body: unknown = {};
    if (u.host === "en.wikipedia.org" && q.get("list") === "search")
      body = {
        query: {
          search: q.get("srsearch")?.startsWith("Jennie")
            ? [{ title: "Jennie (singer)" }]
            : [],
        },
      };
    else if (u.host === "en.wikipedia.org") {
      const t = q.get("titles") ?? "";
      body = {
        query: {
          pages: {
            "1": pages[t]
              ? { title: t, pageprops: { wikibase_item: pages[t] } }
              : { title: t, missing: "" },
          },
        },
      };
    } else if (q.get("action") === "wbsearchentities") body = { search: [] };
    else if (q.get("action") === "wbgetentities") {
      const id = q.get("ids")!;
      const it = items[id]!;
      body = {
        entities: {
          [id]: {
            labels: { en: { value: id } },
            claims: {
              P31: [{ mainsnak: { datavalue: { value: { id: it.p31 } } } }],
              ...(it.image
                ? { P18: [{ mainsnak: { datavalue: { value: it.image } } }] }
                : {}),
            },
          },
        },
      };
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

test("Wikipedia's primary topic decides who a name is: the singer, not her album; a magazine is no person", async () => {
  const f = wikiStub();
  assert.deepEqual(await resolvePerson({ name: "Dua Lipa" }, f), {
    qid: "Q21914464",
    image: "Dua Lipa-69798 (cropped).jpg",
    label: "Q21914464",
  });
  assert.equal(await resolvePerson({ name: "Rolling Stone" }, f), undefined);
  // A single name needs its qualifier (or the writer's list), and then the article must be a human's.
  assert.equal(
    (await resolvePerson({ name: "Jennie", qualifier: "Blackpink" }, f))?.qid,
    "Q26262599",
  );
  assert.equal(await resolvePerson({ name: "Justice" }, f), undefined);
  assert.equal(
    (await resolvePerson({ name: "No Photo Person" }, f))?.image,
    undefined,
  );
  assert.deepEqual(
    humanWithImage({
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: "Q215380" } } } }],
      },
    }).human,
    false,
  );
});

// ---- Licences ------------------------------------------------------------------------------------------------

const META: PortraitMeta = {
  title: "File:Lana Del Rey Seattle.jpg",
  license: "CC BY 2.0",
  artist: "Mike Monaghan from Seattle, United States",
  width: 1600,
  height: 1900,
};

test("only a clearly free photo of the person: no NC or ND, no fair use, no covers, no press or agency pictures", () => {
  assert.deepEqual(portraitAllowed(META), { ok: true });
  assert.deepEqual(portraitAllowed({ ...META, license: "CC BY-SA 4.0" }), {
    ok: true,
  });
  assert.deepEqual(portraitAllowed({ ...META, license: "Public domain" }), {
    ok: true,
  });
  assert.deepEqual(portraitAllowed({ ...META, license: "CC0" }), { ok: true });
  const no = (m: Partial<PortraitMeta>) =>
    portraitAllowed({ ...META, ...m }).ok;
  assert.equal(no({ license: "" }), false);
  assert.equal(no({ license: "CC BY-NC 2.0" }), false);
  assert.equal(no({ license: "CC BY-NC-ND 4.0" }), false);
  assert.equal(no({ license: "Fair use" }), false);
  assert.equal(no({ license: "All rights reserved" }), false);
  assert.equal(no({ license: "Copyrighted free use" }), false);
  assert.equal(
    no({ title: "File:Lana Del Rey - Born to Die (album cover).jpg" }),
    false,
  );
  assert.equal(no({ title: "File:Rockstar Games logo.svg" }), false);
  assert.equal(no({ categories: "Album covers of Lana Del Rey" }), false);
  assert.equal(no({ artist: "Kevin Winter/Getty Images" }), false);
  assert.equal(no({ credit: "Press photo, courtesy of Interscope" }), false);
  assert.equal(
    no({ description: "Promotional photo for the 2012 tour" }),
    false,
  );
  assert.equal(no({ width: 200, height: 260 }), false);
});

test("the credit under an inset names the photographer and the licence, short enough for its line", () => {
  assert.equal(
    insetCredit(META.artist, META.license),
    "Photo: Mike Monaghan, CC BY 2.0",
  );
  assert.equal(insetCredit("Siebbi", "CC BY 3.0"), "Photo: Siebbi, CC BY 3.0");
  assert.equal(insetCredit("", "CC0"), "Photo: Unknown author, CC0");
  assert.ok(insetCredit("A".repeat(60), "CC BY 4.0").length < 60);
});

test("the face crop is square, inside the photo and around the face", () => {
  for (const [w, h] of [
    [900, 1259],
    [1600, 900],
    [400, 477],
  ] as const) {
    for (const face of [
      undefined,
      { x: 0.4, y: 0.15, w: 0.2, h: 0.18 },
      { x: 0.9, y: 0.9, w: 0.1, h: 0.1 },
    ]) {
      const sq = faceSquare(w, h, face);
      assert.ok(sq.size > 0 && sq.size <= Math.min(w, h), `${w}x${h}`);
      assert.ok(
        sq.x >= 0 && sq.y >= 0 && sq.x + sq.size <= w && sq.y + sq.size <= h,
        `${w}x${h} ${JSON.stringify(sq)}`,
      );
      if (face && face.x < 0.5) {
        const cx = (face.x + face.w / 2) * w;
        assert.ok(
          cx > sq.x && cx < sq.x + sq.size,
          "the face is in the square",
        );
      }
    }
  }
});

// ---- Timing and layout -------------------------------------------------------------------------------------

/** Words spoken evenly, `per` seconds each. */
function wordsOf(inputs: SegmentInput[], per = 0.36) {
  const out: Array<{ text: string; start: number; end: number }> = [];
  let t = 0;
  for (const s of inputs)
    for (const w of s.text.split(/\s+/).filter(Boolean)) {
      out.push({ text: w, start: t, end: t + per * 0.85 });
      t += per;
    }
  return out;
}

test("an inset lands on the first word of the name, possessives and aligner splits included", () => {
  const words = wordsOf([
    {
      kind: "beat",
      text: "with Dua Lipa, Blackpink's Jennie and Lana Del Rey's new song",
    },
  ]);
  assert.equal(nameSpokenAt(words, "Dua Lipa"), words[1]!.start);
  assert.equal(nameSpokenAt(words, "Jennie"), words[4]!.start);
  assert.equal(nameSpokenAt(words, "Lana Del Rey"), words[6]!.start);
  assert.equal(nameSpokenAt(words, "Keith Richards"), undefined);
  const joined = [
    { text: "Lana", start: 1 },
    { text: "Delrey", start: 1.3 },
  ];
  assert.equal(nameSpokenAt(joined, "Lana Del Rey"), 1);
  // A long surname alone, after the full name was never said; a short one never.
  assert.equal(
    nameSpokenAt([{ text: "Richards", start: 2 }], "Keith Richards"),
    2,
  );
  assert.equal(
    nameSpokenAt([{ text: "Lee", start: 2 }], "Stan Lee"),
    undefined,
  );
  const placed = peopleOnWords(
    [
      {
        name: "Dua Lipa",
        qid: "Q1",
        file: "a.jpg",
        artist: "x",
        license: "CC BY 4.0",
        pageUrl: "",
        credit: "Photo: x, CC BY 4.0",
      },
      {
        name: "Hideo Kojima",
        qid: "Q2",
        file: "b.jpg",
        artist: "x",
        license: "CC BY 4.0",
        pageUrl: "",
        credit: "Photo: x, CC BY 4.0",
      },
    ],
    words,
  );
  assert.deepEqual(
    placed.map((p) => p.name),
    ["Dua Lipa"],
  );
});

test("names said together stand side by side in one row; a fourth replaces the row; insets never overlap", () => {
  const p = (name: string, at: number) => ({
    name,
    src: `${name}.jpg`,
    credit: "Photo: x, CC BY 4.0",
    at,
  });
  const groups = peopleGroups(
    [p("A", 2), p("B", 2.6), p("C", 3.2), p("D", 3.8), p("E", 12)],
    30,
    900,
  );
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups[0]!.members.map((m) => m.name),
    ["A", "B", "C"],
  );
  assert.deepEqual(
    groups[1]!.members.map((m) => m.name),
    ["D"],
  );
  // Each pops in on its own name; the row holds 2.5 s after the last and ends where the next starts.
  assert.deepEqual(
    groups[0]!.members.map((m) => m.appear),
    [60, 78, 96],
  );
  assert.equal(groups[0]!.to, groups[1]!.from);
  assert.equal(groups[2]!.to - groups[2]!.from, INSET_HOLD_FRAMES);
  for (let k = 1; k < groups.length; k++)
    assert.ok(groups[k]!.from >= groups[k - 1]!.to);
  for (const n of [1, 2, 3]) {
    const boxes = [...Array(n).keys()].map((k) => insetBox(n, k));
    for (let k = 1; k < n; k++)
      assert.ok(
        boxes[k]!.left >= boxes[k - 1]!.left + boxes[k - 1]!.size,
        "no overlap",
      );
    assert.ok(
      boxes[0]!.left >= 64 &&
        boxes[n - 1]!.left + boxes[n - 1]!.size <= INSET_RIGHT,
    );
    // About 28% of the frame's width, in the upper third.
    assert.ok(Math.abs(boxes[0]!.size / 1080 - 0.28) < 0.01);
    assert.ok(boxes[0]!.top + boxes[0]!.size < 1920 / 3 + 60);
  }
});

/** The soundtrack Short's segments and evenly spoken words. */
function soundtrackShort() {
  const inputs: SegmentInput[] = [
    { kind: "hook", text: SOUNDTRACK.hook },
    {
      kind: "beat",
      text: SOUNDTRACK.beats[0]!.narration,
      visual: {
        kind: "stat",
        primary: "34 tracks",
        secondary: "Reported album • Insider Gaming",
      },
    },
    {
      kind: "beat",
      text: SOUNDTRACK.beats[1]!.narration,
      visual: {
        kind: "report",
        primary: "Sources back leaked album listing",
        secondary: "PC Gamer",
      },
    },
    {
      kind: "beat",
      text: SOUNDTRACK.beats[2]!.narration,
      visual: {
        kind: "list",
        primary: "New songs | Justice collaborations",
        secondary: "Reported album",
      },
    },
    {
      kind: "beat",
      text: SOUNDTRACK.beats[3]!.narration,
      visual: {
        kind: "list",
        primary: "Album | Radio | Score",
        secondary: "Three different music collections",
      },
    },
    {
      kind: "take",
      text: SOUNDTRACK.pulse_take.narration,
      visual: {
        kind: "title",
        primary: "Album isn't the full soundtrack",
        secondary: "",
      },
    },
    { kind: "loop", text: SOUNDTRACK.loop_line },
  ];
  const words = wordsOf(inputs);
  const seconds = words.at(-1)!.end + 1;
  return {
    inputs,
    words,
    seconds,
    segments: buildSegments(inputs, words, seconds),
    totalFrames: Math.round(seconds * 30),
  };
}

test("the tracklist comes from the checked claims: titled songs with their artist, then artists named on the album", () => {
  assert.deepEqual(tracksFromScript(SOUNDTRACK), [
    { artist: "Justice", title: "Starting from Zero" },
    { artist: "Justice", title: "Flower in a Hurricane" },
    { artist: "Dua Lipa" },
    { artist: "Jennie" },
    { artist: "Lana Del Rey" },
  ]);
  // The writer's own list wins, possessive qualifiers trimmed.
  assert.deepEqual(
    tracksFromScript({
      ...SOUNDTRACK,
      tracklist: [{ artist: "Blackpink's Jennie", title: "Vice" }],
    }),
    [{ artist: "Jennie", title: "Vice" }],
  );
  assert.deepEqual(
    tracksFromScript({
      hook: "",
      beats: [
        {
          narration:
            'The leak lists "Flower in a Hurricane" by Justice and Lana Del Rey\'s "Leonida Nights".',
        },
      ],
      claims: [],
    }),
    [
      { artist: "Justice", title: "Flower in a Hurricane" },
      { artist: "Lana Del Rey", title: "Leonida Nights" },
    ],
  );
  assert.equal(
    soundtrackStory(`${SOUNDTRACK.headline} ${SOUNDTRACK.hook}`),
    true,
  );
  assert.equal(soundtrackStory("Starfield expansion slips to March"), false);
});

test("the tracklist card goes on the line about the list without faces, labelled reported, held for its pages", () => {
  const sh = soundtrackShort();
  const people = ["Dua Lipa", "Jennie", "Lana Del Rey"].map(
    (n) => nameSpokenAt(sh.words, n)!,
  );
  const t = placeTracklist({
    segments: sh.segments,
    words: sh.words,
    fps: 30,
    totalFrames: sh.totalFrames,
    tracks: tracksFromScript(SOUNDTRACK),
    rumour: true,
    subtitle: "GTA VI",
    insetTimes: people,
  })!;
  assert.ok(t);
  // Beat 3 ("The reported album ... new songs ... two Justice collaborations"), not the line the faces are on.
  assert.equal(t.segment, 3);
  assert.equal(t.title, "REPORTED TRACKLIST");
  assert.ok(t.tracks.length >= 2);
  assert.equal(t.frames, Math.round(tracklistSeconds(t.tracks) * 30));
  const seg = sh.segments[3]!;
  assert.ok(
    t.from >= Math.round(seg.start * 30) && t.from < Math.round(seg.end * 30),
  );
  // The next line has a card of its own: the tracklist never runs into it.
  assert.ok(t.from + t.frames <= Math.round(seg.end * 30));
  // Pages turn on frames that add up to the card's.
  const pf = pageFrames(t.tracks, t.perPage, t.frames);
  assert.equal(
    pf.reduce((a, b) => a + b, 0),
    t.frames,
  );
  // Not a soundtrack story: no card.
  const none = tracklistOf(
    {
      ...SOUNDTRACK,
      headline: "Starfield slips",
      hook: "Starfield slips to March.",
      beats: [{ narration: "Bethesda moved it." }],
    } as never,
    sh.segments,
    sh.words,
    { fps: 30, totalFrames: sh.totalFrames },
    [],
  );
  assert.equal(none, undefined);
});

test("one overlay at a time: the insets land on the names, the tracklist replaces its line's card, nothing overlaps", () => {
  const sh = soundtrackShort();
  const people = ["Dua Lipa", "Jennie", "Lana Del Rey"].map((name) => ({
    name,
    src: "x.jpg",
    credit: "Photo: x, CC BY 4.0",
    at: nameSpokenAt(sh.words, name)!,
  }));
  const tracklist = placeTracklist({
    segments: sh.segments,
    words: sh.words,
    fps: 30,
    totalFrames: sh.totalFrames,
    tracks: tracksFromScript(SOUNDTRACK),
    rumour: true,
    subtitle: "GTA VI",
    insetTimes: people.map((p) => p.at),
  })!;
  const plan = {
    fps: 30,
    totalFrames: sh.totalFrames,
    tailFrames: 30,
    shelf: [],
    craft: undefined,
  };
  const layout = shortLayout(sh.segments, 30, sh.totalFrames, 30);
  const spans = overlaySpans({
    segments: sh.segments,
    words: sh.words,
    plan,
    layout,
    stamps: [],
    sting: false,
    people,
    tracklist,
  });
  assert.ok(
    !spans.some((s) => s.key === `card${tracklist.segment}`),
    "the tracklist's line keeps no card of its own",
  );
  const row = spans.find((s) => s.kind === "people")!;
  assert.equal(row.from, Math.round(people[0]!.at * 30));
  const kept = arbitrate(spans);
  for (let k = 1; k < kept.length; k++)
    assert.ok(
      kept[k]!.from >= kept[k - 1]!.to,
      `${kept[k - 1]!.key} and ${kept[k]!.key} overlap`,
    );
  assert.ok(
    kept.some((k) => k.kind === "people" && k.from === row.from),
    "the row shows on the first name",
  );
  assert.ok(kept.some((k) => k.kind === "tracklist"));
  // The full chrome draws the rest as planned; the insets still give way to all of it.
  const y = yieldingSpans(spans, ["people", "tracklist"]);
  for (const s of y)
    for (const o of spans.filter(
      (x) => x.kind !== "people" && x.kind !== "tracklist",
    ))
      assert.ok(s.to <= o.from || s.from >= o.to, `${s.key} covers ${o.key}`);
});

test("the graphics audit reads the insets and the tracklist in time and moves a card off the faces", () => {
  const sh = soundtrackShort();
  const people = ["Dua Lipa", "Jennie", "Lana Del Rey"].map((name) => ({
    name,
    src: "x.jpg",
    credit: "Photo: x, CC BY 4.0",
    at: nameSpokenAt(sh.words, name)!,
  }));
  const tracklist = placeTracklist({
    segments: sh.segments,
    words: sh.words,
    fps: 30,
    totalFrames: sh.totalFrames,
    tracks: tracksFromScript(SOUNDTRACK),
    rumour: true,
    subtitle: "GTA VI",
    insetTimes: people.map((p) => p.at),
  })!;
  const input: ShortGfxInput = {
    segments: sh.segments,
    words: sh.words,
    plan: {
      fps: 30,
      totalFrames: sh.totalFrames,
      tailFrames: 30,
      shelf: [],
      craft: undefined,
    },
    stamps: [],
    clean: true,
    headline: SOUNDTRACK.headline,
    narration: sh.inputs.map((s) => s.text).join(" "),
    sources: SOUNDTRACK.claims.map((c) => c.claim).join(" "),
    people,
    tracklist,
  };
  const a = auditShortGraphics(input);
  const row = a.elements.find((e) => e.kind === "people")!;
  const list = a.elements.find((e) => e.kind === "tracklist")!;
  assert.equal(row.text, "Dua Lipa Jennie Lana Del Rey");
  assert.ok(
    row.shown >= row.need,
    `the names are up ${row.shown} s, need ${row.need} s`,
  );
  assert.ok(
    list.shown >= list.need - 0.05,
    `the tracklist is up ${list.shown} s, need ${list.need} s`,
  );
  assert.ok(
    !a.findings.some(
      (f) =>
        (f.kind === "people" || f.kind === "tracklist") && f.level !== "warn",
    ),
    JSON.stringify(a.findings),
  );
  // No figure check on names and titles.
  assert.ok(
    !a.findings.some(
      (f) =>
        f.check === "figures" &&
        (f.kind === "people" || f.kind === "tracklist"),
    ),
  );
  // The fixer leaves the insets and the tracklist alone and never puts a card over them.
  const r = fixShortGraphics(input);
  const after = r.after.elements;
  const mine = after.filter(
    (e) => e.kind === "people" || e.kind === "tracklist",
  );
  for (const e of after.filter((x) => x.kind === "card" && x.shown > 0))
    for (const m of mine)
      assert.ok(e.to <= m.from || e.from >= m.to, `${e.key} over ${m.key}`);
});

test("PEOPLE_INSETS is on by default and can be switched off", async () => {
  const dir = await tmpDir();
  await fs.mkdir(path.join(dir, "x"), { recursive: true });
  const before = process.env.PEOPLE_INSETS;
  delete process.env.PEOPLE_INSETS;
  assert.equal(loadConfig().peopleInsets, true);
  process.env.PEOPLE_INSETS = "false";
  assert.equal(loadConfig().peopleInsets, false);
  if (before === undefined) delete process.env.PEOPLE_INSETS;
  else process.env.PEOPLE_INSETS = before;
});
