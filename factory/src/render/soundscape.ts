// The channel's soundscape: one family of sounds (public/sfx/v3) and the rules for using them. Sounds mark
// structure (the open, each new entry, the verdict, the close) and the odd number; they never chase every
// cut. Levels sit well under the narrator, and nothing plays within a breath of another sound.
//
// The set was chosen by measurement (src/tools/sfxlab/lab.py, report in src/tools/sfxlab/v3_report.json) from 400+
// ElevenLabs takes and library sounds: warm (no harsh 2-6 kHz presence), audible on phone speakers, no
// ringing high tones, no jolts. Every file is matched for perceived loudness, so a level here means the
// same thing for every sound. Pitched sounds come tuned to each music bed's key.

import type { Mood } from "./musicplan.ts";

export const SFX = {
  air: ["v3/air-1", "v3/air-2", "v3/air-3"],
  swell: "v3/swell",
  land: ["v3/land"],
  glint: ["v3/tick"],
  sting: "v3/sting",
} as const;

/**
 * The retro kit's sounds (public/sfx/retro, made and measured 28 Oct 2026 by src/tools/sfxlab/retrolab.py, report
 * data/sfxlab/retro_report.json): an old TV switching on, a tape drawn into a VCR, soft static on a cut. Each is
 * rolled off high so it reads as heard across a room. The power-off take is made but unused: it would land
 * within half a second of the next entry's own landing.
 */
export const RETRO_SFX = {
  tvon: "retro/tvon",
  vhs: "retro/vhs",
  static: "retro/static",
  poweroff: "retro/poweroff",
} as const;

/**
 * Mix levels (the narrator plays at 1), set from the narrator's measured loudness: the sting 10 dB under
 * it, the swell 16, the landing and whooshes 17 and the number tick 20, the quietest (a loud tonal glint
 * was the most jarring sound of the old set).
 */
export const LEVEL = {
  sting: 0.436,
  air: 0.195,
  swell: 0.218,
  land: 0.195,
  glint: 0.138,
  /** Long videos run 2 dB quieter: fifteen minutes of sound must not tire the ear. */
  airLong: 0.156,
  glintLong: 0.11,
  swellLong: 0.175,
  landLong: 0.156,
  /** The retro sounds, at the lab's levels less the long videos' 2 dB: the TV and tape 18 dB under the narrator, static 22. */
  retroLong: 0.139,
  staticLong: 0.088,
  /**
   * A record beat's sting (30 Oct 2026): the brand sting at its long-video level (10 dB under the narrator
   * less 2 dB, 0.346) and a quarter down again because it plays under a spoken line (UNDER_VOICE): 0.26,
   * about 14 dB under the narrator, so the word it marks is never masked.
   */
  recordLong: 0.26,
  /**
   * An era bed (public/soundscape/era, made by data/smoke/erabeds.mts at ERA_BED_TARGET_LUFS): played 3 dB
   * down from its file, so it sits at about -36 LUFS under the chapter's opening, texture rather than sound.
   */
  eraLong: 0.708,
} as const;

// ---------------------------------------------------------------- era beds (30 Oct 2026)
/**
 * A quiet ambient bed for the period a chapter opens in, under its first ERA_BED_SECONDS: an arcade room's
 * hum and crowd wash for the 1980s, a console's boot hum for the early 1990s, a modem's warble (kept far
 * down) for 1995-2003, and a clean room tone after that. Synthesised with ffmpeg (no licensed asset exists
 * for these), mastered to ERA_BED_TARGET_LUFS and checked under ERA_BED_LUFS_CEILING by the same script.
 */
