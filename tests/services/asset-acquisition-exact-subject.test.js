"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAssetAcquisitionPlan,
  buildAssetAcquisitionControlRoom,
  renderExactSubjectMarkdown,
  renderStoreVerificationMarkdown,
} = require("../../lib/asset-acquisition-pro");
const { buildProductionPacket } = require("../../lib/creator-studio-os");

function img(type, source, path, extra = {}) {
  return {
    type,
    source,
    path,
    url: extra.url || `https://cdn.example/${path}`,
    width: 1920,
    height: 1080,
    ...extra,
  };
}

function baseStory(overrides = {}) {
  return {
    id: "exact-subject-story",
    title: "Take-Two passed on a mystery sequel while GTA, Red Dead and BioShock dominate fan theories",
    url: "https://example.com/take-two-legacy-franchise",
    source_type: "rss",
    subreddit: "IGN",
    flair: "Verified",
    score: 650,
    timestamp: "2026-05-01T10:00:00Z",
    company_name: "Take-Two",
    hook: "Take-Two may have passed on a legacy sequel.",
    body: "Fans are comparing the mystery sequel with GTA, Red Dead and BioShock while Rockstar focuses on GTA 6.",
    loop: "That makes the missing sequel the real story.",
    full_script:
      "Take-Two may have passed on a legacy sequel. Fans are comparing the mystery sequel with GTA, Red Dead and BioShock while Rockstar focuses on GTA 6. That makes the missing sequel the real story.",
    downloaded_images: [],
    game_images: [],
    video_clips: [],
    thumbnail_candidate_path: "test/output/exact-thumb.jpg",
    outro_present: true,
    ...overrides,
  };
}

function candidateByPath(plan, path) {
  return plan.candidates.find((candidate) => candidate.local_path === path);
}

test("v1.2 counts exact Steam and IGDB app title matches for premium subject inventory", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      title: "BioShock 4 rumour returns as Take-Two fans look for the missing sequel",
      body: "BioShock is the game fans keep naming.",
      full_script: "BioShock is the game fans keep naming.",
      game_images: [
        img("steam_header", "steam", "bioshock-steam.jpg", {
          entity: "BioShock",
          app_title: "BioShock Remastered",
        }),
        img("igdb_screenshot", "igdb", "bioshock-igdb.jpg", {
          game_title: "BioShock",
        }),
      ],
    }),
  );

  assert.equal(candidateByPath(plan, "bioshock-steam.jpg").subject_match_quality, "exact_game_match");
  assert.equal(candidateByPath(plan, "bioshock-igdb.jpg").subject_match_quality, "exact_game_match");
  assert.equal(candidateByPath(plan, "bioshock-steam.jpg").counted_for_premium, true);
  assert.equal(plan.exact_subject_readiness.exact_subject_asset_count, 2);
});

test("v1.2 normalises Pokemon subject groups to canonical accented spelling", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      id: "pokemon-exact",
      title: "Pok\u00c3\u00a9mon Go event gets confirmed",
      body: "Pokemon Go is the exact game being discussed.",
      full_script: "Pok\u00c3\u00a9mon Go is the exact game being discussed.",
      downloaded_images: [
        img("steam_hero", "steam", "pokemon-go-hero.jpg", {
          entity: "Pokemon",
          steam_app_title: "Pokemon Go",
        }),
      ],
    }),
  );

  assert.ok(plan.entity_map.games.includes("Pok\u00e9mon"));
  assert.equal(candidateByPath(plan, "pokemon-go-hero.jpg").exact_subject_group, "Pok\u00e9mon");
  assert.equal(candidateByPath(plan, "pokemon-go-hero.jpg").subject_match_quality, "exact_game_match");
  assert.doesNotMatch(JSON.stringify(plan.exact_subject_readiness), /Pok\u00c3|&amp;/);
});

