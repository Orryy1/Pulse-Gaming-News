import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAROUSEL_STEPS,
  EJECT_STEPS,
  FRAME_H,
  FRAME_W,
  MAX_PICTURE_W,
  MAX_RUN,
  MIN_PICTURE_H,
  MIN_SHOT_FRAMES,
  PHOTO_TREATMENTS,
  RULES,
  boardLayout,
  cameraPhases,
  darkroomPhases,
  develop,
  displayFor,
  dropArc,
  dropStack,
  dustMotes,
  eligible,
  filmOffset,
  filmPhases,
  halftone,
  lensPath,
  lightBoxLayout,
  lineLayout,
  pageTurn,
  pegSwing,
  photoTreatment,
  pictureBox,
  planPhotoShots,
  pressCredit,
  scanY,
  screenBox,
  slidePhases,
  stringPath,
  tapeStrips,
  torchX,
} from "../src/render/photoplan.ts";
import { NEIGHBOUR_FRAMES } from "../src/render/sketchplan.ts";
import type { LongShot } from "../src/render/longplan.ts";

const solo = { kind: "photo" as const, run: { index: 0, length: 1 } };

test("period treatments suit their era: the darkroom and film to 2005, slides to 2000, newsprint to 1995 or a press credit", () => {
  const at = (year: number | undefined, credit?: string) => ({
    kind: "photo" as const,
    year,
    credit,
  });
  assert.ok(eligible("darkroom", 180, at(2001)));
  assert.ok(!eligible("darkroom", 180, at(2006)));
  assert.ok(!eligible("darkroom", 180, at(undefined)), "no year counts as now");
  assert.ok(eligible("filmStrip", 180, at(1997)));
  assert.ok(!eligible("filmStrip", 180, at(2012)));
  assert.ok(eligible("slideProjector", 180, at(1999)));
  assert.ok(!eligible("slideProjector", 180, at(2001)));
  assert.ok(eligible("newsprint", 180, at(1994)));
  assert.ok(!eligible("newsprint", 180, at(2004)));
  assert.ok(
    eligible("newsprint", 180, at(2004, "Jane Doe / Associated Press")),
    "a press picture of any year",
  );
  assert.ok(pressCredit("Photo: Daily Record"));
  assert.ok(!pressCredit("Alan Smith / CC BY-SA 4.0 / Wikimedia Commons"));
  assert.ok(!pressCredit(undefined));
  // Any-era treatments take any year, and no year.
  for (const t of [
    "instantDrop",
    "ductTape",
    "cameraPrint",
    "archiveScan",
  ] as const) {
    assert.ok(eligible(t, 180, at(1988)));
    assert.ok(eligible(t, 180, at(undefined)));
  }
});

test("a treatment needs its minimum length, and a portrait is never a negative, a keystone or under a lens", () => {
  assert.ok(!eligible("darkroom", 119, { kind: "photo", year: 1999 }));
  assert.ok(eligible("darkroom", 120, { kind: "photo", year: 1999 }));
  assert.ok(!eligible("magnifier", 74, { kind: "photo" }));
  assert.ok(eligible("instantDrop", 30, { kind: "photo" }));
  for (const t of [
    "filmStrip",
    "slideProjector",
    "newsprint",
    "magnifier",
  ] as const)
    assert.ok(
      !eligible(t, 300, { kind: "portrait", year: 1990, credit: "AP" }),
      t,
    );
  for (const t of [
    "instantDrop",
    "ductTape",
    "evidenceBoard",
    "darkroom",
    "albumPage",
    "archiveScan",
    "manilaFolder",
  ] as const)
    assert.ok(eligible(t, 300, { kind: "portrait", year: 1990 }), t);
});

