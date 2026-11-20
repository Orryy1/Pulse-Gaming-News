// A cutaway or "anatomy" picture: a real screenshot of the game fills the board, and each part the line names gets a
// callout as the narrator reaches it: a pulsing ring on the spot (placed by the local vision model, src/assets/
// anatomy.ts), a leader line that draws out to the edge, and a glass label. The camera eases towards the part being
// named. Labels sit in a column on the side their part is on, spread so they never overlap or cross.
import React from "react";
import { Img, interpolate } from "remotion";
import { COLOUR } from "../../brand.ts";
import {
  Board,
  clamp,
  easeInOut,
  Label,
  land,
  progress,
  useClock,
} from "./kit.tsx";
import { labelWidth, plateWidth } from "./layout.ts";
import type { ExplainerProps } from "./types.ts";

export interface Callout {
  i: number;
  side: "left" | "right";
  /** The label's centre height in the picture box, px. */
  y: number;
}

/**
 * Each item's label place: the side its point is on (balanced so neither side holds more than half plus one), and a
 * height spread so neighbours are at least `gap` apart, kept inside the box, in the points' own order down the side.
 */
export function placeCallouts(
  points: Array<{ x: number; y: number }>,
  height: number,
  gap: number,
): Callout[] {
  const n = points.length;
  const order = points.map((p, i) => ({ i, p })).sort((a, b) => a.p.x - b.p.x);
  const leftCount = Math.min(
    Math.ceil(n / 2),
    Math.max(Math.floor(n / 2), order.filter((o) => o.p.x < 0.5).length),
  );
  const sides = new Map<number, "left" | "right">();
  order.forEach((o, k) => sides.set(o.i, k < leftCount ? "left" : "right"));
  const out: Callout[] = [];
  for (const side of ["left", "right"] as const) {
    const col = points
      .map((p, i) => ({ i, y: p.y * height }))
      .filter((c) => sides.get(c.i) === side)
      .sort((a, b) => a.y - b.y);
    const lo = gap / 2;
    const hi = height - gap / 2;
    // Push down from the top, then back up from the bottom, so the column keeps its order and its gaps.
    for (let k = 0; k < col.length; k++)
      col[k]!.y = Math.max(col[k]!.y, k ? col[k - 1]!.y + gap : lo);
    for (let k = col.length - 1; k >= 0; k--)
      col[k]!.y = Math.min(
        col[k]!.y,
        k < col.length - 1 ? col[k + 1]!.y - gap : hi,
      );
    for (const c of col) out.push({ i: c.i, side, y: c.y });
  }
  return out.sort((a, b) => a.i - b.i);
}

export const Anatomy: React.FC<ExplainerProps> = ({ e, len, at, accent }) => (
  <Board type="anatomy" title={e.title} len={len} accent={accent}>
    {({ o, content }) => (
      <AnatomyBody
        e={e}
        at={at}
        accent={accent}
        o={o}
        content={content}
        len={len}
      />
    )}
  </Board>
);

