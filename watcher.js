// Pulse Gaming — Continuous Breaking News Watcher
// Polls Reddit /new and RSS feeds at high frequency, emitting events
// when a story crosses the breaking threshold or gains velocity.

const EventEmitter = require('events');
const axios = require('axios');
const { getChannel } = require('./channels');
const { scoreBreakingValue, similarity, fetchSubredditNew } = require('./hunter');

const USER_AGENT = 'pulse-gaming-hunter/2.0 (personal use)';

// Thresholds
const BREAKING_THRESHOLD = 120;
const VELOCITY_UPVOTES = 500;       // 500+ upvotes within first 30 min = breaking
const VELOCITY_WINDOW_MS = 30 * 60 * 1000;

const REDDIT_POLL_MS = 90 * 1000;   // 90 seconds — well within Reddit's 30 req/min limit
const RSS_POLL_MS = 5 * 60 * 1000;  // 5 minutes

class BreakingWatcher extends EventEmitter {
  constructor() {
    super();
    this._seenIds = new Set();
    this._velocityMap = new Map();   // id -> { firstSeen: Date, firstScore: number }
    this._redditTimer = null;
    this._rssTimer = null;
    this._running = false;
    this._lastRedditPoll = null;
    this._lastRssPoll = null;
    this._storiesChecked = 0;
    this._breakingEmitted = 0;
  }

  // --- Public API ---

  start() {
    if (this._running) {
      console.log('[watcher] Already running');
      return this;
    }

    const channel = getChannel();
    console.log('[watcher] Starting continuous monitor for channel:', channel.name);
    console.log(`[watcher] Reddit poll: every ${REDDIT_POLL_MS / 1000}s | RSS poll: every ${RSS_POLL_MS / 1000}s`);
    console.log(`[watcher] Breaking threshold: ${BREAKING_THRESHOLD} | Velocity: ${VELOCITY_UPVOTES} upvotes in ${VELOCITY_WINDOW_MS / 60000} min`);

    this._running = true;

    // Kick off an immediate first poll, then set intervals
    this._pollReddit();
    this._pollRSS();

    this._redditTimer = setInterval(() => this._pollReddit(), REDDIT_POLL_MS);
    this._rssTimer = setInterval(() => this._pollRSS(), RSS_POLL_MS);

    return this;
  }

  stop() {
    if (!this._running) return;
    console.log('[watcher] Stopping continuous monitor');
    this._running = false;
    if (this._redditTimer) { clearInterval(this._redditTimer); this._redditTimer = null; }
    if (this._rssTimer) { clearInterval(this._rssTimer); this._rssTimer = null; }
  }

  getStatus() {
    return {
      running: this._running,
      seenCount: this._seenIds.size,
      velocityTracked: this._velocityMap.size,
      storiesChecked: this._storiesChecked,
      breakingEmitted: this._breakingEmitted,
      lastRedditPoll: this._lastRedditPoll ? this._lastRedditPoll.toISOString() : null,
      lastRssPoll: this._lastRssPoll ? this._lastRssPoll.toISOString() : null,
    };
  }

  // --- Reddit polling ---

