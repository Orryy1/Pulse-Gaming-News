// Graphic pack: Data. Every style takes GfxProps (./types.ts); STYLES lists them by name.
// Numbers made physical, the explainer-channel way: bars that grow while their figures count, an arcade
// high-score table, a donut of shares, a mechanical odometer and a critic's gauge. Every figure, word and
// name is read from g as written (./data/figures.ts) and lands exactly as written; the only fixed words
// are generic labels (HIGH SCORES, 1ST, SCORE). Everything is a pure function of the frame and variant.
import React from "react";
import { Easing, interpolate, spring } from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { SPRING } from "../../motion.ts";
import { Label, Stage, useStage } from "../DocGraphics.tsx";
import type { MomentGraphic } from "../LongMoments.tsx";
import type { GfxProps, GfxStyle } from "./types.ts";
import {
  clean,
  countText,
  parseFigure,
  rankedRows,
  reviewRows,
  seeded,
  shareRows,
  type Row,
} from "./data/figures.ts";
import { pixelNormal, pixelPath, pixelReady } from "./data/pixelFont.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const TAU = Math.PI * 2;

/** The safe area: clear of the brand bar on top (130) and the bottom margin (72), 96 at the sides. */
const Safe: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      position: "absolute",
      left: 96,
      right: 96,
      top: 130,
      bottom: 72,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      ...style,
    }}
  >
    {children}
  </div>
);

/** Animation pace: full speed for a normal hold, quicker when the moment is short. */
const paceFor = (showFor: number) =>
  Math.max(0.5, Math.min(1, (showFor - 30) / 150));

/** A slow push-in with a little sideways drift, its direction seeded by the variant. */
function cameraDrift(frame: number, showFor: number, variant: number): string {
  const t = Math.min(1, Math.max(0, frame / showFor));
  const dx = (seeded(variant, 1) - 0.5) * 36 * t;
  const dy = (seeded(variant, 2) - 0.5) * 14 * t;
  return `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${(1 + 0.03 * t).toFixed(4)})`;
}

/** Display headline size by length, so a long heading still sits on one or two lines. */
const titleSize = (t: string) =>
  t.length <= 16 ? 100 : t.length <= 26 ? 84 : t.length <= 38 ? 68 : 56;

const SHADOW = "0 6px 30px rgba(0,0,0,0.55)";

/** Text cut at a word to at most n characters, with an ellipsis (no CSS clipping, so shadows stay soft). */
const cut = (t: string, n: number) => {
  if (t.length <= n) return t;
  const head = t.slice(0, n - 3);
  const at = head.lastIndexOf(" ");
  return `${(at > n * 0.6 ? head.slice(0, at) : head).replace(/[\s,;:.-]+$/, "")}...`;
};

