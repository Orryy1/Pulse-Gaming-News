// A concept sketch's shot in a documentary (src/assets/illustrate.ts draws them; ../sketchplan.ts decides
// how each arrives). Five treatments, every one a pure function of the frame and a seed: the sketch drawn
// on with a pencil riding the front; stop-motion paper that steps at 12 pictures a second on a crumpled,
// torn sheet with a hand-lettered strip; a flipbook page peeling in over the sketch before; the light
// table, where the sketch dissolves into the real picture that follows it; and a cork board where a
// chapter's sketches pin up one by one. Paper, cork, tape and pins come from the Paper pack and the
// explainer backgrounds, nothing from a file. The only words on screen are the ILLUSTRATION tag and the
// picture's own caption. SVG filters and CSS transforms only, their regions bounded, so a 34-minute render
// is not slowed: the draw-on's noise filter runs only while the lines are drawing.

import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { HAND } from "./fonts.ts";
import { moveTransform, type MovePreset } from "../motion.ts";
import {
  GRAIN,
  INK,
  IllustrationTag,
  Pin,
  Tape,
  Write,
  paperLayers,
} from "./packs/paper/kit.tsx";
import { easeInOut, easeOut, rand } from "./packs/screen/common.ts";
import { TextureBackground } from "./Backgrounds.tsx";
import {
  type SketchTreatment,
  corkLayout,
  crumpleSeed,
  drawFrames,
  letterJitter,
  peelAngle,
  peelDistance,
  peelRegion,
  polygonCss,
  stepJitter,
  stepOf,
  sweepBands,
  sweepFront,
  tornTopPolygon,
  washFrames,
} from "../sketchplan.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const CREAM = "#f4efe3";
/** The framed sketch: this wide, the print treatment's width, so the drawing fills about 65% of the frame height. */
const SHEET_W = 1240;
const SHEET_PAD = 18;
/** The draw-on sweeps the page in this many bands. */
const BANDS = 5;
/** The flipbook page peels over this many 12 fps steps (0.75 s). */
const FLIP_STEPS = 9;

export interface SketchPicture {
  src: string;
  aspect: number;
}

export interface SketchShotProps extends SketchPicture {
  /** Frames of the shot's sequence (with the dissolve from the shot before). */
  len: number;
  move: MovePreset;
  treatment: SketchTreatment;
  seed: number;
  /** This sketch's place in its run, from 1: the flipbook's page number. */
  page?: number;
  /** The picture's caption as the shot label already shows it ("Concept sketch"). */
  caption: string;
  /** The run's earlier sketches, oldest first: under the flipbook page, pinned on the board. */
  earlier?: SketchPicture[];
  /** The light table: the real picture the sketch becomes, and the tilt its own print will have. */
  next?: SketchPicture & { kind: string; tilt: number };
}

const sheetHeight = (aspect: number) =>
  Math.round(SHEET_W / Math.max(0.6, aspect));

/** The ILLUSTRATION tag where the static sketch shot carried it, bottom right under the shot label. */
const Tag: React.FC<{ frame: number }> = ({ frame }) => (
  <IllustrationTag
    on="dark"
    style={{
      position: "absolute",
      right: 40,
      bottom: 26,
      padding: "4px 10px",
      fontSize: 16,
      letterSpacing: 2,
      border: "1px solid rgba(245,245,242,0.5)",
      background: "rgba(11,11,14,0.45)",
      color: "rgba(245,245,242,0.75)",
      opacity: interpolate(frame, [0, 10], [0, 1], clamp),
    }}
  />
);

/** The sketch's own blurred, darkened copy behind it: the print treatment's desk. */
const BlurDesk: React.FC<{ src: string }> = ({ src }) => (
  <Img
    src={src}
    style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      filter: "blur(36px) brightness(0.4) saturate(1.1)",
      transform: "scale(1.2)",
    }}
  />
);

