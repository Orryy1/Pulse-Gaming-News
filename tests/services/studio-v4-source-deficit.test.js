"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const packageJson = require("../../package.json");

const {
  buildStudioV4SourceDeficitReport,
  renderStudioV4SourceDeficitMarkdown,
} = require("../../lib/studio/v4/source-deficit");
const { main: runSourceDeficitCli } = require("../../tools/studio-v4-source-deficit");

test("Studio V4 source deficit report turns blocked motion packs into specific acquisition actions", () => {
  const report = buildStudioV4SourceDeficitReport({
    generatedAt: "2026-05-19T22:30:00.000Z",
    motionPackReports: [
      {
        story_id: "1tftq7f",
        title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
        readiness: {
          status: "v4_motion_blocked",
          blockers: [
            "actual_motion_clip_minimum_not_met",
            "distinct_motion_families_minimum_not_met",
          ],
        },
        clips: [
          {
            source_family: "steam_2483190_1133501958",
            validated: true,
            segmentValidationPassed: true,
          },
        ],
        motion_budget: {
          available_motion_clips: 1,
          required_motion_scenes: 7,
          available_distinct_families: 1,
          required_distinct_families: 6,
        },
        rejected_candidates: [
          {
            source_family: "steam_2483190_1133501958",
            reason: "source_family_already_used",
          },
          {
            source_family: "cdn_forza",
            reason: "segment_not_validated",
          },
        ],
      },
    ],
    sourceFamilyReport: {
      rows: [
        {
          story_id: "1tftq7f",
          source_family_candidates: [
            {
              source_family: "forza_official_site_forza_horizon_6",
              display_name: "Forza official site - Forza Horizon 6",
              source_tier: "official",
              source_url_kind: "html_or_unknown_page",
              status: "needs_direct_media_url",
            },
            {
              source_family: "ign_first_forza_horizon_6_gameplay",
              display_name: "IGN First - Forza Horizon 6 gameplay reference",
              source_tier: "trusted_creator_reference",
              source_url_kind: "html_or_unknown_page",
              status: "needs_direct_media_url",
            },
            {
              source_family: "xbox_official_youtube_forza_horizon_6_launch_trailer",
              display_name: "Xbox official YouTube - Forza Horizon 6 launch trailer",
              source_tier: "official",
              source_url_kind: "youtube_watch",
              status: "needs_direct_media_url",
            },
          ],
        },
      ],
    },
    directMediaDiscoveryReport: {
      rows: [
        {
          story_id: "1tftq7f",
          source_family: "forza_official_site_forza_horizon_6",
          status: "direct_media_found",
          direct_media_url:
            "https://cdn.forza.net/strapi-uploads/assets/Forza_Horizon_6_Primary_Animated_Keyart_f0431e036f.webm",
          source_url_kind: "direct_video",
          source_duration_s: 10,
        },
      ],
    },
  });

  assert.equal(report.schema_version, 1);
  assert.equal(report.summary.blocked_stories, 1);
  assert.equal(report.summary.missing_motion_families, 5);
  assert.equal(report.summary.missing_motion_clips, 6);
  assert.equal(report.summary.direct_media_ready, 1);
  assert.equal(report.summary.licence_or_operator_required, 2);

  const row = report.rows[0];
  assert.equal(row.story_id, "1tftq7f");
  assert.equal(row.render_decision, "hold_v4_source_acquisition_required");
  assert.equal(row.scheduler_gate, "legacy_allowed_but_do_not_claim_visual_v4");
  assert.deepEqual(row.current_motion_families, ["steam_2483190_1133501958"]);
  assert.ok(row.must_not_use.includes("random_youtube_reupload"));
  assert.ok(row.must_not_use.includes("duplicate_motion_family_padding"));

  const direct = row.required_acquisitions.find(
    (item) => item.source_family === "forza_official_site_forza_horizon_6",
  );
  assert.equal(direct.action, "intake_direct_media_and_validate_segments");
  assert.equal(direct.direct_media_url_kind, "direct_video");
  assert.equal(direct.priority, "urgent");

  const ign = row.required_acquisitions.find(
    (item) => item.source_family === "ign_first_forza_horizon_6_gameplay",
  );
  assert.equal(ign.action, "trusted_creator_licence_required");
  assert.equal(ign.allowed_render_use, "reference_only_until_licensed");

  const xbox = row.required_acquisitions.find(
    (item) => item.source_family === "xbox_official_youtube_forza_horizon_6_launch_trailer",
  );
  assert.equal(xbox.action, "licensed_direct_media_or_operator_supplied_url_required");
  assert.equal(xbox.blocker, "youtube_reference_is_not_download_permission");

  assert.match(row.safe_next_commands[0].command, /media:discover-direct-media/);
  assert.ok(
    row.safe_next_commands.some((item) => item.step === "classify_licensed_direct_media_readiness"),
  );
  assert.match(
    row.safe_next_commands.find((item) => item.step === "resolve_trailer_references").command,
    /studio_v4_licensed_direct_media_acquisition\.json/,
  );
  assert.doesNotMatch(
    row.safe_next_commands.find((item) => item.step === "validate_motion_segments").command,
    /--merge-previous/,
  );
});

