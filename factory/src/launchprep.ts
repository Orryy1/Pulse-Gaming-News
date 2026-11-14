// The GTA VI launch week's small rules (C:\Claude\reports\gta-launch-plan-2026-11.md, 11 Nov 2026), kept apart from
// the pipeline so each can be tested on its own:
// - a pre-made Short is written for the moment it goes public, not the day it was made, and a time word that would
//   not yet be true at that moment ("out in New Zealand right now" before 11:00 UTC on 18 Nov) sends the draft back;
// - wherever the release date comes up, public copy says GTA VI is out from 18 Nov in New Zealand, not just 19 Nov;
// - every GTA VI video's description names the Leonida Intel page for that day, tagged ?utm_source=pulse, as a
//   site from the same team (never the owner's name).
// Confirmed launch facts: reports/GTA VI confirmed launch facts (Leonida, 11 Nov).md.

/** Rockstar Support, 3 Nov 2026: midnight local everywhere, New Zealand first at 11:00 UTC on 18 Nov. */
export const NZ_UNLOCK = new Date("2026-11-18T11:00:00Z");
/** The last region (US West) unlocks at 08:00 UTC on 19 Nov. */
export const LAST_UNLOCK = new Date("2026-11-19T08:00:00Z");
/** Leonida's live pages switch from server status to the map and patch notes on 20 Nov (UTC). */
const AFTER_LAUNCH = new Date("2026-11-20T00:00:00Z");
/** The cross-link runs for the launch and the weeks after it, then stops by itself. */
const LINK_UNTIL = new Date("2026-12-21T00:00:00Z");

const GTA6 = /\b(grand theft auto (vi|6)|gta ?(vi|6))\b/i;

/** True for text about GTA VI (a game title, a headline, a script). */
export function isGta6(text: string | undefined): boolean {
  return !!text && GTA6.test(text);
}

const SITE = "https://leonida-intel.com";
const tag = (page: string) => `${SITE}${page}?utm_source=pulse`;

/**
 * The description line for a GTA VI video going public at `at`: the countdown before the first unlock, server status
 * on 18 and 19 Nov, the map and patch notes after. Neutral wording, "from the same team"; nothing after 20 Dec.
 */
export function leonidaLine(at: Date): string | undefined {
  const t = at.getTime();
  if (t >= LINK_UNTIL.getTime()) return undefined;
  if (t < NZ_UNLOCK.getTime())
    return `Unlock times by country: ${tag("/countdown/")} (from the same team)`;
  if (t < AFTER_LAUNCH.getTime())
    return `GTA 6 server status, checked through launch: ${tag("/gta-6-server-status/")} (from the same team)`;
  return `GTA 6 map and patch notes: ${tag("/map/")} and ${tag("/gta-6-patch-notes/")} (from the same team)`;
}

const MONTH_19 =
  /\b(?:nov(?:ember)?\.?\s+19(?:th)?|19(?:th)?\s+nov(?:ember)?)\b/i;
const MONTH_18_OR_NZ =
  /\b(?:nov(?:ember)?\.?\s+18(?:th)?|18(?:th)?\s+nov(?:ember)?|new zealand)\b/i;
