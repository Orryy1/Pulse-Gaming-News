"use strict";

const INDEX_IDENTITY = Object.freeze({
  id: "pulse-story-repository-index",
  version: "1.0.0",
});
const REQUEST_SCHEMA =
  "pulse-breaking-corroborator-search-request-v1";
const MAX_RESULTS = 40;
const MAX_SCAN_ROWS = 250;

function text(value, maximum = 4_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function tokens(value) {
  return new Set(
    text(value, 8_000)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

function exactHttpsUrl(value) {
  try {
    const parsed = new URL(text(value));
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== "443")
    ) {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function rowUrl(row) {
  return exactHttpsUrl(
    row?.article_url ||
      row?.primary_source_url ||
      row?.url,
  );
}

function relevanceScore(row, requestTokens, subjects) {
  const rowTokens = tokens(
    [
      row?.title,
      row?.subreddit,
      row?.source_name,
      row?.company_name,
      row?.url,
      row?.article_url,
    ].join(" "),
  );
  let overlap = 0;
  for (const token of requestTokens) {
    if (rowTokens.has(token)) overlap += 1;
  }
  let subjectMatches = 0;
  for (const subject of subjects) {
    if (rowTokens.has(subject)) subjectMatches += 1;
  }
  return {
    score: overlap * 10 + subjectMatches * 25,
    overlap,
    subjectMatches,
  };
}

function createBreakingRepositorySearchIndex({ repos } = {}) {
  const db = repos?.db;
  if (!db || typeof db.prepare !== "function") {
    throw new Error("breaking_corroborator_repository_required");
  }
  return Object.freeze({
    identity: INDEX_IDENTITY,
    async search(request = {}) {
      if (
        request?.schema_version !== REQUEST_SCHEMA ||
        !text(request?.story_identity?.id, 200) ||
        !text(request?.query, 320)
      ) {
        throw new Error(
          "breaking_corroborator_repository_request_invalid",
        );
      }
      const limit = Number(request.limit);
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAX_RESULTS
      ) {
        throw new Error(
          "breaking_corroborator_repository_limit_invalid",
        );
      }
      const rows = db
        .prepare(`
          SELECT *
          FROM stories
          ORDER BY COALESCE(updated_at, created_at) DESC
          LIMIT ${MAX_SCAN_ROWS}
        `)
        .all();
      const originId = text(request.story_identity.id, 200);
      const requestTokens = tokens(request.query);
      const subjects = new Set(
        (Array.isArray(request.story_identity.subject_ids)
          ? request.story_identity.subject_ids
          : []
        )
          .map((value) => text(value, 80).toLowerCase())
          .filter(Boolean),
      );
      const seenUrls = new Set();
      const ranked = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        if (text(row?.id, 200) === originId) continue;
        const url = rowUrl(row);
        if (!url || seenUrls.has(url)) continue;
        const relevance = relevanceScore(
          row,
          requestTokens,
          subjects,
        );
        if (
          relevance.subjectMatches === 0 &&
          relevance.overlap < 2
        ) {
          continue;
        }
        seenUrls.add(url);
        ranked.push({
          url,
          title: text(row?.title, 2_000),
          score: relevance.score,
          id: text(row?.id, 200),
        });
      }
      ranked.sort(
        (left, right) =>
          right.score - left.score ||
          left.id.localeCompare(right.id) ||
          left.url.localeCompare(right.url),
      );
      return {
        results: ranked.slice(0, limit).map(({ url, title }) => ({
          url,
          title,
        })),
      };
    },
  });
}

module.exports = {
  INDEX_IDENTITY,
  createBreakingRepositorySearchIndex,
};
