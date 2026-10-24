// Client for the Codex local voice server (tts_server/, VoxCPM 2 + WhisperX
// alignment, "Liam" voice) on this PC. It speaks the same /with-timestamps
// contract as ElevenLabs, but VoxCPM is only stable for short takes on
// Windows CUDA, so long narration is split into sentence-aligned chunks,
// synthesised one by one, and stitched with the timings offset.

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";
import { fetchWithTimeout, FatalError, log } from "../lib/util.ts";
import { wordsFromAlignment, type Alignment, type Narration, type Word } from "./elevenlabs.ts";
import { probe } from "../qa/media.ts";

const run = promisify(execFile);

export interface LocalVoiceOptions {
  baseUrl: string; // e.g. http://127.0.0.1:8765
  voiceId: string; // tts_server/voices.json key; Liam is TX3LPaxmHKxFdv7VOQHJ
  speakingRate: number;
  startScript?: string; // windows\start-liam.bat (or tts_server\start.bat), launched with the port if the server is down
  maxWordsPerTake?: number;
}

/** Splits narration at sentence (then clause) boundaries into takes of at most maxWords. */
export function chunkText(text: string, maxWords = 36): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const pieces: string[] = [];
  for (const s of sentences) {
    const words = s.split(/\s+/);
    if (words.length <= maxWords) {
      pieces.push(s);
      continue;
    }
    // Over-long sentence: break at commas, then hard-wrap.
    let cur: string[] = [];
    for (const w of words) {
      cur.push(w);
      if ((cur.length >= maxWords * 0.6 && /[,;:]$/.test(w)) || cur.length >= maxWords) {
        pieces.push(cur.join(" "));
        cur = [];
      }
    }
    if (cur.length) pieces.push(cur.join(" "));
  }
  const takes: string[] = [];
  let cur = "";
  for (const p of pieces) {
    const joined = cur ? `${cur} ${p}` : p;
    if (cur && joined.split(/\s+/).length > maxWords) {
      takes.push(cur);
      cur = p;
    } else cur = joined;
  }
  if (cur) takes.push(cur);
  return takes;
}

/** "ready" once the server answers /health and (if it reports a phase) has loaded its engine. */
async function healthy(baseUrl: string): Promise<"ready" | "warming" | "down"> {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/health`, {}, 5_000);
    if (!res.ok) return "down";
    const body = (await res.json().catch(() => ({}))) as { ready?: boolean };
    return body.ready === false ? "warming" : "ready";
  } catch {
    return "down";
  }
}

/**
 * Port 8765 on the production PC is also used by the old governed VoxCPM
 * service, which answers /health but not /with-timestamps. Starting our own
 * server on top of it would fail to bind, so refuse early with a clear message.
 */
async function assertSpeaksOurContract(opts: LocalVoiceOptions): Promise<void> {
  try {
    const res = await fetchWithTimeout(`${opts.baseUrl}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps`, {}, 5_000);
    if (res.status === 404) {
      throw new FatalError(`a different server answers on ${opts.baseUrl} (no /with-timestamps route); set LOCAL_TTS_URL to a free port such as http://127.0.0.1:8766 so the factory can start its own tts_server there`);
    }
  } catch (e) {
    if (e instanceof FatalError) throw e;
    // Any other failure (405 is the normal answer to GET, timeouts, etc.) is not a contract mismatch.
  }
}

/** Makes sure the voice server is up, starting it with its own start.bat if needed. */
export async function ensureLocalVoice(opts: LocalVoiceOptions, waitMs = 8 * 60_000): Promise<void> {
  let state = await healthy(opts.baseUrl);
  if (state !== "down") await assertSpeaksOurContract(opts);
  if (state === "ready") return;
  if (state === "down") {
    if (!opts.startScript) throw new Error(`local voice server is not running at ${opts.baseUrl}`);
    const port = new URL(opts.baseUrl).port || "8765";
    log("info", "starting local voice server", { script: opts.startScript, port });
    // The start script receives the port so one script can serve any LOCAL_TTS_URL.
    spawn("cmd.exe", ["/c", opts.startScript, port], { cwd: path.dirname(opts.startScript), detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else {
    log("info", "local voice server is still loading", { url: opts.baseUrl });
  }
  const until = Date.now() + waitMs; // a cold VoxCPM load takes 2-5 minutes
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 10_000));
    state = await healthy(opts.baseUrl);
    if (state === "ready") return;
  }
  throw new Error(`local voice server did not become ready within ${Math.round(waitMs / 60_000)} minutes`);
}

