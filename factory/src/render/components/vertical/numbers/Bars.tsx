// Numbers/Bars: two or three "label: value" rows as racing bars. Every bar launches together and grows to its
// share of the biggest while its figure counts up riding the bar's tip; the biggest is in the accent and
// lands last, the rest in pale grey. Rows keep the beat's order. Values count to the text as written, with
// "million" shortened to M (thousand K, billion B) so the figure stays phone-sized.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { countText, quantityRows, type Row } from "../../packs/data/figures.ts";
import type { VGfxProps } from "../types.ts";
import {
  ANTON,
  H,
  Pool,
  W,
  alpha,
  antonFit,
  clamp,
  clean,
  easeOut,
  exitStyle,
  fitLabel,
  labelFits,
  textEm,
  useBeat,
} from "./kit.tsx";

const LABEL_W = W - 20;
const GAP = 18;

/** "210 million" as "210M": the same figure in a phone's width. */
function shorten(r: Row): Row {
  const after = r.fig.after
    .replace(/^\s*(?:thousand|k)\b/i, "K")
    .replace(/^\s*(?:millions?|mn|m)\b/i, "M")
    .replace(/^\s*(?:billions?|bn|b)\b/i, "B");
  return {
    ...r,
    fig: { ...r.fig, after, text: `${r.fig.before}${r.fig.num}${after}` },
  };
}

/** The rows, every item reading as "label: quantity" (a leading "*" subject mark dropped), or none. */
export function barRows(items: string[]): Row[] {
  const raw = items.map(clean).filter(Boolean);
  const rows = quantityRows(raw).map((r) =>
    shorten({ ...r, label: r.label.replace(/^\*\s*/, "") }),
  );
  return rows.length === raw.length ? rows : [];
}

function sizes(rows: Row[]) {
  const n = rows.length;
  const rowH = H / n;
  const labelSize = n === 2 ? 44 : 38;
  const fig = Math.min(
    n === 2 ? 170 : 124,
    ...rows.map((r) => antonFit(r.fig.text.toUpperCase(), W * 0.5, 200)),
  );
  const max = Math.max(...rows.map((r) => r.fig.scaled));
  // The longest bar the track allows: every row's bar plus its figure stays inside the box.
  const track = Math.min(
    W * 0.7,
    ...rows.map(
      (r) =>
        (W - GAP - 8 - textEm(r.fig.text.toUpperCase(), ANTON) * fig) /
        Math.max(0.04, r.fig.scaled / max),
    ),
  );
  return { rowH, labelSize, fig, track, max };
}

export const Bars: React.FC<VGfxProps> = ({ v, len, accent }) => {
  const { frame, out, visible } = useBeat(len);
  const rows = barRows(v.items);
  if (!visible || rows.length < 2 || rows.length > 3) return null;
  const { rowH, labelSize, fig, track, max } = sizes(rows);
  const lead = rows.findIndex((r) => r.fig.scaled === max);
  const barH = Math.round(fig * 0.5);
  return (
    <div style={{ position: "absolute", inset: 0, ...exitStyle(out) }}>
      <Pool
        opacity={interpolate(frame, [0, 6], [0, 1], clamp)}
        strength={0.7}
      />
      {rows.map((r, i) => {
        const top = i * rowH + (rowH - (labelSize * 1.15 + 8 + fig * 0.9)) / 2;
        const t0 = 2 + i * 1.5;
        // The bars race: every one eases to its length, the leader (longest) landing last near frame 18.
        const share = Math.max(0.04, r.fig.scaled / max);
        const g = interpolate(frame, [t0, t0 + 10 + share * 5], [0, 1], {
          ...clamp,
          easing: easeOut,
        });
        const label = fitLabel(r.label, LABEL_W, labelSize, 1);
        const isLead = i === lead;
        const length = Math.max(barH * 0.6 * g, track * share * g);
        const labelIn = interpolate(frame, [t0, t0 + 6], [0, 1], clamp);
        return (
          <div key={i} style={{ position: "absolute", left: 0, right: 0, top }}>
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: label.size,
                lineHeight: 1.15,
                letterSpacing: "0.04em",
                color: isLead ? COLOUR.paper : "rgba(245,245,242,0.82)",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                textShadow: "0 2px 12px rgba(0,0,0,0.9)",
                opacity: labelIn,
                transform: `translateX(${(1 - labelIn) * -24}px)`,
                marginBottom: 8,
              }}
            >
              {label.lines.join(" ")}
            </div>
            <div
              style={{
                position: "relative",
                height: fig * 0.9,
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  height: barH,
                  width: length,
                  borderRadius: `4px ${barH / 2}px ${barH / 2}px 4px`,
                  background: isLead
                    ? `linear-gradient(90deg, ${alpha(accent, 0.55)} 0%, ${accent} 70%)`
                    : "linear-gradient(90deg, rgba(200,200,206,0.25) 0%, rgba(232,232,236,0.75) 100%)",
                  boxShadow: isLead
                    ? `0 0 30px ${alpha(accent, 0.45)}`
                    : "0 8px 24px rgba(0,0,0,0.4)",
                  flex: "none",
                }}
              />
              <div
                style={{
                  marginLeft: GAP,
                  fontFamily: DISPLAY,
                  fontSize: fig,
                  lineHeight: 0.9,
                  color: isLead ? accent : "rgba(232,232,236,0.92)",
                  whiteSpace: "nowrap",
                  textShadow: isLead
                    ? `0 0 26px ${alpha(accent, 0.4)}, 0 10px 30px rgba(0,0,0,0.85)`
                    : "0 10px 30px rgba(0,0,0,0.85)",
                  opacity: interpolate(frame, [t0, t0 + 4], [0, 1], clamp),
                }}
              >
                {countText(r.fig, g).toUpperCase()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const fitsBars = (v: VGfxProps["v"]) => {
  const rows = barRows(v.items);
  if (rows.length < 2 || rows.length > 3) return false;
  const { labelSize, fig, track } = sizes(rows);
  if (fig < 120 || track < W * 0.3) return false;
  return rows.every(
    (r) =>
      r.fig.text.length <= 12 &&
      labelFits(r.label, LABEL_W, 1) &&
      fitLabel(r.label, LABEL_W, labelSize, 1).size >= 34,
  );
};
