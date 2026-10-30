// Numbers/Calendar: a tear-off desk calendar drops in, three blank pages rip away in quick succession and
// it lands on the date: the month across the accent band, the day huge, the year beneath; a pen circle then
// rings the day. The label stands beside the pad. The torn pages carry no figures, only the band and rules,
// so nothing appears that the beat did not give.
import React from "react";
import { interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { parseDate } from "../../packs/paper/Calendar.tsx";
import type { VGfxProps } from "../types.ts";
import {
  H,
  Label,
  W,
  alpha,
  antonFit,
  clamp,
  clean,
  easeOut,
  fitLabel,
  labelFits,
  mix,
  seeded,
  useBeat,
  exitStyle,
  PAPER_GRADIENT,
  shadow,
} from "./kit.tsx";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const PAD_W = 470;
const PAD_H = 470;
const BAND = 112;
const INK = "#1b1a17";
const PAPER = "#f4f0e6";
const TORN = 3;

type Face = { head: string; big: string; foot: string; day: boolean };

function face(primary: string): Face | undefined {
  const d = parseDate(primary);
  const month = d.month !== undefined ? MONTHS[d.month]!.toUpperCase() : "";
  if (month && d.day !== undefined)
    return { head: month, big: String(d.day), foot: d.year ?? "", day: true };
  if (month) {
    // A month alone: whole if it fits big on the page, else its three-letter short form.
    const big =
      antonFit(month, PAD_W - 60, 220) >= 150 ? month : month.slice(0, 3);
    return { head: d.year ?? "", big, foot: "", day: false };
  }
  if (d.year)
    return {
      head: (d.rest ?? "").toUpperCase(),
      big: d.year,
      foot: "",
      day: false,
    };
  return undefined;
}

const Page: React.FC<{
  head: string;
  accent: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ head, accent, children, style }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: PAPER_GRADIENT,
      borderRadius: 6,
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        height: BAND,
        background: `linear-gradient(180deg, ${mix(accent, "#ffffff", 0.12)} 0%, ${accent} 60%, ${mix(accent, "#000000", 0.12)} 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: DISPLAY,
        fontSize: head.length > 8 ? 70 : 82,
        letterSpacing: "0.08em",
        marginRight: 0,
        color: "#fffaf2",
        textShadow: "0 2px 0 rgba(0,0,0,0.18)",
        paddingTop: 22,
        boxSizing: "border-box",
      }}
    >
      {head}
    </div>
    <div
      style={{
        height: 0,
        borderTop: "3px dotted rgba(27,26,23,0.2)",
        margin: "10px 24px 0",
      }}
    />
    {children}
  </div>
);

export const CalendarV: React.FC<VGfxProps> = ({
  v,
  len,
  accent,
  variant = 0,
}) => {
  const { frame, fps, out, visible } = useBeat(len);
  const f = face(v.primary);
  const label = clean(v.secondary);
  if (!visible || !f) return null;
  const side = variant % 2 ? 1 : -1;
  const lab = label ? fitLabel(label, W - PAD_W - 70, 52, 4) : undefined;
  const drop = spring({ frame, fps, config: SPRING.POP });
  // Pages tear at 2, 4.2 and 6.4, each faded out within 5 frames: the date is clear by frame 11 and lands by 12.
  const tearAt = (k: number) => 2 + k * 2.2;
  const thump = spring({
    frame: frame - 10,
    fps,
    config: { damping: 10, stiffness: 320, mass: 0.5 },
  });
  const bump = frame >= 10 ? (1 - thump) * 0.035 : 0;
  const ring = interpolate(frame, [13, 22], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const rise = interpolate(frame, [6, 15], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const bigSize = f.day
    ? 250
    : Math.min(f.big.length <= 4 ? 210 : 190, antonFit(f.big, PAD_W - 60, 230));
  const bodyH = PAD_H - BAND - 13;
  const tilt = side * (2.2 + seeded(variant, 1));
  const padLeft = lab ? 18 : (W - PAD_W) / 2;
  return (
    <div style={{ position: "absolute", inset: 0, ...exitStyle(out) }}>
      <div
        style={{
          position: "absolute",
          left: padLeft,
          top: (H - PAD_H) / 2 + 8,
          width: PAD_W,
          height: PAD_H,
          transform: `translateY(${(1 - drop) * -120}px) rotate(${tilt}deg) scale(${1 + bump})`,
          opacity: interpolate(frame, [0, 3], [0, 1], clamp),
        }}
      >
        {/* The back board and the pages still to come, edges showing under the stack. */}
        <div
          style={{
            position: "absolute",
            left: -10,
            right: -10,
            top: 6,
            bottom: -16,
            borderRadius: 10,
            background: "linear-gradient(180deg, #34302c 0%, #1c1a18 100%)",
            boxShadow: shadow(1.1),
          }}
        />
        {[3, 2, 1].map((k) => (
          <div
            key={k}
            style={{
              position: "absolute",
              left: 2,
              right: 2,
              top: k * 4,
              bottom: -k * 4,
              background: k % 2 ? "#ddd5c4" : "#cfc6b3",
              borderRadius: 6,
            }}
          />
        ))}
        <Page head={f.head} accent={accent}>
          <div
            style={{
              height: bodyH,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                position: "relative",
                fontFamily: DISPLAY,
                fontSize: bigSize,
                lineHeight: 0.92,
                color: INK,
                marginTop: f.foot ? 0 : -8,
              }}
            >
              {f.big}
              {f.day ? (
                <svg
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: bigSize * 1.5,
                    height: bigSize * 1.15,
                    transform: "translate(-50%, -52%)",
                    overflow: "visible",
                  }}
                  viewBox="0 0 150 115"
                >
                  <path
                    d="M 112 14 C 96 4, 40 2, 18 26 C 2 44, 6 84, 34 100 C 62 114, 118 108, 138 80 C 152 58, 140 26, 104 12 C 96 9, 86 8, 78 9"
                    fill="none"
                    stroke={accent}
                    strokeWidth={5}
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1 - ring}
                    opacity={ring > 0.01 ? 1 : 0}
                  />
                </svg>
              ) : null}
            </div>
            {f.foot ? (
              <div
                style={{
                  marginTop: 10,
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize: 46,
                  letterSpacing: "0.3em",
                  marginRight: "-0.3em",
                  color: "#6b6357",
                }}
              >
                {f.foot}
              </div>
            ) : null}
          </div>
        </Page>
        {Array.from({ length: TORN }, (_, i) => TORN - 1 - i).map((k) => {
          const u = interpolate(
            frame,
            [tearAt(k), tearAt(k) + 6],
            [0, 1],
            clamp,
          );
          if (u >= 1) return null;
          const e = u * u;
          const dir = (k + variant) % 2 ? 1 : -1;
          const spin = 26 + 10 * seeded(variant, 10 + k);
          return (
            <div
              key={k}
              style={{
                position: "absolute",
                inset: 0,
                transformOrigin: dir > 0 ? "0% 0%" : "100% 0%",
                transform: `translate(${dir * (24 * u + 440 * e)}px, ${-50 * u - 90 * e}px) rotate(${dir * (6 * u + spin * e)}deg)`,
                opacity: interpolate(u, [0.3, 0.75], [1, 0], clamp),
                boxShadow:
                  u > 0
                    ? `0 ${12 + 24 * u}px ${20 + 20 * u}px rgba(0,0,0,0.35)`
                    : undefined,
              }}
            >
              <Page
                head={f.head}
                accent={accent}
                style={{
                  clipPath:
                    u > 0
                      ? "polygon(0 5px, 6% 0, 12% 5px, 19% 1px, 27% 6px, 35% 0, 43% 5px, 51% 1px, 59% 6px, 67% 0, 75% 5px, 83% 1px, 91% 6px, 100% 1px, 100% 100%, 0 100%)"
                      : undefined,
                }}
              >
                <div style={{ margin: "30px 40px 0" }}>
                  {[0, 1, 2, 3, 4].map((r) => (
                    <div
                      key={r}
                      style={{
                        height: 54,
                        borderBottom: "2px solid rgba(27,26,23,0.12)",
                      }}
                    />
                  ))}
                </div>
              </Page>
            </div>
          );
        })}
        {/* The binding across the top, wire loops biting into the pages. */}
        <div
          style={{
            position: "absolute",
            left: -14,
            right: -14,
            top: -18,
            height: 34,
            borderRadius: 9,
            background:
              "linear-gradient(180deg, #4a4542 0%, #2a2624 55%, #171513 100%)",
            boxShadow: "0 8px 14px rgba(0,0,0,0.45)",
          }}
        />
        {Array.from({ length: 10 }, (_, k) => (
          <div
            key={k}
            style={{
              position: "absolute",
              left: 30 + k * ((PAD_W - 60) / 9) - 5,
              top: -6,
              width: 10,
              height: 30,
              borderRadius: 5,
              background:
                "linear-gradient(90deg, #6d7076 0%, #eceef1 45%, #8b8e94 70%, #44464b 100%)",
            }}
          />
        ))}
      </div>
      {lab ? (
        <div
          style={{
            position: "absolute",
            left: PAD_W + 62,
            right: 0,
            top: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: `${rise * 120}px`,
              height: 8,
              borderRadius: 4,
              background: accent,
              marginBottom: 18,
              boxShadow: `0 0 18px ${alpha(accent, 0.55)}`,
            }}
          />
          <Label
            text={label}
            width={W - PAD_W - 70}
            rise={rise}
            max={52}
            lines={4}
            align="left"
            colour={COLOUR.paper}
          />
        </div>
      ) : null}
    </div>
  );
};

export const fitsCalendarV = (v: VGfxProps["v"]) => {
  const p = clean(v.primary);
  if (!p || p.length > 30) return false;
  const f = face(p);
  if (!f || (f.head && f.head.length > 10)) return false;
  return labelFits(clean(v.secondary), W - PAD_W - 70, 4);
};
