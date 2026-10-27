// The documentary's richer explainers, one per sentence when the shot list asks for them (owner,
// 27 Oct 2026: "loads of creative ways to make tons of rich graphics"). Every figure, date, name and
// line on screen comes from the chapter's source (src/editorial/documentary.ts groundDocMoments);
// recreations are generic and tagged, never a real outlet's or person's page.

import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { displayText } from "../timeline.ts";
import type { MomentGraphic } from "./LongMoments.tsx";
import { TextureBackground, type BackgroundKind } from "./Backgrounds.tsx";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const SERIF = "Georgia, 'Times New Roman', serif";

/** The picture behind dims and blurs while a full-screen explainer is up; everything fades together. */
export function useStage(len: number, hold: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const showFor = Math.max(60, Math.min(len - 6, hold));
  const dim = interpolate(
    frame,
    [0, 12, showFor - 12, showFor],
    [0, 1, 1, 0],
    clamp,
  );
  return { frame, fps, showFor, dim, visible: frame <= showFor };
}

export const Stage: React.FC<{
  dim: number;
  blur?: number;
  bg?: BackgroundKind;
  variant?: number;
  children: React.ReactNode;
}> = ({ dim, blur = 10, bg, variant = 0, children }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {bg ? (
      <AbsoluteFill style={{ opacity: dim }}>
        <TextureBackground kind={bg} variant={variant} />
      </AbsoluteFill>
    ) : (
      <AbsoluteFill
        style={{
          backdropFilter: `blur(${blur * dim}px)`,
          background: `rgba(11,11,14,${0.6 * dim})`,
        }}
      />
    )}
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", opacity: dim }}
    >
      {children}
    </AbsoluteFill>
  </AbsoluteFill>
);

export const Label: React.FC<{ children: React.ReactNode; colour?: string }> = ({
  children,
  colour = COLOUR.amber,
}) => (
  <div
    style={{
      fontFamily: BODY,
      fontWeight: 900,
      fontSize: 26,
      letterSpacing: 4,
      color: colour,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

/** "label: value" rows. */
export function pairs(items: string[]): Array<{ a: string; b: string }> {
  return items
    .map((x) => {
      const i = x.indexOf(":");
      return i > 0
        ? {
            a: displayText(x.slice(0, i).trim()),
            b: displayText(x.slice(i + 1).trim()),
          }
        : undefined;
    })
    .filter((x): x is { a: string; b: string } => Boolean(x));
}

/** A release date struck through, a DELAYED stamp, the new date. items: ["old date", "new date"]. */
export const DelayMoment: React.FC<{
  g: MomentGraphic;
  len: number;
  bg?: BackgroundKind;
  variant?: number;
}> = ({ g, len, bg, variant }) => {
  const { frame, fps, dim, visible } = useStage(len, 200);
  const [before, after] = g.items.map(displayText);
  if (!visible || !before || !after) return null;
  const strike = interpolate(frame, [18, 32], [0, 1], clamp);
  const stamp = spring({
    frame: frame - 34,
    fps,
    config: { damping: 11, stiffness: 180, mass: 0.8 },
  });
  const next = spring({ frame: frame - 56, fps, config: SPRING.ENTER });
  const card = (text: string, crossed: boolean) => (
    <div
      style={{
        position: "relative",
        padding: "26px 44px",
        background: "#f5f1e8",
        borderRadius: 14,
        boxShadow: "0 30px 90px rgba(0,0,0,0.6)",
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 96,
          lineHeight: 1,
          color: crossed ? "#6d6559" : "#15130f",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
      {crossed ? (
        <div
          style={{
            position: "absolute",
            left: 30,
            top: "52%",
            height: 10,
            width: `calc(${strike * 100}% - 60px)`,
            background: "#d42a20",
            borderRadius: 5,
            transform: "rotate(-3deg)",
          }}
        />
      ) : null}
    </div>
  );
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div style={{ textAlign: "center" }}>
        <Label>{g.primary ? displayText(g.primary) : "Release date"}</Label>
        <div
          style={{
            marginTop: 90,
            display: "flex",
            alignItems: "center",
            gap: 70,
            justifyContent: "center",
          }}
        >
          <div style={{ position: "relative" }}>
            {card(before, true)}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                marginLeft: -170,
                marginTop: -52,
                width: 340,
                textAlign: "center",
                padding: "6px 0",
                border: "7px solid #d42a20",
                borderRadius: 12,
                background: "rgba(245,241,232,0.35)",
                fontFamily: DISPLAY,
                fontSize: 70,
                color: "#d42a20",
                letterSpacing: 4,
                opacity: stamp > 0.02 ? Math.min(1, stamp * 1.4) : 0,
                transform: `rotate(-12deg) scale(${2.2 - 1.2 * stamp})`,
              }}
            >
              DELAYED
            </div>
          </div>
          <div
            style={{
              opacity: next,
              transform: `translateX(${(1 - next) * 80}px)`,
            }}
          >
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: 90,
                color: COLOUR.amber,
                lineHeight: 1,
              }}
            >
              →
            </div>
          </div>
          <div
            style={{
              opacity: next,
              transform: `translateX(${(1 - next) * 80}px)`,
            }}
          >
            {card(after, false)}
          </div>
        </div>
        {g.secondary ? (
          <div
            style={{
              marginTop: 34,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 30,
              color: COLOUR.paper,
              opacity: next,
              textTransform: "uppercase",
              letterSpacing: 1.5,
            }}
          >
            {displayText(g.secondary)}
          </div>
        ) : null}
      </div>
    </Stage>
  );
};

