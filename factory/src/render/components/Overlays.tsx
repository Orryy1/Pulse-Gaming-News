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
  fitHeadline,
  sourceLine,
} from "../layout.ts";
import {
  captionGrow,
  FRAMES,
  SPRING,
  ease,
  exitProgress,
  ruleThenContent,
} from "../motion.ts";
import { DISPLAY, BODY } from "./fonts.ts";
import { Timeline } from "./cards/Timeline.tsx";
import { PriceTag } from "./cards/PriceTag.tsx";
import { Platforms, Versus, Specs, Milestones } from "./cards/InfoCards.tsx";
import { Ring } from "./cards/Ring.tsx";
import { Calendar } from "./cards/Calendar.tsx";
import { BarCompare } from "./cards/BarCompare.tsx";
import {
  parseBars,
  otherCurrencies,
  parsePairs,
  parseMilestones,
} from "./cards/helpers.ts";
import { RankingCard } from "./cards/RankingCard.tsx";
import { Rise } from "./Rise.tsx";
import type { ShortImage } from "../props.ts";

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
  const source = sourceLine(attribution);
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
          {isRumour ? "RUMOR · UNCONFIRMED" : chip}
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
          fontSize: source.length > 30 ? 24 : 28,
          color: "rgba(245,245,242,0.88)",
          letterSpacing: 1.5,
          maxWidth: CONTENT_WIDTH - 18,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
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
  // The largest size whose lines stay inside the hero band, so a long word never pushes into the shelf.
  const size = fitHeadline(words, [
    TYPE.headline,
    TYPE.headlineLong,
    96,
    84,
    72,
  ]);
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
  return `${m[1]}${m[2]!.includes(",") ? v.toLocaleString("en-US") : String(v)}${m[3]}`;
}

