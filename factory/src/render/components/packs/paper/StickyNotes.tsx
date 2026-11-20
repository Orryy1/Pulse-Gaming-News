// Paper/StickyNotes: a list as sticky notes slapped onto a cork board one after another, each written in
// marker, under the heading on a pinned index card. Tilts, colours and offsets are seeded from the
// variant, so two boards never match; the camera drifts in slowly while it holds.

import React from "react";
import { Easing, interpolate, spring } from "remotion";
import { HAND } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import { GRAIN, INK, Pin, clamp, clean, handFit, jit, rnd } from "./kit.tsx";

/** Note colours: classic yellow, the brand's orange, a pale lemon and a soft pink, each with a deeper top strip. */
const NOTES = [
  { face: "#ffe45a", glue: "#f5d03a" },
  { face: "#ffa654", glue: "#f88f38" },
  { face: "#fff07e", glue: "#f6df58" },
  { face: "#ff9fbd", glue: "#f585a8" },
];

const items = (g: MomentGraphic) => g.items.map(clean).filter(Boolean);

export function fitsStickyNotes(g: MomentGraphic): boolean {
  const list = items(g);
  const head = clean(g.primary);
  return (
    list.length >= 2 &&
    list.length <= 5 &&
    list.every((x) => x.length <= 40) &&
    head.length <= 40
  );
}

/** Note size by count: one row, inside the 96 px side margins. */
const SIZE: Record<number, number> = { 2: 440, 3: 400, 4: 350, 5: 300 };
const GAPS: Record<number, number> = { 2: 90, 3: 60, 4: 46, 5: 40 };

export const StickyNotes: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
}) => {
  const list = items(g).slice(0, 5);
  const { frame, fps, showFor, dim, visible } = useStage(
    len,
    170 + list.length * 8,
  );
  if (!visible || !fitsStickyNotes(g)) return null;
  const head = clean(g.primary);
  const seed = 101 + variant * 17;
  const n = list.length;
  const size = SIZE[n] ?? 300;
  const gap = GAPS[n] ?? 40;
  const rowW = n * size + (n - 1) * gap;

  const cam = interpolate(frame, [0, showFor], [1, 1.045], clamp);
  const pan =
    interpolate(frame, [0, showFor], [-12, 12], clamp) * (variant % 2 ? 1 : -1);
  const out = interpolate(frame, [showFor - 14, showFor], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  const card = spring({ frame: frame - 3, fps, config: SPRING.POP });
  const pin = spring({ frame: frame - 11, fps, config: SPRING.SNAP });
  const headSize = handFit(head, 760, 92, 76, 44);
  const hasHead = Boolean(head);
  // The first note lands at 16, then one every 9 frames or so: all up by about frame 60.
  const landAt = (i: number) =>
    (hasHead ? 16 : 6) + i * Math.min(10, 44 / Math.max(1, n - 1));
  const rowTop = hasHead ? 430 : 300;
  // One marker size for every note, so the list reads as one hand: the size the longest item allows.
  const font = Math.min(
    ...list.map((t) => handFit(t, size - 64, size - 90, n >= 5 ? 56 : 66, 30)),
  );

  return (
    <Stage dim={dim} bg={bg ?? "cork"} variant={variant}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${cam + 0.015 * out}) translateX(${pan}px)`,
        }}
      >
        {hasHead ? (
          <div
            style={{
              position: "absolute",
              left: 960 - 420,
              top: 150,
              width: 840,
              opacity: Math.min(1, card * 2),
              transform: `rotate(${(variant % 2 ? 1.2 : -1.4) + 0.6 * jit(seed, 1)}deg) scale(${1.18 - 0.18 * card}) translateY(${(1 - card) * -30}px)`,
            }}
          >
            <div
              style={{
                position: "relative",
                height: 200,
                // The marker's baseline sits 0.92 em into its line: rest the heading on the first blue rule.
                padding: `${Math.round(142 - 0.92 * headSize)}px 40px 0`,
                boxSizing: "border-box",
                backgroundColor: "#fbfaf5",
                backgroundImage: `${GRAIN}, linear-gradient(180deg, transparent 0 40px, #e2777a 40px 43px, transparent 43px 144px, #9fc3e6 144px 146px, transparent 146px 192px, #9fc3e6 192px 194px, transparent 194px)`,
                boxShadow:
                  "0 2px 3px rgba(0,0,0,0.3), 8px 22px 34px rgba(0,0,0,0.5)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: HAND,
                  fontSize: headSize,
                  lineHeight: 1.05,
                  color: INK,
                  whiteSpace: "nowrap",
                }}
              >
                {head}
              </div>
            </div>
            <Pin show={pin} style={{ left: 420, top: 22 }} />
          </div>
        ) : null}
        {list.map((text, i) => {
          const s = spring({
            frame: frame - landAt(i),
            fps,
            config: SPRING.POP,
          });
          const lift = 1 - Math.min(1, s);
          const c =
            NOTES[
              (Math.floor(rnd(seed, 30) * NOTES.length) + i) % NOTES.length
            ]!;
          const tilt =
            (i % 2 ? 1 : -1) *
            (1.5 + 3 * rnd(seed, 10 + i)) *
            (variant % 2 ? -1 : 1);
          const x = 960 - rowW / 2 + i * (size + gap) + 14 * jit(seed, 20 + i);
          const y =
            rowTop + 46 * jit(seed, 40 + i) + (n > 3 ? (i % 2 ? 34 : -10) : 0);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: size,
                height: size,
                opacity: s > 0.02 ? Math.min(1, s * 3) : 0,
                transform: `translateY(${lift * -70}px) rotate(${tilt + lift * 9}deg) scale(${1 + 0.32 * lift})`,
              }}
            >
              {/* The shadow: soft and wide while the note is in the air, tight once it sticks, deeper under the curl. */}
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  right: 10,
                  top: 30,
                  bottom: 6,
                  // A box-shadow, not a blur filter: the box itself sits hidden under the note.
                  boxShadow: `${8 + 30 * lift}px ${14 + 50 * lift}px ${16 + 36 * lift}px rgba(0,0,0,${0.5 - 0.2 * lift})`,
                  borderRadius: "4px 4px 30px 18px",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundColor: c.face,
                  backgroundImage: `${GRAIN}, linear-gradient(180deg, ${c.glue} 0%, ${c.face} 18%, ${c.face} 82%, rgba(255,255,255,0.35) 94%, rgba(0,0,0,0.06) 100%), linear-gradient(100deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0) 20%, rgba(255,255,255,0.18) 60%, rgba(0,0,0,0.06) 100%)`,
                  boxShadow: "0 1px 1px rgba(0,0,0,0.25)",
                  borderRadius: "1px 1px 3px 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "40px 32px 46px",
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    fontFamily: HAND,
                    fontSize: font,
                    lineHeight: 1.12,
                    color: INK,
                    textAlign: "center",
                    transform: `rotate(${-1.5 * jit(seed, 60 + i)}deg)`,
                  }}
                >
                  {text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Stage>
  );
};
