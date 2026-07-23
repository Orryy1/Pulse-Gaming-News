"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const {
  SHORTS_COVER_DURATION_S,
  SHORTS_COVER_SELECTION_AT_S,
  resolveYouTubeShortsCoverFrame,
} = require("../../lib/youtube-shorts-cover-frame");

async function writeCampaign(root, {
  storyId = "xbox-classics",
  headline = "4 XBOX CLASSICS HIT PC",
  width = 1080,
  height = 1920,
  verdict = "green",
} = {}) {
  const artifactDir = path.join(root, "artifact");
  const campaignDir = path.join(artifactDir, "premium_visual_campaign");
  const coverPath = path.join(campaignDir, `${storyId}_youtube_shorts_cover.png`);
  await fs.ensureDir(campaignDir);
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#101827",
    },
  }).png().toFile(coverPath);
  const manifestPath = path.join(campaignDir, "premium_visual_campaign_manifest.json");
  await fs.writeJson(manifestPath, {
    schema_version: 1,
    story_id: storyId,
    headline,
    verdict,
    provenance: {
      hero_sha256: "a".repeat(64),
      hero_source: "governed_parent_visual",
      derived_asset_only: true,
    },
    outputs: {
      youtube_shorts_cover: {
        platform: "youtube_shorts_cover",
        width,
        height,
        headline,
        static_path: coverPath,
      },
    },
  }, { spaces: 2 });
  return { artifactDir, coverPath, manifestPath };
}

test("YouTube Shorts cover resolver binds a governed 9:16 campaign card to a selectable in-video frame", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-youtube-cover-"));
  t.after(() => fs.remove(root));
  const fixture = await writeCampaign(root);

  const result = await resolveYouTubeShortsCoverFrame({
    artifactDir: fixture.artifactDir,
    workspaceRoot: root,
    storyId: "xbox-classics",
    expectedHeadline: "4 Xbox Classics Hit PC",
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.cover_frame_path, fixture.coverPath);
  assert.match(result.cover_frame_sha256, /^[a-f0-9]{64}$/);
  assert.match(result.campaign_manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.embed_start_s, 0);
  assert.equal(result.embed_duration_s, SHORTS_COVER_DURATION_S);
  assert.equal(result.mobile_selection_at_s, SHORTS_COVER_SELECTION_AT_S);
  assert.equal(result.youtube_custom_image_thumbnail_supported, false);
  assert.equal(result.youtube_mobile_frame_selection_required, true);
  assert.equal(result.parent_visual_rights_required, true);
});

test("YouTube Shorts cover resolver blocks stale copy, wrong dimensions and non-green campaign evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-youtube-cover-blocked-"));
  t.after(() => fs.remove(root));
  const fixture = await writeCampaign(root, {
    headline: "OLD STORY COPY",
    width: 720,
    height: 1280,
    verdict: "amber",
  });

  const result = await resolveYouTubeShortsCoverFrame({
    artifactDir: fixture.artifactDir,
    workspaceRoot: root,
    storyId: "xbox-classics",
    expectedHeadline: "4 Xbox Classics Hit PC",
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("youtube_shorts_cover_campaign_not_green"));
  assert.ok(result.blockers.includes("youtube_shorts_cover_headline_stale"));
  assert.ok(result.blockers.includes("youtube_shorts_cover_dimensions_invalid"));
});
