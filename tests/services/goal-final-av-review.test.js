"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const {
  FINAL_AV_REVIEW_ARTEFACT_KEYS,
  FINAL_AV_REVIEW_ATTESTATION_KEYS,
  validateFinalAvReview,
  validateFinalAvReviewFile,
  verifySampledFrameHashesWithFfmpeg,
} = require("../../lib/goal-final-av-review");
const { fingerprintFile } = require("../../lib/human-review-artefact-fingerprints");

let contactSheetPngPromise;

function contactSheetPng() {
  if (!contactSheetPngPromise) {
    const width = 640;
    const height = 360;
    const pixels = Buffer.alloc(width * height * 3);
    const colours = [
      [255, 107, 26],
      [24, 24, 27],
      [0, 200, 83],
      [37, 99, 235],
    ];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const colour = colours[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)];
        const offset = (y * width + x) * 3;
        pixels[offset] = colour[0];
        pixels[offset + 1] = colour[1];
        pixels[offset + 2] = colour[2];
      }
    }
    contactSheetPngPromise = sharp(pixels, {
      raw: { width, height, channels: 3 },
    }).png().toBuffer();
  }
  return contactSheetPngPromise;
}

function mp4Header() {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d,
    0x69, 0x73, 0x6f, 0x32,
  ]);
}

function passingProbe() {
  return {
    duration_seconds: 60,
    streams: [{ codec_type: "video" }, { codec_type: "audio" }],
  };
}

function passingDecode() {
  return {
    fully_decoded: true,
    decoded_duration_seconds: 60,
    audio_checked: true,
    video_checked: true,
    errors: [],
  };
}

async function passingFrameHashVerification({ sampledFrames }) {
  return {
    checked: true,
    sampled_frames: sampledFrames.map((frame) => ({
      time_seconds: frame.time_seconds,
      sha256: frame.hash,
    })),
  };
}

function passingForensicReport({ storyId, finalMp4Path }) {
  const fingerprint = fingerprintFile(finalMp4Path);
  return {
    schema_version: 1,
    story_id: storyId,
    verdict: "pass",
    final_media: {
      sha256: fingerprint.sha256,
      size_bytes: fingerprint.size_bytes,
    },
    checks: Object.fromEntries(
      ["audio", "video", "captions", "av_sync", "freeze", "black", "blur", "repetition"]
        .map((key) => [key, { checked: true, verdict: "pass" }]),
    ),
    sampled_frames: [0, 15, 30, 45, 60]
      .map((time) => ({
        time_seconds: time,
        hash: crypto.createHash("sha256").update(`frame-${time}`).digest("hex"),
      })),
    critical_defects: [],
  };
}

function validationOptions(fixture, overrides = {}) {
  return {
    storyId: fixture.storyId,
    artifactDir: fixture.root,
    finalMp4Path: fixture.artefacts.final_mp4,
    probeMedia: async () => passingProbe(),
    decodeMedia: async () => passingDecode(),
    verifySampledFrameHashes: passingFrameHashVerification,
    ...overrides,
  };
}

async function replaceForensicReport(fixture, report) {
  await fs.writeJson(fixture.artefacts.decoded_forensic_report, report);
  const reportFingerprint = fingerprintFile(
    fixture.artefacts.decoded_forensic_report,
  ).sha256;
  fixture.review.reviewed_artefact_fingerprints.decoded_forensic_report = reportFingerprint;
  fixture.review.contact_sheet_binding.decoded_forensic_report_sha256 = reportFingerprint;
  fixture.review.contact_sheet_binding.sampled_frames = Array.isArray(report.sampled_frames)
    ? report.sampled_frames.map((frame) => ({
      time_seconds: frame.time_seconds,
      hash: frame.hash,
    }))
    : [];
}

