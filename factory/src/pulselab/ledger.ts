// "Receipts" (PULSE_LAB_RECEIPTS): the claims ledger. Every notable GTA 6 leak, rumour and preview claim goes into one
// list, from four places that already exist:
//   - the living stream-asks list (src/streamasks, data/streamasks/asks.json): claims and myths people wrote, each with
//     the mention that carried it (press, Bluesky, YouTube comments, Pulse viewers) and its rumour label;
//   - the previews' seed list (docs/streamasks-seed-gta6.md): every pre-launch preview claim with its outlet;
//   - The GTA File's run (SERIES_GTA_FILE_RUN_FILE): confirmed or reported facts a stream can check (the map's size);
//   - the factory's own rumour Shorts (episodes whose script says is_rumour) about GTA VI.
// Only claims a stream can test go in (systems, never sales or launch news), and a claim that gives the story away is
// held. A claim is graded only from the owner's own footage: the VOD miner's verdict (src/streamasks/miner.ts), at
// PULSE_LAB_MIN_CONFIDENCE or more, and optionally a measured count or number that splits it into PARTLY. A grade is
// never invented: unclear stays open.
//
// Nothing here presents a leak as fact: each claim carries its kind (leak, rumour, preview claim, fan myth...) and the
// source's name, and both go on screen with it. The ledger lives in the database (lab_claims, migrations/
// 007_pulselab.sql), so a restart keeps every grade.

import crypto from "node:crypto";
import type { Db } from "../db.ts";
import type { StreamAsk, AskVerdict } from "../streamasks/asks.ts";
import { isNewsy, overlap, spoilsStory, topicOf } from "../streamasks/asks.ts";
import type { RunEntry } from "../shortrun.ts";
import {
  type ClaimKind,
  type Grade,
  CLAIM_LABEL,
  GRADE_WORDS,
} from "./identity.ts";

export type ClaimOrigin = "stream_ask" | "seed" | "gta_file" | "rumour_episode";
export type ClaimStatus = "open" | "graded" | "held";

export interface ClaimGrade {
  grade: Grade;
  confidence: number;
  /** The recording and the second the proof is at. */
  vodId: string;
  recordedOn: string;
  at: number;
  reason: string;
  moment?: string;
  gradedAt: string;
  /** The Receipts Short that showed the grade, once one did. */
  episodeId?: string;
  /** A measured count or number that decided PARTLY (or confirmed TRUE). */
  measured?: { value: number; of?: number; claimed?: number; unit?: string };
}

export interface LabClaim {
  id: string;
  game: string;
  /** What a test answers: "Can your car really run out of fuel?" */
  question: string;
  /** As claimed, in the source's words. */
  claim: string;
  kind: ClaimKind;
  source: { name: string; url?: string; at?: string };
  origin: ClaimOrigin;
  /** The stream ask it rests on (the miner's verdicts are keyed by it). */
  askId?: string;
  topic?: string;
  status: ClaimStatus;
  grade?: ClaimGrade;
}

// ------------------------------------------------------------------ what kind of claim it is

const LEAK = /\bleak(?:s|ed|er|ers|ing)?\b/i;
const DATAMINE = /\bdatamin\w*/i;
/** An insider claim, but never the site "Insider Gaming". */
const INSIDER =
  /\binsiders?\b(?!\s+gaming)|\bsources?\s+(?:say|said|claim\w*)\b/i;
const MYTH = /\b(myth|tiktok|fan theor\w*|no official source)\b/i;
const REPORTED =
  /\b(reportedly|according to|reports? (?:say|suggest)|cover story)\b/i;
const RUMOUR = /\b(rumou?r\w*|unconfirmed|allegedly|supposedly|apparently)\b/i;
const PREVIEW = /\b(previews?|hands[- ]on|edge|game informer|ign)\b/i;
const OFFICIAL_SOURCE = /\b(rockstar|take-two|playstation|xbox)\b/i;

