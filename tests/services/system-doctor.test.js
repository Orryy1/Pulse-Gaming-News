const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSystemDoctorReport,
  inspectGithubCredentialFallback,
  renderSystemDoctorMarkdown,
} = require("../../lib/ops/system-doctor");

function commandRunnerWithGithub({ ghAuthOk = false, credentialPassword = "" } = {}) {
  return (cmd, args = [], options = {}) => {
    if ((cmd === "where" || cmd === "which") && args.length) {
      return { ok: true, stdout: args[0] };
    }
    if (cmd === "gh" && args.join(" ") === "auth status") {
      return ghAuthOk ? { ok: true, stdout: "Logged in" } : { ok: false, error: "not logged in" };
    }
    if (cmd === "git" && args.join(" ") === "credential fill") {
      assert.equal(options.input, "protocol=https\nhost=github.com\n\n");
      return credentialPassword
        ? { ok: true, stdout: `protocol=https\nhost=github.com\nusername=x-access-token\npassword=${credentialPassword}` }
        : { ok: false, error: "credentials not found" };
    }
    if (cmd === "git" && args.join(" ") === "branch --show-current") {
      return { ok: true, stdout: "main" };
    }
    if (cmd === "git" && args.join(" ") === "rev-parse HEAD") {
      return { ok: true, stdout: "abc123" };
    }
    if (cmd === "git" && args.join(" ") === "rev-parse origin/main") {
      return { ok: true, stdout: "abc123" };
    }
    if (cmd === "git" && args.join(" ") === "status --short --branch") {
      return { ok: true, stdout: "## main...origin/main" };
    }
    return { ok: true, stdout: "" };
  };
}

test("system doctor passes when gh persistent auth is missing but git credential fallback exists", async () => {
  const report = await buildSystemDoctorReport({
    includeHealth: false,
    commandRunner: commandRunnerWithGithub({ credentialPassword: "gho_fake_for_test" }),
    packageReader: () => ({ scripts: { "ops:railway:health": "node tools/railway-health-check.js" } }),
  });

  assert.equal(report.verdict, "pass");
  assert.equal(report.githubAuth.authenticated, false);
  assert.equal(report.githubAuth.credentialFallbackAvailable, true);
  assert.ok(report.green.includes("github_credential_fallback_available"));
  assert.ok(report.advisories.includes("github_cli_auth_not_persistent_using_git_credential_fallback"));
  assert.ok(!report.findings.includes("github_cli_not_authenticated"));
});

test("system doctor still reviews when neither gh auth nor credential fallback exists", async () => {
  const report = await buildSystemDoctorReport({
    includeHealth: false,
    commandRunner: commandRunnerWithGithub({ credentialPassword: "" }),
    packageReader: () => ({ scripts: { "ops:railway:health": "node tools/railway-health-check.js" } }),
  });

  assert.equal(report.verdict, "review");
  assert.equal(report.githubAuth.credentialFallbackAvailable, false);
  assert.ok(report.findings.includes("github_cli_not_authenticated"));
});

test("github credential fallback detector never returns the credential value", () => {
  const result = inspectGithubCredentialFallback(
    commandRunnerWithGithub({ credentialPassword: "ghp_secret_value" }),
  );

  assert.deepEqual(result, {
    available: true,
    provider: "git_credential",
    usernamePresent: true,
  });
});

test("system doctor markdown names the git credential fallback without secrets", () => {
  const md = renderSystemDoctorMarkdown({
    generatedAt: "2026-04-29T00:00:00.000Z",
    verdict: "pass",
    productionHealth: {},
    git: { branch: "main", head: "abc", originMain: "abc", ahead: 0 },
    commands: { gh: "gh", git: "git" },
    githubAuth: { authenticated: false, credentialFallbackAvailable: true },
    advisories: ["github_cli_auth_not_persistent_using_git_credential_fallback"],
    findings: [],
    blockers: [],
  });

  assert.match(md, /gh auth: not persistent; git credential fallback available/);
  assert.match(md, /github_cli_auth_not_persistent_using_git_credential_fallback/);
  assert.doesNotMatch(md, /secret/i);
});
