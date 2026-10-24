import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../../brand.ts";
import { CARD_WIDTH } from "../../layout.ts";
import { SPRING, ease, FRAMES } from "../../motion.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import {
  dateLabel,
  platformColour,
  type Milestone,
  type Pair,
} from "./helpers.ts";

const Label: React.FC<{ text?: string }> = ({ text }) =>
  text ? (
    <div
      style={{
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: 32,
        letterSpacing: 2,
        color: COLOUR.muted,
        textTransform: "uppercase",
        marginBottom: 18,
      }}
    >
      {text}
    </div>
  ) : null;

/** Where a game is out: platform chips in each platform's colour, popping in one after another. */
export const Platforms: React.FC<{
  platforms: string[];
  label?: string;
  note?: string;
  accent: string;
}> = ({ platforms, label, note, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - FRAMES.ruleLead;
  const big = platforms.length <= 3;
  return (
    <div style={{ width: CARD_WIDTH }}>
      <Label text={label} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        {platforms.map((p, i) => {
          const pop = spring({ frame: t - i * 5, fps, config: SPRING.POP });
          return (
            <div
              key={p}
              style={{
                padding: big ? "22px 34px" : "16px 26px",
                background: platformColour(p),
                borderRadius: 14,
                fontFamily: DISPLAY,
                fontSize: big ? 76 : 56,
                lineHeight: 1,
                color: "#FFFFFF",
                letterSpacing: 1,
                textTransform: "uppercase",
                boxShadow:
                  "0 18px 50px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255,255,255,0.18)",
                transform: `scale(${pop})`,
                transformOrigin: "left center",
                whiteSpace: "nowrap",
              }}
            >
              {p}
            </div>
          );
        })}
      </div>
      {note ? (
        <div
          style={{
            marginTop: 22,
            display: "inline-block",
            padding: "8px 18px",
            background: accent,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 30,
            letterSpacing: 2,
            borderRadius: 8,
            opacity: spring({
              frame: t - platforms.length * 5 - 6,
              fps,
              config: SPRING.SNAP,
            }),
          }}
        >
          {note.toUpperCase()}
        </div>
      ) : null}
    </div>
  );
};

/** Two things side by side with a VS badge between them; the subject side in accent. */
export const Versus: React.FC<{
  a: Pair;
  b: Pair;
  label?: string;
  accent: string;
}> = ({ a, b, label, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - FRAMES.ruleLead;
  const left = spring({ frame: t, fps, config: SPRING.ENTER });
  const right = spring({ frame: t - 6, fps, config: SPRING.ENTER });
  const badge = spring({ frame: t - 14, fps, config: SPRING.POP });
  const side = (p: Pair, inP: number, dir: 1 | -1) => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: "26px 24px",
        borderRadius: 14,
        background: p.highlight ? `${accent}26` : "rgba(245,245,242,0.06)",
        border: `3px solid ${p.highlight ? accent : "rgba(245,245,242,0.2)"}`,
        opacity: inP,
        transform: `translateX(${(1 - inP) * 30 * dir}px)`,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 30,
          letterSpacing: 1.5,
          color: p.highlight ? COLOUR.paper : COLOUR.muted,
          textTransform: "uppercase",
          lineHeight: 1.15,
          minHeight: 70,
        }}
      >
        {p.label}
      </div>
      <div
        style={{
          marginTop: 12,
          fontFamily: DISPLAY,
          fontSize: p.value.length > 8 ? 64 : 92,
          lineHeight: 1,
          color: COLOUR.paper,
          fontVariantNumeric: "tabular-nums",
          overflowWrap: "anywhere",
        }}
      >
        {p.value}
      </div>
    </div>
  );
  return (
    <div style={{ width: CARD_WIDTH }}>
      <Label text={label} />
      <div
        style={{
          position: "relative",
          display: "flex",
          gap: 40,
          alignItems: "stretch",
        }}
      >
        {side(a, left, -1)}
        {side(b, right, 1)}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 84,
            height: 84,
            marginLeft: -42,
            marginTop: -42,
            borderRadius: 42,
            background: accent,
            color: COLOUR.ink,
            fontFamily: DISPLAY,
            fontSize: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${badge})`,
            boxShadow: `0 0 30px ${accent}88`,
          }}
        >
          VS
        </div>
      </div>
    </div>
  );
};

/** A spec sheet: label on the left, value on the right, rows wiping in. */
export const Specs: React.FC<{
  rows: Pair[];
  label?: string;
  accent: string;
}> = ({ rows, label, accent }) => {
  const frame = useCurrentFrame();
  const t = frame - FRAMES.ruleLead;
  const tight = rows.length > 4;
  return (
    <div style={{ width: CARD_WIDTH }}>
      <Label text={label} />
      {rows.map((r, i) => {
        const p = interpolate(t - i * 4, [0, 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: ease.out,
        });
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 24,
              padding: tight ? "12px 0" : "16px 0",
              borderBottom:
                i < rows.length - 1
                  ? "2px solid rgba(245,245,242,0.14)"
                  : undefined,
              opacity: p,
              transform: `translateX(${(1 - p) * 24}px)`,
            }}
          >
            <div
              style={{
                flex: "none",
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: tight ? 26 : 30,
                letterSpacing: 1.5,
                color: COLOUR.muted,
                textTransform: "uppercase",
              }}
            >
              {r.label}
            </div>
            <div
              style={{
                textAlign: "right",
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: tight ? 34 : 40,
                color: r.highlight ? accent : COLOUR.paper,
                lineHeight: 1.1,
                overflowWrap: "anywhere",
              }}
            >
              {r.value}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Several dates on one line of history: dots light up in order, the last one (the news) in accent. */
export const Milestones: React.FC<{
  points: Milestone[];
  label?: string;
  accent: string;
}> = ({ points, label, accent }) => {
  const frame = useCurrentFrame();
  const t = frame - FRAMES.ruleLead;
  const rowH = points.length > 4 ? 78 : 92;
  const track = interpolate(t, [0, 10 + points.length * 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease.inOut,
  });
  return (
    <div style={{ width: CARD_WIDTH }}>
      <Label text={label} />
      <div style={{ position: "relative", paddingLeft: 56 }}>
        <div
          style={{
            position: "absolute",
            left: 17,
            top: 18,
            width: 6,
            height: Math.max(0, (points.length - 1) * rowH * track),
            background: "rgba(245,245,242,0.35)",
            borderRadius: 3,
          }}
        />
        {points.map((pt, i) => {
          const last = i === points.length - 1;
          const p = interpolate(t - 8 - i * 8, [0, 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease.out,
          });
          return (
            <div
              key={i}
              style={{
                position: "relative",
                height: rowH,
                display: "flex",
                alignItems: "center",
                gap: 26,
                opacity: Math.max(0.15, p),
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: -56 + 4,
                  width: last ? 36 : 28,
                  height: last ? 36 : 28,
                  marginLeft: last ? -4 : 0,
                  borderRadius: 18,
                  background: last ? accent : COLOUR.paper,
                  boxShadow: last ? `0 0 24px ${accent}` : undefined,
                  transform: `scale(${p})`,
                }}
              />
              <div
                style={{
                  flex: "none",
                  width: 300,
                  fontFamily: DISPLAY,
                  fontSize: last ? 54 : 46,
                  color: last ? accent : COLOUR.paper,
                  lineHeight: 1,
                }}
              >
                {dateLabel(pt.date)}
              </div>
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 32,
                  color: last ? COLOUR.paper : COLOUR.muted,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  lineHeight: 1.1,
                }}
              >
                {pt.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
