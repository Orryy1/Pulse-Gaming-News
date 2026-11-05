// The code scenes' drawings (src/render/codescene.ts decides when and with what data). Each is a pure function of
// the frame, as Remotion requires: its "physics" is a closed-form curve over a seeded hash, never a stored state or
// Math.random, so any frame renders the same on its own. Pulse's own look: ink, amber, Anton for what is glanced,
// Inter for what is read, nothing under 26 px. The same drawing fits a Short (1080x1920, in the hero and shelf bands
// above the captions) and a long video (1920x1080, above its lower third): both give it an 870 px tall stage.
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import {
  daysBetween,
  type CodeScene,
  type PlannedScene,
} from "../../codescene.ts";
import { fitSize, type Face } from "../packs/fit.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const prog = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], clamp);
/** A seeded 0-1 hash: the same dot falls the same way in every render. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** A ball dropped onto its place: closed-form damped bounce, 1 far above at t=0, 0 at rest. */
const bounce = (t: number) =>
  t <= 0 ? 1 : Math.exp(-5.2 * t) * Math.abs(Math.cos(7.5 * t));

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const LONG = [
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
const ymd = (iso: string) =>
  iso.split("-").map(Number) as [number, number?, number?];
const prettyDate = (iso: string) => {
  const [y, m, d] = ymd(iso);
  return `${m ? MONTHS[m - 1] : ""}${d ? ` ${d}` : ""}${m ? ", " : ""}${y}`;
};

type P<S> = { s: S; len: number; landAt: number; accent: string; W: number };

const SCENE_H = 870;
const ladder = (max: number, min: number) => {
  const out: number[] = [];
  for (let s = max; s > min; s -= 4) out.push(s);
  return [...out, min];
};
const faceSize = (text: string, width: number, max: number, min: number, face: Face = "anton") =>
  fitSize(text, face, width, ladder(max, min)).size;

/** The kicker and title every scene opens with. */
const Head: React.FC<{
  kicker?: string;
  title: string;
  accent: string;
  W: number;
  max?: number;
}> = ({ kicker, title, accent, W, max = 92 }) => {
  const frame = useCurrentFrame();
  const a = easeOut(prog(frame, 0, 12));
  return (
    <div style={{ opacity: a, transform: `translateY(${(1 - a) * 14}px)` }}>
      {kicker ? (
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 36,
            letterSpacing: 3,
            color: accent,
            marginBottom: 6,
          }}
        >
          {kicker}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: faceSize(title.toUpperCase(), W - 128, max, 48),
          lineHeight: 1.08,
          color: COLOUR.paper,
        }}
      >
        {title.toUpperCase()}
      </div>
    </div>
  );
};

/** The small print at the foot of a scene: who says so, or what a mark stands for. */
const Foot: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "absolute",
      left: 64,
      right: 64,
      bottom: 0,
      fontFamily: BODY,
      fontWeight: 600,
      fontSize: 32,
      lineHeight: 1.25,
      color: COLOUR.muted,
    }}
  >
    {children}
  </div>
);

// ---- slide: the delay on the real calendar ------------------------------------------------------------------

