"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  fetchSubredditsNew,
} = require("../../hunter");
const { BreakingWatcher } = require("../../watcher");

const COMBINED_FEED = `
<feed>
  <entry>
    <title>Games story</title>
    <link href="https://www.reddit.com/r/Games/comments/abc123/games_story/" />
    <updated>2026-07-29T01:00:00Z</updated>
    <category term="News" />
  </entry>
  <entry>
    <title>PS5 story</title>
    <link href="https://www.reddit.com/r/PS5/comments/def456/ps5_story/" />
    <updated>2026-07-29T01:01:00Z</updated>
    <category term="Official" />
  </entry>
</feed>`;

test("one unauthenticated Reddit request covers every primary breaking subreddit", async () => {
  const requests = [];
  const posts = await fetchSubredditsNew(
    ["GamingLeaksAndRumours", "Games", "gaming", "PS5"],
    {
      tokenProvider: async () => null,
      httpGet: async (url, options) => {
        requests.push({ url, options });
        return {
          status: 200,
          data: COMBINED_FEED,
          headers: {
            "x-ratelimit-remaining": "0.0",
            "x-ratelimit-reset": "40",
          },
        };
      },
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://www.reddit.com/r/GamingLeaksAndRumours+Games+gaming+PS5/new/.rss?limit=100",
  );
  assert.match(requests[0].options.headers.Accept, /application\/atom\+xml/);
  assert.deepEqual(
    posts.map((post) => ({
      id: post.id,
      subreddit: post.subreddit,
      title: post.title,
    })),
    [
      {
        id: "abc123",
        subreddit: "Games",
        title: "Games story",
      },
      {
        id: "def456",
        subreddit: "PS5",
        title: "PS5 story",
      },
    ],
  );
});

test("one breaking-watcher poll requests every configured primary subreddit as one source batch", async () => {
  const batches = [];
  const watcher = new BreakingWatcher({
    channelProvider: () => ({
      subreddits: [
        "GamingLeaksAndRumours",
        "Games",
        "gaming",
        "PS5",
        "NintendoSwitch",
      ],
      breakingKeywords: [],
    }),
    fetchSubredditsNewImpl: async (subreddits) => {
      batches.push([...subreddits]);
      return [
        {
          id: "abc123",
          subreddit: "Games",
          title: "A current Games story",
          score: 0,
          num_comments: 0,
          created_utc: 1785286800,
          permalink: "/r/Games/comments/abc123/current/",
        },
        {
          id: "def456",
          subreddit: "PS5",
          title: "A current PS5 story",
          score: 0,
          num_comments: 0,
          created_utc: 1785286860,
          permalink: "/r/PS5/comments/def456/current/",
        },
      ];
    },
  });

  await watcher.pollRedditOnce();

  assert.deepEqual(batches, [
    [
      "GamingLeaksAndRumours",
      "Games",
      "gaming",
      "PS5",
      "NintendoSwitch",
    ],
  ]);
  assert.equal(watcher.getStatus().storiesChecked, 2);
  assert.ok(watcher.getStatus().lastRedditPoll);
});
