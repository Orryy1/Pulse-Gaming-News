import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLOUR } from "../../brand.ts";
import { CONTENT_WIDTH } from "../../layout.ts";
import { ease, FRAMES } from "../../motion.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import type { BarRow } from "./helpers.ts";

/** Horizontal comparison bars growing from the cue, values counting in step, the subject row in accent. */
export const BarCompare: React.FC<{ rows: BarRow[]; label?: string; accent: string }> = ({ rows, label, accent }) => {
  const frame = useCurrentFrame();
  const t = frame - FRAMES.ruleLead;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const labelW = 300;
  const barMax = CONTENT_WIDTH - labelW - 180;
  return (
    <div style={{ width: CONTENT_WIDTH }}>
      {label ? <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 32, letterSpacing: 2, color: COLOUR.muted, textTransform: "uppercase", marginBottom: 14 }}>{label}</div> : null}
      {rows.map((r, i) => {
        const p = interpolate(t - i * 3, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
        const w = Math.max(12, barMax * (r.value / max) * p);
        const shown = r.display.replace(/[\d,]+(\.\d+)?/, (num) => {
          const n = Number(num.replace(/,/g, ""));
          if (!Number.isFinite(n)) return num;
          const v = n * p;
          const fixed = num.includes(".") ? v.toFixed(num.split(".")[1]!.length) : String(Math.round(v));
          return num.includes(",") ? Number(fixed).toLocaleString("en-GB") : fixed;
        });
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 18, height: 72, opacity: Math.min(1, p * 2) }}>
            <div style={{ width: labelW, fontFamily: BODY, fontWeight: 800, fontSize: 30, color: r.highlight ? COLOUR.paper : COLOUR.muted, textTransform: "uppercase", letterSpacing: 1, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
            <div style={{ width: w, height: 48, borderRadius: 6, background: r.highlight ? accent : "rgba(245,245,242,0.28)", boxShadow: r.highlight ? `0 0 24px ${accent}66` : undefined }} />
            <div style={{ fontFamily: DISPLAY, fontSize: 52, color: r.highlight ? COLOUR.paper : COLOUR.muted, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{shown}</div>
          </div>
        );
      })}
    </div>
  );
};
