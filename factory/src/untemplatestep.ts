// The render step's side of breaking the template (src/render/untemplate.ts): the channel's memory of its newest
// Shorts, the arms recorded on the episode, the plan changed in place and the weekly report's lines per arm. Off by
// default: SHORT_SOUND_PLAN=v3, SHORT_LAYOUTS=off and SHORT_FIRST_SHOT_MIN_S=0 leave every Short exactly as it was.

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import { log } from "./lib/util.ts";
import type { RenderPlan, SfxCue } from "./render/plan.ts";
import type { Segment } from "./render/timeline.ts";
import {
  firstShotArm,
  holdFirstShot,
  layoutArm,
  LAYOUT_WINDOW,
  lowerLine,
  pickShape,
  planSparseSfx,
  sequenceOf,
  soundArm,
  type FirstShotArm,
  type ShortShape,
} from "./render/untemplate.ts";

/**
 * The newest Shorts' effect sequences (every Short, newest first) and the newest shapes the layout test chose (only
 * Shorts on its side with a chosen shape, newest first): the 40% opening cap is measured over the test's own Shorts,
 * since every Short off the test opens on the card.
 */
export interface ShortMemory {
  sequences: string[];
  shapes: Array<Pick<ShortShape, "open" | "close">>;
}

/**
 * A stored shape the layout test chose (pure): arm "on", not skipped, with a known opening and closing. A Short whose
 * lower third was unavailable still chose its opening between the other two, so it counts like any other.
 */
function chosenShape(v: unknown): Pick<ShortShape, "open" | "close" | "line"> | undefined {
  const sh = (v ?? {}) as Partial<ShortShape> & { arm?: string; skipped?: string };
  if (sh.arm !== "on" || sh.skipped) return undefined;
  if (sh.open !== "card" && sh.open !== "footage" && sh.open !== "lower") return undefined;
  if (sh.close !== "card" && sh.close !== "hold") return undefined;
  return { open: sh.open, close: sh.close, ...(typeof sh.line === "string" ? { line: sh.line } : {}) };
}

/** Lanes that are not Shorts (or not Shorts this factory plans). */
const NOT_SHORTS = ["longform", "twin", "cutdown", "gameplay"];

/**
 * The memory from stored plans and shapes (pure), rows newest first: every row's effect sequence, and the shapes of
 * the rows (`shapeRows`, by default the same rows) whose shape the layout test chose; the rest are not counted.
 */
export function memoryOf(
  rows: Array<{ sfx?: unknown; shape?: unknown }>,
  shapeRows: Array<{ shape?: unknown }> = rows,
): ShortMemory {
  const sequences: string[] = [];
  const shapes: ShortMemory["shapes"] = [];
  for (const r of rows) {
    const sfx = Array.isArray(r.sfx)
      ? (r.sfx as SfxCue[]).filter((c) => c && typeof c.file === "string")
      : [];
    sequences.push(sequenceOf(sfx));
  }
  for (const r of shapeRows) {
    const sh = chosenShape(r.shape);
    if (sh) shapes.push({ open: sh.open, close: sh.close });
  }
  return { sequences, shapes };
}

/** The newest `n` Shorts other than this one, from the database. */
export async function readShortMemory(
  db: Db,
  excludeId: string,
  n = LAYOUT_WINDOW,
): Promise<ShortMemory> {
  const res = await db.query<{ sfx: unknown }>(
    `SELECT assets_json->'plan'->'sfx' AS sfx FROM episodes
      WHERE assets_json ? 'plan' AND lane <> ALL($3::text[]) AND status NOT IN ('failed','rejected') AND id <> $1
      ORDER BY created_at DESC LIMIT $2`,
    [excludeId, n, NOT_SHORTS],
  );
  // The shapes the test chose: its own newest `n`, however many Shorts off the test came between.
  const shapes = await db.query<{ shape: unknown }>(
    `SELECT assets_json->'shortShape' AS shape FROM episodes
      WHERE assets_json->'shortShape'->>'arm' = 'on' AND NOT (assets_json->'shortShape' ? 'skipped')
        AND lane <> ALL($3::text[]) AND status NOT IN ('failed','rejected') AND id <> $1
      ORDER BY created_at DESC LIMIT $2`,
    [excludeId, n, NOT_SHORTS],
  );
  return memoryOf(res, shapes);
}

/** What the first-shot test records on the episode (assets.shortFirstShot). */
export type FirstShotRecord = {
  arm: FirstShotArm;
  /** The minimum held to, seconds (SHORT_FIRST_SHOT_MIN_S); 0 on the "off" side. */
  seconds: number;
  /** Whether the hold changed the plan (a first shot already long enough, or one next to a code scene, is left). */
  changed: boolean;
};

/**
 * The stored shape when it still applies (pure): an earlier render of this episode chose it on the test's side, and
 * the opening is still allowed (a lower third needs a line and never goes on a rumour). Its line is the one worked out
 * now, from the same headline.
 */
