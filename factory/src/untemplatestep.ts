// The render step's side of breaking the template (src/render/untemplate.ts): the channel's memory of its newest
// Shorts, the arms recorded on the episode, and the plan changed in place. Off by default: SHORT_SOUND_PLAN=v3,
// SHORT_LAYOUTS=off and SHORT_FIRST_SHOT_MIN_S=0 leave every Short exactly as it was.

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import { log } from "./lib/util.ts";
import type { RenderPlan, SfxCue } from "./render/plan.ts";
import type { Segment } from "./render/timeline.ts";
import {
  FIRST_SHOT_MIN,
  holdFirstShot,
  layoutArm,
  LAYOUT_WINDOW,
  lowerLine,
  pickShape,
  planSparseSfx,
  sequenceOf,
  soundArm,
  type ShortShape,
} from "./render/untemplate.ts";

/** The newest Shorts' effect sequences and shapes, newest first (today's Shorts read { card, card }). */
export interface ShortMemory {
  sequences: string[];
  shapes: Array<Pick<ShortShape, "open" | "close">>;
}

/** Lanes that are not Shorts (or not Shorts this factory plans). */
const NOT_SHORTS = ["longform", "twin", "cutdown", "gameplay"];

/** The memory from stored plans and shapes (pure), rows newest first. */
export function memoryOf(
  rows: Array<{ sfx?: unknown; shape?: unknown }>,
): ShortMemory {
  const sequences: string[] = [];
  const shapes: ShortMemory["shapes"] = [];
  for (const r of rows) {
    const sfx = Array.isArray(r.sfx)
      ? (r.sfx as SfxCue[]).filter((c) => c && typeof c.file === "string")
      : [];
    sequences.push(sequenceOf(sfx));
    const sh = (r.shape ?? {}) as Partial<ShortShape>;
    shapes.push({
      open: sh.open === "footage" || sh.open === "lower" ? sh.open : "card",
      close: sh.close === "hold" ? "hold" : "card",
    });
  }
  return { sequences, shapes };
}

/** The newest `n` Shorts other than this one, from the database. */
export async function readShortMemory(
  db: Db,
  excludeId: string,
  n = LAYOUT_WINDOW,
): Promise<ShortMemory> {
  const res = await db.query<{ sfx: unknown; shape: unknown }>(
    `SELECT assets_json->'plan'->'sfx' AS sfx, assets_json->'shortShape' AS shape FROM episodes
      WHERE assets_json ? 'plan' AND lane <> ALL($3::text[]) AND status NOT IN ('failed','rejected') AND id <> $1
      ORDER BY created_at DESC LIMIT $2`,
    [excludeId, n, NOT_SHORTS],
  );
  return memoryOf(res);
}

/**
 * SHORT_LAYOUTS and SHORT_FIRST_SHOT_MIN_S, before the graphics gate (it measures what the shape draws). Returns the
 * shape to draw (undefined: today's) and changes `plan.shots` when the first shot is held. Records the arm on
 * `assets.shortShape` while the test runs. Only a clean-frame Short gets a chosen shape: the clean frame is what keeps
 * one overlay at a time beside the captions.
 */
export function shapeShort(o: {
  cfg: Pick<
    Config,
    "shortLayouts" | "shortLayoutsShare" | "shortFirstShotMinSeconds"
  >;
  id: string;
  plan: Pick<RenderPlan, "shots" | "fps">;
  clean: boolean;
  rumour: boolean;
  headline: string;
  thumbText?: string;
  memory: ShortMemory | undefined;
  assets: { shortShape?: unknown };
}): ShortShape | undefined {
  const arm = layoutArm(o.id, o.cfg.shortLayouts, o.cfg.shortLayoutsShare);
  let shape: ShortShape | undefined;
  // A re-render with the test off draws today's card: an arm recorded by an earlier render no longer says what shows.
  if (!o.cfg.shortLayouts) delete o.assets.shortShape;
  if (o.cfg.shortLayouts) {
    if (arm === "on" && o.clean) {
      shape = pickShape({
        id: o.id,
        recent: o.memory?.shapes ?? [],
        rumour: o.rumour,
        line: lowerLine(o.headline, o.thumbText),
      });
      o.assets.shortShape = { arm, ...shape };
    } else
      o.assets.shortShape = {
        arm,
        open: "card",
        close: "card",
        ...(arm === "on" ? { skipped: "not a clean-frame Short" } : {}),
      };
  }
  const minSeconds = Math.max(
    o.cfg.shortFirstShotMinSeconds,
    shape ? FIRST_SHOT_MIN / 30 : 0,
  );
  if (minSeconds > 0) {
    const before = o.plan.shots[0]
      ? o.plan.shots[0].end - o.plan.shots[0].start
      : 0;
    o.plan.shots = holdFirstShot(
      o.plan.shots,
      Math.round(minSeconds * o.plan.fps),
    );
    const after = o.plan.shots[0]
      ? o.plan.shots[0].end - o.plan.shots[0].start
      : 0;
    if (after !== before)
      log("info", "short first shot held", {
        episode: o.id,
        fromFrames: before,
        toFrames: after,
      });
  }
  return shape;
}

