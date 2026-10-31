// The period-object scenes (./choose.ts picks one for a sentence): a still life of the story's era with one
// small action, for lines about work nothing filmed can show. Each is set on the lit grey stage of the Pulse
// console reveal with a rim light on the hero object, and its hardware follows the year (./choose.ts eraOf,
// phoneOf, driveOf, recorderOf, boxOf): CRT and beige plastic to 2005, flat panels and black after.
//   desk        a studio desk: a code editor scrolls on the monitor beside a Pulse dev kit, its light busy;
//   discs       boxed games drop from a stack into a carton, the flaps fold and amber tape seals it;
//   fax         a fax machine feeds a page, printed line by line, a signature last (to 2009 only);
//   phone       a pager, flip phone or smartphone buzzes across a desk in bursts;
//   clock       a wall clock ticks past midnight over a lamp-lit desk and a night window;
//   calendar    a calendar pinned to a cork wall, its days crossed off in red to a ringed deadline;
//   whiteboard  boxes and arrows drawn on a whiteboard by a marker riding the stroke;
//   booth       a microphone and pop filter in a foam booth, a tape deck's reels or a waveform running;
//   drive       a floppy slides into a drive, a disc tray closes, or a hard drive copies with a progress bar;
//   moving      a moving box on an emptied desk, the monitor's outline in the dust, keys dropped beside it.
// No words but the ILLUSTRATION tag, the Pulse badge and, on the calendar, the day numbers and a month the
// sentence names. Everything settles by frame 100 and only small idle motion runs after.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { PulseBadgeSvg } from "../packs/pulse/PulseBadge.tsx";
import { PulseMark } from "../packs/screen/pulse.tsx";
import {
  boxOf,
  driveOf,
  eraOf,
  phoneOf,
  recorderOf,
  type ObjectScene,
} from "./choose.ts";
import {
  Lit,
  Room,
  SceneFrame,
  Shadow,
  alongPolyline,
  clamp,
  easeInOut,
  easeOut,
  poly,
  rand,
  useScene,
  wobble,
  type SceneProps,
} from "./kit.tsx";
import {
  BEIGE,
  BLACK,
  CodeLines,
  Cover,
  DeskLamp,
  DevKit,
  Keyboard,
  Mug,
  Papers,
  ScanDefs,
  crtMonitor,
  flatMonitor,
} from "./props.tsx";

const DESK = 720;
const FRONT = 900;

// ---------------------------------------------------------------- desk

