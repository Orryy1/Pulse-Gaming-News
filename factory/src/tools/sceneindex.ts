// The scene index by hand: build a game's index piece by piece, look moments and quotes up in it, and draw a
// contact sheet of what a lookup found. The factory's own job (src/sceneindex/job.ts) runs the same "build".
//   node --import tsx src/tools/sceneindex.ts build "<game>" [--recent] [--complete] [--released=YYYY-MM-DD] [--steps=N] [--from=s --to=s] [--no-describe]
//                                              [--no-voice] [--ocr-ssh=<host>] [--hear-ssh=<host>] [--source=<video id>]
//   node --import tsx src/tools/sceneindex.ts search "<game>" [--recent] [--details] [--released=YYYY-MM-DD]   (the launch fetcher's search, dry)
//   node --import tsx src/tools/sceneindex.ts voice "<game>" [--from=s --to=s] [--hear-ssh=<host>]   listen to an indexed stretch
//   node --import tsx src/tools/sceneindex.ts tidy "<game>"      names "<game>" (cast and places again from Wikipedia)
//   node --import tsx src/tools/sceneindex.ts describe "<game>" [--limit=N] [--from=s --to=s]
//   node --import tsx src/tools/sceneindex.ts find "<game>" "<what the line shows>" [--keywords=a,b] [--sheet=out.jpg]
//   node --import tsx src/tools/sceneindex.ts quote "<game>" "<the words>" [--speaker=name] [--sheet=out.jpg]
//   node --import tsx src/tools/sceneindex.ts status "<game>"
//   node --import tsx src/tools/sceneindex.ts light "<game>" [--recent] [--comments=N] [--ocr] [--source=<video id>] [--exclude=id,id] [--repick]
//                                              (the light index: captions, chapters, storyboard, comments; no video downloaded)
//   node --import tsx src/tools/sceneindex.ts alive "<game>"    (is the index's upload still up: "alive" or "gone")
//   (the archive ranking and its picks: src/tools/archive.ts)
// Settings come from the environment (the factory's .env when run from its folder): DATA_DIR, YTDLP_PATH,
// WHISPER_PYTHON and the SCENE_INDEX_* values of src/config.ts. Heavy steps take a turn themselves on the PC
// (the orchestrator) unless ORCH_HELD says the caller already holds one; on the Mac run it behind ~/orch/macrun.sh.
// --ocr-ssh reads the text on a Mac over ssh (Apple's text recogniser) when this machine is the PC: frames go to a
// scratch folder in the Mac's home, outside the factory, and are removed afterwards. --hear-ssh does the same for
// the sound (the Mac's Whisper), so neither reading nor listening needs the PC's GPU.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FFMPEG } from "../lib/bin.ts";
import { loadOrch, NoOrchestrator } from "../lib/orch.ts";
import { parseOcrOutput, type OcrPage } from "../assets/ocr.ts";
import {
  buildStep,
  chooseSource,
  describeShots,
  hearInto,
  indexStretch,
  judgeUploads,
  launchCandidates,
  launchDetails,
  launchSearch,
  sourceKind,
  pickComplete,
  sceneIndexReady,
  stripArgs,
  undescribed,
  type BuildDeps,
  type BuildSettings,
} from "../sceneindex/build.ts";
import {
  coveredSeconds,
  emptySceneIndex,
  loadSceneIndex,
  saveSceneIndex,
  sceneIndexDir,
  type SceneIndex,
} from "../sceneindex/schema.ts";
import { findQuote, findShots } from "../sceneindex/lookup.ts";
import { buildLight, hasCaptions, uploadInfo } from "../sceneindex/light.ts";
import { siblingsOf } from "../sceneindex/archive.ts";
import { gameNames } from "../sceneindex/names.ts";
import { keyframeTimes } from "../sceneindex/shots.ts";
import { tidyIndex } from "../sceneindex/tidy.ts";

