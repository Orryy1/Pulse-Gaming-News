// How a real picture (an archive photo, a portrait cut from footage, a screenshot) arrives on screen in a
// documentary. Every photo used to be the same framed print over its own blur; the owner asked (30 Oct 2026)
// for "Polaroids being dropped on top of each other, duct taped onto a wall, pinned on crime evidence
// boards, developed like a photograph, printing straight out of a camera ... even more varieties". This
// module is the pure half: which treatment each photo shot gets (from the chapter's year, the shot's length,
// the photo shots around it and a seed, never the same one twice in a row), which display a screenshot
// plays inside (a CRT, a bezelled LCD, a flat screen or a phone, by the game's year), and the geometry the
// treatments share (print sizes that keep the picture at least 60% of the frame height once settled, the
// drop stack, the tape strips, the board and line layouts, the red string, the develop curve). The
// components live in components/PhotoShot.tsx. Everything here is a pure function of its inputs.

import { rand } from "./components/packs/screen/common.ts";
import type { LongShot } from "./longplan.ts";
import { NEIGHBOUR_FRAMES, stepOf } from "./sketchplan.ts";

export type PhotoTreatment =
  | "instantDrop" // instant prints dropped onto a table over each other, each developing from milky grey-green
  | "ductTape" // a print held to a rough wall by two torn silver tape strips, a torch sweeping it as it lands
  | "evidenceBoard" // pinned to a cork board, a red string from the previous photo's pin, an index card under it
  | "darkroom" // under a red safelight the image rises out of the developing tray, then tongs hang it to dry
  | "cameraPrint" // an instant camera's print motoring out of its slot in steps, then developing
  | "filmStrip" // a 35 mm negative strip slides across, a loupe enlarges and inverts the chosen frame
  | "slideProjector" // a carousel click, the slide drops in with the lamp's glow, dust in the beam, a slight keystone
  | "albumPage" // a photo album, glassine corners, a page turning at 12 fps to reveal the print
  | "newsprint" // a halftone on newsprint with a visible dot screen, the caption as the cutline
  | "archiveScan" // a flatbed scanner's light bar sweeping an old photo, the clean scan resolving behind it
  | "magnifier" // a magnifying glass passing over a detail of the settled print, then lifting away
  | "manilaFolder" // the print sliding out of a manila folder stamped only with the chapter's year
  | "lightBox" // a light box with the chapter's prints laid flat, this one lifted to the middle
  | "dryingLine"; // wet prints pegged on a line in a row, this one pegged in and settling, the camera pushing in

export const PHOTO_TREATMENTS: readonly PhotoTreatment[] = [
  "instantDrop",
  "ductTape",
  "evidenceBoard",
  "darkroom",
  "cameraPrint",
  "filmStrip",
  "slideProjector",
  "albumPage",
  "newsprint",
  "archiveScan",
  "magnifier",
  "manilaFolder",
  "lightBox",
  "dryingLine",
];

/** The display a screenshot plays inside, by the game's year (and a phone for a mobile game). */
export type DisplayKind = "crt" | "lcd" | "flat" | "phone";

/** Picture kinds the photo treatments take. */
export type PhotoKind = "photo" | "portrait";

interface Rule {
  /** The last year the treatment suits (the chapter's year); absent, any. */
  eraTo?: number;
  /** The shortest shot (frames) the treatment plays out in. */
  minFrames: number;
  /** Fit for a portrait: never a negative, a keystone or a lens over a face. */
  portrait: boolean;
  /** Carries a run: successive photos of one chapter build on the ones before. */
  run: boolean;
}