test("Studio V4 source deficit counts governed visual plans as operator-required blockers", () => {
  const report = buildStudioV4SourceDeficitReport({
    generatedAt: "2026-05-28T21:05:00.000Z",
    motionPackReports: [
      {
        story_id: "kadokawa-stake",
        title: "Kadokawa Stake Just Passed Sony",
        readiness: {
          status: "v4_motion_blocked",
          blockers: [
            "actual_motion_clip_minimum_not_met",
            "distinct_motion_families_minimum_not_met",
          ],
        },
        clips: [],
        motion_budget: {
          available_motion_clips: 0,
          required_motion_scenes: 5,
          available_distinct_families: 0,
          required_distinct_families: 4,
        },
      },
    ],
    sourceFamilyReport: {
      rows: [
        {
          story_id: "kadokawa-stake",
          source_family_candidates: [],
          governed_visual_plan: {
            story_id: "kadokawa-stake",
            plan_type: "corporate_transaction_owned_explainer_plan",
            operator_approval_required: true,
            render_gate_status: "blocked_until_operator_approved_source_media",
          },
        },
      ],
    },
  });

  assert.equal(report.summary.blocked_stories, 1);
  assert.equal(report.summary.licence_or_operator_required, 1);
  assert.equal(report.rows[0].acquisition_counts.licence_or_operator_required, 1);
  assert.equal(report.rows[0].governed_visual_plan.operator_approval_required, true);
  assert.match(renderStudioV4SourceDeficitMarkdown(report), /Licence\/operator required: 1/);
});

test("Studio V4 source deficit report accepts direct media carried by source-family candidates", () => {
  const report = buildStudioV4SourceDeficitReport({
    motionPackReports: [
      {
        story_id: "1tftq7f",
        title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
        readiness: { status: "v4_motion_blocked", blockers: [] },
        clips: [{ source_family: "steam_2483190_1133501958" }],
        motion_budget: {
          available_motion_clips: 1,
          required_motion_scenes: 7,
          available_distinct_families: 1,
          required_distinct_families: 6,
        },
      },
    ],
    sourceFamilyReport: {
      rows: [
        {
          story_id: "1tftq7f",
          source_family_candidates: [
            {
              source_family: "forza_official_site_forza_horizon_6",
              display_name: "Forza official site - Forza Horizon 6",
              source_tier: "official",
              source_url: "https://cdn.forza.net/forza-horizon-6-keyart.webm",
              source_url_kind: "direct_video",
              source_duration_s: 10,
              status: "ready_for_frame_plan",
            },
          ],
        },
      ],
    },
    directMediaDiscoveryReport: { rows: [] },
  });

  const direct = report.rows[0].required_acquisitions[0];
  assert.equal(direct.action, "intake_direct_media_and_validate_segments");
  assert.equal(direct.direct_media_url, "https://cdn.forza.net/forza-horizon-6-keyart.webm");
  assert.equal(direct.direct_media_url_kind, "direct_video");
  assert.equal(direct.source_duration_s, 10);
});

