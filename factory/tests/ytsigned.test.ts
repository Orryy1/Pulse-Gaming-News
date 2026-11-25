// SIGNED_CLIPS (19 Nov 2026): age-gated clip pulls retried through the signed-in lane within YT_SIGNED_CLIP_SHARE,
// and the hard rule that the download account never touches Pulse's own channel or videos.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createYtGuard,
  currentYtPurpose,
  decide,
  emptyState,
  guardSettings,
  YtPausedError,
  type GuardSettings,
} from "../src/lib/ytguard.ts";
import {
  envCookiesFile,
  envSwitch,
  signedInArgs,
  signedPull,
  signedRetryWorth,
} from "../src/lib/ytsignin.ts";
import {
  ownChannelFrom,
  PULSE_CHANNEL_ID,
  refreshOwnVideos,
  touchesOwnChannel,
} from "../src/lib/ytown.ts";
import { testDb } from "./helpers.ts";

const HOUR = 3_600_000;
const s: GuardSettings = guardSettings({});
const AGE =
  "ERROR: [youtube] byDw86z-oZo: Sign in to confirm your age. This video may be inappropriate for some users.";
const URL = "https://www.youtube.com/watch?v=byDw86z-oZo";
const COOKIES = ["--cookies", "/data/yt_cookies.txt"];
const ageError = () =>
  Object.assign(new Error("Command failed: yt-dlp"), { stderr: AGE });

test("clip share: YT_SIGNED_CLIP_SHARE defaults to half the signed-in budget and can be changed", () => {
  assert.equal(s.signedClipShare, 0.5);
  assert.equal(
    guardSettings({ YT_SIGNED_CLIP_SHARE: "0.25" }).signedClipShare,
    0.25,
  );
  assert.equal(guardSettings({ YT_SIGNED_CLIP_SHARE: "3" }).signedClipShare, 1);
  assert.equal(
    guardSettings({ YT_SIGNED_CLIP_SHARE: "x" }).signedClipShare,
    0.5,
  );
});

test("clip share: clips stop at their share and the game fetcher still has the rest of the signed-in budget", () => {
  const st = emptyState();
  const settings = { ...s, urgentGapMs: 0, urgentJitterMs: 0 };
  let clips = 0;
  for (let i = 0; i < 30; i++)
    if (decide(st, 1000 + i, "urgent", settings, 0, "signed", "clip").go)
      clips++;
  assert.equal(clips, 10, "half of 20");
  const refused = decide(st, 2000, "urgent", settings, 0, "signed", "trend");
  assert.equal(refused.go, false);
  assert.equal(!refused.go && refused.reason, "share");
  let fetcher = 0;
  for (let i = 0; i < 30; i++)
    if (decide(st, 3000 + i, "urgent", settings, 0, "signed").go) fetcher++;
  assert.equal(fetcher, 10, "the fetcher keeps the other half");
  assert.equal(
    decide(st, 1000 + HOUR + 50, "urgent", settings, 0, "signed", "clip").go,
    true,
    "an hour later the share is back",
  );
  assert.equal(
    st.auxCalls,
    undefined,
    "the anonymous lane keeps no clip count",
  );
});

test("clip share: a share of 0 lets no clip sign in; the anonymous lane ignores purposes", () => {
  const st = emptyState();
  const none = { ...s, signedClipShare: 0 };
  assert.equal(decide(st, 0, "urgent", none, 0, "signed", "clip").go, false);
  assert.equal(decide(st, 0, "urgent", none, 0, "signed").go, true);
  assert.equal(decide(st, 0, "urgent", none, 0, "anon", "clip").go, true);
  assert.match(
    new YtPausedError("share", undefined, "signed").message,
    /YT_SIGNED_CLIP_SHARE/,
  );
});

