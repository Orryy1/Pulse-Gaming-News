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
