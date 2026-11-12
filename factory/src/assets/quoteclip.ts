// The clip a character quote plays (CHARACTER_QUOTES): the line's stretch of the scene index's own upload, fetched
// with its sound at the best picture on offer, cut at the quietest moments just outside the spoken words, its sound
// brought to the narration's loudness (the 12 Nov demo measured narration, quote and reaction alike at -15.6 LUFS)
// with short fades, and framed without the game's burned-in subtitles: the subtitles are found by reading the
// frames for the quote's own words (src/assets/ocr.ts), and the picture is cropped above them. A Short takes an
// upright crop where the subject's detail is when the source is tall enough to fill the frame without blowing up,
// and a framed picture (the crop shown whole over its own blur) when it is not; a long video takes the 16:9 crop.
// Every step that can fail throws: the caller takes the quote out of the script rather than play a bad clip.

import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../lib/bin.ts";
import { runCapped } from "../lib/child.ts";
import { log } from "../lib/util.ts";
import { blackSeconds, loudness } from "../qa/media.ts";
import { readText, type OcrPage } from "./ocr.ts";
import { quietCut, quoteSpan } from "../sceneindex/quotepick.ts";
import type { SceneIndex } from "../sceneindex/schema.ts";
import type { CharacterQuote } from "../editorial/charquote.ts";

/** A quote's clip, ready for the render: relative to the episode folder. */
export interface PreparedQuote {
  id: string;
  file: string;
  seconds: number;
  /** "bleed": fills the upright frame; "framed": shown whole over its own blur (a source too small to fill it). */
  mode: "bleed" | "framed";
  width: number;
  height: number;
  /** Integrated loudness of the clip as made, and the narration's it was matched to. */
  lufs: number;
  targetLufs: number;
  /** Seconds into the source of the cut, and the crop taken from the source picture (pixels). */
  cutIn: number;
  cutOut: number;
  crop: { x: number; y: number; w: number; h: number };
  /** The share of the source picture's height kept above the subtitles. */
  keep: number;
  /** The quote's words, seconds from the clip's start (the caption follows them). */
  words: Array<{ text: string; start: number; end: number }>;
}

/** Seconds of the source fetched either side of the line, so the cut can find its quiet moments. */
export const SECTION_MARGIN = 1.2;
/** The shortest upright crop height (source pixels) that fills a 1080x1920 frame without a visible blow-up. */
export const BLEED_MIN_HEIGHT = 1250;
/** Fade in and out of the quote's sound, seconds: no click, no swallowed first syllable. */
export const FADE_IN = 0.05;
export const FADE_OUT = 0.12;
/** When the subtitles cannot be found but the game shows them (the line was read off the screen too). */
export const SUBTITLE_KEEP_FALLBACK = 0.68;

// ---------------------------------------------------------------- pure helpers