const Slide: React.FC<P<Extract<CodeScene, { type: "slide" }>>> = ({
  s,
  landAt,
  accent,
  W,
}) => {
  const frame = useCurrentFrame();
  const [fy, fm, fd] = ymd(s.from);
  const [ty, tm, td] = ymd(s.to);
  const total = daysBetween(s.from, s.to);
  // Every month the slip touches, each with its real days and weekdays.
  const months: Array<{ y: number; m: number }> = [];
  for (
    let y = fy, m = fm!;
    y < ty || (y === ty && m <= tm!);
    m === 12 ? ((y += 1), (m = 1)) : (m += 1)
  )
    months.push({ y, m });
  const wide = W > 1200;
  const cols = wide ? Math.min(months.length, 4) : Math.min(2, months.length);
  const rows = Math.ceil(months.length / cols);
  const gridW = W - 128;
  const panelW = (gridW - (cols - 1) * 24) / cols;
  const gridH = 500;
  const panelH = (gridH - (rows - 1) * 18) / rows;
  const titleH = 44;
  const cellW = (panelW - 6 * 5) / 7;
  const cellH = (panelH - titleH - 5 * 5) / 6;
  // The day the marker has reached: leaves the old date at frame 14, lands on the word that says the new one.
  const t = easeInOut(prog(frame, 14, Math.max(40, landAt)));
  const reached = t * total;
  const landed = frame >= landAt;
  const rivals = new Map((s.rivals ?? []).map((r) => [r.date, r.name]));
  const fromMs = Date.UTC(fy, fm! - 1, fd);
  return (
    <AbsoluteFill style={{ padding: "0 64px" }}>
      <Head kicker="DELAYED" title={s.title} accent={accent} W={W} max={76} />
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: 14,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 28,
              letterSpacing: 2,
              color: COLOUR.muted,
            }}
          >
            WAS
          </div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 56,
              color: COLOUR.muted,
              textDecoration: frame > 14 ? "line-through" : "none",
              textDecorationThickness: 4,
            }}
          >
            {prettyDate(s.from)}
          </div>
        </div>
        <div style={{ textAlign: "center", paddingBottom: 2 }}>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 88,
              lineHeight: 1,
              color: accent,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            +{Math.round(reached)}
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 28,
              letterSpacing: 2,
              color: accent,
            }}
          >
            DAYS
          </div>
        </div>
        <div style={{ textAlign: "right", opacity: landed ? 1 : 0.28 }}>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 28,
              letterSpacing: 2,
              color: COLOUR.muted,
            }}
          >
            NOW
          </div>
          <div
            style={{ fontFamily: DISPLAY, fontSize: 56, color: COLOUR.paper }}
          >
            {prettyDate(s.to)}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "18px 24px",
          marginTop: 20,
          width: gridW,
          height: gridH,
        }}
      >
        {months.map(({ y, m }) => {
          const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
          const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
          return (
            <div
              key={`${y}-${m}`}
              style={{ width: panelW, height: panelH, position: "relative" }}
            >
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 30,
                  color: COLOUR.paper,
                  height: titleH,
                }}
              >
                {LONG[m - 1]} {y}
              </div>
              {Array.from({ length: count }, (_, k) => {
                const day = k + 1;
                const pos = first + k;
                const x = (pos % 7) * (cellW + 5);
                const y2 = titleH + Math.floor(pos / 7) * (cellH + 5);
                const offset = Math.round(
                  (Date.UTC(y, m - 1, day) - fromMs) / 86400000,
                );
                const isOld = offset === 0;
                const isNew = offset === total;
                const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const rival = rivals.has(iso);
                const passed = offset > 0 && offset <= reached;
                const head = !landed && passed && reached - offset < 3;
                const dated = isOld || (isNew && landed);
                return (
                  <div
                    key={day}
                    style={{
                      position: "absolute",
                      left: x,
                      top: y2,
                      width: cellW,
                      height: cellH,
                      borderRadius: 4,
                      background:
                        isNew && landed
                          ? accent
                          : isOld
                            ? COLOUR.alert
                            : head
                              ? accent
                              : passed
                                ? `${accent}70`
                                : rival
                                  ? COLOUR.violet
                                  : "rgba(245,245,242,0.10)",
                      boxShadow:
                        isNew && landed ? `0 0 26px ${accent}` : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: BODY,
                      fontWeight: 900,
                      fontSize: Math.min(26, cellH),
                      color: COLOUR.ink,
                    }}
                  >
                    {dated ? day : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <Foot>
        {(s.rivals ?? []).length
          ? (s.rivals ?? [])
              .map((r) => `${r.name}: ${prettyDate(r.date)}`)
              .join(" · ")
          : (s.note ?? "Every square is one day. Dates as announced.")}
      </Foot>
    </AbsoluteFill>
  );
};

// ---- wait: months without a date ------------------------------------------------------------------------------

const Wait: React.FC<P<Extract<CodeScene, { type: "wait" }>>> = ({
  s,
  landAt,
  accent,
  W,
}) => {
  const frame = useCurrentFrame();
  const [y0, m0] = ymd(s.start);
  const wide = W > 1200;
  const cols = wide ? 12 : 6;
  const cells = s.months;
  const extra = cols; // a row beyond the estimate, fading: "more than"
  const gridW = W - 128;
  const size = (gridW - (cols - 1) * 10) / cols;
  const rowsN = Math.ceil((cells + extra) / cols);
  const cellH = Math.min(size, (500 - (rowsN - 1) * 10) / rowsN);
  const lit = easeInOut(prog(frame, 10, Math.max(40, landAt))) * cells;
  const shown = Math.round(lit);
  return (
    <AbsoluteFill style={{ padding: "0 64px" }}>
      <Head kicker="THE WAIT" title={s.title} accent={accent} W={W} max={84} />
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 18,
          marginTop: 8,
        }}
      >
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: 112,
            lineHeight: 1.05,
            color: accent,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {shown}+
        </span>
        <span
          style={{ fontFamily: DISPLAY, fontSize: 56, color: COLOUR.paper }}
        >
          MONTHS AWAY
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 16,
          width: gridW,
        }}
      >
        {Array.from({ length: cells + extra }, (_, k) => {
          const idx = m0! - 1 + k;
          const month = idx % 12;
          const year = y0 + Math.floor(idx / 12);
          const on = k < lit;
          const beyond = k >= cells;
          const newYear = month === 0 || k === 0;
          return (
            <div
              key={k}
              style={{
                width: size,
                height: cellH,
                borderRadius: 8,
                background: beyond
                  ? "transparent"
                  : on
                    ? `${accent}${k === shown - 1 ? "" : "66"}`
                    : "rgba(245,245,242,0.08)",
                border: beyond
                  ? `2px dashed rgba(245,245,242,${0.32 * (1 - (k - cells) / extra)})`
                  : "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: wide ? 24 : 28,
                color: beyond
                  ? `rgba(245,245,242,${0.5 * (1 - (k - cells) / extra)})`
                  : on
                    ? COLOUR.paper
                    : COLOUR.muted,
              }}
            >
              {beyond ? (
                "?"
              ) : (
                <>
                  <span>{MONTHS[month]}</span>
                  {newYear && cellH > 58 ? (
                    <span style={{ fontSize: 26, fontWeight: 600 }}>
                      {year}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>
      <Foot>{s.note}</Foot>
    </AbsoluteFill>
  );
};

// ---- span: a history to scale ---------------------------------------------------------------------------------

const yearOf = (d: string) => {
  const [y, m, dd] = ymd(d);
  return y + ((m ?? 1) - 1) / 12 + ((dd ?? 1) - 1) / 365;
};

const SpanRuler: React.FC<P<Extract<CodeScene, { type: "span" }>>> = ({
  s,
  landAt,
  accent,
  W,
}) => {
  const frame = useCurrentFrame();
  const left = 96;
  const width = W - 2 * left;
  const a = yearOf(s.pins[0]!.date);
  const b = yearOf(s.pins.at(-1)!.date);
  const xOf = (d: string) => left + ((yearOf(d) - a) / (b - a)) * width;
  const axisY = 470;
  const drawn = easeInOut(prog(frame, 8, Math.max(40, landAt)));
  const headX = left + drawn * width;
  // The longest gap between two pins is the one the scene points at.
  const gaps = s.pins
    .slice(1)
    .map((p, i) => ({ i, g: yearOf(p.date) - yearOf(s.pins[i]!.date) }));
  const big = gaps.sort((x, y) => y.g - x.g)[0]!;
  const bigFrom = s.pins[big.i]!;
  const bigTo = s.pins[big.i + 1]!;
  const firstYear = Math.ceil(a);
  const lastYear = Math.floor(b);
  const yearStep =
    lastYear - firstYear > 20 ? 5 : lastYear - firstYear > 8 ? 2 : 1;
  const gapOn = prog(frame, landAt, landAt + 14);
  const years = Math.round(big.g);
  const months = Math.round(big.g * 12);
  const gapText = years >= 2 ? `${years} YEARS` : `${months} MONTHS`;
  return (
    <AbsoluteFill>
      <div style={{ padding: "0 64px" }}>
        <Head
          kicker="TO SCALE"
          title={s.title}
          accent={accent}
          W={W}
          max={84}
        />
      </div>
      <svg
        width={W}
        height={SCENE_H}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        <rect
          x={left}
          y={axisY - 4}
          width={width}
          height={8}
          rx={4}
          fill="rgba(245,245,242,0.14)"
        />
        <rect
          x={left}
          y={axisY - 4}
          width={Math.max(0, headX - left)}
          height={8}
          rx={4}
          fill={accent}
        />
        {Array.from(
          { length: lastYear - firstYear + 1 },
          (_, k) => firstYear + k,
        ).map((y) => {
          const x = left + ((y - a) / (b - a)) * width;
          const major = y % yearStep === 0;
          return x <= headX ? (
            <rect
              key={y}
              x={x - 1}
              y={axisY + 8}
              width={2}
              height={major ? 16 : 8}
              fill="rgba(245,245,242,0.45)"
            />
          ) : null;
        })}
        {/* The longest gap, bracketed once the line has drawn. */}
        <g opacity={gapOn}>
          <rect
            x={xOf(bigFrom.date)}
            y={axisY - 18}
            width={Math.max(0, xOf(bigTo.date) - xOf(bigFrom.date))}
            height={36}
            rx={8}
            fill={`${accent}30`}
          />
        </g>
      </svg>
      <div
        style={{
          position: "absolute",
          left: (xOf(bigFrom.date) + xOf(bigTo.date)) / 2 - 200,
          width: 400,
          top: axisY - 28,
          textAlign: "center",
          opacity: gapOn,
          transform: `translateY(${-30 - (1 - gapOn) * 8}px)`,
        }}
      >
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: 56,
            color: accent,
            background: COLOUR.ink,
            padding: "0 12px",
            borderRadius: 8,
          }}
        >
          {gapText}
        </span>
      </div>
      {s.pins.map((p, i) => {
        const x = xOf(p.date);
        const on = prog(
          frame,
          6 + ((x - left) / width) * Math.max(30, landAt - 8),
          12 + ((x - left) / width) * Math.max(30, landAt - 8),
        );
        const below = i % 2 === 1;
        const year = p.date.slice(0, 4);
        const box = Math.min(340, W / 3);
        const lx = Math.max(32, Math.min(W - box - 32, x - box / 2));
        const align =
          lx === 32 ? "left" : lx === W - box - 32 ? "right" : "center";
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: x - 13,
                top: axisY - 13,
                width: 26,
                height: 26,
                borderRadius: 13,
                background: COLOUR.paper,
                border: `5px solid ${accent}`,
                opacity: on,
                transform: `scale(${0.6 + on * 0.4})`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: lx,
                width: box,
                top: below ? axisY + 42 : undefined,
                bottom: below ? undefined : SCENE_H - axisY + 88,
                textAlign: align,
                opacity: on,
              }}
            >
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 62,
                  lineHeight: 1.05,
                  color: COLOUR.paper,
                }}
              >
                {year}
              </div>
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 34,
                  lineHeight: 1.15,
                  color: COLOUR.muted,
                }}
              >
                {p.label}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

// ---- years: a count of years, one tile each ---------------------------------------------------------------------

const Years: React.FC<P<Extract<CodeScene, { type: "years" }>>> = ({
  s,
  landAt,
  accent,
  W,
}) => {
  const frame = useCurrentFrame();
  const wide = W > 1200;
  const cols = wide ? 20 : 10;
  const gridW = W - 128;
  const size = (gridW - (cols - 1) * 10) / cols;
  const lit = easeInOut(prog(frame, 8, Math.max(40, landAt))) * s.years;
  return (
    <AbsoluteFill style={{ padding: "0 64px" }}>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 36,
          letterSpacing: 3,
          color: accent,
        }}
      >
        {s.label.toUpperCase()}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 22,
          marginTop: 4,
        }}
      >
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: 200,
            lineHeight: 1.05,
            color: COLOUR.paper,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(lit)}
        </span>
        <span style={{ fontFamily: DISPLAY, fontSize: 92, color: accent }}>
          YEARS
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 26,
          width: gridW,
        }}
      >
        {Array.from({ length: s.years }, (_, k) => {
          const a = prog(lit, k, k + 1);
          return (
            <div
              key={k}
              style={{
                width: size,
                height: size,
                borderRadius: 8,
                background: "rgba(245,245,242,0.08)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: accent,
                  opacity: a * (0.55 + 0.45 * (k / s.years)),
                  transform: `translateY(${(1 - easeOut(a)) * 24}%)`,
                }}
              />
            </div>
          );
        })}
      </div>
      <Foot>One square, one year</Foot>
    </AbsoluteFill>
  );
};

