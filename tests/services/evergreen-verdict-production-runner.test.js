"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const sharp = require("sharp");

const { handlers } = require("../../lib/job-handlers");
const {
  defaultRenderDependency,
} = require("../../lib/services/evergreen-verdict-production-runtime");
const {
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  validatePlatformSafeZoneAudit,
} = require("../../lib/services/platform-safe-zones");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");

const FIXTURE = require("../fixtures/evergreen-verdict-candidates-input.json");

const STORY_ID = "story-fallout-evergreen-production";
const GENERATED_AT = "2026-07-28T12:00:00.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function writeJsonRef(root, name, value) {
  const filePath = path.join(root, name);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.writeFile(filePath, bytes);
  return {
    path: filePath,
    sha256: sha256(bytes),
    story_id: STORY_ID,
    lane_id: "evergreen_short",
  };
}

function productionPitch() {
  const pitch = structuredClone(
    FIXTURE.manifests[0].evergreen_pitch,
  );
  pitch.id = "fallout-return-governed-production";
  pitch.story_id = STORY_ID;
  pitch.claims = pitch.claims.map((claim, index) => ({
    id: `claim-${index + 1}`,
    ...claim,
  }));
  pitch.script_contract = {
    ...pitch.script_contract,
    target_duration_seconds: 70,
    target_words_per_minute: 175,
    opening_premise_words: 11,
    originality: {
      script_original: true,
      copied_reference_script: false,
      copied_reference_sequence: false,
      competitor_assets_used: false,
      reviewed_by: "editorial-review-001",
    },
  };
  pitch.media_plan.exact_subject_motion_seconds = 66;
  pitch.script_material = {
    hook: {
      text: "The easiest Fallout to return to is not the newest one.",
      claim_refs: ["claim-3"],
    },
    body: {
      text:
        "Start with the friction. Fallout 3 moves from Vault 101 into open exploration quickly, so its core loop becomes clear before the systems become overwhelming. New Vegas offers the strongest early role-playing choices and makes the Mojave feel reactive almost immediately, but returning players still need to accept its rougher technical edges. Fallout 4 feels the smoothest in your hands and its settlement building adds a clear long-term project, yet that same system can slow the opening when you only want quests and discovery. Against our two stated criteria, opening-hour friction and build flexibility, each game wins a different argument. Fallout 3 is the cleanest route back into wandering. New Vegas gives choices the greatest weight. Fallout 4 offers the most comfortable controls and the broadest construction layer. None of those judgements requires pretending the games are identical, and every comparison stays tied to the official game descriptions and the declared editorial criteria.",
      claim_refs: ["claim-1", "claim-2", "claim-3"],
    },
    payoff: {
      text:
        "The verdict is Fallout 3 for the fastest return, New Vegas for role-playing depth and Fallout 4 for modern handling. Your best entry depends on which friction you will tolerate.",
      claim_refs: ["claim-1", "claim-2", "claim-3"],
    },
    loop: {
      text:
        "That is why the oldest-looking option can still be the easiest doorway back into Fallout.",
      claim_refs: ["claim-1"],
    },
  };
  const assetIds = pitch.media_plan.rights_records.map(
    (record) => record.asset_id,
  );
  const timing = [
    ["hook", 0, 6, 0, "THE EASIEST RETURN?"],
    ["body", 6, 14, 0, "OPENING FRICTION"],
    ["body", 14, 23, 0, "FASTEST TO WANDERING"],
    ["body", 23, 32, 1, "CHOICES CARRY WEIGHT"],
    ["body", 32, 41, 2, "SMOOTHEST CONTROLS"],
    ["body", 41, 51, 2, "BUILDS VS MOMENTUM"],
    ["payoff", 51, 61, 1, "THREE DIFFERENT WINNERS"],
    ["loop", 61, 70, 0, "THE OLDEST DOORWAY"],
  ];
  pitch.visual_beats = timing.map(
    ([section, start, end, assetIndex, overlay], index) => ({
      id: `beat-${index + 1}`,
      section,
      start_seconds: start,
      end_seconds: end,
      asset_id: assetIds[assetIndex],
      overlay_text: overlay,
    }),
  );
  return pitch;
}