async function makeReviewFixture(storyId = "story-final-av") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-review-"));
  const artefacts = {
    final_mp4: path.join(root, "final.mp4"),
    contact_sheet: path.join(root, "contact-sheet.png"),
    decoded_forensic_report: path.join(root, "decoded-forensic-report.json"),
  };
  const contactSheetBytes = await contactSheetPng();
  await fs.writeFile(artefacts.final_mp4, mp4Header());
  await fs.writeFile(artefacts.contact_sheet, contactSheetBytes);
  const forensicReport = passingForensicReport({ storyId, finalMp4Path: artefacts.final_mp4 });
  await fs.writeJson(
    artefacts.decoded_forensic_report,
    forensicReport,
  );
  const artefactFingerprints = Object.fromEntries(
    FINAL_AV_REVIEW_ARTEFACT_KEYS.map((key) => [key, fingerprintFile(artefacts[key]).sha256]),
  );
  const review = {
    schema_version: 1,
    story_id: storyId,
    reviewed_at: "2026-07-15T01:00:00.000Z",
    signed_at: "2026-07-15T01:01:00.000Z",
    reviewer: {
      id: "independent-av-reviewer",
      independent: true,
    },
    signoff: {
      reviewer_id: "independent-av-reviewer",
      signed_at: "2026-07-15T01:01:00.000Z",
    },
    artefacts,
    reviewed_artefact_fingerprints: artefactFingerprints,
    contact_sheet_binding: {
      contact_sheet_sha256: artefactFingerprints.contact_sheet,
      final_mp4_sha256: artefactFingerprints.final_mp4,
      decoded_forensic_report_sha256: artefactFingerprints.decoded_forensic_report,
      sampled_frames: forensicReport.sampled_frames.map((frame) => ({
        time_seconds: frame.time_seconds,
        hash: frame.hash,
      })),
    },
    attestations: Object.fromEntries(
      FINAL_AV_REVIEW_ATTESTATION_KEYS.map((key) => [key, true]),
    ),
    defects: [],
    status: "GREEN",
    verdict: "GREEN",
    final_verdict: "GREEN",
    publish_ready: true,
    can_publish: true,
    can_auto_publish: true,
  };
  const reviewPath = path.join(root, "final_av_review.json");
  await fs.writeJson(reviewPath, review, { spaces: 2 });
  return { root, artefacts, review, reviewPath, storyId, contactSheetBytes };
}

test("final AV review accepts strict schema-v1 evidence bound to current artefacts", async () => {
  const fixture = await makeReviewFixture();
  const calls = [];
  const result = await validateFinalAvReview(fixture.review, validationOptions(fixture, {
    probeMedia: async (filePath) => {
      calls.push(["probe", filePath]);
      return passingProbe();
    },
    decodeMedia: async (filePath) => {
      calls.push(["decode", filePath]);
      return passingDecode();
    },
  }));

  assert.equal(result.valid, true);
  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.evidence.fingerprints_verified, true);
  assert.equal(result.evidence.reviewer_independent, true);
  assert.equal(result.evidence.reviewer_trusted, true);
  assert.deepEqual(result.evidence.attestations, fixture.review.attestations);
  assert.equal(result.evidence.contact_sheet_inspection.fully_decoded, true);
  assert.equal(result.evidence.contact_sheet_inspection.dimensions_valid, true);
  assert.equal(result.evidence.contact_sheet_binding.bound_to_current_media, true);
  assert.equal(result.evidence.decoded_forensic_report_valid, true);
  assert.equal(result.evidence.decoded_forensic_report.report_binding.bound_to_current_mp4, true);
  assert.equal(
    result.evidence.decoded_forensic_report.frame_hash_verification.verified,
    true,
  );
  assert.equal(result.evidence.decoded_forensic_report.timeline_coverage.covered, true);
  assert.deepEqual(calls, [
    ["probe", fixture.artefacts.final_mp4],
    ["decode", fixture.artefacts.final_mp4],
  ]);
});

test("final AV review rejects a bare self-claimed decoded forensic pass", async () => {
  const fixture = await makeReviewFixture();
  await replaceForensicReport(fixture, {
    schema_version: 1,
    story_id: fixture.storyId,
    verdict: "pass",
    decoded: true,
    blockers: [],
    critical_defects: [],
  });
  const calls = [];
  const result = await validateFinalAvReview(fixture.review, {
    ...validationOptions(fixture),
    probeMedia: async (filePath) => {
      calls.push(["probe", filePath]);
      return {
        duration_seconds: 60,
        streams: [{ codec_type: "video" }, { codec_type: "audio" }],
      };
    },
    decodeMedia: async (filePath) => {
      calls.push(["decode", filePath]);
      return {
        fully_decoded: true,
        decoded_duration_seconds: 60,
        audio_checked: true,
        video_checked: true,
        errors: [],
      };
    },
  });

  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("final_av_review_decoded_forensic_report_invalid"));
  assert.ok(
    result.evidence.decoded_forensic_report.blockers.includes("forensic_report_bare_pass"),
  );
  assert.deepEqual(calls, [
    ["probe", fixture.artefacts.final_mp4],
    ["decode", fixture.artefacts.final_mp4],
  ]);
});

