#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function formatTimestamp(seconds) {
  const totalMilliseconds = Math.round(Number(seconds) * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function validateCaptionGroups(document) {
  if (
    !document ||
    !Number.isFinite(document.total_duration_s) ||
    document.total_duration_s <= 0 ||
    !Array.isArray(document.groups) ||
    document.groups.length === 0
  ) {
    throw new Error("caption_groups_document_invalid");
  }
  let previousEnd = 0;
  for (const group of document.groups) {
    if (
      !Number.isFinite(group?.start) ||
      !Number.isFinite(group?.end) ||
      group.start < 0 ||
      group.end <= group.start ||
      typeof group.text !== "string" ||
      group.text.trim().length === 0
    ) {
      throw new Error("caption_group_invalid");
    }
    if (group.start + 0.0005 < previousEnd) {
      throw new Error("caption_groups_overlap");
    }
    if (group.end > document.total_duration_s + 0.01) {
      throw new Error("caption_group_outside_programme");
    }
    previousEnd = group.end;
  }
  return true;
}

function renderSrt(document) {
  validateCaptionGroups(document);
  return `${document.groups
    .map(
      (group, index) =>
        `${index + 1}\n${formatTimestamp(group.start)} --> ${formatTimestamp(group.end)}\n${group.text.trim()}`,
    )
    .join("\n\n")}\n`;
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--project-root") {
    throw new Error("usage: node tools/system-trace-caption-export.js --project-root <path>");
  }
  return { projectRoot: path.resolve(argv[1]) };
}

function main(argv = process.argv.slice(2)) {
  const { projectRoot } = parseArgs(argv);
  const sourcePath = path.join(projectRoot, "caption_groups.json");
  const outputPath = path.join(projectRoot, "captions.srt");
  const document = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const bytes = Buffer.from(renderSrt(document), "utf8");
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, bytes, { flag: "wx" });
  fs.renameSync(temporaryPath, outputPath);
  process.stdout.write(
    `${JSON.stringify({ ok: true, source: sourcePath, output: outputPath, cues: document.groups.length, bytes: bytes.length })}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  formatTimestamp,
  main,
  renderSrt,
  validateCaptionGroups,
};
