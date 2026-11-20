// "Never hold one picture too long" (LONG_SAME_PICTURE_MAX_SECONDS, reports/Inspiration playlist forensics.md rule 7):
// Halo sat on one piece of key art for a whole 46-second entry. The planner's guards never saw it: footage first
// (FOOTAGE_FIRST) stops a clip replaying, the stock cap counts stock themes (src/assets/repeats.ts), and two shots in a
// row on one still are merged into one long hold on purpose. So this pass runs after the plan is built and counts what
// the viewer sees: no one picture for more than the cap inside any minute, by its file, so a picture listed twice
// counts once. Past the cap a still gives way to the least-shown other picture of the same chapter, or to footage the
// chapter hasn't played. An entry with nothing else keeps its picture and the count says so, so its thin-entry top-up
// can bring more: never another game's art, never a real-world photo away from its own sentence.
// Pure, and free of node modules: the planner imports it.

import type { LongMedia, LongShot } from "./longplan.ts";

/** A window of one minute, in the report's sense of "too long". */
export const PICTURE_WINDOW_SECONDS = 60;
/** A replacement or remainder shorter than this is a flash: it joins its neighbour instead. */
const MIN_PIECE_SECONDS = 2.5;

export interface PictureCapMedia {
  /** What the viewer sees: a still's or clip's file. Two entries for one file are one picture. */
  images: Array<{
    file?: string;
    kind?: string;
    beatIndex?: number;
    moment?: number;
  }>;
  clips: Array<{ file?: string; beatIndex?: number; durationSeconds: number; cutsceneMatch?: { targetKey?: string } }>;
  /** The real-world test (src/render/longplan.ts realWorldImage): those stay on their own sentence. */
  real: (k: number) => boolean;
  /** Which entry a shot's segment belongs to; undefined for the intro. */
  entryOf: (segment: number) => number | undefined;
  /** Clips may not replay (FOOTAGE_FIRST). */
  clipsPlayed: Set<number>;
}

export interface PictureCapResult {
  shots: LongShot[];
  /** Pieces handed to another picture. */
  replaced: number;
  /** Seconds still over the cap because the chapter had nothing else to show. */
  unresolvedSeconds: number;
  /** Entries left over the cap: where the thin-entry top-up should look. */
  thinEntries: number[];
}

/** The same IGDB picture downloaded for two chapters is one picture to the viewer. */
const pictureFile = (file?: string) => {
  const name = file?.split(/[\\/]/).pop() ?? "";
  return /^igdb-/.test(name) ? name : file;
};

const keyOf = (
  m: LongMedia,
  media: Pick<PictureCapMedia, "images" | "clips">,
) =>
  m.type === "image"
    ? `f:${pictureFile(media.images[m.index]?.file) ?? `i${m.index}`}`
    : m.type === "clip"
      ? `f:${media.clips[m.index]?.file ?? `c${m.index}`}`
      : m.type === "filler"
        ? `filler:${m.entry}:${m.index}`
        : "plate";

/** The cap as a pure pass over a finished plan's shots. maxSeconds <= 0 leaves them as they are. */
export function capSamePicture(
  shots: readonly LongShot[],
  maxSeconds: number,
  fps: number,
  media: PictureCapMedia,
): PictureCapResult {
  if (maxSeconds <= 0)
    return {
      shots: [...shots],
      replaced: 0,
      unresolvedSeconds: 0,
      thinEntries: [],
    };
  const cap = Math.round(maxSeconds * fps);
  const windowF = PICTURE_WINDOW_SECONDS * fps;
  const minPiece = Math.round(MIN_PIECE_SECONDS * fps);
  const out: LongShot[] = [];
  const shownFrames = new Map<string, number>();
  const played = new Set(media.clipsPlayed);
  let replaced = 0;
  let unresolved = 0;
  const thin = new Set<number>();
  /** Frames of this picture already on screen in the minute before `at`. */
  const usedIn = (key: string, at: number) => {
    let n = 0;
    for (let i = out.length - 1; i >= 0; i--) {
      const s = out[i]!;
      if (s.end <= at - windowF) break;
      if (keyOf(s.media, media) === key)
        n += Math.min(s.end, at) - Math.max(s.start, at - windowF);
    }
    return n;
  };
  const push = (sh: LongShot) => {
    const prev = out[out.length - 1];
    const k = keyOf(sh.media, media);
    shownFrames.set(k, (shownFrames.get(k) ?? 0) + (sh.end - sh.start));
    if (sh.media.type === "clip") played.add(sh.media.index);
    if (
      prev &&
      prev.end === sh.start &&
      prev.media.type === "image" &&
      keyOf(prev.media, media) === k
    )
      prev.end = sh.end;
    else out.push(sh);
  };
  /** Another picture of this chapter with room left, least shown first; footage it hasn't played before all else. */
  const another = (
    entry: number | undefined,
    self: string,
    at: number,
  ): LongMedia | undefined => {
    const clip = media.clips.findIndex(
      (c, k) =>
        (entry === undefined || c.beatIndex === entry) &&
        !c.cutsceneMatch?.targetKey &&
        !played.has(k) &&
        c.durationSeconds * fps >= minPiece,
    );
    if (clip >= 0) return { type: "clip", index: clip };
    const cands = media.images
      .map((_, k) => k)
      .filter((k) => {
        const im = media.images[k]!;
        // The intro and the outro preview the whole video, so any chapter's game art may stand in there.
        if (entry !== undefined && im.beatIndex !== entry) return false;
        if (im.kind === "capsule" || im.kind === "portrait") return false;
        if (media.real(k)) return false;
        const key = keyOf({ type: "image", index: k }, media);
        return key !== self && usedIn(key, at) + minPiece <= cap;
      })
      .sort((a, b) => {
        const ka = keyOf({ type: "image", index: a }, media);
        const kb = keyOf({ type: "image", index: b }, media);
        return (shownFrames.get(ka) ?? 0) - (shownFrames.get(kb) ?? 0) || a - b;
      });
    return cands.length ? { type: "image", index: cands[0]! } : undefined;
  };
  for (const sh of shots) {
    if (sh.media.type !== "image") {
      push({ ...sh });
      continue;
    }
    const key = keyOf(sh.media, media);
    const entry = media.entryOf(sh.segment);
    let at = sh.start;
    let current: LongMedia = sh.media;
    while (at < sh.end) {
      const left = sh.end - at;
      const curKey = keyOf(current, media);
      const room = cap - usedIn(curKey, at);
      if (room >= Math.min(left, minPiece)) {
        let take = Math.min(left, Math.max(room, minPiece));
        // A sliver left behind joins this piece: the rule is "about 12 s", a flash is worse than a second over.
        if (left - take < minPiece) take = left;
        push({ ...sh, start: at, end: at + take, media: current });
        at += take;
        continue;
      }
      const next = another(entry, curKey, at);
      if (!next) {
        // Nothing else in this chapter: the picture holds, and the count says so.
        const over = left;
        unresolved += over;
        if (entry !== undefined) thin.add(entry);
        push({ ...sh, start: at, end: sh.end, media: current });
        at = sh.end;
        continue;
      }
      replaced++;
      if (next.type === "clip") {
        // Footage runs its own length, then the walk carries on.
        const len = Math.min(
          left,
          Math.floor(media.clips[next.index]!.durationSeconds * fps),
          cap,
        );
        push({ ...sh, start: at, end: at + len, media: next });
        at += len;
        current = sh.media;
        continue;
      }
      current = next;
    }
    void key;
  }
  return {
    shots: out,
    replaced,
    unresolvedSeconds: Math.round((unresolved / fps) * 10) / 10,
    thinEntries: [...thin],
  };
}

