// The documentary's camera grammar (31 Oct 2026, from the study of top creators' editing in the perfection
// programme): the moves a human editor makes between and inside shots, chosen per shot by rules so they read
// as craft rather than as a template.
//
// - track: the camera pushes through the cut, A accelerating in and B landing out of it, motion blur peaking
//   on the cut frame (Vox).
// - whip: a fast sideways pan from one shot to the next of the same chapter, blurred, used sparingly.
// - detail: the camera pushes in on the thing a sentence names in a screenshot (found by the local vision
//   model or by OCR) and a hand-drawn circle or arrow lands on it as the word is said. Never on a face.
// - freeze: a clip holds on the frame the narrator is talking about, desaturates a little, a label lands, then
//   it plays on (Captain Disillusion, Internet Historian).
// - emotion: the writer's beats move the camera: a slow push on a reveal, a key line or a record, a gentle
//   pull out on a quiet line.
// - twoStage: "move, settle, move" Ken Burns on long stills, an operator's move rather than a linear one.
// - rack and dolly: from the stills' depth layers, a focus pull from subject to place (or back) on the key
//   word, and a vertigo push where the background grows while the subject holds (Fern, LEMMiNO).
// - lens and boil: a lens's edge softness and colour fringing over the picture, and a 12 fps texture
//   flicker over full-screen explainers.
//
// Everything here is pure: the same plan and inputs always choose the same moves. Rules: never the same
// technique twice in a row, each technique spaced out (SPACING_SECONDS), at most PER_MINUTE camera moves in
// any minute and MIN_GAP_SECONDS between two, all tighter in the first EARLY_SECONDS (the cut rhythm a
// viewer deciding whether to stay needs). Each technique is behind the DOC_CAMERA setting (src/config.ts).

import { keyTime, momentKeys, usefulEmphasis, usefulGraphic } from "./longplan.ts";

export const CAMERA_TECHNIQUES = [
  "track",
  "whip",
  "detail",
  "freeze",
  "emotion",
  "twoStage",
  "rack",
  "dolly",
  "lens",
  "boil",
] as const;
export type CameraTechnique = (typeof CAMERA_TECHNIQUES)[number];

/**
 * DOC_CAMERA: "all" (the default) or a comma list of techniques; "off" (or "none", "false") turns the
 * whole camera grammar off. Unknown names are ignored; "-whip" in a list after "all" removes one.
 */
export function parseCameraSetting(raw: string | undefined): CameraTechnique[] {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text || text === "all" || text === "on" || text === "true")
    return [...CAMERA_TECHNIQUES];
  if (["off", "none", "false", "0"].includes(text)) return [];
  const byLower = new Map(CAMERA_TECHNIQUES.map((t) => [t.toLowerCase(), t]));
  const out = new Set<CameraTechnique>();
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    if (part === "all") for (const t of CAMERA_TECHNIQUES) out.add(t);
    else if (part.startsWith("-")) {
      const t = byLower.get(part.slice(1));
      if (t) out.delete(t);
    } else {
      const t = byLower.get(part);
      if (t) out.add(t);
    }
  }
  return CAMERA_TECHNIQUES.filter((t) => out.has(t));
}

/** The first three minutes cut tighter: a viewer is still deciding whether to stay. */
export const EARLY_SECONDS = 180;
/** Seconds between two moves of the same technique (later in the video; the opening uses EARLY_FACTOR of it). */
export const SPACING_SECONDS: Record<CameraEventKind, number> = {
  track: 60,
  whip: 120,
  detail: 60,
  freeze: 150,
  emotion: 24,
  twoStage: 40,
  rack: 80,
  dolly: 300,
};
/** Whip pans in a whole video: they are energy, and a documentary needs only a few. */
export const WHIP_MAX = 4;
export const EARLY_FACTOR = 0.6;
/** Two moves of one technique with no other move between them count as "in a row" within this long. */
export const REPEAT_WINDOW_SECONDS = 90;
/**
 * Camera moves of any kind in any 60 seconds (31 Oct 2026 review: 80 moves in 34 minutes, one every 26 s,
 * was busy against the cuts, the graphics and the structure strip; halved).
 */
