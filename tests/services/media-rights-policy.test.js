"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assessMediaRightsPackage,
} = require("../../lib/media-rights-policy");

const TARGETS = ["youtube_shorts", "instagram_reels", "facebook_reels"];
const POLICY_ACCEPTANCE = {
  editorial_exception_policy_accepted: true,
  accepted_by: "Pulse Gaming owner",
  accepted_at: "2026-07-23T10:00:00.000Z",
};

function editorialVideo(overrides = {}) {
  return {
    asset_id: "official-gameplay-window-01",
    asset_type: "video",
    path: "output/media/official-gameplay-window-01.mp4",
    source_url: "https://publisher.example/games/example/trailer",
    source_owner: "Example Publisher",
    source_title: "Example Game Official Trailer",
    rights_basis: "bounded_editorial_excerpt",
    official_source: true,
    publicly_released: true,
    lawfully_accessed: true,
    third_party_reupload: false,
    leaked_or_unreleased: false,
    contains_third_party_music: false,
    source_audio_removed: true,
    commentary_present: true,
    necessary_for_editorial_point: true,
    non_substitutive: true,
    transformation_notes:
      "A short silent extract is cut under original Pulse Gaming criticism and analysis.",
    editorial_purpose: "criticism_review",
    source_start_seconds: 12,
    source_end_seconds: 17,
    total_use_seconds: 5,
    timeline_start_seconds: 8,
    timeline_end_seconds: 13,
    ...overrides,
  };
}

