"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");

const {
  buildTrustedFootageOfficialIntakeEntries,
  buildTrustedFootageRegistryReport,
  renderTrustedFootageRegistryMarkdown,
  trustedFootageReferencesForStory,
} = require("../../lib/trusted-footage-registry");
const { parseArgs } = require("../../tools/trusted-footage-registry");
const packageJson = require("../../package.json");

const GENERATED_AT = "2026-05-17T12:00:00.000Z";

function story(overrides = {}) {
  return {
    id: "forza_steam_peak",
    title: "Forza Horizon 6 just hit 130,000 players on Steam",
    full_script:
      "Forza Horizon 6 is pulling a huge Steam number. It has crossed 130,000 concurrent players and Xbox fans are watching closely.",
    source_type: "rss",
    subreddit: "GamesRadar",
    flair: "Verified",
    score: 800,
    timestamp: GENERATED_AT,
    ...overrides,
  };
}

function officialSource(overrides = {}) {
  return {
    source_id: "xbox-official-youtube",
    display_name: "Xbox official YouTube",
    owner_type: "platform",
    platform: "youtube",
    channel_url: "https://www.youtube.com/@Xbox",
    canonical_url: "https://www.youtube.com/@Xbox",
    source_family: "xbox_official_youtube",
    entities: ["Forza Horizon 6", "Xbox"],
    allowed_uses: ["reference_only"],
    official_evidence: "Official Xbox channel operated by the platform owner.",
    ...overrides,
  };
}

function licensedCreator(overrides = {}) {
  return {
    source_id: "creator-a-licensed",
    display_name: "Creator A licensed gameplay archive",
    owner_type: "licensed_creator",
    platform: "youtube",
    channel_url: "https://www.youtube.com/@CreatorA",
    canonical_url: "https://www.youtube.com/@CreatorA",
    source_family: "creator_a_licensed",
    entities: ["Forza Horizon 6"],
    allowed_uses: ["shorts_clips", "transformative_edit"],
    licence_evidence: "Signed creator clip licence allows edited vertical Shorts for Pulse Gaming.",
    licence_scope: "Edited vertical social clips for Pulse Gaming channels.",
    licence_expires_at: "2027-01-01T00:00:00.000Z",
    autonomous_use_approved: true,
    ...overrides,
  };
}

test("trusted footage registry plans official sources autonomously without downloads or cloud transcript dependencies", () => {
  const report = buildTrustedFootageRegistryReport({
    stories: [story()],
    entries: [officialSource()],
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.execution_mode, "autonomous_report_only");
  assert.equal(report.will_download, false);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.autonomy.enabled, true);
  assert.equal(report.autonomy.requires_human_confirmation, false);
  assert.equal(report.safety.elevenlabs_required, false);
  assert.equal(report.safety.video_downloads, false);
  assert.equal(report.safety.yt_dlp, false);
  assert.equal(report.safety.posted_to_platforms, false);

  const accepted = report.accepted_sources[0];
  assert.equal(accepted.source_tier, "official");
  assert.equal(accepted.allowed_render_use, "reference_only_by_default");
  assert.equal(accepted.rights_risk_class, "official_reference_only");
  assert.equal(accepted.downloads_allowed, false);
  assert.equal(accepted.autonomous_motion_candidate, true);
  assert.equal(accepted.video_use_style_plan.local_transcript_provider, "local_asr_or_existing_alignment");
  assert.deepEqual(accepted.video_use_style_plan.required_artifacts, [
    "local_transcript_pack",
    "timeline_contact_sheet",
    "motion_edl",
    "cut_boundary_self_eval",
  ]);

  assert.equal(report.story_candidates.length, 1);
  assert.equal(report.story_candidates[0].story_id, "forza_steam_peak");
  assert.equal(report.story_candidates[0].entity, "Forza Horizon 6");
  assert.equal(report.story_candidates[0].source_id, "xbox-official-youtube");
});