// ---- ladder: scores stacking up ---------------------------------------------------------------------------------

const Ladder: React.FC<P<Extract<CodeScene, { type: "ladder" }>>> = ({
  s,
  landAt,
  accent,
  W,
}) => {
  const frame = useCurrentFrame();
  const n = s.rows.length;
  const rowH = Math.min(106, 560 / n);
  const gap = 10;
  const top = 138;
  // They land from the bottom of the list up, each dropped from above; the story's own row lands last on its word.
  const order = s.rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(!!a.r.star) - Number(!!b.r.star) || b.i - a.i);
  const span = Math.max(30, landAt - 16);
  return (
    <AbsoluteFill style={{ padding: "0 64px" }}>
      <Head
        kicker="THE SCORES"
        title={s.title}
        accent={accent}
        W={W}
        max={80}
      />
      {order.map(({ r, i }, turn) => {
        const at = 10 + (turn / Math.max(1, n - 1)) * span;
        const t = (frame - at) / 30;
        const lift = bounce(t);
        const on = prog(frame, at, at + 5);
        const y = top + i * (rowH + gap);
        const fontName = faceSize(
          r.label.toUpperCase(),
          W - 128 - rowH * 1.5 - 60,
          50,
          28,
        );
        return (
          <div
            key={r.label}
            style={{
              position: "absolute",
              left: 64,
              right: 64,
              top: y,
              height: rowH,
              opacity: on,
              transform: `translateY(${-lift * 90}px)`,
              display: "flex",
              alignItems: "center",
              gap: 24,
              borderRadius: 12,
              background: r.star ? `${accent}26` : "rgba(245,245,242,0.06)",
              outline: r.star ? `3px solid ${accent}` : "none",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: rowH * 1.5,
                height: "100%",
                background: r.star ? accent : "rgba(245,245,242,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: DISPLAY,
                fontSize: Math.min(84, rowH * 0.8),
                color: r.star ? COLOUR.ink : COLOUR.paper,
                flexShrink: 0,
              }}
            >
              {r.score}
            </div>
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: fontName,
                lineHeight: 1.05,
                color: r.star ? COLOUR.paper : COLOUR.muted,
                paddingRight: 20,
              }}
            >
              {r.label.toUpperCase()}
            </div>
          </div>
        );
      })}
      {s.note ? <Foot>{s.note}</Foot> : null}
    </AbsoluteFill>
  );
};

