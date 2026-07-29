"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const REGISTRY_SCHEMA = "pulse-governed-editorial-inventory-v1";
const REGISTRY_FILENAME = "governed-editorial-inventory.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_MAXIMUM_MANIFESTS = 500;
const MAXIMUM_REGISTRY_BYTES = 512 * 1024;
const MAXIMUM_BOUND_FILE_BYTES = 256 * 1024 * 1024;

function text(value) {
  return String(value ?? "").trim();
}

function normaliseSha256(value) {
  const candidate = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(candidate) ? candidate : null;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function discoverRegistryFiles(
  rootDir,
  maximumManifests = DEFAULT_MAXIMUM_MANIFESTS,
) {
  const found = [];
  async function visit(directory) {
    if (found.length >= maximumManifests) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (found.length >= maximumManifests) break;
      const absolutePath = path.join(directory, entry.name);
      if (entry.name === REGISTRY_FILENAME) {
        found.push(absolutePath);
        continue;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await visit(absolutePath);
      }
    }
  }
  await visit(rootDir);
  return found;
}

async function readRegistry(registryPath) {
  const blockers = [];
  let stat;
  try {
    stat = await fs.lstat(registryPath);
  } catch {
    return {
      blockers: ["editorial_inventory_registry_file_required"],
      value: null,
    };
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > MAXIMUM_REGISTRY_BYTES
  ) {
    return {
      blockers: ["editorial_inventory_registry_file_invalid"],
      value: null,
    };
  }
  const bytes = await fs.readFile(registryPath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    blockers.push("editorial_inventory_registry_json_invalid");
  }
  return {
    blockers,
    value,
    file_sha256: sha256(bytes),
  };
}

async function observeBoundFile({
  record,
  registryDir,
  allowedRoots,
  prefix,
}) {
  const blockers = [];
  const declaredPath = text(record?.path);
  const expectedSha256 = normaliseSha256(record?.file_sha256);
  if (!declaredPath) {
    blockers.push(`${prefix}_path_required`);
    return { blockers, path: null, sha256: null };
  }
  if (!expectedSha256) {
    blockers.push(`${prefix}_file_sha256_required`);
  }
  const absolutePath = path.resolve(
    path.isAbsolute(declaredPath)
      ? declaredPath
      : path.join(registryDir, declaredPath),
  );
  if (
    !allowedRoots.some((allowedRoot) =>
      isContained(allowedRoot, absolutePath),
    )
  ) {
    blockers.push(`${prefix}_path_outside_inventory_root`);
    return { blockers, path: absolutePath, sha256: null };
  }
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch {
    blockers.push(`${prefix}_file_required`);
    return { blockers, path: absolutePath, sha256: null };
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > MAXIMUM_BOUND_FILE_BYTES
  ) {
    blockers.push(`${prefix}_file_invalid`);
    return { blockers, path: absolutePath, sha256: null };
  }
  const bytes = await fs.readFile(absolutePath);
  const observedSha256 = sha256(bytes);
  if (expectedSha256 && observedSha256 !== expectedSha256) {
    blockers.push(`${prefix}_file_sha256_mismatch`);
  }
  return {
    blockers,
    path: absolutePath,
    sha256: observedSha256,
    byte_length: bytes.length,
  };
}

function validateStory(story) {
  const blockers = [];
  const value =
    story && typeof story === "object" && !Array.isArray(story)
      ? story
      : {};
  const fields = {
    id: text(value.id),
    title: text(value.title),
    franchise: text(value.franchise),
    platform: text(value.platform).toLowerCase(),
    topic_key: text(value.topic_key).toLowerCase(),
    published_at: text(value.published_at),
    primary_source_url: text(value.primary_source_url),
    verification_status: text(value.verification_status).toUpperCase(),
  };
  for (const [field, code] of [
    ["id", "editorial_inventory_story_id_required"],
    ["title", "editorial_inventory_story_title_required"],
    ["franchise", "editorial_inventory_story_franchise_required"],
    ["platform", "editorial_inventory_story_platform_required"],
    ["topic_key", "editorial_inventory_story_topic_key_required"],
  ]) {
    if (!fields[field]) blockers.push(code);
  }
  if (!Number.isFinite(Date.parse(fields.published_at))) {
    blockers.push("editorial_inventory_story_published_at_required");
  }
  if (!/^https:\/\//i.test(fields.primary_source_url)) {
    blockers.push(
      "editorial_inventory_story_primary_source_url_required",
    );
  }
  if (fields.verification_status !== "CONFIRMED") {
    blockers.push(
      "editorial_inventory_story_confirmation_required",
    );
  }
  return { blockers, story: fields };
}

