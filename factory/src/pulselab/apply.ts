// The Pulse Lab in the factory: where the pure planner (plan.ts) meets the gameplay lane, the database and the files.
//   applyPulseLab     at the gameplay Short's script step (GAMEPLAY_DIRECT): plan the format, guard the spoken lines,
//                     title it, cut the split screen's panes, keep the plan on the story (story_json.pulseLab)
//   labDayTitle       after GTA 6 Day N numbered it: "GTA 6 Day N: <the Lab's question>"
//   labOverlayFor     at render: claim the tallies (lab_tally), number the tag, fill the tally chip
//   labCommentLines / labDescriptionLines   for the pinned comment and the description
//   ledgerTick        PULSE_LAB_RECEIPTS: the claims ledger synced from the lists and graded from the miner's verdicts
// Every failure here leaves the Short as it would have been without the Lab: nothing in the Lab can stop a Short.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { Episode } from "../episodes.ts";
import { logEvent } from "../episodes.ts";
import type { Script } from "../editorial/schema.ts";
import type { GameplayMeta } from "../gameplay.ts";
import { readMeta } from "../gameplay.ts";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { readRun } from "../shortrun.ts";
import { readAsks } from "../streamasks/job.ts";
import { parseSeed } from "../streamasks/seed.ts";
import { listVodIndexes } from "../vodindex/schema.ts";
import { dailyTitle, dailyTitleProblems, isGtaVi } from "../gtadaily.ts";
import type { LabOverlay } from "../render/labplan.ts";
import {
  claimsFromAsks,
  claimsFromGtaFile,
  claimsFromRumours,
  gradeFromAsks,
  markShown,
  mergeLedger,
  readLedger,
  rumourEpisodes,
  syncLedger,
  type LabClaim,
} from "./ledger.ts";
import { planLab, planProblems, type LabPlan } from "./plan.ts";
import { claimTally, dayTally, tallyLine, type TallyLine } from "./tally.ts";
import { loadTelemetry, telemetryDir } from "./telemetry.ts";
import {
  counterpartWindow,
  findCounterpart,
  libraryClips,
  versusCounterpartArgs,
  versusPrimaryArgs,
  VERSUS_FILES,
} from "./versus.ts";
import { askFor } from "./plan.ts";
import type { DirectCut, GameplayDirection } from "../gameplaydirect.ts";

const run = promisify(execFile);

/** What the Lab keeps on the story: the plan without its working parts. */
export type LabStory = Omit<LabPlan, "lines" | "counterpart"> & {
  counterpart?: { kind: string; ref: string; why: string };
};

interface LabServices {
  db: Db;
  cfg: Config;
  now: () => Date;
}

/** Every inbox clip's meta, for the split screen's library. */
async function inboxMetas(root: string): Promise<GameplayMeta[]> {
  const dir = path.join(root, "inbox");
  const out: GameplayMeta[] = [];
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const m = await readMeta(path.join(dir, name));
    if (m) out.push(m);
  }
  return out;
}

/**
 * PULSE_LAB at the rebuilt gameplay Short's script step. Plans the format from the clip's ask, the ledger, the HUD
 * reader and the library; rewrites the lines and the title the plan asks for; cuts the split screen's panes. Returns
 * the plan, or undefined when nothing fits (and the Short is left exactly as it was).
 */