/** A claim's kind from its words and where it was seen (pure). The least official reading always wins. */
export function claimKind(
  text: string,
  o: {
    rumour?: boolean;
    myth?: boolean;
    sourceName?: string;
    viewer?: boolean;
    official?: boolean;
  } = {},
): ClaimKind {
  const all = `${text} ${o.sourceName ?? ""}`;
  if (LEAK.test(text)) return "leak";
  if (DATAMINE.test(text)) return "datamine";
  if (INSIDER.test(text)) return "insider";
  if (o.myth || MYTH.test(text)) return "myth";
  if (RUMOUR.test(text)) return "rumour";
  if (REPORTED.test(text)) return "reported";
  if (o.rumour) return "rumour";
  if (o.viewer) return "viewer";
  if (/^previews?:/i.test(o.sourceName ?? "") || PREVIEW.test(all))
    return "preview";
  if (o.official && OFFICIAL_SOURCE.test(all)) return "official";
  return o.official ? "reported" : "preview";
}

/** Testable on stream: the stream-asks list's own idea of a test (a known topic, or not sales or launch news). */
export function testable(text: string, game: string): boolean {
  return !!topicOf(text, game) || !isNewsy(text);
}

export const claimId = (game: string, key: string) =>
  crypto
    .createHash("sha1")
    .update(`lab|${game.toLowerCase()}|${key}`)
    .digest("hex")
    .slice(0, 12);

const MENTION_RANK: Record<string, number> = {
  press: 0,
  seed: 1,
  social: 2,
  reddit: 3,
  comments: 4,
  viewers: 5,
};

/** The mention a claim is credited to (pure): the press first, then the previews, then social posts, then viewers. */
export function creditedMention(a: StreamAsk) {
  return [...a.mentions].sort(
    (x, y) =>
      (MENTION_RANK[x.source] ?? 9) - (MENTION_RANK[y.source] ?? 9) ||
      x.at.localeCompare(y.at),
  )[0];
}

// ------------------------------------------------------------------ building the ledger (pure)

/** A source's name as the card shows it (pure): "Previews: Edge" -> "Edge", "YouTube comments: <video>" -> "YouTube comments". */
export function sourceName(name: string): string {
  return name.replace(/^Previews:\s*/i, "").replace(/^YouTube comments:.*$/i, "YouTube comments").trim() || name;
}

