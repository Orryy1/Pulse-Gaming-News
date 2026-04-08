/**
 * Automated SQLite database backup.
 * Runs every 24 hours via cron. Creates a WAL checkpoint first,
 * then copies the DB file to a timestamped backup location.
 *
 * Supports: local backup (always), S3 backup (if AWS credentials configured).
 */

const fs = require("fs-extra");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "pulse.db");
const BACKUP_DIR = path.join(__dirname, "..", "data", "backups");
const MAX_LOCAL_BACKUPS = 7; // Keep last 7 daily backups

async function backupDatabase() {
  console.log("[db-backup] Starting database backup...");

  if (!(await fs.pathExists(DB_PATH))) {
    console.log("[db-backup] No database file found, skipping backup");
    return null;
  }

  // Step 1: Checkpoint the WAL to ensure all data is in the main DB file
  try {
    const db = require("./db");
    if (db.checkpoint) {
      db.checkpoint();
    }
  } catch (err) {
    console.log(`[db-backup] WAL checkpoint warning: ${err.message}`);
  }

  // Step 2: Create local backup with timestamp
  await fs.ensureDir(BACKUP_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupFilename = `pulse_${timestamp}.db`;
  const backupPath = path.join(BACKUP_DIR, backupFilename);

  await fs.copy(DB_PATH, backupPath);
  const stat = await fs.stat(backupPath);
  console.log(
    `[db-backup] Local backup: ${backupPath} (${Math.round(stat.size / 1024)}KB)`,
  );

  // Step 3: Prune old local backups (keep last MAX_LOCAL_BACKUPS)
  const backups = (await fs.readdir(BACKUP_DIR))
    .filter((f) => f.startsWith("pulse_") && f.endsWith(".db"))
    .sort()
    .reverse();

  if (backups.length > MAX_LOCAL_BACKUPS) {
    const toDelete = backups.slice(MAX_LOCAL_BACKUPS);
    for (const old of toDelete) {
      await fs.remove(path.join(BACKUP_DIR, old));
      console.log(`[db-backup] Pruned old backup: ${old}`);
    }
  }

  // Step 4: S3 upload (if configured)
  if (process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
    try {
      const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
      const s3 = new S3Client({
        region: process.env.AWS_REGION || "eu-west-2",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });

      const fileBuffer = await fs.readFile(backupPath);
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: `pulse-gaming/backups/${backupFilename}`,
          Body: fileBuffer,
        }),
      );

      console.log(
        `[db-backup] S3 upload complete: s3://${process.env.AWS_S3_BUCKET}/pulse-gaming/backups/${backupFilename}`,
      );
    } catch (err) {
      console.log(`[db-backup] S3 upload failed (non-fatal): ${err.message}`);
    }
  }

  console.log("[db-backup] Backup complete");
  return backupPath;
}

module.exports = { backupDatabase };
