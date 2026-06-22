"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildCanonicalStoryManifest,
  buildFreshGreenBufferLocalPromotionReport,
  writeFreshGreenBufferLocalPromotionArtifacts,
} = require("../../lib/fresh-green-buffer-local-promotion");
const mediaHousePrivate = require("../../lib/pulse-media-house-score")._private;
const { parseArgs } = require("../../tools/fresh-green-buffer-local-promotion");
const packageJson = require("../../package.json");

function draftStory(overrides = {}) {
  return {
    id: "fresh_xbox_halo_campaign_evolved_demo_20260610",
    title: "Halo: Campaign Evolved Shows The Real Remake Test",
    canonical_subject: "Halo: Campaign Evolved",
    canonical_game: "Halo: Campaign Evolved",
    primary_source: {
      name: "Xbox Wire",
      url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
      type: "official_platform_news",
    },
    primary_source_url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
    source_published_at: "2026-06-10T00:00:00.000Z",
    confirmed_claims: [
      "Xbox Wire says Halo: Campaign Evolved showed Assault on the Control Room in hands-on demo form.",
    ],
    unconfirmed_claims: [],
    thumbnail_headline: "HALO'S REAL TEST",
    narration_script:
      "Halo: Campaign Evolved just put the remake debate where it belongs. Xbox Wire says Halo Studios showed Assault on the Control Room in hands-on form. Follow Pulse Gaming so you never miss a beat.",
    ...overrides,
  };
}

test("fresh buffer promotion writes local package work orders without publish or DB side effects", async () => {
  const generatedAt = "2026-06-12T08:00:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [draftStory()],
    generatedAt,
  });

  assert.equal(report.mode, "LOCAL_ONLY_FRESH_GREEN_BUFFER_PROMOTION");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.local_package_count, 1);
  assert.equal(report.summary.scheduler_green_count, 0);
  assert.equal(report.summary.production_db_mutation_required, false);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.candidates[0].story_id, "fresh_xbox_halo_campaign_evolved_demo_20260610");
  assert.equal(report.candidates[0].freshness_gate, "pass");
  assert.deepEqual(report.candidates[0].blocking_lanes, [
    "audio_timestamps",
    "official_direct_motion",
    "visual_v4_final_render",
    "scheduler_bridge_promotion",
    "strict_dry_run",
  ]);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-promotion-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });

  assert.ok(fs.existsSync(written.reportJson));
  assert.ok(fs.existsSync(written.reportMd));
  assert.ok(fs.existsSync(written.renderInputWorkOrder));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "canonical_story_manifest.json")));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "rights_ledger.json")));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "footage_inventory.json")));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "render_readiness_work_order.json")));

  const canonical = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "canonical_story_manifest.json"),
      "utf8",
    ),
  );
  assert.equal(canonical.public_title, "Halo: Campaign Evolved Shows The Real Remake Test");
  assert.match(canonical.description, /Halo: Campaign Evolved has a public demo test/i);
  assert.match(canonical.description, /Source: Xbox Wire\./);
  assert.equal(canonical.public_copy.title, "Halo: Campaign Evolved Shows The Real Remake Test");

  const rightsLedger = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "rights_ledger.json"),
      "utf8",
    ),
  );
  assert.equal(rightsLedger.verdict, "fail");
  assert.deepEqual(rightsLedger.failures, ["rights:no_rights_record"]);
  assert.deepEqual(rightsLedger.records, []);
  assert.equal(rightsLedger.direct_media_validated, false);
  assert.equal(rightsLedger.reference_only_sources[0].url, draftStory().primary_source_url);
  assert.equal(rightsLedger.safety.no_publish_triggered, true);

  const footageInventory = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "footage_inventory.json"),
      "utf8",
    ),
  );
  assert.equal(footageInventory.readiness.status, "v4_motion_blocked");
  assert.deepEqual(footageInventory.motion_inventory.accepted_local_clips, []);
  assert.equal(footageInventory.motion_budget.available_motion_clips, 0);
  assert.equal(footageInventory.direct_media_validated, false);
  assert.equal(footageInventory.safety.no_publish_triggered, true);

  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  assert.equal(storyPackages[0].verdict, "local_proof_pending");
  assert.equal(storyPackages[0].status, "needs_media_house_render_proof");
  assert.equal(storyPackages[0].publishable, false);
  assert.equal(storyPackages[0].scheduler_green, false);
  assert.equal(storyPackages[0].counted_as_green, false);
  assert.ok(storyPackages[0].blockers.includes("missing_media_house_quality_gate_pass"));
  assert.ok(storyPackages[0].blockers.includes("missing_visual_v4_final_render"));
  assert.match(storyPackages[0].description, /Halo: Campaign Evolved has a public demo test/i);
  assert.ok(storyPackages[0].blockers.includes("not_scheduler_green"));
  assert.ok(storyPackages[0].blockers.includes("missing_scheduler_preflight_pass"));

  const renderInputWorkOrder = JSON.parse(fs.readFileSync(written.renderInputWorkOrder, "utf8"));
  assert.equal(renderInputWorkOrder.mode, "LOCAL_RENDER_INPUT_WORK_ORDER");
  assert.equal(renderInputWorkOrder.summary.story_count, 1);
  assert.equal(renderInputWorkOrder.summary.ready_for_final_render_job_count, 0);
  assert.equal(renderInputWorkOrder.summary.blocked_on_render_inputs_count, 1);
  assert.equal(renderInputWorkOrder.summary.audio_timestamp_jobs, 1);
  assert.equal(renderInputWorkOrder.summary.real_motion_materialisation_jobs, 1);
  assert.equal(renderInputWorkOrder.summary.final_mp4_repair_jobs, 1);
  assert.equal(renderInputWorkOrder.summary.caption_repair_jobs, 1);
  assert.equal(renderInputWorkOrder.jobs[0].status, "blocked_on_render_inputs");
  assert.equal(renderInputWorkOrder.jobs[0].artifact_dir, storyPackages[0].artifact_dir);
  assert.deepEqual(
    renderInputWorkOrder.jobs[0].actions.map((action) => action.action_id),
    [
      "generate_final_narration_audio_and_word_timestamps",
      "materialise_validated_real_motion_clips",
      "materialise_final_mp4",
      "generate_caption_file",
      "repair_render_manifest",
      "repair_audio_manifest",
    ],
  );
  assert.equal(renderInputWorkOrder.safety.no_publish_triggered, true);
  assert.equal(renderInputWorkOrder.safety.no_db_mutation, true);
});

