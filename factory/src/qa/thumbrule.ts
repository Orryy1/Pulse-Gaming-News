// The thumbnail rule for long videos (THUMB_HERO_RULE, owner, 3-4 Nov 2026): one recognisable hero, 2-5 big words,
// no decorative frames, visors or small panels. He rejected the Halo motif thumbnail (Halloween skins inside a visor
// frame) and replaced it with Master Chief on the right and HALO 3 ISN'T #1 huge on the left; that is the model
// (src/render/ThumbStudio.tsx PosterThumb).
//
// The 19 Nov 2026 review of the seven public long videos settled it. The two that passed (San Andreas, 1,847 views,
// our best by far: THE CITY CAME BACK; Halo: HALO 3 ISN'T #1) are one big character and a few words that open a
// question the title answers. The five that failed were the GTA cover grid (8-9 small tiles and a card that repeated
// the title: GTA 6 Before You Buy, Vice City) and the older split template (logo, label pill, the whole title as the
// headline, a subtitle cut off mid-sentence). So the grid is off the route too (approvedGrid), and designProblems
// rejects what those had: words that repeat the title, more than three pictures, secondary lines too small to read
// at 168x94, and words cut off.
//
// At generation time this picks words that pass and art that belongs to the game, from the provenance line every
// picture carries: on the GTA 6 documentary the media step holds Red Dead Redemption 2 art (its chapter) beside GTA
// art, and a ranking's "still the king" thumbnail once showed the wrong entry. As a check it measures the rendered
// thumbnail at 168x94, the size it is seen at in a feed. A failing thumbnail gives way to the next design
// (src/qa/thumbrepair.ts); this file never stops a release, and anything it cannot read counts as passing.
//
// The hero is a big character with a readable face where the game has one (all four Inspiration thumbnails use one
// large character); a body comes next, a logo or an object last. No arrows, circles or pointer marks: the mystery
// design is off the route and no test variant uses one. Faces are the game's own art: nothing here draws one, and
// photographs (of real people) are never in the running, even the press kinds a chapter may hold.
//
// The poster draws its art whole and never uses the depth layers as a cut-out. The fg layer (src/render/parallax.py)
// is not a person: it is the nearest fifth of the picture by depth, whatever that holds. On Final Fantasy XIV
// (4 Nov 2026) the shield and shoulder were nearest, so the hero design's "cut-out" kept 12% of the character's mouth
// and chin and showed its orange glow through the hole. cutoutProblems catches that on any design that still draws one.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { HeroLook } from "../assets/localvision.ts";
import { nameWords, sameGame } from "../assets/steam.ts";
import { FFMPEG } from "../lib/bin.ts";
import {
  CAP_EM,
  POSTER_H,
  POSTER_W,
  posterCrop,
  posterWords,
} from "../render/thumbposter.ts";

const run = promisify(execFile);

export const THUMB_MIN_WORDS = 2;
export const THUMB_MAX_WORDS = 5;
/** Longer than this cannot be big, whatever the word count. */
const THUMB_MAX_CHARS = 26;
/** The feed's small thumbnail. */
export const SMALL_W = 168;
export const SMALL_H = 94;
/** Capital letters shorter than this at 168x94 cannot be read. */
export const MIN_CAP_PX = 8;
/** Brightest letters against the darkest edges in the words' box at 168x94, 0-1. */
export const MIN_SMALL_CONTRAST = 0.4;
/** Share of pixels on a hard edge at 168x94 above which a thumbnail is a collage, not a picture (edgeDensity). */
export const MAX_EDGE_DENSITY = 0.3;
/** How hard an edge is: the brightness step to the next pixel across and down, added, out of 255. */
const EDGE_STEP = 50;

