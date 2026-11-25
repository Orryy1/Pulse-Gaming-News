// Signed-in YouTube downloading, first for the game footage fetcher (owner, 19 Nov 2026: age-restricted GTA VI
// uploads cannot be fetched anonymously). YTDLP_COOKIES_FILE points at the cookies of a separate, disposable 18+
// Google account made just for this (never the Pulse or Orryy channel accounts), exported on the Mac mini by
// mac/ytcookies.sh. Empty (the default) keeps everything anonymous.
//
// signedInArgs is the one place those cookies become yt-dlp arguments, and only the game fetcher's own calls use it
// (src/sceneindex/build.ts fetcherRun: its searches, its candidates' details and the chosen upload's proxy, in the
// `build --complete` turns GAME_FETCH starts). Shorts clip pulls, scene search, the light index and the archive
// never pass through it, so they stay anonymous. The YouTube guard (src/lib/ytguard.ts) gives calls carrying
// --cookies their own budget (YT_SIGNED_HOURLY) and their own bot-check pause.
//
// Since 19 Nov 2026 (owner: "Yes do all") three smaller users may sign in too, each behind its own switch, off by
// default, and together held to YT_SIGNED_CLIP_SHARE of the signed-in budget so the fetcher is never starved:
// SIGNED_CLIPS (a Short's or long video's clip pull, retried signed in only after the anonymous try met an age gate or
// the anonymous lane's bot-check pause; src/lib/child.ts), SIGNED_LIGHT_INDEX (the light index's details and captions
// of an age-gated upload; src/sceneindex/light.ts) and TREND_FEED (the account's subscriptions feed, read as story
// leads; src/discovery/trendfeed.ts). signedPull below is the one retry rule. The hard rule for all of them: the
// download account never touches Pulse's own channel or videos (src/lib/ytown.ts), here or in the guard.
//
// Since 25 Nov 2026 (the anonymous lane retired, src/lib/ytguard.ts YT_ANON_LANE): a pull goes signed in straight away
// while the anonymous lane is retired or paused, with no anonymous try first, and nothing is ever made again
// anonymously after a signed-in try, whatever its answer.

