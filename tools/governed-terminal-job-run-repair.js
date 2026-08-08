#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  applyTerminalJobRunRepair,
  planTerminalJobRunRepair,
} = require("../lib/ops/governed-terminal-job-run-repair");

const VALUE_OPTIONS = new Set([
  "database",
  "repair-id",
  "source-commit-sha",
  "executor-workspace-root",
  "operator-id",
  "change-window-id",
  "generated-at",
  "out-dir",
  "plan",
  "expected-plan-sha256",
  "confirm-repair-id",
  "backup-evidence",
  "expected-backup-evidence-sha256",
  "expected-backup-verification-sha256",
  "expected-restore-rehearsal-sha256",
  "confirm-operator-id",
  "confirm-change-window-id",
  "confirm-backup-evidence-sha256",
  "confirm-backup-verification-sha256",
  "confirm-restore-rehearsal-sha256",
]);

function parseArgs(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") {
      if (options.apply) throw new Error("duplicate_argument:apply");
      options.apply = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`unexpected_argument:${token}`);
    }
    const name = token.slice(2);
    if (!VALUE_OPTIONS.has(name)) {
      throw new Error(`unknown_argument:${name}`);
    }
    if (Object.hasOwn(options, name)) {
      throw new Error(`duplicate_argument:${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing_value:${name}`);
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function requiredOption(options, name) {
  const value = String(options[name] || "").trim();
  if (!value) throw new Error(`required_argument:${name}`);
  return value;
}

function samePath(left, right) {
  if (!left || !right) return false;
  return (
    path.resolve(String(left)).replace(/\\/g, "/").toLowerCase() ===
    path.resolve(String(right)).replace(/\\/g, "/").toLowerCase()
  );
}

function prepareOutputDirectory(outDir) {
  const resolved = path.resolve(String(outDir));
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("terminal_job_run_repair_output_directory_unsafe");
  }
  return resolved;
}

function writeExclusive(filePath, value) {
  let staged = stageExclusive(filePath, value);
  try {
    publishStagedExclusive(staged, filePath);
    staged = null;
  } finally {
    if (staged) removeOwnedArtifact(staged);
  }
}

function artifactFileIdentity(filePath) {
  try {
    const stat = fs.lstatSync(filePath, { bigint: true });
    return {
      path: path.resolve(filePath),
      canonical_path: path.resolve(fs.realpathSync.native(filePath)),
      regular_file: stat.isFile(),
      symbolic_link: stat.isSymbolicLink(),
      device_id: String(stat.dev),
      file_id: String(stat.ino),
      link_count: String(stat.nlink),
      size_bytes: String(stat.size),
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(filePath))
        .digest("hex"),
    };
  } catch {
    return null;
  }
}

function sameArtifactInode(left, right) {
  return Boolean(
    left &&
      right &&
      left.device_id === right.device_id &&
      left.file_id === right.file_id,
  );
}

function exactArtifactIdentity(identity, staged, linkCount) {
  return Boolean(
    identity &&
      identity.regular_file === true &&
      identity.symbolic_link === false &&
      samePath(identity.path, identity.canonical_path) &&
      identity.link_count === String(linkCount) &&
      identity.size_bytes === staged.size_bytes &&
      identity.sha256 === staged.sha256 &&
      sameArtifactInode(identity, staged.identity),
  );
}

function removeOwnedArtifact(record, { expectedLinkCount = null } = {}) {
  if (!record?.path || !record?.identity) return false;
  const current = artifactFileIdentity(record.path);
  if (!sameArtifactInode(current, record.identity)) return false;
  if (
    expectedLinkCount !== null &&
    !exactArtifactIdentity(current, record, expectedLinkCount)
  ) {
    return false;
  }
  fs.rmSync(record.path, { force: true });
  return true;
}

function stageExclusive(filePath, value) {
  const bytes = Buffer.from(String(value), "utf8");
  const stagedPath =
    `${filePath}.${process.pid}.${crypto.randomUUID()}.pending`;
  const descriptor = fs.openSync(stagedPath, "wx");
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const staged = {
    path: stagedPath,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    size_bytes: String(bytes.length),
    identity: artifactFileIdentity(stagedPath),
  };
  if (
    process.env.NODE_ENV === "test" &&
    process.env.PULSE_TERMINAL_REPAIR_TEST_STAGE_PATH_REPLACEMENT ===
      path.extname(filePath).slice(1)
  ) {
    fs.rmSync(stagedPath);
    fs.writeFileSync(stagedPath, "foreign pending evidence\n", {
      encoding: "utf8",
      flag: "wx",
    });
  }
  if (!exactArtifactIdentity(artifactFileIdentity(stagedPath), staged, 1)) {
    removeOwnedArtifact(staged);
    throw new Error("terminal_job_run_repair_staged_artifact_unsafe");
  }
  return staged;
}

