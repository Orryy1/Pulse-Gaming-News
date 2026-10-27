// Channel brand stills, rendered from the same tokens as the Shorts so the
// banner, avatar and thumbnails match the videos frame for frame.

import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { COLOUR } from "./brand.ts";
import { BODY, DISPLAY } from "./components/fonts.ts";
import { titleLines } from "./longplan.ts";

const Grid: React.FC<{ opacity?: number; cell?: number }> = ({
  opacity = 0.05,
  cell = 120,
}) => (
  <div
    style={{
      position: "absolute",
      inset: -400,
      top: "40%",
      backgroundImage: `linear-gradient(rgba(255,255,255,${opacity}) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,${opacity}) 2px, transparent 2px)`,
      backgroundSize: `${cell}px ${cell}px`,
      transform: "perspective(1200px) rotateX(58deg)",
      transformOrigin: "50% 100%",
    }}
  />
);

const Field: React.FC<{ children: React.ReactNode; glow?: string }> = ({
  children,
  glow = COLOUR.amber,
}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 70% at 50% 0%, #17171d 0%, ${COLOUR.ink} 55%, #050507 100%)`,
      overflow: "hidden",
    }}
  >
    <Grid />
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "62%",
        width: "60%",
        height: "40%",
        transform: "translate(-50%, -50%)",
        background: `radial-gradient(ellipse at center, ${glow}33 0%, transparent 65%)`,
      }}
    />
    {children}
  </AbsoluteFill>
);

const Lockup: React.FC<{ size: number; logo?: boolean }> = ({
  size,
  logo = true,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.28 }}>
    {logo ? (
      <Img
        src={staticFile("logo.png")}
        style={{
          width: size * 1.35,
          height: size * 1.35,
          borderRadius: size * 0.3,
        }}
      />
    ) : null}
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: size,
        color: COLOUR.paper,
        letterSpacing: size * 0.04,
        lineHeight: 1,
      }}
    >
      PULSE<span style={{ color: COLOUR.amber }}>.</span>
    </div>
  </div>
);

/**
 * Channel banner, 2560x1440. YouTube shows only the central 1546x423 on every
 * device, so the lockup, line and promise sit inside that box; the rest is
 * field and grid that frames it on TV and desktop.
 */
export const Banner: React.FC = () => (
  <Field>
    <div
      style={{
        position: "absolute",
        left: (2560 - 1546) / 2,
        top: (1440 - 423) / 2,
        width: 1546,
        height: 423,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 48px",
      }}
    >
      <div>
        <Lockup size={150} />
        <div
          style={{
            marginTop: 26,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 34,
            letterSpacing: 6,
            color: COLOUR.muted,
            textTransform: "uppercase",
          }}
        >
          Gaming news, checked and explained
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            display: "inline-block",
            padding: "14px 28px",
            background: COLOUR.amber,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 36,
            letterSpacing: 4,
            borderRadius: 10,
            whiteSpace: "nowrap",
          }}
        >
          NEW SHORTS DAILY
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: BODY,
            fontWeight: 700,
            fontSize: 32,
            letterSpacing: 2,
            color: "rgba(245,245,242,0.75)",
          }}
        >
          12:00 · 16:00 · 19:30 UK
        </div>
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: (1440 + 423) / 2 + 36,
        height: 6,
        background: `linear-gradient(90deg, transparent 0%, ${COLOUR.amber} 30%, ${COLOUR.amber} 70%, transparent 100%)`,
      }}
    />
  </Field>
);

/** Avatar, 800x800: the mark on the field, readable at 48 px. */
export const Avatar: React.FC = () => (
  <Field>
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Img
        src={staticFile("logo.png")}
        style={{
          width: 560,
          height: 560,
          borderRadius: 120,
          boxShadow: `0 0 120px ${COLOUR.amber}55`,
        }}
      />
    </div>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 16,
        background: COLOUR.amber,
      }}
    />
  </Field>
);

