// The Mac's side of the stream recordings served by the PC (VOD_REMOTE, src/vodindex/serve.ts). The recordings stay
// on the PC; the Mac keeps only each ready recording's index and tags (a few megabytes, refreshed when the PC's copy
// changes), asks the PC for each line's meaning scores (the shot vectors stay there) and fetches only the few seconds
// a line uses, cut on the PC. Nothing here touches /Volumes or YouTube. The PC off or slow: no recordings, and the
// footage search carries on with its other sources.

import fs from "node:fs/promises";
import path from "node:path";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import type { FootageTarget } from "../assets/clipscore.ts";
import type { OwnStreamDeps, Scorer } from "../semantic/hook.ts";
import { parseVodIndex, type VodIndex } from "./schema.ts";
import type { VodTagFile } from "./tags.ts";

export interface RemoteListing {
  vodId: string;
  channel: string;
  builtAt: string;
  /** tags.json's time on the PC: a re-tag refreshes the Mac's copy even when the index is unchanged. */
  tagsStamp?: number;
}

/** A /vod/score answer as a scorer (pure): per line, each shot's score by its id; null scores are left out. */
export function scorerFrom(
  scores: Record<string, Array<number | null>> | undefined,
): Scorer | undefined {
  if (!scores || !Object.keys(scores).length) return undefined;
  const byKey = new Map<string, Map<number, number>>();
  for (const [key, list] of Object.entries(scores)) {
    if (!Array.isArray(list)) continue;
    const m = new Map<number, number>();
    list.forEach((x, id) => {
      if (typeof x === "number" && Number.isFinite(x)) m.set(id, x);
    });
    byKey.set(key, m);
  }
  return (t: FootageTarget) => byKey.get(t.key);
}

/** The cached copy's file for a recording (pure). */
export const remoteCacheFile = (cacheDir: string, vodId: string) =>
  path.join(cacheDir, `${vodId.replace(/[^\w-]/g, "_")}.json`);

export interface RemoteDeps {
  fetch?: typeof fetchWithTimeout;
}

/**
 * ownStreamClips's sources for the PC's recordings (src/semantic/hook.ts OwnStreamDeps). `base` is GAMELIB_REMOTE
 * ("http://10.77.0.1:8793"); `cacheDir` keeps the indexes (<data>/vodremote).
 */
export function remoteVodDeps(
  base: string,
  cacheDir: string,
  deps: RemoteDeps = {},
): OwnStreamDeps {
  const get = deps.fetch ?? fetchWithTimeout;
  const root = base.replace(/\/$/, "");
  const tags = new Map<string, VodTagFile>();
  return {
    readable: async () => true,
    list: async () => {
      let listing: RemoteListing[];
      try {
        const res = await get(`${root}/vod/list`, {}, 15_000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        listing = (await res.json()) as RemoteListing[];
      } catch (err) {
        log(
          "info",
          "stream recordings: the PC's list did not answer, none used",
          { error: errorMessage(err) },
        );
        return [];
      }
      await fs.mkdir(cacheDir, { recursive: true });
      const out: VodIndex[] = [];
      for (const l of listing) {
        const file = remoteCacheFile(cacheDir, l.vodId);
        let raw: { index?: unknown; tags?: VodTagFile; tagsStamp?: number } | undefined = await fs
          .readFile(file, "utf8")
          .then((t) => JSON.parse(t))
          .catch(() => undefined);
        if (
          (raw?.index as { builtAt?: string } | undefined)?.builtAt !== l.builtAt ||
          (raw?.tagsStamp ?? 0) !== (l.tagsStamp ?? 0)
        ) {
          try {
            const res = await get(
              `${root}/vod/index?vod=${encodeURIComponent(l.vodId)}`,
              {},
              90_000,
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            raw = { ...((await res.json()) as object), tagsStamp: l.tagsStamp ?? 0 };
            const tmp = `${file}.${process.pid}.tmp`;
            await fs.writeFile(tmp, JSON.stringify(raw));
            await fs.rename(tmp, file);
          } catch (err) {
            log("info", "stream recordings: an index did not come", {
              vod: l.vodId,
              error: errorMessage(err),
            });
            raw = undefined;
          }
        }
        const v = parseVodIndex(raw?.index);
        if (!v || raw?.tags?.version !== 1) continue;
        tags.set(v.vodId, raw.tags);
        out.push(v);
      }
      // Copies of recordings the PC no longer serves go.
      const keep = new Set(
        listing.map((l) => path.basename(remoteCacheFile(cacheDir, l.vodId))),
      );
      for (const f of await fs.readdir(cacheDir).catch(() => [] as string[]))
        if (f.endsWith(".json") && !keep.has(f))
          await fs
            .rm(path.join(cacheDir, f), { force: true })
            .catch(() => undefined);
      return out;
    },
    tags: async (v) => tags.get(v.vodId) ?? { version: 1, stretches: {} },
    scorer: async (v, targets) => {
      const res = await get(
        `${root}/vod/score`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            vod: v.vodId,
            builtAt: v.builtAt,
            targets: targets.map((t) => ({
              key: t.key,
              text: t.text,
              keywords: t.keywords ?? [],
            })),
          }),
        },
        120_000,
      );
      if (!res.ok) return undefined;
      return scorerFrom(
        (
          (await res.json()) as {
            scores?: Record<string, Array<number | null>>;
          }
        ).scores,
      );
    },
    cut: async (v, from, to, file) => {
      const res = await get(
        `${root}/vod/clip?vod=${encodeURIComponent(v.vodId)}&from=${from.toFixed(2)}&to=${to.toFixed(2)}`,
        {},
        300_000,
      );
      if (!res.ok)
        throw new Error(`the PC did not cut the clip: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error("the PC sent an empty clip");
      const tmp = `${file}.part`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, file);
    },
  };
}
