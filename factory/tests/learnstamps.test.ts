import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { testDb, tmpDir, testConfig } from "./helpers.ts";
import {
  learnSettings,
  learnAny,
  learnSummary,
} from "../src/learn/settings.ts";
import {
  settingsSnapshot,
  snapshotHash,
  stableJson,
  safeName,
  safeValue,
  siteFromStack,
  roleOf,
  fileCall,
  newScope,
  inScope,
  flushPrompts,
  episodeStamp,
} from "../src/learn/stamps.ts";
import { recordUsage } from "../src/editorial/llm.ts";
import {
  changeEntries,
  diffSnapshots,
  ingestIntents,
  observeChanges,
  parseGitLog,
} from "../src/learn/ledger.ts";
import {
  applyBaseline,
  baselineDelta,
  holdoutDraw,
  holdoutFor,
  holdoutOf,
  inHoldout,
  maybeRepin,
  pinnable,
} from "../src/learn/holdout.ts";
import { withLearn } from "../src/learn/scope.ts";
import { pinnedGrowthDefaults } from "../src/growth.ts";

test("learn settings: everything off by default, parsed and clamped when set", () => {
  const off = learnSettings({});
  assert.equal(learnAny(off), false);
  assert.equal(learnSummary(off), "off");
  const on = learnSettings({
    LEARN_STAMPS: "true",
    LEARN_HOLDOUT_SHARE: "0.5",
    LEARN_BANDIT: "shadow",
    LEARN_HOOK_CANDIDATES: "9",
    LEARN_PLAYBOOK: "on",
  });
  assert.equal(on.stamps, true);
  assert.equal(on.holdoutShare, 0.2, "the holdout is capped at 20%");
  assert.equal(on.bandit, "shadow");
  assert.equal(on.playbook, "on");
  assert.equal(on.hookCandidates, 6);
  assert.deepEqual(on.holdoutLanes, ["news", "news_breaking"]);
  assert.match(learnSummary(on), /20% holdout/);
});

test("settings snapshot never holds a key, token, id, address or path", () => {
  const cfg = {
    anthropicModel: "claude-opus-5-5",
    elevenLabsApiKey: "sk_live_abcdefghijklmnop1234567890",
    discordWebhookUrl: "https://discord.com/api/webhooks/1/abc",
    youtubeChannelId: "UC1234567890abcdefghij",
    dataDir: "/Users/x/PulseFactory/factory/data",
    googleClientSecret: "GOCSPX-abc",
    shortSkeletons: true,
    clarityMin: 8,
    codexCalls: ["clarity", "editorial"],
    // a harmless-looking name with a secret-looking value
    note: "ghp_1234567890abcdefghijklmnopqrstuv",
    publicLink: "https://pulsegmg.com",
    ownerContact: "someone@example.com",
    nested: { shortLengths: { news: "30-35" }, apiToken: "x" },
    longList: "a".repeat(400),
  };
  const snap = settingsSnapshot(cfg);
  const text = JSON.stringify(snap);
  for (const bad of [
    "sk_live",
    "discord.com",
    "UC1234",
    "/Users/",
    "GOCSPX",
    "ghp_",
    "pulsegmg",
    "example.com",
  ])
    assert.ok(!text.includes(bad), `snapshot leaked ${bad}`);
  assert.equal(snap.anthropicModel, "claude-opus-5-5");
  assert.equal(snap.shortSkeletons, true);
  assert.deepEqual(snap.codexCalls, ["clarity", "editorial"]);
  assert.equal(snap["nested.shortLengths.news"], "30-35");
  assert.ok(!("nested.apiToken" in snap));
  assert.ok(
    typeof snap.longList === "object" &&
      snap.longList &&
      "$sha" in (snap.longList as object),
  );
  assert.equal(safeName("clarityMin"), true);
  assert.equal(safeName("refreshToken"), false);
  assert.equal(safeName("facebookPageIds"), false);
  assert.equal(safeValue("news=30-35,why=45-60"), true);
  assert.equal(safeValue("C:\\PulseFactory\\factory"), false);
});

test("the snapshot of the real test config has no secret-looking field and hashes stably", async () => {
  const cfg = testConfig(await tmpDir());
  const snap = settingsSnapshot(cfg);
  for (const k of Object.keys(snap))
    assert.equal(safeName(k.split(".").at(-1)!), true, k);
  assert.equal(snapshotHash(snap), snapshotHash(settingsSnapshot({ ...cfg })));
  assert.equal(
    stableJson({ b: 1, a: [2, { d: 1, c: 2 }] }),
    stableJson({ a: [2, { c: 2, d: 1 }], b: 1 }),
  );
});