/** Loudness in dB of each `step` seconds of mono samples (pure). */
export function envelopeDb(
  samples: Float32Array,
  rate: number,
  step = 0.01,
): number[] {
  const n = Math.max(1, Math.round(rate * step));
  const out: number[] = [];
  for (let i = 0; i + n <= samples.length; i += n) {
    let sum = 0;
    for (let k = i; k < i + n; k++) sum += samples[k]! * samples[k]!;
    out.push(10 * Math.log10(sum / n + 1e-12));
  }
  return out;
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * The top of the game's subtitles as a share of the picture's height (pure), or undefined when none of the quote's
 * words (or the speaker's name label) are read in the lower half of any frame. A word counts when it is one of
 * the quote's or the speaker's words, three letters or more.
 */
export function subtitleTop(
  pages: readonly OcrPage[],
  quote: string,
  speaker: string,
): number | undefined {
  const want = new Set(
    [...quote.split(/\s+/), ...speaker.split(/\s+/)]
      .map(norm)
      .filter((w) => w.length >= 3),
  );
  let top: number | undefined;
  for (const p of pages) {
    if (!p.height) continue;
    for (const w of p.words) {
      const y = w.y / p.height;
      if (y < 0.45 || !want.has(norm(w.text))) continue;
      top = Math.min(top ?? 1, y);
    }
  }
  return top;
}

/**
 * Where an upright window of `share` of the width sits (pure): the stretch of columns with the most detail in the
 * kept rows, leaning towards the centre. `frames` are greyscale, `width` x `height`, rows below `keepRows` ignored.
 * Returns the window's left edge as a share of the width.
 */
export function busiestWindow(
  frames: readonly Uint8Array[],
  width: number,
  height: number,
  keepRows: number,
  share: number,
): number {
  if (share >= 1 || !frames.length) return 0;
  const col = new Float64Array(width);
  for (const f of frames)
    for (let y = 0; y < Math.min(height, keepRows); y++)
      for (let x = 1; x < width; x++)
        col[x] = col[x]! + Math.abs(f[y * width + x]! - f[y * width + x - 1]!);
  const win = Math.max(1, Math.round(width * share));
  let sum = 0;
  for (let x = 0; x < win; x++) sum += col[x]!;
  let best = -1;
  let bestX = Math.round((width - win) / 2);
  for (let x = 0; x + win <= width; x++) {
    if (x > 0) sum += col[x + win - 1]! - col[x - 1]!;
    const centre = (x + win / 2) / width;
    const lean = 1 - 0.35 * Math.abs(centre - 0.5) * 2;
    if (sum * lean > best) {
      best = sum * lean;
      bestX = x;
    }
  }
  return bestX / width;
}

/** The crop of a `w` x `h` source for a quote (pure): above the subtitles, upright or 16:9. */
export function quoteCrop(
  w: number,
  h: number,
  keep: number,
  o: { upright: boolean; left?: number },
): {
  crop: { x: number; y: number; w: number; h: number };
  mode: "bleed" | "framed";
} {
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const ch = even(h * Math.min(1, Math.max(0.4, keep)));
  if (!o.upright) {
    const cw = even(Math.min(w, (ch * 16) / 9));
    const chh = even(Math.min(ch, (cw * 9) / 16));
    return {
      crop: { x: even((w - cw) / 2), y: 0, w: cw, h: chh },
      mode: "bleed",
    };
  }
  if (ch >= BLEED_MIN_HEIGHT) {
    const cw = even((ch * 9) / 16);
    const left = Math.min(
      w - cw,
      Math.max(0, Math.round((o.left ?? (1 - cw / w) / 2) * w)),
    );
    return { crop: { x: even(left), y: 0, w: cw, h: ch }, mode: "bleed" };
  }
  // Too small to fill the upright frame: the crop is shown whole, framed, at up to 16:9.
  const cw = even(Math.min(w, (ch * 16) / 9));
  return {
    crop: { x: even((w - cw) / 2), y: 0, w: cw, h: ch },
    mode: "framed",
  };
}

// ---------------------------------------------------------------- the clip

export interface QuoteClipDeps {
  download?: (
    videoId: string,
    from: number,
    to: number,
    file: string,
  ) => Promise<void>;
  ocr?: (files: string[]) => Promise<Map<string, OcrPage>>;
}

export interface QuoteClipOptions {
  quote: CharacterQuote;
  index: SceneIndex;
  episodeDir: string;
  ytdlp: string;
  /** The narration's integrated loudness, LUFS: the quote is matched to it. */
  targetLufs: number;
  /** A Short's upright frame; false for a long video's 16:9. */
  upright: boolean;
  deps?: QuoteClipDeps;
}

/** The section of the source, with its sound, at up to 2160p: exact cut points (keyframes forced at the cuts). */
export function quoteDownloadArgs(
  videoId: string,
  from: number,
  to: number,
  file: string,
  ffmpegDir?: string,
): string[] {
  return [
    "--no-playlist",
    "--no-warnings",
    "-f",
    // Direct (not HLS) streams only: seeking into an HLS 4K stream took over five minutes. VP9 or H.264 first, as
    // AV1 decodes at a third of real time here; then anything direct; then the combined file.
    "bv*[height<=2160][vcodec~='^(vp0?9|avc)'][protocol^=http]+ba[protocol^=http]/bv*[height<=2160][vcodec!^=av01][protocol^=http]+ba[protocol^=http]/bv*[height<=2160][protocol^=http]+ba[protocol^=http]/b[height<=2160]",
    "--download-sections",
    `*${from.toFixed(2)}-${to.toFixed(2)}`,
    "--force-keyframes-at-cuts",
    "--merge-output-format",
    "mkv",
    ...(ffmpegDir ? ["--ffmpeg-location", ffmpegDir] : []),
    "-o",
    file,
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
}

async function probeSize(
  file: string,
): Promise<{ w: number; h: number; audio: boolean }> {
  const { stderr } = await runCapped(FFMPEG, ["-hide_banner", "-i", file], {
    timeout: 30_000,
  }).catch((err: { stderr?: unknown }) => ({
    stderr: String(err?.stderr ?? ""),
  }));
  const m = String(stderr).match(/Video:.*?(\d{3,5})x(\d{3,5})/);
  return {
    w: Number(m?.[1] ?? 0),
    h: Number(m?.[2] ?? 0),
    audio: /Audio:/.test(String(stderr)),
  };
}

async function samples(
  file: string,
  from: number,
  seconds: number,
): Promise<Float32Array> {
  const raw = `${file}.f32`;
  try {
    await runCapped(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        "-ss",
        from.toFixed(3),
        "-t",
        seconds.toFixed(3),
        "-i",
        file,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "f32le",
        raw,
      ],
      { timeout: 60_000 },
    );
    const b = await fs.readFile(raw);
    return new Float32Array(
      b.buffer,
      b.byteOffset,
      Math.floor(b.byteLength / 4),
    );
  } finally {
    await fs.rm(raw, { force: true }).catch(() => undefined);
  }
}

async function grayFrames(
  file: string,
  times: number[],
  w: number,
  h: number,
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const t of times) {
    const raw = `${file}.${Math.round(t * 1000)}.gray`;
    try {
      await runCapped(
        FFMPEG,
        [
          "-v",
          "error",
          "-y",
          "-ss",
          t.toFixed(3),
          "-i",
          file,
          "-frames:v",
          "1",
          "-vf",
          `scale=${w}:${h},format=gray`,
          "-f",
          "rawvideo",
          raw,
        ],
        { timeout: 60_000 },
      );
      const b = await fs.readFile(raw);
      if (b.length >= w * h) out.push(new Uint8Array(b.subarray(0, w * h)));
    } catch {
      /* a frame that will not decode is left out */
    } finally {
      await fs.rm(raw, { force: true }).catch(() => undefined);
    }
  }
  return out;
}

async function stills(
  file: string,
  times: number[],
  dir: string,
  vf?: string,
): Promise<string[]> {
  const files: string[] = [];
  for (const [i, t] of times.entries()) {
    const f = path.join(dir, `ocr_${i}.png`);
    await runCapped(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        "-ss",
        t.toFixed(3),
        "-i",
        file,
        "-frames:v",
        "1",
        ...(vf ? ["-vf", vf] : []),
        f,
      ],
      { timeout: 60_000 },
    ).catch(() => undefined);
    if (
      await fs.stat(f).then(
        () => true,
        () => false,
      )
    )
      files.push(f);
  }
  return files;
}

