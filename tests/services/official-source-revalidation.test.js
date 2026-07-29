"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const {
  buildOfficialSourceReleaseBinding,
  createOfficialSourceRevalidator,
  validateOfficialSourceRevalidationReceipt,
  validateOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");

const STORY_ID = "official-source-revalidation-story";
const SOURCE_URL =
  "https://news.xbox.com/en-us/2026/07/28/example/";
const SOURCE_EVIDENCE_SHA256 = "a".repeat(64);
const REQUEST_FINGERPRINT = "b".repeat(64);
const RUNWAY_LOCK_SHA256 = "c".repeat(64);
const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";
const EXTERNAL_ID = "youtube-private-object";
const CLAIM =
  "Microsoft will add original Xbox games to backwards compatibility.";
const BODY = `The official update says: ${CLAIM}`;

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function sourceEvidence() {
  return {
    schema_version: "pulse-source-evidence-v1",
    story_id: STORY_ID,
    source_url: SOURCE_URL,
    source_type: "official",
    claims: [
      {
        claim_key: "xbox.original-backcompat.expansion",
        text: CLAIM,
        claim_text_sha256: sha256(CLAIM),
      },
    ],
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: SOURCE_URL,
      source_id: "xbox-wire",
      source_class: "OFFICIAL_FIRST_PARTY",
      canonical_body_algorithm: "pulse-readable-body-v1",
      canonical_body_sha256: sha256(BODY),
      claims: [
        {
          claim_key: "xbox.original-backcompat.expansion",
          text: CLAIM,
          claim_text_sha256: sha256(CLAIM),
        },
      ],
    },
  };
}

function candidate(binding) {
  return {
    binding,
    storyId: STORY_ID,
    platform: "youtube",
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
  };
}

test("official-source revision excludes capture time and a T-15 receipt proves the exact locked body and claims", async () => {
  const first = buildOfficialSourceReleaseBinding({
    storyId: STORY_ID,
    sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
    sourceEvidence: {
      ...sourceEvidence(),
      generated_at: "2026-07-28T10:00:00.000Z",
    },
  });
  const second = buildOfficialSourceReleaseBinding({
    storyId: STORY_ID,
    sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
    sourceEvidence: {
      ...sourceEvidence(),
      generated_at: "2026-07-28T18:40:00.000Z",
    },
  });
  assert.equal(
    first.source_revision_sha256,
    second.source_revision_sha256,
  );
  assert.equal(first.binding_sha256, second.binding_sha256);
  assert.equal(
    validateOfficialSourceReleaseBinding(first, {
      storyId: STORY_ID,
      sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
    }).valid,
    true,
  );

  let fetched = 0;
  const revalidate = createOfficialSourceRevalidator({
    now: () => new Date("2026-07-28T18:45:00.000Z"),
    fetchCapture: async (request) => {
      fetched += 1;
      assert.equal(request.url, SOURCE_URL);
      assert.equal(request.redirect, "manual");
      return {
        status: 200,
        final_url: SOURCE_URL,
        content_type: "text/html",
        bytes: Buffer.from(
          `<html><head><script>changed()</script></head><body><main>${BODY}</main></body></html>`,
          "utf8",
        ),
      };
    },
  });

  const receipt = await revalidate(candidate(first));

  assert.equal(fetched, 1);
  assert.equal(receipt.official_source, true);
  assert.equal(receipt.unchanged, true);
  assert.equal(receipt.claims_match, true);
  assert.equal(
    receipt.source_revision_sha256,
    first.source_revision_sha256,
  );
  assert.equal(
    receipt.expected_source_revision_sha256,
    first.source_revision_sha256,
  );
  assert.equal(
    receipt.observed_canonical_body_sha256,
    first.canonical_body_sha256,
  );
  assert.equal(
    validateOfficialSourceRevalidationReceipt(receipt, {
      binding: first,
      storyId: STORY_ID,
      platform: "youtube",
      externalId: EXTERNAL_ID,
      scheduledFor: SCHEDULED_FOR,
      requestFingerprint: REQUEST_FINGERPRINT,
      runwayLockSha256: RUNWAY_LOCK_SHA256,
    }).valid,
    true,
  );
});

test("string intake claims are accepted only through the exact typed official snapshot", () => {
  const evidence = sourceEvidence();
  const typedBinding = buildOfficialSourceReleaseBinding({
    storyId: STORY_ID,
    sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
    sourceEvidence: evidence,
  });
  const binding = buildOfficialSourceReleaseBinding({
    storyId: STORY_ID,
    sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
    sourceEvidence: {
      ...evidence,
      claims: evidence.claims.map((claim) => claim.text),
    },
  });

  assert.deepEqual(
    binding.claims,
    evidence.official_source_snapshot.claims,
  );
  assert.equal(
    binding.claims[0].claim_key,
    "xbox.original-backcompat.expansion",
  );
  assert.equal(
    binding.claims[0].claim_text_sha256,
    sha256(CLAIM),
  );
  assert.deepEqual(binding, typedBinding);
});

test("release binding rejects a missing official snapshot before any release work", () => {
  const evidence = sourceEvidence();
  delete evidence.official_source_snapshot;

  assert.throws(
    () =>
      buildOfficialSourceReleaseBinding({
        storyId: STORY_ID,
        sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
        sourceEvidence: evidence,
      }),
    /official_source_snapshot_required/,
  );
});

test("string intake claims fail closed when text or claim count drifts from the typed snapshot", () => {
  const evidence = sourceEvidence();
  for (const claims of [
    ["Microsoft changed the official claim."],
    [],
    [CLAIM, "An extra claim was not present in the snapshot."],
  ]) {
    assert.throws(
      () =>
        buildOfficialSourceReleaseBinding({
          storyId: STORY_ID,
          sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
          sourceEvidence: {
            ...evidence,
            claims,
          },
        }),
      /official_source_snapshot_claim_mismatch/,
    );
  }
});

test("official-source revalidation blocks changed body or missing exact claims", async () => {
  const binding = buildOfficialSourceReleaseBinding({
    storyId: STORY_ID,
    sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
    sourceEvidence: sourceEvidence(),
  });
  const revalidate = createOfficialSourceRevalidator({
    now: () => new Date("2026-07-28T18:45:00.000Z"),
    fetchCapture: async () => ({
      status: 200,
      final_url: SOURCE_URL,
      content_type: "text/html",
      bytes: Buffer.from(
        "<main>The publisher removed the original claim.</main>",
        "utf8",
      ),
    }),
  });

  await assert.rejects(
    revalidate(candidate(binding)),
    /official_source_canonical_body_changed/,
  );
});

test("a tampered release binding is rejected before the network boundary", async () => {
  const binding = buildOfficialSourceReleaseBinding({
    storyId: STORY_ID,
    sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
    sourceEvidence: sourceEvidence(),
  });
  let fetched = 0;
  const revalidate = createOfficialSourceRevalidator({
    now: () => new Date("2026-07-28T18:45:00.000Z"),
    fetchCapture: async () => {
      fetched += 1;
      throw new Error("must_not_fetch");
    },
  });

  await assert.rejects(
    revalidate(
      candidate({
        ...binding,
        source_url: "https://example.com/forged",
      }),
    ),
    /official_source_(?:release_binding|revision)_sha256_mismatch/,
  );
  assert.equal(fetched, 0);
});
