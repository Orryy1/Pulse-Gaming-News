// Paper/Calendar: a tear-off desk calendar. Its pages flip up and tear away in quick succession, then it
// settles on the date the sentence names: the month across the top band, the day large if given, the year
// beneath. What happened is written on a strip of masking tape stuck below. The torn pages carry no
// figures of their own, only the band, so nothing appears that the source did not give.

import React from "react";
import { Easing, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY, HAND } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import { DRAWN_BY, fitBlock } from "../fit.ts";
import {
  GRAIN,
  INK,
  MOTTLE,
  SHEET_LIGHT,
  Tape,
  Write,
  clamp,
  clean,
  jit,
} from "./kit.tsx";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?/i;
const YEAR_RE = /\b(1[89]\d\d|20\d\d)\b/;

export type CalendarDate = {
  month?: number;
  day?: number;
  year?: string;
  rest?: string;
};

/** "September 17, 2013", "17 September 2013", "Sept. 2013", "2013-09-17", "Fall 2013". */
export function parseDate(primary: string): CalendarDate {
  const s = clean(primary);
  const iso = s.match(/\b((?:19|20)\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const month = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    return month >= 0 && month < 12 && day >= 1 && day <= 31
      ? { month, day, year: iso[1] }
      : { year: iso[1] };
  }
  const out: CalendarDate = {};
  let rest = s;
  const y = s.match(YEAR_RE);
  if (y) {
    out.year = y[1];
    rest = rest.replace(y[0], " ");
  }
  const m = s.match(MONTH_RE);
  if (m && m.index !== undefined) {
    const key = m[1]!.slice(0, 3).toLowerCase();
    out.month = MONTHS.findIndex((x) => x.slice(0, 3).toLowerCase() === key);
    const after = s
      .slice(m.index + m[0].length)
      .match(/^\s*(\d{1,2})(?:st|nd|rd|th)?(?!\d)/i);
    const before = s
      .slice(0, m.index)
      .match(/(?:^|\s)(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?$/i);
    const d = Number(after?.[1] ?? before?.[1] ?? NaN);
    if (d >= 1 && d <= 31) out.day = d;
    rest = rest.replace(m[0], " ");
  }
  if (out.month === undefined) {
    // A season or a qualifier with a bare year ("Fall 2013"), shown on the band.
    const left = rest
      .replace(/[,.]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !/^(the|of|in|on|by|around|circa|c)$/i.test(w));
    const r = left.join(" ");
    if (left.length >= 1 && left.length <= 2 && r.length <= 14 && !/\d/.test(r))
      out.rest = r;
  }
  return out;
}

export function fitsCalendar(g: MomentGraphic): boolean {
  const p = clean(g.primary);
  if (!p || p.length > 40 || clean(g.secondary).length > 64) return false;
  const d = parseDate(p);
  return d.month !== undefined || Boolean(d.year);
}

const PAGE_W = 600;
const PAGE_H = 610;
const BAND = 132;
/** The caption's room on the tape (the tape adds 46 px each side, inside the 1240 px it may take). */
const TAPE_TEXT_W = 1140;

/** One page of the pad: the coloured band with `head`, and the body (ruled lines on the torn pages). */
const Page: React.FC<{
  head: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ head, children, style }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      top: 0,
      width: PAGE_W,
      height: PAGE_H,
      backgroundColor: "#f6f2e8",
      backgroundImage: `${GRAIN}, ${MOTTLE}, ${SHEET_LIGHT}`,
      boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        height: BAND,
        background: `linear-gradient(180deg, #ff7a2e 0%, ${COLOUR.amber} 55%, #e85c12 100%)`,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        paddingBottom: 16,
        boxSizing: "border-box",
        fontFamily: DISPLAY,
        fontSize: head.length > 9 ? 70 : 86,
        letterSpacing: head.length > 9 ? 5 : 9,
        lineHeight: 1,
        color: "#fffaf2",
        textTransform: "uppercase",
        textShadow: "0 2px 0 rgba(120,40,0,0.25)",
      }}
    >
      {head}
    </div>
    {/* The perforation the next tear will follow. */}
    <div
      style={{
        height: 0,
        borderTop: "3px dotted rgba(29,27,24,0.18)",
        margin: "12px 26px 0",
      }}
    />
    {children}
  </div>
);

