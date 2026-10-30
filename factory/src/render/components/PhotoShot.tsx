// A real picture's shot in a documentary: how an archive photo, a portrait or a screenshot arrives
// (../photoplan.ts decides which; this file draws it). The owner asked (30 Oct 2026) for "Polaroids being
// dropped on top of each other, duct taped onto a wall, pinned on crime evidence boards, developed like a
// photograph, printing straight out of a camera ... loads of things like that idea but even more varieties".
// Fourteen photo treatments and four displays, every one a pure function of the frame and a seed:
//
//   instantDrop    instant prints with the thick bottom border dropping onto the table over the last at a
//                  seeded angle, each developing from milky grey-green to full colour in about 1.5 s
//   ductTape       a print held to a rough plaster wall by two torn strips of silver tape with a sheen, a
//                  torch beam sweeping the wall as it lands
//   evidenceBoard  the photo pinned to cork, a red string drawn from the previous photo's pin (that photo
//                  small at the side), an index card beneath carrying only the existing caption
//   darkroom       a red safelight, the print in the developing tray, the image rising out of the liquid
//                  with soft ripples, tongs lifting it to the drying line, the room light coming up
//   cameraPrint    a drawn instant camera; the print motors out of its slot in 12 fps steps, the camera
//                  pulls away and the print develops in the middle
//   filmStrip      a 35 mm negative strip with sprocket holes slides across; a loupe enlarges and inverts
//                  the chosen frame to the positive, which grows to a print
//   slideProjector a carousel's clicks, the slide dropping into the gate with the lamp's glow, dust in the
//                  beam, the focus pulling sharp, a slight keystone on the wall
//   albumPage      a photo album, glassine corners, the leaf turning over the spine at 12 fps to reveal the
//                  print, the camera settling in on it
//   newsprint      the photo as a halftone on newsprint with a visible dot screen, columns of grey type
//                  beside it (bars, never words) and the caption set as the cutline
//   archiveScan    a flatbed's light bar sweeping an old, faded photo; the clean scan resolves behind the
//                  bar under a faint scanned vignette
//   magnifier      (own) a magnifying glass with a brass rim passing over a detail of the settled print, the
//                  lens enlarging what is under it, then lifting away
//   manilaFolder   (own) a manila folder stamped only with the chapter's year; the print slides out of it and
//                  settles on top
//   lightBox       (own) a light box with the chapter's earlier prints laid flat on the glass, this one
//                  lifted to the middle, its shadow growing as it leaves the surface
//   dryingLine     (own) a line with wooden pegs, the earlier prints hanging small, this one pegged in wet,
//                  swinging to rest, the camera pushing in on it
//   displays       a screenshot playing inside the screen of its day: a CRT with scanlines and curvature,
//                  a bezelled LCD monitor, a flat screen, or a phone for a mobile game; the existing Ken Burns
//                  move keeps running inside the glass
//
// Every treatment keeps the picture readable: at least 60% of the frame height once settled. Portraits are
// never shown as negatives, keystoned or under a lens (photoplan.ts keeps those treatments off them), so the
// name tag over a portrait still reads. The only words drawn here are the existing caption (the credit line
// the corner already shows, or a portrait's name) and the chapter's year on the folder stamp. Paper, cork,
// tape, pins and grain come from the Paper pack and the explainer backgrounds; nothing from a file. SVG
// filters (the tray's ripple) are bounded and only run during their phase; the rest is CSS transforms.

import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { BODY, DISPLAY } from "./fonts.ts";
import { moveTransform, type MovePreset } from "../motion.ts";
import {
  GRAIN,
  INK,
  INK_MASK,
  MOTTLE,
  Pin,
  SERIF,
  TYPEFACE,
  Tape,
  paperLayers,
} from "./packs/paper/kit.tsx";
import { easeInOut, easeOut, rand } from "./packs/screen/common.ts";
import { TextureBackground } from "./Backgrounds.tsx";
import { stepOf } from "../sketchplan.ts";
import {
  CAROUSEL_STEPS,
  DEVELOP_FRAMES,
  FILM_FRAME_H,
  FILM_FRAME_W,
  FILM_PITCH,
  FILM_STRIP_H,
  INSTANT_BORDER,
  LENS_ZOOM,
  MILK,
  type DisplayKind,
  type PhotoTreatment,
  boardLayout,
  cameraPhases,
  darkroomPhases,
  develop,
  displayFor,
  dropArc,
  dropStack,
  dustMotes,
  filmOffset,
  filmPhases,
  halftone,
  lensPath,
  lightBoxLayout,
  lineLayout,
  pageTurn,
  pegSwing,
  pictureBox,
  scanY,
  screenBox,
  slidePhases,
  stringPath,
  tapeStrips,
  torchX,
} from "../photoplan.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** Photo paper: whiter and cooler than the Paper pack's cream sheets. */
const PHOTO_PAPER = "#f3f1ec";
/** The plain print's border. */
const PRINT_PAD = 16;

export interface PhotoPicture {
  src: string;
  aspect: number;
}

export interface PhotoShotProps extends PhotoPicture {
  /** Frames of the shot's sequence (with the dissolve from the shot before). */
  len: number;
  move: MovePreset;
  treatment: PhotoTreatment;
  seed: number;
  kind: "photo" | "portrait";
  /** The words the shot already shows: the credit line, or a portrait's name. Nothing else is written. */
  caption?: string;
  /** The chapter's year: the folder's stamp, the halftone's coarseness. */
  year?: number;
  /** This photo's place in its run, from 0. */
  index?: number;
  /** The run's earlier photos, oldest first: under the newest print, pinned at the side, on the line. */
  earlier?: PhotoPicture[];
}

const pic = (
  src: string,
  style?: React.CSSProperties,
  filter = "contrast(1.04) saturate(0.96)",
) => (
  <Img
    src={src}
    style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      filter,
      display: "block",
      ...style,
    }}
  />
);

/** The picture's own blurred, darkened copy behind it: the framed print's desk. */
const BlurDesk: React.FC<{ src: string; dark?: number }> = ({
  src,
  dark = 0.4,
}) => (
  <Img
    src={src}
    style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      filter: `blur(36px) brightness(${dark}) saturate(1.1)`,
      transform: "scale(1.2)",
    }}
  />
);

/** A dark table top drawn in code, lit from above. */
const Desk: React.FC<{ tone?: "wood" | "slate" }> = ({ tone = "wood" }) => (
  <AbsoluteFill
    style={{
      background:
        tone === "wood"
          ? "linear-gradient(160deg, #3b2b1d 0%, #2a1d13 55%, #17100b 100%)"
          : "linear-gradient(160deg, #2b2d31 0%, #1d1f23 55%, #0f1012 100%)",
    }}
  >
    <AbsoluteFill
      style={{
        backgroundImage: `${GRAIN}, repeating-linear-gradient(97deg, rgba(255,255,255,0.03) 0 3px, rgba(0,0,0,0.04) 3px 11px)`,
        opacity: 0.9,
      }}
    />
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse at 50% 42%, rgba(255,235,200,0.14) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)",
      }}
    />
  </AbsoluteFill>
);

/** Plaster relief: a 600 px tile of lit turbulence, drawn once by the browser and repeated. */
const PLASTER = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><filter id='p' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.02' numOctaves='4' seed='9' stitchTiles='stitch' result='n'/>" +
    "<feDiffuseLighting in='n' lighting-color='#fff' surfaceScale='3.5' diffuseConstant='1'><feDistantLight azimuth='215' elevation='55'/></feDiffuseLighting>" +
    "<feColorMatrix type='matrix' values='0.5 0 0 0 0.25  0.5 0 0 0 0.25  0.5 0 0 0 0.25  0 0 0 0 0.55'/></filter>" +
    "<rect width='600' height='600' filter='url(#p)'/></svg>",
)}")`;

/** A rough plaster wall: a lit relief, fine grain and a few darker patches, lit from one side. */
const Wall: React.FC<{ seed: number }> = ({ seed }) => (
  <AbsoluteFill style={{ background: "#8d8a82" }}>
    <AbsoluteFill
      style={{
        backgroundImage: `${GRAIN}, ${PLASTER}, ${MOTTLE}`,
        backgroundSize: "240px 240px, 600px 600px, 700px 700px",
        backgroundPosition: `0 0, ${(seed * 97) % 600}px ${(seed * 31) % 600}px, ${(seed * 53) % 500}px 0`,
        opacity: 0.9,
      }}
    />
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0) 50%), linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 100%)",
      }}
    />
  </AbsoluteFill>
);

/** An instant print: the thick bottom border, the picture developing under its milky veil. */
const InstantPrint: React.FC<{
  src: string;
  aspect: number;
  developT: number;
  h?: number;
  style?: React.CSSProperties;
}> = ({ src, aspect, developT, h, style }) => {
  const box = pictureBox(aspect, h);
  const d = develop(developT);
  return (
    <div
      style={{
        position: "absolute",
        width: box.w + 2 * INSTANT_BORDER.side,
        height: box.h + INSTANT_BORDER.top + INSTANT_BORDER.bottom,
        background: "#f7f6f2",
        backgroundImage: `${GRAIN}, linear-gradient(170deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 40%, rgba(0,0,0,0.06) 100%)`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: INSTANT_BORDER.side,
          top: INSTANT_BORDER.top,
          width: box.w,
          height: box.h,
          overflow: "hidden",
          background: "#1c1d1b",
        }}
      >
        {pic(
          src,
          undefined,
          `contrast(${d.contrast.toFixed(3)}) saturate(${d.saturate.toFixed(3)}) brightness(${d.brightness.toFixed(3)})`,
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: MILK,
            opacity: d.veil * 0.92,
          }}
        />
      </div>
    </div>
  );
};

