// The Pulse watch's checks (src/handsoff/pulsewatch.ts): facts from the Mac and the PC in, faults out. Pure.
import test from "node:test";
import assert from "node:assert/strict";
import {
  alertFaults,
  allFaults,
  diskCheck,
  failedFaults,
  healthFaults,
  holdFaults,
  logFaults,
  longSlotFaults,
  macFactsFrom,
  missedSlotFaults,
  normaliseError,
  parseSections,
  pcFaults,
  portFaults,
  rendering,
  stuckFaults,
  type Episode,
  type LogLine,
  type MacFacts,
  type PcFacts,
  type SlotPlan,
} from "../src/handsoff/pulsewatch.ts";

const NOW = new Date("2026-11-25T15:30:00Z");
const ago = (min: number) =>
  new Date(NOW.getTime() - min * 60_000).toISOString();
const mac = (x: Partial<MacFacts> = {}): MacFacts => ({
  reachable: true,
  health: { ok: true, uploads_active: 0 },
  diskFreeGb: 50,
  log: [],
  lastLogAt: new Date(ago(2)),
  episodes: [],
  published: [],
  gateHeld: [],
  alerts: [],
  ports: [],
  procs: [],
  holdRestart: false,
  slotEnv: "",
  unknown: [],
  ...x,
});
const pc = (x: Partial<PcFacts> = {}): PcFacts => ({
  leases: [],
  waiting: [],
  watchdogFaults: [],
  taskRuns: [],
  ...x,
});
const plan = (
  slots: [string, string, number?][],
  dailyTarget = 5,
): SlotPlan => ({
  timezone: "Europe/London",
  dailyTarget,
  slots: slots.map(([lane, at, lead]) => ({ lane, at, lead: lead ?? 75 })),
});

test("the probe's sections parse into facts", () => {
  const text = [
    "@@health",
    '{"ok":true,"published_24h":"0","uploads_active":0}',
    "@@disk",
    "/dev/disk3s1s1       228   15        49    24%  408334 518705320    0%   /",
    "@@log",
    '{"t":"2026-11-25T14:10:42.832Z","level":"error","msg":"step failed","id":"ep_1","error":"boom"}',
    "not json",
    "@@lastlog",
    '{"t":"2026-11-25T15:28:00.000Z","level":"info","msg":"x"}',
    "@@episodes",
    '[{"id":"ep_1","lane":"news","status":"failed","created_at":"2026-11-25T14:00:00Z"}]',
    "@@ytguard",
    '{"until": 1795734114001}',
    "@@alerts",
    '{"at":1795617503,"channel":"alerts","text":"Picture checks paused"}',
    "@@ports",
    "10.77.0.1:8793 up",
    "127.0.0.1:8797 down",
    "@@procs",
    "123 node remotion render",
    "@@hold",
    "@@slotenv",
    "NEWS_SLOTS=17:00",
    "@@end",
  ].join("\n");
  const m = macFactsFrom(parseSections(text));
  assert.equal(m.reachable, true);
  assert.equal(m.health?.ok, true);
  assert.equal(m.diskFreeGb, 49);
  assert.equal(m.log.length, 1);
  assert.equal(m.lastLogAt?.toISOString(), "2026-11-25T15:28:00.000Z");
  assert.equal(m.episodes[0]?.status, "failed");
  assert.equal(m.ytBlockUntil, 1795734114001);
  assert.equal(m.alerts.length, 1);
  assert.deepEqual(m.ports, [
    { hostport: "10.77.0.1:8793", up: true },
    { hostport: "127.0.0.1:8797", up: false },
  ]);
  assert.equal(rendering(m.procs), true);
  assert.equal(m.holdRestart, false);
  assert.match(m.slotEnv, /NEWS_SLOTS/);
  // a cut-off probe (no @@end) is an unreachable Mac
  assert.equal(macFactsFrom(parseSections("@@health\n{}")).reachable, false);
});