test("final AV review independently rejects incomplete or stale final-media forensics", async (t) => {
  const cases = [
    {
      name: "report stale against the current final MP4",
      expected: "forensic_report_mp4_hash_mismatch",
      arrange: async (fixture) => {
        await fs.appendFile(fixture.artefacts.final_mp4, Buffer.from([0]));
        fixture.review.reviewed_artefact_fingerprints.final_mp4 = fingerprintFile(
          fixture.artefacts.final_mp4,
        ).sha256;
      },
    },
    {
      name: "fresh full decode is not proven",
      expected: "final_mp4_full_decode_failed",
      options: {
        decodeMedia: async () => ({
          ...passingDecode(),
          fully_decoded: false,
        }),
      },
    },
    {
      name: "fresh probe does not prove audio and video streams",
      expected: "probe_audio_stream_missing",
      options: {
        probeMedia: async () => ({ duration_seconds: 60, streams: [] }),
      },
    },
    {
      name: "report omits the final MP4 hash",
      expected: "forensic_report_mp4_hash_missing",
      mutate: (report) => {
        delete report.final_media.sha256;
      },
    },
    {
      name: "report omits a required forensic check",
      expected: "forensic_repetition_not_pass",
      mutate: (report) => {
        delete report.checks.repetition;
      },
    },
    {
      name: "sample hashes do not cover the full timeline",
      expected: "sampled_frames_timeline_not_covered",
      mutate: (report) => {
        report.sampled_frames = [0, 1, 2, 60]
          .map((time) => ({ time_seconds: time, hash: `frame-${time}` }));
      },
    },
    {
      name: "report leaves production evidence not_checked",
      expected: "production_not_checked_fields_present",
      mutate: (report) => {
        report.production_evidence = { loudness: { verdict: "not_checked" } };
      },
    },
  ];

  for (const row of cases) {
    await t.test(row.name, async () => {
      const fixture = await makeReviewFixture();
      const report = await fs.readJson(fixture.artefacts.decoded_forensic_report);
      if (row.mutate) {
        row.mutate(report);
        await replaceForensicReport(fixture, report);
      }
      if (row.arrange) await row.arrange(fixture);

      const result = await validateFinalAvReview(
        fixture.review,
        validationOptions(fixture, row.options),
      );

      assert.equal(result.verdict, "RED");
      assert.equal(result.can_auto_publish, false);
      assert.ok(result.blockers.includes("final_av_review_decoded_forensic_report_invalid"));
      assert.ok(result.evidence.decoded_forensic_report.blockers.includes(row.expected));
      assert.equal(result.evidence.fingerprints_verified, true);
      assert.equal(result.evidence.reviewer_independent, true);
    });
  }
});

test("final AV review file validator fails closed for missing, malformed and wrong-version reviews", async () => {
  const fixture = await makeReviewFixture();
  const missing = await validateFinalAvReviewFile(
    path.join(fixture.root, "missing.json"),
    validationOptions(fixture),
  );
  assert.equal(missing.verdict, "RED");
  assert.ok(missing.blockers.includes("final_av_review_missing"));

  await fs.writeFile(fixture.reviewPath, "{not-json", "utf8");
  const malformed = await validateFinalAvReviewFile(
    fixture.reviewPath,
    validationOptions(fixture),
  );
  assert.ok(malformed.blockers.includes("final_av_review_invalid_json"));

  const wrongVersion = await validateFinalAvReview(
    { ...fixture.review, schema_version: 2 },
    validationOptions(fixture),
  );
  assert.ok(wrongVersion.blockers.includes("final_av_review_schema_version_invalid"));

  const malformedDefect = await validateFinalAvReview(
    { ...fixture.review, defects: [null] },
    validationOptions(fixture),
  );
  assert.ok(malformedDefect.blockers.includes("final_av_review_defect_invalid:0"));
});

