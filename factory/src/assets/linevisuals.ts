// What each spoken line must show (15 Nov 2026, after "Why did Rockstar narrow GTA 6's roads?"): a story about roads
// opened on a PlayStation controller, compared GTA 6 with GTA 5 without a frame of either game's driving, and talked
// about the map over a press shot. The rules here are pure and tested; src/pipeline.ts gatherMedia applies them.
//   - comparedGames: the other games a script compares its game with ("than GTA 5", "vs", "compared with"), so the
//     media planner fetches footage for each and every sentence is matched to the right game;
//   - sentenceWants: one want per sentence (hook, beats, take, loop) with its game and the tags it asks for;
//   - isHardwareAsset / hardwareStory: controllers, consoles, boxes, editions and merchandise stay out of a game story;
//   - mapScale: a map line with a size figure ("roughly 2 times GTA 5's size") gets an honest to-scale comparison.
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { gameAliases } from "../sceneindex/spoilers.ts";
import { tagsForSentence, type LineWant } from "./gamelib.ts";
import { seriesNumber } from "./officialTrailer.ts";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export interface ScriptLike {
  game_title: string;
  hook: string;
  hook_footage?: { want?: string; keywords?: string[] };
  beats: Array<{
    narration: string;
    footage?: { want?: string; keywords?: string[] };
  }>;
  pulse_take?: { narration?: string };
  loop_line?: string;
  headline?: string;
}

