// The moves a human editor makes and a template never does (owner, 27 Oct 2026: "keep upgrading until
// we're visually unidentifiable from a top human editor"): old footage shown on the TV of its day before
// the camera pushes through the glass, a burst of quick cuts as an entry opens, a letterbox over a
// documentary's cold open, and the story so far pinned to an evidence board between chapters.

import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, HAND } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { TextureBackground } from "./Backgrounds.tsx";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const inOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** The old TV: frames it holds in its room, then the push through the glass. */
export const TV_HOLD = 54;
export const TV_PUSH = 22;
const SCREEN_W = 720; // 4:3, as TVs were
const SCREEN_H = 540;
const SCREEN_CX = 960;
const SCREEN_CY = 470;
/** The zoom at which the screen's picture fills the frame exactly, so the hand-over is seamless. */
const THROUGH = 1920 / SCREEN_W;

/**
 * Footage of a game from before 2006 on a CRT of its day in a dim room: the set switches on (a bright line
 * opening to the picture), holds, then the camera pushes through the glass until the picture is the frame.
 * Widescreen footage sits letterboxed on the 4:3 tube, as it did.
 */
export const RetroTV: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const frame = useCurrentFrame();
  if (frame >= TV_HOLD + TV_PUSH) return <>{children}</>;
  const settle = interpolate(frame, [0, TV_HOLD], [1, 1.05], clamp);
  const t = inOut(
    interpolate(frame, [TV_HOLD, TV_HOLD + TV_PUSH], [0, 1], clamp),
  );
  const z = settle + (THROUGH - settle) * t;
  const glass = 1 - t;
  // Power on: a bright line opens to the full picture.
  const on = interpolate(frame, [3, 13], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const bloom = interpolate(frame, [3, 9, 18], [2.4, 1.6, 1], clamp);
  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        background:
          "radial-gradient(55% 65% at 16% 22%, rgba(255,168,92,0.16) 0%, rgba(255,168,92,0) 70%), linear-gradient(180deg, #1c1815 0%, #14110f 62%, #0c0a09 100%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: `${SCREEN_CX}px ${SCREEN_CY}px`,
          // The screen's centre slides to the frame's as it fills it.
          transform: `translateY(${(540 - SCREEN_CY) * t}px) scale(${z})`,
        }}
      >
        {/* The set's cool light on the wall behind it. */}
        <div
          style={{
            position: "absolute",
            left: SCREEN_CX - 900,
            top: SCREEN_CY - 640,
            width: 1800,
            height: 1280,
            background: `radial-gradient(closest-side, rgba(130,160,220,${0.2 * on}) 0%, rgba(130,160,220,0) 100%)`,
          }}
        />
        {/* The stand it sits on. */}
        <div
          style={{
            position: "absolute",
            left: 260,
            right: 260,
            top: SCREEN_CY + 428,
            height: 260,
            background:
              "linear-gradient(180deg, #4a3322 0%, #3a2819 8%, #2a1d12 40%, #120c08 100%)",
            boxShadow: "0 -2px 0 rgba(255,200,150,0.12)",
          }}
        />
        {/* The cabinet: moulded plastic with a speaker grille, two knobs and a power light. */}
        <div
          style={{
            position: "absolute",
            left: SCREEN_CX - 470,
            top: SCREEN_CY - 330,
            width: 940,
            height: 758,
            borderRadius: 46,
            background:
              "linear-gradient(180deg, #3b3835 0%, #2a2826 50%, #1d1b1a 100%)",
            boxShadow:
              "0 50px 110px rgba(0,0,0,0.75), inset 0 2px 0 rgba(255,255,255,0.09), inset 0 -8px 20px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 70,
              bottom: 34,
              width: 430,
              height: 84,
              borderRadius: 10,
              background:
                "repeating-linear-gradient(90deg, #141312 0px, #141312 5px, #2c2a28 5px, #2c2a28 9px)",
              boxShadow: "inset 0 3px 8px rgba(0,0,0,0.7)",
            }}
          />
          {[640, 760].map((x) => (
            <div
              key={x}
              style={{
                position: "absolute",
                left: x,
                bottom: 42,
                width: 68,
                height: 68,
                borderRadius: 34,
                background:
                  "radial-gradient(circle at 35% 30%, #5c5853 0%, #2b2826 55%, #151413 100%)",
                boxShadow: "0 6px 12px rgba(0,0,0,0.6)",
              }}
            />
          ))}
          <div
            style={{
              position: "absolute",
              left: 862,
              bottom: 70,
              width: 12,
              height: 12,
              borderRadius: 6,
              background: "#ff4a3a",
              boxShadow: `0 0 ${14 * on}px rgba(255,74,58,0.9)`,
            }}
          />
        </div>
        {/* The tube. */}
        <div
          style={{
            position: "absolute",
            left: SCREEN_CX - SCREEN_W / 2,
            top: SCREEN_CY - SCREEN_H / 2,
            width: SCREEN_W,
            height: SCREEN_H,
            borderRadius: `${46 * glass}px / ${38 * glass}px`,
            overflow: "hidden",
            background: "#0d0f0f",
            boxShadow: `0 0 0 16px #121110, 0 0 0 18px #3a3734, 0 0 ${50 * glass * on}px rgba(140,170,230,${0.35 * glass * on})`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 1920,
              height: 1080,
              transform: `translate(-50%, -50%) scale(${1 / THROUGH})`,
              clipPath: `inset(${(1 - on) * 49.6}% 0 ${(1 - on) * 49.6}% 0)`,
              filter: `brightness(${bloom}) saturate(${1 - 0.15 * glass})`,
            }}
          >
            {children}
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0.5 * glass,
              background:
                "repeating-linear-gradient(180deg, rgba(0,0,0,0.38) 0px, rgba(0,0,0,0.38) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: glass,
              background:
                "radial-gradient(115% 105% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.7) 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: glass,
              background:
                "linear-gradient(128deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 26%, rgba(255,255,255,0) 40%)",
            }}
          />
        </div>
      </div>
      {/* A soft flash as the camera passes the glass. */}
      <AbsoluteFill
        style={{
          background: "#e4ecff",
          opacity: interpolate(
            frame,
            [TV_HOLD + TV_PUSH - 7, TV_HOLD + TV_PUSH - 1],
            [0, 0.16],
            clamp,
          ),
        }}
      />
    </AbsoluteFill>
  );
};