/** A plain print: a white border round the picture, a gloss across it. */
const Print: React.FC<{
  src: string;
  aspect: number;
  h?: number;
  pad?: number;
  gloss?: number;
  filter?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({
  src,
  aspect,
  h,
  pad = PRINT_PAD,
  gloss = 0.18,
  filter,
  style,
  children,
}) => {
  const box = pictureBox(aspect, h);
  return (
    <div
      style={{
        position: "absolute",
        width: box.w + 2 * pad,
        height: box.h + 2 * pad,
        background: PHOTO_PAPER,
        backgroundImage: GRAIN,
        boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: pad,
          top: pad,
          width: box.w,
          height: box.h,
          overflow: "hidden",
          background: "#1c1d1b",
        }}
      >
        {pic(src, undefined, filter)}
        {gloss > 0 ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(115deg, rgba(255,255,255,0.0) 30%, rgba(255,255,255,0.5) 46%, rgba(255,255,255,0.0) 58%)",
              opacity: gloss,
            }}
          />
        ) : null}
        {children}
      </div>
    </div>
  );
};

/** Centres a child of w by h at an offset from the frame's middle with a tilt and scale. */
const At: React.FC<{
  x?: number;
  y?: number;
  rot?: number;
  scale?: number;
  w: number;
  h: number;
  cx?: number;
  cy?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({
  x = 0,
  y = 0,
  rot = 0,
  scale = 1,
  w,
  h,
  cx = 960,
  cy = 540,
  style,
  children,
}) => (
  <div
    style={{
      position: "absolute",
      left: cx - w / 2 + x,
      top: cy - h / 2 + y,
      width: w,
      height: h,
      transform: `rotate(${rot}deg) scale(${scale})`,
      ...style,
    }}
  >
    {children}
  </div>
);

/** The ambient camera move, halved: a slow push or drift on the settled picture. */
const ambient = (move: MovePreset, frame: number, len: number) => {
  const m = moveTransform(move, Math.min(1, frame / Math.max(1, len)));
  return `translate(${m.x * 0.5}px, ${m.y * 0.5}px) scale(${1 + (m.scale - 1) * 0.5})`;
};

// ---- 1. Instant-print drop -------------------------------------------------------------------------

const InstantDrop: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  move,
  seed,
  frame,
  earlier = [],
}) => {
  const shown = earlier.slice(-3);
  const stack = dropStack(seed, shown.length);
  const fall = dropArc(interpolate(frame, [2, 18], [0, 1], clamp));
  const dev = interpolate(frame, [12, 12 + DEVELOP_FRAMES], [0, 1], clamp);
  const box = pictureBox(aspect);
  const w = box.w + 2 * INSTANT_BORDER.side;
  const h = box.h + INSTANT_BORDER.top + INSTANT_BORDER.bottom;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Desk />
      <AbsoluteFill style={{ transform: ambient(move, frame, len) }}>
        {shown.map((p, k) => {
          const place = stack.earlier[k]!;
          const b = pictureBox(p.aspect);
          const pw = b.w + 2 * INSTANT_BORDER.side;
          const ph = b.h + INSTANT_BORDER.top + INSTANT_BORDER.bottom;
          return (
            <At
              key={k}
              x={place.x}
              y={place.y}
              rot={place.rot}
              scale={place.scale}
              w={pw}
              h={ph}
              style={{ filter: "drop-shadow(0 14px 18px rgba(0,0,0,0.5))" }}
            >
              <InstantPrint src={p.src} aspect={p.aspect} developT={1} />
            </At>
          );
        })}
        <At
          x={stack.newest.x}
          y={stack.newest.y + fall.y}
          rot={stack.newest.rot}
          scale={fall.scale}
          w={w}
          h={h}
          style={{
            filter: `drop-shadow(0 ${14 + 50 * (1 - fall.shadow)}px ${18 + 40 * (1 - fall.shadow)}px rgba(0,0,0,${0.55 * fall.shadow + 0.2}))`,
          }}
        >
          <InstantPrint src={src} aspect={aspect} developT={dev} />
        </At>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---- 2. Duct tape on a wall ------------------------------------------------------------------------

/** A torn strip of silver duct tape with a sheen: the Paper pack's tape in another material. */
const DuctStrip: React.FC<{
  seed: number;
  len: number;
  style?: React.CSSProperties;
}> = ({ seed, len, style }) => (
  <Tape
    seed={seed}
    style={{
      width: len,
      height: 58,
      padding: 0,
      backgroundColor: "rgba(150,152,156,0.96)",
      backgroundImage: `${GRAIN}, repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 2px, rgba(0,0,0,0.05) 2px 5px), linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.08) 35%, rgba(0,0,0,0.12) 70%, rgba(255,255,255,0.2) 100%)`,
      filter: "drop-shadow(0 4px 5px rgba(0,0,0,0.45))",
      ...style,
    }}
  />
);

const DuctTape: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  move,
  seed,
  frame,
}) => {
  const box = pictureBox(aspect);
  const w = box.w + 2 * PRINT_PAD;
  const h = box.h + 2 * PRINT_PAD;
  const press = interpolate(frame, [0, 10], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const strips = tapeStrips(seed, w, h);
  const tx = torchX(interpolate(frame, [6, 54], [0, 1], clamp));
  // Once the beam has passed, the torch settles on the print and the room stays dim around it.
  const settle = interpolate(frame, [54, 72], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const bx = tx * (1 - settle) + 0.5 * settle;
  const dark = 0.68 - 0.3 * settle;
  const rot = (rand(seed * 5 + 2) - 0.5) * 3;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Wall seed={seed} />
      <AbsoluteFill style={{ transform: ambient(move, frame, len) }}>
        <At
          w={w}
          h={h}
          rot={rot}
          scale={1 + 0.1 * (1 - press)}
          cy={540}
          style={{
            opacity: press,
            filter: `drop-shadow(0 ${6 + 30 * (1 - press)}px ${8 + 30 * (1 - press)}px rgba(0,0,0,0.5))`,
          }}
        >
          <Print src={src} aspect={aspect} gloss={0.12} />
          {strips.map((s, k) => {
            const on = interpolate(
              frame,
              [10 + k * 5, 13 + k * 5],
              [0, 1],
              clamp,
            );
            return (
              <div
                key={k}
                style={{
                  position: "absolute",
                  left: s.x - s.len / 2,
                  top: s.y - 29,
                  width: s.len,
                  height: 58,
                  transform: `rotate(${s.rot}deg) scale(${0.9 + 0.1 * on})`,
                  opacity: on,
                }}
              >
                <DuctStrip seed={seed + k} len={s.len} />
              </div>
            );
          })}
        </At>
      </AbsoluteFill>
      {/* The torch: everything dark but the beam's ellipse, sweeping the wall then resting on the print. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 640px 760px at ${(bx * 100).toFixed(1)}% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 45%, rgba(0,0,0,${dark.toFixed(2)}) 100%)`,
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 300px 400px at ${(bx * 100).toFixed(1)}% 50%, rgba(255,246,220,0.18) 0%, rgba(255,246,220,0) 100%)`,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

// ---- 3. Evidence board -----------------------------------------------------------------------------

const EvidenceBoard: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  seed,
  frame,
  caption,
  earlier = [],
}) => {
  const prev = earlier[earlier.length - 1];
  const layout = boardLayout(seed, aspect, Boolean(prev));
  const lift = interpolate(frame, [0, 12], [1, 0], {
    ...clamp,
    easing: easeOut,
  });
  const settle = interpolate(frame, [12, 16, 20], [0, -5, 0], clamp);
  const pin = interpolate(frame, [12, 16, 19], [0, 1.25, 1], clamp);
  const string = interpolate(frame, [20, 44], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const cardIn = interpolate(frame, [18, 30], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const push = interpolate(
    frame,
    [20, Math.max(50, Math.min(90, len * 0.5))],
    [1, 1.08],
    {
      ...clamp,
      easing: easeInOut,
    },
  );
  const box = pictureBox(aspect);
  const w = box.w + 2 * PRINT_PAD;
  const h = box.h + 2 * PRINT_PAD;
  const pinAt = { x: layout.newest.x, y: layout.newest.y - h / 2 + 10 };
  const prevBox = prev
    ? pictureBox(prev.aspect, layout.previous!.w / Math.max(0.6, prev.aspect))
    : undefined;
  const prevPin = layout.previous
    ? {
        x: layout.previous.x,
        y: layout.previous.y - (prevBox!.h + 2 * 10) / 2 + 8,
      }
    : undefined;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <TextureBackground kind="cork" variant={Math.abs(seed) % 6} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: `${layout.newest.x}px ${layout.newest.y}px`,
          transform: `scale(${push})`,
        }}
      >
        {prev && layout.previous && prevBox ? (
          <At
            cx={layout.previous.x}
            cy={layout.previous.y}
            w={prevBox.w + 20}
            h={prevBox.h + 20}
            rot={layout.previous.rot}
            style={{ boxShadow: "0 6px 16px rgba(0,0,0,0.55)" }}
          >
            <Print
              src={prev.src}
              aspect={prev.aspect}
              h={prevBox.h}
              pad={10}
              gloss={0.1}
              filter="contrast(1.02) saturate(0.85) brightness(0.92)"
            />
            <Pin show={1} style={{ left: "50%", top: 8 }} />
          </At>
        ) : null}
        {caption ? (
          <At
            cx={layout.card.x}
            cy={layout.card.y}
            w={layout.card.w}
            h={116}
            rot={layout.card.rot}
            y={30 * (1 - cardIn)}
            style={{
              opacity: cardIn,
              background: "#f5f1e2",
              backgroundImage: `${GRAIN}, repeating-linear-gradient(180deg, transparent 0 27px, rgba(120,150,200,0.35) 27px 29px)`,
              boxShadow: "0 8px 18px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 10,
                height: 3,
                background: "rgba(200,60,60,0.55)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 18,
                right: 18,
                top: 34,
                fontFamily: TYPEFACE,
                fontSize: 22,
                lineHeight: "28px",
                color: INK,
                overflow: "hidden",
                maxHeight: 56,
              }}
            >
              {caption}
            </div>
            <Pin show={cardIn} colour="#2b6cb0" style={{ left: 24, top: 10 }} />
          </At>
        ) : null}
        <At
          cx={layout.newest.x}
          cy={layout.newest.y}
          w={w}
          h={h}
          rot={layout.newest.rot}
          y={-150 * lift + settle}
          scale={1 + 0.14 * lift}
          style={{
            boxShadow: `0 ${6 + 40 * lift}px ${16 + 50 * lift}px rgba(0,0,0,${0.55 - 0.2 * lift})`,
          }}
        >
          <Print src={src} aspect={aspect} gloss={0.14} />
          <Pin show={pin} style={{ left: "50%", top: 10 }} />
        </At>
        {/* The string runs over the prints from pin to pin, as it does on a real board. */}
        {prevPin ? (
          <svg
            width={1920}
            height={1080}
            viewBox="0 0 1920 1080"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              pointerEvents: "none",
            }}
          >
            <path
              d={stringPath(prevPin, pinAt, 46)}
              fill="none"
              stroke="rgba(0,0,0,0.35)"
              strokeWidth={5}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - string}
              transform="translate(3 6)"
            />
            <path
              d={stringPath(prevPin, pinAt, 46)}
              fill="none"
              stroke="#c9262a"
              strokeWidth={3.5}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - string}
            />
          </svg>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ---- 4. Darkroom -----------------------------------------------------------------------------------

/** The developer's ripple: seeded turbulence displacing the print a touch, re-rolled every three frames. */
const RippleDefs: React.FC<{ id: string; seed: number; amount: number }> = ({
  id,
  seed,
  amount,
}) => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <defs>
      <filter
        id={id}
        x="-3%"
        y="-3%"
        width="106%"
        height="106%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.012 0.03"
          numOctaves={2}
          seed={seed}
          result="n"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="n"
          scale={amount}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </defs>
  </svg>
);

