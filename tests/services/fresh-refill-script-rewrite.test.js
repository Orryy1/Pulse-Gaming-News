"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs-extra");
const path = require("node:path");

const {
  assertSafeArtifactDir,
  buildFreshRefillViewerScript,
  runFreshRefillScriptRewrite,
} = require("../../lib/ops/fresh-refill-script-rewrite");
const { auditMassAudienceClarity } = require("../../lib/ops/transcript-audience-audit");

const ROOT = path.resolve(__dirname, "..", "..");
const TEST_ROOT = path.join(ROOT, "test", "output", "fresh-refill-script-rewrite");
const GENERIC_SCRIPT =
  "Tekken 8 has a new source detail, but the real question is still what players can do with it. Eurogamer says Tekken 8 is adding Bob to its roster and players seem pretty hyped, despite the fighting game's mounting struggles. If it changes when people buy, download, wishlist or return, the update matters. If it only repeats a headline, it needs stronger proof before it deserves attention. The next official detail has to make that choice clear: play now, wait, skip or watch for gameplay. Follow Pulse Gaming so you never miss a beat.";

function tekkenBobJob(artifactDir) {
  return {
    story_id: "rss_4a07e21d3192fd7c",
    title: "Tekken 8 Finally Shows Real Gameplay",
    artifact_dir: artifactDir,
    source: {
      name: "Eurogamer",
      url: "https://www.eurogamer.net/tekken-8-bob-gameplay-trailer",
      type: "rss",
      published_at: "Mon, 29 Jun 2026 11:23:29 +0000",
    },
    current_script: GENERIC_SCRIPT,
    scorecard_verdict: "rewrite_required",
    scorecard_blockers: [
      "generic_title_template",
      "persuasive_authority_trope",
      "internal_audience_scaffold",
    ],
  };
}

function canonicalManifest() {
  return {
    story_id: "rss_4a07e21d3192fd7c",
    canonical_subject: "Tekken 8",
    canonical_game: "Tekken 8",
    canonical_title: "Tekken 8 Finally Shows Real Gameplay",
    primary_source: "Eurogamer",
    primary_source_url: "https://www.eurogamer.net/tekken-8-bob-gameplay-trailer",
    source_published_at: "Mon, 29 Jun 2026 11:23:29 +0000",
    confirmed_claims: [
      "Tekken 8 is adding Bob to its roster and players seem pretty hyped, despite the fighting game's mounting struggles",
    ],
    selected_title: "Tekken 8 Finally Shows Real Gameplay",
    short_title: "Tekken 8 Just Got A New Signal",
    narration_hook:
      "Tekken 8 has a new source detail, but the real question is still what players can do with it.",
    first_spoken_line:
      "Tekken 8 has a new source detail, but the real question is still what players can do with it.",
    narration_script: GENERIC_SCRIPT,
    tts_script: GENERIC_SCRIPT,
    spoken_narration_script: GENERIC_SCRIPT,
    description: "Source: Eurogamer.",
    title: "Tekken 8 Finally Shows Real Gameplay",
    public_title: "Tekken 8 Finally Shows Real Gameplay",
  };
}

function platformManifest() {
  return {
    schema_version: 1,
    story_id: "rss_4a07e21d3192fd7c",
    operating_mode: "LOCAL_PROOF",
    publish_status: "RED",
    outputs: {
      youtube_shorts: {
        title: "Tekken 8 Finally Shows Real Gameplay",
        description: "Generic description.",
        cover_frame: { headline: "TEKKEN 8 FINALLY SHOWS REAL GAMEPLAY" },
      },
      instagram_reels: {
        caption: "Generic caption.",
        cover_frame: { headline: "TEKKEN 8 FINALLY SHOWS REAL GAMEPLAY" },
      },
      facebook_reels: {
        duration_seconds: { min: 35, max: 60 },
        page_caption: "Generic page caption.",
      },
      x: {
        hot_take_post: "Generic X post.",
        thread_posts: ["Generic thread."],
      },
    },
    platform_native_evidence: {
      schema_version: 1,
      verdict: "fail",
      platforms: [
        {
          platform: "youtube_shorts",
          status: "pass",
          copy_fingerprint: "generic description old weak title",
        },
        {
          platform: "instagram_reels",
          status: "pass",
          copy_fingerprint: "generic caption old weak cover",
        },
      ],
      failures: [
        { platform: "youtube_shorts", reason: "weak_cover_headline" },
        { platform: "instagram_reels", reason: "weak_cover_headline" },
      ],
    },
  };
}

