// Vertical styles: Words. Each takes VGfxProps (./types.ts) and draws inside the 952x500 box; the styles
// live in ./words/, with their shared helpers in ./words/kit.ts. Every word on screen comes from the
// beat (props.v) or a fixed generic label (REPORT, NEWS ALERT, ILLUSTRATION, YEAR, EVENT).
import type { VStyle } from "./types.ts";
import { Typewriter, fitsTypewriter } from "./words/Typewriter.tsx";
import { Duotone, fitsDuotone } from "./words/Duotone.tsx";
import { Sticky, fitsSticky } from "./words/Sticky.tsx";
import { Checklist, fitsChecklist } from "./words/Checklist.tsx";
import { Flap, fitsFlap } from "./words/Flap.tsx";
import { Alert, fitsAlert } from "./words/Alert.tsx";
import { Breaking, fitsBreaking } from "./words/Breaking.tsx";

export const STYLES: Record<string, VStyle> = {
  /** primary: the quote (4-30 words); secondary: the speaker (optional, 32 at most). */
  Typewriter: { kind: "quote", component: Typewriter, fits: fitsTypewriter },
  /** primary: the quote (4-30 words); secondary: the speaker (optional, 32 at most); src: the picture. */
  Duotone: { kind: "quote", component: Duotone, fits: fitsDuotone },
  /** primary: the heading (optional, 28 at most); items: 2-4 items of 30 characters or fewer. */
  Sticky: { kind: "list", component: Sticky, fits: fitsSticky },
  /** primary: the heading (optional, 26 at most); items: 2-4 items of 34 characters or fewer. */
  Checklist: { kind: "list", component: Checklist, fits: fitsChecklist },
  /** primary: the heading (optional, 26 at most); items: 2-4 "2013: event" rows, events 22 characters or fewer. */
  Flap: { kind: "timeline", component: Flap, fits: fitsFlap },
  /** primary: the headline (3-18 words, 110 characters at most); secondary: the outlet (optional, 36 at most). */
  Alert: { kind: "report", component: Alert, fits: fitsAlert },
  /** primary: the headline (3-18 words, 110 characters at most); secondary: the outlet (optional, 36 at most). */
  Breaking: { kind: "report", component: Breaking, fits: fitsBreaking },
};
