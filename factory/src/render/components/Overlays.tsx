import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import type { CaptionPage, Segment } from "../timeline.ts";
import { BRAND, COLOUR, TYPE } from "../brand.ts";
import {
  BANDS,
  CAPTION_CENTRE,
  HERO_TOP,
  SAFE,
  CONTENT_WIDTH,
  LOW_WIDTH,
} from "../layout.ts";
import {
  FRAMES,
  SPRING,
  ease,
  exitProgress,
  ruleThenContent,
} from "../motion.ts";
import { DISPLAY, BODY } from "./fonts.ts";
import { Timeline } from "./data/Timeline.tsx";
import { PriceTag } from "./data/PriceTag.tsx";
import { Ring } from "./data/Ring.tsx";
import { Calendar } from "./data/Calendar.tsx";
import { BarCompare, parseBars } from "./data/BarCompare.tsx";

export { SAFE } from "../layout.ts";
export { DISPLAY, BODY } from "./fonts.ts";

function useEnter(delayFrames = 0, config = SPRING.ENTER) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delayFrames, fps, config });
}

/** Brand row (lockup and story chip) at y 150 and the source lower-third under it. */
export const TopBar: React.FC<{
  chip: string;
  accent: string;
  isRumour: boolean;
  attribution: string;
  logoSrc: string | null;
}> = ({ chip, accent, isRumour, attribution, logoSrc }) => {
  // The brand bar is complete at frame 0: frame 0 is the thumbnail.
  const rowIn = 1;
  const srcRule = 1;
  const srcIn = 1;
  const source = attribution.replace(/^source:\s*/i, "").toUpperCase();
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: SAFE.top,
          left: SAFE.left,
          right: 1080 - SAFE.right,
          height: 72,
          display: "flex",
          alignItems: "center",
          gap: 18,
          transform: `translateY(${interpolate(rowIn, [0, 1], [-18, 0])}px)`,
          opacity: Math.min(1, rowIn + 0.6),
        }}
      >
        {logoSrc ? (
          <Img
            src={logoSrc}
            style={{ width: 64, height: 64, borderRadius: 16 }}
          />
        ) : null}
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: TYPE.brand,
            color: COLOUR.paper,
            letterSpacing: 2,
            lineHeight: 1,
          }}
        >
          PULSE<span style={{ color: COLOUR.amber }}>.</span>
        </div>
        <div
          style={{
            marginLeft: 4,
            padding: "8px 18px",
            background: isRumour ? COLOUR.alert : accent,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: TYPE.chip,
            letterSpacing: 2,
            borderRadius: 8,
            lineHeight: 1.1,
          }}
        >
          {isRumour ? "RUMOUR · UNCONFIRMED" : chip}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: SAFE.top + 86,
          left: SAFE.left,
          width: 4,
          height: 34,
          background: accent,
          transform: `scaleY(${srcRule})`,
          transformOrigin: "top",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: SAFE.top + 88,
          left: SAFE.left + 18,
          fontFamily: BODY,
          fontWeight: 700,
          fontSize: 28,
          color: "rgba(245,245,242,0.88)",
          letterSpacing: 1.5,
          opacity: srcIn,
          textShadow: "0 2px 12px rgba(0,0,0,0.8)",
          clipPath: `inset(0 ${100 - srcIn * 100}% 0 0)`,
        }}
      >
        SOURCE: {source}
      </div>
    </AbsoluteFill>
  );
};

