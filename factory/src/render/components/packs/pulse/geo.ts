// The geography the Pulse Maps styles share (./PulseMaps.tsx, ./PulseMapsPaper.tsx): the places a map graphic
// names, looked up in src/render/places.ts exactly as the World map does (a pin is never guessed), the
// great-circle route between them and its length, and the fitting of those places into a box on screen.
// Coordinates are longitude and Web Mercator y in degrees (north negative), as src/render/components/worldmap.ts
// draws the land, so pins sit on the right coast.
import { placeFor, type Place } from "../../../places.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import { txt, wordCount } from "../screen/common.ts";

/** One stop on the map: the name as the graphic writes it (the only label shown) and where it is. */
export type Stop = { label: string; place: Place };

/**
 * The graphic's places in story order, or undefined when there are none, more than three, or any one the list
 * does not know (unlike the World map, which drops an unknown name, a Pulse map shows every stop or none).
 */
export function mapStops(items: string[]): Stop[] | undefined {
  if (items.length < 1 || items.length > 3) return undefined;
  const out: Stop[] = [];
  for (const it of items) {
    const label = txt(it.split(":")[0]);
    const place = label ? placeFor(label) : undefined;
    if (!place || out.some((s) => s.place === place)) return undefined;
    out.push({ label, place });
  }
  return out;
}

/** A 2-6 word heading (the search) and one to three places the list knows. */
export function fitsPulseMaps(g: MomentGraphic): boolean {
  const head = txt(g.primary);
  if (!head || head.length > 40) return false;
  if (wordCount(head) < 2 || wordCount(head) > 6) return false;
  return mapStops(g.items) !== undefined;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The angle between two places at the earth's centre (radians), by the haversine formula. */
function arcAngle(a: Place, b: Place): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The great-circle distance between two places, in miles and kilometres (mean earth radius). */
export function greatCircle(a: Place, b: Place): { mi: number; km: number } {
  const t = arcAngle(a, b);
  return { mi: t * 3958.8, km: t * 6371 };
}

/** Rounded as a person says it: to the mile under 100, else to the nearest ten. */
export function roundDistance(x: number): number {
  return x < 100 ? Math.max(1, Math.round(x)) : Math.round(x / 10) * 10;
}

const commas = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The route's whole length, miles first: "3,260 mi / 5,240 km". Undefined for a single place. */
export function distanceLabel(stops: Stop[]): string | undefined {
  if (stops.length < 2) return undefined;
  let mi = 0;
  let km = 0;
  for (let i = 1; i < stops.length; i++) {
    const d = greatCircle(stops[i - 1]!.place, stops[i]!.place);
    mi += d.mi;
    km += d.km;
  }
  return `${commas(roundDistance(mi))} mi / ${commas(roundDistance(km))} km`;
}

/** Web Mercator y in degrees, north negative (as worldmap.ts). */
export const mercY = (lat: number) => {
  const l = Math.max(-80, Math.min(84, lat));
  return (
    -(180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360))
  );
};

/** A point in map units: longitude (unwrapped so a route never jumps across the date line) and Mercator y. */
export type MapPt = { x: number; y: number };

/** Longitude moved by whole turns to sit within 180 degrees of `ref`. */
const near = (lon: number, ref: number) => {
  let l = lon;
  while (l - ref > 180) l -= 360;
  while (l - ref < -180) l += 360;
  return l;
};

/** The stops in map units, each one's longitude kept near the one before it. */
export function stopPoints(stops: Stop[]): MapPt[] {
  const out: MapPt[] = [];
  for (const s of stops) {
    const ref = out.length ? out[out.length - 1]!.x : s.place.lon;
    out.push({ x: near(s.place.lon, ref), y: mercY(s.place.lat) });
  }
  return out;
}

/** The great-circle path from a to b as `n` + 1 points in map units, starting at longitude `startX`. */
export function geodesic(a: Place, b: Place, startX: number, n = 48): MapPt[] {
  const v = (p: Place) => [
    Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)),
    Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)),
    Math.sin(rad(p.lat)),
  ];
  const A = v(a);
  const B = v(b);
  const t = arcAngle(a, b);
  const out: MapPt[] = [];
  let prev = startX;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const s = Math.sin(t);
    const wa = t < 1e-9 ? 1 - f : Math.sin((1 - f) * t) / s;
    const wb = t < 1e-9 ? f : Math.sin(f * t) / s;
    const x = wa * A[0]! + wb * B[0]!;
    const y = wa * A[1]! + wb * B[1]!;
    const z = wa * A[2]! + wb * B[2]!;
    const lat = deg(Math.atan2(z, Math.hypot(x, y)));
    const lon = near(deg(Math.atan2(y, x)), prev);
    prev = lon;
    out.push({ x: lon, y: mercY(lat) });
  }
  return out;
}

/** The whole route in map units, leg by leg (empty for one place). */
export function routeLegs(stops: Stop[]): MapPt[][] {
  const pts = stopPoints(stops);
  const legs: MapPt[][] = [];
  for (let i = 1; i < stops.length; i++)
    legs.push(geodesic(stops[i - 1]!.place, stops[i]!.place, pts[i - 1]!.x));
  return legs;
}

/** How a map is fitted on screen: pixels per map unit and the map point at the box's centre. */
export type Fit = { k: number; cx: number; cy: number; ax: number; ay: number };

/**
 * Fits the stops and their route into a box on screen (left, top, width, height), with room round them and
 * never closer in than `minW` degrees across (a lone city still shows its coast).
 */
export function fitBox(
  stops: Stop[],
  box: { left: number; top: number; w: number; h: number },
  minW: number,
): Fit {
  const pts = [...stopPoints(stops), ...routeLegs(stops).flat()];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const one = stops.length === 1 ? stops[0]!.place : undefined;
  const floor = one
    ? one.kind === "country"
      ? minW * 2.4
      : one.kind === "region"
        ? minW * 1.5
        : minW
    : minW * 0.5;
  const k = Math.min(
    box.w / Math.max(floor, (maxX - minX) * 1.45),
    box.h / Math.max(floor * (box.h / box.w), (maxY - minY) * 1.45),
  );
  return {
    k,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    ax: box.left + box.w / 2,
    ay: box.top + box.h / 2,
  };
}

/** A map point on screen under a fit. */
export const toScreen = (f: Fit, p: MapPt) => ({
  x: f.ax + (p.x - f.cx) * f.k,
  y: f.ay + (p.y - f.cy) * f.k,
});
