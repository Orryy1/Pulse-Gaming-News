const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocalCutoverPlan,
  formatLocalCutoverPlanMarkdown,
  parseCloudflaredConfig,
  summariseEnv,
} = require("../../lib/ops/local-cutover-plan");

test("summariseEnv reports duplicate control keys and redacts secrets", () => {
  const summary = summariseEnv(
    [
      "API_TOKEN=super-secret-token",
      "AUTO_PUBLISH=true",
      "AUTO_PUBLISH=false",
      "DEPLOYMENT_MODE=local",
      "MEDIA_ROOT=D:/pulse-data/media",
    ].join("\n"),
  );

  assert.deepEqual(summary.duplicate_keys, ["AUTO_PUBLISH"]);
  assert.equal(summary.effective_control.AUTO_PUBLISH, "false");
  assert.equal(summary.effective_control.MEDIA_ROOT, "D:/pulse-data/media");
  assert.equal(summary.effective_control.API_TOKEN, undefined);
});

test("parseCloudflaredConfig extracts tunnel and hostname routes", () => {
  const config = parseCloudflaredConfig(`
tunnel: pulse-gaming-local
credentials-file: C:\\Users\\MORR\\.cloudflared\\pulse.json

ingress:
  - hostname: pulse.orryy.com
    service: http://localhost:3001
  - service: http_status:404
`);

  assert.equal(config.present, true);
  assert.equal(config.tunnel, "pulse-gaming-local");
  assert.equal(config.ingress[0].hostname, "pulse.orryy.com");
  assert.equal(config.ingress[0].service, "http://localhost:3001");
});

test("local cutover plan catches stale default config and offline tunnel", () => {
  const plan = buildLocalCutoverPlan({
    envText: [
      "DEPLOYMENT_MODE=local",
      "PULSE_PRIMARY_INSTANCE=false",
      "USE_SQLITE=true",
      "USE_JOB_QUEUE=false",
      "AUTO_PUBLISH=false",
      "LOCAL_PUBLIC_URL=https://pulse.orryy.com",
      "MEDIA_ROOT=D:/pulse-data/media",
      "SQLITE_DB_PATH=D:/pulse-data/pulse.db",
      "AUTO_PUBLISH=false",
    ].join("\n"),
    defaultCloudflaredConfigText: `
tunnel: stale
ingress:
  - hostname: orryy.com
    service: http://localhost:3001
`,
    pulseCloudflaredConfigText: `
tunnel: 8c94c81a-8bdc-483d-a2a9-3326a79059c3
ingress:
  - hostname: pulse.orryy.com
    service: http://localhost:3001
`,
    tunnelInfo: "Your tunnel does not have any active connection.",
    localHealth: { ok: false, error: "ECONNREFUSED" },
    publicHealth: { ok: false, status: 530 },
  });

  assert.equal(plan.verdict, "red");
  assert.ok(plan.blockers.includes("duplicate local control keys: AUTO_PUBLISH"));
  assert.ok(
    plan.blockers.includes(
      "pulse-gaming-local tunnel has no active Cloudflare connection",
    ),
  );
  assert.ok(
    plan.warnings.includes(
      "default cloudflared config does not route pulse.orryy.com; start Cloudflare with the explicit Pulse config",
    ),
  );
});

test("local cutover plan goes green when mirror prerequisites are clean", () => {
  const plan = buildLocalCutoverPlan({
    envText: [
      "DEPLOYMENT_MODE=local",
      "PULSE_PRIMARY_INSTANCE=false",
      "USE_SQLITE=true",
      "USE_JOB_QUEUE=false",
      "AUTO_PUBLISH=false",
      "LOCAL_PUBLIC_URL=https://pulse.orryy.com",
      "MEDIA_ROOT=D:/pulse-data/media",
      "SQLITE_DB_PATH=D:/pulse-data/pulse.db",
    ].join("\n"),
    defaultCloudflaredConfigText: "",
    pulseCloudflaredConfigText: `
tunnel: 8c94c81a-8bdc-483d-a2a9-3326a79059c3
ingress:
  - hostname: pulse.orryy.com
    service: http://localhost:3001
`,
    tunnelInfo: "Active connections: 2xfra03",
    localHealth: { ok: true, status: 200, json: { deployment: { mode: "local" } } },
    publicHealth: { ok: true, status: 200, json: { deployment: { mode: "local" } } },
  });

  assert.equal(plan.verdict, "green");
});

test("local cutover markdown gives the exact safe tunnel command", () => {
  const plan = buildLocalCutoverPlan({
    envText: "DEPLOYMENT_MODE=local\nUSE_SQLITE=true\nMEDIA_ROOT=D:/pulse-data/media\nSQLITE_DB_PATH=D:/pulse-data/pulse.db",
    pulseCloudflaredConfigText: "",
    localHealth: { ok: false, error: "ECONNREFUSED" },
    publicHealth: { ok: false, status: 530 },
  });
  const md = formatLocalCutoverPlanMarkdown(plan);

  assert.match(md, /cloudflared tunnel --config D:\/pulse-data\/cloudflared-pulse\.yml run pulse-gaming-local/);
  assert.match(md, /Safety: read-only/);
});