export const DeskScene: React.FC<SceneProps> = ({ len, year, variant = 0 }) => {
  const { frame, at } = useScene(len);
  const p = `ob-desk-${variant}`;
  const era = eraOf(year);
  const rise = at(0, 26);
  // A CRT warms up as a bright line that opens into the picture; a panel simply lights.
  const on = era === "crt" ? at(10, 24, easeInOut) : at(8, 18);
  const scroll = Math.max(0, frame - 20) * 1.7;
  const seed = 11 + variant * 7;
  const monitor =
    era === "crt"
      ? crtMonitor({
          x: 520,
          y: 250 + (1 - rise) * 40,
          w: 560,
          h: 430,
          p,
          on,
          screen: (b) => (
            <g>
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                fill="#1a1206"
                opacity={0.6}
              />
              <CodeLines
                {...b}
                scroll={scroll}
                seed={seed}
                mono="#ffb347"
                clip={`${p}-crt`}
                cursor
                frame={frame}
              />
              {on < 1 && (
                <rect
                  x={b.x}
                  y={b.y + b.h / 2 - (b.h / 2) * on - 2}
                  width={b.w}
                  height={b.h * on + 4}
                  fill="#ffe0b0"
                  opacity={(1 - on) * 0.8}
                />
              )}
            </g>
          ),
        })
      : flatMonitor({
          x: 470,
          y: 240 + (1 - rise) * 40,
          w: 660,
          h: 400,
          p,
          on,
          screen: (b) => (
            <g>
              <rect x={b.x} y={b.y} width={b.w} height={34} fill="#161a22" />
              <rect
                x={b.x + 14}
                y={b.y + 10}
                width={120}
                height={14}
                rx={4}
                fill="#2a3040"
              />
              <rect
                x={b.x + 144}
                y={b.y + 10}
                width={90}
                height={14}
                rx={4}
                fill="#1f2430"
              />
              <rect
                x={b.x}
                y={b.y + 34}
                width={170}
                height={b.h - 34}
                fill="#10131a"
              />
              {Array.from({ length: 9 }, (_, i) => (
                <rect
                  key={i}
                  x={b.x + 18 + (i % 3 ? 16 : 0)}
                  y={b.y + 56 + i * 26}
                  width={70 + rand(i + seed) * 60}
                  height={10}
                  rx={3}
                  fill="#3a4152"
                />
              ))}
              <CodeLines
                x={b.x + 170}
                y={b.y + 34}
                w={b.w - 170}
                h={b.h - 34}
                scroll={scroll}
                seed={seed}
                clip={`${p}-flat`}
                cursor
                frame={frame}
              />
            </g>
          ),
        });
  const glow = era === "crt" ? "#ffb347" : COLOUR.sky;
  return (
    <SceneFrame p={p} len={len} cx={860} cy={520}>
      <ScanDefs p={p} />
      <Room p={p} surface={DESK} deskFront={FRONT} cx={860} cy={440} />
      {/* The screen's light on the desk and the wall. */}
      <ellipse
        cx={800}
        cy={760}
        rx={420}
        ry={60}
        fill={glow}
        opacity={0.12 * on}
        filter={`url(#${p}-soft)`}
      />
      <ellipse
        cx={800}
        cy={440}
        rx={420}
        ry={300}
        fill={glow}
        opacity={0.05 * on}
        filter={`url(#${p}-blur)`}
      />
      <Papers x={150} y={800} />
      <Mug x={330} y={790} />
      <Shadow p={p} cx={800} cy={DESK + 16} rx={300} />
      <g opacity={rise}>
        <Lit p={p}>{monitor}</Lit>
      </g>
      {/* The kit, its cable to the monitor, and the busy light that blinks while the code runs. */}
      <path
        d={`M1240 ${DESK + 40} C1200 ${DESK + 70} 1100 ${DESK + 70} 1020 ${DESK + 10}`}
        fill="none"
        stroke="#2b2b30"
        strokeWidth={8}
        strokeLinecap="round"
        opacity={at(16, 30)}
      />
      <Shadow p={p} cx={1400} cy={DESK + 120} rx={210} />
      <g
        opacity={at(6, 24)}
        transform={`translate(${(1 - at(6, 28)) * 120} 0)`}
      >
        <Lit p={p}>
          <DevKit x={1240} y={DESK - 30} era={era} busy={on} frame={frame} />
        </Lit>
      </g>
      <Keyboard cx={800} y={790} w={460} era={era} />
      <path
        d="M1100 830 q30 -10 60 0"
        stroke={era === "crt" ? BEIGE.side : BLACK.line}
        strokeWidth={8}
        fill="none"
      />
      <ellipse
        cx={1130}
        cy={840}
        rx={34}
        ry={20}
        fill={era === "crt" ? BEIGE.front : BLACK.top}
      />
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- discs

export const DiscsScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
  src,
}) => {
  const { frame, at } = useScene(len);
  const p = `ob-discs-${variant}`;
  const kind = boxOf(year);
  const N = 5;
  // Box size by kind: a cartridge, a square jewel case, a tall keep case.
  const [bw, bh] =
    kind === "cartridge"
      ? [150, 130]
      : kind === "jewel"
        ? [170, 150]
        : [150, 210];
  const stackX = 300;
  const floor = 880;
  const thick = kind === "cartridge" ? 34 : kind === "jewel" ? 16 : 22;
  const flight = (i: number) => {
    const a = 10 + i * 11;
    return at(a, a + 16, easeInOut);
  };
  const flown = Array.from({ length: N }, (_, i) => flight(i));
  const left = flown.filter((f) => f <= 0).length;
  const flaps = at(70, 86, easeInOut);
  const tape = at(86, 100);
  const CX = 1080;
  const top = 600;
  const W = 560;
  // A flap's free edge swings from up and out (open) to lying flat over half the top (closed).
  const swing = (dx: number) => [(-70 + 350 * flaps) * dx, -150 * (1 - flaps)] as const;
  const [lx, ly] = swing(1);
  const [rx, ry] = swing(-1);
  const flapEl = (
    <g>
      <path
        d={`M${CX - W / 2} ${top} L${CX - W / 2 + 60} ${top - 70} L${CX - W / 2 + 60 + lx} ${top - 70 + ly} L${CX - W / 2 + lx} ${top + ly} Z`}
        fill="#a27a4a"
      />
      <path
        d={`M${CX + W / 2} ${top} L${CX + W / 2 + 60} ${top - 70} L${CX + W / 2 + 60 + rx} ${top - 70 + ry} L${CX + W / 2 + rx} ${top + ry} Z`}
        fill="#9a7243"
      />
    </g>
  );
  const caseFill =
    kind === "cartridge" ? "#56575f" : kind === "jewel" ? "#cfd6df" : "#1b2433";
  return (
    <SceneFrame p={p} len={len} cx={900} cy={600}>
      <Room
        p={p}
        surface={640}
        cx={1000}
        cy={520}
        pool={{ rx: 900, ry: 160 }}
      />
      {/* The stack waiting on the floor, lying flat, getting shorter as boxes go in. */}
      <Shadow p={p} cx={stackX + bw / 2} cy={floor} rx={bw * 0.8} o={(0.55 * left) / N} />
      {Array.from({ length: N }, (_, i) =>
        i < left ? (
          <g key={i}>
            <rect
              x={stackX - 6}
              y={floor - (i + 1) * (thick + 2)}
              width={bw + 34}
              height={thick}
              rx={3}
              fill={caseFill}
            />
            <rect
              x={stackX - 6}
              y={floor - (i + 1) * (thick + 2)}
              width={bw + 34}
              height={4}
              fill="#fff"
              opacity={0.18}
            />
            <rect
              x={stackX + 20}
              y={floor - (i + 1) * (thick + 2) + 6}
              width={bw - 20}
              height={thick - 12}
              fill={COLOUR.amber}
              opacity={0.8}
            />
          </g>
        ) : null,
      )}
      {/* The carton: back wall and inside first, the boxes going in, then its front face over them. */}
      <Shadow p={p} cx={CX} cy={floor + 6} rx={W * 0.62} ry={22} />
      <path
        d={`M${CX - W / 2} ${top} L${CX - W / 2 + 60} ${top - 70} H${CX + W / 2 + 60} L${CX + W / 2} ${top} Z`}
        fill="#6a4f33"
      />
      {flaps <= 0 && flapEl}
      {flown.map((f, i) => {
        if (f <= 0) return null;
        const sx = stackX + bw / 2;
        const sy = floor - (i + 1) * (thick + 2);
        const ex = CX - 140 + (i % 3) * 120 + (i > 2 ? 60 : 0);
        const ey = top + 40;
        const x = sx + (ex - sx) * f;
        const y = sy + (ey - sy) * f - Math.sin(f * Math.PI) * 320;
        const rot = (1 - f) * -30 + (i % 2 ? 6 : -5);
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${rot})`}>
            <rect
              x={-bw / 2 - 6}
              y={-bh / 2 - 6}
              width={bw + 12}
              height={bh + 12}
              rx={kind === "cartridge" ? 10 : 6}
              fill={caseFill}
            />
            <Cover
              x={-bw / 2}
              y={-bh / 2}
              w={bw}
              h={bh}
              src={src}
              id={`${p}-cv${i}`}
            />
            <rect
              x={-bw / 2}
              y={-bh / 2}
              width={bw}
              height={bh * 0.12}
              fill="#fff"
              opacity={0.12}
            />
          </g>
        );
      })}
      <Lit p={p} halo={false}>
        <g>
          <path
            d={`M${CX + W / 2} ${top} L${CX + W / 2 + 60} ${top - 70} V${floor - 70} L${CX + W / 2} ${floor} Z`}
            fill="#8a6640"
          />
          <rect
            x={CX - W / 2}
            y={top}
            width={W}
            height={floor - top}
            fill="#b0844f"
          />
          <rect x={CX - W / 2} y={top} width={W} height={10} fill="#c99b62" />
          {/* A shipping label: the Pulse badge and blank lines. */}
          <rect
            x={CX - 255}
            y={top + 70}
            width={250}
            height={150}
            rx={6}
            fill="#f1ece2"
          />
          <PulseBadgeSvg
            x={CX - 237}
            y={top + 88}
            size={34}
            colour={COLOUR.ink}
          />
          {[0, 1, 2].map((k) => (
            <rect
              key={k}
              x={CX - 237}
              y={top + 146 + k * 20}
              width={200 - k * 40}
              height={8}
              rx={3}
              fill="#9c968a"
            />
          ))}
          <path
            d={`M${CX + 80} ${top + 90} l40 -40 l40 40 M${CX + 120} ${top + 50} v90`}
            stroke="#2a2118"
            strokeWidth={8}
            fill="none"
            opacity={0.75}
          />
        </g>
      </Lit>
      {flaps > 0 && flapEl}
      {flaps > 0.6 && (
        <path
          d={`M${CX - W / 2} ${top} H${CX + W / 2} L${CX + W / 2 + 60} ${top - 70} H${CX - W / 2 + 60} Z`}
          fill="#ba8d55"
          opacity={interpolate(flaps, [0.6, 1], [0, 1], clamp)}
        />
      )}
      {/* The tape runs along the seam of the closed top and down the front. */}
      {tape > 0 && (
        <g>
          <path
            d={`M${CX + 25} ${top - 58} L${CX} ${top} V${top + 120}`}
            fill="none"
            stroke={COLOUR.amber}
            strokeWidth={56}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - tape}
            opacity={0.94}
          />
          {tape > 0.6 && (
            <g transform={`translate(${CX - 17} ${top + 40})`} opacity={interpolate(tape, [0.6, 1], [0, 1], clamp)}>
              <PulseMark size={34} colour={COLOUR.ink} />
            </g>
          )}
        </g>
      )}
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- fax

export const FaxScene: React.FC<SceneProps> = ({ len, year, variant = 0 }) => {
  const { frame, at } = useScene(len);
  const p = `ob-fax-${variant}`;
  const c =
    (year ?? 2000) <= 2005
      ? BEIGE
      : { ...BLACK, top: "#4a4b53", front: "#3a3b42" };
  const feed = at(18, 96, (x) => x);
  const sig = at(84, 100);
  const L = 600;
  const R = 1320;
  const FT = 800;
  const slot = 560;
  const pageH = 420 * feed;
  const pageW = 440;
  const px = (L + R) / 2 - pageW / 2 + 40;
  const lines = Array.from({ length: 11 }, (_, i) => ({
    y: 92 + i * 24,
    w: i === 0 ? 0 : 190 + rand(i * 7 + variant) * 190,
  }));
  const lcd = Math.floor(frame / 8) % 4;
  return (
    <SceneFrame p={p} len={len} cx={960} cy={520}>
      <Room p={p} surface={DESK} deskFront={FRONT + 40} cx={960} cy={420} />
      <Papers x={160} y={850} n={3} />
      <Shadow p={p} cx={960} cy={FT + 4} rx={400} />
      <Lit p={p}>
        <g>
          {/* The body: a sloped control panel over a deep front. */}
          <path
            d={`M${L} ${FT} V${FT - 120} L${L + 60} ${slot + 10} H${R - 60} L${R} ${FT - 120} V${FT} Z`}
            fill={c.front}
          />
          <path
            d={`M${L} ${FT - 120} L${L + 60} ${slot + 10} H${R - 60} L${R} ${FT - 120} Z`}
            fill={c.top}
          />
          <rect x={L} y={FT - 30} width={R - L} height={30} fill={c.side} />
          {/* The handset in its cradle on the left. */}
          <path
            d={`M${L + 40} ${FT - 150} q0 -60 50 -60 h120 q50 0 50 60 v18 h-60 v-14 h-100 v14 h-60 z`}
            fill={c.dark}
          />
          {/* The keypad and the small amber screen. */}
          {Array.from({ length: 12 }, (_, i) => (
            <rect
              key={i}
              x={R - 250 + (i % 3) * 56}
              y={FT - 150 + Math.floor(i / 3) * 30 - 30}
              width={44}
              height={20}
              rx={5}
              fill={c.side}
            />
          ))}
          <rect
            x={R - 430}
            y={FT - 196}
            width={150}
            height={44}
            rx={6}
            fill="#2b2213"
          />
          <rect
            x={R - 424}
            y={FT - 190}
            width={138}
            height={32}
            rx={4}
            fill={COLOUR.amber}
            opacity={0.75}
          />
          {[0, 1, 2, 3].map((k) => (
            <rect
              key={k}
              x={R - 414 + k * 30}
              y={FT - 180}
              width={18}
              height={12}
              fill="#3a2a10"
              opacity={k <= lcd ? 0.9 : 0.25}
            />
          ))}
          <circle
            cx={R - 460}
            cy={FT - 175}
            r={8}
            fill={COLOUR.up}
            opacity={Math.floor(frame / 10) % 2 ? 1 : 0.35}
          />
          <PulseBadgeSvg
            x={L + 300}
            y={FT - 92}
            size={34}
            colour={c === BEIGE ? "#5d574a" : COLOUR.paper}
          />
          {/* The paper slot. */}
          <rect
            x={px - 30}
            y={slot - 4}
            width={pageW + 60}
            height={16}
            rx={6}
            fill="#1d1d21"
          />
        </g>
      </Lit>
      {/* The page comes out of the slot top first, printed as it passes. */}
      <g transform={`translate(${px} ${slot - pageH}) skewX(-4)`}>
        <rect width={pageW} height={pageH} fill="#f3efe6" />
        <rect
          width={pageW}
          height={pageH}
          fill="none"
          stroke="#c9c3b6"
          strokeWidth={2}
        />
        <g clipPath={`url(#${p}-page)`}>
          <clipPath id={`${p}-page`}>
            <rect width={pageW} height={pageH} />
          </clipPath>
          <g transform="translate(36 30)">
            <PulseBadgeSvg x={0} y={0} size={30} colour={COLOUR.ink} />
          </g>
          {lines.map((l, i) => (
            <rect
              key={i}
              x={36}
              y={l.y}
              width={l.w}
              height={9}
              rx={3}
              fill="#5c5850"
              opacity={0.85}
            />
          ))}
          <path
            d="M50 396 c20 -30 40 10 60 -12 s30 -20 46 4 s28 10 50 -16"
            fill="none"
            stroke="#1c2a4a"
            strokeWidth={4}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - sig}
          />
        </g>
      </g>
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- phone

export const PhoneScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, at } = useScene(len);
  const p = `ob-phone-${variant}`;
  const kind = phoneOf(year);
  // Bursts of buzzing: on for 22 frames, off for 18, from frame 14.
  const t = frame - 14;
  const burst = t >= 0 && t % 40 < 22;
  const n = Math.max(0, Math.floor(t / 40) + (t % 40 >= 22 ? 1 : 0));
  const shake = burst ? Math.sin(frame * 2.6) * 4 : 0;
  // Each burst walks it a few px across the desk.
  const creep = Math.min(n, 4) * 7 + (burst ? ((t % 40) / 22) * 7 : 0);
  const cx = 940 + creep;
  const cy = 760;
  const glow = burst ? 1 : 0.55;
  const enter = at(0, 18);
  const device = (() => {
    if (kind === "pager") {
      return (
        <g>
          <rect
            x={-130}
            y={-62}
            width={260}
            height={124}
            rx={26}
            fill="#1d1e23"
          />
          <rect
            x={-120}
            y={-54}
            width={240}
            height={10}
            rx={5}
            fill="#34353c"
          />
          <rect x={-96} y={-34} width={192} height={58} rx={6} fill="#10170f" />
          <rect
            x={-90}
            y={-28}
            width={180}
            height={46}
            rx={4}
            fill="#9fd48a"
            opacity={0.35 + 0.55 * glow}
          />
          {[0, 1, 2, 3, 4, 5, 6].map((k) => (
            <rect
              key={k}
              x={-80 + k * 24}
              y={-18}
              width={16}
              height={26}
              rx={2}
              fill="#1f3b1a"
              opacity={burst ? 0.85 : 0.5}
            />
          ))}
          <rect x={60} y={34} width={46} height={14} rx={6} fill="#3a3b42" />
          <rect x={-104} y={34} width={30} height={14} rx={6} fill="#3a3b42" />
        </g>
      );
    }
    if (kind === "flip") {
      return (
        <g>
          <rect
            x={-90}
            y={-170}
            width={180}
            height={340}
            rx={50}
            fill="#4a4d56"
          />
          <rect x={-90} y={-14} width={180} height={12} fill="#2b2d33" />
          <rect
            x={-56}
            y={-130}
            width={112}
            height={88}
            rx={12}
            fill="#0e1218"
          />
          <rect
            x={-50}
            y={-124}
            width={100}
            height={76}
            rx={10}
            fill={COLOUR.amber}
            opacity={0.3 + 0.6 * glow}
          />
          <g transform="translate(-17 -103)">
            <PulseMark size={34} colour={COLOUR.ink} />
          </g>
          <circle
            cx={0}
            cy={-150}
            r={6}
            fill={COLOUR.sky}
            opacity={burst ? 1 : 0.3}
          />
          <rect x={-60} y={30} width={120} height={8} rx={4} fill="#3d4048" />
          <PulseBadgeSvg x={-46} y={110} size={22} colour="#8c8f99" />
        </g>
      );
    }
    // A smartphone lying face up: an incoming call with a generic avatar and the answer and decline keys.
    const ring = (frame % 40) / 40;
    return (
      <g transform="skewX(-12) scale(1 0.62)">
        <rect
          x={-150}
          y={-300}
          width={300}
          height={600}
          rx={46}
          fill="#111216"
        />
        <rect
          x={-138}
          y={-288}
          width={276}
          height={576}
          rx={38}
          fill="#151b2a"
        />
        <rect
          x={-138}
          y={-288}
          width={276}
          height={576}
          rx={38}
          fill={COLOUR.amber}
          opacity={0.08 * glow}
        />
        <circle
          cx={0}
          cy={-120}
          r={70 + ring * 50}
          fill="none"
          stroke={COLOUR.amber}
          strokeWidth={4}
          opacity={(1 - ring) * 0.7 * glow}
        />
        <circle cx={0} cy={-120} r={66} fill="#2b3245" />
        <circle cx={0} cy={-140} r={24} fill="#5b6478" />
        <path d="M-40 -82 q40 -46 80 0 z" fill="#5b6478" />
        <rect
          x={-70}
          y={-20}
          width={140}
          height={16}
          rx={8}
          fill="#c9cede"
          opacity={0.6}
        />
        <rect
          x={-46}
          y={10}
          width={92}
          height={12}
          rx={6}
          fill="#8a90a2"
          opacity={0.6}
        />
        <circle cx={-70} cy={200} r={38} fill={COLOUR.alert} />
        <circle cx={70} cy={200} r={38} fill={COLOUR.up} />
        <rect x={-50} y={270} width={100} height={6} rx={3} fill="#5c6274" />
        <g transform="translate(-14 -262)">
          <PulseMark size={28} colour={COLOUR.amber} />
        </g>
      </g>
    );
  })();
  const arcs = burst
    ? [0, 1, 2].map((k) => {
        const o = 0.5 + 0.5 * Math.sin(frame * 0.9 + k);
        const r = 30 + k * 26;
        const w = kind === "pager" ? 150 : kind === "flip" ? 110 : 190;
        return (
          <g
            key={k}
            opacity={o * 0.8}
            stroke={COLOUR.amber}
            strokeWidth={6}
            strokeLinecap="round"
            fill="none"
          >
            <path
              d={`M${cx - w - r * 0.4} ${cy - r} q${-r * 0.5} ${r} 0 ${2 * r}`}
            />
            <path
              d={`M${cx + w + r * 0.4} ${cy - r} q${r * 0.5} ${r} 0 ${2 * r}`}
            />
          </g>
        );
      })
    : null;
  return (
    <SceneFrame p={p} len={len} cx={960} cy={620}>
      <Room
        p={p}
        surface={560}
        deskFront={FRONT + 60}
        cx={960}
        cy={520}
        light={0.9}
      />
      <DeskLamp x={1500} y={700} dir={-1} on={1} p={p} />
      <Papers x={300} y={860} n={3} />
      <g transform="translate(330 960) rotate(-8)">
        <rect x={0} y={-12} width={240} height={14} rx={7} fill="#2b2d33" />
        <path d="M240 -12 l26 7 l-26 7 z" fill="#c9c4bb" />
      </g>
      <Shadow p={p} cx={cx} cy={cy + 60} rx={kind === "smart" ? 230 : 170} />
      <g
        opacity={enter}
        transform={`translate(${cx + shake} ${cy + (1 - enter) * 30})`}
      >
        <Lit p={p}>
          <g transform={`scale(${kind === "smart" ? 1 : 1.5})`}>{device}</g>
        </Lit>
      </g>
      {arcs}
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- clock

export const ClockScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, k } = useScene(len);
  const p = `ob-clock-${variant}`;
  const era = eraOf(year);
  // Time-lapse: 11:57 at frame 0, the minute hand ticking every 9 frames, midnight on frame 27 of the build
  // scaled to the shot, then on to 12:05.
  const tick = Math.min(8, Math.floor(frame / (9 * k)));
  const settle = interpolate((frame / (9 * k)) % 1, [0, 0.25], [1, 0], clamp);
  const minutes = 57 + tick;
  const minAngle = ((minutes % 60) / 60) * 360 + (tick < 8 ? settle * -2 : 0);
  const hourAngle =
    ((((minutes >= 60 ? 0 : 11) + (minutes % 60) / 60) % 12) / 12) * 360;
  const secAngle = (frame * 40) % 360;
  const midnight = interpolate(
    frame,
    [27 * k, 30 * k, 60 * k],
    [0, 1, 0],
    clamp,
  );
  const CX = 1000;
  const CY = 300;
  const R = 160;
  const hand = (deg: number, l: number, w: number, fill: string) => (
    <line
      x1={CX - Math.sin((deg * Math.PI) / 180) * 18}
      y1={CY + Math.cos((deg * Math.PI) / 180) * 18}
      x2={CX + Math.sin((deg * Math.PI) / 180) * l}
      y2={CY - Math.cos((deg * Math.PI) / 180) * l}
      stroke={fill}
      strokeWidth={w}
      strokeLinecap="round"
    />
  );
  return (
    <SceneFrame p={p} len={len} cx={980} cy={480}>
      <Room
        p={p}
        surface={DESK + 20}
        deskFront={FRONT + 40}
        cx={1000}
        cy={360}
        light={0.75}
      />
      {/* A night window: dark sky, a moon and a few lit windows across the street. */}
      <g>
        <rect x={150} y={130} width={420} height={500} rx={6} fill="#0d1220" />
        <circle cx={470} cy={230} r={34} fill="#e8e3d4" opacity={0.85} />
        {Array.from({ length: 14 }, (_, i) => (
          <rect
            key={i}
            x={180 + (i % 7) * 52}
            y={430 + Math.floor(i / 7) * 70}
            width={26}
            height={34}
            fill={rand(i * 3 + variant) > 0.55 ? "#ffcf7a" : "#1a2133"}
            opacity={0.8}
          />
        ))}
        <rect
          x={150}
          y={400}
          width={420}
          height={230}
          fill="#121726"
          opacity={0.6}
        />
        <path
          d="M150 130 H570 V630 H150 Z M360 130 V630 M150 380 H570"
          fill="none"
          stroke="#3a3b42"
          strokeWidth={14}
        />
      </g>
      {/* The clock, lit by the lamp. */}
      <Lit p={p}>
        <g>
          <circle cx={CX} cy={CY} r={R + 16} fill="#2a2b31" />
          <circle cx={CX} cy={CY} r={R} fill="#ece6d8" />
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i / 60) * Math.PI * 2;
            const big = i % 5 === 0;
            const r1 = R - (big ? 28 : 14);
            return (
              <line
                key={i}
                x1={CX + Math.sin(a) * r1}
                y1={CY - Math.cos(a) * r1}
                x2={CX + Math.sin(a) * (R - 8)}
                y2={CY - Math.cos(a) * (R - 8)}
                stroke="#2b2b30"
                strokeWidth={big ? 7 : 2.5}
              />
            );
          })}
          <PulseBadgeSvg
            x={CX - 30}
            y={CY + 52}
            size={20}
            colour="#6b6558"
            word={false}
          />
          {hand(hourAngle, R * 0.52, 14, "#1d1d22")}
          {hand(minAngle, R * 0.78, 9, "#1d1d22")}
          {hand(secAngle, R * 0.84, 3.5, COLOUR.alert)}
          <circle cx={CX} cy={CY} r={10} fill="#1d1d22" />
          <circle
            cx={CX}
            cy={CY}
            r={R + 4}
            fill="none"
            stroke={COLOUR.amber}
            strokeWidth={10}
            opacity={midnight * 0.8}
          />
        </g>
      </Lit>
      {/* The desk under it: a monitor left on with its screensaver, papers, a mug and the lamp. */}
      <DeskLamp x={1420} y={DESK + 60} dir={-1} on={1} p={p} />
      <Shadow p={p} cx={760} cy={DESK + 40} rx={200} />
      {(era === "crt" ? crtMonitor : flatMonitor)({
        x: 600,
        y: era === "crt" ? DESK - 250 : DESK - 300,
        w: 320,
        h: era === "crt" ? 240 : 200,
        p,
        on: 1,
        screen: (b) => {
          const sx = b.x + 20 + ((Math.sin(frame * 0.021) + 1) / 2) * (b.w - 100);
          const sy = b.y + 14 + ((Math.cos(frame * 0.017) + 1) / 2) * (b.h - 90);
          return (
            <g>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#06080c" />
              <g transform={`translate(${sx} ${sy})`}>
                <PulseMark size={60} colour={COLOUR.amber} />
              </g>
            </g>
          );
        },
      })}
      <ScanDefs p={p} />
      <Papers x={980} y={DESK + 110} n={5} />
      <Mug x={1240} y={DESK + 120} />
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- calendar

