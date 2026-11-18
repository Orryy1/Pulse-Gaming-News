// Untagged library segments are screened before they are cut (15 Nov 2026: the final picture check rejected a
// suggestive close-up, "PRESENTS" lettering and a bare torso from untagged picks, a render each).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  banMoment,
  frameKey,
  sourceKey,
  storeVerdicts,
} from "../src/assets/screencache.ts";
import {
  screenFault,
  screenSpot,
  spotVerdict,
  untaggedSpots,
  UNTAGGED_FROM,
  UNTAGGED_TO,
} from "../src/assets/shortlibrary.ts";
import type { LibItem } from "../src/assets/gamelib.ts";

const flags = (o: Record<string, boolean> = {}) => ({
  hud: false,
  text: false,
  webcam: false,
  gore: false,
  letterbox: false,
  dark: false,
  blurry: false,
  suggestive: false,
  ...o,
});
const video = (id: string, seconds: number): LibItem => ({
  id,
  kind: "video",
  file: `videos/${id}.mp4`,
  sourceUrl: `https://media-rockstargames-com.akamaized.net/VI/downloads/videos/${id}.mp4`,
  provenance: id,
  source: "Rockstar Games",
  named: ["trailer"],
  tags: [],
  seen: "",
  durationSeconds: seconds,
  addedAt: "",
});

test("segments come from 15% to 85% of each trailer, clear of the opening and end cards", () => {
  assert.equal(UNTAGGED_FROM, 0.15);
  assert.equal(UNTAGGED_TO, 0.85);
  for (const s of untaggedSpots([video("t1", 90), video("t2", 167)], 40)) {
    const d = s.item.durationSeconds!;
    assert.ok(
      s.at >= d * 0.15 - 0.01 && s.end <= d * 0.85 + 0.01,
      `${s.item.id} ${s.at}-${s.end}`,
    );
  }
});

test("a suggestive, lettered or faulted frame sinks a segment; the game's own HUD does not", () => {
  assert.equal(screenFault(flags({ suggestive: true })), "suggestive");
  assert.equal(screenFault(flags({ text: true })), "text on screen");
  assert.equal(screenFault(flags({ text: true, hud: true })), undefined);
  assert.equal(
    spotVerdict(
      [{ ...flags(), by: "qa", why: "bare torso dominates the crop" }],
      [],
    ).why,
    "bare torso dominates the crop",
  );
  assert.equal(
    spotVerdict([], [flags(), flags({ text: true })]).verdict,
    "reject",
  );
  assert.equal(spotVerdict([], [flags(), flags()]).verdict, "ok");
  assert.equal(spotVerdict([], [flags(), undefined]).verdict, "unknown");
  assert.equal(spotVerdict([], []).verdict, "unknown");
});

test("the screen cache's faults and verdicts rule a segment out before anything is cut or looked at", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "screen-"));
  const prev = process.env.SCREEN_CACHE_FILE;
  process.env.SCREEN_CACHE_FILE = path.join(dir, "screen_cache.json");
  try {
    const v = video("GTAVI_Trailer_2", 167);
    // The final check faulted 40.5-43.5 s of this trailer in an earlier Short.
    banMoment({
      sourceUrl: v.sourceUrl,
      start: 40.5,
      seconds: 3,
      why: "suggestive close-up",
    });
    const budget = { ms: 20_000 };
    const hit = await screenSpot(
      dir,
      "Grand Theft Auto VI",
      { item: v, at: 41, end: 45.2 },
      dir,
      budget,
    );
    assert.deepEqual(hit, { verdict: "reject", why: "suggestive close-up" });
    // A screen verdict with lettering (the "PRESENTS" card) also rules it out.
    storeVerdicts([
      {
        key: frameKey(sourceKey(v.sourceUrl)!, 99),
        flags: flags({ text: true }),
      },
    ]);
    assert.equal(
      (
        await screenSpot(
          dir,
          "Grand Theft Auto VI",
          { item: v, at: 98.5, end: 102.7 },
          dir,
          budget,
        )
      ).verdict,
      "reject",
    );
    // Clean verdicts for the frames it would look at: passed without a look, the budget untouched.
    const src = sourceKey(v.sourceUrl)!;
    storeVerdicts(
      [60, 61.5, 63, 64.5].map((t) => ({
        key: frameKey(src, t),
        flags: flags(),
      })),
    );
    assert.equal(
      (
        await screenSpot(
          dir,
          "Grand Theft Auto VI",
          { item: v, at: 60, end: 64.2 },
          dir,
          budget,
        )
      ).verdict,
      "ok",
    );
    assert.equal(budget.ms, 20_000);
    // Nothing known and no file to look at: unknown, so the cheap checks decide.
    assert.equal(
      (
        await screenSpot(
          dir,
          "Grand Theft Auto VI",
          { item: v, at: 120, end: 124.2 },
          dir,
          budget,
        )
      ).verdict,
      "unknown",
    );
  } finally {
    if (prev === undefined) delete process.env.SCREEN_CACHE_FILE;
    else process.env.SCREEN_CACHE_FILE = prev;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
