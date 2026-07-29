"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const GAME_MEDIA_ADMISSION_SCHEMA =
  "pulse-governed-game-media-admission-v1";
const SOURCE_EVIDENCE_SCHEMA =
  "pulse-governed-game-media-source-evidence-v1";
const PERMISSION_EVIDENCE_SCHEMA =
  "pulse-governed-game-media-permission-evidence-v1";
const TRANSFORMATION_EVIDENCE_SCHEMA =
  "pulse-governed-game-media-transformation-evidence-v1";
const POLICY = "GOVERNED_GAME_MEDIA_V1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TIMESTAMP_SKEW_MS = 60_000;

const OFFICIAL_MEDIA_KINDS = new Set([
  "OFFICIAL_SCREENSHOT",
  "OFFICIAL_TRAILER_SEGMENT",
  "OFFICIAL_PRESS_ASSET",
]);
const OFFICIAL_RIGHTS_BASES = new Set([
  "EXPLICIT_LICENCE",
  "PRESS_KIT_TERMS",
  "PLATFORM_PROMOTIONAL_TERMS",
]);
const STEAM_EDITORIAL_RISK_BASIS =
  "TRANSFORMATIVE_EDITORIAL_USE";
const MAX_STEAM_EDITORIAL_EXCERPT_SECONDS = 8;
const EDITORIAL_ROLES = new Set([
  "GAMEPLAY_HERO",
  "GAMEPLAY_DETAIL",
  "CHARACTER_REVEAL",
  "WORLD_ESTABLISHER",
  "FEATURE_PROOF",
  "PLATFORM_CARD",
  "EDITORIAL_CUTAWAY",
]);
const MATERIAL_TRANSFORMATIONS = new Set([
  "CROP",
  "CUT",
  "COLOUR_GRADE",
  "DIAGRAM_OVERLAY",
  "KEN_BURNS",
  "MASK",
  "MOTION",
  "REFRAME",
  "SPEED_RAMP",
  "TEXT_OVERLAY",
]);

