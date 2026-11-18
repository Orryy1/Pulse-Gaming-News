// Breaking the template in a Short's sound and layout (gap 2 of the 18 Nov 2026 top creator gap plan).
//
// The measured problem (86 Shorts, 1 to 17 Nov 2026): every Short opened and closed on the brand sting, 58% played
// the identical sequence sting > air-1 > air-2 > swell > sting, and 9 of 9 inspected renders opened on one layout
// (PULSE tag and lane chip, a two to four line headline, captions) and closed by returning to the same headline card.
// The 27 breakout human Shorts studied play about 0.36 effects every 10 s (none at all in 10 of 27), an effect only
// where something arrives on screen, no extra text on the first frame in 17 of 27, a pause before the punchline in
// 8 of 27 and an ending held on the payoff. YouTube's test before a channel can earn is whether its videos look made
// from a template, and its reviewers sample the newest uploads.
//
// Two tests, each split by episode id and recorded on the episode so retention can be read by arm:
// - SHORT_SOUND_PLAN=sparse (SHORT_SOUND_SPARSE_SHARE): no fixed sting; 0 to 4 effects, each where a card, stamp or
//   scene arrives; never the same sequence as any of the newest 30 Shorts where a choice exists; one music dip of
//   0.7 to 1.5 s before the verdict line when the voice already leaves that gap (the audio is never re-timed).
// - SHORT_LAYOUTS=on (SHORT_LAYOUTS_SHARE): three openings (today's headline card, full-frame picture with captions
//   only, a one-line lower third that leaves after the hook) and two closings (today's return to the headline card,
//   holding on the payoff), chosen so no opening takes more than 40% of the newest 30; the first shot lasts 1.5 s.
//
// Everything here is pure: no clock, no randomness, no database. The step that reads the channel's memory and
// records the arms is src/untemplatestep.ts.

import { leadFrames, LEVEL, SFX, sfxFile } from "./soundscape.ts";
import {
  arbitrate,
  overlaySpans,
  shortLayout,
  type Span,
} from "./cleanframe.ts";
import type { RenderPlan, Shot, SfxCue } from "./plan.ts";
import type { Segment } from "./timeline.ts";

// ---- Arms ---------------------------------------------------------------------------------------

