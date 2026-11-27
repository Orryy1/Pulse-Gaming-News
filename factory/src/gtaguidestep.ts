// The GTA guide's reads and files (GTA_GUIDES, src/gtaguide.ts): the owner's play evidence from the data folder, the
// topic history and the thumbnail's parts (a frame of the owner's own footage, lifted with APPLE_SUBJECT_LIFT when the
// Mac can, and the official GTA VI logo). Nothing here calls a model; nothing here stops a release: every miss falls
// back to what the long ranking already does.

import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "./lib/bin.ts";
import { errorMessage, log } from "./lib/util.ts";
import { listVodIndexes } from "./vodindex/schema.ts";
import { loadVodTags } from "./vodindex/tags.ts";
import { sourceByChannel, vodSources } from "./vodindex/sources.ts";
import { readAsks } from "./streamasks/job.ts";
import type { AskLike, PlayHudFact, PlayRecording } from "./gtaguide.ts";

const run = promisify(execFile);
const GTA6 = /grand theft auto vi\b|\bgta ?(6|vi)\b/i;

type Stretch = PlayRecording["stretches"][number];
const stretchesOf = (
  tags: { stretches?: Record<string, Stretch> } | undefined,
): Stretch[] => Object.values(tags?.stretches ?? {});

/**
 * Every GTA VI recording the factory knows, with its tags: the Mac's copies of the PC's (VOD_REMOTE, data/vodremote)
 * and this machine's own index (data/vodindex). Whose play it is comes from its channel (src/vodindex/sources.ts).
 */
