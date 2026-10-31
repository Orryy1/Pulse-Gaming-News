// The period props the object scenes share (./Objects.tsx): monitors and a Pulse dev kit by era (CRT and beige
// plastic to 2005, flat panels and black after), a keyboard, a mug, a paper stack, a desk lamp and the code
// editor that scrolls on a screen as abstract coloured lines. No real product's shape, logo or name: the Pulse
// badge sits where a maker's would. All drawn in SVG at their place on the 1920x1080 frame.
import React from "react";
import { COLOUR } from "../../brand.ts";
import { PulseBadgeSvg } from "../packs/pulse/PulseBadge.tsx";
import { PulseMark } from "../packs/screen/pulse.tsx";
import type { Era } from "./choose.ts";
import { rand } from "./kit.tsx";

/** Beige plastic of the 90s and early 2000s, and the black of later kit. */
export const BEIGE = {
  top: "#ddd5c2",
  front: "#c9c0ab",
  side: "#a59c86",
  dark: "#8a826e",
  line: "#7a7360",
} as const;
export const BLACK = {
  top: "#34353c",
  front: "#24252b",
  side: "#18191d",
  dark: "#0f1013",
  line: "#45464e",
} as const;

/**
 * Lines of code as coloured bars, scrolled up by `scroll` px inside a box: indents, a gutter and token
 * colours, seeded so a screen always shows the same file. `mono` draws one phosphor colour (a CRT).
 */
export const CodeLines: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  scroll: number;
  seed: number;
  mono?: string;
  clip: string;
  cursor?: boolean;
  frame: number;
}> = ({ x, y, w, h, scroll, seed, mono, clip, cursor, frame }) => {
  const LH = 26;
  const first = Math.floor(scroll / LH);
  const rows = Math.ceil(h / LH) + 2;
  const palette = mono
    ? [mono, mono, mono, mono]
    : [COLOUR.amber, COLOUR.sky, "#c8c3d6", COLOUR.up, COLOUR.gold];
  const out: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const n = first + r;
    const ly = y + 16 + n * LH - scroll;
    const blank = rand(seed * 977 + n * 13) < 0.12;
    out.push(
      <rect
        key={`g${n}`}
        x={x + 12}
        y={ly}
        width={22}
        height={10}
        rx={3}
        fill={mono ?? "#5b5f6b"}
        opacity={mono ? 0.35 : 0.8}
      />,
    );
    if (blank) continue;
    const indent = Math.floor(rand(seed * 31 + n * 7) * 4) * 28;
    let tx = x + 54 + indent;
    const tokens = 1 + Math.floor(rand(seed * 17 + n * 3) * 4);
    for (let t = 0; t < tokens; t++) {
      const tw = 24 + rand(seed * 5 + n * 11 + t * 29) * 110;
      if (tx + tw > x + w - 16) break;
      const c =
        palette[Math.floor(rand(seed + n * 41 + t * 19) * palette.length)]!;
      out.push(
        <rect
          key={`t${n}-${t}`}
          x={tx}
          y={ly}
          width={tw}
          height={12}
          rx={4}
          fill={c}
          opacity={mono ? 0.85 : 0.9}
        />,
      );
      tx += tw + 12;
    }
  }
  // The caret on the last full line, blinking twice a second.
  const caretRow = first + rows - 3;
  const caretY = y + 14 + caretRow * LH - scroll;
  return (
    <g clipPath={`url(#${clip})`}>
      {out}
      {cursor && Math.floor(frame / 15) % 2 === 0 && (
        <rect
          x={x + 54 + 28}
          y={caretY}
          width={12}
          height={16}
          fill={mono ?? COLOUR.paper}
        />
      )}
    </g>
  );
};

