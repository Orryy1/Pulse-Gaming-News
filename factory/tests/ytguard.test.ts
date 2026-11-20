import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterCall,
  cacheKey,
  callClass,
  cooldownMs,
  createYtGuard,
  decide,
  emptyState,
  guardActive,
  guardSettings,
  isBotCheck,
  isYouTubeCall,
  isYtPaused,
  outputFile,
  stdoutOnly,
  stdoutTtlMs,
  type GuardSettings,
} from "../src/lib/ytguard.ts";

const HOUR = 3_600_000;
const BOT =
  "ERROR: [youtube] YiiTOJZDWyA: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.";
const s: GuardSettings = guardSettings({});

test("settings: protective defaults, overridable, bad values ignored", () => {
  assert.equal(s.hourlyBudget, 60);
  assert.equal(s.cooldownHours, 6);
  const o = guardSettings({
    YT_HOURLY_BUDGET: "20",
    YT_BLOCK_COOLDOWN_HOURS: "3",
  });
  assert.equal(o.hourlyBudget, 20);
  assert.equal(o.cooldownHours, 3);
  assert.equal(guardSettings({ YT_HOURLY_BUDGET: "lots" }).hourlyBudget, 60);
});

test("only yt-dlp calls to YouTube are guarded", () => {
  assert.ok(
    isYouTubeCall("/opt/homebrew/bin/yt-dlp", [
      "--dump-single-json",
      "https://www.youtube.com/watch?v=abc",
    ]),
  );
  assert.ok(
    isYouTubeCall("yt-dlp", ["--flat-playlist", "ytsearch15:GTA VI cutscenes"]),
  );
  assert.ok(isYouTubeCall("C:/tools/yt-dlp.exe", ["https://youtu.be/abc"]));
  assert.ok(!isYouTubeCall("yt-dlp", ["-q", "https://clips.twitch.tv/abc"]));
  assert.ok(!isYouTubeCall("yt-dlp", ["-U"]));
  assert.ok(
    !isYouTubeCall("ffmpeg", ["-i", "https://www.youtube.com/watch?v=abc"]),
  );
});

test("the bot wall and the rate limit are recognised, a 403 is not", () => {
  assert.ok(isBotCheck(BOT));
  assert.ok(isBotCheck("Sign in to confirm you're not a bot"));
  assert.ok(
    isBotCheck(
      "ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests",
    ),
  );
  assert.ok(!isBotCheck("HTTP Error 403: Forbidden"));
  assert.ok(!isBotCheck("Sign in to confirm your age"));
});

test("children started as background work take the background share", () => {
  assert.equal(callClass({ YT_CLASS: "background" }), "background");
  assert.equal(callClass({}), "urgent");
});

test("the guard is off in the test runner and with YT_GUARD=false", () => {
  assert.equal(guardActive({ NODE_TEST_CONTEXT: "child-v8" }), false);
  assert.equal(guardActive({ YT_GUARD: "false" }), false);
  assert.equal(guardActive({}), true);
});

test("calls are spaced with jitter and counted against the hourly budget", () => {
  const st = emptyState();
  const a = decide(st, 1000, "urgent", s, 0);
  assert.deepEqual(a, { go: true, at: 1000, probe: false });
  const b = decide(st, 1000, "urgent", s, 0.5);
  assert.ok(b.go && b.at === 1000 + s.urgentGapMs);
  const c = decide(st, 1000, "urgent", s, 0);
  assert.ok(c.go && c.at === 1000 + s.urgentGapMs * 2 + s.urgentJitterMs * 0.5);
  assert.equal(st.calls.length, 3);
});

test("the budget refuses once the hour is used, and frees up as the hour rolls on", () => {
  const small = { ...s, hourlyBudget: 4, urgentGapMs: 0, urgentJitterMs: 0 };
  const st = emptyState();
  for (let i = 0; i < 4; i++) assert.ok(decide(st, 0, "urgent", small, 0).go);
  const no = decide(st, 10, "urgent", small, 0);
  assert.equal(no.go, false);
  assert.equal(!no.go && no.reason, "budget");
  assert.ok(decide(st, HOUR + 1, "urgent", small, 0).go);
});

test("background work gets at most a quarter of the budget", () => {
  const st = emptyState();
  const t = {
    ...s,
    hourlyBudget: 8,
    backgroundGapMs: 0,
    backgroundJitterMs: 0,
    urgentGapMs: 0,
    urgentJitterMs: 0,
  };
  assert.ok(decide(st, 0, "background", t, 0).go);
  assert.ok(decide(st, 0, "background", t, 0).go);
  const no = decide(st, 0, "background", t, 0);
  assert.equal(!no.go && no.reason, "budget");
  assert.ok(decide(st, 0, "urgent", t, 0).go, "a video's own fetch still goes");
});