const TORN = 4;

export const Calendar: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 180);
  if (!visible || !fitsCalendar(g)) return null;
  const d = parseDate(g.primary);
  const label = clean(g.secondary);
  const seed = 5 + variant * 3;
  const side = variant % 2 ? 1 : -1;

  const month = d.month !== undefined ? MONTHS[d.month]! : "";
  // A day: the month on the band, the day large, the year under it. A month and year: the year on the
  // band, the month large. A bare year: any qualifier ("Fall") on the band, the year large.
  let head = "";
  let big = "";
  let foot = "";
  if (month && d.day !== undefined) {
    head = month;
    big = String(d.day);
    foot = d.year ?? "";
  } else if (month) {
    head = d.year ?? "";
    big = month;
  } else {
    head = d.rest ?? "";
    big = d.year ?? "";
  }
  const bigSize =
    d.day !== undefined
      ? 340
      : month
        ? Math.min(230, Math.floor(530 / (big.length * 0.5)))
        : 260;

  const enter = spring({ frame, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [showFor - 14, showFor], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  // Pages tear at 8, 14, 20 and 26; the last is nearly clear by 33, when the pad punches as the hit lands (34).
  const tearAt = (k: number) => 8 + k * 6;
  const settle = spring({
    frame: frame - 33,
    fps,
    config: { damping: 9, stiffness: 260, mass: 0.6 },
  });
  const bump = frame >= 33 ? (1 - settle) * 0.03 : 0;
  // The tape lands at 36 and the caption is fully written by 58: the pre-check's still (never before frame
  // 60) saw "Spartan Strike release dat" when the writing ran to 72 (30 Oct 2026).
  const tape = spring({ frame: frame - 36, fps, config: SPRING.POP });
  const write = interpolate(frame, [40, Math.min(DRAWN_BY - 2, 58)], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.quad),
  });
  const tilt = side * (9 + 2 * jit(seed, 1));
  // The caption's size is measured against the tape (at most two lines), not guessed from its length.
  const fit = fitBlock(label, "marker", {
    maxWidth: TAPE_TEXT_W,
    sizes: [60, 52, 44, 38, 34],
    maxLines: 2,
    lineHeight: 1.08,
  });

  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div
        style={{
          marginTop: 56,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `translateY(${(1 - enter) * 220 - 22 * out}px)`,
          opacity: Math.min(1, enter * 2),
        }}
      >
        <div style={{ perspective: 1700 }}>
          <div
            style={{
              position: "relative",
              width: PAGE_W,
              height: PAGE_H + 48,
              transformStyle: "preserve-3d",
              transform: `rotateX(9deg) rotateY(${tilt}deg) rotateZ(${side * -0.8}deg) scale(${1 + bump})`,
            }}
          >
            {/* The stiff back board, its edge showing under the stack, and the shadow on the desk. */}
            <div
              style={{
                position: "absolute",
                left: -14,
                right: -14,
                top: 30,
                height: PAGE_H + 34,
                borderRadius: 8,
                background: "linear-gradient(180deg, #34302c 0%, #1f1c1a 100%)",
                boxShadow:
                  "0 40px 70px rgba(0,0,0,0.6), 0 12px 20px rgba(0,0,0,0.4)",
              }}
            />
            {/* The edges of the pages still to come. */}
            {[4, 3, 2, 1].map((k) => (
              <div
                key={k}
                style={{
                  position: "absolute",
                  left: 2,
                  right: 2,
                  top: 36 + k * 4,
                  height: PAGE_H,
                  background: k % 2 ? "#e2dbcc" : "#d4ccbb",
                  boxShadow: "0 1px 1px rgba(0,0,0,0.25)",
                }}
              />
            ))}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 36,
                width: PAGE_W,
                height: PAGE_H,
                transformStyle: "preserve-3d",
              }}
            >
              <Page head={head}>
                <div
                  style={{
                    height: PAGE_H - BAND - 15,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingBottom: foot ? 20 : 34,
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: bigSize,
                      lineHeight: 0.92,
                      color: INK,
                      textTransform: "uppercase",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {big}
                  </div>
                  {foot ? (
                    <div
                      style={{
                        marginTop: 18,
                        fontFamily: BODY,
                        fontWeight: 900,
                        fontSize: 52,
                        letterSpacing: 16,
                        marginRight: -16,
                        color: "#6b6357",
                      }}
                    >
                      {foot}
                    </div>
                  ) : null}
                </div>
              </Page>
              {/* The pages that tear away: the first to go is on top. */}
              {Array.from({ length: TORN }, (_, i) => TORN - 1 - i).map((k) => {
                // A tug at the binding, then the page swings off its last attached corner and is
                // tossed down and away, accelerating, fading as it goes.
                const u = interpolate(
                  frame,
                  [tearAt(k), tearAt(k) + 9],
                  [0, 1],
                  clamp,
                );
                if (u >= 1) return null;
                const e = u * u;
                const dir = (k + variant) % 2 ? 1 : -1;
                const spin = 30 + 10 * jit(seed, k);
                return (
                  <div
                    key={k}
                    style={{
                      position: "absolute",
                      inset: 0,
                      transformOrigin: dir > 0 ? "0% 0%" : "100% 0%",
                      transform: `translate(${dir * (30 * u + 640 * e)}px, ${-50 * u + 420 * e}px) rotate(${dir * (5 * u + spin * e)}deg) rotateX(${22 * u}deg)`,
                      opacity: interpolate(u, [0.55, 1], [1, 0], clamp),
                      filter:
                        u > 0
                          ? `drop-shadow(0 ${10 + 30 * u}px ${12 + 20 * u}px rgba(0,0,0,0.4))`
                          : undefined,
                    }}
                  >
                    <Page
                      head={head}
                      style={{
                        clipPath:
                          u > 0
                            ? "polygon(0 6px, 4% 0, 9% 5px, 15% 1px, 22% 6px, 30% 0, 37% 5px, 45% 1px, 52% 6px, 60% 0, 68% 5px, 75% 1px, 83% 6px, 90% 0, 96% 5px, 100% 1px, 100% 100%, 0 100%)"
                            : undefined,
                      }}
                    >
                      {/* A ruled notes page: the torn pages carry no figures of their own. */}
                      <div style={{ margin: "34px 46px 0" }}>
                        {[0, 1, 2, 3, 4, 5, 6].map((r) => (
                          <div
                            key={r}
                            style={{
                              height: 58,
                              borderBottom: "2px solid rgba(29,27,24,0.12)",
                            }}
                          />
                        ))}
                      </div>
                    </Page>
                  </div>
                );
              })}
            </div>
            {/* The binding: a dark head with twin wire loops biting into the pages. */}
            <div
              style={{
                position: "absolute",
                left: -20,
                right: -20,
                top: 0,
                height: 46,
                borderRadius: 10,
                background:
                  "linear-gradient(180deg, #4a4542 0%, #2a2624 55%, #171513 100%)",
                boxShadow:
                  "0 8px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.14)",
              }}
            />
            {Array.from({ length: 13 }, (_, k) => (
              <div
                key={k}
                style={{
                  position: "absolute",
                  left: 36 + k * ((PAGE_W - 72) / 12) - 6,
                  top: 18,
                  width: 12,
                  height: 40,
                  borderRadius: 6,
                  background:
                    "linear-gradient(90deg, #6d7076 0%, #eceef1 45%, #8b8e94 70%, #44464b 100%)",
                  boxShadow: "0 3px 4px rgba(0,0,0,0.45)",
                }}
              />
            ))}
          </div>
        </div>
        {label ? (
          <div
            style={{
              marginTop: -34,
              zIndex: 2,
              opacity: Math.min(1, tape * 2),
              transform: `translateY(${(1 - tape) * 40}px) rotate(${-side * 2.2 + jit(seed, 7)}deg) scale(${1.15 - 0.15 * tape})`,
              maxWidth: 1240,
            }}
          >
            <Tape seed={seed}>
              <Write
                p={write}
                style={{
                  fontFamily: HAND,
                  fontSize: fit.size,
                  lineHeight: 1.08,
                  color: INK,
                  textAlign: "center",
                  maxWidth: TAPE_TEXT_W,
                  overflow: "hidden",
                }}
              >
                {fit.lines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </Write>
            </Tape>
          </div>
        ) : null}
      </div>
    </Stage>
  );
};
