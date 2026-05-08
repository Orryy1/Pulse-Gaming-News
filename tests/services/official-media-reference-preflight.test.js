"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  officialMediaReferenceLanguageRisk,
  officialMediaReferenceRejectReason,
} = require("../../lib/official-media-reference-preflight");
const {
  classifyMediaSourceUrl,
} = require("../../lib/media-source-url-kind");

test("official media reference preflight rejects localised non-English trailer markers", () => {
  assert.equal(
    officialMediaReferenceRejectReason({ movie_name: "RDR2 60 FPS Trailer (DE)" }),
    "localised_non_english_reference",
  );
  assert.equal(
    officialMediaReferenceLanguageRisk({ reference_title: "Red Dead Redemption 2 German Trailer" }),
    "localised_non_english_reference",
  );
});

test("official media reference preflight rejects embedded subtitle references", () => {
  assert.equal(
    officialMediaReferenceRejectReason({ movie_name: "BioShock Infinite Launch Trailer Subtitles" }),
    "embedded_subtitle_reference",
  );
});

test("official media reference preflight does not treat game-title words as language markers", () => {
  assert.equal(
    officialMediaReferenceRejectReason({ movie_name: "Red Dead Redemption 2 Definitive Edition Trailer" }),
    null,
  );
  assert.equal(
    officialMediaReferenceRejectReason({ movie_name: "Grand Theft Auto V Enhanced Gameplay Trailer" }),
    null,
  );
});

test("media source URL kind allows only direct video or manifest URLs for segment validation", () => {
  assert.deepEqual(classifyMediaSourceUrl("https://video.example/trailer.mp4?token=1"), {
    source_url_kind: "direct_video",
    segment_validation_eligible: true,
    segment_validation_ineligible_reason: null,
  });
  assert.deepEqual(classifyMediaSourceUrl("https://video.example/hls_264_master.m3u8"), {
    source_url_kind: "hls_manifest",
    segment_validation_eligible: true,
    segment_validation_ineligible_reason: null,
  });
  assert.equal(classifyMediaSourceUrl("https://youtu.be/abc123").source_url_kind, "youtube_watch");
  assert.equal(
    classifyMediaSourceUrl("https://www.youtube.com/shorts/abc123").segment_validation_ineligible_reason,
    "segment_source_is_youtube_reference",
  );
  assert.equal(
    classifyMediaSourceUrl("https://www.rockstargames.com/reddeadredemption2/videos").source_url_kind,
    "html_or_unknown_page",
  );
  assert.equal(
    classifyMediaSourceUrl("https://cdn.example/key-art.jpg").segment_validation_ineligible_reason,
    "segment_source_is_image_reference",
  );
});