test("fresh buffer promotion CLI is registered and defaults to overnight output", () => {
  assert.equal(
    packageJson.scripts["ops:fresh-green-buffer-promote"],
    "node tools/fresh-green-buffer-local-promotion.js",
  );

  const args = parseArgs(["--json", "--generated-at", "2026-06-12T08:00:00.000Z"]);
  assert.equal(args.json, true);
  assert.equal(args.generatedAt, "2026-06-12T08:00:00.000Z");
  assert.match(args.storiesPath, /fresh_source_intake_stories\.json$/);
  assert.match(args.outDir, /overnight-fresh-green-buffer$/);
});

test("fresh buffer promotion compacts headline-style subjects into the named game", async () => {
  const generatedAt = "2026-06-19T04:00:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "rss_gta6_launch_countdown",
        title: "Here's How I Know We Are Entering The GTA 6 Launch Endgame",
        canonical_subject: "Here's How I Know We Are Entering The GTA 6 Launch Endgame",
        canonical_game: "",
        selected_title: "GTA 6 May Finally Be In Launch Countdown Mode",
        primary_source: {
          name: "Kotaku",
          url: "https://kotaku.com/gta-6-launch-endgame-2026",
          type: "trusted_editorial_source",
        },
        primary_source_url: "https://kotaku.com/gta-6-launch-endgame-2026",
        source_published_at: "2026-06-18T12:00:00.000Z",
        confirmed_claims: [
          "Kotaku argues Rockstar is entering the GTA 6 launch endgame as store and marketing signals shift.",
        ],
        thumbnail_headline: "GTA 6 COUNTDOWN",
        narration_script:
          "GTA 6 may finally be shifting from delay fear to launch countdown. Kotaku argues Rockstar is entering the launch endgame as store and marketing signals shift. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-subject-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const packageDir = path.join(outDir, "packages", "rss_gta6_launch_countdown");

  const canonical = JSON.parse(
    fs.readFileSync(path.join(packageDir, "canonical_story_manifest.json"), "utf8"),
  );
  assert.equal(canonical.canonical_subject, "GTA 6");
  assert.equal(canonical.canonical_game, "GTA 6");
  assert.match(canonical.first_spoken_line, /^GTA 6\b/);

  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  assert.equal(storyPackages[0].canonical_subject, "GTA 6");
  assert.equal(storyPackages[0].canonical_game, "GTA 6");
});

