import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testConfig, goodScript } from "./helpers.ts";
import {
  aboutFranchise,
  franchiseClip,
  gtaFileBrief,
  gtaFileEntry,
  gtaFileFrom,
  gtaFileProblem,
  gtaFileProblems,
  gtaFileRunProblems,
  gtaFileSummary,
  gtaFileTitle,
  isGtaFileSlot,
  openOnOwnClip,
  serialOf,
  GTA_FILE_ALIASES,
} from "../src/gtafile.ts";
import { readRun, whyRunEntry, type RunEntry } from "../src/shortrun.ts";
import { redactedConfig } from "../src/config.ts";
import { seriesFor } from "../src/pipeline.ts";

const on = {
  seriesGtaFileEnabled: true,
  seriesGtaFileSlot: "18:30",
  seriesGtaFileRunFile: "gta_file_run.json",
  whySlots: ["12:00", "18:30"],
  whyEnabled: true,
};
const RUN_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "gta_file_run.json",
);

test("The GTA File is off by default, and off with a reason when switched on wrongly", () => {
  const cfg = testConfig("/tmp/x");
  assert.equal(gtaFileFrom(cfg), undefined);
  assert.equal(gtaFileProblem(cfg), undefined, "never asked for: no complaint");
  assert.equal(gtaFileSummary(cfg), "off");
  assert.equal(redactedConfig(cfg).gtaFile, "off");
  assert.match(
    gtaFileSummary({ ...on, seriesGtaFileRunFile: "" }),
    /^off: SERIES_GTA_FILE_RUN_FILE is empty/,
  );
  assert.match(
    gtaFileProblem({ ...on, whyEnabled: false })!,
    /WHY_ENABLED is off/,
  );
});

test("The GTA File never adds a slot: its slot has to be one of the Why slots already", () => {
  assert.deepEqual(gtaFileFrom(on), {
    name: "The GTA File",
    slot: "18:30",
    franchise: "GTA VI",
    aliases: GTA_FILE_ALIASES,
    runFile: "gta_file_run.json",
  });
  assert.equal(
    gtaFileSummary(on),
    '"The GTA File" at 18:30 from gta_file_run.json',
  );
  const extra = { ...on, seriesGtaFileSlot: "20:00" };
  assert.equal(gtaFileFrom(extra), undefined);
  assert.match(gtaFileProblem(extra)!, /not one of WHY_SLOTS \(12:00,18:30\)/);
  assert.match(
    gtaFileProblem({ ...on, seriesGtaFileSlot: "6pm" })!,
    /not HH:MM/,
  );
});

test("the slot is matched on local wall-clock time, and the part on its date", () => {
  const f = gtaFileFrom(on)!;
  assert.equal(
    isGtaFileSlot(f, new Date("2026-11-22T18:30:00Z"), "Europe/London"),
    true,
  );
  assert.equal(
    isGtaFileSlot(f, new Date("2026-11-22T12:00:00Z"), "Europe/London"),
    false,
  );
  const run = readRun(RUN_FILE);
  const part = gtaFileEntry(
    run,
    new Date("2026-11-23T18:30:00Z"),
    f,
    "Europe/London",
  );
  assert.equal(part?.part, 2);
  assert.equal(
    gtaFileEntry(run, new Date("2026-11-23T12:00:00Z"), f, "Europe/London"),
    undefined,
    "the Why slot at noon is not the GTA File's",
  );
  assert.equal(
    whyRunEntry(run, new Date("2026-11-23T18:30:00Z"), "Europe/London"),
    undefined,
    "a GTA File part is never read as a planned Why",
  );
});

test("the planned run: parts 1 to 7 from 22 Nov, official sources, a callback each, no leaks", () => {
  const run = readRun(RUN_FILE);
  const parts = run.filter((e) => e.kind === "file");
  assert.equal(parts.length, 7);
  assert.deepEqual(
    parts.map((p) => (p.kind === "file" ? [p.part, p.date] : [])),
    [
      [1, "2026-11-22"],
      [2, "2026-11-23"],
      [3, "2026-11-24"],
      [4, "2026-11-25"],
      [5, "2026-11-26"],
      [6, "2026-11-27"],
      [7, "2026-11-28"],
    ],
  );
  assert.deepEqual(gtaFileRunProblems(run), []);
  const text = JSON.stringify(run);
  assert.ok(!/[—–]/.test(text), "no em or en dashes");
  assert.doesNotMatch(text, /Q1 2027/, "the PC report is not used as a fact");
});

test("a broken plan is named: a doubled part, no official source, no callback, a leak, dates out of order", () => {
  const part = (o: Record<string, unknown>) =>
    ({
      kind: "file",
      part: 1,
      date: "2026-11-22",
      title: "t",
      question: "q",
      angle: "a",
      recap: "",
      facts: ["f"],
      sources: [
        { url: "https://x.test/a", source: "Rockstar", official: true },
      ],
      ...o,
    }) as RunEntry;
  const bad = gtaFileRunProblems([
    part({}),
    part({ date: "2026-11-21" }),
    part({
      part: 2,
      date: "2026-11-20",
      sources: [{ url: "https://x.test", source: "Blog" }],
    }),
    part({
      part: 3,
      date: "2026-11-25",
      recap: "x",
      facts: ["A leaked map shows it"],
    }),
  ]);
  assert.ok(bad.some((p) => /Part 1 is planned twice/.test(p)));
  assert.ok(bad.some((p) => /Part 2 has no official source/.test(p)));
  assert.ok(
    bad.some((p) =>
      /Part 2 does not say what the last part established/.test(p),
    ),
  );
  assert.ok(bad.some((p) => /reads as a leak or rumour/.test(p)));
  assert.ok(bad.some((p) => /Part 2 is not dated after part 1/.test(p)));
});

