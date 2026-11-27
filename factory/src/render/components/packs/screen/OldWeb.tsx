// Screen pack, "OldWeb" (owner, 30 Oct 2026: old stories came up on modern smartphones): a press story as it
// was read at the time, on the Pulse desktop browser of its era (./pulse.tsx). Up to 1998 Pulse Navigator: a
// grey bevelled window, a big throbber with the Pulse mark beating while the page loads, Times and blue links.
// 1999-2004 Pulse Explorer: a blue title bar, menus, an Address box and a Go button. 2005-2008 Pulse Fox: a
// round back button, one tab and a search box. 2009-2011 Pulse Sphere: tabs on top of a slim toolbar. The page
// loads from the top, scrolls to the passage and highlights it as the narrator reads. The outlet is text only,
// never a real web address. Tagged ILLUSTRATION.
import React from "react";
import { Img, interpolate, spring } from "remotion";
import { BODY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import { clamp, easeOut, sizeByLength, wordCount } from "./common.ts";
import { outletOf, storyParts } from "./PhoneStory.tsx";
import { PulseMark, browserOf, storyYear, type BrowserKind } from "./pulse.tsx";

const W = 1460;
const H = 860;

export { storyYear };

type GlyphName =
  | "back"
  | "fwd"
  | "reload"
  | "home"
  | "stop"
  | "print"
  | "search"
  | "star"
  | "menu";

/** Toolbar pictures as plain shapes. */
const Glyph: React.FC<{ name: GlyphName; size: number; colour: string }> = ({
  name,
  size,
  colour,
}) => {
  const s = {
    stroke: colour,
    strokeWidth: 3,
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ display: "block" }}
    >
      {name === "back" && <path d="M14 5 L7 12 L14 19 M7 12 H20" {...s} />}
      {name === "fwd" && <path d="M10 5 L17 12 L10 19 M17 12 H4" {...s} />}
      {name === "reload" && (
        <path d="M19 12 A7 7 0 1 1 16 6.5 M16 2.5 V7 H20.5" {...s} />
      )}
      {name === "home" && (
        <path d="M4 12 L12 4 L20 12 M7 10 V20 H17 V10" {...s} />
      )}
      {name === "stop" && <path d="M6 6 L18 18 M18 6 L6 18" {...s} />}
      {name === "print" && (
        <path d="M7 9 V3 H17 V9 M5 9 H19 V17 H5 Z M8 14 H16 V21 H8 Z" {...s} />
      )}
      {name === "search" && (
        <path d="M10.5 4 A6.5 6.5 0 1 1 10.4 4 M15.5 15.5 L21 21" {...s} />
      )}
      {name === "star" && (
        <path
          d="M12 3 L14.6 9 L21 9.5 L16 13.7 L17.6 20 L12 16.6 L6.4 20 L8 13.7 L3 9.5 L9.4 9 Z"
          {...s}
        />
      )}
      {name === "menu" && <path d="M4 6 H20 M4 12 H20 M4 18 H20" {...s} />}
    </svg>
  );
};

/** A 90s or 2000s toolbar button: a picture over its label. */
const ToolButton: React.FC<{
  name: GlyphName;
  label: string;
  kind: BrowserKind;
}> = ({ name, label, kind }) => {
  const nav = kind === "navigator";
  return (
    <div
      style={{
        width: nav ? 86 : 96,
        height: nav ? 74 : 54,
        display: "flex",
        flexDirection: nav ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: nav ? 4 : 6,
        fontSize: nav ? 15 : 16,
        color: "#111",
        fontFamily: nav
          ? "'MS Sans Serif', Tahoma, Arial, sans-serif"
          : "Tahoma, Verdana, sans-serif",
        background: nav ? "#c0c0c0" : "transparent",
        border: nav ? "2px outset #f0f0f0" : "none",
      }}
    >
      <Glyph
        name={name}
        size={nav ? 30 : 26}
        colour={
          nav
            ? "#1d3f8a"
            : name === "back" || name === "fwd"
              ? "#1f8a2e"
              : "#2a4f9a"
        }
      />
      {label}
    </div>
  );
};

/** The address text: no real domain, just the outlet and the year as a path. */
const address = (y: number, outlet: string) =>
  `news / ${y} / ${outlet.toLowerCase().replace(/\s+/g, "-")}`;

