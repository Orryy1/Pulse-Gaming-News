const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildStudioV4RenderBridge,
  buildStudioV4BridgeRightsLedger,
  applyStudioV4RenderBridgeToStory,
} = require("../../lib/studio/v4/render-bridge");

function readyPacket() {
  return {
    readiness: { status: "ready_for_studio_v4_render", blockers: [] },
    director_plan: {
      readiness: { status: "director_ready", blockers: [] },
      shot_plan: [
        { id: "hook", kind: "hook_slam", startS: 0, durationS: 2.4 },
        {
          id: "motion_a",
          kind: "motion_clip",
          startS: 0.35,
          durationS: 2.5,
          source_family: "steam",
          media_path: "C:/media/steam.mp4",
        },
        { id: "steam_chart", kind: "steam_chart", startS: 2.55, durationS: 3.4 },
        {
          id: "motion_b",
          kind: "motion_clip",
          startS: 5.2,
          durationS: 2.7,
          source_family: "xbox",
          media_path: "C:/media/xbox.mp4",
        },
        {
          id: "motion_a_repeat",
          kind: "motion_clip",
          startS: 8.2,
          durationS: 2.4,
          source_family: "steam",
          media_path: "C:/media/steam.mp4",
        },
      ],
      render_adjustments: {
        suppress_repeated_clip_windows: true,
      },
    },
  };
}

function motionPack() {
  return {
    readiness: { status: "v4_motion_ready" },
    clips: [
      {
        id: "steam_clip",
        source_family: "steam",
        path: "C:/media/steam.mp4",
        mediaStartS: 12.4,
        durationS: 3.1,
        validated: true,
        rights_risk_class: "steam_storefront_promotional_video",
      },
      {
        id: "xbox_clip",
        source_family: "xbox",
        path: "C:/media/xbox.mp4",
        mediaStartS: 6.2,
        durationS: 2.8,
        validated: true,
        rights_risk_class: "official_reference_only",
      },
    ],
  };
}

test("Studio V4 render bridge converts ready director motion shots into legacy video clips", () => {
  const bridge = buildStudioV4RenderBridge({
    story: {
      id: "forza-v4",
      studio_v4_canonical_packet: readyPacket(),
      visual_v4_motion_pack: motionPack(),
    },
    pathExists: (value) => value.endsWith(".mp4"),
  });

  assert.equal(bridge.execution_mode, "studio_v4_render_bridge");
  assert.equal(bridge.readiness.status, "bridge_ready");
  assert.equal(bridge.video_clips.length, 2);
  assert.deepEqual(
    bridge.video_clips.map((clip) => clip.source_family),
    ["steam", "xbox"],
  );
  assert.deepEqual(
    bridge.video_clips.map((clip) => clip.path),
    ["C:/media/steam.mp4", "C:/media/xbox.mp4"],
  );
  assert.equal(bridge.video_clips[0].mediaStartS, 12.4);
  assert.equal(bridge.video_clips[0].durationS, 2.5);
  assert.ok(
    bridge.rejected.some((item) => item.reason === "duplicate_source_family"),
  );
  assert.equal(bridge.safety.no_downloads_started, true);
});

test("Studio V4 render bridge blocks when the canonical packet is not ready", () => {
  const bridge = buildStudioV4RenderBridge({
    story: {
      id: "blocked",
      studio_v4_canonical_packet: {
        readiness: {
          status: "blocked",
          blockers: ["actual_motion_clip_minimum_not_met"],
        },
      },
      visual_v4_motion_pack: motionPack(),
    },
    pathExists: () => true,
  });

  assert.equal(bridge.readiness.status, "bridge_blocked");
  assert.ok(bridge.readiness.blockers.includes("canonical_packet_not_ready"));
  assert.equal(bridge.video_clips.length, 0);
});

test("Studio V4 render bridge rejects missing local clip paths instead of faking motion", () => {
  const bridge = buildStudioV4RenderBridge({
    story: {
      id: "missing",
      studio_v4_canonical_packet: readyPacket(),
      visual_v4_motion_pack: motionPack(),
    },
    pathExists: (value) => value.includes("steam"),
  });

  assert.equal(bridge.readiness.status, "bridge_ready");
  assert.deepEqual(
    bridge.video_clips.map((clip) => clip.source_family),
    ["steam"],
  );
  assert.ok(
    bridge.rejected.some((item) => item.reason === "clip_path_missing"),
  );
});

