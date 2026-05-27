"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildGovernanceGreenApprovalPromotionPlan,
  buildPublishBlockerResolutionPlan,
  classifyPublishBlocker,
  formatPublishBlockerResolutionMarkdown,
} = require("../../lib/services/publish-blocker-resolution");
const {
  buildPromotionApplyPreview,
  normaliseLaneFilter,
  parseArgs,
  publishResolutionInputsFromCandidateReport,
} = require("../../tools/publish-blocker-resolution");

test("publish blocker resolution turns not-approved V4 green stories into approval-promotion work", () => {
  const story = {
    id: "1thsxw7",
    title: "Forza Horizon 6 achieved a peak of over 273k players on Steam",
    breaking_score: 82,
  };

  const item = classifyPublishBlocker({
    story,
    reason: "not_approved",
    governanceGreenStoryIds: new Set(["1thsxw7"]),
    v4ReadyStoryIds: new Set(["1thsxw7"]),
  });

  assert.equal(item.resolution_lane, "governance_green_approval_promotion");
  assert.equal(item.dead_end, false);
  assert.equal(item.can_apply_automatically, false);
  assert.match(item.safe_next_command, /ops:publish-unblock/);
});

test("publish blocker resolution maps common production blockers to concrete recovery lanes", () => {
  const cases = [
    ["qa_failure:audio_generation_failed:tts_timeout", "audio_regeneration"],
    ["qa_failure:script_generation_review:Actual spoken word count 172 outside 180-220 Flash Lane range", "script_runtime_rewrite"],
    ["qa_failure:script_generation_review:script_coherence:top_comment_used_as_fact", "canonical_script_rewrite"],
    ["qa_failure:thin_visuals_blocked:thin_visuals_below_three", "visual_v4_motion_enrichment"],
    ["content_qa:risky_article_context_dominated_deck (5 risky article images, 0 safe non-article images)", "visual_v4_motion_enrichment"],
    ["qa_failure:script_generation_review:script_generation_error:Bad control character in string literal", "script_generation_retry"],
    ["instagram story upload failed after 3 attempts: Only photo or video can be accepted", "platform_media_repair"],
    ["Instagram URL processing failed: status_code=ERROR status=Error: Media upload has failed with error code 2207076", "platform_media_repair"],
    ["missing_mp4", "produce_or_render"],
  ];

  for (const [reason, expectedLane] of cases) {
    const item = classifyPublishBlocker({
      story: {
        id: "story-1",
        title: "Test Story",
        source_type: /top_comment_used_as_fact/.test(reason) ? "rss" : "",
        article_url: /top_comment_used_as_fact/.test(reason) ? "https://www.eurogamer.net/story" : "",
      },
      reason,
    });
    assert.equal(item.resolution_lane, expectedLane, reason);
    assert.equal(item.dead_end, false, reason);
    assert.ok(item.safe_next_command, reason);
  }
});

test("publish blocker resolution rechecks stale exact-CTA failures when the current script has an approved identity CTA", () => {
  const item = classifyPublishBlocker({
    story: {
      id: "identity-cta",
      title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      full_script:
        "Forza Horizon 6 just gave Xbox the Steam number it needed. Follow Pulse Gaming for the gaming stories behind the headline.",
      cta: "Follow Pulse Gaming for the gaming stories behind the headline.",
    },
    reason: "qa_failure:script_generation_review:script_coherence:missing_exact_cta_in_script",
  });

  assert.equal(item.resolution_lane, "stale_script_qa_recheck");
  assert.equal(item.dead_end, false);
  assert.equal(item.can_apply_automatically, true);
  assert.equal(item.safety_gate, "fresh_preflight_required_no_db_mutation");
  assert.match(item.safe_next_command, /next-publish-candidates/);
});

test("publish blocker resolution still rewrites source-backed missing-CTA failures when the script has no approved CTA", () => {
  const item = classifyPublishBlocker({
    story: {
      id: "missing-cta",
      title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      source_type: "rss",
      article_url: "https://www.windowscentral.com/gaming/forza/example",
      full_script: "Forza Horizon 6 just gave Xbox the Steam number it needed.",
    },
    reason: "qa_failure:script_generation_review:script_coherence:missing_exact_cta_in_script",
  });

  assert.equal(item.resolution_lane, "canonical_script_rewrite");
  assert.equal(item.can_apply_automatically, true);
});

