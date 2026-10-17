import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../../brand.ts";
import { CONTENT_WIDTH } from "../../layout.ts";
import { SPRING, FRAMES } from "../../motion.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { daysUntil } from "./helpers.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Release-date card: a month grid fades in, the day pops in accent and a
 * countdown chip snaps in. `renderDate` is passed as a prop (never the clock).
 */
export const Calendar: React.FC<{ date: string; renderDate: string; label?: string; accent: string }> = ({ date, renderDate, label, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - FRAMES.ruleLead;
  const m = date.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  const year = m ? Number(m[1]) : undefined;
  const month = m ? Number(m[2]) - 1 : undefined;
  const day = m?.[3] ? Number(m[3]) : undefined;
  const gridIn = interpolate(t, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const dayPop = spring({ frame: t - 14, fps, config: SPRING.POP });
  const chip = spring({ frame: t - 24, fps, config: SPRING.SNAP });
  const days = day !== undefined ? daysUntil(date, renderDate) : undefined;
  if (year === undefined || month === undefined) {
    return <div style={{ fontFamily: DISPLAY, fontSize: 150, color: COLOUR.paper }}>{date.toUpperCase()}</div>;
  }
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<number | null> = [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const cell = 56;
  return (
    <div style={{ position: "relative", width: CONTENT_WIDTH, display: "flex", alignItems: "flex-start", gap: 36 }}>
      <div style={{ width: cell * 7 + 24, padding: 12, background: "rgba(11,11,14,0.82)", borderRadius: 14, opacity: gridIn }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 34, color: COLOUR.paper, letterSpacing: 1, marginBottom: 6 }}>
          {MONTHS[month]!.toUpperCase()} {year}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(7, ${cell}px)` }}>
          {DOW.map((d, i) => (
            <div key={`d${i}`} style={{ height: 30, fontFamily: BODY, fontWeight: 800, fontSize: 22, color: COLOUR.muted, textAlign: "center" }}>
              {d}
            </div>
          ))}
          {cells.map((n, i) => {
            const hot = n !== null && n === day;
            return (
              <div key={i} style={{ height: cell, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {n === null ? null : hot ? (
                  <div style={{ width: 50, height: 50, borderRadius: 25, background: accent, color: COLOUR.ink, fontFamily: DISPLAY, fontSize: 30, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${dayPop})`, boxShadow: `0 0 24px ${accent}` }}>
                    {n}
                  </div>
                ) : (
                  <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 26, color: "rgba(245,245,242,0.7)" }}>{n}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        {label ? <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 32, letterSpacing: 2, color: COLOUR.muted, textTransform: "uppercase" }}>{label}</div> : null}
        <div style={{ marginTop: 10, fontFamily: DISPLAY, fontSize: 84, lineHeight: 1, color: COLOUR.paper }}>
          {day !== undefined ? `${day} ` : ""}
          {MONTHS[month]!.slice(0, 3).toUpperCase()}
        </div>
        <div style={{ fontFamily: DISPLAY, fontSize: 84, lineHeight: 1, color: accent }}>{year}</div>
        {days !== undefined && days > 0 ? (
          <div style={{ display: "inline-block", marginTop: 16, padding: "8px 18px", background: accent, color: COLOUR.ink, fontFamily: BODY, fontWeight: 900, fontSize: 28, letterSpacing: 2, borderRadius: 8, transform: `scale(${chip})`, transformOrigin: "left center" }}>
            {days} DAY{days === 1 ? "" : "S"} AWAY
          </div>
        ) : null}
      </div>
    </div>
  );
};
