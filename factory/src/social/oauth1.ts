// OAuth 1.0a request signing (HMAC-SHA1), as X's API requires for posting
// on a user's behalf. Pure apart from the nonce and clock, which are injectable.

import crypto from "node:crypto";

export interface OAuth1Keys {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** The Authorization header for one request. `params` are query or form parameters that are part of the signature (not JSON or multipart bodies). */
export function oauth1Header(
  method: string,
  url: string,
  keys: OAuth1Keys,
  params: Record<string, string> = {},
  nonce = crypto.randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000).toString(),
): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: keys.token,
    oauth_version: "1.0",
  };
  const all: Array<[string, string]> = [
    ...Object.entries(oauth),
    ...Object.entries(params),
    ...[...u.searchParams.entries()],
  ];
  const paramString = all
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `${method.toUpperCase()}&${enc(`${u.origin}${u.pathname}`)}&${enc(paramString)}`;
  const key = `${enc(keys.consumerSecret)}&${enc(keys.tokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", key)
    .update(base)
    .digest("base64");
  return (
    "OAuth " +
    Object.entries({ ...oauth, oauth_signature: signature })
      .map(([k, v]) => `${enc(k)}="${enc(v)}"`)
      .join(", ")
  );
}
