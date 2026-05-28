"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildEpidemicSoundIntakeReport,
  classifyMusicRole,
  defaultDownloadPlan,
} = require("../../lib/epidemic-sound-intake");

async function touchAudio(filePath) {
  await fs.outputFile(filePath, Buffer.alloc(32, 3));
}

test("Epidemic intake builds rights-backed music, SFX and pack candidates from retained local files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-intake-"));
  const epidemicRoot = path.join(root, "audio", "epidemic");
  const files = [
    path.join(epidemicRoot, "music", "bed_primary", "Pulse Gaming Main News Bed.wav"),
    path.join(epidemicRoot, "music", "bed_breaking", "Pulse Gaming Breaking Urgent Bed.wav"),
    path.join(epidemicRoot, "stings", "sting_verified", "Verified Source Lock Sting.wav"),
    path.join(epidemicRoot, "stings", "sting_rumour", "Rumour Watch Sting.wav"),
    path.join(epidemicRoot, "stings", "sting_breaking", "Breaking Hit Sting.wav"),
    path.join(epidemicRoot, "sfx", "Cinematic Impact Hit.wav"),
    path.join(epidemicRoot, "sfx", "Editorial Fast Whoosh Transition.wav"),
    path.join(epidemicRoot, "sfx", "UI Tick Click.wav"),
    path.join(epidemicRoot, "sfx", "Tension Riser.wav"),
    path.join(epidemicRoot, "sfx", "Sub Boom.wav"),
    path.join(epidemicRoot, "sfx", "Digital Glitch Static.wav"),
  ];
  for (const file of files) await touchAudio(file);

  const report = buildEpidemicSoundIntakeReport({
    workspaceRoot: root,
    root: epidemicRoot,
    generatedAt: "2026-05-26T17:00:00.000Z",
    safelistEvidence: "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
  });

  assert.equal(report.readiness.status, "pass");
  assert.deepEqual(report.readiness.blockers, []);
  assert.equal(report.summary.music_assets, 5);
  assert.equal(report.summary.sfx_assets, 6);
  assert.ok(report.music_inventory.every((asset) => asset.provider_id === "epidemic_sound"));
  assert.ok(report.sfx_source_plan.selected_assets.some((asset) => asset.provider_id === "epidemic_sound"));
  assert.ok(report.rights_ledger.records.every((record) => record.licence_basis.includes("epidemic_sound")));
  assert.ok(report.audio_pack_candidates.some((pack) => pack.channel_id === "pulse-gaming"));
  const pulsePack = report.audio_pack_candidates.find((pack) => pack.channel_id === "pulse-gaming");
  assert.deepEqual(
    pulsePack.assets.map((asset) => asset.role).sort(),
    ["bed_breaking", "bed_primary", "sting_breaking", "sting_rumour", "sting_verified"],
  );
  assert.equal(report.safety.no_downloads_started, true);
  assert.equal(report.safety.no_posting, true);
});

test("Epidemic intake blocks use when no safelisting evidence is retained", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-no-evidence-"));
  const epidemicRoot = path.join(root, "audio", "epidemic");
  await touchAudio(path.join(epidemicRoot, "music", "bed_primary", "Main News Bed.wav"));

  const report = buildEpidemicSoundIntakeReport({
    workspaceRoot: root,
    root: epidemicRoot,
    generatedAt: "2026-05-26T17:01:00.000Z",
  });

  assert.equal(report.readiness.status, "blocked");
  assert.ok(report.readiness.blockers.includes("epidemic:safelist_evidence_missing"));
  assert.equal(report.rights_ledger.records[0].safelist_evidence, null);
});