export interface MontageItem {
  kind: "clip" | "image";
  src: string;
  /** For footage: the frame of the clip to cut in on (the middle, so the shot after it is still fresh). */
  startFrom?: number;
}
/** Frames each cut of an opening burst lasts. */
export const MONTAGE_CUT = 7;
export const montageFrames = (n: number) => n * MONTAGE_CUT + 4;

const MontageShot: React.FC<{ item: MontageItem; last: boolean }> = ({
  item,
  last,
}) => {
  const frame = useCurrentFrame();
  // Each cut lands a little bright and pushed in, settling as the next one hits.
  const scale = interpolate(frame, [0, MONTAGE_CUT], [1.13, 1.02], clamp);
  const bright = interpolate(frame, [0, 2], [1.45, 1], clamp);
  const opacity = last
    ? interpolate(frame, [MONTAGE_CUT, MONTAGE_CUT + 4], [1, 0], clamp)
    : 1;
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: `scale(${(item.kind === "clip" ? 1.12 : 1) * scale})`,
    filter: `brightness(${bright}) contrast(1.06) saturate(1.08)`,
  };
  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity }}>
      {item.kind === "clip" ? (
        <OffthreadVideo
          src={item.src}
          startFrom={item.startFrom ?? 0}
          muted
          style={style}
        />
      ) : (
        <Img src={item.src} style={style} />
      )}
    </AbsoluteFill>
  );
};

