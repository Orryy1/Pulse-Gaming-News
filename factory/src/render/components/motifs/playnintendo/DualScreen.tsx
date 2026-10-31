// Nintendo DS and 3DS (2004-2020) homage: a two-screen clamshell of no particular model. The lid swings
// open, the top screen lights with the picture, the touch screen below shows the heading and kicker and
// a stylus taps it. The styles put one side of a comparison on each screen. Built from scratch: no logo,
// wordmark, real menu or model-specific detail.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import { countText, parseFigure } from "../../packs/data/figures.ts";
import type { MotifCardProps } from "../types.ts";
import { PulseBadge } from "../../packs/pulse/PulseBadge.tsx";
import {
  clamp,
  clean,
  easeInOut,
  fit,
  lineClamp,
  linesNeeded,
  longestWord,
  metaLine,
  splitPairs,
  useCard,
} from "./shared.tsx";

type Way = {
  shell: string;
  shade: string;
  edge: string;
  accent: string;
  key: string;
  room: string;
};
const WAYS: Way[] = [
  {
    shell: "#eceff3",
    shade: "#c3c9d2",
    edge: "#a7afba",
    accent: "#2f8fe0",
    key: "#d3d8df",
    room: "#3b4352",
  },
  {
    shell: "#34373e",
    shade: "#1c1e23",
    edge: "#50545e",
    accent: "#ef4a3c",
    key: "#24272c",
    room: "#2d2f36",
  },
  {
    shell: "#2e5ab2",
    shade: "#1b376f",
    edge: "#4a75c9",
    accent: "#ffcf3a",
    key: "#22438a",
    room: "#1d2a48",
  },
  {
    shell: "#b5323c",
    shade: "#761c23",
    edge: "#cf5059",
    accent: "#ffffff",
    key: "#8c2229",
    room: "#3a1c22",
  },
];
const wayOf = (v: number) =>
  WAYS[((Math.floor(v) % WAYS.length) + WAYS.length) % WAYS.length]!;

// Device geometry in its own pixels (scaled as a whole).
const DW = 900;
const LID_H = 520;
const HINGE_H = 36;
const BASE_H = 520;
export const DEVICE_H = LID_H + HINGE_H + BASE_H;
const TOP = { x: 90, y: 46, w: 720, h: 432 };
const BOT = { x: 170, y: 48, w: 560, h: 420 };

const Dots: React.FC<{ x: number; y: number; colour: string }> = ({
  x,
  y,
  colour,
}) => (
  <>
    {Array.from({ length: 12 }, (_, i) => (
      <div
        key={i}
        style={{
          position: "absolute",
          left: x + (i % 3) * 14,
          top: y + Math.floor(i / 3) * 14,
          width: 6,
          height: 6,
          borderRadius: 3,
          background: colour,
        }}
      />
    ))}
  </>
);

