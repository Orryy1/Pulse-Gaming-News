"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  completeRightsRecord,
} = require("../../lib/candidate-evidence-reconciliation");
const {
  candidateRows,
} = require("../../lib/goal-real-motion-materializer");

const {
  OFFICIAL_MINECRAFT_USAGE_GUIDELINES_URL,
  OFFICIAL_XBOX_RULES_URL,
  bindMinecraftSelfCapturePolicyToSegmentReport,
  bindPublisherVideoPolicyToSegmentReport,
  evaluateMinecraftContentCreationPolicy,
  evaluateXboxGameContentUsagePolicy,
  isExactSteamAppTrailerUrl,
  materializeMinecraftSelfCapturePolicyEvidence,
  materializePublisherVideoPolicyEvidence,
} = require("../../lib/publisher-video-policy-evidence");

function minecraftPolicyHtml() {
  return [
    "You are allowed to create, use, and share videos, streams, and screenshots of you playing or using Minecraft.",
    "You may also make money from your videos and streams, through ad revenue, if you follow the guidelines in this section.",
    "You are allowed to put footage of our game on YouTube, Twitch, or any other website and make money from them.",
    "All videos in their entirety are free to view.",
    "You add enough of your own unique content to the video or stream to make it reasonable for you to make money through someone watching it.",
    "You can add your own audio commentary to footage of your gameplay.",
    "You can't just include your logo, web address, or overlays on top of our or someone else's gameplay.",
    "You don't create and use videos or streams whose purpose is to advertise or promote products or services unrelated to Minecraft.",
    "You place any title card, end credits, sponsorship notices, and other callouts outside of the actual game content.",
    "Sponsors and any callouts must be suitable for children and minors and must not cause harm to the brand.",
    "You don't sell copies of the videos or streams.",
    "You may use the Minecraft name in a secondary name, secondary title, or description.",
    "You may not use the Minecraft name as the primary or dominant name or title.",
  ].join(" ");
}

test("Minecraft policy permits ad-monetised original gameplay commentary on free video platforms", () => {
  const decision = evaluateMinecraftContentCreationPolicy({
    policyUrl: OFFICIAL_MINECRAFT_USAGE_GUIDELINES_URL,
    policyHtml: minecraftPolicyHtml(),
    gameName: "Minecraft Java Edition",
    itemTitle: "Your PC May Miss Minecraft's New Baseline",
    targetPlatforms: ["youtube", "instagram", "facebook"],
    freeToView: true,
    originalCommentary: true,
    selfCapturedGameplay: true,
    sourceAudioRemoved: true,
    unrelatedPromotion: false,
    sponsorCallouts: false,
    copiesSold: false,
  });

  assert.equal(decision.verdict, "GREEN");
  assert.deepEqual(decision.blockers, []);
  assert.deepEqual(decision.allowed_platforms, [
    "youtube",
    "instagram",
    "facebook",
  ]);
  assert.equal(decision.commercial_use_allowed, true);
  assert.equal(decision.local_materialization_allowed, true);
  assert.equal(decision.rights_layer_only, true);
  assert.equal(decision.live_publish_allowed, false);
});

test("Minecraft policy rejects a title led by the protected game name", () => {
  const decision = evaluateMinecraftContentCreationPolicy({
    policyUrl: OFFICIAL_MINECRAFT_USAGE_GUIDELINES_URL,
    policyHtml: minecraftPolicyHtml(),
    gameName: "Minecraft Java Edition",
    itemTitle: "Minecraft Just Raised Its PC Baseline",
    targetPlatforms: ["youtube"],
    freeToView: true,
    originalCommentary: true,
    selfCapturedGameplay: true,
    sourceAudioRemoved: true,
    unrelatedPromotion: false,
    sponsorCallouts: false,
    copiesSold: false,
  });

  assert.equal(decision.verdict, "RED");
  assert.ok(decision.blockers.includes("minecraft_name_primary_in_item_title"));
  assert.equal(decision.commercial_use_allowed, false);
});

