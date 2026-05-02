"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildStillDeckMediaPackage,
  buildStoryFromStillDeckPlan,
  selectStillDeckPlan,
} = require("../../lib/studio/v2/still-deck-ingestion");

function story(overrides = {}) {
  return {
    id: "1szzhy9",
    title:
      "Marathon Drops To 15K Daily CCU Peak On Steam, Exits Top 50 On PlayStation & Top 100 On Xbox Best-Sellers Lists",
    hook: "Marathon has fallen hard on Steam.",
    body: "The Bungie extraction shooter is struggling across Steam, PlayStation and Xbox.",
    full_script:
      "Marathon has fallen hard on Steam. The Bungie extraction shooter is struggling across Steam, PlayStation and Xbox.",
    ...overrides,
  };
}

function planFor(storyId = "1szzhy9", assets = []) {
  return {
    story_id: storyId,
    title: "Test story",
    applied_assets: assets,
    provenance: assets.map((asset) => ({
      source_url: asset.source_url,
      source_type: asset.source_type,
      entity: asset.entity,
      action: "applied_local",
      local_path: asset.local_path,
      rights_risk_class: asset.rights_risk_class || "storefront_promotional",
      relevance_score: asset.relevance_score || 90,
      duplicate_hash: asset.duplicate_hash,
    })),
  };
}

function frameReportFor(storyId = "1szzhy9", frames = []) {
  return {
    schema_version: 1,
    mode: "apply_local",
    plans: [
      {
        story_id: storyId,
        frames,
      },
    ],
  };
}

async function imageFile(dir, name = "asset.jpg") {
  const file = path.join(dir, name);
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, "fake-image");
  return file;
}

test("still-deck adapter rejects missing local assets", async () => {
  const pack = await buildStillDeckMediaPackage({
    story: story(),
    plan: planFor("1szzhy9", [
      {
        local_path: path.join(os.tmpdir(), "missing-still.jpg"),
        source_url: "https://cdn.example/marathon.jpg",
        source_type: "steam_header",
        entity: "Marathon",
        duplicate_hash: "missing",
      },
    ]),
  });

  assert.equal(pack.media.articleHeroes.length, 0);
  assert.equal(pack.rejected[0].reason, "missing_local_asset");
});

test("still-deck adapter rejects unsafe portrait assets", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "author_headshot.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story(),
    plan: planFor("1szzhy9", [
      {
        local_path: localPath,
        source_url: "https://cdn.example/author_headshot.jpg",
        source_type: "article_inline",
        entity: "Marathon",
        duplicate_hash: "unsafe",
        thumbnail_safety_verdict: {
          safeForThumbnail: false,
          isLikelyHuman: true,
        },
      },
    ]),
  });

  assert.equal(pack.media.articleHeroes.length, 0);
  assert.equal(pack.rejected[0].reason, "unsafe_portrait_or_author_asset");
});

test("still-deck adapter dedupes repeated assets", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "marathon_steam.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story(),
    plan: planFor("1szzhy9", [
      {
        local_path: localPath,
        source_url: "https://cdn.example/marathon.jpg",
        source_type: "steam_header",
        entity: "Marathon",
        duplicate_hash: "same",
      },
      {
        local_path: localPath,
        source_url: "https://cdn.example/marathon.jpg",
        source_type: "steam_header",
        entity: "Marathon",
        duplicate_hash: "same",
      },
    ]),
  });

  assert.equal(pack.media.articleHeroes.length, 1);
  assert.equal(pack.rejected[0].reason, "duplicate_asset");
});

test("still-deck adapter preserves provenance", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "marathon_steam.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story(),
    plan: planFor("1szzhy9", [
      {
        local_path: localPath,
        source_url: "https://cdn.example/marathon.jpg",
        source_type: "steam_header",
        entity: "Marathon",
        duplicate_hash: "hash-one",
        rights_risk_class: "storefront_promotional",
      },
    ]),
  });

  assert.equal(pack.assets[0].provenance.source_url, "https://cdn.example/marathon.jpg");
  assert.equal(pack.assets[0].provenance.source_type, "steam_header");
  assert.equal(pack.assets[0].provenance.duplicate_hash, "hash-one");
});

