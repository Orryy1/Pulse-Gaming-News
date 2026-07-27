"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOwnedStillSvg,
  buildOwnedMotionPlan,
  inspectFfmpeg,
  materializeOwnedMotion,
  renderOwnedStill,
  renderOwnedVideo,
  validateApplyAuthority,
} = require("../../lib/services/governed-owned-motion");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function validIntake() {
  const fullScript = [
    "Delta Force just widened cheater compensation.",
    "Victims now qualify after a thirty-day ban, not only a ten-year ban.",
    "Confirmed compensation arrives by in-game mail within three business days.",
    "That makes recovery faster for players whose gear was lost to a cheater.",
  ].join(" ");
  return {
    schema_version: "pulse-governed-story-intake-v1",
    source_url:
      "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947",
    source_type: "official",
    source_evidence_path: "delta-force-official.html",
    source_evidence_sha256: sha256("official source evidence"),
    published_at: "2026-07-27T09:15:34.000Z",
    claims: [
      "Victims now qualify after a thirty-day ban, not only a ten-year ban.",
      "Compensation arrives within three business days.",
    ],
    story: {
      id: `official_${sha256("delta-force-story").slice(0, 24)}`,
      title: "Delta Force expands cheater compensation",
      hook: "Delta Force just widened cheater compensation.",
      full_script: fullScript,
      script_sha256: sha256(fullScript),
    },
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
    },
  };
}

test("buildOwnedMotionPlan creates a dry-run owned visual package for a validated intake", () => {
  const intake = validIntake();
  const plan = buildOwnedMotionPlan({
    intake,
    intakeManifestSha256: sha256(JSON.stringify(intake)),
    outputDir: "C:/proof/delta",
    generatedAt: "2026-07-27T11:00:00.000Z",
    ffmpegAvailable: true,
  });

  assert.equal(plan.mode, "DRY_RUN");
  assert.equal(plan.ready, true);
  assert.equal(plan.story_id, intake.story.id);
  assert.equal(plan.video.width, 1080);
  assert.equal(plan.video.height, 1920);
  assert.ok(plan.video.duration_seconds >= 25);
  assert.ok(plan.video.duration_seconds <= 32);
  assert.equal(plan.assets.filter((asset) => asset.media_type === "image").length, 4);
  assert.equal(plan.assets.filter((asset) => asset.media_type === "video").length, 1);
  assert.equal(new Set(plan.assets.map((asset) => asset.role)).size, 5);
  assert.ok(plan.assets.every((asset) => asset.ownership === "owned"));
  assert.ok(plan.assets.every((asset) => asset.rights_basis === "OWNED"));
  assert.ok(plan.assets.every((asset) => asset.attribution_required === false));
  assert.equal(plan.platform_theme.id, "gaming-neutral");
  assert.equal(plan.visual_grammar.change.before, "10 YEARS");
  assert.equal(plan.visual_grammar.change.after, "30 DAYS");
  assert.equal(plan.visual_grammar.timeline, "3 BUSINESS DAYS");
});

test("buildOwnedMotionPlan uses a platform theme only when the validated story supports it", () => {
  const intake = validIntake();
  intake.story.title = "Xbox changes Game Pass rewards";
  const plan = buildOwnedMotionPlan({
    intake,
    intakeManifestSha256: sha256(JSON.stringify(intake)),
    outputDir: "C:/proof/xbox",
    ffmpegAvailable: true,
  });
  assert.equal(plan.platform_theme.id, "xbox");
  assert.equal(plan.platform_theme.label, "XBOX");
});