// ---- lag: a measured delay, played slowed down ------------------------------------------------------------------

const Lag: React.FC<P<Extract<CodeScene, { type: "lag" }>>> = ({
  s,
  len,
  landAt,
  accent,
  W,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const longest = Math.max(...s.lanes.map((l) => l.ms));
  // Real time slowed by a whole factor, so the longest measured delay takes most of the scene and each lane's
  // arrival is its true share of it. The factor is printed.
  const start = 22;
  const wantFrames = Math.max(
    45,
    Math.min(
      landAt > start + 30 ? landAt - start : len * 0.55,
      len - start - 40,
    ),
  );
  const slow = Math.max(1, Math.round(((wantFrames / fps) * 1000) / longest));
  const msAt = ((frame - start) / fps) * (1000 / slow);
  const clock = Math.min(longest, Math.max(0, msAt));
  const left = 64;
  const trackW = W - 2 * left;
  const laneH = 214;
  const top = 260;
  const shorter = Math.min(...s.lanes.map((l) => l.ms));
  const done = msAt >= longest;
  const FRAME_MS = 1000 / 60;
  return (
    <AbsoluteFill>
      <div style={{ padding: "0 64px" }}>
        <Head
          kicker="BUTTON TO SCREEN"
          title={s.title}
          accent={accent}
          W={W}
          max={80}
        />
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            marginTop: 4,
          }}
        >
          <span
            style={{
              fontFamily: DISPLAY,
              fontSize: 86,
              color: COLOUR.paper,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {clock.toFixed(1)}
          </span>
          <span style={{ fontFamily: DISPLAY, fontSize: 44, color: accent }}>
            MS
          </span>
          <span
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 28,
              letterSpacing: 2,
              color: COLOUR.muted,
              marginLeft: 10,
            }}
          >
            SLOWED {slow}X
          </span>
        </div>
      </div>
      {s.lanes.map((l, i) => {
        const y = top + i * laneH + (s.lanes.length === 2 ? 30 : 0);
        const p = Math.min(1, Math.max(0, msAt) / l.ms);
        const scaleW = trackW - 150;
        const arriveAt = (l.ms / longest) * scaleW;
        const dotX = left + Math.min(1, Math.max(0, msAt) / longest) * scaleW;
        const arrived = p >= 1;
        const col = l.star ? accent : COLOUR.sky;
        const press = interpolate(
          frame,
          [start - 6, start, start + 8],
          [0, 1, 0.3],
          clamp,
        );
        const ticks = Math.floor(longest / FRAME_MS);
        return (
          <div key={l.label}>
            <div
              style={{
                position: "absolute",
                left,
                top: y,
                right: left,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 52,
                  color: COLOUR.paper,
                }}
              >
                {l.label.toUpperCase()}
              </span>
              <span
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 66,
                  color: arrived ? col : "rgba(245,245,242,0.2)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {l.ms} MS
              </span>
            </div>
            <svg
              width={W}
              height={110}
              style={{ position: "absolute", left: 0, top: y + 82 }}
            >
              <rect
                x={left}
                y={40}
                width={scaleW}
                height={10}
                rx={5}
                fill="rgba(245,245,242,0.12)"
              />
              {s.frameTicks
                ? Array.from({ length: ticks }, (_, k) => {
                    const x = left + (((k + 1) * FRAME_MS) / longest) * scaleW;
                    return (
                      <rect
                        key={k}
                        x={x - 1}
                        y={32}
                        width={2}
                        height={26}
                        fill="rgba(245,245,242,0.32)"
                      />
                    );
                  })
                : null}
              {/* The trail stops where this machine's response arrives. */}
              <rect
                x={left}
                y={40}
                width={Math.min(dotX - left, arriveAt)}
                height={10}
                rx={5}
                fill={col}
              />
              <circle
                cx={left + 4}
                cy={45}
                r={24 - press * 5}
                fill={col}
                opacity={0.9}
              />
              <circle
                cx={left + Math.min(dotX - left, arriveAt)}
                cy={45}
                r={arrived ? 0 : 12}
                fill={COLOUR.paper}
              />
              {/* The screen the press has to reach: it sits at this machine's measured time, to scale. */}
              <rect
                x={left + arriveAt + 12}
                y={8}
                width={110}
                height={74}
                rx={8}
                fill={arrived ? col : "rgba(245,245,242,0.08)"}
                stroke="rgba(245,245,242,0.3)"
                strokeWidth={3}
              />
            </svg>
          </div>
        );
      })}
      <Foot>
        {done && s.lanes.length === 2
          ? `${(longest - shorter).toFixed(1).replace(/\.0$/, "")} ms apart, played at 1/${slow} speed.`
          : `Played at 1/${slow} speed.`}
        {s.frameTicks ? " Each tick is one frame at 60fps." : ""}
        {s.note ? ` ${s.note}.` : ""}
      </Foot>
    </AbsoluteFill>
  );
};

