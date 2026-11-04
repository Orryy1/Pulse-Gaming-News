import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  alertKind,
  alertLedgerFlushed,
  alertRecord,
  readAlerts,
  startAlertLedger,
  stopAlertLedger,
  withAlertScope,
  type AlertRecord,
} from "../src/alertlog.ts";
import {
  alertDigestDue,
  digestMarkdown,
  digestPost,
  faultsIn,
  kindRows,
  markAlertDigestSent,
  repeatsOf,
  trendOf,
  writeAlertDigest,
} from "../src/alertdigest.ts";
import { postDiscord } from "../src/approval/discord.ts";
import { checkYouTube } from "../src/doctor.ts";
import { CONNECT_ATTEMPT_MS, errorMessage } from "../src/lib/util.ts";
import { testConfig, testDb } from "./helpers.ts";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "alertloop-"));

test("the channel's real alerts get their kinds", () => {
  const cases: Array<[string, string]> = [
    [
      "narration_fault",
      '🎙️ The narration for "Elder Ring" still has a fault after a second take, so it goes ahead: 0:09 "7th," came out as "Seventh,"',
    ],
    [
      "voice_breaths",
      '🎙️ The narration for "Elder Scrolls 6 Is Officially Named Sentinel" sounds off and goes ahead anyway: 1.7 audible breaths a minute (0:21 -15.9 dB 0.34 s)',
    ],
    [
      "voice_pace",
      '🎙️ The narration for "X" sounds off and goes ahead anyway: 193 words a minute while speaking',
    ],
    [
      "graphics_muted",
      '🎨 "X": the graphics check looked at 40 graphics before the render and muted 3 graphics (too small). The video renders once, without them.',
    ],
    [
      "video_faulted",
      '🎨 "X": the check of the finished video faulted 2 graphics (clipped). They are muted and the video renders again, once.',
    ],
    [
      "short_of_pictures",
      '🖼️ "X" is short of pictures for Doom (20s on the plain background).',
    ],
    [
      "sentence_matching",
      '🎞️ "X": 80% of its sentences have something chosen for their own words (40% a picture or clip of their own, the rest a graphic), under the 85% target. It renders anyway.',
    ],
    [
      "sentence_matching",
      '🎞️ "X": 75% of its narration has something chosen for its own words on screen (6% a trailer moment or picture matched to the line, 69% a card), under the 85% target.',
    ],
    ["no_beats", 'Documentary "X": the writer marked no beats for the mix.'],
    [
      "boot_check",
      "🩺 Pulse Factory boot check:\n⛔ youtube_login: unreachable: fetch failed",
    ],
    [
      "mac_fallback",
      "Mac mini: the Short render is running on the PC instead (ENOENT: poster.jpg).",
    ],
    [
      "routine",
      "✅ Uploaded, goes live today at 17:00: Elder Scrolls 6 https://youtu.be/x",
    ],
    ["routine", "✅ Live now (long video): Vice City https://youtu.be/x"],
    [
      "routine",
      '🎨 "X": the graphics check looked at 40 graphics before the render and found nothing wrong.',
    ],
    ["other", "Something nobody has written a rule for yet."],
  ];
  for (const [kind, text] of cases) assert.equal(alertKind(text), kind, text);
});

test("a ledger line carries the video from its scope, or the title the text quotes", () => {
  const now = new Date("2026-11-04T17:00:00Z");
  const content =
    '🖼️ "Doom Ranked" is short of pictures for Doom (20s on the plain background).';
  const quoted = alertRecord({ content }, now);
  assert.equal(quoted.title, "Doom Ranked");
  assert.equal(quoted.episode, undefined);
  const scoped = withAlertScope({ episode: "ep_1", title: "Doom" }, () =>
    alertRecord({ content }, now),
  );
  assert.deepEqual(
    { episode: scoped.episode, title: scoped.title, kind: scoped.kind },
    { episode: "ep_1", title: "Doom", kind: "short_of_pictures" },
  );
  // An embed's words count; a boot check's quoted detail is not a video.
  const embed = alertRecord(
    { embeds: [{ title: "⚠️ No Short published in the last 26 hours" }] },
    now,
  );
  assert.equal(embed.kind, "no_short");
  const boot = alertRecord(
    {
      content: `🩺 Pulse Factory boot check:\n${"x".repeat(60)}\n⚠️ rockstar: latest "GTA"`,
    },
    now,
  );
  assert.equal(boot.title, undefined);
});

