"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  alignSceneDurationsToWordBoundaries,
  capStaticCardDurations,
  sumSceneDurations,
} = require("../../lib/studio/v2/beat-aware-scene-durations");

test("alignSceneDurationsToWordBoundaries changes real scene durations so cuts land on words", () => {
  const scenes = Array.from({ length: 4 }, (_, index) => ({
    type: index === 3 ? "card.takeaway" : "clip",
    duration: 4.6,
  }));
  const words = [
    { word: "one", start: 4.42, end: 4.52 },
    { word: "two", start: 9.05, end: 9.15 },
    { word: "three", start: 13.76, end: 13.86 },
  ];

  const result = alignSceneDurationsToWordBoundaries(scenes, words, {
    totalDurationS: sumSceneDurations(scenes),
    minSceneDurationS: 2.6,
    maxSceneDurationS: 8.2,
  });

  assert.equal(result.adjusted, true);
  assert.deepEqual(result.cutTimes, [4.52, 9.15, 13.76]);
  assert.equal(Number(sumSceneDurations(result.scenes).toFixed(3)), 18.4);
  assert.deepEqual(
    result.scenes.map((scene) => Number(scene.duration.toFixed(3))),
    [4.52, 4.63, 4.61, 4.64],
  );
});

test("alignSceneDurationsToWordBoundaries preserves scenes when there are no word timings", () => {
  const scenes = [{ duration: 4 }, { duration: 4 }];
  const result = alignSceneDurationsToWordBoundaries(scenes, [], {
    totalDurationS: 8,
  });

  assert.equal(result.adjusted, false);
  assert.equal(result.scenes, scenes);
});

test("capStaticCardDurations shortens stat cards and redistributes time to motion stills", () => {
  const scenes = [
    { type: "clip.frame", duration: 4 },
    { type: "card.stat", duration: 5.6 },
    { type: "still", duration: 4 },
    { type: "card.timeline", duration: 4.4 },
  ];

  const result = capStaticCardDurations(scenes, {
    maxStaticCardDurationS: 3.2,
    maxFlexibleDurationS: 6.8,
  });

  assert.equal(result.adjusted, true);
  assert.equal(Number(sumSceneDurations(result.scenes).toFixed(3)), 18);
  assert.deepEqual(
    result.scenes.map((scene) => Number(scene.duration.toFixed(3))),
    [5.8, 3.2, 5.8, 3.2],
  );
});
