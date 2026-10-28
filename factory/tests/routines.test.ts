import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.ts";
import { createEpisode } from "../src/episodes.ts";
import { logEvent } from "../src/episodes.ts";
import { clusterItems } from "../src/discovery/cluster.ts";
import { readPoll } from "../src/social/poll.ts";
import type { Services } from "../src/pipeline.ts";
import {
  braveFrontDue,
  clearRelatedCache,
  handleRoutine,
  planRelated,
  pollOptions,
  routineAllowed,
  validDoneKey,
} from "../src/routines.ts";
import { testDb, tmpDir, testConfig, item } from "./helpers.ts";

const req = (remoteAddress: string, headers: Record<string, string> = {}) =>
  ({
    socket: { remoteAddress },
    headers: { host: "127.0.0.1:8080", ...headers },
  }) as never;

test("routine pages: only this PC's own browser, never the tunnel", () => {
  assert.ok(routineAllowed(req("127.0.0.1")));
  assert.ok(routineAllowed(req("::1", { host: "localhost:8080" })));
  assert.ok(
    routineAllowed(req("::ffff:127.0.0.1", { "sec-fetch-site": "none" })),
  );
  // The Cloudflare tunnel connects from 127.0.0.1 but always carries its headers.
  for (const h of [
    "cf-connecting-ip",
    "cf-ray",
    "cdn-loop",
    "x-forwarded-for",
    "cf-ipcountry",
    "forwarded",
  ])
    assert.equal(
      routineAllowed(req("127.0.0.1", { [h]: "1.2.3.4" })),
      false,
      h,
    );
  assert.equal(
    routineAllowed(req("127.0.0.1", { host: "pulsegmg.com" })),
    false,
    "public host name",
  );
  assert.equal(
    routineAllowed(req("127.0.0.1", { host: "" })),
    false,
    "no host",
  );
  for (const ip of [
    "192.168.1.20",
    "10.0.0.5",
    "::ffff:192.168.1.20",
    "8.8.8.8",
    "",
  ])
    assert.equal(routineAllowed(req(ip)), false, ip || "no address");
  // The browser extension's own navigations say "cross-site"; they must still get through.
  assert.ok(
    routineAllowed(req("127.0.0.1", { "sec-fetch-site": "cross-site" })),
  );
});

test("done keys: a fixed list of kinds, each with a strict key", () => {
  assert.ok(validDoneKey("related", "-NHjG0WLs54"));
  assert.ok(validDoneKey("abtest", "m62Cbr2WXcM"));
  assert.ok(validDoneKey("community", "2026-10-26"));
  assert.ok(validDoneKey("poll", "2026-10-31"));
  assert.ok(
    validDoneKey("hearted", "@Idkman10754|Putting ghosts at 8 is criminal"),
  );
  assert.ok(validDoneKey("hearted", "@Zoë|Très bien 🔥 & more"));
  assert.ok(validDoneKey("hearted", "x".repeat(120)));
  assert.equal(validDoneKey("hearted", "x".repeat(121)), false);
  assert.equal(validDoneKey("hearted", "line\nbreak"), false);
  assert.equal(validDoneKey("hearted", "   "), false);
  assert.equal(validDoneKey("related", "short"), false);
  assert.equal(validDoneKey("related", "../../etc/pw"), false);
  assert.equal(validDoneKey("abtest", "m62Cbr2WXcM2"), false);
  assert.equal(validDoneKey("community", "2026-13-01"), false);
  assert.equal(validDoneKey("community", "26-10-2026"), false);
  assert.equal(validDoneKey("x_posted", "m62Cbr2WXcM"), false);
  assert.equal(validDoneKey("__proto__", "m62Cbr2WXcM"), false);
  assert.equal(validDoneKey("toString", "m62Cbr2WXcM"), false);
});