/** The stylus and its tap: it glides in, presses at `tapAt` and lifts a little. Tip at (tx, ty). */
const Stylus: React.FC<{
  frame: number;
  fps: number;
  tx: number;
  ty: number;
  tapAt: number;
}> = ({ frame, fps, tx, ty, tapAt }) => {
  const come = spring({
    frame: frame - (tapAt - 12),
    fps,
    config: SPRING.ENTER,
  });
  const press = interpolate(
    frame,
    [tapAt - 2, tapAt, tapAt + 4, tapAt + 10],
    [0, 1, 1, 0.35],
    clamp,
  );
  const lift = (1 - press) * 26;
  const off = (1 - come) * 1;
  const ripple = interpolate(frame, [tapAt, tapAt + 16], [0, 1], clamp);
  return (
    <>
      {frame >= tapAt ? (
        <div
          style={{
            position: "absolute",
            left: tx - 70,
            top: ty - 70,
            width: 140,
            height: 140,
            borderRadius: 70,
            border: "5px solid rgba(47,143,224,0.9)",
            transform: `scale(${0.2 + 0.9 * ripple})`,
            opacity: 1 - ripple,
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: tx - 13,
          top: ty,
          width: 26,
          height: 470,
          transformOrigin: "13px 0px",
          transform: `translate(${off * 360 + lift * 0.57}px, ${off * 300 + lift * 0.82}px) rotate(-35deg)`,
          opacity: come,
          filter: "drop-shadow(10px 18px 14px rgba(0,0,0,0.35))",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 7,
            top: 0,
            width: 12,
            height: 30,
            borderRadius: "6px 6px 3px 3px",
            background: "linear-gradient(90deg, #6d737c, #b9bec6 45%, #5d636b)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 26,
            width: 26,
            height: 444,
            borderRadius: 13,
            background:
              "linear-gradient(90deg, #8a9099 0%, #eef1f4 38%, #c4c9d0 60%, #737a84 100%)",
          }}
        />
      </div>
    </>
  );
};

/**
 * The handheld, opening: `top` and `bottom` are each screen's contents (in screen pixels). `open` runs
 * 0..1 as the lid swings up; `on` 0..1 as the screens light. Children draw over the device (a stylus).
 */
const Device: React.FC<{
  way: Way;
  open: number;
  on: number;
  top: React.ReactNode;
  bottom: React.ReactNode;
  children?: React.ReactNode;
  badge?: React.ReactNode;
}> = ({ way, open, on, top, bottom, children, badge }) => {
  const angle = -180 * (1 - open);
  const screen = (
    r: { x: number; y: number; w: number; h: number },
    content: React.ReactNode,
    radius: number,
  ) => (
    <div
      style={{
        position: "absolute",
        left: r.x - 14,
        top: r.y - 14,
        width: r.w + 28,
        height: r.h + 28,
        borderRadius: radius + 10,
        background: "#14161b",
        boxShadow: "inset 0 3px 8px rgba(0,0,0,0.7)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 14,
          top: 14,
          width: r.w,
          height: r.h,
          borderRadius: radius,
          overflow: "hidden",
          background: "#0b0d11",
        }}
      >
        <div style={{ position: "absolute", inset: 0, opacity: on }}>
          {content}
        </div>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#ffffff",
            opacity: interpolate(on, [0, 0.3, 1], [0, 0.65, 0], clamp),
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(125deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.03) 34%, transparent 35%)",
          }}
        />
      </div>
    </div>
  );
  const shell = (h: number, radius: string): React.CSSProperties => ({
    position: "absolute",
    left: 0,
    width: DW,
    height: h,
    borderRadius: radius,
    background: `linear-gradient(180deg, ${way.shell} 0%, ${way.shell} 55%, ${way.shade} 100%)`,
    boxShadow: `inset 0 3px 0 rgba(255,255,255,0.35), inset 0 -4px 0 ${way.edge}`,
  });
  return (
    <div
      style={{
        position: "relative",
        width: DW,
        height: DEVICE_H,
        perspective: 2600,
      }}
    >
      {/* The base and its controls. */}
      <div
        style={{
          ...shell(BASE_H, "26px 26px 46px 46px"),
          top: LID_H + HINGE_H,
          boxShadow: `0 50px 90px rgba(0,0,0,0.55), inset 0 -5px 0 ${way.edge}`,
        }}
      >
        {screen(BOT, bottom, 6)}
        {/* A cross pad. */}
        <div
          style={{
            position: "absolute",
            left: 40,
            top: 168,
            width: 96,
            height: 32,
            borderRadius: 6,
            background: way.key,
            boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.3)",
            marginTop: 32,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 72,
            top: 168,
            width: 32,
            height: 96,
            borderRadius: 6,
            background: way.key,
            boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.3)",
          }}
        />
        {/* Four face buttons. */}
        {[
          [815, 172],
          [851, 208],
          [815, 244],
          [779, 208],
        ].map(([x, y], i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x! - 19,
              top: y! - 19,
              width: 38,
              height: 38,
              borderRadius: 19,
              background: way.key,
              boxShadow:
                "inset 0 -3px 0 rgba(0,0,0,0.3), 0 2px 0 rgba(255,255,255,0.25)",
            }}
          />
        ))}
        {[330, 372].map((y) => (
          <div
            key={y}
            style={{
              position: "absolute",
              left: 800,
              top: y,
              width: 30,
              height: 14,
              borderRadius: 7,
              background: way.key,
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: 76,
            top: 360,
            width: 10,
            height: 10,
            borderRadius: 5,
            background: on > 0.5 ? "#4ade80" : "#244b33",
            boxShadow: on > 0.5 ? "0 0 10px #4ade80" : "none",
          }}
        />
        {/* The Pulse badge printed under the touch screen. */}
        <PulseBadge
          size={26}
          colour={way.accent}
          opacity={0.85}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: BOT.y + BOT.h + 18,
            justifyContent: "center",
          }}
        />
      </div>
      {/* The hinge. */}
      <div
        style={{
          position: "absolute",
          left: 22,
          top: LID_H - 6,
          width: DW - 44,
          height: HINGE_H + 12,
          borderRadius: 24,
          background: `linear-gradient(180deg, ${way.shade}, ${way.shell} 45%, ${way.shade})`,
        }}
      />
      {badge}
      {/* The lid, swinging up about the hinge. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: DW,
          height: LID_H,
          transformOrigin: "50% 100%",
          transform: `rotateX(${angle}deg)`,
          transformStyle: "preserve-3d",
        }}
      >
        <div
          style={{
            ...shell(LID_H, "46px 46px 26px 26px"),
            top: 0,
            backfaceVisibility: "hidden",
          }}
        >
          {screen(TOP, top, 8)}
          <Dots x={30} y={196} colour={way.shade} />
          <Dots x={DW - 64} y={196} colour={way.shade} />
        </div>
        <div
          style={{
            ...shell(LID_H, "46px 46px 26px 26px"),
            top: 0,
            transform: "rotateX(180deg)",
            backfaceVisibility: "hidden",
            background: `linear-gradient(0deg, ${way.shell}, ${way.shade})`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 120,
              top: 90,
              right: 120,
              bottom: 90,
              borderRadius: 30,
              border: `4px solid ${way.edge}`,
              opacity: 0.6,
            }}
          />
          {/* The Pulse badge on the closed lid, where the maker's name is printed. */}
          <PulseBadge
            size={64}
            colour={way.edge}
            style={{ position: "absolute", inset: 0, justifyContent: "center" }}
          />
        </div>
      </div>
      {children}
    </div>
  );
};