test("attribution alone never creates a usable rights basis", () => {
  const report = assessMediaRightsPackage({
    story_id: "attribution-only",
    target_platforms: TARGETS,
    assets: [{
      asset_id: "unknown-repost",
      asset_type: "video",
      source_url: "https://social.example/repost/123",
      source_owner: "Unknown",
      on_screen_credit: "Footage: Unknown",
    }],
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.live_publish_allowed, false);
  assert.ok(report.blockers.includes("unknown-repost:rights_basis_missing"));
  assert.equal(report.rights_records.length, 0);
});

test("owned media produces a compact GREEN commercial-use record", () => {
  const report = assessMediaRightsPackage({
    story_id: "owned-media",
    target_platforms: TARGETS,
    assets: [{
      asset_id: "pulse-owned-card",
      asset_type: "video",
      path: "output/media/pulse-owned-card.mp4",
      rights_basis: "owned",
      source_owner: "Pulse Gaming",
      evidence_reference: "rights/pulse-owned-generation.json",
      commercial_use_allowed: true,
      allowed_platforms: TARGETS,
      transformation_notes: "Generated in-house for this story.",
    }],
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.live_publish_allowed, true);
  assert.equal(report.rights_records.length, 1);
  assert.equal(report.rights_records[0].approval_status, "approved");
  assert.equal(report.rights_records[0].licence_basis, "owned_by_pulse_gaming");
  assert.deepEqual(report.rights_records[0].allowed_platforms, TARGETS);
  assert.equal(report.attribution_manifest.entries.length, 0);
});

test("a direct licence is restricted to its declared commercial platform scope", () => {
  const report = assessMediaRightsPackage({
    story_id: "licensed-media",
    target_platforms: TARGETS,
    assets: [{
      asset_id: "licensed-clip",
      asset_type: "video",
      path: "output/media/licensed-clip.mp4",
      rights_basis: "direct_licence",
      source_owner: "Licensed Studio",
      source_url: "https://licensed.example/clip",
      evidence_reference: "rights/licensed-studio-agreement.pdf",
      commercial_use_allowed: true,
      allowed_platforms: ["youtube_shorts"],
      credit_required: true,
      timeline_start_seconds: 4,
      timeline_end_seconds: 9,
    }],
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.blockers.includes("licensed-clip:platform_scope_missing:instagram_reels"));
  assert.ok(report.blockers.includes("licensed-clip:platform_scope_missing:facebook_reels"));
});

test("publisher policy applies only to exact publisher-owned official material and platforms", () => {
  const report = assessMediaRightsPackage({
    story_id: "publisher-policy",
    target_platforms: ["youtube_shorts"],
    assets: [{
      asset_id: "publisher-owned-trailer",
      asset_type: "video",
      path: "output/media/publisher-owned-trailer.mp4",
      rights_basis: "publisher_policy",
      source_url: "https://publisher.example/example-game/trailer",
      source_owner: "Example Publisher",
      source_title: "Example Game Official Trailer",
      official_source: true,
      publisher_owns_material: true,
      policy_terms_verified: true,
      policy_name: "Example Publisher Video Policy",
      evidence_reference: "rights/example-publisher-policy.html",
      commercial_use_allowed: true,
      allowed_platforms: ["youtube_shorts"],
      source_audio_removed: true,
      contains_third_party_music: false,
      transformation_notes: "Short extracts used under original commentary.",
      credit_required: true,
      required_public_notice: "Created using Example Publisher material under its video policy.",
      timeline_start_seconds: 2,
      timeline_end_seconds: 7,
    }],
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.rights_records.length, 1);
  assert.equal(report.rights_records[0].evidence_kind, "publisher_policy");
  assert.equal(report.attribution_manifest.entries[0].display_text, "Footage: Example Publisher");
  assert.match(
    report.attribution_manifest.description_lines[0],
    /Created using Example Publisher material/,
  );
});

test("a bounded silent official excerpt becomes GREEN after one policy acceptance", () => {
  const report = assessMediaRightsPackage({
    story_id: "editorial-excerpt",
    target_platforms: TARGETS,
    policy_acceptance: POLICY_ACCEPTANCE,
    assets: [editorialVideo()],
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.live_publish_allowed, true);
  assert.equal(report.rights_records.length, 1);
  assert.equal(
    report.rights_records[0].licence_basis,
    "uk_fair_dealing_criticism_review_bounded_excerpt",
  );
  assert.equal(report.rights_records[0].legal_exception_reliance, true);
  assert.equal(report.rights_records[0].commercial_use_allowed, true);
  assert.equal(report.attribution_manifest.entries[0].display_text, "Footage: Example Publisher");
  assert.deepEqual(
    report.attribution_manifest.entries[0].timeline,
    { start_seconds: 8, end_seconds: 13 },
  );
});

test("a compliant editorial excerpt remains AMBER until the owner accepts the policy once", () => {
  const report = assessMediaRightsPackage({
    story_id: "editorial-awaiting-policy",
    target_platforms: TARGETS,
    assets: [editorialVideo()],
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.live_publish_allowed, false);
  assert.ok(
    report.blockers.includes(
      "official-gameplay-window-01:editorial_exception_policy_acceptance_missing",
    ),
  );
  assert.equal(report.rights_records[0].live_publish_allowed, false);
  assert.equal(
    report.rights_records[0].requires_human_review_before_live_publish,
    true,
  );
});

test("editorial guardrails block long excerpts, source audio, music, leaks and reposts", () => {
  const report = assessMediaRightsPackage({
    story_id: "unsafe-excerpts",
    target_platforms: ["youtube_shorts"],
    policy_acceptance: POLICY_ACCEPTANCE,
    assets: [
      editorialVideo({
        asset_id: "long-window",
        source_end_seconds: 20,
        total_use_seconds: 8,
      }),
      editorialVideo({
        asset_id: "source-audio",
        source_audio_removed: false,
      }),
      editorialVideo({
        asset_id: "music",
        contains_third_party_music: true,
      }),
      editorialVideo({
        asset_id: "leak",
        publicly_released: false,
        leaked_or_unreleased: true,
      }),
      editorialVideo({
        asset_id: "repost",
        official_source: false,
        third_party_reupload: true,
      }),
    ],
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.blockers.includes("long-window:continuous_excerpt_over_internal_guardrail"));
  assert.ok(report.blockers.includes("source-audio:source_audio_not_removed"));
  assert.ok(report.blockers.includes("music:third_party_music_present"));
  assert.ok(report.blockers.includes("leak:leaked_or_unreleased_media"));
  assert.ok(report.blockers.includes("repost:third_party_reupload_not_permitted"));
});

test("current-events reporting alone does not auto-approve a third-party photograph", () => {
  const report = assessMediaRightsPackage({
    story_id: "current-events-photo",
    target_platforms: ["youtube_shorts"],
    policy_acceptance: POLICY_ACCEPTANCE,
    assets: [editorialVideo({
      asset_id: "news-photo",
      asset_type: "photograph",
      editorial_purpose: "current_events_reporting",
      source_start_seconds: undefined,
      source_end_seconds: undefined,
      display_seconds: 4,
      total_use_seconds: 4,
    })],
  });

  assert.equal(report.verdict, "RED");
  assert.ok(
    report.blockers.includes(
      "news-photo:current_events_photograph_requires_separate_basis",
    ),
  );
});

