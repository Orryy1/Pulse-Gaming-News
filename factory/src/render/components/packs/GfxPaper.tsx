// Graphic pack: Paper. Every style takes GfxProps (./types.ts); STYLES lists them by name.
// Paper-craft, print and handmade looks: a redacted file copy, a typewriter, a tear-off calendar, sticky
// notes on cork and an accounting ledger. The styles live in ./paper/, with their shared materials in
// ./paper/kit.tsx. Every word on screen comes from the graphic or a fixed label (FILE COPY, ILLUSTRATION).
import type { GfxStyle } from "./types.ts";
import { Redacted, fitsRedacted } from "./paper/Redacted.tsx";
import { Typewriter, fitsTypewriter } from "./paper/Typewriter.tsx";
import { Calendar, fitsCalendar } from "./paper/Calendar.tsx";
import { StickyNotes, fitsStickyNotes } from "./paper/StickyNotes.tsx";
import { Ledger, fitsLedger } from "./paper/Ledger.tsx";

export const STYLES: Record<string, GfxStyle> = {
  /** primary: a 10-70 word passage from the source; items[0]: the key phrase inside it; secondary: the credit. */
  Redacted: {
    kind: "source",
    component: Redacted,
    fits: fitsRedacted,
    sound: "pop",
  },
  /** primary: the quote (4-40 words); secondary: "Name, role". */
  Typewriter: {
    kind: "quote",
    component: Typewriter,
    fits: fitsTypewriter,
    sound: "glint",
  },
  /** primary: a date with a month name or a four-digit year; secondary: what happened (2-6 words). */
  Calendar: {
    kind: "date",
    component: Calendar,
    fits: fitsCalendar,
    sound: "stamp",
  },
  /** primary: a 2-4 word heading; items: 2-5 short items (40 characters at most). */
  StickyNotes: {
    kind: "list",
    component: StickyNotes,
    fits: fitsStickyNotes,
    sound: "pop",
  },
  /** primary: a 2-4 word heading; items: 2-3 "label: value" rows. */
  Ledger: {
    kind: "compare",
    component: Ledger,
    fits: fitsLedger,
    sound: "glint",
  },
};
