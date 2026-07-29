"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createAnthropicWeeklyLongformJsonGenerator,
  enrichWeeklyLongformEditorial,
  renderWeeklyLongformEditorialEnrichmentJson,
  renderWeeklyLongformEditorialEnrichmentMarkdown,
} = require("../../lib/services/weekly-longform-editorial-enrichment");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");

const GENERATED_AT = "2026-07-28T12:00:00.000Z";
const RUN_ID = "weekly-editorial-enrichment-2026-07-28";
const SERVICE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "lib",
  "services",
  "weekly-longform-editorial-enrichment.js",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return sha256(fs.readFileSync(filePath));
}

function fixture() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-weekly-editorial-enrichment-"),
  );
}

function createGovernedVisualPack(root, id) {
  const visualRoot = path.join(root, `${id}-visuals`);
  fs.mkdirSync(visualRoot, { recursive: true });
  const definitions = [
    {
      suffix: "gameplay",
      role: "gameplay",
      media_type: "video",
      width: 1920,
      height: 1080,
      duration_seconds: 24,
    },
    {
      suffix: "screenshot",
      role: "official_screenshot",
      media_type: "image",
      width: 1920,
      height: 1080,
      duration_seconds: null,
    },
    {
      suffix: "key-art",
      role: "key_art",
      media_type: "image",
      width: 1920,
      height: 1080,
      duration_seconds: null,
      subject_match_quality: "exact_game_match",
      counted_for_premium: true,
    },
    {
      suffix: "hook-card",
      role: "hook_slam",
      media_type: "image",
      width: 1080,
      height: 1920,
      duration_seconds: null,
      subject_match_quality: "generic_stock_or_filler",
      counted_for_premium: false,
    },
  ];
  const assets = definitions.map((asset) => {
    const extension = asset.media_type === "video" ? "mp4" : "png";
    const relativePath = `${asset.suffix}.${extension}`;
    const assetPath = path.join(visualRoot, relativePath);
    fs.writeFileSync(assetPath, Buffer.from(`${id}:${asset.suffix}`));
    return {
      path: relativePath,
      sha256: sha256(fs.readFileSync(assetPath)),
      media_type: asset.media_type,
      role: asset.role,
      ownership: "owned",
      width: asset.width,
      height: asset.height,
      duration_seconds: asset.duration_seconds,
      generator_identity: "pulse-governed-visual-intake-v1",
      rights_basis: "OWNED",
      attribution_required: false,
      subject_match_quality:
        asset.subject_match_quality || "exact_game_match",
      counted_for_premium:
        asset.counted_for_premium !== false,
      provenance: {
        source:
          asset.counted_for_premium === false
            ? "repository_owned_generation"
            : "verified_exact_subject_intake",
        third_party_media_used: false,
      },
    };
  });
  const manifestPath = path.join(
    visualRoot,
    "owned-motion-manifest.json",
  );
  const manifestSha256 = writeJson(manifestPath, {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: id,
    generated_at: GENERATED_AT,
    assets,
  });
  return {
    manifestPath,
    manifestSha256,
    items: assets.map((asset) => {
      const suffix = path.basename(
        asset.path,
        path.extname(asset.path),
      );
      return {
        item_id: `${id}-${suffix}`,
        source_url: `pulse-owned://${id}/${suffix}`,
        local_path: path.join(visualRoot, asset.path),
        asset_sha256: asset.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: manifestPath,
          sha256: manifestSha256,
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
        usage: asset.role,
        motion_family: asset.role,
        exact_subject_motion_seconds:
          asset.media_type === "video" &&
          asset.counted_for_premium !== false
            ? asset.duration_seconds
            : 0,
      };
    }),
  };
}

