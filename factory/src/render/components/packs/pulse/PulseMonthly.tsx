// Pulse universe, "PulseMonthly": a press story as the cover of Pulse Monthly, the Pulse games magazine of its
// period. The headline is the main cover line over the game's picture (src); the cover date is the year the
// credit gives, and a strip along the foot says whose story it is ("STORY: PC ZONE"). Three periods: up to 1989
// chunky chrome-striped italics with the art framed on a grid, the 90s loud yellow type with a black outline
// and a starburst over full-bleed art, 2000-2009 a glossy photo cover with clean type and a sheen. Only a
// generic flash ("NEWS" or "REPORT") and a barcode of bars alone: no invented cover lines, scores, issue
// numbers or prices. The cover drops onto a table (even variants) or flips in (odd ones), then the cover line
// glints. Tagged ILLUSTRATION.
import React from "react";
import { Img, interpolate, spring } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import { clamp, easeOut, rand, sizeByLength, txt } from "../screen/common.ts";
import { PulseMark, storyYear } from "../screen/pulse.tsx";
import { coverLook, pressCredit, type CoverLook } from "./pressKit.ts";

const CW = 660;
const CH = 880;
const STRIP = 72;

/** Each period's inks: cover ground, masthead, cover line and the story strip. */
const LOOKS: Record<
  CoverLook,
  {
    ground: string;
    line: string;
    lineStroke: string;
    strip: string;
    stripInk: string;
    flash: string;
    flashInk: string;
  }
> = {
  eighties: {
    ground: "#120a2e",
    line: "#ffffff",
    lineStroke: "transparent",
    strip: "#e8262d",
    stripInk: "#ffffff",
    flash: "#ffd400",
    flashInk: "#120a2e",
  },
  nineties: {
    ground: "#111",
    line: "#ffe014",
    lineStroke: "#000",
    strip: "#000",
    stripInk: "#ffe014",
    flash: "#e8262d",
    flashInk: "#ffffff",
  },
  glossy: {
    ground: "#0c0d12",
    line: "#ffffff",
    lineStroke: "transparent",
    strip: "#ffffff",
    stripInk: "#111111",
    flash: "#FF6B1A",
    flashInk: "#ffffff",
  },
};

/** Text with a band of light sweeping across its letters only (a copy of the text clipped to a gradient). */
const GlintText: React.FC<{
  text: string;
  style: React.CSSProperties;
  sweep: number;
  strength?: number;
}> = ({ text, style, sweep, strength = 0.95 }) => (
  <div style={{ position: "relative" }}>
    <div style={style}>{text}</div>
    <div
      aria-hidden
      style={{
        ...style,
        position: "absolute",
        inset: 0,
        WebkitTextStroke: "0px transparent",
        textShadow: "none",
        color: "transparent",
        background: `linear-gradient(110deg, transparent ${sweep - 12}%, rgba(255,255,255,${strength}) ${sweep}%, transparent ${sweep + 12}%)`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      }}
    >
      {text}
    </div>
  </div>
);

/** A starburst flash with one generic word. */
const Flash: React.FC<{
  word: string;
  colour: string;
  ink: string;
  size: number;
  spin: number;
  round?: boolean;
}> = ({ word, colour, ink, size, spin, round }) => {
  const pts = Array.from({ length: 32 }, (_, i) => {
    const r = i % 2 ? 40 : 50;
    const a = (i / 32) * Math.PI * 2;
    return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{ position: "absolute", transform: `rotate(${spin}deg)` }}
      >
        {round ? (
          <circle cx={50} cy={50} r={48} fill={colour} />
        ) : (
          <polygon points={pts} fill={colour} stroke="#000" strokeWidth={1.5} />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: DISPLAY,
          fontSize: size * (word.length > 4 ? 0.2 : 0.27),
          color: ink,
          transform: "rotate(-12deg)",
          letterSpacing: 1,
        }}
      >
        {word}
      </div>
    </div>
  );
};

