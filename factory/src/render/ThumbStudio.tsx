// The thumbnail overhaul (owner, 27 Oct 2026: "I really need to stand out with unique thumbnails in my niche
// to blow the competition out the water"). Designs built on the niche study (1,598 thumbnails: 1-6 words
// beat 7+, nostalgia 1.37x, mystery 1.19x, comparisons 1.15x) and the big creators' tricks: one huge subject
// with a glowing rim, few words in heavy outlined type with one word in the accent, a giant number filled
// with the game, the hardware of an old game's day, a circle on the thing that matters, a hard versus.
// Every design carries the same Pulse signature (the lockup and the amber bar) so the channel is
// recognisable at a glance in a crowded feed.

import React from "react";
import { AbsoluteFill, Freeze, Img, staticFile } from "remotion";
import { ALL_MOTIFS } from "./components/motifs/index.ts";
import { COLOUR } from "./brand.ts";
import { BODY, DISPLAY, HAND } from "./components/fonts.ts";

export type StudioThumbProps = {
  headline: string;
  kicker: string;
  game: string;
  imageSrc: string | null;
  image2Src?: string | null;
  fgSrc?: string | null;
  subjectX?: number;
  accent: string;
  labels?: [string, string];
  year?: string;
  /** Mystery: the thing to circle, as fractions of the picture (x, y, w, h). */
  focus?: [number, number, number, number];
};

const W = 1280;
const H = 720;

/** The words as heavy outlined type, one word (a number if there is one, else the last) in the accent. */
const Words: React.FC<{
  text: string;
  size: number;
  accent: string;
  align?: "left" | "right" | "center";
  width?: number;
}> = ({ text, size, accent, align = "left", width = 760 }) => {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  const hot = words.findIndex((w) => /\d/.test(w));
  const lit = hot >= 0 ? hot : words.length - 1;
  return (
    <div style={{ width, textAlign: align, lineHeight: 0.92 }}>
      {words.map((w, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            marginRight: "0.18em",
            fontFamily: DISPLAY,
            fontSize: size,
            color: i === lit ? accent : COLOUR.paper,
            WebkitTextStroke: `${Math.round(size / 24)}px #050507`,
            paintOrder: "stroke fill",
            textShadow: `0 ${Math.round(size / 18)}px ${Math.round(size / 5)}px rgba(0,0,0,0.75)`,
          }}
        >
          {w}
        </span>
      ))}
    </div>
  );
};

/** Font size for the headline: as big as its length allows. */
const sizeFor = (text: string, max: number) => {
  const n = text.length;
  return n <= 8
    ? max
    : n <= 14
      ? max * 0.82
      : n <= 22
        ? max * 0.68
        : max * 0.55;
};

/** The Pulse signature on every design: the lockup and the format tag bottom left, the amber bar. */
const Signature: React.FC<{
  kicker: string;
  accent: string;
  corner?: "left" | "right";
}> = ({ kicker, accent, corner = "left" }) => (
  <>
    <div
      style={{
        position: "absolute",
        bottom: 34,
        [corner]: 36,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px 8px 10px",
        background: "rgba(5,5,7,0.82)",
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      <Img
        src={staticFile("logo.png")}
        style={{ width: 44, height: 44, borderRadius: 10 }}
      />
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 34,
          color: COLOUR.paper,
          letterSpacing: 1,
        }}
      >
        PULSE
      </div>
      {kicker ? (
        <div
          style={{
            marginLeft: 6,
            padding: "4px 10px",
            background: accent,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 20,
            letterSpacing: 2,
            borderRadius: 6,
          }}
        >
          {kicker.toUpperCase()}
        </div>
      ) : null}
    </div>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 12,
        background: accent,
      }}
    />
  </>
);

/** The art behind, blurred, darkened and washed in the accent and a cool shadow tone for punch. */
const Graded: React.FC<{
  src: string | null;
  blur?: number;
  dark?: number;
  accent: string;
}> = ({ src, blur = 0, dark = 0.6, accent }) => (
  <>
    {src ? (
      <Img
        src={src}
        style={{
          position: "absolute",
          inset: -40,
          width: W + 80,
          height: H + 80,
          objectFit: "cover",
          filter: `blur(${blur}px) brightness(${dark}) saturate(1.25) contrast(1.15)`,
        }}
      />
    ) : (
      <AbsoluteFill style={{ background: "#0b0b0e" }} />
    )}
    <AbsoluteFill
      style={{
        background: `linear-gradient(120deg, ${accent}55 0%, rgba(0,0,0,0) 45%, rgba(20,60,110,0.45) 100%)`,
        mixBlendMode: "overlay",
      }}
    />
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(90% 90% at 50% 50%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.65) 100%)",
      }}
    />
  </>
);

