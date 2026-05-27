"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const { mediaSourceUrlKindFields } = require("../../media-source-url-kind");
const { normaliseText } = require("../../text-hygiene");

const VIDEO_FILE_RE = /\.(?:mp4|webm|mov)$/i;
const RENDER_ELIGIBLE_KINDS = new Set(["direct_video", "hls_manifest", "dash_manifest", "local_video_file"]);
const YOUTUBE_KINDS = new Set(["youtube_watch", "youtube_short", "youtube_embed", "youtube_page"]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "object") return [value];
  return [];
}

function cleanText(value) {
  return normaliseText(String(value || "")).replace(/\s+/g, " ").trim();
}

function normaliseFamily(value) {
  return (
    cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || null
  );
}

function bool(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const text = cleanText(value).toLowerCase();
  return ["true", "yes", "y", "1", "approved", "operator_approved"].includes(text);
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function sourceKey(storyId, sourceFamily) {
  return `${cleanText(storyId)}::${normaliseFamily(sourceFamily) || cleanText(sourceFamily)}`;
}

function sourceUrlKind(url) {
  return mediaSourceUrlKindFields(url || "");
}

function isRenderEligibleUrl(url) {
  const kind = sourceUrlKind(url);
  return kind.segment_validation_eligible && RENDER_ELIGIBLE_KINDS.has(kind.source_url_kind);
}

function sourceKindFromCandidate(candidate = {}) {
  return firstText(
    candidate.source_url_kind,
    sourceUrlKind(
      firstText(
        candidate.approved_direct_media_url,
        candidate.direct_media_url,
        candidate.direct_media_url_if_available,
        candidate.source_url,
        candidate.official_source_url,
      ),
    ).source_url_kind,
  );
}

function isYouTubeReference(candidate = {}) {
  const kind = sourceKindFromCandidate(candidate);
  if (YOUTUBE_KINDS.has(kind)) return true;
  const url = firstText(candidate.official_source_url, candidate.reference_url, candidate.source_url);
  return YOUTUBE_KINDS.has(sourceUrlKind(url).source_url_kind);
}

function isTrustedCreator(candidate = {}) {
  const text = [
    candidate.source_tier,
    candidate.source_type,
    candidate.rights_risk_class,
    candidate.allowed_render_use,
  ]
    .map(cleanText)
    .join(" ")
    .toLowerCase();
  return /trusted_creator|licensed_creator|creator_reference/.test(text);
}

function rowsFromPayload(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.output_template?.entries)) return payload.output_template.entries;
  if (Array.isArray(payload.source_intake_template?.entries)) return payload.source_intake_template.entries;
  return [];
}

function collectCandidates(sourceFamilyReport = {}) {
  const byKey = new Map();

  function merge(entry = {}, row = {}) {
    const storyId = firstText(entry.story_id, row.story_id);
    const family = normaliseFamily(entry.source_family);
    if (!storyId || !family) return;
    const key = sourceKey(storyId, family);
    const existing = byKey.get(key) || {};
    byKey.set(key, {
      ...existing,
      ...entry,
      story_id: storyId,
      source_family: family,
      entity: firstText(entry.entity, row.primary_story_entity, row.title, existing.entity),
      title: firstText(row.title, entry.title, existing.title),
    });
  }

  for (const row of asArray(sourceFamilyReport.rows)) {
    for (const candidate of asArray(row.source_family_candidates)) merge(candidate, row);
  }
  for (const entry of rowsFromPayload(sourceFamilyReport.source_intake_template || {})) merge(entry, {});
  for (const entry of rowsFromPayload(sourceFamilyReport)) merge(entry, {});

  return Array.from(byKey.values());
}

function collectDirectMediaRows(directMediaReport = {}) {
  const byKey = new Map();
  for (const row of rowsFromPayload(directMediaReport)) {
    const storyId = cleanText(row.story_id);
    const family = normaliseFamily(row.source_family);
    if (!storyId || !family) continue;
    const directUrl = firstText(
      row.approved_direct_media_url,
      row.direct_media_url,
      row.direct_media_url_if_available,
      row.source_url,
    );
    if (!directUrl || !isRenderEligibleUrl(directUrl)) continue;
    byKey.set(sourceKey(storyId, family), {
      ...row,
      source_family: family,
      direct_media_url: directUrl,
      source_url_kind: sourceUrlKind(directUrl).source_url_kind,
      source_duration_s: row.source_duration_s || row.duration_seconds || null,
      media_width: row.media_width || null,
      media_height: row.media_height || null,
    });
  }
  return byKey;
}

