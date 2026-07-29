"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  buildEvergreenVerdictCandidateReport,
  renderEvergreenVerdictCandidateReportMarkdown,
} = require("../../lib/services/evergreen-verdict-candidate-builder");
const { handlers } = require("../../lib/job-handlers");
const { runMigrations } = require("../../lib/migrate");
const {
  bind: bindJobs,
} = require("../../lib/repositories/jobs");
const {
  STABILISATION_SCHEDULER_PROFILE,
  schedulesForProfile,
} = require("../../lib/scheduler");

const NOW = "2026-07-28T12:00:00.000Z";

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function governedPitch(overrides = {}) {
  return {
    id: "fallout-return-2026",
    title: "Which Fallout Is Easiest To Return To In 2026?",
    franchise: "Fallout",
    format_shape: "ranked_lens",
    editorial_criteria: ["opening-hour friction", "build flexibility"],
    item_rationales: [
      {
        subject: "Fallout 3",
        judgement: "Fast route from vault exit to exploration.",
        source_url: "https://fallout.bethesda.net/en/games/fallout-3",
      },
      {
        subject: "Fallout New Vegas",
        judgement: "Strong early choices with a rougher technical return.",
        source_url:
          "https://fallout.bethesda.net/en/games/fallout-new-vegas",
      },
      {
        subject: "Fallout 4",
        judgement: "Smooth controls with a slower settlement opening.",
        source_url: "https://fallout.bethesda.net/en/games/fallout-4",
      },
    ],
    claims: [
      {
        text: "Fallout 3 begins in Vault 101.",
        source_url: "https://fallout.bethesda.net/en/games/fallout-3",
      },
      {
        text: "New Vegas is set in the Mojave.",
        source_url:
          "https://fallout.bethesda.net/en/games/fallout-new-vegas",
      },
      {
        text: "Fallout 4 includes settlement building.",
        source_url: "https://fallout.bethesda.net/en/games/fallout-4",
      },
    ],
    source_manifest: [
      {
        name: "Bethesda",
        url: "https://fallout.bethesda.net/en/games",
        tier: "official_publisher",
      },
      {
        name: "Steam",
        url: "https://store.steampowered.com/franchise/Fallout/",
        tier: "official_storefront",
      },
    ],
    script_contract: {
      voice_mode: "sourced_synthesis",
      uses_first_person_play_claims: false,
      target_duration_seconds: 82,
      target_words_per_minute: 195,
      opening_premise_words: 11,
      closing_cta_count: 1,
    },
    media_plan: {
      exact_subject_motion_seconds: 62,
      clip_count: 7,
      distinct_motion_families: 3,
      unknown_reuploads: 0,
      third_party_music: false,
      rights_records: [
        {
          asset_id: "fallout3-owned",
          owner: "Pulse Gaming",
          source_url: "https://fallout.bethesda.net/en/games/fallout-3",
          rights_basis: "owned_capture",
          usage: "gameplay_backbone",
        },
        {
          asset_id: "new-vegas-owned",
          owner: "Pulse Gaming",
          source_url:
            "https://fallout.bethesda.net/en/games/fallout-new-vegas",
          rights_basis: "owned_capture",
          usage: "gameplay_backbone",
        },
        {
          asset_id: "fallout4-owned",
          owner: "Pulse Gaming",
          source_url: "https://fallout.bethesda.net/en/games/fallout-4",
          rights_basis: "owned_capture",
          usage: "gameplay_backbone",
        },
      ],
    },
    ...overrides,
  };
}