test("Minecraft policy binds only hash-attested local self-captured gameplay", () => {
  const storyId = "official_minecraft_java_requirements_20260721";
  const captureSha256 = "b".repeat(64);
  const decision = evaluateMinecraftContentCreationPolicy({
    policyUrl: OFFICIAL_MINECRAFT_USAGE_GUIDELINES_URL,
    policyHtml: minecraftPolicyHtml(),
    gameName: "Minecraft Java Edition",
    itemTitle: "Your PC May Miss Minecraft's New Baseline",
    targetPlatforms: ["youtube", "instagram", "facebook"],
    freeToView: true,
    originalCommentary: true,
    selfCapturedGameplay: true,
    sourceAudioRemoved: true,
    unrelatedPromotion: false,
    sponsorCallouts: false,
    copiesSold: false,
  });
  const eligible = {
    id: "minecraft-owned-capture-window-01",
    story_id: storyId,
    status: "validated",
    segment_validated: true,
    allowed_for_flash_lane: true,
    source_type: "self_captured_gameplay",
    source_path: "C:\\proof\\minecraft-owned-capture-01.mp4",
    source_sha256: captureSha256,
    source_size_bytes: 8192,
    source_audio_removed: true,
    third_party_footage: false,
    publisher_download: false,
    capture_provenance: {
      schema: "pulse_owned_gameplay_capture_provenance_v1",
      captured_by: "pulse_gaming",
      capture_method: "local_owned_gameplay_capture",
      ownership_attestation: "pulse_gaming_original_capture",
      game_name: "Minecraft Java Edition",
      story_id: storyId,
      captured_at: "2026-07-22T11:00:00.000Z",
      raw_capture_sha256: captureSha256,
      source_audio_removed: true,
    },
  };
  const officialDownload = {
    ...eligible,
    id: "official-download",
    source_type: "publisher_download",
    source_path: "https://minecraft.net/trailer.mp4",
    publisher_download: true,
  };
  const thirdParty = {
    ...eligible,
    id: "third-party",
    third_party_footage: true,
  };

  const result = bindMinecraftSelfCapturePolicyToSegmentReport({
    segmentReport: { segments: [eligible, officialDownload, thirdParty] },
    decision,
    storyId,
    evidenceFile: "C:\\proof\\minecraft-usage-guidelines.html",
    evidenceSha256: "a".repeat(64),
    evidenceSizeBytes: 16384,
  });

  assert.equal(result.summary.bound_segment_count, 1);
  assert.equal(result.report.segments[0].rights_verdict, "GREEN");
  assert.equal(result.report.segments[0].rights_layer_only, true);
  assert.equal(result.report.segments[0].live_publish_allowed, true);
  assert.deepEqual(result.report.segments[1], officialDownload);
  assert.deepEqual(result.report.segments[2], thirdParty);
});

