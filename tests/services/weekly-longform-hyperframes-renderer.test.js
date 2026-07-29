"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  assessRightsLedger,
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  workOrderFingerprint,
} = require("../../lib/services/weekly-longform-work-order");
const {
  WeeklyLongformHyperframesRendererError,
  createGovernedWeeklyLongformHyperframesRenderer,
  inspectWeeklyLongformHyperframesCapabilities,
} = require("../../lib/services/weekly-longform-hyperframes-renderer");

const RUN_ID = "weekly-hf-2026-07-28";
const GENERATED_AT = "2026-07-28T18:00:00.000Z";
const SCRIPT = "Xbox expands access. PlayStation answers with new games.";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}

function mp4Bytes() {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]),
    Buffer.from("isomiso2", "ascii"),
  ]);
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-hf-renderer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputRoot = path.join(root, "inputs");
  const outputDir = path.join(root, RUN_ID, "adapters", "render");
  const binRoot = path.join(root, "bin");
  fs.mkdirSync(inputRoot, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(binRoot, { recursive: true });

  const scriptPath = path.join(root, RUN_ID, "script.txt");
  const audioPath = path.join(root, RUN_ID, "narration.mp3");
  const alignmentPath = path.join(root, RUN_ID, "word-timestamps.json");
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, SCRIPT, "utf8");
  fs.writeFileSync(audioPath, Buffer.from("elevenlabs-audio-bytes"));

  const words = [
    { text: "Xbox", start_seconds: 0, end_seconds: 25 },
    { text: "expands", start_seconds: 25, end_seconds: 75 },
    { text: "access.", start_seconds: 75, end_seconds: 240 },
    { text: "PlayStation", start_seconds: 240, end_seconds: 300 },
    { text: "answers", start_seconds: 300, end_seconds: 375 },
    { text: "with", start_seconds: 375, end_seconds: 405 },
    { text: "new", start_seconds: 405, end_seconds: 440 },
    { text: "games.", start_seconds: 440, end_seconds: 480 },
  ];
  const alignment = {
    schema_version: "pulse-word-timestamps-v1",
    run_id: RUN_ID,
    generated_at: GENERATED_AT,
    script_sha256: sha256(Buffer.from(SCRIPT)),
    audio_sha256: sha256(fs.readFileSync(audioPath)),
    source_alignment_sha256: "a".repeat(64),
    provider: "elevenlabs",
    timing_basis: "provider_word_alignment",
    word_count: words.length,
    words,
  };
  const alignmentSha256 = writeJson(alignmentPath, alignment);

  const stories = [
    {
      story_id: "story-xbox",
      title: "Xbox expands backwards compatibility",
      section_title: "Xbox opens the vault",
      why_it_matters: "More older games become easier to play.",
      platform: "xbox",
      assetName: "xbox.jpg",
      assetBytes: Buffer.from("cleared-xbox-image"),
      sourceUrl: "https://news.xbox.com/example",
    },
    {
      story_id: "story-playstation",
      title: "PlayStation answers with its next slate",
      section_title: "PlayStation fires back",
      why_it_matters: "The release calendar becomes more competitive.",
      platform: "playstation",
      assetName: "playstation.mp4",
      assetBytes: mp4Bytes(),
      sourceUrl: "https://blog.playstation.com/example",
    },
  ];

  const dossierStories = [];
  for (const story of stories) {
    const assetPath = path.join(inputRoot, story.assetName);
    fs.writeFileSync(assetPath, story.assetBytes);
    const item = {
      item_id: `${story.story_id}-hero`,
      source_url: story.sourceUrl,
      local_path: assetPath,
      asset_sha256: sha256(story.assetBytes),
      included_in_final: true,
      rights_decision: "CLEARED",
      rights_basis: "LICENSED",
      rights_evidence: {
        reference: `${story.sourceUrl}/terms`,
        sha256: sha256(Buffer.from(`${story.story_id}-licence`)),
      },
      attribution_decision: "REQUIRED_AND_SUPPLIED",
      attribution_text: `Official ${story.platform} media`,
    };
    if (options.attributionOnly === story.story_id) {
      item.rights_basis = "ATTRIBUTION_ONLY";
    }
    if (options.tamperAsset === story.story_id) {
      item.asset_sha256 = "b".repeat(64);
    }
    const ledger = {
      ledger_version: 1,
      decision: "CLEARED",
      items: [item],
    };
    ledger.ledger_sha256 = hashRightsLedger(ledger);
    const rightsPath = path.join(
      inputRoot,
      `${story.story_id}-rights.json`,
    );
    const rightsSha256 = writeJson(rightsPath, ledger);
    dossierStories.push({
      story_id: story.story_id,
      title: story.title,
      section_title: story.section_title,
      why_it_matters: story.why_it_matters,
      verified_claims: [
        {
          claim_id: `${story.story_id}-claim`,
          text: story.why_it_matters,
        },
      ],
      rights_lineage: {
        path: rightsPath,
        sha256: rightsSha256,
        canonical_sha256: ledger.ledger_sha256,
      },
    });
  }

  const visualBeatPlan = {
    schema_version: "pulse-weekly-visual-beat-plan-v1",
    timing_basis: "script_runtime_estimate_only",
    beat_count: 2,
    beats: [
      {
        beat_id: "beat-xbox",
        story_id: "story-xbox",
        purpose: "Show what changes for players.",
        treatment: "Full-bleed key art with a precise chapter lockup.",
        asset_item_id: "story-xbox-hero",
        claim_ids: ["story-xbox-claim"],
        rights_bound: true,
        claims_bound: true,
        estimated_start_seconds: 0,
        estimated_end_seconds: 240,
      },
      {
        beat_id: "beat-playstation",
        story_id: "story-playstation",
        purpose: "Reset the competitive picture.",
        treatment: "Platform-blue chapter handoff over full-bleed art.",
        asset_item_id: "story-playstation-hero",
        claim_ids: ["story-playstation-claim"],
        rights_bound: true,
        claims_bound: true,
        estimated_start_seconds: 240,
        estimated_end_seconds: 480,
      },
    ],
  };
  const derivativePlan = {
    schema_version: "pulse-weekly-derivative-plan-v1",
    status: "PLANNED_LOCAL_PROOF",
    item_count: 2,
    items: [
      { derivative_id: "story-xbox-vertical-short" },
      { derivative_id: "story-playstation-vertical-short" },
    ],
  };
  const workOrder = {
    schema_version: "pulse-weekly-longform-work-order-v1",
    generated_at: GENERATED_AT,
    run_id: RUN_ID,
    mode: "LOCAL_PROOF",
    production_runner_admission: {
      status: "READY",
      scope: "LOCAL_PROOF_PRODUCTION_RUNNER",
      blockers: [],
    },
    editorial_frame: {
      episode_title: "Pulse Weekly: The Platform Fight",
      editorial_thesis:
        "Platform competition is shifting what players can access.",
    },
    dossier: {
      schema_version: "pulse-weekly-editorial-dossier-v1",
      episode_title: "Pulse Weekly: The Platform Fight",
      editorial_thesis:
        "Platform competition is shifting what players can access.",
      story_count: dossierStories.length,
      stories: dossierStories,
    },
    script: {
      schema_version: "pulse-weekly-longform-script-v1",
      full_script: SCRIPT,
      sha256: sha256(Buffer.from(SCRIPT)),
      estimated_duration_seconds: 480,
    },
    visual_beat_plan: visualBeatPlan,
    derivative_plan: derivativePlan,
    safety: {
      local_proof_only: true,
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
    },
  };
  workOrder.work_order_sha256 = workOrderFingerprint(workOrder);

  const hyperframesCliPath = path.join(binRoot, "hyperframes-cli.js");
  const gsapSourcePath = path.join(binRoot, "gsap.min.js");
  fs.writeFileSync(hyperframesCliPath, "// injected hyperframes cli", "utf8");
  fs.writeFileSync(
    gsapSourcePath,
    "/* GSAP 3.15.0 injected test runtime */",
    "utf8",
  );

  return {
    root,
    outputDir,
    input: {
      run_id: RUN_ID,
      generated_at: GENERATED_AT,
      script_text: SCRIPT,
      script_path: scriptPath,
      script_sha256: sha256(fs.readFileSync(scriptPath)),
      audio_path: audioPath,
      audio_sha256: sha256(fs.readFileSync(audioPath)),
      alignment_path: alignmentPath,
      alignment_sha256: alignmentSha256,
      alignment,
      visual_beat_plan: visualBeatPlan,
      derivative_plan: derivativePlan,
      output_dir: outputDir,
      work_order: workOrder,
    },
    hyperframesCliPath,
    gsapSourcePath,
  };
}