test("Brave comes forward from 3 minutes before each routine to 15 after, every 4 minutes", () => {
  const tz = "Europe/London";
  const at = (iso: string) => new Date(iso);
  // Thursday 29 Oct 2026 (GMT): the community routine at 16:30.
  assert.equal(braveFrontDue(at("2026-10-29T16:26:00Z"), tz), false);
  assert.equal(braveFrontDue(at("2026-10-29T16:27:00Z"), tz), true);
  assert.equal(braveFrontDue(at("2026-10-29T16:45:00Z"), tz), true);
  assert.equal(braveFrontDue(at("2026-10-29T16:46:00Z"), tz), false);
  // Not on a Wednesday.
  assert.equal(braveFrontDue(at("2026-10-28T16:30:00Z"), tz), false);
  // Daily ones: related 13:40 and 23:40, A/B 11:20 and 20:20.
  assert.equal(braveFrontDue(at("2026-10-28T13:37:00Z"), tz), true);
  assert.equal(braveFrontDue(at("2026-10-28T23:55:00Z"), tz), true);
  assert.equal(braveFrontDue(at("2026-10-28T23:56:00Z"), tz), false);
  assert.equal(braveFrontDue(at("2026-10-28T11:30:00Z"), tz), true);
  assert.equal(braveFrontDue(at("2026-10-28T20:17:00Z"), tz), true);
  assert.equal(braveFrontDue(at("2026-10-28T12:00:00Z"), tz), false);
  // The weekly poll, Saturday 07:40, in summer time too (07:40 BST is 06:40 UTC).
  assert.equal(braveFrontDue(at("2026-10-31T07:40:00Z"), tz), true);
  assert.equal(braveFrontDue(at("2026-10-30T07:40:00Z"), tz), false);
  assert.equal(braveFrontDue(at("2026-07-04T06:40:00Z"), tz), true);
  assert.equal(braveFrontDue(at("2026-07-04T07:40:00Z"), tz), false);
  // Repeats every 4 minutes inside the window.
  const now = at("2026-10-29T16:35:00Z");
  assert.equal(braveFrontDue(now, tz, now.getTime() - 2 * 60_000), false);
  assert.equal(braveFrontDue(now, tz, now.getTime() - 4 * 60_000), true);
  // A window that wraps the week: Saturday 23:58 is inside a Sunday 00:01 start.
  const sched = [{ task: "t", days: ["sun"], times: ["00:01"] }];
  assert.equal(
    braveFrontDue(at("2026-10-31T23:58:00Z"), tz, undefined, sched),
    true,
  );
  assert.equal(
    braveFrontDue(at("2026-10-31T23:57:00Z"), tz, undefined, sched),
    false,
  );
});

test("related plan: cut-downs link to their ranking, series to the same series, the rest to the hub", () => {
  const longs = [
    {
      id: "LONG0000001",
      title: "Every Mainline GTA Game, Ranked Worst to Best",
    },
    { id: "LONG0000002", title: "Call of Duty Campaigns Ranked" },
  ];
  const plan = planRelated(
    [
      {
        id: "a",
        lane: "news",
        youtube_video_id: "SHORT000001",
        live_at: null,
        script_json: { headline: "Call of Duty Black Ops leak" },
      },
      {
        id: "b",
        lane: "cutdown",
        youtube_video_id: "SHORT000002",
        live_at: null,
        script_json: {
          headline: "GTA IV",
          cutdown: { parent_video: "LONG0000001" },
        },
      },
      {
        id: "c",
        lane: "news",
        youtube_video_id: "SHORT000003",
        live_at: null,
        script_json: { headline: "Hollow Knight Silksong patch" },
      },
      {
        id: "d",
        lane: "longform",
        youtube_video_id: "LONG0000003",
        live_at: null,
        script_json: { runtime: "long" },
      },
    ],
    longs,
  );
  assert.deepEqual(
    plan.map((p) => [p.short, p.target, p.reason]),
    [
      ["SHORT000001", "LONG0000002", "same series"],
      ["SHORT000002", "LONG0000001", "cut from this ranking"],
      ["SHORT000003", "LONG0000001", "newest long video"],
    ],
  );
});

