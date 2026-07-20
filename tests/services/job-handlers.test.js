"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleGuardedLiveDispatchPublish,
  buildFreshRefillDirectMediaDiscoveryInput,
  buildFreshRefillOfficialSourceEvidence,
  buildFreshRefillRepairPackageFilter,
  buildFreshRefillScriptRewriteWorkOrder,
  freshRefillAudioTimestampMaterializerTimeoutMs,
  freshRefillHyperframesStoryIdsAfterMotion,
  freshRefillHyperframesCardTimeoutMs,
  freshRefillMaterializedAudioStoryIdsFromReport,
  freshRefillNarrationProviderPreference,
  freshRefillOfficialYoutubeMotionRows,
  freshRefillOfficialYoutubeMotionChildArgs,
  freshRefillPlatformVariantChildArgs,
  guardedPublishFailureMessage,
  guardedPublishResultShouldFailJob,
  readGuardedLiveExecutorPlanForScheduler,
  renderGuardedLiveDispatchSummary,
} = require("../../lib/job-handlers");

const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

test("guarded publish result fails the job when a window has no upload", () => {
  assert.equal(
    guardedPublishResultShouldFailJob({
      guarded_live_dispatch: true,
      status: "green",
      action_id: "story-1:youtube_shorts",
      outcome: "new_upload",
      upload_attempt_count: 0,
    }),
    true,
  );
});

test("guarded publish result fails the job for red or blocked windows", () => {
  for (const status of ["red", "failed", "blocked"]) {
    assert.equal(
      guardedPublishResultShouldFailJob({
        guarded_live_dispatch: true,
        status,
        action_id: `story-1:${status}`,
        upload_attempt_count: 1,
      }),
      true,
      status,
    );
  }
});

test("guarded publish result allows successful upload windows", () => {
  assert.equal(
    guardedPublishResultShouldFailJob({
      guarded_live_dispatch: true,
      status: "green",
      action_id: "story-1:youtube_shorts",
      outcome: "new_upload",
      upload_attempt_count: 1,
    }),
    false,
  );
});

test("guarded publish failure message includes the action and reason", () => {
  assert.equal(
    guardedPublishFailureMessage({
      guarded_live_dispatch: true,
      status: "red",
      action_id: "story-1:instagram_reels",
      outcome: "failed",
    }),
    "guarded_publish_window_failed:story-1:instagram_reels:failed",
  );
});

test("guarded publish failure message includes a safe platform error detail", () => {
  const message = guardedPublishFailureMessage({
    guarded_live_dispatch: true,
    status: "red",
    action_id: "story-1:youtube_shorts",
    outcome: "failed",
    error: "YouTube upload failed: access_token=abc123 and quota exceeded",
  });

  assert.match(message, /^guarded_publish_window_failed:story-1:youtube_shorts:failed:/);
  assert.match(message, /youtube_upload_failed/);
  assert.match(message, /access_token_redacted/);
  assert.doesNotMatch(message, /abc123/);
});

test("guarded Discord summary separates upload attempts from successes and includes safe Meta diagnostics", () => {
  const summary = renderGuardedLiveDispatchSummary({
    verdict: "RED",
    summary: {
      upload_attempt_count: 1,
      upload_success_count: 0,
      network_attempt_count: 1,
      db_mutation_count: 1,
    },
    actions: [
      {
        action_id: "story-1:facebook_reels",
        outcome: "failed",
        error: "Facebook Graph reel_binary_upload failed: HTTP 400 code=352 access_token=secret-token",
      },
    ],
  }, {
    jobId: 123,
    actionId: "story-1:facebook_reels",
  });

  assert.match(summary.message, /Attempts:\s+1/);
  assert.match(summary.message, /Uploads:\s+0/);
  assert.match(summary.message, /Network:\s+1/);
  assert.match(summary.message, /Error:\s+Facebook Graph reel_binary_upload failed: HTTP 400 code=352/);
  assert.doesNotMatch(summary.message, /secret-token/);
  assert.match(summary.message, /access_token=<redacted>/);
});

test("fresh refill narration provider stays local unless ElevenLabs is explicitly enabled", () => {
  assert.equal(freshRefillNarrationProviderPreference({ payload: {}, env: {} }), "local");
  assert.equal(
    freshRefillNarrationProviderPreference({
      payload: { tts_provider_preference: "elevenlabs" },
      env: {},
    }),
    "elevenlabs",
  );
  assert.equal(
    freshRefillNarrationProviderPreference({
      payload: {},
      env: { PULSE_FRESH_REFILL_ALLOW_ELEVENLABS_TTS: "true" },
    }),
    "elevenlabs",
  );
});

