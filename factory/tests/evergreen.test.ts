import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evergreenToScript,
  narrationOfEvergreen,
  validateEvergreen,
  type EvergreenScript,
} from "../src/editorial/evergreen.ts";
import { evergreenDue, weekday } from "../src/lanes.ts";
import { buildPlan, type PlanInput } from "../src/render/plan.ts";
import { narrationOf } from "../src/editorial/schema.ts";
import { FRANCHISE_SEEDS } from "../src/discovery/evergreen.ts";

function ranking(entries = 8): EvergreenScript {
  const names = [
    "Resident Evil 6",
    "Resident Evil 5",
    "Resident Evil 3",
    "Resident Evil Village",
    "Resident Evil 7",
    "Resident Evil 2",
    "Resident Evil 4",
    "Resident Evil Zero",
    "Code Veronica",
    "Resident Evil",
  ];
  return {
    format: "ranking",
    theme: "Resident Evil",
    title: "Ranking Every Resident Evil",
    hook: "Every mainline Resident Evil ranked by one thing only, how much it still scares you today.",
    entries: names.slice(0, entries).map((game_title, i) => ({
      rank: entries - i,
      game_title,
      steam_search_term: game_title,
      year: 2000 + i,
      platforms: "PC, PS5, Xbox",
      one_line: `${game_title} sold millions, yet its scares wore thin faster than the rest.`,
      verdict_chip: i === entries - 1 ? "STILL TERRIFYING" : "PLAY IT ONCE",
      footage: { want: "gameplay", keywords: ["mansion corridor"] },
    })),
    pulse_take: {
      label: "THE CRITERION",
      narration:
        "Number one still makes a dark hallway feel dangerous twenty years on, and nothing else on this list manages that.",
      on_screen: "Still scary after twenty years",
    },
    loop_line:
      "And that is every Resident Evil ranked by how much it still scares you.",
    youtube: {
      title: "Ranking EVERY Resident Evil game",
      description: "Every mainline Resident Evil ranked by fear.",
      tags: ["Resident Evil"],
    },
    claims: [
      { claim: "Resident Evil 4 released in 2005", source: "public knowledge" },
    ],
  };
}

test("an evergreen script validates, reads bottom-up and adapts to the common shape with one rank beat per entry", () => {
  const e = ranking();
  assert.deepEqual(validateEvergreen(e), []);
  const s = evergreenToScript(e);
  assert.equal(s.beats.length, 8);
  assert.equal(s.beats[0]!.visual.kind, "rank");
  assert.equal(
    s.beats[0]!.visual.value_a,
    8,
    "the first spoken entry is the lowest rank",
  );
  assert.equal(s.beats.at(-1)!.visual.value_a, 1);
  assert.equal(s.beats.at(-1)!.visual.primary, "Resident Evil Zero");
  assert.equal(s.beats.at(-1)!.visual.secondary, "STILL TERRIFYING");
  assert.deepEqual(s.beats[0]!.visual.items, ["2000", "PC, PS5, Xbox"]);
  assert.equal(s.entries?.length, 8);
  assert.equal(
    narrationOf(s),
    narrationOfEvergreen(e),
    "the adapted script speaks the same words",
  );
  assert.equal(s.hook_footage?.want, "gameplay");
});

test("the lane's house rules catch bad rankings", () => {
  const few = ranking(4);
  assert.ok(validateEvergreen(few).some((p) => p.includes("entries")));
  const gap = ranking();
  gap.entries[0]!.rank = 9;
  assert.ok(validateEvergreen(gap).some((p) => p.includes("Ranks must be")));
  const long = ranking();
  long.entries[1]!.one_line = "word ".repeat(25).trim();
  assert.ok(validateEvergreen(long).some((p) => p.includes("over 15 words")));
  const chip = ranking();
  chip.entries[2]!.verdict_chip = "far too many words for a chip";
  assert.ok(validateEvergreen(chip).some((p) => p.includes("verdict chip")));
});

test("evergreen is due only on its days, inside the lead window, once", () => {
  const plan = {
    days: ["tue", "thu", "sat"],
    slot: "19:00",
    leadMinutes: 120,
    graceMinutes: 30,
    timeZone: "Europe/London",
  };
  // 2026-10-17 is a Saturday; 19:00 BST = 18:00Z.
  assert.equal(
    weekday(new Date("2026-10-17T12:00:00Z"), "Europe/London"),
    "sat",
  );
  assert.equal(
    evergreenDue(new Date("2026-10-17T15:30:00Z"), plan, []),
    undefined,
    "not due before the lead window",
  );
  assert.equal(
    evergreenDue(new Date("2026-10-17T16:30:00Z"), plan, [])?.toISOString(),
    "2026-10-17T18:00:00.000Z",
  );
  assert.equal(
    evergreenDue(new Date("2026-10-17T16:30:00Z"), plan, [
      new Date("2026-10-17T18:00:00Z"),
    ]),
    undefined,
    "already claimed",
  );
  assert.equal(
    evergreenDue(new Date("2026-10-16T16:30:00Z"), plan, []),
    undefined,
    "Friday is not an evergreen day",
  );
  assert.equal(
    evergreenDue(new Date("2026-10-17T19:00:00Z"), plan, []),
    undefined,
    "missed by an hour: skipped",
  );
});

