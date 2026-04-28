"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const ANALYTICS_PAGE = path.join(ROOT, "src", "pages", "Analytics.tsx");

test("dashboard analytics page uses current authenticated analytics endpoints", () => {
  const source = fs.readFileSync(ANALYTICS_PAGE, "utf8");
  assert.match(source, /apiGetAuthed<OverviewResponse>\('\/api\/analytics\/overview'\)/);
  assert.match(source, /apiGetAuthed<TopicsResponse>\('\/api\/analytics\/topics'\)/);
  assert.match(
    source,
    /apiGetAuthed<HistoryResponse>\('\/api\/analytics\/history\?limit=50'\)/,
  );
  assert.doesNotMatch(source, /\/api\/analytics\/summary/);
  assert.doesNotMatch(source, /\/api\/analytics\/top-performers/);
  assert.doesNotMatch(source, /\/api\/analytics\/topic-breakdown/);
  assert.doesNotMatch(source, /\/api\/analytics\/daily-trends/);
});