function storedShape(
  prev: unknown,
  o: { rumour: boolean; line?: string },
): ShortShape | undefined {
  const sh = chosenShape(prev);
  if (!sh) return undefined;
  if (sh.open === "lower")
    return o.line && !o.rumour ? { open: "lower", close: sh.close, line: o.line } : undefined;
  return { open: sh.open, close: sh.close };
}

/**
 * SHORT_LAYOUTS and SHORT_FIRST_SHOT_MIN_S, before the graphics gate (it measures what the shape draws). Returns the
 * shape to draw (undefined: today's) and changes `plan.shots` when the first shot is held. Records the layout arm on
 * `assets.shortShape` and the first-shot arm on `assets.shortFirstShot` while each test runs. Only a clean-frame Short
 * gets a chosen shape: the clean frame is what keeps one overlay at a time beside the captions. A shape an earlier
 * render chose is kept (a retry or regather never changes it because newer Shorts were made). The two tests are split
 * by their own salts: a chosen layout never holds the first shot by itself.
 */
export function shapeShort(o: {
  cfg: Pick<
    Config,
    "shortLayouts" | "shortLayoutsShare" | "shortFirstShotMinSeconds" | "shortFirstShotShare"
  >;
  id: string;
  plan: Pick<RenderPlan, "shots" | "fps" | "firstShotHeld">;
  clean: boolean;
  rumour: boolean;
  headline: string;
  memory: ShortMemory | undefined;
  assets: { shortShape?: unknown; shortFirstShot?: FirstShotRecord };
}): ShortShape | undefined {
  const arm = layoutArm(o.id, o.cfg.shortLayouts, o.cfg.shortLayoutsShare);
  let shape: ShortShape | undefined;
  // A re-render with the test off draws today's card: an arm recorded by an earlier render no longer says what shows.
  if (!o.cfg.shortLayouts) delete o.assets.shortShape;
  if (o.cfg.shortLayouts) {
    if (arm === "on" && o.clean) {
      const line = lowerLine(o.headline);
      shape =
        storedShape(o.assets.shortShape, { rumour: o.rumour, line }) ??
        pickShape({
          id: o.id,
          recent: o.memory?.shapes ?? [],
          rumour: o.rumour,
          line,
        });
      // A headline too long for one line was never offered the lower third: a plain note, so the report can say how
      // often; the opening it got was a real choice and counts in the cap's memory as any other. A rumour never gets
      // the lower third whatever its headline, so it carries no note (it would muddy the count).
      o.assets.shortShape = { arm, ...shape, ...(line || o.rumour ? {} : { lowerUnavailable: "headline-too-long" }) };
    } else
      o.assets.shortShape = {
        arm,
        open: "card",
        close: "card",
        ...(arm === "on" ? { skipped: "not a clean-frame Short" } : {}),
      };
  }
  const minSeconds = o.cfg.shortFirstShotMinSeconds;
  // A stored plan an earlier render held stays held (the hold is not undone on a re-render), and says so on the plan
  // itself: a plan rebuilt after a regather carries no mark, so an old record never outlives the plan it described.
  const heldBefore = o.plan.firstShotHeld;
  const stillHeld = (): FirstShotRecord => ({ arm: "held", seconds: heldBefore!, changed: true });
  if (minSeconds <= 0) {
    if (heldBefore) o.assets.shortFirstShot = stillHeld();
    else delete o.assets.shortFirstShot;
    return shape;
  }
  const shotArm = firstShotArm(o.id, minSeconds, o.cfg.shortFirstShotShare);
  let changed = false;
  if (shotArm === "held") {
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
    changed = after !== before;
    if (changed)
      log("info", "short first shot held", {
        episode: o.id,
        fromFrames: before,
        toFrames: after,
      });
  }
  if (changed) o.plan.firstShotHeld = minSeconds;
  o.assets.shortFirstShot = changed
    ? { arm: "held", seconds: minSeconds, changed: true }
    : heldBefore
      ? stillHeld()
      : { arm: shotArm, seconds: shotArm === "held" ? minSeconds : 0, changed: false };
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
  assets: { shortSoundArm?: "sparse" | "v3"; shortSoundSequence?: string };
  v3: () => SfxCue[];
}): {
  arm: "sparse" | "v3";
  sequence: string;
  silence?: { from: number; to: number };
  /** The sparse plan played the sequence an earlier render chose. */
  kept?: boolean;
} {
  const arm = soundArm(o.id, o.cfg.shortSoundPlan, o.cfg.shortSoundSparseShare);
  // An earlier sparse render's own sequence, read before the arm is written again.
  const keep =
    arm === "sparse" &&
    o.assets.shortSoundArm === "sparse" &&
    typeof o.assets.shortSoundSequence === "string"
      ? o.assets.shortSoundSequence
      : undefined;
  if (o.cfg.shortSoundPlan === "sparse") o.assets.shortSoundArm = arm;
  else delete o.assets.shortSoundArm;
  if (arm !== "sparse") {
    delete o.assets.shortSoundSequence;
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
    keep,
  });
  o.plan.sfx = r.sfx;
  o.plan.soundPlan = "sparse";
  if (r.silence) o.plan.silences = [r.silence];
  else delete o.plan.silences;
  o.assets.shortSoundSequence = r.sequence;
  return {
    arm,
    sequence: r.sequence,
    silence: r.silence,
    ...(keep !== undefined ? { kept: keep === r.sequence } : {}),
  };
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
  assets: { shortSoundArm?: "sparse" | "v3"; shortSoundSequence?: string };
  v3: () => SfxCue[];
}): boolean {
  if (o.plan.soundPlan !== "sparse") return false;
  const arm = soundArm(o.id, o.cfg.shortSoundPlan, o.cfg.shortSoundSparseShare);
  if (arm === "sparse") return false;
  o.plan.sfx = o.v3();
  delete o.plan.soundPlan;
  delete o.plan.silences;
  delete o.assets.shortSoundSequence;
  if (o.cfg.shortSoundPlan === "sparse") o.assets.shortSoundArm = arm;
  else delete o.assets.shortSoundArm;
  return true;
}

