"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { evaluateIncidentGuard } = require("./incident-guard");
const { auditPublicOutputCoherenceArtifact } = require("./public-output-coherence-artifact");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (filePath && await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function words(value = "") {
  return clean(value).split(/\s+/).filter(Boolean);
}

function equivalentPublicCopy(left, right) {
  return clean(left)
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim() === clean(right)
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function currentManifestSnapshot(canonical = {}) {
  return {
    story_id: canonical.story_id || canonical.id || null,
    canonical_subject: clean(canonical.canonical_subject || canonical.canonical_game),
    canonical_game: clean(canonical.canonical_game),
    canonical_company: clean(canonical.canonical_company),
    selected_title: clean(canonical.selected_title || canonical.short_title || canonical.title),
    thumbnail_headline: clean(canonical.thumbnail_headline || canonical.thumbnail_text || canonical.cover_headline),
    first_spoken_line: clean(canonical.first_spoken_line || canonical.narration_hook || canonical.hook),
    narration_script: clean(canonical.narration_script || canonical.full_script || canonical.tts_script || canonical.script),
    description: clean(canonical.description),
    source_card_label: clean(canonical.source_card_label || canonical.primary_source?.name || canonical.primary_source),
    primary_source: canonical.primary_source || null,
    primary_source_url: clean(canonical.primary_source_url || canonical.source_url || canonical.article_url || canonical.url),
    discovery_source: canonical.discovery_source || null,
    official_source: canonical.official_source || null,
  };
}

const RENDER_SNAPSHOT_FIELDS = [
  "selected_title",
  "thumbnail_headline",
  "first_spoken_line",
  "narration_script",
  "description",
];

function renderSnapshotFreshnessBlockers({ currentSnapshot = {}, renderManifest = {} } = {}) {
  const snapshot = renderManifest?.input_fingerprint?.canonical_snapshot;
  if (!snapshot || typeof snapshot !== "object") return [];

  const staleFields = [];
  for (const field of RENDER_SNAPSHOT_FIELDS) {
    const current = currentSnapshot[field];
    const rendered = snapshot[field];
    if (!clean(current) || !clean(rendered)) continue;
    if (!equivalentPublicCopy(current, rendered)) staleFields.push(field);
  }

  if (staleFields.length === 0) return [];
  return [
    "render_snapshot_stale",
    ...staleFields.map((field) => `render_snapshot_stale_field:${field}`),
  ];
}

async function buildCurrentCoherenceReport({
  artifactDir = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const visualQualityReport = await readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"), {});
  const benchmarkReport = await readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"), {});
  const sfxManifest = await readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {});
  const publishVerdict = await readJsonIfPresent(path.join(artifactDir, "publish_verdict.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const policyReport = await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"), {});
  const landingPageManifest = await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"), {});
  const affiliateManifest = await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {});
  const incident = evaluateIncidentGuard({
    story_id: canonical.story_id || canonical.id || path.basename(artifactDir),
    canonical_story_manifest: canonical,
    render_manifest: renderManifest,
    visual_quality_report: visualQualityReport,
    benchmark_report: benchmarkReport,
    sfx_manifest: sfxManifest,
    publish_verdict: publishVerdict,
    platform_publish_manifest: platformManifest,
    platform_policy_report: policyReport,
    landing_page_manifest: landingPageManifest,
    affiliate_link_manifest: affiliateManifest,
  });
  const publicOutput = incident.public_output_coherence_report || {};
  const blockers = asArray(publicOutput.blockers).map(clean).filter(Boolean);
  const manifest = currentManifestSnapshot(canonical);
  const renderSnapshotBlockers = renderSnapshotFreshnessBlockers({
    currentSnapshot: manifest,
    renderManifest,
  });
  const failures = [...blockers, ...renderSnapshotBlockers];
  const result = publicOutput.verdict === "pass" && failures.length === 0 ? "pass" : "fail";
  return {
    schema_version: 1,
    generated_at: generatedAt,
    result,
    verdict: result,
    failures: result === "pass" ? [] : failures,
    warnings: asArray(incident.warnings).map(clean).filter(Boolean),
    manifest,
    metrics: {
      thumbnail_word_count: words(manifest.thumbnail_headline).length,
      public_title_word_count: words(manifest.selected_title).length,
      caption_evidence: incident.evidence?.file_evidence?.captions_ready === true,
      render_snapshot_checked: Boolean(renderManifest?.input_fingerprint?.canonical_snapshot),
    },
    raw_failures: result === "pass" ? [] : failures,
    repair_source: "current_canonical_manifest_and_incident_guard",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function repairTargetsFromDryRunPlan(plan = {}) {
  const rows = [
    ...asArray(plan.blocked_stories),
    ...asArray(plan.held_stories),
  ];
  return rows
    .filter((row) =>
      asArray(row.blockers).some((blocker) =>
        /stale_public_output_coherence_report|coherence_report_not_pass/.test(clean(blocker)),
      ),
    )
    .map((row) => ({
      story_id: clean(row.story_id),
      artifact_dir: clean(row.artifact_dir),
      blockers: asArray(row.blockers).map(clean).filter(Boolean),
    }))
    .filter((row) => row.story_id && row.artifact_dir);
}

async function repairCoherenceArtifacts({
  dryRunPlan = {},
  generatedAt = new Date().toISOString(),
  apply = false,
} = {}) {
  const targets = repairTargetsFromDryRunPlan(dryRunPlan);
  const rows = [];
  for (const target of targets) {
    const report = await buildCurrentCoherenceReport({
      artifactDir: target.artifact_dir,
      generatedAt,
    });
    const audit = await auditPublicOutputCoherenceArtifact({
      artifactDir: target.artifact_dir,
      canonical: report.manifest,
      coherenceReport: report,
    });
    const outPath = path.join(target.artifact_dir, "coherence_report.json");
    if (apply) await fs.writeJson(outPath, report, { spaces: 2 });
    rows.push({
      story_id: target.story_id,
      artifact_dir: target.artifact_dir,
      output_path: outPath,
      previous_blockers: target.blockers,
      repaired_report_result: report.result,
      freshness_after_repair: audit.status,
      remaining_blockers: audit.blockers,
      written: apply === true,
    });
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: apply ? "apply_file_repair" : "dry_run_no_file_write",
    summary: {
      target_count: targets.length,
      written_count: apply ? rows.length : 0,
      freshness_pass_count: rows.filter((row) => row.freshness_after_repair === "fresh").length,
      remaining_blocked_count: rows.filter((row) => row.remaining_blockers.length > 0).length,
    },
    rows,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

module.exports = {
  buildCurrentCoherenceReport,
  repairCoherenceArtifacts,
  repairTargetsFromDryRunPlan,
  renderSnapshotFreshnessBlockers,
};