async function writeFixture(name = "case") {
  const artifactDir = path.join(TEST_ROOT, name, "artifact");
  await fs.remove(path.join(TEST_ROOT, name));
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), canonicalManifest(), {
    spaces: 2,
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), platformManifest(), {
    spaces: 2,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "rewrite_required",
    blockers: ["internal_audience_scaffold"],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "coherence_report.json"), {
    result: "fail",
    failures: ["script_coherence:vague_filler:internal_audience_scaffold"],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: [
      "script:rewrite_required",
      "platform_native:youtube_shorts:weak_platform_title",
      "platform_native:youtube_shorts:weak_cover_headline",
      "platform_native:instagram_reels:weak_cover_headline",
      "media_house:title_lacks_curiosity_gap",
      "media_house:platform_title_too_plain",
      "media_house:first_frame_or_thumbnail_not_attention_led",
      "render:final_publish_render_missing",
      "audio:narration_audio_missing",
      "captions:word_timestamps_missing",
    ],
    blockers: [
      "script:rewrite_required",
      "platform_native:youtube_shorts:weak_platform_title",
      "media_house:title_lacks_curiosity_gap",
      "render:final_publish_render_missing",
    ],
    package_quality_gate: {
      verdict: "script_blocked",
      blockers: [
        "script:rewrite_required",
        "platform_native:youtube_shorts:weak_cover_headline",
        "media_house:first_frame_or_thumbnail_not_attention_led",
        "audio:narration_audio_missing",
      ],
    },
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "goal_package_summary.json"), {
    story_id: "rss_4a07e21d3192fd7c",
    verdict: "RED",
    blockers: [
      "script:rewrite_required",
      "media_house:title_lacks_curiosity_gap",
      "platform_native:youtube_shorts:weak_cover_headline",
      "render:final_publish_render_missing",
    ],
  }, { spaces: 2 });

  const workOrderPath = path.join(TEST_ROOT, name, "work_order.json");
  await fs.writeJson(workOrderPath, {
    schema_version: 1,
    source: "test",
    jobs: [tekkenBobJob(artifactDir)],
    safety: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
    },
  }, { spaces: 2 });

  return { artifactDir, workOrderPath };
}

test("fresh refill viewer script turns a generic Bob script into viral-ready narration", () => {
  const script = buildFreshRefillViewerScript({
    job: tekkenBobJob(path.join(TEST_ROOT, "unused")),
    manifest: canonicalManifest(),
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.match(script.full_script, /^Tekken 8 bringing Bob back\b/);
  assert.match(script.full_script, /Bob|roster|matchups|lapsed players/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(
    script.full_script,
    /new source detail|real question|play now, wait, skip|source-backed update|the player impact is/i,
  );
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script keeps Marvel Tokon roster gameplay copy concrete early", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_228f6f28b62f8426",
      title: "Blade, Loki, Deadpool Announced For MARVEL Tokon Finally Shows Real Gameplay",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "PlayStation Blog",
        url: "https://blog.playstation.com/2026/06/28/blade-loki-deadpool-announced-for-marvel-tokon-fighting-souls/",
        type: "rss",
      },
      current_script:
        "PlayStation Blog says Blade, Loki, Deadpool announced for MARVEL Tokon: Fighting Souls.",
    },
    manifest: {
      story_id: "rss_228f6f28b62f8426",
      confirmed_claims: [
        "Blade, Loki and Deadpool were announced for MARVEL Tokon: Fighting Souls",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.match(script.full_script, /combat styles|movement problem/i);
  assert.match(script.full_script, /Each hero needs to create a different movement problem/i);
  assert.doesNotMatch(script.full_script, /It is about whether|players have to whether|The real question is/i);
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script turns Star Wars Monopoly abilities into a clear family-drama hook", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_e622e340996cda19",
      title: "Star Wars Monopoly Heroes Vs Villains Character Abilities",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/29/monopoly-star-wars-heroes-villains-character-abilities/",
        type: "rss",
      },
      current_script:
        "Xbox Wire says Monopoly Star Wars Heroes versus Villains gives characters their own abilities.",
    },
    manifest: {
      story_id: "rss_e622e340996cda19",
      canonical_subject: "Monopoly Star Wars",
      canonical_game: "Monopoly Star Wars",
      confirmed_claims: [
        "Heroes versus Villains gives each character abilities in Monopoly Star Wars",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.suggested_title, "Star Wars Monopoly Turns Force Powers Into Family Drama");
  assert.equal(script.suggested_thumbnail_text, "FORCE POWERS FIGHT");
  assert.ok(script.word_count >= 110, `expected a duration-safe short script, got ${script.word_count} words`);
  assert.match(script.full_script, /Heroes versus Villains gives each character abilities/i);
  assert.match(script.full_script, /who blocks rent, who steals momentum/i);
  assert.match(script.full_script, /family-night arguments/i);
  assert.doesNotMatch(script.full_script, /proper table chaos|branded board|branded box|shelf filler|shell filler/i);
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
});

test("fresh refill viewer script keeps Fatal Fury City Of The Wolves in the public title", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_f2f7097c7ad52e30",
      title: "City of the Wolves Just Got Kenshiro",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/29/fatal-fury-fist-of-the-north-star-kenshiro/",
        type: "rss",
      },
      current_script:
        "Xbox Wire says Kenshiro from Fist of the North Star is coming to Fatal Fury: City of the Wolves.",
    },
    manifest: {
      story_id: "rss_f2f7097c7ad52e30",
      canonical_subject: "City of the Wolves",
      confirmed_claims: [
        "Kenshiro from Fist of the North Star is coming to FATAL FURY: City of the Wolves",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.suggested_title, "Fatal Fury City Of The Wolves Gets A Kenshiro Roster Fight");
  assert.ok(
    script.word_count >= 106 && script.word_count <= 110,
    `expected a duration-safe short script, got ${script.word_count} words`,
  );
  assert.match(script.full_script, /^Fatal Fury City of the Wolves just turned Kenshiro into a ranked-mode problem\./);
  assert.match(script.full_script, /reach, pressure, counters, combat rhythm/i);
  assert.match(script.full_script, /players will call it out fast/i);
  assert.doesNotMatch(script.full_script, /crossover becomes noise|crossover is a huge/i);
  assert.doesNotMatch(script.suggested_title, /:/, "avoid title punctuation that creates TTS title pauses");
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
  const massAudience = auditMassAudienceClarity({
    script: script.full_script,
    title: script.suggested_title,
    sourceName: "Xbox Wire",
    canonicalSubject: "Fatal Fury: City Of The Wolves",
  });
  assert.equal(massAudience.result, "pass", JSON.stringify(massAudience, null, 2));
  assert.equal(massAudience.concrete_detail_count >= 3, true);
});

