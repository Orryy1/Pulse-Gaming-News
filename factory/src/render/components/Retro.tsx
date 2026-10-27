// The old-footage kit (owner, 27 Oct 2026: "an old CRT TV turning on, VHS effects, a VHS being loaded
// into an old TV, CRT effects etc. for old footage and loads more ideas like that"). A game from before
// 2007 can open on the hardware of its day (a TV and VCR taking a tape, an arcade cabinet, a beige PC
// monitor, a handheld) before the camera pushes through the glass; its other shots can wear a VHS or CRT
// look; a cut between them can be a burst of channel static; and its last shot can switch off the way a
// tube did, to a line and then a dot.

import React, { useId } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY, HAND } from "./fonts.ts";
import { DEVICE_FRAMES, deviceFor, handheldGreen, OLD_YEAR, type Device } from "../retroplan.ts";

export { DEVICE_FRAMES, deviceFor, handheldGreen, OLD_YEAR, type Device };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const inOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const MONO = "'Courier New', Courier, monospace";
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

/** A seeded number in [0, 1) for frame-by-frame noise that renders the same every time. */
const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------------------------------------------
// Looks over footage

/** Red split from green and blue a few pixels sideways: the colour bleed of a worn tape. */
const ChromaFilter: React.FC<{ id: string; shift: number }> = ({
  id,
  shift,
}) => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <filter
      id={id}
      x="0"
      y="0"
      width="100%"
      height="100%"
      colorInterpolationFilters="sRGB"
    >
      <feColorMatrix
        in="SourceGraphic"
        type="matrix"
        values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
        result="r"
      />
      <feOffset in="r" dx={shift} dy={0} result="rs" />
      <feColorMatrix
        in="SourceGraphic"
        type="matrix"
        values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"
        result="gb"
      />
      <feBlend in="rs" in2="gb" mode="screen" />
    </filter>
  </svg>
);

/**
 * Footage as it looked off a VHS tape: colour bleed, softness, washed colour, fine scanlines, sparkle
 * noise, a tracking band rolling through now and then, the head-switching ragged strip along the bottom,
 * a little horizontal wobble and the player's PLAY in the corner as the shot starts.
 */
