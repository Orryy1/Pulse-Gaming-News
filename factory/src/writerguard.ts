// The door in front of the voice: a script with the writer's notes to itself in it stops here, with a loud alert.
// See src/editorial/writernotes.ts for what counts and the incident behind it.

import { logEvent, type Episode } from "./episodes.ts";
import type { Services } from "./pipeline.ts";
import type { Script } from "./editorial/schema.ts";
import {
  scriptWriterNotes,
  writerNoteSummary,
  type WriterNoteFinding,
} from "./editorial/writernotes.ts";
import { FatalError, log } from "./lib/util.ts";

/**
 * Writer's notes never go on: logged, a loud alert to the owner, and the video stops (src/editorial/writernotes.ts).
 * The writers' own loops have already sent the text back by now; this is the door they can't get past.
 */
export async function stopForWriterNotes(
  s: Pick<Services, "db" | "notify">,
  ep: Pick<Episode, "id" | "script_json" | "story_json">,
  stage: string,
  found: readonly WriterNoteFinding[],
): Promise<never> {
  const line = writerNoteSummary(found);
  await logEvent(s.db, ep.id, "writer_notes", {
    stage,
    count: found.length,
    found: found.slice(0, 12),
  });
  log("error", "writer's notes in the script: the video stops", {
    episode: ep.id,
    stage,
    count: found.length,
    line,
  });
  await s.notify({
    ping: true,
    content: `🛑 Stopped "${ep.script_json?.youtube?.title ?? ep.script_json?.headline ?? ep.story_json?.headline ?? ep.id}" ${stage}: the writer's notes to itself are in the narration (${found.length} places). ${line}. Nothing has been sent to the voice or YouTube from this step on.`,
  });
  throw new FatalError(`writer's notes in the narration (${stage}): ${line}`);
}

/** The door after each writer, before each voice: every lane's script comes through here. */
export async function guardScript(
  s: Pick<Services, "db" | "notify"> & { cfg: { writerNotesGuard?: boolean } },
  ep: Pick<Episode, "id" | "script_json" | "story_json">,
  script: Script | null | undefined,
  stage: string,
): Promise<void> {
  if (!script || s.cfg.writerNotesGuard === false) return;
  const found = scriptWriterNotes(script);
  if (found.length)
    await stopForWriterNotes(s, { ...ep, script_json: script }, stage, found);
}
