"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const dm = require("../../lib/deployment-mode");

// 2026-04-30: cost-saving migration. Pulse Gaming should be runnable
// off-Railway (home PC or Oracle Cloud Always-Free) with a one-flag
// switch back. These tests pin the env-flag → mode resolution so the
// switch behaves the same on every host.

// ── getMode ──────────────────────────────────────────────────────

test("getMode: explicit DEPLOYMENT_MODE=local wins", () => {
  assert.equal(dm.getMode({ DEPLOYMENT_MODE: "local" }), "local");
});

test("getMode: explicit DEPLOYMENT_MODE=railway wins even with no Railway envs", () => {
  assert.equal(dm.getMode({ DEPLOYMENT_MODE: "railway" }), "railway");
});

test("getMode: case-insensitive + trims whitespace", () => {
  assert.equal(dm.getMode({ DEPLOYMENT_MODE: "  LOCAL  " }), "local");
  assert.equal(dm.getMode({ DEPLOYMENT_MODE: "Railway" }), "railway");
});

test("getMode: invalid value falls through to heuristic", () => {
  assert.equal(dm.getMode({ DEPLOYMENT_MODE: "kubernetes" }), "local");
});

test("getMode: heuristic — RAILWAY_PUBLIC_URL present → railway", () => {
  assert.equal(
    dm.getMode({ RAILWAY_PUBLIC_URL: "https://x.up.railway.app" }),
    "railway",
  );
});

test("getMode: heuristic — RAILWAY_PROJECT_ID present → railway", () => {
  assert.equal(dm.getMode({ RAILWAY_PROJECT_ID: "abc" }), "railway");
});

test("getMode: empty env → local (sane default for dev)", () => {
  assert.equal(dm.getMode({}), "local");
});

// ── isLocal / isRailway helpers ──────────────────────────────────

test("isLocal / isRailway: mutually exclusive", () => {
  assert.equal(dm.isLocal({ DEPLOYMENT_MODE: "local" }), true);
  assert.equal(dm.isRailway({ DEPLOYMENT_MODE: "local" }), false);
  assert.equal(dm.isLocal({ DEPLOYMENT_MODE: "railway" }), false);
  assert.equal(dm.isRailway({ DEPLOYMENT_MODE: "railway" }), true);
});

// ── isPrimary ────────────────────────────────────────────────────

test("isPrimary: defaults to true (preserves existing Railway behaviour)", () => {
  assert.equal(dm.isPrimary({}), true);
});

test("isPrimary: PULSE_PRIMARY_INSTANCE=false makes it a mirror", () => {
  assert.equal(dm.isPrimary({ PULSE_PRIMARY_INSTANCE: "false" }), false);
});

test("isPrimary: 'no' / '0' also mean mirror", () => {
  assert.equal(dm.isPrimary({ PULSE_PRIMARY_INSTANCE: "no" }), false);
  assert.equal(dm.isPrimary({ PULSE_PRIMARY_INSTANCE: "0" }), false);
});

test("isPrimary: any other value → primary (fail-open so a typo doesn't accidentally mute the scheduler)", () => {
  assert.equal(dm.isPrimary({ PULSE_PRIMARY_INSTANCE: "true" }), true);
  assert.equal(dm.isPrimary({ PULSE_PRIMARY_INSTANCE: "1" }), true);
  assert.equal(dm.isPrimary({ PULSE_PRIMARY_INSTANCE: "yes" }), true);
});

// ── getPublicUrl ─────────────────────────────────────────────────

test("getPublicUrl: PULSE_PUBLIC_URL wins over Railway and local", () => {
  assert.equal(
    dm.getPublicUrl({
      PULSE_PUBLIC_URL: "https://override.example",
      RAILWAY_PUBLIC_URL: "https://x.up.railway.app",
      LOCAL_PUBLIC_URL: "https://local.example",
    }),
    "https://override.example",
  );
});

test("getPublicUrl: RAILWAY_PUBLIC_URL wins over LOCAL_PUBLIC_URL", () => {
  assert.equal(
    dm.getPublicUrl({
      RAILWAY_PUBLIC_URL: "https://x.up.railway.app",
      LOCAL_PUBLIC_URL: "https://local.example",
    }),
    "https://x.up.railway.app",
  );
});

