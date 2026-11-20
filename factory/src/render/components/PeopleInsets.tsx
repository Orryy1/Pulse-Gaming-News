// PEOPLE_INSETS (src/render/people.ts): a named person's licensed photo as a small rounded picture-in-picture over the
// footage, popping in on the word that names them, with their name and the photo's credit under it; and the tracklist
// card of a soundtrack story, a Pulse-drawn list of the reported songs, a few at a time. Never real album art.

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
import {
  INSET_CAPTION,
  insetBox,
  pageFrames,
  trackPages,
  type PeopleGroup,
  type TracklistPlacement,
} from "../people.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * One row of insets, drawn inside a Sequence that starts at `from` (the row's kept start) and lasts `len` frames.
 * Each member slides in at its own name (or at once, when the row was held back past it) and the row leaves together.
 */
export const PeopleRow: React.FC<{
  group: PeopleGroup;
  from: number;
  len: number;
  accent: string;
}> = ({ group, from, len, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = group.members.length;
  const out = interpolate(frame, [len - 8, len], [1, 0], clamp);
  return (
    <>
      {group.members.map((m, k) => {
        const at = Math.max(0, m.appear - from);
        const s = spring({ frame: frame - at, fps, config: SPRING.ENTER });
        if (frame < at) return null;
        const box = insetBox(n, k);
        const nameSize = Math.max(
          26,
          Math.min(
            40,
            Math.floor(box.size / (Math.max(6, m.name.length) * 0.56)),
          ),
        );
        return (
          <div
            key={k}
            style={{
              position: "absolute",
              left: box.left,
              top: box.top,
              width: box.size,
              opacity: out * Math.min(1, s * 1.4),
              transform: `translateY(${(1 - s) * 40}px) scale(${0.9 + 0.1 * s})`,
              transformOrigin: "50% 0%",
            }}
          >
            <div
              style={{
                width: box.size,
                height: box.size,
                borderRadius: 28,
                overflow: "hidden",
                border: `5px solid ${accent}`,
                boxShadow: "0 22px 50px rgba(0,0,0,0.6)",
                background: COLOUR.ink,
              }}
            >
              <Img
                src={m.src}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
            <div
              style={{
                marginTop: 10,
                height: INSET_CAPTION - 10,
                padding: "8px 12px 6px",
                borderRadius: 14,
                background: "rgba(11,11,14,0.86)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: nameSize,
                  lineHeight: 1.05,
                  color: COLOUR.paper,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {m.name}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: BODY,
                  fontWeight: 600,
                  fontSize: 15,
                  lineHeight: 1.15,
                  color: "rgba(245,245,242,0.72)",
                  overflow: "hidden",
                  maxHeight: 36,
                }}
              >
                {m.credit}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};

/** The tracklist card: a title band, then the songs a page at a time (artist over title), in the hero band. */
export const TracklistCard: React.FC<{
  t: TracklistPlacement;
  len: number;
  accent: string;
}> = ({ t, len, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pages = trackPages(t.tracks, t.perPage);
  const lens = pageFrames(t.tracks, t.perPage, len);
  let page = 0;
  let pageStart = 0;
  for (let acc = 0, k = 0; k < lens.length; acc += lens[k]!, k++)
    if (frame >= acc) {
      page = k;
      pageStart = acc;
    }
  const enter = spring({ frame, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [len - 8, len], [1, 0], clamp);
  const rows = pages[page] ?? [];
  const first = pages.slice(0, page).reduce((n, p) => n + p.length, 0);
  return (
    <div
      style={{
        position: "absolute",
        left: 64,
        top: 380,
        width: 952,
        padding: "26px 34px 30px",
        background: "rgba(11,11,14,0.9)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 26,
        boxShadow: "0 30px 70px rgba(0,0,0,0.55)",
        opacity: out * enter,
        transform: `translateY(${(1 - enter) * 50}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 20,
        }}
      >
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 30,
            letterSpacing: 5,
            color: accent,
          }}
        >
          {t.title}
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 24,
            color: COLOUR.muted,
          }}
        >
          {pages.length > 1 ? `${page + 1}/${pages.length}` : ""}
        </div>
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 24,
          letterSpacing: 2,
          color: COLOUR.muted,
          textTransform: "uppercase",
          marginTop: 4,
          marginBottom: 14,
        }}
      >
        {t.subtitle}
      </div>
      {rows.map((r, k) => {
        const s = spring({
          frame: frame - pageStart - k * 4,
          fps,
          config: SPRING.POP,
        });
        return (
          <div
            key={`${page}-${k}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 26,
              padding: "16px 0",
              borderTop: k ? "1px solid rgba(255,255,255,0.1)" : "none",
              opacity: s,
              transform: `translateX(${(1 - s) * 40}px)`,
            }}
          >
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: 64,
                lineHeight: 1,
                color: accent,
                width: 70,
                textAlign: "right",
              }}
            >
              {first + k + 1}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: r.title ? 58 : 66,
                  lineHeight: 1.04,
                  color: COLOUR.paper,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.title ?? r.artist}
              </div>
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 30,
                  color: r.title ? "rgba(245,245,242,0.8)" : COLOUR.muted,
                  marginTop: 4,
                }}
              >
                {r.title ? r.artist : "Title not reported"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
