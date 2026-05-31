"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildStudioGovernanceReport,
  collectPublishAssets,
  writeStudioGovernanceArtifacts,
} = require("../../lib/studio-governance-engine");

const GOOD_SCRIPT =
  "Mixtape just dodged one of gaming's most annoying problems. " +
  "Games with licensed music can disappear later when those rights expire. " +
  "Rock Paper Shotgun reports that Mixtape's developer paid extra so the music licences last in perpetuity. " +
  "That matters because the soundtrack is part of the game's identity. " +
  "So this is not just a soundtrack detail. It is a preservation win players can actually understand. " +
  "Follow Pulse Gaming for the gaming stories behind the headline.";

function cleanStory(overrides = {}) {
  return {
    id: "mixtape-governance",
    channel_id: "pulse-gaming",
    canonical_subject: "Mixtape",
    canonical_angle: "developer paid extra for lasting music rights",
    title:
      "Mixtape will be safe from a music licensing related delisting, ensured by its developer paying extra for the privilege",
    suggested_title: "Mixtape Just Avoided Gaming's Delisting Trap",
    public_title: "Mixtape Just Avoided Gaming's Delisting Trap",
    suggested_thumbnail_text: "MIXTAPE WON'T VANISH",
    thumbnail_source_label: "Rock Paper Shotgun",
    source_card_label: "Rock Paper Shotgun",
    source_type: "reddit",
    subreddit: "Games",
    url: "https://www.reddit.com/r/Games/comments/example/mixtape/",
    article_url:
      "https://www.rockpapershotgun.com/mixtape-will-be-safe-from-a-music-licensing-related-delisting",
    primary_source: "Rock Paper Shotgun",
    discovery_source: "r/Games",
    full_script: GOOD_SCRIPT,
    description:
      "Mixtape's developer says the game paid extra for lasting music rights. Sources and related links are on the story page.",
    pinned_comment: "Sources and related notes are on the story page.",
    manual_caption_generated: true,
    caption_path: "output/captions/mixtape-governance.srt",
    exported_path: "output/final/mixtape-governance.mp4",
    audio_path: "output/audio/mixtape-governance.mp3",
    downloaded_images: [
      {
        id: "mixtape-key-art",
        type: "article_hero",
        path: "output/images/mixtape-key-art.jpg",
        source_url:
          "https://www.rockpapershotgun.com/mixtape-will-be-safe-from-a-music-licensing-related-delisting",
        rights_risk_class: "article_editorial_reference",
        source_type: "article_image",
      },
    ],
    video_clips: [
      {
        id: "mixtape-official-trailer",
        type: "official_trailer_clip",
        path: "output/video/mixtape-official-trailer.mp4",
        source_url: "https://www.youtube.com/@AnnapurnaInteractive",
        rights_risk_class: "official_reference_only",
        source_type: "official_trailer",
        source_family: "annapurna",
      },
    ],
    affiliate_link_manifest: {
      story_id: "mixtape-governance",
      vertical: "gaming",
      disclosure_required: false,
      primary_link: null,
      fallback_links: [],
      platform_disclosure: {
        youtube: { affiliate_disclosure_required: false },
      },
    },
    platform_disclosures: {
      youtube: { paid_promotion: false, altered_or_synthetic: false },
      tiktok: { ai_generated_content_label: false },
    },
    ai_usage: {
      realistic_altered_or_synthetic: false,
      label_required: false,
    },
    ...overrides,
  };
}

