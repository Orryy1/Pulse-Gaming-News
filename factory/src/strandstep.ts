// The pipeline's side of the strand frames (src/strandframe.ts has the rules): before a long video's thumbnails are
// designed its title is held to its strand's shape and its thumbnail words to the strand's count (STRAND_FRAMES), and
// before a Short is released its title is led by the game's name (SHORT_TITLE_GAME_FIRST). Each change is logged; a
// long title nothing can fit is left as it is and the owner is told once.
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { logEvent } from "./episodes.ts";
import type { Script } from "./editorial/schema.ts";
import {
  framedTitle,
  framedVariants,
  gameFirstShortTitle,
  longStrandOf,
  shortTitleNotes,
  strandThumbWords,
  strandTitleProblems,
  type LongStrand,
} from "./strandframe.ts";

/** The name a title leads with: no bracketed edition, and the part after a colon ("Modern Warfare 4"). */
export function shortGameName(game: string): string {
  const g = game.replace(/\s*\([^)]*\)\s*$/, "").trim() || game;
  return g.includes(":") ? (g.split(":").pop() ?? g).trim() || g : g;
}

interface StepServices {
  cfg: Pick<Config, "strandFrames" | "shortTitleGameFirst">;
  db: Db;
  notify(m: { level: "info"; content: string }): Promise<unknown>;
}

/** STRAND_FRAMES: the long video's title and thumbnail words in its strand's frame. Returns the strand, if any. */
export async function applyStrandFrame(
  s: StepServices,
  ep: { id: string },
  script: Script,
  topic?: { format?: string; guide?: unknown },
): Promise<LongStrand | undefined> {
  if (!s.cfg.strandFrames) return undefined;
  const strand = longStrandOf(script, topic);
  if (!strand) return undefined;
  const game = script.why_died?.game ?? script.game_title;
  // The guide's plan already fixes its title (src/longguide.ts); only its thumbnail words are held here.
  if (strand !== "guide") {
    const was = script.youtube.title;
    const swap = framedTitle(
      strand,
      was,
      script.youtube.title_variants ?? [],
      game,
    );
    if (swap) {
      script.youtube.title = swap.title;
      script.youtube.title_variants = swap.variants;
      await logEvent(s.db, ep.id, "strand_frame", {
        strand,
        from: was,
        to: swap.title,
        reason: swap.reason,
      });
    } else {
      script.youtube.title_variants = framedVariants(
        strand,
        script.youtube.title_variants ?? [],
        game,
      );
      const problems = strandTitleProblems(strand, was, game);
      if (problems.length) {
        await logEvent(s.db, ep.id, "strand_frame_miss", {
          strand,
          title: was,
          problems,
        });
        await s
          .notify({
            level: "info",
            content: `"${was}" stays as written: no title fits the ${strand} frame. ${problems[0]}`,
          })
          .catch(() => undefined);
      }
    }
  }
  const words = strandThumbWords(strand, script.youtube.thumb_text);
  if (words !== (script.youtube.thumb_text ?? "")) {
    if (words) script.youtube.thumb_text = words;
    else delete script.youtube.thumb_text;
  }
  return strand;
}

/** SHORT_TITLE_GAME_FIRST: the Short's title led by the game's name; true when it changed. */
export async function applyShortTitleGameFirst(
  s: StepServices,
  ep: { id: string; lane?: string | null },
  script: Script,
): Promise<boolean> {
  if (
    !s.cfg.shortTitleGameFirst ||
    script.runtime === "long" ||
    script.twin ||
    script.gameplay
  )
    return false;
  const game = script.game_title?.trim();
  if (!game) return false;
  const was = script.youtube.title;
  const title = gameFirstShortTitle(was, game, shortGameName(game));
  const notes = shortTitleNotes(title, game, shortGameName(game));
  if (title === was) {
    if (notes.length)
      await logEvent(s.db, ep.id, "short_title_notes", { title, notes });
    return false;
  }
  script.youtube.title = title;
  await logEvent(s.db, ep.id, "short_title_game_first", {
    from: was,
    to: title,
    notes,
  });
  return true;
}
