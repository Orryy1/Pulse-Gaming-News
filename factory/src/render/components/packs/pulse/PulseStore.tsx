// Pulse universe, "PulseStore": a game's price or sales figure where a buyer met it. Up to 2008 a games shop
// shelf of boxed games (big cardboard boxes to 1999, slim plastic cases after), the front box carrying the
// sentence's picture (src) as its art; a price hangs on a swinging shelf-edge tag, a sales figure unrolls on a
// banner above the shelf. From 2009 the Pulse Store, a digital storefront: the picture as the hero, and either
// a buy button showing the price (glossy gel buttons to 2015, flat after) or a sales ribbon with the figure.
// The figure is shown exactly as the source writes it, never converted or rounded; the caption is the graphic's
// own words. A sales ribbon says BEST SELLER only for millions of copies (see bestSeller in ./pressKit.ts).
// Boxes carry no titles or ratings, the store no prices but the one given. Tagged ILLUSTRATION.
import React from "react";
import { Img, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import {
  clamp,
  easeInOut,
  easeOut,
  sizeByLength,
  txt,
} from "../screen/common.ts";
import { PulseMark, storyYear } from "../screen/pulse.tsx";
import {
  bestSeller,
  storeCase,
  storeLook,
  type StoreLook,
} from "./pressKit.ts";

/** Generic box art for the boxes around the front one: colour fields and shapes, never a title. */
const ART = [
  ["#2a4d8f", "#e94f37"],
  ["#1f6f50", "#f2c14e"],
  ["#5b2a86", "#3ec1d3"],
  ["#8f2a2a", "#f5f5f2"],
] as const;

const Box: React.FC<{
  look: StoreLook;
  w: number;
  h: number;
  art?: string;
  scheme: number;
  focus: boolean;
}> = ({ look, w, h, art, scheme, focus }) => {
  const big = look === "bigbox";
  const [a, b] = ART[scheme % ART.length]!;
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        // A big box shows its spine as a darker side; a case is a plastic shell round a paper insert.
        borderRadius: big ? 4 : 10,
        background: big
          ? "#111"
          : "linear-gradient(90deg,#0d0d10,#26262c 6%,#121216)",
        padding: big ? 0 : "10px 10px 10px 16px",
        boxSizing: "border-box",
        boxShadow: big
          ? `${focus ? 22 : 16}px 0 0 #0a0a0c, 0 30px 50px rgba(0,0,0,0.55)`
          : "0 30px 50px rgba(0,0,0,0.55)",
        filter: focus ? undefined : "brightness(0.62) blur(1.2px)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          borderRadius: big ? 3 : 4,
          background: `linear-gradient(160deg, ${a} 0%, #0b0b0e 85%)`,
        }}
      >
        {art ? (
          <Img
            src={art}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <>
            <div
              style={{
                position: "absolute",
                left: "12%",
                right: "12%",
                top: "14%",
                height: "9%",
                background: b,
                opacity: 0.85,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "12%",
                width: "46%",
                top: "27%",
                height: "4%",
                background: b,
                opacity: 0.5,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: "-8%",
                width: "90%",
                height: "62%",
                borderRadius: "50%",
                transform: "translateX(-50%)",
                background: `radial-gradient(circle, ${b}66, transparent 70%)`,
              }}
            />
          </>
        )}
        {/* The publisher's corner and, on a case, the coloured platform band: the Pulse mark only. */}
        {!big && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: "9%",
              background: "linear-gradient(180deg,#2f3a8f,#1d2566)",
              display: "flex",
              alignItems: "center",
              paddingLeft: "6%",
            }}
          >
            <PulseMark size={Math.round(h * 0.06)} colour="#fff" />
          </div>
        )}
        <div style={{ position: "absolute", right: "5%", bottom: "4%" }}>
          <PulseMark
            size={Math.round(w * 0.14)}
            colour="#fff"
            tile={big ? "#e8262d" : undefined}
            radius={10}
          />
        </div>
        {/* The plastic's shine across a case, or the gloss on a cardboard box's print. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(115deg, rgba(255,255,255,0.0) 30%, rgba(255,255,255,0.16) 42%, rgba(255,255,255,0.0) 54%)",
          }}
        />
      </div>
    </div>
  );
};

/** The shop: a wall, a shelf, five boxes, then the price tag or the sales banner. */
const Shelf: React.FC<{
  look: StoreLook;
  kind: "price" | "sales";
  fig: string;
  what: string;
  src?: string;
  frame: number;
  fps: number;
  showFor: number;
  variant: number;
}> = ({ look, kind, fig, what, src, frame, fps, showFor, variant }) => {
  const big = look === "bigbox";
  const shelfY = kind === "price" ? 700 : 820;
  const front = big ? { w: 400, h: 460 } : { w: 330, h: 440 };
  const side = big ? { w: 320, h: 380 } : { w: 270, h: 360 };
  const slots = [-2, -1, 1, 2];
  const push = interpolate(frame, [30, showFor], [1, 1.06], clamp);
  const figSize = sizeByLength(fig.length, [
    [6, 110],
    [10, 96],
    [16, 80],
    [999, 66],
  ]);

  // The price tag swings on its clip and settles; the banner unrolls from its pole.
  const swingT = Math.max(0, frame - 28);
  const swing =
    frame < 28 ? 70 : 34 * Math.exp(-swingT / 11) * Math.cos(swingT / 3.2);
  const tagIn = interpolate(frame, [26, 32], [0, 1], clamp);
  const unroll = interpolate(frame, [24, 50], [0, 1], {
    ...clamp,
    easing: easeOut,
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `scale(${push})`,
        transformOrigin: `960px ${shelfY - 120}px`,
      }}
    >
      {/* The wall: pegboard in the 90s, slatwall in the 2000s. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: big
            ? "radial-gradient(circle, #9c8f74 2.5px, transparent 3.5px) 0 0 / 34px 34px, linear-gradient(180deg,#d8cdb2,#bfb293)"
            : "repeating-linear-gradient(180deg,#2b3446 0 52px,#1b2130 52px 58px), #2b3446",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.6) 100%)",
        }}
      />
      {/* The boxes stand on the shelf, the front one in focus and a little forward. */}
      {slots.map((s, i) => {
        const up = spring({
          frame: frame - 4 - Math.abs(s) * 3,
          fps,
          config: { damping: 16, stiffness: 150, mass: 0.7 },
        });
        const x =
          960 + s * (side.w + 36) + (Math.sign(s) * (front.w - side.w)) / 2;
        return (
          <div
            key={s}
            style={{
              position: "absolute",
              left: x - side.w / 2,
              top: shelfY - side.h,
              transform: `translateY(${(1 - up) * 60}px)`,
              opacity: up,
            }}
          >
            <Box
              look={look}
              w={side.w}
              h={side.h}
              scheme={i + variant}
              focus={false}
            />
          </div>
        );
      })}
      {(() => {
        const up = spring({
          frame: frame - 2,
          fps,
          config: { damping: 15, stiffness: 140, mass: 0.8 },
        });
        return (
          <div
            style={{
              position: "absolute",
              left: 960 - front.w / 2,
              top: shelfY - front.h,
              transform: `translateY(${(1 - up) * 80}px)`,
              opacity: up,
            }}
          >
            <Box
              look={look}
              w={front.w}
              h={front.h}
              art={src}
              scheme={variant}
              focus
            />
          </div>
        );
      })()}
      {/* The shelf: a plank with a price channel along its lip. */}
      <div
        style={{
          position: "absolute",
          left: 100,
          right: 100,
          top: shelfY,
          height: 22,
          background: big ? "#e9e3d2" : "#c8ccd4",
          boxShadow: "0 -2px 0 rgba(255,255,255,0.4) inset",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 100,
          right: 100,
          top: shelfY + 22,
          height: 44,
          background: big
            ? "linear-gradient(180deg,#b8ae96,#8f866f)"
            : "linear-gradient(180deg,#8b919c,#5c616b)",
          boxShadow: "0 24px 40px rgba(0,0,0,0.5)",
        }}
      />
      {kind === "price" ? (
        <div
          style={{
            position: "absolute",
            left: 960 - 220,
            width: 440,
            top: shelfY + 40,
            transformOrigin: "50% 0",
            transform: `perspective(900px) rotate(${swing * 0.25}deg) rotateX(${swing}deg)`,
            opacity: tagIn,
          }}
        >
          {/* The clip that holds the tag in the lip's channel. */}
          <div
            style={{
              margin: "0 auto",
              width: 70,
              height: 18,
              background: "#d9dde3",
              borderRadius: 3,
              boxShadow: "inset 0 -2px 0 #9aa0aa",
            }}
          />
          <div
            style={{
              padding: "10px 24px 16px",
              background: big ? "#ffd400" : "#ffffff",
              borderTop: big ? "none" : `10px solid ${COLOUR.alert}`,
              boxShadow: "0 18px 30px rgba(0,0,0,0.45)",
              textAlign: "center",
              color: "#111",
            }}
          >
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: figSize,
                lineHeight: 1.05,
                letterSpacing: 1,
              }}
            >
              {fig}
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 28,
                lineHeight: 1.2,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {what}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            left: 960 - 560,
            width: 1120,
            top: 70,
          }}
        >
          {/* The banner's pole and the strings it hangs from. */}
          <div
            style={{
              height: 14,
              borderRadius: 7,
              background: "linear-gradient(180deg,#e5e5e5,#8d8d8d)",
            }}
          />
          <div
            style={{
              margin: "0 30px",
              clipPath: `inset(0 0 ${(1 - unroll) * 100}% 0)`,
              padding: "16px 40px 22px",
              background: big
                ? "linear-gradient(180deg,#e8262d,#b81920)"
                : "linear-gradient(180deg,#1d2566,#121845)",
              borderBottom: `8px solid ${big ? "#ffd400" : COLOUR.amber}`,
              textAlign: "center",
              boxShadow: "0 20px 40px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: figSize + 6,
                lineHeight: 1.05,
                color: big ? "#ffd400" : "#fff",
                letterSpacing: 1.5,
                textShadow: "4px 4px 0 rgba(0,0,0,0.35)",
              }}
            >
              {fig.toUpperCase()}
            </div>
            <div
              style={{
                marginTop: 6,
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 34,
                color: "#fff",
                textTransform: "uppercase",
                letterSpacing: 2,
              }}
            >
              {what}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** A plain arrow pointer. */
