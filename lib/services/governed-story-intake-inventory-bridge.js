"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  validateBreakingSourceEvidencePacket,
} = require("./breaking-source-evidence");
const {
  extractReadableBody,
} = require("./breaking-source-adapters");
const {
  hydrateGovernedEditorialInventoryCandidates,
} = require("./governed-editorial-inventory-candidate-hydrator");
const {
  validateStoryIntakeManifest,
} = require("./governed-story-intake");
const {
  buildOfficialSourceReleaseBinding,
} = require("./official-source-revalidation");
const {
  countSpokenWords,
} = require("./short-runtime-planner");
const {
  canonicalHash,
  canonicalUrl,
} = require("./url-canonical");

const PROOF_SCHEMA =
  "pulse-governed-story-intake-inventory-bridge-proof-v1";
const INVENTORY_SCHEMA =
  "pulse-governed-editorial-inventory-v1";
const SOURCE_EVIDENCE_SCHEMA = "pulse-source-evidence-v1";
const INTAKE_SCHEMA = "pulse-governed-story-intake-v1";
const SCRIPT_MIN_WORDS = 37;
const SCRIPT_MAX_WORDS = 47;
const SCRIPT_TARGET_WORDS = 42;
const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;
const MAXIMUM_CLAIMS = 12;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OUTPUT_FILENAMES = Object.freeze({
  sourceEvidence: "source-evidence.json",
  storyIntake: "story-intake.json",
  proof: "compatibility-bridge-proof.json",
  summary: "compatibility-bridge-proof.md",
});

class GovernedStoryIntakeInventoryBridgeError extends Error {
  constructor(blockers) {
    const exactBlockers = unique(blockers).sort();
    super(
      `governed_story_intake_inventory_bridge_failed:${exactBlockers.join(",")}`,
    );
    this.name = "GovernedStoryIntakeInventoryBridgeError";
    this.blockers = exactBlockers;
  }
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set(array(values).filter(Boolean))];
}

function normaliseSha256(value) {
  const candidate = text(value)
    .replace(/^sha256:/i, "")
    .toLowerCase();
  return SHA256_PATTERN.test(candidate) ? candidate : null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
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

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderProofMarkdown(proof) {
  return [
    "# Governed Story-Intake Compatibility Bridge",
    "",
    `- Canonical story: \`${proof.story_id}\``,
    `- Legacy story: \`${proof.legacy_story_id}\``,
    `- Intake verdict: **${proof.verdict}**`,
    `- Publication verdict: **${proof.publish_verdict}**`,
    `- Script: **${proof.script.word_count} words**`,
    "- Canonical validator: **PASS**",
    "- Legacy input mutation: **No**",
    "- Database mutation: **No**",
    "- OAuth mutation: **No**",
    "- Platform contact: **No**",
    "- Publish authority created: **No**",
    "",
    "## Publication blockers",
    "",
    ...proof.quality.blockers.map((blocker) => `- \`${blocker}\``),
    "",
    "The canonical intake is schema-valid local proof. It remains non-publishable until exact-subject media and human quality review pass.",
    "",
  ].join("\n");
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

async function readBoundJson({
  filePath,
  expectedSha256,
  allowedRoots,
  prefix,
}) {
  const blockers = [];
  const absolutePath = path.resolve(text(filePath));
  const expected = normaliseSha256(expectedSha256);
  if (!text(filePath)) blockers.push(`${prefix}_path_required`);
  if (!expected) blockers.push(`${prefix}_file_sha256_required`);
  if (
    text(filePath) &&
    !allowedRoots.some((root) => isContained(root, absolutePath))
  ) {
    blockers.push(`${prefix}_path_outside_allowed_root`);
  }
  if (blockers.length) {
    throw new GovernedStoryIntakeInventoryBridgeError(blockers);
  }
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch {
    throw new GovernedStoryIntakeInventoryBridgeError([
      `${prefix}_file_required`,
    ]);
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > MAXIMUM_JSON_BYTES
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      `${prefix}_file_invalid`,
    ]);
  }
  const realPath = await fs.realpath(absolutePath);
  if (!allowedRoots.some((root) => isContained(root, realPath))) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      `${prefix}_real_path_outside_allowed_root`,
    ]);
  }
  const bytes = await fs.readFile(realPath);
  const observedSha256 = sha256(bytes);
  if (observedSha256 !== expected) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      `${prefix}_file_sha256_mismatch`,
    ]);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new GovernedStoryIntakeInventoryBridgeError([
      `${prefix}_json_invalid`,
    ]);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      `${prefix}_object_required`,
    ]);
  }
  return {
    path: absolutePath,
    real_path: realPath,
    bytes,
    file_sha256: observedSha256,
    value,
  };
}

function exactOfficialClaims(packet) {
  const blockers = [];
  const primarySourceUrl = text(packet?.primary_source_url);
  const sourcesById = new Map(
    array(packet?.sources).map((source) => [
      text(source?.source_id),
      source,
    ]),
  );
  const claims = [];
  for (const group of array(packet?.confirmed_claims)) {
    const claimKey = text(group?.claim_key);
    const evidence = array(group?.evidence).find((entry) => {
      const source = sourcesById.get(text(entry?.source_id));
      return (
        source?.status === "CAPTURED" &&
        text(source?.source_class).toUpperCase() ===
          "OFFICIAL_FIRST_PARTY" &&
        text(source?.final_url) === primarySourceUrl &&
        text(entry?.final_url) === primarySourceUrl
      );
    });
    const source = sourcesById.get(text(evidence?.source_id));
    const claimText = String(evidence?.text ?? "");
    const sourceClaim = array(source?.claims).find(
      (claim) =>
        text(claim?.claim_key) === claimKey &&
        String(claim?.text ?? "") === claimText &&
        normaliseSha256(claim?.claim_sha256) ===
          normaliseSha256(evidence?.claim_sha256) &&
        normaliseSha256(claim?.claim_text_sha256) ===
          sha256(Buffer.from(claimText, "utf8")),
    );
    if (!claimKey || !evidence || !sourceClaim || !claimText.trim()) {
      blockers.push("official_claim_binding_invalid");
      continue;
    }
    claims.push({
      claim_key: claimKey,
      text: claimText.trim(),
      claim_sha256: normaliseSha256(sourceClaim.claim_sha256),
      claim_text_sha256: normaliseSha256(
        sourceClaim.claim_text_sha256,
      ),
    });
  }
  claims.sort(
    (left, right) =>
      left.claim_key.localeCompare(right.claim_key) ||
      left.text.localeCompare(right.text),
  );
  if (!claims.length) blockers.push("official_claims_required");
  if (claims.length > MAXIMUM_CLAIMS) {
    blockers.push("official_claim_inventory_exceeds_bound");
  }
  if (new Set(claims.map((claim) => claim.text)).size !== claims.length) {
    blockers.push("official_claim_text_duplicate");
  }
  if (blockers.length) {
    throw new GovernedStoryIntakeInventoryBridgeError(blockers);
  }
  return claims;
}

function cleanExactOfficialClaim(claim) {
  const capturedText = String(claim?.text ?? "");
  const visibleText = capturedText
    .replace(/\[(?:\/?(?:h[1-6]|b|i|u|p)|br)\]/gi, "")
    .trim();
  if (
    !capturedText.trim() ||
    !visibleText ||
    (visibleText !== capturedText.trim() &&
      (!capturedText.includes(visibleText) ||
        /\[[^\]]+\]/.test(visibleText)))
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "official_claim_visible_text_transform_invalid",
    ]);
  }
  return {
    text: visibleText,
    claim_text_sha256: sha256(
      Buffer.from(visibleText, "utf8"),
    ),
    captured_text: capturedText,
    captured_text_sha256: sha256(
      Buffer.from(capturedText, "utf8"),
    ),
    transformation:
      visibleText === capturedText.trim()
        ? {
            algorithm: "exact-source-substring-v1",
            transformed: false,
          }
        : {
            algorithm: "steam-bbcode-visible-text-v1",
            transformed: true,
          },
  };
}

