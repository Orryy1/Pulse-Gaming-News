// Wii (2006-2012) homage: the channel grid. A pale grey grid of rounded channels (the pictures in some),
// a clock bar along the bottom showing the year, a cyan glow settling on one channel and that channel
// zooming to fill the frame to reveal the heading. The styles set a list or people out as channels.
// Built from scratch: no logo, wordmark, cursor or real channel art.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import { PulseMark } from "../../packs/screen/pulse.tsx";
import {
  clamp,
  clean,
  easeInOut,
  fit,
  gameLine,
  initials,
  lerp,
  lineClamp,
  longestWord,
  splitPairs,
  useCard,
} from "./shared.tsx";

const PAPER = "linear-gradient(180deg, #f7f8f9 0%, #eceef1 70%, #e2e5e9 100%)";
const STRIPES =
  "repeating-linear-gradient(0deg, rgba(255,255,255,0.75) 0px, rgba(255,255,255,0.75) 3px, rgba(214,219,224,0.35) 3px, rgba(214,219,224,0.35) 6px)";
const CYAN = "#34bdea";
const GREY = "#5c636b";
const LIGHT_GREY = "#a3a9b0";

const glow = (a: number) =>
  `0 0 0 ${6 * a}px rgba(52,189,234,${a}), 0 0 ${34 * a}px rgba(52,189,234,${0.75 * a}), 0 10px 26px rgba(80,90,100,0.18)`;