test("fresh refill viewer script writes Black Flag Resynced narration that is ASR-safe and audience clear", () => {
  const script = buildFreshRefillViewerScript({
    job: {
      story_id: "rss_476510b5f312fbec",
      title: "Assassin's Creed Black Flag Resynced PS5 Pro enhancements detailed",
      artifact_dir: path.join(TEST_ROOT, "unused"),
      source: {
        name: "PlayStation Blog",
        url: "https://blog.playstation.com/2026/06/30/assassins-creed-black-flag-resynced-ps5-pro-enhancements/",
        type: "rss",
      },
      current_script:
        "PlayStation Blog says Assassin's Creed Black Flag Resynced has PS5 Pro enhancements.",
    },
    manifest: {
      story_id: "rss_476510b5f312fbec",
      canonical_subject: "Assassin's Creed Black Flag Resynced",
      confirmed_claims: [
        "PlayStation Blog details PS5 Pro enhancements for Assassin's Creed Black Flag Resynced",
      ],
    },
  });

  assert.equal(script.verdict, "viral_ready", JSON.stringify(script.quality, null, 2));
  assert.equal(script.suggested_title, "Assassin's Creed Black Flag Resynced Needs PS5 Pro Motion Proof");
  assert.equal(script.suggested_thumbnail_text, "BLACK FLAG PS5 PRO TEST");
  assert.ok(
    script.word_count >= 82 && script.word_count <= 86,
    `expected a motion-dwell-safe short script, got ${script.word_count} words`,
  );
  assert.match(script.full_script, /^Assassin's Creed Black Flag Resynced has one job\. Make the pirate loop feel dangerous again\./);
  assert.match(script.full_script, /the real test is motion, not screenshots/i);
  assert.match(script.full_script, /If this restores that rhythm, lapsed players get a reason to reinstall/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(script.full_script, /open-sea|gets ugly fast|\bNext\b|source-backed update|the player impact is|ocean still feels alive|wallpaper|fans will notice/i);
  assert.doesNotMatch(script.suggested_title, /:/, "avoid title punctuation that creates TTS title pauses");
  assert.deepEqual(script.quality.blockers, []);
  assert.equal(script.coherence.result, "pass");
  const massAudience = auditMassAudienceClarity({
    script: script.full_script,
    title: script.suggested_title,
    sourceName: "PlayStation Blog",
    canonicalSubject: "Assassin's Creed Black Flag Resynced",
  });
  assert.equal(massAudience.result, "pass", JSON.stringify(massAudience, null, 2));
  assert.equal(massAudience.concrete_detail_count >= 3, true);
});

test("fresh refill script rewrite dry-run leaves local proof files unchanged", async () => {
  const { artifactDir, workOrderPath } = await writeFixture("dry-run");
  const manifestPath = path.join(artifactDir, "canonical_story_manifest.json");
  const before = await fs.readFile(manifestPath, "utf8");

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(TEST_ROOT, "dry-run", "report"),
    applyLocal: false,
  });

  assert.equal(report.summary.pass_count, 1);
  assert.equal(report.summary.applied_count, 0);
  assert.equal(report.summary.would_apply_count, 1);
  assert.equal(report.output_dir, path.join(TEST_ROOT, "dry-run", "report"));
  assert.equal(await fs.readFile(manifestPath, "utf8"), before);
});

