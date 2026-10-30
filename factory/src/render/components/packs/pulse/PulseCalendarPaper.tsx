// Pulse apps, "PulseCalendarPaper" (owner, 30 Oct 2026): a date from before the smartphone, on the Pulse
// wall calendar of its period. It swings onto its nail, the camera pushes in on the month, the day is circled
// in red pen (or, with no day, the month's name is), a pen arrow runs down to the notes strip and the event
// (the graphic's secondary) is written there by hand. The month grid is the real one (./PulseCalendar.tsx
// works it out); the picture at the top is the sentence's game when there is one. Up to 1994 a cream page with
// a serif masthead and a faded print; 1995-2004 a white page with an amber band; 2005-2011 a glossy page with a
// poster face. Branded PULSE only. Tagged ILLUSTRATION.
import React from "react";
import { Img, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY, HAND } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import { DRAWN_BY } from "../fit.ts";
import {
  GRAIN,
  MOTTLE,
  RED_PEN,
  SHEET_LIGHT,
  Write,
  handFit,
  jit,
} from "../paper/kit.tsx";
import { clamp, easeInOut, easeOut, txt } from "../screen/common.ts";
import { PulseMark } from "../screen/pulse.tsx";
import { IllustrationMark } from "./handset.tsx";
import { MONTHS, calendarDate, monthGrid } from "./PulseCalendar.tsx";

const CW = 820;
const CH = 960;
const GX = 30;
const GW = CW - GX * 2;
const GRID_TOP = 476;
const NOTES_TOP = 868;
const DAYS3 = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** The calendar's period look by the date's year. */
export function wallLook(year: number): "print" | "band" | "gloss" {
  return year <= 1994 ? "print" : year <= 2004 ? "band" : "gloss";
}

/** A hand-drawn loop round (cx, cy): a little more than one turn, wobbling, as a pen circles a date. */
export function penLoop(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
): string {
  const pts: string[] = [];
  const turns = 1.18;
  const n = 40;
  const a0 = -2.2 + 0.3 * jit(seed, 1);
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * turns * Math.PI * 2;
    // The second pass drifts outwards a touch, as a hand's loop never closes on itself.
    const grow = 1 + 0.1 * (i / n) + 0.03 * jit(seed, 10 + i);
    pts.push(
      `${(cx + rx * grow * Math.cos(a)).toFixed(1)} ${(cy + ry * grow * Math.sin(a)).toFixed(1)}`,
    );
  }
  return `M${pts.join(" L")}`;
}

