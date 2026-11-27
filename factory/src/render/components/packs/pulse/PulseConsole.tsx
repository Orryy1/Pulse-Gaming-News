// Pulse pack, "PulseConsole" (owner, 30 Oct 2026: the Pulse universe): hardware specs as a product reveal of a
// Pulse games console from the story's era. One original design per generation, each an homage to the look of
// its time and never a copy of a real console's shape, logo or colourway:
//   to 1993   Pulse Tempo: a low cartridge box with a ridged top, a cartridge sliding into its slot and a
//             power slider (a wood-grain front panel up to 1984);
//   1994-99   Pulse Prism: a warm grey disc console whose round lid closes over the disc;
//   2000-05   Pulse Basalt: a black grooved slab whose disc tray slides shut;
//   2006-12   Pulse Comet: a glossy arched console with a slot loader and a light sweeping over the gloss;
//   2013-19   Pulse Facet: a matte angular slab with a light strip running along its top groove;
//   2020 on   Pulse Spire: a tall graphite tower with a lit seam filling from the floor.
// The console slides and turns onto a turntable, its power light comes on, a pad of the same generation lands
// beside it (corded until 2005, wireless after), then the "label: value" rows draw out as callouts on leader
// lines under the heading. The Pulse badge sits where a maker's logo would; the game's picture, when there is
// one, is the cartridge label or the disc print. Every word comes from the graphic apart from the badge and the
// generation name. Tagged ILLUSTRATION.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import { Preload } from "../preload.tsx";
import {
  clamp,
  easeInOut,
  easeOut,
  paceFor,
  sizeByLength,
  specRows,
  txt,
} from "../screen/common.ts";
import { PulseMark, storyYear } from "../screen/pulse.tsx";
import { PulseBadgeSvg } from "./PulseBadge.tsx";

/** A console generation by the story's year, and its invented Pulse name. */
export type ConsoleGen =
  | "tempo"
  | "prism"
  | "basalt"
  | "comet"
  | "facet"
  | "spire";

export function consoleOf(year: number): { gen: ConsoleGen; name: string } {
  if (year <= 1993) return { gen: "tempo", name: "Tempo" };
  if (year <= 1999) return { gen: "prism", name: "Prism" };
  if (year <= 2005) return { gen: "basalt", name: "Basalt" };
  if (year <= 2012) return { gen: "comet", name: "Comet" };
  if (year <= 2019) return { gen: "facet", name: "Facet" };
  return { gen: "spire", name: "Spire" };
}

// The stage: the console stands on a turntable left of centre, the callouts run down the right.
const CX = 580;
const FLOOR = 800;
/** The rigs are drawn at a modest size round (CX, FLOOR); on stage each is scaled up and dropped by DY. */
const DY = 50;
const COL_X = 1170;
/** How much each generation grows on stage: the wide boxes to about 1000 px across, the tower to full height. */
const SCALE: Record<ConsoleGen, number> = {
  tempo: 1.64,
  prism: 1.4,
  basalt: 1.54,
  comet: 1.64,
  facet: 1.38,
  spire: 1.05,
};
// The era's own action (cartridge in, lid or tray shut, a gloss sweep) and the moment the power comes on.
const ACT: [number, number] = [18, 36];
const POWER = 42;

type Ctx = {
  frame: number;
  /** The era action, 0 to 1. */
  act: number;
  /** The power light, 0 to 1. */
  on: number;
  src?: string;
  year: number;
  /** The generation name as printed on the body. */
  name: string;
};

type Rig = {
  /** Body width, so the pad can stand clear of it. */
  w: number;
  body: React.ReactNode;
  /** Six spots on the body for the leader lines to start from. */
  spots: Array<[number, number]>;
  /** Where a corded pad plugs in. */
  port?: [number, number];
};

/** The top face of a box seen from the front and a little above: wide at the front edge, narrower behind. */
const trap = (l: number, r: number, front: number, d: number, ins: number) =>
  `M${l} ${front} H${r} L${r - ins} ${front - d} H${l + ins} Z`;

/** Left and right edges of that top face at screen height y. */
function edges(
  l: number,
  r: number,
  front: number,
  d: number,
  ins: number,
  y: number,
): [number, number] {
  const f = (front - y) / d;
  return [l + ins * f, r - ins * f];
}

/** A power light: dark when off, a coloured core and a soft halo when on. */
const Led: React.FC<{
  x: number;
  y: number;
  r: number;
  on: number;
  colour?: string;
  off?: string;
}> = ({ x, y, r, on, colour = COLOUR.amber, off = "#2a1c14" }) => (
  <g>
    <circle cx={x} cy={y} r={r} fill={off} />
    {on > 0 && (
      <>
        <circle
          cx={x}
          cy={y}
          r={r * 3}
          fill={colour}
          opacity={on * 0.45}
          filter="url(#pcon-glow)"
        />
        <circle cx={x} cy={y} r={r} fill={colour} opacity={on} />
      </>
    )}
  </g>
);

/** The generation name on the body, small spaced capitals. */
const Name: React.FC<{
  x: number;
  y: number;
  text: string;
  fill: string;
  anchor?: "start" | "middle" | "end";
}> = ({ x, y, text, fill, anchor = "start" }) => (
  <text
    x={x}
    y={y}
    textAnchor={anchor}
    fontFamily={BODY}
    fontWeight={700}
    fontSize={22}
    letterSpacing={6}
    fill={fill}
  >
    {text.toUpperCase()}
  </text>
);

/** A disc seen from above at an angle: the game's picture printed on it when there is one. */
const Disc: React.FC<{
  cx: number;
  cy: number;
  r: number;
  squash: number;
  src?: string;
}> = ({ cx, cy, r, squash, src }) => (
  <g
    transform={`translate(${cx} ${cy}) scale(1 ${squash}) translate(${-cx} ${-cy})`}
  >
    <clipPath id="pcon-disc-clip">
      <circle cx={cx} cy={cy} r={r * 0.86} />
    </clipPath>
    <circle cx={cx} cy={cy} r={r} fill="url(#pcon-disc)" />
    {src && (
      <image
        href={src}
        x={cx - r * 0.86}
        y={cy - r * 0.86}
        width={r * 1.72}
        height={r * 1.72}
        preserveAspectRatio="xMidYMid slice"
        clipPath="url(#pcon-disc-clip)"
        opacity={0.92}
      />
    )}
    <circle cx={cx} cy={cy} r={r * 0.22} fill="#dfe2e8" />
    <circle cx={cx} cy={cy} r={r * 0.1} fill="#4d5057" />
  </g>
);

