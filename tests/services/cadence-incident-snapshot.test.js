"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCadenceIncidentSnapshot,
} = require("../../lib/cadence-incident-snapshot");

test("cadence snapshot stays RED when scheduler authority is empty and external inventory is unknown", () => {
  const report = buildCadenceIncidentSnapshot({
    generatedAt: "2026-07-23T12:00:00.000Z",
    cadenceReport: {
      generated_at: "2026-07-23T11:55:00.000Z",
      summary: {
        published_count: 0,
        scheduled_count: 0,
        next_safe_publish_at_utc: "2026-07-23T14:00:00.000Z",
      },
    },
    candidateReport: {
      generated_at: "2026-07-23T11:56:00.000Z",
      totals: {
        candidates: 0,
        excluded: 20,
      },
      bridge_candidates: {
        mode: "authoritative_bridge_only",
      },
    },
    readinessReport: {
      generated_at: "2026-07-23T11:57:00.000Z",
      overall_verdict: "red",
      blockers: ["runtime behind approved commit"],
    },
    runtimeReport: {
      generated_at: "2026-07-23T11:58:00.000Z",
      verdict: "red",
      expected: {
        commit_sha: "f27714f6b718395b3fe779963b6b953a978988a5",
      },
      summary: {
        commit_sha: "dd547e4e913e6bb471aa113114d37e407b659b26",
      },
      blockers: ["runtime commit mismatch"],
    },
    queueReport: {
      generatedAt: "2026-07-23T11:59:00.000Z",
      verdict: "review",
      counts: {
        pending: 2986,
        running: 5,
        failed: 398,
        done: 113409,
      },
    },
    ttsHealth: {
      status: "ok",
      phase: "ready",
      ready: true,
      voices: [
        {
          alias: "liam",
          loaded: true,
          reference_present: true,
          accepted_reference_id: "pulse-sleepy-liam-20260502",
        },
      ],
    },
    voiceRightsReview: {
      verdict: "RED",
      candidate: {
        sha256: "0a0819f15408c02df83bbf138c55fde6b25c5016bc42cb97611aae2cfcd48309",
      },
      blockers: ["generated_voice_human_review_pending"],
    },
    externalEvidence: {
      inventory_checked: false,
      latest_verified_post_at: "2026-07-18T18:23:09.000Z",
      seven_day_post_count_by_enabled_platform: null,
      limitation: "platform inventory was not queried",
    },
  });

  assert.equal(report.status, "RED");
  assert.equal(report.severity, "P0");
  assert.equal(report.scheduler.authoritative_candidate_count, 0);
  assert.equal(report.cadence.seven_day_post_count_by_enabled_platform, null);
  assert.equal(report.cadence.external_platform_inventory_checked, false);
  assert.equal(report.tts.process_ready, true);
  assert.equal(report.tts.voice_rights_ready, false);
  assert.equal(report.tts.effective_readiness, "RED");
  assert.equal(report.scheduler.next_safe_window_usable, false);
  assert.equal(report.runtime.commit_parity, false);
  assert.match(report.current_bottleneck, /scheduler-authoritative candidate/i);
});