const MONTH_DAYS: Record<string, number> = {
  February: 28,
  April: 30,
  June: 30,
  September: 30,
  November: 30,
};
const MONTH_INDEX = [
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

/** The grid of a month: how many days and which column (Monday first) the 1st falls in. */
export function monthGrid(
  month: string | undefined,
  year: number | undefined,
  variant: number,
): { days: number; offset: number } {
  const days = month ? (MONTH_DAYS[month] ?? 31) : 31;
  const mi = month ? MONTH_INDEX.indexOf(month) : -1;
  if (mi >= 0 && year !== undefined) {
    const dow = new Date(Date.UTC(year, mi, 1)).getUTCDay();
    const leap =
      mi === 1 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return { days: leap ? 29 : days, offset: (dow + 6) % 7 };
  }
  return { days, offset: variant % 5 };
}

export const CalendarScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
  month,
}) => {
  const { frame, at } = useScene(len);
  const p = `ob-cal-${variant}`;
  const { days, offset } = monthGrid(month, year, variant);
  const crossed = Math.min(days - 6, 22);
  const deadline = Math.min(days, crossed + 4);
  const X = 560;
  const Y = 150;
  const W = 800;
  const H = 760;
  const head = 150;
  const cw = W / 7;
  const rows = Math.ceil((offset + days) / 7);
  const ch = (H - head - 30) / rows;
  const cell = (d: number) => {
    const i = offset + d - 1;
    return { x: X + (i % 7) * cw, y: Y + head + 30 + Math.floor(i / 7) * ch };
  };
  const ring = at(88, 100);
  return (
    <SceneFrame p={p} len={len} cx={960} cy={520}>
      {/* Cork: a warm brown wall speckled with seeded grains. */}
      <rect width={1920} height={1080} fill="#7b5a39" />
      <rect
        width={1920}
        height={1080}
        fill={`url(#${p}-room)`}
        opacity={0.55}
      />
      {Array.from({ length: 520 }, (_, i) => (
        <circle
          key={i}
          cx={rand(i * 3 + 1) * 1920}
          cy={rand(i * 3 + 2) * 1080}
          r={1.5 + rand(i * 3 + 3) * 3}
          fill={rand(i * 7) > 0.5 ? "#5e4229" : "#9c7650"}
          opacity={0.6}
        />
      ))}
      <circle
        cx={960}
        cy={480}
        r={760}
        fill={`url(#${p}-warm)`}
        opacity={0.6}
      />
      {/* Sticky notes either side, scribbled, pinned. */}
      {[
        [230, 260, -6, "#f4d35e"],
        [1500, 300, 5, "#9bd1e5"],
        [300, 640, 4, "#f2a65a"],
        [1560, 690, -4, "#f4d35e"],
      ].map(([x, y, r, c], i) => (
        <g
          key={i}
          transform={`rotate(${r} ${x} ${y})`}
          opacity={at(i * 3, i * 3 + 14)}
        >
          <rect
            x={(x as number) - 90}
            y={(y as number) - 90}
            width={180}
            height={180}
            fill={c as string}
          />
          {[0, 1, 2].map((k) => (
            <path
              key={k}
              d={`M${(x as number) - 64} ${(y as number) - 40 + k * 32} q30 -10 60 0 t60 0`}
              stroke="#4a3b2a"
              strokeWidth={4}
              fill="none"
              opacity={0.55}
            />
          ))}
          <circle
            cx={x as number}
            cy={(y as number) - 78}
            r={11}
            fill={COLOUR.alert}
          />
        </g>
      ))}
      <Shadow
        p={p}
        cx={X + W / 2 + 14}
        cy={Y + H / 2 + 20}
        rx={W / 2}
        ry={H / 2}
        o={0.45}
      />
      <Lit p={p} halo={false}>
        <g>
          <rect x={X} y={Y} width={W} height={H} fill="#f4f0e7" />
          <rect x={X} y={Y} width={W} height={head} fill={COLOUR.ink} />
        </g>
      </Lit>
      <PulseBadgeSvg
        x={X + 36}
        y={Y + 48}
        size={54}
        colour={COLOUR.amber}
        wordColour={COLOUR.paper}
      />
      {month && (
        <text
          x={X + W - 36}
          y={Y + 102}
          textAnchor="end"
          fontFamily={DISPLAY}
          fontSize={78}
          fill={COLOUR.paper}
          letterSpacing={2}
        >
          {month.toUpperCase()}
        </text>
      )}
      {Array.from({ length: 7 }, (_, i) => (
        <rect
          key={i}
          x={X + i * cw + 14}
          y={Y + head + 10}
          width={cw - 28}
          height={8}
          rx={4}
          fill={i >= 5 ? COLOUR.alert : "#9a9488"}
          opacity={0.7}
        />
      ))}
      {Array.from({ length: rows + 1 }, (_, r) => (
        <line
          key={`h${r}`}
          x1={X}
          x2={X + W}
          y1={Y + head + 30 + r * ch}
          y2={Y + head + 30 + r * ch}
          stroke="#cfc8ba"
          strokeWidth={2}
        />
      ))}
      {Array.from({ length: 6 }, (_, c) => (
        <line
          key={`v${c}`}
          x1={X + (c + 1) * cw}
          x2={X + (c + 1) * cw}
          y1={Y + head + 30}
          y2={Y + H}
          stroke="#cfc8ba"
          strokeWidth={2}
        />
      ))}
      {Array.from({ length: days }, (_, i) => {
        const { x, y } = cell(i + 1);
        return (
          <text
            key={i}
            x={x + 12}
            y={y + 32}
            fontFamily={BODY}
            fontWeight={800}
            fontSize={26}
            fill="#3a3833"
          >
            {i + 1}
          </text>
        );
      })}
      {/* The red marker crosses the days off one by one; the deadline gets an amber ring. */}
      {Array.from({ length: crossed }, (_, i) => {
        const a = 10 + (i * 74) / crossed;
        const d1 = at(a, a + 3, (x) => x);
        const d2 = at(a + 2, a + 5, (x) => x);
        const { x, y } = cell(i + 1);
        // The cross sits below and right of the day's number, so the number still reads.
        const x0 = x + 30;
        const y0 = y + 44;
        const x1 = x + cw - 14;
        const y1 = y + ch - 12;
        return (
          <g
            key={i}
            stroke={COLOUR.alert}
            strokeWidth={7}
            strokeLinecap="round"
            opacity={0.9}
          >
            {d1 > 0 && (
              <line
                x1={x0}
                y1={y0}
                x2={x0 + (x1 - x0) * d1}
                y2={y0 + (y1 - y0) * d1}
              />
            )}
            {d2 > 0 && (
              <line
                x1={x1}
                y1={y0}
                x2={x1 - (x1 - x0) * d2}
                y2={y0 + (y1 - y0) * d2}
              />
            )}
          </g>
        );
      })}
      {(() => {
        const { x, y } = cell(deadline);
        return (
          <ellipse
            cx={x + 30}
            cy={y + 24}
            rx={30}
            ry={24}
            fill="none"
            stroke={COLOUR.amber}
            strokeWidth={8}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - ring}
          />
        );
      })()}
      {[X + 60, X + W - 60].map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={Y + 12} r={16} fill={COLOUR.amber} />
          <circle cx={x - 4} cy={Y + 8} r={5} fill="#fff" opacity={0.5} />
        </g>
      ))}
      {/* The marker riding the newest cross. */}
      {(() => {
        const i = Math.min(
          crossed - 1,
          Math.max(
            0,
            Math.floor(
              ((frame / Math.max(0.5, Math.min(1, len / 130)) - 10) * crossed) /
                74,
            ),
          ),
        );
        const done = at(84, 92);
        const { x, y } = cell(i + 1);
        return (
          <g
            transform={`translate(${x + cw - 10 + done * 200} ${y + ch - 10 + done * 120}) rotate(-35)`}
            opacity={1 - done}
          >
            <rect x={-12} y={0} width={24} height={150} rx={8} fill="#c43a2b" />
            <rect
              x={-12}
              y={100}
              width={24}
              height={50}
              rx={6}
              fill="#25262c"
            />
            <path d="M-8 0 L0 -18 L8 0 Z" fill="#7a1f16" />
          </g>
        );
      })()}
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- whiteboard

