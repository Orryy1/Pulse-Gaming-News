import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FFMPEG } from "../src/lib/bin.ts";
import { HAND_APPROVED } from "../src/backcatalogue.ts";
import { heroLookAnswer } from "../src/assets/localvision.ts";
import {
  approvedGrid,
  artGameName,
  artVerdict,
  cutoutFaceProblems,
  cutoutProblems,
  cutOffProblems,
  designProblems,
  echoWords,
  edgeDensity,
  MAX_PANELS,
  panelCount,
  posterCapPx,
  titleEchoProblems,
  MAX_EDGE_DENSITY,
  heroRuleDesigns,
  heroRuleFallback,
  heroSizeProblems,
  heroThumbWords,
  layoutProblem,
  MIN_CAP_PX,
  namedEntry,
  posterProblems,
  rankHeroArt,
  SMALL_H,
  SMALL_W,
  smallMeasure,
  subjectOfMask,
  thumbWordProblems,
  type HeroArtImage,
} from "../src/qa/thumbrule.ts";
import { thumbOutcome } from "../src/qa/thumbrepair.ts";
import { THUMB_HERO_PROMPT, THUMB_VISION_PROMPT } from "../src/qa/vision.ts";
import {
  CAP_EM,
  POSTER_H,
  POSTER_W,
  posterCrop,
  posterWords,
} from "../src/render/thumbposter.ts";

const igdb = (game: string, kind = "screenshot") =>
  `IGDB ${kind} for "${game}" (2020), publisher material via igdb.com`;
const steam = (game: string) =>
  `Steam store asset for "${game}" (app 1), publisher-supplied marketing art`;
const shot = (
  file: string,
  beatIndex: number | undefined,
  provenance: string,
  kind = "screenshot",
  aspect = 1.78,
): HeroArtImage => ({ file, kind, aspect, beatIndex, provenance });

test("the words: 2-5 that mean something to a stranger", () => {
  for (const ok of [
    "HALO 3 ISN'T #1",
    "BLACK OPS IS #1",
    "GTA 5 STILL #1",
    "13 YEARS OF SILENCE",
    "THE COMEBACK",
    "THE CITY CAME BACK",
    "NOBODY SAW THIS ONE COMING",
  ])
    assert.deepEqual(thumbWordProblems(ok), [], ok);
  // 19 Nov 2026: 2-5 words, so one word alone no longer passes.
  assert.match(thumbWordProblems("EVERYTHING")[0]!, /1 words/);
  assert.match(thumbWordProblems("ONE TWO THREE FOUR FIVE SIX")[0]!, /6 words/);
  assert.match(thumbWordProblems("HALO 2 AT 5?")[0]!, /means nothing/);
  assert.match(thumbWordProblems("IT STARTED IN DUNDEE")[0]!, /ruled out/);
  assert.match(
    thumbWordProblems("EXTRAORDINARILY UNCOMPROMISING PERFECTIONISTS")[0]!,
    /too long/,
  );
});

test("the words a video gets: the writer's when they pass, plain ones when they do not, and always legal", () => {
  const ranking = {
    headline: "Every Halo Campaign Ranked",
    game_title: "Halo",
    entries: [{ game_title: "Halo 3" }],
  };
  assert.equal(
    heroThumbWords({ ...ranking, youtube: { thumb_text: "halo 3 isn't #1" } }),
    "HALO 3 ISN'T #1",
  );
  // The rejected "HALO 2 AT 5?" never reaches the thumbnail.
  assert.equal(
    heroThumbWords({ ...ranking, youtube: { thumb_text: "HALO 2 AT 5?" } }),
    "ONLY ONE IS #1",
  );
  // Words that repeat the title give way too.
  assert.equal(
    heroThumbWords({ ...ranking, youtube: { thumb_text: "HALO CAMPAIGNS RANKED" } }),
    "ONLY ONE IS #1",
  );
  assert.equal(
    heroThumbWords({ headline: "x", game_title: "Grand Theft Auto VI" }),
    "WHAT REALLY HAPPENED",
  );
  // A fallback that would echo the title moves to the next one.
  assert.equal(
    heroThumbWords({ headline: "What Really Happened to Halo Infinite", game_title: "Halo" }),
    "THE REAL STORY",
  );
  assert.equal(
    heroThumbWords({ headline: "x", game_title: "This week", recap: true }),
    "THIS WEEK",
  );
  for (const game_title of ["Metal Gear Solid V: The Phantom Pain", "Halo", ""])
    assert.deepEqual(
      thumbWordProblems(
        heroThumbWords({
          headline: "x",
          game_title,
          entries: [{ game_title: "a" }],
        }),
      ),
      [],
      game_title,
    );
});

