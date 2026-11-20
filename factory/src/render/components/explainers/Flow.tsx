// The step flow (1, 2, 3) and the cause-and-effect chain. Both build one card per item as the narrator reaches it,
// joined by connectors that draw themselves; the current card wears the accent edge and its disc fills. Steps are
// numbered; a chain carries no numbers and each new card lands with a shock ring, so it reads as "this causes that".
// Tall (the Short): cards stacked down the board. Wide (the long video): cards across it.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../brand.ts";
import {
  Board,
  clamp,
  Connector,
  Glass,
  IconDisc,
  Label,
  land,
  progress,
  ramp,
  useClock,
} from "./kit.tsx";
import { flowCardHeight, flowGap } from "./layout.ts";
import type { ExplainerProps } from "./types.ts";

const FlowBase: React.FC<ExplainerProps & { numbered: boolean }> = ({
  e,
  len,
  at,
  accent,
  backdrop,
  numbered,
}) => (
  <Board
    type={e.type}
    title={e.title}
    len={len}
    accent={accent}
    backdrop={backdrop}
  >
    {({ o, content }) => (
      <FlowBody
        e={e}
        at={at}
        accent={accent}
        numbered={numbered}
        o={o}
        content={content}
      />
    )}
  </Board>
);

const FlowBody: React.FC<{
  e: ExplainerProps["e"];
  at: number[];
  accent: string;
  numbered: boolean;
  o: "tall" | "wide";
  content: { left: number; top: number; width: number; height: number };
}> = ({ e, at, accent, numbered, o, content }) => {
  const { frame, fps } = useClock();
  const n = e.items.length;
  const { active } = progress(frame, at);
  const tall = o === "tall";
  const gap = tall ? flowGap(e.type) : 96;
  const cards = e.items.map((_, i) => {
    if (tall) {
      const h = flowCardHeight(e.type, o, n, e.title)!;
      const top =
        content.top +
        20 +
        i * (h + gap) +
        (content.height - 30 - n * h - (n - 1) * gap) / 2;
      return { left: content.left, top, width: content.width, height: h };
    }
    const w = (content.width - (n - 1) * gap) / n;
    const h = Math.min(400, content.height - 60);
    return {
      left: content.left + i * (w + gap),
      top: content.top + (content.height - h) / 2,
      width: w,
      height: h,
    };
  });
  const disc = tall ? Math.min(118, cards[0]!.height - 36) : 132;
  return (
    <>
      <svg
        width={content.left * 2 + content.width}
        height={content.top + content.height + 40}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
      >
        {cards.slice(1).map((c, k) => {
          const a = cards[k]!;
          const pts: Array<[number, number]> = tall
            ? [
                [a.left + 26 + disc / 2, a.top + a.height + 4],
                [c.left + 26 + disc / 2, c.top - 8],
              ]
            : [
                [a.left + a.width + 10, a.top + a.height / 2],
                [c.left - 14, c.top + c.height / 2],
              ];
          return (
            <Connector
              key={k}
              pts={pts}
              frame={frame}
              from={at[k]! + 6}
              to={Math.max(at[k]! + 14, at[k + 1]! + 2)}
              accent={accent}
              width={numbered ? 6 : 9}
            />
          );
        })}
      </svg>
      {e.items.map((it, i) => {
        const p = land(frame, fps, at[i]!);
        if (frame < at[i]! - 1) return null;
        const c = cards[i]!;
        const fill = ramp(frame, at[i]!, at[i]! + 16);
        const isActive = i === active;
        const shock =
          !numbered && i > 0
            ? interpolate(frame, [at[i]!, at[i]! + 18], [0, 1], clamp)
            : 1;
        return (
          <React.Fragment key={i}>
            {!numbered && i > 0 && shock < 1 ? (
              <div
                style={{
                  position: "absolute",
                  left: c.left + c.width / 2 - 260 * shock,
                  top: c.top + c.height / 2 - 260 * shock,
                  width: 520 * shock,
                  height: 520 * shock,
                  borderRadius: "50%",
                  border: `4px solid ${accent}`,
                  opacity: 0.55 * (1 - shock),
                }}
              />
            ) : null}
            <Glass
              frame={frame}
              at={at[i]!}
              active={isActive}
              done={i < active}
              accent={accent}
              style={{
                left: c.left,
                top: c.top,
                width: c.width,
                height: c.height,
                opacity: Math.min(1, p * 1.4),
                transform: tall
                  ? `translateX(${(1 - p) * 60}px) scale(${0.94 + 0.06 * p})`
                  : `translateY(${(1 - p) * 50}px) scale(${0.92 + 0.08 * p})`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: tall ? "row" : "column",
                  alignItems: "center",
                  justifyContent: tall ? "flex-start" : "center",
                  gap: tall ? 28 : 30,
                  padding: tall ? "0 40px 0 26px" : "24px",
                }}
              >
                <IconDisc
                  icon={it.icon}
                  size={disc}
                  accent={accent}
                  p={fill}
                  active={isActive}
                  number={numbered ? i + 1 : undefined}
                />
                <Label
                  title={e.title}
                  text={it.label}
                  type={e.type}
                  o={o}
                  n={n}
                  align={tall ? "left" : "center"}
                  colour={COLOUR.paper}
                />
              </div>
            </Glass>
          </React.Fragment>
        );
      })}
    </>
  );
};

export const StepFlow: React.FC<ExplainerProps> = (p) => (
  <FlowBase {...p} numbered />
);
export const CauseChain: React.FC<ExplainerProps> = (p) => (
  <FlowBase {...p} numbered={false} />
);
