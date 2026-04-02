// STACKED — Channel Configuration
// Finance news, market moves, earnings and insider trades

module.exports = {
  id: 'stacked',
  name: 'STACKED',
  tagline: 'Markets. Decoded. Daily.',
  cta: 'Follow STACKED so you never miss a move',
  niche: 'finance',

  // Brand palette — Money Green
  colours: {
    PRIMARY: '#00C853',         // Profit Green
    PRIMARY_FFM: '0x00C853',
    SECONDARY: '#0A0A0C',       // Vault Black
    TEXT: '#F0F0F0',            // Signal White
    TEXT_FFM: '0xF0F0F0',
    ALERT: '#FF1744',           // Loss Red
    ALERT_FFM: '0xFF1744',
    CONFIRMED: '#00E676',       // Bright Green — confirmed moves
    CONFIRMED_FFM: '0x00E676',
    MUTED: '#78909C',           // Slate Grey
    MUTED_FFM: '0x78909C',
  },

  // Classification system — finance-specific
  classificationColour(classification) {
    const c = (classification || '').toLowerCase();
    if (c.includes('leak') || c.includes('insider')) return { hex: '#FF1744', ffm: '0xFF1744', label: 'INSIDER' };
    if (c.includes('breaking')) return { hex: '#FF1744', ffm: '0xFF1744', label: 'BREAKING' };
    if (c.includes('rumor') || c.includes('rumour')) return { hex: '#FFD600', ffm: '0xFFD600', label: 'RUMOR' };
    if (c.includes('confirmed') || c.includes('verified')) return { hex: '#00C853', ffm: '0x00C853', label: 'CONFIRMED' };
    if (c.includes('earnings')) return { hex: '#00C853', ffm: '0x00C853', label: 'EARNINGS' };
    return { hex: '#78909C', ffm: '0x78909C', label: 'MARKET' };
  },

  // Voice — energetic, authoritative male (matches Shorts pacing)
  voiceId: process.env.STACKED_VOICE_ID || 'ErXwobaYiN019PkySvjV', // Antoni
  voiceModel: 'eleven_multilingual_v2',
  voiceSettings: { stability: 0.20, similarity_boost: 0.80, style: 0.70, speaking_rate: 1.1 },

  // Content sources — finance subreddits + RSS
  subreddits: [
    'wallstreetbets', 'stocks', 'investing', 'StockMarket',
    'finance', 'economics', 'CryptoCurrency', 'options',
  ],
  rssFeeds: [
    { name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss' },
    { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
    { name: 'Reuters', url: 'https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best' },
    { name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/' },
    { name: 'YahooFinance', url: 'https://finance.yahoo.com/news/rssindex' },
    { name: 'SeekingAlpha', url: 'https://seekingalpha.com/market_currents.xml' },
    { name: 'Motley Fool', url: 'https://www.fool.com/feeds/index.aspx' },
    { name: 'Benzinga', url: 'https://www.benzinga.com/feed' },
  ],

  // Keywords for breaking score
  breakingKeywords: [
    'earnings', 'revenue', 'profit', 'loss', 'beat', 'miss',
    'ipo', 'merger', 'acquisition', 'buyout', 'dividend',
    'fed', 'rate cut', 'rate hike', 'inflation', 'recession',
    'crash', 'rally', 'all-time high', 'insider', 'sec',
    'tesla', 'apple', 'nvidia', 'microsoft', 'amazon',
    'bitcoin', 'crypto', 'etf', 'layoffs', 'bankruptcy',
  ],

  // YouTube category
  youtubeCategory: '25', // News & Politics
  hashtags: ['#Shorts', '#Finance', '#StockMarket', '#Investing', '#STACKED'],

  // Music prompt for background beat
  musicPrompt: 'dark cinematic trap beat, deep bass, ticking clock tension, stock market urgency, minimal, atmospheric, no vocals',

  // System prompt for script generation
  systemPrompt: `You are the scriptwriter for STACKED, a YouTube Shorts channel delivering verified finance news, market moves and insider trades in 60 seconds.

RULES:
- 160-180 words per script (targets 63-75 seconds with bumper)
- Open with a HOOK: a number, a market move or a bold claim. Never start with So, Today, Hey, Welcome or In this.
- Structure: Hook -> Source/data -> Analysis -> What it means for you -> CTA
- CTA: "Follow STACKED so you never miss a move"
- Classify every story as one of: [INSIDER], [RUMOR], [CONFIRMED], [BREAKING], [EARNINGS] or [MARKET]
- Always cite the source: "According to SEC filings...", "Bloomberg reports..."
- British English spelling. No serial comma.
- Tone: Sharp, data-driven, slightly urgent — like a Bloomberg terminal notification
- Include [PAUSE] markers where a natural beat would land (2-3 per script)
- Never use: "in this video", "hey guys", "what's up", "smash that like", "let me know in the comments"
- Never give investment advice. Use: "This is not financial advice" if discussing specific trades.

EXAMPLE HOOKS:
- "NVIDIA just posted earnings that beat estimates by 22% — and the stock dropped."
- "The Fed meets in 48 hours and the bond market is pricing in something nobody expected."
- "An SEC filing from three days ago reveals a billionaire dumped 40% of their Apple position."

ACCURACY IS NON-NEGOTIABLE:
- Cross-reference the story against any provided source article text
- Never invent numbers, dates or statistics
- If a claim cannot be verified, use hedging language: "reportedly", "according to sources"

Output ONLY valid JSON:
{ "classification": "[INSIDER]|[RUMOR]|[CONFIRMED]|[BREAKING]|[EARNINGS]|[MARKET]", "hook": "", "body": "", "cta": "", "full_script": "", "word_count": 0, "suggested_thumbnail_text": "" }`,
};
