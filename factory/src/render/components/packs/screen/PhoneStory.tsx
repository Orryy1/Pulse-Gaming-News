// Screen pack, "PhoneStory" (owner, 30 Oct 2026): a press story the way a viewer meets one now. A generic
// smartphone (no brand) wakes, the story drops in as a notification, a finger taps it, the phone's browser
// opens on the article and the page scrolls to the passage, which is highlighted line by line as the narrator
// reads it. Only for stories from 2012 on (the era rule in ../index.ts): an older story gets a period browser
// or a newspaper. Every word on screen comes from the graphic; the outlet is shown as text, never as a logo or
// a real web address. Tagged ILLUSTRATION.
import React from "react";
import { interpolate, spring } from "remotion";
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

const W = 540;
const H = 1060;
const BEZEL = 14;
const SW = W - BEZEL * 2;
const SH = H - BEZEL * 2;

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
  if (kind === "headline") return ok(parts[0]) ? parts[0]! : "NEWS";
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

export const PhoneStory: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 300);
  const { headline, passage, credit, highlight } = storyParts(g);
  if (!visible || (!headline && !passage)) return null;
  const outlet = outletOf(credit, g.kind);
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

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={14}>
      <div
        style={{
          position: "absolute",
          left: 960 - W / 2,
          top: 540 - H / 2 + (1 - rise) * 420,
          width: W,
          height: H,
          borderRadius: 74,
          background: "#0d0d10",
          boxShadow: "0 40px 120px rgba(0,0,0,0.65), inset 0 0 0 3px #2a2a30",
          // Once the article is open the camera pushes in on the screen so the words can be read: on the
          // passage being read, or on the headline when the story has no passage (it sits near the top).
          transform: `rotate(${(variant % 2 ? 1 : -1) * 2.2 * (1 - open)}deg) scale(${1 + 0.42 * zoom}) translateY(${(passage ? -60 : 170) * zoom}px)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: BEZEL,
            top: BEZEL,
            width: SW,
            height: SH,
            borderRadius: 60,
            overflow: "hidden",
            background: "#121318",
            fontFamily: BODY,
          }}
        >
          {/* Lock screen: the time, then the notification. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 1 - open,
              background: "linear-gradient(160deg,#2b2440,#101018 70%)",
            }}
          >
            <div
              style={{
                marginTop: 120,
                textAlign: "center",
                color: "#fff",
                fontSize: 108,
                fontWeight: 300,
                letterSpacing: -2,
              }}
            >
              9:41
            </div>
            <div
              style={{
                position: "absolute",
                left: 18,
                right: 18,
                top: 330 + (1 - drop) * -260,
                opacity: interpolate(drop, [0, 0.4], [0, 1], clamp),
                transform: `scale(${1 - 0.04 * Math.sin(Math.PI * tap)})`,
                background: "rgba(245,245,250,0.92)",
                borderRadius: 30,
                padding: "22px 24px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  color: "#555",
                  fontSize: 21,
                  fontWeight: 600,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: COLOUR.amber,
                  }}
                />
                <span style={{ textTransform: "uppercase", letterSpacing: 1 }}>
                  {outlet}
                </span>
                <span style={{ marginLeft: "auto", fontWeight: 400 }}>now</span>
              </div>
              <div
                style={{
                  marginTop: 12,
                  color: "#111",
                  fontSize: 27,
                  fontWeight: 700,
                  lineHeight: 1.22,
                }}
              >
                {alert}
              </div>
            </div>
            {/* The finger's tap: a soft ring that grows and fades on the notification. */}
            {tapT >= 0 && tapT < 18 && (
              <div
                style={{
                  position: "absolute",
                  left: SW / 2 - 50 - 60 * tap,
                  top: 410 - 50 - 60 * tap,
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
          {/* The browser app opens from the notification and the article scrolls. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#fff",
              opacity: open,
              transform: `scale(${0.82 + 0.18 * open}) translateY(${(1 - open) * -120}px)`,
              borderRadius: 60 * (1 - open),
            }}
          >
            <div
              style={{
                height: 118,
                background: "#f2f2f5",
                borderBottom: "1px solid #ddd",
                paddingTop: 58,
              }}
            >
              <div
                style={{
                  margin: "0 26px",
                  height: 44,
                  borderRadius: 14,
                  background: "#e3e3e8",
                  color: "#666",
                  fontSize: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {outlet.toLowerCase()}
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                top: 118,
                left: 0,
                right: 0,
                bottom: 0,
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
                <div
                  style={{
                    height: 210,
                    marginTop: 24,
                    borderRadius: 16,
                    background: "linear-gradient(135deg,#d7d7de,#ececf1)",
                  }}
                />
                <div style={{ marginTop: 28 }}>
                  <Lines n={4} width={SW - 68} />
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
          </div>
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
