import { test } from "node:test";
import assert from "node:assert/strict";
import { productsFor, affiliateBlock, amazonUrl, affiliateCommentLine } from "../src/editorial/affiliate.ts";
import { videoMetadata } from "../src/pipeline.ts";
import { goodScript } from "./helpers.ts";

test("links every game and named piece of hardware, best first, deduped", () => {
  const s = goodScript({ game_title: "Call of Duty®: Black Ops 7", headline: "Black Ops 7 hits PS5 Pro", hook: "Black Ops 7 runs at 120fps on PS5 Pro and Xbox Series X." });
  const p = productsFor(s);
  assert.deepEqual(p.map((x) => x.label), ["Call of Duty: Black Ops 7", "PS5 Pro", "Xbox Series X"]);
  const ranking = goodScript({ entries: [3, 1, 2].map((rank) => ({ rank, game_title: `Resident Evil ${rank}`, steam_search_term: "", year: 2000, platforms: "PC" })) });
  assert.deepEqual(productsFor(ranking).slice(0, 3).map((x) => x.label), ["Resident Evil 1", "Resident Evil 2", "Resident Evil 3"]);
  assert.equal(productsFor(goodScript({ game_title: "Bad Cheese" }), true).filter((x) => x.label === "Bad Cheese").length, 0, "a free game is not linked");
});

test("long videos get one clean link per product (US first), Shorts get none, the disclosure is always there", () => {
  assert.equal(amazonUrl("Starfield game", "orryy0d-21", "uk"), "https://www.amazon.co.uk/s?k=Starfield+game&tag=orryy0d-21");
  const long = { ...goodScript(), runtime: "long" as const };
  const uk = affiliateBlock(long, { uk: "orryy0d-21" });
  assert.match(uk, /🛒 Starfield on Amazon: https:\/\/www\.amazon\.co\.uk\/s\?k=Starfield\+game&tag=orryy0d-21/);
  assert.match(uk, /As an Amazon Associate I earn from qualifying purchases\./);
  const both = affiliateBlock(long, { uk: "orryy0d-21", us: "pulse-20" });
  assert.match(both, /🛒 Starfield on Amazon: https:\/\/www\.amazon\.com\/s\?k=Starfield\+game&tag=pulse-20$/m);
  assert.doesNotMatch(both, /amazon\.co\.uk/, "no per-country pairs");
  assert.equal(affiliateBlock(goodScript(), { uk: "orryy0d-21", us: "pulse-20" }), "", "links are not clickable in a Short's description");
  assert.equal(affiliateBlock(long, undefined), "");
  assert.match(affiliateCommentLine(goodScript(), { uk: "orryy0d-21" }), /Grab Starfield here: https:\/\/www\.amazon\.co\.uk/);
});

test("the description carries the shop block under the summary", () => {
  const ep: any = { id: "e", lane: "longform", story_json: { headline: "x", items: [{ source: "IGN", url: "https://ign.com/a", sourceKind: "outlet" }] }, script_json: { ...goodScript(), runtime: "long" }, assets_json: {}, publish_at: null };
  const m = videoMetadata(ep, "public", true, { uk: "orryy0d-21" });
  const shopAt = m.description.indexOf("Affiliate links");
  assert.ok(shopAt > 0 && shopAt < m.description.indexOf("\nSources:\n"), "after the summary, before the sources");
  assert.ok(m.description.length <= 5000);
});

import { storeFor, shopPageHtml, taggedStores } from "../src/editorial/affiliate.ts";

test("viewers land in their own Amazon store", () => {
  assert.equal(storeFor("US"), "us");
  assert.equal(storeFor("gb"), "uk");
  assert.equal(storeFor("IE"), "uk");
  assert.equal(storeFor("CA"), "ca");
  assert.equal(storeFor("NZ"), "au");
  assert.equal(storeFor("AT"), "de");
  assert.equal(storeFor("BE"), "fr");
  assert.equal(storeFor("PT"), "es");
  assert.equal(storeFor("IT"), "it");
  assert.equal(storeFor(""), "us");
  assert.equal(storeFor("BR"), "us");
});

test("other national stores sit behind one shop link, and the shop page leads with the viewer's store", () => {
  const tags = { uk: "orryy0d-21", us: "orryy-20", ca: "orryy04-20", de: "orryy02f-21", au: "orryy-22", shopUrl: "https://pulse.orryy.com/shop/ep_1" };
  assert.deepEqual(taggedStores(tags), ["us", "uk", "ca", "au", "de"]);
  const s = { ...goodScript(), game_title: "Resident Evil 4", entries: undefined, runtime: "long" as const };
  const block = affiliateBlock(s, tags);
  assert.match(block, /🌍 Every link, with your own country's Amazon store: https:\/\/pulse\.orryy\.com\/shop\/ep_1/);
  assert.equal((block.match(/amazon\.ca/g) ?? []).length, 0);
  const html = shopPageHtml({ title: "RE4", products: [{ label: "Resident Evil 4", query: "Resident Evil 4 game" }], tags, country: "DE" });
  assert.match(html, /class="buy"[^>]*href="https:\/\/www\.amazon\.de\/s\?k=Resident\+Evil\+4\+game&amp;tag=orryy02f-21"/);
  assert.match(html, /Find it on Amazon Germany/);
  assert.match(html, /amazon\.com\.au/);
  assert.match(html, /As an Amazon Associate/);
});
