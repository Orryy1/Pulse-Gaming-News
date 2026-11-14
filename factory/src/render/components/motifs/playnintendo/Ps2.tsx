// PlayStation 2 (2000-2006) homage: the boot sequence. Deep blue fog, translucent towers of light rising
// from a glossy floor, drifting motes, the camera gliding between them, then the heading resolving in
// clean light type. The styles stand a timeline or a figure on towers of the same light. Everything is
// projected by hand (a pinhole camera over a floor), so it is a pure function of the frame and variant.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring } from "remotion";
import { BODY } from "../../fonts.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import {
  countText,
  parseFigure,
  quantityRows,
} from "../../packs/data/figures.ts";
import type { MotifCardProps } from "../types.ts";
import { PulseBadge } from "../../packs/pulse/PulseBadge.tsx";
import {
  clamp,
  clean,
  easeInOut,
  fit,
  glowRoom,
  lineClamp,
  longestWord,
  metaLine,
  seeded,
  useCard,
} from "./shared.tsx";

type Cam = { x: number; y: number; z: number };
type Tower = {
  x: number;
  z: number;
  w: number;
  h: number;
  lit?: number;
  /** A phase when the tower pulses with light. */
  pulse?: number;
};
type Pt = [number, number];

const LIGHT = "#eef4ff";
const ICE = "#9cc3ff";
const SKY =
  "linear-gradient(180deg, #01030f 0%, #030b26 34%, #08205e 56%, #0d2f7e 61%, #041235 70%, #01040f 100%)";

const project =
  (cam: Cam, horizon: number, F: number) =>
  (x: number, y: number, z: number): Pt => {
    const rz = Math.max(0.05, z - cam.z);
    return [960 + (F * (x - cam.x)) / rz, horizon - (F * (y - cam.y)) / rz];
  };
const poly = (p: Pt[]) =>
  p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");

/** The towers as SVG polygons, far to near, each with its reflection in the floor. */
const Towers: React.FC<{
  towers: Tower[];
  cam: Cam;
  horizon: number;
  F?: number;
  id: string;
}> = ({ towers, cam, horizon, F = 900, id }) => {
  const P = project(cam, horizon, F);
  const list = towers
    .map((t) => ({ t, rz: t.z - t.w / 2 - cam.z }))
    .filter((o) => o.rz > 0.8 && o.t.h > 0.01)
    .sort((a, b) => b.rz - a.rz);
  const refl: React.ReactNode[] = [];
  const main: React.ReactNode[] = [];
  list.forEach(({ t, rz }, k) => {
    const x0 = t.x - t.w / 2;
    const x1 = t.x + t.w / 2;
    const z0 = t.z - t.w / 2;
    const z1 = t.z + t.w / 2;
    if (P(x0, 0, z0)[0] > 2100 || P(x1, 0, z0)[0] < -180) return;
    const fog = Math.max(0.08, Math.min(1, 1.25 - rz / 24));
    const lit = t.lit ?? 0;
    const faces = (h: number) => ({
      front: [P(x0, 0, z0), P(x1, 0, z0), P(x1, h, z0), P(x0, h, z0)],
      side:
        x0 > cam.x
          ? [P(x0, 0, z0), P(x0, 0, z1), P(x0, h, z1), P(x0, h, z0)]
          : x1 < cam.x
            ? [P(x1, 0, z0), P(x1, 0, z1), P(x1, h, z1), P(x1, h, z0)]
            : null,
    });
    const up = faces(t.h);
    const down = faces(-t.h * 0.85);
    refl.push(
      <g key={k} opacity={(0.2 + 0.25 * lit) * fog}>
        {down.side ? (
          <polygon points={poly(down.side)} fill={`url(#${id}r)`} />
        ) : null}
        <polygon points={poly(down.front)} fill={`url(#${id}r)`} />
      </g>,
    );
    const stroke = `rgba(${200 + 55 * lit},${226 + 29 * lit},255,${0.55 + 0.4 * lit})`;
    const sw = (rz < 8 ? 1.6 : 1.1) + lit * 1.4;
    main.push(
      <g key={k} opacity={fog}>
        {lit > 0 ? (
          <polygon
            points={poly(up.front)}
            fill="none"
            stroke={`rgba(140,190,255,${0.22 * lit})`}
            strokeWidth={22}
            strokeLinejoin="round"
          />
        ) : null}
        {up.side ? (
          <polygon
            points={poly(up.side)}
            fill={`url(#${id}s)`}
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
        ) : null}
        <polygon
          points={poly(up.front)}
          fill={`url(#${id}${lit > 0.5 ? "l" : "f"})`}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
        />
        {t.h < cam.y ? (
          <polygon
            points={poly([
              P(x0, t.h, z0),
              P(x1, t.h, z0),
              P(x1, t.h, z1),
              P(x0, t.h, z1),
            ])}
            fill={`rgba(220,236,255,${0.45 + 0.4 * lit})`}
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
        ) : null}
      </g>,
    );
  });
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(200,225,255)" stopOpacity={0.5} />
          <stop offset="0.35" stopColor="rgb(130,175,255)" stopOpacity={0.22} />
          <stop offset="1" stopColor="rgb(70,120,230)" stopOpacity={0.12} />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(235,245,255)" stopOpacity={0.85} />
          <stop offset="0.4" stopColor="rgb(160,200,255)" stopOpacity={0.45} />
          <stop offset="1" stopColor="rgb(90,140,240)" stopOpacity={0.25} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(160,200,255)" stopOpacity={0.3} />
          <stop offset="1" stopColor="rgb(50,90,200)" stopOpacity={0.06} />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(140,185,255)" stopOpacity={0.6} />
          <stop offset="1" stopColor="rgb(40,80,190)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {refl}
      {main}
    </svg>
  );
};

