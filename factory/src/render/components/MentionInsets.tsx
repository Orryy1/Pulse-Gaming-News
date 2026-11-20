// Mention insets (src/render/mentions.ts): a small picture of the exact thing the narration names, popping in on its
// word. One block per inset, top right (the people insets' place in a Short; under the credit line, larger, in a long
// video). No sound: an inset arriving is silent (the sparse sound plan keeps its effects for the edit's own moments).

import React from "react";
import {
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { platformColour } from "./cards/helpers.ts";
import {
  insetFrame,
  type MentionInset,
  type MentionLayout,
  type MentionPicture,
} from "../mentions.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const PANEL = "rgba(11,11,14,0.88)";
const SHADOW = "0 22px 50px rgba(0,0,0,0.6)";

/** The name strip under a picture: the name (shrunk to fit), a second line, and the credit when one is owed. */
const NameStrip: React.FC<{ p: MentionPicture; width: number }> = ({
  p,
  width,
}) => {
  const size = Math.max(
    24,
    Math.min(40, Math.floor(width / (Math.max(7, p.label.length) * 0.5))),
  );
  return (
    <div
      style={{
        marginTop: 10,
        padding: "8px 12px 7px",
        borderRadius: 14,
        background: PANEL,
        textAlign: "center",
        width,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: size,
          lineHeight: 1.05,
          color: COLOUR.paper,
          textTransform: "uppercase",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {p.label}
      </div>
      {p.sub ? (
        <div
          style={{
            marginTop: 3,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 17,
            letterSpacing: 2,
            color: COLOUR.muted,
          }}
        >
          {p.sub}
        </div>
      ) : null}
      {p.credit ? (
        <div
          style={{
            marginTop: 3,
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1.15,
            color: "rgba(245,245,242,0.7)",
            maxHeight: 34,
            overflow: "hidden",
          }}
        >
          {p.credit}
        </div>
      ) : null}
    </div>
  );
};

/** A framed picture: a game's capsule (tall), a character's art or a place (square). */
const Framed: React.FC<{
  src: string;
  width: number;
  height: number;
  accent: string;
  contain?: boolean;
}> = ({ src, width, height, accent, contain }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 24,
      overflow: "hidden",
      border: `5px solid ${accent}`,
      boxShadow: SHADOW,
      background: COLOUR.ink,
      boxSizing: "border-box",
    }}
  >
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: contain ? "contain" : "cover",
      }}
    />
  </div>
);

