"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const {
  compareForensicReports,
  buildComparisonMarkdown,
} = require("../lib/studio/v2/forensic-qa-v2");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

function argValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function main() {
  const beforePath = argValue("--before");
  const afterPath = argValue("--after");
  const outStem = argValue("--out") || "qa_forensic_comparison";
  if (!beforePath || !afterPath) {
    throw new Error(
      "Usage: node tools/studio-v2-forensic-compare.js --before=before.json --after=after.json [--out=name]",
    );
  }

  const before = await fs.readJson(path.resolve(ROOT, beforePath));
  const after = await fs.readJson(path.resolve(ROOT, afterPath));
  const comparison = compareForensicReports(before, after);
  const jsonPath = path.join(TEST_OUT, `${outStem}.json`);
  const mdPath = path.join(TEST_OUT, `${outStem}.md`);
  await fs.writeJson(jsonPath, comparison, { spaces: 2 });
  await fs.writeFile(mdPath, buildComparisonMarkdown(comparison));

  console.log(`[qa-compare] verdict: ${comparison.verdict}`);
  console.log(
    `[qa-compare] issues: ${comparison.before.issueCount} -> ${comparison.after.issueCount}`,
  );
  console.log(
    `[qa-compare] SFX cues: ${comparison.before.declaredSfxCueCount} -> ${comparison.after.declaredSfxCueCount}`,
  );
  console.log(`[qa-compare] json: ${path.relative(ROOT, jsonPath)}`);
  console.log(`[qa-compare] md:   ${path.relative(ROOT, mdPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
