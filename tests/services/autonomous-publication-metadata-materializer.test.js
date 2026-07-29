"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUEST_SCHEMA_VERSION,
  materialiseAutonomousPublicationMetadata,
} = require("../../lib/services/autonomous-publication-metadata-materializer");
const {
  validateGovernedPublicationMetadata,
} = require("../../lib/services/governed-publication-metadata");

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-autonomous-metadata-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(
    root,
    "publication",
    "youtube-shorts-metadata.json",
  );
  const officialSource =
    "https://news.xbox.com/en-us/2026/07/29/xbox-classics-update/";
  const attribution = "Official source: Xbox Wire";
  const request = {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    story_id: "official-xbox-classics",
    channel_id: "pulse-gaming",
    platform: "youtube_shorts",
    generated_at: "2026-07-29T16:30:00.000Z",
    root_dir: root,
    output_path: outputPath,
    title: "Xbox Classics Just Got a Huge Upgrade",
    description: [
      "Original Xbox games are returning with modern platform support.",
      "",
      `Official source: ${officialSource}`,
      attribution,
      "",
      "#Xbox #GamingNews #Shorts",
    ].join("\n"),
    official_source_url: officialSource,
    required_attributions: [attribution],
    subject_terms: ["Xbox", "Xbox Classics"],
    evidence_bindings: {
      source_evidence_sha256: "1".repeat(64),
      claim_map_sha256: "2".repeat(64),
      qa_report_sha256: "3".repeat(64),
      final_mp4_sha256: "4".repeat(64),
    },
  };
  return { root, outputPath, officialSource, attribution, request };
}

test("materialises autonomous metadata with an exact system-policy editorial review", async (t) => {
  const input = await fixture(t);

  const first =
    await materialiseAutonomousPublicationMetadata(input.request);
  const replay =
    await materialiseAutonomousPublicationMetadata(input.request);

  assert.equal(first.status, "CREATED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(first.file_sha256, replay.file_sha256);
  assert.deepEqual(first.metadata.editorial_review, {
    method: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    title_approved: true,
    description_approved: true,
    attribution_approved: true,
  });
  assert.equal(Object.hasOwn(first.metadata, "human_approval"), false);
  assert.equal(
    Object.hasOwn(first.metadata.editorial_review, "human_actor"),
    false,
  );
  const validated = validateGovernedPublicationMetadata({
    metadataPath: first.path,
    expectedMetadataSha256: first.file_sha256,
    expectedStoryId: input.request.story_id,
    expectedChannelId: "pulse-gaming",
    expectedPlatform: "youtube_shorts",
    requiredDescriptionAttributions: [input.attribution],
    requireCanonicalAbsolutePath: true,
  });
  assert.equal(validated.title, input.request.title);
  assert.equal(first.safety.publish_authority, false);
  assert.equal(first.safety.external_publish_authorised, false);
  assert.equal(first.safety.database_mutated, false);
  assert.equal(first.safety.oauth_or_tokens_mutated, false);
  assert.equal(first.safety.network_used, false);
});

test("fails closed on missing source disclosure, attribution, subject identity or internal production language", async (t) => {
  const input = await fixture(t);
  const cases = [
    [
      "missing-source",
      (request) => {
        request.description = request.description.replace(
          `Official source: ${input.officialSource}`,
          "Source available on request",
        );
      },
      "autonomous_metadata_official_source_line_required",
    ],
    [
      "missing-attribution",
      (request) => {
        request.description = request.description.replace(
          input.attribution,
          "",
        );
      },
      "autonomous_metadata_attribution_line_required",
    ],
    [
      "wrong-subject",
      (request) => {
        request.title = "A Gaming Platform Just Got a Huge Upgrade";
      },
      "autonomous_metadata_title_subject_required",
    ],
    [
      "internal-copy",
      (request) => {
        request.title = "QA Canary: Xbox Classics Upgrade";
      },
      "autonomous_metadata_internal_language_forbidden",
    ],
  ];
  for (const [name, mutate, code] of cases) {
    const request = structuredClone(input.request);
    request.output_path = path.join(
      input.root,
      "publication",
      `${name}.json`,
    );
    mutate(request);
    await assert.rejects(
      () => materialiseAutonomousPublicationMetadata(request),
      (error) => error?.code === code,
    );
  }
});

test("fails closed on malformed evidence hashes, path escape and conflicting replay", async (t) => {
  const input = await fixture(t);
  const malformed = structuredClone(input.request);
  malformed.evidence_bindings.claim_map_sha256 = "not-a-hash";
  await assert.rejects(
    () => materialiseAutonomousPublicationMetadata(malformed),
    (error) => error?.code === "autonomous_metadata_evidence_invalid",
  );

  const escaped = structuredClone(input.request);
  escaped.output_path = path.join(
    path.dirname(input.root),
    "escaped-metadata.json",
  );
  await assert.rejects(
    () => materialiseAutonomousPublicationMetadata(escaped),
    (error) => error?.code === "autonomous_metadata_output_outside_root",
  );

  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  await fs.writeFile(input.outputPath, "{}\n", "utf8");
  await assert.rejects(
    () => materialiseAutonomousPublicationMetadata(input.request),
    (error) => error?.code === "autonomous_metadata_output_conflict",
  );
});