/** The room: a soft light on a dark backdrop with a faint dot grid. */
const Room: React.FC<{ way: Way; at?: string }> = ({ way, at = "50% 50%" }) => (
  <>
    <AbsoluteFill
      style={{
        background: `radial-gradient(70% 75% at 50% 42%, ${way.room} 0%, #15171c 62%, #0a0b0e 100%)`,
      }}
    />
    <AbsoluteFill
      style={{
        background: `radial-gradient(34% 44% at ${at}, ${way.accent === "#ffffff" ? "#b5323c" : way.accent}24 0%, transparent 100%)`,
      }}
    />
    <AbsoluteFill
      style={{
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.07) 2px, transparent 2.5px)",
        backgroundSize: "44px 44px",
        WebkitMaskImage:
          "radial-gradient(60% 60% at 50% 45%, #000 0%, transparent 100%)",
        maskImage:
          "radial-gradient(60% 60% at 50% 45%, #000 0%, transparent 100%)",
      }}
    />
  </>
);

/** A touch screen's light panel: a faint grid, a coloured strip along the top. */
const TouchPanel: React.FC<{
  way: Way;
  label?: string;
  children: React.ReactNode;
}> = ({ way, label, children }) => (
  <AbsoluteFill style={{ background: "#f3f6f9" }}>
    <AbsoluteFill
      style={{
        backgroundImage:
          "linear-gradient(rgba(30,60,100,0.06) 2px, transparent 2px), linear-gradient(90deg, rgba(30,60,100,0.06) 2px, transparent 2px)",
        backgroundSize: "28px 28px",
      }}
    />
    {label ? (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 60,
          background: way.accent === "#ffffff" ? "#b5323c" : way.accent,
          display: "flex",
          alignItems: "center",
          padding: "0 26px",
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 28,
          letterSpacing: 4,
          color: way.accent === "#ffcf3a" ? "#1d2a48" : "#ffffff",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {label}
      </div>
    ) : null}
    {children}
  </AbsoluteFill>
);

// ---------------------------------------------------------------------------------------------------
// The card.