function rightsLedgerFor(story = cleanStory()) {
  return [
    {
      asset_id: "mixtape-key-art",
      path: "output/images/mixtape-key-art.jpg",
      source_url:
        "https://www.rockpapershotgun.com/mixtape-will-be-safe-from-a-music-licensing-related-delisting",
      source_type: "article_image",
      licence_basis: "editorial_source_reference",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      expiry: null,
      credit_required: false,
      commercial_use_allowed: true,
      risk_score: 0.24,
      evidence_file: "rights/mixtape-key-art.json",
    },
    {
      asset_id: "mixtape-official-trailer",
      path: "output/video/mixtape-official-trailer.mp4",
      source_url: "https://www.youtube.com/@AnnapurnaInteractive",
      source_type: "official_trailer",
      licence_basis: "official_reference_transformative_short",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      expiry: null,
      credit_required: false,
      commercial_use_allowed: true,
      risk_score: 0.18,
      evidence_file: "rights/mixtape-official-trailer.json",
    },
    {
      asset_id: "mixtape-governance-audio",
      path: story.audio_path,
      source_url: "local://tts/liam",
      source_type: "local_tts_voice",
      licence_basis: "owned_local_voice_model",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      expiry: null,
      credit_required: false,
      commercial_use_allowed: true,
      risk_score: 0.05,
      evidence_file: "rights/local-tts-liam.json",
    },
  ];
}

test("Studio Governance Engine returns GREEN with the required publish artefacts for a coherent story", () => {
  const story = cleanStory();
  const report = buildStudioGovernanceReport({
    story,
    rightsLedger: rightsLedgerFor(story),
    recentVideos: [
      {
        id: "older-story",
        title: "Steam Deck OLED Storage Catch Explained",
        cta: "Story page has sources and setup checks.",
        footage_families: ["valve"],
      },
    ],
    generatedAt: "2026-05-20T09:00:00.000Z",
  });

  assert.equal(report.publish_manifest.publish_status, "GREEN");
  assert.equal(report.publish_manifest.can_auto_publish, true);
  assert.equal(report.publish_control_tower.verdict, "GREEN");
  assert.equal(report.canonical_story_manifest.canonical_subject, "Mixtape");
  assert.equal(report.public_output_coherence_gate.result, "pass");
  assert.equal(report.rights_ledger.verdict, "pass");
  assert.equal(report.platform_policy_gate.verdict, "pass");
  assert.equal(report.affiliate_disclosure_gate.verdict, "pass");
  assert.equal(report.ai_disclosure_gate.verdict, "pass");
  assert.equal(report.reused_content_risk_gate.verdict, "pass");
  assert.equal(report.anti_spam_uniqueness_gate.verdict, "pass");
  assert.equal(report.finance_crypto_firewall.verdict, "pass");
  assert.deepEqual(report.rejection_reasons.reason_codes, []);
  assert.equal(report.audit_log.events.at(-1).event, "publish_control_tower:GREEN");
  assert.equal(report.correction_plan.actions.length, 0);
});

