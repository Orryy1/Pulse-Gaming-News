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
  assert.equal(await fs.pathExists(path.join(skippedJob.artifact_dir, "materialised_motion_clips.json")), false);
});

test("real motion materializer CLI accepts repeatable story-id filters", () => {
  const args = parseArgs([
    "--story-id",
    "story-a",
    "--story",
    "story-b",
    "--segment-report",
    "test/output/segments.json",
    "--limit",
    "2",
    "--refresh-ready",
  ]);

  assert.deepEqual(args.storyIds, ["story-a", "story-b"]);
  assert.equal(args.segmentReportPath, "test/output/segments.json");
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
    motion_inventory: {},
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
  const directUrl =
    "https://fserveu20221222.blob.core.windows.net/files/Pokemon/2016/11/clip.mp4?sv=2026-02-06";
  const segmentValidationReport = {
    segments: Array.from({ length: 5 }, (_, index) => ({
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      validation_reason: "short_direct_media_detail_motion_samples_passed",
      source_url: directUrl,
      source_type: "licensed_direct_media_url",
      source_url_kind: "direct_video",
      provider: "licensed_direct_media_acquisition",
      entity: "Pokemon Go",
      source_family: index < 3 ? "pokemon_go_ditto_direct" : "pokemon_go_feature_direct",
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

  const materialised = await fs.readJson(path.join(artifactDir, "materialised_motion_clips.json"));
  assert.equal(materialised.direct_video_motion_asset_count, 5);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "direct_video").length, 5);
  assert.equal(materialised.clips.filter((clip) => clip.media_kind === "owned_motion").length, 4);
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
  assert.equal(await fs.pathExists(path.join(job.artifact_dir, "materialised_motion_clips.json")), false);
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
