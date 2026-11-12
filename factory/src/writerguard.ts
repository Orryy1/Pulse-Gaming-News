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
import {
  spoilerHits,
  spoilerWindows,
  type SpoilerHit,
  type SpoilerWindow,
} from "./sceneindex/spoilers.ts";

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

/**
 * Every spoiler a script holds for a game in its spoiler window (pure), by where it sits: what the viewer hears or
 * reads (the hook, every line, the on-screen words, the take, the close, the headline, the title and the
 * description). The script's own games count as named everywhere in it.
 */
export function scriptSpoilers(
  script: Pick<Script, "hook" | "beats" | "headline" | "loop_line" | "game_title"> & {
    pulse_take?: { narration?: string; on_screen?: string };
    youtube?: { title?: string; description?: string };
    entries?: Array<{ game_title?: string }>;
  },
  windows: readonly SpoilerWindow[],
  now: Date,
): Array<SpoilerHit & { where: string }> {
  if (!windows.length) return [];
  const about = [script.game_title, ...(script.entries ?? []).map((e) => e.game_title)];
  const out: Array<SpoilerHit & { where: string }> = [];
  const look = (where: string, text?: string) => {
    if (text) for (const h of spoilerHits(text, windows, now, about)) out.push({ ...h, where });
  };
  look("hook", script.hook);
  (script.beats ?? []).forEach((b, i) => {
    look(`beat ${i}`, b.narration);
    const v = (b as { visual?: { primary?: string; secondary?: string; items?: readonly string[] } }).visual;
    look(`beat ${i} on screen`, [v?.primary, v?.secondary, ...(v?.items ?? [])].filter(Boolean).join(". "));
  });
  look("take", script.pulse_take?.narration);
  look("take on screen", script.pulse_take?.on_screen);
  look("close", script.loop_line);
  look("headline", script.headline);
  look("title", script.youtube?.title);
  look("description", script.youtube?.description);
  return out;
}

/** A story spoiler during a game's spoiler window never goes on: logged, a loud alert, and the video stops. */
export async function stopForSpoilers(
  s: Pick<Services, "db" | "notify">,
  ep: Pick<Episode, "id" | "script_json" | "story_json">,
  stage: string,
  found: ReadonlyArray<SpoilerHit & { where: string }>,
): Promise<never> {
  const line = found
    .slice(0, 3)
    .map((h) => `${h.where}: "${h.phrase}" (${h.what} of ${h.game})`)
    .join("; ");
  await logEvent(s.db, ep.id, "spoiler_stopped", { stage, count: found.length, found: found.slice(0, 12) });
  log("error", "story spoiler in the script: the video stops", { episode: ep.id, stage, line });
  await s.notify({
    ping: true,
    content: `🛑 Stopped "${ep.script_json?.youtube?.title ?? ep.script_json?.headline ?? ep.story_json?.headline ?? ep.id}" ${stage}: it would spoil a game still in its spoiler window (${found.length} places). ${line}. Nothing has been sent to the voice or YouTube from this step on.`,
  });
  throw new FatalError(`story spoiler in the script (${stage}): ${line}`);
}

/** The door after each writer, before each voice: every lane's script comes through here. */
export async function guardScript(
  s: Pick<Services, "db" | "notify"> & { cfg: { writerNotesGuard?: boolean; spoilerGuard?: boolean } },
  ep: Pick<Episode, "id" | "script_json" | "story_json">,
  script: Script | null | undefined,
  stage: string,
  windows: readonly SpoilerWindow[] = spoilerWindows(),
  now = new Date(),
): Promise<void> {
  if (!script) return;
  if (s.cfg.writerNotesGuard !== false) {
    const found = scriptWriterNotes(script);
    if (found.length)
      await stopForWriterNotes(s, { ...ep, script_json: script }, stage, found);
  }
  // SPOILER_GUARD: the writers' validators send spoilers back; this is the door they can't get past.
  if (s.cfg.spoilerGuard) {
    const spoilers = scriptSpoilers(script, windows, now);
    if (spoilers.length) await stopForSpoilers(s, { ...ep, script_json: script }, stage, spoilers);
  }
}
