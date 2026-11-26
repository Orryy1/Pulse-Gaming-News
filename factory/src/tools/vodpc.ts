// The stream recordings on the PC (owner, 25 Nov 2026): every channel's folder (src/vodindex/sources.ts) indexed,
// tagged and given its meaning vectors, so the game library server can serve them to the Mac (src/vodindex/serve.ts).
//   node --import tsx src/tools/vodpc.ts index [--hours 3] [--only v1,v2]   index what is not done yet, owner's channel first
//   node --import tsx src/tools/vodpc.ts status                  each recording's progress
//   node --import tsx src/tools/vodpc.ts prune [--days 10] [--dry]  recordings older than that, fully indexed, archived to the Mac
//   node --import tsx src/tools/vodpc.ts search "<game>" "<line>"   the moments a line finds (held ones marked)
// The heavy part (Whisper, the vision model, SigLIP) runs through the orchestrator, from windows/vod-daily.ps1:
//   C:\Claude\orchestrator\orch.cmd run --class gpu --project pulse --kind pulse:vodindex --priority 20 --est 140 -- node --import tsx src/tools/vodpc.ts index
// VOD_DATA_DIR (default C:/pulse-vods/data) holds the indexes; the recordings are never changed here, only moved by
// prune to the Mac mini's USB drive once old and indexed (src/vodindex/archive.ts).

import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { loadSceneIndex } from "../sceneindex/schema.ts";
import { Embedder } from "../semantic/embed.ts";
import {
  loadFailedShots,
  loadShotVectors,
  unembedded,
  vectorFile,
} from "../semantic/shots.ts";
import {
  openVodIndex,
  probeDuration,
  undescribedVod,
  vodIndexStep,
} from "../vodindex/build.ts";
import {
  loadVodIndex,
  parseVodName,
  saveVodIndex,
  vodIndexDir,
  type VodIndex,
} from "../vodindex/schema.ts";
import {
  vodServeContext,
  readyRecordings,
  pruneClips,
  vodReady,
} from "../vodindex/serve.ts";
import { vodSources, type VodSource } from "../vodindex/sources.ts";
import {
  archivePath,
  archiveRecording,
  floorFor,
  roomFor,
  sshArchiveDeps,
} from "../vodindex/archive.ts";
import { findVodMoments, loadVodTags, untagged } from "../vodindex/tags.ts";
import {
  detectGame,
  listRecordings,
  type Recording,
} from "../vodindex/vods.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const plain = args.filter(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
const [cmd, a1, a2] = plain;
const cfg = loadConfig();
const sources = vodSources(process.env);
const ctx = vodServeContext(process.env, { model: cfg.semantic.model });
const dataDir = path.resolve(flag("data") ?? ctx.dataDir);
const known = [...cfg.streamAsks.games, ...cfg.ownerGames];

/** Every finished recording of every channel, owner's channel first, newest first within each. */
async function recordings(): Promise<Array<Recording & { source: VodSource }>> {
  const out: Array<Recording & { source: VodSource }> = [];
  for (const source of sources)
    for (const r of await listRecordings(source.dir, known)) {
      // A download still being written (a yt-dlp or ffmpeg work file, or changed in the last two minutes) waits.
      if (
        /\.(temp|part|ytdl)(\.|$)/i.test(path.basename(r.file)) ||
        Date.now() - r.mtimeMs < 120_000 ||
        path.basename(r.file).toLowerCase().startsWith("partial-")
      )
        continue;
      // A title naming no game is the default game only on a permitted channel (his cousin's "Chapter 3" titles);
      // the owner streams other games too, so his untitled ones wait for a game set by hand.
      const game = r.game ?? (source.own ? undefined : source.defaultGame);
      if (!game) continue;
      out.push({ ...r, game, source });
    }
  return out;
}

function progress(v: VodIndex, tagsLeft: number, vectorsLeft: number): string {
  const described = v.shots.filter((s) => s.desc && s.desc !== "-").length;
  const covered = Math.round(v.coverage.reduce((n, c) => n + c.to - c.from, 0));
  return `${v.vodId} [${v.channel ?? "tinotv"}] ${v.game}: covered ${covered}/${Math.round(v.duration)} s, ${v.shots.length} shots, ${described} described, ${undescribedVod(v).length} to describe, ${tagsLeft} stretches to tag, ${vectorsLeft} vectors to make`;
}

