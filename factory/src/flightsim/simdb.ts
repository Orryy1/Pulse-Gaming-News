// The flight simulator's sandbox database: the factory's own migrations on an in-memory PGlite, with SQL's now()
// answering the simulated time. A sim schema ahead of pg_catalog in the search path holds a now() that reads the
// session setting sim.now, set before each query whenever the clock has moved; column defaults written as now()
// bind to it too, because the schema is in place before the first migration runs.

import { PGlite } from "@electric-sql/pglite";
import { migrate, type Db } from "../db.ts";
import type { SimClock } from "./clock.ts";

export const SIM_NOW_SQL = `
CREATE SCHEMA IF NOT EXISTS sim;
CREATE OR REPLACE FUNCTION sim.now() RETURNS timestamptz LANGUAGE sql STABLE AS
  $$ SELECT COALESCE(NULLIF(current_setting('sim.now', true), ''), '2000-01-01T00:00:00Z')::timestamptz $$;
SET search_path = public, sim, pg_catalog;
`;

export interface SimDb extends Db {
  /** Queries run, for the report. */
  queries(): number;
}

export async function simDb(clock: SimClock): Promise<SimDb> {
  const pg = new PGlite();
  let lastSet = -1;
  let count = 0;
  const sync = async () => {
    if (clock.millis === lastSet) return;
    lastSet = clock.millis;
    await pg.query(`SELECT set_config('sim.now', $1, false)`, [
      clock.now().toISOString(),
    ]);
  };
  await pg.exec(SIM_NOW_SQL);
  const db: SimDb = {
    async query<T>(sql: string, params: unknown[] = []) {
      await sync();
      count++;
      return (await pg.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await sync();
      count++;
      try {
        await pg.exec(sql);
      } catch (err) {
        await pg.exec("ROLLBACK").catch(() => undefined);
        throw err;
      }
    },
    close: () => pg.close(),
    queries: () => count,
  };
  await migrate(db);
  return db;
}
