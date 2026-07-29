"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  REQUEST_SCHEMA_VERSION,
  compileGovernedAutonomousBreakingCandidateContract,
} = require("../../lib/services/governed-autonomous-breaking-candidate-contract-compiler");
const {
  CANDIDATE_SCHEMA_VERSION,
} = require("../../lib/services/governed-autonomous-window-production-planner");
const {
  BUILDER_SCHEMA_VERSION,
  RUNTIME_POLICY_SCHEMA_VERSION,
  buildGovernedAutonomousProductionRequest,
} = require("../../lib/services/governed-autonomous-production-request-builder");
const {
  ARTIFACT_SCHEMA_VERSION: RESERVATION_SCHEMA_VERSION,
  canonicalSha256: reservationSha256,
} = require("../../lib/services/governed-autonomous-window-reservation-set");
const {
  hydrateGovernedEditorialInventoryCandidates,
} = require("../../lib/services/governed-editorial-inventory-candidate-hydrator");
const {
  materializeGovernedLockedStoryIntakeFromInventory,
} = require("../../lib/services/governed-story-intake-inventory-bridge");
const {
  validateStoryIntakeManifest,
} = require("../../lib/services/governed-story-intake");
const {
  canonicalHash,
} = require("../../lib/services/url-canonical");
const {
  buildLockedYazdInventoryFixture,
} = require("../fixtures/governed-story-intake-inventory-bridge");

const GENERATED_AT = "2026-07-29T06:00:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const STANDARD_SCRIPT =
  "Yet Another Zombie Defense HD is free to keep on Steam, but the offer ends on 30 July. Build barricades by day, then survive the night alone or with up to four players. Claim it before the deadline and the full game is yours to keep.";

function runtimePolicy() {
  return {
    narration: {
      provider: "elevenlabs",
      voice_id: "pulse-liam-approved",
      model_id: "eleven_multilingual_v2",
      speed: 1,
    },
    visual_qa: {
      reviewers: [
        {
          provider: "ollama",
          model: "gemma3:12b",
          endpoint_origin: "http://127.0.0.1:11434",
        },
        {
          provider: "ollama",
          model: "qwen2.5vl:7b",
          endpoint_origin: "http://127.0.0.1:11434",
        },
      ],
    },
    disclosure_policy: {
      policy_id: "pulse-youtube-synthetic-media",
      policy_version: "1",
    },
  };
}

function localProofSafety() {
  return {
    local_proof_only: true,
    database_authority: false,
    database_mutated: false,
    network_authority: false,
    network_used: false,
    oauth_or_token_authority: false,
    oauth_or_tokens_mutated: false,
    platform_contacted: false,
    publish_authority: false,
    scheduler_authority: false,
    external_publish_authorised: false,
  };
}

async function standardFixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-breaking-contract-compiler-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inventory = await buildLockedYazdInventoryFixture(root, {
    storyId: "rss_locked_yazd_standard",
  });
  const workspaceRoot = path.join(root, "trusted-workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const hydration =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: inventory.storyId,
          stage: "PLANNING",
          supplemental_official_sources: [
            {
              path: inventory.supplementalPath,
              file_sha256: inventory.supplementalFileSha256,
              canonical_sha256:
                inventory.storePacket.packet_sha256,
            },
          ],
        },
      ],
      inventoryRoot: inventory.inventoryRoot,
      allowedRoots: [inventory.outputRoot, root],
    });
  assert.equal(hydration.verdict, "READY");
  return {
    root,
    inventory,
    workspaceRoot,
    candidate: hydration.candidates[0],
    story: {
      id: inventory.storyId,
      title: inventory.registry.story.title,
      url: inventory.newsUrl,
      full_script: STANDARD_SCRIPT,
      breaking_score: 140,
    },
  };
}

function compileInput(values, overrides = {}) {
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    generated_at: GENERATED_AT,
    scheduled_for: SCHEDULED_FOR,
    workspace_root: values.workspaceRoot,
    inventory_root: values.inventory.inventoryRoot,
    allowed_roots: [
      values.inventory.outputRoot,
      values.root,
    ],
    candidate: values.candidate,
    story: values.story,
    runtime_policy: runtimePolicy(),
    ...overrides,
  };
}