function collectOperatorIntake(operatorIntake = []) {
  const byKey = new Map();
  for (const row of rowsFromPayload(operatorIntake)) {
    const storyId = cleanText(row.story_id);
    const family = normaliseFamily(row.source_family);
    if (!storyId || !family) continue;
    const key = sourceKey(storyId, family);
    byKey.set(key, { ...(byKey.get(key) || {}), ...row, source_family: family });
  }
  return byKey;
}

function mergeOperatorOnlyCandidates(candidates = [], operatorRows = new Map()) {
  const merged = [...asArray(candidates)];
  const seen = new Set(
    merged.map((candidate) => sourceKey(candidate.story_id, candidate.source_family)),
  );
  for (const row of operatorRows.values()) {
    const key = sourceKey(row.story_id, row.source_family);
    if (!key || seen.has(key)) continue;
    const sourceUrl = firstText(
      row.official_source_url,
      row.reference_url,
      row.source_url,
      row.direct_media_url_if_available,
      row.approved_direct_media_url,
    );
    merged.push({
      ...row,
      story_id: cleanText(row.story_id),
      source_family: normaliseFamily(row.source_family),
      entity: cleanText(row.entity),
      source_type: cleanText(row.source_type),
      source_owner: cleanText(row.source_owner),
      official_source_url: sourceUrl,
      source_url: sourceUrl,
      source_tier: firstText(row.source_tier, "official"),
      source_url_kind: firstText(row.source_url_kind, sourceUrlKind(sourceUrl).source_url_kind),
      source_origin: "operator_official_source_intake",
    });
    seen.add(key);
  }
  return merged;
}

function mergeDirectMediaOnlyCandidates(candidates = [], directRows = new Map()) {
  const merged = [...asArray(candidates)];
  const seen = new Set(
    merged.map((candidate) => sourceKey(candidate.story_id, candidate.source_family)),
  );
  for (const row of directRows.values()) {
    const key = sourceKey(row.story_id, row.source_family);
    if (!key || seen.has(key)) continue;
    const sourceUrl = firstText(
      row.official_source_url,
      row.reference_url,
      row.reference_page_url,
      row.source_url,
      row.direct_media_url,
      row.direct_media_url_if_available,
    );
    merged.push({
      ...row,
      story_id: cleanText(row.story_id),
      source_family: normaliseFamily(row.source_family),
      entity: cleanText(row.entity),
      source_type: cleanText(row.source_type),
      source_owner: cleanText(row.source_owner),
      official_source_url: sourceUrl,
      source_url: sourceUrl,
      source_tier: firstText(row.source_tier, "official"),
      source_url_kind: firstText(row.source_url_kind, sourceUrlKind(sourceUrl).source_url_kind),
      source_origin: "official_direct_media_discovery",
    });
    seen.add(key);
  }
  return merged;
}

function defaultAllowedLocalRoots(rootDir = process.cwd()) {
  const root = path.resolve(rootDir);
  return [
    path.join(root, "input"),
    path.join(root, "output"),
    path.join(root, "test", "output"),
    path.join(root, "assets"),
    path.join(root, "media"),
  ];
}

function resolveLocalPath(filePath, rootDir = process.cwd()) {
  const text = cleanText(filePath);
  if (!text) return "";
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(rootDir, text);
}

