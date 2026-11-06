// The documentary's sound craft (31 Oct 2026), from the creator study's top 25 (sound first: it was the biggest
// gap, it is cheap, and phone listeners notice it). Pure planning only; Long.tsx plays what this decides.
//
//   J and L cuts      a gameplay clip's own sound arrives up to 0.6 s before its picture or carries up to
//                     0.6 s past it, from footage the clip has spare, never across a chapter change.
//   game pockets      that sound sits at its old level under the voice and rises softly in a pause of 0.9 s
//                     or more (musicplan.ts bedEnvelope's own rule), so the game is heard in the gaps.
//   foley             every photo, sketch and paper treatment, every display a screenshot plays inside and
//                     every Pulse device makes its own small sound (public/sfx/foley, src/tools/sfxlab/foleylab.py)
//                     on its landing frame, through a gate so no two sounds stack.
//   risers            a reveal beat gets a riser whose peak lands on the revealed word.
//   buttons           a chapter ends on a soft final hit on its last word (in place of the landing hit a
//                     breath later), and the music changes bed on a bar line of the outgoing bed.
//   voice pocket      under speech the music crossfades to a copy with a dip at 2-4 kHz (Remotion cannot EQ).
//   voice texture     a quote read from a call or a message is heard through a telephone band; a reveal line
//                     gets a short reverb swell (both pre-processed slices, src/render/voicefx.ts).
//
// Every sound here is at least 14 dB under the narrator (src/render/soundscape.ts LEVEL); each part has its own
// setting (src/config.ts SOUND_*), default on, and an absent prop leaves the old mix exactly as it was.

import { bedEnvelope, type BeatCue } from "./musicplan.ts";
import type { PhotoTreatment, DisplayKind } from "./photoplan.ts";
import { darkroomPhases } from "./photoplan.ts";
import type { SketchTreatment } from "./sketchplan.ts";

export interface SoundCraft {
  /** SOUND_JL_CUTS: a clip's game sound leads or trails its picture. */
  jl: boolean;
  /** SOUND_GAME_POCKETS: game sound rises in the narrator's longer pauses. */
  pockets: boolean;
  /** SOUND_FOLEY: treatments and devices make their own small sounds. */
  foley: boolean;
  /** SOUND_RISERS: a riser into each reveal beat. */
  risers: boolean;
  /** SOUND_CHAPTER_BUTTONS: a soft final hit on each chapter's last word. */
  buttons: boolean;
  /** SOUND_PHRASE_EDITS: bed changes land on a bar line of the outgoing bed. */
  phrase: boolean;
  /** SOUND_VOICE_POCKET: the music's 2-4 kHz dip under speech. */
  voicePocket: boolean;
  /** SOUND_VOICE_FX: telephone band on message quotes, reverb swell on reveals. */
  voiceFx: boolean;
}

export const CRAFT_OFF: SoundCraft = {
  jl: false,
  pockets: false,
  foley: false,
  risers: false,
  buttons: false,
  phrase: false,
  voicePocket: false,
  voiceFx: false,
};

/** The craft a render plays: an absent prop (older renders, previews, stills) is the old mix. */
export const craftOf = (p: Partial<SoundCraft> | undefined): SoundCraft => ({
  ...CRAFT_OFF,
  ...(p ?? {}),
});

// ---------------------------------------------------------------- 1. J and L cuts

/** The most a clip's sound leads or trails its picture. */
export const JL_MAX_SECONDS = 0.6;
/** A lead or tail shorter than this is not worth the edit (the clip just fades in and out as before). */
export const JL_MIN_FRAMES = 4;
/** The old fade at a clip's edges (longplan.ts gameSoundVolume), kept where a side has no lead or tail. */
export const CLIP_FADE_FRAMES = 8;

export interface JlCut {
  /** Frames the sound starts before the picture (the picture skips that much of the clip to stay in sync). */
  lead: number;
  /** Frames the sound carries on after the picture cuts away. */
  tail: number;
}

/**
 * Which clips' sound leads (J) or trails (L) the picture, and by how much (pure). Only gameplay clips that
 * keep their sound, only from footage the clip has spare beyond its shot (a lead uses the clip's first frames,
 * a tail its frames after the shot), never across a chapter or entry change (`entryFrames`: its swell and
 * landing own that moment), never before frame 0. Shots alternate which side gets first claim on the spare,
 * so the edit does not always lead.
 */
