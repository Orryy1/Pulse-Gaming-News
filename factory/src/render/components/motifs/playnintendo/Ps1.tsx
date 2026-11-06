// PlayStation (1994-2001) homage: a memory card manager. Two cards of save blocks on a grey-blue screen,
// the pictures as tiny pixel icons, one block highlighted and opening into the heading. The style fills
// a card's blocks with a list, one save at a time. Built from scratch: layout, colour and motion only.
import React, { useMemo } from "react";
import { AbsoluteFill, Img, interpolate, spring } from "remotion";
import { BODY } from "../../fonts.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import { PulseBadge } from "../../packs/pulse/PulseBadge.tsx";
import {
  clamp,
  clean,
  fit,
  lerp,
  lineClamp,
  longestWord,
  metaLine,
  seeded,
  useCard,
} from "./shared.tsx";

const SPRING_IN = { damping: 18, stiffness: 170, mass: 0.6 };
const SCREEN =
  "radial-gradient(120% 95% at 28% 8%, #6f7c9a 0%, #46526e 38%, #262e42 78%, #1a2030 100%)";
const SCAN =
  "repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 2px, transparent 2px, transparent 4px)";
const INK = "#eef2fa";
const SOFT = "#b4c2e2";
const HILITE = "#ffffff";

/** A raised, bevelled plate: light along the top and left, dark along the bottom and right. */
const bevel = (radius = 8): React.CSSProperties => ({
  borderTop: "3px solid #b3bdd4",
  borderLeft: "3px solid #8e9ab5",
  borderRight: "3px solid #151a26",
  borderBottom: "3px solid #0e121b",
  borderRadius: radius,
});

// ---------------------------------------------------------------------------------------------------
// Icons: a picture sampled down to chunky pixels, or a seeded 8 x 8 sprite when there is no picture.

/** The pixelate filter: one sample per block, grown back to fill the block. Cheap on small elements. */
const PixelFilter: React.FC<{ id: string; block: number }> = ({
  id,
  block,
}) => {
  const h = block / 2;
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
      <defs>
        <filter id={id} x="0" y="0" colorInterpolationFilters="sRGB">
          <feFlood x={h - 1} y={h - 1} width={2} height={2} />
          <feComposite width={block} height={block} />
          <feTile result="grid" />
          <feComposite in="SourceGraphic" in2="grid" operator="in" />
          <feMorphology operator="dilate" radius={h} />
        </filter>
      </defs>
    </svg>
  );
};

const PixelPic: React.FC<{
  src: string;
  size: number;
  filter: string;
  pos?: string;
}> = ({ src, size, filter, pos }) => (
  <div
    style={{
      width: size,
      height: size,
      overflow: "hidden",
      filter: `url(#${filter}) saturate(1.35) contrast(1.12)`,
    }}
  >
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: pos ?? "50% 50%",
      }}
    />
  </div>
);

const PALETTES: Array<[string, string]> = [
  ["#f2c94c", "#d9534f"],
  ["#7fd6f7", "#2f6fd0"],
  ["#a6e070", "#3e9b45"],
  ["#f5a3dc", "#9b59d0"],
  ["#f7ab62", "#c4572a"],
  ["#e3e9f4", "#7f8daa"],
];

function spriteOf(seed: number) {
  const r = seeded(seed * 97 + 13);
  const pal = PALETTES[Math.floor(r() * PALETTES.length)]!;
  const a: string[] = [];
  const b: string[] = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 4; x++) {
      const p = y === 0 || y === 7 ? 0.28 : x === 0 ? 0.42 : 0.66;
      if (r() < p) {
        const into = r() < 0.3 ? b : a;
        into.push(`M${x} ${y}h1v1h-1z`, `M${7 - x} ${y}h1v1h-1z`);
      }
    }
  return { pal, a: a.join(""), b: b.join("") };
}

/** A seeded save icon that bobs a pixel every ten frames, the way old save icons animated. */
const Sprite: React.FC<{ seed: number; size: number; frame: number }> = ({
  seed,
  size,
  frame,
}) => {
  const s = useMemo(() => spriteOf(seed), [seed]);
  const bob = Math.floor((frame + seed * 7) / 10) % 2 ? -0.5 : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1 -1 10 10"
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      <g transform={`translate(0 ${bob})`}>
        <path d={s.a} fill={s.pal[0]} />
        <path d={s.b} fill={s.pal[1]} />
      </g>
    </svg>
  );
};

