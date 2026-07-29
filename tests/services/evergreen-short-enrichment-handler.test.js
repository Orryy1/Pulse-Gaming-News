"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { handlers } = require("../../lib/job-handlers");

const FIXTURE = require("../fixtures/evergreen-verdict-candidates-input.json");
const NOW = "2026-07-28T12:00:00.000Z";
const PROPOSED_SCRIPT =
  "The easiest Fallout to return to is not the newest one. " +
  "Fallout 3 begins in Vault 101 and reaches its central exploration loop quickly. " +
  "New Vegas moves the decision pressure into the Mojave, where early routes and factions make each choice more visible. " +
  "Fallout 4 adds smoother controls and settlement building, but its opening asks for more patience before the wider build systems take over. " +
  "The useful comparison is opening friction, build flexibility and how quickly each game exposes its strongest rhythm. " +
  "Fallout 3 is the cleanest re-entry, New Vegas offers the richest early decisions and Fallout 4 feels the most modern in the hands. " +
  "That makes Fallout 3 the easiest return, even if another entry becomes your longer stay. " +
  "The newest controls do not automatically create the fastest route back into Fallout.";

function candidatePitch() {
  return structuredClone(FIXTURE.manifests[0].evergreen_pitch);
}

function story({ script = "Existing unadmitted script.", approved = 0 } = {}) {
  return {
    id: "story-fallout-enrichment-handler",
    title: "Which Fallout is easiest to return to?",
    url: "https://fallout.bethesda.net/en/games",
    source_confidence: "verified",
    approved,
    full_script: script,
    _extra: JSON.stringify({
      editorial_format: "evergreen_verdict_short",
      evergreen_pitch: candidatePitch(),
    }),
  };
}

function readyEnrichment(input) {
  return {
    schema_version: "pulse-evergreen-pitch-enrichment-v1",
    generated_at: input.now,
    mode: "LOCAL_PROOF",
    verdict: "READY_FOR_LOCAL_PRODUCTION",
    blockers: [],
    enriched_pitch: {
      ...input.evergreen_pitch,
      script_material: {
        hook: { text: "The easiest return is not the newest.", claim_refs: [] },
      },
      visual_beats: [],
    },
    work_order_result: {
      verdict: "READY_FOR_LOCAL_PRODUCTION",
      blockers: [],
      work_order: {
        script_contract: {
          full_script: PROPOSED_SCRIPT,
        },
      },
    },
    safety: {
      planning_only: true,
      publish_authority_created: false,
    },
  };
}

async function runHandler(t, currentStory, overrides = {}) {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-enrichment-handler-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  let received = null;
  const result = await handlers.enrich_evergreen_short(
    {
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "evergreen_short",
        story_id: currentStory.id,
        evergreen_pitch: candidatePitch(),
        now: NOW,
        out_dir: outDir,
      },
    },
    {
      repos: {
        stories: { get: () => currentStory },
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 701, ...input };
          },
        },
      },
      evergreenPitchGenerator: async () => ({
        script_material: {},
        visual_beats: [],
      }),
      async enrichEvergreenVerdictPitch(input) {
        received = input;
        return readyEnrichment(input);
      },
      ...overrides,
    },
  );
  return { result, queued, received };
}

test("materialises an evidence-bound evergreen proposal but does not plan production before exact human script admission", async (t) => {
  const currentStory = story();
  const { result, queued, received } = await runHandler(
    t,
    currentStory,
  );

  assert.equal(result.status, "AWAITING_HUMAN_SCRIPT_ADMISSION");
  assert.equal(result.no_database_mutation, true);
  assert.equal(result.no_publish, true);
  assert.equal(result.exact_script_already_admitted, false);
  assert.equal(queued.length, 0);
  assert.equal(received.story.id, currentStory.id);
  assert.equal(received.evergreen_pitch.story_id, currentStory.id);
  assert.ok(
    received.evergreen_pitch.claims.every((claim) =>
      /^claim-[a-f0-9]{16}$/.test(claim.id),
    ),
  );
  assert.equal(await fs.pathExists(result.enrichment_json), true);
  assert.equal(await fs.pathExists(result.enrichment_markdown), true);
  const proof = await fs.readJson(result.enrichment_json);
  assert.equal(
    proof.editorial_admission.human_script_admission_required,
    true,
  );
  assert.equal(proof.editorial_admission.database_mutated, false);
});

test("queues exact evergreen planning only when the generated script is already the approved story script", async (t) => {
  const currentStory = story({
    script: PROPOSED_SCRIPT,
    approved: 1,
  });
  const { result, queued } = await runHandler(t, currentStory);

  assert.equal(result.status, "READY_FOR_EXACT_PLANNING");
  assert.equal(result.exact_script_already_admitted, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "plan_evergreen_short");
  assert.equal(queued[0].story_id, currentStory.id);
  assert.equal(queued[0].payload.story_id, currentStory.id);
  assert.equal(queued[0].payload.publish_authority, false);
  assert.match(
    queued[0].idempotency_key,
    /^plan:evergreen_short:story-fallout-enrichment-handler:/,
  );
});

test("fails closed with an explicitly unavailable generator and still writes operator-readable proof", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-no-generator-"),
  );
  t.after(() => fs.remove(outDir));
  const currentStory = story();
  const result = await handlers.enrich_evergreen_short(
    {
      payload: {
        lane_id: "evergreen_short",
        story_id: currentStory.id,
        evergreen_pitch: candidatePitch(),
        now: NOW,
        out_dir: outDir,
      },
    },
    {
      evergreenPitchGenerator: null,
      repos: {
        stories: { get: () => currentStory },
        jobs: {
          enqueue() {
            throw new Error("must not enqueue");
          },
        },
      },
    },
  );

  assert.equal(result.status, "HOLD");
  assert.ok(result.blockers.includes("async_json_generator_required"));
  assert.equal(await fs.pathExists(result.enrichment_json), true);
  assert.equal(await fs.pathExists(result.enrichment_markdown), true);
});
