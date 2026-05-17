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

test("still-deck adapter rejects accepted trailer frames with failing visual taste metadata", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-frame-ingest-"));
  const localPath = await imageFile(dir, "004_BioShock_62pct.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "rss_5b3abe925b27a199",
      title: "GTA 6 owner passed on a sequel to a legacy franchise",
      full_script: "BioShock is one of the exact subjects in this Take-Two story.",
    }),
    plan: planFor("rss_5b3abe925b27a199", []),
    frameReport: frameReportFor("rss_5b3abe925b27a199", [
      {
        order: 1,
        story_id: "rss_5b3abe925b27a199",
        source_url: "https://video.akamai.steamstatic.com/store_trailers/bioshock/hls_264_master.m3u8",
        source_type: "steam_movie",
        entity: "BioShock",
        local_path: localPath,
        status: "accepted",
        qa: {
          verdict: "pass",
          thumbnail_safe: true,
          failures: [],
          content_hash: "dead-dark-frame",
          visual_taste: {
            verdict: "fail",
            reason: "dead_dark_frame",
            score: 18.2,
          },
        },
      },
    ]),
  });

  assert.equal(pack.media.trailerFrames.length, 0);
  assert.equal(pack.rejected[0].reason, "low_detail_official_frame");
  assert.equal(pack.metrics.rejectedFrameCount, 1);
});

test("still-deck Flash Lane proofs run forensic QA with strict Flash subtitle density", async () => {
  const source = await fs.readFile(
    path.join(process.cwd(), "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(source, /runForensicQa\(\{[\s\S]*flashLane:\s*variant\s*===\s*"enriched"/);
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

test("still-deck adapter accepts verified exact-subject store assets with generic source entity", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "forza_steam_screenshot.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "1te1oq7",
      title: "Forza Horizon 6 beats its predecessor's all-time Steam record",
      full_script: "Forza Horizon 6 has a verified Steam store signal.",
    }),
    plan: planFor("1te1oq7", [
      {
        local_path: localPath,
        source_url: "https://cdn.akamai.steamstatic.com/steam/apps/2483190/ss_forza.jpg",
        source_type: "steam_screenshot",
        entity: "steam",
        duplicate_hash: "forza-steam",
        subject_match_quality: "exact_game_match",
        exact_subject_group: "Forza Horizon 6",
        counted_for_premium: true,
        store_match_verified: true,
      },
    ]),
  });

  assert.equal(pack.media.articleHeroes.length, 1);
  assert.equal(pack.media.articleHeroes[0].entity, "Forza Horizon 6");
  assert.equal(pack.metrics.distinctEntities, 1);
});

test("still-deck adapter accepts exact-subject metadata restored from provenance", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "forza_apply_local.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "1te1oq7",
      title: "Forza Horizon 6 beats its predecessor's all-time Steam record",
      full_script: "Forza Horizon 6 has a verified Steam store signal.",
    }),
    plan: {
      story_id: "1te1oq7",
      applied_assets: [
        {
          local_path: localPath,
          source_url: "https://cdn.akamai.steamstatic.com/steam/apps/2483190/ss_forza.jpg",
          source_type: "steam_screenshot",
          entity: "steam",
          store_match_verified: true,
        },
      ],
      provenance: [
        {
          local_path: null,
          source_url: "https://cdn.akamai.steamstatic.com/steam/apps/2483190/ss_forza.jpg",
          source_type: "steam_screenshot",
          entity: "Forza Horizon 6",
          subject_match_quality: "exact_game_match",
          exact_subject_group: "Forza Horizon 6",
          counted_for_premium: true,
          store_match_verified: true,
          duplicate_hash: "forza-from-provenance",
        },
      ],
    },
  });

  assert.equal(pack.media.articleHeroes.length, 1);
  assert.equal(pack.media.articleHeroes[0].entity, "Forza Horizon 6");
});

test("still-deck adapter resolves MEDIA_ROOT-relative local assets", async () => {
  const oldMediaRoot = process.env.MEDIA_ROOT;
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-media-root-"));
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const relPath = path.join("output", "image_cache", "forza_media_root.jpg");
    await imageFile(mediaRoot, relPath);
    const pack = await buildStillDeckMediaPackage({
      story: story({
        id: "1te1oq7",
        title: "Forza Horizon 6 beats its predecessor's all-time Steam record",
        full_script: "Forza Horizon 6 has a verified Steam store signal.",
      }),
      plan: planFor("1te1oq7", [
        {
          local_path: relPath,
          source_url: "https://cdn.akamai.steamstatic.com/steam/apps/2483190/ss_media_root.jpg",
          source_type: "steam_screenshot",
          entity: "Forza Horizon 6",
          duplicate_hash: "forza-media-root",
          subject_match_quality: "exact_game_match",
          exact_subject_group: "Forza Horizon 6",
          counted_for_premium: true,
          store_match_verified: true,
        },
      ]),
    });

    assert.equal(pack.media.articleHeroes.length, 1);
    assert.equal(pack.media.articleHeroes[0].path, path.join(mediaRoot, relPath));
  } finally {
    if (oldMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = oldMediaRoot;
  }
});

