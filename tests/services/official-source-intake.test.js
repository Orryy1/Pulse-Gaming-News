"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  buildOfficialSourceIntakeReport,
  renderOfficialSourceIntakeMarkdown,
} = require("../../lib/official-source-intake");
const {
  buildOfficialTrailerReferencePlan,
  buildOfficialTrailerReferenceReport,
} = require("../../lib/official-trailer-reference-resolver");
const { parseArgs, storiesFromPayload } = require("../../tools/official-source-intake");
const packageJson = require("../../package.json");

function story(overrides = {}) {
  return {
    id: "rss_gap",
    title: "GTA 6 owner passed on a sequel to a legacy franchise",
    full_script: "Take-Two fans are comparing GTA, Red Dead and BioShock after a legacy sequel was passed on.",
    source_type: "rss",
    subreddit: "GameSpot",
    flair: "Verified",
    score: 500,
    timestamp: "2026-05-07T12:00:00Z",
    ...overrides,
  };
}

function officialEntry(overrides = {}) {
  return {
    story_id: "rss_gap",
    entity: "Red Dead",
    official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
    source_title: "Red Dead Redemption 2 Official Trailer",
    source_owner: "Rockstar Games",
    source_type: "official_publisher_or_developer_trailer_page",
    source_family: "rockstar_red_dead_media_page",
    evidence_of_officialness: "Rockstar Games official website trailer page.",
    entity_match_notes: "Page title and URL are for Red Dead Redemption 2.",
    ...overrides,
  };
}

test("official source intake accepts entity-matched official references as reference-only", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [officialEntry()],
  });

  assert.equal(report.execution_mode, "report_only");
  assert.equal(report.will_download, false);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references.length, 1);

  const reference = report.accepted_references[0];
  assert.equal(reference.story_id, "rss_gap");
  assert.equal(reference.entity, "Red Dead");
  assert.equal(reference.provider, "official_intake");
  assert.equal(reference.source_type, "official_publisher_or_developer_trailer_page");
  assert.equal(reference.downloads_allowed, false);
  assert.equal(reference.allowed_render_use, "reference_only_by_default");
  assert.equal(reference.rights_risk_class, "official_reference_only");
  assert.deepEqual(reference.allowed_platforms, []);
  assert.equal(reference.commercial_use_allowed, false);
  assert.equal(reference.local_materialization_allowed, true);
  assert.equal(reference.live_publish_allowed, false);
  assert.equal(reference.requires_human_legal_review_before_publish, true);
  assert.equal(reference.approval_status, "approved_for_reference_validation_only");
  assert.equal(reference.rights_status, "official_identity_verified_rights_unresolved");
  assert.equal(reference.source_url_kind, "html_or_unknown_page");
  assert.equal(reference.segment_validation_eligible, false);
  assert.equal(reference.segment_validation_ineligible_reason, "segment_source_url_not_direct_media");
  assert.equal(reference.source_verified, true);
  assert.equal(reference.provenance.source, "operator_official_source_intake");
  assert.equal(reference.provenance.source_url_kind, "html_or_unknown_page");
  assert.equal(report.safety.video_downloads, false);
  assert.equal(report.safety.production_db_mutated, false);
});

test("official source intake preserves an explicit fail-closed publisher scope", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        licence_basis: "publisher_media_kit_pending_human_review",
        allowed_use: "local_transformative_editorial_proof",
        allowed_platforms: [],
        restricted_platforms: ["youtube", "tiktok", "instagram", "facebook", "x"],
        commercial_use_allowed: false,
        local_materialization_allowed: true,
        live_publish_allowed: false,
        requires_human_legal_review_before_publish: true,
        approval_status: "approved_for_local_materialization_only",
        rights_status: "publisher_assets_rights_unresolved",
        required_rules_link: "https://www.rockstargames.com/legal",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  const reference = report.accepted_references[0];
  assert.equal(reference.licence_basis, "publisher_media_kit_pending_human_review");
  assert.equal(reference.allowed_use, "local_transformative_editorial_proof");
  assert.deepEqual(reference.allowed_platforms, []);
  assert.deepEqual(reference.restricted_platforms, [
    "youtube",
    "tiktok",
    "instagram",
    "facebook",
    "x",
  ]);
  assert.equal(reference.commercial_use_allowed, false);
  assert.equal(reference.live_publish_allowed, false);
  assert.equal(reference.requires_human_legal_review_before_publish, true);
  assert.equal(reference.approval_status, "approved_for_local_materialization_only");
  assert.equal(reference.rights_status, "publisher_assets_rights_unresolved");
  assert.equal(reference.required_rules_link, "https://www.rockstargames.com/legal");
});

