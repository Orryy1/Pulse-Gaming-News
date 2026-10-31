// Pulse universe, "PulseChat": a quote from a chat, a text or a DM, drawn as one message from the speaker, only
// when its credit names that medium (./socialCredit.ts). To 2008 a desktop "Pulse Messenger": a buddy list
// beside a conversation window, "is typing a message..." in its status line, then "<speaker> says:" and the
// words (late 90s grey bevels, then the glossy blue of the 2000s); an IRC credit, or any chat to 1997, gets a
// "Pulse Relay" channel window instead, a black pane of lines. From 2009 a "Pulse Chat" team window (channels as
// bars, the message under the speaker's initials, a typing line under it first) or, for a text, DM or phone
// messenger, a Pulse OS handset with a typing bubble and then one incoming bubble. There are never replies,
// other people's names, channel names or counts: what the graphic does not give is a grey bar. The words light
// up as they are read; the real medium is credited in the caption bottom left. Tagged ILLUSTRATION.
import React from "react";
import { interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import { MONO, clamp, sizeByLength } from "../screen/common.ts";
import {
  PulseMark,
  phoneLook,
  storyYear,
  type PhoneGen,
} from "../screen/pulse.tsx";
import {
  chatLook,
  creditLine,
  displayName,
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
  pushIn,
  pushInAt,
  type IconName,
} from "./socialKit.tsx";

type LookProps = {
  frame: number;
  enter: number;
  /** The typing indicator, shown while 0 < typing < 1. */
  typing: number;
  /** The message arriving, 0-1. */
  arrive: number;
  read: number;
  /** The camera's push-in on the message once it has arrived, 0-1 (the team window is big enough without). */
  zoom: number;
  quote: string;
  words: string[];
  credit: QuoteCredit;
  y: number | undefined;
  variant: number;
};

/** Three dots bouncing in turn, the universal "is typing" sign. */
const TypingDots: React.FC<{ frame: number; colour: string; size: number }> = ({
  frame,
  colour,
  size,
}) => (
  <div
    style={{
      display: "flex",
      gap: size * 0.6,
      alignItems: "center",
      height: size * 2,
    }}
  >
    {[0, 1, 2].map((i) => {
      const t = ((frame - i * 5) % 24) / 24;
      const up = t < 0.5 ? Math.sin(t * 2 * Math.PI) : 0;
      return (
        <div
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: colour,
            opacity: 0.45 + 0.55 * Math.max(0, up),
            transform: `translateY(${-size * 0.5 * Math.max(0, up)}px)`,
          }}
        />
      );
    })}
  </div>
);

/**
 * To 1997, or any IRC credit: a channel window of lines; the speaker's line arrives and is read, and the camera
 * pushes in 1.6x on the bottom of the channel pane, so the 26 px mono type reads at about 42 px.
 */
