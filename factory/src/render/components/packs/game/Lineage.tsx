// Game pack: a lineage as a tech tree. On a framed, dotted canvas, node cards appear in order, each with
// a medallion on its top edge; connectors draw on between them with a pulse of light riding the head,
// each medallion lights as the line reaches it, and the last node lights amber. Left to right on one
// row, or wrapping to a second row (with an elbow connector) when the names are long. While it holds,
// a pulse keeps running down the chain. items: ["DMA Design: 1987", "Rockstar North: 2002"] (the year
// optional).
import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import {
  bySize,
  clamp,
  clampLines,
  clean,
  easeInOut,
  easeOut,
  linesNeeded,
  longestWord,
  pointAt,
  polyLength,
  svgPath,
  wordCount,
  type Pt,
} from "./kit.tsx";

type Node = { name: string; year: string };

/** "Name: year" (the year any short tail with a digit in it), else the whole row is the name. */
function parseNodes(items: string[]): Node[] {
  return items
    .map(clean)
    .filter(Boolean)
    .map((x) => {
      const i = x.lastIndexOf(":");
      if (i > 0) {
        const name = x.slice(0, i).trim();
        const year = x.slice(i + 1).trim();
        if (name && year && year.length <= 14 && /\d/.test(year))
          return { name, year };
      }
      return { name: x, year: "" };
    });
}

export function fitsLineage(g: MomentGraphic): boolean {
  const nodes = parseNodes(g.items);
  const heading = clean(g.primary);
  return (
    nodes.length >= 2 &&
    nodes.length <= 5 &&
    nodes.length === g.items.filter((x) => x.trim()).length &&
    nodes.every((x) => x.name.length <= 40 && longestWord(x.name) <= 18) &&
    heading.length <= 44 &&
    wordCount(heading) <= 7
  );
}

type Box = { x: number; y: number; w: number; h: number };
type Layout = {
  boxes: Box[];
  links: Pt[][];
  nameSize: number;
  yearSize: number;
  lines: number;
  headTop: number;
  bottom: number;
};

const PADX = 22;
const EM = 0.6;
const MEDAL = 64; // the medallion's diameter; half of it sits above the card
const PAD_TOP = 42; // card padding under the medallion
const PAD_BOTTOM = 26;

/** Card widths, gaps and the type ladder for a single row of n nodes. */
const ROW: Record<
  number,
  { w: number; gap: number; names: number[]; year: number }
> = {
  2: { w: 480, gap: 300, names: [52, 46, 40, 36], year: 54 },
  3: { w: 440, gap: 160, names: [44, 40, 36, 32], year: 48 },
  4: { w: 330, gap: 120, names: [36, 33, 30], year: 44 },
  5: { w: 272, gap: 85, names: [34, 32, 30], year: 40 },
};

function layoutFor(nodes: Node[], hasHeading: boolean): Layout {
  const n = nodes.length;
  const anyYear = nodes.some((x) => x.year);
  const fit = (w: number, sizes: number[], maxLines: number) =>
    sizes.find((z) =>
      nodes.every((x) => linesNeeded(x.name, w - 2 * PADX, z, EM) <= maxLines),
    );
  const spec = ROW[n] ?? ROW[5]!;
  let rows: number[][] = [[...nodes.keys()]];
  let w = spec.w;
  let gap = spec.gap;
  let year = spec.year;
  let size = fit(w, spec.names, 2);
  let maxLines = 2;
  if (!size && n <= 3) {
    size = fit(w, spec.names, 3) ?? spec.names[spec.names.length - 1]!;
    maxLines = 3;
  } else if (!size) {
    // Too long for one row: wrap to two rows of wider cards.
    const k = Math.ceil(n / 2);
    rows = [
      Array.from({ length: k }, (_, i) => i),
      Array.from({ length: n - k }, (_, i) => k + i),
    ];
    w = 440;
    gap = 160;
    year = 44;
    const names = [40, 36, 33, 30];
    size = fit(w, names, 2);
    if (!size) {
      size = fit(w, names, 3) ?? 30;
      maxLines = 3;
    }
  }
  const nameSize = size!;
  const lineH = Math.round(nameSize * 1.12);
  const lines = Math.max(
    ...nodes.map((x) =>
      Math.min(maxLines, linesNeeded(x.name, w - 2 * PADX, nameSize, EM)),
    ),
  );
  const h = PAD_TOP + (anyYear ? year + 6 : 0) + lines * lineH + PAD_BOTTOM;
  const rowGap = 140;
  const headH = hasHeading ? 176 : 40;
  const blockH = rows.length * h + (rows.length - 1) * rowGap;
  const top = Math.max(186, 575 - (headH + blockH) / 2);
  const boxes: Box[] = new Array(n);
  rows.forEach((row, r) => {
    const total = row.length * w + (row.length - 1) * gap;
    const x0 = 960 - total / 2;
    row.forEach((idx, c) => {
      boxes[idx] = {
        x: x0 + c * (w + gap),
        y: top + headH + r * (h + rowGap),
        w,
        h,
      };
    });
  });
  const links: Pt[][] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = boxes[i]!;
    const b = boxes[i + 1]!;
    if (Math.abs(a.y - b.y) < 1)
      links.push([
        { x: a.x + a.w, y: a.y + a.h / 2 + 10 },
        { x: b.x, y: b.y + b.h / 2 + 10 },
      ]);
    else {
      // The wrap: down out of the row's last node, back along the gap, down into the next row's medallion.
      const midY = a.y + a.h + rowGap / 2;
      links.push([
        { x: a.x + a.w / 2, y: a.y + a.h },
        { x: a.x + a.w / 2, y: midY },
        { x: b.x + b.w / 2, y: midY },
        { x: b.x + b.w / 2, y: b.y - MEDAL / 2 },
      ]);
    }
  }
  return {
    boxes,
    links,
    nameSize,
    yearSize: year,
    lines,
    headTop: top,
    bottom: top + headH + blockH,
  };
}

