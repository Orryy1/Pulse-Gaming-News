import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterCall,
  cookiesUsable,
  createYtGuard,
  decide,
  emptyState,
  guardSettings,
  isAgeGate,
  isBotCheck,
  isCookieTrouble,
  isYtPaused,
  laneOfCall,
  markNeedsSignIn,
  needsSignInNow,
  noteCookieTrouble,
  videoIdOf,
  type GuardSettings,
} from "../src/lib/ytguard.ts";
import { cookieArgs, signedInArgs } from "../src/lib/ytsignin.ts";
import { fetcherCookiesFile } from "../src/sceneindex/build.ts";
import { planGame, sceneIndexTick } from "../src/sceneindex/job.ts";
import { testConfig, tmpDir } from "./helpers.ts";

const HOUR = 3_600_000;
const s: GuardSettings = guardSettings({});
const AGE =
  "ERROR: [youtube] byDw86z-oZo: Sign in to confirm your age. This video may be inappropriate for some users. Use --cookies-from-browser or --cookies for the authentication.";
const BOT =
  "ERROR: [youtube] YiiTOJZDWyA: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.";
const STALE =
  "WARNING: [youtube] The provided YouTube account cookies are no longer valid. They have likely been rotated in the browser as a security measure.";
const URL = "https://www.youtube.com/watch?v=byDw86z-oZo";
const SIGNED = ["--cookies", "/data/yt_cookies.txt"];

test("signed-in settings: YT_SIGNED_PER_HOUR defaults to 4 (YT_SIGNED_HOURLY still read) and can be changed", () => {
  assert.equal(s.signedHourlyBudget, 4);
  assert.equal(guardSettings({ YT_SIGNED_PER_HOUR: "6" }).signedHourlyBudget, 6);
  assert.equal(guardSettings({ YT_SIGNED_HOURLY: "8" }).signedHourlyBudget, 8, "the old name still works");
  assert.equal(
    guardSettings({ YT_SIGNED_HOURLY: "8", YT_SIGNED_PER_HOUR: "3" }).signedHourlyBudget,
    3,
    "the new name wins",
  );
  assert.equal(guardSettings({ YT_SIGNED_PER_HOUR: "x" }).signedHourlyBudget, 4);
});

test("answers: an age gate is not a bot check; refused cookies are recognised", () => {
  assert.ok(isAgeGate(AGE));
  assert.ok(!isBotCheck(AGE), "an age gate never counts as a bot strike");
  assert.ok(isBotCheck(BOT) && !isAgeGate(BOT));
  assert.ok(isCookieTrouble(STALE));
  assert.ok(
    isCookieTrouble("does not look like a Netscape format cookies file"),
  );
  assert.ok(!isCookieTrouble(BOT) && !isCookieTrouble(AGE));
});

test("lanes: only a call carrying --cookies is signed in; the video id is read from the link", () => {
  assert.equal(laneOfCall([...SIGNED, "--dump-single-json", URL]), "signed");
  assert.equal(laneOfCall(["--dump-single-json", URL]), "anon");
  assert.equal(laneOfCall(["--cookies-from-browser", "brave", URL]), "anon");
  assert.equal(videoIdOf(["-f", "b", URL]), "byDw86z-oZo");
  assert.equal(videoIdOf(["https://youtu.be/jNQXAC9IVRw"]), "jNQXAC9IVRw");
  assert.equal(videoIdOf(["ytsearch15:gta 6 full movie"]), undefined);
});

test("the anonymous pause never stops the signed-in lane, and the signed-in calls have their own budget", () => {
  const st = emptyState();
  afterCall(st, 0, "bot", false, s);
  assert.equal(
    decide(st, HOUR, "urgent", s, 0).go,
    false,
    "anonymous is paused",
  );
  assert.ok(
    decide(st, HOUR, "background", s, 0, "signed").go,
    "signed in still goes",
  );
  const small = {
    ...s,
    signedHourlyBudget: 2,
    signedDailyBudget: 0,
    signedMinGapMs: 0,
  };
  const t = emptyState();
  assert.ok(decide(t, 0, "urgent", small, 0, "signed").go);
  assert.ok(decide(t, 0, "urgent", small, 0, "signed").go);
  const no = decide(t, 0, "urgent", small, 0, "signed");
  assert.ok(!no.go && no.reason === "budget");
  assert.equal(
    t.calls.length,
    0,
    "signed-in calls are not counted in the anonymous budget",
  );
  assert.ok(
    decide(t, 0, "urgent", small, 0).go,
    "the anonymous lane is untouched",
  );
});

