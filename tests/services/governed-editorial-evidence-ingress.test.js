"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  EDITORIAL_EVIDENCE_JOB_KIND,
  enqueueGovernedEditorialEvidence,
  selectGovernedEditorialEvidenceBackfill,
} = require("../../lib/services/governed-editorial-evidence-ingress");

const NOW = "2026-07-28T14:05:00.000Z";

function story(overrides = {}) {
  return {
    id: "rss-xbox-classics",
    title: "Four Xbox classics arrive on PC with achievements planned",
    article_url:
      "https://news.xbox.com/en-us/2026/07/28/xbox-classics-on-pc/",
    source_type: "rss",
    subreddit: "Xbox Wire",
    timestamp: "2026-07-28T13:30:00.000Z",
    channel_id: "pulse-gaming",
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    story_id: "rss-xbox-classics",
    channel_id: "pulse-gaming",
    decision: "review",
    total: 82,
    hard_stops: [],
    inputs: {
      topicality_decision: "accept",
      topicality_category: "gaming",
    },
    scored_at: "2026-07-28T13:45:00.000Z",
    scorer_version: "v1.0",
    ...overrides,
  };
}

test("current governed gaming review enters distinct editorial evidence discovery without breaking or publish authority", () => {
  const queued = [];
  const result = enqueueGovernedEditorialEvidence({
    story: story({ breaking_score: 55 }),
    latestDecision: decision(),
    jobs: {
      enqueue(request) {
        queued.push(request);
        return { id: 901, ...request };
      },
    },
    now: NOW,
  });

  assert.equal(result.queued, true);
  assert.equal(result.job.id, 901);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, EDITORIAL_EVIDENCE_JOB_KIND);
  assert.equal(
    queued[0].kind,
    "governed_editorial_evidence_discovery",
  );
  assert.match(
    queued[0].idempotency_key,
    /^governed-editorial-evidence:rss-xbox-classics:[a-f0-9]{64}$/,
  );
  assert.equal(
    queued[0].payload.scope,
    "governed_editorial_inventory_supply",
  );
  assert.equal(queued[0].payload.story.id, "rss-xbox-classics");
  assert.equal(queued[0].payload.publish_authority, false);
  assert.equal(queued[0].payload.external_posting_authorised, false);
  assert.equal(queued[0].payload.oauth_mutation_authorised, false);
  assert.equal(queued[0].payload.human_review_required, true);
  assert.equal(
    Object.hasOwn(queued[0].payload.story, "breaking_score"),
    false,
  );
  assert.equal(
    Object.hasOwn(queued[0].payload, "breaking_story_id"),
    false,
  );
});

test("an editorial evidence idempotency conflict is a safe already-scheduled no-op", () => {
  let enqueueCalls = 0;
  const result = enqueueGovernedEditorialEvidence({
    story: story(),
    latestDecision: decision(),
    jobs: {
      enqueue() {
        enqueueCalls += 1;
        throw new Error("job_idempotency_conflict");
      },
    },
    now: NOW,
  });

  assert.equal(enqueueCalls, 1);
  assert.equal(result.queued, false);
  assert.equal(
    result.reason,
    "governed_editorial_evidence_already_scheduled",
  );
  assert.equal(result.job, null);
  assert.match(result.fingerprint_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.assessment.eligible, true);
  assert.equal(
    result.assessment.safety.publish_authority_created,
    false,
  );
  assert.equal(
    result.assessment.safety.external_posting_authorised,
    false,
  );
  assert.equal(
    result.assessment.safety.oauth_mutation_authorised,
    false,
  );
});