test("a photo's treatment is seeded, never the one before, and a shot too short keeps the print", () => {
  assert.equal(photoTreatment(1, MIN_SHOT_FRAMES - 1, solo), undefined);
  const picks = new Set<string>();
  for (let seed = 1; seed < 80; seed++) {
    const t = photoTreatment(seed, 180, { ...solo, year: 1999 })!;
    assert.ok(PHOTO_TREATMENTS.includes(t));
    picks.add(t);
    assert.equal(
      photoTreatment(seed, 180, { ...solo, year: 1999 }),
      t,
      "deterministic",
    );
    assert.notEqual(
      photoTreatment(seed, 180, { ...solo, year: 1999, previous: t }),
      t,
    );
  }
  assert.ok(picks.size >= 10, `variety across seeds: ${[...picks].join(", ")}`);
  // A modern chapter never sees the darkroom, the film strip, the projector or newsprint.
  for (let seed = 1; seed < 80; seed++) {
    const t = photoTreatment(seed, 300, { ...solo, year: 2022 })!;
    assert.ok(
      !["darkroom", "filmStrip", "slideProjector", "newsprint"].includes(t),
      t,
    );
  }
  // A short shot only gets the quick treatments.
  for (let seed = 1; seed < 40; seed++) {
    const t = photoTreatment(seed, 32, { ...solo, year: 1999 })!;
    assert.ok(RULES[t].minFrames <= 32, t);
  }
});

test("a run's first member picks a run-carrying treatment and the later members keep it", () => {
  for (let seed = 1; seed < 40; seed++) {
    const first = photoTreatment(seed, 180, {
      kind: "photo",
      run: { index: 0, length: 3 },
    })!;
    assert.ok(RULES[first].run, first);
    assert.equal(
      photoTreatment(seed + 7, 180, {
        kind: "photo",
        run: { index: 1, length: 3 },
        runTreatment: first,
        previous: first,
      }),
      first,
    );
  }
  // A later member too short for the run's treatment takes its own pick instead.
  const t = photoTreatment(3, 32, {
    kind: "photo",
    run: { index: 1, length: 2 },
    runTreatment: "evidenceBoard",
  })!;
  assert.notEqual(t, "evidenceBoard");
});

test("a screenshot plays in the display of its year: a CRT to 2000, an LCD to 2010, then a flat screen; a phone for a mobile game", () => {
  assert.equal(displayFor(undefined), undefined);
  assert.equal(displayFor(1998), "crt");
  assert.equal(displayFor(2000), "crt");
  assert.equal(displayFor(2001), "lcd");
  assert.equal(displayFor(2010), "lcd");
  assert.equal(displayFor(2011), "flat");
  assert.equal(displayFor(2023, "PC, PlayStation 5"), "flat");
  assert.equal(displayFor(2015, "iOS, Android"), "phone");
  assert.equal(displayFor(1999, "iPhone"), "phone");
  // Every screen keeps the picture at least 60% of the frame tall.
  for (const k of ["crt", "lcd", "flat", "phone"] as const) {
    const s = screenBox(k);
    assert.ok(s.h >= 0.6 * FRAME_H, k);
    assert.ok(
      s.x >= 0 && s.x + s.w <= FRAME_W && s.y >= 0 && s.y + s.h <= FRAME_H,
      k,
    );
  }
});

const shot = (
  start: number,
  end: number,
  segment: number,
  media: LongShot["media"],
): LongShot => ({
  start,
  end,
  segment,
  media,
  move: "pushIn",
});
const img = (index: number) => ({ type: "image" as const, index });

