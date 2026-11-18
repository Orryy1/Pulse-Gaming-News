// Pip's character sheet: every face at the settled moment of its reaction, large, with what it is used for, and a
// row at the size he has on a Short. A still for the owner's sign-off (data/smoke/mascot.mts sheet).

import React from "react";
import { AbsoluteFill } from "remotion";
import { COLOUR } from "./brand.ts";
import { BODY, DISPLAY } from "./components/fonts.ts";
import { PipFigure } from "./components/Pip.tsx";
import {
  PIP_MOOD_LABEL,
  PIP_MOODS,
  PIP_SHORT,
  type PipMood,
} from "./mascot.ts";

export const SHEET_W = 2400;
export const SHEET_H = 1500;

const USE: Record<PipMood, string> = {
  shocked: "Reveal: a big number or surprise",
  laughing: "Joke: the line lands",
  thinking: "Twist, or a steady verdict",
  smug: "Sarcasm, or a call we made",
  facepalm: "Delay, bug or price rise",
  hype: "Good news, strong verdict",
  sceptical: "Rumour, the catch, faint verdict",
  receipt: "Confirmed: the claim checked out",
};

export const MascotSheet: React.FC<{ frame?: number }> = ({ frame = 30 }) => (
  <AbsoluteFill
    style={{ backgroundColor: "#16161B", padding: 70, fontFamily: BODY }}
  >
    <div style={{ display: "flex", alignItems: "baseline", gap: 28 }}>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 92,
          color: COLOUR.amber,
          letterSpacing: 2,
        }}
      >
        PIP
      </div>
      <div style={{ fontSize: 40, color: COLOUR.paper }}>
        the Pulse mascot: eight reactions
      </div>
    </div>
    <div style={{ fontSize: 28, color: COLOUR.muted, marginTop: 6 }}>
      Drawn in code, never talks, no voice. Two or three short reactions per
      Short, top right, only at the reveal, the joke and the verdict.
    </div>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 34,
        marginTop: 44,
      }}
    >
      {PIP_MOODS.map((m) => (
        <div
          key={m}
          style={{
            background: "#22222A",
            borderRadius: 26,
            padding: "26px 20px 22px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <PipFigure mood={m} f={frame} size={330} />
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 46,
              color: COLOUR.paper,
              marginTop: 10,
              letterSpacing: 1,
            }}
          >
            {PIP_MOOD_LABEL[m].toUpperCase()}
          </div>
          <div
            style={{
              fontSize: 25,
              color: COLOUR.muted,
              marginTop: 4,
              textAlign: "center",
            }}
          >
            {USE[m]}
          </div>
        </div>
      ))}
    </div>
    <div
      style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 34 }}
    >
      <div style={{ fontSize: 26, color: COLOUR.muted, width: 300 }}>
        Actual size on a 1080 x 1920 Short:
      </div>
      {PIP_MOODS.map((m) => (
        <PipFigure key={m} mood={m} f={frame} size={PIP_SHORT.size} />
      ))}
    </div>
  </AbsoluteFill>
);