test("stale, off-topic, rejected, hard-stopped or malformed governed decisions stay out of editorial evidence discovery", () => {
  const cases = [
    {
      label: "stale",
      story: story({ timestamp: "2026-07-20T13:30:00.000Z" }),
      decision: decision(),
      blocker: "editorial_story_outside_current_window",
    },
    {
      label: "off-topic",
      story: story(),
      decision: decision({
        inputs: {
          topicality_decision: "reject",
          topicality_reason: "off_topic_entertainment",
        },
      }),
      blocker: "governed_gaming_topicality_acceptance_required",
    },
    {
      label: "rejected",
      story: story(),
      decision: decision({ decision: "reject" }),
      blocker: "governed_decision_auto_or_review_required",
    },
    {
      label: "hard-stopped",
      story: story(),
      decision: decision({
        hard_stops: ["advertiser_unfriendly_language"],
      }),
      blocker: "governed_decision_hard_stops_must_be_clear",
    },
    {
      label: "malformed hard-stop evidence",
      story: story(),
      decision: decision({ hard_stops: "{not-json" }),
      blocker: "governed_decision_hard_stops_invalid",
    },
  ];

  for (const current of cases) {
    const queued = [];
    const result = enqueueGovernedEditorialEvidence({
      story: current.story,
      latestDecision: current.decision,
      jobs: {
        enqueue(request) {
          queued.push(request);
          return request;
        },
      },
      now: NOW,
    });
    assert.equal(result.queued, false, current.label);
    assert.equal(queued.length, 0, current.label);
    assert.ok(
      result.assessment.blockers.includes(current.blocker),
      `${current.label}: ${result.assessment.blockers.join(",")}`,
    );
  }
});

test("official-source backfill is deterministic and hard-bounded to six governed current-window stories", () => {
  const eligible = Array.from({ length: 8 }, (_, index) => {
    const id = `official-story-${index + 1}`;
    return story({
      id,
      title: `Official gaming story ${index + 1}`,
      article_url:
        index % 2 === 0
          ? `https://news.xbox.com/en-us/2026/07/28/story-${index + 1}/`
          : `https://blog.playstation.com/2026/07/28/story-${index + 1}/`,
      timestamp: `2026-07-28T${String(13 - index).padStart(2, "0")}:00:00.000Z`,
    });
  });
  const trustedEditorial = story({
    id: "trusted-editorial-only",
    article_url:
      "https://www.ign.com/articles/a-current-gaming-report",
  });
  const staleOfficial = story({
    id: "stale-official",
    article_url:
      "https://news.xbox.com/en-us/2026/07/19/stale-story/",
    timestamp: "2026-07-19T13:00:00.000Z",
  });
  const stories = [
    ...eligible,
    trustedEditorial,
    staleOfficial,
  ];
  const decisions = stories.map((current, index) =>
    decision({
      story_id: current.id,
      decision: index < 4 ? "auto" : "review",
      total: 90 - index,
    }),
  );

  const report = selectGovernedEditorialEvidenceBackfill({
    stories,
    latestDecisions: decisions,
    requestedLimit: 100,
    now: NOW,
    sourcePolicy: {
      official_first_party: [
        {
          source_id: "xbox-wire",
          hosts: ["news.xbox.com"],
        },
        {
          source_id: "playstation-blog",
          hosts: ["blog.playstation.com"],
        },
      ],
      trusted_editorial: [
        {
          source_id: "ign",
          hosts: ["ign.com"],
        },
      ],
    },
  });

  assert.equal(report.limit, 6);
  assert.equal(report.selected.length, 6);
  assert.deepEqual(
    report.selected.slice(0, 4).map((item) => item.story.id),
    eligible.slice(0, 4).map((item) => item.id),
  );
  assert.ok(
    report.selected.every(
      (item) => item.source_class === "OFFICIAL_FIRST_PARTY",
    ),
  );
  assert.ok(
    report.rejected.some(
      (item) =>
        item.story_id === "trusted-editorial-only" &&
        item.blockers.includes(
          "editorial_official_source_required",
        ),
    ),
  );
  assert.ok(
    report.rejected.some(
      (item) =>
        item.story_id === "stale-official" &&
        item.blockers.includes(
          "editorial_story_outside_current_window",
        ),
    ),
  );
  assert.equal(report.safety.publish_authority_created, false);
  assert.equal(report.safety.external_posting_authorised, false);
  assert.equal(report.safety.oauth_mutation_authorised, false);
});