test("the plan groups photo shots into runs by chapter and the 20 s rule, cut at three, and plans every second screenshot", () => {
  const images = [
    { kind: "photo", credit: "A" }, // 0
    { kind: "photo", credit: "B" }, // 1
    { kind: "photo", credit: "C" }, // 2
    { kind: "photo", credit: "D" }, // 3
    { kind: "screenshot" }, // 4
    { kind: "screenshot" }, // 5
    { kind: "screenshot" }, // 6
    { kind: "portrait", label: "SAM" }, // 7
    { kind: "photo", credit: "E" }, // 8
    { kind: "screenshot" }, // 9
  ];
  const shots: LongShot[] = [
    shot(0, 180, 0, img(0)), // chapter 0: a run of four photos, cut at three
    shot(180, 360, 0, img(1)),
    shot(360, 540, 0, img(2)),
    shot(540, 720, 0, img(3)),
    shot(720, 900, 0, img(4)), // screenshots: the first and third of the chapter play in a display
    shot(900, 1080, 0, img(5)),
    shot(1080, 1260, 0, img(6)),
    shot(1260, 1440, 1, img(7)), // chapter 1: a portrait, then a photo too far after it
    shot(1440 + NEIGHBOUR_FRAMES + 1, 1620 + NEIGHBOUR_FRAMES + 1, 1, img(8)),
    shot(1620 + NEIGHBOUR_FRAMES + 1, 1650 + NEIGHBOUR_FRAMES + 1, 1, img(9)), // a screenshot too short for a display
  ];
  const chapterOf = (segment: number) => segment;
  const eraOf = (chapter: number) =>
    chapter === 0 ? { year: 1998 } : { year: 2015, platforms: "iOS" };
  const { photos, displays } = planPhotoShots({
    shots,
    images,
    chapterOf,
    eraOf,
    baseSeed: 2,
  });
  assert.deepEqual([...photos.keys()], [0, 1, 2, 3, 7, 8]);
  const run1 = [0, 1, 2].map((i) => photos.get(i)!);
  assert.equal(run1[0]!.index, 0);
  assert.deepEqual(run1[2]!.earlier, [0, 1]);
  assert.equal(
    run1[1]!.treatment,
    run1[0]!.treatment,
    "a run shares its treatment",
  );
  assert.ok(RULES[run1[0]!.treatment].run);
  // The fourth photo starts a new run, which never repeats the run before.
  assert.equal(photos.get(3)!.index, 0);
  assert.deepEqual(photos.get(3)!.earlier, []);
  assert.notEqual(photos.get(3)!.treatment, run1[0]!.treatment);
  assert.equal(photos.get(0)!.year, 1998);
  assert.equal(photos.get(7)!.year, 2015);
  // The portrait never takes a treatment that would hide its face.
  assert.ok(RULES[photos.get(7)!.treatment].portrait);
  // Chapter 1's photo is a new run (too long after the portrait).
  assert.deepEqual(photos.get(8)!.earlier, []);
  // Displays: every second screenshot of a chapter, by the chapter's year; the short one skipped.
  assert.deepEqual([...displays.keys()], [4, 6]);
  assert.equal(displays.get(4)!.display, "crt");
  // Deterministic, and another base seed plans the same photo shots.
  assert.deepEqual(
    planPhotoShots({ shots, images, chapterOf, eraOf, baseSeed: 2 }).photos,
    photos,
  );
  assert.deepEqual(
    [
      ...planPhotoShots({
        shots,
        images,
        chapterOf,
        eraOf,
        baseSeed: 5,
      }).photos.keys(),
    ],
    [0, 1, 2, 3, 7, 8],
  );
  // Dressed shots (retro hardware, a period look, a detail zoom) are left alone.
  const dressed = planPhotoShots({
    shots,
    images,
    chapterOf,
    eraOf,
    dressed: new Set([4]),
    baseSeed: 2,
  });
  assert.deepEqual([...dressed.displays.keys()], [5]);
  assert.equal(MAX_RUN, 3);
});

test("the plan never gives two neighbouring runs or solos the same treatment", () => {
  const images = Array.from({ length: 12 }, (_, i) => ({
    kind: "photo",
    credit: `c${i}`,
  }));
  const shots = images.map((_, i) => shot(i * 1000, i * 1000 + 180, i, img(i)));
  for (let seed = 0; seed < 12; seed++) {
    const { photos } = planPhotoShots({
      shots,
      images,
      chapterOf: (s) => s,
      eraOf: () => ({ year: 1999 }),
      baseSeed: seed,
    });
    const seq = shots.map((_, i) => photos.get(i)!.treatment);
    for (let i = 1; i < seq.length; i++)
      assert.notEqual(seq[i], seq[i - 1], `seed ${seed}: ${seq.join(",")}`);
  }
});

