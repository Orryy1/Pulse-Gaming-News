// The game media library (GAME_LIBRARY, 15 Nov 2026). Owner: "There's a treasure trove of GTA 5 and 6 footage and
// screenshots and you seem to just reuse the same unrelated ones constantly." The last ten GTA Shorts showed eleven
// pictures between them (ten IGDB screenshots and one PlayStation press shot of a controller), because each Short only
// had what its own story gather happened to fetch.
//
// Now each big game has a library on disk, built once and topped up: every official screenshot and trailer from the
// publisher's own site (src/assets/publishersite.ts), IGDB's full screenshot set, the Steam store's screenshots, and
// the owner's own recordings cut into scenes. Every still and every video scene is looked at once by the free local
// vision model (PC Ollama through the relay, never a paid API) and tagged with what it shows: driving, roads, a map,
// the beach, night, a vehicle, the place or person the publisher filed it under. Near-duplicates are dropped by a
// picture hash. A Short then picks for each sentence by tag (pickForLines), and the usage ledger keeps what each Short
// showed, so anything shown in the last ten Shorts of the game is pushed down and nothing repeats inside one Short.
//
// On disk: <GAME_LIBRARY_DIR or data/gamelib>/<game slug>/library.json, stills/, videos/; usage.json beside them.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import { sceneSlug } from "../sceneindex/schema.ts";
import { gameAliases } from "../sceneindex/spoilers.ts";
import {
  LOCAL_VISION_MODEL,
  LOCAL_VISION_URL,
  SUGGESTIVE_RULE,
  visionAnswer,
} from "./localvision.ts";

const exec = promisify(execFile);

export const LIBRARY_VERSION = 1;

/** What the tagger may say a picture shows: the words the picker matches lines against. */
export const TAG_VOCAB = [
  "driving",
  "car",
  "road",
  "highway",
  "street",
  "traffic",
  "motorbike",
  "boat",
  "aircraft",
  "helicopter",
  "police",
  "chase",
  "crash",
  "map",
  "aerial",
  "skyline",
  "city",
  "beach",
  "ocean",
  "swamp",
  "countryside",
  "nature",
  "wildlife",
  "night",
  "day",
  "sunset",
  "interior",
  "crowd",
  "close-up",
  "character",
  "couple",
  "action",
  "gunfight",
  "robbery",
  "money",
  "nightclub",
  "party",
  "store",
  "phone",
  "menu",
] as const;

export interface LibScene {
  at: number; // seconds into the video
  end: number;
  tags: string[];
  seen: string;
}

export interface LibItem {
  id: string;
  kind: "still" | "video";
  /** Relative to the game's library folder. */
  file: string;
  sourceUrl: string;
  provenance: string;
  /** "Rockstar Games", "IGDB", "Steam", "own". Footage caps follow the publisher's (provenance says "publisher: X"). */
  source: string;
  /** The publisher's own naming: the place or character folder, "trailer". */
  named: string[];
  /** What the vision model saw (stills; a video's scenes carry their own). */
  tags: string[];
  seen: string;
  dhash?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  scenes?: LibScene[];
  /** The model saw large lettering, a webcam, hardware or merchandise, or a suggestive picture: never picked. */
  unusable?: string;
  addedAt: string;
}

export interface GameLibrary {
  version: number;
  game: string;
  items: LibItem[];
  updatedAt: string;
}

export function libraryRoot(dataDir: string): string {
  return process.env.GAME_LIBRARY_DIR || path.join(dataDir, "gamelib");
}

export function libraryDir(root: string, game: string): string {
  return path.join(root, sceneSlug(canonicalGame(game)));
}

/** One spelling per game ("GTA 6", "Grand Theft Auto 6" and "Grand Theft Auto VI" share a library). */
export function canonicalGame(game: string): string {
  // Short forms and arabic numbers first ("GTA 6" -> "Grand Theft Auto VI"), then the first spelling the aliases know.
  const roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const long = game
    .trim()
    .replace(/^GTA\s*(?=[\dIVX]|$)/i, "Grand Theft Auto ")
    .replace(/^RDR\s*(?=\d|$)/i, "Red Dead Redemption ")
    .replace(/\s+/g, " ")
    .trim();
  const numbered = long.startsWith("Grand Theft Auto ") ? long.replace(/ (\d{1,2})$/, (_, n: string) => ` ${roman[Number(n)] ?? n}`) : long;
  const aliases = gameAliases(numbered);
  return aliases[0] ?? numbered;
}

