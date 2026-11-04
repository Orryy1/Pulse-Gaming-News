// The thumbnail rule for long videos (THUMB_HERO_RULE, owner, 3-4 Nov 2026): one recognisable hero, 2-4 big words,
// no decorative frames, visors or small panels. He rejected the Halo motif thumbnail (Halloween skins inside a visor
// frame) and replaced it with Master Chief on the right and HALO 3 ISN'T #1 huge on the left; that is the model
// (src/render/ThumbStudio.tsx PosterThumb). The GTA cover grid, which he asked for on Vice City, is the one approved
// special case and keeps its route (approvedGrid).
//
// At generation time this picks words that pass and art that belongs to the game, from the provenance line every
// picture carries: on the GTA 6 documentary the media step holds Red Dead Redemption 2 art (its chapter) beside GTA
// art, and a ranking's "still the king" thumbnail once showed the wrong entry. As a check it measures the rendered
// thumbnail at 168x94, the size it is seen at in a feed. A failing thumbnail gives way to the next design
// (src/qa/thumbrepair.ts); this file never stops a release, and anything it cannot read counts as passing.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
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
export const THUMB_MAX_WORDS = 4;
/** Longer than this cannot be big, whatever the word count. */
const THUMB_MAX_CHARS = 26;
/** The feed's small thumbnail. */
export const SMALL_W = 168;
export const SMALL_H = 94;
/** Capital letters shorter than this at 168x94 cannot be read. */
export const MIN_CAP_PX = 8;
/** Brightest letters against the darkest edges in the words' box at 168x94, 0-1. */
export const MIN_SMALL_CONTRAST = 0.4;

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

/** The fields of a script the words are chosen from. */
export interface ThumbScript {
  headline: string;
  game_title: string;
  recap?: unknown;
  evergreen_format?: string;
  entries?: Array<{ game_title?: string }>;
  youtube?: { thumb_text?: string };
}

/** The words for a thumbnail: the writer's own if they pass, else short plain ones that always do. */
export function heroThumbWords(script: ThumbScript): string {
  const own = script.youtube?.thumb_text?.trim().replace(/\s+/g, " ");
  if (own && !thumbWordProblems(own).length) return own.toUpperCase();
  const game = script.game_title.trim().toUpperCase();
  const fits = (t: string) => (thumbWordProblems(t).length ? undefined : t);
  if (script.recap) return "THIS WEEK";
  if (script.entries?.length && script.evergreen_format !== "documentary")
    return fits(`${game} RANKED`) ?? "THE FINAL RANKING";
  return fits(`THE ${game} STORY`) ?? "THE REAL STORY";
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
  for (const { i } of scored) {
    (seen.has(i.beatIndex) ? later : first).push(i);
    seen.add(i.beatIndex);
  }
  return [...first, ...later];
}

/** The series-grid special case: the GTA cover grid the owner asked for. Every other motif card is off the route. */
export function approvedGrid(motifId?: string): boolean {
  return motifId === "gta";
}

/** The designs the rule allows. Everything else (frames, screens, panels, circles, cuttings) is off the default route. */
export function layoutProblem(
  layout: string | undefined,
  motifId?: string,
): string | undefined {
  if (layout === "poster") return undefined;
  if (layout === "motif" && approvedGrid(motifId)) return undefined;
  return `the ${layout ?? "split"} design has frames or panels`;
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
}): Promise<HeroDesign[]> {
  const words = heroThumbWords(o.script);
  const large: HeroDesign[] = [];
  const small: HeroDesign[] = [];
  for (const art of rankHeroArt(o.images, o.script, words).slice(0, 8)) {
    const subject = art.layers?.fg
      ? await heroSubject(path.join(o.dir, art.layers.fg))
      : undefined;
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
        subjectX: subject?.x ?? art.layers?.fgx,
        subjectY: subject?.y,
      },
    };
    (heroSizeProblems(subject, art.aspect).length ? small : large).push(design);
  }
  const posters = [...large, ...small].slice(0, 4);
  if (!posters.length) return [];
  return o.grid && approvedGrid(o.motifId) ? [o.grid, ...posters] : posters;
}