test("a video's call that would wait too long is refused so the fallbacks take over", () => {
  const st = emptyState();
  st.nextAt = 10 * 60_000;
  const d = decide(st, 0, "urgent", s, 0);
  assert.equal(!d.go && d.reason, "busy");
});

test("a bot answer pauses everything, with one start line, and backs off on each strike", () => {
  const st = emptyState();
  assert.equal(afterCall(st, 0, "bot", false, s), "started");
  assert.equal(st.block?.until, 6 * HOUR);
  assert.equal(st.alerts.length, 1);
  assert.match(st.alerts[0]!, /prove it is not a bot/);
  assert.doesNotMatch(st.alerts[0]!, /—/);
  // Other calls under way report the wall too: no new strike, no new line.
  assert.equal(afterCall(st, 5, "bot", false, s), undefined);
  assert.equal(st.alerts.length, 1);
  for (const cls of ["urgent", "background"] as const) {
    const d = decide(st, HOUR, cls, s, 0);
    assert.equal(!d.go && d.reason, "blocked");
  }
  // The pause ends: one call probes, the rest wait for it.
  const probe = decide(st, 6 * HOUR + 1, "urgent", s, 0);
  assert.ok(probe.go && probe.probe);
  const other = decide(st, 6 * HOUR + 2, "urgent", s, 0);
  assert.equal(!other.go && other.reason, "probing");
  // The probe meets the wall again: twelve hours this time, still one line.
  assert.equal(afterCall(st, 6 * HOUR + 3, "bot", true, s), "extended");
  assert.equal(st.block?.strikes, 2);
  assert.equal(st.block?.until, 6 * HOUR + 3 + 12 * HOUR);
  assert.equal(st.alerts.length, 1);
});

test("a probe that works lifts the block with one lift line", () => {
  const st = emptyState();
  afterCall(st, 0, "bot", false, s);
  st.alerts.splice(0);
  const p = decide(st, 7 * HOUR, "background", s, 0);
  assert.ok(p.go && p.probe);
  assert.equal(afterCall(st, 7 * HOUR, "ok", true, s), "lifted");
  assert.equal(st.block, undefined);
  assert.deepEqual(st.alerts.length, 1);
  assert.match(st.alerts[0]!, /answering the factory normally again/);
  assert.ok(decide(st, 7 * HOUR + 1, "urgent", s, 0).go);
});

test("a probe failing for another reason lets the next call try", () => {
  const st = emptyState();
  afterCall(st, 0, "bot", false, s);
  assert.ok(decide(st, 7 * HOUR, "urgent", s, 0).go);
  assert.equal(afterCall(st, 7 * HOUR, "other", true, s), undefined);
  assert.ok(st.block);
  const next = decide(st, 7 * HOUR + 1, "urgent", s, 0.1);
  assert.ok(next.go && next.probe);
});

test("a new block within a day of the last one starts on a longer pause", () => {
  const st = emptyState();
  afterCall(st, 0, "bot", false, s);
  decide(st, 7 * HOUR, "urgent", s, 0);
  afterCall(st, 7 * HOUR, "ok", true, s);
  assert.equal(afterCall(st, 9 * HOUR, "bot", false, s), "started");
  assert.equal(st.block?.strikes, 2);
  assert.equal(st.block!.until - 9 * HOUR, 12 * HOUR);
  assert.equal(cooldownMs(10, s), 48 * HOUR);
});

test("YT_BLOCK_COOLDOWN_HOURS=0 turns the pause off", () => {
  const st = emptyState();
  assert.equal(
    afterCall(st, 0, "bot", false, { ...s, cooldownHours: 0 }),
    undefined,
  );
  assert.equal(st.block, undefined);
});

test("what is kept: listings and details on stdout, single media files", () => {
  assert.equal(
    outputFile(["-f", "b", "-o", "/ep/section_1.mp4", "https://youtu.be/x"]),
    "/ep/section_1.mp4",
  );
  assert.equal(
    outputFile([
      "--write-subs",
      "--skip-download",
      "-o",
      "/ep/cap",
      "https://youtu.be/x",
    ]),
    undefined,
  );
  assert.equal(
    outputFile(["-o", "%(id)s.%(ext)s", "https://youtu.be/x"]),
    undefined,
  );
  assert.ok(
    stdoutOnly(["--flat-playlist", "--print", "%(id)s", "ytsearch5:x"]),
  );
  assert.ok(
    stdoutOnly(["--skip-download", "--dump-single-json", "https://youtu.be/x"]),
  );
  assert.ok(
    !stdoutOnly([
      "--write-subs",
      "--skip-download",
      "-o",
      "/ep/cap",
      "https://youtu.be/x",
    ]),
  );
  assert.equal(
    stdoutTtlMs(["--dump-single-json", "https://youtu.be/x"]),
    3 * HOUR,
  );
  assert.equal(stdoutTtlMs(["--flat-playlist", "ytsearch5:x"]), 12 * HOUR);
  assert.equal(
    cacheKey(["-f", "b", "-o", "/ep1/a.mp4", "u"]),
    cacheKey(["-f", "b", "-o", "/ep2/b.mp4", "u"]),
    "the same section for another video is the same file",
  );
  assert.notEqual(
    cacheKey(["--download-sections", "*1-2", "u"]),
    cacheKey(["--download-sections", "*3-4", "u"]),
  );
});

