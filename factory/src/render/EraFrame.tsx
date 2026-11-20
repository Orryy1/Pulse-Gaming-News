// A game on the hardware of its day, as one still for a Short (src/editorial/everygame.ts): a handheld game's
// screenshot on a handheld, or a game with no era-true picture as its box art on the television or monitor it
// was played on. Seven devices of no particular brand, in the Pulse universe's rule: no real logos, product names
// or lettering, so the picture on the screen is the only thing that says which game it is. Drawn for the
// 1080x1920 Short with the screen between the entry card (top) and the captions (lower third).
import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { COLOUR } from "./brand.ts";
import type { EraDevice } from "../editorial/everygame.ts";

export type EraFrameProps = {
  imageSrc: string;
  /** "screen": the picture fills the screen (a screenshot). "box": box art standing on the screen, whole. */
  mode: "screen" | "box";
  device: EraDevice;
};

export const ERA_FRAME_W = 1080;
export const ERA_FRAME_H = 1920;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/** Where each device's screen sits (pure, so a test can hold them inside the frame and clear of the card). */
export const ERA_SCREENS: Record<EraDevice, Rect> = {
  "handheld-brick": { x: 260, y: 650, w: 560, h: 500, r: 10 },
  "handheld-wide": { x: 190, y: 700, w: 700, h: 420, r: 8 },
  "handheld-dual": { x: 220, y: 600, w: 640, h: 480, r: 6 },
  "crt-tv": { x: 130, y: 640, w: 820, h: 615, r: 46 },
  "flat-tv": { x: 40, y: 660, w: 1000, h: 562, r: 4 },
  "crt-monitor": { x: 170, y: 640, w: 740, h: 555, r: 34 },
  "flat-monitor": { x: 70, y: 660, w: 940, h: 529, r: 4 },
};

const CRT = new Set<EraDevice>(["crt-tv", "crt-monitor"]);

const box = (
  x: number,
  y: number,
  w: number,
  h: number,
  style: React.CSSProperties,
): React.CSSProperties => ({
  position: "absolute",
  left: x,
  top: y,
  width: w,
  height: h,
  ...style,
});

const PLASTIC =
  "linear-gradient(180deg, #5a5d66 0%, #3d4047 55%, #2a2c32 100%)";
const BEIGE = "linear-gradient(180deg, #d9d3c4 0%, #bdb6a5 60%, #9f9887 100%)";
const BLACK = "linear-gradient(180deg, #2b2d33 0%, #17181c 100%)";
const SHADOW =
  "0 50px 110px rgba(0,0,0,0.75), inset 0 3px 0 rgba(255,255,255,0.14)";

const Cross: React.FC<{ x: number; y: number; s: number }> = ({ x, y, s }) => (
  <>
    <div
      style={box(x - s * 1.5, y - s / 2, s * 3, s, {
        background: "#15161a",
        borderRadius: 8,
      })}
    />
    <div
      style={box(x - s / 2, y - s * 1.5, s, s * 3, {
        background: "#15161a",
        borderRadius: 8,
      })}
    />
  </>
);

const Button: React.FC<{
  x: number;
  y: number;
  d: number;
  colour?: string;
}> = ({ x, y, d, colour = "#8a2f3c" }) => (
  <div
    style={box(x - d / 2, y - d / 2, d, d, {
      borderRadius: d,
      background: `radial-gradient(circle at 35% 30%, ${colour}, #1a1a1e)`,
      boxShadow: "0 4px 10px rgba(0,0,0,0.5)",
    })}
  />
);

/** The picture on the glass: a screenshot fills it; box art stands whole over its own blurred copy. */
const Glass: React.FC<{
  s: Rect;
  src: string;
  mode: EraFrameProps["mode"];
  crt: boolean;
  dim?: boolean;
}> = ({ s, src, mode, crt, dim }) => (
  <div
    style={box(s.x, s.y, s.w, s.h, {
      borderRadius: s.r,
      overflow: "hidden",
      background: "#050506",
    })}
  >
    {src ? (
      <Img
        src={src}
        style={{
          position: "absolute",
          inset: mode === "box" || dim ? -40 : 0,
          width: mode === "box" || dim ? s.w + 80 : "100%",
          height: mode === "box" || dim ? s.h + 80 : "100%",
          objectFit: "cover",
          filter:
            mode === "box" || dim
              ? "blur(26px) brightness(0.45) saturate(1.2)"
              : undefined,
        }}
      />
    ) : null}
    {src && mode === "box" && !dim ? (
      <Img
        src={src}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          height: s.h * 0.9,
          transform: "translate(-50%, -50%)",
          borderRadius: 6,
          boxShadow: "0 18px 50px rgba(0,0,0,0.8)",
        }}
      />
    ) : null}
    {crt ? (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "repeating-linear-gradient(180deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 5px)",
          boxShadow: "inset 0 0 90px rgba(0,0,0,0.75)",
        }}
      />
    ) : null}
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "linear-gradient(125deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 32%)",
      }}
    />
  </div>
);

