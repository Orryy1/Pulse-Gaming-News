// The code scenes as long-video graphic styles ("Scene/Delay" and so on), so a documentary's or a ranking's own
// delay, reviews and share graphics can draw them. A style fits only when the graphic's own rows are the data; the
// long writers' checks (src/editorial/documentary.ts) have already matched its figures to the sentence. Long.tsx
// offers these only with CODE_SCENES on.
import React from "react";
import { COLOUR } from "../../brand.ts";
import type { CodeScene } from "../../codescene.ts";
import type { GfxProps, GfxStyle } from "../packs/types.ts";
import type { MomentGraphic } from "../LongMoments.tsx";
import { CodeSceneView } from "./CodeScenes.tsx";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "February 16, 2027" or "2027-02-16" to an ISO day; anything less exact is not a calendar date. */
export function isoDay(text: string): string | undefined {
  const t = text.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/);
  if (!m) return undefined;
  const month = MONTHS.findIndex((x) => x.startsWith(m[1]!.slice(0, 3)));
  if (month < 0) return undefined;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

export function delayScene(g: MomentGraphic): CodeScene | undefined {
  const [a, b] = g.items.map(isoDay);
  if (g.items.length !== 2 || !a || !b || a >= b) return undefined;
  const months =
    (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
    Number(b.slice(5, 7)) -
    Number(a.slice(5, 7));
  return months <= 5
    ? {
        type: "slide",
        title: g.primary,
        from: a,
        to: b,
        note: g.secondary || undefined,
      }
    : undefined;
}

export function reviewsScene(g: MomentGraphic): CodeScene | undefined {
  const rows = g.items.map((x) => {
    const at = x.lastIndexOf(":");
    const score = Number(x.slice(at + 1).trim());
    return at > 0 && Number.isInteger(score) && score <= 100
      ? { label: x.slice(0, at).trim(), score }
      : undefined;
  });
  if (rows.length < 3 || rows.length > 6 || rows.some((r) => !r))
    return undefined;
  return {
    type: "ladder",
    title: g.primary,
    rows: (rows as Array<{ label: string; score: number }>).sort(
      (x, y) => y.score - x.score,
    ),
  };
}

export function shareScene(g: MomentGraphic): CodeScene | undefined {
  const m = g.primary.match(/^(\d+(?:\.\d+)?)\s*(?:%|percent)$/i);
  const pct = Number(m?.[1]);
  return m && pct > 0 && pct < 100 && g.secondary.trim()
    ? { type: "crowd", title: g.primary, percent: pct, label: g.secondary }
    : undefined;
}

const styled =
  (derive: (g: MomentGraphic) => CodeScene | undefined): React.FC<GfxProps> =>
  ({ g, len, src }) => {
    const scene = derive(g);
    if (!scene) return null;
    // Landed by the frame the graphics check looks at (packs/fit.ts DRAWN_BY).
    return (
      <CodeSceneView
        planned={{
          scene,
          landAt: Math.min(90, Math.max(45, Math.round(len * 0.5))),
        }}
        len={len}
        accent={COLOUR.amber}
        src={src}
      />
    );
  };

export const STYLES: Record<string, GfxStyle> = {
  Delay: {
    kind: "delay",
    component: styled(delayScene),
    fits: (g) => !!delayScene(g),
    sound: "glint",
  },
  Reviews: {
    kind: "reviews",
    component: styled(reviewsScene),
    fits: (g) => !!reviewsScene(g),
    sound: "pop",
  },
  Share: {
    kind: "share",
    component: styled(shareScene),
    fits: (g) => !!shareScene(g),
    sound: "pop",
  },
};
