// The vault's judgement (pure): a claim against the facts held for its game. Supported claims pass, contradicted ones
// get the vault's value, and anything the vault can't settle is left to the fact checker as before.

import {
  extractClaims,
  linesOf,
  type Claim,
  type PriceClaim,
  type QuoteClaim,
  type SalesClaim,
  type YearClaim,
} from "./claims.ts";
import {
  aliasKeys,
  entityKey,
  moneyText,
  normaliseQuote,
  PRIMARY_TYPES,
  yearsIn,
} from "./normalise.ts";
import {
  PROBLEM_KIND,
  STOP_WORDS,
  SUPERLATIVE,
  FIGURE,
  type ClaimKind,
} from "./patterns.ts";
import type { Dispute, Entity, Fact } from "./store.ts";

/** What the vault knows about the games in play. */
export interface VaultContext {
  entities: Entity[];
  facts: Fact[];
  disputes: Dispute[];
  now: Date;
}

/** A price is a fact for a few days; a fix never uses an older one. */
export const PRICE_FRESH_DAYS = 3;
/** A fact the checker may lean on without the model's say: at least this confident and from a primary source. */
export const ENFORCE_MIN_CONFIDENCE = 0.75;

export interface Fix {
  from: string;
  to: string;
  factId: number;
  why: string;
}

export type Verdict = "supported" | "contradicted" | "unknown";

export interface Judged {
  claim: Claim;
  verdict: Verdict;
  fact?: Fact;
  fix?: Fix;
  entity?: string;
}

const lower = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether a fact may decide a claim: active, confident, primary, and (for prices) fresh. */
export function usable(f: Fact, now: Date): boolean {
  if (f.status !== "active") return false;
  if (Number(f.confidence) < ENFORCE_MIN_CONFIDENCE) return false;
  if (!PRIMARY_TYPES.has(f.source_type)) return false;
  const age = now.getTime() - new Date(f.checked_at).getTime();
  // A price is a fact for a few days either side of when it was read, never for a moment it was not yet known.
  if (f.kind === "price") return age <= PRICE_FRESH_DAYS * 86_400_000 && age >= -86_400_000;
  return true;
}

/** The entities a piece of text names, longest name first; the context's only entity when the text names none. */
export function entitiesIn(text: string, ctx: VaultContext, fallback = true): Entity[] {
  const key = `-${entityKey(text)}-`;
  const hits = ctx.entities
    .map((e) => ({
      e,
      len: Math.max(
        0,
        ...[entityKey(e.name), ...(e.aliases ?? [])]
          .filter((k) => k && key.includes(`-${k}-`))
          .map((k) => k.length),
      ),
    }))
    .filter((x) => x.len > 0)
    .sort((a, b) => b.len - a.len);
  if (hits.length) {
    // "Fallout 2" inside "Fallout 2" also matches the series name "Fallout": keep only names not contained in a longer hit.
    const best = hits[0]!.len;
    return hits
      .filter(
        (h) =>
          h.len === best ||
          !hits.some(
            (o) =>
              o.len > h.len &&
              entityKey(o.e.name).includes(entityKey(h.e.name)),
          ),
      )
      .map((h) => h.e);
  }
  return fallback && ctx.entities.length === 1 ? [ctx.entities[0]!] : [];
}

function judgeQuote(c: QuoteClaim, facts: Fact[]): Omit<Judged, "claim"> {
  if (!c.outlet) return { verdict: "unknown" };
  const fromOutlet = facts.filter(
    (f) =>
      (f.kind === "review_quote" || f.kind === "review_score") &&
      lower(f.outlet) === lower(c.outlet),
  );
  const words = normaliseQuote(c.words);
  const exact = fromOutlet.find(
    (f) =>
      f.kind === "review_quote" &&
      f.quote &&
      normaliseQuote(f.quote).includes(words),
  );
  if (exact) return { verdict: "supported", fact: exact };
  const review =
    fromOutlet.find((f) => f.kind === "review_quote") ?? fromOutlet[0];
  // The outlet did review the game, but not in these words: the line keeps its sense without the quotation marks.
  if (review)
    return {
      verdict: "contradicted",
      fact: review,
      fix: {
        from: c.span,
        to: c.words.replace(/[.,;:!?]+$/, ""),
        factId: review.id,
        why: `not ${c.outlet}'s words; paraphrased without quotation marks`,
      },
    };
  return { verdict: "unknown" };
}

