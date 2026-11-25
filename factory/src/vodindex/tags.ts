// Tags on the owner's stream recordings (VOD_TAGS, on by default; owner streams GTA VI daily from Sat 21 Nov 2026).
// The stream index (src/vodindex) already says what each shot shows in a sentence. This adds what a line looks a
// moment up by: every stretch of about half a minute gets the place or district, what he is doing (driving, a shop, a
// mission and its kind, a vehicle, a brand on screen such as "Scooter Bros"), the time of day, and whether it looks
// like the story (a cutscene, a mission's plot), which the spoiler guard holds during the game's window (GTA VI: until
// 17 Dec 2026). Each shot also gets a meaning vector (src/semantic/shots.ts), so a line finds the exact moment of his
// own footage first, before any upload of someone else's.
// The tags come from the free local vision model (PC Ollama, qwen3-vl), two frames a stretch; they are kept beside the
// index in tags.json, keyed by the stretch's times, so re-indexing a stretch never mixes up old tags. Frames are cut by
// ffmpeg in a child process: nothing here opens the recording (often on /Volumes) from the factory's own thread.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import {
  LOCAL_VISION_MODEL,
  LOCAL_VISION_URL,
  THINK_ROOM,
  visionAnswer,
} from "../assets/localvision.ts";
import { knownName } from "../sceneindex/names.ts";
import { findShots, type ShotHit } from "../sceneindex/lookup.ts";
import type { SceneIndex, SceneShot } from "../sceneindex/schema.ts";
import {
  spoilerWindows,
  streamClipHold,
  windowFor,
  windowOpen,
  type SpoilerWindow,
} from "../sceneindex/spoilers.ts";
import type { Embedder } from "../semantic/embed.ts";
import { lineQuery, meanVector } from "../semantic/match.ts";
import { loadFailedShots, loadShotVectors, shotMeaning, unembedded, vectorFile } from "../semantic/shots.ts";
import { asSceneIndex, vodIndexDir, type VodIndex } from "./schema.ts";

const exec = promisify(execFile);

export const TIMES_OF_DAY = [
  "day",
  "dusk",
  "night",
  "dawn",
  "indoors",
  "",
] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export interface VodTags {
  /** Seconds into the recording. */
  from: number;
  to: number;
  /** The district or place, in the game's own spelling when it is on the game's list. */
  place: string;
  /** What he is doing, in a few words: "driving", "in a clothes shop", "mission: a heist", "on foot". */
  activity: string;
  /** The vehicle he is in or on, plainly ("a red sports car", "a scooter"); "" on foot. */
  vehicle: string;
  /** Brands, shops, apps and signs readable on screen ("Scooter Bros"). */
  brands: string[];
  timeOfDay: TimeOfDay;
  /** Looks like the story: a cutscene, a mission's plot or dialogue. Held during the game's spoiler window. */
  story: boolean;
  /** A menu, map, loading or pause screen: never offered as footage. */
  menu: boolean;
  /**
   * A facecam or webcam box, a person filmed by a camera, or a stream overlay (chat, alerts, a donation bar) on the
   * picture: never offered as footage (owner, 25 Nov 2026: a streamer's face is never shown). Absent on tags made
   * before 25 Nov: unknown, which a permitted channel's footage treats as present.
   */
  overlay?: boolean;
  /** Extra search words. */
  words: string[];
}

export interface VodTagFile {
  version: 1;
  stretches: Record<string, VodTags>;
}

export const STRETCH_SECONDS = 30;

/**
 * The recording's stretches (pure): consecutive clean shots grouped up to `seconds` long, a blank or menu shot always
 * ending one. Every clean shot belongs to exactly one stretch.
 */
export function stretchesOf(
  shots: readonly Pick<SceneShot, "id" | "start" | "end" | "blank" | "menu">[],
  seconds = STRETCH_SECONDS,
): Array<{ from: number; to: number; shots: number[] }> {
  const out: Array<{ from: number; to: number; shots: number[] }> = [];
  let cur: { from: number; to: number; shots: number[] } | undefined;
  for (const s of [...shots].sort((a, b) => a.start - b.start)) {
    if (s.blank || s.menu) {
      cur = undefined;
      continue;
    }
    if (!cur || s.end - cur.from > seconds || s.start - cur.to > 2) {
      cur = { from: s.start, to: s.end, shots: [] };
      out.push(cur);
    }
    cur.to = Math.max(cur.to, s.end);
    cur.shots.push(s.id);
  }
  return out;
}

