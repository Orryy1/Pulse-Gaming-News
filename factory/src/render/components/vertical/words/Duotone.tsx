// Words/Duotone (kind "quote"): a picture of the game turned duotone (ink shadows, accent highlights)
// fills a panel that wipes in; a solid accent tab carries a big quote mark at its corner, the quote rises
// in heavy type a word at a time beside it, and the speaker sits beneath on an accent dash.
// primary: the quote (4-30 words); secondary: the speaker (optional, 32 characters at most); src: the picture.
import React from "react";
import {
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { COLOUR } from "../../../brand.ts";
import type { VGfxProps } from "../types.ts";
import {
  clamp,
  exitOf,
  onAccent,
  quoteText,
  ramp,
  rgba,
  textW,
  txt,
  words,
  wrapEven,
  shadow,
} from "./kit.ts";

const W = 952;
const H = 500;
const TAB = 128;
const TEXT_X = TAB + 40;
const TEXT_W = W - TEXT_X - 40;
const PAD_Y = 34;
const SIZES = [84, 76, 68, 62, 56, 52, 48, 44, 40];
const WHO_SIZE = 32;
const WHO_GAP = 22;

type Layout = {
  lines: string[];
  size: number;
  lineH: number;
  who: string;
  panelH: number;
};

/** The accent taken down to a deep shade: the duotone's shadow colour. */
function deep(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#2a1408";
  const c = [m[1], m[2], m[3]].map((x) => Math.round(parseInt(x!, 16) * 0.2 + 8));
  return `rgb(${c.join(",")})`;
}

export function layoutDuotone(v: VGfxProps["v"]): Layout | null {
  const quote = quoteText(v.primary);
  const n = words(quote).length;
  if (n < 4 || n > 30) return null;
  const who = txt(v.secondary).toUpperCase();
  if (
    who.length > 32 ||
    (who && textW(who, "inter800", WHO_SIZE, 3) > TEXT_W - 70)
  )
    return null;
  for (const size of SIZES) {
    // The closing mark rides on the last line, so it is measured with the quote.
    const lines = wrapEven(`${quote}”`, "inter900", size, TEXT_W);
    if (!lines) continue;
    const lineH = Math.round(size * 1.12);
    const textH = lines.length * lineH;
    const panelH = Math.max(
      TAB + 56,
      PAD_Y + textH + (who ? WHO_GAP + WHO_SIZE + 8 : 0) + PAD_Y + 6,
    );
    if (panelH <= H)
      return {
        lines: lines.map((l) => l.replace(/”$/, "")),
        size,
        lineH,
        who,
        panelH,
      };
  }
  return null;
}

export const Duotone: React.FC<VGfxProps> = ({
  v,
  len,
  accent,
  variant = 0,
  src,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = layoutDuotone(v);
  if (!L) return null;
  const { lines, size, lineH, who, panelH } = L;
  const top = Math.round((H - panelH) / 3);
  const out = exitOf(frame, len);

  const wipe = ramp(frame, 0, 9);
  const tab = spring({
    frame: frame - 2,
    fps,
    config: { damping: 12, stiffness: 300, mass: 0.5 },
  });
  const push = interpolate(frame, [0, Math.max(1, len)], [1.06, 1.16], clamp);
  const drift =
    (variant % 2 ? 1 : -1) *
    interpolate(frame, [0, Math.max(1, len)], [-14, 14], clamp);

  // The quote rises a word at a time: all in by about frame 26 for 30 words.
  const all = lines.map((l) => l.split(" "));
  const count = all.reduce((s, l) => s + l.length, 0);
  const step = Math.min(1.6, 16 / count);
  const whoAt = 8 + count * step;
  const whoIn = ramp(frame, whoAt, whoAt + 8);
  const dash = ramp(frame, whoAt - 2, whoAt + 6);
  const ink = onAccent(accent);
  let wi = 0;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: W,
        height: panelH,
        opacity: out,
        transform: `translateX(${(1 - out) * 40}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 8,
          overflow: "hidden",
          clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0 round 8px)`,
          boxShadow: shadow(1),
          isolation: "isolate",
          background: "#120d0b",
        }}
      >
        {src ? (
          <>
            <Img
              src={src}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `scale(${push}) translateX(${drift}px)`,
                filter: "grayscale(1) brightness(1.35) contrast(1.45)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: accent,
                mixBlendMode: "multiply",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: deep(accent),
                mixBlendMode: "lighten",
              }}
            />
          </>
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(circle, ${rgba(accent, 0.34)} 0 3px, transparent 3.5px) 0 0 / 18px 18px, radial-gradient(90% 120% at 85% 10%, ${rgba(accent, 0.55)} 0%, #1a1210 75%)`,
              transform: `scale(${push})`,
            }}
          />
        )}
        {/* Shade for the type: heavier where the words sit, the picture still showing at the right. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(10,8,8,0.7) 0%, rgba(10,8,8,0.46) 50%, rgba(10,8,8,0.1) 100%), linear-gradient(180deg, rgba(10,8,8,0.1) 0%, rgba(10,8,8,0) 40%, rgba(10,8,8,0.5) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 6,
            width: `${wipe * 100}%`,
            background: accent,
          }}
        />
      </div>

      {/* The tab with the big opening mark. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: TAB,
          height: TAB,
          background: accent,
          borderRadius: "8px 0 8px 0",
          transform: `scale(${tab}) rotate(${(1 - tab) * -12}deg)`,
          transformOrigin: "0 0",
          opacity: Math.min(1, tab * 2),
          overflow: "hidden",
          boxShadow: "0 10px 26px rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 18,
            top: 6,
            fontFamily: DISPLAY,
            fontSize: 230,
            lineHeight: 1,
            color: ink,
          }}
        >
          {"“"}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: TEXT_X,
          top: PAD_Y,
          width: TEXT_W,
        }}
      >
        {all.map((ws, li) => (
          <div
            key={li}
            style={{
              height: lineH,
              lineHeight: `${lineH}px`,
              whiteSpace: "nowrap",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: size,
              color: COLOUR.paper,
              textShadow: "0 3px 0 rgba(0,0,0,0.35), 0 6px 26px rgba(0,0,0,0.75)",
            }}
          >
            {ws.map((w, k) => {
              const p = ramp(frame, 6 + wi * step, 6 + wi * step + 5);
              wi++;
              const last = li === all.length - 1 && k === ws.length - 1;
              return (
                <span
                  key={k}
                  style={{
                    display: "inline-block",
                    marginRight: k < ws.length - 1 ? "0.26em" : 0,
                    opacity: p,
                    transform: `translateY(${(1 - p) * 26}px)`,
                  }}
                >
                  {w}
                  {last ? <span style={{ color: accent }}>{"”"}</span> : null}
                </span>
              );
            })}
          </div>
        ))}
        {who ? (
          <div
            style={{
              marginTop: WHO_GAP,
              display: "flex",
              alignItems: "center",
              gap: 18,
              height: WHO_SIZE + 8,
            }}
          >
            <div
              style={{
                width: 52 * dash,
                height: 6,
                borderRadius: 3,
                background: accent,
              }}
            />
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: WHO_SIZE,
                letterSpacing: 3,
                color: COLOUR.paper,
                opacity: whoIn,
                transform: `translateX(${(1 - whoIn) * -16}px)`,
                whiteSpace: "nowrap",
              }}
            >
              {who}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const fitsDuotone = (v: VGfxProps["v"]) => layoutDuotone(v) !== null;