export const PER_MINUTE = { early: 3, later: 2 } as const;
/** Seconds between any two camera moves. */
export const MIN_GAP_SECONDS = { early: 15, later: 15 } as const;

/** Frames each transition takes either side of its cut. */
export const TRACK_FRAMES = 9;
export const WHIP_FRAMES = 5;
/** How long a freeze frame holds. */
export const FREEZE_HOLD = 54;
/** A freeze never holds before its clip has played this long. */
export const FREEZE_LEAD = 18;
/** How long a rack focus takes to pull. */
export const RACK_FRAMES = 20;

export type CameraEventKind = Exclude<CameraTechnique, "lens" | "boil">;

export interface CameraShot {
  start: number;
  end: number;
  segment: number;
  media: { type: "image" | "clip" | "plate"; index: number };
}

export interface CameraInput {
  shots: CameraShot[];
  images: Array<{ kind: string; aspect: number; layers?: unknown }>;
  /** The chapter a segment belongs to (-1: none, the intro). */
  chapterOf: (segment: number) => number;
  fps: number;
  enabled: readonly CameraTechnique[];
  variant: number;
  /** Shots already dressed by another treatment: retro hardware, period looks, photo and sketch treatments,
   * screenshot displays, punch-ins and the plain detail box. They keep that and get no camera move inside. */
  dressed?: Set<number>;
  /** Shots with a punch-in on the narrator's key word: cuts may move through them, nothing moves inside. */
  punched?: Set<number>;
  /** Shots nothing may move: an old game's hardware pushing through its glass, a tube switching off. */
  fixed?: Set<number>;
  /** Frames to keep clear of camera moves: chapter openings and their bursts, breathers, the cold open. */
  quiet?: Array<{ from: number; to: number }>;
  /** Full-screen explainers on screen (frames): a move under one would not be seen. */
  explainers?: Array<{ from: number; to: number }>;
  /** The writer's beats (frames): where the sentence lands. */
  beats?: Array<{ kind: string; at: number }>;
  /** Sentences whose key word lands inside footage matched to them: the frame and what is said. */
  freezeCues?: Array<{ at: number; label: string }>;
  /** Detail candidates: the shot, the frame the thing is named, and whether it is a face (never circled). */
  details?: Array<{ id: number; shot: number; at: number; face: boolean }>;
  /** Key words landing inside shots (frames), for a rack focus to pull on. */
  keyWords?: number[];
}

export type CutMove = { kind: "track" | "whip"; dir: 1 | -1; frames: number };
export type ShotMove =
  | { kind: "freeze"; at: number; hold: number; label: string }
  | { kind: "rack"; at: number; toBack: boolean }
  | { kind: "dolly"; dir: 1 | -1 }
  | { kind: "emotion"; at: number; push: boolean };

export interface CameraEvent {
  kind: CameraEventKind;
  frame: number;
  shot: number;
}

export interface CameraPlan {
  /** Per incoming shot index: how the cut into it moves. */
  cuts: Map<number, CutMove>;
  /** Per shot index: the move inside it. */
  shots: Map<number, ShotMove>;
  /** Per shot index: a still's ambient move replaced (two-stage Ken Burns). */
  moves: Map<number, "twoStage">;
  /** Per detail id: how it is marked (absent: the plain labelled box). */
  details: Map<number, "circle" | "arrow">;
  lens: boolean;
  boil: boolean;
  /** Every move chosen, in order. */
  events: CameraEvent[];
}

/** Moves exempt from the gap and the per-minute cap: none since the 31 Oct review (two-stage drift counts). */
const AMBIENT: ReadonlySet<CameraEventKind> = new Set();
const PRINT_KINDS = new Set(["photo", "portrait", "sketch", "capsule"]);

/** Whether a frame sits in the early, tighter-cut part of the video. */
export const isEarly = (frame: number, fps: number) =>
  frame < EARLY_SECONDS * fps;

/** Frames two moves of a technique must be apart at a frame. */
export function spacingFrames(
  kind: CameraEventKind,
  frame: number,
  fps: number,
): number {
  return Math.round(
    SPACING_SECONDS[kind] * fps * (isEarly(frame, fps) ? EARLY_FACTOR : 1),
  );
}

