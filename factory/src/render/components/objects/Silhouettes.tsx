// The silhouette scenes (./choose.ts picks one for a sentence): faceless flat figures doing what the line says
// people did, for the moments no camera was in the room for. Kurzgesagt-like simplicity on the lit grey stage
// of the Pulse reveals: two-tone figures (./kit.tsx Figure), one key figure in Pulse amber, a warm rim light,
// and the era's hardware on the desks (CRT to 2005, flat panels after).
//   meeting    a meeting round a table under a pendant lamp: the speaker gestures, heads turn, two nod;
//   pitch      a presenter at a board whose bars rise, a seated panel that nods at the end;
//   crunch     a row of desks late at night, seen from behind: lamps go off one by one, one worker stays;
//   handshake  two figures step in and shake hands, a glint where they meet;
//   walkout    someone carries a box to a lit doorway and is gone, the door swinging to;
//   queue      a midnight queue outside a Pulse shop: its lights come on and the line shuffles forward;
//   cheer      a team in front of a big screen throws its arms up as confetti falls.
// Never a likeness and never a named person: every figure is the same anonymous shape in a varied build and
// hair. No words but the ILLUSTRATION tag and the Pulse badge on the shop and the screen.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../brand.ts";
import { PulseBadgeSvg } from "../packs/pulse/PulseBadge.tsx";
import { PulseMark } from "../packs/screen/pulse.tsx";
import { eraOf, type SilhouetteScene } from "./choose.ts";
import {
  Chair,
  Figure,
  Lit,
  Room,
  SceneFrame,
  Shadow,
  TONE,
  clamp,
  easeInOut,
  rand,
  useScene,
  type Hair,
  type SceneProps,
} from "./kit.tsx";
import { BEIGE } from "./props.tsx";

const FLOOR = 880;

/** A pendant lamp hanging from the top edge to (x, y), with its warm cone; `on` 0-1. */
const Pendant: React.FC<{
  p: string;
  x: number;
  y: number;
  on: number;
  w?: number;
  reach?: number;
}> = ({ p, x, y, on, w = 110, reach = 520 }) => (
  <g>
    <path
      d={`M${x - w * 0.5} ${y + 20} L${x - w * 2.4} ${y + reach} H${x + w * 2.4} L${x + w * 0.5} ${y + 20} Z`}
      fill="#ffd9a8"
      opacity={0.09 * on}
      filter={`url(#${p}-soft)`}
    />
    <line x1={x} y1={-10} x2={x} y2={y - 30} stroke="#2b2c32" strokeWidth={4} />
    <path
      d={`M${x - w / 2} ${y + 20} L${x - 22} ${y - 34} H${x + 22} L${x + w / 2} ${y + 20} Z`}
      fill="#2f3036"
    />
    <ellipse
      cx={x}
      cy={y + 20}
      rx={w / 2}
      ry={10}
      fill="#ffe7c2"
      opacity={0.15 + 0.85 * on}
    />
    <ellipse
      cx={x}
      cy={y + 30}
      rx={w * 0.9}
      ry={30}
      fill="#ffd9a8"
      opacity={0.25 * on}
      filter={`url(#${p}-soft)`}
    />
  </g>
);

/** A monitor on a desk seen from the front (its screen towards us) or from the back. */
const DeskMonitor: React.FC<{
  x: number;
  y: number;
  era: "crt" | "flat";
  glow: number;
  s?: number;
}> = ({ x, y, era, glow, s = 1 }) =>
  era === "crt" ? (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-100 -10 L-80 -170 H80 L100 -10 Z" fill={BEIGE.side} />
      <rect
        x={-110}
        y={-190}
        width={220}
        height={180}
        rx={18}
        fill={BEIGE.front}
      />
      <rect x={-92} y={-174} width={184} height={140} rx={22} fill="#0d130f" />
      <rect
        x={-92}
        y={-174}
        width={184}
        height={140}
        rx={22}
        fill="#ffb347"
        opacity={0.35 * glow}
      />
      <rect x={-40} y={-10} width={80} height={14} fill={BEIGE.side} />
    </g>
  ) : (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-8} y={-60} width={16} height={60} fill="#2a2b31" />
      <rect x={-130} y={-200} width={260} height={150} rx={8} fill="#121317" />
      <rect x={-122} y={-192} width={244} height={134} rx={4} fill="#0b0e13" />
      <rect
        x={-122}
        y={-192}
        width={244}
        height={134}
        rx={4}
        fill={COLOUR.sky}
        opacity={0.3 * glow}
      />
      <ellipse cx={0} cy={2} rx={50} ry={8} fill="#2a2b31" />
    </g>
  );

