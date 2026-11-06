// The archive documents' pages (./DocumentShot.tsx puts them on the desk, moves the camera and marks them). Each
// page draws its paper, its fixed generic labels ("MEMO", "SCHEDULE"), the chapter's game on the PROJECT line,
// the key line from the sentence where ./layout.ts placed it, and placeholder bars for every other word a real
// page would carry, so nothing on it is invented. The letterhead is Pulse's own badge; no real company's.

import React from "react";
import { interpolate } from "remotion";
import { BODY, HAND } from "../fonts.ts";
import { PulseBadge } from "../packs/pulse/PulseBadge.tsx";
import { TextureBackground } from "../Backgrounds.tsx";
import {
  GRAIN,
  INK,
  INK_MASK,
  Pin,
  RED_PEN,
  SERIF,
  Sheet,
  TYPEFACE,
  Tape,
} from "../packs/paper/kit.tsx";
import type { DocScene } from "./choose.ts";
import {
  CH,
  MONTH_ABBR,
  columnFigure,
  placeholderWidths,
  rnd,
  type PageLayout,
  type TypedBlock,
} from "./layout.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const BAR = "rgba(29,27,24,0.17)";
const FAINT = "rgba(29,27,24,0.1)";

export type PageProps = {
  scene: DocScene;
  L: PageLayout;
  frame: number;
};

/** A grey bar where a real page would have words this sentence does not give. */
const Bar: React.FC<{
  x: number;
  y: number;
  w: number;
  h?: number;
  colour?: string;
  r?: number;
}> = ({ x, y, w, h = 16, colour = BAR, r = 4 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: Math.max(0, w),
      height: h,
      background: colour,
      borderRadius: r,
    }}
  />
);

/** Rows of placeholder text from y to y + n * gap. */
const Lines: React.FC<{
  x: number;
  y: number;
  w: number;
  n: number;
  gap?: number;
  h?: number;
  seed: number;
  last?: boolean;
}> = ({ x, y, w, n, gap = 46, h = 16, seed, last = true }) => (
  <>
    {placeholderWidths(n, seed, last).map((f, i) => (
      <Bar key={i} x={x} y={y + i * gap} w={w * f} h={h} />
    ))}
  </>
);

/** How many placeholder rows fit between two heights. */
const rowsBetween = (top: number, bottom: number, gap = 46) =>
  Math.max(0, Math.floor((bottom - top) / gap));

/** The key line, typed. */
export const Typed: React.FC<{
  b: TypedBlock;
  weight?: number;
  colour?: string;
}> = ({ b, weight = 700, colour = INK }) => (
  <div
    style={{
      position: "absolute",
      left: b.x,
      top: b.y,
      fontFamily: TYPEFACE,
      fontWeight: weight,
      fontSize: b.size,
      lineHeight: `${b.lineH}px`,
      color: colour,
      whiteSpace: "pre",
      textShadow: "0 0 0.7px rgba(29,27,24,0.5)",
    }}
  >
    {b.lines.map((ln, i) => (
      <div key={i} style={{ height: b.lineH }}>
        {ln.text}
      </div>
    ))}
  </div>
);

/** A small typed label (a fixed generic word, or the chapter's game). */
const Label: React.FC<{
  x: number;
  y: number;
  size?: number;
  children: React.ReactNode;
  colour?: string;
  weight?: number;
  style?: React.CSSProperties;
}> = ({ x, y, size = 28, children, colour = INK, weight = 700, style }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      fontFamily: TYPEFACE,
      fontWeight: weight,
      fontSize: size,
      lineHeight: 1.1,
      color: colour,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);

/** A heading in the read face: the document's fixed name. */
const Heading: React.FC<{
  x: number;
  y: number;
  size: number;
  children: React.ReactNode;
  spacing?: number;
  face?: string;
  style?: React.CSSProperties;
}> = ({ x, y, size, children, spacing = 6, face = BODY, style }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      fontFamily: face,
      fontWeight: 900,
      fontSize: size,
      letterSpacing: spacing,
      lineHeight: 1,
      color: INK,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);

/** A red rubber stamp with dry ink. */
const RubberStamp: React.FC<{
  x: number;
  y: number;
  text: string;
  rot?: number;
  size?: number;
  colour?: string;
}> = ({ x, y, text, rot = -6, size = 34, colour = "#b3352b" }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      padding: "8px 20px 6px",
      border: `5px solid ${colour}`,
      borderRadius: 8,
      fontFamily: BODY,
      fontWeight: 900,
      fontSize: size,
      letterSpacing: 7,
      lineHeight: 1.1,
      color: colour,
      whiteSpace: "nowrap",
      mixBlendMode: "multiply",
      WebkitMaskImage: INK_MASK,
      maskImage: INK_MASK,
      opacity: 0.9,
      transform: `rotate(${rot}deg)`,
    }}
  >
    {text}
  </div>
);

/** A rule across the page. */
const Rule: React.FC<{
  x: number;
  y: number;
  w: number;
  h?: number;
  o?: number;
}> = ({ x, y, w, h = 3, o = 0.7 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: h,
      background: `rgba(29,27,24,${o})`,
    }}
  />
);

