// Graphic pack: Screen. Every style takes GfxProps (./types.ts); STYLES lists them by name.
// Screens, devices, broadcast and display looks: a TV news package, a phone's news alert, an airport
// split-flap board, a retro amber terminal and a blueprint sheet. The styles live in ./screen/.
import type { GfxStyle } from "./types.ts";
import { Broadcast, fitsBroadcast } from "./screen/Broadcast.tsx";
import { PhoneAlert, fitsPhoneAlert } from "./screen/PhoneAlert.tsx";
import { SplitFlap, fitsSplitFlap } from "./screen/SplitFlap.tsx";
import { Terminal, fitsTerminal } from "./screen/Terminal.tsx";
import { Blueprint, fitsBlueprint } from "./screen/Blueprint.tsx";

export const STYLES: Record<string, GfxStyle> = {
  /** primary: the headline (3-14 words); secondary: "Outlet, year" or a year. */
  Broadcast: {
    kind: "headline",
    component: Broadcast,
    fits: fitsBroadcast,
    sound: "pop",
  },
  /** primary: the headline (3-14 words); secondary: "Outlet, year" or a year. */
  PhoneAlert: {
    kind: "headline",
    component: PhoneAlert,
    fits: fitsPhoneAlert,
    sound: "glint",
  },
  /** primary: a 2-4 word heading; items: 2-5 "2013: GTA V launches" rows. */
  SplitFlap: {
    kind: "timeline",
    component: SplitFlap,
    fits: fitsSplitFlap,
    sound: "glint",
  },
  /** primary: the heading; items: 2-6 "CPU: 294 MHz" rows. */
  Terminal: {
    kind: "specs",
    component: Terminal,
    fits: fitsTerminal,
    sound: "glint",
  },
  /** primary: the heading; items: 2-6 "CPU: 294 MHz" rows. */
  Blueprint: {
    kind: "specs",
    component: Blueprint,
    fits: fitsBlueprint,
    sound: "pop",
  },
};