test("a bot check on the signed-in lane pauses only that lane: 6 hours, doubling, 48 at most", () => {
  const st = emptyState();
  assert.equal(afterCall(st, 0, "bot", false, s, "signed"), "started");
  assert.equal(st.block, undefined, "the anonymous lane is not paused");
  assert.equal(st.signed!.block!.until, 6 * HOUR);
  assert.match(st.alerts[0]!, /signed-in download account/);
  assert.ok(decide(st, HOUR, "urgent", s, 0).go, "anonymous still goes");
  const blocked = decide(st, HOUR, "urgent", s, 0, "signed");
  assert.ok(!blocked.go && blocked.reason === "blocked");
  const probe = decide(st, 6 * HOUR + 1, "urgent", s, 0, "signed");
  assert.ok(probe.go && probe.probe);
  assert.equal(
    afterCall(st, 6 * HOUR + 1, "bot", true, s, "signed"),
    "extended",
  );
  assert.equal(st.signed!.block!.until - (6 * HOUR + 1), 12 * HOUR);
  st.signed!.block!.strikes = 9;
  st.signed!.probeAt = undefined;
  st.signed!.block!.until = 0;
  assert.ok(decide(st, 20 * HOUR, "urgent", s, 0, "signed").go);
  afterCall(st, 20 * HOUR, "bot", true, s, "signed");
  assert.equal(st.signed!.block!.until - 20 * HOUR, 48 * HOUR);
});

test("age-gated videos are kept for 30 days, newest 500", () => {
  const st = emptyState();
  markNeedsSignIn(st, "byDw86z-oZo", 0);
  assert.ok(needsSignInNow(st, "byDw86z-oZo", 29 * 24 * HOUR));
  assert.ok(!needsSignInNow(st, "byDw86z-oZo", 31 * 24 * HOUR));
  for (let i = 0; i < 600; i++) markNeedsSignIn(st, `v${i}`, i + 1);
  assert.equal(Object.keys(st.needsSignIn!).length, 500);
  assert.ok(
    needsSignInNow(st, "v599", 1000) && !needsSignInNow(st, "v0", 1000),
  );
});

test("cookie trouble: one Discord line per episode, a log warning once a day, refused cookies wait for a new file or a day", () => {
  const st = emptyState();
  assert.equal(noteCookieTrouble(st, 0, "signed-out"), true);
  assert.equal(st.alerts.length, 1);
  assert.match(st.alerts[0]!, /needs signing in again on the Mac mini/);
  assert.equal(
    noteCookieTrouble(st, HOUR, "signed-out"),
    false,
    "no second warning the same day",
  );
  assert.equal(
    noteCookieTrouble(st, 25 * HOUR, "signed-out"),
    true,
    "warned again the next day",
  );
  assert.equal(st.alerts.length, 1, "still only one Discord line");
  const since = st.cookieTrouble!.since;
  assert.equal(
    cookiesUsable(st, since - 1, since + HOUR),
    false,
    "the same old file is not tried again",
  );
  assert.equal(
    cookiesUsable(st, since + 5, since + HOUR),
    true,
    "a newly exported file is",
  );
  assert.equal(
    cookiesUsable(st, since - 1, since + 24 * HOUR),
    true,
    "one try a day",
  );
  assert.equal(cookiesUsable(emptyState(), 0, 0), true);
});

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytsignin-"));
  let now = 10_000_000;
  const g = createYtGuard({
    dir,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    rand: () => 0,
    settings: () => guardSettings({}),
    cls: () => "background",
  });
  return { g, dir, advance: (ms: number) => (now += ms), at: () => now };
}

const fail = (text: string) => async () => {
  throw Object.assign(new Error("Command failed: yt-dlp"), { stderr: text });
};
const ok = async () => ({ stdout: "{}", stderr: "" });

test("guard: an anonymous age gate marks that video and is not a strike", async () => {
  const { g } = rig();
  await assert.rejects(
    g.run("yt-dlp", ["--dump-single-json", URL], fail(AGE)),
    /Command failed/,
  );
  const st = await g.state();
  assert.equal(st.block, undefined, "no pause");
  assert.equal(st.alerts.length, 0, "no bot alert");
  assert.ok(g.needsSignIn("byDw86z-oZo"));
  assert.ok(!g.needsSignIn("jNQXAC9IVRw"));
  let ran = false;
  await g.run(
    "yt-dlp",
    ["--dump-single-json", "https://www.youtube.com/watch?v=jNQXAC9IVRw"],
    async () => {
      ran = true;
      return { stdout: "{}", stderr: "" };
    },
  );
  assert.ok(ran, "the next anonymous call goes straight on");
});