test("builds a production-ready candidate only from explicit story evergreen_pitch evidence", () => {
  const pitch = governedPitch();
  const report = buildEvergreenVerdictCandidateReport({
    now: NOW,
    stories: [
      {
        id: "story-fallout",
        title: "A surrounding news title that must not replace the pitch",
        _extra: JSON.stringify({ evergreen_pitch: pitch }),
      },
    ],
  });

  assert.equal(report.schema_version, "pulse-evergreen-candidate-report-v1");
  assert.equal(report.mode, "LOCAL_PROOF");
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].origin.kind, "story_extra");
  assert.equal(
    report.candidates[0].assessment.verdict,
    "READY_FOR_PRODUCTION",
  );
  assert.deepEqual(report.candidates[0].candidate.claims, pitch.claims);
  assert.deepEqual(
    report.candidates[0].candidate.media_plan.rights_records,
    pitch.media_plan.rights_records,
  );
  assert.equal(report.rotation.selected.length, 1);
  assert.deepEqual(report.selected_candidates, [
    report.candidates[0],
  ]);
  assert.deepEqual(report.provenance_contract.accepted_pitch_paths, [
    "manifest.evergreen_pitch",
    "story._extra.evergreen_pitch",
  ]);
  assert.equal(report.provenance_contract.surrounding_story_fields_used, false);
  assert.equal(report.provenance_contract.claims_synthesised, false);
  assert.equal(report.provenance_contract.rights_synthesised, false);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.scheduler_authority_created, false);
});

test("rejects implicit story material and never fills missing claims or rights", () => {
  const incompletePitch = governedPitch({
    id: "halo-return",
    title: "Is Halo Infinite Still Worth Playing?",
    franchise: "Halo",
    claims: undefined,
    media_plan: {
      exact_subject_motion_seconds: 62,
      clip_count: 7,
      distinct_motion_families: 3,
      unknown_reuploads: 0,
      third_party_music: false,
    },
  });
  const report = buildEvergreenVerdictCandidateReport({
    now: NOW,
    stories: [
      {
        id: "implicit-story",
        title: "This title must not become an evergreen pitch",
        claims: governedPitch().claims,
        media_plan: governedPitch().media_plan,
      },
      {
        id: "explicit-but-incomplete",
        _extra: { evergreen_pitch: incompletePitch },
      },
    ],
  });

  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].candidate.claims, undefined);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      report.candidates[0].candidate.media_plan,
      "rights_records",
    ),
    false,
  );
  assert.ok(
    report.candidates[0].assessment.blockers.includes(
      "claim_inventory_too_thin",
    ),
  );
  assert.ok(
    report.candidates[0].assessment.blockers.includes(
      "rights_records_too_thin",
    ),
  );
  assert.deepEqual(report.rejected_inputs, [
    {
      origin: {
        kind: "story",
        id: "implicit-story",
      },
      blockers: ["evergreen_pitch_missing"],
    },
  ]);
});

test("accepts only the explicit evergreen_pitch field from source-backed manifests", () => {
  const pitch = governedPitch({
    id: "zelda-era-mechanic",
    title: "The Zelda Mechanic That Aged Best In Every Era",
    franchise: "The Legend of Zelda",
    format_shape: "franchise_fault_line",
  });
  const report = buildEvergreenVerdictCandidateReport({
    now: NOW,
    manifests: [
      {
        schema_version: "pulse-evergreen-pitch-v1",
        manifest_id: "manifest-zelda",
        evergreen_pitch: pitch,
      },
      {
        manifest_id: "implicit-manifest",
        ...governedPitch({ id: "must-not-enter" }),
      },
    ],
  });

  assert.equal(report.candidates.length, 1);
  assert.deepEqual(report.candidates[0].candidate, pitch);
  assert.deepEqual(report.candidates[0].origin, {
    kind: "manifest",
    id: "manifest-zelda",
    field: "evergreen_pitch",
  });
  assert.deepEqual(report.rejected_inputs, [
    {
      origin: {
        kind: "manifest",
        id: "implicit-manifest",
      },
      blockers: ["evergreen_pitch_missing"],
    },
  ]);
});