test("posts reach the ledger through postDiscord, in order, whatever the scope", async () => {
  const dir = await tmp();
  const file = path.join(dir, "logs", "alerts.jsonl");
  startAlertLedger(file, "");
  try {
    await withAlertScope({ episode: "ep_9", title: "Sentinel" }, () =>
      postDiscord("", { content: "first alert" }),
    );
    await postDiscord("", { content: "second alert" });
    // Another webhook is another channel.
    await postDiscord("http://127.0.0.1:9/never", {
      content: "tiktok draft",
    }).catch(() => undefined);
    await alertLedgerFlushed();
    const lines = await readAlerts(file);
    assert.deepEqual(
      lines.map((l) => [l.text, l.episode, l.title]),
      [
        ["first alert", "ep_9", "Sentinel"],
        ["second alert", undefined, undefined],
      ],
    );
    assert.ok(Date.parse(lines[0]!.t) > 0);
  } finally {
    stopAlertLedger();
  }
});

test("with the setting off nothing is written", async () => {
  const dir = await tmp();
  await postDiscord("", { content: "not kept" });
  await alertLedgerFlushed();
  assert.deepEqual(await fs.readdir(dir), []);
});

test("a ledger that cannot be written neither stops nor delays the post", async () => {
  const dir = await tmp();
  // A folder where the file should be: every append fails.
  const file = path.join(dir, "alerts.jsonl");
  await fs.mkdir(file);
  let got = "";
  const server = http.createServer((req, res) => {
    req.on("data", (d) => (got += String(d)));
    req.on("end", () => res.writeHead(204).end());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/hook`;
  startAlertLedger(file, url);
  try {
    assert.equal(await postDiscord(url, { content: "still goes" }), true);
    assert.match(got, /still goes/);
    await alertLedgerFlushed(); // it logged the failure and did not throw
  } finally {
    stopAlertLedger();
    server.close();
  }
});

test("a torn ledger line is skipped and a missing ledger is no alerts", async () => {
  const dir = await tmp();
  const file = path.join(dir, "alerts.jsonl");
  assert.deepEqual(await readAlerts(file), []);
  await fs.writeFile(
    file,
    `{"t":"2026-11-04T10:00:00Z","kind":"other","text":"ok"}\n{"t":"2026-11`,
  );
  assert.equal((await readAlerts(file)).length, 1);
});

const NOW = new Date("2026-11-04T09:00:00Z");
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();
const rec = (
  h: number,
  kind: string,
  text: string,
  title?: string,
): AlertRecord => ({ t: hoursAgo(h), kind, text, ...(title ? { title } : {}) });

test("rising means out of line with the week; one more of a rare kind is not", () => {
  assert.equal(trendOf(3, 3), "new");
  assert.equal(trendOf(1, 1), "new");
  assert.equal(trendOf(4, 10), "rising"); // 4 today, one a day before
  assert.equal(trendOf(1, 2), "steady"); // 1 today, 1 in the six days before
  assert.equal(trendOf(1, 7), "steady");
  assert.equal(trendOf(0, 12), "falling");
  assert.equal(trendOf(2, 44), "falling");
});

test("the digest counts per kind and window, skips routine posts and names the worst video", () => {
  const records = [
    rec(2, "narration_fault", "x", "Sentinel"),
    rec(3, "narration_fault", "y", "Sentinel"),
    rec(30, "narration_fault", "z", "FFXIV"),
    rec(50, "boot_check", "b"),
    rec(1, "routine", "✅ Live now: Sentinel"),
    rec(24 * 8, "video_faulted", "too old"),
  ];
  const rows = kindRows(records, NOW);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.day, r.week, r.trend]),
    [
      ["narration_fault", 2, 3, "rising"],
      ["boot_check", 0, 1, "falling"],
    ],
  );
  assert.deepEqual(rows[0]!.worst, { name: "Sentinel", count: 2 });
  const page = digestMarkdown(records, NOW);
  assert.match(
    page,
    /\| narration_fault \| 2 \| 3 \| rising \| Sentinel \(2\) \|/,
  );
  assert.doesNotMatch(page, /routine|Live now/);
});

