// The premium layer of the long-form video, sentence by sentence: an animated
// graphic for the fact a sentence states (a stat that counts up, a date badge,
// a score dial, a list that builds, bars that grow), a picture that pops in
// beside the footage with its caption, a kinetic caption for a name worth
// landing, a flash-punch between entries, and a constant film grain and
// vignette. All timing comes from the sentence windows the planner uses.

import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { displayText } from "../timeline.ts";
import { TextureBackground, type BackgroundKind } from "./Backgrounds.tsx";

export interface MomentGraphic {
  kind:
    | "none"
    | "stat"
    | "date"
    | "score"
    | "list"
    | "compare"
    | "quote"
    | "timeline"
    | "headline"
    | "delay"
    | "span"
    | "reviews"
    | "versus"
    | "source"
    | "milestone"
    | "people"
    // The wider suite (src/render/components/packs): places, bar charts, shares, specs, lineages.
    | "map"
    | "bars"
    | "share"
    | "specs"
    | "lineage";
  primary: string;
  secondary: string;
  items: string[];
}

export interface MomentProp {
  show: string;
  graphic: MomentGraphic;
  emphasis: string;
  person?: string;
}

/**
 * Who is on screen, the documentary way (Noclip, Ahoy): a lower-third name tag with the role when the
 * shot list knows it, sliding in on an amber rule.
 */
