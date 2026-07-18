"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFootageEmpirePlan,
} = require("../../lib/studio/v4/footage-empire");

function forzaSteamStory() {
  return {
    id: "forza-steam-v4",
    title: "Forza Horizon 6 Hits 92 on Metacritic, Steam Numbers Skyrocket",
    source_name: "Twisted Voxel",
    full_script:
      "Twisted Voxel says Forza Horizon 6 now sits on a 92 Metacritic aggregate, with SteamDB showing 178,009 concurrent users during Premium Edition early access, around $120 before standard launch.",
  };
}

function trustedRegistryReport() {
  const candidates = [
    ["xbox-official", "official", "xbox"],
    ["forza-official", "official", "forza"],
    ["steam-store", "official", "steam"],
    ["gamesradar", "official", "gamesradar"],
    ["ign", "official", "ign"],
    ["digitalfoundry", "licensed_creator", "digitalfoundry"],
    ["eurogamer", "official", "eurogamer"],
    ["gameinformer", "official", "gameinformer"],
  ].map(([sourceId, tier, family]) => ({
    story_id: "forza-steam-v4",
    entity: "Forza Horizon 6",
    source_id: sourceId,
    display_name: sourceId,
    source_tier: tier,
    source_family: family,
    reference_url: `https://example.test/${sourceId}`,
    source_url_kind: sourceId === "steam-store" ? "hls_manifest" : "web_page",
    segment_validation_eligible: sourceId === "steam-store",
    autonomous_motion_candidate: true,
    allowed_render_use:
      tier === "licensed_creator"
        ? "licensed_short_clip_candidate"
        : "reference_only_by_default",
    rights_risk_class:
      tier === "licensed_creator"
        ? "licensed_creator_clip"
        : "official_reference_only",
  }));

  return {
    schema_version: 1,
    story_candidates: candidates,
    accepted_sources: candidates.map((candidate) => ({
      source_id: candidate.source_id,
      display_name: candidate.display_name,
      source_tier: candidate.source_tier,
      source_family: candidate.source_family,
      reference_url: candidate.reference_url,
      source_url_kind: candidate.source_url_kind,
      segment_validation_eligible: candidate.segment_validation_eligible,
      autonomous_motion_candidate: candidate.autonomous_motion_candidate,
      allowed_render_use: candidate.allowed_render_use,
      rights_risk_class: candidate.rights_risk_class,
    })),
  };
}

test("Footage Empire blocks Visual V4 readiness when a Steam metric story lacks enough distinct local motion", () => {
  const plan = buildFootageEmpirePlan({
    story: forzaSteamStory(),
    trustedFootageReport: trustedRegistryReport(),
    localMotionClips: [
      {
        id: "clip-xbox-1",
        source_family: "xbox",
        path: "C:\\media\\xbox-1.mp4",
        durationS: 3.2,
        validated: true,
      },
      {
        id: "clip-forza-1",
        source_family: "forza",
        path: "C:\\media\\forza-1.mp4",
        durationS: 4.1,
        validated: true,
      },
      {
        id: "clip-steam-1",
        source_family: "steam",
        path: "C:\\media\\steam-1.mp4",
        durationS: 2.9,
        validated: true,
      },
    ],
  });

  assert.equal(plan.execution_mode, "footage_empire_v1");
  assert.equal(plan.local_only, true);
  assert.equal(plan.story_id, "forza-steam-v4");
  assert.equal(plan.readiness.status, "v4_motion_blocked");
  assert.ok(plan.readiness.blockers.includes("actual_motion_clip_minimum_not_met"));
  assert.ok(plan.readiness.blockers.includes("distinct_motion_families_minimum_not_met"));
  assert.ok(plan.motion_budget.required_distinct_families >= 6);
  assert.equal(plan.motion_budget.available_distinct_families, 3);
  assert.ok(plan.motion_budget.required_motion_scenes >= 7);
  assert.ok(plan.motion_budget.max_static_card_ratio <= 0.22);
  assert.equal(plan.clip_reuse_policy.max_uses_per_source_family, 2);
  assert.equal(plan.clip_reuse_policy.allow_repeated_clip_windows, false);
  assert.equal(plan.clip_reuse_policy.repeated_family_counts_as_fresh_motion, false);
  assert.ok(
    plan.next_actions.some(
      (item) => item.id === "queue_local_motion_intake_for_trusted_sources",
    ),
  );
  assert.equal(plan.safety.video_downloads_started, false);
  assert.equal(plan.safety.oauth_triggered, false);
  assert.equal(plan.safety.social_posting_triggered, false);
});