test("owned still grammar is data-driven for the FFXIV Evercold feature stack", () => {
  const intake = validIntake();
  intake.story.id = "official_d86953ca92ca";
  intake.story.title = "Final Fantasy XIV reveals Evercold";
  intake.story.hook = "Evercold changes how Final Fantasy XIV players build and progress.";
  intake.story.full_script = [
    "Evercold adds dual greatshields and a defensive Bastion stance.",
    "Evolved Mode expands combat choices.",
    "The story branches while encounters scale automatically.",
    "A Final Fantasy VII raid is coming too.",
    "The Switch 2 version arrives on 4 August.",
  ].join(" ");
  intake.story.script_sha256 = sha256(intake.story.full_script);
  intake.story.visual_brief = {
    format: "owned-motion-only",
    palette: ["#9EEBFF", "#244866", "#E8F8FF", "#FF6B1A"],
    scenes: [
      "A cold metallic title strike introduces two abstract shield silhouettes.",
      "Two shield cards lock together around the word BASTION.",
      "A mode switch animates from REBORN to EVOLVED with EVOLVED selected.",
      "A branching route map reforms while a level meter auto-balances.",
      "An eight-slot raid grid resolves into the text BEYOND THE LIFESTREAM.",
      "A Nintendo-themed red platform card reveals SWITCH 2 and 4 AUGUST without using protected logos.",
    ],
  };
  intake.claims = [
    "Dual greatshields unlock the defensive Bastion stance.",
    "Evolved Mode expands combat choices.",
    "The story branches and encounters scale automatically.",
    "A Final Fantasy VII raid joins the update.",
    "The Nintendo Switch 2 version arrives on 4 August.",
  ];
  const plan = buildOwnedMotionPlan({
    intake,
    intakeManifestSha256: sha256(JSON.stringify(intake)),
    outputDir: "C:/proof/evercold",
    ffmpegAvailable: true,
  });
  const svg = plan.visual_grammar.sequence
    .map((role) => buildOwnedStillSvg({ role, intake, plan }))
    .join("\n");

  assert.equal(plan.visual_grammar.comparison_mode, "feature_stack");
  assert.equal(plan.visual_grammar.timeline, "AUG 4");
  assert.equal(plan.platform_theme.id, "visual-brief");
  assert.equal(plan.assets.filter((asset) => asset.media_type === "image").length, 6);
  assert.match(svg, /DUAL GREATSHIELDS/i);
  assert.match(svg, /BASTION/i);
  assert.match(svg, /EVOLVED MODE/i);
  assert.match(svg, /BRANCHING \+ SCALING/i);
  assert.match(svg, /FFVII RAID/i);
  assert.match(svg, /SWITCH 2/i);
  assert.doesNotMatch(svg, /BAN CONFIRMED|COMPENSATION SENT|CHEATER/i);
});

test("validateApplyAuthority requires apply, exact identity and a fail-closed local review environment", () => {
  const intake = validIntake();
  const intakeManifestSha256 = sha256(JSON.stringify(intake));
  const plan = buildOwnedMotionPlan({
    intake,
    intakeManifestSha256,
    outputDir: "C:/proof/delta",
    ffmpegAvailable: true,
  });

  const authority = validateApplyAuthority({
    applyRequested: true,
    confirmStoryId: intake.story.id,
    confirmManifestSha256: intakeManifestSha256,
    plan,
    env: {
      DEPLOYMENT_MODE: "railway",
      PULSE_OPERATING_MODE: "AUTO_PUBLISH",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "false",
    },
  });

  assert.equal(authority.authorised, false);
  assert.ok(authority.blockers.includes("local_proof_environment_required"));
  assert.ok(authority.blockers.includes("human_review_operating_mode_required"));
  assert.ok(authority.blockers.includes("auto_publish_must_be_false"));
  assert.ok(authority.blockers.includes("guarded_live_dispatch_must_be_false"));
  assert.ok(authority.blockers.includes("emergency_kill_switch_must_be_tripped"));
});

test("materializeOwnedMotion writes only a validated owned asset package under the explicit output root", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-owned-motion-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const intake = validIntake();
  const intakeManifestSha256 = sha256(JSON.stringify(intake));
  const generatedAt = "2026-07-27T11:15:00.000Z";
  const plan = buildOwnedMotionPlan({
    intake,
    intakeManifestSha256,
    outputDir: root,
    generatedAt,
    ffmpegAvailable: true,
  });
  const authority = validateApplyAuthority({
    applyRequested: true,
    confirmStoryId: intake.story.id,
    confirmManifestSha256: intakeManifestSha256,
    plan,
    env: {
      DEPLOYMENT_MODE: "local",
      PULSE_OPERATING_MODE: "HUMAN_REVIEW",
      AUTO_PUBLISH: "false",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
      PULSE_EMERGENCY_KILL_SWITCH: "true",
    },
  });

  const result = await materializeOwnedMotion({
    intake,
    plan,
    authority,
    generatedAt,
    renderStill: async ({ outputPath, role }) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `owned-still:${role}`);
    },
    renderVideo: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, "owned-video");
    },
    inspectAsset: async ({ mediaType }) =>
      mediaType === "image"
        ? { width: 1080, height: 1920, duration_seconds: null }
        : { width: 1080, height: 1920, duration_seconds: 28 },
  });

  assert.equal(result.manifest.schema_version, "pulse-owned-motion-manifest-v1");
  assert.equal(result.manifest.story_id, intake.story.id);
  assert.equal(result.manifest.assets.length, 5);
  assert.ok(result.manifest.assets.every((asset) => asset.ownership === "owned"));
  assert.ok(result.manifest.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)));
  assert.ok(result.manifest.assets.every((asset) => !path.isAbsolute(asset.path)));
  assert.ok(result.manifest.assets.every((asset) => asset.path.startsWith("assets/")));
  assert.ok(fs.existsSync(result.manifest_path));
  assert.ok(fs.existsSync(result.markdown_path));
  assert.equal(sha256(fs.readFileSync(result.manifest_path)), result.manifest_sha256);
  assert.equal(
    path.relative(root, result.manifest_path).startsWith(".."),
    false,
  );
});

