"use strict";

const crypto = require("node:crypto");
const fs = require("fs-extra");

function clean(value) {
  return String(value || "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normaliseFingerprint(value) {
  const text = clean(value);
  if (!text) return "";
  if (/^sha256:/i.test(text)) return `sha256:${text.slice("sha256:".length).toLowerCase()}`;
  if (/^[a-f0-9]{64}$/i.test(text)) return `sha256:${text.toLowerCase()}`;
  return text;
}

function fingerprintFile(filePath) {
  const target = clean(filePath);
  if (!target) return { path: target, exists: false, sha256: "", size_bytes: 0 };
  if (!fs.existsSync(target)) return { path: target, exists: false, sha256: "", size_bytes: 0 };
  const buffer = fs.readFileSync(target);
  return {
    path: target,
    exists: true,
    sha256: `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`,
    size_bytes: buffer.length,
  };
}

function fingerprintArtefacts(artefacts = {}, keys = []) {
  return Object.fromEntries(
    asArray(keys).map((key) => [key, fingerprintFile(artefacts[key])]),
  );
}

function compactFingerprintMap(fingerprints = {}) {
  const compact = {};
  for (const [key, value] of Object.entries(fingerprints || {})) {
    if (typeof value === "string") {
      const hash = normaliseFingerprint(value);
      if (hash) compact[key] = hash;
    } else {
      const hash = normaliseFingerprint(value?.sha256 || value?.hash || value?.fingerprint);
      if (hash) compact[key] = hash;
    }
  }
  return compact;
}

function parseFingerprintList(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return compactFingerprintMap(value);
  }
  const out = {};
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  for (const item of items) {
    const text = clean(item);
    if (!text) continue;
    const separator = text.includes("=") ? "=" : text.includes(":sha256:") ? ":sha256:" : "";
    if (separator === "=") {
      const [key, rawHash] = text.split("=", 2);
      const hash = normaliseFingerprint(rawHash);
      if (clean(key) && hash) out[clean(key)] = hash;
    } else if (separator === ":sha256:") {
      const [key, rawHash] = text.split(":sha256:", 2);
      const hash = normaliseFingerprint(`sha256:${rawHash}`);
      if (clean(key) && hash) out[clean(key)] = hash;
    }
  }
  return out;
}

function serialiseFingerprintMap(fingerprints = {}) {
  return Object.entries(compactFingerprintMap(fingerprints))
    .map(([key, hash]) => `${key}=${hash}`)
    .join(",");
}

function fingerprintValidationBlockers({
  artefacts = {},
  reviewedFingerprints = {},
  keys = [],
} = {}) {
  const blockers = [];
  const reviewed = compactFingerprintMap(reviewedFingerprints);
  for (const key of asArray(keys)) {
    const file = fingerprintFile(artefacts[key]);
    const reviewedHash = normaliseFingerprint(reviewed[key]);
    if (!file.path) {
      blockers.push(`required_artefact_missing:${key}`);
      continue;
    }
    if (!file.exists) {
      blockers.push(`required_artefact_file_missing:${key}`);
      continue;
    }
    if (!reviewedHash) {
      blockers.push(`reviewed_artefact_fingerprint_missing:${key}`);
      continue;
    }
    if (reviewedHash !== file.sha256) {
      blockers.push(`reviewed_artefact_fingerprint_mismatch:${key}`);
    }
  }
  return [...new Set(blockers)];
}

module.exports = {
  compactFingerprintMap,
  fingerprintArtefacts,
  fingerprintFile,
  fingerprintValidationBlockers,
  normaliseFingerprint,
  parseFingerprintList,
  serialiseFingerprintMap,
};
