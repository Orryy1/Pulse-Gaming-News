// The vault's storage over the factory database (migrations/007_fact_vault.sql).

import crypto from "node:crypto";
import type { Db } from "../db.ts";
import {
  aliasKeys,
  entityId,
  entityKey,
  normaliseQuote,
  originalUrl,
  sourceAllowed,
} from "./normalise.ts";
import type { SourceType } from "./patterns.ts";

export type EntityKind =
  | "game"
  | "studio"
  | "publisher"
  | "person"
  | "series"
  | "platform"
  | "outlet";

export type FactKind =
  | "release_date"
  | "platform"
  | "developer"
  | "publisher"
  | "price"
  | "review_score"
  | "review_quote"
  | "sales"
  | "players"
  | "award"
  | "engine"
  | "series"
  | "person";

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  external: Record<string, unknown>;
}

export interface FactInput {
  entity:
    | {
        kind: EntityKind;
        name: string;
        aliases?: string[];
        external?: Record<string, unknown>;
      }
    | string;
  kind: FactKind;
  claim: string;
  value: string;
  valueJson?: Record<string, unknown>;
  region?: string;
  quote?: string;
  outlet?: string;
  sourceUrl: string;
  sourceType: SourceType;
  discoveredVia?: string;
  origin: "seed" | "steam" | "article" | "research" | "factcheck";
  publishedAt?: string;
  checkedAt?: Date;
  confidence: number;
}

export interface Fact {
  id: number;
  entity_id: string;
  kind: FactKind;
  claim: string;
  value: string;
  value_json: Record<string, any>;
  region: string | null;
  quote: string | null;
  outlet: string | null;
  source_url: string;
  source_type: SourceType;
  discovered_via: string | null;
  origin: string;
  published_at: string | null;
  checked_at: string;
  confidence: number;
  status: string;
  check_failures: number;
}

export interface Dispute {
  id: number;
  entity_id: string | null;
  claim: string;
  reason: string;
  episode_id: string | null;
  times: number;
  last_at: string;
}

/** A fact's identity: the same value from the same source is one fact, seen again. */
export function factFingerprint(
  entity: string,
  f: Pick<
    FactInput,
    "kind" | "region" | "value" | "quote" | "outlet" | "sourceUrl"
  >,
): string {
  const parts = [
    entity,
    f.kind,
    f.region ?? "",
    f.kind === "review_quote"
      ? normaliseQuote(f.quote ?? "")
      : f.value.toLowerCase(),
    (f.outlet ?? "").toLowerCase(),
    originalUrl(f.sourceUrl),
  ];
  return crypto.createHash("sha1").update(parts.join("\u0001")).digest("hex");
}

export function disputeFingerprint(
  entity: string | undefined,
  claim: string,
): string {
  return crypto
    .createHash("sha1")
    .update(`${entity ?? ""}\u0001${normaliseQuote(claim)}`)
    .digest("hex");
}

export class FactVault {
  constructor(readonly db: Db) {}

  /** The entity for a name, created when new; aliases merge into it. */
  async upsertEntity(e: {
    kind: EntityKind;
    name: string;
    aliases?: string[];
    external?: Record<string, unknown>;
  }): Promise<string> {
    const id = entityId(e.kind, e.name);
    const aliases = aliasKeys(e.name, e.aliases ?? []);
    await this.db.query(
      `INSERT INTO fact_entities (id, kind, name, aliases, external) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         aliases = (SELECT jsonb_agg(DISTINCT a) FROM jsonb_array_elements(fact_entities.aliases || EXCLUDED.aliases) a),
         external = fact_entities.external || EXCLUDED.external,
         updated_at = now()`,
      [
        id,
        e.kind,
        e.name,
        JSON.stringify(aliases),
        JSON.stringify(e.external ?? {}),
      ],
    );
    return id;
  }

