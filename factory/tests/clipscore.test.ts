import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSignalStats,
  usableCandidates,
  detectCuts,
  withCuts,
  shotLength,
  rankByRule,
  rankByModel,
  targetsFor,
  type Candidate,
} from "../src/assets/clipscore.ts";
import type { Llm } from "../src/editorial/llm.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { goodScript } from "./helpers.ts";

// Keyframe files exist on disk because rankByModel reads them to show the model.
const FRAMES = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-kf-"));

function cands(spec: Array<[number, number, number]>): Candidate[] {
  return spec.map(([time, luma, motion], index) => {
    const frame = path.join(FRAMES, `kf_${index}.jpg`);
    fs.writeFileSync(frame, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return { index, movie: 0, time, luma, motion, frame };
  });
}

test("ffmpeg signalstats output becomes per-keyframe brightness and motion", () => {
  const text = [
    "frame:0 pts:0 pts_time:0",
    "lavfi.signalstats.YAVG=12.5",
    "lavfi.signalstats.YDIF=0.0",
    "frame:1 pts:45 pts_time:1.5",
    "lavfi.signalstats.YAVG=120.25",
    "lavfi.signalstats.YDIF=18.7",
    "",
  ].join("\n");
  assert.deepEqual(parseSignalStats(text), [
    { time: 0, luma: 12.5, motion: 0 },
    { time: 1.5, luma: 120.25, motion: 18.7 },
  ]);
});

test("usable keyframes skip the rating boards, the end slate and black or blown-out frames", () => {
  const all = cands([
    [3, 120, 10], // too early: rating board zone
    [12, 10, 10], // black
    [15, 120, 30],
    [30, 240, 5], // blown out
    [45, 130, 20],
    [56, 120, 20], // too close to the end of a 60 s trailer
  ]);
  assert.deepEqual(
    usableCandidates(all, 60).map((c) => c.time),
    [15, 45],
  );
  // Long trailers keep a 22 s lead and a 12 s tail.
  const long = cands([
    [20, 120, 1],
    [25, 120, 1],
    [100, 120, 1],
    [110, 120, 1],
  ]);
  assert.deepEqual(
    usableCandidates(long, 120).map((c) => c.time),
    [25, 100],
  );
});

test("the motion rule gives the hook the liveliest moment, calm lines the stillest, never the same moment twice", () => {
  const script = goodScript();
  const targets = targetsFor(script);
  assert.equal(targets[0]!.key, "hook");
  assert.equal(targets[0]!.energy, "high");
  const pool = cands([
    [20, 120, 5],
    [30, 120, 40],
    [40, 120, 20],
    [50, 120, 1],
  ]);
  const picks = rankByRule(targets, pool);
  assert.equal(
    picks.find((p) => p.key === "hook")!.candidate,
    1,
    "hook takes the liveliest",
  );
  const calm = targets.find((t) => t.energy === "low");
  if (calm)
    assert.equal(
      picks.find((p) => p.key === calm.key)!.candidate,
      3,
      "a number card gets the stillest",
    );
  assert.equal(new Set(picks.map((p) => p.candidate)).size, picks.length);
});

test("the model's picks are kept only when confident, known and free of text or logos", async () => {
  const targets = targetsFor(goodScript());
  const pool = cands([
    [20, 120, 5],
    [30, 120, 40],
    [40, 120, 20],
  ]);
  const llm = {
    structured: async () => ({
      candidates: [
        {
          index: 0,
          label: "ship interior",
          has_text_or_logo: false,
          energy: "low",
        },
        {
          index: 1,
          label: "title card",
          has_text_or_logo: true,
          energy: "high",
        },
        {
          index: 2,
          label: "dogfight over a moon",
          has_text_or_logo: false,
          energy: "high",
        },
      ],
      assignments: [
        {
          key: "hook",
          candidate_index: 1,
          confidence: 0.9,
          reason: "striking",
        },
        {
          key: targets[1]!.key,
          candidate_index: 2,
          confidence: 0.8,
          reason: "shows the fight",
        },
        {
          key: targets[2]?.key ?? "beat:9",
          candidate_index: 0,
          confidence: 0.3,
          reason: "weak",
        },
        {
          key: "beat:99",
          candidate_index: 0,
          confidence: 0.9,
          reason: "unknown line",
        },
      ],
    }),
  } as unknown as Llm;
  const picks = await rankByModel(llm, targets, pool);
  assert.deepEqual(
    picks.map((p) => [p.key, p.candidate, p.label]),
    [[targets[1]!.key, 2, "dogfight over a moon"]],
  );
});

test("a clip opens on its shot's first frame, ends where the shot ends, and a shot too short for a line is passed over", () => {
  const cand = (time: number, i: number): Candidate => ({ index: i, movie: 0, time, luma: 120, motion: 10, frame: "" });
  const all = Array.from({ length: 12 }, (_, i) => cand(25 + i * 1.5, i));
  // Per-frame rows: a hard cut at 27.6 s by scene score, a cut at 41 s by a motion spike inside fast action.
  const rows = Array.from({ length: 30 * 60 }, (_, f) => {
    const time = f / 30;
    const spike = Math.abs(time - 41) < 0.02;
    // The hard cut at 27.6 s is preceded by three dissolve frames: one transition, placed at its last frame.
    const dissolve = time >= 27.5 && time <= 27.6;
    return { time, motion: time > 39 && time < 43 ? (spike ? 60 : 25) : 3, scene: dissolve ? 0.5 : 0.02 };
  });
  const cuts = detectCuts(rows);
  assert.deepEqual(cuts.map((c) => Number(c.toFixed(2))), [27.6, 41]);
  const tagged = withCuts(all, cuts);
  const times = tagged.map((c) => c.time);
  assert.ok(times.includes(27.6), "the shot after the cut is offered from its first frame");
  assert.ok(times.includes(41), "the shot after the spike too");
  assert.equal(times.filter((x) => x === 27.6).length, 1, "one candidate per shot");
  assert.equal(tagged.find((c) => c.time === 25)!.nextCut, 27.6);
  assert.equal(tagged.find((c) => c.time === 41)!.nextCut, undefined);
  const kept = usableCandidates(tagged, 120).map((c) => c.time);
  assert.ok(!kept.includes(26.5), "26.5 s has only 1.1 s before the cut at 27.6");
  assert.ok(kept.includes(25), "25 s has 2.6 s of shot: enough for a short clip");
  assert.ok(kept.includes(27.6) && kept.includes(41));
  assert.equal(Number(shotLength(tagged.find((c) => c.time === 25)!).toFixed(2)), 2.4);
  assert.equal(shotLength(tagged.find((c) => c.time === 41)!), 4.8);
  // With too few whole shots the filter stands down rather than starve the matcher.
  const dense = withCuts(all, all.map((c) => c.time + 1));
  assert.equal(usableCandidates(dense, 120).length, usableCandidates(all, 120).length);
});

import { rejectReason, screenFrames } from "../src/assets/localvision.ts";

test("the local frame screen names the worst problem and stays off in tests", async () => {
  const none = { hud: false, text: false, webcam: false, gore: false, letterbox: false, dark: false, blurry: false };
  assert.equal(rejectReason(none), undefined);
  assert.equal(rejectReason({ ...none, text: true, webcam: true }), "webcam or overlay");
  assert.equal(rejectReason({ ...none, dark: true }), "too dark");
  assert.deepEqual(await screenFrames(["a.jpg", "b.jpg"]), [undefined, undefined]);
});