export const VhsLook: React.FC<{
  children: React.ReactNode;
  osd?: boolean;
  seed?: number;
}> = ({ children, osd = true, seed = 0 }) => {
  const frame = useCurrentFrame();
  const id = `vhs${safeId(useId())}`;
  const wobble =
    rand(frame * 0.37 + seed) > 0.86 ? (rand(frame + seed) - 0.5) * 6 : 0;
  // A tracking band every four seconds or so, rolling down over about a second.
  const cycle = (frame + seed * 37) % 130;
  const band = cycle < 30 ? (cycle / 30) * 120 - 10 : -20;
  const sparks = Array.from({ length: 14 }, (_, i) => {
    const r = rand(frame * 13.1 + i * 7.7 + seed);
    return {
      x: rand(r * 91 + i) * 100,
      y: rand(r * 53 + i * 3) * 100,
      w: 20 + rand(r * 17) * 90,
      o: 0.25 + r * 0.5,
    };
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <ChromaFilter id={id} shift={4} />
      <AbsoluteFill
        style={{
          filter: `url(#${id}) saturate(0.78) contrast(1.08) brightness(1.04) blur(0.7px) sepia(0.12)`,
          transform: `translateX(${wobble}px)`,
        }}
      >
        {children}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)",
        }}
      />
      {sparks.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.w,
            height: 2,
            background: `rgba(255,255,255,${s.o})`,
          }}
        />
      ))}
      {band > -15 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${band}%`,
            height: 70,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(230,235,255,0.16) 40%, rgba(255,255,255,0.28) 50%, rgba(230,235,255,0.14) 60%, rgba(255,255,255,0) 100%)",
            transform: `translateX(${(rand(frame + 5) - 0.5) * 30}px)`,
          }}
        />
      ) : null}
      {/* The head-switching strip: a ragged band of noise along the very bottom. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 16,
          background: `repeating-linear-gradient(90deg, rgba(255,255,255,0.35) 0px, rgba(255,255,255,0.05) ${4 + (frame % 5)}px, rgba(0,0,0,0.4) ${9 + (frame % 7)}px)`,
          transform: `translateX(${(rand(frame * 3) - 0.5) * 40}px)`,
        }}
      />
      {osd && frame < 60 ? (
        <div
          style={{
            position: "absolute",
            left: 80,
            top: 120,
            fontFamily: MONO,
            fontWeight: 700,
            fontSize: 50,
            letterSpacing: 4,
            color: "#f2f2f2",
            textShadow:
              "2px 0 rgba(255,40,80,0.6), -2px 0 rgba(40,220,255,0.6)",
            opacity: frame < 45 || Math.floor(frame / 6) % 2 === 0 ? 1 : 0,
          }}
        >
          PLAY {"▶"}
        </div>
      ) : null}
      {osd ? (
        <div
          style={{
            position: "absolute",
            right: 90,
            bottom: 70,
            fontFamily: MONO,
            fontWeight: 700,
            fontSize: 40,
            letterSpacing: 4,
            color: "rgba(242,242,242,0.85)",
            textShadow:
              "2px 0 rgba(255,40,80,0.5), -2px 0 rgba(40,220,255,0.5)",
          }}
        >
          SP
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Footage on a tube: RGB phosphor stripes, heavy scanlines, a soft bloom, a curved dark edge and flicker. */
export const CrtLook: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const frame = useCurrentFrame();
  const flicker = 0.97 + rand(frame * 0.71) * 0.03;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <AbsoluteFill
        style={{
          filter: `contrast(1.15) saturate(1.2) brightness(${1.1 * flicker})`,
          transform: "scale(1.02)",
        }}
      >
        {children}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          mixBlendMode: "multiply",
          background:
            "repeating-linear-gradient(90deg, rgba(255,90,90,0.9) 0px, rgba(255,90,90,0.9) 2px, rgba(90,255,90,0.9) 2px, rgba(90,255,90,0.9) 4px, rgba(90,90,255,0.9) 4px, rgba(90,90,255,0.9) 6px)",
          opacity: 0.32,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(0,0,0,0.38) 0px, rgba(0,0,0,0.38) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 4px)",
        }}
      />
      <AbsoluteFill
        style={{
          borderRadius: "70px / 60px",
          boxShadow: "inset 0 0 160px 40px rgba(0,0,0,0.85), 0 0 0 80px #000",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(130deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 35%)",
        }}
      />
    </AbsoluteFill>
  );
};

/** The last frames of a shot as a tube switching off: the picture squeezes to a bright line, then a dot. */
export const PowerOff: React.FC<{
  children: React.ReactNode;
  frames: number;
}> = ({ children, frames }) => {
  const frame = useCurrentFrame();
  const t = frame - (frames - 12);
  if (t < 0) return <>{children}</>;
  const sy = interpolate(t, [0, 6], [1, 0.006], {
    ...clamp,
    easing: (x) => x * x,
  });
  const sx = interpolate(t, [6, 10], [1, 0.004], clamp);
  const glow = interpolate(t, [0, 6, 11], [1, 3, 0], clamp);
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${sx}, ${sy})`,
          filter: `brightness(${glow + 0.2})`,
        }}
      >
        {children}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(${12 * sx + 1}% ${2 + 6 * (1 - sx)}% at 50% 50%, rgba(220,235,255,${0.8 * Math.min(1, glow)}) 0%, rgba(0,0,0,0) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** A burst of channel static between two shots, with the channel number in green in the corner. */
export const ChannelStatic: React.FC<{ variant?: number }> = ({
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  // Any frame size: the long videos' 16:9 and the Shorts' 9:16.
  const { width, height } = useVideoConfig();
  const id = `static${safeId(useId())}`;
  const o = interpolate(frame, [0, 2, 6, 9], [0, 1, 1, 0], clamp);
  if (o <= 0) return null;
  return (
    <AbsoluteFill style={{ opacity: o, pointerEvents: "none" }}>
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0 }}
      >
        <filter id={id} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9 0.6"
            numOctaves={1}
            seed={frame * 7 + variant}
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope={0} intercept={1} />
          </feComponentTransfer>
        </filter>
        <rect width={width} height={height} filter={`url(#${id})`} />
      </svg>
      <div
        style={{
          position: "absolute",
          right: 110,
          top: 110,
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: 64,
          color: "#48ff6a",
          textShadow: "0 0 12px rgba(72,255,106,0.7)",
        }}
      >
        CH {String(2 + (variant % 9)).padStart(2, "0")}
      </div>
    </AbsoluteFill>
  );
};
export const STATIC_FRAMES = 9;

