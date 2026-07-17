"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_MINIMUM_GENERATOR_PROJECTS,
  OWNED_PROCEDURAL_DIVERSITY_VERSION,
  evaluateOwnedProceduralDiversity,
} = require("../../lib/owned-procedural-diversity");

const MASTER_A = "a".repeat(64);
const MASTER_B = "b".repeat(64);
const MASTER_C = "c".repeat(64);
const MASTER_D = "d".repeat(64);
const VISUAL_A = "1".repeat(64);
const VISUAL_B = "2".repeat(64);
const VISUAL_C = "3".repeat(64);
const VISUAL_D = "4".repeat(64);
const PLATFORMS = ["youtube", "tiktok", "instagram"];

async function materialisedOutput(root, name, content = `motion:${name}`) {
  const filePath = path.join(root, `${name}.mp4`);
  const bytes = Buffer.from(content);
  await fs.writeFile(filePath, bytes);
  return {
    path: filePath,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    size_bytes: bytes.length,
  };
}

async function generatorProject(root, id, master, visual, overrides = {}) {
  return {
    generator_project_id: id,
    generator_master_sha256: master,
    sampled_visual_fingerprint: visual,
    design_grammar_identity: `${id}:grammar:v1`,
    source_type: "owned_procedural_motion",
    rights: {
      rights_grant: "wholly_owned_procedural_motion",
      owned: true,
      allowed_platforms: PLATFORMS,
    },
    outputs: [await materialisedOutput(root, id)],
    ...overrides,
  };
}

async function temporaryRoot(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("owned procedural diversity is GREEN only for three complete distinct generator projects", async (t) => {
  const root = await temporaryRoot(t, "pulse-owned-procedural-green-");
  const particleField = await generatorProject(
    root,
    "particle-field",
    MASTER_A,
    VISUAL_A,
  );
  const projects = [
    particleField,
    {
      ...particleField,
      outputs: [await materialisedOutput(root, "particle-field-second-clip")],
    },
    await generatorProject(root, "isometric-map", MASTER_B, VISUAL_B),
    await generatorProject(root, "kinetic-diagram", MASTER_C, VISUAL_C),
  ];

  const report = await evaluateOwnedProceduralDiversity({
    projects,
    workspaceRoot: root,
    requiredPlatforms: PLATFORMS,
  });

  assert.equal(DEFAULT_MINIMUM_GENERATOR_PROJECTS, 3);
  assert.match(OWNED_PROCEDURAL_DIVERSITY_VERSION, /^pulse_owned_procedural_diversity_/);
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.status, "GREEN");
  assert.equal(report.strict_pass, true);
  assert.equal(report.minimum_required_generator_project_count, 3);
  assert.equal(report.observed_distinct_generator_project_count, 3);
  assert.equal(report.accepted_project_count, 3);
  assert.equal(report.rejected_project_count, 0);
  assert.equal(report.collapsed_input_count, 1);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(
    report.accepted_projects.map((project) => project.generator_project_id),
    ["particle-field", "isometric-map", "kinetic-diagram"],
  );
  assert.equal(report.accepted_projects[0].materialised_outputs.length, 2);
  assert.ok(report.accepted_projects.every((project) => project.materialised_outputs[0].current_sha256));
  assert.ok(report.accepted_projects.every((project) => project.materialised_outputs[0].current_size_bytes > 0));
});

