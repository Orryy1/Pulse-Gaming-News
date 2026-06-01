"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  buildOverlayLayout,
  buildClipScenePlan,
  buildOverlayChain,
  drawtextEscape,
  parseArgs,
  renderNarrationScriptText,
  resolveReadableMediaPath,
  resolveStoryMusicCueMix,
  subtitleWordsFromTimestampPayload,
  validateProofTimestampPayload,
  assertProofAudioSegmentLoudness,
  resolveStorySfxCueMix,
  resolveStorySfxPaths,
} = require("../../tools/studio-v4-proof-render");
const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
} = require("../../lib/studio/v4/render-policy");
const { buildKineticAss } = require("../../lib/studio/v2/subtitle-layer-v2");
const proofRenderLib = require("../../lib/studio/v4/proof-render");

test("Studio V4 proof renderer plans motion-only scenes across full narration", () => {
  const plan = buildClipScenePlan({
    clips: ["a.mp4", "b.mp4", "c.mp4"],
    durationS: 18,
    xfadeS: 0.25,
  });

  assert.equal(plan.scenes.length, 3);
  assert.equal(plan.segmentDurationS, 6.17);
  assert.deepEqual(plan.scenes.map((scene) => scene.path), ["a.mp4", "b.mp4", "c.mp4"]);
});

test("Studio V4 proof renderer CLI stays local and story-json driven", () => {
  const args = parseArgs([
    "node",
    "tools/studio-v4-proof-render.js",
    "--story-json",
    "test/output/story.json",
    "--output",
    "test/output/out.mp4",
    "--json",
  ]);

  assert.equal(args.storyJson, "test/output/story.json");
  assert.equal(args.output, "test/output/out.mp4");
  assert.equal(args.json, true);
});

