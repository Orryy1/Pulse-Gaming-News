// The render plan for a long-form 16:9 video. Simpler than the Short's: each
// entry of a ranking owns a run of shots that alternate its trailer moments
// with its art on slow moves; the intro uses the topic's own art and the
// outro returns to the winner. Pure, so the same inputs always plan the same.

import type { Segment } from "./timeline.ts";
import type { MovePreset } from "./motion.ts";

export const LONG_FPS = 30;
export const LONG_WIDTH = 1920;
export const LONG_HEIGHT = 1080;
export const LONG_TAIL_SECONDS = 6; // end card after the last word
const STILL_SHOT = 180; // 6 s on a still
const MIN_SHOT = 60; // never a shot under 2 s
const MAX_STILL_SHOT = 240; // 8 s at most on one still

export interface LongImage {
  kind: string;
  aspect: number;
  beatIndex?: number;
  moment?: number; // the sentence of the entry it was picked for
}

export interface LongClip {
  durationSeconds: number;
  beatIndex?: number;
  role?: "hook";
  moment?: number;
}

/** One sentence of a ranking entry on the timeline (seconds). */
export interface MomentWindow {
  entry: number;
  moment: number;
  start: number;
  end: number;
}

/** Sentences as the script splits them (kept here so the renderer needs no editorial code). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'‘])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Where each sentence of each ranking entry starts and ends, from the voice's
 * word timings: sentence k begins at the word that follows the previous
 * sentences' words. counts[e] is the number of moments entry e has.
 */
export function momentWindows(
  segments: Segment[],
  words: Array<{ start: number; end: number }>,
  counts: number[],
): MomentWindow[] {
  const out: MomentWindow[] = [];
  for (const [i, seg] of segments.entries()) {
    if (seg.kind !== "beat") continue;
    const e = entryOf(segments, i);
    const n = e === undefined ? 0 : (counts[e] ?? 0);
    if (!n || e === undefined) continue;
    const segEnd = i === segments.length - 1 ? seg.end : segments[i + 1]!.start;
    const ws = words.filter(
      (w) => w.start >= seg.start - 0.05 && w.start < segEnd,
    );
    const lens = splitSentences(seg.text).map(
      (x) => x.split(/\s+/).filter(Boolean).length,
    );
    const k = Math.min(n, lens.length || 1);
    const starts: number[] = [];
    let idx = 0;
    for (let j = 0; j < k; j++) {
      starts.push(j === 0 ? seg.start : (ws[idx]?.start ?? seg.start));
      idx += lens[j] ?? 0;
    }
    for (let j = 0; j < k; j++)
      out.push({
        entry: e,
        moment: j,
        start: starts[j]!,
        end: j === k - 1 ? segEnd : starts[j + 1]!,
      });
  }
  return out;
}

export interface LongPlanInput {
  segments: Segment[];
  words: Array<{ text: string; start: number; end: number }>;
  durationSeconds: number; // includes the tail
  images: LongImage[];
  clips: LongClip[];
  variant: number;
  /** Moments per ranking entry: when given, each sentence gets its own matched picture. */
  momentCounts?: number[];
}

export type LongMedia = { type: "image" | "clip" | "plate"; index: number };

export interface LongShot {
  start: number; // frame
  end: number; // exclusive
  segment: number;
  media: LongMedia;
  move: MovePreset;
}

export interface LongPlan {
  version: 1;
  fps: number;
  totalFrames: number;
  tailFrames: number;
  shots: LongShot[];
}

const toFrame = (s: number) => Math.round(s * LONG_FPS);
const MOVES: MovePreset[] = ["pushIn", "pullBack", "pushPan", "driftDown"];

/**
 * Which entry a segment belongs to: beats count up from zero; the take belongs
 * to the winner (the last beat). In a documentary a chapter spans many beats:
 * each "chapter" card starts the next entry, and the outro belongs to the last.
 */
