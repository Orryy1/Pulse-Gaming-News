/**
 * PULSE GAMING - One-time Discord server setup
 *
 * Creates the entire server structure: categories, channels, roles, pinned messages.
 * Run once with:  node discord/setup.js
 *
 * Requires DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in .env
 */

const {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits,
  EmbedBuilder, Events, Partials,
} = require('discord.js');
const config = require('./config');

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const TOKEN = process.env.DISCORD_BOT_TOKEN || config.BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID || config.GUILD_ID;

if (!TOKEN || !GUILD_ID) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in .env before running setup.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

// ---------------------------------------------------------------------------
// Role definitions (created bottom-up so hoisting order is correct)
// ---------------------------------------------------------------------------
const ROLE_DEFS = [
  // Platform roles (no special perms, lowest position)
  { name: 'PC Gamer',    color: 0x6B7280, hoist: false, permissions: [] },
  { name: 'Nintendo',    color: 0x6B7280, hoist: false, permissions: [] },
  { name: 'Xbox',        color: 0x6B7280, hoist: false, permissions: [] },
  { name: 'PlayStation', color: 0x6B7280, hoist: false, permissions: [] },
  // Level / community roles
  { name: 'Viewer',      color: 0x6B7280, hoist: false, permissions: [] },
  { name: 'Regular',     color: 0x6B7280, hoist: true,  permissions: [] },
  { name: 'Insider',     color: 0xF0F0F0, hoist: true,  permissions: [] },
  { name: 'Leaker',      color: 0xFF6B1A, hoist: true,  permissions: [] },
  { name: 'OG',          color: 0x22C55E, hoist: true,  permissions: [] },
  // Staff roles
  {
    name: 'Moderator',
    color: 0xFF2D2D,
    hoist: true,
    permissions: [
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.ManageNicknames,
    ],
  },
  {
    name: 'Admin',
    color: 0xFF6B1A,
    hoist: true,
    permissions: [PermissionFlagsBits.Administrator],
  },
];

