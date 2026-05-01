"use strict";

const path = require("node:path");

function resolveStudioDbPath({ root = path.resolve(__dirname, "..", "..", ".."), env = process.env } = {}) {
  const explicit = String(env.STUDIO_V2_DB_PATH || env.SQLITE_DB_PATH || "").trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(root, explicit);
  }
  return path.join(root, "data", "pulse.db");
}

module.exports = {
  resolveStudioDbPath,
};
