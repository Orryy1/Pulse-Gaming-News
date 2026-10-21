// The channel's soundscape: one family of sounds (public/sfx/v2: ElevenLabs takes and Adobe Production
// Elements, finished alike by src/tools/build-sfx.ts) and the rules for using them. Sounds mark structure
// (the open, each new entry, the verdict, the close) and the odd number; they never chase every cut.
// Levels sit well under the narrator, and nothing plays within a breath of another sound.

export const SFX = {
  air: ["v2/air-1", "v2/air-2", "v2/air-3"],
  swell: "v2/swell-1",
  land: ["v2/land-1", "v2/land-2"],
  glint: ["v2/glint-1", "v2/glint-2"],
  sting: "v2/sting",
} as const;

/** Mix levels (the narrator plays at 1). Felt, never startling. */
export const LEVEL = {
  sting: 0.26,
  air: 0.16,
  swell: 0.14,
  land: 0.2,
  glint: 0.12,
  /** Long videos run quieter: fifteen minutes of sound must not tire the ear. */
  airLong: 0.11,
  glintLong: 0.1,
  swellLong: 0.12,
  landLong: 0.17,
} as const;

/** Under the narrator a sound dips by a quarter, so a word is never masked. */
export const UNDER_VOICE = 0.75;

export const sfxFile = (name: string) => `sfx/${name}.mp3`;

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
