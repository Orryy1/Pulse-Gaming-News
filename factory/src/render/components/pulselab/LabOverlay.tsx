// The Pulse Lab's layer on the rebuilt gameplay Short (src/render/GameplayShort.tsx `lab`): the Lab tag and the
// season tally in the brand band, one shelf device at a time (the claim card, the instrument or the viewer's card),
// the reveal card on the outcome, the small credit tag, and the sting, ticks and landing hit. The split screen is drawn
// by VersusPanes, under this layer. Positions follow src/render/layout.ts and src/render/labplan.ts.

import React from "react";
import {
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { CONTENT_WIDTH, SAFE } from "../../layout.ts";
import {
  cardClaim,
  instrumentWindow,
  revealWindow,
  shelfWindow,
  tagText,
  type LabClaimCard,
  type LabGrade,
  type LabOverlay as LabOverlayData,
} from "../../labplan.ts";
import { LabInstrumentView } from "./Instruments.tsx";

const src = (s: string) =>
  /^(https?:|data:|blob:)/.test(s) ? s : staticFile(s);

export const GRADE_COLOUR: Record<LabGrade, string> = {
  TRUE: COLOUR.up,
  FALSE: COLOUR.alert,
  PARTLY: COLOUR.gold,
};

/** The Lab tag: a flask mark, "PULSE LAB" over the segment and its number, a ruler tick along its foot. Whole on frame 0. */
export const LabTag: React.FC<{ tag: NonNullable<LabOverlayData["tag"]> }> = ({
  tag,
}) => {
  const frame = useCurrentFrame();
  const { top, bottom } = tagText(tag);
  // A light sweep across the tag in its first 0.6 s; the tag itself never moves or fades.
  const sweep = interpolate(frame, [2, 20], [-40, 140], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: 214,
        height: 70,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 22px 0 14px",
        background: "rgba(11,11,14,0.86)",
        borderRadius: 14,
        borderLeft: `8px solid ${COLOUR.amber}`,
        overflow: "hidden",
        boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
      }}
    >
      <svg width={40} height={50} viewBox="0 0 40 50">
        <path
          d="M14 3 h12 M16 3 v15 L4 42 a4 4 0 0 0 4 6 h24 a4 4 0 0 0 4 -6 L24 18 V3"
          stroke={COLOUR.amber}
          strokeWidth={4}
          fill="none"
          strokeLinejoin="round"
        />
        <path
          d="M9 36 h22 l3 6 a2 2 0 0 1 -2 3 h-24 a2 2 0 0 1 -2 -3 z"
          fill={COLOUR.amber}
        />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 20,
            letterSpacing: 5,
            color: COLOUR.amber,
          }}
        >
          {top}
        </span>
        <span
          style={{
            fontFamily: DISPLAY,
            fontSize: 38,
            color: COLOUR.paper,
            letterSpacing: 1.5,
            marginTop: 4,
          }}
        >
          {bottom}
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${sweep}%`,
          width: 60,
          background:
            "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.28), rgba(255,255,255,0))",
          transform: "skewX(-18deg)",
        }}
      />
    </div>
  );
};

/** The season tally chip, right of the tag: "Receipts: 14 graded", a breakdown under it when there is one. */
export const TallyChip: React.FC<{
  tally: NonNullable<LabOverlayData["tally"]>;
}> = ({ tally }) => (
  <div
    style={{
      position: "absolute",
      right: 1080 - SAFE.right,
      top: 214,
      minHeight: 70,
      maxWidth: 470,
      padding: "8px 18px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "flex-end",
      background: "rgba(11,11,14,0.86)",
      border: `3px solid ${COLOUR.amber}`,
      borderRadius: 14,
      boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
    }}
  >
    <span
      style={{
        fontFamily: DISPLAY,
        fontSize: tally.line.length > 22 ? 30 : 36,
        lineHeight: 1.05,
        color: COLOUR.paper,
        whiteSpace: "nowrap",
      }}
    >
      {tally.line}
    </span>
    {tally.sub ? (
      <span
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 21,
          color: COLOUR.muted,
          marginTop: 3,
          whiteSpace: "nowrap",
        }}
      >
        {tally.sub}
      </span>
    ) : null}
  </div>
);

/** The claim card: the label (LEAK, RUMOUR...) and the source's name always above the claim; the grade stamps it on the outcome. */
export const ClaimCard: React.FC<{ claim: LabClaimCard; payoffAt: number }> = ({
  claim,
  payoffAt,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = cardClaim(claim.text);
  const stampIn = spring({
    frame: frame - Math.round(payoffAt * fps),
    fps,
    config: { damping: 11, mass: 0.6 },
  });
  const stamped = frame >= Math.round(payoffAt * fps);
  const colour = GRADE_COLOUR[claim.grade];
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: 916,
        width: CONTENT_WIDTH,
        minHeight: 230,
      }}
    >
      <div
        style={{
          background: "rgba(11,11,14,0.86)",
          borderRadius: 22,
          padding: "22px 30px 26px",
          boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
          borderLeft: `12px solid ${COLOUR.amber}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 24,
              letterSpacing: 3,
              padding: "5px 12px",
              borderRadius: 8,
              background: claim.unofficial ? COLOUR.alert : COLOUR.muted,
              color: claim.unofficial ? COLOUR.paper : COLOUR.ink,
            }}
          >
            {claim.label}
          </span>
          <span
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 26,
              color: COLOUR.muted,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 560,
            }}
          >
            {`via ${claim.source}`}
          </span>
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: text.length > 80 ? 38 : 44,
            lineHeight: 1.18,
            color: COLOUR.paper,
          }}
        >{`"${text}"`}</div>
      </div>
      {stamped ? (
        <div
          style={{
            position: "absolute",
            right: 26,
            top: -34,
            padding: "6px 26px",
            border: `8px solid ${colour}`,
            borderRadius: 16,
            color: colour,
            background: "rgba(11,11,14,0.7)",
            fontFamily: DISPLAY,
            fontSize: 96,
            lineHeight: 1,
            letterSpacing: 4,
            transform: `rotate(-8deg) scale(${interpolate(stampIn, [0, 1], [1.8, 1])})`,
            opacity: Math.min(1, stampIn * 2),
            boxShadow: "0 14px 40px rgba(0,0,0,0.55)",
          }}
        >
          {claim.grade}
        </div>
      ) : null}
    </div>
  );
};

