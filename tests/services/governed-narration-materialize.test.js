"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { cleanScriptForAlignment } = require("../../lib/script-clean");
const {
  GovernedNarrationMaterializeError,
  buildGovernedNarrationPlan,
  buildWordRecords,
  materializeGovernedNarration,
  validateApplyAuthority,
  writeGovernedNarrationPlan,
} = require("../../lib/services/governed-narration-materialize");

const STORY_ID = "official_d86953ca92ca";
const SCRIPT = [
  "Final Fantasy XIV just revealed a tank that fights with two giant shields.",
  "Bastion arrives in Evercold and only works in Evolved Mode.",
  "The expansion makes its story less linear, auto-scales content and adds a Final Fantasy VII raid.",
  "The MMO hits Switch 2 on August fourth.",
].join(" ");
const AUDIO_DURATION_SECONDS = 23.684354;
const GENERATED_AT = "2026-07-27T13:00:00.000Z";
const LICENCE_ATTESTED_AT = "2026-07-27T12:55:00.000Z";
const EXPECTED_NARRATOR_VERSION =
  "pulse-narrator-v1:10c16d892acc39f0b7ad5d295724640543f1318f220812e77b88816b395954c3";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeAlignment(text = SCRIPT) {
  const characters = Array.from(text);
  const endAt = 23.684;
  const step = endAt / characters.length;
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) =>
      Number((index * step).toFixed(6)),
    ),
    character_end_times_seconds: characters.map((_, index) =>
      Number(((index + 1) * step).toFixed(6)),
    ),
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-narration-"));
  const audioPath = path.join(root, "narration.mp3");
  const alignmentPath = path.join(root, "narration_timestamps.json");
  const scriptPath = path.join(root, "script.txt");
  fs.writeFileSync(audioPath, Buffer.from("fixture-mp3-bytes"));
  fs.writeFileSync(scriptPath, SCRIPT, "utf8");
  writeJson(alignmentPath, makeAlignment());
  return {
    root,
    audioPath,
    alignmentPath,
    scriptPath,
    outputDir: path.join(root, "proof"),
    scriptSha256: sha256(cleanScriptForAlignment(SCRIPT)),
    audioSha256: sha256(fs.readFileSync(audioPath)),
    alignmentSha256: sha256(fs.readFileSync(alignmentPath)),
  };
}

function planInput(values, overrides = {}) {
  return {
    storyId: STORY_ID,
    scriptText: SCRIPT,
    scriptSha256: values.scriptSha256,
    audioPath: values.audioPath,
    audioSha256: values.audioSha256,
    alignmentPath: values.alignmentPath,
    alignmentSha256: values.alignmentSha256,
    outputDir: values.outputDir,
    generatedAt: GENERATED_AT,
    finalTargetSeconds: 28,
    visualBreathAllowanceSeconds: 4.4,
    expectedProvider: "elevenlabs",
    expectedVoiceId: "TX3LPaxmHKxFdv7VOQHJ",
    expectedModelId: "eleven_multilingual_v2",
    expectedSpeed: 1.1,
    licenceEvidenceReference:
      "operator-evidence://elevenlabs/subscription/pulse-gaming-2026-07",
    licenceAttestedBy: "pulse-operator",
    licenceAttestedAt: LICENCE_ATTESTED_AT,
    probeAudio: async () => ({
      duration_seconds: AUDIO_DURATION_SECONDS,
      codec_name: "mp3",
      has_audio: true,
    }),
    ...overrides,
  };
}

function safeEnv(overrides = {}) {
  return {
    DEPLOYMENT_MODE: "local",
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    AUTO_PUBLISH: "false",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
    PULSE_EMERGENCY_KILL_SWITCH: "true",
    ...overrides,
  };
}

function confirmations(plan, overrides = {}) {
  return {
    applyRequested: true,
    confirmStoryId: plan.story_id,
    confirmScriptSha256: plan.script.sha256,
    confirmAudioSha256: plan.sources.audio.expected_sha256,
    confirmAlignmentSha256: plan.sources.alignment.expected_sha256,
    confirmPlanSha256: plan.plan_sha256,
    plan,
    env: safeEnv(),
    ...overrides,
  };
}

test("buildWordRecords converts exact character alignment into 47 monotonic word records", () => {
  const alignment = makeAlignment();
  const words = buildWordRecords({
    alignment,
    normalisedScript: cleanScriptForAlignment(SCRIPT),
  });

  assert.equal(words.length, 47);
  assert.deepEqual(words[0], {
    text: "Final",
    start_seconds: alignment.character_start_times_seconds[0],
    end_seconds: alignment.character_end_times_seconds[4],
  });
  assert.equal(words.at(-1).text, "fourth.");
  for (let index = 1; index < words.length; index += 1) {
    assert.ok(words[index].start_seconds >= words[index - 1].start_seconds);
    assert.ok(words[index].end_seconds >= words[index - 1].end_seconds);
  }
});

