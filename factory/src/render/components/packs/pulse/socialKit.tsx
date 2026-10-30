// Shared pieces of the "said where" quote styles (./social.ts): the ILLUSTRATION tag and the credit caption
// under every one, the read-along word highlight, initials avatars and the app glyphs drawn as plain shapes.
import React from "react";
import { interpolate } from "remotion";
import { BODY } from "../../fonts.ts";
import { clamp } from "../screen/common.ts";
import { anonymous, initialsOf } from "./socialCredit.ts";

/** The honest-framing tag, bottom right, exactly as PhoneStory has it. */
export const IllustrationTag: React.FC<{ frame: number; from?: number }> = ({
  frame,
  from = 30,
}) => (
  <div
    style={{
      position: "absolute",
      right: 60,
      bottom: 48,
      color: "rgba(255,255,255,0.7)",
      fontFamily: BODY,
      fontSize: 20,
      letterSpacing: 3,
      opacity: interpolate(frame, [from, from + 10], [0, 1], clamp),
    }}
  >
    ILLUSTRATION
  </div>
);

/**
 * Who said it, where and when, as plain text bottom left: the real medium's name is credited here, while the
 * app on screen stays a Pulse one.
 */
export const CreditCaption: React.FC<{
  line: string;
  frame: number;
  from?: number;
}> = ({ line, frame, from = 24 }) =>
  line ? (
    <div
      style={{
        position: "absolute",
        left: 60,
        bottom: 42,
        maxWidth: 1420,
        display: "flex",
        alignItems: "center",
        gap: 14,
        color: "rgba(255,255,255,0.9)",
        fontFamily: BODY,
        fontSize: 28,
        fontWeight: 600,
        opacity: interpolate(frame, [from, from + 12], [0, 1], clamp),
        transform: `translateY(${interpolate(frame, [from, from + 12], [10, 0], clamp)}px)`,
      }}
    >
      <div
        style={{ width: 6, height: 30, borderRadius: 3, background: "#FF6B1A" }}
      />
      {line}
    </div>
  ) : null;

/** How many of a quote's words are lit `read` (0-1) of the way through. */
export const litCount = (words: number, read: number) =>
  Math.floor(read * (words + 1));

/**
 * The quote word for word, each word switching from its resting look to its read look as the narrator reaches
 * it (a marker highlight, or grey to ink).
 */
export const ReadWords: React.FC<{
  words: string[];
  lit: number;
  on: React.CSSProperties;
  off?: React.CSSProperties;
}> = ({ words, lit, on, off }) => (
  <>
    {words.map((w, i) => (
      <span key={i} style={i < lit ? on : off}>
        {w}{" "}
      </span>
    ))}
  </>
);

/** An avatar: the speaker's initials on a tile, or a head-and-shoulders silhouette for an unnamed one. */
export const Avatar: React.FC<{
  speaker: string;
  size: number;
  colour: string;
  ink?: string;
  radius?: number | string;
  font?: string;
}> = ({ speaker, size, colour, ink = "#fff", radius = "50%", font = BODY }) => (
  <div
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: radius,
      background: colour,
      color: ink,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      fontFamily: font,
      fontWeight: 800,
      fontSize: size * 0.4,
      letterSpacing: 1,
    }}
  >
    {anonymous(speaker) || !initialsOf(speaker) ? (
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx={50} cy={40} r={18} fill={ink} opacity={0.85} />
        <path
          d="M16 100 C18 72 34 62 50 62 C66 62 82 72 84 100 Z"
          fill={ink}
          opacity={0.85}
        />
      </svg>
    ) : (
      initialsOf(speaker)
    )}
  </div>
);

export type IconName =
  | "reply"
  | "repost"
  | "heart"
  | "share"
  | "inbox"
  | "send"
  | "star"
  | "trash"
  | "forward"
  | "print"
  | "draft"
  | "search"
  | "pencil"
  | "hash"
  | "smile"
  | "clip"
  | "back"
  | "dots"
  | "folder"
  | "bell"
  | "user";

/** App glyphs as plain stroked shapes on a 24 grid: no real product's icon. */
export const Icon: React.FC<{
  name: IconName;
  size: number;
  colour: string;
  width?: number;
}> = ({ name, size, colour, width = 2.2 }) => {
  const s = {
    stroke: colour,
    strokeWidth: width,
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  const d: Record<IconName, string> = {
    reply: "M4 5 H20 V16 H11 L6 20 V16 H4 Z",
    repost: "M5 10 V7 H17 M14 4 L17 7 L14 10 M19 14 V17 H7 M10 20 L7 17 L10 14",
    heart:
      "M12 20 C5 15 3 11 4.5 8 C6 5 10 5 12 8.5 C14 5 18 5 19.5 8 C21 11 19 15 12 20 Z",
    share: "M12 15 V4 M7.5 8.5 L12 4 L16.5 8.5 M5 13 V20 H19 V13",
    inbox: "M3 13 L6 5 H18 L21 13 V19 H3 Z M3 13 H8 L9.5 15.5 H14.5 L16 13 H21",
    send: "M3 11 L21 4 L15 20 L11.5 13 Z M11.5 13 L21 4",
    star: "M12 3 L14.6 9 L21 9.5 L16 13.7 L17.6 20 L12 16.6 L6.4 20 L8 13.7 L3 9.5 L9.4 9 Z",
    trash: "M4 7 H20 M9 7 V4 H15 V7 M6 7 L7 20 H17 L18 7",
    forward: "M14 5 L20 11 L14 17 M20 11 H9 C6 11 4 13 4 17",
    print: "M7 9 V3 H17 V9 M5 9 H19 V17 H5 Z M8 14 H16 V21 H8 Z",
    draft: "M6 3 H14 L19 8 V21 H6 Z M14 3 V8 H19",
    search: "M10.5 4 A6.5 6.5 0 1 1 10.4 4 M15.5 15.5 L21 21",
    pencil: "M4 20 L5 15 L16 4 L20 8 L9 19 Z M14 6 L18 10",
    hash: "M9 4 L7 20 M17 4 L15 20 M4 9 H20 M3 15 H19",
    smile:
      "M12 3 A9 9 0 1 1 11.9 3 M8 14 C9.5 16.5 14.5 16.5 16 14 M9 9.5 V10 M15 9.5 V10",
    clip: "M16 7 L8.5 14.5 A2 2 0 0 0 11.5 17.5 L19 10 A4 4 0 0 0 13 4 L5.5 11.5 A6 6 0 0 0 14 20 L20 14",
    back: "M15 5 L8 12 L15 19",
    dots: "M5 12 H5.1 M12 12 H12.1 M19 12 H19.1",
    folder: "M3 6 H10 L12 8 H21 V19 H3 Z",
    bell: "M6 16 V11 A6 6 0 0 1 18 11 V16 L20 18 H4 Z M10 21 H14",
    user: "M12 4 A4 4 0 1 1 11.9 4 M4 21 C4 15 20 15 20 21",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        d={d[name]}
        {...s}
        strokeWidth={name === "dots" ? width * 1.8 : width}
      />
    </svg>
  );
};

/** Grey bars standing in for text the graphic does not give (other rows, other posts). */
export const Bars: React.FC<{
  widths: number[];
  height?: number;
  gap?: number;
  colour?: string;
  radius?: number;
}> = ({ widths, height = 14, gap = 12, colour = "#d9d9de", radius = 7 }) => (
  <div style={{ display: "flex", flexDirection: "column", gap }}>
    {widths.map((w, i) => (
      <div
        key={i}
        style={{ width: w, height, borderRadius: radius, background: colour }}
      />
    ))}
  </div>
);