function exactOfficialClaimInventory(packet) {
  const sourceByIdentity = new Map(
    array(packet?.sources).map((source) => [
      `${text(source?.source_id)}\0${text(source?.final_url)}`,
      source,
    ]),
  );
  const claims = [];
  const blockers = [];
  for (const group of array(packet?.confirmed_claims)) {
    const claimKey = text(group?.claim_key);
    for (const evidence of array(group?.evidence)) {
      const sourceIdentity =
        `${text(evidence?.source_id)}\0${text(evidence?.final_url)}`;
      const source = sourceByIdentity.get(sourceIdentity);
      const capturedText = String(evidence?.text ?? "");
      const sourceClaim = array(source?.claims).find(
        (claim) =>
          text(claim?.claim_key) === claimKey &&
          String(claim?.text ?? "") === capturedText &&
          normaliseSha256(claim?.claim_sha256) ===
            normaliseSha256(evidence?.claim_sha256) &&
          normaliseSha256(claim?.claim_text_sha256) ===
            sha256(Buffer.from(capturedText, "utf8")),
      );
      const canonicalBody = object(source?.canonical_body);
      if (
        !claimKey ||
        source?.status !== "CAPTURED" ||
        text(source?.source_class).toUpperCase() !==
          "OFFICIAL_FIRST_PARTY" ||
        !sourceClaim ||
        canonicalBody.algorithm !== "pulse-readable-body-v1" ||
        !normaliseSha256(canonicalBody.sha256)
      ) {
        blockers.push("official_claim_binding_invalid");
        continue;
      }
      const clean = cleanExactOfficialClaim(sourceClaim);
      claims.push({
        claim_key: claimKey,
        text: clean.text,
        claim_text_sha256: clean.claim_text_sha256,
        captured_text: clean.captured_text,
        captured_text_sha256: clean.captured_text_sha256,
        captured_claim_sha256: normaliseSha256(
          sourceClaim.claim_sha256,
        ),
        source_url: text(source.final_url),
        source_id: text(source.source_id),
        source_class: "OFFICIAL_FIRST_PARTY",
        publisher: text(source.publisher),
        canonical_body_algorithm: canonicalBody.algorithm,
        canonical_body_sha256: normaliseSha256(
          canonicalBody.sha256,
        ),
        transformation: clean.transformation,
      });
    }
  }
  claims.sort(
    (left, right) =>
      left.claim_key.localeCompare(right.claim_key) ||
      left.source_url.localeCompare(right.source_url) ||
      left.claim_text_sha256.localeCompare(
        right.claim_text_sha256,
      ),
  );
  const identities = new Set();
  for (const claim of claims) {
    const identity =
      `${claim.claim_key}\0${claim.source_url}`;
    if (identities.has(identity)) {
      blockers.push("official_claim_identity_duplicate");
    }
    identities.add(identity);
  }
  if (!claims.length) blockers.push("official_claims_required");
  if (claims.length > MAXIMUM_CLAIMS) {
    blockers.push("official_claim_inventory_exceeds_bound");
  }
  if (blockers.length) {
    throw new GovernedStoryIntakeInventoryBridgeError(blockers);
  }
  return claims;
}

function validateKeyedScriptClaimBindings({
  script,
  claims,
  bindings,
}) {
  const blockers = [];
  const byKey = new Map(
    claims.map((claim) => [claim.claim_key, claim]),
  );
  const exactBindings = array(bindings);
  const clauses = exactBindings.map((binding) =>
    text(binding?.clause),
  );
  if (
    !exactBindings.length ||
    clauses.some((clause) => !clause) ||
    clauses.join(" ") !== script
  ) {
    blockers.push("script_claim_binding_clause_partition_invalid");
  }
  const result = [];
  for (let index = 0; index < exactBindings.length; index += 1) {
    const claimKeys = unique(
      array(exactBindings[index]?.claim_keys).map((value) =>
        text(value),
      ),
    );
    const selected = claimKeys.map((claimKey) =>
      byKey.get(claimKey),
    );
    if (
      !claimKeys.length ||
      selected.some((claim) => !claim)
    ) {
      blockers.push(`script_claim_binding_${index}_claims_invalid`);
      continue;
    }
    const clauseTokens = supportTokens(clauses[index]);
    const sourceTokens = supportTokens(
      selected
        .map(
          (claim) =>
            `${claim.claim_key.replace(/[._-]+/g, " ")} ${claim.text}`,
        )
        .join(" "),
    );
    const sharedTokens = unique(
      clauseTokens.filter((clauseToken) =>
        sourceTokens.some((sourceToken) =>
          relatedSupportToken(clauseToken, sourceToken),
        ),
      ),
    ).sort();
    if (sharedTokens.length < 2) {
      blockers.push(
        `script_claim_binding_${index}_source_support_too_weak`,
      );
    }
    result.push({
      clause: clauses[index],
      clause_sha256: sha256(
        Buffer.from(clauses[index], "utf8"),
      ),
      claim_keys: claimKeys,
      claim_text_sha256: selected.map(
        (claim) => claim.claim_text_sha256,
      ),
      shared_support_tokens: sharedTokens,
    });
  }
  if (blockers.length) {
    throw new GovernedStoryIntakeInventoryBridgeError(blockers);
  }
  return result;
}

function exactClaimLiterals(claimText) {
  const raw = String(claimText ?? "");
  const literals = [];
  for (const match of raw.matchAll(
    /:\s*(?:"([^"]+)"|(-?\d+(?:\.\d+)?))/g,
  )) {
    const value = text(match[1] ?? match[2]);
    if (value) literals.push(value);
  }
  return unique(literals);
}

function validatePresentationClaimBindings({
  claims,
  bindings,
}) {
  const byKey = new Map(
    claims.map((claim) => [claim.claim_key, claim]),
  );
  const blockers = [];
  const result = [];
  const seenText = new Set();
  for (let index = 0; index < array(bindings).length; index += 1) {
    const binding = object(bindings[index]);
    const presentationText = text(
      binding.presentation_text,
    );
    const claimKeys = unique(
      array(binding.claim_keys).map((value) => text(value)),
    );
    const selected = claimKeys.map((claimKey) =>
      byKey.get(claimKey),
    );
    if (
      !presentationText ||
      seenText.has(presentationText) ||
      !claimKeys.length ||
      selected.some((claim) => !claim)
    ) {
      blockers.push(
        `presentation_claim_binding_${index}_invalid`,
      );
      continue;
    }
    seenText.add(presentationText);
    const presentationLower = presentationText.toLowerCase();
    const matchedLiterals = unique(
      selected.flatMap((claim) =>
        exactClaimLiterals(claim.text).filter((literal) =>
          presentationLower.includes(literal.toLowerCase()),
        ),
      ),
    );
    const sourceTokens = supportTokens(
      selected
        .map(
          (claim) =>
            `${claim.claim_key.replace(/[._-]+/g, " ")} ${claim.text}`,
        )
        .join(" "),
    );
    const sharedTokens = unique(
      supportTokens(presentationText).filter((token) =>
        sourceTokens.some((sourceToken) =>
          relatedSupportToken(token, sourceToken),
        ),
      ),
    ).sort();
    if (!matchedLiterals.length && !sharedTokens.length) {
      blockers.push(
        `presentation_claim_binding_${index}_source_support_too_weak`,
      );
    }
    result.push({
      presentation_text: presentationText,
      presentation_text_sha256: sha256(
        Buffer.from(presentationText, "utf8"),
      ),
      claim_keys: claimKeys,
      claim_text_sha256: selected.map(
        (claim) => claim.claim_text_sha256,
      ),
      matched_exact_literals: matchedLiterals.sort(),
      shared_support_tokens: sharedTokens,
    });
  }
  if (blockers.length) {
    throw new GovernedStoryIntakeInventoryBridgeError(blockers);
  }
  return result;
}

function officialSnapshotForSource(sourceUrl, claims) {
  const selected = claims.filter(
    (claim) => claim.source_url === sourceUrl,
  );
  if (!selected.length) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "official_source_snapshot_claims_required",
    ]);
  }
  const sourceIds = unique(
    selected.map((claim) => claim.source_id),
  );
  const sourceClasses = unique(
    selected.map((claim) => claim.source_class),
  );
  const bodyAlgorithms = unique(
    selected.map((claim) => claim.canonical_body_algorithm),
  );
  const bodyHashes = unique(
    selected.map((claim) => claim.canonical_body_sha256),
  );
  if (
    sourceIds.length !== 1 ||
    sourceClasses.length !== 1 ||
    bodyAlgorithms.length !== 1 ||
    bodyHashes.length !== 1
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "official_source_snapshot_identity_ambiguous",
    ]);
  }
  return {
    schema_version: "pulse-official-source-snapshot-v1",
    source_url: sourceUrl,
    source_id: sourceIds[0],
    source_class: sourceClasses[0],
    canonical_body_algorithm: bodyAlgorithms[0],
    canonical_body_sha256: bodyHashes[0],
    claims: selected.map(
      ({ claim_key, text: claimText, claim_text_sha256 }) => ({
        claim_key,
        text: claimText,
        claim_text_sha256,
      }),
    ),
  };
}