/** Motes of light drifting up through the field, near ones larger and faster across the frame. */
const Motes: React.FC<{
  seed: number;
  cam: Cam;
  horizon: number;
  frame: number;
  count?: number;
}> = ({ seed, cam, horizon, frame, count = 38 }) => {
  const r = seeded(seed);
  const P = project(cam, horizon, 900);
  const dots = Array.from({ length: count }, (_, i) => {
    const x = (r() - 0.5) * 18;
    const y0 = 0.2 + r() * 4.6;
    const z = 2.5 + r() * 24;
    const sp = 0.006 + r() * 0.01;
    const ph = r() * 6.28;
    const y = ((y0 + frame * sp) % 5.2) + 0.1;
    const [sx, sy] = P(x + Math.sin(frame * 0.03 + ph) * 0.15, y, z);
    const rz = z - cam.z;
    const size = Math.max(1.5, Math.min(7, 40 / rz));
    const tw = 0.55 + 0.45 * Math.sin(frame * 0.12 + ph * 3);
    return {
      sx,
      sy,
      size,
      a: Math.max(0.1, Math.min(1, 1.3 - rz / 22)) * tw,
      i,
    };
  });
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <radialGradient id={`mote${seed}`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity={1} />
          <stop offset="0.35" stopColor="#bcd6ff" stopOpacity={0.7} />
          <stop offset="1" stopColor="#6aa0ff" stopOpacity={0} />
        </radialGradient>
      </defs>
      {dots.map((d) =>
        d.sx > -20 && d.sx < 1940 ? (
          <circle
            key={d.i}
            cx={d.sx}
            cy={d.sy}
            r={d.size * 2.2}
            fill={`url(#mote${seed})`}
            opacity={d.a}
          />
        ) : null,
      )}
    </svg>
  );
};