export function jlCuts(
  shots: ReadonlyArray<{
    start: number;
    end: number;
    media: { type: string; index: number };
  }>,
  clips: ReadonlyArray<{ durationSeconds: number; audio?: boolean }>,
  fps: number,
  entryFrames: readonly number[],
): Map<number, JlCut> {
  const out = new Map<number, JlCut>();
  const max = Math.round(JL_MAX_SECONDS * fps);
  shots.forEach((s, i) => {
    if (s.media.type !== "clip") return;
    const c = clips[s.media.index];
    if (!c?.audio) return;
    const len = s.end - s.start;
    const spare = Math.floor(c.durationSeconds * fps) - len;
    if (spare < JL_MIN_FRAMES) return;
    const before = Math.max(0, ...entryFrames.filter((e) => e <= s.start));
    const after = Math.min(Infinity, ...entryFrames.filter((e) => e > s.start));
    const leadRoom = Math.min(max, s.start - before);
    const tailRoom = Math.max(0, Math.min(max, after - s.end));
    let lead: number;
    let tail: number;
    if (i % 2 === 0) {
      lead = Math.min(leadRoom, spare);
      tail = Math.min(tailRoom, spare - lead);
    } else {
      tail = Math.min(tailRoom, spare);
      lead = Math.min(leadRoom, spare - tail);
    }
    if (lead < JL_MIN_FRAMES) lead = 0;
    if (tail < JL_MIN_FRAMES) tail = 0;
    if (lead || tail) out.set(i, { lead, tail });
  });
  return out;
}

/**
 * A J/L clip's sound envelope over its own frames (0 = `lead` frames before the picture): rising over the
 * lead, full under the picture, falling over the tail; a side with no lead or tail keeps the old 8-frame fade.
 */
export function jlEdge(
  f: number,
  lead: number,
  len: number,
  tail: number,
): number {
  const total = lead + len + tail;
  const inF = lead || Math.min(CLIP_FADE_FRAMES, len);
  const outF = tail || Math.min(CLIP_FADE_FRAMES, len);
  const v = Math.min(1, f / Math.max(1, inF), (total - f) / Math.max(1, outF));
  return Math.max(0, v);
}

// ---------------------------------------------------------------- 2. game sound in the pauses

/** Game sound under the voice: the old fixed level (longplan.ts GAME_SOUND_VOLUME). */
export const GAME_UNDER = 0.16;
/** ... and in a pause of musicplan.ts BED_PAUSE_SECONDS or more: about 5.5 dB up, the game heard in the gap. */
export const GAME_POCKET = 0.3;

/** Game sound's level on every frame (pure): bedEnvelope's own pause rule between GAME_UNDER and GAME_POCKET. */
export function gameEnvelope(speaking: Uint8Array, fps: number): Float32Array {
  return bedEnvelope(speaking, fps, GAME_UNDER, GAME_POCKET);
}

// ---------------------------------------------------------------- 3. foley

export type Foley =
  | "tape"
  | "pin"
  | "shutter"
  | "paper"
  | "page"
  | "typewriter"
  | "splitflap"
  | "crt"
  | "click"
  | "buzz"
  | "tickroll"
  | "bars";

/** The file of a foley sound under public/sfx ("foley/pin"); tuned ones get their key from soundscape.ts inKey. */
export const foleyFile = (f: Foley | "riser" | "button") => `foley/${f}`;

/** A treatment's sound and the frame (from the treatment's own frame 0) it lands on. */
export interface FoleyCue {
  sound: Foley;
  at: number | ((len: number) => number);
}

export const cueFrame = (c: FoleyCue, len: number) =>
  Math.max(0, Math.round(typeof c.at === "number" ? c.at : c.at(len)));

/**
 * Each photo treatment's sound, on its landing frame (photoplan.ts and components/PhotoShot.tsx timings): the
 * instant print lands at 18, the tape strips press on from 0, the pin goes in at 14, the darkroom's tongs
 * lift the print, the camera fires before the print motors out, the strip slides in, the carousel clicks,
 * the album page turns from step 3, the newsprint and the light box print settle, the scanner's lamp clicks
 * on, the folder's print slides out at 20 and the peg closes at 16. The magnifier passes in silence.
 */
