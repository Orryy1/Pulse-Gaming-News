// Long narration through ElevenLabs: a long-form script is spoken in takes, each with its own word timings,
// then stitched with a short breath between takes and the timings offset, exactly as the local voice does.
//
// One voice from start to end (30 Oct 2026, owner: the narrator's voice "changes noticeably between
// sentences/paragraphs"). Every take was a separate request with no memory of the others, so each sampled
// the voice afresh: the Halo ranking's 21 takes matched in loudness but not in pitch or brightness. Now:
//   - takes are as large as the model safely takes (LONG_TAKE_CHARS, eleven_v3 accepts 5,000 characters),
//     split at paragraph ends where there are any and at sentence ends otherwise, so a 3,000-word
//     documentary has about six seams instead of about thirty;
//   - every take carries one seed for the whole narration, the neighbouring takes' text and, where the model
//     supports stitching, the earlier takes' request ids. On 31 Oct 2026 eleven_v3 took the seed but refused
//     previous_text/next_text ("not yet supported") and the docs say it has no request stitching: each
//     narration asks once, drops what is refused for the rest of its takes, and picks up support by itself
//     the day ElevenLabs adds it;
//   - after all takes are made, each one's pitch, centroid and high-band share is measured (takecheck.ts),
//     and a take that strays from the others is re-voiced once with a different seed, the closer kept
//     (VOICE_TAKE_CHECK, default on; at most three re-voices, and only inside the character budget).

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { log, errorMessage } from "../lib/util.ts";
import {
  synthesise as synthesiseElevenLabs,
  type Narration,
  type SynthOptions,
  type TakeContext,
  type Word,
} from "./elevenlabs.ts";
import {
  chunkText,
  decodedSeconds,
  splitSentences,
  stitch,
  GAP_SECONDS,
} from "./local.ts";
import {
  closer,
  deviation,
  measureTake,
  normOf,
  outliers,
  spread,
  MAX_REVOICES,
  type TakeMeasure,
} from "./takecheck.ts";

/** Most characters in one take: eleven_v3 takes 5,000 per request; this stays well under it. */
export const LONG_TAKE_CHARS = 3000;
/** Above this many characters the narration goes in takes. */
export const LONG_TEXT_CHARS = LONG_TAKE_CHARS;
/** How much of each neighbouring take is sent as context. */
export const CONTEXT_CHARS = 1000;

interface Unit {
  text: string;
  endsParagraph: boolean;
}

/**
 * Splits a long script into takes of at most `maxChars`, of roughly equal size. Paragraph ends (blank lines)
 * are preferred as seams; inside a long paragraph the seam falls at a sentence end (chunkText's rule, which
 * only breaks at clauses or words for a single sentence longer than a take).
 */
export function chunkTakes(text: string, maxChars = LONG_TAKE_CHARS): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const units: Unit[] = [];
  for (const para of clean
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    if (para.length <= maxChars) {
      units.push({ text: para, endsParagraph: true });
      continue;
    }
    const pieces = splitSentences(para).flatMap((s) =>
      s.length <= maxChars
        ? [s]
        : chunkText(s, Math.max(5, Math.floor(maxChars / 8))),
    );
    pieces.forEach((p, i) =>
      units.push({ text: p, endsParagraph: i === pieces.length - 1 }),
    );
  }
  const takes: string[] = [];
  let cur = "";
  let prevEndsParagraph = false;
  // Characters from the current take's start to the end: the target size is what is left over the takes
  // still needed, so the takes come out even and no stub is left at the end.
  let rest = units.reduce((n, u) => n + u.text.length + 1, 0);
  for (const u of units) {
    const sep = prevEndsParagraph ? "\n\n" : " ";
    const joined = cur ? `${cur}${sep}${u.text}` : u.text;
    const target = rest / Math.ceil(rest / maxChars);
    const over = joined.length > maxChars;
    // Past the target a paragraph end is taken if the take is reasonably full; a sentence end only when
    // stopping here lands closer to the target than taking the sentence would.
    const near =
      joined.length > target &&
      (prevEndsParagraph
        ? cur.length >= 0.6 * target
        : joined.length - target > target - cur.length);
    if (cur && (over || near)) {
      takes.push(cur);
      rest -= cur.length + 1;
      cur = u.text;
    } else cur = joined;
    prevEndsParagraph = u.endsParagraph;
  }
  if (cur) takes.push(cur);
  return takes;
}