/** The test instructions the seed list keeps in a myth's bullet ("Show the settings menu."): not part of the claim. */
const HOW_TO = /^(check|show|look|track|say|try|drive|open|walk|get|time|count|do|don'?t|keep|go|use)\b/i;

/** The claim as it was made (pure): instructions to the streamer dropped, quote marks tidied. */
export function claimWords(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !HOW_TO.test(s.trim()))
    .join(" ")
    .trim()
    .replace(/^["\u201c]([^"\u201d]*)["\u201d]/, "$1")
    .trim();
}

/** Claims and myths from the stream-asks list (and the seed list, read the same way). Questions and wants are not claims. */
export function claimsFromAsks(asks: StreamAsk[], game: string): LabClaim[] {
  const out: LabClaim[] = [];
  for (const a of asks) {
    if (a.game !== game) continue;
    if (a.kind !== "claim" && a.kind !== "myth" && !a.rumour) continue;
    const text = `${a.question} ${a.claim}`;
    if (!testable(text, game)) continue;
    const m = creditedMention(a);
    const seedOnly = a.mentions.every((x) => x.source === "seed");
    out.push({
      id: claimId(game, `ask:${a.id}`),
      game,
      question: a.question,
      claim: claimWords(a.claim || m?.text || a.question).slice(0, 280),
      kind: claimKind(text, {
        rumour: a.rumour,
        myth: a.kind === "myth",
        sourceName: m?.name,
        viewer: m?.source === "viewers" || m?.source === "comments",
      }),
      source: {
        name: sourceName(m?.name ?? "Unknown"),
        ...(m?.url ? { url: m.url } : {}),
        ...(m?.at ? { at: m.at } : {}),
      },
      origin: seedOnly ? "seed" : "stream_ask",
      askId: a.id,
      ...(a.topic ? { topic: a.topic } : {}),
      status: a.spoiler || a.status === "held" ? "held" : "open",
    });
  }
  return out;
}

/** The GTA File's facts a stream can check (pure): one claim per testable fact, credited to its first source. */
export function claimsFromGtaFile(run: RunEntry[], game: string): LabClaim[] {
  const out: LabClaim[] = [];
  for (const e of run) {
    if (e.kind !== "file") continue;
    for (const fact of e.facts) {
      const topic = topicOf(fact, game);
      if (!topic) continue; // only facts a known stream test can check
      const named = fact.match(/\(([^)]{2,60})\)\s*\.?$/)?.[1];
      const src = e.sources[0];
      out.push({
        id: claimId(game, `file:${topic.id}:${fact.slice(0, 60)}`),
        game,
        question: topic.question,
        claim: fact.slice(0, 280),
        kind: claimKind(fact, {
          official: e.sources.some((s) => s.official),
          sourceName: named ?? src?.source,
        }),
        source: {
          name: named ?? src?.source ?? "The GTA File",
          ...(src?.url ? { url: src.url } : {}),
        },
        origin: "gta_file",
        topic: topic.id,
        status: spoilsStory(fact) ? "held" : "open",
      });
    }
  }
  return out;
}

export interface RumourEpisodeRow {
  id: string;
  headline: string;
  game: string;
  source?: string;
  url?: string;
  at?: string;
}

/** The factory's own GTA VI rumour Shorts as claims (pure): always labelled, never graded without footage. */
export function claimsFromRumours(
  rows: RumourEpisodeRow[],
  game: string,
): LabClaim[] {
  return rows
    .filter((r) => testable(r.headline, game))
    .map((r) => {
      const topic = topicOf(r.headline, game);
      const kind = claimKind(r.headline, {
        rumour: true,
        sourceName: r.source,
      });
      return {
        id: claimId(
          game,
          topic ? `topic:${topic.id}:rumour` : `rumour:${r.id}`,
        ),
        game,
        question:
          topic?.question ??
          `Is it true that ${r.headline.replace(/[.!?]+$/, "")}?`,
        claim: r.headline.slice(0, 280),
        kind,
        source: {
          name: r.source ?? "Reported",
          ...(r.url ? { url: r.url } : {}),
          ...(r.at ? { at: r.at } : {}),
        },
        origin: "rumour_episode" as const,
        ...(topic ? { topic: topic.id } : {}),
        status: (spoilsStory(r.headline) ? "held" : "open") as ClaimStatus,
      };
    });
}

/**
 * One ledger from every source (pure): a claim seen twice (the same ask, or the same topic from the GTA File and the
 * asks list) is one entry; the least official kind wins, so a leak that a preview later repeated stays labelled a leak
 * until the footage grades it. Grades already held are kept.
 */
export function mergeLedger(...lists: LabClaim[][]): LabClaim[] {
  const out: LabClaim[] = [];
  const order: ClaimKind[] = [
    "leak",
    "datamine",
    "insider",
    "rumour",
    "reported",
    "myth",
    "viewer",
    "preview",
    "official",
  ];
  for (const c of lists.flat()) {
    const same = out.find(
      (x) =>
        x.id === c.id ||
        (x.askId && c.askId && x.askId === c.askId) ||
        (x.topic && c.topic && x.topic === c.topic && x.game === c.game),
    );
    if (!same) {
      out.push({ ...c });
      continue;
    }
    if (order.indexOf(c.kind) < order.indexOf(same.kind)) {
      same.kind = c.kind;
      same.source = c.source;
      same.claim = c.claim;
    }
    same.askId ??= c.askId;
    if (c.status === "held")
      same.status = same.status === "graded" ? "graded" : "held";
    if (!same.grade && c.grade) {
      same.grade = c.grade;
      same.status = "graded";
    }
  }
  return out;
}