const DualCard: React.FC<MotifCardProps> = (props) => {
  const { frame, fps, len, fade } = useCard(props.frames);
  const way = wayOf(props.variant ?? 0);
  const heading = clean(props.heading);
  const kicker = clean(props.kicker);
  const game = clean(props.game);
  const year = clean(props.year);
  const pic = props.pictures.find(Boolean);
  // With no picture the top screen carries the game and year, so the touch screen does not repeat them.
  const meta = pic ? metaLine(props) : "";
  const topText = game || year;
  const enter = spring({ frame, fps, config: SPRING.ENTER });
  const open = spring({
    frame: frame - 3,
    fps,
    config: { damping: 15, stiffness: 85, mass: 0.9 },
  });
  const on = interpolate(frame, [13, 21], [0, 1], clamp);
  const TAP = 30;
  const pressed = interpolate(
    frame,
    [TAP - 1, TAP + 1, TAP + 5],
    [0, 1, 0],
    clamp,
  );
  const textIn = interpolate(frame, [18, 28], [0, 1], clamp);
  const S = 0.87;
  const push = interpolate(frame, [30, len], [1, 1.04], {
    ...clamp,
    easing: easeInOut,
  });
  const size = fit(heading, BOT.w - 92, 4, [62, 56, 50, 44, 40], 0.58);
  const bw = BOT.w - 56;
  const lines = Math.min(
    4,
    Math.max(1, linesNeeded(heading, BOT.w - 92, size, 0.58)),
  );
  const bh = Math.min(260, Math.round(size * 1.12 * lines) + 64);
  // The stylus taps the button's lower right corner, clear of the centred words.
  const tap = {
    x: BOT.x + BOT.w - 36,
    y: LID_H + HINGE_H + BOT.y + (kicker ? 60 : 0) + 30 + bh - 14,
  };
  const topScreen = pic ? (
    <Img
      src={pic}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `scale(${1.04 + 0.06 * (frame / len)})`,
      }}
    />
  ) : (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${way.accent === "#ffffff" ? "#b5323c" : way.accent}, #0e1420)`,
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 40,
      }}
    >
      {topText ? (
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: topText.length > 18 ? 76 : 104,
            lineHeight: 1,
            color: "#ffffff",
            textTransform: "uppercase",
            ...lineClamp(2),
          }}
        >
          {topText}
        </div>
      ) : (
        [0, 1, 2, 3].map((k) => (
          <div
            key={k}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 120 + k * 110,
              height: 120 + k * 110,
              marginLeft: -(60 + k * 55),
              marginTop: -(60 + k * 55),
              borderRadius: "50%",
              border: "4px solid rgba(255,255,255,0.22)",
              transform: `scale(${1 + 0.05 * Math.sin(frame * 0.08 - k)})`,
            }}
          />
        ))
      )}
      {game && year ? (
        <div
          style={{
            marginTop: 16,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 34,
            color: "rgba(255,255,255,0.85)",
            letterSpacing: 3,
          }}
        >
          {year}
        </div>
      ) : null}
    </AbsoluteFill>
  );
  const bottomScreen = (
    <TouchPanel way={way} label={kicker || undefined}>
      <div
        style={{
          position: "absolute",
          left: 28,
          top: (kicker ? 60 : 0) + 30,
          width: bw,
          height: bh,
          borderRadius: 22,
          background: "linear-gradient(180deg, #ffffff, #eef2f6)",
          border: "3px solid #c7d0db",
          boxShadow: `0 ${6 - 4 * pressed}px 0 #c7d0db, 0 14px 24px rgba(30,50,80,0.14)`,
          transform: `translateY(${4 * pressed}px) scale(${1 - 0.02 * pressed})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 22px",
          boxSizing: "border-box",
          textAlign: "center",
          opacity: textIn,
        }}
      >
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1.1,
            color: "#1d2735",
            ...lineClamp(4),
          }}
        >
          {heading}
        </div>
      </div>
      {meta ? (
        <div
          style={{
            position: "absolute",
            left: 28,
            right: 28,
            bottom: 22,
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 30,
            color: "#5b6779",
            opacity: interpolate(frame, [26, 36], [0, 1], clamp),
            ...lineClamp(1),
          }}
        >
          {meta}
        </div>
      ) : null}
    </TouchPanel>
  );
  return (
    <AbsoluteFill style={{ opacity: fade, overflow: "hidden" }}>
      <Room way={way} />
      <div
        style={{
          position: "absolute",
          left: 960 - DW / 2,
          top: (1080 - DEVICE_H) / 2,
          width: DW,
          height: DEVICE_H,
          transform: `translateY(${(1 - enter) * 120}px) scale(${S * push * (0.94 + 0.06 * enter)})`,
          transformOrigin: "50% 60%",
          opacity: Math.min(1, enter * 1.6),
        }}
      >
        <Device
          way={way}
          open={open}
          on={on}
          top={topScreen}
          bottom={bottomScreen}
        >
          <Stylus frame={frame} fps={fps} tx={tap.x} ty={tap.y} tapAt={TAP} />
        </Device>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// Styles: one side of a comparison on each screen.

type Side = { label: string; value: string };

const SidePanel: React.FC<{
  side: Side;
  dark: boolean;
  frame: number;
  way: Way;
}> = ({ side, dark, frame, way }) => {
  const fig = parseFigure(side.value);
  const p = interpolate(frame, [16, 40], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const shown = fig && !fig.year ? countText(fig, p) : side.value;
  const size = side.value.length > 10 ? 110 : side.value.length > 6 ? 140 : 170;
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "0 36px",
        background: dark
          ? `linear-gradient(160deg, #1b2433, #0c1018)`
          : undefined,
      }}
    >
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 34,
          letterSpacing: 3,
          color: dark
            ? way.accent === "#ffffff"
              ? "#ff8a8a"
              : way.accent
            : "#4c5a6e",
          textTransform: "uppercase",
          ...lineClamp(2),
        }}
      >
        {side.label}
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: DISPLAY,
          fontSize: size,
          lineHeight: 1,
          color: dark ? "#ffffff" : "#152031",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {shown}
      </div>
    </AbsoluteFill>
  );
};

