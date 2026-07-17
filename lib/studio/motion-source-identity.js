"use strict";

const { compareVideoFingerprints } = require("../video-visual-fingerprint");

const MOTION_SOURCE_IDENTITY_VERSION = "pulse_motion_source_identity_v1";

const PROFESSIONAL_MOTION_SOURCE_POLICY = Object.freeze({
  policy_tier: "ultimate_professional",
  min_genuine_base_sources: 2,
  max_scenes_per_source: 2,
  max_source_share: 0.25,
});

const URL_FIELDS = Object.freeze([
  "canonical_source_url",
  "canonicalSourceUrl",
  "master_source_url",
  "masterSourceUrl",
  "source_url",
  "sourceUrl",
  "original_source_url",
  "originalSourceUrl",
  "reference_url",
  "referenceUrl",
  "url",
]);

const YOUTUBE_ID_FIELDS = Object.freeze([
  "youtube_video_id",
  "youtubeVideoId",
  "source_youtube_id",
  "sourceYoutubeId",
]);

const MASTER_HASH_FIELDS = Object.freeze([
  "source_master_sha256",
  "sourceMasterSha256",
  "master_sha256",
  "masterSha256",
  "base_source_sha256",
  "baseSourceSha256",
  "original_source_sha256",
  "originalSourceSha256",
  "master_content_sha256",
  "masterContentSha256",
]);

const FINGERPRINT_FIELDS = Object.freeze([
  "sampled_visual_fingerprint",
  "sampledVisualFingerprint",
  "master_visual_fingerprint",
  "masterVisualFingerprint",
  "source_visual_fingerprint",
  "sourceVisualFingerprint",
]);

const GENERATOR_PROJECT_ID_FIELDS = Object.freeze([
  "generator_project_id",
  "generatorProjectId",
  "procedural_project_id",
  "proceduralProjectId",
  "render_project_id",
  "renderProjectId",
]);

const GENERATOR_PROJECT_HASH_FIELDS = Object.freeze([
  "generator_project_sha256",
  "generatorProjectSha256",
  "generator_master_sha256",
  "generatorMasterSha256",
  "project_master_sha256",
  "projectMasterSha256",
  "procedural_master_sha256",
  "proceduralMasterSha256",
]);

const PROCEDURAL_DESCRIPTOR_FIELDS = Object.freeze([
  "generation_method",
  "generationMethod",
  "derivation_method",
  "derivationMethod",
  "source_type",
  "sourceType",
  "media_kind",
  "mediaKind",
  "generator",
  "render_engine",
  "renderEngine",
]);

const WEAK_IDENTITY_FIELDS = Object.freeze([
  "source_family",
  "sourceFamily",
  "base_source_family",
  "baseSourceFamily",
  "motion_family",
  "motionFamily",
  "visual_family",
  "visualFamily",
  "generator_family",
  "generatorFamily",
  "project_family",
  "projectFamily",
  "template_family",
  "templateFamily",
  "path",
  "clip_path",
  "clipPath",
  "local_path",
  "localPath",
  "video_path",
  "videoPath",
  "exported_path",
  "exportedPath",
]);

const WEAK_PATH_IDENTITY_FIELDS = new Set([
  "path",
  "clip_path",
  "clipPath",
  "local_path",
  "localPath",
  "video_path",
  "videoPath",
  "exported_path",
  "exportedPath",
]);

const URL_NOISE_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "si",
  "feature",
  "t",
  "time_continue",
  "start",
  "ref",
  "source",
  "expires",
  "signature",
  "sig",
  "token",
  "auth",
  "policy",
  "key-pair-id",
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function clipPath(clip) {
  if (typeof clip === "string") return cleanText(clip);
  return cleanText(
    clip?.path ||
      clip?.clip_path ||
      clip?.clipPath ||
      clip?.local_path ||
      clip?.localPath ||
      clip?.video_path ||
      clip?.videoPath ||
      clip?.exported_path ||
      clip?.exportedPath,
  );
}

