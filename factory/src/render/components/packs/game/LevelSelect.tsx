// Game pack: a timeline as a world-map level select. Each row is a level on its own island, the year
// on its button; a dotted path draws between them, a selection marker hops from level to level (each
// lights up and shows its event as it lands) and the last level pulses. The islands are seeded from
// the variant, so no two maps match. items: ["1997: Grand Theft Auto launches", ...].
import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import {
  blobPath,
  bySize,
  clamp,
  clampLines,
  clean,
  easeInOut,
  easeOut,
  seeded,
  wordCount,
  type Pt,
} from "./kit.tsx";

type Level = { when: string; year: string; what: string };

function parseLevels(items: string[]): Level[] {
  return items
    .map(clean)
    .map((x) => {
      const i = x.indexOf(":");
      if (i <= 0) return undefined;
      const when = x.slice(0, i).trim();
      const what = x.slice(i + 1).trim();
      const year = when.match(/\b(1[89]|20)\d\d\b/)?.[0];
      return year && what ? { when, year, what } : undefined;
    })
    .filter((x): x is Level => Boolean(x));
}

export function fitsLevelSelect(g: MomentGraphic): boolean {
  const rows = parseLevels(g.items);
  const heading = clean(g.primary);
  return (
    rows.length >= 2 &&
    rows.length <= 5 &&
    rows.length === g.items.filter((x) => x.trim()).length &&
    rows.every((r) => r.what.length <= 72 && r.when.length <= 18) &&
    heading.length <= 40 &&
    wordCount(heading) <= 6
  );
}

const BX = 96;
const BY = 172;
const BW = 1728;
const BH = 818;
const R = 58; // a level button's radius
const CREAM = "#F1E6CF";

/** A point on a quadratic Bezier. */
const quad = (a: Pt, c: Pt, b: Pt, t: number): Pt => ({
  x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
  y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
});

function mapFor(n: number, variant: number) {
  const r = seeded(variant * 131 + 7);
  const margin = n === 2 ? 470 : n === 3 ? 300 : 215;
  const span = BW - 2 * margin;
  const topFirst = Math.abs(variant) % 2 === 1;
  const nodes: Pt[] = Array.from({ length: n }, (_, i) => ({
    x:
      BX +
      margin +
      (n === 1 ? span / 2 : (i * span) / (n - 1)) +
      (r() - 0.5) * 30,
    y: BY + ((i % 2 === 0) === topFirst ? 0.4 : 0.665) * BH + (r() - 0.5) * 28,
  }));
  // The dotted path between each pair: a gentle curve, its bow seeded.
  const paths = nodes.slice(0, -1).map((a, i) => {
    const b = nodes[i + 1]!;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const bow = (r() > 0.5 ? 1 : -1) * (50 + r() * 50);
    const c = { x: mx + (-dy / d) * bow, y: my + (dx / d) * bow };
    // Dots every 26 px along the curve, clear of both buttons.
    const samples = Array.from({ length: 121 }, (_, k) =>
      quad(a, c, b, k / 120),
    );
    const dots: Pt[] = [];
    let acc = 0;
    let next = 0;
    for (let k = 1; k < samples.length; k++) {
      const p = samples[k]!;
      const q = samples[k - 1]!;
      acc += Math.hypot(p.x - q.x, p.y - q.y);
      if (acc >= next) {
        if (
          Math.hypot(p.x - a.x, p.y - a.y) > R + 18 &&
          Math.hypot(p.x - b.x, p.y - b.y) > R + 18
        )
          dots.push(p);
        next = acc + 26;
      }
    }
    return { a, b, c, dots };
  });
  const islands = nodes.map((p) => {
    const rr = 120 + r() * 40;
    return {
      d: [1.3, 1, 0.66, 0.4].map((k) =>
        blobPath(
          p.x + (r() - 0.5) * 30,
          p.y + 12,
          rr * k,
          seeded(variant * 17 + p.x),
          9,
          0.3,
        ),
      ),
      // Two or three little peaks beside the button, so each island reads as land.
      peaks: Array.from({ length: 2 + Math.floor(r() * 2) }, (_, k) => {
        const side = k % 2 === 0 ? -1 : 1;
        return { x: p.x + side * (R + 28 + r() * 34) + (k > 1 ? side * 26 : 0), y: p.y + 4 + r() * 34, size: 16 + r() * 10 };
      }),
    };
  });
  // Where the labels and the heading will sit, so the compass and the islets keep clear of them.
  type Rect = { x0: number; y0: number; x1: number; y1: number };
  const busy: Rect[] = nodes.map((p) =>
    p.y < BY + BH / 2
      ? { x0: p.x - 260, x1: p.x + 260, y0: p.y - R - 190, y1: p.y + R + 20 }
      : { x0: p.x - 260, x1: p.x + 260, y0: p.y - R - 20, y1: p.y + R + 190 },
  );
  busy.push({ x0: 960 - 340, x1: 960 + 340, y0: BY - 40, y1: BY + 70 });
  const clearOf = (x: number, y: number) =>
    Math.min(...busy.map((b) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1))));
  const corners: Pt[] = [
    { x: BX + BW - 105, y: BY + BH - 105 },
    { x: BX + 105, y: BY + BH - 105 },
    { x: BX + BW - 105, y: BY + 105 },
    { x: BX + 105, y: BY + 105 },
  ];
  const compass = corners.reduce((best, c) => (clearOf(c.x, c.y) > clearOf(best.x, best.y) + 1 ? c : best), corners[0]!);
  // A few small islets away from the levels, labels and compass, for a fuller map.
  const islets: string[] = [];
  for (let k = 0; k < 24 && islets.length < 4; k++) {
    const x = BX + 80 + r() * (BW - 160);
    const y = BY + 90 + r() * (BH - 180);
    const rr = 36 + r() * 40;
    if (nodes.every((p) => Math.hypot(p.x - x, p.y - y) > 250) && clearOf(x, y) > rr + 20 && Math.hypot(compass.x - x, compass.y - y) > 160)
      islets.push(blobPath(x, y, rr, r, 8, 0.4));
  }
  return { nodes, paths, islands, islets, compass };
}