/**
 * Whether a move of `kind` at `frame` keeps the rules against the moves already chosen (any order): not the
 * technique of the move just before it or just after it, its own spacing either side, the minimum gap to
 * its neighbours and the per-minute cap on both sides of it.
 */
export function allowed(
  chosen: CameraEvent[],
  kind: CameraEventKind,
  frame: number,
  fps: number,
): boolean {
  const sorted = [...chosen].sort((a, b) => a.frame - b.frame);
  const before = sorted.filter((e) => e.frame <= frame);
  const after = sorted.filter((e) => e.frame > frame);
  // Two moves minutes apart with nothing between are not "in a row"; within REPEAT_WINDOW_SECONDS they are.
  const near = (e: CameraEvent | undefined) =>
    !!e && e.kind === kind && Math.abs(e.frame - frame) < REPEAT_WINDOW_SECONDS * fps;
  if (near(before.at(-1)) || near(after[0])) return false;
  const space = spacingFrames(kind, frame, fps);
  if (sorted.some((e) => e.kind === kind && Math.abs(e.frame - frame) < space))
    return false;
  if (AMBIENT.has(kind)) return true;
  const early = isEarly(frame, fps);
  const loud = sorted.filter((e) => !AMBIENT.has(e.kind));
  const gap = (early ? MIN_GAP_SECONDS.early : MIN_GAP_SECONDS.later) * fps;
  if (loud.some((e) => Math.abs(e.frame - frame) < gap)) return false;
  const cap = early ? PER_MINUTE.early : PER_MINUTE.later;
  const minute = 60 * fps;
  const back = loud.filter((e) => e.frame > frame - minute && e.frame <= frame).length;
  const ahead = loud.filter((e) => e.frame >= frame && e.frame < frame + minute).length;
  return back < cap && ahead < cap;
}

const overlaps = (
  spans: Array<{ from: number; to: number }> | undefined,
  from: number,
  to: number,
) => (spans ?? []).some((s) => from < s.to && to > s.from);

/** A shot whose picture fills the frame: footage, or a wide still that is not a framed print. */
function fullBleed(input: CameraInput, i: number): boolean {
  const s = input.shots[i];
  if (!s || s.media.type === "plate") return false;
  if (s.media.type === "clip") return true;
  const im = input.images[s.media.index];
  return !!im && !PRINT_KINDS.has(im.kind) && im.aspect >= 1.2;
}

/** A still with depth layers, shown full bleed. */
function layered(input: CameraInput, i: number): boolean {
  const s = input.shots[i];
  if (!s || s.media.type !== "image") return false;
  const im = input.images[s.media.index];
  return !!im?.layers && !PRINT_KINDS.has(im.kind) && im.aspect >= 1.2;
}

/** Key art (a subject posed in front of a place): the only stills whose depth survives a vertigo push.
 * A gameplay screenshot's layers tear apart when the background swells (31 Oct 2026 proof stills). */
function keyArt(input: CameraInput, i: number): boolean {
  const s = input.shots[i];
  const im = s?.media.type === "image" ? input.images[s.media.index] : undefined;
  return !!im && ["hero", "header", "article"].includes(im.kind);
}