test("uses prior weekly evergreen commitments so the rotation never exceeds two", () => {
  const report = buildEvergreenVerdictCandidateReport({
    now: NOW,
    policy: { maximum_per_week: 99 },
    history: [
      {
        story_id: "already-published",
        editorial_format: "evergreen_verdict_short",
        franchise: "Metroid",
        published_at: "2026-07-27T18:00:00.000Z",
      },
    ],
    manifests: [
      {
        manifest_id: "manifest-zelda",
        evergreen_pitch: governedPitch({
          id: "zelda-era-mechanic",
          title: "The Zelda Mechanic That Aged Best In Every Era",
          franchise: "The Legend of Zelda",
          format_shape: "franchise_fault_line",
        }),
      },
      {
        manifest_id: "manifest-halo",
        evergreen_pitch: governedPitch({
          id: "halo-versus",
          title: "Halo 2 Or Halo 3: Which Campaign Respects Your Time?",
          franchise: "Halo",
          format_shape: "versus_verdict",
        }),
      },
      {
        manifest_id: "manifest-forza",
        evergreen_pitch: governedPitch({
          id: "forza-return",
          title: "Is Forza Horizon 4 Still Worth Playing In 2026?",
          franchise: "Forza",
          format_shape: "still_worth_playing",
        }),
      },
    ],
  });

  assert.deepEqual(report.weekly_rotation, {
    week_start: "2026-07-27T00:00:00.000Z",
    week_end: "2026-08-03T00:00:00.000Z",
    maximum_per_week: 2,
    prior_commitment_count: 1,
    remaining_capacity: 1,
    selected_candidate_count: 1,
    remaining_after_selection: 0,
  });
  assert.equal(report.rotation.selected.length, 1);
  assert.equal(report.rotation.deferred.length, 2);
  assert.ok(
    report.rotation.deferred.every((item) =>
      item.blockers.includes("weekly_rotation_capacity_reached"),
    ),
  );
});

test("renders a human-readable LOCAL_PROOF candidate and rotation summary", () => {
  const report = buildEvergreenVerdictCandidateReport({
    now: NOW,
    manifests: [
      {
        manifest_id: "manifest-fallout",
        evergreen_pitch: governedPitch(),
      },
    ],
  });

  const markdown = renderEvergreenVerdictCandidateReportMarkdown(report);

  assert.match(markdown, /^# Pulse Gaming Evergreen Candidate Report/m);
  assert.match(markdown, /Mode: LOCAL_PROOF/);
  assert.match(markdown, /Which Fallout Is Easiest To Return To In 2026\?/);
  assert.match(markdown, /Weekly capacity: 1 of 2 remaining/);
  assert.match(
    markdown,
    /does not create scheduler authority or publish externally/i,
  );
});

test("stabilisation runs the evidence-only evergreen candidate builder four times daily", () => {
  const schedule = schedulesForProfile(
    STABILISATION_SCHEDULER_PROFILE,
  ).find((item) => item.name === "evergreen_candidate_builder");

  assert.ok(schedule);
  assert.equal(schedule.kind, "evergreen_candidate_builder");
  assert.equal(schedule.cron_expr, "30 */6 * * *");
  assert.equal(schedule.payload.live_publish_enabled, false);
});

test("candidate-builder handler writes proof and routes an unmaterialised selected pitch to isolated enrichment", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-handler-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const pitch = governedPitch();
  const result = await handlers.evergreen_candidate_builder(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: outDir,
        stories: [
          {
            id: "story-fallout",
            _extra: JSON.stringify({
              editorial_format: "evergreen_verdict_short",
              evergreen_pitch: pitch,
            }),
          },
        ],
        history: [],
      },
    },
    {
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 501, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(result.no_publish, true);
  assert.equal(result.selected_candidate_count, 1);
  assert.equal(await fs.pathExists(result.report_json), true);
  assert.equal(await fs.pathExists(result.report_markdown), true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "enrich_evergreen_short");
  assert.equal(queued[0].payload.story_id, "story-fallout");
  assert.deepEqual(queued[0].payload.evergreen_pitch, pitch);
  assert.equal(queued[0].payload.publish_authority, false);
});