test("v1.2 counts franchise title matches but publisher logos stay context only", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      downloaded_images: [
        img("steam_hero", "steam", "red-dead-hero.jpg", {
          entity: "Red Dead",
          steam_app_title: "Red Dead Redemption 2",
        }),
        img("company_logo", "official", "take-two-logo.png", { entity: "Take-Two" }),
      ],
    }),
  );

  assert.equal(candidateByPath(plan, "red-dead-hero.jpg").subject_match_quality, "exact_franchise_match");
  assert.equal(candidateByPath(plan, "red-dead-hero.jpg").counted_for_premium, true);
  assert.equal(candidateByPath(plan, "take-two-logo.png").subject_match_quality, "publisher_context_only");
  assert.equal(candidateByPath(plan, "take-two-logo.png").counted_for_premium, false);
});

test("v1.2 counts platform imagery only for a platform story", () => {
  const platformPlan = buildAssetAcquisitionPlan(
    baseStory({
      title: "Xbox Game Pass pricing update changes the platform story this week",
      body: "Xbox Game Pass is changing how players compare subscription value.",
      full_script: "Xbox Game Pass is changing how players compare subscription value.",
      downloaded_images: [img("platform_ui", "official", "xbox-dashboard.jpg", { entity: "Xbox" })],
    }),
  );
  const publisherPlan = buildAssetAcquisitionPlan(
    baseStory({
      downloaded_images: [img("platform_ui", "official", "xbox-dashboard.jpg", { entity: "Xbox" })],
    }),
  );

  assert.equal(candidateByPath(platformPlan, "xbox-dashboard.jpg").subject_match_quality, "exact_platform_match");
  assert.equal(candidateByPath(platformPlan, "xbox-dashboard.jpg").counted_for_premium, true);
  assert.equal(candidateByPath(publisherPlan, "xbox-dashboard.jpg").subject_match_quality, "generic_store_asset");
  assert.equal(candidateByPath(publisherPlan, "xbox-dashboard.jpg").counted_for_premium, false);
});

test("v1.2 disqualifies generic store, article-only and stock assets from premium readiness", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      downloaded_images: [
        img("steam_header", "steam", "steam-generic.jpg", { entity: "Steam" }),
        img("article_hero", "article", "article-hero.jpg"),
        img("photo", "pexels", "stock-person.jpg", { stock: true, human: true }),
      ],
    }),
  );

  assert.equal(candidateByPath(plan, "steam-generic.jpg").subject_match_quality, "generic_store_asset");
  assert.equal(candidateByPath(plan, "article-hero.jpg").subject_match_quality, "article_context_only");
  assert.equal(candidateByPath(plan, "stock-person.jpg").subject_match_quality, "unsafe_or_rejected");
  assert.equal(plan.exact_subject_readiness.premium_countable_asset_count, 0);
});

test("v1.2 requires multiple exact groups for Take-Two multi-game stories", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      downloaded_images: [
        img("steam_hero", "steam", "gta-1.jpg", { entity: "GTA", steam_app_title: "Grand Theft Auto V" }),
        img("steam_capsule", "steam", "gta-2.jpg", { entity: "GTA", steam_app_title: "Grand Theft Auto V" }),
        img("steam_screenshot", "steam", "gta-3.jpg", { entity: "GTA", steam_app_title: "Grand Theft Auto V" }),
        img("steam_screenshot", "steam", "gta-4.jpg", { entity: "GTA", steam_app_title: "Grand Theft Auto V" }),
        img("steam_screenshot", "steam", "gta-5.jpg", { entity: "GTA", steam_app_title: "Grand Theft Auto V" }),
        img("steam_screenshot", "steam", "gta-6.jpg", { entity: "GTA", steam_app_title: "Grand Theft Auto V" }),
      ],
    }),
  );

  assert.equal(plan.exact_subject_readiness.exact_subject_asset_count, 6);
  assert.equal(plan.exact_subject_readiness.unique_exact_subject_groups, 1);
  assert.equal(plan.exact_subject_readiness.studio_v2_60s_eligible, false);
  assert.ok(plan.exact_subject_readiness.downgrade_reasons.includes("needs_3_unique_exact_subject_groups"));
});

