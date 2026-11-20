import crypto from "node:crypto";
import net from "node:net";

// Node gives each address of a host 250 ms to connect, then gives up on it and tries the next. This PC has no IPv6
// route, so on a host with one IPv4 and one IPv6 address a single event-loop stall over 250 ms (a database write, boot
// work) drops a good IPv4 connection, the IPv6 one fails at once with ENETUNREACH, and fetch says "fetch failed". That
// is what the boot check's "youtube_login: unreachable" was (4 Nov 2026), and the same hosts lead the failed-feed logs.
// A real outage still fails: this only stops a healthy connection being abandoned, within undici's 10 s connect limit.
export const CONNECT_ATTEMPT_MS = 5_000;
net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_MS);

export function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const USER_AGENT = "PulseGamingNewsBot/1.0 (+https://www.youtube.com/@PulseGamingNews)";

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: { "user-agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function shortId(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ep_${d}_${crypto.randomBytes(4).toString("hex")}`;
}

/** Why a fetch failed, which its own message never says: the socket's codes, for each address tried. */
function networkCause(err: Error): string {
  const c = err.cause as
    | { code?: string; message?: string; address?: string; errors?: Array<{ code?: string; address?: string }> }
    | undefined;
  if (!c) return "";
  if (c.errors?.length)
    return c.errors.map((e) => [e.code, e.address].filter(Boolean).join(" ")).join("; ");
  return [c.code, c.address].filter(Boolean).join(" ") || (c.message ?? "");
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const why = err.message === "fetch failed" ? networkCause(err) : "";
    return why ? `${err.message} (${why})` : err.message;
  }
  return String(err);
}

/** Errors that must never be retried automatically (bad credentials, policy). */
export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalError";
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}