// ------------------------------------------------------------------ grading (pure)

/** A miner reason or a reviewer's result that says it only partly held. */
const PARTLY_WORDS =
  /\b(partly|partially|part of|some but not|not (?:every|all|always)|only (?:some|a few|in some)|sometimes|mostly|half of|but not)\b/i;
/** A claim that promises everything: "every store", "all buildings", "always". */
const UNIVERSAL = /\b(every|all|always|any|never|no)\b/i;

/**
 * The grade a verdict earns (pure), or undefined when it earns none: below the confidence bar, unclear, or about
 * another ask. Proved is TRUE and disproved FALSE, except PARTLY when the verdict's reason says it only partly held,
 * when a measured count shows a claim of "every" holding for some but not all, or a measured number lands within
 * 10 to 35 per cent of a claimed one. A count of none against "every" is FALSE whatever the verdict said.
 */
export function gradeFor(
  claim: Pick<LabClaim, "claim" | "question">,
  verdict: Pick<AskVerdict, "result" | "confidence" | "reason">,
  minConfidence: number,
  measured?: ClaimGrade["measured"],
): Grade | undefined {
  if (verdict.confidence < minConfidence) return undefined;
  const text = `${claim.claim} ${claim.question}`;
  if (measured?.of !== undefined && measured.of > 0 && UNIVERSAL.test(text)) {
    if (measured.value === 0) return "FALSE";
    if (measured.value < measured.of) return "PARTLY";
    return verdict.result === "proved" ? "TRUE" : "PARTLY";
  }
  if (measured?.claimed !== undefined && measured.claimed > 0) {
    const off = Math.abs(measured.value - measured.claimed) / measured.claimed;
    if (off <= 0.1) return "TRUE";
    if (off <= 0.35) return "PARTLY";
    return "FALSE";
  }
  if (PARTLY_WORDS.test(verdict.reason)) return "PARTLY";
  return verdict.result === "proved" ? "TRUE" : "FALSE";
}

/** Grades from the stream-asks list's verdicts (pure): each open claim whose ask the footage settled confidently. */
export function gradeFromAsks(
  ledger: LabClaim[],
  asks: StreamAsk[],
  minConfidence: number,
): LabClaim[] {
  const byId = new Map(asks.map((a) => [a.id, a]));
  return ledger.map((c) => {
    if (c.grade || c.status === "held") return c;
    const a =
      (c.askId && byId.get(c.askId)) ||
      asks.find(
        (x) =>
          x.game === c.game &&
          x.verdict &&
          ((c.topic && x.topic === c.topic) ||
            overlap(x.question, c.question) >= 0.6),
      );
    const v = a?.verdict;
    if (!v) return c;
    const grade = gradeFor(c, v, minConfidence);
    if (!grade) return c;
    return {
      ...c,
      status: "graded",
      grade: {
        grade,
        confidence: v.confidence,
        vodId: v.vodId,
        recordedOn: v.recordedOn,
        at: v.at,
        reason: v.reason,
        ...(v.moment ? { moment: v.moment } : {}),
        gradedAt: v.decidedAt,
      },
    };
  });
}

/** The ledger claim a clip's stream ask is about (pure): the same question, else the same topic, else most words. */
export function claimForAsk(
  ledger: LabClaim[],
  ask: { question: string; claim?: string },
  game: string,
): LabClaim | undefined {
  const exact = ledger.find(
    (c) => c.game === game && c.question === ask.question,
  );
  if (exact) return exact;
  const topic = topicOf(`${ask.question} ${ask.claim ?? ""}`, game)?.id;
  if (topic) {
    const t = ledger.find((c) => c.game === game && c.topic === topic);
    if (t) return t;
  }
  return ledger
    .filter((c) => c.game === game)
    .map((c) => ({ c, o: overlap(c.question, ask.question) }))
    .filter((x) => x.o >= 0.6)
    .sort((a, b) => b.o - a.o)[0]?.c;
}

