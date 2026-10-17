import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont } from "@remotion/fonts";
import type { CaptionPage, Segment } from "../timeline.ts";
import { BRAND } from "../props.ts";

// Fonts ship in public/fonts (SIL OFL) so renders never depend on a font CDN.
export const DISPLAY = "PulseDisplay";
export const BODY = "PulseBody";
loadFont({ family: DISPLAY, url: staticFile("fonts/anton-latin-400-normal.woff2"), weight: "400" });
for (const w of ["600", "800", "900"]) {
  loadFont({ family: BODY, url: staticFile(`fonts/inter-latin-${w}-normal.woff2`), weight: w });
}

// YouTube Shorts covers roughly the bottom 22% and a right-hand strip with its
// own UI. Everything we draw stays inside this box.
export const SAFE = { top: 150, bottom: 1920 - 430, left: 64, right: 1080 - 150 };

function useEnter(delayFrames = 0, damping = 14) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delayFrames, fps, config: { damping, stiffness: 160, mass: 0.7 } });
}

export const TopBar: React.FC<{ progress: number; chip: string; accent: string; isRumour: boolean; attribution: string; logoSrc: string | null }> = ({
  progress,
  chip,
  accent,
  isRumour,
  attribution,
  logoSrc,
}) => {
  const enter = useEnter(2);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", top: 0, left: 0, height: 10, width: `${progress * 100}%`, background: accent }} />
      <div
        style={{
          position: "absolute",
          top: SAFE.top - 60,
          left: SAFE.left,
          right: SAFE.left,
          display: "flex",
          alignItems: "center",
          gap: 18,
          transform: `translateY(${interpolate(enter, [0, 1], [-40, 0])}px)`,
          opacity: enter,
        }}
      >
        {logoSrc ? <Img src={logoSrc} style={{ width: 72, height: 72, borderRadius: 18 }} /> : null}
        <div style={{ fontFamily: DISPLAY, fontSize: 46, color: BRAND.text, letterSpacing: 2 }}>
          PULSE<span style={{ color: BRAND.primary }}>.</span>
        </div>
        <div
          style={{
            marginLeft: 6,
            padding: "8px 18px",
            background: isRumour ? BRAND.alert : accent,
            color: BRAND.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 30,
            letterSpacing: 2,
            borderRadius: 8,
          }}
        >
          {isRumour ? "RUMOUR · UNCONFIRMED" : chip}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: SAFE.top + 34,
          left: SAFE.left,
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: 28,
          color: "rgba(245,245,242,0.85)",
          letterSpacing: 1,
          opacity: enter,
          textShadow: "0 2px 12px rgba(0,0,0,0.8)",
        }}
      >
        {attribution.toUpperCase()}
      </div>
    </AbsoluteFill>
  );
};

