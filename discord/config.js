const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Persistent channel/role ID map — written by setup.js, read by everything else
const ID_MAP_PATH = path.join(DATA_DIR, 'id_map.json');

function loadIdMap() {
  try {
    if (fs.existsSync(ID_MAP_PATH)) return JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8'));
  } catch (e) { /* ignore */ }
  return { channels: {}, roles: {}, messages: {} };
}

function saveIdMap(map) {
  fs.writeFileSync(ID_MAP_PATH, JSON.stringify(map, null, 2));
}

module.exports = {
  // Auth
  BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  GUILD_ID: process.env.DISCORD_GUILD_ID,

  // Brand colours (decimal for discord.js)
  COLOURS: {
    AMBER:    0xFF6B1A,
    BG:       0x0D0D0F,
    RED:      0xFF2D2D,
    GREEN:    0x22C55E,
    GREY:     0x6B7280,
    WHITE:    0xF0F0F0,
  },

  // Brand hex strings (for embeds that need hex)
  HEX: {
    AMBER:  '#FF6B1A',
    BG:     '#0D0D0F',
    RED:    '#FF2D2D',
    GREEN:  '#22C55E',
    GREY:   '#6B7280',
  },

  // Socials
  SOCIALS: {
    YOUTUBE:   'https://youtube.com/@PulseGMG',
    TIKTOK:    'https://tiktok.com/@pulsegamingnews',
    INSTAGRAM: 'https://instagram.com/pulse.gmg',
    TWITTER:   'https://x.com/Pulse_GMG',
  },

  // XP settings
  XP: {
    MIN: 15,
    MAX: 25,
    COOLDOWN_MS: 60_000,
    DAILY_BASE: 100,
    DAILY_MAX_STREAK: 5,
    TRIVIA_BONUS: 50,
    LEVEL_THRESHOLDS: {
      5:  'Regular',
      10: 'Insider',
      20: 'Leaker',
      50: 'OG',
    },
  },

  // Paths
  DATA_DIR,
  XP_PATH:          path.join(DATA_DIR, 'xp.json'),
  GIVEAWAYS_PATH:   path.join(DATA_DIR, 'giveaways.json'),
  PREDICTIONS_PATH: path.join(DATA_DIR, 'predictions.json'),
  DAILY_PATH:       path.join(DATA_DIR, 'daily.json'),
  ID_MAP_PATH,

  // Platform role emojis for reaction roles
  PLATFORM_EMOJIS: {
    '🎮': 'PlayStation',
    '🟢': 'Xbox',
    '🍄': 'Nintendo',
    '🖥️': 'PC Gamer',
  },

  // Channel name to key mapping (used by setup and auto_post)
  CHANNEL_NAMES: {
    rules:          'rules',
    announcements:  'announcements',
    'role-select':  'role-select',
    'breaking-news':'breaking-news',
    leaks:          'leaks',
    rumours:        'rumours',
    confirmed:      'confirmed',
    general:        'general',
    'gaming-talk':  'gaming-talk',
    predictions:    'predictions',
    memes:          'memes',
    introductions:  'introductions',
    giveaways:      'giveaways',
    trivia:         'trivia',
    leaderboard:    'leaderboard',
    'daily-streak': 'daily-streak',
    'video-drops':  'video-drops',
    'clip-submissions': 'clip-submissions',
    suggestions:    'suggestions',
    polls:          'polls',
    feedback:       'feedback',
    'mod-log':      'mod-log',
    'bot-commands': 'bot-commands',
    welcome:        'welcome',
    'level-ups':    'level-ups',
  },

  loadIdMap,
  saveIdMap,
};
