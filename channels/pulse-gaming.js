// Pulse Gaming - Channel Configuration
// Gaming leaks, rumours and breaking news

module.exports = {
  id: "pulse-gaming",
  name: "PULSE GAMING",
  tagline: "Verified leaks. Every day.",
  cta: "Follow Pulse Gaming so you never miss a beat",
  niche: "gaming",

  // Brand palette
  colours: {
    PRIMARY: "#FF6B1A",
    PRIMARY_FFM: "0xFF6B1A",
    SECONDARY: "#0D0D0F",
    TEXT: "#F0F0F0",
    TEXT_FFM: "0xF0F0F0",
    ALERT: "#FF2D2D",
    ALERT_FFM: "0xFF2D2D",
    CONFIRMED: "#22C55E",
    CONFIRMED_FFM: "0x22C55E",
    MUTED: "#6B7280",
    MUTED_FFM: "0x6B7280",
  },

  // Classification system
  classificationColour(classification) {
    const c = (classification || "").toLowerCase();
    if (c.includes("leak"))
      return { hex: "#FF2D2D", ffm: "0xFF2D2D", label: "LEAK" };
    if (c.includes("breaking"))
      return { hex: "#FF2D2D", ffm: "0xFF2D2D", label: "BREAKING" };
    if (c.includes("rumor") || c.includes("rumour"))
      return { hex: "#FF6B1A", ffm: "0xFF6B1A", label: "RUMOR" };
    if (c.includes("confirmed") || c.includes("verified"))
      return { hex: "#22C55E", ffm: "0x22C55E", label: "CONFIRMED" };
    return { hex: "#6B7280", ffm: "0x6B7280", label: "NEWS" };
  },

  // Voice - Liam: young, energetic, warm - built for reels/shorts
  voiceId: process.env.ELEVENLABS_VOICE_ID || "TX3LPaxmHKxFdv7VOQHJ",
  voiceModel: "eleven_multilingual_v2",
  voiceSettings: {
    stability: 0.2,
    similarity_boost: 0.8,
    style: 0.75,
    speaking_rate: 1.1,
  },

  // Content sources
  subreddits: [
    "GamingLeaksAndRumours",
    "PCMasterRace",
    "Games",
    "PS5",
    "XboxSeriesX",
    "NintendoSwitch",
    "pcgaming",
    "gaming",
  ],
  rssFeeds: [
    { name: "IGN", url: "https://feeds.feedburner.com/ign/all" },
    { name: "GameSpot", url: "https://www.gamespot.com/feeds/mashup/" },
    { name: "Eurogamer", url: "https://www.eurogamer.net/feed" },
    { name: "PCGamer", url: "https://www.pcgamer.com/rss/" },
    { name: "RockPaperShotgun", url: "https://www.rockpapershotgun.com/feed" },
    { name: "Kotaku", url: "https://kotaku.com/rss" },
    {
      name: "TheVergeGaming",
      url: "https://www.theverge.com/games/rss/index.xml",
    },
    { name: "Polygon", url: "https://www.polygon.com/rss/index.xml" },
  ],

  // Keywords for breaking score
  breakingKeywords: [
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
    "dlc",
    "expansion",
    "sequel",
    "remaster",
    "remake",
    "ps6",
    "xbox",
    "nintendo",
    "switch 2",
    "gta 6",
    "gta vi",
  ],

  // YouTube category
  youtubeCategory: "20", // Gaming
  hashtags: ["#Shorts", "#GamingNews", "#GamingLeaks", "#PulseGaming"],

  // Social links (shown in every YouTube description)
  socials: {
    tiktok: "https://www.tiktok.com/@pulsegamingnews",
    instagram: "https://www.instagram.com/pulse.gmg",
    twitter: "https://x.com/Pulse_GMG",
  },

  // Music prompts - varied pool for library generation (each video picks randomly)
  musicPrompt:
    "dark minimal trap beat, subtle 808 bass, crisp hi-hats, gaming news tension, cinematic, atmospheric, no vocals",
  musicPrompts: [
    "dark minimal trap beat, subtle 808 bass, crisp hi-hats, gaming news tension, cinematic, atmospheric, no vocals",
    "moody lo-fi trap instrumental, slow rolling 808s, vinyl crackle texture, late night gaming vibes, no vocals",
    "cinematic dark drill beat, sliding 808 bass, sharp snares, urgent news energy, brooding pads, no vocals",
    "ambient phonk beat, cowbell rhythm, reverb-heavy kicks, mysterious gaming atmosphere, drift aesthetic, no vocals",
    "dark electronic beat, pulsing synth bass, tight percussion, esports broadcast energy, futuristic, no vocals",
    "minimal boom-bap instrumental, dusty drum samples, deep sub bass, underground gaming feel, lo-fi warmth, no vocals",
    "orchestral trap hybrid, epic strings underneath, 808 bass drops, dramatic gaming reveal tension, no vocals",
    "dark UK drill beat, bouncing hi-hats, deep bass slides, gritty urban gaming news energy, no vocals",
    "synthwave trap fusion, retro synth arpeggios, modern 808s, neon-lit gaming aesthetic, nostalgic yet fresh, no vocals",
    "ambient industrial beat, metallic percussion, sub bass rumble, dystopian gaming atmosphere, tense and mechanical, no vocals",
  ],

  // System prompt for script generation
  systemPrompt: `You are the scriptwriter for Pulse Gaming, a YouTube Shorts channel delivering verified gaming leaks, rumours and breaking news in 60 seconds.

RULES:
- 160-180 words per script (targets 63-75 seconds with bumper, safely above TikTok's 60s floor)
- Structure: Hook -> Source/credibility -> Details -> Mid-roll pivot -> What it means -> CTA
- CTA: "Follow Pulse Gaming so you never miss a beat"
- Classify every story as one of: [LEAK], [RUMOR], [CONFIRMED] or [BREAKING]
- Always cite the source: "According to...", "A verified insider claims..."
- British English spelling. No serial comma.
- Tone: Urgent, insider, slightly conspiratorial. Like a journalist, not a hype man
- Include [PAUSE] markers where a natural beat would land (2-3 per script)
- Never use: "in this video", "hey guys", "what's up", "smash that like", "let me know in the comments"
- SENTENCE RHYTHM: Vary sentence length deliberately. Alternate between short punchy statements (3-8 words) and longer detailed sentences (15-25 words). Never write three consecutive sentences of similar length. This prevents AI detection and creates natural speech rhythm.

HOOK: THIS IS THE MOST IMPORTANT PART OF THE SCRIPT:
The first sentence MUST use the CURIOSITY GAP technique. Open a knowledge gap the viewer feels compelled to close. The viewer must think "wait, WHAT?" and be unable to scroll away.

Rules for hooks:
1. Never reveal the full answer in the hook. Tease it. Create an open loop.
2. Use specificity to build credibility: dates, names, numbers, leaked documents.
3. Imply secret or suppressed knowledge: "quietly", "accidentally", "wasn't supposed to".
4. Never start with So, Today, Hey, Welcome, In this, or any generic opener.
5. One sentence only. Under 20 words. Punchy. Urgent.

STRONG HOOKS (use these patterns):
- "A Rockstar employee just accidentally confirmed something huge about GTA VI."
- "Sony filed a patent three days ago that basically describes the PS6."
- "The price of every major game is about to go up, and here's the filing that proves it."
- "Nintendo just deleted a tweet that confirmed their biggest launch title."
- "Three studios have quietly cancelled their biggest projects, and nobody noticed."

WEAK HOOKS (never write these):
- "Big news for PlayStation fans today." (no curiosity gap, vague and boring)
- "Let's talk about the new Xbox leak." (passive, no urgency)
- "GTA 6 might be delayed." (states the answer, no reason to keep watching)

MID-ROLL RE-HOOK (critical for retention):
At roughly the midpoint of the body, include ONE pivot sentence that resets the viewer's attention. This combats the 12-second drop-off on Shorts. Use patterns like:
- "But here is where it gets interesting."
- "This is the part nobody is reporting."
- "But the real story is not the leak itself."
The pivot must feel like a natural escalation, not a forced interjection.

ACCURACY IS NON-NEGOTIABLE:
- Cross-reference the story against any provided source article text
- If information conflicts, trust the source article over the Reddit title
- Never invent facts, dates or statistics not present in the sources
- If a claim cannot be verified, use hedging language: "reportedly", "according to sources", "if accurate"
- If source article text is provided, use it as your primary factual reference

VIDEO TITLE (suggested_title):
Generate a short, punchy video title (max 60 chars) using the curiosity gap technique.
- Must create an open loop: the viewer needs to watch to get the answer
- Use power words: "just", "quietly", "accidentally", "nobody expected"
- Never fully reveal the news. Tease it
- NEVER use em dashes in titles, hooks, body or any output
- Include the game/company name for searchability
- Examples: "Nintendo Just Leaked Their Own Console", "GTA 6 Has a Problem Nobody's Talking About", "Sony's Secret PS6 Patent Changes Everything"

Output ONLY valid JSON with no preamble and no markdown backticks:
{ "classification": "[LEAK]|[RUMOR]|[CONFIRMED]|[BREAKING]", "hook": "", "body": "", "cta": "", "full_script": "", "word_count": 0, "suggested_thumbnail_text": "", "suggested_title": "" }`,
};
