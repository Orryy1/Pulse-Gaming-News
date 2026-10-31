// Screen pack, "Terminal": specs printed on a retro amber-phosphor monitor. The tube powers on, the
// heading is typed at a prompt, the "label: value" rows print with dot leaders, the last value lights
// in inverse video and a cursor blinks on a fresh prompt. All typing ends by about frame 85.
import React from "react";
import { interpolate, spring } from "remotion";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import { clamp, easeOut, MONO, paceFor, specRows, txt } from "./common.ts";

const MON_W = 1380;
const MON_H = 846;
const SCR_L = 60;
const SCR_T = 54;
const SCR_W = MON_W - SCR_L * 2;
const SCR_H = 690;
const PAD_X = 58;
const PAD_Y = 50;
const PHOSPHOR = "#FFB43C";
const GLOW = "0 0 4px rgba(255,170,50,0.9), 0 0 16px rgba(255,130,20,0.45)";
const ADVANCE = 0.6; // a monospace character's width in em, a little generous so Menlo also fits

export const Terminal: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 200);
  const rows = (specRows(g.items) ?? []).slice(0, 6);
  const heading = txt(g.primary);
  if (!visible || rows.length < 2) return null;

  const labelCol = Math.max(...rows.map((r) => r.a.length)) + 5;
  const valueMax = Math.max(...rows.map((r) => r.b.length));
  const maxChars = Math.max(
    2 + heading.length + 1,
    2 + labelCol + valueMax + 2,
  );
  const lines = rows.length + 2;
  const font = Math.floor(
    Math.min(
      58,
      (SCR_W - PAD_X * 2) / (maxChars * ADVANCE),
      (SCR_H - PAD_Y * 2) / (lines * 1.42 + 0.8),
    ),
  );
  const lineH = Math.round(font * 1.42);
  // The printout sits in the middle of the tube (a little high), not stranded at its top.
  const blockH = lineH * (rows.length + 2) + Math.round(font * 0.8);
  const textTop = Math.max(PAD_Y, Math.round((SCR_H - blockH) / 2 - font * 0.3));

  // The script of the screen, in frames.
  const powerOn = interpolate(frame, [3, 12], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const typeFrom = 14;
  const pace = paceFor(showFor);
  const typeRate = Math.max(1.3, heading.length / 20) / pace;
  const typed = Math.max(
    0,
    Math.min(heading.length, Math.floor((frame - typeFrom) * typeRate)),
  );
  const typeEnd = typeFrom + Math.ceil(heading.length / typeRate);
  const rowFrom = typeEnd + Math.round(6 * pace);
  const rowGap = Math.max(2, Math.round(Math.min(7, Math.floor(40 / rows.length)) * pace));
  const printRate = 5 / pace;
  const rowText = rows.map((r) => {
    const dots = ".".repeat(Math.max(2, labelCol - r.a.length - 2));
    return { lead: `${r.a} ${dots} `, value: r.b };
  });
  const rowShown = (i: number) => {
    const total = rowText[i]!.lead.length + rowText[i]!.value.length;
    return Math.max(
      0,
      Math.min(total, Math.floor((frame - rowFrom - i * rowGap) * printRate)),
    );
  };
  const lastDone =
    rowFrom +
    (rows.length - 1) * rowGap +
    Math.ceil(
      (rowText[rows.length - 1]!.lead.length +
        rowText[rows.length - 1]!.value.length) /
        printRate,
    );
  const finalPrompt = frame >= lastDone + 4;
  const blinkOn = Math.floor(frame / 9) % 2 === 0;
  const flash = interpolate(
    frame,
    [lastDone, lastDone + 3, lastDone + 12],
    [0, 1, 0.35],
    clamp,
  );

  const enter = spring({
    frame,
    fps,
    config: { damping: 17, stiffness: 120, mass: 0.9 },
  });
  const push = interpolate(frame, [0, showFor], [1, 1.03]);
  const flicker = 0.965 + 0.035 * Math.sin(frame * 2.1) * Math.sin(frame * 0.7);
  const roll = ((frame * 5) % (SCR_H + 300)) - 150;
  const tilt = variant % 2 === 0 ? 1 : -1;

  const cursor = (on: boolean) => (
    <span
      style={{
        display: "inline-block",
        width: `${ADVANCE}em`,
        height: "0.95em",
        marginLeft: "0.05em",
        verticalAlign: "-0.12em",
        background: PHOSPHOR,
        boxShadow: GLOW,
        opacity: on ? 1 : 0,
      }}
    />
  );

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={12}>
      {/* The tube's light on the room. */}
      <div
        style={{
          position: "absolute",
          left: 960 - 900,
          top: 560 - 640,
          width: 1800,
          height: 1280,
          background: `radial-gradient(closest-side, rgba(255,150,40,${0.2 * powerOn}) 0%, rgba(255,120,20,${0.07 * powerOn}) 50%, rgba(255,120,20,0) 100%)`,
        }}
      />
      <div style={{ perspective: 2600 }}>
        <div
          style={{
            position: "relative",
            width: MON_W,
            height: MON_H,
            marginTop: 40,
            borderRadius: 42,
            background:
              "linear-gradient(180deg, #36322e 0%, #26231f 50%, #181614 100%)",
            boxShadow:
              "0 60px 150px rgba(0,0,0,0.8), inset 0 2px 0 rgba(255,255,255,0.1), inset 0 -10px 24px rgba(0,0,0,0.5)",
            opacity: Math.min(1, enter * 2.5),
            transform: `translateY(${(1 - enter) * 70}px) rotateY(${tilt * 2.2 * (1 - enter * 0.5)}deg) scale(${(0.92 + 0.08 * enter) * push})`,
          }}
        >
          {/* The recess the tube sits in. */}
          <div
            style={{
              position: "absolute",
              left: SCR_L - 16,
              top: SCR_T - 16,
              width: SCR_W + 32,
              height: SCR_H + 32,
              borderRadius: 40,
              background: "#0a0908",
              boxShadow:
                "inset 0 6px 18px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.06)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: SCR_L,
              top: SCR_T,
              width: SCR_W,
              height: SCR_H,
              borderRadius: 30,
              overflow: "hidden",
              background: "#0d0d0c",
            }}
          >
            {/* The warmed-up tube: an amber-black glow that opens from a bright line as it powers on. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(ellipse at 50% 45%, #2a1907 0%, #140c03 60%, #070402 100%)",
                transform: `scaleY(${powerOn})`,
              }}
            />
            {powerOn > 0 && powerOn < 1 ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: SCR_H / 2 - (3 + SCR_H * powerOn) / 2,
                  height: 3 + SCR_H * powerOn,
                  background: `rgba(255,214,150,${0.85 * (1 - powerOn) ** 1.5})`,
                  boxShadow: `0 0 40px rgba(255,170,60,${0.8 * (1 - powerOn)})`,
                }}
              />
            ) : null}
            <div
              style={{
                position: "absolute",
                inset: 0,
                opacity: flicker * powerOn,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: PAD_X,
                  top: textTop,
                  right: PAD_X,
                  fontFamily: MONO,
                  fontWeight: 700,
                  fontSize: font,
                  lineHeight: `${lineH}px`,
                  color: PHOSPHOR,
                  textShadow: GLOW,
                  whiteSpace: "pre",
                }}
              >
                <div>
                  {"> "}
                  {heading.slice(0, typed)}
                  {!finalPrompt && frame < rowFrom
                    ? cursor(frame < typeFrom ? blinkOn : true)
                    : null}
                </div>
                <div style={{ height: Math.round(font * 0.8) }} />
                {rowText.map((r, i) => {
                  const n = rowShown(i);
                  if (n <= 0) return <div key={i} style={{ height: lineH }} />;
                  const lead = r.lead.slice(0, n);
                  const value = r.value.slice(
                    0,
                    Math.max(0, n - r.lead.length),
                  );
                  const last = i === rows.length - 1;
                  return (
                    <div key={i}>
                      {"  "}
                      <span style={{ opacity: 0.92 }}>
                        {lead.slice(0, rows[i]!.a.length)}
                      </span>
                      <span style={{ opacity: 0.45 }}>
                        {lead.slice(rows[i]!.a.length)}
                      </span>
                      {last && n >= r.lead.length + r.value.length ? (
                        <span
                          style={{
                            background: PHOSPHOR,
                            color: "#1a0f02",
                            textShadow: "none",
                            padding: "0 0.25em",
                            margin: "0 -0.25em",
                            boxShadow: `0 0 ${10 + 26 * flash}px rgba(255,150,40,${0.55 + 0.4 * flash})`,
                          }}
                        >
                          {value}
                        </span>
                      ) : (
                        <span>{value}</span>
                      )}
                    </div>
                  );
                })}
                {finalPrompt ? (
                  <div>
                    {"> "}
                    {cursor(blinkOn)}
                  </div>
                ) : null}
              </div>
            </div>
            {/* Scanlines, a rolling band, the tube's dark edges and a glint on the glass. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "repeating-linear-gradient(180deg, rgba(0,0,0,0.32) 0 2px, transparent 2px 4px)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: roll,
                height: 150,
                background:
                  "linear-gradient(180deg, transparent, rgba(255,190,90,0.05), transparent)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 30,
                boxShadow:
                  "inset 0 0 110px rgba(0,0,0,0.85), inset 0 0 24px rgba(0,0,0,0.9)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(60% 45% at 22% 12%, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 70%)",
              }}
            />
          </div>
          {/* The chin: vent slots and a power light. */}
          <div
            style={{
              position: "absolute",
              left: 76,
              bottom: 34,
              display: "flex",
              gap: 10,
            }}
          >
            {Array.from({ length: 7 }, (_, i) => (
              <div
                key={i}
                style={{
                  width: 6,
                  height: 30,
                  borderRadius: 3,
                  background: "#0c0b0a",
                  boxShadow:
                    "inset 0 2px 3px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.06)",
                }}
              />
            ))}
          </div>
          {/* A power light and two dials (brightness and contrast, unlabelled). */}
          <div
            style={{
              position: "absolute",
              right: 70,
              bottom: 26,
              display: "flex",
              alignItems: "center",
              gap: 22,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                marginRight: 10,
                background: powerOn > 0 ? "#FF8A2A" : "#3a2a1a",
                boxShadow: `0 0 ${16 * powerOn}px rgba(255,120,30,0.9)`,
              }}
            />
            {[0, 1].map((k) => (
              <div
                key={k}
                style={{
                  position: "relative",
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  background: "radial-gradient(circle at 38% 32%, #4a4640 0%, #24211e 62%, #121110 100%)",
                  boxShadow: "0 3px 6px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.12)",
                  transform: `rotate(${k ? -35 : 50}deg)`,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 16.5,
                    top: 4,
                    width: 3,
                    height: 11,
                    borderRadius: 2,
                    background: "rgba(255,255,255,0.28)",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Stage>
  );
};

/** Two to six "label: value" rows short enough to print at a legible size. */
export const fitsTerminal = (g: MomentGraphic) => {
  const rows = specRows(g.items);
  if (!rows || rows.length < 2 || rows.length > 6) return false;
  const heading = txt(g.primary);
  const labelCol = Math.max(...rows.map((r) => r.a.length)) + 5;
  const valueMax = Math.max(...rows.map((r) => r.b.length));
  const maxChars = Math.max(
    2 + heading.length + 1,
    2 + labelCol + valueMax + 2,
  );
  // At 34 px a line holds about 56 characters on this screen.
  return maxChars <= (SCR_W - PAD_X * 2) / (34 * ADVANCE);
};