export const Lineage: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, dim, visible } = useStage(len, 200);
  const nodes = parseNodes(g.items).slice(0, 5);
  const heading = clean(g.primary);
  if (!visible || nodes.length < 2) return null;
  const n = nodes.length;
  const L = layoutFor(nodes, Boolean(heading));
  const step = Math.min(20, 74 / (n - 1));
  const at = (i: number) => 14 + i * step;
  /** When the line reaches node i (node 0 is reached as it lands). */
  const reach = (i: number) => (i === 0 ? at(0) + 6 : at(i) + 1);
  const lens = L.links.map(polyLength);
  const total = lens.reduce((a, b) => a + b, 0);
  const lastLit = interpolate(frame, [at(n - 1) + 3, at(n - 1) + 13], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const headIn = spring({ frame: frame - 4, fps, config: SPRING.ENTER });
  const underline = interpolate(frame, [8, 24], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const headSize = bySize(heading, [
    [18, 80],
    [30, 66],
    [99, 54],
  ]);
  const anyYear = nodes.some((x) => x.year);
  const loopStart = at(n - 1) + 26;
  const loopT = frame >= loopStart ? ((frame - loopStart) % 72) / 48 : -1;
  const loopPos = loopT >= 0 && loopT <= 1 ? easeInOut(loopT) * total : -1;
  const lineH = Math.round(L.nameSize * 1.12);

  // The canvas the tree sits on.
  const cx0 = Math.max(96, Math.min(...L.boxes.map((b) => b.x)) - 70);
  const cx1 = Math.min(1824, Math.max(...L.boxes.map((b) => b.x + b.w)) + 70);
  const cy0 = L.headTop - 50;
  const cy1 = Math.min(1008, L.bottom + 56);
  const canvasIn = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 150, mass: 0.8 },
  });
  const bracket = (corner: number) => {
    const right = corner === 1 || corner === 2;
    const bottom = corner >= 2;
    const off = (1 - canvasIn) * 30;
    return (
      <div
        key={corner}
        style={{
          position: "absolute",
          left: right ? cx1 - 40 + off : cx0 - 4 - off,
          top: bottom ? cy1 - 40 + off : cy0 - 4 - off,
          width: 44,
          height: 44,
          borderLeft: right ? undefined : `4px solid ${COLOUR.amber}`,
          borderRight: right ? `4px solid ${COLOUR.amber}` : undefined,
          borderTop: bottom ? undefined : `4px solid ${COLOUR.amber}`,
          borderBottom: bottom ? `4px solid ${COLOUR.amber}` : undefined,
          opacity: canvasIn,
        }}
      />
    );
  };

  const pulse = (p: Pt, k: string, strength = 1) => (
    <g key={k} opacity={strength}>
      <circle cx={p.x} cy={p.y} r={34} fill="url(#lnGlow)" />
      <circle cx={p.x} cy={p.y} r={7} fill="#FFF4E6" />
    </g>
  );

  const nodeCard = (x: Node, lit: boolean, reached: boolean) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 16,
        background: lit
          ? `linear-gradient(180deg, #FF9A5C 0%, ${COLOUR.amber} 55%, #E2550C 100%)`
          : "linear-gradient(180deg, #23222A 0%, #141319 100%)",
        border: lit
          ? "2px solid #FFC08F"
          : `2px solid ${reached ? "rgba(255,107,26,0.7)" : "rgba(255,255,255,0.14)"}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: `${PAD_TOP}px ${PADX}px ${PAD_BOTTOM}px`,
        boxSizing: "border-box",
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      {!lit ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255,107,26,0.10), rgba(255,107,26,0) 45%)",
            opacity: reached ? 1 : 0.4,
          }}
        />
      ) : null}
      {anyYear ? (
        <div
          style={{
            position: "relative",
            fontFamily: DISPLAY,
            fontSize: L.yearSize,
            lineHeight: `${L.yearSize}px`,
            height: L.yearSize,
            marginBottom: 6,
            letterSpacing: 2,
            color: lit ? COLOUR.ink : COLOUR.amber,
          }}
        >
          {x.year}
        </div>
      ) : null}
      <div
        style={{
          position: "relative",
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: L.nameSize,
          lineHeight: `${lineH}px`,
          color: lit ? COLOUR.ink : COLOUR.paper,
          ...clampLines(L.lines),
        }}
      >
        {x.name}
      </div>
    </div>
  );

  const medallion = (i: number) => {
    const reached = interpolate(frame, [reach(i), reach(i) + 4], [0, 1], clamp);
    const flash = interpolate(frame, [reach(i), reach(i) + 18], [0, 1], {
      ...clamp,
      easing: easeOut,
    });
    const last = i === n - 1;
    const full = last ? lastLit : 0;
    return (
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: -MEDAL / 2,
          width: MEDAL,
          height: MEDAL,
          marginLeft: -MEDAL / 2,
          zIndex: 2,
        }}
      >
        {flash > 0 && flash < 1 ? (
          <div
            style={{
              position: "absolute",
              inset: -30 * flash,
              borderRadius: "50%",
              border: `${4 * (1 - flash) + 1}px solid #FFD3A8`,
              opacity: 1 - flash,
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 50% 35%, #2C2A33, #121116 72%)",
            border: `4px solid ${reached > 0.5 ? COLOUR.amber : "rgba(241,230,207,0.4)"}`,
            boxShadow:
              reached > 0.5
                ? "0 0 22px rgba(255,107,26,0.55), 0 8px 20px rgba(0,0,0,0.5)"
                : "0 8px 20px rgba(0,0,0,0.5)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: `radial-gradient(circle at 50% 35%, #FFA060, ${COLOUR.amber} 60%, #D9500A)`,
            border: "4px solid #FFD3A8",
            opacity: full,
          }}
        />
        {/* The glyph: a diamond, outlined until reached, then filled. */}
        <div
          style={{
            position: "absolute",
            left: MEDAL / 2 - 11,
            top: MEDAL / 2 - 11,
            width: 22,
            height: 22,
            transform: `rotate(45deg) scale(${1 + 0.35 * Math.sin(Math.PI * Math.min(1, flash * 2))})`,
            border: `3px solid ${full > 0.5 ? COLOUR.ink : reached > 0.5 ? COLOUR.amber : "rgba(241,230,207,0.55)"}`,
            background:
              full > 0.5
                ? COLOUR.ink
                : reached > 0.5
                  ? COLOUR.amber
                  : "transparent",
          }}
        />
      </div>
    );
  };

  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <AbsoluteFill>
        {/* The canvas: a dark dotted field with amber corner brackets. */}
        <div
          style={{
            position: "absolute",
            left: cx0,
            top: cy0,
            width: cx1 - cx0,
            height: cy1 - cy0,
            borderRadius: 18,
            opacity: canvasIn,
            transform: `scale(${0.97 + 0.03 * canvasIn})`,
            background:
              "radial-gradient(circle, rgba(245,245,242,0.10) 1.6px, rgba(245,245,242,0) 2.4px) 0 0 / 34px 34px, linear-gradient(180deg, rgba(16,16,22,0.78), rgba(10,10,14,0.78))",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
          }}
        />
        {[0, 1, 2, 3].map(bracket)}

        {heading ? (
          <div
            style={{
              position: "absolute",
              left: 96,
              right: 96,
              top: L.headTop,
              textAlign: "center",
              opacity: headIn,
              transform: `translateY(${(1 - headIn) * 26}px)`,
            }}
          >
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: headSize,
                lineHeight: `${headSize + 4}px`,
                color: COLOUR.paper,
                textTransform: "uppercase",
                letterSpacing: 2,
                whiteSpace: "nowrap",
                textShadow: "0 8px 30px rgba(0,0,0,0.6)",
              }}
            >
              {heading}
            </div>
            <div
              style={{
                margin: "16px auto 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 120 * underline,
                  height: 3,
                  background: `linear-gradient(90deg, transparent, ${COLOUR.amber})`,
                }}
              />
              <div
                style={{
                  width: 12,
                  height: 12,
                  transform: `rotate(45deg) scale(${underline})`,
                  background: COLOUR.amber,
                }}
              />
              <div
                style={{
                  width: 120 * underline,
                  height: 3,
                  background: `linear-gradient(90deg, ${COLOUR.amber}, transparent)`,
                }}
              />
            </div>
          </div>
        ) : null}

        <svg
          width={1920}
          height={1080}
          viewBox="0 0 1920 1080"
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <radialGradient id="lnGlow">
              <stop offset="0" stopColor="#FFE2C4" stopOpacity={0.95} />
              <stop offset="0.35" stopColor={COLOUR.amber} stopOpacity={0.55} />
              <stop offset="1" stopColor={COLOUR.amber} stopOpacity={0} />
            </radialGradient>
          </defs>
          {L.links.map((pts, i) => {
            const d = svgPath(pts);
            const p = interpolate(frame, [at(i) + 5, at(i + 1) + 1], [0, 1], {
              ...clamp,
              easing: easeInOut,
            });
            const seen = interpolate(frame, [at(i), at(i) + 6], [0, 1], clamp);
            const end = pts[pts.length - 1]!;
            const before = pts[pts.length - 2]!;
            const ang = Math.atan2(end.y - before.y, end.x - before.x);
            const len = lens[i]!;
            return (
              <g key={i}>
                <path
                  d={d}
                  fill="none"
                  stroke="rgba(245,245,242,0.25)"
                  strokeWidth={3}
                  strokeDasharray="2 11"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={seen}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={COLOUR.amber}
                  strokeOpacity={0.22}
                  strokeWidth={18}
                  strokeLinejoin="round"
                  strokeDasharray={len}
                  strokeDashoffset={len * (1 - p)}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={COLOUR.amber}
                  strokeWidth={6}
                  strokeLinejoin="round"
                  strokeDasharray={len}
                  strokeDashoffset={len * (1 - p)}
                />
                <circle
                  cx={pts[0]!.x}
                  cy={pts[0]!.y}
                  r={9}
                  fill={p > 0 ? COLOUR.amber : "#141319"}
                  stroke={COLOUR.amber}
                  strokeWidth={3}
                  opacity={seen}
                />
                <path
                  d="M-20 -12 L0 0 L-20 12"
                  fill="none"
                  stroke={COLOUR.amber}
                  strokeWidth={6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  transform={`translate(${end.x - 9 * Math.cos(ang)} ${end.y - 9 * Math.sin(ang)}) rotate(${(ang * 180) / Math.PI})`}
                  opacity={interpolate(p, [0.85, 1], [0, 1], clamp)}
                />
                {p > 0 && p < 1 ? pulse(pointAt(pts, len * p), `h${i}`) : null}
              </g>
            );
          })}
          {loopPos >= 0
            ? (() => {
                let left = loopPos;
                for (let i = 0; i < L.links.length; i++) {
                  if (left <= lens[i]! || i === L.links.length - 1)
                    return pulse(
                      pointAt(L.links[i]!, left),
                      "loop",
                      interpolate(loopT, [0, 0.1, 0.9, 1], [0, 1, 1, 0]),
                    );
                  left -= lens[i]!;
                }
                return null;
              })()
            : null}
        </svg>

        {nodes.map((x, i) => {
          const b = L.boxes[i]!;
          const s = spring({ frame: frame - at(i), fps, config: SPRING.POP });
          if (s <= 0.001) return null;
          const last = i === n - 1;
          const reached = frame >= reach(i);
          const ring = last
            ? interpolate(frame, [at(n - 1) + 8, at(n - 1) + 32], [0, 1], {
                ...clamp,
                easing: easeOut,
              })
            : 0;
          const breathe = last
            ? 0.5 + 0.5 * Math.sin((frame - at(n - 1)) / 14)
            : 0;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: b.x,
                top: b.y,
                width: b.w,
                height: b.h,
                opacity: s,
                transform: `translateY(${(1 - s) * 28}px) scale(${0.86 + 0.14 * s})`,
              }}
            >
              {last && ring > 0 && ring < 1 ? (
                <div
                  style={{
                    position: "absolute",
                    inset: -10 - 44 * ring,
                    borderRadius: 22 + 22 * ring,
                    border: `${4 * (1 - ring) + 1}px solid ${COLOUR.amber}`,
                    opacity: 1 - ring,
                  }}
                />
              ) : null}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 16,
                  boxShadow:
                    last && lastLit > 0
                      ? `0 0 ${44 + 26 * breathe}px rgba(255,107,26,${0.5 * lastLit + 0.15 * breathe * lastLit}), 0 24px 60px rgba(0,0,0,0.5)`
                      : "0 24px 60px rgba(0,0,0,0.5)",
                }}
              />
              {nodeCard(x, false, reached)}
              {last ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    clipPath: `inset(0 ${(1 - lastLit) * 100}% 0 0 round 16px)`,
                  }}
                >
                  {nodeCard(x, true, true)}
                </div>
              ) : null}
              {medallion(i)}
            </div>
          );
        })}
      </AbsoluteFill>
    </Stage>
  );
};