/** How the ledger stands, for the owner's page and the tally (pure). */
export function ledgerCounts(
  ledger: LabClaim[],
): Record<Grade | "open" | "held", number> {
  const n = { TRUE: 0, FALSE: 0, PARTLY: 0, open: 0, held: 0 };
  for (const c of ledger) {
    if (c.grade) n[c.grade.grade]++;
    else if (c.status === "held") n.held++;
    else n.open++;
  }
  return n;
}

/** The ledger as markdown, graded first, every claim with its label and source (pure). */
export function ledgerMarkdown(ledger: LabClaim[], now: Date): string {
  const n = ledgerCounts(ledger);
  const rank = (c: LabClaim) => (c.grade ? 0 : c.status === "open" ? 1 : 2);
  const rows = [...ledger]
    .sort((a, b) => rank(a) - rank(b) || a.question.localeCompare(b.question))
    .map((c) => {
      const g = c.grade
        ? `**${c.grade.grade}** (${Math.round(c.grade.confidence * 100)}%, ${c.grade.vodId} at ${Math.round(c.grade.at)} s)`
        : c.status === "held"
          ? "held (story)"
          : "open";
      return `| ${g} | ${CLAIM_LABEL[c.kind]} | ${c.question.replace(/\|/g, "/")} | ${c.claim.replace(/\|/g, "/").slice(0, 140)} | ${c.source.name.replace(/\|/g, "/")} | ${c.origin} |`;
    });
  return [
    `# Receipts ledger (${now.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
    "",
    `${ledger.length} claims: ${n.TRUE} true, ${n.FALSE} false, ${n.PARTLY} partly true, ${n.open} open, ${n.held} held for spoilers. Nothing is graded without the owner's own footage, and every claim keeps its label.`,
    "",
    "| Grade | Label | Question | Claim as made | Source | From |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** The spoken and written verdict line (pure): the claim's label and source said first, the grade last. */
export function verdictLine(
  c: Pick<LabClaim, "kind" | "source">,
  grade: Grade,
): string {
  const who =
    c.kind === "official"
      ? c.source.name
      : `a ${CLAIM_LABEL[c.kind].toLowerCase()} from ${c.source.name}`;
  return `The claim came from ${who}. On my own copy, it is ${GRADE_WORDS[grade]}.`;
}

// ------------------------------------------------------------------ the database

interface ClaimRow {
  id: string;
  game: string;
  question: string;
  claim: string;
  kind: string;
  source: unknown;
  origin: string;
  ask_id: string | null;
  topic: string | null;
  status: string;
  grade: unknown;
}

const parse = <T>(v: unknown): T =>
  typeof v === "string" ? (JSON.parse(v) as T) : (v as T);

function fromRow(r: ClaimRow): LabClaim {
  const grade = r.grade ? parse<ClaimGrade>(r.grade) : undefined;
  return {
    id: r.id,
    game: r.game,
    question: r.question,
    claim: r.claim,
    kind: r.kind as ClaimKind,
    source: parse<LabClaim["source"]>(r.source),
    origin: r.origin as ClaimOrigin,
    ...(r.ask_id ? { askId: r.ask_id } : {}),
    ...(r.topic ? { topic: r.topic } : {}),
    status: r.status as ClaimStatus,
    ...(grade ? { grade } : {}),
  };
}

/** Every claim in the ledger. */
export async function readLedger(db: Db, game?: string): Promise<LabClaim[]> {
  const rows = await db.query<ClaimRow>(
    `SELECT id, game, question, claim, kind, source, origin, ask_id, topic, status, grade FROM lab_claims
      ${game ? "WHERE game = $1" : ""} ORDER BY first_seen, id`,
    game ? [game] : [],
  );
  return rows.map(fromRow);
}

/**
 * Writes the ledger: new claims go in, known ones get fresher words and label, and a grade already stored is never
 * replaced by none or by a weaker one (a restart or a re-read of the lists cannot undo a Receipt).
 */
export async function syncLedger(db: Db, claims: LabClaim[]): Promise<number> {
  let n = 0;
  for (const c of claims) {
    await db.query(
      `INSERT INTO lab_claims (id, game, question, claim, kind, source, origin, ask_id, topic, status, grade)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         question = EXCLUDED.question, claim = EXCLUDED.claim, kind = EXCLUDED.kind, source = EXCLUDED.source,
         ask_id = COALESCE(lab_claims.ask_id, EXCLUDED.ask_id), topic = COALESCE(lab_claims.topic, EXCLUDED.topic),
         status = CASE WHEN lab_claims.grade IS NOT NULL THEN 'graded'
                       WHEN EXCLUDED.grade IS NOT NULL THEN 'graded' ELSE EXCLUDED.status END,
         grade = CASE WHEN lab_claims.grade IS NULL THEN EXCLUDED.grade
                      WHEN EXCLUDED.grade IS NOT NULL
                       AND (EXCLUDED.grade->>'confidence')::float > (lab_claims.grade->>'confidence')::float
                      THEN EXCLUDED.grade || jsonb_strip_nulls(jsonb_build_object('episodeId', lab_claims.grade->>'episodeId'))
                      ELSE lab_claims.grade END,
         updated_at = now()`,
      [
        c.id,
        c.game,
        c.question,
        c.claim,
        c.kind,
        JSON.stringify(c.source),
        c.origin,
        c.askId ?? null,
        c.topic ?? null,
        c.status,
        c.grade ? JSON.stringify(c.grade) : null,
      ],
    );
    n++;
  }
  return n;
}

/** Records the Receipts Short that showed a claim's grade (first one wins). */
export async function markShown(
  db: Db,
  claimId: string,
  episodeId: string,
): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `UPDATE lab_claims SET grade = grade || jsonb_build_object('episodeId', $2::text), updated_at = now()
      WHERE id = $1 AND grade IS NOT NULL AND grade->>'episodeId' IS NULL RETURNING id`,
    [claimId, episodeId],
  );
  return rows.length > 0;
}