export const RULES: Record<PhotoTreatment, Rule> = {
  instantDrop: { minFrames: 30, portrait: true, run: true },
  ductTape: { minFrames: 30, portrait: true, run: false },
  evidenceBoard: { minFrames: 45, portrait: true, run: true },
  darkroom: { eraTo: 2005, minFrames: 120, portrait: true, run: false },
  cameraPrint: { minFrames: 60, portrait: true, run: false },
  filmStrip: { eraTo: 2005, minFrames: 75, portrait: false, run: false },
  slideProjector: { eraTo: 2000, minFrames: 45, portrait: false, run: false },
  albumPage: { minFrames: 45, portrait: true, run: true },
  newsprint: { eraTo: 1995, minFrames: 30, portrait: false, run: false },
  archiveScan: { minFrames: 60, portrait: true, run: false },
  magnifier: { minFrames: 75, portrait: false, run: false },
  manilaFolder: { minFrames: 60, portrait: true, run: false },
  lightBox: { minFrames: 60, portrait: true, run: true },
  dryingLine: { minFrames: 60, portrait: true, run: true },
};

/** A shot shorter than this (0.8 s) keeps the static print: nothing has time to happen. */
export const MIN_SHOT_FRAMES = 24;
/** A run of photos in a chapter is at most this long, so a chapter's five photos do not all look alike. */
export const MAX_RUN = 3;

/** A credit line that names a press outlet or agency: the photo was a press picture. */
export function pressCredit(credit: string | undefined): boolean {
  if (!credit) return false;
  return /\b(press|news|times|post|gazette|herald|tribune|journal|magazine|daily|reuters|associated press|getty|agency|archive|bild|afp|upi)\b/i.test(
    credit,
  );
}

/** What a photo shot knows about its place. */
export interface PhotoContext {
  kind: PhotoKind;
  /** The chapter's year (the game's); unknown counts as now. */
  year?: number;
  /** The photo's credit line, as the corner shows it. */
  credit?: string;
  /** Photo shots of one chapter close together: this one's place in that run (MAX_RUN long at most). */
  run: { index: number; length: number };
  /** The treatment of the photo before this one in the video, however far back (a run's own excluded). */
  previous?: PhotoTreatment;
  /** The treatment this run settled on at its first member; later members keep it. */
  runTreatment?: PhotoTreatment;
}

/** Whether a treatment suits a shot: its era, its length, a portrait's face. */
export function eligible(
  t: PhotoTreatment,
  lenFrames: number,
  ctx: Pick<PhotoContext, "kind" | "year" | "credit">,
): boolean {
  const r = RULES[t];
  if (lenFrames < r.minFrames) return false;
  if (ctx.kind === "portrait" && !r.portrait) return false;
  if (r.eraTo !== undefined) {
    // Newsprint also suits a press picture of any year; the other period treatments need the year.
    if (t === "newsprint" && pressCredit(ctx.credit)) return true;
    if (ctx.year === undefined || ctx.year > r.eraTo) return false;
  }
  return true;
}

/**
 * The treatment for one photo. The later members of a run keep the run's treatment (an instant print
 * drops over the last, the string runs from the previous pin); a run's first member and every solo photo
 * take a seeded pick from what suits the shot (its era, its length, a portrait), never the treatment of the
 * photo before. A run's first member picks from the run-carrying treatments. Undefined: the static print.
 */
export function photoTreatment(
  seed: number,
  lenFrames: number,
  ctx: PhotoContext,
): PhotoTreatment | undefined {
  if (lenFrames < MIN_SHOT_FRAMES) return undefined;
  if (
    ctx.run.index >= 1 &&
    ctx.runTreatment &&
    eligible(ctx.runTreatment, lenFrames, ctx)
  )
    return ctx.runTreatment;
  let pool = PHOTO_TREATMENTS.filter((t) => eligible(t, lenFrames, ctx));
  if (ctx.run.length >= 2 && ctx.run.index === 0) {
    const runnable = pool.filter((t) => RULES[t].run);
    if (runnable.length) pool = runnable;
  }
  const open = pool.filter((t) => t !== ctx.previous);
  const from = open.length ? open : pool;
  if (!from.length) return undefined;
  return from[Math.floor(rand(seed) * from.length) % from.length];
}