test("still-deck adapter maps v1.1 assets into Studio V2 media package", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "marathon_steam.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story(),
    plan: planFor("1szzhy9", [
      {
        local_path: localPath,
        source_url: "https://cdn.example/marathon.jpg",
        source_type: "steam_screenshot",
        entity: "Marathon",
        duplicate_hash: "screen",
      },
    ]),
  });

  assert.equal(pack.media.clips.length, 0);
  assert.equal(pack.media.trailerFrames.length, 0);
  assert.equal(pack.media.articleHeroes.length, 1);
  assert.equal(pack.media.articleHeroes[0].sourceType, "steam_screenshot");
  assert.equal(pack.media.articleHeroes[0].kind, "enriched-still");
});

test("still-deck adapter ingests accepted official frame extraction report into Studio V2 trailer frames", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-frame-ingest-"));
  const localPath = await imageFile(dir, "001_GTA_42pct.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "rss_5b3abe925b27a199",
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      full_script: "GTA, Red Dead and BioShock are the exact subjects in this Take-Two story.",
    }),
    plan: planFor("rss_5b3abe925b27a199", []),
    frameReport: frameReportFor("rss_5b3abe925b27a199", [
      {
        order: 1,
        story_id: "rss_5b3abe925b27a199",
        source_url: "https://video.akamai.steamstatic.com/store_trailers/gta/hls_264_master.m3u8",
        source_type: "steam_movie",
        entity: "GTA",
        target_time_percent: 0.42,
        target_time_seconds: 25.2,
        local_path: localPath,
        status: "accepted",
        qa: {
          verdict: "pass",
          thumbnail_safe: true,
          likely_has_face: false,
          black_frame: false,
          content_hash: "frame-hash-one",
          width: 1080,
          height: 608,
        },
      },
    ]),
  });

  assert.equal(pack.media.articleHeroes.length, 0);
  assert.equal(pack.media.trailerFrames.length, 1);
  assert.equal(pack.assets[0].kind, "trailer-frame");
  assert.equal(pack.assets[0].sourceType, "official_trailer_frame");
  assert.equal(pack.assets[0].provenance.original_source_type, "steam_movie");
  assert.equal(pack.assets[0].provenance.content_hash, "frame-hash-one");
  assert.equal(pack.metrics.acceptedFrameCount, 1);
  assert.equal(pack.metrics.distinctFrameEntities, 1);
});

test("still-deck adapter rejects QA-failed extracted frames", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-frame-ingest-"));
  const localPath = await imageFile(dir, "002_GTA_52pct.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "rss_5b3abe925b27a199",
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      full_script: "GTA is the exact subject in this Take-Two story.",
    }),
    plan: planFor("rss_5b3abe925b27a199", []),
    frameReport: frameReportFor("rss_5b3abe925b27a199", [
      {
        order: 1,
        story_id: "rss_5b3abe925b27a199",
        source_url: "https://video.akamai.steamstatic.com/store_trailers/gta/hls_264_master.m3u8",
        source_type: "steam_movie",
        entity: "GTA",
        local_path: localPath,
        status: "accepted",
        qa: {
          verdict: "fail",
          thumbnail_safe: false,
          likely_has_face: true,
          failures: ["unsafe_face_like_frame"],
          content_hash: "unsafe-frame",
        },
      },
    ]),
  });

  assert.equal(pack.media.trailerFrames.length, 0);
  assert.equal(pack.rejected[0].reason, "unsafe_or_failed_frame");
  assert.equal(pack.metrics.rejectedFrameCount, 1);
});