test("autonomous discovery manifests route their exact origin story into isolated evergreen enrichment", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-autonomous-handler-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const pitch = governedPitch({
    id: "fallout-autonomous-return",
    origin_story_id: "story-fallout-autonomous",
  });
  const generator = async () => ({ pitches: [] });
  let receivedDiscovery = null;

  const result = await handlers.evergreen_candidate_builder(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: outDir,
        stories: [],
        history: [],
        discovery_stories: [
          {
            id: "story-fallout-autonomous",
          },
        ],
      },
    },
    {
      prevalidatedEvergreenDiscoveryInputs: true,
      evergreenDiscoveryGenerator: generator,
      async discoverEvergreenVerdictPitches(input) {
        receivedDiscovery = input;
        return {
          schema_version:
            "pulse-evergreen-autonomous-discovery-v1",
          generated_at: NOW,
          mode: "LOCAL_PROOF",
          verdict: "READY_FOR_CANDIDATE_ASSESSMENT",
          blockers: [],
          selected_candidates: [],
          candidate_manifests: [
            {
              schema_version: "pulse-evergreen-pitch-v1",
              manifest_id: "discovery-fallout-autonomous",
              origin_story_id: "story-fallout-autonomous",
              evergreen_pitch: pitch,
            },
          ],
          safety: {
            publish_authority_created: false,
          },
        };
      },
      renderEvergreenAutonomousDiscoveryMarkdown() {
        return "# Autonomous Evergreen Discovery\n";
      },
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 502, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(receivedDiscovery.generator, generator);
  assert.equal(result.discovery_verdict, "READY_FOR_CANDIDATE_ASSESSMENT");
  assert.equal(await fs.pathExists(result.discovery_json), true);
  assert.equal(await fs.pathExists(result.discovery_markdown), true);
  assert.equal(result.selected_candidate_count, 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "enrich_evergreen_short");
  assert.equal(
    queued[0].payload.story_id,
    "story-fallout-autonomous",
  );
  assert.deepEqual(queued[0].payload.evergreen_pitch, pitch);
  assert.equal(queued[0].payload.publish_authority, false);
});

test("candidate-builder persists generator-canonical motion-repair work orders as immutable local proof", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-motion-repair-"),
  );
  t.after(() => fs.remove(outDir));
  const workOrderBase = {
    schema_version:
      "pulse-evergreen-motion-coverage-repair-work-order-v1",
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    story_id: "story-motion-thin",
    candidate_id: "candidate-motion-thin",
    blocker: "exact_subject_motion_ratio_too_low",
    minimum_required_motion_seconds: 53.3,
    verified_materialised_motion_seconds: 28,
    additional_motion_seconds_required: 25.3,
    completion_contract: {
      static_images_count_as_motion_seconds: false,
      materialised_video_probe_required: true,
    },
    safety: {
      local_proof_only: true,
      publish_authority_created: false,
    },
  };
  const workOrder = {
    ...workOrderBase,
    work_order_sha256: crypto
      .createHash("sha256")
      .update(stableJson(workOrderBase))
      .digest("hex"),
  };
  const queued = [];

  const result = await handlers.evergreen_candidate_builder(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: outDir,
        stories: [],
        history: [],
        discovery_stories: [{ id: "story-motion-thin" }],
      },
    },
    {
      prevalidatedEvergreenDiscoveryInputs: true,
      evergreenDiscoveryGenerator: async () => ({ pitches: [] }),
      async discoverEvergreenVerdictPitches() {
        return {
          schema_version:
            "pulse-evergreen-autonomous-discovery-v1",
          generated_at: NOW,
          mode: "LOCAL_PROOF",
          verdict: "HOLD",
          blockers: ["no_candidates_selected"],
          selected_candidates: [],
          candidate_manifests: [],
          deferred_candidates: [
            {
              story_id: workOrder.story_id,
              blockers: [workOrder.blocker],
              motion_repair_work_order_sha256:
                workOrder.work_order_sha256,
            },
          ],
          motion_repair_work_orders: [workOrder],
          safety: {
            publish_authority_created: false,
          },
        };
      },
      renderEvergreenAutonomousDiscoveryMarkdown() {
        return "# Autonomous Evergreen Discovery\n";
      },
      repos: {
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 503, ...input };
          },
        },
      },
      log() {},
    },
  );

  assert.equal(result.selected_candidate_count, 0);
  assert.equal(queued.length, 0);
  assert.equal(result.motion_repair_work_order_count, 1);
  assert.equal(
    await fs.pathExists(result.motion_repair_work_order_index_json),
    true,
  );
  assert.equal(result.motion_repair_work_orders.length, 1);
  assert.equal(result.motion_repair_execution_jobs.length, 0);
  assert.equal(result.held_motion_repair_executions.length, 1);
  assert.deepEqual(
    result.held_motion_repair_executions[0].blockers,
    ["motion_repair_execution_request_missing"],
  );
  assert.equal(
    await fs.pathExists(
      result.motion_repair_execution_queue_json,
    ),
    true,
  );
  const persisted = result.motion_repair_work_orders[0];
  assert.equal(persisted.story_id, workOrder.story_id);
  assert.equal(persisted.candidate_id, workOrder.candidate_id);
  assert.equal(
    persisted.work_order_sha256,
    workOrder.work_order_sha256,
  );
  assert.equal(await fs.pathExists(persisted.path), true);
  assert.match(persisted.file_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await fs.readJson(persisted.path), workOrder);
  const bytes = await fs.readFile(persisted.path);
  assert.equal(
    crypto.createHash("sha256").update(bytes).digest("hex"),
    persisted.file_sha256,
  );
  assert.match(
    persisted.path,
    new RegExp(
      `motion-repair[\\\\/]story-motion-thin[\\\\/]${workOrder.work_order_sha256}` +
        "[\\\\/]evergreen-motion-coverage-repair-work-order\\.json$",
    ),
  );
  const index = await fs.readJson(
    result.motion_repair_work_order_index_json,
  );
  assert.equal(
    index.schema_version,
    "pulse-evergreen-motion-coverage-repair-index-v1",
  );
  assert.deepEqual(index.work_orders, result.motion_repair_work_orders);
  assert.equal(index.safety.publish_authority_created, false);
  const executionQueue = await fs.readJson(
    result.motion_repair_execution_queue_json,
  );
  assert.equal(executionQueue.verdict, "HOLD");
  assert.equal(executionQueue.safety.publish_authority_created, false);
});