function publishStagedExclusive(staged, targetPath) {
  const before = artifactFileIdentity(staged.path);
  if (!exactArtifactIdentity(before, staged, 1)) {
    throw new Error("terminal_job_run_repair_staged_artifact_unsafe");
  }
  let linked = false;
  try {
    fs.linkSync(staged.path, targetPath);
    linked = true;
    const linkedStage = artifactFileIdentity(staged.path);
    const linkedTarget = artifactFileIdentity(targetPath);
    if (
      !exactArtifactIdentity(linkedStage, staged, 2) ||
      !exactArtifactIdentity(linkedTarget, staged, 2) ||
      !sameArtifactInode(linkedStage, linkedTarget)
    ) {
      throw new Error("terminal_job_run_repair_linked_artifact_unsafe");
    }
    if (
      process.env.NODE_ENV === "test" &&
      process.env.PULSE_TERMINAL_REPAIR_TEST_LINKED_STAGE_REPLACEMENT ===
        path.extname(targetPath).slice(1)
    ) {
      fs.rmSync(staged.path);
      fs.writeFileSync(staged.path, "foreign pending evidence\n", {
        encoding: "utf8",
        flag: "wx",
      });
    }
    if (!removeOwnedArtifact(staged)) {
      throw new Error("terminal_job_run_repair_staged_artifact_rebound");
    }
    const published = artifactFileIdentity(targetPath);
    if (!exactArtifactIdentity(published, staged, 1)) {
      throw new Error("terminal_job_run_repair_published_artifact_unsafe");
    }
    return {
      ...staged,
      path: targetPath,
      identity: published,
    };
  } catch (error) {
    if (linked) {
      const stagedStillPresent = artifactFileIdentity(staged.path);
      removeOwnedArtifact(
        { ...staged, path: targetPath },
        {
          expectedLinkCount: sameArtifactInode(
            stagedStillPresent,
            staged.identity,
          )
            ? 2
            : 1,
        },
      );
    }
    throw error;
  }
}

function planMarkdown(plan) {
  const lines = [
    "# Governed Terminal Job-Run Repair Plan",
    "",
    `Repair ID: ${plan.repair_id || "unavailable"}`,
    `Generated: ${plan.generated_at || "unavailable"}`,
    `Verdict: ${plan.verdict}`,
    `Plan SHA-256: ${plan.plan_sha256}`,
    `Database SHA-256: ${plan.database.source_sha256}`,
    "",
    "## Classification",
    "",
    `- Eligible historical run rows: ${plan.classification.eligible_run_count}`,
    `- Affected terminal jobs: ${plan.classification.affected_job_count}`,
    `- Maximum open rows on one job: ${plan.classification.max_open_runs_per_job}`,
    "",
    "## Blockers",
    "",
  ];
  if (plan.blockers.length === 0) lines.push("- none");
  else plan.blockers.forEach((blocker) => lines.push(`- ${blocker}`));
  lines.push(
    "",
    "## Reviewed actions",
    "",
    ...plan.actions.map(
      (action) =>
        `- Run ${action.run_id} on job ${action.job_id}: close at successor run ${action.successor_run_id} start time.`,
    ),
    "",
    "> PLAN is read-only evidence. It grants no mutation, scheduler, OAuth or publication authority.",
    "",
  );
  return lines.join("\n");
}

function resultMarkdown(result) {
  const lines = [
    "# Governed Terminal Job-Run Repair Result",
    "",
    `Repair ID: ${result.repair_id || "unavailable"}`,
    `Generated: ${result.generated_at || "unavailable"}`,
    `Verdict: ${result.verdict}`,
    `Plan SHA-256: ${result.plan_sha256 || "unavailable"}`,
    "",
    "## Mutations",
    "",
  ];
  if (result.mutations_performed.length === 0) lines.push("- none");
  else {
    result.mutations_performed.forEach((mutation) =>
      lines.push(
        `- Run ${mutation.run_id} on job ${mutation.job_id}: ${mutation.status} at ${mutation.finished_at}.`,
      ),
    );
  }
  lines.push("", "## Blockers", "");
  if (result.blockers.length === 0) lines.push("- none");
  else result.blockers.forEach((blocker) => lines.push(`- ${blocker}`));
  lines.push(
    "",
    "> This operation does not contact platforms, mutate OAuth credentials or change publication state.",
    "",
  );
  return lines.join("\n");
}

