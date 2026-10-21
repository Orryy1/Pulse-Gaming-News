import { test } from "node:test";
import assert from "node:assert/strict";
import { articleSlug, idTailOf, articleParagraphs, rssFeed, articlePage, indexPage } from "../src/web/site.ts";
import { goodScript } from "./helpers.ts";

const ep = (id: string, over = {}) => ({
  id,
  lane: "news",
  youtube_video_id: "HLoxoMh65_0",
  script_json: goodScript({ game_title: "The Wolf Among Us Remastered", ...over }),
  story_json: { items: [{ source: "IGN", url: "https://ign.com/x" }] },
  live_at: "2026-10-18T12:00:00.000Z",
});

test("article slugs are readable and find their episode", () => {
  const e = ep("ep_20261018_14ffc0f4");
  const slug = articleSlug(e);
  assert.match(slug, /^[a-z0-9-]+-14ffc0f4$/);
  assert.equal(idTailOf(slug), "14ffc0f4");
});

test("the article is the story in prose with its video, sources and shop", () => {
  const e = ep("ep_20261018_14ffc0f4");
  const paras = articleParagraphs(e.script_json);
  assert.equal(paras[0], e.script_json.hook);
  const html = articlePage(e, "https://pulse.orryy.com", { uk: "orryy0d-21", us: "orryy-20" }, "US");
  assert.match(html, /youtube-nocookie\.com\/embed\/HLoxoMh65_0/);
  assert.match(html, /"@type":"NewsArticle"/);
  assert.match(html, /<a href="https:\/\/ign\.com\/x"/);
  assert.match(html, /amazon\.com\/s\?k=/);
  assert.match(html, /AI assistance/);
  assert.match(indexPage([e], "https://pulse.orryy.com"), /\/news\/[a-z0-9-]+-14ffc0f4/);
});

test("the RSS feed is well formed, newest first, one guid per episode", () => {
  const xml = rssFeed([ep("ep_20261018_aaaa1111"), ep("ep_20261017_bbbb2222", { hook: "Fish & chips <b>" })], "https://pulse.orryy.com");
  assert.match(xml, /^<\?xml version="1\.0"/);
  assert.equal((xml.match(/<item>/g) ?? []).length, 2);
  assert.match(xml, /<guid isPermaLink="false">pulse-ep_20261018_aaaa1111<\/guid>/);
  assert.match(xml, /Fish &amp; chips &lt;b&gt;/);
  assert.ok(xml.indexOf("aaaa1111") < xml.indexOf("bbbb2222"));
});

import { gameSlug, gamesOf, homePage, gamePage, sitemapXml, newsSitemapXml, robotsTxt, parseChannelFeed, staticPage, hubIndexable } from "../src/web/site.ts";

test("one game hub however a script spells the game", () => {
  assert.equal(gameSlug("GTA VI"), "grand-theft-auto-6");
  assert.equal(gameSlug("Grand Theft Auto 6"), "grand-theft-auto-6");
  assert.equal(gameSlug("Call of Duty®: Modern Warfare® III"), "call-of-duty-modern-warfare-3");
  const a = ep("ep_20261018_aaaa1111", { game_title: "GTA VI" });
  const b = ep("ep_20261017_bbbb2222", { game_title: "Grand Theft Auto 6" });
  const c = ep("ep_20261016_cccc3333", { game_title: "New games this week" });
  const hubs = gamesOf([a, b, c]);
  assert.equal(hubs.length, 1);
  assert.equal(hubs[0]!.episodes.length, 2);
  assert.ok(hubIndexable(hubs[0]!));
});

test("home, hub and legal pages render with the brand, facts and disclosure", () => {
  const a = ep("ep_20261018_aaaa1111", { game_title: "Hades II" });
  const home = homePage([a], "https://pulsegmg.com", gamesOf([a]));
  assert.match(home, /<link rel="canonical" href="https:\/\/pulsegmg\.com\/">/);
  assert.match(home, /href="\/games\/hades-2"/);
  const hub = gamesOf([a])[0]!;
  const html = gamePage(hub, { term: "Hades II", appId: 1145350, name: "Hades II", prices: { usd: "$29.99", gbp: "£24.99" }, releaseDate: "25 Sep, 2025", checkedAt: "2026-10-19T00:00:00Z", fetchedAt: "2026-10-19T00:00:00Z" }, "https://pulsegmg.com", { uk: "orryy0d-21", us: "orryy-20" }, "US");
  assert.match(html, /\$29\.99 · £24\.99/);
  assert.match(html, /amazon\.com\/s\?k=Hades/);
  assert.match(html, /"@type":"VideoGame"/);
  assert.doesNotMatch(html, /noindex/);
  assert.match(gamePage(hub, undefined, "https://pulsegmg.com", { uk: "x" }), /noindex/);
  assert.match(staticPage("disclosure", "https://pulsegmg.com")!, /Amazon Services LLC Associates Program/);
  assert.equal(staticPage("nope", "https://pulsegmg.com"), undefined);
});

test("sitemaps, robots and the channel feed", () => {
  const a = ep("ep_20261018_aaaa1111");
  const xml = sitemapXml([a], [], "https://pulsegmg.com");
  assert.match(xml, /<loc>https:\/\/pulsegmg\.com\/news\/[a-z0-9-]+-aaaa1111<\/loc>/);
  assert.match(newsSitemapXml([a], "https://pulsegmg.com", Date.parse("2026-10-18T20:00:00Z")), /<news:publication_date>/);
  assert.doesNotMatch(newsSitemapXml([a], "https://pulsegmg.com", Date.parse("2026-10-25T20:00:00Z")), /<url>/);
  assert.match(robotsTxt("https://pulsegmg.com"), /Sitemap: https:\/\/pulsegmg\.com\/sitemap\.xml/);
  const feed = parseChannelFeed(`<feed><entry><yt:videoId>abc123</yt:videoId><title>Fish &amp; chips</title><link rel="alternate" href="https://www.youtube.com/shorts/abc123"/><published>2026-10-18T12:00:00+00:00</published></entry></feed>`);
  assert.deepEqual(feed, [{ id: "abc123", title: "Fish & chips", published: "2026-10-18T12:00:00+00:00", short: true }]);
});

test("the privacy notice says what the code does with personal data, never who runs it", () => {
  const html = staticPage("privacy", "https://pulsegmg.com")!;
  assert.match(html, /<link rel="canonical" href="https:\/\/pulsegmg\.com\/privacy">/);
  // The old notice claimed no personal data was processed. The code reads comments, sends them to Claude and keeps records.
  assert.doesNotMatch(html, /do(es)? not (collect|process|store) (any )?personal (data|information)/i);
  for (const must of [
    /a trading name of a UK sole trader/,
    /youtube\.com\/@PulseGMG/,
    /Anthropic/,
    /legitimate interests/i,
    /Reddit username/,
    /Discord user ID/,
    /Cloudflare/,
    /How long we keep it/,
    /object/,
    /acknowledge your complaint within 30 days/,
    /Data \(Use and Access\) Act 2025/,
    /Information Commission/,
    /https:\/\/ico\.org\.uk\/make-a-complaint\//,
  ])
    assert.match(html, must);
  // Burner identity: the controller is the trading name; no personal email address or postal address on the page.
  assert.doesNotMatch(html, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(html, /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/);
});
