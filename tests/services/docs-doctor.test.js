"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("fs-extra");

const d = require("../../lib/ops/docs-doctor");

// 2026-04-29 audit: stale docs cause unsafe operational decisions.
// Pin the drift-phrase list, the per-file scanner, and the formatter.

// ── scanFile ──────────────────────────────────────────────────────

test("scanFile: catches 'ready + complete' as Facebook Reel success", () => {
  const signals = d.scanFile(
    "When status is ready + complete, the Reel was published.\n",
    "fake.md",
  );
  assert.ok(signals.length >= 1);
  assert.ok(signals.some((s) => s.phrase === "fb_reel_ready_complete_success"));
  assert.equal(signals[0].severity, "high");
});

test("scanFile: catches 'live proof pending' as medium", () => {
  const signals = d.scanFile("Live proof pending — TBC", "fake.md");
  assert.ok(signals.some((s) => s.phrase === "live_proof_pending_stale"));
});

test("scanFile: catches 'scope not present' as medium", () => {
  const signals = d.scanFile(
    "yt-analytics scope is not present yet, will require re-auth",
    "fake.md",
  );
  assert.ok(
    signals.some((s) => s.phrase === "yt_analytics_scope_not_present_stale"),
  );
});

test("scanFile: catches commit references as low severity", () => {
  const signals = d.scanFile("Latest deploy is commit 8af1517", "fake.md");
  assert.ok(
    signals.some((s) => s.phrase === "commit_reference_check_freshness"),
  );
});

test("scanFile: clean text returns empty", () => {
  const signals = d.scanFile(
    "## Pulse Gaming\nAll good here. No drift signals.\n",
    "fake.md",
  );
  assert.deepEqual(signals, []);
});

test("scanFile: snippet truncated at 160 chars", () => {
  const longLine = "ready + complete " + "x".repeat(500);
  const signals = d.scanFile(longLine, "fake.md");
  assert.ok(signals.length >= 1);
  assert.ok(signals[0].snippet.length <= 160);
});

// ── buildDocsDoctorReport (with a temp dir) ───────────────────────

test("buildDocsDoctorReport: aggregates over a temp tree", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-docs-doctor-"));
  try {
    await fs.writeFile(
      path.join(tmp, "RUNBOOK.md"),
      "FB Reel: ready + complete = success.\nLive proof pending in this section.\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(tmp, "CLEAN.md"),
      "Nothing to see here.\n",
      "utf-8",
    );
    const report = await d.buildDocsDoctorReport({ rootDir: tmp });
    assert.equal(report.scanned, 2);
    assert.ok(report.drift_signals.length >= 2);
    assert.ok(report.summary.high >= 1);
    assert.ok(report.summary.medium >= 1);
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("buildDocsDoctorReport: empty tree returns zero signals", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-docs-empty-"));
  try {
    const report = await d.buildDocsDoctorReport({ rootDir: tmp });
    assert.equal(report.scanned, 0);
    assert.deepEqual(report.drift_signals, []);
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("buildDocsDoctorReport: skips node_modules / dist / test/output", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-docs-excl-"));
  try {
    await fs.ensureDir(path.join(tmp, "node_modules"));
    await fs.writeFile(
      path.join(tmp, "node_modules", "DIRTY.md"),
      "ready + complete\n",
      "utf-8",
    );
    await fs.ensureDir(path.join(tmp, "test", "output"));
    await fs.writeFile(
      path.join(tmp, "test", "output", "DIRTY.md"),
      "ready + complete\n",
      "utf-8",
    );
    await fs.writeFile(path.join(tmp, "OK.md"), "Nothing.\n", "utf-8");
    const report = await d.buildDocsDoctorReport({ rootDir: tmp });
    assert.equal(report.scanned, 1);
    assert.deepEqual(report.drift_signals, []);
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

// ── formatDocsDoctorMarkdown ──────────────────────────────────────

test("formatDocsDoctorMarkdown: clean report renders the green message", () => {
  const md = d.formatDocsDoctorMarkdown({
    scanned: 5,
    drift_signals: [],
    summary: { high: 0, medium: 0, low: 0 },
  });
  assert.match(md, /Docs look clean/);
});

test("formatDocsDoctorMarkdown: orders by severity high→low", () => {
  const md = d.formatDocsDoctorMarkdown({
    scanned: 3,
    drift_signals: [
      {
        file: "a.md",
        line: 1,
        phrase: "low_one",
        severity: "low",
        snippet: "low",
      },
      {
        file: "b.md",
        line: 2,
        phrase: "high_one",
        severity: "high",
        snippet: "high",
      },
      {
        file: "c.md",
        line: 3,
        phrase: "medium_one",
        severity: "medium",
        snippet: "medium",
      },
    ],
    summary: { high: 1, medium: 1, low: 1 },
  });
  // The high-severity row should appear before the low one in the output.
  const highIdx = md.indexOf("high_one");
  const lowIdx = md.indexOf("low_one");
  assert.ok(highIdx > -1 && lowIdx > -1);
  assert.ok(highIdx < lowIdx);
});

test("formatDocsDoctorMarkdown: caps top-30 entries", () => {
  const drift = Array.from({ length: 100 }, (_, i) => ({
    file: `f${i}.md`,
    line: i + 1,
    phrase: "fb_reel_ready_complete_success",
    severity: "high",
    snippet: `snip ${i}`,
  }));
  const md = d.formatDocsDoctorMarkdown({
    scanned: 100,
    drift_signals: drift,
    summary: { high: 100, medium: 0, low: 0 },
  });
  const occurrences = (md.match(/^🔴 f\d+\.md/gm) || []).length;
  assert.equal(occurrences, 30);
});