function preflightArtifacts({ outDir, mode, protectedPaths }) {
  const resolvedOutDir = prepareOutputDirectory(outDir);
  const stem =
    mode === "PLAN"
      ? "governed_terminal_job_run_repair_plan"
      : "governed_terminal_job_run_repair_result";
  const jsonPath = path.join(resolvedOutDir, `${stem}.json`);
  const markdownPath = path.join(resolvedOutDir, `${stem}.md`);
  for (const outputPath of [jsonPath, markdownPath]) {
    if (protectedPaths.some((inputPath) => samePath(outputPath, inputPath))) {
      throw new Error("terminal_job_run_repair_output_collides_with_input");
    }
    if (fs.existsSync(outputPath)) {
      throw new Error("terminal_job_run_repair_artifact_already_exists");
    }
  }
  return { json: jsonPath, markdown: markdownPath };
}

function writeArtifacts({ targets, mode, value }) {
  let stagedJson = null;
  let stagedMarkdown = null;
  let publishedMarkdown = null;
  try {
    stagedJson = stageExclusive(
      targets.json,
      `${JSON.stringify(value, null, 2)}\n`,
    );
    stagedMarkdown = stageExclusive(
      targets.markdown,
      mode === "PLAN" ? planMarkdown(value) : resultMarkdown(value),
    );
    if (
      process.env.NODE_ENV === "test" &&
      process.env.PULSE_TERMINAL_REPAIR_TEST_STAGE_ALIAS === "markdown"
    ) {
      fs.linkSync(stagedMarkdown.path, `${stagedMarkdown.path}.alias`);
    }
    if (
      process.env.NODE_ENV === "test" &&
      process.env.PULSE_TERMINAL_REPAIR_TEST_ARTIFACT_RACE === "markdown"
    ) {
      fs.writeFileSync(targets.markdown, "racing immutable evidence\n", {
        encoding: "utf8",
        flag: "wx",
      });
    }
    publishedMarkdown = publishStagedExclusive(
      stagedMarkdown,
      targets.markdown,
    );
    stagedMarkdown = null;
    if (
      process.env.NODE_ENV === "test" &&
      process.env.PULSE_TERMINAL_REPAIR_TEST_ARTIFACT_REPLACEMENT ===
        "markdown"
    ) {
      fs.rmSync(targets.markdown);
      fs.writeFileSync(targets.markdown, "foreign racing evidence\n", {
        encoding: "utf8",
        flag: "wx",
      });
      throw new Error("terminal_job_run_repair_test_artifact_replacement");
    }
    if (
      process.env.NODE_ENV === "test" &&
      process.env.PULSE_TERMINAL_REPAIR_TEST_ARTIFACT_FAILURE ===
        "before-json-publish"
    ) {
      throw new Error("terminal_job_run_repair_test_artifact_failure");
    }
    publishStagedExclusive(stagedJson, targets.json);
    stagedJson = null;
    return targets;
  } catch (error) {
    if (stagedJson) removeOwnedArtifact(stagedJson);
    if (stagedMarkdown) removeOwnedArtifact(stagedMarkdown);
    if (publishedMarkdown) {
      removeOwnedArtifact(publishedMarkdown, { expectedLinkCount: 1 });
    }
    throw error;
  }
}

function committedArtifactHold(result) {
  const thisInvocationMutated =
    result?.safety?.production_database_mutated === true;
  return {
    ...result,
    verdict: "COMMITTED_HOLD",
    blockers: [
      ...new Set([
        ...(result.blockers || []),
        "terminal_job_run_repair_result_artifact_incomplete",
      ]),
    ],
    committed_state: {
      previously_committed: true,
      this_invocation_mutated: thisInvocationMutated,
    },
    safety: {
      ...result.safety,
      production_database_mutated: thisInvocationMutated,
    },
  };
}

function isCommittedStateResult(result) {
  return (
    result?.safety?.production_database_mutated === true ||
    ["APPLIED", "COMMITTED_HOLD", "IDEMPOTENT_NOOP"].includes(
      result?.verdict,
    )
  );
}

function writeEmergencyCommittedHold(outDir, result, protectedPaths) {
  const target = path.join(
    prepareOutputDirectory(outDir),
    "governed_terminal_job_run_repair_committed_hold.json",
  );
  if (protectedPaths.some((inputPath) => samePath(target, inputPath))) {
    throw new Error("terminal_job_run_repair_output_collides_with_input");
  }
  writeExclusive(target, `${JSON.stringify(result, null, 2)}\n`);
  return { committed_hold_json: target };
}

