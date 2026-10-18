// The premium layer of the long-form video, sentence by sentence: an animated
// graphic for the fact a sentence states (a stat that counts up, a date badge,
// a score dial, a list that builds, bars that grow), a picture that pops in
// beside the footage with its caption, a kinetic caption for a name worth
// landing, a flash-punch between entries, and a constant film grain and
// vignette. All timing comes from the sentence windows the planner uses.

import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { displayText } from "../timeline.ts";

export interface MomentGraphic {
  kind: "none" | "stat" | "date" | "score" | "list" | "compare";
  primary: string;
  secondary: string;
  items: string[];
}

export interface MomentProp {
  show: string;
  graphic: MomentGraphic;
  emphasis: string;
}

const RIGHT = 96;
const TOP = 128;

const panel: React.CSSProperties = {
  background: "rgba(11,11,14,0.82)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
  padding: "26px 32px",
};

function useInOut(len: number, hold = 150) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const showFor = Math.min(hold, Math.max(45, len - 10));
  const inP = spring({ frame, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [showFor - 12, showFor], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { frame, fps, inP, out, visible: frame <= showFor };
}

function countUp(primary: string, p: number): string {
  const m = primary.match(/^([^\d]*)([\d,.]+)(.*)$/);
  if (!m) return primary;
  const raw = m[2]!.replace(/,/g, "");
  const target = Number(raw);
  if (!Number.isFinite(target) || /^(19|20)\d\d$/.test(raw)) return primary;
  const decimals = raw.includes(".") ? raw.split(".")[1]!.length : 0;
  const v = target * p;
  const shown = decimals
    ? v.toFixed(decimals)
    : Math.round(v).toLocaleString("en-US");
  return `${m[1]}${shown}${m[3]}`;
}

const numberIn = (t: string) =>
  Number((t.match(/[\d,.]+/)?.[0] ?? "").replace(/,/g, ""));

/** The fact a sentence states, drawn as a graphic at the top right. */
export const MomentGraphicCard: React.FC<{ g: MomentGraphic; len: number }> = ({ g: raw, len }) => {
  const g = { ...raw, primary: displayText(raw.primary), secondary: displayText(raw.secondary), items: raw.items.map(displayText) };
  const { frame, fps, inP, out, visible } = useInOut(len);
  if (!visible || g.kind === "none") return null;
  const wrap: React.CSSProperties = {
    position: "absolute",
    right: RIGHT,
    top: TOP,
    maxWidth: 680,
    opacity: inP * out,
    transform: `translateX(${(1 - inP) * 60}px)`,
    ...panel,
  };
  const label = (t: string) => (
    <div
      style={{
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: 26,
        letterSpacing: 2,
        color: COLOUR.muted,
        textTransform: "uppercase",
        marginTop: 10,
      }}
    >
      {t}
    </div>
  );
  if (g.kind === "stat") {
    const p = interpolate(frame, [6, 42], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (x) => 1 - (1 - x) ** 3,
    });
    return (
      <div style={wrap}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: g.primary.length > 14 ? 84 : 112,
            lineHeight: 1,
            color: COLOUR.amber,
            textTransform: "uppercase",
          }}
        >
          {countUp(g.primary, p)}
        </div>
        {g.secondary ? label(g.secondary) : null}
      </div>
    );
  }
  if (g.kind === "date") {
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 22 }}>
        <div
          style={{
            background: COLOUR.amber,
            color: COLOUR.ink,
            borderRadius: 12,
            padding: "12px 20px",
            fontFamily: DISPLAY,
            fontSize: 64,
            lineHeight: 1,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {g.primary}
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 32,
            color: COLOUR.paper,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {g.secondary}
        </div>
      </div>
    );
  }
  if (g.kind === "score") {
    const value = Math.max(0, Math.min(100, numberIn(g.primary) || 0));
    const p = spring({
      frame: frame - 6,
      fps,
      config: { damping: 30, stiffness: 60 },
    });
    const r = 70;
    const c = 2 * Math.PI * r;
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 26 }}>
        <svg width={170} height={170} viewBox="0 0 170 170">
          <circle
            cx={85}
            cy={85}
            r={r}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={14}
            fill="none"
          />
          <circle
            cx={85}
            cy={85}
            r={r}
            stroke={COLOUR.amber}
            strokeWidth={14}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - (value / 100) * p)}
            transform="rotate(-90 85 85)"
          />
          <text
            x={85}
            y={102}
            textAnchor="middle"
            fontFamily={DISPLAY}
            fontSize={56}
            fill={COLOUR.paper}
          >
            {Math.round(value * p)}
          </text>
        </svg>
        <div style={{ maxWidth: 380 }}>{label(g.secondary || "Score")}</div>
      </div>
    );
  }
  if (g.kind === "list") {
    return (
      <div style={wrap}>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 26,
            letterSpacing: 2.5,
            color: COLOUR.amber,
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          {g.primary}
        </div>
        {g.items.slice(0, 5).map((it, i) => {
          const s = spring({
            frame: frame - 10 - i * 9,
            fps,
            config: SPRING.SNAP,
          });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                opacity: s,
                transform: `translateX(${(1 - s) * 30}px)`,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 34,
                color: COLOUR.paper,
                padding: "6px 0",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: COLOUR.amber,
                  flex: "none",
                }}
              />
              {it}
            </div>
          );
        })}
      </div>
    );
  }
  // compare: two rows as label:value, bars grow to their share of the larger
  const rows = g.items
    .map((x) => {
      const i = x.lastIndexOf(":");
      return i > 0
        ? { label: x.slice(0, i).trim(), value: x.slice(i + 1).trim() }
        : undefined;
    })
    .filter((x): x is { label: string; value: string } => Boolean(x))
    .slice(0, 3);
  const max = Math.max(1, ...rows.map((r) => numberIn(r.value) || 0));
  return (
    <div style={{ ...wrap, width: 620 }}>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 26,
          letterSpacing: 2.5,
          color: COLOUR.amber,
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        {g.primary}
      </div>
      {rows.map((r, i) => {
        const s = spring({
          frame: frame - 8 - i * 8,
          fps,
          config: { damping: 22, stiffness: 90 },
        });
        const share = (numberIn(r.value) || 0) / max;
        return (
          <div key={i} style={{ marginBottom: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 28,
                color: COLOUR.paper,
              }}
            >
              <span>{r.label}</span>
              <span style={{ color: COLOUR.amber }}>{r.value}</span>
            </div>
            <div
              style={{
                height: 14,
                borderRadius: 7,
                background: "rgba(255,255,255,0.1)",
                marginTop: 8,
              }}
            >
              <div
                style={{
                  height: 14,
                  borderRadius: 7,
                  width: `${Math.max(4, share * 100 * s)}%`,
                  background: i === 0 ? COLOUR.amber : COLOUR.paper,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** A second picture of what is being said, framed and captioned, popping in beside the footage. */
export const PopInPicture: React.FC<{
  src: string;
  caption: string;
  len: number;
  side?: "left" | "right";
}> = ({ src, caption, len, side = "right" }) => {
  const { inP, out, visible } = useInOut(len, 120);
  if (!visible) return null;
  const tilt = side === "right" ? 2.2 : -2.2;
  return (
    <div
      style={{
        position: "absolute",
        [side]: RIGHT,
        bottom: 150,
        width: 480,
        opacity: inP * out,
        transform: `translateY(${(1 - inP) * 50}px) rotate(${tilt * inP}deg) scale(${0.9 + 0.1 * inP})`,
        transformOrigin: "center bottom",
      }}
    >
      <div
        style={{
          background: COLOUR.paper,
          padding: 10,
          borderRadius: 10,
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        <Img
          src={src}
          style={{
            width: "100%",
            height: 270,
            objectFit: "cover",
            display: "block",
            borderRadius: 4,
          }}
        />
      </div>
      {caption ? (
        <div
          style={{
            marginTop: 10,
            display: "inline-block",
            background: COLOUR.amber,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 22,
            letterSpacing: 1.5,
            padding: "6px 12px",
            borderRadius: 6,
            textTransform: "uppercase",
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
};

/** A name or phrase worth landing, word by word, with an underline swipe. */
export const KineticCaption: React.FC<{ text: string; len: number }> = ({ text: raw, len }) => {
  const text = displayText(raw);
  const { frame, fps, out, visible } = useInOut(len, 75);
  if (!visible || !text.trim()) return null;
  const words = text.toUpperCase().split(/\s+/).slice(0, 4);
  const swipe = interpolate(frame, [10, 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{ position: "absolute", left: 96, top: TOP + 20, opacity: out }}
    >
      <div style={{ display: "flex", gap: 22 }}>
        {words.map((w, i) => {
          const s = spring({ frame: frame - i * 4, fps, config: SPRING.POP });
          return (
            <span
              key={i}
              style={{
                fontFamily: DISPLAY,
                fontSize: 96,
                lineHeight: 1,
                color: COLOUR.paper,
                textShadow: "0 10px 40px rgba(0,0,0,0.7)",
                transform: `translateY(${(1 - s) * 40}px)`,
                opacity: s,
                display: "inline-block",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      <div
        style={{
          height: 8,
          marginTop: 12,
          width: `${swipe * 100}%`,
          background: COLOUR.amber,
          borderRadius: 4,
        }}
      />
    </div>
  );
};

/** A white punch between entries. */
export const FlashPunch: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 2, 10], [0, 0.42, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{ background: "#fff", opacity: o, pointerEvents: "none" }}
    />
  );
};

/** Film grain and a soft vignette over everything: it reads as graded footage, not a slideshow. */
export const GrainVignette: React.FC = () => {
  const frame = useCurrentFrame();
  const seed = frame % 8;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <svg
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.07,
          mixBlendMode: "overlay",
        }}
      >
        <filter id={`grain${seed}`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves={2}
            seed={seed}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** Licensed sound effects (public/sfx/rights.json, synthesised in-house), quiet under the narration. */
export const Sfx: React.FC<{
  name: "whoosh-short" | "swipe-tonal" | "tick-blip" | "punch-deep" | "riser-fast" | "sting";
  volume?: number;
}> = ({ name, volume = 0.28 }) => <Audio src={staticFile(`sfx/${name}.mp3`)} volume={volume} />;
