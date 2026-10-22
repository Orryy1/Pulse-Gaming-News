// XP and daily-streak stores for the Discord bot. Both files hold Discord user IDs
// (personal data), so they are runtime data only: created on first use, never committed
// (see .gitignore). A missing file starts empty.
const fs = require('fs');
const config = require('./config');

// ---------------------------------------------------------------------------
// XP Manager - stored in discord/data/xp.json
// ---------------------------------------------------------------------------
class XpManager {
  constructor(filePath = config.XP_PATH) {
    this.path = filePath;
    this.data = this._load();
    this.cooldowns = new Map();
  }

  _load() {
    try {
      if (fs.existsSync(this.path)) return JSON.parse(fs.readFileSync(this.path, 'utf8'));
    } catch (e) { /* ignore */ }
    return {};
  }

  _save() {
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  getUser(userId) {
    if (!this.data[userId]) {
      this.data[userId] = { xp: 0, level: 0, messages: 0 };
      this._save();
    }
    return this.data[userId];
  }

  addXp(userId, amount) {
    const user = this.getUser(userId);
    user.xp = Math.max(0, user.xp + amount);
    user.level = this._calcLevel(user.xp);
    this._save();
    return user;
  }

  /**
   * Handle a message for XP. Returns { levelledUp, newLevel } or null if on cooldown.
   */
  handleMessage(userId) {
    const now = Date.now();
    const last = this.cooldowns.get(userId) || 0;
    if (now - last < config.XP.COOLDOWN_MS) return null;

    this.cooldowns.set(userId, now);
    const user = this.getUser(userId);
    const oldLevel = user.level;
    const gain = Math.floor(Math.random() * (config.XP.MAX - config.XP.MIN + 1)) + config.XP.MIN;
    user.xp += gain;
    user.messages += 1;
    user.level = this._calcLevel(user.xp);
    this._save();

    if (user.level > oldLevel) {
      return { levelledUp: true, newLevel: user.level, xp: user.xp };
    }
    return { levelledUp: false };
  }

  _calcLevel(xp) {
    // 100 XP per level, scaling: level N requires N*100 total XP
    // Simple formula: level = floor(sqrt(xp / 50))
    return Math.floor(Math.sqrt(xp / 50));
  }

  xpForLevel(level) {
    return level * level * 50;
  }

  getLeaderboard(count = 10) {
    return Object.entries(this.data)
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, count);
  }

  getRank(userId) {
    const sorted = Object.entries(this.data)
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => b.xp - a.xp);
    const idx = sorted.findIndex(u => u.id === userId);
    return idx === -1 ? sorted.length + 1 : idx + 1;
  }
}

// ---------------------------------------------------------------------------
// Daily Streak Manager
// ---------------------------------------------------------------------------
class DailyManager {
  constructor(filePath = config.DAILY_PATH) {
    this.path = filePath;
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.path)) return JSON.parse(fs.readFileSync(this.path, 'utf8'));
    } catch (e) { /* ignore */ }
    return {};
  }

  _save() {
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  claim(userId) {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const user = this.data[userId] || { lastClaim: null, streak: 0 };

    if (user.lastClaim === today) {
      return { success: false, reason: 'already_claimed', streak: user.streak };
    }

    // Check if yesterday was claimed (streak continues)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
    if (user.lastClaim === yesterday) {
      user.streak = Math.min(user.streak + 1, config.XP.DAILY_MAX_STREAK);
    } else {
      user.streak = 1;
    }

    user.lastClaim = today;
    this.data[userId] = user;
    this._save();

    const xp = config.XP.DAILY_BASE * user.streak;
    return { success: true, streak: user.streak, xp };
  }
}

module.exports = { XpManager, DailyManager };
