"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");

const digest = require("../../lib/intelligence/render-health-digest");

// 2026-04-29 follow-up to the production render regression.
// assemble.js now stamps render_lane / render_quality_class /
// outro_present / distinct_visual_count on every produced story.
// This file pins the daily Discord digest that turns those stamps into
// a per-day shape of rendering quality — drives the operator's
// decision on flipping BLOCK_THIN_VISUALS=true.

function story(overrides = {}) {
  // Default = a healthy stamped multi-image render finished moments ago.
  return {
    id: `s_${Math.random().toString(36).slice(2, 8)}`,
    exported_at: new Date().toISOString(),
    render_lane: "legacy_multi_image",
    render_quality_class: "standard",
    outro_present: true,
    thumbnail_candidate_present: true,
    distinct_visual_count: 4,
    ...overrides,
  };
}

const oldStamp = () => new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(); // 36h ago

// ── window selection ──────────────────────────────────────────────

test("buildRenderHealthSummary: stories outside window are excluded", () => {
  const stories = [
    story({ exported_at: new Date().toISOString() }),
    story({ exported_at: oldStamp() }),
    story({ exported_at: oldStamp() }),
  ];
  const r = digest.buildRenderHealthSummary(stories, { windowHours: 24 });
  assert.equal(r.total_in_window, 1);
  assert.equal(r.stamped, 1);
});

test("buildRenderHealthSummary: recent published legacy render is included without exported_at", () => {
  const recent = new Date().toISOString();
  const stories = [
    story({
      exported_at: undefined,
      created_at: oldStamp(),
      updated_at: oldStamp(),
      published_at: recent,
    }),
  ];
  const r = digest.buildRenderHealthSummary(stories, { windowHours: 24 });
  assert.equal(r.total_in_window, 1);
  assert.equal(r.stamped, 1);
});

test("buildRenderHealthSummary: recent updated old render is excluded without export/publish timestamps", () => {
  const recent = new Date().toISOString();
  const stories = [
    story({
      exported_at: undefined,
      created_at: oldStamp(),
      updated_at: recent,
      published_at: undefined,
      youtube_published_at: undefined,
    }),
  ];
  const r = digest.buildRenderHealthSummary(stories, { windowHours: 24 });
  assert.equal(r.total_in_window, 0);
  assert.equal(r.stamped, 0);
});

