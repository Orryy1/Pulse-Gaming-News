// The Pulse Lab's instruments ("I measured it", PULSE_LAB_MEASURED): a timer, a counter and a meter that show the
// method while the test runs, each reading off its samples (src/render/labplan.ts readingAt), so the number on screen
// is the measured one at every frame and the final value lands on the outcome, never before. A long test compressed
// into the Short says so ("8x"). Everything is a function of the frame, so a render repeats exactly.

import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { formatValue, readingAt, type LabInstrument } from "../../labplan.ts";

/** The instrument panel's place: the shelf band, full content width. */
export const INSTRUMENT_BOX = {
  left: 64,
  top: 916,
  width: 952,
  height: 250,
} as const;

const panel: React.CSSProperties = {
  position: "absolute",
  left: INSTRUMENT_BOX.left,
  top: INSTRUMENT_BOX.top,
  width: INSTRUMENT_BOX.width,
  height: INSTRUMENT_BOX.height,
  background: "rgba(11,11,14,0.84)",
  borderRadius: 22,
  boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
  overflow: "hidden",
};

const labelStyle: React.CSSProperties = {
  fontFamily: BODY,
  fontWeight: 800,
  fontSize: 28,
  letterSpacing: 3,
  color: COLOUR.muted,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

/** The amber rule down the panel's left edge and the ruler ticks along its foot: the Lab's look. */
const LabFrame: React.FC<{ speed: number; children: React.ReactNode }> = ({
  speed,
  children,
}) => (
  <div style={panel}>
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 12,
        background: COLOUR.amber,
      }}
    />
    <svg
      width={INSTRUMENT_BOX.width}
      height={18}
      style={{ position: "absolute", left: 0, bottom: 0 }}
    >
      {Array.from({ length: 48 }, (_, i) => (
        <rect
          key={i}
          x={28 + i * 19.4}
          y={i % 5 === 0 ? 2 : 9}
          width={2}
          height={i % 5 === 0 ? 16 : 9}
          fill="rgba(255,107,26,0.55)"
        />
      ))}
    </svg>
    {speed > 1.2 ? (
      <div
        style={{
          position: "absolute",
          right: 22,
          top: 20,
          padding: "4px 12px",
          borderRadius: 8,
          background: COLOUR.amber,
          color: COLOUR.ink,
          fontFamily: DISPLAY,
          fontSize: 30,
          lineHeight: 1.1,
        }}
      >
        {`${Math.round(speed)}x`}
      </div>
    ) : null}
    {children}
  </div>
);

const Method: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      ...labelStyle,
      position: "absolute",
      left: 40,
      bottom: 26,
      fontSize: 22,
      letterSpacing: 2,
      color: COLOUR.chrome,
    }}
  >
    {text}
  </div>
);

/** A stopwatch: the reading in big tabular figures and a ring that sweeps once a minute of measured time. */
export const LabTimer: React.FC<{
  i: LabInstrument;
  t: number;
  stopped: boolean;
}> = ({ i, t, stopped }) => {
  const v = readingAt(i.samples, t, "timer");
  const sweep = (v % 60) / 60;
  const r = 78;
  const c = 2 * Math.PI * r;
  return (
    <LabFrame speed={i.speed}>
      <svg
        width={200}
        height={200}
        style={{ position: "absolute", left: 36, top: 22 }}
      >
        <circle
          cx={100}
          cy={100}
          r={r}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={14}
          fill="none"
        />
        <circle
          cx={100}
          cy={100}
          r={r}
          stroke={stopped ? COLOUR.paper : COLOUR.amber}
          strokeWidth={14}
          fill="none"
          strokeDasharray={`${c * sweep} ${c}`}
          transform="rotate(-90 100 100)"
          strokeLinecap="round"
        />
        <rect x={92} y={2} width={16} height={14} rx={3} fill={COLOUR.amber} />
        <line
          x1={100}
          y1={100}
          x2={100 + 58 * Math.sin(sweep * 2 * Math.PI)}
          y2={100 - 58 * Math.cos(sweep * 2 * Math.PI)}
          stroke={COLOUR.paper}
          strokeWidth={6}
          strokeLinecap="round"
        />
      </svg>
      <div style={{ position: "absolute", left: 270, top: 30, ...labelStyle }}>
        {i.label}
      </div>
      <div
        style={{
          position: "absolute",
          left: 266,
          top: 62,
          fontFamily: DISPLAY,
          fontSize: 132,
          lineHeight: 1,
          color: stopped ? COLOUR.paper : COLOUR.amber,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: 2,
        }}
      >
        {formatValue(v, "clock")}
      </div>
      <Method text={i.method} />
    </LabFrame>
  );
};

