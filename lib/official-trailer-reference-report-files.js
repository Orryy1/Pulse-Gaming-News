"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const DEFAULT_REPORT_BASENAME = "official_trailer_references_v1";

function safeFileSegment(value, fallback = "unknown") {
  const segment = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 96);
  return segment || fallback;
}

function reportStoryIds(report) {
  const seen = new Set();
  const ids = [];
  for (const plan of Array.isArray(report?.plans) ? report.plans : []) {
    const id = String(plan?.story_id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function reportTimestampSegment(report) {
  return safeFileSegment(report?.generated_at || new Date().toISOString(), "undated");
}

function reportSpecificStem(report, options = {}) {
  const basename = safeFileSegment(options.basename || DEFAULT_REPORT_BASENAME, DEFAULT_REPORT_BASENAME);
  const ids = reportStoryIds(report).map((id) => safeFileSegment(id));
  const timestamp = options.includeTimestamp === false ? null : reportTimestampSegment(report);
  const suffix = timestamp ? `_${timestamp}` : "";

  if (ids.length === 1) return `${basename}_story_${ids[0]}${suffix}`;
  if (ids.length === 0) return `${basename}_batch_empty${suffix}`;

  const joined = ids.join("_");
  if (joined.length <= 96) return `${basename}_batch_${ids.length}_${joined}${suffix}`;

  const hash = crypto.createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 12);
  return `${basename}_batch_${ids.length}_${hash}${suffix}`;
}

function stableStoryReportStem(storyId, options = {}) {
  const basename = safeFileSegment(options.basename || DEFAULT_REPORT_BASENAME, DEFAULT_REPORT_BASENAME);
  return `${basename}_story_${safeFileSegment(storyId)}`;
}

function storyReferenceReportRelativePath(storyId, extension = "json", options = {}) {
  const ext = safeFileSegment(extension || "json", "json").replace(/^\.+/, "") || "json";
  return `test/output/${stableStoryReportStem(storyId, options)}.${ext}`;
}

function buildOfficialTrailerReferenceReportPaths(report, options = {}) {
  const outputDir = path.resolve(options.outputDir || path.join(process.cwd(), "test", "output"));
  const basename = safeFileSegment(options.basename || DEFAULT_REPORT_BASENAME, DEFAULT_REPORT_BASENAME);
  const specificStem = reportSpecificStem(report, options);
  const ids = reportStoryIds(report);
  const aliasStem = ids.length === 1 ? stableStoryReportStem(ids[0], { basename }) : null;
  const canonicalJson = path.join(outputDir, `${basename}.json`);
  const canonicalMarkdown = path.join(outputDir, `${basename}.md`);
  const storyJson = path.join(outputDir, `${specificStem}.json`);
  const storyMarkdown = path.join(outputDir, `${specificStem}.md`);
  const storyAliasJson = aliasStem ? path.join(outputDir, `${aliasStem}.json`) : null;
  const storyAliasMarkdown = aliasStem ? path.join(outputDir, `${aliasStem}.md`) : null;

  return {
    outputDir,
    canonicalJson,
    canonicalMarkdown,
    storyJson,
    storyMarkdown,
    storyAliasJson,
    storyAliasMarkdown,
    specificJson: storyJson,
    specificMarkdown: storyMarkdown,
  };
}

async function writeOfficialTrailerReferenceReportFiles(report, markdown, options = {}) {
  const paths = buildOfficialTrailerReferenceReportPaths(report, options);
  await fs.ensureDir(paths.outputDir);
  await fs.writeJson(paths.storyJson, report, { spaces: 2 });
  await fs.writeFile(paths.storyMarkdown, markdown || "", "utf8");

  const shouldWriteStoryAlias = Boolean(paths.storyAliasJson) && paths.storyAliasJson !== paths.storyJson;
  if (shouldWriteStoryAlias) {
    await fs.writeJson(paths.storyAliasJson, report, { spaces: 2 });
    await fs.writeFile(paths.storyAliasMarkdown, markdown || "", "utf8");
  }

  if (options.writeCanonical !== false) {
    await fs.writeJson(paths.canonicalJson, report, { spaces: 2 });
    await fs.writeFile(paths.canonicalMarkdown, markdown || "", "utf8");
  }

  return {
    ...paths,
    wroteCanonical: options.writeCanonical !== false,
    wroteStoryAlias: shouldWriteStoryAlias,
  };
}

module.exports = {
  DEFAULT_REPORT_BASENAME,
  buildOfficialTrailerReferenceReportPaths,
  reportSpecificStem,
  reportStoryIds,
  safeFileSegment,
  stableStoryReportStem,
  storyReferenceReportRelativePath,
  writeOfficialTrailerReferenceReportFiles,
};
