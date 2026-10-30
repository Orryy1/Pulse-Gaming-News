// Pulse apps, "PulseMapsPaper" (owner, 30 Oct 2026): where a story happens, before phones had maps. A folded
// Pulse road map opens out panel by panel on the desk, creased where it was folded: pastel countries, dashed
// borders, a printed title box with the Pulse mark and the heading, and no printed place names at all. Then a
// red pen circles each place the graphic gives (at its true position, from src/render/places.ts, so a pin is
// never guessed) and writes its name, a highlighter traces the great-circle route between them in story order,
// and the distance is written beside it, miles first. Land from Natural Earth, credited. Stories to 2011 (the
// era rule in ./apps.ts); from 2012 the phone's Pulse Maps (./PulseMaps.tsx). Tagged ILLUSTRATION.
import React from "react";
import { interpolate, spring } from "remotion";
import { BODY, HAND } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import { GRAIN, RED_PEN, Write, rnd } from "../paper/kit.tsx";
import { clamp, easeOut, txt } from "../screen/common.ts";
import { PulseMark } from "../screen/pulse.tsx";
import { IllustrationMark } from "./handset.tsx";
import { penLoop } from "./PulseCalendarPaper.tsx";
import {
  distanceLabel,
  fitBox,
  mapStops,
  routeLegs,
  stopPoints,
  toScreen,
  type Fit,
} from "./geo.ts";
import { Land, legPath, placeLabels } from "./PulseMaps.tsx";

const MW = 1480;
const MH = 840;
const PANELS = 4;
const PW = MW / PANELS;
const BLUE_PEN = "#1f3d8f";
const PASTELS = ["#f4e6b2", "#efd2cc", "#d8e7c3", "#e2d7ea", "#f2dab0"];

/** A country's printed colour: one of the road map's pastels, always the same for the same country. */
export function pastelOf(country: string): string {
  let h = 0;
  for (const ch of country) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PASTELS[Math.abs(h) % PASTELS.length]!;
}

/** The printed face of the map: sea, land, borders, the title box and a compass. */
const Face: React.FC<{ fit: Fit; heading: string }> = ({ fit, heading }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      top: 0,
      width: MW,
      height: MH,
      background: "#cfe1e4",
    }}
  >
    <Land
      fit={fit}
      w={MW}
      h={MH}
      fillOf={pastelOf}
      stroke="#9db4b8"
      lit={new Set()}
      litFill=""
      litStroke=""
      border="#a2486c"
      dash={9}
    />
    {/* The paper itself over the print. */}
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: GRAIN,
        opacity: 0.55,
      }}
    />
    {/* The title box, printed in the corner. */}
    <div
      style={{
        position: "absolute",
        left: 40,
        top: 36,
        width: 440,
        boxSizing: "border-box",
        padding: "16px 22px 18px",
        background: "#fbf7ea",
        border: "3px double #2b2a28",
        boxShadow: "0 2px 0 rgba(0,0,0,0.12)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 20,
          letterSpacing: 5,
          color: "#2b2a28",
        }}
      >
        <PulseMark size={30} />
        PULSE ROAD MAP
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 700,
          fontSize: heading.length > 26 ? 32 : 38,
          lineHeight: 1.1,
          color: "#1d1b18",
        }}
      >
        {heading}
      </div>
    </div>
    {/* A compass rose, bottom right. */}
    <svg
      width={110}
      height={130}
      viewBox="0 0 110 130"
      style={{ position: "absolute", right: 46, bottom: 34 }}
    >
      <circle
        cx={55}
        cy={75}
        r={40}
        fill="none"
        stroke="#2b2a28"
        strokeWidth={2}
      />
      <path d="M55 30 L65 75 L55 120 L45 75 Z" fill="#2b2a28" />
      <path d="M55 30 L65 75 L55 75 Z" fill="#fbf7ea" />
      <path d="M10 75 L55 68 L100 75 L55 82 Z" fill="#2b2a28" opacity={0.6} />
      <text
        x={55}
        y={20}
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight={700}
        fontSize={22}
        fill="#2b2a28"
      >
        N
      </text>
    </svg>
  </div>
);