test("Footage Empire counts hash-distinct official storefront trailer windows as product motion", () => {
  const plan = buildFootageEmpirePlan({
    story: {
      id: "doom-ps5-pro-motion",
      title: "Doom The Dark Ages Becomes A PS5 Pro Test",
      canonical_game: "Doom: The Dark Ages",
      full_script:
        "Doom The Dark Ages is now a PS5 Pro hardware test because its latest update gives players a direct performance comparison.",
    },
    trustedFootageReport: {
      story_candidates: [
        {
          story_id: "doom-ps5-pro-motion",
          entity: "Doom: The Dark Ages",
          source_family: "steam_3017860_1777709634",
          source_tier: "official",
          reference_url:
            "https://video.akamai.steamstatic.com/store_trailers/3017860/1777709634/hash/hls_264_master.m3u8",
          source_url_kind: "hls_manifest",
          segment_validation_eligible: true,
          rights_risk_class: "official_reference_only",
          allowed_render_use: "reference_only_by_default",
        },
        {
          story_id: "doom-ps5-pro-motion",
          entity: "Doom: The Dark Ages",
          source_family: "steam_3017860_1887810588",
          source_tier: "official",
          reference_url:
            "https://video.akamai.steamstatic.com/store_trailers/3017860/1887810588/hash/hls_264_master.m3u8",
          source_url_kind: "hls_manifest",
          segment_validation_eligible: true,
          rights_risk_class: "official_reference_only",
          allowed_render_use: "reference_only_by_default",
        },
      ],
    },
    localMotionClips: [
      {
        id: "doom-window-1",
        source_family: "steam_3017860_1777709634",
        source_url:
          "https://video.akamai.steamstatic.com/store_trailers/3017860/1777709634/hash/hls_264_master.m3u8",
        path:
          "https://video.akamai.steamstatic.com/store_trailers/3017860/1777709634/hash/hls_264_master.m3u8",
        source_type: "steam_movie",
        provider: "steam",
        durationS: 5,
        mediaStartS: 36,
        validated: true,
        rights_risk_class: "official_reference_only",
        allowed_render_use: "reference_only_by_default",
        segment_motion_class: "gameplay_action",
        validation_reason: "official_storefront_trailer_motion_samples_passed",
        sample_content_hashes: ["doom-window-1-a", "doom-window-1-b"],
      },
      {
        id: "doom-window-2",
        source_family: "steam_3017860_1887810588",
        source_url:
          "https://video.akamai.steamstatic.com/store_trailers/3017860/1887810588/hash/hls_264_master.m3u8",
        path:
          "https://video.akamai.steamstatic.com/store_trailers/3017860/1887810588/hash/hls_264_master.m3u8",
        source_type: "steam_movie",
        provider: "steam",
        durationS: 5,
        mediaStartS: 78,
        validated: true,
        rights_risk_class: "official_reference_only",
        allowed_render_use: "reference_only_by_default",
        segment_motion_class: "gameplay_action",
        validation_reason: "official_storefront_trailer_motion_samples_passed",
        sample_content_hashes: ["doom-window-2-a", "doom-window-2-b"],
      },
    ],
  });

  assert.equal(plan.motion_budget.product_motion_story, true);
  assert.equal(plan.motion_budget.available_official_product_motion_clips, 2);
  assert.equal(plan.motion_budget.available_official_product_motion_families, 2);
  assert.equal(plan.readiness.blockers.includes("official_product_motion_clip_minimum_not_met"), false);
  assert.equal(plan.readiness.blockers.includes("official_product_motion_family_minimum_not_met"), false);
});

test("Footage Empire counts validated materialised storefront windows without reusing the same window", () => {
  const trustedFootageReport = {
    story_candidates: [
      {
        story_id: "doom-materialized-window-motion",
        entity: "Doom: The Dark Ages",
        source_family:
          "steamstatic:/store_trailers/3017860/1887810588/hash_window_36_5",
        source_tier: "official",
        reference_url:
          "https://video.akamai.steamstatic.com/store_trailers/3017860/1887810588/hash/hls_264_master.m3u8",
        source_url_kind: "hls_manifest",
        segment_validation_eligible: true,
        rights_risk_class: "official_reference_only",
        allowed_render_use: "reference_only_by_default",
      },
      {
        story_id: "doom-materialized-window-motion",
        entity: "Doom: The Dark Ages",
        source_family:
          "steamstatic:/store_trailers/3017860/1777709634/hash_window_42_5",
        source_tier: "official",
        reference_url:
          "https://video.akamai.steamstatic.com/store_trailers/3017860/1777709634/hash/hls_264_master.m3u8",
        source_url_kind: "hls_manifest",
        segment_validation_eligible: true,
        rights_risk_class: "official_reference_only",
        allowed_render_use: "reference_only_by_default",
      },
    ],
  };
  const baseClip = {
    path: "C:\\media\\doom-window.mp4",
    source_type: "steam_movie",
    durationS: 5,
    validated: true,
    rights_risk_class: "official_reference_only",
    allowed_render_use: "reference_only_by_default",
    validation_reason: "official_storefront_trailer_motion_samples_passed",
    sample_content_hashes: [],
    trusted_source_evidence: true,
  };
  const plan = buildFootageEmpirePlan({
    story: {
      id: "doom-materialized-window-motion",
      title: "Doom The Dark Ages Becomes A PS5 Pro Test",
      canonical_game: "Doom: The Dark Ages",
      full_script:
        "Doom The Dark Ages is now a PS5 Pro hardware test because its latest update gives players a direct performance comparison.",
    },
    trustedFootageReport,
    localMotionClips: [
      {
        ...baseClip,
        id: "doom-window-36",
        source_family:
          "steamstatic:/store_trailers/3017860/1887810588/hash_window_36_5",
        source_url:
          "https://video.akamai.steamstatic.com/store_trailers/3017860/1887810588/hash/hls_264_master.m3u8",
        mediaStartS: 36,
      },
      {
        ...baseClip,
        id: "doom-window-42",
        source_family:
          "steamstatic:/store_trailers/3017860/1777709634/hash_window_42_5",
        source_url:
          "https://video.akamai.steamstatic.com/store_trailers/3017860/1777709634/hash/hls_264_master.m3u8",
        mediaStartS: 42,
      },
      {
        ...baseClip,
        id: "doom-window-36-repeat",
        source_family:
          "steamstatic:/store_trailers/3017860/1887810588/hash_window_36_5",
        source_url:
          "https://video.akamai.steamstatic.com/store_trailers/3017860/1887810588/hash/hls_264_master.m3u8",
        mediaStartS: 36,
      },
    ],
  });

  assert.equal(plan.motion_budget.available_official_product_motion_clips, 3);
  assert.equal(plan.motion_budget.available_official_product_motion_families, 2);
  assert.equal(plan.motion_budget.hash_distinct_official_motion_windows, 2);
  assert.equal(plan.readiness.blockers.includes("official_product_motion_clip_minimum_not_met"), false);
  assert.equal(plan.readiness.blockers.includes("official_product_motion_family_minimum_not_met"), false);
});

