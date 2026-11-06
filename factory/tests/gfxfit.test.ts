// The shared fit rules of the long-video graphics (src/render/components/packs/fit.ts) against the exact
// strings the graphics pre-check faulted on 30 Oct 2026, and the measured layouts built on them.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT_W,
  DRAWN_BY,
  FRAME_W,
  LOWER_THIRD,
  SAFE_EDGE,
  fitBlock,
  fitSize,
  fits,
  insideSafe,
  plate,
  textWidth,
  wrapText,
} from "../src/render/components/packs/fit.ts";
import {
  CARD_W,
  dateCardLayout,
} from "../src/render/components/LongMoments.tsx";
import {
  MIN_HOLD,
  delayDateSize,
  stageHold,
} from "../src/render/components/DocGraphics.tsx";
import { MIN_SETTLE_FRAMES, settledFrame } from "../src/qa/graphicscheck.ts";
import { readingOrder } from "../src/render/components/motifs/franchises/Gta.tsx";

test("text widths grow with size and the face, capitals and wide letters cost more", () => {
  assert.ok(
    textWidth("XBOX 360 RELEASE", "marker", 60) >
      textWidth("XBOX 360 RELEASE", "marker", 44),
  );
  assert.ok(textWidth("MW", "anton", 40) > textWidth("il", "anton", 40));
  assert.ok(textWidth("Halo", "inter", 32) > textWidth("Halo", "anton", 32));
  assert.equal(textWidth("", "inter", 32), 0);
  // Letter spacing adds between the letters only.
  assert.equal(textWidth("ab", "mono", 10, 5) - textWidth("ab", "mono", 10), 5);
});

test("the calendar's tape caption: tonight's strings fit the tape at a measured size, on one or two lines", () => {
  // 1140 px of tape: "Spartan Strike release date" was clipped at 60 px; the ladder finds a size that fits.
  for (const label of [
    "Spartan Strike release date",
    "XBOX 360 RELEASE",
    "Development stopped, discs to manufacturing",
    "Old servers shut down",
  ]) {
    const fit = fitBlock(label, "marker", {
      maxWidth: 1140,
      sizes: [60, 52, 44, 38, 34],
      maxLines: 2,
    });
    assert.ok(fit.fits, label);
    assert.ok(fit.lines.length <= 2);
    for (const l of fit.lines)
      assert.ok(fits(l, "marker", fit.size, 1140), `${l} at ${fit.size}`);
  }
  assert.equal(
    fitBlock("Xbox One release date", "marker", {
      maxWidth: 1140,
      sizes: [60, 52],
      maxLines: 1,
    }).size,
    60,
  );
  // A caption too long for the ladder is reported, not silently clipped.
  const long = fitBlock("a ".repeat(120).trim(), "marker", {
    maxWidth: 400,
    sizes: [60, 52],
    maxLines: 1,
  });
  assert.equal(long.fits, false);
});

test("wrapping is greedy by word and refuses a word wider than the line", () => {
  const lines = wrapText("Halo 4 Xbox 360 release", "inter", 32, 300)!;
  assert.equal(lines.length, 2);
  assert.equal(lines.join(" "), "Halo 4 Xbox 360 release");
  for (const l of lines) assert.ok(fits(l, "inter", 32, 300), l);
  assert.deepEqual(wrapText("Halo 4 Xbox 360 release", "inter", 32, 2000), [
    "Halo 4 Xbox 360 release",
  ]);
  assert.equal(wrapText("Supercalifragilistic", "inter", 60, 100), null);
  assert.deepEqual(wrapText("  ", "inter", 32, 300), []);
});

test("the ladder picks the first size that fits and says when none does", () => {
  const r = fitSize("NOVEMBER 6, 2012", "anton", 576, [64, 56, 48, 40]);
  assert.equal(r.size, 64);
  assert.equal(r.fits, true);
  const tight = fitSize("NOVEMBER 6, 2012", "anton", 300, [64, 56, 48, 40]);
  assert.equal(tight.size, 40);
  assert.equal(tight.fits, false);
});