function judgePrice(c: PriceClaim, facts: Fact[]): Omit<Judged, "claim"> {
  const prices = facts.filter(
    (f) =>
      f.kind === "price" &&
      f.value_json?.currency === c.currency &&
      typeof f.value_json?.amount === "number",
  );
  if (!prices.length) return { verdict: "unknown" };
  const exact = prices.find(
    (f) => Math.abs(f.value_json.amount - c.amount) < 0.005,
  );
  if (exact) return { verdict: "supported", fact: exact };
  const near = prices.find(
    (f) =>
      Math.abs(f.value_json.amount - c.amount) /
        Math.max(f.value_json.amount, 0.01) <=
      0.15,
  );
  if (c.hedge && near) {
    const a = near.value_json.amount;
    const ok =
      c.hedge === "about" ||
      (c.hedge === "at_most" && a <= c.amount) ||
      (c.hedge === "at_least" && a >= c.amount);
    return ok ? { verdict: "supported", fact: near } : { verdict: "unknown" };
  }
  if (c.hedge) return { verdict: "unknown" };
  // Several current prices for one currency (editions, a sale) leave the right one unclear: the checker decides.
  const target = near ?? (prices.length === 1 ? prices[0] : undefined);
  if (!target) return { verdict: "unknown" };
  const to = moneyText(target.value_json.amount, c.currency);
  return {
    verdict: "contradicted",
    fact: target,
    fix: { from: c.span, to, factId: target.id, why: `the price is ${to}` },
  };
}

function judgeYear(c: YearClaim, facts: Fact[]): Omit<Judged, "claim"> {
  const dates = facts.filter(
    (f) => f.kind === "release_date" && typeof f.value_json?.year === "number",
  );
  if (!dates.length) return { verdict: "unknown" };
  // Two years in one line ("Fallout in 1997, its sequel in 1998") can't be told apart by a matcher.
  if (yearsIn(c.line).length > 1) return { verdict: "unknown" };
  const inRegion = c.region ? dates.filter((f) => f.region === c.region) : [];
  if (inRegion.length) {
    const hit = inRegion.find((f) => f.value_json.year === c.year);
    if (hit) return { verdict: "supported", fact: hit };
    const first = inRegion.reduce((a, b) =>
      a.value_json.year <= b.value_json.year ? a : b,
    );
    return {
      verdict: "contradicted",
      fact: first,
      fix: {
        from: c.span,
        to: String(first.value_json.year),
        factId: first.id,
        why: `it came out in ${c.region} in ${first.value_json.year}`,
      },
    };
  }
  const hit = dates.find((f) => f.value_json.year === c.year);
  if (hit) return { verdict: "supported", fact: hit };
  // A port, a remaster or an unnamed region can be any later year: no fix.
  if (c.port || c.region) return { verdict: "unknown" };
  const first = dates.reduce((a, b) =>
    a.value_json.year <= b.value_json.year ? a : b,
  );
  if (
    c.year < first.value_json.year ||
    dates.every((f) => f.value_json.year !== c.year)
  )
    return {
      verdict: "contradicted",
      fact: first,
      fix: {
        from: c.span,
        to: String(first.value_json.year),
        factId: first.id,
        why: `it first came out in ${first.value_json.year}`,
      },
    };
  return { verdict: "unknown" };
}

const millions = (n: number) => {
  const m = n / 1e6;
  return m >= 1000
    ? `${+(m / 1000).toFixed(1)} billion`
    : `${+(m >= 10 ? m.toFixed(0) : m.toFixed(1))} million`;
};