// ---- The weekly report ------------------------------------------------------------------------

/** No verdict on an arm pair before this many Shorts a side with a 7-day reading. */
export const UNTEMPLATE_VERDICT_MIN = 20;

/** One published Short's arms and results, as the weekly report reads them (src/analyticsloop.ts). */
export interface UntemplateResultRow {
  sound?: "sparse" | "v3";
  layout?: "on" | "off";
  /** The opening drawn on the layout test's side (card, footage or lower). */
  open?: string;
  /** On the layout test's side but not a clean-frame Short, so drawn with today's card (no shape chosen). */
  skipped?: boolean;
  /** On the layout test's side with the lower third never offered (the headline too long for one line). */
  lowerUnavailable?: boolean;
  firstShot?: FirstShotArm;
  /** YouTube views at the 7-day reading; absent until it is taken. */
  views7d?: number;
  /** YouTube average percentage viewed. */
  viewed_pct?: number;
}

const middle = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const whole = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * The weekly report's lines for the three tests (pure), in the style of the writers' room's: per arm, how many Shorts,
 * the middle 7-day views and the average viewed; a verdict line only once both arms have UNTEMPLATE_VERDICT_MIN Shorts
 * with a 7-day reading. A test with no Short on either arm gives no lines.
 */
export function untemplateLinesForReport(rows: UntemplateResultRow[]): string[] {
  const out: string[] = [];
  const sideText = (xs: UntemplateResultRow[], label: string) => {
    const views = xs.map((r) => r.views7d).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const viewed = xs
      .map((r) => r.viewed_pct)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const avg = viewed.reduce((a, v) => a + v, 0) / (viewed.length || 1);
    return {
      views,
      viewed,
      avg,
      text: `${label} ${xs.length} Shorts, middle 7-day views ${views.length ? whole(middle(views)) : "n/a"} (${views.length} read), average viewed ${viewed.length ? `${avg.toFixed(1)}%` : "n/a"}`,
    };
  };
  const test = <A extends string>(
    name: string,
    key: "sound" | "layout" | "firstShot",
    arms: [A, string, A, string],
    extra?: string,
  ) => {
    const [a, aLabel, b, bLabel] = arms;
    const sa = rows.filter((r) => r[key] === a);
    const sb = rows.filter((r) => r[key] === b);
    if (!sa.length && !sb.length) return;
    const x = sideText(sa, aLabel);
    const y = sideText(sb, bLabel);
    out.push(`${name}: ${x.text}; ${y.text}${extra ? `; ${extra}` : ""}.`);
    out.push(
      x.views.length >= UNTEMPLATE_VERDICT_MIN && y.views.length >= UNTEMPLATE_VERDICT_MIN
        ? `${name} verdict: middle 7-day views ${whole(middle(x.views))} against ${whole(middle(y.views))} (${(middle(x.views) / Math.max(1, middle(y.views))).toFixed(2)}x), average viewed ${x.avg.toFixed(1)}% against ${y.avg.toFixed(1)}%, ${x.views.length} against ${y.views.length} Shorts.`
        : `${name} verdict: ${x.views.length} and ${y.views.length} Shorts with a 7-day reading; no verdict before ${UNTEMPLATE_VERDICT_MIN} a side.`,
    );
  };
  test("Short sound test (SHORT_SOUND_PLAN)", "sound", ["sparse", "sparse", "v3", "v3"]);
  const on = rows.filter((r) => r.layout === "on");
  const skipped = on.filter((r) => r.skipped).length;
  const unavailable = on.filter((r) => !r.skipped && r.lowerUnavailable).length;
  const opens = ["card", "footage", "lower"]
    .map((k) => [k, on.filter((r) => !r.skipped && r.open === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .concat(unavailable ? [`lower third unavailable (headline too long) ${unavailable}`] : [])
    .concat(skipped ? [`not clean-frame (today's card, no shape chosen) ${skipped}`] : [])
    .join(", ");
  test("Short layout test (SHORT_LAYOUTS)", "layout", ["on", "chosen layouts", "off", "today's card"], opens ? `openings on the test's side: ${opens}` : undefined);
  test("Short first-shot test (SHORT_FIRST_SHOT_MIN_S)", "firstShot", ["held", "held", "off", "not held"]);
  return out;
}