function verifiedCandidate(root, index) {
  const id = `weekly-enrichment-story-${index}`;
  const sourceUrl = `https://publisher.example/official/${id}`;
  const sourcePath = path.join(root, `${id}-source.json`);
  const sourceSha256 = writeJson(sourcePath, {
    schema_version: "pulse-source-evidence-v1",
    source_url: sourceUrl,
    source_type: "official",
    publisher: `Official Publisher ${index}`,
    published_at: new Date(
      Date.parse(GENERATED_AT) - index * 3_600_000,
    ).toISOString(),
    claims: [
      {
        claim_id: `${id}-claim-1`,
        text: `Verified weekly fact ${index}.`,
        source_locator: "official announcement paragraph 1",
      },
    ],
  });
  const visualPack = createGovernedVisualPack(root, id);
  const rightsPath = path.join(root, `${id}-rights.json`);
  const rights = {
    schema_version: "pulse-weekly-longform-rights-ledger-v1",
    story_id: id,
    ledger_version: 1,
    decision: "CLEARED",
    items: visualPack.items,
    owned_motion_manifest: {
      path: visualPack.manifestPath,
      file_sha256: visualPack.manifestSha256,
    },
    safety: {
      owned_motion_only: false,
      third_party_media_used: false,
      third_party_music_used: false,
      rights_synthesised: false,
    },
  };
  rights.ledger_sha256 = hashRightsLedger(rights);
  const rightsSha256 = writeJson(rightsPath, rights);
  return {
    id,
    title: `Verified weekly story ${index}`,
    published_at: new Date(
      Date.parse(GENERATED_AT) - index * 3_600_000,
    ).toISOString(),
    primary_source_url: sourceUrl,
    verification_status: "CONFIRMED",
    weekly_priority_score: 100 - index,
    source_evidence: {
      path: sourcePath,
      sha256: sourceSha256,
    },
    rights_ledger: {
      path: rightsPath,
      sha256: rightsSha256,
    },
  };
}

function prose(label, targetWords) {
  const vocabulary = [
    label,
    "verified",
    "context",
    "shows",
    "players",
    "exactly",
    "what",
    "changed",
    "why",
    "timing",
    "matters",
    "and",
    "which",
    "details",
    "remain",
    "unconfirmed",
    "for",
    "now",
  ];
  const words = [];
  while (words.length < targetWords) words.push(...vocabulary);
  return `${words.slice(0, targetWords).join(" ")}.`;
}

function generatedOutput(candidates) {
  return {
    editorial_frame: {
      episode_title: "The Four Gaming Stories That Changed This Week",
      editorial_thesis:
        "This briefing separates confirmed changes from noise and explains the practical player impact.",
      opening_script: prose("opening", 70),
      closing_script: prose("closing", 70),
    },
    weekly_longform_pitch: Object.fromEntries(
      candidates.map((candidate, index) => {
        const claimId = `${candidate.id}-claim-1`;
        const assetIds = [
          `${candidate.id}-gameplay`,
          `${candidate.id}-screenshot`,
          `${candidate.id}-key-art`,
        ];
        return [
          candidate.id,
          {
            section_title: `The verified consequence from story ${index + 1}`,
            angle:
              `Translate story ${index + 1} into a concrete player decision`,
            why_it_matters:
              `Players need the timing and remaining unknowns from story ${index + 1}.`,
            claim_ids: [claimId],
            script_section: prose(`story-${index + 1}`, 280),
            visual_beats: [1, 2, 3].map((beat) => ({
              beat_id: `${candidate.id}-beat-${beat}`,
              purpose:
                beat === 1
                  ? "Establish the official announcement"
                  : beat === 2
                    ? "Explain the player consequence"
                    : "Separate confirmed details from unknowns",
              asset_item_id: assetIds[beat - 1],
              treatment:
                beat === 1
                  ? "Owned platform opener"
                  : beat === 2
                    ? "Owned comparison diagram"
                    : "Owned confirmed-versus-unknown card",
              claim_ids: [claimId],
            })),
            derivative_hooks: {
              short: `The verified detail players need from story ${index + 1}.`,
              social_thread:
                `Three practical implications from story ${index + 1}.`,
            },
          },
        ];
      }),
    ),
  };
}

