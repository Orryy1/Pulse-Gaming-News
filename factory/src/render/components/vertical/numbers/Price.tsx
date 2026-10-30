// Numbers/Price: a paper price tag with a torn right edge swings into the box on its string, then the price is
// stamped onto it in heavy ink, the tag jolting at the hit. The label is printed across the top of the tag
// and the same price in other currencies (the beat's items, as the Short's price card uses them) prints
// beneath the stamp. A barcode on the stub is decoration only and carries no figures.
import React from "react";
import { interpolate, spring } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import type { VGfxProps } from "../types.ts";
import {
  H,
  W,
  antonFit,
  clamp,
  clean,
  easeOut,
  exitStyle,
  fitLabel,
  labelFits,
  mix,
  seeded,
  useBeat,
  PAPER_GRADIENT,
  shadow,
} from "./kit.tsx";

const TAG_W = 900;
const TAG_H = 440;
const NOTCH = 64; // the chamfered corners at the hole end
const STUB = 104; // the barcode stub at the torn end
const BODY_L = 118; // where the printed area starts, clear of the hole
const PRINT_W = TAG_W - BODY_L - STUB - 36;
const INK = "#141312";
const MONEY =
  /^(?:[A-Z]{1,3}\s?)?[$£€¥]\s?\d[\d,.]*$|^\d[\d,.]*\s?(?:[$£€¥]|USD|EUR|GBP)$/i;

/** The same price in other currencies, from the beat's items (as the Short's price card reads them). */
export function others(primary: string, items: string[]): string[] {
  const p = clean(primary);
  return items
    .map(clean)
    .filter((x) => MONEY.test(x) && x !== p)
    .slice(0, 2);
}

/** The torn right edge: small irregular teeth from top to bottom. */
function tornEdge(variant: number): string {
  const pts: string[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const y = (i / n) * 100;
    const x =
      i % 2 ? 6 + 6 * seeded(variant, 30 + i) : 3 * seeded(variant, 30 + i);
    pts.push(`calc(100% - ${x.toFixed(1)}px) ${y.toFixed(1)}%`);
  }
  return `polygon(${NOTCH}px 0, ${pts.join(", ")}, ${NOTCH}px 100%, 0 calc(100% - ${NOTCH}px), 0 ${NOTCH}px)`;
}