function installedFontSourcePaths() {
  const packageFile = (packageName, fileName) =>
    path.join(
      path.dirname(require.resolve(`${packageName}/package.json`)),
      "files",
      fileName,
    );
  return {
    sans_regular: packageFile(
      "@fontsource/ibm-plex-sans",
      "ibm-plex-sans-latin-400-normal.woff2",
    ),
    sans_bold: packageFile(
      "@fontsource/ibm-plex-sans",
      "ibm-plex-sans-latin-700-normal.woff2",
    ),
    mono_regular: packageFile(
      "@fontsource/ibm-plex-mono",
      "ibm-plex-mono-latin-400-normal.woff2",
    ),
    mono_bold: packageFile(
      "@fontsource/ibm-plex-mono",
      "ibm-plex-mono-latin-700-normal.woff2",
    ),
    display: packageFile(
      "@fontsource/bebas-neue",
      "bebas-neue-latin-400-normal.woff2",
    ),
  };
}

function configuredRenderer(values, processRunner) {
  return createGovernedWeeklyLongformHyperframesRenderer({
    command: process.execPath,
    command_args_prefix: [values.hyperframesCliPath],
    hyperframes_cli_path: values.hyperframesCliPath,
    hyperframes_version: "0.7.76",
    gsap_source_path: values.gsapSourcePath,
    font_source_paths: installedFontSourcePaths(),
    process_runner: processRunner,
  });
}

