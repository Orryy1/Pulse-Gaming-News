import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSignalStats,
  usableCandidates,
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