test("Minecraft policy materializer verifies actual capture bytes before binding", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-minecraft-policy-"));
  t.after(() => fs.remove(root));
  const storyId = "official_minecraft_java_requirements_20260721";
  const capturePath = path.join(root, "minecraft-capture.mp4");
  const captureBytes = Buffer.from("owned minecraft gameplay capture bytes");
  await fs.writeFile(capturePath, captureBytes);
  const captureSha256 = crypto.createHash("sha256").update(captureBytes).digest("hex");

  const result = await materializeMinecraftSelfCapturePolicyEvidence({
    outputDir: root,
    policyUrl: OFFICIAL_MINECRAFT_USAGE_GUIDELINES_URL,
    segmentReport: {
      segments: [{
        id: "minecraft-owned-capture-window-01",
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        source_type: "self_captured_gameplay",
        source_path: capturePath,
        source_sha256: captureSha256,
        source_size_bytes: captureBytes.length,
        source_audio_removed: true,
        third_party_footage: false,
        publisher_download: false,
        capture_provenance: {
          schema: "pulse_owned_gameplay_capture_provenance_v1",
          captured_by: "pulse_gaming",
          capture_method: "local_owned_gameplay_capture",
          ownership_attestation: "pulse_gaming_original_capture",
          game_name: "Minecraft Java Edition",
          story_id: storyId,
          captured_at: "2026-07-22T11:00:00.000Z",
          raw_capture_sha256: captureSha256,
          source_audio_removed: true,
        },
      }],
    },
    storyId,
    gameName: "Minecraft Java Edition",
    itemTitle: "Your PC May Miss Minecraft's New Baseline",
    targetPlatforms: ["youtube", "instagram", "facebook"],
    freeToView: true,
    originalCommentary: true,
    selfCapturedGameplay: true,
    sourceAudioRemoved: true,
    unrelatedPromotion: false,
    sponsorCallouts: false,
    copiesSold: false,
    generatedAt: "2026-07-22T11:15:00.000Z",
    fetchImpl: async () => new Response(minecraftPolicyHtml(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  });

  assert.equal(result.decision.verdict, "GREEN");
  assert.equal(result.summary.bound_segment_count, 1);
  assert.equal(result.safety.no_publish_triggered, true);
  const boundReport = await fs.readJson(result.bound_segment_report_path);
  assert.equal(boundReport.segments[0].asset_sha256, captureSha256);
  assert.equal(boundReport.segments[0].rights_verdict, "GREEN");
  const bundle = await fs.readJson(result.policy_bundle_path);
  assert.equal(bundle.capture_verification.verified_capture_count, 1);
  assert.equal(bundle.safety.rights_layer_only, true);
});

function policyHtml({
  includeGrant = true,
  includeMicrosoftScope = true,
  includeNotice = true,
  includeRulesLink = true,
  includeYouTubeAds = true,
  includeAudioRestriction = true,
} = {}) {
  return [
    includeGrant
      ? "Microsoft grants you a personal, non-exclusive, non-sublicenseable, non-transferable, revocable, limited license."
      : "Microsoft describes how fans can make Items.",
    includeMicrosoftScope
      ? "These Rules apply to all games and Game Content published and owned by Microsoft Studios."
      : "These Rules apply to some fan content.",
    includeYouTubeAds
      ? "You may make your Item available on Youtube or Twitch and participate in programs on those sites that allow you to earn revenue from ads displayed in connection with your Item."
      : "You may share your Item with other fans.",
    includeNotice
      ? "You must include the following notice: [Name of the Microsoft Game] Microsoft Corporation. [The title of your Item] was created under Microsoft's Game Content Usage Rules using assets from [Name of the Microsoft Game], and it is not endorsed by or affiliated with Microsoft."
      : "You should identify the source game.",
    includeRulesLink
      ? "You also need to include a link to these Game Content Usage Rules."
      : "The notice should be easy to find.",
    includeAudioRestriction
      ? "If you want to use the soundtracks or audio effects from the original game, we often license those from or to third parties and do not always have the rights to pass them on to you. If we do not let you know, you need permission from a third party."
      : "The Item may include game visuals.",
  ].join(" ");
}

test("publisher video policy evidence rejects a non-Xbox policy URL", () => {
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: "https://example.com/game-content-rules",
    policyHtml: "policy text",
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
  });

  assert.equal(decision.verdict, "RED");
  assert.deepEqual(decision.blockers, ["policy_url_not_official_xbox_rules"]);
  assert.equal(decision.local_materialization_allowed, false);
  assert.equal(decision.live_publish_allowed, false);
});

test("publisher video policy evidence requires the YouTube ad-program exception", () => {
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    policyHtml: policyHtml({ includeYouTubeAds: false }),
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
  });

  assert.equal(decision.verdict, "RED");
  assert.ok(decision.blockers.includes("youtube_ad_program_permission_missing"));
  assert.equal(decision.local_materialization_allowed, false);
});

