"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoalHumanReviewQueue,
  renderGoalHumanReviewQueueMarkdown,
  writeGoalHumanReviewQueue,
} = require("../../lib/goal-human-review-queue");

const ROOT = path.resolve(__dirname, "..", "..");

async function makeStoryPackage(root, storyId = "story-one") {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
    thumbnail_headline: "FORZA STEAM BET",
    first_spoken_line: "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
    narration_script:
      "Forza Horizon 6 just made Xbox's Steam plan harder to ignore. The useful bit for players is simple: this is no longer just an Xbox Store story.",
    description: "Forza Horizon 6 has a platform story worth watching. Source: Eurogamer.",
    primary_source: { name: "Eurogamer", url: "https://www.eurogamer.net/forza-horizon-6-steam" },
    discovery_source: { name: "RSS", url: "https://www.eurogamer.net/feed" },
    secondary_sources: [{ name: "Xbox Wire", url: "https://news.xbox.com/forza-horizon-6" }],
  });
  await fs.outputJson(path.join(artifactDir, "coherence_report.json"), {
    result: "pass",
    failures: [],
    warnings: [],
    manifest: {
      selected_title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
      thumbnail_headline: "FORZA STEAM BET",
      first_spoken_line: "Forza Horizon 6 just made Xbox's Steam plan harder to ignore.",
      narration_script:
        "Forza Horizon 6 just made Xbox's Steam plan harder to ignore. The useful bit for players is simple: this is no longer just an Xbox Store story.",
      description: "Forza Horizon 6 has a platform story worth watching. Source: Eurogamer.",
      source_card_label: "Eurogamer",
    },
  });
  await fs.outputFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(1500, 1));
  await fs.outputFile(path.join(artifactDir, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nForza.\n");
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: storyId,
    outputs: {
      youtube_shorts: { caption: "Forza Horizon 6 is making Xbox's Steam strategy visible." },
      tiktok: { caption: "Forza Horizon 6 has a platform catch." },
      x: { hot_take: "Forza Horizon 6 is now an Xbox strategy story, not just a racing-game story." },
    },
  });
  return artifactDir;
}

function dryRunPlan({ artifactDir, storyId = "story-one" } = {}) {
  const videoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const captionsPath = path.join(artifactDir, "captions.srt");
  return {
    schema_version: 1,
    generated_at: "2026-05-22T18:10:00.000Z",
    mode: "DRY_RUN_PUBLISH",
    overall_verdict: "AMBER",
    ready_for_unattended_publish: false,
    readiness_reasons: ["platform_actions_deferred_until_enabled"],
    summary: {
      ready_story_count: 1,
      blocked_story_count: 0,
      platform_publish_now_action_count: 2,
      platform_deferred_action_count: 2,
      blocked_action_count: 0,
    },
    actions: [
      {
        story_id: storyId,
        platform: "youtube_shorts",
        action: "would_publish",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        video_path: videoPath,
        captions_path: captionsPath,
        cover_frame_source: videoPath,
        platform_enabled: true,
      },
      {
        story_id: storyId,
        platform: "instagram_reels",
        action: "would_publish",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        video_path: videoPath,
        captions_path: captionsPath,
        cover_frame_source: videoPath,
        platform_enabled: true,
      },
      {
        story_id: storyId,
        platform: "tiktok",
        action: "would_queue_when_enabled",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        video_path: videoPath,
        captions_path: captionsPath,
        cover_frame_source: videoPath,
        platform_enabled: false,
        platform_operational_state: "needs_credentials",
        platform_operational_reason: "tiktok_local_token_refresh_or_sync_required",
        platform_enablement_gaps: ["tiktok_local_token_refresh_or_sync_required"],
        platform_enablement_next_action: "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
        warnings: ["below_creator_rewards_duration"],
      },
      {
        story_id: storyId,
        platform: "x",
        action: "would_queue_when_enabled",
        title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
        video_path: videoPath,
        captions_path: captionsPath,
        cover_frame_source: videoPath,
        platform_enabled: false,
        platform_operational_state: "disabled",
        platform_operational_reason: "x_optional_disabled",
        platform_enablement_gaps: ["x_operator_disabled", "x_api_billing_not_declared"],
        platform_enablement_next_action: "keep_x_disabled_until_paid_api_and_credentials_are_confirmed",
      },
    ],
    blocked_actions: [],
    blocked_stories: [],
    incident_guard_report: {
      stories: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          verdict: "pass",
          safe_to_publish_boolean: true,
          disaster_upload_blockers: [],
          file_evidence: {
            mp4_ready: true,
            captions_ready: true,
            narration_ready: true,
            word_timestamps_ready: true,
            materialised_motion_ready: true,
            distinct_motion_families_ready: true,
            rights_ledger_ready: true,
          },
        },
      ],
    },
  };
}

