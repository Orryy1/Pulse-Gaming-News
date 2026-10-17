// What a failed vision check tells the retry. The checker names frames; the
// frames map to sample times, the times to shots, the shots to the clip or
// still on screen. A moment it faulted for text, a logo or the wrong game is
// taken out of the episode's media so the retry re-plans without it instead
// of rendering the same fault three times and losing the slot.

const MEDIA_FAULT =
  /\b(text|captions?|subtitles?|words|letter(?:ing|s)?|watermarks?|logos?|title cards?|taglines?|different game|wrong game|not .{0,20}artwork|mismatch)\b/i;

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
}

export function offendingMedia(
  problems: string[],
  sampleTimes: number[],
  plan: { fps: number; shots: ShotLike[] },
): Offending {
  const out: Offending = {
    clips: new Set(),
    images: new Set(),
    allClips: false,
  };
  for (const p of problems) {
    if (!MEDIA_FAULT.test(p)) continue;
    const frames = [
      ...p.matchAll(/frames?\s+(\d+(?:\s*,\s*\d+)*(?:\s*(?:and|&)\s*\d+)?)/gi),
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
      if (shot.media.type === "clip") out.clips.add(shot.media.index);
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