type Stroke = { pts: Array<[number, number]>; colour: string; w: number };

/** The board's drawing: boxes, then arrows between them, in drawing order. */
export function boardStrokes(variant: number): Stroke[] {
  const ink = "#1f2b48";
  const red = "#d9452a";
  const box = (
    x: number,
    y: number,
    w: number,
    h: number,
  ): Array<[number, number]> => [
    [x, y],
    [x + w, y + 2],
    [x + w - 2, y + h],
    [x + 2, y + h - 2],
    [x, y],
  ];
  const arrow = (
    a: [number, number],
    b: [number, number],
  ): Array<[number, number]> => {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const h1: [number, number] = [
      b[0] - 26 * Math.cos(ang - 0.5),
      b[1] - 26 * Math.sin(ang - 0.5),
    ];
    const h2: [number, number] = [
      b[0] - 26 * Math.cos(ang + 0.5),
      b[1] - 26 * Math.sin(ang + 0.5),
    ];
    return [a, b, h1, b, h2];
  };
  const layouts: Array<Array<[number, number, number, number]>> = [
    [
      [520, 260, 220, 120],
      [880, 200, 220, 120],
      [880, 460, 220, 120],
      [1240, 330, 220, 120],
    ],
    [
      [560, 240, 240, 110],
      [1120, 240, 240, 110],
      [840, 430, 240, 110],
      [840, 620, 240, 100],
    ],
  ];
  const L = layouts[variant % layouts.length]!;
  const strokes: Stroke[] = L.map(([x, y, w, h], i) => ({
    pts: box(x, y, w, h),
    colour: i === L.length - 1 ? red : ink,
    w: 7,
  }));
  const mid = (
    [x, y, w, h]: [number, number, number, number],
    side: "l" | "r" | "t" | "b",
  ): [number, number] =>
    side === "l"
      ? [x - 14, y + h / 2]
      : side === "r"
        ? [x + w + 14, y + h / 2]
        : side === "t"
          ? [x + w / 2, y - 14]
          : [x + w / 2, y + h + 14];
  const links: Array<
    [number, "l" | "r" | "t" | "b", number, "l" | "r" | "t" | "b"]
  > =
    variant % 2 === 0
      ? [
          [0, "r", 1, "l"],
          [0, "r", 2, "l"],
          [1, "r", 3, "l"],
          [2, "r", 3, "l"],
        ]
      : [
          [0, "r", 1, "l"],
          [0, "b", 2, "l"],
          [1, "b", 2, "r"],
          [2, "b", 3, "t"],
        ];
  for (const [a, sa, b, sb] of links)
    strokes.push({
      pts: arrow(mid(L[a]!, sa), mid(L[b]!, sb)),
      colour: red,
      w: 6,
    });
  // Scribbled "words" inside each box: a wavy line, no letters.
  L.forEach(([x, y, w, h], i) => {
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= 12; k++)
      pts.push([
        x + 30 + ((w - 60) * k) / 12,
        y + h / 2 + Math.sin(k * 1.9 + i) * 10,
      ]);
    strokes.splice(i * 2 + 1, 0, {
      pts,
      colour: i === L.length - 1 ? red : ink,
      w: 5,
    });
  });
  return strokes;
}

