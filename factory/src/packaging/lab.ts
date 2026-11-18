// The Packaging Lab in the pipeline (PACKAGING_LAB, see ./settings.ts). Three moments:
//  - before upload: the video's title candidates are built, scored and checked; under "pick" the best that passes the
//    clarity check becomes the title, and for a long video the best-scoring of its rendered thumbnails becomes the
//    main one (the others stay in the Test & compare queue). Under "score" the same is logged and nothing changes.
//  - the Short's designed search tile: the hook words with the best score that pass the check.
//  - after 48 to 72 hours: the second chance (./secondchance.ts).
// Everything is logged as events (packaging_scored, packaging_pick) and kept on the episode's assets so the second
// chance never has to write anything new. Any failure here leaves the writer's packaging exactly as it was.
import path from "node:path";
import type { Db } from "../db.ts";
import type { Episode, EpisodeAssets } from "../episodes.ts";
import { logEvent } from "../episodes.ts";
import type { Script } from "../editorial/schema.ts";
import { errorMessage, log } from "../lib/util.ts";
import {
  hookCandidates,
  titleCandidates,
  type CandidateSource,
} from "./candidates.ts";
import type { Format } from "./corpus.ts";
import { namesOwnGame } from "./features.ts";
import { imageFeatures } from "./image.ts";
import {
  hookScore,
  imageScore,
  loadModel,
  pickBest,
  rankCandidates,
  titleScore,
  type FullModel,
  type Scored,
} from "./score.ts";
import { packagingAtLeast, type PackagingSettings } from "./settings.ts";

export interface PackagingRecord {
  scoredAt: string;
  mode: string;
  /** The title before the lab, the one chosen and the next best that pass (best first), with scores. */
  writerTitle: string;
  title: string;
  titleScore: number;
  runnersUp: Array<{ text: string; score: number; origin: string }>;
  /** Long videos: the rendered thumbnails' scores, by file name. */
  thumbScores?: Record<string, number>;
  /** The second chance, once applied (one per video, ever). */
  secondChance?: {
    at: string;
    kind: "title" | "thumbnail";
    from: string;
    to: string;
  };
}

export interface LabServices {
  cfg: { packaging: PackagingSettings; dataDir: string };
  db: Db;
  now(): Date;
}

