// Signed-in YouTube downloading for the game footage fetcher only (owner, 19 Nov 2026: age-restricted GTA VI
// uploads cannot be fetched anonymously). YTDLP_COOKIES_FILE points at the cookies of a separate, disposable 18+
// Google account made just for this (never the Pulse or Orryy channel accounts), exported on the Mac mini by
// mac/ytcookies.sh. Empty (the default) keeps everything anonymous.
//
// signedInArgs is the one place those cookies become yt-dlp arguments, and only the game fetcher's own calls use it
// (src/sceneindex/build.ts fetcherRun: its searches, its candidates' details and the chosen upload's proxy, in the
// `build --complete` turns GAME_FETCH starts). Shorts clip pulls, scene search, the light index and the archive
// never pass through it, so they stay anonymous. The YouTube guard (src/lib/ytguard.ts) gives calls carrying
// --cookies their own budget (YT_SIGNED_HOURLY) and their own bot-check pause.

import fs from "node:fs";
import { ytGuard, type YtGuard } from "./ytguard.ts";

export interface SignInConfig {
  /** YTDLP_COOKIES_FILE: the download account's cookies (Netscape format); empty: off. */
  ytdlpCookiesFile?: string;
}

/** The yt-dlp arguments for a signed-in call (pure): the cookies file when it is there and usable, else none. */
export function cookieArgs(
  file: string,
  mtimeMs: number | undefined,
  usable: boolean,
): string[] {
  return file && mtimeMs !== undefined && usable ? ["--cookies", file] : [];
}

/**
 * The game fetcher's sign-in arguments: ["--cookies", file] when YTDLP_COOKIES_FILE is set, the file is there and
 * YouTube has not refused it (until a newer file or a day later); otherwise none, and the call goes anonymous. A set
 * but missing file is warned about once a day with one Discord line (the download account needs signing in again
 * on the Mac mini).
 */
export async function signedInArgs(
  cfg: SignInConfig,
  guard: Pick<YtGuard, "cookiesUsable" | "cookiesMissing"> = ytGuard,
  stat: (file: string) => { mtimeMs: number } = fs.statSync,
): Promise<string[]> {
  const file = String(cfg.ytdlpCookiesFile ?? "").trim();
  if (!file) return [];
  let mtimeMs: number | undefined;
  try {
    mtimeMs = stat(file).mtimeMs;
  } catch {
    await guard.cookiesMissing(file).catch(() => undefined);
    return [];
  }
  let usable = true;
  try {
    usable = guard.cookiesUsable(mtimeMs);
  } catch {
    // an unreadable guard state never stops a signed-in try
  }
  return cookieArgs(file, mtimeMs, usable);
}