const RelayLook: React.FC<LookProps> = ({
  frame,
  enter,
  arrive,
  read,
  zoom,
  words,
  credit,
}) => {
  const W = 1360;
  const H = 860;
  const left = 960 - W / 2;
  const top = 540 - H / 2;
  const lit = litCount(words.length, read);
  const name = displayName(credit.speaker);
  // The bottom 440 px of the channel pane (left of the 300 px nick list), where the line lands.
  const pane = { left: left + 8, top: top + 360, width: W - 322, height: 440 };
  return (
    <div style={pushIn(pane, 1.6, zoom)}>
      <div
        style={{
          position: "absolute",
          left,
          top: top + (1 - enter) * 300,
          width: W,
          height: H,
          background: "#c0c0c0",
          border: "3px outset #e8e8e8",
          boxShadow: "0 40px 110px rgba(0,0,0,0.6)",
          opacity: enter,
          overflow: "hidden",
          fontFamily: "'MS Sans Serif', Tahoma, Arial, sans-serif",
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
            background: "linear-gradient(90deg,#000080,#1084d0)",
          }}
        >
          <PulseMark size={24} colour="#fff" />
          Pulse Relay
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
          {["File", "View", "Commands", "Window", "Help"].map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            top: 78,
            left: 8,
            right: 8,
            bottom: 8,
            display: "flex",
            gap: 6,
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                flex: 1,
                background: "#000",
                border: "2px inset #e0e0e0",
                padding: "20px 24px",
                fontFamily: MONO,
                fontSize: 26,
                lineHeight: 1.45,
                color: "#c8c8c8",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                gap: 14,
              }}
            >
              {/* Earlier lines as dim bars: nobody else's words or names are invented. */}
              {[420, 760, 300, 620].map((w, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "center",
                    opacity: 0.6,
                  }}
                >
                  <div
                    style={{
                      width: 120 + ((i * 37) % 60),
                      height: 14,
                      background: "#3a6a8a",
                    }}
                  />
                  <div
                    style={{ width: w, height: 14, background: "#3a3a3a" }}
                  />
                </div>
              ))}
              <div style={{ opacity: arrive, minHeight: 44 }}>
                <span style={{ color: "#ffb347" }}>{`<${name}> `}</span>
                <ReadWords
                  words={words}
                  lit={lit}
                  on={{ color: "#ffffff" }}
                  off={{ color: "#7c7c7c" }}
                />
              </div>
            </div>
            <div
              style={{
                height: 46,
                background: "#fff",
                border: "2px inset #e0e0e0",
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
                fontFamily: MONO,
                fontSize: 26,
              }}
            >
              <span
                style={{ background: frame % 20 < 10 ? "#111" : "transparent" }}
              >
                {" "}
              </span>
            </div>
          </div>
          {/* The nick list: the speaker, then bars. */}
          <div
            style={{
              width: 300,
              background: "#fff",
              border: "2px inset #e0e0e0",
              padding: "14px 14px",
              fontSize: 24,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {name}
            </div>
            <div style={{ marginTop: 16 }}>
              <Bars
                widths={[180, 140, 210, 120, 170, 150]}
                height={13}
                gap={22}
                colour="#d0d0d0"
                radius={0}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * 1998-2008: the Pulse Messenger buddy list and a conversation window. Grey bevels to 2002, glossy blue after.
 * Once the message arrives the camera pushes in 1.5x on the conversation pane, so its 23-28 px type reads at
 * 35-42 px with the toolbar, the input box and the edge of the buddy list still in view.
 */
const MessengerLook: React.FC<LookProps> = ({
  frame,
  enter,
  typing,
  arrive,
  read,
  zoom,
  quote,
  words,
  credit,
  y,
}) => {
  const glossy = (y ?? 2004) >= 2003;
  const lit = litCount(words.length, read);
  const name = displayName(credit.speaker);
  const font = glossy
    ? "Tahoma, 'Segoe UI', Verdana, sans-serif"
    : "'MS Sans Serif', Tahoma, Arial, sans-serif";
  const size = sizeByLength(quote.length, [
    [100, 28],
    [180, 25],
    [999, 23],
  ]);
  // The conversation window's message pane: 12 px in from its sides, under the 120 px title and toolbar.
  const focus = { left: 647, top: 190, width: 1036, height: 524 };
  const frameStyle = (
    w: number,
    h: number,
    left: number,
    top: number,
    lift: number,
  ): React.CSSProperties => ({
    position: "absolute",
    left,
    top: top + (1 - lift) * 300,
    width: w,
    height: h,
    background: glossy ? "linear-gradient(#e9f1fb,#cfdff3)" : "#c0c0c0",
    border: glossy ? "1px solid #5b7fb5" : "3px outset #e8e8e8",
    borderRadius: glossy ? 12 : 0,
    boxShadow: "0 40px 110px rgba(0,0,0,0.6)",
    overflow: "hidden",
    opacity: lift,
    fontFamily: font,
    color: "#111",
  });
  const title = (label: string) => (
    <div
      style={{
        height: 42,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 14px",
        color: "#fff",
        fontSize: 20,
        fontWeight: 700,
        background: glossy
          ? "linear-gradient(#5d9cec,#2f6cc4 55%,#285ead)"
          : "linear-gradient(90deg,#000080,#1084d0)",
        textShadow: glossy ? "0 1px 0 rgba(0,0,0,0.35)" : "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <PulseMark size={24} colour="#fff" />
      {label}
    </div>
  );
  const pane: React.CSSProperties = {
    background: "#fff",
    border: glossy ? "1px solid #8fa9cf" : "2px inset #e0e0e0",
    borderRadius: glossy ? 6 : 0,
  };
  const dot = (c: string) => (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: c,
        boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.2)",
      }}
    />
  );
  const second = spring({
    frame: frame - 6,
    fps: 30,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  });
  return (
    <div style={pushIn(focus, 1.5, zoom)}>
      {/* The buddy list: the speaker online, bars for anyone else. */}
      <div style={frameStyle(380, 820, 225, 80, enter)}>
        {title("Pulse Messenger")}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "18px 16px",
          }}
        >
          <PulseMark size={64} colour={COLOUR.amber} />
          <Bars
            widths={[180, 120]}
            height={13}
            gap={12}
            colour={glossy ? "#b9cbe4" : "#a8a8a8"}
            radius={glossy ? 6 : 0}
          />
        </div>
        <div
          style={{
            ...pane,
            margin: "0 12px",
            height: 640,
            padding: "14px 14px",
            fontSize: 24,
          }}
        >
          <div style={{ fontWeight: 700, color: glossy ? "#1f4f99" : "#111" }}>
            {"▾ Online"}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 14,
              fontWeight: 700,
            }}
          >
            {dot("#3cb043")}
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {name}
            </span>
          </div>
          {[170, 130, 200].map((w, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 18,
              }}
            >
              {dot(i === 1 ? "#e0a020" : "#3cb043")}
              <div
                style={{
                  width: w,
                  height: 13,
                  borderRadius: glossy ? 6 : 0,
                  background: "#d4d8de",
                }}
              />
            </div>
          ))}
          <div
            style={{
              fontWeight: 700,
              color: glossy ? "#1f4f99" : "#111",
              marginTop: 30,
            }}
          >
            {"▾ Offline"}
          </div>
          {[150, 190].map((w, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 18,
              }}
            >
              {dot("#b0b0b0")}
              <div
                style={{
                  width: w,
                  height: 13,
                  borderRadius: glossy ? 6 : 0,
                  background: "#e2e4e8",
                }}
              />
            </div>
          ))}
        </div>
      </div>
      {/* The conversation window. */}
      <div style={frameStyle(1060, 840, 635, 70, second)}>
        {title(`${name} - Conversation`)}
        <div
          style={{
            height: 66,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 12px",
          }}
        >
          {(
            [
              ["user", "Invite"],
              ["clip", "Send Files"],
              ["smile", "Emotes"],
            ] as Array<[IconName, string]>
          ).map(([n, label]) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                fontSize: 20,
                border: glossy ? "1px solid transparent" : "2px outset #f0f0f0",
              }}
            >
              <Icon
                name={n}
                size={26}
                colour={glossy ? "#2f6cc4" : "#1d3f8a"}
              />
              {label}
            </div>
          ))}
        </div>
        <div
          style={{
            ...pane,
            position: "absolute",
            left: 12,
            right: 12,
            top: 120,
            bottom: 196,
            padding: "22px 26px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              opacity: arrive,
              transform: `translateY(${(1 - arrive) * 16}px)`,
            }}
          >
            <div style={{ fontSize: 24, color: "#666" }}>{`${name} says:`}</div>
            <div
              style={{
                marginTop: 8,
                marginLeft: 26,
                fontSize: size,
                lineHeight: 1.4,
                color: "#111",
              }}
            >
              <ReadWords
                words={words}
                lit={lit}
                on={{ opacity: 1 }}
                off={{ opacity: 0.35 }}
              />
            </div>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 160,
            height: 30,
            fontSize: 22,
            color: "#555",
            fontStyle: "italic",
            opacity: typing > 0 && typing < 1 ? 1 : 0,
          }}
        >
          {`${name} is typing a message...`}
        </div>
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: 14,
            height: 136,
            display: "flex",
            gap: 10,
          }}
        >
          <div
            style={{
              ...pane,
              flex: 1,
              padding: "14px 16px",
              fontFamily: MONO,
              fontSize: 26,
            }}
          >
            <span
              style={{ background: frame % 20 < 10 ? "#111" : "transparent" }}
            >
              {" "}
            </span>
          </div>
          <div
            style={{
              width: 130,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 700,
              background: glossy
                ? "linear-gradient(#ffffff,#d6e2f2)"
                : "#c0c0c0",
              border: glossy ? "1px solid #8fa9cf" : "2px outset #f0f0f0",
              borderRadius: glossy ? 8 : 0,
            }}
          >
            Send
          </div>
        </div>
      </div>
    </div>
  );
};

