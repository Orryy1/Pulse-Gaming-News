// Genre motif: role-playing games, the classic console way. The card is a blue-gradient window with a
// white rounded border opening over the picture, the heading typed in letter by letter beside a bobbing
// selection cursor, the kicker on a name tab and a party-status strip below (the pictures as the party,
// generic HP and MP gauges filling, the game and year in their own panel). Two styles: "Dialog" types a
// quote into a dialogue window under the speaker's name tab, and "Menu" sets a list as a command menu
// with the cursor stepping down it.
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring } from "remotion";
import { BODY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  Pic,
  clamp,
  clean,
  fitSize,
  hash,
  useCard,
  words,
  wrap,
  yearOf,
} from "./kit.tsx";

const INK = "#0a1035";

/** The window: a blue gradient, a white rounded border and a dark keyline inside and out. */
export const windowStyle = (radius = 18): React.CSSProperties => ({
  background:
    "linear-gradient(180deg, #4560e0 0%, #2a3fb4 34%, #17227a 72%, #0f1656 100%)",
  border: "6px solid #f4f6ff",
  borderRadius: radius,
  boxShadow: `0 0 0 4px ${INK}, inset 0 0 0 4px ${INK}, inset 0 6px 0 4px rgba(255,255,255,0.12), 0 30px 80px rgba(0,0,0,0.6)`,
});