test("trusted footage registry accepts official storefront direct trailer references as segment candidates", () => {
  const report = buildTrustedFootageRegistryReport({
    stories: [story()],
    entries: [
      officialSource({
        source_id: "steam-forza-horizon-6-launch-trailer",
        display_name: "Steam - Forza Horizon 6 launch trailer",
        owner_type: "storefront",
        platform: "steam",
        channel_url: "https://store.steampowered.com/app/2483190/Forza_Horizon_6/",
        canonical_url: "https://store.steampowered.com/app/2483190/Forza_Horizon_6/",
        direct_media_url_if_available:
          "https://video.fastly.steamstatic.com/store_trailers/2483190/1133501958/842a46e433376224f42832ce35c55f1f85bbe440/1778255437/microtrailer.mp4",
        source_family: "steam_forza_horizon_6_launch_trailer",
      }),
    ],
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.story_candidates.length, 1);
  assert.equal(report.story_candidates[0].source_url_kind, "direct_video");
  assert.equal(report.story_candidates[0].segment_validation_eligible, true);
  assert.equal(
    report.accepted_sources[0].reference_url,
    "https://store.steampowered.com/app/2483190/Forza_Horizon_6/",
  );
  assert.equal(
    report.accepted_sources[0].segment_source_url,
    "https://video.fastly.steamstatic.com/store_trailers/2483190/1133501958/842a46e433376224f42832ce35c55f1f85bbe440/1778255437/microtrailer.mp4",
  );

  const intakeEntries = buildTrustedFootageOfficialIntakeEntries({
    report,
    storyId: "forza_steam_peak",
  });
  assert.equal(intakeEntries[0].source_type, "steam_storefront_video_reference");
  assert.equal(
    intakeEntries[0].official_source_url,
    "https://store.steampowered.com/app/2483190/Forza_Horizon_6/",
  );
  assert.equal(
    intakeEntries[0].direct_media_url_if_available,
    "https://video.fastly.steamstatic.com/store_trailers/2483190/1133501958/842a46e433376224f42832ce35c55f1f85bbe440/1778255437/microtrailer.mp4",
  );
});

test("trusted footage config covers current blocked game stories with official storefront motion", async () => {
  const registry = await fs.readJson(path.join(process.cwd(), "config", "trusted-footage-registry.json"));
  const entries = registry.entries || [];
  const stories = [
    story({
      id: "1s4denn",
      title: "The Expanse Shows Real Gameplay",
      canonical_game: "The Expanse: Osiris Reborn",
      full_script: "The Expanse: Osiris Reborn shows real gameplay in its official trailer.",
    }),
    story({
      id: "1s49ty7",
      title: "Star Wars Zero Company Is More Than XCOM",
      canonical_game: "STAR WARS Zero Company",
      full_script: "Star Wars Zero Company is the official turn-based tactics game from Bit Reactor and Respawn.",
    }),
    story({
      id: "1s4j81q",
      title: "Deus Ex Composer Says The Jobs Vanished",
      canonical_game: "Deus Ex Remastered",
      full_script: "Deus Ex Remastered is the source-safe visual context for this Deus Ex jobs story.",
    }),
    story({
      id: "1s3pige",
      title: "Pragmata's AI-Look Stage Was Handmade",
      canonical_game: "PRAGMATA",
      full_script: "PRAGMATA uses Capcom's official trailer footage as the story's game visual context.",
    }),
  ];

  const report = buildTrustedFootageRegistryReport({
    stories,
    entries,
    generatedAt: GENERATED_AT,
  });
  const candidatesByStory = new Map();
  for (const candidate of report.story_candidates) {
    if (!candidatesByStory.has(candidate.story_id)) candidatesByStory.set(candidate.story_id, []);
    candidatesByStory.get(candidate.story_id).push(candidate);
  }

  for (const storyRow of stories) {
    const candidates = candidatesByStory.get(storyRow.id) || [];
    assert.ok(candidates.length > 0, `${storyRow.id} should have an official storefront motion candidate`);
    assert.ok(
      candidates.some((candidate) => candidate.segment_validation_eligible === true),
      `${storyRow.id} should have a validation-eligible direct media candidate`,
    );
    assert.ok(
      candidates.some((candidate) => candidate.source_url_kind === "hls_manifest"),
      `${storyRow.id} should use an official Steam HLS trailer manifest`,
    );
  }
});

test("trusted footage registry keeps official social video as official-social intake", () => {
  const report = buildTrustedFootageRegistryReport({
    stories: [story()],
    entries: [
      officialSource({
        source_id: "forza-horizon-official-x-lowlands",
        display_name: "Forza Horizon official X - FH6 Lowlands video",
        owner_type: "official_channel",
        platform: "x",
        source_type: "official_social_media_video",
        channel_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
        canonical_url: "https://x.com/ForzaHorizon/status/2021227288788947178",
        direct_media_url_if_available:
          "https://video-s.twimg.com/amplify_video/2021227162603339776/vid/avc1/1280x720/IbJGc42nnQTptud_.mp4?tag=14",
        source_duration_s: 27.71,
        source_family: "forza_horizon_official_x_fh6_lowlands_video",
        official_evidence:
          "Official verified @ForzaHorizon X post with direct media hosted on video-s.twimg.com.",
      }),
    ],
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.rejected, 0);
  assert.equal(report.story_candidates[0].source_url_kind, "direct_video");
  assert.equal(report.story_candidates[0].segment_validation_eligible, true);
  assert.equal(report.accepted_sources[0].source_duration_s, 27.71);
  assert.equal(report.story_candidates[0].source_duration_s, 27.71);

  const intakeEntries = buildTrustedFootageOfficialIntakeEntries({
    report,
    storyId: "forza_steam_peak",
  });
  assert.equal(intakeEntries[0].source_type, "official_social_media_video");
  assert.equal(intakeEntries[0].source_duration_s, 27.71);
  assert.equal(
    intakeEntries[0].official_source_url,
    "https://x.com/ForzaHorizon/status/2021227288788947178",
  );
  assert.equal(
    intakeEntries[0].direct_media_url_if_available,
    "https://video-s.twimg.com/amplify_video/2021227162603339776/vid/avc1/1280x720/IbJGc42nnQTptud_.mp4?tag=14",
  );
  assert.equal(intakeEntries[0].downloads_allowed, false);

  const references = trustedFootageReferencesForStory(report, story());
  assert.equal(references[0].source_type, "official_social_media_video");
  assert.equal(references[0].source_duration_s, 27.71);
  assert.equal(references[0].provenance.source_duration_s, 27.71);
});

test("trusted footage registry allows licensed creator clips only when autonomous licence scope is explicit", () => {
  const report = buildTrustedFootageRegistryReport({
    stories: [story()],
    entries: [licensedCreator()],
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.accepted, 1);
  const accepted = report.accepted_sources[0];
  assert.equal(accepted.source_tier, "licensed_creator");
  assert.equal(accepted.allowed_render_use, "licensed_short_clip_candidate");
  assert.equal(accepted.rights_risk_class, "licensed_creator_clip");
  assert.equal(accepted.autonomous_motion_candidate, true);
  assert.equal(accepted.download_policy, "approved_registry_source_only");
  assert.equal(accepted.downloads_allowed, false);
  assert.equal(accepted.video_use_style_plan.requires_human_confirmation, false);
});

test("trusted footage registry rejects random YouTube, reposts and creator clip sources without licence evidence", () => {
  const report = buildTrustedFootageRegistryReport({
    stories: [story()],
    entries: [
      officialSource({
        source_id: "fan-upload",
        display_name: "Fan upload",
        owner_type: "fan_reupload",
        source_type: "random_youtube_reupload",
        channel_url: "https://www.youtube.com/watch?v=fanmirror",
        official_evidence: "",
      }),
      licensedCreator({
        source_id: "creator-no-licence",
        licence_evidence: "",
        licence_scope: "",
      }),
      licensedCreator({
        source_id: "creator-no-shorts-scope",
        allowed_uses: ["reference_only"],
        licence_scope: "",
      }),
    ],
    generatedAt: GENERATED_AT,
  });

  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.rejected, 3);
  assert.ok(report.rejected_sources.some((entry) => entry.reasons.includes("social_or_repost_source_forbidden")));
  assert.ok(report.rejected_sources.some((entry) => entry.reasons.includes("licence_evidence_required_for_creator_clip_use")));
  assert.ok(report.rejected_sources.some((entry) => entry.reasons.includes("shorts_clip_scope_required_for_creator_clip_use")));
});

test("trusted footage registry emits official intake entries for matched story entities", () => {
  const report = buildTrustedFootageRegistryReport({
    stories: [story()],
    entries: [officialSource(), licensedCreator()],
    generatedAt: GENERATED_AT,
  });

  const intakeEntries = buildTrustedFootageOfficialIntakeEntries({
    report,
    storyId: "forza_steam_peak",
  });

  assert.equal(intakeEntries.length, 2);
  assert.deepEqual(
    intakeEntries.map((entry) => entry.source_type).sort(),
    ["licensed_creator_channel_reference", "official_youtube_channel_url"],
  );
  assert.ok(intakeEntries.every((entry) => entry.story_id === "forza_steam_peak"));
  assert.ok(intakeEntries.every((entry) => entry.entity === "Forza Horizon 6"));
  assert.ok(intakeEntries.every((entry) => entry.downloads_allowed === false));
  assert.match(intakeEntries[0].evidence_of_officialness, /trusted footage registry/i);
});

test("trusted footage registry does not export trusted creator references as official YouTube", () => {
  const trustedCreator = officialSource({
    source_id: "ign-first-forza",
    display_name: "IGN First - Forza Horizon 6 gameplay",
    owner_type: "trusted_creator",
    platform: "youtube",
    channel_url: "https://www.youtube.com/watch?v=ZCU-woy4BPo",
    canonical_url: "https://www.youtube.com/watch?v=ZCU-woy4BPo",
    source_family: "ign_first_forza_horizon_6_gameplay",
    official_evidence: "Trusted editorial gameplay reference, not first-party footage.",
  });
  const forzaStory = story();
  const report = buildTrustedFootageRegistryReport({
    stories: [forzaStory],
    entries: [trustedCreator],
    generatedAt: GENERATED_AT,
  });

  const intakeEntries = buildTrustedFootageOfficialIntakeEntries({
    report,
    storyId: "forza_steam_peak",
  });
  const references = trustedFootageReferencesForStory(report, forzaStory);

  assert.equal(report.summary.trusted_creator_reference_sources, 1);
  assert.equal(intakeEntries[0].source_type, "trusted_creator_channel_reference");
  assert.equal(references[0].source_type, "trusted_creator_channel_reference");
  assert.equal(references[0].source_tier, "trusted_creator_reference");
});

test("trusted footage registry accepts publisher media repositories with evidence", () => {
  const report = buildTrustedFootageRegistryReport({
    entries: [
      officialSource({
        source_id: "gamefront-xgs-forza",
        display_name: "GameFront - Xbox Game Studios FH6 gameplay",
        owner_type: "publisher_media_repository",
        platform: "website",
        source_type: "publisher_media_repository_video_reference",
        channel_url:
          "https://www.gamefront.com/videos/forza-horizon-6/forza-horizon-6-official-initial-drive-gameplay",
        source_family: "gamefront_xbox_game_studios_fh6_initial_drive_gameplay",
        official_evidence:
          "GameFront video page labels the creator as Xbox Game Studios and exposes a direct MP4 asset page.",
      }),
    ],
    stories: [story()],
  });

  assert.equal(report.rejected_sources.length, 0);
  assert.equal(report.accepted_sources[0].source_tier, "official");
  assert.equal(report.accepted_sources[0].download_policy, "reference_only_no_download");
  assert.equal(report.story_candidates[0].source_family, "gamefront_xbox_game_studios_fh6_initial_drive_gameplay");
  assert.equal(report.story_candidates[0].source_type, "publisher_media_repository_video_reference");

  const intakeEntries = buildTrustedFootageOfficialIntakeEntries({
    report,
    storyId: "forza_steam_peak",
  });
  assert.equal(intakeEntries[0].source_type, "publisher_media_repository_video_reference");
  assert.equal(intakeEntries[0].official_source_url, report.accepted_sources[0].reference_url);
});

test("trusted footage registry rejects publisher media repositories without evidence", () => {
  const report = buildTrustedFootageRegistryReport({
    entries: [
      officialSource({
        source_id: "media-repo-no-evidence",
        owner_type: "publisher_media_repository",
        platform: "website",
        source_type: "publisher_media_repository_video_reference",
        channel_url: "https://example.com/videos/forza-horizon-6.mp4",
        source_family: "media_repo_no_evidence",
        official_evidence: "",
      }),
    ],
    stories: [story()],
  });

  assert.equal(report.accepted_sources.length, 0);
  assert.equal(report.rejected_sources[0].reasons[0], "publisher_media_repository_evidence_required");
});

test("trusted footage registry does not match comparison entities as footage sources", () => {
  const report = buildTrustedFootageRegistryReport({
    stories: [
      story({
        title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
        hook: "Forza Horizon 6 just hit 92 on Metacritic, beating out Pokemon Pokopia.",
        body:
          "The game is ahead of Pokemon Pokopia, with a PlayStation 5 release planned later this year.",
        suggested_thumbnail_text: "Forza Horizon 6 Metacritic 92",
      }),
    ],
    entries: [
      officialSource({
        source_id: "forza-official",
        display_name: "Forza official gameplay",
        source_family: "forza_official_gameplay",
        entities: ["Forza Horizon 6", "Forza"],
      }),
      officialSource({
        source_id: "nintendo-official",
        display_name: "Nintendo official YouTube",
        source_family: "nintendo_official_youtube",
        entities: ["Nintendo", "Pokemon"],
      }),
      officialSource({
        source_id: "playstation-official",
        display_name: "PlayStation official YouTube",
        source_family: "playstation_official_youtube",
        entities: ["PlayStation", "PS5"],
      }),
    ],
    generatedAt: GENERATED_AT,
  });

  assert.deepEqual(
    report.story_candidates.map((candidate) => candidate.source_id),
    ["forza-official"],
  );
});

test("trusted footage registry Markdown and CLI stay local-first and autonomous", () => {
  const report = buildTrustedFootageRegistryReport({
    stories: [story()],
    entries: [officialSource()],
    generatedAt: GENERATED_AT,
  });
  const markdown = renderTrustedFootageRegistryMarkdown(report);

  assert.match(markdown, /Trusted Footage Registry/);
  assert.match(markdown, /Autonomous mode: enabled/);
  assert.match(markdown, /local transcript pack/);
  assert.doesNotMatch(markdown, /ElevenLabs|Scribe/i);

  const args = parseArgs([
    "node",
    "tools/trusted-footage-registry.js",
    "--registry",
    "config/trusted-footage-registry.json",
    "--story-id",
    "forza_steam_peak",
    "--json",
  ]);

  assert.equal(args.registry, "config/trusted-footage-registry.json");
  assert.equal(args.storyId, "forza_steam_peak");
  assert.equal(args.json, true);
  assert.match(packageJson.scripts["media:trusted-footage"], /trusted-footage-registry\.js/);
});