function judgeSales(c: SalesClaim, facts: Fact[]): Omit<Judged, "claim"> {
  const kind = c.players ? "players" : "sales";
  const counts = facts.filter(
    (f) => f.kind === kind && typeof f.value_json?.count === "number",
  );
  if (!counts.length) return { verdict: "unknown" };
  const max = counts.reduce((a, b) =>
    a.value_json.count >= b.value_json.count ? a : b,
  );
  const near = counts.find(
    (f) => Math.abs(f.value_json.count - c.count) / f.value_json.count <= 0.05,
  );
  if (c.hedge === "at_least") {
    if (max.value_json.count >= c.count)
      return { verdict: "supported", fact: max };
  } else if (c.hedge === "at_most") {
    const ok = counts.find(
      (f) =>
        f.value_json.count <= c.count && f.value_json.count >= c.count * 0.85,
    );
    if (ok) return { verdict: "supported", fact: ok };
  } else if (near) return { verdict: "supported", fact: near };
  // Claimed more than any count the record holds: the record's figure replaces it.
  if (c.count > max.value_json.count * 1.05) {
    const to = millions(max.value_json.count);
    return {
      verdict: "contradicted",
      fact: max,
      fix: {
        from: c.figure,
        to,
        factId: max.id,
        why: `the latest recorded figure is ${max.value}`,
      },
    };
  }
  return { verdict: "unknown" };
}

/** One claim against the facts of the games its line names. */
export function judgeClaim(claim: Claim, ctx: VaultContext, hint = ""): Judged {
  // The game the line names, else the one its context names (the checker's complaint, the entry it sits in).
  let ents = entitiesIn(claim.line, ctx, false);
  if (ents.length !== 1 && claim.kind === "quote" && claim.outlet) {
    // An outlet's exact words found in that outlet's review of exactly one game in play settle which game it is.
    const words = normaliseQuote(claim.words);
    const owners = [...new Set(ctx.facts.filter((f) => f.kind === "review_quote" && f.quote && lower(f.outlet) === lower(claim.outlet) && usable(f, ctx.now) && normaliseQuote(f.quote).includes(words)).map((f) => f.entity_id))];
    if (owners.length === 1) ents = ctx.entities.filter((e) => e.id === owners[0]);
  }
  if (ents.length !== 1) ents = entitiesIn(`${claim.line} ${hint}`, ctx);
  if (ents.length !== 1) return { claim, verdict: "unknown" };
  const entity = ents[0]!.id;
  const facts = ctx.facts.filter(
    (f) => f.entity_id === entity && usable(f, ctx.now),
  );
  const r =
    claim.kind === "quote"
      ? judgeQuote(claim, facts)
      : claim.kind === "price"
        ? judgePrice(claim, facts)
        : claim.kind === "year"
          ? judgeYear(claim, facts)
          : judgeSales(claim, facts);
  return { claim, entity, ...r };
}

/** What a fact checker's complaint is about, from its own words. */
export function problemKinds(problem: string): Set<ClaimKind> {
  return new Set(
    PROBLEM_KIND.filter(([re]) => re.test(problem)).map(([, k]) => k),
  );
}

export interface Blocker {
  quote: string;
  problem: string;
}

export interface Resolution {
  blocker: Blocker;
  status: "supported" | "fixed" | "unresolved";
  judged: Judged[];
  fixes: Fix[];
  why: string;
}

/**
 * A fact check's blocker against the vault. Passed when every claim it complains about is held by a primary source,
 * fixed when the vault contradicts it and has the right value, and left alone otherwise (a superlative, a mechanic,
 * a claim the vault holds nothing on).
 */
