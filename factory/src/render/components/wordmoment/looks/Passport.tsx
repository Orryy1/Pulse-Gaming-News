// Passport: the border officer's date stamp, ink only (no plate), an oval of two rings with the date across
// its middle and the sub curved along the top, pressed at an angle with uneven ink so it reads as a real
// impression. Only when the text is a date.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps, WordStamp } from "../types.ts";
import {
  Band,
  BODY,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  DISPLAY,
  INK_MASK,
  fitDisplay,
  isDate,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

export const Passport: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { hit, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const w = Math.round(size * 6.4);
  const h = Math.round(size * 2.4);
  const fs = fitDisplay(text, w * 0.66, size * 1.04, 0.04);
  const ring = Math.round(size * 0.085);
  const tilt = variant % 2 ? 7 : -9;
  const uid = `pp${variant}`;
  return (
    <Band top={top} blur>
      <div
        style={{
          position: "relative",
          width: w,
          height: h,
          transform: `rotate(${tilt}deg) scale(${interpolate(hit, [0, 1], [1.9, 1])})`,
          opacity: Math.min(1, hit * 1.5) * out,
          WebkitMaskImage: INK_MASK,
          maskImage: INK_MASK,
          WebkitMaskSize: "320px 320px",
          maskSize: "320px 320px",
          // A dark halo under the ink so it reads over any footage; the mask thins it with the ink.
          filter:
            "drop-shadow(0 0 3px rgba(0,0,0,0.9)) drop-shadow(0 6px 22px rgba(0,0,0,0.7))",
        }}
      >
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
        >
          <defs>
            <path
              id={uid}
              d={`M ${w * 0.2} ${h * 0.5} A ${w * 0.3} ${h * 0.5 - ring * 5} 0 0 1 ${w * 0.8} ${h * 0.5}`}
            />
          </defs>
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={w / 2 - ring}
            ry={h / 2 - ring}
            fill="none"
            stroke={stamp.colour}
            strokeWidth={ring}
          />
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={w / 2 - ring * 2.6}
            ry={h / 2 - ring * 2.6}
            fill="none"
            stroke={stamp.colour}
            strokeWidth={Math.max(2, ring * 0.45)}
          />
          {/* Two short rules either side of the date, as the officer's stamp carries. */}
          <line
            x1={w * 0.09}
            y1={h / 2}
            x2={w * 0.19}
            y2={h / 2}
            stroke={stamp.colour}
            strokeWidth={ring * 0.7}
          />
          <line
            x1={w * 0.81}
            y1={h / 2}
            x2={w * 0.91}
            y2={h / 2}
            stroke={stamp.colour}
            strokeWidth={ring * 0.7}
          />
          {sub ? (
            <text
              fontFamily={BODY}
              fontWeight={900}
              fontSize={Math.round(size * 0.24)}
              letterSpacing={Math.round(size * 0.08)}
              fill={stamp.colour}
            >
              <textPath href={`#${uid}`} startOffset="50%" textAnchor="middle">
                {sub}
              </textPath>
            </text>
          ) : null}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: sub ? Math.round(size * 0.16) : 0,
            fontFamily: DISPLAY,
            fontSize: fs,
            lineHeight: 1,
            letterSpacing: Math.round(size * 0.05),
            color: stamp.colour,
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </div>
      </div>
    </Band>
  );
};

export const fitsPassport = (s: WordStamp) =>
  isDate(wordText(s)) && subText(s).length <= 14;