/** The cartridge label: the game's picture, else bands of colour round the mark (no words). */
const CartLabel: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  src?: string;
}> = ({ x, y, w, h, src }) => (
  <g>
    <clipPath id="pcon-label-clip">
      <rect x={x} y={y} width={w} height={h} rx={4} />
    </clipPath>
    {src ? (
      <image
        href={src}
        x={x}
        y={y}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMid slice"
        clipPath="url(#pcon-label-clip)"
      />
    ) : (
      <g clipPath="url(#pcon-label-clip)">
        <rect x={x} y={y} width={w} height={h} fill="#141417" />
        <rect x={x} y={y + 8} width={w} height={7} fill={COLOUR.alert} />
        <rect x={x} y={y + 17} width={w} height={7} fill={COLOUR.amber} />
        <rect x={x} y={y + 26} width={w} height={7} fill={COLOUR.gold} />
        <g transform={`translate(${x + w / 2 - 20} ${y + 40})`}>
          <PulseMark size={40} colour={COLOUR.paper} />
        </g>
      </g>
    )}
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={4}
      fill="none"
      stroke="#2b2a30"
      strokeWidth={3}
    />
  </g>
);

/** To 1993: Pulse Tempo, a low cartridge box. */
function tempo(c: Ctx): Rig {
  const W = 600;
  const L = CX - W / 2;
  const R = CX + W / 2;
  const FT = FLOOR - 120;
  const D = 110;
  const I = 40;
  const wood = c.year <= 1984;
  const slotY = FT - 62;
  // The cartridge drops into the slot as the console lands.
  const cartTop = slotY + 8 - 132 - (1 - c.act) * 90;
  const ridges: string[] = [];
  for (let k = 0; k < 5; k++) {
    const y = FT - D + 10 + k * 9;
    const [a, b] = edges(L, R, FT, D, I, y);
    ridges.push(`M${a + 18} ${y} H${CX - 150} M${CX + 150} ${y} H${b - 18}`);
  }
  // The power slider is pushed across just before the light comes on.
  const knob = interpolate(c.frame, [POWER - 6, POWER], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const grain = [0, 1, 2, 3, 4].map(
    (k) =>
      `M${L + 16} ${FT + 24 + k * 13} Q${CX - 140} ${FT + 28 + k * 13 + (k % 2 ? 4 : -3)} ${CX} ${FT + 24 + k * 13} T${R - 16} ${FT + 24 + k * 13}`,
  );
  return {
    w: W,
    port: [L + 55, FT + 102],
    spots: [
      [CX + 40, cartTop + 20],
      [CX + 230, FT - D + 26],
      [R - 90, FT - 30],
      [R - 60, FT + 50],
      [CX + 60, FT + 66],
      [R - 152, FT + 102],
    ],
    body: (
      <g>
        <clipPath id="pcon-cart-clip">
          <rect x={0} y={0} width={1920} height={slotY + 7} />
        </clipPath>
        <path d={trap(L, R, FT, D, I)} fill="url(#pcon-tempo-top)" />
        <path d={ridges.join(" ")} stroke="#18171b" strokeWidth={3} />
        <rect
          x={CX - 135}
          y={slotY}
          width={270}
          height={14}
          rx={4}
          fill="#0a0a0c"
        />
        <g clipPath="url(#pcon-cart-clip)">
          <rect
            x={CX - 120}
            y={cartTop}
            width={240}
            height={140}
            rx={8}
            fill="#5d5c63"
            stroke="#77767d"
            strokeWidth={2}
          />
          {[0, 1, 2].map((k) => (
            <line
              key={k}
              x1={CX - 90}
              x2={CX + 90}
              y1={cartTop + 9 + k * 7}
              y2={cartTop + 9 + k * 7}
              stroke="#47464c"
              strokeWidth={3}
            />
          ))}
          <CartLabel x={CX - 98} y={cartTop + 34} w={196} h={86} src={c.src} />
        </g>
        <rect x={L} y={FT} width={W} height={120} fill="#1c1b20" />
        <line
          x1={L}
          x2={R}
          y1={FT + 1}
          y2={FT + 1}
          stroke="#4a4950"
          strokeWidth={2}
        />
        {wood ? (
          <g>
            <rect
              x={L + 16}
              y={FT + 14}
              width={W - 32}
              height={72}
              rx={3}
              fill="url(#pcon-wood)"
            />
            <path
              d={grain.join(" ")}
              stroke="#4a2c14"
              strokeOpacity={0.55}
              strokeWidth={2}
              fill="none"
            />
          </g>
        ) : (
          <g>
            <rect
              x={L + 16}
              y={FT + 14}
              width={W - 32}
              height={72}
              rx={3}
              fill="#28272d"
            />
            <rect
              x={L + 16}
              y={FT + 20}
              width={W - 32}
              height={5}
              fill={COLOUR.amber}
            />
            <rect
              x={L + 16}
              y={FT + 29}
              width={W - 32}
              height={3}
              fill="#8d8b92"
            />
          </g>
        )}
        <PulseBadgeSvg
          x={L + 34}
          y={FT + 42}
          size={32}
          colour={wood ? "#f3e2c4" : COLOUR.paper}
        />
        <Name
          x={R - 34}
          y={FT + 72}
          text={c.name}
          fill={wood ? "#f3e2c4" : COLOUR.muted}
          anchor="end"
        />
        {[0, 1].map((k) => (
          <rect
            key={k}
            x={L + 30 + k * 62}
            y={FT + 94}
            width={50}
            height={16}
            rx={3}
            fill="#0b0b0d"
            stroke="#3a3940"
            strokeWidth={2}
          />
        ))}
        <rect
          x={R - 190}
          y={FT + 93}
          width={76}
          height={18}
          rx={4}
          fill="#0b0b0d"
        />
        <rect
          x={R - 188 + knob * 42}
          y={FT + 95}
          width={30}
          height={14}
          rx={3}
          fill="#9c9aa2"
        />
        <Led x={R - 80} y={FT + 102} r={6} on={c.on} colour={COLOUR.alert} />
      </g>
    ),
  };
}

/** 1994-1999: Pulse Prism, a warm grey disc console with a round lid. */
function prism(c: Ctx): Rig {
  const W = 560;
  const L = CX - W / 2;
  const R = CX + W / 2;
  const FT = FLOOR - 110;
  const D = 230;
  const I = 60;
  const lidX = CX - 50;
  const lidY = 580;
  // The lid is hinged at its back edge: open (1) it stands tilted up behind the disc, seen foreshortened
  // from underneath, and it swings down flat over the disc as the console lands.
  const open = 1 - c.act;
  const hingeY = lidY - 76;
  const lidCy = hingeY + 76 * (1 - open) - 96 * open;
  const lidRy = 76 * (1 - open) + 34 * open;
  const vents = [0, 1, 2, 3, 4]
    .map((k) => `M${CX + 120 + k * 16} 530 l14 66`)
    .join(" ");
  return {
    w: W,
    port: [L + 69, FT + 60],
    spots: [
      [CX - 10, 504],
      [CX + 175, 562],
      [CX + 90, 632],
      [R - 70, FT + 54],
      [R - 138, FT + 72],
      [CX + 30, FT + 92],
    ],
    body: (
      <g>
        <path d={trap(L, R, FT, D, I)} fill="url(#pcon-prism-top)" />
        <path
          d={vents}
          stroke="#aeaba4"
          strokeWidth={6}
          strokeLinecap="round"
        />
        <ellipse cx={lidX} cy={lidY} rx={160} ry={80} fill="#a9a69f" />
        {open > 0.02 && (
          <Disc cx={lidX} cy={lidY} r={140} squash={0.5} src={c.src} />
        )}
        {open > 0.5 && (
          // The lid's edge, from the hinge up to the raised rim.
          <path
            d={`M${lidX - 152} ${hingeY} L${lidX - 152} ${lidCy} A152 ${lidRy} 0 0 1 ${lidX + 152} ${lidCy} L${lidX + 152} ${hingeY} Z`}
            fill="#8f8c85"
          />
        )}
        <ellipse
          cx={lidX}
          cy={lidCy}
          rx={152}
          ry={lidRy}
          fill={open > 0.5 ? "#7d7a73" : "url(#pcon-prism-lid)"}
          stroke={open > 0.5 ? "#c3c0b9" : "#9b988f"}
          strokeWidth={open > 0.5 ? 3 : 2}
        />
        {open <= 0.5 && (
          <g>
            <ellipse
              cx={lidX}
              cy={lidCy}
              rx={118}
              ry={lidRy * 0.78}
              fill="none"
              stroke="#b9b6af"
              strokeWidth={3}
            />
            <g transform={`translate(${lidX - 22} ${lidCy - 22})`}>
              <PulseMark size={44} colour="#8f8c85" />
            </g>
          </g>
        )}
        <rect x={L} y={FT} width={W} height={110} fill="#b4b1aa" />
        <line
          x1={L}
          x2={R}
          y1={FT + 1}
          y2={FT + 1}
          stroke="#dedbd4"
          strokeWidth={2}
        />
        {[0, 1].map((k) => (
          <g key={k}>
            <rect
              x={L + 34 + k * 86}
              y={FT + 44}
              width={70}
              height={30}
              rx={8}
              fill="#8e8b84"
            />
            <rect
              x={L + 46 + k * 86}
              y={FT + 54}
              width={46}
              height={10}
              rx={3}
              fill="#3e3c38"
            />
          </g>
        ))}
        <PulseBadgeSvg x={CX - 60} y={FT + 26} size={34} colour="#5c5a55" />
        <Name x={CX - 60} y={FT + 92} text={c.name} fill="#6e6b65" />
        <rect
          x={R - 170}
          y={FT + 40}
          width={64}
          height={28}
          rx={14}
          fill="#a4a19a"
          stroke="#8f8c85"
          strokeWidth={2}
        />
        <Led x={R - 70} y={FT + 54} r={7} on={c.on} off="#6f6c66" />
      </g>
    ),
  };
}

/** 2000-2005: Pulse Basalt, a black grooved slab with a disc tray. */
function basalt(c: Ctx): Rig {
  const W = 640;
  const L = CX - W / 2;
  const R = CX + W / 2;
  const FT = FLOOR - 150;
  const D = 90;
  const I = 30;
  const grooves: string[] = [];
  for (let k = 0; k < 7; k++) {
    const y = FT - D + 8 + k * 12;
    const [a, b] = edges(L, R, FT, D, I, y);
    grooves.push(`M${a + 14} ${y} H${b - 14}`);
  }
  const slotY = FT + 40;
  // The tray starts out with the disc on it and slides shut (out is 1).
  const out = 1 - c.act;
  const depth = 96 * out;
  const tl = L + 40;
  const tr = L + 400;
  return {
    w: W,
    port: [L + 73, FT + 115],
    spots: [
      [CX - 40, FT - 66],
      [CX + 200, FT - 40],
      [tr - 70, slotY],
      [R - 60, FT + 44],
      [R - 150, FT + 90],
      [CX + 40, FT + 118],
    ],
    body: (
      <g>
        <path d={trap(L, R, FT, D, I)} fill="url(#pcon-basalt-top)" />
        <path d={grooves.join(" ")} stroke="#0f0f12" strokeWidth={3} />
        <rect x={L} y={FT} width={W} height={150} fill="#141417" />
        <line
          x1={L}
          x2={R}
          y1={FT + 1}
          y2={FT + 1}
          stroke="#33333a"
          strokeWidth={2}
        />
        <line
          x1={tl}
          x2={tr}
          y1={slotY}
          y2={slotY}
          stroke="#050506"
          strokeWidth={5}
        />
        <line
          x1={tl}
          x2={tr}
          y1={slotY + 4}
          y2={slotY + 4}
          stroke="#26262c"
          strokeWidth={1.5}
        />
        <line
          x1={R - 222}
          x2={R - 222}
          y1={FT + 14}
          y2={FT + 136}
          stroke="#0a0a0c"
          strokeWidth={3}
        />
        <PulseBadgeSvg x={R - 200} y={FT + 26} size={30} colour="#8e8e96" />
        <Name x={R - 200} y={FT + 92} text={c.name} fill="#6a6a72" />
        <circle
          cx={R - 60}
          cy={FT + 44}
          r={15}
          fill="#1d1d22"
          stroke="#2e2e34"
          strokeWidth={2}
        />
        <Led x={R - 60} y={FT + 44} r={5} on={c.on} off="#2a2a30" />
        {[0, 1].map((k) => (
          <rect
            key={k}
            x={L + 40 + k * 80}
            y={FT + 104}
            width={66}
            height={22}
            rx={4}
            fill="#0a0a0c"
            stroke="#2a2a30"
            strokeWidth={2}
          />
        ))}
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <line
            key={k}
            x1={R - 190 + k * 22}
            x2={R - 190 + k * 22}
            y1={FT + 112}
            y2={FT + 132}
            stroke="#0a0a0c"
            strokeWidth={6}
            strokeLinecap="round"
          />
        ))}
        {out > 0.02 && (
          <g>
            <path
              d={`M${tl} ${slotY + 2} H${tr} L${tr + 14 * out} ${slotY + 2 + depth} H${tl - 14 * out} Z`}
              fill="#1e1e23"
              stroke="#2c2c33"
              strokeWidth={2}
            />
            <Disc
              cx={(tl + tr) / 2}
              cy={slotY + 2 + depth / 2}
              r={150}
              squash={Math.max(0.03, (depth / 300) * 0.9)}
              src={c.src}
            />
            <rect
              x={tl - 14 * out}
              y={slotY + 2 + depth}
              width={tr - tl + 28 * out}
              height={16}
              fill="#18181c"
              stroke="#2c2c33"
              strokeWidth={1.5}
            />
          </g>
        )}
      </g>
    ),
  };
}