test("Studio V4 proof renderer prefers MEDIA_ROOT for absolute legacy output audio paths", async () => {
  assert.equal(typeof resolveReadableMediaPath, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-v4-proof-media-root-"));
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-v4-proof-media-root-cache-"));
  const previousMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const workspacePath = path.join(root, "output", "audio", "caption-drift_timestamps.json");
    const mediaPath = path.join(mediaRoot, "output", "audio", "caption-drift_timestamps.json");
    fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
    fs.writeFileSync(workspacePath, JSON.stringify({ words: [{ word: "stale", start: 0, end: 0.2 }] }));
    fs.writeFileSync(mediaPath, JSON.stringify({ words: [{ word: "fresh", start: 0, end: 0.2 }] }));

    const resolved = await resolveReadableMediaPath(workspacePath);

    assert.equal(resolved, mediaPath);
  } finally {
    if (previousMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = previousMediaRoot;
  }
});

test("Studio V4 proof renderer converts percent signs before drawtext", () => {
  const escaped = drawtextEscape("Super Mario RPG - $15 (70% off)");

  assert.equal(escaped.includes("%"), false);
  assert.match(escaped, /70 percent off/);
});

test("Studio V4 proof renderer is exposed as a first-class library module", () => {
  assert.equal(typeof proofRenderLib.renderProof, "function");
  assert.equal(typeof proofRenderLib.buildClipScenePlan, "function");

  const plan = proofRenderLib.buildClipScenePlan({
    clips: ["one.mp4", "two.mp4"],
    durationS: 10,
  });

  assert.equal(plan.scenes.length, 2);
  assert.equal(plan.scenes[0].path, "one.mp4");
});

test("Studio V4 proof renderer prefers licensed creator-studio SFX over legacy placeholders", async () => {
  assert.equal(typeof resolveStorySfxPaths, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-render-"));
  const impact = path.join(root, "impact.wav");
  const transition = path.join(root, "transition.wav");
  const rejected = path.join(root, "rejected.wav");
  fs.writeFileSync(impact, Buffer.alloc(128, 1));
  fs.writeFileSync(transition, Buffer.alloc(128, 2));
  fs.writeFileSync(rejected, Buffer.alloc(128, 3));

  const paths = await resolveStorySfxPaths({
    sfx_asset_inventory: [
      {
        role: "impact",
        provider_id: "sonniss",
        source_url: pathToFileURL(impact).href,
        approval_status: "approved_for_commercial_editorial_use",
        quality_tier: "creator_studio",
      },
      {
        role: "transition",
        provider_id: "boom_library",
        source_url: pathToFileURL(transition).href,
        approval_status: "approved_for_commercial_editorial_use",
        quality_tier: "creator_studio",
      },
      {
        role: "glitch",
        provider_id: "unknown",
        source_url: pathToFileURL(rejected).href,
        approval_status: "blocked",
      },
    ],
  });

  assert.deepEqual(paths, [transition]);
});

test("Studio V4 proof renderer schedules SFX by editorial role with narration-safe gains", async () => {
  assert.equal(typeof resolveStorySfxCueMix, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-mix-"));
  const files = {
    transition: path.join(root, "transition.wav"),
    impact: path.join(root, "impact.wav"),
    ui: path.join(root, "Rescopic Sound - User Interaction", "UIClick_Select Middle 29.wav"),
    sub: path.join(root, "sub.wav"),
  };
  for (const [index, file] of Object.values(files).entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "hook_slam", family: "impact", atS: 0 },
          { target_kind: "motion_clip", family: "whoosh", atS: 0.35 },
          { target_kind: "source_lock", family: "source_tick", atS: 2.75 },
          { target_kind: "price_snap", family: "cash_snap", atS: 24.6 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        role: "transition",
        provider_id: "sonniss",
        source_url: pathToFileURL(files.transition).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "impact",
        provider_id: "sonniss",
        source_url: pathToFileURL(files.impact).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(files.ui).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "sub_hit",
        provider_id: "sonniss",
        source_url: pathToFileURL(files.sub).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.role), ["ui_tick"]);
  assert.deepEqual(mix.map((cue) => cue.target_kind), ["source_lock"]);
  assert.deepEqual(mix.map((cue) => cue.path), [files.ui]);
  assert.ok(mix.every((cue) => cue.volume <= 0.016));
  assert.ok(mix.every((cue) => cue.durationS <= 0.14));
  assert.deepEqual(mix.map((cue) => cue.delayMs), [2750]);
});

test("Studio V4 proof renderer resolves Epidemic music beds and stings from the channel pack", async () => {
  assert.equal(typeof resolveStoryMusicCueMix, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-v4-music-pack-"));
  const epidemicRoot = path.join(root, "audio", "epidemic");
  const bedA = path.join(epidemicRoot, "music", "bed_primary", "a.mp3");
  const bedB = path.join(epidemicRoot, "music", "bed_primary", "b.mp3");
  const breakingBed = path.join(epidemicRoot, "music", "bed_breaking", "breaking.mp3");
  const verifiedSting = path.join(epidemicRoot, "stings", "sting_verified", "verified.mp3");
  for (const file of [bedA, bedB, breakingBed, verifiedSting]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, 1));
  }

  const mix = await resolveStoryMusicCueMix(
    {
      id: "story-alpha",
      channel_id: "pulse-gaming",
      flair: "Verified",
    },
    {
      workspaceRoot: root,
      packConfigs: [
        {
          id: "pulse-gaming-epidemic-v1",
          channel_id: "pulse-gaming",
          root_path: "audio/epidemic",
          variants: {
            bed_primary: [
              { role: "bed_primary", filename: "music/bed_primary/a.mp3", provider_id: "epidemic_sound" },
              { role: "bed_primary", filename: "music/bed_primary/b.mp3", provider_id: "epidemic_sound" },
            ],
            bed_breaking: [
              { role: "bed_breaking", filename: "music/bed_breaking/breaking.mp3", provider_id: "epidemic_sound" },
            ],
            sting_verified: [
              { role: "sting_verified", filename: "stings/sting_verified/verified.mp3", provider_id: "epidemic_sound" },
            ],
          },
        },
      ],
    },
  );

  assert.equal(mix.provider_id, "epidemic_sound");
  assert.equal(mix.bed.role, "bed_primary");
  assert.match(mix.bed.path, /audio[\\/]epidemic[\\/]music[\\/]bed_primary[\\/][ab]\.mp3$/);
  assert.equal(mix.sting.role, "sting_verified");
  assert.equal(mix.policy.duck_under_narration, true);
  assert.equal(mix.policy.raw_bed_volume <= 0.12, true);
});

test("Studio V4 proof renderer keeps flash captions above lower-third and bottom-edge risk", () => {
  const ass = buildKineticAss({
    story: { title: "Hades II Just Broke PlayStation's Silence" },
    words: [
      { word: "Hades", start: 0, end: 0.2 },
      { word: "two", start: 0.22, end: 0.42 },
      { word: "lands", start: 0.5, end: 0.72 },
      { word: "on", start: 0.75, end: 0.86 },
      { word: "PlayStation", start: 0.9, end: 1.2 },
    ],
    duration: 2,
    scriptText: "Hades II lands on PlayStation.",
    captionCase: "upper",
    revealMode: "word",
    motionStyle: "flash",
  });

  assert.match(ass, /Style: Pop,Impact,82,/);
  assert.match(ass, /\\move\(540,1378,540,1342,0,130\)/);
  assert.doesNotMatch(ass, /\\move\(540,1484,540,1450,0,130\)/);
});

test("Studio V4 proof renderer masks baked-in source text zones before overlays", () => {
  const chain = buildOverlayChain({
    story: {
      id: "source-text-risk",
      title: "Hades II Just Broke PlayStation's Silence",
      canonical_subject: "Hades II",
      primary_source: "Xbox",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 30,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /drawbox=x=0:y=138:w=iw:h=164:color=black@0\.56:t=fill/);
  assert.match(chain, /drawbox=x=0:y=ih-430:w=iw:h=430:color=black@0\.52:t=fill/);
  assert.match(chain, /drawbox=x=0:y=ih-315:w=iw:h=315:color=black@0\.66:t=fill/);
});

test("Studio V4 proof renderer masks vertical frame edges before text audits", () => {
  const chain = buildOverlayChain({
    story: {
      id: "frame-edge-risk",
      title: "Subnautica 2 Reportedly Leaked Early",
      canonical_subject: "Subnautica 2",
      primary_source: "RespawnFirst",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 30,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /drawbox=x=0:y=0:w=44:h=ih:color=0x0B0F19@0\.72:t=fill/);
  assert.match(chain, /drawbox=x=iw-44:y=0:w=44:h=ih:color=0x0B0F19@0\.72:t=fill/);
  assert.doesNotMatch(chain, /drawbox=x=0:y=0:w=18:h=ih:color=0x0B0F19@0\.52:t=fill/);
});

test("Studio V4 proof renderer widens edge masks for safe-margin repair renders", () => {
  const chain = buildOverlayChain({
    story: {
      id: "frame-edge-safe-margin",
      title: "Star Wars Racer Date Leaked Early",
      canonical_subject: "Star Wars Racer",
      primary_source: "Game Rant",
      render_safe_text_margins: true,
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 30,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /drawbox=x=0:y=0:w=72:h=ih:color=0x0B0F19@0\.80:t=fill/);
  assert.match(chain, /drawbox=x=iw-72:y=0:w=72:h=ih:color=0x0B0F19@0\.80:t=fill/);
  assert.doesNotMatch(chain, /drawbox=x=0:y=0:w=44:h=ih:color=0x0B0F19@0\.72:t=fill/);
});

test("Studio V4 proof renderer unlocks richer SFX only for curated Epidemic packs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-epidemic-rich-"));
  const files = {
    impact: path.join(root, "audio", "epidemic", "sfx", "epidemic_impact_hit.wav"),
    transition: path.join(root, "audio", "epidemic", "sfx", "epidemic_transition_whoosh.wav"),
    ui: path.join(root, "audio", "epidemic", "sfx", "epidemic_ui_tick_ui-click-short.wav"),
    sub: path.join(root, "audio", "epidemic", "sfx", "epidemic_sub_hit_boom.wav"),
    glitch: path.join(root, "audio", "epidemic", "sfx", "epidemic_glitch_static.wav"),
  };
  for (const [index, file] of Object.values(files).entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "hook_slam", family: "impact", atS: 0 },
          { target_kind: "motion_clip", family: "whoosh", atS: 0.35 },
          { target_kind: "source_lock", family: "source_tick", atS: 2.75 },
          { target_kind: "proof_card", family: "sub_hit", atS: 4.5 },
          { target_kind: "pattern_interrupt", family: "glitch", atS: 12.1 },
        ],
      },
    },
    sfx_asset_inventory: [
      { asset_id: "epidemic-impact", role: "impact", provider_id: "epidemic_sound", source_url: pathToFileURL(files.impact).href, approval_status: "approved_for_commercial_editorial_use" },
      { asset_id: "epidemic-transition", role: "transition", provider_id: "epidemic_sound", source_url: pathToFileURL(files.transition).href, approval_status: "approved_for_commercial_editorial_use" },
      { asset_id: "epidemic-ui", role: "ui_tick", provider_id: "epidemic_sound", source_url: pathToFileURL(files.ui).href, approval_status: "approved_for_commercial_editorial_use" },
      { asset_id: "epidemic-sub", role: "sub_hit", provider_id: "epidemic_sound", source_url: pathToFileURL(files.sub).href, approval_status: "approved_for_commercial_editorial_use" },
      { asset_id: "epidemic-glitch", role: "glitch", provider_id: "epidemic_sound", source_url: pathToFileURL(files.glitch).href, approval_status: "approved_for_commercial_editorial_use" },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.role), ["impact", "transition", "ui_tick", "sub_hit", "glitch"]);
  assert.deepEqual(mix.map((cue) => cue.target_kind), ["hook_slam", "motion_clip", "source_lock", "proof_card", "pattern_interrupt"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.055));
  assert.ok(mix.find((cue) => cue.role === "ui_tick").volume <= 0.004);
  assert.ok(mix.every((cue) => cue.durationS <= 0.55));
});