/** Fact card for a beat or the take: an accent rule draws, the content follows, and it exits before the next one. */
export const FactCard: React.FC<{
  segment: Segment;
  accent: string;
  takeLabel: string;
  durationInFrames: number;
  renderDate: string;
  images?: ShortImage[];
  rankTotal?: number;
  beatIndex?: number;
  steamPrices?: { usd?: string; gbp?: string; eur?: string };
}> = ({
  segment,
  accent,
  takeLabel,
  durationInFrames,
  renderDate,
  images = [],
  rankTotal = 0,
  beatIndex,
  steamPrices,
}) => {
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
        <Rise style={{ display: "inline-block" }}>
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
            }}
          >
            {label.toUpperCase()}
          </div>
        </Rise>
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
          {/* A number counts up in place (no rise); a date rises through its mask like a cut title. */}
          <Rise delay={v.kind === "stat" ? -FRAMES.rise : FRAMES.ruleLead}>
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
          </Rise>
          {label ? (
            <Rise delay={FRAMES.ruleLead + 4}>
              <div
                style={{
                  marginTop: 14,
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: label.length > 18 ? 32 : 44,
                  textShadow:
                    "0 2px 14px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)",
                  maxWidth: CONTENT_WIDTH - 60,
                  color: accent,
                  textTransform: "uppercase",
                  letterSpacing: 2,
                }}
              >
                {label}
              </div>
            </Rise>
          ) : null}
        </div>
      </div>
    );
  }

  // The entry's box art; a game off Steam has only its trailer still, which the card crops to the box.
  const capsule =
    beatIndex === undefined
      ? undefined
      : (images.find(
          (i) => i.beatIndex === beatIndex && i.kind === "capsule",
        ) ?? images.find((i) => i.beatIndex === beatIndex));
  const dataCard =
    v.kind === "rank" && typeof v.value_a === "number" ? (
      <RankingCard
        rank={v.value_a}
        total={rankTotal}
        title={v.primary}
        verdict={v.secondary}
        year={v.date_to ? undefined : v.items?.[0]}
        platforms={v.items?.[1]}
        capsuleSrc={capsule?.src ?? null}
        accent={accent}
        date={v.date_to}
      />
    ) : v.kind === "timeline" && v.date_from && v.date_to ? (
      <Timeline
        from={v.date_from}
        to={v.date_to}
        label={v.primary}
        accent={accent}
      />
    ) : v.kind === "price" ? (
      <PriceTag
        price={v.primary}
        was={v.was}
        region={v.region}
        label={label}
        accent={accent}
        others={otherCurrencies(v.primary, v.items, steamPrices)}
      />
    ) : v.kind === "score" && typeof v.value_a === "number" ? (
      <Ring
        value={v.value_a}
        label={label || v.primary}
        chips={v.items}
        suffix={/%$/.test(v.primary.trim()) ? "%" : ""}
      />
    ) : v.kind === "countdown" && v.date_to ? (
      <Calendar
        date={v.date_to}
        renderDate={renderDate}
        label={label}
        accent={accent}
      />
    ) : v.kind === "compare" && v.items && parseBars(v.items).length >= 2 ? (
      <BarCompare rows={parseBars(v.items)} label={v.primary} accent={accent} />
    ) : v.kind === "platforms" && v.items?.some((x) => x.trim()) ? (
      <Platforms
        platforms={v.items
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 6)}
        label={v.primary}
        note={v.secondary}
        accent={accent}
      />
    ) : v.kind === "versus" && parsePairs(v.items ?? []).length >= 2 ? (
      <Versus
        a={parsePairs(v.items ?? [])[0]!}
        b={parsePairs(v.items ?? [])[1]!}
        label={v.primary}
        accent={accent}
      />
    ) : v.kind === "specs" && parsePairs(v.items ?? []).length >= 2 ? (
      <Specs
        rows={parsePairs(v.items ?? [])}
        label={v.primary}
        accent={accent}
      />
    ) : v.kind === "milestones" &&
      parseMilestones(v.items ?? []).length >= 2 ? (
      <Milestones
        points={parseMilestones(v.items ?? [])}
        label={v.primary}
        accent={accent}
      />
    ) : null;
  if (dataCard) {
    return (
      <div style={base}>
        {ruleBar}
        <div
          style={{
            background: "rgba(11,11,14,0.86)",
            borderRadius: 16,
            padding: "26px 30px",
            boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
            maxWidth: CONTENT_WIDTH,
            overflow: "hidden",
          }}
        >
          {dataCard}
        </div>
      </div>
    );
  }

  // A named outlet's report as a recreated news page: generic, credited, tagged as an illustration.
  if (v.kind === "report") {
    const outlet = v.secondary.trim();
    const bars = [92, 86, 95, 70];
    return (
      <div style={base}>
        {ruleBar}
        <div
          style={{
            background: "#ffffff",
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
            maxWidth: CONTENT_WIDTH,
          }}
        >
          <div
            style={{
              height: 50,
              background: "#e9e9ee",
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "0 18px",
            }}
          >
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <div
                key={c}
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 7,
                  background: c,
                }}
              />
            ))}
            <div
              style={{
                marginLeft: 14,
                flex: 1,
                height: 28,
                borderRadius: 14,
                background: "#fff",
                display: "flex",
                alignItems: "center",
                padding: "0 14px",
                fontFamily: BODY,
                fontSize: 18,
                color: "#7a7a85",
              }}
            >
              news / gaming
            </div>
          </div>
          <div style={{ padding: "28px 34px 34px" }}>
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 22,
                letterSpacing: 3,
                color: "#c2410c",
              }}
            >
              REPORT
            </div>
            <Rise delay={FRAMES.ruleLead}>
              <div
                style={{
                  marginTop: 10,
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize: 58,
                  lineHeight: 1.08,
                  color: "#111114",
                }}
              >
                {v.primary}
              </div>
            </Rise>
            <div style={{ marginTop: 22 }}>
              {bars.map((w, i) => (
                <div
                  key={i}
                  style={{
                    height: 13,
                    width: `${w}%`,
                    background: "#e1e1e6",
                    borderRadius: 4,
                    marginBottom: 13,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        {/* The credit on a dark pill: it must read over any footage. */}
        <div
          style={{
            marginTop: 16,
            display: "inline-flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 16px",
            background: "rgba(11,11,14,0.85)",
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 30,
              letterSpacing: 2,
              color: accent,
              textTransform: "uppercase",
              textShadow: "0 4px 20px rgba(0,0,0,0.6)",
            }}
          >
            {outlet ? `As reported by ${outlet}` : "Report"}
          </div>
          <div
            style={{
              padding: "3px 9px",
              borderRadius: 6,
              border: "1px solid rgba(245,245,242,0.6)",
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 17,
              letterSpacing: 2,
              color: "rgba(245,245,242,0.85)",
              background: "rgba(11,11,14,0.5)",
            }}
          >
            ILLUSTRATION
          </div>
        </div>
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
          <Rise delay={FRAMES.ruleLead}>
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
          </Rise>
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
              <span
                style={{
                  display: "inline-block",
                  width: 44,
                  height: 5,
                  background: accent,
                  borderRadius: 3,
                  verticalAlign: "middle",
                  marginRight: 14,
                }}
              />
              {label}
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
    // The card must end above the shelf (y 900): row size by count and length.
    const longest = Math.max(...items.map((s) => s.length), 1);
    const rowSize =
      items.length >= 4
        ? 56
        : items.length === 3
          ? longest > 16
            ? 60
            : 72
          : longest > 18
            ? 72
            : 88;
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
          // The bullet pops; the line rises through its mask, each row five frames after the last.
          const s = spring({
            frame: frame - FRAMES.ruleLead - i * 5,
            fps,
            config: SPRING.POP,
          });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  background: accent,
                  transform: `rotate(45deg) scale(${s})`,
                }}
              />
              <Rise delay={FRAMES.ruleLead + i * 5}>
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: rowSize,
                    color: COLOUR.paper,
                    textShadow: "0 8px 30px rgba(0,0,0,0.7)",
                  }}
                >
                  {it.toUpperCase()}
                </div>
              </Rise>
            </div>
          );
        })}
        {label ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 30,
              marginTop: 4,
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
          fontSize:
            v.primary.length <= 14
              ? 112
              : v.primary.length <= 24
                ? 92
                : v.primary.length <= 36
                  ? 76
                  : 64,
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
  /** Where the caption line sits, when a layout moves it (a gameplay Short's taller picture). */
  centre?: number;
  /** The desk partner's question: its seconds, captioned in gold under a "Your question" tag (name kept for the record). */
  desk?: { start: number; end: number; name: string };
}> = ({
  pages,
  accent,
  emphasis,
  blankFromFrame,
  centre = CAPTION_CENTRE,
  desk,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame >= blankFromFrame) return null;
  const t = frame / fps;
  const page = pages.find((p) => t >= p.start - 0.05 && t < p.end + 0.05);
  if (!page) return null;
  const pageFrame = frame - Math.round(page.start * fps);
  const pop = spring({ frame: pageFrame, fps, config: SPRING.POP });
  const asking =
    !!desk && page.start >= desk.start - 0.05 && page.end <= desk.end + 0.3;
  const wordColour = asking ? COLOUR.gold : accent;
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        width: LOW_WIDTH,
        top: centre - 100,
        height: 200,
        display: "flex",
        flexWrap: "wrap",
        alignContent: "center",
        justifyContent: "center",
        // A long word beside a short one read as one ("MOUTHWASHINGIS", "CO-FOUNDERDAN") at 24 px.
        gap: "0 36px",
        transform: `scale(${interpolate(pop, [0, 1], [0.92, 1])})`,
      }}
    >
      {asking ? (
        <span
          style={{
            position: "absolute",
            top: -46,
            left: 0,
            width: "100%",
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 26,
            letterSpacing: 3,
            color: COLOUR.gold,
            textShadow: "0 4px 16px rgba(0,0,0,0.85)",
            textTransform: "uppercase",
          }}
        >
          {/* The viewer's own question, not a presenter's name nobody knows (owner, 26 Oct 2026). */}
          Your question
        </span>
      ) : null}
      {page.words.map((w, i) => {
        const active = t >= w.start - 0.03 && t < w.end + 0.08;
        const spoken = t >= w.start - 0.03;
        const shown = w.text.replace(/[.,;:!?]+$/, "");
        const lit =
          spoken && (EMPHASIS.test(shown) || emphasis.has(shown.toLowerCase()));
        const activeScale = active
          ? interpolate(
              frame - Math.round(w.start * fps),
              [0, 4],
              [1, captionGrow(shown.length, TYPE.caption)],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: ease.out,
              },
            )
          : 1;
        return (
          <span
            key={i}
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: TYPE.caption,
              lineHeight: 1.12,
              // The spoken word in the story's accent (the desk partner's in gold); numbers and names that have been said stay gold.
              color: active
                ? wordColour
                : lit
                  ? COLOUR.gold
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