/** Which display a screenshot plays inside, by the game's year; a phone for a mobile game; none without a year. */
export function displayFor(
  year: number | undefined,
  platforms?: string,
): DisplayKind | undefined {
  if (!year) return undefined;
  if (
    platforms &&
    /\b(ios|android|iphone|ipad|mobile|phone)\b/i.test(platforms)
  )
    return "phone";
  if (year <= 2000) return "crt";
  if (year <= 2010) return "lcd";
  return "flat";
}

/** A screenshot shot shorter than this (2 s) plays full-bleed: a display needs time to read. */
export const MIN_DISPLAY_FRAMES = 60;

/** A photo shot's plan: its treatment and the pictures the treatment needs. */
export interface PhotoDecision {
  treatment: PhotoTreatment;
  seed: number;
  /** This photo's place in its run, from 0. */
  index: number;
  /** The run's earlier photos (image indices), oldest first: under the newest print, pinned at the side. */
  earlier: number[];
  /** The chapter's year, for the folder's stamp and the era looks. */
  year?: number;
}

/** A screenshot shot's plan: the display it plays inside. */
export interface DisplayDecision {
  display: DisplayKind;
  seed: number;
}

export interface PhotoPlanInput {
  shots: readonly LongShot[];
  images: ReadonlyArray<{ kind: string; credit?: string }>;
  chapterOf: (segment: number) => number;
  /** The chapter's year and platforms, as the chapter card carries them. */
  eraOf: (chapter: number) => { year?: number; platforms?: string };
  /** Shot indices already dressed (a retro device, a period look, a detail zoom): their screenshots stay as they are. */
  dressed?: ReadonlySet<number>;
  baseSeed?: number;
}

/**
 * Every photo and portrait shot of a plan with its treatment, and every second screenshot shot with its
 * display. Runs are photo shots of one chapter that start within NEIGHBOUR_FRAMES of the previous photo's
 * end, cut at MAX_RUN; the pick alternates through the whole video.
 */
export function planPhotoShots(input: PhotoPlanInput): {
  photos: Map<number, PhotoDecision>;
  displays: Map<number, DisplayDecision>;
} {
  const { shots, images, chapterOf, eraOf, dressed, baseSeed = 0 } = input;
  const photos = new Map<number, PhotoDecision>();
  const displays = new Map<number, DisplayDecision>();
  const runs: number[][] = [];
  let last: { end: number; chapter: number } | undefined;
  shots.forEach((s, i) => {
    if (s.media.type !== "image") return;
    const kind = images[s.media.index]?.kind;
    if (kind !== "photo" && kind !== "portrait") return;
    const chapter = chapterOf(s.segment);
    const run = runs[runs.length - 1];
    if (
      last &&
      run &&
      last.chapter === chapter &&
      s.start - last.end <= NEIGHBOUR_FRAMES &&
      run.length < MAX_RUN
    )
      run.push(i);
    else runs.push([i]);
    last = { end: s.end, chapter };
  });
  let previous: PhotoTreatment | undefined;
  for (const run of runs) {
    let runTreatment: PhotoTreatment | undefined;
    // A run's members that take the static print (too short) drop out of it, so the earlier list only
    // holds photos the viewer saw in the treatment.
    const kept: number[] = [];
    run.forEach((i) => {
      const s = shots[i]!;
      const im = images[s.media.index]!;
      const chapter = chapterOf(s.segment);
      const seed = (baseSeed * 7919 + s.media.index * 131 + s.start) | 0;
      const treatment = photoTreatment(seed, s.end - s.start, {
        kind: im.kind as PhotoKind,
        year: eraOf(chapter).year,
        credit: im.credit,
        run: { index: kept.length, length: run.length },
        previous,
        runTreatment,
      });
      if (!treatment) return;
      if (kept.length === 0) runTreatment = treatment;
      photos.set(i, {
        treatment,
        seed,
        index: kept.length,
        earlier: kept.map((j) => shots[j]!.media.index),
        year: eraOf(chapter).year,
      });
      kept.push(i);
    });
    if (runTreatment) previous = runTreatment;
  }
  // Screenshots: every second long enough one of a chapter plays inside the display of its day, so the
  // full-bleed picture stays the norm and a dressed shot (retro hardware, a period look) is never framed twice.
  const count = new Map<number, number>();
  shots.forEach((s, i) => {
    if (s.media.type !== "image") return;
    if (images[s.media.index]?.kind !== "screenshot") return;
    if (dressed?.has(i)) return;
    if (s.end - s.start < MIN_DISPLAY_FRAMES) return;
    const chapter = chapterOf(s.segment);
    const era = eraOf(chapter);
    const display = displayFor(era.year, era.platforms);
    if (!display) return;
    const n = count.get(chapter) ?? 0;
    count.set(chapter, n + 1);
    if ((n + baseSeed) % 2 !== 0) return;
    displays.set(i, {
      display,
      seed: (baseSeed * 7919 + s.media.index * 131 + s.start) | 0,
    });
  });
  return { photos, displays };
}