test("fresh buffer promotion maps current-news title subjects to source-search entities", async () => {
  const generatedAt = "2026-06-22T06:00:00.000Z";
  const cases = [
    ["rss_black_ops", "Black Ops Classics Face A Price Test", "Black Ops 1 and 2 just turned nostalgia into a price test.", "Call of Duty: Black Ops"],
    ["rss_ocarina", "Ocarina's Remake Pressure", "Ocarina of Time just made Nintendo's remake demand impossible to ignore.", "Ocarina of Time"],
    ["rss_cyberpunk", "Cyberpunk 2077's Trust Debt", "CD Projekt Red is still paying for Cyberpunk 2077's launch.", "Cyberpunk 2077"],
    ["rss_xbox", "Xbox's Strategy Trust Problem", "An original Xbox insider just made the brand problem sound painfully simple.", "Xbox"],
  ];
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: cases.map(([id, title, script]) =>
      draftStory({
        id,
        title,
        selected_title: title,
        canonical_subject: title,
        canonical_game: title,
        narration_script: `${script} Follow Pulse Gaming so you never miss a beat.`,
      }),
    ),
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-current-subjects-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));

  for (const [id, , , expected] of cases) {
    const canonical = JSON.parse(
      fs.readFileSync(path.join(outDir, "packages", id, "canonical_story_manifest.json"), "utf8"),
    );
    assert.equal(canonical.canonical_subject, expected);
    assert.equal(canonical.canonical_game, expected);
    const storyPackage = storyPackages.find((item) => item.story_id === id);
    assert.equal(storyPackage.canonical_subject, expected);
    assert.equal(storyPackage.canonical_game, expected);
  }
});

test("fresh buffer promotion uses selected title over long source headline when multiple games are named", async () => {
  const generatedAt = "2026-06-19T05:00:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "rss_gta5_free_upgrade",
        title:
          "As GTA Online readies for another large update, and GTA 6 approaches, Rockstar offers free upgrades to GTA 5 on PS5 and Xbox Series S/X",
        canonical_subject:
          "As GTA Online readies for another large update, and GTA 6 approaches, Rockstar offers free upgrades to GTA 5 on PS5 and Xbox Series S/X",
        canonical_game:
          "As GTA Online readies for another large update, and GTA 6 approaches, Rockstar offers free upgrades to GTA 5 on PS5 and Xbox Series S/X",
        selected_title: "GTA 5's Free Upgrade Runway",
        primary_source: {
          name: "Eurogamer",
          url: "https://www.eurogamer.net/gta-5-free-ps5-xbox-series-x-s-upgrade",
          type: "trusted_editorial_source",
        },
        primary_source_url: "https://www.eurogamer.net/gta-5-free-ps5-xbox-series-x-s-upgrade",
        source_published_at: "2026-06-18T13:08:06.000Z",
        confirmed_claims: [
          "Eurogamer says Rockstar is giving GTA 5 players on PS4 and Xbox One a free upgrade to PS5 and Xbox Series X/S.",
        ],
        thumbnail_headline: "FREE UPGRADE",
        narration_script:
          "GTA 5 just became Rockstar's current-gen waiting room. Eurogamer reports Rockstar is giving GTA 5 players on PS4 and Xbox One a free upgrade to PS5 and Xbox Series X/S as GTA Online gears up again and GTA 6 approaches. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-mixed-subject-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const canonical = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "rss_gta5_free_upgrade", "canonical_story_manifest.json"),
      "utf8",
    ),
  );
  assert.equal(canonical.canonical_subject, "GTA 5");
  assert.equal(canonical.canonical_game, "GTA 5");
  assert.match(canonical.first_spoken_line, /^GTA 5\b/);

  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  assert.equal(storyPackages[0].canonical_subject, "GTA 5");
  assert.equal(storyPackages[0].canonical_game, "GTA 5");
});

