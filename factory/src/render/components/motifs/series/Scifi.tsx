// Series motif "scifi": a helmet visor homage for the sci-fi shooters and space epics. The picture is the
// view through curved glass; a shield bar fills, a motion tracker sweeps in the corner and the heading is
// read in by a scanning line like a mission title. Generic shapes only, built from scratch.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  cardFade,
  clamp,
  easeInOut,
  easeOut,
  rand,
  sizeByLength,
  specRows,
  txt,
} from "./common.ts";

const CYAN = "#8FF3FF";
const CYAN_SOFT = "rgba(143,243,255,0.35)";
const GLOW = "0 0 8px rgba(143,243,255,0.75), 0 0 26px rgba(60,200,255,0.35)";

/* ------------------------------------------------------------------------------------------------ */
/* The glass                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/** A squircle through the frame: the visor's opening. */
function visorPath(
  a: number,
  b: number,
  cx = 960,
  cy = 540,
  n = 3.4,
  steps = 96,
) {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = cx + a * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = cy + b * Math.sign(s) * Math.abs(s) ** (2 / n);
    d += `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return `${d}Z`;
}

const VISOR = visorPath(930, 505);
const VISOR_IN = visorPath(912, 488);

/** The helmet around the view: dark beyond the glass, a soft inner edge, glints on the curve. */
const Glass: React.FC<{ frame: number }> = ({ frame }) => {
  const glint = interpolate(frame, [0, 150], [0, 40]);
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id="visorSheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(190,245,255,0.09)" />
          <stop offset="0.35" stopColor="rgba(190,245,255,0)" />
          <stop offset="1" stopColor="rgba(190,245,255,0)" />
        </linearGradient>
      </defs>
      {/* A soft inner edge from stacked strokes (no blur filter). */}
      {[230, 190, 156, 126, 100, 78, 58, 40, 24, 12].map((w, i) => (
        <path
          key={i}
          d={VISOR}
          fill="none"
          stroke="#02060b"
          strokeWidth={w}
          strokeOpacity={0.1}
        />
      ))}
      <path
        d={`M 0 0 H 1920 V 1080 H 0 Z ${VISOR}`}
        fill="#02060b"
        fillRule="evenodd"
        fillOpacity={0.96}
      />
      {/* The glass's own sheen, top left, and two glints riding the curve. */}
      <path d={VISOR} fill="url(#visorSheen)" />
      <path
        d={VISOR_IN}
        fill="none"
        stroke="rgba(170,240,255,0.55)"
        strokeWidth={2.5}
        pathLength={100}
        strokeDasharray="9 41"
        strokeDashoffset={-glint - 55}
        strokeLinecap="round"
      />
      <path
        d={VISOR_IN}
        fill="none"
        stroke="rgba(170,240,255,0.25)"
        strokeWidth={6}
        pathLength={100}
        strokeDasharray="4 46"
        strokeDashoffset={-glint - 30}
        strokeLinecap="round"
      />
    </svg>
  );
};

/** Deep space when there is no picture: a nebula glow, drifting stars and a planet's lit limb. */
const Space: React.FC<{ seed: number; frame: number }> = ({ seed, frame }) => {
  const drift = frame * 0.35;
  const R = 1150;
  const px = 1560 + (seed % 2 ? -260 : 0);
  const py = 1620;
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse 50% 40% at 62% 30%, rgba(70,120,200,0.32) 0%, rgba(0,0,0,0) 70%), radial-gradient(ellipse 40% 35% at 22% 72%, rgba(120,70,170,0.2) 0%, rgba(0,0,0,0) 70%), #03060d",
        overflow: "hidden",
      }}
    >
      <svg
        width={1920}
        height={1080}
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateX(${-drift}px)`,
        }}
      >
        {Array.from({ length: 150 }, (_, i) => (
          <circle
            key={i}
            cx={rand(seed * 977 + i * 3) * 1980}
            cy={rand(seed * 977 + i * 3 + 1) * 1080}
            r={0.6 + 1.7 * rand(seed * 977 + i * 3 + 2) ** 3}
            fill="#dff6ff"
            opacity={0.35 + 0.6 * rand(i * 7 + seed)}
          />
        ))}
      </svg>
      {/* The planet: a dark disc lit from the upper left, an atmosphere ring around its edge. */}
      <div
        style={{
          position: "absolute",
          left: px - R - 40,
          top: py - R - 40,
          width: (R + 40) * 2,
          height: (R + 40) * 2,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(110,200,255,0) ${(R / (R + 40)) * 70.7 - 1.2}%, rgba(110,200,255,0.42) ${(R / (R + 40)) * 70.7}%, rgba(110,200,255,0) 70.7%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: px - R,
          top: py - R,
          width: R * 2,
          height: R * 2,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 28% 22%, #2b5a86 0%, #12304f 22%, #07152a 45%, #03070f 70%)",
          boxShadow: "inset 6px 6px 0 rgba(170,230,255,0.35)",
          transform: `rotate(${frame * 0.02}deg)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** The view through the glass: the picture pushed in and cooled, or deep space. */
const View: React.FC<{
  src?: string;
  frame: number;
  span: number;
  dimTo?: number;
  seed: number;
}> = ({ src, frame, span, dimTo = 0.82, seed }) => {
  const push = interpolate(frame, [0, span], [1.1, 1.17], clamp);
  const lightUp = interpolate(frame, [0, 10], [0.2, 1], clamp);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#03060d" }}>
      {src ? (
        <>
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${push})`,
              filter: `saturate(0.85) contrast(1.06) brightness(${dimTo * lightUp})`,
            }}
          />
          <AbsoluteFill
            style={{
              background: "rgba(20,90,120,0.28)",
              mixBlendMode: "soft-light",
            }}
          />
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 70% 70% at 40% 50%, rgba(2,8,14,0.5) 0%, rgba(2,8,14,0.15) 60%, rgba(2,8,14,0) 100%)",
            }}
          />
        </>
      ) : (
        <AbsoluteFill style={{ opacity: lightUp }}>
          <Space seed={seed} frame={frame} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

/** A sweep radar: rings, a turning wedge, amber contacts brightening as it passes. */
const Tracker: React.FC<{
  frame: number;
  x: number;
  y: number;
  r: number;
  seed: number;
  on: number;
}> = ({ frame, x, y, r, seed, on }) => {
  const angle = (frame * 6 + seed * 40) % 360;
  const blips = Array.from({ length: 3 }, (_, i) => {
    const a = rand(seed * 11 + i) * 360;
    const d = 0.3 + 0.55 * rand(seed * 11 + i + 5);
    const since = (angle - a + 360) % 360;
    const bright = Math.max(0, 1 - since / 220);
    return { a, d, bright };
  });
  return (
    <div
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        opacity: on,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(10,40,55,0.55) 0%, rgba(4,16,24,0.75) 100%)",
          border: `2px solid ${CYAN_SOFT}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `conic-gradient(from ${angle - 70}deg, rgba(143,243,255,0) 0deg, rgba(143,243,255,0.42) 70deg, rgba(143,243,255,0) 71deg)`,
          }}
        />
      </div>
      <svg
        width={r * 2}
        height={r * 2}
        style={{ position: "absolute", inset: 0 }}
      >
        {[0.66, 0.33].map((k) => (
          <circle
            key={k}
            cx={r}
            cy={r}
            r={r * k}
            fill="none"
            stroke={CYAN_SOFT}
            strokeWidth={1.5}
          />
        ))}
        <line
          x1={r}
          y1={6}
          x2={r}
          y2={r * 2 - 6}
          stroke={CYAN_SOFT}
          strokeWidth={1.5}
        />
        <line
          x1={6}
          y1={r}
          x2={r * 2 - 6}
          y2={r}
          stroke={CYAN_SOFT}
          strokeWidth={1.5}
        />
        <polygon
          points={`${r},${r - 10} ${r - 8},${r + 8} ${r + 8},${r + 8}`}
          fill={CYAN}
        />
        {blips.map((b, i) => {
          const rad = ((b.a - 90) * Math.PI) / 180;
          return (
            <g key={i} opacity={0.25 + 0.75 * b.bright}>
              <circle
                cx={r + Math.cos(rad) * r * b.d}
                cy={r + Math.sin(rad) * r * b.d}
                r={7 + 5 * b.bright}
                fill={COLOUR.amber}
                opacity={0.35}
              />
              <circle
                cx={r + Math.cos(rad) * r * b.d}
                cy={r + Math.sin(rad) * r * b.d}
                r={6}
                fill={COLOUR.amber}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/** A segmented shield bar filling from the middle outward, flashing when full. */
const ShieldBar: React.FC<{ frame: number; on: number }> = ({ frame, on }) => {
  const fill = interpolate(frame, [6, 30], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const flash = interpolate(frame, [30, 33, 44], [0, 1, 0], clamp);
  const W = 660;
  const H = 24;
  const shape = "polygon(2% 0, 98% 0, 100% 100%, 0 100%)";
  return (
    <div
      style={{
        position: "absolute",
        left: 960 - W / 2,
        top: 92,
        width: W,
        height: H,
        opacity: on,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -6,
          clipPath: "polygon(1.5% 0, 98.5% 0, 100% 100%, 0 100%)",
          background: CYAN_SOFT,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -3,
          clipPath: shape,
          background: "rgba(3,10,16,0.92)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: shape,
          WebkitMaskImage:
            "repeating-linear-gradient(90deg, black 0px, black 18px, transparent 18px, transparent 22px)",
          maskImage:
            "repeating-linear-gradient(90deg, black 0px, black 18px, transparent 18px, transparent 22px)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${50 - 50 * fill}%`,
            width: `${100 * fill}%`,
            background: `linear-gradient(180deg, #d8fdff 0%, ${CYAN} 45%, #3cc6e6 100%)`,
            boxShadow: GLOW,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `rgba(255,255,255,${0.7 * flash})`,
          }}
        />
      </div>
    </div>
  );
};