test("provenance names the picture's game, trailers included", () => {
  assert.equal(artGameName(steam("Halo Infinite")), "Halo Infinite");
  assert.equal(artGameName(igdb("Halo 3: ODST", "key art")), "Halo 3: ODST");
  assert.equal(
    artGameName(
      'Official trailer thumbnail "Grand Theft Auto VI Launch Trailer" from the Rockstar Games YouTube channel',
    ),
    "Grand Theft Auto VI",
  );
  assert.equal(
    artGameName(
      'Official trailer thumbnail "Reveal Trailer | Call of Duty: Black Ops Cold War" from the Call of Duty YouTube channel',
    ),
    "Call of Duty: Black Ops Cold War",
  );
  assert.equal(
    artGameName(
      'Official trailer thumbnail "Halo: Campaign Evolved | Launch Trailer" from the XBOX YouTube channel',
    ),
    "Halo: Campaign Evolved",
  );
  assert.equal(
    artGameName("Wikimedia Commons photo by someone, CC0"),
    undefined,
  );
});

test("the art belongs to the game, its series or neither", () => {
  // Red Dead in GTA VI, which happened.
  assert.equal(
    artVerdict(steam("Red Dead Redemption 2"), "Grand Theft Auto VI"),
    "other",
  );
  assert.equal(
    artVerdict(igdb("Grand Theft Auto VI"), "Grand Theft Auto VI"),
    "game",
  );
  assert.equal(artVerdict(igdb("Grand Theft Auto VI"), "GTA 6"), "game");
  assert.equal(
    artVerdict(steam("Grand Theft Auto V Enhanced"), "Grand Theft Auto V"),
    "game",
  );
  assert.equal(
    artVerdict(steam("Grand Theft Auto V Enhanced"), "Grand Theft Auto VI"),
    "series",
  );
  // The umbrella store page is the series, not Black Ops.
  assert.equal(
    artVerdict(steam("Call of Duty®"), "Call of Duty: Black Ops"),
    "series",
  );
  assert.equal(
    artVerdict(steam("Call of Duty®: Black Ops"), "Call of Duty: Black Ops"),
    "game",
  );
  assert.equal(artVerdict(igdb("Halo 3"), "Halo 4"), "series");
  assert.equal(artVerdict("a press photo", "Halo"), "unknown");
  assert.equal(artVerdict(igdb("Doom"), ""), "unknown");
});

test("a documentary never borrows a thumbnail from a chapter about another game", () => {
  const images = [
    shot("rdr.jpg", 2, steam("Red Dead Redemption 2"), "hero"),
    shot("rdr2.jpg", 2, igdb("Red Dead Redemption 2")),
    shot("gta5.jpg", 0, steam("Grand Theft Auto V Enhanced"), "hero", 3.1),
    shot("gta6.jpg", 4, igdb("Grand Theft Auto VI")),
    shot(
      "trailer.jpg",
      undefined,
      'Official trailer thumbnail "Grand Theft Auto VI Launch Trailer" from the Rockstar Games YouTube channel',
      "hero",
    ),
    shot("photo.jpg", 3, "Wikimedia Commons photo by someone", "photo"),
    shot("cover.jpg", 4, igdb("Grand Theft Auto VI", "cover"), "capsule", 0.75),
  ];
  const script = {
    headline: "Why GTA 6 Took Thirteen Years",
    game_title: "Grand Theft Auto VI",
    evergreen_format: "documentary",
    entries: [{ game_title: "a" }],
  };
  const out = rankHeroArt(images, script, "13 YEARS OF SILENCE").map(
    (i) => i.file,
  );
  assert.deepEqual(out, ["gta6.jpg", "trailer.jpg", "gta5.jpg"]);
});

