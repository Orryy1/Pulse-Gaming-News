// THE SIGNAL — Channel Configuration
// Tech news, AI breakthroughs, product launches and Silicon Valley insider moves

module.exports = {
  id: 'the-signal',
  name: 'THE SIGNAL',
  tagline: 'Tech moves first. You hear it here.',
  cta: 'Follow The Signal so you never miss a launch',
  niche: 'tech',

  // Brand palette — Electric Purple/Cyan
  colours: {
    PRIMARY: '#A855F7',         // Signal Purple
    PRIMARY_FFM: '0xA855F7',
    SECONDARY: '#08080C',       // Near Black
    TEXT: '#F0F0F0',            // Signal White
    TEXT_FFM: '0xF0F0F0',
    ALERT: '#EC4899',           // Hot Pink — breaking/leaks
    ALERT_FFM: '0xEC4899',
    CONFIRMED: '#22D3EE',       // Cyan — confirmed
    CONFIRMED_FFM: '0x22D3EE',
    MUTED: '#6B7280',           // Cool Grey
    MUTED_FFM: '0x6B7280',
  },

  // Classification system — tech-specific
  classificationColour(classification) {
    const c = (classification || '').toLowerCase();
    if (c.includes('leak')) return { hex: '#EC4899', ffm: '0xEC4899', label: 'LEAK' };
    if (c.includes('breaking')) return { hex: '#EC4899', ffm: '0xEC4899', label: 'BREAKING' };
    if (c.includes('rumor') || c.includes('rumour')) return { hex: '#A855F7', ffm: '0xA855F7', label: 'RUMOR' };
    if (c.includes('confirmed') || c.includes('verified')) return { hex: '#22D3EE', ffm: '0x22D3EE', label: 'CONFIRMED' };
    if (c.includes('launch')) return { hex: '#22D3EE', ffm: '0x22D3EE', label: 'LAUNCH' };
    return { hex: '#6B7280', ffm: '0x6B7280', label: 'TECH' };
  },

  // Voice — energetic female, punchy delivery (matches Shorts pacing)
  voiceId: process.env.SIGNAL_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL', // Bella
  voiceModel: 'eleven_multilingual_v2',
  voiceSettings: { stability: 0.20, similarity_boost: 0.80, style: 0.70, speaking_rate: 1.1 },

  // Content sources — tech subreddits + RSS
  subreddits: [
    'technology', 'artificial', 'MachineLearning', 'gadgets',
    'apple', 'Android', 'programming', 'Futurology',
  ],
  rssFeeds: [
    { name: 'TheVerge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
    { name: 'ArsTechnica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
    { name: 'Engadget', url: 'https://www.engadget.com/rss.xml' },
    { name: 'ZDNET', url: 'https://www.zdnet.com/news/rss.xml' },
    { name: 'Gizmodo', url: 'https://gizmodo.com/rss' },
    { name: 'Protocol', url: 'https://www.protocol.com/feeds/feed.rss' },
  ],

  // Keywords for breaking score
  breakingKeywords: [
    'announced', 'revealed', 'leaked', 'launched', 'released',
    'ai', 'gpt', 'claude', 'gemini', 'llm', 'openai', 'anthropic',
    'apple', 'iphone', 'google', 'microsoft', 'meta', 'samsung',
    'chip', 'processor', 'quantum', 'robot', 'autonomous',
    'acquisition', 'layoffs', 'ipo', 'patent', 'antitrust',
    'data breach', 'hack', 'security', 'privacy', 'regulation',
  ],

  // YouTube category
  youtubeCategory: '28', // Science & Technology
  hashtags: ['#Shorts', '#TechNews', '#AI', '#Technology', '#TheSignal'],

  // Music prompts — varied pool for library generation
  musicPrompt: 'futuristic synth beat, digital glitch textures, subtle bass, tech news energy, cyberpunk minimal, atmospheric, no vocals',
  musicPrompts: [
    'futuristic synth beat, digital glitch textures, subtle bass, tech news energy, cyberpunk minimal, atmospheric, no vocals',
    'ambient IDM beat, granular synthesis textures, clicking percussion, AI research lab atmosphere, no vocals',
    'dark synthwave instrumental, pulsing arpeggios, analog warmth, silicon valley night drive, no vocals',
    'glitchy breakbeat, chopped samples, deep reese bass, data stream aesthetic, digital chaos, no vocals',
    'minimal ambient techno, soft kicks, shimmering pads, server room hum, clean futuristic, no vocals',
    'neo-classical electronic, piano fragments over subtle beats, tech keynote gravitas, elegant innovation, no vocals',
    'cyberpunk drum and bass, fast hi-hats, wobble bass, neon city tech news urgency, no vocals',
    'lo-fi electronic ambient, tape saturation, gentle beats, late night coding session atmosphere, no vocals',
  ],

  // System prompt for script generation
  systemPrompt: `You are the scriptwriter for THE SIGNAL, a YouTube Shorts channel delivering verified tech news, AI breakthroughs and product launches in 60 seconds.

RULES:
- 160-180 words per script (targets 63-75 seconds with bumper)
- Open with a HOOK: a data point, a leaked spec or a bold claim. Never start with So, Today, Hey, Welcome or In this.
- Structure: Hook -> Source -> Technical detail -> Impact -> CTA
- CTA: "Follow The Signal so you never miss a launch"
- Classify every story as one of: [LEAK], [RUMOR], [CONFIRMED], [BREAKING], [LAUNCH] or [TECH]
- Always cite the source: "According to...", "Sources inside [company] confirm..."
- British English spelling. No serial comma.
- Tone: Precise, slightly excited about tech, like an engineer who can't keep a secret
- Include [PAUSE] markers where a natural beat would land (2-3 per script)
- Never use: "in this video", "hey guys", "what's up", "smash that like", "let me know in the comments"

EXAMPLE HOOKS:
- "Apple just filed a patent that essentially describes a foldable iPhone — and there's a production date."
- "OpenAI's latest model scores higher than 99.8% of human programmers on competitive coding."
- "Samsung leaked their own Galaxy S26 in a firmware update three months early."

ACCURACY IS NON-NEGOTIABLE:
- Cross-reference the story against any provided source article text
- Never invent specs, benchmarks, dates or statistics
- If a claim cannot be verified, use hedging language: "reportedly", "according to sources"

Output ONLY valid JSON:
{ "classification": "[LEAK]|[RUMOR]|[CONFIRMED]|[BREAKING]|[LAUNCH]|[TECH]", "hook": "", "body": "", "cta": "", "full_script": "", "word_count": 0, "suggested_thumbnail_text": "" }`,
};
