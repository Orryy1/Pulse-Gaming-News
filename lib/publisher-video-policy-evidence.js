"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const OFFICIAL_MINECRAFT_USAGE_GUIDELINES_URL =
  "https://www.minecraft.net/en-us/usage-guidelines";
const OFFICIAL_XBOX_RULES_URL = "https://www.xbox.com/en-us/developers/rules";
const MINECRAFT_WEB_VIDEO_PLATFORMS = new Set([
  "youtube",
  "instagram",
  "facebook",
  "tiktok",
  "x",
  "twitch",
  "website",
]);
const OFFICIAL_STEAM_TRAILER_HOSTS = new Set([
  "video.akamai.steamstatic.com",
  "video.fastly.steamstatic.com",
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isOfficialXboxRulesUrl(value) {
  try {
    const url = new URL(clean(value));
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "www.xbox.com" &&
      url.pathname.replace(/\/+$/, "") === "/en-us/developers/rules" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isOfficialMinecraftUsageGuidelinesUrl(value) {
  try {
    const url = new URL(clean(value));
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "www.minecraft.net" &&
      url.pathname.replace(/\/+$/, "") === "/en-us/usage-guidelines" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function normalisePolicyText(value) {
  return clean(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&(?:rsquo|apos);|&#(?:39|x27);/gi, "'")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalisePlatforms(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => clean(value).toLowerCase().replace(/[\s-]+/g, "_"))
      .map((value) => value === "youtube_shorts" ? "youtube" : value)
      .filter(Boolean),
  )];
}

function isExactSteamAppTrailerUrl(value, sourceAppId) {
  const appId = clean(sourceAppId);
  if (!/^\d+$/.test(appId)) return false;
  try {
    const url = new URL(clean(value));
    if (
      url.protocol !== "https:" ||
      !OFFICIAL_STEAM_TRAILER_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return false;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    return (
      parts.length >= 4 &&
      parts[0] === "store_trailers" &&
      parts[1] === appId &&
      parts.slice(2).every((part) => part !== "." && part !== "..") &&
      /\.(?:mpd|m3u8|mp4|webm)$/i.test(parts.at(-1))
    );
  } catch {
    return false;
  }
}

function evaluateMinecraftContentCreationPolicy({
  policyUrl,
  policyHtml,
  gameName,
  itemTitle,
  targetPlatforms = [],
  freeToView,
  originalCommentary,
  selfCapturedGameplay,
  sourceAudioRemoved,
  unrelatedPromotion,
  sponsorCallouts,
  copiesSold,
} = {}) {
  const blockers = [];
  if (!isOfficialMinecraftUsageGuidelinesUrl(policyUrl)) {
    blockers.push("policy_url_not_official_minecraft_usage_guidelines");
  }
  const policyText = normalisePolicyText(policyHtml);
  if (blockers.length === 0) {
    if (
      !/allowed to create,? use,? and share videos,? streams,? and screenshots of you playing or using minecraft/.test(
        policyText,
      )
    ) {
      blockers.push("self_gameplay_permission_missing");
    }
    if (
      !/make money from your videos and streams,? through ad revenue/.test(policyText) ||
      !/youtube,? twitch,? or any other website and make money from them/.test(policyText)
    ) {
      blockers.push("web_video_ad_revenue_permission_missing");
    }
    if (!/all videos(?: \(in their entirety\)| in their entirety) are free to view/.test(policyText)) {
      blockers.push("free_to_view_clause_missing");
    }
    if (
      !/add enough of your own unique content/.test(policyText) ||
      !/add your own audio commentary to footage of your gameplay/.test(policyText) ||
      !/can(?:'|’)t just include your logo,? web address,? or overlays on top of our or someone else(?:'|’)s gameplay/.test(
        policyText,
      )
    ) {
      blockers.push("unique_commentary_clause_missing");
    }
    if (!/advertise or promote products or services unrelated to minecraft/.test(policyText)) {
      blockers.push("unrelated_promotion_restriction_missing");
    }
    if (
      !/sponsorship notices,? and other callouts outside of the actual game content/.test(policyText) ||
      !/sponsors and any callouts must be suitable for children and minors/.test(policyText)
    ) {
      blockers.push("sponsor_callout_restriction_missing");
    }
    if (!/don(?:'|’)t sell copies of the videos or streams/.test(policyText)) {
      blockers.push("video_copy_sale_restriction_missing");
    }
    if (
      !/use the minecraft name in a secondary name,? secondary title,? or description/.test(
        policyText,
      ) ||
      !/may not use the minecraft name as the primary or dominant name or title/.test(
        policyText,
      )
    ) {
      blockers.push("minecraft_naming_restriction_missing");
    }
  }

  const platforms = normalisePlatforms(targetPlatforms);
  if (platforms.length === 0) blockers.push("target_platform_missing");
  for (const platform of platforms) {
    if (!MINECRAFT_WEB_VIDEO_PLATFORMS.has(platform)) {
      blockers.push(`target_platform_not_web_video:${platform}`);
    }
  }

  const cleanGameName = clean(gameName);
  const cleanItemTitle = clean(itemTitle);
  if (!/^minecraft(?:\s|$)/i.test(cleanGameName)) blockers.push("game_name_not_minecraft");
  if (!cleanItemTitle) blockers.push("item_title_missing");
  if (/^minecraft\b/i.test(cleanItemTitle)) {
    blockers.push("minecraft_name_primary_in_item_title");
  }
  if (freeToView !== true) blockers.push("video_not_declared_free_to_view");
  if (originalCommentary !== true) blockers.push("original_commentary_not_declared");
  if (selfCapturedGameplay !== true) blockers.push("self_captured_gameplay_not_declared");
  if (sourceAudioRemoved !== true) blockers.push("source_audio_not_declared_removed");
  if (unrelatedPromotion !== false) blockers.push("unrelated_promotion_not_excluded");
  if (sponsorCallouts !== false) blockers.push("sponsor_callouts_not_excluded");
  if (copiesSold !== false) blockers.push("video_copy_sales_not_excluded");

  const allowed = blockers.length === 0;
  return {
    schema: "pulse_publisher_video_policy_decision_v1",
    policy_family: "minecraft_usage_guidelines",
    verdict: allowed ? "GREEN" : "RED",
    blockers,
    policy_url: clean(policyUrl),
    evidence_reference: clean(policyUrl),
    evidence_kind: "publisher_video_policy",
    game_name: cleanGameName || null,
    item_title: cleanItemTitle || null,
    licence_basis: allowed
      ? "minecraft_usage_guidelines_self_captured_web_video_ad_revenue"
      : null,
    allowed_use: allowed ? "original_editorial_gameplay_video" : null,
    allowed_platforms: allowed ? platforms : [],
    restricted_platforms: allowed
      ? ["paywalled_video", "physical_venue", "broadcast_television", "copy_sale"]
      : [],
    platform_restrictions: {
      free_to_view: "required",
      source_audio: "removed_by_pulse_policy",
      unrelated_promotion: "not_permitted",
      sponsorship_callouts: "excluded_from_initial_candidate",
    },
    commercial_use_allowed: allowed,
    credit_required: false,
    required_public_notice: null,
    required_rules_link: allowed ? OFFICIAL_MINECRAFT_USAGE_GUIDELINES_URL : null,
    rights_grant: allowed,
    transformative_rights_evidence_verified: allowed,
    risk_score: allowed ? 0.15 : 1,
    approval_status: allowed ? "approved_at_rights_policy_layer" : "not_approved",
    rights_status: allowed ? "explicit_self_captured_gameplay_permission" : "blocked",
    usage_status: allowed ? "bound_capture_provenance_required" : "blocked",
    status: allowed ? "rights_policy_ready_for_capture_binding" : "blocked",
    local_materialization_allowed: allowed,
    rights_layer_only: true,
    live_publish_allowed: false,
    requires_human_legal_review_before_publish: false,
  };
}

function isLocalAbsoluteMediaPath(value) {
  const candidate = clean(value);
  return Boolean(
    candidate &&
      !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) &&
      (path.isAbsolute(candidate) || path.win32.isAbsolute(candidate)),
  );
}

function bindMinecraftSelfCapturePolicyToSegmentReport({
  segmentReport = {},
  decision = {},
  storyId,
  evidenceFile,
  evidenceSha256,
  evidenceSizeBytes,
  boundAt = new Date().toISOString(),
} = {}) {
  const targetStoryId = clean(storyId);
  const evidencePath = clean(evidenceFile);
  const policySha256 = clean(evidenceSha256).toLowerCase();
  const policySizeBytes = Number(evidenceSizeBytes);
  if (
    decision.policy_family !== "minecraft_usage_guidelines" ||
    decision.local_materialization_allowed !== true ||
    decision.rights_grant !== true ||
    decision.commercial_use_allowed !== true ||
    decision.verdict !== "GREEN"
  ) {
    throw new Error("minecraft_policy_decision_not_eligible_for_capture_binding");
  }
  if (!targetStoryId) throw new Error("story_id_missing");
  if (!evidencePath) throw new Error("policy_evidence_file_missing");
  if (!/^[a-f0-9]{64}$/.test(policySha256)) {
    throw new Error("policy_evidence_sha256_invalid");
  }
  if (!Number.isFinite(policySizeBytes) || policySizeBytes <= 0) {
    throw new Error("policy_evidence_size_invalid");
  }

  const report = structuredClone(segmentReport || {});
  const segments = Array.isArray(report.segments) ? report.segments : [];
  const expectedGameName = clean(decision.game_name).toLowerCase();
  let eligibleSegmentCount = 0;
  let boundSegmentCount = 0;
  report.segments = segments.map((segment) => {
    const provenance = segment.capture_provenance &&
      typeof segment.capture_provenance === "object"
      ? segment.capture_provenance
      : {};
    const assetSha256 = clean(segment.source_sha256).toLowerCase();
    const assetSizeBytes = Number(segment.source_size_bytes);
    const sourcePath = clean(segment.source_path);
    const capturedAt = clean(provenance.captured_at);
    const eligible = Boolean(
      clean(segment.story_id) === targetStoryId &&
        clean(segment.status).toLowerCase() === "validated" &&
        segment.segment_validated === true &&
        segment.allowed_for_flash_lane === true &&
        clean(segment.source_type).toLowerCase() === "self_captured_gameplay" &&
        isLocalAbsoluteMediaPath(sourcePath) &&
        /^[a-f0-9]{64}$/.test(assetSha256) &&
        Number.isFinite(assetSizeBytes) &&
        assetSizeBytes > 0 &&
        segment.source_audio_removed === true &&
        segment.third_party_footage === false &&
        segment.publisher_download === false &&
        clean(provenance.schema) === "pulse_owned_gameplay_capture_provenance_v1" &&
        clean(provenance.captured_by).toLowerCase() === "pulse_gaming" &&
        clean(provenance.capture_method) === "local_owned_gameplay_capture" &&
        clean(provenance.ownership_attestation) === "pulse_gaming_original_capture" &&
        clean(provenance.game_name).toLowerCase() === expectedGameName &&
        clean(provenance.story_id) === targetStoryId &&
        Number.isFinite(Date.parse(capturedAt)) &&
        clean(provenance.raw_capture_sha256).toLowerCase() === assetSha256 &&
        provenance.source_audio_removed === true,
    );
    if (!eligible) return segment;
    eligibleSegmentCount += 1;
    boundSegmentCount += 1;
    return {
      ...segment,
      asset_id: clean(segment.asset_id || segment.id),
      path: sourcePath,
      local_path: sourcePath,
      asset_sha256: assetSha256,
      asset_size_bytes: assetSizeBytes,
      source_owner: "Pulse Gaming",
      creator: "Pulse Gaming",
      licence_basis: decision.licence_basis,
      rights_basis: decision.licence_basis,
      allowed_use: decision.allowed_use,
      allowed_platforms: [...decision.allowed_platforms],
      restricted_platforms: [...decision.restricted_platforms],
      platform_restrictions: structuredClone(decision.platform_restrictions),
      commercial_use_allowed: true,
      credit_required: false,
      required_rules_link: decision.required_rules_link,
      evidence_reference: decision.evidence_reference,
      evidence_file: evidencePath,
      rights_evidence_file: evidencePath,
      evidence_kind: decision.evidence_kind,
      evidence_sha256: policySha256,
      rights_evidence_sha256: policySha256,
      evidence_size_bytes: policySizeBytes,
      rights_evidence_size_bytes: policySizeBytes,
      transformative_rights_evidence_verified: true,
      rights_grant: true,
      risk_score: decision.risk_score,
      approval_status: "approved_for_self_captured_editorial_use",
      rights_status: "approved",
      usage_status: "approved_for_original_editorial_web_video",
      usage_scope: "original_editorial_web_video",
      rights_decision_basis:
        "hash_bound_minecraft_usage_guidelines_and_owned_capture_provenance",
      verdict: "GREEN",
      rights_verdict: "GREEN",
      rights_layer_only: true,
      live_publish_allowed: true,
      requires_human_legal_review_before_publish: false,
      publisher_policy_binding: {
        schema: "pulse_publisher_video_policy_segment_binding_v1",
        bound_at: clean(boundAt),
        policy_url: decision.policy_url,
        capture_sha256: assetSha256,
        rights_layer_only: true,
        live_publish_allowed: true,
      },
    };
  });

  const summary = {
    story_id: targetStoryId,
    input_segment_count: segments.length,
    eligible_segment_count: eligibleSegmentCount,
    bound_segment_count: boundSegmentCount,
    verdict: boundSegmentCount > 0 ? "GREEN" : "RED",
    rights_layer_only: true,
    live_publish_allowed: boundSegmentCount > 0,
    broader_publish_authority_required: true,
  };
  report.publisher_video_policy_binding = {
    schema: "pulse_publisher_video_policy_segment_report_binding_v1",
    generated_at: clean(boundAt),
    ...summary,
  };
  return { report, summary };
}

function evaluateXboxGameContentUsagePolicy({
  policyUrl,
  policyHtml,
  gameName,
  itemTitle,
  sourceAppId,
  targetPlatforms = [],
} = {}) {
  const blockers = [];
  if (!isOfficialXboxRulesUrl(policyUrl)) {
    blockers.push("policy_url_not_official_xbox_rules");
  }
  const policyText = normalisePolicyText(policyHtml);
  if (blockers.length === 0) {
    if (
      !/personal,? non-exclusive,? non-sublicenseable,? non-transferable,? revocable,? limited licen[cs]e/.test(
        policyText,
      )
    ) {
      blockers.push("limited_licence_grant_missing");
    }
    if (
      !/rules apply to all games and game content published and owned by microsoft studios/.test(
        policyText,
      )
    ) {
      blockers.push("microsoft_owned_game_scope_missing");
    }
    if (
      !/created under microsoft's ["']?game content usage rules["']? using assets from/.test(
        policyText,
      ) ||
      !/not endorsed by or affiliated with microsoft/.test(policyText)
    ) {
      blockers.push("required_public_notice_clause_missing");
    }
    if (!/include a link to (?:these|the) game content usage rules/.test(policyText)) {
      blockers.push("required_rules_link_clause_missing");
    }
    if (
      !/make your item available on youtube or twitch/.test(policyText) ||
      !/earn revenue from ads displayed in connection with your item/.test(policyText)
    ) {
      blockers.push("youtube_ad_program_permission_missing");
    }
    if (
      !/soundtracks or audio effects from the original game/.test(policyText) ||
      !/permission from a third party/.test(policyText)
    ) {
      blockers.push("source_audio_restriction_missing");
    }
  }
  const platforms = normalisePlatforms(targetPlatforms);
  if (platforms.length === 0) blockers.push("target_platform_missing");
  for (const platform of platforms) {
    if (platform !== "youtube") {
      blockers.push(`target_platform_not_permitted:${platform}`);
    }
  }
  const cleanGameName = clean(gameName);
  const cleanItemTitle = clean(itemTitle);
  const cleanSourceAppId = clean(sourceAppId);
  if (!cleanGameName) blockers.push("game_name_missing");
  if (!cleanItemTitle) blockers.push("item_title_missing");
  if (!/^\d+$/.test(cleanSourceAppId)) blockers.push("source_app_id_invalid");
  const locallyAllowed = blockers.length === 0;
  const requiredPublicNotice = locallyAllowed
    ? `${cleanGameName} \u00a9 Microsoft Corporation. ${cleanItemTitle} was created under Microsoft's "Game Content Usage Rules" using assets from ${cleanGameName}, and it is not endorsed by or affiliated with Microsoft.`
    : null;
  return {
    schema: "pulse_publisher_video_policy_decision_v1",
    verdict: blockers.length ? "RED" : "AMBER",
    blockers,
    policy_url: clean(policyUrl),
    evidence_reference: clean(policyUrl),
    evidence_kind: "publisher_video_policy",
    game_name: cleanGameName || null,
    item_title: cleanItemTitle || null,
    source_app_id: cleanSourceAppId || null,
    licence_basis: locallyAllowed
      ? "microsoft_game_content_usage_rules_youtube_ad_program"
      : null,
    allowed_use: locallyAllowed ? "transformative_editorial_short_form" : null,
    allowed_platforms: locallyAllowed ? ["youtube"] : [],
    restricted_platforms: locallyAllowed
      ? [
          "tiktok",
          "instagram",
          "facebook",
          "x",
          "website",
          "sponsor_distribution",
          "affiliate_commerce",
        ]
      : [],
    platform_restrictions: {
      source_audio: "must_not_be_used",
      monetisation: locallyAllowed
        ? "youtube_on_site_ad_program_only"
        : "not_permitted",
    },
    commercial_use_allowed: locallyAllowed,
    credit_required: locallyAllowed,
    required_public_notice: requiredPublicNotice,
    required_rules_link: locallyAllowed ? OFFICIAL_XBOX_RULES_URL : null,
    rights_grant: locallyAllowed,
    transformative_rights_evidence_verified: locallyAllowed,
    risk_score: locallyAllowed ? 0.45 : 1,
    approval_status: locallyAllowed
      ? "approved_for_local_materialization_only"
      : "not_approved",
    rights_status: locallyAllowed
      ? "conditional_youtube_ad_program_scope"
      : "blocked",
    usage_status: locallyAllowed
      ? "human_legal_review_required_before_publish"
      : "blocked",
    status: locallyAllowed ? "local_materialization_only" : "blocked",
    local_materialization_allowed: locallyAllowed,
    live_publish_allowed: false,
    requires_human_legal_review_before_publish: true,
  };
}

function bindPublisherVideoPolicyToSegmentReport({
  segmentReport = {},
  decision = {},
  storyId,
  evidenceFile,
  evidenceSha256,
  evidenceSizeBytes,
  boundAt = new Date().toISOString(),
} = {}) {
  const targetStoryId = clean(storyId);
  const evidencePath = clean(evidenceFile);
  const policySha256 = clean(evidenceSha256).toLowerCase();
  const policySizeBytes = Number(evidenceSizeBytes);
  if (
    decision.local_materialization_allowed !== true ||
    decision.rights_grant !== true ||
    decision.commercial_use_allowed !== true ||
    decision.verdict !== "AMBER"
  ) {
    throw new Error("publisher_policy_decision_not_eligible_for_local_binding");
  }
  if (!targetStoryId) throw new Error("story_id_missing");
  if (!evidencePath) throw new Error("policy_evidence_file_missing");
  if (!/^[a-f0-9]{64}$/.test(policySha256)) {
    throw new Error("policy_evidence_sha256_invalid");
  }
  if (!Number.isFinite(policySizeBytes) || policySizeBytes <= 0) {
    throw new Error("policy_evidence_size_invalid");
  }
  const sourceAppId = clean(decision.source_app_id);
  const report = structuredClone(segmentReport || {});
  const segments = Array.isArray(report.segments) ? report.segments : [];
  let eligibleSegmentCount = 0;
  let boundSegmentCount = 0;
  report.segments = segments.map((segment) => {
    const eligible = Boolean(
      clean(segment.story_id) === targetStoryId &&
        clean(segment.status).toLowerCase() === "validated" &&
        segment.segment_validated === true &&
        segment.allowed_for_flash_lane === true &&
        isExactSteamAppTrailerUrl(segment.source_url, sourceAppId),
    );
    if (!eligible) return segment;
    eligibleSegmentCount += 1;
    boundSegmentCount += 1;
    return {
      ...segment,
      source_app_id: sourceAppId,
      licence_basis: decision.licence_basis,
      allowed_use: decision.allowed_use,
      allowed_platforms: [...decision.allowed_platforms],
      restricted_platforms: [...decision.restricted_platforms],
      platform_restrictions: structuredClone(decision.platform_restrictions),
      commercial_use_allowed: true,
      credit_required: true,
      required_public_notice: decision.required_public_notice,
      required_rules_link: decision.required_rules_link,
      evidence_reference: decision.evidence_reference,
      evidence_file: evidencePath,
      rights_evidence_file: evidencePath,
      evidence_kind: decision.evidence_kind,
      evidence_sha256: policySha256,
      rights_evidence_sha256: policySha256,
      evidence_size_bytes: policySizeBytes,
      rights_evidence_size_bytes: policySizeBytes,
      transformative_rights_evidence_verified: true,
      rights_grant: true,
      risk_score: decision.risk_score,
      approval_status: decision.approval_status,
      rights_status: decision.rights_status,
      usage_status: decision.usage_status,
      usage_scope: "youtube_on_site_ad_program_only",
      rights_decision_basis:
        "hash_bound_microsoft_game_content_usage_rules_conditional_local_materialization",
      verdict: "AMBER",
      rights_verdict: "AMBER",
      live_publish_allowed: false,
      requires_human_legal_review_before_publish: true,
      publisher_policy_binding: {
        schema: "pulse_publisher_video_policy_segment_binding_v1",
        bound_at: clean(boundAt),
        policy_url: decision.policy_url,
        source_app_id: sourceAppId,
        local_materialization_allowed: true,
        live_publish_allowed: false,
      },
    };
  });
  const summary = {
    story_id: targetStoryId,
    source_app_id: sourceAppId,
    input_segment_count: segments.length,
    eligible_segment_count: eligibleSegmentCount,
    bound_segment_count: boundSegmentCount,
    live_publish_allowed: false,
    requires_human_legal_review_before_publish: true,
  };
  report.publisher_video_policy_binding = {
    schema: "pulse_publisher_video_policy_segment_report_binding_v1",
    generated_at: clean(boundAt),
    verdict: "AMBER",
    ...summary,
  };
  return { report, summary };
}

async function fingerprintLocalFile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("capture_file_empty_or_not_regular");
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return { sha256: hash.digest("hex"), size_bytes: stat.size };
}

async function materializeMinecraftSelfCapturePolicyEvidence({
  outputDir,
  policyUrl = OFFICIAL_MINECRAFT_USAGE_GUIDELINES_URL,
  segmentReport = {},
  storyId,
  gameName,
  itemTitle,
  targetPlatforms = ["youtube"],
  freeToView,
  originalCommentary,
  selfCapturedGameplay,
  sourceAudioRemoved,
  unrelatedPromotion,
  sponsorCallouts,
  copiesSold,
  generatedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const resolvedOutputDir = path.resolve(clean(outputDir));
  const targetStoryId = clean(storyId);
  if (!clean(outputDir)) throw new Error("output_dir_missing");
  if (!targetStoryId) throw new Error("story_id_missing");
  if (typeof fetchImpl !== "function") throw new Error("policy_fetch_unavailable");

  const response = await fetchImpl(policyUrl, {
    method: "GET",
    headers: { accept: "text/html" },
    redirect: "follow",
  });
  if (!response?.ok) {
    throw new Error(`policy_fetch_failed:${Number(response?.status) || 0}`);
  }
  if (clean(response.url) && !isOfficialMinecraftUsageGuidelinesUrl(response.url)) {
    throw new Error("policy_fetch_redirected_outside_official_minecraft_guidelines");
  }
  const contentType = clean(response.headers?.get?.("content-type")).toLowerCase();
  if (contentType && !contentType.includes("text/html")) {
    throw new Error(`policy_fetch_content_type_invalid:${contentType}`);
  }
  const policyBytes = Buffer.from(await response.arrayBuffer());
  if (policyBytes.length === 0) throw new Error("policy_snapshot_empty");

  const decision = evaluateMinecraftContentCreationPolicy({
    policyUrl,
    policyHtml: policyBytes.toString("utf8"),
    gameName,
    itemTitle,
    targetPlatforms,
    freeToView,
    originalCommentary,
    selfCapturedGameplay,
    sourceAudioRemoved,
    unrelatedPromotion,
    sponsorCallouts,
    copiesSold,
  });
  if (decision.local_materialization_allowed !== true) {
    throw new Error(`publisher_policy_validation_failed:${decision.blockers.join(",")}`);
  }

  const verifiedCaptures = [];
  const segments = Array.isArray(segmentReport?.segments) ? segmentReport.segments : [];
  for (const segment of segments) {
    const shouldVerify = Boolean(
      clean(segment.story_id) === targetStoryId &&
        clean(segment.status).toLowerCase() === "validated" &&
        segment.segment_validated === true &&
        segment.allowed_for_flash_lane === true &&
        clean(segment.source_type).toLowerCase() === "self_captured_gameplay",
    );
    if (!shouldVerify) continue;
    const sourcePath = clean(segment.source_path);
    if (!isLocalAbsoluteMediaPath(sourcePath)) {
      throw new Error(`capture_path_not_local_absolute:${clean(segment.id) || "unknown"}`);
    }
    if (!(await fs.pathExists(sourcePath))) {
      throw new Error(`capture_file_missing:${clean(segment.id) || "unknown"}`);
    }
    const actual = await fingerprintLocalFile(sourcePath);
    const declaredSha256 = clean(segment.source_sha256).toLowerCase();
    const declaredSizeBytes = Number(segment.source_size_bytes);
    const provenanceSha256 = clean(
      segment.capture_provenance?.raw_capture_sha256,
    ).toLowerCase();
    if (actual.sha256 !== declaredSha256 || actual.sha256 !== provenanceSha256) {
      throw new Error(`capture_sha256_mismatch:${clean(segment.id) || "unknown"}`);
    }
    if (actual.size_bytes !== declaredSizeBytes) {
      throw new Error(`capture_size_mismatch:${clean(segment.id) || "unknown"}`);
    }
    verifiedCaptures.push({
      segment_id: clean(segment.id),
      path: sourcePath,
      sha256: actual.sha256,
      size_bytes: actual.size_bytes,
    });
  }
  if (verifiedCaptures.length === 0) {
    throw new Error("verified_self_capture_missing");
  }

  const policySnapshotSha256 = crypto
    .createHash("sha256")
    .update(policyBytes)
    .digest("hex");
  const policyDir = path.join(
    resolvedOutputDir,
    "rights",
    "publisher-video-policy",
  );
  const policySnapshotPath = path.join(policyDir, "minecraft-usage-guidelines.html");
  const policyBundlePath = path.join(
    policyDir,
    "minecraft-usage-guidelines-evidence.json",
  );
  const boundSegmentReportPath = path.join(
    resolvedOutputDir,
    "minecraft_policy_bound_segments.json",
  );
  await fs.ensureDir(policyDir);
  await fs.writeFile(policySnapshotPath, policyBytes);
  const binding = bindMinecraftSelfCapturePolicyToSegmentReport({
    segmentReport,
    decision,
    storyId: targetStoryId,
    evidenceFile: policySnapshotPath,
    evidenceSha256: policySnapshotSha256,
    evidenceSizeBytes: policyBytes.length,
    boundAt: generatedAt,
  });
  if (binding.summary.bound_segment_count !== verifiedCaptures.length) {
    throw new Error("verified_capture_binding_count_mismatch");
  }

  const policyBundle = {
    schema: "pulse_publisher_video_policy_evidence_bundle_v1",
    schema_version: 1,
    generated_at: clean(generatedAt),
    story_id: targetStoryId,
    decision,
    policy_snapshot: {
      url: clean(policyUrl),
      file: policySnapshotPath,
      sha256: policySnapshotSha256,
      size_bytes: policyBytes.length,
      content_type: contentType || "text/html",
    },
    capture_verification: {
      schema: "pulse_owned_gameplay_capture_verification_v1",
      verified_capture_count: verifiedCaptures.length,
      captures: verifiedCaptures,
    },
    binding_summary: binding.summary,
    safety: {
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      rights_layer_only: true,
      broader_publish_authority_required: true,
    },
  };
  await fs.outputJson(policyBundlePath, policyBundle, { spaces: 2 });
  await fs.outputJson(boundSegmentReportPath, binding.report, { spaces: 2 });
  return {
    schema: "pulse_publisher_video_policy_materialization_result_v1",
    generated_at: clean(generatedAt),
    decision,
    summary: binding.summary,
    policy_snapshot_path: policySnapshotPath,
    policy_snapshot_sha256: policySnapshotSha256,
    policy_snapshot_size_bytes: policyBytes.length,
    policy_bundle_path: policyBundlePath,
    bound_segment_report_path: boundSegmentReportPath,
    capture_verification: policyBundle.capture_verification,
    safety: policyBundle.safety,
  };
}

async function materializePublisherVideoPolicyEvidence({
  outputDir,
  policyUrl = OFFICIAL_XBOX_RULES_URL,
  segmentReport = {},
  storyId,
  gameName,
  itemTitle,
  sourceAppId,
  targetPlatforms = ["youtube"],
  generatedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const resolvedOutputDir = path.resolve(clean(outputDir));
  if (!clean(outputDir)) throw new Error("output_dir_missing");
  if (typeof fetchImpl !== "function") throw new Error("policy_fetch_unavailable");
  const response = await fetchImpl(policyUrl, {
    method: "GET",
    headers: { accept: "text/html" },
    redirect: "follow",
  });
  if (!response?.ok) {
    throw new Error(`policy_fetch_failed:${Number(response?.status) || 0}`);
  }
  if (clean(response.url) && !isOfficialXboxRulesUrl(response.url)) {
    throw new Error("policy_fetch_redirected_outside_official_xbox_rules");
  }
  const contentType = clean(response.headers?.get?.("content-type")).toLowerCase();
  if (contentType && !contentType.includes("text/html")) {
    throw new Error(`policy_fetch_content_type_invalid:${contentType}`);
  }
  const policyBytes = Buffer.from(await response.arrayBuffer());
  if (policyBytes.length === 0) throw new Error("policy_snapshot_empty");
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl,
    policyHtml: policyBytes.toString("utf8"),
    gameName,
    itemTitle,
    sourceAppId,
    targetPlatforms,
  });
  if (decision.local_materialization_allowed !== true) {
    throw new Error(`publisher_policy_validation_failed:${decision.blockers.join(",")}`);
  }
  const policySnapshotSha256 = crypto
    .createHash("sha256")
    .update(policyBytes)
    .digest("hex");
  const policyDir = path.join(
    resolvedOutputDir,
    "rights",
    "publisher-video-policy",
  );
  const policySnapshotPath = path.join(
    policyDir,
    "microsoft-game-content-usage-rules.html",
  );
  const policyBundlePath = path.join(
    policyDir,
    "microsoft-game-content-usage-rules-evidence.json",
  );
  const boundSegmentReportPath = path.join(
    resolvedOutputDir,
    "publisher_video_policy_bound_segments.json",
  );
  await fs.ensureDir(policyDir);
  await fs.writeFile(policySnapshotPath, policyBytes);
  const binding = bindPublisherVideoPolicyToSegmentReport({
    segmentReport,
    decision,
    storyId,
    evidenceFile: policySnapshotPath,
    evidenceSha256: policySnapshotSha256,
    evidenceSizeBytes: policyBytes.length,
    boundAt: generatedAt,
  });
  const policyBundle = {
    schema: "pulse_publisher_video_policy_evidence_bundle_v1",
    schema_version: 1,
    generated_at: clean(generatedAt),
    story_id: clean(storyId),
    decision,
    policy_snapshot: {
      url: clean(policyUrl),
      file: policySnapshotPath,
      sha256: policySnapshotSha256,
      size_bytes: policyBytes.length,
      content_type: contentType || "text/html",
    },
    binding_summary: binding.summary,
    safety: {
      no_publish_triggered: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      live_publish_allowed: false,
      human_legal_review_required_before_publish: true,
    },
  };
  await fs.outputJson(policyBundlePath, policyBundle, { spaces: 2 });
  await fs.outputJson(boundSegmentReportPath, binding.report, { spaces: 2 });
  return {
    schema: "pulse_publisher_video_policy_materialization_result_v1",
    generated_at: clean(generatedAt),
    decision,
    summary: binding.summary,
    policy_snapshot_path: policySnapshotPath,
    policy_snapshot_sha256: policySnapshotSha256,
    policy_snapshot_size_bytes: policyBytes.length,
    policy_bundle_path: policyBundlePath,
    bound_segment_report_path: boundSegmentReportPath,
    safety: policyBundle.safety,
  };
}

module.exports = {
  OFFICIAL_MINECRAFT_USAGE_GUIDELINES_URL,
  OFFICIAL_XBOX_RULES_URL,
  bindMinecraftSelfCapturePolicyToSegmentReport,
  bindPublisherVideoPolicyToSegmentReport,
  evaluateMinecraftContentCreationPolicy,
  evaluateXboxGameContentUsagePolicy,
  isExactSteamAppTrailerUrl,
  isOfficialMinecraftUsageGuidelinesUrl,
  isOfficialXboxRulesUrl,
  materializeMinecraftSelfCapturePolicyEvidence,
  materializePublisherVideoPolicyEvidence,
  normalisePolicyText,
  normalisePlatforms,
};