export const stretchKey = (s: { from: number; to: number }) =>
  `${s.from.toFixed(2)}|${s.to.toFixed(2)}`;

export interface TagContext {
  game: string;
  places: string[];
  /** The shots' own descriptions, in order. */
  seen: string[];
  /** Writing read on screen during the stretch (the HUD's district name, a shop sign). */
  text: string;
  /** What was said (his commentary and the game's voices). */
  said: string;
}

/** The question for one stretch (pure, short: the model answers fast). */
export function tagPrompt(c: TagContext): string {
  return [
    `Two frames, in order, from about half a minute of the owner's own play of "${c.game}". Tag the stretch for a footage search. Answer in JSON.`,
    `place: the district or place shown, from this list when it fits: ${c.places.slice(0, 40).join(", ") || "(no list)"}; otherwise two or three plain words ("a beach road"); "" when you cannot tell.`,
    `activity: what the player is doing, three to six words ("driving along the coast", "browsing a clothes shop", "mission: robbing a store", "walking on a beach").`,
    `vehicle: the vehicle the player is in or on, plainly ("a red convertible", "a scooter", "a speedboat"); "" when on foot.`,
    `brands: shop, company, app or brand names readable on screen, exactly as written; [] when none.`,
    `time_of_day: one of day, dusk, night, dawn, indoors.`,
    `story: true when this looks like the game's story: a cutscene (cinema bars, a camera that is not the player's), characters talking in a scripted scene, or a mission briefing; false for ordinary play.`,
    `menu: true only for a menu, map, phone screen filling the frame, loading or pause screen.`,
    `overlay: true when either frame shows a webcam or facecam box, a real person filmed by a camera, or a streaming overlay (a chat box, follower alerts, a donation or subscriber bar) over the game; false for the game's own picture and HUD alone.`,
    `words: 3 to 6 extra single search words (objects, weather, colours).`,
    c.seen.length
      ? `What the shots show: ${c.seen.slice(0, 4).join(" | ").slice(0, 400)}`
      : "",
    c.text ? `Writing read on screen: ${c.text.slice(0, 160)}` : "",
    c.said ? `Heard: ${c.said.slice(0, 240)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    place: { type: "string" },
    activity: { type: "string" },
    vehicle: { type: "string" },
    brands: { type: "array", items: { type: "string" } },
    time_of_day: {
      type: "string",
      enum: ["day", "dusk", "night", "dawn", "indoors"],
    },
    story: { type: "boolean" },
    menu: { type: "boolean" },
    overlay: { type: "boolean" },
    words: { type: "array", items: { type: "string" } },
  },
  required: [
    "place",
    "activity",
    "vehicle",
    "brands",
    "time_of_day",
    "story",
    "menu",
    "overlay",
    "words",
  ],
};

const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const nothing = /^(none|unknown|n\/a|unclear|no vehicle|on foot|-)?$/i;

/** The model's answer as tags (pure); undefined when it says nothing usable. */
export function parseTags(
  raw: any,
  span: { from: number; to: number },
  places: string[],
): VodTags | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const place = clean(raw.place, 60);
  const activity = clean(raw.activity, 80);
  const vehicle = clean(raw.vehicle, 60);
  const tod = clean(raw.time_of_day, 10).toLowerCase();
  if (!activity && !place && raw.menu !== true) return undefined;
  return {
    from: span.from,
    to: span.to,
    place: nothing.test(place) ? "" : (knownName(place, places) ?? place),
    activity: nothing.test(activity) ? "" : activity,
    vehicle: nothing.test(vehicle) ? "" : vehicle,
    brands: [
      ...new Set<string>(
        (Array.isArray(raw.brands) ? raw.brands : [])
          .map((b: unknown) => clean(b, 40))
          .filter((b: string) => /[a-z]{2}/i.test(b) && !nothing.test(b)),
      ),
    ].slice(0, 6),
    timeOfDay: (TIMES_OF_DAY as readonly string[]).includes(tod)
      ? (tod as TimeOfDay)
      : "",
    story: raw.story === true,
    menu: raw.menu === true,
    overlay: raw.overlay === true,
    words: [
      ...new Set<string>(
        (Array.isArray(raw.words) ? raw.words : [])
          .map((w: unknown) => clean(w, 24).toLowerCase())
          .filter((w: string) => /[a-z]{3}/.test(w)),
      ),
    ].slice(0, 8),
  };
}

/** Asks the local vision model about one stretch. Throws when the model cannot be reached. */
export async function lookAtStretch(
  files: string[],
  c: TagContext,
  span: { from: number; to: number },
): Promise<VodTags | undefined> {
  const images = await Promise.all(
    files.map(async (f) => (await fs.readFile(f)).toString("base64")),
  );
  const ask = (plain: boolean) =>
    fetchWithTimeout(
      `${LOCAL_VISION_URL}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: LOCAL_VISION_MODEL,
          stream: false,
          ...(plain ? {} : { think: false }),
          format: SCHEMA,
          keep_alive: process.env.LOCAL_VISION_KEEP_ALIVE ?? "20s",
          options: {
            temperature: 0,
            num_predict: 260 + 2 * THINK_ROOM,
            num_ctx: 8192,
          },
          messages: [{ role: "user", content: tagPrompt(c), images }],
        }),
      },
      120_000,
    );
  let res = await ask(false);
  if (res.status === 400) res = await ask(true);
  if (!res.ok)
    throw new Error(
      `ollama ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  return parseTags(
    visionAnswer(
      (await res.json()) as {
        message?: { content?: string; thinking?: string };
      },
    ),
    span,
    c.places,
  );
}

export const tagFile = (dataDir: string, vodId: string) =>
  path.join(vodIndexDir(dataDir, vodId), "tags.json");

export async function loadVodTags(
  dataDir: string,
  vodId: string,
): Promise<VodTagFile> {
  try {
    const raw = JSON.parse(
      await fs.readFile(tagFile(dataDir, vodId), "utf8"),
    ) as VodTagFile;
    return raw?.version === 1 && raw.stretches
      ? raw
      : { version: 1, stretches: {} };
  } catch {
    return { version: 1, stretches: {} };
  }
}

async function saveVodTags(
  dataDir: string,
  vodId: string,
  t: VodTagFile,
): Promise<void> {
  const file = tagFile(dataDir, vodId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.${process.pid}.tmp`, JSON.stringify(t));
  await fs.rename(`${file}.${process.pid}.tmp`, file);
}