const Pointer: React.FC = () => (
  <svg width={40} height={56} viewBox="0 0 20 28">
    <path
      d="M1 1 L1 22 L6.5 17 L10 26 L13.5 24.5 L10 16 L17 16 Z"
      fill="#fff"
      stroke="#000"
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
  </svg>
);

/** Grey placeholder bars where a store page has words this graphic does not give. */
const Bars: React.FC<{ widths: number[]; colour: string; h?: number }> = ({
  widths,
  colour,
  h = 16,
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: h * 0.8 }}>
    {widths.map((w, i) => (
      <div
        key={i}
        style={{ height: h, width: w, borderRadius: h / 2, background: colour }}
      />
    ))}
  </div>
);

const WW = 1560;
const WH = 880;

/** The Pulse Store window. */
const Storefront: React.FC<{
  look: StoreLook;
  kind: "price" | "sales";
  g: MomentGraphic;
  fig: string;
  what: string;
  src?: string;
  frame: number;
  fps: number;
  showFor: number;
}> = ({ look, kind, g, fig, what, src, frame, fps, showFor }) => {
  const gel = look === "glossy";
  const rise = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  });
  const panel = (i: number) =>
    spring({
      frame: frame - 18 - i * 5,
      fps,
      config: { damping: 16, stiffness: 160, mass: 0.6 },
    });
  const pop = spring({
    frame: frame - 34,
    fps,
    config: { damping: 11, stiffness: 180, mass: 0.6 },
  });
  const glint = interpolate(frame, [52, 80], [-30, 130], clamp);
  // The pointer glides onto the button and rests there; the button lights as it arrives.
  const glide = interpolate(frame, [64, 98], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const hover = interpolate(frame, [94, 100], [0, 1], clamp);
  const kb = interpolate(frame, [0, showFor], [1.04, 1.12], clamp);
  const best = bestSeller(g);
  const figSize = sizeByLength(fig.length, [
    [6, 120],
    [10, 104],
    [16, 86],
    [999, 70],
  ]);
  const priceSize = sizeByLength(fig.length, [
    [7, 62],
    [12, 52],
    [999, 42],
  ]);

  const ui = gel
    ? {
        frame: "linear-gradient(180deg,#3c4a63,#1c2433)",
        page: "linear-gradient(180deg,#1f2a3c,#141b27)",
        bar: "#4b5a75",
        ink: "#e9eef7",
        muted: "#9fb0cb",
      }
    : {
        frame: "#0f1115",
        page: "#16191f",
        bar: "#2b2f38",
        ink: "#f2f3f5",
        muted: "#9aa0ab",
      };

  return (
    <div
      style={{
        position: "absolute",
        left: 960 - WW / 2,
        top: 540 - WH / 2 + (1 - rise) * 300,
        width: WW,
        height: WH,
        opacity: rise,
        borderRadius: gel ? 12 : 18,
        overflow: "hidden",
        background: ui.page,
        boxShadow: "0 40px 120px rgba(0,0,0,0.65)",
        fontFamily: BODY,
        border: gel ? "1px solid #6b7a96" : "1px solid #2a2e36",
      }}
    >
      {/* The store's own bar: the mark, its name and fixed section labels. */}
      <div
        style={{
          height: 72,
          display: "flex",
          alignItems: "center",
          gap: 34,
          padding: "0 30px",
          background: ui.frame,
          borderBottom: gel ? "1px solid #6b7a96" : "1px solid #23262d",
          color: ui.ink,
          fontSize: 26,
          fontWeight: 800,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <PulseMark size={40} colour={COLOUR.amber} />
          <span style={{ fontSize: 30, fontWeight: 900, letterSpacing: 1 }}>
            Pulse Store
          </span>
        </div>
        {["Store", "Library", "Community"].map((l, i) => (
          <span
            key={l}
            style={{
              color: i === 0 ? COLOUR.amber : ui.muted,
              fontWeight: 800,
              borderBottom: i === 0 ? `3px solid ${COLOUR.amber}` : "none",
              paddingBottom: 2,
            }}
          >
            {l}
          </span>
        ))}
        <div
          style={{
            marginLeft: "auto",
            width: 300,
            height: 42,
            borderRadius: gel ? 6 : 21,
            background: gel
              ? "linear-gradient(180deg,#e9eef7,#c9d3e3)"
              : "#23262d",
            color: gel ? "#4b5a75" : ui.muted,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          Search
        </div>
      </div>

      {/* The hero picture, slowly drifting closer, and a strip of crops from it. */}
      <div
        style={{
          position: "absolute",
          left: 32,
          top: 104,
          width: 940,
          height: 529,
          borderRadius: gel ? 6 : 14,
          overflow: "hidden",
          background: "linear-gradient(150deg,#2b3550,#0b0d14)",
          boxShadow: gel ? "0 0 0 1px #6b7a96" : "none",
        }}
      >
        {src ? (
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${kb})`,
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.25,
            }}
          >
            <PulseMark size={300} colour={COLOUR.amber} />
          </div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: 32,
          top: 652,
          display: "flex",
          gap: 14,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              width: 224,
              height: 126,
              borderRadius: gel ? 4 : 10,
              overflow: "hidden",
              background: ui.bar,
              opacity: 0.4 + 0.6 * panel(i),
              boxShadow: i === 0 ? `0 0 0 3px ${COLOUR.amber}` : "none",
            }}
          >
            {src && (
              <Img
                src={src}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: `${[50, 10, 90, 30][i]}% ${[50, 30, 70, 90][i]}%`,
                  transform: `scale(${[1, 1.8, 2.2, 1.6][i]})`,
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 32, top: 806 }}>
        <Bars widths={[600, 420]} colour={ui.bar} h={14} />
      </div>

      {/* The side panel: a title's worth of bars (no name is given), then the figure. */}
      <div
        style={{
          position: "absolute",
          left: 1010,
          right: 36,
          top: 104,
          bottom: 36,
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <div
          style={{
            height: 150,
            borderRadius: gel ? 6 : 12,
            overflow: "hidden",
            background: ui.bar,
            opacity: panel(0),
          }}
        >
          {src && (
            <Img
              src={src}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "saturate(1.1)",
              }}
            />
          )}
        </div>
        <div style={{ opacity: panel(1) }}>
          <Bars widths={[420, 300]} colour={ui.bar} h={22} />
        </div>
        {kind === "price" ? (
          <div
            style={{
              marginTop: "auto",
              opacity: panel(2),
              transform: `translateY(${(1 - panel(2)) * 30}px)`,
            }}
          >
            <div
              style={{
                color: ui.muted,
                fontSize: 30,
                fontWeight: 800,
                marginBottom: 14,
              }}
            >
              {what}
            </div>
            <div
              style={{
                position: "relative",
                height: 112,
                borderRadius: gel ? 10 : 14,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                padding: "0 28px",
                gap: 20,
                transform: `scale(${0.9 + 0.1 * pop + 0.02 * hover})`,
                background: gel
                  ? `linear-gradient(180deg,${hover ? "#8ee05f" : "#7ad14a"} 0%,#4ea52a 50%,#3b8d1c 51%,#5cb836 100%)`
                  : hover
                    ? "#ff8440"
                    : COLOUR.amber,
                boxShadow: gel
                  ? "inset 0 1px 0 rgba(255,255,255,0.7), 0 6px 16px rgba(0,0,0,0.5)"
                  : "0 10px 30px rgba(255,107,26,0.35)",
                color: gel ? "#fff" : COLOUR.ink,
                textShadow: gel ? "0 1px 2px rgba(0,0,0,0.45)" : "none",
              }}
            >
              <span style={{ fontSize: 34, fontWeight: 900 }}>Buy</span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: DISPLAY,
                  fontSize: priceSize,
                  letterSpacing: 1,
                }}
              >
                {fig}
              </span>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(110deg, transparent ${glint - 14}%, rgba(255,255,255,0.5) ${glint}%, transparent ${glint + 14}%)`,
                }}
              />
            </div>
          </div>
        ) : (
          <div
            style={{
              marginTop: "auto",
              opacity: panel(2),
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 18px",
                borderRadius: gel ? 4 : 20,
                background: gel
                  ? "linear-gradient(180deg,#ffd76a,#e8a91c)"
                  : COLOUR.amber,
                color: COLOUR.ink,
                fontWeight: 900,
                fontSize: 28,
                letterSpacing: 2,
                transform: `scale(${1.6 - 0.6 * pop}) rotate(${(1 - pop) * -8}deg)`,
                transformOrigin: "0 50%",
                opacity: interpolate(frame, [34, 38], [0, 1], clamp),
              }}
            >
              <PulseMark size={30} colour={COLOUR.ink} />
              {best ? "BEST SELLER" : "SALES"}
            </div>
            <div
              style={{
                position: "relative",
                marginTop: 14,
                fontFamily: DISPLAY,
                fontSize: figSize,
                lineHeight: 1.02,
                color: ui.ink,
                letterSpacing: 1,
              }}
            >
              {fig.toUpperCase()}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  color: "transparent",
                  background: `linear-gradient(110deg, transparent ${glint - 14}%, rgba(255,255,255,0.9) ${glint}%, transparent ${glint + 14}%)`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                }}
              >
                {fig.toUpperCase()}
              </div>
            </div>
            <div
              style={{
                marginTop: 8,
                color: ui.muted,
                fontSize: 32,
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              {what}
            </div>
          </div>
        )}
      </div>
      {kind === "price" && (
        <div
          style={{
            position: "absolute",
            left: interpolate(glide, [0, 1], [760, 1380]),
            top: interpolate(glide, [0, 1], [900, 790]),
            opacity: interpolate(frame, [64, 70], [0, 1], clamp),
          }}
        >
          <Pointer />
        </div>
      )}
    </div>
  );
};

export const PulseStore: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
  src,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 240);
  const kind = storeCase(g);
  if (!visible || !kind) return null;
  const fig = txt(g.primary);
  const what = txt(g.secondary);
  const look = storeLook(storyYear(g, year));
  const shop = look === "bigbox" || look === "case";

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={14}>
      {shop ? (
        <Shelf
          look={look}
          kind={kind}
          fig={fig}
          what={what}
          src={src}
          frame={frame}
          fps={fps}
          showFor={showFor}
          variant={variant}
        />
      ) : (
        <Storefront
          look={look}
          kind={kind}
          g={g}
          fig={fig}
          what={what}
          src={src}
          frame={frame}
          fps={fps}
          showFor={showFor}
        />
      )}
      <div
        style={{
          position: "absolute",
          right: 60,
          bottom: 48,
          color: "rgba(255,255,255,0.7)",
          fontFamily: BODY,
          fontSize: 20,
          letterSpacing: 3,
          opacity: interpolate(frame, [30, 40], [0, 1], clamp),
        }}
      >
        ILLUSTRATION
      </div>
    </Stage>
  );
};

export { fitsPulseStore } from "./pressKit.ts";