/** Words the owner has ruled out for good. */
const BANNED_WORDS = [/\bIT STARTED IN DUNDEE\b/];
/** Words that only make sense after watching: a bare rank ("HALO 2 AT 5?") says nothing to a stranger. */
const CRYPTIC = [/\bAT #?\d+\s*\??$/, /^#?\d+\s*\??$/];

/** The words as the thumbnail shows them. */
export function thumbWordList(text: string): string[] {
  return text.trim().toUpperCase().split(/\s+/).filter(Boolean);
}

/** What is wrong with a thumbnail's words, empty when they pass. */
export function thumbWordProblems(text: string): string[] {
  const words = thumbWordList(text);
  const joined = words.join(" ");
  const out: string[] = [];
  if (words.length < THUMB_MIN_WORDS || words.length > THUMB_MAX_WORDS)
    out.push(
      `${words.length} words, the rule is ${THUMB_MIN_WORDS}-${THUMB_MAX_WORDS}`,
    );
  if (joined.length > THUMB_MAX_CHARS)
    out.push(`${joined.length} characters, too long to be big`);
  if (BANNED_WORDS.some((r) => r.test(joined)))
    out.push(`"${joined}" is ruled out`);
  if (CRYPTIC.some((r) => r.test(joined)))
    out.push(`"${joined}" means nothing before watching`);
  return out;
}

// ------------------------------------------------------------------------------------------------ title echo

/** Words that carry no meaning of their own when a headline is compared with its title. */
const ECHO_STOP = new Set(
  "a an the of to in on at by for from with and or but is are was were be it its this that these those why how what who when where every all ever before after you your we our i my has had have do does did go got get".split(
    " ",
  ),
);
const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
};

/** A text's meaning words, normalised so GTA VI, Grand Theft Auto 6 and thirteen/13 compare equal (pure). */
export function echoWords(text: string): string[] {
  const words = nameWords(
    text
      .replace(/\bgrand theft auto\b/gi, "gta")
      .replace(/\bcall of duty\b/gi, "cod"),
  )
    .map((w) => NUMBER_WORDS[w] ?? w)
    .filter((w) => !ECHO_STOP.has(w) && w !== "s" && w !== "t");
  return [...new Set(words)];
}

/**
 * Whether thumbnail words repeat the title instead of adding to it (pure). Two shared meaning words at least, and
 * either three quarters of the words are the title's or they cover most of the title: VICE CITY on "Why GTA 6 Had to
 * Go Back to Vice City", WHY GTA 6 TOOK THIRTEEN YEARS on its own title, HALO RANKED on "Every Halo Campaign Ranked".
 * HALO 3 ISN'T #1 and 13 YEARS OF SILENCE add something, so they pass; one word alone is never an echo.
 */
export function titleEchoProblems(
  words: string,
  ...titles: Array<string | undefined>
): string[] {
  const h = echoWords(words);
  for (const title of titles) {
    if (!title?.trim()) continue;
    const t = new Set(echoWords(title));
    if (!t.size) continue;
    const shared = h.filter((w) => t.has(w)).length;
    if (shared >= 2 && (shared / h.length >= 0.75 || shared / t.size >= 0.6))
      return [
        `"${words.toUpperCase()}" repeats the title "${title}" (${shared} of its ${h.length} words); it should open a question the title answers`,
      ];
  }
  return [];
}

/** Words a line cannot end on unless it was cut short ("WORLD, STORY AND"). */
const DANGLING = new Set(
  "a an the of to in on at by for from with and or but nor as than into onto over under about versus vs".split(
    " ",
  ),
);

/** Whether a line of thumbnail text was cut off mid-sentence (pure). */
export function cutOffProblems(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const last = t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).pop() ?? "";
  if (/(\.\.\.|\u2026|[-,;:&/])$/.test(t) || DANGLING.has(last))
    return [`"${t}" is cut off`];
  return [];
}

/** The fields of a script the words are chosen from. */
export interface ThumbScript {
  headline: string;
  game_title: string;
  recap?: unknown;
  evergreen_format?: string;
  entries?: Array<{ game_title?: string }>;
  youtube?: { thumb_text?: string; title?: string };
}