test("the same picture in two chapters' folders counts once", () => {
  const same = "https://images.igdb.com/lucia.jpg";
  const images = [
    { ...shot("e4.jpg", 4, igdb("Grand Theft Auto VI")), sourceUrl: same },
    { ...shot("e6.jpg", 6, igdb("Grand Theft Auto VI")), sourceUrl: same },
    shot("other.jpg", 6, igdb("Grand Theft Auto VI")),
  ];
  assert.deepEqual(
    rankHeroArt(
      images,
      { headline: "x", game_title: "Grand Theft Auto VI" },
      "THE REAL STORY",
    ).map((i) => i.file),
    ["e4.jpg", "other.jpg"],
  );
});

test("a ranking's words name the game on the thumbnail, or its winner is", () => {
  const entries = [
    { game_title: "Grand Theft Auto" },
    { game_title: "Grand Theft Auto: San Andreas" },
    { game_title: "Grand Theft Auto V" },
  ];
  const images = [
    shot(
      "topic.jpg",
      undefined,
      steam("Grand Theft Auto V Enhanced"),
      "hero",
      3.1,
    ),
    shot("gta1.jpg", 0, igdb("Grand Theft Auto")),
    shot("sa.jpg", 1, igdb("Grand Theft Auto: San Andreas")),
    shot("v.jpg", 2, igdb("Grand Theft Auto V")),
    // A file that landed in the wrong chapter's folder.
    shot("stray.jpg", 2, igdb("Grand Theft Auto IV")),
  ];
  const script = {
    headline: "Every GTA",
    game_title: "Grand Theft Auto",
    entries,
  };
  assert.equal(namedEntry("SAN ANDREAS ISN'T #1", entries), 1);
  assert.equal(namedEntry("GTA 5 STILL #1", entries), 2);
  assert.equal(namedEntry("ONE IS A MISTAKE", entries), undefined);
  // GTA 5's claim never sits on GTA 1 (the "STILL THE KING" thumbnail of 1 Nov).
  assert.deepEqual(
    rankHeroArt(images, script, "GTA 5 STILL #1").map((i) => i.file),
    ["v.jpg", "topic.jpg"],
  );
  assert.deepEqual(
    rankHeroArt(images, script, "SAN ANDREAS ISN'T #1").map((i) => i.file),
    ["sa.jpg", "topic.jpg"],
  );
  assert.equal(
    rankHeroArt(images, script, "ONE IS A MISTAKE")[0]!.file,
    "v.jpg",
  );
});

test("frames and panels are off the route, the GTA grid too since the 19 Nov review", () => {
  for (const l of [
    "split",
    "hero",
    "number",
    "retro",
    "mystery",
    "clash",
    "clipping",
    "full",
    "versus",
  ])
    assert.ok(layoutProblem(l), l);
  assert.equal(layoutProblem("poster"), undefined);
  // The GTA cover grid failed on GTA 6 Before You Buy (66 views) and Vice City (141).
  assert.ok(layoutProblem("motif", "gta"));
  // The rejected Halo visor frame.
  assert.ok(layoutProblem("motif", "scifi"));
  assert.ok(!approvedGrid("gta"));
  assert.ok(!approvedGrid("military"));
});

