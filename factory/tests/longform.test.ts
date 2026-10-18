import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateLongform,
  longformToScript,
  narrationOfLongform,
  LONG_ENTRIES_MIN,
  type LongformScript,
} from "../src/editorial/longform.ts";
import {
  buildLongPlan,
  chapterLines,
  entryOf,
  LONG_FPS,
} from "../src/render/longplan.ts";
import { buildSegments } from "../src/render/timeline.ts";
import { evergreenTitle } from "../src/editorial/seo.ts";
import { segmentInputs } from "../src/pipeline.ts";

const sentence = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? seed : `word${i}`)).join(" ") +
  ".";

function longScript(entries = 10): LongformScript {
  return {
    theme: "Resident Evil",
    title: "Every Resident Evil Game Ranked",
    criterion: "how much dread it delivers today",
    intro: {
      narration: sentence(50, "Tonight"),
      on_screen: "Worst to best, by dread",
    },
    entries: Array.from({ length: entries }, (_, i) => ({
      rank: i + 1,
      game_title: `Resident Evil ${i + 1}`,
      steam_search_term: `Resident Evil ${i + 1}`,
      year: 1996 + i,
      platforms: "PC, PS5",
      narration: sentence(70, `Entry${i}`),
      verdict_chip: "Pure dread",
      footage: { want: "gameplay", keywords: ["zombie"] },
      moments: [{ show: "a zombie in the mansion hall", keywords: ["zombie"], graphic: { kind: "none" as const, primary: "", secondary: "", items: [] as string[] }, emphasis: "" }],
    })),
    outro: {
      narration: sentence(60, "Finally"),
      on_screen: "RE7 wins on dread",
    },
    youtube: {
      title: "Every Resident Evil Game Ranked Worst to Best",
      description: "A ranking.",
      tags: ["resident evil"],
    },
    claims: [],
  };
}

test("a long-form script validates on word bands, ranks and varied openings", () => {
  const ok = longScript();
  assert.deepEqual(validateLongform(ok), []);
  const bad = longScript(LONG_ENTRIES_MIN - 1);
  assert.ok(validateLongform(bad).some((p) => /entries/.test(p)));
  const same = longScript();
  same.entries[1]!.narration = same.entries[0]!.narration;
  assert.ok(
    validateLongform(same).some((p) => /open with the same words/.test(p)),
  );
  const words = narrationOfLongform(ok).split(/\s+/).length;
  assert.ok(words >= 650 && words <= 1150, String(words));
});

test("the long script adapts to the common shape: intro hook, one rank beat per entry bottom-up, the pick as the take, no loop", () => {
  const script = longformToScript(longScript());
  assert.equal(script.runtime, "long");
  assert.equal(script.beats.length, 10);
  assert.equal(script.beats[0]!.visual.value_a, 10);
  assert.equal(script.beats.at(-1)!.visual.value_a, 1);
  assert.equal(script.loop_line, "");
  assert.equal(script.pulse_take.label, "OUR PICK");
  assert.equal(
    evergreenTitle(script),
    "Every Resident Evil Game Ranked Worst To Best",
  );
});

