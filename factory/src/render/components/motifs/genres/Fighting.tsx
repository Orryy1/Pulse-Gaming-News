// Genre motif: fighting games. The card is a versus screen built from scratch: two diagonal halves slam
// together (the pictures, tinted red and blue), a white flash and a shake on impact, health bars filling
// in at the top round a generic round timer, VS stamped in the middle and the heading as the fight card.
// The style "Versus" sets two "label: value" rows as the two fighters' health bars: the smaller one takes
// the hit at frame 34 (the stamp sound) and drains to its share.
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import { quantityRows } from "../../packs/data/figures.ts";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  Pic,
  chapterNumber,
  clamp,
  clean,
  fitSize,
  useCard,
  yearOf,
} from "./kit.tsx";

const W = 1920;
const H = 1080;
const RED = "#d3122a";
const BLUE = "#1f5bff";
const GOLD = "#ffd21a";
const IMPACT = 8;

const slamEase = Easing.in(Easing.cubic);

/** Screen shake after an impact at `at`: a decaying wobble, the same every render. */
function shake(frame: number, at: number, amp = 18) {
  if (frame < at) return { x: 0, y: 0 };
  const t = frame - at;
  const d = Math.exp(-t / 3.5) * amp;
  return { x: Math.sin(t * 2.9) * d, y: Math.cos(t * 3.7) * d * 0.6 };
}

/** One half of the versus screen: its picture (or a colour field), a tint and drifting slash lines. */
const Half: React.FC<{
  side: "l" | "r";
  src?: string;
  mirror?: boolean;
  p: number;
  frame: number;
}> = ({ side, src, mirror, p, frame }) => {
  const l = side === "l";
  const clip = l
    ? "polygon(0 0, 57% 0, 43% 100%, 0 100%)"
    : "polygon(57% 0, 100% 0, 100% 100%, 43% 100%)";
  const tint = l
    ? "linear-gradient(100deg, rgba(150,8,24,0.78) 0%, rgba(210,18,42,0.42) 45%, rgba(210,18,42,0.2) 60%)"
    : "linear-gradient(260deg, rgba(10,30,140,0.8) 0%, rgba(31,91,255,0.42) 45%, rgba(31,91,255,0.2) 60%)";
  const field = l
    ? "linear-gradient(120deg, #3a0309 0%, #8e0a1a 50%, #d3122a 100%)"
    : "linear-gradient(240deg, #020a33 0%, #0a2a9e 50%, #1f5bff 100%)";
  const slide = (1 - p) * 1150 * (l ? -1 : 1);
  const drift = (frame * 6) % 120;
  return (
    <AbsoluteFill
      style={{ clipPath: clip, transform: `translateX(${slide}px)` }}
    >
      <AbsoluteFill style={{ background: field }} />
      {src ? (
        <AbsoluteFill
          style={{
            transform: `scale(${1.12 - 0.04 * Math.min(1, frame / 120)}) ${mirror ? "scaleX(-1)" : ""}`,
            left: l ? 0 : 800,
            right: l ? 800 : 0,
          }}
        >
          <Pic src={src} style={{ filter: "saturate(1.15) contrast(1.12)" }} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ background: tint }} />
      <AbsoluteFill
        style={{
          opacity: src ? 0.18 : 0.3,
          backgroundImage: `repeating-linear-gradient(${l ? 62 : 118}deg, rgba(255,255,255,0.55) 0 3px, transparent 3px 40px)`,
          backgroundPosition: `${l ? drift : -drift}px 0`,
        }}
      />
    </AbsoluteFill>
  );
};