test("the poster's picture always fills the frame, with the hero on its own side", () => {
  for (const aspect of [1.33, 1.78, 3.1])
    for (const subjectX of [0.1, 0.32, 0.5, 0.68, 0.95]) {
      const c = posterCrop({ aspect, subjectX, subjectY: 0.4 });
      assert.ok(c.left <= 0 && c.top <= 0, `${aspect} ${subjectX}`);
      assert.ok(c.left + c.width >= POSTER_W - 0.01, `${aspect} ${subjectX}`);
      assert.ok(c.top + c.height >= POSTER_H - 0.01, `${aspect} ${subjectX}`);
      assert.ok(
        subjectX >= 0.5 ? c.landX >= 0.5 : c.landX < 0.5,
        `${aspect} ${subjectX} lands at ${c.landX}`,
      );
    }
  // Words on the far side from the hero.
  assert.equal(posterWords("HALO 3 ISN'T #1", 0.73).side, "left");
  assert.equal(posterWords("HALO 3 ISN'T #1", 0.27).side, "right");
});

test("the poster's words are big enough for the feed at every legal length", () => {
  const t = posterWords("HALO 3 ISN'T #1");
  assert.deepEqual(
    t.lines.map((l) => l.join(" ")),
    ["HALO 3", "ISN'T #1"],
  );
  // #1 is the lit word.
  assert.equal(t.accent, 3);
  assert.equal(posterWords("GTA 5 STILL #1").accent, 3);
  assert.equal(posterWords("13 YEARS OF SILENCE").accent, 0);
  assert.equal(posterWords("THE COMEBACK").accent, 1);
  for (const words of [
    "INFINITE WARFARE WAS GOOD",
    "SAN ANDREAS ISN'T #1",
    "13 YEARS OF SILENCE",
    "THE COMEBACK",
  ]) {
    const p = posterWords(words);
    const cap = p.fontSize * CAP_EM * (SMALL_H / POSTER_H);
    assert.ok(cap >= MIN_CAP_PX, `${words}: ${cap.toFixed(1)} px`);
    assert.ok(p.box[0] >= 0 && p.box[0] + p.box[2] <= POSTER_W, words);
    assert.ok(p.box[1] >= 0 && p.box[1] + p.box[3] <= POSTER_H, words);
  }
});

test("the hero's size comes from its cut-out", () => {
  const w = 10;
  const h = 10;
  const alpha = new Uint8Array(w * h);
  for (let y = 2; y < 9; y++)
    for (let x = 6; x < 9; x++) alpha[y * w + x] = 255;
  const s = subjectOfMask(alpha, w, h)!;
  assert.ok(Math.abs(s.x - 0.75) < 0.01);
  assert.ok(Math.abs(s.top - 0.2) < 0.01);
  assert.ok(Math.abs(s.bottom - 0.9) < 0.01);
  assert.ok(Math.abs(s.cover - 0.21) < 0.01);
  assert.deepEqual(heroSizeProblems(s, 16 / 9), []);
  assert.equal(subjectOfMask(new Uint8Array(100), 10, 10), undefined);
  assert.match(
    heroSizeProblems(
      { x: 0.5, y: 0.5, top: 0.45, bottom: 0.6, cover: 0.03 },
      16 / 9,
    )[0]!,
    /fills 2\d% of the height/,
  );
  // Nothing to measure is not a failure.
  assert.deepEqual(heroSizeProblems(undefined, 16 / 9), []);
});

test("the small-size measure tells readable words from a flat picture", () => {
  const flat = new Uint8Array(SMALL_W * SMALL_H).fill(120);
  const m = smallMeasure(flat, "HALO 3 ISN'T #1", 0.73);
  assert.equal(m.contrast, 0);
  assert.ok(m.capPx >= MIN_CAP_PX);
  const stripes = new Uint8Array(SMALL_W * SMALL_H);
  for (let i = 0; i < stripes.length; i++) stripes[i] = i % 2 ? 250 : 10;
  assert.ok(smallMeasure(stripes, "HALO 3 ISN'T #1", 0.73).contrast > 0.8);
});

