"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  buildWeeklyLongformWorkOrder,
  materializeWeeklyLongformWorkOrder,
} = require("../../lib/services/weekly-longform-work-order");
const {
  materializeLongformSameRunEvidence,
} = require("../../lib/services/longform-same-run-evidence");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");

const GENERATED_AT = "2026-07-28T12:00:00.000Z";
const RUN_ID = "weekly-flagship-2026-07-28";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return sha256(fs.readFileSync(filePath));
}

function makeFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-weekly-longform-"),
  );
  return {
    root,
    outputDir: path.join(root, "work-order"),
  };
}

function createGovernedVisualPack(
  fixture,
  id,
  assets = [
    {
      suffix: "gameplay",
      role: "gameplay",
      media_type: "video",
      width: 1920,
      height: 1080,
      duration_seconds: 24,
      subject_match_quality: "exact_game_match",
      counted_for_premium: true,
    },
    {
      suffix: "screenshot",
      role: "official_screenshot",
      media_type: "image",
      width: 1920,
      height: 1080,
      duration_seconds: null,
      subject_match_quality: "exact_game_match",
      counted_for_premium: true,
    },
    {
      suffix: "key-art",
      role: "key_art",
      media_type: "image",
      width: 1920,
      height: 1080,
      duration_seconds: null,
      subject_match_quality: "exact_game_match",
      counted_for_premium: true,
    },
    {
      suffix: "hook-card",
      role: "hook_slam",
      media_type: "image",
      width: 1080,
      height: 1920,
      duration_seconds: null,
      subject_match_quality: "generic_stock_or_filler",
      counted_for_premium: false,
    },
  ],
) {
  const visualRoot = path.join(fixture.root, `${id}-visuals`);
  fs.mkdirSync(visualRoot, { recursive: true });
  const manifestAssets = assets.map((asset) => {
    const extension = asset.media_type === "video" ? "mp4" : "png";
    const relativePath = `${asset.suffix}.${extension}`;
    const assetPath = path.join(visualRoot, relativePath);
    fs.writeFileSync(assetPath, Buffer.from(`${id}:${asset.suffix}`));
    return {
      path: relativePath,
      sha256: sha256(fs.readFileSync(assetPath)),
      media_type: asset.media_type,
      role: asset.role,
      ownership: "owned",
      width: asset.width,
      height: asset.height,
      duration_seconds: asset.duration_seconds,
      generator_identity: "pulse-governed-visual-intake-v1",
      rights_basis: "OWNED",
      attribution_required: false,
      subject_match_quality: asset.subject_match_quality,
      counted_for_premium: asset.counted_for_premium,
      provenance: {
        source:
          asset.counted_for_premium === true
            ? "verified_exact_subject_intake"
            : "repository_owned_generation",
        third_party_media_used: false,
      },
    };
  });
  const manifestPath = path.join(visualRoot, "owned-motion-manifest.json");
  const manifestSha256 = writeJson(manifestPath, {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: id,
    generated_at: GENERATED_AT,
    assets: manifestAssets,
  });
  const items = manifestAssets.map((asset) => {
    const suffix = path.basename(asset.path, path.extname(asset.path));
    return {
      item_id: `${id}-${suffix}`,
      source_url: `pulse-owned://${id}/${suffix}`,
      local_path: path.join(visualRoot, asset.path),
      asset_sha256: asset.sha256,
      included_in_final: true,
      rights_decision: "CLEARED",
      rights_basis: "OWNED",
      rights_evidence: {
        reference: manifestPath,
        sha256: manifestSha256,
      },
      attribution_decision: "NOT_REQUIRED",
      attribution_text: null,
      usage: asset.role,
      motion_family: asset.role,
      exact_subject_motion_seconds:
        asset.media_type === "video" &&
        asset.counted_for_premium === true
          ? asset.duration_seconds
          : 0,
    };
  });
  return {
    manifestPath,
    manifestSha256,
    manifestAssets,
    items,
  };
}