test("publish blocker resolution holds community-thread failures instead of auto-rewriting unsupported copy", () => {
  const item = classifyPublishBlocker({
    story: {
      id: "community-thread",
      title: "Did we lose the magic of community in online multiplayer games?",
      source_type: "reddit",
      subreddit: "gaming",
      full_script:
        "Did we lose the magic of online multiplayer? Follow Pulse Gaming for the gaming stories behind the headline.",
      cta: "Follow Pulse Gaming for the gaming stories behind the headline.",
    },
    reason: "qa_failure:script_generation_review:script_coherence:missing_exact_cta_in_script",
  });

  assert.equal(item.resolution_lane, "manual_triage");
  assert.equal(item.safety_gate, "source_backed_rewrite_or_reject_required");
  assert.equal(item.can_apply_automatically, false);
});

test("publish blocker resolution does not stale-recheck unsupported insider scripts", () => {
  const item = classifyPublishBlocker({
    story: {
      id: "unsupported-insider",
      title:
        "Japanese game studio Level-5 is criticised for anti-piracy warning as their games are $1,800 on eBay",
      source_type: "reddit",
      subreddit: "Games",
      full_script:
        "According to Dexerto, a verified insider claims that Level-5's anti-piracy stance is backfiring. Follow Pulse Gaming for the gaming stories behind the headline.",
      cta: "Follow Pulse Gaming for the gaming stories behind the headline.",
    },
    reason: "qa_failure:script_generation_review:script_coherence:missing_exact_cta_in_script",
  });

  assert.equal(item.resolution_lane, "manual_triage");
  assert.equal(item.safety_gate, "source_backed_rewrite_or_reject_required");
  assert.doesNotMatch(item.safe_next_command, /reprocess-script-failures/);
});

test("publish blocker resolution plan has no dead-end blockers and includes fresh acquisition fallback", () => {
  const plan = buildPublishBlockerResolutionPlan({
    stories: [
      { id: "1thsxw7", title: "Forza Horizon 6", breaking_score: 82 },
      { id: "1tijkr2", title: "State of Play returns Tuesday", breaking_score: 75 },
      { id: "1thnwdq", title: "Xbox Player Voice", breaking_score: 71 },
    ],
    excluded: [
      { id: "1thsxw7", reason: "not_approved", title: "Forza Horizon 6" },
      { id: "1tijkr2", reason: "qa_failure:audio_generation_failed:tts_timeout", title: "State of Play returns Tuesday" },
      { id: "1thnwdq", reason: "missing_mp4", title: "Xbox Player Voice" },
    ],
    governanceGreenStoryIds: ["1thsxw7"],
    v4ReadyStoryIds: ["1thsxw7"],
    candidateCount: 0,
    limit: 10,
  });

  assert.equal(plan.no_dead_end_blockers, true);
  assert.equal(plan.summary.total_blockers_seen, 3);
  assert.equal(plan.summary.total_resolution_items, 3);
  assert.equal(plan.summary.resolution_items, 3);
  assert.ok(plan.recovery_lanes.governance_green_approval_promotion);
  assert.equal(plan.publish_runway.status, "operator_confirmed_green_pack_available");
  assert.equal(plan.publish_runway.green_pack_available, 1);
  assert.ok(plan.repair_orchestration);
  assert.equal(plan.repair_orchestration.mode, "safe_repair_sequence");
  assert.ok(
    plan.repair_orchestration.stages.some(
      (stage) => stage.id === "auto_repair_backlog" && stage.items.length === 2,
    ),
  );
  assert.ok(plan.fresh_content_fallback.enabled);
  assert.equal(plan.safety.db_mutation, false);
  assert.equal(plan.safety.posting, false);
});

test("publish blocker resolution fallback explains when publishable candidates already exist", () => {
  const plan = buildPublishBlockerResolutionPlan({
    stories: [{ id: "story-1", title: "A Story" }],
    excluded: [{ id: "story-1", reason: "missing_mp4", title: "A Story" }],
    candidateCount: 2,
  });

  assert.equal(plan.fresh_content_fallback.enabled, false);
  assert.match(plan.fresh_content_fallback.reason, /Publishable candidates already exist/);
});