test("final AV review rejects missing and invalid reviewed artefact content", async () => {
  const fixture = await makeReviewFixture();

  await fs.remove(fixture.artefacts.contact_sheet);
  let result = await validateFinalAvReview(fixture.review, validationOptions(fixture));
  assert.ok(result.blockers.includes("required_artefact_file_missing:contact_sheet"));

  await fs.writeFile(fixture.artefacts.contact_sheet, fixture.contactSheetBytes);
  await fs.writeFile(fixture.artefacts.final_mp4, Buffer.from("not an mp4"));
  fixture.review.reviewed_artefact_fingerprints.final_mp4 = fingerprintFile(
    fixture.artefacts.final_mp4,
  ).sha256;
  result = await validateFinalAvReview(fixture.review, validationOptions(fixture));
  assert.ok(result.blockers.includes("final_av_review_final_mp4_invalid"));

  await fs.writeFile(fixture.artefacts.final_mp4, mp4Header());
  fixture.review.reviewed_artefact_fingerprints.final_mp4 = fingerprintFile(
    fixture.artefacts.final_mp4,
  ).sha256;
  await fs.writeFile(fixture.artefacts.contact_sheet, Buffer.from("not an image"));
  fixture.review.reviewed_artefact_fingerprints.contact_sheet = fingerprintFile(
    fixture.artefacts.contact_sheet,
  ).sha256;
  result = await validateFinalAvReview(fixture.review, validationOptions(fixture));
  assert.ok(result.blockers.includes("final_av_review_contact_sheet_invalid"));

  await fs.writeFile(fixture.artefacts.contact_sheet, fixture.contactSheetBytes);
  fixture.review.reviewed_artefact_fingerprints.contact_sheet = fingerprintFile(
    fixture.artefacts.contact_sheet,
  ).sha256;
  await fs.writeFile(fixture.artefacts.decoded_forensic_report, "{}\n", "utf8");
  fixture.review.reviewed_artefact_fingerprints.decoded_forensic_report = fingerprintFile(
    fixture.artefacts.decoded_forensic_report,
  ).sha256;
  result = await validateFinalAvReview(fixture.review, validationOptions(fixture));
  assert.ok(result.blockers.includes("final_av_review_decoded_forensic_report_invalid"));
  assert.equal(result.verdict, "RED");
});

test("final AV review rejects missing, malformed and stale hashes for every reviewed artefact", async () => {
  const fixture = await makeReviewFixture();

  for (const key of FINAL_AV_REVIEW_ARTEFACT_KEYS) {
    const missingHashReview = {
      ...fixture.review,
      reviewed_artefact_fingerprints: { ...fixture.review.reviewed_artefact_fingerprints },
    };
    delete missingHashReview.reviewed_artefact_fingerprints[key];
    let result = await validateFinalAvReview(missingHashReview, validationOptions(fixture));
    assert.ok(result.blockers.includes(`final_av_review_fingerprint_invalid:${key}`), key);
    assert.ok(result.blockers.includes(`reviewed_artefact_fingerprint_missing:${key}`), key);

    const malformedHashReview = {
      ...fixture.review,
      reviewed_artefact_fingerprints: {
        ...fixture.review.reviewed_artefact_fingerprints,
        [key]: "sha256:not-a-hash",
      },
    };
    result = await validateFinalAvReview(malformedHashReview, validationOptions(fixture));
    assert.ok(result.blockers.includes(`final_av_review_fingerprint_invalid:${key}`), key);

    const original = await fs.readFile(fixture.artefacts[key]);
    await fs.appendFile(fixture.artefacts[key], Buffer.from("\n"));
    result = await validateFinalAvReview(fixture.review, validationOptions(fixture));
    assert.ok(result.blockers.includes(`reviewed_artefact_fingerprint_mismatch:${key}`), key);
    assert.equal(result.can_auto_publish, false, key);
    await fs.writeFile(fixture.artefacts[key], original);
  }
});

test("final AV review fails closed when a reviewed artefact path is not a readable file", async () => {
  const fixture = await makeReviewFixture();
  const review = {
    ...fixture.review,
    artefacts: { ...fixture.review.artefacts, contact_sheet: fixture.root },
  };

  const result = await validateFinalAvReview(review, validationOptions(fixture));

  assert.equal(result.verdict, "RED");
  assert.equal(result.can_auto_publish, false);
  assert.ok(result.blockers.includes("required_artefact_file_unreadable:contact_sheet"));
});

test("final AV review requires every watch, listen, sync, caption and subject attestation", async () => {
  const fixture = await makeReviewFixture();

  for (const key of FINAL_AV_REVIEW_ATTESTATION_KEYS) {
    const review = {
      ...fixture.review,
      attestations: { ...fixture.review.attestations, [key]: false },
    };
    const result = await validateFinalAvReview(review, validationOptions(fixture));
    assert.equal(result.verdict, "RED", key);
    assert.ok(result.blockers.includes(`final_av_review_attestation_not_true:${key}`), key);
  }
});