// ---- crowd: a share as dots that fall into place ------------------------------------------------------------------

const Crowd: React.FC<P<Extract<CodeScene, { type: "crowd" }>>> = ({
  s,
  landAt,
  accent,
  W,
}) => {
  const frame = useCurrentFrame();
  const wide = W > 1200;
  // Under 5% the share is read out of 1,000, or a single dot would have to stand for it.
  const fine = s.percent < 5;
  const n = fine ? 1000 : 100;
  const side = fine ? (wide ? 40 : 40) : 10;
  const rowsN = Math.ceil(n / side);
  const litN = Math.round((s.percent / 100) * n);
  const areaW = wide ? 800 : W - 128;
  const pitch = Math.min(areaW / side, (fine ? 520 : 540) / rowsN);
  const r = pitch * (fine ? 0.38 : 0.4);
  const gx = wide ? 64 : (W - pitch * side) / 2;
  const gy = wide ? 150 : 250;
  // Which dots count: the bottom rows for a share of 100 (reads as a level), scattered by the seed out of 1,000.
  const picks = new Set<number>();
  if (fine) {
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => hash(a + 3) - hash(b + 3),
    );
    for (const i of order.slice(0, litN)) picks.add(i);
  } else for (let i = 0; i < litN; i++) picks.add(n - 1 - i);
  const col = s.lost ? COLOUR.alert : accent;
  const lightAt = Math.max(30, landAt);
  const shownPct = interpolate(
    frame,
    [lightAt - 14, lightAt],
    [0, s.percent],
    clamp,
  );
  const pctText = Number.isInteger(s.percent)
    ? Math.round(shownPct)
    : shownPct.toFixed(1);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: wide ? 930 : 64,
          right: 64,
          top: wide ? 200 : 0,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: wide ? 260 : 164,
            lineHeight: 1.04,
            color: col,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {s.lost ? "-" : ""}
          {pctText}%
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: wide ? 50 : 40,
            lineHeight: 1.15,
            color: COLOUR.paper,
          }}
        >
          {s.label}
        </div>
      </div>
      <svg
        width={W}
        height={SCENE_H}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
      >
        {Array.from({ length: n }, (_, i) => {
          const cx = gx + (i % side) * pitch + pitch / 2;
          const cy = gy + Math.floor(i / side) * pitch + pitch / 2;
          const delay = 2 + hash(i) * (fine ? 18 : 22);
          const t = (frame - delay) / 26;
          if (t <= 0) return null;
          const drop = bounce(t) * (cy + 200);
          const lit = picks.has(i);
          const on = lit ? prog(frame, lightAt - 6, lightAt + 6) : 0;
          // A share that is gone leaves its dots' places empty as they sink away.
          const sink =
            lit && s.lost
              ? easeInOut(prog(frame, lightAt + 6, lightAt + 40)) * 24
              : 0;
          const fade =
            lit && s.lost
              ? 1 - 0.75 * prog(frame, lightAt + 6, lightAt + 40)
              : 1;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy - drop + sink}
              r={r}
              fill={on > 0.5 ? col : "rgba(245,245,242,0.20)"}
              opacity={fade}
            />
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          left: wide ? 930 : 64,
          right: 64,
          bottom: 0,
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: 28,
          color: COLOUR.muted,
        }}
      >
        {fine ? "Each dot is one in 1,000" : "Each dot is 1%"}
      </div>
    </AbsoluteFill>
  );
};

