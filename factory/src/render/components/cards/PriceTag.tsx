import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../../brand.ts";
import { CONTENT_WIDTH } from "../../layout.ts";
import { SPRING, ease, FRAMES } from "../../motion.ts";
import { BODY, DISPLAY } from "../fonts.ts";

function countTo(value: string, p: number): string {
  const m = value.match(/^([^\d]*)([\d,]+)(\.\d+)?(.*)$/);
  if (!m) return value;
  const target = Number(m[2]!.replace(/,/g, ""));
  if (!Number.isFinite(target)) return value;
  const v = Math.round(target * p);
  return `${m[1]}${m[2]!.includes(",") ? v.toLocaleString("en-GB") : String(v)}${m[3] ?? ""}${m[4]}`;
}

/** Price card: the old price is struck through, the new one lands big, the region label snaps in. */
export const PriceTag: React.FC<{ price: string; was?: string; region?: string; label?: string; accent: string }> = ({ price, was, region, label, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - FRAMES.ruleLead;
  const strike = interpolate(t, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  const bigIn = spring({ frame: t - 4, fps, config: SPRING.ENTER });
  const count = interpolate(t, [4, 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  const regionIn = spring({ frame: t - 26, fps, config: SPRING.SNAP });
  return (
    <div style={{ position: "relative", width: CONTENT_WIDTH, minHeight: 300 }}>
      {label ? <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 32, letterSpacing: 2, color: COLOUR.muted, textTransform: "uppercase" }}>{label}</div> : null}
      {was ? (
        <div style={{ position: "relative", display: "inline-block", marginTop: 14, fontFamily: DISPLAY, fontSize: 96, color: "rgba(245,245,242,0.6)", lineHeight: 1 }}>
          {was}
          <div style={{ position: "absolute", left: -6, top: "50%", height: 8, width: `calc(${strike * 100}% + 12px)`, background: accent, transform: "translateY(-50%) rotate(-4deg)" }} />
        </div>
      ) : null}
      <div style={{ marginTop: was ? 6 : 14, fontFamily: DISPLAY, fontSize: 196, lineHeight: 0.95, color: COLOUR.paper, textShadow: "0 10px 50px rgba(0,0,0,0.7)", fontVariantNumeric: "tabular-nums", opacity: bigIn, transform: `translateY(${(1 - bigIn) * 24}px)` }}>
        {countTo(price, count)}
      </div>
      {region ? (
        <div style={{ display: "inline-block", marginTop: 18, padding: "8px 18px", background: accent, color: COLOUR.ink, fontFamily: BODY, fontWeight: 900, fontSize: 30, letterSpacing: 2, borderRadius: 8, transform: `scale(${regionIn})`, transformOrigin: "left center", textTransform: "uppercase" }}>
          {region}
        </div>
      ) : null}
    </div>
  );
};