/** Target brackets closing in around a box. */
const Brackets: React.FC<{
  w: number;
  h: number;
  close: number;
  colour?: string;
}> = ({ w, h, close, colour = CYAN }) => {
  const out = (1 - close) * 60;
  const arm = 34;
  return (
    <>
      {(["tl", "tr", "bl", "br"] as const).map((c) => {
        const top = c[0] === "t";
        const left = c[1] === "l";
        return (
          <div
            key={c}
            style={{
              position: "absolute",
              width: arm,
              height: arm,
              [top ? "top" : "bottom"]: -out - 18,
              [left ? "left" : "right"]: -out - 26,
              borderColor: colour,
              borderStyle: "solid",
              borderWidth: 0,
              [top ? "borderTopWidth" : "borderBottomWidth"]: 4,
              [left ? "borderLeftWidth" : "borderRightWidth"]: 4,
              opacity: close,
              filter: "drop-shadow(0 0 6px rgba(143,243,255,0.6))",
            }}
          />
        );
      })}
      <div style={{ width: w, height: h }} />
    </>
  );
};

/** The HUD boots: a flicker in the first frames, then steady. */
const boot = (frame: number) =>
  frame < 2
    ? 0
    : frame < 3
      ? 0.9
      : frame < 4
        ? 0.25
        : frame < 5
          ? 1
          : frame < 6
            ? 0.6
            : 1;