export async function readLibrary(
  root: string,
  game: string,
): Promise<GameLibrary | undefined> {
  try {
    const lib = JSON.parse(
      await fs.readFile(
        path.join(libraryDir(root, game), "library.json"),
        "utf8",
      ),
    ) as GameLibrary;
    if (lib.version !== LIBRARY_VERSION) return undefined;
    for (const i of lib.items) i.file = portableFile(i.file);
    return lib;
  } catch {
    return undefined;
  }
}

/** A library file path as stored (pure): relative paths with "/" on every machine; absolute paths left as they are. */
export function portableFile(file: string): string {
  return path.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file) ? file : file.replace(/\\/g, "/");
}

export async function writeLibrary(
  root: string,
  lib: GameLibrary,
): Promise<void> {
  lib = { ...lib, items: lib.items.map((i) => ({ ...i, file: portableFile(i.file) })) };
  const dir = libraryDir(root, lib.game);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, "library.json.tmp");
  await fs.writeFile(
    tmp,
    JSON.stringify({ ...lib, updatedAt: new Date().toISOString() }, null, 1),
    "utf8",
  );
  await fs.rename(tmp, path.join(dir, "library.json"));
}

export const itemId = (sourceUrl: string, at = ""): string =>
  crypto
    .createHash("sha1")
    .update(`${sourceUrl}${at}`)
    .digest("hex")
    .slice(0, 14);

// ---------------------------------------------------------------- near-duplicates

/** A 64-bit difference hash of a picture (9x8 grey), as hex. */
export async function dhash(
  file: string,
  atSeconds?: number,
): Promise<string | undefined> {
  try {
    const { stdout } = await exec(
      FFMPEG,
      [
        "-v",
        "error",
        ...(atSeconds !== undefined ? ["-ss", atSeconds.toFixed(2)] : []),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=9:8:flags=area,format=gray",
        "-f",
        "rawvideo",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 1024 * 1024 } as never,
    );
    return dhashOf(stdout as unknown as Buffer);
  } catch {
    return undefined;
  }
}

/** The hash of 72 grey bytes, row by row: each bit says a pixel is brighter than its right neighbour (pure). */
export function dhashOf(px: Buffer | Uint8Array): string | undefined {
  if (px.length < 72) return undefined;
  let bits = "";
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      bits += px[y * 9 + x]! > px[y * 9 + x + 1]! ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4)
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}

/** Within this many bits two pictures are the same shot (a resize, a recompress, a crop of a few pixels). */
export const SAME_PICTURE_BITS = 5;

export function isNearDuplicate(
  hash: string | undefined,
  known: Array<string | undefined>,
): boolean {
  if (!hash) return false;
  return known.some((k) => !!k && hamming(hash, k) <= SAME_PICTURE_BITS);
}

// ---------------------------------------------------------------- tagging

export interface PictureTags {
  tags: string[];
  seen: string;
  /** Why it can never be used, if it cannot. */
  unusable?: string;
}

export function tagPrompt(game: string, named: string[]): string {
  return `This is a picture from the video game ${game}${named.length ? ` (the publisher filed it under: ${named.join(", ")})` : ""}.
tags: every word from this list that describes what the picture clearly shows: ${TAG_VOCAB.join(", ")}. "driving" means a vehicle is being driven on a road or track; "road" means a road or street is clearly in view; "map" means an in-game map, a satellite view or a map screen; "aerial" means seen from high above.
seen: what the picture shows, in under 15 words.
lettering: true when large words, a title, a logo, a rating card or a caption cover much of the picture (a small HUD or street signs are fine).
webcam: true when a streamer's webcam, chat or overlay is on top of the game.
hardware: true when the main subject is a real-world product rather than the game world: a controller, console, handheld, game box, special edition, figure or merchandise.
${SUGGESTIVE_RULE}
Answer with the JSON object only, briefly.`;
}

/** The tagger's answer as tags (pure): unknown words dropped, a reason when the picture must never be used. */
export function tagsFromAnswer(a: any): PictureTags | undefined {
  if (!a || typeof a !== "object" || !Array.isArray(a.tags)) return undefined;
  const vocab = new Set<string>(TAG_VOCAB);
  const tags = [
    ...new Set(
      (a.tags as unknown[])
        .map((t) => String(t).toLowerCase().trim())
        .filter((t) => vocab.has(t)),
    ),
  ];
  const unusable =
    a.hardware === true
      ? "hardware or merchandise"
      : a.webcam === true
        ? "streamer overlay"
        : a.suggestive === true
          ? "not ad-safe"
          : a.lettering === true
            ? "large lettering"
            : undefined;
  return {
    tags,
    seen: typeof a.seen === "string" ? a.seen.slice(0, 160) : "",
    ...(unusable ? { unusable } : {}),
  };
}