// ---- Geometry the treatments share ----------------------------------------------------------------

export const FRAME_W = 1920;
export const FRAME_H = 1080;
/** The picture itself, once settled, is at least this tall: 60% of the frame plus a little. */
export const MIN_PICTURE_H = 660;
/** No print wider than this: a panorama is cropped to fit rather than shrunk under the height rule. */
export const MAX_PICTURE_W = 1500;

/**
 * The picture's box in a print: as tall as the height rule asks, as wide as its aspect wants, cropped to
 * MAX_PICTURE_W when the aspect would run past it. `h` may be asked larger for a bigger print.
 */
export function pictureBox(
  aspect: number,
  h = MIN_PICTURE_H,
): { w: number; h: number } {
  const a = Math.max(0.6, aspect);
  const w = Math.min(MAX_PICTURE_W, Math.round(h * a));
  return { w, h };
}

/** An instant print's borders around its picture: thin sides and top, the thick bottom to hold it by. */
export const INSTANT_BORDER = { side: 26, top: 26, bottom: 104 } as const;

export interface Placed {
  x: number; // px offset of the centre from the frame's centre
  y: number;
  rot: number; // degrees
  scale: number;
}

/**
 * The stack of instant prints on the table: the newest centred and largest at a seeded angle, the earlier
 * ones (oldest first) under it, smaller, each pushed out a different way so a corner of every one shows.
 */
export function dropStack(
  seed: number,
  earlierCount: number,
): { newest: Placed; earlier: Placed[] } {
  const r = (i: number) => rand(seed * 41 + i);
  const sign = (i: number) => (r(i) < 0.5 ? -1 : 1);
  const newest: Placed = {
    x: (r(1) - 0.5) * 40,
    y: (r(2) - 0.5) * 24,
    rot: sign(3) * (4 + r(4) * 9),
    scale: 1,
  };
  const earlier = Array.from({ length: earlierCount }, (_, k) => {
    // The one just before leans the other way from the newest, the one before that the other way again.
    const side = k % 2 ? -Math.sign(newest.rot) : Math.sign(newest.rot);
    return {
      x: side * (200 + r(10 + k) * 160),
      y: (r(20 + k) - 0.5) * 160 - 30,
      rot: -side * (10 + r(30 + k) * 14),
      scale: 0.84,
    };
  });
  return { newest, earlier };
}

/** Frames an instant print takes to develop: about 1.5 s. */
export const DEVELOP_FRAMES = 45;

/**
 * The develop curve: at `t` 0..1 the milky grey-green veil's opacity and the picture's contrast and
 * saturation under it. The veil lifts first, the colour comes last, as an instant print does.
 */
export function develop(t: number): {
  veil: number;
  contrast: number;
  saturate: number;
  brightness: number;
} {
  const x = Math.max(0, Math.min(1, t));
  const ease = x * x * (3 - 2 * x);
  return {
    veil: 1 - ease,
    contrast: 0.35 + 0.65 * ease,
    saturate: Math.min(1, Math.max(0, (x - 0.35) / 0.65)) ** 0.8,
    brightness: 1.35 - 0.35 * ease,
  };
}