test("Epidemic intake blocks partial safelist evidence with a required platform blocker", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-partial-evidence-"));
  const epidemicRoot = path.join(root, "audio", "epidemic");
  const files = [
    path.join(epidemicRoot, "music", "bed_primary", "Pulse Gaming Main News Bed.wav"),
    path.join(epidemicRoot, "music", "bed_breaking", "Pulse Gaming Breaking Urgent Bed.wav"),
    path.join(epidemicRoot, "stings", "sting_verified", "Verified Source Lock Sting.wav"),
    path.join(epidemicRoot, "stings", "sting_rumour", "Rumour Watch Sting.wav"),
    path.join(epidemicRoot, "stings", "sting_breaking", "Breaking Hit Sting.wav"),
    path.join(epidemicRoot, "sfx", "Cinematic Impact Hit.wav"),
    path.join(epidemicRoot, "sfx", "Editorial Fast Whoosh Transition.wav"),
    path.join(epidemicRoot, "sfx", "UI Tick Click.wav"),
    path.join(epidemicRoot, "sfx", "Tension Riser.wav"),
    path.join(epidemicRoot, "sfx", "Sub Boom.wav"),
    path.join(epidemicRoot, "sfx", "Digital Glitch Static.wav"),
  ];
  for (const file of files) await touchAudio(file);
  const evidencePath = path.join(root, "proof", "epidemic_safelist_evidence.json");
  await fs.outputJson(evidencePath, {
    safelisted_platforms: [
      { channel_id: "pulse-gaming", platform: "tiktok", status: "safelisted" },
      { channel_id: "pulse-gaming", platform: "facebook", status: "safelisted" },
      { channel_id: "pulse-gaming", platform: "instagram", status: "safelisted" },
    ],
    not_safelisted_platforms: [
      {
        channel_id: "pulse-gaming",
        platform: "youtube",
        status: "blocked",
        blocker: "epidemic_youtube_google_account_link_required",
      },
    ],
  });

  const report = buildEpidemicSoundIntakeReport({
    workspaceRoot: root,
    root: epidemicRoot,
    generatedAt: "2026-05-26T17:01:30.000Z",
    safelistEvidence: evidencePath,
  });

  assert.equal(report.readiness.status, "blocked");
  assert.ok(report.readiness.blockers.includes("epidemic:safelist_platform_blocked:youtube"));
  assert.equal(report.summary.safelisted_platforms, 3);
  assert.equal(report.summary.safelist_blocked_platforms, 1);
  assert.equal(report.safelist_evidence_report.blocked_platforms[0].platform, "youtube");
  assert.ok(report.music_inventory.every((asset) => asset.approval_status === "blocked_until_required_platforms_safelisted"));
});

test("Epidemic intake blocks when the local subscription pack has not been downloaded", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-empty-"));
  const report = buildEpidemicSoundIntakeReport({
    workspaceRoot: root,
    root: path.join(root, "audio", "epidemic"),
    generatedAt: "2026-05-26T17:02:00.000Z",
    safelistEvidence: "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
  });

  assert.equal(report.readiness.status, "blocked");
  assert.ok(report.readiness.blockers.includes("epidemic:no_local_audio_assets"));
  assert.ok(report.readiness.blockers.includes("epidemic:missing_music_role:bed_primary"));
  assert.ok(report.readiness.blockers.includes("sfx_source:no_creator_studio_sfx_assets"));
});

test("Epidemic music role classification supports beds, stings and stems", () => {
  assert.equal(classifyMusicRole("audio/epidemic/music/breaking/urgent full mix.wav"), "bed_breaking");
  assert.equal(classifyMusicRole("audio/epidemic/stings/rumour-watch-hit.wav"), "sting_rumour");
  assert.equal(
    classifyMusicRole(
      "audio/epidemic/stings/sting_verified/epidemic_sting_verified_03_user-interface-alert-notification-confirm.mp3",
    ),
    "sting_verified",
  );
  assert.equal(classifyMusicRole("audio/epidemic/stems/main-news-drums.wav"), "stem");
  assert.equal(classifyMusicRole("audio/epidemic/music/main-news-loop.wav"), "bed_primary");

  const plan = defaultDownloadPlan();
  assert.ok(plan.channels.some((channel) => channel.channel_id === "pulse-gaming"));
  const primaryBed = plan.required_slots.find((slot) => slot.role === "bed_primary");
  const transition = plan.required_slots.find((slot) => slot.role === "transition");
  assert.equal(primaryBed.asset_category, "music");
  assert.match(primaryBed.search_url, /epidemicsound\.com\/music\//);
  assert.equal(primaryBed.recommended_filename_prefix, "epidemic_bed_primary_");
  assert.equal(transition.asset_category, "sfx");
  assert.match(transition.search_url, /epidemicsound\.com\/sound-effects\//);
  assert.equal(transition.recommended_filename_prefix, "epidemic_transition_");
  assert.equal(plan.variant_strategy.mode, "unbounded_role_variants");
  assert.ok(plan.variant_targets.find((target) => target.role === "bed_primary").target_variants >= 6);
  assert.ok(plan.variant_targets.find((target) => target.role === "transition").target_variants >= 4);
  assert.ok(plan.expansion_slots.length >= 30);
  assert.ok(plan.expansion_slots.every((slot) => slot.local_target_path.startsWith("audio/epidemic/")));
});