export function entryOf(segments: Segment[], i: number): number | undefined {
  const seg = segments[i]!;
  if (segments.some((s) => s.visual?.kind === "chapter")) {
    const upTo = segments
      .slice(0, i + 1)
      .filter((s) => s.kind === "beat" && s.visual?.kind === "chapter").length;
    if (seg.kind === "beat") return upTo > 0 ? upTo - 1 : undefined;
    if (seg.kind === "take") return upTo > 0 ? upTo - 1 : undefined;
    return undefined;
  }
  const beats = segments.filter((s) => s.kind === "beat").length;
  if (seg.kind === "beat")
    return segments.slice(0, i).filter((s) => s.kind === "beat").length;
  if (seg.kind === "take" && beats > 0) return beats - 1;
  return undefined;
}

export function buildLongPlan(input: LongPlanInput): LongPlan {
  const { segments, images, clips, variant } = input;
  const totalFrames = Math.max(
    LONG_FPS * 10,
    Math.ceil(input.durationSeconds * LONG_FPS),
  );
  const tailFrames = toFrame(LONG_TAIL_SECONDS);
  const shots: LongShot[] = [];
  const clipFrames = clips.map((c) =>
    Math.max(MIN_SHOT, Math.floor(c.durationSeconds * LONG_FPS)),
  );
  const clipUsed = clips.map(() => false);
  const stillUses = images.map(() => 0);
  // Where each entry's stills left off, so a chapter's paragraphs walk its gallery instead of restarting it.
  const cursors = new Map<number | undefined, number>();
  let shotIndex = 0;
  let last: LongMedia | undefined;
  const same = (a: LongMedia | undefined, b: LongMedia) =>
    !!a && a.type === b.type && a.index === b.index;

  const windows = input.momentCounts?.length
    ? momentWindows(segments, input.words, input.momentCounts)
    : [];
  /** Fills [from, to) with a queue of media, never stretching a clip and never leaving a sliver. */
  const fill = (
    seg: number,
    from: number,
    to: number,
    queue: LongMedia[],
    fallback: () => LongMedia,
    stillFallback?: () => LongMedia,
  ) => {
    let at = from;
    while (at < to) {
      const remaining = to - at;
      if (
        remaining < MIN_SHOT &&
        shots.length &&
        shots[shots.length - 1]!.segment === seg &&
        shots[shots.length - 1]!.media.type !== "clip"
      ) {
        shots[shots.length - 1]!.end = to;
        break;
      }
      let media = queue.shift() ?? fallback();
      if (same(last, media) && queue.length) {
        queue.push(media);
        media = queue.shift()!;
      }
      let len: number;
      if (media.type === "clip") {
        len = Math.min(clipFrames[media.index]!, remaining);
        const left = remaining - len;
        if (left > 0 && left < MIN_SHOT) len -= MIN_SHOT - left;
        if (len < MIN_SHOT) {
          // Too short for the gap: take the fallback, but a clip it hands back is still a clip.
          // Stretching it as if it were a still froze it on its last frame and left it free to play again.
          let alt = fallback();
          if (alt.type === "clip") {
            const l = Math.min(clipFrames[alt.index]!, remaining);
            const rest = remaining - l;
            if (l >= MIN_SHOT && (rest === 0 || rest >= MIN_SHOT)) {
              media = alt;
              len = l;
              clipUsed[alt.index] = true;
            } else alt = stillFallback?.() ?? { type: "plate", index: 0 };
          }
          if (alt.type !== "clip") {
            media = alt;
            len = Math.min(MAX_STILL_SHOT, remaining);
          }
        } else clipUsed[media.index] = true;
      } else {
        len = Math.min(
          STILL_SHOT + ((shotIndex * 37 + variant * 11) % 60) - 30,
          remaining,
          MAX_STILL_SHOT,
        );
        if (remaining - len < MIN_SHOT) len = remaining;
      }
      if (media.type === "image") stillUses[media.index]!++;
      shots.push({
        start: at,
        end: at + len,
        segment: seg,
        media,
        move:
          shotIndex === 0
            ? "pushIn"
            : MOVES[(shotIndex * 7 + variant) % MOVES.length]!,
      });
      last = media;
      at += len;
      shotIndex++;
    }
  };

  for (const [i, seg] of segments.entries()) {
    const start = i === 0 ? 0 : toFrame(seg.start);
    const end =
      i === segments.length - 1 ? totalFrames : toFrame(segments[i + 1]!.start);
    if (end - start <= 0) continue;
    const entry = entryOf(segments, i);
    // A ranking entry with a shot list: each sentence opens on what it names.
    const mine =
      seg.kind === "beat" ? windows.filter((w) => w.entry === entry) : [];
    if (mine.length && entry !== undefined) {
      const allEntry = images
        .map((_, k) => k)
        .filter(
          (k) =>
            images[k]!.beatIndex === entry && images[k]!.kind !== "capsule",
        );
      const noHero = allEntry.filter((k) => images[k]!.kind !== "hero");
      const entryImages = noHero.length >= 4 ? noHero : allEntry;
      const entryClips = clips
        .map((_, k) => k)
        .filter((k) => clips[k]!.beatIndex === entry);
      const leastUsed = (): LongMedia => {
        const pool = entryImages.length
          ? entryImages
          : images
              .map((_, k) => k)
              .filter((k) => images[k]!.beatIndex === undefined);
        if (!pool.length) return { type: "plate", index: 0 };
        const pick =
          [...pool]
            .sort((a, b) => stillUses[a]! - stillUses[b]! || a - b)
            .find((k) => !same(last, { type: "image", index: k })) ?? pool[0]!;
        return { type: "image", index: pick };
      };
      for (const [j, w] of mine.entries()) {
        const from = j === 0 ? start : Math.max(start, toFrame(w.start));
        const to =
          j === mine.length - 1
            ? end
            : Math.min(end, toFrame(mine[j + 1]!.start));
        if (to <= from) continue;
        // Every clip picked for this sentence (a trailer moment and a gameplay moment), then its still.
        const mineClips = entryClips.filter(
          (k) => clips[k]!.moment === w.moment && !clipUsed[k],
        );
        const still = entryImages.find((k) => images[k]!.moment === w.moment);
        const queue: LongMedia[] = [];
        // The entry opens on its art so the rank card lands over a picture; later sentences open on footage.
        // With no picture of its own for the first sentence it borrows the entry's art: a dark clip under the rank card reads as an empty frame.
        if (j === 0) {
          const opener =
            still ??
            (entryImages.length
              ? (leastUsed() as { type: "image"; index: number }).index
              : undefined);
          if (opener !== undefined)
            queue.push({ type: "image", index: opener });
        }
        for (const k of mineClips) queue.push({ type: "clip", index: k });
        if (j !== 0 && still !== undefined)
          queue.push({ type: "image", index: still });
        // When the sentence's own media runs out, any unused footage of the entry comes before another still.
        const footageFirst = (): LongMedia => {
          const spare = entryClips.find(
            (k) =>
              !clipUsed[k] &&
              !queue.some((q) => q.type === "clip" && q.index === k),
          );
          return spare !== undefined
            ? { type: "clip", index: spare }
            : leastUsed();
        };
        fill(i, from, to, queue, footageFirst, leastUsed);
      }
      continue;
    }
    // The pool: the entry's own media, or the topic's untagged media for the intro; the outro may reuse the winner's.
    const ownClips = clips
      .map((c, k) => k)
      .filter(
        (k) =>
          (entry === undefined
            ? clips[k]!.beatIndex === undefined
            : clips[k]!.beatIndex === entry) &&
          (seg.kind === "take" || !clipUsed[k]),
      );
    const ownStills = images
      .map((_, k) => k)
      .filter((k) =>
        entry === undefined
          ? images[k]!.beatIndex === undefined
          : images[k]!.beatIndex === entry,
      );
    // The intro of a ranking is a montage: the topic's own art plus one picture from every entry.
    const montage =
      seg.kind === "hook" && images.some((im) => im.beatIndex !== undefined)
        ? [
            ...new Set(
              images
                .map((im) => im.beatIndex)
                .filter((b): b is number => b !== undefined),
            ),
          ]
            .map((b) =>
              images.findIndex(
                (im) =>
                  im.beatIndex === b &&
                  (im.kind === "screenshot" || im.kind === "photo"),
              ),
            )
            .filter((k) => k >= 0)
        : [];
    const stills = ownStills.length
      ? [...ownStills, ...montage]
      : [
          ...images
            .map((_, k) => k)
            .filter((k) => images[k]!.beatIndex === undefined),
          ...montage,
        ];
    // Wide art first on a still shot: hero, screenshots, then the rest; capsules (portrait) come last.
    const sorted = [...stills].sort(
      (a, b) => stillRank(images[a]!) - stillRank(images[b]!) || a - b,
    );
    // A documentary chapter alternates the game's pictures with archive photos of the real story.
    const photos = sorted.filter((k) => images[k]!.kind === "photo");
    const others = sorted.filter((k) => images[k]!.kind !== "photo");
    const order: number[] = [];
    for (let k = 0; k < Math.max(photos.length, others.length); k++) {
      if (others[k] !== undefined) order.push(others[k]!);
      if (photos[k] !== undefined) order.push(photos[k]!);
    }
    let at = start;
    let turn = seg.kind === "hook" ? 0 : 1; // the intro opens on a moment; an entry opens on its art so the card lands over a picture
    let stillCursor = cursors.get(entry) ?? 0;
    while (at < end) {
      const remaining = end - at;
      const nextStill = (): LongMedia | undefined => {
        if (!order.length) return undefined;
        let pick = order[stillCursor % order.length]!;
        if (same(last, { type: "image", index: pick }) && order.length > 1)
          pick = order[(stillCursor + 1) % order.length]!;
        stillCursor++;
        stillUses[pick]!++;
        return { type: "image", index: pick };
      };
      // A sliver left by segment rounding joins the previous still, or becomes a brief still of its own:
      // a clip shot is never stretched past its clip, which would play as black.
      if (remaining < MIN_SHOT && shots.length) {
        const prev = shots[shots.length - 1]!;
        if (prev.media.type !== "clip" && prev.segment === i) prev.end = end;
        else {
          const media = nextStill() ?? { type: "plate" as const, index: 0 };
          shots.push({ start: at, end, segment: i, media, move: "settle" });
          last = media;
        }
        at = end;
        break;
      }
      let media: LongMedia | undefined;
      let len = 0;
      const wantClip = turn % 2 === 0 || !order.length;
      const clipIdx = wantClip
        ? ownClips.find((k) => !clipUsed[k] || seg.kind === "take")
        : undefined;
      if (clipIdx !== undefined) {
        // The clip plays only as long as it lasts; what it would leave behind must be a whole shot.
        let clipLen = Math.min(clipFrames[clipIdx]!, remaining);
        const left = remaining - clipLen;
        if (left > 0 && left < MIN_SHOT) clipLen -= MIN_SHOT - left;
        if (clipLen >= MIN_SHOT) {
          media = { type: "clip", index: clipIdx };
          clipUsed[clipIdx] = true;
          if (seg.kind === "take")
            ownClips.splice(ownClips.indexOf(clipIdx), 1);
          len = clipLen;
        }
      }
      if (!media) {
        media = nextStill();
        if (media) {
          len = Math.min(
            STILL_SHOT + ((shotIndex * 37 + variant * 11) % 60) - 30,
            remaining,
            MAX_STILL_SHOT,
          );
        } else {
          media = { type: "plate", index: 0 };
          len = Math.min(MAX_STILL_SHOT, remaining);
        }
        // A short tail is folded into this still rather than left as a flash.
        if (remaining - len < MIN_SHOT) len = remaining;
      }
      shots.push({
        start: at,
        end: at + len,
        segment: i,
        media,
        move:
          shotIndex === 0
            ? "pushIn"
            : MOVES[(shotIndex * 7 + variant) % MOVES.length]!,
      });
      last = media;
      at += len;
      shotIndex++;
      turn++;
    }
    cursors.set(entry, stillCursor);
  }
  // Never the same still twice in a row: the second would restart its move and visibly jump. Hold the first instead.
  const merged: LongShot[] = [];
  for (const sh of shots) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.media.type === "image" &&
      sh.media.type === "image" &&
      prev.media.index === sh.media.index &&
      prev.end === sh.start
    )
      prev.end = sh.end;
    else merged.push({ ...sh });
  }
  return { version: 1, fps: LONG_FPS, totalFrames, tailFrames, shots: merged };
}

