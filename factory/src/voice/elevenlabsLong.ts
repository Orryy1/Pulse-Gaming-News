// Long narration through ElevenLabs: the with-timestamps endpoint takes a few
// thousand characters per request, so a long-form script is spoken in takes
// of about a hundred words at sentence boundaries, each with its own word
// timings, then stitched with a short breath between takes and the timings
// offset, exactly as the local voice does.

import fs from "node:fs/promises";
import path from "node:path";
import { synthesise as synthesiseElevenLabs, type Narration, type Word } from "./elevenlabs.ts";
import { chunkText, stitch, GAP_SECONDS } from "./local.ts";
import { probe } from "../qa/media.ts";

export const LONG_TAKE_WORDS = 110;
/** Above this many characters the narration goes in takes. */
export const LONG_TEXT_CHARS = 2400;

export async function synthesiseElevenLabsLong(
  text: string,
  outPath: string,
  opts: { apiKey: string; voiceId: string; modelId: string },
): Promise<Narration> {
  const takes = chunkText(text, LONG_TAKE_WORDS);
  const dir = path.join(path.dirname(outPath), "takes");
  await fs.mkdir(dir, { recursive: true });
  const files: string[] = [];
  const words: Word[] = [];
  let offset = 0;
  for (const [i, take] of takes.entries()) {
    const file = path.join(dir, `take_${String(i).padStart(3, "0")}.mp3`);
    const n = await synthesiseElevenLabs(take, file, opts);
    files.push(file);
    const duration = (await probe(file)).durationSeconds || n.durationSeconds;
    for (const w of n.words)
      words.push({
        text: w.text,
        start: w.start + offset,
        end: w.end + offset,
      });
    offset += duration + GAP_SECONDS;
  }
  await stitch(files, outPath);
  return {
    audioPath: outPath,
    words,
    durationSeconds: offset - GAP_SECONDS + 0.15,
  };
}
