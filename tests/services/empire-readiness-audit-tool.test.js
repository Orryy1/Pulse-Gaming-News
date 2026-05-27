const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parseArgs, main } = require("../../tools/empire-readiness-audit");

test("empire readiness audit CLI parses explicit report paths", () => {
  const args = parseArgs([
    "--retention-baseline",
    "baseline.json",
    "--render-health",
    "render.json",
    "--v4-source-deficit",
    "deficit.json",
    "--v4-motion-packs",
    "motion.json",
    "--revenue-paths",
    "revenue.json",
    "--out-dir",
    "audit-out",
    "--json",
  ]);

  assert.equal(args.retentionBaselinePath, path.resolve("baseline.json"));
  assert.equal(args.renderHealthPath, path.resolve("render.json"));
  assert.equal(args.v4SourceDeficitPath, path.resolve("deficit.json"));
  assert.equal(args.v4MotionPacksPath, path.resolve("motion.json"));
  assert.equal(args.revenuePathsPath, path.resolve("revenue.json"));
  assert.equal(args.outDir, path.resolve("audit-out"));
  assert.equal(args.json, true);
});

test("empire readiness audit CLI writes JSON and Markdown without publishing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-empire-audit-"));
  const baselinePath = path.join(tmp, "baseline.json");
  const motionPath = path.join(tmp, "motion.json");
  const outDir = path.join(tmp, "out");

  fs.writeFileSync(
    baselinePath,
    JSON.stringify({
      stayed_to_watch: 39.3,
      avg_watch_seconds_estimate: 10.8,
      subscriber_conversion_estimate: 0.041,
      top_short_ceiling_current: 900,
    }),
  );
  fs.writeFileSync(
    motionPath,
    JSON.stringify({
      summary: {
        ready: 0,
        blocked: 1,
        clips: 1,
      },
    }),
  );

  const result = await main([
    "--retention-baseline",
    baselinePath,
    "--v4-motion-packs",
    motionPath,
    "--out-dir",
    outDir,
    "--generated-at",
    "2026-05-20T02:00:00.000Z",
  ]);

  assert.equal(result.audit.verdict, "build_not_scale_ready");
  assert.equal(result.audit.safety.no_publish_side_effects, true);
  assert.ok(fs.existsSync(path.join(outDir, "empire_readiness_audit.json")));
  assert.ok(fs.existsSync(path.join(outDir, "empire_readiness_audit.md")));
  assert.match(
    fs.readFileSync(path.join(outDir, "empire_readiness_audit.md"), "utf8"),
    /Pulse Empire Readiness Audit/,
  );
});

test("empire readiness audit CLI accepts PowerShell UTF-8 BOM JSON reports", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-empire-audit-bom-"));
  const renderHealthPath = path.join(tmp, "render_health.json");
  const outDir = path.join(tmp, "out");

  fs.writeFileSync(
    renderHealthPath,
    `\uFEFF${JSON.stringify({
      stamped: 1,
      quality: { premium: 0, standard: 1, fallback: 0 },
      lane: { legacy_multi_image: 1 },
      percentages: {
        quality: { premium: 0, standard: 100, fallback: 0 },
        lane: { legacy_multi_image: 100 },
        thin: 0,
      },
      visual_count: { median: 4 },
    })}`,
    "utf8",
  );

  const result = await main([
    "--render-health",
    renderHealthPath,
    "--out-dir",
    outDir,
  ]);

  assert.equal(result.audit.safety.read_only, true);
  assert.ok(fs.existsSync(path.join(outDir, "empire_readiness_audit.json")));
});