test("human review queue turns AMBER strict dry-run candidates into operator packets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-"));
  const artifactDir = await makeStoryPackage(root);
  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan: dryRunPlan({ artifactDir }),
    generatedAt: "2026-05-22T18:15:00.000Z",
  });

  assert.equal(queue.mode, "HUMAN_REVIEW");
  assert.equal(queue.summary.review_item_count, 1);
  assert.equal(queue.summary.ready_for_unattended_publish, false);
  assert.equal(queue.source_dry_run_generated_at, "2026-05-22T18:10:00.000Z");
  assert.equal(queue.summary.source_dry_run_generated_at, "2026-05-22T18:10:00.000Z");
  assert.equal(queue.summary.publish_now_action_count, 2);
  assert.equal(queue.summary.deferred_platform_action_count, 2);
  assert.equal(queue.safe_publish_plan.can_publish_without_operator, false);
  assert.equal(queue.safe_publish_plan.required_next_step, "operator_human_review");

  const item = queue.review_items[0];
  assert.equal(item.story_id, "story-one");
  assert.equal(item.full_platform_verdict, "AMBER");
  assert.deepEqual(item.publish_now_platforms, ["youtube_shorts", "instagram_reels"]);
  assert.deepEqual(item.enabled_review_platforms, ["youtube_shorts", "instagram_reels"]);
  assert.deepEqual(item.deferred_platforms, ["tiktok", "x"]);
  assert.deepEqual(item.platform_enablement_requirements, [
    {
      platform: "tiktok",
      operational_state: "needs_credentials",
      operational_reason: "tiktok_local_token_refresh_or_sync_required",
      enablement_gaps: ["tiktok_local_token_refresh_or_sync_required"],
      enablement_next_action: "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
      required_before_counting_platform_ready: true,
      live_publish_allowed_before_enablement: false,
    },
    {
      platform: "x",
      operational_state: "disabled",
      operational_reason: "x_optional_disabled",
      enablement_gaps: ["x_operator_disabled", "x_api_billing_not_declared"],
      enablement_next_action: "keep_x_disabled_until_paid_api_and_credentials_are_confirmed",
      required_before_counting_platform_ready: true,
      live_publish_allowed_before_enablement: false,
    },
  ]);
  assert.equal(item.public_copy.title, "Forza Horizon 6 Exposes Xbox's Steam Bet");
  assert.equal(item.public_copy.thumbnail_headline, "FORZA STEAM BET");
  assert.match(item.public_copy.script_excerpt, /Forza Horizon 6 just made Xbox/);
  assert.equal(item.source_list.primary.name, "Eurogamer");
  assert.equal(item.source_list.discovery.name, "RSS");
  assert.equal(item.evidence.video_path.endsWith("visual_v4_render.mp4"), true);
  assert.equal(item.approval.operator_approval_required, true);
  assert.equal(item.approval.live_publish_allowed_before_approval, false);
  assert.ok(item.approval.approval_requirements.includes("These are review candidates, not live publish actions."));
  assert.equal(queue.review_packet_manifest.source_dry_run_generated_at, "2026-05-22T18:10:00.000Z");
});