/** 2009 on: a Pulse Chat team window; dark on odd variants. */
const TeamLook: React.FC<LookProps> = ({
  frame,
  enter,
  typing,
  arrive,
  read,
  quote,
  words,
  credit,
  y,
  variant,
}) => {
  const W = 1500;
  const H = 880;
  const dark = variant % 2 === 1;
  const early = (y ?? 2018) <= 2015;
  const C = dark
    ? {
        main: "#1d2027",
        side: "#14161b",
        line: "#2c3038",
        ink: "#eceef1",
        sub: "#8e95a1",
        bar: "#2f343d",
        sideBar: "#2a2e36",
      }
    : {
        main: "#ffffff",
        side: "#1f2430",
        line: "#e4e6ea",
        ink: "#17191d",
        sub: "#6b7280",
        bar: "#e6e8ec",
        sideBar: "#3a4150",
      };
  const size = sizeByLength(quote.length, [
    [100, 40],
    [180, 36],
    [999, 32],
  ]);
  const lit = litCount(words.length, read);
  const tile = ["#e0602a", "#3c6fd8", "#7b55c9", "#23926d"][variant % 4]!;
  const name = displayName(credit.speaker);
  const sideRow = (w: number, on = false, glyph: IconName = "hash") => (
    <div
      style={{
        height: 46,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 16px",
        borderRadius: 8,
        background: on ? COLOUR.amber : "transparent",
      }}
    >
      <Icon name={glyph} size={22} colour={on ? "#fff" : "#8d94a3"} />
      <div
        style={{
          width: w,
          height: 12,
          borderRadius: 6,
          background: on ? "rgba(255,255,255,0.75)" : C.sideBar,
        }}
      />
    </div>
  );
  const ghost = (i: number) => (
    <div key={i} style={{ display: "flex", gap: 18, opacity: 0.6 }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 12,
          background: C.bar,
          flexShrink: 0,
        }}
      />
      <Bars
        widths={[180, 520 - i * 90]}
        height={14}
        gap={16}
        colour={C.bar}
        radius={7}
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
        borderRadius: early ? 8 : 22,
        background: C.main,
        boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
        overflow: "hidden",
        opacity: enter,
        fontFamily: BODY,
        color: C.ink,
        display: "flex",
      }}
    >
      <div
        style={{
          width: 310,
          background: C.side,
          padding: "22px 14px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 8px 22px",
          }}
        >
          <PulseMark
            size={52}
            tile={COLOUR.amber}
            colour={COLOUR.ink}
            radius={early ? 10 : 24}
          />
          <span style={{ color: "#fff", fontSize: 28, fontWeight: 800 }}>
            Pulse Chat
          </span>
        </div>
        <div
          style={{
            color: "#8d94a3",
            fontSize: 20,
            fontWeight: 700,
            padding: "10px 16px",
            letterSpacing: 1,
          }}
        >
          CHANNELS
        </div>
        {sideRow(150)}
        {sideRow(110, true)}
        {sideRow(170)}
        {sideRow(130)}
        <div
          style={{
            color: "#8d94a3",
            fontSize: 20,
            fontWeight: 700,
            padding: "26px 16px 10px",
            letterSpacing: 1,
          }}
        >
          DIRECT MESSAGES
        </div>
        {sideRow(140, false, "user")}
        {sideRow(160, false, "user")}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            height: 82,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 30px",
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          <Icon name="hash" size={30} colour={C.sub} width={2.6} />
          <div
            style={{
              width: 160,
              height: 16,
              borderRadius: 8,
              background: C.bar,
            }}
          />
          <span style={{ marginLeft: "auto", display: "flex", gap: 26 }}>
            <Icon name="search" size={30} colour={C.sub} />
            <Icon name="bell" size={30} colour={C.sub} />
          </span>
        </div>
        <div
          style={{
            flex: 1,
            padding: "26px 34px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            gap: 28,
            overflow: "hidden",
          }}
        >
          {[0, 1].map(ghost)}
          {/* The speaker's one message: initials, name and the year at most, then the words. */}
          <div
            style={{
              display: "flex",
              gap: 20,
              opacity: arrive,
              transform: `translateY(${(1 - arrive) * 24}px)`,
              padding: "18px 20px",
              margin: "0 -20px",
              borderRadius: 14,
              background: dark
                ? "rgba(255,107,26,0.08)"
                : "rgba(255,107,26,0.06)",
            }}
          >
            <Avatar
              speaker={credit.speaker}
              size={76}
              colour={tile}
              radius={early ? 8 : 16}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 30, fontWeight: 800 }}>
                {name}
                {credit.year && (
                  <span
                    style={{
                      marginLeft: 14,
                      fontSize: 24,
                      fontWeight: 600,
                      color: C.sub,
                    }}
                  >
                    {credit.year}
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: size,
                  lineHeight: 1.38,
                  fontWeight: 500,
                }}
              >
                <ReadWords
                  words={words}
                  lit={lit}
                  on={{ opacity: 1 }}
                  off={{ opacity: 0.32 }}
                />
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: "0 34px 26px" }}>
          <div
            style={{
              height: 36,
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 22,
              color: C.sub,
              opacity: typing > 0 && typing < 1 ? 1 : 0,
            }}
          >
            <TypingDots frame={frame} colour={C.sub} size={10} />
            {`${name} is typing...`}
          </div>
          <div
            style={{
              marginTop: 8,
              height: 70,
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "0 22px",
              borderRadius: early ? 6 : 16,
              border: `2px solid ${C.line}`,
              color: C.sub,
              fontSize: 25,
            }}
          >
            Message
            <span style={{ marginLeft: "auto", display: "flex", gap: 22 }}>
              <Icon name="clip" size={28} colour={C.sub} />
              <Icon name="smile" size={28} colour={C.sub} />
              <Icon name="send" size={28} colour={COLOUR.amber} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Handset geometry by generation, as PhoneStory draws Pulse OS phones (a little smaller here). */
