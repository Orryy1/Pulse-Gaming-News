// The documentary evidence board style (EVIDENCE_STYLE; planned by src/evidencestyle.ts, shaped by
// src/render/evidenceboard.ts). Two layers, both drawn only when a plan is passed, so a video without one renders
// exactly as before:
//   BoardMode   the still shots of a mystery or lore episode played pinned to a cork board: old prints, red string
//               drawing on between them as the narration links them, the camera moving pin to pin;
//   BoardMarks  the cards and stamps over whatever is on screen: the big date card, the typed case card and the red
//               rubber stamp that lands with a small shake and the stamp's sound.
// Pulse's palette and type: Anton for the figures and stamps, Inter typed on letter by letter for the read text.

import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { Pin } from "./EditorMoves.tsx";
import { inKey, leadFrames, LEVEL, foleyLevel } from "../soundscape.ts";
import {
  BOARD_GEOMETRY,
  SHAKE_FRAMES,
  boardCamera,
  pinSpots,
  seeded,
  stringDrawn,
  type BoardCase,
  type BoardDate,
  type BoardFrame,
  type BoardStamp,
  type BoardWindow,
  type EvidenceBoardPlan,
} from "../evidenceboard.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const resolve = (src: string) =>
  /^(https?:|data:|blob:)/.test(src) ? src : staticFile(src);
/** The stamp's red: Pulse's alert red, a shade deeper as ink on paper. */
const STAMP_RED = COLOUR.alert;
const STRING_RED = "#c21f28";

/** The cork, one surface the size of the board, so it travels with the camera. */
const Cork: React.FC<{ w: number; h: number; seed: number }> = ({
  w,
  h,
  seed,
}) => {
  const id = `evcork${seed % 997}`;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: w,
        height: h,
        background: "#6a4a2c",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={`0 0 ${w / 2} ${h / 2}`}
        preserveAspectRatio="none"
        width={w / 2}
        height={h / 2}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: w,
          height: h,
          opacity: 0.8,
          mixBlendMode: "multiply",
        }}
      >
        <filter id={id} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.16"
            numOctaves={2}
            seed={seed % 97}
            result="n"
          />
          <feDiffuseLighting
            in="n"
            lightingColor="#ffffff"
            surfaceScale={3}
            result="lit"
          >
            <feDistantLight azimuth={225} elevation={48} />
          </feDiffuseLighting>
          <feColorMatrix in="lit" type="saturate" values="0" />
        </filter>
        <rect width={w / 2} height={h / 2} filter={`url(#${id})`} />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(25,14,6,0.38)",
        }}
      />
    </div>
  );
};

/** One print pinned to the board: an old photo's white border, a faded grade, its number typed under it. */
const Print: React.FC<{
  src: string;
  width: number;
  n: number;
  land: number;
  pinShow: number;
}> = ({ src, width, n, land, pinShow }) => {
  const pad = Math.round(width * 0.04);
  const picH = Math.round((width - pad * 2) * 0.66);
  return (
    <div
      style={{
        position: "relative",
        width,
        padding: `${pad}px ${pad}px 0`,
        background: "#efe9dc",
        boxShadow: "10px 22px 34px rgba(0,0,0,0.55)",
        opacity: Math.min(1, land * 1.6),
        transform: `scale(${1.18 - 0.18 * land})`,
        boxSizing: "border-box",
      }}
    >
      <Img
        src={resolve(src)}
        style={{
          display: "block",
          width: width - pad * 2,
          height: picH,
          objectFit: "cover",
          filter: "contrast(1.06) saturate(0.78) sepia(0.22)",
        }}
      />
      <div
        style={{
          height: Math.round(width * 0.11),
          display: "flex",
          alignItems: "center",
          paddingLeft: 4,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: Math.round(width * 0.045),
          letterSpacing: 6,
          color: "#3a342c",
        }}
      >
        {String(n).padStart(2, "0")}
      </div>
      <Pin x={width / 2} y={pad * 0.6} show={pinShow} />
    </div>
  );
};

