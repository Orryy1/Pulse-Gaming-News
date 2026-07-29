"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  captureBreakingSourceEvidence,
  persistBreakingSourceEvidencePacket,
} = require("../../lib/services/breaking-source-evidence");
const {
  SAFETY_ENVELOPE_SCHEMA,
  buildOwnedMotionIntake,
  runGovernedEditorialInventoryWorkflow,
  validateAutonomousDraftMaterialisationAuthority,
} = require("../../lib/services/governed-editorial-inventory-workflow");

const NOW = "2026-07-28T12:00:00.000Z";
const OFFICIAL_URL =
  "https://news.xbox.com/en-us/2026/07/28/back-compat-update/";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function story(overrides = {}) {
  return {
    id: "xbox-backcompat-workflow",
    title: "Xbox expands backwards compatibility and achievement support",
    franchise: "Xbox",
    platform: "xbox series x|s",
    published_at: NOW,
    primary_source_url: OFFICIAL_URL,
    subject_ids: ["xbox-backcompat"],
    ...overrides,
  };
}

function safety(overrides = {}) {
  return {
    schema_version: SAFETY_ENVELOPE_SCHEMA,
    mode: "LOCAL_PROOF",
    scope: "governed_editorial_inventory_draft_materialisation",
    local_proof_only: true,
    human_review_required: true,
    publish_authority: false,
    external_posting_authorised: false,
    network_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    scheduler_authority_created: false,
    auto_publish: false,
    guarded_live_dispatch_enabled: false,
    emergency_kill_switch_engaged: false,
    ...overrides,
  };
}

async function breakingEvidence(root, inputStory = story()) {
  const claims = [
    {
      claim_key: "xbox.backcompat.expansion",
      text: "Xbox is adding more original Xbox games to backwards compatibility.",
      location: "body",
    },
    {
      claim_key: "xbox.backcompat.achievements",
      text: "The supported original Xbox games are receiving achievement support.",
      location: "body",
    },
    {
      claim_key: "xbox.backcompat.gamepass",
      text: "The backwards compatibility additions are also coming to Game Pass.",
      location: "body",
    },
  ];
  const bytes = Buffer.from(
    `<article>${claims.map((claim) => claim.text).join(" ")}</article>`,
    "utf8",
  );
  const packet = await captureBreakingSourceEvidence({
    story: {
      id: inputStory.id,
      title: inputStory.title,
      subject_ids: inputStory.subject_ids,
      source_candidates: [OFFICIAL_URL],
    },
    sourcePolicy: {
      official_first_party: [
        {
          source_id: "xbox-wire",
          owner: "Microsoft Gaming",
          hosts: ["news.xbox.com"],
          subject_ids: ["xbox-backcompat"],
        },
      ],
      trusted_editorial: [],
    },
    now: NOW,
    fetchCapture: async ({ url }) => ({
      status: 200,
      final_url: url,
      content_type: "text/html; charset=utf-8",
      bytes,
    }),
    extractClaims: async () => ({
      extractor: { id: "workflow-fixture", version: "1.0.0" },
      claims,
    }),
  });
  const persisted = await persistBreakingSourceEvidencePacket({
    packet,
    outputDir: path.join(root, "breaking"),
  });
  return {
    packet,
    claims,
    reference: {
      path: persisted.path,
      file_sha256: persisted.file_sha256,
      canonical_sha256: persisted.packet_sha256,
    },
  };
}

function rendererDependencies(counters = {}) {
  return {
    inspect_ffmpeg: () => ({ available: true, executable: "fixture-ffmpeg" }),
    render_still: async ({ outputPath, role }) => {
      counters.stills = (counters.stills || 0) + 1;
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `owned-still:${role}`);
    },
    render_video: async ({ outputPath }) => {
      counters.videos = (counters.videos || 0) + 1;
      fs.writeFileSync(outputPath, "owned-video");
    },
    inspect_asset: async ({ mediaType }) =>
      mediaType === "image"
        ? { width: 1080, height: 1920, duration_seconds: null }
        : { width: 1080, height: 1920, duration_seconds: 28 },
  };
}

