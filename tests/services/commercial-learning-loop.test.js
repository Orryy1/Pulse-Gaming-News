"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const packageJson = require("../../package.json");

const {
  buildAffiliateLinkManifest,
  writeAffiliateLinkManifest,
} = require("../../lib/commercial-intelligence-engine");
const {
  buildCommercialLearningDigest,
  readCommercialClickLog,
  renderCommercialLearningMarkdown,
  runCommercialLearningLoop,
} = require("../../lib/intelligence/commercial-learning-loop");

test("commercial learning ingests privacy-safe click logs and skips broken rows", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-log-"));
  const logPath = path.join(tmp, "commercial_clicks.jsonl");
  await fs.writeFile(
    logPath,
    [
      JSON.stringify({
        event_type: "commercial_click",
        timestamp: "2026-05-19T10:00:00.000Z",
        story_id: "forza",
        offer_id: "racing-wheel",
        platform: "youtube",
        cta_variant: "story_page",
        user_agent_hash: "1234567890abcdef",
      }),
      "{bad json",
      JSON.stringify({
        event_type: "not_commercial_click",
        story_id: "ignored",
      }),
      "",
    ].join("\n"),
  );

  const result = await readCommercialClickLog(logPath);

  assert.equal(result.entries.length, 1);
  assert.equal(result.invalid_lines, 1);
  assert.equal(result.entries[0].story_id, "forza");
  assert.equal(Object.prototype.hasOwnProperty.call(result.entries[0], "ip"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.entries[0], "userAgent"), false);
});

test("commercial learning builds story, offer, platform and CTA recommendations", () => {
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "forza-commercial",
      title: "Forza Horizon 6 Steam Numbers Skyrocket",
      full_script: "Forza players are comparing racing wheel and Xbox controller setups.",
      youtube_post_id: "yt_forza",
    },
    tag: "pulsegaming-21",
    generatedAt: "2026-05-19T09:00:00.000Z",
  });
  const primary = manifest.primary_link;
  const clicks = [
    click("forza-commercial", primary.id, "youtube", "story_page"),
    click("forza-commercial", primary.id, "youtube", "story_page"),
    click("forza-commercial", primary.id, "tiktok", "story_page"),
  ];

  const digest = buildCommercialLearningDigest({
    generatedAt: "2026-05-19T10:00:00.000Z",
    clicks,
    manifests: [manifest],
    stories: [
      {
        id: "forza-commercial",
        title: "Forza Horizon 6 Steam Numbers Skyrocket",
        youtube_post_id: "yt_forza",
        youtube_views: 1200,
      },
    ],
  });

  assert.equal(digest.status, "commercial_learning_active");
  assert.equal(digest.totals.clicks, 3);
  assert.equal(digest.top_stories[0].story_id, "forza-commercial");
  assert.equal(digest.top_stories[0].affiliate_click_rate, 0.0025);
  assert.equal(digest.top_stories[0].commercial_angle_lift, "positive");
  assert.equal(digest.offer_breakdown[0].offer_id, primary.id);
  assert.equal(digest.platform_breakdown.youtube.clicks, 2);
  assert.equal(digest.cta_breakdown.story_page.clicks, 3);
  assert.ok(digest.recommendations.some((item) => item.type === "double_down_offer_fit"));
  assert.ok(digest.next_render_adjustments.some((item) => item.story_id === "forza-commercial"));
  assert.equal(digest.safety.raw_user_agents_stored, false);
});

test("commercial learning stays conservative when there are no clicks", () => {
  const digest = buildCommercialLearningDigest({
    generatedAt: "2026-05-19T10:00:00.000Z",
    clicks: [],
    manifests: [],
    stories: [],
  });

  assert.equal(digest.status, "waiting_for_click_data");
  assert.ok(digest.blockers.includes("no_commercial_clicks_recorded"));
  assert.match(renderCommercialLearningMarkdown(digest), /No commercial clicks recorded yet/);
});

test("commercial learning loop writes JSON and Markdown reports", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-learning-"));
  const manifestDir = path.join(tmp, "commercial");
  const outputDir = path.join(tmp, "learning");
  const clickLogPath = path.join(tmp, "commercial_clicks.jsonl");
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "steam-deck-oled",
      title: "Steam Deck OLED deal gets a useful storage catch",
      full_script: "Steam Deck OLED storage and microSD choices are the practical part.",
    },
    tag: "pulsegaming-21",
    generatedAt: "2026-05-19T09:00:00.000Z",
  });
  await writeAffiliateLinkManifest(manifest, { outputDir: manifestDir });
  await fs.writeFile(
    clickLogPath,
    `${JSON.stringify(click("steam-deck-oled", manifest.primary_link.id, "youtube", "story_page"))}\n`,
  );

  const result = await runCommercialLearningLoop({
    generatedAt: "2026-05-19T10:00:00.000Z",
    clickLogPath,
    manifestDirs: [manifestDir],
    outputDir,
    stories: [{ id: "steam-deck-oled", title: "Steam Deck OLED deal", youtube_views: 400 }],
  });

  assert.equal(result.digest.totals.clicks, 1);
  assert.equal(path.basename(result.artefacts.jsonPath), "commercial-learning.json");
  assert.equal(path.basename(result.artefacts.mdPath), "commercial-learning.md");
  assert.match(await fs.readFile(result.artefacts.mdPath, "utf8"), /Commercial Learning Loop/);
});

test("commercial learning is registered for operators and dashboard API", async () => {
  const serverSource = await fs.readFile(path.join(__dirname, "..", "..", "server.js"), "utf8");
  const analyticsSource = await fs.readFile(
    path.join(__dirname, "..", "..", "src", "pages", "Analytics.tsx"),
    "utf8",
  );

  assert.equal(
    packageJson.scripts["ops:commercial-learning"],
    "node tools/commercial-learning-loop.js",
  );
  assert.match(serverSource, /app\.get\(\s*["']\/api\/commercial\/learning["']/);
  assert.match(analyticsSource, /\/api\/commercial\/learning/);
  assert.match(analyticsSource, /Commercial Learning/);
});

function click(storyId, offerId, platform, ctaVariant) {
  return {
    event_type: "commercial_click",
    timestamp: "2026-05-19T10:00:00.000Z",
    story_id: storyId,
    offer_id: offerId,
    platform,
    cta_variant: ctaVariant,
    video_id: "yt_forza",
    referrer_host: "pulse.orryy.com",
    user_agent_hash: "1234567890abcdef",
  };
}
