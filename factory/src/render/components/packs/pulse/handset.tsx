// The Pulse OS handset (owner, 30 Oct 2026): one reusable phone for every Pulse app a graphic opens (Calendar,
// Maps and whatever comes next). It is the handset PhoneStory (../screen/PhoneStory.tsx) draws, copied line for
// line: the body by generation (classic 2012-14 with a home button and thick bezels, slim 2015-19, edge 2020+
// with a punch-hole camera and a gesture bar), the earpiece, front camera and either a home button carrying the
// Pulse mark (the "orbit" skin) or the PULSE wordmark (the "droid" skin), the status bar and the screen. The
// app's contents are passed in as children; a function child is told the screen's size. Pick the look with
// phoneLook (../screen/pulse.tsx). No real handset, logo or product name.
import React from "react";
import { BODY } from "../../fonts.ts";
import { PulseMark, type PhoneGen, type PhoneSkin } from "../screen/pulse.tsx";

/** The handset's size on the 1920x1080 frame, before any camera push-in. */
export const HANDSET_W = 540;
export const HANDSET_H = 1060;

/** Handset geometry by generation: bezels, corner radii and the status bar's height on screen. */
export const BODIES: Record<
  PhoneGen,
  {
    side: number;
    top: number;
    bottom: number;
    radius: number;
    screen: number;
    status: number;
  }
> = {
  classic: {
    side: 26,
    top: 126,
    bottom: 126,
    radius: 80,
    screen: 4,
    status: 34,
  },
  slim: { side: 18, top: 90, bottom: 90, radius: 70, screen: 8, status: 40 },
  edge: { side: 14, top: 14, bottom: 14, radius: 74, screen: 60, status: 58 },
};

/** The screen of a generation's handset: its size, corner radius and status bar height. */
export type ScreenBox = {
  w: number;
  h: number;
  /** Where the screen sits inside the handset (from its top left). */
  left: number;
  top: number;
  radius: number;
  status: number;
  gen: PhoneGen;
  skin: PhoneSkin;
};

export function screenOf(gen: PhoneGen, skin: PhoneSkin = "orbit"): ScreenBox {
  const b = BODIES[gen];
  return {
    w: HANDSET_W - b.side * 2,
    h: HANDSET_H - b.top - b.bottom,
    left: b.side,
    top: b.top,
    radius: b.screen,
    status: b.status,
    gen,
    skin,
  };
}

/** Signal bars, the network and a battery; the clock where the skin puts it. */
export const StatusBar: React.FC<{
  gen: PhoneGen;
  skin: PhoneSkin;
  network: string;
  height: number;
  ink: string;
}> = ({ gen, skin, network, height, ink }) => {
  const clockMid = skin === "orbit" && gen === "classic";
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height,
        display: "flex",
        alignItems: gen === "edge" ? "flex-end" : "center",
        padding: gen === "edge" ? "0 34px 6px" : "0 14px",
        color: ink,
        fontSize: gen === "classic" ? 19 : 21,
        fontWeight: 600,
        zIndex: 5,
      }}
    >
      <span>{clockMid ? `PULSE ${network}` : "9:41"}</span>
      {clockMid && (
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
          }}
        >
          9:41
        </span>
      )}
      <span
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {!clockMid && <span style={{ fontSize: 17 }}>{network}</span>}
        <svg width={30} height={18} viewBox="0 0 30 18">
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={i * 8}
              y={13 - i * 4}
              width={5}
              height={5 + i * 4}
              rx={1}
              fill={ink}
            />
          ))}
        </svg>
        <svg width={38} height={18} viewBox="0 0 38 18">
          <rect
            x={1}
            y={1}
            width={32}
            height={16}
            rx={4}
            fill="none"
            stroke={ink}
            strokeWidth={2}
          />
          <rect x={4} y={4} width={22} height={10} rx={2} fill={ink} />
          <rect x={34} y={6} width={3} height={6} rx={1} fill={ink} />
        </svg>
      </span>
    </div>
  );
};

