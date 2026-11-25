// The owner's checklist for the trend feed (TREND_FEED): which channels the download account should subscribe to.
// Run on either machine: npx tsx src/tools/trendchannels.ts
// It prints TREND_CHANNELS (or the built-in list) as links and the steps. Subscribing is done by hand, by the owner,
// in the download account's own Brave profile on the Mac mini: the factory never subscribes, likes, comments or
// watches anything with that account, and never touches Pulse's own channel with it.

import { pathToFileURL } from "node:url";
import { trendChannelList } from "../config.ts";

/** The checklist text (pure). */
export function subscribeGuide(handles: readonly string[]): string {
  const lines = [
    "Trend feed: channels for the download account to subscribe to",
    "",
    "On the Mac mini, open Brave with the download account's own profile (the 18+ account in YTDLP_COOKIES_FILE,",
    "never the Pulse or Orryy account). Open each link below and press Subscribe. That is all: the factory reads the",
    "account's subscriptions page every 3 hours once TREND_FEED=true, and never subscribes or watches anything itself.",
    "",
    ...handles.map(
      (h, i) =>
        `${String(i + 1).padStart(2, " ")}. https://www.youtube.com/@${h}`,
    ),
    "",
    handles.length
      ? `${handles.length} channels. If a link shows "This page isn't available", skip it (the handle may have changed).`
      : "TREND_CHANNELS is empty: nothing to subscribe to.",
    "Change the list with TREND_CHANNELS in the .env (comma-separated handles).",
  ];
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(subscribeGuide(trendChannelList(process.env.TREND_CHANNELS)));
}