/** Sentences, a closing quote kept with its sentence. */
const SENTENCES = /(?<=[.!?]["”']?)\s+|\n+/;
/** November 19 facts that are not the game's release: the free map and poster, the album, the pre-order pack. */
const OTHER_NOV_19 = /\b(map|poster|album|soundtrack|pack|bonus|gta\+)\b/i;
const RELEASE_WORD =
  /\b(release[sd]?|launch(?:es|ed|ing)?|out|arrives?|unlocks?|comes out|available|drops?|day one|launch day)\b/i;

/**
 * Release-date wording (launch plan section 7): a GTA VI Short that gives November 19 as the release date must also
 * say it is out from November 18 in New Zealand. Other November 19 facts (the free map, the album) need no change.
 */
export function releaseDateProblems(text: string): string[] {
  if (!isGta6(text) || MONTH_18_OR_NZ.test(text)) return [];
  const said = text
    .split(SENTENCES)
    .some(
      (line) =>
        MONTH_19.test(line) &&
        RELEASE_WORD.test(line) &&
        !OTHER_NOV_19.test(line),
    );
  return said
    ? [
        'Where GTA 6\'s release date comes up, say it is out from November 18 in New Zealand (11:00 UTC), then midnight local time everywhere else, not just "November 19".',
      ]
    : [];
}

const OUT_NOW =
  /\b(?:(?:is|it's|it is|now|already)\s+(?:already\s+)?(?:out|live|unlocked|available|playable)\b|out now|available now|out (?:right )?now|playing it (?:right )?now|you can (?:already )?play (?:it )?(?:now|today|right now)|just unlocked|went live|has unlocked)/i;
const NOT_YET =
  /\b(?:(?:is not|isn't|not)\s+(?:out|live|unlocked|available)\s+yet|(?:unlocks?|comes? out|arrives?|launch(?:es)?)\s+(?:on|at|in|tomorrow|tonight)|countdown|pre-?load|pre-?order)/i;

/**
 * Time words checked against the moment the Short goes public (`airsAt`), for GTA VI: before the first unlock it
 * may not say the game is out; after the last unlock it may not say it unlocks tonight or tomorrow. A planned Short
 * made days early (RUN_PREMAKE_HOURS) is written for its slot, and this is the guard that it still reads true then.
 */
export function airTimeProblems(text: string, airsAt: Date): string[] {
  if (!isGta6(text)) return [];
  const lines = text.split(SENTENCES);
  const out: string[] = [];
  if (airsAt.getTime() < NZ_UNLOCK.getTime()) {
    const bad = lines.find((l) => OUT_NOW.test(l) && !NOT_YET.test(l));
    if (bad)
      out.push(
        `This Short goes public at ${airsAt.toISOString().slice(0, 16).replace("T", " ")} UTC, before GTA 6 unlocks anywhere (New Zealand, 11:00 UTC on November 18), so it cannot say the game is out: "${bad.trim().slice(0, 120)}".`,
      );
  }
  if (airsAt.getTime() >= LAST_UNLOCK.getTime()) {
    const bad = lines.find((l) =>
      /\b(?:unlocks?|comes? out|arrives?)\s+(?:tonight|tomorrow|in a few hours|soon)\b|\bnot out yet\b|\bisn't out yet\b/i.test(
        l,
      ),
    );
    if (bad)
      out.push(
        `This Short goes public after GTA 6 has unlocked everywhere, so it cannot say it is still to come: "${bad.trim().slice(0, 120)}".`,
      );
  }
  return out;
}

/** The writer's note for a Short made ahead of its slot: every time word is true at the slot, not when written. */
export function airsAtNote(airsAt: Date, timeZone: string): string {
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(airsAt);
  return `This Short is made ahead of time and goes public at ${local} UK time (${airsAt.toISOString().slice(0, 16).replace("T", " ")} UTC). Write every time word ("today", "tonight", "right now", "out now", "an hour ago") so it is true at that moment, never at the moment of writing.`;
}

/** GTA VI's release-date fact for the writer, when the Short is about GTA VI. */
export function releaseDateNote(game: string): string {
  return isGta6(game)
    ? 'GTA 6\'s release date, when it comes up: out from November 18 in New Zealand (11:00 UTC), then at midnight local time in every other region on November 19. Say "from November 18 in New Zealand", never just "November 19".'
    : "";
}

/**
 * The next open slot after `after`: the first of `slots` (local "HH:MM") over the next two days that nothing has
 * taken and that sits at least `gapMinutes` clear of every taken time.
 */
export function nextOpenSlot(
  after: Date,
  slots: string[],
  taken: Date[],
  gapMinutes: number,
  localTime: (day: string, hhmm: string) => Date,
  dayKey: (d: Date) => string,
): Date | undefined {
  const days = [0, 1, 2].map((d) =>
    dayKey(new Date(after.getTime() + d * 86_400_000)),
  );
  const times = [...new Set(days)]
    .flatMap((day) => slots.map((s) => localTime(day, s)))
    .filter((t) => t.getTime() > after.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  const gap = gapMinutes * 60_000;
  return times.find(
    (t) =>
      !taken.some(
        (x) => Math.abs(x.getTime() - t.getTime()) < Math.max(gap, 1),
      ),
  );
}