test("still-deck adapter rejects accepted trailer frames that are title or rating cards", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-frame-ingest-"));
  const localPath = await imageFile(dir, "003_Red_Dead_18pct.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "rss_5b3abe925b27a199",
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      full_script: "Red Dead is one of the exact subjects in this Take-Two story.",
    }),
    plan: planFor("rss_5b3abe925b27a199", []),
    frameReport: frameReportFor("rss_5b3abe925b27a199", [
      {
        order: 1,
        story_id: "rss_5b3abe925b27a199",
        source_url: "https://video.akamai.steamstatic.com/store_trailers/reddead/hls_264_master.m3u8",
        source_type: "steam_movie",
        entity: "Red Dead",
        local_path: localPath,
        status: "accepted",
        qa: {
          verdict: "pass",
          thumbnail_safe: true,
          likely_has_face: false,
          black_frame: false,
          content_hash: "title-card",
          prescan: {
            likely_is_logo: true,
            text_overlay_likelihood: 0.39,
            edge_density: 0.26,
            saturation_mean: 0.26,
          },
        },
      },
    ]),
  });

  assert.equal(pack.media.trailerFrames.length, 0);
  assert.equal(pack.rejected[0].reason, "title_or_rating_card_frame");
  assert.equal(pack.metrics.rejectedFrameCount, 1);
});

test("still-deck adapter dedupes extracted frames by QA content hash", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-frame-ingest-"));
  const first = await imageFile(dir, "001_GTA_18pct.jpg");
  const second = await imageFile(dir, "002_GTA_52pct.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "rss_5b3abe925b27a199",
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      full_script: "GTA is the exact subject in this Take-Two story.",
    }),
    plan: planFor("rss_5b3abe925b27a199", []),
    frameReport: frameReportFor("rss_5b3abe925b27a199", [
      {
        order: 1,
        story_id: "rss_5b3abe925b27a199",
        source_url: "https://video.akamai.steamstatic.com/store_trailers/gta/hls_264_master.m3u8",
        source_type: "steam_movie",
        entity: "GTA",
        local_path: first,
        status: "accepted",
        qa: { verdict: "pass", thumbnail_safe: true, content_hash: "same-frame-hash" },
      },
      {
        order: 2,
        story_id: "rss_5b3abe925b27a199",
        source_url: "https://video.akamai.steamstatic.com/store_trailers/gta/hls_264_master.m3u8",
        source_type: "steam_movie",
        entity: "GTA",
        local_path: second,
        status: "accepted",
        qa: { verdict: "pass", thumbnail_safe: true, content_hash: "same-frame-hash" },
      },
    ]),
  });

  assert.equal(pack.media.trailerFrames.length, 1);
  assert.equal(pack.rejected[0].reason, "duplicate_frame");
});

test("still-deck adapter ignores extracted frames for another story", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-frame-ingest-"));
  const localPath = await imageFile(dir, "001_GTA_18pct.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "rss_5b3abe925b27a199",
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      full_script: "GTA is the exact subject in this Take-Two story.",
    }),
    plan: planFor("rss_5b3abe925b27a199", []),
    frameReport: frameReportFor("other_story", [
      {
        order: 1,
        story_id: "other_story",
        source_url: "https://video.akamai.steamstatic.com/store_trailers/gta/hls_264_master.m3u8",
        source_type: "steam_movie",
        entity: "GTA",
        local_path: localPath,
        status: "accepted",
        qa: { verdict: "pass", thumbnail_safe: true, content_hash: "frame-hash-one" },
      },
    ]),
  });

  assert.equal(pack.media.trailerFrames.length, 0);
  assert.equal(pack.metrics.acceptedFrameCount, 0);
});

test("still-deck adapter prevents wrong-story stale assets", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "metro_2039_key_art.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story(),
    plan: planFor("1szzhy9", [
      {
        local_path: localPath,
        source_url: "https://cdn.example/metro-2039.jpg",
        source_type: "steam_header",
        entity: "Metro 2039",
        duplicate_hash: "metro",
      },
    ]),
  });

  assert.equal(pack.media.articleHeroes.length, 0);
  assert.equal(pack.rejected[0].reason, "wrong_story_asset_hint");
});