test("publish blocker resolution runway measures the whole backlog, not just returned rows", () => {
  const plan = buildPublishBlockerResolutionPlan({
    stories: [
      { id: "green", title: "Governance Green Story", breaking_score: 90 },
      { id: "audio", title: "Audio Repair Story", breaking_score: 80 },
      {
        id: "script",
        title: "Script Repair Story",
        breaking_score: 70,
        source_type: "rss",
        article_url: "https://www.ign.com/articles/script-repair-story",
      },
    ],
    excluded: [
      { id: "green", reason: "not_approved", title: "Governance Green Story" },
      { id: "audio", reason: "qa_failure:audio_generation_failed:tts_timeout", title: "Audio Repair Story" },
      { id: "script", reason: "qa_failure:script_generation_review:script_coherence:placeholder_title", title: "Script Repair Story" },
    ],
    governanceGreenStoryIds: ["green"],
    v4ReadyStoryIds: ["green"],
    candidateCount: 0,
    limit: 1,
  });

  assert.equal(plan.summary.resolution_items, 1);
  assert.equal(plan.summary.total_resolution_items, 3);
  assert.equal(plan.summary.auto_repairable_items, 2);
  assert.equal(plan.summary.operator_confirmed_items, 1);
  assert.equal(plan.publish_runway.repairable_backlog, 2);
  assert.equal(plan.publish_runway.returned_items, 1);
  assert.equal(plan.no_dead_end_blockers, true);
});

test("publish blocker resolution inputs count only preflight-passing candidates as publishable", () => {
  const inputs = publishResolutionInputsFromCandidateReport({
    totals: { candidates: 3 },
    candidates: [
      {
        id: "passes",
        title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
        preflight_qa: { status: "pass", blockers: [], warnings: [] },
      },
      {
        id: "blocked",
        title: "The Expanse Shows A Risky First Look",
        preflight_qa: {
          status: "blocked",
          blockers: ["incident_guard:visual_evidence:direct_video_motion_missing"],
          warnings: [],
        },
      },
      {
        id: "warn",
        title: "Hades II Needs Human Review",
        preflight_qa: { status: "warn", blockers: [], warnings: ["content:review_required"] },
      },
    ],
    excluded: [
      { id: "missing", title: "Missing MP4 Story", reason: "missing_mp4" },
    ],
  });

  assert.equal(inputs.candidateCount, 1);
  assert.deepEqual(
    inputs.excluded.map((row) => [row.id, row.reason]),
    [
      ["missing", "missing_mp4"],
      ["blocked", "incident_guard:visual_evidence:direct_video_motion_missing"],
      ["warn", "preflight_warning:content:review_required"],
    ],
  );
});