/** Tags one picture on the free local model (the PC relay); undefined when it cannot answer. */
export async function tagPicture(
  file: string,
  game: string,
  named: string[],
): Promise<PictureTags | undefined> {
  // A 4K press still is far more than the model's context holds (8,593 tokens against 8,192 on 15 Nov 2026): it is
  // looked at as a 768-pixel copy, plenty to say what it shows.
  const small = `${file}.tag.jpg`;
  await exec(FFMPEG, ["-y", "-v", "error", "-i", file, "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", "-q:v", "4", small]).catch(() => undefined);
  const image = (await fs.readFile(small).catch(() => fs.readFile(file))).toString("base64");
  await fs.rm(small, { force: true }).catch(() => undefined);
  const res = await fetchWithTimeout(
    `${LOCAL_VISION_URL}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.GAME_LIBRARY_VISION_MODEL || LOCAL_VISION_MODEL,
        stream: false,
        think: false,
        format: {
          type: "object",
          properties: {
            tags: { type: "array", items: { type: "string" } },
            seen: { type: "string" },
            lettering: { type: "boolean" },
            webcam: { type: "boolean" },
            hardware: { type: "boolean" },
            suggestive: { type: "boolean" },
          },
          required: [
            "tags",
            "seen",
            "lettering",
            "webcam",
            "hardware",
            "suggestive",
          ],
        },
        keep_alive: "60s",
        options: { temperature: 0, num_predict: 2600, num_ctx: 8192 },
        messages: [
          { role: "user", content: tagPrompt(game, named), images: [image] },
        ],
      }),
    },
    120_000,
  );
  if (!res.ok)
    throw new Error(
      `vision ${res.status}: ${(await res.text()).slice(0, 160)}`,
    );
  const body = (await res.json()) as { message?: { content?: string; thinking?: string } };
  if (body.message?.content?.includes("</think>")) body.message.content = body.message.content.split("</think>").pop()!.trim();
  const tags = tagsFromAnswer(visionAnswer(body as never));
  if (!tags) throw new Error(`vision answer not readable: ${(body.message?.content || body.message?.thinking || "").slice(0, 160)}`);
  return tags;
}

// ---------------------------------------------------------------- video scenes

/** Scene spans from the cut times of a video (pure): each 1.2 s to 6 s, long stretches split, short ones dropped. */
export function scenesFromCuts(
  cuts: number[],
  total: number,
  opts: {
    min?: number;
    max?: number;
    skipHead?: number;
    skipTail?: number;
  } = {},
): Array<{ at: number; end: number }> {
  const min = opts.min ?? 1.2;
  const max = opts.max ?? 6;
  const from = opts.skipHead ?? 0;
  const to = total - (opts.skipTail ?? 0);
  const edges = [
    from,
    ...cuts
      .filter((c) => c > from + 0.05 && c < to - 0.05)
      .sort((a, b) => a - b),
    to,
  ];
  const out: Array<{ at: number; end: number }> = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    let a = edges[i]! + 0.1;
    const b = edges[i + 1]! - 0.1;
    while (b - a >= min) {
      const end = Math.min(b, a + max);
      if (end - a >= min)
        out.push({
          at: Math.round(a * 100) / 100,
          end: Math.round(end * 100) / 100,
        });
      a = end + (b - end > min ? 0 : 0);
      if (end >= b) break;
    }
  }
  return out;
}

export async function videoSeconds(file: string): Promise<number> {
  const { stdout } = await exec(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    file,
  ]).catch(() => ({ stdout: "0" }));
  const d = Number(String(stdout).trim());
  return Number.isFinite(d) ? d : 0;
}

/** The cut times of a video (ffmpeg's scene score over 0.32), or evenly spaced marks for one continuous take. */
export async function cutTimes(
  file: string,
  continuous = false,
): Promise<number[]> {
  const total = await videoSeconds(file);
  if (continuous)
    return Array.from(
      { length: Math.floor(total / 20) },
      (_, i) => (i + 1) * 20,
    );
  const { stderr } = await exec(
    FFMPEG,
    [
      "-hide_banner",
      // Two decoder threads: a light background scan, never a job that crowds a render.
      "-threads",
      "2",
      "-i",
      file,
      "-an",
      "-vf",
      "scale=320:-2,select='gt(scene,0.32)',showinfo",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  ).catch((e: { stderr?: string }) => ({ stderr: String(e.stderr ?? "") }));
  return [...String(stderr).matchAll(/pts_time:([\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
}

export async function grabFrame(
  video: string,
  at: number,
  out: string,
): Promise<boolean> {
  await exec(FFMPEG, [
    "-y",
    "-v",
    "error",
    "-ss",
    at.toFixed(2),
    "-i",
    video,
    "-frames:v",
    "1",
    "-vf",
    "scale=-2:540",
    "-q:v",
    "4",
    out,
  ]).catch(() => undefined);
  return (await fs.stat(out).catch(() => undefined))?.isFile() ?? false;
}

// ---------------------------------------------------------------- picking

/** Words a line says and the tags that show them; the writer's footage keywords count the same. */
const WANTS: Array<[RegExp, string[]]> = [
  [
    /\b(roads?|streets?|lanes?|avenues?|boulevards?)\b/i,
    ["road", "street", "driving", "traffic", "car"],
  ],
  [
    /\b(highways?|freeways?|motorways?|interstate)\b/i,
    ["highway", "road", "driving", "traffic"],
  ],
  [
    /\b(driv\w*|cars?|vehicles?|traffic|cruis\w*|steer\w*|wheel)\b/i,
    ["driving", "car", "road", "traffic"],
  ],
  [
    /\b(chases?|getaways?|pursuits?|escape|cops?|police|wanted)\b/i,
    ["police", "chase", "driving", "car"],
  ],
  [
    /\b(maps?|world|size|bigger|biggest|larger|square miles|open world|explore|leonida|state)\b/i,
    ["map", "aerial", "skyline", "city", "countryside"],
  ],
  [
    /\b(city|downtown|skyline|vice city|neighbou?rhoods?)\b/i,
    ["city", "skyline", "street"],
  ],
  [/\b(beach\w*|coast|ocean|sea|keys|island)\b/i, ["beach", "ocean", "boat"]],
  [
    /\b(swamps?|everglades|grassrivers|wildlife|alligators?|gators?|nature)\b/i,
    ["swamp", "wildlife", "nature"],
  ],
  [/\b(nights?|neon|club\w*|party)\b/i, ["night", "nightclub", "party"]],
  [
    /\b(heists?|robb\w*|steal\w*|money|cash|bank)\b/i,
    ["robbery", "money", "action"],
  ],
  [/\b(guns?|shoot\w*|fight\w*|combat|action)\b/i, ["action", "gunfight"]],
  [
    /\b(boats?|planes?|flying|fly|helicopters?|aircraft)\b/i,
    ["boat", "aircraft", "helicopter"],
  ],
  [/\b(phones?|apps?|social media|online)\b/i, ["phone"]],
  [
    /\b(jason|lucia|couple|characters?|protagonists?)\b/i,
    ["character", "couple", "close-up"],
  ],
  [/\b(crowds?|people|npcs?|pedestrians?)\b/i, ["crowd", "street"]],
];

export interface LineWant {
  key: string; // "hook", "beat:0", "take", "loop"
  sentence: string;
  /** The game this sentence is about (a comparison names the other game). */
  game: string;
  tags: string[];
  /** Publisher names the sentence says ("Vice City", "Jason"). */
  names: string[];
}

/** The tags a sentence asks for (pure): what its words name, then the writer's keywords. */
export function tagsForSentence(
  sentence: string,
  keywords: string[] = [],
): string[] {
  const out: string[] = [];
  for (const text of [sentence, keywords.join(" ")])
    for (const [re, tags] of WANTS)
      if (re.test(text))
        for (const t of tags) if (!out.includes(t)) out.push(t);
  return out;
}

export interface LibPick {
  key: string;
  sentence: string;
  game: string;
  item: LibItem;
  scene?: LibScene;
  score: number;
}

/** The asset key the usage ledger and the freshness rule count: an item, or one scene of a video. */
export const assetKey = (
  item: Pick<LibItem, "id">,
  scene?: Pick<LibScene, "at">,
): string => (scene ? `${item.id}@${scene.at}` : item.id);

/** How well a picture fits a sentence (pure): its tags against the line's, plus the publisher's naming. */
export function fitScore(
  tags: string[],
  named: string[],
  seen: string,
  want: Pick<LineWant, "tags" | "names">,
): number {
  if (!want.tags.length && !want.names.length) return 0.1;
  let s = 0;
  want.tags.forEach((t, i) => {
    if (tags.includes(t)) s += i < 3 ? 1 : 0.5;
  });
  for (const n of want.names)
    if (
      named.some((x) => x.toLowerCase().includes(n.toLowerCase())) ||
      seen.toLowerCase().includes(n.toLowerCase())
    )
      s += 1.5;
  return s;
}

/** Each recent use (in the game's last RECENT_SHORTS Shorts) costs this much fit. */
export const RECENT_PENALTY = 1.25;
export const RECENT_SHORTS = 10;
/** How much fit the owner's own recording gains over a publisher's or a store's picture. */
export const OWN_BONUS = 0.5;

export interface PickOptions {
  /** Asset key to how many of the game's recent Shorts showed it. */
  recent?: Map<string, number>;
  /** Moving footage first: a scene beats a still of the same fit (footage first on a Short). */
  preferVideo?: boolean;
  /** Stills too, one per sentence, beside the scene (for the planner's still slots and the thumbnail). */
  stillsToo?: boolean;
  /** Asset keys never to pick (already chosen elsewhere in this Short). */
  exclude?: string[];
}

/**
 * For each sentence, the library's best-fitting scene (and still), never an asset already picked for this Short and
 * pushed down by every recent use (pure). Libraries by game: a comparison's sentence picks from the other game's.
 */
export function pickForLines(
  libs: Map<string, GameLibrary>,
  wants: LineWant[],
  o: PickOptions = {},
): LibPick[] {
  const used = new Set<string>(o.exclude ?? []);
  const out: LibPick[] = [];
  const recent = o.recent ?? new Map();
  for (const w of wants) {
    const lib = libs.get(canonicalGame(w.game));
    if (!lib) continue;
    const choose = (kind: "still" | "video"): LibPick | undefined => {
      let best: LibPick | undefined;
      for (const item of lib.items) {
        if (item.unusable || item.kind !== kind) continue;
        const options =
          kind === "video"
            ? (item.scenes ?? []).map((sc) => ({
                tags: sc.tags,
                seen: sc.seen,
                scene: sc as LibScene | undefined,
              }))
            : [{ tags: item.tags, seen: item.seen, scene: undefined }];
        for (const opt of options) {
          const key = assetKey(item, opt.scene);
          if (used.has(key)) continue;
          const fit = fitScore(opt.tags, item.named, opt.seen, w);
          if (fit <= 0) continue;
          const score =
            fit -
            RECENT_PENALTY * (recent.get(key) ?? 0) +
            (kind === "video" && o.preferVideo ? 0.25 : 0) +
            // Own footage first (owner, 5 Nov 2026): the owner's recordings win a tie with anyone else's.
            (item.source === "own" ? OWN_BONUS : 0);
          if (!best || score > best.score)
            best = {
              key: w.key,
              sentence: w.sentence,
              game: lib.game,
              item,
              scene: opt.scene,
              score,
            };
        }
      }
      return best;
    };
    const firstKind = o.preferVideo === false ? "still" : "video";
    const a =
      choose(firstKind) ?? choose(firstKind === "video" ? "still" : "video");
    if (a) {
      used.add(assetKey(a.item, a.scene));
      out.push(a);
    }
    if (o.stillsToo && a?.item.kind === "video") {
      const b = choose("still");
      if (b) {
        used.add(assetKey(b.item));
        out.push(b);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- usage ledger

export interface UsageEntry {
  episode: string;
  game: string;
  at: string;
  keys: string[];
}

export async function readUsage(root: string): Promise<UsageEntry[]> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(root, "usage.json"), "utf8"),
    ) as UsageEntry[];
  } catch {
    return [];
  }
}

/** Asset key to how many of the game's last `n` Shorts showed it (pure); the episode itself never counts. */
export function recentUses(
  entries: UsageEntry[],
  game: string,
  n = RECENT_SHORTS,
  except?: string,
): Map<string, number> {
  const g = canonicalGame(game);
  const mine = entries
    .filter((e) => canonicalGame(e.game) === g && e.episode !== except)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, n);
  const out = new Map<string, number>();
  for (const e of mine)
    for (const k of new Set(e.keys)) out.set(k, (out.get(k) ?? 0) + 1);
  return out;
}

/** Records what a Short showed (one entry per episode and game, replaced on a re-render). */
export async function recordUsage(
  root: string,
  entry: UsageEntry,
): Promise<void> {
  const all = (await readUsage(root)).filter(
    (e) =>
      !(
        e.episode === entry.episode &&
        canonicalGame(e.game) === canonicalGame(entry.game)
      ),
  );
  all.push(entry);
  await fs.mkdir(root, { recursive: true });
  const tmp = path.join(root, "usage.json.tmp");
  await fs.writeFile(tmp, JSON.stringify(all.slice(-2000), null, 1), "utf8");
  await fs.rename(tmp, path.join(root, "usage.json"));
}

// ---------------------------------------------------------------- materialising a pick for an episode

/** Copies a picked still into the episode, or cuts a picked scene into a clip there; the file path relative to it. */
export async function materialise(
  root: string,
  pick: LibPick,
  episodeDir: string,
  maxSeconds = 4.2,
): Promise<{ file: string; durationSeconds?: number } | undefined> {
  // The Mac's cache, else only this segment from the PC's master library (src/assets/gamelibstore.ts), else nothing.
  const { sourceOf, storeSettings } = await import("./gamelibstore.ts");
  const from = await sourceOf(root, pick.game, pick.item.file, storeSettings());
  if (!from) return undefined;
  const src = from.local ?? from.url!;
  await fs.mkdir(path.join(episodeDir, "assets"), { recursive: true });
  try {
    if (!pick.scene) {
      const file = path.join(
        "assets",
        `lib_${pick.item.id}${/^\.(jpe?g|png|webp)$/i.test(path.extname(pick.item.file)) ? path.extname(pick.item.file) : ".jpg"}`,
      );
      // A 4K press still is written at 1920 pixels across: plenty for a vertical Short, and small enough for the
      // picture checks (15 Nov 2026: a 3840-pixel Rockstar still overran the local model's context, which then counted
      // the relay as down and paused every picture check for ten minutes).
      const dest = path.join(episodeDir, file);
      const shrunk = await exec(FFMPEG, ["-y", "-v", "error", "-i", src, "-frames:v", "1", "-vf", "scale='min(1920,iw)':-2", "-q:v", "2", dest], { timeout: 60_000 })
        .then(() => true)
        .catch(() => false);
      if (!shrunk) {
        if (from.local) await fs.copyFile(src, dest);
        else {
          const res = await fetchWithTimeout(src, {}, 30_000);
          if (!res.ok) return undefined;
          await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
        }
      }
      return { file };
    }
    const seconds = Math.min(maxSeconds, pick.scene.end - pick.scene.at);
    const file = path.join(
      "assets",
      `lib_${pick.item.id}_${Math.round(pick.scene.at * 10)}.mp4`,
    );
    await exec(
      FFMPEG,
      [
        "-y",
        "-v",
        "error",
        "-ss",
        pick.scene.at.toFixed(2),
        "-i",
        src,
        "-t",
        seconds.toFixed(2),
        "-an",
        "-vf",
        "scale=-2:1080,fps=30",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        path.join(episodeDir, file),
      ],
      { maxBuffer: 8 * 1024 * 1024, timeout: from.url ? 60_000 : 120_000 },
    );
    return { file, durationSeconds: Math.max(0, seconds - 0.05) };
  } catch (err) {
    log("warn", "library pick not copied", {
      item: pick.item.id,
      error: errorMessage(err),
    });
    return undefined;
  }
}

/** The provenance line of a pick, with the publisher named the way the footage caps read it. */
export function pickProvenance(pick: LibPick): string {
  const where = pick.scene
    ? `, ${(pick.scene.end - pick.scene.at).toFixed(1)}s at ${pick.scene.at.toFixed(1)}s`
    : "";
  const pub =
    pick.item.source !== "own" &&
    pick.item.source !== "IGDB" &&
    pick.item.source !== "Steam"
      ? `, publisher: ${pick.item.source}`
      : "";
  return `${pick.item.provenance}${where}${pub}; library pick for ${pick.key} (${(pick.scene?.seen ?? pick.item.seen) || "untagged"})`;
}

/** The library's official trailers of a game (absolute files), for the trailer matcher (src/assets/officialTrailer.ts). */
export async function libraryTrailers(root: string, game: string): Promise<Array<{ file: string; name: string; url: string; publisher: string }>> {
  const lib = await readLibrary(root, game);
  if (!lib) return [];
  const dir = libraryDir(root, game);
  return lib.items
    .filter((i) => i.kind === "video" && i.source !== "own" && i.named.includes("trailer") && !i.unusable)
    .map((i) => ({ file: path.join(dir, i.file), name: i.provenance.match(/"([^"]+)"/)?.[1] ?? i.id, url: i.sourceUrl, publisher: i.source }));
}