export type ThumbProps = {
  headline: string;
  kicker: string; // e.g. "DELAYED", "REVIEWS ARE IN"
  game: string;
  imageSrc: string | null; // key art; the field shows when null
  accent: string;
  // A/B designs for YouTube's Test & compare: "split" (the default), "full" bleed art with a
  // short line, or "versus": last place against the winner.
  layout?: "split" | "full" | "versus" | "depth" | "clipping";
  image2Src?: string | null; // versus: the winner's art (imageSrc is last place)
  fgSrc?: string | null; // depth: the art's foreground cut-out (src/render/parallax.ts), set in front of the headline
  subjectX?: number; // depth: where the subject stands (0-1); the headline goes on the other side so it stays readable
  labels?: [string, string]; // versus: the two corner tags
};

/** Long-form thumbnail, 1280x720, in one of three designs. */
export const Thumb: React.FC<ThumbProps> = (p) =>
  p.layout === "full" ? (
    <FullThumb {...p} />
  ) : p.layout === "versus" ? (
    <VersusThumb {...p} />
  ) : p.layout === "depth" && p.fgSrc ? (
    <DepthThumb {...p} />
  ) : p.layout === "clipping" ? (
    <ClippingThumb {...p} />
  ) : (
    <SplitThumb {...p} />
  );

/**
 * The headline huge across the art with the subject standing in front of the letters (the cut-out from
 * the depth model): the thumbnail trick of the biggest creators.
 */
const DepthThumb: React.FC<ThumbProps> = ({ headline, kicker, imageSrc, fgSrc, accent, subjectX }) => {
  // The headline sits on the side away from the subject, only its edge tucked behind them.
  const side = subjectX === undefined ? "centre" : subjectX >= 0.5 ? "left" : "right";
  const box: React.CSSProperties =
    side === "centre"
      ? { left: 0, right: 0, textAlign: "center", padding: "0 40px" }
      : side === "left"
        ? { left: 56, width: 820, textAlign: "left" }
        : { right: 56, width: 820, textAlign: "right" };
  const size = side === "centre" ? (headline.length > 22 ? 150 : headline.length > 14 ? 190 : 230) : headline.length > 22 ? 118 : headline.length > 14 ? 140 : 170;
  return (
  <Field glow={accent}>
    {imageSrc ? <Img src={imageSrc} style={{ position: "absolute", inset: 0, width: 1280, height: 720, objectFit: "cover", filter: "brightness(0.8) saturate(1.1)" }} /> : null}
    <Shade to="linear-gradient(180deg, rgba(10,10,14,0.35) 0%, rgba(10,10,14,0.05) 45%, rgba(10,10,14,0.55) 100%)" />
    <div style={{ position: "absolute", top: side === "centre" ? 70 : 110, ...box }}>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: size,
          lineHeight: 0.9,
          color: COLOUR.paper,
          textTransform: "uppercase",
          textShadow: "0 10px 60px rgba(0,0,0,0.6)",
          letterSpacing: 1,
        }}
      >
        {titleLines(headline).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
    {fgSrc ? (
      <Img src={fgSrc} style={{ position: "absolute", inset: 0, width: 1280, height: 720, objectFit: "cover", filter: "drop-shadow(0 0 30px rgba(0,0,0,0.75)) saturate(1.12) contrast(1.05)" }} />
    ) : null}
    <div style={{ position: "absolute", left: 44, bottom: 44 }}>
      <Lockup size={36} />
    </div>
    {kicker ? (
      <div style={{ position: "absolute", right: 44, bottom: 44, padding: "8px 18px", background: accent, color: COLOUR.ink, fontFamily: BODY, fontWeight: 900, fontSize: 28, letterSpacing: 3, borderRadius: 8 }}>
        {kicker.toUpperCase()}
      </div>
    ) : null}
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: accent }} />
  </Field>
  );
};