/** Night outside a window strip: a dark sky and a few lit windows across the street. */
const NightStrip: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
}> = ({ x, y, w, h, seed }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} fill="#0c1120" />
    {Array.from({ length: Math.floor(w / 46) * 2 }, (_, i) => (
      <rect
        key={i}
        x={x + 14 + (i % Math.floor(w / 46)) * 46}
        y={y + h * 0.45 + Math.floor(i / Math.floor(w / 46)) * 40}
        width={20}
        height={26}
        fill={rand(i * 7 + seed) > 0.62 ? "#ffcf7a" : "#182035"}
        opacity={0.8}
      />
    ))}
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      fill="none"
      stroke="#33343b"
      strokeWidth={12}
    />
  </g>
);

// ---------------------------------------------------------------- meeting

export const MeetingScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, at } = useScene(len);
  const p = `si-meet-${variant}`;
  const era = eraOf(year);
  const enter = at(0, 20);
  const talk = frame > 18 ? Math.sin((frame - 18) * 0.16) : 0;
  const speaker: [number, number] = [
    30 + 40 * (0.5 + 0.5 * talk) * at(18, 30),
    40 + 30 * talk,
  ];
  const turn = at(24, 40, easeInOut);
  const nod = (d: number) =>
    Math.max(0, Math.sin(Math.max(0, frame - d) * 0.25)) * 8 * at(d, d + 4);
  const TX = 960;
  const TY = 700;
  return (
    <SceneFrame p={p} len={len} cx={960} cy={560}>
      <Room p={p} surface={640} cx={960} cy={500} pool={{ rx: 820, ry: 150 }} />
      <Pendant p={p} x={960} y={220} on={1} w={150} reach={600} />
      <g opacity={enter}>
        {/* Behind the table: three seated, the speaker in the middle in amber. */}
        <Figure
          x={690}
          y={760}
          s={0.92}
          pose={{ sit: true, front: true, head: -turn * 6 + nod(60) }}
          hair={1}
        />
        <Figure
          x={960}
          y={750}
          s={0.95}
          pose={{ sit: true, front: true, near: speaker, far: [10, 20] }}
          accent={COLOUR.amber}
          hair={0}
        />
        <Figure
          x={1230}
          y={760}
          s={0.92}
          pose={{ sit: true, front: true, head: turn * 6 + nod(72) }}
          hair={3}
          build={1.1}
        />
        {/* At the ends, side on, facing in. */}
        <Chair x={360} y={900} s={1} dir={1} />
        <Figure
          x={360}
          y={900}
          s={1}
          pose={{ sit: true, near: [60, 30], far: [50, 40], head: turn * 4 }}
          hair={2}
        />
        <Chair x={1560} y={900} s={1} dir={-1} />
        <Figure
          x={1560}
          y={900}
          s={1}
          dir={-1}
          pose={{ sit: true, near: [60, 30], far: [50, 40], head: turn * 4 }}
          hair={0}
          build={1.05}
        />
      </g>
      {/* The table: its top, its edge, and what is on it. */}
      <Lit p={p} halo={false}>
        <g>
          <ellipse cx={TX} cy={TY} rx={560} ry={120} fill="#3a3b42" />
          <path
            d={`M${TX - 560} ${TY} A560 120 0 0 0 ${TX + 560} ${TY} V${TY + 30} A560 120 0 0 1 ${TX - 560} ${TY + 30} Z`}
            fill="#24252a"
          />
          <ellipse cx={TX} cy={TY - 4} rx={540} ry={108} fill="#45464e" />
        </g>
      </Lit>
      <ellipse
        cx={TX}
        cy={TY - 10}
        rx={300}
        ry={60}
        fill="#ffd9a8"
        opacity={0.12}
      />
      {[
        [700, 690, -8],
        [1180, 700, 6],
        [940, 730, 2],
      ].map(([x, y, r], i) => (
        <g key={i} transform={`rotate(${r} ${x} ${y})`}>
          <path
            d={`M${(x as number) - 80} ${(y as number) + 18} L${(x as number) - 60} ${(y as number) - 18} H${(x as number) + 70} L${(x as number) + 80} ${(y as number) + 18} Z`}
            fill="#e9e4d8"
          />
          <rect
            x={(x as number) - 50}
            y={(y as number) - 6}
            width={90}
            height={4}
            fill="#a49e91"
          />
        </g>
      ))}
      {era === "flat" ? (
        <g>
          <path d="M520 700 L560 650 H680 L660 700 Z" fill="#c9ccd3" />
          <path d="M560 650 L590 590 H700 L680 650 Z" fill="#202227" />
          <path
            d="M565 645 L592 596 H694 L676 645 Z"
            fill={COLOUR.sky}
            opacity={0.35}
          />
        </g>
      ) : (
        <g>
          <path d="M1290 720 L1330 680 L1370 720 Z" fill="#2a2b31" />
          <circle cx={1330} cy={704} r={6} fill={COLOUR.up} />
        </g>
      )}
      <path d="M1360 680 l-6 -40 h30 l-6 40 z" fill="#c9c4bb" />
      {/* The near side of the table: two seen from behind, nearest the camera. */}
      <Figure
        x={760}
        y={1210}
        s={1.12}
        pose={{
          sit: true,
          front: true,
          head: turn * 5,
          near: [-4, -24],
          far: [-4, -24],
        }}
        hair={0}
        tone={TONE.shade}
        shade="#08080a"
      />
      <Figure
        x={1170}
        y={1220}
        s={1.14}
        pose={{
          sit: true,
          front: true,
          head: -turn * 5,
          near: [-4, -24],
          far: [-4, -24],
        }}
        hair={4}
        tone={TONE.shade}
        shade="#08080a"
      />
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- pitch

export const PitchScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, at } = useScene(len);
  const p = `si-pitch-${variant}`;
  const era = eraOf(year);
  const bars = [0.35, 0.5, 0.68, 0.92];
  const arrow = at(62, 82);
  const point = at(14, 26);
  const gesture = frame > 40 ? Math.sin((frame - 40) * 0.14) : 0;
  const nod = (d: number) =>
    Math.max(0, Math.sin(Math.max(0, frame - d) * 0.3)) * 7 * at(d, d + 4);
  const BX = 240;
  const BY = 230;
  const BW = 640;
  const BH = 400;
  return (
    <SceneFrame p={p} len={len} cx={960} cy={560}>
      <Room
        p={p}
        surface={FLOOR - 40}
        cx={900}
        cy={460}
        pool={{ rx: 900, ry: 140 }}
      />
      {/* The board: an easel pad to 2005, a screen on a stand after. */}
      <Shadow p={p} cx={BX + BW / 2} cy={FLOOR - 30} rx={300} ry={16} />
      <Lit p={p} halo={false}>
        {era === "crt" ? (
          <g>
            <path
              d={`M${BX + 80} ${FLOOR - 30} L${BX + BW / 2} ${BY - 20} L${BX + BW - 80} ${FLOOR - 30} M${BX + BW / 2} ${BY} V${FLOOR - 30}`}
              stroke="#5a4a36"
              strokeWidth={14}
              fill="none"
            />
            <rect x={BX} y={BY} width={BW} height={BH} fill="#f3efe6" />
            <rect
              x={BX}
              y={BY - 20}
              width={BW}
              height={26}
              rx={6}
              fill="#3a3b42"
            />
          </g>
        ) : (
          <g>
            <rect
              x={BX + BW / 2 - 12}
              y={BY + BH}
              width={24}
              height={FLOOR - 30 - BY - BH}
              fill="#2a2b31"
            />
            <path
              d={`M${BX + BW / 2 - 120} ${FLOOR - 30} H${BX + BW / 2 + 120}`}
              stroke="#2a2b31"
              strokeWidth={14}
              strokeLinecap="round"
            />
            <rect
              x={BX - 14}
              y={BY - 14}
              width={BW + 28}
              height={BH + 28}
              rx={12}
              fill="#121317"
            />
            <rect x={BX} y={BY} width={BW} height={BH} fill="#141a26" />
          </g>
        )}
      </Lit>
      {bars.map((h, i) => {
        const g = at(18 + i * 9, 34 + i * 9);
        const bw = 90;
        const x = BX + 80 + i * 130;
        const top = BY + BH - 50 - (BH - 120) * h * g;
        return (
          <rect
            key={i}
            x={x}
            y={top}
            width={bw}
            height={BY + BH - 50 - top}
            rx={6}
            fill={
              i === bars.length - 1
                ? COLOUR.amber
                : era === "crt"
                  ? "#4a5a7a"
                  : "#3b4b6b"
            }
          />
        );
      })}
      <line
        x1={BX + 50}
        x2={BX + BW - 50}
        y1={BY + BH - 50}
        y2={BY + BH - 50}
        stroke={era === "crt" ? "#2b2c32" : "#52607a"}
        strokeWidth={4}
      />
      <path
        d={`M${BX + 110} ${BY + 250} L${BX + 260} ${BY + 200} L${BX + 400} ${BY + 160} L${BX + 560} ${BY + 70}`}
        fill="none"
        stroke={COLOUR.up}
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - arrow}
      />
      {arrow >= 1 && (
        <path
          d={`M${BX + 560} ${BY + 70} l-34 4 m34 -4 l-12 32`}
          stroke={COLOUR.up}
          strokeWidth={8}
          strokeLinecap="round"
        />
      )}
      {/* The presenter, facing the panel, pointing back at the board, then talking with the other hand. */}
      <Shadow p={p} cx={1010} cy={FLOOR + 2} rx={90} ry={12} />
      <Lit p={p}>
        <Figure
          x={1010}
          y={FLOOR}
          s={1.05}
          pose={{
            far: [-96 * point, -10 * point],
            near: [24 + 26 * (0.5 + 0.5 * gesture) * at(40, 50), 40],
            head: -4 * point + 4 * at(40, 50),
          }}
          accent={COLOUR.amber}
          hair={2}
        />
      </Lit>
      {/* The panel behind its table, facing the presenter. */}
      {[1380, 1550, 1720].map((x, i) => (
        <g key={i}>
          <Chair x={x + 20} y={FLOOR} dir={-1} />
          <Figure
            x={x}
            y={FLOOR}
            s={0.98}
            dir={-1}
            pose={{
              sit: true,
              near: [70, 20],
              far: [60, 30],
              head: nod(70 + i * 6),
            }}
            hair={([0, 3, 1] as Hair[])[i]}
            build={[1.1, 1, 0.95][i]}
          />
        </g>
      ))}
      <Lit p={p} halo={false}>
        <g>
          <rect
            x={1280}
            y={690}
            width={560}
            height={22}
            rx={4}
            fill="#45464e"
          />
          <rect x={1300} y={712} width={520} height={160} fill="#2a2b31" />
        </g>
      </Lit>
      {[1340, 1510, 1680].map((x, i) => (
        <rect
          key={i}
          x={x}
          y={680}
          width={90}
          height={10}
          rx={2}
          fill="#e9e4d8"
        />
      ))}
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- crunch