test("an unreachable Mac or a silent factory is critical and needs two sightings", () => {
  const down = healthFaults(mac({ reachable: false }), NOW);
  assert.equal(down[0]?.severity, "critical");
  assert.equal(down[0]?.confirmRuns, 2);
  assert.deepEqual(healthFaults(mac(), NOW), []);
  const silent = healthFaults(mac({ lastLogAt: new Date(ago(45)) }), NOW);
  assert.deepEqual(
    silent.map((f) => f.key),
    ["factory-silent"],
  );
  const sick = healthFaults(mac({ health: { ok: false } }), NOW);
  assert.ok(sick.some((f) => f.key === "factory-health"));
});

test("disk: thin under 40 GB, a fault only under 25", () => {
  assert.deepEqual(diskCheck(50), { thin: false, fault: undefined });
  assert.equal(diskCheck(38).thin, true);
  assert.equal(diskCheck(38).fault, undefined);
  assert.equal(diskCheck(20).fault?.key, "mac-disk");
});

test("a slot with nothing published in the 90 minutes after it is missed; one with a video is not", () => {
  const p = plan([
    ["why", "2026-11-25T12:00:00.000Z"],
    ["news", "2026-11-25T13:00:00.000Z"],
    ["why", "2026-11-25T15:00:00.000Z"], // not 90 minutes old yet
  ]);
  const got = missedSlotFaults(
    p,
    [{ id: "a", lane: "news", live_at: "2026-11-25T13:00:00.000Z" }],
    NOW,
  );
  assert.deepEqual(
    got.map((f) => f.key),
    ["slot:why@2026-11-25T12:00:00.000Z"],
  );
});

test("one video fills one slot only, and breaking news does not fill a slot", () => {
  const p = plan([
    ["evergreen", "2026-11-25T12:00:00.000Z"],
    ["weekly", "2026-11-25T12:00:00.000Z"],
  ]);
  const got = missedSlotFaults(
    p,
    [
      { id: "a", lane: "news", live_at: "2026-11-25T12:00:00.000Z" },
      { id: "b", lane: "news_breaking", live_at: "2026-11-25T12:05:00.000Z" },
    ],
    NOW,
  );
  assert.equal(got.length, 1);
});

test("a Short slot is not owed once the day has its target of Shorts", () => {
  const p = plan([["why", "2026-11-25T13:00:00.000Z"]], 2);
  const vids = [
    { id: "a", lane: "news", live_at: "2026-11-25T09:00:00.000Z" },
    { id: "b", lane: "news", live_at: "2026-11-25T10:00:00.000Z" },
  ];
  assert.deepEqual(missedSlotFaults(p, vids, NOW), []);
});

test("a long slot needs a long video; slots older than 18 hours are left to the daily review", () => {
  const p = plan([
    ["documentary", "2026-11-25T12:00:00.000Z"],
    ["news", "2026-11-24T12:00:00.000Z"],
  ]);
  const got = missedSlotFaults(
    p,
    [{ id: "a", lane: "news", live_at: "2026-11-25T12:00:00.000Z" }],
    NOW,
  );
  assert.deepEqual(
    got.map((f) => f.key),
    ["slot:documentary@2026-11-25T12:00:00.000Z"],
  );
});

test("a long slot inside its lead time with no long episode being made is a fault", () => {
  const p = plan([["documentary", "2026-11-25T19:00:00.000Z", 600]]);
  assert.equal(longSlotFaults(p, [], [], NOW).length, 1);
  const making: Episode[] = [
    { id: "e", lane: "longform", status: "selected", created_at: ago(60) },
  ];
  assert.deepEqual(longSlotFaults(p, making, [], NOW), []);
  // far away (outside the lead time): not yet
  const later = plan([["longform", "2026-11-27T17:00:00.000Z", 495]]);
  assert.deepEqual(longSlotFaults(later, [], [], NOW), []);
});

const line = (min: number, x: Partial<LogLine>): LogLine => ({
  t: ago(min),
  level: "error",
  msg: "step failed",
  ...x,
});