/** Everything wrong with a video's thumbnail words: the rule, a title echo and a cut. */
export function thumbWordsForTitleProblems(
  words: string,
  script: Pick<ThumbScript, "headline" | "youtube">,
): string[] {
  return [
    ...thumbWordProblems(words),
    ...titleEchoProblems(words, script.youtube?.title, script.headline),
    ...cutOffProblems(words),
  ];
}

/**
 * The words for a thumbnail: the writer's own if they pass (the title echo included), else short plain ones that
 * open a question and do not repeat the title.
 */
export function heroThumbWords(script: ThumbScript): string {
  const own = script.youtube?.thumb_text?.trim().replace(/\s+/g, " ");
  if (own && !thumbWordsForTitleProblems(own, script).length)
    return own.toUpperCase();
  const pick = (...options: string[]) =>
    options.find((t) => !thumbWordsForTitleProblems(t, script).length) ??
    options[options.length - 1]!;
  if (script.recap) return pick("THIS WEEK", "THE BIG WEEK");
  if (script.entries?.length && script.evergreen_format !== "documentary")
    return pick("ONLY ONE IS #1", "THE TOP SPOT", "#1 IS CLEAR");
  return pick("WHAT REALLY HAPPENED", "THE REAL STORY", "THE HIDDEN SIDE");
}

// ------------------------------------------------------------------------------------------------ the art

/** The game a picture's provenance line names, or undefined (a press photo, a stock picture). */
export function artGameName(provenance?: string): string | undefined {
  const m =
    /\bfor "([^"]+)"/.exec(provenance ?? "") ??
    /\bthumbnail "([^"]+)"/.exec(provenance ?? "");
  if (!m) return undefined;
  // "Reveal Trailer | Call of Duty: Black Ops Cold War", "Grand Theft Auto VI Launch Trailer".
  const parts = m[1]!.split("|").map((p) => p.trim());
  const part = parts.find((p) => !/\btrailer\b/i.test(p)) ?? parts[0]!;
  return part
    .replace(
      /\s*[-:]?\s*\b(official|launch|reveal|announcement|gameplay|story|cinematic|teaser)?\s*trailer\b.*$/i,
      "",
    )
    .trim();
}

const withAliases = (name: string) =>
  name
    .replace(/\bgta\b/gi, "Grand Theft Auto")
    .replace(/\bcod\b/gi, "Call of Duty");

/** A name's series: before any colon, without its sequel number ("Halo 3: ODST" is Halo). */
function seriesWords(name: string): string[] {
  const words = nameWords(withAliases(name).split(":")[0]!);
  while (words.length > 1 && /^\d+$/.test(words[words.length - 1]!))
    words.pop();
  return words;
}

export type ArtVerdict = "game" | "series" | "other" | "unknown";

/** Whether a picture belongs to a game: that very game, its series, another game, or no way to tell. */
export function artVerdict(
  provenance: string | undefined,
  game: string,
): ArtVerdict {
  const name = artGameName(provenance);
  if (!name || !game.trim()) return "unknown";
  if (sameGame(withAliases(game), withAliases(name))) return "game";
  const a = seriesWords(game);
  const b = seriesWords(name);
  const n = Math.min(a.length, b.length);
  return n > 0 && a.slice(0, n).every((w, i) => w === b[i])
    ? "series"
    : "other";
}

/** A picture the rule can choose from (src/episodes.ts images). */
export interface HeroArtImage {
  file: string;
  kind: string;
  aspect: number;
  beatIndex?: number;
  provenance?: string;
  /** Where it came from: the same picture often sits in several chapters' folders. */
  sourceUrl?: string;
  layers?: { fg?: string; fgx?: number };
}