/**
 * SHORT_SOUND_PLAN, after the graphics gate (the sounds land where the cards are finally drawn). On the sparse side
 * `plan.sfx` is rewritten and the silence beat stored; a plan stored by an earlier sparse render but now on the v3
 * side gets the v3 cues back (`v3` builds them). Records the arm on `assets.shortSoundArm` while the test runs.
 */
export function soundShort(o: {
  cfg: Pick<Config, "shortSoundPlan" | "shortSoundSparseShare">;
  id: string;
  plan: RenderPlan;
  segments: Segment[];
  words: Array<{ text: string; start: number; end: number }>;
  stamps: Array<{ at: number }>;
  clean: boolean;
  stampSound: { name: string; volume: number };
  shape?: ShortShape;
  /** PEOPLE_INSETS: the insets and the tracklist card, which arrive on screen like cards. */
  people?: Parameters<typeof planSparseSfx>[0]["people"];
  tracklist?: Parameters<typeof planSparseSfx>[0]["tracklist"];
  mentions?: Parameters<typeof planSparseSfx>[0]["mentions"];
  /** The game collage card where the render step placed it (pipeline.ts stingAt); absent, none. */
  sting?: Parameters<typeof planSparseSfx>[0]["sting"];
  memory: ShortMemory | undefined;
  assets: { shortSoundArm?: "sparse" | "v3" };
  v3: () => SfxCue[];
}): {
  arm: "sparse" | "v3";
  sequence: string;
  silence?: { from: number; to: number };
} {
  const arm = soundArm(o.id, o.cfg.shortSoundPlan, o.cfg.shortSoundSparseShare);
  if (o.cfg.shortSoundPlan === "sparse") o.assets.shortSoundArm = arm;
  else delete o.assets.shortSoundArm;
  if (arm !== "sparse") {
    if (o.plan.soundPlan === "sparse") {
      o.plan.sfx = o.v3();
      delete o.plan.soundPlan;
      delete o.plan.silences;
    }
    return { arm, sequence: sequenceOf(o.plan.sfx) };
  }
  const r = planSparseSfx({
    id: o.id,
    plan: o.plan,
    segments: o.segments,
    words: o.words,
    stamps: o.stamps,
    clean: o.clean,
    stampSound: o.stampSound,
    recent: o.memory?.sequences ?? [],
    shape: o.shape,
    people: o.people,
    tracklist: o.tracklist,
    mentions: o.mentions,
    sting: o.sting,
  });
  o.plan.sfx = r.sfx;
  o.plan.soundPlan = "sparse";
  if (r.silence) o.plan.silences = [r.silence];
  else delete o.plan.silences;
  return { arm, sequence: r.sequence, silence: r.silence };
}

/** Whether the render step runs the sound step at all (pure): only with SHORT_SOUND_PLAN=sparse or a stored sparse plan. */
export function soundStepDue(
  cfg: Pick<Config, "shortSoundPlan">,
  plan: Pick<RenderPlan, "soundPlan">,
): boolean {
  return cfg.shortSoundPlan === "sparse" || plan.soundPlan === "sparse";
}

/**
 * A plan stored by a sparse render but now on the v3 side (the test switched off, or the share changed), right where
 * the render step loads it: `v3` gives the plan's own cues as buildPlan makes them, before the word stamp, the series
 * sting and the ident, which the render step then lays on top as for any v3 plan. Clears the sparse marks and the arm.
 * Returns whether it changed anything.
 */
export function restoreV3Sound(o: {
  cfg: Pick<Config, "shortSoundPlan" | "shortSoundSparseShare">;
  id: string;
  plan: RenderPlan;
  assets: { shortSoundArm?: "sparse" | "v3" };
  v3: () => SfxCue[];
}): boolean {
  if (o.plan.soundPlan !== "sparse") return false;
  const arm = soundArm(o.id, o.cfg.shortSoundPlan, o.cfg.shortSoundSparseShare);
  if (arm === "sparse") return false;
  o.plan.sfx = o.v3();
  delete o.plan.soundPlan;
  delete o.plan.silences;
  if (o.cfg.shortSoundPlan === "sparse") o.assets.shortSoundArm = arm;
  else delete o.assets.shortSoundArm;
  return true;
}
