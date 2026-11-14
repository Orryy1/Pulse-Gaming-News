// The two pipeline steps of Buy, Wait or Skip (src/editorial/verdict.ts, format plan item 7), kept out of
// src/pipeline.ts so its edits stay a few lines: choosing the game when the slot's production starts, and writing the
// script. Choosing costs no model call (Steam and CheapShark, free and keyless); writing is one call, one rewrite on
// problems, then the ranking fact check against the data the Short was built from.
import type { Db } from "./db.ts";
import type { Services } from "./pipeline.ts";
import type { Episode } from "./episodes.ts";
import { logEvent, transition } from "./episodes.ts";
import type { StoryCluster } from "./discovery/cluster.ts";
import type { Script } from "./editorial/schema.ts";
import {
  decideVerdict,
  type Verdict,
  type VerdictData,
  validateVerdict,
  verdictBrief,
  verdictTitle,
  verdictToScript,
  writeVerdict,
  type VerdictDraft,
} from "./editorial/verdict.ts";
import { pickVerdict } from "./discovery/verdicts.ts";
import { guardScript } from "./writerguard.ts";
import { FatalError, log } from "./lib/util.ts";

/** The verdict episode's own data, carried in factcheck_json from selection to the writer. */
export interface VerdictPick {
  topic: {
    candidate_index: number;
    format: "buy_wait_skip";
    theme: string;
    title_idea: string;
    criterion: string;
    reason: string;
  };
  verdict: { data: VerdictData; verdict: Verdict; reason: string };
  brief: string;
}

/** The games and verdicts of the last two weeks' verdict Shorts, newest first. */
export async function recentVerdicts(
  db: Db,
  now: Date,
): Promise<{ games: string[]; verdicts: Verdict[] }> {
  const rows = await db.query<{ game: string | null; v: string | null }>(
    `SELECT script_json->>'game_title' AS game, script_json->'stamp'->>'text' AS v FROM episodes
      WHERE lane = 'evergreen' AND script_json->>'evergreen_format' = 'buy_wait_skip'
        AND status NOT IN ('failed','rejected') AND created_at > $1 ORDER BY created_at DESC`,
    [new Date(now.getTime() - 14 * 86_400_000)],
  );
  return {
    games: rows.map((r) => r.game ?? "").filter(Boolean),
    verdicts: rows
      .map((r) => (r.v ?? "").split(" ")[0] as Verdict)
      .filter((v) => v === "BUY" || v === "WAIT" || v === "SKIP"),
  };
}

/** The selection (pure once the candidates are in): one game, its verdict and the brief the writer gets. */
export function verdictSelection(
  checked: VerdictData[],
  recent: Verdict[],
): VerdictPick | undefined {
  const pick = pickVerdict(checked, recent);
  if (!pick) return undefined;
  const title = verdictTitle(pick.data);
  return {
    topic: {
      candidate_index: 0,
      format: "buy_wait_skip",
      theme: pick.data.name,
      title_idea: title,
      criterion: "Steam reviews, today's price and the lowest price tracked",
      reason: "Buy, Wait or Skip",
    },
    verdict: pick,
    brief: verdictBrief(pick.data, pick.verdict, pick.reason),
  };
}

/** The story a verdict episode is filed under: one game, Steam's data, no articles. */
export function verdictCluster(
  today: string,
  pick: VerdictPick,
  now: Date,
): StoryCluster {
  return {
    hash: `series:verdict:${today}`,
    headline: pick.topic.title_idea,
    items: [],
    sources: ["Steam", "CheapShark"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: pick.verdict.data.name,
  };
}

/**
 * Writes the verdict Short. The verdict is recomputed from the stored data (never the writer's), the draft is checked
 * against the house rules with one rewrite, then fact-checked against the data with one more; it fails rather than
 * ship a figure the data does not hold.
 */
export async function stepScriptVerdict(
  s: Services,
  ep: Episode,
  adjudicate: (
    script: Script,
    attempt: number,
    data: Array<{ title: string; facts: string }>,
  ) => Promise<string[]>,
): Promise<void> {
  const pick = ep.factcheck_json as Partial<VerdictPick> | null;
  const data = pick?.verdict?.data;
  if (!data) throw new FatalError("verdict episode has no price data");
  const { verdict, reason } = decideVerdict(data);
  const brief = verdictBrief(data, verdict, reason);
  let draft: VerdictDraft | undefined;
  let feedback: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    draft = await writeVerdict(s.llm, brief, feedback);
    feedback = validateVerdict(draft, data, verdict);
    if (!feedback.length) break;
    if (attempt === 1)
      await logEvent(s.db, ep.id, "style_warnings", { problems: feedback });
  }
  if (!draft) throw new Error("verdict script produced nothing");
  const dataFacts = [
    {
      title:
        "The data this Short was built from (Steam's store and CheapShark's price history)",
      facts: brief,
    },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const factual = await adjudicate(
      verdictToScript(data, draft, verdict),
      attempt,
      dataFacts,
    );
    if (!factual.length) break;
    draft = await writeVerdict(s.llm, brief, factual);
  }
  // A figure the data does not hold, or the verdict said wrong, never ships.
  const left = validateVerdict(draft, data, verdict).filter((p) =>
    /not a price|not a figure|verdict_line|US price/.test(p),
  );
  if (left.length)
    throw new Error(`verdict script not fit to voice: ${left[0]}`);
  const script = verdictToScript(data, draft, verdict);
  await guardScript(s, ep, script, "after writing");
  log("info", "verdict written", { episode: ep.id, game: data.name, verdict });
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      topic: pick?.topic,
      verdict: { data, verdict, reason },
      brief,
    },
  });
}