/** Barcode bars only: a real one carries a product number, and this cover has none to give. */
const Barcode: React.FC<{ seed: number; w: number; h: number }> = ({
  seed,
  w,
  h,
}) => {
  const bars: Array<{ x: number; bw: number }> = [];
  let x = 6;
  for (let i = 0; x < w - 10; i++) {
    const bw = 1.5 + Math.floor(rand(seed + i * 13) * 3) * 1.5;
    bars.push({ x, bw });
    x += bw + 1.5 + Math.floor(rand(seed + i * 29) * 3) * 1.5;
  }
  return (
    <svg width={w} height={h} style={{ display: "block", background: "#fff" }}>
      {bars.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={5}
          width={b.bw}
          height={h - (i < 3 || i > bars.length - 4 ? 6 : 12)}
          fill="#000"
        />
      ))}
    </svg>
  );
};

/** The masthead: the Pulse mark and PULSE over MONTHLY, set in the period's type. */
const Masthead: React.FC<{ look: CoverLook; date?: number }> = ({
  look,
  date,
}) => {
  if (look === "eighties")
    return (
      <div style={{ position: "absolute", left: 30, right: 30, top: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <PulseMark size={104} colour="#ff4fd8" />
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 150,
              lineHeight: 1,
              fontStyle: "italic",
              transform: "skewX(-10deg)",
              // The chrome stripes of 80s mastheads: bands of sky, horizon and ground across the letters.
              background:
                "linear-gradient(180deg,#e9f7ff 0%,#7fd2ff 38%,#ffffff 49%,#2a1458 51%,#ff5bd1 72%,#ffd36a 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter: "drop-shadow(5px 5px 0 #000)",
            }}
          >
            PULSE
          </div>
          {date !== undefined && (
            <div
              style={{
                marginLeft: "auto",
                alignSelf: "flex-start",
                marginTop: 10,
                padding: "4px 10px",
                background: "#ffd400",
                color: "#120a2e",
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 30,
              }}
            >
              {date}
            </div>
          )}
        </div>
        <div
          style={{
            marginTop: 6,
            padding: "4px 0",
            background: "#e8262d",
            color: "#fff",
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 30,
            letterSpacing: 22,
          }}
        >
          MONTHLY
        </div>
      </div>
    );
  if (look === "nineties")
    return (
      <div style={{ position: "absolute", left: 26, right: 26, top: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            transform: "rotate(-3deg)",
            transformOrigin: "0 100%",
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 176,
              lineHeight: 0.95,
              color: "#ffe014",
              WebkitTextStroke: "6px #000",
              textShadow: "9px 9px 0 #e8262d",
              letterSpacing: 2,
            }}
          >
            PULSE
          </div>
          <div style={{ marginBottom: 18 }}>
            <PulseMark size={86} colour="#ffe014" tile="#000" radius={16} />
            <div
              style={{
                marginTop: 8,
                padding: "2px 8px",
                background: "#e8262d",
                color: "#fff",
                fontFamily: DISPLAY,
                fontSize: 30,
                letterSpacing: 3,
              }}
            >
              MONTHLY
            </div>
          </div>
        </div>
        {date !== undefined && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 196,
              padding: "3px 10px",
              background: "#000",
              color: "#fff",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 28,
            }}
          >
            {date}
          </div>
        )}
      </div>
    );
  return (
    <div
      style={{
        position: "absolute",
        left: 30,
        right: 30,
        top: 20,
        display: "flex",
        alignItems: "flex-end",
        gap: 14,
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <PulseMark size={64} colour="#FF6B1A" />
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 124,
          lineHeight: 0.95,
          letterSpacing: -6,
          // Glossy 2000s chrome: white to silver with a bright lip.
          background:
            "linear-gradient(180deg,#ffffff 0%,#ffffff 46%,#c9ced8 54%,#eef1f6 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.55))",
        }}
      >
        pulse
      </div>
      {/* MONTHLY and the cover date stacked beside the name, as slim 2000s mastheads set them. */}
      <div
        style={{
          marginBottom: 16,
          color: "#fff",
          fontFamily: BODY,
          fontWeight: 800,
          textShadow: "0 2px 6px rgba(0,0,0,0.7)",
        }}
      >
        <div style={{ fontSize: 26, letterSpacing: 4 }}>MONTHLY</div>
        {date !== undefined && (
          <div style={{ marginTop: 6, fontSize: 28 }}>{date}</div>
        )}
      </div>
    </div>
  );
};

