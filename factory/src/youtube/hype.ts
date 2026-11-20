// The Hype ask on documentaries (owner's plan, 4 Nov 2026, item 11). Hype is the one YouTube feature built to get
// small channels found, and each viewer has only three a week, so the ask goes on long documentaries alone. YouTube's
// own page (support.google.com/youtube/answer/15509925, read 4 Nov 2026) sets the bar: "Channels in the YouTube Partner
// Program with 500 to 500,000 subscribers are eligible", on long videos only, for the first 7 days after publishing.
// Pulse is well under 500 and not in the Partner Programme, so today viewers have no Hype button on our videos and an
// ask would send them looking for nothing. So HYPE_ASK stays off until the channel has joined the programme (the API
// cannot say when that happens, so that part is the owner's switch), and with it on the channel's subscriber count is
// still checked before each ask. The end card is rendered into the video for good and the button goes after a week,
// so both lines speak only to someone watching in that first week.
import type { Script } from "../editorial/schema.ts";

export const HYPE_MIN_SUBSCRIBERS = 500;
export const HYPE_MAX_SUBSCRIBERS = 500_000;

/** The end card's small line on a documentary, in place of the line about the schedule. */
export const HYPE_END_LINE = "First week? Tap Hype below · Shorts every day";

/** Added to the documentary's pinned comment. */
export const HYPE_COMMENT_LINE =
  "If you're here in its first week, the Hype button under the video is the best way to help a small channel get found.";

/** Whether this script is a long documentary: an explainer or a recap shaped like one does not count. */
export function hypeFormat(
  script: Pick<Script, "evergreen_format" | "explained" | "recap">,
): boolean {
  return (
    script.evergreen_format === "documentary" &&
    !script.explained &&
    !script.recap
  );
}

/** Whether YouTube offers Hype at this size. */
export function hypeSize(subscribers: number | undefined): boolean {
  return (
    subscribers !== undefined &&
    subscribers >= HYPE_MIN_SUBSCRIBERS &&
    subscribers <= HYPE_MAX_SUBSCRIBERS
  );
}

/**
 * Whether to ask on this video: the setting on, a real documentary, a channel the right size. A failed look-up
 * means no ask, since asking for a button viewers do not have is worse than not asking.
 */
export async function hypeAllowed(
  on: boolean,
  script: Pick<Script, "evergreen_format" | "explained" | "recap">,
  subscribers: () => Promise<number | undefined>,
): Promise<boolean> {
  if (!on || !hypeFormat(script)) return false;
  return hypeSize(await subscribers().catch(() => undefined));
}