test("the same technical error twice in three hours is a fault; content judgements are not", () => {
  const log = [
    line(100, {
      id: "ep_20261125_240bc777",
      error:
        "codex runner exit 1: RuntimeError: codex exec timed out after 1185 s",
    }),
    line(50, {
      id: "ep_20261125_87abc5a2",
      error:
        "codex runner exit 1: RuntimeError: codex exec timed out after 705 s",
    }),
    line(40, { id: "x", error: 'Fact-check: "a" - no source' }),
    line(30, { id: "y", error: 'Fact-check: "b" - no source' }),
  ];
  const got = logFaults(log, [], NOW);
  assert.equal(got.filter((f) => f.key.startsWith("err:")).length, 1);
  assert.match(got.find((f) => f.key.startsWith("err:"))!.what, /2 times/);
});

test("four step failures in 90 minutes is a spike", () => {
  const log = [1, 2, 3, 4].map((i) =>
    line(i * 10, { id: `e${i}`, error: `QA held: thing ${i}` }),
  );
  assert.ok(logFaults(log, [], NOW).some((f) => f.key === "step-failed-spike"));
  assert.ok(
    !logFaults(log.slice(0, 3), [], NOW).some(
      (f) => f.key === "step-failed-spike",
    ),
  );
});

test("a long episode failing twice is a fault even on a content judgement; the topic picker refusing is too", () => {
  const eps: Episode[] = [
    { id: "L", lane: "longform", status: "selected", created_at: ago(300) },
  ];
  const log = [
    line(200, { id: "L", error: "Fact-check: x" }),
    line(100, { id: "L", error: "Fact-check: y" }),
  ];
  assert.ok(logFaults(log, eps, NOW).some((f) => f.key === "longfail:L"));
  const refused = [{ t: ago(30), level: "info", msg: "long_topic_skipped" }];
  assert.ok(
    logFaults(refused, [], NOW).some((f) =>
      f.key.startsWith("long-topic-refused"),
    ),
  );
});

test("other error lines need three repeats; the Claude limit is a warning", () => {
  const e = (m: number) => ({
    t: ago(m),
    level: "error",
    msg: "growth report failed",
    error: "timeout 5000",
  });
  assert.equal(
    logFaults([e(1), e(2)], [], NOW).filter((f) => f.key.startsWith("logerr:"))
      .length,
    0,
  );
  assert.equal(
    logFaults([e(1), e(2), e(3)], [], NOW).filter((f) =>
      f.key.startsWith("logerr:"),
    ).length,
    1,
  );
  const lim = logFaults(
    [
      {
        t: ago(5),
        level: "warn",
        msg: "Claude refused on its usage limit; Codex answers until the hold ends",
      },
    ],
    [],
    NOW,
  );
  assert.deepEqual(
    lim.map((f) => [f.key, f.severity]),
    [["claude-limit", "warn"]],
  );
});

test("normaliseError makes repeats match", () => {
  assert.equal(
    normaliseError("timed out after 705 s on ep_20261125_87abc5a2"),
    normaliseError("timed out after 1185 s on ep_20261124_1989a6ca"),
  );
});

test("a technical failure is a fault; a content rejection is the checks working", () => {
  const eps: Episode[] = [
    {
      id: "a",
      lane: "news",
      status: "failed",
      created_at: ago(60),
      last_error: "render: ENOENT music.mp3",
    },
    {
      id: "b",
      lane: "news",
      status: "failed",
      created_at: ago(60),
      last_error: "QA failed: Frame 2 caption dark",
    },
    {
      id: "c",
      lane: "news",
      status: "failed",
      created_at: ago(60 * 20),
      last_error: "render: ENOENT",
    },
  ];
  assert.deepEqual(
    failedFaults(eps, NOW).map((f) => f.key),
    ["failed:a"],
  );
});