async function verifyOfficialPacketSourceArchives({
  packet,
  allowedRoots,
  prefix,
}) {
  const blockers = [];
  const officialSources = array(packet?.sources).filter(
    (source) =>
      source?.status === "CAPTURED" &&
      text(source?.source_class).toUpperCase() ===
        "OFFICIAL_FIRST_PARTY",
  );
  if (!officialSources.length) {
    blockers.push(`${prefix}_official_source_required`);
  }
  for (const source of officialSources) {
    const archivePath = text(
      source?.provenance?.archive_path,
    );
    const expectedBytesSha256 = normaliseSha256(
      source?.bytes_sha256,
    );
    const provenanceBytesSha256 = normaliseSha256(
      source?.provenance?.bytes_sha256,
    );
    const archiveRef = text(
      source?.provenance?.archive_ref,
    ).toLowerCase();
    if (!archivePath) {
      blockers.push(`${prefix}_source_archive_path_required`);
      continue;
    }
    const absolutePath = path.resolve(archivePath);
    if (
      !allowedRoots.some((root) =>
        isContained(root, absolutePath),
      )
    ) {
      blockers.push(
        `${prefix}_source_archive_path_outside_allowed_root`,
      );
      continue;
    }
    let stat;
    try {
      stat = await fs.lstat(absolutePath);
    } catch {
      blockers.push(`${prefix}_source_archive_file_required`);
      continue;
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > MAXIMUM_JSON_BYTES
    ) {
      blockers.push(`${prefix}_source_archive_file_invalid`);
      continue;
    }
    const realPath = await fs.realpath(absolutePath);
    if (
      !allowedRoots.some((root) =>
        isContained(root, realPath),
      )
    ) {
      blockers.push(
        `${prefix}_source_archive_real_path_outside_allowed_root`,
      );
      continue;
    }
    const bytes = await fs.readFile(realPath);
    const observedBytesSha256 = sha256(bytes);
    if (
      !expectedBytesSha256 ||
      provenanceBytesSha256 !== expectedBytesSha256 ||
      archiveRef !== `sha256:${expectedBytesSha256}` ||
      observedBytesSha256 !== expectedBytesSha256
    ) {
      blockers.push(`${prefix}_source_archive_hash_mismatch`);
      continue;
    }
    const canonicalBody = extractReadableBody(
      bytes,
      text(source?.content_type),
    );
    if (
      sha256(Buffer.from(canonicalBody, "utf8")) !==
      normaliseSha256(source?.canonical_body?.sha256)
    ) {
      blockers.push(
        `${prefix}_source_archive_canonical_body_mismatch`,
      );
      continue;
    }
    if (
      array(source?.claims).some(
        (claim) =>
          !canonicalBody.includes(String(claim?.text ?? "")),
      )
    ) {
      blockers.push(
        `${prefix}_source_archive_exact_claim_missing`,
      );
    }
  }
  if (blockers.length) {
    throw new GovernedStoryIntakeInventoryBridgeError(blockers);
  }
}

function selectCompliantClaims(claims) {
  const candidates = [];
  const maximumMask = 1 << claims.length;
  for (let mask = 1; mask < maximumMask; mask += 1) {
    const selected = claims.filter((_, index) => mask & (1 << index));
    const script = selected.map((claim) => claim.text).join(" ");
    const wordCount = countSpokenWords(script);
    if (
      wordCount >= SCRIPT_MIN_WORDS &&
      wordCount <= SCRIPT_MAX_WORDS
    ) {
      candidates.push({
        selected,
        script,
        wordCount,
        distance: Math.abs(wordCount - SCRIPT_TARGET_WORDS),
        mask,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      right.selected.length - left.selected.length ||
      left.distance - right.distance ||
      left.wordCount - right.wordCount ||
      left.mask - right.mask,
  );
  const best = candidates[0];
  if (!best) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "source_bound_script_word_count_out_of_range",
    ]);
  }
  return best;
}

function sameStringArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

const SUPPORT_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "before",
  "being",
  "between",
  "could",
  "during",
  "every",
  "from",
  "have",
  "into",
  "itself",
  "only",
  "other",
  "should",
  "their",
  "there",
  "these",
  "they",
  "this",
  "until",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
]);

function supportTokens(value) {
  return (
    text(value)
      .toLowerCase()
      .match(/[a-z0-9]{4,}/g) || []
  ).filter((token) => !SUPPORT_STOP_WORDS.has(token));
}

function relatedSupportToken(left, right) {
  if (left === right) return true;
  const prefixLength = Math.min(left.length, right.length, 7);
  return (
    prefixLength >= 5 &&
    left.slice(0, prefixLength) === right.slice(0, prefixLength)
  );
}

function validateScriptClaimBindings({
  script,
  claims,
  bindings,
}) {
  const blockers = [];
  const exactBindings = array(bindings);
  const clauses = exactBindings.map((binding) =>
    text(binding?.clause),
  );
  if (
    !exactBindings.length ||
    clauses.some((clause) => !clause) ||
    clauses.join(" ") !== script
  ) {
    blockers.push("script_claim_binding_clause_partition_invalid");
  }
  const result = [];
  for (let index = 0; index < exactBindings.length; index += 1) {
    const binding = object(exactBindings[index]);
    const claimIndexes = [
      ...new Set(
        array(binding.claim_indexes).map((value) =>
          Number.isInteger(Number(value)) ? Number(value) : null,
        ),
      ),
    ];
    if (
      !claimIndexes.length ||
      claimIndexes.some(
        (claimIndex) =>
          claimIndex === null ||
          claimIndex < 0 ||
          claimIndex >= claims.length,
      )
    ) {
      blockers.push(`script_claim_binding_${index}_claims_invalid`);
      continue;
    }
    const sourceText = claimIndexes
      .map((claimIndex) => claims[claimIndex])
      .join(" ");
    const clauseTokens = supportTokens(clauses[index]);
    const sourceTokens = supportTokens(sourceText);
    const sharedTokens = unique(
      clauseTokens.filter((clauseToken) =>
        sourceTokens.some((sourceToken) =>
          relatedSupportToken(clauseToken, sourceToken),
        ),
      ),
    );
    if (sharedTokens.length < 2) {
      blockers.push(
        `script_claim_binding_${index}_source_support_too_weak`,
      );
    }
    result.push({
      clause: clauses[index],
      clause_sha256: sha256(
        Buffer.from(clauses[index], "utf8"),
      ),
      claim_indexes: claimIndexes,
      claim_sha256: claimIndexes.map((claimIndex) =>
        sha256(Buffer.from(claims[claimIndex], "utf8")),
      ),
      shared_support_tokens: sharedTokens.sort(),
    });
  }
  if (blockers.length) {
    throw new GovernedStoryIntakeInventoryBridgeError(blockers);
  }
  return result;
}

async function writeImmutableDirectory(outputDir, files) {
  const absoluteOutput = path.resolve(text(outputDir));
  if (
    !text(outputDir) ||
    absoluteOutput === path.parse(absoluteOutput).root
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "canonical_intake_output_directory_invalid",
    ]);
  }
  let existing = null;
  try {
    existing = await fs.lstat(absoluteOutput);
  } catch {
    // A missing output is the expected first materialisation state.
  }
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new GovernedStoryIntakeInventoryBridgeError([
        "canonical_intake_output_directory_conflict",
      ]);
    }
    const entries = await fs.readdir(absoluteOutput, {
      withFileTypes: true,
    });
    const expectedNames = [...files.keys()].sort();
    const observedNames = entries.map((entry) => entry.name).sort();
    if (
      entries.some(
        (entry) => !entry.isFile() || entry.isSymbolicLink(),
      ) ||
      JSON.stringify(expectedNames) !==
        JSON.stringify(observedNames)
    ) {
      throw new GovernedStoryIntakeInventoryBridgeError([
        "canonical_intake_immutable_output_conflict",
      ]);
    }
    for (const [name, expectedBytes] of files) {
      const observedBytes = await fs.readFile(
        path.join(absoluteOutput, name),
      );
      if (
        observedBytes.length !== expectedBytes.length ||
        !crypto.timingSafeEqual(observedBytes, expectedBytes)
      ) {
        throw new GovernedStoryIntakeInventoryBridgeError([
          "canonical_intake_immutable_output_conflict",
        ]);
      }
    }
    return { output_dir: absoluteOutput, reused: true };
  }
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  const stagingDir = `${absoluteOutput}.staging-${process.pid}-${crypto.randomUUID()}`;
  await fs.mkdir(stagingDir, { recursive: false });
  try {
    for (const [name, bytes] of files) {
      await fs.writeFile(path.join(stagingDir, name), bytes, {
        flag: "wx",
      });
    }
    await fs.rename(stagingDir, absoluteOutput);
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
  return { output_dir: absoluteOutput, reused: false };
}