/** The front of the handset round the screen: earpiece and camera above it; the Pulse mark or a home button below. */
const Front: React.FC<{ gen: PhoneGen; skin: PhoneSkin }> = ({ gen, skin }) => {
  if (gen === "edge") return null;
  const body = BODIES[gen];
  const W = HANDSET_W;
  const H = HANDSET_H;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: W / 2 - 50,
          top: body.top / 2 - 5,
          width: 100,
          height: 10,
          borderRadius: 5,
          background: "#3a3a40",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: W / 2 - 100,
          top: body.top / 2 - 8,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#1d2533",
          boxShadow: "inset 0 0 0 3px #30343c",
        }}
      />
      {skin === "droid" ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: H - body.bottom / 2 - 14,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
            color: "#9a9ca4",
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 6,
            fontFamily: BODY,
          }}
        >
          <PulseMark size={26} colour="#9a9ca4" />
          PULSE
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            left: W / 2 - (gen === "classic" ? 38 : 30),
            top: H - body.bottom / 2 - (gen === "classic" ? 38 : 30),
            width: gen === "classic" ? 76 : 60,
            height: gen === "classic" ? 76 : 60,
            borderRadius: "50%",
            background: "#141418",
            boxShadow: "inset 0 0 0 3px #3e3e46",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PulseMark size={gen === "classic" ? 34 : 28} colour="#55565e" />
        </div>
      )}
    </>
  );
};

/**
 * A Pulse OS handset with an app's screen inside. Place and move it with `style` (position, transform), as
 * PhoneStory does with its rise, tilt and camera push-in.
 */
export const Handset: React.FC<{
  gen: PhoneGen;
  skin: PhoneSkin;
  /** "3G", "4G" or "5G", as phoneLook gives it. */
  network: string;
  /** The status bar's ink over the app; null leaves the status bar to the app (PhoneStory's browser draws its own). */
  statusInk?: string | null;
  /** The screen's background behind the app. */
  screenBg?: string;
  /** The gesture bar's colour on an edge phone: white over dark apps, dark over light ones. */
  barInk?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode | ((screen: ScreenBox) => React.ReactNode);
}> = ({
  gen,
  skin,
  network,
  statusInk = "#fff",
  screenBg = "#121318",
  barInk = "#fff",
  style,
  children,
}) => {
  const body = BODIES[gen];
  const screen = screenOf(gen, skin);
  return (
    <div
      style={{
        position: "relative",
        width: HANDSET_W,
        height: HANDSET_H,
        borderRadius: body.radius,
        background:
          gen === "classic"
            ? "linear-gradient(90deg,#1a1a1e,#2c2c32 50%,#1a1a1e)"
            : "#0d0d10",
        boxShadow: `0 40px 120px rgba(0,0,0,0.65), inset 0 0 0 ${gen === "classic" ? 6 : 3}px ${gen === "classic" ? "#8a8d94" : "#2a2a30"}`,
        ...style,
      }}
    >
      <Front gen={gen} skin={skin} />
      <div
        style={{
          position: "absolute",
          left: screen.left,
          top: screen.top,
          width: screen.w,
          height: screen.h,
          borderRadius: screen.radius,
          overflow: "hidden",
          background: screenBg,
          fontFamily: BODY,
        }}
      >
        {typeof children === "function" ? children(screen) : children}
        {statusInk && (
          <StatusBar
            gen={gen}
            skin={skin}
            network={network}
            height={screen.status}
            ink={statusInk}
          />
        )}
        {/* Edge-to-edge phones: the punch-hole camera, and a gesture bar instead of keys. */}
        {gen === "edge" && (
          <>
            <div
              style={{
                position: "absolute",
                left: screen.w / 2 - 13,
                top: 18,
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "#050507",
                zIndex: 6,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: screen.w / 2 - 70,
                bottom: 10,
                width: 140,
                height: 6,
                borderRadius: 3,
                background: barInk,
                opacity: 0.8,
                zIndex: 6,
              }}
            />
          </>
        )}
      </div>
    </div>
  );
};

/** The ILLUSTRATION tag every Pulse device carries, bottom right, as PhoneStory places it. */
export const IllustrationMark: React.FC<{
  opacity: number;
  bottom?: number;
}> = ({ opacity, bottom = 48 }) => (
  <div
    style={{
      position: "absolute",
      right: 60,
      bottom,
      color: "rgba(255,255,255,0.7)",
      fontFamily: BODY,
      fontSize: 20,
      letterSpacing: 3,
      opacity,
    }}
  >
    ILLUSTRATION
  </div>
);