test("candidate-builder durably queues an exact local motion-repair execution request on its next pass", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-motion-execution-"),
  );
  t.after(() => fs.remove(outDir));
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  db.prepare(
    "INSERT INTO channels (id, name) VALUES (?, ?)",
  ).run("pulse-gaming", "Pulse Gaming");
  db.prepare(
    "INSERT INTO stories (id, title, channel_id) VALUES (?, ?, ?)",
  ).run(
    "story-motion-execution",
    "Motion repair execution fixture",
    "pulse-gaming",
  );
  t.after(() => db.close());
  const jobs = bindJobs(db);
  const workOrderBase = {
    schema_version:
      "pulse-evergreen-motion-coverage-repair-work-order-v1",
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    story_id: "story-motion-execution",
    candidate_id: "candidate-motion-execution",
    blocker: "exact_subject_motion_ratio_too_low",
    minimum_required_motion_seconds: 53.3,
    verified_materialised_motion_seconds: 28,
    additional_motion_seconds_required: 25.3,
    completion_contract: {
      static_images_count_as_motion_seconds: false,
      materialised_video_probe_required: true,
    },
    safety: {
      local_proof_only: true,
      publish_authority_created: false,
    },
  };
  const workOrder = {
    ...workOrderBase,
    work_order_sha256: crypto
      .createHash("sha256")
      .update(stableJson(workOrderBase))
      .digest("hex"),
  };
  const context = {
    prevalidatedEvergreenDiscoveryInputs: true,
    evergreenDiscoveryGenerator: async () => ({ pitches: [] }),
    async discoverEvergreenVerdictPitches() {
      return {
        schema_version:
          "pulse-evergreen-autonomous-discovery-v1",
        generated_at: NOW,
        mode: "LOCAL_PROOF",
        verdict: "HOLD",
        blockers: ["no_candidates_selected"],
        selected_candidates: [],
        candidate_manifests: [],
        deferred_candidates: [
          {
            story_id: workOrder.story_id,
            blockers: [workOrder.blocker],
            motion_repair_work_order_sha256:
              workOrder.work_order_sha256,
          },
        ],
        motion_repair_work_orders: [workOrder],
        safety: {
          publish_authority_created: false,
        },
      };
    },
    renderEvergreenAutonomousDiscoveryMarkdown() {
      return "# Autonomous Evergreen Discovery\n";
    },
    repos: {
      jobs,
    },
    log() {},
  };
  const job = {
    channel_id: "pulse-gaming",
    payload: {
      now: NOW,
      out_dir: outDir,
      stories: [],
      history: [],
      discovery_stories: [{ id: workOrder.story_id }],
    },
  };

  const first = await handlers.evergreen_candidate_builder(
    job,
    context,
  );
  assert.equal(jobs.listPending().length, 0);
  const persisted = first.motion_repair_work_orders[0];
  const sourceVideoPath = path.join(
    outDir,
    "operator-supplied-official-source.mp4",
  );
  const sourceBytes = Buffer.from("local-official-source-video");
  await fs.writeFile(sourceVideoPath, sourceBytes);
  const requestBase = {
    schema_version:
      "pulse-evergreen-motion-repair-execution-request-v1",
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    story_id: workOrder.story_id,
    candidate_id: workOrder.candidate_id,
    work_order: {
      path: persisted.path,
      file_sha256: persisted.file_sha256,
      work_order_sha256: persisted.work_order_sha256,
    },
    source_video: {
      path: sourceVideoPath,
      file_sha256: crypto
        .createHash("sha256")
        .update(sourceBytes)
        .digest("hex"),
      source_media_url:
        "https://publisher.example/official-source-video",
    },
    segments: [
      { start_seconds: 30, duration_seconds: 5 },
      { start_seconds: 75, duration_seconds: 5 },
      { start_seconds: 120, duration_seconds: 5 },
      { start_seconds: 165, duration_seconds: 5 },
      { start_seconds: 210, duration_seconds: 5 },
      { start_seconds: 255, duration_seconds: 5 },
    ],
    output_dir: path.join(
      path.dirname(persisted.path),
      "materialised-motion",
    ),
    apply_local: true,
    operator_confirmation:
      "MATERIALISE_LOCAL_MUTED_SEGMENTS",
    safety: {
      local_proof_only: true,
      network_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      platform_contact_authorised: false,
      publish_authority_created: false,
    },
  };
  const request = {
    ...requestBase,
    request_sha256: crypto
      .createHash("sha256")
      .update(stableJson(requestBase))
      .digest("hex"),
  };
  await fs.writeJson(
    path.join(
      path.dirname(persisted.path),
      "evergreen-motion-repair-execution-request.json",
    ),
    request,
    { spaces: 2 },
  );

  const second = await handlers.evergreen_candidate_builder(
    {
      ...job,
      payload: {
        ...job.payload,
        now: "2026-07-28T12:01:00.000Z",
      },
    },
    context,
  );

  const queued = jobs
    .listPending()
    .filter(
      (item) =>
        item.kind === "materialize_evergreen_motion_repair",
    );
  assert.equal(queued.length, 1);
  assert.equal(
    queued[0].kind,
    "materialize_evergreen_motion_repair",
  );
  assert.equal(queued[0].channel_id, "pulse-gaming");
  assert.equal(
    queued[0].payload.work_order.work_order_sha256,
    persisted.work_order_sha256,
  );
  assert.equal(
    queued[0].payload.execution_request.request_sha256,
    request.request_sha256,
  );
  assert.equal(queued[0].payload.apply_local_authorised, true);
  assert.equal(queued[0].payload.publish_authority, false);
  assert.equal(
    second.motion_repair_execution_jobs.length,
    1,
  );
  assert.equal(
    queued[0].payload.generated_at,
    request.generated_at,
  );

  const third = await handlers.evergreen_candidate_builder(
    {
      ...job,
      payload: {
        ...job.payload,
        now: "2026-07-28T12:02:00.000Z",
      },
    },
    context,
  );

  assert.equal(
    jobs
      .listPending()
      .filter(
        (item) =>
          item.kind ===
          "materialize_evergreen_motion_repair",
      ).length,
    1,
  );
  assert.equal(third.motion_repair_execution_jobs.length, 0);
  assert.equal(
    third.reused_motion_repair_execution_jobs.length,
    1,
  );
  assert.equal(
    third.reused_motion_repair_execution_jobs[0].status,
    "pending",
  );
  const reusedProof = await fs.readJson(
    third.motion_repair_execution_queue_json,
  );
  assert.equal(reusedProof.verdict, "REUSED");
  assert.equal(reusedProof.queued.length, 0);
  assert.equal(reusedProof.reused.length, 1);
  assert.equal(reusedProof.safety.database_jobs_enqueued, 0);
  const claimed = jobs.claim("motion-repair-test-worker", {
    kinds: ["materialize_evergreen_motion_repair"],
  });
  assert.equal(claimed.id, queued[0].id);
  jobs.complete(
    claimed.id,
    "motion-repair-test-worker",
    claimed.claim_token,
  );
  const fourth = await handlers.evergreen_candidate_builder(
    {
      ...job,
      payload: {
        ...job.payload,
        now: "2026-07-28T12:03:00.000Z",
      },
    },
    context,
  );
  assert.equal(fourth.motion_repair_execution_jobs.length, 0);
  assert.equal(
    fourth.reused_motion_repair_execution_jobs.length,
    0,
  );
  assert.equal(
    fourth.completed_motion_repair_execution_jobs.length,
    1,
  );
  assert.equal(
    fourth.completed_motion_repair_execution_jobs[0].status,
    "done",
  );
  const completedProof = await fs.readJson(
    fourth.motion_repair_execution_queue_json,
  );
  assert.equal(completedProof.verdict, "DONE");
  assert.equal(completedProof.queued.length, 0);
  assert.equal(completedProof.done.length, 1);
  assert.equal(completedProof.safety.database_jobs_enqueued, 0);
  assert.equal(second.no_publish, true);
});