test("publisher video policy evidence rejects every target beyond YouTube", () => {
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    policyHtml: policyHtml(),
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube", "tiktok"],
  });

  assert.equal(decision.verdict, "RED");
  assert.ok(decision.blockers.includes("target_platform_not_permitted:tiktok"));
  assert.deepEqual(decision.allowed_platforms, []);
  assert.equal(decision.commercial_use_allowed, false);
});

test("publisher video policy evidence requires the limited licence grant", () => {
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    policyHtml: policyHtml({ includeGrant: false }),
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
  });

  assert.equal(decision.verdict, "RED");
  assert.ok(decision.blockers.includes("limited_licence_grant_missing"));
});

test("publisher video policy evidence requires Microsoft-owned game scope", () => {
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    policyHtml: policyHtml({ includeMicrosoftScope: false }),
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
  });

  assert.equal(decision.verdict, "RED");
  assert.ok(decision.blockers.includes("microsoft_owned_game_scope_missing"));
});

test("publisher video policy evidence requires Microsoft's public notice clause", () => {
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    policyHtml: policyHtml({ includeNotice: false }),
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
  });

  assert.equal(decision.verdict, "RED");
  assert.ok(decision.blockers.includes("required_public_notice_clause_missing"));
});

test("publisher video policy evidence requires a public link to the rules", () => {
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    policyHtml: policyHtml({ includeRulesLink: false }),
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
  });

  assert.equal(decision.verdict, "RED");
  assert.ok(decision.blockers.includes("required_rules_link_clause_missing"));
});

test("publisher video policy evidence requires the source-audio restriction", () => {
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    policyHtml: policyHtml({ includeAudioRestriction: false }),
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
  });

  assert.equal(decision.verdict, "RED");
  assert.ok(decision.blockers.includes("source_audio_restriction_missing"));
  assert.equal(decision.commercial_use_allowed, false);
});

test("publisher video policy evidence produces a YouTube-only local decision with a publish hold", () => {
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    policyHtml: policyHtml(),
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
  });

  assert.equal(decision.verdict, "AMBER");
  assert.deepEqual(decision.blockers, []);
  assert.equal(decision.local_materialization_allowed, true);
  assert.equal(decision.live_publish_allowed, false);
  assert.equal(decision.requires_human_legal_review_before_publish, true);
  assert.equal(decision.rights_grant, true);
  assert.equal(decision.commercial_use_allowed, true);
  assert.deepEqual(decision.allowed_platforms, ["youtube"]);
  assert.deepEqual(decision.restricted_platforms, [
    "tiktok",
    "instagram",
    "facebook",
    "x",
    "website",
    "sponsor_distribution",
    "affiliate_commerce",
  ]);
  assert.equal(
    decision.platform_restrictions.source_audio,
    "must_not_be_used",
  );
  assert.equal(
    decision.licence_basis,
    "microsoft_game_content_usage_rules_youtube_ad_program",
  );
  assert.equal(decision.evidence_kind, "publisher_video_policy");
  assert.equal(decision.risk_score, 0.45);
  assert.equal(
    decision.required_public_notice,
    "Halo: Campaign Evolved \u00a9 Microsoft Corporation. Halo's Remake Hits Game Pass On 28 July was created under Microsoft's \"Game Content Usage Rules\" using assets from Halo: Campaign Evolved, and it is not endorsed by or affiliated with Microsoft.",
  );
  assert.equal(decision.required_rules_link, OFFICIAL_XBOX_RULES_URL);
});

