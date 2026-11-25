// The self-merge gate's rules (src/handsoff/mergegate.ts) and the Studio routines' work check
// (src/handsoff/studiogate.ts). Pure.
import test from "node:test";
import assert from "node:assert/strict";
import {
  backspaceFiles,
  branchAllowed,
  deployWindow,
  fixedSlots,
  localInstant,
  needsInstall,
  parseTap,
  reviewed,
  unexpectedFailures,
} from "../src/handsoff/mergegate.ts";
import {
  abtestWork,
  communityWork,
  premiereWork,
  relatedWork,
  throttle,
} from "../src/handsoff/studiogate.ts";

test("only claude/* helper branches, never stage or live", () => {
  assert.equal(branchAllowed("claude/engine-hooks"), true);
  assert.equal(branchAllowed("claude/gap/x"), true);
  for (const b of [
    "claude/stage",
    "claude/epic-pasteur-7s143q",
    "main",
    "codex/x",
    "claude/a..b",
    "claude/x;rm",
    "claude/",
  ])
    assert.equal(branchAllowed(b), false, b);
});

test("the review marker counts in a commit message or a REVIEW.md", () => {
  assert.equal(
    reviewed("Fix x\n\ncode-reviewer reviewed: two findings fixed"),
    true,
  );
  assert.equal(
    reviewed("Fix x", "# Review\nCode-reviewer reviewed on 25 Nov"),
    true,
  );
  assert.equal(reviewed("Fix x", "nothing"), false);
});

test("TAP: counts and failing names; known failures pass, others do not", () => {
  const tap = [
    "ok 1 - a",
    "not ok 2 - community posts",
    "not ok 3 - the lane # TODO",
    "# tests 3",
    "# pass 1",
    "# fail 2",
  ].join("\n");
  const t = parseTap(tap);
  assert.deepEqual([t.pass, t.fail, t.complete], [1, 2, true]);
  assert.deepEqual(t.failures, ["community posts", "the lane"]);
  assert.deepEqual(
    unexpectedFailures(t, "# known\ncommunity posts\nthe lane\n"),
    [],
  );
  assert.deepEqual(unexpectedFailures(t, "community posts"), ["the lane"]);
  assert.equal(parseTap("ok 1 - a\n").complete, false);
  assert.equal(
    unexpectedFailures({ pass: 0, fail: 3, failures: [], complete: true }, "")
      .length,
    1,
  );
});

test("backspace bytes and package changes are caught", () => {
  assert.deepEqual(
    backspaceFiles([
      { name: "a.ts", data: Buffer.from("ok") },
      { name: "b.ts", data: Buffer.from("x\x08y") },
    ]),
    ["b.ts"],
  );
  assert.equal(needsInstall(["factory/src/a.ts"]), false);
  assert.equal(needsInstall(["factory/package-lock.json"]), true);
});

test("local slot times follow British Summer Time", () => {
  assert.equal(
    localInstant("2026-11-25", "17:00", "Europe/London").toISOString(),
    "2026-11-25T17:00:00.000Z",
  );
  assert.equal(
    localInstant("2026-07-01", "17:00", "Europe/London").toISOString(),
    "2026-07-01T16:00:00.000Z",
  );
  assert.equal(fixedSlots(new Date("2026-11-25T10:00:00Z")).length, 18);
});

test("deploy only outside the 30 minutes (plus deploy time) before a slot and never while busy", () => {
  const slots = [new Date("2026-11-25T17:00:00Z")];
  const at = (
    iso: string,
    x: Partial<Parameters<typeof deployWindow>[0]> = {},
  ) =>
    deployWindow({
      now: new Date(iso),
      slots,
      rendering: false,
      uploadsActive: 0,
      holdRestart: false,
      ...x,
    });
  assert.equal(at("2026-11-25T16:20:00Z").ok, false);
  assert.equal(at("2026-11-25T17:03:00Z").ok, false); // the slot is going out right now
  assert.equal(at("2026-11-25T15:30:00Z").ok, true);
  assert.equal(at("2026-11-25T17:10:00Z").ok, true);
  assert.match(
    at("2026-11-25T15:30:00Z", { rendering: true }).why,
    /rendering/,
  );
  assert.match(at("2026-11-25T15:30:00Z", { uploadsActive: 1 }).why, /upload/);
  assert.match(
    at("2026-11-25T15:30:00Z", { holdRestart: true }).why,
    /hold-restart/,
  );
});

