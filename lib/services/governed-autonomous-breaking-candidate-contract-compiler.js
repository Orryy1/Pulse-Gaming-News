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
  BINDINGS_SCHEMA,
} = require("./governed-editorial-inventory-candidate-hydrator");
const {
  RUNTIME_POLICY_SCHEMA_VERSION,
  canonicalSha256,
} = require("./governed-autonomous-production-request-builder");
const {
  CANDIDATE_SCHEMA_VERSION,
} = require("./governed-autonomous-window-production-planner");
const {
  assessRightsLedger,
  hashRightsLedger,
} = require("./publication-evidence-gates");
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
const {
  createGovernedAutonomousDatabaseStoryBinding,
} = require("./governed-autonomous-database-story-binding");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-breaking-candidate-contract-compiler-request-v1";
const MODE = "LOCAL_PROOF";
const CHANNEL_ID = "pulse-gaming";
const LANE_ID = "breaking_short";
const PLATFORM = "youtube";
const INVENTORY_SCHEMA_VERSION =
  "pulse-governed-editorial-inventory-v1";
const SOURCE_PACKET_SCHEMA_VERSION =
  "pulse-breaking-source-evidence-v1";
const PUBLICATION_SOURCE_SCHEMA_VERSION =
  "pulse-source-evidence-v1";
const RIGHTS_SCHEMA_VERSION =
  "pulse-weekly-longform-rights-ledger-v1";
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_FIELDS = new Set([
  "allowed_roots",
  "candidate",
  "generated_at",
  "inventory_root",
  "mode",
  "runtime_policy",
  "scheduled_for",
  "schema_version",
  "story",
  "workspace_root",
]);
const RUNTIME_INPUT_FIELDS = new Set([
  "disclosure_policy",
  "narration",
  "visual_qa",
]);
const NARRATION_FIELDS = new Set([
  "model_id",
  "provider",
  "speed",
  "voice_id",
]);
const VISUAL_QA_FIELDS = new Set(["reviewers"]);
const REVIEWER_FIELDS = new Set([
  "endpoint_origin",
  "model",
  "provider",
]);
const DISCLOSURE_FIELDS = new Set([
  "policy_id",
  "policy_version",
]);
const SUPPLEMENTAL_REFERENCE_FIELDS = new Set([
  "canonical_sha256",
  "file_sha256",
  "path",
]);
const STANDARD_PROFILE = Object.freeze({
  duration_band_id: "what_changes_short_25_32",
  min_words: 37,
  max_words: 47,
  min_seconds: 25,
  max_seconds: 32,
  seconds_per_word: 0.68,
  reviewed_target_required: false,
});
const HIGH_CADENCE_PROFILE = Object.freeze({
  duration_band_id:
    "what_changes_breaking_high_cadence_35_42",
  min_words: 100,
  max_words: 120,
  min_seconds: 35,
  max_seconds: 42,
  seconds_per_word: 0.35,
  reviewed_target_required: true,
});
const SUPPORT_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "another",
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

class GovernedAutonomousBreakingCandidateContractCompilerError extends Error {
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name =
      "GovernedAutonomousBreakingCandidateContractCompilerError";
    this.code = code;
  }
}

function fail(code, cause = null) {
  throw new GovernedAutonomousBreakingCandidateContractCompilerError(
    code,
    cause,
  );
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function text(value) {
  return String(value ?? "").trim();
}

function exactFields(value, fields, code) {
  if (
    !plainObject(value) ||
    Object.keys(value).length !== fields.size ||
    Object.keys(value).some((field) => !fields.has(field))
  ) {
    fail(code);
  }
  return value;
}

function exactSha256(value, code) {
  const hash = text(value)
    .replace(/^sha256:/i, "")
    .toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const timestamp = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== raw
  ) {
    fail(code);
  }
  return Object.freeze({ raw, timestamp });
}

function exactStoryId(value, code) {
  const storyId = text(value);
  if (!STORY_ID_PATTERN.test(storyId)) fail(code);
  return storyId;
}

function exactAbsolutePath(value, code) {
  const supplied = text(value);
  if (
    !supplied ||
    !path.isAbsolute(supplied) ||
    path.resolve(supplied) !== supplied
  ) {
    fail(code);
  }
  return supplied;
}

