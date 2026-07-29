"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  validateBreakingSourceEvidencePacket,
} = require("./breaking-source-evidence");

const REPORT_SCHEMA = "pulse-breaking-editorial-inventory-reconciliation-v1";
const EVIDENCE_FILENAME_PATTERN = /^source-evidence-([a-f0-9]{64})\.json$/;
const DEFAULT_MAXIMUM_ENTRIES = 2_000;
const DEFAULT_MAXIMUM_EVIDENCE_FILES = 500;
const DEFAULT_MAXIMUM_DEPTH = 12;
const MAXIMUM_EVIDENCE_BYTES = 2 * 1024 * 1024;
const SECRET_PATH_SEGMENTS = new Set([
  ".aws",
  ".credentials",
  ".env",
  ".git",
  ".gnupg",
  ".secrets",
  ".ssh",
  "credentials",
  "secret",
  "secrets",
  "token",
  "tokens",
]);

function text(value) {
  return String(value ?? "").trim();
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function boundedInteger(value, fallback, maximum = fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function rejectedEntry(candidatePath, blockers, storyId = null) {
  return {
    path: candidatePath,
    story_id: text(storyId) || null,
    blockers: uniqueSorted(blockers),
  };
}

function isSecretPathSegment(value) {
  return SECRET_PATH_SEGMENTS.has(text(value).toLowerCase());
}

function hasSecretPathSegment(value) {
  const absolutePath = path.resolve(value);
  const rootLength = path.parse(absolutePath).root.length;
  return absolutePath
    .slice(rootLength)
    .split(/[\\/]+/)
    .some(isSecretPathSegment);
}

function readyStoryIdsFromGovernedInventory(report) {
  if (report === undefined || report === null) {
    return { storyIds: new Set(), blockers: [] };
  }
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.schema_version !==
      "pulse-governed-editorial-inventory-registry-v1" ||
    report.mode !== "LOCAL_PROOF" ||
    !Array.isArray(report.entries) ||
    report.safety?.read_only !== true ||
    report.safety?.publish_authority_created !== false
  ) {
    return {
      storyIds: new Set(),
      blockers: ["governed_editorial_inventory_report_invalid"],
    };
  }
  const storyIds = new Set();
  for (const entry of report.entries) {
    const storyId = text(entry?.story?.id);
    if (
      storyId &&
      Array.isArray(entry?.blockers) &&
      entry.blockers.length === 0
    ) {
      storyIds.add(storyId);
    }
  }
  return { storyIds, blockers: [] };
}

async function discoverEvidenceFiles({
  root,
  maximumEntries,
  maximumEvidenceFiles,
  maximumDepth,
}) {
  const candidates = [];
  const rejected = [];
  const blockers = [];
  let entriesVisited = 0;
  let directoriesVisited = 0;
  let limitReached = false;

  async function visit(directory, depth) {
    if (limitReached) return;
    directoriesVisited += 1;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      rejected.push(
        rejectedEntry(directory, ["breaking_discovery_directory_unreadable"]),
      );
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entriesVisited >= maximumEntries) {
        limitReached = true;
        blockers.push("breaking_discovery_traversal_limit_reached");
        break;
      }
      entriesVisited += 1;
      const absolutePath = path.resolve(directory, entry.name);
      if (!isContained(root, absolutePath)) {
        rejected.push(
          rejectedEntry(absolutePath, [
            "breaking_source_evidence_path_outside_root",
          ]),
        );
        continue;
      }
      if (isSecretPathSegment(entry.name)) {
        rejected.push(
          rejectedEntry(absolutePath, [
            "breaking_source_evidence_secret_path_forbidden",
          ]),
        );
        continue;
      }
      if (entry.isSymbolicLink()) {
        rejected.push(
          rejectedEntry(absolutePath, [
            "breaking_source_evidence_symlink_forbidden",
          ]),
        );
        continue;
      }
      if (entry.isDirectory()) {
        if (depth >= maximumDepth) {
          rejected.push(
            rejectedEntry(absolutePath, [
              "breaking_discovery_maximum_depth_exceeded",
            ]),
          );
          continue;
        }
        await visit(absolutePath, depth + 1);
        continue;
      }
      if (!EVIDENCE_FILENAME_PATTERN.test(entry.name)) continue;
      if (candidates.length >= maximumEvidenceFiles) {
        limitReached = true;
        blockers.push("breaking_discovery_evidence_limit_reached");
        break;
      }
      candidates.push(absolutePath);
    }
  }

  await visit(root, 0);
  return {
    candidates,
    rejected,
    blockers: uniqueSorted(blockers),
    traversal: {
      entries_visited: entriesVisited,
      directories_visited: directoriesVisited,
      candidate_count: candidates.length,
      limit_reached: limitReached,
    },
  };
}