test("Studio V4 source deficit distinguishes failed direct-media discovery from unchecked sources", () => {
  const report = buildStudioV4SourceDeficitReport({
    motionPackReports: [
      {
        story_id: "direct-failed",
        title: "Forza Horizon 6 needs more motion",
        readiness: { status: "v4_motion_blocked", blockers: [] },
        clips: [{ source_family: "steam_2483190_1133501958" }],
        motion_budget: {
          available_motion_clips: 1,
          required_motion_scenes: 7,
          available_distinct_families: 1,
          required_distinct_families: 6,
        },
      },
    ],
    sourceFamilyReport: {
      rows: [
        {
          story_id: "direct-failed",
          source_family_candidates: [
            {
              source_family: "forza_official_resources",
              display_name: "Forza official resources",
              source_tier: "official",
              source_url_kind: "html_or_unknown_page",
            },
          ],
        },
      ],
    },
    directMediaDiscoveryReport: {
      rows: [
        {
          story_id: "direct-failed",
          source_family: "forza_official_resources",
          status: "no_direct_media_found",
          rejection_reason: "no_validation_eligible_media_url_found",
        },
      ],
    },
  });

  const action = report.rows[0].required_acquisitions[0];
  assert.equal(action.action, "discover_direct_media_or_operator_supplied_url");
  assert.equal(action.direct_media_discovery_status, "no_direct_media_found");
  assert.equal(action.direct_media_discovery_reason, "no_validation_eligible_media_url_found");
});

test("Studio V4 source deficit labels direct-media sources that already failed segment validation", () => {
  const report = buildStudioV4SourceDeficitReport({
    motionPackReports: [
      {
        story_id: "direct-validation-failed",
        title: "Forza Horizon 6 needs more motion",
        readiness: { status: "v4_motion_blocked", blockers: [] },
        clips: [{ source_family: "steam_forza_horizon_6_launch_trailer" }],
        motion_budget: {
          available_motion_clips: 1,
          required_motion_scenes: 7,
          available_distinct_families: 1,
          required_distinct_families: 6,
        },
      },
    ],
    sourceFamilyReport: {
      rows: [
        {
          story_id: "direct-validation-failed",
          source_family_candidates: [
            {
              source_family: "gamesradar_fh6_official_gameplay_teaser",
              display_name: "GamesRadar - FH6 official gameplay teaser",
              source_tier: "official",
              source_url_kind: "html_or_unknown_page",
            },
          ],
        },
      ],
    },
    directMediaDiscoveryReport: {
      rows: [
        {
          story_id: "direct-validation-failed",
          source_family: "gamesradar_fh6_official_gameplay_teaser",
          status: "direct_media_found",
          direct_media_url: "https://cdn.example.test/forza-teaser.mp4",
          source_url_kind: "direct_video",
          source_duration_s: 12.35,
        },
      ],
    },
    segmentValidationReport: {
      segments: [
        {
          story_id: "direct-validation-failed",
          source_family: "gamesradar_fh6_official_gameplay_teaser",
          status: "rejected",
          segment_validated: false,
          action_score: 53,
          validation_reason: "segment_lacks_gameplay_action_samples",
        },
        {
          story_id: "direct-validation-failed",
          source_family: "gamesradar_fh6_official_gameplay_teaser",
          status: "rejected",
          segment_validated: false,
          action_score: 32,
          validation_reason: "segment_starts_in_trailer_intro_or_rating_window",
        },
      ],
    },
  });

  const action = report.rows[0].required_acquisitions[0];
  assert.equal(action.action, "intake_direct_media_and_validate_segments");
  assert.equal(action.segment_validation_status, "validation_failed");
  assert.equal(action.segment_validation_rejection_reason, "segment_lacks_gameplay_action_samples");
  assert.equal(action.segment_validation_best_action_score, 53);
  assert.equal(action.segment_validation_rejected_segments, 2);
});