test("official press-kit still intake preserves its publisher reference page", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        id: "arkheron-press-kit",
        canonical_subject: "Arkheron",
        canonical_game: "Arkheron",
        title: "Arkheron beta rewards survive the test",
        full_script: "Arkheron has an official press kit for source-matched local visual proof.",
      }),
    ],
    entries: [
      officialEntry({
        story_id: "arkheron-press-kit",
        entity: "Arkheron",
        source_type: "official_press_kit_stills",
        source_owner: "Bonfire Studios",
        source_family: "arkheron_press_kit_screenshot_01",
        official_source_url:
          "https://drive.usercontent.google.com/download?id=arkheron-shot-1&export=download",
        reference_page_url: "https://www.arkheron.com/en_US/community-media-kit/",
        source_title: "Arkheron official press-kit screenshot 1",
        evidence_of_officialness:
          "Bonfire Studios links the screenshot folder from the official Arkheron media-kit page.",
        entity_match_notes: "The media-kit folder and screenshot identify Arkheron.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(
    report.accepted_references[0].source_url,
    "https://drive.usercontent.google.com/download?id=arkheron-shot-1&export=download",
  );
  assert.equal(
    report.accepted_references[0].reference_page_url,
    "https://www.arkheron.com/en_US/community-media-kit/",
  );
  assert.equal(
    report.accepted_references[0].provenance.reference_page_url,
    "https://www.arkheron.com/en_US/community-media-kit/",
  );
});

test("official press-kit still intake preserves hash-bound product-page and policy evidence", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        id: "xbox-held-still",
        canonical_subject: "Xbox",
        canonical_game: "Conker: Live and Reloaded",
        title: "Xbox classics reach PC",
        full_script: "Xbox is bringing selected classics to PC.",
      }),
    ],
    entries: [
      officialEntry({
        story_id: "xbox-held-still",
        entity: "Xbox",
        source_type: "official_press_kit_stills",
        source_owner: "Microsoft Studios",
        source_family: "conker_store_screenshot_03",
        official_source_url:
          "https://store-images.s-microsoft.com/image/apps.37949.conker.screen-three",
        reference_page_url:
          "https://www.xbox.com/en-US/games/store/conker-live-and-reloaded/BVFB8CBS75R6",
        source_title: "Conker official Xbox Store screenshot 3",
        evidence_of_officialness: "Declared in the official Xbox Store product payload.",
        entity_match_notes: "The product is named in the Xbox classics story.",
        product_page_evidence_path: "output/source/conker-xbox-store.html",
        product_page_evidence_sha256: "b".repeat(64),
        product_page_evidence_size_bytes: 700000,
        policy_evidence_path: "output/source/xbox-game-content-usage-rules.html",
        policy_evidence_sha256: "c".repeat(64),
        policy_evidence_size_bytes: 370000,
        licence_basis: "microsoft_game_content_usage_rules_youtube_ad_program",
        allowed_use: "transformative_editorial_short_form",
        allowed_platforms: ["youtube"],
        restricted_platforms: ["tiktok", "instagram", "facebook", "x"],
        commercial_use_allowed: true,
        local_materialization_allowed: true,
        live_publish_allowed: false,
        requires_human_legal_review_before_publish: true,
        approval_status: "approved_for_local_materialization_only",
        rights_status: "conditional_youtube_ad_program_scope",
        required_rules_link: "https://www.xbox.com/en-us/developers/rules",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  const reference = report.accepted_references[0];
  assert.equal(reference.product_page_evidence_path, "output/source/conker-xbox-store.html");
  assert.equal(reference.product_page_evidence_sha256, "b".repeat(64));
  assert.equal(reference.product_page_evidence_size_bytes, 700000);
  assert.equal(reference.policy_evidence_path, "output/source/xbox-game-content-usage-rules.html");
  assert.equal(reference.policy_evidence_sha256, "c".repeat(64));
  assert.equal(reference.policy_evidence_size_bytes, 370000);
});

test("official source intake matches clean operator entries against mojibake story manifests", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        id: "pokemon-go",
        title: "Mega Mewtwo Is Finally Coming To Pok\u00c3\u00a9mon Go",
        canonical_subject: "Pok\u00c3\u00a9mon Go",
        canonical_game: "Pok\u00c3\u00a9mon Go",
        full_script: "Mega Mewtwo is finally coming to Pok\u00c3\u00a9mon Go.",
      }),
    ],
    entries: [
      officialEntry({
        story_id: "pokemon-go",
        entity: "Pok\u00e9mon Go",
        official_source_url: "https://pokemongo.com/news/mega-mewtwo-gofest-2026",
        source_title: "Mewtwo Mega Evolves and more exciting GO Fest updates!",
        source_owner: "Pok\u00e9mon GO official website",
        source_type: "official_game_website_media_page",
        source_family: "pokemon_go_mega_mewtwo_gofest_2026_official_news",
        evidence_of_officialness: "Official Pok\u00e9mon GO website news page.",
        entity_match_notes: "Official page names Mega Mewtwo and Pok\u00e9mon GO Fest 2026.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].entity, "Pok\u00e9mon Go");
  assert.doesNotMatch(JSON.stringify(report), /Pok\u00c3|Ã|Â/);
});

test("official source intake rejects generic YouTube URLs without official evidence", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://www.youtube.com/watch?v=notofficial",
        source_title: "Red Dead trailer upload",
        source_owner: "",
        source_type: "official_youtube_channel_url",
        evidence_of_officialness: "",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 1);
  assert.equal(report.rejected_entries[0].reasons[0], "official_evidence_required_for_video_platform");
});