test("enriches 4 verified candidates without exposing or mutating source and rights evidence", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );
  const originalEvidenceRefs = candidates.map((candidate) => ({
    source_evidence: structuredClone(candidate.source_evidence),
    rights_ledger: structuredClone(candidate.rights_ledger),
    source_bytes: fs.readFileSync(candidate.source_evidence.path),
    rights_bytes: fs.readFileSync(candidate.rights_ledger.path),
  }));
  let request;

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async (value) => {
      request = value;
      return generatedOutput(candidates);
    },
    generator_identity: {
      provider: "test",
      model: "deterministic-json-fixture",
      adapter: "injected",
    },
  });

  assert.equal(result.verdict, "READY_FOR_LOCAL_PRODUCTION");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(Object.keys(request).sort(), [
    "allowed_story_ids",
    "generated_at",
    "output_contract",
    "run_id",
    "schema_version",
    "stories",
  ]);
  assert.deepEqual(
    Object.keys(request.stories[0]).sort(),
    [
      "cleared_asset_ids",
      "published_at",
      "story_id",
      "title",
      "verified_claims",
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(request),
    /source_evidence|rights_ledger|primary_source_url/,
  );
  assert.deepEqual(request.stories[0].cleared_asset_ids, [
    `${candidates[0].id}-gameplay`,
    `${candidates[0].id}-key-art`,
    `${candidates[0].id}-screenshot`,
  ]);
  assert.ok(
    !request.stories[0].cleared_asset_ids.includes(
      `${candidates[0].id}-hook-card`,
    ),
  );
  assert.equal(result.enriched_candidates.length, 4);
  result.enriched_candidates.forEach((candidate, index) => {
    assert.deepEqual(
      candidate.source_evidence,
      originalEvidenceRefs[index].source_evidence,
    );
    assert.deepEqual(
      candidate.rights_ledger,
      originalEvidenceRefs[index].rights_ledger,
    );
    assert.deepEqual(
      fs.readFileSync(candidate.source_evidence.path),
      originalEvidenceRefs[index].source_bytes,
    );
    assert.deepEqual(
      fs.readFileSync(candidate.rights_ledger.path),
      originalEvidenceRefs[index].rights_bytes,
    );
  });
  assert.equal(
    result.work_order_result.production_runner_admission.status,
    "READY",
  );
  assert.equal(result.work_order_result.selection.selected.length, 4);
  assert.match(
    result.generator_provenance.request_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.match(
    result.generator_provenance.output_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(result.safety.approval_authority_created, false);
  assert.equal(result.safety.publish_authority_created, false);
  assert.equal(result.safety.database_authority_created, false);
});

test("fails before generator compute when a candidate has only portrait template visuals", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );
  const blocked = candidates[0];
  const rights = JSON.parse(
    fs.readFileSync(blocked.rights_ledger.path, "utf8"),
  );
  const manifest = JSON.parse(
    fs.readFileSync(rights.owned_motion_manifest.path, "utf8"),
  );
  const templateRoles = [
    "hook_slam",
    "before_after_change",
    "verified_timeline",
    "owned_motion_backbone",
  ];
  manifest.assets = manifest.assets.map((asset, index) => ({
    ...asset,
    role: templateRoles[index],
    width: 1080,
    height: 1920,
    subject_match_quality: "generic_stock_or_filler",
    counted_for_premium: false,
    generator_identity: "pulse-governed-owned-motion-v1",
    provenance: {
      source: "repository_owned_generation",
      third_party_media_used: false,
    },
  }));
  const manifestSha256 = writeJson(
    rights.owned_motion_manifest.path,
    manifest,
  );
  rights.owned_motion_manifest.file_sha256 = manifestSha256;
  rights.items = rights.items.map((item, index) => ({
    ...item,
    rights_evidence: {
      reference: rights.owned_motion_manifest.path,
      sha256: manifestSha256,
    },
    usage: templateRoles[index],
    motion_family: templateRoles[index],
    exact_subject_motion_seconds: 0,
  }));
  rights.safety.owned_motion_only = true;
  rights.ledger_sha256 = hashRightsLedger(rights);
  blocked.rights_ledger.sha256 = writeJson(
    blocked.rights_ledger.path,
    rights,
  );
  let generatorCalls = 0;

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async () => {
      generatorCalls += 1;
      return generatedOutput(candidates);
    },
  });

  assert.equal(generatorCalls, 0);
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(
    result.blockers.includes(
      "weekly_candidate_evidence_not_fully_verified",
    ),
  );
  assert.ok(
    result.blockers.includes(
      `candidate:${blocked.id}:weekly_longform_visual_pack_template_only`,
    ),
  );
});

