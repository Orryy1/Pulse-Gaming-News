"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  AUTONOMOUS_PACKAGE_MANIFEST_SCHEMA_VERSION,
  CLAIM_MAP_SCHEMA_VERSION,
  FINAL_MEDIA_INVENTORY_SCHEMA_VERSION,
  MEDIA_RIGHTS_EVIDENCE_SCHEMA_VERSION,
  PROMPT_INJECTION_CONTROL_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  SUPPLEMENT_SCHEMA_VERSION,
  materialiseAutonomousGreenSupplement,
} = require("../../lib/services/autonomous-green-supplement-materializer");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function writeJson(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes, { flag: "wx" });
  return {
    path: filePath,
    sha256: sha256(bytes),
    value,
  };
}

async function replaceJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.writeFile(filePath, bytes);
  return sha256(bytes);
}

async function replaceWordTimestampsAndRebind(fixture, value) {
  const timestampsSha256 = await replaceJson(
    fixture.request.word_timestamps.path,
    value,
  );
  fixture.request.word_timestamps.sha256 = timestampsSha256;

  const inventory = JSON.parse(
    await fs.readFile(fixture.request.final_media_inventory.path, "utf8"),
  );
  inventory.timestamps_sha256 = timestampsSha256;
  const inventorySha256 = await replaceJson(
    fixture.request.final_media_inventory.path,
    inventory,
  );
  fixture.request.final_media_inventory.sha256 = inventorySha256;

  const packageManifest = JSON.parse(
    await fs.readFile(fixture.request.autonomous_package_manifest.path, "utf8"),
  );
  packageManifest.lineage.timestamps_sha256 = timestampsSha256;
  packageManifest.lineage.media_inventory_sha256 = inventorySha256;
  fixture.request.autonomous_package_manifest.sha256 = await replaceJson(
    fixture.request.autonomous_package_manifest.path,
    packageManifest,
  );
}

function commercialScope() {
  return {
    destinations: ["YOUTUBE"],
    revenue_modes: ["ORGANIC", "PLATFORM_ADVERTISING"],
    territory: "WORLDWIDE",
    account_id: "pulse-gaming-youtube",
  };
}

function rightsItem({
  itemId,
  mediaRole,
  assetSha256,
  rightsEvidenceSha256,
  rightsBasis,
  licenceDocumentSha256,
}) {
  return {
    item_id: itemId,
    media_role: mediaRole,
    asset_sha256: assetSha256,
    included_in_final: true,
    rights_decision: "CLEARED",
    rights_basis: rightsBasis,
    rights_evidence_sha256: rightsEvidenceSha256,
    licence_document_sha256: licenceDocumentSha256,
    review_status: "VERIFIED",
    risk_decision: null,
    attribution_decision: "NOT_REQUIRED",
    attribution_text: null,
    scope: commercialScope(),
  };
}