function normalisePath(value) {
  return cleanText(value).replace(/\\/g, "/").toLowerCase();
}

function youtubeIdFromUrl(parsed) {
  const host = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
  if (host === "youtu.be") return cleanText(parsed.pathname.split("/").filter(Boolean)[0]);
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return "";
  return cleanText(
    parsed.searchParams.get("v") ||
      parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i)?.[1],
  );
}

function canonicaliseMotionSourceUrl(value) {
  const text = cleanText(value).replace(/^url:/i, "");
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) return "";
    const youtubeId = youtubeIdFromUrl(parsed);
    if (youtubeId) return `youtube:${youtubeId}`;

    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...parsed.searchParams.keys()]) {
      if (URL_NOISE_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/$/, "");

    if (
      parsed.hostname.endsWith("steamstatic.com") &&
      parsed.pathname.toLowerCase().includes("/store_trailers/")
    ) {
      parsed.pathname = parsed.pathname.replace(
        /\/(?:hls[^/]*\.m3u8|dash[^/]*\.mpd|[^/]+\.(?:mp4|webm|mov|mkv))$/i,
        "",
      );
    }
    return `url:${parsed.toString()}`;
  } catch {
    return "";
  }
}

function canonicaliseYoutubeId(value) {
  const text = cleanText(value);
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(text)) return "";
  return `youtube:${text}`;
}

function canonicaliseSha256(value) {
  const text = cleanText(value).replace(/^sha256:/i, "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? `sha256:${text}` : "";
}

function canonicaliseVisualFingerprint(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const algorithm = cleanText(value.algorithm).toLowerCase() || "temporal-dhash-9x8-v1";
    const hashes = Array.isArray(value.hashes)
      ? value.hashes.map((hash) => cleanText(hash).toLowerCase()).filter(Boolean)
      : [];
    const signature = cleanText(value.signature).toLowerCase() || hashes.join(":");
    if (!signature || !/^[a-z0-9:+/_=.-]+$/.test(`${algorithm}:${signature}`)) return "";
    return `fingerprint:${algorithm}:${signature}`;
  }
  const text = cleanText(value).toLowerCase().replace(/\s+/g, "");
  if (!text || text.length < 8 || !/^[a-z0-9:+/_=.-]+$/.test(text)) return "";
  return `fingerprint:${text.replace(/^fingerprint:/, "")}`;
}

function isComparableTemporalFingerprint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const algorithm = cleanText(value.algorithm).toLowerCase() || "temporal-dhash-9x8-v1";
  const hashes = Array.isArray(value.hashes) ? value.hashes : [];
  return (
    algorithm === "temporal-dhash-9x8-v1" &&
    hashes.length >= 2 &&
    hashes.every((hash) => /^[a-f0-9]{16}$/i.test(cleanText(hash)))
  );
}

function canonicaliseGeneratorProjectId(value) {
  const text = cleanText(value).toLowerCase().replace(/\s+/g, "-");
  if (!text || text.length < 3 || !/^[a-z0-9][a-z0-9._:/-]*$/.test(text)) return "";
  return `generator-project:${text.replace(/^generator-project:/, "")}`;
}

function canonicaliseGeneratorProjectSha256(value) {
  const alias = canonicaliseSha256(value);
  return alias ? alias.replace(/^sha256:/, "generator-sha256:") : "";
}

function evidenceOwners(clip) {
  if (!clip || typeof clip !== "object") return [];
  return [
    { owner: clip, prefix: "" },
    { owner: clip.provenance, prefix: "provenance." },
    { owner: clip.source_identity, prefix: "source_identity." },
    { owner: clip.sourceIdentity, prefix: "sourceIdentity." },
    { owner: clip.motion_source_identity, prefix: "motion_source_identity." },
    { owner: clip.motionSourceIdentity, prefix: "motionSourceIdentity." },
  ].filter((entry) => entry.owner && typeof entry.owner === "object");
}