export async function applyPulseLab(
  s: LabServices,
  ep: Episode,
  script: Script,
  meta: GameplayMeta,
  c: {
    cut: DirectCut;
    direction: Pick<
      GameplayDirection,
      "action_start_seconds" | "payoff_seconds"
    >;
    source: string;
    episodeDir: string;
  },
): Promise<LabPlan | undefined> {
  const lab = s.cfg.pulseLab;
  const ref = ep.story_json.gameplay;
  if (
    !lab.enabled ||
    !ref ||
    ref.rehearsal ||
    meta.rehearsal ||
    !s.cfg.gameplayDirect
  )
    return undefined;
  if (
    !isGtaVi(`${ref.review.game_title} ${script.game_title}`) &&
    !isLabGame(lab.game, ref.review.game_title)
  )
    return undefined;
  try {
    const store = await readAsks(s.cfg.dataDir);
    const ledger = await readLedger(s.db, lab.game).catch(
      () => [] as LabClaim[],
    );
    const vodId = meta.source.file
      ? (path.basename(meta.source.file).match(/\[(v\d+)\]/)?.[1] ?? "")
      : "";
    const track = vodId
      ? await loadTelemetry(
          telemetryDir(s.cfg.dataDir, lab.telemetryDir),
          vodId,
        )
      : undefined;
    const timing = {
      segments: c.cut.segments,
      actionStart: c.direction.action_start_seconds,
      payoff: c.direction.payoff_seconds,
      payoffAt: c.cut.payoffAt,
      ...(meta.clip.start_in_source !== undefined
        ? { clipInSource: meta.clip.start_in_source }
        : {}),
    };
    const askInput = {
      streamAsk: meta.stream_ask,
      liveAsk: meta.live?.ask,
      question: ref.review.question,
      asks: store.asks,
      game: lab.game,
    };
    const ask = askFor(askInput);
    const counterpart =
      lab.versus && ask
        ? findCounterpart(ask, lab.compareGame, {
            vods: await listVodIndexes(s.cfg.dataDir).catch(() => []),
            clips: libraryClips(
              s.cfg.gameplayRoot,
              (await inboxMetas(s.cfg.gameplayRoot)).filter(
                (m) => m.id !== meta.id,
              ),
            ),
          })
        : undefined;
    const direct = script.gameplay!.direct!;
    const input = {
      settings: lab,
      game: lab.game,
      question: ref.review.question,
      resultLine: ref.review.result_line,
      ...(meta.stream_ask ? { streamAsk: meta.stream_ask } : {}),
      ...(meta.live?.ask ? { liveAsk: meta.live.ask } : {}),
      ledger,
      asks: store.asks,
      timing,
      ...(track ? { track } : {}),
      ...(meta.lab_measure ? { owner: meta.lab_measure } : {}),
      lines: {
        hook: direct.hook,
        setup: direct.setup,
        payoff_line: direct.payoff_line,
      },
    };
    let plan = planLab({ ...input, ...(counterpart ? { counterpart } : {}) });
    if (plan.format === "versus" && plan.counterpart) {
      const ok = await cutVersus(
        c.source,
        c.cut,
        plan.counterpart,
        c.episodeDir,
      ).then(
        () => true,
        (err) => {
          log("warn", "pulse lab: split screen not cut", {
            episode: ep.id,
            error: errorMessage(err),
          });
          return false;
        },
      );
      if (!ok) plan = planLab(input);
    }
    const problems = planProblems(plan, c.cut.payoffAt, c.cut.seconds);
    if (problems.length) {
      await logEvent(s.db, ep.id, "pulse_lab_skipped", {
        why: problems.slice(0, 4),
        format: plan.format,
      });
      return undefined;
    }
    if (!plan.format) {
      if (plan.skipped.length)
        await logEvent(s.db, ep.id, "pulse_lab_skipped", { why: plan.skipped });
      return undefined;
    }
    if (plan.lines) {
      direct.hook = plan.lines.hook;
      direct.setup = plan.lines.setup;
      direct.payoff_line = plan.lines.payoff_line;
      script.hook = plan.lines.hook;
      if (script.beats[0]) script.beats[0].narration = plan.lines.setup;
      script.pulse_take.narration = plan.lines.payoff_line;
    }
    if (plan.title) script.youtube.title = plan.title;
    const story: LabStory = {
      ...withoutWorking(plan),
      ...(plan.counterpart
        ? {
            counterpart: {
              kind: plan.counterpart.kind,
              ref: plan.counterpart.ref,
              why: plan.counterpart.why,
            },
          }
        : {}),
    };
    await s.db.query(
      `UPDATE episodes SET story_json = story_json || jsonb_build_object('pulseLab', $2::jsonb) WHERE id = $1`,
      [ep.id, JSON.stringify(story)],
    );
    ep.story_json.pulseLab = story;
    await logEvent(s.db, ep.id, "pulse_lab_planned", {
      format: plan.format,
      title: plan.title,
      skipped: plan.skipped,
      claim: plan.claim,
      measurement: plan.measurement,
    });
    return plan;
  } catch (err) {
    log("warn", "pulse lab: not planned", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return undefined;
  }
}

const isLabGame = (lab: string, game: string) =>
  lab.toLowerCase() === game.toLowerCase();

function withoutWorking(p: LabPlan): Omit<LabPlan, "lines" | "counterpart"> {
  const { lines: _l, counterpart: _c, ...rest } = p;
  return rest;
}

/** The two panes of a split screen, cut into the episode folder. */
async function cutVersus(
  source: string,
  cut: DirectCut,
  counterpart: NonNullable<LabPlan["counterpart"]>,
  dir: string,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await run(
    FFMPEG,
    versusPrimaryArgs(
      source,
      cut.segments,
      path.join(dir, VERSUS_FILES.primary),
    ),
    { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 },
  );
  const w = counterpartWindow(counterpart, cut.payoffAt, cut.seconds + 4);
  await run(
    FFMPEG,
    versusCounterpartArgs(
      counterpart.file,
      w,
      path.join(dir, VERSUS_FILES.counterpart),
    ),
    { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 },
  );
}

/** GTA 6 Day N's title for a Lab episode: the day, then the Lab's plain question (no double prefix). */
export function labDayTitle(
  ep: Pick<Episode, "story_json">,
  script: Script,
): void {
  const day = ep.story_json.gtaDaily?.day;
  const lab = ep.story_json.pulseLab;
  if (!day || !lab?.dayClaim) return;
  const title = dailyTitle(day, [lab.dayClaim, script.youtube.title], { ask: !!ep.story_json.gtaDaily?.ask });
  // The daily's own rules (no story words, no dashes, advertiser-safe) still decide: a title that breaks one is not used.
  if (!dailyTitleProblems(title, day).length) script.youtube.title = title;
}

/**
 * The Lab layer for the render: the plan's graphics, the tag numbered by its tally and the tally chip filled, both
 * counted now (idempotent: a retried render counts once). A GTA 6 Day N Short with no Lab format still gets "Day N"
 * when the tally is on. Undefined: nothing to draw.
 */
export async function labOverlayFor(
  s: LabServices,
  ep: Episode,
): Promise<LabOverlay | undefined> {
  const lab = s.cfg.pulseLab;
  if (!lab.enabled) return undefined;
  const story = ep.story_json.pulseLab;
  const day = ep.story_json.gtaDaily?.day;
  let first: TallyLine | undefined;
  let number: number | undefined;
  try {
    for (const [k, t] of (story?.tally ?? []).entries()) {
      const counts = await claimTally(
        s.db,
        t.series,
        lab.season,
        ep.id,
        t.outcome,
      );
      if (k === 0) {
        first = tallyLine(t.series, counts);
        number = counts.total;
      }
    }
    if (story?.claim)
      await markShown(s.db, story.claim.id, ep.id).catch(() => false);
  } catch (err) {
    log("warn", "pulse lab: tally not counted", {
      episode: ep.id,
      error: errorMessage(err),
    });
  }
  const dayLine = day ? dayTally(day) : undefined;
  const tally = lab.tally ? mergeDay(first, dayLine) : undefined;
  if (!story?.overlay) return tally ? { format: "tally", tally } : undefined;
  return {
    ...story.overlay,
    ...(story.overlay.tag
      ? { tag: { ...story.overlay.tag, ...(number ? { number } : {}) } }
      : {}),
    ...(tally ? { tally } : {}),
  };
}

function mergeDay(
  line: TallyLine | undefined,
  day: TallyLine | undefined,
): TallyLine | undefined {
  if (!line) return day;
  if (!day) return line;
  return {
    line: line.line,
    sub: [day.line, line.sub].filter(Boolean).join(" · "),
  };
}

/** The Lab's lines for the channel's pinned comment (pure). */
export function labCommentLines(ep: Pick<Episode, "story_json">): string[] {
  return ep.story_json.pulseLab?.comment ?? [];
}

/** The Lab's lines for the description (pure). */
export function labDescriptionLines(ep: Pick<Episode, "story_json">): string[] {
  return ep.story_json.pulseLab?.description ?? [];
}

// ------------------------------------------------------------------ the ledger

/** Builds the whole ledger from the lists on this machine and the database (no network, no model). */
export async function buildLedger(
  cfg: Pick<
    Config,
    "dataDir" | "streamAsks" | "seriesGtaFileRunFile" | "pulseLab"
  >,
  db: Db | undefined,
  now: Date,
): Promise<LabClaim[]> {
  const game = cfg.pulseLab.game;
  const store = await readAsks(cfg.dataDir);
  const md = await fs.readFile(cfg.streamAsks.seedFile, "utf8").catch(() => "");
  const seeds = md ? parseSeed(md, game, now.toISOString()) : [];
  const run = readRun(cfg.seriesGtaFileRunFile);
  const rumours = db ? await rumourEpisodes(db, isGtaVi) : [];
  const merged = mergeLedger(
    claimsFromAsks(store.asks, game),
    claimsFromAsks(
      seeds.filter((x) => !store.asks.some((a) => a.id === x.id)),
      game,
    ),
    claimsFromGtaFile(run, game),
    claimsFromRumours(rumours, game),
  );
  return gradeFromAsks(merged, store.asks, cfg.pulseLab.minConfidence);
}

let syncing = false;

/** PULSE_LAB_RECEIPTS: the ledger kept in step with the lists (a pass every half hour). Never throws. */
export async function ledgerTick(
  cfg: Config,
  db: Db,
  now = new Date(),
): Promise<number> {
  if (!cfg.pulseLab.enabled || !cfg.pulseLab.receipts || syncing) return 0;
  syncing = true;
  try {
    const n = await syncLedger(db, await buildLedger(cfg, db, now));
    log("info", "pulse lab: ledger synced", { claims: n });
    return n;
  } catch (err) {
    log("warn", "pulse lab: ledger not synced", { error: errorMessage(err) });
    return 0;
  } finally {
    syncing = false;
  }
}
