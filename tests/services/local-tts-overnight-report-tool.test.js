const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  runLocalTtsOvernightReport,
  shouldWriteRootReport,
} = require("../../tools/local-tts-overnight-report");

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-tts-report-"));
}

test("local TTS overnight report does not rewrite tracked root report by default", async () => {
  const root = await tempRoot();
  const outDir = path.join(root, "test", "output");
  const rootReportPath = path.join(root, "LOCAL_TTS_OVERNIGHT_REPORT.md");
  await fs.ensureDir(outDir);
  await fs.writeFile(rootReportPath, "# Existing committed handoff\n", "utf8");

  const result = await runLocalTtsOvernightReport({ root, outDir });

  assert.equal(result.writeRootReport, false);
  assert.equal(result.rootPath, null);
  assert.equal(await fs.pathExists(path.join(outDir, "local_tts_overnight_report.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "local_tts_overnight_report.md")), true);
  assert.equal(await fs.readFile(rootReportPath, "utf8"), "# Existing committed handoff\n");
});

test("local TTS overnight report writes root handoff only when explicitly requested", async () => {
  const root = await tempRoot();
  const outDir = path.join(root, "test", "output");
  const rootReportPath = path.join(root, "LOCAL_TTS_OVERNIGHT_REPORT.md");
  await fs.ensureDir(outDir);
  await fs.writeFile(rootReportPath, "# Existing committed handoff\n", "utf8");

  const result = await runLocalTtsOvernightReport({ root, outDir, writeRootReport: true });

  assert.equal(result.writeRootReport, true);
  assert.equal(result.rootPath, rootReportPath);
  const rootMarkdown = await fs.readFile(rootReportPath, "utf8");
  assert.match(rootMarkdown, /^# Local TTS Overnight Report/m);
});

test("local TTS overnight report root-write flag is explicit", () => {
  assert.equal(shouldWriteRootReport({ argv: [], env: {} }), false);
  assert.equal(shouldWriteRootReport({ argv: ["--write-root-report"], env: {} }), true);
  assert.equal(
    shouldWriteRootReport({
      argv: [],
      env: { PULSE_WRITE_ROOT_TTS_OVERNIGHT_REPORT: "true" },
    }),
    true,
  );
});