function pathIsInside(candidatePath, allowedRoot) {
  const candidate = path.resolve(candidatePath);
  const root = path.resolve(allowedRoot);
  if (candidate.toLowerCase() === root.toLowerCase()) return true;
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function localFileState(filePath, { allowedLocalRoots = [], rootDir = process.cwd() } = {}) {
  const resolved = resolveLocalPath(filePath, rootDir);
  if (!resolved) return { ok: false, path: "", reason: "local_operator_file_missing" };
  const roots = allowedLocalRoots.length ? allowedLocalRoots : defaultAllowedLocalRoots(rootDir);
  const insideAllowedRoot = roots.some((root) => pathIsInside(resolved, root));
  if (!insideAllowedRoot) {
    return { ok: false, path: resolved, reason: "local_operator_file_outside_allowed_roots" };
  }
  if (!VIDEO_FILE_RE.test(resolved)) {
    return { ok: false, path: resolved, reason: "local_operator_file_not_video" };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: false, path: resolved, reason: "local_operator_file_missing" };
  }
  return { ok: true, path: resolved, reason: null };
}

function markerExpired(expiresAt, generatedAt) {
  const text = cleanText(expiresAt);
  if (!text) return false;
  const expiry = Date.parse(text);
  const now = Date.parse(generatedAt);
  if (!Number.isFinite(expiry) || !Number.isFinite(now)) return false;
  return expiry < now;
}

function licenceMarker(row = {}, generatedAt = new Date().toISOString()) {
  const evidence = firstText(
    row.licence_evidence,
    row.license_evidence,
    row.permission_evidence,
    row.permission_marker,
    row.licence_document,
    row.license_document,
  );
  const scope = firstText(row.licence_scope, row.license_scope, row.permission_scope);
  const approved = bool(row.autonomous_use_approved);
  const expiresAt = firstText(row.licence_expires_at, row.license_expires_at, row.permission_expires_at);
  const expired = markerExpired(expiresAt, generatedAt);
  return {
    present: Boolean(evidence || scope || approved || expiresAt),
    complete: Boolean(evidence && scope && approved && !expired),
    evidence,
    scope,
    autonomous_use_approved: approved,
    licence_expires_at: expiresAt,
    expired,
  };
}

function directMediaFrom({ candidate = {}, directMediaRow = {}, operatorRow = {} } = {}) {
  const explicitCandidates = [
    {
      mode: "approved_direct_media_url",
      url: firstText(operatorRow.approved_direct_media_url),
      source: "operator_intake",
      source_duration_s: operatorRow.source_duration_s || operatorRow.duration_seconds || operatorRow.durationSeconds,
      media_width: operatorRow.media_width,
      media_height: operatorRow.media_height,
    },
    {
      mode: "approved_direct_media_url",
      url: firstText(operatorRow.direct_media_url_if_available, operatorRow.direct_media_url),
      source: "operator_intake",
      source_duration_s: operatorRow.source_duration_s || operatorRow.duration_seconds || operatorRow.durationSeconds,
      media_width: operatorRow.media_width,
      media_height: operatorRow.media_height,
    },
    {
      mode: "approved_direct_media_url",
      url: firstText(directMediaRow.direct_media_url, directMediaRow.approved_direct_media_url),
      source: "direct_media_discovery",
      source_duration_s: directMediaRow.source_duration_s,
      media_width: directMediaRow.media_width,
      media_height: directMediaRow.media_height,
    },
    {
      mode: "approved_direct_media_url",
      url: firstText(candidate.approved_direct_media_url, candidate.direct_media_url_if_available),
      source: "source_family_intake",
      source_duration_s: candidate.source_duration_s,
      media_width: candidate.media_width,
      media_height: candidate.media_height,
    },
  ];

  for (const item of explicitCandidates) {
    if (!cleanText(item.url)) continue;
    const kind = sourceUrlKind(item.url);
    if (!kind.segment_validation_eligible) {
      return {
        ok: false,
        url: cleanText(item.url),
        source_url_kind: kind.source_url_kind,
        source: item.source,
        reason: "direct_media_url_not_segment_eligible",
      };
    }
    return {
      ok: true,
      url: cleanText(item.url),
      source_url_kind: kind.source_url_kind,
      source: item.source,
      source_duration_s: item.source_duration_s || null,
      media_width: item.media_width || null,
      media_height: item.media_height || null,
      reason: null,
    };
  }

  const implicitCandidates = [
    {
      mode: "approved_direct_media_url",
      url: firstText(candidate.source_url),
      source: "source_family_candidate",
      source_duration_s: candidate.source_duration_s,
      media_width: candidate.media_width,
      media_height: candidate.media_height,
    },
  ];

  for (const item of implicitCandidates) {
    if (!cleanText(item.url)) continue;
    const kind = sourceUrlKind(item.url);
    if (!kind.segment_validation_eligible) continue;
    return {
      ok: true,
      url: cleanText(item.url),
      source_url_kind: kind.source_url_kind,
      source: item.source,
      source_duration_s: item.source_duration_s || null,
      media_width: item.media_width || null,
      media_height: item.media_height || null,
      reason: null,
    };
  }
  return { ok: false, url: "", source_url_kind: "", source: "", reason: null };
}