test("still-deck adapter accepts v1.5 verified exact-subject assets even when the local script is thin", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const redDead = await imageFile(dir, "red_dead_steam_header.jpg");
  const bioshock = await imageFile(dir, "bioshock_steam_header.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "rss_5b3abe925b27a199",
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      full_script: "Take-Two passed on a sequel and fans are trying to work out which franchise was involved.",
    }),
    plan: planFor("rss_5b3abe925b27a199", [
      {
        local_path: redDead,
        source_url: "https://cdn.akamai.steamstatic.com/steam/apps/1174180/header.jpg",
        source_type: "steam_header",
        entity: "Red Dead",
        duplicate_hash: "red-dead",
        subject_match_quality: "exact_franchise_match",
        exact_subject_group: "Red Dead",
        counted_for_premium: true,
        store_asset_source: "steam",
        store_app_id: "1174180",
        store_app_title: "Red Dead Redemption 2",
        store_match_status: "verified",
        store_match_verified: true,
      },
      {
        local_path: bioshock,
        source_url: "https://cdn.akamai.steamstatic.com/steam/apps/8870/header.jpg",
        source_type: "steam_header",
        entity: "BioShock",
        duplicate_hash: "bioshock",
        subject_match_quality: "exact_game_match",
        exact_subject_group: "BioShock",
        counted_for_premium: true,
        store_asset_source: "steam",
        store_app_id: "8870",
        store_app_title: "BioShock Infinite",
        store_match_status: "verified",
        store_match_verified: true,
      },
    ]),
  });

  assert.equal(pack.media.articleHeroes.length, 2);
  assert.equal(pack.metrics.distinctEntities, 2);
  assert.equal(pack.assets[0].storeMatchVerified, true);
  assert.equal(pack.assets[0].storeAppTitle, "Red Dead Redemption 2");
  assert.equal(pack.assets[1].subjectMatchQuality, "exact_game_match");
  assert.equal(pack.provenance[0].store_app_id, "1174180");
});

test("still-deck adapter does not bypass wrong-story checks for unverified exact-subject claims", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "red_dead_steam_header.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "rss_5b3abe925b27a199",
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      full_script: "Take-Two passed on a sequel and fans are trying to work out which franchise was involved.",
    }),
    plan: planFor("rss_5b3abe925b27a199", [
      {
        local_path: localPath,
        source_url: "https://cdn.akamai.steamstatic.com/steam/apps/1174180/header.jpg",
        source_type: "steam_header",
        entity: "Red Dead",
        duplicate_hash: "red-dead-unverified",
        subject_match_quality: "exact_franchise_match",
        exact_subject_group: "Red Dead",
        counted_for_premium: true,
        store_match_verified: false,
      },
    ]),
  });

  assert.equal(pack.media.articleHeroes.length, 0);
  assert.equal(pack.rejected[0].reason, "wrong_story_asset_hint");
});

test("still-deck adapter rejects generic store assets without a game entity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "steam_header.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story(),
    plan: planFor("1szzhy9", [
      {
        local_path: localPath,
        source_url: "https://cdn.example/app-header.jpg",
        source_type: "steam_header",
        entity: "Steam",
        duplicate_hash: "steam-generic",
      },
    ]),
  });

  assert.equal(pack.media.articleHeroes.length, 0);
  assert.equal(pack.rejected[0].reason, "generic_store_asset_without_game_entity");
});

test("still-deck adapter rejects low-confidence article review images", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "article-review.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story(),
    plan: planFor("1szzhy9", [
      {
        local_path: localPath,
        source_url: "https://cdn.example/marathon.png",
        source_type: "article_hero",
        entity: "playstation",
        duplicate_hash: "article-low",
        thumbnail_safety_verdict: {
          safeForThumbnail: true,
          decision: "review",
          score: 42,
        },
      },
    ]),
  });

  assert.equal(pack.media.articleHeroes.length, 0);
  assert.equal(pack.rejected[0].reason, "low_confidence_article_asset");
});