test("Footage Empire does not count stills, cards, invalid clips or repeated source families as fresh motion", () => {
  const plan = buildFootageEmpirePlan({
    story: forzaSteamStory(),
    trustedFootageReport: trustedRegistryReport(),
    localMotionClips: [
      {
        id: "xbox-a",
        source_family: "xbox",
        path: "C:\\media\\xbox-a.mp4",
        durationS: 3,
        validated: true,
      },
      {
        id: "xbox-b",
        source_family: "xbox",
        path: "C:\\media\\xbox-b.mp4",
        durationS: 3,
        validated: true,
      },
      {
        id: "still-frame",
        source_family: "steam",
        path: "C:\\media\\steam.jpg",
        type: "still",
        durationS: 4,
        validated: true,
      },
      {
        id: "bad-clip",
        source_family: "forza",
        path: "C:\\media\\bad.mp4",
        durationS: 0.4,
        validated: true,
      },
      {
        id: "unvalidated",
        source_family: "ign",
        path: "C:\\media\\ign.mp4",
        durationS: 3,
        validated: false,
      },
    ],
  });

  assert.equal(plan.motion_budget.available_motion_clips, 2);
  assert.equal(plan.motion_budget.available_distinct_families, 1);
  assert.deepEqual(plan.motion_inventory.distinct_source_families, ["xbox"]);
  assert.ok(plan.readiness.blockers.includes("distinct_motion_families_minimum_not_met"));
  assert.ok(plan.motion_inventory.rejected_local_assets.some((asset) => asset.reason === "not_motion_video"));
  assert.ok(plan.motion_inventory.rejected_local_assets.some((asset) => asset.reason === "clip_too_short"));
  assert.ok(plan.motion_inventory.rejected_local_assets.some((asset) => asset.reason === "clip_not_validated"));
});

test("Footage Empire counts validated official DASH manifest clips as motion", () => {
  const plan = buildFootageEmpirePlan({
    story: {
      id: "granblue-dash-motion",
      title: "Granblue Fantasy: Relink Demo Is The Real Proof",
      full_script:
        "Granblue Fantasy: Relink has official storefront and PlayStation motion sources for a current demo story.",
    },
    trustedFootageReport: {
      accepted_sources: [
        {
          story_id: "granblue-dash-motion",
          entity: "Granblue Fantasy: Relink",
          source_id: "steam-881020-655426",
          display_name: "Steam official Granblue trailer",
          source_tier: "official",
          source_family: "steam_881020_655426",
          reference_url: "https://store.steampowered.com/app/881020/Granblue_Fantasy_Relink/",
          source_url_kind: "dash_manifest",
          segment_validation_eligible: true,
          autonomous_motion_candidate: true,
          allowed_render_use: "official_direct_media_segment_candidate",
          rights_risk_class: "official_direct_media",
        },
      ],
    },
    localMotionClips: [
      {
        id: "dash-motion",
        source_family: "steam_881020_655426",
        path: "https://video.fastly.steamstatic.com/store_trailers/881020/655426/hash/dash_h264.mpd?t=1",
        durationS: 5,
        validated: true,
        source_type: "official_platform_product_page",
        provider: "licensed_direct_media_acquisition",
        allowed_render_use: "official_direct_media_segment_candidate",
        rights_risk_class: "official_direct_media",
      },
    ],
  });

  assert.equal(plan.motion_budget.available_motion_clips, 1);
  assert.equal(plan.motion_budget.available_distinct_families, 1);
  assert.equal(plan.motion_inventory.accepted_local_clips[0].source_kind, "dash_manifest");
  assert.equal(plan.motion_inventory.accepted_local_clips[0].trusted_source_evidence, true);
  assert.equal(plan.motion_inventory.rejected_local_assets.length, 0);
});

test("Footage Empire prioritises licensed and segment-valid sources for local intake without starting downloads", () => {
  const plan = buildFootageEmpirePlan({
    story: forzaSteamStory(),
    trustedFootageReport: trustedRegistryReport(),
    localMotionClips: [],
  });

  assert.equal(plan.trusted_source_pipeline.references_found, 8);
  assert.equal(plan.trusted_source_pipeline.intake_queue.length, 8);
  assert.equal(plan.trusted_source_pipeline.intake_queue[0].source_family, "steam");
  assert.ok(
    plan.trusted_source_pipeline.intake_queue.some(
      (source) => source.source_tier === "licensed_creator",
    ),
  );
  assert.ok(
    plan.trusted_source_pipeline.intake_queue.every(
      (source) => source.downloads_started === false,
    ),
  );
  assert.equal(plan.safety.browser_scraping_started, false);
});

test("Footage Empire does not match short entity names inside unrelated story words", () => {
  const plan = buildFootageEmpirePlan({
    story: {
      id: "steam-controller-date",
      title: "The Steam controller release date may have been leaked online",
      full_script: "Valve may have a Steam Controller date, but the footage source must match the hardware story.",
    },
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "ea-star-wars-zero-company",
          display_name: "EA official Star Wars Zero Company trailer",
          source_tier: "official",
          source_family: "steam_star_wars_zero_company_announce_trailer",
          reference_url: "https://store.steampowered.com/app/2075800/STAR_WARS_Zero_Company/",
          source_url_kind: "hls_manifest",
          segment_validation_eligible: true,
          entities: ["EA"],
          autonomous_motion_candidate: true,
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
    localMotionClips: [],
  });

  assert.equal(plan.trusted_source_pipeline.references_found, 0);
  assert.equal(plan.trusted_source_pipeline.registry_references_found, 0);
  assert.deepEqual(plan.trusted_source_pipeline.intake_queue, []);
  assert.ok(plan.readiness.blockers.includes("no_trusted_footage_references_for_story"));
});

test("Footage Empire can match a trusted source by source title when publisher entity is too broad", () => {
  const plan = buildFootageEmpirePlan({
    story: {
      id: "star-wars-zero-company",
      title: "Star Wars Zero Company Is More Than XCOM",
      full_script: "Star Wars Zero Company is leaning harder into tactical squad combat than the reveal first suggested.",
    },
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "steam-star-wars-zero-company-announce-trailer",
          display_name: "Steam - STAR WARS Zero Company announce trailer",
          source_tier: "official",
          source_family: "steam_star_wars_zero_company_announce_trailer",
          reference_url: "https://store.steampowered.com/app/2075800/STAR_WARS_Zero_Company/",
          source_url_kind: "hls_manifest",
          segment_validation_eligible: true,
          entities: ["EA"],
          autonomous_motion_candidate: true,
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
    localMotionClips: [],
  });

  assert.equal(plan.trusted_source_pipeline.references_found, 1);
  assert.equal(
    plan.trusted_source_pipeline.distinct_reference_families[0],
    "steam_star_wars_zero_company_announce_trailer",
  );
  assert.equal(plan.trusted_source_pipeline.intake_queue.length, 1);
});