function stillRank(img: LongImage): number {
  if (img.kind === "hero") return 0;
  if (img.kind === "screenshot") return 1;
  if (img.kind === "header" || img.kind === "article") return 2;
  return 3;
}

/** The shot on screen at a frame. */
export function longShotAt(
  plan: LongPlan,
  frame: number,
): LongShot | undefined {
  return (
    plan.shots.find((s) => frame >= s.start && frame < s.end) ??
    plan.shots.at(-1)
  );
}

/** Chapter marks for the description: the intro at 0:00, then each entry, then the pick. */
export function chapterLines(
  segments: Segment[],
  labels: (seg: Segment, i: number) => string | undefined,
): string[] {
  const out: string[] = [];
  for (const [i, seg] of segments.entries()) {
    const label = labels(seg, i);
    if (!label) continue;
    const t = i === 0 ? 0 : Math.max(0, Math.floor(seg.start));
    // YouTube wants the first chapter at 0:00 and every chapter at least ten seconds long.
    const prev = out.at(-1);
    if (
      prev &&
      t -
        Number(
          prev
            .split(" ")[0]!
            .split(":")
            .reduce((a, b) => a * 60 + Number(b), 0),
        ) <
        10
    )
      continue;
    const m = Math.floor(t / 60);
    const s = String(t % 60).padStart(2, "0");
    out.push(`${m}:${s} ${label}`);
  }
  return out;
}