/** A span of years, the years rolling over like a counter. items: ["2013", "2026"]. */
export const SpanMoment: React.FC<{
  g: MomentGraphic;
  len: number;
  bg?: BackgroundKind;
  variant?: number;
}> = ({ g, len, bg, variant }) => {
  const { frame, dim, visible } = useStage(len, 180);
  const [from, to] = g.items.map((x) =>
    Number(x.match(/\b(19|20)\d\d\b/)?.[0] ?? NaN),
  );
  if (
    !visible ||
    from === undefined ||
    to === undefined ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from
  )
    return null;
  const p = interpolate(frame, [10, 70], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const year = Math.round(from + (to - from) * p);
  const years = to - from;
  const ticks = Array.from({ length: years + 1 }, (_, i) => i);
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div style={{ textAlign: "center", width: 1500 }}>
        <Label>{g.primary ? displayText(g.primary) : `${years} years`}</Label>
        <div
          style={{
            marginTop: 10,
            fontFamily: DISPLAY,
            fontSize: 300,
            lineHeight: 1,
            color: COLOUR.paper,
            textShadow: "0 20px 80px rgba(0,0,0,0.6)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {year}
        </div>
        <div
          style={{
            marginTop: 26,
            display: "flex",
            gap: 8,
            justifyContent: "space-between",
            width: 1300,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {ticks.map((i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 14,
                borderRadius: 7,
                background:
                  i / years <= p ? COLOUR.amber : "rgba(255,255,255,0.15)",
              }}
            />
          ))}
        </div>
        <div
          style={{
            marginTop: 18,
            display: "flex",
            justifyContent: "space-between",
            width: 1300,
            marginLeft: "auto",
            marginRight: "auto",
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 28,
            color: COLOUR.muted,
          }}
        >
          <span>{from}</span>
          <span style={{ color: p >= 1 ? COLOUR.amber : COLOUR.muted }}>
            {to}
          </span>
        </div>
      </div>
    </Stage>
  );
};

/** Critics' scores as tiles flipping in. items: ["Outlet: 10/10", ...] as the source gives them. */
export const ReviewsMoment: React.FC<{
  g: MomentGraphic;
  len: number;
  bg?: BackgroundKind;
  variant?: number;
}> = ({ g, len, bg, variant }) => {
  const { frame, fps, dim, visible } = useStage(len, 210);
  const rows = pairs(g.items).slice(0, 6);
  if (!visible || rows.length < 2) return null;
  const cols = rows.length <= 3 ? rows.length : Math.ceil(rows.length / 2);
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div style={{ textAlign: "center" }}>
        <Label>
          {g.primary ? displayText(g.primary) : "What the critics said"}
        </Label>
        <div
          style={{
            marginTop: 34,
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 380px)`,
            gap: 28,
            justifyContent: "center",
          }}
        >
          {rows.map((r, i) => {
            const s = spring({
              frame: frame - 10 - i * 9,
              fps,
              config: SPRING.SNAP,
            });
            return (
              <div
                key={i}
                style={{
                  padding: "26px 20px",
                  background: "rgba(20,20,26,0.92)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderTop: `6px solid ${COLOUR.amber}`,
                  borderRadius: 16,
                  opacity: s,
                  transform: `perspective(900px) rotateX(${(1 - s) * 80}deg)`,
                  transformOrigin: "top center",
                }}
              >
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: r.b.length > 6 ? 76 : 100,
                    lineHeight: 1,
                    color: COLOUR.paper,
                  }}
                >
                  {r.b}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    fontFamily: BODY,
                    fontWeight: 800,
                    fontSize: 24,
                    letterSpacing: 2,
                    color: COLOUR.muted,
                    textTransform: "uppercase",
                  }}
                >
                  {r.a}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Stage>
  );
};

/** Two games side by side with a diagonal wipe: the series then and now. */
export const VersusMoment: React.FC<{
  len: number;
  left?: { src: string; label: string };
  right?: { src: string; label: string };
  heading: string;
}> = ({ len, left, right, heading }) => {
  const { frame, fps, dim, visible } = useStage(len, 200);
  if (!visible || !left || !right) return null;
  const wipe = interpolate(frame, [6, 30], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const badge = spring({ frame: frame - 26, fps, config: SPRING.POP });
  const half = (side: "l" | "r", p: { src: string; label: string }) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        clipPath:
          side === "l"
            ? `polygon(0 0, ${54 * wipe}% 0, ${46 * wipe}% 100%, 0 100%)`
            : `polygon(${100 - 46 * wipe}% 0, 100% 0, 100% 100%, ${100 - 54 * wipe}% 100%)`,
      }}
    >
      <Img
        src={p.src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: side === "l" ? "saturate(0.85) contrast(1.05)" : "none",
          transform: `scale(${1.06 - 0.04 * wipe})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 120,
          [side === "l" ? "left" : "right"]: 110,
          padding: "12px 22px",
          background: "rgba(11,11,14,0.85)",
          borderRadius: 10,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 34,
          letterSpacing: 1.5,
          color: COLOUR.paper,
          textTransform: "uppercase",
        }}
      >
        {p.label}
      </div>
    </div>
  );
  return (
    <AbsoluteFill
      style={{ opacity: dim, pointerEvents: "none", background: COLOUR.ink }}
    >
      {half("l", left)}
      {half("r", right)}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 150,
            height: 150,
            borderRadius: 75,
            background: COLOUR.amber,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: DISPLAY,
            fontSize: 64,
            color: COLOUR.ink,
            transform: `scale(${badge})`,
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}
        >
          VS
        </div>
      </AbsoluteFill>
      {heading ? (
        <div
          style={{
            position: "absolute",
            top: 130,
            width: "100%",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "12px 26px",
              background: "rgba(11,11,14,0.88)",
              borderRadius: 12,
            }}
          >
            <Label>{heading}</Label>
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** The source's own words on a page, the key phrase swept with a highlighter. */
export const SourceMoment: React.FC<{
  g: MomentGraphic;
  len: number;
  bg?: BackgroundKind;
  variant?: number;
}> = ({ g, len, bg, variant }) => {
  const { frame, fps, dim, visible } = useStage(len, 230);
  const text = displayText(g.primary);
  const mark = displayText(g.items[0] ?? "");
  if (!visible || !text) return null;
  const at = mark ? text.toLowerCase().indexOf(mark.toLowerCase()) : -1;
  const sweep = interpolate(frame, [30, 60], [0, 100], clamp);
  const page = spring({ frame, fps, config: SPRING.ENTER });
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div
        style={{
          width: 1240,
          transform: `translateY(${(1 - page) * 80}px) rotate(${-0.8 * page}deg)`,
        }}
      >
        <div
          style={{
            background: "#fbfaf7",
            borderRadius: 12,
            padding: "40px 60px 50px",
            boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
          }}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 28,
              color: "#54514b",
              borderBottom: "1px solid #d7d3cb",
              paddingBottom: 14,
              marginBottom: 26,
            }}
          >
            {displayText(g.secondary) || "From the record"}
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: text.length > 220 ? 38 : 46,
              lineHeight: 1.45,
              color: "#1b1a17",
            }}
          >
            {at >= 0 ? (
              <>
                {text.slice(0, at)}
                <span
                  style={{
                    backgroundImage:
                      "linear-gradient(transparent 12%, rgba(255,201,40,0.85) 12%, rgba(255,201,40,0.85) 88%, transparent 88%)",
                    backgroundRepeat: "no-repeat",
                    backgroundSize: `${sweep}% 100%`,
                  }}
                >
                  {text.slice(at, at + mark.length)}
                </span>
                {text.slice(at + mark.length)}
              </>
            ) : (
              text
            )}
          </div>
        </div>
        <div style={{ marginTop: 26, textAlign: "center" }}>
          <Label>Source: Wikipedia</Label>
        </div>
      </div>
    </Stage>
  );
};

