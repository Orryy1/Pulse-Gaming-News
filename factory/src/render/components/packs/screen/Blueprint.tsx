// Screen pack, "Blueprint": specs as a technical drawing. White line work on blueprint blue: the sheet
// border draws on, a generic schematic takes shape in the middle, each "label: value" row arrives as a
// callout on a leader line with a dimension mark under it, and the heading sits in the title block.
// The last value is picked out in amber. All drawing ends by about frame 90.
import React from "react";
import { interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { SPRING } from "../../../motion.ts";
import { BODY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import { clamp, easeInOut, easeOut, paceFor, sizeByLength, specRows, txt } from "./common.ts";

const LINE = "rgba(232,242,255,0.94)";
const FAINT = "rgba(170,205,255,0.5)";
const LABEL = "#A6CBFF";
const VALUE = "#F4F8FF";

// The sheet: border inside the safe area, the drawing in the middle, the title block bottom right.
const SHEET = { x: 96, y: 144, w: 1728, h: 864 };
const PLATE = { x: 700, y: 330, w: 520, h: 340 };
const CX = PLATE.x + PLATE.w / 2;
const CY = PLATE.y + PLATE.h / 2;
const TB = {
  x: 1200,
  y: 852,
  w: SHEET.x + SHEET.w - 14 - 1200,
  h: SHEET.y + SHEET.h - 14 - 852,
};

/** An SVG path that draws itself: p runs 0..1. */
const Draw: React.FC<{
  d: string;
  p: number;
  stroke?: string;
  width?: number;
}> = ({ d, p, stroke = LINE, width = 2.5 }) =>
  p <= 0 ? null : (
    <path
      d={d}
      pathLength={1}
      stroke={stroke}
      strokeWidth={width}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="1 1"
      strokeDashoffset={1 - p}
    />
  );

const rect = (x: number, y: number, w: number, h: number) =>
  `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy}`;

/** The generic object at the centre of the sheet: a chip, a device or a target, drawn in strokes. */
function schematic(type: "chip" | "device" | "target"): {
  main: string[];
  fine: string[];
} {
  if (type === "chip") {
    const s = 280;
    const x = CX - s / 2;
    const y = CY - s / 2;
    let pins = "";
    for (let i = 0; i < 9; i++) {
      const o = 30 + i * 27.5;
      pins += `M${x + o} ${y} V${y - 22} M${x + o} ${y + s} V${y + s + 22} M${x} ${y + o} H${x - 22} M${x + s} ${y + o} H${x + s + 22} `;
    }
    return {
      main: [rect(x, y, s, s), rect(CX - 75, CY - 75, 150, 150), pins],
      fine: [
        circle(x + 34, y + 34, 10),
        `M${CX - 75} ${CY - 25} L${CX - 25} ${CY - 75} M${CX - 75} ${CY + 25} L${CX + 25} ${CY - 75} M${CX - 75} ${CY + 75} L${CX + 75} ${CY - 75} M${CX - 25} ${CY + 75} L${CX + 75} ${CY - 25} M${CX + 25} ${CY + 75} L${CX + 75} ${CY + 25}`,
      ],
    };
  }
  if (type === "device") {
    const w = 480;
    const h = 250;
    const x = CX - w / 2;
    const y = CY - h / 2;
    const r = 44;
    const body = `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    let vents = "";
    for (let i = 0; i < 7; i++)
      vents += `M${x + 300 + i * 18} ${y + 170} V${y + 215} `;
    return {
      main: [
        body,
        circle(x + 140, CY, 78),
        circle(x + 140, CY, 26),
        rect(x + 280, y + 46, 150, 90),
      ],
      fine: [
        vents,
        circle(x + 140, CY, 52),
        `M${x + 22} ${y + 22} h1 M${x + w - 22} ${y + 22} h1`,
      ],
    };
  }
  let ticks = "";
  for (let a = 0; a < 360; a += 15) {
    const rad = (a * Math.PI) / 180;
    const r1 = 160;
    const r2 = a % 45 === 0 ? 182 : 172;
    ticks += `M${CX + r1 * Math.cos(rad)} ${CY + r1 * Math.sin(rad)} L${CX + r2 * Math.cos(rad)} ${CY + r2 * Math.sin(rad)} `;
  }
  return {
    main: [circle(CX, CY, 160), circle(CX, CY, 104), circle(CX, CY, 44)],
    fine: [ticks, circle(CX, CY, 132)],
  };
}

const HARDWARE =
  /\b(cpu|gpu|ram|memory|chip|processor|hardware|console|clock|mhz|ghz|storage|bit|vram|cores?|disc|drive|resolution|fps)\b/i;

export const Blueprint: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 200);
  const rows = (specRows(g.items) ?? []).slice(0, 6);
  const heading = txt(g.primary).toUpperCase();
  if (!visible || rows.length < 2) return null;

  const pace = paceFor(showFor);
  const hardware = HARDWARE.test(`${g.primary} ${g.items.join(" ")}`);
  const type = hardware ? (variant % 2 === 0 ? "chip" : "device") : "target";
  const shape = schematic(type);

  const border = interpolate(frame, [2, 26], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const zones = interpolate(frame, [16, 28], [0, 1], clamp);
  const draw = interpolate(frame, [8, 40], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const fine = interpolate(frame, [22, 44], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const centre = interpolate(frame, [12, 30], [0, 1], clamp);
  const tbLines = interpolate(frame, [14, 34], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const tbText = interpolate(frame, [26, 42], [0, 1], {
    ...clamp,
    easing: easeOut,
  });

  // Rows split into a left and a right column; the left reads first.
  const leftN = Math.ceil(rows.length / 2);
  const spots = (k: number, from: number, to: number) =>
    k === 1
      ? [(from + to) / 2]
      : Array.from({ length: k }, (_, i) => from + ((to - from) * i) / (k - 1));
  const callouts = rows.map((r, i) => {
    const left = i < leftN;
    const k = left ? leftN : rows.length - leftN;
    const j = left ? i : i - leftN;
    const y = spots(k, k === 3 ? 290 : 365, k === 3 ? 710 : 635)[j]!;
    const ay = spots(k, k === 3 ? 390 : 410, k === 3 ? 610 : 590)[j]!;
    const ax = left ? PLATE.x : PLATE.x + PLATE.w;
    const ex = left ? PLATE.x - 56 : PLATE.x + PLATE.w + 56;
    const tx = left ? 606 : 1314;
    return { ...r, left, y, ay, ax, ex, tx, start: 26 + i * 8 * pace };
  });

  const headSize = sizeByLength(heading.length, [
    [16, 40],
    [24, 34],
    [999, 30],
  ]);

  return (
    <Stage dim={dim} bg="blueprint" variant={variant}>
      <svg
        width={1920}
        height={1080}
        viewBox="0 0 1920 1080"
        style={{ position: "absolute", inset: 0 }}
      >
        {/* The sheet border, doubled, with zone ticks. */}
        <Draw
          d={rect(SHEET.x, SHEET.y, SHEET.w, SHEET.h)}
          p={border}
          width={3}
        />
        <Draw
          d={rect(SHEET.x + 14, SHEET.y + 14, SHEET.w - 28, SHEET.h - 28)}
          p={border}
          width={1.5}
          stroke={FAINT}
        />
        <g opacity={zones}>
          {Array.from({ length: 9 }, (_, i) => {
            const x = SHEET.x + (SHEET.w / 10) * (i + 1);
            return (
              <path
                key={i}
                d={`M${x} ${SHEET.y} V${SHEET.y + 14} M${x} ${SHEET.y + SHEET.h} V${SHEET.y + SHEET.h - 14}`}
                stroke={FAINT}
                strokeWidth={1.5}
              />
            );
          })}
          {Array.from({ length: 4 }, (_, i) => {
            const y = SHEET.y + (SHEET.h / 5) * (i + 1);
            return (
              <path
                key={i}
                d={`M${SHEET.x} ${y} H${SHEET.x + 14} M${SHEET.x + SHEET.w} ${y} H${SHEET.x + SHEET.w - 14}`}
                stroke={FAINT}
                strokeWidth={1.5}
              />
            );
          })}
        </g>
        {/* Centre lines through the object. */}
        <g opacity={centre}>
          <path
            d={`M${CX - 330} ${CY} H${CX + 330} M${CX} ${CY - 220} V${CY + 220}`}
            stroke={FAINT}
            strokeWidth={1.5}
            strokeDasharray="34 8 6 8"
          />
        </g>
        {/* The object. */}
        {shape.main.map((d, i) => (
          <Draw key={i} d={d} p={draw} width={3} />
        ))}
        {shape.fine.map((d, i) => (
          <Draw key={i} d={d} p={fine} width={1.6} stroke={FAINT} />
        ))}
        {/* A scale bar at the foot, bottom left: shapes only. */}
        <g opacity={tbLines}>
          {Array.from({ length: 5 }, (_, i) => (
            <rect
              key={i}
              x={SHEET.x + 54 + i * 46}
              y={SHEET.y + SHEET.h - 64}
              width={46}
              height={12}
              fill={i % 2 === 0 ? LINE : "none"}
              stroke={LINE}
              strokeWidth={1.5}
              opacity={interpolate(frame, [20 + i * 3, 26 + i * 3], [0, 1], clamp)}
            />
          ))}
          <path
            d={`M${SHEET.x + 54} ${SHEET.y + SHEET.h - 74} V${SHEET.y + SHEET.h - 42} M${SHEET.x + 54 + 230} ${SHEET.y + SHEET.h - 74} V${SHEET.y + SHEET.h - 42}`}
            stroke={LINE}
            strokeWidth={1.5}
          />
        </g>
        {/* The title block: a projection symbol cell and the title cell. */}
        <Draw d={rect(TB.x, TB.y, TB.w, TB.h)} p={tbLines} width={2.5} />
        <Draw
          d={`M${TB.x + 130} ${TB.y} V${TB.y + TB.h}`}
          p={tbLines}
          width={2}
        />
        <g opacity={tbText} stroke={LINE} strokeWidth={2} fill="none">
          <path
            d={`M${TB.x + 24} ${TB.y + TB.h / 2 - 18} L${TB.x + 62} ${TB.y + TB.h / 2 - 28} V${TB.y + TB.h / 2 + 28} L${TB.x + 24} ${TB.y + TB.h / 2 + 18} Z`}
          />
          <path d={circle(TB.x + 96, TB.y + TB.h / 2, 24)} />
          <path d={circle(TB.x + 96, TB.y + TB.h / 2, 10)} />
        </g>
        {/* Leader lines from the object out to each callout, with a dot where they touch it. */}
        {callouts.map((c, i) => {
          const p = interpolate(frame, [c.start, c.start + 12], [0, 1], {
            ...clamp,
            easing: easeOut,
          });
          const dot = spring({
            frame: frame - c.start,
            fps,
            config: SPRING.POP,
          });
          const last = i === rows.length - 1;
          const colour = last ? COLOUR.amber : LINE;
          return (
            <g key={i}>
              <Draw
                d={`M${c.ax} ${c.ay} L${c.ex} ${c.y} L${c.tx} ${c.y}`}
                p={p}
                width={2.5}
                stroke={colour}
              />
              <circle
                cx={c.ax}
                cy={c.ay}
                r={9 * dot}
                fill="#0f2747"
                stroke={colour}
                strokeWidth={2.5}
              />
              <circle cx={c.ax} cy={c.ay} r={3.5 * dot} fill={colour} />
            </g>
          );
        })}
      </svg>

      {/* The title block's words. */}
      <div
        style={{
          position: "absolute",
          left: TB.x + 130 + 26,
          top: TB.y,
          width: TB.w - 130 - 46,
          height: TB.h,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          clipPath: `inset(0 ${(1 - tbText) * 100}% 0 0)`,
        }}
      >
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: 4,
            color: LABEL,
          }}
        >
          TITLE
        </div>
        <div
          style={{
            marginTop: 4,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: headSize,
            lineHeight: 1.08,
            letterSpacing: 1.5,
            color: VALUE,
          }}
        >
          {heading}
        </div>
      </div>

      {/* The callouts: label above, value on the leader, a dimension mark under the value. */}
      {callouts.map((c, i) => {
        const last = i === rows.length - 1;
        const wipe = interpolate(frame, [c.start + 9, c.start + 20], [0, 1], {
          ...clamp,
          easing: easeOut,
        });
        const dimP = interpolate(frame, [c.start + 14, c.start + 24], [0, 1], {
          ...clamp,
          easing: easeOut,
        });
        const size = sizeByLength(c.b.length, [
          [8, 58],
          [12, 50],
          [16, 42],
          [999, 36],
        ]);
        const lineH = Math.round(size * 1.12);
        const tick = (side: "left" | "right") => (
          <div
            style={{
              position: "absolute",
              [side]: 0,
              top: -9,
              width: 2,
              height: 20,
              background: last ? COLOUR.amber : LINE,
              opacity: dimP,
            }}
          />
        );
        const arrow = (side: "left" | "right") => (
          <div
            style={{
              position: "absolute",
              [side]: 3,
              top: -5,
              width: 0,
              height: 0,
              borderTop: "6px solid transparent",
              borderBottom: "6px solid transparent",
              [side === "left" ? "borderRight" : "borderLeft"]:
                `14px solid ${last ? COLOUR.amber : LINE}`,
              opacity: dimP,
            }}
          />
        );
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: c.y - lineH / 2,
              [c.left ? "right" : "left"]: c.left
                ? 1920 - (c.tx - 16)
                : c.tx + 16,
              width: 460,
              display: "flex",
              flexDirection: "column",
              alignItems: c.left ? "flex-end" : "flex-start",
              clipPath: c.left
                ? `inset(-200px 0 -60px ${(1 - wipe) * 100}%)`
                : `inset(-200px ${(1 - wipe) * 100}% -60px 0)`,
            }}
          >
            <div style={{ position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  bottom: "100%",
                  [c.left ? "right" : "left"]: 0,
                  width: 440,
                  textAlign: c.left ? "right" : "left",
                  paddingBottom: 6,
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 24,
                  lineHeight: 1.2,
                  letterSpacing: 3,
                  color: last ? "#FFB27A" : LABEL,
                  textTransform: "uppercase",
                }}
              >
                {c.a}
              </div>
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: size,
                  lineHeight: `${lineH}px`,
                  color: last ? COLOUR.amber : VALUE,
                  whiteSpace: "nowrap",
                  textShadow: last
                    ? "0 0 24px rgba(255,107,26,0.35)"
                    : undefined,
                }}
              >
                {c.b}
              </div>
              <div style={{ position: "relative", height: 2, marginTop: 14 }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: 2,
                    background: last ? COLOUR.amber : LINE,
                    transform: `scaleX(${dimP})`,
                  }}
                />
                {tick("left")}
                {tick("right")}
                {arrow("left")}
                {arrow("right")}
              </div>
            </div>
          </div>
        );
      })}
    </Stage>
  );
};

/** Two to six "label: value" rows whose values fit a callout (at most 20 characters). */
export const fitsBlueprint = (g: MomentGraphic) => {
  const rows = specRows(g.items);
  return Boolean(
    rows &&
    rows.length >= 2 &&
    rows.length <= 6 &&
    rows.every((r) => r.a.length <= 30 && r.b.length <= 20) &&
    txt(g.primary).length <= 44,
  );
};
