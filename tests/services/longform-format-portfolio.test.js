"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  LONGFORM_FORMAT_PORTFOLIO,
  buildLongformFormatPortfolio,
  renderLongformFormatPortfolioMarkdown,
} = require("../../lib/longform-format-portfolio");
const {
  DEFAULT_OUT_DIR,
  parseArgs,
  main,
} = require("../../tools/longform-format-portfolio");

test("longform portfolio defines six production-grade recurring formats", () => {
  const ids = LONGFORM_FORMAT_PORTFOLIO.map((format) => format.id);

  assert.deepEqual(ids, [
    "monthly_release_radar",
    "weekly_news_verdict",
    "ranked_countdown",
    "single_topic_deep_dive",
    "source_backed_launch_verdict",
    "buyer_guide",
  ]);

  for (const format of LONGFORM_FORMAT_PORTFOLIO) {
    assert.ok(format.label);
    assert.ok(format.cadence);
    assert.ok(format.targets.duration_minutes.min >= 8);
    assert.ok(format.targets.duration_minutes.max >= format.targets.duration_minutes.min);
    assert.ok(format.targets.words.min > 0);
    assert.ok(format.targets.chapters.min > 0);
    assert.ok(format.targets.segments.min > 0);
    assert.ok(format.monetisation_surfaces.length > 0);
    assert.ok(format.gates.source.length > 0);
    assert.ok(format.gates.motion.length > 0);
    assert.ok(format.gates.originality.length > 0);
    assert.ok(format.derivatives.length > 0);
  }
});

test("portfolio markdown documents every operating contract and safety boundary", () => {
  const report = buildLongformFormatPortfolio({
    generatedAt: "2026-07-12T17:05:00.000Z",
  });
  const markdown = renderLongformFormatPortfolioMarkdown(report);

  assert.match(markdown, /^# Pulse Gaming Longform Format Portfolio/m);
  assert.match(markdown, /Local proof only/);
  assert.match(markdown, /No upload or publish action is permitted/);
  assert.match(markdown, /Cadence/);
  assert.match(markdown, /Production Targets/);
  assert.match(markdown, /Monetisation Surfaces/);
  assert.match(markdown, /Source Gates/);
  assert.match(markdown, /Motion Gates/);
  assert.match(markdown, /Originality Gates/);
  assert.match(markdown, /Derivatives/);

  for (const format of LONGFORM_FORMAT_PORTFOLIO) {
    assert.match(markdown, new RegExp(`## ${format.label}`));
  }
});

test("portfolio proof is deterministic and explicitly cannot publish", () => {
  const report = buildLongformFormatPortfolio({
    generatedAt: "2026-07-12T17:00:00.000Z",
  });

  assert.equal(report.schema_version, 1);
  assert.equal(report.generated_at, "2026-07-12T17:00:00.000Z");
  assert.equal(report.status, "portfolio_defined_local_proof_only");
  assert.equal(report.summary.format_count, 6);
  assert.equal(report.summary.recurring_format_count, 6);
  assert.deepEqual(report.formats, LONGFORM_FORMAT_PORTFOLIO);
  assert.deepEqual(report.safety, {
    local_proof_only: true,
    no_publish: true,
    no_upload: true,
    no_scheduler_change: true,
    no_production_db_mutation: true,
    no_oauth_or_token_change: true,
    no_platform_setting_change: true,
    no_format_is_publish_ready_by_definition: true,
  });
});

test("longform portfolio CLI defaults to the governed proof directory", () => {
  const args = parseArgs([]);

  assert.equal(args.outDir, DEFAULT_OUT_DIR);
  assert.match(DEFAULT_OUT_DIR.replaceAll("\\", "/"), /output\/longform-portfolio$/);
  assert.equal(args.json, false);
});

test("longform portfolio CLI writes JSON and Markdown proof only", async (t) => {
  const outDir = path.join(
    process.cwd(),
    "test",
    "output",
    `longform-format-portfolio-${process.pid}-${Date.now()}`,
  );
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));

  const writes = [];
  const result = await main(
    ["--out-dir", outDir, "--generated-at", "2026-07-12T17:10:00.000Z", "--json"],
    { stdout: { write: (value) => writes.push(String(value)) } },
  );

  const json = JSON.parse(await fs.readFile(result.jsonPath, "utf8"));
  const markdown = await fs.readFile(result.markdownPath, "utf8");

  assert.equal(json.generated_at, "2026-07-12T17:10:00.000Z");
  assert.equal(json.safety.no_publish, true);
  assert.equal(json.safety.no_upload, true);
  assert.equal(json.summary.format_count, 6);
  assert.match(markdown, /No upload or publish action is permitted/);
  assert.match(writes.join(""), /"status": "completed"/);
});