/** Fetches, cuts, frames and loudness-matches one quote's clip into `<episodeDir>/quote_<id>.mp4`. Throws on any fault. */
export async function prepareQuoteClip(
  o: QuoteClipOptions,
): Promise<PreparedQuote> {
  const q = o.quote;
  const line = o.index.lines.find(
    (l) => `q${Math.round(l.start * 10)}` === q.id,
  );
  if (!line) throw new Error(`quote ${q.id} is not in the index`);
  const span = quoteSpan(o.index, line);
  const from = Math.max(0, span.from - SECTION_MARGIN);
  const to = span.to + SECTION_MARGIN;
  const work = path.join(o.episodeDir, `quote_${q.id}_work`);
  await fs.mkdir(work, { recursive: true });
  const section = path.join(work, "section.mkv");
  const file = `quote_${q.id}.mp4`;
  const out = path.join(o.episodeDir, file);
  try {
    if (
      !(await fs.stat(section).then(
        (s) => s.size > 0,
        () => false,
      ))
    ) {
      const download =
        o.deps?.download ??
        ((id: string, a: number, b: number, f: string) =>
          runCapped(
            o.ytdlp,
            quoteDownloadArgs(id, a, b, f, path.dirname(FFMPEG) || undefined),
            {
              timeout: 300_000,
              maxBuffer: 16 * 1024 * 1024,
            },
          ).then(() => undefined));
      await download(q.videoId, from, to, section);
    }
    const size = await probeSize(section);
    if (!size.w || !size.h)
      throw new Error("the quote's section has no picture");
    if (!size.audio) throw new Error("the quote's section has no sound");
    // Cut points: the quietest moment in the lead-in and in the tail, never inside the words.
    const env = envelopeDb(await samples(section, 0, to - from), 16000, 0.01);
    const rel = (t: number) => t - from;
    const cutIn = quietCut(
      env,
      0.01,
      rel(span.from) - 0.1,
      rel(span.wordsFrom) - 0.06,
      rel(span.from),
    );
    const cutOut = quietCut(
      env,
      0.01,
      rel(span.wordsTo) + 0.12,
      rel(span.to),
      rel(span.to),
    );
    const seconds = Math.round((cutOut - cutIn) * 1000) / 1000;
    if (!(seconds > 0.5)) throw new Error("the quote's cut is empty");
    // The subtitles: the quote's own words read in the lower half of a few frames during the line.
    const during = [0.25, 0.5, 0.75].map(
      (f) => rel(span.wordsFrom) + f * (span.wordsTo - span.wordsFrom),
    );
    const ocr =
      o.deps?.ocr ??
      ((files: string[]) => readText(files, { sentences: true }));
    const read = await ocr(await stills(section, during, work));
    const top = subtitleTop([...read.values()], q.text, q.speaker);
    const shown = line.via === "both";
    const keep =
      top !== undefined
        ? Math.max(0.45, top - 0.025)
        : shown
          ? SUBTITLE_KEEP_FALLBACK
          : 1;
    // Where the subject's detail is, for the upright crop.
    const GW = 192;
    const GH = Math.max(2, Math.round((GW * size.h) / size.w));
    const frames = await grayFrames(section, during, GW, GH);
    const ch = size.h * keep;
    const left = busiestWindow(
      frames,
      GW,
      GH,
      Math.round(GH * keep),
      (ch * 9) / 16 / size.w,
    );
    const { crop, mode } = quoteCrop(size.w, size.h, keep, {
      upright: o.upright,
      left,
    });
    const [W, H] = o.upright
      ? mode === "bleed"
        ? [1080, 1920]
        : [1080, Math.round((1080 * crop.h) / crop.w / 2) * 2]
      : [1920, 1080];
    // The sound at the narration's loudness: measure, then a linear gain (a 2-6 s line is too short for loudnorm's dynamics).
    const probe = path.join(work, "probe.wav");
    await runCapped(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        "-ss",
        cutIn.toFixed(3),
        "-t",
        seconds.toFixed(3),
        "-i",
        section,
        "-vn",
        "-ac",
        "2",
        "-ar",
        "48000",
        probe,
      ],
      { timeout: 60_000 },
    );
    const measured = await loudness(probe);
    if (!Number.isFinite(measured))
      throw new Error("the quote's sound could not be measured");
    const gain = Math.max(-20, Math.min(20, o.targetLufs - measured));
    const vf = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${W}:${H}:flags=lanczos,fps=30,format=yuv420p`;
    const af = `volume=${gain.toFixed(2)}dB,alimiter=limit=0.89:level=disabled,afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${Math.max(0, seconds - FADE_OUT).toFixed(3)}:d=${FADE_OUT},aresample=48000`;
    await runCapped(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        "-ss",
        cutIn.toFixed(3),
        "-t",
        seconds.toFixed(3),
        "-i",
        section,
        "-vf",
        vf,
        "-af",
        af,
        "-c:v",
        "libx264",
        "-crf",
        "16",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        out,
      ],
      { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const lufs = await loudness(out);
    const black = await blackSeconds(out).catch(() => 0);
    if (black > 0.1)
      throw new Error(`the quote's clip has ${black.toFixed(2)} s of black`);
    // The subtitles must be gone: the finished frames are read again for the quote's words.
    const after = await ocr(
      await stills(
        out,
        [0.3, 0.5, 0.7].map((f) => f * seconds),
        work,
      ),
    );
    const left2 = [...after.values()]
      .flatMap((p) => p.words)
      .filter((w) => {
        const n = norm(w.text);
        return n.length >= 4 && q.text.split(/\s+/).map(norm).includes(n);
      });
    if (left2.length >= 2)
      throw new Error(
        `the quote's subtitles still show (${left2.map((w) => w.text).join(" ")})`,
      );
    const words = (line.words ?? []).map((w) => ({
      text: w.text,
      start: Math.round((w.start - from - cutIn) * 1000) / 1000,
      end: Math.round((w.end - from - cutIn) * 1000) / 1000,
    }));
    log("info", "character quote clip made", {
      id: q.id,
      seconds,
      mode,
      keep,
      lufs,
      target: o.targetLufs,
    });
    return {
      id: q.id,
      file,
      seconds,
      mode,
      width: W,
      height: H,
      lufs: Math.round(lufs * 10) / 10,
      targetLufs: Math.round(o.targetLufs * 10) / 10,
      cutIn: Math.round((from + cutIn) * 1000) / 1000,
      cutOut: Math.round((from + cutOut) * 1000) / 1000,
      crop,
      keep: Math.round(keep * 1000) / 1000,
      words,
    };
  } catch (err) {
    await fs.rm(out, { force: true }).catch(() => undefined);
    throw err;
  } finally {
    // The section is kept for a retry until the clip exists; the frames read for text never are.
    for (const f of await fs.readdir(work).catch(() => [] as string[]))
      if (f.startsWith("ocr_") || f === "probe.wav")
        await fs.rm(path.join(work, f), { force: true }).catch(() => undefined);
    if (
      await fs.stat(out).then(
        () => true,
        () => false,
      )
    )
      await fs
        .rm(work, { recursive: true, force: true })
        .catch(() => undefined);
  }
}