/** Opening headline: the news in big type inside the first second and a half. */
export const HookHeadline: React.FC<{ headline: string; accent: string; gameTitle: string }> = ({ headline, accent, gameTitle }) => {
  const words = headline.toUpperCase().split(/\s+/);
  const gameWords = new Set(gameTitle.toUpperCase().split(/\s+/));
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-start", padding: `${SAFE.top + 420}px ${SAFE.left}px 0` }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 22px", width: SAFE.right - SAFE.left }}>
        {words.map((w, i) => {
          const s = spring({ frame: frame - i * 2, fps, config: { damping: 12, stiffness: 200, mass: 0.6 } });
          const hot = gameWords.has(w.replace(/[^A-Z0-9:']/g, ""));
          return (
            <span
              key={i}
              style={{
                fontFamily: DISPLAY,
                fontSize: words.length > 6 ? 118 : 138,
                lineHeight: 1.02,
                color: hot ? accent : BRAND.text,
                transform: `translateY(${interpolate(s, [0, 1], [80, 0])}px) scale(${interpolate(s, [0, 1], [1.25, 1])})`,
                opacity: s,
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
  // Keep the source's formatting: only add separators if it had them.
  return `${m[1]}${m[2]!.includes(",") ? v.toLocaleString("en-GB") : String(v)}${m[3]}`;
}

/** Fact card for a beat or the take. Layout depends on the visual kind. */
export const FactCard: React.FC<{ segment: Segment; accent: string }> = ({ segment, accent }) => {
  const frame = useCurrentFrame();
  const enter = useEnter(0, 13);
  const v = segment.visual;
  if (!v || v.kind === "none" || !v.primary.trim()) return null;
  const slide = interpolate(enter, [0, 1], [120, 0]);
  const base: React.CSSProperties = {
    position: "absolute",
    left: SAFE.left,
    width: SAFE.right - SAFE.left,
    top: SAFE.top + 470,
    transform: `translateX(${slide}px)`,
    opacity: enter,
  };
  const label = segment.kind === "take" ? segment.label || "WHY IT MATTERS" : v.secondary;
  // Soft dark panel so cards stay legible over busy key art.
  const panel: React.CSSProperties = {
    background: "linear-gradient(90deg, rgba(5,5,7,0.82) 0%, rgba(5,5,7,0.55) 70%, rgba(5,5,7,0) 100%)",
    padding: "26px 30px 26px 0",
    marginLeft: -SAFE.left,
    paddingLeft: SAFE.left,
  };

  if (segment.kind === "take") {
    const wipe = interpolate(frame, [0, 10], [0, 100], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
    return (
      <div style={{ ...base, transform: "none", opacity: 1 }}>
        <div style={{ display: "inline-block", padding: "10px 20px", background: BRAND.text, color: BRAND.ink, fontFamily: BODY, fontWeight: 900, fontSize: 34, letterSpacing: 3, opacity: enter }}>
          {label.toUpperCase()}
        </div>
        <div style={{ marginTop: 18, clipPath: `inset(0 ${100 - wipe}% 0 0)`, background: accent, padding: "26px 30px", boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 96, lineHeight: 1.04, color: BRAND.ink }}>{v.primary.toUpperCase()}</div>
        </div>
      </div>
    );
  }

  if (v.kind === "stat" || v.kind === "date") {
    const p = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
    return (
      <div style={base}>
        <div style={{ ...panel, borderLeft: `14px solid ${accent}`, paddingLeft: SAFE.left + 30, marginLeft: -SAFE.left - 14 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: v.primary.length > 9 ? 150 : 210, lineHeight: 0.95, color: BRAND.text, textShadow: "0 10px 50px rgba(0,0,0,0.7)" }}>
            {(v.kind === "stat" ? countUp(v.primary, p) : v.primary).toUpperCase()}
          </div>
          {label ? <div style={{ marginTop: 14, fontFamily: BODY, fontWeight: 800, fontSize: 44, color: accent, textTransform: "uppercase", letterSpacing: 2 }}>{label}</div> : null}
        </div>
      </div>
    );
  }

  if (v.kind === "quote") {
    return (
      <div style={base}>
        <div style={{ background: "rgba(11,11,14,0.78)", padding: "34px 38px", borderTop: `10px solid ${accent}`, backdropFilter: "blur(10px)" }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 150, lineHeight: 0.6, color: accent }}>“</div>
          <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 60, lineHeight: 1.15, color: BRAND.text }}>{v.primary}</div>
          {label ? <div style={{ marginTop: 18, fontFamily: BODY, fontWeight: 600, fontSize: 34, color: BRAND.muted }}>— {label}</div> : null}
        </div>
      </div>
    );
  }

  if (v.kind === "list") {
    const items = v.primary.split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4);
    return (
      <div style={{ ...base, ...panel, transform: "none", opacity: 1 }}>
        {items.map((it, i) => {
          const s = spring({ frame: frame - i * 6, fps: 30, config: { damping: 13, stiffness: 170 } });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                marginBottom: 20,
                transform: `translateX(${interpolate(s, [0, 1], [140, 0])}px)`,
                opacity: s,
              }}
            >
              <div style={{ width: 22, height: 22, background: accent, transform: "rotate(45deg)" }} />
              <div style={{ fontFamily: DISPLAY, fontSize: 92, color: BRAND.text, textShadow: "0 8px 30px rgba(0,0,0,0.7)" }}>{it.toUpperCase()}</div>
            </div>
          );
        })}
        {label ? <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 38, color: accent, textTransform: "uppercase" }}>{label}</div> : null}
      </div>
    );
  }

  // title
  return (
    <div style={base}>
      <div style={{ display: "inline", background: accent, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone", padding: "4px 18px", fontFamily: DISPLAY, fontSize: 112, lineHeight: 1.22, color: BRAND.ink }}>
        {v.primary.toUpperCase()}
      </div>
      {label ? <div style={{ marginTop: 22, fontFamily: BODY, fontWeight: 800, fontSize: 40, color: BRAND.text, textTransform: "uppercase" }}>{label}</div> : null}
    </div>
  );
};

/** Word-by-word captions with the spoken word highlighted. */
export const Captions: React.FC<{ pages: CaptionPage[]; accent: string }> = ({ pages, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const page = pages.find((p) => t >= p.start - 0.05 && t < p.end + 0.05);
  if (!page) return null;
  const pageFrame = frame - Math.round(page.start * fps);
  const pop = spring({ frame: pageFrame, fps, config: { damping: 15, stiffness: 260, mass: 0.5 } });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        width: SAFE.right - SAFE.left,
        top: SAFE.bottom - 250,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "0 26px",
        transform: `scale(${interpolate(pop, [0, 1], [0.86, 1])})`,
      }}
    >
      {page.words.map((w, i) => {
        const active = t >= w.start - 0.03 && t < w.end + 0.08;
        const spoken = t >= w.start - 0.03;
        return (
          <span
            key={i}
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 82,
              lineHeight: 1.1,
              color: active ? accent : spoken ? BRAND.text : "rgba(245,245,242,0.55)",
              WebkitTextStroke: "3px rgba(0,0,0,0.85)",
              paintOrder: "stroke fill",
              textShadow: "0 6px 24px rgba(0,0,0,0.85)",
              transform: active ? "translateY(-4px)" : "none",
              display: "inline-block",
            }}
          >
            {w.text.toUpperCase()}
          </span>
        );
      })}
    </div>
  );
};