/** Key art first, gameplay next; a trailer thumbnail last, since it carries the logo and date in the picture. */
function artRank(i: HeroArtImage): number {
  if (/official trailer/i.test(i.provenance ?? "")) return 4;
  if (i.kind === "hero") return i.aspect <= 2.4 ? 0 : 1;
  if (i.kind === "screenshot") return 2;
  return 3;
}

/** The entry the words name, if they name one: the longest match, its full name or the part after its colon. */
export function namedEntry(
  words: string,
  entries: Array<{ game_title?: string }> = [],
): number | undefined {
  const said = ` ${nameWords(withAliases(words)).join(" ")} `;
  let best: { i: number; len: number } | undefined;
  entries.forEach((e, i) => {
    const full = withAliases(e.game_title ?? "");
    for (const form of [full, full.split(":")[1] ?? ""]) {
      const w = nameWords(form);
      if (!w.length) continue;
      const hit = said.includes(` ${w.join(" ")} `);
      if (hit && (!best || w.length > best.len)) best = { i, len: w.length };
    }
  });
  return best?.i;
}

/**
 * The pictures a hero thumbnail may use, best first, each from a different chapter where it can be. Never one that
 * belongs to another game. A ranking uses the entry its words name, else its winner, then the topic's own art; words
 * naming a game take only that game's art and the series' own, so GTA 5's claim never sits on GTA 1. A documentary
 * or a recap uses art of its own game first, then its series, whichever chapter holds it, so Red Dead Redemption 2's
 * chapter cannot lend the GTA 6 documentary its thumbnail.
 */
export function rankHeroArt<T extends HeroArtImage>(
  images: T[],
  script: ThumbScript,
  words: string,
): T[] {
  const entries = script.entries ?? [];
  const doc = !entries.length || script.evergreen_format === "documentary";
  const named = doc ? undefined : namedEntry(words, entries);
  const winner = entries.length - 1;
  const scored: Array<{ i: T; key: number[] }> = [];
  images.forEach((i, at) => {
    if (
      !Number.isFinite(i.aspect) ||
      i.aspect < 1.3 ||
      !["hero", "screenshot", "header"].includes(i.kind)
    )
      return;
    const beat = i.beatIndex;
    let target: number;
    let verdict: ArtVerdict;
    if (doc) {
      verdict = artVerdict(i.provenance, script.game_title);
      target = 0;
    } else if (beat === undefined) {
      verdict = artVerdict(i.provenance, script.game_title);
      target = named !== undefined ? 1 : 2;
    } else {
      verdict = artVerdict(i.provenance, entries[beat]?.game_title ?? "");
      // A chapter's picture of some other game of the series is not that chapter's art.
      if (verdict === "series") verdict = "other";
      target = beat === named ? 0 : beat === winner ? 1 : 3;
      if (named !== undefined && beat !== named) return;
    }
    if (verdict === "other") return;
    scored.push({
      i,
      key: [
        target,
        { game: 0, series: 1, unknown: 2, other: 3 }[verdict],
        artRank(i),
        i.layers?.fg ? 0 : 1,
        at,
      ],
    });
  });
  scored.sort((a, b) => {
    for (let k = 0; k < a.key.length; k++)
      if (a.key[k] !== b.key[k]) return a.key[k]! - b.key[k]!;
    return 0;
  });
  // One picture from each chapter first, so the designs differ in more than the crop.
  const first: T[] = [];
  const later: T[] = [];
  const seen = new Set<number | undefined>();
  const pictures = new Set<string>();
  for (const { i } of scored) {
    const picture = i.sourceUrl ?? i.file;
    if (pictures.has(picture)) continue;
    pictures.add(picture);
    (seen.has(i.beatIndex) ? later : first).push(i);
    seen.add(i.beatIndex);
  }
  return [...first, ...later];
}