async function synthTake(text: string, opts: LocalVoiceOptions): Promise<{ audio: Buffer; alignment: Alignment }> {
  const res = await fetchWithTimeout(
    `${opts.baseUrl}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, speaking_rate: opts.speakingRate },
        output_format: "mp3_44100_128",
        alignment_mode: "forced",
      }),
    },
    10 * 60_000,
  );
  if (res.status === 404) throw new FatalError(`local voice "${opts.voiceId}" is not registered in tts_server/voices.json`);
  if (!res.ok) throw new Error(`local voice HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { audio_base64: string; alignment: Alignment };
  if (!body.alignment?.characters?.length) throw new Error("local voice returned no alignment");
  return { audio: Buffer.from(body.audio_base64, "base64"), alignment: body.alignment };
}

export const GAP_SECONDS = 0.18; // breath between takes
const TAIL_SECONDS = 0.35; // audio kept after the last aligned character
const MAX_INTERNAL_SILENCE = 2.0; // a cold VoxCPM engine sometimes stalls mid-take
const MAX_OVERRUN = 2.5; // audio running on past the last aligned word is not the script

/** Longest silence (seconds) inside the first `until` seconds of a file. */
async function longestSilence(file: string, until: number): Promise<number> {
  const { stderr } = await run(FFMPEG, ["-hide_banner", "-i", file, "-t", String(Math.max(until, 0.1)), "-af", "silencedetect=noise=-35dB:d=0.8", "-f", "null", "-"]);
  let max = 0;
  for (const m of String(stderr).matchAll(/silence_duration: ([\d.]+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * Synthesises one take and keeps only the audio that the aligner matched to
 * the text. VoxCPM occasionally stalls for seconds mid-take or keeps talking
 * after the script ends (seen on the first take after a cold load); such a
 * take is re-synthesised once, and whatever trails the last aligned word is
 * cut so the stitched timeline stays tight.
 */
async function synthTakeChecked(take: string, index: number, dir: string, opts: LocalVoiceOptions): Promise<{ file: string; alignment: Alignment }> {
  const file = path.join(dir, `take_${index}.mp3`);
  const raw = path.join(dir, `take_${index}_raw.mp3`);
  let last: { alignment: Alignment; cutAt: number } | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { audio, alignment } = await synthTake(take, opts);
    await fs.writeFile(raw, audio);
    const alignedEnd = alignment.character_end_times_seconds.at(-1) ?? 0;
    const rawDuration = (await probe(raw)).durationSeconds;
    const overrun = rawDuration > 0 ? rawDuration - alignedEnd : 0;
    const stall = await longestSilence(raw, alignedEnd);
    last = { alignment, cutAt: rawDuration > 0 ? Math.min(rawDuration, alignedEnd + TAIL_SECONDS) : alignedEnd + TAIL_SECONDS };
    if (stall <= MAX_INTERNAL_SILENCE && overrun <= MAX_OVERRUN) break;
    log("warn", attempt === 1 ? "take looks broken, re-synthesising" : "take still looks off, keeping it", { take: index, stall: stall.toFixed(1), overrun: overrun.toFixed(1) });
  }
  await run(FFMPEG, ["-loglevel", "error", "-y", "-i", raw, "-t", last!.cutAt.toFixed(3), "-c", "copy", file]);
  await fs.rm(raw, { force: true });
  return { file, alignment: last!.alignment };
}

export async function synthesiseLocal(text: string, outPath: string, opts: LocalVoiceOptions): Promise<Narration> {
  await ensureLocalVoice(opts);
  const takes = chunkText(text, opts.maxWordsPerTake ?? 36);
  const dir = path.join(path.dirname(outPath), "takes");
  await fs.mkdir(dir, { recursive: true });
  const files: string[] = [];
  const words: Word[] = [];
  let offset = 0;
  for (const [i, take] of takes.entries()) {
    const { file, alignment } = await synthTakeChecked(take, i, dir, opts);
    files.push(file);
    const duration = (await decodedSeconds(file)) || (alignment.character_end_times_seconds.at(-1) ?? 0);
    for (const w of wordsFromAlignment(alignment)) words.push({ text: w.text, start: w.start + offset, end: w.end + offset });
    offset += duration + GAP_SECONDS;
  }
  await stitch(files, outPath);
  return { audioPath: outPath, words, durationSeconds: offset - GAP_SECONDS + 0.15 };
}

/**
 * A take's length as the stitch will hear it: its decoded samples. An MP3's reported duration
 * includes encoder padding, about 36 ms a take, so offsets built from it ran late by over a
 * second across a 15-minute narration, and the pause trim then cut into words (GTA ranking,
 * 23 Oct 2026).
 */
export async function decodedSeconds(file: string): Promise<number> {
  const { stdout } = await run(FFMPEG, ["-v", "error", "-i", file, "-ac", "1", "-ar", "44100", "-f", "s16le", "-"], {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  });
  return (stdout as unknown as Buffer).length / 2 / 44100;
}

/** Concatenates takes with short silences, normalising format so the timings stay exact. */
export async function stitch(files: string[], outPath: string): Promise<void> {
  const inputs = files.flatMap((f) => ["-i", f]);
  const parts = files.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono[a${i}]`);
  const gaps = files.slice(1).map((_, i) => `aevalsrc=0:d=${GAP_SECONDS}:s=44100:c=mono[g${i}]`);
  const order = files.map((_, i) => (i === 0 ? `[a0]` : `[g${i - 1}][a${i}]`)).join("");
  const n = files.length * 2 - 1;
  const graph = [...parts, ...gaps, `${order}concat=n=${n}:v=0:a=1[out]`].join(";");
  await run(FFMPEG, ["-loglevel", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", outPath]);
}