test("the top-right date card: NOVEMBER 6, 2012 and its caption never run past the card", () => {
  // Tonight's card ran to the frame edge with the caption beside the badge: now it goes under it.
  const L = dateCardLayout("November 6, 2012", "Halo 4 Xbox 360 release");
  assert.equal(L.beside, false);
  assert.ok(L.badgeSize >= 56);
  assert.ok(
    textWidth("NOVEMBER 6, 2012", "anton", L.badgeSize) + 40 <= CARD_W - 64,
  );
  // A short date with a short caption stays on one row.
  assert.equal(dateCardLayout("May 2004", "Launch").beside, true);
  // No caption: always beside (nothing to stack).
  assert.equal(dateCardLayout("September 2009", "").beside, true);
  // The card itself sits inside the safe area at the top right.
  assert.ok(
    insideSafe({
      left: FRAME_W - 96 - CARD_W,
      top: 128,
      width: CARD_W,
      height: 200,
    }),
  );
});

test("the delay stamp's two date cards fit the safe width at a measured size", () => {
  const size = delayDateSize("November 18, 2014", "April 14, 2015");
  assert.ok(size < 96, "the 96 px cards ran past the safe width");
  const w =
    textWidth("NOVEMBER 18, 2014", "anton", size) +
    textWidth("APRIL 14, 2015", "anton", size);
  assert.ok(w + 2 * 88 + 90 + 2 * 70 <= CONTENT_W);
  assert.equal(delayDateSize("December 12", "April 16"), 96);
});

test("the safe area: 60 px from the edges, the lower third kept for the chapter tag", () => {
  assert.equal(SAFE_EDGE, 60);
  assert.ok(
    LOWER_THIRD >= 72 + 62,
    "the chapter tag (SAFE_BOTTOM 72, about 62 px tall) must fit under it",
  );
  assert.equal(
    insideSafe({ left: 59, top: 100, width: 100, height: 100 }),
    false,
  );
  assert.equal(
    insideSafe({
      left: 100,
      top: 100,
      width: 100,
      height: 1080 - 100 - LOWER_THIRD + 1,
    }),
    false,
  );
  assert.equal(
    insideSafe({ left: 100, top: 100, width: 100, height: 100 }),
    true,
  );
  // A plate always has a dark background and a shadow, so a label over a bright sky still reads.
  const p = plate();
  assert.match(String(p.background), /rgba\(11,11,14,0\.8/);
  assert.ok(p.textShadow);
});

test("the GTA box-art list numbers its panels in reading order, whichever way the layout is mirrored", () => {
  const rects = [
    { x: 1000, y: 400, w: 400, h: 300 },
    { x: 100, y: 60, w: 800, h: 300 },
    { x: 100, y: 420, w: 400, h: 300 },
    { x: 1000, y: 80, w: 400, h: 300 },
  ];
  assert.deepEqual(
    readingOrder(rects).map((r) => `${r.x},${r.y}`),
    ["100,60", "1000,80", "100,420", "1000,400"],
  );
  assert.equal(readingOrder([]).length, 0);
});

test("every build is done by DRAWN_BY, and the pre-check never looks before frame 60 or into a fade", () => {
  assert.equal(DRAWN_BY, 100);
  assert.ok(MIN_SETTLE_FRAMES >= 60);
  assert.ok(MIN_SETTLE_FRAMES <= DRAWN_BY);
  // A full-screen look holds at least MIN_HOLD when the moment allows, so its fade (the last 12-14
  // frames) starts after the check's still: a two-item GTA list held 112 frames and was caught mid-fade.
  assert.equal(stageHold(400, 60 + 2 * 26), MIN_HOLD);
  assert.equal(stageHold(400, 210), 210);
  assert.equal(stageHold(100, 210), 94);
  assert.equal(stageHold(40, 210), 60);
  for (const len of [75, 100, 120, 160, 200, 300, 600])
    assert.ok(
      settledFrame(len) <= stageHold(len, 60) - 12,
      `moment of ${len} frames`,
    );
});