test("buildOwnedMotionIntake is an immutable exact-claim projection with no invented game identity", () => {
  const packet = {
    schema_version: "pulse-breaking-source-evidence-v1",
    story_id: "xbox-backcompat-workflow",
    verdict: "OFFICIAL_CONFIRMED",
    verification_status: "CONFIRMED",
    confirmation_basis: "official_first_party",
    verified_for_planning: true,
    primary_source_url: OFFICIAL_URL,
    sources: [
      {
        status: "CAPTURED",
        source_id: "xbox-wire",
        source_class: "OFFICIAL_FIRST_PARTY",
        final_url: OFFICIAL_URL,
        claims: [
          {
            claim_key: "xbox.claim",
            text: "Xbox is adding achievement support.",
            claim_sha256: sha256("claim"),
            claim_text_sha256: sha256(
              Buffer.from("Xbox is adding achievement support.", "utf8"),
            ),
          },
        ],
      },
    ],
    confirmed_claims: [
      {
        claim_key: "xbox.claim",
        evidence: [
          {
            source_id: "xbox-wire",
            source_class: "OFFICIAL_FIRST_PARTY",
            final_url: OFFICIAL_URL,
            text: "Xbox is adding achievement support.",
            claim_sha256: sha256("claim"),
          },
        ],
      },
    ],
  };
  const result = buildOwnedMotionIntake({
    story: story({ topic_key: undefined }),
    packet,
    sourceEvidence: {
      path: "C:/proof/source.json",
      file_sha256: sha256("file"),
      canonical_sha256: sha256("packet"),
    },
  });

  assert.equal(result.intake.story.franchise, "Xbox");
  assert.equal(result.intake.story.platform, "Xbox Series X|S");
  assert.equal(result.intake.story.topic_key, "xbox-backcompat");
  assert.equal(result.intake.claims.length, 1);
  assert.equal(
    result.intake.story.full_script,
    "Xbox is adding achievement support.",
  );
  assert.equal(
    result.intake.story.script_sha256,
    sha256(Buffer.from(result.intake.story.full_script, "utf8")),
  );
  assert.equal(
    result.intake.claims[0].text,
    packet.sources[0].claims[0].text,
  );
  assert.equal(result.intake.source_type, "official");
  assert.equal(result.intake.contract.editorial_lane_id, "what_changes_for_players");
  assert.equal(Object.isFrozen(result.intake), true);
});

test("autonomous draft authority is denied by any publication, network, DB or OAuth capability", () => {
  const plan = {
    ready: true,
    mode: "DRY_RUN",
    story_id: "xbox-backcompat-workflow",
    intake_manifest_sha256: sha256("intake"),
  };
  const denied = validateAutonomousDraftMaterialisationAuthority({
    safety: safety({
      external_posting_authorised: true,
      network_authorised: true,
      database_mutation_authorised: true,
      oauth_mutation_authorised: true,
    }),
    plan,
    confirm_story_id: plan.story_id,
    confirm_intake_manifest_sha256: plan.intake_manifest_sha256,
  });

  assert.equal(denied.authorised, false);
  assert.ok(denied.blockers.includes("external_posting_must_be_forbidden"));
  assert.ok(denied.blockers.includes("network_must_be_forbidden"));
  assert.ok(denied.blockers.includes("database_mutation_must_be_forbidden"));
  assert.ok(denied.blockers.includes("oauth_mutation_must_be_forbidden"));
  assert.equal(denied.external_publish_authorised, false);
  assert.equal(denied.database_mutation_authorised, false);
  assert.equal(denied.oauth_mutation_authorised, false);
  assert.equal(denied.network_authorised, false);
});