/** The stretches of a recording with no tags yet (pure): only described shots are tagged, so the context is there. */
export function untagged(
  v: VodIndex,
  t: VodTagFile,
): Array<{ from: number; to: number; shots: number[] }> {
  const described = v.shots.filter((s) => s.desc && s.desc !== "-");
  return stretchesOf(described).filter((s) => !t.stretches[stretchKey(s)]);
}

/** True when every described stretch of the recording has its tags (and, given a model, every shot its vector). */
export async function vodTagsReady(
  dataDir: string,
  v: VodIndex,
  model?: string,
): Promise<boolean> {
  if (untagged(v, await loadVodTags(dataDir, v.vodId)).length) return false;
  if (!model) return true;
  const file = vectorFile(vodIndexDir(dataDir, v.vodId), model);
  return unembedded(v.shots, await loadShotVectors(file), await loadFailedShots(file)).length === 0;
}

/** Tags for a stretch nobody could read (pure): story until shown otherwise, so the spoiler guard holds it. */
export function unknownTags(span: { from: number; to: number }): VodTags {
  return { from: span.from, to: span.to, place: "", activity: "", vehicle: "", brands: [], timeOfDay: "", story: true, menu: false, overlay: true, words: [] };
}

export interface TagDeps {
  look?: typeof lookAtStretch;
  grab?: (video: string, at: number, file: string) => Promise<void>;
}

/**
 * Tags up to `limit` stretches of a recording and saves; stops on three model failures in a row (they wait for the
 * next turn). Returns how many were tagged and how many are left.
 */