// goal-test:missing_rights_record_rejection
// goal-test:affiliate_disclosure_rejection
// goal-test:repeated_visual_pattern_rejection
// goal-test:repeated_cta_rejection
test("Studio Governance Engine hard-fails leaked templates, missing rights, messy captions and missing disclosures", () => {
  const story = cleanStory({
    suggested_title: "This gaming story",
    public_title: "This gaming story",
    suggested_thumbnail_text:
      "MIXTAPE WILL BE SAFE FROM A MUSIC LICENSING RELATED DELISTING",
    thumbnail_source_label: "r/Games",
    source_card_label: "r/Games",
    manual_caption_generated: false,
    caption_path: "",
    subtitle_timing_source: "synthetic_fallback",
    subtitle_timing_inspection: { usable: false, reason: "no_word_timestamps" },
    full_script:
      "This gaming story just got a source backed update. " +
      "The useful caveat is that this is one sourced update, not a blank check to invent extra details. " +
      "Treat the headline as confirmed only where the named source confirms it. " +
      "Everything else stays in the wait-and-see column until an official post backs it up.",
    affiliate_link_manifest: {
      story_id: "mixtape-governance",
      vertical: "gaming",
      disclosure_required: true,
      primary_link: {
        id: "controller",
        url: "https://www.amazon.co.uk/s?k=xbox+controller&tag=pulsegaming-21",
      },
      disclosure_copy: {},
      platform_disclosure: {
        youtube: { affiliate_disclosure_required: true, caption_copy: "" },
      },
    },
    platform_disclosures: {
      youtube: { paid_promotion: true, paid_promotion_toggle: false },
      tiktok: { ai_generated_content_label: false },
    },
    ai_usage: {
      realistic_altered_or_synthetic: true,
      label_required: true,
    },
  });

  const report = buildStudioGovernanceReport({
    story,
    rightsLedger: [],
    recentVideos: [
      {
        id: "recent-same",
        title: "This gaming story",
        cta: "Follow Pulse Gaming so you never miss a beat.",
        footage_families: ["annapurna"],
      },
    ],
    generatedAt: "2026-05-20T09:05:00.000Z",
  });

  assert.equal(report.publish_manifest.publish_status, "RED");
  assert.equal(report.publish_manifest.can_auto_publish, false);
  assert.ok(report.rejection_reasons.reason_codes.includes("public_output:generic_title"));
  assert.ok(report.rejection_reasons.reason_codes.includes("public_output:canonical_subject_missing_from_title"));
  assert.ok(report.rejection_reasons.reason_codes.includes("public_output:canonical_subject_missing_from_first_3_seconds"));
  assert.ok(report.rejection_reasons.reason_codes.includes("public_output:thumbnail_source_mismatch"));
  assert.ok(report.rejection_reasons.reason_codes.includes("public_output:internal_qa_language"));
  assert.ok(report.rejection_reasons.reason_codes.includes("rights:no_rights_record"));
  assert.ok(report.rejection_reasons.reason_codes.includes("policy:youtube_paid_promotion_disclosure_missing"));
  assert.ok(report.rejection_reasons.reason_codes.includes("policy:ai_disclosure_required_missing"));
  assert.ok(report.rejection_reasons.reason_codes.includes("commercial:affiliate_disclosure_required_missing"));
  assert.ok(report.rejection_reasons.reason_codes.includes("uniqueness:too_similar_recent_output"));
  assert.ok(report.rejection_reasons.reason_codes.includes("captions:missing_or_messy"));
  assert.ok(report.correction_plan.actions.length >= 5);
});

// goal-test:finance_crypto_unsafe_wording_rejection
test("Studio Governance Engine blocks finance and crypto promotion without approval", () => {
  const story = cleanStory({
    id: "crypto-governance",
    channel_id: "stacked",
    canonical_subject: "Bitcoin",
    public_title: "Bitcoin Could Pump After This Exchange Move",
    suggested_title: "Bitcoin Could Pump After This Exchange Move",
    suggested_thumbnail_text: "BITCOIN PUMP?",
    full_script:
      "Bitcoin could pump after this exchange move. Buy now before the next leg because leverage traders may get a huge upside.",
    description: "Crypto sources and affiliate links.",
    downloaded_images: [],
    video_clips: [],
    affiliate_link_manifest: {
      story_id: "crypto-governance",
      vertical: "crypto",
      disclosure_required: true,
      primary_link: { id: "exchange", url: "https://example.com/ref" },
      platform_disclosure: { youtube: { affiliate_disclosure_required: true, caption_copy: "#Ad" } },
    },
  });

  const report = buildStudioGovernanceReport({
    story,
    rightsLedger: [
      {
        asset_id: "crypto-governance-audio",
        path: story.audio_path,
        source_type: "local_tts_voice",
        licence_basis: "owned_local_voice_model",
        allowed_platforms: ["youtube"],
        commercial_use_allowed: true,
        risk_score: 0.05,
      },
    ],
    generatedAt: "2026-05-20T09:10:00.000Z",
  });

  assert.equal(report.publish_manifest.publish_status, "RED");
  assert.ok(report.rejection_reasons.reason_codes.includes("finance_crypto:promotion_without_approval"));
});