test("fresh refill prepares platform-native delivery variants before scheduler preflight", () => {
  assert.deepEqual(
    freshRefillPlatformVariantChildArgs({
      storyPackagesPath: "output/refill/story-packages.json",
      outputDir: "output/refill/continuation",
    }),
    [
      "tools/goal-platform-variant-materializer.js",
      "--story-packages",
      "output/refill/story-packages.json",
      "--out-dir",
      "output/refill/continuation",
      "--json",
    ],
  );
});

test("fresh refill audio materialization report does not fallback after failed jobs", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-audio-failed-"));
  const reportPath = path.join(tmp, "audio_timestamp_materialization_report.json");
  await fs.writeJson(reportPath, {
    summary: { candidate_count: 1, materialized_count: 0, failed_count: 1 },
    jobs: [
      {
        story_id: "rss_black_flag",
        status: "failed",
        error: "local_whisper_word_alignment_failed:whisper_inserted_asr_words_above_threshold",
      },
    ],
  }, { spaces: 2 });

  const ids = await freshRefillMaterializedAudioStoryIdsFromReport({
    reportPath,
    candidateStoryIds: ["rss_black_flag"],
    fallbackStoryIds: ["rss_black_flag"],
  });

  assert.deepEqual(ids, []);
});

test("fresh refill script work orders attach official source claims before rewriting", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-source-first-"));
  const artifactDir = path.join(tmp, "rss_starward");
  const outputDir = path.join(tmp, "repair");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_starward",
    canonical_title: "Starward Patch Check",
    narration_script: "Starward just got a boring-looking system update.",
    source_published_at: "2026-07-09T20:00:00.000Z",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "source_manifest.json"), {
    primary_source: {
      name: "Xbox Wire",
      url: "https://news.xbox.com/en-us/2026/07/09/meet-the-star-operator-1/",
      type: "official_platform_news",
      published_at: "2026-07-09T20:00:00.000Z",
    },
  }, { spaces: 2 });

  const result = await buildFreshRefillScriptRewriteWorkOrder({
    quarantinedRows: [{
      story_id: "rss_starward",
      artifact_dir: artifactDir,
      title: "Starward Patch Check",
      reasons: ["script_rewrite_required"],
    }],
    outputDir,
    sourceEvidenceFetcher: async () => ({
      status: "pass",
      source_url: "https://news.xbox.com/en-us/2026/07/09/meet-the-star-operator-1/",
      headline: "Meet the Star Operator Who Rewrites the Ranged Rulebook in Starward V3.1",
      source_text: "Starward Version 3.1 adds Pliszka. Her Wing Rider Assembly increases firepower and mobility but also increases her hitbox and descent speed. Players can detach it mid-battle for a more agile style.",
      source_text_sha256: "a".repeat(64),
      claims: [{
        text: "Her Wing Rider Assembly increases firepower and mobility but also increases her hitbox and descent speed.",
        source_url: "https://news.xbox.com/en-us/2026/07/09/meet-the-star-operator-1/",
        evidence_text: "Her Wing Rider Assembly increases firepower and mobility but also increases her hitbox and descent speed.",
        origin: "source_body",
      }],
      confirmed_event_window: null,
    }),
  });
  const workOrder = await fs.readJson(result.workOrderPath);

  assert.equal(workOrder.jobs.length, 1);
  assert.equal(workOrder.jobs[0].source.title, "Meet the Star Operator Who Rewrites the Ranged Rulebook in Starward V3.1");
  assert.match(workOrder.jobs[0].source.body, /Pliszka/);
  assert.equal(workOrder.jobs[0].source_evidence.claims[0].origin, "source_body");
  assert.equal(workOrder.jobs[0].source_evidence.source_text_sha256, "a".repeat(64));
});