/** The window chrome above the page for each browser; returns its height so the page sits below it. */
function chromeHeight(kind: BrowserKind): number {
  return { navigator: 214, explorer: 176, fox: 150, sphere: 112 }[kind];
}

const Chrome: React.FC<{
  kind: BrowserKind;
  name: string;
  outlet: string;
  y: number;
  load: number;
  frame: number;
}> = ({ kind, name, outlet, y, load, frame }) => {
  const busy = load < 1;
  // The throbber: the mark beats while the page loads and rests once it is done.
  const beat = busy ? (frame % 24) / 24 : undefined;
  const sans = "Tahoma, Verdana, Arial, sans-serif";
  if (kind === "navigator")
    return (
      <div style={{ fontFamily: "'MS Sans Serif', Tahoma, Arial, sans-serif" }}>
        <div
          style={{
            height: 40,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 12px",
            color: "#fff",
            fontSize: 19,
            fontWeight: 700,
            background: "linear-gradient(90deg,#000080,#1084d0)",
          }}
        >
          <PulseMark size={24} colour="#fff" />
          {`${name} - [${outlet}]`}
        </div>
        <div
          style={{
            height: 30,
            display: "flex",
            gap: 22,
            alignItems: "center",
            padding: "0 14px",
            fontSize: 17,
            color: "#111",
          }}
        >
          {[
            "File",
            "Edit",
            "View",
            "Go",
            "Bookmarks",
            "Options",
            "Window",
            "Help",
          ].map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderTop: "2px groove #fff",
          }}
        >
          <ToolButton name="back" label="Back" kind={kind} />
          <ToolButton name="fwd" label="Forward" kind={kind} />
          <ToolButton name="home" label="Home" kind={kind} />
          <ToolButton name="reload" label="Reload" kind={kind} />
          <ToolButton name="print" label="Print" kind={kind} />
          <ToolButton name="stop" label="Stop" kind={kind} />
          <div
            style={{
              marginLeft: "auto",
              width: 84,
              height: 74,
              background: "#000",
              border: "2px inset #ddd",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PulseMark size={62} beat={beat} spin={busy ? frame * 6 : 0} />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 12px",
            borderTop: "2px groove #fff",
            borderBottom: "2px groove #fff",
          }}
        >
          <span style={{ fontSize: 17, fontWeight: 700 }}>Location:</span>
          <div
            style={{
              flex: 1,
              height: 30,
              display: "flex",
              alignItems: "center",
              padding: "0 10px",
              background: "#fff",
              border: "2px inset #ddd",
              fontSize: 17,
              color: "#222",
            }}
          >
            {address(y, outlet)}
          </div>
        </div>
      </div>
    );
  if (kind === "explorer")
    return (
      <div style={{ fontFamily: sans }}>
        <div
          style={{
            height: 42,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 12px",
            color: "#fff",
            fontSize: 19,
            fontWeight: 700,
            borderRadius: "10px 10px 0 0",
            background: "linear-gradient(#3d8bf5,#0a5ae0 40%,#0848c4)",
            textShadow: "1px 1px 0 rgba(0,0,0,0.4)",
          }}
        >
          <PulseMark size={24} colour="#fff" />
          {`${outlet} - ${name}`}
        </div>
        <div
          style={{
            height: 34,
            display: "flex",
            alignItems: "center",
            gap: 20,
            padding: "0 12px",
            fontSize: 17,
            color: "#111",
            borderBottom: "1px solid #c8c4b0",
          }}
        >
          {["File", "Edit", "View", "Favorites", "Tools", "Help"].map((m) => (
            <span key={m}>{m}</span>
          ))}
          <div
            style={{
              marginLeft: "auto",
              width: 52,
              height: 32,
              background: "#fff",
              border: "1px solid #b0aa90",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PulseMark size={28} beat={beat} />
          </div>
        </div>
        <div
          style={{
            height: 58,
            display: "flex",
            alignItems: "center",
            gap: 2,
            padding: "0 8px",
            borderBottom: "1px solid #c8c4b0",
          }}
        >
          <ToolButton name="back" label="Back" kind={kind} />
          <ToolButton name="fwd" label="" kind={kind} />
          <ToolButton name="stop" label="" kind={kind} />
          <ToolButton name="reload" label="" kind={kind} />
          <ToolButton name="home" label="" kind={kind} />
          <ToolButton name="search" label="Search" kind={kind} />
          <ToolButton name="star" label="Favorites" kind={kind} />
        </div>
        <div
          style={{
            height: 42,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 10px",
          }}
        >
          <span style={{ fontSize: 16, color: "#555" }}>Address</span>
          <div
            style={{
              flex: 1,
              height: 30,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 8px",
              background: "#fff",
              border: "1px solid #7f9db9",
              fontSize: 17,
              color: "#222",
            }}
          >
            <PulseMark size={20} />
            {address(y, outlet)}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 16,
              color: "#111",
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                background: "linear-gradient(#5fd35a,#1f8a2e)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Glyph name="fwd" size={18} colour="#fff" />
            </div>
            Go
          </div>
        </div>
      </div>
    );
  if (kind === "fox")
    return (
      <div
        style={{
          fontFamily: sans,
          background: "linear-gradient(#f4f4f4,#dcdcdc)",
        }}
      >
        <div
          style={{
            height: 36,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 12px",
            fontSize: 17,
            color: "#222",
          }}
        >
          <PulseMark size={22} />
          {`${outlet} - ${name}`}
        </div>
        <div
          style={{
            height: 70,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 12px",
          }}
        >
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: "50%",
              background: "radial-gradient(circle at 40% 30%,#fff,#c8d3e0)",
              border: "1px solid #8a9ab0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Glyph name="back" size={34} colour="#2c4a80" />
          </div>
          <Glyph name="fwd" size={30} colour="#7d8ba0" />
          <Glyph name="reload" size={30} colour="#2c4a80" />
          <Glyph name="stop" size={30} colour={busy ? "#b03030" : "#aab"} />
          <Glyph name="home" size={30} colour="#2c4a80" />
          <div
            style={{
              flex: 1,
              height: 40,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 12px",
              background: "#fff",
              border: "1px solid #9aa4b4",
              borderRadius: 4,
              fontSize: 18,
              color: "#333",
            }}
          >
            <PulseMark size={22} />
            {address(y, outlet)}
          </div>
          <div
            style={{
              width: 230,
              height: 40,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 10px",
              background: "#fff",
              border: "1px solid #9aa4b4",
              borderRadius: 4,
              fontSize: 17,
              color: "#999",
            }}
          >
            <PulseMark size={22} />
            Search
          </div>
        </div>
        <div
          style={{
            height: 44,
            display: "flex",
            alignItems: "flex-end",
            gap: 4,
            padding: "0 12px",
            borderBottom: "1px solid #a8a8a8",
          }}
        >
          <div
            style={{
              height: 38,
              minWidth: 300,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 14px",
              background: "#fff",
              border: "1px solid #a8a8a8",
              borderBottom: "none",
              borderRadius: "6px 6px 0 0",
              fontSize: 17,
              color: "#222",
            }}
          >
            <PulseMark size={20} beat={beat} />
            {outlet}
            <span style={{ marginLeft: "auto", color: "#888" }}>x</span>
          </div>
          <div
            style={{
              height: 32,
              width: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#666",
              fontSize: 22,
            }}
          >
            +
          </div>
        </div>
      </div>
    );
  return (
    <div
      style={{
        fontFamily: "'Segoe UI', Tahoma, Verdana, sans-serif",
        background: "linear-gradient(#c9d7ea,#b4c6de)",
      }}
    >
      <div
        style={{
          height: 54,
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          padding: "0 16px",
        }}
      >
        <div
          style={{
            height: 42,
            width: 330,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 16px",
            background: "#fff",
            borderRadius: "10px 10px 0 0",
            fontSize: 17,
            color: "#222",
          }}
        >
          <PulseMark size={20} beat={beat} />
          {outlet}
          <span style={{ marginLeft: "auto", color: "#888" }}>x</span>
        </div>
        <div
          style={{
            height: 30,
            width: 46,
            marginBottom: 4,
            borderRadius: "8px 8px 0 0",
            background: "rgba(255,255,255,0.45)",
          }}
        />
        <div
          style={{
            marginLeft: "auto",
            alignSelf: "center",
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "#3a4a64",
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          <PulseMark size={22} colour="#3a4a64" />
          {name}
        </div>
      </div>
      <div
        style={{
          height: 58,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 16px",
          background: "#fff",
          borderBottom: "1px solid #c5ccd8",
        }}
      >
        <Glyph name="back" size={28} colour="#555" />
        <Glyph name="fwd" size={28} colour="#bbb" />
        <Glyph name="reload" size={28} colour="#555" />
        <div
          style={{
            flex: 1,
            height: 38,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 14px",
            background: "#fff",
            border: "1px solid #b8c2d4",
            borderRadius: 19,
            fontSize: 18,
            color: "#333",
          }}
        >
          <PulseMark size={20} />
          {address(y, outlet)}
          <span style={{ marginLeft: "auto" }}>
            <Glyph name="star" size={22} colour="#999" />
          </span>
        </div>
        <Glyph name="menu" size={28} colour="#555" />
      </div>
    </div>
  );
};

/**
 * The article's picture (the sentence's game), floated beside the text so the passage stays in view. Up to 1998
 * it is a small, coarse JPEG of the dial-up days; later ones grow larger and sharper.
 */
const Hero: React.FC<{ src: string; kind: BrowserKind }> = ({ src, kind }) => {
  const w = { navigator: 340, explorer: 420, fox: 470, sphere: 520 }[kind];
  const h = Math.round(w * 0.6);
  const coarse = kind === "navigator";
  return (
    <div
      style={{
        float: "right",
        width: w,
        height: h,
        margin: "22px 0 12px 34px",
        overflow: "hidden",
        border: coarse ? "2px solid #000" : "1px solid #ccc",
        borderRadius: kind === "sphere" ? 6 : 0,
        position: "relative",
      }}
    >
      <Img
        src={src}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: coarse ? w / 3 : w,
          height: coarse ? h / 3 : h,
          objectFit: "cover",
          transform: coarse ? "scale(3)" : undefined,
          transformOrigin: "0 0",
          imageRendering: coarse ? "pixelated" : undefined,
          filter: coarse ? "saturate(0.8) contrast(1.08)" : kind === "explorer" ? "saturate(0.92)" : undefined,
        }}
      />
    </div>
  );
};

export const OldWeb: React.FC<GfxProps> = ({
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
  const y = storyYear(g, year) ?? 2000;
  const { kind, name } = browserOf(y);
  const old = kind === "navigator" || kind === "explorer";
  const outlet = outletOf(credit, g.kind);
  const serif = old
    ? "'Times New Roman', Times, serif"
    : "Georgia, 'Times New Roman', serif";
  const sans = old
    ? "Arial, Helvetica, sans-serif"
    : "Verdana, Tahoma, sans-serif";
  const top = chromeHeight(kind);
  const statusBar = kind !== "sphere";

  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  });
  // The page draws in from the top the way slow connections loaded it (faster in later years).
  const load = interpolate(
    frame,
    [14, kind === "navigator" ? 50 : kind === "explorer" ? 42 : 30],
    [0, 1],
    {
      ...clamp,
      easing: easeOut,
    },
  );
  const readFrom = 60;
  const readTo = Math.max(readFrom + 30, showFor - 24);
  const read = interpolate(frame, [readFrom, readTo], [0, 1], clamp);
  // The page scrolls the passage up near the top of the window and no further (it starts about 185 px down).
  const scroll = interpolate(
    frame,
    [46, readFrom + 20, readTo],
    [0, passage ? 90 : 0, passage ? 140 : 20],
    {
      ...clamp,
      easing: easeOut,
    },
  );
  const words = passage.split(/\s+/).filter(Boolean);
  const hl = highlight
    ? passage.toLowerCase().indexOf(highlight.toLowerCase())
    : -1;
  const hlStart =
    hl >= 0 ? passage.slice(0, hl).split(/\s+/).filter(Boolean).length : 0;
  const hlLen =
    hl >= 0 ? highlight.split(/\s+/).filter(Boolean).length : words.length;
  const lit = Math.floor(read * (hlLen + 1));
  const headSize = sizeByLength(headline.length, [
    [50, 54],
    [80, 46],
    [999, 40],
  ]);
  const passSize = sizeByLength(passage.length, [
    [160, 34],
    [280, 30],
    [999, 27],
  ]);
  const frameBg = {
    navigator: "#c0c0c0",
    explorer: "#ece9d8",
    fox: "#e6e6e6",
    sphere: "#b4c6de",
  }[kind];

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={12}>
      <div
        style={{
          position: "absolute",
          left: 960 - W / 2,
          top: 540 - H / 2 + (1 - enter) * 300,
          width: W,
          height: H,
          background: frameBg,
          border:
            kind === "navigator"
              ? "3px outset #e8e8e8"
              : kind === "explorer"
                ? "3px solid #0848c4"
                : "1px solid #8a94a6",
          borderRadius:
            kind === "navigator"
              ? 0
              : kind === "explorer"
                ? "12px 12px 0 0"
                : 10,
          boxShadow: "0 40px 110px rgba(0,0,0,0.6)",
          overflow: "hidden",
          opacity: enter,
        }}
      >
        <Chrome
          kind={kind}
          name={name}
          outlet={outlet}
          y={y}
          load={load}
          frame={frame}
        />
        {/* The page */}
        <div
          style={{
            position: "absolute",
            top,
            left: 0,
            right: 0,
            bottom: statusBar ? 30 : 0,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              clipPath: `inset(0 0 ${(1 - load) * 100}% 0)`,
              transform: `translateY(${-scroll}px)`,
              padding: "26px 60px",
            }}
          >
            <div
              style={{
                fontFamily: serif,
                fontSize: 44,
                fontWeight: 700,
                color: old ? "#000" : "#1b2a4a",
                borderBottom: old ? "3px double #000" : "4px solid #2c5aa0",
                paddingBottom: 8,
              }}
            >
              {outlet}
            </div>
            <div
              style={{
                marginTop: 10,
                fontFamily: sans,
                fontSize: 18,
                color: "#00e",
                textDecoration: "underline",
                display: "flex",
                gap: 22,
              }}
            >
              <span>Home</span>
              <span>News</span>
              <span>Games</span>
              <span>Reviews</span>
              <span>Archive</span>
            </div>
            {src && <Hero src={src} kind={kind} />}
            {headline && (
              <div
                style={{
                  marginTop: 26,
                  fontFamily: serif,
                  fontSize: headSize,
                  fontWeight: 700,
                  color: "#000",
                  lineHeight: 1.12,
                }}
              >
                {headline}
              </div>
            )}
            {credit && (
              <div
                style={{
                  marginTop: 12,
                  fontFamily: sans,
                  fontSize: 20,
                  color: "#555",
                  fontStyle: "italic",
                }}
              >
                {credit}
              </div>
            )}
            {passage && (
              <div
                style={{
                  marginTop: 26,
                  fontFamily: serif,
                  fontSize: passSize,
                  color: "#111",
                  lineHeight: 1.5,
                }}
              >
                {words.map((w, i) => {
                  const inSpan = i >= hlStart && i < hlStart + hlLen;
                  const on = inSpan && i - hlStart < lit;
                  return (
                    <span
                      key={i}
                      style={{
                        background: on ? "rgba(255,230,0,0.75)" : "transparent",
                      }}
                    >
                      {w}{" "}
                    </span>
                  );
                })}
              </div>
            )}
            {Array.from({ length: 14 }, (_, i) => (
              <div
                key={i}
                style={{
                  height: 14,
                  marginTop: i ? 14 : 30,
                  width: `${86 + ((i * 29) % 12)}%`,
                  background: "#e3e3e3",
                }}
              />
            ))}
          </div>
        </div>
        {statusBar && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 30,
              background: frameBg,
              borderTop:
                kind === "navigator" ? "2px groove #fff" : "1px solid #b0aa90",
              fontFamily: sans,
              fontSize: 16,
              color: "#222",
              display: "flex",
              alignItems: "center",
              padding: "0 12px",
            }}
          >
            {load < 1
              ? kind === "navigator"
                ? `Document: ${Math.round(load * 100)}% of 48K`
                : "Opening page..."
              : kind === "navigator"
                ? "Document: Done"
                : "Done"}
            {kind === "explorer" && (
              <span style={{ marginLeft: "auto" }}>Internet</span>
            )}
          </div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          right: 60,
          bottom: 40,
          color: "rgba(255,255,255,0.7)",
          fontFamily: BODY,
          fontSize: 20,
          letterSpacing: 3,
          opacity: interpolate(frame, [20, 30], [0, 1], clamp),
        }}
      >
        ILLUSTRATION
      </div>
    </Stage>
  );
};

/** A headline of 3-14 words, or a quote or passage of 6-70 words; a short credit line. */
export const fitsOldWeb = (g: MomentGraphic) => {
  const { headline, passage, credit } = storyParts(g);
  if (credit.length > 60) return false;
  if (g.kind === "headline")
    return wordCount(headline) >= 3 && wordCount(headline) <= 14;
  return wordCount(passage) >= 6 && wordCount(passage) <= 70;
};
