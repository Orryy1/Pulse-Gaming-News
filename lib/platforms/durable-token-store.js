"use strict";

const crypto = require("node:crypto");
const fs = require("fs-extra");
const path = require("node:path");

function mergeRotatedToken(previous = {}, next = {}) {
  const merged = { ...previous, ...next };
  if (
    (!next.refresh_token || typeof next.refresh_token !== "string") &&
    typeof previous.refresh_token === "string" &&
    previous.refresh_token
  ) {
    merged.refresh_token = previous.refresh_token;
  }
  return merged;
}

async function writeTokenJsonAtomic(tokenPath, token) {
  if (!tokenPath) throw new Error("tokenPath is required");
  const dir = path.dirname(tokenPath);
  await fs.ensureDir(dir);
  const tempPath = path.join(
    dir,
    `.${path.basename(tokenPath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );
  try {
    await fs.writeJson(tempPath, token, { spaces: 2 });
    await fs.move(tempPath, tokenPath, { overwrite: true });
    await fs.chmod(tokenPath, 0o600).catch(() => {});
  } finally {
    await fs.remove(tempPath).catch(() => {});
  }
}

module.exports = {
  mergeRotatedToken,
  writeTokenJsonAtomic,
};
