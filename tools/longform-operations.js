"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const {
  buildLongformOperationsReport,
  renderLongformOperationsMarkdown,
  writeLongformOperationsReport,
} = require("../lib/ops/longform-operations");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "output", "longform-operations");
const DEFAULT_WEEKLY_REPORT = path.join(
  ROOT,
  "output",
  "weekly",
  "weekly_longform_readiness_report.json",
);

function parseArgs(argv = process.argv.slice(2)) {
  const args = { outputDir: DEFAULT_OUTPUT_DIR, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--weekly-report") args.weeklyReportPath = path.resolve(argv[++index]);
    else if (arg === "--release-radar-package") args.releaseRadarPackagePath = path.resolve(argv[++index]);
    else if (arg === "--release-radar-readme") args.releaseRadarReadmePath = path.resolve(argv[++index]);
    else if (arg === "--portfolio-report") args.portfolioReportPath = path.resolve(argv[++index]);
    else if (arg === "--out-dir") args.outputDir = path.resolve(argv[++index]);
    else if (arg === "--json") args.json = true;
  }
  return args;
}

async function readJsonOptional(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  return fs.readJson(filePath);
}

async function readTextOptional(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return "";
  return fs.readFile(filePath, "utf8");
}

async function findLatestReleaseRadarPackage(root = path.join(ROOT, "output", "release-radar")) {
  if (!(await fs.pathExists(root))) return null;
  const names = new Set(["pulse_release_radar_package.json", "release-radar-package.json"]);
  const candidates = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() !== "archive") await visit(path.join(dir, entry.name));
      } else if (names.has(entry.name)) {
        const filePath = path.join(dir, entry.name);
        const stat = await fs.stat(filePath);
        candidates.push({ filePath, mtimeMs: stat.mtimeMs });
      }
    }
  }
  await visit(root);
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.filePath || null;
}

async function resolveDefaultPaths(options = {}) {
  const generatedRadarPackage = path.join(
    ROOT,
    "output",
    "longform-candidate-intake",
    "release_radar_package.json",
  );
  const releaseRadarPackagePath =
    options.releaseRadarPackagePath ||
    ((await fs.pathExists(generatedRadarPackage)) ? generatedRadarPackage : null) ||
    (await findLatestReleaseRadarPackage());
  const radarDir = releaseRadarPackagePath ? path.dirname(releaseRadarPackagePath) : null;
  let releaseRadarReadmePath = options.releaseRadarReadmePath || null;
  if (!releaseRadarReadmePath && radarDir) {
    const candidates = [
      "README.md",
      "readme.md",
      "pulse_release_radar_report.md",
      "release-radar-readme.md",
      "release_radar_package.md",
    ].map((name) => path.join(radarDir, name));
    releaseRadarReadmePath = (await Promise.all(
      candidates.map(async (candidate) => ((await fs.pathExists(candidate)) ? candidate : null)),
    )).find(Boolean) || null;
  }
  const portfolioCandidates = [
    path.join(ROOT, "output", "longform-portfolio", "longform_format_portfolio.json"),
    path.join(ROOT, "output", "longform-operations", "longform_portfolio_report.json"),
    path.join(ROOT, "output", "longform", "longform_portfolio_report.json"),
  ];
  const portfolioReportPath = options.portfolioReportPath || (await Promise.all(
    portfolioCandidates.map(async (candidate) => ((await fs.pathExists(candidate)) ? candidate : null)),
  )).find(Boolean) || null;
  return {
    weeklyReportPath: options.weeklyReportPath || DEFAULT_WEEKLY_REPORT,
    releaseRadarPackagePath,
    releaseRadarReadmePath,
    portfolioReportPath,
  };
}

async function runLongformOperations(options = {}) {
  const paths = await resolveDefaultPaths(options);
  const [weeklyReport, releaseRadarPackage, releaseRadarReadme, portfolioReport] =
    await Promise.all([
      readJsonOptional(paths.weeklyReportPath),
      readJsonOptional(paths.releaseRadarPackagePath),
      readTextOptional(paths.releaseRadarReadmePath),
      readJsonOptional(paths.portfolioReportPath),
    ]);
  const report = buildLongformOperationsReport({
    weeklyReport,
    releaseRadarPackage,
    releaseRadarReadme,
    portfolioReport,
    generatedAt: options.generatedAt,
    sources: paths,
  });
  const writtenPaths = await writeLongformOperationsReport(report, {
    outputDir: options.outputDir || DEFAULT_OUTPUT_DIR,
  });
  return { report, paths: writtenPaths, sources: paths };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await runLongformOperations(args);
  if (args.json) process.stdout.write(`${JSON.stringify({ ...result.report, paths: result.paths }, null, 2)}\n`);
  else process.stdout.write(renderLongformOperationsMarkdown(result.report));
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[longform-operations] ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  findLatestReleaseRadarPackage,
  main,
  parseArgs,
  resolveDefaultPaths,
  runLongformOperations,
};
