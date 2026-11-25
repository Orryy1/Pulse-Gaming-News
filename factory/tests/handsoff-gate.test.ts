// The hands-off gate (src/handsoff/gate.ts): when a fault starts a Claude session and when it does not. Pure.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_POLICY,
  buildPrompt,
  claudeArgs,
  decide,
  emptyState,
  inboxTitle,
  localDay,
  nextInboxNumber,
  skillBody,
  writeInboxItem,
  type Fault,
  type GateState,
} from "../src/handsoff/gate.ts";

const P = DEFAULT_POLICY;
const at = (iso: string) => new Date(iso);
const f = (key: string, extra: Partial<Fault> = {}): Fault => ({
  key,
  severity: "fault",
  what: key,
  ...extra,
});
const live = { running: false, shadow: false };

function runs(
  faultsPerRun: Fault[][],
  start = "2026-11-25T10:00:00Z",
  stepMin = 15,
  ctx = live,
) {
  let s: GateState = emptyState();
  const out = [];
  for (let i = 0; i < faultsPerRun.length; i++) {
    const d = decide(
      s,
      faultsPerRun[i]!,
      new Date(Date.parse(start) + i * stepMin * 60_000),
      P,
      ctx,
    );
    s = d.state;
    out.push(d);
  }
  return out;
}

test("a healthy run starts nothing", () => {
  const d = decide(emptyState(), [], at("2026-11-25T10:00:00Z"), P, live);
  assert.equal(d.launch, false);
  assert.equal(d.reason, "healthy");
});

test("warnings and information never start a session", () => {
  const d = decide(
    emptyState(),
    [f("yt", { severity: "warn" }), f("i", { severity: "info" })],
    at("2026-11-25T10:00:00Z"),
    P,
    live,
  );
  assert.equal(d.launch, false);
});

test("a new fault starts one session; the same fault next run does not", () => {
  const [a, b] = runs([[f("x")], [f("x")]]);
  assert.equal(a!.launch, true);
  assert.deepEqual(a!.launchKeys, ["x"]);
  assert.equal(b!.launch, false);
  assert.match(b!.reason, /already went/);
});

test("a fault still there past the relaunch time starts a second session, then no more", () => {
  const ds = runs(Array.from({ length: 30 }, () => [f("x")]));
  const launches = ds.filter((d) => d.launch).length;
  assert.equal(launches, P.maxLaunchesPerFault);
  assert.ok(ds.some((d) => d.exhausted.includes("x")));
  const second = ds.findIndex((d, i) => i > 0 && d.launch);
  assert.equal(second * 15 >= P.relaunchAfterMin, true);
});

test("confirmRuns waits for a second sighting (one failed ssh is not an outage)", () => {
  const [a, b] = runs([
    [f("mac", { severity: "critical", confirmRuns: 2 })],
    [f("mac", { severity: "critical", confirmRuns: 2 })],
  ]);
  assert.equal(a!.launch, false);
  assert.equal(b!.launch, true);
});

test("a blip that clears is never launched", () => {
  const ds = runs([
    [f("mac", { confirmRuns: 2 })],
    [],
    [f("mac", { confirmRuns: 2 })],
    [],
  ]);
  assert.equal(
    ds.some((d) => d.launch),
    false,
  );
});

test("a fault that flaps back within the window is not new again", () => {
  const ds = runs([[f("x")], [], [f("x")]]);
  assert.equal(ds[0]!.launch, true);
  assert.deepEqual(ds[1]!.resolvedKeys, ["x"]);
  assert.equal(ds[2]!.launch, false);
  assert.deepEqual(ds[2]!.newKeys, []);
});

test("nothing launches while our last session still runs", () => {
  const d = decide(emptyState(), [f("x")], at("2026-11-25T10:00:00Z"), P, {
    running: true,
    shadow: false,
  });
  assert.equal(d.launch, false);
  assert.match(d.reason, /still running/);
  // and the fault stays eligible for the next run
  const e = decide(d.state, [f("x")], at("2026-11-25T10:15:00Z"), P, live);
  assert.equal(e.launch, true);
});

test("two launches are at least minGapMin apart", () => {
  const [a, b, c] = runs(
    [[f("x")], [f("x"), f("y")], [f("x"), f("y")]],
    "2026-11-25T10:00:00Z",
    15,
  );
  assert.equal(a!.launch, true);
  assert.equal(b!.launch, false);
  assert.match(b!.reason, /too soon/);
  assert.equal(c!.launch, true);
  assert.deepEqual(c!.launchKeys, ["y"]);
});