function fieldEntries(clip, fields) {
  const entries = [];
  for (const { owner, prefix } of evidenceOwners(clip)) {
    for (const field of fields) {
      const raw = owner[field];
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (cleanText(value)) entries.push({ field: `${prefix}${field}`, base_field: field, value });
      }
    }
  }
  return entries;
}

function identityKind(alias) {
  if (alias.startsWith("generator-sha256:")) return "generator_project_sha256";
  if (alias.startsWith("generator-project:")) return "generator_project_id";
  if (alias.startsWith("sha256:")) return "master_sha256";
  if (alias.startsWith("fingerprint:")) return "sampled_visual_fingerprint";
  if (alias.startsWith("youtube:")) return "youtube_id";
  if (alias.startsWith("url:")) return "canonical_url";
  if (alias.startsWith("asset:")) return "base_source_asset_id";
  return "unknown";
}

function identityRank(alias) {
  return {
    generator_project_sha256: 0,
    master_sha256: 1,
    sampled_visual_fingerprint: 2,
    youtube_id: 3,
    canonical_url: 4,
    generator_project_id: 5,
    base_source_asset_id: 6,
  }[identityKind(alias)] ?? 99;
}

function aliasCollapseReason(alias) {
  return {
    generator_project_sha256: "procedural_generator_master_match",
    generator_project_id: "procedural_generator_project_match",
    master_sha256: "source_master_sha256_match",
    sampled_visual_fingerprint: "sampled_visual_fingerprint_match",
    youtube_id: "canonical_source_identity_match",
    canonical_url: "canonical_source_identity_match",
  }[identityKind(alias)] || "motion_source_identity_alias_match";
}

function weakIdentityRejectionReasons(fields) {
  const values = new Set(fields);
  const reasons = [];
  if ([...values].some((field) => WEAK_PATH_IDENTITY_FIELDS.has(field))) {
    reasons.push("derivative_path_not_genuine_source_identity");
  }
  if ([...values].some((field) => !WEAK_PATH_IDENTITY_FIELDS.has(field))) {
    reasons.push("mutable_family_label_not_genuine_source_identity");
  }
  return reasons;
}

function preferredAlias(aliases) {
  return [...new Set(aliases)].sort((a, b) => identityRank(a) - identityRank(b) || a.localeCompare(b))[0] || "";
}

