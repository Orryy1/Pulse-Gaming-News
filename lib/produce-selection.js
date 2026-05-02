"use strict";

function parseStoryIds(env = process.env) {
  const raw = String(env.PRODUCE_STORY_IDS || "").trim();
  if (!raw) return null;
  const ids = raw
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

function parseStoryLimit(env = process.env) {
  const raw = String(env.PRODUCE_STORY_LIMIT || "").trim();
  if (!raw) return null;
  const limit = Number(raw);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return Math.floor(limit);
}

function describeProduceSelection(env = process.env) {
  const ids = parseStoryIds(env);
  const limit = parseStoryLimit(env);
  return {
    ids,
    limit,
    active: !!ids || !!limit,
  };
}

function applyProduceSelection(stories, opts = {}) {
  if (!Array.isArray(stories)) return [];
  const env = opts.env || process.env;
  const stage = opts.stage || "produce";
  const log = typeof opts.log === "function" ? opts.log : null;
  const { ids, limit, active } = describeProduceSelection(env);
  if (!active) return stories;

  let selected = stories;
  if (ids) {
    selected = selected.filter((story) => story && ids.has(story.id));
  }
  if (limit) {
    selected = selected.slice(0, limit);
  }

  if (log) {
    const bits = [];
    if (ids) bits.push(`ids=${ids.size}`);
    if (limit) bits.push(`limit=${limit}`);
    log(
      `[produce-selection] ${stage}: selected ${selected.length}/${stories.length} (${bits.join(", ")})`,
    );
  }

  return selected;
}

module.exports = {
  applyProduceSelection,
  describeProduceSelection,
  parseStoryIds,
  parseStoryLimit,
};
