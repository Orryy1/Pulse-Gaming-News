"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  candidateRows,
  materializeGoalRealMotion,
  writeGoalRealMotionReport,
} = require("../../lib/goal-real-motion-materializer");
const { parseArgs } = require("../../tools/goal-real-motion-materializer");

async function makePackage(root, storyId = "forza-real-motion") {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
    thumbnail_headline: "XBOX STEAM BET",
    primary_source: "The Phrasemaker",
  });
  const assets = Array.from({ length: 5 }, (_, index) => ({
    id: `${storyId}-direct-${index + 1}`,
    type: "motion_clip",
    kind: "video",
    source_family: `forza_official_family_${index + 1}`,
    path: `https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/clip_${index + 1}.mp4?tag=14`,
    source_url: `https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/clip_${index + 1}.mp4?tag=14`,
    source_kind: "direct_video",
    source_url_kind: "direct_video",
    source_type: "official_social_media_video",
    entity: "Forza Horizon 6",
    mediaStartS: 8 + index,
    durationS: 2.85,
    validated: true,
    segmentValidationPassed: true,
    trusted_source_matched: true,
    rights_risk_class: "official_reference_only",
    risk_score: 0.2,
  }));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "fail",
    failures: ["rights:no_rights_record"],
    assets,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
    },
  });
  return {
    story_id: storyId,
    title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
    artifact_dir: artifactDir,
    status: "blocked_on_render_inputs",
    actions: [{ action_id: "materialise_validated_real_motion_clips" }],
  };
}

test("real motion materializer selects only validated direct media candidates", async () => {
  const rows = candidateRows({
    rightsLedger: {
      assets: [
        {
          id: "good",
          path: "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/good.mp4?tag=14",
          source_family: "official_x",
          source_kind: "direct_video",
          segmentValidationPassed: true,
          trusted_source_matched: true,
        },
        {
          id: "watch",
          path: "https://www.youtube.com/watch?v=abc123",
          source_family: "youtube_watch_page",
          source_kind: "page",
          segmentValidationPassed: true,
          trusted_source_matched: true,
        },
        {
          id: "untrusted",
          path: "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/bad.mp4?tag=14",
          source_family: "untrusted",
          source_kind: "direct_video",
          segmentValidationPassed: true,
          trusted_source_matched: false,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "good");
});

test("real motion materializer can scope repair to selected story ids", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-scope-"));
  const selectedJob = await makePackage(root, "selected-story");
  const skippedJob = await makePackage(root, "skipped-story");

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [skippedJob, selectedJob] },
    storyIds: ["selected-story"],
    generatedAt: "2026-05-23T19:30:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 7));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.deepEqual(report.jobs.map((job) => job.story_id), ["selected-story"]);
  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(await fs.pathExists(path.join(selectedJob.artifact_dir, "materialised_motion_clips.json")), true);
  assert.equal(await fs.pathExists(path.join(selectedJob.artifact_dir, "distinct_motion_family_report.json")), true);
  assert.equal(await fs.pathExists(path.join(skippedJob.artifact_dir, "materialised_motion_clips.json")), false);
  assert.equal(await fs.pathExists(path.join(skippedJob.artifact_dir, "distinct_motion_family_report.json")), false);
});

test("real motion materializer CLI accepts repeatable story-id filters", () => {
  const args = parseArgs([
    "--story-id",
    "story-a",
    "--story",
    "story-b",
    "--segment-report",
    "test/output/segments.json",
    "--artifact-root",
    "output/candidate-supply/fresh-refill/goal-proof-batch",
    "--limit",
    "2",
    "--refresh-ready",
  ]);

  assert.deepEqual(args.storyIds, ["story-a", "story-b"]);
  assert.equal(args.segmentReportPath, "test/output/segments.json");
  assert.equal(args.artifactRoot, "output/candidate-supply/fresh-refill/goal-proof-batch");
  assert.equal(args.limit, 2);
  assert.equal(args.refreshReady, true);
});

test("real motion materializer can refresh a requested ready story from its motion pack", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-refresh-ready-"));
  const storyId = "ps5-refresh-ready";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
    },
  });
  const clips = Array.from({ length: 6 }, (_, index) => ({
    id: `ps5-official-product-${index + 1}`,
    type: "motion_clip",
    source_family: `official_playstation_family_${index + 1}`,
    path: `https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-${index + 1}.mp4`,
    source_url: `https://gmedia.playstation.com/is/content/SIEPDC/global/ps5/product-${index + 1}.mp4`,
    source_kind: "direct_video",
    source_url_kind: "direct_video",
    source_type: "official_platform_product_page",
    entity: "PS5",
    mediaStartS: 1 + index,
    durationS: 3,
    validated: true,
    segmentValidationPassed: true,
    trusted_source_matched: false,
    rights_risk_class: "official_reference_only",
    allowed_render_use: "reference_only_by_default",
    provenance: {
      source_report: "official_trailer_segment_validation",
      validation_reason: "official_product_motion_samples_passed",
    },
  }));
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips,
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          title: "PS5 Prices Went Up In Europe",
          artifact_dir: artifactDir,
          status: "ready_for_final_render_job",
          actions: [{ action_id: "run_visual_v4_production_render" }],
        },
      ],
    },
    storyIds: [storyId],
    includeReadyStories: true,
    minClips: 6,
    generatedAt: "2026-05-26T11:10:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 9));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 6);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 6);
  assert.equal(materialised.distinct_motion_family_count, 6);
  const familyReport = await fs.readJson(path.join(artifactDir, "distinct_motion_family_report.json"));
  assert.equal(familyReport.summary.distinct_motion_family_count, 6);
  assert.equal(familyReport.summary.direct_video_motion_family_count, 6);
  assert.deepEqual(familyReport.distinct_motion_families, materialised.distinct_motion_families);
});

