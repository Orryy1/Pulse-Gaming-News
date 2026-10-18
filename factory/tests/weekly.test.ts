import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSteamDate, appIdsFromSearch, parseEpic } from "../src/discovery/weekly.ts";
import { validateEvergreen } from "../src/editorial/evergreen.ts";

test("Steam dates: exact days only", () => {
  assert.equal(parseSteamDate("Oct 23, 2026"), "2026-10-23");
  assert.equal(parseSteamDate("3 Nov, 2026"), "2026-11-03");
  assert.equal(parseSteamDate("Q4 2026"), undefined);
  assert.equal(parseSteamDate("Coming soon"), undefined);
});

test("app ids come from the search capsule URLs", () => {
  assert.deepEqual(appIdsFromSearch({ items: [{ name: "MW4", logo: "https://x/steam/apps/4435490/abc/capsule.jpg" }, { name: "x", logo: "nope" }] }), [{ name: "MW4", appId: 4435490 }]);
});

test("Epic: free now, free next, and nothing else", () => {
  const el = (title: string, promo: any, up: any) => ({ title, productSlug: title.toLowerCase().replace(/ /g, "-"), description: "d", keyImages: [{ type: "OfferImageWide", url: `https://cdn/${title}.jpg` }], price: { totalPrice: { fmtPrice: { originalPrice: "$19.99" } } }, promotions: { promotionalOffers: promo ? [{ promotionalOffers: [promo] }] : [], upcomingPromotionalOffers: up ? [{ promotionalOffers: [up] }] : [] } });
  const now = new Date("2026-10-18T10:00:00Z");
  const json = { data: { Catalog: { searchStore: { elements: [
    el("Bad Cheese", { startDate: "2026-10-15T15:00:00Z", endDate: "2026-10-22T15:00:00Z", discountSetting: { discountPercentage: 0 } }, null),
    el("Half Price", { startDate: "2026-10-15T15:00:00Z", endDate: "2026-10-22T15:00:00Z", discountSetting: { discountPercentage: 50 } }, null),
    el("Sker Ritual", null, { startDate: "2026-10-22T15:00:00Z", endDate: "2026-10-29T15:00:00Z", discountSetting: { discountPercentage: 0 } }),
    el("Mystery Game", null, { startDate: "2026-10-22T15:00:00Z", endDate: "2026-10-29T15:00:00Z", discountSetting: { discountPercentage: 0 } }),
  ] } } } };
  const r = parseEpic(json, now);
  assert.deepEqual(r.now.map((g) => g.title), ["Bad Cheese"]);
  assert.equal(r.now[0]!.url, "https://store.epicgames.com/en-US/p/bad-cheese");
  assert.equal(r.now[0]!.originalPrice, "$19.99");
  assert.equal(r.now[0]!.imageUrl, "https://cdn/Bad Cheese.jpg");
  assert.deepEqual(r.next.map((g) => g.title), ["Sker Ritual"]);
});

test("Release Radar scripts need four entries with release dates", () => {
  const entry = (rank: number, date?: string) => ({ rank, game_title: `G${rank}`, steam_search_term: `G${rank}`, year: 2026, platforms: "PC (Steam)", one_line: "A short line about this game and why it matters.", verdict_chip: "WATCH IT", footage: { want: "gameplay" as const, keywords: ["x"] }, ...(date ? { date } : {}) });
  const script = (entries: any[]) => ({ format: "release_radar" as const, theme: "New games", title: "Four Big Games This Week", hook: "Four big games land this week, and one could eat your whole weekend.", entries, pulse_take: { label: "OUR PICK", narration: "Watch G1 most closely of all this week because it looks like the standout release.", on_screen: "G1 is the one" }, loop_line: "So which one is landing on your wishlist first this week then?", youtube: { title: "4 Big Games Out This Week", description: "d", tags: [] }, claims: [] });
  const words = "word ".repeat(30);
  const ok = script([4, 3, 2, 1].map((r) => ({ ...entry(r, `2026-10-2${r}`), one_line: `${words.slice(0, 80)}`.trim() })));
  assert.ok(!validateEvergreen(ok).some((p) => /entries|release date/.test(p)), validateEvergreen(ok).join(" | "));
  assert.ok(validateEvergreen(script([4, 3, 2, 1].map((r) => entry(r)))).some((p) => /release date/.test(p)));
  assert.ok(validateEvergreen(script([3, 2, 1].map((r) => entry(r, "2026-10-20")))).some((p) => /entries/.test(p)));
});
