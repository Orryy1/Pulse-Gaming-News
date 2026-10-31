// Motif: the Souls games (Demon's Souls, Dark Souls, Bloodborne, Sekiro, Elden Ring). An homage to
// their solemn announcements: a dark screen, a wide soft band across the middle, the words in widely
// spaced engraved capitals of muted gold that fade up and slowly grow, ash drifting through.
// Layout, colour, type and motion only: no logo, no series font, no real screen.
import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { displayText } from "../../../timeline.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { Motif, MotifCardProps } from "../types.ts";
import { ROMAN, cardFade, clamp, fitText, fitsAt, rand } from "./shared.ts";

/** Palatino ships with Windows (Palatino Linotype) and macOS (Palatino): the same engraved capitals. */
const ROMAN_FACE =
  "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const GOLD = "#cbb47c";
const GOLD_DIM = "rgba(216,196,146,0.88)";
const ASH = "rgba(150,140,120,0.85)";

/** The band: a wide soft dark strip across the middle of the frame, feathered top and bottom. */
const Band: React.FC<{ height: number; opacity: number; spread: number }> = ({
  height,
  opacity,
  spread,
}) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      top: 540 - height / 2,
      height,
      opacity,
      transform: `scaleY(${spread})`,
      background:
        "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.72) 26%, rgba(0,0,0,0.82) 50%, rgba(0,0,0,0.72) 74%, rgba(0,0,0,0) 100%)",
    }}
  />
);

/** Embers and ash drifting up through the dark, a few at a time. */
const Embers: React.FC<{ frame: number; seed: number; count?: number }> = ({
  frame,
  seed,
  count = 22,
}) => (
  <>
    {Array.from({ length: count }, (_, i) => {
      const speed = 0.6 + rand(seed + i * 3) * 1.2;
      const y =
        ((rand(seed * 7 + i) * 1300 - frame * speed + 2600) % 1300) - 100;
      const x = rand(seed * 5 + i * 11) * 1920 + Math.sin(frame / 30 + i) * 18;
      const s = 2 + rand(seed + i * 13) * 4;
      const warm = rand(seed + i * 17) > 0.45;
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: s,
            height: s,
            borderRadius: s,
            background: warm ? "rgba(255,170,90,0.85)" : ASH,
            boxShadow: warm ? "0 0 8px 2px rgba(255,140,60,0.45)" : "none",
            opacity: 0.25 + 0.6 * Math.abs(Math.sin(frame * 0.06 + i * 1.7)),
          }}
        />
      );
    })}
  </>
);

/** A thin rule drawn out from the middle, the way the series frames its words. */
const Rule: React.FC<{ width: number; reach: number }> = ({ width, reach }) => (
  <div
    style={{
      width: width * reach,
      height: 2,
      margin: "0 auto",
      background: `linear-gradient(90deg, rgba(203,180,124,0) 0%, ${GOLD_DIM} 28%, ${GOLD_DIM} 72%, rgba(203,180,124,0) 100%)`,
    }}
  />
);

const TRACK = 0.16;

