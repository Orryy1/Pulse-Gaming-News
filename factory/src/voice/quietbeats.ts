// The writer's quiet beats reach the voice (30 Oct 2026). A documentary's pauses are set when it is voiced
// (src/voice/pauses.ts: the silences are cut tight, then the chapter breathers are put into the file), so
// a "quiet" beat is honoured there too: the pause after its sentence grows by up to QUIET_BEAT_SECONDS.
// This finds those sentences on the voice's timeline from the script's shot list, pure, so the pipeline's
// voice step stays one call.
import type { Script } from "../editorial/schema.ts";
import { momentKeys, momentWindows } from "../render/longplan.ts";
import type { Segment } from "../render/timeline.ts";
import { quietGaps, type Gap, type TimedWord } from "./pauses.ts";

/** The breaths the quiet beats ask for, on the narration as voiced (before any silence is put in). */
export function quietBeatGaps(
  script: Pick<Script, "entries">,
  words: TimedWord[],
  segments: Segment[],
): Gap[] {
  // The shot list per entry in on-screen order, as the render reads it (lowest rank first).
  const moments = [...(script.entries ?? [])]
    .sort((a, b) => b.rank - a.rank)
    .map((e) => e.moments ?? []);
  if (!moments.some((m) => m.length)) return [];
  const windows = momentWindows(
    segments,
    words,
    moments.map((m) => m.length),
    moments.map((e) => e.map(momentKeys)),
  ).filter(
    (w) => w.moment > 0 && moments[w.entry]?.[w.moment]?.beat === "quiet",
  );
  return quietGaps(words, windows);
}