function candidate(fixture, index, overrides = {}) {
  const id = overrides.id || `weekly-story-${index}`;
  const primarySourceUrl =
    overrides.primary_source_url ||
    `https://publisher.example/news/${id}`;
  const publishedAt =
    overrides.published_at ||
    new Date(Date.parse(GENERATED_AT) - index * 3_600_000).toISOString();
  const sourcePath = path.join(fixture.root, `${id}-source.json`);
  const sourceSha256 = writeJson(sourcePath, {
    schema_version: "pulse-source-evidence-v1",
    source_url: primarySourceUrl,
    source_type: "official",
    publisher: `Publisher ${index}`,
    published_at: publishedAt,
    claims: [
      {
        claim_id: `${id}-claim-1`,
        text: `Verified fact for weekly story ${index}.`,
        source_locator: "official announcement paragraph 1",
      },
    ],
  });

  const visualPack = createGovernedVisualPack(fixture, id);
  const rightsPath = path.join(fixture.root, `${id}-rights.json`);
  const rights = {
    schema_version: "pulse-weekly-longform-rights-ledger-v1",
    story_id: id,
    ledger_version: 1,
    decision: "CLEARED",
    items: visualPack.items,
    owned_motion_manifest: {
      path: visualPack.manifestPath,
      file_sha256: visualPack.manifestSha256,
    },
    safety: {
      owned_motion_only: false,
      third_party_media_used: false,
      third_party_music_used: false,
      rights_synthesised: false,
    },
  };
  rights.ledger_sha256 = hashRightsLedger(rights);
  const rightsSha256 = writeJson(rightsPath, rights);

  return {
    id,
    title: overrides.title || `Verified weekly story ${index}`,
    published_at: publishedAt,
    primary_source_url: primarySourceUrl,
    verification_status:
      overrides.verification_status || "CONFIRMED",
    weekly_priority_score:
      overrides.weekly_priority_score ?? 100 - index,
    source_evidence: {
      path: sourcePath,
      sha256: sourceSha256,
    },
    rights_ledger: {
      path: rightsPath,
      sha256: rightsSha256,
    },
    weekly_longform_pitch: {
      section_title: `Story ${index}`,
      angle: `Why verified story ${index} matters to players`,
      why_it_matters: `This changes a concrete player decision ${index}.`,
      claim_ids: [`${id}-claim-1`],
      script_section: `Verified story ${index} has a concrete consequence for players.`,
      visual_beats: [
        {
          beat_id: `${id}-beat-1`,
          purpose: "Establish the verified announcement",
          asset_item_id: `${id}-gameplay`,
          treatment: "Owned platform card with claim-led typography",
          claim_ids: [`${id}-claim-1`],
        },
      ],
      derivative_hooks: {
        short: `The one thing players need from story ${index}.`,
        social_thread: `Three verified implications from story ${index}.`,
      },
    },
    ...overrides,
  };
}

function prose(label, targetWords) {
  const vocabulary = [
    label,
    "verified",
    "context",
    "shows",
    "players",
    "exactly",
    "what",
    "changed",
    "why",
    "the",
    "timing",
    "matters",
    "and",
    "which",
    "details",
    "remain",
    "unconfirmed",
    "for",
    "now",
  ];
  const words = [];
  while (words.length < targetWords) words.push(...vocabulary);
  return `${words.slice(0, targetWords).join(" ")}.`;
}

function editorialCandidate(fixture, index) {
  const story = candidate(fixture, index);
  const claimId = `${story.id}-claim-1`;
  story.weekly_longform_pitch = {
    section_title: `The verified consequence from story ${index}`,
    angle: `Translate story ${index} into a concrete player decision`,
    why_it_matters:
      `Players need the timing, affected platforms and remaining unknowns from story ${index}.`,
    claim_ids: [claimId],
    script_section: prose(`story-${index}`, 185),
    visual_beats: [1, 2, 3].map((beat) => ({
      beat_id: `${story.id}-beat-${beat}`,
      purpose:
        beat === 1
          ? "Establish the official announcement"
          : beat === 2
            ? "Explain the player consequence"
            : "Separate confirmed details from unknowns",
      asset_item_id: [
        `${story.id}-gameplay`,
        `${story.id}-screenshot`,
        `${story.id}-key-art`,
      ][beat - 1],
      treatment:
        beat === 1
          ? "Owned platform opener"
          : beat === 2
            ? "Owned comparison diagram"
            : "Owned confirmed-versus-unknown card",
      claim_ids: [claimId],
    })),
    derivative_hooks: {
      short: `The one verified detail players need from story ${index}.`,
      social_thread: `Three practical implications from story ${index}.`,
    },
  };
  return story;
}

