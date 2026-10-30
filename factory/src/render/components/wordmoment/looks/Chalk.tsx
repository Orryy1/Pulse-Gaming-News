// Chalkboard: a slate board in a wooden frame with the word scrawled across it in chalk, written left to
// right over nine frames with a puff of dust rising where the chalk lands, the sub written smaller beneath.
// The chalk takes a pale tint of the tone colour (coloured chalk), the sub is white chalk.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  HAND,
  SPECKLE,
  alpha,
  clamp,
  fitHand,
  lin,
  mix,
  shadow,
  subText,
  textW,
  useMoment,
  wordText,
} from "../kit.tsx";

export const Chalk: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const fs = fitHand(text, 720, size * 1.05);
  const w = Math.ceil(textW(text, "marker", fs)) + 40;
  const write = lin(frame, 0, 9);
  const subWrite = lin(frame, 6, 13);
  const chalk = mix(stamp.colour, "#ffffff", 0.55);
  const dust = interpolate(frame, [0, 10, 24], [0, 0.6, 0], clamp);
  const frameW = Math.round(size * 0.16);
  return (
    <Band top={top}>
      <div
        style={{
          position: "relative",
          padding: frameW,
          borderRadius: 8,
          background:
            "linear-gradient(180deg, #8a5a2b 0%, #6b4420 50%, #553318 100%)",
          boxShadow: shadow(0.8),
          opacity: lin(frame, 0, 2) * out,
          transform: `rotate(${variant % 2 ? 1 : -1}deg)`,
        }}
      >
        <div
          style={{
            position: "relative",
            padding: `${Math.round(size * 0.22)}px ${Math.round(size * 0.5)}px ${Math.round(size * 0.26)}px`,
            minWidth: 520,
            background:
              "radial-gradient(80% 80% at 50% 40%, #2d3a33 0%, #1f2a25 60%, #182019 100%)",
            boxShadow: "inset 0 0 40px rgba(0,0,0,0.6)",
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          {/* Old chalk, half wiped: a faint haze of dust across the slate. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#ffffff",
              WebkitMaskImage: SPECKLE,
              maskImage: SPECKLE,
              WebkitMaskSize: "200px 200px",
              maskSize: "200px 200px",
              opacity: 0.12,
            }}
          />
          <div
            style={{
              position: "relative",
              width: w,
              margin: "0 auto",
              fontFamily: HAND,
              fontSize: fs,
              lineHeight: 1.05,
              color: chalk,
              whiteSpace: "nowrap",
              clipPath: `inset(-10px ${(1 - write) * 100}% -10px 0)`,
              // Chalk's grain: the strokes a touch broken, with a soft dust edge.
              textShadow: `0 0 1px ${alpha(chalk, 0.8)}, 0 0 ${Math.round(size * 0.06)}px ${alpha(chalk, 0.35)}`,
              opacity: 0.94,
            }}
          >
            {text}
            {/* The dust puff at the chalk's tip. */}
            <div
              style={{
                position: "absolute",
                left: write * w - size * 0.3,
                top: -size * 0.1,
                width: size * 0.6,
                height: size * 0.9,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${alpha(chalk, 0.5)} 0%, transparent 70%)`,
                opacity: dust,
                filter: "blur(4px)",
              }}
            />
          </div>
          {sub ? (
            <div
              style={{
                marginTop: Math.round(size * 0.08),
                fontFamily: HAND,
                fontSize: Math.round(size * 0.36),
                letterSpacing: 2,
                color: "#f0efe8",
                whiteSpace: "nowrap",
                clipPath: `inset(0 ${(1 - subWrite) * 100}% 0 0)`,
                textShadow: "0 0 1px rgba(240,239,232,0.8)",
                opacity: 0.9,
              }}
            >
              {sub}
            </div>
          ) : null}
        </div>
        {/* The chalk tray along the bottom of the frame. */}
        <div
          style={{
            position: "absolute",
            left: frameW * 2,
            right: frameW * 2,
            bottom: -Math.round(frameW * 0.6),
            height: Math.round(frameW * 0.8),
            borderRadius: 3,
            background: "linear-gradient(180deg, #7a4f26 0%, #4e2f14 100%)",
            boxShadow: "0 4px 8px rgba(0,0,0,0.5)",
          }}
        />
      </div>
    </Band>
  );
};

export const fitsChalk = () => true;