test("own channel: Pulse's channel id, handle and uploads are recognised; other videos are not", () => {
  const own = ownChannelFrom({}, ["pulseVideo1"]);
  assert.deepEqual(own.channelIds, [PULSE_CHANNEL_ID]);
  assert.deepEqual(own.handles, ["pulsegmg"]);
  assert.ok(
    touchesOwnChannel(
      [`https://www.youtube.com/channel/${PULSE_CHANNEL_ID}/videos`],
      own,
    ),
  );
  assert.ok(
    touchesOwnChannel(["https://www.youtube.com/@PulseGMG/shorts"], own),
  );
  assert.ok(
    touchesOwnChannel(["https://www.youtube.com/watch?v=pulseVideo1"], own),
  );
  assert.ok(touchesOwnChannel(["https://youtube.com/shorts/pulseVideo1"], own));
  assert.ok(touchesOwnChannel(["pulseVideo1"], own));
  assert.ok(!touchesOwnChannel([URL, "--skip-download"], own));
  assert.ok(
    !touchesOwnChannel(["https://www.youtube.com/@PulseGMGfan"], own),
    "another handle that starts the same",
  );
  assert.ok(!touchesOwnChannel(["ytsearch10:pulse gaming gta 6"], own));
  const twin = ownChannelFrom({
    YOUTUBE_CHANNEL_ID: "UCaaaaaaaaaaaaaaaaaaaaaa",
    TWIN_YOUTUBE_CHANNEL_ID: "UCbbbbbbbbbbbbbbbbbbbbbb",
    YT_OWN_HANDLES: "@One, two",
  });
  assert.deepEqual(twin.channelIds, [
    "UCaaaaaaaaaaaaaaaaaaaaaa",
    "UCbbbbbbbbbbbbbbbbbbbbbb",
  ]);
  assert.deepEqual(twin.handles, ["one", "two"]);
});

test("own channel: signedInArgs gives no cookies for a call about Pulse's own video", async () => {
  const guard = {
    cookiesUsable: () => true,
    cookiesMissing: async () => undefined,
  };
  const stat = () => ({ mtimeMs: 1 });
  const own = () => ownChannelFrom({}, ["pulseVideo1"]);
  const cfg = { ytdlpCookiesFile: "/data/yt_cookies.txt" };
  assert.deepEqual(await signedInArgs(cfg, guard, stat, [URL], own), COOKIES);
  assert.deepEqual(
    await signedInArgs(
      cfg,
      guard,
      stat,
      ["https://www.youtube.com/watch?v=pulseVideo1"],
      own,
    ),
    [],
  );
  assert.deepEqual(
    await signedInArgs(
      cfg,
      guard,
      stat,
      ["https://www.youtube.com/@PulseGMG"],
      own,
    ),
    [],
  );
});

test("own channel: the guard refuses a signed-in call naming Pulse's video, and lets the anonymous one through", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-ytown-"));
  const g = createYtGuard({
    dir,
    now: () => 0,
    sleep: async () => undefined,
    rand: () => 0,
    settings: () => guardSettings({}),
    cls: () => "urgent",
    own: () => ownChannelFrom({}, ["pulseVideo1"]),
  });
  const ownUrl = "https://www.youtube.com/watch?v=pulseVideo1";
  let ran = 0;
  const fn = async () => (ran++, { stdout: "{}", stderr: "" });
  await assert.rejects(
    g.run("yt-dlp", [...COOKIES, "--skip-download", ownUrl], fn, {
      cache: false,
    }),
    (e: Error) => e.name === "YtOwnChannelError",
  );
  assert.equal(ran, 0, "nothing was sent");
  await g.run("yt-dlp", ["--skip-download", ownUrl], fn, { cache: false });
  assert.equal(ran, 1);
  assert.equal(
    (await g.state()).signed,
    undefined,
    "no signed-in call was counted",
  );
});