test("fresh refill routes title-only fatigue into a hash-bound title repair before render repair", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-title-fatigue-"));
  const artifactDir = path.join(tmp, "rss_arknights");
  const outputDir = path.join(tmp, "repair");
  const storyPackagesPath = path.join(tmp, "story-packages.json");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_arknights",
    selected_title: "Arknights: Endfield's PS5 Pro Upgrade Has A Real Test",
    canonical_subject: "Arknights: Endfield",
    narration_script:
      "Arknights: Endfield just gave PS5 Pro owners a before-and-after test. Follow Pulse Gaming so you never miss a beat.",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "source_manifest.json"), {
    primary_source: {
      name: "PlayStation Blog",
      url: "https://blog.playstation.com/arknights-endfield-ps5-pro/",
      type: "official_platform_news",
      published_at: "2026-07-15T17:00:37.000Z",
    },
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    blockers: [],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    verdict: "RED",
    hard_failures: ["media_house:shorts_feed_competition_weak"],
    shorts_feed_competition_report: {
      status: "blocked",
      blockers: ["feed_title_template_fatigue"],
    },
  }, { spaces: 2 });
  await fs.writeJson(storyPackagesPath, [{
    story_id: "rss_arknights",
    artifact_dir: artifactDir,
    blockers: ["media_house:shorts_feed_competition_weak"],
  }], { spaces: 2 });

  const filtered = await buildFreshRefillRepairPackageFilter({
    storyPackagesPath,
    outputDir,
  });
  const rewrite = await buildFreshRefillScriptRewriteWorkOrder({
    quarantinedRows: filtered.quarantinedRows,
    outputDir,
  });
  const workOrder = await fs.readJson(rewrite.workOrderPath);

  assert.equal(filtered.eligibleRows.length, 0);
  assert.equal(filtered.quarantinedRows.length, 1);
  assert.deepEqual(filtered.quarantinedRows[0].reasons, ["feed_title_template_fatigue"]);
  assert.equal(workOrder.jobs.length, 1);
  assert.deepEqual(workOrder.jobs[0].reasons, ["feed_title_template_fatigue"]);
  assert.equal(workOrder.jobs[0].repair_lane, "source_bound_title_repair");
  assert.equal(workOrder.jobs[0].preserve_current_script, true);
  assert.equal(workOrder.jobs[0].current_script, [
    "Arknights: Endfield just gave PS5 Pro owners a before-and-after test.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" "));
  assert.match(workOrder.jobs[0].current_script_sha256, /^[a-f0-9]{64}$/);
  assert.ok(
    workOrder.jobs[0].candidate_titles.includes(
      "Arknights: Endfield's PS5 Pro Upgrade Has A Real Test",
    ),
  );
});

test("fresh refill source evidence preserves official YouTube watch references as reference-only sources", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-youtube-"));
  const artifactDir = path.join(tmp, "seed_capcom_spotlight_pressure_20260625");
  const outputDir = path.join(tmp, "repair");
  const storyPackagesPath = path.join(tmp, "story-packages.json");

  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "seed_capcom_spotlight_pressure_20260625",
    selected_title: "Capcom Spotlight Has To Prove These Games Are More Than Names",
    canonical_title: "Capcom Spotlight Has To Prove These Games Are More Than Names",
    canonical_subject: "Capcom Spotlight",
    canonical_game: "Capcom Spotlight",
    narration_script:
      "Capcom has thirty minutes tonight to make three very different games feel urgent. Follow Pulse Gaming so you never miss a beat.",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "source_manifest.json"), {
    primary_source: {
      name: "Capcom Spotlight",
      url: "https://www.capcom-games.com/showcase/spotlight/",
      type: "official_showcase_page",
    },
    direct_media_candidates: [
      {
        direct_media_url: "https://www.youtube.com/watch?v=cwpiuMofOeo",
        label: "Teaser: Capcom Spotlight US",
        source_family: "capcom_spotlight_us_teaser",
        source_type: "official_youtube_reference",
      },
      {
        direct_media_url_if_available: "https://www.youtube.com/watch?v=_m8DUO8gjnE",
        label: "Teaser: Capcom Spotlight UK",
        source_family: "capcom_spotlight_uk_teaser",
        source_type: "official_youtube_reference",
      },
    ],
  }, { spaces: 2 });
  await fs.writeJson(storyPackagesPath, [
    {
      story_id: "seed_capcom_spotlight_pressure_20260625",
      artifact_dir: artifactDir,
    },
  ], { spaces: 2 });

  const result = await buildFreshRefillOfficialSourceEvidence({ storyPackagesPath, outputDir });
  const entries = await fs.readJson(result.officialSourceEntriesPath);
  const intake = await fs.readJson(result.officialSourceIntakeJsonPath);

  assert.equal(result.story_count, 1);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.official_source_url), [
    "https://www.youtube.com/watch?v=cwpiuMofOeo",
    "https://www.youtube.com/watch?v=_m8DUO8gjnE",
  ]);
  assert.ok(entries.every((entry) => entry.source_type === "official_youtube_channel_url"));
  assert.ok(entries.every((entry) => entry.direct_media_url_if_available === ""));
  assert.equal(intake.summary.accepted, 2);
  assert.equal(intake.summary.rejected, 0);
  assert.ok(intake.accepted_references.every((reference) => reference.source_url_kind === "youtube_watch"));
  assert.ok(intake.accepted_references.every((reference) => reference.segment_validation_eligible === false));
});