test("Studio Governance Engine uses V4 bridge provenance instead of rights-less materialised clip strings", () => {
  const sourceUrl = "https://video.twimg.com/amplify_video/forza/vid/avc1/1280x720/gameplay.mp4";
  const story = cleanStory({
    id: "forza-v4-bridge",
    canonical_subject: "Forza Horizon 6",
    canonical_angle: "available now on Steam with strong player demand",
    public_title: "Forza Horizon 6 Just Hit Steam Hard",
    suggested_title: "Forza Horizon 6 Just Hit Steam Hard",
    suggested_thumbnail_text: "FORZA HIT STEAM",
    thumbnail_source_label: "IGN",
    source_card_label: "IGN",
    primary_source: "IGN",
    discovery_source: "IGN",
    article_url: "https://www.ign.com/articles/forza-horizon-6-steam",
    description:
      "Forza Horizon 6 hit Steam with strong player demand. Sources and setup notes are on the story page.",
    full_script:
      "Forza Horizon 6 just hit Steam with the kind of number Xbox wanted. " +
      "The useful part is not just the peak. It shows how much demand is still waiting on PC. " +
      "That matters for Game Pass, wheel setups and the next wave of Xbox releases. " +
      "Follow Pulse Gaming for the gaming stories behind the headline.",
    downloaded_images: [],
    video_clips: ["C:/render-cache/forza-v4-bridge_clip_1.mp4"],
    visual_v4_bridge_video_clips: [
      {
        id: "forza_motion_01",
        type: "motion_clip",
        path: "C:/render-cache/forza-v4-bridge_clip_1.mp4",
        source_url: sourceUrl,
        source_type: "official_direct_media_reference",
        source_family: "forza_horizon_official_x_fh6_gameplay",
        rights_risk_class: "official_reference_only",
      },
    ],
  });

  const assets = collectPublishAssets(story).filter((asset) => asset.kind === "video");
  assert.equal(assets.length, 1);
  assert.equal(assets[0].asset_id, "forza_motion_01");
  assert.equal(assets[0].source_url, sourceUrl);

  const report = buildStudioGovernanceReport({
    story,
    rightsLedger: [
      {
        asset_id: "forza_motion_01",
        source_url: sourceUrl,
        source_type: "official_direct_media_reference",
        licence_basis: "official_reference_transformative_short",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
        commercial_use_allowed: true,
        risk_score: 0.18,
        evidence_file: "rights/forza_motion_01.json",
      },
      {
        asset_id: "forza-v4-bridge_audio_path",
        path: story.audio_path,
        source_type: "local_tts_voice",
        licence_basis: "owned_local_voice_model",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
        commercial_use_allowed: true,
        risk_score: 0.05,
        evidence_file: "rights/local-tts.json",
      },
    ],
    generatedAt: "2026-05-20T09:12:00.000Z",
  });

  assert.equal(report.rights_ledger.verdict, "pass");
  assert.equal(report.publish_manifest.publish_status, "GREEN");
});