test("poll results: 2 to 5 named options with percentages", () => {
  assert.deepEqual(
    pollOptions(
      '{"options":[{"name":"Resident Evil","percent":54},{"name":"Halo","percent":46}]}',
    ),
    [
      { name: "Resident Evil", percent: 54 },
      { name: "Halo", percent: 46 },
    ],
  );
  assert.throws(() =>
    pollOptions('{"options":[{"name":"Halo","percent":100}]}'),
  );
  assert.throws(() =>
    pollOptions(
      '{"options":[{"name":"Halo","percent":101},{"name":"x","percent":0}]}',
    ),
  );
  assert.throws(() =>
    pollOptions(
      '{"options":[{"name":"","percent":1},{"name":"x","percent":0}]}',
    ),
  );
  assert.throws(() => pollOptions("not json"));
});

test("routine pages through the server: data, done records, poll result, and a 404 for the tunnel", async () => {
  const db = await testDb();
  const dir = await tmpDir();
  const cfg = testConfig(dir);
  clearRelatedCache();
  // A published Short and today's community post.
  await createEpisode(
    db,
    "ep1",
    clusterItems([
      item("Call of Duty Black Ops 7 leak", "Xbox Wire", "official"),
    ])[0]!,
  );
  await db.query(
    `UPDATE episodes SET status = 'published', youtube_video_id = 'SHORT000001', publish_at = now() - interval '1 hour', script_json = $1::jsonb WHERE id = 'ep1'`,
    [JSON.stringify({ headline: "Call of Duty Black Ops 7 leak" })],
  );
  await logEvent(db, null, "engage_post", {
    day: "2026-10-29",
    format: "question",
    question: "Best map?",
    caption: "Tell us",
    image: "C:/x.jpg",
  });
  fs.mkdirSync(path.join(dir, "abtests"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "abtests", "pending.json"),
    JSON.stringify([
      {
        videoId: "LONG0000001",
        titles: ["A", "B"],
        thumbs: [],
        publishAt: "2026-10-24T16:00:00Z",
      },
      {
        videoId: "LONG0000002",
        titles: ["C"],
        thumbs: [],
        publishAt: "2099-01-01T00:00:00Z",
      },
    ]),
  );
  let ytdlpCalls = 0;
  const ctx = {
    db,
    cfg,
    pollCandidates: async () => [],
    channelLongs: async () => (
      ytdlpCalls++,
      [{ id: "LONG0000002", title: "Call of Duty Campaigns Ranked" }]
    ),
    now: () => new Date("2026-10-29T16:40:00Z"),
  };
  // The handler on its own, as the server calls it.
  const direct = http.createServer(async (rq, rs) => {
    if (!(await handleRoutine(rq, rs, new URL(rq.url!, "http://local"), ctx)))
      rs.writeHead(404).end("Not found");
  });
  await new Promise<void>((r) => direct.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(direct.address() as AddressInfo).port}`;
  const get = async (p: string, headers: Record<string, string> = {}) => {
    const r = await fetch(`${base}${p}`, { headers });
    return {
      status: r.status,
      type: r.headers.get("content-type") ?? "",
      text: await r.text(),
    };
  };
  try {
    let r = await get("/routine/community");
    assert.equal(r.status, 200);
    assert.match(r.type, /^application\/json/);
    assert.match(r.text, /\n  "today": "2026-10-29"/, "pretty-printed");
    let j = JSON.parse(r.text);
    assert.equal(j.post.detail.question, "Best map?");
    assert.equal(j.done, false);
    assert.equal(
      (await get("/routine/done?kind=community&key=2026-10-29")).status,
      200,
    );
    assert.equal(JSON.parse((await get("/routine/community")).text).done, true);
    // Idempotent.
    j = JSON.parse(
      (await get("/routine/done?kind=community&key=2026-10-29")).text,
    );
    assert.deepEqual([j.added, j.already], [[], ["2026-10-29"]]);
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(dir, "admin", "community_done.json"), "utf8"),
      ),
      ["2026-10-29"],
    );

    j = JSON.parse((await get("/routine/related?max=15")).text);
    assert.deepEqual(
      j.items.map((x: { short: string; target: string }) => [
        x.short,
        x.target,
      ]),
      [["SHORT000001", "LONG0000002"]],
    );
    await get("/routine/done?kind=related&key=SHORT000001");
    j = JSON.parse((await get("/routine/related")).text);
    assert.equal(j.count, 0);
    assert.equal(ytdlpCalls, 1, "the channel page is read once per half hour");

    j = JSON.parse((await get("/routine/abtest")).text);
    assert.deepEqual(
      j.tests.map((t: { videoId: string; ready: boolean }) => [
        t.videoId,
        t.ready,
      ]),
      [
        ["LONG0000001", true],
        ["LONG0000002", false],
      ],
    );
    await get("/routine/done?kind=abtest&key=LONG0000001");
    assert.equal(
      JSON.parse((await get("/routine/abtest")).text).tests.length,
      1,
    );
    assert.equal(fs.existsSync(path.join(dir, "abtests", "done.json")), true);

    const k1 = encodeURIComponent("@Zoë|Great list & a fair #1");
    const k2 = encodeURIComponent("@bob|Yes");
    assert.equal(
      (await get(`/routine/done?kind=hearted&key=${k1}&key=${k2}`)).status,
      200,
    );
    assert.deepEqual(JSON.parse((await get("/routine/hearted")).text).hearted, [
      "@Zoë|Great list & a fair #1",
      "@bob|Yes",
    ]);

    // Bad kinds and keys write nothing.
    assert.equal(
      (await get("/routine/done?kind=x_posted&key=SHORT000001")).status,
      400,
    );
    assert.equal(
      (await get("/routine/done?kind=related&key=../../.env")).status,
      400,
    );
    assert.equal(
      (await get("/routine/done?kind=related&key=SHORT000002&key=bad")).status,
      400,
    );
    assert.equal((await get("/routine/done?kind=related")).status, 400);
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(dir, "admin", "related_done.json"), "utf8"),
      ),
      ["SHORT000001"],
    );

    j = JSON.parse((await get("/routine/poll")).text);
    assert.equal(j.done, false);
    assert.ok(Array.isArray(j.options));
    const data = encodeURIComponent(
      JSON.stringify({
        options: [
          { name: "Resident Evil", percent: 54 },
          { name: "Halo", percent: 46 },
        ],
      }),
    );
    j = JSON.parse((await get(`/routine/poll-result?data=${data}`)).text);
    assert.deepEqual([j.ok, j.unchanged], [true, false]);
    j = JSON.parse((await get(`/routine/poll-result?data=${data}`)).text);
    assert.deepEqual(
      [j.ok, j.unchanged],
      [true, true],
      "the same result twice is recorded once",
    );
    assert.equal((await readPoll(db))?.options[0]?.name, "Resident Evil");
    assert.equal((await get("/routine/poll-result?data=%7B%7D")).status, 400);
    await get("/routine/done?kind=poll&key=2026-10-29");
    assert.equal(JSON.parse((await get("/routine/poll")).text).done, true);

    // Refused requests look like any unknown page.
    for (const h of <Array<Record<string, string>>>[
      { "cf-ray": "abc" },
      { "cf-connecting-ip": "1.2.3.4" },
      { "cdn-loop": "cloudflare" },
      { "x-forwarded-for": "1.2.3.4" },
    ]) {
      r = await get("/routine/done?kind=related&key=SHORT000009", h);
      assert.deepEqual(
        [r.status, r.text],
        [404, "Not found"],
        JSON.stringify(h),
      );
    }
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(dir, "admin", "related_done.json"), "utf8"),
      ),
      ["SHORT000001"],
    );
    assert.equal((await get("/routine/nope")).status, 404);
  } finally {
    direct.close();
  }

  // Through the real app: the hook is in place and the tunnel gets the ordinary "Not found" page.
  const services = {
    db,
    cfg,
    notify: async () => undefined,
    discoverEvergreen: async () => [],
  } as unknown as Services;
  const server = http.createServer(
    (rq, rs) => void createApp(db, cfg, services, {})(rq, rs),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const app = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const ok = await fetch(`${app}/routine/hearted`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).hearted.length, 2);
    const tunnel = await fetch(`${app}/routine/hearted`, {
      headers: { "cf-ray": "abc", "cf-connecting-ip": "1.2.3.4" },
    });
    const unknown = await fetch(`${app}/no-such-page`);
    assert.equal(tunnel.status, 404);
    assert.equal(await tunnel.text(), await unknown.text());
  } finally {
    server.close();
  }
});