function weeklyEditorialFrame() {
  return {
    episode_title: "The Six Gaming Stories That Changed This Week",
    editorial_thesis:
      "This briefing separates confirmed changes from noise and explains the practical player impact.",
    opening_script: prose("opening", 65),
    closing_script: prose("closing", 65),
  };
}

async function materializeCompleteProductionEvidence(
  fixture,
  workOrder,
) {
  const productionRoot = path.join(fixture.root, "production");
  fs.mkdirSync(productionRoot, { recursive: true });
  const scriptPath = path.join(productionRoot, "script.txt");
  const audioPath = path.join(productionRoot, "narration.wav");
  const masterPath = path.join(productionRoot, "master.mp4");
  fs.writeFileSync(scriptPath, workOrder.script.full_script, "utf8");
  fs.writeFileSync(audioPath, Buffer.from("real-fixture-narration-bytes"));
  fs.writeFileSync(masterPath, Buffer.from("real-fixture-master-bytes"));
  const hashes = {
    script: sha256(fs.readFileSync(scriptPath)),
    audio: sha256(fs.readFileSync(audioPath)),
    master: sha256(fs.readFileSync(masterPath)),
  };

  const packagePath = path.join(productionRoot, "production-package.json");
  writeJson(packagePath, {
    schema_version: "pulse-longform-production-package-v1",
    run_id: RUN_ID,
    generated_at: GENERATED_AT,
    assets: {
      script: { path: scriptPath, sha256: hashes.script },
      narration_audio: { path: audioPath, sha256: hashes.audio },
      master: { path: masterPath, sha256: hashes.master },
    },
  });

  const words = workOrder.script.full_script
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({
      text: word,
      start_seconds: Number((index * 0.4).toFixed(3)),
      end_seconds: Number(((index + 1) * 0.4).toFixed(3)),
    }));
  const timestampsPath = path.join(productionRoot, "word-timestamps.json");
  writeJson(timestampsPath, {
    schema_version: "pulse-word-timestamps-v1",
    run_id: RUN_ID,
    generated_at: GENERATED_AT,
    script_sha256: hashes.script,
    audio_sha256: hashes.audio,
    source_alignment_sha256: "c".repeat(64),
    provider: "elevenlabs",
    word_count: words.length,
    words,
  });

  const rightsPath = path.join(productionRoot, "rights-ledger.json");
  const rights = {
    schema_version: "pulse-longform-rights-ledger-v1",
    run_id: RUN_ID,
    master_sha256: hashes.master,
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "weekly-owned-master",
        source_url: `pulse-owned://${RUN_ID}/master`,
        asset_sha256: hashes.master,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: `operator-evidence://${RUN_ID}/master`,
          sha256: "d".repeat(64),
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
      },
    ],
  };
  rights.ledger_sha256 = hashRightsLedger(rights);
  writeJson(rightsPath, rights);

  const variantsPath = path.join(productionRoot, "variants.json");
  writeJson(variantsPath, {
    schema_version: "pulse-longform-platform-variants-v1",
    run_id: RUN_ID,
    master_sha256: hashes.master,
    variants: [
      {
        id: "youtube-landscape-master",
        platform: "YOUTUBE_LONGFORM",
        path: masterPath,
        sha256: hashes.master,
        width: 1920,
        height: 1080,
        duration_seconds: workOrder.script.estimated_duration_seconds,
        container: "mp4",
        video_codec: "h264",
        audio_codec: "aac",
      },
    ],
  });

  const decodedQaPath = path.join(productionRoot, "decoded-qa.json");
  writeJson(decodedQaPath, {
    schema_version: "pulse-decoded-qa-v1",
    run_id: RUN_ID,
    master_sha256: hashes.master,
    complete: true,
    verdict: "PASS",
    decoded_media: {
      width: 1920,
      height: 1080,
      duration_seconds: workOrder.script.estimated_duration_seconds,
      container: "mp4",
      video_codec: "h264",
      audio_codec: "aac",
    },
    checks: {
      video_decode: { pass: true },
      audio_decode: { pass: true },
      captions: { pass: true },
      av_sync: { pass: true },
      black_frames: { pass: true },
      freeze_frames: { pass: true },
      blur: { pass: true },
      repetition: { pass: true },
    },
  });

  const evidence = await materializeLongformSameRunEvidence({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    packagePath,
    scriptPath,
    audioPath,
    masterPath,
    timestampsPath,
    rightsPath,
    platformVariantsPath: variantsPath,
    decodedQaPath,
    outputDir: path.join(productionRoot, "same-run-evidence"),
  });
  return {
    manifest: {
      path: evidence.paths.manifest,
      sha256: sha256(fs.readFileSync(evidence.paths.manifest)),
    },
    report: {
      path: evidence.paths.report,
      sha256: sha256(fs.readFileSync(evidence.paths.report)),
    },
    caption_manifest: {
      path: evidence.paths.captionManifest,
      sha256: sha256(fs.readFileSync(evidence.paths.captionManifest)),
    },
    human_review_packet: {
      path: evidence.paths.humanReviewPacket,
      sha256: sha256(
        fs.readFileSync(evidence.paths.humanReviewPacket),
      ),
    },
  };
}

