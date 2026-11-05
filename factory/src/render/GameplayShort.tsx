// The rebuilt gameplay Short (src/gameplaydirect.ts): the owner's footage full screen from the first frame, with the
// spoken hook already on it, one line of captions, a result stamp as the outcome lands and nothing else. Nothing
// fades in: the first frame has to read in a feed.

import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
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

export type GameplayShortProps = {
  videoSrc: string; // full-screen 1080x1920, with the game's own sound
  voiceSrc: string | null;
  words: Word[];
  durationSeconds: number;
  hook: string;
  /** When the hook has been said; its big line goes and the captions take over. */
  hookEnd: number;
  resultLine: string;
  payoffAt: number;
  /** The narrator's stretches, where the game's sound drops under the voice. */
  voiced: Array<{ start: number; end: number }>;
  accent: string;
};

export const SAMPLE_GAMEPLAY_SHORT: GameplayShortProps = {
  videoSrc: "",
  voiceSrc: null,
  words: [],
  durationSeconds: 15,
  hook: "CAN YOU OUTSWIM FIVE STARS?",
  hookEnd: 2,
  resultLine: "THE COPS GAVE UP",
  payoffAt: 10,
  voiced: [],
  accent: "#FF6B1A",
};

const resolveSrc = (src: string) =>
  /^(https?:|data:|blob:)/.test(src) ? src : staticFile(src);

/** The game's volume at a time: 1 alone, low under the voice, with a quick ramp so the payoff arrives whole (pure). */
export function gameVolume(
  t: number,
  voiced: GameplayShortProps["voiced"],
  low = 0.22,
  ramp = 0.15,
): number {
  let v = 1;
  for (const s of voiced) {
    if (t >= s.start && t <= s.end) return low;
    if (t < s.start && s.start - t < ramp)
      v = Math.min(v, low + ((1 - low) * (s.start - t)) / ramp);
    if (t > s.end && t - s.end < ramp)
      v = Math.min(v, low + ((1 - low) * (t - s.end)) / ramp);
  }
  return v;
}

export const GameplayShort: React.FC<GameplayShortProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  // The hook's own words are the big line, so the captions start after them: never the same words twice.
  const pages = useMemo(
    () =>
      pageCaptions(
        displayWords(
          props.words.filter((w) => w.start >= props.hookEnd - 0.05),
        ),
      ),
    [props.words, props.hookEnd],
  );
  const noEmphasis = useMemo(() => new Set<string>(), []);
  const payoffFrame = Math.round(props.payoffAt * fps);
  const stamp = spring({
    frame: frame - payoffFrame,
    fps,
    config: { damping: 12, mass: 0.5 },
  });
  const stampOn = t >= props.payoffAt && t < props.payoffAt + 2.4;
  // A small push as the outcome lands, on the picture rather than a graphic.
  const push = interpolate(frame, [payoffFrame, payoffFrame + 12], [1, 1.06], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const hookSize =
    props.hook.length > 34 ? 86 : props.hook.length > 22 ? 100 : 118;
  return (
    <AbsoluteFill style={{ backgroundColor: COLOUR.ink }}>
      {props.videoSrc ? (
        <OffthreadVideo
          src={resolveSrc(props.videoSrc)}
          volume={(f) => gameVolume(f / fps, props.voiced)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${push})`,
          }}
        />
      ) : null}
      {props.voiceSrc ? <Audio src={resolveSrc(props.voiceSrc)} /> : null}
      {t < props.hookEnd ? (
        <div
          style={{
            position: "absolute",
            left: SAFE.left,
            width: CONTENT_WIDTH,
            top: 300,
            fontFamily: DISPLAY,
            fontSize: hookSize,
            lineHeight: 1.04,
            color: COLOUR.paper,
            textTransform: "uppercase",
            textAlign: "center",
            textShadow:
              "0 0 6px rgba(0,0,0,0.95), 0 6px 26px rgba(0,0,0,0.9), 0 0 2px #000",
          }}
        >
          {props.hook}
        </div>
      ) : null}
      {stampOn ? (
        <div
          style={{
            position: "absolute",
            left: SAFE.left,
            width: CONTENT_WIDTH,
            top: 320,
            display: "flex",
            justifyContent: "center",
            transform: `scale(${interpolate(stamp, [0, 1], [1.5, 1])}) rotate(-2deg)`,
            opacity: Math.min(1, stamp * 2),
          }}
        >
          <div
            style={{
              background: props.accent,
              color: COLOUR.ink,
              fontFamily: DISPLAY,
              fontSize: 78,
              lineHeight: 1.04,
              padding: "16px 30px",
              borderRadius: 14,
              textAlign: "center",
              textTransform: "uppercase",
              boxShadow: "0 18px 50px rgba(0,0,0,0.6)",
            }}
          >
            {props.resultLine}
          </div>
        </div>
      ) : null}
      <Captions
        pages={pages}
        accent={props.accent}
        emphasis={noEmphasis}
        blankFromFrame={Number.MAX_SAFE_INTEGER}
      />
      <div
        style={{
          position: "absolute",
          left: SAFE.left,
          top: 170,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 30,
          letterSpacing: 1,
          color: "rgba(255,255,255,0.75)",
          textShadow: "0 2px 8px rgba(0,0,0,0.9)",
        }}
      >
        @PulseGMG
      </div>
    </AbsoluteFill>
  );
};