const tone = (s: DocScene) => (s.look === "typed" ? "#efe6cf" : "#f6f3ea");

/** A sheet of paper the page's size, children placed absolutely. */
const Paper: React.FC<{
  s: DocScene;
  L: PageLayout;
  children: React.ReactNode;
  colour?: string;
}> = ({ s, L, children, colour }) => (
  <Sheet
    width={L.w}
    tone={colour ?? tone(s)}
    style={{ height: L.h, position: "relative", overflow: "hidden" }}
  >
    {children}
  </Sheet>
);

/** Lines after the key line, down to `bottom`. */
const after = (b: TypedBlock | undefined, gap = 40) =>
  b ? b.y + b.lines.length * b.lineH + gap : 0;

// ---------------------------------------------------------------- memo

export const MemoPage: React.FC<PageProps> = ({ scene: s, L }) => {
  const k = L.key!;
  const fields: Array<[string, string | undefined]> = [
    ["TO:", undefined],
    ["FROM:", undefined],
    ["DATE:", s.date],
    ["RE:", s.project],
  ];
  const tail = after(k, 54);
  return (
    <Paper s={s} L={L}>
      <PulseBadge
        size={64}
        colour="#ff6b1a"
        wordColour={INK}
        style={{ position: "absolute", left: 96, top: 84 }}
      />
      <Heading x={L.w - 96 - 236} y={86} size={64} spacing={12}>
        MEMO
      </Heading>
      <Rule x={96} y={180} w={L.w - 192} />
      <Rule x={96} y={189} w={L.w - 192} h={1.5} o={0.5} />
      {fields.map(([label, value], i) => (
        <React.Fragment key={label}>
          <Label x={96} y={232 + i * 58}>
            {label}
          </Label>
          {value ? (
            <Label x={250} y={232 + i * 58} weight={400}>
              {value}
            </Label>
          ) : (
            <Bar x={250} y={240 + i * 58} w={[300, 260, 220, 340][i]!} h={18} />
          )}
        </React.Fragment>
      ))}
      <RubberStamp x={L.w - 380} y={262} text="INTERNAL" rot={-7} />
      <Rule x={96} y={480} w={L.w - 192} h={2} o={0.45} />
      <Lines x={96} y={530} w={L.w - 192} n={2} seed={s.seed} last={false} />
      <Typed b={k} />
      <Lines
        x={96}
        y={tail}
        w={L.w - 192}
        n={rowsBetween(tail, 1270)}
        seed={s.seed + 3}
      />
      <Bar x={96} y={1320} w={150} h={18} colour="rgba(29,27,24,0.25)" />
    </Paper>
  );
};

// ---------------------------------------------------------------- press release draft