/** A burst of quick cuts from the entry's own footage and pictures as it opens, then its first shot. */
export const Montage: React.FC<{ items: MontageItem[] }> = ({ items }) => (
  <AbsoluteFill>
    {items.map((it, k) => (
      <Sequence
        key={k}
        from={k * MONTAGE_CUT}
        durationInFrames={MONTAGE_CUT + (k === items.length - 1 ? 4 : 0)}
        layout="none"
      >
        <MontageShot item={it} last={k === items.length - 1} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

/** A documentary's cold open in 2.39:1: black bars that draw back as the first chapter begins. */
export const Letterbox: React.FC<{ len: number }> = ({ len }) => {
  const frame = useCurrentFrame();
  const open = interpolate(frame, [len - 26, len - 2], [1, 0], {
    ...clamp,
    easing: (x) => x * x * (3 - 2 * x),
  });
  const h = 138 * open;
  if (h <= 0.5) return null;
  const bar: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    height: h,
    background: "#000",
  };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ ...bar, top: 0 }} />
      <div style={{ ...bar, bottom: 0 }} />
    </AbsoluteFill>
  );
};

/** A red pushpin. */
const Pin: React.FC<{ x: number; y: number; show: number }> = ({
  x,
  y,
  show,
}) => (
  <div
    style={{
      position: "absolute",
      left: x - 15,
      top: y - 15,
      width: 30,
      height: 30,
      borderRadius: 15,
      background:
        "radial-gradient(circle at 35% 30%, #ff8a80 0%, #d7262e 45%, #7c0f14 100%)",
      boxShadow: "3px 6px 6px rgba(0,0,0,0.45)",
      transform: `scale(${show})`,
    }}
  />
);

export interface BoardPicture {
  src: string;
  caption: string;
}

// Where things are pinned: the chapter's card in the middle, pictures around it, the year on a note.
const SLOTS = [
  { x: 150, y: 110, r: -6 },
  { x: 1310, y: 96, r: 5 },
  { x: 1250, y: 610, r: -3 },
];
const CARD = { x: 640, y: 360, w: 640, h: 380, r: -2 };
const NOTE = { x: 250, y: 640, r: 5 };

/**
 * The breather before a chapter as an investigator's board: the chapter's pictures as pinned prints
 * ("EXHIBIT A" unless the picture names who it shows), its title on an index card, the year on a sticky
 * note, red string run between the pins, the camera drifting in.
 */
