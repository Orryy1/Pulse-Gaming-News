// The Xbox 360 launch era (2005-2008), in homage to its "blades" dashboard: tall glossy tabs stacked
// along the sides in silver and the console's green, one blade swinging open to a panel, a soft green
// glow behind. Built from scratch from layout, colour and motion; every word comes from props or a
// generic label.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  interpolateColors,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BODY } from "../../fonts.ts";
import { SPRING, ease } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { MotifCardProps } from "../types.ts";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import {
  cardFade,
  clamp,
  fitLabel,
  sizeFor,
  splitRow,
  txt,
  uniq,
} from "./util.ts";

type Tone = readonly [string, string, string];
const TONE = {
  silver: ["#fdfefe", "#e2e7e6", "#bcc4c3"],
  steel: ["#d6dcdb", "#aeb7b6", "#8a9493"],
  green: ["#bdf06a", "#79c62f", "#3f8b15"],
  slate: ["#6a7476", "#4b5456", "#30383a"],
} as const satisfies Record<string, Tone>;
const INK = "#22292c";
const LEAF = "#3f8b15";
const SWING = { damping: 16, stiffness: 120, mass: 0.8 } as const;

const gloss = (t: Tone) =>
  `linear-gradient(90deg, ${t[0]} 0%, ${t[1]} 46%, ${t[2]} 100%)`;

/** The silver room with the green glow low on the left and slow rings spreading from it. */
const Room: React.FC<{ frame: number; strength?: number }> = ({
  frame,
  strength = 1,
}) => {
  const beat = 0.5 + 0.5 * Math.sin(frame / 14);
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(165deg, #f4f7f6 0%, #d5dcda 36%, #a6b1b0 70%, #768384 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 20% 92%, rgba(150,230,60,${0.78 * strength}) 0%, rgba(110,200,40,${(0.32 + 0.08 * beat) * strength}) 20%, rgba(110,200,40,0) 46%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 82% 6%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 70%)",
        }}
      />
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", inset: 0 }}
      >
        {Array.from({ length: 6 }, (_, i) => {
          const r = 140 + ((i * 170 + frame * 1.4) % 1020);
          const o = interpolate(r, [140, 400, 1160], [0, 0.5, 0], clamp);
          return (
            <circle
              key={i}
              cx={384}
              cy={994}
              r={r}
              fill="none"
              stroke="#ffffff"
              strokeOpacity={o * strength}
              strokeWidth={2.5}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

/** A collapsed blade: a tall glossy strip with its label running down it. */
const Tab: React.FC<{
  label: string;
  tone: Tone;
  x: number;
  side: "l" | "r";
  enter: number;
  top: number;
  height: number;
}> = ({ label, tone, x, side, enter, top, height }) => {
  const dark = tone === TONE.green || tone === TONE.slate;
  const size = fitLabel(label, height - 120, 30, 22, 0.6);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top,
        width: 112,
        height,
        transform: `translateX(${(1 - enter) * (side === "r" ? 320 : -260)}px) perspective(1400px) rotateY(${side === "r" ? -48 : 48}deg)`,
        transformOrigin: side === "r" ? "left center" : "right center",
        opacity: Math.min(1, enter * 1.5),
        borderRadius: 6,
        background: gloss(tone),
        border: "1px solid rgba(255,255,255,0.75)",
        boxShadow:
          side === "r"
            ? "-10px 0 24px rgba(20,30,30,0.22)"
            : "10px 0 24px rgba(20,30,30,0.22)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "38%",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0))",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 76,
          top: 40,
          transform: "rotate(90deg)",
          transformOrigin: "left top",
          whiteSpace: "nowrap",
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: size,
          letterSpacing: 0.5,
          color: dark ? "#ffffff" : INK,
          textShadow: dark
            ? "0 1px 2px rgba(0,0,0,0.35)"
            : "0 1px 0 rgba(255,255,255,0.8)",
          maxWidth: height - 80,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label.toLowerCase()}
      </div>
    </div>
  );
};

/** A picture laid into the panel with a fine bevel. */
const Shot: React.FC<{
  src: string;
  w: number;
  h: number;
  push: number;
  pos?: string;
}> = ({ src, w, h, push, pos = "center" }) => (
  <div
    style={{
      position: "relative",
      width: w,
      height: h,
      borderRadius: 6,
      overflow: "hidden",
      boxShadow:
        "0 0 0 2px rgba(255,255,255,0.9), 0 12px 30px rgba(20,30,30,0.28)",
      flexShrink: 0,
    }}
  >
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: pos,
        transform: `scale(${push})`,
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "linear-gradient(160deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 38%)",
      }}
    />
  </div>
);

