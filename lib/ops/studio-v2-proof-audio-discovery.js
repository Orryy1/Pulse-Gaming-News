"use strict";

const fsDefault = require("fs-extra");
const path = require("node:path");

const FLASH_MIN_SECONDS = 61;
const FLASH_MAX_SECONDS = 75;
const DEFAULT_AUDIO_DISCOVERY_DIRS = [
  {
    relDir: path.join("test", "output", "local-media-repair", "audio"),
    fileRe: /^(.+)_liam\.mp3$/i,
  },
  {
    relDir: path.join("test", "output", "local-script-extension", "audio"),
    fileRe: /^(.+)_liam_extended\.mp3$/i,
  },
];

function normaliseRel(relPath) {
  return String(relPath || "").replace(/\\/g, "/");
}

function uniqueRoots(roots) {
  const seen = new Set();
  const out = [];
  for (const root of roots) {
    const resolved = root ? path.resolve(root) : null;
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function durationVerdict(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return "unknown_duration";
  if (value < FLASH_MIN_SECONDS) return "reject_duration";
  if (value > FLASH_MAX_SECONDS) return "reject_duration";
  return "pass";
}

async function discoverLocalAudioProofReport({
  mediaRoot = process.env.MEDIA_ROOT || null,
  repoRoot = path.resolve(__dirname, "..", ".."),
  fs = fsDefault,
  durationProbe,
  now = new Date(),
  discoveryDirs = DEFAULT_AUDIO_DISCOVERY_DIRS,
} = {}) {
  const roots = uniqueRoots([mediaRoot, repoRoot]);
  const appliedByStory = new Map();
  const skipped = [];

  for (const root of roots) {
    for (const config of discoveryDirs) {
      const absDir = path.join(root, config.relDir);
      if (!(await fs.pathExists(absDir))) continue;
      const entries = await fs.readdir(absDir);
      for (const entry of entries) {
        const match = String(entry).match(config.fileRe);
        if (!match) continue;
        const storyId = match[1];
        const absPath = path.join(absDir, entry);
        let durationSeconds = null;
        try {
          durationSeconds = typeof durationProbe === "function" ? Number(durationProbe(absPath)) : null;
        } catch (err) {
          skipped.push({
            story_id: storyId,
            output_audio_path: normaliseRel(path.join(config.relDir, entry)),
            reason: "duration_probe_failed",
            error: String(err?.message || err || "unknown_error").slice(0, 240),
          });
          continue;
        }
        const timestampsName = entry.replace(/\.(mp3|wav|m4a)$/i, "_timestamps.json");
        const timestampsAbs = path.join(absDir, timestampsName);
        const outputAudioPath = normaliseRel(path.join(config.relDir, entry));
        const item = {
          story_id: storyId,
          output_audio_path: outputAudioPath,
          timestamps_path: (await fs.pathExists(timestampsAbs))
            ? normaliseRel(path.join(config.relDir, timestampsName))
            : null,
          duration_seconds: Number.isFinite(durationSeconds)
            ? Number(durationSeconds.toFixed(3))
            : null,
          duration_verdict: durationVerdict(durationSeconds),
          source: "discovered_local_liam_audio_file",
        };
        const current = appliedByStory.get(storyId);
        if (!current || Number(item.duration_seconds || 0) > Number(current.duration_seconds || 0)) {
          appliedByStory.set(storyId, item);
        }
      }
    }
  }

  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    source: "local_audio_file_discovery",
    applied: [...appliedByStory.values()],
    skipped,
    safety: {
      local_only: true,
      reads_existing_audio_files: true,
      writes_files: false,
      mutates_production_db: false,
      mutates_tokens: false,
      mutates_railway_env: false,
      triggers_oauth: false,
      posts_to_platforms: false,
    },
  };
}

module.exports = {
  DEFAULT_AUDIO_DISCOVERY_DIRS,
  discoverLocalAudioProofReport,
};
