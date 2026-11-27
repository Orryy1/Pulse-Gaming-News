// The explainer diagrams (31 Oct 2026), the "how it worked" visuals of the Vox/Johnny Harris school:
//   OrgChart     who owned which studio: the old owner's link fading as the new owner's draws in
//   Timeline     the chapter's dated events on one axis, the sentence's own year lit amber
//   SplitScreen  two named efforts side by side, their bars filling at the same time
//   Flow         a chain from A to B (to C), boxes and arrows drawing in order, a hand-off that fans out
//   BeforeAfter  what it was and what it became, the old state greyed and the new one lit
// Every name, year and label comes from the candidate's data (./facts.ts: the sentence and its chapter);
// the headers are fixed generic labels. Builds finish by DRAWN_BY (../packs/fit.ts).
import React from "react";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { fitBlock, fitSize } from "../packs/fit.ts";
import type {
  BeforeAfterFacts,
  FlowFacts,
  OrgFacts,
  SplitFacts,
  TimelineFacts,
} from "./facts.ts";
import {
  Arrow,
  Board,
  NodeBox,
  Pill,
  pop,
  ramp,
  upFirst,
  useBoard,
  type DiagramProps,
} from "./kit.tsx";

// ------------------------------------------------------------------------------------------- org chart

export type OrgPlace = {
  name: string;
  x: number;
  y: number;
  role: "owner" | "former" | "child" | "peer";
};

/** Where each studio sits: owners above what they own, a former owner beside the new one, a rename in a row. */
export function orgLayout(f: OrgFacts): OrgPlace[] {
  const owns = f.edges.find((e) => e.kind === "owns");
  const former = f.edges.find((e) => e.kind === "former");
  if (owns) {
    const out: OrgPlace[] = [{ name: owns.to, x: 960, y: 700, role: "child" }];
    if (former) {
      out.push({ name: former.from, x: 560, y: 340, role: "former" });
      out.push({ name: owns.from, x: 1360, y: 340, role: "owner" });
    } else out.push({ name: owns.from, x: 960, y: 340, role: "owner" });
    return out;
  }
  const e = f.edges[0];
  if (!e) return [];
  if (e.kind === "merged")
    return [
      { name: e.from, x: 560, y: 380, role: "peer" },
      { name: e.to, x: 1360, y: 380, role: "peer" },
    ];
  return [
    { name: e.from, x: 520, y: 520, role: "peer" },
    { name: e.to, x: 1400, y: 520, role: "peer" },
  ];
}

const BOX_W = 640;
const BOX_H = 200;