test("a Short still being made four hours after it was picked is stuck; a long video after ten hours in one status", () => {
  const eps: Episode[] = [
    {
      id: "s1",
      lane: "news_breaking",
      status: "voiced",
      created_at: ago(16 * 60),
    },
    { id: "s2", lane: "news", status: "scripted", created_at: ago(30) },
    { id: "L", lane: "longform", status: "selected", created_at: ago(3 * 60) },
    {
      id: "g",
      lane: "gameplay",
      status: "awaiting_approval",
      created_at: ago(30 * 60),
    },
  ];
  const first = stuckFaults(eps, {}, NOW);
  assert.deepEqual(
    first.faults.map((f) => f.key),
    ["stuck:s1:voiced"],
  );
  assert.ok(first.memory.L);
  const later = new Date(NOW.getTime() + 11 * 3600_000);
  const again = stuckFaults(eps, first.memory, later);
  assert.ok(again.faults.some((f) => f.key === "stuck:L:selected"));
  // a status change restarts the clock
  const moved = stuckFaults(
    [{ ...eps[2]!, status: "scripted" }],
    first.memory,
    later,
  );
  assert.deepEqual(moved.faults, []);
});

test("new factory alerts: faults, cleared ones skipped, owner-only ones marked", () => {
  const t = NOW.getTime() / 1000;
  const alerts = [
    {
      at: t - 3000,
      channel: "alerts",
      text: "⚠️ Picture checks paused: the PC vision relay is down",
    },
    {
      at: t - 2000,
      channel: "alerts",
      text: "⚠️ Picture checks back on: the PC vision relay is answering again",
    },
    {
      at: t - 1000,
      channel: "alerts",
      text: "Gave up on the 18:30 Short after three tries",
    },
    {
      at: t - 900,
      channel: "alerts",
      text: "YouTube download account needs signing in again on the Mac mini",
    },
    { at: t - 20000, channel: "alerts", text: "Old: QA failed" },
    {
      at: t - 100,
      channel: "alerts",
      text: "Demand check, Why Short at 12:00: fine",
    },
  ];
  const got = alertFaults(alerts, NOW);
  assert.equal(got.length, 2);
  assert.match(got[0]!.what, /Gave up/);
  assert.equal(got[0]!.ownerOnly, false);
  assert.equal(got[1]!.ownerOnly, true);
});

test("ports, holds and the PC side", () => {
  assert.deepEqual(
    portFaults([{ hostport: "10.77.0.1:8799", up: false }]).map((f) => [
      f.key,
      f.confirmRuns,
    ]),
    [["port:10.77.0.1:8799", 2]],
  );
  const h = holdFaults(
    mac({
      ytBlockUntil: NOW.getTime() + 3600_000,
      gateHeld: [
        { id: "L1", at: ago(60), status: "rendered", headline: "Doc" },
        { id: "L2", at: ago(60), status: "published" },
      ],
      holdRestart: true,
    }),
    NOW,
  );
  assert.deepEqual(
    h.map((f) => [f.key, f.severity]),
    [
      ["yt-block", "warn"],
      ["gate:L1", "fault"],
      ["hold-restart", "warn"],
    ],
  );
  const p = pcFaults(
    pc({
      leases: [
        {
          id: "a",
          job: "proof",
          project: "pulse",
          est_min: 8,
          granted: NOW.getTime() / 1000 - 60 * 60,
        },
        {
          id: "b",
          job: "fine",
          project: "pulse",
          est_min: 60,
          granted: NOW.getTime() / 1000 - 60 * 60,
        },
        {
          id: "c",
          job: "other",
          project: "orryy",
          est_min: 1,
          granted: NOW.getTime() / 1000 - 600 * 60,
        },
      ],
      watchdogFaults: [
        { key: "task:Pulse x", owner: "Pulse Gaming News", what: "failed" },
        { key: "task:Orryy", owner: "Master orchestrator", what: "failed" },
      ],
      watchdogAt: ago(10),
      codexHold: "runner hold",
    }),
    NOW,
  );
  assert.deepEqual(
    p.map((f) => f.key),
    ["orch-overrun:a", "pc:task:Pulse x", "codex-hold"],
  );
});