/** A milestone as a game-style unlock toast at the top of the frame. */
export const AchievementMoment: React.FC<{ g: MomentGraphic; len: number }> = ({
  g,
  len,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const showFor = Math.max(60, Math.min(len - 6, 150));
  if (frame > showFor) return null;
  const inP = spring({ frame, fps, config: SPRING.SNAP });
  const out = interpolate(frame, [showFor - 12, showFor], [1, 0], clamp);
  const shine = interpolate(frame, [10, 40], [-30, 130], clamp);
  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        left: "50%",
        transform: `translate(-50%, ${(1 - inP) * -160}px)`,
        opacity: out,
        display: "flex",
        alignItems: "center",
        gap: 26,
        padding: "20px 40px 20px 22px",
        borderRadius: 60,
        background:
          "linear-gradient(90deg, rgba(20,20,26,0.96), rgba(32,28,22,0.96))",
        border: `2px solid ${COLOUR.amber}`,
        boxShadow: "0 24px 70px rgba(0,0,0,0.6)",
        overflow: "hidden",
        maxWidth: 1300,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(100deg, transparent ${shine - 20}%, rgba(255,255,255,0.18) ${shine}%, transparent ${shine + 20}%)`,
        }}
      />
      <svg width={84} height={84} viewBox="0 0 84 84">
        <circle cx={42} cy={42} r={40} fill={COLOUR.amber} />
        <path
          d="M27 24h30v10c0 9-6 15-15 15s-15-6-15-15V24z M38 49h8v8h8v6H30v-6h8z"
          fill={COLOUR.ink}
        />
        <path
          d="M27 28h-7c0 7 4 11 9 11M57 28h7c0 7-4 11-9 11"
          stroke={COLOUR.ink}
          strokeWidth={4}
          fill="none"
        />
      </svg>
      <div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 22,
            letterSpacing: 4,
            color: COLOUR.amber,
          }}
        >
          MILESTONE{g.secondary ? ` · ${displayText(g.secondary)}` : ""}
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 40,
            color: COLOUR.paper,
            marginTop: 4,
          }}
        >
          {displayText(g.primary)}
        </div>
      </div>
    </div>
  );
};

/** Who's who: dossier cards dealt onto the screen, initials in a seal. items: ["Name: role", ...]. */
export const PeopleMoment: React.FC<{
  g: MomentGraphic;
  len: number;
  photos?: Record<string, string>;
  bg?: BackgroundKind;
  variant?: number;
}> = ({ g, len, photos = {}, bg, variant }) => {
  const { frame, fps, dim, visible } = useStage(len, 210);
  const rows = pairs(g.items).slice(0, 4);
  if (!visible || !rows.length) return null;
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div style={{ textAlign: "center" }}>
        <Label>{g.primary ? displayText(g.primary) : "The people"}</Label>
        <div
          style={{
            marginTop: 40,
            display: "flex",
            gap: 34,
            justifyContent: "center",
          }}
        >
          {rows.map((r, i) => {
            const s = spring({
              frame: frame - 8 - i * 8,
              fps,
              config: SPRING.ENTER,
            });
            const initials = r.a
              .split(/\s+/)
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            const photo = photos[r.a.toLowerCase()];
            return (
              <div
                key={i}
                style={{
                  width: 330,
                  padding: "34px 24px 30px",
                  background: "#f3efe6",
                  borderRadius: 14,
                  boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
                  opacity: s,
                  transform: `translateY(${(1 - s) * 120}px) rotate(${(i - (rows.length - 1) / 2) * 3 * s}deg)`,
                }}
              >
                <div
                  style={{
                    width: 150,
                    height: 150,
                    margin: "0 auto",
                    borderRadius: 75,
                    overflow: "hidden",
                    background: COLOUR.ink,
                    border: `5px solid ${COLOUR.amber}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: DISPLAY,
                    fontSize: 64,
                    color: COLOUR.paper,
                  }}
                >
                  {photo ? (
                    <Img
                      src={photo}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        filter: "grayscale(0.2)",
                      }}
                    />
                  ) : (
                    initials
                  )}
                </div>
                <div
                  style={{
                    marginTop: 22,
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: 32,
                    color: "#15130f",
                    lineHeight: 1.1,
                  }}
                >
                  {r.a}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    fontFamily: BODY,
                    fontWeight: 700,
                    fontSize: 22,
                    letterSpacing: 1,
                    color: "#6b6458",
                    textTransform: "uppercase",
                  }}
                >
                  {r.b}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Stage>
  );
};