test("call sites and roles", () => {
  const stack = [
    "Error",
    "    at recordUsage (file:///f/src/editorial/llm.ts:40:3)",
    "    at async Object.structured (file:///f/src/editorial/llm.ts:240:7)",
    "    at async judgeClarity (file:///f/src/editorial/clarity.ts:120:9)",
    "    at async stepScript (file:///f/src/pipeline.ts:7200:1)",
  ].join("\n");
  assert.equal(siteFromStack(stack), "clarity");
  assert.equal(roleOf("clarity.judge", ""), "judge");
  assert.equal(roleOf("editorial", "News Short notes"), "writer");
  assert.equal(roleOf("footagelook", "pick footage"), "judge");
  assert.equal(roleOf("misc", "something else"), "other");
});

test("calls inside a step are filed under its episode; calls outside are not", async () => {
  const db = await testDb();
  const sc = newScope("ep1", "selected");
  const line = (model: string, site?: string) => ({
    t: new Date().toISOString(),
    model,
    job: "News Short notes",
    in: 1,
    out: 1,
    cacheRead: 0,
    cacheWrite: 0,
    ...(site ? { site } : {}),
  });
  recordUsage(line("claude-opus-5-5", "editorial"), "SYSTEM A"); // outside any scope: ignored
  await inScope(sc, async () => {
    recordUsage(line("claude-opus-5-5", "editorial"), "SYSTEM A");
    await new Promise((r) => setTimeout(r, 1));
    recordUsage(line("claude-opus-5-5", "editorial"), "SYSTEM A");
    recordUsage(line("codex:text", "clarity.judge"), "JUDGE PROMPT");
  });
  assert.equal(sc.calls.size, 2);
  await flushPrompts(db, sc);
  await flushPrompts(db, sc); // a second flush of the same calls adds to the counts
  const rows = await db.query<{
    site: string;
    calls: number;
    role: string;
    model: string;
  }>(`SELECT site, calls, role, model FROM episode_prompts ORDER BY site`);
  assert.deepEqual(
    rows.map((r) => [r.site, r.calls, r.role, r.model]),
    [
      ["clarity.judge", 2, "judge", "codex:text"],
      ["editorial", 4, "writer", "claude-opus-5-5"],
    ],
  );
  const texts = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM prompt_texts`,
  );
  assert.equal(texts[0]!.n, 2);
  // fileCall directly: the same prompt from another model is a separate row
  fileCall(sc, line("claude-sonnet-5-5", "editorial"), "SYSTEM A");
  assert.equal(sc.calls.size, 3);
});

test("withLearn: off changes nothing; on stamps commit, settings and prompts", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  fs.mkdirSync(path.join(dir, "admin"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "admin", "release"),
    "abcdef1234567890abcdef1234567890abcdef12\n",
  );
  const off = {
    db,
    cfg: testConfig(dir),
    now: () => new Date("2026-11-15T10:00:00Z"),
  };
  let seen: unknown;
  await withLearn(
    off,
    { id: "e1", lane: "news", status: "selected" },
    async (run) => {
      seen = run;
    },
  );
  assert.equal(
    seen,
    off,
    "with the core off the step gets the same services object",
  );
  assert.equal((await db.query(`SELECT * FROM episode_stamps`)).length, 0);

  const on = {
    ...off,
    cfg: testConfig(dir, { learn: learnSettings({ LEARN_STAMPS: "true" }) }),
  };
  await withLearn(
    on,
    { id: "e2", lane: "news", status: "selected" },
    async () => {
      recordUsage(
        {
          t: "2026-11-15T10:00:00Z",
          model: "claude-opus-5-5",
          job: "x",
          in: 0,
          out: 0,
          cacheRead: 0,
          cacheWrite: 0,
          site: "editorial",
        },
        "WRITER",
      );
    },
  );
  await withLearn(
    on,
    { id: "e2", lane: "news", status: "scripted" },
    async () => undefined,
  );
  const stamp = await episodeStamp(db, "e2");
  assert.equal(stamp?.commit, "abcdef1234567890abcdef1234567890abcdef12");
  assert.equal(stamp?.profile, "live");
  assert.equal(stamp?.prompts.length, 1);
  const [row] = await db.query<{ steps: Record<string, unknown> }>(
    `SELECT steps FROM episode_stamps WHERE episode_id = 'e2'`,
  );
  assert.deepEqual(Object.keys(row!.steps).sort(), ["scripted", "selected"]);
  // a failing step still gets its stamp and the error still reaches the caller
  await assert.rejects(
    withLearn(on, { id: "e3", lane: "news", status: "selected" }, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(
    (await db.query(`SELECT * FROM episode_stamps WHERE episode_id = 'e3'`))
      .length,
    1,
  );
});

test("change ledger: a baseline first, then settings, overrides and commits as they change", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir, { shortSkeletons: false });
  const t0 = new Date("2026-11-14T10:00:00Z");
  const first = await observeChanges(db, cfg, t0, {
    commit: "aaaaaaa1",
    bootAt: t0,
  });
  assert.deepEqual(
    first.map((e) => e.kind),
    ["baseline"],
  );
  assert.deepEqual(
    await observeChanges(db, cfg, t0, { commit: "aaaaaaa1", bootAt: t0 }),
    [],
    "nothing changed",
  );
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('override:growth_hook_style', '1'), ('youtube_refresh_token', 'secret-value')`,
  );
  const t1 = new Date("2026-11-14T15:30:00Z");
  const next = await observeChanges(db, { ...cfg, shortSkeletons: true } as typeof cfg, t1, {
    commit: "bbbbbbb2",
    bootAt: t1,
    commits: () => [
      {
        hash: "bbbbbbb2",
        at: "2026-11-14T15:00:00Z",
        subject: "Second change",
      },
      { hash: "ccccccc1", at: "2026-11-14T14:00:00Z", subject: "First change" },
    ],
  });
  assert.deepEqual(
    next.map((e) => `${e.kind}:${e.key ?? e.summary}`),
    [
      "deploy:code",
      "commit:First change",
      "commit:Second change",
      "setting:shortSkeletons",
      "override:override:growth_hook_style",
    ],
  );
  const all = await db.query<{
    summary: string;
    before: string | null;
    after: string | null;
  }>(`SELECT summary, before, after FROM change_ledger`);
  assert.ok(
    !JSON.stringify(all).includes("secret-value"),
    "the settings table's tokens never reach the ledger",
  );
  assert.ok(
    all.some((r) => r.summary === "Setting shortSkeletons: false to true."),
  );
});