test("official source intake accepts official YouTube channel references only with evidence", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://www.youtube.com/watch?v=rockstar-official",
        source_title: "Red Dead Redemption 2: Official Trailer #3",
        source_owner: "Rockstar Games verified YouTube channel",
        source_type: "official_youtube_channel_url",
        evidence_of_officialness: "Official verified Rockstar Games YouTube channel.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.accepted_references[0].provider, "official_intake");
  assert.equal(report.accepted_references[0].downloads_allowed, false);
  assert.equal(report.accepted_references[0].source_url_kind, "youtube_watch");
  assert.equal(report.accepted_references[0].segment_validation_eligible, false);
  assert.equal(
    report.accepted_references[0].segment_validation_ineligible_reason,
    "segment_source_is_youtube_reference",
  );
});

test("official source intake accepts recommended official site and storefront aliases as reference-only", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        id: "pokemon-go-news",
        title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
        canonical_subject: "Pokémon Go",
        canonical_game: "Pokémon Go",
        full_script: "Mega Mewtwo is finally coming to Pokémon Go during GO Fest.",
      }),
      story({
        id: "super-mario-rpg-deal",
        title: "Super Mario RPG Drops To $15",
        canonical_subject: "Super Mario RPG",
        canonical_game: "Super Mario RPG",
        full_script: "Super Mario RPG is listed at a lower physical price.",
      }),
    ],
    entries: [
      officialEntry({
        story_id: "pokemon-go-news",
        entity: "Pokémon Go",
        official_source_url: "https://pokemongo.com/en/news/mega-mewtwo-gofest-2026",
        source_title: "Mewtwo Mega Evolves and more exciting GO Fest updates!",
        source_owner: "Official Pokémon GO website",
        source_type: "official_game_site_news_page",
        source_family: "pokemon_go_official_mega_mewtwo_gofest_2026",
        evidence_of_officialness: "Official Pokémon GO website news page.",
        entity_match_notes: "Official Pokémon GO page names Mega Mewtwo and GO Fest 2026.",
      }),
      officialEntry({
        story_id: "super-mario-rpg-deal",
        entity: "Super Mario RPG",
        official_source_url: "https://www.nintendo.com/us/store/products/super-mario-rpg-switch/",
        source_title: "Super Mario RPG for Nintendo Switch",
        source_owner: "Nintendo Official Site",
        source_type: "platform_storefront",
        source_family: "nintendo_store_super_mario_rpg_switch",
        evidence_of_officialness: "Official Nintendo product storefront page.",
        entity_match_notes: "The Nintendo storefront page is for Super Mario RPG.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 2);
  assert.equal(report.summary.rejected, 0);
  assert.deepEqual(
    report.accepted_references.map((reference) => reference.source_type),
    ["official_game_site_news_page", "platform_storefront"],
  );
  assert.ok(report.accepted_references.every((reference) => reference.downloads_allowed === false));
  assert.ok(report.accepted_references.every((reference) => reference.segment_validation_eligible === false));
});

test("official source intake accepts formal official titles for short canonical story labels", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        id: "gta-cover",
        canonical_subject: "GTA 6",
        canonical_game: "GTA 6",
        selected_title: "GTA 6 Just Got More Expensive",
        canonical_title:
          "GTA 6 pre-orders open next week, and to celebrate Rockstar has revealed its official cover art",
        full_script:
          "GTA 6 just turned cover art into a preorder watch. Rockstar revealed key art while players wait for store-page details.",
      }),
      story({
        id: "garfield-trailer",
        canonical_subject: "Garfield",
        canonical_game: "Garfield",
        canonical_title:
          "Garfield - Escape From Monday gameplay trailer teases the terror of The Curse of the Spinach Lasagna",
        full_script:
          "Garfield just showed the part trailers usually hide: how it plays. The new trailer shows real gameplay.",
      }),
    ],
    entries: [
      officialEntry({
        story_id: "gta-cover",
        entity: "Grand Theft Auto VI",
        official_source_url: "https://www.rockstargames.com/VI",
        source_title: "Grand Theft Auto VI official site",
        source_owner: "Rockstar Games official website",
        source_type: "official_game_website_media_page",
        source_family: "rockstar_gta_vi_official_site_20260618",
        evidence_of_officialness: "Official Rockstar Games page for Grand Theft Auto VI.",
        entity_match_notes: "The page is Rockstar's official Grand Theft Auto VI page.",
      }),
      officialEntry({
        story_id: "garfield-trailer",
        entity: "Garfield - Escape from Monday",
        official_source_url: "https://store.steampowered.com/app/3932790/Garfield__Escape_from_Monday/",
        source_title: "Garfield - Escape from Monday on Steam",
        source_owner: "Steam storefront for Microids / OSome Studio",
        source_type: "platform_storefront",
        source_family: "steam_garfield_escape_from_monday_storefront_20260618",
        evidence_of_officialness: "Official Steam product storefront listing Microids as publisher.",
        entity_match_notes: "The storefront is for Garfield - Escape from Monday.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 2);
  assert.equal(report.summary.rejected, 0);
  assert.deepEqual(
    report.accepted_references.map((reference) => reference.entity),
    ["Grand Theft Auto VI", "Garfield - Escape from Monday"],
  );
});

test("official source intake accepts official social direct video only with strict evidence", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        title: "Forza Horizon 6 is available now on Steam",
        full_script: "Forza Horizon 6 is pulling a huge Steam number and Xbox fans are watching closely.",
      }),
    ],
    entries: [
      officialEntry({
        entity: "Forza Horizon 6",
        official_source_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
        direct_media_url_if_available:
          "https://video-s.twimg.com/amplify_video/2021227162603339776/vid/avc1/1280x720/IbJGc42nnQTptud_.mp4?tag=14",
        source_title: "Lots to see in the lowlands #ForzaHorizon6",
        source_owner: "Official Forza Horizon verified X account",
        source_type: "official_social_media_video",
        source_family: "forza_horizon_official_x_fh6_lowlands_video",
        evidence_of_officialness:
          "Official verified @ForzaHorizon X post with direct media hosted on video-s.twimg.com.",
        entity_match_notes: "The official post and direct media are for Forza Horizon 6.",
        source_duration_s: 12,
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].source_type, "official_social_media_video");
  assert.equal(report.accepted_references[0].source_url_kind, "direct_video");
  assert.equal(report.accepted_references[0].segment_validation_eligible, true);
  assert.equal(report.accepted_references[0].downloads_allowed, false);
  assert.equal(
    report.accepted_references[0].reference_page_url,
    "https://x.com/ForzaHorizon/status/2021227288788947178",
  );
});

