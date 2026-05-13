const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SERVER_PATH = path.join(__dirname, "..", "..", "server.js");
const src = fs.readFileSync(SERVER_PATH, "utf8");

test("server.js defines named rate limits for public API and media surfaces", () => {
  assert.match(src, /const\s+publicApiReadLimit\s*=\s*rateLimit\(/);
  assert.match(src, /const\s+publicMediaReadLimit\s*=\s*rateLimit\(/);
  assert.match(src, /const\s+publicWebhookLimit\s*=\s*rateLimit\(/);
});

test("public /api/news is rate-limited without requiring Bearer auth", () => {
  assert.match(
    src,
    /app\.get\(\s*["']\/api\/news["']\s*,\s*publicApiReadLimit\s*,/,
    "/api/news must stay public but include the public API read limiter",
  );
});

test("public media artefact routes are rate-limited without breaking crawler access", () => {
  assert.match(
    src,
    /app\.get\(\s*\/\^\\\/api\\\/story-image\\\//,
    "story-image regex route must still exist",
  );
  assert.match(
    src,
    /app\.get\(\s*\/\^\\\/api\\\/story-image\\\/\(\[\^\/\]\+\?\)\(\?:\\\.png\)\?\$\/\s*,\s*publicMediaReadLimit\s*,/,
    "/api/story-image must include publicMediaReadLimit before the handler",
  );
  assert.match(
    src,
    /app\.get\(\s*\/\^\\\/api\\\/download\\\/\(\[\^\/\]\+\?\)\(\?:\\\.mp4\)\?\$\/\s*,\s*publicMediaReadLimit\s*,/,
    "/api/download must include publicMediaReadLimit before the handler",
  );
});

test("Railway webhook uses the named webhook limiter", () => {
  assert.match(
    src,
    /app\.post\(\s*["']\/api\/webhook\/railway["']\s*,\s*publicWebhookLimit\s*,\s*requireRailwayWebhookAuth\s*,/,
  );
});

test("Railway webhook supports optional shared-secret verification", () => {
  assert.match(src, /function\s+requireRailwayWebhookAuth\s*\(/);
  assert.match(src, /process\.env\.RAILWAY_WEBHOOK_SECRET/);
  assert.match(src, /x-pulse-webhook-secret/i);
  assert.match(src, /\btokenMatches\(/);
});