export const LevelSelect: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
}) => {
  const { frame, fps, dim, visible } = useStage(len, 200);
  const levels = parseLevels(g.items).slice(0, 5);
  const heading = clean(g.primary);
  if (!visible || levels.length < 2) return null;
  const n = levels.length;
  const { nodes, paths, islands, islets, compass } = mapFor(n, variant);
  const step = Math.min(20, 72 / (n - 1));
  const land = (i: number) => 16 + i * step;
  const HOP = Math.min(13, step - 3);

  const boardIn = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 140, mass: 0.8 },
  });
  const plateIn = spring({ frame: frame - 6, fps, config: SPRING.ENTER });
  const headSize = bySize(heading, [
    [16, 56],
    [26, 48],
    [99, 42],
  ]);

  // Where the marker is at a frame: dropping onto the first level, then hopping along the path.
  type Marker = { p: Pt; ground: Pt; air: number; landedAt: number; index: number };
  const markerAt = (f: number): Marker => {
    if (f < land(0)) {
      const t = interpolate(f, [land(0) - 10, land(0)], [0, 1], clamp);
      return { p: { x: nodes[0]!.x, y: nodes[0]!.y - 220 * (1 - t * t) }, ground: nodes[0]!, air: 1 - t * t, landedAt: land(0), index: -1 };
    }
    let m: Marker = { p: nodes[0]!, ground: nodes[0]!, air: 0, landedAt: land(0), index: 0 };
    for (let i = 1; i < n; i++) {
      const start = land(i) - HOP;
      if (f >= start && f < land(i)) {
        const t = easeInOut(interpolate(f, [start, land(i)], [0, 1], clamp));
        const path = paths[i - 1]!;
        const q = quad(path.a, path.c, path.b, t);
        m = { p: { x: q.x, y: q.y - Math.sin(Math.PI * t) * 120 }, ground: q, air: Math.sin(Math.PI * t), landedAt: land(i), index: -1 };
      } else if (f >= land(i)) m = { p: nodes[i]!, ground: nodes[i]!, air: 0, landedAt: land(i), index: i };
    }
    return m;
  };
  const marker = markerAt(frame);
  const markerIn = interpolate(frame, [land(0) - 10, land(0) - 6], [0, 1], clamp);
  const flying = marker.index < 0;
  const settle = spring({
    frame: frame - marker.landedAt,
    fps,
    config: { damping: 9, stiffness: 200, mass: 0.6 },
  });
  const visited = (i: number) => frame >= land(i);
  const lastAt = land(n - 1);

  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <AbsoluteFill
        style={{
          opacity: boardIn,
          transform: `scale(${0.94 + 0.06 * boardIn})`,
        }}
      >
        {/* The map. */}
        <svg
          width={1920}
          height={1080}
          viewBox="0 0 1920 1080"
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <clipPath id="lsBoard">
              <rect x={BX} y={BY} width={BW} height={BH} rx={26} />
            </clipPath>
            <radialGradient id="lsSea" cx="0.5" cy="0.45" r="0.75">
              <stop offset="0" stopColor="#1A3442" />
              <stop offset="0.6" stopColor="#11232F" />
              <stop offset="1" stopColor="#0A141B" />
            </radialGradient>
            <pattern
              id="lsWaves"
              width="46"
              height="26"
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${(frame * 0.6) % 46} 0)`}
            >
              <path
                d="M2 14 Q 8 9 14 14 T 26 14"
                fill="none"
                stroke="rgba(170,215,230,0.07)"
                strokeWidth={2}
              />
            </pattern>
            <radialGradient id="lsShade">
              <stop offset="0" stopColor="#000" stopOpacity={0.5} />
              <stop offset="1" stopColor="#000" stopOpacity={0} />
            </radialGradient>
            <radialGradient id="lsVignette" cx="0.5" cy="0.5" r="0.72">
              <stop offset="0.6" stopColor="#000" stopOpacity={0} />
              <stop offset="1" stopColor="#000" stopOpacity={0.55} />
            </radialGradient>
            <linearGradient id="lsLit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFA060" />
              <stop offset="0.6" stopColor={COLOUR.amber} />
              <stop offset="1" stopColor="#D9500A" />
            </linearGradient>
          </defs>
          <g clipPath="url(#lsBoard)">
            <rect x={BX} y={BY} width={BW} height={BH} fill="url(#lsSea)" />
            <rect x={BX} y={BY} width={BW} height={BH} fill="url(#lsWaves)" />
            {/* Latitude and longitude. */}
            {Array.from({ length: 15 }, (_, k) => (
              <line
                key={`v${k}`}
                x1={BX + (k + 1) * 108}
                y1={BY}
                x2={BX + (k + 1) * 108}
                y2={BY + BH}
                stroke="rgba(241,230,207,0.05)"
                strokeWidth={1.5}
              />
            ))}
            {Array.from({ length: 7 }, (_, k) => (
              <line
                key={`h${k}`}
                x1={BX}
                y1={BY + (k + 1) * 108}
                x2={BX + BW}
                y2={BY + (k + 1) * 108}
                stroke="rgba(241,230,207,0.05)"
                strokeWidth={1.5}
              />
            ))}
            {islets.map((d, k) => (
              <g key={`i${k}`}>
                <path
                  d={d}
                  fill="#203029"
                  stroke="rgba(214,196,150,0.3)"
                  strokeWidth={2.5}
                />
              </g>
            ))}
            {islands.map((isl, k) => (
              <g key={`l${k}`}>
                <path d={isl.d[0]} fill="rgba(110,190,205,0.09)" />
                <path
                  d={isl.d[1]}
                  fill="#23322B"
                  stroke="rgba(214,196,150,0.38)"
                  strokeWidth={3}
                />
                <path d={isl.d[2]} fill="#2B3E33" />
                <path d={isl.d[3]} fill="#34493B" />
                {isl.peaks.map((pk, j) => (
                  <g key={j} transform={`translate(${pk.x} ${pk.y})`}>
                    <path d={`M${-pk.size} ${pk.size * 0.55} L0 ${-pk.size * 0.75} L${pk.size} ${pk.size * 0.55} Z`} fill="#46604B" />
                    <path d={`M0 ${-pk.size * 0.75} L${pk.size} ${pk.size * 0.55} L${pk.size * 0.25} ${pk.size * 0.55} Z`} fill="#2A3B30" />
                    <path d={`M${-pk.size * 0.3} ${-pk.size * 0.3} L0 ${-pk.size * 0.75} L${pk.size * 0.3} ${-pk.size * 0.3} Z`} fill={CREAM} fillOpacity={0.5} />
                  </g>
                ))}
              </g>
            ))}
            {/* Slow cloud shadows drifting over the map. */}
            {[0, 1].map((k) => (
              <ellipse
                key={`c${k}`}
                cx={
                  BX +
                  ((frame * (0.9 + k * 0.5) + k * 900 + variant * 211) %
                    (BW + 600)) -
                  300
                }
                cy={BY + 200 + k * 380}
                rx={300}
                ry={120}
                fill="url(#lsShade)"
                opacity={0.35}
              />
            ))}
            <rect
              x={BX}
              y={BY}
              width={BW}
              height={BH}
              fill="url(#lsVignette)"
            />
          </g>
          {/* The board's frame: an outer rule, an inner dashed rule and rivets at the corners. */}
          <rect
            x={BX}
            y={BY}
            width={BW}
            height={BH}
            rx={26}
            fill="none"
            stroke="rgba(241,230,207,0.45)"
            strokeWidth={3}
          />
          <rect
            x={BX + 14}
            y={BY + 14}
            width={BW - 28}
            height={BH - 28}
            rx={16}
            fill="none"
            stroke="rgba(241,230,207,0.16)"
            strokeWidth={1.5}
            strokeDasharray="10 8"
          />
          {[
            [BX + 30, BY + 30],
            [BX + BW - 30, BY + 30],
            [BX + 30, BY + BH - 30],
            [BX + BW - 30, BY + BH - 30],
          ].map(([x, y], k) => (
            <circle
              key={`r${k}`}
              cx={x}
              cy={y}
              r={5}
              fill="rgba(241,230,207,0.5)"
            />
          ))}
          {/* A compass star in the corner (decoration, no letters). */}
          <g
            transform={`translate(${compass.x} ${compass.y}) rotate(${Math.sin(frame / 50) * 4}) scale(0.85)`}
            opacity={0.5}
          >
            <circle
              r={52}
              fill="none"
              stroke={CREAM}
              strokeOpacity={0.4}
              strokeWidth={2}
            />
            <path
              d="M0 -62 L9 -9 L62 0 L9 9 L0 62 L-9 9 L-62 0 L-9 -9 Z"
              fill={CREAM}
              fillOpacity={0.55}
            />
            <path
              d="M0 -62 L9 -9 L0 0 Z M62 0 L9 9 L0 0 Z M0 62 L-9 9 L0 0 Z M-62 0 L-9 -9 L0 0 Z"
              fill="#0A141B"
              fillOpacity={0.45}
            />
            <circle r={6} fill={COLOUR.amber} />
          </g>

          {/* The dotted path, each stretch drawing just ahead of the hop along it. */}
          {paths.map((p, i) =>
            p.dots.map((d, k) => {
              const start = land(i + 1) - HOP - 6;
              const at = start + (10 * k) / Math.max(1, p.dots.length);
              const s = interpolate(frame, [at, at + 5], [0, 1], {
                ...clamp,
                easing: easeOut,
              });
              if (s <= 0) return null;
              const passed = frame >= land(i + 1);
              return (
                <circle
                  key={`d${i}_${k}`}
                  cx={d.x}
                  cy={d.y}
                  r={5.5 * s}
                  fill={passed ? COLOUR.amber : CREAM}
                  stroke="rgba(10,20,27,0.7)"
                  strokeWidth={2}
                />
              );
            }),
          )}

          {/* The level buttons. */}
          {nodes.map((p, i) => {
            const on = visited(i);
            const lit = interpolate(
              frame,
              [land(i), land(i) + 5],
              [0, 1],
              clamp,
            );
            const flash = interpolate(frame, [land(i), land(i) + 16], [0, 1], {
              ...clamp,
              easing: easeOut,
            });
            const appear = spring({
              frame: frame - 4 - i * 3,
              fps,
              config: SPRING.POP,
            });
            const last = i === n - 1;
            return (
              <g
                key={`n${i}`}
                transform={`translate(${p.x} ${p.y}) scale(${appear})`}
              >
                <ellipse
                  cx={0}
                  cy={R - 6}
                  rx={R * 1.15}
                  ry={18}
                  fill="#000"
                  opacity={0.35}
                />
                {last && on
                  ? [0, 1].map((k) => {
                      const t = ((frame - lastAt + k * 18) % 36) / 36;
                      return frame - lastAt + k * 18 >= 0 ? (
                        <circle
                          key={k}
                          r={R + 8 + 70 * t}
                          fill="none"
                          stroke={COLOUR.amber}
                          strokeWidth={3 * (1 - t) + 0.5}
                          opacity={(1 - t) * 0.75}
                        />
                      ) : null;
                    })
                  : null}
                {on && flash < 1 ? (
                  <circle
                    r={R + 10 + 50 * flash}
                    fill="none"
                    stroke="#FFE2C4"
                    strokeWidth={6 * (1 - flash)}
                    opacity={1 - flash}
                  />
                ) : null}
                <circle r={R + 7} fill="#0C1218" opacity={0.85} />
                <circle
                  r={R}
                  fill="#18222B"
                  stroke={CREAM}
                  strokeOpacity={0.55}
                  strokeWidth={4}
                />
                <circle
                  r={R}
                  fill="url(#lsLit)"
                  opacity={lit}
                  stroke="#FFD3A8"
                  strokeWidth={4}
                />
                <circle
                  r={R - 11}
                  fill="none"
                  stroke={on ? "rgba(11,11,14,0.35)" : "rgba(241,230,207,0.18)"}
                  strokeWidth={2}
                />
                <text
                  x={0}
                  y={14}
                  textAnchor="middle"
                  fontFamily={DISPLAY}
                  fontSize={levels[i]!.year.length > 4 ? 30 : 40}
                  letterSpacing={1}
                  fill={on ? COLOUR.ink : CREAM}
                  opacity={on ? 1 : 0.75}
                >
                  {levels[i]!.year}
                </text>
              </g>
            );
          })}

          {/* The marker: four chevrons that close around the current level. They shrink and spin while
              hopping (a short ghost trail behind), then land and spring open around the button. */}
          {(() => {
            const brackets = (m: Marker, scale: number, spin: number, opacity: number, key: string) => (
              <g key={key} opacity={opacity} transform={`translate(${m.p.x} ${m.p.y}) rotate(${spin}) scale(${scale})`}>
                {[0, 90, 180, 270].map((a) => (
                  <path
                    key={a}
                    d={`M-22 ${-(R + 26)} L0 ${-(R + 12)} L22 ${-(R + 26)}`}
                    transform={`rotate(${a})`}
                    fill="none"
                    stroke={COLOUR.amber}
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </g>
            );
            if (!flying) return brackets(marker, 0.62 + 0.38 * settle, frame * 1.5, 1, "m");
            const trail = [markerAt(frame - 2), markerAt(frame - 4)];
            return (
              <g opacity={markerIn}>
                <ellipse
                  cx={marker.ground.x}
                  cy={marker.ground.y + 10}
                  rx={40 * (1 - 0.5 * marker.air)}
                  ry={11 * (1 - 0.5 * marker.air)}
                  fill="#000"
                  opacity={0.35 * (1 - marker.air * 0.6)}
                />
                {trail.map((m, k) => (m.index < 0 ? brackets(m, 0.62, (frame - 2 * (k + 1)) * 14, 0.28 - 0.12 * k, `t${k}`) : null))}
                <circle cx={marker.p.x} cy={marker.p.y} r={16} fill="#FFE8D0" opacity={marker.air} />
                <circle cx={marker.p.x} cy={marker.p.y} r={34} fill={COLOUR.amber} opacity={0.25 * marker.air} />
                {brackets(marker, 0.62, frame * 14, 1, "m")}
              </g>
            );
          })()}
        </svg>

        {/* The heading on a plate across the top edge of the map. */}
        {heading ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: BY - 38,
              display: "flex",
              justifyContent: "center",
              opacity: plateIn,
              transform: `translateY(${(1 - plateIn) * -24}px)`,
            }}
          >
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 56,
                  marginRight: -2,
                  background: "#A8440C",
                  clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%, 40% 50%)",
                  transform: "translateY(12px)",
                }}
              />
              <div
                style={{
                  padding: "8px 44px 6px",
                  background: "linear-gradient(180deg, #1F1E25, #121116)",
                  border: `3px solid ${COLOUR.amber}`,
                  borderRadius: 10,
                  fontFamily: DISPLAY,
                  fontSize: headSize,
                  lineHeight: `${headSize + 6}px`,
                  letterSpacing: 3,
                  color: COLOUR.paper,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {heading}
              </div>
              <div
                style={{
                  width: 34,
                  height: 56,
                  marginLeft: -2,
                  background: "#A8440C",
                  clipPath: "polygon(0 0, 100% 0, 60% 50%, 100% 100%, 0 100%)",
                  transform: "translateY(12px)",
                }}
              />
            </div>
          </div>
        ) : null}

        {/* Each level's event, shown as the marker lands on it. */}
        {levels.map((lv, i) => {
          const p = nodes[i]!;
          const above = p.y < BY + BH / 2;
          const s = spring({
            frame: frame - land(i) - 2,
            fps,
            config: SPRING.ENTER,
          });
          if (s <= 0.001) return null;
          const spacing =
            n > 1 ? (nodes[n - 1]!.x - nodes[0]!.x) / (n - 1) : BW;
          const width = Math.min(500, Math.max(300, 2 * spacing - 60));
          const left = Math.max(
            BX + 26,
            Math.min(BX + BW - 26 - width, p.x - width / 2),
          );
          const size = lv.what.length > 48 ? 30 : 32;
          const kicker = lv.when !== lv.year ? lv.when : "";
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left,
                width,
                ...(above
                  ? { bottom: 1080 - (p.y - R - 34) }
                  : { top: p.y + R + 34 }),
                display: "flex",
                justifyContent:
                  p.x - width / 2 < left - 1
                    ? "flex-start"
                    : p.x + width / 2 > left + width + 1
                      ? "flex-end"
                      : "center",
                opacity: s,
                transform: `translateY(${(1 - s) * (above ? 18 : -18)}px) scale(${0.9 + 0.1 * s})`,
                transformOrigin: above ? "50% 100%" : "50% 0%",
              }}
            >
              <div
                style={{
                  position: "relative",
                  padding: "12px 22px 14px",
                  background: "rgba(10,13,17,0.92)",
                  border: "2px solid rgba(241,230,207,0.28)",
                  borderTop: above
                    ? "2px solid rgba(241,230,207,0.28)"
                    : `4px solid ${COLOUR.amber}`,
                  borderBottom: above
                    ? `4px solid ${COLOUR.amber}`
                    : "2px solid rgba(241,230,207,0.28)",
                  borderRadius: 10,
                  textAlign: "center",
                  boxShadow: "0 14px 34px rgba(0,0,0,0.5)",
                }}
              >
                {kicker ? (
                  <div
                    style={{
                      fontFamily: BODY,
                      fontWeight: 900,
                      fontSize: 22,
                      letterSpacing: 3,
                      color: COLOUR.amber,
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    {kicker}
                  </div>
                ) : null}
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 800,
                    fontSize: size,
                    lineHeight: 1.16,
                    color: COLOUR.paper,
                    ...clampLines(3),
                  }}
                >
                  {lv.what}
                </div>
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </Stage>
  );
};