test("fresh buffer promotion rebuilds stale failing narration before packaging", async () => {
  const generatedAt = "2026-06-19T06:45:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "rss_garfield_gameplay",
        title:
          "Garfield - Escape From Monday Gameplay Trailer Teases the Terror of The Curse of the Spinach Lasagna",
        canonical_subject: "Garfield",
        canonical_game: "Garfield",
        selected_title: "Garfield Gameplay Check",
        primary_source: {
          name: "IGN",
          url: "https://www.ign.com/articles/garfield-escape-from-monday-gameplay-trailer",
          type: "trusted_editorial_source",
        },
        primary_source_url: "https://www.ign.com/articles/garfield-escape-from-monday-gameplay-trailer",
        source_published_at: "2026-06-18T12:00:00.000Z",
        confirmed_claims: [
          "IGN reports a Garfield gameplay trailer shows platforming, camera movement and repeated gameplay beats.",
        ],
        narration_script:
          "Garfield just showed real gameplay. For players, repeated play matters more than one perfect trailer a perfect trailer moment. That gives fans something sharper to argue about than whether the licence is famous enough. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-script-repair-"));
  await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const canonical = JSON.parse(
    fs.readFileSync(path.join(outDir, "packages", "rss_garfield_gameplay", "canonical_story_manifest.json"), "utf8"),
  );

  assert.equal(canonical.script_coherence_result, "pass");
  assert.equal(canonical.public_copy_repaired_at, generatedAt);
  assert.match(canonical.public_copy_repair_reason, /repeated_near_phrase|public_narration_meta_language/);
  assert.doesNotMatch(canonical.full_script, /perfect trailer a perfect trailer|something sharper to argue/i);
  assert.match(canonical.full_script, /blunt test is this: does the gameplay stay fun/i);
});

test("fresh buffer promotion rewrites weak coherent demo copy before packaging", async () => {
  const generatedAt = "2026-06-19T08:45:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "rss_granblue_demo",
        title: "Granblue Fantasy: Relink - Endless Ragnarok hands-on report, demo available today",
        selected_title: "Granblue Fantasy Demo Test",
        canonical_subject: "Granblue Fantasy",
        canonical_game: "Granblue Fantasy",
        primary_source: {
          name: "PlayStation Blog",
          url: "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-endless-ragnarok-hands-on-report-demo-available-today/",
          type: "official_platform_news",
        },
        primary_source_url:
          "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-endless-ragnarok-hands-on-report-demo-available-today/",
        source_published_at: "2026-06-18T12:00:08.000Z",
        confirmed_claims: [
          "PlayStation Blog reports Granblue Fantasy: Relink - Endless Ragnarok has a playable demo available today on PS5 and PS4 ahead of launch.",
        ],
        thumbnail_headline: "DEMO TEST",
        narration_script:
          "Granblue Fantasy just gave players the test most previews skip: a demo. PlayStation Blog reports Granblue Fantasy has a hands-on demo beat before launch on PS5 and PS4, giving players a way to judge the expansion early. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-demo-copy-"));
  await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const canonical = JSON.parse(
    fs.readFileSync(path.join(outDir, "packages", "rss_granblue_demo", "canonical_story_manifest.json"), "utf8"),
  );

  assert.equal(canonical.script_coherence_result, "pass");
  assert.equal(canonical.public_copy_repaired_at, generatedAt);
  assert.match(canonical.public_copy_repair_reason, /weak_public_copy_pattern/);
  assert.doesNotMatch(canonical.public_title, /\bDemo Test\b/i);
  assert.doesNotMatch(canonical.full_script, /\bhands-on demo beat\b/i);
  assert.match(canonical.public_title, /Demo/i);
  assert.match(canonical.full_script, /PlayStation Blog/i);
});