export function planCamera(input: CameraInput): CameraPlan {
  const { shots, fps } = input;
  const on = new Set(input.enabled);
  const plan: CameraPlan = {
    cuts: new Map(),
    shots: new Map(),
    moves: new Map(),
    details: new Map(),
    lens: on.has("lens"),
    boil: on.has("boil"),
    events: [],
  };
  const dressed = input.dressed ?? new Set<number>();
  const take = (kind: CameraEventKind, frame: number, shot: number) => {
    plan.events.push({ kind, frame, shot });
  };
  let turn = input.variant;
  let racks = input.variant;
  let marks = input.variant;
  // A video with writer's beats moves the vertigo onto them; one without lets it stand on its own, rarely.
  const hasBeats = (input.beats ?? []).length > 0;
  const details = input.details ?? [];
  const free = (from: number, to: number) =>
    !overlaps(input.quiet, from, to) && !overlaps(input.explainers, from, to);
  // First the moves the words call for (a named detail, the writer's beat, a frame the narrator is talking
  // about), so the editor's rhythm moves never crowd them out; then the cuts and the ambient moves around them.
  for (let i = 0; i < shots.length; i++) {
    const sh = shots[i]!;
    const len = sh.end - sh.start;
    const inside = (f: number, before: number, after: number) =>
      f - sh.start >= before && sh.end - f >= after;
    const detail = details.find(
      (d) => d.shot === i && !d.face && inside(d.at, 0, 60),
    );
    if (
      detail &&
      on.has("detail") &&
      free(detail.at, detail.at + 60) &&
      allowed(plan.events, "detail", detail.at, fps)
    ) {
      plan.details.set(detail.id, marks++ % 2 ? "arrow" : "circle");
      take("detail", detail.at, i);
      continue;
    }
    // A shot with a detail (box or face) keeps its push; nothing else moves it.
    if (details.some((d) => d.shot === i)) continue;
    if (input.fixed?.has(i) || input.punched?.has(i) || len < 75 || sh.media.type === "plate")
      continue;
    // The writer's beat moves the whole frame, so it may push into a photo's print or a sketch too.
    const beat = (input.beats ?? []).find(
      (b) => inside(b.at, 0, 60) && ["reveal", "key", "record", "quiet"].includes(b.kind),
    );
    if (
      beat &&
      on.has("emotion") &&
      free(beat.at, Math.min(sh.end, beat.at + 90)) &&
      allowed(plan.events, "emotion", beat.at, fps)
    ) {
      plan.shots.set(i, { kind: "emotion", at: beat.at, push: beat.kind !== "quiet" });
      take("emotion", beat.at, i);
      continue;
    }
    if (dressed.has(i) || sh.media.type !== "clip" || !on.has("freeze")) continue;
    // The cut usually lands on the word itself: the clip plays for a beat, then holds.
    const cue = (input.freezeCues ?? [])
      .filter((c) => c.at >= sh.start && c.at < sh.end)
      .map((c) => ({ ...c, at: Math.max(c.at, sh.start + FREEZE_LEAD) }))
      .find((c) => inside(c.at, FREEZE_LEAD, FREEZE_HOLD + 30));
    if (
      cue &&
      free(cue.at, cue.at + FREEZE_HOLD + 10) &&
      allowed(plan.events, "freeze", cue.at, fps)
    ) {
      plan.shots.set(i, { kind: "freeze", at: cue.at, hold: FREEZE_HOLD, label: cue.label });
      take("freeze", cue.at, i);
    }
  }
  for (let i = 0; i < shots.length; i++) {
    const sh = shots[i]!;
    const len = sh.end - sh.start;
    // The cut into this shot: a push through it, or a whip between two shots of one chapter.
    const prev = shots[i - 1];
    if (prev && prev.end === sh.start) {
      const cut = sh.start;
      const ok =
        fullBleed(input, i) &&
        fullBleed(input, i - 1) &&
        len >= 45 &&
        prev.end - prev.start >= 45 &&
        !dressed.has(i) &&
        !dressed.has(i - 1) &&
        // A freeze owns its clip to the end: the label is still fading as the cut comes.
        plan.shots.get(i - 1)?.kind !== "freeze" &&
        !overlaps(input.quiet, cut - 15, cut + 15) &&
        !overlaps(input.explainers, cut - 15, cut + 15);
      if (ok) {
        const sameChapter = input.chapterOf(prev.segment) === input.chapterOf(sh.segment);
        // A whip reads as a glance across the same place: one chapter, and like joined to like.
        const like = prev.media.type === sh.media.type;
        const order: Array<"whip" | "track"> =
          (turn + i) % 3 === 0 ? ["whip", "track"] : ["track", "whip"];
        for (const kind of order) {
          if (!on.has(kind)) continue;
          if (kind === "whip" && plan.events.filter((e) => e.kind === "whip").length >= WHIP_MAX)
            continue;
          if (kind === "whip" && (!sameChapter || !like)) continue;
          if (!allowed(plan.events, kind, cut, fps)) continue;
          plan.cuts.set(i, {
            kind,
            dir: (turn++ % 2 ? -1 : 1) as 1 | -1,
            frames: kind === "track" ? TRACK_FRAMES : WHIP_FRAMES,
          });
          take(kind, cut, i);
          break;
        }
      }
    }
    // The move inside it, when the words gave it none: the depth moves on a layered still, then the
    // two-stage drift of a long still.
    if (plan.shots.has(i) || details.some((d) => d.shot === i)) continue;
    if (dressed.has(i) || input.punched?.has(i) || input.fixed?.has(i)) continue;
    const inside = (f: number, before: number, after: number) =>
      f - sh.start >= before && sh.end - f >= after;
    if (layered(input, i) && len >= 120 && free(sh.start, sh.end)) {
      const twist = (input.beats ?? []).some(
        (b) => inside(b.at, 0, 0) && ["reveal", "turn", "key"].includes(b.kind),
      );
      if (
        on.has("dolly") &&
        keyArt(input, i) &&
        (hasBeats ? twist : true) &&
        allowed(plan.events, "dolly", sh.start, fps)
      ) {
        plan.shots.set(i, { kind: "dolly", dir: (racks++ % 2 ? -1 : 1) as 1 | -1 });
        take("dolly", sh.start, i);
        continue;
      }
      if (on.has("rack")) {
        const word = (input.keyWords ?? []).find((f) => inside(f, 30, RACK_FRAMES + 30));
        const at = word ?? sh.start + Math.round(len * 0.4);
        if (allowed(plan.events, "rack", at, fps)) {
          plan.shots.set(i, { kind: "rack", at, toBack: racks++ % 2 === 0 });
          take("rack", at, i);
          continue;
        }
      }
    }
    if (
      on.has("twoStage") &&
      sh.media.type === "image" &&
      fullBleed(input, i) &&
      len >= 150 &&
      allowed(plan.events, "twoStage", sh.start, fps)
    ) {
      plan.moves.set(i, "twoStage");
      take("twoStage", sh.start, i);
    }
  }
  plan.events.sort((a, b) => a.frame - b.frame || a.shot - b.shot);
  return plan;
}

