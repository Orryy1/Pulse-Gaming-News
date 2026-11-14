// A restore point for the factory, made by the factory itself (it holds the database): a consistent
// snapshot of the embedded database, the settings file, the social and tunnel credentials and the admin
// state, packed into one archive, encrypted with APP_SECRET and copied off the PC (BACKUP_DIR: the
// owner's Google Drive folder). Media is not included: episodes can be re-rendered, and published videos
// live on YouTube. Nightly at 03:00 local; src/tools/backup.ts --verify restores the newest one into a
// scratch folder to prove it can be read.
//
// Encryption: AES-256-GCM, key = SHA-256(APP_SECRET), 12-byte IV first, 16-byte tag last. Without the
// settings file's APP_SECRET the archive is noise, so that secret must also live somewhere safe that is
// not this PC (a password manager).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Db } from "./db.ts";
import { log } from "./lib/util.ts";

export const KEEP_DAYS = 30;

/** The tar that takes this machine's paths: Windows' own on Windows (Git's wants /c/ paths), tar elsewhere. */
export const TAR = process.platform === "win32" ? "C:/Windows/System32/tar.exe" : "tar";

export function backupKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptFile(src: string, dest: string, key: Buffer): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([
    cipher.update(fs.readFileSync(src)),
    cipher.final(),
  ]);
  fs.writeFileSync(dest, Buffer.concat([iv, body, cipher.getAuthTag()]));
}

export function decryptFile(src: string, dest: string, key: Buffer): void {
  const buf = fs.readFileSync(src);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    buf.subarray(0, 12),
  );
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  fs.writeFileSync(
    dest,
    Buffer.concat([
      decipher.update(buf.subarray(12, buf.length - 16)),
      decipher.final(),
    ]),
  );
}

/** The files a restore needs beside the database, as [source, name in the archive]. */
export function backupFiles(
  dataDir: string,
  extra: { tiktokTokenPath?: string; tunnelConfig?: string } = {},
): Array<[string, string]> {
  const files: Array<[string, string]> = [
    [path.resolve(".env"), "env"],
    [path.join(dataDir, "tiktok-session.json"), "tiktok-session.json"],
    [path.join(os.homedir(), ".cloudflared"), "cloudflared"],
    [path.join(dataDir, "admin"), "admin"],
  ];
  if (extra.tunnelConfig)
    files.push([extra.tunnelConfig, "cloudflared-pulse.yml"]);
  if (extra.tiktokTokenPath)
    files.push([path.resolve(extra.tiktokTokenPath), "tiktok-token.json"]);
  return files;
}

/** Makes one encrypted restore point in `outDir` and prunes those older than KEEP_DAYS. Returns its path. */
export async function makeBackup(
  db: Db,
  o: {
    dataDir: string;
    outDir: string;
    secret: string;
    tiktokTokenPath?: string;
    tunnelConfig?: string;
    now?: Date;
  },
): Promise<string> {
  if (!db.snapshot) throw new Error("backups need the embedded database");
  const now = o.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-backup-"));
  try {
    fs.writeFileSync(path.join(work, "db.tar.gz"), await db.snapshot());
    for (const [src, name] of backupFiles(o.dataDir, o)) {
      if (fs.existsSync(src))
        fs.cpSync(src, path.join(work, name), { recursive: true });
    }
    fs.writeFileSync(
      path.join(work, "MANIFEST.json"),
      JSON.stringify(
        {
          at: now.toISOString(),
          host: os.hostname(),
          dataDir: o.dataDir,
          files: fs.readdirSync(work).sort(),
        },
        null,
        2,
      ),
    );
    const tar = path.join(os.tmpdir(), `pulse-${stamp}.tar`);
    execFileSync(TAR, ["-cf", tar, "-C", work, "."]);
    fs.mkdirSync(o.outDir, { recursive: true });
    const dest = path.join(o.outDir, `pulse-${stamp}.tar.enc`);
    encryptFile(tar, dest, backupKey(o.secret));
    fs.rmSync(tar, { force: true });
    for (const f of fs.readdirSync(o.outDir)) {
      const m = f.match(/^pulse-(\d{4}-\d{2}-\d{2})T.*\.tar\.enc$/);
      if (
        m &&
        now.getTime() - new Date(m[1]!).getTime() > KEEP_DAYS * 86_400_000
      )
        fs.rmSync(path.join(o.outDir, f), { force: true });
    }
    return dest;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** True once a day from 03:00 local until a backup is recorded for that day; returns the day key. */
export async function backupDue(
  db: Db,
  timezone: string,
  now: Date,
): Promise<string | undefined> {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(
    f.formatToParts(now).map((x) => [x.type, x.value]),
  );
  if (Number(p.hour) < 3) return undefined;
  const day = `${p.year}-${p.month}-${p.day}`;
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'backup_day'`,
  );
  return row?.value === day ? undefined : day;
}

export async function markBackup(
  db: Db,
  day: string,
  file: string,
): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('backup_day', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [day],
  );
  await db.query(
    `INSERT INTO events (episode_id, kind, detail) VALUES (NULL, 'backup', $1)`,
    [JSON.stringify({ file })],
  );
  log("info", "backup written", { file });
}
