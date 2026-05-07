"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAssetAcquisitionControlRoom,
  buildAssetAcquisitionPlan,
  buildVisualDeckMarkdown,
  MEDIA_SOURCE_REGISTRY,
  renderAssetAcquisitionMarkdown,
} = require("../../lib/asset-acquisition-pro");

function img(type, source = "steam", path = `test/${type}.jpg`, extra = {}) {
  return { type, source, path, ...extra };
}

function trailer(path = "test/trailer.mp4") {
  return { type: "official_trailer", source: "youtube", path, title: "Official trailer" };
}

function baseStory(overrides = {}) {
  return {
    id: "story-asset-1",
    title: "GTA 6 gets a new Xbox showcase update",
    url: "https://example.com/gta-6-xbox",
    source_type: "rss",
    subreddit: "IGN",
    flair: "Verified",
    score: 500,
    timestamp: "2026-05-01T10:00:00Z",
    hook: "GTA 6 just became the biggest Xbox story of the week.",
    body: "Rockstar and Xbox are the centre of the conversation.",
    loop: "The question is whether Xbox can turn that attention into a real hardware moment.",
    full_script:
      "GTA 6 just became the biggest Xbox story of the week. Rockstar and Xbox are the centre of the conversation. The question is whether Xbox can turn that attention into a real hardware moment.",
    downloaded_images: [],
    video_clips: [],
    thumbnail_candidate_path: null,
    ...overrides,
  };
}

function taskTypes(plan) {
  return plan.tasks.map((task) => task.type);
}

test("Asset Acquisition Pro refuses off-brand stories without acquisition tasks", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "hotd",
      title: "House of the Dragon season 3 adds a major new cast member",
      body: "The HBO series is adding a new actor for the next season.",
      full_script: "The HBO series is adding a new actor for the next season.",
    }),
  );

  assert.equal(plan.execution_mode, "plan_only");
  assert.equal(plan.will_download, false);
  assert.equal(plan.acquisition_verdict, "reject");
  assert.equal(plan.asset_budget_class, "none");
  assert.deepEqual(plan.tasks, []);
  assert.ok(plan.reasons.includes("off_brand_story"));
});

test("Asset Acquisition Pro plans Steam, trailer and thumbnail work for thin GTA/Xbox stories", () => {
  const plan = buildAssetAcquisitionPlan(baseStory({ id: "thin-gta" }));
  const types = taskTypes(plan);

  assert.equal(plan.execution_mode, "plan_only");
  assert.equal(plan.will_download, false);
  assert.equal(plan.acquisition_verdict, "acquire");
  assert.equal(plan.asset_budget_class, "standard_rescue");
  assert.ok(types.includes("steam_store_search"));
  assert.ok(types.includes("official_trailer_search"));
  assert.ok(types.includes("thumbnail_candidate_build"));
  assert.ok(plan.search_queries.some((query) => /gta/i.test(query)));
  assert.ok(plan.tasks.every((task) => task.will_download === false));
});

test("Asset Acquisition Pro plans frame and clip extraction when a trailer already exists", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "trailer-no-frames",
      video_clips: [trailer("gta-trailer.mp4")],
      downloaded_images: [img("steam_hero", "steam", "gta-hero.jpg")],
    }),
  );
  const types = taskTypes(plan);

  assert.ok(types.includes("trailer_frame_extract"));
  assert.ok(types.includes("clip_slice_extract"));
  assert.equal(types.includes("official_trailer_search"), false);
});

test("Asset Acquisition Pro leaves premium-ready inventory in maintain mode", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "premium-ready",
      downloaded_images: [
        img("steam_hero", "steam", "gta-hero.jpg"),
        img("steam_capsule", "steam", "gta-capsule.jpg"),
        img("screenshot", "steam", "gta-screen-1.jpg"),
        img("screenshot", "steam", "gta-screen-2.jpg"),
        img("key_art", "steam", "gta-key-art.jpg"),
        img("article_hero", "article", "gta-article.jpg"),
      ],
      video_clips: [trailer("gta-trailer.mp4")],
      thumbnail_candidate_path: "test/output/gta-thumb.jpg",
    }),
  );

  assert.equal(plan.acquisition_verdict, "maintain");
  assert.equal(plan.asset_budget_class, "none");
  assert.equal(plan.tasks.filter((task) => task.priority === "high").length, 0);
  assert.equal(plan.creator_studio_after.media_verdict, plan.creator_studio_before.media_verdict);
  assert.equal(plan.creator_studio_after.colour, plan.creator_studio_before.colour);
});

