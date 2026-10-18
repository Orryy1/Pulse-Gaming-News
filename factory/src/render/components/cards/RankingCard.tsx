import React from "react";
import {
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../../brand.ts";
import { CARD_WIDTH } from "../../layout.ts";
import { SPRING, ease, FRAMES } from "../../motion.ts";
import { BODY, DISPLAY } from "../fonts.ts";

/**
 * One entry of a ranking Short: rank badge, box art, title, year and
 * platforms, and the verdict chip. Badge pops, card enters, chip snaps.
 */
export const RankingCard: React.FC<{
  rank: number;
  total: number;
  title: string;
  verdict: string;
  year?: string;
  platforms?: string;
  capsuleSrc?: string | null;
  accent: string;
}> = ({ rank, total, title, verdict, year, platforms, capsuleSrc, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - FRAMES.ruleLead;
  const badge = spring({ frame: t, fps, config: SPRING.POP });
  const card = spring({ frame: t - 4, fps, config: SPRING.ENTER });
  const chip = spring({ frame: t - 16, fps, config: SPRING.SNAP });
  const top = rank === 1;
  const meta = [year, platforms].filter(Boolean).join(" · ");
  const wipe = interpolate(t, [0, 12], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease.out,
  });
  return (
    <div
      style={{
        position: "relative",
        width: CARD_WIDTH,
        display: "flex",
        alignItems: "center",
        gap: 28,
      }}
    >
      <div
        style={{
          position: "relative",
          flex: "none",
          width: 150,
          height: 150,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${badge})`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 30,
            background: top ? accent : "rgba(11,11,14,0.85)",
            border: `4px solid ${accent}`,
            boxShadow: top ? `0 0 40px ${accent}88` : undefined,
          }}
        />
        <div
          style={{
            position: "relative",
            fontFamily: DISPLAY,
            fontSize: rank >= 10 ? 76 : 96,
            color: top ? COLOUR.ink : COLOUR.paper,
            lineHeight: 1,
          }}
        >
          {rank}
        </div>
        <div
          style={{
            position: "absolute",
            bottom: -34,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: 2,
            color: COLOUR.muted,
          }}
        >
          OF {total}
        </div>
      </div>
      {capsuleSrc ? (
      <div
        style={{
          flex: "none",
          width: 160,
          height: 240,
          borderRadius: 10,
          overflow: "hidden",
          background: "rgba(245,245,242,0.08)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          opacity: card,
          transform: `translateY(${(1 - card) * 20}px)`,
        }}
      >
        <Img
          src={capsuleSrc}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      ) : null}
      <div
        style={{
          minWidth: 0,
          flex: 1,
          opacity: card,
          transform: `translateX(${(1 - card) * 24}px)`,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: title.length > 22 ? 64 : 80,
            lineHeight: 1.02,
            color: COLOUR.paper,
            textShadow: "0 8px 40px rgba(0,0,0,0.7)",
            clipPath: `inset(0 ${100 - wipe}% 0 0)`,
          }}
        >
          {title.toUpperCase()}
        </div>
        {meta ? (
          <div
            style={{
              marginTop: 10,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: meta.length > 24 ? 22 : 28,
              letterSpacing: meta.length > 24 ? 1 : 2,
              color: COLOUR.muted,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {meta}
          </div>
        ) : null}
        <div
          style={{
            display: "inline-block",
            marginTop: 16,
            padding: "8px 18px",
            background: accent,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 30,
            letterSpacing: 2.5,
            borderRadius: 8,
            transform: `scale(${chip})`,
            transformOrigin: "left center",
            textTransform: "uppercase",
          }}
        >
          {verdict}
        </div>
      </div>
    </div>
  );
};