test("v1.2 runtime downgrade rules block 60s candidates below four exact assets", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      title: "BioShock sequel rumour returns",
      body: "BioShock is the only game being discussed.",
      full_script: "BioShock is the only game being discussed.",
      downloaded_images: [
        img("steam_hero", "steam", "bioshock-1.jpg", { entity: "BioShock", steam_app_title: "BioShock Remastered" }),
        img("steam_screenshot", "steam", "bioshock-2.jpg", { entity: "BioShock", steam_app_title: "BioShock Remastered" }),
        img("igdb_cover", "igdb", "bioshock-3.jpg", { entity: "BioShock", igdb_title: "BioShock" }),
      ],
    }),
  );

  assert.equal(plan.exact_subject_readiness.exact_subject_asset_count, 3);
  assert.equal(plan.exact_subject_readiness.studio_v2_60s_eligible, false);
  assert.equal(plan.exact_subject_readiness.recommended_runtime_class, "short_only_30_45");
  assert.equal(plan.exact_subject_readiness.recommended_format, "short_only");
});

test("v1.2 promotes six diverse exact assets to premium candidate", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      downloaded_images: [
        img("steam_hero", "steam", "gta-1.jpg", { entity: "GTA", steam_app_title: "Grand Theft Auto V" }),
        img("steam_screenshot", "steam", "gta-2.jpg", { entity: "GTA", steam_app_title: "Grand Theft Auto V" }),
        img("steam_hero", "steam", "red-dead-1.jpg", { entity: "Red Dead", steam_app_title: "Red Dead Redemption 2" }),
        img("steam_screenshot", "steam", "red-dead-2.jpg", { entity: "Red Dead", steam_app_title: "Red Dead Redemption 2" }),
        img("igdb_cover", "igdb", "bioshock-1.jpg", { entity: "BioShock", igdb_title: "BioShock" }),
        img("igdb_screenshot", "igdb", "bioshock-2.jpg", { entity: "BioShock", igdb_title: "BioShock" }),
      ],
    }),
  );

  assert.equal(plan.exact_subject_readiness.exact_subject_asset_count, 6);
  assert.equal(plan.exact_subject_readiness.unique_exact_subject_groups, 3);
  assert.equal(plan.exact_subject_readiness.studio_v2_60s_eligible, true);
  assert.equal(plan.exact_subject_readiness.recommended_runtime_class, "premium_short_60_75");
  assert.equal(plan.exact_subject_readiness.recommended_format, "premium_short");
});

test("v1.2 downgrades repeated image decks even with enough exact labels", () => {
  const shared = "https://cdn.example/repeated-bioshock.jpg";
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      title: "BioShock sequel rumour returns",
      body: "BioShock is the only game being discussed.",
      full_script: "BioShock is the only game being discussed.",
      downloaded_images: [
        img("steam_hero", "steam", "bioshock-1.jpg", { entity: "BioShock", url: shared, steam_app_title: "BioShock Remastered" }),
        img("steam_screenshot", "steam", "bioshock-2.jpg", { entity: "BioShock", url: shared, steam_app_title: "BioShock Remastered" }),
        img("steam_screenshot", "steam", "bioshock-3.jpg", { entity: "BioShock", url: shared, steam_app_title: "BioShock Remastered" }),
        img("steam_screenshot", "steam", "bioshock-4.jpg", { entity: "BioShock", url: shared, steam_app_title: "BioShock Remastered" }),
      ],
    }),
  );

  assert.equal(plan.exact_subject_readiness.repeated_asset_pairs > 0, true);
  assert.equal(plan.exact_subject_readiness.studio_v2_60s_eligible, false);
  assert.ok(plan.exact_subject_readiness.downgrade_reasons.includes("repeated_asset_pairs_above_threshold"));
});

