const axios = require("axios");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const { getChannel } = require("./channels");
const { getTrendingTopics, getTrendingBoost } = require("./trending");
const { getPerformanceBoost } = require("./analytics");

const USER_AGENT = "pulse-gaming-hunter/2.0 (by /u/PulseGamingBot)";

// Rotating browser-style User-Agents for non-OAuth requests (avoids bot detection)
const BROWSER_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
];
function randomUA() {
  return BROWSER_USER_AGENTS[
    Math.floor(Math.random() * BROWSER_USER_AGENTS.length)
  ];
}

// --- Reddit OAuth token cache ---
let redditToken = null;
let redditTokenExpiry = 0;

async function getRedditAccessToken() {
  // Return cached token if still valid (with 60s buffer)
  if (redditToken && Date.now() < redditTokenExpiry - 60000) {
    return redditToken;
  }

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (
    !clientId ||
    !clientSecret ||
    clientId === "placeholder" ||
    clientSecret === "placeholder"
  ) {
    console.log(
      "[hunter] WARNING: Reddit credentials not configured, falling back to public API",
    );
    return null;
  }

  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await axios.post(
      "https://www.reddit.com/api/v1/access_token",
      "grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        timeout: 10000,
      },
    );

    redditToken = response.data.access_token;
    redditTokenExpiry = Date.now() + response.data.expires_in * 1000;
    console.log("[hunter] Reddit OAuth token acquired");
    return redditToken;
  } catch (err) {
    console.log(`[hunter] Reddit OAuth failed: ${err.message}`);
    return null;
  }
}

function getRedditHeaders(token) {
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
    };
  }
  return { "User-Agent": randomUA() };
}

function getRedditBaseUrl(token) {
  return token ? "https://oauth.reddit.com" : "https://www.reddit.com";
}

// --- Decode HTML entities from RSS feeds ---
function decodeEntities(str) {
  if (!str) return str;
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    rsquo: "\u2019",
    lsquo: "\u2018",
    rdquo: "\u201D",
    ldquo: "\u201C",
    mdash: "\u2014",
    ndash: "\u2013",
    hellip: "\u2026",
  };
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&(\w+);/g, (full, name) => named[name] || full);
}

// --- Default breaking keywords (used if channel doesn't define its own) ---
const DEFAULT_BREAKING_KEYWORDS = [
  "announced",
  "revealed",
  "confirmed",
  "leaked",
  "exclusive",
  "release date",
  "trailer",
  "gameplay",
  "launch",
  "delay",
  "cancelled",
  "acquisition",
  "price",
  "free",
  "update",
];

function similarity(a, b) {
  const wordsA = a.toLowerCase().split(/\s+/);
  const wordsB = b.toLowerCase().split(/\s+/);
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = [...setA].filter((w) => setB.has(w));
  const union = new Set([...setA, ...setB]);
  return intersection.length / union.size;
}

function scoreBreakingValue(
  title,
  score,
  numComments,
  breakingKeywords,
  trendingTopics,
) {
  let breakingScore = 0;
  const lower = title.toLowerCase();

  // Keyword matches
  for (const kw of breakingKeywords) {
    if (lower.includes(kw)) breakingScore += 15;
  }

  // Reddit engagement signals
  breakingScore += Math.min(score / 10, 100);
  breakingScore += Math.min(numComments / 5, 50);

  // Trending topic boost (0-40 points)
  if (trendingTopics && trendingTopics.length > 0) {
    breakingScore += getTrendingBoost(title, trendingTopics);
  }

  return breakingScore;
}