test("Studio V4 source deficit does not count accepted current families as missing acquisitions", () => {
  const report = buildStudioV4SourceDeficitReport({
    motionPackReports: [
      {
        story_id: "current-family-refresh",
        title: "Forza Horizon 6 needs more motion",
        readiness: { status: "v4_motion_blocked", blockers: [] },
        clips: [
          {
            source_family: "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
            validated: true,
            segmentValidationPassed: true,
          },
        ],
        motion_budget: {
          available_motion_clips: 1,
          required_motion_scenes: 7,
          available_distinct_families: 1,
          required_distinct_families: 6,
        },
      },
    ],
    sourceFamilyReport: {
      rows: [
        {
          story_id: "current-family-refresh",
          source_family_candidates: [
            {
              source_family: "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
              display_name: "GameFront - Xbox Game Studios FH6 Initial Drive Gameplay",
              source_tier: "official",
              source_url_kind: "html_or_unknown_page",
              status: "needs_direct_media_url",
            },
            {
              source_family: "gamesradar_fh6_official_gameplay_teaser",
              display_name: "GamesRadar - FH6 official gameplay teaser",
              source_tier: "official",
              source_url_kind: "html_or_unknown_page",
              status: "needs_direct_media_url",
            },
          ],
        },
      ],
    },
    directMediaDiscoveryReport: {
      rows: [
        {
          story_id: "current-family-refresh",
          source_family: "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
          status: "direct_media_found",
          direct_media_url: "https://osiris.gamefront.test/forza.mp4?expires=soon",
          source_url_kind: "direct_video",
        },
        {
          story_id: "current-family-refresh",
          source_family: "gamesradar_fh6_official_gameplay_teaser",
          status: "direct_media_found",
          direct_media_url: "https://cdn.example.test/forza-teaser.mp4",
          source_url_kind: "direct_video",
        },
      ],
    },
  });

  const row = report.rows[0];
  assert.equal(row.required_acquisitions.length, 1);
  assert.equal(row.required_acquisitions[0].source_family, "gamesradar_fh6_official_gameplay_teaser");
  assert.equal(row.current_family_refreshes.length, 1);
  assert.equal(
    row.current_family_refreshes[0].source_family,
    "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
  );
  assert.equal(row.acquisition_counts.direct_media_ready, 1);
  assert.equal(row.acquisition_counts.current_family_refreshes, 1);
});

test("Studio V4 source deficit report lets ready packs render V4", () => {
  const report = buildStudioV4SourceDeficitReport({
    motionPackReports: [
      {
        story_id: "ready-story",
        title: "Ready Story",
        readiness: { status: "v4_motion_ready", blockers: [] },
        clips: [
          { source_family: "a" },
          { source_family: "b" },
          { source_family: "c" },
          { source_family: "d" },
          { source_family: "e" },
          { source_family: "f" },
          { source_family: "g" },
        ],
        motion_budget: {
          available_motion_clips: 7,
          required_motion_scenes: 7,
          available_distinct_families: 7,
          required_distinct_families: 6,
        },
      },
    ],
  });

  assert.equal(report.summary.v4_ready_stories, 1);
  assert.equal(report.summary.blocked_stories, 0);
  assert.equal(report.rows[0].render_decision, "render_visual_v4");
  assert.deepEqual(report.rows[0].required_acquisitions, []);
});