import fs from "node:fs";
import path from "node:path";
import { errorMessage, log } from "./util.ts";
import {
  guardActive,
  isAgeGate,
  isYtPaused,
  laneOfCall,
  videoIdOf,
  withYtPurpose,
  ytGuard,
  type YtGuard,
  type YtPurpose,
} from "./ytguard.ts";
import { ownChannel, touchesOwnChannel, type OwnChannel } from "./ytown.ts";

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
  /** The call's own arguments: none are given back when they name Pulse's own channel or one of its videos. */
  target: readonly string[] = [],
  own: () => OwnChannel = () => ownChannel(),
): Promise<string[]> {
  const file = String(cfg.ytdlpCookiesFile ?? "").trim();
  if (!file) return [];
  if (target.length && touchesOwnChannel(target, own())) return [];
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
/** YTDLP_COOKIES_FILE as the config resolves it, for modules that carry no config object (src/lib/child.ts). */
export function envCookiesFile(env: NodeJS.ProcessEnv = process.env): string {
  const v = String(env.YTDLP_COOKIES_FILE ?? "").trim();
  return v ? path.resolve(v) : "";
}

/** A switch read from the environment the way src/config.ts reads it (pure): "true", "1", "yes" or "on". */
export function envSwitch(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return /^(true|1|yes|on)$/i.test(String(env[name] ?? "").trim());
}

const failText = (err: unknown): string =>
  `${errorMessage(err)} ${String((err as { stderr?: unknown } | undefined)?.stderr ?? "")}`;

/**
 * True when an anonymous pull may be made again signed in (pure): YouTube age-gated the video, or the anonymous lane is
 * paused for a bot check or retired (the signed-in lane has its own pause). Anything else (a removed video, a 403 on
 * one stream, the anonymous budget) is not a reason to spend the download account's small budget.
 */
export function signedRetryWorth(err: unknown): boolean {
  if (isYtPaused(err)) {
    const e = err as { lane?: string; reason?: string };
    return (
      e.lane !== "signed" &&
      (e.reason === "blocked" || e.reason === "probing" || e.reason === "retired")
    );
  }
  return isAgeGate(failText(err));
}

export interface SignedPullOptions {
  /** The feature's switch (SIGNED_CLIPS, SIGNED_LIGHT_INDEX): off, the pull is exactly the anonymous one. */
  enabled: boolean;
  /** For the log: what the pull is for ("clip", "light index"). */
  what: string;
  /** The share it counts against on the signed-in lane (default "clip"). */
  purpose?: YtPurpose;
  /** The cookies file; YTDLP_COOKIES_FILE from the environment when not given. */
  cookiesFile?: string;
}

export interface SignedPullDeps {
  /** The sign-in arguments for this call (signedInArgs with the call as its target). */
  cookies?: (target: readonly string[]) => Promise<string[]>;
  /** True when the guard already knows the video needs sign-in (no anonymous call is wasted on it). */
  knownGated?: (videoId: string) => boolean;
  /** False while the anonymous lane is retired or paused: the pull goes signed in first, with no anonymous try. */
  anonOpen?: () => boolean;
}

/**
 * One YouTube pull about one video, anonymous first and signed in only when it is worth it (signedRetryWorth), or
 * signed in only when the guard already knows the video is age-gated or the anonymous lane is retired or paused. A
 * signed-in try is never followed by an anonymous one: its failure (or its own lane's refusal) is what the caller sees,
 * and the caller moves to its usual fallbacks. Searches, listings, non-YouTube calls and Pulse's own videos are never
 * signed in. Logs which lane served the pull.
 */
export async function signedPull<T>(
  args: readonly string[],
  attempt: (args: string[]) => Promise<T>,
  o: SignedPullOptions,
  deps: SignedPullDeps = {},
): Promise<T> {
  const id = videoIdOf(args);
  if (!o.enabled || !id || laneOfCall(args) === "signed")
    return attempt([...args]);
  const purpose = o.purpose ?? "clip";
  const cookies =
    deps.cookies ??
    ((t: readonly string[]) =>
      signedInArgs(
        { ytdlpCookiesFile: o.cookiesFile ?? envCookiesFile() },
        ytGuard,
        fs.statSync,
        t,
      ));
  const knownGated =
    deps.knownGated ?? ((v: string) => guardActive() && ytGuard.needsSignIn(v));
  const anonOpen = deps.anonOpen ?? (() => !guardActive() || ytGuard.anonOpen());
  const served = (lane: "anon" | "signed") =>
    log("info", "youtube pull served", { lane, videoId: id, what: o.what });
  const signedTry = async (signed: string[]): Promise<T> => {
    const r = await withYtPurpose(purpose, () => attempt([...signed, ...args]));
    served("signed");
    return r;
  };
  if (knownGated(id) || !anonOpen()) {
    const signed = await cookies(args);
    // Signed in only: never made again anonymously, whatever the answer.
    if (signed.length) return signedTry(signed);
  }
  try {
    const r = await attempt([...args]);
    served("anon");
    return r;
  } catch (err) {
    if (!signedRetryWorth(err)) throw err;
    const signed = await cookies(args);
    if (!signed.length) throw err;
    log("info", "anonymous pull refused, trying the signed-in lane", {
      videoId: id,
      what: o.what,
      why: isYtPaused(err) ? "anonymous lane paused" : "age gate",
    });
    try {
      return await signedTry(signed);
    } catch (err2) {
      log("info", "signed-in pull failed too", {
        videoId: id,
        what: o.what,
        error: errorMessage(err2).split("\n")[0],
      });
      // The guard refusing the signed-in try (share used, paused, Pulse's own video) says nothing new: the caller
      // sees the first failure and moves to its usual fallbacks.
      throw isYtPaused(err2) ||
        (err2 as Error | undefined)?.name === "YtOwnChannelError"
        ? err
        : err2;
    }
  }
}
