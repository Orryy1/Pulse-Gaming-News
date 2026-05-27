"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");
const os = require("node:os");

const {
  mergeControlledFrameExtractionReports,
  runControlledFrameExtraction,
  renderControlledFrameExtractionWorkerMarkdown,
} = require("../../lib/controlled-frame-extraction-worker");

function framePlan(overrides = {}) {
  return {
    schema_version: 1,
    story_id: "frame-worker-story",
    title: "Take-Two story mentions GTA, Red Dead and BioShock",
    frame_plan_readiness: "frame_plan_ready",
    selected_references: [
      {
        order: 1,
        provider: "steam",
        source_type: "steam_movie",
        source_url: "https://video.example/gta.m3u8",
        entity: "GTA",
        downloads_allowed: false,
      },
    ],
    target_frames: [
      {
        source_url: "https://video.example/gta.m3u8",
        source_type: "steam_movie",
        entity: "GTA",
        target_time_percent: 0.42,
        downloads_allowed: false,
        extraction_allowed: false,
      },
      {
        source_url: "https://video.example/gta.m3u8",
        source_type: "steam_movie",
        entity: "GTA",
        target_time_percent: 0.58,
        downloads_allowed: false,
        extraction_allowed: false,
      },
    ],
    ...overrides,
  };
}

function tempOutputRoot(name) {
  return path.join(process.cwd(), "test", "output", "tmp-frame-worker", name);
}

async function cleanTempRoot(root) {
  if (root.includes(`${path.sep}test${path.sep}output${path.sep}`)) {
    await fs.remove(root);
  }
}

test("controlled frame extraction defaults to dry-run and performs no writes", async () => {
  const outputRoot = tempOutputRoot("dry-run");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runControlledFrameExtraction([framePlan()], {
    outputRoot,
    extractor: async () => {
      extractorCalls++;
      throw new Error("extractor should not be called in dry-run");
    },
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.summary.frames_would_extract, 2);
  assert.equal(report.summary.frames_extracted, 0);
  assert.equal(extractorCalls, 0);
  assert.equal(await fs.pathExists(outputRoot), false);
});

test("controlled frame extraction apply-local writes only under test/output and records provenance", async () => {
  const outputRoot = tempOutputRoot("apply-local");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([framePlan()], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath, stderr: "" };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: path.basename(outputPath).startsWith("001_") ? "hash-a" : "hash-b",
      width: 1280,
      height: 720,
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "pass",
      warnings: [],
      failures: [],
    }),
  });

  assert.equal(report.mode, "apply_local");
  assert.equal(report.will_download_video, false);
  assert.equal(report.will_retain_video, false);
  assert.equal(report.will_fetch_source_for_frame, true);
  assert.equal(report.summary.frames_extracted, 2);
  assert.equal(report.summary.frames_accepted, 2);
  assert.ok(report.plans[0].frames.every((frame) => frame.local_path.startsWith(outputRoot)));
  assert.ok(report.plans[0].provenance.every((entry) => entry.local_path.startsWith(outputRoot)));
});

test("controlled frame extraction rejects apply-local outside test/output", async () => {
  await assert.rejects(
    () =>
      runControlledFrameExtraction([framePlan()], {
        applyLocal: true,
        outputRoot: path.join(os.tmpdir(), "pulse-frame-worker-outside"),
      }),
    /apply-local output must stay under test\/output/i,
  );
});

