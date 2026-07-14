"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCampaignInputFromArtefacts,
  enrichMaterialisedClipsWithRights,
  scoreHeroFrameStats,
  selectOfficialHeroClip,
} = require("../../tools/premium-visual-campaign-engine");

test("premium visual CLI resolves governed native copy", () => {
  const input = buildCampaignInputFromArtefacts({
    canonical: {
      story_id: "story-one",
      canonical_subject: "The Elder Scrolls Online",
      selected_title: "The Elder Scrolls Online Has A Paid Catch",
      thumbnail_headline: "ELDER SCROLLS: FREE OR PAID?",
      primary_source: "Xbox Wire",
      canonical_angle: "source_locked_update",
    },
    instagram: {
      cover_frame: {
        headline: "ESO: FREE OR PAID?",
        subject: "The Elder Scrolls Online",
        source_label: "Xbox Wire",
      },
      story_poll_idea: "Free track or paid upgrade?",
    },
  });

  assert.equal(input.story_id, "story-one");
  assert.equal(input.headline, "ESO: FREE OR PAID?");
  assert.equal(input.source_label, "Xbox Wire");
  assert.equal(input.story_prompt, "FREE TRACK OR PAID UPGRADE?");
});

test("premium visual CLI rewards sharp, detailed, well-exposed hero frames", () => {
  const sharp = scoreHeroFrameStats({ sharpness: 12, entropy: 6.4, channels: [{ mean: 92 }, { mean: 86 }, { mean: 78 }] });
  const blurry = scoreHeroFrameStats({ sharpness: 2, entropy: 3.1, channels: [{ mean: 95 }, { mean: 90 }, { mean: 85 }] });
  const black = scoreHeroFrameStats({ sharpness: 14, entropy: 5.8, channels: [{ mean: 8 }, { mean: 7 }, { mean: 6 }] });

  assert.ok(sharp.score > blurry.score);
  assert.equal(black.eligible, false);
  assert.ok(black.reasons.includes("hero_frame_too_dark"));
});

test("premium visual CLI rejects baked-caption hero frames", () => {
  const report = scoreHeroFrameStats(
    { sharpness: 12, entropy: 6.4, channels: [{ mean: 92 }, { mean: 86 }, { mean: 78 }] },
    {
      text_overlay_likelihood: 0.4,
      trailer_frame_taste: { verdict: "pass", tags: ["detail_rich", "text_heavy"] },
    },
  );

  assert.equal(report.eligible, false);
  assert.ok(report.reasons.includes("hero_frame_baked_caption_risk"));
});

test("premium visual CLI joins materialised clips to explicit rights records", () => {
  const materialised = {
    clips: [{ path: "C:/proof/official.mp4", media_kind: "direct_video" }],
  };
  const rightsLedger = {
    records: [{
      path: "C:\\proof\\official.mp4",
      source_type: "official_youtube_channel",
      licence_basis: "official_direct_media",
      approval_status: "approved_for_transformative_editorial_use",
      commercial_use_allowed: true,
    }],
  };

  const joined = enrichMaterialisedClipsWithRights(materialised, rightsLedger);
  assert.equal(joined.clips[0].source_type, "official_youtube_channel");
  assert.equal(joined.clips[0].rights_basis, "official_direct_media");
  assert.equal(selectOfficialHeroClip(joined).path, "C:/proof/official.mp4");
});

test("premium visual CLI selects only official direct motion for frame extraction", () => {
  const clip = selectOfficialHeroClip({
    clips: [
      { path: "generated.mp4", source_type: "internally_generated_motion_graphic", rights_basis: "owned" },
      { path: "source-card.mp4", source_type: "hyperframes_premium_shell_card", rights_basis: "official_direct_media" },
      { path: "official.mp4", source_type: "steam_movie", media_kind: "direct_video", rights_basis: "official_direct_media", duration_s: 5 },
    ],
  });

  assert.equal(clip.path, "official.mp4");
});
