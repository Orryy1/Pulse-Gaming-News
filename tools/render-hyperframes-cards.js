"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");

const CARDS = [
  {
    name: "source",
    project: path.join(ROOT, "experiments", "hf-source"),
    output: path.join(TEST_OUT, "hf_source_card_v1.mp4"),
  },
  {
    name: "context",
    project: path.join(ROOT, "experiments", "hf-context"),
    output: path.join(TEST_OUT, "hf_context_card_v1.mp4"),
  },
];

function runHyperframes(args, cwd) {
  const quoted = args
    .map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(" ");
  execSync(`npx hyperframes ${quoted}`, {
    cwd,
    stdio: "inherit",
  });
}

async function main() {
  await fs.ensureDir(TEST_OUT);
  for (const card of CARDS) {
    console.log(`[hf] lint ${card.name}`);
    runHyperframes(["lint"], card.project);
    console.log(`[hf] render ${card.name} -> ${card.output}`);
    runHyperframes(
      [
        "render",
        ".",
        "-o",
        card.output,
        "-f",
        "30",
        "-q",
        "standard",
      ],
      card.project,
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
