// Motif: Fallout. An homage to the green phosphor terminal: a curved tube in a heavy bezel, a boot
// sequence of generic lines, then the chapter as a menu with a blinking selection bar and the
// pictures coming up line by line in green. Layout, colour, type and motion only: no company names,
// no logos, no real menu.
import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { displayText } from "../../../timeline.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { Motif, MotifCardProps } from "../types.ts";
import {
  MONO_METRICS,
  cardFade,
  clamp,
  fitText,
  fitsAt,
  rand,
} from "./shared.ts";

const MONO_FACE =
  "Consolas, Menlo, 'DejaVu Sans Mono', 'Courier New', monospace";
const GREEN = "#4dff94";
const DIM = "rgba(77,255,148,0.6)";
const DARK = "#04160a";
const GLOW = "0 0 8px rgba(77,255,148,0.8), 0 0 30px rgba(77,255,148,0.42)";

/** Text typed out: the first `n` characters, a block cursor after them while typing. */
function typed(
  text: string,
  frame: number,
  at: number,
  perFrame: number,
): { shown: string; done: boolean } {
  const n = Math.max(0, Math.floor((frame - at) * perFrame));
  return { shown: text.slice(0, n), done: n >= text.length };
}

const Cursor: React.FC<{ size: number; on: boolean }> = ({ size, on }) => (
  <span
    style={{
      display: "inline-block",
      width: size * 0.56,
      height: size * 0.9,
      marginLeft: size * 0.08,
      verticalAlign: "-0.12em",
      background: on ? GREEN : "transparent",
      boxShadow: on ? GLOW : undefined,
    }}
  />
);

/** The tube: dark green glass, scanlines, a rolling bright band, flicker, curved dark edges, glare. */
const Tube: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  frame: number;
  children: React.ReactNode;
}> = ({ x, y, w, h, radius, frame, children }) => {
  const flicker = 0.95 + rand(frame * 0.71) * 0.05;
  const band = ((frame * 9) % (h + 400)) - 200;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: radius,
        overflow: "hidden",
        background:
          "radial-gradient(ellipse at 50% 46%, #0e3d1f 0%, #072512 52%, #020d05 100%)",
      }}
    >
      <AbsoluteFill style={{ opacity: flicker }}>{children}</AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: band,
          height: 200,
          background:
            "linear-gradient(180deg, rgba(120,255,170,0) 0%, rgba(120,255,170,0.07) 50%, rgba(120,255,170,0) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(0,0,0,0.3) 0px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 4px)",
        }}
      />
      <AbsoluteFill
        style={{
          borderRadius: radius,
          boxShadow:
            "inset 0 0 150px 40px rgba(0,0,0,0.78), inset 0 0 26px 6px rgba(0,0,0,0.85)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(158deg, rgba(220,255,230,0.09) 0%, rgba(220,255,230,0.02) 26%, rgba(0,0,0,0) 40%)",
        }}
      />
    </div>
  );
};

