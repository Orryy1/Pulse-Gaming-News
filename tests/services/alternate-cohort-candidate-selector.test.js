"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectAlternateCohortCandidates,
} = require("../../lib/ops/alternate-cohort-candidate-selector");

function eligibleCandidate(overrides = {}) {
  return {
    story_id: "review-local-a",
    title: "A Fresh Local Promotion Candidate",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    local_promotion_intake_only: true,
    source_age_state: "fresh",
    source_age_hours: 4,
    source_age_policy_hours: 168,
    direct_media_candidates: [
      {
        label: "Forza Horizon 6 gameplay",
        source_family: "forza_horizon_6_gameplay",
        direct_media_url:
          "https://cdn.example.com/forza-horizon-6/gameplay.mp4",
        source_type: "official_direct_media",
      },
    ],
    rights_eligibility: {
      eligible: true,
      status: "eligible",
      basis: "owned_or_licensed",
    },
    motion_eligibility: {
      eligible: true,
      status: "eligible",
      family_count: 3,
    },
    ...overrides,
  };
}

test("alternate cohort selection excludes attempted IDs and never relabels a same-RSS retry", () => {
  const report = selectAlternateCohortCandidates({
    primaryAttemptedStoryIds: ["primary-rss-a"],
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "primary-rss-a",
        title: "The Same Attempted Story",
      }),
      eligibleCandidate({
        story_id: "rss-retry-copy",
        title: "The Same RSS Retry Under Another ID",
        local_promotion_intake_only: false,
        cohort_origin: "same_rss_retry",
        retry_of_story_id: "primary-rss-a",
      }),
      eligibleCandidate(),
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.deepEqual(
    report.candidates.map((candidate) => candidate.story_id),
    ["review-local-a"],
  );
  assert.deepEqual(
    report.excluded.map((candidate) => ({
      story_id: candidate.story_id,
      reason_codes: candidate.reason_codes,
    })),
    [
      {
        story_id: "primary-rss-a",
        reason_codes: ["primary_attempted_story_id"],
      },
      {
        story_id: "rss-retry-copy",
        reason_codes: ["not_alternate_cohort:same_rss_retry"],
      },
    ],
  );
  assert.equal(report.summary.selected_count, 1);
  assert.equal(report.summary.same_rss_retry_count, 1);
  assert.equal(report.safety.publish_authorised, false);
});

test("alternate cohort selection excludes active story and source quarantine entries", () => {
  const quarantinedSource = eligibleCandidate({
    story_id: "quarantined-source-original",
    source_url: "https://example.com/quarantined-source",
  });
  const report = selectAlternateCohortCandidates({
    excludedStoryIds: ["quarantined-story"],
    excludedSourceFingerprints: [
      require("../../lib/refill-zero-yield-quarantine")
        .buildSourceFingerprint(quarantinedSource),
    ],
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "quarantined-story",
        source_url: "https://example.com/another-source",
      }),
      eligibleCandidate({
        story_id: "same-source-new-id",
        source_url: quarantinedSource.source_url,
      }),
      eligibleCandidate({
        story_id: "clean-alternate",
        source_url: "https://example.com/clean-alternate",
      }),
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.deepEqual(
    report.candidates.map((candidate) => candidate.story_id),
    ["clean-alternate"],
  );
  assert.deepEqual(
    report.excluded.map((candidate) => ({
      story_id: candidate.story_id,
      reason_codes: candidate.reason_codes,
    })),
    [
      {
        story_id: "quarantined-story",
        reason_codes: ["zero_yield_quarantine:story_id"],
      },
      {
        story_id: "same-source-new-id",
        reason_codes: ["zero_yield_quarantine:source"],
      },
    ],
  );
});

test("alternate cohort selection rejects stale review candidates", () => {
  const report = selectAlternateCohortCandidates({
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "stale-review",
        source_age_state: "expired",
        source_age_hours: 190,
      }),
      eligibleCandidate(),
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.deepEqual(
    report.candidates.map((candidate) => candidate.story_id),
    ["review-local-a"],
  );
  assert.deepEqual(report.excluded, [
    {
      story_id: "stale-review",
      reason_codes: ["source_age_expired"],
    },
  ]);
});