export const PHOTO_FOLEY: Record<PhotoTreatment, FoleyCue | undefined> = {
  instantDrop: { sound: "paper", at: 16 },
  ductTape: { sound: "tape", at: 0 },
  evidenceBoard: { sound: "pin", at: 14 },
  darkroom: { sound: "paper", at: (len) => darkroomPhases(len).lift },
  cameraPrint: { sound: "shutter", at: 2 },
  filmStrip: { sound: "paper", at: 0 },
  slideProjector: { sound: "click", at: 0 },
  albumPage: { sound: "page", at: 6 },
  newsprint: { sound: "paper", at: 0 },
  archiveScan: { sound: "click", at: 4 },
  magnifier: undefined,
  manilaFolder: { sound: "paper", at: 20 },
  lightBox: { sound: "paper", at: 4 },
  dryingLine: { sound: "pin", at: 16 },
};

/** A sketch's arrival: paper laid down, a flipbook page, the light table switched on, a pin in the cork. */
export const SKETCH_FOLEY: Record<SketchTreatment, FoleyCue | undefined> = {
  drawOn: { sound: "paper", at: 0 },
  stopMotion: { sound: "paper", at: 0 },
  flipbook: { sound: "page", at: 0 },
  lightTable: { sound: "click", at: 0 },
  corkBoard: { sound: "pin", at: 14 },
};

/** The display a screenshot plays inside, switching on: a tube's click and thump, a flat panel's click, a phone's buzz. */
export const DISPLAY_FOLEY: Record<DisplayKind, FoleyCue> = {
  crt: { sound: "crt", at: 0 },
  lcd: { sound: "click", at: 0 },
  flat: { sound: "click", at: 0 },
  phone: { sound: "buzz", at: 0 },
};

/**
 * The Pulse devices and paper looks (components/packs, by style name), each with its own sound in place of
 * the shared whoosh or tick: the typewriter's keys, the split-flap board's clatter, a phone's buzz, an old
 * set's click, paper and pages; the counters roll with ticks, the bars rise on a tone, the maps take a pin
 * (#13). A style whose own sound is a stamp keeps its stamp.
 */
export const DEVICE_FOLEY: Record<string, FoleyCue> = {
  "Paper/Typewriter": { sound: "typewriter", at: 6 },
  "Paper/StickyNotes": { sound: "paper", at: 4 },
  "Paper/Ledger": { sound: "page", at: 2 },
  "Paper/Redacted": { sound: "paper", at: 4 },
  "Screen/SplitFlap": { sound: "splitflap", at: 4 },
  "Editorial/Departures": { sound: "splitflap", at: 4 },
  "Screen/PhoneAlert": { sound: "buzz", at: 2 },
  "Screen/PhoneStory": { sound: "buzz", at: 2 },
  "Screen/PhoneStoryQuote": { sound: "buzz", at: 2 },
  "Screen/PhoneStorySource": { sound: "buzz", at: 2 },
  "Pulse/PulseChat": { sound: "buzz", at: 2 },
  "Pulse/PulseSocial": { sound: "buzz", at: 2 },
  "Pulse/PulseMail": { sound: "click", at: 2 },
  "Screen/OldWeb": { sound: "click", at: 2 },
  "Screen/OldWebQuote": { sound: "click", at: 2 },
  "Screen/OldWebSource": { sound: "click", at: 2 },
  "Screen/Terminal": { sound: "click", at: 2 },
  "Screen/Broadcast": { sound: "crt", at: 0 },
  "Pulse/PulseTV": { sound: "crt", at: 0 },
  "Pulse/PulseConsole": { sound: "crt", at: 0 },
  "Pulse/PulseCalendar": { sound: "click", at: 2 },
  "Pulse/PulseCalendarPaper": { sound: "page", at: 4 },
  "Data/Odometer": { sound: "tickroll", at: 8 },
  "Data/ArcadeScores": { sound: "tickroll", at: 8 },
  "Type/LiquidFill": { sound: "tickroll", at: 8 },
  "Pulse/PulseStore": { sound: "tickroll", at: 8 },
  "Data/Bars": { sound: "bars", at: 8 },
  "Map/World": { sound: "pin", at: 20 },
  "Pulse/PulseMaps": { sound: "pin", at: 20 },
  "Pulse/PulseMapsPaper": { sound: "pin", at: 20 },
};

