"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  validateBreakingSourceEvidencePacket,
} = require("./breaking-source-evidence");
const {
  assessRightsLedger,
  hashRightsLedger,
} = require("./publication-evidence-gates");

const SCHEMA_VERSION = "pulse-governed-editorial-inventory-v1";
const WEEKLY_SOURCE_SCHEMA = "pulse-source-evidence-v1";
const RIGHTS_LEDGER_SCHEMA = "pulse-weekly-longform-rights-ledger-v1";
const ADVERTISER_SAFETY_SCHEMA = "pulse-advertiser-safety-report-v1";
const OWNED_MOTION_SCHEMA = "pulse-owned-motion-manifest-v1";
const MODE = "LOCAL_PROOF";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAXIMUM_EVIDENCE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const MINIMUM_ASSET_COUNT = 5;
const MINIMUM_MOTION_FAMILIES = 2;

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(array(values).filter(Boolean))];
}

function normaliseSha256(value) {
  const result = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(result) ? result : null;
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

function hashObject(value) {
  return sha256(Buffer.from(JSON.stringify(stableValue(value)), "utf8"));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isoDate(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function resolvedPath(value, baseDir = process.cwd()) {
  const declared = String(value ?? "").trim();
  if (!declared) return null;
  return path.resolve(
    path.isAbsolute(declared) ? declared : path.join(baseDir, declared),
  );
}

async function observeFile({
  reference,
  prefix,
  baseDir = process.cwd(),
  maximumBytes = MAXIMUM_EVIDENCE_BYTES,
  json = true,
}) {
  const ref = object(reference);
  const absolutePath = resolvedPath(ref.path, baseDir);
  const expectedSha256 = normaliseSha256(
    ref.file_sha256 || ref.sha256 || ref.expected_sha256,
  );
  const blockers = [];
  if (!absolutePath) blockers.push(`${prefix}_path_required`);
  if (!expectedSha256) blockers.push(`${prefix}_file_sha256_required`);
  if (blockers.length) {
    return {
      blockers,
      path: absolutePath,
      file_sha256: null,
      value: null,
      byte_length: null,
    };
  }

  let stat;
  try {
    stat = await fsp.lstat(absolutePath);
  } catch {
    return {
      blockers: [`${prefix}_file_missing`],
      path: absolutePath,
      file_sha256: null,
      value: null,
      byte_length: null,
    };
  }
  if (stat.isSymbolicLink()) {
    return {
      blockers: [`${prefix}_symlink_forbidden`],
      path: absolutePath,
      file_sha256: null,
      value: null,
      byte_length: stat.size,
    };
  }
  if (!stat.isFile()) blockers.push(`${prefix}_not_a_file`);
  if (stat.size <= 0 || stat.size > maximumBytes) {
    blockers.push(`${prefix}_file_size_invalid`);
  }
  if (blockers.length) {
    return {
      blockers,
      path: absolutePath,
      file_sha256: null,
      value: null,
      byte_length: stat.size,
    };
  }

  let bytes;
  try {
    bytes = await fsp.readFile(absolutePath);
  } catch {
    return {
      blockers: [`${prefix}_file_unreadable`],
      path: absolutePath,
      file_sha256: null,
      value: null,
      byte_length: stat.size,
    };
  }
  const observedSha256 = sha256(bytes);
  if (observedSha256 !== expectedSha256) {
    blockers.push(`${prefix}_file_sha256_mismatch`);
  }
  let value = null;
  if (json) {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      blockers.push(`${prefix}_json_invalid`);
    }
  }
  return {
    blockers,
    path: absolutePath,
    file_sha256: observedSha256,
    value,
    byte_length: bytes.length,
  };
}

function storyIdentity(story) {
  const input = object(story);
  return {
    id: text(input.id || input.story_id),
    title: text(input.title),
    franchise: text(input.franchise),
    platform: text(input.platform),
    topic_key: text(input.topic_key),
    published_at: isoDate(input.published_at || input.timestamp),
    primary_source_url: text(input.primary_source_url),
    verification_status: "CONFIRMED",
  };
}

function validateStoryIdentity(story) {
  const blockers = [];
  for (const field of ["id", "title", "franchise", "platform", "topic_key"]) {
    if (!text(story[field])) blockers.push(`story_${field}_required`);
  }
  if (!story.published_at) blockers.push("story_published_at_required");
  if (!/^https:\/\//i.test(story.primary_source_url)) {
    blockers.push("story_primary_source_https_url_required");
  }
  return blockers;
}

function officialClaims(packet, primarySourceUrl, storyId) {
  const sourceById = new Map(
    array(packet.sources).map((source) => [text(source?.source_id), source]),
  );
  const claims = [];
  const blockers = [];
  for (const group of array(packet.confirmed_claims)) {
    const claimKey = text(group?.claim_key);
    if (!claimKey) {
      blockers.push("breaking_source_confirmed_claim_key_required");
      continue;
    }
    const evidence = array(group?.evidence).find((entry) => {
      const source = sourceById.get(text(entry?.source_id));
      return (
        source?.status === "CAPTURED" &&
        text(source?.source_class).toUpperCase() === "OFFICIAL_FIRST_PARTY" &&
        text(source?.final_url) === primarySourceUrl &&
        text(entry?.final_url) === primarySourceUrl
      );
    });
    const source = sourceById.get(text(evidence?.source_id));
    const quote = String(evidence?.text ?? "");
    const sourceClaim = array(source?.claims).find(
      (claim) =>
        text(claim?.claim_key) === claimKey &&
        String(claim?.text ?? "") === quote &&
        normaliseSha256(claim?.claim_sha256) ===
          normaliseSha256(evidence?.claim_sha256) &&
        normaliseSha256(claim?.claim_text_sha256) ===
          sha256(Buffer.from(quote, "utf8")),
    );
    if (!evidence || !sourceClaim || !quote.trim()) {
      blockers.push("breaking_source_official_claim_binding_invalid");
      continue;
    }
    claims.push({
      claim_id: `${storyId}-claim-${sha256(
        Buffer.from(
          `${claimKey}\0${sourceClaim.claim_sha256}\0${quote}`,
          "utf8",
        ),
      ).slice(0, 20)}`,
      text: quote,
      source_locator: `breaking-source-evidence:${claimKey}`,
      claim_key: claimKey,
      claim_sha256: text(sourceClaim.claim_sha256).toLowerCase(),
      claim_text_sha256: text(sourceClaim.claim_text_sha256).toLowerCase(),
    });
  }
  claims.sort(
    (left, right) =>
      left.claim_key.localeCompare(right.claim_key) ||
      left.claim_id.localeCompare(right.claim_id),
  );
  if (!claims.length) blockers.push("breaking_source_official_claims_required");
  return {
    blockers: unique(blockers),
    claims,
  };
}

async function assessBreakingSource({
  reference,
  story,
  baseDir,
  preparedAt,
}) {
  const observed = await observeFile({
    reference,
    prefix: "breaking_source_evidence",
    baseDir,
  });
  const blockers = [...observed.blockers];
  const packet = object(observed.value);
  const validation = validateBreakingSourceEvidencePacket(packet);
  blockers.push(...validation.blockers);
  const declaredCanonicalSha256 = normaliseSha256(
    object(reference).canonical_sha256 ||
      object(reference).packet_sha256 ||
      object(reference).source_evidence_sha256,
  );
  if (!declaredCanonicalSha256) {
    blockers.push("breaking_source_evidence_canonical_sha256_required");
  } else if (
    declaredCanonicalSha256 !== validation.packet_sha256 ||
    declaredCanonicalSha256 !== normaliseSha256(packet.packet_sha256)
  ) {
    blockers.push("breaking_source_evidence_canonical_sha256_mismatch");
  }
  if (text(packet.story_id) !== story.id) {
    blockers.push("breaking_source_evidence_story_id_mismatch");
  }
  if (
    packet.verification_status !== "CONFIRMED" ||
    packet.verified_for_planning !== true ||
    packet.verdict !== "OFFICIAL_CONFIRMED" ||
    packet.confirmation_basis !== "official_first_party"
  ) {
    blockers.push("breaking_source_evidence_official_confirmation_required");
  }
  const primarySourceUrl = text(packet.primary_source_url);
  if (
    !/^https:\/\//i.test(primarySourceUrl) ||
    primarySourceUrl !== story.primary_source_url
  ) {
    blockers.push("breaking_source_evidence_primary_url_mismatch");
  }
  const primarySource = array(packet.sources).find(
    (source) =>
      source?.status === "CAPTURED" &&
      text(source?.source_class).toUpperCase() === "OFFICIAL_FIRST_PARTY" &&
      text(source?.final_url) === primarySourceUrl,
  );
  if (!primarySource) {
    blockers.push("breaking_source_evidence_official_primary_source_required");
  }
  const canonicalBody = object(primarySource?.canonical_body);
  if (
    canonicalBody.algorithm !== "pulse-readable-body-v1" ||
    !normaliseSha256(canonicalBody.sha256)
  ) {
    blockers.push(
      "breaking_source_official_canonical_body_required",
    );
  }
  const exactClaims = officialClaims(packet, primarySourceUrl, story.id);
  blockers.push(...exactClaims.blockers);
  const uniqueBlockers = unique(blockers).sort();
  if (uniqueBlockers.length) {
    return {
      blockers: uniqueBlockers,
      observed,
      canonical_sha256: declaredCanonicalSha256,
      evidence: null,
    };
  }
  const base = {
    schema_version: WEEKLY_SOURCE_SCHEMA,
    story_id: story.id,
    source_url: primarySourceUrl,
    source_type: "official",
    publisher: text(
      primarySource.owner || primarySource.publisher || primarySource.source_id,
    ),
    published_at: story.published_at,
    claims: exactClaims.claims,
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: primarySourceUrl,
      source_id: text(primarySource.source_id),
      source_class: text(primarySource.source_class).toUpperCase(),
      canonical_body_algorithm: canonicalBody.algorithm,
      canonical_body_sha256: normaliseSha256(
        canonicalBody.sha256,
      ),
      claims: exactClaims.claims.map(
        ({ claim_key, text: claimText, claim_text_sha256 }) => ({
          claim_key,
          text: claimText,
          claim_text_sha256,
        }),
      ),
    },
    lineage: {
      schema_version: packet.schema_version,
      path: observed.path,
      file_sha256: observed.file_sha256,
      canonical_sha256: declaredCanonicalSha256,
      confirmation_basis: packet.confirmation_basis,
    },
    generated_at: preparedAt,
    safety: {
      exact_confirmed_claims_only: true,
      claims_synthesised: false,
      official_primary_source_only: true,
    },
  };
  return {
    blockers: [],
    observed,
    canonical_sha256: declaredCanonicalSha256,
    evidence: {
      ...base,
      evidence_sha256: hashObject(base),
    },
  };
}

function safeOwnedUrl(storyId, itemId) {
  return `pulse-owned://pulse-gaming/${encodeURIComponent(
    storyId,
  )}/${encodeURIComponent(itemId)}`;
}

function ownedAssetId(asset, index) {
  const explicit = text(asset.asset_id || asset.component_id || asset.item_id);
  if (explicit) return explicit;
  const role = text(asset.role)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${role || "owned-motion"}-${index + 1}`;
}

async function assessOwnedMotion({ reference, story, baseDir, preparedAt }) {
  const observed = await observeFile({
    reference,
    prefix: "owned_motion_manifest",
    baseDir,
  });
  const blockers = [...observed.blockers];
  const manifest = object(observed.value);
  if (manifest.schema_version !== OWNED_MOTION_SCHEMA) {
    blockers.push("owned_motion_manifest_schema_invalid");
  }
  if (text(manifest.story_id) !== story.id) {
    blockers.push("owned_motion_manifest_story_id_mismatch");
  }
  if (manifest?.combination?.third_party_media_used === true) {
    blockers.push("owned_motion_manifest_third_party_media_forbidden");
  }
  if (
    manifest.third_party_music === true ||
    manifest?.combination?.third_party_music === true
  ) {
    blockers.push("owned_motion_manifest_third_party_music_forbidden");
  }
  const manifestAssets = array(manifest.assets);
  if (manifestAssets.length < MINIMUM_ASSET_COUNT) {
    blockers.push("owned_motion_asset_inventory_too_thin");
  }

  const manifestDir = observed.path
    ? path.dirname(observed.path)
    : path.resolve(baseDir);
  const records = [];
  const seenIds = new Set();
  const seenPaths = new Set();
  for (let index = 0; index < manifestAssets.length; index += 1) {
    const asset = object(manifestAssets[index]);
    const itemId = ownedAssetId(asset, index);
    const assetPath = resolvedPath(asset.path, manifestDir);
    const assetSha256 = normaliseSha256(asset.sha256 || asset.asset_sha256);
    const assetPrefix = `owned_motion_asset_${index + 1}`;
    if (seenIds.has(itemId)) blockers.push("owned_motion_asset_id_duplicate");
    seenIds.add(itemId);
    if (assetPath && seenPaths.has(assetPath)) {
      blockers.push("owned_motion_asset_path_duplicate");
    }
    if (assetPath) seenPaths.add(assetPath);
    if (text(asset.ownership).toLowerCase() !== "owned") {
      blockers.push("owned_motion_asset_ownership_invalid");
    }
    if (text(asset.rights_basis).toUpperCase() !== "OWNED") {
      blockers.push("owned_motion_asset_rights_basis_invalid");
    }
    if (asset.attribution_required !== false) {
      blockers.push("owned_motion_asset_attribution_must_be_false");
    }
    if (asset?.provenance?.third_party_media_used !== false) {
      blockers.push("owned_motion_asset_third_party_media_declaration_required");
    }
    if (
      asset.third_party_music === true ||
      asset?.provenance?.third_party_music === true
    ) {
      blockers.push("owned_motion_asset_third_party_music_forbidden");
    }
    const mediaType = text(asset.media_type).toLowerCase();
    if (!["image", "video"].includes(mediaType)) {
      blockers.push("owned_motion_asset_media_type_invalid");
    }
    const motionFamily = text(asset.motion_family || asset.role);
    const usage = text(asset.usage || asset.role);
    if (!motionFamily) blockers.push("owned_motion_asset_motion_family_required");
    if (!usage) blockers.push("owned_motion_asset_usage_required");
    const declaredMotionSeconds = Number(
      asset.exact_subject_motion_seconds ??
        (mediaType === "video" ? asset.duration_seconds : 0),
    );
    if (
      !Number.isFinite(declaredMotionSeconds) ||
      declaredMotionSeconds < 0 ||
      (mediaType === "video" && declaredMotionSeconds <= 0)
    ) {
      blockers.push("owned_motion_asset_exact_motion_seconds_invalid");
    }
    const assetObserved = await observeFile({
      reference: {
        path: assetPath,
        file_sha256: assetSha256,
      },
      prefix: assetPrefix,
      baseDir: manifestDir,
      maximumBytes: MAXIMUM_ASSET_BYTES,
      json: false,
    });
    blockers.push(...assetObserved.blockers);
    if (
      assetObserved.blockers.length === 0 &&
      text(asset.ownership).toLowerCase() === "owned" &&
      text(asset.rights_basis).toUpperCase() === "OWNED" &&
      asset.attribution_required === false &&
      asset?.provenance?.third_party_media_used === false &&
      ["image", "video"].includes(mediaType) &&
      motionFamily &&
      usage &&
      Number.isFinite(declaredMotionSeconds) &&
      declaredMotionSeconds >= 0
    ) {
      records.push({
        item_id: itemId,
        source_url: safeOwnedUrl(story.id, itemId),
        local_path: assetObserved.path,
        asset_sha256: assetObserved.file_sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        owner: "Pulse Gaming",
        rights_evidence: {
          reference: observed.path,
          sha256: observed.file_sha256,
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
        usage,
        motion_family: motionFamily,
        exact_subject_motion_seconds: declaredMotionSeconds,
      });
    }
  }

  records.sort((left, right) => left.item_id.localeCompare(right.item_id));
  const motionFamilies = new Set(records.map((item) => item.motion_family));
  const exactSubjectMotionSeconds = records.reduce(
    (total, item) => total + item.exact_subject_motion_seconds,
    0,
  );
  if (records.length < MINIMUM_ASSET_COUNT) {
    blockers.push("owned_motion_materialised_asset_inventory_too_thin");
  }
  if (motionFamilies.size < MINIMUM_MOTION_FAMILIES) {
    blockers.push("owned_motion_family_diversity_too_low");
  }
  if (!(exactSubjectMotionSeconds > 0)) {
    blockers.push("owned_motion_exact_subject_motion_required");
  }
  const uniqueBlockers = unique(blockers).sort();
  if (uniqueBlockers.length) {
    return {
      blockers: uniqueBlockers,
      observed,
      ledger: null,
    };
  }

  const ledgerBase = {
    schema_version: RIGHTS_LEDGER_SCHEMA,
    story_id: story.id,
    generated_at: preparedAt,
    ledger_version: 1,
    decision: "CLEARED",
    items: records,
    media_plan: {
      exact_subject_motion_seconds: exactSubjectMotionSeconds,
      clip_count: records.length,
      distinct_motion_families: motionFamilies.size,
      unknown_reuploads: 0,
      third_party_music: false,
      third_party_media: false,
    },
    owned_motion_manifest: {
      path: observed.path,
      file_sha256: observed.file_sha256,
    },
    safety: {
      owned_motion_only: true,
      third_party_media_used: false,
      third_party_music_used: false,
      rights_synthesised: false,
    },
  };
  const ledgerSha256 = hashRightsLedger(ledgerBase);
  const ledger = {
    ...ledgerBase,
    ledger_sha256: ledgerSha256,
  };
  const assessment = assessRightsLedger(ledger, ledgerSha256);
  if (assessment.blockers.length) {
    return {
      blockers: assessment.blockers.map(
        (blocker) => `generated_${blocker}`,
      ),
      observed,
      ledger: null,
    };
  }
  return {
    blockers: [],
    observed,
    ledger,
  };
}

function advertiserInput(value) {
  const input = object(value);
  const hardStops = Array.isArray(input.hard_stops)
    ? input.hard_stops
    : (() => {
        try {
          const parsed = JSON.parse(String(input.hard_stops ?? ""));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      })();
  return {
    story_id: text(input.story_id),
    score: Number(input.advertiser_safety),
    maximum_score: Number(input.maximum_score ?? 5),
    hard_stops: hardStops,
    policy_version: text(input.policy_version || input.scorer_version),
    scored_at: isoDate(input.scored_at),
    decision: text(input.decision || input.verdict).toUpperCase(),
  };
}

async function assessAdvertiserSafety({
  input,
  reportReference,
  story,
  baseDir,
  preparedAt,
}) {
  let source = object(input);
  let sourceKind = "score_input";
  let sourceSha256 = null;
  let observed = null;
  const blockers = [];
  if (
    text(object(reportReference).path) ||
    text(
      object(reportReference).file_sha256 ||
        object(reportReference).sha256,
    )
  ) {
    observed = await observeFile({
      reference: reportReference,
      prefix: "advertiser_safety_input_report",
      baseDir,
    });
    blockers.push(...observed.blockers);
    source = object(observed.value);
    sourceKind = "report_file";
    sourceSha256 = observed.file_sha256;
    if (source.schema_version !== ADVERTISER_SAFETY_SCHEMA) {
      blockers.push("advertiser_safety_input_report_schema_invalid");
    }
  } else {
    sourceSha256 = hashObject(source);
  }
  const normalised = advertiserInput(source);
  if (normalised.story_id !== story.id) {
    blockers.push("advertiser_safety_story_id_mismatch");
  }
  if (
    normalised.score !== 5 ||
    normalised.maximum_score !== 5 ||
    (sourceKind === "report_file" &&
      !["SAFE", "GREEN"].includes(normalised.decision)) ||
    (sourceKind !== "report_file" &&
      normalised.decision &&
      !["SAFE", "GREEN"].includes(normalised.decision))
  ) {
    blockers.push("advertiser_safety_not_explicitly_green");
  }
  if (!normalised.hard_stops || normalised.hard_stops.length > 0) {
    blockers.push("advertiser_safety_hard_stops_not_clear");
  }
  if (!normalised.policy_version) {
    blockers.push("advertiser_safety_policy_version_required");
  }
  if (!normalised.scored_at) {
    blockers.push("advertiser_safety_scored_at_required");
  }
  const uniqueBlockers = unique(blockers).sort();
  if (uniqueBlockers.length) {
    return {
      blockers: uniqueBlockers,
      observed,
      report: null,
    };
  }
  const base = {
    schema_version: ADVERTISER_SAFETY_SCHEMA,
    story_id: story.id,
    decision: "SAFE",
    advertiser_safety: 5,
    maximum_score: 5,
    hard_stops: [],
    policy_version: normalised.policy_version,
    scored_at: normalised.scored_at,
    generated_at: preparedAt,
    source: {
      kind: sourceKind,
      file_sha256: sourceKind === "report_file" ? sourceSha256 : null,
      evidence_sha256: sourceSha256,
    },
  };
  return {
    blockers: [],
    observed,
    report: {
      ...base,
      report_sha256: hashObject(base),
    },
  };
}

function safety() {
  return {
    mode: MODE,
    local_proof: true,
    local_proof_only: true,
    claims_synthesised: false,
    rights_synthesised: false,
    third_party_media_included: false,
    third_party_music_included: false,
    network_used: false,
    database_mutated: false,
    oauth_mutated: false,
    platform_contacted: false,
    publish_authority_created: false,
    scheduler_authority_created: false,
    external_posting_authorised: false,
  };
}

async function verifyImmutableDirectory(outputRoot, files) {
  let entries;
  try {
    entries = await fsp.readdir(outputRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const expectedNames = [...files.keys()].sort();
  const observedNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  if (entries.length === 0) return false;
  if (
    entries.some((entry) => !entry.isFile()) ||
    JSON.stringify(observedNames) !== JSON.stringify(expectedNames)
  ) {
    throw new Error("governed_editorial_inventory_immutable_conflict");
  }
  for (const [name, expectedBytes] of files) {
    const observedBytes = await fsp.readFile(path.join(outputRoot, name));
    if (
      observedBytes.length !== expectedBytes.length ||
      !crypto.timingSafeEqual(observedBytes, expectedBytes)
    ) {
      throw new Error("governed_editorial_inventory_immutable_conflict");
    }
  }
  return true;
}

async function materializeImmutableDirectory(outputRoot, files) {
  const parent = path.dirname(outputRoot);
  await fsp.mkdir(parent, { recursive: true });
  if (await verifyImmutableDirectory(outputRoot, files)) return;
  const stagingRoot = `${outputRoot}.staging-${process.pid}-${crypto.randomUUID()}`;
  await fsp.mkdir(stagingRoot, { recursive: false });
  try {
    for (const [name, bytes] of files) {
      const handle = await fsp.open(path.join(stagingRoot, name), "wx");
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    try {
      await fsp.rmdir(outputRoot);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        if (
          ["ENOTEMPTY", "EEXIST", "EPERM"].includes(error?.code) &&
          (await verifyImmutableDirectory(outputRoot, files))
        ) {
          return;
        }
        throw error;
      }
    }
    try {
      await fsp.rename(stagingRoot, outputRoot);
    } catch (error) {
      if (!["EEXIST", "EPERM", "ENOTEMPTY"].includes(error?.code)) {
        throw error;
      }
      await verifyImmutableDirectory(outputRoot, files);
    }
    await verifyImmutableDirectory(outputRoot, files);
  } finally {
    await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Prepare immutable, read-only evidence bindings for autonomous editorial
 * discovery. This function observes local files only and creates no rendering,
 * scheduling, database, OAuth, network or publication authority.
 */
async function prepareGovernedEditorialInventory({
  story: storyInput = {},
  breaking_source_evidence: breakingSourceEvidence,
  owned_motion_manifest: ownedMotionManifest,
  advertiser_safety: advertiserSafety,
  advertiser_safety_report: advertiserSafetyReport,
  output_dir: outputDir,
  root_dir: rootDir = process.cwd(),
  now,
} = {}) {
  if (!text(outputDir)) {
    throw new Error("governed_editorial_inventory_output_dir_required");
  }
  const outputRoot = path.resolve(outputDir);
  const baseDir = path.resolve(rootDir);
  const story = storyIdentity(storyInput);
  const preparedAt =
    isoDate(now) || story.published_at || "1970-01-01T00:00:00.000Z";
  const storyBlockers = validateStoryIdentity(story);
  const [source, motion, advertiser] = await Promise.all([
    assessBreakingSource({
      reference: breakingSourceEvidence,
      story,
      baseDir,
      preparedAt,
    }),
    assessOwnedMotion({
      reference: ownedMotionManifest,
      story,
      baseDir,
      preparedAt,
    }),
    assessAdvertiserSafety({
      input: advertiserSafety,
      reportReference: advertiserSafetyReport,
      story,
      baseDir,
      preparedAt,
    }),
  ]);
  const blockers = unique([
    ...storyBlockers,
    ...source.blockers,
    ...motion.blockers,
    ...advertiser.blockers,
  ]).sort();

  const paths = {
    weekly_source_evidence: source.evidence
      ? path.join(outputRoot, "weekly-source-evidence.json")
      : null,
    rights_ledger: motion.ledger
      ? path.join(outputRoot, "rights-ledger.json")
      : null,
    advertiser_safety_report: advertiser.report
      ? path.join(outputRoot, "advertiser-safety-report.json")
      : null,
    registry: path.join(outputRoot, "governed-editorial-inventory.json"),
  };
  const artifactBytes = new Map();
  const weeklyBytes = source.evidence ? jsonBytes(source.evidence) : null;
  const rightsBytes = motion.ledger ? jsonBytes(motion.ledger) : null;
  const advertiserBytes = advertiser.report
    ? jsonBytes(advertiser.report)
    : null;
  if (weeklyBytes) {
    artifactBytes.set(path.basename(paths.weekly_source_evidence), weeklyBytes);
  }
  if (rightsBytes) {
    artifactBytes.set(path.basename(paths.rights_ledger), rightsBytes);
  }
  if (advertiserBytes) {
    artifactBytes.set(
      path.basename(paths.advertiser_safety_report),
      advertiserBytes,
    );
  }
  const ready =
    blockers.length === 0 &&
    Boolean(weeklyBytes && rightsBytes && advertiserBytes);
  const registryBase = {
    schema_version: SCHEMA_VERSION,
    generated_at: preparedAt,
    story,
    breaking_source_evidence: {
      path: source.observed.path,
      file_sha256: source.observed.file_sha256,
      canonical_sha256: source.canonical_sha256,
    },
    weekly_source_evidence: {
      path: paths.weekly_source_evidence,
      file_sha256: weeklyBytes ? sha256(weeklyBytes) : null,
    },
    rights_ledger: {
      path: paths.rights_ledger,
      file_sha256: rightsBytes ? sha256(rightsBytes) : null,
      canonical_sha256: motion.ledger?.ledger_sha256 || null,
    },
    owned_motion_manifest: {
      path: motion.observed.path,
      file_sha256: motion.observed.file_sha256,
    },
    advertiser_safety_report: {
      path: paths.advertiser_safety_report,
      file_sha256: advertiserBytes ? sha256(advertiserBytes) : null,
    },
    verdict: ready ? "READY" : "HOLD",
    blockers: ready
      ? []
      : unique([
          ...blockers,
          ...(!weeklyBytes ? ["weekly_source_evidence_not_materialised"] : []),
          ...(!rightsBytes ? ["rights_ledger_not_materialised"] : []),
          ...(!advertiserBytes
            ? ["advertiser_safety_report_not_materialised"]
            : []),
        ]).sort(),
    safety: safety(),
  };
  const registry = {
    ...registryBase,
    inventory_sha256: hashObject(registryBase),
  };
  artifactBytes.set(path.basename(paths.registry), jsonBytes(registry));
  await materializeImmutableDirectory(outputRoot, artifactBytes);

  return {
    registry,
    weekly_source_evidence: source.evidence,
    rights_ledger: motion.ledger,
    advertiser_safety_report: advertiser.report,
    paths,
    safety: safety(),
  };
}

module.exports = {
  ADVERTISER_SAFETY_SCHEMA,
  MINIMUM_ASSET_COUNT,
  MINIMUM_MOTION_FAMILIES,
  MODE,
  OWNED_MOTION_SCHEMA,
  RIGHTS_LEDGER_SCHEMA,
  SCHEMA_VERSION,
  WEEKLY_SOURCE_SCHEMA,
  prepareGovernedEditorialInventory,
};