/** A CRT monitor: a deep beige case, a curved dark screen and the badge on the bezel. Screen box returned. */
export function crtMonitor(o: {
  x: number;
  y: number;
  w: number;
  h: number;
  p: string;
  on: number;
  screen: (box: {
    x: number;
    y: number;
    w: number;
    h: number;
  }) => React.ReactNode;
}): React.ReactNode {
  const { x, y, w, h, p, on } = o;
  const sx = x + w * 0.09;
  const sy = y + h * 0.1;
  const sw = w * 0.82;
  const sh = h * 0.72;
  return (
    <g>
      {/* The case behind the bezel, seen a little from above. */}
      <path
        d={`M${x + 18} ${y + 10} L${x + w * 0.16} ${y - h * 0.12} H${x + w * 0.84} L${x + w - 18} ${y + 10} Z`}
        fill={BEIGE.top}
      />
      <rect x={x} y={y} width={w} height={h} rx={26} fill={BEIGE.front} />
      <rect
        x={x + 6}
        y={y + 6}
        width={w - 12}
        height={h - 12}
        rx={22}
        fill="none"
        stroke="#e7e0cf"
        strokeOpacity={0.6}
        strokeWidth={3}
      />
      <rect
        x={sx - 10}
        y={sy - 10}
        width={sw + 20}
        height={sh + 20}
        rx={44}
        fill={BEIGE.dark}
      />
      <clipPath id={`${p}-crt`}>
        <rect x={sx} y={sy} width={sw} height={sh} rx={40} />
      </clipPath>
      <rect x={sx} y={sy} width={sw} height={sh} rx={40} fill="#0d130f" />
      <g opacity={on} clipPath={`url(#${p}-crt)`}>
        {o.screen({ x: sx, y: sy, w: sw, h: sh })}
      </g>
      {/* Scanlines and the curved glass's highlight. */}
      <g clipPath={`url(#${p}-crt)`}>
        <rect
          x={sx}
          y={sy}
          width={sw}
          height={sh}
          fill={`url(#${p}-scan)`}
          opacity={0.5}
        />
        <ellipse
          cx={sx + sw * 0.3}
          cy={sy + sh * 0.18}
          rx={sw * 0.42}
          ry={sh * 0.16}
          fill="#fff"
          opacity={0.06}
        />
      </g>
      {/* The badge on the chin under the screen, sized to the bezel. */}
      <PulseBadgeSvg
        x={x + w / 2 - h * 0.11}
        y={y + h * 0.845}
        size={Math.min(26, h * 0.055)}
        colour="#6f6857"
      />
      <rect
        x={x + w - 74}
        y={y + h - 38}
        width={34}
        height={12}
        rx={4}
        fill={BEIGE.dark}
      />
      <circle
        cx={x + w - 92}
        cy={y + h - 32}
        r={6}
        fill={COLOUR.up}
        opacity={0.4 + 0.6 * on}
      />
      {/* Its foot. */}
      <path
        d={`M${x + w * 0.36} ${y + h} L${x + w * 0.32} ${y + h + 34} H${x + w * 0.68} L${x + w * 0.64} ${y + h} Z`}
        fill={BEIGE.side}
      />
    </g>
  );
}

/** A flat panel: a thin black bezel, a slim neck and an oval foot. */
export function flatMonitor(o: {
  x: number;
  y: number;
  w: number;
  h: number;
  p: string;
  on: number;
  screen: (box: {
    x: number;
    y: number;
    w: number;
    h: number;
  }) => React.ReactNode;
}): React.ReactNode {
  const { x, y, w, h, p, on } = o;
  const b = 14;
  return (
    <g>
      <rect
        x={x + w / 2 - 26}
        y={y + h - 10}
        width={52}
        height={96}
        fill="#2a2b31"
      />
      <ellipse
        cx={x + w / 2}
        cy={y + h + 88}
        rx={w * 0.2}
        ry={16}
        fill="#2f3036"
      />
      <rect x={x} y={y} width={w} height={h} rx={14} fill="#121317" />
      <rect
        x={x + 2}
        y={y + 2}
        width={w - 4}
        height={h - 4}
        rx={12}
        fill="none"
        stroke="#3d3e46"
        strokeWidth={2}
      />
      <clipPath id={`${p}-flat`}>
        <rect x={x + b} y={y + b} width={w - 2 * b} height={h - 2 * b} rx={4} />
      </clipPath>
      <rect
        x={x + b}
        y={y + b}
        width={w - 2 * b}
        height={h - 2 * b}
        rx={4}
        fill="#0b0e13"
      />
      <g opacity={on} clipPath={`url(#${p}-flat)`}>
        {o.screen({ x: x + b, y: y + b, w: w - 2 * b, h: h - 2 * b })}
      </g>
      <g transform={`translate(${x + w / 2 - 7} ${y + h - 12})`}>
        <PulseMark size={14} colour="#6d6e78" />
      </g>
    </g>
  );
}