// --- Reddit RSS fallback (no auth needed, works when JSON API returns 403) ---
async function fetchSubredditRSS(subreddit, sort = "hot") {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}/.rss?limit=50`;
  console.log(`[hunter] Fetching: r/${subreddit} (${sort}) [RSS fallback]`);

  try {
    const response = await axios.get(url, {
      headers: { "User-Agent": randomUA() },
      timeout: 15000,
      responseType: "text",
    });

    const xml = response.data;
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1];

      const titleMatch = block.match(/<title[^>]*>(.*?)<\/title>/i);
      const linkMatch = block.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/i);
      const updatedMatch = block.match(/<updated>(.*?)<\/updated>/i);
      const categoryMatch = block.match(
        /<category[^>]*term="([^"]*)"[^>]*\/?>/i,
      );

      if (!titleMatch) continue;

      const title = decodeEntities(
        titleMatch[1].replace(/<[^>]*>/g, "").trim(),
      );
      const permalink = linkMatch
        ? linkMatch[1].replace("https://www.reddit.com", "")
        : "";

      // Extract post ID from permalink (/r/sub/comments/ID/...)
      const idMatch = permalink.match(/\/comments\/([a-z0-9]+)\//);
      const id = idMatch ? idMatch[1] : "";

      const updated = updatedMatch ? updatedMatch[1] : "";
      const flair = categoryMatch ? categoryMatch[1] : "";

      entries.push({
        id,
        title,
        permalink,
        link_flair_text: flair,
        score: 0, // RSS doesn't include score
        num_comments: 0,
        created_utc: updated
          ? Math.floor(new Date(updated).getTime() / 1000)
          : Math.floor(Date.now() / 1000),
        url: `https://reddit.com${permalink}`,
        thumbnail: null,
      });
    }

    console.log(
      `[hunter] RSS fallback r/${subreddit}: ${entries.length} entries`,
    );
    return entries;
  } catch (err) {
    console.log(`[hunter] RSS fallback r/${subreddit} failed: ${err.message}`);
    return [];
  }
}

async function fetchSubreddit(subreddit) {
  const token = await getRedditAccessToken();
  const base = getRedditBaseUrl(token);
  const suffix = token ? "" : ".json";
  const url = `${base}/r/${subreddit}/hot${suffix}?limit=50`;
  console.log(
    `[hunter] Fetching: r/${subreddit} (hot)${token ? " [OAuth]" : " [public]"}`,
  );

  try {
    const response = await axios.get(url, {
      headers: getRedditHeaders(token),
      timeout: 15000,
    });
    const children = response.data?.data?.children || [];
    return children.map((c) => c.data);
  } catch (err) {
    console.log(
      `[hunter] Failed r/${subreddit} JSON: ${err.message}, trying RSS fallback...`,
    );
    return fetchSubredditRSS(subreddit, "hot");
  }
}

async function fetchSubredditNew(subreddit) {
  const token = await getRedditAccessToken();
  const base = getRedditBaseUrl(token);
  const suffix = token ? "" : ".json";
  const url = `${base}/r/${subreddit}/new${suffix}?limit=25`;
  console.log(
    `[hunter] Fetching: r/${subreddit} (new)${token ? " [OAuth]" : " [public]"}`,
  );

  try {
    const response = await axios.get(url, {
      headers: getRedditHeaders(token),
      timeout: 15000,
    });
    const children = response.data?.data?.children || [];
    return children.map((c) => c.data);
  } catch (err) {
    console.log(
      `[hunter] Failed r/${subreddit}/new JSON: ${err.message}, trying RSS fallback...`,
    );
    return fetchSubredditRSS(subreddit, "new");
  }
}

async function fetchTopComments(subreddit, postId, count = 4) {
  try {
    const token = await getRedditAccessToken();
    const base = getRedditBaseUrl(token);
    const suffix = token ? "" : ".json";
    const url = `${base}/r/${subreddit}/comments/${postId}${suffix}?limit=20&sort=top`;
    const response = await axios.get(url, {
      headers: getRedditHeaders(token),
      timeout: 10000,
    });

    const commentListing = response.data?.[1]?.data?.children || [];
    const modPhrases = [
      "rumor alert",
      "rumour alert",
      "this post contains",
      "please read critically",
      "manage expectations",
      "source reliability",
      "reliability ratings",
      "reminder:",
      "this is a reminder",
      "rule ",
      "flair",
      "i am a bot",
      "action was performed automatically",
      "megathread",
      "please use the",
      "weekly thread",
    ];
    const results = [];
    for (const child of commentListing) {
      const c = child.data;
      if (!c || !c.body) continue;
      if (c.stickied) continue;
      if (c.distinguished === "moderator") continue;
      const author = (c.author || "").toLowerCase();
      if (
        author === "automoderator" ||
        author === "automod" ||
        author.includes("bot")
      )
        continue;
      if (c.body.length < 20) continue;
      const bodyLower = c.body.toLowerCase();
      if (modPhrases.some((phrase) => bodyLower.includes(phrase))) continue;
      results.push({
        body: c.body.substring(0, 200),
        author: c.author || "Anonymous",
        score: c.score || 0,
      });
      if (results.length >= count) break;
    }
    return results;
  } catch (err) {
    // Silently skip
  }
  return [];
}