/** Plastic print tongs, tips at the origin, the arms running up and to the right. */
const Tongs: React.FC = () => (
  <svg
    width={360}
    height={120}
    viewBox="0 0 360 120"
    style={{ position: "absolute", left: -14, top: -60, overflow: "visible" }}
  >
    <g fill="#d8dadc" stroke="rgba(0,0,0,0.35)" strokeWidth={1.5}>
      <path d="M 14 62 L 330 18 L 340 30 L 30 74 Z" />
      <path d="M 14 62 L 330 92 L 338 80 L 30 52 Z" />
      <circle cx={334} cy={55} r={16} fill="#c22c2c" />
    </g>
  </svg>
);

const Darkroom: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  seed,
  frame,
}) => {
  const ph = darkroomPhases(len);
  const box = pictureBox(aspect, 600);
  const w = box.w + 2 * PRINT_PAD;
  const h = box.h + 2 * PRINT_PAD;
  const dev = interpolate(frame, [6, ph.developEnd], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const lift = interpolate(frame, [ph.lift, ph.hung], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const light = interpolate(frame, [ph.lightOn, ph.lightOn + 16], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const inTray = frame < ph.hung;
  const id = `rip${Math.abs(seed)}`;
  const tongsIn = interpolate(frame, [ph.lift - 10, ph.lift], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const tongsOut = interpolate(frame, [ph.hung + 4, ph.hung + 14], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  // The tray in the lower half; the line across the top the print rises to.
  const trayW = w + 160;
  const trayH = h + 120;
  const trayY = 600;
  const hungY = 60 + h / 2;
  const printY = trayY * (1 - lift) + hungY * lift;
  const printX = 0;
  const arc = Math.sin(lift * Math.PI) * -40;
  const scale = (1 - lift) * 1 + lift * (660 / box.h);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#0b0a0a" }}>
      <Desk tone="slate" />
      {inTray ? (
        <RippleDefs
          id={id}
          seed={(Math.abs(seed) % 500) * 3 + (Math.floor(frame / 3) % 4)}
          amount={4 + 4 * (1 - dev)}
        />
      ) : null}
      {/* The drying line and its clip. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 44,
          height: 3,
          background: "rgba(230,225,215,0.55)",
          boxShadow: "0 2px 3px rgba(0,0,0,0.5)",
        }}
      />
      {/* The tray: pale plastic, its liquid a shade darker, the print lying in it. */}
      <At
        cx={960}
        cy={trayY}
        w={trayW}
        h={trayH}
        style={{
          background: "#c9c6bf",
          borderRadius: 22,
          boxShadow:
            "inset 0 0 0 14px #b4b1aa, inset 0 18px 30px rgba(0,0,0,0.35), 0 20px 40px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 14,
            borderRadius: 12,
            background:
              "linear-gradient(180deg, rgba(96,98,104,0.55) 0%, rgba(70,72,78,0.6) 100%)",
          }}
        />
      </At>
      {/* The print: blank paper to begin with, the image rising through the developer. */}
      <At
        cx={960}
        cy={printY}
        x={printX}
        y={arc}
        w={w}
        h={h}
        rot={-3 * lift + 1.5}
        scale={scale}
        style={{
          filter: inTray ? `url(#${id})` : undefined,
          boxShadow: inTray
            ? "0 2px 6px rgba(0,0,0,0.3)"
            : "0 20px 50px rgba(0,0,0,0.65)",
        }}
      >
        <Print
          src={src}
          aspect={aspect}
          h={box.h}
          gloss={inTray ? 0.3 : 0.12}
          filter={`contrast(${(0.4 + 0.64 * dev).toFixed(3)}) brightness(${(1.6 - 0.6 * dev).toFixed(3)}) blur(${(6 * (1 - dev)).toFixed(1)}px)`}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#f3f1ec",
              opacity: Math.max(0, 1 - dev * 1.6),
            }}
          />
        </Print>
        {lift >= 1 ? (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: -16,
              width: 34,
              height: 40,
              marginLeft: -17,
              background:
                "linear-gradient(90deg, #b58a56 0%, #d9b07a 50%, #a97e4c 100%)",
              borderRadius: 3,
              boxShadow: "0 3px 5px rgba(0,0,0,0.5)",
            }}
          />
        ) : null}
        {/* The liquid's surface over the print while it lies in the tray. */}
        {inTray ? (
          <div
            style={{
              position: "absolute",
              inset: -6,
              background:
                "linear-gradient(180deg, rgba(120,130,150,0.22) 0%, rgba(120,130,150,0.08) 100%)",
              opacity: 1 - lift,
            }}
          />
        ) : null}
        {tongsIn > 0 && tongsOut < 1 ? (
          <div
            style={{
              position: "absolute",
              left: w - 60,
              top: 6,
              opacity: 1 - tongsOut,
              transform: `translate(${260 * (1 - tongsIn) + 200 * tongsOut}px, ${-120 * (1 - tongsIn) - 160 * tongsOut}px)`,
            }}
          >
            <Tongs />
          </div>
        ) : null}
      </At>
      {/* The safelight: the room seen in red until the light comes up. */}
      <AbsoluteFill
        style={{
          background: "#ff3418",
          mixBlendMode: "multiply",
          opacity: 0.88 * (1 - light),
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(255,90,60,0.35) 0%, rgba(0,0,0,0) 60%)",
          opacity: 1 - light,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

// ---- 5. Camera print -------------------------------------------------------------------------------

/** An instant camera's front, drawn in code: body, lens, flash, viewfinder, shutter and the print slot. */
const CameraFront: React.FC<{ w: number; h: number }> = ({ w, h }) => (
  <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h }}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 42,
        background:
          "linear-gradient(180deg, #3a3b3f 0%, #232428 60%, #141518 100%)",
        boxShadow:
          "0 30px 70px rgba(0,0,0,0.7), inset 0 2px 0 rgba(255,255,255,0.12)",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 40,
        right: 40,
        top: 36,
        height: h * 0.52,
        borderRadius: 30,
        background: "linear-gradient(180deg, #e9e6df 0%, #cfccc4 100%)",
        boxShadow: "inset 0 -4px 10px rgba(0,0,0,0.25)",
      }}
    />
    {/* Lens */}
    <div
      style={{
        position: "absolute",
        left: w / 2 - 150,
        top: h * 0.12,
        width: 300,
        height: 300,
        borderRadius: 150,
        background:
          "radial-gradient(circle at 50% 50%, #0a0b10 0%, #0a0b10 36%, #1c1e26 38%, #2a2c36 48%, #111216 50%, #35363c 62%, #1a1b1f 64%, #4a4b50 100%)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.6), inset 0 0 0 6px #2b2c31",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 92,
          top: 70,
          width: 60,
          height: 36,
          borderRadius: 30,
          background: "rgba(140,170,230,0.35)",
          filter: "blur(4px)",
        }}
      />
    </div>
    {/* Flash */}
    <div
      style={{
        position: "absolute",
        left: 80,
        top: h * 0.16,
        width: 230,
        height: 110,
        borderRadius: 10,
        background:
          "repeating-linear-gradient(90deg, #f1efe8 0 6px, #cfccc3 6px 12px)",
        boxShadow: "inset 0 0 0 6px #8e8c86, 0 4px 10px rgba(0,0,0,0.4)",
      }}
    />
    {/* Viewfinder */}
    <div
      style={{
        position: "absolute",
        right: 90,
        top: h * 0.18,
        width: 90,
        height: 70,
        borderRadius: 8,
        background: "#0a0b10",
        boxShadow: "inset 0 0 0 6px #4d4e54",
      }}
    />
    {/* Shutter button */}
    <div
      style={{
        position: "absolute",
        right: 110,
        top: h * 0.4,
        width: 56,
        height: 56,
        borderRadius: 28,
        background: "radial-gradient(circle at 40% 35%, #ff6a5a, #b8261c)",
        boxShadow: "0 4px 8px rgba(0,0,0,0.5)",
      }}
    />
    {/* The slot the print comes out of */}
    <div
      style={{
        position: "absolute",
        left: w * 0.12,
        right: w * 0.12,
        bottom: 26,
        height: 22,
        borderRadius: 6,
        background: "#050507",
        boxShadow:
          "inset 0 3px 6px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.08)",
      }}
    />
  </div>
);