export async function tagVodStretches(
  v: VodIndex,
  o: { dataDir: string; places: string[]; limit: number },
  deps: TagDeps = {},
): Promise<{ tagged: number; left: number }> {
  const tags = await loadVodTags(o.dataDir, v.vodId);
  const todo = untagged(v, tags);
  if (!todo.length) return { tagged: 0, left: 0 };
  const dir = vodIndexDir(o.dataDir, v.vodId);
  await fs.mkdir(dir, { recursive: true });
  const work = await fs.mkdtemp(path.join(dir, "tag_"));
  const look = deps.look ?? lookAtStretch;
  const grab =
    deps.grab ??
    (async (video: string, at: number, file: string) => {
      await exec(
        FFMPEG,
        [
          "-loglevel",
          "error",
          "-y",
          "-ss",
          at.toFixed(2),
          "-i",
          video,
          "-frames:v",
          "1",
          "-vf",
          "scale=640:-2",
          "-q:v",
          "3",
          file,
        ],
        {
          timeout: 60_000,
          windowsHide: true,
          killSignal: "SIGKILL",
        },
      );
    });
  let tagged = 0;
  let streak = 0;
  try {
    for (const span of todo.slice(0, o.limit)) {
      if (streak >= 3) break;
      const files: string[] = [];
      try {
        const len = span.to - span.from;
        try {
          for (const [k, at] of [
            span.from + len * 0.3,
            span.from + len * 0.75,
          ].entries()) {
            const f = path.join(work, `t_${k}.jpg`);
            await grab(v.file, at, f);
            files.push(f);
          }
        } catch {
          // A stretch whose frames cannot be cut is marked unknown, so it never holds the recording back for ever.
          tags.stretches[stretchKey(span)] = unknownTags(span);
          tagged++;
          continue;
        }
        const shots = span.shots.map((id) => v.shots[id]!).filter(Boolean);
        const got = await look(
          files,
          {
            game: v.game || v.title,
            places: o.places,
            seen: shots.map((s) => s.desc),
            text: [...new Set(shots.map((s) => s.text).filter(Boolean))].join(
              " | ",
            ),
            said: v.lines
              .filter((l) => l.start < span.to && l.end > span.from)
              .map((l) => l.text)
              .join(" "),
          },
          { from: span.from, to: span.to },
        );
        streak = 0;
        // No usable answer: unknown, which the spoiler guard treats as story (held during the window).
        tags.stretches[stretchKey(span)] = got ?? unknownTags(span);
        tagged++;
        if (tagged % 20 === 0) await saveVodTags(o.dataDir, v.vodId, tags);
      } catch (err) {
        streak++;
        if (streak === 3)
          log(
            "warn",
            "stream tags: vision model not answering; stretches wait for the next turn",
            { vod: v.vodId, error: errorMessage(err) },
          );
      } finally {
        for (const f of files)
          await fs.rm(f, { force: true }).catch(() => undefined);
      }
    }
    if (tagged) await saveVodTags(o.dataDir, v.vodId, tags);
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
  return { tagged, left: todo.length - tagged };
}

/** The tags of the stretch a moment falls in (pure). */
export function tagsAt(t: VodTagFile, at: number): VodTags | undefined {
  for (const x of Object.values(t.stretches))
    if (at >= x.from && at < x.to) return x;
  return undefined;
}

/**
 * The recording as a scene index whose shots also carry their stretch's tags (pure), so the scene index's word lookup
 * (findShots) finds "Scooter Bros", "Vice Beach", "night" or "speedboat" in them. A shot in a menu stretch is a menu,
 * and so is one under a facecam or stream overlay (vodMomentBlocked).
 */
export function taggedSceneIndex(v: VodIndex, t: VodTagFile): SceneIndex {
  const own = !v.channel || v.channel === "tinotv";
  const base = asSceneIndex(v);
  const places = new Set<string>();
  const shots = base.shots.map((s) => {
    const tag = tagsAt(t, (s.start + s.end) / 2);
    if (!tag) return s;
    if (tag.place) places.add(tag.place);
    return {
      ...s,
      where: s.where || tag.place,
      tags: [
        ...new Set([
          ...s.tags,
          ...tag.words,
          ...tag.brands,
          ...(tag.vehicle ? [tag.vehicle] : []),
          ...(tag.activity ? [tag.activity] : []),
          ...(tag.place && tag.place !== s.where ? [tag.place] : []),
          ...(tag.timeOfDay && tag.timeOfDay !== "indoors"
            ? [tag.timeOfDay]
            : []),
        ]),
      ],
      // A menu, or a facecam or stream overlay on the picture: never a match.
      ...(vodMomentBlocked(tag, own) ? { menu: true } : {}),
    };
  });
  return { ...base, places: [...places], shots };
}

/**
 * Whether a moment of the owner's stream is held by the spoiler guard (pure): during the game's window a stretch the
 * tags call story is held (streamClipHold's reviewer signal); outside it, or for ordinary play, nothing is.
 */
export function vodMomentHeld(
  w: SpoilerWindow | undefined,
  tag: VodTags | undefined,
  now: Date,
): string | undefined {
  if (!w || !windowOpen(w, now)) return undefined;
  // Inside the window only a moment the tags call ordinary play may go: untagged is held, like a story moment.
  if (!tag) return "not tagged yet, held during the spoiler window";
  const r = streamClipHold(w, undefined, { reviewSpoiler: tag.story }, now);
  return r.hold ? r.reason : undefined;
}

/**
 * Why a moment of a stream is never offered as footage, whatever the date (pure): a menu, or a facecam, webcam or
 * stream overlay on the picture. A permitted channel's stretch tagged before overlays were asked about counts as one.
 */
export function vodMomentBlocked(tag: VodTags | undefined, own: boolean): string | undefined {
  // No tags (a blank or undescribed shot): fine in the owner's own play, never offered from a permitted channel.
  if (!tag) return own ? undefined : "not tagged, may show a facecam";
  if (tag.menu) return "a menu or map";
  if (tag.overlay === true) return "a facecam or stream overlay on the picture";
  if (tag.overlay === undefined && !own) return "not checked for a facecam or overlay";
  return undefined;
}

export interface VodMoment {
  vodId: string;
  file: string;
  start: number;
  end: number;
  score: number;
  label: string;
  tags?: VodTags;
  /** Set when the spoiler guard holds it: never used, listed for the log. */
  held?: string;
}

/**
 * The owner's stream moments for a line, best first: the tagged recordings of the game searched by words (the shots'
 * descriptions, writing and tags) blended with meaning (the shots' vectors against the line's), each moment checked
 * against the spoiler window. Held moments are returned marked, so a caller can log why a good match was not used.
 */
export async function findVodMoments(
  vods: readonly VodIndex[],
  target: { key: string; text: string; keywords?: string[] },
  o: {
    dataDir: string;
    embedder?: Embedder;
    model?: string;
    now: Date;
    windows?: readonly SpoilerWindow[];
    max?: number;
    minConfidence?: number;
  },
): Promise<VodMoment[]> {
  const out: VodMoment[] = [];
  const q =
    o.embedder && o.model
      ? meanVector(
          (await o.embedder.texts(
            lineQuery(target.text, (target.keywords ?? []).join(", ")),
          )) ?? [],
        )
      : undefined;
  for (const v of vods) {
    const t = await loadVodTags(o.dataDir, v.vodId);
    const index = taggedSceneIndex(v, t);
    const vecs = o.model
      ? await loadShotVectors(
          vectorFile(vodIndexDir(o.dataDir, v.vodId), o.model),
        )
      : new Map();
    const semantic =
      q && vecs.size ? shotMeaning(index.shots, vecs, q) : undefined;
    const w = windowFor(o.windows ?? spoilerWindows(), v.game, o.now);
    const own = !v.channel || v.channel === "tinotv";
    const hits: ShotHit[] = findShots(index, target, {
      max: o.max ?? 5,
      minConfidence: o.minConfidence ?? 0.3,
      minSeconds: 1.5,
      ...(semantic ? { semantic } : {}),
    });
    for (const h of hits) {
      const tag = tagsAt(t, (h.start + h.end) / 2);
      const held = vodMomentBlocked(tag, own) ?? vodMomentHeld(w, tag, o.now);
      out.push({
        vodId: v.vodId,
        file: v.file,
        start: h.start,
        end: h.end,
        score: h.confidence,
        label: [h.desc, tag?.activity, tag?.place, ...(tag?.brands ?? [])]
          .filter(Boolean)
          .join("; ")
          .slice(0, 160),
        ...(tag ? { tags: tag } : {}),
        ...(held ? { held } : {}),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, o.max ?? 5);
}

/** True when the file answers a read within the time limit, tested in a child process (safe for /Volumes under launchd). */
export async function readableInTime(
  file: string,
  timeoutMs = 5000,
): Promise<boolean> {
  if (process.platform === "win32")
    return fs.access(file).then(
      () => true,
      () => false,
    );
  try {
    await exec(
      "/bin/sh",
      ["-c", 'test -r "$1" && head -c 1 "$1" >/dev/null', "sh", file],
      { timeout: timeoutMs, killSignal: "SIGKILL" },
    );
    return true;
  } catch {
    return false;
  }
}