test("fresh buffer promotion lightly repairs repeated phrasing without replacing a strong sourced script", () => {
  const canonical = buildCanonicalStoryManifest(
    draftStory({
      id: "rss_ocarina_hidden_switch_2_clue",
      title: "Ocarina's Hidden Switch 2 Clue",
      selected_title: "Ocarina's Hidden Switch 2 Clue",
      canonical_subject: "Ocarina of Time",
      canonical_game: "Ocarina of Time",
      primary_source: {
        name: "IGN",
        url: "https://www.ign.com/articles/nintendo-removes-hidden-the-legend-of-zelda-ocarina-of-time-switch-2-description-that-suggested-its-a-faithful-remake",
        type: "trusted_editorial_source",
      },
      primary_source_url:
        "https://www.ign.com/articles/nintendo-removes-hidden-the-legend-of-zelda-ocarina-of-time-switch-2-description-that-suggested-its-a-faithful-remake",
      confirmed_claims: [
        "IGN reports Nintendo removed a hidden description for Ocarina of Time on Switch 2 that suggested a faithful remake.",
      ],
      narration_script:
        "Ocarina of Time just dropped a new clue Nintendo pulled back. IGN reports Nintendo removed a hidden description for Ocarina of Time on Switch 2 that fans say pointed to a faithful update of the N64 original. That matters because hidden store copy is not marketing fluff once it disappears; fans read the removal as a sign Nintendo was not ready for that promise to be public. The sharper issue is what faithful even means: preserved structure, cleaner visuals or something closer to a remaster. It does not confirm a remake, and removed copy should be treated as cautious evidence rather than a finished announcement. The takeaway is narrow: the wording suggests intent, but Nintendo still has to show what Switch 2 actually changes. The removal changes the player question: did Nintendo pull unfinished store copy, or did it accidentally show the shape of the remake too early? A faithful update sounds simple, but Ocarina fans disagree hard on what should be preserved and what should be modernised. If Nintendo confirms it later, this pulled description becomes the first clue to what kind of Ocarina remake fans are really getting. Follow Pulse Gaming so you never miss a beat.",
    }),
    "2026-06-22T10:45:00.000Z",
  );

  assert.equal(canonical.public_title, "Ocarina's Hidden Switch 2 Clue");
  assert.equal(canonical.script_coherence_result, "pass");
  assert.equal(canonical.script_source, "provided_fresh_story_script_lightly_repaired");
  assert.match(canonical.public_copy_repair_reason, /repeated_near_phrase/);
  assert.match(canonical.full_script, /hidden description for Ocarina of Time on Switch 2/i);
  assert.match(canonical.full_script, /line between preservation and modernisation/i);
  assert.match(canonical.full_script, /pulled listing should be treated as cautious evidence/i);
  assert.doesNotMatch(canonical.full_script, /removed cop(?:y|ies) should be treated/i);
  assert.doesNotMatch(canonical.full_script, /got an update that changes the player decision/i);
  assert.doesNotMatch(canonical.full_script, /Ocarina of Time Player Impact/i);
});