test("Studio V4 render bridge accepts validated direct media URLs without local path checks", () => {
  const bridge = buildStudioV4RenderBridge({
    story: {
      id: "direct-url",
      studio_v4_canonical_packet: {
        readiness: { status: "ready_for_studio_v4_render", blockers: [] },
        director_plan: {
          shot_plan: [
            {
              id: "motion_url",
              kind: "motion_clip",
              startS: 0.4,
              durationS: 2.4,
              source_family: "forza_horizon_official_x_fh6_integra_wtac_video",
            },
          ],
        },
      },
      visual_v4_motion_pack: {
        clips: [
          {
            id: "official_x_clip",
            source_family: "forza_horizon_official_x_fh6_integra_wtac_video",
            path: "https://video.twimg.com/amplify_video/2047677198685933568/vid/avc1/1280x720/qksvu_H_ODjUC4em.mp4?tag=14",
            mediaStartS: 6,
            durationS: 3,
            validated: true,
            rights_risk_class: "official_reference_only",
          },
        ],
      },
    },
    pathExists: () => false,
  });

  assert.equal(bridge.readiness.status, "bridge_ready");
  assert.equal(bridge.video_clips.length, 1);
  assert.equal(
    bridge.video_clips[0].source_family,
    "forza_horizon_official_x_fh6_integra_wtac_video",
  );
});

test("Studio V4 render bridge allows explicit non-repeated clips from the same source family", () => {
  const bridge = buildStudioV4RenderBridge({
    story: {
      id: "same-family-explicit",
      studio_v4_canonical_packet: {
        readiness: { status: "ready_for_studio_v4_render", blockers: [] },
        director_plan: {
          shot_plan: [
            {
              id: "motion_a",
              kind: "motion_clip",
              source_family: "steam",
              motion_pack_clip_id: "steam_clip_a",
            },
            {
              id: "motion_b",
              kind: "motion_clip",
              source_family: "steam",
              motion_pack_clip_id: "steam_clip_b",
            },
          ],
        },
      },
      visual_v4_motion_pack: {
        clips: [
          {
            id: "steam_clip_a",
            source_family: "steam",
            path: "C:/media/steam-a.mp4",
            mediaStartS: 12,
            durationS: 3,
          },
          {
            id: "steam_clip_b",
            source_family: "steam",
            path: "C:/media/steam-b.mp4",
            mediaStartS: 24,
            durationS: 3,
          },
        ],
      },
    },
    pathExists: () => true,
  });

  assert.equal(bridge.readiness.status, "bridge_ready");
  assert.equal(bridge.video_clips.length, 2);
  assert.deepEqual(
    bridge.video_clips.map((clip) => clip.path),
    ["C:/media/steam-a.mp4", "C:/media/steam-b.mp4"],
  );
});

test("Studio V4 render bridge applies clips and metadata onto the story", () => {
  const story = {
    id: "forza-v4",
    video_clips: ["C:/legacy/old.mp4"],
    studio_v4_canonical_packet: readyPacket(),
    visual_v4_motion_pack: motionPack(),
  };
  const bridge = buildStudioV4RenderBridge({
    story,
    pathExists: () => true,
  });

  applyStudioV4RenderBridgeToStory(story, bridge);

  assert.deepEqual(story.video_clips, ["C:/media/steam.mp4", "C:/media/xbox.mp4"]);
  assert.equal(story.render_lane, "studio_v4_director_bridge");
  assert.equal(story.visual_v4_render_bridge_status, "bridge_ready");
  assert.equal(story.visual_v4_render_bridge_clip_count, 2);
  assert.equal(story.visual_v4_render_bridge.video_clips.length, 2);
});

test("Studio V4 render bridge builds explicit rights records for bridged clips and local narration", () => {
  const story = {
    id: "forza-v4",
    audio_path: "C:/audio/forza-v4.mp3",
  };
  const bridge = {
    video_clips: [
      {
        id: "forza_motion_01",
        path: "C:/render-cache/forza_motion_01.mp4",
        source_url: "https://video.twimg.com/ext_tw_video/forza/vid/avc1/1280x720/clip.mp4",
        source_type: "official_direct_media_reference",
        source_family: "forza_horizon_official_x",
        rights_risk_class: "official_reference_only",
      },
    ],
  };

  const ledger = buildStudioV4BridgeRightsLedger({
    story,
    bridge,
    evidenceFile: "output/studio-v4/motion-packs/forza-v4_motion_pack_manifest.json",
  });

  assert.deepEqual(
    ledger.map((record) => record.asset_id),
    ["forza_motion_01", "forza-v4_audio_path"],
  );
  assert.equal(ledger[0].source_url, bridge.video_clips[0].source_url);
  assert.equal(ledger[0].licence_basis, "official_reference_transformative_short");
  assert.equal(ledger[0].allowed_platforms.includes("youtube"), true);
  assert.equal(ledger[0].commercial_use_allowed, true);
  assert.equal(ledger[1].source_type, "local_tts_voice");
  assert.equal(ledger[1].licence_basis, "owned_local_voice_model");
});