const TitlePanel: React.FC<{
  title: string;
  dark: boolean;
  way: Way;
  src?: string;
}> = ({ title, dark, way, src }) => (
  <AbsoluteFill
    style={{
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      padding: "0 40px",
      background: dark ? "#0c1018" : undefined,
    }}
  >
    {dark && src ? (
      <>
        <Img
          src={src}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.35,
          }}
        />
        <AbsoluteFill
          style={{
            background: `linear-gradient(180deg, rgba(12,16,24,0.2), rgba(12,16,24,0.85))`,
          }}
        />
      </>
    ) : null}
    <div
      style={{
        position: "relative",
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: fit(title, dark ? 640 : 480, 3, [64, 56, 48, 42], 0.6),
        lineHeight: 1.08,
        color: dark ? "#ffffff" : "#152031",
        textShadow: dark ? "0 4px 18px rgba(0,0,0,0.6)" : undefined,
        ...lineClamp(3),
      }}
    >
      {title}
    </div>
    <div
      style={{
        position: "relative",
        marginTop: 18,
        width: 90,
        height: 6,
        borderRadius: 3,
        background: way.accent === "#ffffff" ? "#b5323c" : way.accent,
      }}
    />
  </AbsoluteFill>
);

const ScreensStyle: React.FC<{
  len: number;
  variant: number;
  heading: string;
  top: React.ReactNode;
  bottom: React.ReactNode;
  vs?: boolean;
}> = ({ len, variant, heading, top, bottom, vs }) => {
  const { frame, fps, dim, visible } = useStage(len, 200);
  if (!visible) return null;
  const way = wayOf(variant);
  const enter = spring({ frame, fps, config: SPRING.ENTER });
  const open = spring({
    frame: frame - 3,
    fps,
    config: { damping: 15, stiffness: 85, mass: 0.9 },
  });
  const on = interpolate(frame, [13, 21], [0, 1], clamp);
  const S = 0.78;
  const headIn = interpolate(frame, [6, 18], [0, 1], clamp);
  const badge = spring({ frame: frame - 22, fps, config: SPRING.POP });
  const tap = {
    x: BOT.x + BOT.w - 48,
    y: LID_H + HINGE_H + BOT.y + BOT.h - 44,
  };
  return (
    <AbsoluteFill style={{ opacity: dim, overflow: "hidden" }}>
      <Room way={way} at="66% 52%" />
      <div
        style={{
          position: "absolute",
          left: 96,
          width: 700,
          top: 130,
          height: 878,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          opacity: headIn,
          transform: `translateX(${(1 - headIn) * -40}px)`,
        }}
      >
        <div
          style={{
            width: 90,
            height: 8,
            borderRadius: 4,
            background: way.accent === "#ffffff" ? "#ef4a3c" : way.accent,
            marginBottom: 28,
          }}
        />
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: fit(heading, 680, 4, [84, 74, 64, 56], 0.6),
            lineHeight: 1.06,
            color: "#f5f7fa",
            ...lineClamp(4),
          }}
        >
          {heading}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 1270 - DW / 2,
          top: 130 + (878 - DEVICE_H) / 2,
          width: DW,
          height: DEVICE_H,
          transform: `translateY(${(1 - enter) * 120}px) scale(${S * (0.94 + 0.06 * enter)})`,
          opacity: Math.min(1, enter * 1.6),
        }}
      >
        <Device
          way={way}
          open={open}
          on={on}
          top={top}
          bottom={<TouchPanel way={way}>{bottom}</TouchPanel>}
          badge={
            vs ? (
              <div
                style={{
                  position: "absolute",
                  left: DW / 2 - 70,
                  top: LID_H + HINGE_H / 2 - 70,
                  width: 140,
                  height: 140,
                  borderRadius: 70,
                  background: way.accent === "#ffffff" ? "#ef4a3c" : way.accent,
                  border: "6px solid #ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: DISPLAY,
                  fontSize: 66,
                  color: way.accent === "#ffcf3a" ? "#1d2a48" : "#ffffff",
                  transform: `scale(${badge})`,
                  boxShadow: "0 14px 34px rgba(0,0,0,0.5)",
                  zIndex: 5,
                }}
              >
                VS
              </div>
            ) : null
          }
        >
          <Stylus frame={frame} fps={fps} tx={tap.x} ty={tap.y} tapAt={30} />
        </Device>
      </div>
    </AbsoluteFill>
  );
};