test("official source intake rejects social direct video when only entity notes match the story", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        id: "bethesda-layoffs-gap",
        title: "Bethesda Game Studios and ZeniMax Needs One Real Proof Point",
        canonical_subject: "Bethesda Game Studios and ZeniMax",
        full_script: "Bethesda Game Studios and ZeniMax layoffs are the story, not a racing game.",
      }),
    ],
    entries: [
      officialEntry({
        story_id: "bethesda-layoffs-gap",
        entity: "Bethesda Game Studios and ZeniMax",
        official_source_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
        direct_media_url_if_available:
          "https://video-s.twimg.com/amplify_video/2021227162603339776/vid/avc1/1280x720/IbJGc42nnQTptud_.mp4?tag=14",
        source_title: "",
        source_owner: "Forza Horizon official X - FH6 Lowlands video",
        source_type: "official_social_media_video",
        source_family: "forza_horizon_official_x_fh6_lowlands_video",
        evidence_of_officialness: "Forza Horizon official X - FH6 Lowlands video",
        entity_match_notes:
          "Must visibly match Bethesda Game Studios and ZeniMax and the story bethesda-layoffs-gap.",
        source_duration_s: 27.71,
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 1);
  assert.ok(report.rejected_entries[0].reasons.includes("entity_evidence_missing_or_wrong"));
});

test("official source intake rejects page references when only entity notes match the story", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        id: "bethesda-layoffs-gap",
        title: "Bethesda Game Studios and ZeniMax Needs One Real Proof Point",
        canonical_subject: "Bethesda Game Studios and ZeniMax",
        full_script: "Bethesda Game Studios and ZeniMax layoffs are the story, not Forza Horizon.",
      }),
    ],
    entries: [
      officialEntry({
        story_id: "bethesda-layoffs-gap",
        entity: "Bethesda Game Studios and ZeniMax",
        official_source_url: "https://forums.forza.net/t/fh6-calendar-and-announcements/797922",
        source_title: "",
        source_owner: "Forza official forums - FH6 resources calendar",
        source_type: "official_publisher_or_developer_trailer_page",
        source_family: "forza_official_forum_fh6_resources_calendar",
        evidence_of_officialness: "Forza official forums - FH6 resources calendar",
        entity_match_notes:
          "Must visibly match Bethesda Game Studios and ZeniMax and the story bethesda-layoffs-gap.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 1);
  assert.ok(report.rejected_entries[0].reasons.includes("entity_evidence_missing_or_wrong"));
});

test("official source intake rejects official social video without direct twimg media and evidence", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        title: "Forza Horizon 6 is available now on Steam",
        full_script: "Forza Horizon 6 is pulling a huge Steam number and Xbox fans are watching closely.",
      }),
    ],
    entries: [
      officialEntry({
        entity: "Forza Horizon 6",
        official_source_url: "https://x.com/randomfan/status/123",
        source_title: "Forza Horizon 6 clip repost",
        source_owner: "Random fan account",
        source_type: "official_social_media_video",
        source_family: "random_fan_forza_social_clip",
        evidence_of_officialness: "",
        entity_match_notes: "Forza Horizon 6 is mentioned in the post.",
      }),
      officialEntry({
        entity: "Forza Horizon 6",
        official_source_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
        direct_media_url_if_available: "https://cdn.example.com/forza-horizon-6-social.mp4",
        source_title: "Lots to see in the lowlands #ForzaHorizon6",
        source_owner: "Official Forza Horizon verified X account",
        source_type: "official_social_media_video",
        source_family: "forza_horizon_official_x_wrong_cdn",
        evidence_of_officialness: "Official verified @ForzaHorizon X post.",
        entity_match_notes: "The official post is for Forza Horizon 6.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 2);
  assert.ok(report.rejected_entries[0].reasons.includes("official_social_direct_media_required"));
  assert.ok(report.rejected_entries[0].reasons.includes("official_evidence_required_for_video_platform"));
  assert.ok(report.rejected_entries[1].reasons.includes("official_social_direct_media_host_not_allowed"));
});

test("official source intake marks direct media URLs as segment-validation eligible", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://cdn.rockstargames.com/reddead/gameplay-trailer.m3u8",
        source_type: "platform_storefront_video_reference",
        source_family: "rockstar_red_dead_direct_hls",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.accepted_references[0].source_url_kind, "hls_manifest");
  assert.equal(report.accepted_references[0].segment_validation_eligible, true);
  assert.equal(report.accepted_references[0].segment_validation_ineligible_reason, null);
  assert.equal(report.provenance_ledger[0].segment_validation_eligible, true);
});

