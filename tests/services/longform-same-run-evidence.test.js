"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  materializeLongformSameRunEvidence,
} = require("../../lib/services/longform-same-run-evidence");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const { handlers } = require("../../lib/job-handlers");
const {
  STABILISATION_SCHEDULER_PROFILE,
  schedulesForProfile,
} = require("../../lib/scheduler");

const RUN_ID = "release-radar-2026-07-28-a";
const GENERATED_AT = "2026-07-28T10:30:00.000Z";
const SCRIPT = [
  "Xbox has confirmed four major additions for Game Pass this week.",
  "Each release targets a different kind of player.",
].join(" ");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeCoreFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-longform-same-run-"),
  );
  const scriptPath = path.join(root, "script.txt");
  const audioPath = path.join(root, "narration.wav");
  const masterPath = path.join(root, "master.mp4");
  const packagePath = path.join(root, "production-package.json");
  const outputDir = path.join(root, "evidence");

  fs.writeFileSync(scriptPath, SCRIPT, "utf8");
  fs.writeFileSync(audioPath, Buffer.from("fixture-longform-audio"));
  fs.writeFileSync(masterPath, Buffer.from("fixture-longform-master"));

  const hashes = {
    script: sha256(fs.readFileSync(scriptPath)),
    audio: sha256(fs.readFileSync(audioPath)),
    master: sha256(fs.readFileSync(masterPath)),
  };
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

  return {
    root,
    scriptPath,
    audioPath,
    masterPath,
    packagePath,
    outputDir,
    hashes: {
      ...hashes,
      package: sha256(fs.readFileSync(packagePath)),
    },
  };
}

function addWordTimestamps(fixture) {
  const words = SCRIPT.split(/\s+/).map((word, index) => ({
    text: word,
    start_seconds: Number((index * 0.42).toFixed(3)),
    end_seconds: Number(((index + 1) * 0.42).toFixed(3)),
  }));
  const timestampsPath = path.join(fixture.root, "word-timestamps.json");
  writeJson(timestampsPath, {
    schema_version: "pulse-word-timestamps-v1",
    run_id: RUN_ID,
    generated_at: GENERATED_AT,
    script_sha256: fixture.hashes.script,
    audio_sha256: fixture.hashes.audio,
    source_alignment_sha256: "a".repeat(64),
    provider: "elevenlabs",
    word_count: words.length,
    words,
  });
  return timestampsPath;
}

function addMachineEvidence(fixture) {
  const rightsPath = path.join(fixture.root, "rights-ledger.json");
  const rightsLedger = {
    schema_version: "pulse-longform-rights-ledger-v1",
    run_id: RUN_ID,
    master_sha256: fixture.hashes.master,
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "owned-longform-master",
        source_url: `pulse-owned://${RUN_ID}/master`,
        asset_sha256: fixture.hashes.master,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: `operator-evidence://${RUN_ID}/owned-motion`,
          sha256: "b".repeat(64),
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
      },
    ],
  };
  rightsLedger.ledger_sha256 = hashRightsLedger(rightsLedger);
  writeJson(rightsPath, rightsLedger);

  const platformVariantsPath = path.join(
    fixture.root,
    "platform-variants.json",
  );
  writeJson(platformVariantsPath, {
    schema_version: "pulse-longform-platform-variants-v1",
    run_id: RUN_ID,
    master_sha256: fixture.hashes.master,
    variants: [
      {
        id: "youtube-landscape-master",
        platform: "YOUTUBE_LONGFORM",
        path: fixture.masterPath,
        sha256: fixture.hashes.master,
        width: 1920,
        height: 1080,
        duration_seconds: 689.725,
        container: "mp4",
        video_codec: "h264",
        audio_codec: "aac",
      },
    ],
  });

  const decodedQaPath = path.join(fixture.root, "decoded-qa.json");
  writeJson(decodedQaPath, {
    schema_version: "pulse-decoded-qa-v1",
    run_id: RUN_ID,
    master_sha256: fixture.hashes.master,
    complete: true,
    verdict: "PASS",
    decoded_media: {
      width: 1920,
      height: 1080,
      duration_seconds: 689.725,
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

  return {
    rightsPath,
    platformVariantsPath,
    decodedQaPath,
  };
}

test("stabilisation refreshes the longform evidence lane daily without publish authority", () => {
  const schedule = schedulesForProfile(
    STABILISATION_SCHEDULER_PROFILE,
  ).find((item) => item.name === "longform_evidence_refresh");

  assert.ok(schedule);
  assert.equal(schedule.kind, "longform_evidence_refresh");
  assert.equal(schedule.cron_expr, "15 5 * * *");
  assert.equal(schedule.payload.live_publish_enabled, false);
});

test("scheduled longform evidence refresh reports missing same-run inputs honestly and never posts", async (t) => {
  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-longform-refresh-"),
  );
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

  const result = await handlers.longform_evidence_refresh(
    {
      payload: {
        now: GENERATED_AT,
        out_dir: outDir,
      },
    },
    { log() {} },
  );

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.no_publish, true);
  assert.equal(fs.existsSync(result.report_json), true);
  assert.equal(fs.existsSync(result.report_markdown), true);
  const report = JSON.parse(fs.readFileSync(result.report_json, "utf8"));
  assert.ok(report.blockers.includes("longform_run_id_required"));
  assert.ok(
    report.blockers.includes("longform_production_package_path_required"),
  );
  assert.equal(report.external_publish_authorised, false);
});

