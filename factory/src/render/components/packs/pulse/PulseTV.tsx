// Pulse universe, "PulseTV": a press story as a PULSE NEWS bulletin on a Pulse television of its era. Up to
// 1992 a wood-grain cabinet with a silver bezel, two dials and a speaker grille; 1993-2005 a black plastic set
// with grilles either side, a row of buttons and a standby light. The set is already on: a burst of channel-
// change static, then the picture (the sentence's game) with the PULSE NEWS bug, the headline in a lower third
// with the outlet's credit under it and a ticker that only repeats the headline and the outlet. Scanlines,
// a curved glass and a slight colour fringe sell the tube. The camera then eases in on the screen so the words
// read at 1080p. Tagged ILLUSTRATION.
import React from "react";
import { Img, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import {
  clamp,
  easeInOut,
  easeOut,
  sizeByLength,
  txt,
} from "../screen/common.ts";
import { PulseMark, storyYear } from "../screen/pulse.tsx";
import { pressCredit, tvLook, type TvLook } from "./pressKit.ts";

/** The picture tube's visible area (4:3), and the cabinet round it. */
const SW = 880;
const SH = 660;
const CAB: Record<TvLook, { w: number; h: number; sx: number; sy: number }> = {
  // Wood: the screen sits left, the control column to its right.
  wood: { w: 1320, h: 860, sx: 70, sy: 100 },
  // Plastic: the screen centred above a strip of grilles and buttons.
  plastic: { w: 1120, h: 920, sx: 120, sy: 70 },
};

/** Channel-change snow: turbulence re-seeded every frame, so it crawls but renders the same each time. */
const Snow: React.FC<{ frame: number; opacity: number }> = ({
  frame,
  opacity,
}) => (
  <svg
    width={SW}
    height={SH}
    style={{ position: "absolute", inset: 0, opacity }}
  >
    <filter id={`snow-${frame}`} x="0" y="0" width="100%" height="100%">
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.9 0.6"
        numOctaves={2}
        seed={(frame * 7) % 997}
      />
      <feColorMatrix type="saturate" values="0" />
      <feComponentTransfer>
        <feFuncR type="linear" slope={1.8} intercept={-0.35} />
        <feFuncG type="linear" slope={1.8} intercept={-0.35} />
        <feFuncB type="linear" slope={1.8} intercept={-0.35} />
      </feComponentTransfer>
    </filter>
    <rect width={SW} height={SH} filter={`url(#snow-${frame})`} />
    {/* The rolling bar of a tube losing and finding its hold. */}
    <rect
      y={((frame * 37) % (SH + 120)) - 120}
      width={SW}
      height={90}
      fill="rgba(255,255,255,0.18)"
    />
  </svg>
);

/** The wood cabinet's control column: two dials (no numbers on them), a grille and the Pulse badge. */
const WoodControls: React.FC<{ x: number; h: number }> = ({ x, h }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: 70,
      width: 260,
      height: h - 140,
      borderRadius: 10,
      background: "linear-gradient(180deg,#d3d1c8,#a9a69b)",
      boxShadow: "inset 0 2px 0 #f2f0e8, inset 0 -3px 0 #7d7a70",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      paddingTop: 36,
      gap: 34,
    }}
  >
    {[0, 1].map((i) => (
      <div
        key={i}
        style={{
          width: 124,
          height: 124,
          borderRadius: "50%",
          background: "radial-gradient(circle at 40% 35%,#5a5852,#25241f 70%)",
          boxShadow: "0 6px 12px rgba(0,0,0,0.5), inset 0 0 0 6px #3a3934",
          position: "relative",
        }}
      >
        {/* The pointer and tick marks: positions only. */}
        <div
          style={{
            position: "absolute",
            left: 58,
            top: 10,
            width: 8,
            height: 40,
            borderRadius: 4,
            background: "#e8e4d6",
            transformOrigin: "4px 52px",
            transform: `rotate(${i ? -40 : 65}deg)`,
          }}
        />
      </div>
    ))}
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          style={{
            width: 170,
            height: 8,
            borderRadius: 4,
            background: "#4b4942",
          }}
        />
      ))}
    </div>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 14px",
        borderRadius: 6,
        background: "linear-gradient(180deg,#f0eee6,#b9b6aa)",
        boxShadow: "inset 0 0 0 2px #8a877b",
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: 28,
        letterSpacing: 6,
        color: "#2b2a25",
      }}
    >
      <PulseMark size={32} colour="#2b2a25" />
      PULSE
    </div>
  </div>
);