/** 2006-2012: Pulse Comet, a glossy arched console with a slot loader. */
function comet(c: Ctx): Rig {
  const W = 600;
  const L = CX - W / 2;
  const R = CX + W / 2;
  const shell = `M${L} ${FLOOR} V690 C${L} 648 ${CX - 200} 610 ${CX} 610 C${CX + 200} 610 ${R} 648 ${R} 690 V${FLOOR} Z`;
  // A band of light passes over the gloss as the console turns to face us.
  const sweep = L - 160 + (W + 320) * c.act;
  return {
    w: W,
    spots: [
      [CX + 80, 616],
      [CX + 230, 652],
      [CX + 140, 712],
      [R - 60, 745],
      [R - 130, 772],
      [CX + 30, 786],
    ],
    body: (
      <g>
        <clipPath id="pcon-comet-clip">
          <path d={shell} />
        </clipPath>
        <path d={shell} fill="url(#pcon-comet)" />
        <g clipPath="url(#pcon-comet-clip)">
          <ellipse
            cx={CX}
            cy={636}
            rx={270}
            ry={28}
            fill="#fff"
            opacity={0.12}
          />
          <rect
            x={sweep}
            y={560}
            width={120}
            height={300}
            fill="url(#pcon-sweep)"
            transform={`skewX(-24)`}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
        </g>
        <line
          x1={CX - 170}
          x2={CX + 170}
          y1={712}
          y2={712}
          stroke="#05060a"
          strokeWidth={5}
          strokeLinecap="round"
        />
        <line
          x1={CX - 160}
          x2={CX + 160}
          y1={717}
          y2={717}
          stroke={COLOUR.amber}
          strokeWidth={2}
          opacity={c.on * 0.8}
        />
        <line
          x1={L + 8}
          x2={R - 8}
          y1={772}
          y2={772}
          stroke="url(#pcon-silver)"
          strokeWidth={3}
        />
        <PulseBadgeSvg x={CX - 72} y={640} size={34} colour="#d7dae2" />
        <Name x={L + 40} y={758} text={c.name} fill="#8b90a3" />
        <circle
          cx={R - 100}
          cy={745}
          r={7}
          fill="none"
          stroke="#5d6378"
          strokeWidth={2}
        />
        <Led x={R - 60} y={745} r={8} on={c.on} off="#2a2f42" />
      </g>
    ),
  };
}

