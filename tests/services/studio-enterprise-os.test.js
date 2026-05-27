"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildStudioEnterpriseOSPack,
  detectPlatformMirroring,
  renderStudioEnterpriseOSMarkdown,
  writeStudioEnterpriseOSArtifacts,
} = require("../../lib/studio-enterprise-os");

function sampleStory(overrides = {}) {
  return {
    id: "forza-visual-v4",
    title: "Forza Horizon 6 Steam Numbers Skyrocket",
    full_script:
      "Forza Horizon 6 just hit 130,000 Steam players. The useful angle is what this means for Xbox, Game Pass and racing setup demand.",
    flair: "News",
    source_type: "rss",
    url: "https://example.com/forza",
    breaking_score: 82,
    downloaded_images: [{ path: "forza.jpg", source_url: "https://cdn.example/forza.jpg" }],
    video_clips: [
      {
        asset_id: "forza-official-clip",
        source_family: "xbox_official",
        source_type: "official trailer",
        source_url: "https://xbox.example/forza.mp4",
      },
    ],
    ...overrides,
  };
}

test("Studio Enterprise OS builds every missing operating layer without live mutations", () => {
  const pack = buildStudioEnterpriseOSPack({
    generatedAt: "2026-05-20T12:00:00.000Z",
    stories: [
      sampleStory(),
      sampleStory({
        id: "generic",
        title: "This gaming story",
        full_script: "This gaming story has a sourced update.",
        breaking_score: 20,
        downloaded_images: [],
        video_clips: [],
      }),
    ],
    retentionBaseline: {
      stayed_to_watch: 39.3,
      swiped_away: 60.7,
      avg_watch_seconds_estimate: 10.8,
      subscriber_conversion_estimate: 0.041,
      mobile_viewer_share: 71.4,
      audience_core: "male_25_44_uk_us_mobile",
      targets: {
        stayed_to_watch_short_term: 45,
        avg_watch_seconds_short_term: 15,
      },
    },
    revenuePathDigest: {
      totals: {
        paths: 2,
        pass: 1,
        review: 1,
        blocked_for_compliance: 0,
        average_revenue_path_score: 74,
      },
      top_paths: [
        {
          story_id: "forza-visual-v4",
          title: "Forza Horizon 6 Steam Numbers Skyrocket",
          verdict: "pass",
          revenue_path_score: 84,
          route: "/p/forza-horizon-6-steam-numbers-skyrocket",
          primary_offer: { label: "Racing wheel", product_category: "racing wheel" },
        },
      ],
    },
    commercialLearningDigest: {
      totals: { clicks: 8, clicked_stories: 2, clicked_offers: 3 },
      top_stories: [
        {
          story_id: "forza-visual-v4",
          title: "Forza Horizon 6 Steam Numbers Skyrocket",
          clicks: 5,
          affiliate_click_rate: 0.018,
          commercial_angle_lift: "early_signal",
        },
      ],
    },
    commentsDigest: {
      newCommentCount: 4,
      categoryCounts: { correction: 1, useful_criticism: 1, topic_suggestion: 1, question: 1 },
      decisionCounts: { needs_review: 3, auto_reply_candidate: 1 },
      usefulViewerSignals: [
        "Production feedback: captions are late",
        "Topic request: cover Game Pass prices",
      ],
    },
    renderHealthSummary: {
      stamped: 8,
      quality: { premium: 1, standard: 3, fallback: 4 },
      percentages: { thin: 45, lane: { legacy_multi_image: 75 } },
      visual_count: { median: 3 },
    },
    v4SourceDeficit: {
      summary: {
        blocked_stories: 1,
        direct_media_ready: 1,
        licence_or_operator_required: 2,
        direct_media_missing: 1,
      },
    },
    v4MotionPacks: { summary: { ready: 1, blocked: 1, clips: 2 } },
    goldStandardLibrary: {
      summary: { total_references: 50 },
      reference_packs: [
        { pack: "Gaming News Core" },
        { pack: "Official Publisher Motion" },
        { pack: "Social-First News" },
        { pack: "Explainer / Data Graphics" },
        { pack: "Pacing / Retention / Impact" },
        { pack: "Premium Visual Texture" },
      ],
      codex_rules: Array.from({ length: 12 }, (_, index) => ({ rule_id: `rule_${index}` })),
    },
    costSnapshot: {
      api_cost_gbp: 4.5,
      render_cost_gbp: 5.5,
      storage_cost_gbp: 1,
      failed_render_cost_gbp: 2,
      published_videos: 4,
      views: 19300,
      revenue_gbp: 0,
      failed_renders: 3,
    },
    securitySnapshot: {
      api_token_present: true,
      hardcoded_secret_findings: [],
      env_separation: "local",
      token_rotation_days: 120,
      audit_log_enabled: true,
      emergency_kill_switch: true,
      rollback_renderer_available: true,
    },
  });

  assert.equal(pack.schema_version, 1);
  assert.equal(pack.engine, "studio_enterprise_os_v1");
  assert.equal(pack.autonomy_control_tower.mode, "AMBER");
  assert.ok(pack.autonomy_control_tower.blockers.includes("retention_below_target"));
  assert.ok(pack.autonomy_control_tower.blockers.includes("motion_supply_not_ready"));
  assert.equal(pack.observability_dashboard.cards.length >= 10, true);
  assert.equal(pack.experimentation_engine.variants.length, 4);
  assert.equal(pack.audience_persona_engine.core_persona, "adult_gaming_intelligence_uk_us_mobile");
  assert.equal(pack.comment_intelligence.action_queue.length, 3);
  assert.equal(pack.landing_page_link_hub.routes[0].route, "/p/forza-horizon-6-steam-numbers-skyrocket");
  assert.equal(pack.revenue_attribution.missing_signals.includes("affiliate_revenue"), true);
  assert.equal(pack.sponsor_readiness_pack.ready_for_outreach, false);
  assert.equal(pack.multi_platform_format_engine.outputs.youtube_shorts.duration_seconds.max, 60);
  assert.equal(pack.multi_platform_format_engine.outputs.tiktok.duration_seconds.min, 61);
  assert.equal(pack.security_secret_management.status, "review");
  assert.equal(pack.disaster_recovery.rollback_renderer.available, true);
  assert.ok(pack.brand_system_ip_moat.recurring_segments.includes("Steam Spike Check"));
  assert.equal(pack.story_selection_intelligence.ranked_stories[0].story_id, "forza-visual-v4");
  assert.ok(pack.competitor_gap_engine.story_angles[0].pulse_gap_angle);
  assert.equal(pack.cost_infrastructure_control.cost_per_published_video_gbp, 3.25);
  assert.equal(pack.finance_crypto_compliance_firewall.status, "clear");
  assert.equal(pack.safety.no_social_posting_triggered, true);
  assert.equal(pack.safety.no_db_rows_mutated, true);

  const markdown = renderStudioEnterpriseOSMarkdown(pack);
  assert.match(markdown, /Studio Enterprise OS v1/);
  assert.match(markdown, /Autonomy mode: AMBER/);
  assert.match(markdown, /No social posting was triggered/);
});