test("materializeOwnedMotion removes staged media when output validation fails", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-owned-invalid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const intake = validIntake();
  const intakeManifestSha256 = sha256(JSON.stringify(intake));
  const plan = buildOwnedMotionPlan({
    intake,
    intakeManifestSha256,
    outputDir: root,
    ffmpegAvailable: true,
  });
  const authority = validateApplyAuthority({
    applyRequested: true,
    confirmStoryId: intake.story.id,
    confirmManifestSha256: intakeManifestSha256,
    plan,
    env: {
      DEPLOYMENT_MODE: "local",
      PULSE_OPERATING_MODE: "HUMAN_REVIEW",
      AUTO_PUBLISH: "false",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
      PULSE_EMERGENCY_KILL_SWITCH: "true",
    },
  });

  await assert.rejects(
    materializeOwnedMotion({
      intake,
      plan,
      authority,
      renderStill: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, "still");
      },
      renderVideo: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, "video");
      },
      inspectAsset: async ({ mediaType }) =>
        mediaType === "image"
          ? { width: 1080, height: 1920, duration_seconds: null }
          : { width: 1080, height: 1920, duration_seconds: 20 },
    }),
    /owned_motion_output_duration_invalid/,
  );
  assert.equal(fs.existsSync(path.join(plan.output_root, "assets")), false);
  assert.equal(
    fs.existsSync(path.join(plan.output_root, "owned-motion-manifest.json")),
    false,
  );
});

test("renderOwnedStill creates four distinct repository-owned 1080x1920 visual families", async (t) => {
  const sharp = require("sharp");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-owned-stills-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const intake = validIntake();
  const plan = buildOwnedMotionPlan({
    intake,
    intakeManifestSha256: sha256(JSON.stringify(intake)),
    outputDir: root,
    ffmpegAvailable: true,
  });

  const hashes = [];
  for (const asset of plan.assets.filter(
    (item) => item.media_type === "image",
  )) {
    const outputPath = path.join(root, asset.path);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await renderOwnedStill({
      outputPath,
      role: asset.role,
      intake,
      plan,
    });
    const metadata = await sharp(outputPath).metadata();
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1920);
    hashes.push(sha256(fs.readFileSync(outputPath)));
  }

  assert.equal(new Set(hashes).size, 4);
});

test("renderOwnedVideo builds a local-only 28-second motion sequence from the owned stills", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-owned-video-"));
  try {
    const stillPaths = Array.from({ length: 4 }, (_, index) => {
      const stillPath = path.join(root, `still-${index + 1}.png`);
      fs.writeFileSync(stillPath, `still-${index + 1}`);
      return stillPath;
    });
    const outputPath = path.join(root, "owned.mp4");
    let invocation = null;
    renderOwnedVideo({
      stillPaths,
      outputPath,
      plan: { video: { duration_seconds: 28, fps: 30 } },
      spawnSyncImpl: (command, args) => {
        invocation = { command, args };
        fs.writeFileSync(outputPath, "video");
        return { status: 0, stderr: "" };
      },
    });

    assert.equal(invocation.command, "ffmpeg");
    assert.equal(invocation.args.filter((arg) => arg === "-i").length, 4);
    assert.ok(invocation.args.includes("libx264"));
    assert.ok(invocation.args.includes("yuv420p"));
    assert.match(invocation.args.join(" "), /zoompan/);
    assert.match(
      invocation.args[invocation.args.indexOf("-filter_complex") + 1],
      /setpts=PTS-STARTPTS\[v0\]/,
    );
    assert.doesNotMatch(invocation.args.join(" "), /https?:|steam|trailer/i);
    assert.equal(invocation.args.at(-1), outputPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("inspectFfmpeg fails closed when the local renderer is unavailable", () => {
  assert.equal(
    inspectFfmpeg({
      spawnSyncImpl: () => ({ status: 1, stderr: "not found" }),
    }).available,
    false,
  );
});

module.exports = {
  validIntake,
};