/** One huge subject cut out with a glowing rim, the words on the other side. */
export const HeroThumb: React.FC<StudioThumbProps> = ({
  headline,
  kicker,
  imageSrc,
  fgSrc,
  subjectX = 0.6,
  accent,
}) => {
  const right = subjectX >= 0.5;
  const size = sizeFor(headline, 190);
  return (
    <AbsoluteFill style={{ background: "#060608", overflow: "hidden" }}>
      <Graded src={imageSrc} blur={5} dark={0.5} accent={accent} />
      {/* A burst of light behind the subject. */}
      <div
        style={{
          position: "absolute",
          top: -100,
          [right ? "right" : "left"]: -60,
          width: 820,
          height: 920,
          background: `radial-gradient(closest-side, ${accent}aa 0%, ${accent}33 45%, rgba(0,0,0,0) 75%)`,
        }}
      />
      {fgSrc ? (
        <Img
          src={fgSrc}
          style={{
            position: "absolute",
            inset: 0,
            width: W,
            height: H,
            objectFit: "cover",
            transformOrigin: `${subjectX * 100}% 85%`,
            transform: "scale(1.22)",
            filter:
              "drop-shadow(4px 0 0 #fff) drop-shadow(-4px 0 0 #fff) drop-shadow(0 4px 0 #fff) drop-shadow(0 -4px 0 #fff) drop-shadow(0 0 26px rgba(255,150,70,0.85)) saturate(1.2) contrast(1.1)",
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          top: 70,
          [right ? "left" : "right"]: 50,
        }}
      >
        <Words
          text={headline}
          size={size}
          accent={accent}
          align={right ? "left" : "right"}
          width={700}
        />
      </div>
      <Signature
        kicker={kicker}
        accent={accent}
        corner={right ? "left" : "right"}
      />
    </AbsoluteFill>
  );
};

/** The number enormous, the game showing through it, edged in light; the other words beside it. */
export const NumberThumb: React.FC<StudioThumbProps> = ({
  headline,
  kicker,
  imageSrc,
  accent,
}) => {
  const words = headline.toUpperCase().split(/\s+/).filter(Boolean);
  const k = words.findIndex((w) => /\d/.test(w));
  const figure = k >= 0 ? words[k]! : (words[0] ?? "");
  const rest = words.filter((_, i) => i !== k).join(" ");
  const figSize =
    figure.length <= 2
      ? 520
      : figure.length <= 4
        ? 400
        : figure.length <= 6
          ? 300
          : 230;
  return (
    <AbsoluteFill style={{ background: "#060608", overflow: "hidden" }}>
      <Graded src={imageSrc} blur={14} dark={0.32} accent={accent} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          padding: "0 50px",
          gap: 30,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: figSize,
            lineHeight: 0.86,
            letterSpacing: -4,
            color: "transparent",
            backgroundImage: imageSrc ? `url(${imageSrc})` : undefined,
            backgroundColor: imageSrc ? undefined : accent,
            backgroundSize: "cover",
            backgroundPosition: "center",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextStroke: "5px #fff",
            filter: `brightness(1.35) saturate(1.4) contrast(1.15) drop-shadow(0 0 30px ${accent})`,
            whiteSpace: "nowrap",
          }}
        >
          {figure}
        </div>
        {rest ? (
          <Words
            text={rest}
            size={sizeFor(rest, 150)}
            accent={accent}
            width={560}
          />
        ) : null}
      </div>
      <Signature kicker={kicker} accent={accent} />
    </AbsoluteFill>
  );
};

