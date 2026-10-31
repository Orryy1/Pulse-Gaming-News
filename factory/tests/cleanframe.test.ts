import { test } from "node:test";
import assert from "node:assert/strict";
import type { Segment } from "../src/render/timeline.ts";
import type { RenderPlan, Shot } from "../src/render/plan.ts";
import {
  arbitrate,
  ccCredit,
  elementStats,
  elementsAt,
  frameModel,
  labelShows,
  OPENING_LABEL_FRAMES,
  overlaySpans,
  shortLayout,
  shortsCleanFor,
  THUMB_FRAMES,
  type Span,
} from "../src/render/cleanframe.ts";
import { shortsCleanStep } from "../src/shortcraftstep.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

const span = (
  key: string,
  kind: Span["kind"],
  from: number,
  to: number,
): Span => ({ key, kind, from, to });

test("one overlay at a time: the higher priority keeps its frames, a lower one is cut to the longest free stretch", () => {
  const kept = arbitrate([
    span("shelf0", "shelf", 100, 400),
    span("card1", "card", 150, 225),
    span("stamp0", "stamp", 300, 351),
  ]);
  const by = (k: string) => kept.find((s) => s.key === k);
  assert.deepEqual([by("card1")!.from, by("card1")!.to], [150, 225]);
  assert.deepEqual([by("stamp0")!.from, by("stamp0")!.to], [300, 351]);
  // The shelf device had 100-150, 225-300 and 351-400: the longest (225-300) is kept.
  assert.deepEqual([by("shelf0")!.from, by("shelf0")!.to], [225, 300]);
  for (let f = 0; f < 500; f++)
    assert.ok(
      kept.filter((s) => f >= s.from && f < s.to).length <= 1,
      `frame ${f}`,
    );
});

test("a cut-down overlay too short to read is dropped", () => {
  const kept = arbitrate([
    span("card1", "card", 100, 175),
    span("shelf0", "shelf", 90, 190),
  ]);
  assert.equal(
    kept.find((s) => s.key === "shelf0"),
    undefined,
  ); // 10 and 15 frames left: under 30
});

test("the hook's headline steps aside for a word moment and comes back; a moment never covers the thumbnail", () => {
  const kept = arbitrate([
    span("hook", "hook", 0, 100),
    span("stamp0", "stamp", 0, 51),
  ]);
  const stamp = kept.find((s) => s.kind === "stamp")!;
  assert.equal(stamp.from, THUMB_FRAMES);
  assert.equal(stamp.to - stamp.from, 51);
  const hook = kept.filter((s) => s.kind === "hook");
  assert.deepEqual(
    hook.map((s) => [s.from, s.to]),
    [
      [0, THUMB_FRAMES],
      [THUMB_FRAMES + 51, 100],
    ],
  );
});

test("the flair and source line show for the opening 3 s and the loop's return to frame 0 only", () => {
  assert.ok(labelShows(0, 1200) && labelShows(OPENING_LABEL_FRAMES - 1, 1200));
  assert.ok(!labelShows(OPENING_LABEL_FRAMES, 1200) && !labelShows(1199, 1200));
  assert.ok(labelShows(1200, 1200));
});

test("on screen, only the credit a licence asks for", () => {
  assert.equal(
    ccCredit(
      'Gameplay "Big jump" by Jane Player, Creative Commons Attribution licence (CC BY) (https://youtu.be/x), 12 s',
    ),
    "Gameplay: Jane Player · CC BY",
  );
  assert.equal(
    ccCredit('Official Steam trailer "Launch" for "Halo"'),
    undefined,
  );
  assert.equal(ccCredit(undefined), undefined);
});

test("clean by default; the retention test's arm decides on its Shorts, then its winner; off is off", () => {
  assert.equal(shortsCleanFor(true, undefined, undefined), true);
  assert.equal(
    shortsCleanFor(true, { key: "shorts_clean", variant: "A" }, undefined),
    true,
  );
  assert.equal(
    shortsCleanFor(true, { key: "shorts_clean", variant: "B" }, undefined),
    false,
  );
  assert.equal(
    shortsCleanFor(true, { key: "hook_style", variant: "B" }, "B"),
    false,
  );
  assert.equal(shortsCleanFor(true, undefined, "A"), true);
  assert.equal(
    shortsCleanFor(false, { key: "shorts_clean", variant: "A" }, "A"),
    false,
  );
});

