// STACKED,Channel Configuration
// Finance news, market moves, earnings and insider trades

module.exports = {
  id: "stacked",
  name: "STACKED",
  tagline: "Markets. Decoded. Daily.",
  cta: "Follow STACKED so you never miss a move",
  niche: "finance",

  // Brand palette,Money Green
  colours: {
    PRIMARY: "#00C853", // Profit Green
    PRIMARY_FFM: "0x00C853",
    SECONDARY: "#0A0A0C", // Vault Black
    TEXT: "#F0F0F0", // Signal White
    TEXT_FFM: "0xF0F0F0",
    ALERT: "#FF1744", // Loss Red
    ALERT_FFM: "0xFF1744",
    CONFIRMED: "#00E676", // Bright Green,confirmed moves
    CONFIRMED_FFM: "0x00E676",
    MUTED: "#78909C", // Slate Grey
    MUTED_FFM: "0x78909C",
  },

  // Classification system,finance-specific
  classificationColour(classification) {
    const c = (classification || "").toLowerCase();
    if (c.includes("leak") || c.includes("insider"))
      return { hex: "#FF1744", ffm: "0xFF1744", label: "INSIDER" };
    if (c.includes("breaking"))
      return { hex: "#FF1744", ffm: "0xFF1744", label: "BREAKING" };
    if (c.includes("rumor") || c.includes("rumour"))
      return { hex: "#FFD600", ffm: "0xFFD600", label: "RUMOR" };
    if (c.includes("confirmed") || c.includes("verified"))
      return { hex: "#00C853", ffm: "0x00C853", label: "CONFIRMED" };
    if (c.includes("earnings"))
      return { hex: "#00C853", ffm: "0x00C853", label: "EARNINGS" };
    return { hex: "#78909C", ffm: "0x78909C", label: "MARKET" };
  },

  // Voice - Antoni: authoritative, measured, gravitas for finance (slower than gaming)
  voiceId: process.env.STACKED_VOICE_ID || "ErXwobaYiN019PkySvjV", // Antoni
  voiceModel: "eleven_multilingual_v2",
  voiceSettings: {
    stability: 0.45,
    similarity_boost: 0.85,
    style: 0.7,
    speaking_rate: 1.0,
  },

  // Content sources,finance subreddits + RSS
  subreddits: [
    "wallstreetbets",
    "stocks",
    "investing",
    "StockMarket",
    "finance",
    "economics",
    "CryptoCurrency",
    "options",
  ],
  rssFeeds: [
    { name: "Bloomberg", url: "https://feeds.bloomberg.com/markets/news.rss" },
    {
      name: "CNBC",
      url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    },
    {
      name: "Reuters",
      url: "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best",
    },
    {
      name: "MarketWatch",
      url: "https://feeds.marketwatch.com/marketwatch/topstories/",
    },
    { name: "YahooFinance", url: "https://finance.yahoo.com/news/rssindex" },
    {
      name: "SeekingAlpha",
      url: "https://seekingalpha.com/market_currents.xml",
    },
    { name: "Motley Fool", url: "https://www.fool.com/feeds/index.aspx" },
    { name: "Benzinga", url: "https://www.benzinga.com/feed" },
  ],

  // Keywords for breaking score
  breakingKeywords: [
    "earnings",
    "revenue",
    "profit",
    "loss",
    "beat",
    "miss",
    "ipo",
    "merger",
    "acquisition",
    "buyout",
    "dividend",
    "fed",
    "rate cut",
    "rate hike",
    "inflation",
    "recession",
    "crash",
    "rally",
    "all-time high",
    "insider",
    "sec",
    "tesla",
    "apple",
    "nvidia",
    "microsoft",
    "amazon",
    "bitcoin",
    "crypto",
    "etf",
    "layoffs",
    "bankruptcy",
  ],

  // YouTube category
  youtubeCategory: "27", // Education (higher CPM, attracts investor demographics)
  hashtags: ["#Shorts", "#Finance", "#StockMarket", "#Investing", "#STACKED"],

  // Music prompts,varied pool for library generation
  musicPrompt:
    "dark cinematic trap beat, deep bass, ticking clock tension, stock market urgency, minimal, atmospheric, no vocals",
  musicPrompts: [
    "dark cinematic trap beat, deep bass, ticking clock tension, stock market urgency, minimal, atmospheric, no vocals",
    "tense orchestral underscore, pizzicato strings, subtle ticking, financial suspense, boardroom drama, no vocals",
    "minimal electronic beat, clean percussion, rising synth pads, market open energy, professional, no vocals",
    "deep house influenced instrumental, steady four on floor, warm bass, confident trading floor vibe, no vocals",
    "ambient piano and bass, sparse percussion, contemplative mood, wealth management atmosphere, no vocals",
    "dark jazz hop beat, walking bass line, brushed snares, late night market analysis feel, no vocals",
    "cinematic countdown beat, ticking percussion, building tension, earnings report suspense, dramatic, no vocals",
    "minimal techno pulse, steady kick, filtered synths, algorithmic trading aesthetic, hypnotic, no vocals",
  ],

  // System prompt for script generation - Senior Market Analyst persona
  systemPrompt: `You are a Senior Market Analyst for STACKED, a premium financial intelligence channel on YouTube Shorts. Your tone is objective, sceptical and highly authoritative. You prioritise data over hype. You speak in British English (e.g. summarise, programme, modelling) and strictly avoid serial commas.

RULES:
- 170-190 words per script (targets 75-85 seconds with bumper; finance needs more room for data)
- Structure: Contrarian Hook -> Data/Source -> Mid-roll Pivot -> Analysis ("So what?") -> Disclaimer + CTA
- CTA: "This is not financial advice. Follow STACKED so you never miss a move."
- Classify every story as one of: [INSIDER], [RUMOR], [CONFIRMED], [BREAKING], [EARNINGS] or [MARKET]
- Always cite the source: "According to SEC filings...", "Bloomberg reports...", "buried in the 10-K..."
- British English spelling. No serial comma.
- Tone: Objective, sceptical, authoritative. Like a Bloomberg terminal notification, not a hype man.
- Use professional vocabulary: "equity", "volatility", "arbitrage", "macroeconomic", "liquidity", "valuation".
- Include [PAUSE] markers where a natural beat would land (2-3 per script)
- Never use: "in this video", "hey guys", "what's up", "smash that like", "let me know in the comments"
- NEVER give investment advice. NEVER use hype language: "moon", "rocket", "guaranteed", "huge gains", "100x".
- Always include "This is not financial advice" somewhere in the script.
- SENTENCE RHYTHM: Vary sentence length deliberately. Alternate between short punchy statements (3-8 words) and longer detailed sentences (15-25 words). Never write three consecutive sentences of similar length. This prevents AI detection and creates natural speech rhythm.

HOOK (THE CONTRARIAN HOOK): THIS IS THE MOST IMPORTANT PART OF THE SCRIPT.
The first sentence MUST challenge a popular market narrative or reveal a hidden data point. The viewer must think "wait, that contradicts everything I assumed" and be unable to scroll away.

Hook archetypes (use these):
1. The Hidden Metric: "While everyone is watching the Fed, the real story is happening in the repo markets."
2. The Insider Signal: "Institutional outflows from [Company] just hit a three-year high. Here is why."
3. The Valuation Gap: "[Asset] is currently trading at a 30% discount to its historical average, and the catalyst for a reversal just arrived."
4. The Statistical Shock: "Three million retail investors just exited [Asset] in twenty-four hours."

Rules for hooks:
1. Never reveal the full answer. Tease it. Create an open loop.
2. Use specificity to build credibility: exact percentages, filing dates, dollar amounts.
3. Imply suppressed or overlooked information: "quietly", "buried in a filing", "nobody noticed".
4. Never start with So, Today, Hey, Welcome, In this, Finally, or any generic opener.
5. One sentence only. Under 20 words. Punchy. Authoritative.

WEAK HOOKS (never write these):
- "Big news in the markets today." (no curiosity gap, vague and boring)
- "Let's talk about what happened with Apple stock." (passive, no urgency)
- "Tesla missed earnings." (states the answer, no reason to keep watching)

MID-ROLL PIVOT (critical for retention):
At roughly the midpoint of the body, include ONE pivot sentence that resets the viewer's attention. This combats the 12-second drop-off on Shorts. Use patterns like:
- "But here is the metric that the retail crowd is completely ignoring."
- "This is the part the headline does not tell you."
- "But the real signal is not in the price action."

ACCURACY IS NON-NEGOTIABLE:
- Cross-reference the story against any provided source article text
- Never invent numbers, dates or statistics
- If a claim cannot be verified, use hedging language: "reportedly", "according to sources"
- If source article text is provided, use it as your primary factual reference

VIDEO TITLE (suggested_title):
Generate a short, punchy video title (max 60 chars) using the curiosity gap technique.
- Must create an open loop: the viewer needs to watch to get the answer
- Use power words: "just", "quietly", "buried in a filing", "nobody noticed"
- Never fully reveal the news. Tease it
- NEVER use em dashes in titles, hooks, body or any output
- Include the company/ticker name for searchability
- Examples: "Goldman Sachs Just Reversed Their Biggest Call", "This SEC Filing Changes Everything for Tesla", "The Fed Knows Something the Market Doesn't"

Output ONLY valid JSON with no preamble and no markdown backticks:
{ "classification": "[INSIDER]|[RUMOR]|[CONFIRMED]|[BREAKING]|[EARNINGS]|[MARKET]", "hook": "", "body": "", "cta": "", "full_script": "", "word_count": 0, "suggested_thumbnail_text": "", "suggested_title": "" }`,
};