function refinalisePacket(packet, canonicalSha256) {
  const base = structuredClone(packet);
  delete base.packet_sha256;
  delete base.source_evidence_sha256;
  delete base.planner_evidence;
  const packetSha256 = canonicalSha256(base);
  return {
    ...base,
    packet_sha256: packetSha256,
    source_evidence_sha256: packetSha256,
    planner_evidence: {
      evidence_packet_schema: base.schema_version,
      verification_status: base.verification_status,
      confirmation_basis: base.confirmation_basis,
      primary_source_url: base.primary_source_url,
      source_evidence_sha256: packetSha256,
      verified_for_planning: base.verified_for_planning,
    },
  };
}

function walkFields(value, visit) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkFields(item, visit);
    return;
  }
  for (const [field, child] of Object.entries(value)) {
    visit(field, child);
    walkFields(child, visit);
  }
}

test("compiles a hydrated READY official source and exact DB story into the planner candidate contract without materialising its source path", async (t) => {
  const values = await standardFixture(t);

  const candidate =
    await compileGovernedAutonomousBreakingCandidateContract(
      compileInput(values),
    );

  const canonicalStoryId =
    `official_${canonicalHash(values.inventory.newsUrl)}`;
  assert.equal(candidate.schema_version, CANDIDATE_SCHEMA_VERSION);
  assert.equal(candidate.story_id, canonicalStoryId);
  assert.equal(candidate.source_type, "official");
  assert.equal(candidate.verification_status, "CONFIRMED");
  assert.equal(candidate.eligibility_verdict, "GREEN");
  assert.equal(candidate.selection_score, 140);
  assert.equal(
    candidate.locked_intake_binding.story_id,
    canonicalStoryId,
  );
  assert.equal(
    candidate.locked_intake_binding.locked_intake.inventory_path,
    values.inventory.registryPath,
  );
  assert.equal(
    candidate.locked_intake_binding.locked_intake.final_script,
    values.story.full_script,
  );
  assert.deepEqual(
    {
      canonical_story_id:
        candidate.locked_intake_binding.locked_intake
          .database_story_binding.canonical_story_id,
      database_story_id:
        candidate.locked_intake_binding.locked_intake
          .database_story_binding.database_story_id,
      inventory_file_sha256:
        candidate.locked_intake_binding.locked_intake
          .database_story_binding.inventory_file_sha256,
    },
    {
      canonical_story_id: canonicalStoryId,
      database_story_id: values.story.id,
      inventory_file_sha256:
        values.inventory.registryFileSha256,
    },
  );
  assert.deepEqual(
    candidate.locked_intake_binding.locked_intake
      .script_claim_bindings.map((binding) => binding.clause),
    STANDARD_SCRIPT.split(/(?<=[.!?])\s+/),
  );
  assert.ok(
    candidate.locked_intake_binding.locked_intake
      .script_claim_bindings.every(
        (binding) =>
          binding.claim_keys.length > 0 &&
          binding.claim_keys.every((claimKey) =>
            [
              "awesome_games_studio.yazd_hd.free",
              "awesome_games_studio.yazd_hd.claim_period",
              "yet_another_zombie_defense.store_description",
              "yet_another_zombie_defense.gameplay_loop",
              "yet_another_zombie_defense.coop",
              "yet_another_zombie_defense.discount_percent",
              "yet_another_zombie_defense.normal_price",
              "yet_another_zombie_defense.current_price",
            ].includes(claimKey),
          ),
      ),
  );
  assert.equal(
    candidate.locked_intake_binding.locked_intake.contract
      .duration_band_id,
    "what_changes_short_25_32",
  );
  assert.equal(
    Object.hasOwn(
      candidate.locked_intake_binding.locked_intake.contract,
      "target_duration_review",
    ),
    false,
  );
  assert.equal(candidate.creative_package.scenes.length, 6);
  assert.ok(
    candidate.creative_package.scenes.every(
      (scene) =>
        scene.ownership === "owned" &&
        scene.rights_basis === "OWNED" &&
        scene.provenance.third_party_media_used === false &&
        scene.provenance.third_party_music === false,
    ),
  );
  assert.equal(
    candidate.runtime_policy.schema_version,
    RUNTIME_POLICY_SCHEMA_VERSION,
  );
  assert.equal(
    candidate.runtime_policy.candidate_source_root,
    path.join(
      values.workspaceRoot,
      "output",
      "canary",
      canonicalStoryId,
    ),
  );
  assert.equal(
    fs.existsSync(candidate.runtime_policy.candidate_source_root),
    false,
  );
  assert.match(candidate.candidate_revision_sha256, /^[a-f0-9]{64}$/);
  assert.match(candidate.request_fingerprint, /^[a-f0-9]{64}$/);

  const reservationBody = {
    schema_version: RESERVATION_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    state: "RESERVED_LOCAL_PROOF",
    binding_scope: "WINDOW_STORY_ROLE_ONLY",
    generated_at: GENERATED_AT,
    scheduled_for: SCHEDULED_FOR,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    reservations: [
      { role: "PRIMARY", story_id: canonicalStoryId },
      {
        role: "STANDBY",
        story_id: "official_standby-contract",
      },
    ],
    safety: localProofSafety(),
  };
  const builder = buildGovernedAutonomousProductionRequest({
    schema_version: BUILDER_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    reservation_set: {
      ...reservationBody,
      reservation_set_sha256:
        reservationSha256(reservationBody),
    },
    selected_role: "PRIMARY",
    story_id: candidate.story_id,
    locked_intake_binding: candidate.locked_intake_binding,
    creative_package: candidate.creative_package,
    runtime_policy: candidate.runtime_policy,
    candidate_revision_sha256:
      candidate.candidate_revision_sha256,
    request_fingerprint: candidate.request_fingerprint,
  });
  assert.equal(builder.story_id, candidate.story_id);
  assert.equal(
    builder.production_request.locked_intake.final_script,
    values.story.full_script,
  );

  const locked =
    candidate.locked_intake_binding.locked_intake;
  const intake =
    await materializeGovernedLockedStoryIntakeFromInventory({
      inventoryPath: locked.inventory_path,
      inventoryFileSha256: locked.inventory_file_sha256,
      inventoryRoot: locked.inventory_root,
      allowedRoots: locked.allowed_roots,
      canonicalIdentityUrl: locked.canonical_identity_url,
      finalScript: locked.final_script,
      finalScriptSha256: locked.final_script_sha256,
      scriptClaimBindings: locked.script_claim_bindings,
      presentationClaimBindings:
        locked.presentation_claim_bindings,
      supplementalOfficialSources:
        locked.supplemental_official_sources,
      contract: locked.contract,
      freshness: locked.freshness,
      visualBrief: locked.visual_brief,
      experimentDimensions: locked.experiment_dimensions,
      outputDir: path.join(values.root, "compiled-intake-proof"),
    });
  assert.equal(intake.story_id, canonicalStoryId);
  assert.equal(intake.legacy_story_id, values.story.id);
  assert.equal(
    validateStoryIntakeManifest({
      manifestPath: intake.paths.story_intake,
    }).storyId,
    canonicalStoryId,
  );
});