test("an unreachable Mac skips every Mac check but keeps the PC ones", () => {
  const got = allFaults(
    mac({ reachable: false }),
    pc({ codexHold: "hold" }),
    undefined,
    {},
    NOW,
  );
  assert.deepEqual(
    got.faults.map((f) => f.key),
    ["mac-unreachable", "codex-hold"],
  );
});

test("a Pulse orchestrator job that failed in the last two hours is a fault; old or other projects' are not", () => {
  const t = NOW.getTime() / 1000;
  const got = pcFaults(
    pc({
      orchHistory: [
        {
          id: "a",
          job: "proof",
          project: "pulse",
          outcome: "failed",
          end: t - 600,
        },
        {
          id: "b",
          job: "old",
          project: "pulse",
          outcome: "failed",
          end: t - 3 * 3600,
        },
        {
          id: "c",
          job: "fine",
          project: "pulse",
          outcome: "done",
          end: t - 60,
        },
        {
          id: "d",
          job: "theirs",
          project: "orryy",
          outcome: "expired",
          end: t - 60,
        },
      ],
    }),
    NOW,
  );
  assert.deepEqual(
    got.map((f) => f.key),
    ["orchfail:a"],
  );
});

test("a long last log line still gives its time; a failed admin page is unknown, not empty", () => {
  const long = '"t":"2026-11-25T15:28:00.000Z"';
  const m = macFactsFrom(
    parseSections(
      [
        "@@lastlog",
        long,
        "@@episodes",
        "null",
        "@@published",
        "[]",
        "@@gateheld",
        "null",
        "@@end",
      ].join("\n"),
    ),
  );
  assert.equal(m.lastLogAt?.toISOString(), "2026-11-25T15:28:00.000Z");
  assert.deepEqual(m.unknown, ["episodes", "gateheld"]);
  const p = plan([["why", "2026-11-25T12:00:00.000Z"]]);
  const got = allFaults(
    { ...mac(), unknown: ["published"] },
    pc(),
    p,
    { kept: { status: "selected", since: ago(60) } },
    NOW,
  );
  assert.ok(got.faults.some((f) => f.key === "admin-api"));
  assert.ok(!got.faults.some((f) => f.key.startsWith("slot:")));
  const eps = allFaults(
    { ...mac(), unknown: ["episodes"] },
    pc(),
    p,
    { kept: { status: "selected", since: ago(60) } },
    NOW,
  );
  assert.ok(eps.memory.kept, "the stuck clock keeps its memory");
});

test("an approved Short waiting for its slot or a gap is not stuck", () => {
  const got = stuckFaults(
    [
      {
        id: "spare",
        lane: "news",
        status: "approved",
        created_at: ago(10 * 60),
      },
    ],
    {},
    NOW,
  );
  assert.deepEqual(got.faults, []);
});

test("digests are not alerts", () => {
  const t = NOW.getTime() / 1000;
  const got = alertFaults(
    [
      {
        at: t - 60,
        channel: "alerts:digest",
        text: "3 Shorts failed QA this week",
      },
      {
        at: t - 60,
        channel: "alerts",
        text: "📋 Alert digest: 4 failed, 2 paused",
      },
    ],
    NOW,
  );
  assert.deepEqual(got, []);
});

test("nothing published in 24 hours is a fault from 14:00 UK, not in the morning", () => {
  const dry = mac({ health: { ok: true, published_24h: "0", in_flight: 6 } });
  assert.ok(healthFaults(dry, NOW).some((f) => f.key === "nothing-published-24h"));
  assert.ok(!healthFaults(dry, new Date("2026-11-25T09:00:00Z")).some((f) => f.key === "nothing-published-24h"));
  assert.ok(!healthFaults(mac({ health: { ok: true, published_24h: "3" } }), NOW).some((f) => f.key === "nothing-published-24h"));
});
