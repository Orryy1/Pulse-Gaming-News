// The kinetic-typography styles (31 Oct 2026, the LEMMiNO/Vox technique): a sentence's key words set
// large over a dimmed, slowly moving game backdrop, each landing on the frame the narrator says it.
//   land          words drop into place one by one with weight, the block nudged by each landing
//   scale         the phrase small, then its strongest word scaling up through the frame
//   typeUnderline the line typed out with a caret, then its strongest word underlined by a drawn stroke
//   stack         the words stacked into a justified block, each line sliding in from alternate sides
//   split         the frame split down the middle, the two halves of the line facing off
//   highlight     the line rising in, then a highlighter sweeping across its strongest word
// Every word on screen is one of the sentence's own (./words.ts); sizes come from the measured ladders of
// ../packs/fit.ts so nothing runs past the 60 px safe edge or into the lower third.
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../../brand.ts";
import { SPRING } from "../../motion.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import {
  FRAME_H,
  LOWER_THIRD,
  fitBlock,
  fitSize,
  textWidth,
} from "../packs/fit.ts";
import {
  Backdrop,
  clamp,
  landFrames,
  outro,
  shownWords,
  type KineticProps,
} from "./kit.tsx";

/** The widest a kinetic line may be: well inside the 60 px safe edge. */
const MAX_W = 1600;
/** The text area's vertical centre: a little above the frame's, clear of the lower third. */
const MID_Y = (FRAME_H - LOWER_THIRD) / 2 + 40;
const ANTON_SHADOW = "0 6px 30px rgba(0,0,0,0.65)";

/** Lines of shown words (indices into the shown list) from a greedy wrap of their display strings. */
function lineGroups(words: string[], lines: string[]): number[][] {
  const out: number[][] = [];
  let k = 0;
  for (const line of lines) {
    const n = line.split(/\s+/).filter(Boolean).length;
    out.push(Array.from({ length: n }, (_, j) => k + j));
    k += n;
  }
  // Anything a wrap dropped goes on the last line, so no word is lost.
  while (k < words.length) out[out.length - 1]!.push(k++);
  return out;
}

const useClock = (len: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { frame, fps, out: outro(frame, len) };
};

// ------------------------------------------------------------------------------------------- land