test("real motion materializer accepts segment-validated official Steam motion-pack clips", async () => {
  const rows = candidateRows({
    motionPack: {
      readiness: { status: "v4_motion_ready", blockers: [] },
      clips: [
        {
          id: "hades-official-steam-hls",
          type: "motion_clip",
          source_family: "steam_1145350_695850",
          path: "https://video.akamai.steamstatic.com/store_trailers/1145350/695850/hash/hls_264_master.m3u8?t=1715021703",
          source_url: "https://video.akamai.steamstatic.com/store_trailers/1145350/695850/hash/hls_264_master.m3u8?t=1715021703",
          source_kind: "hls_manifest",
          source_url_kind: "hls_manifest",
          source_type: "steam_movie",
          provider: "steam",
          entity: "Hades II",
          mediaStartS: 54,
          durationS: 5,
          validated: true,
          segmentValidationPassed: true,
          trusted_source_matched: false,
          rights_risk_class: "official_reference_only",
        },
        {
          id: "unsafe-watch-page",
          path: "https://store.steampowered.com/app/1145350/Hades_II/",
          source_type: "steam_page",
          segmentValidationPassed: true,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "hades-official-steam-hls");
  assert.equal(rows[0].source_type, "steam_movie");
  assert.equal(rows[0].source_family, "steam_1145350_695850");
});

test("real motion materializer keeps segment-validated direct clips from blocked partial motion packs", async () => {
  const rows = candidateRows({
    motionPack: {
      readiness: {
        status: "v4_motion_blocked",
        blockers: ["actual_motion_clip_minimum_not_met", "distinct_motion_families_minimum_not_met"],
      },
      clips: [
        {
          id: "subnautica-official-steam-window",
          type: "motion_clip",
          source_family: "steam_1962700_1381761660",
          path: "https://video.akamai.steamstatic.com/store_trailers/1962700/1381761660/hash/hls_264_master.m3u8?t=1778770818",
          source_url: "https://video.akamai.steamstatic.com/store_trailers/1962700/1381761660/hash/hls_264_master.m3u8?t=1778770818",
          source_kind: "hls_manifest",
          source_url_kind: "hls_manifest",
          source_type: "steam_movie",
          entity: "Subnautica 2",
          mediaStartS: 58.95,
          durationS: 2.85,
          validated: true,
          segmentValidationPassed: true,
          trusted_source_matched: false,
          rights_risk_class: "official_reference_only",
        },
        {
          id: "unsafe-store-page",
          path: "https://store.steampowered.com/app/1962700/Subnautica_2/",
          source_type: "steam_page",
          validated: true,
          segmentValidationPassed: true,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "subnautica-official-steam-window");
  assert.equal(rows[0].media_kind, "direct_video");
});

test("real motion materializer accepts segment-validated official direct-media intake clips", async () => {
  const rows = candidateRows({
    motionPack: {
      readiness: { status: "v4_motion_ready", blockers: [] },
      clips: [
        {
          id: "forza-official-x-window",
          type: "motion_clip",
          source_family: "forza_horizon_official_x_fh6_coast_video",
          path: "https://video.twimg.com/amplify_video/2020858232789487616/vid/avc1/1280x720/h2mPH2YV-GPuJ6Q9.mp4?tag=14",
          source_url: "https://video.twimg.com/amplify_video/2020858232789487616/vid/avc1/1280x720/h2mPH2YV-GPuJ6Q9.mp4?tag=14",
          source_kind: "direct_video",
          source_url_kind: "direct_video",
          source_type: "licensed_direct_media_url",
          entity: "Forza Horizon 6",
          mediaStartS: 10.28,
          durationS: 5,
          validated: true,
          segmentValidationPassed: true,
          trusted_source_matched: false,
          rights_risk_class: "official_reference_only",
          allowed_render_use: "reference_only_by_default",
          provenance: {
            source: "visual_v4_motion_pack",
            source_report: "official_trailer_segment_validation",
            validation_reason: "short_direct_media_detail_motion_samples_passed",
          },
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "forza-official-x-window");
  assert.equal(rows[0].media_kind, "direct_video");
  assert.equal(rows[0].mediaStartS, 10.28);
});

test("real motion materializer does not materialize validated segment rows from another story", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-story-scope-"));
  const storyId = "target-story";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
    },
  });

  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1145350/695850/hash/hls_264_master.m3u8?t=1715021703";
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: "different-story",
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_url: sourceUrl,
      source_url_kind: "hls_manifest",
      source_type: "licensed_direct_media_url",
      provider: "official_intake",
      source_family: `other_story_family_${index + 1}`,
      entity: "Other Game",
      media_start_s: index * 5,
      duration_s: 5,
      source_duration_s: 90,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    segmentValidationReport,
    generatedAt: "2026-06-12T02:30:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].story_id, storyId);
  assert.deepEqual(report.jobs[0].blockers, ["validated_direct_media_candidates_missing"]);
  assert.equal(await fs.pathExists(path.join(artifactDir, "materialised_motion_clips.json")), false);
});

test("real motion materializer hydrates ready V4 motion packs into local direct-video clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-pack-"));
  const storyId = "hades-motion-pack";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 4 }, (_, index) => ({
        id: `existing-still-${index + 1}`,
        path: path.join(artifactDir, `existing-still-${index + 1}.mp4`),
        source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1962700/ss_${index + 1}.jpg`,
        source_family: `steam_screenshot_1962700_${index + 1}`,
        media_kind: "visual_still",
        source_type: "steam_screenshot",
        durationS: 3,
        mediaStartS: 0,
        materialized: true,
        counts_towards_motion_readiness: true,
      })),
    },
  });
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `hades-steam-hls-${index + 1}`,
    type: "motion_clip",
    source_family: `steam_1145350_${index + 1}`,
    path: `https://video.akamai.steamstatic.com/store_trailers/1145350/${index + 1}/hash/hls_264_master.m3u8?t=171502170${index}`,
    source_url: `https://video.akamai.steamstatic.com/store_trailers/1145350/${index + 1}/hash/hls_264_master.m3u8?t=171502170${index}`,
    source_kind: "hls_manifest",
    source_url_kind: "hls_manifest",
    source_type: "steam_movie",
    provider: "steam",
    entity: "Hades II",
    mediaStartS: 12 + index,
    durationS: 5,
    validated: true,
    segmentValidationPassed: true,
    trusted_source_matched: false,
    rights_risk_class: "official_reference_only",
  }));
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips,
  });

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-05-23T16:00:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 5);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.args[call.args.indexOf("-i") + 1].includes("video.akamai.steamstatic.com")));

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 5);
  assert.ok(materialised.clips.every((clip) => clip.media_kind === "direct_video"));

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_inventory.production_motion_clips.length, 5);
  assert.ok(footage.motion_inventory.production_motion_clips.every((clip) => clip.source_type === "steam_movie"));

  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.verdict, "pass");
  assert.equal(rights.records.length, 5);
  assert.ok(rights.records.every((record) => record.source_url.includes("video.akamai.steamstatic.com")));
});

test("real motion materializer restores package evidence from an already materialized central motion pack", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-central-restore-"));
  const storyId = "sf6-central-restore";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const videoCache = path.join(root, "output", "video_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(videoCache);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
    },
  });

  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1364780/164062000/hash/hls_264_master.m3u8?t=1782095041";
  const clips = Array.from({ length: 6 }, (_, index) => {
    const clipPath = path.join(videoCache, `${storyId}-clip-${index + 1}.mp4`);
    fs.writeFileSync(clipPath, Buffer.alloc(4096, index + 1));
    return {
      id: `sf6-window-${index + 1}`,
      type: "motion_clip",
      source_family: `steam_1364780_164062000_window_${index + 1}`,
      motion_family: `steam_1364780_164062000_window_${index + 1}`,
      path: clipPath,
      local_materialized_path: clipPath,
      source_url: sourceUrl,
      source_kind: "hls_manifest",
      source_url_kind: "hls_manifest",
      source_type: "steam_movie",
      provider: "steam",
      entity: "Street Fighter 6",
      mediaStartS: 36 + index * 3,
      durationS: 3,
      media_kind: "direct_video",
      materialized: true,
      counts_towards_motion_readiness: true,
      validated: true,
      segmentValidationPassed: true,
      trusted_source_matched: false,
      rights_basis: "official_direct_media",
      rights_risk_class: "official_reference_only",
      provenance: {
        source: "official_trailer_segment_validation",
        validation_reason: "official_storefront_trailer_motion_samples_passed",
        segment_validated: true,
        allowed_for_flash_lane: true,
      },
    };
  });
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    source: "validated_real_motion_materializer",
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips,
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        title: "Street Fighter 6 Yasmine Gameplay Reveal",
        artifact_dir: artifactDir,
        status: "blocked_on_render_inputs",
        blockers: ["materialised_motion_clips_missing"],
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-06-23T18:20:00.000Z",
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 6);
  assert.equal(report.jobs[0].repair_scope, "central_materialized_motion_restore");
  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 6);
  assert.equal(materialised.clips.every((clip) => clip.media_kind === "direct_video"), true);
  const familyReport = await fs.readJson(path.join(artifactDir, "distinct_motion_family_report.json"));
  assert.equal(familyReport.status, "ready");
  assert.equal(familyReport.summary.clip_count, 6);
});