test("Asset Acquisition Pro replaces unsafe human/stock visuals before thumbnail use", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "unsafe-human",
      downloaded_images: [
        img("portrait", "unsplash", "random-person-portrait.jpg", {
          stock: true,
          human: true,
        }),
      ],
    }),
  );
  const types = taskTypes(plan);

  assert.ok(types.includes("replace_unsafe_visuals"));
  assert.equal(plan.thumbnail_plan.allowed_from_existing, false);
  assert.equal(plan.thumbnail_plan.safe_candidate_count, 0);
  assert.equal(types.includes("thumbnail_candidate_build"), true);
});

test("Asset Acquisition Pro emits valid JSON and readable Markdown", () => {
  const report = buildAssetAcquisitionControlRoom([
    baseStory({ id: "thin" }),
    baseStory({
      id: "premium",
      downloaded_images: [
        img("steam_hero", "steam", "premium-hero.jpg"),
        img("steam_capsule", "steam", "premium-capsule.jpg"),
        img("screenshot", "steam", "premium-screen-1.jpg"),
        img("screenshot", "steam", "premium-screen-2.jpg"),
        img("key_art", "steam", "premium-key.jpg"),
      ],
      video_clips: [trailer("premium-trailer.mp4")],
      thumbnail_candidate_path: "test/output/premium-thumb.jpg",
    }),
    baseStory({
      id: "reject",
      title: "House of the Dragon episode guide",
      body: "A TV story with no primary gaming angle.",
      full_script: "A TV story with no primary gaming angle.",
    }),
  ]);
  const markdown = renderAssetAcquisitionMarkdown(report);

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  assert.equal(report.execution_mode, "plan_only");
  assert.equal(report.summary.total_stories, 3);
  assert.match(markdown, /Asset Acquisition Pro/);
  assert.match(markdown, /thin/);
  assert.match(markdown, /premium/);
  assert.match(markdown, /reject/);
});

test("Asset Acquisition Pro v1 exposes a rights-aware media source registry", () => {
  assert.equal(MEDIA_SOURCE_REGISTRY.steam_header.priority > MEDIA_SOURCE_REGISTRY.article_hero.priority, true);
  assert.equal(MEDIA_SOURCE_REGISTRY.generated_brand_card.rights_risk_class, "owned");
  assert.equal(MEDIA_SOURCE_REGISTRY.stock_filler.allowed_render_use, "last_resort_only");
  assert.equal(MEDIA_SOURCE_REGISTRY.unsafe.thumbnail_eligible, false);
  assert.equal(MEDIA_SOURCE_REGISTRY.steam_trailer.supports_premium_video, true);
});

test("Asset Acquisition Pro v1 extracts multiple entities from publisher/franchise scripts", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "publisher-franchise",
      title: "Take-Two passed on a sequel to a legacy franchise",
      body: "Fans are comparing the mystery sequel with GTA, Red Dead and BioShock while Rockstar focuses on GTA 6.",
      full_script:
        "Take-Two passed on a sequel to a legacy franchise. Fans are comparing the mystery sequel with GTA, Red Dead and BioShock while Rockstar focuses on GTA 6.",
      company_name: "Take-Two",
    }),
  );

  assert.ok(plan.entity_map.games.includes("GTA"));
  assert.ok(plan.entity_map.franchises.includes("Red Dead"));
  assert.ok(plan.entity_map.franchises.includes("BioShock"));
  assert.ok(plan.entity_map.publishers.includes("Take-Two"));
});