// A 30 s Short with every overlay the old frame stacked: hook, two cards, a stamp, three shelf devices, framed footage.
function short() {
  const fps = 30;
  const segments: Segment[] = [
    { kind: "hook", text: "Starfield slips to March.", start: 0, end: 4 },
    {
      kind: "beat",
      text: "The price holds at thirty dollars.",
      start: 4,
      end: 12,
      visual: { kind: "price", primary: "$29.99", secondary: "price" },
    },
    {
      kind: "beat",
      text: "The new date is March fourteenth.",
      start: 12,
      end: 20,
      visual: { kind: "date", primary: "March 14", secondary: "new date" },
    },
    {
      kind: "take",
      text: "Our read: not a red flag.",
      start: 20,
      end: 26,
      visual: { kind: "title", primary: "Not a red flag", secondary: "" },
    },
    { kind: "loop", text: "So, March then.", start: 26, end: 30 },
  ];
  const words: Array<{ text: string; start: number; end: number }> = [];
  for (const s of segments) {
    const ws = s.text.split(" ");
    ws.forEach((w, i) =>
      words.push({
        text: w,
        start: s.start + (i * (s.end - s.start)) / ws.length,
        end: s.start + ((i + 0.8) * (s.end - s.start)) / ws.length,
      }),
    );
  }
  const shots: Shot[] = segments.map((s, i) => ({
    start: Math.round(s.start * fps),
    end: Math.round(s.end * fps),
    segment: i,
    media: { type: "clip", index: i },
    move: "pushIn",
    framed: i === 1,
    luma: 100,
  }));
  const plan = {
    fps,
    totalFrames: 900,
    tailFrames: 30,
    shots,
    shelf: [
      { segment: 1, device: "gamecard", from: 130, to: 330, data: {} },
      { segment: 2, device: "source", from: 380, to: 560, data: {} },
      { segment: 3, device: "stat", from: 620, to: 760, data: {} },
    ],
  } as unknown as RenderPlan;
  return { fps, segments, words, plan };
}

test("the clean frame has at most two elements (caption and one) outside the opening label and the loop; the old one more", () => {
  const { fps, segments, words, plan } = short();
  const layout = shortLayout(segments, fps, plan.totalFrames, plan.tailFrames);
  const spans = overlaySpans({
    segments,
    words,
    plan,
    layout,
    stamps: [{ at: 5 }],
    sting: false,
  });
  const credited = (i: number) => plan.shots[i]!.media.type === "clip";
  const old = frameModel({
    clean: false,
    spans,
    layout,
    plan,
    words,
    fps,
    credited,
  });
  const clean = frameModel({
    clean: true,
    spans,
    layout,
    plan,
    words,
    fps,
    credited: () => false,
  });
  const middle = (f: number) =>
    f < OPENING_LABEL_FRAMES || f >= layout.loopFrom;
  assert.ok(elementStats(old, middle).max >= 5);
  assert.equal(elementStats(clean, middle).max, 2);
  assert.ok(elementStats(clean).max <= 3); // the opening: caption, headline and the honesty label
  assert.deepEqual(
    elementsAt(clean, 200).filter((e) => e !== "caption").length,
    1,
  );
  assert.ok(
    !elementsAt(clean, 200).includes("rail") &&
      !elementsAt(clean, 200).includes("inset"),
  );
});

test("the step decides and logs the clean frame from the setting and the retention test", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir());
  assert.equal(await shortsCleanStep({ db, cfg }, "ep1", undefined), true);
  assert.equal(
    await shortsCleanStep({ db, cfg }, "ep2", {
      key: "shorts_clean",
      variant: "B",
    }),
    false,
  );
  assert.equal(
    await shortsCleanStep(
      { db, cfg: { ...cfg, shortsClean: false } },
      "ep3",
      undefined,
    ),
    false,
  );
  const rows = await db.query<{ detail: { clean: boolean; why: string } }>(
    `SELECT detail FROM events WHERE kind = 'shorts_clean' ORDER BY id`,
  );
  assert.deepEqual(
    rows.map((r) => r.detail.why),
    ["default", "retention test arm B", "SHORTS_CLEAN is off"],
  );
  await db.close();
});
