// Original 3D for long videos (BLENDER_SCENES): Blender scenes rendered on the PC's 4090 (factory/blender, run by
// src/render/blenderrun.ts behind the PC service in src/render/blenderserve.ts) and dropped in place of the flat
// graphic they replace. A ranking's entry reveals get the podium, a documentary's breathers the chapter card and
// its chapters the case-file desk, a bar chart the 3D bars, a timeline the timeline, a map the globe, and a
// ranking ends on the Pulse ident.
//
// Planning is pure (planBlender). Fetching never fails a video: a clip that is not back in time, a PC that does
// not answer, or a render that fails just leaves that beat with its usual graphic.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { log, errorMessage, fetchWithTimeout } from "../lib/util.ts";
import type { Segment } from "./timeline.ts";
import { rankedRows } from "./components/packs/data/figures.ts";
import { placeFor } from "./places.ts";

export type BlenderScene =
  | "podium"
  | "data"
  | "chapter"
  | "desk"
  | "globe"
  | "sting";
export type BlenderRole =
  | "rank"
  | "chapter"
  | "desk"
  | "data"
  | "globe"
  | "sting";

/** Bumped whenever a scene's look changes, so cached clips of the old look are not reused. */
export const KIT_VERSION = 1;

/**
 * A look version for one scene in one layout, bumped when only that look changes, so the other scenes' cached clips
 * keep their keys (pure). 2: the vertical podium reads from 0.5 s, clear of a Short's captions (20 Nov 2026).
 */
export function lookVersion(scene: BlenderScene, params: Record<string, unknown>): number | undefined {
  return scene === "podium" && params.vertical === true ? 2 : undefined;
}

/**
 * Minutes of PC time one clip takes, render and encode, measured on the RTX 4090 (19-20 Nov 2026 proof run) with
 * some headroom: what the per-video cap counts and what the orchestrator lease asks for.
 */
export const EST_MINUTES: Record<BlenderScene, number> = {
  podium: 1.5,
  chapter: 1.5,
  data: 2,
  desk: 2,
  globe: 2,
  sting: 1,
};

export interface BlenderSettings {
  on: boolean;
  /** Share of eligible beats that get a clip (0..1), decided per beat from the episode id. */
  share: number;
  /** Most PC minutes one video's clips may ask for (EST_MINUTES summed). */
  capMinutes: number;
  /** The PC service (src/render/blenderserve.ts). */
  url: string;
  /** How long a video waits for its clips before it renders with what it has. */
  waitMinutes: number;
}

/** BLENDER_SCENES (default off), BLENDER_SHARE (default 1), BLENDER_CAP_MINUTES (default 15), BLENDER_URL and
 * BLENDER_WAIT_MINUTES (default 8). Pure. */
export function blenderSettings(
  env: Record<string, string | undefined>,
  platform: string = process.platform,
): BlenderSettings {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
  };
  return {
    on: /^(1|true|yes|on)$/i.test(env.BLENDER_SCENES ?? ""),
    share: Math.max(0, Math.min(1, num(env.BLENDER_SHARE, 1))),
    capMinutes: Math.max(0, num(env.BLENDER_CAP_MINUTES, 15)),
    // The PC itself, or the PC over the Mac cable (10.77.0.1, the address the other PC services use).
    url: (
      env.BLENDER_URL ||
      (platform === "win32" ? "http://127.0.0.1:8797" : "http://10.77.0.1:8797")
    ).replace(/\/$/, ""),
    waitMinutes: Math.max(1, num(env.BLENDER_WAIT_MINUTES, 8)),
  };
}

export interface BlenderRequest {
  /** Hash of the scene, its parameters and the kit version: the cache name. */
  key: string;
  scene: BlenderScene;
  role: BlenderRole;
  /** Scene parameters (not the output folder or machine paths). */
  params: Record<string, unknown>;
  /** Pictures the scene shows, relative to the episode folder (sent with the request). */
  images?: string[];
  /** Where it goes in the video and for how long, seconds. */
  at: number;
  seconds: number;
  /** The segment it belongs to (rank, chapter, desk), or the sentence it replaces (data, globe). */
  segment?: number;
  entry?: number;
  moment?: number;
}