// ---------------------------------------------------------------------------------------------------
// Hardware the camera pushes through

interface Screen {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Corner rounding while the glass is visible. */
  r: number;
}

/**
 * The shared camera move: the device holds, then the camera pushes into its screen until the picture
 * inside fills the frame exactly, so the hand-over to the plain shot is seamless. Widescreen footage sits
 * letterboxed in the screen, as it did.
 */
const PushThrough: React.FC<{
  children: React.ReactNode;
  screen: Screen;
  hold: number;
  push: number;
  room: string;
  /** Everything drawn around the screen (cabinet, desk, buttons); `on` 0-1 as the device powers up. */
  body: (on: number, glass: number) => React.ReactNode;
  /** What the screen shows before the footage (a blue PLAY screen, static): null once the footage is up. */
  screenOverlay?: (frame: number) => React.ReactNode;
  /** When the picture appears on the screen (the power-on line opens then). */
  onAt?: number;
  tint?: string;
}> = ({
  children,
  screen,
  hold,
  push,
  room,
  body,
  screenOverlay,
  onAt = 3,
  tint,
}) => {
  const frame = useCurrentFrame();
  if (frame >= hold + push) return <>{children}</>;
  const through = 1920 / screen.w;
  const settle = interpolate(frame, [0, hold], [1, 1.05], clamp);
  const t = inOut(interpolate(frame, [hold, hold + push], [0, 1], clamp));
  const z = settle + (through - settle) * t;
  const glass = 1 - t;
  const on = interpolate(frame, [onAt, onAt + 10], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const bloom = interpolate(
    frame,
    [onAt, onAt + 6, onAt + 15],
    [2.4, 1.6, 1],
    clamp,
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: room }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: `${screen.cx}px ${screen.cy}px`,
          transform: `translate(${(960 - screen.cx) * t}px, ${(540 - screen.cy) * t}px) scale(${z})`,
        }}
      >
        {body(on, glass)}
        <div
          style={{
            position: "absolute",
            left: screen.cx - screen.w / 2,
            top: screen.cy - screen.h / 2,
            width: screen.w,
            height: screen.h,
            borderRadius: screen.r * glass,
            overflow: "hidden",
            background: "#0b0d0d",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 1920,
              height: 1080,
              transform: `translate(-50%, -50%) scale(${1 / through})`,
              clipPath: `inset(${(1 - on) * 49.6}% 0 ${(1 - on) * 49.6}% 0)`,
              filter: `brightness(${bloom}) saturate(${1 - 0.15 * glass})`,
            }}
          >
            {children}
            {tint ? (
              <AbsoluteFill
                style={{
                  background: tint,
                  mixBlendMode: "multiply",
                  opacity: glass,
                }}
              />
            ) : null}
          </div>
          {screenOverlay ? screenOverlay(frame) : null}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0.5 * glass,
              background:
                "repeating-linear-gradient(180deg, rgba(0,0,0,0.38) 0px, rgba(0,0,0,0.38) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: glass,
              background:
                "radial-gradient(115% 105% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.7) 100%), linear-gradient(128deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.03) 26%, rgba(255,255,255,0) 40%)",
            }}
          />
        </div>
      </div>
      <AbsoluteFill
        style={{
          background: "#e4ecff",
          opacity: interpolate(
            frame,
            [hold + push - 7, hold + push - 1],
            [0, 0.16],
            clamp,
          ),
        }}
      />
    </AbsoluteFill>
  );
};


