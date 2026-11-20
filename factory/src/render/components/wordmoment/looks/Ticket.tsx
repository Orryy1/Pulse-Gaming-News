// Ticket: an admission stub in paper with a tone-colour band and a perforated tear line, sliding in from
// the left and settling with the spring; at frame six a punch goes through the stub (a dark hole with a
// paper chad flying off) and the ticket jolts. The text is printed across the body, the sub on the band.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  DISPLAY,
  BODY,
  INK,
  PAPER,
  SOFT_GRAIN,
  clamp,
  fitDisplay,
  jolt,
  lin,
  onAccent,
  shadow,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

const PUNCH_AT = 6;

export const Ticket: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, hit, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const stub = Math.round(size * 1.3);
  const bodyW = Math.max(
    420,
    Math.ceil(fitDisplay(text, 560, size, 0.02) * 0.5 * text.length) + size,
  );
  const w = Math.min(880, bodyW + stub);
  const h = Math.round(size * 1.9);
  const fs = fitDisplay(text, w - stub - size * 0.7, size, 0.02);
  const since = frame - PUNCH_AT;
  const punched = since >= 0;
  const chad = Math.max(0, since);
  const notch = Math.round(size * 0.22);
  const side = variant % 2 ? 1 : -1;
  return (
    <Band top={top} blur>
      <div
        style={{
          position: "relative",
          width: w,
          height: h,
          transform: `translateX(${(1 - hit) * -520 * side}px) rotate(${-3 * side + (1 - hit) * 10 * side}deg) translateY(${jolt(since, 7)}px)`,
          opacity: lin(frame, 0, 2) * out,
          filter: `drop-shadow(0 10px 18px rgba(0,0,0,0.45)) drop-shadow(0 30px 60px rgba(0,0,0,0.5))`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: PAPER,
            // Half-moon notches either side of the tear line, cut from the edge.
            WebkitMaskImage: `radial-gradient(circle ${notch}px at ${w - stub}px 0, transparent 98%, black 100%), radial-gradient(circle ${notch}px at ${w - stub}px ${h}px, transparent 98%, black 100%)`,
            WebkitMaskComposite: "source-in",
            maskComposite: "intersect",
            borderRadius: 14,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: SOFT_GRAIN,
              opacity: 0.5,
            }}
          />
          {/* The tone band along the top with the sub printed on it. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: stub,
              top: 0,
              height: Math.round(size * 0.46),
              background: stamp.colour,
              display: "flex",
              alignItems: "center",
              paddingLeft: Math.round(size * 0.3),
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: Math.round(size * 0.24),
              letterSpacing: Math.round(size * 0.05),
              color: onAccent(stamp.colour),
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {sub}
          </div>
          <div
            style={{
              position: "absolute",
              left: Math.round(size * 0.3),
              right: stub + Math.round(size * 0.2),
              top: Math.round(size * 0.46),
              bottom: 0,
              display: "flex",
              alignItems: "center",
              fontFamily: DISPLAY,
              fontSize: fs,
              lineHeight: 1,
              letterSpacing: Math.round(size * 0.02),
              color: INK,
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </div>
          {/* The perforation and the stub, with a little printed rule pattern (decoration only). */}
          <div
            style={{
              position: "absolute",
              right: stub,
              top: 10,
              bottom: 10,
              borderLeft: "4px dashed rgba(20,19,18,0.3)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              width: stub,
              top: 0,
              bottom: 0,
              background: `repeating-linear-gradient(0deg, transparent 0 ${size * 0.14}px, rgba(20,19,18,0.12) ${size * 0.14}px ${size * 0.16}px)`,
            }}
          />
          {/* The punched hole. */}
          {punched ? (
            <div
              style={{
                position: "absolute",
                right: Math.round(stub / 2 - size * 0.2),
                top: Math.round(h / 2 - size * 0.2),
                width: Math.round(size * 0.4),
                height: Math.round(size * 0.4),
                borderRadius: "50%",
                background: "#0b0b0e",
                boxShadow: `inset 0 ${Math.round(size * 0.04)}px ${Math.round(size * 0.06)}px rgba(0,0,0,0.9), 0 0 0 2px rgba(20,19,18,0.25)`,
                transform: `scale(${interpolate(since, [0, 2], [1.25, 1], clamp)})`,
              }}
            />
          ) : null}
        </div>
        {/* The chad: the punched disc flying off and tumbling. */}
        {punched ? (
          <div
            style={{
              position: "absolute",
              right: Math.round(stub / 2 - size * 0.18),
              top: Math.round(h / 2 - size * 0.18),
              width: Math.round(size * 0.36),
              height: Math.round(size * 0.36),
              borderRadius: "50%",
              background: PAPER,
              opacity: interpolate(chad, [0, 10, 16], [1, 1, 0], clamp),
              transform: `translate(${chad * 14}px, ${-chad * 9 + chad * chad * 1.6}px) rotateX(${chad * 55}deg) rotate(${chad * 30}deg)`,
              boxShadow: shadow(0.4),
            }}
          />
        ) : null}
      </div>
    </Band>
  );
};

export const fitsTicket = () => true;