/** Text read in by a scanning line, left to right. */
const ScanText: React.FC<{
  frame: number;
  from: number;
  dur: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ frame, from, dur, children, style }) => {
  const p = interpolate(frame, [from, from + dur], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const lineOn =
    p > 0 && p < 1
      ? 1
      : interpolate(frame, [from + dur, from + dur + 6], [1, 0], clamp);
  const hot = interpolate(frame, [from + dur, from + dur + 14], [1, 0], clamp);
  return (
    <div style={{ position: "relative", display: "inline-block", ...style }}>
      <div
        style={{
          clipPath: `inset(-20% ${100 - p * 100}% -20% -2%)`,
          filter: hot > 0 ? `brightness(${1 + 0.5 * hot})` : undefined,
        }}
      >
        {children}
      </div>
      {p > 0 ? (
        <div
          style={{
            position: "absolute",
            top: "-12%",
            bottom: "-12%",
            left: `${p * 100}%`,
            width: 6,
            marginLeft: -3,
            background: "#e9feff",
            boxShadow: "0 0 18px 6px rgba(143,243,255,0.8), 0 0 60px 12px rgba(80,200,255,0.35)",
            opacity: lineOn,
          }}
        />
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* The card                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export const ScifiCard: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const title = txt(heading).toUpperCase();
  const k = txt(kicker);
  const sub = [txt(game), txt(year)].filter(Boolean).join("  ·  ");
  const pics = pictures.filter(Boolean);
  const feeds = pics.slice(1, 3);
  const fade = cardFade(frame, frames, 6, 10);
  const hud = boot(frame);
  const size = sizeByLength(title.length, [
    [12, 112],
    [20, 92],
    [30, 76],
    [46, 62],
    [999, 52],
  ]);
  const maxW = feeds.length ? 1150 : 1440;
  const close = spring({ frame: frame - 4, fps, config: SPRING.POP });
  const kickIn = interpolate(frame, [6, 14], [0, 1], clamp);
  const subIn = interpolate(frame, [26, 36], [0, 1], clamp);
  const rule = interpolate(frame, [22, 36], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  return (
    <AbsoluteFill
      style={{ opacity: fade, overflow: "hidden", background: "#02060b" }}
    >
      <View
        src={pics[0]}
        frame={frame}
        span={Math.max(1, frames)}
        seed={variant + 1}
      />
      {/* Fine horizontal grain of a projected display. */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(143,243,255,0.035) 0px, rgba(143,243,255,0.035) 1px, transparent 1px, transparent 4px)",
        }}
      />
      <AbsoluteFill style={{ opacity: hud }}>
        <ShieldBar frame={frame} on={1} />
        <Tracker
          frame={frame}
          x={262}
          y={826}
          r={128}
          seed={variant + 3}
          on={1}
        />
        {/* The mission title, left, read in by the scan. */}
        <div
          style={{
            position: "absolute",
            left: 230,
            top: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          <div style={{ position: "relative", maxWidth: maxW, marginTop: -40 }}>
            {k ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginBottom: 18,
                  opacity: kickIn,
                  transform: `translateX(${(1 - kickIn) * -20}px)`,
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    background: COLOUR.amber,
                    transform: "rotate(45deg)",
                  }}
                />
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 800,
                    fontSize: 28,
                    letterSpacing: 8,
                    color: CYAN,
                    textTransform: "uppercase",
                    textShadow: GLOW,
                  }}
                >
                  {k}
                </div>
              </div>
            ) : null}
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", inset: 0 }}>
                <Brackets w={0} h={0} close={close} />
              </div>
              <ScanText frame={frame} from={10} dur={20}>
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: size,
                    lineHeight: 1.04,
                    letterSpacing: size * 0.04,
                    color: "#ECFEFF",
                    textShadow:
                      "0 0 18px rgba(143,243,255,0.55), 0 4px 30px rgba(0,0,0,0.6)",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {title}
                </div>
              </ScanText>
            </div>
            <div
              style={{
                marginTop: 26,
                display: "flex",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div
                style={{
                  height: 3,
                  width: 220 * rule,
                  background: CYAN,
                  boxShadow: GLOW,
                }}
              />
              {sub ? (
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 800,
                    fontSize: 28,
                    letterSpacing: 5,
                    color: CYAN,
                    textTransform: "uppercase",
                    textShadow: GLOW,
                    opacity: subIn,
                    whiteSpace: "nowrap",
                  }}
                >
                  {sub}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {/* Scan feeds on the right, from the other pictures. */}
        {feeds.map((src, i) => {
          const s = spring({
            frame: frame - 14 - i * 5,
            fps,
            config: SPRING.SNAP,
          });
          const top = feeds.length === 1 ? 420 : 300 + i * 250;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 1470,
                top,
                width: 330,
                height: 186,
                opacity: s,
                transform: `translateX(${(1 - s) * 40}px)`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: -36,
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 22,
                  letterSpacing: 4,
                  color: CYAN,
                  textShadow: GLOW,
                }}
              >
                {`FEED 0${i + 1}`}
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                  border: `2px solid ${CYAN_SOFT}`,
                  clipPath:
                    "polygon(0 0, 92% 0, 100% 14%, 100% 100%, 8% 100%, 0 86%)",
                }}
              >
                <Img
                  src={src}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    filter: "grayscale(0.6) contrast(1.1) brightness(0.95)",
                    transform: `scale(${1.05 + 0.05 * (frame / Math.max(1, frames))})`,
                  }}
                />
                <AbsoluteFill
                  style={{
                    background: "rgba(60,190,230,0.35)",
                    mixBlendMode: "color",
                  }}
                />
                <AbsoluteFill
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(180deg, rgba(0,0,0,0.25) 0px, rgba(0,0,0,0.25) 1px, transparent 1px, transparent 3px)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
      <Glass frame={frame} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* The styles: HUD readouts and a locked-on figure                                                   */
/* ------------------------------------------------------------------------------------------------ */

const Readouts: React.FC<GfxProps> = ({ g, len, variant = 0, src }) => {
  const rows = (specRows(g.items) ?? []).slice(0, 6);
  const { frame, fps, dim, visible, showFor } = useStage(
    len,
    70 + rows.length * 18 + 60,
  );
  if (!visible || rows.length < 2) return null;
  const head = txt(g.primary).toUpperCase();
  const hud = boot(frame);
  const rowH = rows.length > 4 ? 98 : 116;
  const valueSize = rows.length > 4 ? 44 : 52;
  const W = 1240;
  const blockH = (head ? 120 : 0) + rows.length * (rowH + 14);
  const top = 130 + (878 - blockH) / 2;
  return (
    <AbsoluteFill
      style={{ opacity: dim, overflow: "hidden", background: "#02060b" }}
    >
      <View
        src={src}
        frame={frame}
        span={showFor}
        dimTo={0.55}
        seed={variant + 1}
      />
      <AbsoluteFill style={{ opacity: hud }}>
        <Tracker
          frame={frame}
          x={250}
          y={866}
          r={96}
          seed={variant + 3}
          on={1}
        />
        <div
          style={{ position: "absolute", left: (1920 - W) / 2, top, width: W }}
        >
          {head ? (
            <div style={{ height: 120 }}>
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 24,
                  letterSpacing: 8,
                  color: COLOUR.amber,
                  opacity: interpolate(frame, [4, 12], [0, 1], clamp),
                }}
              >
                ANALYSIS
              </div>
              <ScanText
                frame={frame}
                from={6}
                dur={14}
                style={{ marginTop: 8 }}
              >
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: head.length > 24 ? 46 : 56,
                    letterSpacing: 3,
                    color: "#ECFEFF",
                    whiteSpace: "nowrap",
                    textShadow: "0 0 16px rgba(143,243,255,0.5)",
                  }}
                >
                  {head}
                </div>
              </ScanText>
            </div>
          ) : null}
          {rows.map((r, i) => {
            const at = 14 + i * 7;
            const s = spring({ frame: frame - at, fps, config: SPRING.SNAP });
            const bar = interpolate(
              frame,
              [at + 4, at + 24],
              [0, 0.35 + 0.65 * rand(variant * 5 + i)],
              {
                ...clamp,
                easing: easeOut,
              },
            );
            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  height: rowH,
                  marginBottom: 14,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 34px",
                  background:
                    "linear-gradient(90deg, rgba(8,40,56,0.72) 0%, rgba(8,40,56,0.38) 100%)",
                  borderLeft: `5px solid ${CYAN}`,
                  clipPath: `polygon(0 0, ${100 * s}% 0, ${100 * s}% 100%, 0 100%)`,
                  boxShadow: "inset 0 0 0 1px rgba(143,243,255,0.18)",
                }}
              >
                <div
                  style={{
                    flex: "none",
                    width: 460,
                    fontFamily: BODY,
                    fontWeight: 800,
                    fontSize: 28,
                    letterSpacing: 4,
                    color: CYAN,
                    textTransform: "uppercase",
                    textShadow: GLOW,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.a}
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    background: "rgba(143,243,255,0.12)",
                    marginRight: 34,
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${bar * 100}%`,
                      background: CYAN,
                      boxShadow: GLOW,
                    }}
                  />
                </div>
                <div
                  style={{
                    flex: "none",
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: valueSize,
                    color: "#F5FEFF",
                    whiteSpace: "nowrap",
                    textShadow: "0 0 14px rgba(143,243,255,0.45)",
                  }}
                >
                  {r.b}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      <Glass frame={frame} />
    </AbsoluteFill>
  );
};

const LockOn: React.FC<GfxProps> = ({ g, len, variant = 0, src }) => {
  const { frame, fps, dim, visible, showFor } = useStage(len, 160);
  const figure = txt(g.primary).toUpperCase();
  if (!visible || !figure) return null;
  const what = txt(g.secondary).toUpperCase();
  const hud = boot(frame);
  const close = spring({ frame: frame - 4, fps, config: SPRING.POP });
  const size = sizeByLength(figure.length, [
    [5, 260],
    [9, 210],
    [13, 160],
    [999, 130],
  ]);
  const ring = interpolate(frame, [0, showFor], [0, 120]);
  const subIn = interpolate(frame, [24, 34], [0, 1], clamp);
  return (
    <AbsoluteFill
      style={{ opacity: dim, overflow: "hidden", background: "#02060b" }}
    >
      <View
        src={src}
        frame={frame}
        span={showFor}
        dimTo={0.5}
        seed={variant + 1}
      />
      <AbsoluteFill
        style={{ opacity: hud, alignItems: "center", justifyContent: "center" }}
      >
        {/* A slow turning range ring behind the figure. */}
        <svg
          width={760}
          height={760}
          style={{
            position: "absolute",
            left: 580,
            top: 160,
            transform: `rotate(${ring}deg)`,
          }}
        >
          <circle
            cx={380}
            cy={380}
            r={360}
            fill="none"
            stroke={CYAN_SOFT}
            strokeWidth={2}
            strokeDasharray="4 14"
          />
          <circle
            cx={380}
            cy={380}
            r={320}
            fill="none"
            stroke="rgba(143,243,255,0.18)"
            strokeWidth={16}
            pathLength={100}
            strokeDasharray="22 3 10 3 30 3 26 3"
          />
        </svg>
        <div
          style={{ position: "relative", textAlign: "center", marginTop: -20 }}
        >
          <div style={{ position: "absolute", inset: 0 }}>
            <Brackets w={0} h={0} close={close} />
          </div>
          <ScanText frame={frame} from={8} dur={16}>
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: size,
                lineHeight: 1,
                letterSpacing: -2,
                color: "#F2FEFF",
                whiteSpace: "nowrap",
                padding: "0 20px",
                textShadow:
                  "0 0 30px rgba(143,243,255,0.6), 0 6px 40px rgba(0,0,0,0.6)",
              }}
            >
              {figure}
            </div>
          </ScanText>
        </div>
        {what ? (
          <div
            style={{
              position: "absolute",
              top: 540 + size * 0.5 + 40,
              left: 200,
              right: 200,
              textAlign: "center",
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 34,
              letterSpacing: 7,
              color: CYAN,
              textShadow: GLOW,
              opacity: subIn,
              transform: `translateY(${(1 - subIn) * 12}px)`,
            }}
          >
            {what}
          </div>
        ) : null}
      </AbsoluteFill>
      <Glass frame={frame} />
    </AbsoluteFill>
  );
};

export const SCIFI_STYLES: Record<string, GfxStyle> = {
  /** primary: the heading; items: 2-6 "label: value" rows, shown as HUD readouts. */
  Visor: {
    kind: "specs",
    component: Readouts,
    fits: (g) => {
      const rows = specRows(g.items);
      return (
        !!rows &&
        rows.length >= 2 &&
        rows.length <= 6 &&
        rows.every((r) => r.a.length <= 24 && r.b.length <= 18) &&
        txt(g.primary).length <= 34
      );
    },
    sound: "glint",
  },
  /** primary: the figure ("17 million"); secondary: what it is, 2-6 words. */
  VisorStat: {
    kind: "stat",
    component: LockOn,
    fits: (g) =>
      /\d/.test(g.primary) &&
      txt(g.primary).length <= 16 &&
      txt(g.secondary).length <= 44,
    sound: "glint",
  },
};