test("the default renderer fails closed with explicit capability blockers", () => {
  const report = inspectWeeklyLongformHyperframesCapabilities();

  assert.equal(
    report.schema_version,
    "pulse-weekly-longform-hyperframes-capabilities-v1",
  );
  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers, [
    "hyperframes_cli_path_required",
    "hyperframes_cli_version_required",
    "gsap_runtime_path_required",
    "hyperframes_font_sans_regular_path_required",
    "hyperframes_font_sans_bold_path_required",
    "hyperframes_font_mono_regular_path_required",
    "hyperframes_font_mono_bold_path_required",
    "hyperframes_font_display_path_required",
    "hyperframes_process_runner_required",
  ]);
  assert.deepEqual(report.safety, {
    external_network_authority: false,
    upload_authority: false,
    database_mutation_authority: false,
    oauth_mutation_authority: false,
    implicit_process_spawn_enabled: false,
  });

  const renderer = createGovernedWeeklyLongformHyperframesRenderer();
  assert.equal(renderer.capabilities.ready, false);
  assert.equal(renderer.renderLongform, null);
});

test("a caller cannot overstate an older detected HyperFrames CLI version", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-hf-version-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, "node_modules", "hyperframes");
  const cliPath = path.join(packageRoot, "dist", "cli.js");
  const gsapPath = path.join(root, "gsap.min.js");
  fs.mkdirSync(path.dirname(cliPath), { recursive: true });
  fs.writeFileSync(cliPath, "// old cli", "utf8");
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "hyperframes", version: "0.4.32" }),
    "utf8",
  );
  fs.writeFileSync(gsapPath, "/* gsap */", "utf8");

  const report = inspectWeeklyLongformHyperframesCapabilities({
    command: process.execPath,
    hyperframes_cli_path: cliPath,
    hyperframes_version: "0.7.76",
    gsap_source_path: gsapPath,
    font_source_paths: installedFontSourcePaths(),
    process_runner: async () => ({ status: 0 }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers, [
    "hyperframes_cli_check_capability_required",
    "hyperframes_cli_version_mismatch",
  ]);
  assert.equal(
    report.dependencies.hyperframes_cli.detected_version,
    "0.4.32",
  );
  assert.equal(
    report.dependencies.hyperframes_cli.declared_version,
    "0.7.76",
  );
});

