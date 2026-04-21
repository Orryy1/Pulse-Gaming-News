const { test } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const http = require("node:http");

const {
  buildSchedulerPlan,
  sanitiseScheduleEntry,
  humaniseCron,
  laneFor,
} = require("../../lib/services/scheduler-plan");
const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");

// ---------- humaniseCron ----------

test("humaniseCron: daily M H * * * → 'daily HH:MM UTC'", () => {
  assert.strictEqual(humaniseCron("0 19 * * *"), "daily 19:00 UTC");
  assert.strictEqual(humaniseCron("30 17 * * *"), "daily 17:30 UTC");
  assert.strictEqual(humaniseCron("5 4 * * *"), "daily 04:05 UTC");
});

test("humaniseCron: weekly M H * * D → 'weekly <Day> HH:MM UTC'", () => {
  assert.strictEqual(humaniseCron("0 14 * * 0"), "weekly Sun 14:00 UTC");
  assert.strictEqual(humaniseCron("0 3 * * 1"), "weekly Mon 03:00 UTC");
});

test("humaniseCron: monthly M H D * * → 'monthly day-D HH:MM UTC'", () => {
  assert.strictEqual(humaniseCron("0 10 1 * *"), "monthly day-1 10:00 UTC");
});

test("humaniseCron: */N interval → 'every N min'", () => {
  assert.strictEqual(humaniseCron("*/15 * * * *"), "every 15 min");
  assert.strictEqual(humaniseCron("*/1 * * * *"), "every 1 min");
});

test("humaniseCron: unknown patterns fall back to raw expression", () => {
  // No catch-all mapping — operator still sees the expression.
  const unusual = "0 */4 1,15 * *";
  assert.strictEqual(humaniseCron(unusual), unusual);
});

test("humaniseCron: non-string input → null", () => {
  assert.strictEqual(humaniseCron(null), null);
  assert.strictEqual(humaniseCron(undefined), null);
  assert.strictEqual(humaniseCron(12345), null);
});

// ---------- laneFor ----------

test("laneFor: produce_morning → normal", () => {
  assert.strictEqual(
    laneFor({ name: "produce_morning", kind: "produce" }),
    "normal",
  );
});

test("laneFor: publish_primary → normal", () => {
  assert.strictEqual(
    laneFor({ name: "publish_primary", kind: "publish" }),
    "normal",
  );
});

test("laneFor: hunt_morning → hunt", () => {
  assert.strictEqual(laneFor({ name: "hunt_morning", kind: "hunt" }), "hunt");
});

test("laneFor: tiktok_auth_check → auth-check", () => {
  assert.strictEqual(
    laneFor({ name: "tiktok_auth_check", kind: "tiktok_auth_check" }),
    "auth-check",
  );
});

test("laneFor: analytics_morning → analytics", () => {
  assert.strictEqual(
    laneFor({ name: "analytics_morning", kind: "analytics" }),
    "analytics",
  );
});

test("laneFor: jobs_reap_stale → maintenance", () => {
  assert.strictEqual(
    laneFor({ name: "jobs_reap_stale", kind: "jobs_reap" }),
    "maintenance",
  );
});

test("laneFor: unknown name + unknown kind → 'other'", () => {
  assert.strictEqual(laneFor({ name: "??", kind: "mystery" }), "other");
});

test("laneFor: kind fallback when name isn't in the map", () => {
  // An unknown-named but known-kind schedule still gets a lane.
  assert.strictEqual(
    laneFor({ name: "bespoke_produce", kind: "produce" }),
    "normal",
  );
});

// ---------- sanitiseScheduleEntry ----------

test("sanitiseScheduleEntry: shapes a full row", () => {
  const out = sanitiseScheduleEntry({
    name: "publish_primary",
    kind: "publish",
    cron_expr: "0 19 * * *",
    priority: 20,
    enabled: 1,
    idempotencyTemplate: "publish:{date}:19", // should NOT leak
  });
  assert.deepStrictEqual(out, {
    name: "publish_primary",
    kind: "publish",
    cron_expr: "0 19 * * *",
    human_time: "daily 19:00 UTC",
    priority: 20,
    lane: "normal",
    enabled: true,
  });
  // Idempotency template is internal — must not be emitted.
  assert.strictEqual("idempotencyTemplate" in out, false);
});

test("sanitiseScheduleEntry: null input → null", () => {
  assert.strictEqual(sanitiseScheduleEntry(null), null);
  assert.strictEqual(sanitiseScheduleEntry(undefined), null);
});

test("sanitiseScheduleEntry: defaults enabled to true when field absent", () => {
  // The schedules table has enabled INTEGER DEFAULT 1, so a
  // schedule registered without the flag is "on". Mirror that.
  const out = sanitiseScheduleEntry({
    name: "x",
    kind: "produce",
    cron_expr: "0 12 * * *",
  });
  assert.strictEqual(out.enabled, true);
});

// ---------- buildSchedulerPlan ----------

