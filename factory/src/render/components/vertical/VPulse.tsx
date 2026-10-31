// Vertical styles: Pulse (31 Oct 2026, the long videos' Pulse universe on the Shorts). The era-true Pulse phone
// story and period browsers for a report, social posts, mail and chat for a quote whose credit names that
// medium (the long-form honesty rule, ../packs/pulse/socialCredit.ts), the Pulse Calendar for a date, the Pulse
// Store for a price or a sales figure, a Pulse console for hardware specs, a period TV bulletin or magazine
// cover for an old report, and a native Pulse Store "available on" panel for platforms. Each long-form pack
// is shown through ./pulse/PackCard.tsx: joined part-way into its build so it reads at a Short's pace, cropped
// to the device and drawn over the full-width area (frame "full"). Era: the year the story names, else the
// year the Short is made. A look the beat cannot honestly fill is not offered.
//
// Left out as unsuited to a 35-50 s Short: the phone alert's slow 3D stack (the Words pack's Alert already does
// it at Shorts pace), Pulse Maps (a Short's beat has no place kind), the split-flap and terminal (the Words
// pack has a faster departures board) and every look whose key content lands after about 3 s even when joined.
import React from "react";
import type { GfxStyle } from "../packs/types.ts";
import { inEra } from "../packs/types.ts";
import type { MomentGraphic } from "../LongMoments.tsx";
import { STYLES as SCREEN } from "../packs/GfxScreen.tsx";
import { STYLES as SOCIAL } from "../packs/pulse/social.ts";
import { STYLES as APPS } from "../packs/pulse/apps.ts";
import { STYLES as PRESS } from "../packs/pulse/press.ts";
import { STYLES as CONSOLES } from "../packs/pulse/consoles.ts";
import type { VGfxProps, VStyle } from "./types.ts";
import { PackCard, type Rect } from "./pulse/PackCard.tsx";
import { packGraphic, namedYear, longDate } from "./pulse/map.ts";
import { Platforms, fitsPlatforms } from "./pulse/Platforms.tsx";

/** One long-form look on a Short: which pack style, the pack kind it reads the beat as, where to join and crop. */
export interface PulseLook {
  /** The beat kind it draws. */
  kind: string;
  pack: GfxStyle;
  as: MomentGraphic["kind"];
  /** Frames into the pack's build the Short joins it. */
  join: number;
  crop: Rect;
  /** The window carries its own ILLUSTRATION tag (the crop cuts the pack's away). */
  tag: boolean;
}

const PHONE: Rect = { x: 600, y: 0, w: 720, h: 1080 };
const APP: Rect = { x: 190, y: 40, w: 1540, h: 950 };

