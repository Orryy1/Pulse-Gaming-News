// Does a clip have someone talking in it? A gameplay clip keeps its game sound (gunfire, engines,
// explosions) under the narrator, but a YouTuber's commentary or a cutscene's dialogue would talk
// over him. The local speech recogniser (PulseGaming-ASR, faster-whisper) counts the words; music
// and sound effects come back empty. Unavailable means "unknown": the caller keeps the clip muted.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";

const run = promisify(execFile);
const ASR_URL = process.env.ASR_URL || "http://127.0.0.1:8877";

/** Above this many spoken words a second a clip is talk, not game sound. */
export const TALK_WORDS_PER_SECOND = 0.6;

/** True when the file has an audio stream at all. */
export async function hasAudio(file: string): Promise<boolean> {
  const { stderr } = await run(FFMPEG, ["-hide_banner", "-i", file], {
    maxBuffer: 4 * 1024 * 1024,
  }).catch((e: { stderr?: string }) => ({ stderr: String(e.stderr ?? "") }));
  return /Stream #\d+:\d+.*: Audio:/.test(String(stderr));
}

/** Spoken words per second in a clip's audio, or undefined when it cannot be told. */
export async function wordsPerSecond(
  file: string,
): Promise<number | undefined> {
  if (process.env.NODE_TEST_CONTEXT) return undefined;
  try {
    const { stdout } = await run(
      FFMPEG,
      [
        "-v",
        "error",
        "-i",
        file,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        "-",
      ],
      {
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    const wav = stdout as unknown as Buffer;
    const seconds = Math.max(0.5, (wav.length - 44) / 32_000);
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetchWithTimeout(
        `${ASR_URL}/transcribe`,
        {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-pulse-asr-device": "cuda",
            "x-pulse-asr-model": "medium.en",
            "x-pulse-audio-duration-seconds": seconds.toFixed(2),
          },
          body: new Uint8Array(wav),
        },
        60_000,
      );
      if (res.status === 409) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // the recogniser takes one job at a time
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as {
        words?: unknown[];
        detail?: string;
      };
      if (body.detail === "production_asr_transcript_empty") return 0;
      if (!res.ok) return undefined;
      return (body.words?.length ?? 0) / seconds;
    }
    return undefined;
  } catch (err) {
    log("warn", "speech check failed", { file, error: errorMessage(err) });
    return undefined;
  }
}

/** Strips a clip's audio in place (the picture is copied, not re-encoded). */
export async function stripAudio(file: string): Promise<void> {
  const tmp = file.replace(/\.mp4$/, ".silent.mp4");
  await run(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-i",
    file,
    "-an",
    "-c:v",
    "copy",
    tmp,
  ]);
  const fs = await import("node:fs/promises");
  await fs.rename(tmp, file);
}

/** Keeps a clip's game sound only when it has sound and nobody is talking over it. Returns whether it kept it. */
export async function keepGameSound(file: string): Promise<boolean> {
  if (!(await hasAudio(file))) return false;
  const wps = await wordsPerSecond(file);
  if (wps !== undefined && wps < TALK_WORDS_PER_SECOND) return true;
  await stripAudio(file).catch(() => undefined);
  return false;
}