test("the daily cap holds, and resets on the next UK day", () => {
  let s = emptyState();
  let n = 0;
  for (let i = 0; i < 20; i++) {
    const d = decide(
      s,
      [f(`k${i}`)],
      new Date(Date.parse("2026-11-25T08:00:00Z") + i * 31 * 60_000),
      P,
      live,
    );
    s = d.state;
    if (d.launch) n++;
  }
  assert.equal(n, P.maxLaunchesPerDay);
  const next = decide(s, [f("tomorrow")], at("2026-11-26T08:00:00Z"), P, live);
  assert.equal(next.launch, true);
});

test("shadow launches are counted apart from real ones", () => {
  let s = emptyState();
  for (let i = 0; i < P.maxLaunchesPerDay; i++)
    s = decide(
      s,
      [f(`k${i}`)],
      new Date(Date.parse("2026-11-25T08:00:00Z") + i * 31 * 60_000),
      P,
      { running: false, shadow: true },
    ).state;
  const real = decide(s, [f("real")], at("2026-11-25T20:00:00Z"), P, live);
  assert.equal(real.launch, true);
});

test("with Claude's week above the line, only critical faults launch", () => {
  const ctx = { running: false, shadow: false, budgetPct: 93 };
  const plain = decide(
    emptyState(),
    [f("x")],
    at("2026-11-25T10:00:00Z"),
    P,
    ctx,
  );
  assert.equal(plain.launch, false);
  assert.match(plain.reason, /93%/);
  const crit = decide(
    emptyState(),
    [f("x"), f("down", { severity: "critical" })],
    at("2026-11-25T10:00:00Z"),
    P,
    ctx,
  );
  assert.equal(crit.launch, true);
  assert.deepEqual(crit.launchKeys, ["down"]);
});

test("owner-only faults go to the inbox once and never start a session", () => {
  const [a, b] = runs([
    [f("signin", { ownerOnly: true })],
    [f("signin", { ownerOnly: true })],
  ]);
  assert.equal(a!.launch, false);
  assert.equal(a!.inbox.length, 1);
  assert.equal(b!.inbox.length, 0);
});

test("the cap counts in the UK day", () => {
  assert.equal(
    localDay(at("2026-11-25T23:30:00Z"), "Europe/London"),
    "2026-11-25",
  );
  assert.equal(
    localDay(at("2026-07-01T23:30:00Z"), "Europe/London"),
    "2026-07-02",
  );
});

test("the prompt names only the chosen faults, keeps the rules and stays under the limit", () => {
  const p = buildPrompt({
    project: "Pulse",
    faults: [
      f("a", { what: "Slot missed at 12:00", detail: "nothing published" }),
    ],
    others: [f("b", { what: "Old fault" })],
    rules: "RULE ONE\n" + "x".repeat(50_000),
    inboxDir: "C:\\inbox",
    reportFile: "C:\\r.md",
  });
  assert.match(p, /1\. \[fault\] Slot missed at 12:00/);
  assert.match(p, /Evidence: nothing published/);
  assert.match(p, /- Old fault/);
  assert.match(p, /RULE ONE/);
  assert.match(p, /rules cut for length/);
  assert.ok(p.length < 25_000);
});

test("claude is started headless in auto mode, never with permissions bypassed", () => {
  const a = claudeArgs({ prompt: "hi", model: "opus" });
  assert.deepEqual(a.slice(0, 4), ["-p", "hi", "--permission-mode", "auto"]);
  assert.ok(!a.join(" ").includes("bypass"));
});

test("skillBody drops the front matter", () => {
  assert.equal(skillBody("---\nname: x\n---\nbody\n"), "body");
});

test("inbox items get the next number, a safe title, and are never written twice", () => {
  assert.equal(
    nextInboxNumber([
      "11 PC - a.md",
      "29 Pulse - b.md",
      "Done",
      "00 START HERE.html",
    ]),
    30,
  );
  assert.equal(
    inboxTitle("Pulse", 'sign in: "Brave"/Studio\nnow'),
    "Pulse - sign in Brave Studio now",
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-"));
  fs.mkdirSync(path.join(dir, "Done"));
  fs.writeFileSync(path.join(dir, "Done", "4 Old - thing.cmd"), "");
  const one = writeInboxItem(dir, "Pulse", "Sign in again on the Mac", "body");
  assert.equal(path.basename(one), "5 Pulse - Sign in again on the Mac.md");
  assert.equal(
    writeInboxItem(dir, "Pulse", "Sign in again on the Mac", "body"),
    "",
  );
  assert.equal(
    writeInboxItem(path.join(dir, "missing"), "Pulse", "x", "y"),
    "",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
