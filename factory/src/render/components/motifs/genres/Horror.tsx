// Genre motif: survival horror. The card is a case file on a desk under a flickering lamp: a typed report
// (CASE FILE, the game and year as its fields, the heading typed in, blank redaction bars), the picture
// clipped on as a print, a red classification stamp with the kicker slamming down, film grain and a slow
// lamp flicker. Styles: "File" types a source passage on a report page, the key phrase underlined in red
// pen, and "Statement" types a quote as a signed statement; each takes a red stamp at frame 34.
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring } from "remotion";
import { DISPLAY } from "../../fonts.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  Pic,
  clamp,
  clean,
  fitSize,
  hash,
  rng,
  useCard,
  words,
  yearOf,
} from "./kit.tsx";

const TYPE = "'Courier New', Courier, monospace";
const INK = "#1d1a16";
const STAMP = "#b3121b";
const PAPER = "#ece4cf";

/** How bright the lamp is: a slow breath with brief seeded dips, never below 0.55. */
export function lamp(frame: number, variant: number): number {
  const breath = 0.96 + 0.04 * Math.sin(frame * 0.17 + variant);
  const k = Math.floor(frame / 2);
  const dip = hash(k + variant * 101, 7) > 0.9 ? 0.6 + 0.25 * hash(k, 8) : 1;
  return breath * dip;
}

/** Film grain: a small tile of seeded specks, reseeded every frame, repeated over the frame. */
export const Grain: React.FC<{ frame: number; opacity?: number }> = ({
  frame,
  opacity = 0.14,
}) => {
  const seed = frame % 9;
  const specks = React.useMemo(() => {
    const r = rng(seed * 977 + 13);
    return Array.from({ length: 90 }, () => ({
      x: r() * 220,
      y: r() * 220,
      s: 1 + r() * 2.2,
      l: r() > 0.5,
      o: 0.3 + r() * 0.7,
    }));
  }, [seed]);
  const id = `grain${seed}`;
  return (
    <svg
      width={1920}
      height={1080}
      style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}
    >
      <defs>
        <pattern id={id} width={220} height={220} patternUnits="userSpaceOnUse">
          {specks.map((p, i) => (
            <rect
              key={i}
              x={p.x}
              y={p.y}
              width={p.s}
              height={p.s}
              fill={p.l ? "#fff" : "#000"}
              opacity={p.o}
            />
          ))}
        </pattern>
      </defs>
      <rect width={1920} height={1080} fill={`url(#${id})`} />
    </svg>
  );
};

/** The desk: dark wood, the lamp's warm pool and a vignette, dimmed by the lamp's flicker. */
const Desk: React.FC<{ level: number }> = ({ level }) => (
  <>
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(170deg, #2a1c12 0%, #1a110b 55%, #0d0805 100%)",
      }}
    />
    <AbsoluteFill
      style={{
        backgroundImage:
          "repeating-linear-gradient(88deg, rgba(255,220,180,0.035) 0 2px, transparent 2px 9px, rgba(0,0,0,0.12) 9px 11px, transparent 11px 23px)",
      }}
    />
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(60% 70% at 44% 36%, rgba(255,205,140,0.34) 0%, rgba(255,190,120,0.12) 40%, rgba(0,0,0,0) 70%)",
        opacity: level,
      }}
    />
  </>
);

/** A paper clip, drawn. */
const Clip: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <svg
    width={70}
    height={150}
    viewBox="0 0 70 150"
    style={{ position: "absolute", left: x, top: y, overflow: "visible" }}
  >
    <path
      d="M22 120 V30 a14 14 0 0 1 28 0 V110 a20 20 0 0 1 -40 0 V40"
      fill="none"
      stroke="#b9bcc2"
      strokeWidth={6}
      strokeLinecap="round"
    />
    <path
      d="M22 120 V30 a14 14 0 0 1 28 0 V110"
      fill="none"
      stroke="rgba(255,255,255,0.6)"
      strokeWidth={2}
    />
  </svg>
);