/** A deterministic seed (0 to 2^32-1) from any text. */
export function seedFor(key: string): number {
  return crypto.createHash("sha256").update(key).digest().readUInt32BE(0);
}

/** The end of the previous take and the start of the next, cut at a word. */
export function contextFor(
  takes: string[],
  i: number,
  chars = CONTEXT_CHARS,
): { previousText?: string; nextText?: string } {
  const prev = takes[i - 1];
  const next = takes[i + 1];
  const tail = (s: string) =>
    s.length <= chars ? s : s.slice(s.length - chars).replace(/^\S*\s+/, "");
  const head = (s: string) =>
    s.length <= chars ? s : s.slice(0, chars).replace(/\s+\S*$/, "");
  return {
    previousText: prev ? tail(prev) : undefined,
    nextText: next ? head(next) : undefined,
  };
}

/** Request stitching (request ids as context) is not available on eleven_v3, per the ElevenLabs guide. */
export function supportsStitching(modelId: string): boolean {
  return !modelId.startsWith("eleven_v3");
}

export interface LongOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  settings?: SynthOptions["settings"];
  baseUrl?: string;
  /** Measure the takes and re-voice strays (VOICE_TAKE_CHECK). */
  takeCheck?: boolean;
  /** Take size cap; LONG_TAKE_CHARS unless a smoke test wants small takes. */
  takeChars?: number;
  /** Characters the re-voices may spend in all; undefined is no limit beyond MAX_REVOICES. */
  revoiceChars?: number;
  /** Where the voice_consistency event goes (the episode's log). */
  onEvent?: (
    kind: string,
    detail: Record<string, unknown>,
  ) => Promise<void> | void;
}