/** Red-pen edits on the placeholder text: strike-throughs, carets and a margin squiggle (no words). */
const RedEdits: React.FC<{
  x: number;
  y: number;
  w: number;
  n: number;
  gap: number;
  seed: number;
}> = ({ x, y, w, n, gap, seed }) => (
  <svg
    width={w + 160}
    height={n * gap + 40}
    style={{
      position: "absolute",
      left: x - 20,
      top: y - 20,
      overflow: "visible",
    }}
  >
    {Array.from({ length: n }, (_, i) => {
      const r = rnd(seed, 70 + i);
      if (r < 0.45) return null;
      const a = 20 + w * 0.15 * rnd(seed, 80 + i);
      const len = w * (0.18 + 0.25 * rnd(seed, 90 + i));
      const yy = 20 + i * gap + 8;
      return r > 0.72 ? (
        <path
          key={i}
          d={`M${a} ${yy} q ${len / 2} ${-4 + 8 * rnd(seed, 95 + i)} ${len} 0`}
          stroke={RED_PEN}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <path
          key={i}
          d={`M${a + len} ${yy + 22} l 12 -22 l 12 22`}
          stroke={RED_PEN}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    })}
    <path
      d={`M${w + 70} 30 c 30 20 -30 50 0 70 s -30 50 0 70 s -24 40 6 60`}
      stroke={RED_PEN}
      strokeWidth={4}
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

export const PressPage: React.FC<PageProps> = ({ scene: s, L }) => {
  const k = L.key!;
  const tail = after(k, 54);
  return (
    <Paper s={s} L={L}>
      <Heading x={96} y={92} size={58} spacing={8}>
        PRESS RELEASE
      </Heading>
      <Label x={96} y={176} size={26}>
        FOR IMMEDIATE RELEASE
      </Label>
      <RubberStamp x={L.w - 300} y={96} text="DRAFT" rot={8} size={40} />
      {s.project ? (
        <Label x={96} y={232} size={26} weight={400}>
          {`PROJECT: ${s.project}`}
        </Label>
      ) : null}
      <Rule x={96} y={290} w={L.w - 192} h={2} o={0.5} />
      <Lines x={96} y={340} w={L.w - 192} n={4} seed={s.seed} last={false} />
      <RedEdits x={96} y={340} w={L.w - 300} n={4} gap={46} seed={s.seed} />
      <Typed b={k} />
      <Lines
        x={96}
        y={tail}
        w={L.w - 192}
        n={rowsBetween(tail, 1250)}
        seed={s.seed + 5}
      />
      <RedEdits
        x={96}
        y={tail}
        w={L.w - 300}
        n={rowsBetween(tail, 1250)}
        gap={46}
        seed={s.seed + 9}
      />
      <Label x={L.w / 2 - 40} y={1300} size={30}>
        ###
      </Label>
    </Paper>
  );
};

// ---------------------------------------------------------------- design document with a margin sketch

/** A pencil map sketch: a coast, a grid of streets, a bridge, a dotted route and a cross; drawn on as `p` runs. */
export const MapSketch: React.FC<{
  w: number;
  h: number;
  p: number;
  seed: number;
}> = ({ w, h, p, seed }) => {
  const j = (i: number, a: number) => (rnd(seed, i) * 2 - 1) * a;
  const coast = `M ${w * 0.62 + j(1, 10)} 18 C ${w * 0.5} ${h * 0.2}, ${w * 0.78} ${h * 0.32}, ${w * 0.6} ${h * 0.46} S ${w * 0.7} ${h * 0.7}, ${w * 0.55} ${h * 0.82} S ${w * 0.62} ${h * 0.95}, ${w * 0.58} ${h - 14}`;
  const streets: string[] = [];
  for (let i = 0; i < 6; i++) {
    const y = 60 + i * ((h - 140) / 5) + j(10 + i, 8);
    streets.push(`M 20 ${y} L ${w * 0.5 + j(20 + i, 18)} ${y + j(30 + i, 10)}`);
  }
  for (let i = 0; i < 4; i++) {
    const x = 34 + i * ((w * 0.42) / 3) + j(40 + i, 6);
    streets.push(`M ${x} 40 L ${x + j(50 + i, 12)} ${h - 40}`);
  }
  const bridge = `M ${w * 0.52} ${h * 0.38} L ${w * 0.86} ${h * 0.33} M ${w * 0.52} ${h * 0.41} L ${w * 0.86} ${h * 0.36}`;
  const island = `M ${w * 0.8} ${h * 0.12} c 30 -10 50 20 40 50 c -10 40 -50 30 -50 0 c 0 -20 0 -40 10 -50 z`;
  const route = `M 40 ${h * 0.86} C ${w * 0.2} ${h * 0.6}, ${w * 0.38} ${h * 0.62}, ${w * 0.4} ${h * 0.4} S ${w * 0.7} ${h * 0.3}, ${w * 0.84} ${h * 0.22}`;
  const parts: Array<{ d: string; width: number; dash?: string; o: number }> = [
    { d: coast, width: 4, o: 0.75 },
    ...streets.map((d) => ({ d, width: 2.4, o: 0.5 })),
    { d: bridge, width: 3, o: 0.7 },
    { d: island, width: 3, o: 0.6 },
    { d: route, width: 3.4, dash: "4 12", o: 0.8 },
  ];
  // Each stroke draws in turn over the run.
  const n = parts.length;
  return (
    <svg
      width={w}
      height={h}
      style={{ position: "absolute", overflow: "visible" }}
    >
      <rect
        x={4}
        y={4}
        width={w - 8}
        height={h - 8}
        fill="none"
        stroke="rgba(40,40,46,0.35)"
        strokeWidth={2.5}
        strokeDasharray="2000"
        strokeDashoffset={2000 * (1 - Math.min(1, p * 3))}
        transform={`rotate(${j(60, 0.8)} ${w / 2} ${h / 2})`}
      />
      {parts.map((s, i) => {
        const q = Math.max(0, Math.min(1, p * n - i * 0.85));
        if (q <= 0) return null;
        return (
          <path
            key={i}
            d={s.d}
            fill="none"
            stroke={`rgba(46,44,52,${s.o})`}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={s.dash ? undefined : "1 1"}
            strokeDashoffset={s.dash ? undefined : 1 - q}
            style={s.dash ? { opacity: q, strokeDasharray: s.dash } : undefined}
          />
        );
      })}
      {p > 0.92 ? (
        <path
          d={`M ${w * 0.8} ${h * 0.18} l 22 22 M ${w * 0.8 + 22} ${h * 0.18} l -22 22`}
          stroke={RED_PEN}
          strokeWidth={5}
          strokeLinecap="round"
          opacity={Math.min(1, (p - 0.92) * 14)}
        />
      ) : null}
    </svg>
  );
};

export const DesignPage: React.FC<PageProps> = ({ scene: s, L, frame }) => {
  const k = L.key!;
  const colW = L.sketch ? 600 : L.w - 192;
  const tail = after(k, 50);
  const draw = interpolate(frame, [18, 72], [0, 1], clamp);
  return (
    <Paper s={s} L={L} colour={s.look === "typed" ? "#ece5d2" : "#f7f6f1"}>
      {/* Faint blue grid of engineering paper. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(60,110,190,0.09) 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(60,110,190,0.09) 1.5px, transparent 1.5px)",
          backgroundSize: "40px 40px",
        }}
      />
      <Heading x={96} y={88} size={54} spacing={7}>
        DESIGN DOCUMENT
      </Heading>
      {s.project ? (
        <Label x={96} y={168} size={28} weight={400}>
          {`PROJECT: ${s.project}`}
        </Label>
      ) : null}
      <Rule x={96} y={226} w={L.w - 192} h={3} o={0.6} />
      <Bar x={96} y={290} w={360} h={30} colour="rgba(29,27,24,0.32)" />
      <Lines
        x={96}
        y={360}
        w={colW}
        n={3}
        seed={s.seed}
        last={false}
        gap={48}
      />
      <Typed b={k} />
      <Lines
        x={96}
        y={tail}
        w={colW}
        n={rowsBetween(tail, 1100, 48)}
        gap={48}
        seed={s.seed + 7}
      />
      <Bar x={96} y={1170} w={300} h={30} colour="rgba(29,27,24,0.32)" />
      <Lines x={96} y={1236} w={L.w - 192} n={3} gap={48} seed={s.seed + 11} />
      {L.sketch ? (
        <div
          style={{
            position: "absolute",
            left: L.sketch.left,
            top: L.sketch.top,
            width: L.sketch.width,
            height: L.sketch.height,
          }}
        >
          <MapSketch
            w={L.sketch.width}
            h={L.sketch.height}
            p={draw}
            seed={s.seed}
          />
        </div>
      ) : null}
    </Paper>
  );
};

// ---------------------------------------------------------------- contract

export const ContractPage: React.FC<PageProps> = ({ scene: s, L }) => {
  const k = L.key!;
  const sig = L.signature!;
  const tail = after(k, 50);
  return (
    <Paper s={s} L={L}>
      <Heading
        x={0}
        y={92}
        size={62}
        spacing={14}
        face={SERIF}
        style={{ width: L.w, textAlign: "center", fontWeight: 700 }}
      >
        AGREEMENT
      </Heading>
      <Rule x={300} y={176} w={L.w - 600} h={3} />
      <Rule x={300} y={185} w={L.w - 600} h={1.5} o={0.5} />
      {s.project ? (
        <Label
          x={0}
          y={214}
          size={26}
          weight={400}
          style={{ width: L.w, textAlign: "center" }}
        >
          {`PROJECT: ${s.project}`}
        </Label>
      ) : null}
      <Label x={96} y={296}>
        1.
      </Label>
      <Lines x={150} y={304} w={L.w - 246} n={3} seed={s.seed} />
      <Label x={96} y={444}>
        2.
      </Label>
      <Lines x={150} y={452} w={L.w - 246} n={2} seed={s.seed + 1} />
      <Label x={96} y={k.y + (k.lineH - 28) / 2 - 4}>
        3.
      </Label>
      <Typed b={k} />
      {tail + 40 < sig.top - 60 ? (
        <>
          <Label x={96} y={tail + 4}>
            4.
          </Label>
          <Lines
            x={150}
            y={tail + 12}
            w={L.w - 246}
            n={rowsBetween(tail, sig.top - 80)}
            seed={s.seed + 2}
          />
        </>
      ) : null}
      {/* The signature block: who signs is never named. */}
      <Rule
        x={sig.left}
        y={sig.top + sig.height}
        w={sig.width}
        h={2.5}
        o={0.8}
      />
      <Label x={sig.left} y={sig.top + sig.height + 14} size={24}>
        SIGNED
      </Label>
      <Rule x={680} y={sig.top + sig.height} w={320} h={2.5} o={0.8} />
      <Label x={680} y={sig.top + sig.height + 14} size={24}>
        DATE
      </Label>
      <Label x={96} y={sig.top + sig.height + 96}>
        4.
      </Label>
      <Lines
        x={150}
        y={sig.top + sig.height + 104}
        w={L.w - 246}
        n={rowsBetween(sig.top + sig.height + 104, L.h - 90)}
        seed={s.seed + 4}
      />
      {s.date ? (
        <Label x={690} y={sig.top + sig.height - 44} size={32} weight={400}>
          {s.date}
        </Label>
      ) : null}
    </Paper>
  );
};

// ---------------------------------------------------------------- production schedule

export const SchedulePage: React.FC<PageProps> = ({ scene: s, L }) => {
  const k = L.key!;
  const m = L.milestone!;
  const gridL = 300;
  const right = L.w - 70;
  const colW = (right - gridL) / 12;
  const y0 = 250;
  const rowH = 62;
  const bars = Array.from({ length: 5 }, (_, i) => {
    const a = Math.floor(rnd(s.seed, 200 + i) * 7);
    const n = 2 + Math.floor(rnd(s.seed, 210 + i) * 4);
    return { a, n: Math.min(n, 12 - a) };
  });
  return (
    <Paper s={s} L={L} colour="#f7f5ee">
      <Heading x={90} y={70} size={52} spacing={6}>
        PRODUCTION SCHEDULE
      </Heading>
      {s.project ? (
        <Label x={90} y={142} size={28} weight={400}>
          {`PROJECT: ${s.project}`}
        </Label>
      ) : null}
      {MONTH_ABBR.map((mo, i) => (
        <React.Fragment key={mo}>
          <Label
            x={gridL + i * colW}
            y={208}
            size={24}
            style={{ width: colW, textAlign: "center" }}
          >
            {mo}
          </Label>
          <div
            style={{
              position: "absolute",
              left: gridL + i * colW,
              top: y0,
              width: 1.5,
              height: rowH * 6,
              background: FAINT,
            }}
          />
        </React.Fragment>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <Rule
          key={i}
          x={90}
          y={y0 + i * rowH}
          w={right - 90}
          h={1.5}
          o={0.22}
        />
      ))}
      {bars.map((b, i) => (
        <React.Fragment key={i}>
          <Bar
            x={90}
            y={y0 + i * rowH + 23}
            w={130 + 60 * rnd(s.seed, 220 + i)}
            h={16}
          />
          <div
            style={{
              position: "absolute",
              left: gridL + b.a * colW + 6,
              top: y0 + i * rowH + 14,
              width: b.n * colW - 12,
              height: rowH - 28,
              borderRadius: 6,
              background:
                i % 2 ? "rgba(58,74,107,0.55)" : "rgba(255,107,26,0.62)",
            }}
          />
        </React.Fragment>
      ))}
      <Label x={90} y={y0 + 5 * rowH + 18} size={24}>
        MILESTONE
      </Label>
      <div
        style={{
          position: "absolute",
          left: m.x - 22,
          top: m.y - 22,
          width: 44,
          height: 44,
          background: INK,
          transform: "rotate(45deg)",
          borderRadius: 4,
        }}
      />
      {s.date ? (
        <Label
          x={m.dateLeft ? m.x - 40 - s.date.length * 36 * CH : m.x + 40}
          y={m.y - 20}
          size={36}
        >
          {s.date}
        </Label>
      ) : null}
      {/* The milestone's note, tied to its diamond. */}
      <div
        style={{
          position: "absolute",
          left: m.x - 1.5,
          top: m.y + 30,
          width: 3,
          height: Math.max(0, k.y - m.y - 44),
          background: "rgba(29,27,24,0.45)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: k.x - 30,
          top: k.y - 18,
          width: L.w - 160,
          height: k.lines.length * k.lineH + 36,
          border: "2.5px solid rgba(29,27,24,0.45)",
          borderRadius: 10,
        }}
      />
      <Typed b={k} />
    </Paper>
  );
};

// ---------------------------------------------------------------- crunch rota

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export const RotaPage: React.FC<PageProps> = ({ scene: s, L }) => {
  const k = L.key!;
  const gx = 330;
  const gr = L.w - 90;
  const colW = (gr - gx) / 7;
  const y0 = 520;
  const rowH = 70;
  return (
    <Paper s={s} L={L}>
      <Heading x={110} y={70} size={64} spacing={14}>
        ROTA
      </Heading>
      {s.project ? (
        <Label x={420} y={92} size={26} weight={400}>
          {`PROJECT: ${s.project}`}
        </Label>
      ) : null}
      <div
        style={{
          position: "absolute",
          left: 100,
          top: 176,
          width: L.w - 200,
          height: 280,
          background: "rgba(255,228,90,0.55)",
          backgroundImage: GRAIN,
          borderRadius: 6,
          boxShadow: "0 3px 8px rgba(0,0,0,0.12)",
        }}
      />
      <Typed b={k} />
      {DAYS.map((d, i) => (
        <Label
          key={d}
          x={gx + i * colW}
          y={y0 - 40}
          size={26}
          style={{ width: colW, textAlign: "center" }}
        >
          {d}
        </Label>
      ))}
      {Array.from({ length: 7 }, (_, r) => (
        <Rule key={r} x={110} y={y0 + r * rowH} w={gr - 110} h={1.5} o={0.3} />
      ))}
      {Array.from({ length: 8 }, (_, c) => (
        <div
          key={c}
          style={{
            position: "absolute",
            left: gx + c * colW,
            top: y0,
            width: 1.5,
            height: rowH * 6,
            background: "rgba(29,27,24,0.25)",
          }}
        />
      ))}
      {Array.from({ length: 6 }, (_, r) => (
        <React.Fragment key={r}>
          <Bar
            x={110}
            y={y0 + r * rowH + 27}
            w={120 + 70 * rnd(s.seed, 300 + r)}
            h={16}
          />
          {DAYS.map((_, c) => {
            // Most days are worked, weekends included: a cross in marker; a few are shaded double shifts.
            const v = rnd(s.seed, 400 + r * 7 + c);
            const cx = gx + c * colW + colW / 2;
            const cy = y0 + r * rowH + rowH / 2;
            if (v < 0.12) return null;
            if (v > 0.8)
              return (
                <div
                  key={c}
                  style={{
                    position: "absolute",
                    left: gx + c * colW + 8,
                    top: y0 + r * rowH + 8,
                    width: colW - 16,
                    height: rowH - 16,
                    background: "rgba(200,38,30,0.22)",
                    borderRadius: 4,
                  }}
                />
              );
            return (
              <svg
                key={c}
                width={40}
                height={40}
                style={{ position: "absolute", left: cx - 20, top: cy - 20 }}
              >
                <path
                  d={`M6 ${7 + 3 * v} L34 ${33 - 2 * v} M33 6 L7 ${34 - 3 * v}`}
                  stroke={INK}
                  strokeWidth={4.5}
                  strokeLinecap="round"
                  opacity={0.78}
                />
              </svg>
            );
          })}
        </React.Fragment>
      ))}
    </Paper>
  );
};

// ---------------------------------------------------------------- budget sheet and purchase order

/** A black redaction bar where a figure would be. */
const Redaction: React.FC<{ x: number; y: number; w: number; h?: number }> = ({
  x,
  y,
  w,
  h = 34,
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: h,
      background:
        "linear-gradient(180deg, #1d1c1b 0%, #0b0b0b 30%, #151413 70%, #080808 100%)",
      borderRadius: "3px 6px 4px 5px",
    }}
  />
);

export const BudgetPage: React.FC<PageProps> = ({ scene: s, L }) => {
  const k = L.key!;
  const amtX = 1110;
  const amount = columnFigure(s.figure, L.w - 110 - amtX, 40);
  const tail = after(k, 30);
  const rows = rowsBetween(tail, 900, 62);
  return (
    <Paper s={s} L={L}>
      <Heading x={110} y={72} size={64} spacing={12}>
        BUDGET
      </Heading>
      <RubberStamp
        x={L.w - 520}
        y={70}
        text="CONFIDENTIAL"
        rot={-5}
        size={40}
      />
      {s.project ? (
        <Label x={110} y={164} size={28} weight={400}>
          {`PROJECT: ${s.project}`}
        </Label>
      ) : null}
      <Lines x={110} y={240} w={900} n={2} seed={s.seed} gap={44} />
      <Label x={110} y={392} size={26}>
        ITEM
      </Label>
      <Label x={amtX} y={392} size={26}>
        AMOUNT
      </Label>
      <Rule x={110} y={432} w={L.w - 220} h={3} />
      <Typed b={k} />
      {amount ? (
        <Label x={amtX} y={k.y + (k.lineH - amount.size) / 2} size={amount.size}>
          {amount.text}
        </Label>
      ) : (
        <Redaction x={amtX} y={k.y + (k.lineH - 34) / 2} w={240} />
      )}
      {Array.from({ length: rows }, (_, i) => (
        <React.Fragment key={i}>
          <Rule x={110} y={tail + i * 62 - 14} w={L.w - 220} h={1.5} o={0.2} />
          <Bar
            x={110}
            y={tail + i * 62 + 8}
            w={380 + 400 * rnd(s.seed, 500 + i)}
            h={16}
          />
          <Redaction
            x={amtX}
            y={tail + i * 62}
            w={150 + 110 * rnd(s.seed, 520 + i)}
            h={30}
          />
        </React.Fragment>
      ))}
      <Rule x={110} y={930} w={L.w - 220} h={3} />
      <Label x={110} y={956} size={30}>
        TOTAL
      </Label>
      <Redaction x={amtX} y={952} w={260} />
    </Paper>
  );
};

export const ManifestPage: React.FC<PageProps> = ({ scene: s, L }) => {
  const k = L.key!;
  const qty = columnFigure(s.figure, 200, 30);
  const tail = after(k, 30);
  const rows = rowsBetween(tail, 960, 62);
  const box = (x: number, y: number, ticked: boolean) => (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 34,
        height: 34,
        border: `3px solid ${INK}`,
        borderRadius: 3,
      }}
    >
      {ticked ? (
        <svg
          width={44}
          height={44}
          style={{ position: "absolute", left: -2, top: -12 }}
        >
          <path
            d="M6 24 L16 36 L40 4"
            stroke={INK}
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      ) : null}
    </div>
  );
  return (
    <Paper s={s} L={L}>
      <Heading x={110} y={72} size={56} spacing={8}>
        {L.title ?? "PURCHASE ORDER"}
      </Heading>
      <Label x={L.w - 420} y={86} size={28}>
        NO.
      </Label>
      <Bar x={L.w - 340} y={92} w={230} h={20} />
      <Label x={110} y={170} size={28}>
        DATE:
      </Label>
      {s.date ? (
        <Label x={230} y={170} size={28} weight={400}>
          {s.date}
        </Label>
      ) : (
        <Bar x={230} y={176} w={240} h={18} />
      )}
      {s.project ? (
        <Label x={110} y={222} size={28} weight={400}>
          {`PROJECT: ${s.project}`}
        </Label>
      ) : null}
      <RubberStamp x={L.w - 330} y={180} text="COPY" rot={9} size={40} />
      <Label x={110} y={392} size={26}>
        QTY
      </Label>
      <Label x={330} y={392} size={26}>
        DESCRIPTION
      </Label>
      <Label x={L.w - 200} y={392} size={26}>
        CHECK
      </Label>
      <Rule x={110} y={432} w={L.w - 220} h={3} />
      {qty ? (
        <Label x={110} y={k.y + (k.lineH - qty.size) / 2} size={qty.size}>
          {qty.text}
        </Label>
      ) : (
        <Bar x={110} y={k.y + (k.lineH - 18) / 2} w={120} h={18} />
      )}
      <Typed b={k} />
      {box(L.w - 170, k.y + (k.lineH - 34) / 2, true)}
      {Array.from({ length: rows }, (_, i) => (
        <React.Fragment key={i}>
          <Rule x={110} y={tail + i * 62 - 14} w={L.w - 220} h={1.5} o={0.2} />
          <Bar
            x={110}
            y={tail + i * 62 + 8}
            w={90 + 50 * rnd(s.seed, 600 + i)}
            h={16}
          />
          <Bar
            x={330}
            y={tail + i * 62 + 8}
            w={360 + 360 * rnd(s.seed, 620 + i)}
            h={16}
          />
          {box(L.w - 170, tail + i * 62, rnd(s.seed, 640 + i) > 0.35)}
        </React.Fragment>
      ))}
    </Paper>
  );
};