test("materialises a LOCAL_PROOF manifest binding one run's package, script, audio and master by observed SHA-256", async (t) => {
  const fixture = makeCoreFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const result = await materializeLongformSameRunEvidence({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    packagePath: fixture.packagePath,
    scriptPath: fixture.scriptPath,
    audioPath: fixture.audioPath,
    masterPath: fixture.masterPath,
    outputDir: fixture.outputDir,
  });

  assert.equal(
    result.manifest.schema_version,
    "pulse-longform-same-run-manifest-v1",
  );
  assert.equal(result.manifest.run_id, RUN_ID);
  assert.equal(result.manifest.mode, "LOCAL_PROOF");
  assert.equal(
    result.manifest.sources.production_package.sha256,
    fixture.hashes.package,
  );
  assert.equal(result.manifest.sources.script.sha256, fixture.hashes.script);
  assert.equal(
    result.manifest.sources.narration_audio.sha256,
    fixture.hashes.audio,
  );
  assert.equal(result.manifest.sources.master.sha256, fixture.hashes.master);
  assert.equal(result.manifest.package_bindings.all_match, true);
  assert.equal(result.report.status, "BLOCKED");
  assert.ok(result.report.blockers.includes("word_timestamps_missing"));
  assert.ok(result.report.blockers.includes("rights_lineage_missing"));
  assert.ok(result.report.blockers.includes("platform_variants_missing"));
  assert.ok(result.report.blockers.includes("decoded_qa_missing"));
  assert.equal(
    result.humanReviewPacket.status,
    "BLOCKED_MACHINE_EVIDENCE",
  );
  assert.equal(result.report.external_publish_authorised, false);
  assert.equal(result.report.database_mutation_authorised, false);
  assert.equal(result.report.oauth_mutation_authorised, false);
  assert.equal(result.report.network_used, false);
  assert.ok(fs.existsSync(result.paths.manifest));
  assert.ok(fs.existsSync(result.paths.report));
  assert.ok(fs.existsSync(result.paths.captionManifest));
  assert.ok(fs.existsSync(result.paths.rightsLineage));
  assert.ok(fs.existsSync(result.paths.platformVariants));
  assert.ok(fs.existsSync(result.paths.decodedQa));
  assert.ok(fs.existsSync(result.paths.humanReviewPacket));
  assert.equal(result.paths.srt, undefined);
});

test("fails the same-run core closed when the production package contract is not the governed longform schema", async (t) => {
  const fixture = makeCoreFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const productionPackage = JSON.parse(
    fs.readFileSync(fixture.packagePath, "utf8"),
  );
  productionPackage.schema_version = "legacy-unbound-package-v0";
  writeJson(fixture.packagePath, productionPackage);

  const result = await materializeLongformSameRunEvidence({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    packagePath: fixture.packagePath,
    scriptPath: fixture.scriptPath,
    audioPath: fixture.audioPath,
    masterPath: fixture.masterPath,
    outputDir: fixture.outputDir,
  });

  assert.equal(result.manifest.package_bindings.all_match, false);
  assert.equal(result.report.same_run_core_bound, false);
  assert.ok(
    result.report.blockers.includes(
      "production_package_schema_invalid",
    ),
  );
});

test("requires exact provider word alignment then emits hash-bound canonical timestamps, caption manifest and SRT", async (t) => {
  const fixture = makeCoreFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const timestampsPath = addWordTimestamps(fixture);

  const result = await materializeLongformSameRunEvidence({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    packagePath: fixture.packagePath,
    scriptPath: fixture.scriptPath,
    audioPath: fixture.audioPath,
    masterPath: fixture.masterPath,
    timestampsPath,
    outputDir: fixture.outputDir,
  });

  assert.equal(
    result.timestamps.schema_version,
    "pulse-longform-word-timestamps-binding-v1",
  );
  assert.equal(result.timestamps.exact_script_match, true);
  assert.equal(result.timestamps.timing_basis, "provider_word_alignment");
  assert.equal(result.timestamps.words.length, SCRIPT.split(/\s+/).length);
  assert.equal(
    result.captionManifest.schema_version,
    "pulse-longform-caption-manifest-v1",
  );
  assert.equal(
    result.captionManifest.bindings.script_sha256,
    fixture.hashes.script,
  );
  assert.equal(
    result.captionManifest.bindings.audio_sha256,
    fixture.hashes.audio,
  );
  assert.equal(
    result.captionManifest.bindings.master_sha256,
    fixture.hashes.master,
  );
  assert.equal(
    result.captionManifest.outputs.srt.sha256,
    sha256(fs.readFileSync(result.paths.srt)),
  );
  assert.ok(result.captionManifest.outputs.srt.cue_count >= 2);
  assert.match(fs.readFileSync(result.paths.srt, "utf8"), /^1\r?\n00:00:00,000/);
  assert.ok(!result.report.blockers.includes("word_timestamps_missing"));
  assert.ok(!result.report.blockers.includes("word_timestamps_invalid"));
});