test("Studio Enterprise OS exposes the complete empire operating layer registry", () => {
  const pack = buildStudioEnterpriseOSPack({
    generatedAt: "2026-05-20T14:00:00.000Z",
    stories: [sampleStory()],
    retentionBaseline: { stayed_to_watch: 52, avg_watch_seconds_estimate: 18 },
    revenuePathDigest: { totals: { paths: 1, blocked_for_compliance: 0 } },
    securitySnapshot: {
      api_token_present: true,
      hardcoded_secret_findings: [],
      env_separation: "local",
      token_rotation_days: 30,
      audit_log_enabled: true,
      emergency_kill_switch: true,
      rollback_renderer_available: true,
    },
  });

  const expectedLayerIds = [
    "canonical_story_manifest",
    "autonomy_control_tower",
    "rights_ledger",
    "platform_policy_engine",
    "anti_spam_uniqueness_engine",
    "corrections_takedown_workflow",
    "observability_dashboard",
    "versioned_prompt_model_registry",
    "experimentation_engine",
    "audience_persona_engine",
    "comment_intelligence",
    "landing_page_link_hub",
    "revenue_attribution_engine",
    "sponsor_readiness_pack",
    "multi_platform_format_engine",
    "finance_crypto_compliance_firewall",
    "brand_system_ip_moat",
    "story_selection_intelligence",
    "competitor_gap_engine",
    "cost_infrastructure_control",
    "security_secret_management",
    "disaster_recovery",
  ];

  assert.equal(pack.enterprise_layer_registry.layers.length, expectedLayerIds.length);
  assert.deepEqual(
    pack.enterprise_layer_registry.layers.map((layer) => layer.id),
    expectedLayerIds,
  );
  assert.equal(pack.enterprise_layer_registry.summary.total_layers, expectedLayerIds.length);
  assert.equal(pack.enterprise_layer_registry.summary.implemented_layers, expectedLayerIds.length);
  assert.equal(pack.enterprise_layer_registry.summary.gate_backed_layers >= 12, true);
  assert.equal(pack.enterprise_layer_registry.summary.red_layers, 0);
  assert.equal(pack.enterprise_layer_registry.layers.every((layer) => layer.owner_module), true);
  assert.equal(pack.enterprise_layer_registry.layers.every((layer) => layer.operator_output), true);
});

