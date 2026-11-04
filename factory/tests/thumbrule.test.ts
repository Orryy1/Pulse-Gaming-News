import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FFMPEG } from "../src/lib/bin.ts";
import { HAND_APPROVED } from "../src/backcatalogue.ts";
import {
  approvedGrid,
  artGameName,
  artVerdict,
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
import { THUMB_HERO_PROMPT } from "../src/qa/vision.ts";
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

test("the words: 2-4 that mean something to a stranger", () => {
  for (const ok of [
    "HALO 3 ISN'T #1",
    "BLACK OPS IS #1",
    "GTA 5 STILL #1",
    "13 YEARS OF SILENCE",
    "THE COMEBACK",
  ])
    assert.deepEqual(thumbWordProblems(ok), [], ok);
  assert.match(thumbWordProblems("RANKED")[0]!, /1 words/);
  assert.match(
    thumbWordProblems("EVERY HALO GAME RANKED AGAIN")[0]!,
    /5 words/,
  );
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
    "HALO RANKED",
  );
  assert.equal(
    heroThumbWords({ headline: "x", game_title: "Grand Theft Auto VI" }),
    "THE GRAND THEFT AUTO VI STORY".length > 26
      ? "THE REAL STORY"
      : "THE GRAND THEFT AUTO VI STORY",
  );
  assert.equal(
    heroThumbWords({ headline: "x", game_title: "Halo" }),
    "THE HALO STORY",
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

test("frames and panels are off the route; the GTA grid is the one approved exception", () => {
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
  assert.equal(layoutProblem("motif", "gta"), undefined);
  // The rejected Halo visor frame.
  assert.ok(layoutProblem("motif", "scifi"));
  assert.ok(approvedGrid("gta"));
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

test("the designs: posters on different pictures, the GTA grid first, and nothing when there is no picture", async () => {
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
    "motif",
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

test("with no usable picture the plain design carries the release, legal words, never the wrong game", () => {
  const split = {
    layout: "split",
    thumb: { headline: "HALO 2 AT 5?", imageFile: "rdr.jpg" },
  };
  const script = { headline: "x", game_title: "Halo" };
  const [wrong] = heroRuleFallback(split, script, steam("Red Dead Redemption 2"));
  assert.equal(wrong!.thumb.imageFile, null);
  assert.equal(wrong!.thumb.headline, "THE HALO STORY");
  const [right] = heroRuleFallback(split, script, igdb("Halo 3"));
  assert.equal(right!.thumb.imageFile, "rdr.jpg");
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