export const OrgChart: React.FC<DiagramProps> = ({ data, len, src }) => {
  const { frame, fps, dim } = useBoard(len);
  if (data.kind !== "orgChart") return null;
  const f = data.facts;
  const places = orgLayout(f);
  const owns = f.edges.find((e) => e.kind === "owns");
  const at = (name: string) => places.find((p) => p.name === name);
  const label = owns
    ? "OWNERSHIP"
    : f.edges[0]?.kind === "merged"
      ? "MERGER"
      : "NAME CHANGE";
  const formerOut = ramp(frame, 40, 54);
  return (
    <Board src={src} frame={frame} len={len} dim={dim} label={label}>
      {owns
        ? (() => {
            const child = at(owns.to)!;
            const owner = at(owns.from)!;
            const formerE = f.edges.find((e) => e.kind === "former");
            const former = formerE ? at(formerE.from) : undefined;
            const ownAt = former ? 44 : 14;
            return (
              <>
                {former ? (
                  <div style={{ opacity: 1 - 0.75 * formerOut }}>
                    <Arrow
                      x1={former.x}
                      y1={former.y + BOX_H / 2}
                      x2={child.x - 60}
                      y2={child.y - BOX_H / 2 - 8}
                      p={ramp(frame, 14, 32)}
                      colour={COLOUR.muted}
                      dashed
                      head={false}
                    />
                  </div>
                ) : null}
                <Arrow
                  x1={owner.x}
                  y1={owner.y + BOX_H / 2}
                  x2={child.x + (former ? 60 : 0)}
                  y2={child.y - BOX_H / 2 - 8}
                  p={ramp(frame, ownAt + 8, ownAt + 26)}
                />
                {former ? (
                  <NodeBox
                    x={former.x}
                    y={former.y}
                    w={BOX_W}
                    h={BOX_H}
                    text={former.name}
                    p={pop(frame, fps, 6)}
                    faded={formerOut}
                  />
                ) : null}
                <NodeBox
                  x={owner.x}
                  y={owner.y}
                  w={BOX_W}
                  h={BOX_H}
                  text={owner.name}
                  p={pop(frame, fps, ownAt)}
                />
                <NodeBox
                  x={child.x}
                  y={child.y}
                  w={BOX_W}
                  h={BOX_H}
                  text={child.name}
                  p={pop(frame, fps, 4)}
                  focus
                />
                <Pill
                  // On the new owner's link, halfway down, clear of both boxes.
                  x={(owner.x + child.x + (former ? 60 : 0)) / 2}
                  y={(owner.y + BOX_H / 2 + child.y - BOX_H / 2) / 2}
                  text={owns.label}
                  p={ramp(frame, ownAt + 24, ownAt + 34)}
                />
              </>
            );
          })()
        : (() => {
            const e = f.edges[0];
            if (!e) return null;
            const a = at(e.from)!;
            const b = at(e.to)!;
            if (e.kind === "merged")
              return (
                <>
                  <Arrow
                    x1={a.x}
                    y1={a.y + BOX_H / 2}
                    x2={940}
                    y2={700}
                    p={ramp(frame, 20, 40)}
                    head={false}
                  />
                  <Arrow
                    x1={b.x}
                    y1={b.y + BOX_H / 2}
                    x2={980}
                    y2={700}
                    p={ramp(frame, 20, 40)}
                    head={false}
                  />
                  <NodeBox
                    x={a.x}
                    y={a.y}
                    w={BOX_W}
                    h={BOX_H}
                    text={a.name}
                    p={pop(frame, fps, 4)}
                  />
                  <NodeBox
                    x={b.x}
                    y={b.y}
                    w={BOX_W}
                    h={BOX_H}
                    text={b.name}
                    p={pop(frame, fps, 10)}
                  />
                  <Pill
                    x={960}
                    y={730}
                    text={e.label}
                    p={ramp(frame, 40, 52)}
                  />
                </>
              );
            return (
              <>
                <Arrow
                  x1={a.x + BOX_W / 2}
                  y1={a.y}
                  x2={b.x - BOX_W / 2 - 10}
                  y2={b.y}
                  p={ramp(frame, 18, 38)}
                />
                <NodeBox
                  x={a.x}
                  y={a.y}
                  w={BOX_W}
                  h={BOX_H}
                  text={a.name}
                  p={pop(frame, fps, 4)}
                  faded={ramp(frame, 40, 56) * 0.6}
                />
                <NodeBox
                  x={b.x}
                  y={b.y}
                  w={BOX_W}
                  h={BOX_H}
                  text={b.name}
                  p={pop(frame, fps, 34)}
                  focus
                />
                <Pill
                  x={960}
                  y={b.y - 60}
                  text={e.label}
                  p={ramp(frame, 36, 48)}
                />
              </>
            );
          })()}
    </Board>
  );
};

// ------------------------------------------------------------------------------------------- timeline

/** The x of each event on the axis: evenly spaced between the safe margins. */
export function timelineXs(n: number, left = 260, right = 1660): number[] {
  if (n <= 1) return [(left + right) / 2];
  return Array.from(
    { length: n },
    (_, i) => left + ((right - left) * i) / (n - 1),
  );
}