function validateSafety(safety) {
  const blockers = [];
  const value =
    safety && typeof safety === "object" && !Array.isArray(safety)
      ? safety
      : {};
  if (value.local_proof !== true) {
    blockers.push("editorial_inventory_local_proof_required");
  }
  for (const field of [
    "database_mutated",
    "network_used",
    "oauth_mutated",
    "platform_contacted",
    "publish_authority_created",
  ]) {
    if (value[field] !== false) {
      blockers.push(`editorial_inventory_safety_${field}_invalid`);
    }
  }
  return blockers;
}

async function assessRegistry(registryPath, rootDir, allowedRoots) {
  const observedRegistry = await readRegistry(registryPath);
  const value = observedRegistry.value || {};
  const blockers = [...observedRegistry.blockers];
  if (value.schema_version !== REGISTRY_SCHEMA) {
    blockers.push("editorial_inventory_schema_invalid");
  }
  if (value.verdict !== "READY") {
    blockers.push("editorial_inventory_not_ready");
  }
  if (
    !Array.isArray(value.blockers) ||
    value.blockers.length > 0
  ) {
    blockers.push("editorial_inventory_blockers_not_clear");
  }
  blockers.push(...validateSafety(value.safety));
  const storyAssessment = validateStory(value.story);
  blockers.push(...storyAssessment.blockers);
  const registryDir = path.dirname(registryPath);
  const referenceNames = [
    "breaking_source_evidence",
    "weekly_source_evidence",
    "rights_ledger",
    "owned_motion_manifest",
    "advertiser_safety_report",
  ];
  const observed = {};
  for (const name of referenceNames) {
    observed[name] = await observeBoundFile({
      record: value[name],
      registryDir,
      allowedRoots,
      prefix: name,
    });
    blockers.push(...observed[name].blockers);
  }
  const breakingCanonical = normaliseSha256(
    value.breaking_source_evidence?.canonical_sha256,
  );
  if (!breakingCanonical) {
    blockers.push(
      "breaking_source_evidence_canonical_sha256_required",
    );
  }
  const rightsCanonical = normaliseSha256(
    value.rights_ledger?.canonical_sha256,
  );
  if (!rightsCanonical) {
    blockers.push("rights_ledger_canonical_sha256_required");
  }
  return {
    registry_path: registryPath,
    registry_file_sha256: observedRegistry.file_sha256 || null,
    story: storyAssessment.story,
    references: {
      breaking_source_evidence: {
        path: observed.breaking_source_evidence?.path || null,
        file_sha256:
          observed.breaking_source_evidence?.sha256 || null,
        canonical_sha256: breakingCanonical,
      },
      weekly_source_evidence: {
        path: observed.weekly_source_evidence?.path || null,
        file_sha256:
          observed.weekly_source_evidence?.sha256 || null,
      },
      rights_ledger: {
        path: observed.rights_ledger?.path || null,
        file_sha256: observed.rights_ledger?.sha256 || null,
        canonical_sha256: rightsCanonical,
      },
      owned_motion_manifest: {
        path: observed.owned_motion_manifest?.path || null,
        file_sha256:
          observed.owned_motion_manifest?.sha256 || null,
      },
      advertiser_safety_report: {
        path: observed.advertiser_safety_report?.path || null,
        file_sha256:
          observed.advertiser_safety_report?.sha256 || null,
      },
    },
    blockers: unique(blockers).sort(),
  };
}

function evergreenStory(entry) {
  const refs = entry.references;
  return {
    id: entry.story.id,
    title: entry.story.title,
    franchise: entry.story.franchise,
    platform: entry.story.platform,
    topic_key: entry.story.topic_key,
    published_at: entry.story.published_at,
    primary_source_url: entry.story.primary_source_url,
    verification_status: entry.story.verification_status,
    _extra: JSON.stringify({
      governed_editorial_inventory_path: entry.registry_path,
      governed_editorial_inventory_sha256:
        entry.registry_file_sha256,
      source_evidence_path: refs.breaking_source_evidence.path,
      source_evidence_file_sha256:
        refs.breaking_source_evidence.file_sha256,
      source_evidence_sha256:
        refs.breaking_source_evidence.canonical_sha256,
      rights_ledger_path: refs.rights_ledger.path,
      rights_ledger_file_sha256: refs.rights_ledger.file_sha256,
      rights_ledger_canonical_sha256:
        refs.rights_ledger.canonical_sha256,
      advertiser_safety_report_path:
        refs.advertiser_safety_report.path,
      advertiser_safety_report_sha256:
        refs.advertiser_safety_report.file_sha256,
    }),
  };
}