test("buildGovernedNarrationPlan binds exact script, source hashes, timing and licence attestation", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));

  const plan = await buildGovernedNarrationPlan(planInput(values));

  assert.equal(plan.schema_version, "pulse-governed-narration-plan-v1");
  assert.equal(plan.mode, "DRY_RUN");
  assert.equal(plan.ready, true);
  assert.equal(plan.story_id, STORY_ID);
  assert.equal(plan.script.exact_alignment_match, true);
  assert.equal(plan.script.character_count, 272);
  assert.equal(plan.script.word_count, 47);
  assert.equal(plan.timing.audio_duration_seconds, AUDIO_DURATION_SECONDS);
  assert.equal(plan.timing.final_target_seconds, 28);
  assert.equal(plan.timing.visual_breath_allowance_seconds, 4.4);
  assert.ok(plan.timing.required_visual_breath_seconds > 4.3);
  assert.equal(plan.provider.expected_provider, "elevenlabs");
  assert.equal(plan.provider.expected_voice_id, "TX3LPaxmHKxFdv7VOQHJ");
  assert.equal(plan.provider.expected_model_id, "eleven_multilingual_v2");
  assert.equal(plan.provider.expected_speed, 1.1);
  assert.equal(plan.narrator_version, EXPECTED_NARRATOR_VERSION);
  assert.equal(plan.licence.rights_basis, "LICENSED");
  assert.equal(
    plan.licence.evidence_reference,
    "operator-evidence://elevenlabs/subscription/pulse-gaming-2026-07",
  );
  assert.match(plan.plan_sha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.words.length, 47);
  assert.equal(
    sha256(fs.readFileSync(values.audioPath)),
    values.audioSha256,
  );
  assert.equal(
    sha256(fs.readFileSync(values.alignmentPath)),
    values.alignmentSha256,
  );
});

test("buildGovernedNarrationPlan fails closed on script, alignment, timing and provider inconsistencies", async (t) => {
  const cases = [
    {
      name: "script hash mismatch",
      mutate(values) {
        return { scriptSha256: "a".repeat(64) };
      },
      code: "narration_script_sha256_mismatch",
    },
    {
      name: "aligned text mismatch",
      mutate(values) {
        const alignment = makeAlignment(`${SCRIPT}!`);
        writeJson(values.alignmentPath, alignment);
        return {
          alignmentSha256: sha256(fs.readFileSync(values.alignmentPath)),
        };
      },
      code: "narration_alignment_text_mismatch",
    },
    {
      name: "alignment array count mismatch",
      mutate(values) {
        const alignment = makeAlignment();
        alignment.character_end_times_seconds.pop();
        writeJson(values.alignmentPath, alignment);
        return {
          alignmentSha256: sha256(fs.readFileSync(values.alignmentPath)),
        };
      },
      code: "narration_alignment_array_count_mismatch",
    },
    {
      name: "non-monotonic alignment",
      mutate(values) {
        const alignment = makeAlignment();
        alignment.character_start_times_seconds[3] = -1;
        writeJson(values.alignmentPath, alignment);
        return {
          alignmentSha256: sha256(fs.readFileSync(values.alignmentPath)),
        };
      },
      code: "narration_alignment_timing_invalid",
    },
    {
      name: "final target outside 25 to 32 seconds",
      mutate() {
        return { finalTargetSeconds: 24 };
      },
      code: "narration_final_target_must_be_25_to_32_seconds",
    },
    {
      name: "insufficient visual breath allowance",
      mutate() {
        return { visualBreathAllowanceSeconds: 1 };
      },
      code: "narration_visual_breath_allowance_insufficient",
    },
    {
      name: "unexpected provider",
      mutate() {
        return { expectedProvider: "unknown-provider" };
      },
      code: "narration_expected_provider_must_be_elevenlabs",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const values = fixture();
      subtest.after(() =>
        fs.rmSync(values.root, { recursive: true, force: true }),
      );
      const overrides = scenario.mutate(values);
      await assert.rejects(
        () => buildGovernedNarrationPlan(planInput(values, overrides)),
        (error) => {
          assert.ok(error instanceof GovernedNarrationMaterializeError);
          assert.ok(error.codes.includes(scenario.code), error.message);
          return true;
        },
      );
    });
  }
});

test("validateApplyAuthority requires exact confirmations and a fail-closed local review environment", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const plan = await buildGovernedNarrationPlan(planInput(values));

  const denied = validateApplyAuthority({
    applyRequested: true,
    confirmStoryId: "wrong-story",
    confirmScriptSha256: "a".repeat(64),
    confirmAudioSha256: "b".repeat(64),
    confirmAlignmentSha256: "c".repeat(64),
    confirmPlanSha256: "d".repeat(64),
    plan,
    env: safeEnv({
      DEPLOYMENT_MODE: "railway",
      PULSE_OPERATING_MODE: "AUTO_PUBLISH",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "false",
    }),
  });

  assert.equal(denied.authorised, false);
  assert.ok(denied.blockers.includes("story_id_confirmation_mismatch"));
  assert.ok(denied.blockers.includes("script_sha256_confirmation_mismatch"));
  assert.ok(denied.blockers.includes("audio_sha256_confirmation_mismatch"));
  assert.ok(denied.blockers.includes("alignment_sha256_confirmation_mismatch"));
  assert.ok(denied.blockers.includes("plan_sha256_confirmation_mismatch"));
  assert.ok(denied.blockers.includes("local_proof_environment_required"));
  assert.ok(denied.blockers.includes("human_review_operating_mode_required"));
  assert.ok(denied.blockers.includes("auto_publish_must_be_false"));
  assert.ok(denied.blockers.includes("guarded_live_dispatch_must_be_false"));
  assert.ok(denied.blockers.includes("emergency_kill_switch_must_be_tripped"));

  const allowed = validateApplyAuthority(confirmations(plan));
  assert.equal(allowed.authorised, true);
  assert.equal(allowed.external_publish_authorised, false);
  assert.equal(allowed.database_mutation_authorised, false);
  assert.equal(allowed.oauth_mutation_authorised, false);
  assert.equal(allowed.network_authorised, false);
});

