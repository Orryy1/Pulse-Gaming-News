// Motif: Grand Theft Auto. An homage to the series' box-art grid: a cream sheet ruled by thick black
// frames into panels of different sizes, each panel a picture in a bold pop-art treatment (duotone,
// punchy full colour, halftone dots) and one panel the title block, its lines set in stacked black
// boxes. Layout, colour, type and motion only: no logo, no series font, no artwork.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { displayText } from "../../../timeline.ts";
import { pairs, useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { Motif, MotifCardProps } from "../types.ts";
import {
  ANTON,
  cardFade,
  clamp,
  fitText,
  fitsAt,
  initials,
} from "./shared.ts";

const SHEET = "#f1eadb";
const INK = "#0e0d0c";
const WHITE = "#fbf7ee";
const BORDER = 8;
const GUTTER = 16;

type Cell = [number, number, number, number];
type Rect = { x: number; y: number; w: number; h: number };

/** Cells as fractions of a box, to pixel rects with a cream gutter between neighbours. */
function rects(cells: Cell[], box: Rect, mirror = false): Rect[] {
  return cells.map(([a, b, c, d]) => {
    const x0 = mirror ? 1 - c : a;
    const x1 = mirror ? 1 - a : c;
    return {
      x: Math.round(box.x + x0 * box.w + GUTTER / 2),
      y: Math.round(box.y + b * box.h + GUTTER / 2),
      w: Math.round((x1 - x0) * box.w - GUTTER),
      h: Math.round((d - b) * box.h - GUTTER),
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Panel treatments

type Treat = { duo?: [string, string]; dots: string; corner: number };
/** Full colour pushed hard, or a two-colour print (shadow, highlight), each with a halftone corner. */
const TREATS: Treat[] = [
  { dots: INK, corner: 0 },
  { duo: ["#3a1d6e", "#ffb067"], dots: "#2a1452", corner: 1 },
  { duo: ["#0f5561", "#86f7e4"], dots: "#0a3c45", corner: 2 },
  { dots: INK, corner: 3 },
  { duo: ["#5c1038", "#ff8cb6"], dots: "#40092a", corner: 0 },
  { duo: ["#1e1e1e", "#ffd84a"], dots: "#1e1e1e", corner: 1 },
  { dots: INK, corner: 2 },
  { duo: ["#15327c", "#ff8f63"], dots: "#0e2259", corner: 3 },
];
const FIELDS = [
  "#ff9447",
  "#62f2da",
  "#ffd43f",
  "#ff5c93",
  "#4d6bff",
  "#ff6a45",
];
const CORNERS = ["150deg", "330deg", "30deg", "210deg"];

const Halftone: React.FC<{
  colour: string;
  corner: number;
  opacity: number;
  size?: number;
}> = ({ colour, corner, opacity, size = 12 }) => {
  const mask = `linear-gradient(${CORNERS[corner % 4]}, #000 0%, rgba(0,0,0,0.6) 25%, rgba(0,0,0,0) 60%)`;
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `radial-gradient(circle, ${colour} ${size * 0.24}px, rgba(0,0,0,0) ${size * 0.3}px)`,
        backgroundSize: `${size}px ${size}px`,
        opacity,
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    />
  );
};

/** A picture in its pop-art treatment, drifting slowly (t runs 0 to 1 over the moment). */
const PopPicture: React.FC<{
  src: string;
  treat: Treat;
  zoom: number;
  pos: string;
  t: number;
  dir: number;
}> = ({ src, treat, zoom, pos, t, dir }) => (
  <AbsoluteFill
    style={{
      overflow: "hidden",
      isolation: "isolate",
      background: treat.duo ? treat.duo[0] : INK,
    }}
  >
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: pos,
        transform: `scale(${zoom * (1.04 + 0.07 * t)}) translateX(${dir * (t - 0.5) * 2.4}%)`,
        filter: treat.duo
          ? "grayscale(1) brightness(1.35) contrast(1.45)"
          : "contrast(1.22) saturate(1.5) brightness(1.04)",
      }}
    />
    {treat.duo ? (
      <>
        <AbsoluteFill
          style={{ background: treat.duo[1], mixBlendMode: "multiply" }}
        />
        <AbsoluteFill
          style={{ background: treat.duo[0], mixBlendMode: "lighten" }}
        />
      </>
    ) : null}
    <Halftone
      colour={treat.dots}
      corner={treat.corner}
      opacity={treat.duo ? 0.6 : 0.4}
    />
  </AbsoluteFill>
);

/**
 * A flat pop colour for a panel with no picture, in one of three print patterns (slow diagonal
 * stripes, a turning sunburst, a big halftone fade), with a halftone corner.
 */
const Field: React.FC<{
  colour: string;
  k: number;
  t: number;
  children?: React.ReactNode;
}> = ({ colour, k, t, children }) => {
  const pattern = k % 3;
  return (
    <AbsoluteFill style={{ background: colour, overflow: "hidden" }}>
      {pattern === 0 ? (
        <AbsoluteFill
          style={{
            backgroundImage: `repeating-linear-gradient(${k % 2 ? -55 : 55}deg, rgba(14,13,12,0.09) 0px, rgba(14,13,12,0.09) 16px, rgba(0,0,0,0) 16px, rgba(0,0,0,0) 40px)`,
            backgroundPosition: `${t * 80}px 0`,
          }}
        />
      ) : pattern === 1 ? (
        <AbsoluteFill
          style={{
            background: `repeating-conic-gradient(from ${t * 24 + k * 9}deg at ${k % 2 ? 15 : 85}% 110%, rgba(14,13,12,0.11) 0deg 5deg, rgba(0,0,0,0) 5deg 12deg)`,
          }}
        />
      ) : (
        <Halftone colour={INK} corner={k + 1} opacity={0.32} size={26} />
      )}
      <Halftone colour={INK} corner={k} opacity={0.42} />
      {children}
    </AbsoluteFill>
  );
};

/** A panel slamming in: big and fast, a little overshoot, a flash as it lands. */
function slam(
  frame: number,
  fps: number,
  at: number,
  r: Rect,
  centre: { x: number; y: number },
) {
  const s = spring({
    frame: frame - at,
    fps,
    config: { damping: 9, stiffness: 250, mass: 0.6 },
  });
  const dx = r.x + r.w / 2 - centre.x;
  const dy = r.y + r.h / 2 - centre.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const style: React.CSSProperties = {
    opacity: frame < at ? 0 : Math.min(1, s * 3),
    transform: `translate(${(dx / d) * 90 * (1 - s)}px, ${(dy / d) * 90 * (1 - s)}px) scale(${1.18 - 0.18 * s})`,
  };
  const flash =
    frame < at ? 0 : interpolate(frame - at, [2, 8], [0.55, 0], clamp);
  return { style, flash };
}

const Frame: React.FC<{
  r: Rect;
  style: React.CSSProperties;
  flash: number;
  children: React.ReactNode;
  background?: string;
}> = ({ r, style, flash, children, background = INK }) => (
  <div
    style={{
      position: "absolute",
      left: r.x,
      top: r.y,
      width: r.w,
      height: r.h,
      border: `${BORDER}px solid ${INK}`,
      boxSizing: "border-box",
      overflow: "hidden",
      background,
      ...style,
    }}
  >
    {children}
    {flash > 0 ? (
      <AbsoluteFill style={{ background: WHITE, opacity: flash }} />
    ) : null}
  </div>
);

/** Lines of heavy condensed type, each in its own black box, wiping in one after another. */
const StackedLines: React.FC<{
  lines: string[];
  size: number;
  frame: number;
  at: number;
  ink?: string;
  paper?: string;
}> = ({ lines, size, frame, at, ink = INK, paper = WHITE }) => (
  <div>
    {lines.map((line, i) => {
      const wipe = interpolate(frame, [at + i * 3, at + i * 3 + 7], [0, 1], {
        ...clamp,
        easing: (x) => 1 - (1 - x) ** 3,
      });
      return (
        <div
          key={i}
          style={{ marginTop: i ? size * 0.08 : 0, height: size * 1.12 }}
        >
          <span
            style={{
              display: "inline-block",
              background: ink,
              color: paper,
              fontFamily: DISPLAY,
              fontSize: size,
              lineHeight: 1,
              letterSpacing: "0.005em",
              padding: `${size * 0.07}px ${size * 0.15}px ${size * 0.05}px`,
              whiteSpace: "nowrap",
              clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
            }}
          >
            {line}
          </span>
        </div>
      );
    })}
  </div>
);

const Kicker: React.FC<{ text: string; accent: string; size?: number }> = ({
  text,
  accent,
  size = 26,
}) => (
  <div
    style={{
      display: "inline-block",
      background: INK,
      color: WHITE,
      borderLeft: `12px solid ${accent}`,
      padding: `${size * 0.34}px ${size * 0.6}px ${size * 0.3}px`,
      fontFamily: BODY,
      fontWeight: 900,
      fontSize: size,
      lineHeight: 1,
      letterSpacing: size * 0.2,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}
  >
    {text}
  </div>
);

/** The title panel: the kicker in a small black box, the heading in stacked boxes, the game and year. */
const TitleBlock: React.FC<{
  r: Rect;
  heading: string;
  kicker?: string;
  foot?: string;
  accent: string;
  frame: number;
  at: number;
  maxSize: number;
  k: number;
  /** A pop colour to set the block on (graphic styles); white otherwise. */
  field?: string;
}> = ({ r, heading, kicker, foot, accent, frame, at, maxSize, k, field }) => {
  const w = r.w - 2 * BORDER;
  const h = r.h - 2 * BORDER;
  const pad = Math.round(Math.max(24, Math.min(44, Math.min(w, h) * 0.08)));
  const footSize = foot && foot.length > 30 ? 22 : 26;
  // The kicker and the game share the top row when both fit: the heading gets the height.
  const kickerW = kicker ? kicker.length * 25.5 + 50 : 0;
  const footW = foot ? foot.length * (footSize * 0.74 + 3) : 0;
  const shareRow =
    Boolean(kicker && foot) && kickerW + footW + 40 <= w - 2 * pad;
  const kickerH = kicker ? 26 + 18 + 22 : 0;
  const footH =
    foot && !shareRow
      ? footSize *
          1.3 *
          Math.ceil((foot.length * footSize * 0.74) / (w - 2 * pad) || 1) +
        18
      : 0;
  const fit = fitText(heading, ANTON, {
    width: w - 2 * pad,
    height: h - 2 * pad - kickerH - footH,
    lineHeight: 1.2,
    maxLines: 4,
    maxSize,
    minSize: 40,
    padEm: 0.32,
  });
  const late = interpolate(frame, [at + 8, at + 16], [0, 1], clamp);
  const footStyle: React.CSSProperties = {
    fontFamily: BODY,
    fontWeight: 900,
    fontSize: footSize,
    lineHeight: 1.3,
    letterSpacing: 3,
    color: INK,
    textTransform: "uppercase",
    opacity: late,
  };
  return (
    <AbsoluteFill style={{ background: field ?? WHITE }}>
      {field ? (
        <Field
          colour={field}
          k={k}
          t={interpolate(frame, [0, 300], [0, 1], clamp)}
        />
      ) : (
        <Halftone colour={accent} corner={k + 2} opacity={0.55} size={14} />
      )}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: pad,
          bottom: pad,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {kicker ? (
          <div
            style={{
              marginBottom: 22,
              opacity: late,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Kicker text={kicker} accent={accent} />
            {shareRow ? <div style={footStyle}>{foot}</div> : null}
          </div>
        ) : null}
        <StackedLines
          lines={fit.lines}
          size={fit.size}
          frame={frame}
          at={at + 3}
        />
        {foot && !shareRow ? (
          <div
            style={{
              marginTop: 18,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: footSize,
              lineHeight: 1.3,
              letterSpacing: 3,
              color: INK,
              textTransform: "uppercase",
              opacity: late,
            }}
          >
            {foot}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** The year in giant type on a pop colour, filling its panel. */
const YearPanel: React.FC<{
  year: string;
  r: Rect;
  colour: string;
  k: number;
  t: number;
}> = ({ year, r, colour, k, t }) => {
  const w = r.w - 2 * BORDER;
  const h = r.h - 2 * BORDER;
  const size = Math.min(
    h * 0.86,
    (w * 0.86) / Math.max(1, year.length * 0.494),
  );
  return (
    <Field colour={colour} k={k} t={t}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: size,
            lineHeight: 1,
            color: INK,
            transform: `scale(${1 + 0.05 * t})`,
          }}
        >
          {year}
        </div>
      </AbsoluteFill>
    </Field>
  );
};

// ---------------------------------------------------------------------------------------------------
// The card

/** Three grids in the box-art manner: big and small panels, the title block in a different place. */
const LAYOUTS: Array<{ title: Cell; cells: Cell[] }> = [
  {
    title: [0.48, 0.32, 1, 0.78],
    cells: [
      [0, 0, 0.3, 0.62],
      [0.3, 0, 0.64, 0.32],
      [0.64, 0, 1, 0.32],
      [0.3, 0.32, 0.48, 0.62],
      [0, 0.62, 0.18, 1],
      [0.18, 0.62, 0.48, 1],
      [0.48, 0.78, 0.74, 1],
      [0.74, 0.78, 1, 1],
    ],
  },
  {
    title: [0, 0.56, 0.54, 1],
    cells: [
      [0, 0, 0.26, 0.56],
      [0.26, 0, 0.54, 0.3],
      [0.26, 0.3, 0.54, 0.56],
      [0.54, 0, 1, 0.44],
      [0.54, 0.44, 0.78, 1],
      [0.78, 0.44, 1, 0.72],
      [0.78, 0.72, 1, 1],
    ],
  },
  {
    title: [0.22, 0.3, 0.8, 0.72],
    cells: [
      [0, 0, 0.22, 0.5],
      [0.22, 0, 0.58, 0.3],
      [0.58, 0, 0.8, 0.3],
      [0.8, 0, 1, 0.62],
      [0, 0.5, 0.22, 1],
      [0.22, 0.72, 0.5, 1],
      [0.5, 0.72, 0.8, 1],
      [0.8, 0.62, 1, 1],
    ],
  },
];
const ACCENTS = ["#ff9447", "#ff5c93", "#62f2da", "#ffd43f"];
const POS_X = [50, 22, 78, 36, 64];
const POS_Y = [45, 30, 60];

export const GtaCard: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = Math.abs(Math.floor(variant));
  const L = LAYOUTS[v % LAYOUTS.length]!;
  const mirror = Math.floor(v / LAYOUTS.length) % 2 === 1;
  const box: Rect = {
    x: 36 - GUTTER / 2,
    y: 36 - GUTTER / 2,
    w: 1920 - 72 + GUTTER,
    h: 1080 - 72 + GUTTER,
  };
  const all = rects([L.title, ...L.cells], box, mirror);
  const titleRect = all[0]!;
  const cells = all.slice(1);
  const centre = { x: 960, y: 540 };
  const t = interpolate(frame, [0, Math.max(30, frames)], [0, 1], clamp);
  const pics = pictures.filter(Boolean).slice(0, 6);
  const head = displayText(heading).toUpperCase().trim();
  const yr = year ? displayText(year).trim() : "";
  const gameText = game ? displayText(game).trim() : "";
  const accent = ACCENTS[v % ACCENTS.length]!;

  // Pictures go to the biggest panels first; the smallest panel holds the year when there is one.
  const bySize = cells
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h);
  const yearCell = yr && yr.length <= 6 ? bySize[bySize.length - 1]!.i : -1;
  // The game under the heading, and the year too unless a panel already shows it.
  const foot = [
    gameText.toUpperCase() !== head ? gameText : "",
    yearCell < 0 ? yr : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  const picFor: Record<number, number> = {};
  bySize
    .filter((c) => c.i !== yearCell)
    .forEach((c, rank) => {
      picFor[c.i] = rank;
    });

  // Slam order: the big panels first so the sheet fills fast, the title block third, two frames apart.
  const order = bySize.map((c) => c.i);
  const seq = [...order.slice(0, 2), -1, ...order.slice(2)];
  const at = (i: number) => 1 + seq.indexOf(i) * 2;
  const titleAt = at(-1);
  const shake =
    frame > titleAt ? interpolate(frame - titleAt, [0, 9], [1, 0], clamp) : 0;
  const push = interpolate(frame, [0, Math.max(30, frames)], [1, 1.045], clamp);

  const titleSlam = slam(frame, fps, titleAt, titleRect, centre);
  return (
    <AbsoluteFill
      style={{
        background: SHEET,
        opacity: cardFade(frame, frames),
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          transform: `scale(${push}) translate(${Math.sin(frame * 2.1) * 7 * shake}px, ${Math.cos(frame * 2.7) * 5 * shake}px)`,
        }}
      >
        {cells.map((r, i) => {
          const s = slam(frame, fps, at(i), r, centre);
          let inner: React.ReactNode;
          if (i === yearCell) {
            inner = <YearPanel year={yr} r={r} colour={accent} k={i} t={t} />;
          } else if (pics.length) {
            const rank = picFor[i] ?? i;
            const round = Math.floor(rank / pics.length);
            inner = (
              <PopPicture
                src={pics[rank % pics.length]!}
                treat={
                  TREATS[
                    (rank + v + (pics.length > 1 ? round * 3 : 0)) %
                      TREATS.length
                  ]!
                }
                zoom={1 + Math.min(0.6, round * 0.22)}
                pos={`${POS_X[(rank + round) % POS_X.length]}% ${POS_Y[rank % POS_Y.length]}%`}
                t={t}
                dir={i % 2 ? 1 : -1}
              />
            );
          } else {
            inner = (
              <Field colour={FIELDS[(i + v) % FIELDS.length]!} k={i} t={t} />
            );
          }
          return (
            <Frame key={i} r={r} style={s.style} flash={s.flash}>
              {inner}
            </Frame>
          );
        })}
        <Frame
          r={titleRect}
          style={titleSlam.style}
          flash={titleSlam.flash}
          background={WHITE}
        >
          <TitleBlock
            r={titleRect}
            heading={head}
            kicker={kicker ? displayText(kicker) : undefined}
            foot={foot || undefined}
            accent={accent}
            frame={frame}
            at={titleAt}
            maxSize={170}
            k={v}
          />
        </Frame>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(90% 90% at 50% 50%, rgba(0,0,0,0) 60%, rgba(40,28,10,0.18) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// Graphic styles: the same grid language for a sentence's people or list

/** The safe area of a graphic (96 px sides, 130 top, 72 bottom), widened by half a gutter. */
const SAFE: Rect = {
  x: 96 - GUTTER / 2,
  y: 130 - GUTTER / 2,
  w: 1728 + GUTTER,
  h: 878 + GUTTER,
};

const PEOPLE_LAYOUTS: Record<number, Cell[]> = {
  1: [
    [0, 0, 0.42, 1],
    [0.42, 0, 1, 1],
  ],
  2: [
    [0, 0, 0.34, 1],
    [0.34, 0, 0.67, 1],
    [0.67, 0, 1, 1],
  ],
  3: [
    [0, 0, 0.3, 1],
    [0.3, 0, 0.62, 1],
    [0.62, 0, 1, 0.5],
    [0.62, 0.5, 1, 1],
  ],
  4: [
    [0, 0, 0.3, 1],
    [0.3, 0, 0.64, 0.5],
    [0.64, 0, 1, 0.5],
    [0.3, 0.5, 0.6, 1],
    [0.6, 0.5, 1, 1],
  ],
};

const LIST_LAYOUTS: Record<number, Cell[]> = {
  2: [
    [0, 0, 0.36, 1],
    [0.36, 0, 1, 0.5],
    [0.36, 0.5, 1, 1],
  ],
  3: [
    [0, 0, 0.36, 1],
    [0.36, 0, 1, 0.42],
    [0.36, 0.42, 0.68, 1],
    [0.68, 0.42, 1, 1],
  ],
  4: [
    [0, 0, 0.32, 1],
    [0.32, 0, 0.7, 0.5],
    [0.7, 0, 1, 0.5],
    [0.32, 0.5, 0.6, 1],
    [0.6, 0.5, 1, 1],
  ],
  5: [
    [0, 0, 0.3, 1],
    [0.3, 0, 0.64, 0.5],
    [0.64, 0, 1, 0.5],
    [0.3, 0.5, 0.53, 1],
    [0.53, 0.5, 0.77, 1],
    [0.77, 0.5, 1, 1],
  ],
  6: [
    [0, 0, 0.28, 1],
    [0.28, 0, 0.5, 0.5],
    [0.5, 0, 0.76, 0.5],
    [0.76, 0, 1, 0.5],
    [0.28, 0.5, 0.54, 1],
    [0.54, 0.5, 0.76, 1],
    [0.76, 0.5, 1, 1],
  ],
};

/** A name in stacked black boxes and the role in a white box, at the bottom left of a panel. */
const NameCaption: React.FC<{
  name: string;
  role: string;
  w: number;
  frame: number;
  at: number;
}> = ({ name, role, w, frame, at }) => {
  // A bigger panel gets a bigger name: about an eighth of its width, 64 to 120 px.
  const maxSize = Math.round(Math.max(64, Math.min(120, w * 0.12)));
  const roleSize = w > 800 ? 34 : w > 520 ? 28 : 26;
  const fit = fitText(name.toUpperCase(), ANTON, {
    width: w - 56,
    height: maxSize * 2.5,
    lineHeight: 1.2,
    maxLines: 2,
    maxSize,
    minSize: 36,
    padEm: 0.32,
  });
  const roleIn = interpolate(frame, [at + 9, at + 16], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", left: 24, right: 24, bottom: 24 }}>
      <StackedLines
        lines={fit.lines}
        size={fit.size}
        frame={frame}
        at={at + 3}
      />
      {role ? (
        <div
          style={{
            display: "inline-block",
            marginTop: 8,
            maxWidth: w - 48,
            background: WHITE,
            color: INK,
            padding: `${roleSize * 0.35}px ${roleSize * 0.55}px ${roleSize * 0.3}px`,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: roleSize,
            lineHeight: 1.25,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            opacity: roleIn,
            transform: `translateX(${(1 - roleIn) * -20}px)`,
          }}
        >
          {role}
        </div>
      ) : null}
    </div>
  );
};

const GtaPeople: React.FC<GfxProps> = ({
  g,
  len,
  src,
  photos = {},
  variant = 0,
}) => {
  const { frame, fps, dim, visible, showFor } = useStage(len, 210);
  const rows = pairs(g.items).slice(0, 4);
  if (!visible || !rows.length) return null;
  const v = Math.abs(Math.floor(variant));
  const all = rects(PEOPLE_LAYOUTS[rows.length]!, SAFE, v % 2 === 1);
  const titleRect = all[0]!;
  const t = interpolate(frame, [0, showFor], [0, 1], clamp);
  const centre = { x: 960, y: 569 };
  const accent = ACCENTS[v % ACCENTS.length]!;
  const heading = (
    g.primary ? displayText(g.primary) : "The people"
  ).toUpperCase();
  const titleSlam = slam(frame, fps, 3, titleRect, centre);
  return (
    <AbsoluteFill style={{ opacity: dim, background: SHEET }}>
      {rows.map((p, i) => {
        const r = all[i + 1]!;
        const at = 8 + i * 5;
        const s = slam(frame, fps, at, r, centre);
        const photo = photos[p.a.toLowerCase()];
        const pic = photo ?? src;
        const w = r.w - 2 * BORDER;
        const h = r.h - 2 * BORDER;
        const ini = initials(p.a);
        return (
          <Frame key={i} r={r} style={s.style} flash={s.flash}>
            {pic ? (
              <PopPicture
                src={pic}
                treat={TREATS[(i * 3 + 1 + v) % TREATS.length]!}
                zoom={photo ? 1 : 1.1 + 0.15 * i}
                pos={
                  photo ? "50% 22%" : `${POS_X[(i + v) % POS_X.length]}% 45%`
                }
                t={t}
                dir={i % 2 ? 1 : -1}
              />
            ) : (
              <Field colour={FIELDS[(i + v) % FIELDS.length]!} k={i} t={t}>
                <AbsoluteFill
                  style={{ alignItems: "center", paddingTop: h * 0.08 }}
                >
                  <div
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: Math.min(
                        h * 0.5,
                        (w * 0.75) / Math.max(0.5, ini.length * 0.49),
                      ),
                      lineHeight: 1,
                      color: INK,
                      opacity: 0.9,
                    }}
                  >
                    {ini}
                  </div>
                </AbsoluteFill>
              </Field>
            )}
            <NameCaption name={p.a} role={p.b} w={w} frame={frame} at={at} />
          </Frame>
        );
      })}
      <Frame
        r={titleRect}
        style={titleSlam.style}
        flash={titleSlam.flash}
        background={WHITE}
      >
        <TitleBlock
          r={titleRect}
          heading={heading}
          accent={accent}
          frame={frame}
          at={3}
          maxSize={150}
          k={v}
          field={FIELDS[(rows.length + v) % FIELDS.length]}
        />
      </Frame>
    </AbsoluteFill>
  );
};

const GtaList: React.FC<GfxProps> = ({ g, len, src, variant = 0 }) => {
  const items = g.items
    .map((x) => displayText(x).trim())
    .filter(Boolean)
    .slice(0, 6);
  const { frame, fps, dim, visible, showFor } = useStage(
    len,
    60 + items.length * 26,
  );
  if (!visible || items.length < 2) return null;
  const v = Math.abs(Math.floor(variant));
  const all = rects(LIST_LAYOUTS[items.length]!, SAFE, v % 2 === 1);
  const titleRect = all[0]!;
  const t = interpolate(frame, [0, showFor], [0, 1], clamp);
  const centre = { x: 960, y: 569 };
  const accent = ACCENTS[v % ACCENTS.length]!;
  const heading = displayText(g.primary).toUpperCase().trim();
  const titleSlam = slam(frame, fps, 3, titleRect, centre);
  return (
    <AbsoluteFill style={{ opacity: dim, background: SHEET }}>
      {items.map((item, i) => {
        const r = all[i + 1]!;
        const at = 8 + i * 5;
        const s = slam(frame, fps, at, r, centre);
        const w = r.w - 2 * BORDER;
        const h = r.h - 2 * BORDER;
        // Pictures and colour fields alternate when there is a picture; the text sits on a white
        // box over a picture, straight on the colour otherwise.
        const onPic = Boolean(src) && i % 2 === v % 2;
        const text = item.toUpperCase();
        const fit = fitText(text, ANTON, {
          width: w - 56,
          height: (h - 110) * (onPic ? 0.62 : 0.9),
          lineHeight: onPic ? 1.2 : 1.02,
          maxLines: 3,
          maxSize: onPic ? 70 : 110,
          minSize: 34,
          padEm: onPic ? 0.32 : 0,
        });
        const textIn = interpolate(frame, [at + 3, at + 10], [0, 1], clamp);
        return (
          <Frame key={i} r={r} style={s.style} flash={s.flash}>
            {onPic ? (
              <PopPicture
                src={src!}
                treat={TREATS[(i * 3 + 1 + v) % TREATS.length]!}
                zoom={1.1 + 0.18 * (i % 3)}
                pos={`${POS_X[(i + v) % POS_X.length]}% ${POS_Y[i % POS_Y.length]}%`}
                t={t}
                dir={i % 2 ? 1 : -1}
              />
            ) : (
              <Field colour={FIELDS[(i + v) % FIELDS.length]!} k={i} t={t} />
            )}
            <div
              style={{
                position: "absolute",
                left: 22,
                top: 22,
                background: INK,
                color: WHITE,
                fontFamily: DISPLAY,
                fontSize: 46,
                lineHeight: 1,
                padding: "8px 14px 6px",
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </div>
            <div
              style={{ position: "absolute", left: 24, right: 24, bottom: 22 }}
            >
              {onPic ? (
                <StackedLines
                  lines={fit.lines}
                  size={fit.size}
                  frame={frame}
                  at={at + 3}
                  ink={WHITE}
                  paper={INK}
                />
              ) : (
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: fit.size,
                    lineHeight: 1.02,
                    color: INK,
                    opacity: textIn,
                    transform: `translateY(${(1 - textIn) * 24}px)`,
                  }}
                >
                  {fit.lines.map((l, k) => (
                    <div key={k}>{l}</div>
                  ))}
                </div>
              )}
            </div>
          </Frame>
        );
      })}
      <Frame
        r={titleRect}
        style={titleSlam.style}
        flash={titleSlam.flash}
        background={WHITE}
      >
        {heading ? (
          <TitleBlock
            r={titleRect}
            heading={heading}
            accent={accent}
            frame={frame}
            at={3}
            maxSize={150}
            k={v}
            field={FIELDS[(items.length + v) % FIELDS.length]}
          />
        ) : (
          <Field colour={accent} k={v} t={t} />
        )}
      </Frame>
    </AbsoluteFill>
  );
};

// What will draw well: the narrowest panel of each layout, less its padding, has to hold the text.
const PEOPLE_WIDTH: Record<number, number> = { 1: 950, 2: 540, 3: 520, 4: 480 };
const LIST_WIDTH: Record<number, number> = {
  2: 1050,
  3: 500,
  4: 420,
  5: 340,
  6: 330,
};

export const GTA: Motif = {
  id: "gta",
  name: "Grand Theft Auto box-art grid",
  matches: (game) =>
    /grand theft auto|\bgta\b/i.test(`${game.title} ${game.theme ?? ""}`),
  card: GtaCard,
  styles: {
    Panels: {
      kind: "people",
      component: GtaPeople,
      sound: "pop",
      fits: (g) => {
        const rows = pairs(g.items);
        if (
          rows.length < 1 ||
          rows.length > 4 ||
          rows.length !== g.items.length
        )
          return false;
        const w = PEOPLE_WIDTH[rows.length]! - 56;
        return (
          g.primary.length <= 32 &&
          rows.every(
            (r) =>
              r.b.length <= 48 &&
              fitsAt(r.a.toUpperCase(), ANTON, {
                width: w,
                height: 150,
                lineHeight: 1.2,
                maxLines: 2,
                maxSize: 72,
                minSize: 40,
                padEm: 0.32,
              }),
          )
        );
      },
    },
    PanelList: {
      kind: "list",
      component: GtaList,
      sound: "pop",
      fits: (g) => {
        const items = g.items.map((x) => x.trim()).filter(Boolean);
        if (items.length < 2 || items.length > 6 || g.primary.length > 32)
          return false;
        const w = LIST_WIDTH[items.length]! - 56;
        return items.every(
          (x) =>
            x.length <= 48 &&
            fitsAt(displayText(x).toUpperCase(), ANTON, {
              width: w,
              height: 190,
              lineHeight: 1.2,
              maxLines: 3,
              maxSize: 70,
              minSize: 36,
              padEm: 0.32,
            }),
        );
      },
    },
  } satisfies Record<string, GfxStyle>,
};