test("the governed renderer materialises a deterministic full-bleed project and a hash-bound real MP4", async (t) => {
  const values = fixture(t);
  const calls = [];
  let lintDiagnostic = null;
  const renderer = configuredRenderer(values, async (invocation) => {
    calls.push(invocation);
    if (invocation.phase === "check") {
      const packagePath = require.resolve(
        "hyperframes/package.json",
      );
      const packageValue = JSON.parse(
        fs.readFileSync(packagePath, "utf8"),
      );
      const cliEntry =
        typeof packageValue.bin === "string"
          ? packageValue.bin
          : packageValue.bin.hyperframes;
      const installedCliPath = path.resolve(
        path.dirname(packagePath),
        cliEntry,
      );
      const lint = spawnSync(
        process.execPath,
        [
          installedCliPath,
          "lint",
          invocation.cwd,
          "--json",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
        },
      );
      lintDiagnostic = {
        status: lint.status,
        stdout: lint.stdout,
        stderr: lint.stderr,
        error: lint.error?.message || null,
      };
      const lintReport = JSON.parse(lint.stdout);
      assert.equal(lintReport.errorCount, 0, lint.stdout);
      assert.equal(lintReport.warningCount, 0, lint.stdout);
      return {
        status: lint.status,
        stdout: lint.stdout,
        stderr: lint.stderr,
      };
    }
    if (invocation.phase === "render") {
      fs.writeFileSync(invocation.expected_output_path, mp4Bytes());
    }
    return { status: 0, stdout: `${invocation.phase} ok`, stderr: "" };
  });

  assert.equal(renderer.capabilities.ready, true);
  assert.deepEqual(renderer.capabilities.blockers, []);
  let result;
  try {
    result = await renderer.renderLongform(values.input);
  } catch (error) {
    assert.fail(
      `${error.message}\n${JSON.stringify(lintDiagnostic, null, 2)}`,
    );
  }

  assert.equal(result.renderer, "hyperframes-cli-0.7.76+gsap");
  assert.equal(result.network_used, false);
  assert.equal(result.master.sha256, sha256(mp4Bytes()));
  assert.deepEqual(fs.readFileSync(result.master.path), mp4Bytes());
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.phase),
    ["check", "render"],
  );
  assert.ok(calls[0].args.includes("check"));
  assert.ok(calls[1].args.includes("--strict"));
  assert.ok(calls[1].args.includes("--quality"));
  assert.ok(calls[1].args.includes("high"));

  const projectDir = path.join(values.outputDir, "hyperframes-project");
  for (const relativePath of [
    "BRIEF.md",
    "STORYBOARD.md",
    "frame.md",
    "hyperframes.json",
    "index.html",
    "styles.css",
    "timeline.js",
    "project-manifest.json",
    "assets/audio/narration.mp3",
    "assets/evidence/word-timestamps.json",
    "assets/runtime/gsap.min.js",
    "compositions/beat-xbox.html",
    "compositions/beat-playstation.html",
  ]) {
    assert.ok(
      fs.existsSync(path.join(projectDir, relativePath)),
      relativePath,
    );
  }

  const index = fs.readFileSync(path.join(projectDir, "index.html"), "utf8");
  const styles = fs.readFileSync(
    path.join(projectDir, "styles.css"),
    "utf8",
  );
  const timeline = fs.readFileSync(
    path.join(projectDir, "timeline.js"),
    "utf8",
  );
  const storyboard = fs.readFileSync(
    path.join(projectDir, "STORYBOARD.md"),
    "utf8",
  );
  assert.match(index, /data-width="1920"/);
  assert.match(index, /data-height="1080"/);
  assert.match(index, /data-duration="480"/);
  assert.match(index, /assets\/runtime\/gsap\.min\.js/);
  assert.match(index, /assets\/audio\/narration\.mp3/);
  assert.match(index, /class="clip host-video"/);
  assert.match(index, /\bmuted\b/);
  assert.match(index, /\bloop\b/);
  assert.doesNotMatch(index, /https?:\/\//);
  assert.match(styles, /\.title-safe/);
  assert.match(styles, /inset:\s*74px 104px 86px/);
  assert.match(styles, /object-fit:\s*cover/);
  assert.match(styles, /#ff6b1a/i);
  assert.doesNotMatch(timeline, /Math\.random|Date\.now|performance\.now/);
  assert.match(storyboard, /motion_rules:.*multi-phase-camera/);
  assert.match(storyboard, /motion_rules:.*spring-pop-entrance/);
  assert.match(storyboard, /transition_in: push-slide/);
  assert.match(
    fs.readFileSync(
      path.join(projectDir, "compositions", "beat-playstation.html"),
      "utf8",
    ),
    /background-color: rgba\(9, 8, 7, 0\)/,
  );

  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(projectDir, "project-manifest.json"),
      "utf8",
    ),
  );
  assert.equal(
    manifest.schema_version,
    "pulse-weekly-longform-hyperframes-project-v1",
  );
  assert.equal(
    manifest.bindings.work_order_sha256,
    values.input.work_order.work_order_sha256,
  );
  assert.equal(manifest.bindings.script_sha256, values.input.script_sha256);
  assert.equal(manifest.bindings.audio_sha256, values.input.audio_sha256);
  assert.equal(
    manifest.bindings.alignment_sha256,
    values.input.alignment_sha256,
  );
  assert.equal(manifest.canvas.width, 1920);
  assert.equal(manifest.canvas.height, 1080);
  assert.equal(manifest.assets.length, 2);
  assert.ok(manifest.assets.every((asset) => asset.full_bleed === true));
  assert.ok(
    manifest.assets.every(
      (asset) => asset.observed_sha256 === asset.declared_sha256,
    ),
  );

  const rights = JSON.parse(fs.readFileSync(result.rights.path, "utf8"));
  assert.equal(
    rights.schema_version,
    "pulse-longform-rights-ledger-v1",
  );
  assert.equal(rights.run_id, RUN_ID);
  assert.equal(rights.master_sha256, result.master.sha256);
  assert.equal(rights.items.length, 2);
  assert.ok(rights.items.every((item) => item.included_in_final === true));
  assert.ok(rights.items.every((item) => item.rights_decision === "CLEARED"));
  assert.deepEqual(assessRightsLedger(rights, rights.ledger_sha256).blockers, []);
});