export const PULSE_LOOKS: Record<string, PulseLook> = {
  Phone: {
    kind: "report",
    pack: SCREEN.PhoneStory!,
    as: "headline",
    join: 60,
    crop: PHONE,
    tag: true,
  },
  PhoneQuote: {
    kind: "quote",
    pack: SCREEN.PhoneStoryQuote!,
    as: "quote",
    join: 60,
    crop: PHONE,
    tag: true,
  },
  OldWeb: {
    kind: "report",
    pack: SCREEN.OldWeb!,
    as: "headline",
    join: 40,
    crop: { x: 210, y: 90, w: 1500, h: 900 },
    tag: true,
  },
  OldWebQuote: {
    kind: "quote",
    pack: SCREEN.OldWebQuote!,
    as: "quote",
    join: 40,
    crop: { x: 210, y: 90, w: 1500, h: 900 },
    tag: true,
  },
  TV: {
    kind: "report",
    pack: PRESS.PulseTV!,
    as: "headline",
    join: 44,
    crop: { x: 400, y: 90, w: 1120, h: 860 },
    tag: true,
  },
  Monthly: {
    kind: "report",
    pack: PRESS.PulseMonthly!,
    as: "headline",
    join: 26,
    crop: { x: 560, y: 60, w: 800, h: 960 },
    tag: true,
  },
  // Posts, mail and chat: cropped to the window or app (every era's look sits inside it); the post or message
  // names its sender, the pack's corner credit line falls outside the crop.
  Social: {
    kind: "quote",
    pack: SOCIAL.PulseSocial!,
    as: "quote",
    join: 30,
    crop: APP,
    tag: true,
  },
  Mail: {
    kind: "quote",
    pack: SOCIAL.PulseMail!,
    as: "quote",
    join: 36,
    crop: APP,
    tag: true,
  },
  Chat: {
    kind: "quote",
    pack: SOCIAL.PulseChat!,
    as: "quote",
    join: 38,
    crop: APP,
    tag: true,
  },
  Calendar: {
    kind: "date",
    pack: APPS.PulseCalendar!,
    as: "date",
    join: 54,
    crop: PHONE,
    tag: true,
  },
  CalendarCountdown: {
    kind: "countdown",
    pack: APPS.PulseCalendar!,
    as: "date",
    join: 54,
    crop: PHONE,
    tag: true,
  },
  CalendarPaper: {
    kind: "date",
    pack: APPS.PulseCalendarPaper!,
    as: "date",
    join: 56,
    crop: { x: 500, y: 40, w: 920, h: 1000 },
    tag: true,
  },
  Store: {
    kind: "price",
    pack: PRESS.PulseStore!,
    as: "stat",
    join: 30,
    crop: { x: 160, y: 60, w: 1600, h: 980 },
    tag: true,
  },
  StoreSales: {
    kind: "stat",
    pack: PRESS.PulseStore!,
    as: "stat",
    join: 30,
    crop: { x: 160, y: 60, w: 1600, h: 980 },
    tag: true,
  },
  Console: {
    kind: "specs",
    pack: CONSOLES.PulseConsole!,
    as: "specs",
    join: 46,
    crop: { x: 40, y: 40, w: 1840, h: 1000 },
    tag: false,
  },
};

/** The year whose look a date card wears: the date's own year. */
const dateYear = (v: VGfxProps["v"]): number | undefined => {
  const m = String(longDate(v.date_to) ?? v.primary).match(/\b(19|20)\d\d\b/);
  return m ? Number(m[0]) : undefined;
};

/** Whether the look can draw this beat: the translation exists, the pack's own fit passes and the era is the story's. */
export function pulseFits(
  look: PulseLook,
  v: VGfxProps["v"],
  storyYear?: number,
): boolean {
  if (v.kind !== look.kind) return false;
  const g = packGraphic(v, look.as);
  if (!g) return false;
  // A sales card needs a sales caption; a plain stat is not a shop's.
  if (
    look.kind === "stat" &&
    !/\b(copies|sold|sales|units)\b/i.test(g.secondary)
  )
    return false;
  const year =
    look.as === "date"
      ? dateYear(v)
      : (storyYear ?? namedYear(v));
  if (!inEra(look.pack, year)) return false;
  try {
    return !look.pack.fits || look.pack.fits(g);
  } catch {
    return false;
  }
}

const card = (look: PulseLook): React.FC<VGfxProps> => {
  const C: React.FC<VGfxProps> = ({ v, len, variant, src, storyYear }) => {
    const g = packGraphic(v, look.as);
    if (!g) return null;
    const year = look.as === "date" ? dateYear(v) : storyYear;
    return (
      <PackCard
        pack={look.pack.component}
        g={g}
        join={look.join}
        crop={look.crop}
        len={len}
        variant={variant}
        src={src}
        year={year}
        tag={look.tag}
      />
    );
  };
  return C;
};

export const STYLES: Record<string, VStyle> = {
  ...Object.fromEntries(
    Object.entries(PULSE_LOOKS).map(([name, look]) => [
      name,
      {
        kind: look.kind,
        component: card(look),
        frame: "full" as const,
        fits: (v: VGfxProps["v"], ctx?: { storyYear?: number }) =>
          pulseFits(look, v, ctx?.storyYear),
      },
    ]),
  ),
  /** items: 1-6 platforms of 18 characters or fewer; primary: the heading (34 at most). */
  Platforms: { kind: "platforms", component: Platforms, fits: fitsPlatforms },
};
