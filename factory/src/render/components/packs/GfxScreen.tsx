// Graphic pack: Screen. Every style takes GfxProps (./types.ts); STYLES lists them by name.
// Screens, devices, broadcast and display looks: a TV news package, a phone's news alert, an airport
// split-flap board, a retro amber terminal and a blueprint sheet. The styles live in ./screen/.
import type { GfxStyle } from "./types.ts";
import { Broadcast, fitsBroadcast } from "./screen/Broadcast.tsx";
import { PhoneAlert, fitsPhoneAlert } from "./screen/PhoneAlert.tsx";
import { SplitFlap, fitsSplitFlap } from "./screen/SplitFlap.tsx";
import { Terminal, fitsTerminal } from "./screen/Terminal.tsx";
import { Blueprint, fitsBlueprint } from "./screen/Blueprint.tsx";
import { PhoneStory, fitsPhoneStory } from "./screen/PhoneStory.tsx";
import { OldWeb, fitsOldWeb } from "./screen/OldWeb.tsx";

/** Smartphone looks belong to stories from 2012 on; a period desktop browser to 1995-2011. */
const PHONE_ERA = { from: 2012 };
const WEB_ERA = { from: 1995, to: 2011 };

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
    era: PHONE_ERA,
  },
  /** A notification tapped open into the phone's browser, the article scrolled and the passage highlighted. */
  PhoneStory: { kind: "headline", component: PhoneStory, fits: fitsPhoneStory, sound: "glint", era: PHONE_ERA },
  PhoneStoryQuote: { kind: "quote", component: PhoneStory, fits: fitsPhoneStory, sound: "glint", era: PHONE_ERA },
  PhoneStorySource: { kind: "source", component: PhoneStory, fits: fitsPhoneStory, sound: "glint", era: PHONE_ERA },
  /** The same story on a desktop browser of its era (grey 90s chrome, then mid-2000s). */
  OldWeb: { kind: "headline", component: OldWeb, fits: fitsOldWeb, sound: "pop", era: WEB_ERA },
  OldWebQuote: { kind: "quote", component: OldWeb, fits: fitsOldWeb, sound: "pop", era: WEB_ERA },
  OldWebSource: { kind: "source", component: OldWeb, fits: fitsOldWeb, sound: "pop", era: WEB_ERA },
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