/**
 * The series-grid special case. The GTA cover grid was approved on Vice City (31 Oct 2026); the 19 Nov review found
 * it on the two GTA videos that did worst (66 and 141 views: 8-9 small tiles, no subject, unreadable small), so no
 * grid is on the route now. Kept as a function so a future approved grid has one place to go.
 */
export function approvedGrid(_motifId?: string): boolean {
  return false;
}

/** The designs the rule allows. Everything else (frames, screens, panels, circles, cuttings) is off the default route. */
export function layoutProblem(
  layout: string | undefined,
  motifId?: string,
): string | undefined {
  if (layout === "poster") return undefined;
  if (layout === "motif" && approvedGrid(motifId)) return undefined;
  if (layout === "mystery") return "the mystery design has an arrow and a circle";
  if (layout === "hero" || layout === "depth")
    return `the ${layout} design cuts its subject out by depth, which can remove part of a face`;
  return `the ${layout ?? "split"} design has frames or panels`;
}

// ------------------------------------------------------------------------------------------------ the design

/** At most this many pictures in one thumbnail: one hero, or a versus at most. */
export const MAX_PANELS = 3;
/** Secondary lines the older designs draw (kicker pill, subtitle, year, labels): font sizes at 1280x720. */
const SECONDARY_FONT: Record<string, number> = {
  kicker: 28,
  game: 30,
  year: 34,
  labels: 36,
};

/** How many separate pictures a design shows (a cut-out of the same picture is not another one). */
export function panelCount(thumb: Record<string, unknown>): number {
  const files = new Set<string>();
  for (const k of ["imageFile", "image2File"])
    if (typeof thumb[k] === "string" && thumb[k]) files.add(thumb[k] as string);
  if (Array.isArray(thumb.pictureFiles))
    for (const f of thumb.pictureFiles)
      if (typeof f === "string" && f) files.add(f);
  return files.size;
}

/** The capital height of a poster's words at 168x94 (pure). */
export function posterCapPx(headline: string): number {
  return posterWords(headline).fontSize * CAP_EM * (SMALL_H / POSTER_H);
}

/**
 * What is wrong with a long video's thumbnail design, before or after it is drawn (pure): the layout, the words (the
 * rule, a title echo, a cut), more than MAX_PANELS pictures, and any line too small to read at 168x94.
 */
export function designProblems(
  thumb: Record<string, unknown>,
  script: Pick<ThumbScript, "headline" | "youtube">,
  motifId?: string,
): string[] {
  const layout = typeof thumb.layout === "string" ? thumb.layout : undefined;
  const headline = typeof thumb.headline === "string" ? thumb.headline : "";
  const out: string[] = [];
  const lp = layoutProblem(layout, motifId);
  if (lp) out.push(lp);
  out.push(...thumbWordsForTitleProblems(headline, script));
  const panels = panelCount(thumb);
  if (panels > MAX_PANELS)
    out.push(`${panels} pictures; the rule is at most ${MAX_PANELS}`);
  const scale = SMALL_W / POSTER_W;
  for (const [k, size] of Object.entries(SECONDARY_FONT)) {
    const v = thumb[k];
    const text = Array.isArray(v)
      ? v.filter(Boolean).join(" ")
      : typeof v === "string"
        ? v.trim()
        : "";
    if (!text) continue;
    const cap = size * CAP_EM * scale;
    if (cap < MIN_CAP_PX)
      out.push(
        `"${text}" is ${cap.toFixed(1)} px tall at ${SMALL_W}x${SMALL_H}, too small to read`,
      );
    out.push(...cutOffProblems(text));
  }
  if (layout === "poster" && headline) {
    const cap = posterCapPx(headline);
    if (cap < MIN_CAP_PX)
      out.push(`letters ${cap.toFixed(1)} px tall at ${SMALL_W}x${SMALL_H}`);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the check

/** Where the depth model's cut-out puts the subject, as fractions of the picture. */
export interface HeroSubject {
  x: number;
  y: number;
  /** Top and bottom of the subject. */
  top: number;
  bottom: number;
  /** How much of the picture it covers. */
  cover: number;
}

/** The subject in a cut-out's alpha channel (pure): the middle of the solid pixels, ignoring specks. */
export function subjectOfMask(
  alpha: Uint8Array,
  w: number,
  h: number,
): HeroSubject | undefined {
  let sum = 0;
  let sx = 0;
  let sy = 0;
  const rows = new Array<number>(h).fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x]! < 128) continue;
      sum += 1;
      sx += x;
      sy += y;
      rows[y]! += 1;
    }
  if (!sum) return undefined;
  const solid = (r: number) => r >= Math.max(1, w * 0.02);
  const top = rows.findIndex(solid);
  const bottom = h - 1 - [...rows].reverse().findIndex(solid);
  return {
    x: (sx / sum + 0.5) / w,
    y: (sy / sum + 0.5) / h,
    top: Math.max(0, top) / h,
    bottom: (Math.max(top, bottom) + 1) / h,
    cover: sum / (w * h),
  };
}