test("one fault coming back is seen across videos, whatever its time stamp", () => {
  const fault = (title: string, at: string) =>
    rec(
      5,
      "narration_fault",
      `🎙️ The narration for "${title}" still has a fault after a second take, so it goes ahead: ${at} "2nd," came out as "Second,"; 0:40 "the" came out as "a"`,
      title,
    );
  assert.deepEqual(faultsIn(fault("A", "0:36")), [
    '"2nd," came out as "second,"',
    '"the" came out as "a"',
  ]);
  const boot = (h: number) =>
    rec(
      h,
      "boot_check",
      "🩺 Pulse Factory boot check:\n⛔ youtube_login: unreachable: fetch failed",
    );
  const repeats = repeatsOf(
    [
      fault("A", "0:36"),
      fault("B", "0:12"),
      fault("C", "1:02"),
      boot(1),
      boot(2),
      boot(3),
    ],
    NOW,
  );
  assert.ok(
    repeats.some(
      (r) =>
        r.kind === "narration_fault" &&
        r.count === 3 &&
        r.videos === 3 &&
        r.fault === '"2nd," came out as "second,"',
    ),
  );
  assert.ok(
    repeats.some(
      (r) => r.kind === "boot_check" && /youtube_login/.test(r.fault),
    ),
  );
  // Twice is not yet a pattern.
  assert.deepEqual(repeatsOf([boot(1), boot(2)], NOW), []);
});

test("the channel only hears of a kind that is new or rising", () => {
  // A steady week: nothing to post, the page still gets written (next test).
  const steady = [
    rec(5, "video_faulted", "a"),
    ...[30, 54, 78, 102, 126, 150].map((h) =>
      rec(h, "video_faulted", `faulted ${h}`),
    ),
  ];
  assert.equal(digestPost(steady, NOW), undefined);
  // "Other" and routine lines never make it post.
  assert.equal(
    digestPost(
      [rec(1, "other", "a"), rec(2, "other", "b"), rec(3, "routine", "c")],
      NOW,
    ),
    undefined,
  );
  const post = digestPost(
    [...steady, rec(1, "voice_breaths", "b", "Sentinel")],
    NOW,
  );
  assert.ok(post?.content);
  assert.match(
    post.content,
    /voice_breaths is new: 1 in 24 hours, 1 in 7 days/,
  );
  assert.match(post.content, /"Sentinel"/);
  assert.doesNotMatch(post.content, /video_faulted/);
  assert.equal(
    alertKind(post.content),
    "routine",
    "the digest is not an alert",
  );
  assert.doesNotMatch(post.content, /—/);
});

test("the page is written every day, with or without a post", async () => {
  const dataDir = await tmp();
  assert.equal(await writeAlertDigest({ dataDir }, NOW), undefined);
  const page = path.join(dataDir, "logs", "alert_digest.md");
  assert.match(await fs.readFile(page, "utf8"), /No alerts in the last 7 days/);
  await fs.writeFile(
    path.join(dataDir, "logs", "alerts.jsonl"),
    `${JSON.stringify(rec(1, "boot_check", "boot check: x"))}\n`,
  );
  assert.match(
    (await writeAlertDigest({ dataDir }, NOW))?.content ?? "",
    /boot_check is new/,
  );
  assert.match(
    await fs.readFile(page, "utf8"),
    /\| boot_check \| 1 \| 1 \| new/,
  );
});

