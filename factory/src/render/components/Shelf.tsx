import React from "react";
import {
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { RenderPlan, ShelfItem } from "../plan.ts";
import type { ShortImage } from "../props.ts";
import { COLOUR } from "../brand.ts";
import { LOW_WIDTH, SAFE, SHELF_TOP } from "../layout.ts";
import { SPRING, ease, exitProgress, ruleThenContent } from "../motion.ts";
import { BODY, DISPLAY } from "./fonts.ts";

const SHELF_ENTER_DELAY = 6; // frames after the card lands

const Frame: React.FC<{
  durationInFrames: number;
  children: React.ReactNode;
  accent: string;
}> = ({ durationInFrames, children, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { rule, content } = ruleThenContent(frame - SHELF_ENTER_DELAY, fps);
  const out = exitProgress(frame, durationInFrames);
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: SHELF_TOP,
        width: LOW_WIDTH,
        opacity: Math.min(Math.max(0, content), out),
        transform: `translateY(${interpolate(Math.max(0, content), [0, 1], [18, 0]) + (1 - out) * 12}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -14,
          width: `${Math.max(0, rule) * 100}%`,
          height: 3,
          background: accent,
          opacity: 0.9,
        }}
      />
      {children}
    </div>
  );
};

/** "CONFIRMED · XBOX WIRE" / "RUMOR · UNCONFIRMED" pill. */
const SourceChip: React.FC<{
  label: string;
  accent: string;
  isRumour: boolean;
}> = ({ label, accent, isRumour }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 14,
      padding: "14px 22px",
      background: "rgba(11,11,14,0.82)",
      border: `2px solid ${isRumour ? COLOUR.alert : accent}`,
      borderRadius: 12,
    }}
  >
    <div
      style={{
        width: 14,
        height: 14,
        borderRadius: 7,
        background: isRumour ? COLOUR.alert : COLOUR.verify,
      }}
    />
    <div
      style={{
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: 30,
        letterSpacing: 2.5,
        color: COLOUR.paper,
        lineHeight: 1,
      }}
    >
      {label}
    </div>
  </div>
);

function countTo(value: string, p: number): string {
  const m = value.match(/^([^\d]*)([\d,]+)(.*)$/);
  if (!m) return value;
  const target = Number(m[2]!.replace(/,/g, ""));
  if (!Number.isFinite(target)) return value;
  const v = Math.round(target * p);
  return `${m[1]}${m[2]!.includes(",") ? v.toLocaleString("en-US") : String(v)}${m[3]}`;
}

/** One data tile: value in Anton, label in Inter, counting up from the cue. */
const DataCallout: React.FC<{
  value: string;
  label: string;
  accent: string;
}> = ({ value, label, accent }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame - SHELF_ENTER_DELAY - 4, [0, 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease.out,
  });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 26,
        padding: "18px 28px",
        background: "rgba(11,11,14,0.82)",
        borderLeft: `6px solid ${accent}`,
        borderRadius: 12,
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 72,
          color: COLOUR.paper,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {countTo(value, p)}
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 28,
          color: COLOUR.muted,
          lineHeight: 1.15,
          maxWidth: 420,
          textTransform: "uppercase",
          letterSpacing: 1.5,
        }}
      >
        {label}
      </div>
    </div>
  );
};

/** Live Steam player count: green dot, "LIVE · STEAM", the number, the label. */
const LiveTicker: React.FC<{
  value: string;
  label: string;
  accent: string;
}> = ({ value, label, accent }) => {
  const frame = useCurrentFrame();
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(frame / 9));
  const p = interpolate(frame - SHELF_ENTER_DELAY - 4, [0, 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease.out,
  });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 22,
        padding: "16px 26px",
        background: "rgba(11,11,14,0.82)",
        border: `2px solid ${accent}`,
        borderRadius: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            background: COLOUR.up,
            opacity: pulse,
            boxShadow: `0 0 18px ${COLOUR.up}`,
          }}
        />
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 26,
            color: COLOUR.up,
            letterSpacing: 3,
          }}
        >
          LIVE · STEAM
        </div>
      </div>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 64,
          color: COLOUR.paper,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {countTo(value, p)}
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 28,
          color: COLOUR.muted,
          maxWidth: 300,
          lineHeight: 1.15,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
};

/** Box art with the game title: the identity card under a beat that names the game. */
const GameCard: React.FC<{
  capsule: ShortImage | undefined;
  title: string;
  subtitle: string;
  accent: string;
}> = ({ capsule, title, subtitle, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({
    frame: frame - SHELF_ENTER_DELAY - 2,
    fps,
    config: SPRING.POP,
  });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 24,
        padding: "14px 26px 14px 14px",
        background: "rgba(11,11,14,0.82)",
        borderRadius: 14,
        border: "2px solid rgba(245,245,242,0.12)",
      }}
    >
      {capsule ? (
        <Img
          src={capsule.src}
          style={{
            width: 140,
            height: 210,
            objectFit: "cover",
            borderRadius: 8,
            transform: `scale(${interpolate(pop, [0, 1], [0.9, 1])})`,
          }}
        />
      ) : (
        <div
          style={{
            width: 140,
            height: 210,
            borderRadius: 8,
            background: accent,
            opacity: 0.4,
          }}
        />
      )}
      <div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 48,
            color: COLOUR.paper,
            lineHeight: 1.05,
            maxWidth: 620,
          }}
        >
          {title.toUpperCase()}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: 10,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 28,
              color: COLOUR.muted,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** Mounts plan.shelf: exactly one device per segment in the shelf band. */
export const Shelf: React.FC<{
  plan: RenderPlan;
  accent: string;
  isRumour: boolean;
  images: ShortImage[];
  gameTitle: string;
  gameSubtitle: string;
}> = ({ plan, accent, isRumour, images, gameTitle, gameSubtitle }) => {
  const capsule = images.find((i) => i.kind === "capsule");
  return (
    <>
      {plan.shelf.map((item: ShelfItem, i) => {
        const len = item.to - item.from;
        if (len <= 0 || item.device === "rail") return null;
        let body: React.ReactNode = null;
        if (item.device === "source")
          body = (
            <SourceChip
              label={item.data.label ?? ""}
              accent={accent}
              isRumour={isRumour}
            />
          );
        else if (item.device === "stat")
          body = (
            <DataCallout
              value={item.data.value ?? ""}
              label={item.data.label ?? ""}
              accent={accent}
            />
          );
        else if (item.device === "live")
          body = (
            <LiveTicker
              value={item.data.value ?? ""}
              label={item.data.label ?? ""}
              accent={accent}
            />
          );
        else if (item.device === "gamecard")
          body = (
            <GameCard
              capsule={capsule}
              title={gameTitle}
              subtitle={gameSubtitle}
              accent={accent}
            />
          );
        return (
          <Sequence
            key={i}
            from={item.from}
            durationInFrames={len}
            layout="none"
          >
            <Frame durationInFrames={len} accent={accent}>
              {body}
            </Frame>
          </Sequence>
        );
      })}
    </>
  );
};
