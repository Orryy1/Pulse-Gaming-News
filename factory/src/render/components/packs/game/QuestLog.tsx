// Game pack: a list as an RPG-style quest log. A framed panel opens from a line, the quest title sits
// in its header, and each objective slides in and is ticked in turn with a small flash while a cursor
// steps down the list. An original panel design, not any real game's journal.
import React from "react";
import { interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import {
  bySize,
  chamferPoints,
  clamp,
  clean,
  easeOut,
  wordCount,
} from "./kit.tsx";

const objectives = (items: string[]) => items.map(clean).filter(Boolean);

export function fitsQuestLog(g: MomentGraphic): boolean {
  const items = objectives(g.items);
  const title = clean(g.primary);
  return (
    items.length >= 2 &&
    items.length <= 5 &&
    items.length === g.items.filter((x) => x.trim()).length &&
    items.every((x) => x.length <= 44) &&
    title.length >= 2 &&
    title.length <= 36 &&
    wordCount(title) <= 6
  );
}

const PW = 1180; // panel width
const PAD = 64;
const ROW_H = 84;
const BOX = 46;

/** The checkbox's shape, by variant: square, diamond or round. */
const BOX_SHAPES = ["square", "diamond", "round"] as const;

export const QuestLog: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, dim, visible } = useStage(len, 200);
  const items = objectives(g.items).slice(0, 5);
  const title = clean(g.primary);
  if (!visible || items.length < 2) return null;
  const n = items.length;
  const shape = BOX_SHAPES[Math.abs(variant) % BOX_SHAPES.length]!;
  const step = Math.min(16, 64 / (n - 1));
  const appear = (i: number) => 16 + i * step;
  const tick = (i: number) => appear(i) + 9;

  // Layout, top to bottom, in panel pixels.
  const titleSize = bySize(title, [
    [14, 92],
    [22, 80],
    [30, 68],
    [99, 58],
  ]);
  const yKicker = 56;
  const yTitle = yKicker + 40;
  const yRule = yTitle + titleSize + 18;
  const ySub = yRule + 40;
  const yRows = ySub + 66;
  const PH = yRows + n * ROW_H + 40;
  const longest = items.reduce((m, x) => Math.max(m, x.length), 0);
  const textX = PAD + 44 + BOX + 26;
  const textW = PW - textX - PAD;
  const itemSize = Math.min(
    38,
    Math.floor(textW / (Math.max(18, longest) * 0.56)),
  );

  // Entrance: a line draws across, then the panel opens from it.
  const line = interpolate(frame, [0, 9], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const open = spring({
    frame: frame - 5,
    fps,
    config: { damping: 18, stiffness: 170, mass: 0.7 },
  });
  const head = spring({ frame: frame - 10, fps, config: SPRING.ENTER });
  const rule = interpolate(frame, [12, 26], [0, 1], {
    ...clamp,
    easing: easeOut,
  });

  // The cursor steps down a row as each objective arrives.
  let cursorRows = 0;
  for (let i = 1; i < n; i++)
    cursorRows += spring({
      frame: frame - appear(i),
      fps,
      config: SPRING.SNAP,
    });
  const cursorIn = spring({
    frame: frame - appear(0),
    fps,
    config: SPRING.POP,
  });
  const cursorY = yRows + cursorRows * ROW_H + ROW_H / 2;
  const done = items.filter((_, i) => frame >= tick(i)).length;
  const lastTick = [...items.keys()].reverse().find((i) => frame >= tick(i));
  const countPop =
    lastTick === undefined
      ? 0
      : Math.max(
          0,
          1 -
            spring({ frame: frame - tick(lastTick), fps, config: SPRING.POP }),
        );

  // The quest medallion on the panel's top edge: "!" while open, a tick once every objective is done.
  const medal = spring({ frame: frame - 12, fps, config: SPRING.POP });
  const allAt = tick(n - 1);
  const complete = interpolate(frame, [allAt + 4, allAt + 12], [0, 1], clamp);
  const completeRing = interpolate(frame, [allAt + 4, allAt + 28], [0, 1], { ...clamp, easing: easeOut });

  const boxRadius = shape === "round" ? BOX / 2 : 6;
  const boxRot = shape === "diamond" ? 45 : 0;
  const boxScale = shape === "diamond" ? 0.8 : 1;

  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div style={{ position: "relative", width: PW, height: PH, marginTop: 58 }}>
        {/* The line the panel opens from. */}
        <div
          style={{
            position: "absolute",
            left: (PW * (1 - line)) / 2,
            width: PW * line,
            top: PH / 2 - 2,
            height: 4,
            background: COLOUR.amber,
            opacity: 1 - open,
            boxShadow: "0 0 24px rgba(255,107,26,0.8)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `inset(${(1 - open) * 50}% 0 ${(1 - open) * 50}% 0)`,
          }}
        >
          {/* The frame: a cut-corner panel with a double rule and studs at the corners. */}
          <svg
            width={PW}
            height={PH}
            viewBox={`0 0 ${PW} ${PH}`}
            style={{ position: "absolute", inset: 0 }}
          >
            <defs>
              <linearGradient id="qlFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#1B1A21" stopOpacity={0.97} />
                <stop offset="1" stopColor="#0C0C10" stopOpacity={0.97} />
              </linearGradient>
              <radialGradient id="qlGlow" cx="0.5" cy="0" r="0.6">
                <stop offset="0" stopColor={COLOUR.amber} stopOpacity={0.16} />
                <stop offset="1" stopColor={COLOUR.amber} stopOpacity={0} />
              </radialGradient>
              <pattern
                id="qlHatch"
                width="14"
                height="14"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="2" height="14" fill="rgba(255,255,255,0.025)" />
              </pattern>
            </defs>
            <polygon
              points={chamferPoints(1.5, 1.5, PW - 3, PH - 3, 30)}
              fill="url(#qlFill)"
              stroke={COLOUR.amber}
              strokeWidth={3}
            />
            <polygon
              points={chamferPoints(1.5, 1.5, PW - 3, PH - 3, 30)}
              fill="url(#qlHatch)"
            />
            <polygon
              points={chamferPoints(1.5, 1.5, PW - 3, PH - 3, 30)}
              fill="url(#qlGlow)"
            />
            <polygon
              points={chamferPoints(13, 13, PW - 26, PH - 26, 22)}
              fill="none"
              stroke="rgba(255,107,26,0.32)"
              strokeWidth={1.5}
            />
            {[
              [16, 16],
              [PW - 16, 16],
              [PW - 16, PH - 16],
              [16, PH - 16],
            ].map(([x, y], k) => (
              <rect
                key={k}
                x={x! - 6}
                y={y! - 6}
                width={12}
                height={12}
                fill={COLOUR.amber}
                transform={`rotate(45 ${x} ${y})`}
              />
            ))}
          </svg>

          {/* Header: the QUEST kicker and the quest's title. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: yKicker,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 16,
              opacity: head,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                transform: "rotate(45deg)",
                background: COLOUR.amber,
              }}
            />
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 26,
                lineHeight: "30px",
                letterSpacing: 8,
                color: COLOUR.amber,
                paddingLeft: 8,
              }}
            >
              QUEST
            </div>
            <div
              style={{
                width: 10,
                height: 10,
                transform: "rotate(45deg)",
                background: COLOUR.amber,
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: PAD,
              right: PAD,
              top: yTitle,
              textAlign: "center",
              fontFamily: DISPLAY,
              fontSize: titleSize,
              lineHeight: `${titleSize}px`,
              letterSpacing: 2,
              color: COLOUR.paper,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              opacity: head,
              transform: `translateY(${(1 - head) * 24}px)`,
              textShadow: "0 6px 26px rgba(0,0,0,0.6)",
            }}
          >
            {title}
          </div>
          {/* The rule under the title, drawing out from a centre diamond. */}
          <div
            style={{
              position: "absolute",
              left: PW / 2 - 420 * rule,
              width: 840 * rule,
              top: yRule + 9,
              height: 2,
              background: `linear-gradient(90deg, transparent, ${COLOUR.amber} 30%, ${COLOUR.amber} 70%, transparent)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: PW / 2 - 9,
              top: yRule + 1,
              width: 18,
              height: 18,
              transform: `rotate(45deg) scale(${rule})`,
              background: "#121216",
              border: `3px solid ${COLOUR.amber}`,
            }}
          />

          {/* OBJECTIVES and the count done. */}
          <div
            style={{
              position: "absolute",
              left: PAD,
              right: PAD,
              top: ySub,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 24,
              lineHeight: "30px",
              letterSpacing: 5,
              color: COLOUR.muted,
              opacity: rule,
            }}
          >
            <span>OBJECTIVES</span>
            <span
              style={{
                color: done === n ? COLOUR.amber : COLOUR.muted,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: 3,
                transform: `scale(${1 + 0.35 * countPop})`,
                transformOrigin: "right center",
              }}
            >
              {done}/{n}
            </span>
          </div>

          {/* Progress: one segment per objective, each filling as its objective is ticked. */}
          <div style={{ position: "absolute", left: PAD, right: PAD, top: ySub + 42, height: 8, display: "flex", gap: 6, opacity: rule }}>
            {items.map((_, i) => (
              <div key={i} style={{ flex: 1, position: "relative", background: "rgba(255,255,255,0.10)", transform: "skewX(-20deg)" }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${interpolate(frame, [tick(i), tick(i) + 6], [0, 100], clamp)}%`,
                    background: `linear-gradient(90deg, #D9500A, ${COLOUR.amber}, #FFB27A)`,
                    boxShadow: "0 0 12px rgba(255,107,26,0.6)",
                  }}
                />
              </div>
            ))}
          </div>

          {/* The highlight band and cursor on the current objective. */}
          <div
            style={{
              position: "absolute",
              left: 22,
              right: 22,
              top: cursorY - ROW_H / 2 + 6,
              height: ROW_H - 12,
              opacity: cursorIn * 0.9,
              background:
                "linear-gradient(90deg, rgba(255,107,26,0.20) 0%, rgba(255,107,26,0.07) 55%, rgba(255,107,26,0) 100%)",
              borderLeft: `4px solid ${COLOUR.amber}`,
            }}
          />
          <svg
            width={28}
            height={32}
            viewBox="0 0 28 32"
            style={{
              position: "absolute",
              left: PAD - 6 + Math.sin(frame / 4) * 4,
              top: cursorY - 16,
              opacity: cursorIn,
            }}
          >
            <path d="M2 2 L26 16 L2 30 Z" fill={COLOUR.amber} />
          </svg>

          {/* The objectives. */}
          {items.map((t, i) => {
            const inP = spring({
              frame: frame - appear(i),
              fps,
              config: SPRING.ENTER,
            });
            const k = frame - tick(i);
            const fillP = interpolate(k, [0, 4], [0, 1], clamp);
            const check = interpolate(k, [1, 8], [0, 1], {
              ...clamp,
              easing: easeOut,
            });
            const burst = interpolate(k, [0, 13], [0, 1], {
              ...clamp,
              easing: easeOut,
            });
            const sweep = interpolate(k, [0, 14], [0, 1], clamp);
            const glow = interpolate(k, [0, 3, 18], [0, 1, 0], clamp);
            const y = yRows + i * ROW_H;
            const bx = PAD + 44;
            const by = y + (ROW_H - BOX) / 2;
            if (inP <= 0.001) return null;
            return (
              <React.Fragment key={i}>
                {/* A quick light sweep along the row as it is ticked. */}
                {k >= 0 && sweep < 1 ? (
                  <div
                    style={{
                      position: "absolute",
                      top: y + 10,
                      height: ROW_H - 20,
                      left: bx + (PW - bx - 40) * sweep - 160,
                      width: 220,
                      background:
                        "linear-gradient(90deg, rgba(255,200,150,0), rgba(255,200,150,0.22), rgba(255,200,150,0))",
                    }}
                  />
                ) : null}
                <div
                  style={{
                    position: "absolute",
                    left: bx,
                    top: by,
                    width: BOX,
                    height: BOX,
                    opacity: inP,
                    transform: `translateX(${(1 - inP) * -40}px) rotate(${boxRot}deg) scale(${boxScale * (1 + 0.18 * glow)})`,
                  }}
                >
                  {/* The flash: an outline that grows and fades. */}
                  {k >= 0 && burst < 1 ? (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: boxRadius,
                        border: `3px solid ${COLOUR.amber}`,
                        transform: `scale(${1 + 1.1 * burst})`,
                        opacity: 1 - burst,
                      }}
                    />
                  ) : null}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: boxRadius,
                      border: `3px solid ${fillP > 0.5 ? COLOUR.amber : "rgba(245,245,242,0.75)"}`,
                      background: `rgba(255,107,26,${fillP})`,
                      boxShadow:
                        glow > 0
                          ? `0 0 ${30 * glow}px rgba(255,140,60,${0.9 * glow})`
                          : "none",
                    }}
                  />
                </div>
                {/* The tick, drawn on, kept upright whatever the box's shape. */}
                <svg
                  width={BOX}
                  height={BOX}
                  viewBox="0 0 46 46"
                  style={{
                    position: "absolute",
                    left: bx,
                    top: by,
                    opacity: inP,
                  }}
                >
                  <path
                    d="M11 24 L20 33 L36 13"
                    fill="none"
                    stroke={COLOUR.ink}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={44}
                    strokeDashoffset={44 * (1 - check)}
                  />
                </svg>
                {/* Six short rays out of the box on the tick. */}
                {k >= 0 && burst < 1
                  ? [0, 60, 120, 180, 240, 300].map((a) => (
                      <div
                        key={a}
                        style={{
                          position: "absolute",
                          left: bx + BOX / 2 - 2,
                          top: by + BOX / 2 - 9,
                          width: 4,
                          height: 18,
                          borderRadius: 2,
                          background: "#FFD3A8",
                          opacity: 1 - burst,
                          transform: `rotate(${a + 30}deg) translateY(${-(34 + 26 * burst)}px)`,
                        }}
                      />
                    ))
                  : null}
                <div
                  style={{
                    position: "absolute",
                    left: textX,
                    width: textW,
                    top: y,
                    height: ROW_H,
                    display: "flex",
                    alignItems: "center",
                    fontFamily: BODY,
                    fontWeight: 800,
                    fontSize: itemSize,
                    color: COLOUR.paper,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    opacity: inP * (0.82 + 0.18 * fillP),
                    transform: `translateX(${(1 - inP) * 60}px)`,
                    textShadow:
                      glow > 0
                        ? `0 0 ${18 * glow}px rgba(255,140,60,${0.8 * glow})`
                        : "none",
                  }}
                >
                  {t}
                </div>
                {/* A fine rule between objectives. */}
                {i < n - 1 ? (
                  <div
                    style={{
                      position: "absolute",
                      left: textX,
                      right: PAD,
                      top: y + ROW_H - 1,
                      height: 1,
                      background: "rgba(255,255,255,0.08)",
                      opacity: inP,
                    }}
                  />
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
        {/* The medallion sits outside the opening clip, so it can break the frame's top edge. */}
        <div
          style={{
            position: "absolute",
            left: PW / 2 - 40,
            top: -40,
            width: 80,
            height: 80,
            transform: `scale(${medal}) rotate(${(1 - medal) * -90}deg)`,
          }}
        >
          {completeRing > 0 && completeRing < 1 ? (
            <div
              style={{
                position: "absolute",
                inset: -40 * completeRing,
                borderRadius: "50%",
                border: `${5 * (1 - completeRing) + 1}px solid ${COLOUR.amber}`,
                opacity: 1 - completeRing,
              }}
            />
          ) : null}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: `radial-gradient(circle at 50% 35%, #2A2830, #121116 70%)`,
              border: `4px solid ${COLOUR.amber}`,
              boxShadow: "0 10px 30px rgba(0,0,0,0.6), 0 0 26px rgba(255,107,26,0.35)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: `radial-gradient(circle at 50% 35%, #FFA060, ${COLOUR.amber} 60%, #D9500A)`,
              border: "4px solid #FFD3A8",
              opacity: complete,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: DISPLAY,
              fontSize: 54,
              lineHeight: 1,
              color: COLOUR.amber,
              opacity: 1 - complete,
              paddingTop: 4,
            }}
          >
            !
          </div>
          <svg width={80} height={80} viewBox="0 0 80 80" style={{ position: "absolute", inset: 0, opacity: complete }}>
            <path d="M24 41 L35 52 L57 29" fill="none" stroke={COLOUR.ink} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </Stage>
  );
};