test("edge density tells a simple picture from a collage", () => {
  const flat = new Uint8Array(SMALL_W * SMALL_H).fill(120);
  assert.equal(edgeDensity(flat), 0);
  const checks = new Uint8Array(SMALL_W * SMALL_H);
  for (let y = 0; y < SMALL_H; y++)
    for (let x = 0; x < SMALL_W; x++)
      checks[y * SMALL_W + x] = (x + y) % 2 ? 250 : 10;
  assert.equal(edgeDensity(checks), 1);
  assert.ok(MAX_EDGE_DENSITY > 0 && MAX_EDGE_DENSITY < 1);
});

test("the check on a real file fails a flat picture; an unreadable one is never a block", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thumbrule-"));
  const flat = path.join(dir, "flat.jpg");
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=1280x720",
    "-frames:v",
    "1",
    flat,
  ]);
  const problems = await posterProblems(flat, { headline: "HALO 3 ISN'T #1" });
  assert.match(problems[0]!, /contrast 0\.\d+ behind the words at 168x94/);
  const stub = path.join(dir, "stub.jpg");
  fs.writeFileSync(stub, "jpg");
  assert.deepEqual(
    await posterProblems(stub, { headline: "HALO 3 ISN'T #1" }),
    [],
  );
  assert.deepEqual(
    await posterProblems(path.join(dir, "gone.jpg"), {
      headline: "HALO 3 ISN'T #1",
    }),
    [],
  );
  // Words are the one thing it can still say about a file it cannot read.
  assert.match(
    (await posterProblems(stub, { headline: "HALO 2 AT 5?" }))[0]!,
    /means nothing/,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the designs: posters on different pictures, never a grid, and nothing when there is no picture", async () => {
  const images = [
    shot("a.jpg", 1, igdb("Halo 3"), "hero"),
    shot("b.jpg", 1, igdb("Halo 3")),
    shot("c.jpg", 1, igdb("Halo 3")),
    shot("d.jpg", 1, igdb("Halo 3")),
    shot("e.jpg", 1, igdb("Halo 3")),
    shot("reach.jpg", 0, igdb("Halo: Reach")),
  ];
  const script = {
    headline: "Every Halo",
    game_title: "Halo",
    entries: [{ game_title: "Halo: Reach" }, { game_title: "Halo 3" }],
    youtube: { thumb_text: "HALO 3 ISN'T #1" },
  };
  const out = await heroRuleDesigns({ images, script, dir: os.tmpdir() });
  assert.deepEqual(
    out.map((d) => [d.layout, d.thumb.imageFile, d.thumb.headline]),
    ["a.jpg", "b.jpg", "c.jpg", "d.jpg"].map((f) => [
      "poster",
      f,
      "HALO 3 ISN'T #1",
    ]),
  );
  const grid = { layout: "motif", thumb: { imageFile: "a.jpg" } };
  assert.equal(
    (
      await heroRuleDesigns({
        images,
        script,
        dir: os.tmpdir(),
        grid,
        motifId: "gta",
      })
    )[0]!.layout,
    "poster",
  );
  // Any other motif's card stays off the route.
  assert.equal(
    (
      await heroRuleDesigns({
        images,
        script,
        dir: os.tmpdir(),
        grid,
        motifId: "scifi",
      })
    )[0]!.layout,
    "poster",
  );
  assert.deepEqual(
    await heroRuleDesigns({
      images: [shot("rdr.jpg", 1, steam("Red Dead Redemption 2"))],
      script,
      dir: os.tmpdir(),
    }),
    [],
  );
});

