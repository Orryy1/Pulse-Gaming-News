// Which of the long-video craft each long format gets (31 Oct 2026, owner: everything built for the
// documentaries should apply to every long video). Until then the render step gated each device on
// `evergreen_format === "documentary"`, so the weekly recap (written through the documentary's converter) had
// them and the rankings had none. This decides it in one place, per format and per setting, so the render
// step, the release gate and the tests read the same answer:
//  - documentary: everything, as before.
//  - recap (the weekly "This Week in Gaming", a documentary-shaped script with `recap`): as a documentary;
//    its chapters are its stories.
//  - ranking (and any other long format): its chapters are its entries (the "rank" beats). It gets the
//    picture top-up, the fillers, the camera, the title drop, the chapter index (the counter shows the rank
//    where an entry has no year), the cut rhythm with a burst inside every entry (a Short's pace), the bookend
//    ending, the sound beats and era beds, the release gate and the signature cold open on its hook.
//    Open-loop callbacks only when the script carries placed loops (a documentary outline makes them; a
//    ranking has no outline, and loops guessed from its hook would recall shots for questions nobody asked).
//    The chapter breathers, the end card ("A new documentary every month") and the documentary's thumbnail
//    designs stay with the documentaries: a ranking is paced entry to entry, and its end line differs.
// Pure; the settings are passed in.
import type { Script } from "./editorial/schema.ts";
import type { CameraTechnique } from "./render/camera.ts";

export type LongFormat = "documentary" | "recap" | "ranking" | "long";

/** The long format of a script: a recap first (it is documentary-shaped), then the evergreen format. */
export function longFormatOf(
  script: Pick<Script, "evergreen_format" | "recap">,
): LongFormat {
  if (script.recap) return "recap";
  if (script.evergreen_format === "documentary") return "documentary";
  if (script.evergreen_format === "ranking") return "ranking";
  return "long";
}

/** The owner's word for the format, at the start of a Discord line ("Ranking "Every Halo Campaign Ranked": ..."). */
export function longKindLabel(format: LongFormat): string {
  return format === "documentary"
    ? "Documentary"
    : format === "recap"
      ? "Weekly recap"
      : format === "ranking"
        ? "Ranking"
        : "Long video";
}

/** The settings the decision reads (a slice of src/config.ts Config). */
export interface LongCraftSettings {
  fillers: boolean;
  longCamera: readonly CameraTechnique[];
  docTitleDrop: boolean;
  docChapterIndex: boolean;
  docOpenLoops: boolean;
  docCutRhythm: boolean;
  docBookendEnding: boolean;
  docColdOpen: boolean;
  docSoundBeats: boolean;
  releaseGate: boolean;
  longEntryPace: boolean;
}

export interface LongCraft {
  format: LongFormat;
  /** The documentary's own shape: chapter breathers, the end card, the DOC thumbnail designs. */
  documentaryShape: boolean;
  fillers: boolean;
  camera: CameraTechnique[];
  titleDrop: boolean;
  chapterIndex: boolean;
  /** "derive": guess loops from the hook when none were placed (documentaries); "placed": only the script's own. */
  loops: "derive" | "placed" | "off";
  rhythm: boolean;
  /** A burst of quicker cuts inside every entry (rankings), with the rhythm. */
  entryPace: boolean;
  bookend: boolean;
  coldOpen: boolean;
  soundBeats: boolean;
  eraBeds: boolean;
  releaseGate: boolean;
}

/** What one long video gets, by its format and the settings (pure). */
export function longCraft(
  script: Pick<Script, "evergreen_format" | "recap">,
  cfg: LongCraftSettings,
): LongCraft {
  const format = longFormatOf(script);
  const docShaped = format === "documentary" || format === "recap";
  return {
    format,
    documentaryShape: docShaped,
    fillers: cfg.fillers,
    camera: [...cfg.longCamera],
    titleDrop: cfg.docTitleDrop,
    chapterIndex: cfg.docChapterIndex,
    loops: !cfg.docOpenLoops ? "off" : docShaped ? "derive" : "placed",
    rhythm: cfg.docCutRhythm,
    entryPace: cfg.docCutRhythm && cfg.longEntryPace && !docShaped,
    bookend: cfg.docBookendEnding,
    coldOpen: cfg.docColdOpen,
    soundBeats: cfg.docSoundBeats,
    eraBeds: cfg.docSoundBeats,
    releaseGate: cfg.releaseGate,
  };
}

/**
 * The open loops a video's render recalls (pure): none when off; for a ranking only the ones the script carries
 * placed (`placed`, script.open_loops); for a documentary or recap those, or the ones derived from its hook.
 */
export function loopsFor<T>(
  c: Pick<LongCraft, "loops">,
  placed: T[] | undefined,
  derive: () => T[],
): T[] | undefined {
  if (c.loops === "off") return undefined;
  if (c.loops === "placed") return placed?.length ? placed : undefined;
  return derive();
}

/** The event log's record of the decision (no camera list repeated: the camera event has it). */
export function longCraftEvent(c: LongCraft): Record<string, unknown> {
  return {
    format: c.format,
    fillers: c.fillers,
    camera: c.camera.length,
    titleDrop: c.titleDrop,
    chapterIndex: c.chapterIndex,
    loops: c.loops,
    rhythm: c.rhythm,
    entryPace: c.entryPace,
    bookend: c.bookend,
    coldOpen: c.coldOpen,
    soundBeats: c.soundBeats,
    releaseGate: c.releaseGate,
  };
}