test("selects at most six highest-priority confirmed stories from the exact seven-day window and rejects discovery-only inputs", (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const candidates = [
    candidate(fixture, 1),
    candidate(fixture, 2),
    candidate(fixture, 3),
    candidate(fixture, 4),
    candidate(fixture, 5),
    candidate(fixture, 6),
    candidate(fixture, 7),
    candidate(fixture, 8, {
      id: "unconfirmed-story",
      verification_status: "DISCOVERY_ONLY",
      weekly_priority_score: 1_000,
    }),
    candidate(fixture, 9, {
      id: "stale-story",
      published_at: "2026-07-19T11:59:59.000Z",
      weekly_priority_score: 999,
    }),
  ];

  const workOrder = buildWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    editorialFrame: {},
  });

  assert.equal(
    workOrder.schema_version,
    "pulse-weekly-longform-work-order-v1",
  );
  assert.equal(workOrder.mode, "LOCAL_PROOF");
  assert.equal(workOrder.selection.minimum_story_count, 4);
  assert.equal(workOrder.selection.maximum_story_count, 6);
  assert.deepEqual(
    workOrder.selection.selected.map((story) => story.story_id),
    [
      "weekly-story-1",
      "weekly-story-2",
      "weekly-story-3",
      "weekly-story-4",
      "weekly-story-5",
      "weekly-story-6",
    ],
  );
  assert.ok(
    workOrder.selection.rejected.some(
      (item) =>
        item.story_id === "unconfirmed-story" &&
        item.blockers.includes("confirmed_verification_required"),
    ),
  );
  assert.ok(
    workOrder.selection.rejected.some(
      (item) =>
        item.story_id === "stale-story" &&
        item.blockers.includes("story_outside_weekly_window"),
    ),
  );
  assert.equal(workOrder.safety.external_publish_authorised, false);
});