test("publish blocker resolution markdown is operator-readable", () => {
  const plan = buildPublishBlockerResolutionPlan({
    stories: [{ id: "story-1", title: "A Story" }],
    excluded: [{ id: "story-1", reason: "missing_mp4", title: "A Story" }],
    candidateCount: 0,
  });
  const markdown = formatPublishBlockerResolutionMarkdown(plan);

  assert.match(markdown, /# Publish Blocker Resolution/);
  assert.match(markdown, /No Dead Ends/);
  assert.match(markdown, /produce_or_render/);
  assert.match(markdown, /Fresh Content Fallback/);
});

test("publish blocker resolution markdown reports apply-mode DB mutation honestly", () => {
  const plan = buildPublishBlockerResolutionPlan({
    stories: [{ id: "story-1", title: "A Story" }],
    excluded: [{ id: "story-1", reason: "missing_mp4", title: "A Story" }],
    candidateCount: 0,
  });
  plan.safety = {
    mode: "apply",
    db_mutation: true,
    posting: false,
    oauth: false,
    token_printing: false,
    safety_gates_weakened: false,
  };

  const markdown = formatPublishBlockerResolutionMarkdown(plan);

  assert.match(markdown, /mode: apply/);
  assert.match(markdown, /production DB mutation: yes/);
  assert.doesNotMatch(markdown, /- read-only/);
});

test("publish blocker resolution CLI parses direct dry-run recovery filters", () => {
  const args = parseArgs([
    "node",
    "tool",
    "--story-id",
    "1thsxw7",
    "--lane",
    "governance-green-approval",
    "--dry-run",
    "--apply",
    "--operator-confirmed",
    "--render-path",
    "proof.mp4",
    "--json",
  ]);

  assert.equal(args.storyId, "1thsxw7");
  assert.equal(args.lane, "governance-green-approval");
  assert.equal(args.dryRun, true);
  assert.equal(args.apply, true);
  assert.equal(args.operatorConfirmed, true);
  assert.equal(args.renderPath, "proof.mp4");
  assert.equal(args.json, true);
  assert.equal(
    normaliseLaneFilter(args.lane),
    "governance_green_approval_promotion",
  );
});

test("governance-green approval promotion builds a safe DB update only for matching green packs", () => {
  const liveStory = {
    id: "1thsxw7",
    title: "Old Forza Title",
    approved: false,
    youtube_post_id: "",
  };
  const renderStory = {
    id: "1thsxw7",
    title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    canonical_subject: "Forza Horizon 6",
    full_script: "Forza Horizon 6 just gave Xbox the Steam number it needed.",
    tts_script: "Forza Horizon 6 just gave Xbox the Steam number it needed.",
    suggested_thumbnail_text: "273,148 ON STEAM",
    thumbnail_headline: "273,148 ON STEAM",
    first_frame_text: "XBOX NEEDED THIS",
    audio_path: "test/output/audio/1thsxw7.mp3",
    rights_ledger: [{ asset_id: "clip-1" }],
    visual_v4_bridge_video_clips: [
      { source_family: "family-a" },
      { source_family: "family-b" },
      { source_family: "family-c" },
    ],
  };
  const manifest = {
    story_id: "1thsxw7",
    canonical_subject: "Forza Horizon 6",
    title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    publish_status: "GREEN",
    can_auto_publish: true,
    reason_codes: [],
  };

  const plan = buildGovernanceGreenApprovalPromotionPlan({
    liveStory,
    renderStory,
    manifest,
    renderPath: "test/output/studio_v4_1thsxw7_fresh_ready_proof.mp4",
    renderReport: {
      audio_duration_s: 35.2,
      rendered_duration_s: 35.2,
    },
    fileExists: () => true,
    generatedAt: "2026-05-21T15:00:00.000Z",
  });

  assert.equal(plan.status, "ready_for_operator_confirmed_apply");
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.update_story.approved, true);
  assert.equal(plan.update_story.auto_approved, true);
  assert.equal(plan.update_story.approved_at, "2026-05-21T15:00:00.000Z");
  assert.equal(plan.update_story.exported_path, "test/output/studio_v4_1thsxw7_fresh_ready_proof.mp4");
  assert.equal(plan.update_story.title, "Forza Horizon 6 Just Broke Xbox's Steam Ceiling");
  assert.equal(plan.update_story.suggested_thumbnail_text, "FORZA 273,148 ON STEAM");
  assert.equal(plan.update_story.thumbnail_headline, "FORZA 273,148 ON STEAM");
  assert.equal(plan.update_story.first_frame_text, "FORZA 273,148 ON STEAM");
  assert.equal(plan.update_story.word_count, 11);
  assert.equal(plan.update_story.render_quality_class, "premium");
  assert.equal(plan.update_story.audio_duration, 35.2);
  assert.equal(plan.update_story.duration_seconds, 35.2);
  assert.equal(plan.update_story.duration_lane, "pulse_retention_short");
  assert.equal(plan.update_story.allow_retention_short_video, true);
  assert.equal(plan.update_story.min_video_duration_seconds, 22);
});

test("governance-green approval promotion includes an operator review packet", () => {
  const plan = buildGovernanceGreenApprovalPromotionPlan({
    liveStory: {
      id: "1thsxw7",
      title: "Old Forza Title",
      approved: false,
      auto_approved: false,
      exported_path: "old.mp4",
      rights_ledger: [{ asset_id: "old-audio" }],
      game_images: [
        {
          url: "https://cdn.akamai.steamstatic.com/steam/apps/2483190/header.jpg",
          source: "steam",
        },
      ],
    },
    renderStory: {
      id: "1thsxw7",
      title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      canonical_subject: "Forza Horizon 6",
      full_script: "Forza Horizon 6 just gave Xbox the Steam number it needed.",
      audio_path: "audio.mp3",
      rights_ledger: [{ asset_id: "audio", path: "audio.mp3" }],
      visual_v4_bridge_video_clips: [
        { source_family: "a" },
        { source_family: "b" },
        { source_family: "c" },
        { source_family: "a" },
      ],
    },
    manifest: {
      story_id: "1thsxw7",
      canonical_subject: "Forza Horizon 6",
      title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      publish_status: "GREEN",
      can_auto_publish: true,
      reason_codes: [],
    },
    renderPath: "proof.mp4",
    fileExists: () => true,
  });

  assert.equal(plan.status, "ready_for_operator_confirmed_apply");
  assert.equal(plan.operator_review.story_id, "1thsxw7");
  assert.ok(plan.operator_review.changed_fields.includes("title"));
  assert.ok(plan.operator_review.changed_fields.includes("exported_path"));
  assert.ok(plan.operator_review.changed_fields.includes("suggested_thumbnail_text"));
  assert.ok(plan.operator_review.approval_changes.some((change) => change.field === "approved"));
  assert.equal(plan.operator_review.asset_summary.motion_clips, 4);
  assert.equal(plan.operator_review.asset_summary.unique_motion_families, 3);
  assert.equal(plan.operator_review.asset_summary.rights_ledger_records_before, 1);
  assert.equal(plan.operator_review.asset_summary.rights_ledger_records_after, 2);
  assert.equal(plan.operator_review.asset_summary.inherited_steam_visual_rights_added, 1);
  assert.deepEqual(plan.operator_review.public_platform_fields_present, []);
});