async function governedInputs(
  root,
  pitch,
  { omitMaterialisedPathFor = null } = {},
) {
  const sourceEvidence = {
    schema_version: "pulse-evergreen-source-evidence-v1",
    story_id: STORY_ID,
    lane_id: "evergreen_short",
    source_manifest: pitch.source_manifest,
    claims: pitch.claims,
  };
  const mediaDir = path.join(root, "rights-ledger-media");
  await fs.ensureDir(mediaDir);
  const colours = ["#4a2718", "#1c344f", "#315138"];
  const rightsItems = [];
  const materialisedAssets = [];
  for (const [
    index,
    record,
  ] of pitch.media_plan.rights_records.entries()) {
    const materialisedPath = path.join(
      mediaDir,
      `${record.asset_id}.png`,
    );
    await sharp({
      create: {
        width: 540,
        height: 960,
        channels: 3,
        background: colours[index % colours.length],
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="540" height="960" xmlns="http://www.w3.org/2000/svg">` +
              `<text x="270" y="480" text-anchor="middle" fill="#ffffff" ` +
              `font-family="Arial" font-size="42">FALLOUT ${index + 3}</text>` +
              `</svg>`,
          ),
        },
      ])
      .png()
      .toFile(materialisedPath);
    const bytes = await fs.readFile(materialisedPath);
    materialisedAssets.push({
      asset_id: record.asset_id,
      path: materialisedPath,
      sha256: sha256(bytes),
    });
    rightsItems.push({
      item_id: record.asset_id,
      source_url: record.source_url,
      asset_sha256: sha256(bytes),
      ...(record.asset_id === omitMaterialisedPathFor
        ? {}
        : { materialised_path: materialisedPath }),
      included_in_final: true,
      rights_decision: "CLEARED",
      rights_basis: "OWNED",
      rights_evidence: {
        reference: `owned-capture:${record.asset_id}`,
        sha256: sha256(`owned-evidence:${record.asset_id}`),
      },
      attribution_decision: "NOT_REQUIRED",
    });
  }
  const rightsLedger = {
    schema_version: "pulse-rights-ledger-v1",
    story_id: STORY_ID,
    lane_id: "evergreen_short",
    ledger_version: 1,
    decision: "CLEARED",
    items: rightsItems,
  };
  rightsLedger.ledger_sha256 = hashRightsLedger(rightsLedger);
  const originality = {
    schema_version: "pulse-originality-transformation-v1",
    story_id: STORY_ID,
    lane_id: "evergreen_short",
    originality_transformation: {
      verdict: "STRONG",
      rationale:
        "Original Pulse Gaming comparison, narration and motion treatment.",
    },
  };
  const disclosure = {
    schema_version: "pulse-synthetic-disclosure-proposal-v1",
    story_id: STORY_ID,
    lane_id: "evergreen_short",
    proposal: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "Synthetic narration is used in the local review master.",
      disclosure_text: "Includes synthetic narration.",
      youtube_field_value: true,
      reviewed_at: GENERATED_AT,
    },
  };
  const sourceRef = await writeJsonRef(
    root,
    "source-evidence.json",
    sourceEvidence,
  );
  const rightsRef = await writeJsonRef(
    root,
    "rights-ledger.json",
    rightsLedger,
  );
  rightsRef.canonical_sha256 = rightsLedger.ledger_sha256;
  return {
    refs: {
      source_evidence_ref: sourceRef,
      rights_ledger_ref: rightsRef,
      originality_transformation_ref: await writeJsonRef(
        root,
        "originality.json",
        originality,
      ),
      synthetic_disclosure_proposal_ref: await writeJsonRef(
        root,
        "synthetic-disclosure.json",
        disclosure,
      ),
    },
    materialised_assets: materialisedAssets,
  };
}

function storyForPitch(pitch) {
  return {
    id: STORY_ID,
    title: "Which Fallout is easiest to return to?",
    url: "https://fallout.bethesda.net/en/games",
    source_confidence: "verified",
    approved: 1,
    full_script: [
      pitch.script_material.hook.text,
      pitch.script_material.body.text,
      pitch.script_material.payoff.text,
      pitch.script_material.loop.text,
    ].join(" "),
    publish_status: "review",
    _extra: JSON.stringify({
      editorial_format: "evergreen_verdict_short",
      evergreen_pitch: pitch,
    }),
  };
}

function localProductionDependencies() {
  return {
    async produceNarration({ output_dir: outputDir }) {
      await fs.ensureDir(outputDir);
      const filePath = path.join(outputDir, "narration.m4a");
      const bytes = Buffer.from("local deterministic narration evidence");
      await fs.writeFile(filePath, bytes);
      return {
        path: filePath,
        sha256: sha256(bytes),
        provider: "local-test-fixture",
        network_used: false,
      };
    },
  };
}

function localExecutablePaths() {
  return {
    ffmpeg_path: process.execPath,
    ffprobe_path: process.execPath,
    blockers: [],
  };
}

function localProductionProcessRunner(calls) {
  return async ({ command, args, cwd, timeout_ms: timeoutMs }) => {
    calls.push({
      command,
      args: [...args],
      cwd,
      timeout_ms: timeoutMs,
    });
    if (args.includes("-show_streams")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              profile: "High",
              pix_fmt: "yuv420p",
              width: 1080,
              height: 1920,
            },
            {
              codec_type: "audio",
              codec_name: "aac",
              sample_rate: "48000",
            },
          ],
          format: { duration: "70.000" },
        }),
        stderr: "",
      };
    }
    const outputPath = args.at(-1);
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(
      outputPath,
      Buffer.from(
        "deterministic local governed exact-subject evergreen MP4",
      ),
    );
    return { status: 0, stdout: "", stderr: "" };
  };
}

async function planProduction({
  root,
  pitch,
  refs,
  repos,
  queued,
}) {
  const planned = await handlers.plan_evergreen_short(
    {
      kind: "plan_evergreen_short",
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "evergreen_short",
        story_id: STORY_ID,
        evergreen_pitch: pitch,
        out_dir: path.join(root, "planning"),
        production_out_dir: path.join(root, "production"),
        now: GENERATED_AT,
        ...refs,
      },
    },
    { repos },
  );
  assert.equal(
    planned.status,
    "READY_FOR_EXACT_PRODUCTION",
    JSON.stringify(planned),
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "produce_evergreen_short");
  return planned;
}

async function preparedHarness(
  t,
  { omitMaterialisedPathFor = null } = {},
) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-production-case-"),
  );
  t.after(() => fs.remove(root));
  const pitch = productionPitch();
  const story = storyForPitch(pitch);
  const inputs = await governedInputs(root, pitch, {
    omitMaterialisedPathFor,
  });
  const queued = [];
  const repos = {
    stories: { get: () => story },
    jobs: {
      enqueue(input) {
        queued.push(input);
        return { id: queued.length, ...input };
      },
    },
  };
  await planProduction({
    root,
    pitch,
    refs: inputs.refs,
    repos,
    queued,
  });
  return {
    root,
    pitch,
    inputs,
    repos,
    productionJob: queued.shift(),
  };
}

test("the real evergreen handler path materialises exact LOCAL_PROOF evidence and reaches governed human review", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-production-runner-"),
  );
  t.after(() => fs.remove(root));
  const pitch = productionPitch();
  const story = storyForPitch(pitch);
  const inputs = await governedInputs(root, pitch);
  const queued = [];
  const processCalls = [];
  const repos = {
    stories: { get: () => story },
    jobs: {
      enqueue(input) {
        queued.push(input);
        return { id: queued.length, ...input };
      },
    },
  };

  await planProduction({
    root,
    pitch,
    refs: inputs.refs,
    repos,
    queued,
  });

  const produced = await handlers.produce_evergreen_short(
    queued.shift(),
    {
      repos,
      evergreenProductionDependencies:
        localProductionDependencies(),
      evergreenProductionExecutablePaths:
        localExecutablePaths(),
      evergreenProductionProcessRunner:
        localProductionProcessRunner(processCalls),
    },
  );

  assert.equal(
    produced.status,
    "prepared_for_human_review",
    JSON.stringify(produced),
  );
  assert.equal(
    produced.production.schema_version,
    "pulse-evergreen-production-result-v1",
  );
  assert.equal(
    produced.production.status,
    "AWAITING_HUMAN_REVIEW",
  );
  assert.equal(
    produced.production.runtime_capabilities?.ready,
    true,
  );
  assert.equal(
    produced.production.runtime_capabilities?.dependencies?.render
      ?.resolution,
    "governed_ffmpeg_exact_subject_v1",
  );
  assert.equal(
    produced.production.runtime_capabilities?.dependencies
      ?.decoded_qa?.resolution,
    "ffprobe_platform_video_qa",
  );
  assert.equal(produced.production.database_mutation_authorised, false);
  assert.equal(produced.production.oauth_mutation_authorised, false);
  assert.equal(produced.production.external_publish_authorised, false);
  assert.equal(
    await fs.pathExists(
      produced.production.artifacts.production_package.path,
    ),
    true,
  );
  assert.equal(processCalls.length, 2);
  const renderCall = processCalls.find(
    (call) => !call.args.includes("-show_streams"),
  );
  const qaCall = processCalls.find((call) =>
    call.args.includes("-show_streams"),
  );
  assert.ok(renderCall);
  assert.ok(qaCall);
  const filterComplex =
    renderCall.args[
      renderCall.args.indexOf("-filter_complex") + 1
    ];
  assert.match(
    filterComplex,
    /scale=1200:2134:force_original_aspect_ratio=increase,crop=1200:2134,zoompan=/,
  );
  assert.match(filterComplex, /overlay=0:0:shortest=1/);
  assert.doesNotMatch(
    filterComplex,
    /\[bg\d+\]\[ol\d+\]overlay=0:0:shortest=1,fade=t=(?:in|out)/,
  );
  for (const asset of inputs.materialised_assets) {
    const stagedPath = renderCall.args.find(
      (arg) =>
        typeof arg === "string" &&
        arg.includes(`${asset.sha256}.png`),
    );
    assert.ok(
      stagedPath,
      `render command did not use content-addressed ${asset.asset_id}`,
    );
    assert.match(stagedPath, /exact-subject-assets/i);
    assert.notEqual(path.resolve(stagedPath), path.resolve(asset.path));
  }
  const rendererManifest = await fs.readJson(
    produced.production.artifacts.renderer_manifest.path,
  );
  assert.equal(
    rendererManifest.composition.background_full_bleed,
    true,
  );
  assert.equal(
    rendererManifest.composition.text_inside_platform_safe_zone,
    true,
  );
  assert.equal(
    rendererManifest.composition.cards_replace_subject_media,
    false,
  );
  assert.equal(
    rendererManifest.composition.overlay_profile,
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  );
  assert.deepEqual(
    new Set(
      rendererManifest.exact_subject_assets.map(
        (asset) => asset.asset_id,
      ),
    ),
    new Set(
      inputs.materialised_assets.map((asset) => asset.asset_id),
    ),
  );
  const safeZoneAudit = await fs.readJson(
    produced.production.artifacts.safe_zone_audit.path,
  );
  assert.equal(
    validatePlatformSafeZoneAudit({ audit: safeZoneAudit })
      .verdict,
    "GREEN",
  );
  assert.equal(
    safeZoneAudit.profile_id,
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  );
  assert.equal(
    safeZoneAudit.elements.every(
      (element) =>
        element.bbox.x >= safeZoneAudit.safe_rect.x &&
        element.bbox.y >= safeZoneAudit.safe_rect.y &&
        element.bbox.x + element.bbox.width <=
          safeZoneAudit.safe_rect.x +
            safeZoneAudit.safe_rect.width &&
        element.bbox.y + element.bbox.height <=
          safeZoneAudit.safe_rect.y +
            safeZoneAudit.safe_rect.height,
    ),
    true,
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "review_evergreen_short");

  queued[0].payload.output_dir = path.join(root, "review");
  const reviewed = await handlers.review_evergreen_short(
    queued.shift(),
    { repos },
  );

  assert.equal(
    reviewed.status,
    "READY_FOR_HUMAN_REVIEW",
    JSON.stringify(reviewed),
  );
  const packet = await fs.readJson(reviewed.review_packet_json);
  assert.equal(packet.lane_id, "evergreen_short");
  assert.equal(packet.story_id, STORY_ID);
  assert.equal(packet.exact_bindings.files_and_identities_match, true);
  assert.equal(packet.safety.files_rehashed, true);
  assert.equal(packet.safety.database_mutated, false);
  assert.equal(packet.safety.oauth_mutated, false);
  assert.equal(packet.safety.external_posting_attempted, false);
});

test("the default exact-subject renderer fails closed when canonical rights media is absent or has drifted", async (t) => {
  await t.test("canonical materialised_path is required", async (t) => {
    const pitch = productionPitch();
    const missingAssetId =
      pitch.media_plan.rights_records[0].asset_id;
    const harness = await preparedHarness(t, {
      omitMaterialisedPathFor: missingAssetId,
    });
    const processCalls = [];
    const produced = await handlers.produce_evergreen_short(
      harness.productionJob,
      {
        repos: harness.repos,
        evergreenProductionDependencies:
          localProductionDependencies(),
        evergreenProductionExecutablePaths:
          localExecutablePaths(),
        evergreenProductionProcessRunner:
          localProductionProcessRunner(processCalls),
      },
    );
    assert.equal(produced.status, "held");
    assert.ok(
      produced.blockers.includes(
        "evergreen_exact_subject_asset_materialisation_required",
      ),
      JSON.stringify(produced),
    );
    assert.equal(processCalls.length, 0);
  });

  await t.test("materialised media bytes are rehashed", async (t) => {
    const harness = await preparedHarness(t);
    await fs.appendFile(
      harness.inputs.materialised_assets[0].path,
      Buffer.from("drift"),
    );
    const processCalls = [];
    const produced = await handlers.produce_evergreen_short(
      harness.productionJob,
      {
        repos: harness.repos,
        evergreenProductionDependencies:
          localProductionDependencies(),
        evergreenProductionExecutablePaths:
          localExecutablePaths(),
        evergreenProductionProcessRunner:
          localProductionProcessRunner(processCalls),
      },
    );
    assert.equal(produced.status, "held");
    assert.ok(
      produced.blockers.includes(
        "evergreen_exact_subject_asset_sha256_mismatch",
      ),
      JSON.stringify(produced),
    );
    assert.equal(processCalls.length, 0);
  });
});

test("evergreen production rehashes the exact work order, source and rights files before dependencies execute", async (t) => {
  const cases = [
    {
      name: "work order",
      blocker: "evergreen_production_work_order_sha256_mismatch",
      target: (harness) =>
        harness.productionJob.payload.production_work_order_ref.path,
    },
    {
      name: "source evidence",
      blocker: "evergreen_source_evidence_sha256_mismatch",
      target: (harness) =>
        harness.inputs.refs.source_evidence_ref.path,
    },
    {
      name: "rights ledger",
      blocker: "evergreen_rights_ledger_sha256_mismatch",
      target: (harness) =>
        harness.inputs.refs.rights_ledger_ref.path,
    },
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, async (t) => {
      const harness = await preparedHarness(t);
      await fs.appendFile(
        testCase.target(harness),
        Buffer.from("\n"),
      );
      const processCalls = [];
      const produced = await handlers.produce_evergreen_short(
        harness.productionJob,
        {
          repos: harness.repos,
          evergreenProductionDependencies:
            localProductionDependencies(),
          evergreenProductionExecutablePaths:
            localExecutablePaths(),
          evergreenProductionProcessRunner:
            localProductionProcessRunner(processCalls),
        },
      );
      assert.equal(produced.status, "held");
      assert.ok(
        produced.blockers.includes(testCase.blocker),
        JSON.stringify(produced),
      );
      assert.equal(processCalls.length, 0);
    });
  }
});

test("the runner rejects card-first, non-full-bleed or unsafe composition declarations before decoded QA", async (t) => {
  const harness = await preparedHarness(t);
  const processCalls = [];
  const processRunner = localProductionProcessRunner(processCalls);
  const dependencies = {
    ...localProductionDependencies(),
    async renderEvergreen(input) {
      const output = await defaultRenderDependency({
        processRunner,
        ffmpegPath: process.execPath,
        input,
      });
      return {
        ...output,
        composition: {
          ...output.composition,
          background_full_bleed: false,
          text_inside_platform_safe_zone: false,
          cards_replace_subject_media: true,
        },
      };
    },
  };
  const produced = await handlers.produce_evergreen_short(
    harness.productionJob,
    {
      repos: harness.repos,
      evergreenProductionDependencies: dependencies,
      evergreenProductionExecutablePaths:
        localExecutablePaths(),
      evergreenProductionProcessRunner: processRunner,
    },
  );
  assert.equal(produced.status, "held");
  assert.ok(
    produced.blockers.includes(
      "evergreen_render_background_full_bleed_required",
    ),
    JSON.stringify(produced),
  );
  assert.ok(
    produced.blockers.includes(
      "evergreen_render_safe_zone_compliance_required",
    ),
    JSON.stringify(produced),
  );
  assert.ok(
    produced.blockers.includes(
      "evergreen_render_card_first_composition_forbidden",
    ),
    JSON.stringify(produced),
  );
  assert.equal(
    processCalls.filter((call) =>
      call.args.includes("-show_streams"),
    ).length,
    0,
  );
});

test("a transient production adapter failure requests a durable job retry instead of completing a poisoned HOLD", async (t) => {
  const harness = await preparedHarness(t);
  const dependencies = {
    ...localProductionDependencies(),
    async produceNarration() {
      const error = new Error("local_tts_temporarily_unavailable");
      error.code = "ETIMEDOUT";
      throw error;
    },
  };

  const produced = await handlers.produce_evergreen_short(
    harness.productionJob,
    {
      repos: harness.repos,
      evergreenProductionDependencies: dependencies,
      evergreenProductionExecutablePaths:
        localExecutablePaths(),
      evergreenProductionProcessRunner:
        localProductionProcessRunner([]),
    },
  );

  assert.equal(produced.status, "held");
  assert.equal(produced.job_outcome, "RETRY");
  assert.equal(produced.retryable, true);
  assert.equal(produced.retry_after_seconds, 60);
  assert.ok(
    produced.blockers.includes(
      "evergreen_narration_adapter_failed",
    ),
  );
});