test("still-deck adapter falls back to visual deck items from asset acquisition reports", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-still-ingest-"));
  const localPath = await imageFile(dir, "forza_visual_deck.jpg");
  const pack = await buildStillDeckMediaPackage({
    story: story({
      id: "1te1oq7",
      title: "Forza Horizon 6 beats its predecessor's all-time Steam record",
      full_script: "Forza Horizon 6 has a verified Steam store signal.",
    }),
    plan: {
      story_id: "1te1oq7",
      visual_deck: {
        items: [
          {
            local_path: localPath,
            source_url: "https://cdn.akamai.steamstatic.com/steam/apps/2483190/visual_deck.jpg",
            source_type: "steam_screenshot",
            entity: "steam",
            subject_match_quality: "exact_game_match",
            exact_subject_group: "Forza Horizon 6",
            counted_for_premium: true,
            store_match_verified: true,
          },
        ],
      },
    },
  });

  assert.equal(pack.media.articleHeroes.length, 1);
  assert.equal(pack.media.articleHeroes[0].entity, "Forza Horizon 6");
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
  assert.doesNotMatch(src, /dotenv"\)\.config\(\{\s*override:\s*true\s*\}\)/);
});

test("still-deck provided narration resolves media-root relative audio and timestamps at read time", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /require\("\.\.\/lib\/media-paths"\)/);
  assert.match(src, /async function resolveReadableMediaArg/);
  assert.match(src, /mediaPaths\.resolveExisting\(inputPath\)/);
  assert.match(src, /else if \(arg === "--audio"\) args\.audioPath = argv\[\+\+i\] \|\| "";/);
  assert.match(src, /else if \(arg === "--timestamps"\) args\.timestampsPath = argv\[\+\+i\] \|\| "";/);
  assert.match(src, /const resolvedAudioPath = await resolveReadableMediaArg\(audioPath\)/);
  assert.match(src, /await resolveReadableMediaArg\(timestampsPath\)/);
  assert.match(src, /looksLikeLocalTtsPath\(resolvedAudioPath\)/);
});

test("still-deck supplied local narration must carry accepted voice metadata", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /acceptedLocalVoice:\s*meta\?\.meta\?\.acceptedLocalVoice\s*\|\|\s*null/);
  assert.match(src, /probeLocalAudioAcoustics/);
  assert.match(src, /const acoustic =[\s\S]*meta\?\.meta\?\.acoustic[\s\S]*suppliedLocalTts \? probeLocalAudioAcoustics\(resolvedAudioPath\) : null/);
  assert.match(src, /acoustic,[\s\S]*voiceDiagnostics/);
  assert.match(src, /voiceDiagnostics:\s*meta\?\.meta\?\.voiceDiagnostics\s*\|\|\s*null/);
  assert.match(src, /approvedLocalVoice:\s*meta\?\.meta\?\.approvedLocalVoice/);
  assert.match(src, /transcript:\s*meta\?\.meta\?\.transcript/);
  assert.match(src, /displayText:\s*meta\?\.meta\?\.displayText/);
  assert.doesNotMatch(
    src,
    /suppliedLocalTts\s*\?\s*resolveAcceptedLocalVoiceReference\(process\.env\)/,
  );
});

test("still-deck local narration can infer mastering from acoustic proof", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /function inferVoiceMastering\(\{ explicit, acoustic \} = \{\}\)/);
  assert.match(src, /integratedLufs >= -18 && integratedLufs <= -14/);
  assert.match(src, /truePeakDb <= -1 && truePeakDb >= -4/);
  assert.match(src, /source:\s*"local_acoustic_probe"/);
  assert.match(src, /voiceMastering:\s*inferVoiceMastering\(\{ explicit: explicitVoiceMastering, acoustic \}\)/);
});

test("still-deck render path applies package readiness before ffmpeg render", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );
  assert.match(src, /evaluateStillDeckRenderReadiness/);
  assert.match(src, /render_package_gate/);
  assert.match(src, /renderPreflightBlocked = true/);
  assert.match(src, /args\.allowFlashDiagnosticRender/);
});

test("still-deck Flash render path passes overlay beat coverage into preflight", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /const overlayPlan =[\s\S]*buildFlashLaneOverlayPlan\(\{ story: renderStory, scenes, durationS \}\)/);
  assert.match(src, /buildFlashLaneProofPreflight\(\{\s*narration,\s*scenes,\s*media,\s*overlayPlan,/);
  assert.match(src, /assertFlashLaneProofReady\(\s*\{\s*narration,\s*scenes,\s*media,\s*overlayPlan\s*\}/);
});

test("still-deck render path can burn Visual V3 before subtitles", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /--visual-v3/);
  assert.match(src, /buildVisualV3OverlayPlan/);
  assert.match(src, /buildVisualV3OverlayFilter/);
  assert.match(src, /subtitleInputLabel = "visualV3Base"/);
  assert.match(src, /quality\.visualV3\s*=/);
  assert.match(src, /visual_v3:/);
});

