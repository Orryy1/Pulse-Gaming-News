// The nightly integrity job: stale and low-confidence facts are read again at their source. A fact still there is
// confirmed; one gone is marked down, and retracted after repeated misses; a Steam price that moved is replaced.

import type { Db } from "../db.ts";
import { normaliseQuote, normaliseText } from "./normalise.ts";
import { verifiedBy, type PageReader } from "./harvest.ts";
import type { Fact, FactVault } from "./store.ts";

/** How long each kind of fact holds before it is read again (days). */
export const STALE_DAYS: Record<string, number> = {
  price: 1,
  players: 7,
  sales: 30,
  release_date: 60,
  platform: 60,
  review_score: 180,
  review_quote: 180,
  developer: 180,
  publisher: 180,
  award: 365,
  engine: 365,
  person: 365,
  series: 365,
};
/** Below this, a fact is re-read whatever its age. */
export const LOW_CONFIDENCE = 0.6;
/** Misses in a row before a fact is retracted. */
export const RETRACT_AFTER = 3;

/** The facts due tonight: stale for their kind, or not trusted enough yet; least trusted and oldest first. */
export async function dueFacts(
  db: Db,
  now: Date,
  limit: number,
): Promise<Fact[]> {
  const cases = Object.entries(STALE_DAYS)
    .map(([k, d]) => `WHEN '${k}' THEN ${d}`)
    .join(" ");
  const rows = await db.query<Fact>(
    `SELECT * FROM fact_vault
      WHERE status IN ('active','stale')
        AND (confidence < $2 OR checked_at < $1::timestamptz - make_interval(days => CASE kind ${cases} ELSE 90 END))
      ORDER BY confidence ASC, checked_at ASC LIMIT $3`,
    [now.toISOString(), LOW_CONFIDENCE, limit],
  );
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    confidence: Number(r.confidence),
  }));
}

/** Whether a page still says what a fact says (pure). */
export function stillSays(text: string, f: Fact): boolean {
  if (f.kind === "review_quote")
    return !!f.quote && normaliseText(text).includes(normaliseQuote(f.quote));
  const v = f.value_json ?? {};
  const needs: string[] = [];
  if (f.kind === "release_date" && v.year) needs.push(String(v.year));
  else if (f.kind === "review_score" && typeof v.score === "number")
    needs.push(String(v.score));
  else if ((f.kind === "sales" || f.kind === "players") && f.value)
    needs.push(f.value.split(/\s+/)[0]!);
  else needs.push(f.value.replace(/\s*\(.*\)$/, ""));
  return verifiedBy(text, {
    kind: f.kind,
    claim: f.claim,
    value: f.value,
    needs,
  });
}

export interface IntegrityReport {
  checked: number;
  confirmed: number;
  weakened: number;
  retracted: number;
  replaced: number;
  unreachable: number;
}

/** Steam prices are read from the store's own data, not the page. */
export type PriceReader = (
  storeUrl: string,
) => Promise<{ usd?: string; gbp?: string; eur?: string } | undefined>;

export async function runIntegrity(
  vault: FactVault,
  read: PageReader,
  opts: { now?: Date; limit?: number; prices?: PriceReader } = {},
): Promise<IntegrityReport> {
  const now = opts.now ?? new Date();
  const report: IntegrityReport = {
    checked: 0,
    confirmed: 0,
    weakened: 0,
    retracted: 0,
    replaced: 0,
    unreachable: 0,
  };
  const facts = await dueFacts(vault.db, now, opts.limit ?? 200);
  const pages = new Map<string, Promise<string | undefined>>();
  const pageText = (url: string) => {
    if (!pages.has(url))
      pages.set(
        url,
        read(url).then(
          (p) => p?.text,
          () => undefined,
        ),
      );
    return pages.get(url)!;
  };
  const confirm = async (f: Fact, note: string) => {
    await vault.db.query(
      `UPDATE fact_vault SET checked_at = $2, confidence = LEAST(0.98, confidence + 0.05), status = 'active', check_failures = 0, updated_at = now() WHERE id = $1`,
      [f.id, now.toISOString()],
    );
    await vault.recordCheck(f.id, true, note);
    report.confirmed++;
  };
  const miss = async (f: Fact, note: string) => {
    const failures = f.check_failures + 1;
    const retract = failures >= RETRACT_AFTER;
    await vault.db.query(
      `UPDATE fact_vault SET check_failures = $2, confidence = confidence * 0.8, status = $3, updated_at = now() WHERE id = $1`,
      [f.id, failures, retract ? "retracted" : "stale"],
    );
    await vault.recordCheck(f.id, false, note);
    if (retract) report.retracted++;
    else report.weakened++;
  };
  for (const f of facts) {
    report.checked++;
    if (f.kind === "price" && f.source_type === "store_page" && opts.prices) {
      const now$ = await opts.prices(f.source_url).catch(() => undefined);
      if (!now$) {
        report.unreachable++;
        continue;
      }
      const cur =
        f.value_json?.currency === "GBP"
          ? now$.gbp
          : f.value_json?.currency === "EUR"
            ? now$.eur
            : now$.usd;
      if (cur && cur === f.value) await confirm(f, "price unchanged");
      else {
        // The price moved: the old one is superseded and the new one stored from the same store page.
        await vault.db.query(
          `UPDATE fact_vault SET status = 'superseded', updated_at = now() WHERE id = $1`,
          [f.id],
        );
        await vault.recordCheck(f.id, false, `price now ${cur ?? "gone"}`);
        if (cur) {
          const amount = Number(cur.replace(/[^0-9.]/g, ""));
          await vault.addFact({
            entity: f.entity_id,
            kind: "price",
            claim: f.claim.replace(f.value, cur),
            value: cur,
            valueJson: { ...f.value_json, amount },
            region: f.region ?? undefined,
            outlet: f.outlet ?? undefined,
            sourceUrl: f.source_url,
            sourceType: "store_page",
            origin: "steam",
            checkedAt: now,
            confidence: 0.9,
          });
        }
        report.replaced++;
      }
      continue;
    }
    const text = await pageText(f.source_url);
    if (!text) {
      report.unreachable++;
      await vault.recordCheck(f.id, false, "source unreachable");
      continue;
    }
    if (stillSays(text, f)) await confirm(f, "source still says it");
    else await miss(f, "source no longer says it");
  }
  return report;
}

/** Whether tonight's integrity run is due: once a day, at 04:00 local or later. */
export async function integrityDue(
  db: Db,
  timezone: string,
  now: Date,
): Promise<string | undefined> {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  if (Number(p.hour) < 4) return undefined;
  const day = `${p.year}-${p.month}-${p.day}`;
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'factvault_integrity_day'`,
  );
  return row?.value === day ? undefined : day;
}

export async function markIntegrity(
  db: Db,
  day: string,
  report: IntegrityReport,
): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('factvault_integrity_day', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [day],
  );
  await db.query(
    `INSERT INTO events (episode_id, kind, detail) VALUES (NULL, 'factvault_integrity', $1)`,
    [JSON.stringify(report)],
  );
}