export const WhiteboardScene: React.FC<SceneProps> = ({ len, variant = 0 }) => {
  const { at } = useScene(len);
  const p = `ob-wb-${variant}`;
  const strokes = boardStrokes(variant);
  const span = 82 / strokes.length;
  const prog = strokes.map((_, i) =>
    at(10 + i * span, 10 + (i + 1) * span, (x) => x),
  );
  const live = prog.findIndex((t) => t < 1);
  const cur = live < 0 ? strokes.length - 1 : live;
  const pen = alongPolyline(strokes[cur]!.pts, prog[cur]!);
  const away = at(94, 104);
  return (
    <SceneFrame p={p} len={len} cx={960} cy={460}>
      <Room p={p} surface={940} cx={960} cy={420} />
      <Shadow p={p} cx={968} cy={470} rx={760} ry={360} o={0.4} />
      <Lit p={p} halo={false}>
        <g>
          <rect
            x={360}
            y={120}
            width={1200}
            height={700}
            rx={10}
            fill="#a7adb5"
          />
          <rect
            x={376}
            y={136}
            width={1168}
            height={668}
            rx={4}
            fill="#eef0f1"
          />
        </g>
      </Lit>
      <rect
        x={376}
        y={136}
        width={1168}
        height={200}
        fill="#fff"
        opacity={0.35}
      />
      <rect x={340} y={820} width={1240} height={22} rx={6} fill="#8f959e" />
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1180 + i * 90}
          y={796}
          width={70}
          height={22}
          rx={8}
          fill={["#1f2b48", "#d9452a", "#2f8f4e"][i]}
        />
      ))}
      <rect x={700} y={802} width={110} height={18} rx={6} fill="#3a3b42" />
      {strokes.map((s, i) =>
        prog[i]! > 0 ? (
          <path
            key={i}
            d={poly(s.pts)}
            fill="none"
            stroke={s.colour}
            strokeWidth={s.w}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - prog[i]!}
            opacity={0.92}
          />
        ) : null,
      )}
      {/* The marker riding the front of the line, then lifted away. */}
      <g
        transform={`translate(${pen[0] + away * 220} ${pen[1] + away * 260}) rotate(28)`}
        opacity={1 - away}
      >
        <rect
          x={-14}
          y={6}
          width={28}
          height={170}
          rx={9}
          fill={strokes[cur]!.colour}
        />
        <rect x={-14} y={110} width={28} height={66} rx={9} fill="#e9e9ec" />
        <path d="M-10 8 L0 -10 L10 8 Z" fill="#222" />
      </g>
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- booth