export const ERA_BEDS = {
  arcade: "soundscape/era/arcade.wav",
  console: "soundscape/era/console.wav",
  modem: "soundscape/era/modem.wav",
  room: "soundscape/era/room.wav",
} as const;
export type EraBed = keyof typeof ERA_BEDS;
/** How long a chapter's era bed plays from the chapter's first frame, fades included. */
export const ERA_BED_SECONDS = 20;
/** The beds fade in over this long and out over ERA_BED_FADE_OUT_SECONDS at the end of their 20 s. */
export const ERA_BED_FADE_IN_SECONDS = 1;
export const ERA_BED_FADE_OUT_SECONDS = 3;
/** The files are mastered to this integrated loudness ... */
export const ERA_BED_TARGET_LUFS = -33;
/** ... and a file louder than this fails the validate step (the lead's ceiling). */
export const ERA_BED_LUFS_CEILING = -30;

/** The era bed for a chapter whose game came out in `year`; none when the year is unknown. */
export function eraBed(year: number | undefined): EraBed | undefined {
  if (!year || !Number.isFinite(year) || year < 1970) return undefined;
  if (year < 1990) return "arcade";
  if (year < 1995) return "console";
  if (year <= 2003) return "modem";
  return "room";
}

/** Under the narrator a sound dips by a quarter, so a word is never masked. */
export const UNDER_VOICE = 0.75;

export const sfxFile = (name: string) => `sfx/${name}.mp3`;

/**
 * The music beds (public/music, chosen by src/tools/sfxlab/pickbeds.py from Suno and ElevenLabs Music
 * candidates): seamless beat-cut loops of about two minutes, loudness-matched, almost nothing in the
 * speech band, no lead melody, no breakdowns, each in D or E major so the tuned sounds fit.
 */
export const BEDS = [
  { file: "music/bed_1.wav", key: "E" },
  { file: "music/bed_2.wav", key: "D" },
  { file: "music/bed_3.wav", key: "D" },
  { file: "music/bed_4.wav", key: "E" },
] as const;
/**
 * The mood beds (public/music/mood_*, chosen by src/tools/sfxlab/pickmoods.py from ElevenLabs Music takes, 28 Oct
 * 2026): a long video's chapter plays the one that fits its era or story (src/render/musicplan.ts). A mood
 * with no bed that passed the measurement keeps the house beds.
 */
export const MOOD_BEDS: Record<
  Mood,
  ReadonlyArray<{ file: string; key: "D" | "E" }>
> = {
  tense: [
    { file: "music/mood_tense_1.wav", key: "D" },
    { file: "music/mood_tense_2.wav", key: "E" },
  ],
  retro: [{ file: "music/mood_retro_1.wav", key: "D" }],
  triumph: [{ file: "music/mood_triumph_1.wav", key: "D" }],
  reflective: [{ file: "music/mood_reflective_1.wav", key: "D" }],
};
export const bedFor = (variant: number) =>
  BEDS[((variant % BEDS.length) + BEDS.length) % BEDS.length]!.file;

/** The key of each bed by file name, the retired Suno beds included (older renders name them). */
const MUSIC_KEY: Record<string, "D" | "E"> = {
  ...Object.fromEntries(BEDS.map((b) => [b.file.split("/").pop()!, b.key])),
  ...Object.fromEntries(
    Object.values(MOOD_BEDS)
      .flat()
      .map((b) => [b.file.split("/").pop()!, b.key]),
  ),
  "music_1.mp3": "D",
  "music_2.mp3": "D",
  "music_3.mp3": "E",
  "music_4.mp3": "E",
};
const TUNED = new Set<string>([
  SFX.sting,
  SFX.swell,
  ...SFX.land,
  RETRO_SFX.static,
  RETRO_SFX.poweroff,
]);