test("human review queue keeps blocked platform variants out while queuing clean enabled platforms", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-platform-subset-"));
  const artifactDir = await makeStoryPackage(root, "platform-subset-story");
  const plan = dryRunPlan({ artifactDir, storyId: "platform-subset-story" });
  const baseVideoPath = path.join(artifactDir, "visual_v4_render.mp4");
  const baseCaptionsPath = path.join(artifactDir, "captions.srt");
  plan.actions = [
    {
      story_id: "platform-subset-story",
      platform: "youtube_shorts",
      action: "would_publish",
      title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
      video_path: baseVideoPath,
      captions_path: baseCaptionsPath,
      cover_frame_source: baseVideoPath,
      platform_enabled: true,
      platform_operational_state: "enabled",
      blockers: [],
    },
    {
      story_id: "platform-subset-story",
      platform: "facebook_reels",
      action: "would_publish",
      title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
      video_path: baseVideoPath,
      captions_path: baseCaptionsPath,
      cover_frame_source: baseVideoPath,
      platform_enabled: true,
      platform_operational_state: "enabled",
      blockers: [],
    },
  ];
  plan.blocked_actions = [
    {
      story_id: "platform-subset-story",
      platform: "instagram_reels",
      action: "blocked",
      title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
      video_path: path.join(artifactDir, "platform_variants", "instagram_reels", "visual_v4_render_instagram_reels.mp4"),
      captions_path: path.join(artifactDir, "platform_variants", "instagram_reels", "captions_instagram_reels.srt"),
      platform_enabled: true,
      platform_operational_state: "enabled",
      platform_operational_reason: "enabled_monitor_next_publish",
      blockers: ["platform_variant_stale_after_render:instagram_reels"],
      live_execution_gate: "blocked",
      live_publish_allowed_from_dry_run: false,
    },
    {
      story_id: "platform-subset-story",
      platform: "tiktok",
      action: "blocked",
      title: "Forza Horizon 6 Exposes Xbox's Steam Bet",
      video_path: path.join(artifactDir, "platform_variants", "tiktok_creator_rewards", "visual_v4_render_tiktok.mp4"),
      captions_path: path.join(artifactDir, "platform_variants", "tiktok_creator_rewards", "captions_tiktok.srt"),
      platform_enabled: false,
      platform_operational_state: "needs_credentials",
      platform_operational_reason: "tiktok_local_token_refresh_or_sync_required",
      platform_enablement_gaps: ["tiktok_local_token_refresh_or_sync_required"],
      platform_enablement_next_action: "refresh_or_sync_local_token_with_operator_present_before_any_inbox_upload",
      blockers: ["platform_variant_stale_after_render:tiktok"],
      live_execution_gate: "blocked",
      live_publish_allowed_from_dry_run: false,
    },
  ];

  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan: plan,
    generatedAt: "2026-05-31T19:20:00.000Z",
  });

  assert.equal(queue.summary.review_item_count, 1);
  assert.equal(queue.summary.blocked_item_count, 0);
  assert.equal(queue.summary.publish_now_action_count, 2);
  const item = queue.review_items[0];
  assert.equal(item.enabled_platform_verdict, "GREEN");
  assert.equal(item.full_platform_verdict, "AMBER");
  assert.deepEqual(item.enabled_review_platforms, ["youtube_shorts", "facebook_reels"]);
  assert.deepEqual(item.blocked_platforms, ["instagram_reels", "tiktok"]);
  assert.deepEqual(
    item.platform_blocked_requirements.map((requirement) => ({
      platform: requirement.platform,
      blockers: requirement.blockers,
      platform_enabled: requirement.platform_enabled,
      live_publish_allowed_before_repair: requirement.live_publish_allowed_before_repair,
    })),
    [
      {
        platform: "instagram_reels",
        blockers: ["platform_variant_stale_after_render:instagram_reels"],
        platform_enabled: true,
        live_publish_allowed_before_repair: false,
      },
      {
        platform: "tiktok",
        blockers: ["platform_variant_stale_after_render:tiktok"],
        platform_enabled: false,
        live_publish_allowed_before_repair: false,
      },
    ],
  );
  assert.deepEqual(queue.review_packet_manifest.review_packets[0].enabled_review_platforms, [
    "youtube_shorts",
    "facebook_reels",
  ]);
  assert.deepEqual(queue.review_packet_manifest.review_packets[0].blocked_platforms, ["instagram_reels", "tiktok"]);
  assert.equal(queue.safe_publish_plan.can_publish_without_operator, false);
  assert.equal(queue.safety.no_network_uploads, true);
});

