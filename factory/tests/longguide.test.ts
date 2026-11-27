import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_GUIDE_FILE,
  GuidePlanSchema,
  applyGuideFrame,
  guideDueFor,
  guideFrameProblems,
  guideNotReady,
  guideSourceText,
  guideThumb,
  guideTitle,
  guideWeekDue,
  isWeeklyGuide,
  readGuidePlan,
  type GuidePlan,
} from "../src/longguide.ts";
import { localTime } from "../src/lanes.ts";
import { loadConfig } from "../src/config.ts";
import os from "node:os";

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "longguide-"));

const tz = "Europe/London";
const notes = [
  "TinoTV 19 Nov stream: the car wash pays $300 a run",
  "TinoTV 19 Nov stream: a stolen sports car sells for $1,200 at the docks",
  "TinoTV 20 Nov stream: the first safehouse has a free wardrobe",
];

const plan = (over: Partial<GuidePlan> = {}): GuidePlan =>
  GuidePlanSchema.parse({
    game: "Grand Theft Auto VI",
    short: "GTA 6",
    wiki: "Grand Theft Auto VI",
    first: "2026-11-29",
    slot: "17:00",
    make_hours_before: 30,
    guides: [
      {
        key: "early-money",
        on: true,
        guide: "Best Early Money",
        thumb: "EARLY MONEY",
        angle: "The fastest honest ways to build money early.",
        play_notes: notes,
      },
      {
        key: "beginner-mistakes",
        on: true,
        guide: "Beginner Mistakes to Avoid",
        angle: "The mistakes that cost new players money early.",
        play_notes: notes,
      },
    ],
    ...over,
  });

test("guide title: one fixed frame, the game first, a statement under 60 characters", () => {
  const p = plan();
  assert.equal(
    guideTitle(p, p.guides[0]!),
    "GTA 6 Best Early Money, Learned From Real Play",
  );
  assert.deepEqual(guideFrameProblems(p, p.guides[0]!), []);
  assert.deepEqual(guideFrameProblems(p, p.guides[1]!), []);
  const bad = { ...p.guides[0]!, guide: "Top 10 Money Tricks in 2026?" };
  const problems = guideFrameProblems(p, bad);
  assert.ok(problems.some((x) => /year/.test(x)));
  assert.ok(problems.some((x) => /question/.test(x)));
  assert.equal(
    guideThumb({ thumb: "the best early money now" }),
    "THE BEST EARLY MONEY",
  );
});

test("weekly guide: due only inside its making window, the first ready guide not yet made", () => {
  const p = plan();
  const at = localTime("2026-11-29", "17:00", tz);
  const before = new Date(at.getTime() - 31 * 3_600_000);
  const inside = new Date(at.getTime() - 29 * 3_600_000);
  assert.equal(guideWeekDue(p, true, before, [], [], tz).due, undefined);
  assert.equal(
    guideWeekDue(p, false, inside, [], [], tz).due,
    undefined,
    "off by default",
  );
  const due = guideWeekDue(p, true, inside, [], [], tz).due!;
  assert.equal(due.at.getTime(), at.getTime());
  assert.equal(due.entry.key, "early-money");
  assert.equal(due.topic.format, "guide");
  assert.equal(
    due.topic.guide?.title,
    "GTA 6 Best Early Money, Learned From Real Play",
  );
  assert.equal(due.run.date, "2026-11-29");
  // Made already: the next guide; the slot taken: nothing.
  assert.equal(
    guideWeekDue(p, true, inside, [], ["early-money"], tz).due?.entry.key,
    "beginner-mistakes",
  );
  assert.equal(guideWeekDue(p, true, inside, [at], [], tz).due, undefined);
  // A week on, same hour.
  const next = localTime("2026-12-06", "17:00", tz);
  const due2 = guideWeekDue(
    p,
    true,
    new Date(next.getTime() - 3_600_000),
    [],
    ["early-money"],
    tz,
  ).due!;
  assert.equal(due2.at.getTime(), next.getTime());
  assert.equal(due2.week, 1);
});