test("real motion materializer blocks one official trailer from masquerading as many direct-video windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-window-floor-"));
  const storyId = "subnautica-window-floor";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1962700/1381761660/hash/hls_264_master.m3u8?t=1778770818";
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    assets: [
      {
        id: "subnautica-official-steam-window",
        type: "motion_clip",
        source_family: "steam_1962700_1381761660",
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: "hls_manifest",
        source_url_kind: "hls_manifest",
        source_type: "steam_movie",
        provider: "steam",
        entity: "Subnautica 2",
        mediaStartS: 0,
        durationS: 3,
        validated: true,
        segmentValidationPassed: true,
        trusted_source_matched: false,
        rights_risk_class: "official_reference_only",
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 4 }, (_, index) => ({
        id: `existing-still-${index + 1}`,
        path: path.join(artifactDir, `existing-still-${index + 1}.mp4`),
        source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1962700/ss_${index + 1}.jpg`,
        source_family: `steam_screenshot_1962700_${index + 1}`,
        media_kind: "visual_still",
        source_type: "steam_screenshot",
        durationS: 3,
        mediaStartS: 0,
        materialized: true,
        counts_towards_motion_readiness: true,
      })),
    },
  });

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          title: "Subnautica 2 Reportedly Leaked Early",
          artifact_dir: artifactDir,
          status: "blocked_on_render_inputs",
          blockers: ["direct_video_motion_clip_floor_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["direct_video_motion_clip_floor_not_met"],
              evidence: {
                direct_video_motion_clip_floor: 5,
              },
            },
          ],
        },
      ],
    },
    minClips: 5,
    generatedAt: "2026-05-29T02:05:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls.map((call) => call.args[call.args.indexOf("-ss") + 1]), [
    "0",
  ]);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 1);
  assert.ok(report.jobs[0].blockers.includes("direct_video_motion_clip_floor_not_met"));

  assert.equal(await fs.pathExists(path.join(artifactDir, "materialised_motion_clips.json")), false);
  const partial = await fs.readJson(path.join(artifactDir, "partial_real_motion_evidence.json"));
  assert.equal(partial.clip_count, 1);
  assert.equal(partial.direct_video_motion_asset_count, 1);
  assert.equal(partial.direct_video_motion_family_count, 1);
  assert.equal(partial.clips[0].counts_towards_motion_readiness, false);
});

test("real motion materializer blocks instead of padding with repeated official base-source windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-multi-source-windows-"));
  const storyId = "multi-official-window-story";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrls = [
    "https://video.fastly.steamstatic.com/store_trailers/100/111/hash-a/hls_264_master.m3u8?t=1780000001",
    "https://video.fastly.steamstatic.com/store_trailers/100/222/hash-b/hls_264_master.m3u8?t=1780000002",
    "https://video.fastly.steamstatic.com/store_trailers/100/333/hash-c/hls_264_master.m3u8?t=1780000003",
  ];
  const segmentValidationReport = {
    segments: sourceUrls.flatMap((sourceUrl, sourceIndex) =>
      [0, 1].map((windowIndex) => ({
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 88,
        source_url: sourceUrl,
        source_type: "official_platform_product_page",
        source_url_kind: "hls_manifest",
        provider: "licensed_direct_media_acquisition",
        entity: "GTA VI",
        source_family: `gta_vi_official_source_${sourceIndex + 1}`,
        media_start_s: 12 + sourceIndex * 18 + windowIndex * 6,
        duration_s: 5,
        source_duration_s: 90,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
      })),
    ),
  };

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["visual_evidence:direct_video_motion_missing"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["visual_evidence:direct_video_motion_missing"],
              evidence: { direct_video_motion_clip_floor: 5 },
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    minClips: 5,
    maxClips: 5,
    generatedAt: "2026-06-26T02:10:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].materialized_count, 3);
  assert.equal(report.jobs[0].distinct_motion_family_count, 3);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 3);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 3);
  assert.deepEqual(
    report.jobs[0].direct_motion_base_source_clip_counts.map((entry) => entry.count).sort((a, b) => b - a),
    [1, 1, 1],
  );
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 3);
  assert.equal(calls.length, 3);

  assert.equal(await fs.pathExists(path.join(artifactDir, "materialised_motion_clips.json")), false);
  const partial = await fs.readJson(path.join(artifactDir, "partial_real_motion_evidence.json"));
  assert.equal(partial.clip_count, 3);
  assert.equal(partial.direct_video_motion_family_count, 3);
  assert.equal(new Set(partial.clips.map((clip) => clip.base_source_family)).size, 3);
});

test("real motion materializer blocks eight-clip floors when only three official base sources exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-eight-official-windows-"));
  const storyId = "gta-vi-official-window-floor";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrls = [
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_1/GTAVI_Trailer_1.mp4",
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
  ];
  const segmentValidationReport = {
    segments: sourceUrls.flatMap((sourceUrl, sourceIndex) =>
      [0, 1, 2, 3].map((windowIndex) => ({
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 88,
        source_url: sourceUrl,
        source_type: "official_game_website_media_page",
        source_url_kind: "direct_video",
        provider: "licensed_direct_media_acquisition",
        entity: "Grand Theft Auto VI",
        source_family: `rockstar_gtavi_source_${sourceIndex + 1}_window_${windowIndex + 1}`,
        media_start_s: 12 + sourceIndex * 20 + windowIndex * 6,
        duration_s: 5,
        source_duration_s: 160,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
      })),
    ),
  };

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["direct_video_motion_clip_floor_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["direct_video_motion_clip_floor_not_met"],
              evidence: { direct_video_motion_clip_floor: 8 },
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    minClips: 8,
    maxClips: 8,
    generatedAt: "2026-06-26T02:30:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].materialized_count, 3);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 3);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 3);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 1);
  assert.deepEqual(
    report.jobs[0].direct_motion_base_source_clip_counts.map((entry) => entry.count).sort((a, b) => b - a),
    [1, 1, 1],
  );
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 9);
  assert.equal(report.jobs[0].skipped_duplicate_direct_window_count, 0);
  assert.equal(calls.length, 3);
});

test("real motion materializer blocks uneven official-window sets instead of overusing one source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-uneven-official-windows-"));
  const storyId = "gta-vi-uneven-official-window-floor";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrls = [
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_1/GTAVI_Trailer_1.mp4",
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Trailer_2/GTAVI_Trailer_2.mp4",
    "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
  ];
  const windowsBySource = [3, 8, 1];
  const segmentValidationReport = {
    segments: sourceUrls.flatMap((sourceUrl, sourceIndex) =>
      Array.from({ length: windowsBySource[sourceIndex] }, (_, windowIndex) => ({
        story_id: storyId,
        status: "validated",
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        segment_motion_class: "gameplay_action",
        action_score: 88,
        source_url: sourceUrl,
        source_type: "official_game_website_media_page",
        source_url_kind: "direct_video",
        provider: "licensed_direct_media_acquisition",
        entity: "Grand Theft Auto VI",
        source_family: `rockstar_gtavi_source_${sourceIndex + 1}_window_${windowIndex + 1}`,
        media_start_s: 12 + sourceIndex * 20 + windowIndex * 6,
        duration_s: 5,
        source_duration_s: 170,
        rights_risk_class: "official_direct_media",
        allowed_render_use: "official_direct_media_segment_candidate",
      })),
    ),
  };

  const calls = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["real_motion_clip_minimum_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["real_motion_clip_minimum_not_met"],
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    minClips: 8,
    maxClips: 8,
    generatedAt: "2026-06-26T02:55:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, calls.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.jobs[0].materialized_count, 3);
  assert.equal(report.jobs[0].max_direct_motion_clips_per_base_source, 1);
  assert.deepEqual(
    report.jobs[0].direct_motion_base_source_clip_counts.map((entry) => entry.count).sort((a, b) => b - a),
    [1, 1, 1],
  );
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 9);
  assert.equal(calls.length, 3);
});

test("real motion materializer samples before a late official trailer window when forward windows fail", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-late-window-"));
  const storyId = "late-official-trailer-window";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/2075800/876175/hash/hls_264_master.m3u8?t=1745411378";
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: { status: "v4_motion_blocked", blockers: ["direct_video_motion_clip_floor_not_met"] },
    clips: [
      {
        id: "late-steam-trailer-window",
        type: "motion_clip",
        source_family: "steam_2075800_876175",
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: "hls_manifest",
        source_url_kind: "hls_manifest",
        source_type: "steam_movie",
        provider: "steam",
        entity: "Star Wars Zero Company",
        mediaStartS: 120,
        durationS: 5,
        validated: true,
        segmentValidationPassed: true,
        trusted_source_matched: false,
        rights_risk_class: "official_reference_only",
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 4 }, (_, index) => ({
        id: `existing-still-${index + 1}`,
        path: path.join(artifactDir, `existing-still-${index + 1}.mp4`),
        source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2075800/ss_${index + 1}.jpg`,
        source_family: `steam_screenshot_2075800_${index + 1}`,
        media_kind: "visual_still",
        source_type: "steam_screenshot",
        durationS: 3,
        mediaStartS: 0,
        materialized: true,
        counts_towards_motion_readiness: true,
      })),
    },
  });

  const starts = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          status: "blocked_on_render_inputs",
          blockers: ["direct_video_motion_clip_floor_not_met"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["direct_video_motion_clip_floor_not_met"],
              evidence: { direct_video_motion_clip_floor: 5 },
            },
          ],
        },
      ],
    },
    minClips: 5,
    maxClips: 8,
    generatedAt: "2026-05-29T02:20:00.000Z",
    execFileSync: (bin, args) => {
      const start = Number(args[args.indexOf("-ss") + 1]);
      starts.push(start);
      if (start > 131) return;
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, Math.max(1, Math.round(start))));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.ok(report.jobs[0].blockers.includes("direct_video_motion_clip_floor_not_met"));
  assert.deepEqual(starts, [120]);
});