test("the long plan keeps every entry on its own media, never flashes a shot under two seconds and never repeats a still back to back", () => {
  const script = longformToScript(longScript());
  const inputs = segmentInputs(script);
  // Fake word timings: each segment gets its words spread over its share of a 400 s read.
  const totalWords = inputs.reduce(
    (n, s) => n + s.text.split(/\s+/).filter(Boolean).length,
    0,
  );
  const words: Array<{ text: string; start: number; end: number }> = [];
  let t = 0;
  for (const seg of inputs)
    for (const w of seg.text.split(/\s+/).filter(Boolean)) {
      const d = 400 / totalWords;
      words.push({ text: w, start: t, end: t + d * 0.9 });
      t += d;
    }
  const duration = 406;
  const segments = buildSegments(inputs, words, duration);
  const images: Array<{ kind: string; aspect: number; beatIndex?: number }> = [
    { kind: "hero", aspect: 1.78 },
    { kind: "screenshot", aspect: 1.78 },
    ...Array.from({ length: 10 }, (_, b) => [
      { kind: "hero", aspect: 1.78, beatIndex: b },
      { kind: "capsule", aspect: 0.667, beatIndex: b },
      { kind: "screenshot", aspect: 1.78, beatIndex: b },
    ]).flat(),
  ];
  const clips: Array<{ durationSeconds: number; beatIndex?: number; role?: "hook" }> = [
    { durationSeconds: 4.8, role: "hook" as const },
    ...Array.from({ length: 10 }, (_, b) => [
      { durationSeconds: 4.8, beatIndex: b },
      { durationSeconds: 3.2, beatIndex: b },
    ]).flat(),
  ];
  const plan = buildLongPlan({
    segments,
    words,
    durationSeconds: duration,
    images,
    clips,
    variant: 1,
  });
  assert.equal(plan.shots[0]!.start, 0);
  assert.equal(plan.shots.at(-1)!.end, plan.totalFrames);
  for (let k = 1; k < plan.shots.length; k++)
    assert.equal(plan.shots[k]!.start, plan.shots[k - 1]!.end, "contiguous");
  for (const s of plan.shots) {
    const endsSegment = plan.shots.find((o) => o.start === s.end)?.segment !== s.segment;
    assert.ok(
      s.end - s.start >= 60 || (s.media.type !== "clip" && endsSegment),
      `shot at ${s.start} is ${s.end - s.start} frames`,
    );
    const entry = entryOf(segments, s.segment);
    // The intro is a montage: it may show any entry's picture.
    if (s.media.type === "image" && segments[s.segment]!.kind !== "hook")
      assert.equal(
        images[s.media.index]!.beatIndex,
        entry,
        `shot in segment ${s.segment} shows image for entry ${images[s.media.index]!.beatIndex}`,
      );
    if (s.media.type === "clip") {
      assert.equal(clips[s.media.index]!.beatIndex, entry);
      assert.ok(
        s.end - s.start <= Math.floor(clips[s.media.index]!.durationSeconds * LONG_FPS),
        "a clip shot never outlasts its clip (that would play black)",
      );
    }
  }
  for (let k = 1; k < plan.shots.length; k++) {
    const a = plan.shots[k - 1]!.media;
    const b = plan.shots[k]!.media;
    if (a.type === "image" && b.type === "image")
      assert.notEqual(
        a.index,
        b.index,
        `still ${a.index} repeats at shot ${k}`,
      );
  }
  const clipShots = plan.shots.filter((s) => s.media.type === "clip").length;
  assert.ok(clipShots >= 15, `only ${clipShots} clip shots`);
  const chapters = chapterLines(segments, (seg) =>
    seg.kind === "hook"
      ? "Intro"
      : seg.kind === "beat"
        ? `#${seg.visual?.value_a} ${seg.visual?.primary}`
        : seg.kind === "take"
          ? "Our pick"
          : undefined,
  );
  assert.equal(chapters[0], "0:00 Intro");
  assert.equal(chapters.length, 12);
  assert.match(chapters[1]!, /^\d+:\d\d #10 Resident Evil 10$/);
  assert.match(chapters.at(-1)!, /Our pick$/);
});


import { sentencesOf } from "../src/editorial/longform.ts";

test("moments: one per sentence, and a graphic's figures must be said in the narration", () => {
  assert.deepEqual(sentencesOf("It sold 25 million copies. Then came Raccoon City! Was it worth it? Yes."), ["It sold 25 million copies.", "Then came Raccoon City!", "Was it worth it?", "Yes."]);
  const s = longScript();
  const e = s.entries[0]!;
  e.narration = "It sold 25 million copies. The mansion still terrifies.";
  e.moments = [
    { show: "sales chart", keywords: [], graphic: { kind: "stat", primary: "25 million", secondary: "copies sold", items: [] }, emphasis: "" },
    { show: "the mansion hall", keywords: [], graphic: { kind: "none", primary: "", secondary: "", items: [] }, emphasis: "the mansion" },
  ];
  assert.ok(!validateLongform(s).some((p) => /moments|figure/.test(p)));
  e.moments[0]!.graphic.primary = "40 million";
  assert.ok(validateLongform(s).some((p) => /figure the narration does not say/.test(p)));
  e.moments = e.moments.slice(0, 1);
  assert.ok(validateLongform(s).some((p) => /2 sentences but 1 moments/.test(p)));
});

import { momentWindows } from "../src/render/longplan.ts";

test("a long entry with a shot list opens each sentence on its own matched picture", () => {
  const s = longScript(8);
  s.entries.forEach((e) => {
    e.narration = "First thing happens here today. Second thing follows right after. Third thing closes it out.";
    e.moments = [0, 1, 2].map((k) => ({ show: `shot ${k}`, keywords: [], graphic: { kind: "none" as const, primary: "", secondary: "", items: [] as string[] }, emphasis: "" }));
  });
  const script = longformToScript(s);
  const inputs = segmentInputs(script);
  const all = inputs.flatMap((x) => x.text.split(/\s+/).filter(Boolean));
  const words = all.map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 }));
  const segments = buildSegments(inputs, words, words.at(-1)!.end + 6);
  const counts = Array.from({ length: 8 }, () => 3);
  const windows = momentWindows(segments, words, counts);
  assert.equal(windows.length, 24);
  assert.ok(windows.every((w) => w.end > w.start));
  // Entry 2 has a still picked for each sentence and a clip for sentence 1.
  const images = [0, 1, 2].map((m) => ({ kind: "screenshot", aspect: 1.78, beatIndex: 2, moment: m })).concat([{ kind: "screenshot", aspect: 1.78, beatIndex: 2, moment: undefined as unknown as number }]);
  const clips = [{ durationSeconds: 3, beatIndex: 2, moment: 1 }];
  const plan = buildLongPlan({ segments, words, durationSeconds: words.at(-1)!.end + 6, images, clips, variant: 0, momentCounts: counts });
  const at = (sec: number) => plan.shots.find((x) => x.start <= Math.round(sec * LONG_FPS) && x.end > Math.round(sec * LONG_FPS))!;
  const w = windows.filter((x) => x.entry === 2);
  assert.deepEqual(at(w[0]!.start + 0.05).media, { type: "image", index: 0 });
  assert.deepEqual(at(w[1]!.start + 0.05).media, { type: "clip", index: 0 });
  assert.deepEqual(at(w[2]!.start + 0.05).media, { type: "image", index: 2 });
  assert.ok(plan.shots.every((x) => x.end - x.start >= 1 && x.end > x.start));
});