/** The headline as a recreated newspaper cutting over dimmed art: the documentary's own look, never a real paper's. */
const ClippingThumb: React.FC<ThumbProps> = ({ headline, game, imageSrc, accent }) => (
  <Field glow={accent}>
    {imageSrc ? <Img src={imageSrc} style={{ position: "absolute", inset: 0, width: 1280, height: 720, objectFit: "cover", filter: "brightness(0.55) saturate(0.9)" }} /> : null}
    <div
      style={{
        position: "absolute",
        left: 70,
        top: 90,
        width: 820,
        padding: "26px 40px 50px",
        background: "#efe7d3",
        transform: "rotate(-3deg)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.7)",
        clipPath: "polygon(0 0, 100% 0, 100% 93%, 94% 97%, 87% 93%, 79% 98%, 70% 94%, 61% 98%, 52% 94%, 43% 98%, 34% 94%, 25% 98%, 16% 94%, 7% 98%, 0 94%)",
      }}
    >
      <div style={{ borderTop: "3px solid #2b2620", borderBottom: "1px solid #2b2620", padding: "6px 0", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 20, letterSpacing: 4, color: "#2b2620", textTransform: "uppercase" }}>
        {game || "Gaming"}
      </div>
      <div style={{ marginTop: 18, fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 700, fontSize: headline.length > 30 ? 70 : 86, lineHeight: 1.02, color: "#1d1915" }}>
        {headline}
      </div>
    </div>
    <div style={{ position: "absolute", right: 48, top: 44 }}>
      <Lockup size={38} />
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: accent }} />
  </Field>
);

const Shade: React.FC<{ to: string }> = ({ to }) => (
  <div style={{ position: "absolute", inset: 0, background: to }} />
);

const Big: React.FC<{ text: string; size: number; width: number; split?: boolean }> = ({ text, size, width, split = true }) => (
  <div
    style={{
      fontFamily: DISPLAY,
      fontSize: size,
      lineHeight: 0.95,
      color: COLOUR.paper,
      textShadow: "0 8px 40px rgba(0,0,0,0.9), 0 2px 0 rgba(0,0,0,0.6)",
      width,
      textTransform: "uppercase",
    }}
  >
    {/* "Call of Duty" on top, "Campaigns Ranked" underneath, as on the video's own title card. */}
    {(split ? titleLines(text) : [text]).map((l, i) => (
      <div key={i}>{l}</div>
    ))}
  </div>
);

/** Full-bleed art, a dark lower band and the headline large across it. */
const FullThumb: React.FC<ThumbProps> = ({ headline, kicker, imageSrc, accent }) => (
  <Field glow={accent}>
    {imageSrc ? <Img src={imageSrc} style={{ position: "absolute", inset: 0, width: 1280, height: 720, objectFit: "cover" }} /> : null}
    <Shade to="linear-gradient(180deg, rgba(10,10,14,0.15) 0%, rgba(10,10,14,0.1) 38%, rgba(10,10,14,0.92) 78%, #0a0a0e 100%)" />
    <div style={{ position: "absolute", right: 48, top: 44 }}>
      <Lockup size={38} />
    </div>
    <div style={{ position: "absolute", left: 56, bottom: 60 }}>
      {kicker && !headline.toUpperCase().includes(kicker.toUpperCase()) ? (
        <div style={{ display: "inline-block", padding: "6px 16px", background: accent, color: COLOUR.ink, fontFamily: BODY, fontWeight: 900, fontSize: 26, letterSpacing: 3, borderRadius: 8, marginBottom: 14 }}>
          {kicker.toUpperCase()}
        </div>
      ) : null}
      <Big text={headline} size={headline.length > 26 ? 96 : headline.length > 16 ? 118 : 140} width={1160} />
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: accent }} />
  </Field>
);