test("a big readable face is the hero first, a body next, a logo last; a real person's photo never", async () => {
  const images = ["logo", "body", "unjudged", "face", "photo", "photoreal"].map((n) =>
    shot(
      `${n}.jpg`,
      1,
      n === "photo" ? "a press picture of a person" : igdb("Halo 3"),
    ),
  );
  const script = {
    headline: "Every Halo",
    game_title: "Halo",
    entries: [{ game_title: "Halo: Reach" }, { game_title: "Halo 3" }],
    youtube: { thumb_text: "HALO 3 ISN'T #1" },
  };
  const out = await heroRuleDesigns({
    images,
    script,
    dir: "ep",
    look: async (file) => {
      const n = path.basename(file, ".jpg");
      if (n === "face")
        return { kind: "face", box: [0.6, 0.1, 0.9, 0.5], realPerson: false };
      if (n === "body") return { kind: "body", realPerson: false };
      if (n === "photo") return { kind: "face", realPerson: true };
      // The model takes photoreal game art for a photograph; the provenance says otherwise.
      if (n === "photoreal") return { kind: "face", realPerson: true };
      if (n === "logo") return { kind: "thing", realPerson: false };
      return undefined;
    },
  });
  assert.deepEqual(
    out.map((d) => d.thumb.imageFile),
    ["face.jpg", "photoreal.jpg", "body.jpg", "unjudged.jpg"],
  );
  // The face sets where the picture sits.
  assert.ok(Math.abs((out[0]!.thumb.subjectX as number) - 0.75) < 0.001);
  assert.ok(Math.abs((out[0]!.thumb.subjectY as number) - 0.3) < 0.001);
  // A model that fails changes nothing.
  const down = await heroRuleDesigns({
    images,
    script,
    dir: "ep",
    look: async () => {
      throw new Error("ollama is off");
    },
  });
  assert.equal(down[0]!.thumb.imageFile, "logo.jpg");
});

test("the look's answer: a small face is only a body, and nonsense is no answer", () => {
  assert.deepEqual(
    heroLookAnswer({ subject: "face", box: [600, 100, 900, 500], real_photo: false }),
    { kind: "face", box: [0.6, 0.1, 0.9, 0.5], realPerson: false },
  );
  assert.equal(
    heroLookAnswer({ subject: "face", box: [600, 100, 650, 150], real_photo: false })!.kind,
    "body",
  );
  assert.equal(heroLookAnswer({ subject: "thing", box: [0, 0, 0, 0], real_photo: false })!.box, undefined);
  assert.equal(heroLookAnswer({ subject: "banana" }), undefined);
  assert.equal(heroLookAnswer({}), undefined);
});

test("no arrows or circles on the route", () => {
  assert.match(layoutProblem("mystery")!, /arrow and a circle/);
  assert.match(THUMB_HERO_PROMPT, /arrow, circle or other pointer mark/);
});

test("a cut-out that removes part of a face is caught, and a poster never draws one", async () => {
  // The Final Fantasy XIV hero design's mask, in shape: the eyes kept, the mouth and chin gone.
  const w = 100;
  const h = 100;
  const face: [number, number, number, number] = [0.5, 0.3, 0.7, 0.6];
  const hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (y < 45) hole[y * w + x] = 255;
  assert.match(cutoutFaceProblems(hole, w, h, face)[0]!, /keeps 5\d% of the face and 0% of its lower part/);
  assert.deepEqual(cutoutFaceProblems(new Uint8Array(w * h).fill(255), w, h, face), []);
  assert.deepEqual(await cutoutProblems("no-such-file.webp", face), []);
  assert.match(layoutProblem("hero")!, /part of a face/);
  assert.match(layoutProblem("depth")!, /part of a face/);
  assert.match(THUMB_VISION_PROMPT, /mouth, chin or limb/);
  const out = await heroRuleDesigns({
    images: [{ ...shot("a.jpg", undefined, igdb("Halo"), "hero"), layers: { fg: "gone.webp", fgx: 0.7 } }],
    script: { headline: "x", game_title: "Halo" },
    dir: os.tmpdir(),
  });
  assert.equal(out[0]!.layout, "poster");
  assert.ok(!("fgFile" in out[0]!.thumb), "the art is drawn whole");
});