/**
 * A long game name breaks after its colon, so the series and the subtitle each
 * keep their words together: "CALL OF DUTY 4:" over "MODERN WARFARE".
 */
export function titleLines(text: string): string[] {
  const i = text.indexOf(": ");
  if (i > 0 && text.length > 20)
    return [text.slice(0, i + 1), text.slice(i + 2)];
  // "Call of Duty Campaigns Ranked": the franchise on top, what is ranked underneath.
  const ranked = text.match(/^(\S+(?:\s+\S+)+?)\s+(\S+\s+Ranked\b.*)$/i);
  if (ranked && text.length > 20) return [ranked[1]!, ranked[2]!];
  return [text];
}

/** A graphic worth showing: never the entry's own rank (the rank card already says it). */
export function usefulGraphic<
  G extends { kind: string; primary: string; secondary: string },
>(g: G): boolean {
  if (g.kind === "none") return false;
  const text = `${g.primary} ${g.secondary}`;
  if (
    /\b(rank(ing)?|position|place[sd]?|spot|on the list|where it lands|entry number)\b/i.test(
      text,
    )
  )
    return false;
  if (
    /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|#?\d{1,2})$/i.test(
      g.primary.trim(),
    )
  )
    return g.kind === "score" && /\d/.test(g.primary);
  return true;
}

const LOOSE_END = new Set([
  "a",
  "an",
  "the",
  "at",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "and",
  "or",
  "but",
  "by",
  "from",
  "as",
  "its",
  "his",
  "her",
  "their",
  "is",
  "was",
  "that",
]);

/** A pop-up phrase that reads as a phrase: not a fragment ending on "at" or "the". */
export function usefulEmphasis(text: string): boolean {
  const words = text
    .trim()
    .replace(/[.,;:!?]+$/, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || words.join(" ").length < 3) return false;
  return (
    !LOOSE_END.has(words[words.length - 1]!.toLowerCase()) &&
    !LOOSE_END.has(words[0]!.toLowerCase())
  );
}