export interface PictureMeasures {
  seconds: number;
  /** The longest time on one picture without a cut away. */
  longestHoldSeconds: number;
  /** The most any one picture is on screen inside any one minute. */
  worstMinuteSeconds: number;
  /** Share of the running time on a picture already shown in an earlier shot. */
  repeatShare: number;
  /** The share of those repeats that are stills, footage replays, and how many pictures repeat. */
  repeatStills: number;
  repeatClips: number;
  /** Share of the running time on full-frame fillers (cards the planner placed). */
  fillerShare: number;
  /** Share of the running time with a graphic card of the shot list on screen, roughly: each lasts its sentence. */
  graphicShare: number;
  /** Fillers and graphics together, not double counted, the figure LONG_CARD_SHARE aims at. */
  cardShare: number;
}

/** What the viewer sees, measured from a plan (pure). `script` and `assets` as the episode stores them. */
export function pictureMeasures(
  plan: { fps: number; totalFrames: number; shots: readonly LongShot[] },
  media: Pick<PictureCapMedia, "images" | "clips">,
  graphicWindows: ReadonlyArray<{ start: number; end: number }> = [],
): PictureMeasures {
  const fps = plan.fps;
  const seconds = plan.totalFrames / fps;
  let hold = 0;
  let run = 0;
  let prevKey = "";
  const firstSeen = new Map<string, number>();
  let repeat = 0;
  let stills = 0;
  let clips = 0;
  let filler = 0;
  const spans = new Map<string, Array<[number, number]>>();
  for (const s of plan.shots) {
    const k = keyOf(s.media, media);
    const len = s.end - s.start;
    if (s.media.type === "filler") filler += len;
    run = k === prevKey ? run + len : len;
    prevKey = k;
    if (s.media.type === "image" || s.media.type === "clip")
      hold = Math.max(hold, run);
    if (s.media.type === "image" || s.media.type === "clip") {
      if (firstSeen.has(k)) {
        repeat += len;
        if (s.media.type === "image") stills += len;
        else clips += len;
      } else firstSeen.set(k, s.start);
      (spans.get(k) ?? spans.set(k, []).get(k)!).push([s.start, s.end]);
    }
  }
  // Any one minute: the worst window opens on a shot's start.
  let worst = 0;
  const windowF = PICTURE_WINDOW_SECONDS * fps;
  for (const list of spans.values())
    for (const [a] of list) {
      let n = 0;
      for (const [x, y] of list)
        n += Math.max(0, Math.min(y, a + windowF) - Math.max(x, a));
      worst = Math.max(worst, n);
    }
  // Fillers and graphics as one timeline, so a graphic over a filler counts once.
  const marks: Array<[number, number]> = [
    ...plan.shots
      .filter((s) => s.media.type === "filler")
      .map((s) => [s.start, s.end] as [number, number]),
    ...graphicWindows.map(
      (w) =>
        [Math.round(w.start * fps), Math.round(w.end * fps)] as [
          number,
          number,
        ],
    ),
  ].sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let upTo = 0;
  for (const [a, b] of marks) {
    const from = Math.max(a, upTo);
    if (b > from) covered += b - from;
    upTo = Math.max(upTo, b);
  }
  let graphic = 0;
  for (const w of graphicWindows) graphic += (w.end - w.start) * fps;
  const pct = (f: number) => Math.round((1000 * f) / plan.totalFrames) / 1000;
  return {
    seconds: Math.round(seconds),
    longestHoldSeconds: Math.round((hold / fps) * 10) / 10,
    worstMinuteSeconds: Math.round((worst / fps) * 10) / 10,
    repeatShare: pct(repeat),
    repeatStills: pct(stills),
    repeatClips: pct(clips),
    fillerShare: pct(filler),
    graphicShare: pct(graphic),
    cardShare: pct(covered),
  };
}
