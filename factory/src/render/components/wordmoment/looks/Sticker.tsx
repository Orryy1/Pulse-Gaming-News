// Sticker: a die-cut vinyl sticker in the tone colour with a white border, slapped onto the frame. It lands
// big and settles with the stamp's spring; its top-right corner is still peeling up at the hit and flattens
// over the next eight frames, its shadow shrinking as the sticker meets the glass.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  DEFAULT_SIZE,
  DISPLAY,
  DEFAULT_TOP,
  Sub,
  clamp,
  fitDisplay,
  mix,
  onAccent,
  shadow,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

export const Sticker: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, hit, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const ink = onAccent(stamp.colour);
  const padX = Math.round(size * 0.42);
  const fs = fitDisplay(text, 760, size * 1.06, 0.01);
  const peel = interpolate(frame, [2, 11], [1, 0], { ...clamp });
  const fold = Math.round(size * 1.1) * peel;
  const scale = interpolate(hit, [0, 1], [1.7, 1]);
  const tilt = variant % 2 ? 4 : -5;
  return (
    <Band top={top} blur>
      <div
        style={{
          position: "relative",
          transform: `rotate(${tilt}deg) scale(${scale})`,
          opacity: Math.min(1, hit * 1.6) * out,
          padding: `${Math.round(size * 0.12)}px ${padX}px ${Math.round(size * 0.16)}px`,
          minWidth: Math.round(size * 3.6),
          borderRadius: Math.round(size * 0.22),
          background: `linear-gradient(170deg, ${mix(stamp.colour, "#ffffff", 0.12)} 0%, ${stamp.colour} 60%, ${mix(stamp.colour, "#000000", 0.14)} 100%)`,
          border: `${Math.round(size * 0.085)}px solid #f7f6f2`,
          boxShadow: shadow(0.7 + 0.8 * peel),
          textAlign: "center",
          // The peeled corner: the sticker's underside (paler) folded back over itself.
          clipPath:
            fold > 1
              ? `polygon(0 0, calc(100% - ${fold}px) 0, 100% ${fold}px, 100% 100%, 0 100%)`
              : undefined,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: fs,
            lineHeight: 1,
            letterSpacing: Math.round(size * 0.02),
            color: ink,
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </div>
        <Sub
          text={sub}
          size={size}
          colour={ink}
          opacity={0.88}
          style={{ marginTop: Math.round(size * 0.06) }}
        />
        {fold > 1 ? (
          <div
            style={{
              position: "absolute",
              right: -Math.round(size * 0.085),
              top: -Math.round(size * 0.085),
              width: fold + Math.round(size * 0.085),
              height: fold + Math.round(size * 0.085),
              clipPath: "polygon(0 0, 100% 100%, 0 100%)",
              background: `linear-gradient(225deg, #d9d6cf 0%, #f7f6f2 45%, ${mix(stamp.colour, "#ffffff", 0.55)} 100%)`,
              filter: "drop-shadow(-4px 6px 6px rgba(0,0,0,0.45))",
            }}
          />
        ) : null}
      </div>
    </Band>
  );
};

export const fitsSticker = () => true;
