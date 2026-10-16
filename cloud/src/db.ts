// Thin database seam. Production uses node-postgres; tests use PGlite (real
// Postgres compiled to WASM) through the same interface.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs a multi-statement script on a single connection. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export function createPgDb(databaseUrl: string): Db {
  const ssl = /sslmode=require|\.rlwy\.net|proxy\.rlwy/.test(databaseUrl) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4, ssl });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
    async exec(sql: string) {
      const client = await pool.connect();
      try {
        await client.query(sql);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, "..", "migrations");

export async function migrate(db: Db): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>(`SELECT name FROM schema_migrations`)).map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // One script on one connection, so the migration and its bookkeeping
    // row commit (or roll back) together.
    const safeName = file.replace(/'/g, "''");
    await db.exec(`BEGIN;\n${sql}\n;INSERT INTO schema_migrations (name) VALUES ('${safeName}');\nCOMMIT;`);
    applied.push(file);
  }
  return applied;
}

/**
 * Cross-process mutex so two replicas (or an overlapping tick) never advance
 * the pipeline at once. The lease expires on its own if the holder dies.
 */
export async function withLease<T>(db: Db, name: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | undefined> {
  const holder = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db.query<{ holder: string }>(
    `INSERT INTO leases (name, holder, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))
     ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
       WHERE leases.expires_at < now()
     RETURNING holder`,
    [name, holder, ttlSeconds],
  );
  if (rows[0]?.holder !== holder) return undefined;
  try {
    return await fn();
  } finally {
    await db.query(`DELETE FROM leases WHERE name = $1 AND holder = $2`, [name, holder]);
  }
}
