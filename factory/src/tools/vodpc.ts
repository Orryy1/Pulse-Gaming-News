// The stream recordings on the PC (owner, 25 Nov 2026): every channel's folder (src/vodindex/sources.ts) indexed,
// tagged and given its meaning vectors, so the game library server can serve them to the Mac (src/vodindex/serve.ts).
//   node --import tsx src/tools/vodpc.ts index [--hours 3] [--only v1,v2]   index what is not done yet, owner's channel first
//   node --import tsx src/tools/vodpc.ts status                  each recording's progress
//   node --import tsx src/tools/vodpc.ts prune [--days 10] [--dry]  recordings older than that, fully indexed, archived to the Mac
//   node --import tsx src/tools/vodpc.ts search "<game>" "<line>"   the moments a line finds (held ones marked)
//   node --import tsx src/tools/vodpc.ts rates                   the learned minutes per step and per stream-hour
// The heavy part goes in slices of at most VOD_SLICE_MINUTES (18), each in its own orchestrator turn at VOD_PRIORITY (40, the manual-tool tier; 20 to 40)
// with an --est from the measured rates (src/vodindex/slices.ts): the vision model's tags and descriptions in a gpu
// turn, Whisper and SigLIP on the CPU (VOD_WHISPER_DEVICE, VOD_SEMANTIC_DEVICE) in a cpu turn. windows/vod-daily.ps1
// runs `index` directly; it takes its own turns and refuses to work where there is no orchestrator.
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
  vodNextWork,
  type VodBuildSettings,
} from "../vodindex/build.ts";
import { visionUp } from "../sceneindex/describe.ts";
import { leaseStrict, loadOrch, NoOrchestrator, type OrchClient } from "../lib/orch.ts";
import {
  indexInSlices,
  stopsRun,
  loadRates,
  minutesPerStreamHour,
  saveRates,
  sliceCap,
  type SliceDeps,
} from "../vodindex/slices.ts";
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
  // In slices, each in its own orchestrator turn (src/vodindex/slices.ts, 26 Nov 2026): never one long GPU turn.
  const until = Date.now() + Number(flag("hours") ?? 3) * 3_600_000;
  const sem = cfg.semantic;
  const whisperDevice = process.env.VOD_WHISPER_DEVICE || "cpu";
  const semanticDevice = process.env.VOD_SEMANTIC_DEVICE || "cpu";
  const cap = sliceCap(process.env);
  let orch: OrchClient | undefined;
  try {
    orch = await loadOrch();
  } catch (err) {
    if (!(err instanceof NoOrchestrator)) throw err;
  }
  const deps: SliceDeps = {
    now: () => Date.now(),
    env: process.env,
    lease: async (cls, o) => {
      if (!orch) throw new NoOrchestrator();
      return leaseStrict(orch, cls, { project: "pulse", ...o });
    },
  };
  // The slice holds the turn, so the embedder takes none of its own (its own turn is class gpu, est 2).
  const embedder = new Embedder({
    python: sem.python,
    model: sem.model,
    device: semanticDevice,
    cacheDir: path.join(dataDir, "semantic"),
    idleSeconds: 30,
    priority: 20,
    lease: async () => () => undefined,
  });
  let rates = await loadRates(dataDir);
  const stamp = () => new Date().toISOString().slice(11, 19);
  try {
    if (!orch) {
      console.log("index refused: no orchestrator on this machine, and stream work only runs in its turns");
      process.exitCode = 3;
    }
    // --only v1,v2: just those recordings (a proof, or one still being re-downloaded left out).
    const only = flag("only")
      ?.split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    let stop = !orch;
    for (const r of await recordings()) {
      if (stop || Date.now() > until) break;
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
      const base: VodBuildSettings = {
        dataDir,
        whisperPython: cfg.whisperPython,
        whisperDevice,
        ocrFps: cfg.streamAsks.ocrFps,
        chunkSeconds: cfg.streamAsks.chunkMinutes * 60,
        describeBatch: cfg.streamAsks.describeBatch,
        // One vision request at a time: Ollama answers one anyway (one slot); a second only waits beside it.
        describeWorkers: 1,
        // CPU Whisper (26 Nov 2026 bench, a 20-minute stream chunk on 8 threads): medium.en with beam 5 took 1,106 s,
        // small.en greedy 100 s for 915 words against 929; small.en greedy keeps the stretch step a CPU job of minutes.
        whisperModel: process.env.VOD_WHISPER_MODEL || "small.en",
        whisperBeam: Number(process.env.VOD_WHISPER_BEAM) || 1,
        tags: {
          batch: sem.vodTagsBatch,
          places,
          embedder,
          model: sem.model,
          embedBatch: sem.shotsPerTurn,
        },
      };
      const run = await indexInSlices(
        {
          label: r.vodId,
          until,
          rates,
          capMinutes: cap,
          chunkSeconds: base.chunkSeconds,
          whisperDevice,
          semanticDevice,
        },
        {
          ...deps,
          next: async () => vodNextWork(await openVodIndex(r.file, r.game!, { dataDir }), base),
          step: async (plan, stopAt) => {
            if (!plan) return (await vodIndexStep(r.file, r.game!, { ...base, only: "words" })).did;
            const s: VodBuildSettings = {
              ...base,
              only: plan.work,
              ...(stopAt !== undefined ? { until: stopAt } : {}),
              ...(plan.chunkSeconds ? { chunkSeconds: plan.chunkSeconds } : {}),
              describeBatch: plan.units,
              tags: { ...base.tags!, batch: plan.units, embedBatch: plan.units },
            };
            try {
              return (await vodIndexStep(r.file, r.game!, s)).did;
            } finally {
              // SigLIP's process goes with its turn, never left holding memory after it.
              if (plan.work === "embed") embedder.close();
            }
          },
          visionUp: () => visionUp(),
          saveRates: (x) => saveRates(dataDir, x),
          log: async (line) => {
            const v = await openVodIndex(r.file, r.game!, { dataDir });
            const l = await left(v);
            console.log(`${stamp()} ${line}: ${progress(v, l.tags, l.vectors)}`);
          },
        },
      );
      rates = run.rates;
      // The vision model away, or no turn: every other recording would meet the same. A recording that fails or
      // stops getting anywhere is left for the next run and the rest go on.
      if (stopsRun(run.stopped)) stop = true;
    }
  } finally {
    embedder.close();
  }
} else if (cmd === "rates") {
  // The learned seconds per unit of each step, and what a stream-hour costs at them.
  const r = await loadRates(dataDir);
  console.log(JSON.stringify({ rates: r, minutesPerStreamHour: minutesPerStreamHour(r), sliceCap: sliceCap(process.env) }));
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
    // The same CPU SigLIP the index uses (VOD_SEMANTIC_DEVICE), so a search never loads a CUDA model either.
    device: process.env.VOD_SEMANTIC_DEVICE || "cpu",
    cacheDir: path.join(dataDir, "semantic"),
    idleSeconds: 30,
    priority: 20,
    // On the CPU a search waits for a cpu turn, not behind the GPU's queue.
    ...((process.env.VOD_SEMANTIC_DEVICE || "cpu") === "cpu"
      ? {
          lease: async () =>
            (await loadOrch()).lease("cpu", { project: "pulse", job: "vodpc: search", kind: "pulse:vodsearch", priority: 20, est: 2 }),
        }
      : {}),
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
    'usage: vodpc.ts index [--hours N] [--only v1,v2] | status | rates | prune [--days N] [--dry] | search "<game>" "<line>"',
  );
  process.exitCode = 2;
}
