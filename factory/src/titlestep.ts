// The title-shape steps the pipeline runs (src/editorial/titleshape.ts has the rule): the writers of rankings and
// ranking Shorts are sent back when their title breaks it, and a long video whose title still breaks it at the
// title-test step takes a passing alternative before upload, logged and told to the owner (TITLE_SHAPES).
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { logEvent } from "./episodes.ts";
import type { Script } from "./editorial/schema.ts";
import { shapedTitleSwap, titleShapeProblems } from "./editorial/titleshape.ts";

/** Formats whose title is an opinion or an argument; the data formats (deals, radar, recaps) keep their counts. */
export const SHAPED_EVERGREEN_FORMATS = new Set([
  "ranking",
  "best_per_year",
  "versus",
  "years_later",
  "still_good",
]);

/** The writer's feedback for a ranking or evergreen title, empty when it passes or TITLE_SHAPES is off. */
export function writerTitleProblems(
  cfg: Pick<Config, "titleShapes" | "titleShapeAllow">,
  title: string,
  format?: string,
): string[] {
  if (!cfg.titleShapes) return [];
  if (format && !SHAPED_EVERGREEN_FORMATS.has(format)) return [];
  // "Skyrim: 15 Years Later" is a duration, not a calendar year or a list count: it passes.
  return titleShapeProblems(title, cfg.titleShapeAllow);
}

/** Before upload: a long video's failing title gives way to a passing alternative, logged and told to the owner. */
export async function applyTitleShape(
  s: {
    cfg: Pick<Config, "titleShapes" | "titleShapeAllow">;
    db: Db;
    notify(m: { level: "info"; content: string }): Promise<unknown>;
  },
  ep: { id: string },
  script: Script,
): Promise<boolean> {
  if (!s.cfg.titleShapes) return false;
  const swap = shapedTitleSwap(
    script.youtube.title,
    script.youtube.title_variants ?? [],
    s.cfg.titleShapeAllow,
  );
  if (!swap) return false;
  const was = script.youtube.title;
  script.youtube.title = swap.title;
  // The failing title is not tested against the others.
  script.youtube.title_variants = swap.alternatives.filter(
    (t) => !titleShapeProblems(t, s.cfg.titleShapeAllow).length,
  );
  await logEvent(s.db, ep.id, "title_shaped", {
    from: was,
    to: swap.title,
    reason: swap.reason,
  });
  await s
    .notify({
      level: "info",
      content: `Title changed before upload: "${was}" is now "${swap.title}". ${swap.reason}`,
    })
    .catch(() => undefined);
  return true;
}