export const PulseMapsPaper: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 240);
  const stops = mapStops(g.items);
  if (!visible || !stops) return null;
  const heading = txt(g.primary);
  const seed = 11 + variant * 5;
  const side = variant % 2 ? 1 : -1;
  // The places fill the map clear of the title box and the compass.
  const fit = fitBox(
    stops,
    { left: 90, top: 230, w: MW - 260, h: MH - 300 },
    10,
  );
  const pins = stopPoints(stops).map((p) => toScreen(fit, p));
  const legs = routeLegs(stops);
  const dist = distanceLabel(stops);
  const LABEL = 44;
  const widths = stops.map((s) => s.label.length * LABEL * 0.6 + 20);
  const labels = placeLabels(pins, widths, LABEL + 16, MW, 34);

  // The beats: the map slides in 0-16 and unfolds panel by panel 12-46, the pen circles each place from 54,
  // the highlighter runs the route 90-124 and the distance is written from 124.
  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  });
  const unfold = (i: number) =>
    interpolate(frame, [12 + i * 8, 26 + i * 8], [0, 1], {
      ...clamp,
      easing: easeOut,
    });
  const route = interpolate(frame, [90, 124], [0, 1], clamp);
  const distWrite = interpolate(
    frame,
    [124, 124 + Math.min(30, 10 + (dist?.length ?? 0))],
    [0, 1],
    clamp,
  );
  const push = interpolate(frame, [40, showFor], [1, 1.07], clamp);

  // The distance goes beside the middle of the route, above it, kept on the sheet.
  const mid = (() => {
    const all = legs.flat();
    if (!all.length) return undefined;
    const p = toScreen(fit, all[Math.floor(all.length / 2)]!);
    return {
      x: Math.max(120, Math.min(MW - 520, p.x - 200)),
      y: Math.max(220, Math.min(MH - 120, p.y - 96)),
    };
  })();

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={12}>
      <div
        style={{
          position: "absolute",
          left: 960 - MW / 2,
          top: 540 - MH / 2,
          width: MW,
          height: MH,
          perspective: 2200,
          transform: `translateY(${(1 - enter) * 300}px) rotate(${side * 0.8}deg) scale(${push})`,
          opacity: Math.min(1, enter * 2),
        }}
      >
        {/* The map's shadow on the desk, growing as the panels open (one shadow, so no seam darkens a crease). */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: MH,
            width:
              PW *
              Array.from({ length: PANELS }, (_, i) => unfold(i)).reduce(
                (a, b) => a + b,
                0,
              ),
            boxShadow: "0 30px 60px rgba(0,0,0,0.45)",
          }}
        />
        {/* The panels, each a strip of the same printed face, opening out from the left like an accordion. */}
        {Array.from({ length: PANELS }, (_, i) => {
          const u = unfold(i);
          if (u <= 0) return null;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: i * PW,
                top: 0,
                width: PW,
                height: MH,
                overflow: "hidden",
                transformOrigin: "0 50%",
                transform: `rotateY(${(1 - u) * (i % 2 ? 100 : -100)}deg)`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: -i * PW,
                  top: 0,
                  width: MW,
                  height: MH,
                }}
              >
                <Face fit={fit} heading={heading} />
              </div>
              {/* Crease light: alternate panels catch it, and a panel still turning is in shadow. */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    i % 2
                      ? "linear-gradient(90deg,rgba(0,0,0,0.10),rgba(0,0,0,0) 30%,rgba(255,255,255,0.06))"
                      : "linear-gradient(90deg,rgba(255,255,255,0.10),rgba(0,0,0,0) 70%,rgba(0,0,0,0.08))",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `rgba(0,0,0,${0.45 * (1 - u)})`,
                }}
              />
              {/* The horizontal fold across the middle. */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: MH / 2 - 1,
                  height: 3,
                  background:
                    "linear-gradient(rgba(0,0,0,0.12),rgba(255,255,255,0.18))",
                }}
              />
            </div>
          );
        })}
        {/* The pen and highlighter, on top once the map is open. */}
        <svg
          width={MW}
          height={MH}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          {legs.map((leg, i) => {
            const p = interpolate(
              route,
              [i / legs.length, (i + 1) / legs.length],
              [0, 1],
              clamp,
            );
            if (p <= 0) return null;
            return (
              <path
                key={i}
                d={legPath(fit, leg)}
                fill="none"
                stroke="rgba(255,206,0,0.62)"
                strokeWidth={20}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray={`${p} 1`}
                style={{ mixBlendMode: "multiply" }}
              />
            );
          })}
          {stops.map((s, i) => {
            const c = interpolate(frame, [54 + i * 12, 68 + i * 12], [0, 1], {
              ...clamp,
              easing: easeOut,
            });
            if (c <= 0) return null;
            const { x, y } = pins[i]!;
            return (
              <g key={s.label}>
                <circle cx={x} cy={y} r={6} fill={RED_PEN} />
                <path
                  d={penLoop(x, y, 30, 25, seed + i)}
                  fill="none"
                  stroke={RED_PEN}
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray={`${c} 1`}
                  opacity={0.92}
                />
              </g>
            );
          })}
        </svg>
        {stops.map((s, i) => {
          const w = interpolate(
            frame,
            [62 + i * 12, 62 + i * 12 + Math.min(24, 8 + s.label.length)],
            [0, 1],
            clamp,
          );
          if (w <= 0) return null;
          const { x, y } = pins[i]!;
          const L = labels[i]!;
          return (
            <div
              key={s.label}
              style={{
                position: "absolute",
                top: y + L.dy - (LABEL + 16) / 2,
                ...(L.side === "right"
                  ? { left: x + 34 }
                  : { right: MW - x + 34 }),
                fontFamily: HAND,
                fontSize: LABEL,
                lineHeight: 1.2,
                color: RED_PEN,
                whiteSpace: "nowrap",
                transform: `rotate(${(rnd(seed, i) - 0.5) * 5}deg)`,
              }}
            >
              <Write p={w}>{s.label}</Write>
            </div>
          );
        })}
        {dist && mid && (
          <div
            style={{
              position: "absolute",
              left: mid.x,
              top: mid.y,
              fontFamily: HAND,
              fontSize: 40,
              color: BLUE_PEN,
              whiteSpace: "nowrap",
              transform: `rotate(${side * -2}deg)`,
            }}
          >
            <Write p={distWrite}>{dist}</Write>
          </div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: 60,
          bottom: 40,
          color: "rgba(255,255,255,0.5)",
          fontFamily: BODY,
          fontSize: 16,
          letterSpacing: 1.5,
          fontWeight: 600,
          opacity: interpolate(frame, [30, 40], [0, 1], clamp),
        }}
      >
        MAP DATA: NATURAL EARTH
      </div>
      <IllustrationMark
        bottom={40}
        opacity={interpolate(frame, [30, 40], [0, 1], clamp)}
      />
    </Stage>
  );
};