test("guard: a bot check on the signed-in lane leaves anonymous calls running", async () => {
  const { g } = rig();
  await assert.rejects(
    g.run("yt-dlp", [...SIGNED, "--dump-single-json", URL], fail(BOT)),
    /Command failed/,
  );
  await assert.rejects(
    g.run(
      "yt-dlp",
      [...SIGNED, "--dump-single-json", "https://youtu.be/jNQXAC9IVRw"],
      ok,
    ),
    (err: unknown) =>
      isYtPaused(err) &&
      /signed-in fetching is paused/.test((err as Error).message),
  );
  const r = await g.run(
    "yt-dlp",
    ["--flat-playlist", "--dump-json", "ytsearch15:gta 6 full movie"],
    ok,
  );
  assert.equal(r.stdout, "{}");
  const st = await g.state();
  assert.equal(st.block, undefined);
  assert.ok(st.signed?.block);
});

test("guard: refused cookies are noted once, not a strike, and a signed-in call that works clears them", async () => {
  const { g, advance } = rig();
  await assert.rejects(
    g.run(
      "yt-dlp",
      [...SIGNED, "--dump-single-json", URL],
      fail(`${STALE}\n${AGE}`),
    ),
    /Command failed/,
  );
  let st = await g.state();
  assert.equal(st.signed?.block, undefined, "not a bot strike");
  assert.equal(st.cookieTrouble?.reason, "signed-out");
  assert.equal(
    st.needsSignIn,
    undefined,
    "an age gate while signed in is about the cookies, not the video",
  );
  assert.equal(g.cookiesUsable(0), false);
  const sent: string[] = [];
  assert.equal(await g.flushAlerts((t) => sent.push(t)), 1);
  advance(24 * HOUR);
  assert.equal(g.cookiesUsable(0), true, "one try a day");
  await g.run(
    "yt-dlp",
    [...SIGNED, "--dump-single-json", "https://youtu.be/jNQXAC9IVRw"],
    ok,
  );
  st = await g.state();
  assert.equal(st.cookieTrouble, undefined);
});

test("guard: a signed-in call that works while yt-dlp says the cookies were refused is noted, not a strike", async () => {
  const { g } = rig();
  const r = await g.run(
    "yt-dlp",
    [...SIGNED, "--dump-single-json", URL],
    async () => ({ stdout: "{}", stderr: STALE }),
  );
  assert.equal(r.stdout, "{}");
  const st = await g.state();
  assert.equal(st.signed?.block, undefined, "no pause");
  assert.equal(st.cookieTrouble?.reason, "signed-out");
  assert.equal(st.alerts.length, 1);
  assert.match(st.alerts[0]!, /needs signing in again on the Mac mini/);
});

test("an anonymous call never gets the cookies, even with refused-cookie words in its answer", async () => {
  const { g } = rig();
  await g.run("yt-dlp", ["--dump-single-json", URL], async () => ({
    stdout: "{}",
    stderr: STALE,
  }));
  const st = await g.state();
  assert.equal(st.cookieTrouble, undefined);
  assert.equal(st.signed, undefined, "the signed-in lane is untouched");
  assert.equal(st.calls.length, 1, "counted in the anonymous budget");
});