const CameraPrint: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  seed,
  frame,
}) => {
  const { eject, away } = cameraPhases(frame);
  const camW = 1180;
  const camH = 560;
  const camTop = 70;
  const slotY = camTop + camH - 37;
  const box = pictureBox(aspect);
  const pw = box.w + 2 * INSTANT_BORDER.side;
  const ph = box.h + INSTANT_BORDER.top + INSTANT_BORDER.bottom;
  const small = 0.62;
  // While ejecting, the print hangs under the slot, scaled small, its top clipped by the slot.
  const outPx = eject * ph * small;
  const dev = interpolate(
    frame,
    [(2 + 12) * 2.5, (2 + 12) * 2.5 + DEVELOP_FRAMES],
    [0, 1],
    clamp,
  );
  const camShake =
    eject > 0 && eject < 1 ? (rand(seed * 7 + stepOf(frame)) - 0.5) * 3 : 0;
  // After the ejection the camera pulls up and away and the print rises to the middle at full size.
  const printCy = (slotY + outPx / 2) * (1 - away) + 540 * away;
  const printScale = small * (1 - away) + 1 * away;
  const rot = (rand(seed * 5 + 3) - 0.5) * 6 * away;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Desk tone="slate" />
      {/* The print: under the camera while it motors out, over everything once free. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: away > 0 ? 0 : slotY,
          bottom: 0,
          overflow: "hidden",
          zIndex: away > 0 ? 2 : 0,
        }}
      >
        <At
          cx={960}
          cy={printCy - (away > 0 ? 0 : slotY)}
          w={pw}
          h={ph}
          scale={printScale}
          rot={rot}
          style={{
            filter: `drop-shadow(0 ${10 + 30 * away}px ${12 + 30 * away}px rgba(0,0,0,0.55))`,
          }}
        >
          <InstantPrint src={src} aspect={aspect} developT={dev} />
        </At>
      </div>
      <div
        style={{
          position: "absolute",
          left: 960 - camW / 2,
          top: camTop,
          width: camW,
          height: camH,
          transform: `translateY(${-(camH + camTop + 120) * away + camShake}px)`,
          zIndex: 1,
        }}
      >
        <CameraFront w={camW} h={camH} />
      </div>
    </AbsoluteFill>
  );
};

// ---- 6. Film strip and loupe -----------------------------------------------------------------------

const NEGATIVE =
  "invert(1) hue-rotate(180deg) sepia(0.35) saturate(0.8) contrast(0.95) brightness(0.9)";

const FilmStrip: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  seed,
  frame,
}) => {
  const ph = filmPhases(frame);
  const offset = filmOffset(ph.slide);
  const box = pictureBox(aspect);
  const frames = [-3, -2, -1, 0, 1, 2, 3];
  const R = 300;
  const loupeScale = ph.loupe;
  // Past the loupe, the positive grows from the lens's circle to a print.
  const e = ph.enlarge;
  const posW = R * 2 * (1 - e) + (box.w + 2 * PRINT_PAD) * e;
  const posH = R * 2 * (1 - e) + (box.h + 2 * PRINT_PAD) * e;
  const radius = R * (1 - e) + 6 * e;
  const stripDim = 1 - 0.55 * e;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#15130f" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(245,236,214,0.32) 0%, rgba(0,0,0,0) 65%)",
        }}
      />
      <AbsoluteFill style={{ opacity: stripDim }}>
        <div
          style={{
            position: "absolute",
            left: 960 + offset,
            top: 540 - FILM_STRIP_H / 2,
            height: FILM_STRIP_H,
            width: 0,
            transform: "rotate(-1.2deg)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -FILM_PITCH * 4,
              width: FILM_PITCH * 8,
              top: 0,
              height: FILM_STRIP_H,
              background: "#2a1b12",
              boxShadow: "0 24px 50px rgba(0,0,0,0.7)",
            }}
          >
            {/* Sprocket holes along both edges. */}
            {[14, FILM_STRIP_H - 14 - 22].map((y) => (
              <div
                key={y}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: y,
                  height: 22,
                  backgroundImage:
                    "linear-gradient(90deg, rgba(246,232,200,0.92) 0 24px, transparent 24px 46px)",
                  backgroundSize: "46px 22px",
                  backgroundPosition: "11px 0",
                }}
              />
            ))}
            {frames.map((k) => {
              // Neighbouring frames: the same roll, so the same subject framed a little differently.
              const shift = 50 - ((k * 37 + seed) % 5) * 10;
              return (
                <div
                  key={k}
                  style={{
                    position: "absolute",
                    left: FILM_PITCH * 4 + k * FILM_PITCH - FILM_FRAME_W / 2,
                    top: (FILM_STRIP_H - FILM_FRAME_H) / 2,
                    width: FILM_FRAME_W,
                    height: FILM_FRAME_H,
                    overflow: "hidden",
                    background: "#efe3c8",
                  }}
                >
                  {pic(
                    src,
                    {
                      objectPosition: `${shift}% 50%`,
                      transform: `scale(${k === 0 ? 1 : 1.12})`,
                    },
                    NEGATIVE,
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
      {/* The loupe over the chosen frame, then the positive growing out of it. */}
      {loupeScale > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 960 - posW / 2,
            top: 540 - posH / 2,
            width: posW,
            height: posH,
            transform: `scale(${loupeScale})`,
            filter: `drop-shadow(0 ${20 + 20 * e}px ${30 + 20 * e}px rgba(0,0,0,0.7))`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: radius,
              overflow: "hidden",
              background: PHOTO_PAPER,
              boxShadow: `inset 0 0 0 ${PRINT_PAD * e}px ${PHOTO_PAPER}`,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: PRINT_PAD * e,
                overflow: "hidden",
                borderRadius: radius * (1 - e),
              }}
            >
              {pic(src, { transform: `scale(${1.9 * (1 - e) + 1 * e})` })}
            </div>
            {/* The glass: a rim and a highlight that fade as the positive becomes a print. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: radius,
                boxShadow: `inset 0 0 0 ${14 * (1 - e)}px #7a6a52, inset 0 0 0 ${18 * (1 - e)}px #c7b58f, inset 0 0 40px rgba(0,0,0,${0.45 * (1 - e)})`,
                background: `linear-gradient(130deg, rgba(255,255,255,${0.28 * (1 - e)}) 0%, rgba(255,255,255,0) 40%)`,
              }}
            />
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ---- 7. Slide projector ----------------------------------------------------------------------------

const SlideProjector: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  seed,
  frame,
}) => {
  const { drop, focus } = slidePhases(frame);
  const box = pictureBox(aspect, 700);
  const motes = dustMotes(seed, frame);
  const step = stepOf(frame);
  // The lamp flickers a touch with each carousel click before the slide is in.
  const click = step < CAROUSEL_STEPS ? 0.75 + 0.25 * rand(seed + step) : 1;
  const blur = 10 * (1 - focus);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#0c0b0a" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 55%, rgba(255,232,190,0.14) 0%, rgba(0,0,0,0) 60%)",
          opacity: click,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 960 - box.w / 2,
          top: 540 - box.h / 2,
          width: box.w,
          height: box.h,
          transform: "perspective(2400px) rotateY(5deg) rotateX(-1.5deg)",
          transformOrigin: "50% 50%",
        }}
      >
        {/* The lit gate: the lamp's glow with nothing in it. */}
        <div
          style={{
            position: "absolute",
            inset: -8,
            background: "#f6e8c8",
            opacity: 0.92 * click,
            boxShadow: "0 0 90px 30px rgba(255,236,200,0.25)",
          }}
        />
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `translateY(${-(1 - drop) * (box.h + 40)}px)`,
            }}
          >
            {pic(
              src,
              {
                filter: `blur(${blur.toFixed(1)}px) contrast(1.05) saturate(1.08) sepia(0.12) brightness(${(0.95 * click).toFixed(2)})`,
              },
              "",
            )}
            {/* The slide mount's dark edge along the bottom as it drops. */}
            <div
              style={{
                position: "absolute",
                left: -20,
                right: -20,
                bottom: -14,
                height: 14,
                background: "#222",
              }}
            />
          </div>
        </div>
        {/* The lamp's hot centre and a dark edge: the projected image is never flat. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(255,250,230,0.14) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.3) 100%)",
            pointerEvents: "none",
          }}
        />
      </div>
      {/* Dust in the beam. */}
      {motes.map((m, k) => (
        <div
          key={k}
          style={{
            position: "absolute",
            // The beam is a little wider than the gate: dust shows where the light is.
            left: 960 - box.w / 2 - 80 + m.x * (box.w + 160),
            top: 540 - box.h / 2 - 60 + m.y * (box.h + 120),
            width: m.r * 2,
            height: m.r * 2,
            borderRadius: m.r,
            background: "#fff4dc",
            opacity: m.a * 0.6 * click,
            filter: "blur(0.6px)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

// ---- 8. Album page ---------------------------------------------------------------------------------

/** Four glassine corners holding a w by h picture. */
const Corners: React.FC<{ w: number; h: number }> = ({ w, h }) => (
  <>
    {[
      [0, 0, 0],
      [w, 0, 90],
      [w, h, 180],
      [0, h, 270],
    ].map(([x, y, r], k) => (
      <div
        key={k}
        style={{
          position: "absolute",
          left: x! - 1,
          top: y! - 1,
          width: 54,
          height: 54,
          transform: `rotate(${r}deg)`,
          transformOrigin: "0 0",
          clipPath: "polygon(0 0, 100% 0, 0 100%)",
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.75) 0%, rgba(235,232,220,0.85) 100%)",
          boxShadow: "inset -2px -2px 3px rgba(0,0,0,0.15)",
        }}
      />
    ))}
  </>
);

const AlbumPage: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  seed,
  frame,
  earlier = [],
}) => {
  const prev = earlier[earlier.length - 1];
  const turn = pageTurn(frame);
  const pageW = 900;
  const pageH = 1000;
  const picW = 820;
  const picH = Math.round(picW / Math.max(0.6, aspect));
  // Once the leaf is over, the camera settles in on the print until it meets the height rule.
  const need = Math.min(1.7, Math.max(1, 660 / picH));
  const push = interpolate(
    frame,
    [(3 + 9) * 2.5 + 4, Math.min(len - 4, (3 + 9) * 2.5 + 40)],
    [1, need],
    { ...clamp, easing: easeInOut },
  );
  const page = (child: React.ReactNode, side: "left" | "right") => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#efe9dc",
        backgroundImage: paperLayers(),
        boxShadow:
          side === "right"
            ? "inset 24px 0 40px -30px rgba(0,0,0,0.45)"
            : "inset -24px 0 40px -30px rgba(0,0,0,0.45)",
      }}
    >
      {child}
    </div>
  );
  const mounted = (p: PhotoPicture | undefined) => {
    const h = p
      ? Math.round(picW / Math.max(0.6, p.aspect))
      : Math.round(picW / 1.5);
    return (
      <div
        style={{
          position: "absolute",
          left: (pageW - picW) / 2,
          top: (pageH - h) / 2,
          width: picW,
          height: h,
        }}
      >
        {p ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
            }}
          >
            {pic(p.src)}
          </div>
        ) : null}
        <Corners w={picW} h={h} />
      </div>
    );
  };
  const picCx = 960 + pageW / 2;
  const picCy = 540;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#2a1a16" }}>
      <AbsoluteFill
        style={{ backgroundImage: `${GRAIN}, ${MOTTLE}`, opacity: 0.7 }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, rgba(255,230,200,0.08) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: `${picCx}px ${picCy}px`,
          transform: `scale(${push})`,
        }}
      >
        {/* The cover's edge around the spread. */}
        <div
          style={{
            position: "absolute",
            left: 960 - pageW - 40,
            top: 540 - pageH / 2 - 40,
            width: pageW * 2 + 80,
            height: pageH + 80,
            borderRadius: 10,
            background: "linear-gradient(180deg, #4a2a22 0%, #2e1a15 100%)",
            boxShadow: "0 40px 90px rgba(0,0,0,0.7)",
          }}
        />
        {/* Left page: the earlier print, if any, in its corners (it stays through the turn). */}
        <div
          style={{
            position: "absolute",
            left: 960 - pageW,
            top: 540 - pageH / 2,
            width: pageW,
            height: pageH,
          }}
        >
          {page(mounted(prev), "left")}
        </div>
        {/* Right page beneath: this print in its corners. */}
        <div
          style={{
            position: "absolute",
            left: 960,
            top: 540 - pageH / 2,
            width: pageW,
            height: pageH,
          }}
        >
          {page(mounted({ src, aspect }), "right")}
        </div>
        {/* The leaf turning over the spine: blank front, blank back, its shadow sweeping the page under it. */}
        {turn < 1 ? (
          <div
            style={{
              position: "absolute",
              left: 960,
              top: 540 - pageH / 2,
              width: pageW,
              height: pageH,
              transformOrigin: "0% 50%",
              transform: `perspective(2600px) rotateY(${-180 * turn}deg)`,
              transformStyle: "preserve-3d",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                backfaceVisibility: "hidden",
              }}
            >
              {page(<Corners w={picW} h={Math.round(picW / 1.5)} />, "right")}
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              {page(null, "left")}
            </div>
          </div>
        ) : null}
        {turn > 0 && turn < 1 ? (
          <div
            style={{
              position: "absolute",
              left: 960,
              top: 540 - pageH / 2,
              width: pageW,
              height: pageH,
              background: `linear-gradient(90deg, rgba(0,0,0,${0.45 * Math.sin(turn * Math.PI)}) 0%, rgba(0,0,0,0) ${60 + 40 * turn}%)`,
              pointerEvents: "none",
            }}
          />
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          left: 960 - 1,
          top: 540 - pageH / 2 - 40,
          width: 2,
          height: pageH + 80,
          background: "rgba(0,0,0,0.5)",
          transform: `scale(${push})`,
          transformOrigin: `${picCx - 960 + 1}px ${pageH / 2 + 40}px`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: GRAIN,
          opacity: 0.25,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

// ---- 9. Newsprint halftone -------------------------------------------------------------------------

/** Columns of grey type: bars at a line pitch, justified, never words. */
const Columns: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  seed: number;
}> = ({ x, y, w, h, cols, seed }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: h,
      display: "flex",
      gap: 22,
    }}
  >
    {Array.from({ length: cols }, (_, c) => (
      <div
        key={c}
        style={{
          flex: 1,
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(40,38,34,0.55) 0 8px, transparent 8px 16px)",
          backgroundSize: `${90 + ((seed * 7 + c * 13) % 10)}% 16px`,
          backgroundRepeat: "repeat-y",
          maskImage:
            "linear-gradient(180deg, #000 0%, #000 85%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(180deg, #000 0%, #000 85%, transparent 100%)",
        }}
      />
    ))}
  </div>
);