/** The answer card: lands on the outcome where the result stamp used to sit, the measured number in full. */
export const RevealCard: React.FC<{
  label: string;
  text: string;
  payoffAt: number;
  top?: number;
}> = ({ label, text, payoffAt, top = 330 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - Math.round(payoffAt * fps),
    fps,
    config: { damping: 12, mass: 0.5 },
  });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        width: CONTENT_WIDTH,
        top,
        display: "flex",
        justifyContent: "center",
        transform: `scale(${interpolate(s, [0, 1], [1.45, 1])}) rotate(-2deg)`,
        opacity: Math.min(1, s * 2),
      }}
    >
      <div
        style={{
          background: COLOUR.amber,
          borderRadius: 18,
          padding: "16px 36px 20px",
          textAlign: "center",
          boxShadow: "0 18px 50px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 26,
            letterSpacing: 5,
            color: COLOUR.ink,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: text.length > 14 ? 92 : 118,
            lineHeight: 1.02,
            color: COLOUR.ink,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
};

/** The viewer's card for the opening seconds: "YOU ASKED" and their handle (never a display name) over their ask. */
export const AskedCard: React.FC<{
  credit: NonNullable<LabOverlayData["credit"]>;
  until: number;
}> = ({ credit, until }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.7 },
  });
  const out = interpolate(frame, [until * fps - 6, until * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const letter = (
    (credit.handle ?? "").replace(/^@/, "").match(/\p{L}|\p{N}/u)?.[0] ?? "?"
  ).toUpperCase();
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: 916,
        width: CONTENT_WIDTH,
        opacity: out * Math.min(1, pop * 1.4),
        transform: `translateY(${(1 - pop) * 40}px)`,
      }}
    >
      <div
        style={{
          background: COLOUR.paper,
          borderRadius: 22,
          padding: "22px 28px",
          boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 29,
              background: COLOUR.amber,
              color: COLOUR.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: DISPLAY,
              fontSize: 34,
            }}
          >
            {credit.handle ? letter : "?"}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 22,
                letterSpacing: 4,
                color: COLOUR.amber,
              }}
            >
              YOU ASKED
            </span>
            <span
              style={{
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 32,
                color: COLOUR.ink,
              }}
            >
              {credit.handle ??
                (credit.card.startsWith("YOU VOTED") ? "Our poll" : "A viewer")}
            </span>
          </div>
        </div>
        {credit.ask ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: 38,
              lineHeight: 1.2,
              color: COLOUR.ink,
              marginTop: 12,
            }}
          >
            {cardClaim(credit.ask, 110)}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** The small credit tag in the soft band once the card has gone: "ASKED BY @handle". */
export const CreditTag: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      position: "absolute",
      left: SAFE.left,
      top: 1482,
      padding: "6px 14px",
      borderRadius: 10,
      background: "rgba(11,11,14,0.78)",
      borderLeft: `6px solid ${COLOUR.amber}`,
      fontFamily: BODY,
      fontWeight: 800,
      fontSize: 26,
      letterSpacing: 1.5,
      color: COLOUR.paper,
      whiteSpace: "nowrap",
    }}
  >
    {text}
  </div>
);