// Backwards-compatible wrapper
async function fetchTopComment(subreddit, postId) {
  const comments = await fetchTopComments(subreddit, postId, 1);
  return comments.length > 0 ? comments[0].body : "";
}

// --- RSS feed parsing (lightweight XML extraction) ---
async function fetchRSSFeed(feed) {
  try {
    const response = await axios.get(feed.url, {
      headers: { "User-Agent": randomUA() },
      timeout: 15000,
      responseType: "text",
    });

    const xml = response.data;
    const items = [];

    // Simple XML extraction for <item> or <entry> blocks
    const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
      const block = match[1];

      const titleMatch = block.match(
        /<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i,
      );
      const linkMatch =
        block.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/i) ||
        block.match(/<link[^>]*>(.*?)<\/link>/i);
      const pubDateMatch = block.match(
        /<(?:pubDate|published|updated)[^>]*>(.*?)<\/(?:pubDate|published|updated)>/i,
      );
      const descMatch = block.match(
        /<(?:description|summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary|content)>/i,
      );

      if (titleMatch) {
        const title = decodeEntities(
          titleMatch[1].replace(/<[^>]*>/g, "").trim(),
        );
        const link = linkMatch
          ? (linkMatch[1] || linkMatch[2] || "").trim()
          : "";
        const pubDate = pubDateMatch ? pubDateMatch[1].trim() : "";
        const desc = descMatch
          ? decodeEntities(
              descMatch[1]
                .replace(/<[^>]*>/g, "")
                .substring(0, 300)
                .trim(),
            )
          : "";

        // Only include items from the last 24 hours
        if (pubDate) {
          const itemDate = new Date(pubDate);
          const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          if (itemDate < dayAgo) continue;
        }

        items.push({
          title,
          url: link,
          source: feed.name,
          description: desc,
          timestamp: pubDate
            ? new Date(pubDate).toISOString()
            : new Date().toISOString(),
        });
      }
    }

    console.log(`[hunter] RSS ${feed.name}: ${items.length} items`);
    return items;
  } catch (err) {
    console.log(`[hunter] RSS ${feed.name} failed: ${err.message}`);
    return [];
  }
}

// --- Image URL extraction from article pages ---
async function fetchArticleImage(url) {
  if (!url || url.includes("reddit.com")) return null;

  try {
    const response = await axios.get(url, {
      headers: { "User-Agent": randomUA() },
      timeout: 10000,
      responseType: "text",
      maxRedirects: 3,
    });

    const html = response.data;

    // Try og:image first (most reliable for article hero images)
    const ogMatch =
      html.match(
        /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      ) ||
      html.match(
        /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      );
    if (ogMatch && ogMatch[1]) {
      const imgUrl = ogMatch[1];
      // Validate it's a real image URL
      if (imgUrl.match(/\.(jpg|jpeg|png|webp)/i) || imgUrl.includes("image")) {
        return imgUrl;
      }
    }

    // Try twitter:image
    const twMatch = html.match(
      /<meta[^>]*(?:name|property)=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    );
    if (twMatch && twMatch[1]) return twMatch[1];

    return null;
  } catch (err) {
    return null;
  }
}