async function createGreenFixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-green-supplement-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "output"), { recursive: true });

  const storyId = "official-xbox-001";
  const channelId = "pulse-gaming";
  const laneId = "breaking_short";
  const generatedAt = "2026-07-29T12:00:00.000Z";
  const scriptSha256 = sha256("exact governed script");
  const narrationSha256 = sha256("final narration audio");
  const finalMp4Sha256 = sha256("final composite mp4");
  const visualAssetSha256 = sha256("owned visual asset");
  const sourceIntakeSha256 = sha256("governed source intake");

  const claimMap = await writeJson(root, "evidence/claim-map.json", {
    schema_version: CLAIM_MAP_SCHEMA_VERSION,
    story_id: storyId,
    channel_id: channelId,
    lane_id: laneId,
    generated_at: "2026-07-29T11:30:00.000Z",
    source_intake_sha256: sourceIntakeSha256,
    script_sha256: scriptSha256,
    claims: [
      {
        claim_id: "xbox.confirmed.release",
        claim_text_sha256: sha256("Xbox confirmed the release."),
        source_evidence_sha256: sha256("official claim evidence"),
        verification_status: "CONFIRMED",
        script_sections: ["HOOK", "BODY"],
      },
    ],
  });

  const wordTimestamps = await writeJson(
    root,
    "evidence/word-timestamps.json",
    {
      schema_version: "pulse-word-timestamps-v1",
      story_id: storyId,
      generated_at: "2026-07-29T11:40:00.000Z",
      script_sha256: scriptSha256,
      source_alignment_sha256: sha256("provider alignment response"),
      audio_sha256: narrationSha256,
      audio_duration_seconds: 1.8,
      character_count: 26,
      word_count: 4,
      words: [
        { text: "Xbox", start_seconds: 0.05, end_seconds: 0.35 },
        { text: "confirmed", start_seconds: 0.4, end_seconds: 0.8 },
        { text: "the", start_seconds: 0.86, end_seconds: 1.02 },
        { text: "release.", start_seconds: 1.08, end_seconds: 1.7 },
      ],
    },
  );

  const narrationLicence = await writeJson(
    root,
    "rights/narration-licence.json",
    {
      schema_version: "pulse-commercial-licence-document-v1",
      story_id: storyId,
      provider: "elevenlabs",
      decision: "COMMERCIAL_USE_CONFIRMED",
    },
  );
  const ownedRightsValue = {
    schema_version: MEDIA_RIGHTS_EVIDENCE_SCHEMA_VERSION,
    story_id: storyId,
    channel_id: channelId,
    lane_id: laneId,
    item_id: "owned-motion",
    media_role: "VISUAL",
    asset_sha256: visualAssetSha256,
    rights_decision: "CLEARED",
    rights_basis: "OWNED",
    licence_document_sha256: null,
    review_status: "VERIFIED",
    risk_decision: null,
    attribution_decision: "NOT_REQUIRED",
    attribution_text: null,
    scope: commercialScope(),
  };
  const ownedRights = await writeJson(
    root,
    "rights/owned-motion.json",
    ownedRightsValue,
  );
  const narrationRightsValue = {
    schema_version: MEDIA_RIGHTS_EVIDENCE_SCHEMA_VERSION,
    story_id: storyId,
    channel_id: channelId,
    lane_id: laneId,
    item_id: "narration",
    media_role: "NARRATION",
    asset_sha256: narrationSha256,
    rights_decision: "CLEARED",
    rights_basis: "LICENSED",
    licence_document_sha256: narrationLicence.sha256,
    review_status: "VERIFIED",
    risk_decision: null,
    attribution_decision: "NOT_REQUIRED",
    attribution_text: null,
    scope: commercialScope(),
  };
  const narrationRights = await writeJson(
    root,
    "rights/narration.json",
    narrationRightsValue,
  );

  const mediaItems = [
    rightsItem({
      itemId: "narration",
      mediaRole: "NARRATION",
      assetSha256: narrationSha256,
      rightsEvidenceSha256: narrationRights.sha256,
      rightsBasis: "LICENSED",
      licenceDocumentSha256: narrationLicence.sha256,
    }),
    rightsItem({
      itemId: "owned-motion",
      mediaRole: "VISUAL",
      assetSha256: visualAssetSha256,
      rightsEvidenceSha256: ownedRights.sha256,
      rightsBasis: "OWNED",
      licenceDocumentSha256: null,
    }),
  ];
  const finalMediaInventory = await writeJson(
    root,
    "evidence/final-media-inventory.json",
    {
      schema_version: FINAL_MEDIA_INVENTORY_SCHEMA_VERSION,
      story_id: storyId,
      channel_id: channelId,
      lane_id: laneId,
      platform: "youtube",
      generated_at: "2026-07-29T11:50:00.000Z",
      complete: true,
      item_count: mediaItems.length,
      script_sha256: scriptSha256,
      narration_sha256: narrationSha256,
      timestamps_sha256: wordTimestamps.sha256,
      final_mp4_sha256: finalMp4Sha256,
      items: mediaItems,
    },
  );

  const promptInjectionControl = await writeJson(
    root,
    "evidence/prompt-injection-control.json",
    {
      schema_version: PROMPT_INJECTION_CONTROL_SCHEMA_VERSION,
      story_id: storyId,
      channel_id: channelId,
      lane_id: laneId,
      evaluated_at: "2026-07-29T11:35:00.000Z",
      policy_id: "pulse-untrusted-source-content-v1",
      source_intake_sha256: sourceIntakeSha256,
      untrusted_content_treated_as_data: true,
      instructions_followed_from_source: false,
      detected: false,
      signals: [],
      verdict: "PASS",
    },
  );

  const rightsLedgerItems = mediaItems.map(
    ({ media_role: _mediaRole, ...item }) => item,
  );
  const rightsLedgerSha256 = canonicalSha256({
    schema_version: "pulse-autonomous-media-rights-ledger-v1",
    story_id: storyId,
    channel_id: channelId,
    lane_id: laneId,
    decision: "CLEARED",
    items: rightsLedgerItems,
  });
  const autonomousPackageManifest = await writeJson(
    root,
    "evidence/autonomous-package-manifest.json",
    {
      schema_version: AUTONOMOUS_PACKAGE_MANIFEST_SCHEMA_VERSION,
      mode: "LOCAL_PROOF",
      story_id: storyId,
      channel_id: channelId,
      lane_id: laneId,
      platform: "youtube",
      generated_at: generatedAt,
      lineage: {
        source_intake_sha256: sourceIntakeSha256,
        claim_map_sha256: claimMap.sha256,
        script_sha256: scriptSha256,
        narration_sha256: narrationSha256,
        timestamps_sha256: wordTimestamps.sha256,
        media_inventory_sha256: finalMediaInventory.sha256,
        rights_ledger_sha256: rightsLedgerSha256,
        motion_manifest_sha256: sha256("owned motion manifest"),
        render_manifest_sha256: sha256("renderer manifest"),
        final_mp4_sha256: finalMp4Sha256,
        qa_report_sha256: sha256("deterministic qa report"),
        publication_metadata_sha256: sha256("publication metadata"),
      },
      prompt_injection_control_sha256: promptInjectionControl.sha256,
      media_items: mediaItems,
      controls: {
        local_proof_only: true,
        publish_authority: false,
        scheduler_authority: false,
        database_authority: false,
        oauth_or_token_authority: false,
        network_authority: false,
      },
    },
  );

  return {
    root,
    request: {
      schema_version: REQUEST_SCHEMA_VERSION,
      mode: "LOCAL_PROOF",
      story_id: storyId,
      channel_id: channelId,
      lane_id: laneId,
      platform: "youtube",
      generated_at: generatedAt,
      output_dir: path.join(root, "output", "green-supplement"),
      claim_map: {
        path: claimMap.path,
        sha256: claimMap.sha256,
      },
      word_timestamps: {
        path: wordTimestamps.path,
        sha256: wordTimestamps.sha256,
      },
      final_media_inventory: {
        path: finalMediaInventory.path,
        sha256: finalMediaInventory.sha256,
      },
      prompt_injection_control: {
        path: promptInjectionControl.path,
        sha256: promptInjectionControl.sha256,
      },
      media_rights_evidence: [
        {
          item_id: "narration",
          rights_evidence: {
            path: narrationRights.path,
            sha256: narrationRights.sha256,
          },
          licence_document: {
            path: narrationLicence.path,
            sha256: narrationLicence.sha256,
          },
        },
        {
          item_id: "owned-motion",
          rights_evidence: {
            path: ownedRights.path,
            sha256: ownedRights.sha256,
          },
          licence_document: null,
        },
      ],
      autonomous_package_manifest: {
        path: autonomousPackageManifest.path,
        sha256: autonomousPackageManifest.sha256,
      },
    },
  };
}