const AnatomyBody: React.FC<{
  e: ExplainerProps["e"];
  at: number[];
  accent: string;
  len: number;
  o: "tall" | "wide";
  content: { left: number; top: number; width: number; height: number };
}> = ({ e, at, accent, o, content, len }) => {
  const { frame, fps } = useClock();
  const n = e.items.length;
  const { active } = progress(frame, at);
  const tall = o === "tall";
  const points =
    e.points ??
    e.items.map((_, i) => ({ x: 0.3 + 0.4 * (i % 2), y: (i + 1) / (n + 1) }));
  const box = {
    left: content.left,
    top: content.top + 10,
    width: content.width,
    height: content.height - 20,
  };
  // The picture covers the box (centre crop) and the camera eases towards the part being named.
  const focus = active >= 0 ? points[active]! : { x: 0.5, y: 0.5 };
  const zoomIn = interpolate(frame, [at[0]! - 6, len], [1.0, 1.1], clamp);
  const fx = interpolate(
    frame,
    [Math.max(0, (at[active] ?? 0) - 6), (at[active] ?? 0) + 18],
    [0, 1],
    { ...clamp, easing: easeInOut },
  );
  // The pan never uncovers the board: it stays inside the slack the zoom gives.
  const slack = (zoomIn - 1) / 2;
  const camX = Math.max(-slack, Math.min(slack, (0.5 - focus.x) * 0.12 * fx));
  const camY = Math.max(-slack, Math.min(slack, (0.5 - focus.y) * 0.12 * fx));
  const at01 = (p: { x: number; y: number }): [number, number] => {
    // Where a picture point lands on screen after the cover crop is zoomed and panned (picture taken as 16:9).
    const pictureAspect = e.aspect ?? 16 / 9;
    const boxAspect = box.width / box.height;
    let w = box.width;
    let h = box.height;
    if (pictureAspect > boxAspect) w = box.height * pictureAspect;
    else h = box.width / pictureAspect;
    const x =
      box.left + box.width / 2 + ((p.x - 0.5) * w + camX * box.width) * zoomIn;
    const y =
      box.top + box.height / 2 + ((p.y - 0.5) * h + camY * box.height) * zoomIn;
    return [x, y];
  };
  const lw = labelWidth("anatomy", o, n);
  // The plate round a label: its text slot plus padding.
  const plateW = lw + 40;
  const gap = tall ? 150 : 140;
  const callouts = placeCallouts(points, box.height, gap);
  const imgIn = interpolate(frame, [0, 12], [0, 1], clamp);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          borderRadius: 28,
          overflow: "hidden",
          boxShadow:
            "0 0 0 2px rgba(255,255,255,0.12), 0 30px 80px rgba(0,0,0,0.6)",
          opacity: imgIn,
        }}
      >
        {e.picture ? (
          <Img
            src={e.picture}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${zoomIn}) translate(${camX * 100}%, ${camY * 100}%)`,
              filter: "brightness(0.82) saturate(1.05)",
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(11,11,14,0.55) 0%, rgba(11,11,14,0) 30%, rgba(11,11,14,0) 70%, rgba(11,11,14,0.55) 100%)",
          }}
        />
      </div>
      <svg
        width={content.left * 2 + content.width}
        height={content.top + content.height + 40}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        {callouts.map((c) => {
          if (frame < at[c.i]!) return null;
          const [px, py] = at01(points[c.i]!);
          const ly = box.top + c.y;
          const lx =
            c.side === "left"
              ? box.left + 20 + plateWidth(e.items[c.i]!.label, "anatomy", o, n)
              : box.left + box.width - 20 - plateWidth(e.items[c.i]!.label, "anatomy", o, n);
          const p = interpolate(frame, [at[c.i]!, at[c.i]! + 14], [0, 1], {
            ...clamp,
            easing: easeInOut,
          });
          const elbowX = lx + (c.side === "left" ? 30 : -30);
          const pts: Array<[number, number]> = [
            [px, py],
            [elbowX, ly],
            [lx, ly],
          ];
          const total = Math.hypot(elbowX - px, ly - py) + 30;
          const isActive = c.i === active;
          const ring = (frame - at[c.i]!) % 30;
          return (
            <g key={c.i}>
              <circle
                cx={px}
                cy={py}
                r={14 + ring * 1.4}
                fill="none"
                stroke={accent}
                strokeWidth={3}
                opacity={(1 - ring / 30) * (isActive ? 0.9 : 0.4)}
              />
              <circle
                cx={px}
                cy={py}
                r={13}
                fill={isActive ? accent : COLOUR.paper}
                stroke={COLOUR.ink}
                strokeWidth={4}
              />
              <path
                d={`M${pts.map((q) => q.join(",")).join(" L")}`}
                fill="none"
                stroke="rgba(11,11,14,0.7)"
                strokeWidth={11}
                strokeLinecap="round"
                strokeDasharray={`${total * p} ${total}`}
              />
              <path
                d={`M${pts.map((q) => q.join(",")).join(" L")}`}
                fill="none"
                stroke={isActive ? accent : "rgba(245,245,242,0.95)"}
                strokeWidth={5}
                strokeDasharray={`${total * p} ${total}`}
                style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.8))" }}
              />
            </g>
          );
        })}
      </svg>
      {callouts.map((c) => {
        if (frame < at[c.i]! + 6) return null;
        const p = land(frame, fps, at[c.i]! + 6);
        const isActive = c.i === active;
        const left =
          c.side === "left"
            ? box.left + 20
            : box.left + box.width - 20 - plateW;
        return (
          <div
            key={c.i}
            style={{
              position: "absolute",
              left,
              top: box.top + c.y - (tall ? 62 : 56),
              width: plateW,
              minHeight: tall ? 124 : 112,
              display: "flex",
              alignItems: "center",
              justifyContent: c.side === "left" ? "flex-start" : "flex-end",
              opacity: Math.min(1, p * 1.3),
              transform: `translateX(${(1 - p) * (c.side === "left" ? -30 : 30)}px)`,
            }}
          >
            <div
              style={{
                padding: "14px 20px",
                borderRadius: 18,
                background: "rgba(11,11,14,0.84)",
                boxShadow: isActive
                  ? `0 0 0 2px ${accent}, 0 12px 30px rgba(0,0,0,0.6)`
                  : "0 0 0 1px rgba(255,255,255,0.14), 0 12px 30px rgba(0,0,0,0.6)",
                maxWidth: plateW,
              }}
            >
              <Label
                text={e.items[c.i]!.label}
                type="anatomy"
                o={o}
                n={n}
                align={c.side === "left" ? "left" : "right"}
                colour={COLOUR.paper}
              />
            </div>
          </div>
        );
      })}
    </>
  );
};
