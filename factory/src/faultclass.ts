// Which failures may pause every lane (src/pipeline.ts advanceStep). Only a platform's refusal of the factory itself
// (an expired login, an exhausted quota, a rejected key) justifies stopping new stories; a fault in one video's own
// content drops that video and nothing else.
//
// Twice the words of a video were read as the platform's: on 6 Nov 2026 a writer's refusal ("refused") and on
// 14 Nov 2026 a fact check that said "quotation" (/quota/ matched inside it) each paused every lane for 12 hours
// and told the owner to reconnect YouTube. The flight simulator (src/flightsim) found the next one before it
// happened: writer's notes in a Horizon Forbidden West Short matched /forbidden/. So: the factory's own content
// stops are recognised first, quoted text (a writer's line, a fact check's quote, a title) is never read, and the
// platform words must stand as whole words.

/** The factory's own stops for one video's content (fact check, QA, clarity, spoilers, writer's notes, bad metadata). */
export const CONTENT_FAULT =
  /fact-?check|QA failed|clarity|spoiler|graphics audit|suggestive|word count|writer's notes|not voiced|refused after widening|recap story "|explainer part "|empty slate|\binvalid(?:Title|Description|Tags|CategoryId|VideoMetadata)\b/i;

/** A platform refusing the factory's login, key or quota, read as whole words outside quoted text. */
export const PLATFORM_FAULT =
  /invalid_grant|\bquota(?:Exceeded)?\b|\bdailyLimitExceeded\b|\bcredentials?\b|\bapi[ _-]key\b|\bx-api-key\b|\bforbidden\b|\bunauthori[sz]ed\b|\b(?:token|login|access|request) (?:was )?refused\b/i;

/** Quoted spans: straight or curly double quotes, at most 400 characters each. */
const QUOTED = /"[^"\n]{0,400}"|“[^”\n]{0,400}”/g;

/** A login or key fault in particular (the owner must reconnect), rather than a quota that resets by itself. */
const LOGIN_FAULT =
  /invalid_grant|\bcredentials?\b|\bunauthori[sz]ed\b|\b(?:token|login|access) (?:was )?refused\b|HTTP 401\b/i;
const YOUTUBE =
  /youtube|invalid_grant|videos\.insert|upload|captions|thumbnails|playlistItems|commentThreads/i;
const MODEL_KEY = /x-api-key|anthropic|claude/i;

/** The message with every quoted span blanked (pure). */
export function unquoted(msg: string): string {
  return msg.replace(QUOTED, '""');
}

/** True when a failure is about one video's own content, never the platform (pure). */
export function isContentFault(msg: string): boolean {
  return CONTENT_FAULT.test(msg);
}

/** True when the words of a failure name a platform refusing the factory itself (pure). */
export function isPlatformWords(msg: string): boolean {
  return PLATFORM_FAULT.test(unquoted(msg));
}

/**
 * Whether a fatal failure at a step should pause new stories (pure): never for content; at the upload steps any
 * other fatal refusal (YouTube said no to the factory); elsewhere only when the platform's words say so.
 */
export function pausesEveryLane(
  msg: string,
  status: string,
  lane: string,
): boolean {
  if (isContentFault(msg)) return false;
  if (lane === "twin") return false; // the twin channel's login or quota must never pause the main channel
  if (status === "uploading" || status === "uploaded") return true;
  return isPlatformWords(msg);
}

/** What the owner is told when a platform fault paused every lane: the service that refused, and what to do (pure). */
export function platformAlert(
  msg: string,
  status: string,
  pauseHours: number,
): string {
  const text = unquoted(msg).slice(0, 300);
  const login = LOGIN_FAULT.test(unquoted(msg));
  const youtube =
    status === "uploading" ||
    status === "uploaded" ||
    YOUTUBE.test(unquoted(msg));
  if (youtube && login)
    return `⚠️ Needs you: YouTube refused the factory's login (${text}). New stories are paused for ${pauseHours}h. Reconnect YouTube from the dashboard.`;
  if (youtube)
    return `⚠️ Needs you: YouTube refused an upload (${text}). New stories are paused for ${pauseHours}h. If it is the daily quota it resets by itself at midnight Pacific; nothing to reconnect.`;
  if (MODEL_KEY.test(unquoted(msg)))
    return `⚠️ Needs you: the model's API key was refused (${text}). New stories are paused for ${pauseHours}h. Check ANTHROPIC_API_KEY; YouTube is fine.`;
  return `⚠️ Needs you: a service refused the factory (${text}). New stories are paused for ${pauseHours}h. YouTube is not the one at fault.`;
}