test("official source intake accepts official product-page direct media", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        title: "PS5 Price Hike Rumour Hits Europe",
        canonical_subject: "PS5",
        full_script: "PS5 pricing is under scrutiny, but the product footage is only visual context.",
      }),
    ],
    entries: [
      officialEntry({
        entity: "PS5",
        official_source_url: "https://www.playstation.com/en-gb/ps5/",
        direct_media_url_if_available:
          "https://gmedia.playstation.com/is/content/SIEPDC/global_pdc/en/hardware/ps5/channel-specific-content/pdc/2025/overview/hero/ps5-overview-evergreen-hero-desktop-video-01-en-16oct25.mp4",
        source_title: "PS5 official product video",
        source_owner: "PlayStation",
        source_type: "official_platform_product_page",
        source_family: "playstation_ps5_product_page",
        evidence_of_officialness: "Official PlayStation product page for PS5.",
        entity_match_notes: "The page and media are for PS5 hardware.",
        source_duration_s: 9.88,
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].source_type, "official_platform_product_page");
  assert.equal(report.accepted_references[0].source_url_kind, "direct_video");
  assert.equal(report.accepted_references[0].segment_validation_eligible, true);
  assert.equal(report.accepted_references[0].allowed_render_use, "reference_only_by_default");
});

test("official source intake uses optional direct media URLs while preserving the reference page", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
        direct_media_url_if_available: "https://cdn.rockstargames.com/reddead/gameplay-trailer.m3u8",
        source_type: "official_publisher_or_developer_trailer_page",
        source_duration_s: 10,
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_entries[0].official_source_url, "https://www.rockstargames.com/reddeadredemption2/videos");
  assert.equal(
    report.accepted_entries[0].direct_media_url_if_available,
    "https://cdn.rockstargames.com/reddead/gameplay-trailer.m3u8",
  );
  assert.equal(report.accepted_references[0].source_url, "https://cdn.rockstargames.com/reddead/gameplay-trailer.m3u8");
  assert.equal(report.accepted_references[0].reference_page_url, "https://www.rockstargames.com/reddeadredemption2/videos");
  assert.equal(report.accepted_references[0].source_url_kind, "hls_manifest");
  assert.equal(report.accepted_references[0].segment_validation_eligible, true);
  assert.equal(report.accepted_references[0].source_duration_s, 10);
  assert.equal(report.accepted_references[0].provenance.source_duration_s, 10);
  assert.equal(
    report.accepted_references[0].provenance.reference_page_url,
    "https://www.rockstargames.com/reddeadredemption2/videos",
  );
  assert.equal(
    report.provenance_ledger[0].reference_page_url,
    "https://www.rockstargames.com/reddeadredemption2/videos",
  );
  assert.match(renderOfficialSourceIntakeMarkdown(report), /direct media/);
  assert.match(renderOfficialSourceIntakeMarkdown(report), /gameplay-trailer\.m3u8/);
});

test("official source intake rejects page URLs in the optional direct media field", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        direct_media_url_if_available: "https://www.youtube.com/watch?v=rockstar-official",
        source_owner: "Rockstar Games official YouTube channel",
        evidence_of_officialness: "Official verified Rockstar Games YouTube channel.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 1);
  assert.equal(report.rejected_entries[0].direct_media_url_if_available, "https://www.youtube.com/watch?v=rockstar-official");
  assert.ok(report.rejected_entries[0].reasons.includes("direct_media_field_contains_page_url"));
});

