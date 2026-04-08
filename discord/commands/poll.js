const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a poll')
    .addStringOption(opt => opt.setName('question').setDescription('The poll question').setRequired(true))
    .addStringOption(opt => opt.setName('option1').setDescription('Option 1').setRequired(true))
    .addStringOption(opt => opt.setName('option2').setDescription('Option 2').setRequired(true))
    .addIntegerOption(opt => opt.setName('duration').setDescription('Duration in minutes (default 60)').setRequired(false).setMinValue(1).setMaxValue(1440))
    .addStringOption(opt => opt.setName('option3').setDescription('Option 3').setRequired(false))
    .addStringOption(opt => opt.setName('option4').setDescription('Option 4').setRequired(false))
    .addStringOption(opt => opt.setName('option5').setDescription('Option 5').setRequired(false))
    .addStringOption(opt => opt.setName('option6').setDescription('Option 6').setRequired(false))
    .addStringOption(opt => opt.setName('option7').setDescription('Option 7').setRequired(false))
    .addStringOption(opt => opt.setName('option8').setDescription('Option 8').setRequired(false))
    .addStringOption(opt => opt.setName('option9').setDescription('Option 9').setRequired(false))
    .addStringOption(opt => opt.setName('option10').setDescription('Option 10').setRequired(false)),

  async execute(interaction) {
    const question = interaction.options.getString('question');
    const durationMin = interaction.options.getInteger('duration') || 60;

    const options = [];
    for (let i = 1; i <= 10; i++) {
      const val = interaction.options.getString(`option${i}`);
      if (val) options.push(val);
    }

    if (options.length < 2) {
      return interaction.reply({ content: 'You need at least 2 options.', ephemeral: true });
    }

    const endsAt = Date.now() + durationMin * 60_000;

    const description = options.map((opt, i) => `${NUMBER_EMOJIS[i]}  ${opt}`).join('\n\n');

    const embed = new EmbedBuilder()
      .setColor(config.COLOURS.AMBER)
      .setTitle(`📊 ${question}`)
      .setDescription(description)
      .setFooter({ text: `Poll ends at` })
      .setTimestamp(new Date(endsAt));

    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });

    for (let i = 0; i < options.length; i++) {
      await msg.react(NUMBER_EMOJIS[i]);
    }

    // Schedule results
    const timeout = Math.min(durationMin * 60_000, 86_400_000);
    setTimeout(async () => {
      try {
        const fetched = await interaction.channel.messages.fetch(msg.id);
        const results = [];

        for (let i = 0; i < options.length; i++) {
          const reaction = fetched.reactions.cache.get(NUMBER_EMOJIS[i]);
          const count = reaction ? reaction.count - 1 : 0; // minus bot's reaction
          results.push({ option: options[i], emoji: NUMBER_EMOJIS[i], votes: count });
        }

        const totalVotes = results.reduce((s, r) => s + r.votes, 0);
        results.sort((a, b) => b.votes - a.votes);

        const barLength = 16;
        const resultText = results.map(r => {
          const pct = totalVotes > 0 ? (r.votes / totalVotes * 100) : 0;
          const filled = Math.round(pct / 100 * barLength);
          const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
          return `${r.emoji} ${r.option}\n${bar}  ${r.votes} vote(s) - ${pct.toFixed(1)}%`;
        }).join('\n\n');

        const resultEmbed = new EmbedBuilder()
          .setColor(config.COLOURS.GREEN)
          .setTitle(`📊 Poll Results: ${question}`)
          .setDescription(resultText)
          .setFooter({ text: `${totalVotes} total votes` })
          .setTimestamp();

        await fetched.edit({ embeds: [resultEmbed] });
        await interaction.channel.send({ content: `📊 **Poll ended!** Results for: **${question}**`, embeds: [resultEmbed] });
      } catch (err) {
        console.error('[Poll] Failed to collect results:', err.message);
      }
    }, timeout);
  },
};
