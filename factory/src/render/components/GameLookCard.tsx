// GAME_LOOK: the chapter card (and the opening's title card) in a game's look (src/render/gamelook.ts): the
// chapter's own picture graded towards the game's palette, the heading in the look's matched face, its corners
// and HUD. Every word comes from the card's props; the Pulse mark is drawn by the video around it, as ever.

import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { LookContext, lookFont, useLook, withAlpha, type GameLook } from "../gamelook.ts";
import type { Motif, MotifCardProps } from "./motifs/types.ts";
import { BODY } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { displayText } from "../timeline.ts";
import { GameLookFrame, fitLookText } from "./GameLookFrame.tsx";
import { LOWER_THIRD, SAFE_EDGE } from "./packs/fit.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const HEAD_W = 1180;
const LEFT = 132;

export const GameLookCard: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
  variant = 0,
}) => {
  const look = useLook();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const font = lookFont(look);
  const head = displayText(heading);
  const text = font.caps ? head.toUpperCase() : head;
  const fit = fitLookText(
    text,
    font,
    HEAD_W,
    [132, 116, 100, 88, 76, 64, 54, 46],
    2,
  );
  const pic = pictures[variant % Math.max(1, pictures.length)];
  const enter = spring({ frame: frame - 6, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [frames - 12, frames], [1, 0], clamp);
  const zoom = interpolate(frame, [0, frames], [1.06, 1.14]);
  const sub = [game ? displayText(game) : "", year ?? ""]
    .filter(Boolean)
    .join("  ·  ");
  const lineH = fit.size * (font.face === "mono" ? 1.25 : 1.04);
  // The block sits on the left third, its foot well above the lower third.
  const blockH = 34 + 26 + fit.lines.length * lineH + (sub ? 60 : 0);
  const top = Math.max(SAFE_EDGE + 90, (1080 - LOWER_THIRD - blockH) / 2);
  return (
    <AbsoluteFill
      style={{ background: look.ink, opacity: out, overflow: "hidden" }}
    >
      {pic ? (
        <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
          <Img
            src={pic}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "saturate(0.75) contrast(1.05)",
            }}
          />
        </AbsoluteFill>
      ) : null}
      {/* Graded towards the look: the accent multiplied in, then the ink from the left so the words always read. */}
      <AbsoluteFill
        style={{
          background: withAlpha(look.accent, 0.22),
          mixBlendMode: "multiply",
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(90deg, ${withAlpha(look.ink, 0.96)} 0%, ${withAlpha(look.ink, 0.88)} 38%, ${withAlpha(look.ink, 0.35)} 72%, ${withAlpha(look.ink, 0.15)} 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: LEFT,
          top,
          width: HEAD_W,
          opacity: enter,
          transform: `translateX(${(1 - enter) * -40}px)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{ width: 70 * enter, height: 8, background: look.accent }}
          />
          {kicker ? (
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 28,
                letterSpacing: 7,
                color: look.accent,
                textTransform: "uppercase",
              }}
            >
              {displayText(kicker)}
            </div>
          ) : null}
        </div>
        <div style={{ marginTop: 26 }}>
          {fit.lines.map((l, i) => (
            <div
              key={i}
              style={{
                fontFamily: font.family,
                fontWeight: Number(font.weight),
                fontSize: fit.size,
                lineHeight: `${lineH}px`,
                color: look.paper,
                whiteSpace: "nowrap",
                textShadow: `0 6px 28px ${withAlpha(look.ink, 0.9)}`,
                opacity: interpolate(
                  frame,
                  [10 + i * 5, 22 + i * 5],
                  [0, 1],
                  clamp,
                ),
              }}
            >
              {l}
            </div>
          ))}
        </div>
        {sub ? (
          <div
            style={{
              marginTop: 22,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: 3,
              color: look.muted,
              textTransform: "uppercase",
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
      <GameLookFrame len={frames} variant={variant} hold={frames} />
    </AbsoluteFill>
  );
};

const boundCards = new Map<string, React.FC<MotifCardProps>>();

/** The look's card with the look provided around it; one component per look, so a card never remounts. */
export function lookCardFor(look: GameLook): React.FC<MotifCardProps> {
  const have = boundCards.get(look.id);
  if (have) return have;
  const Card: React.FC<MotifCardProps> = (p) => (
    <LookContext.Provider value={look}>
      <GameLookCard {...p} />
    </LookContext.Provider>
  );
  Card.displayName = `GameLookCard(${look.id})`;
  boundCards.set(look.id, Card);
  return Card;
}

/**
 * GAME_LOOK: the motif a game with a profile takes: its hand-made motif's styles, if it has one, with the look's
 * own chapter card in place of the motif's card.
 */
export function lookMotif(look: GameLook, base: Motif | undefined): Motif {
  return {
    ...(base ?? { matches: () => false }),
    id: `look:${look.id}`,
    name: `${look.name} look`,
    card: lookCardFor(look),
  };
}