test("Asset Acquisition Pro keeps Pokemon entities encoding-clean for public reports", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "pokemon-assets",
      title: "Pok\u00c3\u00a9mon Go event gets confirmed for everyone",
      hook: "Pokemon Go just got a confirmed event update.",
      body: "Pokemon Go players now have a concrete event date.",
      full_script: "Pok\u00c3\u00a9mon Go players now have a concrete event date.",
    }),
  );

  assert.ok(plan.entity_map.games.includes("Pok\u00e9mon"));
  assert.ok(!plan.entity_map.games.includes("Pokemon"));
  assert.ok(plan.search_queries.some((query) => query.includes("Pok\u00e9mon")));
  assert.doesNotMatch(JSON.stringify(plan.entity_map), /Pok\u00c3|&amp;/);
});

test("Asset Acquisition Pro treats headline-leading game titles as game entities before platform context", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "marathon-platform-rankings",
      title:
        "Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists",
      hook: "Marathon has fallen hard on Steam.",
      body: "The Bungie extraction shooter is struggling across Steam, PlayStation and Xbox.",
      full_script:
        "Marathon has fallen hard on Steam. The Bungie extraction shooter is struggling across Steam, PlayStation and Xbox.",
    }),
  );

  assert.ok(plan.entity_map.games.includes("Marathon"));
  assert.deepEqual(
    ["Steam", "PlayStation", "Xbox"].every((platform) => plan.entity_map.platforms.includes(platform)),
    true,
  );
  assert.equal(plan.entity_map.primary, "Marathon");
  assert.equal(plan.search_queries[0], "Marathon");
});

test("Asset Acquisition Pro v1 scores Steam and IGDB assets above article and generated cards", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "scored-assets",
      downloaded_images: [
        img("article_hero", "article", "article.jpg"),
        img("generated_brand_card", "generated", "brand-card.png"),
      ],
      game_images: [
        img("steam_header", "steam", "steam-header.jpg", { entity: "GTA" }),
        img("igdb_cover", "igdb", "igdb-cover.jpg", { entity: "GTA" }),
      ],
    }),
  );
  const byPath = Object.fromEntries(plan.candidates.map((candidate) => [candidate.local_path, candidate]));

  assert.equal(byPath["steam-header.jpg"].score.total > byPath["article.jpg"].score.total, true);
  assert.equal(byPath["igdb-cover.jpg"].score.total > byPath["brand-card.png"].score.total, true);
  assert.equal(byPath["steam-header.jpg"].rights_risk_class, "storefront_promotional");
});

test("Asset Acquisition Pro v1 penalises duplicate, stock and unknown-person candidates", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "penalties",
      downloaded_images: [
        img("steam_hero", "steam", "duplicate-a.jpg", { url: "https://cdn.example/gta.jpg", entity: "GTA" }),
        img("steam_hero", "steam", "duplicate-b.jpg", { url: "https://cdn.example/gta.jpg", entity: "GTA" }),
        img("photo", "unsplash", "stock-person.jpg", { stock: true, human: true }),
      ],
    }),
  );
  const duplicate = plan.candidates.find((candidate) => candidate.local_path === "duplicate-b.jpg");
  const stockPerson = plan.candidates.find((candidate) => candidate.local_path === "stock-person.jpg");

  assert.ok(duplicate.score.reasons.includes("duplicate_penalty"));
  assert.ok(stockPerson.score.reasons.includes("stock_filler_penalty"));
  assert.ok(stockPerson.score.reasons.includes("unknown_person_penalty"));
  assert.equal(stockPerson.accepted, false);
});