export async function loadPlayRecordings(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlayRecording[]> {
  const sources = vodSources(env);
  const own = (channel: string | undefined) =>
    sourceByChannel(channel, sources)?.own ?? !channel;
  const out = new Map<string, PlayRecording>();
  const remote = path.join(dataDir, "vodremote");
  for (const f of await fsp.readdir(remote).catch(() => [] as string[])) {
    if (!f.endsWith(".json")) continue;
    try {
      const j = JSON.parse(
        await fsp.readFile(path.join(remote, f), "utf8"),
      ) as {
        index?: {
          vodId: string;
          title: string;
          game?: string;
          channel?: string;
          recordedOn?: string;
        };
        tags?: { stretches?: Record<string, Stretch> };
      };
      const i = j.index;
      if (!i?.vodId || !GTA6.test(`${i.game ?? ""} ${i.title}`)) continue;
      out.set(i.vodId, {
        vodId: i.vodId,
        title: i.title,
        recordedOn: i.recordedOn,
        own: own(i.channel),
        stretches: stretchesOf(j.tags),
      });
    } catch {
      // A half-written cache file is skipped; the next refresh rewrites it.
    }
  }
  for (const v of await listVodIndexes(dataDir).catch(() => [])) {
    if (out.has(v.vodId) || !GTA6.test(`${v.game} ${v.title}`)) continue;
    const tags = await loadVodTags(dataDir, v.vodId).catch(() => undefined);
    out.set(v.vodId, {
      vodId: v.vodId,
      title: v.title,
      recordedOn: v.recordedOn,
      own: own(v.channel),
      stretches: stretchesOf(
        tags as { stretches?: Record<string, Stretch> } | undefined,
      ),
    });
  }
  return [...out.values()].sort((a, b) =>
    (b.recordedOn ?? "").localeCompare(a.recordedOn ?? ""),
  );
}

/** The HUD reader's measured facts (data/hud/vods/<vod>/facts.json), read from the owner's own VOD folder. */
export async function loadHudFacts(
  dataDir: string,
  dates: Map<string, string> = new Map(),
): Promise<PlayHudFact[]> {
  const root = path.join(dataDir, "hud", "vods");
  const out: PlayHudFact[] = [];
  for (const vod of await fsp.readdir(root).catch(() => [] as string[])) {
    try {
      const facts = JSON.parse(
        await fsp.readFile(path.join(root, vod, "facts.json"), "utf8"),
      ) as Array<{
        text?: string;
        confidence?: number;
      }>;
      for (const f of Array.isArray(facts) ? facts : [])
        if (f.text)
          out.push({
            vodId: vod,
            text: f.text,
            confidence: f.confidence ?? 0,
            recordedOn: dates.get(vod),
          });
    } catch {
      // No facts for this recording yet.
    }
  }
  return out;
}

/** The stream asks for GTA VI (data/streamasks/asks.json). */
export async function loadGuideAsks(dataDir: string): Promise<AskLike[]> {
  const store = await readAsks(dataDir);
  return store.asks.filter((a) => GTA6.test(a.game ?? "")) as AskLike[];
}

// ---- The thumbnail's parts ------------------------------------------------------------------------------------------

/** Where the official logo comes from: Wikimedia Commons, the public-domain text logo (Rockstar's trademark). */
export const GTA_LOGO = {
  url: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Grand_Theft_Auto_VI_logo_%28with_gradient%29.svg/960px-Grand_Theft_Auto_VI_logo_%28with_gradient%29.svg.png",
  page: "https://commons.wikimedia.org/wiki/File:Grand_Theft_Auto_VI_logo_(with_gradient).svg",
  provenance:
    "Official Grand Theft Auto VI logo (Rockstar Games trademark), Wikimedia Commons file 'Grand Theft Auto VI logo (with gradient).svg', public-domain text logo",
};

/**
 * The official logo as a PNG in the episode folder: cached once under <data>/mentioncache/inworld/logos (the in-world
 * kit's cache), then copied. Undefined when it can't be had; the thumbnail then goes without the corner.
 */
export async function guideLogo(
  dataDir: string,
  episodeDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  const cache = path.join(
    dataDir,
    "mentioncache",
    "inworld",
    "logos",
    "grand-theft-auto-vi.png",
  );
  try {
    const have = await fsp.stat(cache).catch(() => undefined);
    if (!have || have.size < 2000) {
      const res = await fetchFn(GTA_LOGO.url, {
        headers: {
          "user-agent":
            "PulseGamingFactory/1.0 (licensed picture research; one request)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      // A PNG and nothing else: a challenge page saved as a logo would show on every thumbnail.
      if (
        !res.ok ||
        buf.length < 2000 ||
        buf.subarray(1, 4).toString("ascii") !== "PNG"
      )
        throw new Error(`logo fetch gave ${res.status}, ${buf.length} bytes`);
      await fsp.mkdir(path.dirname(cache), { recursive: true });
      await fsp.writeFile(cache, buf);
    }
    const rel = path.join("assets", "gta_vi_logo.png");
    await fsp.mkdir(path.join(episodeDir, "assets"), { recursive: true });
    await fsp.copyFile(cache, path.join(episodeDir, rel));
    return rel;
  } catch (err) {
    log("warn", "gta guide: official logo unavailable", {
      error: errorMessage(err),
    });
    return undefined;
  }
}

/** A clip as the frame picker reads it (the episode's assets_json.clips). */
export interface FrameClip {
  file: string;
  provenance?: string;
  durationSeconds?: number;
  startSeconds?: number;
}

/** Whose footage a clip is (pure): the owner's own stream or capture first, a permitted channel's next. */
export function clipOwner(
  c: Pick<FrameClip, "provenance">,
): "own" | "permitted" | "other" {
  const p = c.provenance ?? "";
  if (/^Pulse's own gameplay capture/.test(p)) return "own";
  if (/^Permitted stream capture/.test(p)) return "permitted";
  return "other";
}

/**
 * A clip a thumbnail may take a frame from (pure): live console play always carries the GTA VI HUD (radar, cash,
 * weapon, prompts), so only footage marked HUD-free qualifies (photo mode, a clean feed, HUD switched off). The 27 Nov
 * proof's thumbnail was a dark stream frame full of HUD text; with no clean frame the official key art is used.
 */
export function hudFreeClip(c: Pick<FrameClip, "provenance">): boolean {
  return /\b(hud off|hud-free|no hud|photo mode|clean feed)\b/i.test(c.provenance ?? "");
}

/**
 * How good a frame is for a thumbnail (pure): bright enough to read at 168x94, not blown out, and colourful (the style
 * is saturated). YAVG and SATAVG are ffmpeg signalstats' averages (0-255).
 */
export function frameScore(yavg: number, satavg: number): number {
  // Bright and clear: a murky frame (the 27 Nov proof's was) never makes a thumbnail.
  if (!(yavg >= 80 && yavg <= 205)) return -1;
  const light = 1 - Math.abs(yavg - 125) / 125;
  return light * 0.5 + Math.min(1, satavg / 90) * 0.5;
}

async function frameStats(
  file: string,
): Promise<{ yavg: number; satavg: number } | undefined> {
  try {
    const r = await run(
      FFMPEG,
      [
        "-hide_banner",
        "-i",
        file,
        "-vf",
        "signalstats,metadata=print:file=-",
        "-f",
        "null",
        "-",
      ],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    const t = `${r.stdout}${r.stderr}`;
    const y = Number(t.match(/YAVG=([\d.]+)/)?.[1]);
    const s = Number(t.match(/SATAVG=([\d.]+)/)?.[1]);
    return Number.isFinite(y) && Number.isFinite(s)
      ? { yavg: y, satavg: s }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The thumbnail frame: the best frame of the owner's own clips (a permitted channel's when he has none in this
 * video), three frames a clip from up to eight clips, written to assets/guide_frame.jpg. With `lift` (APPLE_SUBJECT_LIFT
 * on the Mac) the best three are tried for a clean subject cut-out, and the first that gives one wins.
 */
export async function pickGuideFrame(
  episodeDir: string,
  clips: FrameClip[],
  lift?: (file: string) => Promise<{ fg: string; x?: number } | undefined>,
): Promise<
  | { file: string; fg?: string; x?: number; owner: "own" | "permitted" }
  | undefined
> {
  const clean = clips.filter(hudFreeClip);
  const own = clean.filter((c) => clipOwner(c) === "own");
  const pool = (
    own.length ? own : clean.filter((c) => clipOwner(c) === "permitted")
  ).slice(0, 8);
  if (!pool.length) return undefined;
  const owner = own.length ? "own" : "permitted";
  const dir = path.join(episodeDir, "assets", "guideframes");
  await fsp.mkdir(dir, { recursive: true });
  const found: Array<{ file: string; score: number }> = [];
  for (const [k, c] of pool.entries()) {
    const dur = Math.max(1, c.durationSeconds ?? 4);
    for (const at of [0.3, 0.55, 0.8]) {
      const rel = path.join(
        "assets",
        "guideframes",
        `f${k}_${Math.round(at * 100)}.jpg`,
      );
      try {
        await run(
          FFMPEG,
          [
            "-loglevel",
            "error",
            "-y",
            "-ss",
            (dur * at).toFixed(2),
            "-i",
            path.join(episodeDir, c.file),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            path.join(episodeDir, rel),
          ],
          { timeout: 60_000, windowsHide: true },
        );
        const st = await frameStats(path.join(episodeDir, rel));
        if (st)
          found.push({ file: rel, score: frameScore(st.yavg, st.satavg) });
      } catch {
        // A clip that won't cut is skipped.
      }
    }
  }
  const ranked = found
    .filter((f) => f.score >= 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return undefined;
  const pick = async (
    f: { file: string },
    cut?: { fg: string; x?: number },
  ) => {
    const rel = path.join("assets", "guide_frame.jpg");
    await fsp.copyFile(
      path.join(episodeDir, f.file),
      path.join(episodeDir, rel),
    );
    return {
      file: rel,
      owner,
      ...(cut
        ? { fg: cut.fg, ...(cut.x !== undefined ? { x: cut.x } : {}) }
        : {}),
    } as const;
  };
  if (lift)
    for (const f of ranked.slice(0, 3)) {
      const cut = await lift(f.file).catch(() => undefined);
      if (cut) return pick(f, cut);
    }
  return pick(ranked[0]!);
}

/**
 * The verdict's numbers (src/gtaguide.ts gtaGuideVerdict): every long video the "gta_guide" event put in an arm, once
 * published with its 7-day views in, and its thumbnail click-through where the reach reports have one.
 */
export async function gtaGuideResults(db: import("./db.ts").Db): Promise<import("./gtaguide.ts").GuideResult[]> {
  const rows = await db.query<{ arm: string; v7: number | null; ctr: unknown }>(
    `SELECT DISTINCT ON (e.id) v.detail->>'arm' AS arm,
            (SELECT m.views FROM video_metrics m WHERE m.episode_id = e.id AND m.label = '7d') AS v7,
            (SELECT m.raw->'ctr' FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'ctr') AS ctr
       FROM events v JOIN episodes e ON e.id = v.episode_id
      WHERE v.kind = 'gta_guide' AND v.detail->>'arm' IN ('guide','ranking')
        AND e.status = 'published' AND e.youtube_video_id IS NOT NULL
      ORDER BY e.id`,
  );
  return rows
    .filter((r) => r.v7 !== null)
    .map((r) => {
      const ctr = Number(typeof r.ctr === "string" ? JSON.parse(r.ctr) : r.ctr);
      return {
        arm: r.arm as "guide" | "ranking",
        views7d: Number(r.v7),
        ...(Number.isFinite(ctr) && r.ctr !== null ? { ctr } : {}),
      };
    });
}