/** Everything the video says, for the clarity check's figure test. */
export function sourceText(script: Script): string {
  const s = script as unknown as Record<string, any>;
  return [
    script.youtube?.title,
    ...(script.youtube?.title_variants ?? []),
    script.youtube?.description,
    script.youtube?.thumb_text,
    s.headline,
    s.hook,
    s.loop_line,
    s.pulse_take,
    ...((s.beats ?? []) as Array<{ narration?: string }>).map(
      (b) => b.narration,
    ),
    ...((s.entries ?? []) as Array<Record<string, unknown>>).map((e) =>
      JSON.stringify(e),
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

export const formatOf = (script: Script): Format =>
  (script as { runtime?: string }).runtime === "long" ? "long" : "short";

/** The candidate source for a script (pure). */
export function candidateSource(script: Script): CandidateSource {
  const s = script as unknown as Record<string, any>;
  return {
    title: script.youtube.title,
    variants: script.youtube.title_variants ?? [],
    headline: s.headline,
    hook: s.hook,
    lines: ((s.beats ?? []) as Array<{ narration?: string }>)
      .map((b) => b.narration ?? "")
      .filter(Boolean),
    game: s.game_title || undefined,
    rumour: s.is_rumour === true,
    thumbText: script.youtube.thumb_text,
  };
}

/** The ranked titles for a script (pure, given the model). */
export function rankTitles(
  model: FullModel,
  script: Script,
  max = 24,
  extra: string[] = [],
): Scored[] {
  const src = candidateSource(script);
  const format = formatOf(script);
  const cands = titleCandidates(src, max);
  for (const t of extra)
    if (!cands.some((c) => c.text.toLowerCase() === t.toLowerCase()))
      cands.push({ text: t, origin: "live" });
  // The game must be named when the writer named it; a theme ("Open-World Games") is not held against a ranking.
  const requireGame = src.game && namesOwnGame(src.title, src.game) ? src.game : undefined;
  return rankCandidates(cands, (t) => titleScore(model, format, t, src.game), {
    game: requireGame,
    rumour: src.rumour,
    source: sourceText(script),
    kind: "title",
  });
}

/**
 * Before upload: scores the title (and a long video's thumbnails), and under "pick" applies the best. Mutates
 * `ep.script_json` and `ep.assets_json` and saves both; returns whether anything changed.
 */
export async function packBeforeUpload(
  s: LabServices,
  ep: Episode,
  dir: string,
): Promise<boolean> {
  const st = s.cfg.packaging;
  if (
    !packagingAtLeast(st, "score") ||
    !ep.script_json ||
    ep.assets_json?.packaging
  )
    return false;
  const model = loadModel(s.cfg.dataDir);
  if (!model) return false;
  try {
    const script = ep.script_json;
    const ranked = rankTitles(model, script, st.candidates);
    const pick = pickBest(ranked, script.youtube.title, st.minLift);
    if (!pick) return false;
    const apply = packagingAtLeast(st, "pick") && pick.changed;
    const assets: EpisodeAssets = (ep.assets_json ??= {} as EpisodeAssets);
    const record: PackagingRecord = {
      scoredAt: s.now().toISOString(),
      mode: st.mode,
      writerTitle: script.youtube.title,
      title: apply ? pick.chosen.text : script.youtube.title,
      titleScore: apply ? pick.chosen.final : pick.current.final,
      runnersUp: (apply
        ? [pick.current, ...pick.runnersUp]
        : pick.changed
          ? [pick.chosen, ...pick.runnersUp]
          : pick.runnersUp
      )
        .filter((r) => r.clarity.ok)
        .slice(0, 4)
        .map((r) => ({
          text: r.text,
          score: Number(r.final.toFixed(3)),
          origin: r.origin,
        })),
    };
    let changed = false;
    if (apply) {
      const was = script.youtube.title;
      script.youtube.title = pick.chosen.text;
      // The writer's title stays in the Test & compare: it is the strongest control there is.
      if (formatOf(script) === "long")
        script.youtube.title_variants = [
          was,
          ...(script.youtube.title_variants ?? []).filter(
            (t) => t !== pick.chosen.text,
          ),
        ].slice(0, 2);
      changed = true;
    }
    // A long video's rendered designs, scored as pictures; the best becomes the main thumbnail under "pick".
    if (formatOf(script) === "long" && assets.thumb && model.image?.long) {
      const files = [assets.thumb, ...(assets.thumbVariants ?? [])];
      const scores: Record<string, number> = {};
      for (const f of files) {
        const feats = await imageFeatures(path.join(dir, f), "long");
        if (feats)
          scores[f] = Number(imageScore(model, "long", feats).toFixed(3));
      }
      record.thumbScores = scores;
      const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      if (
        packagingAtLeast(st, "pick") &&
        best &&
        best[0] !== assets.thumb &&
        best[1] - (scores[assets.thumb] ?? -Infinity) >= st.minLift
      ) {
        assets.thumbVariants = files.filter((f) => f !== best[0]);
        assets.thumb = best[0];
        changed = true;
      }
    }
    assets.packaging = record;
    await s.db.query(
      `UPDATE episodes SET script_json = $2, assets_json = $3 WHERE id = $1`,
      [ep.id, JSON.stringify(script), JSON.stringify(assets)],
    );
    await logEvent(
      s.db,
      ep.id,
      changed ? "packaging_pick" : "packaging_scored",
      {
        mode: st.mode,
        from: record.writerTitle,
        to: record.title,
        lift: Number.isFinite(pick.lift)
          ? Number(pick.lift.toFixed(3))
          : "clarity",
        top: ranked
          .slice(0, 6)
          .map((r) => ({
            t: r.text,
            s: Number(r.score.toFixed(3)),
            ok: r.clarity.ok,
            why: r.clarity.hard[0],
          })),
        thumbs: record.thumbScores,
        mainThumb: assets.thumb,
      },
    );
    return changed;
  } catch (err) {
    log("warn", "packaging lab failed; the writer's packaging stands", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return false;
  }
}

/** The Short's search-tile words under "pick": the best-scoring hook words that pass, else the writer's. */
export function pickHookWords(
  st: PackagingSettings,
  dataDir: string,
  script: Script,
): string | undefined {
  const writer = script.youtube?.thumb_text;
  if (!packagingAtLeast(st, "pick")) return writer;
  const model = loadModel(dataDir);
  if (!model) return writer;
  const src = candidateSource(script);
  const ranked = rankCandidates(
    hookCandidates(src),
    (t) => hookScore(model, t, src.game),
    {
      rumour: false, // the tile carries its own REPORTED label for a rumour
      source: sourceText(script),
      kind: "hook",
    },
  );
  const p = writer ? pickBest(ranked, writer, st.minLift) : undefined;
  if (p) return p.chosen.text;
  return ranked.find((r) => r.clarity.ok)?.text ?? writer;
}