// ---- terrain: the place a script names, drawn, labelled an illustration --------------------------------------------

const BIOMES = {
  desert: {
    sky: ["#2a1608", "#7a3a12", "#d9762a"],
    layers: ["#8c4a1c", "#6f3814", "#52280e", "#361a09", "#1e0f06"],
    sun: "#ffc98a",
  },
  snow: {
    sky: ["#0e1626", "#2a3f5e", "#7d97b4"],
    layers: ["#8fa6c0", "#6e86a3", "#506884", "#364a63", "#1d2a3c"],
    sun: "#e8f2ff",
  },
  sea: {
    sky: ["#03121c", "#06324a", "#0d6078"],
    layers: ["#0c5469", "#0a4356", "#083444", "#062532", "#041821"],
    sun: "#a8e6ee",
  },
} as const;

/** A dune line: a sum of slow seeded waves, sampled across the frame. */
function ridge(
  W: number,
  base: number,
  amp: number,
  seed: number,
  shift: number,
): string {
  const pts: string[] = [`M0,${SCENE_FULL}`];
  const step = 24;
  for (let x = 0; x <= W + step; x += step) {
    const u = (x + shift) / W;
    const y =
      base +
      amp * Math.sin(u * 3.1 + seed * 1.7) +
      amp * 0.45 * Math.sin(u * 7.3 + seed * 3.1) +
      amp * 0.16 * Math.sin(u * 17.9 + seed * 5.3);
    pts.push(`L${x},${y.toFixed(1)}`);
  }
  pts.push(`L${W},${SCENE_FULL}Z`);
  return pts.join("");
}
const SCENE_FULL = 2000;

