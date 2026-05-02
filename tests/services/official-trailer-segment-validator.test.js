"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");
const os = require("node:os");

const {
  applySegmentValidationToClipRefs,
  runOfficialTrailerSegmentValidation,
  segmentKeyForClipRef,
} = require("../../lib/studio/v2/official-trailer-segment-validator");

function clip(overrides = {}) {
  return {
    path: "https://video.akamai.steamstatic.com/store_trailers/gta/hls_264_master.m3u8",
    source: "official-trailer-reference",
    sourceType: "steam_movie",
    entity: "GTA",
    storyId: "rss_5b3abe925b27a199",
    durationS: 5,
    mediaStartS: 42,
    provenance: {
      requires_segment_validation: true,
      segment_validated: false,
      allowed_for_flash_lane: false,
    },
    ...overrides,
  };
}

function tempOutputRoot(name) {
  return path.join(process.cwd(), "test", "output", "tmp-segment-validator", name);
}

async function cleanTempRoot(root) {
  if (root.includes(`${path.sep}test${path.sep}output${path.sep}`)) {
    await fs.remove(root);
  }
}

async function fakeExtractor({ outputPath }) {
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, Buffer.from("fake-segment-frame"));
  return { outputPath };
}

function passingQa(outputPath) {
  return {
    local_path: outputPath,
    file_size: 100,
    content_hash: path.basename(outputPath),
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
      text_overlay_likelihood: 0.1,
      edge_density: 0.2,
      saturation_mean: 0.45,
    },
  };
}

test("official trailer segment validator defaults to dry-run and performs no writes", async () => {
  const outputRoot = tempOutputRoot("dry-run");
  await cleanTempRoot(outputRoot);
  let extractorCalls = 0;

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    outputRoot,
    extractor: async () => {
      extractorCalls++;
      throw new Error("extractor should not run in dry-run");
    },
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.summary.segments_would_validate, 1);
  assert.equal(report.summary.samples_would_extract, 3);
  assert.equal(extractorCalls, 0);
  assert.equal(await fs.pathExists(outputRoot), false);
});

test("official trailer segment validator apply-local marks clean sampled windows as Flash Lane allowed", async () => {
  const outputRoot = tempOutputRoot("clean");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => passingQa(outputPath),
  });

  assert.equal(report.mode, "apply_local");
  assert.equal(report.summary.segments_validated, 1);
  assert.equal(report.segments[0].segment_validated, true);
  assert.equal(report.segments[0].allowed_for_flash_lane, true);
  assert.equal(report.segments[0].validation_reason, "segment_samples_passed");
  assert.ok(report.segments[0].samples.every((sample) => sample.local_path.startsWith(outputRoot)));
});

test("official trailer segment validator rejects PEGI/ESRB/title-card-like windows", async () => {
  const outputRoot = tempOutputRoot("rating-card");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      prescan: {
        likely_is_logo: true,
        text_overlay_likelihood: 0.39,
        edge_density: 0.26,
        saturation_mean: 0.22,
      },
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_title_or_rating_card");
  assert.equal(report.segments[0].allowed_for_flash_lane, false);
});

test("official trailer segment validator rejects black-frame windows", async () => {
  const outputRoot = tempOutputRoot("black-frame");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      thumbnail_safe: false,
      black_frame: true,
      verdict: "fail",
      failures: ["black_frame"],
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_black_frame");
});

test("official trailer segment validator rejects low-detail blurry windows", async () => {
  const outputRoot = tempOutputRoot("low-detail");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0.08,
        edge_density: 0.03,
        saturation_mean: 0.14,
      },
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_contains_low_detail_frame");
});

test("official trailer segment validator rejects repetitive dead windows", async () => {
  const outputRoot = tempOutputRoot("repetitive");
  await cleanTempRoot(outputRoot);

  const report = await runOfficialTrailerSegmentValidation([clip()], {
    applyLocal: true,
    outputRoot,
    extractor: fakeExtractor,
    inspectFrame: async (outputPath) => ({
      ...passingQa(outputPath),
      content_hash: "same-frame",
    }),
  });

  assert.equal(report.summary.segments_rejected, 1);
  assert.equal(report.segments[0].validation_reason, "segment_samples_too_repetitive");
});

test("segment validation report upgrades only validated refs for Flash Lane use", () => {
  const ref = clip();
  const report = {
    generated_at: "2026-05-02T22:00:00.000Z",
    segments: [
      {
        clip_key: segmentKeyForClipRef(ref),
        segment_validated: true,
        allowed_for_flash_lane: true,
        validation_reason: "segment_samples_passed",
        samples: [{}, {}, {}],
      },
    ],
  };

  const [upgraded] = applySegmentValidationToClipRefs([ref], report);

  assert.equal(upgraded.provenance.segment_validated, true);
  assert.equal(upgraded.provenance.allowed_for_flash_lane, true);
  assert.equal(upgraded.provenance.segment_validation_reason, "segment_samples_passed");
  assert.equal(upgraded.provenance.segment_validation_samples, 3);
});

test("official trailer segment validator rejects apply-local outside test/output", async () => {
  await assert.rejects(
    () =>
      runOfficialTrailerSegmentValidation([clip()], {
        applyLocal: true,
        outputRoot: path.join(os.tmpdir(), "pulse-segment-validator-outside"),
      }),
    /apply-local segment validation output must stay under test\/output/i,
  );
});
