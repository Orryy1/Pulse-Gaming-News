"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createBreakingRepositorySearchIndex,
} = require("../../lib/services/breaking-repository-search-index");

function fakeRepos(rows, observed = {}) {
  return {
    db: {
      prepare(sql) {
        observed.sql = sql;
        return {
          all() {
            observed.calls = Number(observed.calls || 0) + 1;
            return rows;
          },
        };
      },
    },
  };
}

test("the repository search index returns bounded, relevant HTTPS story leads without mutating data", async () => {
  const observed = {};
  const index = createBreakingRepositorySearchIndex({
    repos: fakeRepos(
      [
        {
          id: "origin",
          title: "Original Xbox games return to Game Pass",
          url: "https://www.ign.com/articles/origin",
        },
        {
          id: "match-2",
          title: "Game Pass may add original Xbox classics",
          url: "https://www.eurogamer.net/xbox-classics",
        },
        {
          id: "unrelated",
          title: "New PlayStation controller colours revealed",
          url: "https://www.gamespot.com/articles/controller-colours",
        },
        {
          id: "unsafe",
          title: "Original Xbox games return",
          url: "http://www.ign.com/articles/not-https",
        },
      ],
      observed,
    ),
  });

  const result = await index.search({
    schema_version: "pulse-breaking-corroborator-search-request-v1",
    story_identity: {
      id: "origin",
      subject_ids: ["xbox"],
    },
    query: "Original Xbox games Game Pass",
    limit: 3,
  });

  assert.deepEqual(index.identity, {
    id: "pulse-story-repository-index",
    version: "1.0.0",
  });
  assert.deepEqual(
    result.results.map((row) => row.url),
    ["https://www.eurogamer.net/xbox-classics"],
  );
  assert.equal(observed.calls, 1);
  assert.match(observed.sql, /^\s*SELECT\s+\*/i);
  assert.doesNotMatch(observed.sql, /\b(?:INSERT|UPDATE|DELETE)\b/i);
});

test("the repository search index fails closed for malformed requests and unavailable repositories", async () => {
  assert.throws(
    () => createBreakingRepositorySearchIndex({ repos: {} }),
    /repository_required/,
  );
  const index = createBreakingRepositorySearchIndex({
    repos: fakeRepos([]),
  });
  await assert.rejects(
    () => index.search({ query: "xbox", limit: 4 }),
    /request_invalid/,
  );
  await assert.rejects(
    () =>
      index.search({
        schema_version:
          "pulse-breaking-corroborator-search-request-v1",
        story_identity: { id: "story", subject_ids: [] },
        query: "xbox",
        limit: 100,
      }),
    /limit_invalid/,
  );
});