/** Last place against the winner, split down a slanted seam. */
const VersusThumb: React.FC<ThumbProps> = ({ headline, imageSrc, image2Src, accent, labels = ["WORST", "BEST"] }) => (
  <Field glow={accent}>
    {imageSrc ? (
      <Img src={imageSrc} style={{ position: "absolute", left: 0, top: 0, width: 760, height: 720, objectFit: "cover", filter: "grayscale(0.85) brightness(0.55)" }} />
    ) : null}
    {image2Src ? (
      <Img
        src={image2Src}
        style={{ position: "absolute", left: 520, top: 0, width: 760, height: 720, objectFit: "cover", clipPath: "polygon(30% 0, 100% 0, 100% 100%, 0 100%)" }}
      />
    ) : null}
    <div style={{ position: "absolute", left: 590, top: -20, width: 14, height: 780, background: accent, transform: "rotate(11.5deg)", transformOrigin: "50% 50%", boxShadow: `0 0 40px ${accent}` }} />
    <Shade to="linear-gradient(180deg, transparent 55%, rgba(10,10,14,0.9) 100%)" />
    {[labels[0], labels[1]].map((l, i) => (
      <div
        key={l}
        style={{
          position: "absolute",
          top: 40,
          [i ? "right" : "left"]: 44,
          padding: "8px 20px",
          background: i ? accent : "rgba(10,10,14,0.85)",
          color: i ? COLOUR.ink : COLOUR.paper,
          border: i ? "none" : `3px solid ${COLOUR.muted}`,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 34,
          letterSpacing: 3,
          borderRadius: 8,
        }}
      >
        {l}
      </div>
    ))}
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 52, display: "flex", justifyContent: "center", textAlign: "center" }}>
      <Big text={headline} size={headline.length > 28 ? 84 : 104} width={1180} split={false} />
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: accent }} />
  </Field>
);

/** Art on the right, three-word headline on the left, kicker chip, lockup. */
const SplitThumb: React.FC<ThumbProps> = ({
  headline,
  kicker,
  game,
  imageSrc,
  accent,
}) => (
  <Field glow={accent}>
    {imageSrc ? (
      <>
        <Img
          src={imageSrc}
          style={{
            position: "absolute",
            left: 520,
            top: 0,
            width: 760,
            height: 720,
            objectFit: "cover",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 480,
            top: 0,
            width: 420,
            height: 720,
            background: `linear-gradient(90deg, ${COLOUR.ink} 0%, transparent 100%)`,
          }}
        />
      </>
    ) : null}
    <div style={{ position: "absolute", left: 56, top: 56 }}>
      <Lockup size={44} />
    </div>
    <div style={{ position: "absolute", left: 56, top: 150, width: 640 }}>
      <div
        style={{
          display: "inline-block",
          padding: "8px 18px",
          background: accent,
          color: COLOUR.ink,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 28,
          letterSpacing: 3,
          borderRadius: 8,
        }}
      >
        {kicker.toUpperCase()}
      </div>
      <div
        style={{
          marginTop: 22,
          fontFamily: DISPLAY,
          // Three words sit at 120; a ranking's longer line steps down so it never runs off the frame.
          fontSize: headline.length > 30 ? 72 : headline.length > 18 ? 92 : 120,
          lineHeight: 0.98,
          color: COLOUR.paper,
          textShadow: "0 10px 50px rgba(0,0,0,0.8)",
          maxHeight: 400,
          overflow: "hidden",
        }}
      >
        {headline.toUpperCase()}
      </div>
      <div
        style={{
          marginTop: 20,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 30,
          letterSpacing: 3,
          color: COLOUR.muted,
          textTransform: "uppercase",
          // Kept inside the dark panel: the art starts at x=520.
          maxWidth: 420,
        }}
      >
        {game}
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 10,
        background: accent,
      }}
    />
  </Field>
);

export const SAMPLE_THUMB: ThumbProps = {
  headline: "Slips to 2027",
  kicker: "Delayed",
  game: "Starfield",
  imageSrc: null,
  accent: COLOUR.alert,
};