test("final AV review rejects non-independent reviewers, critical defects and a different render", async () => {
  const fixture = await makeReviewFixture();
  const otherMp4 = path.join(fixture.root, "other.mp4");
  await fs.writeFile(otherMp4, mp4Header());
  const review = {
    ...fixture.review,
    reviewer: { id: "render-operator", independent: false },
    defects: [{ severity: "critical", code: "captions_obscure_subject" }],
  };
  const result = await validateFinalAvReview(
    review,
    validationOptions(fixture, { finalMp4Path: otherMp4 }),
  );

  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("final_av_review_reviewer_not_independent"));
  assert.ok(result.blockers.includes("final_av_review_critical_defect"));
  assert.ok(result.blockers.includes("final_av_review_final_mp4_not_current_render"));
});

test("final AV review rejects RED or AMBER status fields that contradict a GREEN verdict", async (t) => {
  const cases = [
    { field: "status", value: "RED" },
    { field: "status", value: "AMBER" },
    { field: "final_verdict", value: "RED" },
    { field: "final_verdict", value: "AMBER" },
  ];

  for (const row of cases) {
    await t.test(`${row.field}=${row.value}`, async () => {
      const fixture = await makeReviewFixture();
      const result = await validateFinalAvReview(
        { ...fixture.review, [row.field]: row.value },
        validationOptions(fixture),
      );

      assert.equal(result.verdict, "RED");
      assert.equal(result.can_auto_publish, false);
      assert.ok(result.blockers.includes(`final_av_review_${row.field}_not_green`));
    });
  }
});

test("final AV review rejects an unsigned outer PENDING review despite internally GREEN evidence", async () => {
  const fixture = await makeReviewFixture();
  const result = await validateFinalAvReview({
    ...fixture.review,
    status: "PENDING",
    final_verdict: null,
    signed_at: null,
    signoff: null,
    publish_ready: false,
    can_publish: false,
    can_auto_publish: false,
  }, validationOptions(fixture));

  assert.equal(result.verdict, "RED");
  assert.equal(result.can_auto_publish, false);
  assert.ok(result.blockers.includes("final_av_review_status_not_approved"));
  assert.ok(result.blockers.includes("final_av_review_final_verdict_not_green"));
  assert.ok(result.blockers.includes("final_av_review_signed_at_invalid"));
  assert.ok(result.blockers.includes("final_av_review_signoff_invalid"));
  assert.ok(result.blockers.includes("final_av_review_publish_not_approved"));
});

test("final AV review rejects reported blockers, failures or errors despite a GREEN verdict", async (t) => {
  const cases = [
    { field: "blockers", value: ["captions_overlap"] },
    { field: "failures", value: [{ code: "av_sync_drift" }] },
    { field: "errors", value: "decoder warning promoted to error" },
  ];

  for (const row of cases) {
    await t.test(row.field, async () => {
      const fixture = await makeReviewFixture();
      const result = await validateFinalAvReview(
        { ...fixture.review, [row.field]: row.value },
        validationOptions(fixture),
      );

      assert.equal(result.verdict, "RED");
      assert.ok(result.blockers.includes(`final_av_review_${row.field}_present`));
    });
  }
});

test("final AV review treats high-severity defects as publish-blocking", async () => {
  const fixture = await makeReviewFixture();
  const result = await validateFinalAvReview({
    ...fixture.review,
    defects: [{ severity: "HIGH", code: "contact_sheet_subject_mismatch" }],
  }, validationOptions(fixture));

  assert.equal(result.verdict, "RED");
  assert.equal(result.can_auto_publish, false);
  assert.ok(result.blockers.includes("final_av_review_blocking_defect"));
  assert.equal(result.evidence.blocking_defect_present, true);
});

test("final AV review trusts reviewer identity only through an explicit allowlist", async () => {
  const fixture = await makeReviewFixture();
  const reviewerId = "self-appointed-independent-reviewer";
  const review = {
    ...fixture.review,
    reviewer: { id: reviewerId, independent: true, trusted: true },
    signoff: {
      ...fixture.review.signoff,
      reviewer_id: reviewerId,
    },
  };

  const unregistered = await validateFinalAvReview(review, validationOptions(fixture));
  assert.equal(unregistered.verdict, "RED");
  assert.ok(unregistered.blockers.includes("final_av_review_reviewer_not_trusted"));
  assert.equal(unregistered.evidence.reviewer_trusted, false);

  const registered = await validateFinalAvReview(review, validationOptions(fixture, {
    trustedReviewerIds: [reviewerId],
  }));
  assert.equal(
    registered.verdict,
    "GREEN",
    JSON.stringify(registered.evidence.decoded_forensic_report),
  );
  assert.equal(registered.evidence.reviewer_trusted, true);
  assert.equal(registered.evidence.reviewer_trust_source, "configured_allowlist");
});

