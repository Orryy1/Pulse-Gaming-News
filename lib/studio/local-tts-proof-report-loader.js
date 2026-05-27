"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const PROOF_SOURCES = [
  {
    source: "local_media_repair",
    latestFile: "local_media_repair_audio_apply.json",
    historyDir: path.join("local-media-repair", "audio-apply-history"),
  },
  {
    source: "local_script_extension",
    latestFile: "local_script_extension_audio_apply.json",
    historyDir: path.join("local-script-extension", "audio-apply-history"),
  },
];

function safePart(value) {
  return String(value || "unknown")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "unknown";
}

function safeTimestamp(value) {
  const raw = String(value || new Date().toISOString());
  return raw.replace(/[^0-9TZ]+/gi, "");
}

function proofHistoryFileName({ source, generatedAt, storyId } = {}) {
  return `${safeTimestamp(generatedAt)}_${safePart(source)}_${safePart(storyId)}.json`;
}

function rowsFor(report = {}) {
  return [
    ...(Array.isArray(report.applied) ? report.applied : []),
    ...(Array.isArray(report.skipped) ? report.skipped : []),
  ];
}

function reportKey(source, report = {}) {
  const rows = rowsFor(report);
  const rowKey = rows
    .map((row) => `${row.story_id || "unknown"}:${row.output_audio_path || row.resolved_audio_path || row.reason || ""}`)
    .sort()
    .join("|");
  return `${source}:${rowKey}`;
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return null;
  return fs.readJson(filePath);
}

async function loadSourceReports({ outDir, source, latestFile, historyDir }) {
  const reports = [];
  const latest = await readJsonIfExists(path.join(outDir, latestFile));
  if (latest) reports.push({ source, report: latest });

  const absoluteHistoryDir = path.join(outDir, historyDir);
  if (await fs.pathExists(absoluteHistoryDir)) {
    const files = (await fs.readdir(absoluteHistoryDir))
      .filter((name) => /\.json$/i.test(name))
      .sort();
    for (const file of files) {
      const report = await readJsonIfExists(path.join(absoluteHistoryDir, file));
      if (report) reports.push({ source, report });
    }
  }
  return reports;
}

async function loadLocalTtsProofReports({ outDir } = {}) {
  const root = path.resolve(outDir || path.join(process.cwd(), "test", "output"));
  const allReports = [];
  for (const sourceConfig of PROOF_SOURCES) {
    allReports.push(...(await loadSourceReports({ outDir: root, ...sourceConfig })));
  }

  const byKey = new Map();
  for (const entry of allReports) {
    const key = reportKey(entry.source, entry.report);
    if (!rowsFor(entry.report).length || byKey.has(key)) continue;
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}

async function archiveLocalTtsProofReport({ outDir, source, report } = {}) {
  if (!report || typeof report !== "object") return null;
  const sourceConfig = PROOF_SOURCES.find((entry) => entry.source === source);
  if (!sourceConfig) {
    throw new Error(`unknown local TTS proof source: ${source || "unknown"}`);
  }
  const rows = rowsFor(report);
  const storyId = rows[0]?.story_id || "batch";
  const historyDir = path.join(path.resolve(outDir), sourceConfig.historyDir);
  await fs.ensureDir(historyDir);
  const filePath = path.join(
    historyDir,
    proofHistoryFileName({
      source,
      generatedAt: report.generated_at,
      storyId,
    }),
  );
  await fs.writeJson(filePath, report, { spaces: 2 });
  return filePath;
}

module.exports = {
  archiveLocalTtsProofReport,
  loadLocalTtsProofReports,
  proofHistoryFileName,
};