test("the game is matched by any of its names, as whole words", () => {
  const f = { aliases: GTA_FILE_ALIASES };
  assert.ok(
    aboutFranchise(f, "GTA 6 lets you lose the cops by changing clothes"),
  );
  assert.ok(aboutFranchise(f, "Grand Theft Auto VI preload opens tonight"));
  assert.ok(
    aboutFranchise(f, "Rockstar's GTA6 trailer"),
    "spacing does not matter",
  );
  assert.ok(!aboutFranchise(f, "GTA 5 Enhanced gets a patch"));
  assert.ok(!aboutFranchise(f, "GTA 60 fps mod"));
});

test("the writer's brief: part number first, a callback after part 1, confirmed facts, own footage when it applies", () => {
  const base = {
    name: "The GTA File",
    franchise: "GTA VI",
    part: 1,
    recap: "",
    facts: ["It released on November 19."],
    ownFootage: false,
  };
  const one = gtaFileBrief(base);
  assert.match(one, /part 1 of "The GTA File"/);
  assert.match(one, /open with "GTA File, part 1\."/);
  assert.match(one, /This is the first part: no callback/);
  assert.match(one, /- It released on November 19\./);
  assert.match(one, /No leaks, datamines or insider claims/);
  assert.match(one, /It runs 45 to 55 seconds/);
  assert.doesNotMatch(one, /own GTA VI gameplay/);
  const two = gtaFileBrief({
    ...base,
    part: 2,
    recap: "Part 1 covered the download code.",
    previous: '"GTA VI File #1: What Launch Week Really Changed"',
    ownFootage: true,
    seconds: { min: 45, max: 60 },
  });
  assert.match(two, /callback to part 1: Part 1 covered the download code\./);
  assert.match(two, /it went out as: "GTA VI File #1/);
  assert.match(two, /opens on the owner's own GTA VI gameplay/);
  assert.match(two, /It runs 45 to 60 seconds/);
  assert.ok(!/[—–]/.test(one + two), "no em or en dashes");
});

test("a part's hook says its number first and never announces; the title takes the plan's pattern", () => {
  const ok = goodScript({
    hook: "GTA File, part 7. The map is bigger than it looks.",
  });
  assert.deepEqual(gtaFileProblems(ok, 7), []);
  assert.deepEqual(
    gtaFileProblems(goodScript({ hook: "GTA File, part seven: the map." }), 7),
    [],
  );
  const bad = gtaFileProblems(
    goodScript({
      hook: "Rockstar just announced a new GTA 6 feature.",
      youtube: {
        ...goodScript().youtube,
        title: "Rockstar Reveals GTA 6 Police",
      },
    }),
    3,
  );
  assert.equal(bad.length, 3);
  assert.match(bad[0]!, /hook reads as an announcement \("announced"\)/);
  assert.match(bad[1]!, /title reads as an announcement \("Reveals"\)/);
  assert.match(bad[2]!, /must open "GTA File, part 3\."/);
  assert.equal(
    gtaFileTitle(7, "the map is hiding more than you think"),
    "GTA VI File #7: The map is hiding more than you think",
  );
  assert.equal(
    gtaFileTitle(2, "GTA File Part 2: Your Radio Follows You"),
    "GTA VI File #2: Your Radio Follows You",
  );
  assert.equal(gtaFileTitle(3, "GTA VI File #3: X"), "GTA VI File #3: X");
});

test("a part opens on the owner's clip: it takes the hook and a trailer's hook moment goes back to the pool", () => {
  const files = [
    { game: "Elden Ring", file: "a.mp4" },
    { game: "Grand Theft Auto VI", file: "b.mp4" },
  ];
  assert.equal(
    franchiseClip({ aliases: GTA_FILE_ALIASES }, files)?.file,
    "b.mp4",
  );
  assert.equal(
    franchiseClip({ aliases: GTA_FILE_ALIASES }, files.slice(0, 1)),
    undefined,
  );
  const out = openOnOwnClip<{
    file: string;
    role?: "hook";
    beatIndex?: number;
  }>(
    [
      { file: "trailer_hook.mp4", role: "hook" },
      { file: "trailer_beat.mp4", beatIndex: 0 },
    ],
    { file: "own.mp4", beatIndex: 2 },
  );
  assert.deepEqual(
    out.map((c) => [c.file, c.role, c.beatIndex]),
    [
      ["own.mp4", "hook", undefined],
      ["trailer_hook.mp4", undefined, undefined],
      ["trailer_beat.mp4", undefined, 0],
    ],
  );
});

test("a part goes on The GTA File's shelf only, never the news shelf; other Shorts are filed as before", () => {
  const cfg = testConfig("/tmp/x");
  const ep = (hash: string, gtaFile?: object) =>
    ({
      lane: "news",
      story_hash: hash,
      story_json: { headline: "x", items: [], ...(gtaFile ? { gtaFile } : {}) },
      script_json: goodScript(),
    }) as never;
  const titles = (e: never) =>
    seriesFor(cfg, e, new Date()).map((x) => x.title);
  assert.deepEqual(titles(ep("h1")), ["Gaming News Today"]);
  assert.deepEqual(titles(ep("gtafile:3", { name: "The GTA File", part: 3 })), [
    "The GTA File",
  ]);
});

test("the serial a story belongs to, in the series tag's values", () => {
  assert.equal(serialOf({}), undefined);
  assert.equal(serialOf({ why: {} }), "why");
  assert.equal(serialOf({ why: {}, gtaFile: {} }), "gta_file");
});