async function materializeGovernedStoryIntakeFromInventory({
  inventoryPath,
  inventoryFileSha256,
  inventoryRoot,
  allowedRoots = [],
  experimentDimensions,
  outputDir,
} = {}) {
  if (!text(outputDir)) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "canonical_intake_output_directory_required",
    ]);
  }
  const roots = unique([
    ...array(allowedRoots).map((root) => path.resolve(text(root))),
    path.resolve(text(inventoryRoot)),
  ]);
  if (!text(inventoryRoot) || roots.some((root) => !text(root))) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "editorial_inventory_root_required",
    ]);
  }
  const inventory = await readBoundJson({
    filePath: inventoryPath,
    expectedSha256: inventoryFileSha256,
    allowedRoots: roots,
    prefix: "editorial_inventory",
  });
  const registry = inventory.value;
  if (registry.schema_version !== INVENTORY_SCHEMA) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "editorial_inventory_schema_invalid",
    ]);
  }
  const legacyStoryId = text(registry?.story?.id);
  if (!legacyStoryId) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "editorial_inventory_story_id_required",
    ]);
  }
  const hydrated =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: legacyStoryId,
          governed_editorial_inventory_path: inventory.path,
          governed_editorial_inventory_file_sha256:
            inventory.file_sha256,
          governed_editorial_inventory_canonical_sha256:
            normaliseSha256(registry.inventory_sha256),
        },
      ],
      inventoryRoot: path.resolve(inventoryRoot),
      allowedRoots: roots,
    });
  const candidate = hydrated.candidates.find(
    (item) =>
      item.lane_id === "breaking_short" &&
      item.story_id === legacyStoryId &&
      item.governed_editorial_inventory_bindings,
  );
  if (!candidate || hydrated.rejected.length) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "exact_ready_editorial_inventory_required",
      ...hydrated.rejected.flatMap((item) => item.blockers),
    ]);
  }
  const sourceReference =
    candidate.governed_editorial_inventory_bindings
      .source_evidence;
  const source = await readBoundJson({
    filePath: sourceReference.path,
    expectedSha256: sourceReference.file_sha256,
    allowedRoots: roots,
    prefix: "breaking_source_evidence",
  });
  const sourceAssessment =
    validateBreakingSourceEvidencePacket(source.value);
  const sourceBlockers = [...sourceAssessment.blockers];
  if (
    source.value.verdict !== "OFFICIAL_CONFIRMED" ||
    source.value.verification_status !== "CONFIRMED" ||
    source.value.confirmation_basis !== "official_first_party" ||
    source.value.verified_for_planning !== true
  ) {
    sourceBlockers.push(
      "breaking_source_official_confirmation_required",
    );
  }
  if (
    sourceAssessment.packet_sha256 !==
      normaliseSha256(sourceReference.canonical_sha256)
  ) {
    sourceBlockers.push(
      "breaking_source_canonical_sha256_mismatch",
    );
  }
  const sourceUrl = text(source.value.primary_source_url);
  if (
    !canonicalUrl(sourceUrl) ||
    sourceUrl !== text(registry?.story?.primary_source_url)
  ) {
    sourceBlockers.push("official_source_url_binding_mismatch");
  }
  if (sourceBlockers.length) {
    throw new GovernedStoryIntakeInventoryBridgeError(
      sourceBlockers,
    );
  }

  const officialClaims = exactOfficialClaims(source.value);
  const publicationSourceReference =
    candidate.governed_editorial_inventory_bindings
      .publication_source_evidence;
  const publicationSource = await readBoundJson({
    filePath: publicationSourceReference.path,
    expectedSha256: publicationSourceReference.file_sha256,
    allowedRoots: roots,
    prefix: "publication_source_evidence",
  });
  const officialSourceSnapshot =
    publicationSource.value.official_source_snapshot;
  const snapshotClaims = array(officialSourceSnapshot?.claims)
    .map((claim) => ({
      claim_key: text(claim?.claim_key),
      text: String(claim?.text ?? ""),
      claim_text_sha256: normaliseSha256(
        claim?.claim_text_sha256,
      ),
    }))
    .sort(
      (left, right) =>
        left.claim_key.localeCompare(right.claim_key) ||
        left.claim_text_sha256.localeCompare(
          right.claim_text_sha256,
        ),
    );
  const exactOfficialClaimProjection = officialClaims
    .map(({ claim_key, text: claimText, claim_text_sha256 }) => ({
      claim_key,
      text: claimText,
      claim_text_sha256,
    }))
    .sort(
      (left, right) =>
        left.claim_key.localeCompare(right.claim_key) ||
        left.claim_text_sha256.localeCompare(
          right.claim_text_sha256,
        ),
    );
  if (
    text(publicationSource.value.story_id) !== legacyStoryId ||
    text(publicationSource.value.source_url) !== sourceUrl ||
    officialSourceSnapshot?.schema_version !==
      "pulse-official-source-snapshot-v1" ||
    text(officialSourceSnapshot.source_url) !== sourceUrl ||
    JSON.stringify(snapshotClaims) !==
      JSON.stringify(exactOfficialClaimProjection)
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "publication_source_evidence_snapshot_mismatch",
    ]);
  }
  const selection = selectCompliantClaims(officialClaims);
  const selectedClaimTexts = selection.selected.map(
    (claim) => claim.text,
  );
  const officialClaimTexts = officialClaims.map(
    (claim) => claim.text,
  );
  const canonicalStoryId = `official_${canonicalHash(sourceUrl)}`;
  const publishedAt = text(registry?.story?.published_at);
  const generatedAt =
    text(registry.generated_at) || publishedAt;
  const canonicalEvidence = {
    schema_version: SOURCE_EVIDENCE_SCHEMA,
    story_id: canonicalStoryId,
    source_url: sourceUrl,
    source_type: "official",
    published_at: publishedAt,
    claims: officialClaimTexts,
    official_source_snapshot: structuredClone(
      officialSourceSnapshot,
    ),
    lineage: {
      legacy_story_id: legacyStoryId,
      breaking_source_evidence: {
        path: source.path,
        file_sha256: source.file_sha256,
        canonical_sha256: sourceAssessment.packet_sha256,
      },
      governed_editorial_inventory: {
        path: inventory.path,
        file_sha256: inventory.file_sha256,
        canonical_sha256: normaliseSha256(
          registry.inventory_sha256,
        ),
      },
      selected_claims: selection.selected.map((claim) => ({
        claim_key: claim.claim_key,
        claim_sha256: claim.claim_sha256,
        claim_text_sha256: claim.claim_text_sha256,
      })),
    },
    safety: {
      exact_official_claim_text_only: true,
      claims_synthesised: false,
      publication_authority: false,
    },
  };
  const sourceEvidenceBytes = jsonBytes(canonicalEvidence);
  const sourceEvidenceSha256 = sha256(sourceEvidenceBytes);
  const script = selection.script;
  const manifest = {
    schema_version: INTAKE_SCHEMA,
    source_url: sourceUrl,
    source_type: "official",
    source_evidence_path: OUTPUT_FILENAMES.sourceEvidence,
    source_evidence_sha256: sourceEvidenceSha256,
    published_at: publishedAt,
    claims: officialClaimTexts,
    ...(experimentDimensions !== undefined
      ? {
          experiment_dimensions:
            structuredClone(experimentDimensions),
        }
      : {}),
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
    },
    story: {
      id: canonicalStoryId,
      title: text(registry?.story?.title),
      hook: selectedClaimTexts[0],
      full_script: script,
      script_sha256: sha256(Buffer.from(script, "utf8")),
      legacy_story_id: legacyStoryId,
    },
    safety: {
      exact_official_claim_text_only: true,
      claims_synthesised: false,
      generic_owned_cards_promoted_to_publishable: false,
      publication_quality_approved: false,
      human_review_required: true,
      publish_authority: false,
    },
  };
  const manifestBytes = jsonBytes(manifest);
  const absoluteOutputDir = path.resolve(text(outputDir));
  const stagingValidationRoot = `${absoluteOutputDir}.validation-${process.pid}-${crypto.randomUUID()}`;
  await fs.mkdir(stagingValidationRoot, { recursive: false });
  try {
    await fs.writeFile(
      path.join(
        stagingValidationRoot,
        OUTPUT_FILENAMES.sourceEvidence,
      ),
      sourceEvidenceBytes,
      { flag: "wx" },
    );
    const stagingManifestPath = path.join(
      stagingValidationRoot,
      OUTPUT_FILENAMES.storyIntake,
    );
    await fs.writeFile(stagingManifestPath, manifestBytes, {
      flag: "wx",
    });
    validateStoryIntakeManifest({
      manifestPath: stagingManifestPath,
    });
  } finally {
    await fs.rm(stagingValidationRoot, {
      recursive: true,
      force: true,
    });
  }

  const finalPaths = {
    source_evidence: path.join(
      absoluteOutputDir,
      OUTPUT_FILENAMES.sourceEvidence,
    ),
    story_intake: path.join(
      absoluteOutputDir,
      OUTPUT_FILENAMES.storyIntake,
    ),
    proof: path.join(
      absoluteOutputDir,
      OUTPUT_FILENAMES.proof,
    ),
    summary: path.join(
      absoluteOutputDir,
      OUTPUT_FILENAMES.summary,
    ),
  };
  const proofBase = {
    schema_version: PROOF_SCHEMA,
    generated_at: generatedAt,
    verdict: "VALID",
    publish_verdict: "HOLD",
    legacy_story_id: legacyStoryId,
    story_id: canonicalStoryId,
    stages: {
      exact_ready_inventory_binding: "PASS",
      official_claim_projection: "PASS",
      canonical_source_evidence: "PASS",
      canonical_validator: "PASS",
      publication_quality: "HOLD",
    },
    script: {
      word_count: selection.wordCount,
      minimum_words: SCRIPT_MIN_WORDS,
      maximum_words: SCRIPT_MAX_WORDS,
      exact_claim_concatenation: true,
      selected_claim_count: selection.selected.length,
    },
    artifacts: {
      source_evidence: {
        path: finalPaths.source_evidence,
        file_sha256: sourceEvidenceSha256,
      },
      story_intake: {
        path: finalPaths.story_intake,
        file_sha256: sha256(manifestBytes),
      },
    },
    quality: {
      publishable: false,
      generic_owned_cards_promoted_to_publishable: false,
      human_review_required: true,
      blockers: [
        "exact_subject_media_and_human_quality_review_required",
      ],
    },
    safety: {
      local_proof_only: true,
      database_mutated: false,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
      external_posting_authorised: false,
    },
  };
  const proof = {
    ...proofBase,
    proof_sha256: canonicalSha256(proofBase),
  };
  const summaryBytes = Buffer.from(
    renderProofMarkdown(proof),
    "utf8",
  );
  const materialized = await writeImmutableDirectory(
    absoluteOutputDir,
    new Map([
      [OUTPUT_FILENAMES.sourceEvidence, sourceEvidenceBytes],
      [OUTPUT_FILENAMES.storyIntake, manifestBytes],
      [OUTPUT_FILENAMES.proof, jsonBytes(proof)],
      [OUTPUT_FILENAMES.summary, summaryBytes],
    ]),
  );
  const validation = validateStoryIntakeManifest({
    manifestPath: finalPaths.story_intake,
  });
  return {
    verdict: "VALID",
    publish_verdict: "HOLD",
    story_id: validation.storyId,
    legacy_story_id: legacyStoryId,
    reused: materialized.reused,
    word_count: validation.wordCount,
    paths: finalPaths,
    proof,
    publish_authority_created: false,
    database_mutated: false,
    oauth_mutated: false,
    platform_contacted: false,
  };
}