test("controlled frame extraction rejects YouTube and HTML official references before extractor", async () => {
  const outputRoot = tempOutputRoot("reject-reference-url-kind");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runControlledFrameExtraction([
    framePlan({
      target_frames: [
        {
          source_url: "https://www.youtube.com/watch?v=officialRef",
          source_type: "igdb_video",
          entity: "BioShock",
          target_time_percent: 0.42,
          downloads_allowed: false,
          extraction_allowed: false,
        },
        {
          source_url: "https://www.rockstargames.com/reddeadredemption2/videos",
          source_type: "official_trailer",
          entity: "Red Dead",
          target_time_percent: 0.58,
          downloads_allowed: false,
          extraction_allowed: false,
        },
      ],
    }),
  ], {
    applyLocal: true,
    outputRoot,
    extractor: async () => {
      extractorCalls++;
      throw new Error("extractor should not receive non-direct official references");
    },
  });

  assert.equal(extractorCalls, 0);
  assert.equal(report.summary.frames_extracted, 0);
  assert.equal(report.summary.frames_rejected, 2);
  assert.deepEqual(
    report.plans[0].frames.map((frame) => frame.status),
    ["rejected_source_url", "rejected_source_url"],
  );
  assert.deepEqual(
    report.plans[0].frames.map((frame) => frame.qa.failures[0]),
    ["segment_source_is_youtube_reference", "segment_source_url_not_direct_media"],
  );
});

test("controlled frame extraction rejects duplicate extracted hashes", async () => {
  const outputRoot = tempOutputRoot("duplicates");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([framePlan()], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: "same-hash",
      width: 1280,
      height: 720,
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "pass",
      warnings: [],
      failures: [],
    }),
  });

  assert.equal(report.summary.frames_extracted, 2);
  assert.equal(report.summary.frames_accepted, 1);
  assert.equal(report.summary.frames_rejected, 1);
  assert.ok(report.plans[0].frames.some((frame) => frame.status === "rejected_duplicate"));
});

test("controlled frame extraction can merge previous story plans without losing provenance", () => {
  const previous = {
    generated_at: "2026-05-07T10:00:00.000Z",
    apply_local: true,
    plans: [
      {
        story_id: "previous_story",
        frames: [{ status: "accepted" }, { status: "rejected_qa" }],
        provenance: [{ story_id: "previous_story", status: "accepted" }],
      },
      {
        story_id: "updated_story",
        frames: [{ status: "accepted" }],
        provenance: [{ story_id: "updated_story", status: "accepted" }],
      },
    ],
  };
  const current = {
    generated_at: "2026-05-08T10:00:00.000Z",
    apply_local: true,
    plans: [
      {
        story_id: "updated_story",
        frames: [{ status: "rejected_qa" }],
        provenance: [{ story_id: "updated_story", status: "rejected_qa" }],
      },
      {
        story_id: "new_story",
        frames: [{ status: "accepted" }],
        provenance: [{ story_id: "new_story", status: "accepted" }],
      },
    ],
  };

  const merged = mergeControlledFrameExtractionReports(previous, current);

  assert.equal(merged.merged_previous_report, true);
  assert.deepEqual(merged.plans.map((plan) => plan.story_id), [
    "previous_story",
    "updated_story",
    "new_story",
  ]);
  assert.equal(merged.summary.stories, 3);
  assert.equal(merged.summary.frames_accepted, 2);
  assert.equal(merged.summary.frames_rejected, 2);
  assert.equal(merged.provenance.length, 3);
});

test("controlled frame extraction rejects unsafe face-like frames", async () => {
  const outputRoot = tempOutputRoot("unsafe-face");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([
    framePlan({
      target_frames: [
        {
          source_url: "https://images.example/author.jpg",
          source_type: "article_image",
          entity: "Unknown Person",
          target_time_percent: 0.42,
          downloads_allowed: false,
          extraction_allowed: false,
        },
      ],
    }),
  ], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: outputPath,
      width: 1280,
      height: 720,
      thumbnail_safe: false,
      likely_has_face: true,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "fail",
      warnings: [],
      failures: ["unsafe_face_like_frame"],
    }),
  });

  assert.equal(report.summary.frames_accepted, 0);
  assert.equal(report.summary.frames_rejected, 1);
  assert.ok(report.plans[0].frames.every((frame) => frame.status === "rejected_qa"));
});

