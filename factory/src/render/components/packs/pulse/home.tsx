// The Pulse OS home screen and an app launching from it, shared by the Pulse apps (PulseCalendar, PulseMaps):
// the era's wallpaper (as PhoneStory's lock screen) with a faint Pulse mark, a grid of app icons with plain
// generic names, a finger tapping one and the app growing out of its icon. The icons are simple original
// shapes on coloured tiles; the calendar icon carries no date, so no number appears that the graphic did not give.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { clamp, easeInOut } from "../screen/common.ts";
import { PulseMark } from "../screen/pulse.tsx";
import type { ScreenBox } from "./handset.tsx";

export type AppName =
  | "calendar"
  | "maps"
  | "news"
  | "mail"
  | "music"
  | "camera"
  | "photos"
  | "clock";

const GRID: AppName[] = [
  "news",
  "mail",
  "camera",
  "photos",
  "calendar",
  "maps",
  "music",
  "clock",
];
const NAMES: Record<AppName, string> = {
  calendar: "Calendar",
  maps: "Maps",
  news: "News",
  mail: "Mail",
  music: "Music",
  camera: "Camera",
  photos: "Photos",
  clock: "Clock",
};
const TILES: Record<AppName, string> = {
  calendar: "#ffffff",
  maps: "#2f9e74",
  news: COLOUR.amber,
  mail: "#3b7fd9",
  music: "#d9415e",
  camera: "#5d6470",
  photos: "#f2f2f5",
  clock: "#17181d",
};

/** An app's picture: a plain shape drawn on a 100 x 100 tile. */
const Glyph: React.FC<{ app: AppName }> = ({ app }) => {
  const s = {
    fill: "none",
    strokeWidth: 7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  switch (app) {
    case "calendar":
      return (
        <>
          <rect x={0} y={0} width={100} height={30} fill={COLOUR.amber} />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((c) => (
              <rect
                key={`${r}-${c}`}
                x={20 + c * 17}
                y={42 + r * 15}
                width={10}
                height={9}
                rx={2}
                fill={r === 1 && c === 2 ? COLOUR.amber : "#c9ccd3"}
              />
            )),
          )}
        </>
      );
    case "maps":
      return (
        <>
          <path d="M0 64 L100 40 L100 58 L0 82 Z" fill="#f4e7c3" />
          <path
            d="M38 0 L56 0 L70 100 L52 100 Z"
            fill="#9fd3ff"
            opacity={0.9}
          />
          <path
            d="M50 22 C38 22 32 31 32 40 C32 54 50 70 50 70 C50 70 68 54 68 40 C68 31 62 22 50 22 Z"
            fill={COLOUR.amber}
            stroke="#fff"
            strokeWidth={4}
          />
          <circle cx={50} cy={40} r={7} fill="#fff" />
        </>
      );
    case "news":
      return (
        <g transform="translate(14 14) scale(0.72)">
          <PulseGlyph />
        </g>
      );
    case "mail":
      return (
        <>
          <rect
            x={20}
            y={30}
            width={60}
            height={42}
            rx={5}
            {...s}
            stroke="#fff"
          />
          <path d="M22 33 L50 54 L78 33" {...s} stroke="#fff" />
        </>
      );
    case "music":
      return (
        <path
          d="M40 70 V30 L68 24 V62 M40 70 A9 8 0 1 1 39.9 70 M68 62 A9 8 0 1 1 67.9 62"
          {...s}
          stroke="#fff"
        />
      );
    case "camera":
      return (
        <>
          <rect
            x={18}
            y={32}
            width={64}
            height={44}
            rx={8}
            {...s}
            stroke="#fff"
          />
          <circle cx={50} cy={54} r={12} {...s} stroke="#fff" />
        </>
      );
    case "photos":
      return (
        <>
          <circle cx={36} cy={36} r={9} fill={COLOUR.amber} />
          <path d="M16 78 L42 50 L58 64 L68 54 L86 78 Z" fill="#4c8f6b" />
        </>
      );
    case "clock":
      return (
        <>
          <circle cx={50} cy={50} r={30} {...s} stroke="#fff" />
          <path d="M50 32 V50 L62 58" {...s} stroke={COLOUR.amber} />
        </>
      );
  }
};

/** The Pulse mark's lines for use inside another SVG (100 x 100 units), as on the news tile. */
const PulseGlyph: React.FC = () => (
  <polyline
    points="14,55 33,55 42,30 50,80 59,31 66,55 86,55"
    fill="none"
    stroke={COLOUR.ink}
    strokeWidth={9}
    strokeLinejoin="miter"
    strokeMiterlimit={3}
  />
);