test("rejects source-byte tampering and attribution-only media rights before weekly selection", (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const sourceTampered = candidate(fixture, 20, {
    id: "source-tampered-story",
    weekly_priority_score: 500,
  });
  fs.appendFileSync(sourceTampered.source_evidence.path, "\n");

  const attributionOnly = candidate(fixture, 21, {
    id: "attribution-only-story",
    weekly_priority_score: 499,
  });
  const rights = JSON.parse(
    fs.readFileSync(attributionOnly.rights_ledger.path, "utf8"),
  );
  rights.items[0].rights_basis = "ATTRIBUTION";
  rights.items[0].attribution_decision = "REQUIRED_AND_SUPPLIED";
  rights.items[0].attribution_text = "Credit: Example publisher";
  rights.ledger_sha256 = hashRightsLedger(rights);
  attributionOnly.rights_ledger.sha256 = writeJson(
    attributionOnly.rights_ledger.path,
    rights,
  );

  const workOrder = buildWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates: [
      editorialCandidate(fixture, 1),
      editorialCandidate(fixture, 2),
      editorialCandidate(fixture, 3),
      editorialCandidate(fixture, 4),
      sourceTampered,
      attributionOnly,
    ],
    editorialFrame: weeklyEditorialFrame(),
  });

  const sourceRejection = workOrder.selection.rejected.find(
    (item) => item.story_id === "source-tampered-story",
  );
  assert.ok(
    sourceRejection.blockers.includes("source_evidence_sha256_mismatch"),
  );
  const rightsRejection = workOrder.selection.rejected.find(
    (item) => item.story_id === "attribution-only-story",
  );
  assert.ok(
    rightsRejection.blockers.includes("attribution_is_not_permission"),
  );
  assert.ok(
    rightsRejection.blockers.includes(
      "rights_ledger_item_basis_required",
    ),
  );
});

test("fails closed when the weekly visual-inventory manifest binding is missing", (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const missingManifest = editorialCandidate(fixture, 1);
  const rights = JSON.parse(
    fs.readFileSync(missingManifest.rights_ledger.path, "utf8"),
  );
  delete rights.owned_motion_manifest;
  rights.ledger_sha256 = hashRightsLedger(rights);
  missingManifest.rights_ledger.sha256 = writeJson(
    missingManifest.rights_ledger.path,
    rights,
  );

  const workOrder = buildWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates: [
      missingManifest,
      editorialCandidate(fixture, 2),
      editorialCandidate(fixture, 3),
      editorialCandidate(fixture, 4),
    ],
    editorialFrame: weeklyEditorialFrame(),
  });

  const rejected = workOrder.selection.rejected.find(
    (item) => item.story_id === missingManifest.id,
  );
  assert.ok(rejected);
  assert.ok(
    rejected.blockers.includes(
      "weekly_longform_visual_inventory_path_required",
    ),
  );
  assert.ok(
    rejected.blockers.includes(
      "weekly_longform_visual_inventory_sha256_required",
    ),
  );
});

test("rejects a hash-bound portrait template-only visual pack before weekly production admission", (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const templateOnly = editorialCandidate(fixture, 1);
  const templatePack = createGovernedVisualPack(fixture, templateOnly.id, [
    {
      suffix: "hook-slam",
      role: "hook_slam",
      media_type: "image",
      width: 1080,
      height: 1920,
      duration_seconds: null,
      subject_match_quality: "generic_stock_or_filler",
      counted_for_premium: false,
    },
    {
      suffix: "before-after",
      role: "before_after_change",
      media_type: "image",
      width: 1080,
      height: 1920,
      duration_seconds: null,
      subject_match_quality: "generic_stock_or_filler",
      counted_for_premium: false,
    },
    {
      suffix: "timeline",
      role: "verified_timeline",
      media_type: "image",
      width: 1080,
      height: 1920,
      duration_seconds: null,
      subject_match_quality: "generic_stock_or_filler",
      counted_for_premium: false,
    },
    {
      suffix: "backbone",
      role: "owned_motion_backbone",
      media_type: "video",
      width: 1080,
      height: 1920,
      duration_seconds: 28,
      subject_match_quality: "generic_stock_or_filler",
      counted_for_premium: false,
    },
  ]);
  const rights = {
    schema_version: "pulse-weekly-longform-rights-ledger-v1",
    story_id: templateOnly.id,
    ledger_version: 1,
    decision: "CLEARED",
    items: templatePack.items,
    owned_motion_manifest: {
      path: templatePack.manifestPath,
      file_sha256: templatePack.manifestSha256,
    },
    safety: {
      owned_motion_only: true,
      third_party_media_used: false,
      third_party_music_used: false,
      rights_synthesised: false,
    },
  };
  rights.ledger_sha256 = hashRightsLedger(rights);
  templateOnly.rights_ledger.sha256 = writeJson(
    templateOnly.rights_ledger.path,
    rights,
  );

  const workOrder = buildWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates: [
      templateOnly,
      editorialCandidate(fixture, 2),
      editorialCandidate(fixture, 3),
      editorialCandidate(fixture, 4),
    ],
    editorialFrame: weeklyEditorialFrame(),
  });

  const rejected = workOrder.selection.rejected.find(
    (item) => item.story_id === templateOnly.id,
  );
  assert.ok(rejected);
  assert.ok(
    rejected.blockers.includes(
      "weekly_longform_visual_pack_template_only",
    ),
  );
  assert.ok(
    rejected.blockers.includes(
      "weekly_longform_landscape_exact_subject_assets_below_3",
    ),
  );
  assert.ok(
    rejected.blockers.includes(
      "weekly_longform_landscape_exact_subject_motion_required",
    ),
  );
  assert.equal(
    rejected.visual_asset_admission.status,
    "HOLD",
  );
  assert.equal(
    workOrder.production_runner_admission.status,
    "HOLD",
  );
});

