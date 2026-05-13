const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocalPostingReadiness,
  formatLocalPostingReadinessMarkdown,
} = require("../../lib/ops/local-posting-readiness");

function greenTts() {
  return {
    verdict: "GREEN",
    proof_batch: { voice_ready_count: 6 },
  };
}

test("local posting readiness keeps Railway as standby and ElevenLabs temporary", () => {
  const report = buildLocalPostingReadiness({
    cutoverPlan: {
      verdict: "red",
      env: {
        duplicate_keys: ["AUTO_PUBLISH", "USE_JOB_QUEUE"],
        flags: {
          primary: false,
          use_job_queue: false,
          auto_publish: false,
        },
      },
      cloudflared: { tunnel_info: "Your tunnel does not have any active connection." },
      health: {
        local: { ok: true, status: 200 },
        public: { ok: false, status: 530 },
      },
    },
    primaryReadiness: {
      checks: {
        primary_enabled: false,
        use_job_queue_enabled: false,
        auto_publish_enabled: false,
      },
      health: {
        local: { ok: true, status: 200 },
        public: { ok: false, status: 530 },
      },
    },
    ttsReport: greenTts(),
    now: new Date("2026-05-12T20:00:00Z"),
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.strategy.railway_role, "standby_optional_only");
  assert.equal(report.strategy.voice, "local_liam_primary_goal_elevenlabs_temporary_bridge");
  assert.ok(report.blockers.includes("pulse.orryy.com Cloudflare tunnel is not connected to this PC"));
  assert.ok(report.blockers.includes("local instance is still mirror mode, not primary"));
});

test("local posting readiness is green when local primary route is actually ready", () => {
  const report = buildLocalPostingReadiness({
    cutoverPlan: {
      verdict: "green",
      env: {
        duplicate_keys: [],
        flags: {
          primary: true,
          use_job_queue: true,
          auto_publish: true,
        },
      },
      cloudflared: { tunnel_info: "Active connections: 2" },
      health: {
        local: { ok: true, status: 200 },
        public: { ok: true, status: 200 },
      },
    },
    primaryReadiness: {
      checks: {
        primary_enabled: true,
        use_job_queue_enabled: true,
        auto_publish_enabled: true,
      },
      health: {
        local: { ok: true, status: 200 },
        public: { ok: true, status: 200 },
      },
    },
    ttsReport: greenTts(),
  });

  assert.equal(report.verdict, "green");
  assert.equal(report.status, "ready_to_resume_local_posting");
  assert.deepEqual(report.blockers, []);
});

test("local posting readiness treats public local health as an active tunnel", () => {
  const report = buildLocalPostingReadiness({
    cutoverPlan: {
      verdict: "red",
      env: {
        duplicate_keys: [],
        flags: {
          primary: false,
          use_job_queue: true,
          auto_publish: true,
        },
      },
      cloudflared: { tunnel_info: "Your tunnel does not have any active connection." },
      health: {
        local: { ok: true, status: 200, json: { deployment: { mode: "local", primary: false } } },
        public: { ok: true, status: 200, json: { deployment: { mode: "local", primary: false } } },
      },
    },
    ttsReport: greenTts(),
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.readiness.public_health, true);
  assert.equal(report.readiness.tunnel_connected, true);
  assert.ok(!report.blockers.includes("pulse.orryy.com Cloudflare tunnel is not connected to this PC"));
  assert.ok(report.blockers.includes("local instance is still mirror mode, not primary"));
});

test("local posting readiness blocks if Liam proof batch is missing", () => {
  const report = buildLocalPostingReadiness({
    cutoverPlan: {
      verdict: "green",
      env: {
        duplicate_keys: [],
        flags: {
          primary: true,
          use_job_queue: true,
          auto_publish: true,
        },
      },
      cloudflared: { tunnel_info: "Active connections: 2" },
      health: {
        local: { ok: true, status: 200 },
        public: { ok: true, status: 200 },
      },
    },
    primaryReadiness: {
      checks: {
        primary_enabled: true,
        use_job_queue_enabled: true,
        auto_publish_enabled: true,
      },
      health: {
        local: { ok: true, status: 200 },
        public: { ok: true, status: 200 },
      },
    },
    ttsReport: { verdict: "RED", proof_batch: { voice_ready_count: 0 } },
  });

  assert.equal(report.verdict, "red");
  assert.ok(report.blockers.includes("local Liam TTS readiness is not green"));
  assert.ok(report.blockers.includes("no local Liam voice-ready proof MP3s are available"));
});

test("local posting readiness markdown is operator readable", () => {
  const report = buildLocalPostingReadiness({
    cutoverPlan: {
      verdict: "red",
      env: { duplicate_keys: ["AUTO_PUBLISH"], flags: {} },
      cloudflared: { tunnel_info: "no active connection" },
      health: {
        local: { ok: true, status: 200 },
        public: { ok: false, status: 530 },
      },
    },
    ttsReport: greenTts(),
  });
  const markdown = formatLocalPostingReadinessMarkdown(report);

  assert.match(markdown, /Railway: standby\/optional only/);
  assert.match(markdown, /ElevenLabs is a temporary bridge/);
  assert.match(markdown, /cloudflared tunnel --config D:\/pulse-data\/cloudflared-pulse\.yml/);
});