test("Studio V4 proof renderer uses only source-lock ticks when cue timing is absent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-fallback-"));
  const impact = path.join(root, "impact.wav");
  const transition = path.join(root, "transition.wav");
  const ui = path.join(root, "Rescopic Sound - User Interaction", "UIClick_Select Middle 29.wav");
  const glitch = path.join(root, "glitch.wav");
  for (const [index, file] of [impact, transition, ui, glitch].entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sfx_asset_inventory: [
      {
        role: "impact",
        provider_id: "sonniss",
        source_url: pathToFileURL(impact).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "transition",
        provider_id: "sonniss",
        source_url: pathToFileURL(transition).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(ui).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "glitch",
        provider_id: "sonniss",
        source_url: pathToFileURL(glitch).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.role), ["ui_tick"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.016));
  assert.ok(mix.every((cue) => cue.durationS <= 0.14));
});

test("Studio V4 proof renderer keeps source-lock SFX quiet and UI-only", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-subtle-"));
  const ui = path.join(root, "Rescopic Sound - User Interaction", "UIClick_Select Middle 29.wav");
  const impact = path.join(root, "impact.wav");
  fs.mkdirSync(path.dirname(ui), { recursive: true });
  fs.writeFileSync(ui, Buffer.alloc(128, 1));
  fs.writeFileSync(impact, Buffer.alloc(128, 2));

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.2 },
          { target_kind: "hook_slam", family: "impact", atS: 0.15 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        role: "impact",
        provider_id: "sonniss",
        source_url: pathToFileURL(impact).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        role: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(ui).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.role), ["ui_tick"]);
  assert.deepEqual(mix.map((cue) => cue.target_kind), ["source_lock"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.016));
  assert.ok(mix.every((cue) => cue.durationS <= 0.14));
});