/** The milky veil's colour: the grey-green of an instant print before the dyes arrive. */
export const MILK = "#b9c0b4";

/** A print dropped from above: its height, scale and shadow at `t` 0..1 of the fall, landing with a small bounce. */
export function dropArc(t: number): {
  y: number;
  scale: number;
  shadow: number;
} {
  const x = Math.max(0, Math.min(1, t));
  if (x >= 1) return { y: 0, scale: 1, shadow: 1 };
  const fall = x * x; // gravity
  const bounce = x > 0.85 ? Math.sin(((x - 0.85) / 0.15) * Math.PI) * 10 : 0;
  return {
    y: -420 * (1 - fall) - bounce,
    scale: 1 + 0.22 * (1 - fall),
    shadow: 0.3 + 0.7 * fall,
  };
}

export interface Strip {
  x: number; // centre, px from the print's top-left
  y: number;
  rot: number;
  len: number;
}

/** Two torn tape strips over a w by h print: across two opposite corners, or the top two, by seed. */
export function tapeStrips(seed: number, w: number, h: number): Strip[] {
  const r = (i: number) => rand(seed * 59 + i);
  const len = 230 + r(1) * 60;
  if (r(2) < 0.5)
    return [
      { x: 30, y: 30, rot: -45 + (r(3) - 0.5) * 14, len },
      { x: w - 30, y: h - 30, rot: -45 + (r(4) - 0.5) * 14, len },
    ];
  return [
    { x: w * 0.22, y: 0, rot: (r(5) - 0.5) * 16, len },
    { x: w * 0.78, y: 0, rot: (r(6) - 0.5) * 16, len },
  ];
}

/** Where the torch's beam is across the wall at `t` 0..1: a sweep from off the left to off the right, slowing. */
export function torchX(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  const eased = 1 - (1 - x) ** 2;
  return -0.25 + 1.5 * eased;
}

export interface BoardPlace {
  x: number; // centre, px in the 1920 by 1080 board
  y: number;
  w: number; // the picture's width
  rot: number;
}

/**
 * The evidence board: the newest photo right of centre (its picture at the height rule), the previous one
 * small at the left side, the index card under the newest. Seeded nudges and tilts.
 */
export function boardLayout(
  seed: number,
  aspect: number,
  hasPrevious: boolean,
): { newest: BoardPlace; previous?: BoardPlace; card: BoardPlace } {
  const r = (i: number) => rand(seed * 67 + i);
  const box = pictureBox(aspect);
  const newest: BoardPlace = {
    x: (hasPrevious ? 1090 : 960) + (r(1) - 0.5) * 50,
    y: 455 + (r(2) - 0.5) * 20,
    w: box.w,
    rot: (r(3) - 0.5) * 4,
  };
  const previous: BoardPlace | undefined = hasPrevious
    ? {
        x: 300 + (r(4) - 0.5) * 40,
        y: 400 + (r(5) - 0.5) * 60,
        w: 400,
        rot: (r(6) - 0.5) * 10,
      }
    : undefined;
  const card: BoardPlace = {
    x: newest.x + (r(7) - 0.5) * 60,
    y: newest.y + box.h / 2 + 36 + 78,
    w: Math.min(box.w, 620),
    rot: (r(8) - 0.5) * 5,
  };
  return { newest, previous, card };
}

/** The red string from pin to pin: an SVG path that sags a little between them. */
export function stringPath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  sag = 40,
): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + sag;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/**
 * The darkroom's phases (frames): the image rises in the tray for `developEnd`, the tongs lift the print
 * from `lift`, it hangs on the line from `hung`, and the room light comes up from `lightOn`.
 */
export function darkroomPhases(lenFrames: number): {
  developEnd: number;
  lift: number;
  hung: number;
  lightOn: number;
} {
  const developEnd = Math.round(Math.max(45, Math.min(75, lenFrames * 0.4)));
  const lift = developEnd + 10;
  const hung = lift + 24;
  return { developEnd, lift, hung, lightOn: hung + 6 };
}

