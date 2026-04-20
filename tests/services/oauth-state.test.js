const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

// Tests for lib/oauth-state.js — the CSRF nonce store for
// /auth/tiktok and /auth/facebook flows. The store is a module-local
// Map, so every test resets it via the internal hook to stay
// independent of order.

const {
  createState,
  consumeState,
  DEFAULT_TTL_MS,
  _resetForTests,
  _sizeForTests,
} = require("../../lib/oauth-state");

beforeEach(() => {
  _resetForTests();
});

// ---------- createState ----------

test("createState: produces a URL-safe hex string", () => {
  const s = createState("tiktok");
  assert.match(s, /^[0-9a-f]+$/);
  // 32 bytes → 64 hex chars. Anything shorter means someone shrank
  // the RNG output and weakened the CSRF guarantee.
  assert.strictEqual(s.length, 64);
});

test("createState: every call mints a fresh, unique state", () => {
  const a = createState("tiktok");
  const b = createState("tiktok");
  const c = createState("facebook");
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.notStrictEqual(b, c);
});

test("createState: rejects empty / non-string provider tags", () => {
  assert.throws(() => createState(""), /provider/);
  assert.throws(() => createState(undefined), /provider/);
  assert.throws(() => createState(null), /provider/);
});

// ---------- consumeState happy path ----------

test("consumeState: a freshly-created state for the same provider is accepted", () => {
  const s = createState("tiktok");
  const res = consumeState(s, "tiktok");
  assert.deepStrictEqual(res, { ok: true });
});

test("consumeState: is single-use — a second consume always fails", () => {
  const s = createState("tiktok");
  assert.deepStrictEqual(consumeState(s, "tiktok"), { ok: true });
  assert.deepStrictEqual(consumeState(s, "tiktok"), {
    ok: false,
    reason: "unknown_or_expired_state",
  });
});

// ---------- consumeState failure modes ----------

test("consumeState: rejects a missing / empty / non-string state param", () => {
  assert.deepStrictEqual(consumeState(undefined, "tiktok"), {
    ok: false,
    reason: "missing_state",
  });
  assert.deepStrictEqual(consumeState("", "tiktok"), {
    ok: false,
    reason: "missing_state",
  });
  assert.deepStrictEqual(consumeState(null, "tiktok"), {
    ok: false,
    reason: "missing_state",
  });
  assert.deepStrictEqual(consumeState(12345, "tiktok"), {
    ok: false,
    reason: "missing_state",
  });
});

test("consumeState: rejects a state we never issued", () => {
  const res = consumeState("a".repeat(64), "tiktok");
  assert.deepStrictEqual(res, {
    ok: false,
    reason: "unknown_or_expired_state",
  });
});

test("consumeState: rejects when provider tag does not match the one bound at creation", () => {
  // Attacker forges a state they stole from a TikTok flow but replays
  // it against the Facebook callback. Must fail — and the state must
  // be burned so it also can't be replayed against the correct
  // provider afterwards.
  const s = createState("tiktok");
  const wrong = consumeState(s, "facebook");
  assert.deepStrictEqual(wrong, { ok: false, reason: "provider_mismatch" });
  // Now the correct-provider call must ALSO fail — the state is dead.
  const correctAfter = consumeState(s, "tiktok");
  assert.deepStrictEqual(correctAfter, {
    ok: false,
    reason: "unknown_or_expired_state",
  });
});

test("consumeState: expired states are rejected", () => {
  const t0 = 1_700_000_000_000;
  const s = createState("tiktok", { now: t0 });
  const tooLate = t0 + DEFAULT_TTL_MS + 1;
  const res = consumeState(s, "tiktok", { now: tooLate });
  assert.deepStrictEqual(res, {
    ok: false,
    reason: "unknown_or_expired_state",
  });
});

test("consumeState: states still valid at TTL boundary succeed (off-by-one guard)", () => {
  const t0 = 1_700_000_000_000;
  const s = createState("tiktok", { now: t0 });
  const atBoundary = t0 + DEFAULT_TTL_MS; // exactly TTL later
  const res = consumeState(s, "tiktok", { now: atBoundary });
  assert.deepStrictEqual(res, { ok: true });
});

test("consumeState: rejects missing / empty provider tag at the callback", () => {
  const s = createState("tiktok");
  const res = consumeState(s, "");
  assert.deepStrictEqual(res, { ok: false, reason: "missing_provider" });
});

// ---------- housekeeping / sweep ----------

test("createState: lazily sweeps expired entries so the store can't grow forever", () => {
  const t0 = 1_700_000_000_000;
  const stale = createState("tiktok", { now: t0 });
  assert.strictEqual(_sizeForTests(), 1);
  // Mint another well after TTL; the sweep inside createState should
  // drop the stale entry.
  createState("facebook", { now: t0 + DEFAULT_TTL_MS + 1 });
  assert.strictEqual(_sizeForTests(), 1);
  // And the stale one is now unconsumable.
  assert.deepStrictEqual(consumeState(stale, "tiktok"), {
    ok: false,
    reason: "unknown_or_expired_state",
  });
});

// ---------- leakage guards ----------

test("consumeState: failure reasons do not include the state value itself", () => {
  // The reason strings are fixed enum-style tags, not format strings
  // that embed the caller-supplied state. This is part of the "don't
  // help an attacker enumerate" posture.
  const res = consumeState("deadbeef".repeat(8), "tiktok");
  assert.ok(!res.ok);
  assert.strictEqual(res.reason.includes("deadbeef"), false);
});

test("createState: returns only the state string, not an object that leaks createdAt", () => {
  // If the helper ever starts returning metadata, callers would
  // accidentally log it. Pin that the public return is opaque string.
  const s = createState("tiktok");
  assert.strictEqual(typeof s, "string");
});

// ---------- integration with buildAuthorizeUrl ----------

test("buildAuthorizeUrl: includes state when given, omits it otherwise", () => {
  const { buildAuthorizeUrl } = require("../../upload_tiktok");
  const prev = process.env.TIKTOK_CLIENT_KEY;
  process.env.TIKTOK_CLIENT_KEY = "sbfakeClient";
  try {
    const withoutState = buildAuthorizeUrl();
    assert.strictEqual(withoutState.includes("state="), false);
    const withState = buildAuthorizeUrl({ state: "abcdef1234567890" });
    assert.match(withState, /[?&]state=abcdef1234567890(?:$|&)/);
  } finally {
    if (prev === undefined) delete process.env.TIKTOK_CLIENT_KEY;
    else process.env.TIKTOK_CLIENT_KEY = prev;
  }
});