export const NameTag: React.FC<{ name: string; role?: string; len: number }> = ({ name, role, len }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const showFor = Math.min(len - 6, 150);
  if (frame > showFor || !name.trim()) return null;
  const inP = spring({ frame: frame - 4, fps, config: SPRING.ENTER });
  const rule = interpolate(frame, [4, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const out = interpolate(frame, [showFor - 12, showFor], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 96, bottom: 330, opacity: out }}>
      <div style={{ height: 5, width: 90 * rule, background: COLOUR.amber, borderRadius: 3, marginBottom: 12 }} />
      <div style={{ overflow: "hidden" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 64, lineHeight: 1, color: COLOUR.paper, textTransform: "uppercase", textShadow: "0 6px 30px rgba(0,0,0,0.7)", transform: `translateY(${(1 - inP) * 100}%)` }}>
          {displayText(name)}
        </div>
      </div>
      {role ? (
        <div style={{ overflow: "hidden", marginTop: 8 }}>
          <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 26, letterSpacing: 3, color: COLOUR.amber, textTransform: "uppercase", transform: `translateY(${(1 - spring({ frame: frame - 10, fps, config: SPRING.ENTER })) * 100}%)` }}>
            {displayText(role)}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const RIGHT = 96;
const TOP = 128;

const panel: React.CSSProperties = {
  background: "rgba(11,11,14,0.82)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
  padding: "26px 32px",
};

function useInOut(len: number, hold = 150) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const showFor = Math.min(hold, Math.max(45, len - 10));
  const inP = spring({ frame, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [showFor - 12, showFor], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { frame, fps, inP, out, visible: frame <= showFor };
}

function countUp(primary: string, p: number): string {
  const m = primary.match(/^([^\d]*)([\d,.]+)(.*)$/);
  if (!m) return primary;
  const raw = m[2]!.replace(/,/g, "");
  const target = Number(raw);
  if (!Number.isFinite(target) || /^(19|20)\d\d$/.test(raw)) return primary;
  const decimals = raw.includes(".") ? raw.split(".")[1]!.length : 0;
  const v = target * p;
  const shown = decimals
    ? v.toFixed(decimals)
    : Math.round(v).toLocaleString("en-US");
  return `${m[1]}${shown}${m[3]}`;
}

const numberIn = (t: string) =>
  Number((t.match(/[\d,.]+/)?.[0] ?? "").replace(/,/g, ""));

/** The fact a sentence states, drawn as a graphic at the top right. */
export const MomentGraphicCard: React.FC<{ g: MomentGraphic; len: number }> = ({
  g: raw,
  len,
}) => {
  const g = {
    ...raw,
    primary: displayText(raw.primary),
    secondary: displayText(raw.secondary),
    items: raw.items.map(displayText),
  };
  const { frame, fps, inP, out, visible } = useInOut(len);
  if (!visible || g.kind === "none") return null;
  const wrap: React.CSSProperties = {
    position: "absolute",
    right: RIGHT,
    top: TOP,
    maxWidth: 680,
    opacity: inP * out,
    transform: `translateX(${(1 - inP) * 60}px)`,
    ...panel,
  };
  const label = (t: string) => (
    <div
      style={{
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: 26,
        letterSpacing: 2,
        color: COLOUR.muted,
        textTransform: "uppercase",
        marginTop: 10,
      }}
    >
      {t}
    </div>
  );
  if (g.kind === "stat") {
    const p = interpolate(frame, [6, 42], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (x) => 1 - (1 - x) ** 3,
    });
    return (
      <div style={wrap}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: g.primary.length > 14 ? 84 : 112,
            lineHeight: 1,
            color: COLOUR.amber,
            textTransform: "uppercase",
          }}
        >
          {countUp(g.primary, p)}
        </div>
        {g.secondary ? label(g.secondary) : null}
      </div>
    );
  }
  if (g.kind === "date") {
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 22 }}>
        <div
          style={{
            background: COLOUR.amber,
            color: COLOUR.ink,
            borderRadius: 12,
            padding: "12px 20px",
            fontFamily: DISPLAY,
            fontSize: 64,
            lineHeight: 1,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {g.primary}
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 32,
            color: COLOUR.paper,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {g.secondary}
        </div>
      </div>
    );
  }
  if (g.kind === "score") {
    const value = Math.max(0, Math.min(100, numberIn(g.primary) || 0));
    const p = spring({
      frame: frame - 6,
      fps,
      config: { damping: 30, stiffness: 60 },
    });
    const r = 70;
    const c = 2 * Math.PI * r;
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", gap: 26 }}>
        <svg width={170} height={170} viewBox="0 0 170 170">
          <circle
            cx={85}
            cy={85}
            r={r}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={14}
            fill="none"
          />
          <circle
            cx={85}
            cy={85}
            r={r}
            stroke={COLOUR.amber}
            strokeWidth={14}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - (value / 100) * p)}
            transform="rotate(-90 85 85)"
          />
          <text
            x={85}
            y={102}
            textAnchor="middle"
            fontFamily={DISPLAY}
            fontSize={56}
            fill={COLOUR.paper}
          >
            {Math.round(value * p)}
          </text>
        </svg>
        <div style={{ maxWidth: 380 }}>{label(g.secondary || "Score")}</div>
      </div>
    );
  }
  if (g.kind === "list") {
    return (
      <div style={wrap}>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 26,
            letterSpacing: 2.5,
            color: COLOUR.amber,
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          {g.primary}
        </div>
        {g.items.slice(0, 5).map((it, i) => {
          const s = spring({
            frame: frame - 10 - i * 9,
            fps,
            config: SPRING.SNAP,
          });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                opacity: s,
                transform: `translateX(${(1 - s) * 30}px)`,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 34,
                color: COLOUR.paper,
                padding: "6px 0",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: COLOUR.amber,
                  flex: "none",
                }}
              />
              {it}
            </div>
          );
        })}
      </div>
    );
  }
  // compare: two rows as label:value, bars grow to their share of the larger
  const rows = g.items
    .map((x) => {
      const i = x.lastIndexOf(":");
      return i > 0
        ? { label: x.slice(0, i).trim(), value: x.slice(i + 1).trim() }
        : undefined;
    })
    .filter((x): x is { label: string; value: string } => Boolean(x))
    .slice(0, 3);
  const max = Math.max(1, ...rows.map((r) => numberIn(r.value) || 0));
  return (
    <div style={{ ...wrap, width: 620 }}>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 26,
          letterSpacing: 2.5,
          color: COLOUR.amber,
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        {g.primary}
      </div>
      {rows.map((r, i) => {
        const s = spring({
          frame: frame - 8 - i * 8,
          fps,
          config: { damping: 22, stiffness: 90 },
        });
        const share = (numberIn(r.value) || 0) / max;
        return (
          <div key={i} style={{ marginBottom: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 28,
                color: COLOUR.paper,
              }}
            >
              <span>{r.label}</span>
              <span style={{ color: COLOUR.amber }}>{r.value}</span>
            </div>
            <div
              style={{
                height: 14,
                borderRadius: 7,
                background: "rgba(255,255,255,0.1)",
                marginTop: 8,
              }}
            >
              <div
                style={{
                  height: 14,
                  borderRadius: 7,
                  width: `${Math.max(4, share * 100 * s)}%`,
                  background: i === 0 ? COLOUR.amber : COLOUR.paper,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * A quote at full size, the documentary way: the picture behind blurs and darkens, the words rise into
 * place one by one, and the speaker's name slides in under an amber rule. Held long enough to read.
 */
export const QuoteMoment: React.FC<{ g: MomentGraphic; len: number; bg?: BackgroundKind; variant?: number }> = ({
  g,
  len, bg, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = displayText(g.primary)
    .replace(/^["“]+|["”]+$/g, "")
    .trim();
  const words = text.split(/\s+/).filter(Boolean);
  // Readable: about four words a second after the build, at least 4 s, at most 9 s.
  const showFor = Math.min(
    len - 6,
    Math.max(120, Math.min(270, 50 + words.length * 8)),
  );
  if (frame > showFor || !words.length) return null;
  const dim = interpolate(frame, [0, 14, showFor - 14, showFor], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const step = Math.max(1.5, Math.min(4, 60 / words.length));
  const builtAt = 10 + words.length * step;
  const who = spring({ frame: frame - builtAt, fps, config: SPRING.ENTER });
  const size = words.length > 22 ? 58 : words.length > 12 ? 70 : 84;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {bg ? (
        <AbsoluteFill style={{ opacity: dim }}>
          <TextureBackground kind={bg} variant={variant} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
        style={{
          backdropFilter: `blur(${14 * dim}px)`,
          background: `rgba(11,11,14,${0.62 * dim})`,
        }}
      />
      )}
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", opacity: dim }}
      >
        <div
          style={{ maxWidth: 1420, padding: "0 140px", position: "relative" }}
        >
          <div
            style={{
              position: "absolute",
              left: 40,
              top: -120,
              fontFamily: DISPLAY,
              fontSize: 320,
              lineHeight: 1,
              color: COLOUR.amber,
              opacity:
                0.9 * spring({ frame: frame - 2, fps, config: SPRING.POP }),
            }}
          >
            {"“"}
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: size,
              lineHeight: 1.18,
              color: COLOUR.paper,
              textShadow: "0 8px 40px rgba(0,0,0,0.6)",
            }}
          >
            {words.map((w, i) => {
              const s = spring({
                frame: frame - 10 - i * step,
                fps,
                config: SPRING.SNAP,
              });
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    marginRight: size * 0.26,
                    opacity: s,
                    transform: `translateY(${(1 - s) * 46}px)`,
                  }}
                >
                  {w}
                </span>
              );
            })}
          </div>
          {g.secondary ? (
            <div
              style={{
                marginTop: 34,
                display: "flex",
                alignItems: "center",
                gap: 20,
                opacity: who,
                transform: `translateX(${(1 - who) * -40}px)`,
              }}
            >
              <div
                style={{
                  width: 90 * who,
                  height: 6,
                  background: COLOUR.amber,
                  borderRadius: 3,
                }}
              />
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize: 32,
                  letterSpacing: 3,
                  color: COLOUR.amber,
                  textTransform: "uppercase",
                }}
              >
                {displayText(g.secondary)}
              </div>
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Placeholder text lines for a recreated page: varied, stable widths (no invented copy). */
const lines = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => 62 + ((i * 37 + seed * 11) % 36));

/**
 * The press story as a recreated clipping: a newspaper cutting for older stories (before 2007), a
 * web article for later ones. Never a real outlet's page: a generic section header, the headline the
 * shot list wrote from the source, placeholder text, and the outlet only in the credit underneath,
 * tagged as an illustration.
 */
export const HeadlineMoment: React.FC<{
  g: MomentGraphic;
  len: number;
  src?: string; bg?: BackgroundKind; variant?: number }> = ({ g, len, src, bg, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const showFor = Math.min(len - 6, 200);
  if (frame > showFor) return null;
  const year = g.secondary.match(/\b(19|20)\d\d\b/)?.[0];
  const outlet = g.secondary.split(",")[0]!.trim();
  const named =
    outlet && !/^(19|20)\d\d$/.test(outlet) ? displayText(outlet) : "";
  const print = Boolean(year && Number(year) < 2007);
  const headline = displayText(g.primary);
  const dim = interpolate(frame, [0, 12, showFor - 12, showFor], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const inP = spring({ frame: frame - 2, fps, config: SPRING.ENTER });
  const push = interpolate(frame, [0, showFor], [1, 1.05]);
  const credit = spring({ frame: frame - 18, fps, config: SPRING.ENTER });
  const seed = headline.length;
  const card: React.CSSProperties = {
    width: 1120,
    transform: `translateY(${(1 - inP) * 120}px) rotate(${(print ? -1.6 : 0) * inP + (1 - inP) * -4}deg) scale(${push})`,
    boxShadow: "0 40px 120px rgba(0,0,0,0.65)",
  };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {bg ? (
        <AbsoluteFill style={{ opacity: dim }}>
          <TextureBackground kind={bg} variant={variant} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
        style={{
          backdropFilter: `blur(${10 * dim}px)`,
          background: `rgba(11,11,14,${0.55 * dim})`,
        }}
      />
      )}
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", opacity: dim }}
      >
        {print ? (
          <div
            style={{
              ...card,
              background: "#efe7d3",
              padding: "34px 54px 64px",
              clipPath:
                "polygon(0 0, 100% 0, 100% 94%, 96% 97%, 91% 94%, 85% 98%, 78% 95%, 70% 99%, 62% 95%, 55% 98%, 47% 94%, 39% 98%, 31% 95%, 24% 99%, 16% 95%, 8% 98%, 0 95%)",
            }}
          >
            <div
              style={{
                borderTop: "3px solid #2b2620",
                borderBottom: "1px solid #2b2620",
                padding: "8px 0",
                display: "flex",
                justifyContent: "space-between",
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: 22,
                letterSpacing: 4,
                color: "#2b2620",
                textTransform: "uppercase",
              }}
            >
              <span>Entertainment</span>
              <span>{year}</span>
            </div>
            <div
              style={{
                marginTop: 26,
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontWeight: 700,
                fontSize: headline.length > 60 ? 62 : 74,
                lineHeight: 1.06,
                color: "#1d1915",
              }}
            >
              {headline}
            </div>
            <div
              style={{
                marginTop: 30,
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 34,
              }}
            >
              {[0, 1, 2].map((c) => (
                <div key={c}>
                  {/* The cutting's photo, newsprint black and white, at the head of the first column. */}
                  {c === 0 && src ? (
                    <Img
                      src={src}
                      style={{
                        width: "100%",
                        height: 150,
                        objectFit: "cover",
                        filter: "grayscale(1) contrast(1.15) sepia(0.15)",
                        marginBottom: 14,
                        display: "block",
                      }}
                    />
                  ) : null}
                  {lines(c === 0 && src ? 3 : 7, seed + c).map((w, i) => (
                    <div
                      key={i}
                      style={{
                        height: 11,
                        width: `${w}%`,
                        background: "rgba(43,38,32,0.28)",
                        borderRadius: 2,
                        marginBottom: 12,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            style={{
              ...card,
              background: "#ffffff",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: 54,
                background: "#e9e9ee",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "0 20px",
              }}
            >
              {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
                <div
                  key={c}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    background: c,
                  }}
                />
              ))}
              <div
                style={{
                  marginLeft: 18,
                  flex: 1,
                  height: 30,
                  borderRadius: 15,
                  background: "#fff",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 16px",
                  fontFamily: BODY,
                  fontSize: 17,
                  color: "#7a7a85",
                }}
              >
                🔒 news / gaming {year ? `/ ${year}` : ""}
              </div>
            </div>
            <div style={{ padding: "34px 48px 44px" }}>
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize: 20,
                  letterSpacing: 3,
                  color: "#c2410c",
                  textTransform: "uppercase",
                }}
              >
                Gaming
              </div>
              <div
                style={{
                  marginTop: 14,
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize: headline.length > 60 ? 54 : 64,
                  lineHeight: 1.08,
                  color: "#111114",
                }}
              >
                {headline}
              </div>
              <div
                style={{
                  marginTop: 18,
                  height: 12,
                  width: 260,
                  background: "#d4d4da",
                  borderRadius: 3,
                }}
              />
              <div style={{ marginTop: 28, display: "flex", gap: 34 }}>
                <div
                  style={{
                    width: 360,
                    height: 200,
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "linear-gradient(135deg, #3a3a46, #1c1c24)",
                  }}
                >
                  {src ? (
                    <Img
                      src={src}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : null}
                </div>
                <div style={{ flex: 1 }}>
                  {lines(8, seed).map((w, i) => (
                    <div
                      key={i}
                      style={{
                        height: 12,
                        width: `${w}%`,
                        background: "#e1e1e6",
                        borderRadius: 3,
                        marginBottom: 13,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        <div
          style={{
            marginTop: 34,
            display: "flex",
            alignItems: "center",
            gap: 18,
            opacity: credit,
            transform: `translateY(${(1 - credit) * 20}px)`,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 26,
              letterSpacing: 3,
              color: COLOUR.amber,
              textTransform: "uppercase",
            }}
          >
            {named ? `As reported by ${named}` : "Press coverage"}
            {year ? ` · ${year}` : ""}
          </div>
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid rgba(245,245,242,0.5)",
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 16,
              letterSpacing: 2,
              color: "rgba(245,245,242,0.75)",
            }}
          >
            ILLUSTRATION
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Years along a line that draws itself left to right, each stop popping in as the line reaches it. */
export const TimelineMoment: React.FC<{ g: MomentGraphic; len: number }> = ({
  g,
  len,
}) => {
  const { frame, fps, out, visible } = useInOut(len, 240);
  const rows = g.items
    .map((x) => {
      const i = x.indexOf(":");
      return i > 0
        ? {
            year: x.slice(0, i).trim(),
            what: displayText(x.slice(i + 1).trim()),
          }
        : undefined;
    })
    .filter((x): x is { year: string; what: string } => Boolean(x))
    .slice(0, 5);
  if (!visible || rows.length < 2) return null;
  const W = 1500;
  const draw = interpolate(frame, [8, 8 + rows.length * 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => 1 - (1 - x) ** 2,
  });
  const panelIn = spring({ frame, fps, config: SPRING.ENTER });
  return (
    <div
      style={{
        position: "absolute",
        left: (1920 - W - 80) / 2,
        bottom: 150,
        width: W + 80,
        padding: "30px 40px 40px",
        opacity: panelIn * out,
        transform: `translateY(${(1 - panelIn) * 40}px)`,
        ...panel,
      }}
    >
      {g.primary ? (
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 26,
            letterSpacing: 2.5,
            color: COLOUR.amber,
            textTransform: "uppercase",
            marginBottom: 26,
          }}
        >
          {displayText(g.primary)}
        </div>
      ) : null}
      <div style={{ position: "relative", height: 150 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 54,
            height: 6,
            width: W,
            background: "rgba(255,255,255,0.12)",
            borderRadius: 3,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 54,
            height: 6,
            width: W * draw,
            background: COLOUR.amber,
            borderRadius: 3,
          }}
        />
        {rows.map((r, i) => {
          const x = rows.length === 1 ? 0 : (i / (rows.length - 1)) * W;
          const reach = i / Math.max(1, rows.length - 1);
          const s = spring({
            frame: frame - 8 - reach * rows.length * 16,
            fps,
            config: SPRING.POP,
          });
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: 0,
                width: 300,
                transform: `translateX(${i === 0 ? 0 : i === rows.length - 1 ? -300 : -150}px)`,
                textAlign:
                  i === 0 ? "left" : i === rows.length - 1 ? "right" : "center",
                opacity: s,
              }}
            >
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 44,
                  lineHeight: 1,
                  color: COLOUR.paper,
                }}
              >
                {r.year}
              </div>
              <div
                style={{
                  position: "absolute",
                  top: 48,
                  left: i === 0 ? 0 : i === rows.length - 1 ? 282 : 141,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: COLOUR.amber,
                  boxShadow: "0 0 0 5px rgba(11,11,14,0.9)",
                  transform: `scale(${s})`,
                }}
              />
              <div
                style={{
                  marginTop: 42,
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 26,
                  lineHeight: 1.2,
                  color: COLOUR.paper,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                {r.what}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** A second picture of what is being said, framed and captioned, popping in beside the footage. */
export const PopInPicture: React.FC<{
  src: string;
  caption: string;
  len: number;
  side?: "left" | "right";
}> = ({ src, caption, len, side = "right" }) => {
  const { inP, out, visible } = useInOut(len, 120);
  if (!visible) return null;
  const tilt = side === "right" ? 2.2 : -2.2;
  return (
    <div
      style={{
        position: "absolute",
        [side]: RIGHT,
        bottom: 150,
        width: 480,
        opacity: inP * out,
        transform: `translateY(${(1 - inP) * 50}px) rotate(${tilt * inP}deg) scale(${0.9 + 0.1 * inP})`,
        transformOrigin: "center bottom",
      }}
    >
      <div
        style={{
          background: COLOUR.paper,
          padding: 10,
          borderRadius: 10,
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        <Img
          src={src}
          style={{
            width: "100%",
            height: 270,
            objectFit: "cover",
            display: "block",
            borderRadius: 4,
          }}
        />
      </div>
      {caption ? (
        <div
          style={{
            marginTop: 10,
            display: "inline-block",
            background: COLOUR.amber,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 22,
            letterSpacing: 1.5,
            padding: "6px 12px",
            borderRadius: 6,
            textTransform: "uppercase",
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
};

/** A name or phrase worth landing, word by word, with an underline swipe. */
export const KineticCaption: React.FC<{ text: string; len: number }> = ({
  text: raw,
  len,
}) => {
  const text = displayText(raw);
  const { frame, fps, out, visible } = useInOut(len, 75);
  if (!visible || !text.trim()) return null;
  const words = text.toUpperCase().split(/\s+/).slice(0, 4);
  const swipe = interpolate(frame, [10, 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{ position: "absolute", left: 96, top: TOP + 20, opacity: out }}
    >
      <div style={{ display: "flex", gap: 22 }}>
        {words.map((w, i) => {
          const s = spring({ frame: frame - i * 4, fps, config: SPRING.POP });
          return (
            <span
              key={i}
              style={{
                fontFamily: DISPLAY,
                fontSize: 96,
                lineHeight: 1,
                color: COLOUR.paper,
                textShadow: "0 10px 40px rgba(0,0,0,0.7)",
                transform: `translateY(${(1 - s) * 40}px)`,
                opacity: s,
                display: "inline-block",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      <div
        style={{
          height: 8,
          marginTop: 12,
          width: `${swipe * 100}%`,
          background: COLOUR.amber,
          borderRadius: 4,
        }}
      />
    </div>
  );
};

/** A white punch between entries. */
export const FlashPunch: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 2, 10], [0, 0.42, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{ background: "#fff", opacity: o, pointerEvents: "none" }}
    />
  );
};

/** Film grain and a soft vignette over everything: it reads as graded footage, not a slideshow. */
export const GrainVignette: React.FC = () => {
  const frame = useCurrentFrame();
  const seed = frame % 8;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <svg
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.07,
          mixBlendMode: "overlay",
        }}
      >
        <filter id={`grain${seed}`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves={2}
            seed={seed}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** The channel's sound effects (public/sfx/v2, licences in its rights.json), quiet under the narration. */
export const Sfx: React.FC<{
  name: string; // a file under public/sfx without .mp3, e.g. "v2/air-1" (src/render/soundscape.ts)
  volume?: number;
}> = ({ name, volume = 0.28 }) => (
  <Audio src={staticFile(`sfx/${name}.mp3`)} volume={volume} />
);