const Terrain: React.FC<
  P<Extract<CodeScene, { type: "terrain" }>> & { H: number; top: number }
> = ({ s, accent, W, H, top }) => {
  const frame = useCurrentFrame();
  const c = BIOMES[s.biome];
  const seed = s.view ?? 0;
  const push = 1 + frame * 0.00035;
  const sy = H * 0.44;
  const grains = s.biome === "sea" ? 60 : 90;
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${c.sky[0]} 0%, ${c.sky[1]} 42%, ${c.sky[2]} 60%)`,
        }}
      />
      <svg
        width={W}
        height={H}
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${push})`,
          transformOrigin: "50% 60%",
        }}
      >
        <defs>
          <radialGradient id="scene-sun">
            <stop offset="0%" stopColor={c.sun} stopOpacity="0.95" />
            <stop offset="35%" stopColor={c.sun} stopOpacity="0.5" />
            <stop offset="100%" stopColor={c.sun} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle
          cx={W * (seed % 2 ? 0.3 : 0.68)}
          cy={sy + 40 - frame * 0.02}
          r={W * 0.3}
          fill="url(#scene-sun)"
        />
        {c.layers.map((fill, i) => (
          <path
            key={i}
            d={ridge(
              W,
              H * (0.52 + i * 0.075),
              (H * 0.03) / (1 + i * 0.18),
              i + 1.3 + seed * 2.1,
              frame * (0.25 + i * 0.3),
            )}
            fill={fill}
          />
        ))}
        {/* Grains on the wind: each has a seeded height and speed and wraps across the frame. */}
        {Array.from({ length: grains }, (_, i) => {
          const speed = 1.2 + hash(i + 40) * 3.4;
          const x = ((hash(i) * W + frame * speed) % (W + 20)) - 10;
          const y =
            H * (0.55 + hash(i + 7) * 0.4) + Math.sin(frame / 22 + i) * 6;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={1 + hash(i + 13) * 2}
              fill={c.sun}
              opacity={0.12 + hash(i + 21) * 0.28}
            />
          );
        })}
      </svg>
      {s.title ? (
        <div
          style={{
            position: "absolute",
            left: 64,
            right: 64,
            top: top + 40,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: faceSize(s.title.toUpperCase(), W - 128, 170, 60),
              lineHeight: 1.05,
              color: COLOUR.paper,
              textShadow: "0 6px 40px rgba(0,0,0,0.55)",
              opacity: easeOut(prog(frame, 0, 14)),
              transform: `translateY(${(1 - easeOut(prog(frame, 0, 14))) * 18}px)`,
            }}
          >
            {s.title.toUpperCase()}
          </div>
          {s.label ? (
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 38,
                color: accent === COLOUR.amber ? "#FFD9B8" : COLOUR.paper,
                marginTop: 6,
                opacity: prog(frame, 8, 20),
                textShadow: "0 2px 18px rgba(0,0,0,0.7)",
              }}
            >
              {s.label}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          right: 28,
          top: top + 816,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: 2,
          color: "rgba(245,245,242,0.85)",
          background: "rgba(11,11,14,0.55)",
          padding: "4px 12px",
          borderRadius: 6,
        }}
      >
        ILLUSTRATION
      </div>
    </AbsoluteFill>
  );
};