test("Studio V4 proof renderer captions the canonical narration instead of stale instruction-like TTS fields", () => {
  assert.equal(typeof renderNarrationScriptText, "function");

  const script = renderNarrationScriptText({
    narration_script:
      "Warhammer 40,000: Boltgun 2 takes the retro FPS chaos outdoors. IGN previewed the new demo and the player question is whether bigger arenas make the sequel feel sharper.",
    full_script:
      "Before you spend, check the live price, the platform listing and whether the deal is still active. Treat the headline as a price check, not a victory lap.",
    tts_script:
      "The player angle is simple: check the price, access or platform details before you decide what to play next.",
  });

  assert.match(script, /Boltgun 2 takes the retro FPS chaos outdoors/);
  assert.doesNotMatch(script, /Before you spend|player angle is simple|platform details before you decide/i);
});

test("Studio V4 proof renderer prefers explicit word timestamps over rough character alignments", () => {
  assert.equal(typeof subtitleWordsFromTimestampPayload, "function");

  const words = subtitleWordsFromTimestampPayload({
    words: [
      { word: "Hades", start: 0.04, end: 0.28 },
      { word: "II", start: 0.31, end: 0.48 },
      { word: "lands", start: 0.55, end: 0.9 },
    ],
    alignment: {
      characters: Array.from("Wrong stale text"),
      character_start_times_seconds: Array.from("Wrong stale text", (_, index) => index * 0.5),
      character_end_times_seconds: Array.from("Wrong stale text", (_, index) => index * 0.5 + 0.2),
    },
  });

  assert.deepEqual(words.map((word) => word.word), ["Hades", "II", "lands"]);
  assert.equal(words[1].start, 0.31);
});

