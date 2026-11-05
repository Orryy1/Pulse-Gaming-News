// Stored file paths after the factory changes machine (31 Oct and 4 Nov 2026 audits). Episodes made on Windows hold
// relative paths with backslashes ("assets\clip_0.mp4", 108 episodes), which on the Mac are a single odd file name, and
// the A/B lists hold absolute ones (C:\PulseFactory\...\thumb_hero.jpg). Forward slashes work on both machines, so
// this is safe in either direction.
//   node --import tsx src/tools/relocate-paths.ts            says what it would change
//   node --import tsx src/tools/relocate-paths.ts --write    changes the database and data/abtests/*.json
//   ... --to-pc                                              the Mac's absolute paths back to the PC's (mac/rollback.sh)
// Only while the factory is stopped: it opens the database itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PathMap {
  from: RegExp;
  to: string;
}

const BS = String.fromCharCode(92);
const PC_DATA = new RegExp(
  `^[Cc]:[${BS}${BS}/]+PulseFactory[${BS}${BS}/]+factory[${BS}${BS}/]+data[${BS}${BS}/]+`,
);
const PC_VIDEOS = new RegExp(
  `^[Cc]:[${BS}${BS}/]+Users[${BS}${BS}/]+MORR[${BS}${BS}/]+Videos[${BS}${BS}/]+`,
);
/** A relative path with backslashes: no drive, no spaces, only file-name characters, so never a sentence. */
const RELATIVE = new RegExp(`^[A-Za-z0-9_.-]+(${BS}${BS}[A-Za-z0-9_.-]+)+$`);

/** The rules for this move (pure). `dataDir` and `home` are the Mac's. */
export function toMacRules(dataDir: string, home: string): PathMap[] {
  return [
    { from: PC_DATA, to: `${dataDir.replace(/\/$/, "")}/` },
    { from: PC_VIDEOS, to: `${home.replace(/\/$/, "")}/Videos/` },
  ];
}

export function toPcRules(dataDir: string, home: string): PathMap[] {
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]/\\]/g, "\\$&");
  return [
    {
      from: new RegExp(`^${esc(dataDir.replace(/\/$/, ""))}/`),
      to: "C:/PulseFactory/factory/data/",
    },
    {
      from: new RegExp(`^${esc(home.replace(/\/$/, ""))}/Videos/`),
      to: "C:/Users/MORR/Videos/",
    },
  ];
}

/** One string as it should now read (pure). Anything that is not recognisably a path is left exactly as it is. */
export function relocateString(value: string, rules: PathMap[]): string {
  for (const r of rules)
    if (r.from.test(value))
      return value.replace(r.from, r.to).split(BS).join("/");
  return RELATIVE.test(value) ? value.split(BS).join("/") : value;
}

/** Every string inside a JSON value, with how many changed (pure). Object keys are left alone. */
export function relocateJson(
  value: unknown,
  rules: PathMap[],
): { value: unknown; changed: number } {
  let changed = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const n = relocateString(v, rules);
      if (n !== v) changed++;
      return n;
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
  return { value: walk(value), changed };
}

const COLUMNS = ["assets_json", "story_json", "qa_json"] as const;

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const toPc = process.argv.includes("--to-pc");
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const { loadConfig } = await import("../config.ts");
  const { openDb } = await import("../db.ts");
  const cfg = loadConfig();
  const rules = toPc
    ? toPcRules(cfg.dataDir, os.homedir())
    : toMacRules(cfg.dataDir, os.homedir());
  const db = await openDb(cfg.databaseUrl, cfg.dataDir);
  let rows = 0;
  let strings = 0;
  for (const col of COLUMNS) {
    const list = await db.query<{ id: string; v: unknown }>(
      `SELECT id, ${col} AS v FROM episodes WHERE ${col} IS NOT NULL`,
    );
    for (const r of list) {
      const out = relocateJson(r.v, rules);
      if (!out.changed) continue;
      rows++;
      strings += out.changed;
      if (write)
        await db.query(`UPDATE episodes SET ${col} = $1::jsonb WHERE id = $2`, [
          JSON.stringify(out.value),
          r.id,
        ]);
    }
  }
  await db.close();
  let files = 0;
  const abtests = path.join(cfg.dataDir, "abtests");
  for (const name of fs.existsSync(abtests) ? fs.readdirSync(abtests) : []) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(abtests, name);
    const out = relocateJson(JSON.parse(fs.readFileSync(file, "utf8")), rules);
    if (!out.changed) continue;
    files++;
    if (write) fs.writeFileSync(file, JSON.stringify(out.value, null, 2));
  }
  console.log(
    `${write ? "changed" : "would change"} ${strings} paths in ${rows} database fields and ${files} A/B files`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
