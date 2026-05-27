"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_ACCEPTED_LOCAL_VOICE_ID = "pulse-sleepy-liam-20260502";
const DEFAULT_ACCEPTED_LOCAL_VOICE_FILE = path.join(
  "tts_server",
  "voices",
  "pulse_liam_sleepy.wav",
);

function sha1FileIfPresent(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function resolveReferencePath(rawFile) {
  const value = String(rawFile || DEFAULT_ACCEPTED_LOCAL_VOICE_FILE).trim();
  if (path.isAbsolute(value)) return value;
  return path.resolve(repoRoot(), value);
}

function resolveAcceptedLocalVoiceReference(env = process.env) {
  const rawId = String(
    env.STUDIO_V2_LOCAL_VOICE_REFERENCE_ID || DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
  ).trim();
  const rawFile = String(
    env.STUDIO_V2_LOCAL_VOICE_REFERENCE_FILE || DEFAULT_ACCEPTED_LOCAL_VOICE_FILE,
  ).trim();
  const absoluteFile = resolveReferencePath(rawFile);
  const referenceHash = sha1FileIfPresent(absoluteFile);
  return {
    id: rawId || DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
    fileName: path.basename(rawFile || DEFAULT_ACCEPTED_LOCAL_VOICE_FILE),
    referencePresent: Boolean(referenceHash),
    referenceHash,
  };
}

module.exports = {
  DEFAULT_ACCEPTED_LOCAL_VOICE_FILE,
  DEFAULT_ACCEPTED_LOCAL_VOICE_ID,
  resolveAcceptedLocalVoiceReference,
  resolveReferencePath,
};
