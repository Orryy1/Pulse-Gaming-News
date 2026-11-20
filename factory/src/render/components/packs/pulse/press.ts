// Pulse universe pack, "press": where a story or a figure met the public before phones, drawn as Pulse's own
// media of the period. A press headline becomes the cover line of Pulse Monthly (to 2009) or a PULSE NEWS
// bulletin on a Pulse television (to 2005); a price or a sales figure goes on a games shop shelf (to 2008) or
// the Pulse Store (from 2009). Every style takes GfxProps (../types.ts); the lead wires STYLES into the packs.
import type { GfxStyle } from "../types.ts";
import { PulseMonthly, fitsPulseMonthly } from "./PulseMonthly.tsx";
import { PulseTV, fitsPulseTV } from "./PulseTV.tsx";
import { PulseStore, fitsPulseStore } from "./PulseStore.tsx";

export const STYLES: Record<string, GfxStyle> = {
  /**
   * primary: the press story as a headline, 4-12 words; secondary: "Outlet, year" or a year. A period games
   * magazine cover with the headline as its cover line, the year as the cover date and a STORY: OUTLET strip.
   */
  PulseMonthly: {
    kind: "headline",
    component: PulseMonthly,
    fits: fitsPulseMonthly,
    sound: "stamp",
    era: { from: 1980, to: 2009 },
  },
  /**
   * primary: the headline, 3-14 words; secondary: "Outlet, year" or a year. A PULSE NEWS bulletin on a CRT:
   * static, the picture, the headline in a lower third with the credit, a ticker of the headline and outlet.
   */
  PulseTV: {
    kind: "headline",
    component: PulseTV,
    fits: fitsPulseTV,
    sound: "pop",
    era: { from: 1980, to: 2005 },
  },
  /**
   * primary: the figure exactly as the source writes it ("$59.99", "17 million"); secondary: what it counts,
   * 2-8 words. A price (currency in the figure, price/cost/retail in the caption) or a sales figure (copies,
   * sold, sales or units): a shop shelf to 2008, the Pulse Store from 2009. Any other stat does not fit.
   */
  PulseStore: {
    kind: "stat",
    component: PulseStore,
    fits: fitsPulseStore,
    sound: "pop",
    era: { from: 1980 },
  },
};