const Newsprint: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  move,
  seed,
  frame,
  caption,
  year,
}) => {
  const box = pictureBox(aspect, 620);
  const { pitch, angle } = halftone(year);
  const settle = interpolate(frame, [0, 14], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const push = interpolate(frame, [14, Math.min(len - 4, 70)], [1, 1.12], {
    ...clamp,
    easing: easeInOut,
  });
  const picX = 960 - box.w / 2 + 40;
  const picY = 150;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#3a3733" }}>
      <AbsoluteFill style={{ transform: ambient(move, frame, len) }}>
        <div
          style={{
            position: "absolute",
            left: 120,
            right: 120,
            top: 40 + 60 * (1 - settle),
            height: 1120,
            background: "#e4dfd1",
            backgroundImage: `${GRAIN}, ${MOTTLE}`,
            boxShadow: "0 30px 80px rgba(0,0,0,0.65)",
            opacity: settle,
            transformOrigin: `${picX + box.w / 2 - 120}px ${picY + box.h / 2 - 40}px`,
            transform: `scale(${push})`,
          }}
        >
          {/* Rules and the grey columns either side of the picture. */}
          <div
            style={{
              position: "absolute",
              left: 50,
              right: 50,
              top: 52,
              height: 3,
              background: "rgba(40,38,34,0.7)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 50,
              right: 50,
              top: 60,
              height: 1,
              background: "rgba(40,38,34,0.5)",
            }}
          />
          <Columns
            x={50}
            y={picY - 40}
            w={picX - 120 - 50 - 30}
            h={820}
            cols={2}
            seed={seed}
          />
          <Columns
            x={picX - 120 + box.w + 30}
            y={picY - 40}
            w={1680 - (picX - 120 + box.w + 30) - 50}
            h={820}
            cols={2}
            seed={seed + 1}
          />
          <Columns
            x={picX - 120}
            y={picY - 40 + box.h + 130}
            w={box.w}
            h={300}
            cols={3}
            seed={seed + 2}
          />
          {/* The halftone: the picture in grey under a rotated dot screen, the contrast pushed so the dots print. */}
          <div
            style={{
              position: "absolute",
              left: picX - 120,
              top: picY - 40,
              width: box.w,
              height: box.h,
              overflow: "hidden",
              filter: "contrast(2.1) brightness(1.04)",
              background: "#e4dfd1",
              boxShadow: "0 0 0 2px rgba(40,38,34,0.75)",
            }}
          >
            {pic(
              src,
              undefined,
              "grayscale(1) contrast(0.9) brightness(1.18) blur(0.6px)",
            )}
            <div
              style={{
                position: "absolute",
                left: "-50%",
                top: "-50%",
                width: "200%",
                height: "200%",
                backgroundImage: `radial-gradient(circle, rgba(0,0,0,1) 0, rgba(0,0,0,0.9) ${pitch * 0.18}px, rgba(128,128,128,1) ${pitch * 0.5}px)`,
                backgroundSize: `${pitch}px ${pitch}px`,
                transform: `rotate(${angle}deg)`,
                mixBlendMode: "hard-light",
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: picX - 120,
              top: picY - 40 + box.h + 16,
              width: box.w,
              height: 100,
              fontFamily: SERIF,
              fontStyle: "italic",
              fontSize: 24,
              lineHeight: "30px",
              color: "rgba(40,38,34,0.85)",
              overflow: "hidden",
            }}
          >
            {caption ?? ""}
          </div>
          <div
            style={{
              position: "absolute",
              left: picX - 120,
              top: picY - 40 + box.h + 118,
              width: box.w,
              height: 1,
              background: "rgba(40,38,34,0.4)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: GRAIN,
              opacity: 0.5,
              pointerEvents: "none",
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---- 10. Archive scan ------------------------------------------------------------------------------

const ArchiveScan: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  move,
  seed,
  frame,
}) => {
  const box = pictureBox(aspect);
  const w = box.w + 2 * PRINT_PAD;
  const h = box.h + 2 * PRINT_PAD;
  const t = interpolate(frame, [6, 64], [0, 1], { ...clamp, easing: (x) => x });
  const y = scanY(t);
  const done = interpolate(frame, [64, 80], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const rot = (rand(seed * 5 + 1) - 0.5) * 3;
  const barY = y * h;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#070708" }}>
      {/* The glass: the lid's dark underside, a cold reflection across it. */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(160deg, #1d1f23 0%, #0b0c0e 60%, #050506 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(115deg, rgba(255,255,255,0) 35%, rgba(180,200,220,0.06) 48%, rgba(255,255,255,0) 60%)",
        }}
      />
      <AbsoluteFill style={{ transform: ambient(move, frame, len) }}>
        <At
          w={w}
          h={h}
          rot={rot * (1 - done)}
          style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.7)" }}
        >
          {/* The old photo as it lies on the glass: faded, warm, a little soft. */}
          <Print
            src={src}
            aspect={aspect}
            gloss={0.08}
            filter="sepia(0.6) contrast(0.72) brightness(0.74) saturate(0.6) blur(1px)"
          />
          {/* The scan behind the bar: clean and straight. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              clipPath: `inset(0 0 ${Math.max(0, (1 - y) * 100).toFixed(2)}% 0)`,
            }}
          >
            <Print
              src={src}
              aspect={aspect}
              gloss={0}
              filter="contrast(1.06) saturate(1.0) brightness(1.02)"
            />
          </div>
          {/* The light bar and its glow. */}
          {t > 0 && t < 1 ? (
            <div
              style={{
                position: "absolute",
                left: -40,
                right: -40,
                top: barY - 6,
                height: 12,
                background:
                  "linear-gradient(90deg, rgba(190,235,255,0.7), #ffffff, rgba(190,235,255,0.7))",
                boxShadow:
                  "0 0 24px 10px rgba(170,225,255,0.55), 0 0 90px 30px rgba(140,200,255,0.25)",
              }}
            />
          ) : null}
          {/* The scanned vignette: faint soft edges and a thin preview frame. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              boxShadow: `inset 0 0 ${60 * done}px rgba(0,20,40,${0.25 * done}), 0 0 0 ${2 * done}px rgba(120,190,255,${0.5 * done})`,
              pointerEvents: "none",
            }}
          />
        </At>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---- 12. Magnifier ---------------------------------------------------------------------------------

const Magnifier: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  move,
  seed,
  frame,
}) => {
  const box = pictureBox(aspect);
  const w = box.w + 2 * PRINT_PAD;
  const h = box.h + 2 * PRINT_PAD;
  const R = 200;
  const arrive = interpolate(frame, [8, 24], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const pass = interpolate(
    frame,
    [24, Math.max(60, Math.min(100, len - 30))],
    [0, 1],
    clamp,
  );
  const leave = interpolate(
    frame,
    [
      Math.max(62, Math.min(102, len - 28)),
      Math.max(74, Math.min(114, len - 16)),
    ],
    [0, 1],
    { ...clamp, easing: easeInOut },
  );
  const c = lensPath(seed, box.w, box.h, pass);
  const lx = c.x + PRINT_PAD + (1 - arrive) * 500 + leave * 420;
  const ly = c.y + PRINT_PAD + (1 - arrive) * 500 + leave * 300;
  const lift = Math.max(1 - arrive, leave);
  const rot = (rand(seed * 5 + 4) - 0.5) * 2;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <BlurDesk src={src} />
      <AbsoluteFill style={{ transform: ambient(move, frame, len) }}>
        <At
          w={w}
          h={h}
          rot={rot}
          style={{ boxShadow: "0 50px 140px rgba(0,0,0,0.75)" }}
        >
          <Print src={src} aspect={aspect} gloss={0.1} />
          {arrive > 0 && leave < 1 ? (
            <div
              style={{
                position: "absolute",
                left: lx - R,
                top: ly - R,
                width: 2 * R,
                height: 2 * R,
                transform: `scale(${1 + 0.18 * lift})`,
                filter: `drop-shadow(${18 + 30 * lift}px ${26 + 40 * lift}px ${14 + 20 * lift}px rgba(0,0,0,${0.5 - 0.2 * lift}))`,
                opacity: Math.min(1, 1.4 - lift),
              }}
            >
              {/* The glass: what lies under it, enlarged about the lens's centre. */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: R,
                  overflow: "hidden",
                  background: "#1c1d1b",
                }}
              >
                <Img
                  src={src}
                  style={{
                    position: "absolute",
                    left: -(c.x * LENS_ZOOM - R),
                    top: -(c.y * LENS_ZOOM - R),
                    width: box.w * LENS_ZOOM,
                    height: box.h * LENS_ZOOM,
                    objectFit: "cover",
                    filter: "contrast(1.06) saturate(0.98)",
                    display: "block",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: R,
                    boxShadow: "inset 0 0 40px rgba(0,0,0,0.35)",
                    background:
                      "linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.12) 100%)",
                  }}
                />
              </div>
              {/* The brass rim and the handle running down to the right. */}
              <div
                style={{
                  position: "absolute",
                  inset: -12,
                  borderRadius: R + 12,
                  boxShadow:
                    "inset 0 0 0 12px #8a6a3a, inset 0 0 0 16px #d9b76e, 0 0 0 2px rgba(0,0,0,0.4)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 2 * R - 30,
                  top: 2 * R - 30,
                  width: 250,
                  height: 46,
                  transformOrigin: "20px 23px",
                  transform: "rotate(42deg)",
                  borderRadius: 23,
                  background:
                    "linear-gradient(180deg, #5a3a22 0%, #3a2414 55%, #241408 100%)",
                  boxShadow: "0 0 0 3px #8a6a3a",
                }}
              />
            </div>
          ) : null}
        </At>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---- 12. Manila folder -----------------------------------------------------------------------------