test("signedInArgs: off when empty, anonymous with one notice when the file is missing, the file when it is there", async () => {
  const { g } = rig();
  assert.deepEqual(await signedInArgs({ ytdlpCookiesFile: "" }, g), []);
  assert.deepEqual(await signedInArgs({}, g), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytcookies-"));
  const file = path.join(dir, "yt_cookies.txt");
  assert.deepEqual(await signedInArgs({ ytdlpCookiesFile: file }, g), []);
  assert.deepEqual(await signedInArgs({ ytdlpCookiesFile: file }, g), []);
  const st = await g.state();
  assert.equal(st.cookieTrouble?.reason, "missing");
  assert.equal(st.alerts.length, 1, "one Discord line for the missing file");
  fs.writeFileSync(file, "# Netscape HTTP Cookie File\n");
  assert.deepEqual(await signedInArgs({ ytdlpCookiesFile: file }, g), [
    "--cookies",
    file,
  ]);
  assert.deepEqual(
    cookieArgs(file, 1, false),
    [],
    "refused cookies are not used",
  );
  assert.deepEqual(cookieArgs(file, undefined, true), []);
});

// 26 Nov 2026 (upgrade queue item 56): the anonymous lane is retired, so every scene-index build and light turn signs
// in, inside the signed-in ration; the hand-run search and alive checks stay anonymous.
test("every scene-index build and light turn gets the cookies file; search and alive do not", () => {
  const env = { YTDLP_COOKIES_FILE: "/f/data/yt_cookies.txt" };
  assert.equal(
    fetcherCookiesFile("build", true, env),
    "/f/data/yt_cookies.txt",
  );
  assert.equal(fetcherCookiesFile("build", false, env), "/f/data/yt_cookies.txt");
  assert.equal(fetcherCookiesFile("light", false, env), "/f/data/yt_cookies.txt");
  assert.equal(fetcherCookiesFile("search", true, env), "");
  assert.equal(fetcherCookiesFile("alive", false, env), "");
  assert.equal(fetcherCookiesFile("build", true, {}), "");
});

// The cookies must never reach any other yt-dlp call: Shorts clip pulls, scene search, the light index, the archive.
test("no other call site signs in: signedInArgs and --cookies appear only where the fetcher and the opt-in switches use them", () => {
  const src = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
  );
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mts|js|mjs|py)$/.test(e.name)) files.push(p);
    }
  };
  walk(src);
  const rel = (p: string) => path.relative(src, p).split(path.sep).join("/");
  const using = files
    .filter((f) => /signedInArgs\s*\(/.test(fs.readFileSync(f, "utf8")))
    .map(rel)
    .sort();
  // 19 Nov 2026: the trend feed (TREND_FEED) reads the subscriptions page signed in; clips (SIGNED_CLIPS, child.ts)
  // and the light index (SIGNED_LIGHT_INDEX) go through signedPull, all default off.
  assert.deepEqual(using, ["discovery/trendfeed.ts", "lib/ytsignin.ts", "sceneindex/build.ts"]);
  const pulling = files
    .filter((f) => /signedPull\s*\(/.test(fs.readFileSync(f, "utf8")))
    .map(rel)
    .sort();
  assert.deepEqual(pulling, ["lib/child.ts", "sceneindex/light.ts"]);
  const cookieFlag = files
    .filter((f) => /["'`]--cookies["'`=]/.test(fs.readFileSync(f, "utf8")))
    .map(rel)
    .sort();
  // ytapisearch.ts only names the flag to skip it: a search the Data API answers needs no sign-in (25 Nov 2026).
  assert.deepEqual(cookieFlag, ["lib/ytapisearch.ts", "lib/ytguard.ts", "lib/ytsignin.ts"]);
  const fromBrowser = files
    .filter((f) => /cookies-from-browser/.test(fs.readFileSync(f, "utf8")))
    .map(rel);
  assert.deepEqual(
    fromBrowser,
    [],
    "the factory never reads a browser's cookies itself",
  );
  const build = fs.readFileSync(
    path.join(src, "sceneindex", "build.ts"),
    "utf8",
  );
  // signedInArgs only inside fetcherRun and usableUpload; fetcherRun for search, details, the proxy and the sections a
  // build fetches when its proxy was released (26 Nov 2026: those were the last anonymous calls of a build).
  assert.equal(build.match(/signedInArgs\s*\(/g)?.length, 2);
  const runs = [...build.matchAll(/fetcherRun\s*\(/g)].map((m) => {
    // The function the call sits in (or, for its own definition, fetcherRun itself).
    const upTo = build.slice(0, m.index! + "fetcherRun(".length);
    const fns = [...upTo.matchAll(/\n(?:export )?(?:async )?function (\w+)/g)];
    return fns.at(-1)?.[1];
  });
  assert.deepEqual(runs.sort(), [
    "ensureProxy",
    "fetcherRun",
    "frameSource",
    "hearInto",
    "searchUploads",
    "uploadDetails",
  ]);
  // No yt-dlp call of a build goes around fetcherRun: the one `run(s.ytdlp` left is fetcherRun's own.
  assert.equal(build.match(/\brun\(\s*s\.ytdlp/g)?.length, 1);
  assert.match(build, /return run\(s\.ytdlp, \[\.\.\.signed, \.\.\.args\], o\);/);
  // The tool sets the cookies file from fetcherCookiesFile only, and the job hands it to every turn.
  const tool = fs.readFileSync(
    path.join(src, "tools", "sceneindex.ts"),
    "utf8",
  );
  assert.deepEqual(tool.match(/cookiesFile:.*$/gm), [
    'cookiesFile: fetcherCookiesFile(command, Boolean(flag("complete")), env),',
  ]);
  const job = fs.readFileSync(path.join(src, "sceneindex", "job.ts"), "utf8");
  const handed =
    job.match(/YTDLP_COOKIES_FILE:[^,}\r\n]*(?:\([^)]*\)[^,}\r\n]*)?/g) ?? [];
  assert.deepEqual(
    handed.map((h) => h.trim()),
    ["YTDLP_COOKIES_FILE: cookies", "YTDLP_COOKIES_FILE: cookies"],
  );
  // The one value both get: the config's cookies file, read once for the turn.
  assert.match(job, /const cookies = cfg\.ytdlpCookiesFile \?\? "";/);
  assert.deepEqual(
    job.match(/YT_PURPOSE: [^,}\r\n]*/g),
    ['YT_PURPOSE: "library"', 'YT_PURPOSE: job.fetch || job.pin ? "movie" : "library"'],
  );
});

// Behaviour, not just source text: the scene index job hands the cookies file to every turn (26 Nov 2026), the
// launch plan's as a "movie" turn and an ordinary build's as "library", so the guard rations them apart.
test("the job: every turn gets YTDLP_COOKIES_FILE; a launch plan counts as movie, an ordinary build as library", async () => {
  const cookies = "/f/data/yt_cookies.txt";
  const seen: Array<{ line: string; env: NodeJS.ProcessEnv }> = [];
  const run = async (cmd: string, args: string[], env: NodeJS.ProcessEnv) => {
    seen.push({ line: [cmd, ...args].join(" "), env });
    return { stdout: "no-source {} in 30 s\n", code: 0 };
  };

  const plain = await tmpDir();
  const cfgPlain = testConfig(plain, { sceneIndex: true, macMinFreeGb: 40, ytdlpCookiesFile: cookies });
  await sceneIndexTick(cfgPlain, [{ game: "Grand Theft Auto VI", reason: "a video about it" }], {
    now: () => new Date("2026-11-19T09:00:00Z"),
    run,
    freeGb: async () => 90,
  });
  assert.equal(seen.length, 1);
  assert.doesNotMatch(seen[0]!.line, /--complete/);
  assert.equal(seen[0]!.env.YTDLP_COOKIES_FILE, cookies, "an ordinary build signs in too");
  assert.equal(seen[0]!.env.YT_PURPOSE, "library");

  const fetch = await tmpDir();
  const cfgFetch = testConfig(fetch, { sceneIndex: true, macMinFreeGb: 40, ytdlpCookiesFile: cookies });
  fs.mkdirSync(path.join(fetch, "sceneindex"), { recursive: true });
  const q = planGame(
    { games: [] },
    "Grand Theft Auto VI",
    {
      notBefore: "2026-11-18T11:00:00.000Z",
      searchEveryHours: 3,
      recheckEveryHours: 24,
      recheckUntil: "2026-12-18T00:00:00.000Z",
      priority: 50,
    },
    "owner",
    new Date("2026-11-12T00:00:00Z"),
  );
  fs.writeFileSync(path.join(fetch, "sceneindex", "queue.json"), JSON.stringify(q));
  await sceneIndexTick(cfgFetch, [], {
    now: () => new Date("2026-11-18T12:00:00Z"),
    run,
    freeGb: async () => 90,
  });
  assert.equal(seen.length, 2);
  assert.match(seen[1]!.line, /build Grand Theft Auto VI .*--complete/);
  assert.equal(seen[1]!.env.YTDLP_COOKIES_FILE, cookies, "the fetcher's own turn signs in");
  assert.equal(seen[1]!.env.YT_PURPOSE, "movie");

  // Off: the fetcher's turn is anonymous too.
  const off = await tmpDir();
  const cfgOff = testConfig(off, { sceneIndex: true, macMinFreeGb: 40 });
  fs.mkdirSync(path.join(off, "sceneindex"), { recursive: true });
  fs.writeFileSync(path.join(off, "sceneindex", "queue.json"), JSON.stringify(q));
  await sceneIndexTick(cfgOff, [], {
    now: () => new Date("2026-11-18T12:00:00Z"),
    run,
    freeGb: async () => 90,
  });
  assert.equal(seen[2]!.env.YTDLP_COOKIES_FILE, "");
});