test("each entry's box art and clip land under that entry, never another's", () => {
  const s = evergreenToScript(ranking(6));
  let t = 0;
  const words: PlanInput["words"] = [];
  const segments: PlanInput["segments"] = [];
  const push = (
    kind: PlanInput["segments"][number]["kind"],
    text: string,
    visual?: PlanInput["segments"][number]["visual"],
  ) => {
    const start = t;
    for (const w of text.split(/\s+/)) {
      words.push({ text: w, start: t, end: t + 0.3 });
      t += 0.36;
    }
    segments.push({ kind, text, start, end: t, visual });
  };
  push("hook", s.hook);
  for (const b of s.beats) push("beat", b.narration, b.visual);
  push("take", s.pulse_take.narration, {
    kind: "title",
    primary: s.pulse_take.on_screen,
    secondary: "",
  });
  push("loop", s.loop_line);
  segments.at(-1)!.end = t + 1;
  const plan = buildPlan({
    segments,
    words,
    durationSeconds: t + 1,
    images: [
      { kind: "screenshot", aspect: 1.78 },
      ...s.beats.map((_, i) => ({
        kind: "capsule",
        aspect: 0.667,
        beatIndex: i,
      })),
      ...s.beats.map((_, i) => ({ kind: "hero", aspect: 3.1, beatIndex: i })),
    ],
    clips: s.beats.map((_, i) => ({
      durationSeconds: 4,
      motion: 0.5,
      beatIndex: i,
    })),
    storyType: "other",
    isRumour: false,
    attribution: "Source: Steam / Pulse",
    variant: 0,
    steam: null,
  });
  const beatSegs = segments
    .map((x, n) => ({ x, n }))
    .filter((y) => y.x.kind === "beat")
    .map((y) => y.n);
  for (const [b, segIndex] of beatSegs.entries()) {
    const shots = plan.shots.filter((sh) => sh.segment === segIndex);
    assert.ok(shots.length > 0);
    for (const sh of shots) {
      if (sh.media.type === "clip")
        assert.equal(sh.media.index, b, `clip under entry ${b} is its own`);
      if (sh.media.type === "image") {
        const img = [
          { kind: "screenshot", aspect: 1.78 },
          ...s.beats.map((_, i) => ({
            kind: "capsule",
            aspect: 0.667,
            beatIndex: i,
          })),
          ...s.beats.map((_, i) => ({
            kind: "hero",
            aspect: 3.1,
            beatIndex: i,
          })),
        ][sh.media.index]!;
        assert.ok(
          !("beatIndex" in img) || img.beatIndex === b,
          `art under entry ${b} is its own or untagged`,
        );
      }
    }
  }
  assert.ok(FRANCHISE_SEEDS.length >= 20);
});

test("a lead past a day reaches tomorrow's slot, and only on the plan's days", async () => {
  const { evergreenDue } = await import("../src/lanes.ts");
  // Long videos on Thursdays at 19:00 UK, 30 hours ahead (28 Oct 2026 is a Wednesday, UK on GMT).
  const plan = { days: ["thu"], slot: "19:00", leadMinutes: 30 * 60, graceMinutes: 30, timeZone: "Europe/London" };
  assert.equal(evergreenDue(new Date("2026-10-28T14:00:00Z"), plan, [])?.toISOString(), "2026-10-29T19:00:00.000Z", "29 hours ahead");
  assert.equal(evergreenDue(new Date("2026-10-28T12:00:00Z"), plan, []), undefined, "31 hours ahead is past the lead");
  assert.equal(evergreenDue(new Date("2026-10-28T14:00:00Z"), plan, [new Date("2026-10-29T19:00:00Z")]), undefined, "taken");
  assert.equal(evergreenDue(new Date("2026-10-28T14:00:00Z"), { ...plan, days: ["fri"] }, []), undefined, "Friday's slot is past the lead");
  // A short lead keeps today's behaviour.
  assert.equal(evergreenDue(new Date("2026-10-28T12:00:00Z"), { ...plan, days: ["wed", "thu"], leadMinutes: 120 }, []), undefined);
});