const ManilaFolder: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  seed,
  frame,
  year,
}) => {
  const box = pictureBox(aspect);
  const pw = box.w + 2 * PRINT_PAD;
  const ph = box.h + 2 * PRINT_PAD;
  const fw = 1320;
  const fh = 900;
  const frot = (rand(seed * 5 + 1) - 0.5) * 4 - 2;
  const stamp = interpolate(frame, [8, 14], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const slide = interpolate(frame, [20, 46], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const over = interpolate(frame, [46, 70], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const settleScale = 0.66 * (1 - over) + 1 * over;
  // The print's centre: inside the folder, then out past its open edge, then up and over it to the middle.
  const px = 0 * (1 - slide) + 760 * slide * (1 - over) + 0 * over;
  const py = 40 * (1 - over) + 0 * over;
  const prot = frot * (1 - over) + (rand(seed * 5 + 6) - 0.5) * 4 * over;
  const push = interpolate(
    frame,
    [70, Math.min(len - 4, 100)],
    [1, 1.03],
    clamp,
  );
  const front = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#d8b877",
        backgroundImage: `${GRAIN}, linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(0,0,0,0.04) 60%, rgba(0,0,0,0.12) 100%)`,
        borderRadius: "6px 6px 6px 6px",
        boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
      }}
    >
      {/* The tab */}
      <div
        style={{
          position: "absolute",
          left: 60,
          top: -34,
          width: 320,
          height: 40,
          background: "#d8b877",
          backgroundImage: GRAIN,
          borderRadius: "10px 10px 0 0",
          boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.08)",
        }}
      />
      {year ? (
        <div
          style={{
            position: "absolute",
            right: 90,
            top: 80,
            transform: `rotate(-9deg) scale(${1.4 - 0.4 * stamp})`,
            opacity: stamp * 0.9,
            padding: "6px 22px",
            border: "6px solid #b3261e",
            borderRadius: 8,
            color: "#b3261e",
            fontFamily: DISPLAY,
            fontSize: 96,
            letterSpacing: 4,
            lineHeight: 1,
            WebkitMaskImage: INK_MASK,
            maskImage: INK_MASK,
            WebkitMaskSize: "200px 200px",
            maskSize: "200px 200px",
          }}
        >
          {year}
        </div>
      ) : null}
    </div>
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Desk />
      <AbsoluteFill style={{ transform: `scale(${push})` }}>
        <At
          w={fw}
          h={fh}
          rot={frot}
          y={30}
          style={{ filter: "drop-shadow(0 24px 40px rgba(0,0,0,0.6))" }}
        >
          {/* Back cover, a shade darker. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#c6a765",
              backgroundImage: GRAIN,
              borderRadius: 6,
            }}
          />
        </At>
        {/* The print: under the front cover until it is out, then over everything. */}
        <At
          w={pw}
          h={ph}
          x={px}
          y={py + 30}
          rot={prot}
          scale={settleScale}
          style={{
            zIndex: over > 0 ? 3 : 1,
            filter: `drop-shadow(0 ${8 + 30 * over}px ${10 + 30 * over}px rgba(0,0,0,0.55))`,
          }}
        >
          <Print src={src} aspect={aspect} gloss={0.14} />
        </At>
        <At w={fw} h={fh} rot={frot} y={30} style={{ zIndex: 2 }}>
          {front}
        </At>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---- 12. Light box ---------------------------------------------------------------------------------

const LightBox: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  seed,
  frame,
  earlier = [],
}) => {
  const shown = earlier.slice(-4);
  const layout = lightBoxLayout(seed, shown.length);
  const box = pictureBox(aspect);
  const w = box.w + 2 * PRINT_PAD;
  const h = box.h + 2 * PRINT_PAD;
  const liftT = interpolate(frame, [4, 34], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  // It starts lying small in a free corner and rises to the middle, its shadow deepening as it leaves the glass.
  const startX = 1690 - 960;
  const startY = 830 - 540;
  const x = startX * (1 - liftT) + (layout.newest.x - 960) * liftT;
  const y = startY * (1 - liftT) + (layout.newest.y - 540) * liftT;
  const scale = 0.5 * (1 - liftT) + 1 * liftT;
  const rot = 9 * (1 - liftT) + layout.newest.rot * liftT;
  const hover = interpolate(frame, [34, Math.min(len - 4, 90)], [1, 0.92], {
    ...clamp,
    easing: easeInOut,
  });
  const lift = liftT * hover;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#23262a" }}>
      {/* The box: a dark frame around a bright, even glass. */}
      <div
        style={{
          position: "absolute",
          left: 40,
          top: 40,
          right: 40,
          bottom: 40,
          borderRadius: 14,
          background: "#f1f3f0",
          boxShadow:
            "inset 0 0 0 18px #2d3034, inset 0 0 120px 40px rgba(255,255,255,0.6), 0 0 80px rgba(230,240,255,0.25)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 18,
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(236,240,236,0.9) 70%, rgba(205,210,205,0.95) 100%)",
          }}
        />
      </div>
      {shown.map((p, k) => {
        const pl = layout.earlier[k]!;
        const b = pictureBox(p.aspect, pl.w / Math.max(0.6, p.aspect));
        return (
          <At
            key={k}
            cx={pl.x}
            cy={pl.y}
            w={b.w + 20}
            h={b.h + 20}
            rot={pl.rot}
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
          >
            <Print
              src={p.src}
              aspect={p.aspect}
              h={b.h}
              pad={10}
              gloss={0.1}
              filter="contrast(1.0) saturate(0.9) brightness(1.04)"
            />
          </At>
        );
      })}
      <At
        w={w}
        h={h}
        x={x}
        y={y}
        rot={rot}
        scale={scale * (1 + 0.04 * (1 - hover))}
        style={{
          filter: `drop-shadow(0 ${4 + 40 * lift}px ${6 + 40 * lift}px rgba(0,0,0,${0.3 + 0.3 * lift}))`,
        }}
      >
        <Print
          src={src}
          aspect={aspect}
          gloss={0.12}
          filter="contrast(1.04) saturate(0.98) brightness(1.03)"
        />
      </At>
    </AbsoluteFill>
  );
};