function baseRow(candidate = {}, operatorRow = {}) {
  return {
    story_id: cleanText(candidate.story_id),
    entity: firstText(operatorRow.entity, candidate.entity),
    title: cleanText(candidate.title),
    source_family: normaliseFamily(candidate.source_family),
    source_type: firstText(operatorRow.source_type, candidate.source_type),
    source_owner: firstText(operatorRow.source_owner, candidate.source_owner, candidate.display_name, candidate.source_id),
    official_source_url: firstText(operatorRow.official_source_url, candidate.official_source_url, candidate.reference_url, candidate.source_url),
    source_tier: firstText(operatorRow.source_tier, candidate.source_tier),
  };
}

function classifySource({
  candidate = {},
  directMediaRow = {},
  operatorRow = {},
  allowedLocalRoots = [],
  rootDir = process.cwd(),
  generatedAt = new Date().toISOString(),
} = {}) {
  const row = baseRow(candidate, operatorRow);
  const direct = directMediaFrom({ candidate, directMediaRow, operatorRow });
  const localPath = firstText(operatorRow.local_operator_file_path, operatorRow.local_file_path);
  const local = localFileState(localPath, { allowedLocalRoots, rootDir });
  const marker = licenceMarker({ ...candidate, ...operatorRow }, generatedAt);
  const trustedCreator = isTrustedCreator({ ...candidate, ...operatorRow });
  const youtubeReference = isYouTubeReference({ ...candidate, ...operatorRow });

  const rightsGate = trustedCreator ? (marker.complete ? "licence_marker" : "blocked") : "official_source";

  if (localPath && !local.ok) {
    return {
      ...row,
      status: "blocked",
      access_mode: "local_operator_file",
      rights_gate: rightsGate,
      blocking_reason: local.reason,
      approved_media_url: "",
      local_operator_file_path: local.path,
      segment_validation_eligible: false,
      licence_marker: marker,
    };
  }

  if (trustedCreator && (direct.ok || local.ok) && !marker.complete) {
    return {
      ...row,
      status: "blocked",
      access_mode: local.ok ? "local_operator_file" : "approved_direct_media_url",
      rights_gate: "blocked",
      blocking_reason: marker.present
        ? "permission_marker_missing_autonomous_approval"
        : "trusted_creator_requires_licence_or_permission",
      approved_media_url: direct.ok ? direct.url : "",
      local_operator_file_path: local.ok ? local.path : "",
      source_url_kind: direct.source_url_kind,
      segment_validation_eligible: false,
      licence_marker: marker,
    };
  }

  if (direct.ok) {
    return {
      ...row,
      status: "ready_for_segment_validation",
      access_mode: "approved_direct_media_url",
      rights_gate: rightsGate,
      blocking_reason: null,
      approved_media_url: direct.url,
      local_operator_file_path: "",
      source_url_kind: direct.source_url_kind,
      source_duration_s: direct.source_duration_s,
      media_width: direct.media_width,
      media_height: direct.media_height,
      segment_validation_eligible: true,
      licence_marker: marker,
    };
  }

  if (local.ok) {
    return {
      ...row,
      status: "ready_for_segment_validation",
      access_mode: "local_operator_file",
      rights_gate: rightsGate,
      blocking_reason: null,
      approved_media_url: "",
      local_operator_file_path: local.path,
      source_url_kind: "local_video_file",
      segment_validation_eligible: true,
      licence_marker: marker,
    };
  }

  if (marker.complete) {
    return {
      ...row,
      status: "permission_ready_asset_needed",
      access_mode: "permission_marker_only",
      rights_gate: "licence_marker",
      blocking_reason: "permission_marker_has_no_direct_media_or_local_file",
      approved_media_url: "",
      local_operator_file_path: "",
      segment_validation_eligible: false,
      licence_marker: marker,
    };
  }

  if (direct.reason) {
    return {
      ...row,
      status: "blocked",
      access_mode: "approved_direct_media_url",
      rights_gate: rightsGate,
      blocking_reason: direct.reason,
      approved_media_url: direct.url,
      local_operator_file_path: "",
      source_url_kind: direct.source_url_kind,
      segment_validation_eligible: false,
      licence_marker: marker,
    };
  }

  return {
    ...row,
    status: "blocked",
    access_mode: youtubeReference ? "video_platform_reference" : "source_reference",
    rights_gate: rightsGate,
    blocking_reason: youtubeReference
      ? "youtube_reference_requires_direct_media_local_file_or_permission"
      : trustedCreator
        ? "trusted_creator_requires_licence_or_permission"
        : "direct_media_or_local_operator_file_required",
    approved_media_url: "",
    local_operator_file_path: "",
    segment_validation_eligible: false,
    licence_marker: marker,
  };
}