  async _pollReddit() {
    if (!this._running) return;

    const channel = getChannel();
    const subreddits = channel.subreddits || [];
    const breakingKeywords = channel.breakingKeywords || [];

    // Only poll the first 4 primary subreddits to stay within rate limits
    // 4 subreddits * 1 request each = 4 requests per 90s cycle = ~2.7 req/min
    const primarySubs = subreddits.slice(0, 4);

    for (const sub of primarySubs) {
      if (!this._running) break;

      try {
        const posts = await fetchSubredditNew(sub);
        this._lastRedditPoll = new Date();

        for (const post of posts) {
          this._storiesChecked++;

          // Score the post
          const bScore = scoreBreakingValue(
            post.title, post.score, post.num_comments || 0,
            breakingKeywords, []
          );

          // Velocity tracking — record first sighting, check acceleration later
          if (!this._velocityMap.has(post.id)) {
            this._velocityMap.set(post.id, {
              firstSeen: new Date(),
              firstScore: post.score,
            });
          } else {
            // Check velocity: did it gain 500+ upvotes within the velocity window?
            const entry = this._velocityMap.get(post.id);
            const elapsed = Date.now() - entry.firstSeen.getTime();
            const gained = post.score - entry.firstScore;

            if (elapsed <= VELOCITY_WINDOW_MS && gained >= VELOCITY_UPVOTES) {
              // Velocity breaking — even if raw score is below threshold
              if (!this._seenIds.has(`velocity_${post.id}`)) {
                this._seenIds.add(`velocity_${post.id}`);
                const story = this._buildStory(post, sub, bScore + 50, 'velocity');
                console.log(`[watcher] VELOCITY BREAKING: +${gained} upvotes in ${Math.round(elapsed / 60000)} min — ${post.title.substring(0, 60)}`);
                this._breakingEmitted++;
                this.emit('breaking', story);
              }
            }
          }

          // Standard breaking threshold check
          if (bScore >= BREAKING_THRESHOLD && !this._seenIds.has(post.id)) {
            this._seenIds.add(post.id);
            const story = this._buildStory(post, sub, bScore, 'threshold');
            console.log(`[watcher] BREAKING (score ${bScore}): ${post.title.substring(0, 60)}`);
            this._breakingEmitted++;
            this.emit('breaking', story);
          } else if (!this._seenIds.has(post.id)) {
            // Mark as seen even if not breaking — prevents re-evaluation
            this._seenIds.add(post.id);
          }
        }

        // Polite delay between subreddit requests (600ms)
        await new Promise(r => setTimeout(r, 600));
      } catch (err) {
        console.log(`[watcher] Reddit poll error r/${sub}: ${err.message}`);
      }
    }

    // Prune velocity map — discard entries older than 1 hour to avoid memory leak
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, entry] of this._velocityMap) {
      if (entry.firstSeen.getTime() < cutoff) {
        this._velocityMap.delete(id);
      }
    }
  }

  // --- RSS polling ---

  async _pollRSS() {
    if (!this._running) return;

    const channel = getChannel();
    const feeds = channel.rssFeeds || [];
    const breakingKeywords = channel.breakingKeywords || [];

    for (const feed of feeds) {
      if (!this._running) break;

      try {
        const items = await this._fetchRSSItems(feed);
        this._lastRssPoll = new Date();

        for (const item of items) {
          const rssId = `rss_${require('crypto').createHash('sha256').update(item.url || item.title).digest('hex').substring(0, 16)}`;

          if (this._seenIds.has(rssId)) continue;
          this._seenIds.add(rssId);
          this._storiesChecked++;

          // RSS stories get a base score of 50 (no Reddit engagement data)
          const bScore = scoreBreakingValue(item.title, 50, 0, breakingKeywords, []);

          if (bScore >= BREAKING_THRESHOLD) {
            const story = {
              id: rssId,
              title: item.title,
              url: item.url,
              score: 50,
              flair: 'News',
              subreddit: item.source,
              top_comment: item.description || '',
              timestamp: item.timestamp,
              num_comments: 0,
              source_type: 'rss',
              article_url: item.url,
              breaking_score: bScore,
              breaking_trigger: 'rss_threshold',
            };
            console.log(`[watcher] BREAKING RSS (score ${bScore}): ${item.title.substring(0, 60)}`);
            this._breakingEmitted++;
            this.emit('breaking', story);
          }
        }
      } catch (err) {
        console.log(`[watcher] RSS poll error ${feed.name}: ${err.message}`);
      }
    }
  }

  // --- Lightweight RSS fetch (mirrors hunter.js logic) ---

  async _fetchRSSItems(feed) {
    const response = await axios.get(feed.url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
      responseType: 'text',
    });

    const xml = response.data;
    const items = [];
    const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
      const block = match[1];
      const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = block.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/i) ||
                        block.match(/<link[^>]*>(.*?)<\/link>/i);
      const pubDateMatch = block.match(/<(?:pubDate|published|updated)[^>]*>(.*?)<\/(?:pubDate|published|updated)>/i);
      const descMatch = block.match(/<(?:description|summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary|content)>/i);

      if (titleMatch) {
        const title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
        const link = linkMatch ? (linkMatch[1] || linkMatch[2] || '').trim() : '';
        const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
        const desc = descMatch ? descMatch[1].replace(/<[^>]*>/g, '').substring(0, 300).trim() : '';

        // Only include items from the last 2 hours (tighter window than hunter's 24h)
        if (pubDate) {
          const itemDate = new Date(pubDate);
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
          if (itemDate < twoHoursAgo) continue;
        }

        items.push({
          title,
          url: link,
          source: feed.name,
          description: desc,
          timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        });
      }
    }

    return items;
  }

  // --- Build a normalised story object from a Reddit post ---

  _buildStory(post, subreddit, breakingScore, trigger) {
    return {
      id: post.id,
      title: post.title,
      url: `https://reddit.com${post.permalink}`,
      score: post.score,
      flair: post.link_flair_text || 'News',
      subreddit,
      top_comment: '',
      timestamp: new Date(post.created_utc * 1000).toISOString(),
      num_comments: post.num_comments || 0,
      source_type: 'reddit',
      thumbnail_url: (post.thumbnail && post.thumbnail.startsWith('http')) ? post.thumbnail : null,
      article_url: (post.url && !post.url.includes('reddit.com')) ? post.url : null,
      breaking_score: breakingScore,
      breaking_trigger: trigger,
    };
  }
}

// --- Singleton instance ---
let instance = null;

function startWatching() {
  if (!instance) instance = new BreakingWatcher();
  return instance.start();
}

function stopWatching() {
  if (instance) instance.stop();
}

function getStatus() {
  if (!instance) return { running: false, seenCount: 0, velocityTracked: 0, storiesChecked: 0, breakingEmitted: 0, lastRedditPoll: null, lastRssPoll: null };
  return instance.getStatus();
}

module.exports = { startWatching, stopWatching, getStatus };

// Standalone mode
if (require.main === module) {
  console.log('[watcher] Starting in standalone mode...');
  const emitter = startWatching();
  emitter.on('breaking', (story) => {
    console.log(`[watcher] >>> BREAKING EVENT: ${story.title}`);
    console.log(`[watcher]     Score: ${story.breaking_score} | Trigger: ${story.breaking_trigger}`);
  });
}