test("official source intake rejects raw image URLs as source references", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [
      story({
        id: "1tbpzah",
        canonical_subject: "Capturing",
        title: "Capturing mewtwo in the office shh (pokemon red version) game boy color og",
        full_script: "Capturing Mewtwo in Pokemon Red appears in an office photo.",
      }),
    ],
    entries: [
      officialEntry({
        story_id: "1tbpzah",
        entity: "Capturing",
        official_source_url: "https://i.redd.it/g9uhlr6g9u0h1.jpeg",
        source_title: "Capturing Mewtwo in Pokemon Red",
        source_owner: "Operator supplied image",
        source_type: "official_game_website_media_page",
        source_family: "raw_image_post",
        evidence_of_officialness: "Operator supplied image only.",
        entity_match_notes: "The image title mentions Capturing Mewtwo.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 1);
  assert.ok(report.rejected_entries[0].reasons.includes("raw_image_source_not_allowed"));
});

test("official source intake rejects social reposts, reuploads and duplicate URLs", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://www.tiktok.com/@someone/video/123",
        source_title: "Red Dead trailer repost",
        source_type: "social_media_repost",
        evidence_of_officialness: "TikTok repost.",
      }),
      officialEntry({
        official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos?utm_source=x",
      }),
      officialEntry({
        official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos#trailer",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 2);
  assert.ok(report.rejected_entries.some((entry) => entry.reasons.includes("social_or_repost_source_forbidden")));
  assert.ok(report.rejected_entries.some((entry) => entry.reasons.includes("duplicate_source_url")));
});

test("official source intake rejects wrong-entity references", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        entity: "Red Dead",
        official_source_url: "https://www.rockstargames.com/gta-v/videos",
        source_title: "Grand Theft Auto V Trailer",
        entity_match_notes: "This is a GTA page.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.rejected_entries[0].reasons[0], "entity_evidence_missing_or_wrong");
});

test("official source intake rejects entries that request downloads", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        downloads_allowed: true,
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.ok(report.rejected_entries[0].reasons.includes("downloads_requested"));
});

test("official source intake rejects logo/title-only video references", () => {
  const report = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [
      officialEntry({
        official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos/logo-loop",
        source_title: "Red Dead Redemption 2 Official Logo Loop",
        evidence_of_officialness: "Official Rockstar Games video page.",
        entity_match_notes: "Red Dead Redemption 2 title appears on the page.",
      }),
    ],
  });

  assert.equal(report.summary.accepted, 0);
  assert.ok(report.rejected_entries[0].reasons.includes("logo_or_title_only_reference"));
});

test("official source intake integrates with trailer resolver without enabling downloads", async () => {
  const intakeReport = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [officialEntry()],
  });

  const plan = await buildOfficialTrailerReferencePlan(story(), {
    officialSourceIntakeReport: intakeReport,
  });

  assert.equal(plan.references.length, 1);
  assert.equal(plan.references[0].provider, "official_intake");
  assert.equal(plan.references[0].entity, "Red Dead");
  assert.equal(plan.references[0].downloads_allowed, false);
  assert.equal(plan.references[0].segment_validation_eligible, false);
  assert.equal(plan.segment_validation_reference_counts.eligible, 0);
  assert.equal(plan.segment_validation_reference_counts.ineligible, 1);
  assert.equal(plan.summary_accepted_official_intake_references, 1);
  assert.equal(plan.safety.video_downloads, false);
  assert.ok(plan.provenance_ledger.some((item) => item.provider === "official_intake"));
});

test("official source intake contributes to resolver report counts and Markdown", async () => {
  const intakeReport = buildOfficialSourceIntakeReport({
    stories: [story()],
    entries: [officialEntry()],
  });
  const report = await buildOfficialTrailerReferenceReport([story()], {
    officialSourceIntakeReport: intakeReport,
  });
  const markdown = renderOfficialSourceIntakeMarkdown(intakeReport);

  assert.equal(report.summary.official_intake_references, 1);
  assert.match(markdown, /Official Source Intake/);
  assert.match(markdown, /Report-only/);
  assert.match(markdown, /Red Dead/);
});

test("official source intake CLI and package script are available", () => {
  const args = parseArgs([
    "node",
    "tools/official-source-intake.js",
    "--input",
    "test/input/official_sources.json",
    "--story-id",
    "rss_gap",
    "--json",
  ]);

  assert.equal(args.input, "test/input/official_sources.json");
  assert.equal(args.storyId, "rss_gap");
  assert.equal(args.json, true);
  const toolSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "official-source-intake.js"),
    "utf8",
  );
  assert.match(toolSource, /dotenv.*config/s);
  assert.match(packageJson.scripts["media:intake-official-sources"], /official-source-intake\.js/);
});