async function materializeGovernedLockedStoryIntakeFromInventory({
  inventoryPath,
  inventoryFileSha256,
  inventoryRoot,
  allowedRoots = [],
  canonicalIdentityUrl,
  finalScript,
  finalScriptSha256,
  scriptClaimBindings,
  presentationClaimBindings = [],
  supplementalOfficialSources = [],
  contract,
  freshness,
  visualBrief,
  experimentDimensions,
  outputDir,
} = {}) {
  if (!text(outputDir)) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "canonical_intake_output_directory_required",
    ]);
  }
  const roots = unique([
    ...array(allowedRoots).map((root) => path.resolve(text(root))),
    path.resolve(text(inventoryRoot)),
  ]);
  if (!text(inventoryRoot) || roots.some((root) => !text(root))) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "editorial_inventory_root_required",
    ]);
  }
  const inventory = await readBoundJson({
    filePath: inventoryPath,
    expectedSha256: inventoryFileSha256,
    allowedRoots: roots,
    prefix: "editorial_inventory",
  });
  const registry = inventory.value;
  if (registry.schema_version !== INVENTORY_SCHEMA) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "editorial_inventory_schema_invalid",
    ]);
  }
  const storyId = text(registry?.story?.id);
  const exactIdentityUrl = text(canonicalIdentityUrl);
  let parsedIdentityUrl = null;
  try {
    parsedIdentityUrl = new URL(exactIdentityUrl);
  } catch {
    // The blocker below owns the public failure contract.
  }
  if (
    !storyId ||
    !canonicalUrl(exactIdentityUrl) ||
    parsedIdentityUrl?.protocol !== "https:" ||
    parsedIdentityUrl?.username ||
    parsedIdentityUrl?.password ||
    `official_${canonicalHash(exactIdentityUrl)}` !== storyId
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "canonical_story_identity_binding_invalid",
    ]);
  }
  const hydrated =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: storyId,
          governed_editorial_inventory_path: inventory.path,
          governed_editorial_inventory_file_sha256:
            inventory.file_sha256,
          governed_editorial_inventory_canonical_sha256:
            normaliseSha256(registry.inventory_sha256),
        },
      ],
      inventoryRoot: path.resolve(inventoryRoot),
      allowedRoots: roots,
    });
  const candidate = hydrated.candidates.find(
    (item) =>
      item.lane_id === "breaking_short" &&
      item.story_id === storyId &&
      item.governed_editorial_inventory_bindings,
  );
  if (!candidate || hydrated.rejected.length) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "exact_ready_editorial_inventory_required",
      ...hydrated.rejected.flatMap((item) => item.blockers),
    ]);
  }
  const sourceReference =
    candidate.governed_editorial_inventory_bindings
      .source_evidence;
  const primaryPacket = await readBoundJson({
    filePath: sourceReference.path,
    expectedSha256: sourceReference.file_sha256,
    allowedRoots: roots,
    prefix: "breaking_source_evidence",
  });
  const primaryAssessment =
    validateBreakingSourceEvidencePacket(primaryPacket.value);
  const primarySourceUrl = text(
    primaryPacket.value.primary_source_url,
  );
  const primaryBlockers = [...primaryAssessment.blockers];
  if (
    text(primaryPacket.value.story_id) !== storyId ||
    primaryPacket.value.verdict !== "OFFICIAL_CONFIRMED" ||
    primaryPacket.value.verification_status !== "CONFIRMED" ||
    primaryPacket.value.confirmation_basis !==
      "official_first_party" ||
    primaryPacket.value.verified_for_planning !== true
  ) {
    primaryBlockers.push(
      "breaking_source_official_confirmation_required",
    );
  }
  if (
    primaryAssessment.packet_sha256 !==
    normaliseSha256(sourceReference.canonical_sha256)
  ) {
    primaryBlockers.push(
      "breaking_source_canonical_sha256_mismatch",
    );
  }
  if (
    !canonicalUrl(primarySourceUrl) ||
    primarySourceUrl !==
      text(registry?.story?.primary_source_url)
  ) {
    primaryBlockers.push("official_source_url_binding_mismatch");
  }
  if (primaryBlockers.length) {
    throw new GovernedStoryIntakeInventoryBridgeError(
      primaryBlockers,
    );
  }
  await verifyOfficialPacketSourceArchives({
    packet: primaryPacket.value,
    allowedRoots: roots,
    prefix: "breaking_source_evidence",
  });

  const publicationSourceReference =
    candidate.governed_editorial_inventory_bindings
      .publication_source_evidence;
  const publicationSource = await readBoundJson({
    filePath: publicationSourceReference.path,
    expectedSha256: publicationSourceReference.file_sha256,
    allowedRoots: roots,
    prefix: "publication_source_evidence",
  });
  const rawPrimaryClaims = exactOfficialClaims(
    primaryPacket.value,
  );
  const rawPrimaryProjection = rawPrimaryClaims
    .map(({ claim_key, text: claimText, claim_text_sha256 }) => ({
      claim_key,
      text: claimText,
      claim_text_sha256,
    }))
    .sort(
      (left, right) =>
        left.claim_key.localeCompare(right.claim_key) ||
        left.claim_text_sha256.localeCompare(
          right.claim_text_sha256,
        ),
    );
  const inventorySnapshot =
    publicationSource.value.official_source_snapshot;
  const inventoryProjection = array(inventorySnapshot?.claims)
    .map((claim) => ({
      claim_key: text(claim?.claim_key),
      text: String(claim?.text ?? ""),
      claim_text_sha256: normaliseSha256(
        claim?.claim_text_sha256,
      ),
    }))
    .sort(
      (left, right) =>
        left.claim_key.localeCompare(right.claim_key) ||
        left.claim_text_sha256.localeCompare(
          right.claim_text_sha256,
        ),
    );
  if (
    text(publicationSource.value.story_id) !== storyId ||
    text(publicationSource.value.source_url) !== primarySourceUrl ||
    inventorySnapshot?.schema_version !==
      "pulse-official-source-snapshot-v1" ||
    text(inventorySnapshot.source_url) !== primarySourceUrl ||
    JSON.stringify(inventoryProjection) !==
      JSON.stringify(rawPrimaryProjection)
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "publication_source_evidence_snapshot_mismatch",
    ]);
  }

  const packetRecords = [
    {
      packet: primaryPacket,
      assessment: primaryAssessment,
      declared_canonical_sha256:
        normaliseSha256(sourceReference.canonical_sha256),
    },
  ];
  for (
    let index = 0;
    index < array(supplementalOfficialSources).length;
    index += 1
  ) {
    const reference = object(
      supplementalOfficialSources[index],
    );
    const packet = await readBoundJson({
      filePath: reference.path,
      expectedSha256: reference.file_sha256,
      allowedRoots: roots,
      prefix: `supplemental_official_source_${index}`,
    });
    const assessment =
      validateBreakingSourceEvidencePacket(packet.value);
    const declaredCanonicalSha256 = normaliseSha256(
      reference.canonical_sha256,
    );
    const blockers = [...assessment.blockers];
    if (
      text(packet.value.story_id) !== storyId ||
      packet.value.verdict !== "OFFICIAL_CONFIRMED" ||
      packet.value.verification_status !== "CONFIRMED" ||
      packet.value.confirmation_basis !== "official_first_party" ||
      packet.value.verified_for_planning !== true
    ) {
      blockers.push(
        `supplemental_official_source_${index}_confirmation_required`,
      );
    }
    if (
      !declaredCanonicalSha256 ||
      declaredCanonicalSha256 !== assessment.packet_sha256
    ) {
      blockers.push(
        `supplemental_official_source_${index}_canonical_sha256_mismatch`,
      );
    }
    if (blockers.length) {
      throw new GovernedStoryIntakeInventoryBridgeError(blockers);
    }
    await verifyOfficialPacketSourceArchives({
      packet: packet.value,
      allowedRoots: roots,
      prefix: `supplemental_official_source_${index}`,
    });
    packetRecords.push({
      packet,
      assessment,
      declared_canonical_sha256: declaredCanonicalSha256,
    });
  }

  const sourceClaimInventory = packetRecords
    .flatMap(({ packet }) =>
      exactOfficialClaimInventory(packet.value),
    )
    .sort(
      (left, right) =>
        left.claim_key.localeCompare(right.claim_key) ||
        left.source_url.localeCompare(right.source_url),
    );
  const claimKeys = sourceClaimInventory.map(
    (claim) => claim.claim_key,
  );
  if (
    new Set(claimKeys).size !== claimKeys.length ||
    sourceClaimInventory.length > MAXIMUM_CLAIMS
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "official_claim_key_inventory_ambiguous",
    ]);
  }
  const primarySnapshot = officialSnapshotForSource(
    primarySourceUrl,
    sourceClaimInventory,
  );
  const supportingSourceUrls = unique(
    sourceClaimInventory
      .map((claim) => claim.source_url)
      .filter((sourceUrl) => sourceUrl !== primarySourceUrl),
  ).sort();
  const supportingSnapshots = supportingSourceUrls.map(
    (sourceUrl) =>
      officialSnapshotForSource(
        sourceUrl,
        sourceClaimInventory,
      ),
  );

  const script = text(finalScript).replace(/\s+/g, " ");
  const declaredScriptSha256 = normaliseSha256(
    finalScriptSha256,
  );
  const observedScriptSha256 = sha256(
    Buffer.from(script, "utf8"),
  );
  if (
    !script ||
    script !== String(finalScript ?? "").trim() ||
    !declaredScriptSha256 ||
    declaredScriptSha256 !== observedScriptSha256
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "final_script_hash_binding_invalid",
    ]);
  }
  const exactBindings = validateKeyedScriptClaimBindings({
    script,
    claims: sourceClaimInventory,
    bindings: scriptClaimBindings,
  });
  const exactPresentationBindings =
    validatePresentationClaimBindings({
      claims: sourceClaimInventory,
      bindings: presentationClaimBindings,
    });
  const exactVisualBrief = object(visualBrief);
  if (
    text(exactVisualBrief.format) !== "owned-motion-only" ||
    text(exactVisualBrief.source_media_policy) !== "OWNED_ONLY" ||
    (exactVisualBrief.palette !== undefined &&
      (!Array.isArray(exactVisualBrief.palette) ||
        exactVisualBrief.palette.some(
          (colour) =>
            typeof colour !== "string" ||
            !/^#[a-f0-9]{6}$/i.test(colour),
        )))
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "locked_story_visual_brief_invalid",
    ]);
  }
  const primaryClaimTexts = primarySnapshot.claims.map(
    (claim) => claim.text,
  );
  const publishedAt = text(registry?.story?.published_at);
  const generatedAt =
    text(registry.generated_at) || publishedAt;
  const canonicalEvidence = {
    schema_version: SOURCE_EVIDENCE_SCHEMA,
    story_id: storyId,
    canonical_identity_url: exactIdentityUrl,
    source_url: primarySourceUrl,
    source_type: "official",
    published_at: publishedAt,
    claims: primaryClaimTexts,
    official_source_snapshot: primarySnapshot,
    supporting_official_source_snapshots:
      supportingSnapshots,
    source_claim_inventory: sourceClaimInventory,
    script_claim_bindings: exactBindings,
    presentation_claim_bindings:
      exactPresentationBindings,
    lineage: {
      governed_editorial_inventory: {
        path: inventory.path,
        file_sha256: inventory.file_sha256,
        canonical_sha256: normaliseSha256(
          registry.inventory_sha256,
        ),
      },
      official_source_packets: packetRecords.map(
        ({ packet, assessment, declared_canonical_sha256 }) => ({
          path: packet.path,
          file_sha256: packet.file_sha256,
          canonical_sha256:
            declared_canonical_sha256 ||
            assessment.packet_sha256,
        }),
      ),
    },
    safety: {
      exact_official_source_claims_only: true,
      deterministic_visible_text_transform_only: true,
      claims_synthesised: false,
      script_is_hash_bound_reviewed_paraphrase: true,
      publication_authority: false,
    },
  };
  const sourceEvidenceBytes = jsonBytes(canonicalEvidence);
  const sourceEvidenceSha256 = sha256(sourceEvidenceBytes);
  const releaseBinding = buildOfficialSourceReleaseBinding({
    storyId,
    sourceEvidenceSha256,
    sourceEvidence: canonicalEvidence,
  });
  const manifest = {
    schema_version: INTAKE_SCHEMA,
    canonical_identity_url: exactIdentityUrl,
    source_url: primarySourceUrl,
    source_type: "official",
    source_evidence_path: OUTPUT_FILENAMES.sourceEvidence,
    source_evidence_sha256: sourceEvidenceSha256,
    published_at: publishedAt,
    claims: primaryClaimTexts,
    freshness: structuredClone(object(freshness)),
    ...(experimentDimensions !== undefined
      ? {
          experiment_dimensions:
            structuredClone(experimentDimensions),
        }
      : {}),
    contract: structuredClone(object(contract)),
    story: {
      id: storyId,
      channel_id: "pulse-gaming",
      canonical_identity_url: exactIdentityUrl,
      title: text(registry?.story?.title),
      hook: script.split(/(?<=[.!?])\s+/)[0],
      full_script: script,
      script_sha256: observedScriptSha256,
      word_count: countSpokenWords(script),
      visual_brief: structuredClone(exactVisualBrief),
    },
    safety: {
      exact_official_source_claims_only: true,
      deterministic_visible_text_transform_only: true,
      claims_synthesised: false,
      script_claim_bindings_sha256:
        canonicalSha256(exactBindings),
      publication_quality_approved: false,
      publish_authority: false,
    },
  };
  const manifestBytes = jsonBytes(manifest);
  const absoluteOutputDir = path.resolve(text(outputDir));
  const stagingValidationRoot = `${absoluteOutputDir}.validation-${process.pid}-${crypto.randomUUID()}`;
  await fs.mkdir(stagingValidationRoot, { recursive: false });
  try {
    await fs.writeFile(
      path.join(
        stagingValidationRoot,
        OUTPUT_FILENAMES.sourceEvidence,
      ),
      sourceEvidenceBytes,
      { flag: "wx" },
    );
    const stagingManifestPath = path.join(
      stagingValidationRoot,
      OUTPUT_FILENAMES.storyIntake,
    );
    await fs.writeFile(stagingManifestPath, manifestBytes, {
      flag: "wx",
    });
    validateStoryIntakeManifest({
      manifestPath: stagingManifestPath,
    });
  } finally {
    await fs.rm(stagingValidationRoot, {
      recursive: true,
      force: true,
    });
  }

  const finalPaths = {
    source_evidence: path.join(
      absoluteOutputDir,
      OUTPUT_FILENAMES.sourceEvidence,
    ),
    story_intake: path.join(
      absoluteOutputDir,
      OUTPUT_FILENAMES.storyIntake,
    ),
    proof: path.join(
      absoluteOutputDir,
      OUTPUT_FILENAMES.proof,
    ),
    summary: path.join(
      absoluteOutputDir,
      OUTPUT_FILENAMES.summary,
    ),
  };
  const proofBase = {
    schema_version: PROOF_SCHEMA,
    generated_at: generatedAt,
    verdict: "VALID",
    publish_verdict: "HOLD",
    adapter_input:
      "READY_INVENTORY_AND_LOCKED_OFFICIAL_SCRIPT",
    legacy_story_id: storyId,
    story_id: storyId,
    stages: {
      exact_ready_inventory_binding: "PASS",
      canonical_identity_binding: "PASS",
      official_claim_projection: "PASS",
      deterministic_visible_text_transform: "PASS",
      script_claim_binding: "PASS",
      presentation_claim_binding: "PASS",
      owned_only_visual_policy: "PASS",
      canonical_source_evidence: "PASS",
      official_source_release_binding: "PASS",
      canonical_validator: "PASS",
      publication_quality: "HOLD",
    },
    script: {
      sha256: observedScriptSha256,
      word_count: countSpokenWords(script),
      claim_binding_sha256:
        canonicalSha256(exactBindings),
      claim_binding_count: exactBindings.length,
      presentation_claim_binding_sha256:
        canonicalSha256(exactPresentationBindings),
      presentation_claim_binding_count:
        exactPresentationBindings.length,
    },
    official_sources: {
      count: 1 + supportingSnapshots.length,
      primary_url: primarySourceUrl,
      supporting_urls: supportingSourceUrls,
      release_binding_sha256:
        releaseBinding.binding_sha256,
    },
    artifacts: {
      source_evidence: {
        path: finalPaths.source_evidence,
        file_sha256: sourceEvidenceSha256,
      },
      story_intake: {
        path: finalPaths.story_intake,
        file_sha256: sha256(manifestBytes),
      },
    },
    quality: {
      publishable: false,
      human_review_required: false,
      blockers: [
        "publication_quality_and_admission_evidence_required",
      ],
    },
    safety: {
      local_proof_only: true,
      database_mutated: false,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
      external_posting_authorised: false,
    },
  };
  const proof = {
    ...proofBase,
    proof_sha256: canonicalSha256(proofBase),
  };
  const summaryBytes = Buffer.from(
    renderProofMarkdown(proof),
    "utf8",
  );
  const materialized = await writeImmutableDirectory(
    absoluteOutputDir,
    new Map([
      [OUTPUT_FILENAMES.sourceEvidence, sourceEvidenceBytes],
      [OUTPUT_FILENAMES.storyIntake, manifestBytes],
      [OUTPUT_FILENAMES.proof, jsonBytes(proof)],
      [OUTPUT_FILENAMES.summary, summaryBytes],
    ]),
  );
  const validation = validateStoryIntakeManifest({
    manifestPath: finalPaths.story_intake,
  });
  return {
    verdict: "VALID",
    publish_verdict: "HOLD",
    story_id: validation.storyId,
    legacy_story_id: storyId,
    reused: materialized.reused,
    word_count: validation.wordCount,
    paths: finalPaths,
    proof,
    official_source_release_binding: releaseBinding,
    publish_authority_created: false,
    database_mutated: false,
    oauth_mutated: false,
    platform_contacted: false,
  };
}

