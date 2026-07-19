"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildSourceFingerprint,
  buildZeroYieldExclusions,
  readZeroYieldQuarantine,
  recordZeroYieldCohort,
  resolveZeroYieldQuarantinePath,
  writeZeroYieldQuarantine,
} = require("../../lib/refill-zero-yield-quarantine");

test("zero-yield quarantine persists story and source exclusions across sequential refill runs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-zero-yield-quarantine-"));
  const filePath = path.join(root, "quarantine.json");
  const now = new Date("2026-07-17T14:00:00.000Z");
  const stories = [
    {
      id: "rss_first",
      title: "Battlefield 6 Shows New Multiplayer Gameplay",
      url: "https://www.ea.com/games/battlefield/battlefield-6/news/multiplayer?utm_source=rss",
      source_name: "EA",
    },
    {
      id: "rss_second",
      title: "Heave Ho 2 Reveals Its Co-op Sequel",
      url: "https://www.devolverdigital.com/games/heave-ho-2",
      source_name: "Devolver Digital",
    },
  ];

  const first = recordZeroYieldCohort(null, {
    stories,
    now,
    ttlHours: 12,
  });
  await writeZeroYieldQuarantine(filePath, first);

  const loaded = await readZeroYieldQuarantine(filePath, {
    now: new Date("2026-07-17T15:00:00.000Z"),
  });
  const exclusions = buildZeroYieldExclusions(loaded, {
    now: new Date("2026-07-17T15:00:00.000Z"),
  });

  assert.deepEqual(exclusions.story_ids.sort(), ["rss_first", "rss_second"]);
  assert.deepEqual(
    exclusions.source_fingerprints.sort(),
    stories.map(buildSourceFingerprint).sort(),
  );
  assert.equal(exclusions.rss_offset_per_feed, 0);

  const second = recordZeroYieldCohort(loaded, {
    stories: [{
      ...stories[0],
      id: "rss_changed_id",
      url: "https://www.ea.com/games/battlefield/battlefield-6/news/multiplayer",
    }],
    now: new Date("2026-07-17T15:30:00.000Z"),
    ttlHours: 12,
  });
  const eaEntry = second.entries.find(
    (entry) => entry.source_fingerprint === buildSourceFingerprint(stories[0]),
  );
  assert.equal(eaEntry.failure_count, 2);
  assert.deepEqual(eaEntry.story_ids.sort(), ["rss_changed_id", "rss_first"]);
});

test("zero-yield quarantine expires stale entries rather than permanently suppressing stories", () => {
  const document = recordZeroYieldCohort(null, {
    stories: [{
      id: "rss_old",
      title: "Old Failed Story",
      url: "https://example.com/old-story",
      source_name: "Example",
    }],
    now: new Date("2026-07-17T00:00:00.000Z"),
    ttlHours: 2,
  });

  const exclusions = buildZeroYieldExclusions(document, {
    now: new Date("2026-07-17T03:00:00.000Z"),
  });
  assert.deepEqual(exclusions.story_ids, []);
  assert.deepEqual(exclusions.source_fingerprints, []);
  assert.equal(exclusions.rss_offset_per_feed, 0);
});