test("getPublicUrl: LOCAL_PUBLIC_URL wins when only it is set", () => {
  assert.equal(
    dm.getPublicUrl({ LOCAL_PUBLIC_URL: "https://pulse.your-domain.com" }),
    "https://pulse.your-domain.com",
  );
});

test("getPublicUrl: trailing slashes stripped", () => {
  assert.equal(
    dm.getPublicUrl({ PULSE_PUBLIC_URL: "https://override.example///" }),
    "https://override.example",
  );
});

test("getPublicUrl: no env → localhost fallback with PORT", () => {
  assert.equal(dm.getPublicUrl({ PORT: "3001" }), "http://localhost:3001");
});

test("getPublicUrl: no env, no PORT → default port 3001", () => {
  assert.equal(dm.getPublicUrl({}), "http://localhost:3001");
});

// ── getMediaRoot / getSqliteDbPath ──────────────────────────────

test("getMediaRoot: explicit MEDIA_ROOT wins always", () => {
  assert.equal(
    dm.getMediaRoot({ MEDIA_ROOT: "/custom/path", DEPLOYMENT_MODE: "railway" }),
    "/custom/path",
  );
});

test("getMediaRoot: railway default → /data/media", () => {
  assert.equal(dm.getMediaRoot({ DEPLOYMENT_MODE: "railway" }), "/data/media");
});

test("getMediaRoot: local default → null (caller falls back to repo root)", () => {
  assert.equal(dm.getMediaRoot({ DEPLOYMENT_MODE: "local" }), null);
});

test("getSqliteDbPath: railway default → /data/pulse.db", () => {
  assert.equal(
    dm.getSqliteDbPath({ DEPLOYMENT_MODE: "railway" }),
    "/data/pulse.db",
  );
});

test("getSqliteDbPath: local default → null (caller falls back)", () => {
  assert.equal(dm.getSqliteDbPath({ DEPLOYMENT_MODE: "local" }), null);
});

// ── summary ──────────────────────────────────────────────────────

test("summary: composite shape", () => {
  const s = dm.summary({
    DEPLOYMENT_MODE: "local",
    PULSE_PUBLIC_URL: "https://pulse.example",
    PULSE_PRIMARY_INSTANCE: "true",
  });
  assert.equal(s.mode, "local");
  assert.equal(s.primary, true);
  assert.equal(s.public_url, "https://pulse.example");
  assert.equal(typeof s.media_root, "string");
  assert.equal(typeof s.sqlite_db_path, "string");
});

test("summary: never includes secret values", () => {
  const s = dm.summary({
    DEPLOYMENT_MODE: "railway",
    INSTAGRAM_ACCESS_TOKEN: "DO_NOT_LEAK",
    FACEBOOK_PAGE_TOKEN: "DO_NOT_LEAK",
    ANTHROPIC_API_KEY: "DO_NOT_LEAK",
  });
  const json = JSON.stringify(s);
  assert.ok(!json.includes("DO_NOT_LEAK"));
});

// ── prefix ───────────────────────────────────────────────────────

test("prefix: railway primary → empty string (preserves existing Discord output)", () => {
  assert.equal(
    dm.prefix({
      DEPLOYMENT_MODE: "railway",
      PULSE_PRIMARY_INSTANCE: "true",
    }),
    "",
  );
});

test("prefix: local primary → '[LOCAL] '", () => {
  assert.equal(
    dm.prefix({ DEPLOYMENT_MODE: "local", PULSE_PRIMARY_INSTANCE: "true" }),
    "[LOCAL] ",
  );
});

test("prefix: any non-primary → '[MIRROR] ' regardless of mode", () => {
  assert.equal(
    dm.prefix({
      DEPLOYMENT_MODE: "railway",
      PULSE_PRIMARY_INSTANCE: "false",
    }),
    "[MIRROR] ",
  );
  assert.equal(
    dm.prefix({ DEPLOYMENT_MODE: "local", PULSE_PRIMARY_INSTANCE: "false" }),
    "[MIRROR] ",
  );
});

// ── VALID_MODES exported and stable ──────────────────────────────

test("VALID_MODES: railway + local, exactly two", () => {
  assert.deepEqual(dm.VALID_MODES, ["railway", "local"]);
});