test("supports the 100-120 word high-cadence band with an explicit SYSTEM_POLICY duration decision", async (t) => {
  const values = await standardFixture(t);
  values.story.full_script = values.inventory.script;

  const candidate =
    await compileGovernedAutonomousBreakingCandidateContract(
      compileInput(values),
    );

  const locked =
    candidate.locked_intake_binding.locked_intake;
  assert.equal(
    locked.contract.duration_band_id,
    "what_changes_breaking_high_cadence_35_42",
  );
  assert.ok(
    locked.contract.target_duration_seconds >= 35 &&
      locked.contract.target_duration_seconds <= 42,
  );
  assert.deepEqual(
    Object.keys(locked.contract.target_duration_review).sort(),
    [
      "reviewed_at",
      "reviewed_by",
      "script_sha256",
      "status",
      "target_duration_seconds",
    ],
  );
  assert.match(
    locked.contract.target_duration_review.reviewed_by,
    /^SYSTEM_POLICY:/,
  );
  assert.doesNotMatch(
    JSON.stringify(locked.contract.target_duration_review),
    /human|operator/i,
  );
  assert.equal(locked.script_claim_bindings.length, 6);
  assert.equal(candidate.creative_package.scenes.length, 6);

  const intake =
    await materializeGovernedLockedStoryIntakeFromInventory({
      inventoryPath: locked.inventory_path,
      inventoryFileSha256: locked.inventory_file_sha256,
      inventoryRoot: locked.inventory_root,
      allowedRoots: locked.allowed_roots,
      canonicalIdentityUrl: locked.canonical_identity_url,
      finalScript: locked.final_script,
      finalScriptSha256: locked.final_script_sha256,
      scriptClaimBindings: locked.script_claim_bindings,
      presentationClaimBindings:
        locked.presentation_claim_bindings,
      supplementalOfficialSources:
        locked.supplemental_official_sources,
      contract: locked.contract,
      freshness: locked.freshness,
      visualBrief: locked.visual_brief,
      experimentDimensions: locked.experiment_dimensions,
      outputDir: path.join(
        values.root,
        "compiled-high-cadence-intake-proof",
      ),
    });
  assert.equal(intake.story_id, candidate.story_id);
});