/** An old game on the TV of its day, its tape leaning in front with the name in marker. Nostalgia sells. */
export const RetroThumb: React.FC<StudioThumbProps> = ({
  headline,
  kicker,
  imageSrc,
  accent,
  game,
  year,
}) => (
  <AbsoluteFill
    style={{
      overflow: "hidden",
      background:
        "radial-gradient(60% 70% at 70% 30%, rgba(255,168,92,0.22) 0%, rgba(255,168,92,0) 70%), linear-gradient(180deg, #2a2119 0%, #17120e 70%, #0c0907 100%)",
    }}
  >
    {/* The TV, slightly turned, glowing. */}
    <div
      style={{
        position: "absolute",
        right: 70,
        top: 70,
        width: 640,
        height: 500,
        borderRadius: 36,
        background: "linear-gradient(180deg, #3b3835 0%, #24221f 100%)",
        boxShadow: `0 40px 80px rgba(0,0,0,0.75), 0 0 120px ${accent}44`,
        transform: "perspective(1400px) rotateY(-14deg)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 44,
          top: 40,
          width: 552,
          height: 380,
          borderRadius: 30,
          overflow: "hidden",
          background: "#000",
        }}
      >
        {imageSrc ? (
          <Img
            src={imageSrc}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "saturate(1.3) contrast(1.15) brightness(1.1)",
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(180deg, rgba(0,0,0,0.3) 0px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 4px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(110% 100% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.7) 100%), linear-gradient(130deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 35%)",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 50,
          bottom: 26,
          width: 12,
          height: 12,
          borderRadius: 6,
          background: "#ff4a3a",
          boxShadow: "0 0 12px #ff4a3a",
        }}
      />
    </div>
    {/* The tape. */}
    <div
      style={{
        position: "absolute",
        right: 470,
        bottom: 46,
        width: 380,
        height: 220,
        borderRadius: 10,
        background: "linear-gradient(180deg, #1d1d20 0%, #0f0f11 100%)",
        transform: "rotate(-8deg)",
        boxShadow: "0 24px 50px rgba(0,0,0,0.8)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 22,
          right: 22,
          top: 20,
          height: 92,
          background: "#efeadd",
          borderRadius: 4,
          padding: "8px 14px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ height: 3, background: "#c94a36", marginBottom: 6 }} />
        <div
          style={{
            fontFamily: HAND,
            fontSize: game.length > 18 ? 24 : 30,
            color: "#1c1a17",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {game}
        </div>
        {year ? (
          <div style={{ fontFamily: HAND, fontSize: 20, color: "#6a5f55" }}>
            {year}
          </div>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          left: 100,
          right: 100,
          top: 130,
          height: 64,
          borderRadius: 8,
          background: "#060607",
        }}
      />
    </div>
    <div style={{ position: "absolute", left: 50, top: 60 }}>
      <Words
        text={headline}
        size={sizeFor(headline, 160)}
        accent={accent}
        width={560}
      />
    </div>
    <Signature kicker={kicker} accent={accent} />
  </AbsoluteFill>
);

/** The art full bleed with a hand-drawn red circle on the thing that matters and an arrow from the words. */
export const MysteryThumb: React.FC<StudioThumbProps> = ({
  headline,
  kicker,
  imageSrc,
  accent,
  focus,
}) => {
  const [fx, fy, fw, fh] = focus ?? [0.6, 0.35, 0.18, 0.22];
  const cx = (fx + fw / 2) * W;
  const cy = (fy + fh / 2) * H;
  const rx = Math.max(70, (fw * W) / 2 + 26);
  const ry = Math.max(60, (fh * H) / 2 + 22);
  const textLeft = cx > W / 2;
  return (
    <AbsoluteFill style={{ background: "#060608", overflow: "hidden" }}>
      <Graded src={imageSrc} dark={0.78} accent={accent} />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <ellipse
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill="none"
          stroke="#ff2a2a"
          strokeWidth={12}
          transform={`rotate(-6 ${cx} ${cy})`}
          style={{ filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.6))" }}
        />
        <ellipse
          cx={cx + 6}
          cy={cy - 4}
          rx={rx + 10}
          ry={ry + 6}
          fill="none"
          stroke="#ff2a2a"
          strokeWidth={6}
          opacity={0.7}
          transform={`rotate(-3 ${cx} ${cy})`}
        />
        {/* The arrow from the words to the circle. */}
        <path
          d={
            textLeft
              ? `M ${cx - rx - 230} ${cy + 120} Q ${cx - rx - 110} ${cy + 90} ${cx - rx - 14} ${cy + 20}`
              : `M ${cx + rx + 230} ${cy + 120} Q ${cx + rx + 110} ${cy + 90} ${cx + rx + 14} ${cy + 20}`
          }
          stroke="#ff2a2a"
          strokeWidth={12}
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          bottom: 110,
          [textLeft ? "left" : "right"]: 46,
        }}
      >
        <Words
          text={headline}
          size={sizeFor(headline, 150)}
          accent={accent}
          width={620}
          align={textLeft ? "left" : "right"}
        />
      </div>
      <Signature
        kicker={kicker}
        accent={accent}
        corner={textLeft ? "left" : "right"}
      />
    </AbsoluteFill>
  );
};

/** Two games split on a hard diagonal, a glowing VS on the seam, their places in the corners. */
export const ClashThumb: React.FC<StudioThumbProps> = ({
  headline,
  kicker,
  imageSrc,
  image2Src,
  accent,
  labels = ["WORST", "BEST"],
}) => (
  <AbsoluteFill style={{ background: "#060608", overflow: "hidden" }}>
    {imageSrc ? (
      <Img
        src={imageSrc}
        style={{
          position: "absolute",
          inset: 0,
          width: W,
          height: H,
          objectFit: "cover",
          clipPath: "polygon(0 0, 58% 0, 42% 100%, 0 100%)",
          filter: "saturate(0.6) brightness(0.65) contrast(1.1)",
        }}
      />
    ) : null}
    {image2Src ? (
      <Img
        src={image2Src}
        style={{
          position: "absolute",
          inset: 0,
          width: W,
          height: H,
          objectFit: "cover",
          clipPath: "polygon(58% 0, 100% 0, 100% 100%, 42% 100%)",
          filter: "saturate(1.35) brightness(1.05) contrast(1.15)",
        }}
      />
    ) : null}
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      <line
        x1={W * 0.58}
        y1={0}
        x2={W * 0.42}
        y2={H}
        stroke="#fff"
        strokeWidth={14}
      />
      <line
        x1={W * 0.58}
        y1={0}
        x2={W * 0.42}
        y2={H}
        stroke={accent}
        strokeWidth={6}
      />
    </svg>
    <div
      style={{
        position: "absolute",
        left: W / 2 - 90,
        top: H / 2 - 90,
        width: 180,
        height: 180,
        borderRadius: 90,
        background: COLOUR.ink,
        border: `8px solid ${accent}`,
        boxShadow: `0 0 50px ${accent}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: DISPLAY,
        fontSize: 92,
        color: COLOUR.paper,
      }}
    >
      VS
    </div>
    {[0, 1].map((i) => (
      <div
        key={i}
        style={{
          position: "absolute",
          top: 40,
          [i === 0 ? "left" : "right"]: 40,
          padding: "6px 22px",
          background: i === 0 ? "#2a2a30" : accent,
          color: i === 0 ? COLOUR.paper : COLOUR.ink,
          fontFamily: DISPLAY,
          fontSize: 64,
          borderRadius: 10,
          transform: `rotate(${i === 0 ? -4 : 4}deg)`,
          boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
        }}
      >
        {labels[i]}
      </div>
    ))}
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 74,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <Words
        text={headline}
        size={sizeFor(headline, 120)}
        accent={accent}
        align="center"
        width={1180}
      />
    </div>
    <Signature kicker={kicker} accent={accent} />
  </AbsoluteFill>
);

/**
 * The video's own look (src/render/components/motifs): its series', console's or genre's card frozen at
 * its best moment, carrying the thumbnail's words, with the Pulse signature. Bespoke to every topic.
 */
export const MotifThumb: React.FC<
  StudioThumbProps & { motif?: string; pictureSrcs?: string[] }
> = (p) => {
  const m = ALL_MOTIFS.find((x) => x.id === p.motif);
  if (!m?.card) return p.fgSrc ? <HeroThumb {...p} /> : <NumberThumb {...p} />;
  const pictures = (p.pictureSrcs?.length ? p.pictureSrcs : [p.imageSrc, p.image2Src]).filter(
    (x): x is string => Boolean(x),
  );
  return (
    <AbsoluteFill style={{ background: "#060608", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          transform: `scale(${W / 1920})`,
          transformOrigin: "0 0",
        }}
      >
        <Freeze frame={72}>
          {React.createElement(m.card, {
            heading: p.headline,
            kicker: p.kicker,
            game: p.game,
            year: p.year,
            pictures,
            frames: 120,
            variant: 0,
          })}
        </Freeze>
      </div>
      <Signature kicker="" accent={p.accent} corner="right" />
    </AbsoluteFill>
  );
};