test("official source intake CLI accepts governed package story JSON overrides", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pulse-official-source-story-json-"));
  const storyPath = path.join(dir, "story.json");
  const inputPath = path.join(dir, "official-sources.json");
  const outputJson = path.join(dir, "report.json");
  const outputMd = path.join(dir, "report.md");

  fs.writeFileSync(
    storyPath,
    JSON.stringify({
      id: "package_story_red_dead",
      title: "Red Dead Redemption 2 trailer update",
      full_script: "Red Dead Redemption 2 has a new official trailer reference for a visual repair pass.",
      source_type: "rss",
      subreddit: "Rockstar",
      flair: "Verified",
      timestamp: "2026-05-07T12:00:00Z",
    }),
  );
  fs.writeFileSync(
    inputPath,
    JSON.stringify([
      officialEntry({
        story_id: "package_story_red_dead",
        official_source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
      }),
    ]),
  );

  const result = spawnSync(
    process.execPath,
    [
      "tools/official-source-intake.js",
      "--story-json",
      storyPath,
      "--input",
      inputPath,
      "--output-json",
      outputJson,
      "--output-md",
      outputMd,
      "--json",
    ],
    {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(outputJson, "utf8"));
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].story_id, "package_story_red_dead");
  assert.match(result.stdout, /package_story_red_dead/);
});

test("official source intake CLI accepts governed story_id without legacy id", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pulse-official-source-story-id-json-"));
  const storyPath = path.join(dir, "story.json");
  const inputPath = path.join(dir, "official-sources.json");
  const outputJson = path.join(dir, "report.json");
  const outputMd = path.join(dir, "report.md");

  fs.writeFileSync(
    storyPath,
    JSON.stringify({
      story_id: "package_story_ps5",
      canonical_subject: "PS5",
      title: "PS5 Price Hike Rumour Hits Europe",
      full_script: "PS5 pricing is under scrutiny, with official product footage used only as visual context.",
      source_type: "rss",
      subreddit: "Eurogamer",
      flair: "Verified",
      timestamp: "2026-05-07T12:00:00Z",
    }),
  );
  fs.writeFileSync(
    inputPath,
    JSON.stringify([
      officialEntry({
        story_id: "package_story_ps5",
        entity: "PS5",
        official_source_url: "https://www.playstation.com/en-gb/ps5/",
        direct_media_url_if_available:
          "https://gmedia.playstation.com/is/content/SIEPDC/global_pdc/en/hardware/ps5/channel-specific-content/pdc/2025/overview/hero/ps5-overview-evergreen-hero-desktop-video-01-en-16oct25.mp4",
        source_type: "official_platform_product_page",
        source_family: "playstation_ps5_product_page",
        source_owner: "PlayStation",
        evidence_of_officialness: "Official PlayStation product page for PS5.",
        entity_match_notes: "The page and media are for PS5 hardware.",
      }),
    ]),
  );

  const result = spawnSync(
    process.execPath,
    [
      "tools/official-source-intake.js",
      "--story-json",
      storyPath,
      "--input",
      inputPath,
      "--output-json",
      outputJson,
      "--output-md",
      outputMd,
      "--json",
    ],
    {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(outputJson, "utf8"));
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].story_id, "package_story_ps5");
});

test("official source intake CLI filters governed story_id with --story-id", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pulse-official-source-story-id-filter-"));
  const storyPath = path.join(dir, "story.json");
  const inputPath = path.join(dir, "official-sources.json");
  const outputJson = path.join(dir, "report.json");
  const outputMd = path.join(dir, "report.md");

  fs.writeFileSync(
    storyPath,
    JSON.stringify({
      story_id: "package_story_zero_company",
      canonical_subject: "Star Wars Zero Company",
      canonical_game: "Star Wars Zero Company",
      title: "Star Wars Zero Company Is More Than XCOM",
      full_script: "Star Wars Zero Company is using official gameplay as visual context for a source-safe repair pass.",
      source_type: "rss",
      subreddit: "PC Gamer",
      flair: "Verified",
      timestamp: "2026-05-07T12:00:00Z",
    }),
  );
  fs.writeFileSync(
    inputPath,
    JSON.stringify([
      officialEntry({
        story_id: "package_story_zero_company",
        entity: "Star Wars Zero Company",
        official_source_url: "https://www.ea.com/en/games/starwars/zero-company/news/introducing-star-wars-zero-company",
        source_type: "official_publisher_or_developer_trailer_page",
        source_family: "ea_star_wars_zero_company_official_news_page",
        source_owner: "Electronic Arts / Star Wars Zero Company",
        evidence_of_officialness: "EA-hosted official Star Wars Zero Company news page.",
        entity_match_notes: "The official page names Star Wars Zero Company.",
      }),
    ]),
  );

  const result = spawnSync(
    process.execPath,
    [
      "tools/official-source-intake.js",
      "--story-json",
      storyPath,
      "--story-id",
      "package_story_zero_company",
      "--input",
      inputPath,
      "--output-json",
      outputJson,
      "--output-md",
      outputMd,
      "--json",
    ],
    {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(outputJson, "utf8"));
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].story_id, "package_story_zero_company");
});