test("human review queue markdown avoids publish-now wording for review candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-markdown-"));
  const artifactDir = await makeStoryPackage(root);
  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan: dryRunPlan({ artifactDir }),
    generatedAt: "2026-05-28T09:10:00.000Z",
  });

  const markdown = renderGoalHumanReviewQueueMarkdown(queue);

  assert.match(markdown, /Enabled review platforms: youtube_shorts, instagram_reels/);
  assert.doesNotMatch(markdown, /Publish-now platforms/);
  assert.match(markdown, /No live publish is allowed before operator approval/);
});

test("human review queue falls back to canonical source URL fields for operator evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-source-urls-"));
  const artifactDir = await makeStoryPackage(root, "source-url-story");
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(canonicalPath, {
    ...canonical,
    primary_source: "Xbox",
    primary_source_url: "https://www.youtube.com/watch?v=LBxjH-lZjEo",
    official_source: "Xbox Wire",
    official_source_url: "https://news.xbox.com/the-expanse-osiris-reborn",
    discovery_source: "YouTube",
    discovery_source_url: "https://www.youtube.com/@Xbox",
    secondary_sources: ["IGN"],
    secondary_source_urls: ["https://www.ign.com/articles/the-expanse-osiris-reborn-gameplay"],
  }, { spaces: 2 });

  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan: dryRunPlan({ artifactDir, storyId: "source-url-story" }),
    generatedAt: "2026-05-28T08:20:00.000Z",
  });

  const item = queue.review_items[0];
  assert.equal(item.source_list.primary.name, "Xbox");
  assert.equal(item.source_list.primary.url, "https://www.youtube.com/watch?v=LBxjH-lZjEo");
  assert.equal(item.source_list.official.name, "Xbox Wire");
  assert.equal(item.source_list.official.url, "https://news.xbox.com/the-expanse-osiris-reborn");
  assert.equal(item.source_list.discovery.name, "YouTube");
  assert.equal(item.source_list.discovery.url, "https://www.youtube.com/@Xbox");
  assert.equal(item.source_list.secondary[0].name, "IGN");
  assert.equal(item.source_list.secondary[0].url, "https://www.ign.com/articles/the-expanse-osiris-reborn-gameplay");
});

test("human review queue sanitises truncated YouTube source names in operator evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-source-names-"));
  const artifactDir = await makeStoryPackage(root, "source-name-story");
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(canonicalPath, {
    ...canonical,
    primary_source: "Xbox",
    primary_source_url: "https://youtu.be/PGqkjDoyI8o",
    official_source: "Youtu",
    official_source_url: "https://youtu.be/PGqkjDoyI8o",
    discovery_source: "Youtu",
    discovery_source_url: "https://www.youtube.com/@Xbox",
  }, { spaces: 2 });

  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan: dryRunPlan({ artifactDir, storyId: "source-name-story" }),
    generatedAt: "2026-05-28T08:20:00.000Z",
  });

  const item = queue.review_items[0];
  assert.equal(item.source_list.primary.name, "Xbox");
  assert.equal(item.source_list.official.name, "YouTube");
  assert.equal(item.source_list.discovery.name, "YouTube");
});