test("dry-run writes machine-readable and Markdown evidence without materialising narration outputs", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const plan = await buildGovernedNarrationPlan(planInput(values));

  const written = await writeGovernedNarrationPlan(plan);

  assert.ok(fs.existsSync(written.plan_path));
  assert.ok(fs.existsSync(written.markdown_path));
  assert.equal(
    JSON.parse(fs.readFileSync(written.plan_path, "utf8")).plan_sha256,
    plan.plan_sha256,
  );
  assert.match(
    fs.readFileSync(written.markdown_path, "utf8"),
    /# Governed Narration Materialisation Plan/,
  );
  assert.equal(fs.existsSync(path.join(plan.output_root, "materialized")), false);
});

test("materializeGovernedNarration atomically writes governed timestamps and manifest without changing sources", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const plan = await buildGovernedNarrationPlan(planInput(values));
  const authority = validateApplyAuthority(confirmations(plan));
  const audioBefore = fs.readFileSync(values.audioPath);
  const alignmentBefore = fs.readFileSync(values.alignmentPath);

  const result = await materializeGovernedNarration({
    plan,
    authority,
  });

  assert.equal(
    result.manifest.schema_version,
    "pulse-governed-narration-manifest-v1",
  );
  assert.equal(result.timestamps.schema_version, "pulse-word-timestamps-v1");
  assert.equal(result.timestamps.story_id, STORY_ID);
  assert.equal(result.timestamps.word_count, 47);
  assert.equal(result.timestamps.words.length, 47);
  assert.equal(
    result.manifest.sources.audio.pre_apply_sha256,
    values.audioSha256,
  );
  assert.equal(
    result.manifest.sources.audio.post_apply_sha256,
    values.audioSha256,
  );
  assert.equal(
    result.manifest.sources.alignment.pre_apply_sha256,
    values.alignmentSha256,
  );
  assert.equal(
    result.manifest.sources.alignment.post_apply_sha256,
    values.alignmentSha256,
  );
  assert.equal(
    result.manifest.narration.duration_seconds,
    AUDIO_DURATION_SECONDS,
  );
  assert.equal(result.manifest.narration.provider, "elevenlabs");
  assert.equal(
    result.manifest.narration.narrator_version,
    EXPECTED_NARRATOR_VERSION,
  );
  assert.equal(result.manifest.narration.word_count, 47);
  assert.equal(
    result.manifest.licence.evidence_reference,
    "operator-evidence://elevenlabs/subscription/pulse-gaming-2026-07",
  );
  assert.ok(fs.existsSync(result.timestamps_path));
  assert.ok(fs.existsSync(result.manifest_path));
  assert.ok(fs.existsSync(result.markdown_path));
  assert.deepEqual(fs.readFileSync(values.audioPath), audioBefore);
  assert.deepEqual(fs.readFileSync(values.alignmentPath), alignmentBefore);
  assert.equal(result.external_publish_authorised, false);
  assert.equal(result.database_mutation_authorised, false);
  assert.equal(result.oauth_mutation_authorised, false);
  assert.equal(result.network_used, false);
  assert.deepEqual(
    fs
      .readdirSync(plan.output_root)
      .filter((name) => name.startsWith(".staging-")),
    [],
  );
});

test("materializeGovernedNarration detects source mutation before promotion and removes staged output", async (t) => {
  const values = fixture();
  t.after(() => fs.rmSync(values.root, { recursive: true, force: true }));
  const plan = await buildGovernedNarrationPlan(planInput(values));
  const authority = validateApplyAuthority(confirmations(plan));

  await assert.rejects(
    () =>
      materializeGovernedNarration({
        plan,
        authority,
        beforeCommit: async () => {
          fs.appendFileSync(values.alignmentPath, "\n");
        },
      }),
    (error) => {
      assert.ok(error instanceof GovernedNarrationMaterializeError);
      assert.ok(
        error.codes.includes("narration_source_alignment_mutated"),
        error.message,
      );
      return true;
    },
  );

  assert.equal(fs.existsSync(path.join(plan.output_root, "materialized")), false);
  assert.deepEqual(
    fs
      .readdirSync(plan.output_root)
      .filter((name) => name.startsWith(".staging-")),
    [],
  );
});