const exec = promisify(execFile);
const [, , command, game, ...rest] = process.argv;
const flag = (name: string): string | undefined => {
  const hit = rest.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined
    ? undefined
    : hit.includes("=")
      ? hit.slice(hit.indexOf("=") + 1)
      : "true";
};
const words = rest.filter((a) => !a.startsWith("--"));
const num = (v: string | undefined, d: number) =>
  v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d;

function settings(): BuildSettings {
  const env = process.env;
  const whisper =
    env.WHISPER_PYTHON ??
    [
      "D:/pulse-tools/pulse-python-runtime/Scripts/python.exe",
      `${os.homedir()}/PulseFactory/asr/bin/python`,
    ].find((p) => fsSync.existsSync(p)) ??
    "";
  return {
    dataDir: path.resolve(env.DATA_DIR || "./data"),
    ytdlp:
      env.YTDLP_PATH && fsSync.existsSync(env.YTDLP_PATH)
        ? env.YTDLP_PATH
        : "yt-dlp",
    whisperPython: flag("no-voice") ? "" : whisper,
    proxyHeight: num(env.SCENE_INDEX_PROXY_HEIGHT, 480),
    ocrFps: num(env.SCENE_INDEX_OCR_FPS, 2),
    chunkSeconds: num(env.SCENE_INDEX_CHUNK_MINUTES, 10) * 60,
    maxHours: num(env.SCENE_INDEX_MAX_HOURS, 12),
  };
}

/** The text of frames read on a Mac over ssh, in batches, behind the Mac's turn-taker. */
function sshReader(
  host: string,
): (files: string[]) => Promise<Map<string, OcrPage>> {
  const script = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "assets",
    "macocr.py",
  );
  const job = `sceneindex-scratch/ocr_${process.pid}`;
  let ready = false;
  return async (files) => {
    if (!files.length) return new Map();
    if (!ready) {
      await exec("ssh", ["-o", "BatchMode=yes", host, `mkdir -p ~/${job}`]);
      await exec("scp", ["-q", path.basename(script), `${host}:${job}/macocr.py`], {
        cwd: path.dirname(script),
      });
      ready = true;
    }
    // Bare names from inside the folder: scp reads "D:/..." as a host called D.
    await exec("scp", ["-q", ...files.map((f) => path.basename(f)), `${host}:${job}/`], {
      cwd: path.dirname(files[0]!),
      maxBuffer: 8 * 1024 * 1024,
    });
    const names = files.map((f) => path.basename(f));
    const remote = [
      `cd ~/${job}`,
      `python3 -c 'import json,os,sys; json.dump([os.path.join(os.getcwd(), n) for n in sys.argv[1:]], open("list.json","w"))' ${names.join(" ")}`,
      `R="$HOME/orch/macrun.sh"; P="$HOME/PulseFactory/ocr/bin/python"`,
      `if [ -x "$R" ]; then MACRUN_WAIT_MIN=45 "$R" pulse-sceneindex-ocr "$P" -I macocr.py list.json correct; else "$P" -I macocr.py list.json correct; fi`,
      `S=$?; rm -f ${names.join(" ")} list.json; exit $S`,
    ].join("; ");
    const { stdout } = await exec(
      "ssh",
      ["-o", "BatchMode=yes", host, remote],
      {
        maxBuffer: 256 * 1024 * 1024,
        timeout: 60 * 60_000,
      },
    );
    const pages = parseOcrOutput(stdout);
    const out = new Map<string, OcrPage>();
    for (const f of files) {
      const page = [...pages].find(
        ([k]) => path.basename(k) === path.basename(f),
      )?.[1];
      if (page) out.set(f, page);
    }
    return out;
  };
}