test("candidate-builder defaults governed Google discovery to the 8,192-token long-output lane", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-google-budget-handler-"),
  );
  t.after(() => fs.remove(outDir));
  const priorBudget =
    process.env.PULSE_EVERGREEN_DISCOVERY_MAX_TOKENS;
  const priorPaidAiEnabled =
    process.env.PULSE_PAID_AI_ENABLED;
  delete process.env.PULSE_EVERGREEN_DISCOVERY_MAX_TOKENS;
  process.env.PULSE_PAID_AI_ENABLED = "true";
  t.after(() => {
    if (priorBudget === undefined) {
      delete process.env.PULSE_EVERGREEN_DISCOVERY_MAX_TOKENS;
    } else {
      process.env.PULSE_EVERGREEN_DISCOVERY_MAX_TOKENS = priorBudget;
    }
    if (priorPaidAiEnabled === undefined) {
      delete process.env.PULSE_PAID_AI_ENABLED;
    } else {
      process.env.PULSE_PAID_AI_ENABLED = priorPaidAiEnabled;
    }
  });
  const calls = [];
  const context = {
    prevalidatedEvergreenDiscoveryInputs: true,
    editorialMessagesClient: {
      editorial_identity: {
        provider: "google",
        model: "gemini-evergreen-handler-test",
        adapter: "gemini.generateContent",
      },
      messages: {
        async create(input) {
          calls.push(input);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ pitches: [] }),
              },
            ],
          };
        },
      },
    },
    async discoverEvergreenVerdictPitches(input) {
      await input.generator({
        schema_version:
          "pulse-evergreen-discovery-generation-request-v1",
        stories: [],
      });
      return {
        schema_version: "pulse-evergreen-autonomous-discovery-v1",
        generated_at: NOW,
        mode: "LOCAL_PROOF",
        verdict: "HOLD",
        blockers: ["fixture_no_pitch"],
        selected_candidates: [],
        candidate_manifests: [],
        deferred_candidates: [],
        safety: { publish_authority_created: false },
      };
    },
    renderEvergreenAutonomousDiscoveryMarkdown() {
      return "# Discovery\n";
    },
  };
  const job = {
    channel_id: "pulse-gaming",
    payload: {
      now: NOW,
      out_dir: outDir,
      stories: [],
      history: [],
      discovery_stories: [{ id: "story-google-budget" }],
    },
  };

  await handlers.evergreen_candidate_builder(
    job,
    context,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].max_tokens, 8_192);
  assert.equal(calls[0].editorial_request_profile, "long_output");
  assert.equal(calls[0].editorial_thinking_level, "low");

  await handlers.evergreen_candidate_builder(
    {
      ...job,
      payload: {
        ...job.payload,
        discovery_generator_max_tokens: 12_288,
      },
    },
    context,
  );
  assert.equal(calls[1].max_tokens, 12_288);
});

