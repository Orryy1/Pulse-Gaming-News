// The animated map, the way Johnny Harris and the big documentary channels use them: the world, the camera
// diving in to where the story happens, the country lighting up, pins dropping with their names and, for
// two or three places, a route drawing between them. Places come from src/render/places.ts (a pin is
// never guessed); the land is Natural Earth's (src/render/components/worldmap.ts).

import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { WORLD } from "./worldmap.ts";
import { placeFor, type Place } from "../places.ts";
import { useStage } from "./DocGraphics.tsx";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { displayText } from "../timeline.ts";
import type { GfxProps } from "./packs/types.ts";

const W = 1920;
const H = 1080;
const ASPECT = H / W;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ZOOM_FROM = 6;
const ZOOM_TO = 54;

/** Web Mercator in the map's units (degrees; north is negative, as on screen). */
const mercY = (lat: number) => {
  const l = Math.max(-60, Math.min(84, lat));
  return (
    -(180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360))
  );
};

interface View {
  cx: number;
  cy: number;
  w: number;
}

/** The places a map graphic names that the list knows, at most three, each once. */
export function mapPlaces(items: string[]): Place[] {
  const out: Place[] = [];
  for (const it of items) {
    const p = placeFor(it.split(":")[0]!.trim());
    if (p && !out.includes(p)) out.push(p);
  }
  return out.slice(0, 3);
}

