// Pulse universe, "PulseMail": a quote from an email, memo, letter or internal note, drawn as the message open
// in a Pulse Mail client, only when its credit names that medium (./socialCredit.ts). To 2004 a grey desktop
// client: title bar, menus, a toolbar of Reply, Forward, Print and Delete, a folder pane, the message list with
// this message picked, and the reading pane below. From 2005 a clean webmail: a Compose button and folders down
// the left, a search pill, the open message with the sender's initials. The From line is the speaker; the date
// is the year when the credit gives one; there is no recipient, and the subject is only "(internal)" when the
// credit says the message was internal. The body is the quote, highlighted as it is read. The real medium is
// credited in the caption bottom left. Tagged ILLUSTRATION.
import React from "react";
import { interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import { clamp, easeOut, sizeByLength } from "../screen/common.ts";
import { PulseMark, storyYear } from "../screen/pulse.tsx";
import {
  creditLine,
  displayName,
  mailLook,
  quoteCredit,
  quoteText,
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
  enter: number;
  /** The message opening in the reading pane, 0-1. */
  open: number;
  read: number;
  quote: string;
  words: string[];
  credit: QuoteCredit;
  subject: string;
  y: number | undefined;
  variant: number;
};

/** The subject line: a fixed label only when the credit says the message was internal, else none. */
export const mailSubject = (c: QuoteCredit) =>
  /\binternal\b/i.test(c.medium) ? "(internal)" : "";

const W = 1500;
const H = 900;

/** To 2004: the desktop client, grey and bevelled, a Windows 2000 era layout of panes. */
const DesktopLook: React.FC<LookProps> = ({
  frame,
  enter,
  open,
  read,
  quote,
  words,
  credit,
  subject,
  y,
}) => {
  // 2000-2004 clients went softer: a blue-grey title bar and flat buttons instead of the late 90s bevel.
  const late = (y ?? 2000) >= 2001;
  const tahoma = "Tahoma, Verdana, Arial, sans-serif";
  const bevelOut = late ? "1px solid #b8b4a4" : "2px outset #f2f2f2";
  const bevelIn = late ? "1px solid #7f9db9" : "2px inset #e0e0e0";
  const picked = frame >= 22;
  const size = sizeByLength(quote.length, [
    [140, 36],
    [280, 32],
    [999, 29],
  ]);
  const lit = litCount(words.length, read);
  const name = displayName(credit.speaker);
  return (
    <div
      style={{
        position: "absolute",
        left: 960 - W / 2,
        top: 70 + (1 - enter) * 300,
        width: W,
        height: H,
        background: late ? "#ece9d8" : "#c0c0c0",
        border: late ? "3px solid #2457c4" : "3px outset #e8e8e8",
        borderRadius: late ? "10px 10px 0 0" : 0,
        boxShadow: "0 40px 110px rgba(0,0,0,0.6)",
        overflow: "hidden",
        opacity: enter,
        fontFamily: tahoma,
        color: "#111",
      }}
    >
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 12px",
          color: "#fff",
          fontSize: 20,
          fontWeight: 700,
          background: late
            ? "linear-gradient(#3d8bf5,#0a5ae0 40%,#0848c4)"
            : "linear-gradient(90deg,#000080,#1084d0)",
        }}
      >
        <PulseMark size={24} colour="#fff" />
        Pulse Mail
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
        {["File", "Edit", "View", "Tools", "Message", "Help"].map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
      <div
        style={{
          height: 74,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          borderTop: late ? "1px solid #fff" : "2px groove #fff",
          borderBottom: late ? "1px solid #c8c4b0" : "none",
        }}
      >
        {(
          [
            ["pencil", "New"],
            ["reply", "Reply"],
            ["forward", "Forward"],
            ["print", "Print"],
            ["trash", "Delete"],
            ["send", "Send/Recv"],
          ] as Array<[IconName, string]>
        ).map(([n, label]) => (
          <div
            key={label}
            style={{
              width: 100,
              height: 64,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              fontSize: 16,
              border: late ? "1px solid transparent" : bevelOut,
            }}
          >
            <Icon
              name={n}
              size={28}
              colour={n === "trash" ? "#a03030" : "#1d3f8a"}
              width={2.4}
            />
            {label}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          top: 152,
          left: 8,
          right: 8,
          bottom: 36,
          display: "flex",
          gap: 6,
        }}
      >
        <div
          style={{
            width: 280,
            background: "#fff",
            border: bevelIn,
            padding: "14px 12px",
            fontSize: 22,
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
            <PulseMark size={22} colour="#1d3f8a" />
            Pulse Mail
          </div>
          {(
            [
              ["inbox", "Inbox"],
              ["send", "Outbox"],
              ["folder", "Sent Items"],
              ["trash", "Deleted Items"],
              ["draft", "Drafts"],
            ] as Array<[IconName, string]>
          ).map(([n, label], i) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 12,
                marginLeft: 22,
                padding: "2px 6px",
                background:
                  i === 0 ? (late ? "#316ac5" : "#000080") : "transparent",
                color: i === 0 ? "#fff" : "#111",
              }}
            >
              <Icon name={n} size={22} colour={i === 0 ? "#fff" : "#555"} />
              {label}
            </div>
          ))}
        </div>
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}
        >
          {/* The list: this message picked (its sender and year), bars for others the graphic does not give. */}
          <div
            style={{
              height: 196,
              background: "#fff",
              border: bevelIn,
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", fontSize: 18 }}>
              {[
                ["From", 380],
                ["Subject", 540],
                ["Received", 0],
              ].map(([label, w]) => (
                <div
                  key={label}
                  style={{
                    width: w || undefined,
                    flex: w ? undefined : 1,
                    padding: "3px 10px",
                    background: late
                      ? "linear-gradient(#fff,#ebeadb)"
                      : "#c0c0c0",
                    border: bevelOut,
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
            {[0, 1, 2, 3].map((i) => {
              const me = i === 1;
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
                    fontSize: 22,
                    fontWeight: me ? 700 : 400,
                    background: on
                      ? late
                        ? "#316ac5"
                        : "#000080"
                      : "transparent",
                    color: on ? "#fff" : "#111",
                  }}
                >
                  <div
                    style={{
                      width: 380,
                      padding: "0 12px",
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                    }}
                  >
                    <Icon
                      name="inbox"
                      size={20}
                      colour={on ? "#fff" : "#888"}
                    />
                    {me ? name : bar(150 + ((i * 41) % 80))}
                  </div>
                  <div style={{ width: 540, padding: "0 12px" }}>
                    {me && subject
                      ? subject
                      : bar(me ? 260 : 200 + ((i * 67) % 180))}
                  </div>
                  <div style={{ flex: 1, padding: "0 12px" }}>
                    {me ? (credit.year ?? "") : bar(80)}
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
              opacity: open,
            }}
          >
            <div
              style={{
                background: late
                  ? "linear-gradient(#f6f5ee,#e7e4d4)"
                  : "#e4e4e4",
                borderBottom: "1px solid #a0a0a0",
                padding: "12px 20px",
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
              {subject && (
                <div>
                  <b>Subject:</b> {subject}
                </div>
              )}
            </div>
            <div
              style={{
                padding: "22px 26px",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: size,
                lineHeight: 1.45,
                color: "#111",
              }}
            >
              <ReadWords
                words={words}
                lit={lit}
                on={{ background: "rgba(255,230,0,0.75)" }}
              />
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
          borderTop: late ? "1px solid #c8c4b0" : "2px groove #fff",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          fontSize: 17,
        }}
      >
        {frame < 22 ? "Checking for new messages..." : "Working Online"}
      </div>
    </div>
  );
};

/** 2005 on: a clean webmail, the message open beside the folder rail; light by default, dark on odd variants. */
const WebmailLook: React.FC<LookProps> = ({
  frame,
  enter,
  open,
  read,
  quote,
  words,
  credit,
  subject,
  y,
  variant,
}) => {
  const dark = variant % 2 === 1;
  // Through 2012 webmail kept a coloured header bar and boxed panes; later it went flat and rounded.
  const early = (y ?? 2016) <= 2012;
  const C = dark
    ? {
        page: "#111317",
        pane: "#1b1e24",
        line: "#2b2f37",
        ink: "#eceef1",
        sub: "#9097a3",
        rail: "#111317",
        pick: "#3a2a20",
        bar: "#2d323b",
      }
    : {
        page: "#f3f4f7",
        pane: "#ffffff",
        line: "#e2e4e9",
        ink: "#16181d",
        sub: "#6a7180",
        rail: "#f3f4f7",
        pick: "#fde7da",
        bar: "#e4e6eb",
      };
  const size = sizeByLength(quote.length, [
    [140, 40],
    [280, 34],
    [999, 30],
  ]);
  const lit = litCount(words.length, read);
  const tile = ["#e0602a", "#3c6fd8", "#7b55c9", "#23926d"][variant % 4]!;
  const radius = early ? 6 : 22;
  return (
    <div
      style={{
        position: "absolute",
        left: 960 - W / 2,
        top: 70 + (1 - enter) * 300,
        width: W,
        height: H,
        borderRadius: early ? 10 : 26,
        background: C.page,
        boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
        overflow: "hidden",
        opacity: enter,
        fontFamily: BODY,
        color: C.ink,
      }}
    >
      <div
        style={{
          height: 92,
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 34px",
          background: early ? (dark ? "#2a1a10" : COLOUR.amber) : C.page,
        }}
      >
        <PulseMark size={50} colour={early ? "#fff" : COLOUR.amber} />
        <span
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: early ? "#fff" : C.ink,
            width: 230,
          }}
        >
          Pulse Mail
        </span>
        <div
          style={{
            flex: 1,
            maxWidth: 720,
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 22px",
            borderRadius: early ? 4 : 28,
            background: early ? "#fff" : C.pane,
            border: `1px solid ${C.line}`,
            color: C.sub,
            fontSize: 24,
          }}
        >
          <Icon name="search" size={28} colour={C.sub} />
          Search mail
        </div>
        <span style={{ marginLeft: "auto" }}>
          <Icon name="user" size={38} colour={early ? "#fff" : C.sub} />
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 92,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
        }}
      >
        <div style={{ width: 300, padding: "18px 22px", background: C.rail }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              height: 64,
              padding: "0 24px",
              borderRadius: early ? 4 : 20,
              background: early
                ? dark
                  ? "#3b2a1e"
                  : "#ffe1cf"
                : dark
                  ? "#3b2a1e"
                  : "#ffe1cf",
              color: dark ? "#ffd0b5" : "#7a2f08",
              fontSize: 25,
              fontWeight: 800,
              width: "fit-content",
            }}
          >
            <Icon
              name="pencil"
              size={28}
              colour={dark ? "#ffd0b5" : "#7a2f08"}
            />
            Compose
          </div>
          {(
            [
              ["inbox", "Inbox"],
              ["star", "Starred"],
              ["send", "Sent"],
              ["draft", "Drafts"],
              ["trash", "Bin"],
            ] as Array<[IconName, string]>
          ).map(([n, label], i) => (
            <div
              key={label}
              style={{
                marginTop: i ? 6 : 22,
                height: 50,
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "0 20px",
                borderRadius: early ? 4 : 25,
                background: i === 0 ? C.pick : "transparent",
                fontSize: 24,
                fontWeight: i === 0 ? 800 : 600,
                color: i === 0 ? (dark ? "#ffd0b5" : "#7a2f08") : C.sub,
              }}
            >
              <Icon
                name={n}
                size={26}
                colour={i === 0 ? (dark ? "#ffd0b5" : "#7a2f08") : C.sub}
              />
              {label}
            </div>
          ))}
        </div>
        <div
          style={{
            flex: 1,
            padding: "18px 26px 26px 6px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Before the message opens: the inbox row with this sender, bars for the rest. */}
          <div
            style={{
              position: "relative",
              flex: 1,
              background: C.pane,
              borderRadius: radius,
              border: `1px solid ${C.line}`,
              overflow: "hidden",
            }}
          >
            <div style={{ position: "absolute", inset: 0, opacity: 1 - open }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 74,
                    display: "flex",
                    alignItems: "center",
                    gap: 24,
                    padding: "0 30px",
                    borderBottom: `1px solid ${C.line}`,
                    background: i === 0 && frame >= 22 ? C.pick : "transparent",
                    fontSize: 25,
                    fontWeight: i === 0 ? 800 : 400,
                  }}
                >
                  <Icon name="star" size={24} colour={C.bar} />
                  {i === 0 ? (
                    <span
                      style={{
                        width: 340,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                      }}
                    >
                      {displayName(credit.speaker)}
                    </span>
                  ) : (
                    <div style={{ width: 340 }}>
                      <div
                        style={{
                          width: 160 + ((i * 47) % 120),
                          height: 14,
                          borderRadius: 7,
                          background: C.bar,
                        }}
                      />
                    </div>
                  )}
                  <div
                    style={{
                      width: 300 + ((i * 89) % 240),
                      height: 14,
                      borderRadius: 7,
                      background: C.bar,
                    }}
                  />
                  <span
                    style={{ marginLeft: "auto", color: C.sub, fontSize: 22 }}
                  >
                    {i === 0 ? (credit.year ?? "") : ""}
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                padding: "34px 44px",
                opacity: open,
                transform: `translateX(${(1 - open) * 60}px)`,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  color: C.sub,
                }}
              >
                <Icon name="back" size={30} colour={C.sub} width={2.6} />
                <Icon name="trash" size={28} colour={C.sub} />
                <Icon name="folder" size={28} colour={C.sub} />
              </div>
              {subject && (
                <div style={{ marginTop: 24, fontSize: 38, fontWeight: 800 }}>
                  {subject}
                </div>
              )}
              <div
                style={{
                  marginTop: 26,
                  display: "flex",
                  alignItems: "center",
                  gap: 20,
                }}
              >
                <Avatar
                  speaker={credit.speaker}
                  size={76}
                  colour={tile}
                  radius={early ? 8 : "50%"}
                />
                <div style={{ fontSize: 30, fontWeight: 800 }}>
                  {displayName(credit.speaker)}
                </div>
                <span
                  style={{ marginLeft: "auto", fontSize: 24, color: C.sub }}
                >
                  {credit.year ?? ""}
                </span>
              </div>
              <div
                style={{
                  marginTop: 30,
                  fontSize: size,
                  lineHeight: 1.45,
                  fontWeight: 500,
                }}
              >
                <ReadWords
                  words={words}
                  lit={lit}
                  on={{
                    background: dark
                      ? "rgba(255,107,26,0.35)"
                      : "rgba(255,190,60,0.55)",
                    boxShadow: `0 0 0 3px ${dark ? "rgba(255,107,26,0.35)" : "rgba(255,190,60,0.55)"}`,
                    borderRadius: 4,
                  }}
                />
              </div>
              <div style={{ marginTop: "auto", display: "flex", gap: 16 }}>
                {(
                  [
                    ["reply", "Reply"],
                    ["forward", "Forward"],
                  ] as Array<[IconName, string]>
                ).map(([n, label]) => (
                  <div
                    key={label}
                    style={{
                      height: 54,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "0 26px",
                      borderRadius: early ? 4 : 27,
                      border: `1px solid ${C.line}`,
                      fontSize: 24,
                      fontWeight: 700,
                      color: C.sub,
                    }}
                  >
                    <Icon name={n} size={26} colour={C.sub} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PulseMail: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 300);
  const quote = quoteText(g.primary);
  if (!visible || !quote) return null;
  const credit = quoteCredit(g.secondary);
  const y = storyYear(g, year);
  const words = quote.split(/\s+/).filter(Boolean);

  // The beats: the window rises 0-20, the message is picked at 22 and opens 26-42, then read from 48.
  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  });
  const open = interpolate(frame, [26, 42], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const readFrom = 48;
  const readTo = Math.max(readFrom + 30, showFor - 24);
  const read = interpolate(frame, [readFrom, readTo], [0, 1], clamp);
  const props: LookProps = {
    frame,
    enter,
    open,
    read,
    quote,
    words,
    credit,
    subject: mailSubject(credit),
    y,
    variant,
  };

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={12}>
      {mailLook(y) === "desktop" ? (
        <DesktopLook {...props} />
      ) : (
        <WebmailLook {...props} />
      )}
      <CreditCaption line={creditLine(credit)} frame={frame} />
      <IllustrationTag frame={frame} />
    </Stage>
  );
};
