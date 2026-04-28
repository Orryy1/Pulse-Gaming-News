"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderQueueInspectMarkdown } = require("../../lib/ops/queue-inspect");

test("queue inspect markdown explains USE_SQLITE skip states", () => {
  const md = renderQueueInspectMarkdown({
    generatedAt: "2026-04-28T00:00:00.000Z",
    verdict: "skip",
    reason: "USE_SQLITE_not_enabled",
  });

  assert.match(md, /Reason: USE_SQLITE_not_enabled/);
  assert.match(md, /USE_SQLITE=true/);
  assert.match(md, /SQLITE_DB_PATH/);
  assert.match(md, /- unavailable/);
});

test("queue inspect markdown explains unavailable SQLite skip states", () => {
  const md = renderQueueInspectMarkdown({
    generatedAt: "2026-04-28T00:00:00.000Z",
    verdict: "skip",
    reason: "sqlite_unavailable",
  });

  assert.match(md, /Reason: sqlite_unavailable/);
  assert.match(md, /SQLite queue database is mounted and readable/);
});