test("fails before generation when a candidate source file no longer matches its binding", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );
  fs.appendFileSync(candidates[2].source_evidence.path, "\n");
  let generatorCalls = 0;

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async () => {
      generatorCalls += 1;
      return generatedOutput(candidates);
    },
  });

  assert.equal(generatorCalls, 0);
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(
    result.blockers.includes(
      "weekly_candidate_evidence_not_fully_verified",
    ),
  );
  assert.ok(
    result.blockers.includes(
      `candidate:${candidates[2].id}:source_evidence_sha256_mismatch`,
    ),
  );
  assert.equal(result.enriched_candidates, null);
  assert.equal(result.safety.publish_authority_created, false);
});

test("rejects invented stories and every generator field outside the editorial-only contract", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );
  const output = generatedOutput(candidates);
  output.claims = [{ claim_id: "invented", text: "Invented claim" }];
  output.editorial_frame.source_url = "https://example.com/invented";
  output.weekly_longform_pitch[candidates[0].id].rights_ledger = {
    decision: "CLEARED",
  };
  output.weekly_longform_pitch["unknown-story"] =
    structuredClone(
      output.weekly_longform_pitch[candidates[0].id],
    );

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async () => output,
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.generator_output, null);
  assert.equal(result.enriched_candidates, null);
  assert.equal(result.work_order_result, null);
  assert.ok(
    result.blockers.includes(
      "generator_output_forbidden_field:output.claims",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "generator_output_forbidden_field:editorial_frame.source_url",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "generator_output_forbidden_field:" +
        `weekly_longform_pitch.${candidates[0].id}.rights_ledger`,
    ),
  );
  assert.ok(
    result.blockers.includes(
      "generator_output_unknown_story:unknown-story",
    ),
  );
});

test("rejects invented and cross-story claim or cleared-asset references", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );
  const output = generatedOutput(candidates);
  const firstPitch =
    output.weekly_longform_pitch[candidates[0].id];
  const foreignClaimId = `${candidates[1].id}-claim-1`;
  const foreignAssetId = `${candidates[1].id}-gameplay`;
  firstPitch.claim_ids = ["invented-claim", foreignClaimId];
  firstPitch.visual_beats[0].claim_ids = [foreignClaimId];
  firstPitch.visual_beats[0].asset_item_id = foreignAssetId;

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async () => output,
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.ok(
    result.blockers.includes(
      `generator_output_unknown_claim:${candidates[0].id}:invented-claim`,
    ),
  );
  assert.ok(
    result.blockers.includes(
      `generator_output_unknown_claim:${candidates[0].id}:${foreignClaimId}`,
    ),
  );
  assert.ok(
    result.blockers.includes(
      `generator_output_unknown_asset:${candidates[0].id}:${foreignAssetId}`,
    ),
  );
  assert.equal(result.enriched_candidates, null);
  assert.equal(result.work_order_result, null);
});

test("fails closed when the existing weekly work-order builder rejects generated runtime or visual coverage", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );
  const output = generatedOutput(candidates);
  output.editorial_frame.opening_script = "Brief opening.";
  output.editorial_frame.closing_script = "Brief closing.";
  for (const pitch of Object.values(output.weekly_longform_pitch)) {
    pitch.script_section = "One verified fact.";
    pitch.visual_beats = pitch.visual_beats.slice(0, 1);
  }

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async () => output,
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.enriched_candidates, null);
  assert.ok(result.work_order_result);
  assert.equal(
    result.work_order_result.production_runner_admission.status,
    "HOLD",
  );
  assert.ok(
    result.blockers.includes(
      "weekly_pitch_minimum_three_visual_beats_required",
    ),
  );
  assert.ok(
    result.blockers.includes("editorial_dossier_incomplete"),
  );
  assert.equal(result.safety.external_publish_triggered, false);
});

