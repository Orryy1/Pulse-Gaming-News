// Graphic pack: Map. The animated map (src/render/components/MapMoment.tsx) for places a sentence names.
import { MapMoment, mapPlaces } from "../MapMoment.tsx";
import type { GfxStyle } from "./types.ts";

export const STYLES: Record<string, GfxStyle> = {
  World: {
    kind: "map",
    component: MapMoment,
    fits: (g) => mapPlaces(g.items).length >= 1,
    sound: "pop",
  },
};