export const PulseMonthly: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
  src,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 240);
  const headline = txt(g.primary).toUpperCase();
  if (!visible || !headline) return null;
  const { outlet, year: date } = pressCredit(g);
  const look = coverLook(storyYear(g, year));
  const ink = LOOKS[look];
  const flip = variant % 2 === 1;
  const flashWord = variant % 4 < 2 ? "NEWS" : "REPORT";
  const tilt = (variant % 3) - 1;

  // Drop: the cover falls from above the table and lands about frame 32 (the stamp's hit), with a small
  // settle. Flip: it turns in on its spine from edge-on.
  const fall = interpolate(frame, [4, 32], [0, 1], {
    ...clamp,
    easing: (x) => x * x,
  });
  const settle =
    frame >= 32 ? Math.exp(-(frame - 32) / 5) * Math.sin((frame - 32) / 2) : 0;
  const turn = spring({
    frame: frame - 6,
    fps,
    config: { damping: 15, stiffness: 90, mass: 0.9 },
  });
  const push = interpolate(frame, [40, showFor], [0, 1], clamp);
  const sweep = interpolate(frame, [46, 76], [-20, 120], clamp);
  const sweep2 = interpolate(frame, [150, 180], [-20, 120], clamp);
  const sheen = interpolate(frame, [36, 66], [-30, 130], {
    ...clamp,
    easing: easeOut,
  });

  const transform = flip
    ? `perspective(2200px) rotateY(${(1 - turn) * 96}deg) rotate(${tilt * 1.5}deg) scale(${1 + 0.06 * push})`
    : `translateY(${(1 - fall) * -60}px) scale(${1.45 - 0.45 * fall + 0.012 * settle + 0.06 * push}) rotate(${(1 - fall) * -9 + tilt * 2.5}deg)`;
  const shadow = flip
    ? "0 30px 90px rgba(0,0,0,0.6)"
    : `0 ${18 + 70 * (1 - fall)}px ${30 + 110 * (1 - fall)}px rgba(0,0,0,${0.62 - 0.32 * (1 - fall)})`;

  const lineSize = sizeByLength(headline.length, [
    [26, 92],
    [42, 78],
    [60, 66],
    [999, 56],
  ]);
  const lineStyle: React.CSSProperties = {
    fontFamily: DISPLAY,
    fontSize: lineSize,
    lineHeight: 1.04,
    color: ink.line,
    letterSpacing: look === "glossy" ? 0.5 : 1,
    fontStyle: look === "eighties" ? "italic" : "normal",
    WebkitTextStroke:
      look === "nineties" ? `${Math.round(lineSize / 18)}px #000` : undefined,
    paintOrder: "stroke fill",
    textShadow:
      look === "nineties"
        ? "5px 5px 0 #000"
        : look === "eighties"
          ? "4px 4px 0 #e8262d"
          : "0 4px 18px rgba(0,0,0,0.7)",
  };
  const fullBleed = look !== "eighties";

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={14}>
      {/* The table the cover lands on: dark wood under a lamp. */}
      {!flip && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 50% 42%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.72) 100%), repeating-linear-gradient(91deg, #3b2617 0px, #4a2f1b 7px, #3f2918 15px, #553620 23px, #3b2617 31px), #3f2918",
            opacity: 0.94,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: 960 - CW / 2,
          top: 540 - CH / 2,
          width: CW,
          height: CH,
          transform,
          opacity: flip
            ? interpolate(turn, [0, 0.15], [0, 1], clamp)
            : interpolate(frame, [4, 12], [0, 1], clamp),
          boxShadow: shadow,
          background: ink.ground,
          overflow: "hidden",
          borderRadius: 3,
        }}
      >
        {/* The cover art: full bleed from the 90s on; framed on a neon grid in the 80s. */}
        {look === "eighties" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(0deg, rgba(255,79,216,0.28) 0 2px, transparent 2px 46px), repeating-linear-gradient(90deg, rgba(127,210,255,0.22) 0 2px, transparent 2px 46px)",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: fullBleed ? 0 : 34,
            right: fullBleed ? 0 : 34,
            top: fullBleed ? 0 : 236,
            bottom: fullBleed ? STRIP : 340,
            overflow: "hidden",
            border: fullBleed ? "none" : "6px solid #fff",
            boxShadow: fullBleed ? "none" : "8px 8px 0 #e8262d",
            background:
              "linear-gradient(150deg,#2b3550 0%,#141a2a 60%,#0b0d14 100%)",
          }}
        >
          {src ? (
            <Img
              src={src}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter:
                  look === "nineties"
                    ? "saturate(1.25) contrast(1.08)"
                    : look === "eighties"
                      ? "saturate(1.15)"
                      : "saturate(1.05) contrast(1.04)",
              }}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0.18,
              }}
            >
              <PulseMark size={360} colour="#FF6B1A" />
            </div>
          )}
          {fullBleed && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.82) 100%)",
              }}
            />
          )}
        </div>

        <Masthead look={look} date={date} />

        <div
          style={{
            position: "absolute",
            right: look === "eighties" ? 14 : 22,
            top: look === "eighties" ? 196 : 250,
          }}
        >
          <Flash
            word={flashWord}
            colour={ink.flash}
            ink={ink.flashInk}
            size={look === "glossy" ? 132 : 158}
            spin={frame * 0.25}
            round={look === "glossy"}
          />
        </div>

        {/* The main cover line: the headline itself. */}
        <div
          style={{
            position: "absolute",
            left: 34,
            right: 34,
            bottom: STRIP + 26,
            transform: look === "nineties" ? "rotate(-2deg)" : undefined,
          }}
        >
          <GlintText
            text={headline}
            style={lineStyle}
            sweep={frame < 120 ? sweep : sweep2}
          />
        </div>

        {/* Whose story it is, and the barcode, along the foot. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: STRIP,
            background: ink.strip,
            display: "flex",
            alignItems: "center",
            padding: "0 14px 0 26px",
            gap: 16,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 28,
              letterSpacing: 1.5,
              color: ink.stripInk,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {outlet ? `STORY: ${outlet.toUpperCase()}` : ""}
          </div>
          <Barcode seed={variant * 101 + headline.length} w={128} h={56} />
        </div>

        {/* Gloss: the light on a 2000s cover's laminate, swept once as it settles. */}
        {look === "glossy" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(120deg, transparent ${sheen - 18}%, rgba(255,255,255,0.22) ${sheen}%, transparent ${sheen + 18}%)`,
            }}
          />
        )}
        {/* Paper: a soft lit edge so the cover reads as a printed object. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxShadow:
              "inset 0 0 0 1px rgba(255,255,255,0.18), inset 0 0 60px rgba(0,0,0,0.25)",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 60,
          bottom: 48,
          color: "rgba(255,255,255,0.7)",
          fontFamily: BODY,
          fontSize: 20,
          letterSpacing: 3,
          opacity: interpolate(frame, [30, 40], [0, 1], clamp),
        }}
      >
        ILLUSTRATION
      </div>
    </Stage>
  );
};

export { fitsPulseMonthly } from "./pressKit.ts";