test("detects source-byte mutation that occurs while the injected generator runs", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async () => {
      fs.appendFileSync(candidates[0].source_evidence.path, "\nchanged");
      return generatedOutput(candidates);
    },
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.ok(
    result.blockers.includes(
      `source_evidence_changed_during_enrichment:${candidates[0].id}`,
    ),
  );
  assert.equal(result.evidence_preservation.all_match, false);
  assert.notEqual(
    result.evidence_preservation.before_sha256,
    result.evidence_preservation.after_sha256,
  );
  assert.equal(result.enriched_candidates, null);
  assert.equal(result.safety.publish_authority_created, false);
});

test("requires exactly 4 to 6 unique verified candidate inputs before calling a generator", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tooFew = [1, 2, 3].map((index) =>
    verifiedCandidate(root, index),
  );
  let calls = 0;

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates: tooFew,
    generator: async () => {
      calls += 1;
      return generatedOutput(tooFew);
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(
    result.blockers.includes(
      "weekly_verified_candidate_count_must_be_4_to_6",
    ),
  );
  assert.equal(result.generator_output, null);
  assert.equal(result.safety.database_authority_created, false);

  const tooMany = [4, 5, 6, 7, 8, 9, 10].map((index) =>
    verifiedCandidate(root, index),
  );
  const tooManyResult = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates: tooMany,
    generator: async () => {
      calls += 1;
      return generatedOutput(tooMany);
    },
  });
  assert.equal(calls, 0);
  assert.equal(tooManyResult.verdict, "BLOCKED");
  assert.ok(
    tooManyResult.blockers.includes(
      "weekly_verified_candidate_count_must_be_4_to_6",
    ),
  );
});

test("the optional Anthropic adapter is client-injected, JSON-only and provenance-bound", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );
  const calls = [];
  const client = {
    messages: {
      async create(payload) {
        calls.push(payload);
        return {
          id: "msg_weekly_fixture_001",
          content: [
            {
              type: "text",
              text: JSON.stringify(generatedOutput(candidates)),
            },
          ],
        };
      },
    },
  };
  const generator = createAnthropicWeeklyLongformJsonGenerator({
    client,
    model: "claude-weekly-test",
  });

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "claude-weekly-test");
  assert.equal(calls[0].max_tokens, 8_192);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].editorial_request_profile, undefined);
  assert.equal(calls[0].editorial_thinking_level, undefined);
  assert.equal(calls[0].editorial_response_json_schema, undefined);
  assert.match(calls[0].system, /JSON object only/i);
  assert.match(calls[0].system, /Never create or return claims/i);
  assert.equal(result.verdict, "READY_FOR_LOCAL_PRODUCTION");
  assert.equal(result.generator_provenance.provider, "anthropic");
  assert.equal(
    result.generator_provenance.model,
    "claude-weekly-test",
  );
  assert.equal(
    result.generator_provenance.adapter,
    "messages.create",
  );
});

