# URL-Fetch Safety / SSRF Audit — 2026-04-21

## TL;DR

Pulse Gaming's hunter/processor/images pipelines fetch URLs from
Reddit posts, RSS items, og:image tags on third-party article pages,
and Steam/Pexels/Bing/Unsplash/IGDB/TMDB APIs. Most of those are
hard-coded safe hosts. A meaningful slice are **untrusted
externally-supplied URLs** (og:image, Reddit linked_url, article
inline-scraped images) where a malicious upstream could point us at
cloud metadata endpoints or internal IPs.

**Shipped in this commit:**

- `lib/safe-url.js` + 21 unit tests. Pure helper, exported as
  `classifyOutboundUrl`, `isSafeOutboundUrl`, `assertSafeOutboundUrl`,
  `MAX_URL_LENGTH`.

**Deliberately NOT shipped in this commit:** wiring the helper into
the call sites. That touches ~30 places across hunter / processor /
images_download / entities / analytics / fetch_broll, and every change
must be carefully tested against real upstream responses or known
sources will silently start returning nothing. Per the overnight
brief's "if broad, stop and document" rule, this doc is the
deliverable for that phase and the wiring PR lands separately with
per-site test fixtures.

---

## What `lib/safe-url.js` rejects today

| Check                        | Example rejected          | Why                                 |
| ---------------------------- | ------------------------- | ----------------------------------- |
| Non-http(s) scheme           | `file:///etc/passwd`      | Local file exfil via axios          |
| Non-http(s) scheme           | `javascript:alert(1)`     | Cross-origin redirects              |
| Non-http(s) scheme           | `data:text/html,…`        | In-page image exfil                 |
| IPv4 loopback                | `http://127.0.0.1/`       | Local service probe                 |
| IPv4 RFC1918                 | `http://10.0.0.5/`        | Internal network probe              |
| IPv4 link-local              | `http://169.254.169.254/` | **GCP/AWS/Azure metadata endpoint** |
| IPv4 CGNAT                   | `http://100.64.0.1/`      | Often ISP internal                  |
| IPv6 loopback                | `http://[::1]/`           | Local service probe                 |
| IPv6 link-local/unique-local | `http://[fe80::1]/`       | Internal network probe              |
| `localhost` hostname         | `http://localhost:3000/`  | Bypass IP-literal check             |
| URL > 2048 chars             | very long URLs            | Defensive against parser edge cases |

**DNS resolution is NOT performed.** A malicious host with a CNAME to
169.254.169.254 bypasses this helper. Adding DNS check is a separate
engineering project (latency, caching, IPv6, race-vs-fetch).

---

## Call-site classification

Legend:

- ✅ **hardcoded** — URL is assembled from a constant and/or env-only
  inputs. No untrusted component. No need for `safe-url`.
- ⚠️ **source-derived** — URL comes from a feed/post/article. Untrusted.
  Should call `assertSafeOutboundUrl` before the outbound axios call.
- 🔒 **needs auth-scrub** — already gated (e.g. /auth callback target)
  but should defensively validate.

### ✅ Hardcoded trusted hosts (no change required)

| Call site                                       | Host                                                          |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `hunter.js` Reddit auth + listings              | `www.reddit.com`, `oauth.reddit.com`                          |
| `hunter.js` Steam search                        | `store.steampowered.com`, `cdn.akamai.steamstatic.com`        |
| `hunter.js` RAWG                                | `api.rawg.io`                                                 |
| `hunter.js` IGDB/Twitch auth                    | `id.twitch.tv`, `api.igdb.com`                                |
| `upload_*.js` (YouTube, TikTok, IG, FB)         | `graph.facebook.com`, `open.tiktokapis.com`, `googleapis.com` |
| `analytics.js` YouTube / TikTok / IG stats      | same as above                                                 |
| `audio.js` / `entities.js` (Wikipedia)          | `api.elevenlabs.io`, `en.wikipedia.org`                       |
| `fetch_broll.js` IGDB/Twitch + yt-dlp bootstrap | hardcoded hosts                                               |
| `discord_approve.js` webhook                    | `DISCORD_WEBHOOK_URL` env — operator-set                      |

### ⚠️ Source-derived URLs (wire `safe-url` here)

These are the real SSRF surface. Each call site should gain an
`assertSafeOutboundUrl(candidateUrl)` before its axios call. If the
assertion throws, log a structured reason and skip — never let a
bad input take down a pipeline step.

