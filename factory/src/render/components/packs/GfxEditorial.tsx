// Graphic pack: Editorial. Signature looks of the big documentary channels: a giant figure with the
// game showing through its digits, a quote over the speaker's duotone portrait, and a release that
// slipped shown on a departures board.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring } from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { SPRING } from "../../motion.ts";
import { displayText } from "../../timeline.ts";
import { useStage } from "../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "./types.ts";
import { maskLayers, Preload } from "./preload.tsx";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The figure filling the frame, the game's picture moving inside its letters, the label beneath. */
const TextMask: React.FC<GfxProps> = ({ g, len, src }) => {
  const { frame, fps, dim, visible, showFor } = useStage(len, 170);
  const figure = displayText(g.primary).toUpperCase();
  if (!visible || !figure) return null;
  const s = spring({ frame, fps, config: SPRING.ENTER });
  const drift = interpolate(frame, [0, showFor], [0, -60], clamp);
  const size = figure.length > 12 ? 230 : figure.length > 8 ? 290 : 360;
  const label = interpolate(frame, [16, 30], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ opacity: dim, background: "#070709" }}>
      <Preload src={src} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            transform: `scale(${1.25 - 0.25 * s})`,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: size,
              lineHeight: 0.92,
              letterSpacing: -2,
              whiteSpace: "nowrap",
              color: src ? "transparent" : COLOUR.amber,
              backgroundImage: src ? maskLayers(src) : undefined,
              backgroundSize: "cover",
              backgroundPosition: `${50 + drift / 10}% 50%`,
              WebkitBackgroundClip: src ? "text" : undefined,
              backgroundClip: src ? "text" : undefined,
              // The picture inside the letters lifted so a dark frame still reads, the letters edged in light.
              filter: src
                ? "brightness(1.55) saturate(1.35) contrast(1.1) drop-shadow(0 20px 60px rgba(255,107,26,0.3))"
                : "drop-shadow(0 20px 60px rgba(255,107,26,0.25))",
              WebkitTextStroke: src ? "2px rgba(255,236,220,0.55)" : undefined,
            }}
          >
            {figure}
          </div>
          {/* A thin amber outline so the figure reads even over a dark picture. */}
          <div
            style={{
              height: 8,
              width: `${label * 60}%`,
              margin: "18px auto 0",
              background: COLOUR.amber,
              borderRadius: 4,
            }}
          />
          {g.secondary ? (
            <div
              style={{
                marginTop: 22,
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 40,
                letterSpacing: 6,
                color: COLOUR.paper,
                textTransform: "uppercase",
                opacity: label,
                transform: `translateY(${(1 - label) * 16}px)`,
              }}
            >
              {displayText(g.secondary)}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The quote over the speaker's portrait in amber duotone (their initials when there is none). */
const DuotoneQuote: React.FC<GfxProps> = ({ g, len, photos }) => {
  const text = displayText(g.primary)
    .replace(/^["“]+|["”]+$/g, "")
    .trim();
  const words = text.split(/\s+/).filter(Boolean);
  const { frame, fps, dim, visible, showFor } = useStage(
    len,
    Math.max(130, Math.min(260, 50 + words.length * 8)),
  );
  if (!visible || !words.length) return null;
  const who = displayText(g.secondary);
  const name = who.split(",")[0]!.trim();
  const photo = photos?.[name.toLowerCase()];
  const push = interpolate(frame, [0, showFor], [1.04, 1.12], clamp);
  const step = Math.max(1.5, Math.min(4, 60 / words.length));
  const size = words.length > 24 ? 50 : words.length > 14 ? 60 : 72;
  const credit = spring({
    frame: frame - (12 + words.length * step),
    fps,
    config: SPRING.ENTER,
  });
  return (
    <AbsoluteFill style={{ opacity: dim, background: "#120a06" }}>
      <AbsoluteFill style={{ left: "auto", width: 900, overflow: "hidden" }}>
        {photo ? (
          <>
            <Img
              src={photo}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center 25%",
                transform: `scale(${push})`,
                filter: "grayscale(1) contrast(1.25) brightness(0.9)",
              }}
            />
            <AbsoluteFill
              style={{ background: COLOUR.amber, mixBlendMode: "multiply" }}
            />
          </>
        ) : (
          <AbsoluteFill
            style={{
              alignItems: "center",
              justifyContent: "center",
              background: `radial-gradient(70% 70% at 60% 40%, #7a3410 0%, #2a1206 70%)`,
              fontFamily: DISPLAY,
              fontSize: 420,
              color: "rgba(255,170,110,0.25)",
            }}
          >
            {name
              .split(/\s+/)
              .map((w) => w[0])
              .join("")
              .slice(0, 2)}
          </AbsoluteFill>
        )}
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(90deg, #120a06 0%, rgba(18,10,6,0.6) 30%, rgba(18,10,6,0) 60%)",
          }}
        />
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 110, top: 200, width: 1080 }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 200,
            lineHeight: 0.6,
            color: COLOUR.amber,
            height: 90,
          }}
        >
          {"“"}
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1.18,
            color: COLOUR.paper,
          }}
        >
          {words.map((w, i) => {
            const o = interpolate(
              frame,
              [10 + i * step, 16 + i * step],
              [0, 1],
              clamp,
            );
            return (
              <span
                key={i}
                style={{
                  opacity: o,
                  display: "inline-block",
                  marginRight: "0.28em",
                  transform: `translateY(${(1 - o) * 12}px)`,
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
        {who ? (
          <div
            style={{
              marginTop: 34,
              display: "flex",
              alignItems: "center",
              gap: 18,
              opacity: credit,
              transform: `translateX(${(1 - credit) * -30}px)`,
            }}
          >
            <div style={{ width: 60, height: 5, background: COLOUR.amber }} />
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 30,
                letterSpacing: 3,
                color: COLOUR.amber,
                textTransform: "uppercase",
              }}
            >
              {who}
            </div>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const FLAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** A departures board: the release on its row, the old date, then DELAYED blinking and the new date. */
const Departures: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const { frame, fps, dim, visible } = useStage(len, 200);
  const [before, after] = g.items.map((x) => displayText(x).toUpperCase());
  if (!visible || !before || !after) return null;
  const what = displayText(g.primary).toUpperCase() || "RELEASE";
  const flip = (text: string, at: number) =>
    text.split("").map((ch, i) => {
      const settle = at + i * 1.2;
      const shown =
        frame >= settle || ch === " "
          ? ch
          : FLAP[Math.floor(frame * 1.7 + i * 7 + variant) % FLAP.length]!;
      return (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: "0.66em",
            textAlign: "center",
            margin: "0 2px",
            background: frame < settle ? "#1d1f24" : "#16181c",
            borderRadius: 4,
            boxShadow:
              "inset 0 -2px 0 rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,255,255,0.04)",
          }}
        >
          {frame < at - 4 ? " " : shown}
        </span>
      );
    });
  const delayed = frame >= 46;
  const blink = delayed && Math.floor((frame - 46) / 10) % 2 === 0;
  const row = (
    label: string,
    value: React.ReactNode,
    colour: string,
    k: number,
  ) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 30,
        padding: "18px 30px",
        borderTop: "2px solid rgba(255,255,255,0.06)",
        opacity: interpolate(frame, [k * 6, k * 6 + 8], [0, 1], clamp),
      }}
    >
      <div
        style={{
          width: 280,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 24,
          letterSpacing: 4,
          color: "rgba(245,245,242,0.55)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Courier New', Courier, monospace",
          fontWeight: 700,
          fontSize: 52,
          color: colour,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
  const enter = spring({ frame, fps, config: SPRING.ENTER });
  return (
    <AbsoluteFill
      style={{
        opacity: dim,
        background: "rgba(5,6,8,0.88)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 1500,
          background: "#0d0e11",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 40px 120px rgba(0,0,0,0.7)",
          transform: `translateY(${(1 - enter) * 50}px)`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "22px 30px",
            background: "#16181d",
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 34,
              letterSpacing: 8,
              color: COLOUR.paper,
            }}
          >
            DEPARTURES
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 22,
              letterSpacing: 4,
              color: COLOUR.amber,
            }}
          >
            LAUNCH SCHEDULE
          </div>
        </div>
        {row("TITLE", flip(what.slice(0, 26), 6), COLOUR.paper, 0)}
        {row(
          "SCHEDULED",
          flip(before.slice(0, 22), 18),
          "rgba(245,245,242,0.6)",
          1,
        )}
        {row(
          "STATUS",
          <span
            style={{
              color: "#ff4d3a",
              opacity: delayed ? (blink ? 1 : 0.35) : 0,
              letterSpacing: 6,
            }}
          >
            DELAYED
          </span>,
          "#ff4d3a",
          2,
        )}
        {row("NOW", flip(after.slice(0, 22), 60), COLOUR.amber, 3)}
        {g.secondary ? (
          <div
            style={{
              padding: "16px 30px 24px",
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 26,
              color: "rgba(245,245,242,0.7)",
              borderTop: "2px solid rgba(255,255,255,0.06)",
              opacity: interpolate(frame, [70, 82], [0, 1], clamp),
            }}
          >
            {displayText(g.secondary)}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const STYLES: Record<string, GfxStyle> = {
  TextMask: {
    kind: "stat",
    component: TextMask,
    fits: (g) => /\d/.test(g.primary) && g.primary.length <= 16,
    sound: "pop",
  },
  DuotoneQuote: {
    kind: "quote",
    component: DuotoneQuote,
    fits: (g) => {
      const n = g.primary.split(/\s+/).filter(Boolean).length;
      return n >= 4 && n <= 34;
    },
    sound: "pop",
  },
  Departures: {
    kind: "delay",
    component: Departures,
    fits: (g) =>
      g.items.length === 2 &&
      g.items.every((x) => x.length <= 22) &&
      g.primary.length <= 26,
    sound: "glint",
  },
};
