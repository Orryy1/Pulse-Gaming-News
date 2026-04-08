const dotenv = require('dotenv');
dotenv.config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const {
  Client, GatewayIntentBits, Collection, REST, Routes,
  EmbedBuilder, Events, Partials, ActivityType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ---------------------------------------------------------------------------
// XP Manager - stored in discord/data/xp.json
// ---------------------------------------------------------------------------
class XpManager {
  constructor() {
    this.path = config.XP_PATH;
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
  constructor() {
    this.path = config.DAILY_PATH;
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

// ---------------------------------------------------------------------------
// Client setup
// ---------------------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.GuildMember],
});

const xpManager = new XpManager();
const dailyManager = new DailyManager();
client.xpManager = xpManager;
client.dailyManager = dailyManager;

// ---------------------------------------------------------------------------
// Load slash commands
// ---------------------------------------------------------------------------
client.commands = new Collection();

const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
const commandData = [];

for (const file of commandFiles) {
  const cmd = require(path.join(__dirname, 'commands', file));
  if (cmd.data) {
    client.commands.set(cmd.data.name, cmd);
    commandData.push(cmd.data.toJSON());
  }
}

// Built-in slash commands (leaderboard, rank, daily)
const { SlashCommandBuilder } = require('discord.js');

const leaderboardCmd = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show the top 10 XP leaderboard');
commandData.push(leaderboardCmd.toJSON());

const rankCmd = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Show your current rank, level and XP');
commandData.push(rankCmd.toJSON());

const dailyCmd = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Claim your daily XP bonus (streak multiplier up to 5x!)');
commandData.push(dailyCmd.toJSON());

// ---------------------------------------------------------------------------
// Register commands on ready
// ---------------------------------------------------------------------------
client.once(Events.ClientReady, async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  client.user.setActivity('Verified leaks. Every day.', { type: ActivityType.Watching });

  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(config.BOT_TOKEN);
  try {
    if (config.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, config.GUILD_ID),
        { body: commandData },
      );
      console.log(`[Bot] Registered ${commandData.length} slash commands for guild ${config.GUILD_ID}.`);
    } else {
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commandData },
      );
      console.log(`[Bot] Registered ${commandData.length} global slash commands.`);
    }
  } catch (err) {
    console.error('[Bot] Failed to register slash commands:', err.message);
  }

  // Reschedule active giveaways
  const giveawayCmd = client.commands.get('giveaway');
  if (giveawayCmd && giveawayCmd.rescheduleAll) {
    giveawayCmd.rescheduleAll(client);
  }

  // Set up reaction role listener for existing messages
  setupReactionRoles();
});

// ---------------------------------------------------------------------------
// Auto-role on member join + welcome message
// ---------------------------------------------------------------------------
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const idMap = config.loadIdMap();

    // Assign "Viewer" role
    const viewerRoleId = idMap.roles && idMap.roles['Viewer'];
    if (viewerRoleId) {
      const role = member.guild.roles.cache.get(viewerRoleId);
      if (role) await member.roles.add(role).catch(() => {});
    }

    // Welcome message
    const welcomeChannelId = idMap.channels && idMap.channels['welcome'];
    if (welcomeChannelId) {
      const channel = member.guild.channels.cache.get(welcomeChannelId);
      if (channel) {
        const embed = new EmbedBuilder()
          .setColor(config.COLOURS.AMBER)
          .setTitle(`Welcome to PULSE GAMING, ${member.user.username}!`)
          .setDescription(
            `Verified leaks. Every day.\n\n` +
            `You are member **#${member.guild.memberCount}** of the Pulse community.\n\n` +
            `**Get started:**\n` +
            `> Head to <#${idMap.channels['role-select'] || ''}> to pick your platform\n` +
            `> Check <#${idMap.channels['rules'] || ''}> for server rules\n` +
            `> Chat in <#${idMap.channels['general'] || ''}>\n` +
            `> Use \`/daily\` every day to build your XP streak!\n\n` +
            `**Follow us:**\n` +
            `[YouTube](${config.SOCIALS.YOUTUBE}) | [TikTok](${config.SOCIALS.TIKTOK}) | [Instagram](${config.SOCIALS.INSTAGRAM}) | [X](${config.SOCIALS.TWITTER})`
          )
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .setFooter({ text: 'PULSE GAMING' })
          .setTimestamp();

        await channel.send({ content: `<@${member.id}>`, embeds: [embed] });
      }
    }
  } catch (err) {
    console.error('[Bot] Welcome error:', err.message);
  }
});

