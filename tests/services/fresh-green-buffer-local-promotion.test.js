"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildFreshGreenBufferLocalPromotionReport,
  writeFreshGreenBufferLocalPromotionArtifacts,
} = require("../../lib/fresh-green-buffer-local-promotion");
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
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "canonical_story_manifest.json")));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "render_readiness_work_order.json")));

  const canonical = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "canonical_story_manifest.json"),
      "utf8",
    ),
  );
  assert.equal(canonical.public_title, "Halo: Campaign Evolved Shows The Real Remake Test");
  assert.match(canonical.description, /Xbox Wire says Halo: Campaign Evolved/);
  assert.equal(canonical.public_copy.title, "Halo: Campaign Evolved Shows The Real Remake Test");

  const storyPackages = JSON.parse(fs.readFileSync(written.storyPackages, "utf8"));
  assert.equal(storyPackages[0].verdict, "ready");
  assert.equal(storyPackages[0].status, "ready_for_render_proof");
  assert.match(storyPackages[0].description, /Xbox Wire says Halo: Campaign Evolved/);
  assert.deepEqual(storyPackages[0].blockers, []);
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