test("final AV review rejects declared artefact paths containing parent traversal", async () => {
  const fixture = await makeReviewFixture();
  const review = {
    ...fixture.review,
    artefacts: {
      ...fixture.review.artefacts,
      contact_sheet: `nested/../${path.basename(fixture.artefacts.contact_sheet)}`,
    },
  };

  const result = await validateFinalAvReview(review, validationOptions(fixture));

  assert.equal(result.verdict, "RED");
  assert.ok(
    result.blockers.includes("final_av_review_artefact_path_traversal:contact_sheet"),
  );
  assert.equal(result.evidence.artefact_path_scope.contact_sheet.allowed, false);
});

test("final AV review requires an explicit canonical story artefact directory", async () => {
  const fixture = await makeReviewFixture();
  const options = validationOptions(fixture);
  delete options.artifactDir;

  const result = await validateFinalAvReview(fixture.review, options);

  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("final_av_review_story_artifact_dir_invalid"));
  assert.equal(result.evidence.canonical_story_artifact_dir, null);
});

test("final AV review rejects an absolute artefact path outside the story directory", async () => {
  const fixture = await makeReviewFixture();
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-external-"));
  const externalContactSheet = path.join(externalRoot, "contact-sheet.png");
  await fs.copy(fixture.artefacts.contact_sheet, externalContactSheet);
  const review = {
    ...fixture.review,
    artefacts: { ...fixture.review.artefacts, contact_sheet: externalContactSheet },
    reviewed_artefact_fingerprints: {
      ...fixture.review.reviewed_artefact_fingerprints,
      contact_sheet: fingerprintFile(externalContactSheet).sha256,
    },
  };

  const result = await validateFinalAvReview(review, validationOptions(fixture));

  assert.equal(result.verdict, "RED");
  assert.ok(
    result.blockers.includes("final_av_review_artefact_path_outside_story_dir:contact_sheet"),
  );
  assert.equal(result.evidence.artefact_path_scope.contact_sheet.allowed, false);
});