/**
 * The plan in numbers, for the episode log and the owner's notice: how many of each move, and how many in
 * the first three minutes.
 */
export function cameraSummary(
  plan: CameraPlan,
  fps: number,
): { total: number; early: number; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {};
  for (const e of plan.events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  return {
    total: plan.events.length,
    early: plan.events.filter((e) => isEarly(e.frame, fps)).length,
    byKind,
  };
}

/**
 * The scale of a shot inside a transition, at frame `f` of a shot `len` frames long: the outgoing shot
 * accelerates in over its last `frames` (1 to TRACK_PEAK) and the incoming one carries the push on,
 * decelerating from full speed to rest at TRACK_LAND, where it stays: the camera never reverses, never shows
 * the frame's edge, and is at full speed either side of the cut, where the blur peaks.
 */
export const TRACK_PEAK = 1.34;
export const TRACK_LAND = 1.14;
export function trackScale(
  f: number,
  len: number,
  out?: CutMove,
  into?: CutMove,
): number {
  let s = 1;
  if (out?.kind === "track" && f > len - out.frames) {
    const t = (f - (len - out.frames)) / out.frames;
    s *= 1 + (TRACK_PEAK - 1) * t * t;
  }
  if (into?.kind === "track") {
    // Ease-out cubic, entering at full speed; a blur sample from just before the cut continues that speed.
    const speed = (3 * (TRACK_LAND - 1)) / into.frames;
    if (f < 0) s *= Math.max(0.97, 1 + speed * f);
    else {
      const t = Math.min(1, f / into.frames);
      s *= 1 + (TRACK_LAND - 1) * (1 - (1 - t) ** 3);
    }
  }
  return s;
}

/** The sideways offset (share of the frame's width) of a shot inside a whip, the same way round. */
export function whipOffset(
  f: number,
  len: number,
  out?: CutMove,
  into?: CutMove,
): number {
  let x = 0;
  if (out?.kind === "whip" && f > len - out.frames) {
    const t = (f - (len - out.frames)) / out.frames;
    x -= out.dir * 0.42 * t * t;
  }
  if (into?.kind === "whip" && f < into.frames) {
    const t = f / into.frames;
    x += into.dir * 0.42 * (1 - t) * (1 - t);
  }
  return x;
}

/** The emotion move's scale at frame `f` (relative to the shot) for a beat landing at `at`: a slow push
 * (to 1.1 over 3.5 s) or a gentle pull out (to 0.965). */
export function emotionScale(
  f: number,
  at: number,
  push: boolean,
  fps: number,
): number {
  const t = Math.max(0, Math.min(1, (f - at) / (3.5 * fps)));
  const e = t * t * (3 - 2 * t);
  return push ? 1 + 0.1 * e : 1 - 0.035 * e;
}

/** Freeze frame: what frame of the clip shows at frame `f` of the shot (held from `at` for `hold`). */
export function freezeSource(f: number, at: number, hold: number): number {
  if (f < at) return f;
  if (f < at + hold) return at;
  return f - hold;
}

/** The 12 fps step of a texture flicker at a 30 fps frame: a new texture every 2.5 frames. */
export const flickerStep = (frame: number, fps: number) =>
  Math.floor((frame * 12) / fps);

/** What a sentence of the shot list carries, as far as the camera cares. */
export interface CameraMoment {
  show?: string;
  graphic: { kind: string; primary: string; secondary: string; items?: string[] };
  emphasis?: string;
  person?: string;
}

/** The frame a phrase is spoken inside a window of seconds, or undefined when it is not said there. */
export function spokenFrame(
  words: Array<{ text?: string; start: number }>,
  from: number,
  to: number,
  phrase: string,
  fps: number,
): number | undefined {
  const lo = words.findIndex((w) => w.start >= from - 0.05);
  if (lo < 0) return undefined;
  let hi = words.findIndex((w) => w.start >= to - 0.01);
  if (hi < 0) hi = words.length;
  const t = keyTime(words, lo, Math.max(lo, hi), phrase);
  return t === undefined ? undefined : Math.round(t * fps);
}

/**
 * A freeze frame's label: the clip's own frame label (what the picture check saw in it) when the sentence
 * spoken over it names one of its telling words ("helicopter", "rooftops"); "" otherwise, and the freeze
 * shows only its brackets, pause chip and timecode.
 */
export function freezeLabel(
  frameLabel: string | undefined,
  words: Array<{ text?: string; start: number }>,
  from: number,
  to: number,
): string {
  const label = (frameLabel ?? "").trim();
  if (!label || label.length > 44) return "";
  const stem = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(es|s)$/, "");
  const STOP = new Set(["with", "over", "from", "into", "under", "near", "their", "this", "that", "game", "scene", "shot"]);
  const telling = label
    .split(/\s+/)
    .map(stem)
    .filter((t) => t.length >= 4 && !STOP.has(t));
  const said = new Set(
    words.filter((w) => w.start >= from - 0.05 && w.start < to).map((w) => stem(w.text ?? "")),
  );
  return telling.some((t) => said.has(t)) ? label : "";
}