// ---------------------------------------------------------------------------
// Category + channel definitions
// ---------------------------------------------------------------------------
const CATEGORIES = [
  {
    name: '📢 INFORMATION',
    channels: [
      { name: 'rules',         type: ChannelType.GuildText, readOnly: true, topic: 'Server rules - read before posting' },
      { name: 'announcements',  type: ChannelType.GuildText, readOnly: true, topic: 'Channel updates, milestones and important news from the team' },
      { name: 'role-select',    type: ChannelType.GuildText, readOnly: true, topic: 'React to pick your platform roles (PC, Xbox, PlayStation, Nintendo)' },
      { name: 'welcome',        type: ChannelType.GuildText, topic: 'Say hello to new members as they join the community' },
      { name: 'level-ups',      type: ChannelType.GuildText, topic: 'Automatic level-up announcements - earn XP by chatting and claiming /daily' },
    ],
  },
  {
    name: '🔥 NEWS FEED',
    channels: [
      { name: 'breaking-news', type: ChannelType.GuildText, readOnly: true, topic: 'High-impact gaming news posted automatically by the Pulse bot' },
      { name: 'leaks',         type: ChannelType.GuildText, readOnly: true, topic: 'Credible leaks and insider info - sources cited, take with a pinch of salt' },
      { name: 'rumours',       type: ChannelType.GuildText, readOnly: true, topic: 'Unverified rumours - fun to speculate, not confirmed' },
      { name: 'confirmed',     type: ChannelType.GuildText, readOnly: true, topic: 'Officially confirmed news - verified by publishers or developers' },
    ],
  },
  {
    name: '💬 COMMUNITY',
    channels: [
      { name: 'general',       type: ChannelType.GuildText, topic: 'Chat about anything gaming-related' },
      { name: 'gaming-talk',   type: ChannelType.GuildText, topic: 'Deep dives into specific games, reviews and recommendations' },
      { name: 'predictions',   type: ChannelType.GuildText, topic: 'Make predictions with /predict - earn 2x XP if you are right' },
      { name: 'memes',         type: ChannelType.GuildText, topic: 'Gaming memes only - keep it clean' },
      { name: 'introductions', type: ChannelType.GuildText, topic: 'New here? Tell us what you play and what platforms you are on' },
    ],
  },
  {
    name: '🏆 COMPETITIONS',
    channels: [
      { name: 'giveaways',     type: ChannelType.GuildText, topic: 'Active giveaways - react to enter, winners announced here' },
      { name: 'trivia',        type: ChannelType.GuildText, topic: 'Gaming trivia challenges - use /trivia to play and earn 50 XP per correct answer' },
      { name: 'leaderboard',   type: ChannelType.GuildText, topic: 'Top community members by XP - use /leaderboard to check rankings' },
      { name: 'daily-streak',  type: ChannelType.GuildText, topic: 'Claim your daily XP with /daily - build streaks for bonus multipliers up to 5x' },
    ],
  },
  {
    name: '🎬 CONTENT',
    channels: [
      { name: 'video-drops',      type: ChannelType.GuildText, readOnly: true, topic: 'New Pulse Gaming Shorts posted automatically when they go live' },
      { name: 'clip-submissions',  type: ChannelType.GuildText, topic: 'Share your best gaming clips - might get featured on the channel' },
      { name: 'suggestions',       type: ChannelType.GuildText, topic: 'Suggest topics, games or features you want to see covered' },
    ],
  },
  {
    name: '📊 FEEDBACK',
    channels: [
      { name: 'polls',    type: ChannelType.GuildText, topic: 'Community polls - vote on what content comes next' },
      { name: 'feedback', type: ChannelType.GuildText, topic: 'Tell us what is working and what is not - all feedback welcome' },
    ],
  },
  {
    name: '🔇 STAFF',
    channels: [
      { name: 'mod-log',      type: ChannelType.GuildText, staffOnly: true, topic: 'Automated moderation log - bans, kicks, warnings' },
      { name: 'bot-commands', type: ChannelType.GuildText, staffOnly: true, topic: 'Test bot commands here without spamming public channels' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helper: wait to avoid rate limits
// ---------------------------------------------------------------------------
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Main setup
// ---------------------------------------------------------------------------
client.once(Events.ClientReady, async () => {
  console.log(`[Setup] Connected as ${client.user.tag}`);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.error(`[Setup] Guild ${GUILD_ID} not found. Is the bot in the server?`);
    process.exit(1);
  }

  const idMap = { channels: {}, roles: {}, messages: {} };

  // -----------------------------------------------------------------------
  // 1. Create roles
  // -----------------------------------------------------------------------
  console.log('[Setup] Creating roles...');
  for (let i = 0; i < ROLE_DEFS.length; i++) {
    const def = ROLE_DEFS[i];
    // Check if role already exists
    let role = guild.roles.cache.find(r => r.name === def.name);
    if (!role) {
      const permBits = def.permissions.reduce((acc, p) => acc | p, 0n);
      role = await guild.roles.create({
        name: def.name,
        color: def.color,
        hoist: def.hoist,
        permissions: permBits,
        position: i + 1,
        reason: 'PULSE GAMING server setup',
      });
      console.log(`  Created role: ${role.name}`);
    } else {
      console.log(`  Role exists: ${role.name}`);
    }
    idMap.roles[def.name] = role.id;
    await wait(300);
  }

  // -----------------------------------------------------------------------
  // 2. Create categories and channels
  // -----------------------------------------------------------------------
  console.log('[Setup] Creating categories and channels...');
  for (const cat of CATEGORIES) {
    let category = guild.channels.cache.find(
      c => c.name === cat.name && c.type === ChannelType.GuildCategory
    );
    if (!category) {
      category = await guild.channels.create({
        name: cat.name,
        type: ChannelType.GuildCategory,
        reason: 'PULSE GAMING server setup',
      });
      console.log(`  Created category: ${cat.name}`);
    } else {
      console.log(`  Category exists: ${cat.name}`);
    }
    await wait(300);

    for (const ch of cat.channels) {
      let channel = guild.channels.cache.find(
        c => c.name === ch.name && c.parentId === category.id
      );

      const permOverwrites = [];

      if (ch.readOnly) {
        permOverwrites.push(
          {
            id: guild.id, // @everyone
            deny: [PermissionFlagsBits.SendMessages],
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          },
          {
            id: client.user.id, // bot
            allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
          },
        );
        // Allow mods/admins to post
        if (idMap.roles['Moderator']) {
          permOverwrites.push({
            id: idMap.roles['Moderator'],
            allow: [PermissionFlagsBits.SendMessages],
          });
        }
        if (idMap.roles['Admin']) {
          permOverwrites.push({
            id: idMap.roles['Admin'],
            allow: [PermissionFlagsBits.SendMessages],
          });
        }
      }

      if (ch.staffOnly) {
        permOverwrites.push(
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: client.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          },
        );
        if (idMap.roles['Moderator']) {
          permOverwrites.push({
            id: idMap.roles['Moderator'],
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          });
        }
        if (idMap.roles['Admin']) {
          permOverwrites.push({
            id: idMap.roles['Admin'],
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          });
        }
      }

      if (!channel) {
        channel = await guild.channels.create({
          name: ch.name,
          type: ch.type,
          parent: category.id,
          topic: ch.topic || undefined,
          permissionOverwrites: permOverwrites.length > 0 ? permOverwrites : undefined,
          reason: 'PULSE GAMING server setup',
        });
        console.log(`    Created channel: #${ch.name}`);
      } else {
        // Update topic on existing channels
        if (ch.topic && channel.topic !== ch.topic) {
          await channel.setTopic(ch.topic).catch(() => {});
        }
        console.log(`    Channel exists: #${ch.name}`);
        if (permOverwrites.length > 0) {
          await channel.permissionOverwrites.set(permOverwrites).catch(() => {});
        }
      }

      idMap.channels[ch.name] = channel.id;
      await wait(300);
    }
  }

  // -----------------------------------------------------------------------
  // 3. Pin messages
  // -----------------------------------------------------------------------
  console.log('[Setup] Posting pinned messages...');

  // --- #rules ---
  const rulesChannel = guild.channels.cache.get(idMap.channels['rules']);
  if (rulesChannel) {
    const rulesEmbed = new EmbedBuilder()
      .setColor(config.COLOURS.AMBER)
      .setTitle('📜 Server Rules - PULSE GAMING')
      .setDescription(
        'Welcome to the PULSE GAMING community. Follow these rules to keep the server running smoothly.\n\n' +

        '**1. Respect All Members**\n' +
        'No harassment, hate speech, discrimination or personal attacks. Treat everyone with respect.\n\n' +

        '**2. No Spoilers Without Tags**\n' +
        'Use Discord\'s spoiler tags `||like this||` for any unannounced game details or plot spoilers.\n\n' +

        '**3. No Self-Promotion**\n' +
        'Do not advertise your own channels, servers, products or services without permission from staff.\n\n' +

        '**4. Verify Before Sharing**\n' +
        'Do not present rumours as confirmed facts. Always label unverified information as such.\n\n' +

        '**5. English Only**\n' +
        'All messages must be in English so that our moderation team can review them.\n\n' +

        '**6. No NSFW Content**\n' +
        'Absolutely no NSFW images, links, or discussions anywhere on this server.\n\n' +

        '**7. Stay On Topic**\n' +
        'Use the correct channels for your messages. Gaming talk goes in #gaming-talk, memes in #memes, etc.\n\n' +

        '**8. No Spam**\n' +
        'No excessive messages, emojis, mentions, or bot command abuse.\n\n' +

        '**Warning System**\n' +
        '> ⚠️ 3 warnings = Mute (1 hour)\n' +
        '> ⚠️ 5 warnings = Kick\n' +
        '> ⚠️ 7 warnings = Permanent Ban\n\n' +

        '*Rules are enforced at moderator discretion. Decisions are final.*'
      )
      .setFooter({ text: 'PULSE GAMING - Verified leaks. Every day.' })
      .setTimestamp();

    const rulesMsg = await rulesChannel.send({ embeds: [rulesEmbed] });
    await rulesMsg.pin().catch(() => {});
    idMap.messages['rules'] = rulesMsg.id;
    console.log('  Posted rules.');
    await wait(500);
  }

  // --- #role-select ---
  const roleSelectChannel = guild.channels.cache.get(idMap.channels['role-select']);
  if (roleSelectChannel) {
    const roleEmbed = new EmbedBuilder()
      .setColor(config.COLOURS.AMBER)
      .setTitle('🎮 Select Your Platform')
      .setDescription(
        'React below to show which platform(s) you play on!\n\n' +
        '🎮 - **PlayStation**\n' +
        '🟢 - **Xbox**\n' +
        '🍄 - **Nintendo**\n' +
        '🖥️ - **PC Gamer**\n\n' +
        '*You can select multiple. Remove your reaction to remove the role.*'
      )
      .setFooter({ text: 'PULSE GAMING' });

    const roleMsg = await roleSelectChannel.send({ embeds: [roleEmbed] });
    for (const emoji of Object.keys(config.PLATFORM_EMOJIS)) {
      await roleMsg.react(emoji).catch(() => {});
      await wait(300);
    }
    await roleMsg.pin().catch(() => {});
    idMap.messages['role-select'] = roleMsg.id;
    console.log('  Posted role-select.');
    await wait(500);
  }

  // --- #giveaways ---
  const giveawaysChannel = guild.channels.cache.get(idMap.channels['giveaways']);
  if (giveawaysChannel) {
    const giveawayEmbed = new EmbedBuilder()
      .setColor(config.COLOURS.AMBER)
      .setTitle('🎉 Giveaways')
      .setDescription(
        'React with 🎉 to enter active giveaways!\n\n' +
        'Giveaways are posted here by the team. Winners are picked at random when the timer ends.\n\n' +
        'Stay active in the server to hear about giveaways first!'
      )
      .setFooter({ text: 'PULSE GAMING' });

    const giveawayMsg = await giveawaysChannel.send({ embeds: [giveawayEmbed] });
    await giveawayMsg.pin().catch(() => {});
    idMap.messages['giveaways'] = giveawayMsg.id;
    console.log('  Posted giveaways info.');
    await wait(500);
  }

  // --- #leaderboard ---
  const leaderboardChannel = guild.channels.cache.get(idMap.channels['leaderboard']);
  if (leaderboardChannel) {
    const lbEmbed = new EmbedBuilder()
      .setColor(config.COLOURS.AMBER)
      .setTitle('🏆 XP Leaderboard')
      .setDescription(
        'The top 10 most active members will appear here.\n\n' +
        '**How to earn XP:**\n' +
        '> 💬 Chat in any channel - 15-25 XP per message (60s cooldown)\n' +
        '> 📅 `/daily` - 100 XP base, up to 5x streak multiplier\n' +
        '> 🎮 `/trivia` - 50 XP for correct answers\n' +
        '> 🔮 `/predict` - Win 2x XP from prediction bets\n\n' +
        '**Level Roles:**\n' +
        '> Level 5 → Regular\n' +
        '> Level 10 → Insider\n' +
        '> Level 20 → Leaker\n' +
        '> Level 50 → OG\n\n' +
        '*Use `/leaderboard` or `/rank` to check standings at any time.*'
      )
      .setFooter({ text: 'PULSE GAMING' })
      .setTimestamp();

    const lbMsg = await leaderboardChannel.send({ embeds: [lbEmbed] });
    await lbMsg.pin().catch(() => {});
    idMap.messages['leaderboard'] = lbMsg.id;
    console.log('  Posted leaderboard info.');
    await wait(500);
  }

  // --- #daily-streak ---
  const dailyChannel = guild.channels.cache.get(idMap.channels['daily-streak']);
  if (dailyChannel) {
    const dailyEmbed = new EmbedBuilder()
      .setColor(config.COLOURS.AMBER)
      .setTitle('📅 Daily Streak')
      .setDescription(
        'Use `/daily` once per day to claim bonus XP!\n\n' +
        '**Streak Multipliers:**\n' +
        '> Day 1 - 100 XP (1x)\n' +
        '> Day 2 - 200 XP (2x)\n' +
        '> Day 3 - 300 XP (3x)\n' +
        '> Day 4 - 400 XP (4x)\n' +
        '> Day 5+ - 500 XP (5x MAX)\n\n' +
        '*Miss a day and your streak resets to 1x!*'
      )
      .setFooter({ text: 'PULSE GAMING' });

    const dailyMsg = await dailyChannel.send({ embeds: [dailyEmbed] });
    await dailyMsg.pin().catch(() => {});
    console.log('  Posted daily-streak info.');
    await wait(500);
  }

  // -----------------------------------------------------------------------
  // 4. Save ID map
  // -----------------------------------------------------------------------
  config.saveIdMap(idMap);
  console.log('\n[Setup] Complete! ID map saved to discord/data/id_map.json');
  console.log('[Setup] Channel IDs:', JSON.stringify(idMap.channels, null, 2));
  console.log('[Setup] Role IDs:', JSON.stringify(idMap.roles, null, 2));

  client.destroy();
  process.exit(0);
});

client.login(TOKEN);