test("admits only three distinct landscape exact-subject assets including motion and excludes template cards", (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4, 5, 6].map((index) =>
    editorialCandidate(fixture, index),
  );

  const workOrder = buildWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    editorialFrame: weeklyEditorialFrame(),
  });

  assert.equal(workOrder.production_runner_admission.status, "READY");
  const selected = workOrder.selection.selected[0];
  assert.deepEqual(
    selected.visual_asset_admission.admitted_asset_ids,
    [
      `${selected.story_id}-gameplay`,
      `${selected.story_id}-key-art`,
      `${selected.story_id}-screenshot`,
    ],
  );
  assert.deepEqual(
    selected.rights_ledger.decision.items.map((item) => item.item_id),
    selected.visual_asset_admission.admitted_asset_ids,
  );
  assert.ok(
    selected.visual_asset_admission.excluded_asset_ids.includes(
      `${selected.story_id}-hook-card`,
    ),
  );
});

test("assembles an 8–12 minute claim-bound editorial dossier, script, visual beat plan and derivative plan without synthesising copy", (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4, 5, 6].map((index) =>
    editorialCandidate(fixture, index),
  );
  const editorialFrame = weeklyEditorialFrame();

  const workOrder = buildWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    editorialFrame,
  });

  assert.equal(workOrder.dossier.stories.length, 6);
  assert.equal(workOrder.dossier.editorial_thesis, editorialFrame.editorial_thesis);
  assert.ok(
    workOrder.dossier.stories.every(
      (story) =>
        story.verified_claims.length === 1 &&
        /^[a-f0-9]{64}$/.test(story.source_evidence.sha256) &&
        /^[a-f0-9]{64}$/.test(story.rights_lineage.sha256),
    ),
  );
  assert.equal(workOrder.script.word_count, 1_240);
  assert.ok(workOrder.script.estimated_duration_seconds >= 480);
  assert.ok(workOrder.script.estimated_duration_seconds <= 720);
  assert.equal(
    workOrder.script.full_script,
    [
      editorialFrame.opening_script,
      ...candidates.map(
        (story) => story.weekly_longform_pitch.script_section,
      ),
      editorialFrame.closing_script,
    ].join("\n\n"),
  );
  assert.equal(
    workOrder.script.sha256,
    sha256(workOrder.script.full_script),
  );
  assert.equal(workOrder.visual_beat_plan.beats.length, 18);
  assert.ok(
    workOrder.visual_beat_plan.beats.every(
      (beat) =>
        beat.rights_bound === true &&
        beat.claims_bound === true &&
        beat.timing_basis === "script_runtime_estimate_only",
    ),
  );
  assert.equal(workOrder.derivative_plan.items.length, 12);
  assert.deepEqual(
    new Set(
      workOrder.derivative_plan.items.map((item) => item.format),
    ),
    new Set(["vertical_short", "social_thread"]),
  );
  assert.equal(workOrder.safety.claims_synthesised, false);
  assert.equal(workOrder.safety.rights_synthesised, false);
  assert.ok(
    !workOrder.production_readiness.blockers.includes(
      "editorial_dossier_incomplete",
    ),
  );
  assert.deepEqual(workOrder.production_runner_admission, {
    status: "READY",
    scope: "LOCAL_PROOF_PRODUCTION_RUNNER",
    blockers: [],
  });
  assert.ok(
    workOrder.production_readiness.blockers.includes(
      "final_narration_evidence_required",
    ),
  );
});