/** Where the camera ends up: the places with room around them, never closer than a region. */
function target(places: Place[]): View {
  const xs = places.map((p) => p.lon);
  const ys = places.map((p) => mercY(p.lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let w: number;
  if (places.length === 1) {
    const p = places[0]!;
    const box = WORLD.boxes[p.country];
    w =
      p.kind === "country" && box
        ? Math.max(14, Math.min(70, (box[2] - box[0]) * 1.5))
        : p.kind === "region"
          ? 22
          : 13;
  } else w = Math.max(14, (maxX - minX) * 1.7, ((maxY - minY) * 1.9) / ASPECT);
  w = Math.min(w, 320);
  // The heading sits top left: the map's middle drops a little so a pin never lands under it.
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2 - w * ASPECT * 0.05,
    w,
  };
}

const ease = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export const MapMoment: React.FC<GfxProps> = ({ g, len }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 210);
  const places = useMemo(() => mapPlaces(g.items), [g.items]);
  const end = useMemo(
    () => (places.length ? target(places) : undefined),
    [places],
  );
  if (!visible || !end) return null;
  // The camera: from the whole world, centred over the story, diving in (zoom eased in log space).
  const startW = 330;
  const start: View = {
    cx: end.cx,
    cy: Math.max(
      -170 + (startW * ASPECT) / 2,
      Math.min(80 - (startW * ASPECT) / 2, end.cy),
    ),
    w: startW,
  };
  const t = ease(interpolate(frame, [ZOOM_FROM, ZOOM_TO], [0, 1], clamp));
  const drift = interpolate(frame, [ZOOM_TO, showFor], [1, 0.95], clamp);
  const w =
    Math.exp(Math.log(start.w) + (Math.log(end.w) - Math.log(start.w)) * t) *
    drift;
  const k = start.w === end.w ? t : (start.w - w / drift) / (start.w - end.w);
  const view: View = {
    cx: start.cx + (end.cx - start.cx) * k,
    cy: start.cy + (end.cy - start.cy) * k,
    w,
  };
  const h = view.w * ASPECT;
  const x0 = view.cx - view.w / 2;
  const y0 = view.cy - h / 2;
  const toScreen = (p: Place) => ({
    x: ((p.lon - x0) * W) / view.w,
    y: ((mercY(p.lat) - y0) * H) / h,
  });
  const lit = new Set(places.map((p) => p.country));
  // A country named outright fills in; a city's country only glows, so a vast one never swamps the map.
  const countryPin = places.some((p) => p.kind === "country");
  const litOn = interpolate(frame, [ZOOM_TO - 14, ZOOM_TO + 10], [0, 1], clamp);
  const margin = view.w * 0.1;
  const shown = Object.entries(WORLD.countries).filter(([name]) => {
    const b = WORLD.boxes[name];
    return (
      !b ||
      (b[2] >= x0 - margin &&
        b[0] <= x0 + view.w + margin &&
        b[3] >= y0 - margin &&
        b[1] <= y0 + h + margin)
    );
  });
  // The graticule: every 15 degrees, or 5 once the camera is in close.
  const step = view.w > 90 ? 15 : 5;
  const grid: string[] = [];
  for (let lon = Math.ceil(x0 / step) * step; lon <= x0 + view.w; lon += step)
    grid.push(`M${lon} ${y0}V${y0 + h}`);
  for (let lat = -60; lat <= 84; lat += step) {
    const y = mercY(lat);
    if (y >= y0 && y <= y0 + h) grid.push(`M${x0} ${y}H${x0 + view.w}`);
  }
  const pins = places.map(toScreen);
  const heading = displayText(g.primary);
  return (
    <AbsoluteFill style={{ opacity: dim, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 90% at 50% 45%, #0f1a2b 0%, #0a121f 55%, #060a12 100%)",
        }}
      />
      <svg
        width={W}
        height={H}
        viewBox={`${x0} ${y0} ${view.w} ${h}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0 }}
      >
        <path
          d={grid.join("")}
          stroke="rgba(160,190,230,0.07)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          fill="none"
        />
        {shown.map(([name, d]) => (
          <path
            key={name}
            d={d}
            fill={
              lit.has(name)
                ? `rgba(255,107,26,${(countryPin ? 0.06 : 0.03) + (countryPin ? 0.2 : 0.09) * litOn})`
                : "#1a2433"
            }
            stroke={
              lit.has(name)
                ? `rgba(255,140,70,${0.35 + 0.55 * litOn})`
                : "#34445b"
            }
            strokeWidth={lit.has(name) ? 1.8 : 1.1}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        ))}
        <path
          d={WORLD.borders}
          fill="none"
          stroke="rgba(120,145,180,0.28)"
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The route between the places: a dashed arc drawing on, a light travelling at its head. */}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          {pins.slice(1).map((b, i) => {
            const a = pins[i]!;
            const p = interpolate(
              frame,
              [ZOOM_TO + 18 + i * 22, ZOOM_TO + 48 + i * 22],
              [0, 1],
              {
                ...clamp,
                easing: (x) => 1 - (1 - x) ** 2,
              },
            );
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2 - d * 0.25;
            return (
              <mask id={`route${i}`} key={i}>
                <path
                  d={`M${a.x} ${a.y}Q${cx} ${cy} ${b.x} ${b.y}`}
                  stroke="#fff"
                  strokeWidth={10}
                  fill="none"
                  pathLength={1}
                  strokeDasharray={`${p} 1`}
                />
              </mask>
            );
          })}
        </defs>
        {pins.slice(1).map((b, i) => {
          const a = pins[i]!;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          const cx = (a.x + b.x) / 2;
          const cy = (a.y + b.y) / 2 - d * 0.25;
          const p = interpolate(
            frame,
            [ZOOM_TO + 18 + i * 22, ZOOM_TO + 48 + i * 22],
            [0, 1],
            {
              ...clamp,
              easing: (x) => 1 - (1 - x) ** 2,
            },
          );
          const hx = (1 - p) ** 2 * a.x + 2 * (1 - p) * p * cx + p * p * b.x;
          const hy = (1 - p) ** 2 * a.y + 2 * (1 - p) * p * cy + p * p * b.y;
          return (
            <g key={i}>
              <path
                d={`M${a.x} ${a.y}Q${cx} ${cy} ${b.x} ${b.y}`}
                stroke={COLOUR.paper}
                strokeOpacity={0.9}
                strokeWidth={3.5}
                strokeDasharray="14 12"
                strokeLinecap="round"
                fill="none"
                mask={`url(#route${i})`}
              />
              {p > 0 && p < 1 ? (
                <circle
                  cx={hx}
                  cy={hy}
                  r={9}
                  fill="#fff"
                  style={{
                    filter: "drop-shadow(0 0 10px rgba(255,170,110,0.95))",
                  }}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      {/* Pins drop in turn, each with a pulse and its name. */}
      {places.map((pl, i) => {
        const at = ZOOM_TO - 8 + i * 12;
        const s = spring({ frame: frame - at, fps, config: SPRING.POP });
        if (frame < at) return null;
        const { x, y } = pins[i]!;
        const pulse = ((frame - at) % 45) / 45;
        // Names go to the side with room: the right unless the pin is near the right edge or left of another.
        const right =
          x < 1380 && !(pins.length > 1 && i === 0 && pins[1]!.x < x);
        const label = spring({
          frame: frame - at - 6,
          fps,
          config: SPRING.ENTER,
        });
        return (
          <React.Fragment key={pl.name}>
            <div
              style={{
                position: "absolute",
                left: x - 60,
                top: y - 60,
                width: 120,
                height: 120,
                borderRadius: 60,
                border: `3px solid ${COLOUR.amber}`,
                transform: `scale(${0.2 + pulse * 0.8})`,
                opacity: (1 - pulse) * 0.7 * s,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: x - 13,
                top: y - 13 - (1 - s) * 50,
                width: 26,
                height: 26,
                borderRadius: 13,
                background: COLOUR.amber,
                border: "4px solid #fff",
                boxShadow:
                  "0 6px 18px rgba(0,0,0,0.6), 0 0 24px rgba(255,107,26,0.8)",
                opacity: Math.min(1, s * 2),
              }}
            />
            <div
              style={{
                position: "absolute",
                top: y - 30,
                ...(right ? { left: x + 30 } : { right: W - x + 30 }),
                padding: "10px 20px 10px 18px",
                background: "rgba(8,12,20,0.82)",
                borderLeft: right ? `6px solid ${COLOUR.amber}` : undefined,
                borderRight: right ? undefined : `6px solid ${COLOUR.amber}`,
                borderRadius: 6,
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 32,
                letterSpacing: 2,
                color: COLOUR.paper,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
                opacity: label,
                transform: `translateX(${(1 - label) * (right ? -24 : 24)}px)`,
              }}
            >
              {pl.name}
            </div>
          </React.Fragment>
        );
      })}
      {heading ? (
        <div
          style={{
            position: "absolute",
            left: 96,
            top: 140,
            maxWidth: 900,
            opacity: interpolate(frame, [10, 24], [0, 1], clamp),
            transform: `translateY(${interpolate(frame, [10, 24], [16, 0], clamp)}px)`,
          }}
        >
          <div
            style={{
              width: 90,
              height: 7,
              background: COLOUR.amber,
              marginBottom: 18,
            }}
          />
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: heading.length > 28 ? 60 : 76,
              lineHeight: 1.02,
              color: COLOUR.paper,
              textTransform: "uppercase",
              textShadow: "0 8px 30px rgba(0,0,0,0.8)",
            }}
          >
            {heading}
          </div>
          {g.secondary ? (
            <div
              style={{
                marginTop: 12,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 28,
                letterSpacing: 1,
                color: "rgba(245,245,242,0.75)",
              }}
            >
              {displayText(g.secondary)}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          right: 40,
          bottom: 24,
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: 15,
          letterSpacing: 1.5,
          color: "rgba(245,245,242,0.45)",
        }}
      >
        MAP DATA: NATURAL EARTH
      </div>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(90% 80% at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
