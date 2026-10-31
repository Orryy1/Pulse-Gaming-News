// Series motif "codec": a radio call screen homage for Metal Gear. Two portrait windows on green
// scanlined screens either side of a tuning readout (a decorative frequency in segment digits and a
// signal meter), the words typed beneath as subtitles. Built from scratch: layout, colour and motion only.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  cardFade,
  clamp,
  easeOut,
  initials,
  rand,
  sizeByLength,
  speaker,
  txt,
  typed,
  wordCount,
} from "./common.ts";

const GREEN = "#5CFF9D";
const GREEN_MID = "#2BD46B";
const GREEN_DIM = "rgba(60,255,140,0.13)";
const GHOST = "rgba(60,255,140,0.075)";
const GLOW = "0 0 6px rgba(92,255,157,0.85), 0 0 22px rgba(43,212,107,0.45)";
const BG =
  "radial-gradient(ellipse 80% 70% at 50% 42%, #07170d 0%, #030905 55%, #010201 100%)";

/** Decorative frequencies, one per variant: a readout, not a fact. */
const FREQS = [140.85, 141.12, 140.96, 141.8, 140.15, 141.52];

const WIN_W = 420;
const WIN_H = 520;
const WIN_TOP = 172;
const WIN_X = 170;

/* ------------------------------------------------------------------------------------------------ */
/* Segment digits                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

const DIGIT_SEGS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};

/** A bevelled segment from (x0,y0) to (x1,y1), horizontal or vertical, `t` thick. */
function seg(x0: number, y0: number, x1: number, y1: number, t: number) {
  const h = t / 2;
  if (y0 === y1)
    return `${x0},${y0} ${x0 + h},${y0 - h} ${x1 - h},${y0 - h} ${x1},${y0} ${x1 - h},${y0 + h} ${x0 + h},${y0 + h}`;
  return `${x0},${y0} ${x0 + h},${y0 + h} ${x0 + h},${y1 - h} ${x0},${y1} ${x0 - h},${y1 - h} ${x0 - h},${y0 + h}`;
}

const SegDigit: React.FC<{ ch: string; w: number; h: number; t: number }> = ({
  ch,
  w,
  h,
  t,
}) => {
  const on = DIGIT_SEGS[ch] ?? "";
  const g = 4;
  const m = h / 2;
  const pts: Record<string, string> = {
    a: seg(t / 2 + g, t / 2, w - t / 2 - g, t / 2, t),
    g: seg(t / 2 + g, m, w - t / 2 - g, m, t),
    d: seg(t / 2 + g, h - t / 2, w - t / 2 - g, h - t / 2, t),
    f: seg(t / 2, t / 2 + g, t / 2, m - g, t),
    b: seg(w - t / 2, t / 2 + g, w - t / 2, m - g, t),
    e: seg(t / 2, m + g, t / 2, h - t / 2 - g, t),
    c: seg(w - t / 2, m + g, w - t / 2, h - t / 2 - g, t),
  };
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ overflow: "visible" }}
    >
      {Object.entries(pts).map(([k, p]) => (
        <polygon key={k} points={p} fill={on.includes(k) ? GREEN : GHOST} />
      ))}
    </svg>
  );
};

/** The frequency in segment digits, a decimal point after the third. */
const Readout: React.FC<{ value: number; size: number }> = ({
  value,
  size,
}) => {
  const text = value.toFixed(2);
  const w = size * 0.52;
  const t = size * 0.1;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: size * 0.11,
        transform: "skewX(-7deg)",
        filter: `drop-shadow(0 0 10px rgba(92,255,157,0.55))`,
      }}
    >
      {text.split("").map((ch, i) =>
        ch === "." ? (
          <div
            key={i}
            style={{
              width: t * 1.3,
              height: t * 1.3,
              background: GREEN,
              marginBottom: 2,
            }}
          />
        ) : (
          <SegDigit key={i} ch={ch} w={w} h={size} t={t} />
        ),
      )}
    </div>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* The screens                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

