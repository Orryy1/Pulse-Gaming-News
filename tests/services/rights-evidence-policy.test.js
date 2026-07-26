"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isOfficialYoutubeMotionRightsRecord,
  isTransformativeRightsEvidenceKind,
  officialYoutubeTransformativeRightsBlockers,
  youtubeVideoIdFromUrl,
} = require("../../lib/rights-evidence-policy");

test("rights evidence policy recognises official YouTube motion identities", () => {
  const record = {
    kind: "video",
    source_type: "official_publisher_gameplay_clip",
    source_url: "https://www.youtube.com/watch?v=Q-oBTia5gKI",
  };

  assert.equal(youtubeVideoIdFromUrl(record.source_url), "Q-oBTia5gKI");
  assert.equal(isOfficialYoutubeMotionRightsRecord(record), true);
});

test("rights evidence policy rejects source-identity evidence as a commercial grant", () => {
  const blockers = officialYoutubeTransformativeRightsBlockers({
    kind: "video",
    source_type: "official_publisher_trailer_clip",
    source_url: "https://youtu.be/xdkm9TKSxyI",
    evidence_kind: "source_identity",
    transformative_rights_evidence_verified: false,
    source_identity_rights_grant: false,
    rights_grant: false,
  });

  assert.deepEqual(blockers, [
    "transformative_rights_policy_evidence_missing_or_unbound",
  ]);
});

test("rights evidence policy accepts an explicit hash-bound policy decision shape", () => {
  const record = {
    kind: "video",
    source_type: "official_youtube_channel",
    source_url: "https://www.youtube.com/watch?v=xdkm9TKSxyI",
    evidence_kind: "publisher_video_policy",
    transformative_rights_evidence_verified: true,
    rights_grant: true,
  };

  assert.equal(isTransformativeRightsEvidenceKind(record.evidence_kind), true);
  assert.deepEqual(officialYoutubeTransformativeRightsBlockers(record), []);
});

test("rights evidence policy accepts a verified bounded editorial exception without pretending it is a rights grant", () => {
  const record = {
    kind: "video",
    source_type: "official_publisher_gameplay_clip",
    source_url: "https://www.youtube.com/watch?v=xdkm9TKSxyI",
    evidence_kind: "bounded_editorial_excerpt_policy",
    transformative_rights_evidence_verified: true,
    legal_exception_reliance: true,
    rights_grant: undefined,
    live_publish_allowed: true,
    editorial_policy_acceptance: {
      accepted_by: "Pulse Gaming owner",
      accepted_at: "2026-07-26T18:00:00.000Z",
    },
  };

  assert.equal(isTransformativeRightsEvidenceKind(record.evidence_kind), true);
  assert.deepEqual(officialYoutubeTransformativeRightsBlockers(record), []);
  assert.equal(record.rights_grant, undefined);
});

test("rights evidence policy rejects an editorial exception that lacks owner acceptance or a live-publish decision", () => {
  const base = {
    kind: "video",
    source_type: "official_publisher_gameplay_clip",
    source_url: "https://www.youtube.com/watch?v=xdkm9TKSxyI",
    evidence_kind: "bounded_editorial_excerpt_policy",
    transformative_rights_evidence_verified: true,
    legal_exception_reliance: true,
    rights_grant: undefined,
  };

  assert.deepEqual(officialYoutubeTransformativeRightsBlockers(base), [
    "transformative_rights_policy_evidence_missing_or_unbound",
  ]);
  assert.deepEqual(
    officialYoutubeTransformativeRightsBlockers({
      ...base,
      live_publish_allowed: true,
      editorial_policy_acceptance: {
        accepted_by: "Pulse Gaming owner",
        accepted_at: "not-a-date",
      },
    }),
    ["transformative_rights_policy_evidence_missing_or_unbound"],
  );
});