test("official source intake CLI accepts goal package story JSON payloads", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pulse-official-source-goal-package-"));
  const storyPath = path.join(dir, "story-packages.json");
  const inputPath = path.join(dir, "official-sources.json");
  const outputJson = path.join(dir, "report.json");
  const outputMd = path.join(dir, "report.md");

  fs.writeFileSync(
    storyPath,
    JSON.stringify({
      packages: [
        {
          story_id: "rss_granblue",
          artifact_dir: "output/example/rss_granblue",
          canonical_story_manifest: {
            story_id: "rss_granblue",
            canonical_subject: "Granblue Fantasy: Relink",
            canonical_game: "Granblue Fantasy: Relink",
            selected_title: "Granblue Relink Demo Has A Reinstall Catch",
            narration_script:
              "Granblue Fantasy: Relink has a fresh demo angle, and the official Steam page is only being used as source-safe visual evidence.",
          },
        },
      ],
    }),
  );
  fs.writeFileSync(
    inputPath,
    JSON.stringify([
      officialEntry({
        story_id: "rss_granblue",
        entity: "Granblue Fantasy: Relink",
        official_source_url: "https://store.steampowered.com/app/881020/Granblue_Fantasy_Relink/",
        direct_media_url_if_available:
          "https://video.fastly.steamstatic.com/store_trailers/881020/769005/hash/hls_264_master.m3u8",
        source_type: "platform_storefront",
        source_family: "steam_881020_granblue_fantasy_relink",
        source_owner: "Steam storefront for Granblue Fantasy: Relink",
        source_title: "Granblue Fantasy: Relink",
        evidence_of_officialness: "Steam official app page for Granblue Fantasy: Relink.",
        entity_match_notes: "The Steam app title names Granblue Fantasy: Relink.",
      }),
    ]),
  );

  const result = spawnSync(
    process.execPath,
    [
      "tools/official-source-intake.js",
      "--story-json",
      storyPath,
      "--input",
      inputPath,
      "--output-json",
      outputJson,
      "--output-md",
      outputMd,
      "--json",
    ],
    {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(outputJson, "utf8"));
  assert.equal(report.summary.stories, 1);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].story_id, "rss_granblue");
});

test("official source intake CLI hydrates goal package artifact directories", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pulse-official-source-artifact-dir-"));
  const artifactDir = path.join(dir, "goal-proof-batch", "rss_halo");
  const storyPath = path.join(dir, "story-packages.json");
  const inputPath = path.join(dir, "official-sources.json");
  const outputJson = path.join(dir, "report.json");
  const outputMd = path.join(dir, "report.md");
  await fs.promises.mkdir(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, "canonical_story_manifest.json"),
    JSON.stringify({
      story_id: "rss_halo",
      canonical_subject: "Halo: Campaign Evolved",
      canonical_game: "Halo",
      selected_title: "Why Halo: Campaign Evolved Could Split Players",
      narration_script:
        "Halo: Campaign Evolved has official storefront media for source-safe motion validation.",
    }),
  );
  fs.writeFileSync(
    storyPath,
    JSON.stringify([
      {
        story_id: "rss_halo",
        verdict: "RED",
        artifact_dir: artifactDir,
      },
    ]),
  );
  fs.writeFileSync(
    inputPath,
    JSON.stringify([
      officialEntry({
        story_id: "rss_halo",
        entity: "Halo: Campaign Evolved",
        official_source_url: "https://store.steampowered.com/app/2806050/Halo_Campaign_Evolved/",
        direct_media_url_if_available:
          "https://video.fastly.steamstatic.com/store_trailers/2806050/1326798026/hash/hls_264_master.m3u8",
        source_type: "platform_storefront",
        source_family: "steam_2806050_halo_campaign_evolved",
        source_owner: "Steam storefront for Halo: Campaign Evolved",
        source_title: "Halo: Campaign Evolved",
        evidence_of_officialness: "Steam official app page for Halo: Campaign Evolved.",
        entity_match_notes: "The Steam app title names Halo: Campaign Evolved.",
      }),
    ]),
  );

  const result = spawnSync(
    process.execPath,
    [
      "tools/official-source-intake.js",
      "--story-json",
      storyPath,
      "--input",
      inputPath,
      "--output-json",
      outputJson,
      "--output-md",
      outputMd,
      "--json",
    ],
    {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(outputJson, "utf8"));
  assert.equal(report.summary.stories, 1);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.accepted_references[0].story_id, "rss_halo");
});

test("official source intake story payload helper hydrates package manifests", () => {
  const rows = storiesFromPayload({
    packages: [
      {
        story_id: "outer",
        canonical_story_manifest: {
          story_id: "inner",
          canonical_subject: "Halo: Campaign Evolved",
        },
      },
    ],
  });

  assert.deepEqual(rows, [
    {
      story_id: "inner",
      canonical_story_manifest: {
        story_id: "inner",
        canonical_subject: "Halo: Campaign Evolved",
      },
      canonical_subject: "Halo: Campaign Evolved",
    },
  ]);

  const arrayRows = storiesFromPayload([
    {
      story_id: "outer-array",
      canonical_story_manifest: {
        story_id: "inner-array",
        canonical_subject: "Granblue Fantasy: Relink",
      },
    },
  ]);
  assert.equal(arrayRows[0].story_id, "inner-array");
  assert.equal(arrayRows[0].canonical_subject, "Granblue Fantasy: Relink");
});
