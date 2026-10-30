// Screen pack, "OldWeb" (owner, 30 Oct 2026: old stories came up on modern smartphones): a press story as it
// was read at the time, on a desktop browser of its era. 1995-2002: a grey bevelled window with a navy title
// bar, Times New Roman and blue underlined links; 2003-2011: a lighter glossy window with tabs and Verdana. The
// page loads from the top, scrolls to the passage and highlights it as the narrator reads. Generic chrome (no
// browser brand), the outlet as text only, never a real web address. Tagged ILLUSTRATION.
import React from "react";
import { interpolate, spring } from "remotion";
import { BODY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import { clamp, easeOut, sizeByLength, txt, wordCount } from "./common.ts";
import { outletOf, storyParts } from "./PhoneStory.tsx";

const W = 1460;
const H = 860;

/** The story's year: from the credit or the headline, else the game's year. */
export function storyYear(
  g: MomentGraphic,
  fallback?: number,
): number | undefined {
  const m = `${g.secondary} ${g.primary} ${g.items.join(" ")}`.match(
    /\b(19[89]\d|20[0-4]\d)\b/,
  );
  return m ? Number(m[0]) : fallback;
}

const Bevel: React.FC<{ w: number; label: string; old: boolean }> = ({
  w,
  label,
  old,
}) => (
  <div
    style={{
      width: w,
      height: 46,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 18,
      color: "#222",
      background: old ? "#c0c0c0" : "linear-gradient(#fdfdfd,#dfe3ea)",
      border: old ? "2px outset #f0f0f0" : "1px solid #aab2c0",
      borderRadius: old ? 0 : 8,
      fontFamily: old
        ? "'MS Sans Serif', Tahoma, Arial, sans-serif"
        : "Verdana, Tahoma, sans-serif",
    }}
  >
    {label}
  </div>
);

export const OldWeb: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 300);
  const { headline, passage, credit, highlight } = storyParts(g);
  if (!visible || (!headline && !passage)) return null;
  const y = storyYear(g, year) ?? 2000;
  const old = y <= 2002;
  const outlet = outletOf(credit, g.kind);
  const serif = old
    ? "'Times New Roman', Times, serif"
    : "Georgia, 'Times New Roman', serif";
  const sans = old
    ? "Arial, Helvetica, sans-serif"
    : "Verdana, Tahoma, sans-serif";

  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  });
  // The page draws in from the top the way slow connections loaded it.
  const load = interpolate(frame, [14, 46], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const readFrom = 60;
  const readTo = Math.max(readFrom + 30, showFor - 24);
  const read = interpolate(frame, [readFrom, readTo], [0, 1], clamp);
  const scroll = interpolate(
    frame,
    [46, readFrom + 20, readTo],
    [0, passage ? 120 : 0, passage ? 200 : 20],
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

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={12}>
      <div
        style={{
          position: "absolute",
          left: 960 - W / 2,
          top: 540 - H / 2 + (1 - enter) * 300,
          width: W,
          height: H,
          background: old ? "#c0c0c0" : "#eef1f6",
          border: old ? "3px outset #e8e8e8" : "1px solid #9aa4b4",
          borderRadius: old ? 0 : 12,
          boxShadow: "0 40px 110px rgba(0,0,0,0.6)",
          overflow: "hidden",
          opacity: enter,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            height: 40,
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            color: old ? "#fff" : "#223",
            fontFamily: sans,
            fontSize: 19,
            fontWeight: 700,
            background: old
              ? "linear-gradient(90deg,#000080,#1084d0)"
              : "linear-gradient(#f8fafc,#d9dee8)",
          }}
        >
          {outlet} - News
        </div>
        {/* Toolbar and address bar */}
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "8px 12px",
            borderBottom: old ? "2px groove #fff" : "1px solid #c5ccd8",
          }}
        >
          <Bevel w={92} label="Back" old={old} />
          <Bevel w={110} label="Forward" old={old} />
          <Bevel w={100} label="Reload" old={old} />
          <Bevel w={86} label="Home" old={old} />
          <div
            style={{
              flex: 1,
              height: 40,
              marginLeft: 10,
              display: "flex",
              alignItems: "center",
              padding: "0 12px",
              fontFamily: sans,
              fontSize: 18,
              color: "#333",
              background: "#fff",
              border: old ? "2px inset #ddd" : "1px solid #a8b2c4",
              borderRadius: old ? 0 : 6,
            }}
          >
            {`news / ${y} / ${outlet.toLowerCase()}`}
          </div>
        </div>
        {/* The page */}
        <div
          style={{
            position: "absolute",
            top: 112,
            left: 0,
            right: 0,
            bottom: old ? 30 : 0,
            background: old ? "#fff" : "#fff",
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
        {old && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 30,
              background: "#c0c0c0",
              borderTop: "2px groove #fff",
              fontFamily: sans,
              fontSize: 16,
              color: "#222",
              display: "flex",
              alignItems: "center",
              padding: "0 12px",
            }}
          >
            {load < 1
              ? `Loading... ${Math.round(load * 100)}%`
              : "Document: Done"}
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