// ---- 12. Drying line -------------------------------------------------------------------------------

/** A wooden clothes peg seen from the front, its spring a dark bar across the middle. */
const Peg: React.FC<{ show: number; style?: React.CSSProperties }> = ({
  show,
  style,
}) => (
  <div
    style={{
      position: "absolute",
      width: 30,
      height: 76,
      marginLeft: -15,
      transform: `scale(${show})`,
      opacity: show > 0.02 ? 1 : 0,
      transformOrigin: "50% 0%",
      ...style,
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 13,
        height: 76,
        background: "linear-gradient(90deg, #c69b62, #e3bd84)",
        borderRadius: "3px 0 0 3px",
        boxShadow: "0 3px 5px rgba(0,0,0,0.5)",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 17,
        top: 0,
        width: 13,
        height: 76,
        background: "linear-gradient(90deg, #d9b37a, #b98f58)",
        borderRadius: "0 3px 3px 0",
        boxShadow: "0 3px 5px rgba(0,0,0,0.5)",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 6,
        top: 34,
        width: 18,
        height: 6,
        background: "#6b6b70",
        borderRadius: 2,
      }}
    />
  </div>
);

const DryingLine: React.FC<PhotoShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  seed,
  frame,
  earlier = [],
}) => {
  const layout = lineLayout(seed, earlier.length);
  const shown = earlier.slice(-layout.earlier.length);
  const box = pictureBox(aspect, 560);
  const w = box.w + 2 * PRINT_PAD;
  const h = box.h + 2 * PRINT_PAD;
  const lineY = 120;
  const sag = (x: number) => lineY + 28 * Math.sin((x / 1920) * Math.PI);
  const rise = interpolate(frame, [0, 14], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const peg = interpolate(frame, [14, 18, 21], [0, 1.2, 1], clamp);
  const swing = pegSwing(frame - 16);
  const need = Math.min(1.5, Math.max(1, 660 / box.h));
  const push = interpolate(frame, [22, Math.min(len - 4, 70)], [1, need], {
    ...clamp,
    easing: easeInOut,
  });
  const wet = interpolate(frame, [20, len], [0.4, 0.15], clamp);
  const nx = layout.newest.x;
  const ny = sag(nx);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#1b1a1f" }}>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, #2a292f 0%, #17171b 70%, #0f0f12 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 55% 45%, rgba(255,230,200,0.12) 0%, rgba(0,0,0,0) 60%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: `${nx}px ${ny + 30 + h / 2}px`,
          transform: `scale(${push})`,
        }}
      >
        <svg
          width={1920}
          height={1080}
          viewBox="0 0 1920 1080"
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          <path
            d={`M 0 ${lineY} Q 960 ${lineY + 56} 1920 ${lineY}`}
            fill="none"
            stroke="rgba(0,0,0,0.5)"
            strokeWidth={5}
            transform="translate(0 4)"
          />
          <path
            d={`M 0 ${lineY} Q 960 ${lineY + 56} 1920 ${lineY}`}
            fill="none"
            stroke="#d9d3c4"
            strokeWidth={3}
          />
        </svg>
        {shown.map((p, k) => {
          const pl = layout.earlier[k]!;
          const b = pictureBox(p.aspect, pl.w / Math.max(0.6, p.aspect));
          const y = sag(pl.x);
          return (
            <div
              key={k}
              style={{
                position: "absolute",
                left: pl.x,
                top: y - 8,
                transformOrigin: "0 0",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: -(b.w + 20) / 2,
                  top: 20,
                  width: b.w + 20,
                  height: b.h + 20,
                  transform: `rotate(${pl.rot}deg)`,
                  transformOrigin: "50% 0%",
                  boxShadow: "0 10px 24px rgba(0,0,0,0.6)",
                }}
              >
                <Print
                  src={p.src}
                  aspect={p.aspect}
                  h={b.h}
                  pad={10}
                  gloss={0.2}
                  filter="contrast(1.02) saturate(0.9) brightness(0.9)"
                />
              </div>
              <Peg show={1} />
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: nx,
            top: ny - 8,
            transformOrigin: "0 0",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -w / 2,
              top: 20 + 560 * (1 - rise),
              width: w,
              height: h,
              transform: `rotate(${layout.newest.rot + swing}deg)`,
              transformOrigin: "50% 0%",
              boxShadow: `0 ${12 + 30 * (1 - rise)}px ${26 + 30 * (1 - rise)}px rgba(0,0,0,0.6)`,
            }}
          >
            <Print
              src={src}
              aspect={aspect}
              h={box.h}
              gloss={wet}
              filter="contrast(1.05) saturate(1.02) brightness(1.03)"
            />
            {/* Water gathering along the bottom edge. */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: 60,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(200,220,235,0.25) 100%)",
                opacity: wet,
              }}
            />
          </div>
          <Peg show={peg} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---- 11. Displays for screenshots -------------------------------------------------------------------