/** Whisper's word timings for a sound file, from a Mac over ssh (MLX Whisper there), behind the Mac's turn-taker. */
function sshHearer(host: string): (wav: string) => Promise<Array<{ text: string; start: number; end: number }>> {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "qa", "whisperwords.py");
  const job = `sceneindex-scratch/asr_${process.pid}`;
  let ready = false;
  return async (wav) => {
    if (!ready) {
      await exec("ssh", ["-o", "BatchMode=yes", host, `mkdir -p ~/${job}`]);
      await exec("scp", ["-q", path.basename(script), `${host}:${job}/whisperwords.py`], { cwd: path.dirname(script) });
      ready = true;
    }
    await exec("scp", ["-q", path.basename(wav), `${host}:${job}/in.wav`], { cwd: path.dirname(wav) });
    const remote = [
      "export PATH=/opt/homebrew/bin:$PATH",
      `cd ~/${job}`,
      `R="$HOME/orch/macrun.sh"; P="$HOME/PulseFactory/asr/bin/python"`,
      `if [ -x "$R" ]; then MACRUN_WAIT_MIN=45 "$R" pulse-sceneindex-asr "$P" -I whisperwords.py in.wav out.json >/dev/null 2>&1; else "$P" -I whisperwords.py in.wav out.json >/dev/null 2>&1; fi`,
      "S=$?; cat out.json 2>/dev/null; rm -f in.wav out.json; exit $S",
    ].join("; ");
    const { stdout } = await exec("ssh", ["-o", "BatchMode=yes", host, remote], {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 90 * 60_000,
    });
    const words = (JSON.parse(stdout) as { words?: Array<{ text: string; start: number; end?: number }> }).words ?? [];
    return words.map((w) => ({ text: w.text, start: w.start, end: w.end ?? w.start + 0.3 }));
  };
}

/** A turn on the PC for the heavy steps, unless the caller holds one; nothing to take on the Mac. */
async function turn(job: string, minutes: number): Promise<() => void> {
  const held = new Set((process.env.ORCH_HELD ?? "").split(","));
  if (["gpu", "cpu", "ram"].every((t) => held.has(t))) return () => undefined;
  try {
    const orch = await loadOrch();
    return await orch.lease("heavy", {
      project: "pulse",
      job,
      priority: 20,
      est: minutes,
    });
  } catch (err) {
    if (err instanceof NoOrchestrator) return () => undefined;
    throw err;
  }
}

