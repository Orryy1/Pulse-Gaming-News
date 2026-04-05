const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const config = require('../config');

function loadPredictions() {
  try {
    if (fs.existsSync(config.PREDICTIONS_PATH)) return JSON.parse(fs.readFileSync(config.PREDICTIONS_PATH, 'utf8'));
  } catch (e) { /* ignore */ }
  return [];
}

function savePredictions(data) {
  fs.writeFileSync(config.PREDICTIONS_PATH, JSON.stringify(data, null, 2));
}

function nextId(predictions) {
  if (predictions.length === 0) return 1;
  return Math.max(...predictions.map(p => p.id)) + 1;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('predict')
    .setDescription('Prediction/betting system (XP only, no real money)')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a new prediction')
        .addStringOption(opt => opt.setName('question').setDescription('The prediction question').setRequired(true))
        .addStringOption(opt => opt.setName('option1').setDescription('First outcome').setRequired(true))
        .addStringOption(opt => opt.setName('option2').setDescription('Second outcome').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('bet')
        .setDescription('Bet XP on a prediction outcome')
        .addIntegerOption(opt => opt.setName('prediction_id').setDescription('Prediction ID').setRequired(true))
        .addIntegerOption(opt => opt.setName('option').setDescription('Option number (1 or 2)').setRequired(true).setMinValue(1).setMaxValue(2))
        .addIntegerOption(opt => opt.setName('xp_amount').setDescription('Amount of XP to bet').setRequired(true).setMinValue(10))
    )
    .addSubcommand(sub =>
      sub.setName('resolve')
        .setDescription('Resolve a prediction (admin only)')
        .addIntegerOption(opt => opt.setName('prediction_id').setDescription('Prediction ID').setRequired(true))
        .addIntegerOption(opt => opt.setName('winning_option').setDescription('Winning option (1 or 2)').setRequired(true).setMinValue(1).setMaxValue(2))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all active predictions')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const predictions = loadPredictions();

    if (sub === 'create') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: 'Only moderators can create predictions.', ephemeral: true });
      }

      const question = interaction.options.getString('question');
      const option1 = interaction.options.getString('option1');
      const option2 = interaction.options.getString('option2');

      const prediction = {
        id: nextId(predictions),
        question,
        options: [option1, option2],
        bets: [],        // { userId, option (0 or 1), amount }
        resolved: false,
        winningOption: null,
        createdBy: interaction.user.id,
        createdAt: Date.now(),
      };

      predictions.push(prediction);
      savePredictions(predictions);

      const embed = new EmbedBuilder()
        .setColor(config.COLOURS.AMBER)
        .setTitle(`🔮 Prediction #${prediction.id}`)
        .setDescription(`**${question}**\n\n**1.** ${option1}\n**2.** ${option2}\n\nUse \`/predict bet ${prediction.id} <option> <xp>\` to place your bet!`)
        .setFooter({ text: 'PULSE GAMING Predictions' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    if (sub === 'bet') {
      const predId = interaction.options.getInteger('prediction_id');
      const option = interaction.options.getInteger('option') - 1; // 0-indexed
      const amount = interaction.options.getInteger('xp_amount');

      const prediction = predictions.find(p => p.id === predId);
      if (!prediction) return interaction.reply({ content: 'Prediction not found.', ephemeral: true });
      if (prediction.resolved) return interaction.reply({ content: 'That prediction has already been resolved.', ephemeral: true });

      // Check if user already bet on this prediction
      const existing = prediction.bets.find(b => b.userId === interaction.user.id);
      if (existing) return interaction.reply({ content: 'You have already placed a bet on this prediction.', ephemeral: true });

      // Check XP balance
      const xpManager = interaction.client.xpManager;
      if (!xpManager) return interaction.reply({ content: 'XP system not available.', ephemeral: true });

      const userData = xpManager.getUser(interaction.user.id);
      if (userData.xp < amount) {
        return interaction.reply({ content: `You only have **${userData.xp} XP**. You cannot bet more than you have.`, ephemeral: true });
      }

      // Deduct XP
      xpManager.addXp(interaction.user.id, -amount);

      prediction.bets.push({ userId: interaction.user.id, option, amount });
      savePredictions(predictions);

      const embed = new EmbedBuilder()
        .setColor(config.COLOURS.AMBER)
        .setTitle('🔮 Bet Placed!')
        .setDescription(`You bet **${amount} XP** on **${prediction.options[option]}** for Prediction #${predId}.`)
        .setFooter({ text: `Your remaining XP: ${userData.xp - amount}` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'resolve') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: 'Only moderators can resolve predictions.', ephemeral: true });
      }

      const predId = interaction.options.getInteger('prediction_id');
      const winningOption = interaction.options.getInteger('winning_option') - 1;

      const prediction = predictions.find(p => p.id === predId);
      if (!prediction) return interaction.reply({ content: 'Prediction not found.', ephemeral: true });
      if (prediction.resolved) return interaction.reply({ content: 'Already resolved.', ephemeral: true });

      prediction.resolved = true;
      prediction.winningOption = winningOption;

      const xpManager = interaction.client.xpManager;
      const winners = prediction.bets.filter(b => b.option === winningOption);
      const losers = prediction.bets.filter(b => b.option !== winningOption);

      // Winners get 2x their bet back
      for (const bet of winners) {
        if (xpManager) xpManager.addXp(bet.userId, bet.amount * 2);
      }

      savePredictions(predictions);

      const totalPool = prediction.bets.reduce((s, b) => s + b.amount, 0);

      const embed = new EmbedBuilder()
        .setColor(config.COLOURS.GREEN)
        .setTitle(`🔮 Prediction #${predId} — Resolved!`)
        .setDescription(
          `**${prediction.question}**\n\n` +
          `✅ Winning answer: **${prediction.options[winningOption]}**\n\n` +
          `**${winners.length}** winner(s) share **${winners.reduce((s, b) => s + b.amount * 2, 0)} XP** (2x payout)\n` +
          `**${losers.length}** loser(s) lost **${losers.reduce((s, b) => s + b.amount, 0)} XP**\n\n` +
          `Total pool: ${totalPool} XP`
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    if (sub === 'list') {
      const active = predictions.filter(p => !p.resolved);

      if (active.length === 0) {
        return interaction.reply({ content: 'No active predictions right now.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor(config.COLOURS.AMBER)
        .setTitle('🔮 Active Predictions')
        .setDescription(
          active.map(p => {
            const pool = p.bets.reduce((s, b) => s + b.amount, 0);
            const counts = [
              p.bets.filter(b => b.option === 0).length,
              p.bets.filter(b => b.option === 1).length,
            ];
            return `**#${p.id}** — ${p.question}\n` +
              `  1. ${p.options[0]} (${counts[0]} bets)\n` +
              `  2. ${p.options[1]} (${counts[1]} bets)\n` +
              `  Pool: ${pool} XP`;
          }).join('\n\n')
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
};