test("human review queue attaches TikTok creator rewards repair work orders to duration warnings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-tiktok-repair-"));
  const artifactDir = await makeStoryPackage(root);
  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan: dryRunPlan({ artifactDir }),
    generatedAt: "2026-05-27T04:30:00.000Z",
    tiktokCreatorRewardsVariantWorkOrder: {
      jobs: [
        {
          story_id: "story-one",
          status: "needs_tiktok_creator_rewards_variant",
          platform: "tiktok",
          current_duration_s: 44.8,
          target_duration_seconds: { min: 61, max: 75 },
          minimum_extension_seconds: 16.2,
          actions: ["write_tiktok_specific_script_extension_source_safely"],
        },
      ],
    },
    tiktokCreatorRewardsRepairReport: {
      jobs: [
        {
          story_id: "story-one",
          status: "blocked",
          blockers: ["tiktok_creator_rewards_platform_variant_materializer_required"],
          required_action:
            "Build a separate long TikTok variant under platform_variants/tiktok_creator_rewards.",
        },
      ],
    },
  });

  const item = queue.review_items[0];
  assert.equal(item.warnings.includes("below_creator_rewards_duration"), true);
  assert.equal(item.platform_repair_requirements.length, 1);
  assert.equal(item.platform_repair_requirements[0].platform, "tiktok");
  assert.equal(item.platform_repair_requirements[0].repair_lane, "tiktok_creator_rewards_variant");
  assert.deepEqual(item.platform_repair_requirements[0].target_duration_seconds, { min: 61, max: 75 });
  assert.equal(item.platform_repair_requirements[0].required_before_counting_commercially_ready, true);
  assert.equal(item.platform_repair_requirements[0].repair_report_status, "blocked");
  assert.deepEqual(
    item.platform_repair_requirements[0].repair_report_blockers,
    ["tiktok_creator_rewards_platform_variant_materializer_required"],
  );
  assert.match(item.platform_repair_requirements[0].required_action, /separate long TikTok variant/);
});

test("human review queue keeps blocked dry-run stories out of approval packets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-blocked-"));
  const artifactDir = await makeStoryPackage(root, "blocked-story");
  const plan = dryRunPlan({ artifactDir, storyId: "blocked-story" });
  plan.actions = [];
  plan.blocked_stories = [
    {
      story_id: "blocked-story",
      artifact_dir: artifactDir,
      blockers: ["incident:title_placeholder"],
    },
  ];
  plan.incident_guard_report.stories[0].verdict = "fail";
  plan.incident_guard_report.stories[0].safe_to_publish_boolean = false;
  plan.incident_guard_report.stories[0].disaster_upload_blockers = ["incident:title_placeholder"];

  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan: plan,
    operatorSourceQueue: {
      stop_condition: { status: "WAITING_FOR_OPERATOR_SOURCE_INPUT" },
      stories: [
        {
          story_id: "blocked-story",
          intake_items: [
            {
              intake_type: "operator_approved_motion_source",
              reason: "The story needs an official, licensed or operator-approved motion source.",
              required_fields: ["approved_direct_media_url_or_local_operator_file_path"],
              template_kind: "licensed_media",
              blocks_readiness_until_submitted: true,
            },
          ],
          licensed_media_template_entries: [
            {
              story_id: "blocked-story",
              approved_direct_media_url: "",
              autonomous_use_approved: false,
            },
          ],
        },
      ],
    },
  });

  assert.equal(queue.summary.review_item_count, 0);
  assert.equal(queue.summary.blocked_item_count, 1);
  assert.equal(queue.blocked_items[0].story_id, "blocked-story");
  assert.deepEqual(queue.blocked_items[0].blockers, ["incident:title_placeholder"]);
  assert.equal(queue.blocked_items[0].source_intake_requirements.stop_condition, "WAITING_FOR_OPERATOR_SOURCE_INPUT");
  assert.equal(queue.blocked_items[0].source_intake_requirements.intake_items.length, 1);
  assert.equal(
    queue.blocked_items[0].source_intake_requirements.intake_items[0].intake_type,
    "operator_approved_motion_source",
  );
  assert.equal(queue.blocked_items[0].source_intake_requirements.licensed_media_template_entries.length, 1);
  assert.equal(queue.safe_publish_plan.can_publish_without_operator, false);
});