export const Land: React.FC<KineticProps> = ({
  data,
  times,
  len,
  src,
  seed = 0,
}) => {
  const { frame, fps, out } = useClock(len);
  const words = shownWords(data).map((w) => w.toUpperCase());
  const land = landFrames(data, times, fps, len);
  const heroK = data.shown.indexOf(data.hero);
  const fit = fitBlock(words.join(" "), "anton", {
    maxWidth: MAX_W,
    sizes: [250, 220, 196, 172, 150, 130, 112, 96],
    maxLines: 3,
    maxHeight: 700,
    lineHeight: 1.02,
  });
  const groups = lineGroups(words, fit.lines);
  // Each landing nudges the block down a few pixels, settling fast: the weight of the word.
  const thud = land.reduce((a, f) => {
    const dt = frame - f;
    return dt < 0 ? a : a + 9 * Math.exp(-dt / 3.5) * Math.cos(dt / 2.2);
  }, 0);
  return (
    <Backdrop src={src} frame={frame} len={len} seed={seed}>
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", opacity: out }}
      >
        <div
          style={{
            transform: `translateY(${thud - 40}px)`,
            textAlign: "center",
          }}
        >
          {groups.map((g, li) => (
            <div
              key={li}
              style={{
                display: "flex",
                justifyContent: "center",
                gap: fit.size * 0.24,
              }}
            >
              {g.map((k) => {
                const p = spring({
                  frame: frame - land[k]!,
                  fps,
                  config: SPRING.SNAP,
                });
                return (
                  <span
                    key={k}
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: fit.size,
                      lineHeight: 1.02,
                      color: k === heroK ? COLOUR.amber : COLOUR.paper,
                      opacity: interpolate(p, [0, 0.35], [0, 1], clamp),
                      transform: `translateY(${(1 - p) * -60}px) scale(${1.55 - 0.55 * p})`,
                      display: "inline-block",
                      textShadow: ANTON_SHADOW,
                    }}
                  >
                    {words[k]}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ------------------------------------------------------------------------------------------- scale

export const Scale: React.FC<KineticProps> = ({
  data,
  times,
  len,
  src,
  seed = 0,
}) => {
  const { frame, fps, out } = useClock(len);
  const words = shownWords(data);
  const land = landFrames(data, times, fps, len);
  const heroK = data.shown.indexOf(data.hero);
  const hero = words[heroK]!.toUpperCase();
  // The hero grows 12% over the shot after landing, so its size leaves that room inside the safe width.
  const big = fitSize(
    hero,
    "anton",
    MAX_W / 1.12,
    [520, 460, 400, 350, 300, 260, 220, 190],
  ).size;
  const small = fitBlock(words.join(" ").toUpperCase(), "inter", {
    maxWidth: MAX_W,
    sizes: [56, 50, 44, 40, 36],
    maxLines: 2,
    spacing: 6,
  });
  const hl = land[heroK]!;
  const pop = spring({ frame: frame - hl, fps, config: SPRING.ENTER });
  const grow = interpolate(frame, [hl, len], [0, 0.12], clamp);
  const tracking = interpolate(frame, [hl, hl + 30], [0.14, 0.01], clamp);
  return (
    <Backdrop src={src} frame={frame} len={len} seed={seed}>
      <AbsoluteFill style={{ opacity: out }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: MID_Y - big * 0.5 - small.size * 2.4,
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: small.size,
            letterSpacing: 6,
            lineHeight: 1.25,
          }}
        >
          {words.map((w, k) => (
            <span
              key={k}
              style={{
                color: k === heroK ? COLOUR.amber : COLOUR.paper,
                opacity: interpolate(
                  frame,
                  [land[k]!, land[k]! + 6],
                  [0, 1],
                  clamp,
                ),
                textShadow: "0 3px 14px rgba(0,0,0,0.8)",
              }}
            >
              {w.toUpperCase()}
              {k < words.length - 1 ? " " : ""}
            </span>
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: MID_Y - big * 0.5 + small.size * 0.4,
            textAlign: "center",
            fontFamily: DISPLAY,
            fontSize: big,
            lineHeight: 1,
            color: COLOUR.amber,
            letterSpacing: `${tracking}em`,
            opacity: interpolate(pop, [0, 0.3], [0, 1], clamp),
            transform: `scale(${(0.25 + 0.75 * pop) * (1 + grow)})`,
            textShadow:
              "0 10px 60px rgba(255,107,26,0.35), 0 6px 30px rgba(0,0,0,0.7)",
          }}
        >
          {hero}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ------------------------------------------------------------------------------------------- typed + underline

export const TypeUnderline: React.FC<KineticProps> = ({
  data,
  times,
  len,
  src,
  seed = 0,
}) => {
  const { frame, fps, out } = useClock(len);
  const words = shownWords(data);
  const land = landFrames(data, times, fps, len);
  const heroK = data.shown.indexOf(data.hero);
  const fit = fitBlock(words.join(" "), "inter", {
    maxWidth: MAX_W,
    sizes: [132, 118, 104, 92, 80, 70],
    maxLines: 3,
    lineHeight: 1.12,
  });
  const groups = lineGroups(words, fit.lines);
  // Each word types over a few frames from its landing; the next word's landing caps it.
  const typed = (k: number) => {
    const w = words[k]!;
    const span = Math.max(3, Math.min(w.length * 1.2, 10));
    return Math.round(
      interpolate(frame, [land[k]!, land[k]! + span], [0, w.length], clamp),
    );
  };
  const lastDone = Math.max(
    ...land.map((f, k) => f + Math.min(words[k]!.length * 1.2, 10)),
  );
  const under0 = Math.min(lastDone + 6, len - 30);
  const under = interpolate(frame, [under0, under0 + 16], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  // The caret sits after the word being typed, and blinks once the line is done.
  const typing = land.findIndex(
    (f, k) => frame >= f && typed(k) < words[k]!.length,
  );
  const caretK =
    typing >= 0
      ? typing
      : frame >= lastDone
        ? words.length - 1
        : land.findIndex((f) => frame < f) - 1;
  const caretOn = typing >= 0 || Math.floor(frame / 15) % 2 === 0;
  return (
    <Backdrop src={src} frame={frame} len={len} seed={seed}>
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", opacity: out }}
      >
        <div
          style={{
            transform: "translateY(-40px)",
            textAlign: "left",
            maxWidth: MAX_W,
          }}
        >
          {groups.map((g, li) => (
            <div key={li} style={{ whiteSpace: "nowrap" }}>
              {g.map((k) => {
                const w = words[k]!;
                const n = typed(k);
                return (
                  <span
                    key={k}
                    style={{
                      position: "relative",
                      display: "inline-block",
                      marginRight: k < words.length - 1 ? fit.size * 0.27 : 0,
                      fontFamily: BODY,
                      fontWeight: 900,
                      fontSize: fit.size,
                      lineHeight: 1.12,
                      color: COLOUR.paper,
                      textShadow: "0 4px 22px rgba(0,0,0,0.75)",
                    }}
                  >
                    <span>{w.slice(0, n)}</span>
                    <span style={{ color: "transparent", textShadow: "none" }}>
                      {w.slice(n)}
                    </span>
                    {k === caretK && caretOn && frame >= land[0]! ? (
                      <span
                        style={{
                          position: "absolute",
                          top: "12%",
                          height: "78%",
                          width: Math.max(6, fit.size * 0.07),
                          background: COLOUR.amber,
                          left: `${(n / Math.max(1, w.length)) * 100}%`,
                          marginLeft: 6,
                        }}
                      />
                    ) : null}
                    {k === heroK ? (
                      // A marker stroke drawn left to right under the word (a scaled bar: an SVG
                      // dash pattern stretched with the word broke into dashes in the first stills).
                      <span
                        style={{
                          position: "absolute",
                          left: "-3%",
                          width: "106%",
                          bottom: -fit.size * 0.06,
                          height: Math.max(8, fit.size * 0.09),
                          borderRadius: 999,
                          background: COLOUR.amber,
                          transformOrigin: "left center",
                          transform: `rotate(-1.2deg) scaleX(${under})`,
                          boxShadow: "0 4px 18px rgba(255,107,26,0.35)",
                        }}
                      />
                    ) : null}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ------------------------------------------------------------------------------------------- stack

/** The stack's line sizes: each word sized to the block width, capped, the block shrunk to fit the height. */
export function stackSizes(
  words: string[],
  width = 1180,
  maxH = 760,
): { sizes: number[]; width: number } {
  const at1 = words.map((w) =>
    Math.max(1, textWidth(w.toUpperCase(), "anton", 1)),
  );
  let wdt = width;
  for (let pass = 0; pass < 8; pass++) {
    const sizes = at1.map((x) => Math.min(300, Math.floor(wdt / x)));
    const h = sizes.reduce((a, s) => a + s * 0.94, 0);
    if (h <= maxH) return { sizes, width: wdt };
    wdt *= maxH / h;
  }
  return {
    sizes: at1.map((x) => Math.min(300, Math.floor(wdt / x))),
    width: wdt,
  };
}

export const Stack: React.FC<KineticProps> = ({
  data,
  times,
  len,
  src,
  seed = 0,
}) => {
  const { frame, fps, out } = useClock(len);
  const words = shownWords(data).map((w) => w.toUpperCase());
  const land = landFrames(data, times, fps, len);
  const heroK = data.shown.indexOf(data.hero);
  const { sizes, width } = stackSizes(words);
  const rule = interpolate(
    frame,
    [land[0]!, land[land.length - 1]! + 10],
    [0, 1],
    clamp,
  );
  return (
    <Backdrop src={src} frame={frame} len={len} seed={seed}>
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", opacity: out }}
      >
        <div
          style={{
            position: "relative",
            width,
            transform: "translateY(-40px)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -36,
              top: 8,
              width: 10,
              height: `${rule * 100}%`,
              background: COLOUR.amber,
            }}
          />
          {words.map((w, k) => {
            const p = spring({
              frame: frame - land[k]!,
              fps,
              config: SPRING.POP,
            });
            const side = (k + seed) % 2 === 0 ? -1 : 1;
            return (
              <div
                key={k}
                style={{
                  fontFamily: DISPLAY,
                  fontSize: sizes[k],
                  lineHeight: 0.94,
                  whiteSpace: "nowrap",
                  color: k === heroK ? COLOUR.amber : COLOUR.paper,
                  opacity: interpolate(p, [0, 0.3], [0, 1], clamp),
                  transform: `translateX(${(1 - p) * side * 140}px)`,
                  textShadow: ANTON_SHADOW,
                }}
              >
                {w}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

// ------------------------------------------------------------------------------------------- split

export const Split: React.FC<KineticProps> = ({
  data,
  times,
  len,
  src,
  seed = 0,
}) => {
  const { frame, fps, out } = useClock(len);
  const words = shownWords(data).map((w) => w.toUpperCase());
  const land = landFrames(data, times, fps, len);
  const cut = data.split ?? Math.ceil(words.length / 2);
  const halves = [words.slice(0, cut), words.slice(cut)];
  const divider = interpolate(frame, [0, 16], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const half = (ws: string[]) =>
    fitBlock(ws.join(" "), "anton", {
      maxWidth: 720,
      sizes: [210, 186, 164, 146, 128, 112, 96, 84],
      maxLines: 3,
      maxHeight: 640,
      lineHeight: 1.02,
    });
  const fits = halves.map(half);
  // Both halves share the smaller size, so neither side shouts over the other.
  const size = Math.min(fits[0]!.size, fits[1]!.size);
  return (
    <Backdrop src={src} frame={frame} len={len} seed={seed} dim={0.3}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 960,
          height: FRAME_H,
          backdropFilter: "grayscale(1) brightness(0.8)",
          background: "rgba(11,11,14,0.25)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 0,
          width: 960,
          height: FRAME_H,
          background: "rgba(255,107,26,0.09)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 957,
          top: 90,
          width: 6,
          height: (FRAME_H - 180) * divider,
          background: COLOUR.amber,
          boxShadow: "0 0 24px rgba(255,107,26,0.6)",
        }}
      />
      <AbsoluteFill style={{ opacity: out }}>
        {halves.map((ws, h) => {
          const first = h === 0 ? 0 : cut;
          const p = spring({
            frame: frame - land[first]!,
            fps,
            config: SPRING.ENTER,
          });
          const lines = fitBlock(ws.join(" "), "anton", {
            maxWidth: 720,
            sizes: [size],
            maxLines: 3,
          }).lines;
          let k = first;
          return (
            <div
              key={h}
              style={{
                position: "absolute",
                top: 0,
                height: FRAME_H - LOWER_THIRD + 40,
                left: h === 0 ? 120 : 1080,
                width: 720,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: h === 0 ? "flex-end" : "flex-start",
                textAlign: h === 0 ? "right" : "left",
                transform: `translateX(${(1 - p) * (h === 0 ? -80 : 80)}px)`,
              }}
            >
              {lines.map((line, li) => (
                <div key={li} style={{ whiteSpace: "nowrap" }}>
                  {line.split(" ").map((w, j) => {
                    const idx = k++;
                    return (
                      <span
                        key={j}
                        style={{
                          fontFamily: DISPLAY,
                          fontSize: size,
                          lineHeight: 1.02,
                          color: h === 0 ? COLOUR.paper : COLOUR.amber,
                          opacity: interpolate(
                            frame,
                            [land[idx] ?? 0, (land[idx] ?? 0) + 6],
                            [0, 1],
                            clamp,
                          ),
                          textShadow: ANTON_SHADOW,
                        }}
                      >
                        {w}
                        {j < line.split(" ").length - 1 ? " " : ""}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </AbsoluteFill>
    </Backdrop>
  );
};

// ------------------------------------------------------------------------------------------- highlight

export const Highlight: React.FC<KineticProps> = ({
  data,
  times,
  len,
  src,
  seed = 0,
}) => {
  const { frame, fps, out } = useClock(len);
  const words = shownWords(data);
  const land = landFrames(data, times, fps, len);
  const heroK = data.shown.indexOf(data.hero);
  const fit = fitBlock(words.join(" "), "inter", {
    maxWidth: MAX_W - 80,
    sizes: [128, 114, 100, 88, 78, 68],
    maxLines: 3,
    lineHeight: 1.18,
  });
  const groups = lineGroups(words, fit.lines);
  const s0 = land[heroK]! + 4;
  const sweep = interpolate(frame, [s0, s0 + 12], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 2,
  });
  return (
    <Backdrop src={src} frame={frame} len={len} seed={seed}>
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", opacity: out }}
      >
        <div style={{ transform: "translateY(-40px)", textAlign: "center" }}>
          {groups.map((g, li) => (
            <div key={li} style={{ whiteSpace: "nowrap" }}>
              {g.map((k) => {
                const p = spring({
                  frame: frame - land[k]!,
                  fps,
                  config: SPRING.ENTER,
                });
                const isHero = k === heroK;
                const style: React.CSSProperties = {
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize: fit.size,
                  lineHeight: 1.18,
                };
                return (
                  <span
                    key={k}
                    style={{
                      position: "relative",
                      display: "inline-block",
                      marginRight: k < words.length - 1 ? fit.size * 0.26 : 0,
                      opacity: interpolate(p, [0, 0.4], [0, 1], clamp),
                      transform: `translateY(${(1 - p) * 34}px)`,
                    }}
                  >
                    {isHero ? (
                      <span
                        style={{
                          position: "absolute",
                          // Padding in pixels, not percent: a short word like "plan" needs as much
                          // margin as a long one, and the skew pulls the bottom corner inwards.
                          left: -fit.size * 0.14,
                          top: "12%",
                          height: "80%",
                          width: `calc((100% + ${fit.size * 0.28}px) * ${sweep})`,
                          background: COLOUR.amber,
                          transform: "skewX(-8deg)",
                          borderRadius: 6,
                        }}
                      />
                    ) : null}
                    <span
                      style={{
                        ...style,
                        position: "relative",
                        color: COLOUR.paper,
                        textShadow: "0 4px 22px rgba(0,0,0,0.75)",
                      }}
                    >
                      {words[k]}
                    </span>
                    {isHero ? (
                      // The swept part of the word turns ink, so it reads on the amber.
                      <span
                        style={{
                          ...style,
                          position: "absolute",
                          left: 0,
                          top: 0,
                          color: COLOUR.ink,
                          clipPath: `inset(0 ${100 - 100 * sweep}% 0 0)`,
                        }}
                      >
                        {words[k]}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