test("Asset Acquisition Pro v1 builds a balanced visual deck across multiple relevant entities", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "balanced-deck",
      title: "Take-Two passed on a mystery sequel while GTA, Red Dead and BioShock dominate fan theories",
      body: "The publisher story mentions GTA, Red Dead and BioShock as the big comparison points.",
      full_script:
        "The publisher story mentions GTA, Red Dead and BioShock as the big comparison points.",
      downloaded_images: [
        img("steam_hero", "steam", "gta-hero.jpg", { entity: "GTA", url: "https://cdn.example/gta-hero.jpg" }),
        img("steam_capsule", "steam", "gta-capsule.jpg", { entity: "GTA", url: "https://cdn.example/gta-capsule.jpg" }),
        img("steam_hero", "steam", "red-dead-hero.jpg", { entity: "Red Dead", url: "https://cdn.example/rdr-hero.jpg" }),
        img("steam_hero", "steam", "bioshock-hero.jpg", { entity: "BioShock", url: "https://cdn.example/bioshock-hero.jpg" }),
        img("article_hero", "article", "article.jpg", { entity: "Take-Two" }),
      ],
    }),
  );
  const entities = new Set(plan.visual_deck.items.map((item) => item.entity));
  const paths = plan.visual_deck.items.map((item) => item.local_path);

  assert.ok(entities.has("GTA"));
  assert.ok(entities.has("Red Dead"));
  assert.ok(entities.has("BioShock"));
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(plan.visual_deck.items.length <= 12, true);
  assert.equal(plan.visual_deck.first_frame_safe, true);
  assert.equal(plan.visual_deck.thumbnail_candidate_safe, true);
});

test("Asset Acquisition Pro v1 keeps stock filler out of the deck when safer alternatives exist", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "stock-last-resort",
      downloaded_images: [
        img("company_logo", "official", "platform-logo.png", { entity: "Xbox" }),
        img("photo", "pexels", "stock-controller-1.jpg", { stock: true }),
        img("photo", "pexels", "stock-controller-2.jpg", { stock: true }),
      ],
    }),
  );

  assert.equal(
    plan.visual_deck.items.some((item) => item.source_type === "stock_filler"),
    false,
  );
  assert.ok(plan.visual_deck.items.some((item) => item.source_type === "platform_logo"));
  assert.ok(plan.visual_deck.items.some((item) => item.source_type === "generated_brand_card"));
});

test("Asset Acquisition Pro v1 can use stock filler only as the absolute last resort", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "stock-only",
      downloaded_images: [img("photo", "pexels", "stock-controller.jpg", { stock: true })],
    }),
  );

  assert.ok(plan.visual_deck.items.some((item) => item.source_type === "stock_filler"));
});

test("Asset Acquisition Pro v1 writes provenance entries with source, risk and relevance", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "provenance",
      downloaded_images: [
        img("steam_hero", "steam", "gta-hero.jpg", {
          entity: "GTA",
          url: "https://cdn.example/gta-hero.jpg",
          width: 1920,
          height: 1080,
          file_size: 250000,
          content_type: "image/jpeg",
        }),
      ],
    }),
  );
  const entry = plan.media_provenance[0];

  assert.equal(entry.source_url, "https://cdn.example/gta-hero.jpg");
  assert.equal(entry.source_type, "steam_hero");
  assert.equal(entry.entity, "GTA");
  assert.equal(entry.rights_risk_class, "storefront_promotional");
  assert.equal(entry.thumbnail_safety_verdict.decision, "allow");
  assert.equal(entry.relevance_score > 0, true);
  assert.equal(typeof entry.duplicate_hash, "string");
});

test("Asset Acquisition Pro v1 simulates readiness improvement from short_only towards premium", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "improvement",
      downloaded_images: [],
      game_images: [
        img("steam_hero", "steam", "gta-hero.jpg", { entity: "GTA" }),
        img("steam_capsule", "steam", "gta-capsule.jpg", { entity: "GTA" }),
        img("steam_screenshot", "steam", "gta-screen.jpg", { entity: "GTA" }),
      ],
      video_clips: [trailer("gta-trailer.mp4")],
      thumbnail_candidate_path: "test/output/gta-thumb.jpg",
    }),
  );

  assert.equal(["blog_only", "short_only"].includes(plan.creator_studio_before.media_verdict), true);
  assert.equal(["standard_ready", "premium_ready"].includes(plan.creator_studio_after.media_verdict), true);
  assert.equal(plan.creator_studio_integration.improved, true);
});

test("Asset Acquisition Pro v1 renders a visual deck markdown report", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "deck-md",
      downloaded_images: [img("steam_hero", "steam", "gta-hero.jpg", { entity: "GTA" })],
    }),
  );
  const markdown = buildVisualDeckMarkdown(plan);

  assert.match(markdown, /Visual Deck/);
  assert.match(markdown, /deck-md/);
  assert.match(markdown, /steam_hero|generated_brand_card/);
});