/** The instant camera: the print's ejection runs this many 12 fps steps (a second), then it develops. */
export const EJECT_STEPS = 12;

/**
 * The camera print's phases: the print motors out of the slot stepped (`eject` 0..1 by step), then the
 * camera pulls away up and off while the print rises to the middle and grows (`away` 0..1), developing.
 */
export function cameraPhases(frame: number): { eject: number; away: number } {
  const step = stepOf(frame);
  const eject = Math.max(0, Math.min(1, (step - 2) / EJECT_STEPS));
  const t = Math.max(
    0,
    Math.min(1, (frame - (EJECT_STEPS + 2) * 2.5 - 4) / 22),
  );
  const away = t * t * (3 - 2 * t);
  return { eject, away };
}

/** A 35 mm frame on the strip: this wide at the strip's scale, this far apart. */
export const FILM_FRAME_W = 420;
export const FILM_FRAME_H = 280;
export const FILM_PITCH = 450;
/** The strip's film base: sprocket holes along both edges. */
export const FILM_STRIP_H = 400;

/**
 * The film strip's phases: it slides across for 30 frames stopping with the chosen frame at the middle
 * (`slide` 0..1), the loupe grows over it (`loupe` 0..1) and from `enlarge` the positive grows to a print.
 */
export function filmPhases(frame: number): {
  slide: number;
  loupe: number;
  enlarge: number;
} {
  const e = (x: number) => 1 - (1 - Math.max(0, Math.min(1, x))) ** 3;
  return {
    slide: e(frame / 30),
    loupe: e((frame - 34) / 14),
    enlarge: e((frame - 62) / 16),
  };
}

/** Where the film strip sits at `slide` 0..1: from the chosen frame three frames right of the middle to centred. */
export function filmOffset(slide: number): number {
  return (1 - slide) * FILM_PITCH * 3;
}

/** The slide projector: the carousel's advance runs this many 12 fps steps before the slide drops in. */
export const CAROUSEL_STEPS = 4;

/**
 * The projected slide's phases: dark while the carousel clicks (`drop` 0 until step CAROUSEL_STEPS), the slide
 * dropping into the gate over three steps, then the lamp's focus pulling sharp (`focus` 0..1).
 */
export function slidePhases(frame: number): { drop: number; focus: number } {
  const step = stepOf(frame);
  const drop = Math.max(0, Math.min(1, (step - CAROUSEL_STEPS) / 3));
  const focus = Math.max(
    0,
    Math.min(1, (frame - (CAROUSEL_STEPS + 3) * 2.5) / 18),
  );
  return { drop, focus };
}

/** Dust motes in the projector's beam: seeded positions that drift up and across slowly. */
export function dustMotes(
  seed: number,
  frame: number,
  n = 28,
): Array<{ x: number; y: number; r: number; a: number }> {
  return Array.from({ length: n }, (_, k) => {
    const r = (i: number) => rand(seed * 73 + k * 11 + i);
    const speed = 0.12 + r(1) * 0.3;
    return {
      x:
        (r(2) +
          Math.sin(frame * 0.02 + k) * 0.01 +
          frame * 0.0004 * (r(5) - 0.5)) %
        1,
      y: (r(3) + 2 - (frame * speed) / 1080) % 1,
      r: 1.2 + r(4) * 2.4,
      a: 0.25 + 0.5 * Math.abs(Math.sin(frame * 0.05 + k)),
    };
  });
}

/** The album page turns over this many 12 fps steps (0.75 s), after a beat of the closed page. */
export const PAGE_STEPS = 9;
export const PAGE_WAIT_STEPS = 3;

/** The album page's turn at a frame: 0 flat on the right, 1 flat on the left; stepped, eased. */
export function pageTurn(frame: number): number {
  const step = stepOf(frame) - PAGE_WAIT_STEPS;
  if (step <= 0) return 0;
  if (step >= PAGE_STEPS) return 1;
  const x = step / PAGE_STEPS;
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}