const Body: React.FC<{ device: EraDevice; s: Rect }> = ({ device, s }) => {
  switch (device) {
    case "handheld-brick":
      return (
        <>
          <div
            style={box(150, 560, 780, 1300, {
              borderRadius: "40px 40px 150px 40px",
              background: BEIGE,
              boxShadow: SHADOW,
            })}
          />
          <div
            style={box(s.x - 50, s.y - 40, s.w + 100, s.h + 90, {
              borderRadius: "18px 18px 60px 18px",
              background: "#4b4d57",
            })}
          />
          <Cross x={330} y={1440} s={64} />
          <Button x={700} y={1470} d={96} />
          <Button x={820} y={1400} d={96} />
          <div
            style={box(430, 1650, 90, 26, {
              borderRadius: 13,
              background: "#77736a",
              transform: "rotate(-25deg)",
            })}
          />
          <div
            style={box(560, 1650, 90, 26, {
              borderRadius: 13,
              background: "#77736a",
              transform: "rotate(-25deg)",
            })}
          />
        </>
      );
    case "handheld-wide":
      return (
        <>
          <div
            style={box(-70, 640, 1220, 540, {
              borderRadius: 250,
              background: BLACK,
              boxShadow: SHADOW,
            })}
          />
          <div
            style={box(s.x - 16, s.y - 16, s.w + 32, s.h + 32, {
              borderRadius: 16,
              background: "#0a0a0c",
            })}
          />
          <Cross x={80} y={860} s={44} />
          <Button x={1000} y={830} d={58} colour="#3a3d46" />
          <Button x={1000} y={960} d={58} colour="#3a3d46" />
          <Button x={940} y={895} d={58} colour="#3a3d46" />
          <Button x={1060} y={895} d={58} colour="#3a3d46" />
          <div
            style={box(60, 1010, 70, 70, {
              borderRadius: 35,
              background:
                "radial-gradient(circle at 40% 35%, #44474f, #121316)",
            })}
          />
        </>
      );
    case "handheld-dual":
      return (
        <>
          <div
            style={box(110, 540, 860, 600, {
              borderRadius: "44px 44px 14px 14px",
              background: PLASTIC,
              boxShadow: SHADOW,
            })}
          />
          <div style={box(110, 1140, 860, 40, { background: "#1d1e22" })} />
          <div
            style={box(110, 1180, 860, 620, {
              borderRadius: "14px 14px 44px 44px",
              background: PLASTIC,
              boxShadow: SHADOW,
            })}
          />
          <Cross x={170} y={1400} s={30} />
          <Button x={915} y={1360} d={40} colour="#3a3d46" />
          <Button x={915} y={1450} d={40} colour="#3a3d46" />
        </>
      );
    case "crt-tv":
      return (
        <>
          <div
            style={box(40, 570, 1000, 800, {
              borderRadius: 40,
              background: BLACK,
              boxShadow: SHADOW,
            })}
          />
          <div
            style={box(s.x - 26, s.y - 26, s.w + 52, s.h + 52, {
              borderRadius: 60,
              background: "#0c0c0f",
            })}
          />
          <div
            style={box(440, 1300, 200, 16, {
              borderRadius: 8,
              background: "#3a3c44",
            })}
          />
          <div
            style={box(900, 1296, 22, 22, {
              borderRadius: 11,
              background: COLOUR.amber,
              boxShadow: `0 0 16px ${COLOUR.amber}`,
            })}
          />
          <div
            style={box(250, 1420, 580, 120, {
              borderRadius: 18,
              background: PLASTIC,
              boxShadow: "0 30px 60px rgba(0,0,0,0.7)",
            })}
          />
          <div
            style={box(300, 1466, 300, 14, {
              borderRadius: 7,
              background: "#17181c",
            })}
          />
          <div
            style={box(760, 1462, 22, 22, {
              borderRadius: 11,
              background: "#5fd08a",
            })}
          />
        </>
      );
    case "flat-tv":
      return (
        <>
          <div
            style={box(s.x - 14, s.y - 14, s.w + 28, s.h + 28, {
              borderRadius: 12,
              background: "#101114",
              boxShadow: SHADOW,
            })}
          />
          <div
            style={box(480, s.y + s.h + 14, 120, 70, { background: "#1b1c20" })}
          />
          <div
            style={box(340, s.y + s.h + 84, 400, 18, {
              borderRadius: 9,
              background: "#26272c",
            })}
          />
          <div
            style={box(300, 1420, 480, 90, {
              borderRadius: 14,
              background: BLACK,
              boxShadow: "0 30px 60px rgba(0,0,0,0.7)",
            })}
          />
          <div
            style={box(720, 1458, 16, 16, {
              borderRadius: 8,
              background: "#e8e8ee",
              boxShadow: "0 0 14px #ffffff",
            })}
          />
        </>
      );
    case "crt-monitor":
      return (
        <>
          <div
            style={box(90, 570, 900, 740, {
              borderRadius: 30,
              background: BEIGE,
              boxShadow: SHADOW,
            })}
          />
          <div
            style={box(s.x - 30, s.y - 30, s.w + 60, s.h + 60, {
              borderRadius: 50,
              background: "#8f897a",
            })}
          />
          <div
            style={box(840, 1250, 60, 22, {
              borderRadius: 6,
              background: "#8f897a",
            })}
          />
          <div
            style={box(790, 1254, 14, 14, {
              borderRadius: 7,
              background: "#5fd08a",
            })}
          />
          <div style={box(360, 1310, 360, 60, { background: "#aaa392" })} />
          <div
            style={box(150, 1430, 780, 150, {
              borderRadius: 16,
              background: BEIGE,
              boxShadow: "0 30px 60px rgba(0,0,0,0.7)",
            })}
          />
          {Array.from({ length: 3 }, (_, r) => (
            <div
              key={r}
              style={box(180, 1450 + r * 40, 720, 28, {
                borderRadius: 6,
                background:
                  "repeating-linear-gradient(90deg, #efeadc 0px, #efeadc 40px, #b5ae9d 40px, #b5ae9d 46px)",
              })}
            />
          ))}
        </>
      );
    case "flat-monitor":
      return (
        <>
          <div
            style={box(s.x - 16, s.y - 16, s.w + 32, s.h + 50, {
              borderRadius: 12,
              background: "#141518",
              boxShadow: SHADOW,
            })}
          />
          <div
            style={box(500, s.y + s.h + 34, 80, 110, { background: "#1b1c20" })}
          />
          <div
            style={box(380, s.y + s.h + 140, 320, 20, {
              borderRadius: 10,
              background: "#26272c",
            })}
          />
          <div
            style={box(200, 1440, 680, 110, {
              borderRadius: 14,
              background: BLACK,
              boxShadow: "0 30px 60px rgba(0,0,0,0.7)",
            })}
          />
        </>
      );
  }
};