| Call site                                                   | Source of URL                                                                                                                           | Risk                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `images_download.js` `downloadImage(url)`                   | `story.article_image` (og:image from third-party article), Steam screenshot paths, Pexels/Unsplash/Bing scraped URLs, Reddit thumbnails | High — any malicious upstream could redirect us to cloud metadata        |
| `images_download.js` `downloadVideoClip(url)`               | Steam movie URLs, IGDB/YouTube trailer fallback                                                                                         | Medium — Steam is trusted, but the IGDB/YouTube fallback is derived      |
| `images_download.js` article-page scraping (lines ~347–412) | scraped `<img>` / `srcset` / og:image from any article page                                                                             | **Highest** — attacker controls a news article → og:image can be any URL |
| `processor.js` `fetchSourceMaterial(story)`                 | `story.article_url`                                                                                                                     | High — untrusted                                                         |
| `processor.js` `fetchPageText(url)`                         | passed-in URL chain                                                                                                                     | High — untrusted                                                         |
| `hunter.js` RSS feed URLs                                   | `feed.url` (constant per outlet)                                                                                                        | Low — our whitelist                                                      |
| `hunter.js` RSS item enclosure / linked_url                 | any URL in an RSS `<enclosure>`                                                                                                         | High — attacker-controlled outlet body                                   |
| `scraper.js`                                                | arbitrary article URLs                                                                                                                  | High                                                                     |
| `notify.js` / Discord webhook                               | `DISCORD_WEBHOOK_URL` — operator-set                                                                                                    | Low                                                                      |

### 🔒 Needs auth-scrub (defence in depth)

- `/auth/tiktok/callback` → `exchangeCode(code)` posts to TikTok's
  hardcoded host, so the `code` query param doesn't reach a URL
  fetcher.
- `/auth/facebook/callback` → same story.

---

## Wiring plan (NOT in this commit)

Each of these PRs is small enough to review and test individually.
They should land one at a time, with fixtures exercising the happy
path of each known source so we notice if a valid upstream URL
starts getting rejected.

1. **`images_download.js`** — wrap `downloadImage` + `downloadVideoClip`
   so every URL passes `assertSafeOutboundUrl` before the axios call.
   The article-inline scraper inside `getBestImage` iterates `<img>`
   tags — filter the list before looping. Fixtures must cover:
   - Steam `akamai.steamstatic.com` URLs (happy path)
   - Reddit `i.redd.it` / `external-preview` (happy path)
   - Pexels/Unsplash/Bing happy path
   - A fixture og:image of `http://169.254.169.254/metadata` — must
     be skipped with `[images] skipping unsafe URL: ipv4_private_or_reserved`

2. **`processor.js` `fetchSourceMaterial` + `fetchPageText`** — same
   pattern. Fixtures: real article URL, rejected internal URL.

3. **`hunter.js` RSS item handling** — scan item links/enclosures
   before following. Fixture with a poisoned enclosure URL.

4. **`fetch_broll.js`** — IGDB URLs go through the guard even though
   we already trust IGDB, just so that the helper is used uniformly.

Each wiring PR should:

- Add no new runtime dependencies.
- Log the rejection reason (`[images] skipping unsafe URL: <reason>`)
  at the same log level as other "non-fatal, skip" messages.
- Keep all currently-known sources in their existing test fixtures
  passing. If one fails, the helper is too strict; either relax it
  or add an explicit allowlist override.

---

## Defence-in-depth items deliberately out of scope today

1. **Block redirects to private IPs.** axios follows 3xx by default.
   Even a `safe-url`-validated initial URL could 302 to an internal
   endpoint. Fix: `maxRedirects: 0` + manual chase with revalidation,
   or `validateStatus` + `response.request.res.responseUrl` check.
   Needs per-call-site attention.
2. **DNS resolution check.** Malicious CNAMEs dodge the literal-IP
   check. Requires a caching DNS layer — non-trivial.
3. **Byte-size caps.** Most call sites already pass
   `maxContentLength` to axios; confirm consistency in the wiring PRs.
4. **Timeouts.** Already mostly in place via per-call axios
   `timeout:` options. Audit that nothing calls axios without one
   during the wiring work.
5. **Private IP ranges via hex / octal.** `http://0x7f.0.0.1/` parses
   as 127.0.0.1 on many clients. Our `isIpv4Literal` check uses
   decimal-only regex. Node's `URL` normalises these — confirm.

---

## Current risk assessment

With the helper shipped but not wired, the actual risk posture is
unchanged from yesterday: **medium**. Pulse Gaming fetches are not
currently targeted by a known adversary, and the content-cache
endpoints (`/api/story-image`, `/api/download`) that COULD have
served the fruits of a successful SSRF to an attacker are already
gated by the draft-vs-public rule from commit `c03c74c`. So the
concrete SSRF → exfiltration chain requires (a) a malicious article
og:image that (b) resolves to an internal endpoint that (c) returns
cacheable content and (d) the attacker then finds a way to read our
output cache.

The wiring work is worth doing, but it's hardening not plugging a
live leak.

---

## References

- `lib/safe-url.js` — the helper and its test fixtures
- `tests/services/safe-url.test.js` — 21 unit tests (IPv4/IPv6
  boundaries, scheme rejects, known-source happy paths, length cap,
  malformed input)
- [OWASP SSRF cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [GCP metadata endpoint](https://cloud.google.com/compute/docs/metadata/querying-metadata) — the primary high-value SSRF target on Railway's infrastructure