async function left(v: VodIndex): Promise<{ tags: number; vectors: number }> {
  const file = vectorFile(vodIndexDir(dataDir, v.vodId), cfg.semantic.model);
  return {
    tags: untagged(v, await loadVodTags(dataDir, v.vodId)).length,
    vectors: unembedded(
      v.shots,
      await loadShotVectors(file),
      await loadFailedShots(file),
    ).length,
  };
}

// The disk floor first: nothing new is written to D: below VOD_MIN_FREE_GB (320) free (the Lore Lodge stops at 300).
const floor = cmd === "index" ? await roomFor(dataDir, 200e6, floorFor(dataDir, process.env)) : { ok: true as const };
if (!floor.ok) {
  console.log(`index ${"why" in floor ? floor.why : "refused"}`);
  process.exitCode = 3;
} else if (cmd === "index") {
  const until = Date.now() + Number(flag("hours") ?? 3) * 3_600_000;
  const sem = cfg.semantic;
  const embedder = new Embedder({
    python: sem.python,
    model: sem.model,
    device: sem.device,
    cacheDir: path.join(dataDir, "semantic"),
    idleSeconds: 60,
    priority: 20,
  });
  try {
    // --only v1,v2: just those recordings (a proof, or one still being re-downloaded left out).
    const only = flag("only")
      ?.split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    for (const r of await recordings()) {
      if (Date.now() > until) break;
      if (only && !only.includes(r.vodId)) continue;
      // A recording replaced by a copy of another length (a short download re-fetched whole): its old index's times
      // no longer fit, so it is built again from the start.
      const had = await loadVodIndex(dataDir, r.vodId);
      if (had) {
        const now = await probeDuration(r.file).catch(() => 0);
        if (now > 0 && Math.abs(now - had.duration) > 30) {
          console.log(
            `${r.vodId}: the recording is now ${Math.round(now)} s, its index was made for ${Math.round(had.duration)} s: built again`,
          );
          await fs.rm(vodIndexDir(dataDir, r.vodId), {
            recursive: true,
            force: true,
          });
        }
      }
      // The channel goes on the index first: the credit, the order and the facecam rule all read it. Streams are
      // tagged by the half-minute stretch, not described shot by shot (VOD_DESCRIBE=shots for the old way).
      const v0 = await openVodIndex(r.file, r.game!, { dataDir });
      // An index already tagged keeps its mode: switching would re-cut its stretches and tag them again.
      const tagged = Object.keys((await loadVodTags(dataDir, v0.vodId)).stretches).length > 0;
      const describe = tagged
        ? v0.describe
        : process.env.VOD_DESCRIBE === "shots"
          ? undefined
          : ("stretch" as const);
      if (v0.channel !== r.source.channel || v0.describe !== describe) {
        const { describe: _old, ...rest } = v0;
        await saveVodIndex(dataDir, {
          ...rest,
          channel: r.source.channel,
          ...(describe ? { describe } : {}),
        });
      }
      const places =
        (await loadSceneIndex(dataDir, r.game!).catch(() => undefined))
          ?.places ?? [];
      for (let i = 0; i < 100000 && Date.now() < until; i++) {
        const step = await vodIndexStep(r.file, r.game!, {
          dataDir,
          whisperPython: cfg.whisperPython,
          ocrFps: cfg.streamAsks.ocrFps,
          chunkSeconds: cfg.streamAsks.chunkMinutes * 60,
          describeBatch: cfg.streamAsks.describeBatch,
          tags: {
            batch: sem.vodTagsBatch,
            places,
            embedder,
            model: sem.model,
            embedBatch: sem.shotsPerTurn,
          },
        });
        const l = await left(step.index);
        console.log(
          `${new Date().toISOString().slice(11, 19)} ${step.did}: ${progress(step.index, l.tags, l.vectors)}`,
        );
        if (step.did === "done" || step.did === "waiting") break;
      }
    }
  } finally {
    embedder.close();
  }
} else if (cmd === "status") {
  for (const r of await recordings()) {
    const v = await loadVodIndex(dataDir, parseVodName(r.file).vodId);
    if (!v) {
      console.log(
        `${parseVodName(r.file).vodId} [${r.source.channel}] ${r.game}: not indexed yet (${(r.bytes / 1e9).toFixed(1)} GB)`,
      );
      continue;
    }
    const l = await left(v);
    console.log(
      `${progress(v, l.tags, l.vectors)}${vodReady(v, await loadVodTags(dataDir, v.vodId)) ? "  READY" : ""}`,
    );
  }
} else if (cmd === "prune") {
  // Recordings older than N days leave D: once fully indexed and tagged: archived to the Mac's USB drive, never
  // deleted outright (src/vodindex/archive.ts); a recording not done yet, or with no archive to go to, stays.
  const days = Number(flag("days") ?? process.env.VOD_KEEP_DAYS ?? 10);
  const dry = args.includes("--dry");
  const since = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const deps = sshArchiveDeps(
    process.env.VOD_ARCHIVE_HOST || "pulse-mac",
    process.env.VOD_ARCHIVE_ROOT || "/Volumes/Storage",
  );
  const logFile = path.join(process.env.VOD_ROOT || "D:/pulse-data/vods", "archive.log");
  let moved = 0;
  for (const r of await recordings()) {
    if (!r.recordedOn || r.recordedOn >= since) continue;
    const v = await loadVodIndex(dataDir, r.vodId);
    if (!v || !vodReady(v, await loadVodTags(dataDir, v.vodId))) {
      console.log(`kept (not fully indexed): ${path.basename(r.file)}`);
      continue;
    }
    if (dry) {
      console.log(
        `would archive ${path.basename(r.file)} (${(r.bytes / 1e9).toFixed(1)} GB, ${r.recordedOn}) to ${archivePath(r.file)}`,
      );
      continue;
    }
    // One recording's trouble never stops the rest.
    const t0 = Date.now();
    const out = await archiveRecording(
      { file: r.file, bytes: r.bytes },
      deps,
      process.env.VOD_ARCHIVE_ROOT || "/Volumes/Storage",
    ).catch((err: unknown) => ({ action: "kept" as const, why: `archive failed: ${err instanceof Error ? err.message : String(err)}` }));
    const seconds = Math.round((Date.now() - t0) / 1000);
    const line = {
      at: new Date().toISOString(),
      file: r.file,
      bytes: r.bytes,
      seconds,
      ...(out.action === "archived" && seconds > 0 ? { mbPerSecond: Math.round(r.bytes / 1e6 / seconds) } : {}),
      ...out,
    };
    await fs.appendFile(logFile, `${JSON.stringify(line)}\n`);
    console.log(
      out.action === "kept"
        ? `kept ${path.basename(r.file)}: ${out.why}`
        : `${out.action}: ${path.basename(r.file)} -> ${out.remote}`,
    );
    if (out.action !== "kept") moved += r.bytes;
  }
  const clips = dry ? 0 : await pruneClips(ctx);
  console.log(
    `${dry ? "dry run" : `moved ${(moved / 1e9).toFixed(1)} GB off D:`}; ${clips} old clips removed`,
  );
} else if (cmd === "search" && a1 && a2) {
  const sem = cfg.semantic;
  const embedder = new Embedder({
    python: sem.python,
    model: sem.model,
    device: sem.device,
    cacheDir: path.join(dataDir, "semantic"),
    idleSeconds: 30,
    priority: 20,
  });
  try {
    const vods = await readyRecordings({ ...ctx, dataDir }, a1);
    const hits = await findVodMoments(
      vods,
      { key: "probe", text: a2 },
      {
        dataDir,
        embedder,
        model: sem.model,
        now: new Date(),
        windows: ctx.windows(),
        max: Number(flag("top") ?? 8),
      },
    );
    for (const h of hits)
      console.log(
        `${h.score.toFixed(2)}  ${h.vodId} ${h.start.toFixed(1)}s  ${h.label}${h.held ? `  (held: ${h.held})` : ""}`,
      );
  } finally {
    embedder.close();
  }
} else {
  console.error(
    'usage: vodpc.ts index [--hours N] | status | prune [--days N] [--dry] | search "<game>" "<line>"',
  );
  process.exitCode = 2;
}