test("fresh refill source evidence preserves legacy official YouTube local masters with public source identity", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-youtube-local-master-"));
  const artifactDir = path.join(tmp, "rss_arknights_endfield");
  const outputDir = path.join(tmp, "repair");
  const storyPackagesPath = path.join(tmp, "story-packages.json");
  const japanMaster = path.join(tmp, "arknights_official_japan_expo_0FMTc3h1VoI.mp4");
  const homecomingMaster = path.join(tmp, "arknights_official_homecoming_xxURfVAVSfE.mp4");
  const arcaneMaster = path.join(tmp, "arknights_official_arcane_story_Jeh2M3HWnpI_720.mp4");

  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_arknights_endfield",
    selected_title: "Arknights: Endfield's PS5 Pro Upgrade Has A Real Test",
    canonical_title: "Arknights: Endfield's PS5 Pro Upgrade Has A Real Test",
    canonical_subject: "Arknights: Endfield",
    canonical_game: "Arknights: Endfield",
    narration_script:
      "Arknights: Endfield just gave PS5 Pro owners a real before-and-after test. Follow Pulse Gaming so you never miss a beat.",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "source_manifest.json"), {
    primary_source: {
      name: "PlayStation Blog",
      url: "https://blog.playstation.com/2026/07/15/arknights-endfield-on-ps5-pro/",
      type: "rss",
    },
    direct_media_candidates: [
      {
        direct_media_url: japanMaster,
        source_title: "Arknights: Endfield Japan Expo trailer",
        source_family: "url:youtube:0fmtc3h1voi_window_20_15_2_85",
        source_type: "official_youtube_channel",
        source_owner: "Arknights: Endfield",
      },
      {
        direct_media_url: homecomingMaster,
        source_title: "Arknights: Endfield Homecoming trailer",
        source_family: "url:youtube:xxurfvavsfe_window_132_5",
        source_type: "official_youtube_channel",
        source_owner: "Arknights: Endfield",
      },
      {
        direct_media_url: arcaneMaster,
        source_title: "Arknights: Endfield Arcane story trailer",
        source_family: "url:youtube:jeh2m3hwnpi_window_134_15_2_85",
        source_type: "official_youtube_channel",
        source_owner: "Arknights: Endfield",
      },
    ],
  }, { spaces: 2 });
  await fs.writeJson(storyPackagesPath, [
    {
      story_id: "rss_arknights_endfield",
      artifact_dir: artifactDir,
    },
  ], { spaces: 2 });

  const result = await buildFreshRefillOfficialSourceEvidence({ storyPackagesPath, outputDir });
  const entries = await fs.readJson(result.officialSourceEntriesPath);
  const candidateStories = await fs.readJson(result.candidateStoriesPath);

  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((entry) => entry.source_type), [
    "official_youtube_channel_url",
    "official_youtube_channel_url",
    "official_youtube_channel_url",
  ]);
  assert.deepEqual(entries.map((entry) => entry.official_source_url), [
    "https://www.youtube.com/watch?v=0FMTc3h1VoI",
    "https://www.youtube.com/watch?v=xxURfVAVSfE",
    "https://www.youtube.com/watch?v=Jeh2M3HWnpI",
  ]);
  assert.deepEqual(entries.map((entry) => entry.direct_media_url_if_available), [
    japanMaster,
    homecomingMaster,
    arcaneMaster,
  ]);
  assert.deepEqual(entries.map((entry) => entry.local_operator_file_path), [
    japanMaster,
    homecomingMaster,
    arcaneMaster,
  ]);
  assert.equal(candidateStories.length, 1);
  assert.deepEqual(
    candidateStories[0].direct_media_candidates.map((candidate) => ({
      direct_media_url: candidate.direct_media_url,
      source_type: candidate.source_type,
      youtube_video_id: candidate.youtube_video_id,
    })),
    [
      {
        direct_media_url: japanMaster,
        source_type: "official_youtube_channel",
        youtube_video_id: "0FMTc3h1VoI",
      },
      {
        direct_media_url: homecomingMaster,
        source_type: "official_youtube_channel",
        youtube_video_id: "xxURfVAVSfE",
      },
      {
        direct_media_url: arcaneMaster,
        source_type: "official_youtube_channel",
        youtube_video_id: "Jeh2M3HWnpI",
      },
    ],
  );
});

