const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Path to the main pipeline's daily_news.json
const NEWS_PATH = path.join(__dirname, '..', '..', 'daily_news.json');

function loadNews() {
  try {
    if (fs.existsSync(NEWS_PATH)) return JSON.parse(fs.readFileSync(NEWS_PATH, 'utf8'));
  } catch (e) { /* ignore */ }
  return [];
}

function classificationColour(flair) {
  if (!flair) return config.COLOURS.GREY;
  const f = flair.toLowerCase();
  if (f === 'verified' || f === 'confirmed') return config.COLOURS.GREEN;
  if (f === 'highly likely') return config.COLOURS.AMBER;
  if (f === 'rumour' || f === 'rumor') return config.COLOURS.RED;
  return config.COLOURS.GREY;
}

function storyEmbed(story) {
  const embed = new EmbedBuilder()
    .setColor(classificationColour(story.flair))
    .setTitle(story.title || 'Untitled Story')
    .setURL(story.url || null)
    .setDescription(
      (story.hook ? `**${story.hook}**\n\n` : '') +
      (story.body ? story.body.substring(0, 300) + (story.body.length > 300 ? '...' : '') : 'No details available.')
    )
    .addFields(
      { name: 'Classification', value: story.flair || 'Unknown', inline: true },
      { name: 'Source', value: story.subreddit || story.source_type || 'Unknown', inline: true },
    )
    .setFooter({ text: 'PULSE GAMING' })
    .setTimestamp(story.timestamp ? new Date(story.timestamp) : new Date());

  if (story.youtube_url) {
    embed.addFields({ name: 'Watch', value: `[YouTube Short](${story.youtube_url})`, inline: true });
  }

  if (story.article_image) {
    embed.setThumbnail(story.article_image);
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('news')
    .setDescription('Browse the latest gaming news')
    .addSubcommand(sub =>
      sub.setName('latest')
        .setDescription('Show the latest 5 stories')
    )
    .addSubcommand(sub =>
      sub.setName('search')
        .setDescription('Search stories by keyword')
        .addStringOption(opt => opt.setName('query').setDescription('Search keyword').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const news = loadNews();

    if (news.length === 0) {
      return interaction.reply({ content: 'No news stories available right now.', ephemeral: true });
    }

    if (sub === 'latest') {
      const latest = news.slice(-5).reverse();

      const embeds = latest.map(s => storyEmbed(s));

      await interaction.reply({
        content: `📰 **Latest ${latest.length} stories from PULSE GAMING**`,
        embeds,
      });
    }

    if (sub === 'search') {
      const query = interaction.options.getString('query').toLowerCase();
      const results = news.filter(s =>
        (s.title && s.title.toLowerCase().includes(query)) ||
        (s.body && s.body.toLowerCase().includes(query)) ||
        (s.hook && s.hook.toLowerCase().includes(query))
      ).slice(-5).reverse();

      if (results.length === 0) {
        return interaction.reply({ content: `No stories found matching "${query}".`, ephemeral: true });
      }

      const embeds = results.map(s => storyEmbed(s));

      await interaction.reply({
        content: `🔍 **${results.length} result(s) for "${query}"**`,
        embeds,
      });
    }
  },
};