test("Studio V4 proof renderer blocks local preview renders without ASR-aligned timestamps", () => {
  assert.equal(typeof validateProofTimestampPayload, "function");

  assert.throws(
    () =>
      validateProofTimestampPayload({
        meta: {
          provider: "local",
          wordTimestampSource: "local_audio_silence_anchored",
        },
        words: [
          { word: "Hades", start: 0, end: 0.2 },
          { word: "sequel", start: 0.24, end: 0.5 },
        ],
      }),
    /proof render requires local_whisper_word_alignment timestamps/,
  );
});

test("Studio V4 proof renderer accepts strict local Whisper timestamps for review renders", () => {
  const result = validateProofTimestampPayload({
    meta: {
      provider: "local",
      wordTimestampSource: "local_whisper_word_alignment",
    },
    words: [
      { word: "Hades", start: 0, end: 0.2 },
      { word: "sequel", start: 0.24, end: 0.5 },
    ],
  });

  assert.equal(result.word_timestamp_source, "local_whisper_word_alignment");
  assert.equal(result.local_timing_strict, true);
});

test("Studio V4 proof renderer blocks review MP4s with mid-render voice jumps", () => {
  assert.equal(typeof assertProofAudioSegmentLoudness, "function");

  assert.throws(
    () =>
      assertProofAudioSegmentLoudness({
        verdict: "fail",
        blockers: ["voice_segment_loudness_jump"],
      }),
    /proof render audio segment loudness failed: voice_segment_loudness_jump/,
  );
});

test("Studio V4 proof renderer accepts stable segment loudness evidence", () => {
  const result = assertProofAudioSegmentLoudness({
    verdict: "pass",
    blockers: [],
    metrics: { mean_range_db: 1.2 },
  });

  assert.equal(result.verdict, "pass");
  assert.equal(result.metrics.mean_range_db, 1.2);
});

test("Studio V4 proof renderer rejects misclassified field-recording and voice SFX at mix time", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-editorial-mix-"));
  const engine = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Cactuzz Sound - 1993 Suzuki VS 800 GL Intruder",
    "1993 Suzuki VS 800 GL Intruder, engine start, city cruise.wav",
  );
  const voice = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Cybernetix - Sci-Fi UI Voice",
    "Hostile Territory Detected.wav",
  );
  const activation = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Glitchedtones - Activation User Interface",
    "Activation_UI_Click_33.wav",
  );
  const cleanClick = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Rescopic Sound - User Interaction",
    "UIClick_Select Middle 29.wav",
  );
  fs.mkdirSync(path.dirname(engine), { recursive: true });
  fs.mkdirSync(path.dirname(voice), { recursive: true });
  fs.mkdirSync(path.dirname(activation), { recursive: true });
  fs.mkdirSync(path.dirname(cleanClick), { recursive: true });
  fs.writeFileSync(engine, Buffer.alloc(128, 1));
  fs.writeFileSync(voice, Buffer.alloc(128, 2));
  fs.writeFileSync(activation, Buffer.alloc(128, 3));
  fs.writeFileSync(cleanClick, Buffer.alloc(128, 4));

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.2 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        asset_id: "engine-misfiled-as-ui",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(engine).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "voice-misfiled-as-ui",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(voice).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "activation-click-too-harsh",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(activation).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "clean-user-interaction-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(cleanClick).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.asset_id), ["clean-user-interaction-click"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.016));
  assert.ok(mix.every((cue) => cue.durationS <= 0.14));
});