test("Footage Empire source-title matching does not count keyword substrings", () => {
  const plan = buildFootageEmpirePlan({
    story: {
      id: "star-wars-zero-company",
      title: "Star Wars Zero Company Is More Than XCOM",
      full_script: "Star Wars Zero Company is the subject.",
    },
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "forza-horizon-legend",
          display_name: "Forza Horizon official X - FH6 Horizon Legend video",
          source_tier: "official",
          source_family: "forza_horizon_official_x_fh6_legend_video",
          reference_url: "https://x.com/ForzaHorizon/status/2014401547162063238",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entities: ["Forza Horizon 6", "Forza"],
          autonomous_motion_candidate: true,
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
          provenance: {
            official_evidence:
              "Official post says your journey to become a Horizon Legend starts here.",
          },
        },
      ],
    },
    localMotionClips: [],
  });

  assert.equal(plan.trusted_source_pipeline.references_found, 0);
  assert.deepEqual(plan.trusted_source_pipeline.intake_queue, []);
});

test("Footage Empire counts validated official HLS windows as renderable motion references", () => {
  const plan = buildFootageEmpirePlan({
    story: forzaSteamStory(),
    trustedFootageReport: trustedRegistryReport(),
    localMotionClips: [
      {
        id: "steam-hls-window-a",
        source_family: "steam",
        path: "https://video.akamai.steamstatic.com/store_trailers/forza/hls_264_master.m3u8",
        durationS: 2.4,
        validated: true,
        segmentValidationPassed: true,
      },
      {
        id: "steam-hls-window-b",
        source_family: "steam",
        path: "https://video.akamai.steamstatic.com/store_trailers/forza/hls_264_master.m3u8",
        durationS: 2.5,
        validated: true,
        segmentValidationPassed: true,
      },
    ],
  });

  assert.equal(plan.motion_budget.available_motion_clips, 2);
  assert.equal(plan.motion_budget.available_distinct_families, 1);
  assert.equal(plan.motion_inventory.accepted_local_clips[0].source_kind, "hls_manifest");
  assert.equal(plan.safety.video_downloads_started, false);
});