/** A white triangle pointer, drawn (no glyph), pointing right or down. */
const Pointer: React.FC<{
  size: number;
  down?: boolean;
  style?: React.CSSProperties;
}> = ({ size, down, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    style={{ overflow: "visible", ...style }}
  >
    <polygon
      points={down ? "2,4 18,4 10,16" : "3,2 17,10 3,18"}
      fill="#ffffff"
      stroke={INK}
      strokeWidth={2.4}
      strokeLinejoin="round"
    />
  </svg>
);

/** Text typed in: the shown part, then the rest kept in place but invisible so lines never reflow. */
const Typed: React.FC<{ text: string; n: number; shadow: string }> = ({
  text,
  n,
  shadow,
}) => (
  <>
    <span style={{ textShadow: shadow }}>{text.slice(0, n)}</span>
    <span style={{ color: "transparent" }}>{text.slice(n)}</span>
  </>
);

/** A thin gauge (HP or MP), filling in. */
const Gauge: React.FC<{ label: string; fill: number; colour: string }> = ({
  label,
  fill,
  colour,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <div
      style={{
        width: 46,
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: 22,
        letterSpacing: 1,
        color: "#dfe6ff",
        textShadow: `2px 2px 0 ${INK}`,
      }}
    >
      {label}
    </div>
    <div
      style={{
        flex: 1,
        height: 14,
        borderRadius: 7,
        background: "rgba(5,8,40,0.75)",
        border: "2px solid rgba(255,255,255,0.55)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${fill * 100}%`,
          height: "100%",
          background: `linear-gradient(180deg, #ffffff 0%, ${colour} 45%, ${colour} 100%)`,
        }}
      />
    </div>
  </div>
);

const Card: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
  variant = 0,
}) => {
  const { frame, fps, len, opacity } = useCard(frames);
  const title = clean(heading);
  const tag = clean(kicker).toUpperCase();
  const name = clean(game);
  const yr = yearOf(year);
  const open = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 260, mass: 0.6 },
  });
  const rate = Math.max(1.6, title.length / 24);
  const n = Math.max(0, Math.min(title.length, Math.floor((frame - 9) * rate)));
  const typed = n >= title.length;
  const size = fitSize(title, 1380, 3, [120, 104, 92, 82, 72, 64, 56], 0.56);
  // The window hugs the heading (a short heading gets a compact window) and sits centred.
  const lines = wrap(title, Math.max(1, Math.floor(1380 / (size * 0.56))));
  const textW = Math.max(...lines.map((l) => l.length)) * size * 0.56;
  const winW = Math.round(Math.min(1600, Math.max(980, textW + 230)));
  const winH = lines.length * size * 1.16 + (tag ? 108 : 96);
  const party =
    pictures.length > 1 ? pictures.slice(1, 4) : pictures.slice(0, 1);
  const hasInfo = Boolean(name || yr);
  const strip = party.length > 0 || hasInfo;
  const stripIn = spring({ frame: frame - 6, fps, config: SPRING.ENTER });
  const bg = pictures[0];
  const push = interpolate(frame, [0, len], [1.04, 1.12], clamp);
  const bob = Math.sin(frame * 0.42) * 7;
  const blink = Math.floor(frame / 9) % 2 === 0;
  // A few seeded twinkles for the no-picture night sky.
  const stars = React.useMemo(
    () =>
      Array.from({ length: 46 }, (_, i) => ({
        x: hash(variant * 31 + i, 1) * 1920,
        y: hash(variant * 31 + i, 2) * 1080,
        r: 1 + hash(variant * 31 + i, 3) * 2.2,
        t: hash(variant * 31 + i, 4) * 6.28,
      })),
    [variant],
  );
  return (
    <AbsoluteFill
      style={{ opacity, background: "#050826", overflow: "hidden" }}
    >
      {bg ? (
        <AbsoluteFill style={{ transform: `scale(${push})` }}>
          <Pic src={bg} style={{ filter: "saturate(1.05) brightness(0.78)" }} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(120% 90% at 50% 0%, #1c2a8a 0%, #0a1040 55%, #04061c 100%)",
          }}
        >
          <svg width={1920} height={1080}>
            {stars.map((s, i) => (
              <circle
                key={i}
                cx={s.x}
                cy={s.y}
                r={s.r}
                fill="#fff"
                opacity={0.35 + 0.35 * Math.sin(frame * 0.12 + s.t)}
              />
            ))}
          </svg>
        </AbsoluteFill>
      )}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(4,6,28,0.45) 0%, rgba(4,6,28,0.2) 30%, rgba(4,6,28,0.55) 70%, rgba(4,6,28,0.85) 100%)",
        }}
      />
      {/* The main window with the heading typed in. */}
      <div
        style={{
          position: "absolute",
          left: (1920 - winW) / 2,
          width: winW,
          top: strip ? Math.max(150, 455 - winH / 2) : (1080 - winH) / 2,
          transform: `scaleY(${0.04 + 0.96 * open}) scaleX(${0.6 + 0.4 * open})`,
          opacity: Math.min(1, open * 3),
        }}
      >
        {tag ? (
          <div
            style={{
              position: "absolute",
              left: 40,
              top: -44,
              padding: "8px 26px 8px",
              ...windowStyle(12),
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 28,
              letterSpacing: 4,
              color: "#fff",
              textShadow: `3px 3px 0 ${INK}`,
              zIndex: 2,
            }}
          >
            {tag}
          </div>
        ) : null}
        <div
          style={{
            ...windowStyle(22),
            padding: tag ? "56px 70px 52px 110px" : "48px 70px 48px 110px",
            position: "relative",
          }}
        >
          <Pointer
            size={Math.round(size * 0.46)}
            style={{
              position: "absolute",
              left: 40 + bob,
              top: (tag ? 56 : 48) + size * 0.33,
              opacity: typed && !blink ? 0.25 : 1,
            }}
          />
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: size,
              lineHeight: 1.16,
              color: "#ffffff",
              minHeight: size * 1.16,
              textWrap: "balance",
            }}
          >
            <Typed text={title} n={n} shadow={`4px 4px 0 ${INK}`} />
          </div>
          <Pointer
            size={30}
            down
            style={{
              position: "absolute",
              right: 34,
              bottom: 18 + (blink ? 0 : 5),
              opacity: typed ? 1 : 0,
            }}
          />
        </div>
      </div>
      {/* The party-status strip. */}
      {strip ? (
        <div
          style={{
            position: "absolute",
            left: 160,
            right: 160,
            bottom: 84,
            height: 196,
            display: "flex",
            gap: 26,
            justifyContent: party.length ? "flex-start" : "center",
            transform: `translateY(${(1 - stripIn) * 300}px)`,
          }}
        >
          {party.map((src, i) => {
            const g = interpolate(frame, [16 + i * 5, 36 + i * 5], [0, 1], {
              ...clamp,
              easing: Easing.out(Easing.quad),
            });
            return (
              <div
                key={i}
                style={{
                  ...windowStyle(16),
                  width: 330,
                  padding: "18px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    height: 92,
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "3px solid rgba(255,255,255,0.85)",
                    boxShadow: `0 0 0 2px ${INK}`,
                  }}
                >
                  <Pic src={src} />
                </div>
                <Gauge label="HP" fill={g} colour="#36d66b" />
                <Gauge label="MP" fill={g} colour="#47a8ff" />
              </div>
            );
          })}
          {hasInfo ? (
            <div
              style={{
                ...windowStyle(16),
                flex: party.length ? 1 : undefined,
                minWidth: party.length ? 0 : 700,
                padding: "24px 34px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 10,
              }}
            >
              {name ? (
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: name.length > 34 ? 32 : 40,
                    lineHeight: 1.12,
                    color: "#fff",
                    textShadow: `3px 3px 0 ${INK}`,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {name}
                </div>
              ) : null}
              {yr ? (
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: 32,
                    letterSpacing: 3,
                    color: "#ffd75a",
                    textShadow: `3px 3px 0 ${INK}`,
                  }}
                >
                  {yr}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */

const quoteText = (g: GfxProps["g"]) =>
  clean(g.primary)
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();

const fitsDialog = (g: GfxProps["g"]) => {
  const t = quoteText(g);
  const n = words(t).length;
  return (
    n >= 4 && n <= 40 && t.length <= 230 && clean(g.secondary).length <= 60
  );
};

/** A quote typed into a dialogue window, the speaker on its name tab. */
const Dialog: React.FC<GfxProps> = ({ g, len }) => {
  const text = quoteText(g);
  const n0 = words(text).length;
  const { frame, fps, dim, visible } = useStage(
    len,
    Math.max(150, Math.min(270, 70 + n0 * 8)),
  );
  if (!visible || !fitsDialog(g)) return null;
  const who = clean(g.secondary);
  const comma = who.indexOf(",");
  const name = comma > 0 ? who.slice(0, comma).trim() : who;
  const role = comma > 0 ? who.slice(comma + 1).trim() : "";
  const full = `“${text}”`;
  const rate = Math.max(2, full.length / 40);
  const n = Math.max(0, Math.min(full.length, Math.floor((frame - 10) * rate)));
  const typed = n >= full.length;
  const size = fitSize(full, 1560, 4, [70, 64, 58, 52, 46, 42], 0.55);
  const open = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 260, mass: 0.6 },
  });
  const tabIn = spring({ frame: frame - 6, fps, config: SPRING.POP });
  const blink = Math.floor(frame / 9) % 2 === 0;
  return (
    <AbsoluteFill style={{ opacity: dim, pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(4,6,28,0.2) 0%, rgba(4,6,28,0.55) 45%, rgba(4,6,28,0.88) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          bottom: 84,
          transformOrigin: "50% 100%",
          transform: `scaleY(${0.04 + 0.96 * open}) scaleX(${0.7 + 0.3 * open})`,
          opacity: Math.min(1, open * 3),
        }}
      >
        {name ? (
          <div
            style={{
              position: "absolute",
              left: 44,
              top: -50,
              padding: "8px 28px",
              ...windowStyle(12),
              display: "flex",
              alignItems: "baseline",
              gap: 16,
              transform: `scale(${tabIn})`,
              transformOrigin: "0% 100%",
              zIndex: 2,
              maxWidth: 1500,
            }}
          >
            <span
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 34,
                color: "#ffffff",
                textShadow: `3px 3px 0 ${INK}`,
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </span>
            {role ? (
              <span
                style={{
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 24,
                  letterSpacing: 2,
                  color: "#ffd75a",
                  textTransform: "uppercase",
                  textShadow: `2px 2px 0 ${INK}`,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {role}
              </span>
            ) : null}
          </div>
        ) : null}
        <div
          style={{
            ...windowStyle(22),
            padding: "58px 70px 56px",
            position: "relative",
            minHeight: 300,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: size,
              lineHeight: 1.3,
              color: "#ffffff",
            }}
          >
            <Typed text={full} n={n} shadow={`3px 3px 0 ${INK}`} />
          </div>
          <Pointer
            size={30}
            down
            style={{
              position: "absolute",
              right: 36,
              bottom: 20 + (blink ? 0 : 5),
              opacity: typed ? 1 : 0,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const menuItems = (g: GfxProps["g"]) => g.items.map(clean).filter(Boolean);

const fitsMenu = (g: GfxProps["g"]) => {
  const items = menuItems(g);
  return (
    items.length >= 2 &&
    items.length <= 5 &&
    items.length === g.items.filter((x) => x.trim()).length &&
    items.every((x) => x.length <= 38) &&
    clean(g.primary).length <= 32
  );
};

/** A list as a command menu: the heading on a tab, the items as commands, the cursor stepping down. */
const Menu: React.FC<GfxProps> = ({ g, len }) => {
  const items = menuItems(g);
  const { frame, fps, dim, visible } = useStage(
    len,
    Math.max(150, 70 + items.length * 22),
  );
  if (!visible || !fitsMenu(g)) return null;
  const head = clean(g.primary).toUpperCase();
  const open = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 260, mass: 0.6 },
  });
  const longest = Math.max(...items.map((x) => x.length));
  const size = longest > 30 ? 46 : longest > 22 ? 52 : 58;
  const rowH = size * 1.62;
  // The cursor lands on each command in turn, 16 frames apiece, and rests on the last.
  const step = Math.min(
    items.length - 1,
    Math.max(0, Math.floor((frame - 14) / 16)),
  );
  // Each move glides over the first 5 frames of its step.
  const into = frame - 14 - step * 16;
  const glide =
    step > 0
      ? interpolate(into, [0, 5], [0, 1], {
          ...clamp,
          easing: Easing.out(Easing.cubic),
        })
      : 1;
  const y = step > 0 ? (step - 1 + glide) * rowH : 0;
  const bob = Math.sin(frame * 0.42) * 6;
  const width = Math.min(1500, Math.max(860, longest * size * 0.58 + 260));
  return (
    <AbsoluteFill
      style={{
        opacity: dim,
        pointerEvents: "none",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AbsoluteFill style={{ background: "rgba(4,6,28,0.62)" }} />
      <div
        style={{
          position: "relative",
          width,
          marginTop: 60,
          transform: `scaleY(${0.04 + 0.96 * open}) scaleX(${0.7 + 0.3 * open})`,
          opacity: Math.min(1, open * 3),
        }}
      >
        {head ? (
          <div
            style={{
              position: "absolute",
              left: 40,
              top: -50,
              padding: "8px 28px",
              ...windowStyle(12),
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 32,
              letterSpacing: 4,
              color: "#ffffff",
              textShadow: `3px 3px 0 ${INK}`,
              whiteSpace: "nowrap",
              zIndex: 2,
            }}
          >
            {head}
          </div>
        ) : null}
        <div
          style={{
            ...windowStyle(22),
            padding: "54px 60px 46px 120px",
            position: "relative",
          }}
        >
          <Pointer
            size={Math.round(size * 0.8)}
            style={{
              position: "absolute",
              left: 34 + bob,
              top: 54 + y + rowH / 2 - size * 0.4,
              zIndex: 2,
            }}
          />
          {/* The selection band under the chosen command, gliding with the cursor. */}
          <div
            style={{
              position: "absolute",
              left: 100,
              right: 30,
              top: 54 + y + 4,
              height: rowH - 8,
              borderRadius: 10,
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 100%)",
              opacity: frame >= 14 ? 1 : 0,
            }}
          />
          {items.map((it, i) => {
            const s = spring({
              frame: frame - 6 - i * 4,
              fps,
              config: SPRING.SNAP,
            });
            const on = i === step && frame >= 14;
            return (
              <div
                key={i}
                style={{
                  height: rowH,
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: size,
                  color: on ? "#ffffff" : "rgba(220,228,255,0.78)",
                  textShadow: `3px 3px 0 ${INK}`,
                  opacity: s,
                  transform: `translateX(${(1 - s) * 30}px)`,
                  whiteSpace: "nowrap",
                }}
              >
                {it}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const RpgCard = Card;
export const RPG_STYLES: Record<string, GfxStyle> = {
  Dialog: {
    kind: "quote",
    component: Dialog,
    fits: fitsDialog,
    sound: "glint",
  },
  Menu: { kind: "list", component: Menu, fits: fitsMenu, sound: "glint" },
};