test("with no ranked picture a poster still carries the release: legal words, no subtitle, never the wrong game", () => {
  const split = {
    layout: "split",
    thumb: {
      headline: "HALO 2 AT 5?",
      kicker: "DOCUMENTARY",
      game: "WORLD, STORY AND",
      imageFile: "rdr.jpg",
    },
  };
  const script = { headline: "x", game_title: "Halo" };
  const [wrong] = heroRuleFallback(split, script, steam("Red Dead Redemption 2"));
  assert.equal(wrong!.layout, "poster");
  assert.equal(wrong!.thumb.imageFile, null);
  assert.equal(wrong!.thumb.headline, "WHAT REALLY HAPPENED");
  const [right] = heroRuleFallback(split, script, igdb("Halo 3"));
  assert.equal(right!.thumb.imageFile, "rdr.jpg");
  assert.equal(right!.thumb.kicker, "");
  assert.equal(right!.thumb.game, "");
  assert.deepEqual(designProblems(right!.thumb, script), []);
});

// ------------------------------------------------------------------------------------------------ 19 Nov review

test("words that repeat the title are caught; words that open a question pass", () => {
  // The failing thumbnails' words.
  assert.equal(
    titleEchoProblems("WHY GTA 6 TOOK THIRTEEN YEARS", "Why GTA 6 Took Thirteen Years | Documentary").length,
    1,
  );
  assert.equal(titleEchoProblems("VICE CITY", "Why GTA 6 Had to Go Back to Vice City").length, 1);
  assert.equal(
    titleEchoProblems("EVERY MAINLINE GTA GAME RANKED", "Every Mainline GTA Game, Ranked Worst to Best").length,
    1,
  );
  assert.equal(titleEchoProblems("HALO RANKED", "Every Halo Campaign Ranked Worst to Best").length, 1);
  // Grand Theft Auto, roman numerals and number words count as the same words.
  assert.equal(
    titleEchoProblems("GRAND THEFT AUTO VI 13 YEARS", "Why GTA 6 Took Thirteen Years").length,
    1,
  );
  assert.deepEqual(echoWords("Why GTA VI Took Thirteen Years"), ["gta", "6", "took", "13", "years"]);
  // The passing ones.
  assert.deepEqual(titleEchoProblems("THE CITY CAME BACK", "Why San Andreas Never Got a Sequel"), []);
  assert.deepEqual(titleEchoProblems("HALO 3 ISN'T #1", "Every Halo Campaign Ranked Worst to Best"), []);
  assert.deepEqual(titleEchoProblems("13 YEARS OF SILENCE", "Why GTA 6 Took Thirteen Years"), []);
  // One shared word is never an echo, and no title means nothing to compare.
  assert.deepEqual(titleEchoProblems("HALO", "Every Halo Campaign Ranked"), []);
  assert.deepEqual(titleEchoProblems("VICE CITY", undefined, ""), []);
});

test("cut-off text is caught", () => {
  assert.equal(cutOffProblems("WORLD, STORY AND").length, 1);
  assert.equal(cutOffProblems("THE STORY OF THE").length, 1);
  assert.equal(cutOffProblems("EVERYTHING WE KNOW...").length, 1);
  assert.equal(cutOffProblems("EVERYTHING WE KNOW…").length, 1);
  assert.equal(cutOffProblems("WORLD, STORY,").length, 1);
  assert.deepEqual(cutOffProblems("THE CITY CAME BACK"), []);
  assert.deepEqual(cutOffProblems("HALO 3 ISN'T #1"), []);
  assert.deepEqual(cutOffProblems(""), []);
});