function resolveMotionSourceIdentity(clip, { clipIndex = null } = {}) {
  const strongEvidence = [];
  const sampledVisualFingerprints = [];
  const addEvidence = (entry, alias, kind) => {
    if (!alias) return;
    strongEvidence.push({
      kind,
      alias,
      field: entry.field,
    });
  };

  for (const entry of fieldEntries(clip, URL_FIELDS)) {
    const alias = canonicaliseMotionSourceUrl(entry.value);
    addEvidence(entry, alias, identityKind(alias));
  }
  for (const entry of fieldEntries(clip, YOUTUBE_ID_FIELDS)) {
    addEvidence(entry, canonicaliseYoutubeId(entry.value), "youtube_id");
  }
  for (const entry of fieldEntries(clip, MASTER_HASH_FIELDS)) {
    addEvidence(entry, canonicaliseSha256(entry.value), "master_sha256");
  }
  for (const entry of fieldEntries(clip, FINGERPRINT_FIELDS)) {
    const alias = canonicaliseVisualFingerprint(entry.value);
    addEvidence(entry, alias, "sampled_visual_fingerprint");
    if (alias) {
      sampledVisualFingerprints.push({
        field: entry.field,
        value: entry.value,
      });
    }
  }
  for (const entry of fieldEntries(clip, GENERATOR_PROJECT_ID_FIELDS)) {
    addEvidence(entry, canonicaliseGeneratorProjectId(entry.value), "generator_project_id");
  }
  for (const entry of fieldEntries(clip, GENERATOR_PROJECT_HASH_FIELDS)) {
    addEvidence(
      entry,
      canonicaliseGeneratorProjectSha256(entry.value),
      "generator_project_sha256",
    );
  }

  const masterHashes = new Set(
    strongEvidence
      .filter((entry) => entry.kind === "master_sha256")
      .map((entry) => entry.alias),
  );
  const generatorMasterHashes = new Set(
    strongEvidence
      .filter((entry) => entry.kind === "generator_project_sha256")
      .map((entry) => entry.alias),
  );
  const blockers = [];
  if (masterHashes.size > 1) blockers.push("motion_source_master_hash_conflict");
  if (generatorMasterHashes.size > 1) {
    blockers.push("motion_source_generator_master_hash_conflict");
  }

  const aliases = [...new Set(strongEvidence.map((entry) => entry.alias))].sort(
    (a, b) => identityRank(a) - identityRank(b) || a.localeCompare(b),
  );
  const rejectedIdentityFields = [...new Set(
    fieldEntries(clip, WEAK_IDENTITY_FIELDS).map((entry) => entry.base_field),
  )].sort();
  const rejectionReasons = weakIdentityRejectionReasons(rejectedIdentityFields);
  const procedural =
    strongEvidence.some((entry) =>
      entry.kind === "generator_project_id" || entry.kind === "generator_project_sha256",
    ) ||
    fieldEntries(clip, PROCEDURAL_DESCRIPTOR_FIELDS).some((entry) =>
      /procedural|generated|generator|template|synthetic|owned[_ -]?motion/i.test(cleanText(entry.value)),
    );
  const resolved = aliases.length > 0 && blockers.length === 0;
  const preferred = resolved ? preferredAlias(aliases) : "";

  return {
    clip_index: Number.isInteger(clipIndex) ? clipIndex : null,
    clip_id: cleanText(clip?.id || clip?.clip_id || clip?.clipId) || null,
    path: clipPath(clip) || null,
    resolved,
    ambiguous: blockers.length > 0,
    base_source_asset_id: preferred || null,
    base_source_identity_basis: preferred ? identityKind(preferred) : null,
    aliases,
    procedural,
    sampled_visual_fingerprints: sampledVisualFingerprints,
    identity_evidence: strongEvidence
      .filter((entry, index, all) =>
        all.findIndex((candidate) => candidate.alias === entry.alias && candidate.field === entry.field) === index,
      )
      .sort((a, b) => identityRank(a.alias) - identityRank(b.alias) || a.alias.localeCompare(b.alias)),
    rejected_identity_fields: rejectedIdentityFields,
    rejection_reasons: rejectionReasons,
    blockers,
  };
}

class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index) {
    if (this.parent[index] !== index) this.parent[index] = this.find(this.parent[index]);
    return this.parent[index];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent[rightRoot] = leftRoot;
  }
}

