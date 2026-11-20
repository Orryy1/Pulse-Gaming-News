// Metal plate: a brushed steel nameplate held by four rivets, the word raised from it with a lit top edge
// and a shadowed foot, anodised in the tone colour, a specular sweep crossing it once as it settles. It
// rises into place over six frames with a short clink of a bounce. The sub is engraved beneath.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  BODY,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  DISPLAY,
  alpha,
  clamp,
  fitDisplay,
  mix,
  shadow,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

const BRUSH = `repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px, rgba(0,0,0,0.06) 3px 4px, transparent 4px 7px)`;

export const Metal: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
}) => {
  const { frame, hit, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const fs = fitDisplay(text, 740, size * 1.08, 0.05);
  const rise = interpolate(hit, [0, 1], [34, 0]);
  const sweep = interpolate(frame, [3, 16], [-0.4, 1.4], clamp);
  const tint = mix(stamp.colour, "#ffffff", 0.08);
  const rivet = Math.round(size * 0.13);
  return (
    <Band top={top}>
      <div
        style={{
          position: "relative",
          padding: `${Math.round(size * 0.28)}px ${Math.round(size * 0.62)}px ${Math.round(size * 0.3)}px`,
          borderRadius: 10,
          background: `linear-gradient(170deg, #5a5d63 0%, #3b3e44 35%, #2a2c31 65%, #44474d 100%)`,
          boxShadow: `${shadow(0.9)}, inset 0 2px 0 rgba(255,255,255,0.25), inset 0 -2px 0 rgba(0,0,0,0.6)`,
          transform: `translateY(${rise}px)`,
          opacity: interpolate(frame, [0, 3], [0, 1], clamp) * out,
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        <div
          style={{ position: "absolute", inset: 0, backgroundImage: BRUSH }}
        />
        {/* The specular sweep across the brushed face. */}
        <div
          style={{
            position: "absolute",
            top: -40,
            bottom: -40,
            width: "30%",
            left: `${sweep * 100}%`,
            background:
              "linear-gradient(100deg, transparent, rgba(255,255,255,0.18), transparent)",
            transform: "skewX(-18deg)",
          }}
        />
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: i % 2 ? undefined : Math.round(size * 0.14),
              right: i % 2 ? Math.round(size * 0.14) : undefined,
              top: i < 2 ? Math.round(size * 0.14) : undefined,
              bottom: i < 2 ? undefined : Math.round(size * 0.14),
              width: rivet,
              height: rivet,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 35% 30%, #9a9ea6 0%, #4a4d53 55%, #202227 100%)",
              boxShadow:
                "0 1px 2px rgba(0,0,0,0.8), inset 0 -1px 1px rgba(0,0,0,0.6)",
            }}
          />
        ))}
        <div
          style={{
            position: "relative",
            fontFamily: DISPLAY,
            fontSize: fs,
            lineHeight: 1,
            letterSpacing: Math.round(size * 0.06),
            color: tint,
            whiteSpace: "nowrap",
            // Raised: a lit upper edge, a dark lower edge, a shade of depth below.
            textShadow: `0 -2px 0 ${alpha("#ffffff", 0.35)}, 0 2px 0 ${mix(stamp.colour, "#000000", 0.55)}, 0 4px 0 ${mix(stamp.colour, "#000000", 0.7)}, 0 7px 10px rgba(0,0,0,0.6)`,
          }}
        >
          {text}
        </div>
        {sub ? (
          <div
            style={{
              position: "relative",
              marginTop: Math.round(size * 0.14),
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: Math.round(size * 0.26),
              letterSpacing: Math.round(size * 0.08),
              color: "#d9dbe0",
              whiteSpace: "nowrap",
              // Engraved: a light edge below the cut.
              textShadow: "0 -1px 0 rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.18)",
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </Band>
  );
};

export const fitsMetal = () => true;