test("buildRenderHealthSummary: stamp-less rows count as unstamped (excluded from %)", () => {
  const stories = [
    story(),
    story({ render_quality_class: undefined, render_lane: undefined }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.equal(r.total_in_window, 2);
  assert.equal(r.stamped, 1);
  assert.equal(r.unstamped, 1);
});

// ── quality / lane / outro tallies ────────────────────────────────

test("buildRenderHealthSummary: tallies quality classes correctly", () => {
  const stories = [
    story({ render_quality_class: "premium", distinct_visual_count: 8 }),
    story({ render_quality_class: "premium", distinct_visual_count: 7 }),
    story({ render_quality_class: "standard", distinct_visual_count: 4 }),
    story({ render_quality_class: "fallback", distinct_visual_count: 2 }),
    story({ render_quality_class: "reject", distinct_visual_count: 0 }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.deepEqual(r.quality, {
    premium: 2,
    standard: 1,
    fallback: 1,
    reject: 1,
  });
  assert.equal(r.percentages.quality.premium, 40);
});

test("buildRenderHealthSummary: tallies render lanes including 'other' bucket for unknown", () => {
  const stories = [
    story({ render_lane: "legacy_multi_image" }),
    story({ render_lane: "legacy_multi_image" }),
    story({ render_lane: "legacy_single_image_fallback" }),
    story({ render_lane: "studio_v2_speculative" }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.equal(r.lane.legacy_multi_image, 2);
  assert.equal(r.lane.legacy_single_image_fallback, 1);
  assert.equal(r.lane.other, 1);
});

test("buildRenderHealthSummary: outro tallies present/missing/unknown", () => {
  const stories = [
    story({ outro_present: true }),
    story({ outro_present: true }),
    story({ outro_present: false }),
    // Stamp-less outro field (stamped quality but missing outro_present).
    story({ outro_present: undefined }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.equal(r.outro.present, 2);
  assert.equal(r.outro.missing, 1);
  assert.equal(r.outro.unknown, 1);
  assert.equal(r.percentages.outro.present, 50);
});

test("buildRenderHealthSummary: thin_count = stamped stories with distinct_visual_count < 3", () => {
  const stories = [
    story({ distinct_visual_count: 8 }),
    story({ distinct_visual_count: 5 }),
    story({ distinct_visual_count: 2 }),
    story({ distinct_visual_count: 1 }),
    story({ distinct_visual_count: 0 }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.equal(r.thin_count, 3);
  assert.equal(r.percentages.thin, 60);
});

test("buildRenderHealthSummary: visual_count summary returns null fields when no stamped rows", () => {
  const r = digest.buildRenderHealthSummary([]);
  assert.equal(r.stamped, 0);
  assert.equal(r.visual_count.median, null);
  assert.equal(r.visual_count.mean, null);
  assert.equal(r.percentages.thin, 0);
});

test("buildRenderHealthSummary: visual_count returns min/max/median/mean", () => {
  const stories = [
    story({ distinct_visual_count: 1 }),
    story({ distinct_visual_count: 3 }),
    story({ distinct_visual_count: 5 }),
    story({ distinct_visual_count: 7 }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.equal(r.visual_count.min, 1);
  assert.equal(r.visual_count.max, 7);
  assert.equal(r.visual_count.median, 4);
  assert.equal(r.visual_count.mean, 4);
});

// ── markdown rendering ────────────────────────────────────────────

test("formatDigest: empty window emits 'no stamped stories'", () => {
  const r = digest.buildRenderHealthSummary([]);
  const md = digest.formatDigest(r);
  assert.match(md, /No stamped stories in window/);
});

test("buildRenderHealthSummary: bridge candidates are reported separately from live DB stamps", () => {
  const r = digest.buildRenderHealthSummary(
    [story({ render_quality_class: undefined, render_lane: undefined })],
    {
      bridgeCandidates: [
        {
          id: "bridge-one",
          approved_at: new Date().toISOString(),
          render_quality_class: "premium",
          render_lane: "visual_v4_production",
          qa_visual_count: 8,
          outro_present: true,
          thumbnail_candidate_present: true,
        },
      ],
    },
  );

  assert.equal(r.stamped, 0);
  assert.equal(r.unstamped, 1);
  assert.equal(r.bridge.candidate_count, 1);
  assert.equal(r.bridge.stamped, 1);
  assert.equal(r.bridge.quality.premium, 1);
  assert.equal(r.bridge.lane.visual_v4_production, 1);
  assert.equal(r.bridge.visual_count.median, 8);
});

test("splitRenderHealthSummary: emits separate live DB and scheduler bridge reports", () => {
  const summary = digest.buildRenderHealthSummary(
    [story({ render_quality_class: undefined, render_lane: undefined })],
    {
      bridgeCandidates: [
        {
          id: "bridge-one",
          approved_at: new Date().toISOString(),
          render_quality_class: "premium",
          render_lane: "visual_v4_production",
          qa_visual_count: 8,
        },
      ],
    },
  );

  const split = digest.splitRenderHealthSummary(summary);

  assert.equal(split.live_db_health_report.stamped, 0);
  assert.equal(split.live_db_health_report.unstamped, 1);
  assert.equal(Object.hasOwn(split.live_db_health_report, "bridge"), false);
  assert.equal(split.bridge_health_report.candidate_count, 1);
  assert.equal(split.bridge_health_report.candidate_count_meaning, "scheduler_bridge_candidates");
  assert.equal(split.discord_digest_payload.summary.live_db_stamped, 0);
  assert.equal(split.discord_digest_payload.summary.scheduler_bridge_candidate_count, 1);
});

test("splitRenderHealthSummary: emits direct-video enrichment work order separately", () => {
  const summary = digest.buildRenderHealthSummary([], {
    bridgeCandidates: [
      {
        id: "still-motion",
        title: "Still Motion Needs Gameplay",
        approved_at: new Date().toISOString(),
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 6,
        visual_v4_bridge_video_clips: [
          {
            id: "still-1",
            path: "/tmp/still-1.mp4",
            source_url: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_1.jpg",
            source_type: "screenshot_derived_motion_clip",
            rights_risk_class: "source_documented_transformative_editorial_use",
            source_family: "steam_still_1",
          },
        ],
      },
    ],
  });

  const split = digest.splitRenderHealthSummary(summary);

  assert.equal(split.direct_video_enrichment_work_order.summary.job_count, 1);
  assert.equal(
    split.discord_digest_payload.summary.scheduler_bridge_direct_video_gap_count,
    1,
  );
});

test("buildRenderHealthSummary: marks direct-video gaps that block strict dry-run", () => {
  const summary = digest.buildRenderHealthSummary([], {
    bridgeCandidates: [
      {
        id: "still-motion",
        title: "Still Motion Needs Gameplay",
        approved_at: new Date().toISOString(),
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 6,
        visual_v4_bridge_video_clips: [
          {
            id: "still-1",
            path: "/tmp/still-1.mp4",
            source_url: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_1.jpg",
            source_type: "screenshot_derived_motion_clip",
            rights_risk_class: "source_documented_transformative_editorial_use",
            source_family: "steam_still_1",
          },
        ],
      },
    ],
    dryRunPlan: {
      blocked_stories: [
        {
          story_id: "still-motion",
          blockers: [
            "preflight_qa_blocked:bridge_motion_governance:direct_video_enrichment_required",
          ],
        },
      ],
    },
  });

  const workOrder = summary.bridge.direct_video_enrichment_work_order;
  assert.equal(workOrder.summary.job_count, 1);
  assert.equal(workOrder.summary.blocking_current_dry_run_count, 1);
  assert.equal(workOrder.jobs[0].blocking_current_dry_run, true);
});

test("buildRenderHealthSummary: bridge candidates expose real-media and generated-only evidence", () => {
  const now = new Date().toISOString();
  const generatedClips = Array.from({ length: 8 }, (_, index) => ({
    id: `generated-${index + 1}`,
    path: `output/generated-motion/generated-only/${index + 1}.mp4`,
    source_url: `local://pulse-generated-motion/generated-only/${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    rights_risk_class: "owned_generated_motion",
    source_family: `generated_family_${index + 1}`,
  }));
  const stillClips = Array.from({ length: 7 }, (_, index) => ({
    id: `still-${index + 1}`,
    path: `/tmp/still-${index + 1}.mp4`,
    source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_${index + 1}.jpg`,
    source_type: "screenshot_derived_motion_clip",
    rights_risk_class: "source_documented_transformative_editorial_use",
    source_family: `steam_still_${index + 1}`,
  }));
  const directClips = Array.from({ length: 5 }, (_, index) => ({
    id: `direct-${index + 1}`,
    path: `/tmp/direct-${index + 1}.mp4`,
    source_url: `https://cdn.example.test/gameplay-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    rights_risk_class: "official_reference_only",
    source_family: `official_video_${index + 1}`,
  }));

  const r = digest.buildRenderHealthSummary([], {
    bridgeCandidates: [
      {
        id: "generated-only",
        approved_at: now,
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 8,
        visual_v4_bridge_video_clips: generatedClips,
      },
      {
        id: "still-motion",
        approved_at: now,
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 7,
        visual_v4_bridge_video_clips: stillClips,
        rights_ledger: stillClips,
      },
      {
        id: "direct-video",
        approved_at: now,
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 5,
        visual_v4_bridge_video_clips: directClips,
        rights_ledger: directClips,
      },
    ],
  });

  assert.equal(r.bridge.visual_evidence.real_media_ready_count, 2);
  assert.equal(r.bridge.visual_evidence.generated_only_motion_deck_count, 1);
  assert.equal(r.bridge.visual_evidence.no_real_visual_media_asset_count, 1);
  assert.equal(r.bridge.visual_evidence.direct_video_motion_count, 1);
  assert.equal(r.bridge.visual_evidence.screenshot_derived_only_count, 1);
  assert.deepEqual(r.bridge.visual_evidence.direct_video_gap_story_ids, [
    "generated-only",
    "still-motion",
  ]);
  assert.deepEqual(r.bridge.visual_evidence.screenshot_derived_only_story_ids, ["still-motion"]);
  assert.deepEqual(r.bridge.visual_evidence.generated_only_story_ids, ["generated-only"]);

  const md = digest.formatDigest(r);
  assert.match(md, /Bridge visual evidence: real media 2\/3/);
  assert.match(md, /direct-video motion 1\/3/);
  assert.match(md, /generated-only 1/);
  assert.match(md, /screenshot-derived only 1/);
  assert.match(md, /direct-video motion coverage is low/);
  assert.match(md, /Direct-video gap sample: generated-only, still-motion/);
});

test("buildRenderHealthSummary: bridge visual evidence uses the shared direct-video classifier", () => {
  const now = new Date().toISOString();
  const productPageClips = [
    {
      id: "ps5-product-video",
      path: "C:/tmp/ps5-product-video.mp4",
      source_url: "https://gmedia.playstation.com/is/content/SIEPDC/ps5-overview.mp4",
      source_type: "official_platform_product_page",
      source_url_kind: "direct_video",
      media_kind: "direct_video",
      licence_basis: "official_platform_product_page_transformative_editorial_use",
      source_family: "official_playstation_ps5_product_page",
    },
  ];

  const r = digest.buildRenderHealthSummary([], {
    bridgeCandidates: [
      {
        id: "ps5-product-page",
        approved_at: now,
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 8,
        visual_v4_bridge_video_clips: productPageClips,
        rights_ledger: productPageClips,
      },
    ],
  });

  assert.equal(r.bridge.visual_evidence.direct_video_motion_count, 1);
  assert.deepEqual(r.bridge.visual_evidence.direct_video_story_ids, ["ps5-product-page"]);
  assert.deepEqual(r.bridge.visual_evidence.direct_video_gap_story_ids, []);
});

test("buildRenderHealthSummary: generic Steam HLS sidecars do not create subject mismatches", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "render-health-steam-hls-sidecar",
    "rss_cyberpunk_v4_clip_1_segment_direct_motion_1.mp4",
  );
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    render_signature: "studio_v4_clip_materializer_accurate_seek_v2",
    story_id: "rss_cyberpunk",
    clip_id: "segment_direct_motion_1",
    source_family: "segment_source_family_1_window_36_5",
    entity: "",
    source_type: "steam_movie",
    source_url_kind: "hls_manifest",
    provider: "steam",
    source_url: "https://video.akamai.steamstatic.com/store_trailers/1091500/637422/hash/hls_264_master.m3u8",
  });

  const r = digest.buildRenderHealthSummary([], {
    bridgeCandidates: [
      {
        id: "cyberpunk-steam-hls",
        title: "Cyberpunk 2077 Trust Debt Lands",
        canonical_subject: "Cyberpunk 2077",
        approved_at: new Date().toISOString(),
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 8,
        visual_v4_bridge_video_clips: [
          {
            id: "direct-1",
            path: clipPath,
            source_url: "https://video.akamai.steamstatic.com/store_trailers/1091500/637422/hash/hls_264_master.m3u8",
            source_type: "steam_movie",
            source_url_kind: "hls_manifest",
            source_kind: "hls_manifest",
            rights_basis: "official_direct_media",
            licence_basis: "official_reference_transformative_editorial_use",
            approval_status: "approved_for_transformative_editorial_use",
            counts_towards_motion_readiness: true,
            source_family: "segment_source_family_1_window_36_5",
          },
        ],
      },
    ],
  });

  assert.equal(r.bridge.visual_evidence.direct_video_motion_count, 1);
  assert.equal(r.bridge.visual_evidence.direct_video_subject_mismatch_count, 0);
  assert.deepEqual(r.bridge.visual_evidence.direct_video_gap_story_ids, []);
});

test("buildRenderHealthSummary: direct-media source owner can satisfy subject match despite generic sidecar family", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "render-health-source-owner-subject",
    "rss_halo_campaign_evolved_v4_clip_1_segment_direct_motion_1.mp4",
  );
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    render_signature: "studio_v4_clip_materializer_accurate_seek_v2",
    story_id: "rss_halo_campaign_evolved",
    clip_id: "segment_direct_motion_1",
    source_family: "steam_2806050_media_02_hls_264_master_window_59_70_5",
    entity: "",
    source_type: "steam_movie",
    source_url_kind: "hls_manifest",
    provider: "steam",
    source_url: "https://video.fastly.steamstatic.com/store_trailers/2806050/hash/hls_264_master.m3u8",
  });

  const r = digest.buildRenderHealthSummary([], {
    bridgeCandidates: [
      {
        id: "halo-campaign-evolved-steam-hls",
        title: "Halo Campaign Evolved Has A PS5 Account Catch",
        canonical_subject: "Halo: Campaign Evolved",
        approved_at: new Date().toISOString(),
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 8,
        visual_v4_bridge_video_clips: [
          {
            id: "direct-1",
            path: clipPath,
            source_url: "https://video.fastly.steamstatic.com/store_trailers/2806050/hash/hls_264_master.m3u8",
            source_type: "steam_movie",
            source_url_kind: "hls_manifest",
            source_kind: "hls_manifest",
            media_kind: "direct_video",
            rights_basis: "official_direct_media",
            licence_basis: "official_reference_transformative_editorial_use",
            approval_status: "approved_for_transformative_editorial_use",
            counts_towards_motion_readiness: true,
            source_family: "steam_2806050_media_02_hls_264_master_window_59_70_5",
            source_owner: "Halo: Campaign Evolved",
          },
        ],
        rights_ledger: [
          {
            id: "ledger-direct-1",
            path: clipPath,
            source_url: "https://video.fastly.steamstatic.com/store_trailers/2806050/hash/hls_264_master.m3u8",
            source_type: "steam_movie",
            source_url_kind: "hls_manifest",
            media_kind: "direct_video",
            rights_basis: "official_direct_media",
            licence_basis: "official_reference_transformative_editorial_use",
            source_family: "url:https://video.fastly.steamstatic.com/store_trailers/2806050/hash/hls_264_master.m3u8_window_42_40_5",
          },
        ],
      },
    ],
  });

  assert.equal(r.bridge.visual_evidence.direct_video_motion_count, 1);
  assert.equal(r.bridge.visual_evidence.direct_video_subject_mismatch_count, 0);
  assert.deepEqual(r.bridge.visual_evidence.direct_video_gap_story_ids, []);
});

test("buildRenderHealthSummary: sidecar subject mismatches do not count as healthy direct video", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "render-health-sidecar-mismatch",
    "fresh_xbox_minecraft_dungeons_ii_20260610_v4_clip_1_segment_direct_motion_3.mp4",
  );
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    render_signature: "studio_v4_clip_materializer_accurate_seek_v2",
    source_url: "https://blog.playstation.com/uploads/2026/06/wuchang-fallen-feathers.mp4",
    source_family: "playstation_blog_wuchang_fallen_feathers_media",
  });

  const r = digest.buildRenderHealthSummary([], {
    bridgeCandidates: [
      {
        id: "minecraft-sidecar-mismatch",
        title: "Minecraft Dungeons II Has A Co-Op Risk",
        canonical_subject: "Minecraft Dungeons II",
        approved_at: new Date().toISOString(),
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 8,
        visual_v4_bridge_video_clips: [
          {
            id: "direct-1",
            path: clipPath,
            source_url: "local://existing-official-direct-motion/minecraft/direct-1.mp4",
            source_type: "official_trailer_segment",
            source_url_kind: "direct_video",
            media_kind: "direct_video",
            rights_risk_class: "official_reference_only",
            source_family: "xbox_product_minecraft_dungeons_ii_media",
          },
        ],
      },
    ],
  });

  assert.equal(r.bridge.visual_evidence.direct_video_motion_count, 0);
  assert.equal(r.bridge.visual_evidence.direct_video_subject_mismatch_count, 1);
  assert.equal(r.bridge.visual_evidence.screenshot_derived_only_count, 0);
  assert.deepEqual(r.bridge.visual_evidence.direct_video_subject_mismatch_story_ids, [
    "minecraft-sidecar-mismatch",
  ]);
  assert.deepEqual(r.bridge.visual_evidence.direct_video_gap_story_ids, [
    "minecraft-sidecar-mismatch",
  ]);
  assert.match(
    digest.formatDigest(r),
    /direct-video subject mismatch 1/,
  );
});

test("buildRenderHealthSummary: character-specific stories reject same-game wrong-character direct motion", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "render-health-character-specific-mismatch",
    "rss_sf6_yasmine_v4_clip_1_sf6_alex_gameplay.mp4",
  );
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    render_signature: "studio_v4_clip_materializer_accurate_seek_v2",
    source_url: "https://video.akamai.steamstatic.com/store_trailers/1364780/sf6_alex_gameplay.mp4",
    source_family: "url:https://video.akamai.steamstatic.com/store_trailers/1364780/sf6_alex_gameplay.mp4_window_36_5",
    entity: "",
    source_type: "steam_movie",
    source_url_kind: "hls_manifest",
  });

  const r = digest.buildRenderHealthSummary([], {
    bridgeCandidates: [
      {
        id: "sf6-yasmine-wrong-character",
        title: "Street Fighter 6 just made Yasmine look like a ranked-mode problem",
        canonical_subject: "Street Fighter 6",
        canonical_game: "Street Fighter 6",
        approved_at: new Date().toISOString(),
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 8,
        visual_v4_bridge_video_clips: [
          {
            id: "direct-1",
            path: clipPath,
            source_url: "https://video.akamai.steamstatic.com/store_trailers/1364780/sf6_alex_gameplay.mp4",
            source_type: "steam_movie",
            source_url_kind: "hls_manifest",
            media_kind: "direct_video",
            rights_basis: "official_direct_media",
            licence_basis: "official_reference_transformative_editorial_use",
            approval_status: "approved_for_transformative_editorial_use",
            counts_towards_motion_readiness: true,
            source_family: "url:https://video.akamai.steamstatic.com/store_trailers/1364780/sf6_alex_gameplay.mp4_window_36_5",
          },
        ],
      },
    ],
  });

  assert.equal(r.bridge.visual_evidence.direct_video_motion_count, 0);
  assert.equal(r.bridge.visual_evidence.direct_video_subject_mismatch_count, 1);
  assert.equal(r.bridge.visual_evidence.screenshot_derived_only_count, 0);
  assert.deepEqual(r.bridge.visual_evidence.direct_video_subject_mismatch_story_ids, [
    "sf6-yasmine-wrong-character",
  ]);
  assert.deepEqual(r.bridge.visual_evidence.direct_video_gap_story_ids, [
    "sf6-yasmine-wrong-character",
  ]);
});

test("buildRenderHealthSummary: bridge direct-video gaps become enrichment work orders", () => {
  const now = new Date().toISOString();
  const stillClips = Array.from({ length: 6 }, (_, index) => ({
    id: `still-${index + 1}`,
    path: `/tmp/still-${index + 1}.mp4`,
    source_url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/ss_${index + 1}.jpg`,
    source_type: "screenshot_derived_motion_clip",
    rights_risk_class: "source_documented_transformative_editorial_use",
    source_family: `steam_still_${index + 1}`,
  }));
  const directClips = [
    {
      id: "direct-1",
      path: "/tmp/direct-1.mp4",
      source_url: "https://cdn.example.test/gameplay-1.mp4",
      source_type: "official_trailer_segment",
      source_url_kind: "direct_video",
      media_kind: "direct_video",
      rights_risk_class: "official_reference_only",
      source_family: "official_video_1",
    },
  ];

  const r = digest.buildRenderHealthSummary([], {
    bridgeCandidates: [
      {
        id: "still-motion",
        title: "Still Motion Needs Gameplay",
        approved_at: now,
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 6,
        visual_v4_bridge_video_clips: stillClips,
        rights_ledger: stillClips,
      },
      {
        id: "direct-video",
        title: "Direct Video Already Ready",
        approved_at: now,
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 6,
        visual_v4_bridge_video_clips: directClips,
        rights_ledger: directClips,
      },
    ],
  });

  const workOrder = r.bridge.direct_video_enrichment_work_order;
  assert.equal(workOrder.summary.job_count, 1);
  assert.equal(workOrder.summary.quality_gap_count, 1);
  assert.equal(workOrder.jobs[0].story_id, "still-motion");
  assert.equal(workOrder.jobs[0].repair_lane, "direct_video_enrichment");
  assert.equal(workOrder.jobs[0].blocking_current_dry_run, false);
  assert.equal(workOrder.jobs[0].operator_approval_required, true);
  assert.match(
    workOrder.jobs[0].recommended_commands[0].command,
    /ops:v4-source-family-acquisition -- --story-id still-motion/,
  );
  assert.match(
    workOrder.jobs[0].post_repair_validation_command,
    /ops:render-health -- --json/,
  );
});

test("formatDigest: bridge candidates make unstamped live debt explicit", () => {
  const md = digest.formatDigest(
    digest.buildRenderHealthSummary([], {
      bridgeCandidates: [
        {
          id: "bridge-one",
          approved_at: new Date().toISOString(),
          render_quality_class: "premium",
          render_lane: "visual_v4_production",
          qa_visual_count: 8,
        },
      ],
    }),
  );

  assert.match(md, /Bridge V4 final renders: 1 stamped/);
  assert.match(md, /live DB still has no stamped rows/);
});

test("formatDigest: active V4 bridge health leads over unstamped legacy debt", () => {
  const now = new Date().toISOString();
  const directClips = Array.from({ length: 5 }, (_, index) => ({
    id: `direct-${index + 1}`,
    path: `/tmp/direct-${index + 1}.mp4`,
    source_url: `https://cdn.example.test/gameplay-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    rights_risk_class: "official_reference_only",
    source_family: `official_video_${index + 1}`,
  }));
  const legacyRows = Array.from({ length: 50 }, () =>
    story({ render_quality_class: undefined, render_lane: undefined }),
  );

  const md = digest.formatDigest(
    digest.buildRenderHealthSummary(legacyRows, {
      bridgeCandidates: Array.from({ length: 5 }, (_, index) => ({
        id: `bridge-${index + 1}`,
        approved_at: now,
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 8,
        visual_v4_bridge_video_clips: directClips,
        rights_ledger: directClips,
      })),
    }),
  );

  assert.match(md, /Bridge V4 final renders: 5 stamped \(5 candidates\)/);
  assert.match(md, /direct-video motion 5\/5/);
  assert.match(md, /Legacy DB rows: 0 stamped, 50 unstamped/);
  assert.doesNotMatch(md, /No stamped stories in window/);
});

test("formatDigest: high thin-rate triggers 'hold off' operator hint", () => {
  const stories = [
    story({ distinct_visual_count: 1 }),
    story({ distinct_visual_count: 1 }),
    story({ distinct_visual_count: 8 }),
  ];
  const md = digest.formatDigest(digest.buildRenderHealthSummary(stories));
  assert.match(md, /Hold off on BLOCK_THIN_VISUALS=true/);
});

test("formatDigest: low thin-rate + sufficient sample triggers approval-ready pilot hint", () => {
  const stories = Array.from({ length: 12 }, () =>
    story({ distinct_visual_count: 6, render_quality_class: "premium" }),
  );
  const md = digest.formatDigest(digest.buildRenderHealthSummary(stories));
  assert.match(md, /BLOCK_THIN_VISUALS=true is approval-ready/);
  assert.match(md, /controlled next-window pilot/);
  assert.match(md, /do not flip it silently/);
});

test("formatDigest: surfaces outro misses with the warning glyph", () => {
  const stories = [
    story({ outro_present: true }),
    story({ outro_present: false }),
  ];
  const md = digest.formatDigest(digest.buildRenderHealthSummary(stories));
  assert.match(md, /1 missing/);
});

// ── runRenderHealthDigest end-to-end ───────────────────────────────

test("runRenderHealthDigest: pulls stories via injected db, returns summary + markdown", async () => {
  const fakeDb = {
    async getStories() {
      return [story({ render_quality_class: "premium" }), story()];
    },
  };
  const { summary, markdown } = await digest.runRenderHealthDigest({
    db: fakeDb,
    bridgeCandidates: [
      {
        id: "bridge-one",
        approved_at: new Date().toISOString(),
        render_quality_class: "premium",
        render_lane: "visual_v4_production",
        qa_visual_count: 8,
      },
    ],
  });
  assert.equal(summary.stamped, 2);
  assert.equal(summary.bridge.stamped, 1);
  assert.match(markdown, /Render health/);
});

test("runRenderHealthDigest: db throw is swallowed, returns empty summary + markdown", async () => {
  const fakeDb = {
    async getStories() {
      throw new Error("db down");
    },
  };
  const { summary, markdown } = await digest.runRenderHealthDigest({
    db: fakeDb,
  });
  assert.equal(summary.stamped, 0);
  assert.match(markdown, /No stamped stories/);
});
