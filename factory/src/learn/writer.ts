// The news writer's side of the learning core (src/pipeline.ts stepScript): the bandit's arms for this Short, the
// lesson playbook it is shown, and breadth then selection for its hook. Each part is behind its own setting, skipped
// for a holdout Short and never stops a Short: a fault is logged and the Short is written as before.

import type { Db } from "../db.ts";
import type { Llm } from "../editorial/llm.ts";
import type { Script } from "../editorial/schema.ts";
import { judgeClarity, shortLines } from "../editorial/clarity.ts";
import { logEvent } from "../episodes.ts";
import type { GrowthTest, EpisodeTest, Variant } from "../growth.ts";
import { subsFormat } from "../subslearn/learn.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { LearnSettings } from "./settings.ts";
import {
  banditAssign,
  drawsAsDefaults,
  BANDIT_FACTORS,
  type Draw,
} from "./bandit.ts";
import { playbookFor, recordExposure } from "./playbook.ts";
import {
  briefsFor,
  choose,
  hookScorer,
  hookScorerName,
  predictHook,
  writeHookCandidates,
  setHookScorer,
  type HookScorer,
} from "./breadth.ts";

export interface WriterHost {
  db: Db;
  llm: Llm;
  cfg: { learn: LearnSettings };
  now(): Date;
}

/**
 * The bandit's arms folded into growth.ts's shapes: the running test's variant comes from the bandit (so growth.ts's
 * own verdict reads it from assets_json.test as before) and the other open factors' arms join the standing rules.
 */
export async function banditForShort(
  s: WriterHost,
  ep: { id: string; lane: string; story_hash?: string | null },
  test: EpisodeTest | undefined,
  defaults: Array<{ test: GrowthTest; variant: Variant }>,
): Promise<{
  test: EpisodeTest | undefined;
  defaults: Array<{ test: GrowthTest; variant: Variant }>;
  draws: Draw[];
}> {
  const ls = s.cfg.learn;
  if (ls.bandit === "off") return { test, defaults, draws: [] };
  try {
    const draws = await banditAssign(
      s.db,
      ls,
      {
        id: ep.id,
        format: subsFormat({ lane: ep.lane, story_hash: ep.story_hash }),
      },
      s.now(),
    );
    if (draws.length)
      await logEvent(s.db, ep.id, "bandit_draw", {
        mode: ls.bandit,
        arms: Object.fromEntries(draws.map((d) => [d.factor, d.arm])),
        p: Object.fromEntries(
          draws.map((d) => [d.factor, Math.round(d.propensity * 100) / 100]),
        ),
      });
    if (ls.bandit !== "on") return { test, defaults, draws };
    const mine = test ? draws.find((d) => d.factor === test.key) : undefined;
    const factor = mine
      ? BANDIT_FACTORS.find((f) => f.key === mine.factor)
      : undefined;
    const nextTest: EpisodeTest | undefined =
      test && mine && factor && (mine.arm === "A" || mine.arm === "B")
        ? {
            key: test.key,
            variant: mine.arm,
            label: factor.labels[mine.arm] ?? test.label,
          }
        : test;
    const settled = new Set(defaults.map((d) => d.test.key));
    const extra = drawsAsDefaults(draws, test?.key).filter(
      (d) => !settled.has(d.test.key),
    );
    return { test: nextTest, defaults: [...defaults, ...extra], draws };
  } catch (err) {
    log("warn", "bandit draw failed; the Short follows growth.ts alone", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return { test, defaults, draws: [] };
  }
}

/** The playbook block for a news writer, with the lessons it shows recorded against the episode (on mode only). */
export async function playbookForShort(
  s: WriterHost,
  episodeId: string,
): Promise<string> {
  const ls = s.cfg.learn;
  if (ls.playbook !== "on") return "";
  try {
    const p = await playbookFor(s.db, ["news", "social"], ls.playbookMax);
    if (p.ids.length) await recordExposure(s.db, episodeId, p.ids, s.now());
    return p.text;
  } catch (err) {
    log("warn", "playbook read failed", { error: errorMessage(err) });
    return "";
  }
}

const HOOK_MODEL_KEY = "learn:hook_model";

async function hookModel(db: Db): Promise<number[] | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [HOOK_MODEL_KEY],
  );
  try {
    return row ? (JSON.parse(row.value) as { w: number[] }).w : undefined;
  } catch {
    return undefined;
  }
}

export async function saveHookModel(
  db: Db,
  w: number[],
  n: number,
  now: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [HOOK_MODEL_KEY, JSON.stringify({ w, n, at: now.toISOString() })],
  );
}

/**
 * Breadth then selection for one news Short's hook. Returns the script with the chosen hook (the draft's own in shadow
 * mode, or when nothing beats it). `problemsWith` counts the house problems of the script with a given hook.
 */
export async function pickHook(
  s: WriterHost,
  ep: { id: string; lane: string; story_hash?: string | null },
  script: Script,
  o: {
    rules: string;
    recentHooks: string[];
    problemsWith: (sc: Script) => number;
  },
): Promise<Script> {
  const ls = s.cfg.learn;
  if (ls.hooks === "off") return script;
  try {
    const briefs = briefsFor(ep.id, ls.hookCandidates);
    const cands = await writeHookCandidates(s.llm, {
      script,
      briefs,
      rules: o.rules,
    });
    const w = await hookModel(s.db);
    const format = subsFormat({ lane: ep.lane, story_hash: ep.story_hash });
    const withHook = (hook: string): Script => ({ ...script, hook });
    const { all, chosen } = await choose(script.hook, cands, {
      recent: o.recentHooks,
      maxSameness: ls.hookSameness,
      problemsWith: (h) => o.problemsWith(withHook(h)),
      prior: (h) => (w ? predictHook(w, h, script.game_title) : undefined),
      packaging: hookScorer()
        ? (h) =>
            hookScorer()!({
              hook: h,
              title: script.youtube.title,
              game: script.game_title,
              format,
            })
        : undefined,
      clarity: async (h) =>
        (
          await judgeClarity(s.llm, {
            lines: shortLines(withHook(h)),
            intended: script.point,
            title: script.youtube.title,
          })
        ).score,
    });
    for (const c of all)
      await s.db.query(
        `INSERT INTO hook_candidates (episode_id, idx, angle, hook, title, score, scores, chosen, refused)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (episode_id, idx) DO UPDATE SET hook = EXCLUDED.hook, score = EXCLUDED.score, scores = EXCLUDED.scores, chosen = EXCLUDED.chosen, refused = EXCLUDED.refused`,
        [
          ep.id,
          c.idx,
          c.angle,
          c.hook,
          script.youtube.title,
          c.score ?? null,
          JSON.stringify(c.scores),
          c === chosen,
          c.refused ?? null,
        ],
      );
    await logEvent(s.db, ep.id, "hook_breadth", {
      mode: ls.hooks,
      candidates: all.length - 1,
      refused: all.filter((c) => c.refused).length,
      chosen: chosen.angle,
      kept_draft: chosen.idx === 0,
      scorer: hookScorerName() ?? (w ? "hook model" : "none"),
    });
    return ls.hooks === "on" && chosen.idx > 0 ? withHook(chosen.hook) : script;
  } catch (err) {
    log("warn", "hook breadth failed; the draft's hook stands", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return script;
  }
}

/** Plugs a packaging scorer in (claude/packaginglab): the breadth step then ranks candidates by it. */
export function usePackagingScorer(name: string, fn: HookScorer | undefined): void {
  setHookScorer(name, fn);
}
