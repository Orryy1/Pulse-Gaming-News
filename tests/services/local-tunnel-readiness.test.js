const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLocalTunnelReadiness,
  classifyTunnelConnection,
  formatLocalTunnelReadinessMarkdown,
  parseCloudflaredVersion,
} = require("../../lib/ops/local-tunnel-readiness");
const {
  parseArgs: parseLocalTunnelReadinessArgs,
} = require("../../tools/local-tunnel-readiness");

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

test("parseCloudflaredVersion extracts installed version", () => {
  assert.deepEqual(parseCloudflaredVersion("cloudflared version 2025.8.1"), {
    raw: "cloudflared version 2025.8.1",
    version: "2025.8.1",
    present: true,
  });
});

test("classifyTunnelConnection detects inactive and active tunnel info", () => {
  assert.equal(
    classifyTunnelConnection("Your tunnel abc does not have any active connection."),
    "inactive",
  );
  assert.equal(classifyTunnelConnection("Active connections: 2xlon01"), "active");
  assert.equal(classifyTunnelConnection(""), "unknown");
});

test("local tunnel readiness pinpoints inactive Cloudflare tunnel", () => {
  const report = buildLocalTunnelReadiness({
    cloudflaredPath: "C:/Program Files/cloudflared.exe",
    cloudflaredVersionOutput: "cloudflared version 2025.8.1",
    configText: [
      "tunnel: 8c94c81a-8bdc-483d-a2a9-3326a79059c3",
      "credentials-file: C:\\Users\\MORR\\.cloudflared\\pulse.json",
      "",
      "ingress:",
      "  - hostname: pulse.orryy.com",
      "    service: http://localhost:3001",
      "  - service: http_status:404",
    ].join("\n"),
    credentialsExists: true,
    tunnelInfo: "Your tunnel does not have any active connection.",
    localHealth: { ok: true, status: 200, json: { deployment: { mode: "local" } } },
    publicHealth: { ok: false, status: 530 },
  });

  assert.equal(report.verdict, "red");
  assert.equal(report.config.credentials_exists, true);
  assert.equal(report.tunnel.status, "inactive");
  assert.ok(
    report.blockers.includes("pulse-gaming-local tunnel has no active Cloudflare connection"),
  );
  assert.ok(
    report.blockers.includes("public /api/health is not reachable through pulse.orryy.com"),
  );
});

test("local tunnel readiness goes green when route, connection and health are ready", () => {
  const report = buildLocalTunnelReadiness({
    cloudflaredPath: "cloudflared",
    cloudflaredVersionOutput: "cloudflared version 2025.8.1",
    configText: [
      "tunnel: 8c94c81a-8bdc-483d-a2a9-3326a79059c3",
      "credentials-file: C:\\Users\\MORR\\.cloudflared\\pulse.json",
      "",
      "ingress:",
      "  - hostname: pulse.orryy.com",
      "    service: http://localhost:3001",
      "  - service: http_status:404",
    ].join("\n"),
    credentialsExists: true,
    tunnelInfo: "Active connections: 1xlon01",
    localHealth: { ok: true, status: 200 },
    publicHealth: { ok: true, status: 200 },
  });

  assert.equal(report.verdict, "green");
  assert.deepEqual(report.blockers, []);
});

test("local tunnel readiness markdown is operator-readable and non-mutating", () => {
  const markdown = formatLocalTunnelReadinessMarkdown(
    buildLocalTunnelReadiness({
      configText: "",
      localHealth: { ok: false, error: "ECONNREFUSED" },
      publicHealth: { ok: false, status: 530 },
    }),
  );

  assert.match(markdown, /Safety: read-only/);
  assert.match(markdown, /Controlled Start Command/);
  assert.match(markdown, /Do not flip local primary, queue or AUTO_PUBLISH/);
});

test("ops:local-tunnel-readiness does not write tracked root reports by default", () => {
  const args = parseLocalTunnelReadinessArgs(["node", "tool", "--json"]);
  assert.equal(args.writeRootReport, false);

  const source = fs.readFileSync(
    path.join(ROOT, "tools", "local-tunnel-readiness.js"),
    "utf8",
  );
  assert.match(source, /--write-root-report/);
  assert.doesNotMatch(
    source,
    /await fs\.writeFile\(path\.join\(ROOT, "LOCAL_TUNNEL_READINESS\.md"\), markdown\);/,
  );
});