export const EraFrame: React.FC<EraFrameProps> = ({
  imageSrc,
  mode,
  device,
}) => {
  const s = ERA_SCREENS[device];
  const second: Rect | undefined =
    device === "handheld-dual" ? { ...s, y: 1240 } : undefined;
  return (
    <AbsoluteFill style={{ background: COLOUR.ink, overflow: "hidden" }}>
      {/* The room: the picture itself, far out of focus, so the frame carries the game's own colours. */}
      {imageSrc ? (
        <Img
          src={imageSrc}
          style={{
            position: "absolute",
            inset: -120,
            width: ERA_FRAME_W + 240,
            height: ERA_FRAME_H + 240,
            objectFit: "cover",
            filter: "blur(70px) brightness(0.32) saturate(1.3)",
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(70% 45% at 50% 50%, rgba(11,11,14,0) 0%, rgba(11,11,14,0.78) 100%)",
        }}
      />
      <Body device={device} s={s} />
      <Glass s={s} src={imageSrc} mode={mode} crt={CRT.has(device)} />
      {second ? (
        <Glass s={second} src={imageSrc} mode={mode} crt={false} dim />
      ) : null}
    </AbsoluteFill>
  );
};

export const SAMPLE_ERA_FRAME: EraFrameProps = {
  imageSrc: "",
  mode: "screen",
  device: "crt-tv",
};