/** A health bar: a skewed frame, the red under-bar and the gold fill sweeping in toward the timer. */
const Bar: React.FC<{ side: "l" | "r"; fill: number; width: number }> = ({
  side,
  fill,
  width,
}) => {
  const l = side === "l";
  return (
    <div
      style={{
        width,
        height: 46,
        transform: `skewX(${l ? -18 : 18}deg)`,
        background: "#14070a",
        border: "4px solid #fff7e6",
        boxShadow: "0 8px 28px rgba(0,0,0,0.55), inset 0 0 0 3px #14070a",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", inset: 3, background: "#7d0b16" }} />
      <div
        style={{
          position: "absolute",
          top: 3,
          bottom: 3,
          [l ? "right" : "left"]: 3,
          width: `calc(${fill * 100}% - 6px)`,
          background: `linear-gradient(180deg, #fff3a8 0%, ${GOLD} 38%, #f0a400 100%)`,
        }}
      />
    </div>
  );
};

const Card: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
}) => {
  const { frame, fps, opacity } = useCard(frames);
  const title = clean(heading).toUpperCase();
  const round = chapterNumber(kicker);
  const tag = round ? `ROUND ${round}` : clean(kicker).toUpperCase();
  const yr = yearOf(year);
  const sub = [clean(game), yr].filter(Boolean).join("  ·  ").toUpperCase();
  const p = interpolate(frame, [0, IMPACT], [0, 1], {
    ...clamp,
    easing: slamEase,
  });
  const s = shake(frame, IMPACT, 22);
  const flash = interpolate(
    frame,
    [IMPACT - 1, IMPACT, IMPACT + 7],
    [0, 0.95, 0],
    clamp,
  );
  const vs = spring({
    frame: frame - IMPACT,
    fps,
    config: { damping: 11, stiffness: 230, mass: 0.6 },
  });
  const bars = interpolate(frame, [IMPACT + 2, IMPACT + 26], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.quad),
  });
  const hud = spring({ frame: frame - 2, fps, config: SPRING.SNAP });
  const tagIn = spring({
    frame: frame - (IMPACT + 4),
    fps,
    config: SPRING.POP,
  });
  const headIn = interpolate(frame, [IMPACT + 6, IMPACT + 14], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const subIn = interpolate(frame, [IMPACT + 14, IMPACT + 24], [0, 1], clamp);
  const timer = Math.max(0, 99 - Math.floor(Math.max(0, frame - 24) / 30));
  const size = fitSize(title, 1640, 2, [150, 134, 118, 104, 92, 80, 70], 0.5);
  const left = pictures[0];
  const right = pictures[1] ?? pictures[0];
  const seam = interpolate(frame, [IMPACT, IMPACT + 3], [0, 1], clamp);
  return (
    <AbsoluteFill
      style={{ opacity, background: "#050306", overflow: "hidden" }}
    >
      <AbsoluteFill
        style={{ transform: `translate(${s.x}px, ${s.y}px) scale(1.03)` }}
      >
        <Half side="l" src={left} p={p} frame={frame} />
        <Half
          side="r"
          src={right}
          mirror={Boolean(right && right === left)}
          p={p}
          frame={frame}
        />
        {/* The seam where the halves meet, lit on impact. */}
        <svg
          width={W}
          height={H}
          style={{ position: "absolute", inset: 0, opacity: seam }}
        >
          <line
            x1={W * 0.57}
            y1={-10}
            x2={W * 0.43}
            y2={H + 10}
            stroke="rgba(255,240,200,0.35)"
            strokeWidth={34}
          />
          <line
            x1={W * 0.57}
            y1={-10}
            x2={W * 0.43}
            y2={H + 10}
            stroke="#fffbe8"
            strokeWidth={9}
          />
        </svg>
        {/* Darkness under the fight card so the heading always reads. */}
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 46%, rgba(0,0,0,0.82) 78%, rgba(0,0,0,0.92) 100%)",
          }}
        />
        {/* A burst of light rays behind VS, thrown out on impact and turning slowly. */}
        <div
          style={{
            position: "absolute",
            left: 960 - 700,
            top: 390 - 700,
            width: 1400,
            height: 1400,
            borderRadius: 700,
            opacity: frame >= IMPACT ? 0.9 * Math.min(1, vs * 1.3) : 0,
            transform: `rotate(${frame * 0.35}deg) scale(${0.4 + 0.6 * Math.min(1, vs)})`,
            background:
              "repeating-conic-gradient(from 0deg, rgba(255,236,170,0.32) 0deg 5deg, rgba(255,236,170,0) 5deg 15deg)",
            WebkitMaskImage:
              "radial-gradient(circle, #000 8%, rgba(0,0,0,0.6) 30%, transparent 62%)",
            maskImage:
              "radial-gradient(circle, #000 8%, rgba(0,0,0,0.6) 30%, transparent 62%)",
          }}
        />
        {/* VS */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 250,
            textAlign: "center",
            opacity: frame >= IMPACT ? 1 : 0,
            transform: `scale(${2.4 - 1.4 * vs}) rotate(${(1 - vs) * -14}deg)`,
          }}
        >
          <span
            style={{
              display: "inline-block",
              fontFamily: DISPLAY,
              fontSize: 280,
              lineHeight: 1,
              letterSpacing: -6,
              transform: "skewX(-10deg)",
              color: "transparent",
              backgroundImage: `linear-gradient(180deg, #ffffff 0%, #fff4c2 40%, ${GOLD} 62%, #ff7a1a 100%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextStroke: "7px #1a0603",
              filter:
                "drop-shadow(0 14px 0 #1a0603) drop-shadow(0 30px 50px rgba(0,0,0,0.6))",
              padding: "0 30px",
            }}
          >
            VS
          </span>
        </div>
      </AbsoluteFill>
      {/* HUD: health bars and the round timer. */}
      <div
        style={{
          position: "absolute",
          top: 54,
          left: 96,
          right: 96,
          height: 120,
          transform: `translateY(${(1 - hud) * -150}px)`,
        }}
      >
        <div style={{ position: "absolute", left: 10, top: 0 }}>
          <Bar side="l" fill={bars} width={730} />
        </div>
        <div style={{ position: "absolute", right: 10, top: 0 }}>
          <Bar side="r" fill={bars} width={730} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 4,
            top: 58,
            fontFamily: DISPLAY,
            fontSize: 40,
            color: "#fff",
            letterSpacing: 2,
            textShadow: `3px 3px 0 ${RED}, 0 6px 18px rgba(0,0,0,0.7)`,
            transform: "skewX(-10deg)",
          }}
        >
          1P
        </div>
        <div
          style={{
            position: "absolute",
            right: 4,
            top: 58,
            fontFamily: DISPLAY,
            fontSize: 40,
            color: "#fff",
            letterSpacing: 2,
            textShadow: `-3px 3px 0 ${BLUE}, 0 6px 18px rgba(0,0,0,0.7)`,
            transform: "skewX(-10deg)",
          }}
        >
          2P
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: -12,
            width: 148,
            marginLeft: -74,
            textAlign: "center",
            fontFamily: DISPLAY,
            fontSize: 96,
            lineHeight: 1,
            color: "#fff",
            WebkitTextStroke: "3px #120406",
            textShadow: "0 6px 0 #120406, 0 10px 30px rgba(0,0,0,0.7)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {timer}
        </div>
      </div>
      {/* The fight card. */}
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          bottom: 84,
          textAlign: "center",
        }}
      >
        {tag ? (
          <div
            style={{
              display: "inline-block",
              padding: "8px 34px 6px",
              background: RED,
              transform: `skewX(-14deg) scale(${tagIn})`,
              boxShadow: "6px 6px 0 #120406",
              marginBottom: 18,
            }}
          >
            <div
              style={{
                transform: "skewX(14deg)",
                fontFamily: DISPLAY,
                fontSize: 46,
                lineHeight: 1.1,
                letterSpacing: 4,
                color: "#fff",
              }}
            >
              {tag}
            </div>
          </div>
        ) : null}
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: size,
            lineHeight: 1.02,
            letterSpacing: 1,
            color: "transparent",
            // The gradient repeats per line so a two-line heading is gold on both lines.
            backgroundImage: `linear-gradient(180deg, #ffffff 0%, #fff6d6 42%, ${GOLD} 64%, #ff8a1f 100%)`,
            backgroundSize: `100% ${size * 1.02}px`,
            backgroundRepeat: "repeat-y",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            textWrap: "balance",
            WebkitTextStroke: `${Math.max(3, Math.round(size / 34))}px #140405`,
            filter:
              "drop-shadow(0 8px 0 #140405) drop-shadow(0 20px 40px rgba(0,0,0,0.7))",
            transform: `skewX(-8deg) scale(${1.5 - 0.5 * headIn})`,
            opacity: headIn,
            padding: "0 24px",
          }}
        >
          {title}
        </div>
        {sub ? (
          <div
            style={{
              marginTop: 18,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 30,
              letterSpacing: 6,
              color: "rgba(255,255,255,0.92)",
              textShadow: "0 4px 18px rgba(0,0,0,0.8)",
              opacity: subIn,
              transform: `translateY(${(1 - subIn) * 14}px)`,
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
      <AbsoluteFill style={{ background: "#fffaf0", opacity: flash }} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */

const HIT = 34;

function versusRows(g: GfxProps["g"]) {
  const rows = quantityRows(g.items);
  return rows.length === 2 && g.items.filter((x) => x.trim()).length === 2
    ? rows
    : [];
}

const fitsVersus = (g: GfxProps["g"]) => {
  const rows = versusRows(g);
  return (
    rows.length === 2 &&
    rows.every((r) => r.label.length <= 30 && r.fig.text.length <= 18) &&
    clean(g.primary).length <= 48 &&
    clean(g.secondary).length <= 48
  );
};

/** Two "label: value" rows as two fighters' health bars facing off; the smaller takes the hit. */
const VersusStyle: React.FC<GfxProps> = ({ g, len }) => {
  const { frame, fps, dim, visible } = useStage(len, 190);
  const rows = versusRows(g);
  if (!visible || !fitsVersus(g)) return null;
  const max = Math.max(...rows.map((r) => r.fig.scaled));
  const share = rows.map((r) => Math.max(0.06, r.fig.scaled / max));
  const head = clean(g.primary).toUpperCase();
  const foot = clean(g.secondary).toUpperCase();
  const enter = spring({ frame, fps, config: SPRING.ENTER });
  const fill = interpolate(frame, [6, 26], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.quad),
  });
  // The hit: the smaller bar drops at once to its share, the red trail behind it catches up.
  const hitP = interpolate(frame, [HIT, HIT + 4], [0, 1], clamp);
  const trail = interpolate(frame, [HIT + 10, HIT + 34], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const s = shake(frame, HIT, 14);
  const flash = interpolate(
    frame,
    [HIT - 1, HIT, HIT + 6],
    [0, 0.55, 0],
    clamp,
  );
  const vs = spring({ frame: frame - 10, fps, config: SPRING.POP });
  const BW = 680;
  const valueSize =
    Math.max(...rows.map((r) => r.fig.text.length)) > 11 ? 74 : 100;
  const side = (i: number) => {
    const r = rows[i]!;
    const l = i === 0;
    const loser = share[i]! < 1;
    const now = loser ? 1 - (1 - share[i]!) * hitP : 1;
    const ghost = loser ? 1 - (1 - share[i]!) * trail : 1;
    const nameIn = spring({
      frame: frame - 8 - i * 4,
      fps,
      config: SPRING.ENTER,
    });
    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          [l ? "right" : "left"]: 1920 / 2 + 115,
          width: BW,
          textAlign: l ? "right" : "left",
        }}
      >
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 42,
            lineHeight: 1.1,
            color: "#fff",
            textTransform: "uppercase",
            letterSpacing: 1,
            opacity: nameIn,
            transform: `translateX(${(1 - nameIn) * (l ? -60 : 60)}px)`,
            textShadow: "0 4px 16px rgba(0,0,0,0.7)",
            minHeight: 46,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: l ? "flex-end" : "flex-start",
          }}
        >
          {r.label}
        </div>
        <div
          style={{
            marginTop: 16,
            height: 58,
            transform: `skewX(${l ? 18 : -18}deg)`,
            background: "#12060a",
            border: "4px solid #fff7e6",
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 10px 30px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{ position: "absolute", inset: 3, background: "#3a0a12" }}
          />
          {/* The red trail (recent damage), then the gold health. Anchored at the centre, as bars face off. */}
          <div
            style={{
              position: "absolute",
              top: 3,
              bottom: 3,
              [l ? "right" : "left"]: 3,
              width: `calc(${fill * ghost * 100}% - 6px)`,
              background: "#ff2a3a",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 3,
              bottom: 3,
              [l ? "right" : "left"]: 3,
              width: `calc(${fill * now * 100}% - 6px)`,
              background: `linear-gradient(180deg, #fff3a8 0%, ${GOLD} 40%, #f0a400 100%)`,
            }}
          />
          {loser ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "#fff",
                opacity: interpolate(
                  frame,
                  [HIT, HIT + 1, HIT + 8],
                  [0, 0.85, 0],
                  clamp,
                ),
              }}
            />
          ) : null}
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: DISPLAY,
            fontSize: valueSize,
            lineHeight: 1,
            color: "transparent",
            backgroundImage: `linear-gradient(180deg, #ffffff 0%, #fff4c2 45%, ${GOLD} 70%, #ff8a1f 100%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextStroke: "3px #140405",
            filter: "drop-shadow(0 6px 0 #140405)",
            opacity: nameIn,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            padding: "0 8px",
          }}
        >
          {r.fig.text}
        </div>
      </div>
    );
  };
  return (
    <AbsoluteFill style={{ opacity: dim, pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(100deg, rgba(70,4,14,0.93) 0%, rgba(40,4,10,0.9) 48%, rgba(4,10,44,0.9) 52%, rgba(6,20,90,0.93) 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.12,
          backgroundImage:
            "repeating-linear-gradient(62deg, rgba(255,255,255,0.6) 0 2px, transparent 2px 36px)",
        }}
      />
      <AbsoluteFill style={{ transform: `translate(${s.x}px, ${s.y}px)` }}>
        {head ? (
          <div
            style={{
              position: "absolute",
              top: 190,
              left: 96,
              right: 96,
              textAlign: "center",
              opacity: enter,
              transform: `translateY(${(1 - enter) * -30}px)`,
            }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "10px 34px 8px",
                background: "#fff7e6",
                transform: "skewX(-14deg)",
                boxShadow: `6px 6px 0 ${RED}, -6px -6px 0 ${BLUE}`,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  transform: "skewX(14deg)",
                  fontFamily: DISPLAY,
                  fontSize: 54,
                  lineHeight: 1.05,
                  letterSpacing: 3,
                  color: "#140405",
                }}
              >
                {head}
              </span>
            </span>
          </div>
        ) : null}
        <div style={{ position: "absolute", left: 0, right: 0, top: 400 }}>
          {side(0)}
          {side(1)}
        </div>
        <div
          style={{
            position: "absolute",
            left: 960 - 100,
            top: 418,
            width: 200,
            textAlign: "center",
            transform: `scale(${vs}) rotate(${(1 - vs) * -20}deg)`,
            fontFamily: DISPLAY,
            fontSize: 140,
            lineHeight: 1,
            color: "#fff",
            WebkitTextStroke: "4px #140405",
            textShadow: `5px 5px 0 ${RED}, -5px -5px 0 ${BLUE}`,
          }}
        >
          VS
        </div>
        {foot ? (
          <div
            style={{
              position: "absolute",
              left: 96,
              right: 96,
              top: 700,
              textAlign: "center",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 32,
              letterSpacing: 6,
              color: "rgba(255,255,255,0.9)",
              opacity: interpolate(frame, [20, 32], [0, 1], clamp),
            }}
          >
            {foot}
          </div>
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
    </AbsoluteFill>
  );
};

export const FightingCard = Card;
export const FIGHTING_STYLES: Record<string, GfxStyle> = {
  Versus: {
    kind: "compare",
    component: VersusStyle,
    fits: fitsVersus,
    sound: "stamp",
  },
};