test("governance-green approval promotion adds rights records for inherited Steam visuals", () => {
  const plan = buildGovernanceGreenApprovalPromotionPlan({
    liveStory: {
      id: "1thsxw7",
      title: "Old Forza Title",
      game_images: [
        {
          url: "https://cdn.akamai.steamstatic.com/steam/apps/2483190/header.jpg",
          type: "key_art",
          source: "steam",
        },
      ],
    },
    renderStory: {
      id: "1thsxw7",
      title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      canonical_subject: "Forza Horizon 6",
      full_script: "Forza Horizon 6 just gave Xbox the Steam number it needed.",
      audio_path: "audio.mp3",
      rights_ledger: [
        {
          asset_id: "audio",
          path: "audio.mp3",
          licence_basis: "owned_local_voice_model",
        },
      ],
      visual_v4_bridge_video_clips: [
        { source_family: "a" },
        { source_family: "b" },
        { source_family: "c" },
      ],
    },
    manifest: {
      story_id: "1thsxw7",
      canonical_subject: "Forza Horizon 6",
      title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      publish_status: "GREEN",
      can_auto_publish: true,
      reason_codes: [],
    },
    renderPath: "proof.mp4",
    fileExists: () => true,
  });

  assert.equal(plan.status, "ready_for_operator_confirmed_apply");
  assert.ok(
    plan.update_story.rights_ledger.some(
      (record) =>
        record.source_url === "https://cdn.akamai.steamstatic.com/steam/apps/2483190/header.jpg" &&
        record.licence_basis === "steam_storefront_promotional_reference",
    ),
  );
});

test("governance-green apply preview is operator-only and names backup plus verification steps", () => {
  const preview = buildPromotionApplyPreview({
    promotionPlan: {
      status: "ready_for_operator_confirmed_apply",
      story_id: "1thsxw7",
      generated_at: "2026-05-21T17:30:00.000Z",
    },
    dbPath: "D:/pulse-data/pulse.db",
    preApplyPreflight: {
      status: "pass",
      blockers: [],
      warnings: [],
    },
  });

  assert.equal(preview.status, "ready_operator_only");
  assert.equal(preview.pre_apply_preflight_status, "pass");
  assert.equal(preview.db_mutation_on_apply, true);
  assert.equal(preview.posting, false);
  assert.equal(preview.requires_operator_confirmed, true);
  assert.equal(preview.verification_phase, "post_apply");
  assert.equal(preview.live_row_expected_blocked_before_apply, true);
  assert.match(preview.expected_backup_path, /D:[/\\]pulse-data[/\\]backups[/\\]pulse-pre-governance-green-promotion/);
  assert.match(preview.apply_command, /--apply --operator-confirmed/);
  assert.ok(preview.verification_commands.some((command) => /next-publish-candidates/.test(command)));
});

test("governance-green apply preview blocks when promoted-row preflight blocks", () => {
  const preview = buildPromotionApplyPreview({
    promotionPlan: {
      status: "ready_for_operator_confirmed_apply",
      story_id: "1thsxw7",
      generated_at: "2026-05-21T17:30:00.000Z",
    },
    dbPath: "D:/pulse-data/pulse.db",
    preApplyPreflight: {
      status: "blocked",
      blockers: ["governance:publish_verdict_not_green"],
      warnings: [],
    },
  });

  assert.equal(preview.status, "blocked_preflight");
  assert.equal(preview.pre_apply_preflight_status, "blocked");
  assert.deepEqual(preview.pre_apply_preflight_blockers, [
    "governance:publish_verdict_not_green",
  ]);
});

