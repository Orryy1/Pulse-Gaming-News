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

const FLASH_READY_SCRIPT = [
  "Take-Two just made the weirdest legacy franchise call of the week.",
  "The company says it passed on a sequel to one of its legacy franchises because the pitch was not strong enough.",
  "That matters because Take-Two owns names that still make gaming audiences stop scrolling: GTA, Red Dead, BioShock, Mafia and Borderlands.",
  "This is not a release-date reveal and it is not confirmation of a cancelled project.",
  "It is a rare look at how the publisher decides what gets revived and what stays buried.",
  "The interesting bit is the standard.",
  "Take-Two is saying nostalgia alone is not enough.",
  "If a sequel cannot clear the creative bar, even a famous logo does not save it.",
  "That makes the mystery bigger, not smaller.",
  "Was it BioShock, Midnight Club, Bully, Max Payne or something else entirely?",
  "For players, the real takeaway is brutal.",
  "A beloved franchise can still lose internally if the pitch feels average.",
  "Follow Pulse Gaming so you never miss a beat.",
].join(" ");

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

test("Creator Studio OS assigns premium Shorts to the Pulse Flash Lane", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "flash-lane",
      title: "GTA 6 Owner Passed On A Sequel To A Legacy Franchise",
      hook: "Take-Two just made the weirdest legacy franchise call of the week.",
      full_script: FLASH_READY_SCRIPT,
    }),
  );

  assert.equal(packet.format_lane_policy.lane_id, "pulse_flash_short");
  assert.equal(packet.flash_lane_contract.lane_id, "pulse_flash_short");
  assert.equal(packet.flash_lane_contract.next_action, "generate_approved_flash_lane_voice");
  assert.equal(packet.flash_lane_contract.script.spoken_outro_required, true);
  assert.equal(packet.format_lane_policy.runtime_target_seconds.min, 61);
  assert.equal(packet.format_lane_policy.runtime_target_seconds.max, 75);
  assert.equal(packet.format_lane_policy.caption_rules.max_words_per_punch, 3);
  assert.equal(packet.format_lane_policy.render_rules.clip_dominance_target, 0.55);
  assert.ok(packet.format_lane_policy.qa_gates.includes("approved_voice_required"));
  assert.ok(packet.format_lane_policy.render_rules.visual_backbone.includes("game_footage"));
});

test("Creator Studio OS assigns release radar stories to the Pulse Briefing Lane", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "briefing-lane",
      title: "Subnautica 2 release date officially confirmed for PC and Xbox",
      hook: "Subnautica 2 finally has a confirmed release window.",
      body: "The official update confirms the release date detail for PC and Xbox players.",
      full_script:
        "Subnautica 2 finally has a confirmed release window. The official update confirms the release date detail for PC and Xbox players.",
      flair: "Confirmed",
      release_date: "2026-06-01",
    }),
  );

  assert.equal(packet.format_route.verdict, "monthly_release_radar_item");
  assert.equal(packet.format_lane_policy.lane_id, "pulse_briefing_longform");
  assert.equal(packet.format_lane_policy.runtime_target_seconds.min, 360);
  assert.equal(packet.format_lane_policy.runtime_target_seconds.max, 900);
  assert.ok(packet.format_lane_policy.script_rules.includes("source_timeline"));
  assert.ok(packet.format_lane_policy.render_rules.required_elements.includes("chapter_cards"));
});

test("Creator Studio OS keeps the shared intelligence layer under both lanes", () => {
  const flash = buildProductionPacket(baseStory({ id: "shared-flash" }));
  const briefing = buildProductionPacket(
    baseStory({
      id: "shared-briefing",
      title: "Subnautica 2 release date officially confirmed for PC and Xbox",
      flair: "Confirmed",
      release_date: "2026-06-01",
    }),
  );

  assert.equal(flash.format_lane_policy.shared_intelligence.source_pack, "fact_check_report");
  assert.equal(briefing.format_lane_policy.shared_intelligence.source_pack, "fact_check_report");
  assert.equal(flash.format_lane_policy.shared_intelligence.media_inventory, "media_inventory");
  assert.equal(briefing.format_lane_policy.shared_intelligence.media_inventory, "media_inventory");
  assert.notEqual(flash.format_lane_policy.lane_id, briefing.format_lane_policy.lane_id);
});

test("Creator Studio OS does not mark thin Flash Lane media as green", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "thin-flash-lane",
      downloaded_images: [
        img("steam_capsule", "steam", "single.jpg"),
        img("screenshot", "steam", "two.jpg"),
        img("screenshot", "steam", "three.jpg"),
      ],
      video_clips: [],
      thumbnail_candidate_path: "test/output/thin-thumb.jpg",
    }),
  );

  assert.equal(packet.format_lane_policy.lane_id, "pulse_flash_short");
  assert.notEqual(packet.format_lane_policy.readiness_colour, "GREEN");
  assert.ok(packet.format_lane_policy.warnings.includes("flash_lane_needs_more_exact_subject_visuals"));
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
  assert.equal(packet.controlled_frame_plan.target_frames.length, 12);
  assert.equal(
    packet.controlled_frame_plan.exact_subject_motion_coverage.sampling_strategy,
    "interleaved_non_intro_multi_probe_v3",
  );
  assert.equal(packet.controlled_frame_plan.will_download, false);
});

test("Creator Studio OS emits valid JSON and readable Markdown", () => {
  const controlRoom = buildCreatorStudioControlRoom([
    baseStory({
      id: "green",
      title: "GTA 6 Owner Passed On A Sequel To A Legacy Franchise",
      hook: "Take-Two just made the weirdest legacy franchise call of the week.",
      full_script: FLASH_READY_SCRIPT,
    }),
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
  assert.match(markdown, /lane/);
  assert.match(markdown, /pulse_flash_short/);
  assert.match(markdown, /generate_approved_flash_lane_voice/);
  assert.match(markdown, /motion/);
  assert.match(markdown, /frames/);
  assert.match(markdown, /green/);
  assert.match(markdown, /AMBER/);
  assert.match(markdown, /RED/);
});