/** Foley sounds at least this far apart: small sounds, but one every second would be busy. */
export const FOLEY_GAP_SECONDS = 2.5;
/** The same foley sound at least this far apart, so a run of screenshots does not click like a metronome. */
export const FOLEY_SAME_GAP_SECONDS = 8;
/** No foley within this long of any other sound (the moment sounds, retro kit, stings, risers). */
export const FOLEY_CLEAR_SECONDS = 1.2;
/** No foley within this long of an entry change (its swell and landing own it), as for the moment sounds. */
export const FOLEY_ENTRY_SECONDS = 1.5;

export interface FoleyCandidate {
  key: number;
  frame: number;
  sound: Foley;
}

/**
 * The treatment foley that plays (pure): fitted around the sounds already chosen (`taken`, their frames),
 * in time order, by the spacing rules above. Returns key to sound.
 */
export function gateFoley(
  cands: readonly FoleyCandidate[],
  taken: readonly number[],
  entryFrames: readonly number[],
  fps: number,
): Map<number, Foley> {
  const out = new Map<number, Foley>();
  let last = -Infinity;
  const lastOf = new Map<Foley, number>();
  for (const c of [...cands].sort(
    (a, b) => a.frame - b.frame || a.key - b.key,
  )) {
    if (
      entryFrames.some((e) => Math.abs(c.frame - e) < FOLEY_ENTRY_SECONDS * fps)
    )
      continue;
    if (taken.some((t) => Math.abs(c.frame - t) < FOLEY_CLEAR_SECONDS * fps))
      continue;
    if (c.frame - last < FOLEY_GAP_SECONDS * fps) continue;
    if (
      c.frame - (lastOf.get(c.sound) ?? -Infinity) <
      FOLEY_SAME_GAP_SECONDS * fps
    )
      continue;
    out.set(c.key, c.sound);
    last = c.frame;
    lastOf.set(c.sound, c.frame);
  }
  return out;
}

// ---------------------------------------------------------------- 4. risers

// The riser goes through soundscape.ts gateLongSounds as a claiming kind ("riser"), at least RISER_GAP
// (20 s) apart: a riser is a promise, and two a minute would cheapen it.

/** The frames each reveal's riser should peak on: the revealed word (pure). */
export function riserPeaks(cues: readonly BeatCue[]): number[] {
  return cues.filter((c) => c.kind === "reveal").map((c) => c.at);
}

// ---------------------------------------------------------------- 6. chapter buttons and bar-line edits

/** A chapter's last word this close before the next chapter opens is the chapter's ending (seconds). */
export const BUTTON_REACH_SECONDS = 2;

/**
 * Where each chapter's closing hit lands (pure): on the last word's end before each entry change, when that
 * word ends within BUTTON_REACH_SECONDS of it (a documentary's breather opens about 0.1 s after the last
 * word); otherwise on the entry frame itself, as the landing hit did.
 */
export function chapterButtons(
  entryFrames: readonly number[],
  wordEnds: readonly number[],
  fps: number,
): number[] {
  const ends = [...wordEnds].sort((a, b) => a - b);
  return entryFrames.map((e) => {
    let best = -Infinity;
    for (const w of ends) {
      if (w > e) break;
      best = w;
    }
    return e - best <= BUTTON_REACH_SECONDS * fps ? Math.round(best) : e;
  });
}

/** A bed's bar grid (src/tools/sfxlab/bedgrid.py): a bar's length, its first beat and the loop's length (s). */
export interface BedGrid {
  bar: number;
  first: number;
  loop: number;
}

/** A bed change moves at most this far to find the outgoing bed's bar line (seconds). */
export const PHRASE_REACH_SECONDS = 1.25;
/** Bars to a phrase: a phrase boundary within reach beats a nearer plain bar line. */
export const PHRASE_BARS = 4;

/**
 * The frame nearest `t` on a bar line of a bed that started (its file's frame 0) at `bedStart` and loops
 * every grid.loop seconds (pure). A phrase boundary (every PHRASE_BARS bars from the loop's first beat)
 * within PHRASE_REACH_SECONDS wins; else the nearest bar line within reach; else `t` unchanged.
 */
