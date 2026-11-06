import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAchievementsPage, rarest } from "../src/discovery/achievements.ts";
import { groundAchievements } from "../src/pipeline.ts";
import { productsFor } from "../src/editorial/affiliate.ts";
import { goodScript } from "./helpers.ts";

test("achievements and their unlock shares come out of the page's embedded data", () => {
  const html = '<script>{"loaderData":["{\\"percentages\\":{\\"256\\":10.5,\\"257\\":0.05,\\"258\\":3.2}} ... {\\"internal_key\\":256,\\"api_name\\":\\"ACH01\\",\\"name\\":\\"Elden Lord\\",\\"description\\":\\"Achieved the Elden Lord ending\\",\\"hidden\\":false,\\"archived\\":false,\\"icon_achieved\\":\\"https:\\/\\/cdn\\/a.jpg\\",\\"groupid\\":0},{\\"internal_key\\":257,\\"api_name\\":\\"ACH02\\",\\"name\\":\\"Broken\\",\\"description\\":\\"x\\",\\"hidden\\":true,\\"icon_achieved\\":\\"https:\\/\\/cdn\\/b.jpg\\"},{\\"internal_key\\":258,\\"api_name\\":\\"ACH03\\",\\"name\\":\\"Rare One\\",\\"description\\":\\"Beat it\\",\\"hidden\\":false,\\"icon_achieved\\":\\"https:\\/\\/cdn\\/c.jpg\\"}"]}</script>';
  const list = parseAchievementsPage(html);
  assert.deepEqual(list.map((a) => [a.name, a.percent]), [["Broken", 0.1], ["Rare One", 3.2], ["Elden Lord", 10.5]]);
  assert.equal(list[2]!.icon, "https://cdn/a.jpg");
  assert.deepEqual(rarest(list, 6).map((a) => a.name), ["Broken", "Rare One", "Elden Lord"]);
});

test("achievement entries are grounded in Steam's data: real names, real percentages, rarest is number one", () => {
  const data = [
    { name: "Elden Lord", game: "ELDEN RING", percent: 10.5, icon: "https://cdn/a.jpg", year: 2022 },
    { name: "Legendary Talismans", game: "ELDEN RING", percent: 17.7, icon: "https://cdn/t.jpg", year: 2022 },
  ];
  const entry = (rank: number, title: string) => ({ rank, game_title: title, steam_search_term: "x", platforms: "x", year: 2000, one_line: "l", verdict_chip: "V", footage: { want: "gameplay" as const, keywords: [] as string[] }, percent: undefined as number | undefined, icon: undefined as string | undefined });
  const out = groundAchievements({ entries: [entry(1, "legendary talismans"), entry(2, "Elden Lord"), entry(3, "Made Up Achievement")] }, data);
  assert.deepEqual(out.entries.map((e) => [e.rank, e.game_title, e.percent, e.steam_search_term, e.icon]), [
    [1, "Elden Lord", 10.5, "ELDEN RING", "https://cdn/a.jpg"],
    [2, "Legendary Talismans", 17.7, "ELDEN RING", "https://cdn/t.jpg"],
  ]);
});

test("an achievement Short sells the games, not the achievement names", () => {
  const s = goodScript({ evergreen_format: "hardest_achievements", entries: [
    { rank: 1, game_title: "Elden Lord", steam_search_term: "ELDEN RING", year: 2022, platforms: "ELDEN RING" },
    { rank: 2, game_title: "Platinum Grind", steam_search_term: "Resident Evil 4", year: 2023, platforms: "Resident Evil 4" },
  ] });
  assert.deepEqual(productsFor(s).slice(0, 2).map((p) => p.label), ["ELDEN RING", "Resident Evil 4"]);
});
