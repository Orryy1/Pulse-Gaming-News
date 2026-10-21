// The channel's soundscape: one family of sounds (public/sfx/v3) and the rules for using them. Sounds mark
// structure (the open, each new entry, the verdict, the close) and the odd number; they never chase every
// cut. Levels sit well under the narrator, and nothing plays within a breath of another sound.
//
// The set was chosen by measurement (src/tools/sfxlab/lab.py, report in src/tools/sfxlab/v3_report.json) from 400+
// ElevenLabs takes and library sounds: warm (no harsh 2-6 kHz presence), audible on phone speakers, no
// ringing high tones, no jolts. Every file is matched for perceived loudness, so a level here means the
// same thing for every sound. Pitched sounds come tuned to each music bed's key.

export const SFX = {
  air: ["v3/air-1", "v3/air-2", "v3/air-3"],
  swell: "v3/swell",
  land: ["v3/land"],
  glint: ["v3/tick"],
  sting: "v3/sting",
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
} as const;

/** Under the narrator a sound dips by a quarter, so a word is never masked. */
export const UNDER_VOICE = 0.75;

export const sfxFile = (name: string) => `sfx/${name}.mp3`;

/** The key of each music bed (measured by src/tools/sfxlab/key.py). */
const MUSIC_KEY: Record<string, "D" | "E"> = {
  "music_1.mp3": "D",
  "music_2.mp3": "D",
  "music_3.mp3": "E",
  "music_4.mp3": "E",
};
const TUNED = new Set<string>([SFX.sting, SFX.swell, ...SFX.land]);

/** The version of a sound tuned to the music playing under it ("v3/sting" or "sfx/v3/sting.mp3" alike). */
export function inKey(
  name: string,
  musicSrc: string | null | undefined,
): string {
  const bare = name.replace(/^sfx\//, "").replace(/\.mp3$/, "");
  if (!TUNED.has(bare)) return name;
  const key = MUSIC_KEY[(musicSrc ?? "").split(/[\\/]/).pop() ?? ""] ?? "E";
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
};
export const leadFrames = (name: string, fps: number) =>
  Math.round((PEAK[name] ?? 0) * fps);

export interface LongSoundCandidate {
  key: number; // the moment window's index
  frame: number;
  kind: "glint" | "pop";
}

/**
 * Which moment sounds a long video plays: glints at least 8 s apart, pop-in whooshes at least 14 s
 * apart, any two sounds at least 4 s apart, and silence within 1.5 s of an entry change (its swell and
 * landing own that moment). Variants rotate so the same sound never plays twice running.
 */
export function gateLongSounds(
  cands: LongSoundCandidate[],
  entryFrames: number[],
  fps: number,
): Map<number, string> {
  const out = new Map<number, string>();
  const near = (f: number) =>
    entryFrames.some((e) => Math.abs(f - e) < 1.5 * fps);
  let last = -Infinity;
  const lastOf = { glint: -Infinity, pop: -Infinity };
  const turn = { glint: 0, pop: 0 };
  for (const c of [...cands].sort((a, b) => a.frame - b.frame)) {
    const gap = c.kind === "glint" ? 8 : 14;
    if (
      near(c.frame) ||
      c.frame - last < 4 * fps ||
      c.frame - lastOf[c.kind] < gap * fps
    )
      continue;
    const list = c.kind === "glint" ? SFX.glint : SFX.air;
    out.set(c.key, list[turn[c.kind]++ % list.length]!);
    last = c.frame;
    lastOf[c.kind] = c.frame;
  }
  return out;
}