/** Quick light flash on cuts between segments: keeps the pace up without a stock transition. */
export const CutFlash: React.FC<{ cutFrames: number[]; accent: string }> = ({ cutFrames, accent }) => {
  const frame = useCurrentFrame();
  const last = cutFrames.filter((c) => c > 0 && c <= frame).at(-1);
  if (last === undefined) return null;
  const d = frame - last;
  if (d > 5) return null;
  const o = interpolate(d, [0, 5], [0.38, 0]);
  return <AbsoluteFill style={{ background: `linear-gradient(180deg, ${accent} 0%, rgba(255,255,255,0.9) 100%)`, opacity: o, mixBlendMode: "screen" }} />;
};

/** "Live from Steam" data badge: a real number the headline didn't have. */
export const LiveStat: React.FC<{ value: string; label: string; accent: string }> = ({ value, label, accent }) => {
  const frame = useCurrentFrame();
  const enter = useEnter(0, 15);
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(frame / 9));
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: SAFE.top + 830,
        display: "flex",
        alignItems: "center",
        gap: 22,
        padding: "18px 26px",
        background: "rgba(11,11,14,0.82)",
        border: `2px solid ${accent}`,
        borderRadius: 14,
        transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
        opacity: enter,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: "#22C55E", opacity: pulse, boxShadow: "0 0 18px #22C55E" }} />
        <div style={{ fontFamily: BODY, fontWeight: 900, fontSize: 24, color: "#22C55E", letterSpacing: 3 }}>LIVE · STEAM</div>
      </div>
      <div style={{ fontFamily: DISPLAY, fontSize: 64, color: BRAND.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 26, color: BRAND.muted, maxWidth: 300, lineHeight: 1.15, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
};