test("zero-yield quarantine never skips fresh rows across every RSS feed", () => {
  const document = recordZeroYieldCohort(null, {
    stories: Array.from({ length: 15 }, (_, index) => ({
      id: `failed_story_${index}`,
      title: `Failed Story ${index}`,
      url: `https://failed-source.example/stories/${index}`,
      source_name: "Failed Source",
    })),
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  const exclusions = buildZeroYieldExclusions(document, {
    now: new Date("2026-07-17T05:00:00.000Z"),
  });

  assert.equal(exclusions.story_ids.length, 15);
  assert.equal(exclusions.source_fingerprints.length, 15);
  assert.equal(
    exclusions.rss_offset_per_feed,
    0,
    "exact story and source exclusions must not shift unrelated feeds past their newest items",
  );
});

test("zero-yield quarantine gives source-less rows distinct story-scoped fingerprints", () => {
  const first = {
    story_id: "source-less-one",
  };
  const second = {
    story_id: "source-less-two",
  };

  assert.notEqual(buildSourceFingerprint(first), buildSourceFingerprint(second));

  const document = recordZeroYieldCohort(null, {
    stories: [first, second],
    now: new Date("2026-07-17T04:00:00.000Z"),
  });

  assert.equal(document.entries.length, 2);
  assert.deepEqual(
    buildZeroYieldExclusions(document, {
      now: new Date("2026-07-17T05:00:00.000Z"),
    }).story_ids.sort(),
    ["source-less-one", "source-less-two"],
  );
});

test("zero-yield quarantine drops the corrupt legacy empty-source bucket", () => {
  const legacyFingerprint = buildSourceFingerprint({
    source_name: "",
    canonical_subject: "",
    story_id: "",
  });
  const document = {
    schema_version: 1,
    generated_at: "2026-07-17T04:00:00.000Z",
    entries: [
      {
        source_fingerprint:
          "db817a3e48a44260559a3c1f0257f77bce57ed3a31dd225b4a1fd2d33dbde9f5",
        story_ids: ["unrelated-one", "unrelated-two"],
        source_name: null,
        source_url: null,
        first_failed_at: "2026-07-17T04:00:00.000Z",
        last_failed_at: "2026-07-17T04:00:00.000Z",
        expires_at: "2026-07-17T16:00:00.000Z",
        failure_count: 4,
      },
    ],
  };

  assert.equal(legacyFingerprint, "");
  assert.deepEqual(
    buildZeroYieldExclusions(document, {
      now: new Date("2026-07-17T05:00:00.000Z"),
    }),
    {
      story_ids: [],
      source_fingerprints: [],
      rss_offset_per_feed: 0,
      active_entry_count: 0,
    },
  );
});

test("zero-yield quarantine never lets test or non-production fixture ids suppress live refill candidates", () => {
  const now = new Date("2026-07-19T23:30:00.000Z");
  const document = {
    schema_version: 1,
    generated_at: now.toISOString(),
    entries: [
      {
        source_fingerprint: buildSourceFingerprint({ id: "fresh_plan_story" }),
        story_ids: ["fresh_plan_story"],
        source_name: null,
        source_url: null,
        expires_at: "2026-07-20T11:30:00.000Z",
        failure_count: 1,
      },
      {
        source_fingerprint: buildSourceFingerprint({ id: "persona-netflix-story" }),
        story_ids: ["persona-netflix-story"],
        source_name: null,
        source_url: null,
        expires_at: "2026-07-20T11:30:00.000Z",
        failure_count: 1,
      },
      {
        source_fingerprint: buildSourceFingerprint({ id: "rss_gta_vi_article_story" }),
        story_ids: ["rss_gta_vi_article_story"],
        source_name: null,
        source_url: null,
        expires_at: "2026-07-20T11:30:00.000Z",
        failure_count: 1,
      },
      {
        source_fingerprint: buildSourceFingerprint({ id: "rss_albion_keepers" }),
        story_ids: ["rss_albion_keepers"],
        source_name: null,
        source_url: null,
        expires_at: "2026-07-20T11:30:00.000Z",
        failure_count: 1,
      },
      {
        source_fingerprint: buildSourceFingerprint({
          id: "fresh_halo_campaign_evolved_demo_reference_only",
        }),
        story_ids: ["fresh_halo_campaign_evolved_demo_reference_only"],
        source_name: null,
        source_url: null,
        expires_at: "2026-07-20T11:30:00.000Z",
        failure_count: 1,
      },
      {
        source_fingerprint: buildSourceFingerprint({
          id: "rss_8908c3f0f1125398",
        }),
        story_ids: ["rss_8908c3f0f1125398"],
        source_name: null,
        source_url: null,
        expires_at: "2026-07-20T11:30:00.000Z",
        failure_count: 1,
      },
    ],
  };

  const exclusions = buildZeroYieldExclusions(document, { now });

  assert.deepEqual(exclusions.story_ids, ["rss_8908c3f0f1125398"]);
  assert.equal(exclusions.source_fingerprints.length, 1);
  assert.equal(exclusions.active_entry_count, 1);

  const recorded = recordZeroYieldCohort(null, {
    stories: [
      { id: "fresh_plan_story" },
      { id: "rss_8908c3f0f1125398" },
    ],
    now,
  });
  assert.deepEqual(
    recorded.entries.flatMap((entry) => entry.story_ids),
    ["rss_8908c3f0f1125398"],
  );
});

test("zero-yield quarantine defaults isolate Node test workers from the live runtime artifact", () => {
  const root = path.join("C:", "pulse");

  assert.equal(
    resolveZeroYieldQuarantinePath({
      root,
      nodeTestContext: "child-v8",
      processId: 4242,
    }),
    path.resolve(
      root,
      "test",
      "output",
      "runtime",
      "refill-zero-yield-quarantine-4242.json",
    ),
  );
  assert.equal(
    resolveZeroYieldQuarantinePath({
      root,
      nodeTestContext: "",
      processId: 4242,
    }),
    path.resolve(
      root,
      "output",
      "runtime",
      "refill-zero-yield-quarantine.json",
    ),
  );
  assert.equal(
    resolveZeroYieldQuarantinePath({
      root,
      explicitPath: path.join("custom", "quarantine.json"),
      nodeTestContext: "child-v8",
      processId: 4242,
    }),
    path.resolve(root, "custom", "quarantine.json"),
  );
});
