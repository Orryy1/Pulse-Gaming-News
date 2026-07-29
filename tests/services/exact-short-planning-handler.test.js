"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { handlers } = require("../../lib/job-handlers");

function sourceEvidenceHash() {
  return crypto
    .createHash("sha256")
    .update("official Xbox source captured at 2026-07-28T14:05:00Z")
    .digest("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function breakingStory(overrides = {}) {
  return {
    id: "breaking-plan-1",
    title: "Xbox confirms a major compatibility update",
    approved: 1,
    full_script:
      "Xbox has confirmed a major compatibility update. Here is what changes, who gets it and why the timing matters.",
    breaking_score: 130,
    publish_status: "review",
    _extra: JSON.stringify({
      verification_status: "CONFIRMED",
      primary_source_url:
        "https://news.xbox.com/en-us/2026/07/28/example/",
      source_evidence_sha256: sourceEvidenceHash(),
    }),
    ...overrides,
  };
}

function evergreenPitch() {
  const pitch = {
    id: "halo-combat-loop-verdict",
    story_id: "evergreen-plan-1",
    title: "Why Halo's Combat Loop Still Works",
    subject: "Halo: Combat Evolved",
    franchise: "Halo",
    format_shape: "still_worth_playing",
    thesis:
      "Halo's thirty-second combat loop still explains why its encounters remain readable.",
    editorial_criteria: [
      "combat readability",
      "decision pressure",
      "encounter variety",
    ],
    item_rationales: [
      {
        subject: "weapon limit",
        judgement: "Keeps pickups tactically meaningful.",
        source_url: "https://www.xbox.com/en-GB/games/store/halo-combat-evolved/",
      },
      {
        subject: "shield recharge",
        judgement: "Creates an explicit attack-and-reset rhythm.",
        source_url: "https://support.xbox.com/en-GB/example-halo-manual",
      },
      {
        subject: "enemy roles",
        judgement: "Changes the same readable loop without hiding it.",
        source_url: "https://www.halowaypoint.com/en-gb/games/halo-combat-evolved",
      },
    ],
    claims: [
      {
        id: "claim-loop",
        text: "Bungie described the combat around a repeatable thirty-second loop.",
        source_url: "https://www.gdcvault.com/example-halo-loop",
      },
      {
        id: "claim-weapons",
        text: "The two-weapon limit forces frequent tactical swaps.",
        source_url: "https://www.xbox.com/en-GB/games/store/halo-combat-evolved/",
      },
      {
        id: "claim-shields",
        text: "Shield recharge creates a clear attack-and-reset rhythm.",
        source_url: "https://support.xbox.com/en-GB/example-halo-manual",
      },
    ],
    rights: [
      {
        asset_id: "owned-halo-diagram",
        licence: "owned",
        source_url: "https://pulse.invalid/owned/hf-loop-diagram",
      },
    ],
    source_manifest: [
      {
        name: "Xbox",
        url: "https://www.xbox.com/en-GB/games/store/halo-combat-evolved/",
        tier: "official_platform",
      },
      {
        name: "Halo Waypoint",
        url: "https://www.halowaypoint.com/en-gb/games/halo-combat-evolved",
        tier: "official_publisher",
      },
    ],
    script_contract: {
      voice_mode: "sourced_synthesis",
      uses_first_person_play_claims: false,
      target_duration_seconds: 70,
      target_words_per_minute: 175,
      opening_premise_words: 9,
      closing_cta_count: 0,
      originality: {
        script_original: true,
        copied_reference_script: false,
        copied_reference_sequence: false,
        competitor_assets_used: false,
        reviewed_by: "editorial-review-001",
      },
    },
    media_plan: {
      exact_subject_motion_seconds: 54,
      clip_count: 6,
      distinct_motion_families: 3,
      unknown_reuploads: 0,
      third_party_music: false,
      rights_records: [
        {
          asset_id: "owned-halo-gameplay-a",
          owner: "Pulse Gaming",
          source_url: "https://www.xbox.com/en-GB/games/store/halo-combat-evolved/",
          rights_basis: "owned_capture",
          usage: "gameplay_backbone",
        },
        {
          asset_id: "owned-halo-diagram",
          owner: "Pulse Gaming",
          source_url: "https://pulse.invalid/owned/hf-loop-diagram",
          rights_basis: "owned_capture",
          usage: "owned_motion",
        },
        {
          asset_id: "owned-halo-timeline",
          owner: "Pulse Gaming",
          source_url: "https://pulse.invalid/owned/hf-shield-timeline",
          rights_basis: "owned_capture",
          usage: "owned_motion",
        },
      ],
    },
    visual_beats: [
      {
        id: "beat-hook",
        section: "hook",
        start_seconds: 0,
        end_seconds: 6,
        asset_id: "owned-halo-gameplay-a",
        overlay_text: "THE 30-SECOND LOOP",
      },
      {
        id: "beat-loop",
        section: "body",
        start_seconds: 6,
        end_seconds: 15,
        asset_id: "owned-halo-diagram",
        overlay_text: "PRESSURE. RETREAT. RESET.",
      },
      {
        id: "beat-weapons",
        section: "body",
        start_seconds: 15,
        end_seconds: 24,
        asset_id: "owned-halo-gameplay-a",
        overlay_text: "TWO WEAPONS. REAL CHOICES.",
      },
      {
        id: "beat-shields",
        section: "body",
        start_seconds: 24,
        end_seconds: 33,
        asset_id: "owned-halo-timeline",
        overlay_text: "SHIELDS SET THE RHYTHM",
      },
      {
        id: "beat-enemies",
        section: "body",
        start_seconds: 33,
        end_seconds: 42,
        asset_id: "owned-halo-gameplay-a",
        overlay_text: "EVERY ENEMY CHANGES IT",
      },
      {
        id: "beat-arena",
        section: "body",
        start_seconds: 42,
        end_seconds: 52,
        asset_id: "owned-halo-diagram",
        overlay_text: "READABLE IN MOTION",
      },
      {
        id: "beat-payoff",
        section: "payoff",
        start_seconds: 52,
        end_seconds: 62,
        asset_id: "owned-halo-timeline",
        overlay_text: "CLARITY AGES WELL",
      },
      {
        id: "beat-callback",
        section: "loop",
        start_seconds: 62,
        end_seconds: 70,
        asset_id: "owned-halo-gameplay-a",
        overlay_text: "NOW YOU CAN SEE IT",
      },
    ],
  };
  pitch.script_material = {
    hook: {
      text:
        "Halo solved readable combat with one deceptively simple loop.",
      claim_refs: ["claim-loop"],
    },
    body: {
      text:
        "Bungie built the encounter rhythm around pressure, retreat and reset. A fight asks you to establish an advantage, spend it carefully and recognise the instant that advantage disappears. The two-weapon limit makes every replacement a tactical choice instead of an inventory chore. Rechargeable shields create a visible decision point: keep pushing while the field is favourable or break line of sight before the next exchange. Enemy roles then remix that same readable structure. Elites resist pressure and punish hesitation. Grunts create openings but can overwhelm careless movement. Jackals interrupt comfortable firing lines and force a change of angle. The arena matters because cover, distance and weapon placement alter the answer without changing the underlying language. That is why combat stays legible even when several threats arrive together. Players can identify what went wrong, change one decision and immediately test the new approach. The game creates depth through combinations rather than layers of hidden rules, so the challenge can escalate while the player still understands the cause and effect.",
      claim_refs: [
        "claim-loop",
        "claim-weapons",
        "claim-shields",
      ],
    },
    payoff: {
      text:
        "That clarity is the real reason the original still feels deliberate. Its systems communicate pressure, recovery and choice without pausing the action to explain themselves.",
      claim_refs: [
        "claim-loop",
        "claim-weapons",
        "claim-shields",
      ],
    },
    loop: {
      text:
        "Once you notice that rhythm, every memorable Halo arena starts revealing the same elegant loop.",
      claim_refs: ["claim-loop"],
    },
  };
  return pitch;
}

test("breaking planner writes an exact work order and queues only its governed production job", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-plan-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const story = breakingStory();

  const result = await handlers.plan_breaking_short(
    {
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "breaking_short",
        story_id: story.id,
        out_dir: outDir,
      },
    },
    {
      repos: {
        stories: { get: () => story },
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 501, ...input };
          },
        },
      },
    },
  );

  assert.equal(
    result.status,
    "READY_FOR_EXACT_PRODUCTION",
    JSON.stringify(result),
  );
  assert.equal(result.no_publish, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "produce_breaking_short");
  assert.equal(queued[0].story_id, story.id);
  assert.equal(queued[0].payload.story_id, story.id);
  assert.equal(queued[0].payload.lane_id, "breaking_short");
  assert.equal(await fs.pathExists(result.work_order_json), true);
  assert.equal(await fs.pathExists(result.work_order_markdown), true);
  const observedWorkOrderSha256 = sha256(
    await fs.readFile(result.work_order_json),
  );
  assert.deepEqual(
    queued[0].payload.production_work_order_ref,
    {
      path: result.work_order_json,
      sha256: observedWorkOrderSha256,
      story_id: story.id,
      lane_id: "breaking_short",
    },
  );

  const workOrder = await fs.readJson(result.work_order_json);
  assert.equal(workOrder.story_id, story.id);
  assert.equal(workOrder.source_evidence_sha256, sourceEvidenceHash());
  assert.equal(workOrder.publish_authority, false);
  assert.deepEqual(workOrder.blockers, []);
});