test("scheduled evergreen discovery adapts canonical repository evidence before editorial generation", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-adapter-handler-"),
  );
  t.after(() => fs.remove(outDir));
  const canonicalStory = {
    id: "story-governed-evergreen",
    title: "A governed evergreen source story",
    franchise: "Halo",
    platform: "xbox",
    topic_key: "progression",
    _extra: "{}",
  };
  const score = {
    id: 9,
    story_id: canonicalStory.id,
    advertiser_safety: 5,
    hard_stops: "[]",
    scored_at: NOW,
    scorer_version: "v1.0",
  };
  const adaptedStory = {
    id: canonicalStory.id,
    title: canonicalStory.title,
    franchise: "Halo",
    platform: "xbox",
    topic_key: "progression",
    source_evidence: {
      verification_status: "CONFIRMED",
      claims: [],
    },
    rights_evidence: { decision: "CLEARED" },
    advertiser_safety: { decision: "SAFE" },
  };
  let adaptedInput = null;
  let discoveryInput = null;

  const result = await handlers.evergreen_candidate_builder(
    {
      channel_id: "pulse-gaming",
      payload: {
        now: NOW,
        out_dir: outDir,
        scan_editorial_inventory: false,
      },
    },
    {
      repos: {
        db: {
          prepare(sql) {
            return {
              all() {
                return /FROM\s+story_scores/i.test(sql)
                  ? [score]
                  : [canonicalStory];
              },
            };
          },
        },
      },
      async buildEvergreenAutonomousDiscoveryInputs(input) {
        adaptedInput = input;
        return {
          schema_version:
            "pulse-evergreen-autonomous-input-adapter-v1",
          generated_at: NOW,
          mode: "LOCAL_PROOF",
          verdict: "READY_FOR_DISCOVERY",
          blockers: [],
          discovery_inputs: {
            stories: [adaptedStory],
            manifests: [],
          },
          accepted_inputs: [],
          rejected_inputs: [],
          summary: {
            input_count: 1,
            accepted_count: 1,
            rejected_count: 0,
          },
          safety: {
            read_only: true,
            network_used: false,
            database_mutated: false,
            oauth_mutated: false,
            publish_authority_created: false,
          },
        };
      },
      async discoverEvergreenVerdictPitches(input) {
        discoveryInput = input;
        return {
          schema_version:
            "pulse-evergreen-autonomous-discovery-v1",
          generated_at: NOW,
          mode: "LOCAL_PROOF",
          verdict: "HOLD",
          blockers: ["fixture_no_pitch"],
          selected_candidates: [],
          candidate_manifests: [],
          deferred_candidates: [],
          safety: {
            publish_authority_created: false,
          },
        };
      },
      renderEvergreenAutonomousDiscoveryMarkdown() {
        return "# Discovery\n";
      },
    },
  );

  assert.deepEqual(adaptedInput.stories, [canonicalStory]);
  assert.deepEqual(adaptedInput.advertiser_safety_scores, [score]);
  assert.deepEqual(discoveryInput.stories, [adaptedStory]);
  assert.deepEqual(discoveryInput.manifests, []);
  assert.equal(
    await fs.pathExists(
      result.autonomous_input_adapter_json,
    ),
    true,
  );
  assert.equal(
    await fs.pathExists(
      result.autonomous_input_adapter_markdown,
    ),
    true,
  );
  assert.equal(result.autonomous_input_adapter_verdict, "READY_FOR_DISCOVERY");
});