test("buildSchedulerPlan: surfaces every DEFAULT_SCHEDULE", () => {
  const plan = buildSchedulerPlan(DEFAULT_SCHEDULES);
  assert.strictEqual(plan.total, DEFAULT_SCHEDULES.length);
  assert.ok(plan.schedules.length > 0);
  // Each entry has the stable fields.
  for (const s of plan.schedules) {
    assert.ok(typeof s.name === "string");
    assert.ok(typeof s.kind === "string");
    assert.ok(typeof s.cron_expr === "string");
    assert.ok(typeof s.lane === "string");
  }
});

test("buildSchedulerPlan: cadence_status reflects the 3x publish windows shipped in Task 3", () => {
  const plan = buildSchedulerPlan(DEFAULT_SCHEDULES);
  assert.strictEqual(plan.cadence_status.morning_publish, true);
  assert.strictEqual(plan.cadence_status.afternoon_publish, true);
  assert.strictEqual(plan.cadence_status.evening_publish, true);
  assert.strictEqual(plan.cadence_status.daily_publish_slots, 3);
});

test("buildSchedulerPlan: by_lane includes at least normal + hunt + maintenance", () => {
  const plan = buildSchedulerPlan(DEFAULT_SCHEDULES);
  assert.ok(plan.by_lane.normal >= 6, "3 produce + 3 publish = 6 normal");
  assert.ok(plan.by_lane.hunt >= 4, "4+ hunt windows");
  assert.ok(plan.by_lane.maintenance >= 1);
});

test("buildSchedulerPlan: no secret-shaped field leaks", () => {
  const plan = buildSchedulerPlan([
    {
      name: "x",
      kind: "produce",
      cron_expr: "0 18 * * *",
      priority: 30,
      enabled: 1,
      idempotencyTemplate: "produce:{date}:18",
      payload: { secret: "should_not_leak" },
    },
  ]);
  const serialised = JSON.stringify(plan);
  assert.strictEqual(serialised.includes("secret"), false);
  assert.strictEqual(serialised.includes("idempotency"), false);
});

test("buildSchedulerPlan: stable ordering — lane group, then cron", () => {
  const plan = buildSchedulerPlan(DEFAULT_SCHEDULES);
  // Within a lane, entries should be sorted by cron_expr.
  for (let i = 1; i < plan.schedules.length; i++) {
    const prev = plan.schedules[i - 1];
    const cur = plan.schedules[i];
    if (prev.lane === cur.lane) {
      assert.ok(
        (prev.cron_expr || "") <= (cur.cron_expr || ""),
        `ordering broken at ${prev.name} / ${cur.name}`,
      );
    }
  }
});

test("buildSchedulerPlan: empty / non-array input returns empty", () => {
  const plan = buildSchedulerPlan(null);
  assert.strictEqual(plan.total, 0);
  assert.deepStrictEqual(plan.schedules, []);
});

// ---------- HTTP contract: auth + response shape ----------

function buildTestApp({ apiToken }) {
  const app = express();
  function requireAuth(req, res, next) {
    if (!apiToken) return next();
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/, "");
    if (tok !== apiToken)
      return res.status(401).json({ error: "Unauthorized" });
    next();
  }
  app.get("/api/scheduler/plan", requireAuth, (req, res) => {
    res.json(buildSchedulerPlan(DEFAULT_SCHEDULES));
  });
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ server, port: server.address().port }),
    );
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("GET /api/scheduler/plan: 401 without Bearer", async () => {
  const app = buildTestApp({ apiToken: "tok_verysecret123" });
  const { server, port } = await listen(app);
  try {
    const r = await get(port, "/api/scheduler/plan");
    assert.strictEqual(r.status, 401);
  } finally {
    server.close();
  }
});

test("GET /api/scheduler/plan: authenticated returns schedule list + cadence status + TikTok auth-check", async () => {
  const app = buildTestApp({ apiToken: "tok_verysecret123" });
  const { server, port } = await listen(app);
  try {
    const r = await get(port, "/api/scheduler/plan", {
      Authorization: "Bearer tok_verysecret123",
    });
    assert.strictEqual(r.status, 200);
    const body = JSON.parse(r.body);
    assert.ok(body.total > 0);
    assert.ok(body.schedules.length === body.total);
    assert.ok(body.cadence_status);
    // TikTok auth-check must be surfaced per the brief.
    assert.ok(
      body.schedules.some(
        (s) => s.name === "tiktok_auth_check" && s.lane === "auth-check",
      ),
    );
    // Publish windows surfaced with "normal" lane.
    const publishWindows = body.schedules.filter((s) => s.kind === "publish");
    assert.strictEqual(publishWindows.length, 3);
    for (const p of publishWindows) assert.strictEqual(p.lane, "normal");
  } finally {
    server.close();
  }
});

test("GET /api/scheduler/plan: body has no secret-shaped strings", async () => {
  const app = buildTestApp({ apiToken: "tok_verysecret123" });
  const { server, port } = await listen(app);
  try {
    const r = await get(port, "/api/scheduler/plan", {
      Authorization: "Bearer tok_verysecret123",
    });
    // Token not echoed in the plan.
    assert.strictEqual(r.body.includes("tok_verysecret123"), false);
    // Idempotency templates not surfaced.
    assert.strictEqual(r.body.includes("idempotency"), false);
  } finally {
    server.close();
  }
});