/** Green channel static (one noise filter on a small window). */
const Static: React.FC<{ seed: number; id: string; opacity?: number }> = ({
  seed,
  id,
  opacity = 1,
}) => (
  <svg
    width={WIN_W}
    height={WIN_H}
    style={{ position: "absolute", inset: 0, opacity }}
  >
    <filter id={id} x="0" y="0" width="100%" height="100%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.85 0.35"
        numOctaves={1}
        seed={seed}
      />
      <feColorMatrix
        type="matrix"
        values="0.25 0.25 0.25 0 -0.2  0.8 0.8 0.8 0 -0.45  0.35 0.35 0.35 0 -0.25  0 0 0 0 1"
      />
    </filter>
    <rect width={WIN_W} height={WIN_H} filter={`url(#${id})`} />
  </svg>
);

/** What a window shows: a picture tinted to the screen's green, or big initials. */
type ScreenContent =
  | { kind: "picture"; src: string; focus: number }
  | { kind: "initials"; text: string }
  | { kind: "static" };

const Screen: React.FC<{
  content: ScreenContent;
  frame: number;
  open: number;
  tuneAt: number;
  seed: number;
  side: "l" | "r";
}> = ({ content, frame, open, tuneAt, seed, side }) => {
  // The screen tunes in: static, then the picture steadies with a little sideways jitter.
  const tuned = interpolate(frame, [tuneAt, tuneAt + 6], [0, 1], clamp);
  const jitter =
    frame >= tuneAt && frame < tuneAt + 6
      ? (rand(seed * 31 + frame) - 0.5) * 34
      : 0;
  const staticOn =
    content.kind === "static" ? 1 : frame < tuneAt + 6 ? 1 - tuned : 0;
  const flash = interpolate(frame, [2, 5, 11], [0, 1, 0], clamp);
  const flicker = 0.94 + 0.06 * Math.sin(frame * 1.7 + seed);
  const drift = interpolate(frame, [0, 150], [1.08, 1.16], clamp);
  const band = ((frame * 6 + seed * 40) % (WIN_H + 200)) - 100;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#041409",
        transform: `scaleY(${0.02 + 0.98 * open})`,
      }}
    >
      {content.kind === "picture" && tuned > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: tuned * flicker,
            transform: `translateX(${jitter}px)`,
          }}
        >
          <Img
            src={content.src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: `${content.focus}% 40%`,
              transform: `scale(${drift})`,
              transformOrigin: side === "l" ? "40% 40%" : "60% 40%",
              filter: "grayscale(1) contrast(1.45) brightness(1.08)",
            }}
          />
          <AbsoluteFill
            style={{ background: "#45ff95", mixBlendMode: "multiply" }}
          />
          <AbsoluteFill
            style={{ background: "#03200d", mixBlendMode: "screen" }}
          />
        </div>
      ) : null}
      {content.kind === "initials" && tuned > 0 ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            opacity: tuned * flicker,
            background:
              "radial-gradient(ellipse 70% 60% at 50% 45%, #0d3a1d 0%, #041409 80%)",
            transform: `translateX(${jitter}px)`,
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 230,
              lineHeight: 1,
              color: GREEN,
              textShadow: GLOW,
              letterSpacing: 4,
            }}
          >
            {content.text}
          </div>
        </AbsoluteFill>
      ) : null}
      {staticOn > 0 ? (
        <Static
          seed={seed * 97 + Math.floor(frame / 2)}
          id={`codecStatic${side}${seed}`}
          opacity={content.kind === "static" ? 0.55 : staticOn}
        />
      ) : null}
      {/* Scanlines, a slow bright band rolling down, the tube's dark corners. */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(0,0,0,0.42) 0px, rgba(0,0,0,0.42) 2px, transparent 2px, transparent 5px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: band,
          height: 90,
          background:
            "linear-gradient(180deg, rgba(92,255,157,0) 0%, rgba(92,255,157,0.1) 50%, rgba(92,255,157,0) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.6) 100%)",
        }}
      />
      <AbsoluteFill
        style={{ background: `rgba(190,255,215,${0.85 * flash})` }}
      />
    </div>
  );
};