test("controlled frame extraction allows official game-character faces when trailer provenance is strong", async () => {
  const outputRoot = tempOutputRoot("official-game-character-face");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([framePlan()], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: outputPath,
      width: 1280,
      height: 720,
      thumbnail_safe: false,
      likely_has_face: true,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "fail",
      warnings: [],
      failures: ["unsafe_face_like_frame"],
      prescan: {
        likely_is_stock_person: false,
        likely_has_face: true,
        likely_is_logo: false,
        text_overlay_likelihood: 0,
        edge_density: 0.18,
        saturation_mean: 0.42,
      },
    }),
  });

  assert.equal(report.summary.frames_accepted, 2);
  assert.equal(report.plans[0].frames[0].qa.thumbnail_safe, true);
  assert.equal(
    report.plans[0].frames[0].qa.failures.includes("unsafe_face_like_frame"),
    false,
  );
  assert.ok(
    report.plans[0].frames[0].qa.warnings.includes("official_game_character_face_allowed"),
  );
});

test("controlled frame extraction rejects official trailer title or rating cards", async () => {
  const outputRoot = tempOutputRoot("rating-card");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([framePlan()], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: outputPath,
      width: 1280,
      height: 720,
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "pass",
      warnings: [],
      failures: [],
      prescan: {
        likely_is_logo: true,
        text_overlay_likelihood: 0.39,
        edge_density: 0.26,
        saturation_mean: 0.26,
      },
    }),
  });

  assert.equal(report.summary.frames_accepted, 0);
  assert.equal(report.summary.frames_rejected, 2);
  assert.ok(report.plans[0].frames.every((frame) => frame.status === "rejected_qa"));
  assert.ok(
    report.plans[0].frames.every((frame) =>
      frame.qa.failures.includes("title_or_rating_card_frame"),
    ),
  );
});

test("controlled frame extraction rejects localised trailer references from frame metadata", async () => {
  const outputRoot = tempOutputRoot("localised-frame-reference");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([
    framePlan({
      target_frames: [
        {
          source_url: "https://video.example/reddead-de.m3u8",
          source_type: "steam_movie",
          entity: "Red Dead",
          movie_name: "RDR2 60 FPS Trailer (DE)",
          reference_title: "RDR2 60 FPS Trailer (DE)",
          target_time_percent: 0.58,
          target_time_seconds: 34.8,
          downloads_allowed: false,
          extraction_allowed: false,
        },
      ],
    }),
  ], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: outputPath,
      width: 1280,
      height: 720,
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "pass",
      warnings: [],
      failures: [],
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0,
        edge_density: 0.18,
        saturation_mean: 0.42,
      },
    }),
  });

  assert.equal(report.summary.frames_accepted, 0);
  assert.equal(report.summary.frames_rejected, 1);
  assert.ok(
    report.plans[0].frames[0].qa.failures.includes("localised_non_english_trailer_frame"),
  );
});

test("controlled frame extraction rejects subtitle-labelled trailer references from frame metadata", async () => {
  const outputRoot = tempOutputRoot("subtitle-frame-reference");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([
    framePlan({
      target_frames: [
        {
          source_url: "https://video.example/bioshock-subtitles.m3u8",
          source_type: "steam_movie",
          entity: "BioShock",
          movie_name: "BioShock Infinite Launch Trailer Subtitles",
          reference_title: "BioShock Infinite Launch Trailer Subtitles",
          target_time_percent: 0.58,
          target_time_seconds: 34.8,
          downloads_allowed: false,
          extraction_allowed: false,
        },
      ],
    }),
  ], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: outputPath,
      width: 1280,
      height: 720,
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "pass",
      warnings: [],
      failures: [],
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0,
        edge_density: 0.18,
        saturation_mean: 0.42,
      },
    }),
  });

  assert.equal(report.summary.frames_accepted, 0);
  assert.equal(report.summary.frames_rejected, 1);
  assert.ok(
    report.plans[0].frames[0].qa.failures.includes("embedded_subtitle_trailer_frame"),
  );
});

test("controlled frame extraction rejects official trailer promo CTA cards", async () => {
  const outputRoot = tempOutputRoot("promo-cta-card");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([framePlan()], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: outputPath,
      width: 1280,
      height: 720,
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "pass",
      warnings: [],
      failures: [],
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0.03,
        white_text_on_dark_likelihood: 0.82,
        bright_pixel_ratio: 0.07,
        dark_pixel_ratio: 0.72,
        edge_density: 0.14,
        saturation_mean: 0.28,
      },
    }),
  });

  assert.equal(report.summary.frames_accepted, 0);
  assert.ok(
    report.plans[0].frames.every((frame) =>
      frame.qa.failures.includes("title_or_rating_card_frame"),
    ),
  );
});