test("clips sharing any stable project, master or fingerprint identity collapse transitively", async (t) => {
  const root = await temporaryRoot(t, "pulse-owned-procedural-collapse-");
  const first = await generatorProject(root, "shared-project", MASTER_A, VISUAL_A);
  const sameProject = await generatorProject(
    root,
    "shared-project",
    MASTER_B,
    VISUAL_B,
  );
  const sameMaster = await generatorProject(
    root,
    "master-alias-project",
    MASTER_B,
    VISUAL_C,
  );
  const sameFingerprint = await generatorProject(
    root,
    "fingerprint-alias-project",
    MASTER_D,
    VISUAL_C,
  );

  const report = await evaluateOwnedProceduralDiversity({
    projects: [first, sameProject, sameMaster, sameFingerprint],
    workspaceRoot: root,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.observed_distinct_generator_project_count, 1);
  assert.equal(report.accepted_project_count, 1);
  assert.equal(report.rejected_project_count, 0);
  assert.equal(report.collapsed_input_count, 3);
  assert.deepEqual(report.accepted_projects[0].input_indexes, [0, 1, 2, 3]);
  assert.equal(report.accepted_projects[0].materialised_outputs.length, 4);
  assert.deepEqual(report.accepted_projects[0].generator_project_id_aliases, [
    "shared-project",
    "master-alias-project",
    "fingerprint-alias-project",
  ]);
  assert.ok(report.blockers.includes("owned_procedural_generator_project_minimum_not_met"));
  assert.deepEqual(report.rejected_projects, []);
});

test("prohibited forms and incomplete identity, rights or output evidence are rejected", async (t) => {
  const root = await temporaryRoot(t, "pulse-owned-procedural-reject-");
  const staleHash = await generatorProject(root, "stale-hash", MASTER_A, VISUAL_A);
  staleHash.outputs[0].sha256 = "f".repeat(64);
  const staleSize = await generatorProject(root, "stale-size", MASTER_B, VISUAL_B);
  staleSize.outputs[0].size_bytes += 1;
  const missingFile = await generatorProject(root, "missing-file", MASTER_C, VISUAL_C);
  missingFile.outputs[0].path = path.join(root, "absent.mp4");

  const projects = [
    await generatorProject(root, "placeholder-project", MASTER_D, VISUAL_D, {
      placeholder: true,
    }),
    await generatorProject(root, "still-loop", "5".repeat(64), "6".repeat(64), {
      motion_type: "static_still_loop",
    }),
    await generatorProject(root, "card-only", "7".repeat(64), "8".repeat(64), {
      source_type: "readable_template_card_only",
    }),
    staleHash,
    staleSize,
    missingFile,
    await generatorProject(root, "rights-missing", "9".repeat(64), "a".repeat(64), {
      rights: { allowed_platforms: PLATFORMS },
    }),
    await generatorProject(root, "ownership-denied", "f".repeat(64), "5".repeat(64), {
      rights: {
        rights_grant: "wholly_owned_procedural_motion",
        owned: false,
        allowed_platforms: PLATFORMS,
      },
    }),
    await generatorProject(root, "platforms-missing", "6".repeat(64), "c".repeat(64), {
      rights: {
        rights_grant: "wholly_owned_procedural_motion",
        owned: true,
        allowed_platforms: [],
      },
    }),
    await generatorProject(root, "grammar-missing", "e".repeat(64), "d".repeat(64), {
      design_grammar_identity: "",
    }),
    await generatorProject(root, "bad-master", "not-a-sha", "f".repeat(64)),
    await generatorProject(root, "bad-fingerprint", "0".repeat(64), "not-a-fingerprint"),
  ];

  const report = await evaluateOwnedProceduralDiversity({
    projects,
    workspaceRoot: root,
    requiredPlatforms: PLATFORMS,
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.strict_pass, false);
  assert.equal(report.accepted_project_count, 0);
  assert.equal(report.rejected_project_count, projects.length);
  for (const blocker of [
    "placeholder_generator_project_rejected",
    "static_or_still_loop_generator_project_rejected",
    "card_or_readable_template_only_generator_project_rejected",
    "materialised_output_sha256_stale",
    "materialised_output_size_stale",
    "materialised_output_file_missing",
    "owned_rights_grant_missing",
    "allowed_platforms_missing",
    "design_grammar_identity_missing",
    "generator_master_sha256_invalid",
    "sampled_visual_fingerprint_invalid",
    "owned_procedural_generator_project_minimum_not_met",
  ]) {
    assert.ok(report.blockers.includes(blocker), blocker);
  }
  assert.ok(report.rejected_projects.every((project) => project.reasons.length > 0));
  assert.ok(
    report.rejected_projects
      .find((project) => project.generator_project_id === "ownership-denied")
      .reasons.includes("owned_rights_grant_missing"),
  );
});

test("supplied near-identical similarity evidence rejects the later project at the threshold", async (t) => {
  const root = await temporaryRoot(t, "pulse-owned-procedural-similarity-");
  const projects = [
    await generatorProject(root, "particle-field", MASTER_A, VISUAL_A),
    await generatorProject(root, "particle-field-reskin", MASTER_B, VISUAL_B),
    await generatorProject(root, "isometric-map", MASTER_C, VISUAL_C),
  ];

  const report = await evaluateOwnedProceduralDiversity({
    projects,
    workspaceRoot: root,
    similarityThreshold: 0.9,
    similarityEvidence: [
      {
        left_generator_project_id: "particle-field",
        right_generator_project_id: "particle-field-reskin",
        similarity_score: 0.9,
        evidence_id: "frame-sample-comparison-1",
      },
    ],
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.observed_distinct_generator_project_count, 2);
  assert.equal(report.accepted_project_count, 2);
  assert.equal(report.rejected_project_count, 1);
  assert.ok(report.blockers.includes("near_identical_generator_projects_rejected"));
  assert.ok(report.blockers.includes("owned_procedural_generator_project_minimum_not_met"));
  assert.equal(report.rejected_projects[0].generator_project_id, "particle-field-reskin");
  assert.equal(report.rejected_projects[0].near_identical_to_generator_project_id, "particle-field");
  assert.equal(report.checks.material_distinctness.supplied_similarity_evidence_count, 1);
  assert.equal(report.checks.material_distinctness.breaching_pair_count, 1);
});