function samePath(left, right) {
  const first = path.resolve(text(left));
  const second = path.resolve(text(right));
  return process.platform === "win32"
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function fileIdentityMatches(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

async function exactDirectory(value, code) {
  const absolutePath = exactAbsolutePath(value, code);
  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch (error) {
    fail(code, error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code);
  const realPath = path.resolve(await fs.realpath(absolutePath));
  if (!samePath(absolutePath, realPath)) fail(code);
  return Object.freeze({
    path: absolutePath,
    real_path: realPath,
  });
}

async function assertSafeDerivedPath(workspace, candidatePath) {
  if (!pathWithin(workspace.path, candidatePath)) {
    fail(
      "autonomous_breaking_candidate_source_root_outside_workspace",
    );
  }
  const relative = path.relative(workspace.path, candidatePath);
  let cursor = workspace.path;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(
        "autonomous_breaking_candidate_source_root_ancestor_invalid",
      );
    }
    const realPath = path.resolve(await fs.realpath(cursor));
    if (!pathWithin(workspace.real_path, realPath)) {
      fail(
        "autonomous_breaking_candidate_source_root_ancestor_outside_workspace",
      );
    }
  }
}

async function readBoundJson({
  filePath,
  expectedSha256,
  roots,
  code,
}) {
  const absolutePath = exactAbsolutePath(filePath, `${code}_path_invalid`);
  const expected = exactSha256(
    expectedSha256,
    `${code}_sha256_invalid`,
  );
  if (!roots.some((root) => pathWithin(root.real_path, absolutePath))) {
    fail(`${code}_path_outside_trusted_root`);
  }
  let before;
  try {
    before = await fs.lstat(absolutePath, { bigint: true });
  } catch (error) {
    fail(`${code}_file_required`, error);
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1n ||
    before.size > BigInt(MAX_JSON_BYTES)
  ) {
    fail(`${code}_file_invalid`);
  }
  const realPath = path.resolve(await fs.realpath(absolutePath));
  if (!roots.some((root) => pathWithin(root.real_path, realPath))) {
    fail(`${code}_real_path_outside_trusted_root`);
  }
  const handle = await fs.open(realPath, "r");
  let bytes;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!fileIdentityMatches(before, opened)) {
      fail(`${code}_changed_during_read`);
    }
    bytes = await handle.readFile();
    const completed = await handle.stat({ bigint: true });
    const after = await fs.lstat(realPath, { bigint: true });
    if (
      BigInt(bytes.length) !== opened.size ||
      !fileIdentityMatches(opened, completed) ||
      !fileIdentityMatches(opened, after)
    ) {
      fail(`${code}_changed_during_read`);
    }
  } finally {
    await handle.close();
  }
  const observed = sha256(bytes);
  if (observed !== expected) fail(`${code}_sha256_mismatch`);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${code}_json_invalid`, error);
  }
  if (!plainObject(value)) fail(`${code}_object_required`);
  return Object.freeze({
    path: absolutePath,
    real_path: realPath,
    file_sha256: observed,
    bytes,
    value,
  });
}

function exactHttpsUrl(value, code) {
  const supplied = text(value);
  let parsed;
  try {
    parsed = new URL(supplied);
  } catch (error) {
    fail(code, error);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !canonicalUrl(supplied)
  ) {
    fail(code);
  }
  return supplied;
}

function referenceMatches(left, right, canonical = false) {
  return (
    samePath(left?.path, right?.path) &&
    exactSha256(left?.file_sha256, "bound_reference_sha256_invalid") ===
      exactSha256(right?.file_sha256, "bound_reference_sha256_invalid") &&
    (!canonical ||
      exactSha256(
        left?.canonical_sha256,
        "bound_reference_canonical_sha256_invalid",
      ) ===
        exactSha256(
          right?.canonical_sha256,
          "bound_reference_canonical_sha256_invalid",
        ))
  );
}

function stableProjection(value) {
  return JSON.stringify(
    Array.isArray(value)
      ? value
          .map((entry) => ({
            claim_key: text(entry?.claim_key),
            text: String(entry?.text ?? ""),
            claim_text_sha256: text(
              entry?.claim_text_sha256,
            ).toLowerCase(),
          }))
          .sort(
            (left, right) =>
              left.claim_key.localeCompare(right.claim_key) ||
              left.claim_text_sha256.localeCompare(
                right.claim_text_sha256,
              ),
          )
      : [],
  );
}

function visibleClaimText(value) {
  const captured = String(value ?? "");
  const visible = captured
    .replace(/\[(?:\/?(?:h[1-6]|b|i|u|p)|br)\]/gi, "")
    .trim();
  if (
    !captured.trim() ||
    !visible ||
    (visible !== captured.trim() &&
      (!captured.includes(visible) || /\[[^\]]+\]/.test(visible)))
  ) {
    fail("autonomous_breaking_candidate_official_claim_invalid");
  }
  return visible;
}

function exactOfficialClaims(packet, legacyStoryId, prefix) {
  if (
    packet.schema_version !== SOURCE_PACKET_SCHEMA_VERSION ||
    text(packet.story_id) !== legacyStoryId ||
    packet.verdict !== "OFFICIAL_CONFIRMED" ||
    packet.verification_status !== "CONFIRMED" ||
    packet.confirmation_basis !== "official_first_party" ||
    packet.verified_for_planning !== true ||
    !Array.isArray(packet.blockers) ||
    packet.blockers.length !== 0 ||
    packet.publish_authority !== false
  ) {
    fail(`${prefix}_official_first_party_confirmation_required`);
  }
  const primarySourceUrl = exactHttpsUrl(
    packet.primary_source_url,
    `${prefix}_primary_source_url_invalid`,
  );
  const sources = new Map(
    (Array.isArray(packet.sources) ? packet.sources : []).map(
      (source) => [
        `${text(source?.source_id)}\0${text(source?.final_url)}`,
        source,
      ],
    ),
  );
  const claims = [];
  for (const group of Array.isArray(packet.confirmed_claims)
    ? packet.confirmed_claims
    : []) {
    const claimKey = text(group?.claim_key);
    for (const evidence of Array.isArray(group?.evidence)
      ? group.evidence
      : []) {
      const source = sources.get(
        `${text(evidence?.source_id)}\0${text(evidence?.final_url)}`,
      );
      const capturedText = String(evidence?.text ?? "");
      const sourceClaim = (
        Array.isArray(source?.claims) ? source.claims : []
      ).find(
        (claim) =>
          text(claim?.claim_key) === claimKey &&
          String(claim?.text ?? "") === capturedText &&
          text(claim?.claim_sha256).toLowerCase() ===
            text(evidence?.claim_sha256).toLowerCase() &&
          text(claim?.claim_text_sha256).toLowerCase() ===
            sha256(Buffer.from(capturedText, "utf8")),
      );
      if (
        !claimKey ||
        source?.status !== "CAPTURED" ||
        text(source?.source_class).toUpperCase() !==
          "OFFICIAL_FIRST_PARTY" ||
        !sourceClaim ||
        source?.canonical_body?.algorithm !==
          "pulse-readable-body-v1" ||
        !SHA256_PATTERN.test(
          text(source?.canonical_body?.sha256).toLowerCase(),
        )
      ) {
        fail(`${prefix}_official_claim_binding_invalid`);
      }
      const visible = visibleClaimText(capturedText);
      claims.push({
        claim_key: claimKey,
        text: visible,
        claim_text_sha256: sha256(
          Buffer.from(visible, "utf8"),
        ),
        captured_text: capturedText,
        captured_text_sha256: sha256(
          Buffer.from(capturedText, "utf8"),
        ),
        source_url: exactHttpsUrl(
          source.final_url,
          `${prefix}_claim_source_url_invalid`,
        ),
        source_id: text(source.source_id),
        publisher: text(source.publisher),
      });
    }
  }
  claims.sort(
    (left, right) =>
      left.claim_key.localeCompare(right.claim_key) ||
      left.source_url.localeCompare(right.source_url),
  );
  if (!claims.length) fail(`${prefix}_official_claims_required`);
  return Object.freeze({
    primary_source_url: primarySourceUrl,
    claims,
  });
}

async function verifyPacketArchives(packet, roots, prefix) {
  const officialSources = (
    Array.isArray(packet.sources) ? packet.sources : []
  ).filter(
    (source) =>
      source?.status === "CAPTURED" &&
      text(source?.source_class).toUpperCase() ===
        "OFFICIAL_FIRST_PARTY",
  );
  if (!officialSources.length) {
    fail(`${prefix}_official_source_required`);
  }
  for (let index = 0; index < officialSources.length; index += 1) {
    const source = officialSources[index];
    const archivePath = exactAbsolutePath(
      source?.provenance?.archive_path,
      `${prefix}_archive_${index}_path_invalid`,
    );
    if (
      !roots.some((root) =>
        pathWithin(root.real_path, archivePath),
      )
    ) {
      fail(`${prefix}_archive_${index}_path_outside_trusted_root`);
    }
    const expected = exactSha256(
      source.bytes_sha256,
      `${prefix}_archive_${index}_sha256_invalid`,
    );
    if (
      exactSha256(
        source?.provenance?.bytes_sha256,
        `${prefix}_archive_${index}_provenance_sha256_invalid`,
      ) !== expected ||
      text(source?.provenance?.archive_ref).toLowerCase() !==
        `sha256:${expected}`
    ) {
      fail(`${prefix}_archive_${index}_binding_invalid`);
    }
    let stat;
    try {
      stat = await fs.lstat(archivePath);
    } catch (error) {
      fail(`${prefix}_archive_${index}_file_required`, error);
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > MAX_JSON_BYTES
    ) {
      fail(`${prefix}_archive_${index}_file_invalid`);
    }
    const realPath = path.resolve(await fs.realpath(archivePath));
    if (
      !roots.some((root) =>
        pathWithin(root.real_path, realPath),
      )
    ) {
      fail(
        `${prefix}_archive_${index}_real_path_outside_trusted_root`,
      );
    }
    const bytes = await fs.readFile(realPath);
    if (sha256(bytes) !== expected) {
      fail(`${prefix}_archive_${index}_sha256_mismatch`);
    }
    const body = extractReadableBody(
      bytes,
      text(source.content_type),
    );
    if (
      sha256(Buffer.from(body, "utf8")) !==
      exactSha256(
        source?.canonical_body?.sha256,
        `${prefix}_archive_${index}_canonical_sha256_invalid`,
      )
    ) {
      fail(`${prefix}_archive_${index}_canonical_body_mismatch`);
    }
    if (
      (Array.isArray(source.claims) ? source.claims : []).some(
        (claim) =>
        !body.includes(String(claim?.text ?? "")),
      )
    ) {
      fail(`${prefix}_archive_${index}_claim_missing`);
    }
  }
}

function supportTokens(value) {
  return [
    ...new Set(
      (text(value).toLowerCase().match(/[a-z0-9]+/g) || []).filter(
        (token) =>
          (token.length >= 4 || /^\d+$/.test(token)) &&
          !SUPPORT_STOP_WORDS.has(token),
      ),
    ),
  ];
}

function relatedSupportToken(left, right) {
  if (left === right) return true;
  const prefixLength = Math.min(left.length, right.length, 7);
  return (
    prefixLength >= 5 &&
    left.slice(0, prefixLength) === right.slice(0, prefixLength)
  );
}

function sharedSupportTokens(clauseTokens, claim) {
  const sourceTokens = supportTokens(
    `${claim.claim_key.replace(/[._-]+/g, " ")} ${claim.text}`,
  );
  return clauseTokens.filter((clauseToken) =>
    sourceTokens.some((sourceToken) =>
      relatedSupportToken(clauseToken, sourceToken),
    ),
  );
}

function partitionScript(script, claims) {
  const clauses = script.split(/(?<=[.!?])\s+/);
  if (
    !clauses.length ||
    clauses.some((clause) => !clause) ||
    clauses.join(" ") !== script
  ) {
    fail(
      "autonomous_breaking_candidate_script_clause_partition_invalid",
    );
  }
  return clauses.map((clause, index) => {
    const clauseTokens = supportTokens(clause);
    const ranked = claims
      .map((claim) => ({
        claim,
        shared: sharedSupportTokens(clauseTokens, claim),
      }))
      .filter((entry) => entry.shared.length)
      .sort(
        (left, right) =>
          right.shared.length - left.shared.length ||
          left.claim.claim_key.localeCompare(
            right.claim.claim_key,
          ),
      );
    const selected = [];
    const supported = new Set();
    for (const entry of ranked) {
      const novel = entry.shared.filter(
        (token) => !supported.has(token),
      );
      if (!novel.length) continue;
      selected.push(entry.claim);
      for (const token of entry.shared) supported.add(token);
    }
    const minimumCoverage = Math.max(
      2,
      Math.ceil(Math.min(clauseTokens.length, 8) * 0.25),
    );
    if (
      !selected.length ||
      supported.size < minimumCoverage
    ) {
      fail(
        `autonomous_breaking_candidate_script_clause_${index}_unsupported`,
      );
    }
    return Object.freeze({
      clause,
      claim_keys: selected
        .map((claim) => claim.claim_key)
        .sort(),
    });
  });
}

function scriptProfile(script) {
  const wordCount = countSpokenWords(script);
  if (
    wordCount >= STANDARD_PROFILE.min_words &&
    wordCount <= STANDARD_PROFILE.max_words
  ) {
    return { profile: STANDARD_PROFILE, word_count: wordCount };
  }
  if (
    wordCount >= HIGH_CADENCE_PROFILE.min_words &&
    wordCount <= HIGH_CADENCE_PROFILE.max_words
  ) {
    return {
      profile: HIGH_CADENCE_PROFILE,
      word_count: wordCount,
    };
  }
  fail("autonomous_breaking_candidate_script_word_count_invalid");
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function buildContract(profile, wordCount, scriptSha256, generatedAt) {
  const targetDurationSeconds = Number(
    clamp(
      wordCount * profile.seconds_per_word,
      profile.min_seconds,
      profile.max_seconds,
    ).toFixed(2),
  );
  return Object.freeze({
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: profile.duration_band_id,
      target_duration_seconds: targetDurationSeconds,
      ...(profile.reviewed_target_required
        ? {
            target_duration_review: {
              status: "APPROVED",
              target_duration_seconds: targetDurationSeconds,
              script_sha256: scriptSha256,
              reviewed_by:
                "SYSTEM_POLICY:pulse-autonomous-duration-policy-v1",
              reviewed_at: generatedAt,
            },
          }
        : {}),
    },
    target_duration_seconds: targetDurationSeconds,
  });
}

function headlineFromClause(clause) {
  const words = text(clause)
    .replace(/[.!?]+$/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const selected = words.slice(0, 6).join(" ").toUpperCase();
  return selected.length <= 96
    ? selected
    : selected.slice(0, 96).trim();
}

function supportingText(clause) {
  const value = text(clause);
  if (value.length <= 180) return value;
  const clipped = value.slice(0, 180);
  const boundary = clipped.lastIndexOf(" ");
  return clipped.slice(0, boundary > 80 ? boundary : 180).trim();
}

function scene({
  assetId,
  role,
  mediaType,
  start,
  duration,
  headline,
  supporting,
  layout,
}) {
  return {
    asset_id: assetId,
    role,
    media_type: mediaType,
    start_seconds: start,
    duration_seconds: duration,
    design: {
      schema_version: "pulse-owned-vector-scene-v1",
      headline,
      supporting_text: supporting,
      accent_colour: "#FF6B1A",
      layout,
    },
    ownership: "owned",
    rights_basis: "OWNED",
    attribution_required: false,
    provenance: {
      source: "repository_owned_authored_vector_scene",
      third_party_media_used: false,
      third_party_music: false,
    },
  };
}

function roundSeconds(value) {
  return Number(value.toFixed(6));
}

function buildScenes(bindings, targetDurationSeconds) {
  const clauses = bindings.map((binding) => binding.clause);
  const openingDuration = Math.min(3, targetDurationSeconds);
  const remaining = targetDurationSeconds - openingDuration;
  const segment = remaining / 4;
  const sceneDefinitions = [
    ["owned-hook", "hook_slam", "image", "TITLE", 0],
    [
      "owned-motion-backbone",
      "owned_motion_backbone",
      "video",
      "BACKBONE",
      0,
    ],
    ["owned-change", "verified_change", "image", "TIMELINE", 1],
    ["owned-detail", "verified_detail", "image", "COMPARISON", 2],
    ["owned-impact", "player_impact", "image", "GRID", 3],
    ["owned-payoff", "source_payoff", "image", "IMPACT", 4],
  ];
  return sceneDefinitions.map(
    ([assetId, role, mediaType, layout, index], sceneIndex) => {
      const binding = bindings[index % bindings.length];
      if (sceneIndex === 0) {
        return scene({
          assetId,
          role,
          mediaType,
          start: 0,
          duration: openingDuration,
          headline: headlineFromClause(binding.clause),
          supporting: supportingText(binding.clause),
          layout,
        });
      }
      if (sceneIndex === 1) {
        return scene({
          assetId,
          role,
          mediaType,
          start: 0,
          duration: targetDurationSeconds,
          headline: headlineFromClause(binding.clause),
          supporting: supportingText(binding.clause),
          layout,
        });
      }
      const segmentIndex = sceneIndex - 2;
      const start = roundSeconds(
        openingDuration + segment * segmentIndex,
      );
      const end =
        sceneIndex === 5
          ? targetDurationSeconds
          : roundSeconds(
              openingDuration + segment * (segmentIndex + 1),
            );
      return scene({
        assetId,
        role,
        mediaType,
        start,
        duration: roundSeconds(end - start),
        headline: headlineFromClause(binding.clause),
        supporting: supportingText(binding.clause),
        layout,
      });
    },
  );
}

function presentationBindings(scriptBindings) {
  const seen = new Set();
  const result = [];
  for (const binding of scriptBindings) {
    const presentationText = headlineFromClause(binding.clause);
    if (seen.has(presentationText)) continue;
    seen.add(presentationText);
    result.push({
      presentation_text: presentationText,
      claim_keys: [...binding.claim_keys],
    });
  }
  return result;
}

function exactLoopbackOrigin(value, code) {
  const supplied = text(value);
  let parsed;
  try {
    parsed = new URL(supplied);
  } catch (error) {
    fail(code, error);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]", "::1"].includes(host) ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash
  ) {
    fail(code);
  }
  return supplied.replace(/\/$/, "");
}

function normaliseRuntimePolicy(value, generatedAt, workspaceRoot, storyId) {
  exactFields(
    value,
    RUNTIME_INPUT_FIELDS,
    "autonomous_breaking_candidate_runtime_policy_fields_invalid",
  );
  exactFields(
    value.narration,
    NARRATION_FIELDS,
    "autonomous_breaking_candidate_narration_fields_invalid",
  );
  if (
    text(value.narration.provider).toLowerCase() !==
      "elevenlabs" ||
    !text(value.narration.voice_id) ||
    !text(value.narration.model_id) ||
    !Number.isFinite(Number(value.narration.speed)) ||
    Number(value.narration.speed) <= 0 ||
    Number(value.narration.speed) > 2
  ) {
    fail("autonomous_breaking_candidate_narration_invalid");
  }
  exactFields(
    value.visual_qa,
    VISUAL_QA_FIELDS,
    "autonomous_breaking_candidate_visual_qa_fields_invalid",
  );
  if (
    !Array.isArray(value.visual_qa.reviewers) ||
    value.visual_qa.reviewers.length !== 2
  ) {
    fail(
      "autonomous_breaking_candidate_two_loopback_reviewers_required",
    );
  }
  const reviewers = value.visual_qa.reviewers.map(
    (reviewer, index) => {
      exactFields(
        reviewer,
        REVIEWER_FIELDS,
        `autonomous_breaking_candidate_reviewer_${index}_fields_invalid`,
      );
      if (
        text(reviewer.provider).toLowerCase() !== "ollama" ||
        !text(reviewer.model)
      ) {
        fail(
          `autonomous_breaking_candidate_reviewer_${index}_invalid`,
        );
      }
      return {
        provider: "ollama",
        model: text(reviewer.model),
        endpoint_origin: exactLoopbackOrigin(
          reviewer.endpoint_origin,
          `autonomous_breaking_candidate_reviewer_${index}_origin_invalid`,
        ),
      };
    },
  );
  if (
    new Set(reviewers.map((reviewer) => reviewer.model)).size !== 2
  ) {
    fail(
      "autonomous_breaking_candidate_distinct_reviewers_required",
    );
  }
  exactFields(
    value.disclosure_policy,
    DISCLOSURE_FIELDS,
    "autonomous_breaking_candidate_disclosure_fields_invalid",
  );
  if (
    !text(value.disclosure_policy.policy_id) ||
    !text(value.disclosure_policy.policy_version)
  ) {
    fail("autonomous_breaking_candidate_disclosure_invalid");
  }
  return {
    schema_version: RUNTIME_POLICY_SCHEMA_VERSION,
    mode: MODE,
    generated_at: generatedAt,
    workspace_root: workspaceRoot,
    candidate_source_root: path.join(
      workspaceRoot,
      "output",
      "canary",
      storyId,
    ),
    narration: {
      provider: "elevenlabs",
      voice_id: text(value.narration.voice_id),
      model_id: text(value.narration.model_id),
      speed: Number(value.narration.speed),
    },
    visual_qa: { reviewers },
    disclosure_policy: {
      policy_id: text(value.disclosure_policy.policy_id),
      policy_version: text(
        value.disclosure_policy.policy_version,
      ),
    },
    safety: {
      local_proof_only: true,
      database_authority: false,
      database_mutated: false,
      network_authority: false,
      network_used: false,
      oauth_or_token_authority: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
}

function exactSupplementalReferences(value) {
  if (!Array.isArray(value)) {
    fail(
      "autonomous_breaking_candidate_supplemental_sources_invalid",
    );
  }
  const references = value.map((reference, index) => {
    exactFields(
      reference,
      SUPPLEMENTAL_REFERENCE_FIELDS,
      `autonomous_breaking_candidate_supplemental_${index}_fields_invalid`,
    );
    return {
      path: exactAbsolutePath(
        reference.path,
        `autonomous_breaking_candidate_supplemental_${index}_path_invalid`,
      ),
      file_sha256: exactSha256(
        reference.file_sha256,
        `autonomous_breaking_candidate_supplemental_${index}_file_sha256_invalid`,
      ),
      canonical_sha256: exactSha256(
        reference.canonical_sha256,
        `autonomous_breaking_candidate_supplemental_${index}_canonical_sha256_invalid`,
      ),
    };
  });
  references.sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  if (
    new Set(references.map((reference) => reference.path)).size !==
    references.length
  ) {
    fail(
      "autonomous_breaking_candidate_supplemental_sources_duplicate",
    );
  }
  return references;
}

function normaliseScript(value) {
  const supplied = String(value ?? "").trim();
  const normalised = supplied.replace(/\s+/g, " ");
  if (!supplied || supplied !== normalised) {
    fail("autonomous_breaking_candidate_final_script_invalid");
  }
  return supplied;
}

function assertLegacyProjectionAvailable(story) {
  let extra = {};
  try {
    extra = JSON.parse(story?._extra || "{}");
  } catch {
    fail("autonomous_breaking_candidate_db_story_extra_invalid");
  }
  if (
    !plainObject(extra) ||
    text(story?.publish_status).toLowerCase() ===
      "canonical_projection_consumed" ||
    Object.hasOwn(
      extra,
      "governed_autonomous_canonical_projection",
    )
  ) {
    fail(
      "autonomous_breaking_candidate_legacy_projection_consumed",
    );
  }
}

function publicTitle(firstClause) {
  const title = text(firstClause).replace(/[.!?]+$/g, "");
  return title.slice(0, 100).trim();
}

function assertCandidateReady(candidate, legacyStoryId) {
  if (
    text(candidate.lane_id) !== LANE_ID ||
    text(candidate.stage).toUpperCase() !== "PLANNING" ||
    exactStoryId(
      candidate.story_id,
      "autonomous_breaking_candidate_hydrated_story_id_invalid",
    ) !== legacyStoryId ||
    text(candidate.verification_status).toUpperCase() !==
      "CONFIRMED" ||
    candidate.verified_for_planning !== true ||
    text(
      candidate?.governed_source_evidence?.verification_status,
    ).toUpperCase() !== "CONFIRMED" ||
    candidate?.governed_source_evidence?.verified_for_planning !==
      true
  ) {
    fail("autonomous_breaking_candidate_hydrated_ready_required");
  }
}

function assertExactHydratedBindings(candidate, bindings) {
  const comparisons = [
    [
      candidate.governed_editorial_inventory_path,
      bindings.inventory.path,
      true,
    ],
    [
      candidate.governed_editorial_inventory_file_sha256,
      bindings.inventory.file_sha256,
      false,
    ],
    [
      candidate.governed_editorial_inventory_canonical_sha256,
      bindings.inventory.canonical_sha256,
      false,
    ],
    [
      candidate.source_evidence_path,
      bindings.source_evidence.path,
      true,
    ],
    [
      candidate.source_evidence_file_sha256,
      bindings.source_evidence.file_sha256,
      false,
    ],
    [
      candidate.source_evidence_sha256,
      bindings.source_evidence.canonical_sha256,
      false,
    ],
    [
      candidate.publication_source_evidence_path,
      bindings.publication_source_evidence.path,
      true,
    ],
    [
      candidate.publication_source_evidence_file_sha256,
      bindings.publication_source_evidence.file_sha256,
      false,
    ],
    [
      candidate.publication_source_evidence_sha256,
      bindings.publication_source_evidence.file_sha256,
      false,
    ],
    [
      candidate.rights_ledger_path,
      bindings.rights_ledger.path,
      true,
    ],
    [
      candidate.rights_ledger_file_sha256,
      bindings.rights_ledger.file_sha256,
      false,
    ],
    [
      candidate.rights_ledger_canonical_sha256,
      bindings.rights_ledger.canonical_sha256,
      false,
    ],
  ];
  for (const [observed, expected, isPath] of comparisons) {
    const matches = isPath
      ? samePath(observed, expected)
      : exactSha256(
          observed,
          "autonomous_breaking_candidate_hydrated_binding_sha256_invalid",
        ) ===
        exactSha256(
          expected,
          "autonomous_breaking_candidate_hydrated_binding_sha256_invalid",
        );
    if (!matches) {
      fail(
        "autonomous_breaking_candidate_hydrated_binding_mismatch",
      );
    }
  }
}

async function compileGovernedAutonomousBreakingCandidateContract(
  value = {},
) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "autonomous_breaking_candidate_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("autonomous_breaking_candidate_local_proof_only");
  }
  const generated = exactTimestamp(
    value.generated_at,
    "autonomous_breaking_candidate_generated_at_invalid",
  );
  const scheduled = exactTimestamp(
    value.scheduled_for,
    "autonomous_breaking_candidate_scheduled_for_invalid",
  );
  const scheduledDate = new Date(scheduled.timestamp);
  if (
    ![9, 19].includes(scheduledDate.getUTCHours()) ||
    scheduledDate.getUTCMinutes() !== 0 ||
    scheduledDate.getUTCSeconds() !== 0 ||
    scheduledDate.getUTCMilliseconds() !== 0 ||
    generated.timestamp >= scheduled.timestamp
  ) {
    fail("autonomous_breaking_candidate_guarded_window_invalid");
  }
  const workspace = await exactDirectory(
    value.workspace_root,
    "autonomous_breaking_candidate_workspace_root_invalid",
  );
  const inventoryRoot = await exactDirectory(
    value.inventory_root,
    "autonomous_breaking_candidate_inventory_root_invalid",
  );
  if (
    !Array.isArray(value.allowed_roots) ||
    !value.allowed_roots.length
  ) {
    fail("autonomous_breaking_candidate_allowed_roots_invalid");
  }
  const allowedRoots = [];
  for (const root of value.allowed_roots) {
    allowedRoots.push(
      await exactDirectory(
        root,
        "autonomous_breaking_candidate_allowed_root_invalid",
      ),
    );
  }
  if (
    new Set(
      allowedRoots.map((root) =>
        process.platform === "win32"
          ? root.real_path.toLowerCase()
          : root.real_path,
      ),
    ).size !== allowedRoots.length
  ) {
    fail("autonomous_breaking_candidate_allowed_roots_duplicate");
  }
  const roots = [
    inventoryRoot,
    ...allowedRoots.filter(
      (root) =>
        !samePath(root.real_path, inventoryRoot.real_path),
    ),
  ];
  const candidate = value.candidate;
  const story = value.story;
  if (!plainObject(candidate) || !plainObject(story)) {
    fail("autonomous_breaking_candidate_inputs_invalid");
  }
  const legacyStoryId = exactStoryId(
    story.id,
    "autonomous_breaking_candidate_db_story_id_invalid",
  );
  assertLegacyProjectionAvailable(story);
  assertCandidateReady(candidate, legacyStoryId);

  const bindings =
    candidate.governed_editorial_inventory_bindings;
  if (
    !plainObject(bindings) ||
    bindings.schema_version !== BINDINGS_SCHEMA ||
    text(bindings.story_id) !== legacyStoryId ||
    !plainObject(bindings.inventory) ||
    !plainObject(bindings.source_evidence) ||
    !plainObject(bindings.publication_source_evidence) ||
    !plainObject(bindings.rights_ledger)
  ) {
    fail(
      "autonomous_breaking_candidate_inventory_bindings_invalid",
    );
  }
  assertExactHydratedBindings(candidate, bindings);
  const inventory = await readBoundJson({
    filePath: bindings.inventory.path,
    expectedSha256: bindings.inventory.file_sha256,
    roots: [inventoryRoot],
    code: "autonomous_breaking_candidate_inventory",
  });
  const registry = inventory.value;
  const {
    inventory_sha256: _inventorySha256,
    ...inventoryBase
  } = registry;
  if (
    registry.schema_version !== INVENTORY_SCHEMA_VERSION ||
    registry.verdict !== "READY" ||
    !Array.isArray(registry.blockers) ||
    registry.blockers.length ||
    text(registry?.story?.id) !== legacyStoryId ||
    exactSha256(
      registry.inventory_sha256,
      "autonomous_breaking_candidate_inventory_canonical_sha256_invalid",
    ) !== canonicalSha256(inventoryBase) ||
    exactSha256(
      bindings.inventory.canonical_sha256,
      "autonomous_breaking_candidate_inventory_binding_sha256_invalid",
    ) !== text(registry.inventory_sha256).toLowerCase()
  ) {
    fail("autonomous_breaking_candidate_inventory_not_ready");
  }
  for (const field of [
    "database_mutated",
    "oauth_mutated",
    "platform_contacted",
    "publish_authority_created",
    "scheduler_authority_created",
    "external_posting_authorised",
  ]) {
    if (registry?.safety?.[field] !== false) {
      fail(
        "autonomous_breaking_candidate_inventory_safety_invalid",
      );
    }
  }
  if (
    !referenceMatches(
      registry.breaking_source_evidence,
      bindings.source_evidence,
      true,
    ) ||
    !referenceMatches(
      registry.weekly_source_evidence,
      bindings.publication_source_evidence,
      false,
    ) ||
    !referenceMatches(
      registry.rights_ledger,
      bindings.rights_ledger,
      true,
    )
  ) {
    fail(
      "autonomous_breaking_candidate_inventory_reference_mismatch",
    );
  }

  const primaryPacketFile = await readBoundJson({
    filePath: bindings.source_evidence.path,
    expectedSha256: bindings.source_evidence.file_sha256,
    roots,
    code: "autonomous_breaking_candidate_primary_source",
  });
  const primaryAssessment =
    validateBreakingSourceEvidencePacket(
      primaryPacketFile.value,
    );
  if (
    !primaryAssessment.valid ||
    primaryAssessment.packet_sha256 !==
      exactSha256(
        bindings.source_evidence.canonical_sha256,
        "autonomous_breaking_candidate_primary_canonical_sha256_invalid",
      )
  ) {
    fail(
      "autonomous_breaking_candidate_primary_source_hash_invalid",
    );
  }
  const primary = exactOfficialClaims(
    primaryPacketFile.value,
    legacyStoryId,
    "autonomous_breaking_candidate_primary_source",
  );
  const registryPrimarySourceUrl = exactHttpsUrl(
    registry?.story?.primary_source_url,
    "autonomous_breaking_candidate_registry_source_url_invalid",
  );
  if (
    primary.primary_source_url !== registryPrimarySourceUrl ||
    text(candidate.primary_source_url) !== registryPrimarySourceUrl ||
    text(candidate.governed_source_evidence.primary_source_url) !==
      registryPrimarySourceUrl ||
    exactSha256(
      candidate.source_evidence_sha256,
      "autonomous_breaking_candidate_source_sha256_invalid",
    ) !== primaryAssessment.packet_sha256
  ) {
    fail(
      "autonomous_breaking_candidate_primary_source_binding_mismatch",
    );
  }
  await verifyPacketArchives(
    primaryPacketFile.value,
    roots,
    "autonomous_breaking_candidate_primary_source",
  );

  const publicationFile = await readBoundJson({
    filePath: bindings.publication_source_evidence.path,
    expectedSha256:
      bindings.publication_source_evidence.file_sha256,
    roots,
    code: "autonomous_breaking_candidate_publication_source",
  });
  const publication = publicationFile.value;
  const primaryRawProjection = primary.claims.map((claim) => ({
    claim_key: claim.claim_key,
    text: claim.captured_text,
    claim_text_sha256: claim.captured_text_sha256,
  }));
  if (
    publication.schema_version !==
      PUBLICATION_SOURCE_SCHEMA_VERSION ||
    text(publication.story_id) !== legacyStoryId ||
    text(publication.source_type).toLowerCase() !== "official" ||
    text(publication.source_url) !== registryPrimarySourceUrl ||
    text(publication.published_at) !==
      text(registry?.story?.published_at) ||
    publication?.official_source_snapshot?.source_class !==
      "OFFICIAL_FIRST_PARTY" ||
    text(publication?.official_source_snapshot?.source_url) !==
      registryPrimarySourceUrl ||
    stableProjection(
      publication?.official_source_snapshot?.claims,
    ) !== stableProjection(primaryRawProjection)
  ) {
    fail(
      "autonomous_breaking_candidate_publication_source_invalid",
    );
  }
  const builtReleaseBinding = buildOfficialSourceReleaseBinding({
    storyId: legacyStoryId,
    sourceEvidenceSha256: publicationFile.file_sha256,
    sourceEvidence: publication,
  });
  if (
    canonicalSha256(builtReleaseBinding) !==
    canonicalSha256(
      bindings.publication_source_evidence
        .official_source_release_binding,
    ) ||
    canonicalSha256(builtReleaseBinding) !==
    canonicalSha256(candidate.official_source_release_binding)
  ) {
    fail(
      "autonomous_breaking_candidate_publication_release_binding_invalid",
    );
  }

  const rightsFile = await readBoundJson({
    filePath: bindings.rights_ledger.path,
    expectedSha256: bindings.rights_ledger.file_sha256,
    roots,
    code: "autonomous_breaking_candidate_rights",
  });
  const rights = rightsFile.value;
  const rightsCanonicalSha256 = hashRightsLedger(rights);
  const rightsAssessment = assessRightsLedger(
    rights,
    rightsCanonicalSha256,
  );
  if (
    rights.schema_version !== RIGHTS_SCHEMA_VERSION ||
    text(rights.story_id) !== legacyStoryId ||
    exactSha256(
      bindings.rights_ledger.canonical_sha256,
      "autonomous_breaking_candidate_rights_canonical_sha256_invalid",
    ) !== rightsCanonicalSha256 ||
    exactSha256(
      rights.ledger_sha256,
      "autonomous_breaking_candidate_rights_ledger_sha256_invalid",
    ) !== rightsCanonicalSha256 ||
    rightsAssessment.blockers.length ||
    rights?.safety?.owned_motion_only !== true ||
    rights?.safety?.third_party_media_used !== false ||
    rights?.safety?.third_party_music_used !== false
  ) {
    fail("autonomous_breaking_candidate_owned_rights_required");
  }

  const supplementalReferences = exactSupplementalReferences(
    candidate.supplemental_official_sources || [],
  );
  const claimInventory = [...primary.claims];
  for (
    let index = 0;
    index < supplementalReferences.length;
    index += 1
  ) {
    const reference = supplementalReferences[index];
    const packetFile = await readBoundJson({
      filePath: reference.path,
      expectedSha256: reference.file_sha256,
      roots,
      code: `autonomous_breaking_candidate_supplemental_${index}`,
    });
    const assessment = validateBreakingSourceEvidencePacket(
      packetFile.value,
    );
    if (
      !assessment.valid ||
      assessment.packet_sha256 !== reference.canonical_sha256
    ) {
      fail(
        `autonomous_breaking_candidate_supplemental_${index}_hash_invalid`,
      );
    }
    const exact = exactOfficialClaims(
      packetFile.value,
      legacyStoryId,
      `autonomous_breaking_candidate_supplemental_${index}`,
    );
    await verifyPacketArchives(
      packetFile.value,
      roots,
      `autonomous_breaking_candidate_supplemental_${index}`,
    );
    claimInventory.push(...exact.claims);
  }
  const claimKeys = claimInventory.map(
    (claim) => claim.claim_key,
  );
  if (
    new Set(claimKeys).size !== claimKeys.length ||
    claimInventory.length > 32
  ) {
    fail(
      "autonomous_breaking_candidate_claim_inventory_ambiguous",
    );
  }

  const canonicalIdentityUrl = (() => {
    const supplied =
      text(story.canonical_identity_url) ||
      text(story.primary_source_url) ||
      text(story.url) ||
      text(story.article_url) ||
      registryPrimarySourceUrl;
    const exact = exactHttpsUrl(
      supplied,
      "autonomous_breaking_candidate_canonical_identity_url_invalid",
    );
    if (
      legacyStoryId.startsWith("official_")
        ? `official_${canonicalHash(exact)}` !== legacyStoryId
        : canonicalUrl(exact) !==
          canonicalUrl(registryPrimarySourceUrl)
    ) {
      fail(
        "autonomous_breaking_candidate_canonical_identity_mismatch",
      );
    }
    return exact;
  })();
  const canonicalStoryId =
    `official_${canonicalHash(canonicalIdentityUrl)}`;
  const script = normaliseScript(story.full_script);
  const scriptSha256 = sha256(Buffer.from(script, "utf8"));
  const databaseStoryBinding =
    createGovernedAutonomousDatabaseStoryBinding({
      canonical_story_id: canonicalStoryId,
      database_story_id: legacyStoryId,
      canonical_identity_url: canonicalIdentityUrl,
      inventory_file_sha256: inventory.file_sha256,
      final_script_sha256: scriptSha256,
    });
  const { profile, word_count: wordCount } =
    scriptProfile(script);
  const scriptClaimBindings = partitionScript(
    script,
    claimInventory,
  );
  const { contract, target_duration_seconds: targetDuration } =
    buildContract(
      profile,
      wordCount,
      scriptSha256,
      generated.raw,
    );
  const published = exactTimestamp(
    registry?.story?.published_at,
    "autonomous_breaking_candidate_source_published_at_invalid",
  );
  const verified = exactTimestamp(
    primaryPacketFile.value.generated_at,
    "autonomous_breaking_candidate_verified_at_invalid",
  );
  if (
    published.timestamp > verified.timestamp ||
    verified.timestamp > generated.timestamp ||
    verified.timestamp > scheduled.timestamp
  ) {
    fail("autonomous_breaking_candidate_source_time_invalid");
  }
  const selectionScore = Number(
    story.breaking_score ?? story.score,
  );
  if (
    !Number.isFinite(selectionScore) ||
    selectionScore < 0 ||
    selectionScore > 1_000_000
  ) {
    fail(
      "autonomous_breaking_candidate_selection_score_invalid",
    );
  }

  const title = publicTitle(scriptClaimBindings[0].clause);
  const publisher =
    primary.claims.find((claim) => claim.publisher)?.publisher ||
    publication.publisher ||
    publication?.official_source_snapshot?.source_id;
  if (!text(publisher)) {
    fail("autonomous_breaking_candidate_source_publisher_required");
  }
  const attribution = `Official source: ${text(publisher)}`;
  const scenes = buildScenes(
    scriptClaimBindings,
    targetDuration,
  );
  const lockedIntake = {
    database_story_binding: databaseStoryBinding,
    inventory_path: inventory.path,
    inventory_file_sha256: inventory.file_sha256,
    inventory_root: inventoryRoot.path,
    allowed_roots: value.allowed_roots.map((root) =>
      exactAbsolutePath(
        root,
        "autonomous_breaking_candidate_allowed_root_invalid",
      ),
    ),
    canonical_identity_url: canonicalIdentityUrl,
    final_script: script,
    final_script_sha256: scriptSha256,
    script_claim_bindings: scriptClaimBindings,
    presentation_claim_bindings: presentationBindings(
      scriptClaimBindings,
    ),
    supplemental_official_sources: supplementalReferences,
    contract,
    freshness: {
      discovered_at: published.raw,
      source_last_checked_at: verified.raw,
      publish_by: scheduled.raw,
      stale_after: new Date(
        scheduled.timestamp + 2 * 60 * 60 * 1000,
      ).toISOString(),
      reverification_required: true,
      stale_reframe_option: {
        allowed: false,
        reason:
          "Breaking-news wording is bound to the current official-source evidence.",
      },
    },
    visual_brief: {
      format: "owned-motion-only",
      source_media_policy: "OWNED_ONLY",
      palette: ["#07090D", "#FF6B1A", "#F7F8FA"],
    },
    experiment_dimensions: {
      eligible: false,
      ineligibility_reason:
        "Autonomous breaking production is outside the controlled calibration.",
    },
  };
  const creativePackage = {
    scenes,
    title,
    description: [
      script,
      "",
      `Official source: ${canonicalIdentityUrl}`,
      attribution,
      "",
      "#GamingNews #Shorts",
    ].join("\n"),
    official_source_url: canonicalIdentityUrl,
    required_attributions: [attribution],
    subject_terms: [title],
  };
  const runtimePolicy = normaliseRuntimePolicy(
    value.runtime_policy,
    generated.raw,
    workspace.path,
    canonicalStoryId,
  );
  await assertSafeDerivedPath(
    workspace,
    runtimePolicy.candidate_source_root,
  );
  const revisionBody = {
    schema_version:
      "pulse-governed-autonomous-breaking-candidate-revision-v1",
    legacy_story_id: legacyStoryId,
    story_id: canonicalStoryId,
    scheduled_for: scheduled.raw,
    inventory_file_sha256: inventory.file_sha256,
    inventory_canonical_sha256: text(
      registry.inventory_sha256,
    ).toLowerCase(),
    primary_source_packet_sha256:
      primaryAssessment.packet_sha256,
    publication_source_evidence_sha256:
      publicationFile.file_sha256,
    rights_ledger_sha256: rightsCanonicalSha256,
    supplemental_source_packet_sha256:
      supplementalReferences.map(
        (reference) => reference.canonical_sha256,
      ),
    final_script_sha256: scriptSha256,
    locked_intake_sha256: canonicalSha256(lockedIntake),
    creative_package_sha256:
      canonicalSha256(creativePackage),
    runtime_policy_sha256: canonicalSha256(runtimePolicy),
  };
  const candidateRevisionSha256 =
    canonicalSha256(revisionBody);
  const requestFingerprint = canonicalSha256({
    schema_version:
      "pulse-governed-autonomous-breaking-production-request-fingerprint-v1",
    story_id: canonicalStoryId,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: scheduled.raw,
    candidate_revision_sha256: candidateRevisionSha256,
    locked_intake_sha256: revisionBody.locked_intake_sha256,
    creative_package_sha256:
      revisionBody.creative_package_sha256,
    runtime_policy_sha256:
      revisionBody.runtime_policy_sha256,
  });

  return Object.freeze({
    schema_version: CANDIDATE_SCHEMA_VERSION,
    mode: MODE,
    story_id: canonicalStoryId,
    channel_id: CHANNEL_ID,
    lane_id: LANE_ID,
    platform: PLATFORM,
    scheduled_for: scheduled.raw,
    source_type: "official",
    verification_status: "CONFIRMED",
    eligibility_verdict: "GREEN",
    source_evidence_sha256:
      primaryAssessment.packet_sha256,
    source_published_at: published.raw,
    verified_at: verified.raw,
    selection_score: selectionScore,
    locked_intake_binding: {
      story_id: canonicalStoryId,
      locked_intake: lockedIntake,
    },
    creative_package: creativePackage,
    runtime_policy: runtimePolicy,
    candidate_revision_sha256: candidateRevisionSha256,
    request_fingerprint: requestFingerprint,
  });
}

module.exports = {
  CANDIDATE_SCHEMA_VERSION,
  GovernedAutonomousBreakingCandidateContractCompilerError,
  REQUEST_SCHEMA_VERSION,
  compileGovernedAutonomousBreakingCandidateContract,
};
