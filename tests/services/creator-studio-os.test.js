"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCreatorStudioControlRoom,
  buildProductionPacket,
  renderCreatorStudioMarkdown,
} = require("../../lib/creator-studio-os");

function img(type, source = "steam", path = `test/${type}.jpg`) {
  return { type, source, path };
}

function trailer(path = "test/trailer.mp4") {
  return { type: "official_trailer", source: "youtube", path, title: "Official trailer" };
}

function baseStory(overrides = {}) {
  return {
    id: "story-1",
    title: "GTA 6 gets a new Xbox showcase update",
    url: "https://example.com/gta-6-xbox",
    source_type: "rss",
    subreddit: "IGN",
    flair: "Verified",
    score: 500,
    timestamp: "2026-05-01T10:00:00Z",
    hook: "GTA 6 just became the biggest Xbox story of the week.",
    body: "Rockstar and Xbox are now the centre of the conversation. MindsEye is part of the comparison because players are watching both open-world launches.",
    loop: "The question is whether Xbox can turn that attention into a real hardware moment.",
    full_script:
      "GTA 6 just became the biggest Xbox story of the week. Rockstar and Xbox are now the centre of the conversation. MindsEye is part of the comparison because players are watching both open-world launches. The question is whether Xbox can turn that attention into a real hardware moment.",
    downloaded_images: [
      img("steam_hero", "steam", "gta-hero.jpg"),
      img("steam_capsule", "steam", "gta-capsule.jpg"),
      img("screenshot", "steam", "gta-screen.jpg"),
      img("screenshot", "steam", "gta-screen-2.jpg"),
      img("key_art", "steam", "gta-key-art.jpg"),
      img("article_hero", "article", "gta-article.jpg"),
    ],
    video_clips: [trailer("gta-trailer.mp4")],
    thumbnail_candidate_path: "test/output/gta-thumb.jpg",
    outro_present: true,
    ...overrides,
  };
}

test("Creator Studio OS rejects off-brand House of the Dragon stories", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "hotd",
      title: "House of the Dragon season 3 adds a major new cast member",
      body: "The HBO series is adding a new actor for the next season.",
      full_script: "The HBO series is adding a new actor for the next season.",
      downloaded_images: [],
      video_clips: [],
    }),
  );

  assert.equal(packet.story_dossier.topicality_verdict, "reject");
  assert.equal(packet.story_dossier.story_type, "off_brand_entertainment");
  assert.equal(packet.format_route.verdict, "reject");
  assert.equal(packet.publish_readiness.verdict, "reject");
  assert.equal(packet.publish_readiness.colour, "RED");
});

test("Creator Studio OS accepts a GTA / Xbox / MindsEye gaming story", () => {
  const packet = buildProductionPacket(baseStory());

  assert.equal(packet.story_dossier.topicality_verdict, "accept");
  assert.ok(packet.story_dossier.entities.includes("GTA"));
  assert.ok(packet.story_dossier.entities.includes("Xbox"));
  assert.ok(packet.story_dossier.entities.includes("MindsEye"));
  assert.notEqual(packet.format_route.verdict, "reject");
  assert.equal(packet.publish_readiness.colour, "GREEN");
});

test("Creator Studio OS sends game adaptation stories to review", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "zelda-movie",
      title: "The Legend of Zelda movie casts its first lead actor",
      body: "Nintendo's game adaptation is moving forward as a film.",
      full_script: "Nintendo's Zelda game adaptation is moving forward as a film.",
      downloaded_images: [img("steam_hero", "official", "zelda.jpg")],
      video_clips: [],
    }),
  );

  assert.equal(packet.story_dossier.topicality_verdict, "review");
  assert.equal(packet.story_dossier.story_type, "game_adaptation");
  assert.equal(packet.publish_readiness.verdict, "review");
  assert.equal(packet.publish_readiness.colour, "AMBER");
});

test("Creator Studio OS routes blog-only inventory away from video", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "blog-only",
      downloaded_images: [],
      video_clips: [],
    }),
  );

  assert.equal(packet.media_inventory.verdict, "blog_only");
  assert.equal(packet.format_route.verdict, "blog_only");
  assert.notEqual(packet.publish_readiness.colour, "GREEN");
});