/** The amber kicker (secondary) over a display headline (primary), rising through a mask. */
const Heading: React.FC<{
  title: string;
  kicker: string;
  frame: number;
  fps: number;
  size?: number;
  align?: "left" | "center";
  /** Characters the headline may take (two lines at its size), and the kicker. */
  max?: number;
}> = ({
  title: fullTitle,
  kicker: fullKicker,
  frame,
  fps,
  size,
  align = "left",
  max = 90,
}) => {
  const head = spring({ frame: frame - 2, fps, config: SPRING.ENTER });
  const kick = spring({ frame: frame - 6, fps, config: SPRING.ENTER });
  const rule = interpolate(frame, [0, 14], [0, 1], {
    ...clamp,
    easing: EASE_OUT,
  });
  const title = cut(fullTitle, max);
  const kicker = cut(fullKicker, 52);
  if (!title && !kicker) return null;
  return (
    <div style={{ textAlign: align }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          justifyContent: align === "center" ? "center" : "flex-start",
          marginBottom: title ? 12 : 0,
        }}
      >
        <div
          style={{
            width: 64 * rule,
            height: 6,
            background: COLOUR.amber,
            borderRadius: 3,
            flex: "none",
          }}
        />
        {kicker ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: kicker.length > 34 ? 24 : 28,
              letterSpacing: 4,
              color: COLOUR.amber,
              textTransform: "uppercase",
              opacity: kick,
              transform: `translateX(${(1 - kick) * -24}px)`,
              whiteSpace: "nowrap",
              textShadow: SHADOW,
            }}
          >
            {kicker}
          </div>
        ) : null}
      </div>
      {title ? (
        <div
          style={{
            // Masked only while it rises, so the settled headline's shadow is never cut off.
            clipPath:
              head > 0.995 ? undefined : "inset(-60px -80px -8px -80px)",
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: size ?? titleSize(title),
              lineHeight: 1.04,
              color: COLOUR.paper,
              textTransform: "uppercase",
              transform: `translateY(${(1 - head) * 105}%)`,
              textShadow: "0 6px 26px rgba(0,0,0,0.5)",
            }}
          >
            {title}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * A marker pen loop around a figure, drawn on like a stroke: a slightly wobbly ellipse that overshoots
 * its start, the way an editor circles the number that matters. It fills its parent's box plus a margin,
 * so it fits the figure as rendered; it draws on by growing its point list (no dash maths).
 */
const MarkerLoop: React.FC<{
  p: number;
  seed: number;
  colour?: string;
}> = ({ p, seed, colour = COLOUR.amber }) => {
  if (p <= 0) return null;
  const N = 64;
  const turns = 1.14;
  const a0 = -2.3 + seeded(seed, 5) * 0.6;
  const at = (i: number) => {
    const t = a0 + (i / N) * turns * TAU;
    const wob =
      1 +
      0.035 * Math.sin(i * 0.7 + seed * 2.1) +
      0.06 * (i / N) +
      0.015 * (seeded(seed, 20 + Math.floor(i)) - 0.5);
    return `${(50 + 50 * wob * Math.cos(t)).toFixed(2)} ${(50 + 50 * wob * Math.sin(t) - 4 * Math.sin(t * 0.5)).toFixed(2)}`;
  };
  const end = Math.min(1, p) * N;
  const pts: string[] = [];
  for (let i = 0; i <= Math.floor(end); i++) pts.push(at(i));
  if (end % 1 > 0) pts.push(at(end));
  if (pts.length < 2) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: -26,
        right: -26,
        top: -20,
        bottom: -22,
        transform: `rotate(${-3 + seeded(seed, 6) * 4}deg)`,
        pointerEvents: "none",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}
      >
        <path
          d={`M${pts.join("L")}`}
          fill="none"
          stroke={colour}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* Bars: horizontal bars growing in turn, figures counting up, the largest in amber.                 */
/* ------------------------------------------------------------------------------------------------ */

const Bars: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 200);
  const rows = rankedRows(g.items);
  if (!visible || rows.length < 2) return null;
  const k = paceFor(showFor);
  const n = rows.length;
  const title = clean(g.primary);
  const kicker = clean(g.secondary);
  const W = 1560;
  const rowH = Math.round(Math.min(144, 610 / n));
  const labelFs = Math.round(Math.max(30, Math.min(38, rowH * 0.3)));
  const barH = Math.round(Math.max(34, Math.min(52, rowH * 0.4)));
  const valFs = Math.round(barH * 1.3);
  const rankW = 100;
  const longest = Math.max(...rows.map((r) => r.fig.text.length));
  const valueRoom = Math.min(640, Math.round(longest * valFs * 0.5 + 40));
  const barMax = W - rankW - valueRoom;
  const max = rows[0]!.fig.scaled;
  const grid = interpolate(frame, [8, 34], [0, 1], {
    ...clamp,
    easing: EASE_OUT,
  });
  const step = Math.max(6, Math.min(11, 44 / n));
  const startOf = (i: number) => (12 + i * step) * k;
  const growFor = 30 * k;
  const radius = variant % 2 ? 4 : barH / 2;
  const loopAt = startOf(n - 1) + growFor + 6 * k;
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <Safe>
        <div
          style={{ width: W, transform: cameraDrift(frame, showFor, variant) }}
        >
          <Heading title={title} kicker={kicker} frame={frame} fps={fps} />
          <div
            style={{
              position: "relative",
              marginTop: title || kicker ? 40 : 0,
            }}
          >
            {/* The chart's frame: an axis at the bars' root and faint quarter lines. */}
            {[0, 0.25, 0.5, 0.75, 1].map((q) => (
              <div
                key={q}
                style={{
                  position: "absolute",
                  left: rankW + barMax * q - (q === 0 ? 1 : 0),
                  top: 0,
                  bottom: 0,
                  width: q === 0 ? 3 : 1,
                  background:
                    q === 0
                      ? "rgba(245,245,242,0.35)"
                      : "rgba(245,245,242,0.09)",
                  transform: `scaleY(${grid})`,
                  transformOrigin: "top",
                }}
              />
            ))}
            {rows.map((r, i) => {
              const s0 = startOf(i);
              const inP = spring({
                frame: frame - s0,
                fps,
                config: SPRING.ENTER,
              });
              const p = interpolate(frame, [s0 + 2, s0 + 2 + growFor], [0, 1], {
                ...clamp,
                easing: EASE_OUT,
              });
              const share = Math.max(0.012, r.fig.scaled / max);
              const top = i === 0;
              const w = Math.max(0, barMax * share * p);
              const sweep = interpolate(
                frame,
                [s0 + growFor, s0 + growFor + 28],
                [-0.3, 1.3],
                clamp,
              );
              const land = spring({
                frame: frame - (s0 + growFor * 0.7),
                fps,
                config: SPRING.POP,
              });
              return (
                <div
                  key={i}
                  style={{
                    position: "relative",
                    height: rowH,
                    display: "flex",
                    alignItems: "flex-end",
                    paddingBottom: Math.round(rowH * 0.17),
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      width: rankW,
                      flex: "none",
                      paddingLeft: 4,
                      fontFamily: DISPLAY,
                      fontSize: Math.round(barH * 0.95),
                      lineHeight: `${barH}px`,
                      color: top ? COLOUR.amber : "rgba(245,245,242,0.5)",
                      opacity: inP,
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingLeft: 18 }}>
                    <div
                      style={{
                        fontFamily: BODY,
                        fontWeight: 800,
                        fontSize: labelFs,
                        lineHeight: 1.1,
                        color: COLOUR.paper,
                        whiteSpace: "nowrap",
                        marginBottom: 7,
                        opacity: inP,
                        transform: `translateX(${(1 - inP) * -30}px)`,
                        textShadow: SHADOW,
                      }}
                    >
                      {cut(
                        r.label,
                        Math.floor((W - rankW - 30) / (labelFs * 0.6)),
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        height: barH,
                        marginLeft: -18,
                      }}
                    >
                      <div
                        style={{
                          position: "relative",
                          width: w,
                          height: barH,
                          borderRadius: `0 ${radius}px ${radius}px 0`,
                          overflow: "hidden",
                          background: top
                            ? `linear-gradient(90deg, #D9500E 0%, ${COLOUR.amber} 55%, #FF8B4A 100%)`
                            : "linear-gradient(90deg, rgba(150,150,160,0.55), rgba(196,196,204,0.78))",
                          boxShadow: top
                            ? "0 12px 36px rgba(255,107,26,0.35), inset 0 3px 0 rgba(255,255,255,0.32), inset 0 -3px 0 rgba(0,0,0,0.18)"
                            : "inset 0 2px 0 rgba(255,255,255,0.22), 0 8px 24px rgba(0,0,0,0.3)",
                        }}
                      >
                        {top ? (
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              background: `linear-gradient(100deg, transparent ${sweep * 100 - 16}%, rgba(255,255,255,0.5) ${sweep * 100}%, transparent ${sweep * 100 + 16}%)`,
                            }}
                          />
                        ) : null}
                      </div>
                      <div
                        style={{
                          position: "relative",
                          marginLeft: 22,
                          fontFamily: DISPLAY,
                          fontSize: top ? valFs : Math.round(valFs * 0.84),
                          lineHeight: 1,
                          color: top ? COLOUR.amber : "rgba(245,245,242,0.92)",
                          whiteSpace: "nowrap",
                          opacity: Math.min(1, p * 3),
                          transform: `scale(${1 + 0.08 * land * (1 - land) * 4})`,
                          transformOrigin: "left center",
                          textShadow: SHADOW,
                        }}
                      >
                        {countText(r.fig, p)}
                        {top ? (
                          <MarkerLoop
                            p={interpolate(
                              frame,
                              [loopAt, loopAt + 16 * k],
                              [0, 1],
                              { ...clamp, easing: Easing.inOut(Easing.quad) },
                            )}
                            seed={variant}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Safe>
    </Stage>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* ArcadeScores: the same rows as a CRT high-score table in a bitmap font.                           */
/* ------------------------------------------------------------------------------------------------ */

const ARCADE = [
  "#FF6B1A",
  "#5EE7FF",
  "#FFE14D",
  "#FF6FD8",
  "#7CFF8B",
  "#F5F5F2",
];
const ORDINAL = ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH"];
const NAME_MAX = 26;

/** A line of bitmap text with a phosphor glow (two soft strokes under the dots, no filters). */
const Pix: React.FC<{
  text: string;
  u: number;
  colour: string;
  gradient?: { id: string; from: string; to: string };
}> = ({ text, u, colour, gradient }) => {
  const { d, w } = pixelPath(text);
  if (!w || !d) return <div style={{ height: 7 * u }} />;
  return (
    <svg
      width={w * u}
      height={7 * u}
      viewBox={`0 0 ${w} 7`}
      style={{ display: "block", overflow: "visible" }}
    >
      {gradient ? (
        <defs>
          <linearGradient id={gradient.id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={gradient.from} />
            <stop offset="1" stopColor={gradient.to} />
          </linearGradient>
        </defs>
      ) : null}
      <path
        d={d}
        fill="none"
        stroke={colour}
        strokeWidth={2.6}
        strokeOpacity={0.09}
        strokeLinejoin="round"
      />
      <path
        d={d}
        fill={gradient ? `url(#${gradient.id})` : colour}
        stroke={colour}
        strokeWidth={0.8}
        strokeOpacity={0.3}
        strokeLinejoin="round"
      />
    </svg>
  );
};

const shortName = (t: string) =>
  t.length > NAME_MAX ? `${t.slice(0, NAME_MAX - 3).trimEnd()}...` : t;

/** Rows the table can draw: ranked rows whose label and figure the bitmap font has glyphs for. */
function arcadeRows(g: MomentGraphic): Row[] {
  const rows = rankedRows(g.items);
  return rows.every((r) => pixelReady(r.label) && pixelReady(r.fig.text))
    ? rows
    : [];
}

const ArcadeScores: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 200);
  const rows = arcadeRows(g);
  if (!visible || rows.length < 2) return null;
  const k = paceFor(showFor);
  const n = rows.length;
  const sub = clean(g.primary);
  const unit = clean(g.secondary);
  const scoreHead =
    unit && unit.length <= 14 && pixelReady(unit) ? unit : "SCORE";
  const scores = rows.map((r) => pixelNormal(r.fig.text));
  const names = rows.map((r) => shortName(r.label));
  const scoreChars = Math.max(scoreHead.length, ...scores.map((s) => s.length));
  const nameChars = Math.max(4, ...names.map((s) => s.length));
  const total = 3 + 3 + scoreChars + 3 + nameChars;
  const PW = 1560;
  const PH = 820;
  const subU =
    sub && pixelReady(sub) ? Math.min(5.4, 1300 / (sub.length * 6)) : 0;
  const topBlock = 7 * 10 + 26 + (subU ? 7 * subU + 34 : 10) + 40;
  const budget = PH - 2 * 48 - topBlock - 60;
  const u = Math.max(
    3.6,
    Math.min(8.5, 1380 / (total * 6), budget / (13.4 * (n + 1))),
  );
  const cell = 6 * u;
  const lineGap = 7 * u * 0.95;
  const palette = [
    ARCADE[0]!,
    ...ARCADE.slice(1).map((_, i, a) => a[(i + variant) % a.length]!),
  ];
  // The set powers on: a bright line opens, then the picture; at the end it collapses back to a line.
  const sx = Math.min(
    interpolate(frame, [3, 9], [0.02, 1], { ...clamp, easing: EASE_OUT }),
    interpolate(frame, [showFor - 8, showFor - 2], [1, 0.02], clamp),
  );
  const sy = Math.min(
    interpolate(frame, [8, 16], [0.006, 1], { ...clamp, easing: EASE_OUT }),
    interpolate(frame, [showFor - 14, showFor - 8], [1, 0.006], clamp),
  );
  const flash =
    interpolate(frame, [2, 4, 11, 22], [0, 1, 0.8, 0], clamp) +
    interpolate(
      frame,
      [showFor - 15, showFor - 11, showFor - 3, showFor],
      [0, 0.8, 0.95, 0],
      clamp,
    );
  const flicker =
    0.965 + 0.035 * Math.sin(frame * 1.9) * Math.sin(frame * 0.37);
  const titleOn = frame >= 14 && (frame - 14) % 40 < 33;
  const subChars = Math.max(0, Math.floor((frame - 18 * k) * 2.2));
  const headOn = frame >= 22 * k;
  const startOf = (i: number) =>
    (24 + i * Math.max(7, Math.min(12, 54 / n))) * k;
  const lastDone = startOf(n - 1) + 30;
  const roll = (frame * 4) % (PH + 300);
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <Safe>
        <div
          style={{
            padding: 18,
            borderRadius: 54,
            background: "linear-gradient(180deg, #24242a 0%, #111114 100%)",
            boxShadow:
              "0 40px 120px rgba(0,0,0,0.75), inset 0 2px 0 rgba(255,255,255,0.08)",
            transform: cameraDrift(frame, showFor, variant),
          }}
        >
          <div
            style={{
              position: "relative",
              width: PW,
              height: PH,
              borderRadius: 40,
              overflow: "hidden",
              background:
                "radial-gradient(ellipse at 50% 45%, #0f1a1c 0%, #070b0d 62%, #020304 100%)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: `scale(${sx}, ${sy})`,
                opacity: flicker,
                padding: "48px 0",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div style={{ height: 70, opacity: titleOn ? 1 : 0 }}>
                <Pix
                  text="HIGH SCORES"
                  u={10}
                  colour="#FF8A3D"
                  gradient={{
                    id: `hs-title-${variant}`,
                    from: "#FFE14D",
                    to: "#FF6B1A",
                  }}
                />
              </div>
              <div style={{ height: 26 }} />
              {subU ? (
                <div style={{ height: 7 * subU, marginBottom: 34 }}>
                  <Pix
                    text={sub.slice(0, subChars)}
                    u={subU}
                    colour="#F5F5F2"
                  />
                </div>
              ) : (
                <div style={{ height: 10 }} />
              )}
              {/* Column heads, then one row per entry, ranked, centred in the space left. */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  paddingBottom: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    opacity: headOn ? 1 : 0,
                    marginBottom: lineGap,
                  }}
                >
                  <div style={{ width: cell * 6 }}>
                    <Pix text="RANK" u={u * 0.8} colour="#8FA3B0" />
                  </div>
                  <div
                    style={{
                      width: cell * scoreChars,
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <Pix text={scoreHead} u={u * 0.8} colour="#8FA3B0" />
                  </div>
                  <div style={{ width: cell * 3 }} />
                  <div style={{ width: cell * nameChars }}>
                    <Pix text="NAME" u={u * 0.8} colour="#8FA3B0" />
                  </div>
                </div>
                {rows.map((r, i) => {
                  const s0 = startOf(i);
                  if (frame < s0)
                    return (
                      <div key={i} style={{ height: 7 * u + lineGap * 0.95 }} />
                    );
                  const c = palette[i % palette.length]!;
                  const blink = frame - s0 < 3 ? "#FFFFFF" : c;
                  const p = interpolate(
                    frame,
                    [s0 + 2, s0 + 2 + 18 * k],
                    [0, 1],
                    clamp,
                  );
                  const typed = Math.max(
                    0,
                    Math.floor(((frame - s0 - 4) * 2) / k),
                  );
                  const name = names[i]!;
                  const cursor =
                    typed < name.length && frame % 6 < 3 ? "█" : "";
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        height: 7 * u,
                        marginBottom: lineGap * 0.95,
                      }}
                    >
                      <div style={{ width: cell * 6 }}>
                        <Pix text={ORDINAL[i]!} u={u} colour={blink} />
                      </div>
                      <div
                        style={{
                          width: cell * scoreChars,
                          display: "flex",
                          justifyContent: "flex-end",
                        }}
                      >
                        <Pix text={countText(r.fig, p)} u={u} colour={blink} />
                      </div>
                      <div style={{ width: cell * 3 }} />
                      <div style={{ width: cell * nameChars }}>
                        <Pix
                          text={name.slice(0, typed) + cursor}
                          u={u}
                          colour={blink}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  opacity:
                    frame > lastDone && (frame - lastDone) % 40 < 26 ? 1 : 0,
                }}
              >
                <Pix text="INSERT COIN" u={4} colour="#C9D1D6" />
              </div>
            </div>
            {/* The tube: power-on flash, scanlines, a rolling band, curvature shading and glass. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "#E9FFF6",
                opacity: Math.min(0.9, flash) * (sy < 0.5 ? 1 : 0.6),
                transform: `scale(${sx}, ${Math.max(sy, 0.006)})`,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "repeating-linear-gradient(180deg, rgba(0,0,0,0.32) 0 2px, transparent 2px 5px)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: roll - 300,
                height: 240,
                background:
                  "linear-gradient(180deg, transparent, rgba(160,255,220,0.035), transparent)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 40,
                boxShadow:
                  "inset 0 0 160px rgba(0,0,0,0.9), inset 0 0 40px rgba(0,0,0,0.6)",
                background:
                  "linear-gradient(155deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 32%)",
              }}
            />
          </div>
        </div>
      </Safe>
    </Stage>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* Donut: parts of a whole drawing clockwise in turn, a legend beside, the largest share at centre.  */
/* ------------------------------------------------------------------------------------------------ */

const DONUT_TONES = ["#F5F5F2", "#A3A3AD", "#6E6E79", "#4A4A54"];

/** An annular sector from angle a0 to a1 (radians, clockwise from twelve o'clock). */
function sector(
  cx: number,
  cy: number,
  R: number,
  r: number,
  a0: number,
  a1: number,
): string {
  const sweep = Math.min(TAU - 1e-4, Math.max(0, a1 - a0));
  const e = a0 + sweep;
  const pt = (rad: number, a: number) =>
    `${(cx + rad * Math.sin(a)).toFixed(2)} ${(cy - rad * Math.cos(a)).toFixed(2)}`;
  const large = sweep > Math.PI ? 1 : 0;
  return `M${pt(R, a0)}A${R} ${R} 0 ${large} 1 ${pt(R, e)}L${pt(r, e)}A${r} ${r} 0 ${large} 0 ${pt(r, a0)}Z`;
}

const Donut: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 190);
  const sh = shareRows(g.items);
  if (!visible || !sh) return null;
  const k = paceFor(showFor);
  const { rows, rest } = sh;
  const n = rows.length;
  const title = clean(g.primary);
  const kicker = clean(g.secondary);
  const flip = variant % 2 === 1;
  const S = 700;
  const cx = S / 2;
  const cy = S / 2;
  const R = 300;
  const r = 192;
  const drawStart = 10 * k;
  const drawLen = 58 * k;
  const sweepP = interpolate(frame, [drawStart, drawStart + drawLen], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const drawn = TAU * sweepP;
  const gap = 0.022;
  const parts = [
    ...rows.map((row, i) => ({
      share: row.share,
      colour:
        i === 0 ? COLOUR.amber : DONUT_TONES[(i - 1) % DONUT_TONES.length]!,
      row,
    })),
    ...(rest
      ? [{ share: rest, colour: "rgba(245,245,242,0.08)", row: undefined }]
      : []),
  ];
  let cum = 0;
  const segs = parts.map((p) => {
    const a0 = cum * TAU;
    cum += p.share;
    const a1 = cum * TAU;
    const segP =
      a1 > a0 ? Math.max(0, Math.min(1, (drawn - a0) / (a1 - a0))) : 1;
    return { ...p, a0, a1, segP };
  });
  const popAt = drawStart + drawLen;
  const pop = spring({ frame: frame - popAt, fps, config: SPRING.POP });
  const centre = spring({
    frame: frame - drawStart - 4,
    fps,
    config: SPRING.ENTER,
  });
  const ticks = interpolate(frame, [4, 24], [0, 1], clamp);
  const tickPath = Array.from({ length: 100 }, (_, i) => {
    const a = (i / 100) * TAU;
    if (a > drawn + 0.001 && sweepP < 1) return "";
    const r0 = R + 16;
    const r1 = R + (i % 10 === 0 ? 34 : 24);
    return `M${(cx + r0 * Math.sin(a)).toFixed(1)} ${(cy - r0 * Math.cos(a)).toFixed(1)}L${(cx + r1 * Math.sin(a)).toFixed(1)} ${(cy - r1 * Math.cos(a)).toFixed(1)}`;
  }).join("");
  const big = rows[0]!;
  const bigText = countText(big.fig, segs[0]!.segP);
  const bigFs =
    big.fig.text.length <= 4
      ? 150
      : big.fig.text.length <= 7
        ? 112
        : big.fig.text.length <= 11
          ? 80
          : 60;
  const rowH = Math.min(116, 520 / n);
  const legendFs = rowH > 100 ? 36 : 32;
  const donut = (
    <div style={{ position: "relative", width: S, height: S, flex: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 40,
          right: 40,
          top: 90,
          bottom: -10,
          borderRadius: "50%",
          background:
            "radial-gradient(closest-side, rgba(0,0,0,0.55), rgba(0,0,0,0))",
        }}
      />
      <svg
        width={S}
        height={S}
        viewBox={`0 0 ${S} ${S}`}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        <defs>
          <radialGradient
            id={`donut-core-${variant}`}
            cx="50%"
            cy="40%"
            r="60%"
          >
            <stop offset="0" stopColor="#202027" />
            <stop offset="1" stopColor="#0c0c0f" />
          </radialGradient>
        </defs>
        <circle
          cx={cx}
          cy={cy}
          r={(R + r) / 2}
          fill="none"
          stroke="rgba(245,245,242,0.06)"
          strokeWidth={R - r}
        />
        <path
          d={tickPath}
          stroke="rgba(245,245,242,0.32)"
          strokeWidth={2}
          opacity={ticks}
        />
        {segs.map((s, i) => {
          if (s.segP <= 0) return null;
          const half = parts.length > 1 ? gap / 2 : 0;
          const a0 = s.a0 + half;
          const a1 = s.a0 + (s.a1 - s.a0) * s.segP - (s.segP >= 1 ? half : 0);
          if (a1 <= a0) return null;
          const mid = (s.a0 + s.a1) / 2;
          const out = i === 0 ? 16 * pop : 0;
          return (
            <g
              key={i}
              transform={`translate(${(out * Math.sin(mid)).toFixed(2)} ${(-out * Math.cos(mid)).toFixed(2)})`}
            >
              <path d={sector(cx, cy, R, r, a0, a1)} fill={s.colour} />
              {i === 0 ? (
                <path
                  d={sector(cx, cy, R, R - 10, a0, a1)}
                  fill="rgba(255,255,255,0.22)"
                />
              ) : null}
            </g>
          );
        })}
        <circle
          cx={cx}
          cy={cy}
          r={r - 16}
          fill={`url(#donut-core-${variant})`}
          stroke="rgba(245,245,242,0.08)"
          strokeWidth={2}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: cx - (r - 30),
          top: cy - (r - 30),
          width: 2 * (r - 30),
          height: 2 * (r - 30),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          opacity: centre,
          transform: `scale(${0.8 + 0.2 * centre})`,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: bigFs,
            lineHeight: 1,
            color: COLOUR.amber,
            whiteSpace: "nowrap",
          }}
        >
          {bigText}
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: big.label.length > 22 ? 22 : 26,
            letterSpacing: 2,
            lineHeight: 1.15,
            color: COLOUR.muted,
            textTransform: "uppercase",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            maxWidth: 2 * (r - 40),
          }}
        >
          {big.label}
        </div>
      </div>
    </div>
  );
  const legend = (
    <div style={{ width: 720, flex: "none" }}>
      <Heading
        title={title}
        kicker={kicker}
        frame={frame}
        fps={fps}
        size={title.length <= 18 ? 84 : title.length <= 30 ? 68 : 56}
        max={54}
      />
      <div style={{ marginTop: title || kicker ? 34 : 0 }}>
        {segs.map((s, i) => {
          if (!s.row) return null;
          const show = interpolate(s.segP, [0, 0.3], [0, 1], clamp);
          return (
            <div
              key={i}
              style={{
                height: rowH,
                display: "flex",
                alignItems: "center",
                gap: 24,
                borderBottom: "2px solid rgba(245,245,242,0.10)",
                opacity: show,
                transform: `translateX(${(1 - show) * (flip ? -30 : 30)}px)`,
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: s.colour,
                  flex: "none",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
                }}
              />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: legendFs,
                  lineHeight: 1.12,
                  color: COLOUR.paper,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  paddingBottom: 2,
                }}
              >
                {s.row.label}
              </div>
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: s.row.fig.text.length > 10 ? 44 : 58,
                  lineHeight: 1,
                  color: i === 0 ? COLOUR.amber : COLOUR.paper,
                  whiteSpace: "nowrap",
                  textShadow: SHADOW,
                }}
              >
                {countText(s.row.fig, s.segP)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <Safe>
        <div
          style={{
            display: "flex",
            flexDirection: flip ? "row-reverse" : "row",
            alignItems: "center",
            gap: 110,
            transform: cameraDrift(frame, showFor, variant),
          }}
        >
          {donut}
          {legend}
        </div>
      </Safe>
    </Stage>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* Odometer: the figure on mechanical wheels that spin and settle left to right.                    */
/* ------------------------------------------------------------------------------------------------ */

type OdoToken = { kind: "num"; chars: string } | { kind: "text"; text: string };

/** Digit runs (with the commas and points inside them) as wheels; everything else as static type. */
function odoTokens(s: string): OdoToken[] {
  const out: OdoToken[] = [];
  const re = /\d(?:\d|[.,](?=\d))*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(last, m.index).trim();
    if (before) out.push({ kind: "text", text: before });
    out.push({ kind: "num", chars: m[0] });
    last = m.index + m[0].length;
  }
  const tail = s.slice(last).trim();
  if (tail) out.push({ kind: "text", text: tail });
  return out;
}

const odoFits = (g: MomentGraphic) => {
  const p = clean(g.primary);
  const digits = (p.match(/\d/g) ?? []).length;
  return (
    digits > 0 &&
    digits <= 12 &&
    p.length <= 22 &&
    odoTokens(p).filter((t) => t.kind === "num").length <= 3
  );
};

/** Where a wheel sits (in digits) at a frame: a fast spin easing out, arriving with a little momentum, a click. */
function wheelPos(
  f: number,
  target: number,
  s0: number,
  T: number,
  D: number,
): number {
  if (f <= s0) return target - D;
  if (f < T) {
    const t = (f - s0) / (T - s0);
    const e = 0.8 * (1 - (1 - t) * (1 - t)) + 0.2 * t;
    return target - D * (1 - e);
  }
  const v = (0.2 * D) / (T - s0);
  const A = Math.min(0.32, v / 0.85);
  const x = f - T;
  return target + A * Math.sin(0.85 * x) * Math.exp(-x / 4.5);
}

const Odometer: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 170);
  const primary = clean(g.primary);
  const label = clean(g.secondary);
  if (!visible || !odoFits(g)) return null;
  const k = paceFor(showFor);
  const toks = odoTokens(primary);
  const light = variant % 2 === 1;
  // Fit the row to 1560 px: wheels 0.7 em, separators 0.28 em, housing padding, static type at 0.8 em.
  let units = 0;
  toks.forEach((t, i) => {
    if (i) units += 0.18;
    if (t.kind === "num") {
      for (const c of t.chars) units += /\d/.test(c) ? 0.76 : 0.3;
      units += 0.26;
    } else units += t.text.length * 0.5 * 0.8;
  });
  const fs = Math.round(Math.max(80, Math.min(230, 1560 / units)));
  const cw = Math.round(fs * 0.7);
  const ch = Math.round(fs * 1.12);
  const pad = Math.round(fs * 0.09);
  let wheelIndex = 0;
  const wheelCount = (primary.match(/\d/g) ?? []).length;
  const s0 = 3 * k;
  const settleOf = (j: number) =>
    (22 + j * Math.max(4, Math.min(7, 30 / wheelCount))) * k;
  const lastSettle = settleOf(wheelCount - 1);
  const glint = interpolate(
    frame,
    [lastSettle + 6, lastSettle + 30],
    [-0.3, 1.3],
    clamp,
  );
  const inP = spring({ frame, fps, config: SPRING.ENTER });
  const labelIn = spring({ frame: frame - 12, fps, config: SPRING.ENTER });
  const rule = interpolate(frame, [10, 26], [0, 1], {
    ...clamp,
    easing: EASE_OUT,
  });
  const wheelBg = light
    ? "linear-gradient(180deg, #7d7a72 0%, #e4e1d8 22%, #fbfaf6 50%, #e4e1d8 78%, #7d7a72 100%)"
    : "linear-gradient(180deg, #050506 0%, #212127 22%, #303038 50%, #212127 78%, #050506 100%)";
  const digitColour = light ? "#141416" : COLOUR.paper;
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <Safe>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            transform: cameraDrift(frame, showFor, variant),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: Math.round(fs * 0.18),
              opacity: inP,
              transform: `translateY(${(1 - inP) * 70}px)`,
            }}
          >
            {toks.map((t, ti) => {
              if (t.kind === "text")
                return (
                  <div
                    key={ti}
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: Math.round(fs * 0.8),
                      lineHeight: 1,
                      color: COLOUR.amber,
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                      textShadow: "0 10px 40px rgba(0,0,0,0.6)",
                    }}
                  >
                    {t.text}
                  </div>
                );
              return (
                <div
                  key={ti}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "flex-end",
                    gap: Math.round(fs * 0.05),
                    padding: pad,
                    borderRadius: Math.round(fs * 0.1),
                    background:
                      "linear-gradient(180deg, #3a3a42 0%, #1b1b20 55%, #0f0f12 100%)",
                    boxShadow:
                      "0 34px 80px rgba(0,0,0,0.65), inset 0 2px 0 rgba(255,255,255,0.16), inset 0 -3px 0 rgba(0,0,0,0.6), 0 0 0 2px rgba(0,0,0,0.5)",
                  }}
                >
                  {[...t.chars].map((c, ci) => {
                    if (!/\d/.test(c))
                      return (
                        <div
                          key={ci}
                          style={{
                            width: Math.round(fs * 0.24),
                            height: ch,
                            display: "flex",
                            alignItems: "flex-end",
                            justifyContent: "center",
                            fontFamily: DISPLAY,
                            fontSize: Math.round(fs * 0.8),
                            lineHeight: 1,
                            color: COLOUR.paper,
                            paddingBottom: Math.round(fs * 0.06),
                            boxSizing: "border-box",
                          }}
                        >
                          {c}
                        </div>
                      );
                    const j = wheelIndex++;
                    const target = Number(c);
                    const T = settleOf(j);
                    // Every wheel starts on 0 and turns a few full times before its digit.
                    const D =
                      10 * (2 + Math.round(j * 0.6 + seeded(variant, 10 + j))) +
                      target;
                    const pos = wheelPos(frame, target, s0, T, D);
                    const vel = Math.abs(
                      pos - wheelPos(frame - 1, target, s0, T, D),
                    );
                    const base = Math.floor(pos);
                    return (
                      <div
                        key={ci}
                        style={{
                          position: "relative",
                          width: cw,
                          height: ch,
                          overflow: "hidden",
                          borderRadius: Math.round(fs * 0.04),
                          background: wheelBg,
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            filter:
                              vel > 0.3
                                ? `blur(${Math.min(5, vel * 1.6).toFixed(1)}px)`
                                : undefined,
                          }}
                        >
                          {[base - 1, base, base + 1, base + 2].map((d) => (
                            <div
                              key={d}
                              style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                top: (d - pos) * ch,
                                height: ch,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontFamily: DISPLAY,
                                fontSize: Math.round(fs * 0.92),
                                lineHeight: 1,
                                color: digitColour,
                              }}
                            >
                              {((d % 10) + 10) % 10}
                            </div>
                          ))}
                        </div>
                        {/* The drum's curve: digits darken as they roll over the edge. */}
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            background:
                              "linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.12) 24%, rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.12) 76%, rgba(0,0,0,0.78) 100%)",
                          }}
                        />
                      </div>
                    );
                  })}
                  {/* The glass over the window, catching a glint once every wheel has settled. */}
                  <div
                    style={{
                      position: "absolute",
                      inset: pad,
                      borderRadius: Math.round(fs * 0.05),
                      background: `linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 46%, rgba(255,255,255,0) 54%), linear-gradient(105deg, transparent ${glint * 100 - 12}%, rgba(255,255,255,0.28) ${glint * 100}%, transparent ${glint * 100 + 12}%)`,
                      boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.55)",
                    }}
                  />
                  {/* Amber index marks at the window's mid-line. */}
                  {[-1, 1].map((side) => (
                    <div
                      key={side}
                      style={{
                        position: "absolute",
                        top: "50%",
                        [side < 0 ? "left" : "right"]: -2,
                        marginTop: -Math.round(fs * 0.07),
                        width: 0,
                        height: 0,
                        borderTop: `${Math.round(fs * 0.07)}px solid transparent`,
                        borderBottom: `${Math.round(fs * 0.07)}px solid transparent`,
                        [side < 0 ? "borderLeft" : "borderRight"]:
                          `${Math.round(fs * 0.08)}px solid ${COLOUR.amber}`,
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
          {label ? (
            <div
              style={{
                marginTop: 46,
                display: "flex",
                alignItems: "center",
                gap: 22,
                opacity: labelIn,
                transform: `translateY(${(1 - labelIn) * 24}px)`,
              }}
            >
              <div
                style={{
                  width: 70 * rule,
                  height: 6,
                  borderRadius: 3,
                  background: COLOUR.amber,
                }}
              />
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize:
                    label.length <= 24 ? 46 : label.length <= 40 ? 38 : 32,
                  letterSpacing: 4,
                  color: COLOUR.paper,
                  textTransform: "uppercase",
                  maxWidth: 1400,
                  textAlign: "center",
                  textShadow: SHADOW,
                }}
              >
                {label}
              </div>
              <div
                style={{
                  width: 70 * rule,
                  height: 6,
                  borderRadius: 3,
                  background: COLOUR.amber,
                }}
              />
            </div>
          ) : null}
        </div>
      </Safe>
    </Stage>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* Gauge: a semicircular dial whose needle sweeps to the first readable score.                      */
/* ------------------------------------------------------------------------------------------------ */

const Gauge: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 190);
  const rows = reviewRows(g.items);
  const hi = rows.findIndex((r) => r.parsed);
  if (!visible || hi < 0) return null;
  const hero = rows[hi]!;
  const sc = hero.parsed!;
  const others = rows.filter((_, i) => i !== hi).slice(0, 4);
  const k = paceFor(showFor);
  const heading = clean(g.primary) || "What the critics said";
  const sub = clean(g.secondary);
  const R = sub ? 400 : 420;
  const SW = 2 * R + 80;
  const SH = R + 70;
  const cx = SW / 2;
  const cy = R + 40;
  // The needle sweeps from frame 20 and slams onto the score about 34 frames in (the stamp hit).
  const start = 20 * k;
  const sp = spring({
    frame: frame - start,
    fps,
    config: { damping: 10, stiffness: 70, mass: 1 },
  });
  const settled = frame > start + 40;
  const idle = settled ? 0.0025 * Math.sin((frame - start) * 0.45) : 0;
  const v = Math.max(0, Math.min(1, sc.n * sp + idle));
  const rot = -180 * (1 - v);
  const fig = parseFigure(hero.score);
  const scoreText = fig ? countText(fig, Math.min(1, sp)) : hero.score;
  const face = spring({ frame, fps, config: SPRING.ENTER });
  const lit = interpolate(frame, [start + 26, start + 50], [-0.3, 1.3], clamp);
  const pt = (rad: number, a: number) =>
    [
      cx + rad * Math.cos(Math.PI * (1 - a)),
      cy - rad * Math.sin(Math.PI * (1 - a)),
    ] as const;
  const ticks: React.ReactNode[] = [];
  for (let i = 0; i <= 50; i++) {
    const a = i / 50;
    const major = i % 5 === 0;
    const [x0, y0] = pt(R - 26, a);
    const [x1, y1] = pt(R - (major ? 70 : 46), a);
    ticks.push(
      <line
        key={i}
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
        stroke={a <= v + 0.001 ? COLOUR.amber : "rgba(245,245,242,0.38)"}
        strokeWidth={major ? 6 : 3}
        strokeLinecap="round"
      />,
    );
  }
  const arcR = R - 100;
  const [ax0, ay0] = pt(arcR, 0);
  const [ax1, ay1] = pt(arcR, Math.max(0.0001, v));
  const [tx1, ty1] = pt(arcR, 1);
  const valueArc = `M${ax0} ${ay0}A${arcR} ${arcR} 0 0 1 ${ax1} ${ay1}`;
  const [ix0, iy0] = pt(arcR - 44, 0);
  const [ix1, iy1] = pt(arcR - 44, 1);
  const innerArc = `M${ix0} ${iy0}A${arcR - 44} ${arcR - 44} 0 0 1 ${ix1} ${iy1}`;
  const trackArc = `M${ax0} ${ay0}A${arcR} ${arcR} 0 0 1 ${tx1} ${ty1}`;
  const L = R - 60;
  const scoreFs =
    hero.score.length <= 5 ? 150 : hero.score.length <= 9 ? 116 : 88;
  const chipText = others.reduce(
    (a, o) => a + o.outlet.length + o.score.length,
    0,
  );
  const chipFs = chipText > 80 ? 22 : chipText > 56 ? 24 : 28;
  const nameFs =
    hero.outlet.length > 26 ? 26 : hero.outlet.length > 16 ? 30 : 36;
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <Safe style={{ alignItems: "flex-start" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: 1600,
            marginTop: others.length ? 0 : 40,
            transform: cameraDrift(frame, showFor, variant),
          }}
        >
          <div style={{ opacity: face, textAlign: "center" }}>
            <Label>{heading}</Label>
            {sub ? (
              <div
                style={{
                  marginTop: 8,
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 26,
                  letterSpacing: 2,
                  color: COLOUR.muted,
                  textTransform: "uppercase",
                }}
              >
                {sub}
              </div>
            ) : null}
          </div>
          <div
            style={{
              position: "relative",
              width: SW,
              height: SH,
              marginTop: 6,
              opacity: face,
              transform: `translateY(${(1 - face) * 60}px)`,
            }}
          >
            <svg
              width={SW}
              height={SH}
              viewBox={`0 0 ${SW} ${SH}`}
              style={{ position: "absolute", inset: 0, overflow: "visible" }}
            >
              <defs>
                <radialGradient
                  id={`gauge-face-${variant}`}
                  cx="50%"
                  cy="100%"
                  r="100%"
                >
                  <stop offset="0" stopColor="#24242b" />
                  <stop offset="0.75" stopColor="#141418" />
                  <stop offset="1" stopColor="#0c0c0f" />
                </radialGradient>
                <linearGradient
                  id={`gauge-glint-${variant}`}
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="0"
                >
                  <stop
                    offset={Math.max(0, lit - 0.12)}
                    stopColor="rgba(255,255,255,0)"
                  />
                  <stop
                    offset={Math.max(0, Math.min(1, lit))}
                    stopColor="rgba(255,255,255,0.10)"
                  />
                  <stop
                    offset={Math.min(1, lit + 0.12)}
                    stopColor="rgba(255,255,255,0)"
                  />
                </linearGradient>
              </defs>
              <path
                d={`M${cx - R} ${cy}A${R} ${R} 0 0 1 ${cx + R} ${cy}Z`}
                fill={`url(#gauge-face-${variant})`}
                stroke="rgba(245,245,242,0.14)"
                strokeWidth={4}
              />
              <path
                d={`M${cx - R + 12} ${cy}A${R - 12} ${R - 12} 0 0 1 ${cx + R - 12} ${cy}`}
                fill="none"
                stroke="rgba(0,0,0,0.5)"
                strokeWidth={6}
              />
              {ticks}
              <path
                d={trackArc}
                fill="none"
                stroke="rgba(245,245,242,0.08)"
                strokeWidth={18}
                strokeLinecap="round"
              />
              <path
                d={innerArc}
                fill="none"
                stroke="rgba(245,245,242,0.10)"
                strokeWidth={2}
                strokeDasharray="2 12"
              />
              {v > 0.002 ? (
                <>
                  <path
                    d={valueArc}
                    fill="none"
                    stroke="rgba(255,107,26,0.18)"
                    strokeWidth={30}
                    strokeLinecap="round"
                  />
                  <path
                    d={valueArc}
                    fill="none"
                    stroke={COLOUR.amber}
                    strokeWidth={18}
                    strokeLinecap="round"
                  />
                </>
              ) : null}
              {sc.den !== undefined ? (
                <>
                  <text
                    x={cx - R + 48}
                    y={cy + 40}
                    textAnchor="middle"
                    fontFamily={BODY}
                    fontWeight={800}
                    fontSize={28}
                    fill={COLOUR.muted}
                  >
                    0
                  </text>
                  <text
                    x={cx + R - 48}
                    y={cy + 40}
                    textAnchor="middle"
                    fontFamily={BODY}
                    fontWeight={800}
                    fontSize={28}
                    fill={COLOUR.muted}
                  >
                    {sc.den}
                  </text>
                </>
              ) : null}
              <path
                d={`M${cx - R} ${cy}A${R} ${R} 0 0 1 ${cx + R} ${cy}Z`}
                fill={`url(#gauge-glint-${variant})`}
              />
              {/* The needle, its shadow, and the hub. */}
              <g transform={`translate(4 8) rotate(${rot} ${cx} ${cy})`}>
                <path
                  d={`M${cx - 30} ${cy - 15}L${cx + L} ${cy - 3}L${cx + L} ${cy + 3}L${cx - 30} ${cy + 15}Z`}
                  fill="rgba(0,0,0,0.35)"
                />
              </g>
              <g transform={`rotate(${rot} ${cx} ${cy})`}>
                <path
                  d={`M${cx - 30} ${cy - 15}L${cx + L} ${cy - 3}L${cx + L} ${cy + 3}L${cx - 30} ${cy + 15}Z`}
                  fill={COLOUR.paper}
                />
                <path
                  d={`M${cx + L * 0.62} ${cy - 7}L${cx + L} ${cy - 3}L${cx + L} ${cy + 3}L${cx + L * 0.62} ${cy + 7}Z`}
                  fill={COLOUR.amber}
                />
              </g>
              <circle
                cx={cx}
                cy={cy}
                r={38}
                fill="#101013"
                stroke={COLOUR.amber}
                strokeWidth={7}
              />
              <circle cx={cx} cy={cy} r={11} fill={COLOUR.amber} />
            </svg>
          </div>
          <div style={{ marginTop: 18, textAlign: "center", opacity: face }}>
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: nameFs,
                letterSpacing: 5,
                color: COLOUR.amber,
                textTransform: "uppercase",
                textShadow: SHADOW,
                whiteSpace: "nowrap",
              }}
            >
              {cut(hero.outlet, 44)}
            </div>
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: scoreFs,
                lineHeight: 1,
                marginTop: 6,
                color: COLOUR.paper,
                whiteSpace: "nowrap",
                textShadow: "0 12px 50px rgba(0,0,0,0.6)",
                opacity: interpolate(
                  frame,
                  [start - 4, start + 6],
                  [0, 1],
                  clamp,
                ),
              }}
            >
              {scoreText}
            </div>
          </div>
          {others.length ? (
            <div
              style={{
                marginTop: 26,
                display: "flex",
                gap: 16,
                justifyContent: "center",
                flexWrap: "nowrap",
                maxWidth: 1700,
              }}
            >
              {others.map((o, i) => {
                const s = spring({
                  frame: frame - (start + 26 + i * 6),
                  fps,
                  config: SPRING.SNAP,
                });
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 12,
                      padding: "12px 24px",
                      borderRadius: 999,
                      background: "rgba(16,16,20,0.88)",
                      border: "1px solid rgba(245,245,242,0.14)",
                      boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
                      opacity: s,
                      transform: `translateY(${(1 - s) * 30}px)`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: BODY,
                        fontWeight: 800,
                        fontSize: chipFs - 2,
                        letterSpacing: 1.5,
                        color: COLOUR.muted,
                        textTransform: "uppercase",
                      }}
                    >
                      {o.outlet}
                    </span>
                    <span
                      style={{
                        fontFamily: BODY,
                        fontWeight: 900,
                        fontSize: chipFs,
                        color: COLOUR.paper,
                      }}
                    >
                      {o.score}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </Safe>
    </Stage>
  );
};

/* ------------------------------------------------------------------------------------------------ */

const barsFit = (g: MomentGraphic) => rankedRows(g.items).length >= 2;

export const STYLES: Record<string, GfxStyle> = {
  Bars: { kind: "bars", component: Bars, fits: barsFit, sound: "pop" },
  ArcadeScores: {
    kind: "bars",
    component: ArcadeScores,
    fits: (g) => {
      const rows = arcadeRows(g);
      if (rows.length < 2) return false;
      const sc = Math.max(...rows.map((r) => pixelNormal(r.fig.text).length));
      const nm = Math.max(...rows.map((r) => shortName(r.label).length));
      return sc <= 16 && 9 + sc + nm <= 50;
    },
    sound: "glint",
  },
  Donut: {
    kind: "share",
    component: Donut,
    fits: (g) => Boolean(shareRows(g.items)),
    sound: "pop",
  },
  Odometer: {
    kind: "stat",
    component: Odometer,
    fits: odoFits,
    sound: "glint",
  },
  Gauge: {
    kind: "reviews",
    component: Gauge,
    fits: (g) => reviewRows(g.items).some((r) => r.parsed),
    sound: "stamp",
  },
};