export const EvidenceBoard: React.FC<{
  number: number;
  title: string;
  game: string;
  year?: string;
  pictures: BoardPicture[];
  frames: number;
  variant?: number;
}> = ({ number, title, game, year, pictures, frames, variant = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pics = pictures.slice(0, SLOTS.length);
  const out = interpolate(frame, [frames - 12, frames], [1, 0], clamp);
  const fadeIn = interpolate(frame, [0, 8], [0, 1], clamp);
  const cam = interpolate(frame, [0, frames], [1.0, 1.07], clamp);
  const pan =
    interpolate(frame, [0, frames], [-14, 14], clamp) * (variant % 2 ? 1 : -1);
  // Things slap onto the board one after another; the string runs once they are up.
  const land = (k: number) =>
    spring({ frame: frame - 3 - k * 5, fps, config: SPRING.POP });
  const pinsAt = (k: number) =>
    spring({ frame: frame - 9 - k * 5, fps, config: SPRING.SNAP });
  const cardPin = { x: CARD.x + CARD.w / 2, y: CARD.y + 14 };
  const picPin = (k: number) => ({ x: SLOTS[k]!.x + 210, y: SLOTS[k]!.y + 14 });
  const notePin = { x: NOTE.x + 120, y: NOTE.y + 12 };
  // The string runs from the card up to the top pictures, then down each side: it never crosses the card.
  const links: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
  if (pics[0]) links.push([cardPin, picPin(0)]);
  if (pics[1]) links.push([cardPin, picPin(1)]);
  if (pics[0] && year) links.push([picPin(0), notePin]);
  if (pics[1] && pics[2]) links.push([picPin(1), picPin(2)]);
  const drawn = (k: number) =>
    interpolate(frame, [22 + k * 6, 46 + k * 6], [0, 1], {
      ...clamp,
      easing: (x) => 1 - (1 - x) ** 2,
    });
  const item = (k: number, r: number): React.CSSProperties => {
    const s = land(k);
    return {
      opacity: Math.min(1, s * 1.6),
      transform: `rotate(${r}deg) scale(${1.22 - 0.22 * s})`,
    };
  };
  return (
    <AbsoluteFill style={{ opacity: fadeIn * out, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${cam}) translateX(${pan}px)` }}>
        <TextureBackground kind="cork" variant={variant} />
        {/* Red string between the pins, sagging a little, drawn on one run at a time; it runs behind the prints. */}
        <svg
          width={1920}
          height={1080}
          style={{ position: "absolute", inset: 0 }}
        >
          {links.map(([a, e], k) => {
            const mx =
              (a.x + e.x) / 2 +
              (Math.abs(e.y - a.y) > Math.abs(e.x - a.x) ? 34 : 0);
            const my = (a.y + e.y) / 2 + 46;
            const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${e.x} ${e.y}`;
            const len = Math.hypot(e.x - a.x, e.y - a.y) * 1.08;
            return (
              <path
                key={k}
                d={d}
                fill="none"
                stroke="#c21f28"
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray={len}
                strokeDashoffset={len * (1 - drawn(k))}
                style={{ filter: "drop-shadow(2px 5px 3px rgba(0,0,0,0.45))" }}
              />
            );
          })}
        </svg>
        {pics.map((p, k) => (
          <div
            key={k}
            style={{
              position: "absolute",
              left: SLOTS[k]!.x,
              top: SLOTS[k]!.y,
              width: 420,
              padding: "18px 18px 0",
              background: "#f3efe6",
              boxShadow: "8px 18px 30px rgba(0,0,0,0.5)",
              ...item(k + 1, SLOTS[k]!.r),
            }}
          >
            <Img
              src={p.src}
              style={{
                width: 384,
                height: 288,
                objectFit: "cover",
                filter: "contrast(1.05) saturate(0.9) sepia(0.12)",
              }}
            />
            <div
              style={{
                height: 74,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: HAND,
                fontSize: p.caption.length > 18 ? 30 : 38,
                color: "#1d1a17",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              {p.caption}
            </div>
          </div>
        ))}
        {year ? (
          <div
            style={{
              position: "absolute",
              left: NOTE.x,
              top: NOTE.y,
              width: 240,
              height: 230,
              background: "linear-gradient(180deg, #ffe873 0%, #f7d94c 100%)",
              boxShadow: "6px 14px 22px rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: HAND,
              fontSize: 84,
              color: "#22201c",
              ...item(pics.length + 1, NOTE.r),
            }}
          >
            {year}
          </div>
        ) : null}
        {/* The chapter's index card: a ruled card with its title in marker. */}
        <div
          style={{
            position: "absolute",
            left: CARD.x,
            top: CARD.y,
            width: CARD.w,
            height: CARD.h,
            background:
              "repeating-linear-gradient(180deg, #fbfaf6 0px, #fbfaf6 47px, #9fc3e6 47px, #9fc3e6 49px)",
            borderTop: "52px solid #fbfaf6",
            boxShadow: "8px 20px 34px rgba(0,0,0,0.5)",
            padding: "0 40px",
            boxSizing: "border-box",
            ...item(0, CARD.r),
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: -52,
              height: 52,
              borderBottom: "3px solid #e2777a",
              padding: "4px 40px 0",
              boxSizing: "border-box",
              fontFamily: HAND,
              fontSize: 34,
              color: "#c4262e",
            }}
          >
            Chapter {number}
          </div>
          <div
            style={{
              fontFamily: HAND,
              fontSize: title.length > 24 ? 50 : 62,
              lineHeight: "98px",
              color: "#1b1916",
              marginTop: 0,
            }}
          >
            {title}
          </div>
          <div
            style={{
              position: "absolute",
              left: 40,
              right: 40,
              bottom: 22,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 22,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: "#5b5650",
            }}
          >
            {game}
          </div>
        </div>
        <Pin x={cardPin.x} y={cardPin.y} show={pinsAt(0)} />
        {pics.map((_, k) => (
          <Pin key={k} x={picPin(k).x} y={picPin(k).y} show={pinsAt(k + 1)} />
        ))}
        {year ? (
          <Pin x={notePin.x} y={notePin.y} show={pinsAt(pics.length + 1)} />
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(85% 75% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 6,
          background: COLOUR.amber,
          transform: `scaleX(${interpolate(frame, [6, 40], [0, 1], clamp)})`,
          transformOrigin: "left",
        }}
      />
    </AbsoluteFill>
  );
};