test("breaking planner fails closed and produces evidence instead of a render job", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-held-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const story = breakingStory({
    _extra: JSON.stringify({
      verification_status: "CONFIRMED",
      primary_source_url:
        "https://news.xbox.com/en-us/2026/07/28/example/",
    }),
  });

  const result = await handlers.plan_breaking_short(
    {
      payload: {
        lane_id: "breaking_short",
        story_id: story.id,
        out_dir: outDir,
      },
    },
    {
      repos: {
        stories: { get: () => story },
        jobs: { enqueue: (input) => queued.push(input) },
      },
    },
  );

  assert.equal(result.status, "HOLD");
  assert.deepEqual(result.blockers, [
    "source_evidence_sha256_required",
  ]);
  assert.equal(queued.length, 0);
  assert.equal(await fs.pathExists(result.work_order_json), true);
});

test("breaking planner can prepare an unapproved story only for explicit local human review", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-breaking-local-review-plan-"),
  );
  t.after(() => fs.remove(outDir));
  const queued = [];
  const story = breakingStory({ approved: 0 });

  const result = await handlers.plan_breaking_short(
    {
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "breaking_short",
        story_id: story.id,
        out_dir: outDir,
        publish_authority: false,
        human_review_required: true,
      },
    },
    {
      repos: {
        stories: { get: () => story },
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 503, ...input };
          },
        },
      },
    },
  );

  assert.equal(result.status, "READY_FOR_EXACT_PRODUCTION");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].payload.publish_authority, false);
  assert.equal(queued[0].payload.human_review_required, true);
});

