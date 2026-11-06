// Three redesign directions for the channel's profile picture and banner, so
// the owner can pick one by eye. Same mark, fonts and amber as the videos.
//   signal:    amber everywhere, black mark: the loudest thing in a feed
//   broadcast: a gaming newsroom, lower-third lockup and a ticker
//   arcade:    speed, slant and streaks: the most "gaming" of the three

import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { COLOUR } from "./brand.ts";
import { BODY, DISPLAY } from "./components/fonts.ts";

export type Concept = "signal" | "broadcast" | "arcade";
export type ConceptProps = { concept: Concept };

const AMBER = COLOUR.amber;
const INK = COLOUR.ink;
const PAPER = COLOUR.paper;
// YouTube shows only this centre box of a 2560x1440 banner on every device.
const SAFE = {
  left: (2560 - 1546) / 2,
  top: (1440 - 423) / 2,
  width: 1546,
  height: 423,
};
const SCHEDULE = "NEWS 8AM · 12PM · 5PM ET";
const SCHEDULE_UK = "1PM · 5PM · 10PM UK";

/** The Pulse mark as vector art (the broken ring and the heartbeat), in any colour, on a clear background. */
const Mark: React.FC<{
  size: number;
  black?: boolean;
  color?: string;
  style?: React.CSSProperties;
}> = ({ size, black, color, style }) => {
  const c = color ?? (black ? INK : AMBER);
  const cx = 520;
  const cy = 512;
  const r = 348;
  const arc = (from: number, to: number) => {
    const p = (deg: number) => [
      cx + r * Math.cos((deg * Math.PI) / 180),
      cy + r * Math.sin((deg * Math.PI) / 180),
    ];
    const [x1, y1] = p(from);
    const [x2, y2] = p(to);
    return `M${x1} ${y1} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  return (
    <svg
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      style={{ overflow: "visible", ...style }}
    >
      <g fill="none" stroke={c} strokeWidth={76}>
        <path d={arc(-164, -81)} />
        <path d={arc(-68, -9)} />
        <path d={arc(10, 82)} />
        <path
          d="M165 565 L342 565 L436 318 L506 790 L618 318 L680 562 L856 562"
          strokeLinejoin="miter"
          strokeMiterlimit={10}
        />
      </g>
    </svg>
  );
};

/** A heartbeat line drawn across a width: flat, a spike, flat. */
const PulseLine: React.FC<{
  width: number;
  height: number;
  color: string;
  stroke: number;
  style?: React.CSSProperties;
}> = ({ width, height, color, stroke, style }) => {
  const m = height / 2;
  const x = (f: number) => f * width;
  const d = `M0 ${m} L${x(0.42)} ${m} L${x(0.46)} ${m - height * 0.32} L${x(0.5)} ${m + height * 0.45} L${x(0.545)} ${m - height * 0.48} L${x(0.58)} ${m + height * 0.18} L${x(0.6)} ${m} L${width} ${m}`;
  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", overflow: "visible", ...style }}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
    </svg>
  );
};

// ------------------------------------------------------------------ avatars (800x800, shown as a circle)

export const ConceptAvatar: React.FC<ConceptProps> = ({ concept }) => {
  if (concept === "signal")
    return (
      <AbsoluteFill
        style={{
          background: AMBER,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Mark size={640} black />
      </AbsoluteFill>
    );
  if (concept === "broadcast")
    return (
      <AbsoluteFill
        style={{
          background: INK,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 36,
            borderRadius: "50%",
            border: `34px solid ${AMBER}`,
          }}
        />
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 520,
            lineHeight: 1,
            color: PAPER,
            marginTop: 30,
          }}
        >
          P
        </div>
        <PulseLine
          width={800}
          height={260}
          color={AMBER}
          stroke={44}
          style={{ left: 0, top: 290 }}
        />
      </AbsoluteFill>
    );
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, #FF8A1F 0%, ${AMBER} 45%, #E8361A 100%)`,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: -200,
            top: 120 + i * 170,
            width: 1200,
            height: 34,
            background: "rgba(11,11,14,0.18)",
            transform: "rotate(-24deg)",
          }}
        />
      ))}
      <Mark
        size={600}
        black
        style={{
          transform: "skewX(-10deg)",
          filter:
            "brightness(0) drop-shadow(18px 18px 0 rgba(255,255,255,0.35))",
        }}
      />
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ banners (2560x1440)