// goal-test:platform_mirroring_detection
test("Studio Enterprise OS detects blind duplicate platform packs", () => {
  const report = detectPlatformMirroring({
    youtube_shorts: {
      caption: "Forza Horizon 6 just hit Steam hard. Sources are on the story page.",
      duration_seconds: 45,
    },
    tiktok: {
      caption: "Forza Horizon 6 just hit Steam hard. Sources are on the story page.",
      duration_seconds: 45,
    },
    instagram_reels: {
      caption: "Forza Horizon 6 just hit Steam hard. Sources are on the story page.",
      duration_seconds: 45,
    },
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.failures.includes("platform_mirroring:blind_duplicate_copy"));
  assert.ok(report.failures.includes("platform_mirroring:duplicate_duration"));
});

// goal-test:platform_native_publish_pack_generation
// goal-test:x_thread_generation
// goal-test:instagram_carousel_generation
// goal-test:landing_page_generation
// goal-test:analytics_rule_update_generation
// goal-test:correction_workflow
// goal-test:secrets_scan
// goal-test:dry_run_publishing_mode
test("Studio Enterprise OS writes operator artefacts for every enterprise layer", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-enterprise-os-"));
  const pack = buildStudioEnterpriseOSPack({
    generatedAt: "2026-05-20T12:30:00.000Z",
    stories: [sampleStory()],
    retentionBaseline: { stayed_to_watch: 51, avg_watch_seconds_estimate: 18 },
    revenuePathDigest: { totals: { paths: 0 } },
    securitySnapshot: {
      api_token_present: true,
      hardcoded_secret_findings: [],
      token_rotation_days: 30,
      audit_log_enabled: true,
      emergency_kill_switch: true,
      rollback_renderer_available: true,
    },
  });

  const artefacts = await writeStudioEnterpriseOSArtifacts(pack, { outputDir: tmp });

  assert.equal(await fs.pathExists(artefacts.jsonPath), true);
  assert.equal(await fs.pathExists(artefacts.markdownPath), true);
  assert.equal(await fs.pathExists(path.join(tmp, "experiment_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "sponsor_readiness_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "multi_platform_format_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "security_disaster_recovery_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "story_selection_rankings.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "revenue_attribution.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "landing_page_link_hub.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "enterprise_layer_registry.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "youtube_publish_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "x_publish_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "thread_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "instagram_publish_pack.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "carousel_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "landing_page_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "analytics_ingest_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "secrets_scan_report.json")), true);
});

test("Studio Enterprise OS treats gaming business coverage as reviewable but not a hard finance block", () => {
  const pack = buildStudioEnterpriseOSPack({
    generatedAt: "2026-05-20T13:00:00.000Z",
    stories: [
      sampleStory({
        id: "sony-market",
        title: "PlayStation Plus Price Increase Hits Sony Stock And Console Market",
        full_script:
          "PlayStation Plus prices are changing for new customers. Sony shares moved after the update but the useful player angle is whether the new tiers still make sense.",
        breaking_score: 78,
      }),
    ],
    retentionBaseline: { stayed_to_watch: 52, avg_watch_seconds_estimate: 18 },
    revenuePathDigest: { totals: { paths: 1, blocked_for_compliance: 0 } },
    securitySnapshot: {
      api_token_present: true,
      hardcoded_secret_findings: [],
      token_rotation_days: 30,
      audit_log_enabled: true,
      emergency_kill_switch: true,
      rollback_renderer_available: true,
    },
  });

  assert.equal(pack.finance_crypto_compliance_firewall.status, "review");
  assert.deepEqual(pack.finance_crypto_compliance_firewall.risky_story_ids, []);
  assert.deepEqual(pack.finance_crypto_compliance_firewall.review_story_ids, ["sony-market"]);
  assert.equal(
    pack.autonomy_control_tower.blockers.includes("finance_crypto_review_required"),
    false,
  );
  assert.equal(pack.autonomy_control_tower.mode, "AMBER");
});

test("Studio Enterprise OS still blocks promotional crypto or finance wording without approval", () => {
  const pack = buildStudioEnterpriseOSPack({
    generatedAt: "2026-05-20T13:10:00.000Z",
    stories: [
      sampleStory({
        id: "crypto-promo",
        title: "New Crypto Game Token Could Pump After Exchange Listing",
        full_script:
          "This token has a price prediction attached and the sponsor link pushes leverage trading. Buy now language is not allowed in Pulse output.",
        breaking_score: 86,
      }),
    ],
    retentionBaseline: { stayed_to_watch: 52, avg_watch_seconds_estimate: 18 },
    revenuePathDigest: { totals: { paths: 1, blocked_for_compliance: 0 } },
    securitySnapshot: {
      api_token_present: true,
      hardcoded_secret_findings: [],
      token_rotation_days: 30,
      audit_log_enabled: true,
      emergency_kill_switch: true,
      rollback_renderer_available: true,
    },
  });

  assert.equal(pack.finance_crypto_compliance_firewall.status, "blocked_for_review");
  assert.deepEqual(pack.finance_crypto_compliance_firewall.risky_story_ids, ["crypto-promo"]);
  assert.equal(
    pack.autonomy_control_tower.blockers.includes("finance_crypto_review_required"),
    true,
  );
  assert.equal(pack.autonomy_control_tower.mode, "RED");
});

test("Studio Enterprise OS does not treat free-to-play wording as finance promotion", () => {
  const pack = buildStudioEnterpriseOSPack({
    generatedAt: "2026-05-20T13:20:00.000Z",
    stories: [
      sampleStory({
        id: "last-flag-free-weekend",
        title:
          "Last Flag Is Free To Play Every Weekend Until Its First Update Comes Out",
        full_script:
          "Dan Reynolds co-founded Loom Studios to build Last Flag. Weekend players can test the mechanics risk-free while the studio shows real creative investment before the first major update.",
        breaking_score: 74,
      }),
    ],
    retentionBaseline: { stayed_to_watch: 52, avg_watch_seconds_estimate: 18 },
    revenuePathDigest: { totals: { paths: 1, blocked_for_compliance: 0 } },
    securitySnapshot: {
      api_token_present: true,
      hardcoded_secret_findings: [],
      env_separation: "local",
      token_rotation_days: 30,
      audit_log_enabled: true,
      emergency_kill_switch: true,
      rollback_renderer_available: true,
    },
  });

  assert.equal(pack.finance_crypto_compliance_firewall.status, "clear");
  assert.deepEqual(pack.finance_crypto_compliance_firewall.risky_story_ids, []);
  assert.equal(pack.autonomy_control_tower.mode, "GREEN");
});