/** Whether a detail's label is a person (a face is never circled): anyone the shot list names. */
export function isPerson(label: string, people: Iterable<string>): boolean {
  const k = label.trim().toLowerCase();
  if (!k) return false;
  for (const p of people) {
    const q = p.trim().toLowerCase();
    if (q && (q === k || q.includes(k) || k.includes(q))) return true;
  }
  return false;
}

/**
 * The camera's inputs from the long composition's own data (pure, so the planning is tested without React):
 * the freeze cues (a sentence's key word landing inside footage picked for that sentence, with nothing else
 * drawn over it), the key words a rack focus can pull on, and each detail's spoken frame and whether it is
 * a face.
 */
export function cameraInputs(a: {
  shots: CameraShot[];
  images: Array<{ kind: string; aspect: number; layers?: unknown; beatIndex?: number; moment?: number }>;
  clips: Array<{ beatIndex?: number; moment?: number; label?: string }>;
  chapterOf: (segment: number) => number;
  fps: number;
  enabled: readonly CameraTechnique[];
  variant: number;
  dressed?: Set<number>;
  punched?: Set<number>;
  fixed?: Set<number>;
  quiet?: Array<{ from: number; to: number }>;
  explainers?: Array<{ from: number; to: number }>;
  beats?: Array<{ kind: string; at: number }>;
  windows: Array<{ entry: number; moment: number; start: number; end: number; at: number }>;
  moments?: Array<Array<CameraMoment | undefined> | undefined>;
  words: Array<{ text?: string; start: number }>;
  details?: Array<{ id: number; shot: number; from: number; label: string; k: number }>;
}): CameraInput {
  const { fps } = a;
  const people = new Set<string>();
  for (const e of a.moments ?? [])
    for (const m of e ?? []) {
      if (m?.person) people.add(m.person);
      if (m?.graphic.kind === "people")
        for (const it of m.graphic.items ?? []) people.add(it.split(":")[0]!);
    }
  const shotAt = (f: number) => a.shots.findIndex((s) => f >= s.start && f < s.end);
  const freezeCues: Array<{ at: number; label: string }> = [];
  const keyWords: number[] = [];
  for (const w of a.windows) {
    const m = a.moments?.[w.entry]?.[w.moment];
    if (!m || w.moment === 0 || w.at <= w.start) continue;
    const at = Math.round(w.at * fps);
    keyWords.push(at);
    // Nothing else drawn over it: no graphic, no kinetic caption, no name tag, no pop-in picture.
    if (usefulGraphic(m.graphic)) continue;
    if (m.emphasis && usefulEmphasis(m.emphasis)) continue;
    if (m.person) continue;
    if (a.images.some((im) => im.beatIndex === w.entry && im.moment === w.moment)) continue;
    const sh = a.shots[shotAt(at)];
    if (!sh || sh.media.type !== "clip") continue;
    const clip = a.clips[sh.media.index];
    if (!clip || clip.beatIndex !== w.entry || clip.moment !== w.moment) continue;
    // The label must say what is in the frozen frame (31 Oct 2026 review: a shot-list phrase, "PS3", sat over
    // a GTA V helicopter shot and read as a caption error): the clip's own frame label from the picture
    // check, and only when the sentence says something it names. Otherwise the freeze carries no label.
    freezeCues.push({ at, label: freezeLabel(clip.label, a.words, w.start, w.end) });
  }
  const details = (a.details ?? []).map((d) => {
    const w = a.windows[d.k];
    const said = w ? spokenFrame(a.words, w.start, w.end, d.label, fps) : undefined;
    const sh = a.shots[d.shot];
    const im = sh?.media.type === "image" ? a.images[sh.media.index] : undefined;
    return {
      id: d.id,
      shot: d.shot,
      at: Math.max(d.from, said ?? d.from),
      face:
        isPerson(d.label, people) ||
        im?.kind === "photo" ||
        im?.kind === "portrait",
    };
  });
  return {
    shots: a.shots,
    images: a.images,
    chapterOf: a.chapterOf,
    fps,
    enabled: a.enabled,
    variant: a.variant,
    dressed: a.dressed,
    punched: a.punched,
    fixed: a.fixed,
    quiet: a.quiet,
    explainers: a.explainers,
    beats: a.beats,
    freezeCues,
    keyWords,
    details,
  };
}

/** The owner's one line about the camera, for the documentary's render notice. */
export function cameraNotice(
  headline: string,
  enabled: readonly CameraTechnique[],
  textDetails: number,
): string {
  if (!enabled.length)
    return `Documentary "${headline}": the camera moves are off (DOC_CAMERA=off), so cuts and stills keep their plain look.`;
  const words: Record<CameraTechnique, string> = {
    track: "pushes through the cut",
    whip: "whip pans",
    detail: "hand-drawn circles and arrows on named details",
    freeze: "freeze frames with a label",
    emotion: "slow pushes on reveals and pull-outs on quiet lines",
    twoStage: "two-stage Ken Burns on long stills",
    rack: "rack focus",
    dolly: "a vertigo push",
    lens: "a lens look at the edges",
    boil: "a 12 fps texture on explainers",
  };
  const list = enabled.map((t) => words[t]);
  const tail = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
  return `Documentary "${headline}": the camera uses ${tail}, each spaced out and never twice in a row, tighter in the first three minutes${enabled.includes("detail") ? `; ${textDetails} named detail${textDetails === 1 ? "" : "s"} found by reading the pictures' text` : ""}. Setting: DOC_CAMERA.`;
}