test("publisher video policy evidence accepts only exact Steam trailer paths for the declared app", () => {
  assert.equal(
    isExactSteamAppTrailerUrl(
      "https://video.fastly.steamstatic.com/store_trailers/2806050/1326798026/hash/1781131704/dash_h264.mpd?t=1781134450",
      "2806050",
    ),
    true,
  );
  assert.equal(
    isExactSteamAppTrailerUrl(
      "https://video.fastly.steamstatic.com/store_trailers/9999999/1326798026/hash/1781131704/dash_h264.mpd",
      "2806050",
    ),
    false,
  );
  assert.equal(
    isExactSteamAppTrailerUrl(
      "https://evil.example/store_trailers/2806050/trailer.mp4",
      "2806050",
    ),
    false,
  );
  assert.equal(
    isExactSteamAppTrailerUrl(
      "https://video.fastly.steamstatic.com/store_trailers/2806050/../9999999/trailer.mp4",
      "2806050",
    ),
    false,
  );
  assert.equal(
    isExactSteamAppTrailerUrl(
      "https://video.akamai.steamstatic.com/store_trailers/2806050/1673450740/hash/1780963408/hls_264_master.m3u8?t=1781050956",
      "2806050",
    ),
    true,
  );
  assert.equal(
    isExactSteamAppTrailerUrl(
      "https://uploads.steamstatic.com/store_trailers/2806050/trailer/hash/master.mp4",
      "2806050",
    ),
    false,
  );
});

test("publisher video policy evidence binds only validated matching Steam app segments", () => {
  const storyId = "rss_669d4232cf129214";
  const sourceUrl =
    "https://video.fastly.steamstatic.com/store_trailers/2806050/1326798026/hash/1781131704/dash_h264.mpd?t=1781134450";
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    policyHtml: policyHtml(),
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
  });
  const untouchedRejected = {
    id: "rejected",
    story_id: storyId,
    status: "rejected",
    segment_validated: false,
    allowed_for_flash_lane: false,
    source_url: sourceUrl,
  };
  const untouchedOtherApp = {
    id: "other-app",
    story_id: storyId,
    status: "validated",
    segment_validated: true,
    allowed_for_flash_lane: true,
    source_url:
      "https://video.fastly.steamstatic.com/store_trailers/9999999/trailer/hash/master.mp4",
  };
  const segmentReport = {
    schema_version: 1,
    segments: [
      {
        id: "validated",
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        source_url: sourceUrl,
      },
      untouchedRejected,
      untouchedOtherApp,
    ],
  };

  const result = bindPublisherVideoPolicyToSegmentReport({
    segmentReport,
    decision,
    storyId,
    evidenceFile: "C:\\proof\\microsoft-game-content-rules.html",
    evidenceSha256: "a".repeat(64),
    evidenceSizeBytes: 4096,
  });

  assert.equal(result.summary.bound_segment_count, 1);
  assert.equal(result.summary.eligible_segment_count, 1);
  const bound = result.report.segments[0];
  assert.equal(bound.status, "validated");
  assert.equal(bound.licence_basis, decision.licence_basis);
  assert.deepEqual(bound.allowed_platforms, ["youtube"]);
  assert.equal(bound.commercial_use_allowed, true);
  assert.equal(bound.rights_grant, true);
  assert.equal(bound.evidence_kind, "publisher_video_policy");
  assert.equal(bound.evidence_sha256, "a".repeat(64));
  assert.equal(bound.evidence_size_bytes, 4096);
  assert.equal(bound.verdict, "AMBER");
  assert.equal(bound.live_publish_allowed, false);
  assert.equal(bound.requires_human_legal_review_before_publish, true);
  assert.deepEqual(result.report.segments[1], untouchedRejected);
  assert.deepEqual(result.report.segments[2], untouchedOtherApp);
  assert.equal(segmentReport.segments[0].licence_basis, undefined);
});