test("fresh buffer promotion packages fresh source claims as attention-led public metadata", async () => {
  const generatedAt = "2026-06-19T20:10:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "fresh_xbox_end_of_abyss_20260619",
        title: "End of Abyss Hands-On Shows The Little Nightmares Team's New Risk",
        canonical_subject: "End of Abyss",
        canonical_game: "End of Abyss",
        selected_title: "End of Abyss Has A Horror Trust Problem",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/19/end-of-abyss-combat-exploration-hands-on/",
          type: "official_platform_news",
        },
        primary_source_url: "https://news.xbox.com/en-us/2026/06/19/end-of-abyss-combat-exploration-hands-on/",
        source_published_at: "2026-06-19T00:00:00.000Z",
        confirmed_claims: [
          "Xbox Wire says End of Abyss is an atmospheric top-down 3D twin-stick shooter Metroidvania from Section 9 Interactive.",
          "Xbox Wire says the studio was co-founded by leads from Tarsier Studios, known for Little Nightmares and Reanimal.",
          "Xbox Wire says End of Abyss comes to Xbox Series X|S on October 1, 2026.",
        ],
        trailer_references: [
          {
            label: "End of Abyss official release date trailer",
            url: "https://www.youtube.com/watch?v=Sytee6i3M9E",
            source_family: "end_of_abyss_official_release_date_trailer",
            source_type: "official_trailer",
          },
        ],
        thumbnail_headline: "HORROR CAMERA RISK",
        narration_script:
          "End of Abyss just gave horror fans a cleaner question than another creepy trailer. Xbox Wire says the top-down Metroidvania comes from Section 9 Interactive, a new studio with former Tarsier leads behind Little Nightmares and Reanimal. That legacy buys attention, not trust. The real test is whether the camera angle can still make players feel trapped, exposed and curious enough to keep pushing deeper. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-attention-metadata-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const canonical = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "fresh_xbox_end_of_abyss_20260619", "canonical_story_manifest.json"),
      "utf8",
    ),
  );
  const platformManifest = {
    outputs: {
      youtube_shorts: {
        title: canonical.public_title,
        description: canonical.description,
        cover_frame: { headline: canonical.thumbnail_headline },
      },
    },
  };

  assert.doesNotMatch(canonical.description, /^Xbox Wire says/i);
  assert.match(canonical.description, /\bhorror trust test\b/i);
  assert.equal(mediaHousePrivate.platformCopyTooPlain(platformManifest), false);
  assert.equal(mediaHousePrivate.platformTitlesTooPlain(platformManifest, canonical), false);
  assert.equal(mediaHousePrivate.weakFirstFrameOrThumbnailCopy(canonical, platformManifest), false);

  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  assert.equal(storyPackages[0].description, canonical.description);
  assert.equal(storyPackages[0].trailer_references[0].source_family, "end_of_abyss_official_release_date_trailer");
});

test("fresh buffer promotion keeps sandbox-control and expansion stories on the correct angle", async () => {
  const generatedAt = "2026-06-19T20:30:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "fresh_sea_custom_seas",
        title: "Sea of Thieves Just Handed Players The Keys",
        canonical_subject: "Sea of Thieves",
        canonical_game: "Sea of Thieves",
        selected_title: "Sea of Thieves Just Handed Players The Keys",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/19/sea-of-thieves-custom-seas-update-details/",
          type: "official_platform_news",
        },
        source_published_at: "2026-06-19T00:00:00.000Z",
        confirmed_claims: [
          "Xbox Wire says Sea of Thieves Season 20 adds Custom Seas, a private sandbox with creative tools and rule controls.",
        ],
        narration_script:
          "Sea of Thieves just changed the argument from content to control. Xbox Wire says Custom Seas lets players set rules around creatures, time of day and weapons. Follow Pulse Gaming so you never miss a beat.",
      }),
      draftStory({
        id: "fresh_dave_jungle",
        title: "Dave the Diver Just Became Bigger Than DLC",
        canonical_subject: "Dave the Diver",
        canonical_game: "Dave the Diver",
        selected_title: "Dave the Diver Just Became Bigger Than DLC",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/18/dave-the-diver-in-the-jungle-out-now/",
          type: "official_platform_news",
        },
        source_published_at: "2026-06-18T00:00:00.000Z",
        confirmed_claims: [
          "Xbox Wire says Dave the Diver: In the Jungle is available now with up to 10 hours of playable content, new wildlife, new ingredients and Bancho Grill.",
        ],
        narration_script:
          "Dave the Diver just released the kind of DLC that starts sounding like a sequel. Xbox Wire says In the Jungle adds up to 10 hours of content. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-angle-metadata-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  const sea = storyPackages.find((row) => row.story_id === "fresh_sea_custom_seas");
  const dave = storyPackages.find((row) => row.story_id === "fresh_dave_jungle");

  assert.match(sea.description, /\b(?:control|sandbox|rules|player-made)\b/i);
  assert.doesNotMatch(sea.description, /More content only matters/i);
  assert.match(dave.description, /\b(?:DLC|expansion|bigger|worth returning|new zone)\b/i);
  assert.doesNotMatch(dave.description, /playable slice|demo test/i);
});