test("human review queue blocks stale public coherence artefacts before operator approval", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-stale-coherence-"));
  const artifactDir = await makeStoryPackage(root, "stale-coherence-story");
  await fs.outputJson(path.join(artifactDir, "coherence_report.json"), {
    result: "pass",
    failures: [],
    manifest: {
      selected_title: "Old title",
      thumbnail_headline: "OLD THUMB",
      first_spoken_line: "Old first line.",
      narration_script: "Old script.",
      description: "Old description.",
      source_card_label: "Reddit",
    },
  });

  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan: dryRunPlan({ artifactDir, storyId: "stale-coherence-story" }),
    generatedAt: "2026-05-30T23:28:00.000Z",
  });

  assert.equal(queue.summary.review_item_count, 0);
  assert.equal(queue.summary.blocked_item_count, 1);
  assert.equal(queue.blocked_items[0].story_id, "stale-coherence-story");
  assert.ok(queue.blocked_items[0].blockers.includes("stale_public_output_coherence_report"));
  assert.ok(queue.blocked_items[0].blockers.includes("stale_public_output_coherence_field:selected_title"));
  assert.equal(queue.blocked_items[0].approval.live_publish_allowed_before_repair, false);
});

test("human review queue enriches missing dry-run evidence with render-input repair detail", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-render-input-"));
  const artifactDir = await makeStoryPackage(root, "motion-stale-story");
  const plan = dryRunPlan({ artifactDir, storyId: "motion-stale-story" });
  plan.actions = [];
  plan.blocked_stories = [];
  plan.incident_guard_report.stories[0].verdict = "pass";
  plan.incident_guard_report.stories[0].safe_to_publish_boolean = true;

  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan: plan,
    renderInputWorkOrder: {
      stories: [
        {
          story_id: "motion-stale-story",
          status: "blocked_on_render_inputs",
          blockers: ["materialised_motion_stale_after_public_copy_repair"],
          actions: [
            {
              action_id: "materialise_owned_generated_motion_clips",
              repair_lane: "owned_generated_explainer_motion_materialisation",
              status: "auto_repairable",
              exact_missing_input: "fresh owned/generated motion clips matching the repaired public copy",
              recommended_command:
                "npm run ops:goal-owned-motion -- --story-id motion-stale-story --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-contract --refresh-existing --json",
              post_repair_validation_command:
                "npm run ops:goal-render-inputs -- --cutover-plan output/goal-contract/production_render_cutover_plan.json --out-dir output/goal-contract --json",
              reason_codes: ["materialised_motion_stale_after_public_copy_repair"],
              auto_repairable: true,
              operator_approval_required: false,
            },
          ],
        },
      ],
    },
  });

  assert.equal(queue.summary.review_item_count, 0);
  assert.equal(queue.summary.blocked_item_count, 1);
  const blocked = queue.blocked_items[0];
  assert.equal(blocked.story_id, "motion-stale-story");
  assert.equal(blocked.blockers.includes("human_review_missing_safe_dry_run_evidence"), true);
  assert.equal(blocked.blockers.includes("materialised_motion_stale_after_public_copy_repair"), true);
  assert.equal(blocked.render_input_requirements.length, 1);
  assert.equal(blocked.render_input_requirements[0].repair_lane, "owned_generated_explainer_motion_materialisation");
  assert.equal(blocked.render_input_requirements[0].auto_repairable, true);
  assert.match(blocked.render_input_requirements[0].recommended_command, /goal-owned-motion/);
});