test("Studio V4 proof renderer rejects alert and activation clicks for source locks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-source-lock-tight-"));
  const alert = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Rescopic Sound - User Interaction",
    "UIAlert_Confirm Middle 12_RSCPC_USIN.wav",
  );
  const activation = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "CB Sounddesign",
    "Activation_UI_Click_33.wav",
  );
  const cleanClick = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Rescopic Sound - User Interaction",
    "UIClick_Select Middle 29_RSCPC_USIN.wav",
  );
  for (const [index, file] of [alert, activation, cleanClick].entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.4 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        asset_id: "alert-confirm-too-editorial",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(alert).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "activation-click-too-harsh",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(activation).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "clean-select-tick",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(cleanClick).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.asset_id), ["clean-select-tick"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.01));
  assert.ok(mix.every((cue) => cue.durationS <= 0.1));
});

test("Studio V4 proof renderer picks a compact newsroom click for source locks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-plain-click-"));
  const longSelect = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Rescopic Sound - User Interaction",
    "UIClick_Select Middle 29_RSCPC_USIN.wav",
  );
  const plainClick = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "Rescopic Sound - User Interaction",
    "UIClick_UI Click Short 03_RSCPC_USIN.wav",
  );
  const highTechBeep = path.join(
    root,
    "audio",
    "sonniss",
    "GDC2024",
    "BluezoneCorp - Futuristic User Interface",
    "Bluezone_BC0303_futuristic_user_interface_high_tech_beep_038.wav",
  );
  for (const [index, file] of [longSelect, plainClick, highTechBeep].entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.6 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        asset_id: "long-select-middle",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(longSelect).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "clean-user-interaction-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(plainClick).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "high-tech-beep",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: pathToFileURL(highTechBeep).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.asset_id), ["clean-user-interaction-click"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.004));
  assert.ok(mix.every((cue) => cue.durationS <= 0.07));
});

test("Studio V4 proof renderer accepts clean Epidemic interface clicks for source locks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sfx-epidemic-source-lock-"));
  const cleanClick = path.join(
    root,
    "audio",
    "epidemic",
    "sfx",
    "epidemic_ui_tick_03_user-interface-click-standard-short-clean-variations-epidemic-sound.mp3",
  );
  const alertClick = path.join(
    root,
    "audio",
    "epidemic",
    "sfx",
    "epidemic_ui_tick_alert-notification-confirm-positive-epidemic-sound.mp3",
  );
  for (const [index, file] of [alertClick, cleanClick].entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(128, index + 1));
  }

  const mix = await resolveStorySfxCueMix({
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.75 },
        ],
      },
    },
    sfx_asset_inventory: [
      {
        asset_id: "epidemic-alert-confirm",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "epidemic_sound",
        source_url: pathToFileURL(alertClick).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "epidemic-clean-interface-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "epidemic_sound",
        source_url: pathToFileURL(cleanClick).href,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.deepEqual(mix.map((cue) => cue.asset_id), ["epidemic-clean-interface-click"]);
  assert.ok(mix.every((cue) => cue.volume <= 0.004));
  assert.ok(mix.every((cue) => cue.durationS <= 0.07));
});

test("Studio V4 overlay chain uses story-specific proof cards instead of hardcoded benchmark copy", () => {
  assert.equal(typeof buildOverlayChain, "function");

  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Lego Batman",
      primary_source: "GameSpot",
      first_frame_text: "LEGO BATMAN",
      thumbnail_headline: "ARKHAM DNA",
      proof_card_primary: "ROCKSTEADY LISTED",
      proof_card_secondary: "ARKHAM-LITE COMBAT",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /LEGO BATMAN/);
  assert.match(chain, /ARKHAM DNA/);
  assert.match(chain, /ROCKSTEADY LISTED/);
  assert.match(chain, /ARKHAM-LITE COMBAT/);
  assert.doesNotMatch(chain, /STEAMDB PEAK|MORE THAN 3X FH5 PEAK|OPTIMISED\. NO DENUVO/);
});

test("Studio V4 overlay chain avoids raw straight apostrophes inside ffmpeg drawtext strings", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Assassin's Creed Black Flag",
      primary_source: "Eurogamer",
      first_frame_text: "Assassin's Creed Black Flag",
      thumbnail_headline: "Assassin's Creed Black Flag",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /ASSASSIN\u2019S CREED/);
  assert.doesNotMatch(chain, /ASSASSIN\\'S|ASSASSIN'S/);
});