const BoardWindowView: React.FC<{
  plan: EvidenceBoardPlan;
  win: BoardWindow;
  images: Array<{ src: string }>;
}> = ({ plan, win, images }) => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = local + win.from;
  const g = BOARD_GEOMETRY[plan.frame];
  const spots = useMemo(
    () => pinSpots(plan.pins.length, plan.frame, plan.seed),
    [plan.pins.length, plan.frame, plan.seed],
  );
  const last = win.pins.reduce(
    (m, k) => (plan.pins[k]!.from <= f ? k : m),
    win.pins[0]!,
  );
  // The story so far: every pin up to the current one, from earlier windows too.
  // At most the last ten: enough for the story so far around the camera, light enough to render.
  const shown = plan.pins
    .map((p, k) => ({ p, k }))
    // Only pins the viewer saw land: a window the composition dropped takes its pins with it.
    .filter(({ k }) => k <= last && k > last - 10 && plan.windows.some((x) => x.pins.includes(k)));
  const cam = boardCamera(f, win, plan.pins, spots, plan.frame);
  const len = win.to - win.from;
  const fade = interpolate(local, [0, 6, len - 6, len], [0, 1, 1, 0], clamp);
  const landOf = (from: number) =>
    from < win.from
      ? 1
      : spring({
          frame: f - from,
          fps,
          config: { damping: 14, stiffness: 220, mass: 0.6 },
        });
  const pinOf = (from: number) =>
    from < win.from
      ? 1
      : spring({
          frame: f - from - 6,
          fps,
          config: { damping: 12, stiffness: 320, mass: 0.5 },
        });
  return (
    <AbsoluteFill
      style={{ opacity: fade, overflow: "hidden", background: "#3b2918" }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: g.w,
          height: g.h,
          transformOrigin: "0 0",
          transform: `translate(${g.viewW / 2 - cam.x * cam.zoom}px, ${g.centreY - cam.y * cam.zoom}px) scale(${cam.zoom})`,
        }}
      >
        <Cork w={g.w} h={g.h} seed={plan.seed} />
        {/* Red string from each pin to the one before, sagging a little, drawn on as the narration links them. */}
        <svg
          width={g.w}
          height={g.h}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          {shown.slice(1).map(({ p, k }, j) => {
            // From the pin shown before it (a dropped window's pins are never strung to).
            const a = spots[shown[j]!.k]!;
            const e = spots[k]!;
            const ay = a.y - g.print * 0.36;
            const ey = e.y - g.print * 0.36;
            const d = `M ${a.x} ${ay} Q ${(a.x + e.x) / 2} ${(ay + ey) / 2 + 60} ${e.x} ${ey}`;
            const L = Math.hypot(e.x - a.x, ey - ay) * 1.1;
            const drawn =
              p.stringAt < win.from ? 1 : stringDrawn(f, p.stringAt);
            return (
              <path
                key={k}
                d={d}
                fill="none"
                stroke={STRING_RED}
                strokeWidth={7}
                strokeLinecap="round"
                strokeDasharray={L}
                strokeDashoffset={L * (1 - drawn)}
                style={{ filter: "drop-shadow(3px 7px 4px rgba(0,0,0,0.45))" }}
              />
            );
          })}
        </svg>
        {shown.map(({ p, k }) => {
          const s = spots[k]!;
          const im = images[p.image];
          if (!im) return null;
          return (
            <div
              key={k}
              style={{
                position: "absolute",
                left: s.x - g.print / 2,
                top: s.y - g.print * 0.4,
                transform: `rotate(${s.r}deg)`,
              }}
            >
              <Print
                src={im.src}
                width={g.print}
                n={k + 1}
                land={landOf(p.from)}
                pinShow={pinOf(p.from)}
              />
            </div>
          );
        })}
      </div>
      {/* A warm lamp over the board, darker at the edges. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(75% 65% at 50% 45%, rgba(255,214,150,0.08) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.6) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Board mode: each window of still shots played on the board. Pins land with the pin's own small sound (the foley
 * kit, public/sfx/foley/pin). Nothing at all without a plan in board mode.
 */
export const BoardMode: React.FC<{
  plan: EvidenceBoardPlan | undefined;
  images: Array<{ src: string }>;
  sound?: boolean;
}> = ({ plan, images, sound = true }) => {
  if (!plan?.mode || !plan.windows.length) return null;
  const level =
    plan.frame === "long"
      ? foleyLevel("foley/pin")
      : foleyLevel("foley/pin") * 1.26;
  return (
    <>
      {plan.windows.map((w, i) => (
        <Sequence
          key={`evw${i}`}
          from={w.from}
          durationInFrames={Math.max(1, w.to - w.from)}
          layout="none"
        >
          <BoardWindowView plan={plan} win={w} images={images} />
        </Sequence>
      ))}
      {sound
        ? plan.pins.map((p, k) =>
            plan.windows.some((w) => p.from >= w.from && p.from < w.to) ? (
              <Sequence
                key={`evpin${k}`}
                from={p.from + 6}
                durationInFrames={30}
                layout="none"
              >
                <Audio src={staticFile("sfx/foley/pin.mp3")} volume={level} />
              </Sequence>
            ) : null,
          )
        : null}
    </>
  );
};

/** Text typed on letter by letter, with the carriage's block cursor while it types. */
const Typed: React.FC<{
  text: string;
  perFrame?: number;
  delay?: number;
  style: React.CSSProperties;
}> = ({ text, perFrame = 1.4, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const n = Math.max(
    0,
    Math.min(text.length, Math.floor((frame - delay) * perFrame)),
  );
  const typing = n < text.length;
  return (
    <span style={{ ...style, whiteSpace: "pre-wrap" }}>
      {text.slice(0, n)}
      {typing && frame >= delay ? (
        <span style={{ display: "inline-block", position: "relative", width: 0, height: "1em" }}>
          <span
            style={{
              position: "absolute",
              left: 2,
              top: "0.05em",
              width: "0.5em",
              height: "0.9em",
              background: style.color,
            }}
          />
        </span>
      ) : null}
      <span style={{ visibility: "hidden" }}>{text.slice(n)}</span>
    </span>
  );
};

/** Ink as typed on old paper: a hair of bleed. */
const INK: React.CSSProperties = { textShadow: "0 0 1px rgba(30,24,18,0.55)" };

const DateCard: React.FC<{ d: BoardDate; frame: BoardFrame }> = ({
  d,
  frame: layout,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const land = spring({
    frame,
    fps,
    config: { damping: 13, stiffness: 240, mass: 0.6 },
  });
  const out = interpolate(frame, [d.frames - 8, d.frames], [1, 0], clamp);
  const tall = layout === "short";
  const big = d.big.length > 2 ? (tall ? 190 : 170) : tall ? 260 : 220;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: tall ? 70 : 110,
          top: tall ? 330 : 150,
          padding: tall ? "26px 46px 30px" : "22px 40px 26px",
          minWidth: tall ? 360 : 320,
          background: "#efe6d2",
          boxShadow: "10px 22px 36px rgba(0,0,0,0.55)",
          transform: `translateY(${(1 - land) * -90}px) rotate(${-4 + (1 - land) * 6}deg)`,
          opacity: Math.min(1, land * 1.8) * out,
          textAlign: "center",
          boxSizing: "border-box",
        }}
      >
        <Pin x={(tall ? 360 : 320) / 2} y={12} show={land} />
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: big,
            lineHeight: 1,
            color: COLOUR.ink,
            letterSpacing: 2,
          }}
        >
          {d.big}
        </div>
        <div
          style={{ height: 6, background: STAMP_RED, margin: "10px 6px 14px" }}
        />
        {d.sub ? (
          <Typed
            text={d.sub}
            delay={8}
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: tall ? 46 : 40,
              letterSpacing: 8,
              color: "#2a241d",
              ...INK,
            }}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const CaseCard: React.FC<{ c: BoardCase; frame: BoardFrame }> = ({
  c,
  frame: layout,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const land = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 200, mass: 0.7 },
  });
  const out = interpolate(frame, [c.frames - 8, c.frames], [1, 0], clamp);
  const tall = layout === "short";
  const size = tall
    ? c.topic.length > 22
      ? 50
      : 58
    : c.topic.length > 26
      ? 40
      : 46;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: tall ? 60 : 110,
          top: tall ? 290 : 130,
          width: tall ? 960 : 1000,
          padding: tall ? "26px 40px 34px" : "22px 36px 28px",
          background:
            "repeating-linear-gradient(180deg, #f6f1e4 0px, #f6f1e4 62px, #c9d8e8 62px, #c9d8e8 64px)",
          borderTop: `14px solid ${STAMP_RED}`,
          boxShadow: "10px 22px 36px rgba(0,0,0,0.55)",
          transform: `translateX(${(1 - land) * -120}px) rotate(-1.5deg)`,
          opacity: Math.min(1, land * 1.8) * out,
          boxSizing: "border-box",
        }}
      >
        <Typed
          text={`CASE: ${c.topic}`}
          delay={4}
          perFrame={1.1}
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1.25,
            letterSpacing: 4,
            color: "#1f1a15",
            ...INK,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const StampMark: React.FC<{
  s: BoardStamp;
  frame: BoardFrame;
  seed: number;
}> = ({ s, frame: layout, seed }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hit = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 520, mass: 0.5 },
  });
  const scale = interpolate(hit, [0, 1], [1.9, 1]);
  const out = interpolate(frame, [s.frames - 8, s.frames], [1, 0], clamp);
  // The landing shake: a few decaying jolts once the stamp is down.
  const rnd = seeded(seed + s.from);
  const jolts = Array.from({ length: SHAKE_FRAMES }, () => [
    rnd() - 0.5,
    rnd() - 0.5,
  ]);
  const k = frame - 4;
  const decay = k >= 0 && k < SHAKE_FRAMES ? 1 - k / SHAKE_FRAMES : 0;
  const [jx = 0, jy = 0] = k >= 0 && k < SHAKE_FRAMES ? jolts[k]! : [0, 0];
  const tall = layout === "short";
  const size = tall
    ? s.text.length > 12
      ? 104
      : 128
    : s.text.length > 12
      ? 96
      : 116;
  const id = `evstamp${(seed + s.from) % 9973}`;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id={id}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves={2}
            seed={(seed + s.from) % 97}
            result="n"
          />
          <feColorMatrix
            in="n"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 1.7"
            result="holes"
          />
          <feComposite
            in="SourceGraphic"
            in2="holes"
            operator="in"
            result="inked"
          />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05"
            numOctaves={1}
            seed={(seed + s.from + 7) % 97}
            result="w"
          />
          <feDisplacementMap in="inked" in2="w" scale={5} />
        </filter>
      </svg>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: tall ? 640 : undefined,
          bottom: tall ? undefined : 230,
          display: "flex",
          justifyContent: tall ? "center" : "flex-end",
          paddingRight: tall ? 0 : 150,
        }}
      >
        <div
          style={{
            transform: `translate(${jx * 22 * decay}px, ${jy * 22 * decay}px) rotate(-8deg) scale(${scale})`,
            opacity: Math.min(1, hit * 1.6) * out,
            filter: `url(#${id})`,
            border: `10px solid ${STAMP_RED}`,
            outline: `4px solid ${STAMP_RED}`,
            outlineOffset: 8,
            borderRadius: 10,
            padding: `${Math.round(size * 0.06)}px ${Math.round(size * 0.26)}px ${Math.round(size * 0.02)}px`,
            fontFamily: DISPLAY,
            fontSize: size,
            lineHeight: 1.08,
            letterSpacing: 4,
            color: STAMP_RED,
            whiteSpace: "nowrap",
          }}
        >
          {s.text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/**
 * The cards and stamps over the picture: each on its spoken word, with its sound (the stamp's landing, the case
 * card's typewriter, from Pulse's own sets), the long videos 2 dB quieter as their mix is. Nothing without a plan.
 */
export const BoardMarks: React.FC<{
  plan: EvidenceBoardPlan | undefined;
  musicSrc?: string | null;
  sound?: boolean;
}> = ({ plan, musicSrc, sound = true }) => {
  // No hooks here, so it answers null outright without a plan (both compositions run at 30 fps, as the plan does).
  if (!plan) return null;
  const fps = 30;
  const long = plan.frame === "long";
  const land = long ? LEVEL.landLong : LEVEL.land;
  const typing = long
    ? foleyLevel("foley/typewriter")
    : foleyLevel("foley/typewriter") * 1.26;
  return (
    <>
      {plan.dates.map((d, i) => (
        <Sequence
          key={`evd${i}`}
          from={d.from}
          durationInFrames={d.frames}
          layout="none"
        >
          <DateCard d={d} frame={plan.frame} />
        </Sequence>
      ))}
      {plan.cases.map((c, i) => (
        <React.Fragment key={`evc${i}`}>
          <Sequence from={c.from} durationInFrames={c.frames} layout="none">
            <CaseCard c={c} frame={plan.frame} />
          </Sequence>
          {sound ? (
            <Sequence from={c.from + 4} durationInFrames={60} layout="none">
              <Audio
                src={staticFile("sfx/foley/typewriter.mp3")}
                volume={typing}
              />
            </Sequence>
          ) : null}
        </React.Fragment>
      ))}
      {plan.stamps.map((s, i) => (
        <React.Fragment key={`evs${i}`}>
          <Sequence from={s.from} durationInFrames={s.frames} layout="none">
            <StampMark s={s} frame={plan.frame} seed={plan.seed} />
          </Sequence>
          {sound ? (
            <Sequence
              from={Math.max(0, s.from + 3 - leadFrames("v3/land", fps))}
              durationInFrames={60}
              layout="none"
            >
              <Audio
                src={staticFile(inKey("sfx/v3/land.mp3", musicSrc))}
                volume={land}
              />
            </Sequence>
          ) : null}
        </React.Fragment>
      ))}
    </>
  );
};