test("the Google adapter uses medium thinking and a bounded 16K long-output default", async () => {
  const calls = [];
  const client = {
    editorial_identity: {
      provider: "google",
      model: "gemini-longform-test",
      adapter: "gemini.generateContent",
    },
    messages: {
      async create(payload) {
        calls.push(payload);
        return {
          content: [{ type: "text", text: "{}" }],
        };
      },
    },
  };
  const generator = createAnthropicWeeklyLongformJsonGenerator({
    client,
    model: "gemini-longform-test",
  });
  const request = {
    stories: Array.from({ length: 6 }, (_, index) => ({
      story_id: `story-${index + 1}`,
      verified_claims: [
        { claim_id: `claim-${index + 1}-primary` },
        { claim_id: `claim-${index + 1}-context` },
      ],
      cleared_asset_ids: [
        `asset-${index + 1}-hero`,
        `asset-${index + 1}-supporting`,
      ],
    })),
  };

  await generator(request);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].editorial_request_profile, "long_output");
  assert.equal(calls[0].editorial_thinking_level, "MEDIUM");
  assert.equal(calls[0].max_tokens, 16_384);
  assert.deepEqual(
    calls[0].editorial_response_json_schema,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        editorial_frame: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            [
              "episode_title",
              "editorial_thesis",
              "opening_script",
              "closing_script",
            ].map((key) => [key, { type: "string" }]),
          ),
          required: [
            "episode_title",
            "editorial_thesis",
            "opening_script",
            "closing_script",
          ],
        },
        weekly_longform_pitch: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            request.stories.map((story) => {
              const claimIds = story.verified_claims.map(
                (claim) => claim.claim_id,
              );
              return [
                story.story_id,
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    section_title: { type: "string" },
                    angle: { type: "string" },
                    why_it_matters: { type: "string" },
                    claim_ids: {
                      type: "array",
                      minItems: 1,
                      maxItems: claimIds.length,
                      items: {
                        type: "string",
                        enum: claimIds,
                      },
                    },
                    script_section: { type: "string" },
                    visual_beats: {
                      type: "array",
                      minItems: 3,
                      maxItems: 3,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          beat_id: { type: "string" },
                          purpose: { type: "string" },
                          asset_item_id: {
                            type: "string",
                            enum: story.cleared_asset_ids,
                          },
                          treatment: { type: "string" },
                          claim_ids: {
                            type: "array",
                            minItems: 1,
                            maxItems: claimIds.length,
                            items: {
                              type: "string",
                              enum: claimIds,
                            },
                          },
                        },
                        required: [
                          "beat_id",
                          "purpose",
                          "asset_item_id",
                          "treatment",
                          "claim_ids",
                        ],
                      },
                    },
                    derivative_hooks: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        short: { type: "string" },
                        social_thread: { type: "string" },
                      },
                      required: ["short", "social_thread"],
                    },
                  },
                  required: [
                    "section_title",
                    "angle",
                    "why_it_matters",
                    "claim_ids",
                    "script_section",
                    "visual_beats",
                    "derivative_hooks",
                  ],
                },
              ];
            }),
          ),
          required: request.stories.map((story) => story.story_id),
        },
      },
      required: ["editorial_frame", "weekly_longform_pitch"],
    },
  );
  assert.match(calls[0].system, /8 to 12 minute/i);
  assert.match(calls[0].system, /196 words per story/i);
  assert.match(calls[0].system, /exactly three visual beats/i);
  assert.doesNotMatch(
    JSON.stringify(calls[0]),
    /source_evidence|rights_ledger/,
  );
});

test("the Ollama adapter receives the exact story-bound structured-output contract without paid-model thinking controls", async () => {
  const calls = [];
  const client = {
    editorial_identity: {
      provider: "ollama",
      model: "qwen3.5:27b",
      adapter: "ollama.api.chat",
    },
    messages: {
      async create(payload) {
        calls.push(payload);
        return {
          content: [{ type: "text", text: "{}" }],
        };
      },
    },
  };
  const generator = createAnthropicWeeklyLongformJsonGenerator({
    client,
    model: "qwen3.5:27b",
  });
  const request = {
    stories: Array.from({ length: 4 }, (_, index) => ({
      story_id: `local-story-${index + 1}`,
      verified_claims: [
        { claim_id: `local-claim-${index + 1}` },
      ],
      cleared_asset_ids: [`local-asset-${index + 1}`],
    })),
  };

  await generator(request);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].editorial_request_profile, "long_output");
  assert.equal(calls[0].editorial_thinking_level, undefined);
  assert.equal(calls[0].max_tokens, 16_384);
  assert.deepEqual(
    calls[0].editorial_response_json_schema.properties
      .weekly_longform_pitch.properties["local-story-1"]
      .properties.claim_ids.items,
    {
      type: "string",
      enum: ["local-claim-1"],
    },
  );
});