export function resolveBlocker(b: Blocker, ctx: VaultContext, hint = ""): Resolution {
  const kinds = problemKinds(b.problem);
  const claims = extractClaims(b.quote).filter((c) => kinds.has(c.kind));
  const base = { blocker: b, judged: [] as Judged[], fixes: [] as Fix[] };
  if (!kinds.size)
    return {
      ...base,
      status: "unresolved",
      why: "the complaint is not about a quote, price, date or sales figure",
    };
  if (!claims.length)
    return {
      ...base,
      status: "unresolved",
      why: "no checkable claim of that kind in the line",
    };
  if (
    SUPERLATIVE.test(b.quote) &&
    !claims.every((c) => c.kind === "quote" || c.kind === "price")
  )
    return {
      ...base,
      status: "unresolved",
      why: "a superlative or absolute the vault cannot settle",
    };
  const judged = claims.map((c) => judgeClaim(c, ctx, `${b.problem} ${hint}`));
  if (judged.some((j) => j.verdict === "unknown"))
    return {
      ...base,
      judged,
      status: "unresolved",
      why: "the vault holds nothing that settles it",
    };
  const fixes = judged.flatMap((j) => (j.fix ? [j.fix] : []));
  if (judged.some((j) => j.verdict === "contradicted" && !j.fix))
    return {
      ...base,
      judged,
      status: "unresolved",
      why: "contradicted with no safe fix",
    };
  return fixes.length
    ? {
        ...base,
        judged,
        fixes,
        status: "fixed",
        why: fixes.map((f) => f.why).join("; "),
      }
    : {
        ...base,
        judged,
        status: "supported",
        why: judged
          .map((j) => `${j.fact?.claim ?? ""} (${j.fact?.source_url ?? ""})`)
          .join("; "),
      };
}

/** "Fact-check: \"quote\" - problem" back into its parts (the factory's own blocker strings). */
export function parseBlocker(text: string): Blocker | undefined {
  const m = text.match(/^(?:Fact-check:\s*)?"([\s\S]+?)"\s+-\s+([\s\S]+)$/);
  return m ? { quote: m[1]!, problem: m[2]! } : undefined;
}

/** Every claim in a script's lines, judged: the pre-check before the model reads it. */
export function precheck(
  texts: readonly string[],
  ctx: VaultContext,
): Judged[] {
  return linesOf(texts).flatMap((line) =>
    extractClaims(line).map((c) => judgeClaim(c, ctx)),
  );
}

// ---------------------------------------------------------------- disputes

const content = (t: string) =>
  new Set(
    normaliseQuote(t)
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );

/** How alike two claims are: the share of the smaller one's content words the other has (0-1). */
export function claimOverlap(a: string, b: string): number {
  const x = content(a);
  const y = content(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size);
}

/** The rejected claim a line repeats, if any. */
export function repeatsDispute(
  line: string,
  disputes: readonly Dispute[],
  min = 0.7,
): Dispute | undefined {
  // Every figure in the rejected claim must be in the line too: "11 months" never repeats "18 months".
  const figures = (t: string) => new Set(t.match(FIGURE) ?? []);
  const have = figures(line);
  return disputes.find(
    (d) => claimOverlap(line, d.claim) >= min && content(d.claim).size >= 3 && [...figures(d.claim)].every((n) => have.has(n)),
  );
}

// ---------------------------------------------------------------- fixes

/** Applies fixes to every string in a script (narration, cards, title, description); counts the replacements. */
export function applyFixes<T>(
  value: T,
  fixes: readonly Fix[],
): { value: T; applied: number } {
  let applied = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let s = v;
      for (const f of fixes) {
        if (f.from && s.includes(f.from)) {
          applied += s.split(f.from).length - 1;
          s = s.split(f.from).join(f.to);
        }
      }
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [
          k,
          walk(x),
        ]),
      );
    return v;
  };
  return { value: walk(value) as T, applied };
}

export { aliasKeys };

/** The vault game named last before a quote in a script's full text (the ranking entry the line belongs to). */
export function nearestEntityBefore(fullText: string, quote: string, ctx: VaultContext): string {
  const at = fullText.indexOf(quote.slice(0, 60));
  if (at < 0) return "";
  const before = fullText.slice(Math.max(0, at - 1500), at);
  // The mention that ends last wins; of two ending together ("Brotherhood of Steel" inside "Fallout Tactics:
  // Brotherhood of Steel"), the longer one.
  let best = { name: "", end: -1, len: 0 };
  const low = before.toLowerCase();
  for (const e of ctx.entities)
    for (const n of [e.name, ...((e.aliases ?? []) as string[]).map((a) => a.replace(/-/g, " "))]) {
      const pos = low.lastIndexOf(n.toLowerCase());
      if (pos < 0) continue;
      const end = pos + n.length;
      if (end > best.end || (end === best.end && n.length > best.len)) best = { name: e.name, end, len: n.length };
    }
  return best.name;
}
