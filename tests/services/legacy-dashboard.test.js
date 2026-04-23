/**
 * tests/services/legacy-dashboard.test.js
 *
 * 2026-04-23 — the production dashboard is public/index.html
 * (standalone inline-Babel React CDN app). src/ Vite app never
 * actually ships because dist/ isn't landing in the Railway
 * container — the server's SPA fallback serves public/index.html
 * instead. The filter + sort work I did in src/hooks/useStories.ts
 * was therefore inert.
 *
 * These tests re-implement the legacy dashboard's `categorise` +
 * `isInApprovalQueue` + `approveButtonState` functions as a pure
 * module-free replica (the source is inline `<script type=
 * "text/babel">` so we can't directly import it) and pin:
 *
 *   - the 2 stuck partial-retry stories DO NOT appear as approval
 *     candidates after the fix
 *   - stories with publish_status in {failed, published} are hidden
 *     from the approval queue
 *   - stories with classification in {[DEFER], [REJECT]} are hidden
 *   - already-approved stories are hidden from the approval queue
 *     (but the APPROVED banner still renders on their cards when
 *     `showAll` is on)
 *   - the APPROVE button is not shown for non-review stories
 *
 * Also pin that public/index.html:
 *   - fetches /api/news/full (authenticated), NOT /api/news
 *   - uses a Bearer token from localStorage
 *   - renders ScriptBlock with an "(not generated)" placeholder
 *     when a field is empty (so operators see real state instead
 *     of a silently-blank label)
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// ---------- pure replicas of the legacy dashboard helpers ----------

function categorise(story) {
  if (!story) return "unknown";
  if (story.publish_status === "failed") return "failed";
  if (story.publish_status === "published") return "published";
  if (story.publish_status === "partial") return "partial";
  const cls = story.classification || "";
  if (cls === "[DEFER]" || cls === "[REJECT]") return "deferred";
  if (story.approved) return "approved";
  return "review";
}

function isInApprovalQueue(story) {
  return categorise(story) === "review";
}

function approveButtonState(story) {
  const cat = categorise(story);
  if (cat === "review")
    return { show: true, disabled: false, label: "APPROVE" };
  if (cat === "approved")
    return { show: true, disabled: true, label: "APPROVED" };
  return { show: false, disabled: true, label: "" };
}

// ---------- approval-queue filter ----------

test("the 2 stuck partial-retry stories are NOT in the approval queue", () => {
  // Exact shape of the production rows (verified via railway ssh
  // during today's audit). `approved=true, publish_status='partial'`
  // → categorised as 'partial', excluded from the approval queue.
  const eldenRing = {
    id: "rss_867bd793e3d9ca6f",
    title: "Elden Ring Movie Release Date and Full Cast Announced",
    approved: true,
    publish_status: "partial",
    classification: "[CONFIRMED]",
  };
  const blackFlag = {
    id: "1sojcmy",
    title: "Tom Henderson on Black Flag remake",
    approved: true,
    publish_status: "partial",
    classification: "[BREAKING]",
  };
  assert.equal(isInApprovalQueue(eldenRing), false);
  assert.equal(isInApprovalQueue(blackFlag), false);
  assert.equal(categorise(eldenRing), "partial");
  assert.equal(categorise(blackFlag), "partial");
});

test("publish_status='failed' story is NOT in the approval queue", () => {
  const row = {
    id: "1sqpa86",
    approved: true,
    publish_status: "failed",
    classification: "[BREAKING]",
  };
  assert.equal(isInApprovalQueue(row), false);
  assert.equal(categorise(row), "failed");
});

test("publish_status='published' story is NOT in the approval queue", () => {
  const row = {
    id: "rss_ok",
    approved: true,
    publish_status: "published",
    classification: "[CONFIRMED]",
  };
  assert.equal(isInApprovalQueue(row), false);
  assert.equal(categorise(row), "published");
});

test("classification='[DEFER]' story is NOT in the approval queue", () => {
  const row = {
    id: "rss_def",
    approved: false,
    publish_status: null,
    classification: "[DEFER]",
  };
  assert.equal(isInApprovalQueue(row), false);
  assert.equal(categorise(row), "deferred");
});

test("classification='[REJECT]' story is NOT in the approval queue", () => {
  const row = {
    id: "rss_rej",
    approved: false,
    publish_status: null,
    classification: "[REJECT]",
  };
  assert.equal(isInApprovalQueue(row), false);
});

test("already-approved story is NOT in the approval queue", () => {
  const row = {
    id: "rss_a",
    approved: true,
    publish_status: null, // approved but not yet produced
    classification: "[CONFIRMED]",
  };
  assert.equal(isInApprovalQueue(row), false);
  assert.equal(categorise(row), "approved");
});

test("genuine review-tier story IS in the approval queue", () => {
  const row = {
    id: "rss_r",
    approved: false,
    publish_status: null,
    classification: "[REVIEW]",
  };
  assert.equal(isInApprovalQueue(row), true);
  assert.equal(categorise(row), "review");
});

test("story with no classification and !approved defaults to review", () => {
  const row = { id: "rss_x", approved: false };
  assert.equal(isInApprovalQueue(row), true);
});

// ---------- approve-button behaviour ----------

test("APPROVE button is visible + enabled on review-tier stories", () => {
  const btn = approveButtonState({ approved: false });
  assert.equal(btn.show, true);
  assert.equal(btn.disabled, false);
  assert.equal(btn.label, "APPROVE");
});

test("APPROVED button (disabled) renders on approved-not-produced stories", () => {
  const btn = approveButtonState({ approved: true, publish_status: null });
  assert.equal(btn.show, true);
  assert.equal(btn.disabled, true);
  assert.equal(btn.label, "APPROVED");
});

test("APPROVE button is HIDDEN on partial-retry stories", () => {
  const btn = approveButtonState({ approved: true, publish_status: "partial" });
  assert.equal(btn.show, false);
});

test("APPROVE button is HIDDEN on qa_failed stories", () => {
  const btn = approveButtonState({ approved: true, publish_status: "failed" });
  assert.equal(btn.show, false);
});

test("APPROVE button is HIDDEN on published stories", () => {
  const btn = approveButtonState({
    approved: true,
    publish_status: "published",
  });
  assert.equal(btn.show, false);
});

test("APPROVE button is HIDDEN on [DEFER] / [REJECT] stories", () => {
  assert.equal(
    approveButtonState({ approved: false, classification: "[DEFER]" }).show,
    false,
  );
  assert.equal(
    approveButtonState({ approved: false, classification: "[REJECT]" }).show,
    false,
  );
});

// ---------- source-scan pins on public/index.html ----------

const HTML_PATH = path.join(__dirname, "..", "..", "public", "index.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");

test("public/index.html fetches /api/news/full, not /api/news (source-scan)", () => {
  // The sanitised /api/news strips approved / publish_status / script
  // fields and filters to publicly_visible stories only — which is
  // what caused the original bug. Hard-pin that the new dashboard
  // uses the authenticated full endpoint.
  assert.match(HTML, /['"]\/api\/news\/full['"]/);
  // And does NOT fetch /api/news on its own (as a bare endpoint).
  // The string '/api/news' does appear as a substring of
  // '/api/news/full' so we assert the literal quoted bare form
  // doesn't appear.
  assert.doesNotMatch(HTML, /['"]\/api\/news['"][^/]/);
});

test("public/index.html attaches Bearer token to authenticated fetches (source-scan)", () => {
  assert.match(HTML, /Authorization:\s*`Bearer \$\{token\}`/);
  // Token storage
  assert.match(HTML, /pulse_api_token/);
  assert.match(HTML, /localStorage/);
});

test("public/index.html 401 handler clears stored token and reloads", () => {
  assert.match(HTML, /res\.status === 401/);
  assert.match(HTML, /clearToken\(\)/);
});

test("public/index.html defines categorise + isInApprovalQueue + approveButtonState", () => {
  assert.match(HTML, /function categorise\(story\)/);
  assert.match(HTML, /function isInApprovalQueue\(story\)/);
  assert.match(HTML, /function approveButtonState\(story\)/);
});

test("public/index.html renders 'No stories currently require manual approval' when queue is empty", () => {
  assert.match(HTML, /No stories currently require manual approval\./);
});

test("public/index.html ScriptBlock renders '(not generated)' placeholder on empty fields", () => {
  assert.match(HTML, /\(not generated\)/);
});

test("public/index.html renders NO SCRIPT AVAILABLE warning when all script fields empty", () => {
  assert.match(HTML, /NO SCRIPT AVAILABLE/);
});

test("public/index.html excludes partial, failed, published, [DEFER], [REJECT], approved from the default view", () => {
  // Anchor: the categorise() function explicitly maps each of these
  // states to a non-'review' bucket. Locate the function, then take
  // a generous window forward and check each branch is still there.
  // If any of these branches are removed, the approval queue leaks
  // back into its old buggy state.
  const idx = HTML.indexOf("function categorise(story)");
  assert.ok(idx > 0, "categorise function must exist");
  const body = HTML.slice(idx, idx + 800);
  assert.match(body, /publish_status === ['"]failed['"]/);
  assert.match(body, /publish_status === ['"]published['"]/);
  assert.match(body, /publish_status === ['"]partial['"]/);
  assert.match(body, /\[DEFER\]/);
  assert.match(body, /\[REJECT\]/);
  assert.match(body, /story\.approved/);
});