class GovernedGameMediaAdmissionError extends Error {
  constructor(
    codes,
    message = "governed_game_media_admission_validation_failed",
  ) {
    const normalised = [
      ...new Set(
        (Array.isArray(codes) ? codes : [codes])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ];
    super(`${message}: ${normalised.join(", ")}`);
    this.name = "GovernedGameMediaAdmissionError";
    this.codes = normalised;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cleanHash(value) {
  return text(value).replace(/^sha256:/i, "").toLowerCase();
}

function assertHash(value, code) {
  const hash = cleanHash(value);
  if (!SHA256_PATTERN.test(hash)) {
    throw new GovernedGameMediaAdmissionError(code);
  }
  return hash;
}

function readRegularFile(filePath, prefix) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new GovernedGameMediaAdmissionError(`${prefix}_file_missing`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new GovernedGameMediaAdmissionError(`${prefix}_file_invalid`);
  }
  const bytes = fs.readFileSync(filePath);
  if (!bytes.length) {
    throw new GovernedGameMediaAdmissionError(`${prefix}_file_empty`);
  }
  return {
    path: filePath,
    sha256: sha256(bytes),
    size_bytes: bytes.length,
    bytes,
  };
}

function resolveBoundPath(root, declaredPath, prefix) {
  const declared = text(declaredPath);
  if (!declared || path.isAbsolute(declared) || declared.includes("\0")) {
    throw new GovernedGameMediaAdmissionError(`${prefix}_path_invalid`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, declared);
  const relative = path.relative(resolvedRoot, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new GovernedGameMediaAdmissionError(`${prefix}_path_escape`);
  }
  if (fs.existsSync(resolved)) {
    const canonicalRoot = fs.realpathSync.native(resolvedRoot);
    const canonicalTarget = fs.realpathSync.native(resolved);
    const canonicalRelative = path.relative(
      canonicalRoot,
      canonicalTarget,
    );
    if (
      !canonicalRelative ||
      canonicalRelative === ".." ||
      canonicalRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(canonicalRelative)
    ) {
      throw new GovernedGameMediaAdmissionError(
        `${prefix}_path_escape`,
      );
    }
  }
  return resolved;
}

function readHashBoundFile({
  root,
  record,
  prefix,
  json = false,
}) {
  const expected = assertHash(
    record?.sha256,
    `${prefix}_sha256_invalid`,
  );
  const file = readRegularFile(
    resolveBoundPath(root, record?.path, prefix),
    prefix,
  );
  if (file.sha256 !== expected) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_sha256_mismatch`,
    );
  }
  if (!json) return file;
  try {
    return {
      ...file,
      value: JSON.parse(file.bytes.toString("utf8")),
    };
  } catch {
    throw new GovernedGameMediaAdmissionError(`${prefix}_json_invalid`);
  }
}

function assertHttps(value, code) {
  try {
    const parsed = new URL(text(value));
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("invalid");
    }
    return parsed.href;
  } catch {
    throw new GovernedGameMediaAdmissionError(code);
  }
}

function assertEvidenceTimestamp(value, boundaryMs, code) {
  const timestamp = Date.parse(text(value));
  if (
    !Number.isFinite(timestamp) ||
    timestamp > boundaryMs + TIMESTAMP_SKEW_MS
  ) {
    throw new GovernedGameMediaAdmissionError(code);
  }
  return new Date(timestamp).toISOString();
}

function exactUpperSet(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => text(item).toUpperCase())
        .filter(Boolean),
    ),
  ].sort();
}

function validateSteamStorefrontSource({
  sourceEvidence,
  mediaKind,
  prefix,
}) {
  const appId = text(sourceEvidence?.steam_app_id);
  if (!/^[1-9][0-9]{0,11}$/.test(appId)) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_steam_app_id_invalid`,
    );
  }
  let page;
  let media;
  try {
    page = new URL(text(sourceEvidence?.page_url));
    media = new URL(text(sourceEvidence?.direct_media_url));
  } catch {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_steam_source_url_invalid`,
    );
  }
  if (
    page.protocol !== "https:" ||
    page.hostname.toLowerCase() !== "store.steampowered.com" ||
    page.username ||
    page.password ||
    page.port ||
    !new RegExp(
      `^/app/${appId}/(?:[A-Za-z0-9_%~-]+/)?$`,
    ).test(page.pathname)
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_steam_store_page_mismatch`,
    );
  }
  const host = media.hostname.toLowerCase();
  const pathName = media.pathname;
  const screenshotHosts = new Set([
    "cdn.akamai.steamstatic.com",
    "shared.akamai.steamstatic.com",
    "shared.fastly.steamstatic.com",
  ]);
  const trailerHosts = new Set([
    "video.akamai.steamstatic.com",
    "video.fastly.steamstatic.com",
    "video.steamstatic.com",
  ]);
  const screenshotPathMatches =
    pathName.startsWith(
      `/store_item_assets/steam/apps/${appId}/`,
    ) || pathName.startsWith(`/steam/apps/${appId}/`);
  const trailerPathMatches = pathName.startsWith(
    `/store_trailers/${appId}/`,
  );
  const valid =
    media.protocol === "https:" &&
    !media.username &&
    !media.password &&
    !media.port &&
    !media.hash &&
    ((mediaKind === "OFFICIAL_SCREENSHOT" &&
      screenshotHosts.has(host) &&
      screenshotPathMatches) ||
      (mediaKind === "OFFICIAL_TRAILER_SEGMENT" &&
        trailerHosts.has(host) &&
        trailerPathMatches));
  if (!valid) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_steam_direct_media_mismatch`,
    );
  }
  return {
    app_id: appId,
    page_url: page.href,
    direct_media_url: media.href,
  };
}

function validateXboxWireSource({
  sourceEvidence,
  mediaKind,
  prefix,
}) {
  if (
    !["OFFICIAL_PRESS_ASSET", "OFFICIAL_SCREENSHOT"].includes(
      mediaKind,
    )
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_xbox_media_kind_invalid`,
    );
  }
  let page;
  let media;
  try {
    page = new URL(text(sourceEvidence?.page_url));
    media = new URL(text(sourceEvidence?.direct_media_url));
  } catch {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_xbox_source_url_invalid`,
    );
  }
  if (
    page.protocol !== "https:" ||
    page.hostname.toLowerCase() !== "news.xbox.com" ||
    page.username ||
    page.password ||
    page.port ||
    page.hash ||
    !/^\/en-us\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/[a-z0-9-]+\/$/i.test(
      page.pathname,
    )
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_xbox_story_page_invalid`,
    );
  }
  const host = media.hostname.toLowerCase();
  const mediaPath = media.pathname;
  const directMediaAllowed =
    media.protocol === "https:" &&
    !media.username &&
    !media.password &&
    !media.port &&
    !media.hash &&
    ((host === "xboxwire.thesourcemediaassets.com" &&
      mediaPath.startsWith("/sites/2/")) ||
      (host === "cms-assets.xboxservices.com" &&
        mediaPath.startsWith("/assets/")));
  if (!directMediaAllowed) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_xbox_direct_media_mismatch`,
    );
  }
  return {
    page_url: page.href,
    direct_media_url: media.href,
  };
}

function validateSteamEditorialRiskReview({
  permissionEvidence,
  requiredDestinations,
  boundaryMs,
  prefix,
}) {
  const risk = permissionEvidence?.operator_risk_decision;
  if (
    !risk ||
    typeof risk !== "object" ||
    Array.isArray(risk) ||
    permissionEvidence?.decision !== "ADMITTED" ||
    permissionEvidence?.review_status !== "HUMAN_REVIEW" ||
    text(permissionEvidence?.rights_basis).toUpperCase() !==
      STEAM_EDITORIAL_RISK_BASIS ||
    text(permissionEvidence?.evidence_url) ||
    permissionEvidence?.permission_rule_id !==
      "steam_storefront_transformative_editorial_risk_review" ||
    permissionEvidence?.source_platform !== "STEAM"
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_steam_human_risk_review_invalid`,
    );
  }
  const reviewedAt = assertEvidenceTimestamp(
    permissionEvidence?.reviewed_at,
    boundaryMs,
    `${prefix}_permission_reviewed_at_invalid`,
  );
  const riskReviewedAt = assertEvidenceTimestamp(
    risk?.reviewed_at,
    boundaryMs,
    `${prefix}_steam_human_risk_reviewed_at_invalid`,
  );
  const destinations = exactUpperSet(risk?.destinations);
  const reviewedBy = text(permissionEvidence?.reviewed_by);
  const riskReviewedBy = text(risk?.reviewed_by);
  if (
    risk?.decision_type !== "HUMAN_REVIEW" ||
    risk?.decision !== "ACCEPT_RISK" ||
    text(risk?.story_id) !== text(permissionEvidence?.story_id) ||
    text(risk?.asset_id) !== text(permissionEvidence?.asset_id) ||
    stableUpperSet(destinations) !==
    stableUpperSet(requiredDestinations) ||
    text(risk?.use).toUpperCase() !==
      "TRANSFORMATIVE_EDITORIAL" ||
    text(risk?.rationale).length < 40 ||
    !reviewedBy ||
    riskReviewedBy !== reviewedBy ||
    riskReviewedAt !== reviewedAt ||
    risk?.automatic_clearance !== false ||
    risk?.attribution_is_permission !== false ||
    risk?.fair_use_guaranteed !== false ||
    risk?.source_page_is_licence !== false
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_steam_human_risk_review_invalid`,
    );
  }
  return {
    decision_type: "HUMAN_REVIEW",
    decision: "ACCEPT_RISK",
    story_id: text(risk.story_id),
    asset_id: text(risk.asset_id),
    destinations,
    use: "TRANSFORMATIVE_EDITORIAL",
    rationale: text(risk.rationale),
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt,
    automatic_clearance: false,
    attribution_is_permission: false,
    fair_use_guaranteed: false,
    source_page_is_licence: false,
  };
}

function stableUpperSet(value) {
  return JSON.stringify(exactUpperSet(value));
}

function validateOfficialAsset({
  asset,
  sourceEvidence,
  permissionEvidence,
  requiredDestinations,
  boundaryMs,
  primarySourceUrl,
  prefix,
}) {
  const mediaKind = text(asset?.media_kind).toUpperCase();
  if (!OFFICIAL_MEDIA_KINDS.has(mediaKind)) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_media_kind_invalid`,
    );
  }
  const sourceClass = text(
    sourceEvidence?.source_class,
  ).toUpperCase();
  if (
    ![
      "OFFICIAL_PUBLISHER_ASSET",
      "OFFICIAL_STEAM_STOREFRONT_ASSET",
      "OFFICIAL_XBOX_WIRE_ASSET",
    ].includes(sourceClass)
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_unsupported_source_class`,
    );
  }
  if (
    text(sourceEvidence?.media_kind).toUpperCase() !== mediaKind
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_official_source_evidence_invalid`,
    );
  }
  const gameTitle = text(sourceEvidence?.game?.title);
  const gamePublisher = text(sourceEvidence?.game?.publisher);
  const sourcePublisher = text(sourceEvidence?.publisher);
  if (
    !gameTitle ||
    !gamePublisher ||
    !sourcePublisher ||
    sourceEvidence?.official_domain_reviewed !== true
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_official_source_identity_invalid`,
    );
  }
  assertHttps(
    sourceEvidence?.page_url,
    `${prefix}_official_page_url_invalid`,
  );
  assertHttps(
    sourceEvidence?.direct_media_url,
    `${prefix}_official_direct_media_url_invalid`,
  );
  const boundPrimarySourceUrl = assertHttps(
    primarySourceUrl,
    `${prefix}_primary_source_url_invalid`,
  );
  const evidenceStorySourceUrl = assertHttps(
    sourceEvidence?.story_source_url,
    `${prefix}_story_source_url_invalid`,
  );
  if (evidenceStorySourceUrl !== boundPrimarySourceUrl) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_story_source_binding_mismatch`,
    );
  }
  const steamSource =
    sourceClass === "OFFICIAL_STEAM_STOREFRONT_ASSET"
      ? validateSteamStorefrontSource({
          sourceEvidence,
          mediaKind,
          prefix,
        })
      : null;
  const xboxSource =
    sourceClass === "OFFICIAL_XBOX_WIRE_ASSET"
      ? validateXboxWireSource({
          sourceEvidence,
          mediaKind,
          prefix,
        })
      : null;
  assertEvidenceTimestamp(
    sourceEvidence?.recorded_at,
    boundaryMs,
    `${prefix}_source_recorded_at_invalid`,
  );

  const rightsBasis = text(
    permissionEvidence?.rights_basis,
  ).toUpperCase();
  if (
    permissionEvidence?.attribution_is_permission !== false ||
    rightsBasis === "ATTRIBUTION_ONLY"
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_attribution_cannot_grant_permission`,
    );
  }
  const steamRiskDecision = steamSource
    ? validateSteamEditorialRiskReview({
        permissionEvidence,
        requiredDestinations,
        boundaryMs,
        prefix,
      })
    : null;
  if (
    permissionEvidence?.decision !== "ADMITTED" ||
    (steamSource
      ? permissionEvidence?.review_status !== "HUMAN_REVIEW" ||
        rightsBasis !== STEAM_EDITORIAL_RISK_BASIS
      : permissionEvidence?.review_status !== "ACCEPTED" ||
        !OFFICIAL_RIGHTS_BASES.has(rightsBasis)) ||
    text(permissionEvidence?.rights_holder) !== sourcePublisher ||
    !text(permissionEvidence?.reviewed_by)
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_permission_evidence_invalid`,
    );
  }
  if (!steamSource) {
    assertHttps(
      permissionEvidence?.evidence_url,
      `${prefix}_permission_evidence_url_invalid`,
    );
    assertEvidenceTimestamp(
      permissionEvidence?.reviewed_at,
      boundaryMs,
      `${prefix}_permission_reviewed_at_invalid`,
    );
  }
  const coveredKinds = exactUpperSet(
    permissionEvidence?.coverage?.media_kinds,
  );
  const coveredDestinations = exactUpperSet(
    permissionEvidence?.coverage?.destinations,
  );
  const coveredUses = exactUpperSet(
    permissionEvidence?.coverage?.uses,
  );
  if (
    !coveredKinds.includes(mediaKind) ||
    !requiredDestinations.every((destination) =>
      coveredDestinations.includes(destination),
    ) ||
    !coveredUses.includes("TRANSFORMATIVE_EDITORIAL")
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_permission_scope_insufficient`,
    );
  }
  if (
    xboxSource &&
    (rightsBasis !== "PRESS_KIT_TERMS" ||
      permissionEvidence?.source_platform !== "XBOX_WIRE" ||
      permissionEvidence?.permission_rule_id !==
        "xbox_wire_first_party_article_editorial_use" ||
      text(permissionEvidence?.evidence_url) !==
        xboxSource.page_url)
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_xbox_permission_evidence_invalid`,
    );
  }
  return {
    game: {
      title: gameTitle,
      publisher: gamePublisher,
    },
    rights_basis: rightsBasis,
    risk_decision: steamRiskDecision,
  };
}