/** The Pulse dev kit: a beige box with vents and a drive slot to 2005, a black slab with a lit strip after. */
export const DevKit: React.FC<{
  x: number;
  y: number;
  era: Era;
  busy: number;
  frame: number;
}> = ({ x, y, era, busy, frame }) => {
  const W = 330;
  const H = 150;
  const D = 34;
  const c = era === "crt" ? BEIGE : BLACK;
  const blink = Math.floor(frame / 5) % 3 !== 0 ? 1 : 0.25;
  return (
    <g>
      <path
        d={`M${x} ${y} L${x + D} ${y - D} H${x + W + D} L${x + W} ${y} Z`}
        fill={c.top}
      />
      <path
        d={`M${x + W} ${y} L${x + W + D} ${y - D} V${y + H - D} L${x + W} ${y + H} Z`}
        fill={c.side}
      />
      <rect x={x} y={y} width={W} height={H} fill={c.front} />
      {era === "crt" ? (
        <g>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect
              key={i}
              x={x + 22}
              y={y + 26 + i * 18}
              width={90}
              height={6}
              rx={3}
              fill={c.dark}
            />
          ))}
          <rect
            x={x + 140}
            y={y + 30}
            width={160}
            height={14}
            rx={4}
            fill={c.dark}
          />
          <rect x={x + 140} y={y + 35} width={160} height={4} fill="#3b382f" />
          <PulseBadgeSvg x={x + 150} y={y + 70} size={36} colour="#4e493d" />
          <circle cx={x + 300} cy={y + 122} r={6} fill={COLOUR.up} />
          <circle
            cx={x + 280}
            cy={y + 122}
            r={6}
            fill={COLOUR.amber}
            opacity={busy ? blink : 0.25}
          />
        </g>
      ) : (
        <g>
          <rect
            x={x + 20}
            y={y + H - 22}
            width={W - 40}
            height={6}
            rx={3}
            fill={COLOUR.amber}
            opacity={0.35 + 0.65 * busy * blink}
          />
          <PulseBadgeSvg
            x={x + 24}
            y={y + 30}
            size={40}
            colour={COLOUR.paper}
            wordColour={COLOUR.paper}
            opacity={0.85}
          />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect
              key={i}
              x={x + 230 + i * 12}
              y={y + 30}
              width={4}
              height={64}
              rx={2}
              fill={c.dark}
            />
          ))}
        </g>
      )}
    </g>
  );
};

/** A keyboard lying on the desk, seen from the front and above. */
export const Keyboard: React.FC<{
  cx: number;
  y: number;
  w: number;
  era: Era;
}> = ({ cx, y, w, era }) => {
  const c = era === "crt" ? BEIGE : BLACK;
  const keyFill = era === "crt" ? "#e9e2d1" : "#3b3c44";
  const l = cx - w / 2;
  const rows = 4;
  const keys: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const ry = y + 10 + r * 12;
    const inset = (rows - r) * 6;
    const n = 15;
    const kw = (w - 2 * inset - 30) / n;
    for (let k = 0; k < n; k++)
      keys.push(
        <rect
          key={`${r}-${k}`}
          x={l + inset + 15 + k * kw}
          y={ry}
          width={kw - 4}
          height={9}
          rx={2}
          fill={keyFill}
        />,
      );
  }
  return (
    <g>
      <path
        d={`M${l + 24} ${y} H${l + w - 24} L${l + w} ${y + 62} H${l} Z`}
        fill={c.front}
      />
      <path d={`M${l} ${y + 62} H${l + w} V${y + 72} H${l} Z`} fill={c.side} />
      {keys}
    </g>
  );
};

export const Mug: React.FC<{ x: number; y: number; colour?: string }> = ({
  x,
  y,
  colour = "#c9c4bb",
}) => (
  <g>
    <path
      d={`M${x + 58} ${y - 74} q34 4 30 34 q-4 26 -30 24`}
      fill="none"
      stroke={colour}
      strokeWidth={12}
    />
    <rect x={x} y={y - 96} width={64} height={96} rx={10} fill={colour} />
    <ellipse cx={x + 32} cy={y - 96} rx={32} ry={9} fill="#5a4636" />
    <rect
      x={x}
      y={y - 60}
      width={64}
      height={14}
      fill={COLOUR.amber}
      opacity={0.8}
    />
  </g>
);