test("renders hash-bound JSON and an operator-readable no-authority Markdown result", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );
  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async () => generatedOutput(candidates),
    generator_identity: {
      provider: "test",
      model: "fixture-model",
      adapter: "injected",
    },
  });

  const json = renderWeeklyLongformEditorialEnrichmentJson(result);
  assert.deepEqual(JSON.parse(json), result);

  const markdown =
    renderWeeklyLongformEditorialEnrichmentMarkdown(result);
  assert.match(
    markdown,
    /^# Pulse Gaming Weekly Longform Editorial Enrichment/m,
  );
  assert.match(markdown, /Verdict: READY_FOR_LOCAL_PRODUCTION/);
  assert.match(markdown, /Enriched verified stories: 4/);
  assert.match(markdown, /Request SHA-256: `[a-f0-9]{64}`/);
  assert.match(markdown, /Output SHA-256: `[a-f0-9]{64}`/);
  assert.match(
    markdown,
    /does not grant approval, scheduler, database or publish authority/i,
  );
});

test("generator failures return a sanitised fail-closed LOCAL_PROOF result", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async () => {
      const error = new Error("sensitive provider detail");
      error.code = "secret-account-identifier";
      throw error;
    },
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(
    result.generator_error_code,
    "editorial_generation_failed",
  );
  assert.deepEqual(result.blockers, [
    "weekly_editorial_json_generation_failed",
  ]);
  assert.equal(result.generator_output, null);
  assert.equal(result.enriched_candidates, null);
  assert.equal(
    JSON.stringify(result).includes("sensitive provider detail"),
    false,
  );
  assert.equal(result.safety.external_publish_triggered, false);
});

test("generator timeouts expose only a normalised code and a timeout-specific blocker", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );
  const secret = "provider-secret-must-not-survive";

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async () => {
      const error = new Error("editorial_request_timeout");
      error.cause = new Error(secret);
      error.provider_response = secret;
      throw error;
    },
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(
    result.generator_error_code,
    "editorial_request_timeout",
  );
  assert.deepEqual(result.blockers, [
    "weekly_editorial_json_generation_failed",
    "weekly_editorial_json_generation_timeout",
  ]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  const markdown =
    renderWeeklyLongformEditorialEnrichmentMarkdown(result);
  assert.match(
    markdown,
    /Generator error code: `editorial_request_timeout`/,
  );
  assert.doesNotMatch(markdown, new RegExp(secret));
  assert.equal(result.generator_output, null);
  assert.equal(result.safety.external_publish_triggered, false);
});

test("evidence preservation remains truthful when a generator mutates rights bytes and returns invalid output", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidates = [1, 2, 3, 4].map((index) =>
    verifiedCandidate(root, index),
  );

  const result = await enrichWeeklyLongformEditorial({
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    candidates,
    generator: async () => {
      fs.appendFileSync(candidates[1].rights_ledger.path, "\nchanged");
      return {
        ...generatedOutput(candidates),
        invented_field: true,
      };
    },
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.ok(
    result.blockers.includes(
      `rights_ledger_changed_during_enrichment:${candidates[1].id}`,
    ),
  );
  assert.ok(
    result.blockers.includes(
      "generator_output_forbidden_field:output.invented_field",
    ),
  );
  assert.equal(result.evidence_preservation.all_match, false);
  assert.notEqual(
    result.evidence_preservation.before_sha256,
    result.evidence_preservation.after_sha256,
  );
});

test("the enrichment service has no database, publisher, token or bundled provider-client authority", () => {
  const source = fs.readFileSync(SERVICE_PATH, "utf8");
  assert.doesNotMatch(source, /\bgetRepos\s*\(/);
  assert.doesNotMatch(source, /require\(["']\.\.\/publisher["']\)/);
  assert.doesNotMatch(source, /require\(["']@anthropic-ai\/sdk["']\)/);
  assert.doesNotMatch(source, /tokens[\\/]/i);
  assert.doesNotMatch(source, /process\.env\./);
});
