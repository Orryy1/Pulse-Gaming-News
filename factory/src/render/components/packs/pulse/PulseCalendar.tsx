// Pulse apps, "PulseCalendar" (owner, 30 Oct 2026): a date the way a viewer meets one now. A Pulse OS phone
// (./handset.tsx) rises, a finger taps Calendar on the home screen and the Pulse Calendar app opens on the
// month the sentence names: a true month grid (the weekdays worked out from the real date, weeks from Sunday),
// the day ringed when the source gives one, otherwise the month's title lit, and the event (the graphic's
// secondary) dropping onto the day as a chip, then listed under the grid with the date as the source writes it.
// The camera pushes in so the grid can be read. Only for dates from 2012 on (the era rule in ./apps.ts); an
// older date gets the Pulse wall calendar of its period (./PulseCalendarPaper.tsx). Tagged ILLUSTRATION.
import React from "react";
import { interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import { parseDate } from "../paper/Calendar.tsx";
import { clamp, easeInOut, easeOut, txt, wordCount } from "../screen/common.ts";
import { PulseMark, phoneLook } from "../screen/pulse.tsx";
import {
  HANDSET_H,
  HANDSET_W,
  Handset,
  IllustrationMark,
  screenOf,
  type ScreenBox,
} from "./handset.tsx";
import { AppLaunch, openOf } from "./home.tsx";

export const MONTHS = [
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
/** Weekday initials, weeks from Sunday (the US audience's calendars). */
export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** A date a calendar can show: a month and a year at least, a day when the source gives one. */
export type CalDate = { year: number; month: number; day?: number };

/**
 * The date the graphic names, or undefined when it does not name a month and a year (a season, a quarter or a
 * bare year has no month to open). A day that the month does not have (February 30) is refused too.
 */
export function calendarDate(primary: string): CalDate | undefined {
  const d = parseDate(primary);
  if (d.month === undefined || !d.year) return undefined;
  const year = Number(d.year);
  if (d.day !== undefined && d.day > monthGrid(year, d.month).days)
    return undefined;
  return { year, month: d.month, day: d.day };
}

/**
 * The month's page: `lead` blank days before the 1st (0 when the 1st is a Sunday), the days in the month and
 * the weeks it spans. Worked out in UTC from the calendar itself, so it never depends on where it renders.
 */
export function monthGrid(
  year: number,
  month: number,
): { lead: number; days: number; rows: number } {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { lead, days, rows: Math.ceil((lead + days) / 7) };
}

/** A month and a year (a day is optional), and an event of at most eight words that fits a chip. */
export function fitsPulseCalendar(g: MomentGraphic): boolean {
  const p = txt(g.primary);
  const what = txt(g.secondary);
  if (!p || p.length > 40) return false;
  if (what.length > 48 || wordCount(what) > 8) return false;
  return calendarDate(p) !== undefined;
}

type Theme = {
  bg: string;
  ink: string;
  sub: string;
  line: string;
  bar: string;
  barInk: string;
};

/** Light pages on the 2012-19 phones, a dark one on edge phones; the droid skin puts the title on an amber bar. */
function themeOf(screen: ScreenBox): Theme {
  const dark = screen.gen === "edge";
  const droid = screen.skin === "droid";
  const bg = dark ? "#121318" : "#ffffff";
  return {
    bg,
    ink: dark ? "#f2f2f5" : "#15161a",
    sub: dark ? "#8d909a" : "#868993",
    line: dark ? "#25272f" : "#ececf0",
    bar: droid ? COLOUR.amber : bg,
    barInk: droid ? "#fff" : dark ? "#f2f2f5" : "#15161a",
  };
}

/** Where everything sits on the app's screen, so the camera, the ring and the chip agree. */
function layoutOf(screen: ScreenBox, rows: number, chipInBar: boolean) {
  const pad = 14;
  const cellW = (screen.w - pad * 2) / 7;
  // A month with no day keeps its event chip in the app bar, under the title, so the bar is taller.
  const barH = screen.status + (chipInBar ? 190 : 132);
  const weekTop = barH + 12;
  const gridTop = weekTop + 40;
  const cellH = rows >= 6 ? 70 : 76;
  const gridEnd = gridTop + rows * cellH;
  const agendaTop = gridEnd + 22;
  return { pad, cellW, barH, weekTop, gridTop, cellH, gridEnd, agendaTop };
}

export const PulseCalendar: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
}) => {
  const { frame, fps, dim, visible } = useStage(len, 240);
  const date = calendarDate(txt(g.primary));
  if (!visible || !date) return null;
  const what = txt(g.secondary);
  const said = txt(g.primary);
  // The phone of the date's own year: the date is the story's year here.
  const { gen, skin, network } = phoneLook(date.year, variant);
  const screen = screenOf(gen, skin);
  const t = themeOf(screen);
  const grid = monthGrid(date.year, date.month);
  const L = layoutOf(screen, grid.rows, date.day === undefined && !!what);
  const monthName = MONTHS[date.month]!;

  // The beats: rise 0-18, tap Calendar 24, the app opens 32-48, push in 48-68, the day is ringed (or the
  // title lit) 56-70, the event drops 70, the agenda row slides in 82: all landed by DRAWN_BY.
  const tapAt = 24;
  const rise = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.9 },
  });
  const open = openOf(frame, tapAt);
  const zoom = interpolate(frame, [48, 68], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const ring = interpolate(frame, [56, 70], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const fill = interpolate(frame, [68, 76], [0, 1], clamp);
  const drop = spring({
    frame: frame - 70,
    fps,
    config: { damping: 13, stiffness: 170, mass: 0.7 },
  });
  const agenda = spring({
    frame: frame - 82,
    fps,
    config: { damping: 18, stiffness: 160, mass: 0.7 },
  });

  // The ringed day's cell, and where its chip lands: under the day, or over it in the last two weeks.
  const idx = date.day !== undefined ? grid.lead + date.day - 1 : -1;
  const row = Math.floor(idx / 7);
  const cx = L.pad + (idx % 7) * L.cellW + L.cellW / 2;
  const cy = L.gridTop + row * L.cellH + L.cellH / 2;
  const chipW = Math.min(screen.w - 32, what.length * 15 + 44);
  const chipH = 54;
  const above = date.day !== undefined && row >= grid.rows - 2;
  const chipLeft =
    date.day !== undefined
      ? Math.max(16, Math.min(screen.w - 16 - chipW, cx - chipW / 2))
      : 26;
  const chipTop =
    date.day !== undefined
      ? above
        ? cy - 30 - 14 - chipH
        : cy + 30 + 14
      : screen.status + 122;
  const ringR = 27;
  const ringC = 2 * Math.PI * ringR;

  // The camera pushes in x1.42 (as PhoneStory does), or as far as keeps the screen from its status bar to the
  // agenda row inside the frame, about that region's middle; a day's number then reads at 37-40 px, the chip
  // at 34-37.
  const region = L.agendaTop + 96;
  const push = Math.min(1.42, 1040 / region);
  const scale = 1 + (push - 1) * zoom;
  const focus = screen.top + region / 2;
  const lift = -(focus - HANDSET_H / 2);

  const appInk = open > 0.5;
  return (
    <Stage dim={dim} bg={bg ?? "contour"} variant={variant} blur={14}>
      <Handset
        gen={gen}
        skin={skin}
        network={network}
        statusInk={appInk ? t.barInk : "#fff"}
        barInk={appInk && gen === "edge" ? "#ddd" : "#fff"}
        style={{
          position: "absolute",
          left: 960 - HANDSET_W / 2,
          top: 540 - HANDSET_H / 2 + (1 - rise) * 420,
          transform: `rotate(${(variant % 2 ? 1 : -1) * 2.2 * (1 - open)}deg) scale(${scale}) translateY(${lift * zoom}px)`,
        }}
      >
        <AppLaunch
          screen={screen}
          app="calendar"
          frame={frame}
          tapAt={tapAt}
          appBg={t.bg}
        >
          {/* The app bar: the year to go back to, the Pulse mark, then the month's title. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: L.barH,
              background: t.bar,
              borderBottom: `1px solid ${t.line}`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 22,
                right: 22,
                top: screen.status + 12,
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: skin === "droid" ? "#fff" : COLOUR.amber,
                fontSize: 24,
                fontWeight: 600,
              }}
            >
              <svg width={18} height={26} viewBox="0 0 18 26">
                <path
                  d="M14 3 L4 13 L14 23"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {date.year}
              <span style={{ marginLeft: "auto" }}>
                <PulseMark
                  size={30}
                  colour={skin === "droid" ? "#fff" : COLOUR.amber}
                />
              </span>
            </div>
            <div
              style={{
                position: "absolute",
                left: 22,
                top: screen.status + 54,
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                padding: "2px 12px",
                marginLeft: -12,
                borderRadius: 12,
                // A month without a day: its title lights up instead of a day.
                background:
                  date.day === undefined
                    ? `rgba(${skin === "droid" ? "255,255,255" : "255,107,26"},${0.28 * ring})`
                    : "transparent",
                boxShadow:
                  date.day === undefined && ring > 0
                    ? `0 0 0 ${3 * ring}px ${skin === "droid" ? "#fff" : COLOUR.amber}`
                    : "none",
                color: t.barInk,
              }}
            >
              <span
                style={{ fontSize: 50, fontWeight: 800, letterSpacing: -1 }}
              >
                {monthName}
              </span>
              <span style={{ fontSize: 34, fontWeight: 400, opacity: 0.75 }}>
                {date.year}
              </span>
            </div>
          </div>
          {/* The weekdays, then the month: blank days before the 1st, the weekend in a softer ink. */}
          <div
            style={{
              position: "absolute",
              left: L.pad,
              right: L.pad,
              top: L.weekTop,
              display: "flex",
            }}
          >
            {WEEKDAYS.map((w, i) => (
              <div
                key={i}
                style={{
                  width: L.cellW,
                  textAlign: "center",
                  color: t.sub,
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {w}
              </div>
            ))}
          </div>
          {Array.from({ length: grid.rows }, (_, r) => (
            <div
              key={r}
              style={{
                position: "absolute",
                left: L.pad,
                right: L.pad,
                top: L.gridTop + r * L.cellH,
                height: L.cellH,
                borderTop: `1px solid ${t.line}`,
              }}
            />
          ))}
          {Array.from({ length: grid.days }, (_, i) => {
            const k = grid.lead + i;
            const on = date.day === i + 1;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: L.pad + (k % 7) * L.cellW,
                  top: L.gridTop + Math.floor(k / 7) * L.cellH,
                  width: L.cellW,
                  height: L.cellH,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                  fontWeight: on ? 800 : 500,
                  color:
                    on && fill > 0.5
                      ? "#fff"
                      : k % 7 === 0 || k % 7 === 6
                        ? t.sub
                        : t.ink,
                  zIndex: 2,
                }}
              >
                {i + 1}
              </div>
            );
          })}
          {/* The ring drawing round the day, then filling amber. */}
          {date.day !== undefined && (
            <svg
              width={screen.w}
              height={screen.h}
              style={{ position: "absolute", left: 0, top: 0, zIndex: 1 }}
            >
              <circle
                cx={cx}
                cy={cy}
                r={ringR}
                fill={COLOUR.amber}
                fillOpacity={fill}
                stroke={COLOUR.amber}
                strokeWidth={4}
                strokeDasharray={`${ringC * ring} ${ringC}`}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            </svg>
          )}
          {/* The event chip drops from the top of the screen onto the day, a pointer to the day. */}
          {what && frame >= 80 && (
            <div
              style={{
                position: "absolute",
                left: chipLeft,
                top: chipTop + (1 - drop) * -(chipTop + chipH + 40),
                width: chipW,
                minHeight: chipH,
                boxSizing: "border-box",
                padding: "10px 16px",
                borderRadius: skin === "droid" ? 8 : 14,
                background: COLOUR.amber,
                color: COLOUR.ink,
                fontSize: 26,
                fontWeight: 800,
                lineHeight: 1.2,
                textAlign: "center",
                boxShadow: "0 10px 26px rgba(0,0,0,0.35)",
                zIndex: 4,
                opacity: interpolate(drop, [0, 0.3], [0, 1], clamp),
              }}
            >
              {date.day !== undefined && (
                <div
                  style={{
                    position: "absolute",
                    left: cx - chipLeft - 11,
                    [above ? "bottom" : "top"]: -10,
                    width: 0,
                    height: 0,
                    borderLeft: "11px solid transparent",
                    borderRight: "11px solid transparent",
                    [above ? "borderTop" : "borderBottom"]:
                      `11px solid ${COLOUR.amber}`,
                  }}
                />
              )}
              {what}
            </div>
          )}
          {/* The agenda under the month: the event and the date as the source writes it. */}
          <div
            style={{
              position: "absolute",
              left: 22,
              right: 22,
              top: L.agendaTop,
              display: "flex",
              gap: 16,
              opacity: agenda,
              transform: `translateY(${(1 - agenda) * 40}px)`,
            }}
          >
            <div
              style={{
                width: 8,
                borderRadius: 4,
                background: COLOUR.amber,
                flexShrink: 0,
              }}
            />
            <div>
              {what && (
                <div
                  style={{
                    color: t.ink,
                    fontSize: 28,
                    fontWeight: 700,
                    lineHeight: 1.2,
                  }}
                >
                  {what}
                </div>
              )}
              <div
                style={{
                  marginTop: what ? 6 : 0,
                  color: what ? t.sub : t.ink,
                  fontSize: what ? 24 : 28,
                  fontWeight: what ? 500 : 700,
                }}
              >
                {said}
              </div>
            </div>
          </div>
        </AppLaunch>
      </Handset>
      <IllustrationMark opacity={interpolate(frame, [30, 40], [0, 1], clamp)} />
    </Stage>
  );
};