test("attribution-only source media is never treated as permission", async (t) => {
  const values = fixture(t, { attributionOnly: "story-xbox" });
  const renderer = configuredRenderer(values, async () => {
    throw new Error("process_must_not_run");
  });

  await assert.rejects(
    () => renderer.renderLongform(values.input),
    (error) =>
      error instanceof WeeklyLongformHyperframesRendererError &&
      error.codes.includes("attribution_is_not_permission"),
  );
  assert.deepEqual(fs.readdirSync(values.outputDir), []);
});

test("a materialised asset whose bytes do not match its source ledger is rejected before project creation", async (t) => {
  const values = fixture(t, { tamperAsset: "story-playstation" });
  const renderer = configuredRenderer(values, async () => {
    throw new Error("process_must_not_run");
  });

  await assert.rejects(
    () => renderer.renderLongform(values.input),
    (error) =>
      error instanceof WeeklyLongformHyperframesRendererError &&
      error.codes.includes("visual_asset_sha256_mismatch"),
  );
  assert.deepEqual(fs.readdirSync(values.outputDir), []);
});

test("visual beats and alignment must be the exact hash-bound work-order inputs", async (t) => {
  const values = fixture(t);
  const renderer = configuredRenderer(values, async () => {
    throw new Error("process_must_not_run");
  });
  const alteredBeatPlan = structuredClone(values.input.visual_beat_plan);
  alteredBeatPlan.beats[0].purpose = "Unbound replacement purpose";

  await assert.rejects(
    () =>
      renderer.renderLongform({
        ...values.input,
        visual_beat_plan: alteredBeatPlan,
      }),
    (error) =>
      error instanceof WeeklyLongformHyperframesRendererError &&
      error.codes.includes("visual_beat_plan_work_order_mismatch"),
  );

  await assert.rejects(
    () =>
      renderer.renderLongform({
        ...values.input,
        alignment: {
          ...values.input.alignment,
          words: values.input.alignment.words.slice(0, -1),
        },
      }),
    (error) =>
      error instanceof WeeklyLongformHyperframesRendererError &&
      error.codes.includes("alignment_object_file_mismatch"),
  );
  assert.deepEqual(fs.readdirSync(values.outputDir), []);
});

test("renderer process failures and non-MP4 output fail closed with explicit blockers", async (t) => {
  const failed = fixture(t);
  const failedRenderer = configuredRenderer(failed, async (invocation) => ({
    status: invocation.phase === "check" ? 7 : 0,
    stdout: "",
    stderr: "check failed",
  }));
  await assert.rejects(
    () => failedRenderer.renderLongform(failed.input),
    (error) =>
      error instanceof WeeklyLongformHyperframesRendererError &&
      error.codes.includes("hyperframes_check_failed"),
  );

  const invalid = fixture(t);
  const invalidRenderer = configuredRenderer(invalid, async (invocation) => {
    if (invocation.phase === "render") {
      fs.writeFileSync(
        invocation.expected_output_path,
        Buffer.from("not-an-mp4"),
      );
    }
    return { status: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(
    () => invalidRenderer.renderLongform(invalid.input),
    (error) =>
      error instanceof WeeklyLongformHyperframesRendererError &&
      error.codes.includes("render_master_mp4_invalid"),
  );
});