export const BoothScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, at } = useScene(len);
  const p = `ob-booth-${variant}`;
  const rec = recorderOf(year);
  const on = at(14, 24);
  const level = on * (0.35 + 0.65 * wobble(frame, 3, 0.31));
  const tiles: React.ReactNode[] = [];
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 13; c++) {
      const x = c * 150;
      const y = r * 150 - 40;
      const flip = (r + c) % 2 === 0;
      tiles.push(
        <g key={`${r}-${c}`}>
          <rect x={x} y={y} width={150} height={150} fill="#24252a" />
          {Array.from({ length: 4 }, (_, k) =>
            flip ? (
              <path
                key={k}
                d={`M${x} ${y + k * 37.5} l75 18 l75 -18 v37.5 l-75 -18 l-75 18 z`}
                fill={k % 2 ? "#1b1c20" : "#2c2d33"}
              />
            ) : (
              <path
                key={k}
                d={`M${x + k * 37.5} ${y} l18 75 l-18 75 h37.5 l-18 -75 l18 -75 z`}
                fill={k % 2 ? "#1b1c20" : "#2c2d33"}
              />
            ),
          )}
        </g>,
      );
    }
  const MX = 820;
  const MY = 380;
  return (
    <SceneFrame p={p} len={len} cx={900} cy={520}>
      <g>{tiles}</g>
      <rect
        width={1920}
        height={1080}
        fill={`url(#${p}-room)`}
        opacity={0.55}
      />
      <circle cx={MX} cy={MY} r={620} fill={`url(#${p}-warm)`} opacity={0.75} />
      <rect x={0} y={900} width={1920} height={180} fill="#16161a" />
      {/* The red light by the door: on while recording. */}
      <circle cx={1660} cy={180} r={44} fill="#3a1412" />
      <circle
        cx={1660}
        cy={180}
        r={34}
        fill={COLOUR.alert}
        opacity={0.25 + 0.75 * on}
      />
      <circle
        cx={1660}
        cy={180}
        r={90}
        fill={COLOUR.alert}
        opacity={0.25 * on}
        filter={`url(#${p}-soft)`}
      />
      {/* The stand, the mic in its shock mount, the pop filter in front and headphones on the stand. */}
      <path
        d={`M${MX} ${MY + 120} V900 M${MX - 120} 900 L${MX} 860 L${MX + 120} 900`}
        stroke="#3a3b42"
        strokeWidth={14}
        fill="none"
        strokeLinejoin="round"
      />
      <Lit p={p}>
        <g>
          <rect
            x={MX - 52}
            y={MY - 160}
            width={104}
            height={250}
            rx={52}
            fill="#b7bcc5"
          />
          {Array.from({ length: 9 }, (_, i) => (
            <line
              key={i}
              x1={MX - 44}
              x2={MX + 44}
              y1={MY - 130 + i * 14}
              y2={MY - 130 + i * 14}
              stroke="#7d828c"
              strokeWidth={3}
            />
          ))}
          <rect x={MX - 52} y={MY - 6} width={104} height={14} fill="#8d929c" />
          <ellipse
            cx={MX}
            cy={MY - 30}
            rx={92}
            ry={120}
            fill="none"
            stroke="#2b2c32"
            strokeWidth={10}
          />
          <rect x={MX - 14} y={MY + 86} width={28} height={50} fill="#2b2c32" />
        </g>
      </Lit>
      <circle
        cx={MX}
        cy={MY - 50}
        r={34 + level * 30}
        fill={COLOUR.amber}
        opacity={0.15 * level}
        filter={`url(#${p}-soft)`}
      />
      <g>
        <path
          d={`M${MX - 200} ${MY - 40} q60 40 110 20`}
          stroke="#2b2c32"
          strokeWidth={8}
          fill="none"
        />
        <ellipse
          cx={MX - 210}
          cy={MY - 60}
          rx={90}
          ry={100}
          fill="#0c0c0f"
          opacity={0.55}
        />
        <ellipse
          cx={MX - 210}
          cy={MY - 60}
          rx={90}
          ry={100}
          fill="none"
          stroke="#3a3b42"
          strokeWidth={10}
        />
        <ellipse
          cx={MX - 210}
          cy={MY - 60}
          rx={80}
          ry={90}
          fill="none"
          stroke="#fff"
          strokeOpacity={0.05}
          strokeWidth={30}
        />
      </g>
      <g>
        <path
          d={`M${MX - 60} ${MY + 200} q60 -90 120 0`}
          stroke="#25262b"
          strokeWidth={14}
          fill="none"
        />
        <rect
          x={MX - 82}
          y={MY + 190}
          width={40}
          height={70}
          rx={16}
          fill="#25262b"
        />
        <rect
          x={MX + 42}
          y={MY + 190}
          width={40}
          height={70}
          rx={16}
          fill="#25262b"
        />
      </g>
      {/* The recorder on its table. */}
      <rect x={1180} y={680} width={560} height={30} rx={4} fill="#3a3b42" />
      <rect x={1220} y={710} width={20} height={190} fill="#2b2c32" />
      <rect x={1680} y={710} width={20} height={190} fill="#2b2c32" />
      <Shadow p={p} cx={1460} cy={690} rx={250} ry={14} />
      {rec === "tape" ? (
        <Lit p={p} halo={false}>
          <g>
            <rect
              x={1220}
              y={420}
              width={480}
              height={262}
              rx={14}
              fill={BEIGE.front}
            />
            {[1340, 1580].map((cx, i) => (
              <g
                key={i}
                transform={`rotate(${frame * (i ? 7 : 9) * on} ${cx} 520)`}
              >
                <circle cx={cx} cy={520} r={78} fill="#2a2420" />
                <circle cx={cx} cy={520} r={52} fill="#5b4a3a" />
                {[0, 120, 240].map((a) => (
                  <path
                    key={a}
                    d={`M${cx} 520 L${cx + 40 * Math.sin((a * Math.PI) / 180)} ${520 - 40 * Math.cos((a * Math.PI) / 180)}`}
                    stroke={BEIGE.top}
                    strokeWidth={14}
                    strokeLinecap="round"
                  />
                ))}
                <circle cx={cx} cy={520} r={12} fill={BEIGE.top} />
              </g>
            ))}
            <path
              d="M1300 590 L1460 640 L1620 590"
              stroke="#3b2e22"
              strokeWidth={5}
              fill="none"
            />
            {[0, 1].map((i) => {
              const lv = on * (0.3 + 0.7 * wobble(frame, 5 + i, 0.37));
              const a = -50 + lv * 100;
              const x = 1340 + i * 120;
              return (
                <g key={i}>
                  <rect
                    x={x - 50}
                    y={612}
                    width={100}
                    height={56}
                    rx={6}
                    fill="#efe2c2"
                  />
                  <path
                    d={`M${x - 36} 650 A44 44 0 0 1 ${x + 36} 650`}
                    stroke={COLOUR.alert}
                    strokeWidth={4}
                    fill="none"
                    strokeDasharray="4 6"
                  />
                  <line
                    x1={x}
                    y1={664}
                    x2={x + 44 * Math.sin((a * Math.PI) / 180)}
                    y2={664 - 44 * Math.cos((a * Math.PI) / 180)}
                    stroke="#1d1d22"
                    strokeWidth={3}
                  />
                </g>
              );
            })}
          </g>
        </Lit>
      ) : (
        <g>
          {flatMonitor({
            x: 1230,
            y: 420,
            w: 460,
            h: 170,
            p,
            on,
            screen: (b) => {
              const n = 46;
              const head = Math.min(
                n,
                Math.floor(Math.max(0, frame - 16) * 0.8),
              );
              return (
                <g>
                  <rect
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    fill="#0f141c"
                  />
                  <line
                    x1={b.x}
                    x2={b.x + b.w}
                    y1={b.y + b.h / 2}
                    y2={b.y + b.h / 2}
                    stroke="#2a3446"
                    strokeWidth={2}
                  />
                  {Array.from({ length: head }, (_, i) => {
                    const hgt =
                      6 +
                      rand(i * 13 + variant) *
                        (b.h * 0.7) *
                        (0.4 + 0.6 * wobble(i, 2, 0.6));
                    return (
                      <rect
                        key={i}
                        x={b.x + 12 + i * ((b.w - 24) / n)}
                        y={b.y + b.h / 2 - hgt / 2}
                        width={(b.w - 24) / n - 3}
                        height={hgt}
                        rx={2}
                        fill={COLOUR.amber}
                        opacity={0.9}
                      />
                    );
                  })}
                  <circle
                    cx={b.x + 22}
                    cy={b.y + 20}
                    r={8}
                    fill={COLOUR.alert}
                    opacity={Math.floor(frame / 15) % 2 ? 1 : 0.4}
                  />
                </g>
              );
            },
          })}
        </g>
      )}
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- drive

export const DriveScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, at, k } = useScene(len);
  const p = `ob-drive-${variant}`;
  const kind = driveOf(year);
  const insert = at(12, 40, easeInOut);
  const busy = at(kind === "spindle" ? 50 : 42, kind === "spindle" ? 54 : 46);
  const led = busy > 0 && Math.floor(frame / 4) % 3 !== 0;
  const prog = at(44, 98, (x) => x);
  if (kind === "hdd") {
    return (
      <SceneFrame p={p} len={len} cx={960} cy={560}>
        <Room p={p} surface={DESK} deskFront={FRONT + 40} cx={960} cy={440} />
        {flatMonitor({
          x: 360,
          // Its foot sits on the desk.
          y: DESK + 14 - 380 - 88,
          w: 640,
          h: 380,
          p,
          on: 1,
          screen: (b) => (
            <g>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#121722" />
              {/* A folder, the files flying to the drive, and the bar filling. */}
              <path
                d={`M${b.x + 60} ${b.y + 90} h60 l14 16 h70 v90 h-144 z`}
                fill={COLOUR.gold}
                opacity={0.85}
              />
              <rect
                x={b.x + b.w - 200}
                y={b.y + 90}
                width={140}
                height={106}
                rx={14}
                fill="#2b3142"
              />
              <g transform={`translate(${b.x + b.w - 152} ${b.y + 120})`}>
                <PulseMark size={44} colour={COLOUR.amber} />
              </g>
              {[0, 1, 2].map((k) => {
                const f =
                  ((frame * 0.03 + k / 3) % 1) * (prog > 0 && prog < 1 ? 1 : 0);
                return f > 0 ? (
                  <rect
                    key={k}
                    x={b.x + 210 + f * (b.w - 440)}
                    y={b.y + 120 - Math.sin(f * Math.PI) * 40}
                    width={34}
                    height={42}
                    rx={4}
                    fill="#d8dce6"
                    opacity={0.85}
                  />
                ) : null;
              })}
              <rect
                x={b.x + 60}
                y={b.y + b.h - 90}
                width={b.w - 120}
                height={24}
                rx={12}
                fill="#232a3a"
              />
              <rect
                x={b.x + 60}
                y={b.y + b.h - 90}
                width={(b.w - 120) * prog}
                height={24}
                rx={12}
                fill={prog >= 1 ? COLOUR.up : COLOUR.amber}
              />
            </g>
          ),
        })}
        <Shadow p={p} cx={1350} cy={DESK + 150} rx={240} />
        <path
          d={`M1180 ${DESK + 110} C1100 ${DESK + 150} 900 ${DESK + 150} 760 ${DESK + 86}`}
          fill="none"
          stroke="#202126"
          strokeWidth={9}
          strokeLinecap="round"
          opacity={insert}
        />
        <g
          opacity={at(0, 14)}
          transform={`translate(0 ${(1 - at(0, 18)) * 40})`}
        >
          <Lit p={p}>
            <g>
              <rect
                x={1160}
                y={DESK + 10}
                width={380}
                height={140}
                rx={22}
                fill="#1d1e23"
              />
              <rect
                x={1160}
                y={DESK + 10}
                width={380}
                height={24}
                rx={12}
                fill="#2c2d34"
              />
              <PulseBadgeSvg
                x={1196}
                y={DESK + 70}
                size={38}
                colour={COLOUR.paper}
                opacity={0.9}
              />
              <circle
                cx={1500}
                cy={DESK + 120}
                r={8}
                fill={COLOUR.amber}
                opacity={led ? 1 : 0.25}
              />
            </g>
          </Lit>
        </g>
        <Mug x={1650} y={DESK + 150} />
      </SceneFrame>
    );
  }
  // A beige desktop case: a floppy goes into its drive (to 1998), or a burned disc onto its tray (to 2005).
  const caseX = 760;
  const caseY = 300;
  const tray =
    kind === "spindle"
      ? interpolate(frame, [6 * k, 18 * k, 34 * k, 48 * k], [0, 1, 1, 0], {
          ...clamp,
          easing: easeInOut,
        })
      : 0;
  return (
    <SceneFrame p={p} len={len} cx={960} cy={540}>
      <Room p={p} surface={DESK} deskFront={FRONT + 40} cx={960} cy={440} />
      <Shadow p={p} cx={caseX + 260} cy={DESK + 30} rx={330} />
      <Lit p={p}>
        <g>
          <path
            d={`M${caseX} ${caseY} L${caseX + 60} ${caseY - 40} H${caseX + 600} L${caseX + 540} ${caseY} Z`}
            fill={BEIGE.top}
          />
          <path
            d={`M${caseX + 540} ${caseY} L${caseX + 600} ${caseY - 40} V${DESK - 10} L${caseX + 540} ${DESK + 30} Z`}
            fill={BEIGE.side}
          />
          <rect
            x={caseX}
            y={caseY}
            width={540}
            height={DESK + 30 - caseY}
            fill={BEIGE.front}
          />
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={caseX + 30}
              y={caseY + 260 + i * 22}
              width={180}
              height={8}
              rx={4}
              fill={BEIGE.dark}
            />
          ))}
          <PulseBadgeSvg
            x={caseX + 30}
            y={caseY + 30}
            size={36}
            colour="#5d574a"
          />
          {/* Drive bays. */}
          <rect
            x={caseX + 250}
            y={caseY + 40}
            width={260}
            height={64}
            rx={6}
            fill={BEIGE.side}
          />
          <rect
            x={caseX + 250}
            y={caseY + 120}
            width={260}
            height={64}
            rx={6}
            fill={BEIGE.side}
          />
          <rect
            x={caseX + 290}
            y={caseY + 146}
            width={180}
            height={10}
            rx={4}
            fill="#3b382f"
          />
          <rect
            x={caseX + 270}
            y={caseY + 64}
            width={220}
            height={8}
            rx={4}
            fill="#3b382f"
          />
          {(() => {
            const at2: [number, number] = kind === "floppy" ? [caseX + 488, caseY + 170] : [caseX + 488, caseY + 90];
            return (
              <g>
                <circle cx={at2[0]} cy={at2[1]} r={22} fill={kind === "floppy" ? COLOUR.up : COLOUR.amber} opacity={led ? 0.35 : 0} filter={`url(#${p}-glow)`} />
                <circle cx={at2[0]} cy={at2[1]} r={9} fill={kind === "floppy" ? COLOUR.up : COLOUR.amber} opacity={led ? 1 : 0.25} />
              </g>
            );
          })()}
          <circle cx={caseX + 470} cy={caseY + 300} r={18} fill={BEIGE.side} />
          <circle
            cx={caseX + 470}
            cy={caseY + 300}
            r={10}
            fill={COLOUR.up}
            opacity={0.8}
          />
        </g>
      </Lit>
      {kind === "spindle" && (
        <g>
          {tray > 0 && (
            <g>
              <rect
                x={caseX + 260}
                y={caseY + 60}
                width={240}
                height={18 + tray * 6}
                fill="#2a2a2e"
              />
              <path
                d={`M${caseX + 250} ${caseY + 72} h260 l${60 * tray} ${120 * tray} h${-380 * tray - 0} z`}
                fill="#3a3a40"
                opacity={tray}
              />
              <ellipse
                cx={caseX + 380 + 20 * tray}
                cy={caseY + 72 + 70 * tray}
                rx={110 * tray}
                ry={36 * tray}
                fill={`url(#${p}-disc)`}
                opacity={tray > 0.6 && frame > 18 * k ? 1 : 0}
              />
            </g>
          )}
          {/* The spindle of burned discs beside it, marked by hand. */}
          <g>
            <ellipse cx={1520} cy={DESK + 70} rx={150} ry={40} fill="#26272c" />
            {Array.from({ length: 10 }, (_, i) => (
              <ellipse
                key={i}
                cx={1520}
                cy={DESK + 60 - i * 8}
                rx={140}
                ry={38}
                fill={i % 2 ? "#c9ced8" : "#b2b8c4"}
              />
            ))}
            <ellipse cx={1520} cy={DESK - 20} rx={140} ry={38} fill="#d9dde5" />
            <path
              d="M1460 -20 q30 -16 60 0 t60 0"
              transform={`translate(0 ${DESK})`}
              stroke="#1f2b48"
              strokeWidth={5}
              fill="none"
            />
            <rect
              x={1512}
              y={DESK - 140}
              width={16}
              height={130}
              rx={6}
              fill="#26272c"
            />
          </g>
        </g>
      )}
      {kind === "floppy" && (
        <g>
          {/* A fan of floppies, then the one going in. */}
          {[0, 1, 2, 3].map((i) => (
            <g
              key={i}
              transform={`translate(${300 + i * 34} ${DESK + 120 - i * 6}) rotate(${-14 + i * 7})`}
            >
              <rect
                x={0}
                y={0}
                width={180}
                height={186}
                rx={8}
                fill={["#1d1e23", "#2a4d8f", "#5b5e66", "#1d1e23"][i]}
              />
              <rect x={44} y={0} width={92} height={56} fill="#aeb3bb" />
              <rect x={100} y={8} width={22} height={40} fill="#5b5e66" />
              <rect
                x={22}
                y={86}
                width={136}
                height={92}
                rx={4}
                fill="#f1ece2"
              />
              <rect x={22} y={86} width={136} height={14} fill={COLOUR.amber} />
              <path
                d="M36 128 q24 -10 48 0 t48 0"
                stroke="#1f2b48"
                strokeWidth={4}
                fill="none"
              />
            </g>
          ))}
          {insert < 1 && (
            <g
              transform={`translate(${caseX + 295} ${caseY + 151}) scale(1 ${(1 - insert) * 0.6})`}
              opacity={at(4, 10)}
            >
              <rect x={0} y={0} width={170} height={186} rx={8} fill="#1d1e23" />
              <rect x={40} y={0} width={90} height={56} fill="#aeb3bb" />
              <rect x={20} y={90} width={130} height={88} rx={4} fill="#f1ece2" />
              <rect x={20} y={90} width={130} height={14} fill={COLOUR.amber} />
            </g>
          )}
        </g>
      )}
      <defs>
        <radialGradient id={`${p}-disc`}>
          <stop offset="0" stopColor="#f2f4f7" />
          <stop offset="0.5" stopColor="#b8bfca" />
          <stop offset="0.75" stopColor="#e9ecf1" />
          <stop offset="1" stopColor="#a9b0bb" />
        </radialGradient>
      </defs>
    </SceneFrame>
  );
};