  /** Adds a fact, or refreshes it when the same value from the same source is already held. Refuses Wikipedia. */
  async addFact(
    f: FactInput,
  ): Promise<{ id: number; created: boolean } | undefined> {
    if (!sourceAllowed(f.sourceUrl)) return undefined;
    if (f.kind === "review_quote" && !f.quote?.trim()) return undefined;
    if (!f.value.trim() || !f.claim.trim()) return undefined;
    const entity =
      typeof f.entity === "string"
        ? f.entity
        : await this.upsertEntity(f.entity);
    const url = originalUrl(f.sourceUrl);
    const confidence = Math.max(0, Math.min(1, f.confidence));
    const fp = factFingerprint(entity, { ...f, sourceUrl: url });
    const rows = await this.db.query<{ id: number; created: boolean }>(
      `INSERT INTO fact_vault (entity_id, kind, claim, value, value_json, region, quote, outlet, source_url, source_type, discovered_via, origin, published_at, checked_at, confidence, fingerprint)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13::date,$14,$15,$16)
       ON CONFLICT (fingerprint) DO UPDATE SET
         checked_at = GREATEST(fact_vault.checked_at, EXCLUDED.checked_at),
         confidence = GREATEST(fact_vault.confidence, EXCLUDED.confidence),
         status = 'active', check_failures = 0, updated_at = now()
       RETURNING id, (xmax = 0) AS created`,
      [
        entity,
        f.kind,
        f.claim.trim().slice(0, 600),
        f.value.trim().slice(0, 300),
        JSON.stringify(f.valueJson ?? {}),
        f.region ?? null,
        f.quote?.trim() ?? null,
        f.outlet ?? null,
        url,
        f.sourceType,
        f.discoveredVia ?? null,
        f.origin,
        f.publishedAt && /^\d{4}(-\d\d){0,2}$/.test(f.publishedAt)
          ? f.publishedAt.length === 4
            ? `${f.publishedAt}-01-01`
            : f.publishedAt.length === 7
              ? `${f.publishedAt}-01`
              : f.publishedAt
          : null,
        (f.checkedAt ?? new Date()).toISOString(),
        confidence,
        fp,
      ],
    );
    const r = rows[0];
    return r ? { id: Number(r.id), created: Boolean(r.created) } : undefined;
  }

  /** Entities whose name or alias matches a title, best first (exact key, then alias). */
  async findEntities(
    names: readonly string[],
    kind: EntityKind = "game",
  ): Promise<Entity[]> {
    const keys = [...new Set(names.flatMap((n) => aliasKeys(n)))].filter(
      Boolean,
    );
    if (!keys.length) return [];
    return this.db.query<Entity>(
      `SELECT id, kind, name, aliases, external FROM fact_entities
        WHERE kind = $1 AND (id = ANY($2::text[]) OR aliases ?| $3::text[])
        ORDER BY name`,
      [kind, keys.map((k) => `${kind}:${k}`), keys],
    );
  }

  /** All entities of a kind (the matcher scans a line for their names). */
  async allEntities(kind: EntityKind = "game"): Promise<Entity[]> {
    return this.db.query<Entity>(
      `SELECT id, kind, name, aliases, external FROM fact_entities WHERE kind = $1`,
      [kind],
    );
  }

  async factsFor(
    entityIds: readonly string[],
    kinds?: readonly FactKind[],
  ): Promise<Fact[]> {
    if (!entityIds.length) return [];
    const rows = await this.db.query<Fact>(
      `SELECT * FROM fact_vault WHERE entity_id = ANY($1::text[]) AND status = 'active'
         ${kinds?.length ? "AND kind = ANY($2::text[])" : ""}
       ORDER BY entity_id, kind, confidence DESC, checked_at DESC`,
      kinds?.length ? [entityIds, kinds] : [entityIds],
    );
    return rows.map((r) => ({
      ...r,
      id: Number(r.id),
      confidence: Number(r.confidence),
    }));
  }

  /** Records a claim a fact check rejected; a repeat counts up. */
  async addDispute(d: {
    entityId?: string;
    claim: string;
    reason: string;
    episodeId?: string;
  }): Promise<void> {
    const claim = d.claim.trim();
    if (claim.length < 6) return;
    await this.db.query(
      `INSERT INTO fact_vault_disputes (entity_id, claim, reason, episode_id, fingerprint) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (fingerprint) DO UPDATE SET times = fact_vault_disputes.times + 1, last_at = now(),
         reason = EXCLUDED.reason, episode_id = EXCLUDED.episode_id`,
      [
        d.entityId ?? null,
        claim.slice(0, 600),
        d.reason.trim().slice(0, 600),
        d.episodeId ?? null,
        disputeFingerprint(d.entityId, claim),
      ],
    );
  }

  async disputesFor(
    entityIds: readonly string[],
    limit = 12,
  ): Promise<Dispute[]> {
    if (!entityIds.length) return [];
    return this.db.query<Dispute>(
      `SELECT id, entity_id, claim, reason, episode_id, times, last_at FROM fact_vault_disputes
        WHERE entity_id = ANY($1::text[]) ORDER BY times DESC, last_at DESC LIMIT $2`,
      [entityIds, limit],
    );
  }

  async recordCheck(factId: number, ok: boolean, note?: string): Promise<void> {
    await this.db.query(
      `INSERT INTO fact_vault_checks (fact_id, ok, note) VALUES ($1,$2,$3)`,
      [factId, ok, note ?? null],
    );
  }