test("fresh refill source evidence preserves source-backed claims needed by strict public-copy QA", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-source-claims-"));
  const artifactDir = path.join(tmp, "rss_arknights_source_claims");
  const outputDir = path.join(tmp, "repair");
  const storyPackagesPath = path.join(tmp, "story-packages.json");
  const sourceUrl =
    "https://blog.playstation.com/2026/07/15/arknights-endfield-on-ps5-pro/";
  const detailedClaim =
    "The upgraded PSSR delivers sharper image quality, improved temporal stability and higher frame rates at 4K.";
  const unrelatedFooter =
    "Like this PlayStation 5 Learn more Latest News Share of the Week and other unrelated stories.";

  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_arknights_source_claims",
    selected_title: "Arknights: Endfield's PS5 Pro Upgrade Has A Real Test",
    canonical_subject: "Arknights: Endfield",
    primary_source: "PlayStation Blog",
    primary_source_url: sourceUrl,
    source_published_at: "2026-07-15T17:00:37.000Z",
    narration_script:
      "Arknights: Endfield's upgraded PSSR sharpens image quality and steadies motion at 4K. " +
      "If Arknights: Endfield stays sharp in motion, the upgrade passes its real test.",
    confirmed_claims: [
      "Arknights: Endfield received a Version 1.4 update.",
      unrelatedFooter,
    ],
    claim_inventory: {
      confirmed: [
        "Arknights: Endfield received a Version 1.4 update.",
        unrelatedFooter,
      ],
      unconfirmed: [],
      prohibited: [],
    },
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "source_manifest.json"), {
    primary_source: {
      name: "PlayStation Blog",
      url: sourceUrl,
      type: "official_or_major_source",
      published_at: "2026-07-15T17:00:37.000Z",
    },
    source_evidence: {
      status: "pass",
      source_url: sourceUrl,
      claims: [
        {
          text: detailedClaim,
          source_url: sourceUrl,
          evidence_text: detailedClaim,
          origin: "source_body",
        },
        {
          text: unrelatedFooter,
          source_url: sourceUrl,
          evidence_text: unrelatedFooter,
          origin: "source_body",
        },
      ],
    },
  }, { spaces: 2 });
  await fs.writeJson(storyPackagesPath, [{
    story_id: "rss_arknights_source_claims",
    artifact_dir: artifactDir,
  }], { spaces: 2 });

  const result = await buildFreshRefillOfficialSourceEvidence({ storyPackagesPath, outputDir });
  const candidateStories = await fs.readJson(result.candidateStoriesPath);
  const story = candidateStories[0];

  assert.ok(story.confirmed_claims.includes(detailedClaim));
  assert.ok(story.claim_inventory.confirmed.includes(detailedClaim));
  assert.equal(story.confirmed_claims.includes(unrelatedFooter), false);
  assert.equal(story.claim_inventory.confirmed.includes(unrelatedFooter), false);
  assert.equal(
    (story.narration_script.match(/Arknights:\s*Endfield/gi) || []).length,
    1,
  );
  assert.match(story.narration_script, /If the game stays sharp in motion/);
  assert.equal(story.full_script, story.narration_script);
  assert.equal(story.caption_display_text, story.narration_script);
  assert.deepEqual(story.source_evidence, {
    status: "pass",
    source_url: sourceUrl,
    claims: [
      {
        text: detailedClaim,
        source_url: sourceUrl,
        evidence_text: detailedClaim,
        origin: "source_body",
      },
      {
        text: unrelatedFooter,
        source_url: sourceUrl,
        evidence_text: unrelatedFooter,
        origin: "source_body",
      },
    ],
  });
});