async function materializeGovernedStoryIntakeFromLegacyPackage({
  seedPath,
  seedFileSha256,
  canonicalStoryManifestPath,
  canonicalStoryManifestFileSha256,
  sourceManifestPath,
  sourceManifestFileSha256,
  allowedRoots = [],
  finalScript,
  finalScriptSha256,
  scriptClaimBindings,
  outputDir,
} = {}) {
  const roots = unique(
    array(allowedRoots)
      .map((root) => text(root))
      .filter(Boolean)
      .map((root) => path.resolve(root)),
  );
  if (!roots.length) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "legacy_package_allowed_root_required",
    ]);
  }
  const [seed, canonical, source] = await Promise.all([
    readBoundJson({
      filePath: seedPath,
      expectedSha256: seedFileSha256,
      allowedRoots: roots,
      prefix: "legacy_seed",
    }),
    readBoundJson({
      filePath: canonicalStoryManifestPath,
      expectedSha256: canonicalStoryManifestFileSha256,
      allowedRoots: roots,
      prefix: "legacy_canonical_story_manifest",
    }),
    readBoundJson({
      filePath: sourceManifestPath,
      expectedSha256: sourceManifestFileSha256,
      allowedRoots: roots,
      prefix: "legacy_source_manifest",
    }),
  ]);
  const blockers = [];
  const stories = array(seed.value.stories);
  if (stories.length !== 1) {
    blockers.push("legacy_seed_exactly_one_story_required");
  }
  const story = object(stories[0]);
  const legacyStoryId = text(story.id);
  if (!legacyStoryId) {
    blockers.push("legacy_story_id_required");
  }
  if (
    text(canonical.value.story_id) !== legacyStoryId ||
    text(source.value.story_id) !== legacyStoryId
  ) {
    blockers.push("legacy_story_identity_mismatch");
  }
  if (
    source.value.schema_version !== 1 ||
    text(canonical.value.publish_status).toUpperCase() !== "DRAFT"
  ) {
    blockers.push("legacy_draft_package_contract_invalid");
  }
  const sourceUrl = text(
    story.primary_source_url || story.article_url || story.url,
  );
  if (
    !canonicalUrl(sourceUrl) ||
    text(canonical.value.primary_source_url) !== sourceUrl ||
    text(source.value?.primary_source?.url) !== sourceUrl ||
    text(source.value?.source_evidence?.source_url) !== sourceUrl
  ) {
    blockers.push("legacy_official_source_url_mismatch");
  }
  const publishedAt = text(
    story.source_published_at || story.published_at || story.timestamp,
  );
  if (
    !Number.isFinite(Date.parse(publishedAt)) ||
    text(canonical.value.source_published_at) !== publishedAt ||
    text(source.value?.primary_source?.published_at) !== publishedAt
  ) {
    blockers.push("legacy_source_published_at_mismatch");
  }
  if (
    text(story?.source_evidence?.status).toLowerCase() !==
      "verified" ||
    text(source.value?.source_evidence?.status).toLowerCase() !==
      "verified" ||
    text(source.value.freshness_gate).toLowerCase() !== "pass" ||
    text(source.value.coherence_gate).toLowerCase() !== "pass" ||
    !Array.isArray(source.value.blockers) ||
    source.value.blockers.length
  ) {
    blockers.push("legacy_source_evidence_not_verified");
  }
  if (
    JSON.stringify(story.source_evidence) !==
    JSON.stringify(source.value.source_evidence)
  ) {
    blockers.push("legacy_source_evidence_manifest_mismatch");
  }
  if (
    !text(story?.source_evidence?.source_owner) ||
    !text(source.value?.source_evidence?.source_owner)
  ) {
    blockers.push("legacy_official_source_owner_required");
  }
  const confirmedClaims = array(story.confirmed_claims);
  if (
    !confirmedClaims.length ||
    confirmedClaims.some((claim) => !text(claim)) ||
    !sameStringArray(
      confirmedClaims,
      story?.claim_inventory?.confirmed,
    ) ||
    !sameStringArray(
      confirmedClaims,
      canonical.value.confirmed_claims,
    ) ||
    !sameStringArray(
      confirmedClaims,
      canonical.value?.claim_inventory?.confirmed,
    )
  ) {
    blockers.push("legacy_confirmed_claim_inventory_mismatch");
  }
  if (
    array(story?.claim_inventory?.unconfirmed).length ||
    array(story?.claim_inventory?.prohibited).length ||
    array(canonical.value?.claim_inventory?.unconfirmed).length ||
    array(canonical.value?.claim_inventory?.prohibited).length
  ) {
    blockers.push("legacy_unconfirmed_or_prohibited_claims_present");
  }
  const sourceEvidenceClaims = array(
    source.value?.source_evidence?.claims,
  );
  if (
    !sourceEvidenceClaims.length ||
    sourceEvidenceClaims.some(
      (claim) =>
        text(claim?.status).toLowerCase() !== "confirmed" ||
        !text(claim?.claim) ||
        !text(claim?.source_section),
    )
  ) {
    blockers.push("legacy_source_evidence_claims_invalid");
  }
  const script = text(finalScript).replace(/\s+/g, " ");
  const declaredScriptSha256 = normaliseSha256(
    finalScriptSha256,
  );
  const observedScriptSha256 = sha256(
    Buffer.from(script, "utf8"),
  );
  const wordCount = countSpokenWords(script);
  if (
    !script ||
    script !== String(finalScript ?? "").trim() ||
    !declaredScriptSha256 ||
    declaredScriptSha256 !== observedScriptSha256
  ) {
    blockers.push("final_script_hash_binding_invalid");
  }
  if (
    wordCount < SCRIPT_MIN_WORDS ||
    wordCount > SCRIPT_MAX_WORDS
  ) {
    blockers.push("script_word_count_out_of_range");
  }
  if (blockers.length) {
    throw new GovernedStoryIntakeInventoryBridgeError(blockers);
  }
  const exactBindings = validateScriptClaimBindings({
    script,
    claims: confirmedClaims,
    bindings: scriptClaimBindings,
  });
  const outputPath = path.resolve(text(outputDir));
  const inputDirectories = unique(
    [seed.path, canonical.path, source.path].map((filePath) =>
      path.dirname(filePath),
    ),
  );
  if (
    !text(outputDir) ||
    inputDirectories.some((directory) =>
      isContained(directory, outputPath),
    )
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "canonical_output_must_not_mutate_legacy_package",
    ]);
  }

  const canonicalStoryId = `official_${canonicalHash(sourceUrl)}`;
  const supportingSources = [
    {
      source_class: "OFFICIAL_PRIMARY",
      name: text(source.value?.primary_source?.name),
      url: sourceUrl,
      owner: text(source.value?.source_evidence?.source_owner),
    },
    ...array(story.secondary_sources).map((item) => ({
      source_class: "EDITORIAL_CORROBORATION",
      name: text(item?.name),
      url: text(item?.url),
      purpose: text(item?.purpose),
    })),
  ];
  if (
    supportingSources.some(
      (item) =>
        !item.name ||
        !canonicalUrl(item.url) ||
        !item.source_class,
    )
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "legacy_supporting_source_invalid",
    ]);
  }
  const canonicalEvidence = {
    schema_version: SOURCE_EVIDENCE_SCHEMA,
    source_url: sourceUrl,
    source_type: "official",
    published_at: publishedAt,
    claims: [...confirmedClaims],
    supporting_sources: supportingSources,
    source_claim_details: sourceEvidenceClaims.map((claim) => ({
      claim: text(claim.claim),
      status: "confirmed",
      source_section: text(claim.source_section),
    })),
    script_claim_bindings: exactBindings,
    lineage: {
      legacy_story_id: legacyStoryId,
      seed: {
        path: seed.path,
        file_sha256: seed.file_sha256,
      },
      canonical_story_manifest: {
        path: canonical.path,
        file_sha256: canonical.file_sha256,
      },
      source_manifest: {
        path: source.path,
        file_sha256: source.file_sha256,
      },
    },
    safety: {
      legacy_claims_retained_verbatim: true,
      claims_synthesised: false,
      script_is_hash_bound_reviewed_paraphrase: true,
      publication_authority: false,
    },
  };
  const sourceEvidenceBytes = jsonBytes(canonicalEvidence);
  const sourceEvidenceSha256 = sha256(sourceEvidenceBytes);
  const manifest = {
    schema_version: INTAKE_SCHEMA,
    source_url: sourceUrl,
    source_type: "official",
    source_evidence_path: OUTPUT_FILENAMES.sourceEvidence,
    source_evidence_sha256: sourceEvidenceSha256,
    published_at: publishedAt,
    claims: [...confirmedClaims],
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
    },
    story: {
      id: canonicalStoryId,
      title: text(canonical.value.title || story.title),
      hook: script.split(/(?<=[.!?])\s+/)[0],
      full_script: script,
      script_sha256: observedScriptSha256,
      legacy_story_id: legacyStoryId,
    },
    safety: {
      legacy_claims_retained_verbatim: true,
      claims_synthesised: false,
      script_claim_bindings_sha256:
        canonicalSha256(exactBindings),
      generic_owned_cards_promoted_to_publishable: false,
      publication_quality_approved: false,
      human_review_required: true,
      publish_authority: false,
    },
  };
  const manifestBytes = jsonBytes(manifest);
  const finalPaths = {
    source_evidence: path.join(
      outputPath,
      OUTPUT_FILENAMES.sourceEvidence,
    ),
    story_intake: path.join(
      outputPath,
      OUTPUT_FILENAMES.storyIntake,
    ),
    proof: path.join(outputPath, OUTPUT_FILENAMES.proof),
    summary: path.join(outputPath, OUTPUT_FILENAMES.summary),
  };
  const validationRoot = `${outputPath}.validation-${process.pid}-${crypto.randomUUID()}`;
  await fs.mkdir(validationRoot, { recursive: false });
  try {
    await fs.writeFile(
      path.join(validationRoot, OUTPUT_FILENAMES.sourceEvidence),
      sourceEvidenceBytes,
      { flag: "wx" },
    );
    const validationManifestPath = path.join(
      validationRoot,
      OUTPUT_FILENAMES.storyIntake,
    );
    await fs.writeFile(validationManifestPath, manifestBytes, {
      flag: "wx",
    });
    validateStoryIntakeManifest({
      manifestPath: validationManifestPath,
    });
  } finally {
    await fs.rm(validationRoot, {
      recursive: true,
      force: true,
    });
  }
  const inputHashesAfter = await Promise.all(
    [seed.path, canonical.path, source.path].map(async (filePath) =>
      sha256(await fs.readFile(filePath)),
    ),
  );
  if (
    inputHashesAfter[0] !== seed.file_sha256 ||
    inputHashesAfter[1] !== canonical.file_sha256 ||
    inputHashesAfter[2] !== source.file_sha256
  ) {
    throw new GovernedStoryIntakeInventoryBridgeError([
      "legacy_input_changed_during_bridge",
    ]);
  }
  const generatedAt =
    text(source.value.generated_at) || publishedAt;
  const proofBase = {
    schema_version: PROOF_SCHEMA,
    generated_at: generatedAt,
    verdict: "VALID",
    publish_verdict: "HOLD",
    adapter_input: "LEGACY_SEED_AND_PROOF_PACKAGE",
    legacy_story_id: legacyStoryId,
    story_id: canonicalStoryId,
    stages: {
      legacy_hash_bindings: "PASS",
      legacy_identity_reconciliation: "PASS",
      legacy_source_evidence: "PASS",
      script_claim_binding: "PASS",
      canonical_source_evidence: "PASS",
      canonical_validator: "PASS",
      legacy_inputs_unchanged: "PASS",
      publication_quality: "HOLD",
    },
    script: {
      sha256: observedScriptSha256,
      word_count: wordCount,
      minimum_words: SCRIPT_MIN_WORDS,
      maximum_words: SCRIPT_MAX_WORDS,
      claim_binding_sha256: canonicalSha256(exactBindings),
      claim_binding_count: exactBindings.length,
    },
    inputs: {
      seed: {
        path: seed.path,
        file_sha256: seed.file_sha256,
      },
      canonical_story_manifest: {
        path: canonical.path,
        file_sha256: canonical.file_sha256,
      },
      source_manifest: {
        path: source.path,
        file_sha256: source.file_sha256,
      },
    },
    artifacts: {
      source_evidence: {
        path: finalPaths.source_evidence,
        file_sha256: sourceEvidenceSha256,
      },
      story_intake: {
        path: finalPaths.story_intake,
        file_sha256: sha256(manifestBytes),
      },
    },
    quality: {
      publishable: false,
      generic_owned_cards_promoted_to_publishable: false,
      human_review_required: true,
      blockers: [
        "exact_subject_media_and_human_quality_review_required",
      ],
    },
    safety: {
      local_proof_only: true,
      legacy_inputs_mutated: false,
      database_mutated: false,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
      external_posting_authorised: false,
    },
  };
  const proof = {
    ...proofBase,
    proof_sha256: canonicalSha256(proofBase),
  };
  const summaryBytes = Buffer.from(
    renderProofMarkdown(proof),
    "utf8",
  );
  const materialized = await writeImmutableDirectory(
    outputPath,
    new Map([
      [OUTPUT_FILENAMES.sourceEvidence, sourceEvidenceBytes],
      [OUTPUT_FILENAMES.storyIntake, manifestBytes],
      [OUTPUT_FILENAMES.proof, jsonBytes(proof)],
      [OUTPUT_FILENAMES.summary, summaryBytes],
    ]),
  );
  const validation = validateStoryIntakeManifest({
    manifestPath: finalPaths.story_intake,
  });
  return {
    verdict: "VALID",
    publish_verdict: "HOLD",
    story_id: validation.storyId,
    legacy_story_id: legacyStoryId,
    reused: materialized.reused,
    word_count: validation.wordCount,
    paths: finalPaths,
    proof,
    publish_authority_created: false,
    database_mutated: false,
    oauth_mutated: false,
    platform_contacted: false,
  };
}

module.exports = {
  GovernedStoryIntakeInventoryBridgeError,
  PROOF_SCHEMA,
  materializeGovernedLockedStoryIntakeFromInventory,
  materializeGovernedStoryIntakeFromLegacyPackage,
  materializeGovernedStoryIntakeFromInventory,
  selectCompliantClaims,
};