const Box: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      position: "absolute",
      ...SAFE,
      display: "flex",
      alignItems: "center",
      ...style,
    }}
  >
    {children}
  </div>
);

export const ConceptBanner: React.FC<ConceptProps> = ({ concept }) => {
  if (concept === "signal")
    return (
      <AbsoluteFill style={{ background: INK, overflow: "hidden" }}>
        {/* The amber slab runs off the left of every screen; the black side carries the promise. */}
        <div
          style={{
            position: "absolute",
            left: -1000,
            top: -300,
            width: 2250,
            height: 2100,
            background: AMBER,
            transform: "rotate(16deg)",
          }}
        />
        <PulseLine
          width={2560}
          height={260}
          color={PAPER}
          stroke={12}
          style={{ left: 0, top: SAFE.top + SAFE.height + 10, opacity: 0.5 }}
        />
        <Box style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
            <Mark size={230} black />
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: 168,
                lineHeight: 0.92,
                color: INK,
              }}
            >
              PULSE
              <br />
              GAMING
            </div>
          </div>
          <div style={{ textAlign: "right", color: PAPER, fontFamily: BODY }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 92, lineHeight: 1 }}>
              GAMING NEWS,
            </div>
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: 92,
                lineHeight: 1.05,
                color: AMBER,
              }}
            >
              CHECKED.
            </div>
            <div
              style={{
                marginTop: 22,
                fontWeight: 900,
                fontSize: 30,
                letterSpacing: 3,
              }}
            >
              {SCHEDULE}
            </div>
            <div
              style={{
                marginTop: 6,
                fontWeight: 800,
                fontSize: 26,
                letterSpacing: 3,
                color: "#c9c9cf",
              }}
            >
              RANKINGS EVERY SUNDAY · PULSEGMG.COM
            </div>
          </div>
        </Box>
      </AbsoluteFill>
    );
  if (concept === "broadcast")
    return (
      <AbsoluteFill
        style={{
          background: `radial-gradient(80% 60% at 50% 45%, #1b1b22 0%, ${INK} 70%)`,
          overflow: "hidden",
        }}
      >
        <Box
          style={{
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            gap: 18,
            paddingLeft: 40,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                background: "#FF3B3B",
                color: PAPER,
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 30,
                letterSpacing: 4,
                padding: "8px 16px",
                borderRadius: 6,
              }}
            >
              ● DAILY
            </div>
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 30,
                letterSpacing: 4,
                color: COLOUR.muted,
              }}
            >
              {SCHEDULE} · {SCHEDULE_UK}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "stretch" }}>
            <div
              style={{
                background: PAPER,
                color: INK,
                fontFamily: DISPLAY,
                fontSize: 150,
                lineHeight: 1,
                padding: "8px 30px 4px",
              }}
            >
              PULSE
            </div>
            <div
              style={{
                background: AMBER,
                color: INK,
                fontFamily: DISPLAY,
                fontSize: 150,
                lineHeight: 1,
                padding: "8px 30px 4px",
              }}
            >
              GAMING
            </div>
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 40,
              color: PAPER,
              letterSpacing: 1,
            }}
          >
            Checked against the sources. Rankings every Saturday.
          </div>
        </Box>
        {/* The ticker runs the full width under the safe box. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: SAFE.top + SAFE.height + 30,
            height: 74,
            background: AMBER,
            display: "flex",
            alignItems: "center",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 52,
              color: INK,
              letterSpacing: 2,
              paddingLeft: 40,
            }}
          >
            {
              "GTA 6 ◆ CALL OF DUTY ◆ NINTENDO ◆ PLAYSTATION ◆ XBOX ◆ STEAM ◆ RELEASE DATES ◆ PRICES ◆ LEAKS ◆ RANKINGS ◆ GTA 6 ◆ CALL OF DUTY ◆ NINTENDO ◆ PLAYSTATION ◆ XBOX ◆ STEAM"
            }
          </div>
        </div>
        <Mark
          size={300}
          style={{
            position: "absolute",
            left: SAFE.left + SAFE.width - 340,
            top: SAFE.top + 60,
          }}
        />
      </AbsoluteFill>
    );
  return (
    <AbsoluteFill style={{ background: "#09090c", overflow: "hidden" }}>
      {Array.from({ length: 14 }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: -300 + ((i * 197) % 2600),
            top: 300 + ((i * 131) % 900),
            width: 700 + ((i * 89) % 600),
            height: 10 + (i % 3) * 8,
            background:
              i % 4 === 0 ? AMBER : `rgba(255,107,26,${0.15 + (i % 3) * 0.1})`,
            transform: "rotate(-14deg)",
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          background:
            "radial-gradient(36% 26% at 50% 50%, rgba(9,9,12,0.97) 0%, rgba(9,9,12,0.9) 60%, transparent 100%), radial-gradient(60% 50% at 50% 50%, rgba(255,107,26,0.22) 0%, transparent 70%)",
        }}
      />
      <Box style={{ justifyContent: "center", gap: 50 }}>
        <Mark
          size={300}
          style={{
            transform: "skewX(-10deg)",
          }}
        />
        <div style={{ transform: "skewX(-10deg)" }}>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 230,
              lineHeight: 0.85,
              color: PAPER,
              textShadow: `12px 12px 0 ${AMBER}`,
            }}
          >
            PULSE
          </div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 104,
              lineHeight: 1,
              color: AMBER,
              letterSpacing: 18,
              marginTop: 6,
            }}
          >
            GAMING
          </div>
          <div
            style={{
              marginTop: 14,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 30,
              letterSpacing: 4,
              color: PAPER,
            }}
          >
            NEWS DAILY · RANKINGS SUNDAY · PULSEGMG.COM
          </div>
        </div>
      </Box>
    </AbsoluteFill>
  );
};

/**
 * The Broadcast cover at any size (Facebook cover 1640x624, X header
 * 1500x500): the lockup, the schedule and the topic ticker, kept inside the
 * centre where every platform's crop and profile picture leave it alone.
 */
export const BroadcastCover: React.FC<{ width: number; height: number; contentWidth: number; offsetX?: number }> = ({ width, height, contentWidth, offsetX = 0 }) => {
  const k = contentWidth / 1546; // the YouTube safe box is the reference layout
  return (
    <AbsoluteFill style={{ background: `radial-gradient(80% 70% at 50% 45%, #1b1b22 0%, ${INK} 75%)`, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: (width - contentWidth) / 2 + offsetX, top: height * 0.16, width: contentWidth, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 * k }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 * k }}>
            <div style={{ background: "#FF3B3B", color: PAPER, fontFamily: BODY, fontWeight: 900, fontSize: 30 * k, letterSpacing: 4 * k, padding: `${8 * k}px ${16 * k}px`, borderRadius: 6 * k }}>● DAILY</div>
            <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 30 * k, letterSpacing: 4 * k, color: COLOUR.muted }}>{SCHEDULE} · {SCHEDULE_UK}</div>
          </div>
          <div style={{ display: "flex" }}>
            <div style={{ background: PAPER, color: INK, fontFamily: DISPLAY, fontSize: 150 * k, lineHeight: 1, padding: `${8 * k}px ${30 * k}px ${4 * k}px` }}>PULSE</div>
            <div style={{ background: AMBER, color: INK, fontFamily: DISPLAY, fontSize: 150 * k, lineHeight: 1, padding: `${8 * k}px ${30 * k}px ${4 * k}px` }}>GAMING</div>
          </div>
          <div style={{ fontFamily: BODY, fontWeight: 900, fontSize: 40 * k, color: PAPER }}>Checked against the sources. Rankings every Saturday.</div>
        </div>
        <Mark size={290 * k} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: height * 0.1, height: 74 * k, background: AMBER, display: "flex", alignItems: "center", overflow: "hidden", whiteSpace: "nowrap" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 52 * k, color: INK, letterSpacing: 2 * k, paddingLeft: 40 * k }}>
          {"GTA 6 ◆ CALL OF DUTY ◆ NINTENDO ◆ PLAYSTATION ◆ XBOX ◆ STEAM ◆ RELEASE DATES ◆ PRICES ◆ LEAKS ◆ RANKINGS ◆ PULSEGMG.COM ◆ GTA 6 ◆ CALL OF DUTY ◆ NINTENDO"}
        </div>
      </div>
    </AbsoluteFill>
  );
};