export function fitsDualCompare(g: MomentGraphic): boolean {
  const rows = splitPairs(g.items);
  return (
    rows.length === 2 &&
    g.items.filter((x) => x.trim()).length === 2 &&
    rows.every((r) => r.a.length <= 26 && r.b.length <= 14) &&
    clean(g.primary).length <= 48
  );
}

const DualCompare: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const frame = useStage(len, 200).frame;
  const rows = splitPairs(g.items);
  if (rows.length < 2) return null;
  const way = wayOf(variant);
  const [a, b] = [rows[0]!, rows[1]!];
  return (
    <ScreensStyle
      len={len}
      variant={variant}
      heading={clean(g.primary)}
      top={
        <SidePanel
          side={{ label: a.a, value: a.b }}
          dark
          frame={frame}
          way={way}
        />
      }
      bottom={
        <SidePanel
          side={{ label: b.a, value: b.b }}
          dark={false}
          frame={frame}
          way={way}
        />
      }
    />
  );
};

const versusTitles = (items: string[]) =>
  items.map((x) => clean(x.replace(/^\s*\*/, ""))).filter(Boolean);

export function fitsDualVersus(g: MomentGraphic): boolean {
  const t = versusTitles(g.items);
  return (
    t.length === 2 &&
    g.items.length === 2 &&
    t.every((x) => x.length <= 44 && longestWord(x) <= 16) &&
    clean(g.primary).length <= 48
  );
}

const DualVersus: React.FC<GfxProps> = ({ g, len, variant = 0, src }) => {
  const t = versusTitles(g.items);
  if (t.length < 2) return null;
  const way = wayOf(variant);
  return (
    <ScreensStyle
      len={len}
      variant={variant}
      heading={clean(g.primary)}
      vs
      top={<TitlePanel title={t[0]!} dark way={way} src={src} />}
      bottom={<TitlePanel title={t[1]!} dark={false} way={way} />}
    />
  );
};

export const DS_CARD = DualCard;
export const DS_STYLES: Record<string, GfxStyle> = {
  /** compare: primary a heading, items exactly two "label: value" rows; one row on each screen, figures counting. */
  DualScreen: {
    kind: "compare",
    component: DualCompare,
    fits: fitsDualCompare,
    sound: "glint",
  },
  /** versus: primary a heading, items exactly two titles (older first); one on each screen, VS on the hinge. */
  DualVersus: {
    kind: "versus",
    component: DualVersus,
    fits: fitsDualVersus,
    sound: "pop",
  },
};
