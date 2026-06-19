"use strict";

const path = require("node:path");
const fs = require("fs-extra");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function bridgeRows(document = {}) {
  if (Array.isArray(document)) return document.filter(Boolean);
  if (Array.isArray(document.scheduler_bridge_candidates)) return document.scheduler_bridge_candidates.filter(Boolean);
  if (Array.isArray(document.bridge_candidates)) return document.bridge_candidates.filter(Boolean);
  if (Array.isArray(document.candidates)) return document.candidates.filter(Boolean);
  return [];
}

function replaceBridgeRows(document = {}, rows = []) {
  if (Array.isArray(document)) return rows;
  if (Array.isArray(document.scheduler_bridge_candidates)) {
    return { ...document, scheduler_bridge_candidates: rows };
  }
  if (Array.isArray(document.bridge_candidates)) {
    return { ...document, bridge_candidates: rows };
  }
  if (Array.isArray(document.candidates)) {
    return { ...document, candidates: rows };
  }
  return { ...document, scheduler_bridge_candidates: rows };
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (filePath && await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function artifactDirForCandidate(candidate = {}) {
  return clean(
    candidate.scheduler_bridge_artifact_dir ||
      candidate.artifact_dir ||
      candidate.output_dir ||
      candidate.package_dir,
  );
}

function renderManifestPathForCandidate(candidate = {}) {
  const explicit = clean(candidate.render_manifest_path);
  if (explicit) return explicit;
  const artifactDir = artifactDirForCandidate(candidate);
  return artifactDir ? path.join(artifactDir, "render_manifest.json") : "";
}

function audioManifestPathForCandidate(candidate = {}) {
  const explicit = clean(candidate.audio_manifest_path);
  if (explicit) return explicit;
  const artifactDir = artifactDirForCandidate(candidate);
  return artifactDir ? path.join(artifactDir, "audio_manifest.json") : "";
}

function platformManifestPathForCandidate(candidate = {}) {
  const explicit = clean(candidate.platform_publish_manifest_path);
  if (explicit) return explicit;
  const artifactDir = artifactDirForCandidate(candidate);
  return artifactDir ? path.join(artifactDir, "platform_publish_manifest.json") : "";
}

function renderedDuration(manifest = {}) {
  return (
    numberOrNull(manifest.rendered_duration_s) ||
    numberOrNull(manifest.duration_seconds) ||
    numberOrNull(manifest.duration_s) ||
    numberOrNull(manifest.video_duration_s)
  );
}

function audioDuration(audioManifest = {}, fallback = null) {
  return (
    numberOrNull(audioManifest.audio_duration_seconds) ||
    numberOrNull(audioManifest.duration_seconds) ||
    numberOrNull(audioManifest.narration_audio_duration_seconds) ||
    numberOrNull(audioManifest.timestamp_whisper_alignment?.duration_seconds) ||
    fallback
  );
}

function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(3)) : null;
}

function candidateId(candidate = {}) {
  return clean(candidate.story_id || candidate.id);
}

function selectedStoryIdSet(storyIds = []) {
  return new Set(asArray(storyIds).map(clean).filter(Boolean));
}

async function refreshCandidate(candidate = {}, { generatedAt = new Date().toISOString() } = {}) {
  const id = candidateId(candidate);
  const renderManifestPath = renderManifestPathForCandidate(candidate);
  const audioManifestPath = audioManifestPathForCandidate(candidate);
  const platformManifestPath = platformManifestPathForCandidate(candidate);
  const renderManifest = await readJsonIfPresent(renderManifestPath, null);
  const audioManifest = await readJsonIfPresent(audioManifestPath, {});
  const platformManifest = await readJsonIfPresent(platformManifestPath, null);
  const duration = renderManifest ? renderedDuration(renderManifest) : null;
  if (!duration) {
    return {
      candidate,
      row: {
        story_id: id,
        action: "blocked",
        blockers: ["render_manifest_duration_missing"],
        render_manifest_path: renderManifestPath || null,
      },
    };
  }
  const next = {
    ...candidate,
    duration_seconds: round(duration),
    video_duration_seconds: round(duration),
    final_duration_seconds: round(duration),
    audio_duration: round(audioDuration(audioManifest, duration)),
    bridge_metadata_refreshed_at: generatedAt,
    bridge_metadata_refresh_source: "current_render_audio_manifests",
    bridge_metadata_refresh_render_manifest_path: renderManifestPath || null,
    bridge_metadata_refresh_audio_manifest_path: audioManifestPath || null,
    ...(platformManifest && Object.keys(platformManifest).length
      ? {
          platform_publish_manifest: platformManifest,
          bridge_metadata_refresh_platform_manifest_path: platformManifestPath || null,
        }
      : {}),
  };
  return {
    candidate: next,
    row: {
      story_id: id,
      action: "refreshed",
      before: {
        duration_seconds: numberOrNull(candidate.duration_seconds),
        audio_duration: numberOrNull(candidate.audio_duration),
        video_duration_seconds: numberOrNull(candidate.video_duration_seconds),
        final_duration_seconds: numberOrNull(candidate.final_duration_seconds),
      },
      after: {
        duration_seconds: next.duration_seconds,
        audio_duration: next.audio_duration,
        video_duration_seconds: next.video_duration_seconds,
        final_duration_seconds: next.final_duration_seconds,
        platform_manifest_refreshed: Boolean(platformManifest && Object.keys(platformManifest).length),
      },
      render_manifest_path: renderManifestPath || null,
      audio_manifest_path: audioManifestPath || null,
      platform_publish_manifest_path: platformManifestPath || null,
    },
  };
}

async function refreshBridgeCandidateMetadata({
  bridgePath,
  storyIds = [],
  generatedAt = new Date().toISOString(),
  apply = false,
} = {}) {
  if (!bridgePath) throw new Error("bridge_candidate_metadata_refresh_requires_bridge_path");
  const absoluteBridgePath = path.resolve(bridgePath);
  const original = await fs.readJson(absoluteBridgePath);
  const document = clone(original);
  const ids = selectedStoryIdSet(storyIds);
  const rows = bridgeRows(document);
  const outputRows = [];
  const reportRows = [];

  for (const row of rows) {
    const id = candidateId(row);
    if (ids.size > 0 && !ids.has(id)) {
      outputRows.push(row);
      continue;
    }
    const refreshed = await refreshCandidate(row, { generatedAt });
    outputRows.push(refreshed.candidate);
    reportRows.push(refreshed.row);
  }

  const nextDocument = replaceBridgeRows(document, outputRows);
  if (apply) {
    await fs.writeJson(absoluteBridgePath, nextDocument, { spaces: 2 });
  }

  const refreshedCount = reportRows.filter((row) => row.action === "refreshed").length;
  const blockedCount = reportRows.filter((row) => row.action !== "refreshed").length;
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: apply ? "apply_file_repair" : "dry_run_no_file_write",
    bridge_path: absoluteBridgePath,
    summary: {
      candidate_count: rows.length,
      selected_count: ids.size || rows.length,
      inspected_count: reportRows.length,
      refreshed_count: refreshedCount,
      blocked_count: blockedCount,
    },
    rows: reportRows,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      mutates_bridge_file: apply === true,
    },
  };
}

module.exports = {
  bridgeRows,
  refreshBridgeCandidateMetadata,
  refreshCandidate,
};