const WOOD =
  "linear-gradient(180deg, #4a3322 0%, #3a2819 8%, #2a1d12 40%, #120c08 100%)";
const DIM_ROOM =
  "radial-gradient(55% 65% at 16% 22%, rgba(255,168,92,0.16) 0%, rgba(255,168,92,0) 70%), linear-gradient(180deg, #1c1815 0%, #14110f 62%, #0c0a09 100%)";

/**
 * A TV on a VCR: a tape (the game's name on its label) slides into the deck, the deck reads PLAY, the
 * screen comes up on the player's blue PLAY screen, tracking noise rolls into the picture, then the push.
 */
export const VcrTV: React.FC<{ children: React.ReactNode; label: string }> = ({
  children,
  label,
}) => {
  const S: Screen = { cx: 960, cy: 400, w: 640, h: 480, r: 42 };
  const frame = useCurrentFrame();
  return (
    <PushThrough
      screen={S}
      hold={90}
      push={22}
      room={DIM_ROOM}
      onAt={28}
      body={(on) => (
        <>
          <div
            style={{
              position: "absolute",
              left: 220,
              right: 220,
              top: 920,
              height: 300,
              background: WOOD,
            }}
          />
          {/* The TV. */}
          <div
            style={{
              position: "absolute",
              left: S.cx - 420,
              top: S.cy - 300,
              width: 840,
              height: 640,
              borderRadius: 42,
              background:
                "linear-gradient(180deg, #3b3835 0%, #2a2826 50%, #1d1b1a 100%)",
              boxShadow:
                "0 40px 90px rgba(0,0,0,0.75), inset 0 2px 0 rgba(255,255,255,0.09)",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: 60,
                bottom: 30,
                width: 12,
                height: 12,
                borderRadius: 6,
                background: "#ff4a3a",
                boxShadow: `0 0 ${14 * on}px rgba(255,74,58,0.9)`,
              }}
            />
          </div>
          {/* The VCR under it, its slot and its little green display. */}
          <div
            style={{
              position: "absolute",
              left: S.cx - 400,
              top: 760,
              width: 800,
              height: 160,
              borderRadius: 10,
              background: "linear-gradient(180deg, #2c2c2f 0%, #1a1a1c 100%)",
              boxShadow:
                "0 24px 50px rgba(0,0,0,0.7), inset 0 2px 0 rgba(255,255,255,0.08)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 120,
                top: 40,
                width: 420,
                height: 34,
                borderRadius: 4,
                background: "#060607",
                boxShadow: "inset 0 4px 8px rgba(0,0,0,0.9)",
              }}
            />
            <div
              style={{
                position: "absolute",
                right: 50,
                top: 40,
                width: 150,
                height: 46,
                borderRadius: 4,
                background: "#081108",
                fontFamily: MONO,
                fontWeight: 700,
                fontSize: 30,
                color: "#5cff7a",
                textShadow: "0 0 8px rgba(92,255,122,0.8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {frame >= 26 ? "PLAY" : frame >= 4 ? "LOAD" : "--:--"}
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 120 + i * 70,
                  bottom: 22,
                  width: 50,
                  height: 18,
                  borderRadius: 4,
                  background: "#3a3a3e",
                }}
              />
            ))}
          </div>
          {/* The tape, label to camera: carried in from the right, then pushed down into the slot. */}
          {frame < 27 ? (
            <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 817, overflow: "hidden" }}>
              <div
                style={{
                  position: "absolute",
                  left: interpolate(frame, [0, 14], [1260, 680], { ...clamp, easing: (x) => 1 - (1 - x) ** 2 }),
                  top:
                    interpolate(frame, [0, 14], [600, 550], clamp) +
                    interpolate(frame, [14, 26], [0, 270], { ...clamp, easing: (x) => x * x }),
                  width: 420,
                  height: 250,
                  transformOrigin: "50% 100%",
                  transform: `scale(${interpolate(frame, [0, 14], [1.5, 1], clamp)}) rotate(${interpolate(frame, [0, 14], [10, 0], clamp)}deg)`,
                  borderRadius: 10,
                  background: "linear-gradient(180deg, #1d1d20 0%, #121214 100%)",
                  boxShadow: "0 30px 60px rgba(0,0,0,0.7)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 26,
                    right: 26,
                    top: 24,
                    height: 100,
                    background: "#efeadd",
                    borderRadius: 4,
                    padding: "10px 16px",
                    boxSizing: "border-box",
                  }}
                >
                  <div style={{ height: 3, background: "#c94a36", marginBottom: 8 }} />
                  <div
                    style={{
                      fontFamily: HAND,
                      fontSize: label.length > 22 ? 26 : 32,
                      color: "#1c1a17",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                    }}
                  >
                    {label}
                  </div>
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 120,
                    right: 120,
                    top: 150,
                    height: 70,
                    borderRadius: 8,
                    background: "#09090a",
                  }}
                />
              </div>
            </div>
          ) : null}
        </>
      )}
      screenOverlay={(f) => {
        if (f < 28 || f > 56) return null;
        const blue = f < 44;
        const noise = interpolate(f, [42, 56], [1, 0], clamp);
        return (
          <AbsoluteFill>
            {blue ? (
              <AbsoluteFill
                style={{
                  background: "#1c3ed1",
                  alignItems: "flex-start",
                  justifyContent: "flex-start",
                  padding: "36px 40px",
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontWeight: 700,
                    fontSize: 46,
                    color: "#f2f2f2",
                    letterSpacing: 4,
                  }}
                >
                  PLAY {"▶"}
                </div>
              </AbsoluteFill>
            ) : null}
            {f >= 40 ? (
              <AbsoluteFill
                style={{
                  opacity: noise,
                  background: `repeating-linear-gradient(180deg, rgba(255,255,255,${0.5 * rand(f)}) 0px, rgba(0,0,0,0.6) ${2 + (f % 3)}px, rgba(255,255,255,0.3) ${5 + (f % 4)}px)`,
                }}
              />
            ) : null}
          </AbsoluteFill>
        );
      }}
    >
      <VhsLook osd={false} seed={7}>
        {children}
      </VhsLook>
    </PushThrough>
  );
};