/** The opening title or chapter breather as the 2005 dashboard: a blade swings open over its stack. */
export const BladesCard: React.FC<MotifCardProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = cardFade(frame, p.frames);
  const heading = txt(p.heading);
  const kicker = txt(p.kicker);
  const game = txt(p.game);
  const year = txt(p.year);
  const pics = p.pictures.slice(0, 3);
  const spine = kicker || "games";
  const left = uniq([
    "home",
    game && game.toLowerCase() !== heading.toLowerCase() ? game : "games",
  ])
    .filter((x) => x.toLowerCase() !== spine.toLowerCase())
    .slice(0, 2);
  while (left.length < 2) left.unshift(left.length ? "home" : "games");
  const right = uniq([year || "media", "media", "system"]).slice(0, 3);
  const TOP = 96;
  const H = 888;
  const PX = 214;
  const PW = 1356;
  const swing = spring({ frame: frame - 4, fps, config: SWING });
  const show = interpolate(frame, [12, 22], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  const rise = interpolate(frame, [15, 29], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  const push = interpolate(frame, [0, p.frames], [1.08, 1.0], clamp);
  const sheen = interpolate(frame, [18, 36], [-40, 140], clamp);
  const meta = [
    game && game.toLowerCase() !== heading.toLowerCase() ? game : "",
    year,
  ]
    .filter(Boolean)
    .join("  ·  ");
  const headSize = sizeFor(heading, [
    [18, 96],
    [30, 80],
    [46, 64],
    [999, 52],
  ]);
  const CW = 1176;
  const CH = H - 104;
  // The pictures take what the title leaves: a short title gets a taller picture.
  const perLine = Math.max(8, Math.floor(CW / (headSize * 0.54)));
  const lines = Math.min(3, Math.max(1, Math.ceil(heading.length / perLine)));
  const textH = (meta ? 50 : 0) + lines * headSize * 1.04 + 12;
  const PH = Math.round(Math.max(380, Math.min(580, CH - 40 - textH)));
  const title = (colour: string, metaColour: string, shadow: string) => (
    <>
      {meta ? (
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 32,
              color: metaColour,
              letterSpacing: 0.5,
              transform: `translateY(${(1 - rise) * 110}%)`,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              textShadow: shadow,
            }}
          >
            {meta.toLowerCase()}
          </div>
        </div>
      ) : null}
      <div style={{ overflow: "hidden", marginTop: 6, paddingBottom: 6 }}>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: headSize,
            lineHeight: 1.04,
            letterSpacing: -1,
            color: colour,
            textShadow: shadow,
            transform: `translateY(${(1 - rise) * 100}%)`,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {heading}
        </div>
      </div>
    </>
  );
  return (
    <AbsoluteFill
      style={{ background: "#9aa5a4", opacity: fade, overflow: "hidden" }}
    >
      <Room frame={frame} />
      {left.map((l, i) => (
        <Tab
          key={`l${i}`}
          label={l}
          tone={i === 0 ? TONE.steel : TONE.silver}
          x={-12 + i * 70}
          side="l"
          top={TOP + 10}
          height={H - 20}
          enter={spring({ frame: frame - i * 2, fps, config: SPRING.ENTER })}
        />
      ))}
      {right.map((l, i) => (
        <Tab
          key={`r${i}`}
          label={l}
          tone={[TONE.silver, TONE.green, TONE.slate][i] ?? TONE.steel}
          x={1590 + i * 74}
          side="r"
          top={TOP + 10}
          height={H - 20}
          enter={spring({
            frame: frame - (2 + i * 2),
            fps,
            config: SPRING.ENTER,
          })}
        />
      ))}
      {/* The open blade */}
      <div
        style={{
          position: "absolute",
          left: PX,
          top: TOP,
          width: PW,
          height: H,
          transform: `perspective(2600px) rotateY(${-86 * (1 - swing)}deg)`,
          transformOrigin: "right center",
          opacity: interpolate(swing, [0, 0.08], [0, 1], clamp),
          borderRadius: 8,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(241,244,243,0.93) 55%, rgba(222,228,227,0.93) 100%)",
          boxShadow:
            "0 40px 90px rgba(20,30,30,0.38), 0 0 0 1px rgba(255,255,255,0.9)",
          overflow: "hidden",
        }}
      >
        {/* Its spine, the green tab it was */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 76,
            background: gloss(TONE.green),
            boxShadow: "inset -2px 0 0 rgba(255,255,255,0.5)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 56,
              top: 44,
              transform: "rotate(90deg)",
              transformOrigin: "left top",
              whiteSpace: "nowrap",
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: fitLabel(spine, H - 120, 34, 24, 0.6),
              color: "#ffffff",
              textShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          >
            {spine.toLowerCase()}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 128,
            top: 52,
            width: CW,
            height: CH,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          {pics.length === 0 ? (
            // No picture: the blade's own green banner carries the title.
            <div
              style={{
                position: "relative",
                width: CW,
                height: CH,
                borderRadius: 6,
                overflow: "hidden",
                opacity: show,
                background:
                  "radial-gradient(circle at 24% 78%, #c8f27a 0%, #79c62f 24%, #3f8b15 54%, #1c470a 100%)",
                boxShadow:
                  "0 0 0 2px rgba(255,255,255,0.9), 0 12px 30px rgba(20,30,30,0.28)",
              }}
            >
              <svg
                width={CW}
                height={CH}
                style={{ position: "absolute", inset: 0 }}
              >
                {Array.from({ length: 6 }, (_, i) => (
                  <circle
                    key={i}
                    cx={CW * 0.24}
                    cy={CH * 0.78}
                    r={90 + i * 120 + ((frame * 1.2) % 120)}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity={0.3 - i * 0.045}
                    strokeWidth={3}
                  />
                ))}
              </svg>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(160deg, rgba(255,255,255,0.3), rgba(255,255,255,0) 40%)",
                }}
              />
              <div style={{ position: "absolute", left: 56, right: 56, bottom: 48 }}>
                {title("#ffffff", "#e6ffc8", "0 2px 18px rgba(10,40,0,0.45)")}
              </div>
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 24,
                  height: PH,
                  opacity: show,
                  transform: `translateY(${(1 - show) * 24}px)`,
                }}
              >
                {pics.length === 1 ? (
                  <Shot src={pics[0]!} w={CW} h={PH} push={push} />
                ) : (
                  <>
                    <Shot src={pics[0]!} w={760} h={PH} push={push} />
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: 24 }}
                    >
                      {pics.slice(1).map((src, i) => (
                        <Shot
                          key={i}
                          src={src}
                          w={392}
                          h={pics.length === 2 ? PH : (PH - 24) / 2}
                          push={1.04}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div>{title(INK, LEAF, "none")}</div>
            </>
          )}
        </div>
        {/* One pass of light across the glass as it settles */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(105deg, transparent ${sheen - 14}%, rgba(255,255,255,0.32) ${sheen}%, transparent ${sheen + 14}%)`,
            pointerEvents: "none",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

type BladeRow = { title: string; sub?: string; photo?: string };

/** Items as tall blades standing in a row, each swinging open in turn and taking the green. */
const BladeRows: React.FC<{
  rows: BladeRow[];
  head: string;
  len: number;
  people: boolean;
  /** One picture spread across every blade's window, a panorama cut into blades. */
  pano?: string;
}> = ({ rows, head, len, people, pano }) => {
  const n = rows.length;
  const { frame, fps, dim, visible, showFor } = useStage(len, 150 + n * 20);
  if (!visible || n < 2) return null;
  const step = Math.max(10, Math.min(30, (showFor - 70) / n));
  const at = (i: number) => 12 + i * step;
  const gap = 26;
  const w = Math.min(560, (1728 - (n - 1) * gap) / n);
  const total = n * w + (n - 1) * gap;
  const panoW = Math.max(total, 700);
  const panoH = Math.round(panoW * 0.5625);
  const x0 = 96 + (1728 - total) / 2;
  const top = head ? 262 : 200;
  const h = Math.min(660, 1008 - 20 - top);
  const longest = rows.reduce((a, r) => Math.max(a, r.title.length), 0);
  const base = n <= 2 ? 64 : n === 3 ? 56 : n === 4 ? 50 : 42;
  const size = Math.max(30, base - (longest > 32 ? 10 : longest > 22 ? 6 : 0));
  const headIn = interpolate(frame, [4, 16], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{ opacity: dim, backdropFilter: `blur(${8 * dim}px)` }}
      >
        <AbsoluteFill style={{ opacity: 0.9 }}>
          <Room frame={frame} strength={0.9} />
        </AbsoluteFill>
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: dim }}>
        {head ? (
          <div
            style={{
              position: "absolute",
              left: 96,
              top: 130,
              right: 96,
              display: "flex",
              alignItems: "center",
              gap: 20,
              opacity: headIn,
              transform: `translateX(${(1 - headIn) * -40}px)`,
            }}
          >
            <div
              style={{
                width: 18,
                height: 64,
                borderRadius: 4,
                background: gloss(TONE.green),
                boxShadow: "0 0 0 1px rgba(255,255,255,0.8)",
              }}
            />
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: sizeFor(head, [
                  [24, 60],
                  [40, 50],
                  [999, 42],
                ]),
                color: INK,
                letterSpacing: -0.5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {head}
            </div>
          </div>
        ) : null}
        {rows.map((r, i) => {
          const open = spring({ frame: frame - at(i), fps, config: SWING });
          const next =
            i < n - 1
              ? spring({ frame: frame - at(i + 1), fps, config: SWING })
              : 0;
          const active = open * (1 - next);
          const appear = spring({
            frame: frame - i * 2,
            fps,
            config: SPRING.ENTER,
          });
          const face = interpolateColors(
            active,
            [0, 1],
            ["#dfe5e4", "#ffffff"],
          );
          const initials = r.title
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((x) => x[0]!.toUpperCase())
            .join("");
          const artH = Math.round(h * (people ? 0.62 : 0.66));
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x0 + i * (w + gap),
                top: top,
                width: w,
                height: h,
                opacity: Math.min(1, appear * 1.5),
                transform: `translateY(${-16 * active + (1 - appear) * 60}px) perspective(1800px) rotateY(${84 * (1 - open)}deg)`,
                transformOrigin: "left center",
                borderRadius: 8,
                background: `linear-gradient(180deg, ${face} 0%, ${face} 60%, #d3dad9 100%)`,
                boxShadow: `0 ${20 + 20 * active}px ${50 + 30 * active}px rgba(20,30,30,${0.25 + 0.15 * active}), 0 0 0 1px rgba(255,255,255,0.9)`,
                overflow: "hidden",
              }}
            >
              {/* Spine */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 30,
                  background: gloss(TONE.steel),
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: gloss(TONE.green),
                    opacity: active,
                  }}
                />
              </div>
              {/* Art: a portrait, or the green glow with its rings */}
              <div
                style={{
                  position: "absolute",
                  left: 30,
                  right: 0,
                  top: 0,
                  height: artH,
                  overflow: "hidden",
                  background: `radial-gradient(circle at 30% 80%, #c8f27a 0%, #79c62f 30%, #3f8b15 62%, #1f4d0a 100%)`,
                }}
              >
                {r.photo ? (
                  <Img
                    src={r.photo}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      objectPosition: "center 25%",
                    }}
                  />
                ) : pano && !people ? (
                  <Img
                    src={pano}
                    style={{
                      position: "absolute",
                      left: -(i * (w + gap) + 30),
                      top: (artH - panoH) / 2,
                      width: panoW,
                      height: panoH,
                      objectFit: "cover",
                      maxWidth: "none",
                    }}
                  />
                ) : (
                  <>
                    <svg
                      width={w}
                      height={artH}
                      style={{ position: "absolute", inset: 0 }}
                    >
                      {Array.from({ length: 4 }, (_, k) => (
                        <circle
                          key={k}
                          cx={(w - 30) * 0.3}
                          cy={artH * 0.8}
                          r={60 + k * 80 + ((frame * 1.1) % 80)}
                          fill="none"
                          stroke="#ffffff"
                          strokeOpacity={0.3 - k * 0.06}
                          strokeWidth={3}
                        />
                      ))}
                    </svg>
                    {people ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: BODY,
                          fontWeight: 900,
                          fontSize: Math.min(160, w * 0.36),
                          color: "rgba(255,255,255,0.92)",
                          letterSpacing: -2,
                        }}
                      >
                        {initials}
                      </div>
                    ) : null}
                  </>
                )}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(160deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 40%)",
                  }}
                />
                {/* Blades not chosen sit quieter, washed toward silver */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "#c9d0cf",
                    opacity: 0.5 * (1 - active),
                  }}
                />
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 30 + 26,
                  right: 24,
                  top: artH + 28,
                  bottom: 26,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-start",
                }}
              >
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: people ? Math.min(44, size) : size,
                    lineHeight: 1.06,
                    letterSpacing: -0.5,
                    color: INK,
                    overflowWrap: "break-word",
                  }}
                >
                  {r.title}
                </div>
                {r.sub ? (
                  <div
                    style={{
                      marginTop: 10,
                      fontFamily: BODY,
                      fontWeight: 800,
                      fontSize: 28,
                      lineHeight: 1.15,
                      color: LEAF,
                    }}
                  >
                    {r.sub}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const BladesList: React.FC<GfxProps> = ({ g, len, src }) => (
  <BladeRows
    pano={src}
    rows={g.items
      .map(txt)
      .filter(Boolean)
      .slice(0, 5)
      .map((title) => ({ title }))}
    head={txt(g.primary)}
    len={len}
    people={false}
  />
);

const BladesPeople: React.FC<GfxProps> = ({ g, len, photos = {} }) => (
  <BladeRows
    rows={g.items
      .map(splitRow)
      .filter((x): x is { a: string; b: string } => Boolean(x))
      .slice(0, 4)
      .map((r) => ({ title: r.a, sub: r.b, photo: photos[r.a.toLowerCase()] }))}
    head={txt(g.primary)}
    len={len}
    people
  />
);

export const BLADES_STYLES: Record<string, GfxStyle> = {
  Blades: {
    kind: "list",
    component: BladesList,
    fits: (g) => {
      const items = g.items.filter((x) => x.trim());
      return (
        items.length >= 2 &&
        items.length <= 5 &&
        items.every((x) => x.length <= 40) &&
        g.primary.length <= 48
      );
    },
    sound: "pop",
  },
  BladesPeople: {
    kind: "people",
    component: BladesPeople,
    fits: (g) => {
      const rows = g.items.map(splitRow).filter(Boolean) as Array<{
        a: string;
        b: string;
      }>;
      return (
        rows.length >= 2 &&
        rows.length <= 4 &&
        rows.length === g.items.length &&
        rows.every((r) => r.a.length <= 28 && r.b.length <= 44) &&
        g.primary.length <= 48
      );
    },
    sound: "pop",
  },
};