function reconcileMotionSourceIdentities(clips = []) {
  const rows = Array.isArray(clips) ? clips.filter(Boolean) : [];
  const resolvedEvidence = rows.map((clip, index) =>
    resolveMotionSourceIdentity(clip, { clipIndex: index }),
  );
  const sets = new DisjointSet(rows.length);
  const aliasOwner = new Map();
  const collapseRelations = [];

  for (const evidence of resolvedEvidence) {
    if (!evidence.resolved) continue;
    for (const alias of evidence.aliases) {
      const owner = aliasOwner.get(alias);
      if (owner != null) {
        sets.union(evidence.clip_index, owner);
        collapseRelations.push({
          left_clip_index: owner,
          right_clip_index: evidence.clip_index,
          reason: aliasCollapseReason(alias),
        });
      } else aliasOwner.set(alias, evidence.clip_index);
    }
  }
  for (let leftIndex = 0; leftIndex < resolvedEvidence.length; leftIndex += 1) {
    const left = resolvedEvidence[leftIndex];
    if (!left.resolved || !left.procedural) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < resolvedEvidence.length; rightIndex += 1) {
      const right = resolvedEvidence[rightIndex];
      if (!right.resolved || !right.procedural) continue;
      const nearDuplicate = left.sampled_visual_fingerprints.some((leftEntry) =>
        isComparableTemporalFingerprint(leftEntry.value) &&
        right.sampled_visual_fingerprints.some((rightEntry) =>
          isComparableTemporalFingerprint(rightEntry.value) &&
          compareVideoFingerprints(leftEntry.value, rightEntry.value).near_duplicate,
        ),
      );
      if (!nearDuplicate) continue;
      sets.union(left.clip_index, right.clip_index);
      collapseRelations.push(
        {
          left_clip_index: left.clip_index,
          right_clip_index: right.clip_index,
          reason: "sampled_visual_fingerprint_near_duplicate",
        },
        {
          left_clip_index: left.clip_index,
          right_clip_index: right.clip_index,
          reason: "procedural_template_variant_not_independent_source",
        },
      );
    }
  }

  const groups = new Map();
  for (const evidence of resolvedEvidence) {
    if (!evidence.resolved) continue;
    const root = sets.find(evidence.clip_index);
    const group = groups.get(root) || {
      clip_indexes: [],
      clip_ids: [],
      clip_paths: [],
      aliases: new Set(),
      identity_evidence: [],
      collapse_reasons: new Set(),
    };
    group.clip_indexes.push(evidence.clip_index);
    if (evidence.clip_id) group.clip_ids.push(evidence.clip_id);
    if (evidence.path) group.clip_paths.push(evidence.path);
    for (const alias of evidence.aliases) group.aliases.add(alias);
    group.identity_evidence.push(...evidence.identity_evidence);
    groups.set(root, group);
  }
  for (const relation of collapseRelations) {
    const root = sets.find(relation.left_clip_index);
    groups.get(root)?.collapse_reasons.add(relation.reason);
  }

  const sources = [...groups.values()]
    .map((group) => {
      const aliases = [...group.aliases].sort(
        (a, b) => identityRank(a) - identityRank(b) || a.localeCompare(b),
      );
      const baseSourceAssetId = preferredAlias(aliases);
      return {
        base_source_asset_id: baseSourceAssetId,
        base_source_identity_basis: identityKind(baseSourceAssetId),
        aliases,
        clip_indexes: group.clip_indexes.sort((a, b) => a - b),
        clip_ids: [...new Set(group.clip_ids)].sort(),
        clip_paths: [...new Set(group.clip_paths)].sort(),
        collapse_reasons: [...group.collapse_reasons].sort(),
        identity_evidence: group.identity_evidence
          .filter((entry, index, all) =>
            all.findIndex((candidate) => candidate.alias === entry.alias && candidate.field === entry.field) === index,
          )
          .sort((a, b) => identityRank(a.alias) - identityRank(b.alias) || a.alias.localeCompare(b.alias)),
      };
    })
    .sort((a, b) => a.base_source_asset_id.localeCompare(b.base_source_asset_id));

  const sourceByClipIndex = new Map();
  for (const source of sources) {
    for (const index of source.clip_indexes) sourceByClipIndex.set(index, source);
  }
  const assignments = resolvedEvidence.map((evidence) => {
    const source = sourceByClipIndex.get(evidence.clip_index);
    return {
      ...evidence,
      base_source_asset_id: source?.base_source_asset_id || null,
      base_source_identity_basis: source?.base_source_identity_basis || null,
    };
  });
  const rejectedIndependenceClaims = [];
  for (const source of sources) {
    if (source.clip_indexes.length < 2) continue;
    const anchor = source.clip_indexes[0];
    for (const clipIndex of source.clip_indexes.slice(1)) {
      const reasons = collapseRelations
        .filter((relation) =>
          relation.right_clip_index === clipIndex &&
          source.clip_indexes.includes(relation.left_clip_index),
        )
        .map((relation) => relation.reason);
      rejectedIndependenceClaims.push({
        clip_index: clipIndex,
        clip_id: assignments[clipIndex]?.clip_id || null,
        duplicate_of_clip_index: anchor,
        base_source_asset_id: source.base_source_asset_id,
        rejection_reasons: [...new Set(reasons.length ? reasons : source.collapse_reasons)].sort(),
      });
    }
  }

  return {
    version: MOTION_SOURCE_IDENTITY_VERSION,
    sources,
    assignments,
    unresolved_clips: assignments.filter((entry) => !entry.resolved),
    rejected_independence_claims: rejectedIndependenceClaims,
  };
}