/** Six-pixel rail in the wire band: one segment per hook, beat, take and loop, the active one in accent. */
export const ProgressRail: React.FC<{
  segments: Segment[];
  accent: string;
  totalFrames: number;
}> = ({ segments, accent, totalFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gap = 8;
  const width = CONTENT_WIDTH;
  const segW =
    (width - gap * (segments.length - 1)) / Math.max(1, segments.length);
  return (
    <div
      style={{
        position: "absolute",
        top: BANDS.wire[0] + 22,
        left: SAFE.left,
        width,
        height: 6,
        display: "flex",
        gap,
      }}
    >
      {segments.map((s, i) => {
        const a = i === 0 ? 0 : Math.round(s.start * fps);
        const b =
          i === segments.length - 1
            ? totalFrames
            : Math.round(segments[i + 1]!.start * fps);
        const fill = interpolate(frame, [a, b], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={i}
            style={{
              width: segW,
              height: 6,
              borderRadius: 3,
              background: "rgba(245,245,242,0.22)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${fill * 100}%`,
                height: "100%",
                background: accent,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

/** Opening headline: fully rendered from frame 0 (it is the thumbnail), exits over the last eight frames. */
export const HookHeadline: React.FC<{
  headline: string;
  accent: string;
  gameTitle: string;
  durationInFrames: number;
}> = ({ headline, accent, gameTitle, durationInFrames }) => {
  const words = headline.toUpperCase().split(/\s+/);
  const gameWords = new Set(
    gameTitle
      .toUpperCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Z0-9]/g, "")),
  );
  const frame = useCurrentFrame();
  const settle = interpolate(frame, [0, 12], [1.02, 1], {
    extrapolateRight: "clamp",
    easing: ease.out,
  });
  const out = exitProgress(frame, durationInFrames);
  const size = words.length > 6 ? TYPE.headlineLong : TYPE.headline;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "flex-start",
        padding: `${HERO_TOP}px ${SAFE.left}px 0`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0 22px",
          width: CONTENT_WIDTH,
          transform: `scale(${settle}) translateY(${(1 - out) * 24}px)`,
          transformOrigin: "left top",
          opacity: out,
        }}
      >
        {words.map((w, i) => {
          const hot = gameWords.has(w.replace(/[^A-Z0-9]/g, ""));
          return (
            <span
              key={i}
              style={{
                fontFamily: DISPLAY,
                fontSize: size,
                lineHeight: 1.02,
                color: hot ? accent : COLOUR.paper,
                textShadow: "0 8px 40px rgba(0,0,0,0.65)",
                display: "inline-block",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

function countUp(primary: string, p: number): string {
  const m = primary.match(/^([^\d]*)([\d,.]+)(.*)$/);
  if (!m) return primary;
  const raw = m[2]!.replace(/,/g, "");
  const target = Number(raw);
  if (!Number.isFinite(target) || raw.includes(".")) return primary;
  if (/^(19|20)\d\d$/.test(raw)) return primary; // years don't count up
  const v = Math.round(target * p);
  return `${m[1]}${m[2]!.includes(",") ? v.toLocaleString("en-GB") : String(v)}${m[3]}`;
}

/** Fact card for a beat or the take: an accent rule draws, the content follows, and it exits before the next one. */
export const FactCard: React.FC<{
  segment: Segment;
  accent: string;
  takeLabel: string;
  durationInFrames: number;
  renderDate: string;
}> = ({ segment, accent, takeLabel, durationInFrames, renderDate }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = segment.visual;
  if (!v || v.kind === "none" || !v.primary.trim()) return null;
  const { rule, content } = ruleThenContent(frame, fps);
  const out = exitProgress(frame, durationInFrames);
  const label =
    segment.kind === "take" ? segment.label || takeLabel : v.secondary;
  const base: React.CSSProperties = {
    position: "absolute",
    left: SAFE.left,
    width: CONTENT_WIDTH,
    top: HERO_TOP,
    opacity: Math.min(content, out),
    transform: `translateX(${interpolate(content, [0, 1], [40, 0]) - (1 - out) * 24}px)`,
  };
  const ruleBar = (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: -22,
        width: `${rule * 100}%`,
        height: 4,
        background: accent,
      }}
    />
  );

  if (segment.kind === "take") {
    const wipe = interpolate(
      frame,
      [FRAMES.ruleLead, FRAMES.ruleLead + 10],
      [0, 100],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out },
    );
    return (
      <div
        style={{
          ...base,
          transform: `translateX(${-(1 - out) * 24}px)`,
          opacity: out,
        }}
      >
        {ruleBar}
        <div
          style={{
            display: "inline-block",
            padding: "10px 20px",
            background: COLOUR.paper,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 34,
            letterSpacing: 3,
            opacity: content,
          }}
        >
          {label.toUpperCase()}
        </div>
        <div
          style={{
            marginTop: 18,
            clipPath: `inset(0 ${100 - wipe}% 0 0)`,
            background: accent,
            padding: "26px 30px",
            boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 96,
              lineHeight: 1.04,
              color: COLOUR.ink,
            }}
          >
            {v.primary.toUpperCase()}
          </div>
        </div>
      </div>
    );
  }

  const panel: React.CSSProperties = {
    background:
      "linear-gradient(90deg, rgba(5,5,7,0.82) 0%, rgba(5,5,7,0.55) 70%, rgba(5,5,7,0) 100%)",
    padding: "26px 30px 26px 0",
    marginLeft: -SAFE.left,
    paddingLeft: SAFE.left,
  };

  if (v.kind === "stat" || v.kind === "date") {
    const p = interpolate(
      frame,
      [FRAMES.ruleLead, FRAMES.ruleLead + 24],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out },
    );
    return (
      <div style={base}>
        {ruleBar}
        <div
          style={{
            ...panel,
            borderLeft: `14px solid ${accent}`,
            paddingLeft: SAFE.left + 30,
            marginLeft: -SAFE.left - 14,
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: v.primary.length > 9 ? 150 : TYPE.displayXL,
              lineHeight: 0.95,
              color: COLOUR.paper,
              textShadow: "0 10px 50px rgba(0,0,0,0.7)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {(v.kind === "stat"
              ? countUp(v.primary, p)
              : v.primary
            ).toUpperCase()}
          </div>
          {label ? (
            <div
              style={{
                marginTop: 14,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 44,
                color: accent,
                textTransform: "uppercase",
                letterSpacing: 2,
              }}
            >
              {label}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const dataCard =
    v.kind === "timeline" && v.date_from && v.date_to ? (
      <Timeline from={v.date_from} to={v.date_to} label={v.primary} accent={accent} />
    ) : v.kind === "price" ? (
      <PriceTag price={v.primary} was={v.was} region={v.region} label={label} accent={accent} />
    ) : v.kind === "score" && typeof v.value_a === "number" ? (
      <Ring value={v.value_a} label={label || v.primary} chips={v.items} suffix={/%$/.test(v.primary.trim()) ? "%" : ""} />
    ) : v.kind === "countdown" && v.date_to ? (
      <Calendar date={v.date_to} renderDate={renderDate} label={label} accent={accent} />
    ) : v.kind === "compare" && v.items && parseBars(v.items).length >= 2 ? (
      <BarCompare rows={parseBars(v.items)} label={v.primary} accent={accent} />
    ) : null;
  if (dataCard) {
    return (
      <div style={base}>
        {ruleBar}
        {dataCard}
      </div>
    );
  }

  if (v.kind === "quote") {
    return (
      <div style={base}>
        {ruleBar}
        <div
          style={{
            background: "rgba(11,11,14,0.82)",
            padding: "34px 38px",
            borderTop: `10px solid ${accent}`,
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 150,
              lineHeight: 0.6,
              color: accent,
            }}
          >
            “
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 60,
              lineHeight: 1.15,
              color: COLOUR.paper,
            }}
          >
            {v.primary}
          </div>
          {label ? (
            <div
              style={{
                marginTop: 18,
                fontFamily: BODY,
                fontWeight: 600,
                fontSize: 34,
                color: COLOUR.muted,
              }}
            >
              — {label}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (v.kind === "list") {
    const items = v.primary
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);
    return (
      <div
        style={{
          ...base,
          ...panel,
          transform: `translateX(${-(1 - out) * 24}px)`,
          opacity: out,
        }}
      >
        {ruleBar}
        {items.map((it, i) => {
          const s = spring({
            frame: frame - FRAMES.ruleLead - i * 6,
            fps,
            config: SPRING.ENTER,
          });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                marginBottom: 20,
                transform: `translateX(${interpolate(s, [0, 1], [60, 0])}px)`,
                opacity: s,
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  background: accent,
                  transform: "rotate(45deg)",
                }}
              />
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 92,
                  color: COLOUR.paper,
                  textShadow: "0 8px 30px rgba(0,0,0,0.7)",
                }}
              >
                {it.toUpperCase()}
              </div>
            </div>
          );
        })}
        {label ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 38,
              color: accent,
              textTransform: "uppercase",
            }}
          >
            {label}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={base}>
      {ruleBar}
      <div
        style={{
          display: "inline",
          background: accent,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
          padding: "4px 18px",
          fontFamily: DISPLAY,
          fontSize: 112,
          lineHeight: 1.22,
          color: COLOUR.ink,
        }}
      >
        {v.primary.toUpperCase()}
      </div>
      {label ? (
        <div
          style={{
            marginTop: 22,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 40,
            color: COLOUR.paper,
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};

const EMPHASIS = /^(£|\$|€)?\d[\d,.]*(%|k|m|bn)?$|^(19|20)\d\d$/i;

/** Word-by-word captions centred on y 1320: the spoken word in accent, numbers and names stay lit. */
export const Captions: React.FC<{
  pages: CaptionPage[];
  accent: string;
  emphasis: Set<string>;
  blankFromFrame: number;
}> = ({ pages, accent, emphasis, blankFromFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame >= blankFromFrame) return null;
  const t = frame / fps;
  const page = pages.find((p) => t >= p.start - 0.05 && t < p.end + 0.05);
  if (!page) return null;
  const pageFrame = frame - Math.round(page.start * fps);
  const pop = spring({ frame: pageFrame, fps, config: SPRING.POP });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        width: LOW_WIDTH,
        top: CAPTION_CENTRE - 100,
        height: 200,
        display: "flex",
        flexWrap: "wrap",
        alignContent: "center",
        justifyContent: "center",
        gap: "0 24px",
        transform: `scale(${interpolate(pop, [0, 1], [0.92, 1])})`,
      }}
    >
      {page.words.map((w, i) => {
        const active = t >= w.start - 0.03 && t < w.end + 0.08;
        const spoken = t >= w.start - 0.03;
        const shown = w.text.replace(/[.,;:!?]+$/, "");
        const lit =
          spoken && (EMPHASIS.test(shown) || emphasis.has(shown.toLowerCase()));
        const activeScale = active
          ? interpolate(frame - Math.round(w.start * fps), [0, 4], [1, 1.06], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: ease.out,
            })
          : 1;
        return (
          <span
            key={i}
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: TYPE.caption,
              lineHeight: 1.12,
              color:
                active || lit
                  ? accent
                  : spoken
                    ? COLOUR.paper
                    : "rgba(245,245,242,0.55)",
              WebkitTextStroke: "4px rgba(0,0,0,0.9)",
              paintOrder: "stroke fill",
              textShadow: "0 6px 24px rgba(0,0,0,0.85)",
              transform: `translateY(${active ? -4 : 0}px) scale(${activeScale})`,
              display: "inline-block",
              textTransform: "uppercase",
            }}
          >
            {shown}
          </span>
        );
      })}
    </div>
  );
};

export { BRAND, Easing };
