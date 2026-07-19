"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  inspectCandidateEvidence,
} = require("./candidate-authority-refresh");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

async function importLocalArtifactStoryPackage({
  artifactDir,
  storyId,
  outPath = "",
  generatedAt = new Date().toISOString(),
  apply = false,
  inspectEvidence = inspectCandidateEvidence,
} = {}) {
  const resolvedArtifactDir = path.resolve(cleanText(artifactDir));
  if (!cleanText(artifactDir) || !(await fs.pathExists(resolvedArtifactDir))) {
    throw new Error("artifact_dir_missing");
  }
  const canonicalPath = path.join(resolvedArtifactDir, "canonical_story_manifest.json");
  if (!(await fs.pathExists(canonicalPath))) throw new Error("canonical_story_manifest_missing");
  const canonical = await fs.readJson(canonicalPath);
  const canonicalStoryId = cleanText(canonical.story_id || canonical.id);
  const resolvedStoryId = cleanText(storyId || canonicalStoryId);
  if (!resolvedStoryId) throw new Error("story_id_missing");
  if (canonicalStoryId && canonicalStoryId !== resolvedStoryId) {
    throw new Error("canonical_story_id_mismatch");
  }

  const artifactEvidence = await inspectEvidence({
    artifactDir: resolvedArtifactDir,
    storyId: resolvedStoryId,
  });
  const blockers = unique([
    ...(artifactEvidence.blockers || []),
    "platform_native_authority_not_evaluated",
    "control_tower_authority_not_evaluated",
  ]);
  const storyPackage = {
    id: resolvedStoryId,
    story_id: resolvedStoryId,
    artifact_dir: resolvedArtifactDir,
    selected_title: cleanText(
      canonical.selected_title ||
        canonical.public_title ||
        canonical.canonical_title ||
        canonical.title,
    ) || null,
    verdict: "RED",
    publish_status: "RED",
    can_auto_publish: false,
    blockers,
    warnings: unique(artifactEvidence.warnings || []),
    artifact_evidence: {
      verdict: cleanText(artifactEvidence.verdict) || "RED",
      can_auto_publish: artifactEvidence.can_auto_publish === true,
      blockers: unique(artifactEvidence.blockers || []),
      warnings: unique(artifactEvidence.warnings || []),
      frozen_hashes: artifactEvidence.fingerprints || {},
    },
    local_artifact_import: {
      schema_version: 1,
      generated_at: generatedAt,
      source: "current_artifact_directory",
      monotonic_verdict: true,
      source_workspace_evidence_ignored: true,
    },
  };

  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "DRY_RUN",
    applied: false,
    output_path: cleanText(outPath) ? path.resolve(outPath) : null,
    story_packages: [storyPackage],
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_runtime_change: true,
      output_is_local_proof_only: true,
    },
  };
  if (!apply) return report;
  if (!cleanText(outPath)) throw new Error("output_path_required_for_apply");

  const resolvedOutPath = path.resolve(outPath);
  const outputDir = path.dirname(resolvedOutPath);
  const tempPath = path.join(
    outputDir,
    `.${path.basename(resolvedOutPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  await fs.ensureDir(outputDir);
  await fs.writeJson(tempPath, report.story_packages, { spaces: 2 });
  const finalInspection = await inspectEvidence({
    artifactDir: resolvedArtifactDir,
    storyId: resolvedStoryId,
  });
  if (
    JSON.stringify(finalInspection.fingerprints || {}) !==
    JSON.stringify(artifactEvidence.fingerprints || {})
  ) {
    await fs.remove(tempPath);
    throw new Error("critical_artifact_evidence_changed_during_import");
  }

  let backupPath = null;
  if (await fs.pathExists(resolvedOutPath)) {
    const backupDir = path.join(outputDir, ".local-artifact-import-backups");
    await fs.ensureDir(backupDir);
    backupPath = path.join(
      backupDir,
      `${path.basename(resolvedOutPath)}.${generatedAt.replace(/[:.]/g, "-")}.bak`,
    );
    await fs.copy(resolvedOutPath, backupPath, { overwrite: false });
  }
  await fs.move(tempPath, resolvedOutPath, { overwrite: true });
  report.mode = "APPLY";
  report.applied = true;
  report.output_path = resolvedOutPath;
  report.backup_path = backupPath;
  return report;
}

module.exports = {
  importLocalArtifactStoryPackage,
};
