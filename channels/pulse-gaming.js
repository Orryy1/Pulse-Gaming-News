// Pulse Gaming — Channel Configuration
// Gaming leaks, rumours and breaking news

module.exports = {
  id: 'pulse-gaming',
  name: 'PULSE GAMING',
  tagline: 'Verified leaks. Every day.',
  cta: 'Follow Pulse Gaming so you never miss a drop',
  niche: 'gaming',

  // Brand palette
  colours: {
    PRIMARY: '#FF6B1A',
    PRIMARY_FFM: '0xFF6B1A',
    SECONDARY: '#0D0D0F',
    TEXT: '#F0F0F0',
    TEXT_FFM: '0xF0F0F0',
    ALERT: '#FF2D2D',
    ALERT_FFM: '0xFF2D2D',
    CONFIRMED: '#22C55E',
    CONFIRMED_FFM: '0x22C55E',
    MUTED: '#6B7280',
    MUTED_FFM: '0x6B7280',
  },

  // Classification system
  classificationColour(classification) {
    const c = (classification || '').toLowerCase();
    if (c.includes('leak')) return { hex: '#FF2D2D', ffm: '0xFF2D2D', label: 'LEAK' };
    if (c.includes('breaking')) return { hex: '#FF2D2D', ffm: '0xFF2D2D', label: 'BREAKING' };
    if (c.includes('rumor') || c.includes('rumour')) return { hex: '#FF6B1A', ffm: '0xFF6B1A', label: 'RUMOR' };
    if (c.includes('confirmed') || c.includes('verified')) return { hex: '#22C55E', ffm: '0x22C55E', label: 'CONFIRMED' };
    return { hex: '#6B7280', ffm: '0x6B7280', label: 'NEWS' };
  },

  // Voice
  voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
  voiceModel: 'eleven_multilingual_v2',
  voiceSettings: { stability: 0.25, similarity_boost: 0.85, style: 0.65, speaking_rate: 1.05 },

  // Content sources
  subreddits: [
    'GamingLeaksAndRumours', 'PCMasterRace', 'Games',
    'PS5', 'XboxSeriesX', 'NintendoSwitch', 'pcgaming', 'gaming',
  ],
  rssFeeds: [
    { name: 'IGN', url: 'https://feeds.feedburner.com/ign/all' },
    { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/' },
    { name: 'Eurogamer', url: 'https://www.eurogamer.net/feed' },
    { name: 'PCGamer', url: 'https://www.pcgamer.com/rss/' },
    { name: 'RockPaperShotgun', url: 'https://www.rockpapershotgun.com/feed' },
    { name: 'Kotaku', url: 'https://kotaku.com/rss' },
    { name: 'TheVergeGaming', url: 'https://www.theverge.com/games/rss/index.xml' },
    { name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml' },
  ],

  // Keywords for breaking score
  breakingKeywords: [
    'announced', 'revealed', 'confirmed', 'leaked', 'exclusive',
    'release date', 'trailer', 'gameplay', 'launch', 'delay',
    'cancelled', 'acquisition', 'price', 'free', 'update',
    'dlc', 'expansion', 'sequel', 'remaster', 'remake',
    'ps6', 'xbox', 'nintendo', 'switch 2', 'gta 6', 'gta vi',
  ],

  // YouTube category
  youtubeCategory: '20', // Gaming
  hashtags: ['#Shorts', '#GamingNews', '#GamingLeaks', '#PulseGaming'],
};