// ---------------------------------------------------------------- boards: idea wall and review clippings

/** A cork board in a wooden frame, the page's size. */
const Board: React.FC<{
  L: PageLayout;
  children: React.ReactNode;
  seed: number;
}> = ({ L, children, seed }) => (
  <div
    style={{
      position: "relative",
      width: L.w,
      height: L.h,
      borderRadius: 10,
      border: "26px solid #5a3a22",
      boxSizing: "border-box",
      boxShadow:
        "inset 0 0 0 3px rgba(0,0,0,0.35), inset 0 10px 30px rgba(0,0,0,0.45), 0 30px 70px rgba(0,0,0,0.55)",
      overflow: "hidden",
      background: "#9a6b3f",
    }}
  >
    <TextureBackground kind="cork" variant={seed % 4} />
    <div style={{ position: "absolute", inset: -26 }}>{children}</div>
  </div>
);

/** Marker squiggles where a note's words would be (placeholder, not writing). */
const Scribble: React.FC<{ w: number; n: number; seed: number }> = ({
  w,
  n,
  seed,
}) => (
  <svg
    width={w}
    height={n * 40}
    style={{ position: "absolute", left: 30, top: 50 }}
  >
    {Array.from({ length: n }, (_, i) => {
      const len = w * (0.5 + 0.4 * rnd(seed, i)) - 60;
      let d = `M 0 ${20 + i * 40}`;
      for (let x = 0; x < len; x += 22) d += ` q 11 ${i % 2 ? -10 : 10} 22 0`;
      return (
        <path
          key={i}
          d={d}
          stroke="rgba(29,27,24,0.45)"
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
      );
    })}
  </svg>
);