test("Creator Studio OS keeps thin visuals as AMBER review, not false GREEN", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "thin",
      downloaded_images: [img("steam_capsule", "steam", "single.jpg")],
      video_clips: [],
      thumbnail_candidate_path: null,
    }),
  );

  assert.equal(packet.media_inventory.verdict, "card_only");
  assert.equal(packet.publish_readiness.verdict, "review");
  assert.equal(packet.publish_readiness.colour, "AMBER");
});

test("Creator Studio OS routes premium media inventory to premium_short", () => {
  const packet = buildProductionPacket(baseStory({ id: "premium" }));

  assert.equal(packet.media_inventory.verdict, "premium_ready");
  assert.equal(packet.format_route.verdict, "premium_short");
  assert.equal(packet.render_contract.tiktok_60_second_eligibility, true);
});

test("Creator Studio OS never labels RSS descriptions as Reddit comments", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "rss-comment",
      source_type: "rss",
      top_comment: "This is the RSS description, not a Reddit comment.",
    }),
  );

  assert.equal(packet.comment_overlay.comment_source_type, "rss_description_only");
  assert.equal(packet.comment_overlay.comment_overlay_allowed, false);
});

test("Creator Studio OS allows real Reddit comments only for Reddit stories", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "reddit-comment",
      source_type: "reddit",
      subreddit: "GamingLeaksAndRumours",
      top_comment: "This source has been right before.",
    }),
  );

  assert.equal(packet.comment_overlay.comment_source_type, "real_reddit_comments");
  assert.equal(packet.comment_overlay.comment_overlay_allowed, true);
});

test("Creator Studio OS flags raw HTML entities before public render", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "html",
      title: "Pokemon &amp; Xbox are both in the same showcase",
    }),
  );

  assert.equal(packet.fact_check_report.text_hygiene.severity, "warn");
  assert.ok(packet.fact_check_report.text_hygiene.issues.includes("raw_html_entity"));
});

test("Creator Studio OS reports TikTok API blocked with dispatch pack required", () => {
  const packet = buildProductionPacket(baseStory({ id: "tiktok" }));

  assert.equal(packet.platform_route_plan.tiktok.official_api_status, "blocked");
  assert.equal(packet.platform_route_plan.tiktok.dispatch_pack_required, true);
  assert.equal(packet.platform_route_plan.tiktok.sixty_second_eligibility, true);
});

test("Creator Studio OS includes official motion and frame-plan readiness", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "motion-ready-os",
      video_clips: [],
    }),
    {
      officialTrailerReferencePlans: [
        {
          story_id: "motion-ready-os",
          references: [
            {
              provider: "steam",
              source_type: "steam_movie",
              source_url: "https://video.example/gta.m3u8",
              entity: "GTA",
              downloads_allowed: false,
            },
            {
              provider: "steam",
              source_type: "steam_movie",
              source_url: "https://video.example/red-dead.m3u8",
              entity: "Red Dead",
              downloads_allowed: false,
            },
            {
              provider: "steam",
              source_type: "steam_movie",
              source_url: "https://video.example/bioshock.m3u8",
              entity: "BioShock",
              downloads_allowed: false,
            },
          ],
        },
      ],
    },
  );

  assert.equal(packet.motion_acquisition.motion_readiness, "reference_ready_for_local_frame_plan");
  assert.equal(packet.motion_acquisition.existing_references.length, 3);
  assert.equal(packet.controlled_frame_plan.frame_plan_readiness, "frame_plan_ready");
  assert.equal(packet.controlled_frame_plan.target_frames.length, 6);
  assert.equal(packet.controlled_frame_plan.will_download, false);
});

test("Creator Studio OS emits valid JSON and readable Markdown", () => {
  const controlRoom = buildCreatorStudioControlRoom([
    baseStory({ id: "green" }),
    baseStory({
      id: "amber",
      downloaded_images: [img("steam_capsule", "steam", "single.jpg")],
      video_clips: [],
    }),
    baseStory({
      id: "red",
      title: "House of the Dragon episode guide",
      body: "A TV story with no primary gaming angle.",
      full_script: "A TV story with no primary gaming angle.",
      downloaded_images: [],
      video_clips: [],
    }),
  ]);
  const markdown = renderCreatorStudioMarkdown(controlRoom);

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(controlRoom)));
  assert.match(markdown, /Pulse Creator Studio OS v1/);
  assert.match(markdown, /motion/);
  assert.match(markdown, /frames/);
  assert.match(markdown, /green/);
  assert.match(markdown, /AMBER/);
  assert.match(markdown, /RED/);
});
