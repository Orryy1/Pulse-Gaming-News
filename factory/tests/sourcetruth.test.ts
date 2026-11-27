// The Elden Ring questline Short (ep_20261104_4aa2f60b): a Steam reprint's teaser reached the writer, which said the
// post "runs thin", named no price or date, and told viewers to hold off pre-ordering a free community event.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  absenceClaims,
  absenceProblems,
  preorderProblems,
  SOURCE_TRUTH_RULE,
} from "../src/editorial/shortrules.ts";
import { factCheckPrompt, scriptPrompt } from "../src/editorial/editorial.ts";
import {
  bbcodeToText,
  parseSteamNewsPage,
  richestSourceChars,
  steamNewsPost,
  thinSourceProblem,
  THIN_SOURCE_CHARS,
} from "../src/discovery/article.ts";

const ELDEN =
  "Elden Ring just named something called Path of the Elden Lord. The rest of the post runs thin. It names no price, no platforms and no release date. If you're tempted to pre-order anything, we'd wait.";

test("absence claims are caught, line by line", () => {
  const lines = absenceClaims(ELDEN);
  assert.deepEqual(lines, [
    "The rest of the post runs thin.",
    "It names no price, no platforms and no release date.",
  ]);
  assert.equal(absenceProblems(ELDEN).length, 2);
  for (const said of [
    "Bandai hasn't said when the next questline starts.",
    "The trailer is silent on the price.",
    "There's no word yet on a Switch 2 version.",
    "A name and little else.",
    "Sony did not confirm a release date.",
  ])
    assert.equal(absenceClaims(said).length, 1, said);
});

test("lines that tell the story are not absence claims", () => {
  for (const said of [
    "The questline runs from November 2 to November 28.",
    "Your save carries over, with no price increase for PS Plus.",
    "It's free, and the reward is a Twitch badge.",
    "Starfield's second expansion has been delayed to early 2027.",
    "No one saw the price coming: $79.99 on Switch 2.",
  ])
    assert.deepEqual(absenceClaims(said), [], said);
});

test("buying advice needs something for sale in the sources", () => {
  const source =
    "Bandai Namco has kicked off Path of the Elden Lord, the third of four community questlines, running November 2 to 28. Completing the goals unlocks artwork and a Twitch Chat Badge.";
  assert.equal(preorderProblems(ELDEN, source).length, 1);
  assert.equal(
    preorderProblems(ELDEN, "Pre-orders open today at $69.99.").length,
    0,
  );
  assert.equal(
    preorderProblems("The questline runs all month.", source).length,
    0,
  );
});

test("the writer and the fact check both carry the source-truth rule", () => {
  assert.ok(scriptPrompt(false).includes(SOURCE_TRUTH_RULE));
  assert.match(SOURCE_TRUTH_RULE, /questline/);
  assert.match(factCheckPrompt(), /does not say or leaves out/);
  assert.match(factCheckPrompt(), /new game, DLC/);
});

test("a Steam News post's body comes from the page's own event data, with a reprint's read-more link", () => {
  assert.deepEqual(
    steamNewsPost(
      "https://store.steampowered.com/news/group/38666666/view/719046798538178714",
    ),
    { kind: "group", id: "38666666", gid: "719046798538178714" },
  );
  assert.deepEqual(
    steamNewsPost("https://store.steampowered.com/news/app/238960/view/66725"),
    { kind: "app", id: "238960", gid: "66725" },
  );
  assert.equal(steamNewsPost("https://www.ign.com/articles/x"), undefined);

  const events = [
    {
      gid: "719046798538178714",
      event_name: "Elden Ring: Path Of The Elden Lord Officially Announced",
      jsondata: '{ "read_more_link":"https:\/\/screenrant.com\/elden-ring-path-of-the-elden-lord\/" }',
      announcement_body: {
        gid: "1",
        body: "[img]https://x/y.jpg[/img] [url=https://screenrant.com/tag/elden-ring/][i][b]Elden Ring[/b][/i][/url] fans have recently ventured back into the Lands Between.",
      },
    },
  ];
  const attr = JSON.stringify(events)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const html = `<html><body><div id="application_config" data-partnereventstore="${attr}"></div></body></html>`;
  const post = parseSteamNewsPage(html, "719046798538178714");
  assert.ok(post);
  assert.equal(post.title, "Elden Ring: Path Of The Elden Lord Officially Announced");
  assert.equal(
    post.text,
    "Elden Ring fans have recently ventured back into the Lands Between.",
  );
  assert.equal(post.readMore, "https://screenrant.com/elden-ring-path-of-the-elden-lord/");
  assert.equal(parseSteamNewsPage("<html><body>nothing</body></html>", "1"), undefined);
  assert.equal(
    bbcodeToText("[h2]Rewards[/h2][list][*]Artwork[*]A Twitch badge[/list]"),
    "Rewards\n- Artwork\n- A Twitch badge",
  );
});

test("a story whose fullest source is a teaser is too thin to write from; a second outlet's article saves it", () => {
  const teaser = {
    url: "https://store.steampowered.com/news/group/38666666/view/719046798538178714",
    summary:
      "Elden Ring fans have recently ventured back into the Lands Between to rediscover its secrets after the long-awaited release of Tarnished Edition, which finally arrived on Nintendo Switch 2 consoles on August 28, 2026.",
  };
  const problem = thinSourceProblem([], [teaser]);
  assert.match(problem ?? "", /source too thin/);
  assert.match(problem ?? "", /written from a headline/);
  // Steam's reprint fetched, still only its opening paragraph.
  assert.ok(
    thinSourceProblem([{ url: teaser.url, title: "t", text: teaser.summary }], [teaser]),
  );
  const outlet = { url: "https://screenrant.com/elden-ring-path-of-the-elden-lord/", summary: "Short." };
  const full = {
    url: outlet.url,
    title: "Path of the Elden Lord",
    text: "Bandai Namco has kicked off Path of the Elden Lord, the third of four community questlines. ".repeat(10),
  };
  assert.equal(thinSourceProblem([full], [teaser, outlet]), undefined);
  assert.ok(richestSourceChars([full], [teaser, outlet]) >= THIN_SOURCE_CHARS);
  assert.equal(thinSourceProblem([], [teaser], 0), undefined, "0 turns the gate off");
});