// ---- the frame ---------------------------------------------------------------------------------------------------

/** Where a scene's 870 px stage sits: below the Short's brand band, or above the long video's lower third. */
export const stageTop = (W: number, H: number) => (H > W ? 300 : 60);

/** One scene, full frame: the backdrop, then its stage. Pure function of the frame. */
export const CodeSceneView: React.FC<{
  planned: Pick<PlannedScene, "scene" | "landAt">;
  len: number;
  accent: string;
  src?: string;
}> = ({ planned, len, accent, src }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const { scene: s, landAt } = planned;
  const top = stageTop(W, H);
  const props = { len, landAt, accent, W };
  const body =
    s.type === "slide" ? (
      <Slide s={s} {...props} />
    ) : s.type === "wait" ? (
      <Wait s={s} {...props} />
    ) : s.type === "span" ? (
      <SpanRuler s={s} {...props} />
    ) : s.type === "years" ? (
      <Years s={s} {...props} />
    ) : s.type === "ladder" ? (
      <Ladder s={s} {...props} />
    ) : s.type === "lag" ? (
      <Lag s={s} {...props} />
    ) : s.type === "crowd" ? (
      <Crowd s={s} {...props} />
    ) : null;
  if (s.type === "terrain") return <Terrain s={s} {...props} H={H} top={top} />;
  const fade = interpolate(frame, [len - 6, len], [1, 0], clamp);
  // The game itself, far back and dark, so the scene sits in the story and not on a blank slate.
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      {src ? (
        <AbsoluteFill
          style={{
            opacity: 0.2,
            filter: "blur(26px) saturate(0.8)",
            transform: `scale(${1.15 + frame * 0.0002})`,
          }}
        >
          <img
            src={src}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{
          background: `radial-gradient(90% 55% at 50% 40%, ${accent}1c 0%, rgba(11,11,14,0) 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top,
          width: W,
          height: SCENE_H,
          opacity: fade,
        }}
      >
        {body}
      </div>
    </AbsoluteFill>
  );
};

/** A plain figure for a test or a log. */
export const sceneTitle = (s: CodeScene) =>
  "title" in s && s.title ? s.title : s.type;
