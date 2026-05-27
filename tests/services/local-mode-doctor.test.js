const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildEffectiveEnv,
  formatMarkdown,
} = require("../../tools/local-mode-doctor");
const deploymentMode = require("../../lib/deployment-mode");

test("local mode doctor lets .env values drive primary/public-url truth", () => {
  const env = buildEffectiveEnv(
    {
      DEPLOYMENT_MODE: "local",
      PULSE_PRIMARY_INSTANCE: "false",
      LOCAL_PUBLIC_URL: "https://pulse.orryy.com",
      MEDIA_ROOT: "D:/pulse-data/media",
      SQLITE_DB_PATH: "D:/pulse-data/pulse.db",
    },
    {
      DEPLOYMENT_MODE: "railway",
      PULSE_PRIMARY_INSTANCE: "true",
      LOCAL_PUBLIC_URL: "http://localhost:3001",
      MEDIA_ROOT: "",
      SQLITE_DB_PATH: "",
    },
  );

  const summary = deploymentMode.summary(env);
  assert.equal(summary.mode, "local");
  assert.equal(summary.primary, false);
  assert.equal(summary.public_url, "https://pulse.orryy.com");
  assert.equal(deploymentMode.getMediaRoot(env), "D:/pulse-data/media");
  assert.equal(deploymentMode.getSqliteDbPath(env), "D:/pulse-data/pulse.db");
});

test("local mode doctor green copy does not imply mirror instances can post", () => {
  const md = formatMarkdown({
    verdict: { overall: "green", blockers: [], advisory: [] },
    deployment_mode: {
      mode: "local",
      primary: false,
      public_url: "https://pulse.orryy.com",
    },
    binaries: { node: "v24.0.0" },
    env_presence: {},
    fs_checks: {
      media_root: { writable: true, path: "D:/pulse-data/media" },
      db_dir: { writable: true, path: "D:/pulse-data" },
    },
  });

  assert.match(md, /primary: false/);
  assert.doesNotMatch(md, /Safe to start `node server\.js` here\./);
});
