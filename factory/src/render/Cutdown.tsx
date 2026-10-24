// A Short cut from a long ranking video: one entry's section, reframed for a
// phone. The 16:9 picture sits full width in the middle over a blurred copy of
// itself, a big question-style title above, word-by-word captions below and,
// at the end, a pointer to the full ranking.

import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "./brand.ts";
import { BODY, DISPLAY } from "./components/fonts.ts";
import { Captions } from "./components/Overlays.tsx";
import { displayWords, pageCaptions } from "./timeline.ts";
import { CONTENT_WIDTH, SAFE } from "./layout.ts";
import type { Word } from "../voice/elevenlabs.ts";

export type CutdownProps = {
  videoSrc: string; // the entry's 16:9 section, with its sound
  backgroundSrc: string | null; // the same section blurred and filled to 9:16, muted
  words: Word[];
  durationSeconds: number;
  title: string; // the big line on top, e.g. "THE BEST COD CAMPAIGN EVER?"
  kicker: string; // e.g. "#1 OF 8"
  cta: string; // e.g. "FULL RANKING ON THE CHANNEL"
  accent: string;
  emphasis: string[];
  logoSrc: string;
  /** A taller picture band (cropped at the sides), for gameplay where the footage is the point; 608 shows the full 16:9. */
  videoHeight?: number;
};

export const CUTDOWN_VIDEO_TOP = 560;
export const CUTDOWN_VIDEO_HEIGHT = 608; // 1080 wide at 16:9

const resolveSrc = (src: string) =>
  /^(https?:|data:|blob:)/.test(src) ? src : staticFile(src);

export const SAMPLE_CUTDOWN: CutdownProps = {
  videoSrc: "",
  backgroundSrc: null,
  words: [],
  durationSeconds: 20,
  title: "THE BEST CALL OF DUTY CAMPAIGN?",
  kicker: "#1 OF 8",
  cta: "FULL RANKING ON THE CHANNEL",
  accent: "#FF6B1A",
  emphasis: [],
  logoSrc: "logo.png",
};

export const Cutdown: React.FC<CutdownProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const pages = useMemo(
    () => pageCaptions(displayWords(props.words)),
    [props.words],
  );
  const emphasis = useMemo(
    () => new Set(props.emphasis.map((w) => w.toLowerCase())),
    [props.emphasis],
  );
  const intro = spring({ frame, fps, config: { damping: 200, mass: 0.6 } });
  const ctaFrom = durationInFrames - Math.round(3.5 * fps);
  const cta = spring({
    frame: frame - ctaFrom,
    fps,
    config: { damping: 14, mass: 0.6 },
  });
  const videoHeight = props.videoHeight ?? CUTDOWN_VIDEO_HEIGHT;
  const below = CUTDOWN_VIDEO_TOP + videoHeight;
  const titleSize =
    props.title.length > 30 ? 74 : props.title.length > 20 ? 86 : 100;
  return (
    <AbsoluteFill style={{ backgroundColor: COLOUR.ink }}>
      {props.backgroundSrc ? (
        <OffthreadVideo
          src={resolveSrc(props.backgroundSrc)}
          muted
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(11,11,14,0.78) 0%, rgba(11,11,14,0.35) 30%, rgba(11,11,14,0.35) 62%, rgba(11,11,14,0.85) 100%)",
        }}
      />
      {/* Brand lockup */}
      <div
        style={{
          position: "absolute",
          left: SAFE.left,
          top: 170,
          display: "flex",
          alignItems: "center",
          gap: 16,
          opacity: intro,
        }}
      >
        <Img
          src={resolveSrc(props.logoSrc)}
          style={{ width: 64, height: 64, borderRadius: 14 }}
        />
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: 44,
            letterSpacing: 2,
            color: COLOUR.paper,
          }}
        >
          PULSE GAMING
        </span>
        <span
          style={{
            marginLeft: 8,
            background: props.accent,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 30,
            padding: "6px 14px",
            borderRadius: 8,
            letterSpacing: 1,
          }}
        >
          {props.kicker}
        </span>
      </div>
      {/* The question */}
      <div
        style={{
          position: "absolute",
          left: SAFE.left,
          width: CONTENT_WIDTH,
          top: 300,
          height: 240,
          display: "flex",
          alignItems: "center",
          fontFamily: DISPLAY,
          fontSize: titleSize,
          lineHeight: 1.02,
          color: COLOUR.paper,
          textTransform: "uppercase",
          textShadow: "0 8px 30px rgba(0,0,0,0.8)",
          transform: `translateY(${interpolate(intro, [0, 1], [30, 0])}px)`,
          opacity: intro,
        }}
      >
        {props.title}
      </div>
      {/* The ranking's own picture, rank card and all */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: CUTDOWN_VIDEO_TOP,
          width: 1080,
          height: videoHeight,
          boxShadow: "0 30px 80px rgba(0,0,0,0.7)",
          borderTop: `4px solid ${props.accent}`,
          borderBottom: `4px solid ${props.accent}`,
          background: "#000",
        }}
      >
        {props.videoSrc ? (
          <OffthreadVideo
            src={resolveSrc(props.videoSrc)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
      </div>
      <Captions
        pages={pages}
        accent={props.accent}
        emphasis={emphasis}
        blankFromFrame={ctaFrom}
        centre={props.videoHeight ? below + 90 : undefined}
      />
      {frame >= ctaFrom ? (
        <div
          style={{
            position: "absolute",
            left: SAFE.left,
            width: CONTENT_WIDTH,
            top: props.videoHeight ? below + 40 : 1230,
            display: "flex",
            justifyContent: "center",
            transform: `scale(${interpolate(cta, [0, 1], [0.8, 1])})`,
            opacity: Math.min(1, cta),
          }}
        >
          <div
            style={{
              background: props.accent,
              color: COLOUR.ink,
              fontFamily: DISPLAY,
              fontSize: 64,
              padding: "20px 36px",
              borderRadius: 18,
              textAlign: "center",
              lineHeight: 1.05,
              boxShadow: "0 18px 50px rgba(0,0,0,0.6)",
            }}
          >
            {props.cta}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