/** An app's tile at `size` px, rounded as its skin rounds them. */
export const AppIcon: React.FC<{
  app: AppName;
  size: number;
  round: boolean;
}> = ({ app, size, round }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    style={{
      display: "block",
      borderRadius: round ? "50%" : size * 0.23,
      overflow: "hidden",
      boxShadow: "0 4px 10px rgba(0,0,0,0.35)",
    }}
  >
    <rect width={100} height={100} fill={TILES[app]} />
    <Glyph app={app} />
  </svg>
);

/** Where the home screen puts an app's icon (its centre) and how big. */
export function iconAt(
  screen: ScreenBox,
  app: AppName,
): { x: number; y: number; size: number } {
  const i = Math.max(0, GRID.indexOf(app));
  const cell = screen.w / 4;
  const size = screen.gen === "classic" ? 84 : 92;
  const top = screen.status + (screen.skin === "droid" ? 230 : 60);
  return {
    x: cell * (i % 4) + cell / 2,
    y: top + Math.floor(i / 4) * 150 + size / 2,
    size,
  };
}

/** The era's wallpaper, as PhoneStory's lock screen draws it. */
export function wallpaper(screen: ScreenBox): string {
  return screen.gen === "classic"
    ? "linear-gradient(170deg,#24365e,#0b0f1c 75%)"
    : screen.skin === "droid"
      ? "linear-gradient(160deg,#16303a,#0c1216 70%)"
      : "linear-gradient(160deg,#2b2440,#101018 70%)";
}

/** How far the app has opened (0-1): the tap lands at `tapAt`, the app grows from its icon over 16 frames. */
export const openOf = (frame: number, tapAt: number) =>
  interpolate(frame, [tapAt + 8, tapAt + 24], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });

/**
 * The home screen with `app` tapped at `tapAt` and its screen (children) growing out of the icon. `appBg` fills
 * the app as it opens. Nothing on the home screen is read; it is a beat of setting before the app.
 */
export const AppLaunch: React.FC<{
  screen: ScreenBox;
  app: AppName;
  frame: number;
  tapAt: number;
  appBg: string;
  children: React.ReactNode;
}> = ({ screen, app, frame, tapAt, appBg, children }) => {
  const open = openOf(frame, tapAt);
  const at = iconAt(screen, app);
  const droid = screen.skin === "droid";
  const tapT = frame - tapAt;
  const tap = tapT >= 0 && tapT < 14 ? tapT / 14 : tapT >= 14 ? 1 : 0;
  return (
    <>
      {open < 1 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: wallpaper(screen),
            transform: `scale(${1 + 0.08 * open})`,
            opacity: 1 - open * 0.6,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: screen.w / 2 - 230,
              top: screen.h - 520,
              opacity: 0.13,
            }}
          >
            <PulseMark size={460} colour={COLOUR.amber} />
          </div>
          {droid && (
            // The droid skin's clock widget above the icons.
            <div
              style={{
                position: "absolute",
                left: 40,
                top: screen.status + 50,
                color: "#fff",
                fontSize: 96,
                fontWeight: 400,
                letterSpacing: -2,
                lineHeight: 1,
              }}
            >
              9:41
            </div>
          )}
          {GRID.map((a) => {
            const p = iconAt(screen, a);
            const pressed = a === app ? 1 - 0.08 * Math.sin(Math.PI * tap) : 1;
            return (
              <div
                key={a}
                style={{
                  position: "absolute",
                  left: p.x - 60,
                  top: p.y - p.size / 2,
                  width: 120,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  transform: `scale(${pressed})`,
                }}
              >
                <AppIcon app={a} size={p.size} round={droid} />
                <div
                  style={{
                    color: "#fff",
                    fontSize: 19,
                    fontWeight: 500,
                    textShadow: "0 1px 3px rgba(0,0,0,0.6)",
                  }}
                >
                  {NAMES[a]}
                </div>
              </div>
            );
          })}
          {/* The finger's tap: a soft ring that grows and fades on the icon. */}
          {tapT >= 0 && tapT < 18 && (
            <div
              style={{
                position: "absolute",
                left: at.x - 50 - 50 * tap,
                top: at.y - 50 - 50 * tap,
                width: 100 + 100 * tap,
                height: 100 + 100 * tap,
                borderRadius: "50%",
                background: `rgba(255,255,255,${0.45 * (1 - tap)})`,
                border: "3px solid rgba(255,255,255,0.7)",
                opacity: 1 - tap,
              }}
            />
          )}
        </div>
      )}
      {open > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: appBg,
            overflow: "hidden",
            opacity: Math.min(1, open * 2.5),
            borderRadius: 40 * (1 - open),
            transformOrigin: `${at.x}px ${at.y}px`,
            transform: `scale(${0.16 + 0.84 * open})`,
          }}
        >
          {children}
        </div>
      )}
    </>
  );
};