/** The share of a box a cut-out keeps, solid pixels of the alpha channel (pure). */
function keptIn(
  alpha: Uint8Array,
  w: number,
  h: number,
  box: [number, number, number, number],
): number {
  const x0 = Math.floor(box[0] * w);
  const x1 = Math.max(x0 + 1, Math.ceil(box[2] * w));
  const y0 = Math.floor(box[1] * h);
  const y1 = Math.max(y0 + 1, Math.ceil(box[3] * h));
  let kept = 0;
  let all = 0;
  for (let y = y0; y < Math.min(h, y1); y++)
    for (let x = x0; x < Math.min(w, x1); x++) {
      all += 1;
      if (alpha[y * w + x]! >= 128) kept += 1;
    }
  return all ? kept / all : 1;
}

/**
 * What a cut-out does to the face inside it (pure): any face must be kept whole. The lower third is measured on its
 * own because depth slices cut there first: Final Fantasy XIV kept 58% of the face overall, but 12% of its lower part.
 */
export function cutoutFaceProblems(
  alpha: Uint8Array,
  w: number,
  h: number,
  face: [number, number, number, number],
): string[] {
  const whole = keptIn(alpha, w, h, face);
  const lower = keptIn(alpha, w, h, [
    face[0],
    face[3] - (face[3] - face[1]) / 3,
    face[2],
    face[3],
  ]);
  if (whole >= 0.9 && lower >= 0.8) return [];
  return [
    `the cut-out keeps ${Math.round(whole * 100)}% of the face and ${Math.round(lower * 100)}% of its lower part`,
  ];
}

/** The same on a cut-out file; empty when it cannot be read. */
export async function cutoutProblems(
  fgFile: string,
  face: [number, number, number, number],
): Promise<string[]> {
  const w = 192;
  const h = 108;
  try {
    const { stdout } = await run(
      FFMPEG,
      [
        "-v",
        "error",
        "-i",
        fgFile,
        "-vf",
        `alphaextract,scale=${w}:${h},format=gray`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 1 << 20, timeout: 30_000 },
    );
    return stdout.length === w * h
      ? cutoutFaceProblems(stdout, w, h, face)
      : [];
  } catch {
    return [];
  }
}

