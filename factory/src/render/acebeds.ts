// Pulse's own music (ACE_BEDS, off by default; built 20 Nov 2026): a channel ident and theme, and era and genre beds,
// made locally with ACE-Step 1.5 (MIT; its model card clears generated music for commercial use, public/music/ace/
// LICENCE.md) from style prompts only (src/tools/musiclab/acebeds.json), and chosen and finished by measurement
// (src/tools/musiclab/pickace.py) to the soundscape v3 rules: beds at the house beds' -12.7 LUFS as seamless beat-cut
// loops in D or E major, the ident loudness-matched like every sound file. Every kept file was fingerprinted against
// the channel's music and the local libraries and its melody checked against well-known game themes.
//   - A long video's chapter whose mood has an ACE bed may play it (the beds join the music plan's choice, as the
//     Epidemic beds do), including the "fantasy" mood that only these beds carry.
//   - A Short about an old game, Vice City or a fantasy world plays the matching era or genre bed (SHORT_MOODS),
//     still never one of the last few Shorts' beds; every other Short keeps the house rotation.
//   - A Short's opening sting is the Pulse ident.
// Pure and free of node imports: the Remotion bundle uses it.
import { moodOf, type Mood } from "./musicplan.ts";

export interface AceBed {
  /** Under public ("music/ace/retro_1.flac"). */
  file: string;
  key: "D" | "E";
  mood: Mood;
  /** The bar grid (seconds), as src/render/soundscape.ts BED_GRID. */
  grid?: { bar: number; first: number; loop: number };
}

export interface AceLibrary {
  beds: AceBed[];
  /** The ident stings, names under public/sfx without the key and .mp3 ("ace/ident_1" is ace/ident_1-D.mp3 and
   * ace/ident_1-E.mp3): tuned like the house sting, so the ident is always in the bed's key. */
  idents: Array<{ sting: string; peak: number }>;
  /** The full theme, under public, for intros and outros. */
  theme?: { file: string; key: "D" | "E"; seconds: number };
}

/** The moods a Short takes an ACE bed for: the era and genre ones, where the music should say where we are. */
export const SHORT_MOODS: readonly Mood[] = ["retro", "synthwave", "fantasy"];

/** The beds as a long video's extra beds (src/render/Long.tsx extraBeds), file, key and mood (pure). */
export function aceExtraBeds(
  lib: AceLibrary,
): Array<{ file: string; key: "D" | "E"; mood: string }> {
  return lib.beds.map(({ file, key, mood }) => ({ file, key, mood }));
}

/**
 * A Short's era or genre mood when an ACE bed carries it (pure): the music plan's reading of the script and the game's
 * year, kept only when it is one of SHORT_MOODS and the library has a bed for it.
 */
export function aceShortMood(
  o: { text: string; year?: number },
  lib: AceLibrary,
): Mood | undefined {
  const has = (m: Mood) => lib.beds.some((b) => b.mood === m);
  const m = moodOf({
    text: o.text,
    year: o.year,
    first: false,
    last: false,
    documentary: false,
    fantasy: has("fantasy"),
  });
  return m && SHORT_MOODS.includes(m) && has(m) ? m : undefined;
}

/** The ACE beds of a mood, the rotation's pool for a Short (pure). */
export function acePool(mood: Mood, lib: AceLibrary): string[] {
  return lib.beds.filter((b) => b.mood === mood).map((b) => b.file);
}

/** The ident a video opens on (pure): one of the library's, by the video's own number; none when the library has none. */
export function aceIdent(
  lib: AceLibrary,
  seed: number,
): { sting: string; peak: number } | undefined {
  if (!lib.idents.length) return undefined;
  return lib.idents[Math.abs(Math.trunc(seed)) % lib.idents.length];
}

/**
 * A Short's sound cues with the opening sting replaced by the ident (pure): only a sting on the first frame is
 * swapped, at its own volume; anything else, or no ident, leaves the cues as they were.
 */
export function withIdent<C extends { file: string; frame: number }>(
  cues: C[],
  stingFile: string,
  identFile: string | undefined,
): C[] {
  if (!identFile) return cues;
  return cues.map((c) =>
    c.frame === 0 && c.file === stingFile ? { ...c, file: identFile } : c,
  );
}