test("still-deck ASS timeline covers the narration tail without a fixed outro cap", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /function resolveSubtitleTimelineDurationS/);
  assert.match(src, /Math\.max\(0\.1,\s*\.\.\.candidates\)/);
  assert.match(src, /const assDurationS = resolveSubtitleTimelineDurationS\(\{/);
  assert.match(src, /renderDurationS:\s*durationS/);
  assert.match(src, /narrationDurationS:\s*narration\.durationS/);
  assert.doesNotMatch(src, /durationS\s*-\s*0\.6/);
});

test("still-deck render pads video and audio to the subtitle timeline before mapping", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /function buildSubtitleBaseFilter/);
  assert.match(src, /const padDurationS = Math\.max\(/);
  assert.match(src, /targetDurationS\s*-\s*\(Number\.isFinite\(renderDuration\)/);
  assert.match(src, /tpad=stop_mode=clone:stop_duration=\$\{padDurationS\.toFixed\(3\)\}/);
  assert.match(src, /trim=duration=\$\{targetDurationS\.toFixed\(3\)\}/);
  assert.match(src, /const subtitleRenderDurationS = assDurationS/);
  assert.match(src, /buildSubtitleBaseFilter\(\{\s*inputLabel: subtitleInputLabel,/);
  assert.match(src, /\[subtitleBase\]ass=\$\{assRel\},format=yuv420p\[outv\]/);
  assert.match(src, /anullsrc=channel_layout=stereo:sample_rate=48000/);
  assert.match(src, /-t \$\{subtitleRenderDurationS\.toFixed\(3\)\}/);
  assert.match(src, /targetDurationS:\s*subtitleRenderDurationS/);
  assert.match(src, /\[\$\{audioIndex\}:a\]apad,atrim=duration=\$\{subtitleRenderDurationS\.toFixed\(3\)\}/);
});

test("still-deck Flash captions prefer display text while aligning against real narration", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /resolveStillDeckCaptionOptions/);
  assert.match(src, /const scriptText =[\s\S]*narration\.displayText\s*\|\|\s*renderStory\.scriptForCaption\s*\|\|\s*narration\.transcript\s*\|\|\s*renderStory\.full_script/);
  assert.match(src, /\.\.\.resolveStillDeckCaptionOptions\(\{ variant \}\)/);
  assert.match(src, /prepareSubtitleWords/);
  assert.match(src, /realignTimestampsToScript/);
  assert.match(src, /realign:\s*false/);
  assert.doesNotMatch(src, /maxPhraseChars:\s*22/);
  assert.doesNotMatch(src, /danglingMergeMaxWords:\s*variant === "enriched" \? 3 : 2/);
});

test("still-deck Flash render path adjusts scene durations to narration word boundaries", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /beat-aware-scene-durations/);
  assert.match(src, /function alignScenesToNarrationBeats/);
  assert.match(src, /alignSceneDurationsToWordBoundaries/);
  assert.match(src, /scenes = alignScenesToNarrationBeats\(\{/);
  assert.match(src, /const transitions = buildCutTransitions\(scenes\)/);
});

test("still-deck Flash preflight report surfaces motion and beat coverage metrics", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /motion dominance:\s*\$\{metrics\.motionDominance/);
  assert.match(src, /story beat overlays:\s*\$\{metrics\.storyBeatOverlayCount/);
  assert.match(src, /unique clip sources:\s*\$\{visualMetrics\.uniqueClipSources/);
  assert.match(src, /distinct scene beats:\s*\$\{visualMetrics\.distinctSceneBeats/);
});

test("still-deck report includes Flash proof render_readiness summary", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /buildFlashLaneProofReadinessSummary/);
  assert.match(src, /const renderReadiness = buildFlashLaneProofReadinessSummary\(\{/);
  assert.match(src, /render_readiness:\s*renderReadiness/);
  assert.match(src, /## Render Readiness/);
  assert.match(src, /story beat overlays:\s*\$\{readiness\.storyBeatOverlayCount/);
  assert.match(src, /unique clip sources:\s*\$\{readiness\.uniqueClipSources/);
  assert.match(src, /distinct scene beats:\s*\$\{readiness\.distinctSceneBeats/);
});

test("still-deck report wording does not call no-render packages silent-audio proofs", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );
  assert.match(src, /No render was attempted, so no narration audio was used/);
  assert.match(src, /no MP4 render was attempted, so narration was not verified/);
  assert.match(src, /report\.render_attempted\s*===\s*false/);
  assert.match(src, /official trailer clips were blocked/i);
  assert.match(src, /const visualOutput = !renderAttempted/);
});

test("still-deck diagnostic renders may use partial validated official clips explicitly", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "studio-v2-still-deck-ingestion.js"),
    "utf8",
  );

  assert.match(src, /resolveOfficialTrailerClipRefsForProof\(\{/);
  assert.match(src, /allowPartialValidatedOfficialClips:\s*args\.allowFlashDiagnosticRender/);
});