/** A clip ready for the render, as the long composition takes it. */
export interface BlenderClip {
  file: string;
  at: number;
  seconds: number;
  role: BlenderRole;
  segment?: number;
  entry?: number;
  moment?: number;
}

/** The cache key of a scene and its parameters (pure; key order does not matter). */
export function blenderKey(
  scene: BlenderScene,
  params: Record<string, unknown>,
  seconds: number,
): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
          )
        : v;
  return createHash("sha1")
    .update(
      JSON.stringify([
        KIT_VERSION,
        scene,
        Number(seconds.toFixed(2)),
        canon(params),
        // Only a scene with its own look version adds it, so every other key stays as it was.
        ...(lookVersion(scene, params) === undefined ? [] : [lookVersion(scene, params)]),
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}

/** Whether a beat is in the BLENDER_SHARE (pure): the same episode and beat always land the same way. */
export function inShare(
  episodeId: string,
  beat: string,
  share: number,
): boolean {
  if (share >= 1) return true;
  if (share <= 0) return false;
  const n = createHash("sha1")
    .update(`blender:${episodeId}:${beat}`)
    .digest()
    .readUInt16BE(0);
  return n / 65536 < share;
}

export interface PlanImage {
  file: string;
  kind: string;
  beatIndex?: number;
}

export interface BlenderPlanInput {
  episodeId: string;
  documentary: boolean;
  segments: Segment[];
  /** Sentence windows (src/render/longplan.ts momentWindows) and each sentence's graphic. */
  windows?: Array<{
    entry: number;
    moment: number;
    start: number;
    end: number;
  }>;
  graphicOf?: (
    entry: number,
    moment: number,
  ) =>
    | { kind: string; primary: string; secondary: string; items?: string[]; gameMap?: unknown }
    | undefined;
  /** A documentary's breathers (seconds), each opening a chapter. */
  breaks?: Array<{ start: number; end: number }>;
  images?: PlanImage[];
  /** Which entry a segment belongs to (src/render/longplan.ts entryOf). */
  entryOf: (segmentIndex: number) => number | undefined;
  durationSeconds: number;
  /** When the narration ends (the last word), seconds. */
  narrationEnd: number;
  settings: Pick<BlenderSettings, "share" | "capMinutes">;
  /** The channel accent (brand amber unless the video has its own). */
  accent?: string;
  /** The title drop fills the first chapter's breather (src/render/structure.ts): no 3D card there. */
  titleDrop?: boolean;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const DESK_KINDS = new Set([
  "photo",
  "portrait",
  "article",
  "screenshot",
  "hero",
]);
/** What goes first when the cap runs out: the reveals carry a ranking, the breathers a documentary. */
const PRIORITY: BlenderRole[] = [
  "rank",
  "chapter",
  "data",
  "globe",
  "desk",
  "sting",
];

/** A timeline graphic's items as years and events ("2013: GTA V launches"), or undefined when they do not read. */
export function timelineItems(
  items: string[] | undefined,
): Array<{ year: string; label: string }> | undefined {
  const rows = (items ?? [])
    .map((x) => /^\s*((?:19|20)\d\d)\s*[:\-–]\s*(.+)$/.exec(x))
    .filter(Boolean) as RegExpExecArray[];
  if (rows.length < 3 || rows.length !== (items ?? []).length) return undefined;
  return rows.slice(0, 8).map((m) => ({ year: m[1]!, label: m[2]!.trim() }));
}

/** Which beats of a long video get a Blender clip, in time order, within the share and the cap (pure). */
export function planBlender(input: BlenderPlanInput): BlenderRequest[] {
  const { segments, settings, episodeId } = input;
  const accent = input.accent;
  const out: BlenderRequest[] = [];
  const add = (r: Omit<BlenderRequest, "key">) => {
    const params = accent ? { ...r.params, accent } : r.params;
    out.push({
      ...r,
      params,
      key: blenderKey(
        r.scene,
        { ...params, images: r.images ?? [] },
        r.seconds,
      ),
    });
  };
  const breakAt = (t: number) =>
    (input.breaks ?? []).find((b) => Math.abs(b.start - t) <= 0.15);
  const ranks = segments.filter(
    (s) => s.kind === "beat" && s.visual?.kind === "rank",
  ).length;
  // Chapter cards come as a set or not at all: every break should read as the same kind of break (owner, 5 Nov).
  const chapterSet = inShare(episodeId, "chapters", settings.share);
  for (const [i, s] of segments.entries()) {
    if (s.kind !== "beat" || !s.visual) continue;
    const v = s.visual;
    if (v.kind === "rank" && v.value_a) {
      const len = s.end - s.start;
      if (len < 5 || !inShare(episodeId, `rank:${i}`, settings.share)) continue;
      // " | ", not " · ": the 3D scenes' Inter font has no middle dot and drew "2017 ? SWITCH" (20 Nov 2026).
      const meta = [v.items?.[0], v.items?.[1]].filter(Boolean).join(" | ");
      add({
        scene: "podium",
        role: "rank",
        params: {
          rank: v.value_a,
          title: v.primary,
          ...(meta ? { meta } : {}),
          ...(ranks ? { kicker: `Number ${v.value_a} of ${ranks}` } : {}),
        },
        at: s.start,
        seconds: clamp(len - 1, 3.5, 4.5),
        segment: i,
      });
    }
    if (v.kind === "chapter") {
      const entry = input.entryOf(i);
      const br = breakAt(s.start);
      const pause = br ? br.end - br.start : 0;
      // Only a breather the clip can fill exactly (the card replaces the breather's own graphic).
      const firstChapter =
        segments.findIndex(
          (x) => x.kind === "beat" && x.visual?.kind === "chapter",
        ) === i;
      if (
        input.documentary &&
        chapterSet &&
        pause >= 3 &&
        pause <= 8 &&
        !(input.titleDrop && firstChapter)
      ) {
        add({
          scene: "chapter",
          role: "chapter",
          params: {
            number: v.value_a ?? (entry ?? 0) + 1,
            title: v.primary,
            ...(v.items?.[0] ? { year: v.items[0] } : {}),
          },
          at: s.start,
          seconds: pause,
          segment: i,
        });
      }
      const pics = (input.images ?? [])
        .filter((im) => im.beatIndex === entry && DESK_KINDS.has(im.kind))
        .slice(0, 4);
      const body = s.end - s.start - pause;
      if (
        input.documentary &&
        pics.length >= 2 &&
        body >= 12 &&
        inShare(episodeId, `desk:${i}`, settings.share)
      ) {
        add({
          scene: "desk",
          role: "desk",
          params: { title: v.secondary || v.primary },
          images: pics.map((p) => p.file.split(path.sep).join("/")),
          at: s.start + pause,
          seconds: 5.5,
          segment: i,
          entry,
        });
      }
    }
  }
  for (const w of input.windows ?? []) {
    const g = input.graphicOf?.(w.entry, w.moment);
    if (!g) continue;
    const len = w.end - w.start;
    // The clip must fit inside its sentence, or it would cover the next one's picture.
    if (len < 4.5) continue;
    const beat = `${w.entry}:${w.moment}`;
    if (g.kind === "bars") {
      const rows = rankedRows(g.items);
      if (
        rows.length < 2 ||
        !inShare(episodeId, `data:${beat}`, settings.share)
      )
        continue;
      add({
        scene: "data",
        role: "data",
        params: {
          mode: "bars",
          ...(g.primary ? { title: g.primary } : {}),
          items: rows.map((r) => ({
            label: r.label,
            value: r.fig.scaled,
            display: r.fig.text,
          })),
        },
        at: w.start,
        seconds: Math.min(len, 7),
        entry: w.entry,
        moment: w.moment,
      });
    } else if (g.kind === "timeline" || g.kind === "milestone") {
      const items = timelineItems(g.items);
      if (!items || !inShare(episodeId, `data:${beat}`, settings.share))
        continue;
      add({
        scene: "data",
        role: "data",
        params: {
          mode: "timeline",
          ...(g.primary ? { title: g.primary } : {}),
          items,
        },
        at: w.start,
        seconds: Math.min(len, 7),
        entry: w.entry,
        moment: w.moment,
      });
    } else if (g.kind === "map" && !g.gameMap) {
      const places = (g.items ?? [])
        .map((x) => ({ name: x, p: placeFor(x) }))
        .filter((x) => x.p);
      if (!places.length || places.length !== (g.items ?? []).length) continue;
      if (!inShare(episodeId, `globe:${beat}`, settings.share)) continue;
      add({
        scene: "globe",
        role: "globe",
        params: {
          pins: places.map(({ name, p }) => ({
            lat: p!.lat,
            lon: p!.lon,
            label: name,
          })),
          countries: [...new Set(places.map(({ p }) => p!.country))],
        },
        at: w.start,
        seconds: Math.min(len, 7),
        entry: w.entry,
        moment: w.moment,
      });
    }
  }
  // The ident (scene "sting") is not planned into videos: a ranking's last seconds carry the end line
  // (OutroCard), and a documentary has its own end card. It is for openers, end screens and Shorts.

  // Within the cap, most valuable first; then no two clips on screen at once (earlier wins).
  const ranked = [...out].sort(
    (a, b) =>
      PRIORITY.indexOf(a.role) - PRIORITY.indexOf(b.role) || a.at - b.at,
  );
  const kept: BlenderRequest[] = [];
  let minutes = 0;
  for (const r of ranked) {
    const cost = EST_MINUTES[r.scene];
    if (minutes + cost > settings.capMinutes) continue;
    if (kept.some((k) => r.at < k.at + k.seconds && k.at < r.at + r.seconds))
      continue;
    kept.push(r);
    minutes += cost;
  }
  return kept.sort((a, b) => a.at - b.at);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A response body read under a deadline: fetchWithTimeout stops timing once the headers arrive. */
async function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        t = setTimeout(
          () =>
            reject(new Error(`body not read in ${Math.round(ms / 1000)} s`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

/** A request's key with its pictures' contents in it, so the same file names in another episode (or a picture
 * replaced under the same name) never reuse a clip of other pictures (pure). */
export function contentKey(r: BlenderRequest, hashes: string[]): string {
  return hashes.length
    ? blenderKey(r.scene, { ...r.params, images: hashes }, r.seconds)
    : r.key;
}

/**
 * The clips for a plan, in the episode folder (assets/blender/<key>.mp4): cached ones straight away, the rest
 * asked of the PC service at once and collected until the wait runs out. Whatever is missing then is left out,
 * and if any chapter card is missing none of them are used (the breathers stay one look). Never throws.
 */
export async function fetchBlenderClips(
  plan: BlenderRequest[],
  settings: Pick<BlenderSettings, "url" | "waitMinutes">,
  episodeDir: string,
  opts: {
    fetchImpl?: typeof fetchWithTimeout;
    pollMs?: number;
    now?: () => number;
  } = {},
): Promise<BlenderClip[]> {
  const get = opts.fetchImpl ?? fetchWithTimeout;
  const now = opts.now ?? Date.now;
  const dir = path.join(episodeDir, "assets", "blender");
  const done = new Map<BlenderRequest, BlenderClip>();
  const clipOf = (r: BlenderRequest, key: string): BlenderClip => ({
    file: `assets/blender/${key}.mp4`,
    at: r.at,
    seconds: r.seconds,
    role: r.role,
    ...(r.segment !== undefined ? { segment: r.segment } : {}),
    ...(r.entry !== undefined ? { entry: r.entry } : {}),
    ...(r.moment !== undefined ? { moment: r.moment } : {}),
  });
  const have = async (k: string) =>
    ((await fs.stat(path.join(dir, `${k}.mp4`)).catch(() => undefined))?.size ??
      0) > 10_000;
  try {
    await fs.mkdir(dir, { recursive: true });
    const asked = new Map<string, BlenderRequest>();
    let reachable = true;
    for (const r of plan) {
      const images: Array<{ name: string; b64: string }> = [];
      const hashes: string[] = [];
      for (const f of r.images ?? []) {
        const buf = await fs
          .readFile(path.join(episodeDir, f))
          .catch(() => undefined);
        if (!buf || buf.length >= 12 * 1024 * 1024) continue;
        images.push({ name: path.basename(f), b64: buf.toString("base64") });
        hashes.push(createHash("sha1").update(buf).digest("hex").slice(0, 16));
      }
      const key = contentKey(r, hashes);
      if (await have(key)) {
        done.set(r, clipOf(r, key));
        continue;
      }
      if (!reachable) continue;
      const res = await get(
        `${settings.url}/render`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            key,
            scene: r.scene,
            seconds: r.seconds,
            params: r.params,
            images,
          }),
        },
        30_000,
      ).catch((err: unknown) => {
        log("warn", "3D clip request failed; the beat keeps its graphic", {
          scene: r.scene,
          error: errorMessage(err),
        });
        return undefined;
      });
      if (!res) {
        reachable = false; // the service does not answer: no point asking for the rest
        continue;
      }
      if (!res.ok) {
        log("warn", "3D clip refused", { scene: r.scene, status: res.status });
        continue;
      }
      asked.set(key, r);
    }
    const until = now() + settings.waitMinutes * 60_000;
    const unknown = new Map<string, number>();
    let errors = 0;
    while (asked.size && now() < until && errors < 3) {
      for (const [k, r] of [...asked]) {
        let st: { state: string; error?: string } | undefined;
        try {
          const x = await get(`${settings.url}/status/${k}`, {}, 15_000);
          st = x.ok
            ? await within(
                x.json() as Promise<{ state: string; error?: string }>,
                15_000,
              )
            : undefined;
          errors = 0;
        } catch {
          errors++;
        }
        if (!st) continue;
        if (st.state === "failed") {
          asked.delete(k);
          log("warn", "3D clip render failed; the beat keeps its graphic", {
            key: k,
            error: st.error,
          });
        } else if (st.state === "unknown") {
          // The service no longer knows the job (it restarted): lost.
          const n = (unknown.get(k) ?? 0) + 1;
          unknown.set(k, n);
          if (n >= 2) asked.delete(k);
        } else if (st.state === "done") {
          asked.delete(k);
          try {
            const clip = await get(`${settings.url}/clip/${k}.mp4`, {}, 60_000);
            if (!clip.ok) continue;
            const buf = Buffer.from(await within(clip.arrayBuffer(), 180_000));
            const len = Number(
              clip.headers.get("content-length") ?? buf.length,
            );
            if (buf.length > 10_000 && buf.length === len) {
              const tmp = path.join(dir, `${k}.part`);
              await fs.writeFile(tmp, buf);
              await fs.rename(tmp, path.join(dir, `${k}.mp4`));
              done.set(r, clipOf(r, k));
            }
          } catch (err) {
            log("warn", "3D clip download failed; the beat keeps its graphic", {
              key: k,
              error: errorMessage(err),
            });
          }
        }
      }
      if (asked.size) await sleep(opts.pollMs ?? 10_000);
    }
    if (asked.size)
      log(
        "info",
        "3D clips not back in time; those beats keep their graphics",
        { missing: asked.size },
      );
  } catch (err) {
    log("warn", "3D clips skipped", { error: errorMessage(err) });
  }
  const chapters = plan.filter((r) => r.role === "chapter");
  const allChapters = chapters.every((r) => done.has(r));
  return plan
    .filter((r) => done.has(r) && (r.role !== "chapter" || allChapters))
    .map((r) => done.get(r)!);
}