export const Timeline: React.FC<DiagramProps> = ({ data, len, src }) => {
  const { frame, fps, dim } = useBoard(len);
  if (data.kind !== "timeline") return null;
  const events = (data.facts as TimelineFacts).events;
  const xs = timelineXs(events.length);
  const gap = events.length > 1 ? xs[1]! - xs[0]! : 600;
  const labelW = Math.min(440, gap - 24);
  const AXIS = 500;
  const axis = ramp(frame, 0, 24);
  const fi = events.findIndex((e) => e.focus);
  const lit = ramp(frame, 56, 70);
  // One label size for the whole row, the largest every label fits at.
  const size = Math.min(
    ...events.map(
      (e) =>
        fitBlock(e.label, "inter", {
          maxWidth: labelW,
          sizes: [46, 42, 38, 34, 30],
          maxLines: 3,
        }).size,
    ),
  );
  return (
    <Board src={src} frame={frame} len={len} dim={dim} label="TIMELINE">
      <div
        style={{
          position: "absolute",
          left: 160,
          top: AXIS - 3,
          width: 1600 * axis,
          height: 6,
          background: "rgba(245,245,242,0.35)",
          borderRadius: 3,
        }}
      />
      {events.map((e, i) => {
        const p = pop(frame, fps, 10 + i * 8);
        const focus = i === fi;
        const on = focus ? lit : 0;
        const lines = fitBlock(e.label, "inter", {
          maxWidth: labelW,
          sizes: [size],
          maxLines: 3,
        }).lines;
        return (
          <React.Fragment key={i}>
            {focus ? (
              <div
                style={{
                  position: "absolute",
                  left: xs[i]! - 34,
                  top: AXIS - 34,
                  width: 68,
                  height: 68,
                  borderRadius: 34,
                  border: `4px solid ${COLOUR.amber}`,
                  opacity: on * (1 - ((frame - 56) % 40) / 60),
                  transform: `scale(${0.6 + 0.6 * on})`,
                }}
              />
            ) : null}
            <div
              style={{
                position: "absolute",
                left: xs[i]! - 14,
                top: AXIS - 14,
                width: 28,
                height: 28,
                borderRadius: 14,
                background: focus && on > 0.5 ? COLOUR.amber : COLOUR.paper,
                transform: `scale(${p * (1 + 0.35 * on)})`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: xs[i]! - 200,
                width: 400,
                top: AXIS - 150,
                height: 120,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                fontFamily: DISPLAY,
                fontSize: focus ? 92 + 12 * on : 76,
                lineHeight: 1,
                color: focus && on > 0.3 ? COLOUR.amber : COLOUR.paper,
                opacity: p * (focus ? 1 : 0.85 - 0.25 * lit),
                transform: `translateY(${(1 - p) * 20}px)`,
              }}
            >
              {e.year}
            </div>
            <div
              style={{
                position: "absolute",
                left: xs[i]! - labelW / 2,
                width: labelW,
                top: AXIS + 44,
                textAlign: "center",
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: size,
                lineHeight: 1.18,
                color: focus ? COLOUR.paper : COLOUR.muted,
                opacity: p * (focus ? 1 : 0.9 - 0.3 * lit),
              }}
            >
              {lines.map((l, j) => (
                <div key={j}>{l}</div>
              ))}
            </div>
          </React.Fragment>
        );
      })}
    </Board>
  );
};

// ------------------------------------------------------------------------------------------- split screen

export const SplitScreen: React.FC<DiagramProps> = ({ data, len, src }) => {
  const { frame, fps, dim } = useBoard(len);
  if (data.kind !== "split") return null;
  const f = data.facts as SplitFacts;
  const fill = ramp(frame, 34, 92);
  const side = (s: SplitFacts["left"], i: number) => {
    const p = pop(frame, fps, 4 + i * 8);
    const x = i === 0 ? 150 : 990;
    const t = fitBlock(s.title.toUpperCase(), "anton", {
      maxWidth: 680,
      sizes: [120, 104, 92, 80, 70, 60],
      maxLines: 2,
      lineHeight: 1.02,
    });
    const c = s.caption
      ? fitBlock(s.caption, "inter", {
          maxWidth: 680,
          sizes: [40, 36, 32],
          maxLines: 2,
        })
      : undefined;
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: x,
          top: 230,
          width: 780,
          height: 560,
          borderRadius: 22,
          background: "rgba(20,20,26,0.9)",
          border: `3px solid ${i === 1 ? COLOUR.amber : "rgba(245,245,242,0.16)"}`,
          boxShadow: "0 18px 60px rgba(0,0,0,0.5)",
          padding: "0 50px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          opacity: p,
          transform: `translateY(${(1 - p) * 30}px)`,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: t.size,
            lineHeight: 1.02,
            color: i === 1 ? COLOUR.amber : COLOUR.paper,
          }}
        >
          {t.lines.map((l, j) => (
            <div key={j}>{l}</div>
          ))}
        </div>
        {c ? (
          <div
            style={{
              marginTop: 20,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: c.size,
              lineHeight: 1.2,
              color: COLOUR.muted,
            }}
          >
            {c.lines.map((l, j) => (
              <div key={j}>{l}</div>
            ))}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 44,
            height: 14,
            borderRadius: 7,
            background: "rgba(245,245,242,0.12)",
          }}
        >
          <div
            style={{
              width: `${fill * 100}%`,
              height: "100%",
              borderRadius: 7,
              background: i === 1 ? COLOUR.amber : COLOUR.paper,
            }}
          />
        </div>
      </div>
    );
  };
  return (
    <Board src={src} frame={frame} len={len} dim={dim} label="AT THE SAME TIME">
      {side(f.left, 0)}
      {side(f.right, 1)}
    </Board>
  );
};

// ------------------------------------------------------------------------------------------- flow

export type FlowBox = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
};