test("blocks estimated or synthetic timing data from being presented as real word alignment", async (t) => {
  const fixture = makeCoreFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const timestampsPath = addWordTimestamps(fixture);
  const estimated = JSON.parse(fs.readFileSync(timestampsPath, "utf8"));
  estimated.provider = "estimated";
  estimated.timing_basis = "uniform_word_estimate";
  writeJson(timestampsPath, estimated);

  const result = await materializeLongformSameRunEvidence({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    packagePath: fixture.packagePath,
    scriptPath: fixture.scriptPath,
    audioPath: fixture.audioPath,
    masterPath: fixture.masterPath,
    timestampsPath,
    outputDir: fixture.outputDir,
  });

  assert.equal(result.timestamps, null);
  assert.equal(result.captionManifest.ready, false);
  assert.equal(result.paths.srt, undefined);
  assert.ok(
    result.report.blockers.includes(
      "word_timestamps_provider_alignment_required",
    ),
  );
});

test("emits rights lineage, platform variants, decoded-QA binding and a hash-bound human review packet when machine evidence is complete", async (t) => {
  const fixture = makeCoreFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const timestampsPath = addWordTimestamps(fixture);
  const machine = addMachineEvidence(fixture);

  const result = await materializeLongformSameRunEvidence({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    packagePath: fixture.packagePath,
    scriptPath: fixture.scriptPath,
    audioPath: fixture.audioPath,
    masterPath: fixture.masterPath,
    timestampsPath,
    rightsPath: machine.rightsPath,
    platformVariantsPath: machine.platformVariantsPath,
    decodedQaPath: machine.decodedQaPath,
    outputDir: fixture.outputDir,
  });

  assert.equal(
    result.rightsLineage.schema_version,
    "pulse-longform-rights-lineage-v1",
  );
  assert.equal(result.rightsLineage.status, "CLEARED");
  assert.equal(
    result.rightsLineage.bindings.master_sha256,
    fixture.hashes.master,
  );
  assert.equal(
    result.platformVariants.schema_version,
    "pulse-longform-platform-variants-binding-v1",
  );
  assert.equal(result.platformVariants.ready, true);
  assert.equal(result.platformVariants.variants.length, 1);
  assert.equal(
    result.platformVariants.variants[0].observed_sha256,
    fixture.hashes.master,
  );
  assert.equal(
    result.decodedQa.schema_version,
    "pulse-longform-decoded-qa-binding-v1",
  );
  assert.equal(result.decodedQa.ready, true);
  assert.equal(
    result.decodedQa.bindings.master_sha256,
    fixture.hashes.master,
  );
  assert.equal(
    result.decodedQa.bindings.caption_manifest_sha256,
    sha256(fs.readFileSync(result.paths.captionManifest)),
  );
  assert.equal(
    result.humanReviewPacket.schema_version,
    "pulse-longform-human-review-packet-v1",
  );
  assert.equal(
    result.humanReviewPacket.status,
    "PENDING_HUMAN_REVIEW",
  );
  assert.equal(result.humanReviewPacket.machine_evidence_complete, true);
  assert.equal(result.humanReviewPacket.publish_authorised, false);
  assert.equal(
    result.report.status,
    "MACHINE_EVIDENCE_COMPLETE_AWAITING_HUMAN_REVIEW",
  );
  assert.deepEqual(result.report.blockers, ["human_review_pending"]);
  for (const filePath of [
    result.paths.rightsLineage,
    result.paths.platformVariants,
    result.paths.decodedQa,
    result.paths.humanReviewPacket,
  ]) {
    assert.ok(fs.existsSync(filePath), filePath);
  }
});

test("writes a human-readable proof summary without claiming publication authority", async (t) => {
  const fixture = makeCoreFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const result = await materializeLongformSameRunEvidence({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    packagePath: fixture.packagePath,
    scriptPath: fixture.scriptPath,
    audioPath: fixture.audioPath,
    masterPath: fixture.masterPath,
    outputDir: fixture.outputDir,
  });

  const summary = fs.readFileSync(result.paths.summary, "utf8");
  assert.match(summary, /^# Longform Same-Run Evidence/m);
  assert.match(summary, /Status: \*\*BLOCKED\*\*/);
  assert.match(summary, /word_timestamps_missing/);
  assert.match(summary, /External publication authorised: \*\*No\*\*/);
});