/** Halftone: the dot screen's pitch (px) and angle for a year; coarser the older the paper. */
export function halftone(year: number | undefined): {
  pitch: number;
  angle: number;
} {
  if (year !== undefined && year < 1980) return { pitch: 7, angle: 15 };
  return { pitch: 5.5, angle: 22 };
}

/** The scanner's light bar at `t` 0..1 of its pass: its y (0..1 of the photo's height), overrunning both ends. */
export function scanY(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return -0.08 + 1.16 * x;
}

/**
 * The magnifying glass's path over a w by h print: from one seeded detail to another across the picture
 * (never the dead centre, never the edges), then lifting away. The lens's centre at `t` 0..1.
 */
export function lensPath(
  seed: number,
  w: number,
  h: number,
  t: number,
): { x: number; y: number } {
  const r = (i: number) => rand(seed * 83 + i);
  const a = { x: w * (0.22 + r(1) * 0.2), y: h * (0.3 + r(2) * 0.4) };
  const b = { x: w * (0.58 + r(3) * 0.2), y: h * (0.3 + r(4) * 0.4) };
  const x = Math.max(0, Math.min(1, t));
  const e = x * x * (3 - 2 * x);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}

/** The lens magnifies this much. */
export const LENS_ZOOM = 1.7;

/**
 * The drying line: pegs along a sagging line, the earlier prints (oldest first) hanging small to the left,
 * this one pegged near the middle. Each place is the peg's x and the print's width and small tilt.
 */
export function lineLayout(
  seed: number,
  earlierCount: number,
): {
  newest: { x: number; w: number; rot: number };
  earlier: Array<{ x: number; w: number; rot: number }>;
} {
  const r = (i: number) => rand(seed * 89 + i);
  const n = Math.min(earlierCount, 2);
  const newest = {
    x: 960 + (n ? 220 : 0) + (r(1) - 0.5) * 60,
    w: 0,
    rot: (r(2) - 0.5) * 3,
  };
  const earlier = Array.from({ length: n }, (_, k) => ({
    x: 170 + k * 300 + (r(10 + k) - 0.5) * 30,
    w: 260,
    rot: (r(20 + k) - 0.5) * 6,
  }));
  return { newest, earlier };
}

/** A wet print's swing after pegging: a damped sway in degrees at `t` frames after the peg closes. */
export function pegSwing(t: number): number {
  if (t <= 0) return 0;
  return 4 * Math.exp(-t / 22) * Math.sin(t / 5);
}

/**
 * The light box: the earlier prints laid flat around the edges (oldest first), this one lifted to the middle.
 * Each place is a centre, width and tilt in the 1920 by 1080 frame.
 */
export function lightBoxLayout(
  seed: number,
  earlierCount: number,
): { newest: BoardPlace; earlier: BoardPlace[] } {
  const r = (i: number) => rand(seed * 97 + i);
  const slots: Array<[number, number]> = [
    [230, 250],
    [1690, 250],
    [230, 830],
    [1690, 830],
  ];
  const n = Math.min(earlierCount, slots.length);
  return {
    newest: {
      x: 960 + (r(1) - 0.5) * 30,
      y: 520 + (r(2) - 0.5) * 20,
      w: 0,
      rot: (r(3) - 0.5) * 3,
    },
    earlier: Array.from({ length: n }, (_, k) => {
      const [x, y] = slots[(k + Math.floor(r(4) * 4)) % slots.length]!;
      return { x, y, w: 360, rot: (r(10 + k) - 0.5) * 16 };
    }),
  };
}

/** The screen inside a display: its box and corner radius in the 1920 by 1080 frame, by kind. */
export function screenBox(kind: DisplayKind): {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
} {
  switch (kind) {
    case "crt":
      return { x: 250, y: 92, w: 1420, h: 800, radius: 48 };
    case "lcd":
      return { x: 180, y: 70, w: 1560, h: 878, radius: 6 };
    case "flat":
      return { x: 120, y: 60, w: 1680, h: 945, radius: 10 };
    case "phone":
      return { x: 190, y: 190, w: 1540, h: 700, radius: 54 };
  }
}