test("alternate cohort selection rejects blocked candidates and preserves eligibility metadata", () => {
  const selected = eligibleCandidate();
  const report = selectAlternateCohortCandidates({
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "blocked-upstream",
        blockers: ["transcript:coherence_red"],
      }),
      eligibleCandidate({
        story_id: "rights-blocked",
        rights_eligibility: {
          eligible: false,
          status: "blocked",
          blockers: ["commercial_reuse_permission_missing"],
        },
      }),
      eligibleCandidate({
        story_id: "motion-blocked",
        motion_eligibility: {
          eligible: false,
          status: "blocked",
          blockers: ["distinct_motion_families_missing"],
        },
      }),
      selected,
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.equal(report.candidates.length, 1);
  assert.deepEqual(report.candidates[0].rights_eligibility, selected.rights_eligibility);
  assert.deepEqual(report.candidates[0].motion_eligibility, selected.motion_eligibility);
  assert.equal(report.candidates[0].source_age_state, selected.source_age_state);
  assert.equal(report.candidates[0].source_age_hours, selected.source_age_hours);
  assert.equal(report.candidates[0].source_age_policy_hours, selected.source_age_policy_hours);
  assert.deepEqual(
    report.excluded.map((candidate) => ({
      story_id: candidate.story_id,
      reason_codes: candidate.reason_codes,
      blockers: candidate.blockers,
    })),
    [
      {
        story_id: "blocked-upstream",
        reason_codes: ["candidate_blocked"],
        blockers: ["transcript:coherence_red"],
      },
      {
        story_id: "motion-blocked",
        reason_codes: ["motion_ineligible"],
        blockers: ["distinct_motion_families_missing"],
      },
      {
        story_id: "rights-blocked",
        reason_codes: ["rights_ineligible"],
        blockers: ["commercial_reuse_permission_missing"],
      },
    ],
  );
});

test("alternate cohort selection deterministically removes duplicate candidates", () => {
  const report = selectAlternateCohortCandidates({
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "source-duplicate-z",
        source_url: "https://example.com/current-story",
      }),
      eligibleCandidate({
        story_id: "source-canonical-a",
        source_url: "https://example.com/current-story",
      }),
      eligibleCandidate({
        story_id: "explicit-duplicate",
        duplicate_of_story_id: "source-canonical-a",
        source_url: "https://example.com/second-url",
      }),
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.deepEqual(
    report.candidates.map((candidate) => candidate.story_id),
    ["source-canonical-a"],
  );
  assert.deepEqual(report.excluded, [
    {
      story_id: "explicit-duplicate",
      reason_codes: ["duplicate_candidate:explicit"],
      duplicate_of_story_id: "source-canonical-a",
    },
    {
      story_id: "source-duplicate-z",
      reason_codes: ["duplicate_candidate:source_url"],
      duplicate_of_story_id: "source-canonical-a",
    },
  ]);
});

test("alternate cohort selection is capped at six with stable order and fingerprint", () => {
  const candidates = Array.from({ length: 8 }, (_, index) =>
    eligibleCandidate({
      story_id: `review-${index + 1}`,
      title: `Review candidate ${index + 1}`,
      source_age_hours: index + 1,
      source_url: `https://example.com/review-${index + 1}`,
    }));
  const first = selectAlternateCohortCandidates({
    primaryAttemptedStoryIds: ["primary-z", "primary-a"],
    reviewLocalPromotionCandidates: [
      candidates[6],
      candidates[2],
      candidates[7],
      candidates[0],
      candidates[5],
      candidates[3],
      candidates[1],
      candidates[4],
    ],
    maxCandidates: 99,
    now: new Date("2026-07-17T04:00:00.000Z"),
  });
  const second = selectAlternateCohortCandidates({
    primaryAttemptedStoryIds: ["primary-a", "primary-z"],
    reviewLocalPromotionCandidates: [...candidates].reverse(),
    maxCandidates: 6,
    now: new Date("2026-07-17T05:00:00.000Z"),
  });

  assert.deepEqual(
    first.candidates.map((candidate) => candidate.story_id),
    ["review-1", "review-2", "review-3", "review-4", "review-5", "review-6"],
  );
  assert.deepEqual(
    first.excluded.map((candidate) => ({
      story_id: candidate.story_id,
      reason_codes: candidate.reason_codes,
    })),
    [
      {
        story_id: "review-7",
        reason_codes: ["selection_limit_exceeded"],
      },
      {
        story_id: "review-8",
        reason_codes: ["selection_limit_exceeded"],
      },
    ],
  );
  assert.equal(first.summary.selection_limit, 6);
  assert.equal(first.summary.selected_count, 6);
  assert.match(first.selection_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.stable_fingerprint, first.selection_fingerprint);
  assert.equal(first.selection_fingerprint, second.selection_fingerprint);
  assert.deepEqual(
    first.candidates.map((candidate) => candidate.story_id),
    second.candidates.map((candidate) => candidate.story_id),
  );
});

