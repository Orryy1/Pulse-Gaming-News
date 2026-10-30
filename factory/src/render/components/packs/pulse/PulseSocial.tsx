// Pulse universe, "PulseSocial": a quote that was posted, drawn as the post itself, only when its credit says it
// was said on social media, a forum, a blog or a newsgroup (./socialCredit.ts). By the story's year: to 1999 a
// grey "Pulse Groups" newsgroup reader whose message types out as the narrator reads it; 2000-2009 a "Pulse
// Boards" forum thread (banner, author column with avatar block, the post, Quote and Reply buttons) in the
// look of its years; from 2010 a "Pulse Social" feed post (initials avatar, display name, the year at most,
// action icons as shapes with no counts). A medium that names its own look wins over the year: a newsgroup is
// always the reader, a tweet always the feed, a forum post always the board. Every word comes from the graphic
// or is a fixed UI label; no @handles, no counts, no invented subject lines. The real medium is credited in the
// caption bottom left. Tagged ILLUSTRATION.
import React from "react";
import { Img, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import { MONO, clamp, easeOut, sizeByLength } from "../screen/common.ts";
import { PulseMark, storyYear } from "../screen/pulse.tsx";
import {
  creditLine,
  displayName,
  quoteCredit,
  quoteText,
  socialLook,
  type QuoteCredit,
} from "./socialCredit.ts";
import {
  Avatar,
  Bars,
  CreditCaption,
  Icon,
  IllustrationTag,
  ReadWords,
  litCount,
  type IconName,
} from "./socialKit.tsx";

type LookProps = {
  frame: number;
  /** The window or page arriving, 0-1. */
  enter: number;
  /** The post itself appearing, 0-1. */
  show: number;
  /** How far the narrator is through the quote, 0-1. */
  read: number;
  quote: string;
  words: string[];
  credit: QuoteCredit;
  y: number | undefined;
  variant: number;
  src?: string;
};

const WIN98 = "'MS Sans Serif', Tahoma, Arial, sans-serif";

/** To 1999: a three-pane newsgroup reader in grey bevelled chrome; the message types out as it is read. */
const GroupsLook: React.FC<LookProps> = ({
  frame,
  enter,
  show,
  read,
  quote,
  credit,
}) => {
  const W = 1500;
  const H = 900;
  const chars = Math.round(read * quote.length);
  const typing = chars < quote.length;
  const picked = frame >= 22;
  const name = displayName(credit.speaker);
  const bevelOut = "2px outset #f2f2f2";
  const bevelIn = "2px inset #e0e0e0";
  return (
    <div
      style={{
        position: "absolute",
        left: 960 - W / 2,
        top: 70 + (1 - enter) * 300,
        width: W,
        height: H,
        background: "#c0c0c0",
        border: "3px outset #e8e8e8",
        boxShadow: "0 40px 110px rgba(0,0,0,0.6)",
        opacity: enter,
        fontFamily: WIN98,
        color: "#111",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 10px",
          color: "#fff",
          fontSize: 20,
          fontWeight: 700,
          background: "linear-gradient(90deg,#000080,#1084d0)",
        }}
      >
        <PulseMark size={24} colour="#fff" />
        Pulse Groups
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {["_", "□", "x"].map((c) => (
            <span
              key={c}
              style={{
                width: 28,
                height: 26,
                background: "#c0c0c0",
                border: bevelOut,
                color: "#111",
                fontSize: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {c}
            </span>
          ))}
        </span>
      </div>
      <div
        style={{
          height: 32,
          display: "flex",
          gap: 22,
          alignItems: "center",
          padding: "0 14px",
          fontSize: 18,
        }}
      >
        {["File", "Edit", "View", "Go", "Message", "Tools", "Help"].map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
      <div
        style={{
          height: 76,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 10px",
          borderTop: "2px groove #fff",
        }}
      >
        {(
          [
            ["pencil", "New Post"],
            ["reply", "Reply"],
            ["forward", "Forward"],
            ["print", "Print"],
          ] as Array<[IconName, string]>
        ).map(([n, label]) => (
          <div
            key={label}
            style={{
              width: 96,
              height: 66,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              fontSize: 15,
              border: bevelOut,
            }}
          >
            <Icon name={n} size={28} colour="#1d3f8a" width={2.6} />
            {label}
          </div>
        ))}
        {/* The throbber: the mark spins while the group's messages come down the line. */}
        <div
          style={{
            marginLeft: "auto",
            width: 76,
            height: 66,
            background: "#000",
            border: bevelIn,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PulseMark
            size={54}
            spin={frame < 30 ? frame * 8 : 0}
            beat={frame < 30 ? (frame % 20) / 20 : undefined}
          />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 154,
          left: 8,
          right: 8,
          bottom: 36,
          display: "flex",
          gap: 6,
        }}
      >
        {/* Folders: our own labels, and bars for group names the graphic does not give. */}
        <div
          style={{
            width: 300,
            background: "#fff",
            border: bevelIn,
            padding: "14px 12px",
            fontSize: 21,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 700,
            }}
          >
            <PulseMark size={22} colour="#000080" />
            Pulse Groups
          </div>
          {["Newsgroups", "", "", "", "Outbox", "Sent Items"].map(
            (label, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 12,
                  marginLeft: label ? 22 : 48,
                  padding: "2px 4px",
                  background: i === 0 ? "#000080" : "transparent",
                  color: i === 0 ? "#fff" : "#111",
                }}
              >
                <Icon
                  name="folder"
                  size={22}
                  colour={i === 0 ? "#fff" : "#8a6d1a"}
                />
                {label || (
                  <div
                    style={{
                      width: 120 - i * 14,
                      height: 12,
                      background: "#cfcfcf",
                    }}
                  />
                )}
              </div>
            ),
          )}
        </div>
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}
        >
          {/* The message list: one row is this post (its author and year); the others are bars. */}
          <div
            style={{
              height: 236,
              background: "#fff",
              border: bevelIn,
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", fontSize: 18 }}>
              {[
                ["Subject", 520],
                ["From", 380],
                ["Sent", 0],
              ].map(([label, w]) => (
                <div
                  key={label}
                  style={{
                    width: w || undefined,
                    flex: w ? undefined : 1,
                    padding: "3px 10px",
                    background: "#c0c0c0",
                    border: bevelOut,
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
            {[0, 1, 2, 3, 4].map((i) => {
              const me = i === 2;
              const on = me && picked;
              const bar = (w: number) => (
                <div
                  style={{
                    width: w,
                    height: 12,
                    background: on ? "rgba(255,255,255,0.7)" : "#d4d4d4",
                  }}
                />
              );
              return (
                <div
                  key={i}
                  style={{
                    height: 38,
                    display: "flex",
                    alignItems: "center",
                    background: on ? "#000080" : "transparent",
                    color: on ? "#fff" : "#111",
                    fontSize: 22,
                    fontWeight: me ? 700 : 400,
                  }}
                >
                  <div style={{ width: 520, padding: "0 12px" }}>
                    {bar(me ? 300 : 220 + ((i * 53) % 160))}
                  </div>
                  <div
                    style={{
                      width: 380,
                      padding: "0 12px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                    }}
                  >
                    {me ? name : bar(140 + ((i * 31) % 90))}
                  </div>
                  <div style={{ flex: 1, padding: "0 12px" }}>
                    {me ? (credit.year ?? "") : bar(70)}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              flex: 1,
              background: "#fff",
              border: bevelIn,
              overflow: "hidden",
              opacity: show,
            }}
          >
            <div
              style={{
                background: "#e4e4e4",
                borderBottom: "1px solid #a0a0a0",
                padding: "12px 18px",
                fontSize: 24,
                lineHeight: 1.45,
              }}
            >
              <div>
                <b>From:</b> {name}
              </div>
              {credit.year && (
                <div>
                  <b>Date:</b> {credit.year}
                </div>
              )}
            </div>
            <div
              style={{
                padding: "18px 22px",
                fontFamily: MONO,
                fontSize: 30,
                lineHeight: 1.42,
                whiteSpace: "pre-wrap",
                color: "#111",
              }}
            >
              {quote.slice(0, chars)}
              {typing && (
                <span
                  style={{
                    background: frame % 20 < 10 ? "#111" : "transparent",
                    marginLeft: 2,
                  }}
                >
                  {" "}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 30,
          borderTop: "2px groove #fff",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          fontSize: 17,
        }}
      >
        {frame < 30
          ? "Downloading headers..."
          : typing
            ? "Opening message..."
            : "Done"}
      </div>
    </div>
  );
};

/** A forum's skin by year: navy and grey tables to 2004, glossy blue 2005-2011, flat and airy after. */
type BoardSkin = "classic" | "web2" | "flat";

const BOARD: Record<
  BoardSkin,
  {
    font: string;
    banner: string;
    nav: string;
    head: string;
    strip: string;
    author: string;
    body: string;
    line: string;
    link: string;
    mark: string;
    radius: number;
  }
> = {
  classic: {
    font: "Verdana, Tahoma, Arial, sans-serif",
    banner: "linear-gradient(90deg,#0b1a33,#1d3b6b)",
    nav: "#c9d2de",
    head: "linear-gradient(#3d5b8c,#203a66)",
    strip: "#b9c6d8",
    author: "#dfe4ec",
    body: "#eef1f6",
    line: "#5a6f8f",
    link: "#1a3d7c",
    mark: "rgba(255,226,64,0.85)",
    radius: 0,
  },
  web2: {
    font: "'Trebuchet MS', Tahoma, Verdana, sans-serif",
    banner: "linear-gradient(#4a86cf,#24508f)",
    nav: "linear-gradient(#f4f8fd,#d7e4f4)",
    head: "linear-gradient(#6fa0dc,#3d6fb0 50%,#2d5f9e)",
    strip: "#e1ebf7",
    author: "#f1f5fb",
    body: "#ffffff",
    line: "#9ab3d6",
    link: "#1f5aa8",
    mark: "rgba(255,226,64,0.85)",
    radius: 10,
  },
  flat: {
    font: BODY,
    banner: "linear-gradient(90deg,#14161c,#262a33)",
    nav: "#f3f4f6",
    head: "#2a2e37",
    strip: "#f7f7f9",
    author: "#ffffff",
    body: "#ffffff",
    line: "#e1e3e8",
    link: "#c4501a",
    mark: "rgba(255,107,26,0.28)",
    radius: 14,
  },
};

/** 2000-2009 (or any forum): a Pulse Boards thread with the post as its first message, highlighted as read. */
const BoardsLook: React.FC<LookProps> = ({
  frame,
  enter,
  show,
  read,
  quote,
  words,
  credit,
  y,
  variant,
  src,
}) => {
  const W = 1500;
  const H = 900;
  const skin: BoardSkin =
    (y ?? 2005) <= 2004 ? "classic" : (y ?? 2005) <= 2011 ? "web2" : "flat";
  const S = BOARD[skin];
  const load = interpolate(frame, [6, 28], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const size = sizeByLength(quote.length, [
    [120, 40],
    [240, 34],
    [999, 30],
  ]);
  const lit = litCount(words.length, read);
  const tile = ["#3d6fb0", "#7a4bb0", "#2f8a6a", "#b0652f"][variant % 4]!;
  const button = (label: string) => (
    <div
      key={label}
      style={{
        padding: "6px 18px",
        fontSize: 22,
        fontWeight: 700,
        color: skin === "flat" ? S.link : "#1b2b45",
        background:
          skin === "classic"
            ? "#d4d0c8"
            : skin === "web2"
              ? "linear-gradient(#ffffff,#d6e2f2)"
              : "transparent",
        border:
          skin === "classic"
            ? "2px outset #f0f0f0"
            : `1px solid ${skin === "web2" ? "#8ea9cf" : S.link}`,
        borderRadius: skin === "classic" ? 0 : skin === "web2" ? 6 : 20,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Icon
        name={label === "Quote" ? "reply" : "pencil"}
        size={22}
        colour={skin === "flat" ? S.link : "#1b2b45"}
      />
      {label}
    </div>
  );
  return (
    <div
      style={{
        position: "absolute",
        left: 960 - W / 2,
        top: 70 + (1 - enter) * 300,
        width: W,
        height: H,
        background: skin === "flat" ? "#fff" : "#f4f4f4",
        borderRadius: S.radius,
        border: skin === "flat" ? "none" : `2px solid ${S.line}`,
        boxShadow: "0 40px 110px rgba(0,0,0,0.6)",
        overflow: "hidden",
        opacity: enter,
        fontFamily: S.font,
      }}
    >
      <div
        style={{
          clipPath: `inset(0 0 ${(1 - load) * 100}% 0)`,
          height: "100%",
        }}
      >
        {/* The board's banner: the game's picture behind the Pulse Boards name, as forums of the time had. */}
        <div
          style={{
            position: "relative",
            height: 150,
            background: S.banner,
            overflow: "hidden",
          }}
        >
          {src && (
            <Img
              src={src}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.55,
                filter: skin === "classic" ? "saturate(0.7)" : undefined,
              }}
            />
          )}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg,rgba(0,0,0,0.75),rgba(0,0,0,0.15) 70%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 40,
              top: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              gap: 20,
              color: "#fff",
              fontSize: 58,
              fontWeight: 800,
              fontStyle: skin === "flat" ? "normal" : "italic",
              letterSpacing: skin === "flat" ? -1 : 0,
              textShadow: "2px 3px 0 rgba(0,0,0,0.5)",
            }}
          >
            <PulseMark size={78} colour={COLOUR.amber} />
            Pulse Boards
          </div>
        </div>
        <div
          style={{
            height: 52,
            display: "flex",
            alignItems: "center",
            gap: 34,
            padding: "0 40px",
            background: S.nav,
            borderBottom: `1px solid ${S.line}`,
            fontSize: 22,
            fontWeight: 700,
            color: S.link,
          }}
        >
          {["Home", "Forums", "Search", "Members", "Help"].map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
        <div style={{ padding: "14px 40px", fontSize: 22, color: "#555" }}>
          <span style={{ color: S.link, fontWeight: 700 }}>Pulse Boards</span>
          {"  >  "}
          <span style={{ color: S.link, fontWeight: 700 }}>Forums</span>
          {"  >  Thread"}
        </div>
        <div
          style={{
            margin: "0 30px",
            border: `1px solid ${S.line}`,
            borderRadius: skin === "classic" ? 0 : S.radius / 2,
            overflow: "hidden",
            opacity: show,
            transform: `translateY(${(1 - show) * 30}px)`,
          }}
        >
          <div
            style={{
              height: 46,
              display: "flex",
              alignItems: "center",
              background: S.head,
              color: "#fff",
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            <div style={{ width: 300, padding: "0 20px" }}>Author</div>
            <div style={{ padding: "0 26px" }}>Message</div>
          </div>
          <div
            style={{
              height: 42,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 20px",
              background: S.strip,
              borderBottom: `1px solid ${S.line}`,
              color: "#333",
              fontSize: 22,
            }}
          >
            <Icon name="draft" size={22} colour="#555" />
            {credit.year ? `Posted ${credit.year}` : "Posted"}
          </div>
          <div style={{ display: "flex", minHeight: 420 }}>
            <div
              style={{
                width: 300,
                padding: "24px 20px",
                background: S.author,
                borderRight: `1px solid ${S.line}`,
              }}
            >
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: S.link,
                  lineHeight: 1.15,
                }}
              >
                {displayName(credit.speaker)}
              </div>
              {/* A rank bar as a shape: never a post count or a title. */}
              <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
                <div
                  style={{
                    width: 70,
                    height: 8,
                    borderRadius: 4,
                    background: COLOUR.amber,
                  }}
                />
                <div
                  style={{
                    width: 50,
                    height: 8,
                    borderRadius: 4,
                    background: "#c4c9d2",
                  }}
                />
              </div>
              <div style={{ marginTop: 20 }}>
                <Avatar
                  speaker={credit.speaker}
                  size={150}
                  colour={tile}
                  radius={skin === "classic" ? 0 : skin === "web2" ? 10 : "50%"}
                  font={S.font}
                />
              </div>
            </div>
            <div
              style={{
                flex: 1,
                padding: "28px 34px",
                background: S.body,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{ fontSize: size, lineHeight: 1.42, color: "#151515" }}
              >
                <ReadWords
                  words={words}
                  lit={lit}
                  on={{
                    background: S.mark,
                    boxShadow: `0 0 0 3px ${S.mark}`,
                    borderRadius: 3,
                  }}
                />
              </div>
              {/* The signature rule and a bar for a signature the graphic does not give. */}
              <div
                style={{
                  marginTop: 26,
                  width: 180,
                  height: 2,
                  background: "#b9bec8",
                }}
              />
              <div style={{ marginTop: 14 }}>
                <Bars
                  widths={[320]}
                  height={12}
                  colour="#dde0e6"
                  radius={skin === "classic" ? 0 : 6}
                />
              </div>
              <div
                style={{
                  marginTop: "auto",
                  paddingTop: 20,
                  display: "flex",
                  gap: 12,
                  justifyContent: "flex-end",
                }}
              >
                {button("Quote")}
                {button("Reply")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** 2010 on: a Pulse Social feed with this post in the middle, its words lighting up as they are read. */
const FeedLook: React.FC<LookProps> = ({
  frame,
  enter,
  show,
  read,
  quote,
  words,
  credit,
  y,
  variant,
}) => {
  const W = 1200;
  const H = 900;
  const dark = variant % 2 === 1;
  // Early feeds (to 2015) had a solid brand bar and squarer avatars; later ones are plain and round.
  const early = (y ?? 2016) <= 2015;
  const C = dark
    ? {
        page: "#0d0f14",
        card: "#161a21",
        line: "#262b34",
        ink: "#eef0f2",
        sub: "#8b93a1",
        bar: "#2a303a",
      }
    : {
        page: "#eef0f3",
        card: "#ffffff",
        line: "#e1e4e8",
        ink: "#0f1419",
        sub: "#66707c",
        bar: "#e3e6ea",
      };
  const size = sizeByLength(quote.length, [
    [90, 50],
    [170, 44],
    [260, 38],
    [999, 34],
  ]);
  const lit = litCount(words.length, read);
  const tile = ["#e0602a", "#3c6fd8", "#7b55c9", "#23926d"][variant % 4]!;
  const glow = interpolate(frame, [26, 60], [1, 0], clamp);
  const ghost = (key: string, top?: boolean) => (
    <div
      key={key}
      style={{
        height: 170,
        flexShrink: 0,
        marginTop: top ? -70 : 0,
        display: "flex",
        gap: 24,
        padding: "30px 40px",
        background: C.card,
        borderRadius: early ? 10 : 24,
        border: `1px solid ${C.line}`,
        opacity: 0.55,
      }}
    >
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: early ? 12 : "50%",
          background: C.bar,
        }}
      />
      <Bars
        widths={[260, 640, 520]}
        height={16}
        gap={18}
        colour={C.bar}
        radius={8}
      />
    </div>
  );
  return (
    <div
      style={{
        position: "absolute",
        left: 960 - W / 2,
        top: 70 + (1 - enter) * 300,
        width: W,
        height: H,
        borderRadius: 28,
        background: C.page,
        boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
        overflow: "hidden",
        opacity: enter,
        fontFamily: BODY,
      }}
    >
      <div
        style={{
          height: 96,
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 40px",
          background: early ? COLOUR.amber : C.card,
          borderBottom: `1px solid ${early ? "transparent" : C.line}`,
          position: "relative",
          zIndex: 2,
        }}
      >
        <PulseMark size={52} colour={early ? "#fff" : COLOUR.amber} />
        <span
          style={{
            fontSize: 34,
            fontWeight: 800,
            color: early ? "#fff" : C.ink,
          }}
        >
          Pulse Social
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 30 }}>
          {(["search", "bell", "user"] as const).map((n) => (
            <Icon key={n} name={n} size={36} colour={early ? "#fff" : C.sub} />
          ))}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 22,
          padding: "0 110px",
        }}
      >
        {ghost("above", true)}
        <div
          style={{
            flexShrink: 0,
            padding: "34px 44px 30px",
            background: C.card,
            borderRadius: early ? 10 : 24,
            border: `1px solid ${C.line}`,
            boxShadow: `0 0 0 ${4 * glow}px rgba(255,107,26,${0.8 * glow}), 0 18px 40px rgba(0,0,0,${dark ? 0.4 : 0.1})`,
            opacity: show,
            transform: `scale(${0.94 + 0.06 * show}) translateY(${(1 - show) * 40}px)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <Avatar
              speaker={credit.speaker}
              size={92}
              colour={tile}
              radius={early ? 14 : "50%"}
            />
            <div
              style={{
                fontSize: 36,
                fontWeight: 800,
                color: C.ink,
                lineHeight: 1.1,
              }}
            >
              {displayName(credit.speaker)}
              {credit.year && (
                <span
                  style={{ fontWeight: 600, color: C.sub, fontSize: 30 }}
                >{`  ·  ${credit.year}`}</span>
              )}
            </div>
            <span style={{ marginLeft: "auto" }}>
              <Icon name="dots" size={36} colour={C.sub} />
            </span>
          </div>
          <div
            style={{
              marginTop: 24,
              fontSize: size,
              lineHeight: 1.3,
              fontWeight: 600,
              color: C.ink,
            }}
          >
            <ReadWords
              words={words}
              lit={lit}
              on={{ opacity: 1 }}
              off={{ opacity: 0.32 }}
            />
          </div>
          <div
            style={{
              marginTop: 30,
              display: "flex",
              justifyContent: "space-between",
              width: "72%",
            }}
          >
            {(["reply", "repost", "heart", "share"] as const).map((n) => (
              <Icon key={n} name={n} size={38} colour={C.sub} />
            ))}
          </div>
        </div>
        {ghost("below")}
      </div>
    </div>
  );
};

export const PulseSocial: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
  src,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 300);
  const quote = quoteText(g.primary);
  if (!visible || !quote) return null;
  const credit = quoteCredit(g.secondary);
  const y = storyYear(g, year);
  const look = socialLook(y, credit);
  const words = quote.split(/\s+/).filter(Boolean);

  // The beats: the window rises 0-20, the post appears 14-34, the quote is read from 44 to near the end.
  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  });
  const show = spring({
    frame: frame - 14,
    fps,
    config: { damping: 15, stiffness: 150, mass: 0.8 },
  });
  const readFrom = 44;
  const readTo = Math.max(readFrom + 30, showFor - 24);
  const read = interpolate(frame, [readFrom, readTo], [0, 1], clamp);
  const props: LookProps = {
    frame,
    enter,
    show,
    read,
    quote,
    words,
    credit,
    y,
    variant,
    src,
  };

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={12}>
      {look === "groups" ? (
        <GroupsLook {...props} />
      ) : look === "boards" ? (
        <BoardsLook {...props} />
      ) : (
        <FeedLook {...props} />
      )}
      <CreditCaption line={creditLine(credit)} frame={frame} />
      <IllustrationTag frame={frame} />
    </Stage>
  );
};