/** The version of a sound tuned to the music playing under it ("v3/sting" or "sfx/v3/sting.mp3" alike). */
export function inKey(
  name: string,
  musicSrc: string | null | undefined,
): string {
  const bare = name.replace(/^sfx\//, "").replace(/\.mp3$/, "");
  if (!TUNED.has(bare)) return name;
  const file = (musicSrc ?? "").split(/[\\/]/).pop() ?? "";
  // The Epidemic beds carry their key in the name ("tense_2-D.wav").
  const key = MUSIC_KEY[file] ?? file.match(/-([DE])\.\w+$/)?.[1] ?? "E";
  return name.replace(bare, `${bare}-${key}`);
}

/** Seconds from a sound's start to its loudest moment: cues start this early so the peak lands on the event. */
const PEAK: Record<string, number> = {
  "v3/air-1": 0.12,
  "v3/air-2": 0.105,
  "v3/air-3": 0.005,
  "v3/tick": 0,
  "v3/sting": 0.18,
  "v3/swell": 0.9,
  "v3/land": 0.155,
  "retro/tvon": 0,
  "retro/vhs": 0.795,
  "retro/static": 0.005,
  "retro/poweroff": 0.005,
};
export const leadFrames = (name: string, fps: number) =>
  Math.round((PEAK[name] ?? 0) * fps);

export interface LongSoundCandidate {
  key: number; // the moment window's index
  frame: number;
  /** stamp: the delay card's rubber stamp lands; record: the writer's record beat (the sting, in key). */
  kind: "glint" | "pop" | "stamp" | "record" | RetroKind;
}

/** The retro kit's moments: a screen switching on, a tape going in, static on a cut. */
type RetroKind = "tvon" | "vhs" | "static";
const isRetro = (k: LongSoundCandidate["kind"]): k is RetroKind =>
  k === "tvon" || k === "vhs" || k === "static";
/** Record stings at least this far apart: a sting is the loudest cue, and two a minute would cheapen it. */
export const RECORD_GAP_SECONDS = 45;

/**
 * Which moment sounds a long video plays: glints at least 8 s apart, pop-in whooshes at least 14 s
 * apart, record stings RECORD_GAP_SECONDS apart, any two sounds at least 4 s apart, and silence within
 * 1.5 s of an entry change (its swell and landing own that moment). Variants rotate so the same sound
 * never plays twice running.
 */
export function gateLongSounds(
  cands: LongSoundCandidate[],
  entryFrames: number[],
  fps: number,
): Map<number, string> {
  const out = new Map<number, string>();
  const near = (f: number) =>
    entryFrames.some((e) => Math.abs(f - e) < 1.5 * fps);
  const chosen: number[] = [];
  const lastOf = {
    glint: -Infinity,
    pop: -Infinity,
    stamp: -Infinity,
    record: -Infinity,
  };
  const turn = { glint: 0, pop: 0, stamp: 0, record: 0 };
  // The retro kit's sounds belong to what is on screen and a record sting to the writer's line, so they
  // claim their moments first; the moment sounds then fit around them by the same rules.
  const claims = (k: LongSoundCandidate["kind"]) =>
    Number(isRetro(k) || k === "record");
  const order = [...cands].sort(
    (a, b) => claims(b.kind) - claims(a.kind) || a.frame - b.frame,
  );
  for (const c of order) {
    if (near(c.frame) || chosen.some((f) => Math.abs(c.frame - f) < 4 * fps))
      continue;
    if (isRetro(c.kind)) {
      out.set(c.key, RETRO_SFX[c.kind]);
      chosen.push(c.frame);
      continue;
    }
    if (c.kind === "record") {
      if (c.frame - lastOf.record < RECORD_GAP_SECONDS * fps) continue;
      out.set(c.key, SFX.sting);
      chosen.push(c.frame);
      lastOf.record = c.frame;
      continue;
    }
    const gap = c.kind === "glint" ? 8 : c.kind === "stamp" ? 20 : 14;
    if (c.frame - lastOf[c.kind] < gap * fps) continue;
    const list =
      c.kind === "glint" ? SFX.glint : c.kind === "stamp" ? SFX.land : SFX.air;
    out.set(c.key, list[turn[c.kind]++ % list.length]!);
    chosen.push(c.frame);
    lastOf[c.kind] = c.frame;
  }
  return out;
}
