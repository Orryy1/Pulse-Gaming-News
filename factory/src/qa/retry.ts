// What a failed vision check tells the retry. The checker names frames; the
// frames map to sample times, the times to shots, the shots to the clip or
// still on screen. A moment it faulted for text, a logo, the wrong game or ad
// safety is taken out of the episode's media so the retry re-plans without it
// instead of rendering the same fault three times and losing the slot.

import { banMoment } from "../assets/screencache.ts";

const MEDIA_FAULT =
  /\b(text|captions?|subtitles?|words|letter(?:ing|s)?|watermarks?|logos?|title cards?|taglines?|different game|wrong game|wrong (?:era|entry)|blur(?:ry)?|smear(?:ed)?|artefacts?|artifacts?|not .{0,20}artwork|mismatch)\b/i;

/**
 * The final check's ad-safety faults (src/qa/vision.ts VISION_PROMPT: gore, nudity, anything sexualised or suggestive,
 * a crop dominated by a chest, groin or underwear). Until 14 Nov 2026 none of these words were media faults, so the
 * retry rendered the same bent-over GTA VI shot three times over and five Shorts failed on it (QA_AD_SWAP, default on).
 */
export const AD_FAULT =
  /\b(sexuali[sz]ed|sexual|suggestive(?:ly)?|revealing|cleavage|nudity|nude|naked|lingerie|underwear|bikini|swimwear|bra(?:-style)?|thong|buttocks?|groin|crotch|bare chest|shirtless|chest[- ](?:dominated|focused)|bent[- ](?:over|forward)|bends? over|bending over|twerk\w*|strip(?:per|-club| club)|pole[- ]danc\w*|provocative(?:ly)?|exposed (?:flesh|skin|upper thighs|thighs|chest|torso)|gore|gory|blood(?:y)?|dismember\w*|advertiser[- ]unfriendly|ad[- ]unsafe|not advertiser[- ]friendly|advertiser[- ]friendly (?:requirement|rule|criteria|restriction))\b|\b(?:crop|framing|shot) (?:emphasi[sz]\w*|dwell\w*|focus\w*) (?:on )?(?:the |a |her |his )?(?:chest|hips|buttocks|thighs|body)/i;

export interface ShotLike {
  start: number;
  end: number;
  media: { type: string; index: number };
}

export interface Offending {
  clips: Set<number>;
  images: Set<number>;
  /** true when a media fault named no frame, so every clip is suspect */
  allClips: boolean;
  /** The clips (indices) faulted for ad safety: their moments are remembered so no later gather picks them. */
  unsafeClips?: Set<number>;
}

/**
 * The frame numbers (1-based) a problem names (pure): "Frame 3", "Frames 5 and 6", "Frames 3-4" or "3–4", "frames 4 to
 * 6", and "the last frame" (the final sample). Until 14 Nov 2026 a range read as its first frame only.
 */
export function problemFrames(problem: string, sampleCount: number): number[] {
  const out = new Set<number>();
  for (const m of problem.matchAll(
    /frames?\s+(\d+(?:\s*(?:,|and|&|-|–|—|to)\s*\d+)*)/gi,
  )) {
    const list = m[1]!;
    for (const part of list.split(/\s*(?:,|and|&)\s*/i)) {
      const r = part.match(/^(\d+)\s*(?:-|–|—|to)\s*(\d+)$/i);
      if (r) {
        const [a, b] = [Number(r[1]), Number(r[2])];
        for (let n = Math.min(a, b); n <= Math.max(a, b) && n - a < 50; n++)
          out.add(n);
      } else if (/^\d+$/.test(part)) out.add(Number(part));
    }
  }
  if (sampleCount > 0 && /\b(?:the )?(?:last|final) frame\b/i.test(problem))
    out.add(sampleCount);
  return [...out].filter((n) => n > 0);
}

export function offendingMedia(
  problems: string[],
  sampleTimes: number[],
  plan: { fps: number; shots: ShotLike[] },
  o: { adSwap?: boolean } = {},
): Offending {
  const adSwap = o.adSwap ?? true;
  const out: Offending = {
    clips: new Set(),
    images: new Set(),
    allClips: false,
    unsafeClips: new Set(),
  };
  for (const p of problems) {
    // The technical check's black stretches (src/qa/media.ts says where): the clip on screen there goes.
    const black = adSwap ? p.match(/black frames \(at ([^)]*?)s?\)/i) : null;
    if (black) {
      for (const span of black[1]!.split(/\s*,\s*/)) {
        const [a, b] = span.split("-").map(Number);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        for (const t of [a!, (a! + b!) / 2, b! - 0.05]) {
          const f = Math.round(t * plan.fps);
          const shot = plan.shots.find((s) => f >= s.start && f < s.end);
          if (shot?.media.type === "clip") out.clips.add(shot.media.index);
        }
      }
      continue;
    }
    const ad = adSwap && AD_FAULT.test(p);
    if (!ad && !MEDIA_FAULT.test(p)) continue;
    const frames = adSwap
      ? problemFrames(p, sampleTimes.length)
      : [
          ...p.matchAll(
            /frames?\s+(\d+(?:\s*,\s*\d+)*(?:\s*(?:and|&)\s*\d+)?)/gi,
          ),
        ].flatMap((m) =>
          m[1]!
            .split(/[^\d]+/)
            .filter(Boolean)
            .map(Number),
        );
    if (!frames.length) {
      out.allClips = true;
      continue;
    }
    for (const n of frames) {
      const t = sampleTimes[n - 1];
      if (t === undefined) continue;
      const f = Math.round(t * plan.fps);
      const shot = plan.shots.find((s) => f >= s.start && f < s.end);
      if (!shot) continue;
      if (shot.media.type === "clip") {
        out.clips.add(shot.media.index);
        if (ad) out.unsafeClips!.add(shot.media.index);
      }
      if (shot.media.type === "image") out.images.add(shot.media.index);
    }
  }
  return out;
}

/** Removes the faulted media from an assets object (clips and images arrays), returning what was dropped. */
export function dropOffending<
  T extends { clips?: unknown[]; images?: unknown[] },
>(assets: T, off: Offending): { clips: number; images: number } {
  const clips = assets.clips ?? [];
  const images = assets.images ?? [];
  const keepClips = off.allClips
    ? []
    : clips.filter((_, i) => !off.clips.has(i));
  const keepImages = images.filter((_, i) => !off.images.has(i));
  // Never strip the episode of all its art: a wrong still is only dropped while another remains.
  const dropped = {
    clips: clips.length - keepClips.length,
    images: keepImages.length ? images.length - keepImages.length : 0,
  };
  assets.clips = keepClips as T["clips"];
  if (keepImages.length) assets.images = keepImages as T["images"];
  return dropped;
}

/**
 * The clips the final check faulted for ad safety, remembered as unsafe in the footage screen cache by their source and
 * time (src/assets/screencache.ts), so the retry's gather and every later Short skip that stretch. Returns the keys written.
 */
export function rememberUnsafe(
  clips: ReadonlyArray<{
    sourceUrl?: string;
    sourceSectionId?: string;
    startSeconds?: number;
    durationSeconds?: number;
  }>,
  off: Offending,
  why: string,
): number {
  let n = 0;
  for (const i of off.unsafeClips ?? []) {
    const c = clips[i];
    if (!c) continue;
    n += banMoment({
      sourceUrl: c.sourceUrl,
      sectionId: c.sourceSectionId,
      start: c.startSeconds,
      seconds: c.durationSeconds,
      why,
    });
  }
  return n;
}