export const PulseCalendarPaper: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  src,
}) => {
  const { frame, fps, dim, visible } = useStage(len, 240);
  const date = calendarDate(txt(g.primary));
  if (!visible || !date) return null;
  const what = txt(g.secondary);
  const look = wallLook(date.year);
  const grid = monthGrid(date.year, date.month);
  const monthName = MONTHS[date.month]!;
  const seed = 3 + variant * 7;
  const side = variant % 2 ? 1 : -1;
  const cellW = GW / 7;
  const cellH = grid.rows >= 6 ? 62 : 72;

  const paper = look === "print" ? "#f2e9d4" : "#fbfbf8";
  const ink = look === "print" ? "#2a241c" : "#1b1c20";
  const head =
    look === "print"
      ? "Georgia, 'Times New Roman', serif"
      : look === "band"
        ? BODY
        : DISPLAY;

  // The beats: drop onto the nail and swing 0-40, push in 40-64, the pen circles 56-74, the arrow 74-84,
  // the note is written 84-98: everything is on the page by DRAWN_BY (the note once ran to frame 138 and the
  // pre-check's still read "XBOX 36", 30 Oct 2026).
  const fall = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 120, mass: 0.9 },
  });
  const swing = spring({
    frame: frame - 6,
    fps,
    config: { damping: 6, stiffness: 70, mass: 0.8 },
  });
  const zoom = interpolate(frame, [40, 64], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const circle = interpolate(frame, [56, 74], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const arrow = interpolate(frame, [74, 84], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const write = interpolate(frame, [84, DRAWN_BY - 2], [0, 1], clamp);

  // The circle: round the day's number (top left of its box), or round the month's name.
  const idx = date.day !== undefined ? grid.lead + date.day - 1 : -1;
  const nx = GX + (idx % 7) * cellW + 28;
  const ny = GRID_TOP + Math.floor(idx / 7) * cellH + 26;
  const nameW = monthName.length * (look === "gloss" ? 34 : 40);
  const loop =
    date.day !== undefined
      ? { cx: nx, cy: ny, rx: 34, ry: 28 }
      : { cx: CW / 2, cy: 392, rx: nameW / 2 + 40, ry: 50 };
  // The note sits on the notes line; the arrow runs from the bottom of the loop down to it.
  const noteX = 150;
  const noteSize = handFit(what, CW - noteX - 50, 70, 50, 30);
  const ax = loop.cx + 6;
  const ay = loop.cy + loop.ry + 8;
  const bx = noteX - 18;
  const by = NOTES_TOP + 30;
  const ctrl = `${(ax + bx) / 2 - 60 * side} ${(ay + by) / 2}`;

  // Camera: from the whole calendar (x0.88) to the month's name, its boxes and the notes (x1.3), which then
  // fill the frame from about 145 to 935 px down.
  const scale = 0.88 + 0.42 * zoom;
  const focus = (352 + CH) / 2;
  const lift = -(focus - CH / 2);

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={12}>
      <div
        style={{
          position: "absolute",
          left: 960 - CW / 2,
          top: 540 - CH / 2,
          width: CW,
          height: CH,
          transform: `translateY(${(1 - fall) * -900}px) scale(${scale}) translateY(${lift * zoom}px)`,
        }}
      >
        {/* The nail it hangs from, and the calendar swinging on it. */}
        <div
          style={{
            position: "absolute",
            left: CW / 2 - 9,
            top: 6,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 35% 35%,#d8d8d8,#6a6a6a 70%)",
            boxShadow: "3px 5px 6px rgba(0,0,0,0.5)",
            zIndex: 3,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: `${CW / 2}px 15px`,
            transform: `rotate(${side * 6 * (1 - swing)}deg)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: paper,
              backgroundImage: `${GRAIN}, ${look === "print" ? `${MOTTLE}, ` : ""}${SHEET_LIGHT}`,
              boxShadow:
                "0 30px 60px rgba(0,0,0,0.55), 0 6px 14px rgba(0,0,0,0.35)",
              borderRadius: look === "gloss" ? 6 : 2,
              overflow: "hidden",
              fontFamily: BODY,
              color: ink,
            }}
          >
            {/* The punched hole for the nail. */}
            <div
              style={{
                position: "absolute",
                left: CW / 2 - 12,
                top: 4,
                width: 24,
                height: 22,
                borderRadius: "50%",
                background: "rgba(20,16,12,0.85)",
              }}
            />
            {/* The month's picture: the sentence's game, or the Pulse mark on amber. */}
            <div
              style={{
                position: "absolute",
                left: GX,
                top: 40,
                width: GW,
                height: 250,
                overflow: "hidden",
                background: `linear-gradient(135deg,#ff8a3d,${COLOUR.amber} 50%,#c94d0c)`,
                border: look === "print" ? "6px solid #fffaf0" : "none",
                boxSizing: "border-box",
              }}
            >
              {src ? (
                <Img
                  src={src}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    filter:
                      look === "print"
                        ? "sepia(0.45) saturate(0.75) contrast(0.92)"
                        : look === "band"
                          ? "saturate(0.9)"
                          : "saturate(1.05) contrast(1.04)",
                  }}
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    left: GW / 2 - 100,
                    top: 25,
                    opacity: 0.9,
                  }}
                >
                  <PulseMark size={200} colour="#fff" />
                </div>
              )}
              {look === "gloss" && (
                // The glossy page's sheen.
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(115deg,rgba(255,255,255,0) 40%,rgba(255,255,255,0.22) 50%,rgba(255,255,255,0) 62%)",
                  }}
                />
              )}
            </div>
            {/* The Pulse band: the mark, the name and the year. */}
            <div
              style={{
                position: "absolute",
                left: GX,
                top: 300,
                width: GW,
                height: 42,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "0 14px",
                boxSizing: "border-box",
                background: look === "band" ? COLOUR.amber : "transparent",
                borderBottom: look === "band" ? "none" : `2px solid ${ink}`,
                color: look === "band" ? "#fff" : ink,
                fontWeight: 900,
                fontSize: 22,
                letterSpacing: 6,
              }}
            >
              <PulseMark
                size={28}
                colour={look === "band" ? "#fff" : COLOUR.amber}
              />
              PULSE
              <span style={{ marginLeft: "auto", letterSpacing: 4 }}>
                {date.year}
              </span>
            </div>
            {/* The month's name. */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 352,
                textAlign: "center",
                fontFamily: head,
                fontSize: look === "gloss" ? 72 : 64,
                fontWeight: look === "print" ? 700 : 900,
                fontStyle: look === "print" ? "italic" : "normal",
                letterSpacing: look === "print" ? 1 : 4,
                textTransform: look === "print" ? "none" : "uppercase",
                lineHeight: 1.1,
                color: look === "band" ? COLOUR.amber : ink,
              }}
            >
              {monthName}
            </div>
            {/* The weekdays and the month's boxes, the weekend's numbers in the period's red. */}
            <div
              style={{
                position: "absolute",
                left: GX,
                top: GRID_TOP - 34,
                width: GW,
                display: "flex",
              }}
            >
              {DAYS3.map((d) => (
                <div
                  key={d}
                  style={{
                    width: cellW,
                    textAlign: "center",
                    fontSize: 19,
                    fontWeight: 800,
                    letterSpacing: 2,
                    color: d === "SUN" ? "#b3261e" : "#6b665e",
                  }}
                >
                  {d}
                </div>
              ))}
            </div>
            <svg
              width={CW}
              height={CH}
              style={{ position: "absolute", left: 0, top: 0 }}
            >
              {Array.from({ length: grid.rows + 1 }, (_, r) => (
                <line
                  key={`h${r}`}
                  x1={GX}
                  x2={GX + GW}
                  y1={GRID_TOP + r * cellH}
                  y2={GRID_TOP + r * cellH}
                  stroke="rgba(40,34,26,0.35)"
                  strokeWidth={1.5}
                />
              ))}
              {Array.from({ length: 8 }, (_, c) => (
                <line
                  key={`v${c}`}
                  x1={GX + c * cellW}
                  x2={GX + c * cellW}
                  y1={GRID_TOP}
                  y2={GRID_TOP + grid.rows * cellH}
                  stroke="rgba(40,34,26,0.35)"
                  strokeWidth={1.5}
                />
              ))}
            </svg>
            {Array.from({ length: grid.days }, (_, i) => {
              const k = grid.lead + i;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: GX + (k % 7) * cellW + 10,
                    top: GRID_TOP + Math.floor(k / 7) * cellH + 8,
                    fontFamily: look === "print" ? head : BODY,
                    fontSize: 30,
                    fontWeight: 700,
                    lineHeight: 1,
                    color: k % 7 === 0 ? "#b3261e" : ink,
                  }}
                >
                  {i + 1}
                </div>
              );
            })}
            {/* The notes strip under the month. */}
            <div
              style={{
                position: "absolute",
                left: GX,
                top: NOTES_TOP,
                width: GW,
                height: 64,
                borderBottom: "2px solid rgba(40,34,26,0.4)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 4,
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: 3,
                  color: "#6b665e",
                }}
              >
                NOTES
              </div>
            </div>
            {/* The pen: the loop round the date, the arrow down to the notes, then the note itself. */}
            <svg
              width={CW}
              height={CH}
              style={{ position: "absolute", left: 0, top: 0 }}
            >
              <path
                d={penLoop(loop.cx, loop.cy, loop.rx, loop.ry, seed)}
                fill="none"
                stroke={RED_PEN}
                strokeWidth={5}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={`${circle} 1`}
                opacity={circle > 0 ? 0.92 : 0}
              />
              {what && (
                <>
                  <path
                    d={`M${ax} ${ay} Q${ctrl} ${bx} ${by}`}
                    fill="none"
                    stroke={RED_PEN}
                    strokeWidth={4}
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray={`${arrow} 1`}
                    opacity={arrow > 0 ? 0.92 : 0}
                  />
                  {arrow >= 1 && (
                    <path
                      d={`M${bx - 16} ${by - 10} L${bx} ${by} L${bx - 18} ${by + 8}`}
                      fill="none"
                      stroke={RED_PEN}
                      strokeWidth={4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.92}
                    />
                  )}
                </>
              )}
            </svg>
            {what && (
              <div
                style={{
                  position: "absolute",
                  left: noteX,
                  right: 50,
                  top: NOTES_TOP + 2,
                  height: 70,
                  display: "flex",
                  alignItems: "flex-end",
                  fontFamily: HAND,
                  fontSize: noteSize,
                  lineHeight: 1.05,
                  color: RED_PEN,
                  transform: `rotate(${side * -1.2}deg)`,
                }}
              >
                <Write p={write}>{what}</Write>
              </div>
            )}
          </div>
        </div>
      </div>
      <IllustrationMark opacity={interpolate(frame, [30, 40], [0, 1], clamp)} />
    </Stage>
  );
};