/** An arcade cabinet in a dark arcade: the marquee lit with the game's name, the control panel below. */
export const ArcadeCabinet: React.FC<{
  children: React.ReactNode;
  label: string;
}> = ({ children, label }) => {
  const S: Screen = { cx: 960, cy: 470, w: 600, h: 450, r: 30 };
  return (
    <PushThrough
      screen={S}
      hold={60}
      push={24}
      room="radial-gradient(50% 70% at 50% 40%, #2a1240 0%, #12081d 55%, #060309 100%)"
      tint="rgba(255,235,255,1)"
      body={(on) => (
        <>
          {/* Neon glow from the next machines along. */}
          <div
            style={{
              position: "absolute",
              left: 120,
              top: 200,
              width: 260,
              height: 700,
              background:
                "radial-gradient(closest-side, rgba(0,220,255,0.18), rgba(0,0,0,0))",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 120,
              top: 200,
              width: 260,
              height: 700,
              background:
                "radial-gradient(closest-side, rgba(255,40,180,0.18), rgba(0,0,0,0))",
            }}
          />
          {/* The cabinet sides and body. */}
          <div
            style={{
              position: "absolute",
              left: S.cx - 430,
              top: 40,
              width: 860,
              height: 1100,
              background:
                "linear-gradient(90deg, #141018 0%, #241c2c 12%, #1a1420 88%, #0e0a12 100%)",
              clipPath:
                "polygon(6% 0, 94% 0, 100% 14%, 96% 52%, 100% 60%, 100% 100%, 0 100%, 0 60%, 4% 52%, 0 14%)",
              boxShadow: "0 0 80px rgba(0,0,0,0.8)",
            }}
          />
          {/* The marquee. */}
          <div
            style={{
              position: "absolute",
              left: S.cx - 360,
              top: 70,
              width: 720,
              height: 120,
              borderRadius: 8,
              background: `linear-gradient(180deg, rgba(255,190,90,${0.4 + 0.6 * on}) 0%, rgba(255,90,40,${0.4 + 0.6 * on}) 100%)`,
              boxShadow: `0 0 ${60 * on}px rgba(255,140,60,0.6)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: DISPLAY,
              fontSize: label.length > 20 ? 48 : 64,
              color: "#1a0d05",
              letterSpacing: 2,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              padding: "0 20px",
            }}
          >
            {label}
          </div>
          {/* The bezel round the screen. */}
          <div
            style={{
              position: "absolute",
              left: S.cx - 350,
              top: S.cy - 270,
              width: 700,
              height: 540,
              borderRadius: 20,
              background: "#07060a",
              boxShadow: "inset 0 0 30px rgba(0,0,0,0.9)",
            }}
          />
          {/* The control panel: a stick and six buttons. */}
          <div
            style={{
              position: "absolute",
              left: S.cx - 420,
              top: 760,
              width: 840,
              height: 220,
              background: "linear-gradient(180deg, #2b2233 0%, #19131f 100%)",
              transform: "perspective(800px) rotateX(38deg)",
              transformOrigin: "50% 0%",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 150,
                top: 70,
                width: 80,
                height: 80,
                borderRadius: 40,
                background:
                  "radial-gradient(circle at 35% 30%, #ff6a6a, #a3121c)",
                boxShadow: "0 10px 14px rgba(0,0,0,0.6)",
              }}
            />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 420 + (i % 3) * 100,
                  top: 40 + Math.floor(i / 3) * 80,
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  background: [
                    "radial-gradient(circle at 35% 30%, #fff38a, #c9a400)",
                    "radial-gradient(circle at 35% 30%, #8ae0ff, #0d77b8)",
                    "radial-gradient(circle at 35% 30%, #a7ff9a, #22a12d)",
                  ][i % 3],
                  boxShadow: "0 8px 12px rgba(0,0,0,0.6)",
                }}
              />
            ))}
          </div>
        </>
      )}
    >
      <CrtLook>{children}</CrtLook>
    </PushThrough>
  );
};

/** A beige CRT monitor on a desk, the keyboard's edge in front: a PC game of its day. */
export const RetroMonitor: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const S: Screen = { cx: 960, cy: 430, w: 620, h: 465, r: 24 };
  return (
    <PushThrough
      screen={S}
      hold={56}
      push={24}
      room="radial-gradient(60% 60% at 70% 20%, rgba(170,200,255,0.12) 0%, rgba(0,0,0,0) 70%), linear-gradient(180deg, #23211e 0%, #171513 70%, #0d0c0b 100%)"
      body={(on) => (
        <>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 840,
              height: 300,
              background:
                "linear-gradient(180deg, #6e5a43 0%, #4a3b2b 30%, #241c14 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: S.cx - 400,
              top: S.cy - 310,
              width: 800,
              height: 640,
              borderRadius: 26,
              background:
                "linear-gradient(180deg, #d9d1bd 0%, #c8bfa9 60%, #b3aa93 100%)",
              boxShadow:
                "0 40px 80px rgba(0,0,0,0.65), inset 0 3px 0 rgba(255,255,255,0.5), inset 0 -6px 14px rgba(0,0,0,0.25)",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: 70,
                bottom: 32,
                width: 14,
                height: 14,
                borderRadius: 7,
                background: on > 0.5 ? "#4cff6a" : "#1d4a24",
                boxShadow: on > 0.5 ? "0 0 12px rgba(76,255,106,0.9)" : "none",
              }}
            />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 90 + i * 16,
                  bottom: 36,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: "#9c9480",
                }}
              />
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              left: S.cx - 140,
              top: S.cy + 330,
              width: 280,
              height: 70,
              background: "linear-gradient(180deg, #c8bfa9, #9d957f)",
              borderRadius: "0 0 20px 20px",
            }}
          />
          {/* The keyboard's edge in the foreground, a little out of focus. */}
          <div
            style={{
              position: "absolute",
              left: S.cx - 620,
              top: 960,
              width: 1240,
              height: 200,
              borderRadius: 16,
              background:
                "repeating-linear-gradient(90deg, #cfc7b2 0px, #cfc7b2 70px, #b6ae99 70px, #b6ae99 76px)",
              filter: "blur(5px)",
              boxShadow: "0 -10px 30px rgba(0,0,0,0.5)",
            }}
          />
        </>
      )}
    >
      {children}
    </PushThrough>
  );
};

/**
 * A handheld of no particular brand held in two hands of light: the screen in the middle, a cross pad and
 * buttons either side. A game from before 1999 plays in the green of the early screens.
 */
export const Handheld: React.FC<{
  children: React.ReactNode;
  green?: boolean;
}> = ({ children, green }) => {
  const S: Screen = { cx: 960, cy: 520, w: 640, h: 427, r: 14 };
  return (
    <PushThrough
      screen={S}
      hold={56}
      push={24}
      room="radial-gradient(60% 60% at 50% 50%, #2a2f3a 0%, #12151b 70%, #08090c 100%)"
      tint={green ? "rgba(155,188,15,1)" : undefined}
      body={(on) => (
        <>
          <div
            style={{
              position: "absolute",
              left: S.cx - 720,
              top: S.cy - 330,
              width: 1440,
              height: 660,
              borderRadius: 300,
              background:
                "linear-gradient(180deg, #4b4f5a 0%, #34373f 55%, #24262c 100%)",
              boxShadow:
                "0 50px 100px rgba(0,0,0,0.7), inset 0 3px 0 rgba(255,255,255,0.12)",
            }}
          >
            {/* The cross pad. */}
            <div
              style={{
                position: "absolute",
                left: 120,
                top: 270,
                width: 150,
                height: 50,
                background: "#17181c",
                borderRadius: 8,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 170,
                top: 220,
                width: 50,
                height: 150,
                background: "#17181c",
                borderRadius: 8,
              }}
            />
            {/* Two buttons. */}
            <div
              style={{
                position: "absolute",
                right: 220,
                top: 300,
                width: 80,
                height: 80,
                borderRadius: 40,
                background:
                  "radial-gradient(circle at 35% 30%, #a24bd6, #4b1670)",
              }}
            />
            <div
              style={{
                position: "absolute",
                right: 110,
                top: 240,
                width: 80,
                height: 80,
                borderRadius: 40,
                background:
                  "radial-gradient(circle at 35% 30%, #a24bd6, #4b1670)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 340,
                top: 300,
                width: 10,
                height: 10,
                borderRadius: 5,
                background: on > 0.5 ? "#ff4040" : "#4a1414",
                boxShadow: on > 0.5 ? "0 0 10px #ff4040" : "none",
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: S.cx - 360,
              top: S.cy - 250,
              width: 720,
              height: 500,
              borderRadius: 30,
              background: "#1b1c21",
              boxShadow: "inset 0 4px 12px rgba(0,0,0,0.8)",
            }}
          />
        </>
      )}
    >
      {children}
    </PushThrough>
  );
};

