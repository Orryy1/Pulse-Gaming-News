const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const config = require('../config');

function loadGiveaways() {
  try {
    if (fs.existsSync(config.GIVEAWAYS_PATH)) return JSON.parse(fs.readFileSync(config.GIVEAWAYS_PATH, 'utf8'));
  } catch (e) { /* ignore */ }
  return [];
}

function saveGiveaways(data) {
  fs.writeFileSync(config.GIVEAWAYS_PATH, JSON.stringify(data, null, 2));
}

function scheduleGiveawayEnd(client, giveaway) {
  const remaining = giveaway.endsAt - Date.now();
  if (remaining <= 0) {
    endGiveaway(client, giveaway);
    return;
  }
  // Cap setTimeout at 24 hours, re-check after that
  const delay = Math.min(remaining, 86_400_000);
  setTimeout(() => {
    if (delay < remaining) {
      scheduleGiveawayEnd(client, giveaway);
    } else {
      endGiveaway(client, giveaway);
    }
  }, delay);
}

async function endGiveaway(client, giveaway) {
  const giveaways = loadGiveaways();
  const idx = giveaways.findIndex(g => g.messageId === giveaway.messageId);
  if (idx === -1 || giveaways[idx].ended) return;

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(giveaway.messageId);
    const reaction = message.reactions.cache.get('🎉');

    let users = [];
    if (reaction) {
      const fetched = await reaction.users.fetch();
      users = fetched.filter(u => !u.bot).map(u => u.id);
    }

    const winnerCount = Math.min(giveaway.winnerCount, users.length);
    const winners = [];
    const pool = [...users];
    for (let i = 0; i < winnerCount; i++) {
      const pick = Math.floor(Math.random() * pool.length);
      winners.push(pool.splice(pick, 1)[0]);
    }

    giveaways[idx].ended = true;
    giveaways[idx].winners = winners;
    saveGiveaways(giveaways);

    const embed = new EmbedBuilder()
      .setColor(config.COLOURS.GREEN)
      .setTitle('🎉 Giveaway Ended!')
      .setDescription(`**Prize:** ${giveaway.prize}\n\n${winners.length > 0 ? `**Winner(s):** ${winners.map(id => `<@${id}>`).join(', ')}` : 'No valid entries - no winners.'}`)
      .setFooter({ text: `${users.length} total entries` })
      .setTimestamp();

    await message.edit({ embeds: [embed] });

    if (winners.length > 0) {
      await channel.send(`🎉 Congratulations ${winners.map(id => `<@${id}>`).join(', ')}! You won **${giveaway.prize}**!`);
    }
  } catch (err) {
    console.error('[Giveaway] Failed to end giveaway:', err.message);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Start a new giveaway')
        .addStringOption(opt => opt.setName('prize').setDescription('What is the prize?').setRequired(true))
        .addIntegerOption(opt => opt.setName('duration').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(10080))
        .addIntegerOption(opt => opt.setName('winners').setDescription('Number of winners').setRequired(false).setMinValue(1).setMaxValue(20))
    )
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End a giveaway early')
        .addStringOption(opt => opt.setName('message_id').setDescription('Message ID of the giveaway').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('reroll')
        .setDescription('Re-pick winners for an ended giveaway')
        .addStringOption(opt => opt.setName('message_id').setDescription('Message ID of the giveaway').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      const prize = interaction.options.getString('prize');
      const durationMin = interaction.options.getInteger('duration');
      const winnerCount = interaction.options.getInteger('winners') || 1;
      const endsAt = Date.now() + durationMin * 60_000;

      const embed = new EmbedBuilder()
        .setColor(config.COLOURS.AMBER)
        .setTitle('🎉 GIVEAWAY')
        .setDescription(`**${prize}**\n\nReact with 🎉 to enter!\n\n**Winners:** ${winnerCount}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>`)
        .setFooter({ text: 'PULSE GAMING Giveaway' })
        .setTimestamp(new Date(endsAt));

      const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
      await msg.react('🎉');

      const giveaway = {
        messageId: msg.id,
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        prize,
        winnerCount,
        endsAt,
        ended: false,
        winners: [],
        hostId: interaction.user.id,
      };

      const giveaways = loadGiveaways();
      giveaways.push(giveaway);
      saveGiveaways(giveaways);

      scheduleGiveawayEnd(interaction.client, giveaway);
    }

    if (sub === 'end') {
      const messageId = interaction.options.getString('message_id');
      const giveaways = loadGiveaways();
      const giveaway = giveaways.find(g => g.messageId === messageId);

      if (!giveaway) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
      if (giveaway.ended) return interaction.reply({ content: 'That giveaway has already ended.', ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      await endGiveaway(interaction.client, giveaway);
      await interaction.editReply({ content: 'Giveaway ended!' });
    }

    if (sub === 'reroll') {
      const messageId = interaction.options.getString('message_id');
      const giveaways = loadGiveaways();
      const giveaway = giveaways.find(g => g.messageId === messageId);

      if (!giveaway) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
      if (!giveaway.ended) return interaction.reply({ content: 'That giveaway has not ended yet.', ephemeral: true });

      await interaction.deferReply();

      try {
        const channel = await interaction.client.channels.fetch(giveaway.channelId);
        const message = await channel.messages.fetch(giveaway.messageId);
        const reaction = message.reactions.cache.get('🎉');

        let users = [];
        if (reaction) {
          const fetched = await reaction.users.fetch();
          users = fetched.filter(u => !u.bot).map(u => u.id);
        }

        const winnerCount = Math.min(giveaway.winnerCount, users.length);
        const winners = [];
        const pool = [...users];
        for (let i = 0; i < winnerCount; i++) {
          const pick = Math.floor(Math.random() * pool.length);
          winners.push(pool.splice(pick, 1)[0]);
        }

        const idx = giveaways.findIndex(g => g.messageId === messageId);
        giveaways[idx].winners = winners;
        saveGiveaways(giveaways);

        if (winners.length > 0) {
          await interaction.editReply(`🎉 New winner(s): ${winners.map(id => `<@${id}>`).join(', ')}! Congratulations - you won **${giveaway.prize}**!`);
        } else {
          await interaction.editReply('No valid entries to reroll from.');
        }
      } catch (err) {
        await interaction.editReply('Failed to reroll - could not fetch the original message.');
      }
    }
  },

  // Called on bot startup to reschedule active giveaways
  rescheduleAll(client) {
    const giveaways = loadGiveaways().filter(g => !g.ended);
    for (const g of giveaways) {
      scheduleGiveawayEnd(client, g);
    }
    if (giveaways.length > 0) console.log(`[Giveaway] Rescheduled ${giveaways.length} active giveaway(s).`);
  },
};