const BODY_BY_GEN: Record<
  PhoneGen,
  {
    side: number;
    top: number;
    bottom: number;
    radius: number;
    screen: number;
    status: number;
  }
> = {
  classic: {
    side: 22,
    top: 100,
    bottom: 100,
    radius: 70,
    screen: 4,
    status: 32,
  },
  slim: { side: 16, top: 74, bottom: 74, radius: 62, screen: 8, status: 36 },
  edge: { side: 12, top: 12, bottom: 12, radius: 66, screen: 54, status: 52 },
};

/**
 * 2009 on, for texts and DMs: a Pulse OS phone, the speaker's thread, a typing bubble and then the message. As
 * the bubble lands the camera pushes in on the thread, from the speaker's name down to the message box: 1.7x
 * on the classic and slim phones, as far as fits on the taller edge-to-edge screen (1.4x), and the bubble's
 * type is raised so it reads at 40 px or more either way, with the bezels and the message box still in view.
 */
const PhoneLook: React.FC<LookProps> = ({
  frame,
  enter,
  typing,
  arrive,
  read,
  zoom,
  quote,
  words,
  credit,
  y,
  variant,
}) => {
  const W = 500;
  const H = 820;
  const left = 960 - W / 2;
  const top = 540 - H / 2;
  const { gen } = phoneLook(Math.max(y ?? 2016, 2009), variant);
  const b = BODY_BY_GEN[gen];
  // The thread from its header (status bar and name row) down to the 81 px message box.
  const pane = {
    left: left + b.side,
    top: top + b.top,
    width: W - b.side * 2,
    height: H - b.top - b.bottom - 81,
  };
  const push = Math.min(1.7, 1000 / pane.height);
  const dark = variant % 2 === 1;
  const classic = gen === "classic";
  const C = dark
    ? {
        screen: "#0e0f12",
        head: "#1a1b20",
        ink: "#f1f1f3",
        sub: "#9a9ca6",
        bubble: "#2a2b31",
        line: "#26272d",
      }
    : {
        screen: "#ffffff",
        head: classic ? "linear-gradient(#e6eaf1,#b3bfd0)" : "#f6f6f8",
        ink: "#111",
        sub: "#70737c",
        bubble: "#e9e9ee",
        line: "#e2e2e6",
      };
  // The bubble's type: by length, but never under 40 px once the camera has pushed in.
  const size = Math.max(
    Math.ceil(40 / push),
    sizeByLength(quote.length, [
      [70, 30],
      [150, 28],
      [999, 27],
    ]),
  );
  const lit = litCount(words.length, read);
  const tile = ["#e0602a", "#3c6fd8", "#7b55c9", "#23926d"][variant % 4]!;
  const name = displayName(credit.speaker);
  const bubble: React.CSSProperties = {
    alignSelf: "flex-start",
    maxWidth: "90%",
    padding: "14px 20px",
    borderRadius: 26,
    borderBottomLeftRadius: 8,
    background:
      classic && !dark ? "linear-gradient(#f4f4f7,#dcdce3)" : C.bubble,
    color: C.ink,
  };
  return (
    <div style={pushIn(pane, push, zoom)}>
      <div
        style={{
          position: "absolute",
          left,
          top: top + (1 - enter) * 360,
          width: W,
          height: H,
          borderRadius: b.radius,
          background: classic
            ? "linear-gradient(90deg,#1a1a1e,#2c2c32 50%,#1a1a1e)"
            : "#0d0d10",
          boxShadow: `0 40px 120px rgba(0,0,0,0.65), inset 0 0 0 ${classic ? 5 : 3}px ${classic ? "#8a8d94" : "#2a2a30"}`,
          transform: `rotate(${(variant % 2 ? 1 : -1) * 1.6 * (1 - enter)}deg)`,
          opacity: Math.min(1, enter * 1.5),
        }}
      >
        {gen !== "edge" && (
          <>
            <div
              style={{
                position: "absolute",
                left: W / 2 - 44,
                top: b.top / 2 - 5,
                width: 88,
                height: 10,
                borderRadius: 5,
                background: "#3a3a40",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: W / 2 - 32,
                top: H - b.bottom / 2 - 32,
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#141418",
                boxShadow: "inset 0 0 0 3px #3e3e46",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PulseMark size={30} colour="#55565e" />
            </div>
          </>
        )}
        <div
          style={{
            position: "absolute",
            left: b.side,
            top: b.top,
            right: b.side,
            bottom: b.bottom,
            borderRadius: b.screen,
            overflow: "hidden",
            background: C.screen,
            fontFamily: BODY,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Status bar and the thread's header: back, the speaker's initials and name. */}
          <div
            style={{
              background: C.head,
              borderBottom: `1px solid ${C.line}`,
              paddingTop: b.status,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                height: b.status,
                display: "flex",
                alignItems: gen === "edge" ? "flex-end" : "center",
                padding: gen === "edge" ? "0 30px 4px" : "0 14px",
                fontSize: 18,
                fontWeight: 700,
                color: C.ink,
              }}
            >
              9:41
              <span
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  gap: 6,
                  alignItems: "flex-end",
                }}
              >
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 5,
                      height: 5 + i * 4,
                      borderRadius: 1,
                      background: C.ink,
                    }}
                  />
                ))}
                <div
                  style={{
                    width: 30,
                    height: 14,
                    marginLeft: 6,
                    borderRadius: 4,
                    border: `2px solid ${C.ink}`,
                    padding: 2,
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      width: "70%",
                      height: "100%",
                      background: C.ink,
                      borderRadius: 1,
                    }}
                  />
                </div>
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 18px 16px",
              }}
            >
              <Icon
                name="back"
                size={30}
                colour={classic && !dark ? "#2a4f9a" : COLOUR.amber}
                width={2.8}
              />
              <Avatar speaker={credit.speaker} size={58} colour={tile} />
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: C.ink,
                  lineHeight: 1.1,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {name}
              </div>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              padding: "18px 18px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              gap: 14,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {credit.year && (
              <div
                style={{
                  alignSelf: "center",
                  fontSize: 20,
                  fontWeight: 600,
                  color: C.sub,
                  marginBottom: 6,
                }}
              >
                {credit.year}
              </div>
            )}
            {typing > 0 && typing < 1 && (
              <div
                style={{
                  ...bubble,
                  padding: "12px 22px",
                  transform: `scale(${Math.min(1, typing * 6)})`,
                  transformOrigin: "0 100%",
                }}
              >
                <TypingDots frame={frame} colour={C.sub} size={12} />
              </div>
            )}
            {arrive > 0 && (
              <div
                style={{
                  ...bubble,
                  fontSize: size,
                  lineHeight: 1.32,
                  fontWeight: 500,
                  transform: `scale(${0.6 + 0.4 * arrive})`,
                  transformOrigin: "0 100%",
                  opacity: Math.min(1, arrive * 2),
                }}
              >
                <ReadWords
                  words={words}
                  lit={lit}
                  on={{ opacity: 1 }}
                  off={{ opacity: 0.38 }}
                />
              </div>
            )}
          </div>
          <div
            style={{
              padding: "12px 16px 18px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              borderTop: `1px solid ${C.line}`,
            }}
          >
            <div
              style={{
                flex: 1,
                height: 50,
                borderRadius: 25,
                border: `2px solid ${C.line}`,
                display: "flex",
                alignItems: "center",
                padding: "0 18px",
                fontSize: 22,
                color: C.sub,
              }}
            >
              Message
            </div>
            <div
              style={{
                width: 50,
                height: 50,
                borderRadius: "50%",
                background: COLOUR.amber,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="send" size={26} colour="#fff" />
            </div>
          </div>
        </div>
        {gen === "edge" && (
          <div
            style={{
              position: "absolute",
              left: W / 2 - 12,
              top: b.top + 16,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "#050507",
            }}
          />
        )}
      </div>
    </div>
  );
};