/** A tally counter: the count, "OF n" when there is a total, and a row of pips that fill as each one lands. */
export const LabCounter: React.FC<{ i: LabInstrument; t: number }> = ({
  i,
  t,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = Math.round(readingAt(i.samples, t, "counter"));
  const last = [...(i.ticks ?? [])].filter((x) => x <= t).pop();
  const pop =
    last === undefined
      ? 1
      : spring({
          frame: frame - Math.round(last * fps),
          fps,
          config: { damping: 10, mass: 0.5 },
        });
  const total = Math.min(20, Math.max(i.of ?? i.max ?? 0, v, 1));
  const pip = Math.min(
    56,
    Math.floor((INSTRUMENT_BOX.width - 360) / total) - 8,
  );
  return (
    <LabFrame speed={1}>
      <div style={{ position: "absolute", left: 40, top: 30, ...labelStyle }}>
        {i.label}
      </div>
      <div
        style={{
          position: "absolute",
          left: 36,
          top: 66,
          display: "flex",
          alignItems: "baseline",
          gap: 18,
          transform: `scale(${interpolate(pop, [0, 1], [1.25, 1])})`,
          transformOrigin: "left center",
        }}
      >
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: 124,
            lineHeight: 1,
            color: COLOUR.amber,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {v}
        </span>
        {i.of ? (
          <span
            style={{ fontFamily: DISPLAY, fontSize: 52, color: COLOUR.paper }}
          >{`OF ${i.of}`}</span>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          left: 330,
          top: 104,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          width: INSTRUMENT_BOX.width - 360,
        }}
      >
        {Array.from({ length: total }, (_, k) => (
          <div
            key={k}
            style={{
              width: pip,
              height: pip,
              borderRadius: pip / 4,
              background: k < v ? COLOUR.amber : "rgba(255,255,255,0.12)",
              border: `3px solid ${k < v ? COLOUR.amber : "rgba(255,255,255,0.25)"}`,
            }}
          />
        ))}
      </div>
      <Method text={i.method} />
    </LabFrame>
  );
};

/** A meter: a ruled bar that fills to the reading, with the reading riding on its marker. */
export const LabMeter: React.FC<{ i: LabInstrument; t: number }> = ({
  i,
  t,
}) => {
  const v = readingAt(i.samples, t, "meter");
  const max =
    i.max ??
    (i.format === "percent"
      ? 100
      : Math.max(1, i.samples[i.samples.length - 1]?.[1] ?? 1) * 1.25);
  const share = Math.max(0, Math.min(1, v / max));
  const barLeft = 40;
  const barWidth = INSTRUMENT_BOX.width - 80;
  return (
    <LabFrame speed={i.speed}>
      <div style={{ position: "absolute", left: 40, top: 30, ...labelStyle }}>
        {i.label}
      </div>
      <div
        style={{
          position: "absolute",
          left: barLeft,
          top: 132,
          width: barWidth,
          height: 44,
          borderRadius: 12,
          background: "rgba(255,255,255,0.12)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${share * 100}%`,
            height: "100%",
            background: COLOUR.amber,
          }}
        />
      </div>
      <svg
        width={barWidth}
        height={20}
        style={{ position: "absolute", left: barLeft, top: 180 }}
      >
        {Array.from({ length: 11 }, (_, k) => (
          <rect
            key={k}
            x={Math.min(barWidth - 3, (k / 10) * barWidth)}
            y={0}
            width={3}
            height={k % 5 === 0 ? 18 : 10}
            fill="rgba(245,245,242,0.6)"
          />
        ))}
      </svg>
      <div
        style={{
          position: "absolute",
          left:
            barLeft +
            Math.max(0, Math.min(barWidth - 220, share * barWidth - 110)),
          top: 64,
          width: 220,
          textAlign: "center",
          fontFamily: DISPLAY,
          fontSize: 64,
          lineHeight: 1,
          color: COLOUR.paper,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {`${formatValue(v, i.format)}${i.unit && i.unit !== "%" ? ` ${i.unit.toUpperCase()}` : ""}`}
      </div>
      <Method text={i.method} />
    </LabFrame>
  );
};

/** The instrument a plan names. */
export const LabInstrumentView: React.FC<{
  i: LabInstrument;
  t: number;
  payoffAt: number;
}> = ({ i, t, payoffAt }) =>
  i.kind === "timer" ? (
    <LabTimer i={i} t={t} stopped={t >= payoffAt} />
  ) : i.kind === "counter" ? (
    <LabCounter i={i} t={t} />
  ) : (
    <LabMeter i={i} t={t} />
  );