/** Fog and haze over the field: the horizon glow, a band of mist and a vignette. */
const Haze: React.FC<{ horizon: number }> = ({ horizon }) => {
  const h = (horizon / 1080) * 100;
  return (
    <>
      <AbsoluteFill
        style={{
          background: `radial-gradient(55% 22% at 50% ${h}%, rgba(90,150,255,0.32) 0%, rgba(40,90,220,0.12) 55%, transparent 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, transparent ${h - 16}%, rgba(30,70,180,0.22) ${h - 3}%, rgba(20,50,140,0.26) ${h + 2}%, transparent ${h + 14}%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(0,2,10,0.75) 100%)",
        }}
      />
    </>
  );
};

/** A seeded field of towers: taller toward the back and the middle, a clear lane near the camera. */
function field(
  seed: number,
  opts: { lane?: number; zMin?: number } = {},
): Tower[] {
  const r = seeded(seed * 53 + 9);
  const out: Tower[] = [];
  const lane = opts.lane ?? 1.6;
  const zMin = opts.zMin ?? 4;
  for (let gz = 0; gz < 11; gz++)
    for (let gx = -7; gx <= 7; gx++) {
      if (r() > 0.42) continue;
      const z = zMin + gz * 2.5 + (r() - 0.5) * 1.4;
      const x = gx * 1.55 + (r() - 0.5) * 0.9;
      if (Math.abs(x) < lane && z < 11) continue;
      const w = 0.36 + r() * 0.4;
      const centre = 1 - Math.min(1, Math.abs(x) / 11);
      const h = 0.75 + r() ** 1.3 * (1.5 + gz * 0.4 + centre * 2.4);
      // About one tower in five pulses with light, the way the boot towers glowed in turn.
      const pulse = r() < 0.22 ? r() * 6.28 : undefined;
      out.push({ x, z, w, h, pulse });
    }
  return out;
}

/** A tower's light now: pulsing ones swell and fade, the rest stay glass. */
const glowOf = (t: Tower, frame: number) =>
  t.pulse === undefined
    ? (t.lit ?? 0)
    : Math.max(t.lit ?? 0, 0.32 + 0.3 * Math.sin(frame * 0.085 + t.pulse));

const rise = (frame: number, fps: number, delay: number) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 22, stiffness: 70, mass: 1 },
  });

// ---------------------------------------------------------------------------------------------------
// The card.

const BootCard: React.FC<MotifCardProps> = (props) => {
  const { frame, fps, len, fade } = useCard(props.frames);
  const variant = props.variant ?? 0;
  const heading = clean(props.heading);
  const kicker = clean(props.kicker);
  const meta = metaLine(props);
  const pic = props.pictures.find(Boolean);
  const t = easeInOut(Math.min(1, frame / len));
  const cam: Cam = {
    x: -0.7 + 1.4 * t,
    y: 1.45 - 0.15 * t,
    z: -2.2 + 3.4 * t,
  };
  const HORIZON = 700;
  const base = React.useMemo(() => field(variant), [variant]);
  const towers = base.map((tw, i) => ({
    ...tw,
    h: tw.h * rise(frame, fps, (tw.z - 4) * 0.45 + (i % 5) * 1.2),
    lit: glowOf(tw, frame),
  }));
  const resolve = interpolate(frame, [12, 34], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const kickIn = interpolate(frame, [8, 20], [0, 1], clamp);
  const metaIn = interpolate(frame, [28, 40], [0, 1], clamp);
  const size = fit(heading, 1480, 2, [104, 92, 80, 70, 60], 0.56);
  return (
    <AbsoluteFill
      style={{ background: SKY, opacity: fade, overflow: "hidden" }}
    >
      {pic ? (
        <AbsoluteFill
          style={{ opacity: 0.16 * interpolate(frame, [0, 30], [0, 1], clamp) }}
        >
          <Img
            src={pic}
            style={{
              width: "100%",
              height: "62%",
              objectFit: "cover",
              transform: `scale(${1.08 + 0.05 * t})`,
              mixBlendMode: "screen",
              filter: "grayscale(1)",
              WebkitMaskImage:
                "linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%)",
              maskImage:
                "linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%)",
            }}
          />
          <AbsoluteFill
            style={{
              background: "rgba(8,32,110,0.55)",
              mixBlendMode: "multiply",
            }}
          />
        </AbsoluteFill>
      ) : null}
      <Towers
        towers={towers}
        cam={cam}
        horizon={HORIZON}
        id={`p2c${Math.abs(variant)}`}
      />
      <Haze horizon={HORIZON} />
      <Motes
        seed={Math.abs(variant) + 3}
        cam={cam}
        horizon={HORIZON}
        frame={frame}
      />
      {/* A soft dark pool behind the type so it reads over any tower. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(48% 26% at 50% 40%, rgba(1,4,18,0.62) 0%, rgba(1,4,18,0.3) 55%, transparent 100%)",
          opacity: resolve,
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: 220,
        }}
      >
        <div style={{ width: 1560, textAlign: "center" }}>
          {kicker ? (
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 600,
                fontSize: 28,
                letterSpacing: 14 - 4 * kickIn,
                color: ICE,
                textTransform: "uppercase",
                opacity: kickIn,
                marginBottom: 22,
              }}
            >
              {kicker}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: size,
              lineHeight: 1.08,
              letterSpacing: `${0.32 * (1 - resolve) - 0.01}em`,
              color: LIGHT,
              opacity: resolve,
              filter: resolve < 1 ? `blur(${(1 - resolve) * 14}px)` : undefined,
              textShadow:
                "0 0 28px rgba(110,165,255,0.85), 0 0 4px rgba(255,255,255,0.6)",
              transform: `scale(${1.06 - 0.06 * resolve})`,
              ...lineClamp(2),
              ...glowRoom(36),
            }}
          >
            {heading}
          </div>
          {meta ? (
            <div
              style={{
                marginTop: 26,
                fontFamily: BODY,
                fontWeight: 600,
                fontSize: 32,
                letterSpacing: 4,
                color: ICE,
                opacity: metaIn * 0.95,
                ...lineClamp(1),
              }}
            >
              {meta}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
      {/* The Pulse badge resolving low on the floor, where a boot sequence shows the console's name. */}
      <PulseBadge
        size={44}
        colour={LIGHT}
        opacity={resolve * 0.9}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 92,
          justifyContent: "center",
          filter: "drop-shadow(0 0 14px rgba(110,165,255,0.85))",
        }}
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// Styles: a timeline as a row of towers rising in turn, a figure as one tower of light.

type Row = { when: string; what: string };

function timelineRows(items: string[]): Row[] {
  return items
    .map(clean)
    .map((x) => {
      const i = x.indexOf(":");
      if (i <= 0) return undefined;
      const when = x.slice(0, i).trim();
      const what = x.slice(i + 1).trim();
      return /\d/.test(when) && what ? { when, what } : undefined;
    })
    .filter((x): x is Row => Boolean(x));
}

export function fitsTowers(g: MomentGraphic): boolean {
  const rows = timelineRows(g.items);
  return (
    rows.length >= 2 &&
    rows.length <= 5 &&
    rows.length === g.items.filter((x) => x.trim()).length &&
    rows.every(
      (r) =>
        r.when.length <= 14 && r.what.length <= 44 && longestWord(r.what) <= 16,
    ) &&
    clean(g.primary).length <= 40
  );
}

const Heading: React.FC<{ text: string; frame: number }> = ({
  text,
  frame,
}) => {
  const a = interpolate(frame, [4, 18], [0, 1], clamp);
  if (!text) return null;
  return (
    <div style={{ position: "absolute", left: 96, top: 136, right: 96 }}>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: 50,
          lineHeight: 1.1,
          color: LIGHT,
          letterSpacing: `${0.12 * (1 - a) + 0.01}em`,
          opacity: a,
          textShadow: "0 0 22px rgba(110,165,255,0.8)",
          ...lineClamp(1),
          ...glowRoom(30),
        }}
      >
        {text}
      </div>
      <div
        style={{
          marginTop: 14,
          height: 3,
          width: 160 * a,
          background: `linear-gradient(90deg, ${ICE}, transparent)`,
        }}
      />
    </div>
  );
};

/** One labelled tower in a row: its words on top (given the rise, 0..1), its line at the base, its height 0..1. */
type Cell = {
  top: (p: number) => string;
  topLen: number;
  bottom: string;
  height: number;
};

/** A row of towers rising in turn, each lighting as it lands, its label on its cap and its line at its foot. */
const TowerRow: React.FC<{
  len: number;
  variant: number;
  heading: string;
  cells: Cell[];
}> = ({ len, variant, heading, cells }) => {
  const { frame, fps, dim, visible, showFor } = useStage(len, 210);
  if (!visible || cells.length < 2) return null;
  const n = cells.length;
  const F = 900;
  const Z = 9;
  const HORIZON = 600;
  const t = Math.min(1, frame / Math.max(1, showFor));
  const cam: Cam = { x: -0.25 + 0.5 * easeInOut(t), y: 1.6, z: 0 };
  const P = project(cam, HORIZON, F);
  const span = Math.min(380, 1728 / n);
  const unit = F / Z; // px per world unit at the row's depth
  const spacing = span / unit;
  const w = Math.min(1.5, (span * 0.4) / unit);
  const startAt = (i: number) => 8 + i * 12;
  const rises = cells.map((_, i) => rise(frame, fps, startAt(i)));
  const row: Tower[] = cells.map((c, i) => ({
    x: (i - (n - 1) / 2) * spacing,
    z: Z + w / 2,
    w,
    h: (1.2 + 3.4 * Math.max(0.06, Math.min(1, c.height))) * rises[i]!,
    lit: interpolate(frame, [startAt(i) + 4, startAt(i) + 14], [0, 1], clamp),
  }));
  const back = field(variant + 40, { lane: 0, zMin: 17 }).map((tw, i) => ({
    ...tw,
    h: tw.h * 0.9 * rise(frame, fps, (i % 7) * 1.5),
    lit: glowOf(tw, frame) * 0.7,
  }));
  const textSize = Math.min(
    34,
    ...cells.map((c) => fit(c.bottom, span - 24, 2, [34, 30], 0.56)),
  );
  return (
    <AbsoluteFill style={{ opacity: dim, background: SKY, overflow: "hidden" }}>
      <Towers
        towers={[...back, ...row]}
        cam={cam}
        horizon={HORIZON}
        F={F}
        id={`p2t${Math.abs(variant)}`}
      />
      <Haze horizon={HORIZON} />
      <Motes
        seed={Math.abs(variant) + 11}
        cam={cam}
        horizon={HORIZON}
        frame={frame}
        count={26}
      />
      <Heading text={heading} frame={frame} />
      {cells.map((c, i) => {
        const tw = row[i]!;
        const [cx, top] = P(tw.x, tw.h, tw.z - tw.w / 2);
        const [, base] = P(tw.x, 0, tw.z - tw.w / 2);
        const a = interpolate(
          frame,
          [startAt(i) + 6, startAt(i) + 16],
          [0, 1],
          clamp,
        );
        const capSize = c.topLen > 10 ? 36 : c.topLen > 7 ? 44 : 54;
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: cx - span / 2 - 20,
                width: span + 40,
                top: top - 84,
                textAlign: "center",
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: capSize,
                lineHeight: "70px",
                color: LIGHT,
                opacity: a,
                textShadow: "0 0 24px rgba(120,175,255,0.95)",
                transform: `translateY(${(1 - a) * 14}px)`,
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {c.top(rises[i]!)}
            </div>
            <div
              style={{
                position: "absolute",
                left: cx - span / 2 + 8,
                width: span - 16,
                top: base + 26,
                textAlign: "center",
                fontFamily: BODY,
                fontWeight: 600,
                fontSize: textSize,
                lineHeight: 1.15,
                color: LIGHT,
                opacity: a,
                textShadow: "0 2px 12px rgba(0,0,0,0.9)",
                ...lineClamp(2),
              }}
            >
              {c.bottom}
            </div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

/** A timeline: the towers step up in time order, the year on each cap and what happened at its foot. */
const TimelineTowers: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const rows = timelineRows(g.items).slice(0, 5);
  const n = rows.length;
  return (
    <TowerRow
      len={len}
      variant={variant}
      heading={clean(g.primary)}
      cells={rows.map((r, i) => ({
        top: () => r.when,
        topLen: r.when.length,
        bottom: r.what,
        height: 0.2 + (0.8 * i) / Math.max(1, n - 1),
      }))}
    />
  );
};

export function fitsSkyline(g: MomentGraphic): boolean {
  const rows = quantityRows(g.items);
  return (
    rows.length >= 2 &&
    rows.length <= 5 &&
    rows.length === g.items.filter((x) => x.trim()).length &&
    rows.every(
      (r) =>
        r.label.length <= 30 &&
        longestWord(r.label) <= 16 &&
        r.fig.text.length <= 14,
    ) &&
    clean(g.primary).length <= 40
  );
}

/** Figures as towers: each tower as tall as its share of the largest, the figure counting up on its cap. */
const Skyline: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const rows = quantityRows(g.items).slice(0, 5);
  const max = Math.max(...rows.map((r) => r.fig.scaled), 1e-9);
  return (
    <TowerRow
      len={len}
      variant={variant}
      heading={clean(g.primary)}
      cells={rows.map((r) => ({
        top: (p: number) => countText(r.fig, p),
        topLen: r.fig.text.length,
        bottom: r.label,
        height: r.fig.scaled / max,
      }))}
    />
  );
};
export function fitsPillar(g: MomentGraphic): boolean {
  const primary = clean(g.primary);
  const f = parseFigure(primary);
  return (
    Boolean(f && !f.year) &&
    primary.length <= 18 &&
    clean(g.secondary).length <= 56
  );
}

const Pillar: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const { frame, fps, dim, visible, showFor } = useStage(len, 170);
  const primary = clean(g.primary);
  const fig = parseFigure(primary);
  if (!visible || !fig) return null;
  const F = 900;
  const HORIZON = 640;
  const t = Math.min(1, frame / Math.max(1, showFor));
  const cam: Cam = { x: 0.35 - 0.7 * easeInOut(t), y: 1.5, z: -0.4 + 0.8 * t };
  const P = project(cam, HORIZON, F);
  const grow = spring({
    frame: frame - 6,
    fps,
    config: { damping: 26, stiffness: 60, mass: 1 },
  });
  const main: Tower = {
    x: 0,
    z: 8.4,
    w: 2.3,
    h: 3.6 * grow,
    lit: Math.min(1, grow * 1.2),
  };
  const back = field(variant + 70, { lane: 2.2, zMin: 9 }).map((tw) => ({
    ...tw,
    h: tw.h * 0.8,
  }));
  const backNow = back.map((tw, i) => ({
    ...tw,
    h: tw.h * rise(frame, fps, (i % 6) * 1.6),
    lit: glowOf(tw, frame) * 0.7,
  }));
  const [cx, top] = P(main.x, main.h, main.z - main.w / 2);
  const [, base] = P(main.x, 0, main.z - main.w / 2);
  const shown = countText(
    fig,
    interpolate(frame, [8, 34], [0, 1], { ...clamp, easing: easeInOut }),
  );
  const size = primary.length > 12 ? 120 : primary.length > 8 ? 150 : 180;
  const label = clean(g.secondary);
  const labelIn = interpolate(frame, [26, 38], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ opacity: dim, background: SKY, overflow: "hidden" }}>
      <Towers
        towers={[...backNow, main]}
        cam={cam}
        horizon={HORIZON}
        F={F}
        id={`p2p${Math.abs(variant)}`}
      />
      <Haze horizon={HORIZON} />
      <Motes
        seed={Math.abs(variant) + 21}
        cam={cam}
        horizon={HORIZON}
        frame={frame}
        count={30}
      />
      <div
        style={{
          position: "absolute",
          left: cx - 900,
          width: 1800,
          top: Math.max(140, top - size * 1.12 - 16),
          textAlign: "center",
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.1,
          color: LIGHT,
          letterSpacing: -1,
          textShadow:
            "0 0 40px rgba(110,165,255,0.95), 0 0 6px rgba(255,255,255,0.7)",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
          opacity: interpolate(frame, [4, 12], [0, 1], clamp),
        }}
      >
        {shown}
      </div>
      {label ? (
        <div
          style={{
            position: "absolute",
            left: 260,
            right: 260,
            top: base + 34,
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 38,
            letterSpacing: 2,
            color: LIGHT,
            opacity: labelIn,
            textShadow: "0 2px 14px rgba(0,0,0,0.9)",
            transform: `translateY(${(1 - labelIn) * 12}px)`,
            ...lineClamp(2),
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const PS2_CARD = BootCard;
export const PS2_STYLES: Record<string, GfxStyle> = {
  /** timeline: primary a heading, items 2-5 "year: what happened" rows; each row a tower rising in turn. */
  Towers: {
    kind: "timeline",
    component: TimelineTowers,
    fits: fitsTowers,
    sound: "pop",
  },
  /** bars: primary a heading, items 2-5 "label: figure" rows; each a tower as tall as its figure, counting up. */
  Skyline: {
    kind: "bars",
    component: Skyline,
    fits: fitsSkyline,
    sound: "pop",
  },
  /** stat: primary the figure (18 characters at most, not a bare year), secondary its label; one tower of light. */
  Pillar: { kind: "stat", component: Pillar, fits: fitsPillar, sound: "pop" },
};