const NOW = new Date("2026-11-25T15:30:00Z");

test("related: work when there is a plan item, a heart, a pin or a newly live video", () => {
  assert.equal(
    relatedWork(
      { ok: false, error: "bot check" },
      { enabled: true, hearts: [], pins: [] },
      [],
      undefined,
      NOW,
    ).work,
    false,
  );
  assert.equal(
    relatedWork({ items: [{ short: "a" }] }, { hearts: [] }, [], undefined, NOW)
      .work,
    true,
  );
  assert.equal(
    relatedWork(
      undefined,
      { enabled: true, hearts: [{ key: "k" }], pins: [] },
      [],
      undefined,
      NOW,
    ).work,
    true,
  );
  assert.equal(
    relatedWork(
      undefined,
      { enabled: false, hearts: [{ key: "k" }] },
      [],
      undefined,
      NOW,
    ).work,
    false,
  );
  const live = [
    { id: "e", youtube_video_id: "v", live_at: "2026-11-25T12:00:00Z" },
  ];
  assert.equal(
    relatedWork(undefined, undefined, live, "2026-11-25T11:00:00Z", NOW).work,
    true,
  );
  assert.equal(
    relatedWork(undefined, undefined, live, "2026-11-25T13:00:00Z", NOW).work,
    false,
  );
  // scheduled for later: not yet live
  assert.equal(
    relatedWork(
      undefined,
      undefined,
      [{ id: "f", live_at: "2026-11-25T19:00:00Z" }],
      undefined,
      NOW,
    ).work,
    false,
  );
});

test("abtest, premieres and community", () => {
  assert.equal(
    abtestWork({ tests: [{ videoId: "a", ready: false }] }).work,
    false,
  );
  assert.equal(
    abtestWork({ tests: [{ videoId: "a", ready: true }] }).work,
    true,
  );
  assert.equal(premiereWork({ toSet: [], all: [] }).work, false);
  assert.equal(premiereWork({ toSet: [{ videoId: "d" }] }).work, true);
  const post = (x: Record<string, unknown>) => ({
    post: { detail: { day: "2026-11-25", image: "C:\\p.jpg" } },
    done: false,
    image_on_pc: true,
    ...x,
  });
  assert.equal(communityWork(post({}), NOW).work, true);
  assert.equal(communityWork(post({ done: true }), NOW).why, "already posted");
  assert.equal(
    communityWork(post({ image_on_pc: false }), NOW).why,
    "picture not on this PC yet",
  );
  assert.equal(communityWork({ post: null }, NOW).why, "no fresh post");
  assert.equal(
    communityWork({ post: { detail: { day: "2026-11-20" } }, done: false }, NOW)
      .why,
    "no fresh post",
  );
});

test("unchanged work wakes the routine once a day after three runs", () => {
  const v = { work: true, keys: ["abtest:a"], why: "1 ready" };
  let memo;
  const seen: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    const t = throttle(v, memo, new Date(NOW.getTime() + i * 9 * 3600_000));
    memo = t.memo;
    seen.push(t.verdict.work);
  }
  assert.deepEqual(seen.slice(0, 3), [true, true, true]);
  assert.equal(seen[3], false);
  assert.ok(seen.slice(3).includes(true)); // still once a day
  const changed = throttle(
    { ...v, keys: ["abtest:b"] },
    memo,
    new Date(NOW.getTime() + 60 * 3600_000),
  );
  assert.equal(changed.verdict.work, true);
  assert.equal(
    throttle({ work: false, keys: [], why: "none" }, memo, NOW).memo.sameRuns,
    0,
  );
});
