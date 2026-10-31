// The documentary's structure devices as drawn (planning in src/render/structure.ts):
//  - TitleDrop: the title lands as a designed card on the cold open's last beat, LEMMiNO style: the picture
//    sinks under ink, the title tracks in, an amber rule draws out under it, the kicker follows.
//  - ChapterIndex: a slim row of chapter numbers under the mark, done ones in white, the current one lit
//    amber with its title beside it, upcoming ones dim.
//  - YearCounter: the chapter's year in the corner, rolling like an odometer when the chapter changes.
//  - CallbackCue: when the narrator answers a question raised minutes earlier, a small framed recall of the
//    shot that was on screen then, with the question under it.
// Every word on screen comes from the props (the episode's own title, chapters, years and questions).

import React from "react";
import {
  AbsoluteFill,
  Freeze,
  Img,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { titleLines } from "../longplan.ts";
import { displayText } from "../timeline.ts";
import {
  indexAt,
  odometerDigits,
  yearAt,
  type ChapterMark,
} from "../structure.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const SAFE_X = 96;

/** The title card, rendered inside a Sequence of the drop's length. */
export const TitleDrop: React.FC<{
  title: string;
  kicker: string;
  len: number;
  landAt: number;
}> = ({ title, kicker, len, landAt }) => {
  const frame = useCurrentFrame();
  // The picture sinks under ink in the frames before the title lands, then everything fades at the end.
  const sink = interpolate(frame, [0, Math.max(1, landAt)], [0, 0.86], clamp);
  const out = interpolate(frame, [len - 12, len - 1], [1, 0], clamp);
  const t = interpolate(frame, [landAt, landAt + 20], [0, 1], clamp);
  const ease = 1 - (1 - t) ** 3;
  const rule = interpolate(frame, [landAt + 8, landAt + 26], [0, 1], clamp);
  const kick = interpolate(frame, [landAt + 16, landAt + 30], [0, 1], clamp);
  const lines = titleLines(displayText(title));
  const big = title.length > 30;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: out }}>
      <AbsoluteFill style={{ background: COLOUR.ink, opacity: sink }} />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(11,11,14,0) 40%, rgba(11,11,14,0.7) 100%)",
          opacity: sink,
        }}
      />
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", gap: 30 }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: big ? 118 : 140,
            lineHeight: 1.0,
            color: COLOUR.paper,
            textTransform: "uppercase",
            textAlign: "center",
            maxWidth: 1600,
            opacity: ease,
            letterSpacing: `${0.02 + (1 - ease) * 0.3}em`,
            filter: `blur(${(1 - ease) * 6}px)`,
            textShadow: "0 12px 60px rgba(0,0,0,0.75)",
          }}
        >
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
        <div
          style={{
            width: 240 * rule,
            height: 6,
            background: COLOUR.amber,
            borderRadius: 3,
          }}
        />
        {kicker ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 34,
              letterSpacing: 3,
              color: COLOUR.amber,
              textTransform: "uppercase",
              opacity: kick,
              transform: `translateY(${(1 - kick) * 12}px)`,
            }}
          >
            {displayText(kicker)}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The current chapter's title beside its number, cut at a word past this many characters. */
const INDEX_TITLE_MAX = 34;
const shortTitle = (t: string) => {
  const s = displayText(t).toUpperCase();
  if (s.length <= INDEX_TITLE_MAX) return s;
  const cut = s.slice(0, INDEX_TITLE_MAX);
  const at = cut.lastIndexOf(" ");
  return `${cut.slice(0, at > 12 ? at : INDEX_TITLE_MAX)}...`;
};