function rig(budget = 60) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytguard-"));
  let now = 1_000_000;
  const slept: number[] = [];
  const g = createYtGuard({
    dir,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
    rand: () => 0,
    settings: () => ({ ...guardSettings({}), hourlyBudget: budget }),
    cls: () => "urgent",
  });
  return { g, dir, slept, advance: (ms: number) => (now += ms) };
}

const Y = "yt-dlp";
const URL = "https://www.youtube.com/watch?v=abc";

test("guard: a kept listing answers the second call without asking YouTube", async () => {
  const { g } = rig();
  let calls = 0;
  const fn = async () => {
    calls++;
    return { stdout: "row\n", stderr: "" };
  };
  const args = ["--skip-download", "--dump-single-json", URL];
  assert.equal((await g.run(Y, args, fn)).stdout, "row\n");
  assert.equal((await g.run(Y, args, fn)).stdout, "row\n");
  assert.equal(calls, 1);
});

test("guard: a downloaded section is copied from the shelf for the next video", async () => {
  const { g, dir } = rig();
  let calls = 0;
  const first = path.join(dir, "ep1", "s.mp4");
  const second = path.join(dir, "ep2", "s.mp4");
  const fn = (out: string) => async () => {
    calls++;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, "video");
    return { stdout: "", stderr: "" };
  };
  await g.run(Y, ["--download-sections", "*1-31", "-o", first, URL], fn(first));
  await g.run(
    Y,
    ["--download-sections", "*1-31", "-o", second, URL],
    fn(second),
  );
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(second, "utf8"), "video");
});

test("guard: a bot answer blocks the next call at once and queues one start line", async () => {
  const { g, advance } = rig();
  const wall = async () => {
    throw Object.assign(new Error("Command failed: yt-dlp"), { stderr: BOT });
  };
  await assert.rejects(
    g.run(Y, ["-f", "b", "-o", "/nowhere/x.mp4", URL], wall),
    /Command failed/,
  );
  let ran = false;
  await assert.rejects(
    g.run(
      Y,
      ["--dump-single-json", "https://www.youtube.com/watch?v=other"],
      async () => {
        ran = true;
        return { stdout: "{}", stderr: "" };
      },
    ),
    (err: unknown) => isYtPaused(err) && /paused/.test((err as Error).message),
  );
  assert.equal(ran, false, "nothing reached YouTube during the pause");
  const sent: string[] = [];
  assert.equal(await g.flushAlerts((t) => sent.push(t)), 1);
  assert.equal(await g.flushAlerts((t) => sent.push(t)), 0, "never repeated");
  // After the pause a call that works lifts it, with one lift line.
  advance(6 * HOUR + 1000);
  await g.run(
    Y,
    ["--dump-single-json", "https://www.youtube.com/watch?v=third"],
    async () => ({ stdout: "{}", stderr: "" }),
  );
  await g.flushAlerts((t) => sent.push(t));
  assert.equal(sent.length, 2);
  assert.match(sent[1]!, /normally again/);
  assert.equal((await g.state()).block, undefined);
});

test("guard: non-YouTube calls pass straight through", async () => {
  const { g, slept } = rig(1);
  for (let i = 0; i < 3; i++)
    await g.run("ffmpeg", ["-i", "a.mp4"], async () => ({
      stdout: "",
      stderr: "",
    }));
  assert.equal(slept.length, 0);
});

test("guard: the error the callers see never looks like a retryable refusal", async () => {
  const { g } = rig(1);
  await g.run(Y, ["--dump-single-json", URL], async () => ({
    stdout: "{}",
    stderr: "",
  }));
  const err = await g
    .run(Y, ["--dump-single-json", "https://youtu.be/zzz"], async () => ({
      stdout: "{}",
      stderr: "",
    }))
    .catch((e: unknown) => e as Error);
  assert.ok(isYtPaused(err));
  // officialTrailer retries on these words and ytsection on 403/forbidden: a paused call must not trigger either.
  assert.doesNotMatch(
    (err as Error).message,
    /403|forbidden|signature|n function|unable to extract|precondition/i,
  );
});