test("real motion materializer includes pending original direct candidates while expanding the direct-video floor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-pending-original-"));
  const storyId = "pending-original-direct-window";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const sourceUrl =
    "https://video.akamai.steamstatic.com/store_trailers/4078430/1546933311/hash/hls_264_master.m3u8";
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: { status: "v4_motion_blocked", blockers: ["direct_video_motion_clip_floor_not_met"] },
    clips: [
      {
        id: "official-window-a",
        type: "motion_clip",
        source_family: "steam_4078430_1546933311",
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: "hls_manifest",
        source_url_kind: "hls_manifest",
        source_type: "igdb_video",
        provider: "steam",
        mediaStartS: 42,
        durationS: 5,
        validated: true,
        segmentValidationPassed: true,
      },
      {
        id: "official-window-b",
        type: "motion_clip",
        source_family: "steam_4078430_1546933311",
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: "hls_manifest",
        source_url_kind: "hls_manifest",
        source_type: "igdb_video",
        provider: "steam",
        mediaStartS: 52,
        durationS: 5,
        validated: true,
        segmentValidationPassed: true,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", records: [] });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 4 }, (_, index) => ({
        id: `existing-still-${index + 1}`,
        path: path.join(artifactDir, `existing-still-${index + 1}.mp4`),
        source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4078430/ss_${index + 1}.jpg`,
        source_family: `steam_screenshot_4078430_${index + 1}`,
        media_kind: "visual_still",
        source_type: "steam_screenshot",
        durationS: 3,
        materialized: true,
      })),
    },
  });

  const starts = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["direct_video_motion_clip_floor_not_met"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["direct_video_motion_clip_floor_not_met"],
          evidence: { direct_video_motion_clip_floor: 5 },
        }],
      }],
    },
    minClips: 5,
    generatedAt: "2026-05-29T02:45:00.000Z",
    execFileSync: (bin, args) => {
      const start = Number(args[args.indexOf("-ss") + 1]);
      starts.push(start);
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, Math.max(1, Math.round(start))));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.ok(report.jobs[0].blockers.includes("direct_video_motion_clip_floor_not_met"));
  assert.deepEqual(starts, [42]);
});

test("real motion materializer expands official product-page direct MP4 windows", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-product-page-"));
  const storyId = "official-product-page-direct-window";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const sourceUrl = "https://assets.xboxservices.com/assets/example-controller-product-page.mp4";
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: { status: "v4_motion_blocked", blockers: ["direct_video_motion_clip_floor_not_met"] },
    clips: [
      {
        id: "xbox-product-page-window",
        type: "motion_clip",
        source_family: "xbox_controller_product_page",
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: "direct_video",
        source_url_kind: "direct_video",
        source_type: "official_platform_product_page",
        provider: "xbox",
        mediaStartS: 4,
        durationS: 5,
        validated: true,
        segmentValidationPassed: true,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", records: [] });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: Array.from({ length: 4 }, (_, index) => ({
        id: `existing-still-${index + 1}`,
        path: path.join(artifactDir, `existing-still-${index + 1}.mp4`),
        source_url: `https://assets.xboxservices.com/assets/controller-still-${index + 1}.jpg`,
        source_family: `xbox_controller_still_${index + 1}`,
        media_kind: "visual_still",
        source_type: "official_press_kit_stills",
        durationS: 3,
        materialized: true,
      })),
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["direct_video_motion_clip_floor_not_met"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["direct_video_motion_clip_floor_not_met"],
          evidence: { direct_video_motion_clip_floor: 3 },
        }],
      }],
    },
    minClips: 5,
    generatedAt: "2026-05-29T03:00:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 7));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 2);
  assert.ok(report.jobs[0].blockers.includes("direct_video_motion_clip_floor_not_met"));
});

