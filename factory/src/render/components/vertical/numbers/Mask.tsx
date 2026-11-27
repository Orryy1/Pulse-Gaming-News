// Numbers/Mask: the figure filling the box with the game's picture inside its letters, edged in white with
// an accent glow behind; the label under an accent rule. The owner's favourite long-form look, built for a
// phone: the figure punches in, a sheen crosses it as it settles and the picture drifts inside the letters.
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
  cutFrom,
  easeOut,
  exitStyle,
  fitLabel,
  labelFits,
  useBeat,
} from "./kit.tsx";

const MAX = 400;

export const Mask: React.FC<VGfxProps> = ({
  v,
  len,
  accent,
  src,
  variant = 0,
}) => {
  const { frame, fps, out, visible } = useBeat(len);
  const figure = clean(v.primary).toUpperCase();
  const label = clean(v.secondary);
  if (!visible || !figure) return null;
  const lab = label ? fitLabel(label, W - 40, 46, 2) : undefined;
  const labelH = lab ? lab.lines.length * lab.size * 1.12 + 34 : 0;
  // Anton's capitals stand about 0.86 em tall in a 0.86 line: the figure takes what the label leaves.
  const size = Math.min(
    antonFit(figure, W - 30, MAX, -0.01),
    Math.floor((H - labelH - 16) / 0.86),
  );
  const pop = spring({ frame, fps, config: SPRING.POP });
  const dir = variant % 2 ? -1 : 1;
  const sheen =
    interpolate(frame, [7, 24], [-1, 1], { ...clamp, easing: easeOut }) * dir;
  const drift = interpolate(frame, [0, len], [-7, 7], clamp) * dir;
  const rule = interpolate(frame, [5, 13], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const rise = interpolate(frame, [7, 16], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const word: React.CSSProperties = {
    fontFamily: DISPLAY,
    fontSize: size,
    lineHeight: 0.86,
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    textAlign: "center",
    paddingTop: size * 0.04,
  };
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
            transform: `scale(${1.32 - 0.32 * pop})`,
            opacity: interpolate(frame, [0, 4], [0, 1], clamp),
          }}
        >
          {/* The glow and the drop shadow sit on a copy behind: a shadow on the cut letters would cover the picture. */}
          <div
            style={{
              ...word,
              position: "absolute",
              inset: 0,
              color: alpha(accent, 0.9),
              textShadow: `0 0 34px ${alpha(accent, 0.75)}, 0 0 90px ${alpha(accent, 0.45)}, 0 22px 50px rgba(0,0,0,0.85)`,
            }}
          >
            {figure}
          </div>
          <div
            style={{
              ...word,
              position: "relative",
              ...cutFrom(
                src,
                accent,
                sheen,
                `${50 + drift}% 45%`,
                "cover",
                100 + dir * 10,
              ),
              WebkitTextStroke: "3px rgba(255,255,255,0.92)",
            }}
          >
            {figure}
          </div>
        </div>
        {lab ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: 16,
            }}
          >
            <div
              style={{
                width: `${rule * 46}%`,
                minWidth: 0,
                height: 7,
                borderRadius: 4,
                background: accent,
                marginBottom: 12,
                alignSelf: "center",
                boxShadow: `0 0 18px ${alpha(accent, 0.6)}`,
              }}
            />
            <Label text={label} width={W - 40} rise={rise} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const fitsMask = (v: VGfxProps["v"]) => {
  const f = clean(v.primary);
  return (
    /\d/.test(f) &&
    f.length <= 14 &&
    antonFit(f.toUpperCase(), W - 30, MAX) >= 150 &&
    labelFits(clean(v.secondary), W - 40)
  );
};
