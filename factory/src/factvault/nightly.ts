// The vault's housekeeping on the running factory: the seed loaded once when the vault is first switched on, and the
// 04:00 integrity run (FACT_VAULT=write or enforce). Called every ten minutes from src/server.ts; each call is cheap
// when there is nothing to do.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import type { Db } from "../db.ts";
import { log, errorMessage } from "../lib/util.ts";
import { readPage, steamPrices } from "./harvest.ts";
import { integrityDue, markIntegrity, runIntegrity } from "./integrity.ts";
import { vaultReads, vaultWrites, type FactVaultMode } from "./mode.ts";
import { FactVault, type VaultExport } from "./store.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The vault seeded for the channel's top games (src/tools/factvault-seed.ts writes it). */
export const SEED_FILE = path.join(
  here,
  "..",
  "..",
  "factvault",
  "seed.json.gz",
);

export function readSeed(file = SEED_FILE): VaultExport | undefined {
  if (!fs.existsSync(file)) return undefined;
  const raw = fs.readFileSync(file);
  return JSON.parse(
    (file.endsWith(".gz") ? zlib.gunzipSync(raw) : raw).toString("utf8"),
  ) as VaultExport;
}

/** Loads the seed once, the first time the vault is read with nothing in it. */
export async function seedOnce(db: Db, file = SEED_FILE): Promise<number> {
  const [done] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'factvault_seeded'`,
  );
  if (done) return 0;
  const seed = readSeed(file);
  if (!seed) return 0;
  const r = await new FactVault(db).importAll(seed);
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('factvault_seeded', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [new Date().toISOString()],
  );
  log("info", "fact vault seeded", r);
  return r.facts;
}

let running = false;

export async function vaultHousekeeping(
  db: Db,
  cfg: { factVault: FactVaultMode; timezone: string; factVaultNightly: number },
  now = new Date(),
): Promise<void> {
  if (!vaultReads(cfg.factVault) || running) return;
  running = true;
  try {
    await seedOnce(db);
    if (!vaultWrites(cfg.factVault)) return;
    const day = await integrityDue(db, cfg.timezone, now);
    if (!day) return;
    const report = await runIntegrity(new FactVault(db), readPage, {
      now,
      limit: cfg.factVaultNightly,
      prices: steamPrices,
    });
    await markIntegrity(db, day, report);
    log("info", "fact vault integrity run", { ...report });
  } catch (err) {
    log("warn", "fact vault housekeeping failed", { error: errorMessage(err) });
  } finally {
    running = false;
  }
}