// ---------------------------------------------------------------------------
// XP on message
// ---------------------------------------------------------------------------
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const result = xpManager.handleMessage(message.author.id);
  if (!result) return;

  if (result.levelledUp) {
    const idMap = config.loadIdMap();

    // Send level-up notification
    const levelUpChannelId = idMap.channels && idMap.channels['level-ups'];
    if (levelUpChannelId) {
      const channel = message.guild.channels.cache.get(levelUpChannelId);
      if (channel) {
        const embed = new EmbedBuilder()
          .setColor(config.COLOURS.AMBER)
          .setTitle('Level Up!')
          .setDescription(`<@${message.author.id}> just reached **Level ${result.newLevel}**! 🔥`)
          .setFooter({ text: `Total XP: ${result.xp}` })
          .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
      }
    }

    // Check for level role assignment
    await assignLevelRoles(message.member, result.newLevel);
  }
});

async function assignLevelRoles(member, level) {
  if (!member) return;
  const idMap = config.loadIdMap();

  for (const [threshold, roleName] of Object.entries(config.XP.LEVEL_THRESHOLDS)) {
    const t = parseInt(threshold, 10);
    const roleId = idMap.roles && idMap.roles[roleName];
    if (!roleId) continue;

    const role = member.guild.roles.cache.get(roleId);
    if (!role) continue;

    if (level >= t) {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(role).catch(() => {});
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Slash command handler
// ---------------------------------------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  // --- Button interactions (Story approval) ---
  if (interaction.isButton()) {
    const [action, storyId] = interaction.customId.split('_');
    if (action === 'story-approve' || action === 'story-reject') {
      try {
        const fsExtra = require('fs-extra');
        const newsPath = path.join(__dirname, '..', 'daily_news.json');
        if (!fsExtra.pathExistsSync(newsPath)) {
          return interaction.reply({ content: 'No stories found.', ephemeral: true });
        }
        const stories = fsExtra.readJsonSync(newsPath);
        const story = stories.find(s => s.id === storyId);
        if (!story) {
          return interaction.reply({ content: `Story ${storyId} not found.`, ephemeral: true });
        }

        if (action === 'story-approve') {
          story.story_approved = true;
          story.story_approved_by = interaction.user.tag;
          story.story_approved_at = new Date().toISOString();
          fsExtra.writeJsonSync(newsPath, stories, { spaces: 2 });

          const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(config.COLOURS.GREEN)
            .setFooter({ text: `Approved by ${interaction.user.tag}` });
          await interaction.update({
            embeds: [embed],
            components: [],
          });
        } else {
          story.story_rejected = true;
          story.story_rejected_by = interaction.user.tag;
          fsExtra.writeJsonSync(newsPath, stories, { spaces: 2 });

          const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(config.COLOURS.RED)
            .setFooter({ text: `Rejected by ${interaction.user.tag}` });
          await interaction.update({
            embeds: [embed],
            components: [],
          });
        }
      } catch (err) {
        console.error('[Bot] Story approval error:', err.message);
        await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true }).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  // Built-in commands
  if (interaction.commandName === 'leaderboard') {
    return handleLeaderboard(interaction);
  }
  if (interaction.commandName === 'rank') {
    return handleRank(interaction);
  }
  if (interaction.commandName === 'daily') {
    return handleDaily(interaction);
  }

  // File-based commands
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[Bot] Command error (${interaction.commandName}):`, err);
    const content = 'Something went wrong executing that command.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content, ephemeral: true }).catch(() => {});
    }
  }
});

// ---------------------------------------------------------------------------
// Built-in command handlers
// ---------------------------------------------------------------------------
async function handleLeaderboard(interaction) {
  const top = xpManager.getLeaderboard(10);

  if (top.length === 0) {
    return interaction.reply({ content: 'No XP data yet. Start chatting to earn XP!', ephemeral: true });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((u, i) => {
    const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
    return `${prefix} <@${u.id}> - Level ${u.level} (${u.xp.toLocaleString()} XP)`;
  });

  const embed = new EmbedBuilder()
    .setColor(config.COLOURS.AMBER)
    .setTitle('🏆 PULSE GAMING Leaderboard')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Earn XP by chatting, trivia, predictions and daily streaks!' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleRank(interaction) {
  const userId = interaction.user.id;
  const userData = xpManager.getUser(userId);
  const rank = xpManager.getRank(userId);
  const nextLevelXp = xpManager.xpForLevel(userData.level + 1);
  const progress = userData.xp - xpManager.xpForLevel(userData.level);
  const needed = nextLevelXp - xpManager.xpForLevel(userData.level);
  const pct = needed > 0 ? Math.min(100, Math.floor(progress / needed * 100)) : 100;

  const barLength = 20;
  const filled = Math.round(pct / 100 * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

  const embed = new EmbedBuilder()
    .setColor(config.COLOURS.AMBER)
    .setTitle(`${interaction.user.username}'s Rank`)
    .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'Rank', value: `#${rank}`, inline: true },
      { name: 'Level', value: `${userData.level}`, inline: true },
      { name: 'Total XP', value: `${userData.xp.toLocaleString()}`, inline: true },
      { name: 'Messages', value: `${(userData.messages || 0).toLocaleString()}`, inline: true },
      { name: 'Progress to Next Level', value: `${bar} ${pct}%\n${userData.xp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP` },
    )
    .setFooter({ text: 'PULSE GAMING' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleDaily(interaction) {
  const result = dailyManager.claim(interaction.user.id);

  if (!result.success) {
    return interaction.reply({
      content: `You have already claimed your daily XP today! Come back tomorrow.\nCurrent streak: **${result.streak}x**`,
      ephemeral: true,
    });
  }

  // Award XP
  xpManager.addXp(interaction.user.id, result.xp);

  const streakEmojis = ['', '🔥', '🔥🔥', '🔥🔥🔥', '🔥🔥🔥🔥', '🔥🔥🔥🔥🔥'];

  const embed = new EmbedBuilder()
    .setColor(config.COLOURS.AMBER)
    .setTitle('Daily XP Claimed!')
    .setDescription(
      `You earned **${result.xp} XP**! ${streakEmojis[result.streak] || '🔥🔥🔥🔥🔥'}\n\n` +
      `**Streak:** ${result.streak}x multiplier\n` +
      `**Base:** ${config.XP.DAILY_BASE} XP x ${result.streak} = ${result.xp} XP\n\n` +
      (result.streak < config.XP.DAILY_MAX_STREAK
        ? `Come back tomorrow to increase your streak to **${result.streak + 1}x**!`
        : `You are at the maximum streak! Keep claiming daily to maintain it.`)
    )
    .setFooter({ text: 'PULSE GAMING - Claim daily to keep your streak!' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// Reaction roles
// ---------------------------------------------------------------------------
function setupReactionRoles() {
  const idMap = config.loadIdMap();
  const roleSelectMsgId = idMap.messages && idMap.messages['role-select'];
  if (roleSelectMsgId) {
    console.log('[Bot] Reaction role message ID:', roleSelectMsgId);
  }
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  await handleReactionRole(reaction, user, 'add');
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;
  await handleReactionRole(reaction, user, 'remove');
});

async function handleReactionRole(reaction, user, action) {
  // Fetch partial reactions
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

  const idMap = config.loadIdMap();
  const roleSelectMsgId = idMap.messages && idMap.messages['role-select'];
  if (!roleSelectMsgId || reaction.message.id !== roleSelectMsgId) return;

  const emoji = reaction.emoji.name;
  // Map emoji to platform emoji (handle both unicode variants)
  const platformMap = {};
  for (const [e, roleName] of Object.entries(config.PLATFORM_EMOJIS)) {
    platformMap[e] = roleName;
  }

  const roleName = platformMap[emoji];
  if (!roleName) return;

  const roleId = idMap.roles && idMap.roles[roleName];
  if (!roleId) return;

  try {
    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    const role = guild.roles.cache.get(roleId);
    if (!role) return;

    if (action === 'add') {
      await member.roles.add(role);
    } else {
      await member.roles.remove(role);
    }
  } catch (err) {
    console.error('[Bot] Reaction role error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
client.on(Events.Error, (err) => {
  console.error('[Bot] Client error:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[Bot] Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('[Bot] Uncaught exception:', err);
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
if (!config.BOT_TOKEN) {
  console.error('[Bot] DISCORD_BOT_TOKEN is not set. Add it to your .env file.');
  process.exit(1);
}

client.login(config.BOT_TOKEN);

module.exports = { client, xpManager, dailyManager };