test("human review queue propagates operator-required render-input jobs to blocked items", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-render-jobs-"));
  const artifactDir = await makeStoryPackage(root, "dead-end-story");
  const plan = dryRunPlan({ artifactDir, storyId: "dead-end-story" });
  plan.actions = [];
  plan.blocked_stories = [];
  plan.incident_guard_report.stories[0].verdict = "pass";
  plan.incident_guard_report.stories[0].safe_to_publish_boolean = true;

  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan: plan,
    renderInputWorkOrder: {
      jobs: [
        {
          story_id: "dead-end-story",
          status: "blocked_on_render_inputs",
          blockers: ["public_copy_repair_required"],
          actions: [
            {
              action_id: "repair_public_output_coherence",
              status: "reject_recommended",
              repair_lane: "reject_or_human_review_non_news_image_post",
              exact_missing_input: "Reject the story or supply a real primary source before any render repair.",
              recommended_command: "Reject dead-end-story from autonomous production.",
              reason_codes: ["public_copy_repair_required"],
              auto_repairable: false,
              operator_approval_required: true,
              dead_end_blocker: true,
            },
          ],
        },
      ],
    },
  });

  assert.equal(queue.summary.review_item_count, 0);
  assert.equal(queue.summary.blocked_item_count, 1);
  const blocked = queue.blocked_items[0];
  assert.equal(blocked.story_id, "dead-end-story");
  assert.equal(blocked.operator_queue_status, "operator_required");
  assert.equal(blocked.dead_end_blocker, true);
  assert.equal(blocked.reject_recommended, true);
  assert.equal(blocked.approval.operator_approval_required, true);
  assert.equal(blocked.render_input_requirements.length, 1);
  assert.equal(blocked.render_input_requirements[0].status, "reject_recommended");
  assert.equal(blocked.render_input_requirements[0].operator_approval_required, true);
  assert.equal(blocked.render_input_requirements[0].dead_end_blocker, true);

  const markdown = renderGoalHumanReviewQueueMarkdown(queue);
  assert.match(markdown, /queue: operator_required/);
  assert.match(markdown, /dead-end: yes/);
  assert.match(markdown, /reject: yes/);
});

