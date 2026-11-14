import { safeScale } from "../../safetransform.ts";
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
import {
  ART_GAP,
  BADGE_SIZE,
  REQUIREMENT_LINE_HEIGHT,
  cardRequirement,
  fitMeta,
  fitName,
  fitRequirement,
  nameWidth,
} from "../../rankcard.ts";
import { BODY, DISPLAY } from "../fonts.ts";

/** A box-art capsule's width beside the name (a Steam capsule stands 2:3). */
const BOX_WIDTH = 124;

/**
 * One entry of a ranked Short: rank badge, art, name, its details and the chip. It stays up for the whole entry
 * (src/render/rankcard.ts), so everything on it is big enough to read on a phone. An achievement's card carries its
 * own icon, its name, what you must do to unlock it and the share of players who did. Badge pops, card enters, chip snaps.
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
  /** Release Radar: the badge shows the release date instead of the rank. */
  date?: string;
  /** An achievement: what you must do to unlock it. Its chip is then the share of players (`year`). */
  requirement?: string;
  /** A series in release order (src/editorial/everygame.ts): the badge shows the year, and its place in the run under it. */
  chrono?: boolean;
}> = ({
  rank,
  total,
  title,
  verdict,
  year,
  platforms,
  capsuleSrc,
  accent,
  date,
  requirement,
  chrono,
}) => {
  const day = date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dayName = day
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" })
        .format(
          new Date(
            Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])),
          ),
        )
        .toUpperCase()
    : "";
  const monthName = day
    ? [
        "JAN",
        "FEB",
        "MAR",
        "APR",
        "MAY",
        "JUN",
        "JUL",
        "AUG",
        "SEP",
        "OCT",
        "NOV",
        "DEC",
      ][Number(day[2]) - 1]
    : "";
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame - FRAMES.ruleLead;
  const badge = spring({ frame: t, fps, config: SPRING.POP });
  const card = spring({ frame: t - 4, fps, config: SPRING.ENTER });
  const chip = spring({ frame: t - 16, fps, config: SPRING.SNAP });
  const top = rank === 1 && !date;
  // In release order the badge is the year; the newest game (the last, "rank" 1) still wears the accent.
  const yearBadge = chrono && year && !date && !requirement ? year : undefined;
  const achievement = Boolean(requirement);
  const artWidth = achievement ? BADGE_SIZE : BOX_WIDTH;
  const hasArt = Boolean(capsuleSrc);
  const name = fitName(title, hasArt, artWidth);
  const need = requirement
    ? fitRequirement(cardRequirement(requirement))
    : undefined;
  // An achievement's chip is its percentage; the game's name sits under it when the Short spans games.
  const meta = achievement
    ? (platforms ?? "")
    : [yearBadge ? undefined : year, platforms].filter(Boolean).join(" · ");
  const metaWidth = achievement ? CARD_WIDTH : nameWidth(hasArt, artWidth);
  const metaFit = meta ? fitMeta(meta.toUpperCase(), metaWidth) : undefined;
  const chipText = achievement ? (year ?? verdict) : verdict;
  const wipe = interpolate(t, [0, 12], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease.out,
  });
  const metaLine = metaFit ? (
    <div
      style={{
        marginTop: 12,
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: metaFit.size,
        letterSpacing: 1,
        lineHeight: 1.2,
        color: "rgba(245,245,242,0.82)",
        textTransform: "uppercase",
      }}
    >
      {meta}
    </div>
  ) : null;
  const chipBox = (
    <div
      style={{
        display: "inline-block",
        marginTop: 16,
        padding: "8px 20px",
        background: accent,
        color: COLOUR.ink,
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: achievement ? 46 : 38,
        letterSpacing: 2,
        borderRadius: 8,
        transform: `scale(${safeScale(chip)})`,
        transformOrigin: "left center",
        textTransform: "uppercase",
      }}
    >
      {chipText}
    </div>
  );
  return (
    <div style={{ position: "relative", width: CARD_WIDTH }}>
      <div
        style={{
          display: "flex",
          alignItems: achievement ? "center" : "flex-start",
          gap: ART_GAP,
        }}
      >
        <div
          style={{
            position: "relative",
            flex: "none",
            width: BADGE_SIZE,
            height: BADGE_SIZE,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${safeScale(badge)})`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 26,
              background: top ? accent : "rgba(11,11,14,0.85)",
              border: `4px solid ${accent}`,
              boxShadow: top ? `0 0 40px ${accent}88` : undefined,
            }}
          />
          <div
            style={{
              position: "relative",
              fontFamily: DISPLAY,
              fontSize: yearBadge ? 54 : day ? 72 : rank >= 10 ? 68 : 80,
              color: top && !day ? COLOUR.ink : COLOUR.paper,
              lineHeight: 1,
              textAlign: "center",
            }}
          >
            {day ? (
              <>
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: 24,
                    letterSpacing: 2,
                    color: accent,
                    marginBottom: 2,
                  }}
                >
                  {monthName}
                </div>
                {Number(day[3])}
              </>
            ) : (
              (yearBadge ?? rank)
            )}
          </div>
          <div
            style={{
              position: "relative",
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 22,
              letterSpacing: 2,
              lineHeight: 1.1,
              color: top && !day ? COLOUR.ink : "rgba(245,245,242,0.8)",
            }}
          >
            {day ? dayName : yearBadge ? `${total - rank + 1} OF ${total}` : `OF ${total}`}
          </div>
        </div>
        {capsuleSrc ? (
          <div
            style={{
              flex: "none",
              width: artWidth,
              height: achievement ? BADGE_SIZE : Math.round(BOX_WIDTH * 1.5),
              borderRadius: achievement ? 16 : 10,
              overflow: "hidden",
              background: "rgba(245,245,242,0.08)",
              boxShadow: "0 16px 44px rgba(0,0,0,0.6)",
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
              fontSize: name.size,
              lineHeight: 1.02,
              color: COLOUR.paper,
              textShadow: "0 8px 40px rgba(0,0,0,0.7)",
              clipPath: `inset(0 ${100 - wipe}% 0 0)`,
            }}
          >
            {title.toUpperCase()}
          </div>
          {achievement ? null : metaLine}
          {achievement ? null : chipBox}
        </div>
      </div>
      {need ? (
        <div style={{ opacity: card }}>
          <div
            style={{
              marginTop: 18,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: need.size,
              lineHeight: REQUIREMENT_LINE_HEIGHT,
              color: COLOUR.paper,
            }}
          >
            {need.lines.join(" ")}
          </div>
          {chipBox}
          {metaLine}
        </div>
      ) : null}
    </div>
  );
};