/** A number from an episode id and a salt (pure): the same id always gives the same number. */
export function idHash(id: string, salt: string): number {
  // FNV-1a over the salted id, then a final avalanche: no node:crypto, so the composition's bundle can import this file.
  let h = 0x811c9dc5;
  for (const ch of `${salt}:${id}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Whether an episode is on the test's side at this share (pure, as shortDepthArm in src/render/parallax.ts). */
export function inShare(id: string, share: number, salt: string): boolean {
  if (share <= 0) return false;
  if (share >= 1) return true;
  return idHash(id, salt) / 2 ** 32 < share;
}

export type SoundArm = "sparse" | "v3";
export type LayoutArm = "on" | "off";

/** The sound test's arm: "sparse" only while SHORT_SOUND_PLAN=sparse and the id falls inside the share. */
export const soundArm = (
  id: string,
  plan: "v3" | "sparse",
  share: number,
): SoundArm =>
  plan === "sparse" && inShare(id, share, "short-sound") ? "sparse" : "v3";

/** The layout test's arm: "on" only while SHORT_LAYOUTS=on and the id falls inside the share. */
export const layoutArm = (
  id: string,
  layouts: boolean,
  share: number,
): LayoutArm => (layouts && inShare(id, share, "short-layout") ? "on" : "off");

// ---- Sound -------------------------------------------------------------------------------------

/** The bare name of a sound cue's file: "sfx/v3/air-1.mp3" and "sfx/v3/sting-D.mp3" read "air-1" and "sting". */
export function sfxName(file: string): string {
  return (file.split("/").pop() ?? file)
    .replace(/\.mp3$/, "")
    .replace(/-[DE]$/, "");
}

/** A Short's effect sequence, in order of play ("air-2>land>swell"); "" for none. */
export function sequenceOf(
  sfx: ReadonlyArray<Pick<SfxCue, "file" | "frame">>,
): string {
  return [...sfx]
    .sort((a, b) => a.frame - b.frame)
    .map((c) => sfxName(c.file))
    .join(">");
}

/** The house sounds the sparse plan owns and replaces; anything else (a signature sting, say) is left as it was. */
const OWN_SOUND = /^sfx\/(v3|retro)\//;

/** Most effects a sparse Short plays, whatever its length. */
export const SPARSE_MAX = 4;
/** Two effects at least this far apart (2.5 s at 30 fps), as the v3 plan. */
export const SPARSE_GAP = 75;
/** The silence beat before the verdict: at least this long (s), or none ... */
export const SILENCE_MIN = 0.7;
/** ... and at most this long. */
export const SILENCE_MAX = 1.5;
/** Share of sparse Shorts that play no effect at all (the hits: 10 of 27). */
export const ZERO_SHARE = 0.2;
/** Combinations tried before giving up on a fresh sequence. */
const MAX_TRIES = 240;

export interface SilenceBeat {
  /** Frames, exclusive end. */
  from: number;
  to: number;
}

/**
 * The silence beat before the verdict line (pure): the voice's own gap between the last word before the take and the
 * take's first word, when it is at least SILENCE_MIN; capped at SILENCE_MAX. The narration is never moved, so a
 * Short whose gap is shorter simply has no beat.
 */
export function silenceBeat(
  segments: ReadonlyArray<Pick<Segment, "kind" | "start">>,
  words: ReadonlyArray<{ start: number; end: number }>,
  fps: number,
): SilenceBeat | undefined {
  const take = [...segments].reverse().find((s) => s.kind === "take");
  if (!take) return undefined;
  const first = words.find((w) => w.start >= take.start - 0.05);
  const before = words.filter((w) => w.start < take.start - 0.05).at(-1);
  if (!first || !before) return undefined;
  const gap = first.start - before.end;
  if (gap < SILENCE_MIN) return undefined;
  const from = Math.round((before.end + 0.05) * fps);
  const to = Math.round(
    Math.min(first.start - 0.02, before.end + SILENCE_MAX) * fps,
  );
  return to - from >= Math.round(0.6 * fps) ? { from, to } : undefined;
}

/** Something arriving on screen that may carry a sound. */
export interface Arrival {
  /** The frame it lands on (the sound's peak goes here). */
  frame: number;
  kind: "stamp" | "take" | "number" | "entry" | "card" | "scene";
}

/** The sounds an arrival may carry, the first being its natural one. */
function optionsFor(
  a: Arrival,
  stamp: { name: string; volume: number },
): Array<{ name: string; volume: number; at: number }> {
  const air = SFX.air.map((name) => ({ name, volume: LEVEL.air, at: a.frame }));
  switch (a.kind) {
    case "stamp":
      return [{ ...stamp, at: a.frame }];
    case "take":
      return [
        { name: SFX.swell, volume: LEVEL.swell, at: a.frame },
        { name: SFX.land[0], volume: LEVEL.land, at: a.frame },
      ];
    case "number":
      // The tick lands as the figure settles (a stat's count-up, about 18 frames after the card).
      return [
        { name: SFX.glint[0], volume: LEVEL.glint, at: a.frame + 18 },
        ...air,
      ];
    default:
      return [...air, { name: SFX.land[0], volume: LEVEL.land, at: a.frame }];
  }
}

/** Lower first: the arrivals most worth a sound. */
const RANK: Record<Arrival["kind"], number> = {
  stamp: 0,
  take: 1,
  number: 2,
  entry: 3,
  card: 4,
  scene: 5,
};

/**
 * The arrivals a Short's frame shows (pure): each card, rank entry, word stamp, filler, freeze label and code scene,
 * where it is drawn (one overlay at a time on a clean Short, so a card the clean frame drops makes no sound).
 */
export function arrivalsOf(input: {
  plan: Pick<
    RenderPlan,
    "fps" | "totalFrames" | "tailFrames" | "shelf" | "craft" | "scenes"
  >;
  segments: Segment[];
  words: Array<{ text?: string; start: number }>;
  stamps: Array<{ at: number }>;
  clean: boolean;
  shape?: { open: ShortOpen; close: ShortClose };
}): Arrival[] {
  const { plan, segments } = input;
  const layout = shortLayout(
    segments,
    plan.fps,
    plan.totalFrames,
    plan.tailFrames,
  );
  const spans = overlaySpans({
    segments,
    words: input.words,
    plan,
    layout,
    stamps: input.stamps,
    sting: false,
    shape: input.shape,
  });
  const drawn: Span[] = input.clean ? arbitrate(spans) : spans;
  const out: Arrival[] = [];
  for (const sp of drawn) {
    // A piece of a span cut by a higher overlay is not an arrival: only a span's own first frame is.
    if (sp.key.includes("#")) continue;
    const original = spans.find((x) => x.key === sp.key);
    if (!original || sp.from !== original.from) continue;
    if (sp.kind === "stamp") out.push({ frame: sp.from, kind: "stamp" });
    else if (sp.kind === "entry") out.push({ frame: sp.from, kind: "entry" });
    else if (sp.kind === "card") {
      const seg = segments[Number(sp.key.slice(4))];
      const v = seg?.visual?.kind;
      out.push({
        frame: sp.from,
        kind:
          seg?.kind === "take"
            ? "take"
            : v === "stat" || v === "countdown"
              ? "number"
              : "card",
      });
    } else if (sp.kind === "filler" || sp.kind === "freeze")
      out.push({ frame: sp.from, kind: "card" });
  }
  for (const sc of plan.scenes ?? [])
    out.push({ frame: sc.from, kind: "scene" });
  // Nothing "arrives" on the opening frames: the opening carries no fixed sound any more.
  return out
    .filter((a) => a.frame >= 6 && a.frame < plan.totalFrames - 30)
    .sort((a, b) => a.frame - b.frame);
}

export interface SparseResult {
  sfx: SfxCue[];
  sequence: string;
  silence?: SilenceBeat;
  /** How many effects the seed asked for, before spacing and the arrivals available cut it. */
  wanted: number;
  /** How many arrivals the frame offered a sound. */
  arrivals: number;
}

/**
 * The sparse sound plan (pure). No sting at the open or close; 0 to SPARSE_MAX effects, each on an arrival; the
 * count comes from the episode id (about ZERO_SHARE of Shorts play none, the rest one to a length-based budget); the
 * sounds are chosen so the sequence matches none of `recent` (the newest Shorts' sequences) where any choice
 * exists. An empty sequence is not treated as a repeat: no effect at all is what 10 of the 27 hits did. Cues the
 * plan does not own (a signature sting) are kept as they were.
 */
export function planSparseSfx(input: {
  id: string;
  plan: Pick<
    RenderPlan,
    "fps" | "totalFrames" | "tailFrames" | "shelf" | "craft" | "scenes" | "sfx"
  >;
  segments: Segment[];
  words: Array<{ text?: string; start: number; end: number }>;
  stamps: Array<{ at: number }>;
  clean: boolean;
  /** The word moment's own sound (src/render/wordlook.ts wordSoundCue). */
  stampSound: { name: string; volume: number };
  recent: readonly string[];
  shape?: { open: ShortOpen; close: ShortClose };
}): SparseResult {
  const { plan, id } = input;
  const fps = plan.fps;
  const kept = plan.sfx.filter((c) => !OWN_SOUND.test(c.file));
  const silence = silenceBeat(input.segments, input.words, fps);
  const seconds = plan.totalFrames / fps;
  const budget = Math.min(SPARSE_MAX, Math.max(1, Math.round(seconds / 15)));
  const h = idHash(id, "short-sound-count");
  const wanted = (h % 1000) / 1000 < ZERO_SHARE ? 0 : 1 + ((h >>> 10) % budget);
  const inSilence = (f: number) =>
    !!silence && f >= silence.from - 3 && f < silence.to;
  const arrivals = arrivalsOf({ ...input, words: input.words }).filter(
    (a) => !inSilence(a.frame),
  );
  const recent = new Set(input.recent.filter(Boolean));
  const seed = idHash(id, "short-sound-pick");
  // The arrivals worth a sound, best first.
  const ranked = [...arrivals].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.frame - b.frame);
  /** The best `count` arrivals that keep SPARSE_GAP apart (from each other and from the kept cues), in time order. */
  const pickEvents = (count: number): Arrival[] => {
    const chosen: Arrival[] = [];
    for (const a of ranked) {
      if (chosen.length >= count) break;
      if (chosen.some((c) => Math.abs(c.frame - a.frame) < SPARSE_GAP)) continue;
      if (kept.some((c) => Math.abs(c.frame - a.frame) < SPARSE_GAP)) continue;
      chosen.push(a);
    }
    return chosen.sort((a, b) => a.frame - b.frame);
  };
  const cueOf = (o: { name: string; volume: number; at: number }): SfxCue => {
    let frame = Math.max(0, o.at - leadFrames(o.name, fps));
    // A sound never starts inside the silence beat: it waits for the beat to end.
    if (silence && frame >= silence.from - 3 && frame < silence.to) frame = silence.to;
    return { file: sfxFile(o.name), frame, volume: o.volume };
  };
  /** The first combination of sounds for these arrivals whose sequence no recent Short played, if any. */
  const fresh = (events: Arrival[]): SfxCue[] | undefined => {
    const opts = events.map((e, i) => {
      const list = optionsFor(e, input.stampSound);
      const r = (seed + i * 7) % list.length;
      return [...list.slice(r), ...list.slice(0, r)];
    });
    const total = opts.reduce((n, o) => n * o.length, 1);
    for (let t = 0; t < Math.min(total, MAX_TRIES); t++) {
      let rest = t;
      const cues = opts.map((o) => {
        const pick = o[rest % o.length]!;
        rest = Math.floor(rest / o.length);
        return cueOf(pick);
      });
      if (!recent.has(sequenceOf(cues))) return cues;
    }
    return undefined;
  };
  // The count the id asked for first; when every combination of it is a recent sequence, one more effect (within the
  // budget), then fewer. Zero only when the id asked for none or nothing fresh exists at all.
  const counts = wanted
    ? [wanted, ...Array.from({ length: budget - wanted }, (_, i) => wanted + 1 + i), ...Array.from({ length: wanted - 1 }, (_, i) => wanted - 1 - i)]
    : [];
  const tried = new Set<string>();
  for (const n of counts) {
    const events = pickEvents(n);
    const key = events.map((e) => e.frame).join(",");
    if (!events.length || tried.has(key)) continue;
    tried.add(key);
    const cues = fresh(events);
    if (cues) {
      const sfx = [...kept, ...cues].sort((a, b) => a.frame - b.frame);
      return { sfx, sequence: sequenceOf(sfx), silence, wanted, arrivals: arrivals.length };
    }
  }
  const sfx = [...kept].sort((a, b) => a.frame - b.frame);
  return { sfx, sequence: sequenceOf(sfx), silence, wanted, arrivals: arrivals.length };
}

/** A music bed's level inside a silence beat, against what it would be: dipped, not cut (a cut reads as a fault). */
export const SILENCE_DIP = 0.3;
/** Frames the dip takes to go down and come back up. */
export const SILENCE_RAMP = 6;

/** The music's multiplier at a frame for a Short's silence beats (pure): 1 outside, SILENCE_DIP inside. */
export function silenceDipAt(
  silences: ReadonlyArray<SilenceBeat> | undefined,
  frame: number,
): number {
  let m = 1;
  for (const s of silences ?? []) {
    if (frame < s.from - SILENCE_RAMP || frame >= s.to + SILENCE_RAMP) continue;
    const down = Math.min(
      1,
      Math.max(0, (frame - (s.from - SILENCE_RAMP)) / SILENCE_RAMP),
    );
    const up = Math.min(
      1,
      Math.max(0, (s.to + SILENCE_RAMP - frame) / SILENCE_RAMP),
    );
    m = Math.min(m, 1 - (1 - SILENCE_DIP) * Math.min(down, up));
  }
  return m;
}

// ---- Layout -------------------------------------------------------------------------------------

/**
 * How a Short opens: "card" today's headline card (or poster) over the hook; "footage" the picture full frame with
 * captions only and the small Pulse mark; "lower" the headline as one lower-third line that leaves after the hook.
 */
export type ShortOpen = "card" | "footage" | "lower";
/** How a Short closes: "card" today's return to the headline card; "hold" the last shot stays with the last caption. */
export type ShortClose = "card" | "hold";

export interface ShortShape {
  open: ShortOpen;
  close: ShortClose;
  /** The lower third's text, when open is "lower". */
  line?: string;
}

/** The share of the newest Shorts any one opening may take. */
export const LAYOUT_CAP = 0.4;
/** The window the cap is measured over. */
export const LAYOUT_WINDOW = 30;

/** The lower third's width (the content box less its padding) and its smallest readable size. */
const LOWER_WIDTH = 900;
const LOWER_MIN_SIZE = 52;
const LOWER_MAX_SIZE = 76;
/** Anton capitals average about 0.52 em; 0.56 keeps a margin for W and M (src/render/layout.ts). */
const ANTON_EM = 0.56;

/** The lower third's font size for a line, or undefined when it cannot sit on one readable line (pure). */
export function lowerLineSize(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const size = Math.min(
    LOWER_MAX_SIZE,
    Math.floor(LOWER_WIDTH / (t.length * ANTON_EM)),
  );
  return size >= LOWER_MIN_SIZE ? size : undefined;
}

/**
 * The lower third's text (pure): the headline when it fits one readable line, else the thumbnail's words when they
 * do, else none (and the Short does not open on a lower third). Words are never cut: a cut headline can mislead.
 */
export function lowerLine(
  headline: string,
  thumbText?: string,
): string | undefined {
  for (const t of [headline, thumbText ?? ""]) {
    const clean = t.replace(/\s+/g, " ").trim();
    if (clean && lowerLineSize(clean)) return clean;
  }
  return undefined;
}

/**
 * A Short's opening and closing (pure): among the openings it may use, the one the newest Shorts used least, so no
 * opening takes more than LAYOUT_CAP of the window while three can be chosen; a tie goes to the id. The same for the
 * closing. A rumour never opens on the lower third, which drops the honesty label (the rumour flag must show).
 */
export function pickShape(o: {
  id: string;
  /** The newest Shorts' shapes, newest first; today's Shorts are { open: "card", close: "card" }. */
  recent: ReadonlyArray<Pick<ShortShape, "open" | "close">>;
  rumour: boolean;
  /** The lower third's text (lowerLine); none, no lower third. */
  line?: string;
  window?: number;
}): ShortShape {
  const window = (o.window ?? LAYOUT_WINDOW) - 1;
  const recent = o.recent.slice(0, Math.max(0, window));
  const opens: ShortOpen[] = [
    "card",
    "footage",
    ...(o.line && !o.rumour ? (["lower"] as const) : []),
  ];
  const closes: ShortClose[] = ["card", "hold"];
  const least = <T extends string>(
    choices: T[],
    used: T[],
    salt: string,
  ): T => {
    const count = (c: T) => used.filter((u) => u === c).length;
    const min = Math.min(...choices.map(count));
    const tied = choices.filter((c) => count(c) === min);
    return tied[idHash(o.id, salt) % tied.length]!;
  };
  const open = least(
    opens,
    recent.map((r) => r.open),
    "short-open",
  );
  const close = least(
    closes,
    recent.map((r) => r.close),
    "short-close",
  );
  return open === "lower" ? { open, close, line: o.line } : { open, close };
}

/** The first shot of a Short in the new layouts lasts at least this long (1.5 s at 30 fps). */
export const FIRST_SHOT_MIN = 45;
/** The second shot keeps at least this much when the first borrows from it. */
const SECOND_SHOT_KEEP = 30;

/**
 * The first shot held to FIRST_SHOT_MIN frames (pure). Today a Short opening on a still cuts to motion after 12
 * frames (src/render/plan.ts STING_FRAMES, the brand sting over the hero still): 0.4 s, a flicker. The first shot
 * takes the frames from the start of the second (a clip starts that much further in), so no shot is added or
 * removed and the craft's shot numbers stay right. Unchanged when the first shot is long enough, or when the second
 * would be left under a second.
 */
export function holdFirstShot(shots: Shot[], min = FIRST_SHOT_MIN): Shot[] {
  const [a, b] = shots;
  if (!a || !b) return shots;
  const delta = min - (a.end - a.start);
  if (delta <= 0) return shots;
  if (b.end - (b.start + delta) < SECOND_SHOT_KEEP) return shots;
  const media =
    b.media.type === "clip"
      ? { ...b.media, trimFrom: (b.media.trimFrom ?? 0) + delta }
      : b.media;
  return [
    { ...a, end: a.end + delta },
    { ...b, start: b.start + delta, media },
    ...shots.slice(2),
  ];
}