function intakeTemplateEntry(candidate = {}) {
  return {
    story_id: cleanText(candidate.story_id),
    entity: cleanText(candidate.entity),
    source_family: normaliseFamily(candidate.source_family),
    source_type: cleanText(candidate.source_type),
    source_owner: firstText(candidate.source_owner, candidate.display_name, candidate.source_id),
    official_source_url: firstText(candidate.official_source_url, candidate.reference_url, candidate.source_url),
    approved_direct_media_url: "",
    local_operator_file_path: "",
    licence_evidence: "",
    permission_evidence: "",
    licence_scope: "",
    licence_expires_at: "",
    autonomous_use_approved: false,
    approval_notes: "",
    acceptance_checks: [
      "Use an official direct media URL, a local operator-supplied video file or a complete licence/permission marker.",
      "Trusted creator material also needs evidence, scope and autonomous approval before render use.",
      "A permission marker clears the rights gate but V4 still needs a direct media URL or local file before segment validation.",
    ],
  };
}

function buildSummary(rows = [], candidates = []) {
  const readyRows = rows.filter((row) => row.status === "ready_for_segment_validation");
  const blockedRows = rows.filter((row) => row.status === "blocked");
  const trustedBlockedRows = blockedRows.filter((row) => isTrustedCreator(row));
  return {
    source_candidates: candidates.length,
    render_ready_sources: readyRows.length,
    direct_media_ready: readyRows.filter((row) => row.access_mode === "approved_direct_media_url").length,
    local_file_ready: readyRows.filter((row) => row.access_mode === "local_operator_file").length,
    permission_only: rows.filter((row) => row.status === "permission_ready_asset_needed").length,
    blocked_sources: blockedRows.length,
    trusted_creator_blocked: trustedBlockedRows.length,
    official_youtube_blocked: blockedRows.filter(
      (row) =>
        row.blocking_reason === "youtube_reference_requires_direct_media_local_file_or_permission" &&
        !isTrustedCreator(row),
    ).length,
    intake_template_entries: candidates.length,
  };
}

function acceptedReferenceFromRow(row = {}) {
  const sourceUrl = firstText(row.approved_media_url, row.local_operator_file_path);
  const urlKind = row.source_url_kind || sourceUrlKind(sourceUrl).source_url_kind;
  return {
    story_id: cleanText(row.story_id),
    entity: cleanText(row.entity),
    source_family: normaliseFamily(row.source_family),
    source_type:
      row.access_mode === "local_operator_file"
        ? "operator_supplied_local_video"
        : "licensed_direct_media_url",
    provider: "licensed_direct_media_acquisition",
    source_url: sourceUrl,
    source_url_kind: urlKind,
    source_duration_s: row.source_duration_s || null,
    media_width: row.media_width || null,
    media_height: row.media_height || null,
    segment_validation_eligible: true,
    reference_url: cleanText(row.official_source_url),
    source_owner: cleanText(row.source_owner),
    source_verified: true,
    downloads_allowed: false,
    allowed_render_use:
      row.rights_gate === "licence_marker"
        ? "licensed_short_clip_candidate"
        : "official_direct_media_segment_candidate",
    rights_risk_class:
      row.rights_gate === "licence_marker"
        ? "licensed_creator_clip"
        : "official_direct_media",
    provenance: {
      source: "visual_v4_licensed_direct_media_acquisition",
      access_mode: row.access_mode,
      rights_gate: row.rights_gate,
      source_url_kind: urlKind,
      segment_validation_eligible: true,
      licence_marker_present: row.licence_marker?.present === true,
      autonomous_use_approved: row.licence_marker?.autonomous_use_approved === true,
    },
  };
}