/** A loose stack of paper, slightly fanned. */
export const Papers: React.FC<{ x: number; y: number; n?: number }> = ({
  x,
  y,
  n = 4,
}) => (
  <g>
    {Array.from({ length: n }, (_, i) => {
      const top = i === n - 1;
      const dy = -i * 4;
      return (
        <g
          key={i}
          transform={`rotate(${(i % 2 ? 1 : -1) * (1.5 + i)} ${x + 130} ${y})`}
        >
          {/* A sheet lying on the desk, seen from the front and above: a shallow trapezoid with an edge. */}
          <path
            d={`M${x + 34} ${y - 52 + dy} H${x + 226} L${x + 260} ${y + dy} H${x} Z`}
            fill={top ? "#efebe2" : "#d9d4c9"}
          />
          <path
            d={`M${x} ${y + dy} H${x + 260} V${y + dy + 3} H${x} Z`}
            fill="#a8a294"
          />
          {top &&
            [0, 1, 2, 3].map((k) => (
              <rect
                key={k}
                x={x + 50 - k * 4}
                y={y - 40 + k * 10}
                width={150 - (k % 2) * 40}
                height={3}
                fill="#a8a294"
              />
            ))}
        </g>
      );
    })}
  </g>
);

/** An anglepoise desk lamp, base at (x, y), its head towards (x + reach); returns its light cone separately. */
export const DeskLamp: React.FC<{
  x: number;
  y: number;
  dir?: 1 | -1;
  on: number;
  p: string;
}> = ({ x, y, dir = 1, on, p }) => {
  const hx = x + dir * 150;
  const hy = y - 250;
  return (
    <g>
      <path
        d={`M${hx + dir * 20} ${hy + 30} L${hx + dir * 230} ${y + 40} L${hx - dir * 140} ${y + 40} Z`}
        fill="#ffd9a8"
        opacity={0.1 * on}
        filter={`url(#${p}-soft)`}
      />
      <ellipse
        cx={hx + dir * 30}
        cy={y + 12}
        rx={190}
        ry={30}
        fill="#ffd9a8"
        opacity={0.22 * on}
        filter={`url(#${p}-soft)`}
      />
      <ellipse cx={x} cy={y} rx={56} ry={12} fill="#2a2b31" />
      <path
        d={`M${x} ${y - 6} L${x - dir * 40} ${y - 150} L${hx} ${hy}`}
        fill="none"
        stroke="#3a3b42"
        strokeWidth={10}
        strokeLinejoin="round"
      />
      <circle cx={x - dir * 40} cy={y - 150} r={9} fill="#4a4b53" />
      <g transform={`rotate(${dir * 28} ${hx} ${hy})`}>
        <path
          d={`M${hx - 40} ${hy + 30} L${hx - 18} ${hy - 18} H${hx + 18} L${hx + 40} ${hy + 30} Z`}
          fill="#3a3b42"
        />
        <ellipse
          cx={hx}
          cy={hy + 30}
          rx={40}
          ry={9}
          fill="#ffe7c2"
          opacity={0.25 + 0.75 * on}
        />
      </g>
    </g>
  );
};

/** The scanline pattern a CRT screen uses, id `${p}-scan`. */
export const ScanDefs: React.FC<{ p: string }> = ({ p }) => (
  <defs>
    <pattern
      id={`${p}-scan`}
      width={4}
      height={4}
      patternUnits="userSpaceOnUse"
    >
      <rect width={4} height={2} fill="#000" opacity={0.45} />
    </pattern>
  </defs>
);

/** A box cover: the game's picture when there is one, else Pulse colour bands round the mark (no words). */
export const Cover: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  src?: string;
  id: string;
  rx?: number;
}> = ({ x, y, w, h, src, id, rx = 4 }) => (
  <g>
    <clipPath id={id}>
      <rect x={x} y={y} width={w} height={h} rx={rx} />
    </clipPath>
    {src ? (
      <image
        href={src}
        x={x}
        y={y}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#${id})`}
      />
    ) : (
      <g clipPath={`url(#${id})`}>
        <rect x={x} y={y} width={w} height={h} fill="#17171b" />
        <rect
          x={x}
          y={y + h * 0.62}
          width={w}
          height={h * 0.07}
          fill={COLOUR.alert}
        />
        <rect
          x={x}
          y={y + h * 0.71}
          width={w}
          height={h * 0.07}
          fill={COLOUR.amber}
        />
        <rect
          x={x}
          y={y + h * 0.8}
          width={w}
          height={h * 0.07}
          fill={COLOUR.gold}
        />
        <g transform={`translate(${x + w / 2 - w * 0.22} ${y + h * 0.16})`}>
          <PulseMark size={w * 0.44} colour={COLOUR.paper} />
        </g>
      </g>
    )}
  </g>
);