function publicSummary(value, artifacts) {
  return {
    mode: value.mode,
    verdict: value.verdict,
    repair_id: value.repair_id,
    plan_sha256: value.plan_sha256,
    blockers: value.blockers,
    artifacts,
  };
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const databasePath = requiredOption(options, "database");
  const outDir = requiredOption(options, "out-dir");
  if (!options.apply) {
    if (options.plan) throw new Error("plan_input_requires_apply");
    const plan = planTerminalJobRunRepair({
      databasePath,
      generatedAt: options["generated-at"] || new Date(),
      repairId: requiredOption(options, "repair-id"),
      sourceCommitSha: requiredOption(options, "source-commit-sha"),
      operatorId: requiredOption(options, "operator-id"),
      changeWindowId: requiredOption(options, "change-window-id"),
      backupEvidencePath: requiredOption(options, "backup-evidence"),
      expectedBackupEvidenceSha256: requiredOption(
        options,
        "expected-backup-evidence-sha256",
      ),
      expectedBackupVerificationSha256: requiredOption(
        options,
        "expected-backup-verification-sha256",
      ),
      expectedRestoreRehearsalSha256: requiredOption(
        options,
        "expected-restore-rehearsal-sha256",
      ),
      executorWorkspaceRoot: path.resolve(
        requiredOption(options, "executor-workspace-root"),
      ),
      executorInspector: dependencies.executorInspector,
      executorModulePath: path.resolve(
        __dirname,
        "../lib/ops/governed-terminal-job-run-repair.js",
      ),
      executorEntrypointPath: __filename,
    });
    const targets = preflightArtifacts({
      outDir,
      mode: "PLAN",
      protectedPaths: [
        databasePath,
        options["backup-evidence"],
        plan.backup_authority.backup_verification_path,
        plan.backup_authority.restore_rehearsal_path,
      ],
    });
    const artifacts = writeArtifacts({
      targets,
      mode: "PLAN",
      value: plan,
    });
    process.stdout.write(`${JSON.stringify(publicSummary(plan, artifacts), null, 2)}\n`);
    process.exitCode = plan.verdict === "READY_TO_APPLY" ? 0 : 2;
    return;
  }

  const planPath = path.resolve(requiredOption(options, "plan"));
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const targets = preflightArtifacts({
    outDir,
    mode: "APPLY",
    protectedPaths: [
      databasePath,
      planPath,
      options["backup-evidence"],
      plan.backup_authority?.backup_verification_path,
      plan.backup_authority?.restore_rehearsal_path,
    ],
  });
  const result = applyTerminalJobRunRepair({
    databasePath,
    plan,
    expectedPlanSha256: options["expected-plan-sha256"],
    confirmationRepairId: options["confirm-repair-id"],
    backupEvidencePath: options["backup-evidence"],
    expectedBackupEvidenceSha256:
      options["confirm-backup-evidence-sha256"],
    expectedBackupVerificationSha256:
      options["confirm-backup-verification-sha256"],
    expectedRestoreRehearsalSha256:
      options["confirm-restore-rehearsal-sha256"],
    confirmationOperatorId: options["confirm-operator-id"],
    confirmationChangeWindowId: options["confirm-change-window-id"],
    executorWorkspaceRoot: path.resolve(
      requiredOption(options, "executor-workspace-root"),
    ),
    executorInspector: dependencies.executorInspector,
    executorModulePath: path.resolve(
      __dirname,
      "../lib/ops/governed-terminal-job-run-repair.js",
    ),
    executorEntrypointPath: __filename,
  });
  let artifacts;
  try {
    artifacts = writeArtifacts({
      targets,
      mode: "APPLY",
      value: result,
    });
  } catch (error) {
    if (isCommittedStateResult(result)) {
      const committedHold = committedArtifactHold(result);
      try {
        artifacts = writeEmergencyCommittedHold(outDir, committedHold, [
          databasePath,
          planPath,
          options["backup-evidence"],
          plan.backup_authority?.backup_verification_path,
          plan.backup_authority?.restore_rehearsal_path,
        ]);
      } catch {
        committedHold.blockers.push(
          "terminal_job_run_repair_emergency_artifact_unavailable",
        );
        artifacts = {};
      }
      process.stdout.write(
        `${JSON.stringify(publicSummary(committedHold, artifacts), null, 2)}\n`,
      );
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  process.stdout.write(`${JSON.stringify(publicSummary(result, artifacts), null, 2)}\n`);
  process.exitCode = ["APPLIED", "IDEMPOTENT_NOOP"].includes(result.verdict)
    ? 0
    : 2;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        mode: "HOLD",
        verdict: "HOLD",
        blockers: [String(error?.message || "terminal_job_run_repair_failed")],
      })}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
