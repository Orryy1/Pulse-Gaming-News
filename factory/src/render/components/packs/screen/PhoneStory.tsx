// Screen pack, "PhoneStory" (owner, 30 Oct 2026): a press story the way a viewer meets one now. A generic
// smartphone (no brand) wakes, the story drops in as a notification, a finger taps it, the phone's browser
// opens on the article and the page scrolls to the passage, which is highlighted line by line as the narrator
// reads it. Only for stories from 2012 on (the era rule in ../index.ts): an older story gets a period browser
// or a newspaper. Every word on screen comes from the graphic; the outlet is shown as text, never as a logo or
// a real web address. Tagged ILLUSTRATION.
import React from "react";
import { Img, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import {
  clamp,
  easeInOut,
  easeOut,
  sizeByLength,
  txt,
  wordCount,
} from "./common.ts";
import {
  PulseMark,
  phoneLook,
  storyYear,
  type PhoneGen,
  type PhoneSkin,
} from "./pulse.tsx";

const W = 540;
const H = 1060;

/** What the story card says: the headline, the passage read out (if any), the outlet line and the highlight. */
export function storyParts(g: MomentGraphic): {
  headline: string;
  passage: string;
  credit: string;
  highlight: string;
} {
  if (g.kind === "headline")
    return {
      headline: txt(g.primary),
      passage: "",
      credit: txt(g.secondary),
      highlight: "",
    };
  if (g.kind === "quote")
    return {
      headline: "",
      passage: txt(g.primary),
      credit: txt(g.secondary),
      highlight: txt(g.primary),
    };
  // source: a passage word for word, items[0] the phrase to highlight inside it.
  return {
    headline: "",
    passage: txt(g.primary),
    credit: txt(g.secondary),
    highlight: txt(g.items[0]),
  };
}

const ROLE =
  /\b(leader|director|producer|president|writer|designer|founder|co-founder|executive|programmer|artist|composer|critic|journalist|editor|reviewer|head|chief|manager|lead|ceo|developer|actor|host)\b/i;

/**
 * The outlet as a masthead. A headline's credit is "Outlet, year"; a quote's or passage's is "Name, role" or
 * "Name, outlet, year", so there the outlet is a part that is neither the speaker, a role nor a year (30 Oct
 * 2026 test: "Chris Carter, Destructoid, 2013" showed CHRIS CARTER as the site). NEWS when none is given.
 */
export function outletOf(credit: string, kind = "headline"): string {
  const parts = credit
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const ok = (o: string | undefined) =>
    !!o && !/^(19|20)\d\d$/.test(o) && o.length <= 28 && !ROLE.test(o);
  // A headline's or a source's credit leads with the outlet.
  if (kind !== "quote") return ok(parts[0]) ? parts[0]! : "NEWS";
  const o = parts.slice(1).find(ok);
  return o ?? "NEWS";
}

const Lines: React.FC<{ n: number; width: number; opacity?: number }> = ({
  n,
  width,
  opacity = 1,
}) => (
  <div style={{ opacity }}>
    {Array.from({ length: n }, (_, i) => (
      <div
        key={i}
        style={{
          height: 13,
          width:
            i === n - 1 ? width * 0.55 : width * (0.86 + ((i * 37) % 13) / 100),
          background: "#d9d9de",
          borderRadius: 7,
          marginBottom: 13,
        }}
      />
    ))}
  </div>
);

/** Handset geometry by generation: bezels, corner radii and the status bar's height on screen. */
const BODIES: Record<
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

/** Signal bars, the network and a battery; the clock where the skin puts it. */
const StatusBar: React.FC<{
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

/** The Pulse News app's banner on the lock screen, in the skin and generation's style. */
const Banner: React.FC<{
  gen: PhoneGen;
  skin: PhoneSkin;
  outlet: string;
  text: string;
}> = ({ gen, skin, outlet, text }) => {
  const dark = skin === "orbit" && gen === "classic";
  const droid = skin === "droid";
  return (
    <div
      style={{
        background: dark
          ? "linear-gradient(rgba(70,72,82,0.94),rgba(24,24,30,0.94))"
          : droid
            ? "#fafafa"
            : "rgba(245,245,250,0.92)",
        borderRadius: droid ? (gen === "edge" ? 28 : 8) : dark ? 14 : 30,
        padding: "20px 22px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        color: dark ? "#fff" : "#111",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: dark ? "#ddd" : "#555",
          fontSize: droid ? 19 : 20,
          fontWeight: 600,
        }}
      >
        {droid ? (
          <PulseMark size={26} />
        ) : (
          <PulseMark
            size={34}
            tile={COLOUR.amber}
            colour={COLOUR.ink}
            radius={dark ? 18 : 24}
          />
        )}
        <span
          style={{
            letterSpacing: droid ? 0 : 1,
            textTransform: droid ? "none" : "uppercase",
          }}
        >
          {droid ? `Pulse News - ${outlet}` : "Pulse News"}
        </span>
        <span style={{ marginLeft: "auto", fontWeight: 400 }}>now</span>
      </div>
      {!droid && (
        <div
          style={{
            marginTop: 10,
            fontSize: 22,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: dark ? "#fff" : "#222",
          }}
        >
          {outlet}
        </div>
      )}
      <div
        style={{
          marginTop: droid ? 12 : 4,
          fontSize: 27,
          fontWeight: droid ? 700 : 600,
          lineHeight: 1.22,
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const PhoneStory: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
  src,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 300);
  const { headline, passage, credit, highlight } = storyParts(g);
  if (!visible || (!headline && !passage)) return null;
  const outlet = outletOf(credit, g.kind);
  const { gen, skin, network } = phoneLook(storyYear(g, year), variant);
  const body = BODIES[gen];
  const SW = W - body.side * 2;
  const SH = H - body.top - body.bottom;
  const droid = skin === "droid";
  const alert =
    headline ||
    passage.split(/\s+/).slice(0, 12).join(" ") +
      (wordCount(passage) > 12 ? "..." : "");

  // The beats: rise 0-18, notification 18-34, tap 40-50, browser opens 50-66, scroll and read 66-end.
  const rise = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.9 },
  });
  const drop = spring({
    frame: frame - 18,
    fps,
    config: { damping: 15, stiffness: 190, mass: 0.7 },
  });
  const tapT = frame - 40;
  const tap = tapT >= 0 && tapT < 14 ? tapT / 14 : tapT >= 14 ? 1 : 0;
  const open = interpolate(frame, [50, 66], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const zoom = interpolate(frame, [58, 80], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const readFrom = 72;
  const readTo = Math.max(readFrom + 30, showFor - 24);
  const read = interpolate(frame, [readFrom, readTo], [0, 1], clamp);
  // The page scrolls the passage up into the middle of the screen while it is read.
  const scroll = interpolate(
    frame,
    [66, readFrom + 18, readTo],
    [0, passage ? 210 : 0, passage ? 330 : 0],
    {
      ...clamp,
      easing: easeOut,
    },
  );

  const headSize = sizeByLength((headline || outlet).length, [
    [50, 40],
    [80, 35],
    [999, 31],
  ]);
  const passSize = sizeByLength(passage.length, [
    [140, 32],
    [260, 28],
    [999, 25],
  ]);
  // The highlighted span inside the passage: the key phrase, else the whole passage; revealed with the read.
  const words = passage.split(/\s+/).filter(Boolean);
  const hl = highlight
    ? passage.toLowerCase().indexOf(highlight.toLowerCase())
    : -1;
  const hlStart =
    hl >= 0 ? passage.slice(0, hl).split(/\s+/).filter(Boolean).length : 0;
  const hlLen =
    hl >= 0 ? highlight.split(/\s+/).filter(Boolean).length : words.length;
  const lit = Math.floor(read * (hlLen + 1));

  const notifTop = body.status + (droid ? 236 : 250);
  // The browser's bars: a glossy title and address bar on a classic phone, one address pill after.
  const classicBar = gen === "classic" && !droid;
  const header = body.status + (classicBar ? 96 : 66);
  const navBar = droid && gen !== "edge" ? 56 : 0;
  const footer = classicBar ? 54 : navBar;
  // The push-in (x1.42 about the phone's middle) brings the passage, or the headline, to about 380 px down the
  // frame: they sit about 232 and 123 px into the scrolled page, below the bezel and the browser's bars.
  const lift = -113 - (body.top + header + (passage ? 232 : 123) - H / 2);

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={14}>
      <div
        style={{
          position: "absolute",
          left: 960 - W / 2,
          top: 540 - H / 2 + (1 - rise) * 420,
          width: W,
          height: H,
          borderRadius: body.radius,
          background:
            gen === "classic"
              ? "linear-gradient(90deg,#1a1a1e,#2c2c32 50%,#1a1a1e)"
              : "#0d0d10",
          boxShadow: `0 40px 120px rgba(0,0,0,0.65), inset 0 0 0 ${gen === "classic" ? 6 : 3}px ${gen === "classic" ? "#8a8d94" : "#2a2a30"}`,
          // Once the article is open the camera pushes in on the screen so the words can be read.
          transform: `rotate(${(variant % 2 ? 1 : -1) * 2.2 * (1 - open)}deg) scale(${1 + 0.42 * zoom}) translateY(${lift * zoom}px)`,
        }}
      >
        {/* The handset's front: earpiece and camera above the screen; the Pulse mark or a home button below. */}
        {gen !== "edge" && (
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
            {droid ? (
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
                <PulseMark
                  size={gen === "classic" ? 34 : 28}
                  colour="#55565e"
                />
              </div>
            )}
          </>
        )}
        <div
          style={{
            position: "absolute",
            left: body.side,
            top: body.top,
            width: SW,
            height: SH,
            borderRadius: body.screen,
            overflow: "hidden",
            background: "#121318",
            fontFamily: BODY,
          }}
        >
          {/* Lock screen: Pulse OS's wallpaper, the time, then the notification. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 1 - open,
              background:
                gen === "classic"
                  ? "linear-gradient(170deg,#24365e,#0b0f1c 75%)"
                  : droid
                    ? "linear-gradient(160deg,#16303a,#0c1216 70%)"
                    : "linear-gradient(160deg,#2b2440,#101018 70%)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: SW / 2 - 230,
                top: SH - 520,
                opacity: 0.13,
              }}
            >
              <PulseMark size={460} colour={COLOUR.amber} />
            </div>
            <StatusBar
              gen={gen}
              skin={skin}
              network={network}
              height={body.status}
              ink="#fff"
            />
            <div
              style={{
                position: "absolute",
                left: droid ? 40 : 0,
                right: droid ? undefined : 0,
                top: body.status + (droid ? 50 : 40),
                textAlign: droid ? "left" : "center",
                color: "#fff",
                fontSize: gen === "classic" ? 96 : 108,
                fontWeight: gen === "classic" ? 200 : droid ? 400 : 300,
                letterSpacing: -2,
                lineHeight: 1,
              }}
            >
              9:41
              {droid && (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 22,
                    fontWeight: 500,
                    letterSpacing: 1,
                    opacity: 0.8,
                  }}
                >
                  Pulse OS
                </div>
              )}
            </div>
            <div
              style={{
                position: "absolute",
                left: 16,
                right: 16,
                top: notifTop + (1 - drop) * -260,
                opacity: interpolate(drop, [0, 0.4], [0, 1], clamp),
                transform: `scale(${1 - 0.04 * Math.sin(Math.PI * tap)})`,
              }}
            >
              <Banner gen={gen} skin={skin} outlet={outlet} text={alert} />
            </div>
            {/* The finger's tap: a soft ring that grows and fades on the notification. */}
            {tapT >= 0 && tapT < 18 && (
              <div
                style={{
                  position: "absolute",
                  left: SW / 2 - 50 - 60 * tap,
                  top: notifTop + 80 - 50 - 60 * tap,
                  width: 100 + 120 * tap,
                  height: 100 + 120 * tap,
                  borderRadius: "50%",
                  background: `rgba(255,255,255,${0.45 * (1 - tap)})`,
                  border: "3px solid rgba(255,255,255,0.7)",
                  opacity: 1 - tap,
                }}
              />
            )}
          </div>
          {/* The Pulse Browser opens from the notification and the article scrolls. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#fff",
              opacity: open,
              transform: `scale(${0.82 + 0.18 * open}) translateY(${(1 - open) * -120}px)`,
              borderRadius: body.screen * (1 - open),
            }}
          >
            <div
              style={{
                position: "relative",
                height: header,
                boxSizing: "border-box",
                background: classicBar
                  ? "linear-gradient(#dfe4ec,#a7b3c5)"
                  : droid
                    ? "#fff"
                    : "#f2f2f5",
                borderBottom: classicBar
                  ? "1px solid #6f7d92"
                  : "1px solid #ddd",
                paddingTop: body.status + 8,
              }}
            >
              <StatusBar
                gen={gen}
                skin={skin}
                network={network}
                height={body.status}
                ink={classicBar ? "#222" : "#111"}
              />
              {classicBar && (
                <div
                  style={{
                    textAlign: "center",
                    color: "#2a3342",
                    fontSize: 19,
                    fontWeight: 700,
                    textShadow: "0 1px 0 #fff",
                    marginBottom: 8,
                  }}
                >
                  {outlet}
                </div>
              )}
              <div
                style={{
                  margin: "0 22px",
                  height: 44,
                  borderRadius: classicBar ? 8 : droid ? 22 : 14,
                  background: classicBar
                    ? "#fff"
                    : droid
                      ? "#eef0f3"
                      : "#e3e3e8",
                  border: classicBar ? "1px solid #7b889c" : "none",
                  color: "#555",
                  fontSize: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: droid ? "flex-start" : "center",
                  gap: 10,
                  padding: "0 16px",
                }}
              >
                <PulseMark size={22} />
                {droid
                  ? `news / ${outlet.toLowerCase().replace(/\s+/g, "-")}`
                  : outlet.toLowerCase()}
                {droid && (
                  <svg
                    width={8}
                    height={26}
                    viewBox="0 0 8 26"
                    style={{ marginLeft: "auto" }}
                  >
                    {[4, 13, 22].map((cy) => (
                      <circle key={cy} cx={4} cy={cy} r={3} fill="#666" />
                    ))}
                  </svg>
                )}
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                top: header,
                left: 0,
                right: 0,
                bottom: footer,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "30px 34px",
                  transform: `translateY(${-scroll}px)`,
                }}
              >
                <div
                  style={{
                    color: COLOUR.amber,
                    fontSize: 19,
                    fontWeight: 800,
                    letterSpacing: 2,
                    textTransform: "uppercase",
                  }}
                >
                  {outlet}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    color: "#111",
                    fontSize: headSize,
                    fontWeight: 800,
                    lineHeight: 1.12,
                  }}
                >
                  {headline || (credit ? credit.split(",")[0] : outlet)}
                </div>
                {credit && (
                  <div style={{ marginTop: 14, color: "#777", fontSize: 20 }}>
                    {credit}
                  </div>
                )}
                {/* The article's hero picture: the sentence's game. */}
                <div
                  style={{
                    height: 230,
                    marginTop: 24,
                    borderRadius: gen === "classic" ? 4 : 16,
                    overflow: "hidden",
                    background: "linear-gradient(135deg,#d7d7de,#ececf1)",
                  }}
                >
                  {src && (
                    <Img
                      src={src}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  )}
                </div>
                <div style={{ marginTop: 28 }}>
                  <Lines n={passage ? 3 : 4} width={SW - 68} />
                </div>
                {passage && (
                  <div
                    style={{
                      marginTop: 10,
                      color: "#1a1a1a",
                      fontSize: passSize,
                      lineHeight: 1.45,
                      fontWeight: 500,
                    }}
                  >
                    {words.map((w, i) => {
                      const inSpan = i >= hlStart && i < hlStart + hlLen;
                      const on = inSpan && i - hlStart < lit;
                      return (
                        <span
                          key={i}
                          style={{
                            background: on
                              ? "rgba(255,190,60,0.55)"
                              : "transparent",
                            boxShadow: on
                              ? "0 0 0 3px rgba(255,190,60,0.55)"
                              : "none",
                            borderRadius: 4,
                          }}
                        >
                          {w}{" "}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div style={{ marginTop: 26 }}>
                  <Lines n={6} width={SW - 68} />
                </div>
              </div>
            </div>
            {/* The bottom: back and forward on a classic browser, or the phone's own navigation keys. */}
            {footer > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: footer,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-around",
                  background: classicBar
                    ? "linear-gradient(#c3ccd8,#8e9bb0)"
                    : "#000",
                  borderTop: classicBar ? "1px solid #6f7d92" : "none",
                }}
              >
                {(classicBar
                  ? [
                      "M15 5 L8 12 L15 19",
                      "M9 5 L16 12 L9 19",
                      "M5 12 H19 M12 5 V19",
                      "M4 6 H20 V19 H4 Z",
                    ]
                  : [
                      "M16 5 L7 12 L16 19 Z",
                      "M12 5 A7 7 0 1 1 11.9 5 Z",
                      "M6 6 H18 V18 H6 Z",
                    ]
                ).map((d, i) => (
                  <svg key={i} width={34} height={34} viewBox="0 0 24 24">
                    <path
                      d={d}
                      fill="none"
                      stroke={classicBar ? "#2a3342" : "#ddd"}
                      strokeWidth={2.4}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </svg>
                ))}
              </div>
            )}
          </div>
          {/* Edge-to-edge phones: the punch-hole camera, and a gesture bar instead of keys. */}
          {gen === "edge" && (
            <>
              <div
                style={{
                  position: "absolute",
                  left: SW / 2 - 13,
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
                  left: SW / 2 - 70,
                  bottom: 10,
                  width: 140,
                  height: 6,
                  borderRadius: 3,
                  background: open > 0.5 ? "#222" : "#fff",
                  opacity: 0.8,
                  zIndex: 6,
                }}
              />
            </>
          )}
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
/** A headline of 3-14 words, or a quote or passage short enough to read on a phone screen. */
export const fitsPhoneStory = (g: MomentGraphic) => {
  const { headline, passage, credit } = storyParts(g);
  if (credit.length > 48) return false;
  if (g.kind === "headline")
    return wordCount(headline) >= 3 && wordCount(headline) <= 14;
  return wordCount(passage) >= 6 && wordCount(passage) <= 60;
};
