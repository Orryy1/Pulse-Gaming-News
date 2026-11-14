// Marker: the word written on the frame in marker and ringed by hand, the ring drawn in one stroke that
// overshoots its start the way a quick circle does; odd variants underline instead, twice. The word pops
// in at the hit, the stroke draws over the next nine frames, the sub is written beneath in the same hand.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  HAND,
  alpha,
  clamp,
  fitHand,
  lin,
  seeded,
  subText,
  textW,
  useMoment,
  wordText,
} from "../kit.tsx";

/** A hand-drawn ring round a w by h box: an ellipse that starts at the left, goes round once and a bit. */
function ring(w: number, h: number, variant: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 + 26;
  const ry = h / 2 + 18;
  const pts: string[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI * 2.25;
    const wob = 1 + 0.035 * (seeded(variant, 60 + i) - 0.5);
    const drift = (i / n) * 14;
    pts.push(
      `${(cx + Math.cos(a) * rx * wob + drift).toFixed(1)} ${(cy + Math.sin(a) * ry * wob - drift * 0.4).toFixed(1)}`,
    );
  }
  return `M ${pts[0]} L ${pts.slice(1).join(" L ")}`;
}

/** Two underlines, the second a shade lower and shorter. */
function lines(w: number, h: number, variant: number): string {
  const y = h + 10;
  const j = (i: number) => (seeded(variant, 80 + i) - 0.5) * 8;
  return `M -14 ${y + j(0)} Q ${w * 0.3} ${y + 10 + j(1)}, ${w + 18} ${y + j(2)} M 6 ${y + 22 + j(3)} Q ${w * 0.6} ${y + 30 + j(4)}, ${w - 30} ${y + 20 + j(5)}`;
}

export const Marker: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, hit, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const fs = fitHand(text, 720, size * 1.08);
  const w = Math.ceil(textW(text, "marker", fs));
  const h = Math.round(fs * 1.05);
  const draw = lin(frame, 2, 11);
  const underline = variant % 2 === 1;
  const pad = 60;
  return (
    <Band top={top}>
      <div
        style={{
          position: "relative",
          width: w + pad * 2,
          height: h + pad,
          opacity: out,
          transform: `rotate(-2deg) scale(${interpolate(hit, [0, 1], [1.35, 1])})`,
          // A soft dark pool so the hand reads over any footage.
          filter:
            "drop-shadow(0 0 2px rgba(0,0,0,0.9)) drop-shadow(0 8px 26px rgba(0,0,0,0.8))",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: pad,
            top: Math.round(pad * 0.3),
            width: w,
            fontFamily: HAND,
            fontSize: fs,
            lineHeight: 1.05,
            color: stamp.colour,
            whiteSpace: "nowrap",
            textAlign: "center",
            opacity: Math.min(1, hit * 1.6),
          }}
        >
          {text}
        </div>
        <svg
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
          width={w + pad * 2}
          height={h + pad}
          viewBox={`0 0 ${w + pad * 2} ${h + pad}`}
        >
          <g transform={`translate(${pad} ${Math.round(pad * 0.3)})`}>
            <path
              d={underline ? lines(w, h, variant) : ring(w, h, variant)}
              fill="none"
              stroke={stamp.colour}
              strokeWidth={Math.round(size * 0.1)}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
              opacity={0.96}
            />
            {/* The marker's wet edge: a paler second pass that trails the stroke. */}
            <path
              d={underline ? lines(w, h, variant) : ring(w, h, variant)}
              fill="none"
              stroke={alpha(stamp.colour, 0.35)}
              strokeWidth={Math.round(size * 0.16)}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - Math.max(0, draw - 0.08)}
            />
          </g>
        </svg>
        {sub ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: h + pad * 0.3 + (underline ? 42 : 24),
              textAlign: "center",
              fontFamily: HAND,
              fontSize: Math.round(size * 0.34),
              color: "#F5F5F2",
              letterSpacing: 2,
              opacity: lin(frame, 8, 13) * out,
              whiteSpace: "nowrap",
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </Band>
  );
};

export const fitsMarker = () => true;