test("fresh refill source evidence keeps candidate stories that need supplemental official search", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-supplemental-"));
  const artifactDir = path.join(tmp, "rss_marvel_tokon");
  const outputDir = path.join(tmp, "repair");
  const storyPackagesPath = path.join(tmp, "story-packages.json");

  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_marvel_tokon",
    selected_title: "MARVEL Tokon Finally Shows Real Gameplay",
    canonical_title: "MARVEL Tokon Finally Shows Real Gameplay",
    canonical_subject: "MARVEL Tokon",
    canonical_game: "MARVEL Tokon",
    narration_script:
      "MARVEL Tokon just gave fighting-game fans the proof they were waiting for. Follow Pulse Gaming so you never miss a beat.",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "source_manifest.json"), {
    primary_source: {
      name: "PC Gamer",
      url: "https://www.pcgamer.com/games/fighting/marvel-tokon-finally-shows-real-gameplay/",
      type: "rss",
    },
  }, { spaces: 2 });
  await fs.writeJson(storyPackagesPath, [
    {
      story_id: "rss_marvel_tokon",
      artifact_dir: artifactDir,
    },
  ], { spaces: 2 });

  const result = await buildFreshRefillOfficialSourceEvidence({ storyPackagesPath, outputDir });
  const candidateStories = await fs.readJson(result.candidateStoriesPath);
  const entries = await fs.readJson(result.officialSourceEntriesPath);
  const intake = await fs.readJson(result.officialSourceIntakeJsonPath);

  assert.equal(result.story_count, 1);
  assert.deepEqual(candidateStories.map((story) => story.story_id), ["rss_marvel_tokon"]);
  assert.equal(candidateStories[0].canonical_subject, "MARVEL Tokon");
  assert.equal(entries.length, 0);
  assert.equal(intake.summary.accepted, 0);
  assert.equal(intake.summary.rejected, 0);
});

test("fresh refill direct-media input prefers a hash-bound official YouTube master over metadata-only evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-youtube-motion-"));
  const sourceEntriesPath = path.join(tmp, "official-source-entries.json");
  const officialSearchAutofillTemplatePath = path.join(tmp, "official-search.json");
  const officialYoutubeMotionTemplatePath = path.join(tmp, "official-youtube-motion.json");
  const outputPath = path.join(tmp, "merged.json");
  const referenceUrl = "https://www.youtube.com/watch?v=EfwGJH-etgk";
  const shared = {
    story_id: "rss_arknights_endfield",
    entity: "Arknights: Endfield",
    source_type: "official_youtube_channel_url",
    official_source_url: referenceUrl,
    source_title: "Arknights: Endfield Beta Test Trailer",
    source_owner: "Arknights: Endfield",
    source_family: "official_youtube_EfwGJH-etgk",
    source_verified: true,
    official_channel_url: "https://www.youtube.com/@arknightsendfieldEN",
    youtube_video_id: "EfwGJH-etgk",
  };
  await fs.writeJson(sourceEntriesPath, []);
  await fs.writeJson(officialSearchAutofillTemplatePath, {
    schema_version: 1,
    entries: [{
      ...shared,
      segment_validation_eligible: false,
      autonomous_use_approved: false,
    }],
  });
  await fs.writeJson(officialYoutubeMotionTemplatePath, {
    schema_version: 1,
    entries: [{
      ...shared,
      local_operator_file_path: path.join(tmp, "EfwGJH-etgk.mp4"),
      source_url_kind: "local_video_file",
      segment_validation_eligible: true,
      autonomous_use_approved: true,
      provenance: {
        source: "official_youtube_channel_download",
        reference_url: referenceUrl,
        source_sha256: "a".repeat(64),
        source_identity_sha256: "b".repeat(64),
      },
    }],
  });

  const result = await buildFreshRefillDirectMediaDiscoveryInput({
    sourceEntriesPath,
    officialSearchAutofillTemplatePath,
    officialYoutubeMotionTemplatePath,
    outputPath,
  });
  const merged = await fs.readJson(outputPath);

  assert.equal(result.official_youtube_motion_entry_count, 1);
  assert.equal(result.merged_entry_count, 1);
  assert.equal(merged[0].source_url_kind, "local_video_file");
  assert.equal(merged[0].segment_validation_eligible, true);
  assert.equal(merged[0].provenance.source_sha256, "a".repeat(64));
});

test("fresh refill materialises only verified official YouTube metadata before discovery", () => {
  const rows = freshRefillOfficialYoutubeMotionRows({
    entries: [
      {
        story_id: "rss_arknights_endfield",
        source_type: "official_youtube_channel_url",
        source_verified: true,
        youtube_video_id: "EfwGJH-etgk",
        official_channel_url: "https://www.youtube.com/@arknightsendfieldEN",
      },
      {
        story_id: "rss_ign_reupload",
        source_type: "official_youtube_channel_url",
        source_verified: false,
        youtube_video_id: "badmedia123",
      },
      {
        story_id: "rss_storefront",
        source_type: "platform_storefront",
        source_verified: true,
      },
    ],
  });

  assert.deepEqual(rows.map((row) => row.story_id), ["rss_arknights_endfield"]);
  assert.deepEqual(
    freshRefillOfficialYoutubeMotionChildArgs({
      inputPath: "output/refill/official-search.json",
      outputDir: "output/refill/official-youtube-motion",
      outputJsonPath: "output/refill/official-youtube-motion.json",
      outputTemplatePath: "output/refill/official-youtube-motion-template.json",
    }),
    [
      "tools/official-youtube-motion-materializer.js",
      "--input",
      "output/refill/official-search.json",
      "--output-dir",
      "output/refill/official-youtube-motion",
      "--output-json",
      "output/refill/official-youtube-motion.json",
      "--output-template",
      "output/refill/official-youtube-motion-template.json",
      "--json",
    ],
  );
});