test("Studio Governance Engine scopes final V4 rights checks to director-selected render assets", () => {
  const selectedPath = "C:/render-cache/valorant-selected-official-motion.mp4";
  const sameIdUnusedPath = "C:/render-cache/valorant-unused-same-id-motion.mp4";
  const unusedStillPath = "C:/render-cache/valorant-unused-igdb-still.mp4";
  const selectedSource =
    "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news/valorant-official-motion.mp4";
  const story = cleanStory({
    id: "valorant-v4-final",
    canonical_subject: "Valorant",
    canonical_angle: "Vanguard anti-cheat trust problem",
    public_title: "Valorant's Vanguard Trust Problem",
    suggested_title: "Valorant's Vanguard Trust Problem",
    suggested_thumbnail_text: "VALORANT VANGUARD PANIC",
    thumbnail_source_label: "PCGamesN",
    source_card_label: "PCGamesN",
    primary_source: "PCGamesN",
    discovery_source: "r/pcgaming",
    article_url: "https://www.pcgamesn.com/valorant/vanguard-update-bricking-pcs-riot-response",
    description: "Valorant's Vanguard update has a trust problem. Source: PCGamesN.",
    full_script:
      "Valorant's Vanguard update has a nasty trust problem. " +
      "PCGamesN reports the anti-cheat drama centres on cheaters claiming bricked PCs. " +
      "Riot fired back with the paperweight line, but the bigger player question is trust. " +
      "Follow Pulse Gaming for the gaming stories behind the headline.",
    render_lane: "visual_v4_production",
    visual_v4_director_plan: {
      shot_plan: [
        {
          id: "motion_clip_01",
          kind: "motion_clip",
          motion_pack_clip_id: "selected_official_motion",
          media_path: selectedPath,
        },
      ],
    },
    visual_v4_bridge_video_clips: [
      {
        id: "selected_official_motion",
        path: selectedPath,
        source_url: selectedSource,
        source_type: "licensed_direct_media_url",
        source_family: "riot_valorant_official_motion",
      },
      {
        id: "selected_official_motion",
        path: sameIdUnusedPath,
        source_url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news/unused-official-motion.mp4",
        source_type: "licensed_direct_media_url",
        source_family: "riot_valorant_unused_official_motion",
      },
      {
        id: "unused_igdb_still",
        path: unusedStillPath,
        source_url: "C:/image-cache/valorant-igdb-still.jpg",
        source_type: "screenshot",
        source_family: "igdb_valorant_still",
      },
    ],
    video_clips: [
      {
        id: "selected_official_motion",
        path: selectedPath,
        source_url: selectedSource,
        source_type: "licensed_direct_media_url",
        source_family: "riot_valorant_official_motion",
      },
      {
        id: "selected_official_motion",
        path: sameIdUnusedPath,
        source_url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news/unused-official-motion.mp4",
        source_type: "licensed_direct_media_url",
        source_family: "riot_valorant_unused_official_motion",
      },
      {
        id: "unused_igdb_still",
        path: unusedStillPath,
        source_url: "C:/image-cache/valorant-igdb-still.jpg",
        source_type: "screenshot",
        source_family: "igdb_valorant_still",
      },
    ],
  });

  const assets = collectPublishAssets(story).filter((asset) => asset.kind === "video");
  assert.deepEqual(
    assets.map((asset) => asset.asset_id),
    ["selected_official_motion"],
  );

  const report = buildStudioGovernanceReport({
    story,
    rightsLedger: [
      {
        asset_id: "selected_official_motion",
        path: selectedPath,
        source_url: selectedSource,
        source_type: "licensed_direct_media_url",
        licence_basis: "official_reference_transformative_short",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
        commercial_use_allowed: true,
        risk_score: 0.18,
      },
      {
        asset_id: "unused_igdb_still",
        path: unusedStillPath,
        source_type: "screenshot",
        licence_basis: "",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
        commercial_use_allowed: true,
        risk_score: 0.5,
      },
      {
        asset_id: "valorant-v4-final_audio_path",
        path: story.audio_path,
        source_type: "local_tts_voice",
        licence_basis: "owned_local_voice_model",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
        commercial_use_allowed: true,
        risk_score: 0.05,
      },
    ],
    generatedAt: "2026-05-31T02:00:00.000Z",
  });

  assert.equal(report.rights_ledger.verdict, "pass");
  assert.equal(report.publish_manifest.publish_status, "GREEN");

  const missingSelectedRights = buildStudioGovernanceReport({
    story,
    rightsLedger: [
      {
        asset_id: "unused_igdb_still",
        path: unusedStillPath,
        source_type: "screenshot",
        licence_basis: "",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
        commercial_use_allowed: true,
        risk_score: 0.5,
      },
      {
        asset_id: "valorant-v4-final_audio_path",
        path: story.audio_path,
        source_type: "local_tts_voice",
        licence_basis: "owned_local_voice_model",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
        commercial_use_allowed: true,
        risk_score: 0.05,
      },
    ],
    generatedAt: "2026-05-31T02:00:00.000Z",
  });

  assert.equal(missingSelectedRights.rights_ledger.verdict, "fail");
  assert.ok(missingSelectedRights.rejection_reasons.reason_codes.includes("rights:no_rights_record"));
});