test("Footage Empire blocks official reveal stories from satisfying family floor with one trailer", () => {
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1364780/164062000/hash/1782090499/hls_264_master.m3u8?t=1";
  const clips = [36, 42, 48, 54, 60].map((start, index) => ({
    id: `sf6-window-${index + 1}`,
    source_family: "steam_1364780_164062000",
    path: sourceUrl,
    source_url: sourceUrl,
    mediaStartS: start,
    durationS: 5,
    validated: true,
    segmentValidationPassed: true,
    source_type: "steam_movie",
    provider: "steam",
    allowed_render_use: "reference_only_by_default",
    rights_risk_class: "official_reference_only",
    provenance: {
      segment_motion_class: "gameplay_action",
      validation_reason: "official_storefront_trailer_motion_samples_passed",
      sample_content_hashes: [`w${start}-a`, `w${start}-b`, `w${start}-c`],
    },
  }));

  const plan = buildFootageEmpirePlan({
    story: {
      id: "sf6-yasmine-pack",
      title: "Street Fighter 6 Yasmine Gameplay Reveal",
      canonical_subject: "Street Fighter 6",
      canonical_game: "Street Fighter 6",
      full_script:
        "Street Fighter 6 has a real Yasmine gameplay reveal. Capcom's official trailer shows enough separate combat beats to judge the character.",
    },
    trustedFootageReport: {
      accepted_sources: [
        {
          story_id: "sf6-yasmine-pack",
          entity: "Street Fighter 6",
          source_id: "steam-sf6-yasmine",
          display_name: "Steam official Street Fighter 6 Yasmine trailer",
          source_tier: "official",
          source_family: "steam_1364780_164062000",
          reference_url: sourceUrl,
          source_url_kind: "hls_manifest",
          segment_validation_eligible: true,
          autonomous_motion_candidate: true,
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
    localMotionClips: clips,
  });

  assert.equal(plan.motion_budget.available_motion_clips, 5);
  assert.equal(plan.motion_budget.available_distinct_families, 1);
  assert.equal(plan.motion_budget.hash_distinct_official_motion_windows, 5);
  assert.equal(
    plan.motion_budget.distinct_family_requirement_satisfied_by_hash_distinct_official_windows,
    false,
  );
  assert.equal(plan.readiness.status, "v4_motion_blocked");
  assert.equal(plan.readiness.blockers.includes("distinct_motion_families_minimum_not_met"), true);
  assert.ok(
    plan.readiness.warnings.includes(
      "hash_distinct_official_windows_do_not_replace_source_family_diversity",
    ),
  );
});

test("Footage Empire counts hash-distinct official windows but still requires source diversity", () => {
  const sourceUrl =
    "https://video.fastly.steamstatic.com/store_trailers/881020/655426/hash/hls_264_master.m3u8?t=1";
  const clips = [36, 42, 48, 54, 60].map((start, index) => ({
    id: `granblue-product-window-${index + 1}`,
    source_family: "steam_881020_655426",
    path: sourceUrl,
    source_url: sourceUrl,
    mediaStartS: start,
    durationS: 5,
    validated: true,
    segmentValidationPassed: true,
    source_type: "official_platform_product_page",
    provider: "steam",
    allowed_render_use: "reference_only_by_default",
    rights_risk_class: "official_reference_only",
    provenance: {
      segment_motion_class: "official_product_motion",
      validation_reason: "official_product_motion_samples_passed",
      sample_content_hashes: [`granblue-${start}-a`, `granblue-${start}-b`],
    },
  }));

  const plan = buildFootageEmpirePlan({
    story: {
      id: "granblue-relink-demo",
      title: "Granblue Fantasy: Relink Demo Is The Real Proof",
      canonical_subject: "Granblue Fantasy: Relink",
      canonical_game: "Granblue Fantasy: Relink",
      full_script:
        "Granblue Fantasy: Relink has a fresh demo, and Steam's official storefront motion gives players enough separate visual moments to judge the update.",
    },
    trustedFootageReport: {
      accepted_sources: [
        {
          story_id: "granblue-relink-demo",
          entity: "Granblue Fantasy: Relink",
          source_id: "steam-granblue-relink",
          display_name: "Steam official Granblue Fantasy Relink trailer",
          source_tier: "official",
          source_family: "steam_881020_655426",
          reference_url: sourceUrl,
          source_url_kind: "hls_manifest",
          segment_validation_eligible: true,
          autonomous_motion_candidate: true,
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
    localMotionClips: clips,
  });

  assert.equal(plan.motion_budget.available_motion_clips, 5);
  assert.equal(plan.motion_budget.available_distinct_families, 1);
  assert.equal(plan.motion_budget.hash_distinct_official_motion_windows, 5);
  assert.equal(
    plan.motion_budget.distinct_family_requirement_satisfied_by_hash_distinct_official_windows,
    false,
  );
  assert.equal(plan.readiness.status, "v4_motion_blocked");
  assert.equal(plan.readiness.blockers.includes("distinct_motion_families_minimum_not_met"), true);
  assert.ok(
    plan.readiness.warnings.includes(
      "hash_distinct_official_windows_do_not_replace_source_family_diversity",
    ),
  );
});

test("Footage Empire blocks alias families when they all come from the same source asset", () => {
  const sourceUrl =
    "https://cdn.example.com/game/official-reveal-trailer/master.m3u8";
  const clips = [12, 18, 24, 30, 36].map((start, index) => ({
    id: `alias-window-${index + 1}`,
    source_family: `official_reveal_alias_${index + 1}`,
    path: sourceUrl,
    source_url: sourceUrl,
    mediaStartS: start,
    durationS: 5,
    validated: true,
    segmentValidationPassed: true,
    source_type: "official_storefront_video_reference",
    provider: "official",
    allowed_render_use: "reference_only_by_default",
    rights_risk_class: "official_reference_only",
    provenance: {
      segment_motion_class: "gameplay_action",
      validation_reason: "official_storefront_trailer_motion_samples_passed",
      sample_content_hashes: [`alias-${start}-a`, `alias-${start}-b`],
    },
  }));

  const plan = buildFootageEmpirePlan({
    story: {
      id: "single-source-alias-story",
      title: "New Game Reveal Shows Official Trailer Details",
      canonical_subject: "New Game",
      canonical_game: "New Game",
      full_script:
        "New Game has one official trailer with several different windows, but that cannot masquerade as a fully varied premium short.",
    },
    trustedFootageReport: {
      accepted_sources: [
        {
          story_id: "single-source-alias-story",
          entity: "New Game",
          source_id: "official-reveal-trailer",
          display_name: "Official reveal trailer",
          source_tier: "official",
          source_family: "official_reveal_trailer",
          reference_url: sourceUrl,
          source_url_kind: "hls_manifest",
          segment_validation_eligible: true,
          autonomous_motion_candidate: true,
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
    localMotionClips: clips,
  });

  assert.equal(plan.motion_budget.available_motion_clips, 5);
  assert.equal(plan.motion_budget.available_distinct_families, 5);
  assert.equal(plan.motion_budget.available_distinct_source_assets, 1);
  assert.equal(plan.readiness.status, "v4_motion_blocked");
  assert.equal(
    plan.readiness.blockers.includes("distinct_motion_source_assets_minimum_not_met"),
    true,
  );
});

test("Footage Empire blocks separately materialised windows from one explicit base source", () => {
  const baseSourceFamily = "playstation_marvel_tokon_official_trailer";
  const clips = Array.from({ length: 10 }, (_, index) => ({
    id: `tokon-window-${index + 1}`,
    source_family: `${baseSourceFamily}_window_${12 + index * 5}_5`,
    base_source_family: baseSourceFamily,
    path: `C:\\media\\tokon-window-${index + 1}.mp4`,
    source_url: `https://media.playstation.com/tokon/window-${index + 1}.mp4`,
    mediaStartS: 12 + index * 5,
    durationS: 5,
    validated: true,
    segmentValidationPassed: true,
    source_type: "official_publisher_trailer_segment",
    media_kind: "direct_video",
    allowed_render_use: "transformative_editorial_use",
    rights_risk_class: "official_promotional_video_transformative_editorial_use",
  }));

  const plan = buildFootageEmpirePlan({
    story: {
      id: "marvel-tokon-single-trailer",
      title: "Marvel Tokon Has One Number That Could Decide The Fight",
      canonical_subject: "Marvel Tokon: Fighting Souls",
      canonical_game: "Marvel Tokon: Fighting Souls",
      full_script:
        "Marvel Tokon has twenty fighters, but four-versus-four readability could decide whether new players buy at launch or wait.",
    },
    trustedFootageReport: {
      accepted_sources: [
        {
          story_id: "marvel-tokon-single-trailer",
          entity: "Marvel Tokon: Fighting Souls",
          source_id: baseSourceFamily,
          display_name: "PlayStation official Marvel Tokon trailer",
          source_tier: "official",
          source_family: baseSourceFamily,
          reference_url: "https://www.youtube.com/watch?v=marvel-tokon-official",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          autonomous_motion_candidate: true,
          allowed_render_use: "transformative_editorial_use",
          rights_risk_class: "official_promotional_video_transformative_editorial_use",
        },
      ],
    },
    localMotionClips: clips,
  });

  assert.equal(plan.motion_budget.available_motion_clips, 10);
  assert.equal(plan.motion_budget.available_distinct_families, 10);
  assert.equal(plan.motion_budget.available_distinct_source_assets, 1);
  assert.equal(plan.readiness.status, "v4_motion_blocked");
  assert.ok(
    plan.readiness.blockers.includes("distinct_motion_source_assets_minimum_not_met"),
  );
  assert.deepEqual(
    new Set(plan.motion_inventory.accepted_local_clips.map((clip) => clip.base_source_family)),
    new Set([baseSourceFamily]),
  );
});

test("Footage Empire accepts distinct validated official base sources", () => {
  const clips = Array.from({ length: 5 }, (_, index) => {
    const baseSourceFamily = `official_tokon_source_${index + 1}`;
    return {
      id: `tokon-source-${index + 1}`,
      source_family: `${baseSourceFamily}_window_12_5`,
      base_source_family: baseSourceFamily,
      path: `C:\\media\\tokon-source-${index + 1}.mp4`,
      source_url: `https://media.playstation.com/tokon/source-${index + 1}.mp4`,
      mediaStartS: 12,
      durationS: 5,
      validated: true,
      segmentValidationPassed: true,
      source_type: "official_publisher_trailer_segment",
      media_kind: "direct_video",
      allowed_render_use: "transformative_editorial_use",
      rights_risk_class: "official_promotional_video_transformative_editorial_use",
    };
  });

  const plan = buildFootageEmpirePlan({
    story: {
      id: "marvel-tokon-multi-source",
      title: "Marvel Tokon Has One Number That Could Decide The Fight",
      canonical_subject: "Marvel Tokon: Fighting Souls",
      canonical_game: "Marvel Tokon: Fighting Souls",
      full_script:
        "Marvel Tokon has twenty fighters, but four-versus-four readability could decide whether new players buy at launch or wait.",
    },
    trustedFootageReport: {
      accepted_sources: clips.map((clip, index) => ({
        story_id: "marvel-tokon-multi-source",
        entity: "Marvel Tokon: Fighting Souls",
        source_id: clip.base_source_family,
        display_name: `PlayStation official Marvel Tokon source ${index + 1}`,
        source_tier: "official",
        source_family: clip.base_source_family,
        reference_url: clip.source_url,
        source_url_kind: "direct_video",
        segment_validation_eligible: true,
        autonomous_motion_candidate: true,
        allowed_render_use: "transformative_editorial_use",
        rights_risk_class: "official_promotional_video_transformative_editorial_use",
      })),
    },
    localMotionClips: clips,
  });

  assert.equal(plan.motion_budget.available_motion_clips, 5);
  assert.equal(plan.motion_budget.available_distinct_families, 5);
  assert.equal(plan.motion_budget.available_distinct_source_assets, 5);
  assert.equal(plan.readiness.status, "v4_motion_ready");
  assert.ok(
    !plan.readiness.blockers.includes("distinct_motion_source_assets_minimum_not_met"),
  );
});

test("Footage Empire keeps separate official YouTube video IDs as distinct source assets", () => {
  const clips = [
    ["keeper-main", "Bu6BPfCtKBQ"],
    ["keeper-july4", "Fmdd2nojs4g"],
  ].map(([id, videoId]) => ({
    id,
    source_family: `albion_${id}`,
    path: `output/video_cache/${id}.mp4`,
    source_url: `https://www.youtube.com/watch?v=${videoId}`,
    durationS: 5,
    validated: true,
    source_type: "official_youtube_channel",
    provider: "official",
    allowed_render_use: "reference_only_by_default",
    rights_risk_class: "official_reference_only",
  }));

  const plan = buildFootageEmpirePlan({
    story: {
      id: "albion-keeper-uprising",
      title: "Albion Online's Keepers Just Raised The Stakes",
      canonical_subject: "Albion Online",
      canonical_game: "Albion Online",
      full_script:
        "Albion Online's official channel published separate Keeper Uprising videos for the event.",
    },
    localMotionClips: clips,
  });

  assert.equal(plan.motion_budget.available_motion_clips, 2);
  assert.equal(plan.motion_budget.available_distinct_source_assets, 2);
  assert.deepEqual(
    plan.motion_inventory.distinct_source_assets.sort(),
    ["youtube:Bu6BPfCtKBQ", "youtube:Fmdd2nojs4g"].sort(),
  );
});

test("Footage Empire counts signed direct MP4 URLs as renderable motion", () => {
  const plan = buildFootageEmpirePlan({
    story: forzaSteamStory(),
    trustedFootageReport: trustedRegistryReport(),
    localMotionClips: [
      {
        id: "gamefront-window",
        type: "motion_clip",
        source_family: "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
        path: "https://osiris.gamefront.com/gamefront/ForzaHorizon6/initial-drive.mp4?X-Amz-Signature=abc",
        durationS: 3.2,
        validated: true,
        segmentValidationPassed: true,
      },
    ],
  });

  assert.equal(plan.motion_budget.available_motion_clips, 1);
  assert.equal(plan.motion_budget.available_distinct_families, 1);
  assert.equal(plan.motion_inventory.accepted_local_clips[0].source_kind, "video_file");
  assert.equal(plan.motion_inventory.rejected_local_assets.length, 0);
});

test("Footage Empire uses a narrower product-motion budget for hardware accessory stories only", () => {
  const plan = buildFootageEmpirePlan({
    story: {
      id: "xbox-controller-accessory-story",
      title: "Xbox Controller Deal Has One Catch",
      canonical_subject: "Xbox Controller",
      canonical_game: "Xbox Controller",
      full_script:
        "The Forza Horizon 6 Xbox controller and headset leak is a hardware story, not a gameplay review.",
    },
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "xbox-controller-product-page",
          display_name: "Xbox controller official product page",
          source_tier: "official",
          source_family: "xbox_wireless_controller_official_product_page",
          reference_url: "https://www.xbox.com/en-US/accessories/controllers",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entities: ["Xbox Controller"],
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
        {
          source_id: "forza-accessory-product-page",
          display_name: "Forza Horizon 6 accessory product page",
          source_tier: "official",
          source_family: "xbox_forza_horizon_6_controller_headset_product_page",
          reference_url:
            "https://www.xbox.com/en-US/accessories/forza-horizon-6-xbox-wireless-controller-and-wireless-headset",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entities: ["Xbox Controller"],
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
    localMotionClips: [
      {
        id: "controller-detail",
        source_family: "xbox_wireless_controller_official_product_page",
        path: "https://cms-assets.xboxservices.com/controller-detail.mp4",
        durationS: 4.2,
        validated: true,
        source_type: "official_platform_product_page",
        allowed_render_use: "reference_only_by_default",
        rights_risk_class: "official_reference_only",
        provenance: {
          segment_motion_class: "official_product_motion",
          validation_reason: "official_product_motion_samples_passed",
        },
      },
      {
        id: "forza-accessory-detail",
        source_family: "xbox_forza_horizon_6_controller_headset_product_page",
        path: "https://cms-assets.xboxservices.com/forza-accessory-detail.mp4",
        durationS: 4.4,
        validated: true,
        source_type: "official_platform_product_page",
        allowed_render_use: "reference_only_by_default",
        rights_risk_class: "official_reference_only",
        provenance: {
          segment_motion_class: "official_product_motion",
          validation_reason: "official_product_motion_samples_passed",
        },
      },
    ],
  });

  assert.equal(plan.readiness.status, "v4_motion_ready");
  assert.equal(plan.motion_budget.product_motion_story, true);
  assert.equal(plan.motion_budget.required_motion_scenes, 2);
  assert.equal(plan.motion_budget.required_distinct_families, 2);
  assert.equal(plan.motion_budget.available_official_product_motion_clips, 2);
  assert.equal(plan.motion_budget.available_official_product_motion_families, 2);
  assert.ok(plan.readiness.warnings.includes("product_story_limited_motion_budget_requires_premium_owned_motion"));
});

test("Footage Empire counts validated official game website direct video as product motion", () => {
  const plan = buildFootageEmpirePlan({
    story: {
      id: "gta-vi-ps5-version",
      title: "GTA VI PS5 Edition Upgrade",
      canonical_subject: "Grand Theft Auto VI",
      canonical_game: "Grand Theft Auto VI",
      full_script:
        "Rockstar's next Grand Theft Auto has a PS5 upgrade angle, so the proof needs official game footage instead of recycled stills.",
    },
    trustedFootageReport: {
      accepted_sources: [
        {
          source_id: "rockstar-gta-vi-media",
          display_name: "Rockstar GTA VI official videos",
          source_tier: "official",
          source_family: "rockstar_gta_vi_official_videos",
          reference_url: "https://www.rockstargames.com/VI",
          source_url_kind: "direct_video",
          segment_validation_eligible: true,
          entities: ["Grand Theft Auto VI"],
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: "official_reference_only",
        },
      ],
    },
    localMotionClips: [
      {
        id: "rockstar-official-window-1",
        source_family: "rockstar_gta_vi_official_videos_trailer_1_window_36",
        source_url: "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_1/GTAVI_Trailer_1.mp4",
        path: "C:/cache/gta-vi-trailer-1-window-36.mp4",
        durationS: 5,
        mediaStartS: 36,
        validated: true,
        source_type: "official_game_website_media_page",
        allowed_render_use: "reference_only_by_default",
        rights_risk_class: "official_reference_only",
        provenance: {
          validation_reason: "official_storefront_cinematic_motion_samples_passed",
        },
      },
      {
        id: "rockstar-official-window-2",
        source_family: "rockstar_gta_vi_official_videos_trailer_2_window_48",
        source_url: "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
        path: "C:/cache/gta-vi-trailer-2-window-48.mp4",
        durationS: 5,
        mediaStartS: 48,
        validated: true,
        source_type: "official_game_website_media_page",
        allowed_render_use: "reference_only_by_default",
        rights_risk_class: "official_reference_only",
        provenance: {
          validation_reason: "trimmed_segment_samples_passed",
        },
      },
    ],
  });

  assert.equal(plan.readiness.status, "v4_motion_ready");
  assert.equal(plan.motion_budget.product_motion_story, true);
  assert.equal(plan.motion_budget.available_official_product_motion_clips, 2);
  assert.equal(plan.motion_budget.available_official_product_motion_families, 2);
  assert.ok(!plan.readiness.blockers.includes("official_product_motion_clip_minimum_not_met"));
  assert.ok(!plan.readiness.blockers.includes("official_product_motion_family_minimum_not_met"));
});

test("Footage Empire does not treat platform account friction as product motion just because PS5 and buy appear", () => {
  const story = {
    id: "halo-ps5-account-catch",
    canonical_subject: "Halo: Campaign Evolved",
    canonical_game: "Halo: Campaign Evolved",
    title: "Halo's PS5 Account Catch",
    suggested_thumbnail_text: "PS5 CATCH",
    source_name: "Eurogamer",
    full_script:
      "Halo on PS5 just picked up a very Xbox-shaped requirement. Eurogamer reports Halo: Campaign Evolved PS5 players will need an Xbox account and gamertag to play, plus PS Plus for split-screen co-op. The access rules need to be understood before people buy.",
  };
  const trustedFootageReport = {
    accepted_sources: [
      {
        source_id: "xbox-official-youtube",
        display_name: "Xbox official YouTube",
        source_tier: "official",
        source_family: "xbox_official_youtube",
        reference_url: "https://www.youtube.com/@Xbox",
        entities: ["Halo"],
        autonomous_motion_candidate: true,
        allowed_render_use: "reference_only_by_default",
        rights_risk_class: "official_reference_only",
      },
    ],
  };
  const localMotionClips = Array.from({ length: 5 }, (_, index) => ({
    id: `halo-owned-motion-${index + 1}`,
    source_family: `halo_owned_motion_${index + 1}`,
    path: `C:\\media\\halo-owned-motion-${index + 1}.mp4`,
    source_type: "internally_generated_motion_graphic",
    rights_risk_class: "owned_generated_motion",
    durationS: 2.8,
    validated: true,
    counts_towards_motion_readiness: true,
  }));

  const plan = buildFootageEmpirePlan({ story, trustedFootageReport, localMotionClips });

  assert.equal(plan.motion_budget.product_motion_story, false);
  assert.equal(plan.motion_budget.requires_premium_owned_motion, false);
  assert.equal(plan.motion_budget.required_official_product_motion_scenes, 0);
  assert.equal(plan.motion_budget.available_motion_clips, 5);
  assert.equal(plan.motion_budget.available_distinct_families, 5);
  assert.equal(plan.readiness.status, "v4_motion_ready");
  assert.ok(!plan.readiness.blockers.includes("official_product_motion_clip_minimum_not_met"));
  assert.ok(!plan.readiness.blockers.includes("official_product_motion_family_minimum_not_met"));
});

test("Footage Empire does not treat normal Game Pass game availability as hardware product motion", () => {
  const story = {
    id: "buckshot-game-pass",
    canonical_subject: "Buckshot Roulette",
    canonical_game: "Buckshot Roulette",
    title: "Buckshot Roulette Turns Game Pass Into A Dare",
    suggested_thumbnail_text: "GAME PASS DARE",
    source_name: "Xbox Wire",
    full_script:
      "Buckshot Roulette just became the easiest dare on Game Pass. Xbox Wire says the viral horror game joins the library this week, which turns a cult PC hit into a low-friction party test for console players.",
  };
  const trustedFootageReport = {
    accepted_sources: [
      {
        source_id: "buckshot-steam-trailer",
        display_name: "Buckshot Roulette Steam trailer",
        source_tier: "official",
        source_family: "steam_2835570_684191",
        reference_url: "https://store.steampowered.com/app/2835570/Buckshot_Roulette/",
        entities: ["Buckshot Roulette"],
        autonomous_motion_candidate: true,
        allowed_render_use: "reference_only_by_default",
        rights_risk_class: "official_reference_only",
      },
    ],
  };
  const localMotionClips = Array.from({ length: 5 }, (_, index) => ({
    id: `buckshot-motion-${index + 1}`,
    source_family: `buckshot_motion_family_${index + 1}`,
    path: `C:\\media\\buckshot-motion-${index + 1}.mp4`,
    source_type: "steam_movie",
    rights_risk_class: "official_reference_only",
    allowed_render_use: "reference_only_by_default",
    durationS: 5,
    mediaStartS: 12 + index * 5,
    validated: true,
    segmentValidationPassed: true,
    provenance: {
      segment_motion_class: "gameplay_action",
      validation_reason: "segment_samples_passed",
      sample_content_hashes: [`hash-${index}-a`, `hash-${index}-b`, `hash-${index}-c`],
    },
  }));

  const plan = buildFootageEmpirePlan({ story, trustedFootageReport, localMotionClips });

  assert.equal(plan.motion_budget.product_motion_story, false);
  assert.equal(plan.motion_budget.requires_premium_owned_motion, false);
  assert.equal(plan.motion_budget.required_official_product_motion_scenes, 0);
  assert.equal(plan.motion_budget.available_motion_clips, 5);
  assert.equal(plan.motion_budget.available_distinct_families, 5);
  assert.equal(plan.readiness.status, "v4_motion_ready");
  assert.ok(!plan.readiness.blockers.includes("official_product_motion_clip_minimum_not_met"));
  assert.ok(!plan.readiness.blockers.includes("official_product_motion_family_minimum_not_met"));
});

test("Footage Empire does not treat a Switch 2 game port as hardware product motion", () => {
  const story = {
    id: "digimon-switch-2-port",
    canonical_subject: "Digimon Story Time Stranger",
    canonical_game: "Digimon Story Time Stranger",
    title: "Digimon's Switch 2 Upgrade Gives Players A Real Choice",
    suggested_thumbnail_text: "SWITCH 2 MODE CHOICE",
    full_script:
      "Digimon Story Time Stranger just reached Switch 2 with both performance and quality modes. Players can choose smoother battles or a sharper Digital World.",
  };
  const localMotionClips = Array.from({ length: 5 }, (_, index) => ({
    id: `digimon-motion-${index + 1}`,
    source_family: `digimon-official-${index + 1}`,
    path: `C:\\media\\digimon-${index + 1}.mp4`,
    source_url: `https://www.youtube.com/watch?v=digimon-${index + 1}`,
    source_type: "official_publisher_trailer_segment",
    media_kind: "direct_video",
    rights_risk_class: "official_promotional_video_transformative_editorial_use",
    durationS: 5,
    validated: true,
  }));

  const plan = buildFootageEmpirePlan({ story, localMotionClips });

  assert.equal(plan.motion_budget.product_motion_story, false);
  assert.equal(plan.motion_budget.required_official_product_motion_scenes, 0);
  assert.ok(!plan.readiness.blockers.includes("official_product_motion_clip_minimum_not_met"));
});

test("Footage Empire does not treat a PS5 Pro game software upgrade as hardware product motion", () => {
  const story = {
    id: "arknights-endfield-ps5-pro-upgrade",
    canonical_subject: "Arknights: Endfield",
    canonical_game: "Arknights: Endfield",
    title: "Arknights: Endfield's PS5 Pro Upgrade Has A Real Test",
    suggested_thumbnail_text: "PS5 PRO TEST",
    full_script:
      "Arknights: Endfield now has PS5 Pro graphics and performance modes. Players can judge sharper image quality against smoother action without this becoming a story about buying the console itself.",
  };
  const localMotionClips = Array.from({ length: 5 }, (_, index) => ({
    id: `arknights-endfield-motion-${index + 1}`,
    source_family: `arknights-endfield-official-${index + 1}`,
    path: `C:\\media\\arknights-endfield-${index + 1}.mp4`,
    source_url: `https://www.youtube.com/watch?v=arknights-endfield-${index + 1}`,
    source_type: "official_publisher_trailer_segment",
    media_kind: "direct_video",
    rights_risk_class: "official_promotional_video_transformative_editorial_use",
    durationS: 5,
    validated: true,
  }));

  const plan = buildFootageEmpirePlan({ story, localMotionClips });

  assert.equal(plan.motion_budget.product_motion_story, false);
  assert.equal(plan.motion_budget.required_official_product_motion_scenes, 0);
  assert.equal(plan.motion_budget.required_official_product_motion_families, 0);
  assert.ok(!plan.readiness.blockers.includes("official_product_motion_clip_minimum_not_met"));
  assert.ok(!plan.readiness.blockers.includes("official_product_motion_family_minimum_not_met"));
});