function sourceForScene(scene, reconciliation, sourceByAlias, sourceByPath) {
  const pathKey = normalisePath(clipPath(scene));
  if (pathKey && sourceByPath.has(pathKey)) return sourceByPath.get(pathKey);
  const evidence = resolveMotionSourceIdentity(scene);
  for (const alias of evidence.aliases) {
    if (sourceByAlias.has(alias)) return sourceByAlias.get(alias);
  }
  return null;
}

function assessProfessionalSourceDiversity({
  clips = [],
  scenes = null,
  requiredBaseSources = PROFESSIONAL_MOTION_SOURCE_POLICY.min_genuine_base_sources,
  maxScenesPerSource = PROFESSIONAL_MOTION_SOURCE_POLICY.max_scenes_per_source,
  maxSourceShare = PROFESSIONAL_MOTION_SOURCE_POLICY.max_source_share,
} = {}) {
  const rows = Array.isArray(clips) ? clips.filter(Boolean) : [];
  const sceneRows = Array.isArray(scenes) ? scenes.filter(Boolean) : rows;
  const required = Math.max(2, Math.floor(Number(requiredBaseSources) || 2));
  const maxScenes = Math.max(1, Math.floor(Number(maxScenesPerSource) || 2));
  const maxShare = Math.max(0.01, Math.min(1, Number(maxSourceShare) || 0.25));
  const reconciliation = reconcileMotionSourceIdentities(rows);
  const sourceByAlias = new Map();
  const sourceByPath = new Map();
  for (const source of reconciliation.sources) {
    for (const alias of source.aliases) sourceByAlias.set(alias, source);
    for (const clipPathValue of source.clip_paths) {
      const key = normalisePath(clipPathValue);
      if (key) sourceByPath.set(key, source);
    }
  }

  const sceneCounts = new Map();
  const unresolvedScenes = [];
  sceneRows.forEach((scene, sceneIndex) => {
    const source = sourceForScene(scene, reconciliation, sourceByAlias, sourceByPath);
    if (!source) {
      unresolvedScenes.push({
        ...resolveMotionSourceIdentity(scene, { clipIndex: sceneIndex }),
        scene_index: sceneIndex,
      });
      return;
    }
    sceneCounts.set(source.base_source_asset_id, (sceneCounts.get(source.base_source_asset_id) || 0) + 1);
  });

  const usedSources = reconciliation.sources.filter((source) => sceneCounts.has(source.base_source_asset_id));
  const totalSceneCount = sceneRows.length;
  const perSourceSceneShares = usedSources
    .map((source) => {
      const sceneCount = Number(sceneCounts.get(source.base_source_asset_id) || 0);
      return {
        base_source_asset_id: source.base_source_asset_id,
        base_source_identity_basis: source.base_source_identity_basis,
        scene_count: sceneCount,
        scene_share: totalSceneCount > 0 ? Number((sceneCount / totalSceneCount).toFixed(3)) : 0,
        clip_indexes: source.clip_indexes,
        clip_ids: source.clip_ids,
      };
    })
    .sort((a, b) => b.scene_count - a.scene_count || a.base_source_asset_id.localeCompare(b.base_source_asset_id));
  const concentratedSources = perSourceSceneShares.filter(
    (source) => source.scene_count > maxScenes && source.scene_share > maxShare,
  );

  const unresolvedByKey = new Map();
  for (const entry of [...reconciliation.unresolved_clips, ...unresolvedScenes]) {
    const pathKey = normalisePath(entry.path);
    const key = pathKey
      ? `path:${pathKey}`
      : entry.clip_id
        ? `id:${entry.clip_id}`
        : `index:${entry.clip_index ?? entry.scene_index ?? unresolvedByKey.size}`;
    const current = unresolvedByKey.get(key);
    unresolvedByKey.set(key, {
      ...(current || entry),
      scene_index: current?.scene_index ?? entry.scene_index ?? null,
    });
  }
  const unresolvedClips = [...unresolvedByKey.values()].map((entry) => ({
    clip_index: entry.clip_index,
    scene_index: entry.scene_index ?? null,
    clip_id: entry.clip_id,
    path: entry.path,
    ambiguous: entry.ambiguous === true,
    rejected_identity_fields: entry.rejected_identity_fields || [],
    rejection_reasons: entry.rejection_reasons || [],
    blockers: entry.blockers || [],
  }));

  const blockers = [];
  if (unresolvedClips.length) blockers.push("professional_motion_source_identity_unresolved");
  if (usedSources.length < required) blockers.push("professional_genuine_base_source_minimum_not_met");
  if (concentratedSources.length) blockers.push("professional_motion_source_concentration_above_floor");
  const status = blockers.length ? "blocked" : "pass";
  const rejectionReasons = [...new Set([
    ...unresolvedClips.flatMap((entry) => entry.rejection_reasons),
    ...reconciliation.rejected_independence_claims.flatMap(
      (entry) => entry.rejection_reasons,
    ),
  ])].sort();

  return {
    schema_version: 1,
    version: MOTION_SOURCE_IDENTITY_VERSION,
    policy_tier: PROFESSIONAL_MOTION_SOURCE_POLICY.policy_tier,
    authoritative: true,
    status,
    strict_pass: status === "pass",
    required_genuine_base_source_count: required,
    observed_genuine_base_source_count: usedSources.length,
    selected_direct_motion_scene_count: totalSceneCount,
    unresolved_clips: unresolvedClips,
    per_source_scene_shares: perSourceSceneShares,
    identity_evidence: usedSources.map((source) => ({
      base_source_asset_id: source.base_source_asset_id,
      base_source_identity_basis: source.base_source_identity_basis,
      aliases: source.aliases,
      identity_evidence: source.identity_evidence,
      clip_indexes: source.clip_indexes,
      clip_ids: source.clip_ids,
      clip_paths: source.clip_paths,
    })),
    concentration_rule: {
      max_scenes_per_source: maxScenes,
      max_source_share: maxShare,
      operator: "scene_count > max_scenes_per_source AND scene_share > max_source_share",
    },
    concentrated_sources: concentratedSources,
    rejected_independence_claims: reconciliation.rejected_independence_claims,
    rejection_reasons: rejectionReasons,
    checks: {
      genuine_base_source_floor: {
        status: usedSources.length >= required ? "pass" : "blocked",
        required,
        observed: usedSources.length,
      },
      identity_resolution: {
        status: unresolvedClips.length ? "blocked" : "pass",
        unresolved_clip_count: unresolvedClips.length,
      },
      source_concentration: {
        status: concentratedSources.length ? "blocked" : "pass",
        concentrated_source_count: concentratedSources.length,
      },
    },
    blockers,
  };
}

module.exports = {
  MOTION_SOURCE_IDENTITY_VERSION,
  PROFESSIONAL_MOTION_SOURCE_POLICY,
  canonicaliseMotionSourceUrl,
  resolveMotionSourceIdentity,
  reconcileMotionSourceIdentities,
  assessProfessionalSourceDiversity,
};