/** The subject of a cut-out file; undefined when it cannot be read. */
export async function heroSubject(
  fgFile: string,
): Promise<HeroSubject | undefined> {
  const w = 64;
  const h = 36;
  try {
    const { stdout } = await run(
      FFMPEG,
      [
        "-v",
        "error",
        "-i",
        fgFile,
        "-vf",
        `alphaextract,scale=${w}:${h},format=gray`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 1 << 20, timeout: 30_000 },
    );
    return stdout.length === w * h ? subjectOfMask(stdout, w, h) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the subject ends up large in the poster's crop (pure). */
export function heroSizeProblems(
  subject: HeroSubject | undefined,
  aspect: number,
): string[] {
  if (!subject) return [];
  const crop = posterCrop({
    aspect,
    subjectX: subject.x,
    subjectY: subject.y,
  });
  const tall = ((subject.bottom - subject.top) * crop.height) / POSTER_H;
  const out: string[] = [];
  if (tall < 0.45)
    out.push(`the hero fills ${Math.round(tall * 100)}% of the height`);
  if (subject.cover < 0.04)
    out.push(
      `the hero covers ${Math.round(subject.cover * 100)}% of the picture`,
    );
  return out;
}

/** How busy a 168x94 greyscale thumbnail is: the share of its pixels on a hard edge (pure). */
export function edgeDensity(grey: Uint8Array): number {
  let hard = 0;
  for (let y = 0; y < SMALL_H - 1; y++)
    for (let x = 0; x < SMALL_W - 1; x++) {
      const i = y * SMALL_W + x;
      const step =
        Math.abs(grey[i]! - grey[i + 1]!) +
        Math.abs(grey[i]! - grey[i + SMALL_W]!);
      if (step > EDGE_STEP) hard += 1;
    }
  return hard / ((SMALL_W - 1) * (SMALL_H - 1));
}

/** A poster's measurements at 168x94 (pure): the letters' height and the contrast in the words' box. */
export function smallMeasure(
  grey: Uint8Array,
  headline: string,
  landX: number,
): { capPx: number; contrast: number } {
  const t = posterWords(headline, landX);
  const sx = SMALL_W / POSTER_W;
  const sy = SMALL_H / POSTER_H;
  const x0 = Math.max(0, Math.floor(t.box[0] * sx));
  const x1 = Math.min(SMALL_W, Math.ceil((t.box[0] + t.box[2]) * sx));
  const y0 = Math.max(0, Math.floor(t.box[1] * sy));
  const y1 = Math.min(SMALL_H, Math.ceil((t.box[1] + t.box[3]) * sy));
  const values: number[] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) values.push(grey[y * SMALL_W + x]!);
  values.sort((a, b) => a - b);
  const at = (p: number) => values[Math.floor(p * (values.length - 1))] ?? 0;
  return {
    capPx: t.fontSize * CAP_EM * sy,
    contrast: values.length ? (at(0.9) - at(0.1)) / 255 : 0,
  };
}

/** What the check says about a rendered poster; empty when it passes or the file cannot be read. */
export async function posterProblems(
  file: string,
  thumb: {
    headline: string;
    imageAspect?: number;
    subjectX?: number;
    subjectY?: number;
    zoom?: number;
  },
): Promise<string[]> {
  const out = thumbWordProblems(thumb.headline);
  const crop = posterCrop({
    aspect: thumb.imageAspect ?? POSTER_W / POSTER_H,
    subjectX: thumb.subjectX,
    subjectY: thumb.subjectY,
    zoom: thumb.zoom,
  });
  try {
    const { stdout } = await run(
      FFMPEG,
      [
        "-v",
        "error",
        "-i",
        file,
        "-vf",
        `scale=${SMALL_W}:${SMALL_H}:flags=area,format=gray`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 1 << 20, timeout: 30_000 },
    );
    if (stdout.length !== SMALL_W * SMALL_H) return out;
    const m = smallMeasure(stdout, thumb.headline, crop.landX);
    if (m.capPx < MIN_CAP_PX)
      out.push(
        `letters ${m.capPx.toFixed(1)} px tall at ${SMALL_W}x${SMALL_H}`,
      );
    const edges = edgeDensity(stdout);
    if (edges > MAX_EDGE_DENSITY)
      out.push(`edge density ${edges.toFixed(2)} at ${SMALL_W}x${SMALL_H}, too busy`);
    if (m.contrast < MIN_SMALL_CONTRAST)
      out.push(
        `contrast ${m.contrast.toFixed(2)} behind the words at ${SMALL_W}x${SMALL_H}`,
      );
  } catch {
    // Unreadable (a test's stand-in file, a render that failed): nothing to measure, never a block.
  }
  return out;
}

/** A thumbnail design for the render step (the shape of the pipeline's candidates). */
export interface HeroDesign {
  layout: string;
  thumb: Record<string, unknown> & { imageFile: string | null };
}

/**
 * The long video's designs under the rule, best first: the GTA grid where it applies, then up to four posters on
 * different pictures (the thumbnail, two for Test & compare, one held back as the repair). A picture whose hero
 * would come out small goes behind the others. Empty when there is no usable picture: the older designs then carry
 * the release, because nothing here may stop one.
 */
export async function heroRuleDesigns(o: {
  images: HeroArtImage[];
  script: ThumbScript;
  /** The episode's folder, which the pictures' paths are relative to. */
  dir: string;
  grid?: HeroDesign;
  motifId?: string;
  accent?: string;
  /** What a picture offers as a hero (src/assets/localvision.ts heroLook). */
  look?: (file: string) => Promise<HeroLook | undefined>;
}): Promise<HeroDesign[]> {
  const words = heroThumbWords(o.script);
  const scored: Array<{ design: HeroDesign; key: number[] }> = [];
  const arts = rankHeroArt(o.images, o.script, words).slice(0, 10);
  for (const [at, art] of arts.entries()) {
    const look = await o
      .look?.(path.join(o.dir, art.file))
      .catch(() => undefined);
    // Only a picture with no game behind it: the model called GTA 6's photoreal Lucia a real photograph (4 Nov 2026).
    if (look?.realPerson && !artGameName(art.provenance)) continue;
    const subject = art.layers?.fg
      ? await heroSubject(path.join(o.dir, art.layers.fg))
      : undefined;
    const box = look?.box;
    const design: HeroDesign = {
      layout: "poster",
      thumb: {
        headline: words,
        kicker: "",
        game: "",
        accent: o.accent ?? "#FF6B1A",
        layout: "poster",
        imageFile: art.file,
        imageAspect: art.aspect,
        // The face or body the model found beats the depth model's cut-out.
        subjectX: box ? (box[0] + box[2]) / 2 : (subject?.x ?? art.layers?.fgx),
        subjectY: box ? (box[1] + box[3]) / 2 : subject?.y,
      },
    };
    scored.push({
      design,
      key: [
        // A face first, then a body; unjudged pictures before a logo or an object.
        look ? { face: 0, body: 1, thing: 3 }[look.kind] : 2,
        heroSizeProblems(subject, art.aspect).length ? 1 : 0,
        at,
      ],
    });
  }
  scored.sort(
    (a, b) =>
      a.key[0]! - b.key[0]! || a.key[1]! - b.key[1]! || a.key[2]! - b.key[2]!,
  );
  const posters = scored.slice(0, 4).map((x) => x.design);
  if (!posters.length) return [];
  return o.grid && approvedGrid(o.motifId) ? [o.grid, ...posters] : posters;
}

/**
 * No picture the rule ranked: a poster still carries the release, on the given picture unless it belongs to another
 * game, with legal words and no kicker or subtitle. It used to be the split design, whose logo, label pill, repeated
 * title and cut-off subtitle the 19 Nov review failed on three videos.
 */
export function heroRuleFallback(
  split: HeroDesign,
  script: ThumbScript,
  provenance?: string,
): HeroDesign[] {
  const wrong = artVerdict(provenance, script.game_title) === "other";
  return [
    {
      layout: "poster",
      thumb: {
        headline: heroThumbWords(script),
        kicker: "",
        game: "",
        accent: (split.thumb.accent as string | undefined) ?? "#FF6B1A",
        layout: "poster",
        imageFile: wrong ? null : split.thumb.imageFile,
      },
    },
  ];
}
