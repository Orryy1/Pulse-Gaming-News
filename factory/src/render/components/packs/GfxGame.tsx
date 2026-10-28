// Graphic pack: Game. Looks borrowed from game interfaces and collectibles (cards, XP bars, quest logs,
// tech trees, level-select maps), all original designs: no real game's UI, logos, icons or type.
// Every style takes GfxProps (./types.ts); STYLES lists them by name. The styles live in ./game/.
import type { GfxStyle } from "./types.ts";
import { TradingCards, fitsTradingCards } from "./game/TradingCards.tsx";
import { LevelUp, fitsLevelUp } from "./game/LevelUp.tsx";
import { QuestLog, fitsQuestLog } from "./game/QuestLog.tsx";
import { Lineage, fitsLineage } from "./game/Lineage.tsx";
import { LevelSelect, fitsLevelSelect } from "./game/LevelSelect.tsx";

export const STYLES: Record<string, GfxStyle> = {
  /** people: items "Full Name: role" (1-4), primary a short heading. Cards dealt in, flipped, foil sheen. */
  TradingCards: {
    kind: "people",
    component: TradingCards,
    fits: fitsTradingCards,
    sound: "pop",
  },
  /** milestone: primary the record or first (2-12 words), secondary the year. XP bar bursts on frame 34. */
  LevelUp: {
    kind: "milestone",
    component: LevelUp,
    fits: fitsLevelUp,
    sound: "stamp",
  },
  /** list: primary the quest title, items 2-5 objectives (44 characters at most), ticked in turn. */
  QuestLog: {
    kind: "list",
    component: QuestLog,
    fits: fitsQuestLog,
    sound: "glint",
  },
  /** lineage: primary a heading, items 2-5 names in order, each optionally "Name: year". */
  Lineage: {
    kind: "lineage",
    component: Lineage,
    fits: fitsLineage,
    sound: "pop",
  },
  /** timeline: primary a heading, items 2-5 "year: what happened" rows. A world-map level select. */
  LevelSelect: {
    kind: "timeline",
    component: LevelSelect,
    fits: fitsLevelSelect,
    sound: "glint",
  },
};