export function phraseSnap(
  t: number,
  bedStart: number,
  grid: BedGrid,
  fps: number,
): number {
  const reach = PHRASE_REACH_SECONDS * fps;
  const p = (t - bedStart) / fps;
  if (p <= 0 || grid.bar <= 0 || grid.loop <= 0) return t;
  const loopN = Math.floor(p / grid.loop);
  let bestBar: number | undefined;
  let bestPhrase: number | undefined;
  for (let n = Math.max(0, loopN - 1); n <= loopN + 1; n++) {
    for (let k = 0; grid.first + k * grid.bar < grid.loop; k++) {
      const f = bedStart + (n * grid.loop + grid.first + k * grid.bar) * fps;
      const d = Math.abs(f - t);
      if (d > reach) continue;
      if (bestBar === undefined || d < Math.abs(bestBar - t)) bestBar = f;
      if (
        k % PHRASE_BARS === 0 &&
        (bestPhrase === undefined || d < Math.abs(bestPhrase - t))
      )
        bestPhrase = f;
    }
  }
  return Math.round(bestPhrase ?? bestBar ?? t);
}

/** The incoming bed's fade at a bar-line edit: it starts on its own first beat, quickly (frames). */
export const PHRASE_IN_FRAMES = 9;

// ---------------------------------------------------------------- 7. the voice pocket

/** The pocketed copy of a bed (data/smoke/pocketbeds.mts): music/bed_1.wav is music/pocket/bed_1.flac. */
export const pocketOf = (src: string): string =>
  src.replace(/^(.*?)music\/([^/]+)\.\w+$/, "$1music/pocket/$2.flac");

/**
 * How much of the pocketed copy plays (pure, 0-1): all of it while the bed sits at `under` (the voice
 * speaking), none at `pause` and above (a long pause, a breather), in proportion between, so the dip follows
 * the bed envelope's own slow rise and fall and never switches.
 */
export function pocketWeight(
  level: number,
  under: number,
  pause: number,
): number {
  if (pause <= under) return 1;
  return Math.max(0, Math.min(1, (pause - level) / (pause - under)));
}

// ---------------------------------------------------------------- 22. the voice's texture

export type VoiceFxKind = "phone" | "reverb";

export interface VoiceFxSpan {
  kind: VoiceFxKind;
  /** Seconds in the narration. */
  from: number;
  to: number;
}

/** A quote whose source is a call or a message: its words or its picture say so. */
const MESSAGE =
  /\b(call(?:ed|s)?|phone(?:d|s)?|voicemail|text(?:ed|s)?(?: message)?|sms|e-?mail(?:ed|s)?|tweet(?:ed|s)?|dm(?:ed|s)?|direct message|messag(?:e|es|ed)|chat|forum post|posted)\b/i;

export const isMessageQuote = (
  g: {
    kind: string;
    secondary?: string;
    primary?: string;
  },
  show?: string,
  keywords?: readonly string[],
) =>
  g.kind === "quote" &&
  MESSAGE.test([g.secondary ?? "", show ?? "", ...(keywords ?? [])].join(" "));

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A quoted span shorter than this many words is not worth a filter (the ear would not catch it). */
export const PHONE_MIN_WORDS = 3;
/** The reverb's sentence must be at least this long (seconds): a swell needs room to grow. */
export const REVERB_MIN_SECONDS = 1.5;

/**
 * Where the narration is heard through a telephone band: the words of a message quote, found in its own
 * sentence (the longest run of the sentence's words that follows the quote's words, at least PHONE_MIN_WORDS),
 * padded into the silences either side (pure).
 */
export function phoneSpan(
  quote: string,
  words: ReadonlyArray<{ text?: string; start: number; end: number }>,
): VoiceFxSpan | undefined {
  const q = norm(quote).split(" ").filter(Boolean);
  if (q.length < PHONE_MIN_WORDS) return undefined;
  const w = words.map((x) => norm(x.text ?? ""));
  let best = { at: -1, len: 0 };
  for (let i = 0; i < w.length; i++)
    for (let j = 0; j < q.length; j++) {
      let n = 0;
      while (i + n < w.length && j + n < q.length && w[i + n] === q[j + n]) n++;
      if (n > best.len) best = { at: i, len: n };
    }
  if (best.len < Math.min(PHONE_MIN_WORDS, q.length)) return undefined;
  const a = words[best.at]!;
  const b = words[best.at + best.len - 1]!;
  const prev = words[best.at - 1];
  const next = words[best.at + best.len];
  // Into the gaps either side, never into the neighbouring words: the cut must fall in a silence.
  const from = prev
    ? Math.max((prev.end + a.start) / 2, a.start - 0.08)
    : Math.max(0, a.start - 0.05);
  const to = next
    ? Math.min((b.end + next.start) / 2, b.end + 0.12)
    : b.end + 0.1;
  return { kind: "phone", from, to };
}