type Icon = { pic?: string; pos?: string; seed?: number };

const IconView: React.FC<{
  icon: Icon;
  size: number;
  filter: string;
  frame: number;
}> = ({ icon, size, filter, frame }) =>
  icon.pic ? (
    <PixelPic src={icon.pic} size={size} filter={filter} pos={icon.pos} />
  ) : icon.seed !== undefined ? (
    <Sprite seed={icon.seed} size={size} frame={frame} />
  ) : null;

// ---------------------------------------------------------------------------------------------------
// The card: two memory cards of fifteen blocks, one block opening into the heading.

const PANEL = { w: 720, h: 464, top: 214, pad: 48, cell: 112, gap: 16 };
const PANEL_X = [170, 1030];
const SELECTED = 6; // card 1, second row, second column
const PIC_SLOTS = [SELECTED, 17, 2, 23, 11, 28];

function blockRect(slot: number) {
  const card = slot < 15 ? 0 : 1;
  const i = slot % 15;
  const col = i % 5;
  const row = Math.floor(i / 5);
  return {
    x: PANEL_X[card]! + PANEL.pad + col * (PANEL.cell + PANEL.gap),
    y: PANEL.top + PANEL.pad + row * (PANEL.cell + PANEL.gap),
  };
}

const MemoryCardCard: React.FC<MotifCardProps> = (props) => {
  const { frame, fps, fade } = useCard(props.frames);
  const variant = props.variant ?? 0;
  const pics = props.pictures.filter(Boolean).slice(0, 6);
  const heading = clean(props.heading);
  const kicker = clean(props.kicker);
  const meta = metaLine(props);
  const small = `ps1s${Math.abs(variant)}`;
  const big = `ps1b${Math.abs(variant)}`;

  // Which block holds what: pictures in fixed spots, a few seeded sprites, the rest empty.
  const icons = useMemo(() => {
    const out: Icon[] = Array.from({ length: 30 }, () => ({}));
    const r = seeded(variant * 31 + 5);
    pics.forEach((p, k) => {
      out[PIC_SLOTS[k]!] = {
        pic: p,
        pos: `${30 + Math.floor(r() * 40)}% ${30 + Math.floor(r() * 40)}%`,
      };
    });
    if (!pics.length) out[SELECTED] = { seed: variant * 11 + 1 };
    const free = out
      .map((x, i) => (x.pic || x.seed !== undefined ? -1 : i))
      .filter((i) => i >= 0);
    const want = Math.max(4, 9 - pics.length);
    for (let k = 0; k < want && free.length; k++) {
      const at = free.splice(Math.floor(r() * free.length), 1)[0]!;
      out[at] = { seed: variant * 11 + 3 + k * 5 };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, pics.join("|")]);

  const sel = blockRect(SELECTED);
  const blink =
    frame < 8
      ? 0
      : frame < 19
        ? Math.floor((frame - 8) / 3) % 2
          ? 0.35
          : 1
        : 1;
  const open = spring({
    frame: frame - 18,
    fps,
    config: { damping: 17, stiffness: 120, mass: 0.8 },
  });
  const D = { x: 250, y: 250, w: 1420, h: 580 };
  const box = {
    x: lerp(sel.x - 6, D.x, open),
    y: lerp(sel.y - 6, D.y, open),
    w: lerp(PANEL.cell + 12, D.w, open),
    h: lerp(PANEL.cell + 12, D.h, open),
  };
  const ICON = 384;
  const iconAt = {
    x: lerp(sel.x + 8, D.x + 76, open) - box.x,
    y: lerp(sel.y + 8, D.y + (D.h - ICON) / 2, open) - box.y,
    s: lerp(96, ICON, open),
  };
  const textIn = interpolate(frame, [25, 35], [0, 1], clamp);
  const metaIn = interpolate(frame, [30, 40], [0, 1], clamp);
  const panelsDim = interpolate(open, [0, 1], [1, 0.3], clamp);
  const textW = D.w - 76 - ICON - 64 - 76;
  const hSize = fit(heading, textW, 3, [86, 76, 66, 58, 50], 0.6);
  const selIcon = icons[SELECTED]!;

  return (
    <AbsoluteFill
      style={{ background: SCREEN, opacity: fade, overflow: "hidden" }}
    >
      <PixelFilter id={small} block={6} />
      <PixelFilter id={big} block={24} />
      {/* A slow sheen across the screen. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(115deg, transparent ${frame * 0.5 - 30}%, rgba(255,255,255,0.05) ${frame * 0.5 - 10}%, transparent ${frame * 0.5 + 10}%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 170,
          top: 106,
          display: "flex",
          alignItems: "center",
          gap: 22,
          opacity: interpolate(frame, [0, 8], [0, 1], clamp) * panelsDim,
        }}
      >
        <div
          style={{
            width: 46,
            height: 58,
            ...bevel(6),
            background: "linear-gradient(180deg, #8d99b6, #56627f)",
          }}
        />
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 34,
            letterSpacing: 9,
            color: INK,
            textShadow: "0 3px 0 rgba(0,0,0,0.35)",
          }}
        >
          MEMORY CARD
        </div>
      </div>
      {/* The Pulse badge in the top corner, where the console's own name would sit. */}
      <PulseBadge
        size={46}
        colour={INK}
        opacity={interpolate(frame, [0, 8], [0, 1], clamp) * panelsDim}
        style={{
          position: "absolute",
          right: 170,
          top: 112,
          filter: "drop-shadow(0 3px 0 rgba(0,0,0,0.35))",
        }}
      />
      {/* The save's name field under the cards, filled as the highlight lands. */}
      <div
        style={{
          position: "absolute",
          left: 170,
          top: 730,
          width: 1580,
          height: 100,
          borderRadius: 10,
          background: "rgba(6,9,16,0.62)",
          boxShadow:
            "inset 0 4px 10px rgba(0,0,0,0.6), inset 0 -2px 0 rgba(255,255,255,0.08)",
          opacity: interpolate(frame, [2, 10], [0, 1], clamp) * panelsDim,
          display: "flex",
          alignItems: "center",
          gap: 26,
          padding: "0 30px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            flex: "none",
            opacity: frame >= 10 ? 1 : 0,
            overflow: "hidden",
            borderRadius: 4,
          }}
        >
          <div style={{ transform: "scale(0.6667)", transformOrigin: "0 0" }}>
            <IconView
              icon={icons[SELECTED]!}
              size={96}
              filter={small}
              frame={frame}
            />
          </div>
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 40,
            color: INK,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textShadow: "0 3px 0 rgba(0,0,0,0.4)",
            clipPath: `inset(0 ${100 - interpolate(frame, [10, 18], [0, 100], clamp)}% 0 0)`,
          }}
        >
          {clean(props.game) || kicker || heading}
        </div>
      </div>
      {[0, 1].map((card) => {
        const enter = spring({
          frame: frame - card * 3,
          fps,
          config: { damping: 18, stiffness: 170, mass: 0.6 },
        });
        return (
          <div
            key={card}
            style={{
              position: "absolute",
              left: PANEL_X[card],
              top: PANEL.top,
              width: PANEL.w,
              height: PANEL.h,
              ...bevel(10),
              background:
                "linear-gradient(180deg, rgba(30,38,58,0.82), rgba(14,18,30,0.9))",
              boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
              opacity: enter * panelsDim,
              transform: `translateY(${(1 - enter) * 40}px) scale(${lerp(1, 0.97, open)})`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 18,
                top: -24,
                height: 40,
                minWidth: 40,
                padding: "0 12px",
                borderRadius: 20,
                background: "linear-gradient(180deg, #c3cce0, #8e9ab5)",
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 26,
                lineHeight: "40px",
                textAlign: "center",
                color: "#1d2433",
              }}
            >
              {card + 1}
            </div>
          </div>
        );
      })}
      {icons.map((icon, slot) => {
        const { x, y } = blockRect(slot);
        const filled = Boolean(icon.pic || icon.seed !== undefined);
        const at = 3 + (slot % 15) * 0.55 + (slot >= 15 ? 3 : 0);
        const s = spring({
          frame: frame - at,
          fps,
          config: { damping: 15, stiffness: 260, mass: 0.5 },
        });
        return (
          <div
            key={slot}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: PANEL.cell,
              height: PANEL.cell,
              opacity: Math.min(1, s * 1.3) * panelsDim,
              transform: `scale(${0.7 + 0.3 * s})`,
              ...(filled
                ? {
                    ...bevel(7),
                    background: "linear-gradient(160deg, #56668a, #2b344b)",
                  }
                : {
                    borderRadius: 7,
                    background: "rgba(6,9,16,0.72)",
                    boxShadow:
                      "inset 0 4px 8px rgba(0,0,0,0.65), inset 0 -1px 0 rgba(255,255,255,0.06)",
                  }),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {filled ? (
              <IconView
                icon={icon}
                size={icon.pic ? 96 : 84}
                filter={small}
                frame={frame}
              />
            ) : null}
          </div>
        );
      })}
      {/* The selected block: highlighted, then opening into the heading. */}
      <div
        style={{
          position: "absolute",
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          ...bevel(lerp(8, 14, open)),
          background: `linear-gradient(170deg, rgba(92,108,142,${0.55 + 0.4 * open}), rgba(36,44,64,${0.6 + 0.38 * open}))`,
          boxShadow: `0 0 0 ${lerp(5, 3, open)}px rgba(255,255,255,${blink * lerp(1, 0.5, open)}), 0 0 ${lerp(26, 60, open)}px rgba(150,190,255,${0.75 * blink}), 0 40px 120px rgba(0,0,0,${0.55 * open})`,
          opacity: frame < 8 ? 0 : 1,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: iconAt.x,
            top: iconAt.y,
            width: iconAt.s,
            height: iconAt.s,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 1 - interpolate(open, [0.15, 0.5], [0, 1], clamp),
              transform: `scale(${iconAt.s / 96})`,
              transformOrigin: "0 0",
            }}
          >
            <IconView icon={selIcon} size={96} filter={small} frame={frame} />
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: interpolate(open, [0.15, 0.5], [0, 1], clamp),
              transform: `scale(${iconAt.s / ICON})`,
              transformOrigin: "0 0",
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: "0 0 0 4px rgba(10,14,24,0.6)",
            }}
          >
            <IconView icon={selIcon} size={ICON} filter={big} frame={frame} />
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: D.w - 76 - textW,
            top: 0,
            width: textW,
            height: D.h,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            opacity: open > 0.5 ? 1 : 0,
          }}
        >
          {kicker ? (
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 28,
                letterSpacing: 6,
                color: SOFT,
                textTransform: "uppercase",
                opacity: textIn,
                transform: `translateX(${(1 - textIn) * 24}px)`,
                marginBottom: 14,
              }}
            >
              {kicker}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: hSize,
              lineHeight: 1.08,
              color: INK,
              textShadow: "0 4px 0 rgba(0,0,0,0.35)",
              opacity: textIn,
              transform: `translateX(${(1 - textIn) * 36}px)`,
              ...lineClamp(3),
            }}
          >
            {heading}
          </div>
          {meta ? (
            <div style={{ opacity: metaIn }}>
              <div
                style={{
                  marginTop: 26,
                  height: 4,
                  width: 120 * metaIn,
                  background: HILITE,
                  opacity: 0.6,
                  borderRadius: 2,
                }}
              />
              <div
                style={{
                  marginTop: 18,
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 32,
                  color: SOFT,
                  ...lineClamp(1),
                }}
              >
                {meta}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <AbsoluteFill style={{ background: SCAN, opacity: 0.45 }} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// The style: a list saved block by block, the highlight riding down to each new save.

function listItems(g: MomentGraphic): string[] {
  return g.items.map(clean).filter(Boolean);
}

export function fitsSaves(g: MomentGraphic): boolean {
  const items = listItems(g);
  return (
    items.length >= 2 &&
    items.length <= 5 &&
    items.length === g.items.length &&
    items.every((x) => x.length <= 36 && longestWord(x) <= 20) &&
    clean(g.primary).length <= 40
  );
}

const Saves: React.FC<GfxProps> = ({ g, len, src, variant = 0 }) => {
  const { frame, fps, dim, visible } = useStage(len, 210);
  const items = listItems(g).slice(0, 5);
  if (!visible || items.length < 2) return null;
  const heading = clean(g.primary);
  const n = items.length;
  const ROW = 112;
  const GAP = 20;
  const PAD = 34;
  const panelH = n * ROW + (n - 1) * GAP + PAD * 2;
  const top = Math.round(250 + (740 - panelH) / 2);
  const X = 120;
  const W = 1150;
  const small = `ps1l${Math.abs(variant)}`;
  const start = (i: number) => 12 + i * 14;
  const posOf = (i: number) => top + PAD + i * (ROW + GAP);
  const at = Math.max(0, Math.min(n - 1, Math.floor((frame - 12) / 14)));
  const hop = spring({
    frame: frame - start(at),
    fps,
    config: { damping: 18, stiffness: 220, mass: 0.5 },
  });
  const hy = at === 0 ? posOf(0) : lerp(posOf(at - 1), posOf(at), hop);
  const r = seeded(variant * 17 + 3);
  const icons: Icon[] = items.map((_, i) =>
    src
      ? {
          pic: src,
          pos: `${15 + Math.floor(r() * 70)}% ${20 + Math.floor(r() * 60)}%`,
        }
      : { seed: variant * 7 + i * 3 + 1 },
  );
  const barW = W - PAD * 2 - ROW - 28;
  const textSize = Math.min(
    ...items.map((t) => fit(t, barW - 64, 1, [44, 40, 36], 0.6)),
  );
  // The card on the right: fifteen blocks, the saves landing in turn among a few older ones.
  const CARD = { x: 1340, cell: 96, gap: 14 };
  const cardW = 3 * CARD.cell + 2 * CARD.gap + 2 * 30;
  const cardH = 5 * CARD.cell + 4 * CARD.gap + 2 * 30;
  const cardTop = Math.round(250 + (740 - cardH) / 2);
  const order = [1, 4, 6, 9, 13];
  const older = [0, 7, 11].map((slot, k) => ({
    slot,
    seed: variant * 5 + k * 9 + 2,
  }));
  const cardIn = spring({ frame: frame - 4, fps, config: SPRING_IN });
  return (
    <AbsoluteFill style={{ opacity: dim, background: SCREEN }}>
      <PixelFilter id={small} block={6} />
      <div
        style={{
          position: "absolute",
          left: X,
          right: 120,
          top: 140,
          display: "flex",
          alignItems: "center",
          gap: 22,
        }}
      >
        <div
          style={{
            width: 40,
            height: 50,
            flex: "none",
            ...bevel(6),
            background: "linear-gradient(180deg, #8d99b6, #56627f)",
          }}
        />
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: heading.length > 26 ? 46 : 54,
            lineHeight: 1.05,
            color: INK,
            textShadow: "0 3px 0 rgba(0,0,0,0.35)",
            ...lineClamp(1),
          }}
        >
          {heading || "MEMORY CARD"}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: X,
          top,
          width: W,
          height: panelH,
          ...bevel(12),
          background:
            "linear-gradient(180deg, rgba(30,38,58,0.85), rgba(14,18,30,0.92))",
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        }}
      />
      {items.map((t, i) => {
        const s = spring({
          frame: frame - start(i),
          fps,
          config: { damping: 15, stiffness: 260, mass: 0.5 },
        });
        const bar = interpolate(
          frame,
          [start(i) + 2, start(i) + 11],
          [0, 1],
          clamp,
        );
        const word = interpolate(
          frame,
          [start(i) + 6, start(i) + 13],
          [0, 1],
          clamp,
        );
        const y = posOf(i);
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: X + PAD,
                top: y,
                width: ROW,
                height: ROW,
                ...(s > 0.02
                  ? {
                      ...bevel(7),
                      background: "linear-gradient(160deg, #56668a, #2b344b)",
                    }
                  : { borderRadius: 7, background: "rgba(6,9,16,0.72)" }),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <div style={{ opacity: s, transform: `scale(${0.5 + 0.5 * s})` }}>
                <IconView
                  icon={icons[i]!}
                  size={src ? 96 : 84}
                  filter={small}
                  frame={frame}
                />
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                left: X + PAD + ROW + 28,
                top: y + 8,
                width: barW,
                height: ROW - 16,
                borderRadius: 8,
                background: "rgba(6,9,16,0.6)",
                boxShadow: "inset 0 3px 6px rgba(0,0,0,0.55)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${bar * 100}%`,
                  background:
                    "linear-gradient(180deg, rgba(120,140,186,0.55), rgba(70,84,118,0.55))",
                  borderRight:
                    bar < 1 ? "4px solid rgba(255,255,255,0.8)" : "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 32,
                  right: 32,
                  top: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: textSize,
                  color: INK,
                  textShadow: "0 3px 0 rgba(0,0,0,0.4)",
                  opacity: word,
                  transform: `translateX(${(1 - word) * 20}px)`,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                {t}
              </div>
            </div>
          </React.Fragment>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: X + PAD - 7,
          top: hy - 7,
          width: ROW + 14,
          height: ROW + 14,
          borderRadius: 10,
          boxShadow: `0 0 0 5px ${HILITE}, 0 0 28px rgba(150,190,255,0.85)`,
          opacity: frame < start(0) ? 0 : Math.floor(frame / 4) % 2 ? 0.75 : 1,
        }}
      />
      {/* The memory card itself, filling block by block as each line saves. */}
      <div
        style={{
          position: "absolute",
          left: CARD.x,
          top: cardTop,
          width: cardW,
          height: cardH,
          ...bevel(12),
          background:
            "linear-gradient(180deg, rgba(30,38,58,0.85), rgba(14,18,30,0.92))",
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          opacity: cardIn,
          transform: `translateX(${(1 - cardIn) * 60}px)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -40,
            right: -40,
            top: -52,
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 24,
            letterSpacing: 6,
            color: SOFT,
          }}
        >
          MEMORY CARD
        </div>
        {/* The Pulse badge where a maker's name sits on a memory card. */}
        <PulseBadge
          size={30}
          colour={SOFT}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: -54,
            justifyContent: "center",
          }}
        />
        {Array.from({ length: 15 }, (_, slot) => {
          const k = order.indexOf(slot);
          const save = k >= 0 && k < n ? k : -1;
          const old = older.find((o) => o.slot === slot);
          const landed =
            save >= 0
              ? interpolate(
                  frame,
                  [start(save) + 8, start(save) + 14],
                  [0, 1],
                  clamp,
                )
              : 0;
          const filled = Boolean(old) || landed > 0;
          const lit = save >= 0 && save === at && landed > 0;
          return (
            <div
              key={slot}
              style={{
                position: "absolute",
                left: 30 + (slot % 3) * (CARD.cell + CARD.gap),
                top: 30 + Math.floor(slot / 3) * (CARD.cell + CARD.gap),
                width: CARD.cell,
                height: CARD.cell,
                ...(filled
                  ? {
                      ...bevel(6),
                      background: "linear-gradient(160deg, #56668a, #2b344b)",
                    }
                  : {
                      borderRadius: 6,
                      background: "rgba(6,9,16,0.72)",
                      boxShadow: "inset 0 3px 6px rgba(0,0,0,0.6)",
                    }),
                ...(lit
                  ? {
                      boxShadow: `0 0 0 4px ${HILITE}, 0 0 22px rgba(150,190,255,0.8)`,
                    }
                  : {}),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {old ? (
                <div style={{ opacity: 0.5 }}>
                  <Sprite seed={old.seed} size={70} frame={frame} />
                </div>
              ) : landed > 0 ? (
                <div
                  style={{
                    opacity: landed,
                    transform: `scale(${(0.6 + 0.4 * landed) * 0.833})`,
                  }}
                >
                  <IconView
                    icon={icons[save]!}
                    size={96}
                    filter={small}
                    frame={frame}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <AbsoluteFill style={{ background: SCAN, opacity: 0.4 }} />
    </AbsoluteFill>
  );
};
export const PS1_CARD = MemoryCardCard;
export const PS1_STYLES: Record<string, GfxStyle> = {
  /** list: primary a short heading, items 2-5 short lines (42 characters at most), saved block by block. */
  Saves: { kind: "list", component: Saves, fits: fitsSaves, sound: "glint" },
};