/** The factory's own GTA VI rumour Shorts, for the ledger. */
export async function rumourEpisodes(
  db: Db,
  isGame: (t: string) => boolean,
): Promise<RumourEpisodeRow[]> {
  const rows = await db
    .query<{
      id: string;
      headline: string | null;
      game: string | null;
      items: unknown;
      at: string | Date;
    }>(
      `SELECT id, COALESCE(script_json->>'headline', story_json->>'headline') AS headline,
              COALESCE(NULLIF(script_json->>'game_title', ''), story_json->>'gameHint') AS game,
              story_json->'items' AS items, created_at AS at
         FROM episodes WHERE script_json->>'is_rumour' = 'true' AND status NOT IN ('failed','rejected')
        ORDER BY created_at DESC LIMIT 200`,
    )
    .catch(() => []);
  return rows
    .filter((r) => r.headline && isGame(`${r.game ?? ""} ${r.headline}`))
    .map((r) => {
      const items = (parse<Array<{ source?: string; url?: string }>>(r.items) ??
        []) as Array<{ source?: string; url?: string }>;
      return {
        id: r.id,
        headline: r.headline!,
        game: r.game ?? "",
        ...(items[0]?.source ? { source: items[0].source } : {}),
        ...(items[0]?.url ? { url: items[0].url } : {}),
        at: new Date(r.at).toISOString(),
      };
    });
}