test("fresh refill script rewrite apply updates only local proof artefacts", async () => {
  const { artifactDir, workOrderPath } = await writeFixture("apply");

  const report = await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(TEST_ROOT, "apply", "report"),
    applyLocal: true,
  });

  assert.equal(report.summary.pass_count, 1);
  assert.equal(report.summary.applied_count, 1);

  const manifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.match(manifest.narration_script, /^Tekken 8 bringing Bob back\b/);
  assert.doesNotMatch(manifest.narration_script, /new source detail|real question|play now, wait, skip/i);
  assert.equal(manifest.title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
  assert.equal(manifest.canonical_title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
  assert.equal(manifest.selected_title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
  assert.equal(manifest.public_title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
  assert.equal(manifest.script_repair.local_only, true);
  assert.equal(manifest.script_repair.no_db_mutation, true);

  const scorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
  assert.deepEqual(scorecard.blockers, []);

  const coherence = await fs.readJson(path.join(artifactDir, "coherence_report.json"));
  assert.equal(coherence.result, "pass", JSON.stringify(coherence, null, 2));

  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  assert.equal(platform.outputs.youtube_shorts.title, "Tekken 8 Bob DLC Turns Into A Roster Comeback Test");
  assert.match(platform.outputs.youtube_shorts.description, /Bob|Eurogamer/i);
  assert.doesNotMatch(platform.outputs.instagram_reels.caption, /new source detail|real question/i);
  assert.equal(platform.platform_native_evidence.verdict, "pass", JSON.stringify(platform.platform_native_evidence, null, 2));
  assert.ok(
    !platform.platform_native_evidence.failures.some((failure) => /weak_cover_headline|weak_platform_title/.test(failure.reason)),
    JSON.stringify(platform.platform_native_evidence.failures),
  );
  const youtubeEvidence = platform.platform_native_evidence.platforms.find((item) => item.platform === "youtube_shorts");
  assert.match(youtubeEvidence.copy_fingerprint, /bob|eurogamer/i);
  assert.doesNotMatch(youtubeEvidence.copy_fingerprint, /generic description old weak title/i);
});

test("fresh refill script rewrite clears stale public-copy blockers but keeps real media blockers", async () => {
  const { artifactDir, workOrderPath } = await writeFixture("stale-copy-blockers");

  await runFreshRefillScriptRewrite({
    root: ROOT,
    workOrderPath,
    outDir: path.join(TEST_ROOT, "stale-copy-blockers", "report"),
    applyLocal: true,
  });

  const verdict = await fs.readJson(path.join(artifactDir, "publish_verdict.json"));
  const allVerdictBlockers = [
    ...verdict.reason_codes,
    ...verdict.blockers,
    ...verdict.package_quality_gate.blockers,
  ];
  assert.ok(!allVerdictBlockers.some((blocker) => /script:|weak_platform_title|weak_cover_headline|title_lacks_curiosity_gap|platform_title_too_plain|first_frame_or_thumbnail_not_attention_led/.test(blocker)));
  assert.ok(allVerdictBlockers.includes("render:final_publish_render_missing"));
  assert.ok(allVerdictBlockers.includes("audio:narration_audio_missing"));
  assert.ok(allVerdictBlockers.includes("captions:word_timestamps_missing"));

  const summary = await fs.readJson(path.join(artifactDir, "goal_package_summary.json"));
  assert.deepEqual(summary.blockers, ["render:final_publish_render_missing"]);
});

test("fresh refill script rewrite refuses artifact directories outside local output roots", () => {
  assert.throws(
    () => assertSafeArtifactDir(path.resolve(ROOT, "..", "outside-artifact"), ROOT),
    /unsafe_artifact_dir/,
  );
});