  async stats(): Promise<{
    entities: number;
    facts: number;
    byKind: Record<string, number>;
    disputes: number;
    sources: number;
  }> {
    const [e] = await this.db.query<{ n: string }>(
      `SELECT count(*) n FROM fact_entities`,
    );
    const kinds = await this.db.query<{ kind: string; n: string }>(
      `SELECT kind, count(*) n FROM fact_vault WHERE status = 'active' GROUP BY kind ORDER BY kind`,
    );
    const [d] = await this.db.query<{ n: string }>(
      `SELECT count(*) n FROM fact_vault_disputes`,
    );
    const [s] = await this.db.query<{ n: string }>(
      `SELECT count(DISTINCT source_url) n FROM fact_vault WHERE status = 'active'`,
    );
    const byKind = Object.fromEntries(kinds.map((k) => [k.kind, Number(k.n)]));
    return {
      entities: Number(e?.n ?? 0),
      facts: Object.values(byKind).reduce((a, b) => a + b, 0),
      byKind,
      disputes: Number(d?.n ?? 0),
      sources: Number(s?.n ?? 0),
    };
  }

  /** Drops stored review quotes that a later, stricter filter says are page furniture, not a reviewer's words. */
  async pruneQuotes(isJunk: (q: string) => boolean): Promise<number> {
    const rows = await this.db.query<{ id: number; quote: string }>(`SELECT id, quote FROM fact_vault WHERE kind = 'review_quote'`);
    const bad = rows.filter((r) => isJunk(r.quote)).map((r) => Number(r.id));
    if (bad.length) await this.db.query(`DELETE FROM fact_vault WHERE id = ANY($1::bigint[])`, [bad]);
    return bad.length;
  }

  /** The whole vault as plain rows, for the seed file. */
  async exportAll(): Promise<VaultExport> {
    const entities = await this.db.query<Entity>(
      `SELECT id, kind, name, aliases, external FROM fact_entities ORDER BY id`,
    );
    const facts = await this.db.query<Fact>(
      `SELECT * FROM fact_vault WHERE status = 'active' ORDER BY entity_id, kind, id`,
    );
    return {
      version: 1,
      entities,
      facts: facts.map((f) => ({
        entity_id: f.entity_id,
        kind: f.kind,
        claim: f.claim,
        value: f.value,
        value_json: f.value_json,
        region: f.region,
        quote: f.quote,
        outlet: f.outlet,
        source_url: f.source_url,
        source_type: f.source_type,
        discovered_via: f.discovered_via,
        origin: f.origin,
        published_at: f.published_at
          ? String(f.published_at).slice(0, 10)
          : null,
        checked_at: new Date(f.checked_at).toISOString(),
        confidence: Number(f.confidence),
      })),
    };
  }

  /** Loads a seed file (idempotent: facts already held are refreshed, never duplicated). */
  async importAll(
    data: VaultExport,
  ): Promise<{ entities: number; facts: number }> {
    for (const e of data.entities)
      await this.db.query(
        `INSERT INTO fact_entities (id, kind, name, aliases, external) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
         ON CONFLICT (id) DO UPDATE SET aliases = EXCLUDED.aliases, external = fact_entities.external || EXCLUDED.external, updated_at = now()`,
        [
          e.id,
          e.kind,
          e.name,
          JSON.stringify(e.aliases),
          JSON.stringify(e.external),
        ],
      );
    let facts = 0;
    for (const f of data.facts) {
      const r = await this.addFact({
        entity: f.entity_id,
        kind: f.kind as FactKind,
        claim: f.claim,
        value: f.value,
        valueJson: f.value_json,
        region: f.region ?? undefined,
        quote: f.quote ?? undefined,
        outlet: f.outlet ?? undefined,
        sourceUrl: f.source_url,
        sourceType: f.source_type as SourceType,
        discoveredVia: f.discovered_via ?? undefined,
        origin: f.origin as FactInput["origin"],
        publishedAt: f.published_at ?? undefined,
        checkedAt: new Date(f.checked_at),
        confidence: f.confidence,
      });
      if (r) facts++;
    }
    return { entities: data.entities.length, facts };
  }
}

export interface VaultExport {
  version: 1;
  entities: Entity[];
  facts: Array<{
    entity_id: string;
    kind: string;
    claim: string;
    value: string;
    value_json: Record<string, unknown>;
    region: string | null;
    quote: string | null;
    outlet: string | null;
    source_url: string;
    source_type: string;
    discovered_via: string | null;
    origin: string;
    published_at: string | null;
    checked_at: string;
    confidence: number;
  }>;
}

export { entityKey };
