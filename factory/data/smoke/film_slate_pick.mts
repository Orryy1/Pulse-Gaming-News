// What the documentary picker chooses, on a copy of the database with live Steam, Wikipedia and YouTube search reads
// (no model call): node --import tsx data/smoke/film_slate_pick.mts <db copy> [--single]
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../../src/db.ts";
import { rankBreakoutDocs } from "../../src/docpick.ts";
import { findSteamApp, steamFacts } from "../../src/assets/steam.ts";
import { researchGame } from "../../src/discovery/wikipedia.ts";
const pg = new PGlite(process.argv[2]!);
const db: Db = {
  query: async <T,>(sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as T[],
  exec: async (sql: string) => void (await pg.exec(sql)),
  close: () => pg.close(),
} as Db;
const single = process.argv.includes("--single");
const ranked = await rankBreakoutDocs(
  { db, findGame: findSteamApp, gameFacts: steamFacts, research: researchGame } as never,
  { now: new Date(), lookups: 20, offline: process.argv.includes("--offline"), singleSubject: single },
);
for (const r of ranked.slice(0, 14))
  console.log(`${r.total.toFixed(3)} ${r.candidate.kind.padEnd(9)} ${r.candidate.subject.padEnd(34)} ${r.excluded ? "EXCLUDED " : ""}${JSON.stringify(r.parts)}`);
console.log("franchise share of top 5:", ranked.filter((r) => !r.excluded).slice(0, 5).filter((r) => r.candidate.kind === "franchise").length);
await pg.close();