async function assessEvidenceFile(candidatePath, root, rootRealPath) {
  const blockers = [];
  let stat;
  try {
    stat = await fs.lstat(candidatePath);
  } catch {
    return {
      rejected: rejectedEntry(candidatePath, [
        "breaking_source_evidence_file_required",
      ]),
    };
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > MAXIMUM_EVIDENCE_BYTES
  ) {
    return {
      rejected: rejectedEntry(candidatePath, [
        "breaking_source_evidence_file_invalid",
      ]),
    };
  }
  let realPath;
  try {
    realPath = await fs.realpath(candidatePath);
  } catch {
    return {
      rejected: rejectedEntry(candidatePath, [
        "breaking_source_evidence_file_required",
      ]),
    };
  }
  if (
    !isContained(root, candidatePath) ||
    !isContained(rootRealPath, realPath)
  ) {
    return {
      rejected: rejectedEntry(candidatePath, [
        "breaking_source_evidence_path_outside_root",
      ]),
    };
  }
  let bytes;
  try {
    bytes = await fs.readFile(candidatePath);
  } catch {
    return {
      rejected: rejectedEntry(candidatePath, [
        "breaking_source_evidence_file_unreadable",
      ]),
    };
  }
  let packet;
  try {
    packet = JSON.parse(bytes.toString("utf8"));
  } catch {
    return {
      rejected: rejectedEntry(candidatePath, [
        "breaking_source_evidence_json_invalid",
      ]),
    };
  }
  const storyId = text(packet?.story_id);
  const validation = validateBreakingSourceEvidencePacket(packet);
  blockers.push(...validation.blockers);
  const filenameMatch = path
    .basename(candidatePath)
    .match(EVIDENCE_FILENAME_PATTERN);
  if (!filenameMatch || filenameMatch[1] !== validation.packet_sha256) {
    blockers.push("breaking_source_evidence_filename_sha256_mismatch");
  }
  if (packet?.verdict !== "OFFICIAL_CONFIRMED") {
    blockers.push("breaking_source_evidence_official_confirmation_required");
  }
  if (packet?.verification_status !== "CONFIRMED") {
    blockers.push("breaking_source_evidence_confirmation_required");
  }
  if (packet?.verified_for_planning !== true) {
    blockers.push("breaking_source_evidence_planning_verification_required");
  }
  if (!storyId) {
    blockers.push("breaking_source_evidence_story_id_required");
  }
  if (blockers.length) {
    return {
      rejected: rejectedEntry(candidatePath, blockers, storyId),
    };
  }
  return {
    work_item: {
      story_id: storyId,
      breaking_source_evidence: {
        path: candidatePath,
        file_sha256: sha256(bytes),
        canonical_sha256: validation.packet_sha256,
      },
    },
  };
}

