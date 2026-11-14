// The Fact Vault as the factory uses it: the writer's brief, the fact checker's evidence and the enforcement pass.

import { log, errorMessage } from "../lib/util.ts";
import type { Db } from "../db.ts";
import {
  applyFixes,
  nearestEntityBefore,
  entitiesIn,
  parseBlocker,
  precheck,
  repeatsDispute,
  resolveBlocker,
  usable,
  type Fix,
  type Resolution,
  type VaultContext,
} from "./check.ts";
import { linesOf } from "./claims.ts";
import { dateWords, entityKey } from "./normalise.ts";
import { FactVault, type Entity, type Fact } from "./store.ts";
import { vaultEnforces, vaultReads, type FactVaultMode } from "./mode.ts";

/** Loads what the vault knows about the named games, plus any vault game the texts mention by name. */
export async function loadContext(
  vault: FactVault,
  names: readonly string[],
  texts: readonly string[] = [],
  now = new Date(),
): Promise<VaultContext> {
  const named = await vault.findEntities(names.filter(Boolean));
  const ids = new Set(named.map((e) => e.id));
  const entities: Entity[] = [...named];
  if (texts.length) {
    const all = await vault.allEntities();
    const probe: VaultContext = { entities: all, facts: [], disputes: [], now };
    for (const line of linesOf(texts))
      for (const e of entitiesIn(line, probe, false))
        if (!ids.has(e.id) && entities.length < 40) {
          ids.add(e.id);
          entities.push(e);
        }
  }
  const facts = await vault.factsFor([...ids]);
  const disputes = await vault.disputesFor([...ids], 30);
  return { entities, facts, disputes, now };
}

const KIND_ORDER: Record<string, number> = {
  release_date: 0,
  platform: 1,
  developer: 2,
  publisher: 3,
  sales: 4,
  players: 5,
  price: 6,
  review_score: 7,
  review_quote: 8,
  award: 9,
  engine: 10,
  person: 11,
  series: 12,
};

function factLine(f: Fact): string {
  const src = `[${f.outlet ?? "source"}, ${f.source_type.replace(/_/g, " ")}: ${f.source_url}]`;
  if (f.kind === "review_quote")
    return `- ${f.outlet} review: “${f.quote}” ${src}`;
  if (f.kind === "release_date" && f.value_json?.year)
    return `- Released ${dateWords(f.value_json as never)}${f.region ? ` (${f.region})` : ""} ${src}`;
  return `- ${f.claim.replace(/\s+/g, " ").slice(0, 260)} ${src}`;
}

/** A secondary-source fact two different sources agree on (the same game, kind and value) is fit for the brief. */
function corroborated(f: Fact, all: readonly Fact[]): boolean {
  const key = (x: Fact) => `${x.entity_id}|${x.kind}|${x.region ?? ""}|${x.value.toLowerCase()}`;
  const k = key(f);
  return new Set(all.filter((x) => key(x) === k && Number(x.confidence) >= 0.6).map((x) => new URL(x.source_url).hostname)).size >= 2;
}

/**
 * The block a writer and a fact checker read: the vault's facts per game, each with its primary source, the review
 * quotes that may be quoted word for word, and the claims our fact check has already rejected.
 */