test("publisher video policy evidence writes a hash-bound snapshot and held segment report", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-publisher-policy-"));
  t.after(() => fs.remove(root));
  const storyId = "rss_669d4232cf129214";
  const sourceUrl =
    "https://video.fastly.steamstatic.com/store_trailers/2806050/1326798026/hash/1781131704/dash_h264.mpd?t=1781134450";

  const result = await materializePublisherVideoPolicyEvidence({
    outputDir: root,
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    segmentReport: {
      schema_version: 1,
      segments: [{
        id: "validated",
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        source_url: sourceUrl,
      }],
    },
    storyId,
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
    generatedAt: "2026-07-21T17:30:00.000Z",
    fetchImpl: async () => new Response(policyHtml(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  });

  assert.equal(result.decision.verdict, "AMBER");
  assert.equal(result.summary.bound_segment_count, 1);
  assert.equal(result.safety.no_publish_triggered, true);
  assert.equal(result.safety.no_db_mutation, true);
  assert.equal(await fs.pathExists(result.policy_snapshot_path), true);
  assert.equal(await fs.pathExists(result.policy_bundle_path), true);
  assert.equal(await fs.pathExists(result.bound_segment_report_path), true);
  const bundle = await fs.readJson(result.policy_bundle_path);
  const snapshotBytes = await fs.readFile(result.policy_snapshot_path);
  assert.equal(bundle.policy_snapshot.sha256, result.policy_snapshot_sha256);
  assert.equal(bundle.policy_snapshot.size_bytes, snapshotBytes.length);
  const boundReport = await fs.readJson(result.bound_segment_report_path);
  assert.equal(
    boundReport.segments[0].evidence_file,
    result.policy_snapshot_path,
  );
  assert.equal(
    boundReport.segments[0].evidence_sha256,
    result.policy_snapshot_sha256,
  );
  assert.equal(boundReport.segments[0].verdict, "AMBER");
  assert.equal(boundReport.segments[0].live_publish_allowed, false);
});

test("candidate rights completeness cannot override an explicit live-publish hold", () => {
  assert.equal(completeRightsRecord({
    asset_id: "halo-policy-bound-clip",
    licence_basis: "microsoft_game_content_usage_rules_youtube_ad_program",
    allowed_use: "transformative_editorial_short_form",
    allowed_platforms: ["youtube"],
    commercial_use_allowed: true,
    approval_status: "approved_for_local_materialization_only",
    verdict: "GREEN",
    evidence_reference: OFFICIAL_XBOX_RULES_URL,
    live_publish_allowed: false,
    requires_human_legal_review_before_publish: true,
  }, ["youtube"]), false);
});

test("real-motion candidates preserve the policy AMBER verdict and live-publish hold", () => {
  const storyId = "rss_669d4232cf129214";
  const decision = evaluateXboxGameContentUsagePolicy({
    policyUrl: OFFICIAL_XBOX_RULES_URL,
    policyHtml: policyHtml(),
    gameName: "Halo: Campaign Evolved",
    itemTitle: "Halo's Remake Hits Game Pass On 28 July",
    sourceAppId: "2806050",
    targetPlatforms: ["youtube"],
  });
  const binding = bindPublisherVideoPolicyToSegmentReport({
    segmentReport: {
      segments: [{
        id: "validated-policy-window",
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        source_url:
          "https://video.fastly.steamstatic.com/store_trailers/2806050/trailer/hash/master.mp4",
        source_type: "steam_storefront_video_reference",
        source_family: "halo-steam-trailer-one",
        media_start_s: 6,
        duration_s: 5,
      }],
    },
    decision,
    storyId,
    evidenceFile: "C:\\proof\\microsoft-game-content-rules.html",
    evidenceSha256: "b".repeat(64),
    evidenceSizeBytes: 4096,
  });

  const candidates = candidateRows({
    segmentValidationReport: binding.report,
    storyId,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].verdict, "AMBER");
  assert.equal(
    candidates[0].approval_status,
    "approved_for_local_materialization_only",
  );
  assert.equal(candidates[0].live_publish_allowed, false);
  assert.equal(candidates[0].requires_human_legal_review_before_publish, true);
});