test("Studio V4 source deficit markdown and CLI are registered as local-only", async () => {
  const markdown = renderStudioV4SourceDeficitMarkdown({
    generated_at: "2026-05-19T22:30:00.000Z",
    summary: {
      blocked_stories: 1,
      v4_ready_stories: 0,
      direct_media_ready: 1,
      licence_or_operator_required: 2,
    },
    rows: [
      {
        story_id: "1tftq7f",
        title: "Forza Horizon 6",
        render_decision: "hold_v4_source_acquisition_required",
        missing_motion_families: 5,
        missing_motion_clips: 6,
        required_acquisitions: [
          {
            source_family: "forza_official_site_forza_horizon_6",
            action: "intake_direct_media_and_validate_segments",
            priority: "urgent",
          },
        ],
      },
    ],
  });
  const toolSource = await fs.readFile(
    path.join(__dirname, "..", "..", "tools", "studio-v4-source-deficit.js"),
    "utf8",
  );

  assert.equal(
    packageJson.scripts["ops:v4-source-deficit"],
    "node tools/studio-v4-source-deficit.js",
  );
  assert.match(markdown, /Visual V4 Source Deficit/);
  assert.match(markdown, /No downloads, DB mutation, OAuth or posting/);
  assert.match(toolSource, /video_downloads_started:\s*false/);
  assert.doesNotMatch(toolSource, /upload|publishToAllPlatforms|yt-dlp/);
});

test("Studio V4 source deficit CLI scopes aggregate reports to source-family report stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-source-deficit-cli-"));
  const motionPackDir = path.join(root, "motion-packs");
  await fs.mkdir(motionPackDir, { recursive: true });
  const targetPackPath = path.join(motionPackDir, "target-story_motion_pack_manifest.json");
  const unrelatedPackPath = path.join(motionPackDir, "unrelated-story_motion_pack_manifest.json");
  await fs.writeFile(targetPackPath, JSON.stringify({
    story_id: "target-story",
    title: "Target Story Needs Motion",
    readiness: { status: "v4_motion_blocked", blockers: ["actual_motion_clip_minimum_not_met"] },
    clips: [],
    motion_budget: {
      available_motion_clips: 0,
      required_motion_scenes: 5,
      available_distinct_families: 0,
      required_distinct_families: 4,
    },
  }));
  await fs.writeFile(unrelatedPackPath, JSON.stringify({
    story_id: "unrelated-story",
    title: "Unrelated Story",
    readiness: { status: "v4_motion_blocked", blockers: ["actual_motion_clip_minimum_not_met"] },
    clips: [],
    motion_budget: {
      available_motion_clips: 0,
      required_motion_scenes: 5,
      available_distinct_families: 0,
      required_distinct_families: 4,
    },
  }));
  const indexPath = path.join(root, "visual_v4_motion_packs.json");
  await fs.writeFile(indexPath, JSON.stringify({
    packs: [
      { story_id: "unrelated-story", manifest_path: unrelatedPackPath },
      { story_id: "target-story", manifest_path: targetPackPath },
    ],
  }));
  const sourceFamilyReportPath = path.join(root, "source_family.json");
  await fs.writeFile(sourceFamilyReportPath, JSON.stringify({
    rows: [
      {
        story_id: "target-story",
        source_family_candidates: [
          {
            source_family: "official_target_video",
            source_tier: "official",
            source_url: "https://cdn.example.test/target.mp4",
            source_url_kind: "direct_video",
          },
        ],
      },
    ],
  }));
  const outputJson = path.join(root, "out", "source_deficit.json");
  const outputMd = path.join(root, "out", "source_deficit.md");

  await runSourceDeficitCli([
    "--motion-pack-index",
    indexPath,
    "--source-family-report",
    sourceFamilyReportPath,
    "--direct-media-report",
    path.join(root, "missing-direct-media.json"),
    "--segment-validation-report",
    path.join(root, "missing-segments.json"),
    "--output-json",
    outputJson,
    "--output-md",
    outputMd,
    "--json",
  ]);

  const report = JSON.parse(await fs.readFile(outputJson, "utf8"));
  assert.deepEqual(report.rows.map((row) => row.story_id), ["target-story"]);
  assert.equal(report.summary.stories, 1);
  assert.equal(report.summary.direct_media_ready, 1);
});
