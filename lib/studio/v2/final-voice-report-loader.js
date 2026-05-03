"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { storyIdFromPath } = require("./final-voice-audit");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_OUTPUT_DIRS = [path.join(ROOT, "test", "output")];

async function safeReadJson(file) {
  try {
    if (await fs.pathExists(file)) return await fs.readJson(file);
  } catch (_) {
    return null;
  }
  return null;
}

function directReportCandidates(id, dirs) {
  const names = [
    `${id}.voice.json`,
    `${id}.render_manifest.json`,
    `${id}.json`,
    `${id}_studio_v2_report.json`,
    `${id}_qa.json`,
  ];
  return dirs.flatMap((dir) => names.map((name) => path.join(dir, name)));
}

function looksLikeReportForStory(id, fileName) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}.*(?:voice|render_manifest|studio_v2_report|qa|report)\\.json$`, "i").test(
    fileName,
  );
}

async function scanReportDir(id, dir, depth = 2) {
  if (depth < 0 || !(await fs.pathExists(dir))) return null;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && looksLikeReportForStory(id, entry.name)) {
      const json = await safeReadJson(full);
      if (json) return json;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const json = await scanReportDir(id, path.join(dir, entry.name), depth - 1);
    if (json) return json;
  }
  return null;
}

async function loadFinalVoiceReportsByStoryId(files, opts = {}) {
  const outputDirs =
    Array.isArray(opts.outputDirs) && opts.outputDirs.length
      ? opts.outputDirs
      : DEFAULT_OUTPUT_DIRS;
  const reports = {};
  for (const file of Array.isArray(files) ? files : []) {
    const id = storyIdFromPath(file);
    const finalDir = opts.finalDir || path.dirname(file);
    const dirs = [
      finalDir,
      ...outputDirs,
    ]
      .filter(Boolean)
      .map((dir) => path.resolve(dir));
    for (const candidate of directReportCandidates(id, dirs)) {
      const json = await safeReadJson(candidate);
      if (json) {
        reports[id] = json;
        break;
      }
    }
    if (!reports[id]) {
      for (const dir of dirs) {
        const json = await scanReportDir(id, dir);
        if (json) {
          reports[id] = json;
          break;
        }
      }
    }
  }
  return reports;
}

module.exports = {
  loadFinalVoiceReportsByStoryId,
};
