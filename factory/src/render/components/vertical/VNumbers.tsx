// Vertical styles: Numbers. Each takes VGfxProps (./types.ts) and draws inside the 952x500 box: a figure cut
// from the game's picture, digit wheels, a figure filling like liquid, a year cut from the picture, a tear-off
// calendar, racing bars and a stamped price tag. The pieces live in ./numbers/.
import type { VStyle } from "./types.ts";
import { Mask, fitsMask } from "./numbers/Mask.tsx";
import { Odometer, fitsOdometer } from "./numbers/Odometer.tsx";
import { Liquid, fitsLiquid } from "./numbers/Liquid.tsx";
import { Year, fitsYear } from "./numbers/Year.tsx";
import { CalendarV, fitsCalendarV } from "./numbers/Calendar.tsx";
import { Bars, fitsBars } from "./numbers/Bars.tsx";
import { Price, fitsPrice } from "./numbers/Price.tsx";

export const STYLES: Record<string, VStyle> = {
  Mask: { kind: "stat", component: Mask, fits: fitsMask },
  Odometer: { kind: "stat", component: Odometer, fits: fitsOdometer },
  Liquid: { kind: "stat", component: Liquid, fits: fitsLiquid },
  Year: { kind: "date", component: Year, fits: fitsYear },
  Calendar: { kind: "date", component: CalendarV, fits: fitsCalendarV },
  Bars: { kind: "compare", component: Bars, fits: fitsBars },
  Price: { kind: "price", component: Price, fits: fitsPrice },
};