function validateOwnedCapture({
  sourceEvidence,
  permissionEvidence,
  requiredDestinations,
  boundaryMs,
  prefix,
}) {
  if (
    text(sourceEvidence?.source_class).toUpperCase() !==
      "USER_OWNED_CAPTURE" ||
    text(sourceEvidence?.media_kind).toUpperCase() !==
      "USER_OWNED_CAPTURE"
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_owned_capture_source_evidence_invalid`,
    );
  }
  const gameTitle = text(sourceEvidence?.game?.title);
  const gamePublisher = text(sourceEvidence?.game?.publisher);
  const captureOwner = text(sourceEvidence?.capture_owner);
  if (
    !gameTitle ||
    !gamePublisher ||
    !captureOwner ||
    !text(sourceEvidence?.captured_by)
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_owned_capture_identity_invalid`,
    );
  }
  assertEvidenceTimestamp(
    sourceEvidence?.captured_at,
    boundaryMs,
    `${prefix}_captured_at_invalid`,
  );
  if (permissionEvidence?.attribution_is_permission !== false) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_attribution_cannot_grant_permission`,
    );
  }
  if (
    permissionEvidence?.decision !== "ADMITTED" ||
    permissionEvidence?.review_status !== "ACCEPTED" ||
    text(permissionEvidence?.rights_basis).toUpperCase() !==
      "OWNED_CAPTURE" ||
    permissionEvidence?.ownership_attested !== true ||
    text(permissionEvidence?.capture_owner) !== captureOwner ||
    text(permissionEvidence?.rights_holder) !== captureOwner ||
    !text(permissionEvidence?.reviewed_by) ||
    text(permissionEvidence?.evidence_url)
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_owned_capture_permission_invalid`,
    );
  }
  assertEvidenceTimestamp(
    permissionEvidence?.reviewed_at,
    boundaryMs,
    `${prefix}_permission_reviewed_at_invalid`,
  );
  const coveredKinds = exactUpperSet(
    permissionEvidence?.coverage?.media_kinds,
  );
  const coveredDestinations = exactUpperSet(
    permissionEvidence?.coverage?.destinations,
  );
  const coveredUses = exactUpperSet(
    permissionEvidence?.coverage?.uses,
  );
  if (
    !coveredKinds.includes("USER_OWNED_CAPTURE") ||
    !requiredDestinations.every((destination) =>
      coveredDestinations.includes(destination),
    ) ||
    !coveredUses.includes("TRANSFORMATIVE_EDITORIAL")
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_permission_scope_insufficient`,
    );
  }
  return {
    game: {
      title: gameTitle,
      publisher: gamePublisher,
    },
    rights_basis: "OWNED_CAPTURE",
  };
}

function validateAttribution(permissionEvidence, prefix) {
  const attribution = permissionEvidence?.attribution;
  if (attribution?.required === false) {
    if (text(attribution?.text) || exactUpperSet(attribution?.delivery).length) {
      throw new GovernedGameMediaAdmissionError(
        `${prefix}_attribution_invalid`,
      );
    }
    return null;
  }
  const attributionText = text(attribution?.text);
  const delivery = exactUpperSet(attribution?.delivery);
  if (
    attribution?.required !== true ||
    !attributionText ||
    !delivery.length
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_attribution_invalid`,
    );
  }
  return {
    text: attributionText,
    delivery,
  };
}