test("real motion materializer does not re-count its own materialized rights records as fresh candidates", async () => {
  const directUrl = "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/good.mp4?tag=14";
  const rows = candidateRows({
    rightsLedger: {
      assets: [
        {
          id: "official-source-window",
          path: directUrl,
          source_url: directUrl,
          source_family: "official_forza_gameplay",
          source_kind: "direct_video",
          mediaStartS: 12.25,
          durationS: 2.85,
          segmentValidationPassed: true,
          trusted_source_matched: true,
        },
      ],
      records: [
        {
          asset_id: "materialised_official-source-window",
          kind: "video",
          path: path.join("output", "video_cache", "story_v4_clip_1.mp4"),
          source_url: directUrl,
          source_family: "official_forza_gameplay",
          source_type: "validated_direct_media",
          approval_status: "approved_for_transformative_editorial_use",
          transformation_notes: "Trimmed into a short, source-labelled Pulse Gaming editorial motion beat for a governed V4 render.",
        },
      ],
      matched_assets: [
        {
          asset_id: "materialised_official-source-window",
          kind: "video",
          path: path.join("output", "video_cache", "story_v4_clip_1.mp4"),
          source_url: directUrl,
          source_family: "official_forza_gameplay",
          materialized: true,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "official-source-window");
  assert.equal(rows[0].mediaStartS, 12.25);
});

test("real motion materializer writes local clips, motion manifests and explicit rights records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-"));
  const job = await makePackage(root);
  const calls = [];

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-23T08:10:00.000Z",
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 3));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 5);
  assert.equal(calls.length, 5);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);

  const materialised = await fs.readJson(path.join(job.artifact_dir, "materialised_motion_clips.json"));
  assert.equal(materialised.status, "ready");
  assert.equal(materialised.clip_count, 5);
  assert.equal(materialised.distinct_motion_family_count, 5);
  assert.ok(materialised.clips.every((clip) => clip.path.includes(`${job.story_id}_v4_clip_`)));

  const ownedMotion = await fs.readJson(path.join(job.artifact_dir, "owned_motion_manifest.json"));
  assert.equal(ownedMotion.status, "ready");
  assert.match(ownedMotion.note, /Real source motion clips/);

  const rights = await fs.readJson(path.join(job.artifact_dir, "rights_ledger.json"));
  assert.equal(rights.verdict, "pass");
  assert.equal(rights.failures.length, 0);
  assert.equal(rights.records.length, 5);
  assert.ok(rights.records.every((record) => record.allowed_platforms.includes("tiktok")));
  assert.ok(rights.records.every((record) => record.source_url.startsWith("https://video.twimg.com/")));

  const footage = await fs.readJson(path.join(job.artifact_dir, "footage_inventory.json"));
  assert.equal(footage.motion_inventory.accepted_local_clips.length, 5);
});

test("real motion materializer blocks repeated validated official segments when the rights ledger is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-segment-rights-"));
  const job = await makePackage(root, "hellraiser-segment-motion");
  await fs.remove(path.join(job.artifact_dir, "rights_ledger.json"));
  const calls = [];
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: job.story_id,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_url:
        "https://video.fastly.steamstatic.com/store_trailers/1551980/965080935/hash/hls_264_master.m3u8",
      source_url_kind: "hls_manifest",
      source_type: "licensed_direct_media_url",
      source_family: "steam_1551980_clive_barker_s_hellraiser_revival",
      provider: "official_intake",
      entity: "Hellraiser: Revival",
      media_start_s: 36 + index * 4,
      duration_s: 5,
      source_duration_s: 81.7,
      validation_reason: "official_storefront_cinematic_motion_samples_passed",
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-06-22T01:20:00.000Z",
    segmentValidationReport,
    execFileSync: (bin, args) => {
      calls.push({ bin, args });
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 0);
  assert.equal(report.jobs[0].materialized_count, 1);
  assert.equal(report.jobs[0].distinct_motion_family_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.ok(report.jobs[0].blockers.includes("real_motion_family_minimum_not_met"));
  assert.equal(calls.length, 1);

  const partial = await fs.readJson(path.join(job.artifact_dir, "partial_real_motion_evidence.json"));
  assert.equal(partial.status, "blocked");
  assert.equal(partial.clip_count, 1);
  assert.equal(partial.distinct_motion_family_count, 1);
  assert.equal(partial.direct_video_motion_family_count, 1);
  assert.equal(await fs.pathExists(path.join(job.artifact_dir, "materialised_motion_clips.json")), false);
});

test("real motion materializer turns rights-recorded screenshots into motion clips", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-stills-"));
  const storyId = "steam-still-motion";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const imageDir = path.join(root, "output", "image_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(imageDir);
  const assets = [];
  for (let index = 0; index < 5; index += 1) {
    const imagePath = path.join(imageDir, `${storyId}_${index + 1}.jpg`);
    await fs.writeFile(imagePath, Buffer.alloc(2048, index + 1));
    assets.push({
      asset_id: `${storyId}-screenshot-${index + 1}`,
      kind: "visual",
      asset_type: "visual",
      source_type: "steam_screenshot",
      source_family: `steam_screenshot_${index + 1}`,
      path: imagePath,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/ss_${index + 1}.jpg`,
      commercial_use_allowed: true,
      risk_score: 0.2,
    });
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "fail",
    failures: ["rights:no_rights_record"],
    assets,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {},
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-05-23T08:30:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 5));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 5);
  assert.equal(report.summary.screenshot_derived_motion_clip_count, 5);
  assert.equal(report.safety.direct_media_only, false);
  assert.equal(report.safety.direct_video_or_screenshot_derived_only, true);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 5);
  assert.equal(materialised.distinct_motion_family_count, 5);
  assert.ok(materialised.clips.every((clip) => clip.media_kind === "visual_still"));

  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.equal(rights.verdict, "pass");
  assert.ok(rights.records.every((record) => record.asset_type === "screenshot_derived_motion_clip"));
});

test("real motion materializer accepts official stills with extensionless CDN source URLs when a local file exists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-official-stills-"));
  const localStill = path.join(root, "official-stills", "mega_mewtwo_x.jpg");
  await fs.outputFile(localStill, Buffer.alloc(2048, 4));
  const sourceUrl = "https://lh3.googleusercontent.com/example-image%3Ds0-e365";

  const rows = candidateRows({
    rightsLedger: {
      assets: [
        {
          asset_id: "pokemon-go-mega-mewtwo-official-still",
          asset_type: "visual_still",
          source_type: "official_press_kit_stills",
          source_family: "pokemon_go_mega_mewtwo_x",
          path: localStill,
          source_url: sourceUrl,
          approval_status: "approved_for_transformative_editorial_use",
          commercial_use_allowed: true,
          risk_score: 0.28,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].media_kind, "visual_still");
  assert.equal(rows[0].path, localStill);
  assert.equal(rows[0].source_url, sourceUrl);
});

test("real motion materializer does not satisfy direct-video repair with screenshot-only motion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-direct-block-"));
  const storyId = "direct-video-required";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const imageDir = path.join(root, "output", "image_cache");
  await fs.ensureDir(artifactDir);
  await fs.ensureDir(imageDir);
  const assets = [];
  for (let index = 0; index < 5; index += 1) {
    const imagePath = path.join(imageDir, `${storyId}_${index + 1}.jpg`);
    await fs.writeFile(imagePath, Buffer.alloc(2048, index + 1));
    assets.push({
      asset_id: `${storyId}-screenshot-${index + 1}`,
      kind: "visual",
      asset_type: "visual",
      source_type: "steam_screenshot",
      source_family: `steam_screenshot_${index + 1}`,
      path: imagePath,
      source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/123/ss_${index + 1}.jpg`,
      commercial_use_allowed: true,
      risk_score: 0.2,
    });
  }
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { verdict: "pass", assets });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), { story_id: storyId, motion_inventory: {} });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["visual_evidence:direct_video_motion_missing"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["visual_evidence:direct_video_motion_missing"],
        }],
      }],
    },
    generatedAt: "2026-05-23T16:25:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 5));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 3 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.summary.materialized_clip_count, 0);
  assert.equal(report.summary.attempted_materialized_clip_count, 5);
  assert.ok(report.jobs[0].blockers.includes("direct_video_motion_clip_missing"));
  assert.equal(await fs.pathExists(path.join(artifactDir, "materialised_motion_clips.json")), false);
});