/** A dark wooden desk, drawn in code, for the stop-motion sheet to land on. */
const WoodDesk: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(160deg, #3b2b1d 0%, #2a1d13 55%, #17100b 100%)",
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

/**
 * The sketch's lines alone: the picture pushed to black strokes on white, multiplied over the paper, and
 * (while drawing) revealed by the sweep mask, whose front is roughed up by seeded noise and thresholded so
 * it reads as pencil marks arriving rather than a wipe. Once drawn the mask and its filter are dropped.
 */
const InkLines: React.FC<{
  src: string;
  w: number;
  h: number;
  seed: number;
  progress: number;
  opacity?: number;
}> = ({ src, w, h, seed, progress, opacity = 1 }) => {
  const id = `sk${Math.abs(seed)}`;
  const drawing = progress < 1;
  const bandH = h / BANDS;
  const skirt = 140;
  const shares = sweepBands(progress, BANDS);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        mixBlendMode: "multiply",
        opacity,
      }}
    >
      <defs>
        <filter
          id={`${id}i`}
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="4" intercept="-2" />
            <feFuncG type="linear" slope="4" intercept="-2" />
            <feFuncB type="linear" slope="4" intercept="-2" />
          </feComponentTransfer>
        </filter>
        {drawing ? (
          <>
            <linearGradient id={`${id}gr`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#fff" />
              <stop offset="1" stopColor="#000" />
            </linearGradient>
            <linearGradient id={`${id}gl`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#000" />
              <stop offset="1" stopColor="#fff" />
            </linearGradient>
            <filter
              id={`${id}f`}
              x="-6%"
              y="-6%"
              width="112%"
              height="112%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.028"
                numOctaves={3}
                seed={Math.abs(seed) % 997}
                result="n"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="n"
                scale={64}
                xChannelSelector="R"
                yChannelSelector="G"
              />
              <feComponentTransfer>
                <feFuncR type="discrete" tableValues="0 1" />
                <feFuncG type="discrete" tableValues="0 1" />
                <feFuncB type="discrete" tableValues="0 1" />
                <feFuncA type="discrete" tableValues="0 1" />
              </feComponentTransfer>
            </filter>
            <mask
              id={`${id}m`}
              maskUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={w}
              height={h}
            >
              <g filter={`url(#${id}f)`}>
                {shares.map((share, k) => {
                  if (share <= 0) return null;
                  const dir = k % 2 ? -1 : 1;
                  const front = dir > 0 ? share * w : w - share * w;
                  // Bands overrun the page top and bottom so the noise never erodes its edges.
                  const y = k === 0 ? -40 : k * bandH;
                  const hh =
                    bandH + (k === 0 ? 40 : 0) + (k === BANDS - 1 ? 40 : 0);
                  return (
                    <React.Fragment key={k}>
                      <rect
                        x={dir > 0 ? -40 : front}
                        y={y}
                        width={dir > 0 ? front + 40 : w - front + 40}
                        height={hh}
                        fill="#fff"
                      />
                      {share < 1 ? (
                        <rect
                          x={dir > 0 ? front : front - skirt}
                          y={y}
                          width={skirt}
                          height={hh}
                          fill={`url(#${id}g${dir > 0 ? "r" : "l"})`}
                        />
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </g>
            </mask>
          </>
        ) : null}
      </defs>
      <image
        href={src}
        x={0}
        y={0}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMid slice"
        filter={`url(#${id}i)`}
        mask={drawing ? `url(#${id}m)` : undefined}
      />
    </svg>
  );
};

/** A pencil drawn in code, tip at the origin, body up and to the right; `shadow` draws its soft shadow instead. */
const PencilShape: React.FC<{ shadow?: boolean }> = ({ shadow = false }) => {
  const f = (c: string) => (shadow ? "#000" : c);
  return (
    <g>
      <polygon points="0,0 16,-7 16,7" fill={f("#3a3a3a")} />
      <polygon points="16,-7 44,-12 44,12 16,7" fill={f("#e9c99c")} />
      <rect x={44} y={-12} width={176} height={24} fill={f("#f0b22e")} />
      {!shadow ? (
        <>
          <rect x={44} y={-12} width={176} height={7} fill="#f7cc63" />
          <rect x={44} y={5} width={176} height={7} fill="#c98e17" />
          <polygon points="16,-7 44,-12 44,-4 16,-3" fill="#f4dcb9" />
        </>
      ) : null}
      <rect x={220} y={-12} width={18} height={24} fill={f("#c9cbd0")} />
      {!shadow ? (
        <rect x={224} y={-12} width={3} height={24} fill="#8e9196" />
      ) : null}
      <rect x={238} y={-11} width={20} height={22} rx={4} fill={f("#e68c8c")} />
    </g>
  );
};

/**
 * The pencil riding the draw-on front: at the band being drawn, with a hand's wobble, its shadow cast
 * down and right; once the drawing is done it lifts away and its shadow drifts off with it.
 */
const Pencil: React.FC<{
  w: number;
  h: number;
  seed: number;
  progress: number;
  lift: number;
  frame: number;
}> = ({ w, h, seed, progress, lift, frame }) => {
  const front = sweepFront(progress, BANDS);
  const bandH = h / BANDS;
  const wob = (i: number) => (rand(seed * 13 + frame * 5 + i) - 0.5) * 3;
  const x = front.x * w + wob(1);
  const y = (front.band + 0.55) * bandH + wob(2);
  const rot = -42 + wob(3) * 1.2;
  const id = `pen${Math.abs(seed)}`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        overflow: "visible",
        opacity: 1 - lift,
      }}
    >
      <defs>
        <filter id={id} x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation={3 + 6 * lift} />
        </filter>
      </defs>
      <g
        transform={`translate(${x + 10 + 36 * lift} ${y + 14 + 48 * lift}) rotate(${rot})`}
        filter={`url(#${id})`}
        opacity={0.3 * (1 - lift)}
      >
        <PencilShape shadow />
      </g>
      <g
        transform={`translate(${x + 40 * lift} ${y - 110 * lift}) rotate(${rot})`}
      >
        <PencilShape />
      </g>
    </svg>
  );
};

/** The cream sheet the drawing sits on: paper grain, soft tone and the light across it. */
const PaperFace: React.FC<{
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ style, children }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      backgroundColor: CREAM,
      backgroundImage: paperLayers(),
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * Drawn on: lines first, swept across the page band by band with the pencil at the front, then the
 * shading and wash fading in beneath them. `drawShare` sets how much of the shot the drawing takes.
 * The light table reuses it with a shorter draw and a dissolve into the real picture at the end.
 */
const DrawOn: React.FC<
  SketchShotProps & { frame: number; draw: number; dissolve?: boolean }
> = ({ src, aspect, len, move, seed, frame, draw, dissolve = false, next }) => {
  const h = sheetHeight(aspect);
  const wash = washFrames(len, draw);
  const progress = interpolate(frame, [0, draw], [0, 1], {
    ...clamp,
    easing: (x) => 0.1 * x + 0.9 * easeInOut(x),
  });
  const washIn = interpolate(frame, [draw - 4, draw - 4 + wash], [0, 1], clamp);
  const lift = interpolate(frame, [draw + 2, draw + 14], [0, 1], clamp);
  const m = moveTransform(move, Math.min(1, frame / Math.max(1, len)));
  const tilt = next ? next.tilt : (rand(seed * 3 + 1) - 0.5) * 2.4;
  // The light table's last second: the real picture rises under the lines, which linger half a second.
  const d0 = len - 30;
  const realIn = dissolve
    ? interpolate(frame, [d0, d0 + 15], [0, 1], clamp)
    : 0;
  const linesOut = dissolve
    ? interpolate(frame, [d0 + 15, len - 3], [1, 0], clamp)
    : 1;
  const glow = dissolve
    ? interpolate(frame, [d0, d0 + 12, len - 6, len], [0, 0.55, 0.4, 0], clamp)
    : 0;
  // A screenshot or art that follows plays full-bleed: the sheet grows to fill the frame so the next shot
  // fades in over the same picture at the same size. A photo keeps the framed print's geometry and tilt.
  const innerW = SHEET_W - 2 * SHEET_PAD;
  const innerH = h - 2 * SHEET_PAD;
  const fill =
    dissolve && next && next.kind !== "photo"
      ? interpolate(frame, [len - 12, len], [0, 1], {
          ...clamp,
          easing: easeInOut,
        })
      : 0;
  const coverScale = Math.max(1920 / innerW, 1080 / innerH);
  const scale = (m.scale - 0.04) * (1 - fill) + coverScale * fill;
  const top = 48 + 2 * fill;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <BlurDesk src={src} />
      {glow > 0 ? (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at 50% 48%, rgba(255,250,235,1) 0%, rgba(255,250,235,0.5) 30%, rgba(255,250,235,0) 62%)",
            opacity: glow,
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${top}%`,
          width: SHEET_W,
          height: h,
          transform: `translate(-50%, -50%) rotate(${tilt * (1 - fill)}deg) scale(${scale})`,
          boxShadow: "0 50px 140px rgba(0,0,0,0.75)",
        }}
      >
        <PaperFace />
        <div
          style={{
            position: "absolute",
            inset: SHEET_PAD,
            overflow: "hidden",
          }}
        >
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "contrast(1.04) saturate(0.92)",
              opacity: washIn * (1 - realIn),
            }}
          />
          {next ? (
            <Img
              src={next.src}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "contrast(1.03) saturate(1.05)",
                opacity: realIn,
              }}
            />
          ) : null}
          <InkLines
            src={src}
            w={innerW}
            h={innerH}
            seed={seed}
            progress={progress}
            opacity={linesOut}
          />
        </div>
        {lift < 1 ? (
          <div style={{ position: "absolute", inset: SHEET_PAD }}>
            <Pencil
              w={innerW}
              h={innerH}
              seed={seed}
              progress={progress}
              lift={lift}
              frame={frame}
            />
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** The crumple: seeded turbulence displaces the sheet a little and lights its folds. Declared once, used by CSS filter. */
const CrumpleDefs: React.FC<{ id: string; seed: number }> = ({ id, seed }) => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <defs>
      <filter
        id={id}
        x="-4%"
        y="-4%"
        width="108%"
        height="108%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.011"
          numOctaves={3}
          seed={seed}
          result="n"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="n"
          scale={11}
          xChannelSelector="R"
          yChannelSelector="G"
          result="d"
        />
        <feDiffuseLighting
          in="n"
          lightingColor="#ffffff"
          surfaceScale={5}
          diffuseConstant={1.1}
          result="lit"
        >
          <feDistantLight azimuth={215} elevation={52} />
        </feDiffuseLighting>
        <feComponentTransfer in="lit" result="lit2">
          <feFuncR type="linear" slope="0.55" intercept="0.55" />
          <feFuncG type="linear" slope="0.55" intercept="0.55" />
          <feFuncB type="linear" slope="0.55" intercept="0.55" />
        </feComponentTransfer>
        <feComposite in="lit2" in2="d" operator="in" result="litIn" />
        <feBlend in="d" in2="litIn" mode="multiply" />
      </filter>
    </defs>
  </svg>
);

/**
 * Stop-motion paper: the sketch on a crumpled sheet torn off a pad, taped or pinned down, that lands and
 * then shifts at 12 pictures a second with a hand's small nudges while its crumple boils; a hand-lettered
 * strip under it carries the caption.
 */
const StopMotion: React.FC<SketchShotProps & { frame: number }> = ({
  src,
  aspect,
  seed,
  frame,
  caption,
}) => {
  const W = 1200;
  const pad = 20;
  const h = Math.round(W / Math.max(0.6, aspect));
  const step = stepOf(frame);
  const land = easeOut(Math.min(1, step / 6));
  const j = stepJitter(seed, step);
  const baseRot = (rand(seed * 5 + 2) - 0.5) * 3;
  const id = `cr${Math.abs(seed)}`;
  const torn = polygonCss(tornTopPolygon(seed, W, h));
  const taped = rand(seed * 5 + 3) < 0.55;
  // The strip arrives once the sheet has settled and its letters write on over ten steps.
  const stripIn = easeOut(Math.max(0, Math.min(1, (step - 7) / 3)));
  const writeP = Math.max(0, Math.min(1, (step - 8) / 10));
  const sj = stepJitter(seed + 1, step);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <WoodDesk />
      <CrumpleDefs id={id} seed={crumpleSeed(seed, frame)} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "45%",
          width: W,
          height: h,
          transform: `translate(-50%, -50%) translate(${j.x}px, ${j.y - 130 * (1 - land)}px) rotate(${baseRot + j.rot}deg) scale(${1 + 0.08 * (1 - land)})`,
          filter: `drop-shadow(0 ${14 + 40 * (1 - land)}px ${18 + 30 * (1 - land)}px rgba(0,0,0,${0.5 - 0.2 * (1 - land)}))`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            filter: `url(#${id})`,
            clipPath: torn,
          }}
        >
          <PaperFace />
          <div
            style={{
              position: "absolute",
              left: pad,
              right: pad,
              top: pad + 10,
              bottom: pad,
              overflow: "hidden",
            }}
          >
            <Img
              src={src}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "contrast(1.04) saturate(0.9)",
              }}
            />
          </div>
        </div>
        {taped ? (
          <Tape
            seed={seed}
            style={{
              position: "absolute",
              left: "50%",
              top: -14,
              width: 230,
              height: 54,
              padding: 0,
              transform: `translateX(-50%) rotate(${(rand(seed * 5 + 4) - 0.5) * 6}deg) scale(${land})`,
              opacity: 0.92,
            }}
          />
        ) : (
          <Pin show={land} style={{ left: 54, top: 30 }} />
        )}
      </div>
      {stripIn > 0 ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: `calc(45% + ${h / 2 + 30}px)`,
            transform: `translate(-50%, 0) translate(${sj.x * 0.6}px, ${sj.y * 0.6 + 24 * (1 - stripIn)}px) rotate(${(rand(seed * 5 + 6) - 0.5) * 3 + sj.rot * 0.5}deg)`,
            opacity: stripIn,
            padding: "8px 30px 6px",
            backgroundColor: "#f7f2e6",
            backgroundImage: paperLayers(),
            boxShadow: "0 10px 24px rgba(0,0,0,0.5)",
            whiteSpace: "nowrap",
          }}
        >
          <Write p={writeP}>
            {caption.split("").map((ch, i) => {
              const lj = letterJitter(seed, i);
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    fontFamily: HAND,
                    fontSize: 40,
                    letterSpacing: 2,
                    color: INK,
                    whiteSpace: "pre",
                    transform: `rotate(${lj.rot}deg) translateY(${lj.dy}px)`,
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </Write>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** A page's small number, hand-written in its bottom corner. */
const PageNumber: React.FC<{ n: number; seed: number }> = ({ n, seed }) => (
  <div
    style={{
      position: "absolute",
      right: 26,
      bottom: 14,
      fontFamily: HAND,
      fontSize: 26,
      color: "rgba(29,27,24,0.55)",
      transform: `rotate(${(rand(seed * 7 + n) - 0.5) * 8}deg)`,
    }}
  >
    {n}
  </div>
);

/**
 * The flipbook: the sketch before this one lies on the pad; its bottom-right corner peels up and over
 * at 12 steps a second, the curl's back and shadow along the fold, and this sketch is the page beneath.
 */
const Flipbook: React.FC<SketchShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  move,
  seed,
  frame,
  page = 2,
  earlier = [],
}) => {
  const h = sheetHeight(aspect);
  const old = earlier[earlier.length - 1];
  const step = stepOf(frame) - 2;
  const d = peelDistance(SHEET_W, h, step, FLIP_STEPS, seed);
  const L = Math.hypot(SHEET_W, h);
  const flipping = d > 0 && d < L * 1.2;
  const curlW = 96;
  const angle = peelAngle(SHEET_W, h);
  const m = moveTransform(move, Math.min(1, frame / Math.max(1, len)));
  const j = flipping ? stepJitter(seed, step) : { x: 0, y: 0, rot: 0 };
  const page1 = (pic: SketchPicture | undefined, n: number) => (
    <>
      <PaperFace />
      {pic ? (
        <div
          style={{ position: "absolute", inset: SHEET_PAD, overflow: "hidden" }}
        >
          <Img
            src={pic.src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "contrast(1.04) saturate(0.92)",
            }}
          />
        </div>
      ) : null}
      <PageNumber n={n} seed={seed} />
    </>
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <BlurDesk src={src} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "48%",
          width: SHEET_W,
          height: h,
          transform: `translate(-50%, -50%) translate(${j.x * 0.4}px, ${j.y * 0.4}px) rotate(${j.rot * 0.3}deg) scale(${m.scale - 0.04})`,
          boxShadow: "0 50px 140px rgba(0,0,0,0.75)",
        }}
      >
        {/* The pad beneath: a few page edges. */}
        {[3, 2, 1].map((k) => (
          <div
            key={k}
            style={{
              position: "absolute",
              inset: 0,
              transform: `translate(${k * 3}px, ${k * 3}px)`,
              background: k % 2 ? "#e6dfcf" : "#efe8d8",
              boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
            }}
          />
        ))}
        {/* This sketch: the page beneath. */}
        <div style={{ position: "absolute", inset: 0 }}>
          {page1({ src, aspect }, page)}
        </div>
        {d < L * 1.2 ? (
          <>
            {/* The page before, still flat where the peel has not reached. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                clipPath: polygonCss(peelRegion(SHEET_W, h, d, Infinity)),
              }}
            >
              {page1(old, page - 1)}
            </div>
            {flipping ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  background: `linear-gradient(${angle}deg, rgba(0,0,0,0) ${Math.max(0, d - 44)}px, rgba(0,0,0,0.38) ${d}px, #e9e1cf ${d}px, #fbf8f0 ${d + curlW * 0.45}px, #d4cbb6 ${d + curlW}px, rgba(0,0,0,0.3) ${d + curlW}px, rgba(0,0,0,0) ${d + curlW + 34}px)`,
                }}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** A sketch pinned to the board: a paper border, the drawing, a pushpin at its head. */
const Pinned: React.FC<{
  pic: SketchPicture;
  w: number;
  x: number;
  y: number;
  rot: number;
  pin: number;
  lift?: number;
  dim?: boolean;
}> = ({ pic, w, x, y, rot, pin, lift = 0, dim = false }) => {
  const pad = Math.round(w * 0.018);
  const h = Math.round(w / Math.max(0.6, pic.aspect)) + 2 * pad;
  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        transform: `translateY(${-150 * lift}px) rotate(${rot}deg) scale(${1 + 0.14 * lift})`,
        boxShadow: `0 ${6 + 40 * lift}px ${16 + 50 * lift}px rgba(0,0,0,${0.55 - 0.2 * lift})`,
        filter: dim ? "brightness(0.9)" : undefined,
      }}
    >
      <PaperFace />
      <div style={{ position: "absolute", inset: pad, overflow: "hidden" }}>
        <Img
          src={pic.src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "contrast(1.04) saturate(0.92)",
          }}
        />
      </div>
      <Pin show={pin} style={{ left: "50%", top: 8 }} />
    </div>
  );
};

