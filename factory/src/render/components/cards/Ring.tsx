import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../../brand.ts";
import { CONTENT_WIDTH } from "../../layout.ts";
import { SPRING, FRAMES } from "../../motion.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { bandColour } from "./helpers.ts";

/** Score ring (0-100) with the number counting in step and outlet chips staggering in. */
export const Ring: React.FC<{ value: number; label?: string; chips?: string[]; suffix?: string }> = ({ value, label, chips = [], suffix = "" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - FRAMES.ruleLead;
  const p = interpolate(t, [0, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (x) => 1 - Math.pow(1 - x, 4) });
  const colour = bandColour(value);
  const r = 150;
  const stroke = 28;
  const c = 2 * Math.PI * r;
  const shown = Math.round(value * p);
  return (
    <div style={{ position: "relative", width: CONTENT_WIDTH, height: 360, display: "flex", alignItems: "center", gap: 40 }}>
      <svg width={r * 2 + stroke} height={r * 2 + stroke} viewBox={`0 0 ${r * 2 + stroke} ${r * 2 + stroke}`} style={{ flex: "none" }}>
        <circle cx={r + stroke / 2} cy={r + stroke / 2} r={r} fill="none" stroke="rgba(245,245,242,0.12)" strokeWidth={stroke} />
        <circle
          cx={r + stroke / 2}
          cy={r + stroke / 2}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (value / 100) * p)}
          transform={`rotate(-90 ${r + stroke / 2} ${r + stroke / 2})`}
        />
        <text x={r + stroke / 2} y={r + stroke / 2 + 40} textAnchor="middle" fontFamily={DISPLAY} fontSize={120} fill={COLOUR.paper}>
          {shown}
          {suffix}
        </text>
      </svg>
      <div style={{ minWidth: 0 }}>
        {label ? <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 34, letterSpacing: 2, color: COLOUR.muted, textTransform: "uppercase", lineHeight: 1.1 }}>{label}</div> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
          {chips.slice(0, 3).map((chip, i) => {
            const s = spring({ frame: t - 12 - i * 4, fps, config: SPRING.SNAP });
            return (
              <div key={i} style={{ padding: "8px 16px", border: `2px solid ${colour}`, borderRadius: 8, fontFamily: BODY, fontWeight: 800, fontSize: 30, color: COLOUR.paper, transform: `scale(${s})`, opacity: s, whiteSpace: "nowrap" }}>
                {chip}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
