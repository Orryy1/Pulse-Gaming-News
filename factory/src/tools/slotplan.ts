// The day's planned slots as the factory itself plans them (src/pcschedule.ts slotsOnDay), printed as JSON, for the
// hands-off watch (src/tools/pulse-watch.ts). It reads only the environment it is given: the watch passes the Mac's
// schedule settings (lane days, slots, switches; never a key or token) and points PULSE_ENV_FILE at nothing, so the
// PC's own old .env is never read. Read-only, no database, no network.
//   node --import tsx src/tools/slotplan.ts [YYYY-MM-DD ...]     default: yesterday, today and tomorrow
import { loadConfig } from "../config.ts";
import { slotsOnDay } from "../pcschedule.ts";
import { addDays, dayKey, localTime } from "../lanes.ts";

const cfg = loadConfig();
const today = dayKey(new Date(), cfg.timezone);
const days = process.argv.slice(2).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
const list = days.length
  ? days
  : [addDays(today, -1), today, addDays(today, 1)];
const slots = list.flatMap((d) =>
  slotsOnDay(cfg, d).map(([lane, hhmm, lead]) => ({
    lane,
    day: d,
    hhmm,
    lead,
    at: localTime(d, hhmm, cfg.timezone).toISOString(),
  })),
);
process.stdout.write(
  JSON.stringify({
    timezone: cfg.timezone,
    dailyTarget: cfg.dailyTarget,
    slots,
  }),
);