function buildLicensedDirectMediaAcquisitionReport({
  sourceFamilyReport = {},
  directMediaReport = {},
  operatorIntake = [],
  allowedLocalRoots = [],
  rootDir = process.cwd(),
  generatedAt = new Date().toISOString(),
} = {}) {
  const directRows = collectDirectMediaRows(directMediaReport);
  const operatorRows = collectOperatorIntake(operatorIntake);
  const candidates = mergeDirectMediaOnlyCandidates(
    mergeOperatorOnlyCandidates(
      collectCandidates(sourceFamilyReport),
      operatorRows,
    ),
    directRows,
  );
  const rows = candidates.map((candidate) => {
    const key = sourceKey(candidate.story_id, candidate.source_family);
    return classifySource({
      candidate,
      directMediaRow: directRows.get(key) || {},
      operatorRow: operatorRows.get(key) || {},
      allowedLocalRoots,
      rootDir,
      generatedAt,
    });
  });

  const renderReady = rows.filter((row) => row.status === "ready_for_segment_validation");
  const permissionOnly = rows.filter((row) => row.status === "permission_ready_asset_needed");
  const blocked = rows.filter((row) => row.status === "blocked");
  const acceptedReferences = renderReady.map(acceptedReferenceFromRow);

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "visual_v4_licensed_direct_media_acquisition",
    local_only: true,
    will_download: false,
    will_mutate_story: false,
    will_publish: false,
    summary: buildSummary(rows, candidates),
    safety: {
      local_only: true,
      video_downloads_started: false,
      retained_video_files: false,
      browser_scraping_started: false,
      yt_dlp_started: false,
      oauth_triggered: false,
      production_db_mutated: false,
      railway_mutated: false,
      social_posting_triggered: false,
    },
    rows,
    accepted_references: acceptedReferences,
    render_ready_sources: renderReady,
    permission_only_sources: permissionOnly,
    blocked_sources: blocked,
    intake_template: {
      schema_version: 1,
      generated_at: generatedAt,
      entries: candidates.map(intakeTemplateEntry),
    },
  };
}

function renderLicensedDirectMediaAcquisitionMarkdown(report = {}) {
  const lines = [];
  lines.push("# Visual V4 Licensed Direct Media Acquisition");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Candidates: ${report.summary?.source_candidates ?? 0}`);
  lines.push(`Render-ready: ${report.summary?.render_ready_sources ?? 0}`);
  lines.push(`Permission-only: ${report.summary?.permission_only ?? 0}`);
  lines.push(`Blocked: ${report.summary?.blocked_sources ?? 0}`);
  lines.push("");
  lines.push("Safety: No downloads, DB mutation, OAuth or posting. This only writes local reports and operator intake templates.");
  lines.push("");
  lines.push("| story | family | status | access | gate | reason |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of asArray(report.rows)) {
    lines.push(
      `| ${row.story_id || "unknown"} | ${row.source_family || "unknown"} | ${row.status || "unknown"} | ${row.access_mode || "none"} | ${row.rights_gate || "none"} | ${row.blocking_reason || "clear"} |`,
    );
  }
  if (!asArray(report.rows).length) lines.push("| none | none | none | none | none | none |");
  lines.push("");
  lines.push("## Operator Rule");
  lines.push("");
  lines.push(
    "Official refs need a segment-eligible direct media URL or a local supplied video file. Trusted creator refs also need licence evidence, scope and autonomous approval before V4 can use them.",
  );
  return lines.join("\n") + "\n";
}

module.exports = {
  buildLicensedDirectMediaAcquisitionReport,
  renderLicensedDirectMediaAcquisitionMarkdown,
  collectCandidates,
  localFileState,
};