test("change entries and git log parsing are pure", () => {
  const snap = (x: number) => ({ config: { a: x, b: "same" }, overrides: {} });
  const e = changeEntries(
    { commit: "c1", hash: "h1", snapshot: snap(1), at: "" },
    { commit: "c1", hash: "h2", snapshot: snap(2), at: "" },
    { bootAt: new Date(0), at: new Date(1) },
  );
  assert.equal(e.length, 1);
  assert.equal(e[0]!.kind, "setting");
  assert.deepEqual(diffSnapshots({ a: [1, 2] }, { a: [1, 2] }), []);
  const commits = parseGitLog(
    "abc1234\t2026-11-14T10:00:00+00:00\tFix the thing\nnot a line\n",
  );
  assert.deepEqual(commits, [
    {
      hash: "abc1234",
      at: "2026-11-14T10:00:00+00:00",
      subject: "Fix the thing",
    },
  ]);
});

test("intents from the improvement engine are read once, partial lines wait", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  fs.mkdirSync(path.join(dir, "admin"), { recursive: true });
  const file = path.join(dir, "admin", "learn-changes.jsonl");
  fs.writeFileSync(
    file,
    `${JSON.stringify({ at: "2026-11-14T12:00:00Z", intent: "Shorter hooks", metric: "hold3", setting: "SHORT_LENGTHS" })}\nnot json\n{"intent":"half`,
  );
  assert.equal(await ingestIntents(db, dir, new Date()), 1);
  assert.equal(await ingestIntents(db, dir, new Date()), 0);
  fs.appendFileSync(file, ` written"}\n`);
  assert.equal(await ingestIntents(db, dir, new Date()), 1);
  const rows = await db.query<{ summary: string; kind: string }>(
    `SELECT summary, kind FROM change_ledger ORDER BY id`,
  );
  assert.deepEqual(
    rows.map((r) => r.summary),
    ["Shorter hooks", "half written"],
  );
});

test("holdout draw: about the share asked, stable per id, news lanes only", () => {
  const s = { holdoutShare: 0.1, holdoutLanes: ["news", "news_breaking"] };
  let n = 0;
  for (let i = 0; i < 5000; i++)
    if (inHoldout({ id: `ep${i}`, lane: "news" }, s)) n++;
  assert.ok(n > 400 && n < 600, `about 10%, got ${n}`);
  assert.equal(holdoutDraw("x"), holdoutDraw("x"));
  assert.equal(
    inHoldout({ id: "ep1", lane: "longform" }, { ...s, holdoutShare: 0.2 }),
    false,
  );
  assert.equal(
    inHoldout({ id: "ep1", lane: "news" }, { ...s, holdoutShare: 0 }),
    false,
  );
});