/** What one inset draws, at the Short's sizes (the long video scales the whole block). */
const Body: React.FC<{
  m: MentionInset;
  accent: string;
  frame: number;
  fps: number;
}> = ({ m, accent, frame, fps }) => {
  const pop = (k: number) =>
    spring({ frame: frame - k * 5, fps, config: SPRING.POP });
  if (m.kind === "game") {
    const two = m.pictures.length > 1;
    const w = two ? 270 : 300;
    return (
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {m.pictures.map((p, k) => (
          <div
            key={k}
            style={{
              width: w,
              opacity: Math.min(1, pop(k) * 1.4),
              transform: `translateY(${(1 - pop(k)) * 30}px)`,
            }}
          >
            <Framed
              src={p.src}
              width={w}
              height={Math.round(w * 1.5)}
              accent={accent}
            />
            <NameStrip p={p} width={w} />
          </div>
        ))}
      </div>
    );
  }
  if (m.kind === "inworld") {
    // The in-game thing itself: its logo or sign on a light card, or the frame that shows it, named and credited.
    const p = m.pictures[0]!;
    if (p.logo) {
      const aspect = Math.min(3, Math.max(0.8, p.aspect ?? 1.6));
      const w = 340;
      const h = Math.round(Math.min(260, Math.max(140, (w - 40) / aspect + 40)));
      return (
        <div style={{ width: w, opacity: Math.min(1, pop(0) * 1.4), transform: `translateY(${(1 - pop(0)) * 30}px)` }}>
          <div
            style={{
              width: w,
              height: h,
              padding: 20,
              boxSizing: "border-box",
              borderRadius: 26,
              background: "rgba(245,245,242,0.96)",
              border: `5px solid ${accent}`,
              boxShadow: SHADOW,
            }}
          >
            <Img src={p.src} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <NameStrip p={p} width={w} />
        </div>
      );
    }
    const w = 400;
    const aspect = Math.min(1.8, Math.max(1, p.aspect ?? 16 / 9));
    return (
      <div style={{ width: w, opacity: Math.min(1, pop(0) * 1.4), transform: `translateY(${(1 - pop(0)) * 30}px)` }}>
        <Framed src={p.src} width={w} height={Math.round(w / aspect)} accent={accent} />
        <NameStrip p={p} width={w} />
      </div>
    );
  }
  if (m.kind === "logo" || m.kind === "outlet") {
    const p = m.pictures[0]!;
    const aspect = Math.min(4, Math.max(1, p.aspect ?? 2.4));
    const h = 150;
    const w = Math.min(460, Math.max(240, Math.round(h * aspect) + 60));
    return (
      <div
        style={{
          width: w,
          height: h + 40,
          padding: 20,
          boxSizing: "border-box",
          borderRadius: 26,
          background: "rgba(245,245,242,0.96)",
          border: `5px solid ${accent}`,
          boxShadow: SHADOW,
        }}
      >
        <Img
          src={p.src}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>
    );
  }
  if (m.kind === "character") {
    // One character, or two named in one breath side by side, each popping in on its turn.
    const w = m.pictures.length > 1 ? 280 : 300;
    return (
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {m.pictures.slice(0, 2).map((p, k) => (
          <div
            key={k}
            style={{
              width: w,
              opacity: Math.min(1, pop(k) * 1.4),
              transform: `translateY(${(1 - pop(k)) * 30}px)`,
            }}
          >
            <Framed src={p.src} width={w} height={w} accent={accent} />
            <NameStrip p={p} width={w} />
          </div>
        ))}
      </div>
    );
  }
  if (m.kind === "realplace") {
    const w = 280;
    return (
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {m.pictures.slice(0, 2).map((p, k) => (
          <div
            key={k}
            style={{
              width: w,
              opacity: Math.min(1, pop(k) * 1.4),
              transform: `translateY(${(1 - pop(k)) * 30}px)`,
            }}
          >
            <Framed
              src={p.src}
              width={w}
              height={w}
              accent={k ? accent : COLOUR.paper}
            />
            <NameStrip p={p} width={w} />
          </div>
        ))}
      </div>
    );
  }
  if (m.kind === "platform") {
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          gap: 14,
          maxWidth: 760,
        }}
      >
        {(m.platforms ?? []).map((p, k) => (
          <div
            key={p}
            style={{
              padding: "12px 22px 10px",
              borderRadius: 14,
              background: platformColour(/^PS\d/.test(p) ? "playstation" : p),
              border: "3px solid rgba(255,255,255,0.85)",
              boxShadow: SHADOW,
              fontFamily: DISPLAY,
              fontSize: 46,
              lineHeight: 1,
              color: "#fff",
              letterSpacing: 1,
              opacity: Math.min(1, pop(k) * 1.4),
              transform: `scale(${0.85 + 0.15 * pop(k)})`,
            }}
          >
            {p}
          </div>
        ))}
      </div>
    );
  }
  // The receipt: who said it and when, from the story's own sources.
  return (
    <div
      style={{
        width: 540,
        padding: "20px 26px 22px",
        boxSizing: "border-box",
        borderRadius: 22,
        background: PANEL,
        borderLeft: `10px solid ${accent}`,
        boxShadow: SHADOW,
      }}
    >
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 22,
          letterSpacing: 5,
          color: accent,
        }}
      >
        SOURCE
      </div>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: Math.max(
            44,
            Math.min(
              72,
              Math.floor(480 / (Math.max(6, (m.label ?? "").length) * 0.52)),
            ),
          ),
          lineHeight: 1.04,
          color: COLOUR.paper,
          textTransform: "uppercase",
          marginTop: 4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {m.label}
      </div>
      {m.sub ? (
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: 2,
            color: COLOUR.paper,
            marginTop: 6,
          }}
        >
          {m.sub}
        </div>
      ) : null}
      {m.note ? (
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 700,
            fontSize: 22,
            color: COLOUR.muted,
            marginTop: 4,
          }}
        >
          {m.note}
        </div>
      ) : null}
    </div>
  );
};

/** One inset, drawn inside a Sequence of `len` frames: slides in on its word, leaves over its last 8 frames. */
export const MentionInsetView: React.FC<{
  m: MentionInset;
  len: number;
  accent: string;
  layout: MentionLayout;
}> = ({ m, len, accent, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = insetFrame(layout);
  const s = spring({ frame, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [len - 8, len], [1, 0], clamp);
  return (
    <div
      style={{
        position: "absolute",
        right: (layout === "short" ? 1080 : 1920) - at.right,
        top: at.top,
        display: "flex",
        justifyContent: "flex-end",
        opacity: out * Math.min(1, s * 1.4),
        transform: `translateY(${(1 - s) * 40}px) scale(${at.scale * (0.9 + 0.1 * s)})`,
        transformOrigin: "100% 0%",
      }}
    >
      <Body m={m} accent={accent} frame={frame} fps={fps} />
    </div>
  );
};