/** The plastic set's front below the screen: grilles either side, buttons, standby light and badge. */
const PlasticFront: React.FC<{ top: number; frame: number }> = ({
  top,
  frame,
}) => (
  <div
    style={{
      position: "absolute",
      left: 60,
      right: 60,
      top,
      height: 120,
      display: "flex",
      alignItems: "center",
      gap: 28,
    }}
  >
    {[0, 1].map((side) => (
      <React.Fragment key={side}>
        {side === 1 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 30,
                letterSpacing: 8,
                color: "#c9c9cf",
              }}
            >
              <PulseMark size={34} colour="#c9c9cf" />
              PULSE
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  style={{
                    width: 34,
                    height: 14,
                    borderRadius: 3,
                    background: "linear-gradient(#3a3a40,#1d1d22)",
                    boxShadow: "inset 0 1px 0 #55555c",
                  }}
                />
              ))}
              <div
                style={{
                  marginLeft: 6,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "#3cff6a",
                  boxShadow: `0 0 ${8 + 4 * Math.sin(frame / 6)}px #3cff6a`,
                }}
              />
            </div>
          </div>
        )}
        <div
          style={{
            flex: 1,
            height: 84,
            borderRadius: 10,
            background:
              "repeating-linear-gradient(90deg,#0c0c0f 0 6px,#26262b 6px 11px)",
            boxShadow: "inset 0 2px 6px rgba(0,0,0,0.8)",
          }}
        />
      </React.Fragment>
    ))}
  </div>
);