test("a print's picture is at least 60% of the frame tall and never wider than the cap", () => {
  const b = pictureBox(1.5);
  assert.equal(b.h, MIN_PICTURE_H);
  assert.ok(b.h >= 0.6 * FRAME_H);
  assert.equal(b.w, 990);
  assert.equal(
    pictureBox(3).w,
    MAX_PICTURE_W,
    "a panorama is cropped, not shrunk",
  );
  assert.equal(
    pictureBox(0.3).w,
    pictureBox(0.6).w,
    "a tall picture is no narrower than 3:5",
  );
  assert.equal(pictureBox(1.5, 500).h, 500);
});

test("an instant print develops from a milky veil to full colour, and drops with a bounce", () => {
  assert.equal(develop(0).veil, 1);
  assert.equal(develop(1).veil, 0);
  assert.equal(develop(0).saturate, 0);
  assert.equal(develop(1).saturate, 1);
  let prev = develop(0);
  for (let t = 0.05; t <= 1; t += 0.05) {
    const d = develop(t);
    assert.ok(
      d.veil <= prev.veil &&
        d.contrast >= prev.contrast &&
        d.saturate >= prev.saturate,
    );
    prev = d;
  }
  assert.deepEqual(dropArc(1), { y: 0, scale: 1, shadow: 1 });
  assert.ok(dropArc(0).y < -400 && dropArc(0).scale > 1.2);
  assert.ok(
    dropArc(0.9).y < 0,
    "the bounce lifts it a little just before rest",
  );
  const stack = dropStack(3, 3);
  assert.deepEqual(dropStack(3, 3), stack);
  assert.equal(stack.earlier.length, 3);
  assert.ok(
    Math.abs(stack.newest.rot) >= 4 && Math.abs(stack.newest.rot) <= 13,
  );
  assert.notEqual(
    Math.sign(stack.earlier[0]!.x),
    Math.sign(stack.earlier[1]!.x),
    "earlier prints push out to alternate sides",
  );
  for (const e of stack.earlier)
    assert.ok(e.scale < 1 && Math.abs(e.x) >= 200 && Math.abs(e.x) <= 360);
  assert.notDeepEqual(dropStack(4, 3).newest, stack.newest);
});

test("the tape strips sit on the print's corners or its top edge, and the torch sweeps left to right", () => {
  for (let seed = 1; seed < 20; seed++) {
    const strips = tapeStrips(seed, 1000, 700);
    assert.equal(strips.length, 2);
    for (const s of strips) {
      assert.ok(s.x >= 0 && s.x <= 1000 && s.y >= 0 && s.y <= 700);
      assert.ok(s.len >= 230 && s.len <= 290);
    }
  }
  assert.ok(torchX(0) < 0 && torchX(1) > 1);
  let prev = torchX(0);
  for (let t = 0.1; t <= 1; t += 0.1) {
    assert.ok(torchX(t) > prev);
    prev = torchX(t);
  }
});

test("the evidence board keeps the newest photo in frame, the previous small at the left, the card beneath, the string between pins", () => {
  for (let seed = 1; seed < 20; seed++) {
    const { newest, previous, card } = boardLayout(seed, 1.5, true);
    const box = pictureBox(1.5);
    assert.ok(newest.x - box.w / 2 > 0 && newest.x + box.w / 2 < FRAME_W);
    assert.ok(newest.y - box.h / 2 > 0 && newest.y + box.h / 2 < FRAME_H);
    assert.ok(
      previous && previous.x + previous.w / 2 < newest.x - box.w / 2,
      "the previous photo clear of the newest",
    );
    assert.ok(card.y > newest.y + box.h / 2, "the card under the photo");
    assert.ok(Math.abs(newest.rot) <= 2 && Math.abs(previous!.rot) <= 5);
  }
  assert.equal(boardLayout(1, 1.5, false).previous, undefined);
  assert.match(
    stringPath({ x: 10, y: 20 }, { x: 110, y: 40 }),
    /^M 10\.0 20\.0 Q 60\.0 70\.0 110\.0 40\.0$/,
  );
});

