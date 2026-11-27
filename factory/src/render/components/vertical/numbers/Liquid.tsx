// Numbers/Liquid: the figure drawn as an outline that fills from the bottom like a glass, a wave and a bright
// meniscus on the surface, the liquid shading from a pale top to a deep base. Once full, a slow sheen keeps
// it alive. The wave is a clip polygon on plain text: no filters, a few copies of one word.
import React from "react";
import { interpolate, spring } from "remotion";
import { DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import type { VGfxProps } from "../types.ts";
import {
  H,
  Label,
  Pool,
  W,
  alpha,
  antonFit,
  clamp,
  clean,
  exitStyle,
  fitLabel,
  labelFits,
  mix,
  useBeat,
} from "./kit.tsx";

const MAX = 380;
const STEPS = 18;

/** The liquid's outline: a sine surface at `top` percent, amplitude `amp`, then down to the bottom. */
function surface(top: number, amp: number, phase: number, below = 0): string[] {
  const pts: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const x = (i / STEPS) * 100;
    const y = top + below + amp * Math.sin((i / STEPS) * Math.PI * 3 + phase);
    pts.push(`${x.toFixed(1)}% ${y.toFixed(2)}%`);
  }
  return pts;
}

export const Liquid: React.FC<VGfxProps> = ({
  v,
  len,
  accent,
  variant = 0,
}) => {
  const { frame, fps, out, visible } = useBeat(len);
  const figure = clean(v.primary).toUpperCase();
  const label = clean(v.secondary);
  if (!visible || !figure) return null;
  const lab = label ? fitLabel(label, W - 40, 46, 2) : undefined;
  const labelH = lab ? lab.lines.length * lab.size * 1.12 + 24 : 0;
  const size = Math.min(
    antonFit(figure, W - 40, MAX),
    Math.floor((H - labelH - 10) / 0.9),
  );
  // The pour: quick at first, easing as the glass fills; full (and over the brim, so no gap) by frame 17.
  const level = interpolate(frame, [2, 17], [0, 1.08], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 2.2,
  });
  const amp = 3.2 * (1 - Math.min(1, level) * 0.85) + (level < 1 ? 0.6 : 0);
  const phase = frame * 0.42 + variant * 1.3;
  // Anton's glyphs sit between about 6% and 94% of a 0.9 line: level 0 is the floor, 1 the cap line.
  const top = 94 - level * 88;
  const wave = surface(top, amp, phase);
  const fill = `polygon(${[...wave, "100% 100%", "0% 100%"].join(", ")})`;
  const band = `polygon(${[...wave, ...surface(top, amp, phase, 2.4).reverse()].join(", ")})`;
  const enter = spring({ frame, fps, config: SPRING.POP });
  const shimmer = interpolate((frame - 18) % 60, [0, 30], [130, -30], clamp);
  const rise = interpolate(frame, [9, 18], [0, 1], clamp);
  const word: React.CSSProperties = {
    fontFamily: DISPLAY,
    fontSize: size,
    lineHeight: 0.9,
    whiteSpace: "nowrap",
    letterSpacing: "0.005em",
    textAlign: "center",
  };
  const deep = mix(accent, "#000000", 0.42);
  const pale = mix(accent, "#ffffff", 0.35);
  return (
    <div style={{ position: "absolute", inset: 0, ...exitStyle(out) }}>
      <Pool opacity={interpolate(frame, [0, 6], [0, 1], clamp)} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            transform: `scale(${1.12 - 0.12 * enter})`,
            opacity: interpolate(frame, [0, 3], [0, 1], clamp),
          }}
        >
          {/* The glass: the empty outline, a faint tint inside it so the shape reads before the pour. */}
          <div
            style={{
              ...word,
              color: "rgba(10,10,12,0.5)",
              WebkitTextStroke: `4px ${accent}`,
              textShadow: "0 16px 40px rgba(0,0,0,0.7)",
            }}
          >
            {figure}
          </div>
          <div
            style={{
              ...word,
              position: "absolute",
              inset: 0,
              clipPath: fill,
              color: alpha(accent, 0.9),
              textShadow: `0 0 40px ${alpha(accent, 0.5)}`,
            }}
          >
            {figure}
          </div>
          <div
            style={{
              ...word,
              position: "absolute",
              inset: 0,
              clipPath: fill,
              color: "transparent",
              backgroundImage: `linear-gradient(105deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.45) 50%, rgba(255,255,255,0) 60%), linear-gradient(180deg, ${pale} 0%, ${accent} 45%, ${deep} 100%)`,
              backgroundSize: "300% 100%, 100% 100%",
              backgroundPosition: `${shimmer}% 0, 0 0`,
              backgroundRepeat: "no-repeat",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextStroke: `4px ${accent}`,
            }}
          >
            {figure}
          </div>
          {level < 1.06 ? (
            <div
              style={{
                ...word,
                position: "absolute",
                inset: 0,
                clipPath: band,
                color: mix(accent, "#ffffff", 0.7),
              }}
            >
              {figure}
            </div>
          ) : null}
        </div>
        {lab ? (
          <div style={{ marginTop: 18 }}>
            <Label text={label} width={W - 40} rise={rise} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const fitsLiquid = (v: VGfxProps["v"]) => {
  const f = clean(v.primary);
  return (
    /\d/.test(f) &&
    f.length <= 12 &&
    antonFit(f.toUpperCase(), W - 40, MAX) >= 160 &&
    labelFits(clean(v.secondary), W - 40)
  );
};
