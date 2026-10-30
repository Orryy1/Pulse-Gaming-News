// Pulse universe, apps: a date opens the Pulse Calendar and a place opens Pulse Maps on a Pulse OS phone
// (./handset.tsx) for stories from 2012 on; an older story gets the paper of its period, a Pulse wall calendar
// or a folded Pulse road map. Every style takes GfxProps (../types.ts); the lead wires STYLES into the packs.
import type { GfxStyle } from "../types.ts";
import { PulseCalendar, fitsPulseCalendar } from "./PulseCalendar.tsx";
import { PulseCalendarPaper } from "./PulseCalendarPaper.tsx";
import { PulseMaps } from "./PulseMaps.tsx";
import { PulseMapsPaper } from "./PulseMapsPaper.tsx";
import { fitsPulseMaps } from "./geo.ts";

/** Smartphone apps belong to stories from 2012 on; paper to anything earlier. */
const PHONE_ERA = { from: 2012 };
const PAPER_ERA = { to: 2011 };

export const STYLES: Record<string, GfxStyle> = {
  /**
   * primary: the date as the source writes it, at least a month and a year ("September 17, 2013", "October
   * 2012"; a season or a quarter does not fit); secondary: what happened, at most 8 words. The phone's
   * calendar opens on the month, rings the day (or lights the month) and drops the event onto it.
   */
  PulseCalendar: {
    kind: "date",
    component: PulseCalendar,
    fits: fitsPulseCalendar,
    sound: "glint",
    era: PHONE_ERA,
  },
  /** The same date on a Pulse wall calendar of its period, the day circled in red pen and the event written. */
  PulseCalendarPaper: {
    kind: "date",
    component: PulseCalendarPaper,
    fits: fitsPulseCalendar,
    sound: "pop",
    era: PAPER_ERA,
  },
  /**
   * primary: a 2-6 word heading (the search); items: 1-3 places the place list knows, in story order. Pins
   * drop at their true positions; two or three places get the great-circle route and its distance.
   */
  PulseMaps: {
    kind: "map",
    component: PulseMaps,
    fits: fitsPulseMaps,
    sound: "glint",
    era: PHONE_ERA,
  },
  /** The same places on a folded Pulse road map, circled and named in pen, the route highlighted. */
  PulseMapsPaper: {
    kind: "map",
    component: PulseMapsPaper,
    fits: fitsPulseMaps,
    sound: "pop",
    era: PAPER_ERA,
  },
};