function hms(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** A contact sheet: one row a hit (the shot before, the hit's keyframes, the shot after) with a caption under it. */
async function sheet(
  index: SceneIndex,
  dataDir: string,
  title: string,
  rows: Array<{ shot: number; caption: string; times?: number[] }>,
  out: string,
): Promise<void> {
  const proxy = path.join(
    sceneIndexDir(dataDir, index.game),
    index.proxy?.file ?? "proxy.mp4",
  );
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "sceneindex-sheet-"));
  try {
    const font = [
      "C:/Windows/Fonts/arial.ttf",
      "/System/Library/Fonts/Supplemental/Arial.ttf",
      "/Library/Fonts/Arial.ttf",
    ].find((f) => fsSync.existsSync(f));
    if (font) await fs.copyFile(font, path.join(work, "font.ttf"));
    const wrap = (text: string, width = 150) =>
      text
        .split("\n")
        .flatMap(
          (line) =>
            line.match(new RegExp(`.{1,${width}}(\\s|$)`, "g")) ?? [line],
        )
        .map((l) => l.trimEnd())
        .join("\n");
    const rowFiles: string[] = [];
    for (const [i, row] of rows.entries()) {
      const shot = index.shots[row.shot]!;
      const before = index.shots[row.shot - 1];
      const after = index.shots[row.shot + 1];
      const mid = (s: { start: number; end: number }) => (s.start + s.end) / 2;
      const own = row.times ?? keyframeTimes(shot.start, shot.end);
      const padded =
        own.length === 1
          ? [own[0]!, own[0]!, own[0]!]
          : own.length === 2
            ? [own[0]!, mid(shot), own[1]!]
            : own;
      const times = [
        before ? mid(before) : padded[0]!,
        ...padded,
        after ? mid(after) : padded[2]!,
      ];
      const strip = path.join(work, `strip_${i}.jpg`);
      await exec(FFMPEG, stripArgs(proxy, times, strip));
      const rowFile = `row_${i}.jpg`;
      await fs.writeFile(
        path.join(work, `cap_${i}.txt`),
        wrap(`${i === 0 ? `${title}\n` : ""}${row.caption}`),
      );
      const lines = wrap(`${i === 0 ? `${title}\n` : ""}${row.caption}`).split(
        "\n",
      ).length;
      const pad = 24 + lines * 26;
      // The hit's own frames are the middle three; the outer two are the shots either side, dimmed.
      const draw = font
        ? `,drawtext=fontfile=font.ttf:textfile=cap_${i}.txt:x=16:y=h-${pad}+12:fontsize=20:fontcolor=white:line_spacing=6`
        : "";
      await exec(
        FFMPEG,
        [
          "-loglevel",
          "error",
          "-y",
          "-i",
          path.basename(strip),
          "-vf",
          `drawbox=x=0:y=0:w=448:h=ih:color=black@0.45:t=fill,drawbox=x=iw-448:y=0:w=448:h=ih:color=black@0.45:t=fill,drawbox=x=448:y=0:w=1344:h=ih:color=0xFF6B1A:t=6,pad=iw:ih+${pad}:0:0:color=0x101418${draw}`,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          rowFile,
        ],
        { cwd: work },
      );
      rowFiles.push(rowFile);
    }
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    if (rowFiles.length === 1)
      await fs.copyFile(path.join(work, rowFiles[0]!), out);
    else
      await exec(
        FFMPEG,
        [
          "-loglevel",
          "error",
          "-y",
          ...rowFiles.flatMap((f) => ["-i", f]),
          "-filter_complex",
          `${rowFiles.map((_, i) => `[${i}:v]`).join("")}vstack=inputs=${rowFiles.length}[out]`,
          "-map",
          "[out]",
          "-frames:v",
          "1",
          "-q:v",
          "3",
          "sheet.jpg",
        ],
        { cwd: work },
      ).then(() => fs.copyFile(path.join(work, "sheet.jpg"), out));
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function need(s: BuildSettings): Promise<SceneIndex> {
  const index = await loadSceneIndex(s.dataDir, game!);
  if (!index) {
    console.error(`no scene index for "${game}" under ${s.dataDir}`);
    process.exit(2);
  }
  return index;
}

async function main(): Promise<void> {
  if (!command || !game) {
    console.error(
      'usage: sceneindex.ts build|describe|find|quote|status "<game>" ...',
    );
    process.exit(1);
  }
  const s = settings();
  const host = flag("ocr-ssh");
  const hearHost = flag("hear-ssh");
  const deps: BuildDeps = {
    ...(host && host !== "true" ? { readText: sshReader(host) } : {}),
    ...(hearHost && hearHost !== "true" ? { hear: sshHearer(hearHost) } : {}),
  };
  if (command === "status") {
    const index = await need(s);
    const dir = sceneIndexDir(s.dataDir, index.game);
    console.log(
      JSON.stringify(
        {
          game: index.game,
          version: index.version,
          source: index.source,
          covered: `${hms(coveredSeconds(index))} of ${hms(index.source.duration)}`,
          shots: index.shots.length,
          undescribed: undescribed(index).length,
          lines: index.lines.length,
          speakers: [
            ...new Set(
              index.lines.flatMap((l) => (l.speaker ? [l.speaker] : [])),
            ),
          ].length,
          cast: index.cast.length,
          places: index.places.length,
          proxyMb: Math.round((index.proxy?.bytes ?? 0) / 1e6),
          indexKb: Math.round(
            (await fs.stat(path.join(dir, "index.json"))).size / 1e3,
          ),
          ready: sceneIndexReady(index),
        },
        null,
        1,
      ),
    );
    return;
  }
  if (command === "search") {
    // The launch fetcher's search, dry: what it would find for a game and why each upload is or is not taken.
    // Nothing is downloaded. --details looks up the heights of the clean ones (one yt-dlp call each).
    const found = await launchCandidates(game, s.ytdlp);
    const verdicts = judgeUploads(found, game, {
      recentRelease: Boolean(flag("recent")),
      maxHours: s.maxHours,
      releasedOn: flag("released"),
    });
    if (flag("details"))
      for (const v of verdicts.filter((x) => x.ok)) {
        const d = await launchDetails(v.upload, s.ytdlp).catch(() => undefined);
        if (d)
          Object.assign(
            v,
            judgeUploads([d], game, { recentRelease: Boolean(flag("recent")), maxHours: s.maxHours, releasedOn: flag("released") })[0],
          );
      }
    for (const v of verdicts.sort((a, b) => Number(b.ok) - Number(a.ok)))
      console.log(
        `${v.ok ? "TAKE" : "skip"}  ${v.upload.videoId}  ${Math.round(v.upload.duration / 60)} min  ${v.upload.height ?? "?"}p  ${v.upload.title.slice(0, 90)} | ${v.upload.uploader} | ${v.reason}`,
      );
    const pick = pickComplete(
      flag("details") ? verdicts.filter((v) => v.ok && (v.upload.height ?? 0) >= 1080).map((v) => v.upload) : found,
      game,
      { recentRelease: Boolean(flag("recent")), maxHours: s.maxHours, releasedOn: flag("released") },
    );
    console.log(pick ? `pick ${pick.videoId} ${pick.kind} "${pick.title}"` : "pick none");
    return;
  }
  if (command === "build") {
    const from = flag("from");
    const to = flag("to");
    const release = await turn(`scene index: ${game}`, num(flag("est"), 30));
    try {
      if (from !== undefined && to !== undefined) {
        // One named stretch (a trial, or a repair): the source is chosen first when the game has no index yet.
        let index = await loadSceneIndex(s.dataDir, game);
        if (!index) {
          const forced = flag("source");
          const source = forced
            ? {
                videoId: forced,
                title: flag("title") ?? "",
                uploader: flag("uploader") ?? "",
                duration: num(flag("duration"), 0),
                kind: "movie" as const,
                pickedAt: new Date().toISOString(),
              }
            : await chooseSource(game, s, {
                recentRelease: Boolean(flag("recent")),
              });
          if (!source) throw new Error("no clean source found");
          index = emptySceneIndex(game, source, new Date());
          const names = await gameNames(game).catch(() => ({
            cast: [],
            places: [],
          }));
          index.cast = names.cast;
          index.places = names.places;
          await saveSceneIndex(s.dataDir, index);
        }
        const t0 = Date.now();
        index = await indexStretch(
          index,
          s,
          { from: Number(from), to: Number(to) },
          deps,
        );
        console.log(
          `stretch ${from}-${to}: ${index.shots.length} shots, ${index.lines.length} lines in ${Math.round((Date.now() - t0) / 1000)} s`,
        );
        if (!flag("no-describe")) {
          const t1 = Date.now();
          const r = await describeShots(
            index,
            s,
            num(flag("limit"), 5000),
            deps,
            { from: Number(from), to: Number(to) },
          );
          console.log(
            `described ${r.described}, failed ${r.failed} in ${Math.round((Date.now() - t1) / 1000)} s`,
          );
        }
        return;
      }
      const steps = num(flag("steps"), 1000);
      for (let i = 0; i < steps; i++) {
        const t0 = Date.now();
        const r = await buildStep(
          game,
          s,
          {
            recentRelease: Boolean(flag("recent")),
            refreshSource: i === 0 && Boolean(flag("refresh")),
            complete: Boolean(flag("complete")),
            releasedOn: flag("released"),
            describeBatch: flag("no-describe") ? 0 : 300,
            releaseProxy: process.env.SCENE_INDEX_RELEASE_PROXY === "delete" || Boolean(flag("release-proxy")),
          },
          deps,
        );
        console.log(
          `${r.did} ${JSON.stringify(r.detail ?? {})} in ${Math.round((Date.now() - t0) / 1000)} s`,
        );
        if (r.did === "done" || r.did === "no-source" || r.did === "waiting")
          break;
        if (
          flag("no-describe") &&
          r.index &&
          !r.detail?.from &&
          r.did !== "stretch"
        )
          break;
      }
    } finally {
      release();
    }
    return;
  }
  if (command === "light") {
    // ARCHIVE_BACKLOG: the light index. The source by the launch picker's rules (or --source), then captions,
    // chapters, storyboard frames and comments; nothing but index.json is kept.
    const exclude = new Set((flag("exclude") ?? "").split(",").filter(Boolean));
    let index = await loadSceneIndex(s.dataDir, game);
    if (index && exclude.has(index.source.videoId)) index = undefined;
    const forced = flag("source");
    let source = forced
      ? ((await launchDetails({ videoId: forced, title: "", uploader: "", duration: 0 }, s.ytdlp).then((d) =>
          d ? { videoId: d.videoId, title: d.title, uploader: d.uploader, duration: d.duration, ...(d.height ? { height: d.height } : {}), kind: sourceKind(d.title), pickedAt: new Date().toISOString() } : undefined,
        )) as SceneIndex["source"] | undefined)
      : !flag("repick") && index
        ? index.source
        : undefined;
    if (!source) {
      // The light index reads the captions: of the clean uploads, the best one that has them (up to three looked
      // at), else the best one without. The searches are made once.
      const found = new Map<string, Awaited<ReturnType<typeof launchSearch>>>();
      const search = async (q: string) => {
        if (!found.has(q)) found.set(q, await launchSearch(q, s.ytdlp));
        return found.get(q)!.filter((u) => !exclude.has(u.videoId));
      };
      let first: SceneIndex["source"] | undefined;
      for (let i = 0; i < 3; i++) {
        const picked = await chooseSource(game, s, { recentRelease: Boolean(flag("recent")), complete: true, siblings: siblingsOf(game) }, { search });
        if (!picked) break;
        first ??= picked;
        const info = await uploadInfo(picked.videoId, s.ytdlp).catch(() => undefined);
        if (info && hasCaptions(info)) {
          source = picked;
          break;
        }
        exclude.add(picked.videoId);
      }
      source ??= first;
    }
    if (!source) {
      console.log("no-source");
      return;
    }
    if (index && index.tier !== "light" && index.source.videoId === source.videoId) {
      // A full index of the same upload is already better than a light one.
      console.log(`light ${source.videoId} 0 (full index kept)`);
      return;
    }
    const r = await buildLight(
      game,
      source,
      { dataDir: s.dataDir, ytdlp: s.ytdlp, comments: num(flag("comments"), 300), ocr: Boolean(flag("ocr")) },
      { names: gameNames },
    );
    console.log(JSON.stringify(r.stats));
    console.log(`light ${source.videoId} ${r.stats.bytes}`);
    return;
  }
  if (command === "alive") {
    const index = await need(s);
    const info = await launchDetails(
      { videoId: index.source.videoId, title: "", uploader: "", duration: 0 },
      s.ytdlp,
    ).catch((err: unknown) => (/unavailable|private|removed|terminated|not available|copyright/i.test(String((err as Error)?.message ?? err)) ? undefined : null));
    // null: the check itself failed (network): say nothing.
    if (info === null) throw new Error("could not check the upload");
    console.log(info ? "alive" : "gone");
    return;
  }
  if (command === "describe") {
    const index = await need(s);
    const release = await turn(
      `scene index: describe ${game}`,
      num(flag("est"), 30),
    );
    try {
      const t0 = Date.now();
      const r = await describeShots(index, s, num(flag("limit"), 300), deps, {
        from: num(flag("from"), 0),
        to: num(flag("to"), Infinity),
      });
      console.log(
        `described ${r.described}, failed ${r.failed}, left ${undescribed(r.index).length} in ${Math.round((Date.now() - t0) / 1000)} s`,
      );
    } finally {
      release();
    }
    return;
  }
  if (command === "names") {
    // The cast and place lists again from Wikipedia (a game's article gains its plot section after launch).
    const index = await need(s);
    const names = await gameNames(index.game);
    const next = tidyIndex({ ...index, cast: names.cast, places: names.places });
    await saveSceneIndex(s.dataDir, next);
    console.log(`names: ${next.cast.length} characters and things, ${next.places.length} places`);
    return;
  }
  if (command === "tidy") {
    const index = await need(s);
    const next = tidyIndex(index);
    await saveSceneIndex(s.dataDir, next);
    console.log(`tidied: ${index.lines.length} -> ${next.lines.length} lines, ${next.cast.length} names`);
    return;
  }
  if (command === "voice") {
    const index = await need(s);
    const release = await turn(`scene index: listen to ${game}`, num(flag("est"), 15));
    try {
      const t0 = Date.now();
      const r = await hearInto(index, s, { from: num(flag("from"), 0), to: num(flag("to"), index.source.duration) }, deps);
      console.log(`heard ${r.heard} lines; the index now has ${r.index.lines.length} in ${Math.round((Date.now() - t0) / 1000)} s`);
    } finally {
      release();
    }
    return;
  }
  if (command === "find") {
    const index = await need(s);
    const text = words.join(" ");
    const hits = findShots(
      index,
      { text, keywords: (flag("keywords") ?? "").split(",").filter(Boolean) },
      { max: num(flag("max"), 3) },
    );
    for (const h of hits)
      console.log(
        `${hms(h.start)} (${h.start.toFixed(2)}-${h.end.toFixed(2)} s) shot ${h.shot} confidence ${h.confidence} [${h.matched.join(", ")}] ${h.desc}`,
      );
    if (!hits.length) console.log("no shot found");
    const out = flag("sheet");
    if (out && hits.length)
      await sheet(
        index,
        s.dataDir,
        `"${text}" in ${index.game} (source ${index.source.videoId})`,
        hits.map((h, i) => {
          const shot = index.shots[h.shot]!;
          const said = index.lines
            .filter((l) => l.start < shot.end && l.end > shot.start)
            .map((l) => `${l.speaker ? `${l.speaker}: ` : ""}"${l.text}"`);
          return {
            shot: h.shot,
            caption: `#${i + 1}  ${hms(h.start)} (${h.start.toFixed(1)}-${h.end.toFixed(1)} s)  confidence ${h.confidence}  matched: ${h.matched.join(", ")}\n${shot.desc}  [who: ${shot.who.join(", ") || "?"}; where: ${shot.where || "?"}]${said.length ? `\n${said.join(" ").slice(0, 280)}` : ""}`,
          };
        }),
        out,
      );
    return;
  }
  if (command === "quote") {
    const index = await need(s);
    const text = words.join(" ");
    const hits = findQuote(index, text, {
      speaker: flag("speaker"),
      max: num(flag("max"), 3),
    });
    for (const h of hits)
      console.log(
        `${hms(h.start)} (${h.start.toFixed(2)}-${h.end.toFixed(2)} s) confidence ${h.confidence}${h.wordTimed ? " word-timed" : ""} ${h.speaker ? `${h.speaker}: ` : ""}"${h.text}"`,
      );
    if (!hits.length) console.log("no line found");
    const out = flag("sheet");
    if (out && hits.length)
      await sheet(
        index,
        s.dataDir,
        `Quote "${text}" in ${index.game} (source ${index.source.videoId})`,
        hits.slice(0, 2).map((h, i) => ({
          shot: h.shot,
          times: [h.start + 0.4, (h.start + h.end) / 2, Math.max(h.start + 0.5, h.end - 0.4)],
          caption: `#${i + 1}  ${hms(h.start)} (${h.start.toFixed(2)}-${h.end.toFixed(2)} s)  confidence ${h.confidence}\n${h.speaker ? `${h.speaker}: ` : ""}"${h.text}"\n${index.shots[h.shot]?.desc ?? ""}`,
        })),
        out,
      );
    return;
  }
  console.error(`unknown command ${command}`);
  process.exit(1);
}

await main();