/** The series name of a numbered game ("Grand Theft Auto VI" -> "Grand Theft Auto"); undefined without a number. */
export function seriesOf(game: string): string | undefined {
  const n = seriesNumber(game);
  if (n === undefined) return undefined;
  const base = game.replace(/\s+(?:[ivx]+|\d+)\s*$/i, "").trim();
  return base && base !== game ? base : undefined;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The sentence names this game by any of its spellings ("GTA 5", "GTAV", "Grand Theft Auto V"). */
export function namesGame(text: string, game: string): boolean {
  return gameAliases(game).some((a) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${esc(a)}(?![\\p{L}\\p{N}])`, "iu").test(
      text,
    ),
  );
}

/**
 * The other numbered games of the same series a script names (pure): "than GTA 5" in a GTA 6 story is Grand Theft
 * Auto V. Returned in the series' own long form, roman numerals, so the media libraries and searches agree.
 */
export function comparedGames(script: ScriptLike): string[] {
  const main = script.game_title;
  const series = seriesOf(main);
  if (!series) return [];
  const mine = seriesNumber(main);
  const text = [
    script.hook,
    ...script.beats.map((b) => b.narration),
    script.pulse_take?.narration ?? "",
    script.loop_line ?? "",
  ].join(" ");
  const out: string[] = [];
  for (let n = 1; n <= 10; n++) {
    if (n === mine) continue;
    const g = `${series} ${ROMAN[n]}`;
    if (namesGame(text, g) && !out.includes(g)) out.push(g);
  }
  return out;
}

/** Sentences of a line, short tails kept with the sentence before them (pure). */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .reduce<string[]>((out, s) => {
      if (out.length && s.split(/\s+/).length < 3)
        out[out.length - 1] += ` ${s}`;
      else out.push(s);
      return out;
    }, []);
}

/**
 * One want per sentence (pure): its line's key, its game (a sentence that names a compared game, and not its own
 * game, is about the compared one) and the tags its words and the writer's footage keywords ask for. `names` are the
 * publisher's place and character names the media library knows; a sentence that says one asks for it.
 */
export function sentenceWants(
  script: ScriptLike,
  knownNames: string[] = [],
): LineWant[] {
  const main = script.game_title;
  const others = comparedGames(script);
  const lines: Array<{ key: string; text: string; keywords: string[] }> = [
    {
      key: "hook",
      text: script.hook,
      keywords: script.hook_footage?.keywords ?? [],
    },
    ...script.beats.map((b, i) => ({
      key: `beat:${i}`,
      text: b.narration,
      keywords: b.footage?.keywords ?? [],
    })),
    ...(script.pulse_take?.narration?.trim()
      ? [{ key: "take", text: script.pulse_take.narration, keywords: [] }]
      : []),
    ...(script.loop_line?.trim()
      ? [{ key: "loop", text: script.loop_line, keywords: [] }]
      : []),
  ];
  const out: LineWant[] = [];
  for (const l of lines)
    for (const sentence of sentencesOf(l.text)) {
      const other = others.find(
        (g) => namesGame(sentence, g) && !namesGame(sentence, main),
      );
      out.push({
        key: l.key,
        sentence,
        game: other ?? main,
        tags: tagsForSentence(sentence, other ? [] : l.keywords),
        names: knownNames.filter(
          (n) =>
            n.length > 3 && new RegExp(`\\b${esc(n)}\\b`, "i").test(sentence),
        ),
      });
    }
  return out;
}

/** Hardware, boxes, editions and merchandise, by what the picture's source says it is (pure). */
const HARDWARE =
  /\b(controllers?|dualsense|dualshock|gamepads?|joy-?cons?|consoles?|ps5 (?:pro|slim|bundle)|xbox series [xs] (?:console|bundle)|handhelds?|steam deck|switch 2 (?:console|bundle)|bundles?|limited[- ]edition|collector'?s?[- ]edition|special[- ]edition|ultimate[- ]edition|steelbook|box[- ]?art|packshot|front[- ]of[- ]box|fob|merch(?:andise)?|figurines?|statues?|apparel|t-shirts?|hoodies?|headsets?|accessor(?:y|ies)|faceplates?|console covers?|pre-?order (?:bonus|editions?))\b/i;

export function isHardwareAsset(a: {
  provenance?: string;
  sourceUrl?: string;
  file?: string;
  label?: string;
  hardware?: boolean;
}): boolean {
  if (a.hardware) return true;
  const text = [a.provenance, a.sourceUrl, a.file, a.label]
    .filter(Boolean)
    .join(" ")
    .replace(/[-_/]+/g, " ");
  return HARDWARE.test(text);
}

/** A story about the hardware or an edition itself: then such pictures may show (pure). */
export function hardwareStory(
  script: Pick<ScriptLike, "headline" | "hook" | "beats">,
): boolean {
  const text = [
    script.headline ?? "",
    script.hook,
    ...script.beats.map((b) => b.narration),
  ].join(" ");
  return HARDWARE.test(text.replace(/[-_/]+/g, " "));
}

/** A map line's size figure (pure): "roughly 2 times GTA 5's size", "twice the size", "2x bigger"; else undefined. */
export function mapScale(sentence: string): { factor: number } | undefined {
  if (!/\b(map|size|world|bigger|larger)\b/i.test(sentence)) return undefined;
  const m =
    sentence.match(/\b(\d+(?:\.\d+)?)\s*(?:x|×|times)\b/i) ??
    sentence.match(/(\d+(?:\.\d+)?)×/);
  if (m) {
    const f = Number(m[1]);
    return f > 1 && f <= 20 ? { factor: f } : undefined;
  }
  if (/\btwice\b|\bdouble\b/i.test(sentence)) return { factor: 2 };
  if (/\bthree times\b|\btriple\b/i.test(sentence)) return { factor: 3 };
  return undefined;
}

const exec = promisify(execFile);

/** A system font ffmpeg can draw with on this machine (macOS, Windows, Linux), or undefined. */
export function systemFont(): string | undefined {
  return [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ].find((f) => fs.existsSync(f));
}

/** ffmpeg's text needs ':' and '\'' escaped; Windows drive colons too. */
const ffText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019");

/**
 * The honest map comparison as a 16:9 picture: two squares whose areas are in the cited ratio, each labelled, and the
 * source of the figure under them. Never a drawn map: no coastline or place is invented.
 */
export async function mapScaleGraphic(
  out: string,
  o: { small: string; big: string; factor: number; source: string },
): Promise<boolean> {
  const font = systemFont();
  if (!font) return false;
  // Square, so a vertical Short shows it whole in its framed panel (a 16:9 picture is cropped to its middle).
  const W = 1080, H = 1920;
  const smallSide = 240;
  const bigSide = Math.round(smallSide * Math.sqrt(o.factor));
  const base = 1180;
  const x1 = 320 - smallSide / 2, x2 = 760 - bigSide / 2;
  const f = font.replace(/:/g, "\\:");
  const draw = [
    `drawbox=x=${x1}:y=${base - smallSide}:w=${smallSide}:h=${smallSide}:color=0x9aa4b2@0.95:t=fill`,
    `drawbox=x=${x2}:y=${base - bigSide}:w=${bigSide}:h=${bigSide}:color=0xff6b1a@0.95:t=fill`,
    `drawtext=fontfile='${f}':text='${ffText(o.small)}':x=${x1 + smallSide / 2}-tw/2:y=${base - smallSide / 2}-th/2:fontsize=48:fontcolor=0x0d1117`,
    `drawtext=fontfile='${f}':text='${ffText(o.big)}':x=${x2 + bigSide / 2}-tw/2:y=${base - bigSide / 2}-th/2:fontsize=56:fontcolor=0x0d1117`,
    `drawtext=fontfile='${f}':text='MAP AREA TO SCALE':x=(w-tw)/2:y=${base - bigSide - 90}:fontsize=52:fontcolor=white`,
    `drawtext=fontfile='${f}':text='${ffText(`About ${o.factor}x the area, per ${o.source}`)}':x=(w-tw)/2:y=1520:fontsize=40:fontcolor=0xc8ccd4`,
  ].join(",");
  try {
    await exec(
      FFMPEG,
      [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=0x0d1117:s=${W}x${H}`,
        "-vf",
        draw,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        out,
      ],
      { timeout: 60_000 },
    );
    return fs.existsSync(out);
  } catch {
    return false;
  }
}