test("still-deck adapter reads thumbnail safety from provenance when applied asset omits it", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "article-review.jpg");
  const plan = planFor("1szzhy9", [
    {
      local_path: localPath,
      source_url: "https://cdn.example/marathon.png",
      source_type: "article_hero",
      entity: "playstation",
      duplicate_hash: "article-provenance-low",
    },
  ]);
  plan.provenance[0].thumbnail_safety_verdict = {
    safeForThumbnail: true,
    decision: "review",
    score: 42,
  };
  const pack = await buildStillDeckMediaPackage({
    story: story(),
    plan,
  });

  assert.equal(pack.media.articleHeroes.length, 0);
  assert.equal(pack.rejected[0].reason, "low_confidence_article_asset");
});

test("still-deck adapter output deck has no more than the allowed repeats", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "marathon_steam.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story(),
    maxRepeatPerAsset: 1,
    plan: planFor("1szzhy9", [
      {
        local_path: localPath,
        source_url: "https://cdn.example/marathon-a.jpg",
        source_type: "steam_header",
        entity: "Marathon",
        duplicate_hash: "a",
      },
      {
        local_path: localPath,
        source_url: "https://cdn.example/marathon-b.jpg",
        source_type: "steam_screenshot",
        entity: "Marathon",
        duplicate_hash: "b",
      },
    ]),
  });

  assert.equal(pack.metrics.maxAssetRepeat, 1);
  assert.equal(pack.media.articleHeroes.length, 1);
});

test("selectStillDeckPlan prefers requested improved stories", () => {
  const report = {
    plans: [
      { story_id: "weak", would_improve_readiness: false, would_fetch: [] },
      { story_id: "1szzhy9", would_improve_readiness: true, would_fetch: [{ id: "a" }] },
    ],
  };

  const selected = selectStillDeckPlan(report, {
    preferredStoryIds: ["1szzhy9", "rss_4105cb7c837252c3"],
  });

  assert.equal(selected.story_id, "1szzhy9");
});

test("selectStillDeckPlan honours an explicit story id", () => {
  const report = {
    plans: [
      { story_id: "rss_5b3abe925b27a199", would_improve_readiness: false, would_fetch: [{ id: "gta" }] },
      { story_id: "1szzhy9", would_improve_readiness: true, would_fetch: [{ id: "marathon" }] },
    ],
  };

  const selected = selectStillDeckPlan(report, {
    storyId: "rss_5b3abe925b27a199",
    preferredStoryIds: ["1szzhy9"],
  });

  assert.equal(selected.story_id, "rss_5b3abe925b27a199");
});

test("buildStoryFromStillDeckPlan creates a safe local fallback story with v1.5 entities", () => {
  const fallback = buildStoryFromStillDeckPlan({
    story_id: "rss_5b3abe925b27a199",
    title: "GTA 6 owner passed on a sequel to a legacy franchise",
    diversity_delta: { added_entities: ["GTA", "Red Dead"] },
    applied_assets: [
      {
        source_type: "steam_header",
        entity: "BioShock",
        exact_subject_group: "BioShock",
        subject_match_quality: "exact_game_match",
        store_match_verified: true,
      },
    ],
  });

  assert.equal(fallback.id, "rss_5b3abe925b27a199");
  assert.match(fallback.full_script, /GTA/);
  assert.match(fallback.full_script, /Red Dead/);
  assert.match(fallback.full_script, /BioShock/);
  assert.equal(fallback.source_type, "asset_acquisition_report");
});

test("still-deck local narration uses the approved production-shaped local voice path", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );
  assert.match(src, /ensureProductionLocalVoice\(/);
  assert.match(src, /acceptedLocalVoice:\s*narration\.acceptedLocalVoice/);
  assert.doesNotMatch(src, /generateTTS\(/);
});