test("own channel: the factory keeps Pulse's uploaded ids for every process", async () => {
  const db = await testDb();
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, youtube_video_id) VALUES ('e1','h1','published','{}','pulseVideo1'), ('e2','h2','selected','{}',NULL)`,
  );
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "pulse-ytown-")),
    "own_videos.json",
  );
  assert.equal(await refreshOwnVideos(db, file), 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).ids, [
    "pulseVideo1",
  ]);
  await db.close();
});

test("signed pull: what is worth a signed-in try (age gate, anonymous bot pause) and what is not", () => {
  assert.ok(signedRetryWorth(ageError()));
  assert.ok(signedRetryWorth(new YtPausedError("blocked", 1, "anon")));
  assert.ok(
    !signedRetryWorth(new YtPausedError("budget", 1, "anon")),
    "the anonymous budget is not a reason",
  );
  assert.ok(!signedRetryWorth(new YtPausedError("blocked", 1, "signed")));
  assert.ok(
    !signedRetryWorth(
      Object.assign(new Error("x"), { stderr: "HTTP Error 403: Forbidden" }),
    ),
  );
  assert.ok(
    !signedRetryWorth(
      Object.assign(new Error("x"), { stderr: "Video unavailable" }),
    ),
  );
});

function attempts(behaviour: (args: string[]) => unknown) {
  const calls: Array<{ args: string[]; purpose: string }> = [];
  const attempt = async (args: string[]) => {
    calls.push({ args, purpose: currentYtPurpose() });
    const r = behaviour(args);
    if (r instanceof Error) throw r;
    return { stdout: "ok", stderr: "" };
  };
  return { calls, attempt };
}
const signed = (a: string[]) => a[0] === "--cookies";
const deps = (o: { cookies?: string[]; gated?: boolean } = {}) => ({
  cookies: async () => o.cookies ?? COOKIES,
  knownGated: () => o.gated ?? false,
});
const ARGS = ["-f", "b", "-o", "/tmp/x.mp4", URL];

test("signed pull: off, the pull is exactly the anonymous one", async () => {
  const { calls, attempt } = attempts(() => ageError());
  await assert.rejects(
    signedPull(
      ARGS,
      attempt,
      { enabled: false, what: "clip" },
      deps({ gated: true }),
    ),
    /yt-dlp/,
  );
  assert.deepEqual(
    calls.map((c) => c.args),
    [ARGS],
  );
});

test("signed pull: an age gate is tried once more signed in, counted on the clip share", async () => {
  const { calls, attempt } = attempts((a) =>
    signed(a) ? undefined : ageError(),
  );
  const r = await signedPull(
    ARGS,
    attempt,
    { enabled: true, what: "clip" },
    deps(),
  );
  assert.equal(r.stdout, "ok");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]!.args, [...COOKIES, ...ARGS]);
  assert.equal(calls[0]!.purpose, "fetcher");
  assert.equal(
    calls[1]!.purpose,
    "clip",
    "the signed-in try counts against the clip share",
  );
});

test("signed pull: the anonymous lane's bot pause is a reason; other failures and searches are not", async () => {
  const paused = attempts((a) =>
    signed(a) ? undefined : new YtPausedError("blocked", 1, "anon"),
  );
  await signedPull(
    ARGS,
    paused.attempt,
    { enabled: true, what: "clip" },
    deps(),
  );
  assert.equal(paused.calls.length, 2);
  const gone = attempts(() =>
    Object.assign(new Error("x"), { stderr: "Video unavailable" }),
  );
  await assert.rejects(
    signedPull(ARGS, gone.attempt, { enabled: true, what: "clip" }, deps()),
  );
  assert.equal(gone.calls.length, 1);
  const search = attempts(() => ageError());
  await assert.rejects(
    signedPull(
      ["--flat-playlist", "ytsearch5:gta 6"],
      search.attempt,
      { enabled: true, what: "clip" },
      deps(),
    ),
  );
  assert.equal(search.calls.length, 1, "a search is never signed in");
});

test("signed pull: the clip share used up, or no cookies (Pulse's own video), leaves the anonymous failure", async () => {
  const share = attempts((a) =>
    signed(a) ? new YtPausedError("share", 1, "signed") : ageError(),
  );
  await assert.rejects(
    signedPull(ARGS, share.attempt, { enabled: true, what: "clip" }, deps()),
    (e: Error) =>
      /confirm your age/.test(String((e as { stderr?: string }).stderr)),
  );
  assert.equal(share.calls.length, 2);
  const none = attempts(() => ageError());
  await assert.rejects(
    signedPull(
      ARGS,
      none.attempt,
      { enabled: true, what: "clip" },
      deps({ cookies: [] }),
    ),
  );
  assert.equal(none.calls.length, 1);
});

test("signed pull: a video the guard knows is age-gated goes signed in first; a refused signed try falls back", async () => {
  const known = attempts(() => undefined);
  await signedPull(
    ARGS,
    known.attempt,
    { enabled: true, what: "clip" },
    deps({ gated: true }),
  );
  assert.equal(known.calls.length, 1);
  assert.ok(signed(known.calls[0]!.args));
  const refused = attempts((a) =>
    signed(a) ? new YtPausedError("share", 1, "signed") : undefined,
  );
  await signedPull(
    ARGS,
    refused.attempt,
    { enabled: true, what: "clip" },
    deps({ gated: true }),
  );
  assert.deepEqual(
    refused.calls.map((c) => signed(c.args)),
    [true, false],
  );
});

test("signed pull: the switch and the cookies file are read from the environment like the config", () => {
  assert.equal(envSwitch("SIGNED_CLIPS", { SIGNED_CLIPS: "true" }), true);
  assert.equal(envSwitch("SIGNED_CLIPS", { SIGNED_CLIPS: "on" }), true);
  assert.equal(envSwitch("SIGNED_CLIPS", {}), false);
  assert.equal(envSwitch("SIGNED_CLIPS", { SIGNED_CLIPS: "false" }), false);
  assert.equal(envCookiesFile({}), "");
  assert.equal(
    envCookiesFile({ YTDLP_COOKIES_FILE: "cookies.txt" }),
    path.resolve("cookies.txt"),
  );
});