interface Made {
  file: string;
  words: Word[];
  durationSeconds: number;
  requestId?: string;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const show = (m: TakeMeasure) => ({
  pitch_hz: round(m.pitchHz),
  centroid_hz: Math.round(m.centroidHz),
  high_share: round(m.highShare, 4),
  voiced_frames: m.voicedFrames,
});

export async function synthesiseElevenLabsLong(
  text: string,
  outPath: string,
  opts: LongOptions,
): Promise<Narration> {
  const takes = chunkTakes(text, opts.takeChars ?? LONG_TAKE_CHARS);
  const dir = path.join(path.dirname(outPath), "takes");
  await fs.mkdir(dir, { recursive: true });
  const unsupported = new Set<string>(); // fields the API refused: dropped for the rest of this narration
  const stitching = supportsStitching(opts.modelId);
  const seed = seedFor(`${opts.voiceId}|${text}`);
  const made: Made[] = [];
  const contextOf = (i: number, takeSeed: number): TakeContext => ({
    ...contextFor(takes, i),
    previousRequestIds: stitching
      ? made
          .slice(0, i)
          .map((m) => m.requestId)
          .filter((r): r is string => !!r)
          .slice(-3)
      : undefined,
    nextRequestIds:
      stitching && made[i + 1]?.requestId
        ? [made[i + 1]!.requestId!]
        : undefined,
    seed: takeSeed,
  });
  const speak = async (
    i: number,
    file: string,
    takeSeed: number,
  ): Promise<Made> => {
    const n = await synthesiseElevenLabs(takes[i]!, file, {
      ...opts,
      context: contextOf(i, takeSeed),
      unsupported,
    });
    return {
      file,
      words: n.words,
      durationSeconds: (await decodedSeconds(file)) || n.durationSeconds,
      requestId: n.requestId,
    };
  };
  for (let i = 0; i < takes.length; i++)
    made.push(
      await speak(
        i,
        path.join(dir, `take_${String(i).padStart(3, "0")}.mp3`),
        seed,
      ),
    );
  if (opts.takeCheck !== false && takes.length >= 3) {
    // Never lose a narration over the check: a failure keeps the takes as they are.
    await checkTakes(takes, made, seed, speak, opts).catch((err) =>
      log("warn", "voice consistency check failed; takes kept as made", {
        error: errorMessage(err),
      }),
    );
  }
  if (unsupported.size)
    log("info", "ElevenLabs continuity fields not supported by this model", {
      model: opts.modelId,
      fields: [...unsupported].join(","),
    });
  const words: Word[] = [];
  let offset = 0;
  for (const m of made) {
    for (const w of m.words)
      words.push({
        text: w.text,
        start: w.start + offset,
        end: w.end + offset,
      });
    offset += m.durationSeconds + GAP_SECONDS;
  }
  await stitch(
    made.map((m) => m.file),
    outPath,
  );
  return {
    audioPath: outPath,
    words,
    durationSeconds: offset - GAP_SECONDS + 0.15,
  };
}

/** Measures every take, re-voices up to three strays once and keeps whichever of each pair is closer. */
async function checkTakes(
  takes: string[],
  made: Made[],
  seed: number,
  speak: (i: number, file: string, seed: number) => Promise<Made>,
  opts: LongOptions,
): Promise<void> {
  const measures: TakeMeasure[] = [];
  for (const m of made) measures.push(await measureTake(m.file));
  const norm = normOf(measures);
  const before = spread(measures);
  const picked = outliers(measures, MAX_REVOICES);
  let budget = opts.revoiceChars ?? Infinity;
  const revoiced: Record<string, unknown>[] = [];
  for (const i of picked) {
    const chars = takes[i]!.length;
    if (chars > budget) {
      revoiced.push({ take: i, skipped: "character budget" });
      continue;
    }
    budget -= chars;
    const alt = await speak(
      i,
      made[i]!.file.replace(/\.mp3$/, "_revoice.mp3"),
      seedFor(`${seed}:${i}:revoice`),
    );
    const altMeasure = await measureTake(alt.file);
    const kept = closer(measures[i]!, altMeasure, norm);
    const d0 = deviation(measures[i]!, norm);
    const d1 = deviation(altMeasure, norm);
    revoiced.push({
      take: i,
      chars,
      original: {
        ...show(measures[i]!),
        pitch_off_pct: round(d0.pitch * 100),
        centroid_off_pct: round(d0.centroid * 100),
      },
      revoice: {
        ...show(altMeasure),
        pitch_off_pct: round(d1.pitch * 100),
        centroid_off_pct: round(d1.centroid * 100),
      },
      kept,
    });
    if (kept === "revoice") {
      await fs.rename(alt.file, made[i]!.file);
      made[i] = { ...alt, file: made[i]!.file };
      measures[i] = altMeasure;
    } else await fs.rm(alt.file, { force: true });
  }
  const after = spread(measures);
  const detail = {
    takes: measures.map((m, i) => {
      const d = deviation(m, norm);
      return {
        take: i,
        chars: takes[i]!.length,
        ...show(m),
        pitch_off_pct: round(d.pitch * 100),
        centroid_off_pct: round(d.centroid * 100),
      };
    }),
    norm: {
      pitch_hz: round(norm.pitchHz),
      centroid_hz: Math.round(norm.centroidHz),
      high_share: round(norm.highShare, 4),
    },
    limits: { pitch_pct: 5, centroid_pct: 10, max_revoices: MAX_REVOICES },
    revoiced,
    spread_before: before,
    spread_after: after,
  };
  log("info", "voice consistency", {
    takes: takes.length,
    revoiced: revoiced.filter((r) => r.kept).length,
    kept_revoice: revoiced.filter((r) => r.kept === "revoice").length,
    pitch_spread: `${before.pitchPct}% -> ${after.pitchPct}%`,
    centroid_spread: `${before.centroidPct}% -> ${after.centroidPct}%`,
    high_band_spread: `${before.highPct}% -> ${after.highPct}%`,
  });
  await opts.onEvent?.("voice_consistency", detail);
}