function validateTransformation({
  evidence,
  sourceAssetSha256,
  permissionEvidenceSha256,
  materialisedAssetSha256,
  mediaType,
  boundaryMs,
  prefix,
}) {
  if (
    evidence?.schema_version !== TRANSFORMATION_EVIDENCE_SCHEMA ||
    text(evidence?.purpose).toUpperCase() !==
      "TRANSFORMATIVE_EDITORIAL" ||
    cleanHash(evidence?.source_asset_sha256) !== sourceAssetSha256 ||
    cleanHash(evidence?.permission_evidence_sha256) !==
      permissionEvidenceSha256 ||
    cleanHash(evidence?.materialised_asset_sha256) !==
      materialisedAssetSha256
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_transformation_binding_invalid`,
    );
  }
  const operations = exactUpperSet(evidence?.operations);
  if (
    !operations.length ||
    !operations.some((operation) =>
      MATERIAL_TRANSFORMATIONS.has(operation),
    )
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_material_transformation_required`,
    );
  }
  const disposition = text(
    evidence?.source_audio_disposition,
  ).toUpperCase();
  if (
    (mediaType === "VIDEO" &&
      !["MUTED", "REMOVED"].includes(disposition)) ||
    (mediaType === "IMAGE" && disposition !== "NOT_APPLICABLE")
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_source_audio_disposition_invalid`,
    );
  }
  const usage = evidence?.usage_seconds;
  if (
    !Array.isArray(usage) ||
    usage.length !== 2 ||
    !usage.every(Number.isFinite) ||
    usage[0] < 0 ||
    usage[1] <= usage[0]
  ) {
    throw new GovernedGameMediaAdmissionError(
      `${prefix}_usage_seconds_invalid`,
    );
  }
  assertEvidenceTimestamp(
    evidence?.created_at,
    boundaryMs,
    `${prefix}_transformation_created_at_invalid`,
  );
  return {
    operations,
    purpose: "TRANSFORMATIVE_EDITORIAL",
    source_audio_disposition: disposition,
    usage_seconds: [...usage],
  };
}

function validateGovernedGameMediaAdmission({
  manifestPath,
  expectedManifestSha256,
  expectedStoryId,
  requiredDestinations = ["YOUTUBE_SHORTS"],
  validationBoundaryAt,
} = {}) {
  const requestedBoundaryMs = Date.parse(text(validationBoundaryAt));
  if (!Number.isFinite(requestedBoundaryMs)) {
    throw new GovernedGameMediaAdmissionError(
      "game_media_validation_boundary_invalid",
    );
  }
  const validationNowMs = Date.now();
  if (
    !Number.isFinite(validationNowMs) ||
    requestedBoundaryMs > validationNowMs + TIMESTAMP_SKEW_MS
  ) {
    throw new GovernedGameMediaAdmissionError(
      "game_media_validation_boundary_in_future",
    );
  }
  const boundaryMs = Math.min(
    requestedBoundaryMs,
    validationNowMs,
  );
  const resolvedManifestPath = path.resolve(text(manifestPath));
  const manifestFile = readRegularFile(
    resolvedManifestPath,
    "game_media_manifest",
  );
  const expectedHash = assertHash(
    expectedManifestSha256,
    "game_media_manifest_sha256_invalid",
  );
  if (manifestFile.sha256 !== expectedHash) {
    throw new GovernedGameMediaAdmissionError(
      "game_media_manifest_sha256_mismatch",
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.bytes.toString("utf8"));
  } catch {
    throw new GovernedGameMediaAdmissionError(
      "game_media_manifest_json_invalid",
    );
  }
  const storyId = text(expectedStoryId);
  if (
    manifest?.schema_version !== GAME_MEDIA_ADMISSION_SCHEMA ||
    manifest?.policy !== POLICY ||
    !storyId ||
    text(manifest?.story_id) !== storyId
  ) {
    throw new GovernedGameMediaAdmissionError(
      "game_media_manifest_identity_invalid",
    );
  }
  assertEvidenceTimestamp(
    manifest?.generated_at,
    boundaryMs,
    "game_media_manifest_generated_at_invalid",
  );
  const destinations = exactUpperSet(requiredDestinations);
  if (!destinations.length) {
    throw new GovernedGameMediaAdmissionError(
      "game_media_required_destinations_invalid",
    );
  }
  if (!Array.isArray(manifest?.assets) || !manifest.assets.length) {
    throw new GovernedGameMediaAdmissionError(
      "game_media_assets_required",
    );
  }
  const root = path.dirname(resolvedManifestPath);
  const seenAssetIds = new Set();
  const admitted = manifest.assets.map((asset, index) => {
    const prefix = `game_media_asset_${index}`;
    const assetId = text(asset?.asset_id);
    if (
      !/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(assetId) ||
      seenAssetIds.has(assetId)
    ) {
      throw new GovernedGameMediaAdmissionError(
        seenAssetIds.has(assetId)
          ? "game_media_asset_id_duplicate"
          : `${prefix}_asset_id_invalid`,
      );
    }
    seenAssetIds.add(assetId);
    if (
      text(asset?.editorial_role).toUpperCase() === "" ||
      !EDITORIAL_ROLES.has(
        text(asset?.editorial_role).toUpperCase(),
      )
    ) {
      throw new GovernedGameMediaAdmissionError(
        `${prefix}_editorial_role_invalid`,
      );
    }
    const mediaType = text(asset?.media_type).toUpperCase();
    if (!["IMAGE", "VIDEO"].includes(mediaType)) {
      throw new GovernedGameMediaAdmissionError(
        `${prefix}_media_type_invalid`,
      );
    }
    const sourceAsset = readHashBoundFile({
      root,
      record: {
        path: asset?.source?.asset_path,
        sha256: asset?.source?.asset_sha256,
      },
      prefix: `${prefix}_source_asset`,
    });
    const materialised = readHashBoundFile({
      root,
      record: asset?.materialised,
      prefix: `${prefix}_materialised_asset`,
    });
    if (sourceAsset.sha256 === materialised.sha256) {
      throw new GovernedGameMediaAdmissionError(
        `${prefix}_materialised_asset_untransformed`,
      );
    }
    const sourceEvidenceFile = readHashBoundFile({
      root,
      record: {
        path: asset?.source?.evidence_path,
        sha256: asset?.source?.evidence_sha256,
      },
      prefix: `${prefix}_source_evidence`,
      json: true,
    });
    const permissionEvidenceFile = readHashBoundFile({
      root,
      record: {
        path: asset?.permission?.evidence_path,
        sha256: asset?.permission?.evidence_sha256,
      },
      prefix: `${prefix}_permission_evidence`,
      json: true,
    });
    const transformationEvidenceFile = readHashBoundFile({
      root,
      record: {
        path: asset?.transformation?.evidence_path,
        sha256: asset?.transformation?.evidence_sha256,
      },
      prefix: `${prefix}_transformation_evidence`,
      json: true,
    });
    const sourceEvidence = sourceEvidenceFile.value;
    const permissionEvidence = permissionEvidenceFile.value;
    for (const [label, evidence] of [
      ["source", sourceEvidence],
      ["permission", permissionEvidence],
      ["transformation", transformationEvidenceFile.value],
    ]) {
      if (
        text(evidence?.story_id) !== storyId ||
        text(evidence?.asset_id) !== assetId
      ) {
        throw new GovernedGameMediaAdmissionError(
          `${prefix}_${label}_evidence_identity_invalid`,
        );
      }
    }
    if (sourceEvidence?.schema_version !== SOURCE_EVIDENCE_SCHEMA) {
      throw new GovernedGameMediaAdmissionError(
        `${prefix}_source_evidence_schema_invalid`,
      );
    }
    if (
      permissionEvidence?.schema_version !==
      PERMISSION_EVIDENCE_SCHEMA
    ) {
      throw new GovernedGameMediaAdmissionError(
        `${prefix}_permission_evidence_schema_invalid`,
      );
    }
    if (
      cleanHash(sourceEvidence?.source_asset_sha256) !==
      sourceAsset.sha256
    ) {
      throw new GovernedGameMediaAdmissionError(
        `${prefix}_source_asset_binding_invalid`,
      );
    }
    const rights =
      text(asset?.media_kind).toUpperCase() ===
      "USER_OWNED_CAPTURE"
        ? validateOwnedCapture({
            sourceEvidence,
            permissionEvidence,
            requiredDestinations: destinations,
            boundaryMs,
            prefix,
          })
        : validateOfficialAsset({
            asset,
            sourceEvidence,
            permissionEvidence,
            requiredDestinations: destinations,
            boundaryMs,
            primarySourceUrl: manifest?.primary_source_url,
            prefix,
          });
    const attribution = validateAttribution(
      permissionEvidence,
      prefix,
    );
    const transformation = validateTransformation({
      evidence: transformationEvidenceFile.value,
      sourceAssetSha256: sourceAsset.sha256,
      permissionEvidenceSha256: permissionEvidenceFile.sha256,
      materialisedAssetSha256: materialised.sha256,
      mediaType,
      boundaryMs,
      prefix,
    });
    if (
      rights.risk_decision &&
      mediaType === "VIDEO" &&
      transformation.usage_seconds[1] -
        transformation.usage_seconds[0] >
        MAX_STEAM_EDITORIAL_EXCERPT_SECONDS
    ) {
      throw new GovernedGameMediaAdmissionError(
        `${prefix}_steam_excerpt_not_narrow`,
      );
    }
    if (
      rights.risk_decision &&
      mediaType === "VIDEO" &&
      transformation.source_audio_disposition !== "REMOVED"
    ) {
      throw new GovernedGameMediaAdmissionError(
        `${prefix}_steam_source_audio_not_removed`,
      );
    }
    return {
      asset_id: assetId,
      media_type: mediaType,
      media_kind: text(asset?.media_kind).toUpperCase(),
      editorial_role: text(asset?.editorial_role).toUpperCase(),
      game: rights.game,
      rights_basis: rights.rights_basis,
      attribution,
      transformation,
      source: {
        path: sourceAsset.path,
        sha256: sourceAsset.sha256,
        size_bytes: sourceAsset.size_bytes,
        evidence_path: sourceEvidenceFile.path,
        evidence_sha256: sourceEvidenceFile.sha256,
        page_url: sourceEvidence.page_url,
        direct_media_url: sourceEvidence.direct_media_url,
      },
      permission: {
        evidence_path: permissionEvidenceFile.path,
        evidence_sha256: permissionEvidenceFile.sha256,
        review_status: permissionEvidence.review_status,
        reviewed_by: permissionEvidence.reviewed_by,
        reviewed_at: permissionEvidence.reviewed_at,
        evidence_url: permissionEvidence.evidence_url || null,
        risk_decision: rights.risk_decision || null,
      },
      transformation_evidence: {
        path: transformationEvidenceFile.path,
        sha256: transformationEvidenceFile.sha256,
      },
      materialised: {
        path: materialised.path,
        sha256: materialised.sha256,
        size_bytes: materialised.size_bytes,
      },
      binding: {
        source_evidence_sha256: sourceEvidenceFile.sha256,
        source_asset_sha256: sourceAsset.sha256,
        permission_evidence_sha256: permissionEvidenceFile.sha256,
        transformation_evidence_sha256:
          transformationEvidenceFile.sha256,
        materialised_asset_sha256: materialised.sha256,
      },
    };
  });
  const requiredAttributions = [
    ...new Map(
      admitted
        .filter((asset) => asset.attribution)
        .map((asset) => [
          `${asset.attribution.text}\0${asset.attribution.delivery.join(",")}`,
          asset.attribution,
        ]),
    ).values(),
  ];
  return {
    schema_version: GAME_MEDIA_ADMISSION_SCHEMA,
    policy: POLICY,
    story_id: storyId,
    manifest_path: resolvedManifestPath,
    manifest_sha256: manifestFile.sha256,
    required_destinations: destinations,
    required_attributions: requiredAttributions,
    assets: admitted,
    publish_authorised: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    platform_objects_created: false,
    network_used: false,
  };
}

module.exports = {
  GAME_MEDIA_ADMISSION_SCHEMA,
  GovernedGameMediaAdmissionError,
  PERMISSION_EVIDENCE_SCHEMA,
  POLICY,
  SOURCE_EVIDENCE_SCHEMA,
  TRANSFORMATION_EVIDENCE_SCHEMA,
  validateGovernedGameMediaAdmission,
};