test("rejects a script clause that cannot be lexically supported by any exact official claim key", async (t) => {
  const values = await standardFixture(t);
  values.story.full_script =
    "Yet Another Zombie Defense HD is free to keep on Steam, but the offer ends on 30 July. PlayStation will cut its console price tomorrow across Europe according to an anonymous retailer report. Claim it before the deadline and the full game is yours to keep.";

  await assert.rejects(
    compileGovernedAutonomousBreakingCandidateContract(
      compileInput(values),
    ),
    (error) => {
      assert.equal(
        error.name,
        "GovernedAutonomousBreakingCandidateContractCompilerError",
      );
      assert.equal(
        error.code,
        "autonomous_breaking_candidate_script_clause_1_unsupported",
      );
      return true;
    },
  );
});

test("fails closed on source hash drift and a path-tampered hydrated binding", async (t) => {
  await t.test("source hash drift", async () => {
    const values = await standardFixture(t);
    fs.appendFileSync(
      values.inventory.sourcePath,
      "\nchanged-after-hydration\n",
    );

    await assert.rejects(
      compileGovernedAutonomousBreakingCandidateContract(
        compileInput(values),
      ),
      (error) => {
        assert.equal(
          error.code,
          "autonomous_breaking_candidate_primary_source_sha256_mismatch",
        );
        return true;
      },
    );
  });

  await t.test("path tamper", async () => {
    const values = await standardFixture(t);
    const tampered = structuredClone(values.candidate);
    tampered.governed_editorial_inventory_bindings
      .source_evidence.path = path.join(
      values.root,
      "different-source-evidence.json",
    );

    await assert.rejects(
      compileGovernedAutonomousBreakingCandidateContract(
        compileInput(values, { candidate: tampered }),
      ),
      (error) => {
        assert.equal(
          error.code,
          "autonomous_breaking_candidate_hydrated_binding_mismatch",
        );
        return true;
      },
    );
  });
});