test("human review queue writes machine-readable artefacts and operator Markdown", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-write-"));
  const artifactDir = await makeStoryPackage(root);
  const queue = await buildGoalHumanReviewQueue({ dryRunPlan: dryRunPlan({ artifactDir }) });
  const written = await writeGoalHumanReviewQueue(queue, { outputDir: root });

  assert.equal(await fs.pathExists(path.join(root, "human_review_queue.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "human_review_queue.md")), true);
  assert.equal(await fs.pathExists(path.join(root, "safe_publish_plan.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "approval_requirements.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "review_packet_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(root, "operator_decision_log.json")), true);
  assert.equal(path.basename(written.jsonPath), "human_review_queue.json");
  assert.equal(path.basename(written.reviewPacketManifestPath), "review_packet_manifest.json");
  assert.equal(path.basename(written.operatorDecisionLogPath), "operator_decision_log.json");

  const markdown = await fs.readFile(path.join(root, "human_review_queue.md"), "utf8");
  assert.match(markdown, /# Human Review Queue/);
  assert.match(markdown, /Forza Horizon 6 Exposes Xbox's Steam Bet/);
  assert.match(markdown, /Primary source: Eurogamer \(https:\/\/www\.eurogamer\.net\/forza-horizon-6-steam\)/);
  assert.match(markdown, /Platform enablement requirements: tiktok:needs_credentials/);
  assert.match(markdown, /tiktok_local_token_refresh_or_sync_required/);
  assert.match(markdown, /x_api_billing_not_declared/);
  assert.match(markdown, /No uploads are triggered/);

  const packetManifest = await fs.readJson(path.join(root, "review_packet_manifest.json"));
  assert.equal(packetManifest.mode, "HUMAN_REVIEW");
  assert.equal(packetManifest.review_packets.length, 1);
  assert.equal(packetManifest.review_packets[0].story_id, "story-one");
  assert.deepEqual(packetManifest.review_packets[0].required_operator_checks, [
    "watch_first_three_seconds",
    "inspect_first_three_second_visual_strip",
    "confirm_visual_strip_qa_green_or_request_repairs",
    "verify_title_thumbnail_opening_source_parity",
    "verify_enabled_platforms_only",
    "confirm_no_disabled_platform_counted_ready",
    "record_approve_or_reject_decision",
  ]);
  assert.equal(packetManifest.review_packets[0].artefacts.video_path.endsWith("visual_v4_render.mp4"), true);
  assert.equal(packetManifest.review_packets[0].artefacts.canonical_manifest_path.endsWith("canonical_story_manifest.json"), true);
  assert.equal(
    packetManifest.review_packets[0].artefacts.human_review_visual_strip_report_path.endsWith("human_review_visual_strip_report.json"),
    true,
  );
  assert.equal(
    packetManifest.review_packets[0].artefacts.human_review_visual_strip_qa_report_path.endsWith("human_review_visual_strip_qa_report.json"),
    true,
  );
  assert.equal(packetManifest.safety.no_live_publish_from_manifest, true);

  const decisionLog = await fs.readJson(path.join(root, "operator_decision_log.json"));
  assert.equal(decisionLog.mode, "HUMAN_REVIEW_DECISION_LOG");
  assert.deepEqual(decisionLog.decisions, []);
  assert.equal(decisionLog.decision_template.operator, "");
  assert.equal(decisionLog.safety.no_live_publish_from_log, true);
});

test("human review queue CLI is registered and emits clean JSON", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-human-review-cli-"));
  const artifactDir = await makeStoryPackage(root);
  const dryRunPath = path.join(root, "dry_run_publish_plan.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(dryRunPath, dryRunPlan({ artifactDir }), { spaces: 2 });

  const result = spawnSync(
    process.execPath,
    ["tools/goal-human-review-queue.js", "--dry-run-plan", dryRunPath, "--out-dir", outDir, "--json"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trimStart().startsWith("{"), result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.summary.review_item_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "human_review_queue.json")), true);

  const blockedArtifactDir = await makeStoryPackage(root, "blocked-cli-story");
  const blockedPlan = dryRunPlan({ artifactDir: blockedArtifactDir, storyId: "blocked-cli-story" });
  blockedPlan.actions = [];
  blockedPlan.blocked_stories = [
    {
      story_id: "blocked-cli-story",
      artifact_dir: blockedArtifactDir,
      blockers: ["operator_source_required"],
    },
  ];
  blockedPlan.incident_guard_report.stories[0].verdict = "fail";
  blockedPlan.incident_guard_report.stories[0].safe_to_publish_boolean = false;
  const blockedDryRunPath = path.join(root, "blocked_dry_run_publish_plan.json");
  const operatorSourceQueuePath = path.join(root, "operator_source_intake_queue.json");
  const blockedOutDir = path.join(root, "blocked-out");
  await fs.writeJson(blockedDryRunPath, blockedPlan, { spaces: 2 });
  await fs.writeJson(operatorSourceQueuePath, {
    stop_condition: { status: "WAITING_FOR_OPERATOR_SOURCE_INPUT" },
    stories: [
      {
        story_id: "blocked-cli-story",
        intake_items: [
          {
            intake_type: "operator_approved_motion_source",
            reason: "Needs a rights-backed motion source.",
            required_fields: ["approved_direct_media_url_or_local_operator_file_path"],
            template_kind: "licensed_media",
            blocks_readiness_until_submitted: true,
          },
        ],
      },
    ],
  }, { spaces: 2 });

  const blockedResult = spawnSync(
    process.execPath,
    [
      "tools/goal-human-review-queue.js",
      "--dry-run-plan",
      blockedDryRunPath,
      "--operator-source-queue",
      operatorSourceQueuePath,
      "--out-dir",
      blockedOutDir,
      "--json",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
    },
  );

  assert.equal(blockedResult.status, 0, blockedResult.stderr);
  const blockedParsed = JSON.parse(blockedResult.stdout);
  assert.equal(blockedParsed.summary.blocked_item_count, 1);
  assert.equal(
    blockedParsed.blocked_items[0].source_intake_requirements.intake_items[0].intake_type,
    "operator_approved_motion_source",
  );

  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(pkg.scripts["ops:goal-human-review"], "node tools/goal-human-review-queue.js");
});
