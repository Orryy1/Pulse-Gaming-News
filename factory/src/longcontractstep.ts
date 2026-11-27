// The long-video contract and argument checks in the pipeline (LONG_OPENING_CONTRACT, LONG_ARGUES): what each writer
// gets in "fix" and what goes on the episode in "check" and "fix". The checks are pure (src/editorial/longcontract.ts,
// src/editorial/argues.ts); the one model call is the contract's judge, which a failure simply leaves out. Nothing
// here stops a video: a miss is a note on the record and in the style warnings.

import type { Db } from "./db.ts";
import { logEvent } from "./episodes.ts";
import { errorMessage, log } from "./lib/util.ts";
import type { Llm } from "./editorial/llm.ts";
import type { Script } from "./editorial/schema.ts";
import type { LongRules } from "./editorial/longrules.ts";
import {
  TAKES_PER_CHAPTER,
  contractJudge,
  contractReport,
  datedQuotesIn,
  longDocOfScript,
  withJudgement,
  withoutSpoilerWarning,
  type ContractMode,
  type DatedQuote,
  type LongDocKind,
} from "./editorial/longcontract.ts";
import {
  claimsReport,
  franchiseGuardProblems,
  rankingReport,
  type FranchiseBrief,
} from "./editorial/argues.ts";

/**
 * The documentary rules a contract and the claims format add (pure). "fix": the outline marks a finish line, the intro
 * follows the contract in place of the stacked hook, and each chapter needs two honest takes. A run entry of format
 * "claims" is written as a claims-tested commentary only when LONG_ARGUES is "fix"; "check" records and writes as before.
 */
export function contractRules<R extends LongRules>(
  rules: R,
  o: { contract: ContractMode; argues: ContractMode; format?: string },
): R {
  const out: R = { ...rules };
  if (o.contract === "fix")
    Object.assign(out, {
      contract: true,
      hookStack: 0,
      takesMin: TAKES_PER_CHAPTER,
    });
  if (o.format === "claims" && o.argues === "fix")
    Object.assign(out, { claims: true });
  return out;
}

/** The source's dated quotes for the opening (pure): the overview first, then each chapter's own source. */
export function openingQuotes(
  texts: readonly string[],
  most = 4,
): DatedQuote[] {
  const out: DatedQuote[] = [];
  for (const t of texts) {
    for (const q of datedQuotesIn(t, most))
      if (!out.some((x) => x.quote === q.quote)) out.push(q);
    if (out.length >= most) break;
  }
  return out.slice(0, most);
}

export interface LongRecord {
  long_contract?: Record<string, unknown>;
  long_argues?: Record<string, unknown>;
  /** One line per miss, for the style warnings. */
  warnings: string[];
}

/**
 * Measures a finished long script under both settings and records it on the episode (event log; the caller adds the
 * return to factcheck_json). The judge runs once when the contract is on; its failure leaves the counts alone.
 */
export async function recordLongChecks(
  s: {
    db: Db;
    llm: Llm;
    cfg: { longOpeningContract: ContractMode; longArgues: ContractMode };
  },
  epId: string,
  script: Script,
  o: {
    kind: LongDocKind;
    quotes?: readonly DatedQuote[];
    /** A documentary topic, for the franchise-history guard. */
    topic?: { kind?: string; format?: string; brief?: FranchiseBrief };
    /** What a "fix" send-back already tried, for the note. */
    fixed?: string[];
    /** The source texts and URLs: a short primary quote is found in them, and only encyclopaedia pages is advised. */
    sources?: readonly string[];
    sourceUrls?: readonly string[];
    /** A planned finish line that placement dropped. */
    finishMissing?: { question: string; why: "not planted" | "not paid" };
    /** False when the outline can't carry a finish line (a retrospective or every-game outline, or DOC_OPEN_LOOPS off). */
    finishLine?: boolean;
  },
): Promise<LongRecord> {
  const out: LongRecord = { warnings: [] };
  const contract = s.cfg.longOpeningContract;
  const argues = s.cfg.longArgues;
  if (contract === "off" && argues === "off") return out;
  // The opening as its writer wrote it: the spoiler warning the factory adds afterwards is not the writer's miss.
  const read = longDocOfScript(script, { kind: o.kind });
  const doc = { ...read, hook: withoutSpoilerWarning(read.hook) };
  if (contract !== "off") {
    let report = contractReport(doc, { quotes: o.quotes, sources: o.sources, sourceUrls: o.sourceUrls, finishMissing: o.finishMissing, finishLine: o.finishLine });
    let judged = false;
    if (o.kind !== "ranking")
      try {
        report = withJudgement(report, await contractJudge(s.llm, doc));
        judged = true;
      } catch (err) {
        log("warn", "long contract judge failed", {
          episode: epId,
          error: errorMessage(err),
        });
      }
    out.long_contract = {
      mode: contract,
      pass: report.pass,
      problems: report.problems,
      measures: report.measures,
      // Advice for the planner (no_primary_sources: the real-voice rule can't fire); never sent back.
      advisories: report.advisories,
      judged,
      ...(o.fixed?.length ? { sent_back: o.fixed } : {}),
    };
    out.warnings.push(...report.problems.map((p) => `Opening contract: ${p}`));
    await logEvent(s.db, epId, "long_contract", out.long_contract);
  }
  if (argues !== "off") {
    const ranking = o.kind === "ranking" ? rankingReport(doc) : undefined;
    const claims = o.kind === "claims" ? claimsReport(doc) : undefined;
    const guard = o.topic ? franchiseGuardProblems(o.topic) : [];
    const problems = [
      ...(ranking?.problems ?? []),
      ...(claims?.problems ?? []),
      ...guard,
    ];
    out.long_argues = {
      mode: argues,
      pass: problems.length === 0,
      problems,
      ...(ranking ? { ranking: ranking.measures } : {}),
      ...(claims ? { claims: claims.measures } : {}),
      ...(guard.length ? { franchise_guard: guard } : {}),
    };
    out.warnings.push(...problems.map((p) => `Argues: ${p}`));
    await logEvent(s.db, epId, "long_argues", out.long_argues);
  }
  return out;
}