test("weekly guide: waits for real play, its own switch and its date, and says why", () => {
  const at = localTime("2026-11-29", "17:00", tz);
  const inside = new Date(at.getTime() - 3_600_000);
  const p = plan({
    guides: [
      {
        key: "a-guide",
        on: true,
        guide: "Best Early Money",
        angle: "The fastest honest ways to build money early.",
        play_notes: notes.slice(0, 1),
        thumb: "",
      },
      {
        key: "b-guide",
        on: false,
        guide: "Beginner Mistakes to Avoid",
        angle: "The mistakes that cost new players money early.",
        play_notes: notes,
        thumb: "",
      },
      {
        key: "c-guide",
        on: true,
        guide: "Hidden Spots Worth Finding",
        angle: "Places worth a detour in the early game.",
        play_notes: notes,
        not_before: "2026-12-06",
        thumb: "",
      },
    ],
  });
  const r = guideWeekDue(p, true, inside, [], [], tz);
  assert.equal(r.due, undefined);
  assert.equal(r.waiting.length, 2, "a guide that is off is not reported");
  assert.match(
    r.waiting[0]!,
    /1 play note or tests from the owner's play, 3 needed/,
  );
  assert.match(r.waiting[1]!, /not before 2026-12-06/);
  // Tests count as real play.
  const withTests = {
    ...p.guides[0]!,
    evidence: [
      { clip: "gp_1", claim: "x" },
      { clip: "gp_2", claim: "y" },
    ],
  };
  assert.equal(guideNotReady(p, withTests, at, tz), undefined);
});

test("guide sources: the confirmed part of the facts file and the owner's play notes, under outlet headers", () => {
  const dir = tmpDir();
  const facts = path.join(dir, "facts.md");
  fs.writeFileSync(
    facts,
    "# Facts\n\n## Confirmed\n- Release 19 Nov\n\n## Reported, label if used\n- PC in 2027\n",
  );
  const due = guideDueFor(
    { ...plan(), facts_file: facts },
    plan().guides[0]!,
    new Date(),
    0,
  );
  const src = guideSourceText(due.topic.guide!);
  assert.match(src.text, /Release 19 Nov/);
  assert.doesNotMatch(src.text, /PC in 2027/, "reported lines stay out");
  assert.match(src.text, /\[Pulse's own play\]/);
  assert.match(src.text, /car wash pays \$300/);
  assert.deepEqual(src.missed, []);
  assert.deepEqual(
    guideSourceText({
      ...due.topic.guide!,
      facts_file: path.join(dir, "none.md"),
    }).missed.length,
    1,
  );
  // The angle keeps the guide to the story's opening.
  assert.match(due.topic.angle, /no late missions/);
});

test("guide frame: the written video keeps the fixed title and thumbnail words", () => {
  const due = guideDueFor(plan(), plan().guides[0]!, new Date(), 0);
  const script = {
    youtube: {
      title: "Some Model Title",
      title_variants: ["a", "b"],
      thumb_text: "X",
    },
  };
  applyGuideFrame(script, due.topic.guide!);
  assert.equal(
    script.youtube.title,
    "GTA 6 Best Early Money, Learned From Real Play",
  );
  assert.deepEqual(script.youtube.title_variants, []);
  assert.equal(script.youtube.thumb_text, "EARLY MONEY");
  assert.equal(isWeeklyGuide({ doc: true, topic: due.topic }), true);
  assert.equal(
    isWeeklyGuide({ doc: true, topic: { ...due.topic, guide: undefined } }),
    false,
  );
  assert.equal(isWeeklyGuide(null), false);
});

test("guide plan: the shipped plan reads, every guide is off and its frame holds; the facts file resolves beside it", () => {
  const p = readGuidePlan("")!;
  assert.ok(p, `${DEFAULT_GUIDE_FILE} reads`);
  assert.equal(p.game, "Grand Theft Auto VI");
  assert.ok(p.guides.length >= 3);
  for (const g of p.guides) {
    assert.notEqual(g.on, true, `${g.key} ships off`);
    assert.deepEqual(guideFrameProblems(p, g), [], g.key);
  }
  assert.ok(path.isAbsolute(p.facts_file!));
  assert.ok(fs.existsSync(p.facts_file!), "the facts file ships with the plan");
  assert.equal(readGuidePlan(path.join(tmpDir(), "missing.json")), undefined);
});

test("guide and funnel settings: all off by default", () => {
  const cfg = loadConfig();
  assert.equal(cfg.guideWeekly, false);
  assert.equal(cfg.funnelTest, false);
  assert.equal(cfg.guideOwnFirst, true);
  assert.equal(cfg.funnelShare, 0.5);
  assert.equal(cfg.funnelShorts, 3);
  assert.equal(cfg.funnelDays, 3);
});