test("Studio Governance Engine preserves repaired canonical manifests during refresh", () => {
  const canonical = {
    story_id: "1sqpa86",
    canonical_subject: "Xbox Controller",
    canonical_game: "Xbox Controller",
    canonical_title: "FH6 limited-edition Xbox controller and headset have just leaked",
    selected_title: "Xbox Controller Deal Has One Catch",
    short_title: "Xbox Controller Deal Has One Catch",
    thumbnail_headline: "XBOX CONTROLLER DEAL HAS ONE",
    primary_source: "Xbox",
    primary_source_url: "https://www.xbox.com/en-US/accessories/forza-horizon-6-xbox-wireless-controller-and-wireless-headset",
    discovery_source: "Reddit",
    official_source: "Xbox",
    official_confirmation_source:
      "https://www.xbox.com/en-US/accessories/forza-horizon-6-xbox-wireless-controller-and-wireless-headset",
    source_confidence_score: 0.96,
    confirmed_claims: [
      "Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories.",
    ],
    first_spoken_line: "Xbox controller deals are getting aggressive, but the catch is the retailer.",
    narration_script:
      "Xbox controller deals are getting aggressive, but the catch is the retailer. Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories. Follow Pulse Gaming for the gaming stories behind the headline.",
    description:
      "Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories. Source: Xbox.",
    pinned_comment: "Source: Xbox.",
    manual_caption_generated: true,
    audio_path: "output/audio/1sqpa86.mp3",
  };

  const report = buildStudioGovernanceReport({
    story: canonical,
    rightsLedger: [
      {
        asset_id: "1sqpa86_audio_path",
        path: canonical.audio_path,
        source_type: "local_tts_voice",
        licence_basis: "owned_local_voice_model",
        allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
        commercial_use_allowed: true,
        risk_score: 0.05,
      },
    ],
    generatedAt: "2026-05-25T05:00:00.000Z",
  });

  assert.equal(report.canonical_story_manifest.story_id, "1sqpa86");
  assert.equal(report.canonical_story_manifest.selected_title, "Xbox Controller Deal Has One Catch");
  assert.equal(report.canonical_story_manifest.short_title, "Xbox Controller Deal Has One Catch");
  assert.equal(report.canonical_story_manifest.thumbnail_headline, "XBOX CONTROLLER DEAL HAS ONE");
  assert.equal(report.canonical_story_manifest.first_spoken_line, canonical.first_spoken_line);
  assert.equal(report.public_output_coherence_gate.result, "pass");
  assert.equal(report.publish_control_tower.verdict, "GREEN");
});

// goal-test:green_amber_red_control_tower_verdicts
test("Studio Governance Engine writes the required JSON artefact bundle", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-governance-"));
  const story = cleanStory();
  const report = buildStudioGovernanceReport({
    story,
    rightsLedger: rightsLedgerFor(story),
    generatedAt: "2026-05-20T09:15:00.000Z",
  });

  const written = await writeStudioGovernanceArtifacts(report, { outputDir: tmp });

  assert.deepEqual(Object.keys(written).sort(), [
    "audit_log",
    "canonical_story_manifest",
    "claim_inventory",
    "coherence_report",
    "correction_plan",
    "correction_queue",
    "platform_policy_report",
    "publish_manifest",
    "publish_verdict",
    "rejection_reasons",
    "rights_ledger",
    "risk_report",
    "source_manifest",
  ]);
  for (const filePath of Object.values(written)) {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.ok(parsed);
  }
  assert.equal(
    JSON.parse(await fs.readFile(written.publish_manifest, "utf8")).publish_status,
    "GREEN",
  );
});
