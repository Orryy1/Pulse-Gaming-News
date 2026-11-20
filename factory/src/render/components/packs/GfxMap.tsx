// Graphic pack: Map. The animated map (src/render/components/MapMoment.tsx) for real places a sentence names, and
// (MAP_PINS) the game's own map in 3D (src/render/components/GameMap3D.tsx) for places in the game.
import { MapMoment, mapPlaces } from "../MapMoment.tsx";
import { GameMap3D } from "../GameMap3D.tsx";
import { drawableGameMap } from "../../gamemap.ts";
import type { GfxStyle } from "./types.ts";

export const STYLES: Record<string, GfxStyle> = {
  World: {
    kind: "map",
    component: MapMoment,
    // A game's own map is never drawn on the world: "Vice City" is not a real place.
    fits: (g) => !g.gameMap && mapPlaces(g.items).length >= 1,
    sound: "pop",
  },
  Game3D: {
    kind: "map",
    component: GameMap3D,
    fits: (g) => drawableGameMap(g),
    sound: "pop",
  },
};