test("final AV review rejects an artefact symlink that escapes the story directory", async (t) => {
  const fixture = await makeReviewFixture();
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-symlink-"));
  const externalContactSheet = path.join(externalRoot, "contact-sheet.png");
  await fs.copy(fixture.artefacts.contact_sheet, externalContactSheet);
  const linkPath = path.join(fixture.root, "external-link");
  try {
    await fs.symlink(externalRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const review = {
    ...fixture.review,
    artefacts: { ...fixture.review.artefacts, contact_sheet: "external-link/contact-sheet.png" },
    reviewed_artefact_fingerprints: {
      ...fixture.review.reviewed_artefact_fingerprints,
      contact_sheet: fingerprintFile(externalContactSheet).sha256,
    },
  };

  const result = await validateFinalAvReview(review, validationOptions(fixture));

  assert.equal(result.verdict, "RED");
  assert.ok(
    result.blockers.includes("final_av_review_artefact_symlink_escape:contact_sheet"),
  );
  assert.equal(result.evidence.artefact_path_scope.contact_sheet.allowed, false);
});

test("final AV review file validator rejects a review path outside the story directory", async () => {
  const fixture = await makeReviewFixture();
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-review-file-"));
  const externalReviewPath = path.join(externalRoot, "final_av_review.json");
  await fs.copy(fixture.reviewPath, externalReviewPath);

  const result = await validateFinalAvReviewFile(
    externalReviewPath,
    validationOptions(fixture),
  );

  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("final_av_review_path_outside_story_dir"));
  assert.equal(result.evidence.review_path_scope.allowed, false);
});

test("final AV review file validator rejects a review symlink escape", async (t) => {
  const fixture = await makeReviewFixture();
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-review-link-"));
  await fs.copy(fixture.reviewPath, path.join(externalRoot, "final_av_review.json"));
  const linkPath = path.join(fixture.root, "external-review-link");
  try {
    await fs.symlink(externalRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const result = await validateFinalAvReviewFile(
    "external-review-link/final_av_review.json",
    validationOptions(fixture),
  );

  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("final_av_review_path_symlink_escape"));
  assert.equal(result.evidence.review_path_scope.allowed, false);
});

test("final AV review never probes an out-of-scope current-render path", async () => {
  const fixture = await makeReviewFixture();
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-current-render-"));
  const externalMp4 = path.join(externalRoot, "external.mp4");
  await fs.copy(fixture.artefacts.final_mp4, externalMp4);
  const probedPaths = [];

  const result = await validateFinalAvReview(fixture.review, validationOptions(fixture, {
    finalMp4Path: externalMp4,
    probeMedia: async (filePath) => {
      probedPaths.push(filePath);
      return passingProbe();
    },
    decodeMedia: async (filePath) => {
      probedPaths.push(filePath);
      return passingDecode();
    },
  }));

  assert.equal(result.verdict, "RED");
  assert.ok(
    result.blockers.includes("final_av_review_artefact_path_outside_story_dir:current_render"),
  );
  assert.deepEqual(probedPaths, [fixture.artefacts.final_mp4, fixture.artefacts.final_mp4]);
});

test("final AV review file validator reports canonical in-scope review evidence", async () => {
  const fixture = await makeReviewFixture();

  const result = await validateFinalAvReviewFile(fixture.reviewPath, validationOptions(fixture));

  assert.equal(result.verdict, "GREEN", result.blockers.join(","));
  assert.equal(result.evidence.review_path_scope.allowed, true);
  assert.equal(result.evidence.review_path, await fs.realpath(fixture.reviewPath));
  assert.equal(result.evidence.canonical_story_artifact_dir, await fs.realpath(fixture.root));
});

test("final AV review forwards an injected independent sampled-frame verifier", async () => {
  const fixture = await makeReviewFixture();
  const calls = [];

  const result = await validateFinalAvReview(fixture.review, validationOptions(fixture, {
    verifySampledFrameHashes: async (request) => {
      calls.push(request);
      return passingFrameHashVerification(request);
    },
  }));

  assert.equal(result.verdict, "GREEN", result.blockers.join(","));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].finalMp4Path, fixture.artefacts.final_mp4);
  assert.equal(result.evidence.decoded_forensic_report.frame_hash_verification.performed, true);
  assert.equal(result.evidence.decoded_forensic_report.frame_hash_verification.verified, true);
});

test("final AV review uses the production ffmpeg frame-hash verifier by default", async () => {
  const fixture = await makeReviewFixture();
  const report = await fs.readJson(fixture.artefacts.decoded_forensic_report);
  report.sampled_frames = report.sampled_frames.map((frame) => ({
    ...frame,
    hash: crypto
      .createHash("sha256")
      .update(Buffer.from(`pixels:${frame.time_seconds}`, "utf8"))
      .digest("hex"),
  }));
  await replaceForensicReport(fixture, report);
  const calls = [];

  const result = await validateFinalAvReview(fixture.review, validationOptions(fixture, {
    verifySampledFrameHashes: undefined,
    ffmpegPath: "trusted-ffmpeg",
    frameHashExecFile: async (executable, args, options) => {
      calls.push({ executable, args, options });
      const time = args[args.indexOf("-ss") + 1];
      return { stdout: Buffer.from(`pixels:${time}`, "utf8"), stderr: Buffer.alloc(0) };
    },
  }));

  assert.equal(result.verdict, "GREEN", result.blockers.join(","));
  assert.equal(calls.length, report.sampled_frames.length);
  assert.ok(calls.every((call) => call.executable === "trusted-ffmpeg"));
  assert.ok(calls.every((call) => call.args.includes(fixture.artefacts.final_mp4)));
  assert.ok(calls.every((call) => call.args.includes("rawvideo")));
  assert.equal(result.evidence.decoded_forensic_report.frame_hash_verification.performed, true);
  assert.equal(result.evidence.decoded_forensic_report.frame_hash_verification.verified, true);
});

test("ffmpeg frame verification retries an endpoint just before the declared time", async () => {
  const calls = [];
  const pixels = Buffer.from("last-decodable-frame", "utf8");

  const result = await verifySampledFrameHashesWithFfmpeg({
    finalMp4Path: "final.mp4",
    sampledFrames: [{ time_seconds: 1, hash: "ignored-by-extractor" }],
  }, {
    ffmpegPath: "trusted-ffmpeg",
    execFileImpl: async (_executable, args) => {
      const time = args[args.indexOf("-ss") + 1];
      calls.push(time);
      return { stdout: calls.length === 1 ? Buffer.alloc(0) : pixels };
    },
  });

  assert.deepEqual(calls, ["1", "0.95"]);
  assert.equal(result.checked, true);
  assert.equal(result.sampled_frames[0].time_seconds, 1);
  assert.equal(
    result.sampled_frames[0].sha256,
    crypto.createHash("sha256").update(pixels).digest("hex"),
  );
});