test("local draft materialisation does not require tripping the global publication kill switch", () => {
  const plan = {
    ready: true,
    mode: "DRY_RUN",
    story_id: "xbox-backcompat-workflow",
    intake_manifest_sha256: sha256("intake"),
  };
  const authority = validateAutonomousDraftMaterialisationAuthority({
    safety: safety({ emergency_kill_switch_engaged: false }),
    plan,
    confirm_story_id: plan.story_id,
    confirm_intake_manifest_sha256: plan.intake_manifest_sha256,
  });

  assert.equal(authority.authorised, true);
  assert.deepEqual(authority.blockers, []);
  assert.equal(authority.external_publish_authorised, false);
});

test("workflow materialises owned motion and a READY immutable inventory without external authority", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-inventory-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputStory = story();
  const breaking = await breakingEvidence(root, inputStory);
  const counters = {};
  let scoredStory = null;

  const result = await runGovernedEditorialInventoryWorkflow({
    story: inputStory,
    breaking_source_evidence: breaking.reference,
    safety: safety(),
    output_dir: path.join(root, "workflow"),
    root_dir: root,
    advertiser_scorer: (candidate) => {
      scoredStory = candidate;
      return {
        breakdown: { advertiser_safety: 5 },
        hard_stops: [],
      };
    },
    ...rendererDependencies(counters),
  });

  assert.equal(result.verdict, "READY");
  assert.equal(result.reused_owned_motion, false);
  assert.equal(counters.stills, 4);
  assert.equal(counters.videos, 1);
  assert.equal(scoredStory.id, inputStory.id);
  assert.equal(
    result.inventory.registry.breaking_source_evidence.canonical_sha256,
    breaking.packet.packet_sha256,
  );
  assert.equal(result.inventory.rights_ledger.items.length, 5);
  assert.ok(
    result.inventory.rights_ledger.items.every(
      (item) =>
        item.rights_basis === "OWNED" &&
        item.owner === "Pulse Gaming" &&
        item.attribution_decision === "NOT_REQUIRED",
    ),
  );
  assert.equal(result.report.safety.network_used, false);
  assert.equal(result.report.safety.database_mutated, false);
  assert.equal(result.report.safety.oauth_mutated, false);
  assert.equal(result.report.safety.external_posting_authorised, false);
  assert.equal(fs.existsSync(result.paths.report), true);
  assert.equal(fs.existsSync(result.paths.summary), true);
  assert.match(fs.readFileSync(result.paths.summary, "utf8"), /READY/);
  assert.match(fs.readFileSync(result.paths.summary, "utf8"), /No external publication authority/);
});

test("an exact retry reuses the validated owned package and byte-identical workflow evidence", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-inventory-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const breaking = await breakingEvidence(root);
  const counters = {};
  const args = {
    story: story(),
    breaking_source_evidence: {
      path: breaking.reference.path,
      file_sha256: breaking.reference.file_sha256,
    },
    safety: safety(),
    output_dir: path.join(root, "workflow"),
    root_dir: root,
    advertiser_safety: {
      story_id: story().id,
      advertiser_safety: 5,
      maximum_score: 5,
      hard_stops: [],
      policy_version: "fixture-advertiser-safety-v1",
      scored_at: NOW,
      decision: "SAFE",
    },
    ...rendererDependencies(counters),
  };

  const first = await runGovernedEditorialInventoryWorkflow(args);
  const reportBytes = fs.readFileSync(first.paths.report);
  const second = await runGovernedEditorialInventoryWorkflow(args);

  assert.equal(second.verdict, "READY");
  assert.equal(second.reused_owned_motion, true);
  assert.equal(second.reused_inventory, true);
  assert.equal(counters.stills, 4);
  assert.equal(counters.videos, 1);
  assert.deepEqual(fs.readFileSync(second.paths.report), reportBytes);
  assert.equal(second.report.report_sha256, first.report.report_sha256);
});