export const Price: React.FC<VGfxProps> = ({ v, len, accent, variant = 0 }) => {
  const { frame, fps, out, visible } = useBeat(len);
  const price = clean(v.primary).toUpperCase();
  const label = clean(v.secondary);
  if (!visible || !MONEY.test(price)) return null;
  const more = others(v.primary, v.items);
  const lab = label ? fitLabel(label, PRINT_W, 40, 2) : undefined;
  const labH = lab ? lab.lines.length * lab.size * 1.1 + 10 : 0;
  const moreH = more.length ? 74 : 0;
  const size = Math.min(
    antonFit(price, PRINT_W, 250),
    Math.floor((TAG_H - 70 - labH - moreH) / 0.88),
  );
  const side = variant % 2 ? -1 : 1;
  const swing = spring({
    frame,
    fps,
    config: { damping: 11, stiffness: 190, mass: 0.6 },
  });
  const stamp = spring({ frame: frame - 6, fps, config: SPRING.SNAP });
  const hit = Math.max(0, frame - 8);
  const jolt = frame >= 8 ? 7 * Math.exp(-hit / 2.2) * Math.cos(hit * 1.9) : 0;
  const printIn = interpolate(frame, [4, 10], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const moreIn = interpolate(frame, [11, 17], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const string = interpolate(frame, [0, 8], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const left = (W - TAG_W) / 2 + 6;
  const top = (H - TAG_H) / 2;
  return (
    <div style={{ position: "absolute", inset: 0, ...exitStyle(out) }}>
      {/* The string, from the hole up and out of the box. */}
      <svg
        style={{
          position: "absolute",
          left: left - 70,
          top: top - 60,
          width: 160,
          height: TAG_H / 2 + 70,
          overflow: "visible",
          opacity: string,
        }}
        viewBox={`0 0 160 ${TAG_H / 2 + 70}`}
      >
        <path
          d={`M 118 ${TAG_H / 2 + 60} C 60 ${TAG_H / 2}, 20 120, 0 0`}
          fill="none"
          stroke="rgba(235,228,214,0.9)"
          strokeWidth={4}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - string}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width: TAG_W,
          height: TAG_H,
          transformOrigin: `48px 50%`,
          transform: `translateX(${(1 - swing) * 260 * side}px) translateY(${jolt}px) rotate(${side * (1 - swing) * 14 - 1.6 * side}deg)`,
          opacity: interpolate(frame, [0, 3], [0, 1], clamp),
        }}
      >
        {/* The tag's shadow on a plain box behind it: cheaper than a filter on the whole tag. */}
        <div
          style={{
            position: "absolute",
            left: 30,
            right: 14,
            top: 18,
            bottom: 6,
            borderRadius: 24,
            boxShadow: shadow(1),
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: tornEdge(variant),
            background: PAPER_GRADIENT,
          }}
        >
          {/* The accent band at the hole end and the hole itself, with a reinforcing ring. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: BODY_L - 26,
              background: `linear-gradient(90deg, ${mix(accent, "#000000", 0.1)} 0%, ${accent} 100%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 48 - 30,
              top: TAG_H / 2 - 30,
              width: 60,
              height: 60,
              borderRadius: 30,
              background: "#f3ede0",
              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.25)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 48 - 15,
              top: TAG_H / 2 - 15,
              width: 30,
              height: 30,
              borderRadius: 15,
              background: "#0b0b0e",
              boxShadow: "inset 0 3px 5px rgba(0,0,0,0.9)",
            }}
          />
          {/* The stub: a perforation and a barcode (decoration only). */}
          <div
            style={{
              position: "absolute",
              right: STUB,
              top: 18,
              bottom: 18,
              borderLeft: "4px dotted rgba(20,19,18,0.28)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 26,
              top: 60,
              bottom: 60,
              width: STUB - 52,
              background: `repeating-linear-gradient(0deg, ${INK} 0px, ${INK} 3px, transparent 3px, transparent 6px, ${INK} 6px, ${INK} 12px, transparent 12px, transparent 15px, ${INK} 15px, ${INK} 16px, transparent 16px, transparent 21px)`,
              opacity: 0.8,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: BODY_L,
              width: PRINT_W,
              top: 0,
              bottom: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            {lab ? (
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize: lab.size,
                  lineHeight: 1.1,
                  letterSpacing: "0.04em",
                  color: "#3b3731",
                  textTransform: "uppercase",
                  opacity: printIn,
                  marginBottom: 10,
                }}
              >
                {lab.lines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            ) : null}
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: size,
                lineHeight: 0.88,
                color: INK,
                whiteSpace: "nowrap",
                transformOrigin: "30% 55%",
                transform: `scale(${1.5 - 0.5 * stamp}) rotate(${-2.5 * side}deg)`,
                opacity: interpolate(frame, [6, 8], [0, 1], clamp),
                // A press of ink: a hair of spread at the hit.
                textShadow:
                  frame >= 8
                    ? `0 0 ${1 + 2 * Math.exp(-hit / 3)}px rgba(20,19,18,0.6)`
                    : undefined,
              }}
            >
              {price}
            </div>
            {more.length ? (
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  marginTop: 14,
                  opacity: moreIn,
                  transform: `translateY(${(1 - moreIn) * 14}px)`,
                }}
              >
                {more.map((o) => (
                  <div
                    key={o}
                    style={{
                      padding: "4px 16px 2px",
                      border: `4px solid ${INK}`,
                      borderRadius: 10,
                      fontFamily: DISPLAY,
                      fontSize: 52,
                      lineHeight: 1.05,
                      color: INK,
                    }}
                  >
                    {o.toUpperCase()}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export const fitsPrice = (v: VGfxProps["v"]) => {
  const p = clean(v.primary);
  if (!MONEY.test(p) || p.length > 12) return false;
  return (
    antonFit(p.toUpperCase(), PRINT_W, 250) >= 150 &&
    labelFits(clean(v.secondary), PRINT_W, 2)
  );
};
