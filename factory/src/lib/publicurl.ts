// Links from Reddit and RSS are other people's text. One pointing at this PC or the home network must never be
// fetched: the factory's own pages answer on 127.0.0.1 (audit, 4 Nov 2026). Every hop of a redirect is checked.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fetchWithTimeout } from "./util.ts";

const MAX_REDIRECTS = 5;

function privateV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Is this address on this machine, the home network or otherwise not the public internet? */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  const v6 = ip.toLowerCase().split("%")[0]!;
  // An IPv4 address written as IPv6 ("::ffff:127.0.0.1", which URL parsing turns into "::ffff:7f00:1").
  const dotted = v6.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return privateV4(dotted[1]!);
  const hex = v6.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1]!, 16),
      lo = parseInt(hex[2]!, 16);
    return privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return (
    v6 === "::" ||
    v6 === "::1" ||
    /^f[cd]/.test(v6) || // unique local
    /^fe[89ab]/.test(v6) || // link local
    /^ff/.test(v6) // multicast
  );
}

type Lookup = (host: string) => Promise<string[]>;
const dnsLookup: Lookup = async (host) =>
  (await lookup(host, { all: true })).map((a) => a.address);

/** Why a link may not be fetched, or undefined when it is an ordinary public web address. */
export async function publicUrlProblem(
  url: string,
  resolve: Lookup = dnsLookup,
): Promise<string | undefined> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "not a URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return `scheme ${u.protocol}`;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal|lan)$/.test(host))
    return `private host ${host}`;
  if (isIP(host))
    return privateAddress(host) ? `private address ${host}` : undefined;
  const addresses = await resolve(host);
  const bad = addresses.find(privateAddress);
  return bad ? `${host} resolves to private address ${bad}` : undefined;
}

/** fetchWithTimeout for a link from the outside world: refuses private addresses, on every redirect too. */
export async function fetchPublic(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
  resolve: Lookup = dnsLookup,
): Promise<Response> {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = await publicUrlProblem(at, resolve);
    if (problem) throw new Error(`refused link: ${problem}`);
    const res = await fetchWithTimeout(
      at,
      { ...init, redirect: "manual" },
      timeoutMs,
    );
    const to = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !to) return res;
    at = new URL(to, at).toString();
  }
  throw new Error("refused link: too many redirects");
}