test("a retry fails closed when an existing owned asset was tampered", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-inventory-tamper-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const breaking = await breakingEvidence(root);
  const args = {
    story: story(),
    breaking_source_evidence: breaking.reference,
    safety: safety(),
    output_dir: path.join(root, "workflow"),
    root_dir: root,
    advertiser_safety: {
      story_id: story().id,
      advertiser_safety: 5,
      maximum_score: 5,
      hard_stops: [],
      policy_version: "fixture-advertiser-safety-v1",
      scored_at: NOW,
    },
    ...rendererDependencies({}),
  };
  const first = await runGovernedEditorialInventoryWorkflow(args);
  const assetPath = first.owned_motion.manifest.assets[0].absolute_path;
  fs.appendFileSync(assetPath, "tampered");

  await assert.rejects(
    runGovernedEditorialInventoryWorkflow(args),
    /governed_editorial_inventory_workflow_conflict:owned_motion_asset_sha256_mismatch/,
  );
});

test("workflow rejects missing explicit franchise or platform instead of guessing from the title", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-inventory-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const breaking = await breakingEvidence(root);

  await assert.rejects(
    runGovernedEditorialInventoryWorkflow({
      story: story({ franchise: "" }),
      breaking_source_evidence: breaking.reference,
      safety: safety(),
      output_dir: path.join(root, "workflow"),
      root_dir: root,
      ...rendererDependencies({}),
    }),
    /story_franchise_required/,
  );
});

test("workflow rejects evidence paths outside root", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-inventory-path-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-inventory-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const breaking = await breakingEvidence(outside);
  const common = {
    story: story(),
    safety: safety(),
    output_dir: path.join(root, "workflow"),
    root_dir: root,
    ...rendererDependencies({}),
  };

  await assert.rejects(
    runGovernedEditorialInventoryWorkflow({
      ...common,
      breaking_source_evidence: breaking.reference,
    }),
    /breaking_source_evidence_path_outside_root/,
  );
});

test("workflow rejects evidence reached through a symlinked directory", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-inventory-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inside = await breakingEvidence(root);
  const linkDirectory = path.join(root, "breaking-link");
  try {
    fs.symlinkSync(
      path.dirname(inside.reference.path),
      linkDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("symlink creation is not available");
      return;
    }
    throw error;
  }
  await assert.rejects(
    runGovernedEditorialInventoryWorkflow({
      story: story(),
      safety: safety(),
      output_dir: path.join(root, "workflow"),
      root_dir: root,
      ...rendererDependencies({}),
      breaking_source_evidence: {
        ...inside.reference,
        path: path.join(linkDirectory, path.basename(inside.reference.path)),
      },
    }),
    /breaking_source_evidence_symlink_forbidden/,
  );
});

test("an unsafe advertiser result creates an immutable HOLD report, never publish authority", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-inventory-hold-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const breaking = await breakingEvidence(root);

  const result = await runGovernedEditorialInventoryWorkflow({
    story: story(),
    breaking_source_evidence: breaking.reference,
    safety: safety(),
    output_dir: path.join(root, "workflow"),
    root_dir: root,
    advertiser_scorer: () => ({
      breakdown: { advertiser_safety: 4 },
      hard_stops: ["advertiser_unfriendly_language"],
    }),
    ...rendererDependencies({}),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("advertiser_safety_not_explicitly_green"),
  );
  assert.equal(result.report.stages.editorial_inventory, "HOLD");
  assert.equal(result.report.safety.publish_authority_created, false);
  assert.equal(result.report.safety.external_posting_authorised, false);
  assert.equal(result.inventory.advertiser_safety_report, null);
});

test("a conflicting existing workflow report is never silently replaced", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-inventory-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const breaking = await breakingEvidence(root);
  const args = {
    story: story(),
    breaking_source_evidence: breaking.reference,
    safety: safety(),
    output_dir: path.join(root, "workflow"),
    root_dir: root,
    advertiser_safety: {
      story_id: story().id,
      advertiser_safety: 5,
      maximum_score: 5,
      hard_stops: [],
      policy_version: "fixture-advertiser-safety-v1",
      scored_at: NOW,
    },
    ...rendererDependencies({}),
  };
  const first = await runGovernedEditorialInventoryWorkflow(args);
  fs.writeFileSync(first.paths.report, "{}\n");

  await assert.rejects(
    runGovernedEditorialInventoryWorkflow(args),
    /governed_editorial_inventory_workflow_immutable_conflict/,
  );
});
