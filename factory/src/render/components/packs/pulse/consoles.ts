// Pulse universe: consoles. Every style takes GfxProps (../types.ts); STYLES lists them by name.
// Hardware specs shown on a Pulse games console of the story's era (./PulseConsole.tsx): Pulse Tempo to 1993,
// Prism 1994-99, Basalt 2000-05, Comet 2006-12, Facet 2013-19 and Spire from 2020. The lead wires this
// registry into ../index.ts.
import type { GfxStyle } from "../types.ts";
import { PulseConsole, fitsPulseConsole } from "./PulseConsole.tsx";

export const STYLES: Record<string, GfxStyle> = {
  /**
   * primary: a 2-5 word heading; items: 2-6 "CPU: 294 MHz" rows, at least half of them about hardware (or the
   * heading names a console and one row is). Values up to 18 characters.
   */
  PulseConsole: {
    kind: "specs",
    component: PulseConsole,
    fits: fitsPulseConsole,
    sound: "pop",
    era: { from: 1980 },
  },
};