test("evergreen planner retains the explicit pitch and queues the exact evergreen renderer", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-plan-"),
  );
  t.after(() => fs.remove(outDir));
  const pitch = evergreenPitch();
  const story = {
    id: "evergreen-plan-1",
    title: "Why Halo's combat loop still works",
    url: "https://www.halowaypoint.com/en-gb/games/halo-combat-evolved",
    source_confidence: "verified",
    approved: 1,
    full_script: [
      pitch.script_material.hook.text,
      pitch.script_material.body.text,
      pitch.script_material.payoff.text,
      pitch.script_material.loop.text,
    ].join(" "),
    publish_status: "review",
    _extra: JSON.stringify({
      editorial_format: "evergreen_verdict_short",
      evergreen_pitch: pitch,
    }),
  };
  const queued = [];

  const result = await handlers.plan_evergreen_short(
    {
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "evergreen_short",
        story_id: story.id,
        candidate_id: pitch.id,
        evergreen_pitch: pitch,
        out_dir: outDir,
      },
    },
    {
      repos: {
        stories: { get: () => story },
        jobs: {
          enqueue(input) {
            queued.push(input);
            return { id: 502, ...input };
          },
        },
      },
    },
  );

  assert.equal(
    result.status,
    "READY_FOR_EXACT_PRODUCTION",
    JSON.stringify(result),
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "produce_evergreen_short");
  assert.deepEqual(
    queued[0].payload.evergreen_pitch,
    pitch,
  );
  const workOrder = await fs.readJson(result.work_order_json);
  assert.equal(workOrder.format_family, "evergreen_verdict_short");
  assert.equal(workOrder.evergreen_pitch.id, pitch.id);
  assert.equal(workOrder.publish_authority, false);
});
