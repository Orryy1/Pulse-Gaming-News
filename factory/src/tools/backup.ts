// Backup tooling for the owner and Claude. The nightly restore point is made by the running factory
// (src/backup.ts); this tool proves a backup can be restored, and makes one by hand when the factory
// is stopped.
//
//   node --import tsx src/tools/backup.ts --verify   restore the newest backup into a scratch folder and
//                                                    open its database read-only (no factory, no publishing)
//   node --import tsx src/tools/backup.ts            make a backup now (only while the factory is stopped;
//                                                    a running factory holds the database)
process.loadEnvFile(".env");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { backupKey, decryptFile, makeBackup, TAR } from "../backup.ts";
import { createEmbeddedDb } from "../db.ts";

const SECRET = process.env.APP_SECRET ?? "";
const DATA = path.resolve(process.env.DATA_DIR ?? "data");
const OUT = process.env.BACKUP_DIR ?? "G:/My Drive/Pulse backups";
if (!SECRET) throw new Error("APP_SECRET must be set");

/** Restores the newest backup into a scratch folder and reads it, proving it can be restored. */
async function verify(): Promise<void> {
  const newest = fs
    .readdirSync(OUT)
    .filter((f) => f.endsWith(".tar.enc"))
    .sort()
    .at(-1);
  if (!newest) throw new Error(`no backups in ${OUT}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-restore-"));
  try {
    const tar = path.join(work, "backup.tar");
    decryptFile(path.join(OUT, newest), tar, backupKey(SECRET));
    execFileSync(TAR, ["-xf", tar, "-C", work]);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(work, "MANIFEST.json"), "utf8"),
    ) as { at: string; files: string[] };
    const dbDir = path.join(work, "db");
    fs.mkdirSync(dbDir);
    // PGlite loads a data-dir dump straight from the archive blob.
    const blob = new Blob([fs.readFileSync(path.join(work, "db.tar.gz"))]);
    const db = await PGlite.create(dbDir, { loadDataDir: blob });
    try {
      const count = async (sql: string) =>
        (await db.query<{ n: string }>(sql)).rows[0]!.n;
      const eps = await count(`SELECT count(*)::text AS n FROM episodes`);
      const pub = await count(
        `SELECT count(*)::text AS n FROM episodes WHERE status = 'published' AND youtube_video_id IS NOT NULL`,
      );
      const pending = await count(
        `SELECT count(*)::text AS n FROM episodes WHERE status IN ('approved','uploading','uploaded')`,
      );
      const token = await count(
        `SELECT count(*)::text AS n FROM settings WHERE key = 'youtube_refresh_token'`,
      );
      const envOk =
        fs.existsSync(path.join(work, "env")) &&
        /APP_SECRET=/.test(fs.readFileSync(path.join(work, "env"), "utf8"));
      console.log(
        `restore verified from ${newest} (taken ${manifest.at}): ${eps} episodes, ${pub} published with YouTube ids, ${pending} pending; YouTube login ${token === "1" ? "present" : "MISSING"}; settings file ${envOk ? "present" : "MISSING"}; files: ${manifest.files.join(", ")}`,
      );
      if (token !== "1" || !envOk) process.exitCode = 1;
    } finally {
      await db.close();
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function backupNow(): Promise<void> {
  const db = await createEmbeddedDb(path.join(DATA, "db"));
  try {
    const dest = await makeBackup(db, {
      dataDir: DATA,
      outDir: OUT,
      secret: SECRET,
      tiktokTokenPath: process.env.TIKTOK_TOKEN_PATH,
      tunnelConfig: "D:/pulse-data/cloudflared-pulse.yml",
    });
    console.log(
      `backup written: ${dest} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`,
    );
  } finally {
    await db.close();
  }
}

if (process.argv.includes("--verify")) await verify();
else await backupNow();