test("real motion materializer can repair only the direct-video gap without discarding existing motion families", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-direct-only-"));
  const storyId = "steam-controller-direct-gap";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  const existingClips = Array.from({ length: 4 }, (_, index) => ({
    id: `owned-motion-${index + 1}`,
    path: path.join(root, "output", "owned-motion", `${storyId}-${index + 1}.mp4`),
    source_url: `generated://owned-motion/${storyId}/${index + 1}`,
    source_family: `owned_graphics_family_${index + 1}`,
    motion_family: `owned_graphics_family_${index + 1}`,
    source_type: "owned_generated_motion",
    media_kind: "owned_motion",
    durationS: 3,
    mediaStartS: 0,
    validated: true,
    materialized: true,
  }));
  existingClips.push({
    id: "stale-direct-motion",
    path: path.join(root, "output", "video_cache", `${storyId}_old_collision.mp4`),
    source_url: "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/hls_264_master.m3u8?t=1470853282",
    source_family: "steam_353370_37301",
    motion_family: "steam_353370_37301",
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    durationS: 5,
    mediaStartS: 36,
    validated: true,
    materialized: true,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: existingClips,
      production_motion_clips: existingClips,
      distinct_source_families: existingClips.map((clip) => clip.source_family),
    },
  });
  const directUrl =
    "https://video.fastly.steamstatic.com/store_trailers/353370/37301/hash/hls_264_master.m3u8?t=1470853282";
  await fs.outputJson(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`), {
    story_id: storyId,
    readiness: {
      status: "v4_motion_blocked",
      blockers: ["distinct_motion_families_minimum_not_met"],
    },
    clips: [
      {
        id: "steam-controller-direct-window",
        type: "motion_clip",
        source_family: "steam_353370_37301",
        path: directUrl,
        source_url: directUrl,
        source_kind: "hls_manifest",
        source_url_kind: "hls_manifest",
        source_type: "official_platform_product_page",
        provider: "steam",
        entity: "Steam Controller",
        mediaStartS: 36,
        durationS: 5,
        validated: true,
        segmentValidationPassed: true,
        trusted_source_matched: false,
        rights_risk_class: "official_reference_only",
        allowed_render_use: "reference_only_by_default",
        provenance: {
          source_report: "official_trailer_segment_validation",
          validation_reason: "official_product_motion_samples_passed",
        },
      },
    ],
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["visual_evidence:direct_video_motion_missing"],
        evidence: {
          file_evidence: {
            materialised_motion_ready: true,
            distinct_motion_families_ready: true,
            materialised_motion_clip_count: 5,
            distinct_motion_family_count: 5,
          },
        },
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["visual_evidence:direct_video_motion_missing"],
        }],
      }],
    },
    generatedAt: "2026-05-26T20:00:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 6));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.summary.blocked_story_count, 0);
  assert.equal(report.jobs[0].repair_scope, "direct_video_gap_only");
  assert.equal(report.jobs[0].materialized_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 1);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.clip_count, 5);
  assert.equal(materialised.distinct_motion_family_count, 5);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "direct_video").length, 1);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "owned_motion").length, 4);
  assert.ok(materialised.clips.every((clip) => !clip.path.includes("old_collision")));

  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_inventory.production_motion_clips.length, 5);
  assert.equal(footage.motion_inventory.direct_video_motion_asset_count, 1);
});

test("real motion materializer can use validated segment reports to repair a direct-video gap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-segment-report-"));
  const storyId = "pokemon-segment-direct-gap";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  const existingClips = Array.from({ length: 4 }, (_, index) => ({
    id: `owned-motion-${index + 1}`,
    path: path.join(root, "output", "owned-motion", `${storyId}-${index + 1}.mp4`),
    source_url: `generated://owned-motion/${storyId}/${index + 1}`,
    source_family: `owned_graphics_family_${index + 1}`,
    motion_family: `owned_graphics_family_${index + 1}`,
    source_type: "owned_generated_motion",
    media_kind: "owned_motion",
    durationS: 3,
    mediaStartS: 0,
    validated: true,
    materialized: true,
  }));
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: existingClips,
      production_motion_clips: existingClips,
      distinct_source_families: existingClips.map((clip) => clip.source_family),
    },
  });
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "short_direct_media_detail_motion_samples_passed",
      source_url:
        `https://fserveu20221222.blob.core.windows.net/files/Pokemon/2016/11/clip-${index + 1}.mp4?sv=2026-02-06`,
      source_type: "licensed_direct_media_url",
      source_url_kind: "direct_video",
      provider: "licensed_direct_media_acquisition",
      entity: "Pokemon Go",
      source_family: `pokemon_go_official_direct_${index + 1}`,
      media_start_s: 4 + index * 2,
      duration_s: 5,
      source_duration_s: 42,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
      provenance: {
        source: "official_trailer_segment_validator",
      },
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        blockers: ["visual_evidence:direct_video_motion_missing"],
        actions: [{
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["visual_evidence:direct_video_motion_missing"],
        }],
      }],
    },
    segmentValidationReport,
    generatedAt: "2026-05-27T16:40:00.000Z",
    maxClips: 5,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 6));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.jobs[0].repair_scope, "direct_video_gap_only");
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 5);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 5);

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.direct_video_motion_asset_count, 5);
  assert.equal(materialised.direct_video_motion_family_count, 5);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "direct_video").length, 5);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "owned_motion").length, 4);
});