/**
 * The voice texture plan (pure): a telephone band on every message quote's words, and a reverb swell over
 * every reveal sentence of REVERB_MIN_SECONDS or more. `windows` are the moment windows (seconds), `moments`
 * the shot list, `beats` the writer's beats as cues (frames). Spans never overlap: a phone span wins.
 */
export function voiceFxPlan(
  windows: ReadonlyArray<{
    entry: number;
    moment: number;
    start: number;
    end: number;
  }>,
  moments: ReadonlyArray<
    ReadonlyArray<
      | {
          show?: string;
          keywords?: readonly string[];
          graphic?: { kind: string; primary?: string; secondary?: string };
        }
      | undefined
    >
  >,
  words: ReadonlyArray<{ text?: string; start: number; end: number }>,
  beats: readonly BeatCue[],
  fps: number,
): VoiceFxSpan[] {
  const out: VoiceFxSpan[] = [];
  for (const w of windows) {
    const m = moments[w.entry]?.[w.moment];
    const g = m?.graphic;
    if (!g || !isMessageQuote(g, m?.show, m?.keywords)) continue;
    const inside = words.filter(
      (x) => x.start >= w.start - 0.05 && x.start < w.end,
    );
    const s = phoneSpan(g.primary ?? "", inside);
    // On frame boundaries, so the slice and the dry narration's cut meet exactly.
    if (s)
      out.push({
        kind: "phone",
        from: Math.floor(s.from * fps) / fps,
        to: Math.ceil(s.to * fps) / fps,
      });
  }
  for (const c of beats) {
    if (c.kind !== "reveal") continue;
    const from = c.start / fps;
    const to = c.end / fps;
    if (to - from < REVERB_MIN_SECONDS) continue;
    if (out.some((x) => x.from < to && x.to > from)) continue;
    out.push({ kind: "reverb", from, to });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** A phone span's crossfade with the dry narration (frames): short, inside the silences either side. */
export const PHONE_XFADE_FRAMES = 2;
/** The reverb's wet share at the sentence's start and its peak at the end (the swell), -24 dB to -17 dB. */
export const REVERB_WET_START = 0.063;
export const REVERB_WET_PEAK = 0.14;

/**
 * The dry narration's level at frame f with the phone spans cut out of it (pure): 1 outside every span,
 * crossfading to 0 over PHONE_XFADE_FRAMES inside each end (the slice covers exactly the span, so the two
 * always sum to one). The slice's own level is 1 minus this.
 */
export function dryLevel(
  f: number,
  spans: ReadonlyArray<{ kind: VoiceFxKind; from: number; to: number }>,
  fps: number,
): number {
  let v = 1;
  for (const s of spans) {
    if (s.kind !== "phone") continue;
    const a = s.from * fps;
    const b = s.to * fps;
    if (f < a || f >= b) continue;
    const x = Math.min(
      1,
      (f - a) / PHONE_XFADE_FRAMES,
      (b - f) / PHONE_XFADE_FRAMES,
    );
    v = Math.min(v, 1 - Math.max(0, x));
  }
  return v;
}

/**
 * The reverb slice's level at frame f of its own (pure): the swell, from REVERB_WET_START at the sentence's
 * first word to REVERB_WET_PEAK at its last (`len` frames), then held while the tail in the file decays.
 */
export function reverbLevel(f: number, len: number): number {
  const x = Math.max(0, Math.min(1, f / Math.max(1, len)));
  return REVERB_WET_START + (REVERB_WET_PEAK - REVERB_WET_START) * x * x;
}

/** One music bed as the composition plays it: its Sequence and its two fades, all in frames. */
export interface BedSlot {
  src: string;
  /** The Sequence's first frame (the bed file's frame 0) and its length. */
  from: number;
  span: number;
  /** The fade in: from this local frame, this long (0 long: none, the video's own fade starts it). */
  inAt: number;
  inLen: number;
  /** The fade out: from this local frame, this long (0 long: none, the video's own fade ends it). */
  outAt: number;
  outLen: number;
}

/**
 * Where each music bed plays and fades (pure). As before: each bed overlaps its neighbours by `xfade`
 * frames either side of its section boundary. With `phrase` on, a change whose outgoing bed has a bar grid
 * moves to the outgoing bed's nearest bar line (phraseSnap), the incoming bed starts there on its own first
 * beat (fading in over PHRASE_IN_FRAMES), and the outgoing bed fades out over `xfade` after it.
 */
export function bedSchedule(
  sections: ReadonlyArray<{ from: number; to: number; src: string }>,
  fps: number,
  xfade: number,
  phrase: boolean,
  gridOf: (src: string) => BedGrid | undefined,
): BedSlot[] {
  const n = sections.length;
  const firstOf = (src: string) => Math.round((gridOf(src)?.first ?? 0) * fps);
  // Each change: the frame it happens on and whether it is a bar-line edit, walking forward because a
  // bar line depends on where the outgoing bed's file started.
  const cuts: Array<{ at: number; edit: boolean }> = [];
  let start = sections[0]?.from ?? 0;
  for (let k = 1; k < n; k++) {
    const b = sections[k]!;
    const grid = phrase ? gridOf(sections[k - 1]!.src) : undefined;
    if (grid) {
      const at = phraseSnap(b.from, start, grid, fps);
      cuts.push({ at, edit: true });
      start = at - firstOf(b.src);
    } else {
      cuts.push({ at: b.from, edit: false });
      start = b.from - xfade;
    }
  }
  return sections.map((b, k) => {
    const into = cuts[k - 1];
    const outOf = cuts[k];
    let from = b.from;
    let inAt = 0;
    let inLen = 0;
    if (into?.edit) {
      from = into.at - firstOf(b.src);
      inAt = into.at - from;
      inLen = PHRASE_IN_FRAMES;
    } else if (into) {
      from = into.at - xfade;
      inLen = xfade;
    }
    const end = outOf ? outOf.at + xfade : b.to;
    const span = Math.max(1, end - from);
    return {
      src: b.src,
      from,
      span,
      inAt,
      inLen,
      outAt: outOf ? span - xfade : span,
      outLen: outOf ? xfade : 0,
    };
  });
}

/** A bed slot's fade at its own frame f (pure, 0-1). */
export function bedEdge(f: number, s: BedSlot): number {
  const up = s.inLen ? (f - s.inAt) / s.inLen : 1;
  const down = s.outLen ? (s.outAt + s.outLen - f) / s.outLen : 1;
  return Math.max(0, Math.min(1, up, down));
}

// ---------------------------------------------------------------- what the mix will do, said plainly

/** The Discord line for a documentary's sound craft: what is on and what it will touch. */
export function soundCraftLine(
  headline: string,
  craft: SoundCraft,
  counts: {
    jl: number;
    risers: number;
    buttons: number;
    phone: number;
    reverb: number;
  },
): string {
  const on = [
    craft.jl && counts.jl
      ? `${counts.jl} game clips lead or trail their picture`
      : "",
    craft.pockets ? "game sound rises in the pauses" : "",
    craft.foley
      ? "photos, sketches and devices make their own small sounds"
      : "",
    craft.risers && counts.risers
      ? `up to ${counts.risers} riser${counts.risers === 1 ? "" : "s"} into reveals`
      : "",
    craft.buttons && counts.buttons
      ? `${counts.buttons} chapter ending${counts.buttons === 1 ? "" : "s"} on a soft final hit`
      : "",
    craft.phrase ? "bed changes on the bar line" : "",
    craft.voicePocket ? "music dips at 2-4 kHz under the voice" : "",
    craft.voiceFx && counts.phone
      ? `${counts.phone} message quote${counts.phone === 1 ? "" : "s"} through a telephone band`
      : "",
    craft.voiceFx && counts.reverb
      ? `${counts.reverb} reveal line${counts.reverb === 1 ? "" : "s"} with a reverb swell`
      : "",
  ].filter(Boolean);
  return on.length
    ? `🎧 "${headline}": sound craft on (${on.join("; ")}). Every new sound sits at least 14 dB under the narrator. Settings: SOUND_*.`
    : `🎧 "${headline}": sound craft is off (SOUND_* settings).`;
}