/**
 * Two games compared the way remaster videos do it: one picture over the other, a divider with a handle
 * sweeping across and back to show each, their names in the corners.
 */
export const WipeCompare: React.FC<{
  len: number;
  left?: { src: string; label: string };
  right?: { src: string; label: string };
  heading: string;
}> = ({ len, left, right, heading }) => {
  const { frame, fps, dim, visible, showFor } = useStage(len, 210);
  if (!visible || !left || !right) return null;
  // The divider: in from the right, across to show the older game, back to rest in the middle.
  const x = interpolate(
    frame,
    [0, 18, 70, 120, Math.max(121, showFor - 20)],
    [100, 50, 15, 85, 50],
    { ...clamp, easing: (t) => t * t * (3 - 2 * t) },
  );
  const tag = spring({ frame: frame - 10, fps, config: SPRING.ENTER });
  const name = (p: { label: string }, side: "l" | "r") => (
    <div
      style={{
        position: "absolute",
        bottom: 110,
        [side === "l" ? "left" : "right"]: 96,
        padding: "10px 22px",
        background: "rgba(11,11,14,0.82)",
        borderLeft: side === "l" ? `6px solid ${COLOUR.amber}` : undefined,
        borderRight: side === "r" ? `6px solid ${COLOUR.amber}` : undefined,
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: 30,
        letterSpacing: 2,
        color: COLOUR.paper,
        textTransform: "uppercase",
        opacity: tag,
      }}
    >
      {p.label}
    </div>
  );
  return (
    <AbsoluteFill style={{ opacity: dim, background: COLOUR.ink }}>
      <Img src={right.src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - x}% 0 0)` }}>
        <Img src={left.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${x}%`,
          width: 6,
          marginLeft: -3,
          background: COLOUR.paper,
          boxShadow: "0 0 24px rgba(0,0,0,0.7)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `${x}%`,
          width: 76,
          height: 76,
          margin: "-38px 0 0 -38px",
          borderRadius: 38,
          background: COLOUR.paper,
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 30,
          color: COLOUR.ink,
        }}
      >
        {"\u2039\u203A"}
      </div>
      {name(left, "l")}
      {name(right, "r")}
      {heading ? (
        <div
          style={{
            position: "absolute",
            top: 140,
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: DISPLAY,
            fontSize: 72,
            color: COLOUR.paper,
            textTransform: "uppercase",
            textShadow: "0 8px 30px rgba(0,0,0,0.85)",
            opacity: tag,
          }}
        >
          {heading}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