test("official-source backfill rotates past recent attempts into the next deterministic bounded batch", () => {
  const eligible = Array.from({ length: 8 }, (_, index) => {
    const id = `rotation-story-${index + 1}`;
    return story({
      id,
      title: `Rotation story ${index + 1}`,
      article_url:
        `https://news.xbox.com/en-us/2026/07/28/rotation-${index + 1}/`,
      timestamp: `2026-07-28T${String(13 - index).padStart(2, "0")}:00:00.000Z`,
    });
  });
  const latestDecisions = eligible.map((current, index) =>
    decision({
      story_id: current.id,
      decision: "auto",
      total: 100 - index,
    }),
  );
  const input = {
    stories: eligible,
    latestDecisions,
    recentAttemptedStoryIds: eligible
      .slice(0, 2)
      .map((current) => current.id),
    requestedLimit: 6,
    now: NOW,
    sourcePolicy: {
      official_first_party: [
        {
          source_id: "xbox-wire",
          hosts: ["news.xbox.com"],
        },
      ],
      trusted_editorial: [],
    },
  };

  const first = selectGovernedEditorialEvidenceBackfill(input);
  const second = selectGovernedEditorialEvidenceBackfill(input);

  assert.equal(first.limit, 6);
  assert.deepEqual(
    first.selected.map((item) => item.story.id),
    eligible.slice(2).map((item) => item.id),
  );
  assert.deepEqual(second.selected, first.selected);
  assert.equal(first.summary.eligible_count, 6);
  assert.equal(first.summary.selected_count, 6);
  assert.equal(first.summary.deferred_count, 0);
  assert.equal(first.summary.rejected_count, 2);
  for (const attempted of eligible.slice(0, 2)) {
    assert.ok(
      first.rejected.some(
        (item) =>
          item.story_id === attempted.id &&
          item.blockers.includes(
            "editorial_backfill_story_recently_attempted",
          ),
      ),
    );
  }
  assert.equal(first.safety.publish_authority_created, false);
  assert.equal(first.safety.external_posting_authorised, false);
  assert.equal(first.safety.oauth_mutation_authorised, false);
});

test("normal ingress accepts configured editorial sources but rejects unconfigured hosts", () => {
  const queued = [];
  const jobs = {
    enqueue(request) {
      queued.push(request);
      return { id: 950 + queued.length, ...request };
    },
  };
  const trusted = enqueueGovernedEditorialEvidence({
    story: story({
      id: "trusted-ign-story",
      article_url:
        "https://www.ign.com/articles/a-current-xbox-report",
    }),
    latestDecision: decision({
      story_id: "trusted-ign-story",
    }),
    jobs,
    now: NOW,
  });
  const unconfigured = enqueueGovernedEditorialEvidence({
    story: story({
      id: "unconfigured-source",
      article_url:
        "https://example.invalid/current-gaming-report",
    }),
    latestDecision: decision({
      story_id: "unconfigured-source",
    }),
    jobs,
    now: NOW,
  });

  assert.equal(trusted.queued, true);
  assert.equal(
    trusted.assessment.source.source_class,
    "TRUSTED_EDITORIAL",
  );
  assert.equal(unconfigured.queued, false);
  assert.ok(
    unconfigured.assessment.blockers.includes(
      "governed_editorial_source_policy_match_required",
    ),
  );
  assert.equal(queued.length, 1);
});

test("backfill uses the newest governed decision and cannot resurrect an older approval", () => {
  const currentStory = story({ id: "decision-order-story" });
  const report = selectGovernedEditorialEvidenceBackfill({
    stories: [currentStory],
    latestDecisions: [
      decision({
        story_id: currentStory.id,
        decision: "auto",
        scored_at: "2026-07-28T12:00:00.000Z",
      }),
      decision({
        story_id: currentStory.id,
        decision: "reject",
        hard_stops: ["pulse_gaming_off_topic_entertainment"],
        inputs: {
          topicality_decision: "reject",
        },
        scored_at: "2026-07-28T13:50:00.000Z",
      }),
    ],
    now: NOW,
  });

  assert.equal(report.selected.length, 0);
  assert.equal(report.rejected.length, 1);
  assert.ok(
    report.rejected[0].blockers.includes(
      "governed_decision_auto_or_review_required",
    ),
  );
  assert.ok(
    report.rejected[0].blockers.includes(
      "governed_decision_hard_stops_must_be_clear",
    ),
  );
});