test("the darkroom, camera, film, projector and album run their phases in order", () => {
  const d = darkroomPhases(180);
  assert.ok(d.developEnd < d.lift && d.lift < d.hung && d.hung < d.lightOn);
  assert.ok(d.developEnd >= 45 && d.developEnd <= 75);
  assert.ok(
    darkroomPhases(120).lightOn < 120,
    "a four second shot still gets its light",
  );
  assert.deepEqual(cameraPhases(0), { eject: 0, away: 0 });
  assert.equal(cameraPhases((EJECT_STEPS + 2) * 2.5).eject, 1);
  assert.equal(cameraPhases(38).away, 0);
  assert.equal(cameraPhases(80).away, 1);
  assert.ok(cameraPhases(20).eject > 0 && cameraPhases(20).eject < 1);
  const f0 = filmPhases(0);
  assert.deepEqual(f0, { slide: 0, loupe: 0, enlarge: 0 });
  assert.equal(filmPhases(30).slide, 1);
  assert.equal(filmPhases(34).loupe, 0);
  assert.equal(filmPhases(48).loupe, 1);
  assert.equal(filmPhases(78).enlarge, 1);
  assert.equal(filmOffset(1), 0);
  assert.ok(filmOffset(0) > 1000);
  assert.equal(slidePhases(0).drop, 0);
  assert.equal(slidePhases(CAROUSEL_STEPS * 2.5).drop, 0);
  assert.equal(slidePhases((CAROUSEL_STEPS + 3) * 2.5).drop, 1);
  assert.equal(slidePhases(100).focus, 1);
  const motes = dustMotes(3, 10);
  assert.deepEqual(dustMotes(3, 10), motes);
  assert.notDeepEqual(dustMotes(3, 11), motes);
  for (const m of motes)
    assert.ok(
      m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1 && m.a > 0 && m.a <= 0.75,
    );
  assert.equal(pageTurn(0), 0);
  assert.equal(pageTurn(3 * 2.5), 0, "a beat before the leaf moves");
  assert.equal(pageTurn(200), 1);
  let prev = 0;
  for (let f = 0; f < 60; f++) {
    assert.ok(pageTurn(f) >= prev);
    prev = pageTurn(f);
  }
});

test("the halftone is coarser on old paper, the scan bar overruns both ends, the lens stays on the picture", () => {
  assert.ok(halftone(1975).pitch > halftone(1990).pitch);
  assert.equal(halftone(undefined).pitch, halftone(1990).pitch);
  assert.ok(scanY(0) < 0 && scanY(1) > 1);
  for (let seed = 1; seed < 20; seed++)
    for (const t of [0, 0.5, 1]) {
      const p = lensPath(seed, 1000, 660, t);
      assert.ok(
        p.x > 150 && p.x < 850 && p.y > 150 && p.y < 510,
        `seed ${seed}`,
      );
    }
  assert.ok(
    lensPath(2, 1000, 660, 1).x > lensPath(2, 1000, 660, 0).x,
    "left to right",
  );
});

test("the drying line and light box place the earlier prints clear of the newest, inside the frame", () => {
  for (let seed = 1; seed < 20; seed++) {
    const line = lineLayout(seed, 5);
    assert.equal(line.earlier.length, 2, "two earlier prints at most");
    for (const e of line.earlier)
      assert.ok(e.x - e.w / 2 > 0 && e.x + e.w / 2 < line.newest.x - 515);
    assert.ok(line.newest.x > 600 && line.newest.x < 1400);
    const lb = lightBoxLayout(seed, 6);
    assert.equal(lb.earlier.length, 4);
    for (const e of lb.earlier) {
      assert.ok(e.x - e.w / 2 >= 0 && e.x + e.w / 2 <= FRAME_W);
      assert.ok(Math.abs(e.x - lb.newest.x) > 500, "clear of the middle");
    }
  }
  assert.equal(lineLayout(1, 0).earlier.length, 0);
  assert.equal(
    lineLayout(1, 0).newest.x < lineLayout(1, 2).newest.x,
    true,
    "alone, it hangs nearer the middle",
  );
  assert.equal(pegSwing(0), 0);
  assert.ok(
    Math.abs(pegSwing(5)) > Math.abs(pegSwing(60)),
    "the sway dies down",
  );
  assert.ok(Math.abs(pegSwing(100)) < 0.1);
});