test("v1.2 report exposes counted and disqualified assets", () => {
  const report = buildAssetAcquisitionControlRoom([
    baseStory({
      id: "report-story",
      downloaded_images: [
        img("steam_hero", "steam", "gta.jpg", { entity: "GTA", steam_app_title: "Grand Theft Auto V" }),
        img("steam_header", "steam", "steam-generic.jpg", { entity: "Steam" }),
      ],
    }),
  ]);
  const markdown = renderExactSubjectMarkdown(report);

  assert.equal(report.schema_version, 3);
  assert.equal(report.exact_subject_summary.stories, 1);
  assert.equal(report.plans[0].media_provenance[0].subject_match_quality, "exact_game_match");
  assert.equal(report.plans[0].media_provenance[1].subject_match_quality, "generic_store_asset");
  assert.match(markdown, /Exact-Subject Still Matching/);
  assert.match(markdown, /report-story/);
});

test("Creator Studio OS exposes exact-subject readiness fields", () => {
  const packet = buildProductionPacket(
    baseStory({
      id: "creator-exact",
      downloaded_images: [
        img("steam_hero", "steam", "gta-1.jpg", { entity: "GTA", steam_app_title: "Grand Theft Auto V" }),
        img("steam_hero", "steam", "red-dead-1.jpg", { entity: "Red Dead", steam_app_title: "Red Dead Redemption 2" }),
        img("igdb_cover", "igdb", "bioshock-1.jpg", { entity: "BioShock", igdb_title: "BioShock" }),
        img("company_logo", "official", "take-two-logo.png", { entity: "Take-Two" }),
      ],
    }),
  );

  assert.equal(packet.media_inventory.exact_subject_asset_count, 3);
  assert.equal(packet.media_inventory.generic_context_asset_count, 1);
  assert.equal(packet.media_inventory.premium_countable_asset_count, 3);
  assert.equal(packet.media_inventory.studio_v2_60s_eligibility, false);
  assert.equal(packet.media_inventory.recommended_runtime_class, "short_only_30_45");
  assert.ok(packet.media_inventory.rejection_or_downgrade_reasons.length > 0);
});

test("v1.3 verifies Steam app id, title and matched query before counting store assets", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      title: "BioShock sequel rumour returns as Take-Two fans look for the missing sequel",
      body: "BioShock is the game fans keep naming.",
      full_script: "BioShock is the game fans keep naming.",
      downloaded_images: [
        img("steam_hero", "steam", "bioshock-store.jpg", {
          entity: "BioShock",
          url: "https://cdn.akamai.steamstatic.com/steam/apps/409710/header.jpg",
          steam_app_id: 409710,
          steam_app_title: "BioShock Remastered",
          steam_matched_query: "BioShock",
        }),
      ],
    }),
  );
  const candidate = candidateByPath(plan, "bioshock-store.jpg");

  assert.equal(candidate.store_app_id, "409710");
  assert.equal(candidate.store_app_title, "BioShock Remastered");
  assert.equal(candidate.store_matched_query, "BioShock");
  assert.equal(candidate.store_match_status, "verified");
  assert.equal(candidate.store_match_verified, true);
  assert.equal(candidate.subject_match_quality, "exact_game_match");
  assert.equal(candidate.counted_for_premium, true);
});

test("v1.3 rejects wrong Steam app titles even when a loose entity label claims a match", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      title: "BioShock sequel rumour returns as Take-Two fans look for the missing sequel",
      body: "BioShock is the game fans keep naming.",
      full_script: "BioShock is the game fans keep naming.",
      downloaded_images: [
        img("steam_hero", "steam", "wrong-steam.jpg", {
          entity: "BioShock",
          url: "https://cdn.akamai.steamstatic.com/steam/apps/286690/header.jpg",
          steam_app_id: 286690,
          steam_app_title: "Metro 2033 Redux",
          steam_matched_query: "BioShock",
        }),
      ],
    }),
  );
  const candidate = candidateByPath(plan, "wrong-steam.jpg");

  assert.equal(candidate.store_app_id, "286690");
  assert.equal(candidate.store_match_status, "mismatch");
  assert.equal(candidate.store_match_verified, false);
  assert.equal(candidate.subject_match_quality, "generic_store_asset");
  assert.equal(candidate.counted_for_premium, false);
  assert.equal(candidate.rejection_or_downgrade_reason, "store_app_title_mismatch");
});