test("more than three pictures is a collage", () => {
  assert.equal(MAX_PANELS, 3);
  assert.equal(panelCount({ imageFile: "a.jpg", fgFile: "a_fg.png" }), 1);
  assert.equal(panelCount({ imageFile: "a.jpg", image2File: "b.jpg" }), 2);
  const grid = {
    layout: "motif",
    headline: "THE CITY CAME BACK",
    imageFile: "a.jpg",
    pictureFiles: ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg", "f.jpg", "g.jpg", "h.jpg"],
  };
  assert.equal(panelCount(grid), 8);
  assert.ok(
    designProblems(grid, { headline: "GTA 6 Before You Buy" }).some((p) => /8 pictures/.test(p)),
  );
  assert.ok(
    !designProblems(
      { ...grid, layout: "poster", pictureFiles: ["a.jpg", "b.jpg", "c.jpg"] },
      { headline: "x" },
    ).some((p) => /pictures/.test(p)),
  );
});

test("secondary lines too small for 168 px are caught, and a poster's words are always big enough", () => {
  // The old split template: label pill, the whole title as the headline and a cut subtitle.
  const split = {
    layout: "split",
    headline: "WHY GTA 6 TOOK THIRTEEN YEARS",
    kicker: "DOCUMENTARY",
    game: "WORLD, STORY AND",
    imageFile: "a.jpg",
  };
  const problems = designProblems(split, {
    headline: "Why GTA 6 Took Thirteen Years",
    youtube: { title: "Why GTA 6 Took Thirteen Years | Documentary" },
  });
  assert.ok(problems.some((p) => /split design/.test(p)), "layout");
  assert.ok(problems.some((p) => /repeats the title/.test(p)), "echo");
  assert.ok(problems.some((p) => /"DOCUMENTARY" is .* too small/.test(p)), "kicker");
  assert.ok(problems.some((p) => /"WORLD, STORY AND" is cut off/.test(p)), "cut");
  assert.ok(problems.some((p) => /words, the rule|too long/.test(p)), "length");
  // Every legal poster headline stays readable in the feed.
  for (const h of ["GO", "THE CITY CAME BACK", "ABCDEFGHIJKLM NOPQRSTUVWXY"])
    assert.ok(posterCapPx(h) >= MIN_CAP_PX, h);
  // The two passing thumbnails, as posters, have nothing wrong.
  assert.deepEqual(
    designProblems(
      { layout: "poster", headline: "THE CITY CAME BACK", kicker: "", game: "", imageFile: "cj.jpg" },
      { headline: "Why San Andreas Never Got a Sequel" },
    ),
    [],
  );
  assert.deepEqual(
    designProblems(
      { layout: "poster", headline: "HALO 3 ISN'T #1", kicker: "", game: "", imageFile: "chief.jpg" },
      { headline: "Every Halo Campaign Ranked Worst to Best" },
    ),
    [],
  );
});

test("a failed poster gives way to the reserve, then a variant, and with none left stays as rendered", () => {
  const variants = ["thumb_b.jpg", "thumb_c.jpg"];
  const repair = "thumb_hero_b.jpg";
  assert.deepEqual(
    thumbOutcome({
      main: "thumb.jpg",
      variants,
      repair,
      bad: new Set(["thumb.jpg"]),
    }),
    { mainFrom: repair, variants, repaired: true },
  );
  assert.deepEqual(
    thumbOutcome({
      main: "thumb.jpg",
      variants,
      repair,
      bad: new Set(["thumb.jpg", repair]),
    }),
    { mainFrom: "thumb_b.jpg", variants: ["thumb_c.jpg"], repaired: false },
  );
  assert.deepEqual(
    thumbOutcome({
      main: "thumb.jpg",
      variants,
      repair,
      bad: new Set(["thumb.jpg", repair, ...variants]),
    }),
    { variants: [], repaired: false },
  );
});

test("the check asks the model about the wrong game, a missing hero and cryptic words", () => {
  assert.match(THUMB_HERO_PROMPT, /different game/);
  assert.match(THUMB_HERO_PROMPT, /main subject/);
  assert.match(THUMB_HERO_PROMPT, /bare rank/);
});

test("the owner's hand-approved videos stay out of any repackaging", () => {
  assert.ok(HAND_APPROVED.has("BemcTLS8mVI"));
  assert.ok(HAND_APPROVED.has("7CelsHTQU3s"));
});