test("rejects confirmed evidence whose bound packet is not official first-party evidence", async (t) => {
  const values = await standardFixture(t);
  const sourcePacket = JSON.parse(
    fs.readFileSync(values.inventory.sourcePath, "utf8"),
  );
  sourcePacket.verdict = "CORROBORATED";
  sourcePacket.confirmation_basis =
    "trusted_editorial_corroboration";
  for (const source of sourcePacket.sources) {
    source.source_class = "TRUSTED_EDITORIAL";
    if (source.provenance) {
      source.provenance.source_class =
        "TRUSTED_EDITORIAL";
    }
  }
  const nonOfficialPacket = refinalisePacket(
    sourcePacket,
    values.inventory.canonicalSha256,
  );
  const sourceFileSha256 = values.inventory.writeJson(
    values.inventory.sourcePath,
    nonOfficialPacket,
  );
  const registry = JSON.parse(
    fs.readFileSync(values.inventory.registryPath, "utf8"),
  );
  registry.breaking_source_evidence.file_sha256 =
    sourceFileSha256;
  registry.breaking_source_evidence.canonical_sha256 =
    nonOfficialPacket.packet_sha256;
  delete registry.inventory_sha256;
  registry.inventory_sha256 =
    values.inventory.canonicalSha256(registry);
  values.inventory.writeJson(
    values.inventory.registryPath,
    registry,
  );
  const hydration =
    await hydrateGovernedEditorialInventoryCandidates({
      candidates: [
        {
          lane_id: "breaking_short",
          story_id: values.inventory.storyId,
          stage: "PLANNING",
          supplemental_official_sources:
            values.candidate.supplemental_official_sources,
        },
      ],
      inventoryRoot: values.inventory.inventoryRoot,
      allowedRoots: [values.inventory.outputRoot, values.root],
    });
  assert.equal(hydration.verdict, "READY");
  values.candidate = hydration.candidates[0];

  await assert.rejects(
    compileGovernedAutonomousBreakingCandidateContract(
      compileInput(values),
    ),
    (error) => {
      assert.equal(
        error.code,
        "autonomous_breaking_candidate_primary_source_official_first_party_confirmation_required",
      );
      return true;
    },
  );
});

test("is deterministic and returns no human dependency or operational authority", async (t) => {
  const values = await standardFixture(t);
  const input = compileInput(values);

  const first =
    await compileGovernedAutonomousBreakingCandidateContract(
      input,
    );
  const second =
    await compileGovernedAutonomousBreakingCandidateContract(
      structuredClone(input),
    );

  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first).sort(), [
    "candidate_revision_sha256",
    "channel_id",
    "creative_package",
    "eligibility_verdict",
    "lane_id",
    "locked_intake_binding",
    "mode",
    "platform",
    "request_fingerprint",
    "runtime_policy",
    "scheduled_for",
    "schema_version",
    "selection_score",
    "source_evidence_sha256",
    "source_published_at",
    "source_type",
    "story_id",
    "verification_status",
    "verified_at",
  ]);
  walkFields(first, (field, value) => {
    assert.doesNotMatch(
      field,
      /^(?:approval|approved|human_approval|human_review|required_human|manual_approval)$/i,
    );
    if (
      /(?:^|_)(?:authority|authorised|authorized|mutated|contacted|network_used)(?:_|$)/i.test(
        field,
      )
    ) {
      assert.equal(value, false, `${field} must be false`);
    }
  });
  assert.equal(
    fs.existsSync(first.runtime_policy.candidate_source_root),
    false,
  );
});

test("refuses to recompile a legacy inventory row after its canonical projection is consumed", async (t) => {
  const values = await standardFixture(t);
  values.story._extra = JSON.stringify({
    governed_autonomous_canonical_projection: {
      role: "LEGACY_ALIAS_CONSUMED",
    },
  });

  await assert.rejects(
    compileGovernedAutonomousBreakingCandidateContract(
      compileInput(values),
    ),
    (error) => {
      assert.equal(
        error.code,
        "autonomous_breaking_candidate_legacy_projection_consumed",
      );
      return true;
    },
  );
});

test("refuses a consumed legacy row even if a generic upsert stripped its projection marker", async (t) => {
  const values = await standardFixture(t);
  values.story.publish_status =
    "canonical_projection_consumed";
  values.story._extra = "{}";

  await assert.rejects(
    compileGovernedAutonomousBreakingCandidateContract(
      compileInput(values),
    ),
    (error) => {
      assert.equal(
        error.code,
        "autonomous_breaking_candidate_legacy_projection_consumed",
      );
      return true;
    },
  );
});