test("v1.3 treats Steam assets without app-title provenance as unverified", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      title: "BioShock sequel rumour returns as Take-Two fans look for the missing sequel",
      body: "BioShock is the game fans keep naming.",
      full_script: "BioShock is the game fans keep naming.",
      downloaded_images: [
        img("steam_hero", "steam", "missing-title.jpg", {
          entity: "BioShock",
          url: "https://cdn.akamai.steamstatic.com/steam/apps/409710/header.jpg",
        }),
      ],
    }),
  );
  const candidate = candidateByPath(plan, "missing-title.jpg");

  assert.equal(candidate.store_app_id, "409710");
  assert.equal(candidate.store_match_status, "missing_title");
  assert.equal(candidate.store_match_verified, false);
  assert.equal(candidate.counted_for_premium, false);
  assert.equal(plan.exact_subject_readiness.exact_subject_asset_count, 0);
});

test("v1.3 verifies IGDB title or slug matches before counting IGDB assets", () => {
  const plan = buildAssetAcquisitionPlan(
    baseStory({
      title: "BioShock sequel rumour returns as Take-Two fans look for the missing sequel",
      body: "BioShock is the game fans keep naming.",
      full_script: "BioShock is the game fans keep naming.",
      downloaded_images: [
        img("igdb_cover", "igdb", "bioshock-igdb.jpg", {
          entity: "BioShock",
          igdb_id: 1234,
          igdb_title: "BioShock",
          igdb_slug: "bioshock",
        }),
        img("igdb_screenshot", "igdb", "wrong-igdb.jpg", {
          entity: "BioShock",
          igdb_id: 5678,
          igdb_title: "Metro Exodus",
          igdb_slug: "metro-exodus",
        }),
      ],
    }),
  );

  assert.equal(candidateByPath(plan, "bioshock-igdb.jpg").store_match_status, "verified");
  assert.equal(candidateByPath(plan, "bioshock-igdb.jpg").counted_for_premium, true);
  assert.equal(candidateByPath(plan, "wrong-igdb.jpg").store_match_status, "mismatch");
  assert.equal(candidateByPath(plan, "wrong-igdb.jpg").counted_for_premium, false);
});

test("v1.3 report exposes store verification status", () => {
  const report = buildAssetAcquisitionControlRoom([
    baseStory({
      id: "store-report",
      title: "BioShock sequel rumour returns",
      body: "BioShock is the game fans keep naming.",
      full_script: "BioShock is the game fans keep naming.",
      downloaded_images: [
        img("steam_hero", "steam", "bioshock-store.jpg", {
          entity: "BioShock",
          url: "https://cdn.akamai.steamstatic.com/steam/apps/409710/header.jpg",
          steam_app_title: "BioShock Remastered",
        }),
        img("steam_hero", "steam", "wrong-store.jpg", {
          entity: "BioShock",
          url: "https://cdn.akamai.steamstatic.com/steam/apps/286690/header.jpg",
          steam_app_title: "Metro 2033 Redux",
        }),
      ],
    }),
  ]);
  const markdown = renderStoreVerificationMarkdown(report);

  assert.equal(report.store_verification_summary.verified, 1);
  assert.equal(report.store_verification_summary.mismatch, 1);
  assert.match(markdown, /Exact Store App Verification/);
  assert.match(markdown, /store-report/);
  assert.match(markdown, /mismatch/);
});
