"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanCommit,
  cleanPublicLabel,
  resolveRuntimeBuildInfo,
} = require("../../lib/runtime-build-info");

test("cleanCommit accepts only commit-shaped values", () => {
  assert.equal(cleanCommit("abc1234"), "abc1234");
  assert.equal(cleanCommit("ABC1234567890"), "ABC1234567890");
  assert.equal(cleanCommit("not a commit"), null);
  assert.equal(cleanCommit("abc;rm -rf"), null);
});

test("cleanPublicLabel strips unsafe labels from health metadata", () => {
  assert.equal(cleanPublicLabel("codex/readiness-qa-failure-window"), "codex/readiness-qa-failure-window");
  assert.equal(cleanPublicLabel("production"), "production");
  assert.equal(cleanPublicLabel("branch with spaces"), null);
  assert.equal(cleanPublicLabel("bad<script>"), null);
});

test("resolveRuntimeBuildInfo prefers Railway env commit and avoids git fallback", () => {
  const info = resolveRuntimeBuildInfo({
    env: {
      RAILWAY_GIT_COMMIT_SHA: "abcdef1234567890",
      RAILWAY_GIT_BRANCH: "main",
      RAILWAY_GIT_COMMIT_MESSAGE: "Do not expose this text",
      NODE_ENV: "production",
    },
    execFileSyncImpl() {
      throw new Error("git should not be needed for Railway commit metadata");
    },
  });

  assert.equal(info.commit_sha, "abcdef1234567890");
  assert.equal(info.commit_short, "abcdef1");
  assert.equal(info.commit_source, "railway_env");
  assert.equal(info.branch, "main");
  assert.equal(info.branch_source, "railway_env");
  assert.equal(info.commit_message_present, true);
  assert.equal(info.commit_message, undefined);
});

test("resolveRuntimeBuildInfo falls back to local git for local primary health", () => {
  const calls = [];
  const info = resolveRuntimeBuildInfo({
    cwd: "C:/repo",
    env: {},
    execFileSyncImpl(cmd, args) {
      calls.push([cmd, args.join(" ")]);
      if (args.join(" ") === "rev-parse HEAD") return "1234567890abcdef\n";
      if (args.join(" ") === "rev-parse --abbrev-ref HEAD") return "codex/readiness-qa-failure-window\n";
      throw new Error("unexpected git call");
    },
  });

  assert.equal(info.commit_sha, "1234567890abcdef");
  assert.equal(info.commit_short, "1234567");
  assert.equal(info.commit_source, "local_git");
  assert.equal(info.branch, "codex/readiness-qa-failure-window");
  assert.equal(info.branch_source, "local_git");
  assert.deepEqual(
    calls.map((call) => call[1]),
    ["rev-parse HEAD", "rev-parse --abbrev-ref HEAD"],
  );
});

test("resolveRuntimeBuildInfo does not expose invalid git output", () => {
  const info = resolveRuntimeBuildInfo({
    env: {},
    execFileSyncImpl(cmd, args) {
      if (args.join(" ") === "rev-parse HEAD") return "not a commit\n";
      if (args.join(" ") === "rev-parse --abbrev-ref HEAD") return "bad branch name\n";
      return "";
    },
  });

  assert.equal(info.commit_sha, null);
  assert.equal(info.commit_source, "unknown");
  assert.equal(info.branch, null);
  assert.equal(info.branch_source, "unknown");
});