/** The flow's boxes: one column per step, the last step's fan stacked in the last column. */
export function flowLayout(f: FlowFacts): FlowBox[] {
  const cols = f.steps.length;
  const gap = 140;
  const w = Math.min(520, (1640 - gap * (cols - 1)) / cols);
  const left = 960 - (cols * w + gap * (cols - 1)) / 2;
  const h = 220;
  const out: FlowBox[] = [];
  f.steps.forEach((s, i) => {
    const x = left + i * (w + gap) + w / 2;
    const last = i === cols - 1;
    const stack = last ? [s, ...(f.fan ?? [])] : [s];
    const total = stack.length * h + (stack.length - 1) * 40;
    stack.forEach((t, j) =>
      out.push({
        text: t,
        x,
        y: 470 - total / 2 + h / 2 + j * (h + 40),
        w,
        h,
        col: i,
      }),
    );
  });
  return out;
}

export const Flow: React.FC<DiagramProps> = ({ data, len, src }) => {
  const { frame, fps, dim } = useBoard(len);
  if (data.kind !== "flow") return null;
  const f = data.facts as FlowFacts;
  const boxes = flowLayout(f);
  const cols = f.steps.length;
  const step = Math.min(24, 70 / Math.max(1, cols - 1));
  const colAt = (c: number) => 6 + c * step;
  return (
    <Board src={src} frame={frame} len={len} dim={dim}>
      {boxes.map((b, i) => {
        if (b.col === 0) return null;
        const from = boxes.find((x) => x.col === b.col - 1)!;
        return (
          <Arrow
            key={`a${i}`}
            x1={from.x + from.w / 2 + 14}
            y1={from.y}
            x2={b.x - b.w / 2 - 18}
            y2={b.y}
            p={ramp(frame, colAt(b.col) - 12, colAt(b.col) - 2)}
          />
        );
      })}
      {boxes.map((b, i) => (
        <NodeBox
          key={i}
          x={b.x}
          y={b.y}
          w={b.w}
          h={b.h}
          text={b.text}
          p={pop(
            frame,
            fps,
            colAt(b.col) +
              (b.col === cols - 1
                ? (i - boxes.findIndex((x) => x.col === b.col)) * 6
                : 0),
          )}
          focus={b.col === cols - 1}
        />
      ))}
    </Board>
  );
};

// ------------------------------------------------------------------------------------------- before / after

export const BeforeAfter: React.FC<DiagramProps> = ({ data, len, src }) => {
  const { frame, fps, dim } = useBoard(len);
  if (data.kind !== "beforeAfter") return null;
  const f = data.facts as BeforeAfterFacts;
  const panel = (side: BeforeAfterFacts["before"], i: number) => {
    const p = pop(frame, fps, i === 0 ? 4 : 38);
    const t = fitBlock(upFirst(side.text), "inter", {
      maxWidth: 600,
      sizes: [84, 76, 68, 60, 52, 46],
      maxLines: 3,
      lineHeight: 1.12,
    });
    const head = fitSize(side.head, "anton", 600, [128, 112, 96, 84]).size;
    const grey = i === 0 ? ramp(frame, 40, 60) : 0;
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: i === 0 ? 150 : 1070,
          top: 250,
          width: 700,
          height: 500,
          borderRadius: 22,
          background: i === 1 ? "rgba(32,22,16,0.95)" : "rgba(20,20,26,0.92)",
          border: `3px solid ${i === 1 ? COLOUR.amber : "rgba(245,245,242,0.16)"}`,
          boxShadow:
            i === 1
              ? "0 18px 60px rgba(255,107,26,0.22)"
              : "0 18px 60px rgba(0,0,0,0.5)",
          padding: "0 50px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          opacity: p * (1 - 0.35 * grey),
          filter: grey ? `grayscale(${grey})` : undefined,
          transform: `translateX(${(1 - p) * (i === 0 ? -50 : 50)}px)`,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: head,
            lineHeight: 1,
            color: i === 1 ? COLOUR.amber : COLOUR.muted,
            marginBottom: 24,
          }}
        >
          {side.head}
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: t.size,
            lineHeight: 1.12,
            color: COLOUR.paper,
          }}
        >
          {t.lines.map((l, j) => (
            <div key={j}>{l}</div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <Board src={src} frame={frame} len={len} dim={dim}>
      {panel(f.before, 0)}
      <Arrow
        x1={880}
        y1={500}
        x2={1040}
        y2={500}
        p={ramp(frame, 22, 38)}
        width={8}
      />
      {panel(f.after, 1)}
    </Board>
  );
};
