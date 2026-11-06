import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRockstarDate, newswireItems, newswireArticle } from "../src/discovery/newsrooms.ts";

test("Rockstar dates are New York time", () => {
  assert.equal(parseRockstarDate("10/15/26, 1:00 PM"), "2026-10-15T17:00:00.000Z", "EDT is UTC-4");
  assert.equal(parseRockstarDate("12/2/26, 9:30 AM"), "2026-12-02T14:30:00.000Z", "EST is UTC-5");
  assert.equal(parseRockstarDate("12/2/26, 12:05 AM"), "2026-12-02T05:05:00.000Z");
  assert.equal(parseRockstarDate("not a date"), undefined);
});

test("the Newswire list becomes official feed items with their press image and game", () => {
  const items = newswireItems({ posts: { results: [
    { id: "a1", url: "/newswire/article/a1/watch-the-trailer", title: "Watch the Grand Theft Auto VI Launch Trailer", created: "10/15/26, 1:00 PM", primary_tags: [{ name: "Grand Theft Auto VI" }], preview_images_parsed: { newswire_block: { d16x9: "https://media/x.jpg" } } },
    { id: "b2", url: "/newswire/article/b2/halloween", title: "Halloween Thrills All Month", created: "10/1/26, 10:00 AM", primary_tags: [{ name: "GTA Online" }], preview_images_parsed: null },
    { id: "c3", url: "", title: "broken", created: "x" },
  ] } });
  assert.equal(items.length, 2);
  assert.equal(items[0]!.url, "https://www.rockstargames.com/newswire/article/a1/watch-the-trailer");
  assert.equal(items[0]!.title, "Watch the Grand Theft Auto VI Launch Trailer", "the game is already named");
  assert.equal(items[1]!.title, "GTA Online: Halloween Thrills All Month");
  assert.equal(items[0]!.sourceKind, "official");
  assert.equal(items[0]!.imageUrl, "https://media/x.jpg");
});

test("a Newswire post gives its text and its whole gallery", () => {
  const art = newswireArticle({ post: { title: "GTA VI Collection Now at the Rockstar Store", subtitle: "Shop New Apparel and Collectibles", tina: { payload: { content: [
    { type: "text", text: "<p>The Grand Theft Auto VI Collection is now available at the Rockstar Store, with apparel and collectibles.</p>" },
    { type: "image", src: "/tina-uploads/posts/759875393o5253/dca8f1d9.jpg" },
    { type: "image", src: "/tina-uploads/posts/759875393o5253/02d7933d.jpg" },
    { type: "image", src: "/tina-uploads/posts/759875393o5253/dca8f1d9.jpg" },
  ] } } } }, "https://www.rockstargames.com/newswire/article/759875393o5253/x");
  assert.equal(art?.images?.length, 2);
  assert.equal(art?.images?.[0], "https://media-rockstargames-com.akamaized.net/tina-uploads/posts/759875393o5253/dca8f1d9.jpg");
  assert.match(art!.text, /^Shop New Apparel and Collectibles\nThe Grand Theft Auto VI Collection is now available/);
});