test("the digest is due once a day from 09:00 London, only with the setting on", async () => {
  const db = await testDb();
  const on = testConfig(".", { alertDigest: true, timezone: "Europe/London" });
  const off = testConfig(".", { timezone: "Europe/London" });
  const nine = new Date("2026-11-04T09:05:00Z");
  assert.equal(await alertDigestDue(db, off, nine), undefined);
  assert.equal(
    await alertDigestDue(db, on, new Date("2026-11-04T08:55:00Z")),
    undefined,
  );
  assert.equal(await alertDigestDue(db, on, nine), "2026-11-04");
  await markAlertDigestSent(db, "2026-11-04");
  assert.equal(await alertDigestDue(db, on, nine), undefined);
  assert.equal(
    await alertDigestDue(db, on, new Date("2026-11-05T09:05:00Z")),
    "2026-11-05",
  );
});

/** What a stalled connect looks like: fetch's "fetch failed" with both addresses' errors underneath. */
const lostConnection = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new AggregateError([]), {
      code: "ETIMEDOUT",
      errors: [
        { code: "ETIMEDOUT", address: "192.178.223.95" },
        { code: "ENETUNREACH", address: "2a00:1450:4009:c0f::5f" },
      ],
    }),
  });

const youtubeCfg = testConfig(".", {
  googleClientId: "id",
  googleClientSecret: "secret",
  dryRun: false,
});

async function withFetch<T>(
  answers: Array<() => Response | Error>,
  fn: () => Promise<T>,
): Promise<{ result: T; calls: number }> {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    const answer = answers[Math.min(calls++, answers.length - 1)]!();
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = real;
  }
}

test("a connection lost at boot is tried again and the login reads as fine", async () => {
  const { result, calls } = await withFetch(
    [
      lostConnection,
      lostConnection,
      () =>
        Response.json({
          access_token: "t",
          scope:
            "https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly",
        }),
    ],
    () => checkYouTube(youtubeCfg, "refresh", [0, 0]),
  );
  assert.equal(calls, 3);
  assert.equal(result[0]!.ok, true);
});

test("a real outage still fails, critically, and says why", async () => {
  const { result, calls } = await withFetch([lostConnection], () =>
    checkYouTube(youtubeCfg, "refresh", [0, 0]),
  );
  assert.equal(calls, 3);
  assert.equal(result[0]!.ok, false);
  assert.equal(result[0]!.critical, true);
  assert.match(
    result[0]!.detail,
    /unreachable: fetch failed \(ETIMEDOUT 192\.178\.223\.95; ENETUNREACH 2a00/,
  );
});

test("a refused login is taken the first time", async () => {
  const { result, calls } = await withFetch(
    [() => Response.json({ error: "invalid_grant" }, { status: 400 })],
    () => checkYouTube(youtubeCfg, "refresh", [0, 0]),
  );
  assert.equal(calls, 1);
  assert.equal(result[0]!.ok, false);
  assert.match(result[0]!.detail, /invalid_grant/);
});

test("a stalled event loop no longer abandons a healthy connection", () => {
  assert.equal(
    net.getDefaultAutoSelectFamilyAttemptTimeout(),
    CONNECT_ATTEMPT_MS,
  );
  assert.ok(CONNECT_ATTEMPT_MS >= 2_000 && CONNECT_ATTEMPT_MS < 10_000);
});

test("errorMessage says what fetch failed hides, and leaves everything else alone", () => {
  assert.equal(
    errorMessage(lostConnection()),
    "fetch failed (ETIMEDOUT 192.178.223.95; ENETUNREACH 2a00:1450:4009:c0f::5f)",
  );
  assert.equal(errorMessage(new TypeError("fetch failed")), "fetch failed");
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(
    errorMessage(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ENOTFOUND" },
      }),
    ),
    "fetch failed (ENOTFOUND)",
  );
});