test("becomes ready only for human AV review when real same-run narration, provider alignment and master evidence match the exact script", async (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4, 5, 6].map((index) =>
    editorialCandidate(fixture, index),
  );
  const editorialFrame = weeklyEditorialFrame();
  const planned = buildWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    editorialFrame,
  });
  const productionEvidence =
    await materializeCompleteProductionEvidence(fixture, planned);

  const workOrder = buildWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    editorialFrame,
    productionEvidence,
  });

  assert.equal(
    workOrder.production_readiness.status,
    "READY_FOR_HUMAN_AV_REVIEW",
  );
  assert.equal(
    workOrder.production_readiness.real_narration_verified,
    true,
  );
  assert.equal(
    workOrder.production_readiness.provider_alignment_verified,
    true,
  );
  assert.equal(
    workOrder.production_readiness.master_verified,
    true,
  );
  assert.equal(
    workOrder.production_readiness.script_sha256,
    workOrder.script.sha256,
  );
  assert.deepEqual(workOrder.production_readiness.blockers, [
    "human_av_review_pending",
  ]);
  assert.equal(workOrder.safety.external_publish_authorised, false);
});

test("returns to HOLD when a previously bound narration file changes after same-run evidence was emitted", async (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4, 5, 6].map((index) =>
    editorialCandidate(fixture, index),
  );
  const editorialFrame = weeklyEditorialFrame();
  const planned = buildWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    editorialFrame,
  });
  const productionEvidence =
    await materializeCompleteProductionEvidence(fixture, planned);
  const manifest = JSON.parse(
    fs.readFileSync(productionEvidence.manifest.path, "utf8"),
  );
  fs.appendFileSync(manifest.sources.narration_audio.path, "tampered");

  const workOrder = buildWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    editorialFrame,
    productionEvidence,
  });

  assert.equal(workOrder.production_readiness.status, "HOLD");
  assert.equal(
    workOrder.production_readiness.real_narration_verified,
    false,
  );
  assert.ok(
    workOrder.production_readiness.blockers.includes(
      "same_run_narration_source_sha256_mismatch",
    ),
  );
  assert.ok(
    workOrder.production_readiness.blockers.includes(
      "final_narration_evidence_required",
    ),
  );
});

test("materialises the governed LOCAL_PROOF work order as hashable JSON and an operator-readable Markdown brief", async (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4, 5, 6].map((index) =>
    editorialCandidate(fixture, index),
  );

  const result = await materializeWeeklyLongformWorkOrder({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    editorialFrame: weeklyEditorialFrame(),
    outputDir: fixture.outputDir,
  });

  assert.ok(fs.existsSync(result.paths.json));
  assert.ok(fs.existsSync(result.paths.markdown));
  const written = JSON.parse(fs.readFileSync(result.paths.json, "utf8"));
  assert.equal(written.run_id, RUN_ID);
  assert.equal(written.mode, "LOCAL_PROOF");
  assert.match(written.work_order_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.json_sha256, sha256(fs.readFileSync(result.paths.json)));
  const markdown = fs.readFileSync(result.paths.markdown, "utf8");
  assert.match(markdown, /^# Pulse Gaming Weekly Flagship Work Order/m);
  assert.match(markdown, /Target runtime: 8–12 minutes/);
  assert.match(markdown, /Status: \*\*HOLD\*\*/);
  assert.match(markdown, /final_narration_evidence_required/);
  assert.match(markdown, /External publication authorised: \*\*No\*\*/);
});