test("materialises one deterministic, idempotent LOCAL_PROOF GREEN supplement with no external authority", async (t) => {
  const fixture = await createGreenFixture(t);

  const first = await materialiseAutonomousGreenSupplement(fixture.request);
  const second = await materialiseAutonomousGreenSupplement(fixture.request);

  assert.equal(first.schema_version, SUPPLEMENT_SCHEMA_VERSION);
  assert.equal(first.mode, "LOCAL_PROOF");
  assert.equal(first.verdict, "GREEN");
  assert.equal(first.story_id, fixture.request.story_id);
  assert.equal(first.channel_id, "pulse-gaming");
  assert.equal(first.lane_id, "breaking_short");
  assert.equal(first.validated.claim_count, 1);
  assert.equal(first.validated.word_count, 4);
  assert.equal(first.validated.final_media_item_count, 2);
  assert.equal(first.validated.prompt_injection_verdict, "PASS");
  assert.equal(first.validated.distinct_lineage_digests, true);
  assert.equal(first.validated.distinct_rights_evidence_digests, true);
  assert.deepEqual(first.safety, {
    local_proof_only: true,
    publish_authority: false,
    scheduler_authority: false,
    database_authority: false,
    oauth_or_token_authority: false,
    network_authority: false,
    network_used: false,
    platform_contacted: false,
  });
  assert.deepEqual(second, first);

  const written = JSON.parse(await fs.readFile(first.json_path, "utf8"));
  const { supplement_sha256: supplementSha256, ...canonicalPayload } = written;
  assert.equal(supplementSha256, canonicalSha256(canonicalPayload));
  assert.equal(first.supplement_sha256, supplementSha256);
  assert.equal(
    first.json_file_sha256,
    sha256(await fs.readFile(first.json_path)),
  );
  assert.equal(
    first.markdown_file_sha256,
    sha256(await fs.readFile(first.markdown_path)),
  );
  const markdown = await fs.readFile(first.markdown_path, "utf8");
  assert.match(markdown, /^# Autonomous GREEN supplement/m);
  assert.match(markdown, new RegExp(supplementSha256));
  assert.match(markdown, /LOCAL_PROOF/);
  assert.match(
    markdown,
    /grants no publish, scheduling, database, OAuth, token or network authority/i,
  );
});

test("accepts the exact live provider timestamp rounding but rejects a material audio overrun", async (t) => {
  const roundedFixture = await createGreenFixture(t);
  const roundedTimestampsPath = roundedFixture.request.word_timestamps.path;
  const roundedTimestamps = JSON.parse(
    await fs.readFile(roundedTimestampsPath, "utf8"),
  );
  roundedTimestamps.words.at(-1).end_seconds = 19.691;
  roundedTimestamps.audio_duration_seconds = 19.690522;
  await replaceWordTimestampsAndRebind(roundedFixture, roundedTimestamps);

  const rounded = await materialiseAutonomousGreenSupplement(
    roundedFixture.request,
  );
  assert.equal(rounded.verdict, "GREEN");

  const overrunFixture = await createGreenFixture(t);
  const overrunTimestampsPath = overrunFixture.request.word_timestamps.path;
  const overrunTimestamps = JSON.parse(
    await fs.readFile(overrunTimestampsPath, "utf8"),
  );
  overrunTimestamps.words.at(-1).end_seconds = 19.691;
  overrunTimestamps.audio_duration_seconds = 19.680999;
  await replaceWordTimestampsAndRebind(overrunFixture, overrunTimestamps);

  await assert.rejects(
    materialiseAutonomousGreenSupplement(overrunFixture.request),
    {
      code: "autonomous_green_supplement_word_timing_invalid",
    },
  );
});

test("fails closed when prompt-control proof is reused as a lineage digest", async (t) => {
  const fixture = await createGreenFixture(t);
  const packagePath = fixture.request.autonomous_package_manifest.path;
  const packageValue = JSON.parse(await fs.readFile(packagePath, "utf8"));
  packageValue.lineage.motion_manifest_sha256 =
    fixture.request.prompt_injection_control.sha256;
  fixture.request.autonomous_package_manifest.sha256 = await replaceJson(
    packagePath,
    packageValue,
  );

  await assert.rejects(materialiseAutonomousGreenSupplement(fixture.request), {
    code: "autonomous_green_supplement_lineage_digest_reuse",
  });
});

test("closed request and package schemas reject authority smuggling and non-LOCAL_PROOF modes", async (t) => {
  const requestFixture = await createGreenFixture(t);
  await assert.rejects(
    materialiseAutonomousGreenSupplement({
      ...requestFixture.request,
      publish_authority: true,
    }),
    {
      code: "autonomous_green_supplement_request_fields_invalid",
    },
  );
  await assert.rejects(
    materialiseAutonomousGreenSupplement({
      ...requestFixture.request,
      mode: "LIVE_GUARDED",
    }),
    {
      code: "autonomous_green_supplement_local_proof_only",
    },
  );

  const packageFixture = await createGreenFixture(t);
  const packagePath = packageFixture.request.autonomous_package_manifest.path;
  const packageValue = JSON.parse(await fs.readFile(packagePath, "utf8"));
  packageValue.controls.publish_authority = true;
  packageFixture.request.autonomous_package_manifest.sha256 = await replaceJson(
    packagePath,
    packageValue,
  );
  await assert.rejects(
    materialiseAutonomousGreenSupplement(packageFixture.request),
    {
      code: "autonomous_green_supplement_package_no_authority_required",
    },
  );
});

test("re-hashes real referenced files and rejects closed-schema or semantic drift", async (t) => {
  const tamperedFixture = await createGreenFixture(t);
  await fs.appendFile(
    tamperedFixture.request.claim_map.path,
    Buffer.from("tampered", "utf8"),
  );
  await assert.rejects(
    materialiseAutonomousGreenSupplement(tamperedFixture.request),
    {
      code: "autonomous_green_supplement_claim_map_sha256_mismatch",
    },
  );

  const schemaFixture = await createGreenFixture(t);
  const claimPath = schemaFixture.request.claim_map.path;
  const claimValue = JSON.parse(await fs.readFile(claimPath, "utf8"));
  claimValue.publish_now = true;
  schemaFixture.request.claim_map.sha256 = await replaceJson(
    claimPath,
    claimValue,
  );
  await assert.rejects(
    materialiseAutonomousGreenSupplement(schemaFixture.request),
    {
      code: "autonomous_green_supplement_claim_map_fields_invalid",
    },
  );

  const bindingFixture = await createGreenFixture(t);
  const timestampsPath = bindingFixture.request.word_timestamps.path;
  const timestampsValue = JSON.parse(await fs.readFile(timestampsPath, "utf8"));
  timestampsValue.story_id = "different-story";
  bindingFixture.request.word_timestamps.sha256 = await replaceJson(
    timestampsPath,
    timestampsValue,
  );
  await assert.rejects(
    materialiseAutonomousGreenSupplement(bindingFixture.request),
    {
      code: "autonomous_green_supplement_word_timestamps_story_id_mismatch",
    },
  );
});

test("fails closed when distinct final-media items reuse one rights-evidence digest", async (t) => {
  const fixture = await createGreenFixture(t);
  const inventoryPath = fixture.request.final_media_inventory.path;
  const inventory = JSON.parse(await fs.readFile(inventoryPath, "utf8"));
  inventory.items[1].rights_evidence_sha256 =
    inventory.items[0].rights_evidence_sha256;
  fixture.request.final_media_inventory.sha256 = await replaceJson(
    inventoryPath,
    inventory,
  );

  await assert.rejects(materialiseAutonomousGreenSupplement(fixture.request), {
    code: "autonomous_green_supplement_rights_evidence_digest_reuse",
  });
});

test("an existing output is accepted only when both deterministic artefacts are byte-exact", async (t) => {
  const fixture = await createGreenFixture(t);
  const result = await materialiseAutonomousGreenSupplement(fixture.request);
  await fs.appendFile(
    result.markdown_path,
    Buffer.from("conflicting operator edit\n", "utf8"),
  );

  await assert.rejects(materialiseAutonomousGreenSupplement(fixture.request), {
    code: "autonomous_green_supplement_output_conflict",
  });
});
