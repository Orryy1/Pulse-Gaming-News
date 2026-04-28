"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { buildMonthlyReleaseRadar } = require("../lib/formats/release-radar");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output", "monthly-release-radar");

const FIXTURE_CANDIDATES = [
  {
    title: "Verified Release Candidate One",
    releaseDate: "2026-05-02",
    platforms: ["PC", "PlayStation", "Xbox"],
    publisherSource: "manual-source-required",
    storeSource: "manual-store-required",
    trailerUrl: "manual-trailer-required",
    searchDemand: "high",
    angle: "a broad multi-platform launch with trailer material ready for breakdown",
  },
  {
    title: "Verified Release Candidate Two",
    releaseDate: "2026-05-06",
    platforms: ["Nintendo Switch 2", "PC"],
    publisherSource: "manual-source-required",
    storeSource: "manual-store-required",
    trailerUrl: "manual-trailer-required",
    searchDemand: "high",
    angle: "a console-specific angle that can produce Shorts and a buying-guide segment",
  },
  {
    title: "Thin Rumoured Candidate",
    releaseDate: null,
    platforms: [],
    publisherSource: null,
    storeSource: null,
    searchDemand: "medium",
    angle: "not publishable until dated by a primary source",
  },
];

function markdown(report) {
  return [
    "# Monthly Release Radar Prototype",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.factCheckGate.status}`,
    `Ready candidates: ${report.factCheckGate.readyCandidates}/${report.factCheckGate.minimumReadyCandidates}`,
    "",
    "## Top 10",
    ...(report.top10.length
      ? report.top10.map((c, i) => `- ${i + 1}. ${c.title} (${c.releaseDate})`)
      : ["- insufficient verified candidates"]),
    "",
    "## Rejected",
    ...(report.rejectedCandidates.length
      ? report.rejectedCandidates.map((c) => `- ${c.title}: ${c.factCheckStatus}`)
      : ["- none"]),
    "",
    "## Manual Review Checklist",
    ...report.manualReviewChecklist.map((item) => `- ${item}`),
  ].join("\n") + "\n";
}

async function main() {
  await fs.ensureDir(OUT);
  const report = buildMonthlyReleaseRadar({
    monthLabel: "May 2026",
    candidates: FIXTURE_CANDIDATES,
  });
  await fs.writeJson(path.join(OUT, "release-radar-package.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(path.join(OUT, "README.md"), markdown(report), "utf8");
  await fs.writeFile(path.join(OUT, "long-form-script.md"), report.longFormScript, "utf8");
  await fs.writeJson(path.join(OUT, "shorts-scripts.json"), report.shorts, { spaces: 2 });
  await fs.writeFile(path.join(OUT, "blog-article.md"), report.blogArticle, "utf8");
  await fs.writeFile(path.join(OUT, "newsletter.md"), report.newsletterIssue, "utf8");
  console.log(`[release-radar] wrote ${path.relative(ROOT, OUT)}`);
  console.log(`[release-radar] status=${report.factCheckGate.status}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { FIXTURE_CANDIDATES };
