"use strict";

const { execFileSync: defaultExecFileSync } = require("node:child_process");

const FRAME_WIDTH = 9;
const FRAME_HEIGHT = 8;
const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT;
const DEFAULT_MAX_HAMMING_DISTANCE = 6;
const DEFAULT_MIN_MATCH_RATIO = 0.6;

function cleanText(value) {
  return String(value || "").trim();
}

function frameDifferenceHash(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < FRAME_BYTES) return "";
  let bits = "";
  for (let row = 0; row < FRAME_HEIGHT; row += 1) {
    const offset = row * FRAME_WIDTH;
    for (let column = 0; column < FRAME_WIDTH - 1; column += 1) {
      bits += frame[offset + column] > frame[offset + column + 1] ? "1" : "0";
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

function hammingDistance(left, right) {
  const leftText = cleanText(left);
  const rightText = cleanText(right);
  if (!/^[0-9a-f]{16}$/i.test(leftText) || !/^[0-9a-f]{16}$/i.test(rightText)) {
    return Number.POSITIVE_INFINITY;
  }
  let value = BigInt(`0x${leftText}`) ^ BigInt(`0x${rightText}`);
  let distance = 0;
  while (value) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}

function normaliseFingerprint(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const signature = cleanText(value);
    return signature ? { algorithm: "opaque-test-signature", signature, hashes: [] } : null;
  }
  const hashes = Array.isArray(value.hashes)
    ? value.hashes.map(cleanText).filter((hash) => /^[0-9a-f]{16}$/i.test(hash))
    : [];
  const signature = cleanText(value.signature);
  if (!hashes.length && !signature) return null;
  return {
    algorithm: cleanText(value.algorithm) || "temporal-dhash-9x8-v1",
    signature,
    hashes,
    sample_count: Number(value.sample_count || hashes.length || 0),
  };
}

function compareVideoFingerprints(leftValue, rightValue, {
  maxHammingDistance = DEFAULT_MAX_HAMMING_DISTANCE,
  minMatchRatio = DEFAULT_MIN_MATCH_RATIO,
} = {}) {
  const left = normaliseFingerprint(leftValue);
  const right = normaliseFingerprint(rightValue);
  if (!left || !right) return { near_duplicate: false, reason: "fingerprint_missing" };

  if (left.signature && right.signature && (!left.hashes.length || !right.hashes.length)) {
    return {
      near_duplicate: left.signature === right.signature,
      reason: left.signature === right.signature ? "opaque_signature_match" : "opaque_signature_mismatch",
      matched_frames: left.signature === right.signature ? 1 : 0,
      required_matches: 1,
    };
  }

  const rightAvailable = right.hashes.map((hash, index) => ({ hash, index, used: false }));
  let matchedFrames = 0;
  const distances = [];
  for (const leftHash of left.hashes) {
    const match = rightAvailable
      .filter((item) => !item.used)
      .map((item) => ({ ...item, distance: hammingDistance(leftHash, item.hash) }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index)[0];
    if (!match || match.distance > maxHammingDistance) continue;
    rightAvailable[match.index].used = true;
    matchedFrames += 1;
    distances.push(match.distance);
  }

  const comparableFrames = Math.min(left.hashes.length, right.hashes.length);
  const requiredMatches = Math.max(2, Math.ceil(comparableFrames * minMatchRatio));
  const nearDuplicate = comparableFrames >= 2 && matchedFrames >= requiredMatches;
  return {
    near_duplicate: nearDuplicate,
    reason: nearDuplicate ? "temporal_dhash_match" : "temporal_dhash_mismatch",
    matched_frames: matchedFrames,
    comparable_frames: comparableFrames,
    required_matches: requiredMatches,
    max_hamming_distance: maxHammingDistance,
    observed_distances: distances,
  };
}

function fingerprintVideoClip(clip = {}, {
  execFileSync = defaultExecFileSync,
  frameRate = 1,
  maxFrames = 5,
} = {}) {
  const filePath = cleanText(clip.path || clip.file_path || clip.local_path || clip);
  if (!filePath) return null;
  let raw;
  try {
    raw = execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-vf",
      `fps=${frameRate},scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:flags=area,format=gray`,
      "-frames:v",
      String(maxFrames),
      "-f",
      "rawvideo",
      "-",
    ], {
      encoding: null,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
  if (!Buffer.isBuffer(raw) || raw.length < FRAME_BYTES * 2) return null;
  const frameCount = Math.min(maxFrames, Math.floor(raw.length / FRAME_BYTES));
  const hashes = [];
  for (let index = 0; index < frameCount; index += 1) {
    const start = index * FRAME_BYTES;
    const hash = frameDifferenceHash(raw.subarray(start, start + FRAME_BYTES));
    if (hash) hashes.push(hash);
  }
  if (hashes.length < 2) return null;
  return {
    algorithm: "temporal-dhash-9x8-v1",
    signature: hashes.join(":"),
    hashes,
    sample_count: hashes.length,
  };
}

module.exports = {
  fingerprintVideoClip,
  compareVideoFingerprints,
  _private: {
    frameDifferenceHash,
    hammingDistance,
    normaliseFingerprint,
  },
};
