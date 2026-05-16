const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isCommunityDiscussionPrompt,
  isCommunityDiscussionSubreddit,
  shouldRejectGeneralRedditForNews,
} = require("../../lib/community-discussion-gate");

test("community discussion gate catches broad gaming prompts", () => {
  const prompts = [
    "What's the best obscure video game you've ever played?",
    "Did we lose the magic of community in online multiplayer games?",
    "We need another game like L.A Noire!",
    "Came across a much simpler time in gaming today",
    "how to make your game cool as fuck: add exaggerated title cards",
    "This moment made me realize I was playing something special",
  ];

  for (const title of prompts) {
    assert.equal(
      isCommunityDiscussionPrompt({
        title,
        subreddit: "gaming",
        source_type: "reddit",
      }),
      true,
      title,
    );
  }
});

test("general Reddit news gate catches direct image and video nostalgia posts", () => {
  const rejected = [
    {
      title: "Came across a much simpler time in gaming today",
      article_url: "https://i.redd.it/example.jpeg",
    },
    {
      title: "Had a PS5 for years and someone just pointed this out to me.",
      article_url: "https://v.redd.it/example",
    },
  ];

  for (const story of rejected) {
    assert.equal(
      shouldRejectGeneralRedditForNews({
        ...story,
        subreddit: "gaming",
        source_type: "reddit",
      }),
      true,
      story.title,
    );
  }
});

test("general Reddit news gate catches low-value community media and personal posts", () => {
  const rejectedTitles = [
    "Alan Wake 2 safe rooms look like this",
    "F in chat. Car blew up and fried my plex server, living room computer, and main gaming rig boot looping",
    "Capturing mewtwo in the office shh (pokemon red version)",
    "This is exactly the perfect result I wanted",
  ];

  for (const title of rejectedTitles) {
    assert.equal(
      shouldRejectGeneralRedditForNews({
        title,
        subreddit: "gaming",
        source_type: "reddit",
      }),
      true,
      title,
    );
  }
});

test("generated scripts cannot turn community prompts into source-backed news", () => {
  assert.equal(
    shouldRejectGeneralRedditForNews({
      title: "Had a PS5 for years and someone just pointed this out to me.",
      hook: "Sony confirmed a major PS5 feature today.",
      full_script:
        "According to sources, Sony confirmed a major PS5 feature today. Follow Pulse Gaming so you never miss a beat.",
      subreddit: "ps5",
      source_type: "reddit",
    }),
    true,
  );
});

test("general Reddit news gate keeps source-backed industry stories available", () => {
  const acceptedTitles = [
    "Digital is now 93% of Capcom's game sales and is expected to rise even further",
    "Party Animals is being review bombed on Steam after announcing an AI video contest",
    "Xbox CEO responds to Xbox being down this quarter",
  ];

  for (const title of acceptedTitles) {
    assert.equal(
      shouldRejectGeneralRedditForNews({
        title,
        subreddit: "games",
        source_type: "reddit",
      }),
      false,
      title,
    );
  }
});

test("community discussion gate does not catch source-backed news", () => {
  assert.equal(
    isCommunityDiscussionPrompt({
      title: "Xbox CEO responds to Xbox being down this quarter",
      subreddit: "games",
      source_type: "reddit",
    }),
    false,
  );

  assert.equal(
    isCommunityDiscussionPrompt({
      title: "Final Fantasy 7 Rebirth demo now available for Nintendo Switch 2",
      subreddit: "games",
      source_type: "reddit",
    }),
    false,
  );
});

test("community discussion subreddit matching is narrow", () => {
  assert.equal(isCommunityDiscussionSubreddit("r/gaming"), true);
  assert.equal(isCommunityDiscussionSubreddit("GamingLeaksAndRumours"), false);
  assert.equal(
    isCommunityDiscussionPrompt({
      title: "What's the best obscure video game you've ever played?",
      subreddit: "GamingLeaksAndRumours",
      source_type: "reddit",
    }),
    false,
  );
});

test("hunter uses community discussion gate before ranking general subreddit posts", () => {
  const hunterSource = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "..", "hunter.js"),
    "utf8",
  );

  assert.match(
    hunterSource,
    /shouldRejectGeneralRedditForNews\(\{\s*title:\s*post\.title,/s,
  );
});
