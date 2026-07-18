"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_MINIMUM_GENUINE_BASE_SOURCES,
  evaluateGenuineBaseSourceDiversity,
} = require("../../lib/genuine-base-source-diversity");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);

function genuineSource(name, hash, overrides = {}) {
  return {
    clip_id: `${name}_window_12_5`,
    media_kind: "direct_video",
    base_source_id: name,
    canonical_source_url: `https://publisher.example/trailers/${name}.mp4`,
    source_master_sha256: hash,
    ...overrides,
  };
}

test("genuine base-source diversity defaults to three clean materially distinct sources", () => {
  const sources = [
    genuineSource("launch_trailer", HASH_A),
    genuineSource("gameplay_showcase", HASH_B),
    genuineSource("developer_diary", HASH_C),
  ];

  const report = evaluateGenuineBaseSourceDiversity(sources);

  assert.equal(DEFAULT_MINIMUM_GENUINE_BASE_SOURCES, 3);
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.status, "GREEN");
  assert.equal(report.strict_pass, true);
  assert.equal(report.minimum_required_genuine_base_source_count, 3);
  assert.equal(report.observed_genuine_base_source_count, 3);
  assert.equal(report.input_source_count, 3);
  assert.equal(report.accepted_source_count, 3);
  assert.equal(report.rejected_source_count, 0);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.checks.minimum_genuine_base_sources.status, "GREEN");
  assert.equal(report.checks.source_integrity.status, "GREEN");
});

test("repeated clip windows from one trailer count as one base source", () => {
  const windows = [12, 24, 36].map((start) =>
    genuineSource("launch_trailer", HASH_A, {
      clip_id: `launch_trailer_window_${start}_5`,
      media_start_s: start,
      duration_s: 5,
    }),
  );

  const report = evaluateGenuineBaseSourceDiversity(windows);

  assert.equal(report.verdict, "RED");
  assert.equal(report.strict_pass, false);
  assert.equal(report.observed_genuine_base_source_count, 1);
  assert.equal(report.accepted_source_count, 1);
  assert.equal(report.rejected_source_count, 2);
  assert.deepEqual(report.genuine_base_sources[0].input_indexes, [0, 1, 2]);
  assert.ok(report.blockers.includes("genuine_base_source_minimum_not_met"));
  assert.ok(report.blockers.includes("duplicate_base_source_id_rejected"));
  assert.ok(report.blockers.includes("duplicate_base_source_url_rejected"));
  assert.ok(report.blockers.includes("duplicate_base_source_hash_rejected"));
});

test("genuine base-source diversity accepts a configurable minimum", () => {
  const report = evaluateGenuineBaseSourceDiversity({
    sources: [
      genuineSource("launch_trailer", HASH_A),
      genuineSource("gameplay_showcase", HASH_B),
    ],
    minimum: 2,
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.minimum_required_genuine_base_source_count, 2);
  assert.equal(report.observed_genuine_base_source_count, 2);
  assert.equal(report.minimum_met, true);
});

test("placeholder, synthetic still-loop and identity-free rows are rejected", () => {
  const sources = [
    genuineSource("launch_trailer", HASH_A),
    genuineSource("gameplay_showcase", HASH_B),
    {
      clip_id: "developer_diary_window_20_5",
      media_kind: "direct_video",
      source_identity: {
        base_source_id: "developer_diary",
        canonical_source_url: "https://publisher.example/trailers/developer-diary.mp4",
        source_master_sha256: HASH_C,
      },
    },
    genuineSource("placeholder", HASH_D),
    genuineSource("synthetic_pan", HASH_E, {
      motion_type: "synthetic_still_loop",
    }),
    {
      clip_id: "path_only_window_30_5",
      path: "C:\\renders\\path_only_window_30_5.mp4",
      source_family: "path_only_window_30_5",
      media_kind: "direct_video",
    },
  ];

  const report = evaluateGenuineBaseSourceDiversity(sources);

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.strict_pass, false);
  assert.equal(report.minimum_met, true);
  assert.equal(report.observed_genuine_base_source_count, 3);
  assert.equal(report.rejected_source_count, 3);
  assert.ok(report.blockers.includes("placeholder_base_source_rejected"));
  assert.ok(report.blockers.includes("synthetic_still_loop_base_source_rejected"));
  assert.ok(report.blockers.includes("base_source_identity_missing"));
  assert.deepEqual(
    report.rejected_sources.map((source) => source.reasons),
    [
      ["placeholder_base_source_rejected"],
      ["synthetic_still_loop_base_source_rejected"],
      ["base_source_identity_missing"],
    ],
  );
  assert.equal(report.checks.minimum_genuine_base_sources.status, "GREEN");
  assert.equal(report.checks.source_integrity.status, "AMBER");
});

test("duplicate IDs, canonical URLs and hashes cannot inflate diversity", () => {
  const sources = [
    genuineSource("source_id_anchor", HASH_A),
    genuineSource("source_id_anchor", HASH_B, {
      canonical_source_url: "https://publisher.example/trailers/id-alias.mp4",
    }),
    genuineSource("url_anchor", HASH_C),
    genuineSource("url_alias", HASH_D, {
      canonical_source_url:
        "https://PUBLISHER.example/trailers/url_anchor.mp4?utm_source=clip-window&t=24#window",
    }),
    genuineSource("hash_anchor", HASH_E),
    genuineSource("hash_alias", HASH_E, {
      canonical_source_url: "https://publisher.example/trailers/hash-alias.mp4",
    }),
  ];

  const report = evaluateGenuineBaseSourceDiversity(sources);

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.observed_genuine_base_source_count, 3);
  assert.equal(report.accepted_source_count, 3);
  assert.equal(report.rejected_source_count, 3);
  assert.ok(report.blockers.includes("duplicate_base_source_id_rejected"));
  assert.ok(report.blockers.includes("duplicate_base_source_url_rejected"));
  assert.ok(report.blockers.includes("duplicate_base_source_hash_rejected"));
  assert.deepEqual(
    report.rejected_sources.map((source) => source.duplicate_of_input_index),
    [0, 2, 4],
  );
});

test("the evaluator is deterministic, does not mutate input and fails closed on bad policy", () => {
  const sources = [
    Object.freeze({
      ...genuineSource("launch_trailer", HASH_A),
      source_identity: Object.freeze({ sampled_visual_fingerprint: "phash:12345678" }),
    }),
    Object.freeze(genuineSource("gameplay_showcase", HASH_B)),
    Object.freeze(genuineSource("developer_diary", HASH_F)),
  ];
  Object.freeze(sources);

  const first = evaluateGenuineBaseSourceDiversity(sources);
  const second = evaluateGenuineBaseSourceDiversity(sources);
  const invalidPolicy = evaluateGenuineBaseSourceDiversity(sources, { minimum: 0 });

  assert.deepEqual(first, second);
  assert.equal(first.verdict, "GREEN");
  assert.equal(invalidPolicy.verdict, "RED");
  assert.equal(invalidPolicy.strict_pass, false);
  assert.ok(invalidPolicy.blockers.includes("genuine_base_source_minimum_invalid"));
});