const NOTE_COLOURS = ["#ffe45a", "#ffa654", "#fff07e", "#ff9fbd", "#9fe0c8"];

export const IdeasPage: React.FC<PageProps> = ({ scene: s, L }) => {
  const f = L.free!;
  const key = { left: 640, top: 300, width: 520, height: 520 };
  const spots = [
    [150, 150],
    [430, 120],
    [1230, 140],
    [1500, 200],
    [140, 560],
    [380, 640],
    [1260, 600],
    [1500, 640],
  ];
  return (
    <Board L={L} seed={s.seed}>
      {spots.map(([x, y], i) => {
        const c = NOTE_COLOURS[i % NOTE_COLOURS.length]!;
        const size = 250 + 30 * rnd(s.seed, 700 + i);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              background: c,
              backgroundImage: GRAIN,
              transform: `rotate(${(rnd(s.seed, 720 + i) * 2 - 1) * 6}deg)`,
              boxShadow: "6px 12px 18px rgba(0,0,0,0.4)",
            }}
          >
            <Scribble w={size - 30} n={3 + (i % 2)} seed={s.seed + i} />
            <Pin show={1} style={{ left: size / 2, top: 18 }} />
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          ...key,
          background: "#fff07e",
          backgroundImage: GRAIN,
          transform: `rotate(${(rnd(s.seed, 760) * 2 - 1) * 2}deg)`,
          boxShadow: "10px 18px 26px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: f.box.left - key.left,
            top: f.box.top - key.top,
            width: f.box.width,
            fontFamily: HAND,
            fontSize: f.size,
            lineHeight: 1.16,
            color: INK,
          }}
        >
          {f.lines.map((ln, i) => (
            <div key={i}>{ln}</div>
          ))}
        </div>
        <Pin show={1} style={{ left: key.width / 2, top: 22 }} />
      </div>
      <div
        style={{
          position: "absolute",
          left: L.w / 2 - 130,
          top: 46,
          transform: "rotate(-2deg)",
        }}
      >
        <Tape seed={s.seed}>
          <span style={{ fontFamily: HAND, fontSize: 52, color: INK }}>
            IDEAS
          </span>
        </Tape>
      </div>
    </Board>
  );
};