export const PulseChat: React.FC<GfxProps> = ({
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
  const look = chatLook(y, credit, variant);
  const words = quote.split(/\s+/).filter(Boolean);

  // The beats: the window rises 0-20, the speaker types 20-44, the message arrives at 44 and is read from 52.
  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  });
  const typing = interpolate(frame, [20, 44], [0, 1], clamp);
  const arrive = spring({
    frame: frame - 44,
    fps,
    config: { damping: 14, stiffness: 170, mass: 0.7 },
  });
  const readFrom = 52;
  const readTo = Math.max(readFrom + 30, showFor - 24);
  const read = interpolate(frame, [readFrom, readTo], [0, 1], clamp);
  // The relay, messenger and phone looks push in on the message as it arrives (44-64).
  const zoom = pushInAt(frame, 44);
  const props: LookProps = {
    frame,
    enter,
    typing,
    arrive,
    read,
    zoom,
    quote,
    words,
    credit,
    y,
    variant,
  };

  return (
    <Stage dim={dim} bg={bg} variant={variant} blur={12}>
      {look === "relay" ? (
        <RelayLook {...props} />
      ) : look === "messenger" ? (
        <MessengerLook {...props} />
      ) : look === "team" ? (
        <TeamLook {...props} />
      ) : (
        <PhoneLook {...props} />
      )}
      <CreditCaption line={creditLine(credit)} frame={frame} />
      <IllustrationTag frame={frame} />
    </Stage>
  );
};