test("real motion materializer can synthesize jobs from segment reports and an artifact root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-segment-artifact-root-"));
  const storyId = "fresh-refill-yooka";
  const artifactRoot = path.join(root, "output", "candidate-supply", "fresh-refill", "goal-proof-batch");
  const artifactDir = path.join(artifactRoot, storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "segment_samples_passed",
      segment_motion_class: "gameplay_action",
      action_score: 82 + index,
      source_url:
        `https://video.fastly.steamstatic.com/store_trailers/3348210/${1321458709 + index}/hash/hls_264_master.m3u8`,
      source_type: "platform_storefront",
      source_url_kind: "hls_manifest",
      provider: "official_intake",
      entity: "Super Yooka-Laylee Kart",
      source_family: `steam_3348210_super_yooka_laylee_kart_${index + 1}`,
      media_start_s: 36 + index * 6,
      duration_s: 5,
      source_duration_s: 72,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
      provenance: {
        source: "official_trailer_segment_validation",
      },
    })),
  };

  const starts = [];
  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [] },
    storyIds: [storyId],
    artifactRoot,
    segmentValidationReport,
    minClips: 5,
    minFamilies: 1,
    maxClips: 5,
    generatedAt: "2026-06-21T23:30:00.000Z",
    execFileSync: (bin, args) => {
      starts.push(args[args.indexOf("-ss") + 1]);
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, starts.length));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.materialized_story_count, 1);
  assert.equal(report.jobs[0].story_id, storyId);
  assert.equal(report.jobs[0].artifact_dir, artifactDir);
  assert.equal(report.jobs[0].direct_video_motion_clip_count, 5);
  assert.equal(
    await fs.pathExists(path.join(root, "output", "studio-v4", "motion-packs", `${storyId}_motion_pack_manifest.json`)),
    true,
  );
  assert.deepEqual(starts, ["36", "42", "48", "54", "60"]);
});

test("real motion materializer blocks repeated windows from one direct video source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-segment-window-families-"));
  const storyId = "granblue-official-window-families";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const sourceUrl =
    "https://vulcan.dl.playstation.net/img/rnd/202606/1802/granblue-relink-demo.mp4";
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "segment_samples_passed",
      segment_motion_class: "gameplay_action",
      action_score: 82,
      source_url: sourceUrl,
      source_type: "official_game_site_news_page",
      source_url_kind: "direct_video",
      provider: "official_intake",
      entity: "Granblue Fantasy: Relink",
      source_family: "playstation_blog_granblue_relink_demo",
      media_start_s: 36 + index * 6,
      duration_s: 5,
      source_duration_s: 104.92,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
      provenance: {
        source: "official_trailer_segment_validator",
      },
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["visual_evidence:direct_video_motion_missing"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["visual_evidence:direct_video_motion_missing"],
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    generatedAt: "2026-06-20T09:45:00.000Z",
    maxClips: 5,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].materialized_count, 1);
  assert.equal(report.jobs[0].distinct_motion_family_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.ok(report.jobs[0].blockers.includes("real_motion_family_minimum_not_met"));
  assert.equal(await fs.pathExists(path.join(artifactDir, "materialised_motion_clips.json")), false);

  const partial = await fs.readJson(path.join(artifactDir, "partial_real_motion_evidence.json"));
  assert.equal(partial.status, "blocked");
  assert.equal(partial.not_publishable, true);
  assert.equal(partial.clip_count, 1);
  assert.equal(partial.distinct_motion_family_count, 1);
  assert.equal(partial.direct_video_motion_family_count, 1);
  assert.equal(partial.clips.length, 1);
  assert.match(partial.clips[0].base_source_family, /^url:https:\/\/vulcan\.dl\.playstation\.net\/img\/rnd\/202606\/1802\/granblue-relink-demo\.mp4$/);
  assert.equal(partial.clips[0].provenance?.base_source_family, partial.clips[0].base_source_family);
});

test("real motion materializer treats Steam HLS and DASH variants from one trailer as one source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-steam-variant-families-"));
  const storyId = "steam-variant-family";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    motion_inventory: {
      accepted_local_clips: [],
      production_motion_clips: [],
      distinct_source_families: [],
    },
  });
  const base =
    "https://video.fastly.steamstatic.com/store_trailers/3483510/632943268/ab5efa5d538a2c90f09927047b2df6199cf5e9d6/1780277626";
  const urls = [
    `${base}/hls_264_master.m3u8?t=1781798240`,
    `${base}/dash_av1.mpd?t=1781798240`,
    `${base}/dash_h264.mpd?t=1781798240`,
    `${base}/hls_264_master.m3u8?t=1781798240`,
    `${base}/dash_av1.mpd?t=1781798240`,
  ];
  const segmentValidationReport = {
    segments: urls.map((sourceUrl, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "segment_samples_passed",
      segment_motion_class: "gameplay_action",
      action_score: 88,
      source_url: sourceUrl,
      source_type: "official_platform_product_page",
      source_url_kind: sourceUrl.includes("hls_") ? "hls_manifest" : "dash_manifest",
      provider: "licensed_direct_media_acquisition",
      entity: "The Adventures Of Elliot",
      source_family: `steam_3483510_elliot_variant_${index + 1}`,
      media_start_s: 36 + index * 6,
      duration_s: 5,
      source_duration_s: 130,
      rights_risk_class: "official_direct_media",
      allowed_render_use: "official_direct_media_segment_candidate",
      provenance: {
        source: "official_trailer_segment_validator",
      },
    })),
  };

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: ["visual_evidence:direct_video_motion_missing"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              reason_codes: ["visual_evidence:direct_video_motion_missing"],
            },
          ],
        },
      ],
    },
    segmentValidationReport,
    generatedAt: "2026-06-25T01:05:00.000Z",
    maxClips: 5,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 8));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.jobs[0].materialized_count, 1);
  assert.equal(report.jobs[0].distinct_motion_family_count, 1);
  assert.equal(report.jobs[0].direct_video_motion_family_count, 1);
  assert.equal(report.jobs[0].skipped_duplicate_base_source_count, 4);
  assert.ok(report.jobs[0].blockers.includes("real_motion_family_minimum_not_met"));

  const partial = await fs.readJson(path.join(artifactDir, "partial_real_motion_evidence.json"));
  assert.equal(partial.direct_video_motion_family_count, 1);
  assert.match(
    partial.clips[0].base_source_family,
    /^steamstatic:\/store_trailers\/3483510\/632943268\/ab5efa5d538a2c90f09927047b2df6199cf5e9d6\/1780277626$/,
  );
});