export function vaultBrief(
  ctx: VaultContext,
  opts: { perGame?: number; maxChars?: number } = {},
): string {
  if (!ctx.entities.length) return "";
  const per = opts.perGame ?? 14;
  const parts: string[] = [];
  for (const e of ctx.entities) {
    const facts = ctx.facts
      .filter(
        (f) =>
          f.entity_id === e.id &&
          f.status === "active" &&
          (Number(f.confidence) >= 0.75 || corroborated(f, ctx.facts)) &&
          (f.kind !== "price" || usable(f, ctx.now)),
      )
      .sort(
        (a, b) =>
          (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99) ||
          Number(b.confidence) - Number(a.confidence),
      );
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const f of facts) {
      const key =
        `${f.kind}|${f.kind === "review_quote" ? f.quote : f.value}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(factLine(f));
      if (lines.length >= per) break;
    }
    const disputes = ctx.disputes
      .filter((d) => d.entity_id === e.id)
      .slice(0, 5);
    if (!lines.length && !disputes.length) continue;
    parts.push(
      `${e.name}:\n${lines.join("\n")}${disputes.length ? `\n  Already rejected by our fact check, never say again:\n${disputes.map((d) => `  - "${d.claim.slice(0, 200)}" (${d.reason.slice(0, 160)})`).join("\n")}` : ""}`,
    );
  }
  if (!parts.length) return "";
  const body = parts.join("\n\n");
  const capped =
    body.length > (opts.maxChars ?? 9000)
      ? `${body.slice(0, opts.maxChars ?? 9000).replace(/\n[^\n]*$/, "")}\n…`
      : body;
  return `PULSE FACT VAULT (facts verified against their primary sources; use these numbers, dates and names as written, and credit the source named, never Wikipedia):
${capped}
Quotation rule: words in quotation marks must be one of the review quotes above, word for word, credited to that outlet. Anything else a critic said is paraphrased without quotation marks, and never credited to an outlet whose review is not listed here.
Credit rule: name only sources you were actually given (the facts above and the story's own sources). Never credit a guide, walkthrough, manual, wiki, panel, update notes or an outlet you were not given; say the fact plainly instead. In our fact checks, invented credits like these are a common reason a video is dropped.`;
}

export interface Enforcement<T> {
  script: T;
  /** Blockers the vault did not settle, in the factory's "Fact-check: ..." form. */
  remaining: string[];
  resolutions: Resolution[];
  fixes: Fix[];
}

/**
 * The enforcement pass on a fact check's blockers: each blocker the vault supports is passed, each it contradicts is
 * fixed in the script with the vault's value, and the rest stand. Pure apart from the context it is given.
 */
export function enforceBlockers<T>(
  script: T,
  blockers: readonly string[],
  ctx: VaultContext,
  /** The script's text, to tell which game a line belongs to; the script itself when not given. */
  fullText?: string,
): Enforcement<T> {
  const text = fullText ?? JSON.stringify(script);
  const resolutions: Resolution[] = [];
  const remaining: string[] = [];
  const fixes: Fix[] = [];
  for (const raw of blockers) {
    const b = parseBlocker(raw);
    if (!b) {
      remaining.push(raw);
      continue;
    }
    const r = resolveBlocker(b, ctx, nearestEntityBefore(text, b.quote, ctx));
    resolutions.push(r);
    if (r.status === "unresolved") remaining.push(raw);
    else fixes.push(...r.fixes);
  }
  const fixed = fixes.length ? applyFixes(script, fixes).value : script;
  return { script: fixed, remaining, resolutions, fixes };
}

/** Lines that repeat a claim our fact check already rejected: feedback for the writer before the check runs. */
export function disputeWarnings(
  texts: readonly string[],
  ctx: VaultContext,
): string[] {
  const out: string[] = [];
  for (const line of linesOf(texts)) {
    const d = repeatsDispute(line, ctx.disputes);
    if (d)
      out.push(
        `Fact vault: "${line.slice(0, 200)}" repeats a claim our fact check rejected before (${d.reason.slice(0, 200)}). Remove or correct it.`,
      );
  }
  return out;
}

/** The pre-check's verdicts as a note for the fact checker: what the vault already verified, with the source. */
export function verifiedNote(
  texts: readonly string[],
  ctx: VaultContext,
): string {
  const ok = precheck(texts, ctx).filter(
    (j) => j.verdict === "supported" && j.fact,
  );
  if (!ok.length) return "";
  const lines = [
    ...new Map(ok.map((j) => [`${j.claim.span}|${j.fact!.id}`, j])).values(),
  ].slice(0, 20);
  return `\n\nVerified by the Pulse Fact Vault against primary sources (treat these as supported):\n${lines.map((j) => `- "${j.claim.span}": ${j.fact!.claim.slice(0, 200)} [${j.fact!.source_url}]`).join("\n")}`;
}

/** The vault for a mode, or undefined when the mode is off; a vault that fails to open is logged and treated as off. */
export function vaultFor(db: Db, mode: FactVaultMode): FactVault | undefined {
  return vaultReads(mode) ? new FactVault(db) : undefined;
}

/** Runs a vault step without ever failing the episode: the vault helps the pipeline and is never in its way. */
export async function safely<T>(
  what: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    log("warn", `fact vault: ${what} failed`, { error: errorMessage(err) });
    return undefined;
  }
}

export { vaultEnforces, entityKey };
