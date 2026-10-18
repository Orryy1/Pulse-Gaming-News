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