test("real motion materializer reconciles stale owned-motion distinct family budgets after real media repair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-budget-reconcile-"));
  const storyId = "pokemon-budget-reconcile";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.ensureDir(artifactDir);
  const assets = Array.from({ length: 6 }, (_, index) => ({
    id: `${storyId}-direct-${index + 1}`,
    type: "motion_clip",
    kind: "video",
    source_family: `pokemon_go_official_family_${index + 1}`,
    path: `https://fserveu20221222.blob.core.windows.net/files/Pokemon/2016/11/clip-${index + 1}.mp4?sv=2026-02-06`,
    source_url: `https://fserveu20221222.blob.core.windows.net/files/Pokemon/2016/11/clip-${index + 1}.mp4?sv=2026-02-06`,
    source_kind: "direct_video",
    source_url_kind: "direct_video",
    source_type: "licensed_direct_media_url",
    entity: "Pokemon Go",
    mediaStartS: 4 + index * 2,
    durationS: 5,
    validated: true,
    segmentValidationPassed: true,
    trusted_source_matched: true,
    rights_risk_class: "official_direct_media",
    allowed_render_use: "official_direct_media_segment_candidate",
  }));
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    verdict: "pass",
    records: [],
    assets,
  });
  await fs.outputJson(path.join(artifactDir, "footage_inventory.json"), {
    story_id: storyId,
    readiness: {
      status: "v4_motion_blocked",
      blockers: [
        "actual_motion_clip_minimum_not_met",
        "distinct_motion_families_minimum_not_met",
        "no_trusted_footage_references_for_story",
      ],
      warnings: [],
    },
    motion_budget: {
      required_motion_scenes: 6,
      available_motion_clips: 0,
      required_distinct_families: 9,
      available_distinct_families: 0,
      steam_metric_story: false,
      review_score_story: false,
      owned_explainer_visual_plan: true,
    },
    motion_inventory: {
      accepted_local_clips: [],
    },
  });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: {
      jobs: [{
        story_id: storyId,
        artifact_dir: artifactDir,
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      }],
    },
    generatedAt: "2026-05-28T13:10:00.000Z",
    maxClips: 6,
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 6));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 5 : null),
  });

  assert.equal(report.summary.materialized_story_count, 1);
  const footage = await fs.readJson(path.join(artifactDir, "footage_inventory.json"));
  assert.equal(footage.motion_budget.required_motion_scenes, 6);
  assert.equal(footage.motion_budget.available_motion_clips, 6);
  assert.equal(footage.motion_budget.required_distinct_families, 6);
  assert.equal(footage.motion_budget.available_distinct_families, 6);
  assert.equal(footage.readiness.status, "v4_motion_ready");
  assert.deepEqual(footage.readiness.blockers, []);
});

test("real motion materializer refuses to mark a story ready below motion thresholds", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-block-"));
  const job = await makePackage(root, "under-threshold");
  const rightsPath = path.join(job.artifact_dir, "rights_ledger.json");
  const rights = await fs.readJson(rightsPath);
  rights.assets = rights.assets.slice(0, 2);
  await fs.writeJson(rightsPath, rights, { spaces: 2 });

  const report = await materializeGoalRealMotion({
    root,
    workOrder: { jobs: [job] },
    generatedAt: "2026-05-23T08:11:00.000Z",
    execFileSync: (bin, args) => {
      fs.ensureFileSync(args[args.length - 1]);
      fs.writeFileSync(args[args.length - 1], Buffer.alloc(4096, 4));
    },
    ffprobeDuration: (filePath) => (fs.existsSync(filePath) ? 2.85 : null),
  });

  assert.equal(report.summary.materialized_story_count, 0);
  assert.equal(report.summary.blocked_story_count, 1);
  assert.ok(report.jobs[0].blockers.includes("real_motion_clip_minimum_not_met"));
  assert.equal(report.jobs[0].partial_evidence_path, path.join(job.artifact_dir, "partial_real_motion_evidence.json"));
  assert.equal(await fs.pathExists(path.join(job.artifact_dir, "materialised_motion_clips.json")), false);

  const partial = await fs.readJson(path.join(job.artifact_dir, "partial_real_motion_evidence.json"));
  assert.equal(partial.status, "blocked");
  assert.equal(partial.not_publishable, true);
  assert.equal(partial.counts_towards_final_render_readiness, false);
  assert.equal(partial.clip_count, 2);
  assert.equal(partial.direct_video_motion_asset_count, 2);
  assert.equal(partial.distinct_motion_family_count, 2);
  assert.ok(partial.blockers.includes("real_motion_clip_minimum_not_met"));
  assert.ok(partial.clips.every((clip) => clip.materialized === true));
  assert.ok(partial.clips.every((clip) => clip.counts_towards_motion_readiness === false));
});

test("real motion materializer writes machine-readable and operator reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-write-"));
  const report = {
    generated_at: "2026-05-23T08:12:00.000Z",
    summary: {
      candidate_count: 0,
      materialized_story_count: 0,
      blocked_story_count: 0,
      failed_story_count: 0,
      materialized_clip_count: 0,
    },
    jobs: [],
  };
  const written = await writeGoalRealMotionReport(report, { outputDir: path.join(root, "out") });
  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
});

test("real motion materializer writes source acquisition work orders for blocked stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-real-motion-source-work-"));
  const report = {
    generated_at: "2026-05-25T02:42:42.224Z",
    summary: {
      candidate_count: 2,
      materialized_story_count: 0,
      blocked_story_count: 2,
      failed_story_count: 0,
      materialized_clip_count: 0,
    },
    jobs: [
      {
        story_id: "direct-video-missing",
        title: "Star Wars Zero Company Needs Gameplay",
        artifact_dir: path.join(root, "output", "goal-proof", "batch", "direct-video-missing"),
        status: "blocked",
        blockers: ["direct_video_motion_clip_missing"],
        candidate_count: 5,
        materialized_count: 5,
        distinct_motion_family_count: 5,
        direct_video_motion_clip_count: 0,
      },
      {
        story_id: "no-candidates",
        title: "Kadokawa Stake Just Passed Sony",
        artifact_dir: path.join(root, "output", "goal-proof", "batch", "no-candidates"),
        status: "blocked",
        blockers: ["validated_direct_media_candidates_missing"],
        candidate_count: 0,
        materialized_count: 0,
        distinct_motion_family_count: 0,
        direct_video_motion_clip_count: 0,
      },
    ],
  };

  const written = await writeGoalRealMotionReport(report, {
    outputDir: path.join(root, "out"),
  });

  assert.equal(await fs.pathExists(written.realMotionSourceAcquisitionWorkOrderPath), true);
  const workOrder = await fs.readJson(written.realMotionSourceAcquisitionWorkOrderPath);
  assert.equal(workOrder.mode, "REAL_MOTION_SOURCE_ACQUISITION_WORK_ORDER");
  assert.equal(workOrder.summary.story_count, 2);
  assert.equal(workOrder.summary.operator_required_count, 2);
  assert.equal(workOrder.summary.auto_repairable_count, 0);
  assert.equal(workOrder.jobs[0].story_id, "direct-video-missing");
  assert.equal(workOrder.jobs[0].repair_lane, "direct_video_motion_source_acquisition");
  assert.match(workOrder.jobs[0].exact_missing_input, /direct-video/i);
  assert.match(workOrder.jobs[0].recommended_command, /ops:v4-source-family-acquisition/);
  assert.equal(workOrder.jobs[0].operator_approval_required, true);
  assert.equal(workOrder.jobs[0].db_mutation_required, false);
  assert.equal(workOrder.jobs[1].story_id, "no-candidates");
  assert.equal(workOrder.jobs[1].repair_lane, "validated_direct_media_candidate_acquisition");
  assert.match(workOrder.jobs[1].required_artefact_path, /motion-packs/);
  assert.equal(workOrder.safety.no_publish_triggered, true);
  assert.equal(workOrder.safety.no_oauth_or_token_change, true);
});