test("Studio V4 proof renderer keeps source footage inside a safe vertical compose", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v4-proof-render.js"),
    "utf8",
  );

  assert.match(source, /split=2\[bgsrc\$\{i\}\]\[fgsrc\$\{i\}\]/);
  assert.match(source, /boxblur=32:1/);
  assert.match(source, /scale=940:1660:force_original_aspect_ratio=decrease:in_range=pc:out_range=tv/);
  assert.match(source, /overlay=\(W-w\)\/2:\(H-h\)\/2/);
  assert.doesNotMatch(source, /crop=1080:1920:\(iw-1080\)\/2:\(ih-1920\)\/2/);
  assert.match(source, /\[overlayBase\]ass=\$\{assPathFilter\(assPath\)\},format=yuv420p\[outv\]/);
  assert.match(source, /"-pix_fmt",\s*"yuv420p"/);
});

test("Studio V4 proof renderer strips input SFX metadata and chapters from final MP4s", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v4-proof-render.js"),
    "utf8",
  );

  assert.match(source, /"-map_metadata",\s*"-1"/);
  assert.match(source, /"-map_chapters",\s*"-1"/);
});

test("Studio V4 proof renderer uses stable voice gain and final mixed loudness", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v4-proof-render.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /dynaudnorm/);
  assert.match(source, /acompressor=threshold=-30dB:ratio=5\.5:attack=4:release=260:makeup=1/);
  assert.match(source, /alimiter=limit=0\.68:level=disabled/);
  assert.match(source, /amix=inputs=\$\{mixLabels\.length\}:duration=first:dropout_transition=0:normalize=0/);
  assert.match(source, /loudnorm=I=-17:TP=-2\.5:LRA=5/);
  assert.match(source, /loudnorm=I=-16:TP=-2:LRA=6/);
  assert.match(source, /atrim=duration=\$\{cueDuration\.toFixed\(3\)\},afade=t=in/);
});

test("Studio V4 proof renderer reports current SFX, voice and visual design policies", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v4-proof-render.js"),
    "utf8",
  );

  assert.match(source, /sfx_mix_policy_version:\s*STUDIO_V4_SFX_MIX_POLICY_VERSION/);
  assert.match(source, /voice_mix_policy_version:\s*STUDIO_V4_VOICE_MIX_POLICY_VERSION/);
  assert.match(source, /visual_design_policy_version:\s*STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION/);
  assert.equal(STUDIO_V4_SFX_MIX_POLICY_VERSION, "source_lock_news_tick_v6");
  assert.equal(STUDIO_V4_VOICE_MIX_POLICY_VERSION, "local_voice_levelled_v2");
  assert.equal(STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION, "newsroom_safe_vertical_compose_v8");
});

test("Studio V4 overlay chain brightens the opening instead of globally darkening first frames", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Steam Controller",
      primary_source: "Eurogamer",
      first_frame_text: "STEAM CONTROLLER DATE LEAK",
      thumbnail_headline: "STEAM CONTROLLER DATE LEAK",
      proof_card_primary: "DATE WINDOW WATCH",
      proof_card_secondary: "PRICE AND COMPATIBILITY",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /eq=brightness='if\(lt\(t\\,3\.3\)\\,0\.055\\,-0\.015\)':contrast=1\.10:saturation=1\.20:eval=frame/);
  assert.doesNotMatch(chain, /eq=brightness=-0\.045/);
});

test("Studio V4 overlay chain uses layered premium plates instead of flat orange blocks", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Forza Horizon 6",
      primary_source: "Insider Gaming",
      first_frame_text: "FORZA PRICE JUMP",
      thumbnail_headline: "PRICE CHECK",
      proof_card_primary: "STORE LISTING WATCH",
      proof_card_secondary: "BUY, WAIT OR SKIP",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.doesNotMatch(chain, /x=70:y=508:w=940:h=208:color=0xFF6B1A@0\.88:t=fill/);
  assert.match(chain, /color=0x111827@0\.58/);
  assert.match(chain, /shadowcolor=black@0\.82:shadowx=3:shadowy=3/);
  assert.match(chain, /mod\(t\*520\\,1540\)/);
  assert.match(chain, /SOURCE LOCK/);
});

