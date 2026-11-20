// Before and after, or this against that: two cards that slide in from either side as the narrator names them, each
// value counting up from zero when it is a figure, with bars under them when both share a unit (so "the same 30 FPS
// target" reads as two equal bars and $79.99 against $99.99 as a shorter and a longer one). The side the line is
// about wears the accent; a VS badge pulses between them.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { figure } from "./ground.ts";
import {
  Board,
  clamp,
  easeOut,
  formatLike,
  Glass,
  IconDisc,
  Label,
  land,
  progress,
  ramp,
  useClock,
  Value,
} from "./kit.tsx";
import type { ExplainerProps } from "./types.ts";

/** What a value counts in, its figure taken out ("$79.99" "$", "30 FPS target" "FPS target"). */
export function unitOf(value: string): string {
  return value
    .replace(/[\d.,]+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const Versus: React.FC<ExplainerProps> = ({
  e,
  len,
  at,
  accent,
  backdrop,
}) => (
  <Board
    type="versus"
    title={e.title}
    len={len}
    accent={accent}
    backdrop={backdrop}
  >
    {({ o, content }) => (
      <VersusBody
        e={e}
        at={at}
        accent={accent}
        o={o}
        content={content}
        len={len}
      />
    )}
  </Board>
);

const VersusBody: React.FC<{
  e: ExplainerProps["e"];
  at: number[];
  accent: string;
  len: number;
  o: "tall" | "wide";
  content: { left: number; top: number; width: number; height: number };
}> = ({ e, at, accent, o, content }) => {
  const { frame, fps } = useClock();
  const { active } = progress(frame, at);
  const tall = o === "tall";
  const gap = 120;
  const w = (content.width - gap) / 2;
  const h = Math.min(tall ? 640 : 560, content.height - 30);
  const top = content.top + (content.height - h) / 2;
  const nums = e.items.map((x) => figure(x.value));
  const units = e.items.map((x) => unitOf(x.value ?? ""));
  const bars =
    nums.every((x) => x !== undefined && x > 0) && units[0] === units[1];
  const max = bars ? Math.max(...nums.map((x) => x!)) : 1;
  const lead = e.items.findIndex((x) => x.lead);
  const vsIn = land(frame, fps, Math.min(at[0]!, at[1]!) + 8);
  const pulse = 0.5 + 0.5 * Math.sin(frame / 7);
  return (
    <>
      {e.items.map((it, i) => {
        if (frame < at[i]! - 1) return null;
        const p = land(frame, fps, at[i]!);
        const count = ramp(frame, at[i]! + 2, at[i]! + 26);
        const colour = lead < 0 || lead === i ? accent : "#9AA3B5";
        const n = nums[i];
        const shown =
          n !== undefined &&
          it.value &&
          (it.value.match(/\d[\d,.]*/g) ?? []).length === 1
            ? formatLike(it.value, n * count)
            : (it.value ?? "");
        const bar = bars
          ? (nums[i]! / max) * easeOut(ramp(frame, at[i]! + 4, at[i]! + 30))
          : 0;
        const left = content.left + i * (w + gap);
        return (
          <Glass
            key={i}
            frame={frame}
            at={at[i]!}
            active={i === active}
            done={i < active}
            accent={colour}
            style={{
              left,
              top,
              width: w,
              height: h,
              opacity: Math.min(1, p * 1.4),
              transform: `translateX(${(1 - p) * (i === 0 ? -90 : 90)}px) scale(${0.94 + 0.06 * p})`,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: tall ? 26 : 22,
                padding: "30px 30px",
              }}
            >
              <IconDisc
                icon={it.icon}
                size={tall ? 116 : 104}
                accent={colour}
                p={count}
                active={i === active}
              />
              <Value text={shown} type="versus" o={o} n={2} colour={colour} />
              <Label
                text={it.label}
                type="versus"
                o={o}
                n={2}
                align="center"
                colour={COLOUR.paper}
              />
              {bars ? (
                <div
                  style={{
                    width: w - 90,
                    height: 26,
                    borderRadius: 13,
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden",
                    marginTop: 8,
                  }}
                >
                  <div
                    style={{
                      width: `${bar * 100}%`,
                      height: "100%",
                      borderRadius: 13,
                      background: `linear-gradient(90deg, ${colour}AA, ${colour})`,
                      boxShadow: `0 0 18px ${colour}88`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          </Glass>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: content.left + w + gap / 2 - 52,
          top: top + h / 2 - 52,
          width: 104,
          height: 104,
          borderRadius: "50%",
          background: COLOUR.ink,
          boxShadow: `0 0 0 3px ${accent}, 0 0 ${20 + 18 * pulse}px ${accent}88`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: interpolate(vsIn, [0, 1], [0, 1], clamp),
          transform: `scale(${0.6 + 0.4 * vsIn})`,
          fontFamily: DISPLAY,
          fontSize: 44,
          color: COLOUR.paper,
        }}
      >
        <span
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 40,
            letterSpacing: 1,
          }}
        >
          VS
        </span>
      </div>
    </>
  );
};