/** A red rubber stamp: double border, spaced capitals, slammed down at `at`. */
const Stamp: React.FC<{
  text: string;
  frame: number;
  at: number;
  size?: number;
  rotate?: number;
}> = ({ text, frame, at, size = 64, rotate = -11 }) => {
  if (frame < at - 1) return null;
  const p = interpolate(frame, [at - 1, at + 3], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  const settle = interpolate(frame, [at + 3, at + 8], [1.04, 1], clamp);
  return (
    <div
      style={{
        display: "inline-block",
        padding: "10px 30px",
        border: `7px solid ${STAMP}`,
        outline: `3px solid ${STAMP}`,
        outlineOffset: 5,
        borderRadius: 8,
        fontFamily: DISPLAY,
        fontSize: size,
        lineHeight: 1.05,
        letterSpacing: size * 0.12,
        color: STAMP,
        whiteSpace: "nowrap",
        opacity: 0.86 * p,
        mixBlendMode: "multiply",
        transform: `rotate(${rotate}deg) scale(${(2.1 - 1.1 * p) * settle})`,
      }}
    >
      {text}
    </div>
  );
};

/** Typed text: the shown part, the rest kept in place but invisible so the lines never reflow. */
const Typed: React.FC<{ text: string; n: number }> = ({ text, n }) => (
  <>
    {text.slice(0, n)}
    <span style={{ color: "transparent" }}>{text.slice(n)}</span>
  </>
);

const Card: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
  variant = 0,
}) => {
  const { frame, fps, len, opacity } = useCard(frames);
  const title = clean(heading).toUpperCase();
  const tag = clean(kicker).toUpperCase() || "CLASSIFIED";
  const name = clean(game).toUpperCase();
  const yr = yearOf(year);
  const level = lamp(frame, variant);
  const photo = pictures[0];
  const second = pictures[1];
  const paperIn = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 150, mass: 0.8 },
  });
  const photoIn = spring({
    frame: frame - 6,
    fps,
    config: { damping: 14, stiffness: 170, mass: 0.7 },
  });
  const rate = Math.max(1.8, title.length / 22);
  const n = Math.max(
    0,
    Math.min(title.length, Math.floor((frame - 10) * rate)),
  );
  const size = fitSize(
    title,
    photo ? 840 : 1140,
    4,
    [76, 68, 60, 54, 48, 42],
    0.61,
  );
  const push = interpolate(frame, [0, len], [1.0, 1.05], clamp);
  const paperLeft = photo ? 230 : 330;
  const paperW = photo ? 1000 : 1300;
  const bars = [0.92, 0.7, 0.84].map((w, i) => ({
    w: w - 0.18 * hash(variant * 7 + i, 3),
    o: interpolate(frame, [30 + i * 3, 34 + i * 3], [0, 1], clamp),
  }));
  return (
    <AbsoluteFill
      style={{ opacity, background: "#070504", overflow: "hidden" }}
    >
      <AbsoluteFill
        style={{ transform: `scale(${push})`, transformOrigin: "44% 40%" }}
      >
        <Desk level={level} />
        {/* The folder under the report. */}
        <div
          style={{
            position: "absolute",
            left: paperLeft - 40,
            top: 96,
            width: paperW + 70,
            height: 1000,
            background: "linear-gradient(180deg, #c9a15a 0%, #b58c45 100%)",
            borderRadius: 10,
            transform: `rotate(-3.2deg) translateY(${(1 - paperIn) * 700}px)`,
            boxShadow: "0 40px 90px rgba(0,0,0,0.65)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 40,
              top: -40,
              width: 300,
              height: 50,
              background: "#c9a15a",
              borderRadius: "10px 10px 0 0",
            }}
          />
        </div>
        {/* The report. */}
        <div
          style={{
            position: "absolute",
            left: paperLeft,
            top: 120,
            width: paperW,
            height: 960,
            background: `linear-gradient(180deg, #f2ead6 0%, ${PAPER} 60%, #ded3b8 100%)`,
            borderRadius: 4,
            padding: "64px 74px",
            boxSizing: "border-box",
            transform: `rotate(-1.4deg) translateY(${(1 - paperIn) * 800}px)`,
            boxShadow: "0 30px 70px rgba(0,0,0,0.55)",
            fontFamily: TYPE,
            fontWeight: 700,
            color: INK,
          }}
        >
          <div
            style={{
              fontSize: 46,
              letterSpacing: 16,
              borderBottom: `4px double ${INK}`,
              paddingBottom: 14,
            }}
          >
            CASE FILE
          </div>
          <div style={{ marginTop: 26, fontSize: 30, lineHeight: 1.5 }}>
            {name ? (
              <div style={{ display: "flex", gap: 18 }}>
                <span style={{ opacity: 0.6, flex: "none" }}>SUBJECT:</span>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {name}
                </span>
              </div>
            ) : null}
            {yr ? (
              <div style={{ display: "flex", gap: 18 }}>
                <span style={{ opacity: 0.6 }}>YEAR:</span>
                <span>{yr}</span>
              </div>
            ) : null}
          </div>
          <div
            style={{
              marginTop: 34,
              fontSize: size,
              lineHeight: 1.18,
              letterSpacing: 0,
            }}
          >
            <Typed text={title} n={n} />
          </div>
          <div style={{ marginTop: 40 }}>
            {bars.map((b, i) => (
              <div
                key={i}
                style={{
                  height: 26,
                  width: `${b.w * 100}%`,
                  marginBottom: 18,
                  background: "#151210",
                  opacity: b.o,
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
          <div style={{ position: "absolute", right: 60, bottom: 150 }}>
            <Stamp
              text={tag}
              frame={frame}
              at={30}
              size={tag.length > 14 ? 50 : 66}
            />
          </div>
        </div>
        {/* The prints clipped on. */}
        {photo ? (
          <>
            {second ? (
              <div
                style={{
                  position: "absolute",
                  left: 1250,
                  top: 470,
                  width: 470,
                  padding: "16px 16px 54px",
                  background: "#f4f1ea",
                  transform: `rotate(-7deg) translateX(${(1 - photoIn) * 700}px)`,
                  boxShadow: "0 24px 50px rgba(0,0,0,0.6)",
                }}
              >
                <div style={{ height: 290, overflow: "hidden" }}>
                  <Pic
                    src={second}
                    style={{
                      filter:
                        "grayscale(1) sepia(0.3) contrast(1.15) brightness(0.85)",
                    }}
                  />
                </div>
              </div>
            ) : null}
            <div
              style={{
                position: "absolute",
                left: 1150,
                top: 150,
                width: 560,
                padding: "18px 18px 62px",
                background: "#f6f3ec",
                transform: `rotate(${5 - (1 - photoIn) * 8}deg) scale(${1.25 - 0.25 * photoIn})`,
                opacity: Math.min(1, photoIn * 2),
                boxShadow: "0 30px 60px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ height: 330, overflow: "hidden" }}>
                <Pic
                  src={photo}
                  style={{
                    filter:
                      "grayscale(1) sepia(0.25) contrast(1.2) brightness(0.9)",
                  }}
                />
              </div>
              <Clip x={60} y={-40} />
            </div>
          </>
        ) : null}
      </AbsoluteFill>
      {/* The lamp's flicker darkens the whole room, then the vignette and the grain. */}
      <AbsoluteFill
        style={{ background: "#000", opacity: (1 - level) * 0.9 }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(62% 72% at 50% 42%, rgba(0,0,0,0) 32%, rgba(0,0,0,0.5) 68%, rgba(0,0,0,0.9) 100%)",
        }}
      />
      <Grain frame={frame} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */

const STAMP_AT = 34;

const passage = (g: GfxProps["g"]) =>
  clean(g.primary)
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();

const fitsFile = (g: GfxProps["g"]) => {
  const t = passage(g);
  const n = words(t).length;
  return n >= 10 && n <= 70 && t.length <= 430;
};

const fitsStatement = (g: GfxProps["g"]) => {
  const t = passage(g);
  const n = words(t).length;
  return (
    n >= 4 && n <= 40 && t.length <= 240 && clean(g.secondary).length <= 60
  );
};

/** A typed page on the desk: a passage (key phrase underlined in red pen) or a signed statement. */
const Page: React.FC<GfxProps & { mode: "file" | "statement" }> = ({
  g,
  len,
  variant = 0,
  mode,
}) => {
  const text = passage(g);
  const n0 = words(text).length;
  const { frame, fps, dim, visible } = useStage(
    len,
    Math.max(170, Math.min(280, 80 + n0 * 6)),
  );
  const ok = mode === "file" ? fitsFile(g) : fitsStatement(g);
  if (!visible || !ok) return null;
  const level = lamp(frame, variant);
  const shown = mode === "statement" ? `“${text}”` : text;
  const rate = Math.max(3, shown.length / 26);
  const n = Math.max(0, Math.min(shown.length, Math.floor((frame - 8) * rate)));
  const size = fitSize(
    shown,
    1260,
    mode === "file" ? 8 : 6,
    mode === "file" ? [56, 52, 48, 44, 40, 36, 33, 30] : [66, 60, 54, 48, 44, 40],
    0.61,
  );
  const page = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 150, mass: 0.8 },
  });
  const who = clean(g.secondary);
  const mark = mode === "file" ? clean(g.items[0] ?? "") : "";
  const at = mark ? shown.toLowerCase().indexOf(mark.toLowerCase()) : -1;
  const typedAll = n >= shown.length;
  const pen = interpolate(
    frame,
    [
      Math.max(STAMP_AT + 6, shown.length / rate + 12),
      Math.max(STAMP_AT + 22, shown.length / rate + 28),
    ],
    [0, 100],
    clamp,
  );
  const body =
    at >= 0 && typedAll ? (
      <>
        {shown.slice(0, at)}
        <span
          style={{
            backgroundImage: `linear-gradient(${STAMP}, ${STAMP})`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "0 92%",
            backgroundSize: `${pen}% 5px`,
            WebkitBoxDecorationBreak: "clone",
            boxDecorationBreak: "clone",
          }}
        >
          {shown.slice(at, at + mark.length)}
        </span>
        {shown.slice(at + mark.length)}
      </>
    ) : (
      <Typed text={shown} n={n} />
    );
  return (
    <AbsoluteFill style={{ opacity: dim, pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "rgba(6,4,3,0.82)" }} />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(55% 65% at 50% 45%, rgba(255,205,140,0.22) 0%, rgba(0,0,0,0) 70%)",
          opacity: level,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 240,
          right: 240,
          top: "53%",
          minHeight: 380,
          background: `linear-gradient(180deg, #f2ead6 0%, ${PAPER} 60%, #ded3b8 100%)`,
          borderRadius: 4,
          padding: "50px 70px",
          boxSizing: "border-box",
          transform: `translateY(calc(-50% + ${(1 - page) * 700}px)) rotate(${variant % 2 ? 0.8 : -0.8}deg)`,
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          fontFamily: TYPE,
          fontWeight: 700,
          color: INK,
        }}
      >
        <div
          style={{
            fontSize: 36,
            letterSpacing: 12,
            borderBottom: `4px double ${INK}`,
            paddingBottom: 12,
            marginBottom: 28,
          }}
        >
          {mode === "file" ? "CASE FILE" : "STATEMENT"}
        </div>
        <div style={{ fontSize: size, lineHeight: 1.36 }}>{body}</div>
        {mode === "statement" && who ? (
          <div
            style={{
              marginTop: 30,
              display: "flex",
              alignItems: "center",
              gap: 18,
              fontSize: 30,
              opacity: interpolate(
                frame,
                [shown.length / rate + 10, shown.length / rate + 20],
                [0, 1],
                clamp,
              ),
            }}
          >
            <div style={{ width: 60, height: 4, background: INK }} />
            {who}
          </div>
        ) : null}
        <div style={{ position: "absolute", right: 50, top: 22 }}>
          <Stamp
            text={mode === "file" ? "EVIDENCE" : "ON RECORD"}
            frame={frame}
            at={STAMP_AT}
            size={52}
            rotate={8}
          />
        </div>
      </div>
      <AbsoluteFill
        style={{ background: "#000", opacity: (1 - level) * 0.8 }}
      />
      <Grain frame={frame} opacity={0.1} />
    </AbsoluteFill>
  );
};

const File: React.FC<GfxProps> = (p) => <Page {...p} mode="file" />;
const Statement: React.FC<GfxProps> = (p) => <Page {...p} mode="statement" />;

export const HorrorCard = Card;
export const HORROR_STYLES: Record<string, GfxStyle> = {
  File: { kind: "source", component: File, fits: fitsFile, sound: "stamp" },
  Statement: {
    kind: "quote",
    component: Statement,
    fits: fitsStatement,
    sound: "stamp",
  },
};