export const PulseTV: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
  src,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 260);
  const headline = txt(g.primary).toUpperCase();
  if (!visible || !headline) return null;
  const { credit, outlet } = pressCredit(g);
  const look = tvLook(storyYear(g, year));
  const cab = CAB[look];
  const wood = look === "wood";
  // The credit line under the headline: the outlet and year as the source gives them; a bare year alone.
  const creditLine = outlet ? `SOURCE: ${credit.toUpperCase()}` : credit;

  // The beats: the set rises 0-20, static 10-40 (the channel change), picture 40 on, lower third 50-64,
  // ticker 62 on, camera eases in 56-96.
  const rise = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  });
  const snow = interpolate(frame, [8, 12, 36, 42], [0, 1, 1, 0], clamp);
  const picture = interpolate(frame, [36, 44], [0, 1], clamp);
  // The picture rolls down into place as the tube locks on.
  const roll = interpolate(frame, [36, 50], [-SH * 0.35, 0], {
    ...clamp,
    easing: easeOut,
  });
  const third = spring({
    frame: frame - 50,
    fps,
    config: { damping: 16, stiffness: 170, mass: 0.6 },
  });
  const tickerIn = interpolate(frame, [60, 70], [0, 1], clamp);
  const zoom = interpolate(frame, [56, 96], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const scale = 0.86 + 0.32 * zoom;

  const headSize = sizeByLength(headline.length, [
    [30, 50],
    [56, 44],
    [80, 38],
    [999, 34],
  ]);
  const segments = [headline, outlet?.toUpperCase()].filter(
    Boolean,
  ) as string[];
  const crawl = Array.from({ length: 8 }, () => segments).flat();
  const crawlX = 20 - Math.max(0, frame - 60) * 3.2;

  // The camera centres on the screen, so the cabinet's own centre sits off to one side for the wood set.
  const screenCx = cab.sx + SW / 2;
  const screenCy = cab.sy + SH / 2;
  const fringe = wood ? 2.5 : 1.5;

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={14}>
      <div
        style={{
          position: "absolute",
          left: 960 - screenCx,
          top: 520 - screenCy + (1 - rise) * 360,
          width: cab.w,
          height: cab.h,
          transformOrigin: `${screenCx}px ${screenCy}px`,
          transform: `scale(${scale}) rotate(${(variant % 2 ? 1 : -1) * 1.2 * (1 - zoom)}deg)`,
          borderRadius: wood ? 26 : 70,
          background: wood
            ? "repeating-linear-gradient(88deg,#5a3418 0px,#6e4220 9px,#5f381a 17px,#7a4a25 26px,#5a3418 34px)"
            : "linear-gradient(180deg,#2b2b31 0%,#18181c 60%,#101013 100%)",
          boxShadow: wood
            ? "0 50px 120px rgba(0,0,0,0.7), inset 0 0 0 10px #4a2a12, inset 0 4px 0 14px rgba(255,255,255,0.06)"
            : "0 50px 120px rgba(0,0,0,0.7), inset 0 3px 0 rgba(255,255,255,0.12), inset 0 0 0 2px #3a3a42",
        }}
      >
        {wood && <WoodControls x={cab.sx + SW + 50} h={cab.h} />}
        {!wood && (
          <PlasticFront top={cab.sy + SH + 50} frame={frame} />
        )}
        {/* The bezel round the tube. */}
        <div
          style={{
            position: "absolute",
            left: cab.sx - 30,
            top: cab.sy - 30,
            width: SW + 60,
            height: SH + 60,
            borderRadius: 60,
            background: wood
              ? "linear-gradient(180deg,#c9c7bf,#8d8b83)"
              : "linear-gradient(180deg,#24242a,#0d0d10)",
            boxShadow: wood
              ? "inset 0 3px 0 #eeece4, inset 0 -3px 0 #6a685f"
              : "inset 0 2px 0 #3c3c44, inset 0 -2px 0 #000",
          }}
        />
        {/* The tube: its glass bulges, so the corners round off and darken. */}
        <div
          style={{
            position: "absolute",
            left: cab.sx,
            top: cab.sy,
            width: SW,
            height: SH,
            borderRadius: "48px / 60px",
            overflow: "hidden",
            background: "#0a0c0e",
            fontFamily: BODY,
          }}
        >
          {/* The bulletin's picture, rolling down into place. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: picture,
              transform: `translateY(${roll}px)`,
            }}
          >
            {src ? (
              <Img
                src={src}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  filter: wood
                    ? "saturate(1.3) contrast(1.1) blur(0.6px)"
                    : "saturate(1.15) contrast(1.05) blur(0.3px)",
                  transform: `scale(${1.04 + 0.05 * zoom})`,
                }}
              />
            ) : (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(160deg,#1e2a48,#0b1020)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <PulseMark size={300} colour={COLOUR.amber} />
              </div>
            )}
            {/* The station bug, top left. */}
            <div
              style={{
                position: "absolute",
                left: 40,
                top: 36,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 14px 6px 8px",
                background: wood
                  ? "rgba(10,30,120,0.85)"
                  : "rgba(10,10,14,0.72)",
                borderLeft: `6px solid ${COLOUR.amber}`,
                color: "#fff",
                fontFamily: wood ? DISPLAY : BODY,
                fontWeight: 900,
                fontSize: 28,
                letterSpacing: wood ? 3 : 2,
                textShadow: `${fringe}px 0 rgba(255,0,60,0.55), -${fringe}px 0 rgba(0,200,255,0.55)`,
              }}
            >
              <PulseMark size={34} colour={COLOUR.amber} />
              PULSE NEWS
            </div>
            {/* The lower third: the headline on a plate, the credit under it. */}
            <div
              style={{
                position: "absolute",
                left: 36,
                right: 36,
                bottom: 74,
                transform: `translateX(${(1 - third) * -(SW + 40)}px)`,
              }}
            >
              <div
                style={{
                  padding: "12px 22px 12px",
                  background: wood
                    ? "linear-gradient(180deg,#1c3fb8,#0a1f78)"
                    : "linear-gradient(180deg,rgba(250,250,248,0.97),rgba(214,214,210,0.97))",
                  borderTop: `5px solid ${COLOUR.amber}`,
                  color: wood ? "#ffe680" : COLOUR.ink,
                  fontFamily: DISPLAY,
                  fontSize: headSize,
                  lineHeight: 1.08,
                  letterSpacing: 0.5,
                  textShadow: wood
                    ? `${fringe}px 0 rgba(255,0,60,0.5), -${fringe}px 0 rgba(0,200,255,0.5)`
                    : "none",
                }}
              >
                {headline}
              </div>
              {creditLine && (
                <div
                  style={{
                    display: "inline-block",
                    padding: "5px 16px",
                    background: wood ? "#000" : COLOUR.amber,
                    color: wood ? "#fff" : COLOUR.ink,
                    fontWeight: 900,
                    fontSize: 26,
                    letterSpacing: 1.5,
                  }}
                >
                  {creditLine}
                </div>
              )}
            </div>
            {/* The ticker: the headline and the outlet, round and round. */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 22,
                height: 44,
                display: "flex",
                opacity: tickerIn,
                background: "rgba(8,8,12,0.9)",
                borderTop: `2px solid ${COLOUR.amber}`,
              }}
            >
              <div
                style={{
                  flex: "0 0 auto",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 14px",
                  background: COLOUR.amber,
                }}
              >
                <PulseMark size={28} colour={COLOUR.ink} />
              </div>
              <div
                style={{ position: "relative", flex: 1, overflow: "hidden" }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    display: "flex",
                    alignItems: "center",
                    whiteSpace: "nowrap",
                    transform: `translateX(${crawlX}px)`,
                    fontWeight: 800,
                    fontSize: 26,
                    letterSpacing: 1,
                    color: "#f5f5f2",
                  }}
                >
                  {crawl.map((s, i) => (
                    <React.Fragment key={i}>
                      <span>{s}</span>
                      <span
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          margin: "0 24px",
                          background: COLOUR.amber,
                          transform: "rotate(45deg)",
                        }}
                      />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <Snow frame={frame} opacity={snow} />
          {/* Scanlines, the glass's curve (darker corners, a bright bulge) and its reflection. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(180deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 4px)",
              opacity: wood ? 1 : 0.7,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "48px / 60px",
              boxShadow:
                "inset 0 0 90px rgba(0,0,0,0.75), inset 0 0 22px rgba(0,0,0,0.8)",
              background:
                "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: -SW * 0.1,
              top: -SH * 0.3,
              width: SW * 0.75,
              height: SH * 0.7,
              borderRadius: "50%",
              background:
                "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.10), rgba(255,255,255,0) 70%)",
              transform: "rotate(-18deg)",
            }}
          />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 60,
          bottom: 48,
          color: "rgba(255,255,255,0.7)",
          fontFamily: BODY,
          fontSize: 20,
          letterSpacing: 3,
          opacity: interpolate(frame, [30, 40], [0, 1], clamp),
        }}
      >
        ILLUSTRATION
      </div>
    </Stage>
  );
};

export { fitsPulseTV } from "./pressKit.ts";
