// Pulse apps, "PulseMaps" (owner, 30 Oct 2026): where a story happens, the way a viewer looks it up now. A
// Pulse OS phone (./handset.tsx) rises, a finger taps Maps, the heading is typed into the search bar and the
// Pulse Maps app flies in to the places: pins drop at their true positions (src/render/places.ts, the World
// map's own list, so a pin is never guessed) and, with two or three places, the great-circle route draws
// between them in story order while a sheet slides up with the stops and the distance, miles first. The base
// map is our own flat style over Natural Earth's land (credited, as on the World map): no map tiles, no streets,
// and no name on it but the places the graphic gives. Light on 2012-19 phones, night mode on edge phones. Only
// from 2012 (the era rule in ./apps.ts); before that a paper road map (./PulseMapsPaper.tsx). ILLUSTRATION.
import React from "react";
import { interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { WORLD } from "../../worldmap.ts";
import { BODY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import { clamp, easeInOut, easeOut, txt } from "../screen/common.ts";
import { PulseMark, phoneLook, storyYear } from "../screen/pulse.tsx";
import {
  HANDSET_H,
  HANDSET_W,
  Handset,
  IllustrationMark,
  screenOf,
} from "./handset.tsx";
import { AppLaunch, openOf } from "./home.tsx";
import {
  distanceLabel,
  fitBox,
  mapStops,
  routeLegs,
  stopPoints,
  toScreen,
  type Fit,
  type MapPt,
} from "./geo.ts";

/**
 * The land under a fit, `w` x `h` px: every country in view (drawn again a turn east or west when the view
 * crosses the date line), the places' countries in `lit` colours, and the borders between countries.
 */
export const Land: React.FC<{
  fit: Fit;
  w: number;
  h: number;
  fillOf: (country: string) => string;
  stroke: string;
  lit: Set<string>;
  litFill: string;
  litStroke: string;
  border: string;
  /** A dashed border, in px, as a printed road map draws them. */
  dash?: number;
}> = ({ fit, w, h, fillOf, stroke, lit, litFill, litStroke, border, dash }) => {
  const x0 = fit.cx - fit.ax / fit.k;
  const y0 = fit.cy - fit.ay / fit.k;
  const vw = w / fit.k;
  const vh = h / fit.k;
  const m = vw * 0.1;
  const offsets = [-360, 0, 360].filter(
    (o) => x0 - m <= 180 + o && x0 + vw + m >= -180 + o,
  );
  return (
    <svg
      width={w}
      height={h}
      viewBox={`${x0} ${y0} ${vw} ${vh}`}
      preserveAspectRatio="none"
      style={{ position: "absolute", left: 0, top: 0 }}
    >
      {offsets.map((o) => (
        <g key={o} transform={`translate(${o} 0)`}>
          {Object.entries(WORLD.countries)
            .filter(([name]) => {
              const b = WORLD.boxes[name];
              return (
                !b ||
                (b[2] + o >= x0 - m &&
                  b[0] + o <= x0 + vw + m &&
                  b[3] >= y0 - m &&
                  b[1] <= y0 + vh + m)
              );
            })
            .map(([name, d]) => (
              <path
                key={name}
                d={d}
                fill={lit.has(name) ? litFill : fillOf(name)}
                stroke={lit.has(name) ? litStroke : stroke}
                strokeWidth={lit.has(name) ? 2 : 1}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            ))}
          <path
            d={WORLD.borders}
            fill="none"
            stroke={border}
            strokeWidth={1.4}
            strokeDasharray={
              dash ? `${dash / fit.k} ${(dash * 0.7) / fit.k}` : undefined
            }
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </svg>
  );
};

/** A fit eased between a far view (`far` times wider) and its own, the camera flying in. */
export function flyFit(f: Fit, t: number, far = 3): Fit {
  return { ...f, k: Math.exp(Math.log(f.k / far) + Math.log(far) * t) };
}

/** The route as an SVG path on screen. */
export const legPath = (f: Fit, leg: MapPt[]) =>
  leg
    .map((p, i) => {
      const s = toScreen(f, p);
      return `${i ? "L" : "M"}${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
    })
    .join("");

/** Which side of its pin a name goes: away from the other pins, and never off the edge. */
export function labelSide(
  pins: Array<{ x: number }>,
  i: number,
  width: number,
  textW: number,
): "left" | "right" {
  const me = pins[i]!.x;
  const others = pins.filter((_, j) => j !== i);
  const mean = others.length
    ? others.reduce((a, p) => a + p.x, 0) / others.length
    : -Infinity;
  let side: "left" | "right" = me >= mean ? "right" : "left";
  if (side === "right" && me + 30 + textW > width - 10) side = "left";
  if (side === "left" && me - 30 - textW < 10) side = "right";
  return side;
}

/**
 * Every place's name beside its pin: the side from labelSide, and a nudge below or above the pin (`dy`, from
 * the pin to the name's middle) when it would cover a name already placed, as two near cities' would.
 */
export function placeLabels(
  pins: Array<{ x: number; y: number }>,
  widths: number[],
  height: number,
  width: number,
  gap: number,
  base = 0,
): Array<{ side: "left" | "right"; dy: number }> {
  const boxes: Array<[number, number, number, number]> = [];
  return pins.map((p, i) => {
    const w = widths[i] ?? 0;
    const side = labelSide(pins, i, width, w);
    const x0 = side === "right" ? p.x + gap : p.x - gap - w;
    const hit = (dy: number) =>
      boxes.some(
        ([a, b, c, d]) =>
          x0 < c &&
          x0 + w > a &&
          p.y + dy - height / 2 < d &&
          p.y + dy + height / 2 > b,
      );
    const dy =
      [base, base + height + 8, base - height - 8].find((d) => !hit(d)) ?? base;
    boxes.push([x0, p.y + dy - height / 2, x0 + w, p.y + dy + height / 2]);
    return { side, dy };
  });
}

export const PulseMaps: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 240);
  const stops = mapStops(g.items);
  if (!visible || !stops) return null;
  const heading = txt(g.primary);
  const { gen, skin, network } = phoneLook(storyYear(g, year), variant);
  const screen = screenOf(gen, skin);
  const droid = skin === "droid";
  const dark = gen === "edge";
  const C = dark
    ? {
        water: "#0d1622",
        land: "#1d2532",
        stroke: "#2b3646",
        border: "#3a4759",
        lit: "#3b2a20",
        card: "#1f2129",
        ink: "#f2f2f5",
        sub: "#9a9daa",
        casing: "#0b0c10",
      }
    : {
        water: "#aacde3",
        land: "#f3efe5",
        stroke: "#d8cfbd",
        border: "#c9bea8",
        lit: "#ffe3cf",
        card: "#ffffff",
        ink: "#15161a",
        sub: "#7b7e88",
        casing: "#ffffff",
      };

  // Where the map is clear of the search bar and the sheet: the places are fitted into that box.
  const many = stops.length > 1;
  const searchTop = screen.status + 14;
  const sheetH = many ? 236 : 176;
  const sheetTop = screen.h - sheetH - (gen === "edge" ? 24 : 0);
  const clear = {
    left: 40,
    top: searchTop + 110,
    w: screen.w - 80,
    h: sheetTop - searchTop - 140,
  };
  const fit = fitBox(stops, clear, 7);
  const dist = distanceLabel(stops);

  // The beats: rise 0-18, tap Maps 24, the app opens 32-48, the heading is typed 46-66, the map flies in
  // 62-90, pins drop from 84, the route draws 98-132, the sheet rises at 112 (96 for one place).
  const tapAt = 24;
  const rise = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.9 },
  });
  const open = openOf(frame, tapAt);
  const typed = Math.floor(
    interpolate(frame, [46, 66], [0, heading.length], clamp),
  );
  const fly = interpolate(frame, [62, 90], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const f = flyFit(fit, fly);
  const legs = routeLegs(stops);
  const draw = interpolate(frame, [98, 132], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const sheet = spring({
    frame: frame - (many ? 112 : 96),
    fps,
    config: { damping: 18, stiffness: 150, mass: 0.7 },
  });
  const zoom = interpolate(frame, [52, 78], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  // The push-in shows the whole screen below the status bar (x1.12 to x1.3 by the phone's height).
  const push = Math.max(1.12, Math.min(1.3, 960 / (screen.h - screen.status)));
  const scale = 1 + (push - 1) * zoom;
  const focus = screen.top + (screen.status + screen.h) / 2;
  const lift = -(focus - HANDSET_H / 2);

  const pins = stopPoints(stops).map((p) => toScreen(f, p));
  // Names are placed once, against where the pins come to rest, so they never swap sides mid-flight.
  const labels = placeLabels(
    stopPoints(stops).map((p) => toScreen(fit, p)),
    stops.map((s) => s.label.length * 15 + 30),
    46,
    screen.w,
    26,
    -24,
  );
  const lit = new Set(stops.map((s) => s.place.country));
  const appInk = open > 0.5;

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={14}>
      <Handset
        gen={gen}
        skin={skin}
        network={network}
        statusInk={appInk ? C.ink : "#fff"}
        barInk={appInk && !dark ? "#222" : "#fff"}
        style={{
          position: "absolute",
          left: 960 - HANDSET_W / 2,
          top: 540 - HANDSET_H / 2 + (1 - rise) * 420,
          transform: `rotate(${(variant % 2 ? 1 : -1) * 2.2 * (1 - open)}deg) scale(${scale}) translateY(${lift * zoom}px)`,
        }}
      >
        <AppLaunch
          screen={screen}
          app="maps"
          frame={frame}
          tapAt={tapAt}
          appBg={C.water}
        >
          {/* Our own flat base map: water, land and borders, the places' countries tinted. */}
          <Land
            fit={f}
            w={screen.w}
            h={screen.h}
            fillOf={() => C.land}
            stroke={C.stroke}
            lit={lit}
            litFill={C.lit}
            litStroke={COLOUR.amber}
            border={C.border}
          />
          {/* The route: the great circle, cased like a road, drawing on from the first place. */}
          <svg
            width={screen.w}
            height={screen.h}
            style={{ position: "absolute", left: 0, top: 0 }}
          >
            {legs.map((leg, i) => {
              const p = interpolate(
                draw,
                [i / legs.length, (i + 1) / legs.length],
                [0, 1],
                clamp,
              );
              if (p <= 0) return null;
              const d = legPath(f, leg);
              return (
                <g key={i}>
                  <path
                    d={d}
                    fill="none"
                    stroke={C.casing}
                    strokeWidth={13}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    strokeDasharray={`${p} 1`}
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={COLOUR.amber}
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    strokeDasharray={`${p} 1`}
                  />
                </g>
              );
            })}
          </svg>
          {/* Pins drop in story order, each with the name the graphic gives it. */}
          {stops.map((s, i) => {
            const at = 84 + i * 10;
            if (frame < at) return null;
            const d = spring({
              frame: frame - at,
              fps,
              config: { damping: 12, stiffness: 220, mass: 0.6 },
            });
            const { x, y } = pins[i]!;
            const { side, dy } = labels[i]!;
            const pulse = ((frame - at) % 40) / 40;
            return (
              <React.Fragment key={s.label}>
                <div
                  style={{
                    position: "absolute",
                    left: x - 40,
                    top: y - 40,
                    width: 80,
                    height: 80,
                    borderRadius: "50%",
                    border: `3px solid ${COLOUR.amber}`,
                    transform: `scale(${0.2 + 0.8 * pulse})`,
                    opacity: (1 - pulse) * 0.6 * d,
                  }}
                />
                <svg
                  width={44}
                  height={58}
                  viewBox="0 0 44 58"
                  style={{
                    position: "absolute",
                    left: x - 22,
                    top: y - 56 - (1 - d) * 120,
                    opacity: Math.min(1, d * 2),
                    filter: "drop-shadow(0 6px 6px rgba(0,0,0,0.35))",
                  }}
                >
                  <path
                    d="M22 2 C10 2 3 11 3 21 C3 36 22 56 22 56 C22 56 41 36 41 21 C41 11 34 2 22 2 Z"
                    fill={COLOUR.amber}
                    stroke="#fff"
                    strokeWidth={3}
                  />
                  <circle cx={22} cy={21} r={7.5} fill="#fff" />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    top: y + dy - 23,
                    ...(side === "right"
                      ? { left: x + 26 }
                      : { right: screen.w - x + 26 }),
                    padding: "6px 14px",
                    borderRadius: droid ? 6 : 18,
                    background: C.card,
                    color: C.ink,
                    fontSize: 26,
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                    boxShadow: "0 6px 16px rgba(0,0,0,0.3)",
                    opacity: interpolate(d, [0.5, 1], [0, 1], clamp),
                  }}
                >
                  {s.label}
                </div>
              </React.Fragment>
            );
          })}
          {/* The search bar: the Pulse mark and the heading as it is typed. */}
          <div
            style={{
              position: "absolute",
              left: 18,
              right: 18,
              top: searchTop,
              minHeight: 66,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "10px 20px",
              borderRadius: droid ? 10 : 33,
              background: C.card,
              color: C.ink,
              fontSize: 26,
              fontWeight: 600,
              lineHeight: 1.2,
              boxShadow: "0 8px 22px rgba(0,0,0,0.28)",
            }}
          >
            <PulseMark size={32} />
            <span>
              {heading.slice(0, typed)}
              {typed < heading.length && frame % 16 < 9 && (
                <span style={{ color: COLOUR.amber }}>|</span>
              )}
            </span>
          </div>
          {/* The sheet: the place, or the stops and the distance as the crow flies. */}
          <div
            style={{
              position: "absolute",
              left: gen === "edge" ? 12 : 0,
              right: gen === "edge" ? 12 : 0,
              top: sheetTop + (1 - sheet) * (sheetH + 60),
              height: sheetH,
              boxSizing: "border-box",
              padding: "16px 26px",
              borderRadius: gen === "edge" ? 34 : "22px 22px 0 0",
              background: C.card,
              color: C.ink,
              boxShadow: "0 -8px 30px rgba(0,0,0,0.3)",
            }}
          >
            <div
              style={{
                width: 56,
                height: 6,
                borderRadius: 3,
                background: C.sub,
                opacity: 0.5,
                margin: "0 auto 14px",
              }}
            />
            {many ? (
              <>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    lineHeight: 1.25,
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    columnGap: 10,
                  }}
                >
                  {stops.map((s, i) => (
                    <React.Fragment key={s.label}>
                      {i > 0 && (
                        <svg width={22} height={18} viewBox="0 0 22 18">
                          <path
                            d="M2 9 H18 M12 3 L18 9 L12 15"
                            fill="none"
                            stroke={COLOUR.amber}
                            strokeWidth={3}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                      <span>{s.label}</span>
                    </React.Fragment>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 38,
                    fontWeight: 800,
                    color: COLOUR.amber,
                    letterSpacing: -0.5,
                  }}
                >
                  {dist}
                </div>
                <div style={{ marginTop: 4, fontSize: 22, color: C.sub }}>
                  As the crow flies
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 36, fontWeight: 800 }}>
                  {stops[0]!.label}
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 16 }}>
                  <div
                    style={{
                      padding: "10px 22px",
                      borderRadius: droid ? 8 : 24,
                      background: COLOUR.amber,
                      color: COLOUR.ink,
                      fontSize: 24,
                      fontWeight: 800,
                    }}
                  >
                    Directions
                  </div>
                  <div
                    style={{
                      padding: "10px 22px",
                      borderRadius: droid ? 8 : 24,
                      border: `2px solid ${C.sub}`,
                      color: C.ink,
                      fontSize: 24,
                      fontWeight: 700,
                    }}
                  >
                    Save
                  </div>
                </div>
              </>
            )}
          </div>
        </AppLaunch>
      </Handset>
      <div
        style={{
          position: "absolute",
          left: 60,
          bottom: 48,
          color: "rgba(255,255,255,0.5)",
          fontSize: 16,
          fontFamily: BODY,
          letterSpacing: 1.5,
          fontWeight: 600,
          opacity: interpolate(
            frame,
            [60, 70, showFor - 12, showFor],
            [0, 1, 1, 0],
            clamp,
          ),
        }}
      >
        MAP DATA: NATURAL EARTH
      </div>
      <IllustrationMark opacity={interpolate(frame, [30, 40], [0, 1], clamp)} />
    </Stage>
  );
};