/** One channel: a picture, a line of text, or an empty slot. */
const Channel: React.FC<{
  w: number;
  h: number;
  src?: string;
  pan?: number;
  children?: React.ReactNode;
  hover?: number;
  empty?: boolean;
}> = ({ w, h, src, pan = 0, children, hover = 0, empty }) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: 30,
      padding: empty ? 0 : 7,
      boxSizing: "border-box",
      background: empty ? STRIPES : "linear-gradient(180deg, #ffffff, #f1f3f5)",
      border: `3px solid ${empty ? "#d3d8dd" : "#c3cad1"}`,
      boxShadow: hover
        ? glow(hover)
        : empty
          ? "inset 0 2px 6px rgba(0,0,0,0.05)"
          : "0 8px 20px rgba(80,90,100,0.14)",
      overflow: "hidden",
      position: "relative",
    }}
  >
    {src ? (
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 22,
          overflow: "hidden",
        }}
      >
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(1.12) translateX(${pan}px)`,
          }}
        />
      </div>
    ) : null}
    {children}
  </div>
);

/** The bottom bar: two round buttons at the ends and the year as the clock, or no clock at all. */
const ClockBar: React.FC<{ year: string; y?: number; enter: number }> = ({
  year,
  y = 900,
  enter,
}) => {
  const R = 84; // a button's radius
  const B = 112; // the radius the bar's edge curves around each button
  const LIFT = 150; // the svg starts this far above the bar's edge, so the curves are not cut off
  const ends = [230, 1690];
  const edge = `M-10 ${LIFT} H${ends[0]! - B} A${B} ${B} 0 0 1 ${ends[0]! + B} ${LIFT} H${ends[1]! - B} A${B} ${B} 0 0 1 ${ends[1]! + B} ${LIFT} H1930`;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: y - LIFT + (1 - enter) * 260,
        width: 1920,
        height: 1080 - y + LIFT + 40,
      }}
    >
      <svg
        width={1920}
        height={1080 - y + LIFT + 40}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        <defs>
          <linearGradient id="wiiBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fdfdfd" />
            <stop offset="0.45" stopColor="#eef0f2" />
            <stop offset="1" stopColor="#d8dce0" />
          </linearGradient>
        </defs>
        <path
          d={`${edge} V${1080 - y + LIFT + 40} H-10 Z`}
          fill="url(#wiiBar)"
        />
        <path d={edge} fill="none" stroke="#c3c9cf" strokeWidth={4} />
        <path
          d={edge}
          fill="none"
          stroke="#ffffff"
          strokeWidth={3}
          transform="translate(0 5)"
          opacity={0.9}
        />
      </svg>
      {ends.map((cx) => (
        <div
          key={cx}
          style={{
            position: "absolute",
            left: cx - R,
            top: LIFT + 12 - R,
            width: R * 2,
            height: R * 2,
            borderRadius: R,
            background:
              "radial-gradient(circle at 40% 30%, #ffffff, #e6e9ed 72%)",
            border: "5px solid #c9cfd5",
            boxSizing: "border-box",
            boxShadow: "0 8px 20px rgba(80,90,100,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: R,
              height: R,
              borderRadius: R,
              border: `5px solid ${CYAN}`,
              boxSizing: "border-box",
              opacity: 0.55,
            }}
          />
          {/* The Pulse mark in the left button, where the console's name sits on its menu. */}
          {cx === ends[0] ? (
            <div
              style={{
                position: "absolute",
                left: R - 5 - 24,
                top: R - 5 - 24,
              }}
            >
              <PulseMark size={48} colour={CYAN} />
            </div>
          ) : null}
        </div>
      ))}
      {year ? (
        <div
          style={{
            position: "absolute",
            left: 560,
            width: 800,
            top: LIFT - 112,
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 108,
            letterSpacing: 6,
            color: LIGHT_GREY,
            textShadow: "0 3px 0 #ffffff, 0 -1px 0 rgba(0,0,0,0.08)",
          }}
        >
          {year}
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------------
// The card.

const GRID = { cols: 4, rows: 3, w: 372, h: 220, gap: 30, top: 74 };
const GRID_LEFT =
  (1920 - (GRID.cols * GRID.w + (GRID.cols - 1) * GRID.gap)) / 2;
const TARGET = 5;
const PIC_SLOTS = [TARGET, 0, 2, 7, 9, 11];

const slotRect = (i: number) => ({
  x: GRID_LEFT + (i % GRID.cols) * (GRID.w + GRID.gap),
  y: GRID.top + Math.floor(i / GRID.cols) * (GRID.h + GRID.gap),
});

const ChannelsCard: React.FC<MotifCardProps> = (props) => {
  const { frame, fps, len, fade } = useCard(props.frames);
  const heading = clean(props.heading);
  const kicker = clean(props.kicker);
  const year = clean(props.year);
  const meta = gameLine(props);
  const pics = props.pictures.filter(Boolean).slice(0, 6);
  const bySlot = new Map<number, string>();
  pics.forEach((p, k) => bySlot.set(PIC_SLOTS[k]!, p));
  const target = slotRect(TARGET);
  const hover = interpolate(frame, [8, 14], [0, 1], clamp);
  const zoom = spring({
    frame: frame - 18,
    fps,
    config: { damping: 20, stiffness: 90, mass: 0.9 },
  });
  const barIn = spring({ frame: frame - 2, fps, config: SPRING.ENTER });
  const cx = target.x + GRID.w / 2;
  const cy = target.y + GRID.h / 2;
  const box = {
    x: lerp(target.x, 0, zoom),
    y: lerp(target.y, 0, zoom),
    w: lerp(GRID.w, 1920, zoom),
    h: lerp(GRID.h, 1080, zoom),
    r: lerp(30, 0, zoom),
  };
  const hovered = 1 + 0.06 * hover * (1 - zoom);
  const textIn = interpolate(frame, [27, 38], [0, 1], clamp);
  const panelIn = spring({ frame: frame - 24, fps, config: SPRING.ENTER });
  const pic = bySlot.get(TARGET);
  const push = interpolate(frame, [18, len], [1.12, 1.2], clamp);
  const hSize = fit(heading, 1500, 2, [92, 80, 70, 60], 0.56);
  return (
    <AbsoluteFill
      style={{ background: PAPER, opacity: fade, overflow: "hidden" }}
    >
      <AbsoluteFill style={{ background: STRIPES, opacity: 0.6 }} />
      {/* The menu, pushed past as the channel opens. */}
      <AbsoluteFill
        style={{
          transform: `scale(${1 + 1.6 * zoom})`,
          transformOrigin: `${cx}px ${cy}px`,
          opacity: 1 - interpolate(zoom, [0.04, 0.35], [0, 1], clamp),
        }}
      >
        {Array.from({ length: GRID.cols * GRID.rows }, (_, i) => {
          const { x, y } = slotRect(i);
          const s = spring({
            frame:
              frame - (i % GRID.cols) * 1.2 - Math.floor(i / GRID.cols) * 1.6,
            fps,
            config: SPRING.POP,
          });
          const src = bySlot.get(i);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: y,
                opacity: Math.min(1, s * 1.4),
                transform: `scale(${0.86 + 0.14 * s})`,
              }}
            >
              <Channel
                w={GRID.w}
                h={GRID.h}
                src={i === TARGET ? undefined : src}
                pan={Math.sin(frame * 0.02 + i) * 10}
                empty={!src && i !== TARGET}
              />
            </div>
          );
        })}
        <ClockBar year={year} enter={barIn} />
      </AbsoluteFill>
      {/* The chosen channel: glowing, then filling the frame. */}
      <div
        style={{
          position: "absolute",
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          borderRadius: box.r,
          overflow: "hidden",
          transform: `scale(${hovered})`,
          boxShadow: zoom < 0.95 ? glow(hover * (1 - zoom)) : "none",
          border:
            zoom < 0.6 ? `3px solid rgba(195,202,209,${1 - zoom})` : "none",
          background: pic ? "#dfe3e7" : PAPER,
          opacity: interpolate(frame, [0, 6], [0, 1], clamp),
        }}
      >
        {pic ? (
          <Img
            src={pic}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${push})`,
            }}
          />
        ) : (
          <AbsoluteFill style={{ background: STRIPES, opacity: 0.8 }} />
        )}
        {!pic ? (
          <div
            style={{
              position: "absolute",
              inset: 64,
              borderRadius: 48,
              border: "4px solid #d0d6dc",
              boxShadow:
                "inset 0 0 0 12px rgba(255,255,255,0.7), 0 0 60px rgba(52,189,234,0.16)",
              opacity: interpolate(zoom, [0.5, 1], [0, 1], clamp),
            }}
          />
        ) : null}
        {!pic && zoom < 0.5 ? (
          <AbsoluteFill
            style={{
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              textAlign: "center",
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 30,
              color: GREY,
              opacity: 1 - zoom * 2,
            }}
          >
            <div style={lineClamp(3)}>{kicker || heading}</div>
          </AbsoluteFill>
        ) : null}
      </div>
      {/* The heading, on a frosted white panel like a channel's own start screen. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: pic ? 380 : 1080,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: pic
            ? "linear-gradient(180deg, rgba(250,251,252,0.94), rgba(236,239,242,0.98))"
            : "transparent",
          borderTop: pic ? `5px solid ${CYAN}` : "none",
          transform: `translateY(${(1 - panelIn) * (pic ? 380 : 0)}px)`,
          opacity: pic ? 1 : panelIn,
          boxShadow: pic ? "0 -20px 60px rgba(40,50,60,0.25)" : "none",
        }}
      >
        <div style={{ width: 1560, textAlign: "center" }}>
          {kicker ? (
            <div
              style={{
                display: "inline-block",
                padding: "8px 26px",
                borderRadius: 30,
                border: `3px solid ${CYAN}`,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 28,
                letterSpacing: 4,
                color: CYAN,
                textTransform: "uppercase",
                opacity: textIn,
                marginBottom: 20,
              }}
            >
              {kicker}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: hSize,
              lineHeight: 1.06,
              color: GREY,
              opacity: textIn,
              transform: `translateY(${(1 - textIn) * 18}px)`,
              ...lineClamp(2),
            }}
          >
            {heading}
          </div>
          {meta ? (
            <div
              style={{
                marginTop: 14,
                fontFamily: BODY,
                fontWeight: 600,
                fontSize: 32,
                color: LIGHT_GREY,
                opacity: interpolate(frame, [32, 42], [0, 1], clamp),
                ...lineClamp(1),
              }}
            >
              {meta}
            </div>
          ) : null}
        </div>
      </div>
      {!pic && year ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 70,
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 72,
            letterSpacing: 6,
            color: LIGHT_GREY,
            textShadow: "0 3px 0 #ffffff",
            opacity: textIn,
          }}
        >
          {year}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// Styles: a list or people as channels, the glow visiting each in turn.

const SLOT = { cols: 3, w: 552, h: 316, gap: 36, top: 240 };

const ChannelGrid: React.FC<{
  frame: number;
  fps: number;
  heading: string;
  year?: number;
  src?: string;
  tiles: React.ReactNode[];
}> = ({ frame, fps, heading, year, src, tiles }) => {
  const n = tiles.length;
  const STEP = 18;
  const k = Math.max(0, (frame - 16) / STEP);
  const i0 = Math.min(n - 1, Math.floor(k));
  const pos =
    i0 >= n - 1 ? n - 1 : i0 + easeInOut(Math.min(1, ((k - i0) * STEP) / 8));
  const lit = interpolate(frame, [14, 20], [0, 1], clamp);
  const headIn = interpolate(frame, [2, 14], [0, 1], clamp);
  return (
    <>
      <AbsoluteFill style={{ background: STRIPES, opacity: 0.6 }} />
      {heading ? (
        <div
          style={{
            position: "absolute",
            left: 96,
            right: 96,
            top: 140,
            display: "flex",
            alignItems: "center",
            gap: 20,
            opacity: headIn,
            transform: `translateX(${(1 - headIn) * -30}px)`,
          }}
        >
          <div
            style={{ width: 14, height: 54, borderRadius: 7, background: CYAN }}
          />
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 50,
              color: GREY,
              ...lineClamp(1),
            }}
          >
            {heading}
          </div>
        </div>
      ) : null}
      {Array.from({ length: 6 }, (_, i) => {
        const x = 96 + (i % SLOT.cols) * (SLOT.w + SLOT.gap);
        const y = SLOT.top + Math.floor(i / SLOT.cols) * (SLOT.h + SLOT.gap);
        const s = spring({
          frame: frame - 4 - i * 2.5,
          fps,
          config: SPRING.POP,
        });
        const isItem = i < n;
        const extra = !isItem && i === n && src;
        const on = isItem ? Math.max(0, 1 - Math.abs(pos - i)) * lit : 0;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              opacity: Math.min(1, s * 1.4),
              transform: `scale(${(0.86 + 0.14 * s) * (1 + 0.04 * on)})`,
              zIndex: on ? 2 : 1,
            }}
          >
            <Channel
              w={SLOT.w}
              h={SLOT.h}
              src={extra ? src : undefined}
              pan={Math.sin(frame * 0.02 + i) * 10}
              hover={on}
              empty={!isItem && !extra}
            >
              {isItem ? tiles[i] : null}
            </Channel>
          </div>
        );
      })}
      {year ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 922,
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 64,
            letterSpacing: 6,
            color: LIGHT_GREY,
            textShadow: "0 3px 0 #ffffff",
            opacity: headIn,
          }}
        >
          {year}
        </div>
      ) : null}
    </>
  );
};

export function fitsChannels(g: MomentGraphic): boolean {
  const items = g.items.map(clean).filter(Boolean);
  return (
    items.length >= 2 &&
    items.length <= 6 &&
    items.length === g.items.length &&
    items.every((x) => x.length <= 40 && longestWord(x) <= 16) &&
    clean(g.primary).length <= 44
  );
}

const Channels: React.FC<GfxProps> = ({ g, len, src, year }) => {
  const { frame, fps, dim, visible } = useStage(len, 210);
  const items = g.items.map(clean).filter(Boolean).slice(0, 6);
  if (!visible || items.length < 2) return null;
  const size = Math.min(
    ...items.map((t) => fit(t, SLOT.w - 80, 3, [46, 40, 36], 0.56)),
  );
  const tiles = items.map((t, i) => (
    <AbsoluteFill
      key={i}
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: "0 36px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.12,
          color: GREY,
          ...lineClamp(3),
        }}
      >
        {t}
      </div>
    </AbsoluteFill>
  ));
  return (
    <AbsoluteFill style={{ opacity: dim, background: PAPER }}>
      <ChannelGrid
        frame={frame}
        fps={fps}
        heading={clean(g.primary)}
        year={year}
        src={src}
        tiles={tiles}
      />
    </AbsoluteFill>
  );
};

export function fitsChannelPeople(g: MomentGraphic): boolean {
  const rows = splitPairs(g.items);
  return (
    rows.length >= 1 &&
    rows.length <= 4 &&
    rows.length === g.items.filter((x) => x.trim()).length &&
    rows.every(
      (r) => r.a.length <= 26 && r.b.length <= 36 && longestWord(r.a) <= 14,
    ) &&
    clean(g.primary).length <= 44
  );
}

const ChannelPeople: React.FC<GfxProps> = ({
  g,
  len,
  src,
  year,
  photos = {},
}) => {
  const { frame, fps, dim, visible } = useStage(len, 210);
  const rows = splitPairs(g.items).slice(0, 4);
  if (!visible || !rows.length) return null;
  const tiles = rows.map((r, i) => {
    const photo = photos[r.a.toLowerCase()];
    return (
      <AbsoluteFill
        key={i}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 28,
          padding: "0 30px",
        }}
      >
        <div
          style={{
            flex: "none",
            width: 156,
            height: 156,
            borderRadius: 78,
            overflow: "hidden",
            border: `5px solid ${CYAN}`,
            background: "linear-gradient(160deg, #7fd6f5, #2a9fd0)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: DISPLAY,
            fontSize: 70,
            color: "#ffffff",
          }}
        >
          {photo ? (
            <Img
              src={photo}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            initials(r.a)
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: r.a.length > 16 ? 34 : 40,
              lineHeight: 1.08,
              color: GREY,
              ...lineClamp(2),
            }}
          >
            {r.a}
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: 26,
              lineHeight: 1.15,
              color: "#8a9199",
              ...lineClamp(2),
            }}
          >
            {r.b}
          </div>
        </div>
      </AbsoluteFill>
    );
  });
  return (
    <AbsoluteFill style={{ opacity: dim, background: PAPER }}>
      <ChannelGrid
        frame={frame}
        fps={fps}
        heading={clean(g.primary)}
        year={year}
        src={src}
        tiles={tiles}
      />
    </AbsoluteFill>
  );
};

export const WII_CARD = ChannelsCard;
export const WII_STYLES: Record<string, GfxStyle> = {
  /** list: primary a heading, items 2-6 short lines (40 characters at most); each a channel the glow visits. */
  Channels: {
    kind: "list",
    component: Channels,
    fits: fitsChannels,
    sound: "pop",
  },
  /** people: primary a heading, items 1-4 "Full Name: role"; each a channel with the portrait or initials. */
  ChannelPeople: {
    kind: "people",
    component: ChannelPeople,
    fits: fitsChannelPeople,
    sound: "pop",
  },
};
