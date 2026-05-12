#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildLocalEnvCleanupPlan,
  formatLocalEnvCleanupPlanMarkdown,
} = require("../lib/ops/local-env-cleanup-plan");

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const envPath = path.join(process.cwd(), ".env");
  const envText = (await fs.pathExists(envPath))
    ? await fs.readFile(envPath, "utf8")
    : "";
  const plan = buildLocalEnvCleanupPlan({ envText });
  const markdown = formatLocalEnvCleanupPlanMarkdown(plan);
  const outputDir = path.join(process.cwd(), "test", "output");
  await fs.ensureDir(outputDir);
  await fs.writeJson(path.join(outputDir, "local_env_cleanup_plan.json"), plan, {
    spaces: 2,
  });
  await fs.writeFile(path.join(outputDir, "local_env_cleanup_plan.md"), markdown);
  await fs.writeFile(path.join(process.cwd(), "LOCAL_ENV_CLEANUP_PLAN.md"), markdown);

  if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    process.stdout.write(markdown);
    process.stderr.write(
      `[local-env-cleanup-plan] json=${path.join(outputDir, "local_env_cleanup_plan.json")}\n`,
    );
  }
  if (plan.verdict === "red") process.exitCode = 2;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-env-cleanup-plan] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