test("Studio V4 overlay chain adds newsroom-grade labels and layered glass rails", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Boltgun 2",
      primary_source: "IGN",
      first_frame_text: "BOLTGUN 2",
      thumbnail_headline: "LOUDER THAN EXPECTED",
      proof_card_primary: "DEMO IMPRESSIONS",
      proof_card_secondary: "WHY PLAYERS CARE",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /PULSE \/\/ NEWSWIRE/);
  assert.match(chain, /VERIFY/);
  assert.match(chain, /PROOF BEAT/);
  assert.match(chain, /PLAYER READ/);
  assert.match(chain, /color=0x0B0F19@0\.72/);
  assert.match(chain, /color=0x38BDF8@0\.34/);
  assert.doesNotMatch(chain, /color=0xFF6B1A@0\.88:t=fill/);
});

test("Studio V4 overlay chain avoids large flat text cards over real footage", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Boltgun 2",
      primary_source: "IGN",
      first_frame_text: "BOLTGUN 2",
      thumbnail_headline: "LOUDER THAN EXPECTED",
      proof_card_primary: "DEMO IMPRESSIONS",
      proof_card_secondary: "BIGGER ARENAS",
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.doesNotMatch(chain, /w=9[0-9]{2}:h=2[0-9]{2}:color=0x111827@0\.7[0-9]:t=fill/);
  assert.match(chain, /:t=2:enable='between\(t,0,3\.3\)'/);
  assert.match(chain, /0x38BDF8@0\.92/);
  assert.match(chain, /0xF8FAFC@0\.88/);
});

test("Studio V4 overlay layout keeps long mobile text inside safe frame bounds", () => {
  assert.equal(typeof buildOverlayLayout, "function");

  const layout = buildOverlayLayout({
    story: {
      canonical_subject: "Pokemon Go",
      primary_source: "Eurogamer",
      first_frame_text: "Pokemon Go Mega Mewtwo Is",
      thumbnail_headline: "Pokemon Go Mega Mewtwo Is",
      proof_card_primary: "Mega Mewtwo finally has a Pokemon Go route",
      proof_card_secondary: "Free Go Fest access changes the player ask",
    },
  });

  for (const block of layout.text_blocks) {
    assert.ok(
      block.estimated_right_px <= 1038,
      `${block.id} exceeds right safe bound at ${block.estimated_right_px}`,
    );
    assert.ok(
      block.estimated_bottom_px <= 1828,
      `${block.id} exceeds bottom safe bound at ${block.estimated_bottom_px}`,
    );
  }

  const headline = layout.text_blocks.find((block) => block.id === "headline_card");
  assert.deepEqual(headline.lines, ["POKEMON GO MEGA", "MEWTWO IS"]);
  assert.ok(headline.font_size_px <= 58);
  assert.ok(headline.lines.length >= 2);
});

test("Studio V4 overlay chain avoids duplicate story cards over owned generated motion decks", () => {
  const chain = buildOverlayChain({
    story: {
      canonical_subject: "Pokemon Go",
      primary_source: "Eurogamer",
      first_frame_text: "POKEMON GO MEGA MEWTWO IS",
      thumbnail_headline: "POKEMON GO MEGA MEWTWO IS",
      proof_card_primary: "MEWTWO ROUTE",
      proof_card_secondary: "FREE GO FEST",
      visual_v4_bridge_video_clips: Array.from({ length: 6 }, (_, index) => ({
        path: `output/generated-motion/rss_ca673f22ddbbbdfc/${String(index + 1).padStart(2, "0")}_card.mp4`,
        source_type: "internally_generated_motion_graphic",
      })),
    },
    inputLabel: "base",
    outputLabel: "overlayBase",
    durationS: 24,
    fontOpt: "font='Arial'",
  });

  assert.match(chain, /PULSE \/\/ NEWSWIRE/);
  assert.match(chain, /SOURCE LOCK/);
  assert.doesNotMatch(chain, /MEWTWO IS/);
  assert.doesNotMatch(chain, /PROOF BEAT|PLAYER READ/);
  assert.doesNotMatch(chain, /x=50:y=248:w=980/);
  assert.doesNotMatch(chain, /x=64:y=520:w=956/);
});