test("fresh buffer promotion prioritises free-access and playable-demo angles over incidental horror or DLC terms", async () => {
  const generatedAt = "2026-06-19T20:45:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [
      draftStory({
        id: "fresh_free_play_days",
        title: "Xbox Free Play Days Has One Weekend Test",
        canonical_subject: "Xbox Free Play Days",
        canonical_game: "Xbox Free Play Days",
        selected_title: "Xbox Free Play Days Has One Weekend Test",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/18/free-play-days-06-18-2026/",
          type: "official_platform_news",
        },
        source_published_at: "2026-06-18T00:00:00.000Z",
        confirmed_claims: [
          "Xbox Wire says Dead by Daylight is free to play for all players, while PGA Tour 2K25, Two Point Museum and Assetto Corsa are available for Xbox Game Pass members during Free Play Days.",
        ],
        narration_script:
          "Xbox Free Play Days has one weekend test. The question is not just what is free, but what earns an install after Sunday. Follow Pulse Gaming so you never miss a beat.",
      }),
      draftStory({
        id: "fresh_granblue_demo",
        title: "Granblue Fantasy Has A Demo Trust Test",
        canonical_subject: "Granblue Fantasy: Relink",
        canonical_game: "Granblue Fantasy: Relink",
        selected_title: "Granblue Fantasy Has A Demo Trust Test",
        primary_source: {
          name: "PlayStation Blog",
          url: "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-endless-ragnarok-hands-on-report-demo-available-today/",
          type: "official_platform_news",
        },
        source_published_at: "2026-06-18T00:00:00.000Z",
        confirmed_claims: [
          "PlayStation Blog says Endless Ragnarok adds new characters and a new story arc, and a playable demo of the main game is available now.",
        ],
        narration_script:
          "Granblue Fantasy has a playable demo now, which gives players a cleaner test than another expansion feature list. Follow Pulse Gaming so you never miss a beat.",
      }),
      draftStory({
        id: "fresh_ubisoft_trial",
        title: "Ubisoft Plus Has A Five-Day Trust Test",
        canonical_subject: "Ubisoft Plus",
        canonical_game: "Ubisoft Plus",
        selected_title: "Ubisoft Plus Has A Five-Day Trust Test",
        primary_source: {
          name: "Ubisoft News",
          url: "https://news.ubisoft.com/en-us/article/7e8YHQ8EGbHe89eOu4ySGy/ubisoft-free-trial-from-june-1823-what-you-need-to-know",
          type: "official_publisher_news",
        },
        source_published_at: "2026-06-18T00:00:00.000Z",
        confirmed_claims: [
          "Ubisoft News says Ubisoft+ Premium has a free trial from June 18 to June 23 with premium editions, DLC and bonus content.",
        ],
        narration_script:
          "Ubisoft Plus just became a five-day value test, because a free trial only works if one game grabs players before renewal. Follow Pulse Gaming so you never miss a beat.",
      }),
    ],
    generatedAt,
  });

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-priority-metadata-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });
  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  const freePlay = storyPackages.find((row) => row.story_id === "fresh_free_play_days");
  const granblue = storyPackages.find((row) => row.story_id === "fresh_granblue_demo");
  const ubisoft = storyPackages.find((row) => row.story_id === "fresh_ubisoft_trial");

  assert.match(freePlay.description, /\b(?:free|weekend|install|after Sunday)\b/i);
  assert.doesNotMatch(freePlay.description, /horror trust test/i);
  assert.match(granblue.description, /\b(?:demo|playable|before launch|trust)\b/i);
  assert.doesNotMatch(granblue.description, /DLC sounds big/i);
  assert.match(ubisoft.description, /\b(?:free trial|five-day|subscription|renewal|value)\b/i);
  assert.doesNotMatch(ubisoft.description, /DLC sounds big/i);
});

test("fresh buffer promotion removes stale package directories before writing current packages", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-stale-packages-"));
  fs.mkdirSync(path.join(outDir, "packages", "stale_story"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "packages", "stale_story", "canonical_story_manifest.json"), "{}", "utf8");

  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [draftStory({ id: "current_story" })],
    generatedAt: "2026-06-19T07:00:00.000Z",
  });

  await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });

  assert.equal(fs.existsSync(path.join(outDir, "packages", "stale_story")), false);
  assert.equal(fs.existsSync(path.join(outDir, "packages", "current_story")), true);
});