test("final AV review rejects a contact sheet with a valid signature that cannot fully decode", async () => {
  const fixture = await makeReviewFixture();
  await fs.writeFile(
    fixture.artefacts.contact_sheet,
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("truncated")]),
  );
  const hash = fingerprintFile(fixture.artefacts.contact_sheet).sha256;
  fixture.review.reviewed_artefact_fingerprints.contact_sheet = hash;
  fixture.review.contact_sheet_binding.contact_sheet_sha256 = hash;

  const result = await validateFinalAvReview(fixture.review, validationOptions(fixture));

  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("final_av_review_contact_sheet_decode_failed"));
  assert.equal(result.evidence.contact_sheet_inspection.fully_decoded, false);
});

test("final AV review rejects a decoded image too small to be a contact sheet", async () => {
  const fixture = await makeReviewFixture();
  const tinyPng = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: { r: 255, g: 107, b: 26 },
    },
  }).png().toBuffer();
  await fs.writeFile(fixture.artefacts.contact_sheet, tinyPng);
  const hash = fingerprintFile(fixture.artefacts.contact_sheet).sha256;
  fixture.review.reviewed_artefact_fingerprints.contact_sheet = hash;
  fixture.review.contact_sheet_binding.contact_sheet_sha256 = hash;

  const result = await validateFinalAvReview(fixture.review, validationOptions(fixture));

  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("final_av_review_contact_sheet_dimensions_invalid"));
  assert.equal(result.evidence.contact_sheet_inspection.fully_decoded, true);
});

test("final AV review rejects a contact sheet binding for a different final MP4", async () => {
  const fixture = await makeReviewFixture();
  const review = {
    ...fixture.review,
    contact_sheet_binding: {
      ...fixture.review.contact_sheet_binding,
      final_mp4_sha256: `sha256:${"0".repeat(64)}`,
    },
  };

  const result = await validateFinalAvReview(review, validationOptions(fixture));

  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("final_av_review_contact_sheet_mp4_binding_mismatch"));
  assert.equal(result.evidence.contact_sheet_binding.bound_to_current_media, false);
});

test("final AV review requires an explicit contact-sheet binding record", async () => {
  const fixture = await makeReviewFixture();
  const review = { ...fixture.review };
  delete review.contact_sheet_binding;

  const result = await validateFinalAvReview(review, validationOptions(fixture));

  assert.equal(result.verdict, "RED");
  assert.ok(result.blockers.includes("final_av_review_contact_sheet_binding_invalid"));
  assert.equal(result.evidence.contact_sheet_binding.present, false);
});

test("final AV review binds the contact sheet to its bytes, forensic report and sampled frames", async (t) => {
  const cases = [
    {
      name: "contact sheet hash",
      blocker: "final_av_review_contact_sheet_hash_binding_mismatch",
      mutate(binding) {
        binding.contact_sheet_sha256 = `sha256:${"1".repeat(64)}`;
      },
    },
    {
      name: "forensic report hash",
      blocker: "final_av_review_contact_sheet_forensic_report_binding_mismatch",
      mutate(binding) {
        binding.decoded_forensic_report_sha256 = `sha256:${"2".repeat(64)}`;
      },
    },
    {
      name: "sampled frame set",
      blocker: "final_av_review_contact_sheet_sampled_frames_binding_mismatch",
      mutate(binding) {
        binding.sampled_frames[2] = {
          ...binding.sampled_frames[2],
          hash: "3".repeat(64),
        };
      },
    },
  ];

  for (const row of cases) {
    await t.test(row.name, async () => {
      const fixture = await makeReviewFixture();
      const binding = structuredClone(fixture.review.contact_sheet_binding);
      row.mutate(binding);
      const result = await validateFinalAvReview(
        { ...fixture.review, contact_sheet_binding: binding },
        validationOptions(fixture),
      );

      assert.equal(result.verdict, "RED");
      assert.ok(result.blockers.includes(row.blocker));
      assert.equal(result.evidence.contact_sheet_binding.bound_to_current_media, false);
    });
  }
});