test("fresh refill hyperframes follow-up handles materialized motion reports", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-fresh-refill-hyperframes-"));
  const reportPath = path.join(tmp, "real_motion_materialization_report.json");
  await fs.writeJson(reportPath, {
    jobs: [
      {
        story_id: "rss_marvel_tokon",
        status: "blocked",
        materialized_count: 5,
        direct_video_motion_family_count: 5,
        blockers: [],
      },
      {
        story_id: "rss_xbox_prices",
        status: "blocked",
        materialized_count: 2,
        direct_video_motion_family_count: 2,
        blockers: ["real_motion_clip_minimum_not_met"],
      },
    ],
  }, { spaces: 2 });

  const ids = await freshRefillHyperframesStoryIdsAfterMotion({
    candidateStoryIds: ["rss_marvel_tokon", "rss_xbox_prices"],
    realMotionReportPath: reportPath,
  });

  assert.deepEqual(ids, ["rss_marvel_tokon"]);
});

test("fresh refill HyperFrames card generation allows a complete six-card render", () => {
  assert.equal(freshRefillHyperframesCardTimeoutMs(undefined), 6 * 60 * 1000);
  assert.equal(freshRefillHyperframesCardTimeoutMs("420000"), 420000);
  assert.equal(freshRefillHyperframesCardTimeoutMs("invalid"), 6 * 60 * 1000);
});

test("fresh refill audio materialization allows bounded CPU Whisper retries to finish", () => {
  assert.equal(
    freshRefillAudioTimestampMaterializerTimeoutMs(undefined),
    30 * 60 * 1000,
  );
  assert.equal(
    freshRefillAudioTimestampMaterializerTimeoutMs("2700000"),
    45 * 60 * 1000,
  );
  assert.equal(
    freshRefillAudioTimestampMaterializerTimeoutMs("7200000"),
    60 * 60 * 1000,
  );
  assert.equal(
    freshRefillAudioTimestampMaterializerTimeoutMs("invalid"),
    30 * 60 * 1000,
  );
});

test("guarded publish handler preserves failed platform error in thrown job message", async () => {
  const executorPath = require.resolve("../../lib/goal-guarded-live-dispatch-executor");
  const dbPath = require.resolve("../../lib/db");
  const notifyPath = require.resolve("../../notify");
  const originalCache = new Map([
    [executorPath, require.cache[executorPath]],
    [dbPath, require.cache[dbPath]],
    [notifyPath, require.cache[notifyPath]],
  ]);
  const originalEnv = {
    PULSE_GUARDED_EXECUTOR_PLAN_PATH: process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH,
  };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-guarded-error-detail-"));
  const planPath = path.join(root, "guarded_dispatch_executor_plan.json");
  try {
    await fs.writeJson(planPath, {
      mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
      handoff_ready_actions: [
        {
          action_id: "story-1:youtube_shorts",
          story_id: "story-1",
          platform: "youtube_shorts",
          title: "A Failed Upload",
        },
      ],
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
        no_oauth_or_token_change: true,
      },
    });
    process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH = planPath;
    require.cache[executorPath] = {
      id: executorPath,
      filename: executorPath,
      loaded: true,
      exports: {
        async selectNextGuardedLiveAction() {
          return {
            exhausted: false,
            action_id: "story-1:youtube_shorts",
            selected_action_ids: ["story-1:youtube_shorts"],
            action: {
              action_id: "story-1:youtube_shorts",
              story_id: "story-1",
              platform: "youtube_shorts",
              title: "A Failed Upload",
            },
          };
        },
        async runGuardedLiveDispatchExecutor() {
          return {
            verdict: "RED",
            summary: {
              upload_attempt_count: 0,
              db_mutation_count: 1,
            },
            actions: [
              {
                action_id: "story-1:youtube_shorts",
                story_id: "story-1",
                platform: "youtube_shorts",
                outcome: "failed",
                error: "YouTube upload failed: quota exceeded",
                uploaded: false,
                db_mutated: true,
              },
            ],
            blocked_actions: [],
          };
        },
        async writeGuardedLiveDispatchExecutorReport() {
          return {};
        },
      },
    };
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        async getStories() {
          return [];
        },
      },
    };
    require.cache[notifyPath] = {
      id: notifyPath,
      filename: notifyPath,
      loaded: true,
      exports: async () => {},
    };

    await assert.rejects(
      () => handleGuardedLiveDispatchPublish({ id: 123 }, { log() {} }),
      /guarded_publish_window_failed:story-1:youtube_shorts:failed:youtube_upload_failed_quota_exceeded/,
    );
  } finally {
    for (const [id, entry] of originalCache.entries()) {
      if (entry) require.cache[id] = entry;
      else delete require.cache[id];
    }
    if (originalEnv.PULSE_GUARDED_EXECUTOR_PLAN_PATH === undefined) {
      delete process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH;
    } else {
      process.env.PULSE_GUARDED_EXECUTOR_PLAN_PATH = originalEnv.PULSE_GUARDED_EXECUTOR_PLAN_PATH;
    }
    await fs.remove(root);
  }
});