test("the baseline pins creative choices only: gates and plumbing always run live", async () => {
  for (const k of [
    "clarityGate",
    "clarityMin",
    "factCheckBlockers",
    "spoilerGuard",
    "releaseGateMin",
    "youtubePrivacy",
    "newsSlots",
    "codexCalls",
    "learn.bandit",
    "anthropicModel",
    "shortRefuseThin",
    "includeRumours",
  ])
    assert.equal(pinnable(k), false, k);
  for (const k of [
    "shortSkeletons",
    "dropAngle",
    "voiceTestShare",
    "shortArgumentShare",
    "shortLengths.news",
  ])
    assert.equal(pinnable(k), true, k);
  const live = testConfig(await tmpDir(), {
    shortSkeletons: true,
    dropAngle: true,
    clarityMin: 9,
  });
  const baseline = {
    config: {
      ...settingsSnapshot(live),
      shortSkeletons: false,
      clarityMin: 7,
      dropAngle: "wrong type",
    },
    overrides: {},
    growthDefaults: [{ key: "hook_style", variant: "B" as const }],
    pinnedAt: "2026-11-01T00:00:00Z",
  };
  assert.deepEqual(
    baselineDelta(live, baseline).map((d) => d.key),
    ["shortSkeletons"],
  );
  const h = applyBaseline(live, "hash1", baseline);
  assert.equal(h.shortSkeletons, false);
  assert.equal(h.clarityMin, 9, "a gate never takes the pinned value");
  assert.equal(h.dropAngle, true, "a value whose type changed stays live");
  assert.equal(live.shortSkeletons, true, "the live config is untouched");
  assert.equal(holdoutOf(h)?.profileHash, "hash1");
  assert.equal(holdoutOf(live), undefined);
  assert.deepEqual(
    pinnedGrowthDefaults(holdoutOf(h)!.growthDefaults).map((d) => [
      d.test.key,
      d.variant,
    ]),
    [["hook_style", "B"]],
  );
});

test("holdout side is sticky and the baseline re-pins on schedule", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), {
    learn: learnSettings({ LEARN_HOLDOUT_SHARE: "0.2", LEARN_STAMPS: "true" }),
  });
  const t0 = new Date("2026-11-01T00:00:00Z");
  assert.equal(await maybeRepin(db, cfg, t0, 30), true);
  assert.equal(
    await maybeRepin(db, cfg, new Date("2026-11-20T00:00:00Z"), 30),
    false,
  );
  assert.equal(
    await maybeRepin(db, cfg, new Date("2026-12-02T00:00:00Z"), 30),
    true,
  );
  let id = "";
  for (let i = 0; i < 200 && !id; i++)
    if (inHoldout({ id: `h${i}`, lane: "news" }, cfg.learn)) id = `h${i}`;
  const s = { db, cfg, now: () => t0 };
  let holdoutCfg: object | undefined;
  await withLearn(s, { id, lane: "news", status: "selected" }, async (run) => {
    holdoutCfg = run.cfg;
  });
  assert.ok(
    holdoutCfg && holdoutOf(holdoutCfg),
    "the step got the baseline config",
  );
  // the share drops to nothing: the episode stays on its side for its later steps
  const s2 = {
    ...s,
    cfg: { ...cfg, learn: { ...cfg.learn, holdoutShare: 0 } },
  };
  const d = await holdoutFor(db, s2.cfg, { id, lane: "news" }, t0);
  assert.equal(d.profile, "holdout");
  const pins = await db.query(`SELECT * FROM change_ledger WHERE kind = 'pin'`);
  assert.equal(pins.length, 2);
});

test("backfill files load once: stamps only where none exist, ledger marked as backfill", async () => {
  const { ingestBackfill } = await import("../src/learn/ledger.ts");
  const db = await testDb();
  const dir = await tmpDir();
  fs.mkdirSync(path.join(dir, "admin"), { recursive: true });
  await db.query(`INSERT INTO episode_stamps (episode_id, code_commit) VALUES ('live1', 'abc')`);
  fs.writeFileSync(
    path.join(dir, "admin", "learn-backfill-stamps.json"),
    JSON.stringify([
      { episode_id: "old1", code_commit: "c1", codex_sites: ["clarity"], arms: { voice_test: "personal" }, confidence: "reconstructed" },
      { episode_id: "live1", code_commit: "zzz", codex_sites: null, arms: {}, confidence: "partial" },
    ]),
  );
  fs.writeFileSync(path.join(dir, "admin", "learn-backfill-ledger.json"), JSON.stringify([{ at: "2026-11-05T23:22:13Z", kind: "deploy", commit: "c1", summary: "code ? to c1" }]));
  assert.deepEqual(await ingestBackfill(db, dir), { stamps: 1, ledger: 1 });
  assert.deepEqual(await ingestBackfill(db, dir), { stamps: 0, ledger: 0 });
  const [live] = await db.query<{ code_commit: string }>(`SELECT code_commit FROM episode_stamps WHERE episode_id = 'live1'`);
  assert.equal(live!.code_commit, "abc", "a live stamp is never overwritten");
  const [l] = await db.query<{ source: string }>(`SELECT source FROM change_ledger`);
  assert.equal(l!.source, "backfill");
});
