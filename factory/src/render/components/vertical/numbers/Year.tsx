// Numbers/Year: the year enormous, its four digits cut from the game's picture. The digits slide together
// from wide tracking like windows moving over one still picture, then a sheen crosses them; the month or
// day sits above in spaced capitals and the label below on an accent chip.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import type { VGfxProps } from "../types.ts";
import {
  H,
  Pool,
  W,
  YEAR,
  alpha,
  clamp,
  clean,
  cutFrom,
  easeOut,
  easeOutQuint,
  exitStyle,
  fitLabel,
  labelFits,
  useBeat,
} from "./kit.tsx";

const ADV = 0.494; // Anton's digit advance in em
const TRACK = 0.015;

function parts(primary: string) {
  const text = clean(primary);
  const year = text.match(YEAR)?.[0];
  const rest = year
    ? text
        .replace(year, " ")
        .replace(/\s+/g, " ")
        .replace(/^[\s,.]+|[\s,.]+$/g, "")
        .toUpperCase()
    : "";
  return { year, rest };
}

const restSize = (rest: string) =>
  Math.min(54, Math.floor((W - 40) / Math.max(1, rest.length * 0.98)));

export const Year: React.FC<VGfxProps> = ({
  v,
  len,
  accent,
  src,
  variant = 0,
}) => {
  const { frame, out, visible } = useBeat(len);
  const { year, rest } = parts(v.primary);
  const label = clean(v.secondary);
  if (!visible || !year) return null;
  const rs = rest ? restSize(rest) : 0;
  const lab = label ? fitLabel(label, W - 120, 42, 1) : undefined;
  const top = rest ? rs * 1.2 + 6 : 0;
  const bottom = lab ? lab.size * 1.15 + 34 : 0;
  const size = Math.floor(
    Math.min((W - 10) / (4 * ADV + 3 * TRACK), (H - top - bottom) / 0.84, 500),
  );
  const adv = size * (ADV + TRACK);
  const total = adv * 4 - size * TRACK;
  const boxH = size * 0.84;
  const dir = variant % 2 ? -1 : 1;
  const close = interpolate(frame, [0, 12], [0, 1], {
    ...clamp,
    easing: easeOutQuint,
  });
  const sheen =
    interpolate(frame, [10, 26], [-1, 1], { ...clamp, easing: easeOut }) * dir;
  const drift = interpolate(frame, [0, len], [-14, 14], clamp) * dir;
  const restIn = interpolate(frame, [4, 12], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const chip = interpolate(frame, [8, 16], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const picW = total * 1.18;
  const digits = year.split("").map((d, i) => {
    const spread = (i - 1.5) * size * 0.34 * (1 - close);
    const x = i * adv + spread;
    const o = interpolate(frame, [i * 1.2, i * 1.2 + 5], [0, 1], clamp);
    const cell: React.CSSProperties = {
      position: "absolute",
      left: x,
      top: 0,
      width: size * ADV,
      height: boxH,
      fontFamily: DISPLAY,
      fontSize: size,
      lineHeight: `${boxH}px`,
      textAlign: "center",
      opacity: o,
    };
    return (
      <React.Fragment key={i}>
        <div
          style={{
            ...cell,
            color: alpha(accent, 0.85),
            textShadow: `0 0 30px ${alpha(accent, 0.7)}, 0 0 80px ${alpha(accent, 0.4)}, 0 22px 50px rgba(0,0,0,0.85)`,
          }}
        >
          {d}
        </div>
        <div
          style={{
            ...cell,
            ...cutFrom(
              src,
              accent,
              sheen,
              `${-x - (picW - total) / 2 + drift}px 50%`,
              `${picW}px auto`,
              100 + dir * 8,
            ),
            WebkitTextStroke: "3px rgba(255,255,255,0.92)",
          }}
        >
          {d}
        </div>
      </React.Fragment>
    );
  });
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
        {rest ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: rs,
              lineHeight: 1.2,
              letterSpacing: `${interpolate(restIn, [0, 1], [0.6, 0.28])}em`,
              marginRight: "-0.28em",
              color: COLOUR.paper,
              opacity: restIn,
              textShadow: "0 2px 14px rgba(0,0,0,0.9)",
              marginBottom: 6,
              whiteSpace: "nowrap",
            }}
          >
            {rest}
          </div>
        ) : null}
        <div style={{ position: "relative", width: total, height: boxH }}>
          {digits}
        </div>
        {lab ? (
          <div
            style={{
              marginTop: 20,
              padding: "6px 22px 4px",
              background: accent,
              color: COLOUR.ink,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: lab.size,
              lineHeight: 1.15,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              clipPath: `inset(0 ${(1 - chip) * 50}% 0 ${(1 - chip) * 50}%)`,
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            }}
          >
            {lab.lines.join(" ")}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const fitsYear = (v: VGfxProps["v"]) => {
  const p = clean(v.primary);
  if (!YEAR.test(p) || p.length > 22) return false;
  const { rest } = parts(v.primary);
  if (rest && (restSize(rest) < 34 || /\d{3,}/.test(rest))) return false;
  return labelFits(clean(v.secondary), W - 120, 1);
};