test("alternate cohort selection derives source age and emits normalised eligibility evidence", () => {
  const report = selectAlternateCohortCandidates({
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "current-review",
        local_promotion_intake_only: false,
        review_candidate: true,
        source_age_state: undefined,
        source_age_hours: undefined,
        source_published_at: "2026-07-16T04:00:00.000Z",
      }),
      eligibleCandidate({
        story_id: "stale-review-from-date",
        local_promotion_intake_only: false,
        review_candidate: true,
        source_age_state: undefined,
        source_age_hours: undefined,
        source_published_at: "2026-07-09T03:00:00.000Z",
      }),
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.deepEqual(
    report.candidates.map((candidate) => candidate.story_id),
    ["current-review"],
  );
  assert.deepEqual(report.candidates[0].alternate_cohort_eligibility, {
    source_age: {
      state: "fresh",
      age_hours: 24,
      policy_hours: 168,
      eligible: true,
    },
    rights: report.candidates[0].rights_eligibility,
    motion: report.candidates[0].motion_eligibility,
    source_to_motion: report.candidates[0].source_motion_coherence,
  });
  assert.deepEqual(report.excluded, [
    {
      story_id: "stale-review-from-date",
      reason_codes: ["source_age_expired"],
    },
  ]);
});

test("alternate cohort selection rejects an unrelated direct-media family with subject evidence", () => {
  const report = selectAlternateCohortCandidates({
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "gta-with-marvel-media",
        title: "GTA 6 Has A New Release Detail",
        canonical_subject: "Grand Theft Auto VI",
        canonical_game: "Grand Theft Auto VI",
        direct_media_candidates: [
          {
            label: "MARVEL Tokon Fighting Souls gameplay",
            source_family: "playstation_marvel_tokon_gameplay",
            direct_media_url:
              "https://media.playstation.example/marvel-tokon/gameplay.mp4",
            source_type: "official_direct_media",
          },
        ],
      }),
      eligibleCandidate({
        story_id: "gta-with-gta-media",
        title: "GTA 6 Has A New Release Detail",
        canonical_subject: "Grand Theft Auto VI",
        canonical_game: "Grand Theft Auto VI",
        direct_media_candidates: [
          {
            label: "Grand Theft Auto VI Trailer 2",
            source_family: "rockstar_gta_vi_trailer_2",
            direct_media_url:
              "https://media.rockstargames.com/VI/GTAVI_Trailer_2.mp4",
            source_type: "official_direct_media",
          },
        ],
      }),
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.deepEqual(
    report.candidates.map((candidate) => candidate.story_id),
    ["gta-with-gta-media"],
  );
  assert.deepEqual(report.excluded, [
    {
      story_id: "gta-with-marvel-media",
      reason_codes: ["source_motion_coherence:unrelated_media"],
      source_motion_coherence: {
        status: "blocked",
        subject_values: ["Grand Theft Auto VI"],
        direct_media_count: 1,
        matched_media_count: 0,
        unrelated_media_count: 1,
        unproven_media_count: 0,
        story_identity_conflicts: [],
        media_evidence: [
          {
            label: "MARVEL Tokon Fighting Souls gameplay",
            source_family: "playstation_marvel_tokon_gameplay",
            direct_media_url:
              "https://media.playstation.example/marvel-tokon/gameplay.mp4",
            verdict: "unrelated",
            matched_subject: null,
            identity_tokens: ["marvel", "tokon", "fighting", "souls"],
          },
        ],
        rights_inference: "not_assessed",
        host_or_official_status_used_as_proof: false,
      },
    },
  ]);
});

