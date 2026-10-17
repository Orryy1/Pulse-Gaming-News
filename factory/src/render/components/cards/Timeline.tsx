import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../../brand.ts";
import { CONTENT_WIDTH } from "../../layout.ts";
import { SPRING, ease, FRAMES } from "../../motion.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { dateLabel, monthsBetween } from "./helpers.ts";

/**
 * Delay card: the old date desaturates, a dashed line extends, the new date
 * lands, and a delta pill snaps in. Track at the card's lower edge.
 */
export const Timeline: React.FC<{ from: string; to: string; delta?: string; label?: string; accent: string }> = ({ from, to, delta, label, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - FRAMES.ruleLead;
  const oldIn = spring({ frame: t, fps, config: SPRING.ENTER });
  const fade = interpolate(t, [20, 30], [1, 0.45], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const line = interpolate(t, [20, 36], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.inOut });
  const newIn = spring({ frame: t - 36, fps, config: SPRING.POP });
  const pill = spring({ frame: t - 54, fps, config: SPRING.SNAP });
  const months = monthsBetween(from, to);
  const deltaText = delta || (months !== undefined && months !== 0 ? `${months > 0 ? "+" : ""}${months} MONTH${Math.abs(months) === 1 ? "" : "S"}` : "");
  const W = CONTENT_WIDTH;
  const x0 = 24;
  const x1 = W - 24;
  return (
    <div style={{ position: "relative", width: W, height: 330 }}>
      {label ? <div style={{ position: "absolute", top: 0, left: 0, fontFamily: BODY, fontWeight: 800, fontSize: 32, letterSpacing: 2, color: COLOUR.muted, textTransform: "uppercase" }}>{label}</div> : null}
      {/* old date */}
      <div style={{ position: "absolute", left: x0, top: 70, opacity: oldIn * fade, transform: `translateY(${(1 - oldIn) * 18}px)` }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 72, color: COLOUR.paper, lineHeight: 1, textDecoration: fade < 1 ? "line-through" : "none", textDecorationColor: accent, textDecorationThickness: 6 }}>{dateLabel(from)}</div>
        <div style={{ marginTop: 8, fontFamily: BODY, fontWeight: 800, fontSize: 28, letterSpacing: 2, color: COLOUR.muted }}>WAS</div>
      </div>
      {/* new date */}
      <div style={{ position: "absolute", right: x0, top: 70, textAlign: "right", opacity: newIn, transform: `scale(${interpolate(newIn, [0, 1], [0.9, 1])})`, transformOrigin: "right top" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 96, color: accent, lineHeight: 1 }}>{dateLabel(to)}</div>
        <div style={{ marginTop: 8, fontFamily: BODY, fontWeight: 800, fontSize: 28, letterSpacing: 2, color: COLOUR.paper }}>NOW</div>
      </div>
      {/* track */}
      <div style={{ position: "absolute", left: x0, right: x0, top: 250, height: 6, background: "rgba(245,245,242,0.18)", borderRadius: 3 }} />
      <div style={{ position: "absolute", left: x0, top: 250, width: (x1 - x0) * line, height: 6, background: `repeating-linear-gradient(90deg, ${accent} 0 18px, transparent 18px 30px)`, borderRadius: 3 }} />
      <div style={{ position: "absolute", left: x0 - 12, top: 241, width: 24, height: 24, background: COLOUR.paper, transform: `rotate(45deg) scale(${oldIn})`, opacity: fade }} />
      <div style={{ position: "absolute", left: x1 - 12, top: 241, width: 24, height: 24, background: accent, transform: `rotate(45deg) scale(${newIn})`, boxShadow: `0 0 24px ${accent}` }} />
      {deltaText ? (
        <div style={{ position: "absolute", left: "50%", top: 282, transform: `translateX(-50%) scale(${pill})`, padding: "8px 18px", background: accent, color: COLOUR.ink, fontFamily: BODY, fontWeight: 900, fontSize: 28, letterSpacing: 2, borderRadius: 8, whiteSpace: "nowrap" }}>
          {deltaText}
        </div>
      ) : null}
    </div>
  );
};