function weeklyCandidate(entry) {
  return {
    id: entry.story.id,
    title: entry.story.title,
    published_at: entry.story.published_at,
    primary_source_url: entry.story.primary_source_url,
    verification_status: entry.story.verification_status,
    weekly_priority_score: 0,
    source_evidence: {
      path: entry.references.weekly_source_evidence.path,
      sha256:
        entry.references.weekly_source_evidence.file_sha256,
    },
    rights_ledger: {
      path: entry.references.rights_ledger.path,
      sha256: entry.references.rights_ledger.file_sha256,
    },
    weekly_longform_pitch: null,
    governed_editorial_inventory: {
      path: entry.registry_path,
      sha256: entry.registry_file_sha256,
    },
  };
}

async function scanGovernedEditorialInventory({
  rootDir,
  allowedRoots,
  maximumManifests = DEFAULT_MAXIMUM_MANIFESTS,
} = {}) {
  const resolvedRoot = path.resolve(
    text(rootDir) ||
      path.join(process.cwd(), "output", "editorial-inventory"),
  );
  const maximum = Math.max(
    1,
    Math.min(
      DEFAULT_MAXIMUM_MANIFESTS,
      Number.isInteger(Number(maximumManifests))
        ? Number(maximumManifests)
        : DEFAULT_MAXIMUM_MANIFESTS,
    ),
  );
  const resolvedAllowedRoots = unique(
    (
      Array.isArray(allowedRoots) && allowedRoots.length
        ? allowedRoots
        : [resolvedRoot]
    ).map((candidate) => path.resolve(text(candidate))),
  );
  if (
    !resolvedAllowedRoots.some((candidate) =>
      isContained(candidate, resolvedRoot),
    )
  ) {
    resolvedAllowedRoots.push(resolvedRoot);
  }
  let rootStat = null;
  try {
    rootStat = await fs.lstat(resolvedRoot);
  } catch {
    // A first boot has no inventory yet. Report the absence explicitly
    // without creating directories or mutating runtime state.
  }
  const rootValid =
    rootStat?.isDirectory() === true &&
    rootStat?.isSymbolicLink() !== true;
  const registryPaths = rootValid
    ? await discoverRegistryFiles(resolvedRoot, maximum)
    : [];
  const assessed = [];
  for (const registryPath of registryPaths) {
    assessed.push(
      await assessRegistry(
        registryPath,
        resolvedRoot,
        resolvedAllowedRoots,
      ),
    );
  }

  const identityCounts = new Map();
  for (const entry of assessed) {
    const storyId = entry.story.id;
    if (!storyId) continue;
    identityCounts.set(storyId, (identityCounts.get(storyId) || 0) + 1);
  }
  for (const entry of assessed) {
    if (
      entry.story.id &&
      (identityCounts.get(entry.story.id) || 0) > 1
    ) {
      entry.blockers = unique([
        ...entry.blockers,
        "editorial_inventory_story_id_duplicate",
      ]).sort();
    }
  }
  const entries = assessed
    .filter((entry) => entry.blockers.length === 0)
    .sort((left, right) =>
      left.story.id.localeCompare(right.story.id),
    );
  const rejected = assessed
    .filter((entry) => entry.blockers.length > 0)
    .sort((left, right) =>
      left.registry_path.localeCompare(right.registry_path),
    );
  const rootBlockers = rootValid
    ? registryPaths.length
      ? []
      : ["governed_editorial_inventory_empty"]
    : ["governed_editorial_inventory_root_required"];
  return {
    schema_version: "pulse-governed-editorial-inventory-registry-v1",
    generated_at: new Date().toISOString(),
    mode: "LOCAL_PROOF",
    root_dir: resolvedRoot,
    allowed_roots: resolvedAllowedRoots,
    verdict:
      rootBlockers.length || rejected.length ? "HOLD" : "READY",
    blockers: rootBlockers,
    entries,
    rejected,
    evergreen_stories: entries.map(evergreenStory),
    weekly_longform_candidates: entries.map(weeklyCandidate),
    summary: {
      registry_count: registryPaths.length,
      ready_count: entries.length,
      rejected_count: rejected.length,
    },
    safety: {
      read_only: true,
      network_used: false,
      database_mutated: false,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
    },
  };
}

module.exports = {
  DEFAULT_MAXIMUM_MANIFESTS,
  REGISTRY_FILENAME,
  REGISTRY_SCHEMA,
  scanGovernedEditorialInventory,
};