/** 2013-2019: Pulse Facet, a matte angular slab. */
function facet(c: Ctx): Rig {
  const W = 720;
  const L = CX - W / 2;
  const R = CX + W / 2;
  const FT = FLOOR - 110;
  const D = 120;
  const I = 40;
  const gy = FT - 54;
  const [gl, gr] = edges(L, R, FT, D, I, gy);
  // The groove light runs from left to right as the power comes on, then rests a little dimmer.
  const run = interpolate(c.frame, [POWER, POWER + 16], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const split = CX + 70;
  return {
    w: W,
    spots: [
      [CX - 60, FT - 92],
      [CX + 200, FT - 76],
      [CX + 260, gy],
      [R - 140, FT + 26],
      [CX + 140, FT + 60],
      [L + 300, FT + 26],
    ],
    body: (
      <g>
        <path d={trap(L, R, FT, D, I)} fill="url(#pcon-facet-rear)" />
        <path d={`M${L} ${FT} H${R} L${gr} ${gy} H${gl} Z`} fill="#2b2c31" />
        <line
          x1={gl}
          x2={gr}
          y1={gy}
          y2={gy}
          stroke="#101113"
          strokeWidth={7}
        />
        {run > 0 && (
          <g opacity={c.on}>
            <line
              x1={gl + 10}
              x2={gl + 10 + (gr - gl - 20) * run}
              y1={gy}
              y2={gy}
              stroke={COLOUR.amber}
              strokeWidth={8}
              opacity={0.5}
              filter="url(#pcon-glow)"
            />
            <line
              x1={gl + 10}
              x2={gl + 10 + (gr - gl - 20) * run}
              y1={gy}
              y2={gy}
              stroke={COLOUR.amber}
              strokeWidth={3}
            />
          </g>
        )}
        <PulseBadgeSvg x={L + 70} y={FT - 44} size={28} colour="#55575e" />
        <path
          d={`M${L} ${FT} H${split} L${split - 22} ${FLOOR - 14} H${L + 30} Z`}
          fill="#1f2024"
        />
        <path
          d={`M${split} ${FT} H${R} L${R - 50} ${FLOOR - 14} H${split - 22} Z`}
          fill="#2a2b30"
        />
        <rect
          x={L + 30}
          y={FLOOR - 14}
          width={W - 80}
          height={14}
          fill="#0b0b0d"
        />
        <line
          x1={L + 40}
          x2={L + 320}
          y1={FT + 26}
          y2={FT + 26}
          stroke="#0a0a0c"
          strokeWidth={4}
        />
        <line
          x1={R - 180}
          x2={R - 110}
          y1={FT + 26}
          y2={FT + 26}
          stroke="#3a3b41"
          strokeWidth={4}
          strokeLinecap="round"
        />
        <line
          x1={R - 180}
          x2={R - 110}
          y1={FT + 26}
          y2={FT + 26}
          stroke={COLOUR.amber}
          strokeWidth={4}
          strokeLinecap="round"
          opacity={c.on}
        />
        <Name
          x={R - 70}
          y={FT + 74}
          text={c.name}
          fill="#6b6d74"
          anchor="end"
        />
      </g>
    ),
  };
}

/** 2020 on: Pulse Spire, a tall graphite tower. */
function spire(c: Ctx): Rig {
  const W = 240;
  const L = CX - W / 2;
  const R = CX + W / 2;
  const FT = FLOOR - 460;
  const D = 60;
  const I = 20;
  const seamX = L + 64;
  const xc = (seamX + R) / 2;
  const fill = interpolate(c.frame, [POWER, POWER + 18], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const vents: Array<[number, number]> = [];
  for (let row = 0; row < 4; row++) {
    const y = FT - 10 - row * 12;
    const [a, b] = edges(L + 6, R - 6, FT, D, I, y);
    for (let k = 0; k < 9; k++)
      vents.push([a + 14 + ((b - a - 28) * k) / 8, y]);
  }
  return {
    w: W,
    spots: [
      [CX, FT - 30],
      [xc, FT + 70],
      [R - 26, FT + 220],
      [seamX, FT + 300],
      [xc, FLOOR - 110],
      [xc, FLOOR - 70],
    ],
    body: (
      <g>
        <rect
          x={L + 30}
          y={FLOOR - 4}
          width={W - 60}
          height={12}
          rx={4}
          fill="#0d0d0f"
        />
        <path d={trap(L + 6, R - 6, FT + 4, D, I)} fill="#1d1e22" />
        {vents.map(([x, y], i) => (
          <ellipse key={i} cx={x} cy={y} rx={6} ry={3} fill="#0b0b0d" />
        ))}
        <rect
          x={L}
          y={FT}
          width={W}
          height={460}
          rx={16}
          fill="url(#pcon-spire)"
        />
        <line
          x1={seamX}
          x2={seamX}
          y1={FT + 20}
          y2={FLOOR - 20}
          stroke="#121316"
          strokeWidth={6}
        />
        {fill > 0 && (
          <g opacity={c.on}>
            <line
              x1={seamX}
              x2={seamX}
              y1={FLOOR - 20}
              y2={FLOOR - 20 - 420 * fill}
              stroke={COLOUR.amber}
              strokeWidth={8}
              opacity={0.5}
              filter="url(#pcon-glow)"
            />
            <line
              x1={seamX}
              x2={seamX}
              y1={FLOOR - 20}
              y2={FLOOR - 20 - 420 * fill}
              stroke={COLOUR.amber}
              strokeWidth={3}
            />
          </g>
        )}
        <g transform={`translate(${xc - 27} ${FT + 40})`}>
          <PulseMark size={54} colour="#aeb2bb" />
        </g>
        <text
          x={xc + 3}
          y={FT + 126}
          textAnchor="middle"
          fontFamily={BODY}
          fontWeight={800}
          fontSize={26}
          letterSpacing={5}
          fill="#aeb2bb"
        >
          PULSE
        </text>
        <line
          x1={R - 26}
          x2={R - 26}
          y1={FT + 160}
          y2={FT + 290}
          stroke="#121316"
          strokeWidth={4}
          strokeLinecap="round"
        />
        <circle
          cx={xc}
          cy={FLOOR - 110}
          r={15}
          fill="#22242a"
          stroke="#3c3f46"
          strokeWidth={2}
        />
        <circle
          cx={xc}
          cy={FLOOR - 110}
          r={15}
          fill="none"
          stroke={COLOUR.amber}
          strokeWidth={3}
          opacity={c.on}
        />
        {[0, 1].map((k) => (
          <rect
            key={k}
            x={xc - 40 + k * 50}
            y={FLOOR - 76}
            width={30}
            height={12}
            rx={3}
            fill="#121316"
          />
        ))}
        <Name
          x={xc + 3}
          y={FLOOR - 34}
          text={c.name}
          fill="#6f727a"
          anchor="middle"
        />
      </g>
    ),
  };
}

const RIGS: Record<ConsoleGen, (c: Ctx) => Rig> = {
  tempo,
  prism,
  basalt,
  comet,
  facet,
  spire,
};

// The pads: a flat oblong in the cartridge years, then a pad with two grips in each generation's material.
const GRIP =
  "M-95 -62 H95 C130 -62 146 -36 150 -2 C155 40 154 78 128 84 C106 89 93 72 80 52 L62 28 H-62 L-80 52 C-93 72 -106 89 -128 84 C-154 78 -155 40 -150 -2 C-146 -36 -130 -62 -95 -62 Z";

type PadLook = {
  body: string;
  trim: string;
  keys: string;
  face: string[];
  sticks: "none" | "low" | "offset";
  wireless: boolean;
  /** A Pulse mark home button that lights with the console. */
  home: boolean;
};

const PADS: Record<ConsoleGen, PadLook> = {
  tempo: {
    body: "#25242a",
    trim: "#8e8c94",
    keys: "#111014",
    face: [COLOUR.alert, COLOUR.alert],
    sticks: "none",
    wireless: false,
    home: false,
  },
  prism: {
    body: "#c4c1ba",
    trim: "#a9a69f",
    keys: "#6f6c66",
    face: ["#8d8a83", "#8d8a83", "#8d8a83", COLOUR.amber],
    sticks: "none",
    wireless: false,
    home: false,
  },
  basalt: {
    body: "#1c1c20",
    trim: "#2e2e34",
    keys: "#0c0c0e",
    face: ["#3d3d45", "#3d3d45", "#3d3d45", COLOUR.amber],
    sticks: "low",
    wireless: false,
    home: false,
  },
  comet: {
    body: "#1a1f31",
    trim: "#3a4262",
    keys: "#0b0d15",
    face: ["#3a4262", "#3a4262", "#3a4262", COLOUR.amber],
    sticks: "offset",
    wireless: true,
    home: true,
  },
  facet: {
    body: "#25262b",
    trim: "#3a3c43",
    keys: "#0f1012",
    face: ["#3f4148", "#3f4148", "#3f4148", COLOUR.amber],
    sticks: "low",
    wireless: true,
    home: true,
  },
  spire: {
    body: "#33363d",
    trim: "#1f2125",
    keys: "#16171a",
    face: ["#4a4e57", "#4a4e57", "#4a4e57", COLOUR.amber],
    sticks: "low",
    wireless: true,
    home: true,
  },
};

/** A d-pad: a plus of two bars. */
const Cross: React.FC<{ x: number; y: number; s: number; fill: string }> = ({
  x,
  y,
  s,
  fill,
}) => (
  <g fill={fill}>
    <rect x={x - s / 2} y={y - s / 6} width={s} height={s / 3} rx={3} />
    <rect x={x - s / 6} y={y - s / 2} width={s / 3} height={s} rx={3} />
  </g>
);

const Stick: React.FC<{ x: number; y: number; p: PadLook }> = ({ x, y, p }) => (
  <g>
    <circle
      cx={x}
      cy={y}
      r={22}
      fill={p.keys}
      stroke={p.trim}
      strokeWidth={4}
    />
    <circle cx={x} cy={y} r={13} fill={p.trim} />
  </g>
);

/** A pad of the console's generation, centred on (0, 0) and about 300 px wide. */
const Pad: React.FC<{ gen: ConsoleGen; on: number }> = ({ gen, on }) => {
  const p = PADS[gen];
  if (gen === "tempo")
    return (
      <g>
        <rect
          x={-115}
          y={-48}
          width={230}
          height={96}
          rx={12}
          fill={p.body}
          stroke="#3a3940"
          strokeWidth={2}
        />
        <rect x={-104} y={-22} width={208} height={60} rx={6} fill={p.trim} />
        <Cross x={-66} y={8} s={46} fill={p.keys} />
        {[0, 1].map((k) => (
          <rect
            key={k}
            x={-28 + k * 30}
            y={10}
            width={22}
            height={8}
            rx={4}
            fill="#3b3a40"
          />
        ))}
        <circle cx={52} cy={16} r={13} fill={p.face[0]} />
        <circle cx={84} cy={2} r={13} fill={p.face[1]} />
      </g>
    );
  const dpad: [number, number] = p.sticks === "offset" ? [-46, 26] : [-88, -14];
  const faces: Array<[number, number]> = [
    [0, -20],
    [20, 0],
    [0, 20],
    [-20, 0],
  ];
  return (
    <g>
      <path d={GRIP} fill={p.body} stroke={p.trim} strokeWidth={3} />
      <path d={GRIP} fill="url(#pcon-pad-gloss)" />
      <Cross x={dpad[0]} y={dpad[1]} s={44} fill={p.keys} />
      {faces.map(([dx, dy], i) => (
        <circle
          key={i}
          cx={88 + dx}
          cy={-14 + dy}
          r={9}
          fill={p.face[i] ?? p.keys}
        />
      ))}
      {p.sticks === "low" && (
        <>
          <Stick x={-46} y={26} p={p} />
          <Stick x={46} y={26} p={p} />
        </>
      )}
      {p.sticks === "offset" && (
        <>
          <Stick x={-88} y={-14} p={p} />
          <Stick x={46} y={26} p={p} />
        </>
      )}
      {p.home && (
        <g transform="translate(-12 -46)">
          <PulseMark size={24} colour={on > 0.5 ? COLOUR.amber : "#6b6f7a"} />
        </g>
      )}
      {gen === "facet" && (
        <rect
          x={-24}
          y={-66}
          width={48}
          height={5}
          rx={2}
          fill={COLOUR.amber}
          opacity={on}
        />
      )}
    </g>
  );
};

// What a hardware spec row looks like: a part of the machine, or a figure in a hardware unit.
const HW_LABEL =
  /\b(cpu|gpu|ram|vram|memory|processor|chip|chipset|clock|storage|hard ?drive|hdd|ssd|disc|disk|drive|media|cartridge|resolution|output|frame ?rate|fps|polygons?|colou?rs|palette|sound|audio|channels|controllers?|ports?|cores?|teraflops|tflops|bandwidth|graphics|video|optical|wi-?fi|bluetooth|usb|hdmi|bits?)\b/i;
const HW_UNIT =
  /\d\s*-?\s*(kb|mb|gb|tb|kib|mib|gib|khz|mhz|ghz|bit|bits|tflops|teraflops|fps|hz|nm|watts?|cores?)\b|\b\d{3,4}p\b|\b[48]k\b/i;
// A heading that names a machine lets one hardware row carry a card of release dates and prices.
const HW_HEADING =
  /\b(consoles?|hardware|specs?|specifications|under the hood|chips?|processors?|playstation|ps[1-5]|psp|xbox|nintendo|switch|wii|gamecube|n64|dreamcast|saturn|mega drive|genesis|snes|nes|game boy|atari|sega|handheld)\b/i;
// Rows about a game or a studio rather than a machine: a console must not stand in for them.
const GAME_LABEL =
  /\b(install|download|file size|patch|update|map|world|budget|team|staff|developers?|employees|sales|sold|copies|players|engine|script|pages|missions?|characters?|actors?|lines|cost)\b/i;

/** Whether a spec row is about hardware: a part of a machine, or a figure in MB, MHz, bits or similar. */
export const isHardwareRow = (r: { a: string; b: string }) =>
  HW_LABEL.test(r.a) || HW_UNIT.test(r.b);

/**
 * 2-6 short "label: value" rows about a machine: at least half are hardware rows, or the heading names a
 * console and one row is. A row about a game or a studio (map, budget, team, install size) rules it out.
 */
export const fitsPulseConsole = (g: MomentGraphic) => {
  const rows = specRows(g.items);
  if (!rows || rows.length < 2 || rows.length > 6) return false;
  const heading = txt(g.primary);
  if (heading.length > 40) return false;
  if (!rows.every((r) => r.a.length <= 24 && r.b.length <= 18)) return false;
  if (rows.some((r) => GAME_LABEL.test(r.a))) return false;
  const hw = rows.filter(isHardwareRow).length;
  return hw * 2 >= rows.length || (hw >= 1 && HW_HEADING.test(heading));
};

export const PulseConsole: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
  src,
}) => {
  const { frame, showFor, dim, visible } = useStage(len, 210);
  const rows = (specRows(g.items) ?? []).slice(0, 6);
  if (!visible || rows.length < 2) return null;
  const y = Math.max(1980, storyYear(g, year) ?? 2020);
  const { gen, name } = consoleOf(y);
  const pace = paceFor(showFor);
  const heading = txt(g.primary).toUpperCase();

  // The console slides in turned away and squares up to camera by frame 30.
  const enter = easeOut(interpolate(frame, [0, 30], [0, 1], clamp));
  const padIn = easeOut(interpolate(frame, [12, 34], [0, 1], clamp));
  const act = easeInOut(interpolate(frame, ACT, [0, 1], clamp));
  let on = interpolate(frame, [POWER, POWER + 6], [0, 1], clamp);
  // Older lamps catch with a flicker.
  if (
    (gen === "tempo" || gen === "prism") &&
    frame >= POWER + 2 &&
    frame < POWER + 4
  )
    on = 0.15;
  const rig = RIGS[gen]({ frame, act, on, src, year: y, name });
  const look = PADS[gen];

  // The stage: the rig grows by its generation's scale round (CX, FLOOR) and drops to the stage floor.
  const sc = SCALE[gen];
  const SF = FLOOR + DY;
  const onStage = ([x, y]: [number, number]): [number, number] => [
    CX + (x - CX) * sc,
    SF + (y - FLOOR) * sc,
  ];
  const stageW = rig.w * sc;

  // The pad stands on the floor in front of the console's left end, clear of the callouts.
  const px = Math.max(260, CX - stageW / 2 + 150);
  const py = SF + 78;
  const ROT = -12;
  const S = 1.15;
  const padDx = (1 - padIn) * -280;
  const padDy = (1 - padIn) * 70;
  const rad = (ROT * Math.PI) / 180;
  const topY = (gen === "tempo" ? -48 : -62) * S;
  const padTop: [number, number] = [
    px - topY * Math.sin(rad),
    py + topY * Math.cos(rad),
  ];
  // The cord runs from the port once the pad has landed.
  const cord = interpolate(frame, [34, 50], [0, 1], {
    ...clamp,
    easing: easeOut,
  });

  // The rows run down the right, centred on the console, below the heading (which ends by about y 200).
  const n = rows.length;
  const gap = Math.min(160, 560 / (n - 1));
  const rowY = (i: number) => 600 + (i - (n - 1) / 2) * gap;
  const spots = rig.spots.map(onStage).sort((a, b) => a[1] - b[1]);
  const spotFor = (i: number) =>
    spots[Math.round((i * (spots.length - 1)) / (n - 1))]!;
  const valueSize = n <= 3 ? 62 : n <= 4 ? 56 : 48;
  const headSize = sizeByLength(heading.length, [
    [18, 84],
    [28, 70],
    [999, 58],
  ]);
  const headIn = easeOut(interpolate(frame, [8, 26], [0, 1], clamp));

  const callouts = rows.map((r, i) => {
    const start = 52 + i * 9 * pace;
    return {
      ...r,
      y: rowY(i),
      spot: spotFor(i),
      line: interpolate(frame, [start, start + 12], [0, 1], {
        ...clamp,
        easing: easeOut,
      }),
      text: interpolate(frame, [start + 8, start + 18], [0, 1], {
        ...clamp,
        easing: easeOut,
      }),
    };
  });

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={12}>
      <Preload src={src} />
      <svg
        width={1920}
        height={1080}
        viewBox="0 0 1920 1080"
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <filter id="pcon-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation={6} />
          </filter>
          <filter id="pcon-soft" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation={14} />
          </filter>
          {/* Rim light: the silhouette grown a few px, lit warm and nudged upward, drawn under the body. */}
          <filter id="pcon-rim" x="-10%" y="-10%" width="120%" height="120%">
            <feMorphology
              in="SourceAlpha"
              operator="dilate"
              radius={3}
              result="d"
            />
            <feOffset in="d" dy={-3} result="o" />
            <feFlood floodColor="#ffe2bf" floodOpacity={0.9} />
            <feComposite in2="o" operator="in" result="rim" />
            <feGaussianBlur in="rim" stdDeviation={1.4} />
          </filter>
          {/* A wide soft halo behind the silhouette, so a dark body stands off the backdrop. */}
          <filter id="pcon-halo" x="-20%" y="-20%" width="140%" height="140%">
            <feMorphology
              in="SourceAlpha"
              operator="dilate"
              radius={6}
              result="d"
            />
            <feFlood floodColor="#ffd1a0" floodOpacity={0.55} />
            <feComposite in2="d" operator="in" result="h" />
            <feGaussianBlur in="h" stdDeviation={22} />
          </filter>
          <radialGradient id="pcon-room" cx={CX / 1920} cy={0.48} r={0.62}>
            <stop offset="0" stopColor="#3b3c44" />
            <stop offset="0.55" stopColor="#24252b" />
            <stop offset="1" stopColor="#15161a" />
          </radialGradient>
          <linearGradient id="pcon-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#45434a" />
            <stop offset="0.5" stopColor="#2b2a30" />
            <stop offset="1" stopColor="#1a1a1e" />
          </linearGradient>
          <radialGradient id="pcon-pool">
            <stop offset="0" stopColor="#ffb878" stopOpacity={0.42} />
            <stop offset="0.6" stopColor="#ffb878" stopOpacity={0.12} />
            <stop offset="1" stopColor="#ffb878" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="pcon-spot">
            <stop offset="0" stopColor={COLOUR.amber} stopOpacity={0.2} />
            <stop offset="0.55" stopColor={COLOUR.amber} stopOpacity={0.06} />
            <stop offset="1" stopColor={COLOUR.amber} stopOpacity={0} />
          </radialGradient>
          <linearGradient id="pcon-plinth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#24242a" />
            <stop offset="1" stopColor="#141418" />
          </linearGradient>
          <linearGradient id="pcon-tempo-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#29282d" />
            <stop offset="1" stopColor="#3d3c42" />
          </linearGradient>
          <linearGradient id="pcon-wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7a4c26" />
            <stop offset="0.5" stopColor="#95612f" />
            <stop offset="1" stopColor="#663f1e" />
          </linearGradient>
          <linearGradient id="pcon-prism-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9d6cf" />
            <stop offset="1" stopColor="#c5c2bb" />
          </linearGradient>
          <radialGradient id="pcon-prism-lid" cx="0.45" cy="0.35">
            <stop offset="0" stopColor="#e2dfd8" />
            <stop offset="1" stopColor="#c7c4bd" />
          </radialGradient>
          <radialGradient id="pcon-disc">
            <stop offset="0" stopColor="#f2f4f7" />
            <stop offset="0.5" stopColor="#b8bfca" />
            <stop offset="0.75" stopColor="#e9ecf1" />
            <stop offset="1" stopColor="#a9b0bb" />
          </radialGradient>
          <linearGradient id="pcon-basalt-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b1b1f" />
            <stop offset="1" stopColor="#28282e" />
          </linearGradient>
          <linearGradient id="pcon-comet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3d4466" />
            <stop offset="0.45" stopColor="#1b2033" />
            <stop offset="1" stopColor="#0b0d15" />
          </linearGradient>
          <linearGradient id="pcon-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity={0} />
            <stop offset="0.5" stopColor="#fff" stopOpacity={0.3} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="pcon-silver" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#7d8393" />
            <stop offset="0.5" stopColor="#e2e5ec" />
            <stop offset="1" stopColor="#7d8393" />
          </linearGradient>
          <linearGradient id="pcon-facet-rear" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1d1e22" />
            <stop offset="1" stopColor="#2a2b30" />
          </linearGradient>
          <linearGradient id="pcon-spire" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#24262b" />
            <stop offset="0.45" stopColor="#3a3d44" />
            <stop offset="0.8" stopColor="#2b2d33" />
            <stop offset="1" stopColor="#1f2125" />
          </linearGradient>
          <linearGradient id="pcon-pad-gloss" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity={0.16} />
            <stop offset="0.5" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* The room: a dark grey backdrop lit from the console, a warm floor and a spotlight pool on it. */}
        <rect
          width={1920}
          height={1080}
          fill="url(#pcon-room)"
          opacity={0.96}
        />
        <rect
          x={0}
          y={SF - 6}
          width={1920}
          height={1080 - SF + 6}
          fill="url(#pcon-floor)"
        />
        <line
          x1={0}
          x2={1920}
          y1={SF - 6}
          y2={SF - 6}
          stroke="#5a585f"
          strokeWidth={2}
        />
        <g opacity={enter}>
          <circle cx={CX} cy={SF - 240} r={760} fill="url(#pcon-spot)" />
          <ellipse
            cx={CX}
            cy={SF + 30}
            rx={820}
            ry={150}
            fill="url(#pcon-pool)"
          />
          {/* The turntable. */}
          <ellipse
            cx={CX}
            cy={SF + 12}
            rx={Math.max(stageW / 2 + 120, 360)}
            ry={48}
            fill="url(#pcon-plinth)"
            stroke={COLOUR.amber}
            strokeOpacity={0.45}
            strokeWidth={2.5}
          />
          <ellipse
            cx={CX}
            cy={SF + 4}
            rx={stageW / 2 + 40}
            ry={22}
            fill="#000"
            opacity={0.55}
            filter="url(#pcon-soft)"
          />
        </g>

        {/* The console: its halo and rim light first, then the body over them. */}
        <g
          opacity={enter}
          transform={`translate(${(1 - enter) * -460} ${DY}) translate(${CX} ${FLOOR}) skewY(${(1 - enter) * -6}) scale(${sc * (0.7 + 0.3 * enter)} ${sc}) translate(${-CX} ${-FLOOR})`}
        >
          <g filter="url(#pcon-halo)">{rig.body}</g>
          <g filter="url(#pcon-rim)">{rig.body}</g>
          {rig.body}
        </g>

        {rig.port && !look.wireless && cord > 0 && (
          <path
            d={`M${onStage(rig.port)[0]} ${onStage(rig.port)[1]} C${onStage(rig.port)[0]} ${SF + 50} ${padTop[0] + 40} ${padTop[1] - 70} ${padTop[0]} ${padTop[1]}`}
            fill="none"
            stroke={gen === "prism" ? "#8f8c85" : "#0d0d10"}
            strokeWidth={5}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - cord}
          />
        )}

        <g
          opacity={padIn}
          transform={`translate(${px + padDx} ${py + padDy}) rotate(${ROT}) scale(${S})`}
        >
          <ellipse
            cx={6}
            cy={70}
            rx={150}
            ry={20}
            fill="#000"
            opacity={0.45}
            filter="url(#pcon-soft)"
          />
          <Pad gen={gen} on={on} />
          {/* A wireless pad pairs with the console as it powers on. */}
          {look.wireless &&
            [0, 1, 2].map((k) => {
              const r = 16 + k * 12;
              const o = interpolate(
                frame,
                [POWER + 4 + k * 5, POWER + 10 + k * 5, POWER + 30 + k * 5],
                [0, 1, 0],
                clamp,
              );
              return o > 0 ? (
                <path
                  key={k}
                  d={`M120 ${-70 - r} A${r} ${r} 0 0 1 ${120 + r} -70`}
                  fill="none"
                  stroke={COLOUR.amber}
                  strokeWidth={5}
                  strokeLinecap="round"
                  opacity={o}
                />
              ) : null;
            })}
        </g>

        {/* Leader lines from the body to each row. */}
        {callouts.map((c, i) =>
          c.line > 0 ? (
            <g key={i}>
              <path
                d={`M${c.spot[0]} ${c.spot[1]} L${COL_X - 46} ${c.y} H${COL_X}`}
                fill="none"
                stroke="rgba(255,255,255,0.6)"
                strokeWidth={2.5}
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - c.line}
              />
              <circle
                cx={c.spot[0]}
                cy={c.spot[1]}
                r={12}
                fill="none"
                stroke={COLOUR.amber}
                strokeOpacity={0.55}
                strokeWidth={2}
              />
              <circle cx={c.spot[0]} cy={c.spot[1]} r={6} fill={COLOUR.amber} />
              {c.line >= 1 && (
                <circle cx={COL_X} cy={c.y} r={8} fill={COLOUR.amber} />
              )}
            </g>
          ) : null,
        )}
      </svg>

      {heading && (
        <div
          style={{
            position: "absolute",
            left: 120,
            right: 120,
            top: 84,
            textAlign: "center",
            opacity: headIn,
            transform: `translateY(${(1 - headIn) * -30}px)`,
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: headSize,
              lineHeight: 1,
              color: COLOUR.paper,
              textShadow: "0 6px 30px rgba(0,0,0,0.6)",
            }}
          >
            {heading}
          </div>
          <div
            style={{
              margin: "18px auto 0",
              width: 140 * headIn,
              height: 6,
              borderRadius: 3,
              background: COLOUR.amber,
            }}
          />
        </div>
      )}

      {callouts.map((c, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: COL_X + 28,
            right: 70,
            top: c.y,
            transform: `translate(${(1 - c.text) * -24}px, -50%)`,
            clipPath: `inset(0 ${(1 - c.text) * 100}% 0 0)`,
            opacity: c.text > 0 ? 1 : 0,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: 28,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: COLOUR.muted,
              lineHeight: 1.2,
            }}
          >
            {c.a}
          </div>
          <div
            style={{
              marginTop: 4,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: valueSize,
              lineHeight: 1.05,
              color: COLOUR.paper,
              whiteSpace: "nowrap",
            }}
          >
            {c.b}
          </div>
        </div>
      ))}

      <div
        style={{
          position: "absolute",
          right: 60,
          bottom: 48,
          color: "rgba(255,255,255,0.7)",
          fontFamily: BODY,
          fontSize: 20,
          letterSpacing: 3,
          opacity: interpolate(frame, [20, 30], [0, 1], clamp),
        }}
      >
        ILLUSTRATION
      </div>
    </Stage>
  );
};