/** A newsprint clipping with torn edges. */
const Clipping: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  seed: number;
  children?: React.ReactNode;
}> = ({ x, y, w, h, rot, seed, children }) => {
  const pts: string[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++)
    pts.push(`${(i / n) * 100}% ${rnd(seed, i) * 1.4}%`);
  for (let i = 0; i <= n; i++)
    pts.push(`${100 - rnd(seed, 30 + i) * 1.2}% ${(i / n) * 100}%`);
  for (let i = n; i >= 0; i--)
    pts.push(`${(i / n) * 100}% ${100 - rnd(seed, 60 + i) * 1.6}%`);
  for (let i = n; i >= 0; i--)
    pts.push(`${rnd(seed, 90 + i) * 1.2}% ${(i / n) * 100}%`);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        transform: `rotate(${rot}deg)`,
        filter: "drop-shadow(6px 12px 14px rgba(0,0,0,0.45))",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#ece6d6",
          backgroundImage: GRAIN,
          clipPath: `polygon(${pts.join(", ")})`,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** A clipping's placeholder: a headline bar and two columns of text bars. */
const ClipBody: React.FC<{
  w: number;
  top: number;
  h: number;
  seed: number;
  head?: boolean;
}> = ({ w, top, h, seed, head = true }) => {
  const colW = (w - 90) / 2;
  const n = rowsBetween(top + (head ? 70 : 0), h - 30, 30);
  return (
    <>
      {head ? (
        <>
          <Bar x={30} y={top} w={w - 60} h={26} colour="rgba(29,27,24,0.55)" />
          <Bar
            x={30}
            y={top + 36}
            w={(w - 60) * 0.6}
            h={26}
            colour="rgba(29,27,24,0.55)"
          />
        </>
      ) : null}
      {[0, 1].map((c) =>
        Array.from({ length: n }, (_, i) => (
          <Bar
            key={`${c}${i}`}
            x={30 + c * (colW + 30)}
            y={top + (head ? 86 : 0) + i * 30}
            w={colW * (i === n - 1 ? 0.5 : 0.85 + 0.15 * rnd(seed, c * 40 + i))}
            h={10}
            colour="rgba(29,27,24,0.22)"
          />
        )),
      )}
    </>
  );
};

export const ReviewsPage: React.FC<PageProps> = ({ scene: s, L }) => {
  const f = L.free!;
  const key = { left: 560, top: 250, width: 660, height: 560 };
  const others = [
    { x: 110, y: 120, w: 400, h: 340 },
    { x: 130, y: 540, w: 380, h: 330 },
    { x: 1270, y: 110, w: 380, h: 360 },
    { x: 1260, y: 540, w: 400, h: 330 },
    { x: 640, y: 70, w: 360, h: 150 },
  ];
  const headH = f.lines.length * f.size * 1.12;
  return (
    <Board L={L} seed={s.seed + 1}>
      {others.map((o, i) => (
        <Clipping
          key={i}
          x={o.x}
          y={o.y}
          w={o.w}
          h={o.h}
          rot={(rnd(s.seed, 800 + i) * 2 - 1) * 5}
          seed={s.seed + i}
        >
          <ClipBody w={o.w} top={30} h={o.h} seed={s.seed + i} />
          <Pin show={1} style={{ left: o.w / 2, top: 14 }} />
        </Clipping>
      ))}
      <Clipping
        x={key.left}
        y={key.top}
        w={key.width}
        h={key.height}
        rot={-1.2}
        seed={s.seed + 9}
      >
        <Rule x={50} y={50} w={key.width - 100} h={3} o={0.6} />
        <div
          style={{
            position: "absolute",
            left: f.box.left - key.left,
            top: f.box.top - key.top,
            width: f.box.width,
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: f.size,
            lineHeight: 1.12,
            color: INK,
          }}
        >
          {f.lines.map((ln, i) => (
            <div key={i}>{ln}</div>
          ))}
        </div>
        <ClipBody
          w={key.width}
          top={f.box.top - key.top + headH + 36}
          h={key.height}
          seed={s.seed + 20}
          head={false}
        />
        {s.score ? (
          <div
            style={{
              position: "absolute",
              right: 30,
              bottom: 30,
              padding: "10px 18px",
              background: INK,
              color: "#f5f5f2",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 44,
              borderRadius: 10,
            }}
          >
            {s.score}
          </div>
        ) : null}
        <Pin show={1} style={{ left: key.width / 2, top: 18 }} />
      </Clipping>
      <div
        style={{
          position: "absolute",
          left: L.w / 2 - 170,
          top: 840,
          transform: "rotate(1.5deg)",
        }}
      >
        <Tape seed={s.seed + 3}>
          <span style={{ fontFamily: HAND, fontSize: 52, color: INK }}>
            REVIEWS
          </span>
        </Tape>
      </div>
    </Board>
  );
};

/** The page of each document kind. */
export const PAGES: Record<DocScene["kind"], React.FC<PageProps>> = {
  memo: MemoPage,
  press: PressPage,
  design: DesignPage,
  contract: ContractPage,
  schedule: SchedulePage,
  rota: RotaPage,
  budget: BudgetPage,
  manifest: ManifestPage,
  ideas: IdeasPage,
  reviews: ReviewsPage,
};

export { CH };
