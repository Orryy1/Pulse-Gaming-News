"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  validateBreakingSourceEvidencePacket,
} = require("./breaking-source-evidence");
const {
  assessRightsLedger,
  hashRightsLedger,
} = require("./publication-evidence-gates");
const {
  scanGovernedEditorialInventory,
} = require("./governed-editorial-inventory-registry");
const {
  buildOfficialSourceReleaseBinding,
  validateOfficialSourceReleaseBinding,
} = require("./official-source-revalidation");

const SCHEMA_VERSION =
  "pulse-governed-editorial-inventory-candidate-hydration-v1";
const BINDINGS_SCHEMA =
  "pulse-governed-editorial-inventory-planner-bindings-v1";
const INVENTORY_SCHEMA =
  "pulse-governed-editorial-inventory-v1";
const SOURCE_SCHEMA = "pulse-breaking-source-evidence-v1";
const RIGHTS_SCHEMA =
  "pulse-weekly-longform-rights-ledger-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAXIMUM_JSON_BYTES = 2 * 1024 * 1024;

function text(value) {
  return String(value ?? "").trim();
}

function normaliseSha256(value) {
  const candidate = text(value)
    .replace(/^sha256:/i, "")
    .toLowerCase();
  return SHA256_PATTERN.test(candidate) ? candidate : null;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return sha256(
    Buffer.from(JSON.stringify(stableValue(value)), "utf8"),
  );
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
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

function samePath(left, right) {
  const first = path.resolve(text(left));
  const second = path.resolve(text(right));
  return process.platform === "win32"
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

async function resolvedDirectory(directory, prefix) {
  const absolutePath = path.resolve(text(directory));
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch {
    return {
      path: absolutePath,
      real_path: null,
      blockers: [`${prefix}_required`],
    };
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return {
      path: absolutePath,
      real_path: null,
      blockers: [`${prefix}_invalid`],
    };
  }
  return {
    path: absolutePath,
    real_path: await fs.realpath(absolutePath),
    blockers: [],
  };
}

async function readBoundJson({
  filePath,
  expectedFileSha256,
  allowedRealRoots,
  prefix,
}) {
  const blockers = [];
  const expectedSha256 = normaliseSha256(expectedFileSha256);
  if (!text(filePath)) blockers.push(`${prefix}_path_required`);
  if (!expectedSha256) {
    blockers.push(`${prefix}_file_sha256_required`);
  }
  if (blockers.length) {
    return { blockers, value: null, file_sha256: null };
  }
  const absolutePath = path.resolve(filePath);
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch {
    return {
      blockers: [`${prefix}_file_required`],
      value: null,
      file_sha256: null,
    };
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > MAXIMUM_JSON_BYTES
  ) {
    return {
      blockers: [`${prefix}_file_invalid`],
      value: null,
      file_sha256: null,
    };
  }
  const realPath = await fs.realpath(absolutePath);
  if (
    !allowedRealRoots.some((root) =>
      isContained(root, realPath),
    )
  ) {
    return {
      blockers: [`${prefix}_real_path_outside_allowed_root`],
      value: null,
      file_sha256: null,
    };
  }
  const bytes = await fs.readFile(realPath);
  const observedSha256 = sha256(bytes);
  if (observedSha256 !== expectedSha256) {
    blockers.push(`${prefix}_file_sha256_mismatch`);
  }
  let value = null;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    blockers.push(`${prefix}_json_invalid`);
  }
  if (!object(value)) blockers.push(`${prefix}_object_required`);
  return {
    blockers: unique(blockers),
    value,
    file_sha256: observedSha256,
    path: absolutePath,
    real_path: realPath,
  };
}

function exactReference(entry, name) {
  const reference = object(entry?.references?.[name]) || {};
  return {
    path: text(reference.path),
    file_sha256: normaliseSha256(reference.file_sha256),
    canonical_sha256: normaliseSha256(
      reference.canonical_sha256,
    ),
  };
}

function exactFileReference(entry, name) {
  const reference = object(entry?.references?.[name]) || {};
  return {
    path: text(reference.path),
    file_sha256: normaliseSha256(reference.file_sha256),
  };
}

function fileReferenceMatchesManifest(manifestRef, observedRef) {
  return (
    samePath(manifestRef?.path, observedRef.path) &&
    normaliseSha256(manifestRef?.file_sha256) ===
      observedRef.file_sha256
  );
}

function referenceMatchesManifest(manifestRef, observedRef) {
  return (
    samePath(manifestRef?.path, observedRef.path) &&
    normaliseSha256(manifestRef?.file_sha256) ===
      observedRef.file_sha256 &&
    normaliseSha256(manifestRef?.canonical_sha256) ===
      observedRef.canonical_sha256
  );
}

function existingBindingBlockers(
  candidate,
  bindings,
  sourcePacket,
) {
  const blockers = [];
  for (const [field, expected, blocker] of [
    [
      "source_evidence_path",
      bindings.source_evidence.path,
      "candidate_source_evidence_path_mismatch",
    ],
    [
      "source_evidence_file_sha256",
      bindings.source_evidence.file_sha256,
      "candidate_source_evidence_file_sha256_mismatch",
    ],
    [
      "source_evidence_sha256",
      bindings.source_evidence.canonical_sha256,
      "candidate_source_evidence_canonical_sha256_mismatch",
    ],
    [
      "rights_ledger_path",
      bindings.rights_ledger.path,
      "candidate_rights_ledger_path_mismatch",
    ],
    [
      "rights_ledger_file_sha256",
      bindings.rights_ledger.file_sha256,
      "candidate_rights_ledger_file_sha256_mismatch",
    ],
    [
      "rights_ledger_canonical_sha256",
      bindings.rights_ledger.canonical_sha256,
      "candidate_rights_ledger_canonical_sha256_mismatch",
    ],
    [
      "governed_editorial_inventory_path",
      bindings.inventory.path,
      "candidate_editorial_inventory_path_mismatch",
    ],
    [
      "governed_editorial_inventory_file_sha256",
      bindings.inventory.file_sha256,
      "candidate_editorial_inventory_file_sha256_mismatch",
    ],
    [
      "governed_editorial_inventory_canonical_sha256",
      bindings.inventory.canonical_sha256,
      "candidate_editorial_inventory_canonical_sha256_mismatch",
    ],
  ]) {
    const supplied = text(candidate?.[field]);
    if (!supplied) continue;
    const matches = field.endsWith("_path")
      ? samePath(supplied, expected)
      : normaliseSha256(supplied) === expected;
    if (!matches) blockers.push(blocker);
  }
  const publicationSource =
    bindings.publication_source_evidence;
  for (const [field, expected, blocker] of [
    [
      "publication_source_evidence_path",
      publicationSource.path,
      "candidate_publication_source_evidence_path_mismatch",
    ],
    [
      "publication_source_evidence_sha256",
      publicationSource.source_evidence_sha256,
      "candidate_publication_source_evidence_sha256_mismatch",
    ],
  ]) {
    const supplied = text(candidate?.[field]);
    if (!supplied) continue;
    const matches = field.endsWith("_path")
      ? samePath(supplied, expected)
      : normaliseSha256(supplied) === expected;
    if (!matches) blockers.push(blocker);
  }
  if (object(candidate?.official_source_release_binding)) {
    try {
      const validated = validateOfficialSourceReleaseBinding(
        candidate.official_source_release_binding,
        {
          storyId: bindings.story_id,
          sourceEvidenceSha256:
            publicationSource.source_evidence_sha256,
        },
      ).value;
      if (
        canonicalSha256(validated) !==
        canonicalSha256(
          publicationSource.official_source_release_binding,
        )
      ) {
        blockers.push(
          "candidate_official_source_release_binding_mismatch",
        );
      }
    } catch {
      blockers.push(
        "candidate_official_source_release_binding_mismatch",
      );
    }
  }
  if (
    candidate?.governed_editorial_inventory_bindings &&
    canonicalSha256(
      candidate.governed_editorial_inventory_bindings,
    ) !== canonicalSha256(bindings)
  ) {
    blockers.push("candidate_editorial_inventory_bindings_mismatch");
  }
  const nestedSourceEvidence = object(
    candidate?.governed_source_evidence,
  );
  if (nestedSourceEvidence) {
    const nestedMatches =
      text(
        nestedSourceEvidence.verification_status,
      ).toUpperCase() === "CONFIRMED" &&
      nestedSourceEvidence.verified_for_planning === true &&
      text(nestedSourceEvidence.primary_source_url) ===
        text(sourcePacket?.primary_source_url) &&
      normaliseSha256(
        nestedSourceEvidence.source_evidence_sha256,
      ) === bindings.source_evidence.canonical_sha256 &&
      samePath(
        nestedSourceEvidence.path,
        bindings.source_evidence.path,
      ) &&
      normaliseSha256(nestedSourceEvidence.file_sha256) ===
        bindings.source_evidence.file_sha256;
    if (!nestedMatches) {
      blockers.push(
        "candidate_governed_source_evidence_mismatch",
      );
    }
  }
  return blockers;
}

function declaresInventoryBinding(candidate) {
  if (
    object(candidate?.governed_editorial_inventory_bindings)
  ) {
    return true;
  }
  return [
    candidate?.governed_editorial_inventory_path,
    candidate?.governed_editorial_inventory_file_sha256,
    candidate?.governed_editorial_inventory_sha256,
    candidate?.governed_editorial_inventory_canonical_sha256,
  ].some((value) => text(value));
}

async function validateExactEntry({
  entry,
  storyId,
  inventoryRealRoot,
  allowedRealRoots,
}) {
  const blockers = [];
  const registryObserved = await readBoundJson({
    filePath: entry.registry_path,
    expectedFileSha256: entry.registry_file_sha256,
    allowedRealRoots: [inventoryRealRoot],
    prefix: "editorial_inventory_registry",
  });
  blockers.push(...registryObserved.blockers);
  const manifest = object(registryObserved.value) || {};
  if (manifest.schema_version !== INVENTORY_SCHEMA) {
    blockers.push("editorial_inventory_schema_invalid");
  }
  if (text(manifest.story?.id) !== storyId) {
    blockers.push("editorial_inventory_story_id_mismatch");
  }
  if (manifest.verdict !== "READY") {
    blockers.push("editorial_inventory_not_ready");
  }
  if (
    !Array.isArray(manifest.blockers) ||
    manifest.blockers.length
  ) {
    blockers.push("editorial_inventory_blockers_not_clear");
  }
  for (const field of [
    "database_mutated",
    "oauth_mutated",
    "platform_contacted",
    "publish_authority_created",
    "scheduler_authority_created",
    "external_posting_authorised",
  ]) {
    if (manifest.safety?.[field] === true) {
      blockers.push(`editorial_inventory_authority_${field}_forbidden`);
    }
  }
  const declaredInventorySha256 = normaliseSha256(
    manifest.inventory_sha256,
  );
  const {
    inventory_sha256: _inventorySha256,
    ...inventoryBase
  } = manifest;
  const observedInventorySha256 = canonicalSha256(inventoryBase);
  if (!declaredInventorySha256) {
    blockers.push("editorial_inventory_canonical_sha256_required");
  } else if (
    declaredInventorySha256 !== observedInventorySha256
  ) {
    blockers.push("editorial_inventory_canonical_sha256_mismatch");
  }

  const sourceRef = exactReference(
    entry,
    "breaking_source_evidence",
  );
  const publicationSourceRef = exactFileReference(
    entry,
    "weekly_source_evidence",
  );
  const rightsRef = exactReference(entry, "rights_ledger");
  if (
    !referenceMatchesManifest(
      manifest.breaking_source_evidence,
      sourceRef,
    )
  ) {
    blockers.push("editorial_inventory_source_reference_mismatch");
  }
  if (
    !fileReferenceMatchesManifest(
      manifest.weekly_source_evidence,
      publicationSourceRef,
    )
  ) {
    blockers.push(
      "editorial_inventory_publication_source_reference_mismatch",
    );
  }
  if (
    !referenceMatchesManifest(manifest.rights_ledger, rightsRef)
  ) {
    blockers.push("editorial_inventory_rights_reference_mismatch");
  }

  const sourceObserved = await readBoundJson({
    filePath: sourceRef.path,
    expectedFileSha256: sourceRef.file_sha256,
    allowedRealRoots,
    prefix: "breaking_source_evidence",
  });
  blockers.push(...sourceObserved.blockers);
  const sourcePacket = object(sourceObserved.value) || {};
  const sourceAssessment =
    validateBreakingSourceEvidencePacket(sourcePacket);
  blockers.push(...sourceAssessment.blockers);
  if (sourcePacket.schema_version !== SOURCE_SCHEMA) {
    blockers.push("breaking_source_packet_schema_invalid");
  }
  if (text(sourcePacket.story_id) !== storyId) {
    blockers.push("breaking_source_packet_story_id_mismatch");
  }
  if (
    sourcePacket.verification_status !== "CONFIRMED" ||
    sourcePacket.verified_for_planning !== true ||
    !["OFFICIAL_CONFIRMED", "CORROBORATED"].includes(
      sourcePacket.verdict,
    )
  ) {
    blockers.push("breaking_source_packet_confirmation_required");
  }
  if (
    !Array.isArray(sourcePacket.blockers) ||
    sourcePacket.blockers.length
  ) {
    blockers.push("breaking_source_packet_blockers_not_clear");
  }
  if (
    normaliseSha256(sourceAssessment.packet_sha256) !==
    sourceRef.canonical_sha256
  ) {
    blockers.push(
      "breaking_source_evidence_canonical_sha256_mismatch",
    );
  }
  if (
    text(sourcePacket.primary_source_url) !==
      text(entry.story?.primary_source_url) ||
    text(sourcePacket.primary_source_url) !==
      text(manifest.story?.primary_source_url)
  ) {
    blockers.push("breaking_source_packet_primary_url_mismatch");
  }

  const publicationSourceObserved = await readBoundJson({
    filePath: publicationSourceRef.path,
    expectedFileSha256:
      publicationSourceRef.file_sha256,
    allowedRealRoots,
    prefix: "publication_source_evidence",
  });
  blockers.push(...publicationSourceObserved.blockers);
  let officialSourceReleaseBinding = null;
  try {
    officialSourceReleaseBinding =
      buildOfficialSourceReleaseBinding({
        storyId,
        sourceEvidenceSha256:
          publicationSourceRef.file_sha256,
        sourceEvidence: publicationSourceObserved.value,
      });
  } catch (error) {
    blockers.push(
      text(error?.code) ||
        "official_source_release_binding_invalid",
    );
  }
  if (
    text(publicationSourceObserved.value?.source_url) !==
      text(sourcePacket.primary_source_url)
  ) {
    blockers.push(
      "publication_source_evidence_primary_url_mismatch",
    );
  }

  const rightsObserved = await readBoundJson({
    filePath: rightsRef.path,
    expectedFileSha256: rightsRef.file_sha256,
    allowedRealRoots,
    prefix: "rights_ledger",
  });
  blockers.push(...rightsObserved.blockers);
  const rightsLedger = object(rightsObserved.value) || {};
  if (rightsLedger.schema_version !== RIGHTS_SCHEMA) {
    blockers.push("rights_ledger_schema_invalid");
  }
  if (text(rightsLedger.story_id) !== storyId) {
    blockers.push("rights_ledger_story_id_mismatch");
  }
  const observedRightsCanonicalSha256 =
    hashRightsLedger(rightsLedger);
  if (
    normaliseSha256(rightsLedger.ledger_sha256) !==
      observedRightsCanonicalSha256 ||
    rightsRef.canonical_sha256 !==
      observedRightsCanonicalSha256
  ) {
    blockers.push("rights_ledger_canonical_sha256_mismatch");
  }
  blockers.push(
    ...assessRightsLedger(
      rightsLedger,
      observedRightsCanonicalSha256,
    ).blockers,
  );

  const bindings = {
    schema_version: BINDINGS_SCHEMA,
    story_id: storyId,
    inventory: {
      path: path.resolve(entry.registry_path),
      file_sha256: normaliseSha256(entry.registry_file_sha256),
      canonical_sha256: declaredInventorySha256,
    },
    source_evidence: sourceRef,
    publication_source_evidence: {
      path: publicationSourceRef.path,
      file_sha256: publicationSourceRef.file_sha256,
      source_evidence_sha256:
        publicationSourceRef.file_sha256,
      official_source_release_binding:
        officialSourceReleaseBinding,
    },
    rights_ledger: rightsRef,
  };
  return {
    blockers: unique(blockers).sort(),
    bindings,
    source_packet: sourcePacket,
  };
}

async function hydrateGovernedEditorialInventoryCandidates({
  candidates = [],
  inventoryRoot,
  allowedRoots = [],
  maximumManifests,
} = {}) {
  const exactCandidates = Array.isArray(candidates)
    ? structuredClone(candidates)
    : [];
  const inventoryDirectory = await resolvedDirectory(
    inventoryRoot,
    "governed_editorial_inventory_root",
  );
  const allowedDirectories = [];
  for (const root of Array.isArray(allowedRoots)
    ? allowedRoots
    : []) {
    allowedDirectories.push(
      await resolvedDirectory(
        root,
        "governed_editorial_inventory_allowed_root",
      ),
    );
  }
  const rootBlockers = [
    ...inventoryDirectory.blockers,
    ...allowedDirectories.flatMap((item) => item.blockers),
  ];
  const allowedRealRoots = allowedDirectories
    .map((item) => item.real_path)
    .filter(Boolean);
  if (
    inventoryDirectory.real_path &&
    !allowedRealRoots.some((root) =>
      isContained(root, inventoryDirectory.real_path),
    )
  ) {
    rootBlockers.push(
      "governed_editorial_inventory_root_outside_allowed_root",
    );
  }

  let scan = null;
  if (!rootBlockers.length) {
    scan = await scanGovernedEditorialInventory({
      rootDir: inventoryDirectory.path,
      allowedRoots: allowedDirectories.map((item) => item.path),
      maximumManifests,
    });
  }
  const readyEntries = new Map(
    (scan?.entries || []).map((entry) => [
      text(entry.story?.id),
      entry,
    ]),
  );
  const rejectedByStory = new Map();
  for (const entry of scan?.rejected || []) {
    const storyId = text(entry.story?.id);
    if (!storyId) continue;
    rejectedByStory.set(
      storyId,
      unique([
        ...(rejectedByStory.get(storyId) || []),
        ...(entry.blockers || []),
      ]).sort(),
    );
  }

  const outputCandidates = [];
  const hydrated = [];
  const rejected = [];
  const skipped = [];
  for (const candidate of exactCandidates) {
    if (text(candidate?.lane_id) !== "breaking_short") {
      outputCandidates.push(candidate);
      continue;
    }
    const storyId = text(candidate?.story_id);
    if (!storyId) {
      rejected.push({
        story_id: null,
        blockers: ["candidate_story_id_required"],
      });
      continue;
    }
    if (rootBlockers.length) {
      if (declaresInventoryBinding(candidate)) {
        rejected.push({
          story_id: storyId,
          blockers: unique(rootBlockers).sort(),
        });
      } else {
        outputCandidates.push(candidate);
        skipped.push({
          story_id: storyId,
          reason: "no_inventory_binding_declared",
        });
      }
      continue;
    }
    const entry = readyEntries.get(storyId);
    if (!entry) {
      const exactRejection = rejectedByStory.get(storyId);
      if (exactRejection || declaresInventoryBinding(candidate)) {
        rejected.push({
          story_id: storyId,
          blockers:
            exactRejection ||
            ["exact_ready_editorial_inventory_required"],
        });
      } else {
        outputCandidates.push(candidate);
        skipped.push({
          story_id: storyId,
          reason: "no_exact_inventory_entry",
        });
      }
      continue;
    }
    const assessment = await validateExactEntry({
      entry,
      storyId,
      inventoryRealRoot: inventoryDirectory.real_path,
      allowedRealRoots,
    });
    const conflictBlockers = existingBindingBlockers(
      candidate,
      assessment.bindings,
      assessment.source_packet,
    );
    const blockers = unique([
      ...assessment.blockers,
      ...conflictBlockers,
    ]).sort();
    if (blockers.length) {
      rejected.push({ story_id: storyId, blockers });
      continue;
    }
    const bindings = assessment.bindings;
    const hydratedCandidate = {
      ...candidate,
      verification_status: "CONFIRMED",
      verified_for_planning: true,
      primary_source_url:
        assessment.source_packet.primary_source_url,
      source_evidence_path: bindings.source_evidence.path,
      source_evidence_file_sha256:
        bindings.source_evidence.file_sha256,
      source_evidence_sha256:
        bindings.source_evidence.canonical_sha256,
      publication_source_evidence_path:
        bindings.publication_source_evidence.path,
      publication_source_evidence_file_sha256:
        bindings.publication_source_evidence.file_sha256,
      publication_source_evidence_sha256:
        bindings.publication_source_evidence
          .source_evidence_sha256,
      official_source_release_binding:
        structuredClone(
          bindings.publication_source_evidence
            .official_source_release_binding,
        ),
      rights_ledger_path: bindings.rights_ledger.path,
      rights_ledger_file_sha256:
        bindings.rights_ledger.file_sha256,
      rights_ledger_sha256:
        bindings.rights_ledger.canonical_sha256,
      rights_ledger_canonical_sha256:
        bindings.rights_ledger.canonical_sha256,
      governed_editorial_inventory_path:
        bindings.inventory.path,
      governed_editorial_inventory_file_sha256:
        bindings.inventory.file_sha256,
      governed_editorial_inventory_canonical_sha256:
        bindings.inventory.canonical_sha256,
      governed_editorial_inventory_bindings:
        structuredClone(bindings),
      governed_source_evidence: {
        verification_status: "CONFIRMED",
        verified_for_planning: true,
        primary_source_url:
          assessment.source_packet.primary_source_url,
        source_evidence_sha256:
          bindings.source_evidence.canonical_sha256,
        path: bindings.source_evidence.path,
        file_sha256:
          bindings.source_evidence.file_sha256,
      },
    };
    outputCandidates.push(hydratedCandidate);
    hydrated.push({
      story_id: storyId,
      bindings: structuredClone(bindings),
    });
  }

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    verdict:
      hydrated.length > 0 && rootBlockers.length === 0
        ? "READY"
        : "HOLD",
    candidates: outputCandidates,
    hydrated,
    rejected,
    skipped,
    scan: scan
      ? {
          schema_version: scan.schema_version,
          verdict: scan.verdict,
          summary: scan.summary,
          blockers: scan.blockers,
        }
      : null,
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
  BINDINGS_SCHEMA,
  SCHEMA_VERSION,
  hydrateGovernedEditorialInventoryCandidates,
};
