// Preview entry for the explainers (data/smoke/explainers.mts): one line's explainer on the upright Short frame
// (ExplainerTall, 1080x1920) or the long video's wide frame (ExplainerWide, 1920x1080), with the narrator's voice
// under it when given, and on the tall frame the caption line the Short would draw, so the board can be judged with
// the real caption band beneath it. Guides shade the Short's no-go bands when asked.
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  registerRoot,
  Sequence,
  useCurrentFrame,
} from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY } from "../../fonts.ts";
import type { TimedWord } from "../ground.ts";
import { ExplainerShot } from "../index.tsx";
import type { Explainer } from "../types.ts";

type Props = {
  e: Explainer;
  len: number;
  words: TimedWord[];
  accent: string;
  backdrop?: string;
  /** The voice file and the second the window starts in it. */
  audio?: string;
  audioFrom?: number;
  caption?: boolean;
  guides?: boolean;
};

const View: React.FC<Props & { fps: number; tall: boolean }> = ({
  e,
  len,
  words,
  accent,
  backdrop,
  audio,
  audioFrom = 0,
  caption,
  guides,
  fps,
  tall,
}) => (
  <AbsoluteFill style={{ background: COLOUR.ink }}>
    <ExplainerShot
      e={e}
      len={len}
      words={words}
      fps={fps}
      accent={accent}
      backdrop={backdrop}
    />
    {audio ? (
      <Sequence from={0}>
        <Audio src={audio} startFrom={Math.round(audioFrom * fps)} />
      </Sequence>
    ) : null}
    {tall && caption ? <CaptionLine words={words} fps={fps} /> : null}
    {tall && guides ? (
      <>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 1080,
            height: 150,
            background: "rgba(255,0,0,0.12)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 1620,
            width: 1080,
            height: 300,
            background: "rgba(255,0,0,0.12)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 920,
            top: 1000,
            width: 160,
            height: 620,
            background: "rgba(255,0,0,0.08)",
          }}
        />
      </>
    ) : null}
  </AbsoluteFill>
);

/** The words being spoken, about five at a time, where the Short's caption block sits (layout.ts CAPTION_CENTRE). */
const CaptionLine: React.FC<{ words: TimedWord[]; fps: number }> = ({
  words,
  fps,
}) => {
  const frame = useCurrentFrame();
  const t = frame / fps;
  const next = words.findIndex((w) => w.start > t);
  const k = next < 0 ? words.length - 1 : Math.max(0, next - 1);
  const page = Math.floor(k / 5) * 5;
  const shown = words.slice(page, page + 5);
  if (!shown.length || t < (words[0]?.start ?? 0) - 0.1) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 64,
        width: 952,
        top: 1270,
        textAlign: "center",
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: 70,
        color: COLOUR.paper,
        textShadow: "0 4px 16px rgba(0,0,0,0.9)",
      }}
    >
      {shown.map((w, i) => (
        <span
          key={i}
          style={{ color: page + i === k ? COLOUR.amber : COLOUR.paper }}
        >
          {w.text}{" "}
        </span>
      ))}
    </div>
  );
};

const defaults: Props = {
  e: { type: "steps", title: "", items: [] },
  len: 150,
  words: [],
  accent: COLOUR.amber,
};

const Root: React.FC = () => (
  <>
    <Composition
      id="ExplainerTall"
      component={(p: Props) => <View {...p} fps={30} tall />}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={150}
      defaultProps={defaults}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, props.len),
      })}
    />
    <Composition
      id="ExplainerWide"
      component={(p: Props) => <View {...p} fps={30} tall={false} />}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={150}
      defaultProps={defaults}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, props.len),
      })}
    />
  </>
);

registerRoot(Root);
