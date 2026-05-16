#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true, quiet: true });

const mediaPaths = require("../lib/media-paths");
const {
  buildLocalTtsProofPromotionReport,
  collectLocalTtsProofRows,
  renderLocalTtsProofPromotionMarkdown,
  timestampCandidatesForRow,
} = require("../lib/studio/local-tts-proof-promoter");
const {
  loadLocalTtsProofReports,
} = require("../lib/studio/local-tts-proof-report-loader");
const {
  resolveAcceptedLocalVoiceReference,
} = require("../lib/studio/v2/local-voice-reference");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    outDir: OUT,
    json: false,
    writeRootReport: true,
    failOnBlocker: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") args.outDir = argv[++i] || OUT;
    else if (arg === "--json") args.json = true;
    else if (arg === "--no-root-report") args.writeRootReport = false;
    else if (arg === "--fail-on-blocker") args.failOnBlocker = true;
  }
  return args;
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function readTimestampPayload(candidate) {
  if (!candidate) return null;
  const pathsToTry = [];
  if (path.isAbsolute(candidate)) pathsToTry.push(candidate);
  const resolved = await mediaPaths.resolveExisting(candidate).catch(() => null);
  if (resolved) pathsToTry.push(resolved);

  for (const filePath of [...new Set(pathsToTry)]) {
    try {
      if (await fs.pathExists(filePath)) {
        return {
          path: filePath,
          payload: await fs.readJson(filePath),
        };
      }
    } catch {
      // Try the next candidate. A bad sidecar is reported as missing evidence.
    }
  }
  return null;
}

async function loadTimestampPayloadsForRows(rows = []) {
  const payloads = {};
  for (const row of rows) {
    for (const candidate of timestampCandidatesForRow(row)) {
      const loaded = await readTimestampPayload(candidate);
      if (!loaded) continue;
      payloads[candidate] = loaded.payload;
      payloads[loaded.path] = loaded.payload;
      break;
    }
  }
  return payloads;
}

async function writePromotionReport({
  report,
  outDir = OUT,
  root = ROOT,
  writeRootReport = true,
} = {}) {
  if (!report || typeof report !== "object") {
    throw new Error("writePromotionReport requires a report object");
  }
  const absoluteOutDir = path.resolve(outDir);
  await fs.ensureDir(absoluteOutDir);
  const jsonPath = path.join(absoluteOutDir, "local_tts_proof_promotion.json");
  const mdPath = path.join(absoluteOutDir, "local_tts_proof_promotion.md");
  const rootPath = writeRootReport
    ? path.join(path.resolve(root), "LOCAL_TTS_PROOF_RENDER_PROMOTION_REPORT.md")
    : null;
  const reportPaths = {
    jsonPath,
    mdPath,
    rootPath,
  };
  const reportWithPaths = {
    ...report,
    report_paths: reportPaths,
  };
  const markdown = renderLocalTtsProofPromotionMarkdown(reportWithPaths);
  await fs.writeJson(jsonPath, reportWithPaths, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  if (rootPath) {
    await fs.writeFile(rootPath, markdown, "utf8");
  }
  return reportPaths;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const outDir = path.resolve(args.outDir || OUT);
  await fs.ensureDir(outDir);

  const doctorReport = await readJsonIfExists(path.join(outDir, "local_tts_doctor.json"));
  const overnightReport = await readJsonIfExists(path.join(outDir, "local_tts_overnight_report.json"));
  const proofReports = await loadLocalTtsProofReports({ outDir });
  const rows = collectLocalTtsProofRows({ proofReports, overnightReport });
  const timestampPayloads = await loadTimestampPayloadsForRows(rows.applied);
  const report = buildLocalTtsProofPromotionReport({
    acceptedReference: resolveAcceptedLocalVoiceReference(process.env),
    doctorReport,
    overnightReport,
    proofReports,
    timestampPayloads,
  });
  const paths = await writePromotionReport({
    report,
    outDir,
    root: ROOT,
    writeRootReport: args.writeRootReport,
  });
  const reportWithPaths = {
    ...report,
    report_paths: paths,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(reportWithPaths, null, 2)}\n`);
  } else {
    console.log(`[local-tts-proof-promoter] verdict=${report.verdict}`);
    console.log(
      `[local-tts-proof-promoter] can_replace_elevenlabs_for_proof_renders=${report.can_replace_elevenlabs_for_proof_renders}`,
    );
    if (report.blockers.length) {
      console.log(`[local-tts-proof-promoter] blockers=${report.blockers.join(", ")}`);
    }
    console.log(`[local-tts-proof-promoter] json=${path.relative(ROOT, paths.jsonPath)}`);
    console.log(`[local-tts-proof-promoter] md=${path.relative(ROOT, paths.mdPath)}`);
    if (paths.rootPath) {
      console.log(`[local-tts-proof-promoter] report=${path.relative(ROOT, paths.rootPath)}`);
    }
  }

  if (args.failOnBlocker && report.can_replace_elevenlabs_for_proof_renders !== true) {
    process.exitCode = 1;
  }
  return reportWithPaths;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[local-tts-proof-promoter] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  loadTimestampPayloadsForRows,
  main,
  parseArgs,
  writePromotionReport,
};