/** A window: a bevelled green frame with corner brackets, the screen inside, a name plate beneath. */
const Window: React.FC<{
  x: number;
  content: ScreenContent;
  frame: number;
  open: number;
  tuneAt: number;
  seed: number;
  side: "l" | "r";
  plate?: { main: string; sub?: string };
  plateIn: number;
}> = ({ x, content, frame, open, tuneAt, seed, side, plate, plateIn }) => {
  const bracket = (corner: "tl" | "tr" | "bl" | "br") => {
    const top = corner[0] === "t";
    const left = corner[1] === "l";
    return (
      <div
        key={corner}
        style={{
          position: "absolute",
          width: 34,
          height: 34,
          [top ? "top" : "bottom"]: -18,
          [left ? "left" : "right"]: -18,
          borderColor: GREEN,
          borderStyle: "solid",
          borderWidth: 0,
          [top ? "borderTopWidth" : "borderBottomWidth"]: 4,
          [left ? "borderLeftWidth" : "borderRightWidth"]: 4,
          opacity: open,
        }}
      />
    );
  };
  const main = plate?.main ?? "";
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: WIN_TOP,
        width: WIN_W,
        height: WIN_H,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -10,
          border: `3px solid ${GREEN_MID}`,
          borderRadius: 6,
          boxShadow: `0 0 24px rgba(43,212,107,${0.35 * open}), inset 0 0 18px rgba(43,212,107,0.25)`,
          opacity: open,
        }}
      />
      <Screen
        content={content}
        frame={frame}
        open={open}
        tuneAt={tuneAt}
        seed={seed}
        side={side}
      />
      {(["tl", "tr", "bl", "br"] as const).map(bracket)}
      {main ? (
        <div
          style={{
            position: "absolute",
            top: WIN_H + 34,
            left: 0,
            width: WIN_W,
            textAlign: side === "l" ? "left" : "right",
            opacity: plateIn,
            transform: `translateY(${(1 - plateIn) * 14}px)`,
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "8px 16px",
              border: `2px solid ${GREEN_MID}`,
              background: "rgba(10,40,20,0.65)",
              maxWidth: WIN_W - 4,
            }}
          >
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: main.length > 24 ? 22 : 26,
                lineHeight: 1.15,
                letterSpacing: 2.5,
                color: GREEN,
                textTransform: "uppercase",
                textShadow: "0 0 8px rgba(92,255,157,0.5)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {main}
            </div>
            {plate?.sub ? (
              <div
                style={{
                  marginTop: 4,
                  fontFamily: BODY,
                  fontWeight: 700,
                  fontSize: 22,
                  letterSpacing: 1.5,
                  color: "rgba(160,255,200,0.75)",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {plate.sub}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** The voice level (0..1) at a frame: lively while words are coming, a low idle hum after. */
function level(frame: number, seed: number, talking: boolean): number {
  const n = rand(seed * 7919 + Math.floor(frame / 2));
  const wave =
    Math.abs(Math.sin(frame * 0.41 + seed)) * 0.5 +
    Math.abs(Math.sin(frame * 0.17 + seed * 2)) * 0.5;
  return talking
    ? 0.35 + 0.5 * wave * (0.55 + 0.45 * n)
    : 0.12 + 0.12 * wave * n;
}

/** The centre: the kicker, the frequency tuning in, a wedge signal meter riding the voice. */
const Centre: React.FC<{
  frame: number;
  fps: number;
  kicker: string;
  freq: number;
  talking: boolean;
  seed: number;
}> = ({ frame, fps, kicker, freq, talking, seed }) => {
  const draw = interpolate(frame, [2, 14], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const tune = interpolate(frame, [4, 22], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const value = freq - 0.6 * (1 - tune);
  const shown = Math.round(value * 100) / 100;
  const lit = spring({
    frame: frame - 4,
    fps,
    config: { damping: 18, stiffness: 140 },
  });
  const bars = 18;
  const on = Math.round(level(frame, seed, talking) * bars * lit);
  const arrows = 0.55 + 0.45 * Math.abs(Math.sin(frame * 0.22));
  const L = 640;
  const T = 222;
  const W = 640;
  const H = 420;
  return (
    <>
      {/* Links from the windows to the panel. */}
      {[0, 1].map((k) => (
        <div
          key={k}
          style={{
            position: "absolute",
            top: 430,
            left: k === 0 ? WIN_X + WIN_W + 12 : L + W,
            width: (L - (WIN_X + WIN_W + 12)) * draw,
            height: 3,
            background: GREEN_MID,
            transformOrigin: k === 0 ? "left" : "left",
            boxShadow: "0 0 8px rgba(43,212,107,0.6)",
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: L,
          top: T,
          width: W,
          height: H,
          border: `3px solid ${GREEN_MID}`,
          borderRadius: 10,
          background:
            "linear-gradient(180deg, rgba(8,34,17,0.75) 0%, rgba(3,14,7,0.85) 100%)",
          boxShadow:
            "0 0 30px rgba(43,212,107,0.18), inset 0 0 30px rgba(43,212,107,0.12)",
          clipPath: `inset(0 ${50 * (1 - draw)}% 0 ${50 * (1 - draw)}%)`,
        }}
      >
        {/* Tick rule along the top and bottom edges. */}
        {[16, H - 26].map((y, k) => (
          <div
            key={k}
            style={{
              position: "absolute",
              left: 30,
              right: 30,
              top: y,
              height: 10,
              backgroundImage: `repeating-linear-gradient(90deg, ${GREEN_MID} 0px, ${GREEN_MID} 2px, transparent 2px, transparent 18px)`,
              opacity: 0.45,
            }}
          />
        ))}
        {kicker ? (
          <div
            style={{
              position: "absolute",
              top: 40,
              left: 0,
              right: 0,
              textAlign: "center",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: kicker.length > 22 ? 22 : 26,
              letterSpacing: 6,
              color: GREEN,
              textTransform: "uppercase",
              textShadow: "0 0 10px rgba(92,255,157,0.6)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              padding: "0 40px",
            }}
          >
            {kicker}
          </div>
        ) : null}
        <div
          style={{
            position: "absolute",
            top: kicker ? 92 : 74,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 28,
          }}
        >
          <svg width={30} height={44} style={{ opacity: arrows }}>
            <polygon points="30,0 0,22 30,44" fill={GREEN} />
          </svg>
          <Readout value={shown} size={136} />
          <svg width={30} height={44} style={{ opacity: arrows }}>
            <polygon points="0,0 30,22 0,44" fill={GREEN} />
          </svg>
        </div>
        {/* The wedge meter. */}
        <div
          style={{
            position: "absolute",
            left: (W - (bars * 26 - 8)) / 2,
            top: kicker ? 300 : 290,
            height: 76,
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
          }}
        >
          {Array.from({ length: bars }, (_, i) => (
            <div
              key={i}
              style={{
                width: 18,
                height: 16 + (60 * i) / (bars - 1),
                background: i < on ? GREEN : GREEN_DIM,
                boxShadow: i < on ? "0 0 8px rgba(92,255,157,0.6)" : "none",
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
};

/** The words typed as a subtitle line under the call. */
const Subtitle: React.FC<{
  text: string;
  frame: number;
  from: number;
  rate: number;
  size: number;
  top: number;
}> = ({ text, frame, from, rate, size, top }) => {
  const shown = typed(text, frame, from, rate);
  if (!shown) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 200,
        right: 200,
        top,
        textAlign: "center",
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1.22,
        color: "#F4F6F1",
        textShadow: "0 3px 0 rgba(0,0,0,0.9), 0 0 24px rgba(0,0,0,0.8)",
      }}
    >
      {/* The full line sits invisibly underneath so the typed part never reflows. */}
      <span style={{ position: "relative", display: "inline-block" }}>
        <span style={{ visibility: "hidden" }}>{text}</span>
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            textAlign: "center",
          }}
        >
          <span>{shown}</span>
          <span style={{ visibility: "hidden" }}>
            {text.slice(shown.length)}
          </span>
        </span>
      </span>
    </div>
  );
};

/** The whole call: background, two windows, the centre, the subtitle. */
const CodecScreen: React.FC<{
  frame: number;
  fps: number;
  left: ScreenContent;
  right: ScreenContent;
  leftPlate?: { main: string; sub?: string };
  rightPlate?: { main: string; sub?: string };
  kicker: string;
  subtitle: string;
  subFrom: number;
  subRate: number;
  subSize: number;
  subTop?: number;
  variant: number;
  push: number;
}> = (p) => {
  const open = interpolate(p.frame, [2, 10], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const plateIn = spring({
    frame: p.frame - 12,
    fps: p.fps,
    config: { damping: 16, stiffness: 150 },
  });
  const subEnd = p.subFrom + p.subtitle.length / p.subRate;
  const talking = p.frame >= p.subFrom - 2 && p.frame <= subEnd + 4;
  const freq = FREQS[Math.abs(p.variant) % FREQS.length]!;
  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${p.push})` }}>
        <Window
          x={WIN_X}
          content={p.left}
          frame={p.frame}
          open={open}
          tuneAt={9}
          seed={3 + p.variant}
          side="l"
          plate={p.leftPlate}
          plateIn={plateIn}
        />
        <Window
          x={1920 - WIN_X - WIN_W}
          content={p.right}
          frame={p.frame}
          open={open}
          tuneAt={13}
          seed={11 + p.variant}
          side="r"
          plate={p.rightPlate}
          plateIn={plateIn}
        />
        <Centre
          frame={p.frame}
          fps={p.fps}
          kicker={p.kicker}
          freq={freq}
          talking={talking}
          seed={p.variant + 1}
        />
        <Subtitle
          text={p.subtitle}
          frame={p.frame}
          from={p.subFrom}
          rate={p.subRate}
          size={p.subSize}
          top={p.subTop ?? 812}
        />
      </AbsoluteFill>
      {/* Faint scanlines over everything and a soft vignette. */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 4px)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 85% 80% at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* The card and the style                                                                            */
/* ------------------------------------------------------------------------------------------------ */

export const CodecCard: React.FC<MotifCardProps> = ({
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
  const title = txt(heading);
  const pics = pictures.filter(Boolean);
  const left: ScreenContent = pics[0]
    ? { kind: "picture", src: pics[0], focus: 35 }
    : { kind: "static" };
  const right: ScreenContent = pics[1]
    ? { kind: "picture", src: pics[1], focus: 60 }
    : pics[0]
      ? { kind: "picture", src: pics[0], focus: 85 }
      : { kind: "static" };
  // Typed so the line is complete by about frame 36.
  const rate = Math.max(1.2, title.length / 22);
  const size = sizeByLength(title.length, [
    [12, 84],
    [26, 68],
    [44, 58],
    [70, 50],
    [999, 44],
  ]);
  const fade = cardFade(frame, frames, 6, 10);
  const push = interpolate(frame, [0, Math.max(1, frames)], [1, 1.03], clamp);
  const g = txt(game);
  const y = txt(year);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <CodecScreen
        frame={frame}
        fps={fps}
        left={left}
        right={right}
        leftPlate={g ? { main: g } : undefined}
        rightPlate={y ? { main: y } : undefined}
        kicker={txt(kicker)}
        subtitle={title}
        subFrom={14}
        subRate={rate}
        subSize={size}
        variant={variant}
        push={push}
      />
    </AbsoluteFill>
  );
};

const quoteText = (t: string) =>
  txt(t)
    .replace(/^["“]+|["”]+$/g, "")
    .trim();

/** A quote as a call: the speaker in the left window (portrait or initials), the words as subtitles. */
const Call: React.FC<GfxProps> = ({ g, len, variant = 0, src, photos }) => {
  const text = quoteText(g.primary);
  const words = wordCount(text);
  const { frame, fps, dim, visible, showFor } = useStage(
    len,
    Math.max(130, Math.min(270, 64 + words * 8)),
  );
  const who = speaker(g.secondary);
  if (!visible || !text || !who.name) return null;
  const photo = photos?.[who.name.toLowerCase()];
  const left: ScreenContent = photo
    ? { kind: "picture", src: photo, focus: 50 }
    : { kind: "initials", text: initials(who.name) };
  const right: ScreenContent = src
    ? { kind: "picture", src, focus: 55 }
    : { kind: "static" };
  const rate = Math.max(1.6, text.length / 48);
  const size = sizeByLength(text.length, [
    [60, 54],
    [110, 48],
    [170, 42],
    [999, 36],
  ]);
  const push = interpolate(frame, [0, showFor], [1, 1.025], clamp);
  return (
    <AbsoluteFill style={{ opacity: dim }}>
      <CodecScreen
        frame={frame}
        fps={fps}
        left={left}
        right={right}
        leftPlate={{ main: who.name, sub: who.role || undefined }}
        kicker=""
        subtitle={text}
        subFrom={16}
        subRate={rate}
        subSize={size}
        subTop={who.role ? 838 : 812}
        variant={variant}
        push={push}
      />
    </AbsoluteFill>
  );
};

export const CODEC_STYLES: Record<string, GfxStyle> = {
  /** primary: the quote word for word (4-34 words); secondary: "Name, role". */
  Call: {
    kind: "quote",
    component: Call,
    fits: (g) => {
      const t = quoteText(g.primary);
      const n = wordCount(t);
      const who = speaker(g.secondary);
      return (
        n >= 4 &&
        n <= 34 &&
        t.length <= 230 &&
        who.name.length > 1 &&
        who.name.length <= 30
      );
    },
    sound: "glint",
  },
};
