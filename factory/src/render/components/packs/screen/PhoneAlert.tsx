// Screen pack, "PhoneAlert": a generic smartphone (no brand) in a slight 3D tilt over the blurred
// picture. Its lock screen wakes at 9:41 and a PULSE NEWS notification drops in with the headline and
// the outlet and year; a softer stack of blank notifications sits behind it. Tagged ILLUSTRATION.
import React from "react";
import { Img, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { SPRING } from "../../../motion.ts";
import { BODY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import { clamp, easeOut, sizeByLength, txt, wordCount } from "./common.ts";
import { PulseMark } from "./pulse.tsx";

const PHONE_W = 610;
const PHONE_H = 1250;
const BEZEL = 16;
const SCREEN_W = PHONE_W - BEZEL * 2;

/** The Pulse News app's icon: the Pulse mark on an amber tile (./pulse.tsx). */
const AppIcon: React.FC<{ size: number }> = ({ size }) => (
  <PulseMark size={size} tile={COLOUR.amber} colour={COLOUR.ink} radius={24} />
);

/** Signal bars, a wireless fan and a battery: shapes only. */
const StatusIcons: React.FC<{ opacity: number }> = ({ opacity }) => (
  <svg width={150} height={30} viewBox="0 0 150 30" style={{ opacity }}>
    {[0, 1, 2, 3].map((i) => (
      <rect
        key={i}
        x={i * 9}
        y={22 - i * 5}
        width={6}
        height={8 + i * 5}
        rx={1.5}
        fill="#fff"
      />
    ))}
    <path d="M58 24 a3 3 0 1 1 0.1 0 Z" fill="#fff" />
    <path
      d="M49 16 q9 -9 18 0"
      stroke="#fff"
      strokeWidth={3.5}
      fill="none"
      strokeLinecap="round"
    />
    <path
      d="M44 11 q14 -13 28 0"
      stroke="#fff"
      strokeWidth={3.5}
      fill="none"
      strokeLinecap="round"
    />
    <rect
      x={92}
      y={5}
      width={46}
      height={21}
      rx={6}
      stroke="rgba(255,255,255,0.75)"
      strokeWidth={2.5}
      fill="none"
    />
    <rect x={96} y={9} width={34} height={13} rx={3} fill="#fff" />
    <rect
      x={140}
      y={11}
      width={4}
      height={9}
      rx={2}
      fill="rgba(255,255,255,0.75)"
    />
  </svg>
);

export const PhoneAlert: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  src,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 190);
  const headline = txt(g.primary);
  const secondary = txt(g.secondary);
  if (!visible || !headline) return null;

  const dir = variant % 2 === 0 ? 1 : -1;
  const enter = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 120, mass: 0.9 },
  });
  const wake = interpolate(frame, [12, 20], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const drop = spring({
    frame: frame - 22,
    fps,
    config: { damping: 15, stiffness: 190, mass: 0.7 },
  });
  const stack = spring({ frame: frame - 30, fps, config: SPRING.ENTER });
  // A short haptic buzz as the alert lands.
  const buzzT = frame - 22;
  const buzz =
    buzzT >= 0 && buzzT < 12 ? Math.sin(buzzT * 2.7) * 5 * (1 - buzzT / 12) : 0;
  const drift = interpolate(frame, [0, showFor], [0, 1]);
  const rotY = dir * (-16 + 22 * (1 - enter) * -1 + 5 * drift);
  const rotX = 9 + 6 * (1 - enter);
  const rotZ = dir * (-2.5 + 1.2 * drift);
  const note = interpolate(frame, [30, 40], [0, 1], clamp);

  const size = sizeByLength(headline.length, [
    [44, 40],
    [70, 36],
    [96, 33],
    [999, 30],
  ]);

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={12}>
      {/* Screen light spilling onto the scene once the phone wakes. */}
      <div
        style={{
          position: "absolute",
          left: 960 - 700,
          top: 40,
          width: 1400,
          height: 1100,
          background: `radial-gradient(closest-side, rgba(255,140,60,${0.22 * wake}) 0%, rgba(255,107,26,${0.08 * wake}) 45%, rgba(255,107,26,0) 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          perspective: 2200,
          perspectiveOrigin: "50% 40%",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 960 - PHONE_W / 2 + dir * 40,
            top: 150,
            width: PHONE_W,
            height: PHONE_H,
            transform: `translate(${buzz}px, ${(1 - enter) * 520}px) rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`,
            transformOrigin: "50% 30%",
          }}
        >
          {/* The body: dark metal with a lit rim and a side button. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 96,
              background:
                "linear-gradient(140deg, #3a3a42 0%, #17171c 40%, #0b0b0e 100%)",
              boxShadow:
                "0 60px 140px rgba(0,0,0,0.75), 0 20px 40px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(255,255,255,0.14), inset 0 2px 0 rgba(255,255,255,0.22)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -6,
              top: 260,
              width: 8,
              height: 130,
              borderRadius: 4,
              background: "linear-gradient(90deg, #2a2a30, #4a4a52)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: BEZEL,
              top: BEZEL,
              width: SCREEN_W,
              height: PHONE_H - BEZEL * 2,
              borderRadius: 80,
              overflow: "hidden",
              background: "#050507",
            }}
          >
            {/* The wallpaper: the game's picture, darkened; else a warm glow on ink. */}
            <div style={{ position: "absolute", inset: 0, opacity: wake }}>
              {src ? (
                <Img
                  src={src}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `scale(${1.12 - 0.06 * drift})`,
                  }}
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "radial-gradient(90% 45% at 50% 62%, #7a3110 0%, #3a1a0e 45%, #141016 78%, #0b0b0e 100%), linear-gradient(180deg, #17131a 0%, #0b0b0e 100%)",
                  }}
                />
              )}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0.45) 70%, rgba(0,0,0,0.75) 100%)",
                }}
              />
            </div>
            {/* Punch-hole camera and status bar. */}
            <div
              style={{
                position: "absolute",
                left: SCREEN_W / 2 - 13,
                top: 26,
                width: 26,
                height: 26,
                borderRadius: 13,
                background: "#000",
                boxShadow: "inset 0 0 0 3px #15151a",
              }}
            />
            <div style={{ position: "absolute", right: 44, top: 26 }}>
              <StatusIcons opacity={wake} />
            </div>
            {/* The lock and the big clock. */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 92,
                textAlign: "center",
                opacity: wake,
                transform: `translateY(${(1 - wake) * 14}px)`,
              }}
            >
              <svg width={30} height={38} viewBox="0 0 30 38">
                <path
                  d="M7 16 V11 a8 8 0 0 1 16 0 V16"
                  stroke="#fff"
                  strokeWidth={3.5}
                  fill="none"
                />
                <rect x={2} y={16} width={26} height={20} rx={5} fill="#fff" />
              </svg>
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 600,
                  fontSize: 168,
                  lineHeight: 1,
                  letterSpacing: -4,
                  color: "rgba(255,255,255,0.96)",
                  marginTop: 6,
                  textShadow: "0 6px 30px rgba(0,0,0,0.35)",
                }}
              >
                9:41
              </div>
            </div>
            {/* Older notifications stacked behind: blank shapes only. */}
            <div
              style={{ position: "absolute", left: 22, right: 22, top: 330 }}
            >
              {[2, 1].map((k) => (
                <div
                  key={k}
                  style={{
                    position: "absolute",
                    left: 18 * k,
                    right: 18 * k,
                    top: 0,
                    height: "100%",
                    minHeight: 180,
                    transform: `translateY(${(14 + 16 * k) * stack}px)`,
                    borderRadius: 34,
                    background: `rgba(235,235,240,${0.32 - 0.1 * k})`,
                    opacity: stack,
                  }}
                />
              ))}
              {/* The alert itself. */}
              <div
                style={{
                  position: "relative",
                  borderRadius: 34,
                  background: "rgba(246,246,248,0.97)",
                  padding: "24px 28px 28px",
                  boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
                  opacity: Math.min(1, drop * 1.6),
                  transform: `translateY(${(1 - drop) * -380}px) scale(${0.94 + 0.06 * drop})`,
                  transformOrigin: "50% 0%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <AppIcon size={46} />
                  <div
                    style={{
                      fontFamily: BODY,
                      fontWeight: 800,
                      fontSize: 22,
                      letterSpacing: 3,
                      color: "#5a5a64",
                    }}
                  >
                    PULSE NEWS
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 16,
                    fontFamily: BODY,
                    fontWeight: 800,
                    fontSize: size,
                    lineHeight: 1.16,
                    color: "#111114",
                  }}
                >
                  {headline}
                </div>
                {secondary ? (
                  <div
                    style={{
                      marginTop: 12,
                      fontFamily: BODY,
                      fontWeight: 600,
                      fontSize: 26,
                      color: "#5a5a64",
                    }}
                  >
                    {secondary}
                  </div>
                ) : null}
              </div>
            </div>
            {/* Glass: a faint diagonal reflection that slides as the phone turns. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(${118 + dir * 6}deg, rgba(255,255,255,0) ${28 + drift * 8}%, rgba(255,255,255,0.07) ${36 + drift * 8}%, rgba(255,255,255,0) ${50 + drift * 8}%)`,
              }}
            />
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          bottom: 96,
          padding: "5px 12px",
          borderRadius: 6,
          border: "1.5px solid rgba(245,245,242,0.55)",
          background: "rgba(11,11,14,0.55)",
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 22,
          letterSpacing: 3,
          color: "rgba(245,245,242,0.85)",
          opacity: note,
        }}
      >
        ILLUSTRATION
      </div>
    </Stage>
  );
};

/** A headline of 3 to 14 words; a short credit line. */
export const fitsPhoneAlert = (g: MomentGraphic) => {
  const h = txt(g.primary);
  const n = wordCount(h);
  return n >= 3 && n <= 14 && h.length <= 120 && txt(g.secondary).length <= 44;
};