/** The persistent chapter index, drawn for the whole video (it hides itself where indexAt says). */
export const ChapterIndex: React.FC<{
  marks: ChapterMark[];
  endFrom?: number;
}> = ({ marks, endFrom }) => {
  const frame = useCurrentFrame();
  const { current, opacity } = indexAt(marks, frame, endFrom);
  if (current < 0 || opacity <= 0 || marks.length < 2) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE_X,
        top: 112,
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity,
        pointerEvents: "none",
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: 17,
        letterSpacing: 1.5,
        textShadow: "0 2px 10px rgba(0,0,0,0.8)",
      }}
    >
      {marks.map((m, i) => (
        <div
          key={i}
          style={{
            minWidth: 34,
            padding: "4px 6px",
            textAlign: "center",
            borderRadius: 5,
            color:
              i === current
                ? COLOUR.ink
                : i < current
                  ? "rgba(245,245,242,0.82)"
                  : "rgba(245,245,242,0.34)",
            background: i === current ? COLOUR.amber : "rgba(11,11,14,0.45)",
            textShadow: i === current ? "none" : undefined,
          }}
        >
          {String(m.number).padStart(2, "0")}
        </div>
      ))}
      <div
        style={{
          marginLeft: 8,
          color: "rgba(245,245,242,0.9)",
          fontSize: 18,
          letterSpacing: 2,
        }}
      >
        {shortTitle(marks[current]!.title)}
      </div>
    </div>
  );
};

/** The year in the corner, rolling digit by digit when the chapter's year changes. */
export const YearCounter: React.FC<{
  marks: ChapterMark[];
  endFrom?: number;
}> = ({ marks, endFrom }) => {
  const frame = useCurrentFrame();
  const y = yearAt(marks, frame, endFrom);
  if (!y) return null;
  // A ranking entry with no year shows its rank: "#07", two columns.
  const digits = odometerDigits(y.from, y.year, y.roll, y.prefix ? 2 : 4);
  return (
    <div
      style={{
        position: "absolute",
        right: SAFE_X,
        top: 100,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 14px 6px 12px",
        background: "rgba(11,11,14,0.55)",
        borderRadius: 8,
        borderLeft: `4px solid ${COLOUR.amber}`,
        opacity: y.opacity,
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex" }}>
        {y.prefix ? (
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 40,
              lineHeight: "56px",
              color: COLOUR.amber,
              marginRight: 4,
            }}
          >
            {y.prefix}
          </div>
        ) : null}
        {digits.map((d, i) => (
          <div
            key={i}
            style={{
              position: "relative",
              width: 30,
              height: 56,
              overflow: "hidden",
              fontFamily: DISPLAY,
              fontSize: 52,
              lineHeight: "56px",
              textAlign: "center",
              color: COLOUR.paper,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: `translateY(${-d.t * 100}%)`,
              }}
            >
              {d.out}
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: `translateY(${(1 - d.t) * 100}%)`,
              }}
            >
              {d.in}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** The recall card, rendered inside a Sequence of the cue's length. */
export const CallbackCue: React.FC<{
  text: string;
  len: number;
  /** The picture on screen when the question was raised; a clip is held on that frame. */
  media?: { src: string; clip: boolean; offset: number };
}> = ({ text, len, media }) => {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [0, 10], [0, 1], clamp);
  const out = interpolate(frame, [len - 10, len - 1], [1, 0], clamp);
  const ease = 1 - (1 - inP) ** 3;
  return (
    <div
      style={{
        position: "absolute",
        right: SAFE_X,
        top: 180,
        width: 380,
        opacity: ease * out,
        transform: `translateX(${(1 - ease) * 40}px)`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "inline-block",
          marginBottom: 8,
          padding: "4px 10px",
          background: COLOUR.amber,
          color: COLOUR.ink,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 16,
          letterSpacing: 3,
          borderRadius: 4,
        }}
      >
        EARLIER
      </div>
      {media ? (
        <div
          style={{
            width: 380,
            height: 214,
            overflow: "hidden",
            borderRadius: 6,
            border: "3px solid rgba(245,245,242,0.88)",
            boxShadow: "0 14px 40px rgba(0,0,0,0.6)",
            background: COLOUR.ink,
            filter: "saturate(0.55) brightness(0.92) sepia(0.15)",
          }}
        >
          {media.clip ? (
            <Freeze frame={media.offset}>
              <OffthreadVideo
                src={media.src}
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </Freeze>
          ) : (
            <Img
              src={media.src}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>
      ) : null}
      <div
        style={{
          marginTop: 10,
          padding: "8px 12px",
          background: "rgba(11,11,14,0.62)",
          borderRadius: 6,
          fontFamily: BODY,
          fontWeight: 700,
          fontSize: 22,
          lineHeight: 1.3,
          color: COLOUR.paper,
        }}
      >
        {displayText(text)}
      </div>
    </div>
  );
};
