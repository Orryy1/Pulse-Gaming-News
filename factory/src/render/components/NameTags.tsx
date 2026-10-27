// The name tag on a person's first mention, in several looks: the house tag on an amber rule, a profile
// card (with their portrait when the video has one), their name in marker with an arrow drawn toward the
// picture, and a two-tier broadcast strap. The renderer takes them in turn (src/render/Long.tsx).

import React from "react";
import {
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY, HAND } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { displayText } from "../timeline.ts";
import { NameTag } from "./LongMoments.tsx";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type TagProps = {
  name: string;
  role?: string;
  len: number;
  photo?: string;
  variant?: number;
};

function useTag(len: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const showFor = Math.min(len - 6, 150);
  const out = interpolate(frame, [showFor - 12, showFor], [1, 0], clamp);
  return { frame, fps, out, visible: frame <= showFor };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("");

/** A profile card sliding up from the corner: portrait (or initials), name and role. */
const ProfileTag: React.FC<TagProps> = ({ name, role, len, photo }) => {
  const { frame, fps, out, visible } = useTag(len);
  if (!visible || !name.trim()) return null;
  const s = spring({ frame: frame - 3, fps, config: SPRING.ENTER });
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        bottom: 300,
        display: "flex",
        alignItems: "center",
        gap: 24,
        padding: "18px 34px 18px 18px",
        background: "rgba(11,11,14,0.86)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 18,
        boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        opacity: out * s,
        transform: `translateY(${(1 - s) * 60}px)`,
      }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 60,
          overflow: "hidden",
          border: `4px solid ${COLOUR.amber}`,
          background: "linear-gradient(135deg, #2a2d36 0%, #15161b 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: DISPLAY,
          fontSize: 54,
          color: COLOUR.paper,
          flexShrink: 0,
        }}
      >
        {photo ? (
          <Img
            src={photo}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          initials(displayText(name))
        )}
      </div>
      <div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 18,
            letterSpacing: 4,
            color: COLOUR.amber,
          }}
        >
          PROFILE
        </div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 58,
            lineHeight: 1.02,
            color: COLOUR.paper,
            textTransform: "uppercase",
          }}
        >
          {displayText(name)}
        </div>
        {role ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 24,
              letterSpacing: 2,
              color: "rgba(245,245,242,0.75)",
              textTransform: "uppercase",
            }}
          >
            {displayText(role)}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** The name in marker with an arrow drawn toward the picture, the role beneath in small capitals. */
const MarkerTag: React.FC<TagProps> = ({ name, role, len, variant = 0 }) => {
  const { frame, fps, out, visible } = useTag(len);
  if (!visible || !name.trim()) return null;
  const s = spring({ frame: frame - 2, fps, config: SPRING.POP });
  const draw = interpolate(frame, [10, 26], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 2,
  });
  const tilt = variant % 2 ? -3 : -1.5;
  return (
    <div style={{ position: "absolute", left: 110, bottom: 300, opacity: out }}>
      <svg
        width={260}
        height={150}
        style={{
          position: "absolute",
          left: 300,
          top: -150,
          overflow: "visible",
        }}
      >
        <path
          d="M10 140 C 60 120, 120 70, 200 30"
          stroke={COLOUR.amber}
          strokeWidth={8}
          strokeLinecap="round"
          fill="none"
          pathLength={1}
          strokeDasharray={`${draw} 1`}
        />
        <path
          d="M172 22 L204 28 L192 58"
          stroke={COLOUR.amber}
          strokeWidth={8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={draw > 0.95 ? 1 : 0}
        />
      </svg>
      <div
        style={{
          fontFamily: HAND,
          fontSize: 70,
          lineHeight: 1,
          color: COLOUR.paper,
          textShadow: "0 8px 28px rgba(0,0,0,0.8)",
          transform: `rotate(${tilt}deg) scale(${0.85 + 0.15 * s})`,
          transformOrigin: "left center",
          opacity: Math.min(1, s * 1.5),
          whiteSpace: "nowrap",
        }}
      >
        {displayText(name)}
      </div>
      {role ? (
        <div
          style={{
            marginTop: 12,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 24,
            letterSpacing: 3,
            color: COLOUR.amber,
            textTransform: "uppercase",
            opacity: interpolate(frame, [12, 22], [0, 1], clamp),
          }}
        >
          {displayText(role)}
        </div>
      ) : null}
    </div>
  );
};

/** A two-tier broadcast strap: the name on a light bar, the role on an amber bar under it, wiped on in turn. */
const StrapTag: React.FC<TagProps> = ({ name, role, len }) => {
  const { frame, out, visible } = useTag(len);
  if (!visible || !name.trim()) return null;
  const a = interpolate(frame, [2, 14], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const b = interpolate(frame, [8, 20], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  return (
    <div style={{ position: "absolute", left: 96, bottom: 300, opacity: out }}>
      <div
        style={{
          display: "inline-block",
          padding: "12px 30px 10px",
          background: COLOUR.paper,
          clipPath: `inset(0 ${(1 - a) * 100}% 0 0)`,
          fontFamily: DISPLAY,
          fontSize: 60,
          lineHeight: 1,
          color: COLOUR.ink,
          textTransform: "uppercase",
          boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
        }}
      >
        {displayText(name)}
      </div>
      {role ? (
        <div>
          <div
            style={{
              display: "inline-block",
              padding: "8px 30px",
              background: COLOUR.amber,
              clipPath: `inset(0 ${(1 - b) * 100}% 0 0)`,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 24,
              letterSpacing: 3,
              color: COLOUR.ink,
              textTransform: "uppercase",
            }}
          >
            {displayText(role)}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const NAMETAG_STYLES: Array<React.FC<TagProps>> = [
  NameTag,
  ProfileTag,
  MarkerTag,
  StrapTag,
];
