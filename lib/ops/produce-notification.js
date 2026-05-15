"use strict";

function normaliseExportPath(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\\/g, "/");
}

function uniqueExportEntries(stories = []) {
  const seen = new Set();
  const entries = [];
  for (const story of stories || []) {
    const exportedPath = normaliseExportPath(story && story.exported_path);
    if (!exportedPath || seen.has(exportedPath)) continue;
    seen.add(exportedPath);
    entries.push({
      id: story.id || null,
      title: story.title || null,
      exported_path: exportedPath,
    });
  }
  return entries;
}

function buildProduceCompletionSummary({
  beforeStories = [],
  afterStories = [],
  recentlyTouchedExportPaths = [],
  maxLines = 12,
} = {}) {
  const beforeById = new Map();
  for (const story of beforeStories || []) {
    if (!story || !story.id) continue;
    beforeById.set(story.id, normaliseExportPath(story.exported_path));
  }

  const touched = new Set(
    (recentlyTouchedExportPaths || [])
      .map(normaliseExportPath)
      .filter(Boolean),
  );

  const allExports = uniqueExportEntries(afterStories);
  const changedExports = allExports.filter((entry) => {
    const beforePath = entry.id ? beforeById.get(entry.id) : null;
    return !beforePath || beforePath !== entry.exported_path || touched.has(entry.exported_path);
  });

  const header = "**Pulse Gaming Produce Complete**";
  if (changedExports.length === 0) {
    return {
      shouldNotifyDiscord: false,
      totalExported: allExports.length,
      changedExports,
      message: `${header}\n0 new/updated exports this run (${allExports.length} total ready).\nNo Discord backlog list sent.`,
    };
  }

  const safeMaxLines = Math.max(1, Number(maxLines) || 12);
  const visible = changedExports.slice(0, safeMaxLines);
  const hiddenCount = changedExports.length - visible.length;
  const list = visible.map((entry) => entry.exported_path).join("\n");
  const tail = hiddenCount > 0 ? `\n+${hiddenCount} more` : "";

  return {
    shouldNotifyDiscord: true,
    totalExported: allExports.length,
    changedExports,
    message: `${header}\n${changedExports.length} new/updated exports this run (${allExports.length} total ready):\n${list}${tail}`,
  };
}

module.exports = {
  buildProduceCompletionSummary,
  normaliseExportPath,
  uniqueExportEntries,
};