/** A picture as the tube would show it: green monochrome, revealed top to bottom by a scan line. */
const GreenPicture: React.FC<{
  src: string;
  w: number;
  h: number;
  reveal: number;
  t: number;
}> = ({ src, w, h, reveal, t }) => (
  <div
    style={{
      position: "relative",
      width: w,
      height: h,
      border: `3px solid ${GREEN}`,
      boxShadow: GLOW,
      padding: 10,
      boxSizing: "border-box",
    }}
  >
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        isolation: "isolate",
        clipPath: `inset(0 0 ${(1 - reveal) * 100}% 0)`,
        background: "#000",
      }}
    >
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${1.04 + 0.05 * t})`,
          filter: "grayscale(1) contrast(1.45) brightness(1.15)",
        }}
      />
      <AbsoluteFill style={{ background: GREEN, mixBlendMode: "multiply" }} />
      <AbsoluteFill
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(0,0,0,0.4) 0px, rgba(0,0,0,0.4) 3px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 6px)",
        }}
      />
    </div>
    {reveal > 0 && reveal < 1 ? (
      <div
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          top: 10 + (h - 20) * reveal - 2,
          height: 4,
          background: "#c8ffdc",
          boxShadow: "0 0 18px 6px rgba(77,255,148,0.7)",
        }}
      />
    ) : null}
  </div>
);

const BOOT = [
  "INITIALIZING",
  "LOADING ARCHIVE",
  "MEMORY CHECK",
  "ESTABLISHING LINK",
];
const BOOT_END = 22;

// ---------------------------------------------------------------------------------------------------
// The card

const SX = 150;
const SY = 92;
const SW = 1620;
const SH = 896;
const PADX = 104;
const PADY = 84;

export const FalloutCard: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const v = Math.abs(Math.floor(variant));
  const pics = pictures.filter(Boolean);
  const head = displayText(heading).toUpperCase().trim();
  const kick = kicker ? displayText(kicker).toUpperCase().trim() : "";
  const top = [
    game ? displayText(game).toUpperCase().trim() : "",
    year ? displayText(year).trim() : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  const t = interpolate(frame, [0, Math.max(30, frames)], [0, 1], clamp);
  const innerW = SW - 2 * PADX;
  const picW = pics.length ? 600 : 0;
  const textW = innerW - (picW ? picW + 56 : 0);
  const fit = fitText(head, MONO_METRICS, {
    width: textW,
    height: 380,
    lineHeight: 1.22,
    maxLines: 4,
    maxSize: 124,
    minSize: 46,
    padEm: 0.7,
  });
  const booting = frame < BOOT_END;
  // The screen clears with a flash of brightness between the boot and the menu.
  const flash = interpolate(
    frame,
    [BOOT_END - 1, BOOT_END, BOOT_END + 4],
    [0, 0.55, 0],
    clamp,
  );
  const headAt = BOOT_END + 6;
  const headRate = Math.max(2.4, head.length / 9);
  const headTyped = typed(head, frame, headAt, headRate);
  const barAt = headAt + Math.ceil(head.length / headRate) + 1;
  const barOn = frame >= barAt && (frame - barAt) % 24 < 17;
  const picAt = barAt + 2;
  const picEvery =
    pics.length > 1
      ? Math.max(
          34,
          Math.floor((frames - picAt - 12) / Math.min(3, pics.length)),
        )
      : 9999;
  const picIndex =
    frame < picAt
      ? 0
      : Math.min(pics.length - 1, Math.floor((frame - picAt) / picEvery));
  const picReveal = interpolate(
    frame - picAt - picIndex * picEvery,
    [0, 14],
    [0, 1],
    clamp,
  );
  const line = (k: number): React.CSSProperties => ({
    fontFamily: MONO_FACE,
    fontWeight: 700,
    color: GREEN,
    textShadow: GLOW,
    whiteSpace: "pre",
  });
  // Heading lines as typed so far.
  let left = headTyped.shown.length;
  const headLines = fit.lines.map((l) => {
    const s = l.slice(0, Math.max(0, left));
    left -= l.length + 1;
    return s;
  });
  return (
    <AbsoluteFill
      style={{
        opacity: cardFade(frame, frames),
        background:
          "radial-gradient(120% 120% at 50% 40%, #1d1f1a 0%, #0b0c0a 70%)",
      }}
    >
      {/* The bezel: a heavy moulded frame round the tube, a status lamp. */}
      <div
        style={{
          position: "absolute",
          left: SX - 54,
          top: SY - 50,
          width: SW + 108,
          height: SH + 100,
          borderRadius: 84,
          background:
            "linear-gradient(170deg, #3a3c35 0%, #23251f 45%, #151612 100%)",
          boxShadow:
            "inset 0 3px 0 rgba(255,255,255,0.08), inset 0 -6px 18px rgba(0,0,0,0.6), 0 30px 80px rgba(0,0,0,0.7)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: SX - 14,
          top: SY - 12,
          width: SW + 28,
          height: SH + 24,
          borderRadius: 64,
          background: "#070806",
          boxShadow: "inset 0 0 20px rgba(0,0,0,0.9)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: SX + SW - 10,
          top: SY + SH + 18,
          width: 12,
          height: 12,
          borderRadius: 6,
          background: GREEN,
          boxShadow: "0 0 12px rgba(77,255,148,0.9)",
          opacity: 0.6 + 0.4 * (Math.floor(frame / 15) % 2),
        }}
      />
      <Tube x={SX} y={SY} w={SW} h={SH} radius={56} frame={frame}>
        <div
          style={{
            position: "absolute",
            left: PADX,
            top: PADY,
            right: PADX,
            bottom: PADY,
          }}
        >
          {booting ? (
            <div style={{ fontSize: 46, lineHeight: 1.55 }}>
              {BOOT.map((label, i) => {
                const at = 1 + i * 4;
                if (frame < at) return null;
                const full = `${label} ${".".repeat(Math.max(3, 26 - label.length))}`;
                const ty = typed(full, frame, at, 6);
                return (
                  <div key={i} style={line(i)}>
                    {ty.shown}
                    {ty.done ? " OK" : <Cursor size={46} on />}
                  </div>
                );
              })}
              <div
                style={{
                  marginTop: 26,
                  width: 860,
                  height: 38,
                  border: `3px solid ${GREEN}`,
                  boxShadow: GLOW,
                  padding: 5,
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${interpolate(frame, [2, BOOT_END - 3], [0, 100], clamp)}%`,
                    background: GREEN,
                    boxShadow: GLOW,
                  }}
                />
              </div>
            </div>
          ) : (
            <div
              style={{ height: "100%", display: "flex", flexDirection: "column" }}
            >
              {top ? (
                <div
                  style={{
                    ...line(0),
                    fontSize: 34,
                    color: DIM,
                    letterSpacing: 2,
                  }}
                >
                  {typed(top, frame, BOOT_END + 1, 5).shown}
                </div>
              ) : null}
              <div
                style={{
                  marginTop: top ? 16 : 0,
                  height: 4,
                  background: GREEN,
                  boxShadow: GLOW,
                  width: `${interpolate(frame, [BOOT_END + 1, BOOT_END + 7], [0, 100], clamp)}%`,
                }}
              />
              {/* The menu and the picture, centred in the screen below the header. */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  gap: 56,
                  alignItems: "center",
                  paddingBottom: 20,
                }}
              >
                <div style={{ width: textW }}>
                  {kick ? (
                    <div style={{ ...line(0), fontSize: 46, marginBottom: 26 }}>
                      {typed(`[ ${kick} ]`, frame, BOOT_END + 3, 5).shown}
                    </div>
                  ) : null}
                  <div style={{ fontSize: fit.size, lineHeight: 1.22 }}>
                    {fit.lines.map((l, i) => (
                      <div
                        key={i}
                        style={{ marginTop: i ? fit.size * 0.06 : 0 }}
                      >
                        <span
                          style={{
                            ...line(1),
                            display: "inline-block",
                            padding: `0 ${fit.size * 0.3}px`,
                            marginLeft: -fit.size * 0.3,
                            background: barOn ? GREEN : "transparent",
                            color: barOn ? DARK : GREEN,
                            textShadow: barOn ? "none" : GLOW,
                            boxShadow: barOn ? GLOW : "none",
                          }}
                        >
                          {frame >= barAt ? l : headLines[i]}
                          {!headTyped.done &&
                          headLines[i]!.length > 0 &&
                          headLines[i]!.length < l.length ? (
                            <Cursor size={fit.size} on />
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      ...line(2),
                      fontSize: 46,
                      marginTop: 44,
                      opacity: frame >= barAt ? 1 : 0,
                    }}
                  >
                    {">"}
                    <Cursor size={46} on={Math.floor(frame / 9) % 2 === 0} />
                  </div>
                </div>
                {pics.length && frame >= picAt ? (
                  <GreenPicture
                    src={pics[picIndex]!}
                    w={picW}
                    h={450}
                    reveal={picReveal}
                    t={t}
                  />
                ) : null}
              </div>
            </div>
          )}
        </div>
        <AbsoluteFill style={{ background: "#b8ffd2", opacity: flash }} />
      </Tube>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// Graphic style: a list as the terminal's menu

const TW = 1560;
const TH = 820;

const TerminalList: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const items = g.items
    .map((x) => displayText(x).toUpperCase().trim())
    .filter(Boolean)
    .slice(0, 6);
  const { frame, dim, visible, showFor } = useStage(
    len,
    70 + items.length * 26,
  );
  if (!visible || items.length < 2) return null;
  const v = Math.abs(Math.floor(variant));
  const head = displayText(g.primary).toUpperCase().trim();
  const longest = Math.max(...items.map((x) => x.length));
  const size = Math.max(
    44,
    Math.min(items.length > 4 ? 54 : 64, Math.floor((TW - 192) / ((longest + 4.7) * 0.6))),
  );
  const itemAt = (i: number) => 12 + i * 5;
  const start = itemAt(items.length) + 4;
  const step = Math.max(14, Math.floor((showFor - 24 - start) / items.length));
  const sel = Math.max(
    0,
    Math.min(items.length - 1, Math.floor((frame - start) / step)),
  );
  const x = 960 - TW / 2;
  const y = 150;
  const enter = interpolate(frame, [0, 8], [0.92, 1], {
    ...clamp,
    easing: (q) => 1 - (1 - q) ** 3,
  });
  const lineStyle: React.CSSProperties = {
    fontFamily: MONO_FACE,
    fontWeight: 700,
    color: GREEN,
    textShadow: GLOW,
    whiteSpace: "pre",
  };
  return (
    <AbsoluteFill style={{ opacity: dim }}>
      <AbsoluteFill style={{ background: "rgba(2,8,4,0.82)" }} />
      <AbsoluteFill style={{ transform: `scaleY(${enter})` }}>
        <div
          style={{
            position: "absolute",
            left: x - 18,
            top: y - 18,
            width: TW + 36,
            height: TH + 36,
            borderRadius: 60,
            background: "linear-gradient(170deg, #34362f 0%, #171814 100%)",
            boxShadow: "0 30px 90px rgba(0,0,0,0.8)",
          }}
        />
        <Tube x={x} y={y} w={TW} h={TH} radius={46} frame={frame + v * 7}>
          <div
            style={{
              position: "absolute",
              left: 96,
              right: 96,
              top: 72,
              bottom: 72,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {head ? (
              <div style={{ ...lineStyle, fontSize: 44, letterSpacing: 2 }}>
                {typed(head, frame, 3, 4).shown}
              </div>
            ) : null}
            <div
              style={{
                marginTop: head ? 16 : 0,
                height: 4,
                background: GREEN,
                boxShadow: GLOW,
                width: `${interpolate(frame, [4, 12], [0, 100], clamp)}%`,
              }}
            />
            {/* The entries and the prompt, centred in the screen below the header. */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
            <div>
              {items.map((item, i) => {
                const on = frame >= start && i === sel;
                const ty = typed(item, frame, itemAt(i), 5);
                if (frame < itemAt(i))
                  return <div key={i} style={{ height: size * 1.5 }} />;
                return (
                  <div
                    key={i}
                    style={{
                      height: size * 1.5,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        ...lineStyle,
                        fontSize: size,
                        lineHeight: 1.25,
                        padding: `0 ${size * 0.35}px`,
                        background: on ? GREEN : "transparent",
                        color: on ? DARK : GREEN,
                        textShadow: on ? "none" : GLOW,
                        boxShadow: on ? GLOW : "none",
                      }}
                    >
                      {`[ ${ty.shown}${ty.done ? " ]" : ""}`}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                ...lineStyle,
                fontSize: 44,
                marginTop: 18,
                opacity: frame >= start ? 1 : 0,
              }}
            >
              {">"}
              <Cursor size={44} on={Math.floor(frame / 9) % 2 === 0} />
            </div>
            </div>
          </div>
        </Tube>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const FALLOUT: Motif = {
  id: "fallout",
  name: "Fallout phosphor terminal",
  matches: (game) => /\bfallout\b/i.test(`${game.title} ${game.theme ?? ""}`),
  card: FalloutCard,
  styles: {
    Terminal: {
      kind: "list",
      component: TerminalList,
      sound: "glint",
      fits: (g) => {
        const items = g.items.map((x) => x.trim()).filter(Boolean);
        if (items.length < 2 || items.length > 6 || g.primary.length > 40)
          return false;
        // At 44 px the screen holds an entry of 40 characters with its brackets on one line.
        return items.every(
          (x) =>
            x.length <= 40 &&
            fitsAt(displayText(x).toUpperCase(), MONO_METRICS, {
              width: TW - 192,
              height: 60,
              lineHeight: 1.25,
              maxLines: 1,
              maxSize: 44,
              minSize: 44,
              padEm: 4.7,
            }),
        );
      },
    },
  } satisfies Record<string, GfxStyle>,
};