// --- Search for game key art / screenshots ---
async function fetchGameImages(gameTitle) {
  const images = [];
  const steamStats = {};

  // Try Steam store search for game art
  try {
    const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameTitle)}&cc=gb&l=english`;
    const response = await axios.get(searchUrl, {
      headers: { "User-Agent": randomUA() },
      timeout: 8000,
    });

    const items = response.data?.items || [];
    if (items.length > 0) {
      const appId = items[0].id;
      // Steam header image (460x215, high quality key art)
      images.push({
        url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
        type: "key_art",
        source: "steam",
      });
      // Steam library hero (large, cinematic)
      images.push({
        url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
        type: "hero",
        source: "steam",
      });
      // Steam capsule (vertical, good for shorts)
      images.push({
        url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
        type: "capsule",
        source: "steam",
      });
      // Fetch real screenshots via Steam app details API
      try {
        const detailsRes = await axios.get(
          `https://store.steampowered.com/api/appdetails?appids=${appId}`,
          { timeout: 8000, headers: { "User-Agent": randomUA() } },
        );
        const appData = detailsRes.data?.[appId]?.data;
        if (appData?.screenshots) {
          for (const ss of appData.screenshots.slice(0, 4)) {
            if (ss.path_full) {
              images.push({
                url: ss.path_full,
                type: "screenshot",
                source: "steam",
              });
            }
          }
        }
        // Extract trailer/gameplay video clips from Steam
        if (appData?.movies) {
          for (const movie of appData.movies.slice(0, 2)) {
            const videoUrl =
              movie.webm?.max ||
              movie.webm?.["480"] ||
              movie.mp4?.max ||
              movie.mp4?.["480"];
            if (videoUrl) {
              images.push({
                url: videoUrl,
                type: movie.highlight ? "trailer" : "gameplay_clip",
                source: "steam",
                is_video: true,
                thumbnail: movie.thumbnail,
              });
            }
          }
        }
        // Extract Steam review score and recommendation count for stat card overlays
        if (appData?.recommendations?.total) {
          steamStats.recommendations = appData.recommendations.total;
        }
        if (appData?.metacritic?.score) {
          steamStats.metacriticScore = appData.metacritic.score;
        }
        // Steam appdetails includes review_score_desc (e.g. "Very Positive")
        // and review_score (1-9 scale). We use the Steam review API for percentage.
        try {
          const reviewRes = await axios.get(
            `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0`,
            { timeout: 5000, headers: { "User-Agent": randomUA() } },
          );
          const summary = reviewRes.data?.query_summary;
          if (summary && summary.total_reviews > 0) {
            steamStats.reviewScore = Math.round(
              (summary.total_positive / summary.total_reviews) * 100,
            );
            steamStats.playerCount = summary.total_reviews;
          }
        } catch (revErr) {
          /* Steam reviews API failed, non-fatal */
        }
      } catch (err) {
        /* Steam details failed, no screenshots */
      }
    }
  } catch (err) {
    // Steam search failed, continue
  }

  // Fallback 2: RAWG.io - free game database with screenshots (no key needed for basic)
  if (images.length < 3) {
    try {
      const rawgSearch = `https://api.rawg.io/api/games?search=${encodeURIComponent(gameTitle)}&page_size=1&key=`;
      // RAWG allows keyless requests with lower rate limits
      const rawgRes = await axios.get(rawgSearch, {
        timeout: 8000,
        headers: { "User-Agent": randomUA() },
      });
      const game = rawgRes.data?.results?.[0];
      if (game) {
        if (game.background_image) {
          images.push({
            url: game.background_image,
            type: "hero",
            source: "rawg",
          });
        }
        // Fetch screenshots for this game
        if (game.slug) {
          try {
            const ssRes = await axios.get(
              `https://api.rawg.io/api/games/${game.slug}/screenshots?key=`,
              { timeout: 5000, headers: { "User-Agent": randomUA() } },
            );
            for (const ss of (ssRes.data?.results || []).slice(0, 3)) {
              if (ss.image)
                images.push({
                  url: ss.image,
                  type: "screenshot",
                  source: "rawg",
                });
            }
          } catch (err) {
            /* screenshots fetch failed */
          }
        }
      }
    } catch (err) {
      /* RAWG failed */
    }
  }

  // Fallback 3: Wikipedia page image (good for Nintendo/console exclusives)
  if (images.length < 2) {
    try {
      const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(gameTitle)}`;
      const wikiRes = await axios.get(wikiUrl, {
        timeout: 5000,
        headers: { "User-Agent": randomUA() },
      });
      if (wikiRes.data?.thumbnail?.source) {
        const originalUrl =
          wikiRes.data.originalimage?.source ||
          wikiRes.data.thumbnail.source.replace(/\/\d+px-/, "/800px-");
        images.push({ url: originalUrl, type: "key_art", source: "wikipedia" });
      }
    } catch (err) {
      /* Wikipedia fallback failed */
    }
  }

  // Fallback 4: Wikipedia with "(video game)" suffix (handles ambiguous titles)
  if (images.length < 2) {
    try {
      const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(gameTitle + " (video game)")}`;
      const wikiRes = await axios.get(wikiUrl, {
        timeout: 5000,
        headers: { "User-Agent": randomUA() },
      });
      if (wikiRes.data?.originalimage?.source) {
        images.push({
          url: wikiRes.data.originalimage.source,
          type: "key_art",
          source: "wikipedia",
        });
      }
    } catch (err) {
      /* Wikipedia (video game) fallback failed */
    }
  }

  // Fallback 5: DuckDuckGo instant answer
  if (images.length === 0) {
    try {
      const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(gameTitle + " game")}&format=json&no_html=1`;
      const ddgRes = await axios.get(ddgUrl, {
        timeout: 5000,
        headers: { "User-Agent": randomUA() },
      });
      if (ddgRes.data?.Image) {
        images.push({ url: ddgRes.data.Image, type: "key_art", source: "ddg" });
      }
    } catch (err) {
      /* DDG fallback failed */
    }
  }

  // Attach Steam stats to the result for stat card overlays
  images._steamStats = steamStats;
  return images;
}

// --- Company logo URLs (static, reliable CDN sources) ---
const COMPANY_LOGOS = {
  sony: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/PlayStation_logo_colour.svg/320px-PlayStation_logo_colour.svg.png",
  playstation:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/PlayStation_logo_colour.svg/320px-PlayStation_logo_colour.svg.png",
  microsoft:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Xbox_logo_2012_cropped.svg/320px-Xbox_logo_2012_cropped.svg.png",
  xbox: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Xbox_logo_2012_cropped.svg/320px-Xbox_logo_2012_cropped.svg.png",
  nintendo:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Nintendo.svg/320px-Nintendo.svg.png",
  valve:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Valve_logo.svg/320px-Valve_logo.svg.png",
  steam:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Steam_icon_logo.svg/320px-Steam_icon_logo.svg.png",
  ea: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Electronic-Arts-Logo.svg/320px-Electronic-Arts-Logo.svg.png",
  ubisoft:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Ubisoft_logo.svg/320px-Ubisoft_logo.svg.png",
  rockstar:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Rockstar_Games_Logo.svg/320px-Rockstar_Games_Logo.svg.png",
  bethesda:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Bethesda_Game_Studios_logo.svg/320px-Bethesda_Game_Studios_logo.svg.png",
  capcom:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Capcom_logo.svg/320px-Capcom_logo.svg.png",
  square_enix:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/Square_Enix_logo.svg/320px-Square_Enix_logo.svg.png",
  activision:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Activision_logo.svg/320px-Activision_logo.svg.png",
  blizzard:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Blizzard_Entertainment_Logo_2015.svg/320px-Blizzard_Entertainment_Logo_2015.svg.png",
  cd_projekt:
    "https://upload.wikimedia.org/wikipedia/en/thumb/6/68/CD_Projekt_logo.svg/320px-CD_Projekt_logo.svg.png",
  fromsoftware:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/FromSoftware_logo.svg/320px-FromSoftware_logo.svg.png",
  sega: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Sega_logo.svg/320px-Sega_logo.svg.png",
  bandai_namco:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Bandai_Namco_Entertainment_logo.svg/320px-Bandai_Namco_Entertainment_logo.svg.png",
  konami:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Konami_Logo.svg/320px-Konami_Logo.svg.png",
};

// --- Detect the publisher / platform holder referenced by a story ---
//
// 2026-04-19 fix: the old implementation used `lower.includes(key)` with
// no word boundary. Key "ea" then matched "r**ea**l", "l**ea**k",
// "id**ea**", etc. — any title containing those substrings got silently
// tagged with the Electronic Arts logo. The 18:00 UTC publish of the
// Tom Henderson Black Flag story went out with an EA logo because the
// title contained "reveal" → included "ea". Fix: require word boundaries
// around each company key, and also scan the hook/body so stories whose
// title doesn't name the publisher can still match (e.g. when the
// headline says "Black Flag remake" but the body says "Ubisoft confirms").
//
// Accepts either a string (legacy callers) or a story object with
// { title, hook, body }. Returns { name, logoUrl } or null.
function detectCompany(storyOrTitle) {
  const haystackParts =
    typeof storyOrTitle === "string"
      ? [storyOrTitle]
      : [
          storyOrTitle?.title || "",
          storyOrTitle?.hook || "",
          storyOrTitle?.body || "",
        ];
  const lower = haystackParts.join(" ").toLowerCase();
  for (const [key, url] of Object.entries(COMPANY_LOGOS)) {
    const needle = key.replace("_", " ");
    // Escape regex metacharacters then wrap in word boundaries. \b in JS
    // regex treats hyphens / spaces / punctuation as word boundaries, so
    // "cd projekt" matches "CD Projekt" in "...announced by CD Projekt Red...".
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    if (re.test(lower)) {
      return { name: key, logoUrl: url };
    }
  }
  return null;
}

// --- Main hunt function ---
async function hunt() {
  const channel = getChannel();
  const SUBREDDITS = channel.subreddits || [];
  const RSS_FEEDS = channel.rssFeeds || [];
  const BREAKING_KEYWORDS =
    channel.breakingKeywords || DEFAULT_BREAKING_KEYWORDS;

  console.log(
    `[hunter] === MULTI-SOURCE HUNT v2 - ${channel.name} (${channel.niche}) ===`,
  );
  console.log(
    `[hunter] Scanning ${SUBREDDITS.length} subreddits + ${RSS_FEEDS.length} RSS feeds`,
  );

  const includeRumours = process.env.INCLUDE_RUMOURS === "true";
  const allowedFlairs = ["verified", "highly likely"];
  if (includeRumours) allowedFlairs.push("rumour");

  let allPosts = [];

  // --- Phase 1: Reddit (hot + new from key subreddits) ---
  console.log("[hunter] Phase 1: Reddit scraping...");

  for (const sub of SUBREDDITS) {
    try {
      // Fetch hot posts
      const hotPosts = await fetchSubreddit(sub);

      // Also fetch new posts from the first 5 subreddits (primary sources - catches breaking news faster)
      let newPosts = [];
      if (SUBREDDITS.indexOf(sub) < 5) {
        await new Promise((r) => setTimeout(r, 500));
        newPosts = await fetchSubredditNew(sub);
      }

      const combined = [...hotPosts, ...newPosts];
      const seenIds = new Set();

      for (const post of combined) {
        if (seenIds.has(post.id)) continue;
        seenIds.add(post.id);

        // For the primary leak/rumour subreddit (first in list), filter by flair
        const flair = post.link_flair_text || "";
        const isPrimarySub = SUBREDDITS.indexOf(sub) === 0;
        if (isPrimarySub && channel.niche === "gaming") {
          const matchesFlair = allowedFlairs.some((f) =>
            flair.toLowerCase().includes(f),
          );
          if (!matchesFlair) continue;
        }

        // For general subs, filter by minimum engagement + recency
        if (!isPrimarySub) {
          const postAge =
            (Date.now() - post.created_utc * 1000) / (1000 * 60 * 60);
          if (postAge > 24) continue;
          if (post.score < 100 && post.num_comments < 20) continue;

          // Filter junk posts from meme-heavy subs (PCMasterRace, gaming, etc.)
          const titleLower = (post.title || "").toLowerCase();
          const junkPatterns = [
            /\b(meme|mfw|mrw|shitpost|rant|vent|am i the only|does anyone else|unpopular opinion)\b/,
            /\b(my setup|my build|my rig|rate my|battlestation|just bought|just got|just upgraded)\b/,
            /\b(help me|should i buy|which should i|what should i|is it worth|recommend me)\b/,
            /\b(petition to|can we talk about|i hate|i love|hot take|controversial)\b/,
          ];
          const junkFlairs = [
            "meme",
            "satire",
            "joke",
            "shitpost",
            "rant",
            "discussion",
            "question",
            "tech support",
            "build",
            "setup",
            "advice",
          ];
          const postFlair = (flair || "").toLowerCase();
          if (junkPatterns.some((p) => p.test(titleLower))) continue;
          if (junkFlairs.some((f) => postFlair.includes(f))) continue;
        }

        allPosts.push({
          id: post.id,
          title: decodeEntities(post.title),
          url: `https://reddit.com${post.permalink}`,
          score: post.score,
          flair: flair || "News",
          subreddit: sub,
          top_comment: "",
          timestamp: new Date(post.created_utc * 1000).toISOString(),
          num_comments: post.num_comments || 0,
          source_type: "reddit",
          thumbnail_url:
            post.thumbnail && post.thumbnail.startsWith("http")
              ? post.thumbnail
              : null,
          article_url:
            post.url && !post.url.includes("reddit.com") ? post.url : null,
        });
      }

      // Politeness delay between subreddits
      await new Promise((r) => setTimeout(r, 600));
    } catch (err) {
      console.log(`[hunter] ERROR r/${sub}: ${err.message}`);
    }
  }

  console.log(`[hunter] Reddit: ${allPosts.length} qualifying posts`);

  // --- Phase 2: RSS feeds from gaming outlets ---
  console.log("[hunter] Phase 2: RSS feeds...");

  const rssResults = await Promise.allSettled(
    RSS_FEEDS.map((feed) => fetchRSSFeed(feed)),
  );

  for (const result of rssResults) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      allPosts.push({
        id: `rss_${require("crypto")
          .createHash("sha256")
          .update(item.url || item.title)
          .digest("hex")
          .substring(0, 16)}`,
        title: item.title,
        url: item.url,
        score: 50,
        flair: "News",
        subreddit: item.source,
        top_comment: item.description || "",
        timestamp: item.timestamp,
        num_comments: 0,
        source_type: "rss",
        article_url: item.url,
      });
    }
  }

  console.log(`[hunter] Total raw posts: ${allPosts.length}`);

  // --- Deduplicate by title similarity ---
  const deduped = [];
  for (const post of allPosts) {
    const isDupe = deduped.some(
      (existing) => similarity(existing.title, post.title) > 0.5,
    );
    if (!isDupe) deduped.push(post);
  }
  console.log(`[hunter] After deduplication: ${deduped.length}`);

  // --- Fetch trending topics for scoring boost ---
  let trendingTopics = [];
  try {
    trendingTopics = await getTrendingTopics();
  } catch (err) {
    console.log(`[hunter] Trending topics fetch failed: ${err.message}`);
  }

  // --- Score and rank by breaking news value ---
  for (const post of deduped) {
    post.breaking_score = scoreBreakingValue(
      post.title,
      post.score,
      post.num_comments,
      BREAKING_KEYWORDS,
      trendingTopics,
    );

    // Historical performance boost (0-30 points) from analytics
    const perfBoost = getPerformanceBoost(post.title, post.flair);
    if (perfBoost > 0) {
      post.breaking_score += perfBoost;
      console.log(
        `[hunter] +${perfBoost} performance boost for: ${post.title.substring(0, 50)}...`,
      );
    }
  }
  deduped.sort((a, b) => b.breaking_score - a.breaking_score);

  // --- Take top 8 stories (more content = more chances to go viral) ---
  const topStories = deduped.slice(0, 8);

  // --- Enrich with images (parallel for speed) ---
  console.log("[hunter] Phase 3: Enriching with images...");

  await Promise.allSettled(
    topStories.map(async (story, i) => {
      // Fetch top comments from Reddit posts (multiple for video overlays)
      try {
        if (story.source_type === "reddit" && !story.top_comment) {
          const comments = await fetchTopComments(story.subreddit, story.id, 8);
          story.top_comment = comments.length > 0 ? comments[0].body : "";
          story.reddit_comments = comments;
        }
      } catch (err) {
        console.log(
          `[hunter] Comment fetch failed for ${story.id}: ${err.message}`,
        );
      }

      // Fetch article hero image (try article URL, then original Reddit link URL)
      try {
        if (story.article_url) {
          story.article_image = await fetchArticleImage(story.article_url);
        }
        if (
          !story.article_image &&
          story.url &&
          !story.url.includes("reddit.com/r/")
        ) {
          story.article_image = await fetchArticleImage(story.url);
        }
      } catch (err) {
        console.log(
          `[hunter] Article image fetch failed for ${story.id}: ${err.message}`,
        );
      }

      // Detect company and attach logo. Scan title + the highest-voted
      // Reddit comment / RSS description so stories whose title doesn't
      // name the publisher can still match on body context (e.g. the
      // Tom Henderson Black Flag story whose title never says "Ubisoft"
      // but whose top comments / body do).
      try {
        const company = detectCompany({
          title: story.title,
          body: story.top_comment || "",
        });
        if (company) {
          story.company_name = company.name;
          story.company_logo_url = company.logoUrl;
        }
      } catch (err) {
        console.log(
          `[hunter] Company detection failed for ${story.id}: ${err.message}`,
        );
      }

      // Extract actual game name from title and fetch game images
      try {
        let gameTitle = story.title
          .replace(/^[^:]+:\s*/i, "") // Strip "NateTheHate:" style prefixes
          .replace(
            /reportedly|rumour|confirmed|leaked|says|claims|according to/gi,
            "",
          )
          .replace(
            /\b(remake|remaster|remastered|dlc|update|patch|sequel|prequel)\b/gi,
            "$1",
          )
          .replace(
            /\b(is|are|was|were|will|be|to|the|a|an|in|on|at|for|of|and|or|not)\b/gi,
            "",
          )
          .replace(/[^a-zA-Z0-9\s:'-]/g, "")
          .replace(/\s+/g, " ")
          .trim();
        // Try to find known game titles within the cleaned text
        const knownPatterns =
          gameTitle.match(/(?:[\w']+ ){0,4}[\w']+(?:\s*\d+)?/)?.[0] ||
          gameTitle;
        const searchTerm = knownPatterns.substring(0, 60).trim();
        if (searchTerm.length > 3) {
          story.game_images = await fetchGameImages(searchTerm);
          // Extract Steam stats for stat card overlays
          if (story.game_images?._steamStats) {
            const ss = story.game_images._steamStats;
            if (ss.reviewScore) story.steam_review_score = ss.reviewScore;
            if (ss.playerCount) story.steam_player_count = ss.playerCount;
          }
        }

        // Fallback: if no game images found, try searching with just the key nouns
        if (!story.game_images || story.game_images.length === 0) {
          const fallback = story.title.match(
            /(?:Zelda|Mario|Halo|GTA|Final Fantasy|Ocarina|Star Fox|Pokemon|Elden Ring|God of War|Horizon|Spider.Man|Metroid|Call of Duty|Fortnite|Minecraft|Cyberpunk|Resident Evil|Silent Hill|Metal Gear|Dark Souls|Bloodborne|Sekiro|Breath of the Wild|Tears of the Kingdom|Baldur.s Gate|Diablo|Overwatch|Destiny|Assassin.s Creed|Far Cry|Watch Dogs|The Witcher|Red Dead|Uncharted|The Last of Us|Death Stranding|Ghost of Tsushima|Ratchet|Returnal|Demon.s Souls|Astro Bot|Gran Turismo|Forza|Flight Simulator|Starfield|Fallout|Elder Scrolls|Skyrim|Doom|Wolfenstein|Dishonored|Prey|Hitman|Tomb Raider|Devil May Cry|Monster Hunter|Dragon.s Dogma|Street Fighter|Tekken|Mortal Kombat|Kingdom Hearts|Persona|Xenoblade|Fire Emblem|Splatoon|Animal Crossing|Pikmin|Kirby|Donkey Kong|F-Zero|Kid Icarus|Bayonetta|Hollow Knight|Silksong|Nier|Yakuza|Sonic|Mega Man|Castlevania|Contra|Gradius|Bomberman|Suikoden|Chrono|Dragon Quest|Bravely|Octopath|Triangle Strategy|Live A Live|Valkyrie|Mana|SaGa|Romancing|Trials of Mana|World of|League of|Dota|Counter.Strike|Valorant|Apex Legends|PUBG|Warzone|Battlefield|Titanfall|Anthem|Mass Effect|Dragon Age|Jade Empire|Knights of the Old Republic|KOTOR|Jedi|Mandalorian|Clone Wars|PS[2-6]|Xbox|Switch\s*2?|PlayStation|Nintendo)/i,
          );
          if (fallback) {
            story.game_images = await fetchGameImages(fallback[0]);
            // Extract Steam stats from fallback search
            if (!story.steam_review_score && story.game_images?._steamStats) {
              const ss = story.game_images._steamStats;
              if (ss.reviewScore) story.steam_review_score = ss.reviewScore;
              if (ss.playerCount) story.steam_player_count = ss.playerCount;
            }
          }
        }
      } catch (err) {
        console.log(
          `[hunter] Game image fetch failed for ${story.id}: ${err.message}`,
        );
      }
    }),
  );

  const output = {
    timestamp: new Date().toISOString(),
    stories: topStories,
  };

  await fs.writeJson("pending_news.json", output, { spaces: 2 });
  console.log(
    `[hunter] Saved ${topStories.length} stories to pending_news.json`,
  );
  console.log("[hunter] Top stories:");
  topStories.forEach((s, i) =>
    console.log(
      `  ${i + 1}. [${s.flair}] (score:${s.breaking_score}) ${s.title}`,
    ),
  );

  return topStories;
}

module.exports = hunt;
module.exports.fetchArticleImage = fetchArticleImage;
module.exports.fetchGameImages = fetchGameImages;
module.exports.fetchTopComments = fetchTopComments;
module.exports.detectCompany = detectCompany;
module.exports.COMPANY_LOGOS = COMPANY_LOGOS;
module.exports.scoreBreakingValue = scoreBreakingValue;
module.exports.similarity = similarity;
module.exports.fetchSubredditNew = fetchSubredditNew;

if (require.main === module) {
  hunt().catch((err) => {
    console.log(`[hunter] ERROR: ${err.message}`);
    process.exit(1);
  });
}