test("scheduler refreshes a stale partial executor handoff from the guarded dispatch plan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-scheduler-executor-coverage-"));
  const guardedPlanPath = path.join(root, "guarded_dispatch_plan.json");
  const executorPlanPath = path.join(root, "guarded_dispatch_executor_plan.json");
  const previousPlanPath = process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH;

  const dispatchAction = (platform) => ({
    story_id: "story-1",
    platform,
    title: "A Full Story Bundle",
    video_path: "C:\\proof\\story-1\\visual_v4_render.mp4",
    captions_path: "C:\\proof\\story-1\\captions.srt",
    first_frame_source: "C:\\proof\\story-1\\visual_v4_render.mp4",
    canonical_manifest_path: "C:\\proof\\story-1\\canonical_story_manifest.json",
    platform_publish_manifest_path: "C:\\proof\\story-1\\platform_publish_manifest.json",
    live_publish_allowed_from_preflight: false,
    requires_guarded_live_dispatch_executor: true,
    requires_last_second_kill_switch_check: true,
    requires_last_second_platform_recheck: true,
  });

  await fs.writeJson(guardedPlanPath, {
    schema_version: 1,
    generated_at: "2026-06-19T09:00:00.000Z",
    mode: "GUARDED_DISPATCH_PREFLIGHT",
    ready_for_guarded_dispatch: true,
    live_publish_allowed_from_this_tool: false,
    required_next_step: "run_guarded_live_dispatch_executor_with_kill_switch_and_final_platform_recheck",
    dispatch_ready_actions: [
      dispatchAction("youtube_shorts"),
      dispatchAction("instagram_reels"),
      dispatchAction("facebook_reels"),
    ],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });

  await fs.writeJson(executorPlanPath, {
    schema_version: 1,
    generated_at: "2026-06-19T09:05:00.000Z",
    mode: "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT",
    source_mode: "manual_single_action_preflight",
    ready_for_live_executor_handoff: true,
    live_publish_allowed_from_this_tool: false,
    required_next_step: "run_guarded_live_dispatch_executor",
    handoff_ready_action_count: 1,
    blocked_selected_action_count: 0,
    handoff_ready_actions: [{
      action_id: "story-1:youtube_shorts",
      story_id: "story-1",
      platform: "youtube_shorts",
      title: "A Full Story Bundle",
      live_publish_allowed_from_preflight_only: false,
      requires_live_executor_command: true,
      requires_last_second_kill_switch_check: true,
      requires_last_second_platform_recheck: true,
    }],
    blocked_selected_actions: [],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });

  try {
    process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH = guardedPlanPath;
    const plan = await readGuardedLiveExecutorPlanForScheduler(
      executorPlanPath,
      "2026-06-19T09:06:00.000Z",
    );

    assert.equal(plan.source_mode, "scheduler_scoped_guarded_dispatch_plan");
    assert.equal(plan.handoff_ready_action_count, 3);
    assert.deepEqual(
      plan.handoff_ready_actions.map((action) => action.action_id),
      [
        "story-1:youtube_shorts",
        "story-1:instagram_reels",
        "story-1:facebook_reels",
      ],
    );
  } finally {
    if (previousPlanPath === undefined) delete process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH;
    else process.env.PULSE_GUARDED_DISPATCH_PLAN_PATH = previousPlanPath;
  }
});