function baseReport({
  generatedAt,
  root,
  blockers,
  workItems,
  rejected,
  skipped,
  traversal,
}) {
  return {
    schema_version: REPORT_SCHEMA,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    root_dir: root,
    verdict:
      blockers.length ||
      rejected.length ||
      workItems.length + skipped.length === 0
        ? "HOLD"
        : "READY",
    blockers: uniqueSorted(blockers),
    work_items: workItems,
    skipped,
    rejected,
    traversal,
    summary: {
      candidate_count: traversal.candidate_count,
      work_item_count: workItems.length,
      skipped_count: skipped.length,
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

async function reconcileBreakingEditorialInventory({
  breakingDiscoveryRoot,
  governedInventoryReport,
  maximumEntries = DEFAULT_MAXIMUM_ENTRIES,
  maximumEvidenceFiles = DEFAULT_MAXIMUM_EVIDENCE_FILES,
  maximumDepth = DEFAULT_MAXIMUM_DEPTH,
  now,
} = {}) {
  const generatedAt = Number.isFinite(Date.parse(text(now)))
    ? new Date(text(now)).toISOString()
    : new Date().toISOString();
  const declaredRoot = text(breakingDiscoveryRoot);
  const governedInventory = readyStoryIdsFromGovernedInventory(
    governedInventoryReport,
  );
  const root = declaredRoot ? path.resolve(declaredRoot) : null;
  const emptyTraversal = {
    entries_visited: 0,
    directories_visited: 0,
    candidate_count: 0,
    limit_reached: false,
  };
  if (!root) {
    return baseReport({
      generatedAt,
      root,
      blockers: [
        "breaking_discovery_root_required",
        ...governedInventory.blockers,
      ],
      workItems: [],
      rejected: [],
      skipped: [],
      traversal: emptyTraversal,
    });
  }
  if (hasSecretPathSegment(root)) {
    return baseReport({
      generatedAt,
      root,
      blockers: [
        "breaking_discovery_root_secret_path_forbidden",
        ...governedInventory.blockers,
      ],
      workItems: [],
      rejected: [],
      skipped: [],
      traversal: emptyTraversal,
    });
  }
  let rootStat;
  let rootRealPath;
  try {
    rootStat = await fs.lstat(root);
    rootRealPath = await fs.realpath(root);
  } catch {
    return baseReport({
      generatedAt,
      root,
      blockers: [
        "breaking_discovery_root_required",
        ...governedInventory.blockers,
      ],
      workItems: [],
      rejected: [],
      skipped: [],
      traversal: emptyTraversal,
    });
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return baseReport({
      generatedAt,
      root,
      blockers: [
        "breaking_discovery_root_invalid",
        ...governedInventory.blockers,
      ],
      workItems: [],
      rejected: [],
      skipped: [],
      traversal: emptyTraversal,
    });
  }
  const discovery = await discoverEvidenceFiles({
    root,
    maximumEntries: boundedInteger(
      maximumEntries,
      DEFAULT_MAXIMUM_ENTRIES,
      DEFAULT_MAXIMUM_ENTRIES,
    ),
    maximumEvidenceFiles: boundedInteger(
      maximumEvidenceFiles,
      DEFAULT_MAXIMUM_EVIDENCE_FILES,
      DEFAULT_MAXIMUM_EVIDENCE_FILES,
    ),
    maximumDepth: boundedInteger(
      maximumDepth,
      DEFAULT_MAXIMUM_DEPTH,
      DEFAULT_MAXIMUM_DEPTH,
    ),
  });
  const workItems = [];
  const skipped = [];
  const rejected = [...discovery.rejected];
  for (const candidatePath of discovery.candidates) {
    const assessed = await assessEvidenceFile(
      candidatePath,
      root,
      rootRealPath,
    );
    if (assessed.work_item) {
      if (governedInventory.storyIds.has(assessed.work_item.story_id)) {
        skipped.push({
          story_id: assessed.work_item.story_id,
          reason: "governed_editorial_inventory_ready",
          breaking_source_evidence: assessed.work_item.breaking_source_evidence,
        });
      } else {
        workItems.push(assessed.work_item);
      }
    }
    if (assessed.rejected) rejected.push(assessed.rejected);
  }
  workItems.sort(
    (left, right) =>
      left.story_id.localeCompare(right.story_id) ||
      left.breaking_source_evidence.path.localeCompare(
        right.breaking_source_evidence.path,
      ),
  );
  skipped.sort(
    (left, right) =>
      left.story_id.localeCompare(right.story_id) ||
      left.breaking_source_evidence.path.localeCompare(
        right.breaking_source_evidence.path,
      ),
  );
  rejected.sort((left, right) => left.path.localeCompare(right.path));
  const blockers = [...discovery.blockers, ...governedInventory.blockers];
  if (
    discovery.candidates.length === 0 &&
    !blockers.includes("breaking_discovery_evidence_limit_reached")
  ) {
    blockers.push("breaking_source_evidence_not_found");
  }
  return baseReport({
    generatedAt,
    root,
    blockers,
    workItems,
    rejected,
    skipped,
    traversal: discovery.traversal,
  });
}

module.exports = {
  DEFAULT_MAXIMUM_DEPTH,
  DEFAULT_MAXIMUM_ENTRIES,
  DEFAULT_MAXIMUM_EVIDENCE_FILES,
  EVIDENCE_FILENAME_PATTERN,
  MAXIMUM_EVIDENCE_BYTES,
  REPORT_SCHEMA,
  reconcileBreakingEditorialInventory,
};