// ---------------------------------------------------------------- moving

export const MovingScene: React.FC<SceneProps> = ({
  len,
  year,
  variant = 0,
}) => {
  const { frame, at } = useScene(len);
  const p = `ob-move-${variant}`;
  const era = eraOf(year);
  const drop = at(40, 54, (x) => x * x);
  const bounce = interpolate(frame, [54, 58, 62, 64], [0, -14, 0, -4], clamp);
  const keysY = DESK + 120 - (1 - drop) * 520 + bounce;
  const swing = interpolate(frame, [54, 64, 74, 84], [0, 12, -6, 0], clamp);
  const BX = 900;
  const BY = DESK + 80;
  return (
    <SceneFrame p={p} len={len} cx={960} cy={560}>
      <Room
        p={p}
        surface={DESK}
        deskFront={FRONT + 40}
        cx={1000}
        cy={420}
        light={0.85}
      />
      {/* Window light falling across from the left, with dust drifting in it. */}
      <path
        d="M0 120 L520 120 L1300 1080 L0 1080 Z"
        fill="#ffe6c4"
        opacity={0.06}
      />
      {Array.from({ length: 26 }, (_, i) => {
        const x = 180 + rand(i * 5 + 1) * 700 + Math.sin(frame * 0.02 + i) * 14;
        const y =
          220 + ((rand(i * 5 + 2) * 600 + frame * (0.3 + rand(i) * 0.4)) % 600);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={1.8 + rand(i * 5 + 3) * 2}
            fill="#ffe9cc"
            opacity={0.35}
          />
        );
      })}
      {/* Where the monitor stood: a cleaner outline in the dust and a loose cable. */}
      {era === "crt" ? (
        <path
          d={`M1180 ${DESK + 40} H1500 L1470 ${DESK + 4} H1210 Z`}
          fill="#56545b"
          opacity={0.6}
        />
      ) : (
        <ellipse
          cx={1340}
          cy={DESK + 30}
          rx={130}
          ry={18}
          fill="#56545b"
          opacity={0.6}
        />
      )}
      <path
        d={`M1560 ${DESK} C1560 ${DESK + 60} 1500 ${DESK + 90} 1440 ${DESK + 70}`}
        stroke="#1d1d22"
        strokeWidth={8}
        fill="none"
        strokeLinecap="round"
      />
      <Shadow p={p} cx={BX} cy={BY + 4} rx={330} ry={24} />
      {/* The box: back, what pokes out of it (a lamp head, a plant, a frame's back), then its front. */}
      <path
        d={`M${BX - 280} ${BY - 280} L${BX - 220} ${BY - 340} H${BX + 320} L${BX + 260} ${BY - 280} Z`}
        fill="#6a4f33"
      />
      <g>
        <rect
          x={BX - 200}
          y={BY - 470}
          width={150}
          height={210}
          rx={6}
          fill="#3a3b42"
          transform={`rotate(-8 ${BX - 125} ${BY - 300})`}
        />
        <rect
          x={BX - 186}
          y={BY - 456}
          width={122}
          height={182}
          rx={4}
          fill="#2b2c32"
          transform={`rotate(-8 ${BX - 125} ${BY - 300})`}
        />
        <g transform={`translate(${BX + 120} ${BY - 300})`}>
          <path
            d="M0 0 C-60 -60 -70 -140 -20 -190 C0 -120 10 -60 0 0"
            fill="#3f7d4f"
          />
          <path
            d="M0 0 C50 -50 90 -110 60 -180 C30 -110 10 -60 0 0"
            fill="#336b42"
          />
          <path
            d="M0 0 C10 -80 40 -150 10 -230 C-10 -150 -10 -80 0 0"
            fill="#4a8f5a"
          />
        </g>
        <path
          d={`M${BX - 30} ${BY - 300} L${BX + 10} ${BY - 420} L${BX + 60} ${BY - 410} L${BX + 30} ${BY - 300} Z`}
          fill="#3a3b42"
        />
        <ellipse
          cx={BX + 36}
          cy={BY - 418}
          rx={44}
          ry={14}
          fill="#4a4b53"
          transform={`rotate(10 ${BX + 36} ${BY - 418})`}
        />
      </g>
      <Lit p={p} halo={false}>
        <g>
          <path
            d={`M${BX + 260} ${BY - 280} L${BX + 320} ${BY - 340} V${BY - 60} L${BX + 260} ${BY} Z`}
            fill="#8a6640"
          />
          <rect
            x={BX - 280}
            y={BY - 280}
            width={540}
            height={280}
            fill="#b0844f"
          />
          <path
            d={`M${BX - 280} ${BY - 280} L${BX - 330} ${BY - 200} L${BX - 270} ${BY - 196} Z`}
            fill="#a27a4a"
          />
          <path
            d={`M${BX + 260} ${BY - 280} L${BX + 330} ${BY - 210} L${BX + 300} ${BY - 196} Z`}
            fill="#9a7243"
          />
          <rect
            x={BX - 40}
            y={BY - 280}
            width={80}
            height={280}
            fill={COLOUR.amber}
            opacity={0.85}
          />
          <g transform={`translate(${BX - 22} ${BY - 170})`}>
            <PulseMark size={44} colour={COLOUR.ink} />
          </g>
        </g>
      </Lit>
      {/* The keys drop in front of the box, bounce and the fob swings. */}
      <Shadow
        p={p}
        cx={1260}
        cy={DESK + 130}
        rx={70 * (0.4 + 0.6 * drop)}
        ry={10}
        o={0.5 * drop}
      />
      <g
        transform={`translate(1240 ${keysY}) rotate(${swing})`}
        opacity={at(36, 40)}
      >
        <circle
          cx={0}
          cy={0}
          r={22}
          fill="none"
          stroke="#c9ccd3"
          strokeWidth={6}
        />
        <path
          d="M6 20 l46 4 l4 10 l-8 0 l0 8 l-8 0 l0 -8 l-34 -4 z"
          fill="#c9a24d"
        />
        <path d="M-14 18 l-22 40 l6 4 l4 -8 l6 4 l4 -8 z" fill="#b7bbc4" />
        <g transform="translate(-58 -6) rotate(-10)">
          <rect
            x={0}
            y={0}
            width={44}
            height={56}
            rx={10}
            fill={COLOUR.amber}
          />
          <g transform="translate(6 12)">
            <PulseMark size={32} colour={COLOUR.ink} />
          </g>
        </g>
      </g>
    </SceneFrame>
  );
};

/** Every period-object scene by name. */
export const OBJECT_COMPONENTS: Record<ObjectScene, React.FC<SceneProps>> = {
  desk: DeskScene,
  discs: DiscsScene,
  fax: FaxScene,
  phone: PhoneScene,
  clock: ClockScene,
  calendar: CalendarScene,
  whiteboard: WhiteboardScene,
  booth: BoothScene,
  drive: DriveScene,
  moving: MovingScene,
};