/** The Lab layer over the picture. */
export const LabOverlay: React.FC<{
  lab: LabOverlayData; hookEnd: number; payoffAt: number }> = ({ lab, hookEnd, payoffAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const shelf = shelfWindow(lab.format, hookEnd, payoffAt);
  const inst = lab.instrument
    ? instrumentWindow(lab.instrument, payoffAt)
    : undefined;
  const reveal = revealWindow(payoffAt);
  return (
    <>
      {lab.tag ? <LabTag tag={lab.tag} /> : null}
      {lab.tally ? <TallyChip tally={lab.tally} /> : null}
      {lab.claim && shelf && t < shelf.until ? (
        <ClaimCard claim={lab.claim} payoffAt={payoffAt} />
      ) : null}
      {lab.instrument && inst && t >= inst.from && t < inst.until ? (
        <LabInstrumentView i={lab.instrument} t={t} payoffAt={payoffAt} />
      ) : null}
      {lab.instrument && t >= reveal.from && t < reveal.until ? (
        <RevealCard
          label="I MEASURED IT"
          text={lab.instrument.reveal}
          payoffAt={payoffAt}
        />
      ) : null}
      {lab.format === "asked" && lab.credit && shelf && t < shelf.until ? (
        <AskedCard credit={lab.credit} until={shelf.until} />
      ) : null}
      {lab.credit && (lab.format !== "asked" || (shelf && t >= shelf.until)) ? (
        <CreditTag text={lab.credit.card} />
      ) : null}
      {lab.versus && t >= payoffAt ? (
        <>
          {lab.versus.aResult ? (
            <PaneResult text={lab.versus.aResult} top={316 + 608 - 86} />
          ) : null}
          {lab.versus.bResult ? (
            <PaneResult text={lab.versus.bResult} top={932 + 608 - 86} />
          ) : null}
        </>
      ) : null}
      {lab.proofMark ? (
        <div
          style={{
            position: "absolute",
            right: 30,
            top: 1580,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 22,
            letterSpacing: 3,
            color: "rgba(255,255,255,0.55)",
          }}
        >
          {lab.proofMark}
        </div>
      ) : null}
      {lab.sting ? <Audio src={src(lab.sting)} volume={0.45} /> : null}
      {lab.tick
        ? (lab.instrument?.ticks ?? []).map((tk, k) => (
            <Sequence
              key={k}
              from={Math.round(tk * fps)}
              durationInFrames={Math.round(fps * 0.5)}
            >
              <Audio src={src(lab.tick!)} volume={0.35} />
            </Sequence>
          ))
        : null}
      {lab.reveal && (lab.instrument || lab.claim || lab.versus) ? (
        <Sequence
          from={Math.round(payoffAt * fps)}
          durationInFrames={Math.round(fps * 1.5)}
        >
          <Audio src={src(lab.reveal)} volume={0.5} />
        </Sequence>
      ) : null}
    </>
  );
};

const PaneResult: React.FC<{ text: string; top: number }> = ({ text, top }) => (
  <div
    style={{
      position: "absolute",
      right: 1080 - SAFE.right,
      top,
      padding: "8px 18px",
      borderRadius: 12,
      background: COLOUR.amber,
      color: COLOUR.ink,
      fontFamily: DISPLAY,
      fontSize: 44,
      lineHeight: 1.05,
      boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
    }}
  >
    {text}
  </div>
);

/** The split screen: GTA 6 on top, GTA 5 below, each 16:9 and labelled. The top pane carries the game's sound. */
export const VersusPanes: React.FC<{
  versus: NonNullable<LabOverlayData["versus"]>;
  volume: (f: number) => number;
  Video: React.ComponentType<{
    src: string;
    volume?: number | ((f: number) => number);
    muted?: boolean;
    style?: React.CSSProperties;
  }>;
}> = ({ versus, volume, Video }) => {
  const pane = (top: number, srcUrl: string, label: string, sound: boolean) => (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: 1080,
        height: 608,
        overflow: "hidden",
        background: COLOUR.ink,
      }}
    >
      {srcUrl ? (
        <Video
          src={srcUrl}
          {...(sound ? { volume } : { muted: true })}
          style={{ width: 1080, height: 608, objectFit: "cover" }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: SAFE.left,
          top: 18,
          padding: "6px 16px",
          borderRadius: 10,
          background: "rgba(11,11,14,0.86)",
          borderLeft: `6px solid ${COLOUR.amber}`,
          fontFamily: DISPLAY,
          fontSize: 44,
          lineHeight: 1.05,
          color: COLOUR.paper,
        }}
      >
        {label}
      </div>
    </div>
  );
  return (
    <>
      {pane(316, versus.aSrc, versus.aLabel, true)}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 924,
          width: 1080,
          height: 8,
          background: COLOUR.amber,
        }}
      />
      {pane(932, versus.bSrc, versus.bLabel, false)}
    </>
  );
};