/**
 * The cork board: the chapter's earlier sketches already pinned small along the sides, this one dropping
 * into the middle and taking its pin, the camera pushing in on it.
 */
const CorkBoard: React.FC<SketchShotProps & { frame: number }> = ({
  src,
  aspect,
  len,
  seed,
  frame,
  earlier = [],
}) => {
  const shown = earlier.slice(-6);
  const layout = corkLayout(seed, shown.length);
  const lift = interpolate(frame, [0, 12], [1, 0], {
    ...clamp,
    easing: easeOut,
  });
  const settle = interpolate(frame, [12, 16, 20], [0, -5, 0], clamp);
  const pin = interpolate(frame, [12, 16, 19], [0, 1.25, 1], clamp);
  const push = interpolate(
    frame,
    [16, Math.max(40, Math.min(96, len * 0.5))],
    [1, 1.3],
    {
      ...clamp,
      easing: easeInOut,
    },
  );
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
        {shown.map((pic, i) => {
          const p = layout.earlier[i]!;
          return (
            <Pinned
              key={i}
              pic={pic}
              w={p.w}
              x={p.x}
              y={p.y}
              rot={p.rot}
              pin={1}
              dim
            />
          );
        })}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translateY(${settle}px)`,
          }}
        >
          <Pinned
            pic={{ src, aspect }}
            w={layout.newest.w}
            x={layout.newest.x}
            y={layout.newest.y}
            rot={layout.newest.rot}
            pin={pin}
            lift={lift}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** One sketch shot: the treatment the plan chose, and the ILLUSTRATION tag over it. */
export const SketchShot: React.FC<SketchShotProps> = (props) => {
  const frame = useCurrentFrame();
  const { treatment, len } = props;
  let body: React.ReactNode;
  switch (treatment) {
    case "stopMotion":
      body = <StopMotion {...props} frame={frame} />;
      break;
    case "flipbook":
      body = <Flipbook {...props} frame={frame} />;
      break;
    case "corkBoard":
      body = <CorkBoard {...props} frame={frame} />;
      break;
    case "lightTable":
      body = (
        <DrawOn
          {...props}
          frame={frame}
          draw={Math.round(Math.max(36, Math.min(90, 0.4 * len)))}
          dissolve={Boolean(props.next)}
        />
      );
      break;
    default:
      body = <DrawOn {...props} frame={frame} draw={drawFrames(len)} />;
  }
  return (
    <AbsoluteFill>
      {body}
      <Tag frame={frame} />
    </AbsoluteFill>
  );
};