export const CrunchScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, at } = useScene(len);
  const p = `si-crunch-${variant}`;
  const era = eraOf(year);
  const xs = [260, 610, 960, 1310, 1660];
  // The order the lamps go off; the middle desk stays lit.
  const order = [0, 4, 1, 3];
  const off = (i: number) => {
    const k = order.indexOf(i);
    if (k < 0) return 0;
    return at(22 + k * 16, 28 + k * 16, (x) => x);
  };
  const flicker = (i: number) => {
    const o = off(i);
    return o > 0 && o < 1
      ? (Math.floor(frame / 2) % 2 ? 0.6 : 0.2) * (1 - o)
      : 1 - o;
  };
  const clockMin = 50 + Math.floor(frame / 12);
  return (
    <SceneFrame p={p} len={len} cx={960} cy={540}>
      <Room
        p={p}
        surface={760}
        deskFront={830}
        cx={960}
        cy={420}
        light={0.65}
      />
      <NightStrip x={120} y={110} w={1680} h={260} seed={variant} />
      {/* A wall clock gone midnight. */}
      <g>
        <circle cx={1488} cy={470} r={60} fill="#2a2b31" />
        <circle cx={1488} cy={470} r={52} fill="#dcd6c8" />
        <line
          x1={1488}
          y1={470}
          x2={1488}
          y2={436}
          stroke="#1d1d22"
          strokeWidth={7}
          strokeLinecap="round"
        />
        <line
          x1={1488}
          y1={470}
          x2={1488 + 44 * Math.sin((clockMin / 60) * Math.PI * 2)}
          y2={470 - 44 * Math.cos((clockMin / 60) * Math.PI * 2)}
          stroke="#1d1d22"
          strokeWidth={4}
          strokeLinecap="round"
        />
      </g>
      {xs.map((x, i) => (
        <Pendant
          key={`l${i}`}
          p={p}
          x={x}
          y={420}
          on={flicker(i)}
          w={90}
          reach={420}
        />
      ))}
      {xs.map((x, i) => {
        const gone = off(i);
        return (
          <g key={`d${i}`}>
            <DeskMonitor x={x} y={760} era={era} glow={1 - gone} s={0.95} />
            <ellipse
              cx={x}
              cy={772}
              rx={150}
              ry={20}
              fill={era === "crt" ? "#ffb347" : COLOUR.sky}
              opacity={0.18 * (1 - gone)}
            />
          </g>
        );
      })}
      {/* The team, seen from behind; whoever's lamp goes off has gone home. */}
      {xs.map((x, i) => {
        const gone = order.includes(i)
          ? at(30 + order.indexOf(i) * 16, 40 + order.indexOf(i) * 16)
          : 0;
        const stay = i === 2;
        return (
          <g key={`f${i}`} opacity={1 - gone}>
            <Figure
              x={x}
              y={1090}
              s={1.08}
              pose={{
                sit: true,
                front: true,
                near: [-2, 0],
                far: [-2, 0],
                head: stay ? 4 + Math.sin(frame * 0.05) * 2 : 0,
                lean: 0,
              }}
              hair={([0, 2, 0, 3, 1] as Hair[])[i]}
              build={[1, 0.95, 1.05, 1.1, 0.95][i]}
              tone={stay ? "#1f2026" : TONE.body}
              accent={stay ? COLOUR.amber : undefined}
            />
          </g>
        );
      })}
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- handshake

export const HandshakeScene: React.FC<SceneProps> = ({ len, variant = 0 }) => {
  const { frame, at } = useScene(len);
  const p = `si-shake-${variant}`;
  const step = at(0, 22);
  const reach = at(14, 36, easeInOut);
  const shake =
    frame > 38 * 1 ? Math.sin((frame - 38) * 0.5) * 6 * (1 - at(70, 80)) : 0;
  const arm: [number, number] = [5 + 65 * reach + shake, 5 + 5 * reach];
  const glint = interpolate(frame, [36, 42, 64], [0, 1, 0], clamp);
  const L = 790 - (1 - step) * 160;
  const R = 1130 + (1 - step) * 160;
  return (
    <SceneFrame p={p} len={len} cx={960} cy={560}>
      <Room
        p={p}
        surface={FLOOR - 20}
        cx={960}
        cy={480}
        pool={{ rx: 700, ry: 130 }}
      />
      {/* A tall window at dusk behind them, and a table with the papers they signed. */}
      <g>
        <rect x={420} y={90} width={1080} height={560} fill="#1a2236" />
        <rect
          x={420}
          y={90}
          width={1080}
          height={560}
          fill="url(#si-shake-dusk)"
        />
        {Array.from({ length: 16 }, (_, i) => {
          const h = 120 + rand(i * 3 + variant) * 260;
          return (
            <rect
              key={i}
              x={430 + i * 67}
              y={650 - h}
              width={58}
              height={h}
              fill="#10141f"
            />
          );
        })}
        {Array.from({ length: 60 }, (_, i) => {
          const b = i % 16;
          const h = 120 + rand(b * 3 + variant) * 260;
          const wy = 650 - h + 20 + Math.floor(i / 16) * 34;
          return rand(i * 13 + variant) > 0.45 && wy < 630 ? (
            <rect key={`w${i}`} x={440 + b * 67 + (i % 2) * 20} y={wy} width={10} height={14} fill="#f2c27a" opacity={0.75} />
          ) : null;
        })}
        <path
          d="M420 90 H1500 V650 H420 Z M780 90 V650 M1140 90 V650"
          fill="none"
          stroke="#33343b"
          strokeWidth={14}
        />
      </g>
      <defs>
        <linearGradient id="si-shake-dusk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a3354" />
          <stop offset="0.7" stopColor="#c46a3a" stopOpacity={0.55} />
          <stop offset="1" stopColor="#e89a54" stopOpacity={0.7} />
        </linearGradient>
      </defs>
      <rect x={300} y={680} width={1320} height={22} rx={4} fill="#45464e" />
      <rect x={330} y={702} width={20} height={170} fill="#2a2b31" />
      <rect x={1570} y={702} width={20} height={170} fill="#2a2b31" />
      <path d="M1180 682 l20 -20 h150 l-10 20 z" fill="#e9e4d8" />
      <path
        d="M1220 668 q20 -10 40 0 t40 0"
        stroke="#1c2a4a"
        strokeWidth={3}
        fill="none"
      />
      <rect
        x={1330}
        y={668}
        width={110}
        height={8}
        rx={4}
        fill="#2b2c32"
        transform="rotate(-12 1385 672)"
      />
      <Shadow p={p} cx={L} cy={FLOOR + 4} rx={100} ry={14} />
      <Shadow p={p} cx={R} cy={FLOOR + 4} rx={100} ry={14} />
      <Lit p={p}>
        <g>
          <Figure
            x={L}
            y={FLOOR}
            s={1.15}
            pose={{
              near: arm,
              far: [-6, 10],
              walk: step < 1 ? frame * 0.35 : undefined,
            }}
            hair={0}
            build={1.08}
          />
          <Figure
            x={R}
            y={FLOOR}
            s={1.15}
            dir={-1}
            pose={{
              near: arm,
              far: [-6, 10],
              walk: step < 1 ? frame * 0.35 + 1 : undefined,
            }}
            accent={COLOUR.amber}
            hair={1}
          />
        </g>
      </Lit>
      <circle
        cx={960}
        cy={636}
        r={30 + glint * 40}
        fill="none"
        stroke={COLOUR.gold}
        strokeWidth={5}
        opacity={glint}
      />
      <circle
        cx={960}
        cy={636}
        r={70}
        fill={COLOUR.gold}
        opacity={0.25 * glint}
        filter={`url(#${p}-soft)`}
      />
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- walkout

export const WalkoutScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, at, k } = useScene(len);
  const p = `si-walk-${variant}`;
  const era = eraOf(year);
  const walk = at(0, 86, (x) => x);
  const inside = at(92, 124, (x) => x);
  const x = 470 + walk * 980 + inside * 90;
  const fade = 1 - inside;
  const close = at(116, 140, easeInOut);
  const DL = 1420;
  const DR = 1640;
  const DT = 300;
  const open = 1 - close * 0.7;
  return (
    <SceneFrame p={p} len={len} cx={1000} cy={560}>
      <Room p={p} surface={FLOOR - 10} cx={1100} cy={460} light={0.8} />
      {/* The doorway: bright beyond, its light spilling across the floor, the door swung open towards us. */}
      <rect
        x={DL}
        y={DT}
        width={DR - DL}
        height={FLOOR - 10 - DT}
        fill="#fff1d6"
      />
      <path
        d={`M${DL} ${FLOOR - 10} L${DR} ${FLOOR - 10} L${DR - 60 + (1 - open) * 120} 1080 L${DL - 460 * open} 1080 Z`}
        fill="#ffe6bd"
        opacity={0.28 * open}
      />
      <rect
        x={DL - 30}
        y={DT - 30}
        width={DR - DL + 60}
        height={30}
        fill="#3a3b42"
      />
      <rect
        x={DL - 30}
        y={DT - 30}
        width={30}
        height={FLOOR - 10 - DT + 30}
        fill="#3a3b42"
      />
      <rect
        x={DR}
        y={DT - 30}
        width={30}
        height={FLOOR - 10 - DT + 30}
        fill="#3a3b42"
      />
      {/* An empty desk and chair on the left. */}
      <rect x={140} y={640} width={420} height={20} rx={4} fill="#45464e" />
      <rect x={160} y={660} width={18} height={210} fill="#2a2b31" />
      <rect x={522} y={660} width={18} height={210} fill="#2a2b31" />
      {era === "crt" ? (
        <rect
          x={250}
          y={500}
          width={180}
          height={140}
          rx={14}
          fill={BEIGE.front}
        />
      ) : (
        <g>
          <rect
            x={240}
            y={480}
            width={210}
            height={130}
            rx={8}
            fill="#121317"
          />
          <rect x={335} y={610} width={18} height={30} fill="#2a2b31" />
        </g>
      )}
      <Chair x={600} y={FLOOR} dir={-1} />
      {/* The one leaving, carrying a box, walking into the light. */}
      <g opacity={fade}>
        <Shadow p={p} cx={x} cy={FLOOR + 2} rx={90} ry={12} />
        <Lit p={p}>
          <Figure
            x={x}
            y={FLOOR}
            s={1.05}
            pose={{
              walk: inside < 1 ? (frame * 0.32) / k : undefined,
              near: [62, 40],
              far: [56, 44],
            }}
            hair={2}
            accent={COLOUR.amber}
          >
            <g>
              <rect
                x={40}
                y={-300}
                width={130}
                height={100}
                rx={4}
                fill="#b0844f"
              />
              <rect x={40} y={-300} width={130} height={14} fill="#c99b62" />
              <path d="M70 -300 l8 -34 l16 4 l-4 30 z" fill="#3f7d4f" />
            </g>
          </Figure>
        </Lit>
      </g>
      <path
        d={`M${DR} ${DT} L${DR + 160 * open} ${DT - 40 * open} V${FLOOR + 40 * open - 10} L${DR} ${FLOOR - 10} Z`}
        fill="#4a4b53"
      />
      <circle cx={DR + 120 * open} cy={(DT + FLOOR) / 2} r={8} fill="#c9ccd3" />
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- queue

export const QueueScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, at, k } = useScene(len);
  const p = `si-queue-${variant}`;
  const era = eraOf(year);
  const lights = at(26, 40);
  const shuffle = at(50, 84, easeInOut);
  const walking = shuffle > 0 && shuffle < 1;
  const N = 9;
  const SX = 1180;
  return (
    <SceneFrame p={p} len={len} cx={900} cy={560}>
      {/* Night: a dark blue sky, a moon and stars, a pavement under the shop. */}
      <rect width={1920} height={1080} fill="#0b1020" />
      <rect width={1920} height={700} fill="url(#si-queue-sky)" />
      <defs>
        <linearGradient id="si-queue-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1020" />
          <stop offset="1" stopColor="#1f2742" />
        </linearGradient>
      </defs>
      {Array.from({ length: 60 }, (_, i) => (
        <circle
          key={i}
          cx={rand(i * 3 + 1) * 1200}
          cy={rand(i * 3 + 2) * 380}
          r={1 + rand(i * 3) * 1.6}
          fill="#e8e3d4"
          opacity={0.5 + 0.5 * Math.sin(frame * 0.05 + i)}
        />
      ))}
      <circle cx={260} cy={170} r={52} fill="#ece6d4" />
      <circle cx={240} cy={160} r={52} fill="#0b1020" opacity={0.15} />
      {Array.from({ length: 7 }, (_, i) => {
        const h = 160 + rand(i * 5 + variant) * 220;
        return (
          <rect
            key={i}
            x={i * 180 - 20}
            y={700 - h}
            width={150}
            height={h}
            fill="#141a2c"
          />
        );
      })}
      <rect
        x={0}
        y={FLOOR - 10}
        width={1920}
        height={1080 - FLOOR + 10}
        fill="#2a2b31"
      />
      <rect x={0} y={FLOOR - 10} width={1920} height={8} fill="#45464e" />
      <rect x={0} y={1010} width={1920} height={70} fill="#1d1e22" />
      {/* The Pulse shop: its window full of shelves, the sign, the door and a clock at midnight above it. */}
      <g>
        <rect x={SX} y={250} width={700} height={FLOOR - 260} fill="#2b2c33" />
        <rect x={SX + 40} y={420} width={380} height={400} fill="#3a2f22" />
        <rect
          x={SX + 40}
          y={420}
          width={380}
          height={400}
          fill="#ffcf8a"
          opacity={0.25 + 0.6 * lights}
        />
        {[0, 1, 2].map((r) => (
          <g key={r}>
            <rect
              x={SX + 60}
              y={500 + r * 100}
              width={340}
              height={8}
              fill="#2a2118"
              opacity={0.8}
            />
            {Array.from({ length: 9 }, (_, c) => (
              <rect
                key={c}
                x={SX + 70 + c * 36}
                y={440 + r * 100}
                width={26}
                height={58}
                fill={
                  [COLOUR.amber, "#4a5a7a", "#7a4a5a", "#3f7d4f"][(c + r) % 4]
                }
                opacity={0.55 + 0.35 * lights}
              />
            ))}
          </g>
        ))}
        <rect
          x={SX + 460}
          y={460}
          width={180}
          height={FLOOR - 470}
          fill="#3a2f22"
        />
        <rect
          x={SX + 460}
          y={460}
          width={180}
          height={FLOOR - 470}
          fill="#ffe0b0"
          opacity={0.15 + 0.75 * lights}
        />
        <rect
          x={SX + 20}
          y={290}
          width={640}
          height={100}
          rx={10}
          fill="#141418"
        />
        <PulseBadgeSvg
          x={SX + 190}
          y={308}
          size={64}
          colour={COLOUR.amber}
          wordColour={COLOUR.paper}
          opacity={0.4 + 0.6 * lights}
        />
        <circle
          cx={SX + 340}
          cy={340}
          r={190}
          fill={COLOUR.amber}
          opacity={0.12 * lights}
          filter={`url(#${p}-blur)`}
        />
        <path
          d={`M${SX + 460} ${FLOOR - 10} L${SX + 640} ${FLOOR - 10} L${SX + 700} 1080 L${SX + 320} 1080 Z`}
          fill="#ffe0b0"
          opacity={0.2 * lights}
        />
        <path
          d={`M${SX + 40} ${FLOOR - 10} L${SX + 420} ${FLOOR - 10} L${SX + 380} 1080 L${SX - 80} 1080 Z`}
          fill="#ffcf8a"
          opacity={0.12 * lights}
        />
      </g>
      {/* The queue, facing the door, a step forward once the doors open. */}
      {Array.from({ length: N }, (_, i) => {
        const x = SX + 380 - i * 128 + shuffle * 70;
        const s = 0.88 + rand(i * 11 + variant) * 0.16;
        const phone = era === "flat" && i % 3 === 1;
        return (
          <g key={i}>
            <Shadow p={p} cx={x} cy={FLOOR - 6} rx={70 * s} ry={10} />
            <Figure
              x={x}
              y={FLOOR - 8}
              s={s}
              pose={{
                walk: walking ? (frame * 0.4) / k + i : undefined,
                near: phone ? [20, 120] : undefined,
                head: phone ? 12 : 0,
              }}
              hair={([0, 4, 1, 3, 0, 2, 4, 3, 1] as Hair[])[i]}
              build={0.92 + rand(i * 5) * 0.22}
              tone={i === 0 ? "#1f2026" : TONE.body}
              accent={i === 0 ? COLOUR.amber : undefined}
            >
              {phone && (
                <rect
                  x={78}
                  y={-300}
                  width={14}
                  height={24}
                  rx={3}
                  fill={COLOUR.sky}
                  opacity={0.9}
                />
              )}
            </Figure>
          </g>
        );
      })}
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- cheer

export const CheerScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, at } = useScene(len);
  const p = `si-cheer-${variant}`;
  const era = eraOf(year);
  const bar = at(4, 22);
  const xs = [430, 640, 850, 1070, 1280, 1490];
  const colours = [
    COLOUR.amber,
    COLOUR.gold,
    COLOUR.paper,
    COLOUR.sky,
    COLOUR.up,
    COLOUR.alert,
  ];
  return (
    <SceneFrame p={p} len={len} cx={960} cy={540}>
      <Room
        p={p}
        surface={FLOOR - 40}
        cx={960}
        cy={400}
        pool={{ rx: 900, ry: 140 }}
      />
      {/* The screen: the bar fills, then the Pulse mark glows. */}
      <Lit p={p} halo={false}>
        {era === "crt" ? (
          <g>
            <rect
              x={720}
              y={160}
              width={480}
              height={360}
              rx={30}
              fill={BEIGE.front}
            />
            <rect
              x={750}
              y={190}
              width={420}
              height={290}
              rx={40}
              fill="#0d130f"
            />
            <rect x={760} y={530} width={400} height={30} fill="#3a3b42" />
            <rect x={780} y={560} width={20} height={260} fill="#3a3b42" />
            <rect x={1120} y={560} width={20} height={260} fill="#3a3b42" />
          </g>
        ) : (
          <g>
            <rect
              x={460}
              y={110}
              width={1000}
              height={470}
              rx={14}
              fill="#121317"
            />
            <rect
              x={476}
              y={126}
              width={968}
              height={438}
              rx={6}
              fill="#121a2a"
            />
          </g>
        )}
      </Lit>
      {(() => {
        const cx = 960;
        const cy = era === "crt" ? 320 : 330;
        const w = era === "crt" ? 300 : 640;
        return (
          <g>
            <rect
              x={cx - w / 2}
              y={cy + (era === "crt" ? 80 : 130)}
              width={w}
              height={22}
              rx={11}
              fill="#232a3a"
            />
            <rect
              x={cx - w / 2}
              y={cy + (era === "crt" ? 80 : 130)}
              width={w * bar}
              height={22}
              rx={11}
              fill={bar >= 1 ? COLOUR.up : COLOUR.amber}
            />
            <circle
              cx={cx}
              cy={cy - 20}
              r={120}
              fill={COLOUR.amber}
              opacity={0.25 * at(22, 30)}
              filter={`url(#${p}-blur)`}
            />
            <g
              transform={`translate(${cx - (era === "crt" ? 60 : 90)} ${cy - (era === "crt" ? 80 : 110)})`}
              opacity={0.4 + 0.6 * at(22, 30)}
            >
              <PulseMark
                size={era === "crt" ? 120 : 180}
                colour={COLOUR.amber}
                beat={(frame % 60) / 60}
              />
            </g>
          </g>
        );
      })()}
      {/* The team, facing the screen with their backs to us: arms go up in a wave, two of them jump. */}
      {xs.map((x, i) => {
        const up = at(24 + i * 4, 34 + i * 4, easeInOut);
        const jump =
          i % 2 === 0
            ? Math.max(0, Math.sin(Math.max(0, frame - 34 - i * 4) * 0.22)) *
              26 *
              up
            : 0;
        const arm: [number, number] = [8 + 140 * up, 8 - 4 * up];
        return (
          <g key={i}>
            <Shadow p={p} cx={x} cy={FLOOR + 30} rx={80 - jump} ry={12} />
            <Figure
              x={x}
              y={FLOOR + 30 - jump}
              s={1.02 + (i % 3) * 0.04}
              pose={{ front: true, near: arm, far: arm }}
              hair={([0, 2, 3, 1, 0, 4] as Hair[])[i]}
              build={[1.05, 0.95, 1.1, 0.95, 1, 1.05][i]}
              accent={i === 2 ? COLOUR.amber : undefined}
            />
          </g>
        );
      })}
      {/* Confetti from frame 30: seeded pieces falling and turning. */}
      {Array.from({ length: 90 }, (_, i) => {
        const t0 = 28 + rand(i * 7) * 16;
        const age = frame - t0;
        if (age < 0) return null;
        const x = rand(i * 7 + 1) * 1920 + Math.sin(age * 0.08 + i) * 30;
        const y = -40 + age * (5 + rand(i * 7 + 2) * 5);
        if (y > 1100) return null;
        const r = age * (4 + rand(i * 7 + 3) * 8) + i * 37;
        return (
          <rect
            key={i}
            x={-9}
            y={-5}
            width={18}
            height={10}
            rx={2}
            fill={colours[i % colours.length]}
            transform={`translate(${x} ${y}) rotate(${r}) scale(1 ${Math.cos(age * 0.2 + i)})`}
            opacity={0.9}
          />
        );
      })}
    </SceneFrame>
  );
};

/** Every silhouette scene by name. */
export const SILHOUETTE_COMPONENTS: Record<
  SilhouetteScene,
  React.FC<SceneProps>
> = {
  meeting: MeetingScene,
  pitch: PitchScene,
  crunch: CrunchScene,
  handshake: HandshakeScene,
  walkout: WalkoutScene,
  queue: QueueScene,
  cheer: CheerScene,
};