test("alternate cohort selection rejects cross-title contamination inside direct media", () => {
  const report = selectAlternateCohortCandidates({
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "gta-cross-title-media",
        title: "GTA 6 Trailer Timing Changes",
        canonical_subject: "Grand Theft Auto VI",
        canonical_game: "Grand Theft Auto VI",
        direct_media_candidates: [
          {
            label: "Grand Theft Auto VI Trailer 2",
            source_family: "rockstar_gta_vi_trailer_2",
            direct_media_url:
              "https://media.rockstargames.com/VI/GTAVI_Trailer_2.mp4",
          },
          {
            label: "MARVEL Tokon roster reveal",
            source_family: "playstation_marvel_tokon_roster_reveal",
            direct_media_url:
              "https://cdn.playstation.example/marvel-tokon/roster.mp4",
          },
        ],
      }),
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.deepEqual(report.candidates, []);
  assert.equal(
    report.excluded[0].reason_codes[0],
    "source_motion_coherence:cross_title_contamination",
  );
  assert.equal(
    report.excluded[0].source_motion_coherence.matched_media_count,
    1,
  );
  assert.equal(
    report.excluded[0].source_motion_coherence.unrelated_media_count,
    1,
  );
  assert.deepEqual(
    report.excluded[0].source_motion_coherence.media_evidence.map(
      (item) => item.verdict,
    ),
    ["matched", "unrelated"],
  );
});

test("alternate cohort selection preserves rich identity when a scalar URL duplicates direct media", () => {
  const directMediaUrl =
    "https://blog.playstation.com/uploads/2028/07/87805ad10edbcfdafebbd99f155a3cb0f88f09d1.mp4";
  const report = selectAlternateCohortCandidates({
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "castlevania-opaque-rss-media",
        title: "Castlevania: Belmont's Curse Hands-on Report",
        canonical_subject: "Castlevania: Belmont's Curse",
        canonical_game: "Castlevania: Belmont's Curse",
        approved_direct_media_url: directMediaUrl,
        direct_media_candidates: [
          {
            label: "Castlevania: Belmont's Curse Hands-on Report",
            title: "Castlevania: Belmont's Curse Hands-on Report",
            canonical_subject: "Castlevania: Belmont's Curse",
            canonical_game: "Castlevania: Belmont's Curse",
            source_family:
              "rss_video_enclosure_playstation_blog_castlevania_belmont_s_curse",
            direct_media_url: directMediaUrl,
            source_type: "rss_video_enclosure",
          },
        ],
      }),
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.deepEqual(
    report.candidates.map((candidate) => candidate.story_id),
    ["castlevania-opaque-rss-media"],
  );
  assert.equal(
    report.candidates[0].source_motion_coherence.matched_media_count,
    1,
  );
  assert.equal(
    report.candidates[0].source_motion_coherence.unrelated_media_count,
    0,
  );
});

test("alternate cohort selection fails closed when direct media cannot prove a subject match", () => {
  const report = selectAlternateCohortCandidates({
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "opaque-official-media",
        title: "GTA 6 Has A New Release Detail",
        canonical_subject: "Grand Theft Auto VI",
        canonical_game: "Grand Theft Auto VI",
        direct_media_candidates: [
          {
            label: "Official launch trailer",
            source_family: "official_launch_trailer",
            direct_media_url:
              "https://media.rockstargames.com/assets/8f31d1c0.mp4",
            source_type: "official_game_website_media_page",
            official: true,
          },
        ],
      }),
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.deepEqual(report.candidates, []);
  assert.equal(
    report.excluded[0].reason_codes[0],
    "source_motion_coherence:subject_match_unproven",
  );
  assert.equal(
    report.excluded[0].source_motion_coherence.unproven_media_count,
    1,
  );
  assert.equal(
    report.excluded[0].source_motion_coherence.rights_inference,
    "not_assessed",
  );
  assert.equal(
    report.excluded[0].source_motion_coherence
      .host_or_official_status_used_as_proof,
    false,
  );
});

test("alternate cohort selection fails closed when identity, freshness or provenance is unproven", () => {
  const report = selectAlternateCohortCandidates({
    reviewLocalPromotionCandidates: [
      eligibleCandidate({
        story_id: "",
      }),
      eligibleCandidate({
        story_id: "unknown-age",
        source_age_state: undefined,
        source_age_hours: undefined,
      }),
      eligibleCandidate({
        story_id: "missing-provenance",
        local_promotion_intake_only: false,
      }),
    ],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.deepEqual(report.candidates, []);
  assert.deepEqual(report.excluded, [
    {
      story_id: "",
      reason_codes: ["candidate_identity_missing"],
    },
    {
      story_id: "missing-provenance",
      reason_codes: [
        "not_alternate_cohort:review_local_promotion_provenance_missing",
      ],
    },
    {
      story_id: "unknown-age",
      reason_codes: ["source_age_unknown"],
    },
  ]);
});