test("publish blocker markdown includes governance-green apply preview", () => {
  const markdown = formatPublishBlockerResolutionMarkdown({
    generated_at: "2026-05-21T17:30:00.000Z",
    safety: { mode: "read_only" },
    summary: {},
    no_dead_end_blockers: true,
    publish_runway: {},
    recovery_lanes: {},
    priority_items: [],
    promotion_plan: {
      status: "ready_for_operator_confirmed_apply",
      story_id: "1thsxw7",
      evidence: {
        render_path: "proof.mp4",
        unique_motion_families: 7,
      },
      operator_review: {
        changed_fields: ["title", "exported_path", "approved"],
        public_platform_fields_present: [],
        asset_summary: {
          motion_clips: 8,
          unique_motion_families: 7,
          rights_ledger_records_before: 8,
          rights_ledger_records_after: 15,
          inherited_steam_visual_rights_added: 7,
        },
      },
    },
    promotion_apply_preview: {
      status: "ready_operator_only",
      pre_apply_preflight_status: "pass",
      verification_phase: "post_apply",
      live_row_expected_blocked_before_apply: true,
      expected_backup_path: "D:/pulse-data/backups/pulse-pre-governance-green-promotion.db",
      apply_command:
        "npm run ops:publish-unblock -- --story-id 1thsxw7 --lane governance-green-approval --apply --operator-confirmed",
      verification_commands: [
        "npm run ops:next-publish-candidates -- --preflight-qa --story-id 1thsxw7",
      ],
    },
  });

  assert.match(markdown, /Apply Preview/);
  assert.match(markdown, /Operator Review/);
  assert.match(markdown, /verification phase: post_apply/);
  assert.match(markdown, /live row expected blocked before apply: yes/);
  assert.match(markdown, /changed fields: title, exported_path, approved/);
  assert.match(markdown, /inherited Steam visual rights added: 7/);
  assert.match(markdown, /expected backup/);
  assert.match(markdown, /--operator-confirmed/);
  assert.match(markdown, /next-publish-candidates/);
});

test("governance-green approval promotion blocks mismatched or non-green packs", () => {
  const plan = buildGovernanceGreenApprovalPromotionPlan({
    liveStory: { id: "live", title: "Live" },
    renderStory: {
      id: "other",
      title: "Other",
      canonical_subject: "Other",
      full_script: "Other starts here.",
      audio_path: "audio.mp3",
      rights_ledger: [{ asset_id: "clip-1" }],
      visual_v4_bridge_video_clips: [
        { source_family: "a" },
        { source_family: "b" },
        { source_family: "c" },
      ],
    },
    manifest: {
      story_id: "live",
      canonical_subject: "Live",
      title: "Live",
      publish_status: "RED",
      can_auto_publish: false,
      reason_codes: ["public_output:placeholder_title"],
    },
    renderPath: "proof.mp4",
    fileExists: () => true,
  });

  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockers.includes("manifest_not_green"));
  assert.ok(plan.blockers.includes("render_story_id_mismatch"));
});

test("governance-green approval promotion allows missing audio sidecar when final render has audio", () => {
  const plan = buildGovernanceGreenApprovalPromotionPlan({
    liveStory: { id: "story", title: "Story" },
    renderStory: {
      id: "story",
      title: "Story Title",
      canonical_subject: "Story",
      full_script: "Story starts with the subject.",
      audio_path: "missing-sidecar.mp3",
      rights_ledger: [{ asset_id: "audio" }],
      visual_v4_bridge_video_clips: [
        { source_family: "a" },
        { source_family: "b" },
        { source_family: "c" },
      ],
    },
    manifest: {
      story_id: "story",
      canonical_subject: "Story",
      title: "Story Title",
      publish_status: "GREEN",
      can_auto_publish: true,
      reason_codes: [],
    },
    renderPath: "final.mp4",
    fileExists: (file) => file === "final.mp4",
    renderHasAudio: () => true,
  });

  assert.equal(plan.status, "ready_for_operator_confirmed_apply");
  assert.ok(plan.warnings.includes("audio_sidecar_missing_but_render_has_audio"));
});