/**
 * A screenshot playing inside the display of its day: the children (the shot's own Still, its Ken Burns
 * move intact) fill the screen's box; the body is drawn around it. A CRT with scanlines, a curved glass and
 * a warm-up flash; a bezelled LCD on a stand; a flat screen; a phone held sideways.
 */
export const DisplayShot: React.FC<{
  kind: DisplayKind;
  seed: number;
  children: React.ReactNode;
}> = ({ kind, seed, children }) => {
  const frame = useCurrentFrame();
  const s = screenBox(kind);
  const on = interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: easeOut });
  const flash =
    kind === "crt" ? interpolate(frame, [0, 3, 12], [2.2, 1.5, 1], clamp) : 1;
  const flicker = kind === "crt" ? 0.985 + rand(seed + frame) * 0.015 : 1;
  const screen = (
    <div
      style={{
        position: "absolute",
        left: s.x,
        top: s.y,
        width: s.w,
        height: s.h,
        borderRadius: s.radius,
        overflow: "hidden",
        background: "#000",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          filter: `brightness(${(flash * flicker * on).toFixed(3)})`,
          transform:
            kind === "crt"
              ? `scale(${1 + 0.4 * (flash - 1)}, ${1 + 0.1 * (flash - 1)})`
              : undefined,
        }}
      >
        {children}
      </div>
      {kind === "crt" ? (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "repeating-linear-gradient(180deg, rgba(0,0,0,0.3) 0px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 4px)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: s.radius,
              boxShadow: "inset 0 0 120px 30px rgba(0,0,0,0.75)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 45%)",
              pointerEvents: "none",
            }}
          />
        </>
      ) : kind === "phone" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(160deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 40%)",
            pointerEvents: "none",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(115deg, rgba(255,255,255,0.0) 50%, rgba(255,255,255,0.05) 70%, rgba(255,255,255,0) 85%)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
  let body: React.ReactNode;
  switch (kind) {
    case "crt":
      body = (
        <>
          <div
            style={{
              position: "absolute",
              left: 150,
              top: 24,
              width: 1620,
              height: 1040,
              borderRadius: 54,
              background:
                "linear-gradient(180deg, #d9d2c0 0%, #bfb6a2 55%, #9f9684 100%)",
              boxShadow:
                "0 40px 100px rgba(0,0,0,0.75), inset 0 3px 0 rgba(255,255,255,0.4)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: s.x - 34,
              top: s.y - 34,
              width: s.w + 68,
              height: s.h + 68,
              borderRadius: s.radius + 30,
              background: "#2a2622",
              boxShadow:
                "inset 0 0 0 10px #15130f, inset 0 14px 30px rgba(0,0,0,0.6)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 420,
              top: 950,
              width: 1080,
              height: 60,
              display: "flex",
              gap: 36,
              alignItems: "center",
            }}
          >
            {[0, 1, 2, 3].map((k) => (
              <div
                key={k}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  background:
                    "radial-gradient(circle at 40% 35%, #6b655a, #2d2a25)",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.5)",
                }}
              />
            ))}
            <div
              style={{
                marginLeft: "auto",
                width: 16,
                height: 16,
                borderRadius: 8,
                background: "#ff4a2a",
                boxShadow: "0 0 10px #ff4a2a",
              }}
            />
          </div>
        </>
      );
      break;
    case "lcd":
      body = (
        <>
          <div
            style={{
              position: "absolute",
              left: 960 - 160,
              top: 1000,
              width: 320,
              height: 60,
              borderRadius: 14,
              background: "linear-gradient(180deg, #3a3b3f, #1e1f22)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.7)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 960 - 90,
              top: 940,
              width: 180,
              height: 80,
              background: "linear-gradient(90deg, #2a2b2f, #3f4044, #2a2b2f)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: s.x - 62,
              top: s.y - 50,
              width: s.w + 124,
              height: s.h + 112,
              borderRadius: 14,
              background: "linear-gradient(180deg, #4b4c50 0%, #2f3034 100%)",
              boxShadow:
                "0 40px 100px rgba(0,0,0,0.75), inset 0 2px 0 rgba(255,255,255,0.18)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: s.x - 8,
              top: s.y - 8,
              width: s.w + 16,
              height: s.h + 16,
              borderRadius: 8,
              background: "#101114",
              boxShadow: "inset 0 0 0 2px #000",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: s.x + s.w - 60,
              top: s.y + s.h + 22,
              width: 14,
              height: 14,
              borderRadius: 7,
              background: "#49d17a",
              boxShadow: "0 0 8px #49d17a",
            }}
          />
        </>
      );
      break;
    case "flat":
      body = (
        <>
          <div
            style={{
              position: "absolute",
              left: 960 - 200,
              top: 1030,
              width: 400,
              height: 26,
              borderRadius: 8,
              background: "linear-gradient(180deg, #2a2b2f, #141518)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.7)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 960 - 40,
              top: 1002,
              width: 80,
              height: 34,
              background: "#1c1d20",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: s.x - 20,
              top: s.y - 20,
              width: s.w + 40,
              height: s.h + 40,
              borderRadius: 16,
              background: "linear-gradient(180deg, #1b1c1f, #0c0c0e)",
              boxShadow:
                "0 40px 100px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.14)",
            }}
          />
        </>
      );
      break;
    case "phone":
      body = (
        <>
          <div
            style={{
              position: "absolute",
              left: s.x - 46,
              top: s.y - 46,
              width: s.w + 92,
              height: s.h + 92,
              borderRadius: 96,
              background: "linear-gradient(180deg, #2a2b30, #0e0f12)",
              boxShadow:
                "0 40px 100px rgba(0,0,0,0.75), inset 0 0 0 3px #3b3c42, inset 0 1px 0 rgba(255,255,255,0.2)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: s.x - 52,
              top: s.y + 140,
              width: 6,
              height: 90,
              borderRadius: 3,
              background: "#3b3c42",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: s.x - 52,
              top: s.y + 260,
              width: 6,
              height: 150,
              borderRadius: 3,
              background: "#3b3c42",
            }}
          />
        </>
      );
      break;
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#0b0b0e" }}>
      <AbsoluteFill
        style={{
          background:
            kind === "crt"
              ? "linear-gradient(180deg, #1a1612 0%, #0b0a08 100%)"
              : "linear-gradient(180deg, #16171b 0%, #08090b 100%)",
        }}
      />
      {body}
      {screen}
      {kind === "phone" ? (
        <div
          style={{
            position: "absolute",
            left: s.x + 26,
            top: s.y + s.h / 2 - 11,
            width: 22,
            height: 22,
            borderRadius: 11,
            background: "#000",
            boxShadow: "inset 0 0 0 3px #15161a",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/** The display a screenshot plays in, by its year and platforms; exported for the preview composition. */
export const displayKindFor = displayFor;

// ---- The shot --------------------------------------------------------------------------------------

/** One photo or portrait shot: the treatment the plan chose. The credit corner is drawn by Long.tsx as before. */
export const PhotoShot: React.FC<PhotoShotProps> = (props) => {
  const frame = useCurrentFrame();
  switch (props.treatment) {
    case "instantDrop":
      return <InstantDrop {...props} frame={frame} />;
    case "ductTape":
      return <DuctTape {...props} frame={frame} />;
    case "evidenceBoard":
      return <EvidenceBoard {...props} frame={frame} />;
    case "darkroom":
      return <Darkroom {...props} frame={frame} />;
    case "cameraPrint":
      return <CameraPrint {...props} frame={frame} />;
    case "filmStrip":
      return <FilmStrip {...props} frame={frame} />;
    case "slideProjector":
      return <SlideProjector {...props} frame={frame} />;
    case "albumPage":
      return <AlbumPage {...props} frame={frame} />;
    case "newsprint":
      return <Newsprint {...props} frame={frame} />;
    case "archiveScan":
      return <ArchiveScan {...props} frame={frame} />;
    case "magnifier":
      return <Magnifier {...props} frame={frame} />;
    case "manilaFolder":
      return <ManilaFolder {...props} frame={frame} />;
    case "lightBox":
      return <LightBox {...props} frame={frame} />;
    case "dryingLine":
      return <DryingLine {...props} frame={frame} />;
  }
};
