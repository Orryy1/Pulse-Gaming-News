"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  officialMediaReferenceLanguageRisk,
  officialMediaReferenceRejectReason,
} = require("../../lib/official-media-reference-preflight");

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
