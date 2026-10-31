// The Pulse universe (owner, 30 Oct 2026): every phone, browser and app a graphic shows is a Pulse one, drawn
// in the style of its era. A handset is a Pulse phone running Pulse OS, a desktop browser is Pulse Navigator in
// the 90s and Pulse Explorer, Pulse Fox or Pulse Sphere after it, and the app icon, throbber and favicon are the
// Pulse mark. Each is an homage to the look of its time, never a real logo, icon, product name or web address.
import React from "react";
import { COLOUR } from "../../../brand.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";

/** Polar point on the mark's ring (degrees clockwise from 12 o'clock). */
function at(deg: number, r = 36): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
}

function arc(from: number, to: number): string {
  const [x1, y1] = at(from);
  const [x2, y2] = at(to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A36 36 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * The Pulse mark (public/logo.png) in vector: a broken ring round a heartbeat line, so it can be any size and
 * any colour (black on a grey 90s toolbar, amber on a phone). `beat` 0-1 sweeps a brighter pass along the line,
 * for a loading throbber; `spin` turns the ring.
 */
export const PulseMark: React.FC<{
  size: number;
  colour?: string;
  /** A tile behind the mark, as an app icon has; none by default. */
  tile?: string;
  radius?: number;
  spin?: number;
  beat?: number;
}> = ({ size, colour = COLOUR.amber, tile, radius = 22, spin = 0, beat }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    style={{ display: "block", flexShrink: 0 }}
  >
    {tile && <rect width={100} height={100} rx={radius} fill={tile} />}
    <g
      transform={`translate(50 50) scale(${tile ? 0.78 : 1}) translate(-50 -50)`}
    >
      <g
        transform={`rotate(${spin} 50 50)`}
        stroke={colour}
        strokeWidth={8}
        fill="none"
      >
        <path d={arc(-75, -7)} />
        <path d={arc(6, 82)} />
        <path d={arc(100, 190)} />
      </g>
      <polyline
        points="14,55 33,55 42,30 50,80 59,31 66,55 86,55"
        fill="none"
        stroke={colour}
        strokeWidth={8}
        strokeLinejoin="miter"
        strokeMiterlimit={3}
      />
      {beat !== undefined && (
        <polyline
          points="14,55 33,55 42,30 50,80 59,31 66,55 86,55"
          fill="none"
          stroke="#fff"
          strokeOpacity={0.85}
          strokeWidth={8}
          strokeLinejoin="miter"
          strokeMiterlimit={3}
          pathLength={100}
          strokeDasharray="16 200"
          strokeDashoffset={16 - beat * 116}
        />
      )}
    </g>
  </svg>
);

/** A phone's generation by the story's year: a home button and thick bezels, then thinner, then edge to edge. */
export type PhoneGen = "classic" | "slim" | "edge";
/** Pulse OS comes in two skins: "orbit" (centred clock, frosted banners) and "droid" (left clock, cards). */
export type PhoneSkin = "orbit" | "droid";

export function phoneLook(
  year: number | undefined,
  variant = 0,
): { gen: PhoneGen; skin: PhoneSkin; network: string } {
  const y = year ?? 2024;
  const gen: PhoneGen = y <= 2014 ? "classic" : y <= 2019 ? "slim" : "edge";
  const skin: PhoneSkin = variant % 2 ? "droid" : "orbit";
  const network = y <= 2012 ? "3G" : y <= 2019 ? "4G" : "5G";
  return { gen, skin, network };
}

/** The Pulse desktop browser of a year, and how its window is drawn. */
export type BrowserKind = "navigator" | "explorer" | "fox" | "sphere";

export function browserOf(year: number): { kind: BrowserKind; name: string } {
  if (year <= 1998) return { kind: "navigator", name: "Pulse Navigator" };
  if (year <= 2004) return { kind: "explorer", name: "Pulse Explorer" };
  if (year <= 2008) return { kind: "fox", name: "Pulse Fox" };
  return { kind: "sphere", name: "Pulse Sphere" };
}

/** The story's year: from the credit or the headline, else the game's year. */
export function storyYear(
  g: MomentGraphic,
  fallback?: number,
): number | undefined {
  const m = `${g.secondary} ${g.primary} ${g.items.join(" ")}`.match(
    /\b(19[89]\d|20[0-4]\d)\b/,
  );
  return m ? Number(m[0]) : fallback;
}
