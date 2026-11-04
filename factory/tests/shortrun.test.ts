import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  docRunDue,
  readRun,
  runRepeatGame,
  whyRunEntry,
  type RunEntry,
} from "../src/shortrun.ts";
import { repetitionProblems } from "../src/authenticity.ts";
import { localTime } from "../src/lanes.ts";
import { tmpDir } from "./helpers.ts";

const WHY: RunEntry = {
  kind: "why",
  date: "2026-11-10",
  slot: "12:00",
  question: "Why does GTA 6 need 212 GB?",
  title: "Why GTA 6 Needs 212 GB",
  game: "Grand Theft Auto VI",
  arc: "a",
  angle: "b",
  sources: [{ url: "https://example.com/a", source: "Rockstar", official: true }],
};
const DOC: RunEntry = {
  kind: "doc",
  date: "2026-11-13",
  slot: "20:00",
  make_hours_before: 44,
  title: "The guide",
  franchise: "Grand Theft Auto VI",
  wiki: "Grand Theft Auto VI",
  angle: "c",
};

test("a Why slot finds its planned topic by date and slot; other slots find none", () => {
  const tz = "Europe/London";
  assert.equal(whyRunEntry([WHY, DOC], localTime("2026-11-10", "12:00", tz), tz), WHY);
  assert.equal(whyRunEntry([WHY, DOC], localTime("2026-11-10", "18:30", tz), tz), undefined);
  assert.equal(whyRunEntry([], localTime("2026-11-10", "12:00", tz), tz), undefined);
});

test("a planned documentary opens its window ahead of the slot, once", () => {
  const tz = "Europe/London";
  const at = localTime("2026-11-13", "20:00", tz);
  const before = new Date(at.getTime() - 45 * 3600_000);
  const inside = new Date(at.getTime() - 43 * 3600_000);
  assert.equal(docRunDue([DOC], before, [], tz), undefined);
  const due = docRunDue([DOC], inside, [], tz)!;
  assert.equal(due.at.getTime(), at.getTime());
  assert.equal(due.topic.franchise, "Grand Theft Auto VI");
  assert.equal(due.topic.angle, "c");
  assert.equal(docRunDue([DOC], inside, [at], tz), undefined, "already made");
  assert.equal(docRunDue([DOC], new Date(at.getTime() + 1000), [], tz), undefined);
});

test("a run file that is missing or broken means no run; a good one parses", async () => {
  const dir = await tmpDir();
  assert.deepEqual(readRun(""), []);
  assert.deepEqual(readRun(path.join(dir, "none.json")), []);
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, '[{"kind":"why"}]');
  assert.deepEqual(readRun(bad), []);
  const good = path.join(dir, "good.json");
  fs.writeFileSync(good, JSON.stringify([WHY, DOC]));
  assert.equal(readRun(good).length, 2);
});

test("the shipped launch run parses, every slot is a real slot and no question repeats", () => {
  const run = readRun(path.join(import.meta.dirname, "..", "launch_run.json"));
  assert.ok(run.length >= 20);
  const seen = new Set<string>();
  for (const e of run) {
    if (e.kind !== "why") continue;
    assert.ok(["12:00", "18:30"].includes(e.slot), e.question);
    assert.ok(!seen.has(`${e.date} ${e.slot}`), `${e.date} ${e.slot} used twice`);
    seen.add(`${e.date} ${e.slot}`);
    assert.ok(!seen.has(e.question), e.question);
    seen.add(e.question);
    assert.ok(e.sources.length >= 1);
    assert.doesNotMatch(`${e.question} ${e.title} ${e.angle} ${e.arc}`, /\u2014/, "no em dashes");
  }
});

test("the repeat guard lets a run say GTA 6 every day and still catches a template", () => {
  const recent = ["GTA 6 Pre-Loads Start Now", "GTA 6 Needs 212GB", "GTA 6 Is Coming Soon"].map((title) => ({
    title,
    hook: "Here is a fresh hook",
    game: "Grand Theft Auto VI",
  }));
  const draft = {
    title: "GTA 6 Is Coming Tomorrow",
    hook: "Another fresh one",
    game: runRepeatGame("Grand Theft Auto VI", true),
  };
  assert.deepEqual(repetitionProblems(draft, recent, 3), []);
  assert.equal(runRepeatGame("Grand Theft Auto VI"), "Grand Theft Auto VI");
  const template = ["Before You Play GTA 6 Today", "Before You Play GTA 6 Soon", "Before You Play GTA 6 Now"].map((title) => ({
    title,
    hook: "x y z",
    game: "Grand Theft Auto VI",
  }));
  const again = { title: "Before You Play GTA 6 Tonight", hook: "a b c", game: runRepeatGame("Grand Theft Auto VI", true) };
  assert.equal(repetitionProblems(again, template, 3).length, 1, "before you play is still caught");
});