test("controlled frame extraction rejects early official trailer intro frames", async () => {
  const outputRoot = tempOutputRoot("early-intro-frame");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([
    framePlan({
      target_frames: [
        {
          source_url: "https://video.example/gta.m3u8",
          source_type: "steam_movie",
          entity: "GTA",
          target_time_percent: 0.18,
          target_time_seconds: 10.8,
          downloads_allowed: false,
          extraction_allowed: false,
        },
      ],
    }),
  ], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: outputPath,
      width: 1280,
      height: 720,
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "pass",
      warnings: [],
      failures: [],
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0,
        edge_density: 0.18,
        saturation_mean: 0.32,
      },
    }),
  });

  assert.equal(report.summary.frames_accepted, 0);
  assert.ok(
    report.plans[0].frames[0].qa.failures.includes("early_trailer_intro_frame"),
  );
});

test("controlled frame extraction rejects low-detail official trailer frames", async () => {
  const outputRoot = tempOutputRoot("low-detail");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([framePlan()], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: outputPath,
      width: 1280,
      height: 720,
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "pass",
      warnings: [],
      failures: [],
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0,
        edge_density: 0.024,
        saturation_mean: 0.16,
      },
    }),
  });

  assert.equal(report.summary.frames_accepted, 0);
  assert.ok(
    report.plans[0].frames.every((frame) =>
      frame.qa.failures.includes("low_detail_official_frame"),
    ),
  );
});

test("controlled frame extraction rejects explicitly blurred official trailer frames", async () => {
  const outputRoot = tempOutputRoot("blurred-frame");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([framePlan()], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: outputPath,
      width: 1280,
      height: 720,
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      blur_verdict: "fail",
      verdict: "pass",
      warnings: [],
      failures: [],
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0,
        edge_density: 0.14,
        saturation_mean: 0.38,
      },
    }),
  });

  assert.equal(report.summary.frames_accepted, 0);
  assert.ok(
    report.plans[0].frames.every((frame) =>
      frame.qa.failures.includes("low_detail_official_frame"),
    ),
  );
});

test("controlled frame extraction rejects poor-subject official trailer frames", async () => {
  const outputRoot = tempOutputRoot("poor-subject-framing");
  await cleanTempRoot(outputRoot);

  const report = await runControlledFrameExtraction([framePlan()], {
    applyLocal: true,
    outputRoot,
    extractor: async ({ outputPath }) => {
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from("fake-frame"));
      return { outputPath };
    },
    inspectFrame: async (outputPath) => ({
      local_path: outputPath,
      file_size: 10,
      content_hash: outputPath,
      width: 1280,
      height: 720,
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      blur_verdict: "pass",
      verdict: "pass",
      warnings: [],
      failures: [],
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0.02,
        white_text_on_dark_likelihood: 0,
        edge_density: 0.118,
        saturation_mean: 0.27,
        dark_pixel_ratio: 0.67,
        bright_pixel_ratio: 0.04,
        central_dark_pixel_ratio: 0.72,
        central_bright_pixel_ratio: 0.035,
        letterbox_bar_ratio: 0.03,
      },
    }),
  });

  assert.equal(report.summary.frames_accepted, 0);
  assert.ok(
    report.plans[0].frames.every((frame) =>
      frame.qa.failures.includes("poor_subject_framing_frame"),
    ),
  );
});

test("controlled frame extraction report emits readable markdown", async () => {
  const report = await runControlledFrameExtraction([framePlan()], { dryRun: true });
  const markdown = renderControlledFrameExtractionWorkerMarkdown(report);

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  assert.match(markdown, /Controlled Local Frame Extraction Worker/);
  assert.match(markdown, /frame-worker-story/);
  assert.match(markdown, /dry_run/);
});