export const SoulsCard: React.FC<MotifCardProps> = ({
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
  const f = Math.max(30, frames);
  const head = displayText(heading).toUpperCase().trim();
  const kick = kicker ? displayText(kicker).toUpperCase().trim() : "";
  const foot = [
    game ? displayText(game).toUpperCase().trim() : "",
    year ? displayText(year).trim() : "",
  ]
    .filter((x) => x && x !== head)
    .join("   ·   ");
  const pic = pictures.filter(Boolean)[0];
  const fit = fitText(head, ROMAN, {
    width: 1560,
    height: 330,
    lineHeight: 1.18,
    maxLines: 3,
    maxSize: 118,
    minSize: 48,
    tracking: TRACK,
  });
  const t = interpolate(frame, [0, f], [0, 1], clamp);
  const band = interpolate(frame, [0, 12], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 2,
  });
  const words = interpolate(frame, [6, 34], [0, 1], {
    ...clamp,
    easing: (x) => x * x * (3 - 2 * x),
  });
  const grow = interpolate(frame, [0, f], [0.95, 1.06], clamp);
  const kickIn = interpolate(frame, [4, 22], [0, 1], clamp);
  const footIn = interpolate(frame, [22, 40], [0, 1], clamp);
  const reach = interpolate(frame, [8, 40], [0.15, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const textH = fit.lines.length * fit.size * 1.18;
  const bandH = Math.max(420, textH + (kick ? 130 : 70) + (foot ? 130 : 70));
  return (
    <AbsoluteFill
      style={{
        background: "#000",
        opacity: cardFade(frame, frames),
        overflow: "hidden",
      }}
    >
      {pic ? (
        <AbsoluteFill
          style={{ opacity: interpolate(frame, [0, 10], [0, 1], clamp) }}
        >
          <Img
            src={pic}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${1.08 + 0.06 * t}) translateX(${(v % 2 ? 1 : -1) * (t - 0.5) * 30}px)`,
              filter:
                "grayscale(0.75) sepia(0.25) brightness(0.27) contrast(1.15)",
            }}
          />
        </AbsoluteFill>
      ) : (
        // No picture: a cold mist slowly shifting, so the band still reads against it.
        <AbsoluteFill
          style={{
            background: `radial-gradient(60% 50% at ${40 + 20 * t}% 45%, rgba(70,66,58,0.55) 0%, rgba(0,0,0,0) 70%), radial-gradient(50% 40% at ${70 - 15 * t}% 65%, rgba(52,50,46,0.5) 0%, rgba(0,0,0,0) 70%), #0b0a09`,
          }}
        />
      )}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(85% 80% at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%)",
        }}
      />
      <Embers frame={frame} seed={v * 13 + 1} />
      <Band height={bandH} opacity={band} spread={0.7 + 0.3 * band} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", transform: `scale(${grow})` }}>
          {kick ? (
            <div
              style={{
                fontFamily: ROMAN_FACE,
                fontSize: 32,
                letterSpacing: "0.42em",
                marginRight: "-0.42em",
                color: GOLD_DIM,
                opacity: kickIn,
                marginBottom: 26,
              }}
            >
              {kick}
            </div>
          ) : null}
          <div style={{ marginBottom: 30, opacity: kickIn }}>
            <Rule width={1100} reach={reach} />
          </div>
          <div
            style={{
              fontFamily: ROMAN_FACE,
              fontSize: fit.size,
              lineHeight: 1.18,
              letterSpacing: `${TRACK}em`,
              marginRight: `-${TRACK}em`,
              color: GOLD,
              opacity: words,
              textShadow:
                "0 0 24px rgba(0,0,0,0.9), 0 0 60px rgba(120,90,40,0.25)",
              whiteSpace: "nowrap",
            }}
          >
            {fit.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
          <div style={{ marginTop: 30, opacity: kickIn }}>
            <Rule width={1100} reach={reach} />
          </div>
          {foot ? (
            <div
              style={{
                marginTop: 26,
                fontFamily: ROMAN_FACE,
                fontSize: 30,
                letterSpacing: "0.3em",
                marginRight: "-0.3em",
                color: GOLD_DIM,
                opacity: footIn,
              }}
            >
              {foot}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// Graphic style: a milestone announced on the band

const Banner: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const { frame, dim, visible, showFor } = useStage(len, 150);
  const text = displayText(g.primary).toUpperCase().trim();
  if (!visible || !text) return null;
  const v = Math.abs(Math.floor(variant));
  const sub = displayText(g.secondary).toUpperCase().trim();
  const fit = fitText(text, ROMAN, {
    width: 1600,
    height: 230,
    lineHeight: 1.18,
    maxLines: 2,
    maxSize: 104,
    minSize: 48,
    tracking: TRACK,
  });
  // The words land with the stamp sound, 34 frames in.
  const words = interpolate(frame, [12, 34], [0, 1], {
    ...clamp,
    easing: (x) => x * x * (3 - 2 * x),
  });
  const grow = interpolate(frame, [12, showFor], [0.94, 1.05], clamp);
  const band = interpolate(frame, [0, 12], [0, 1], clamp);
  const textH = fit.lines.length * fit.size * 1.18;
  const bandH = Math.max(340, textH + (sub ? 170 : 110));
  return (
    <AbsoluteFill style={{ opacity: dim }}>
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.72)" }} />
      <Embers frame={frame} seed={v * 7 + 3} count={14} />
      <Band height={bandH} opacity={band} spread={0.7 + 0.3 * band} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", transform: `scale(${grow})` }}>
          {sub ? (
            <div
              style={{
                fontFamily: ROMAN_FACE,
                fontSize: 30,
                letterSpacing: "0.42em",
                marginRight: "-0.42em",
                color: GOLD_DIM,
                opacity: interpolate(frame, [20, 38], [0, 0.9], clamp),
                marginBottom: 30,
              }}
            >
              {sub}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: ROMAN_FACE,
              fontSize: fit.size,
              lineHeight: 1.18,
              letterSpacing: `${TRACK}em`,
              marginRight: `-${TRACK}em`,
              color: GOLD,
              opacity: words,
              textShadow:
                "0 0 24px rgba(0,0,0,0.9), 0 0 60px rgba(120,90,40,0.25)",
              whiteSpace: "nowrap",
            }}
          >
            {fit.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
          <div style={{ marginTop: 30, opacity: words }}>
            <Rule
              width={1000}
              reach={interpolate(frame, [16, 44], [0.15, 1], {
                ...clamp,
                easing: (x) => 1 - (1 - x) ** 3,
              })}
            />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const SOULS: Motif = {
  id: "souls",
  name: "Souls series announcement band",
  matches: (game) =>
    /dark souls|demon['’]?s souls|elden ring|bloodborne|sekiro/i.test(
      `${game.title} ${game.theme ?? ""}`,
    ),
  card: SoulsCard,
  styles: {
    Banner: {
      kind: "milestone",
      component: Banner,
      sound: "stamp",
      fits: (g) => {
        const text = g.primary.trim().toUpperCase();
        const n = text.split(/\s+/).filter(Boolean).length;
        return (
          n >= 1 &&
          n <= 12 &&
          g.secondary.length <= 30 &&
          fitsAt(text, ROMAN, {
            width: 1600,
            height: 230,
            lineHeight: 1.18,
            maxLines: 2,
            maxSize: 104,
            minSize: 52,
            tracking: TRACK,
          })
        );
      },
    },
  } satisfies Record<string, GfxStyle>,
};
