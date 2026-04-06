/**
 * PULSE GAMING — Auto-post integration
 *
 * Called from the main pipeline's publisher.js after each upload.
 * Posts rich embeds to the correct Discord channel based on story classification.
 *
 * Usage:
 *   const { postNewStory, postVideoUpload } = require('./discord/auto_post');
 *   await postNewStory(story);
 *   await postVideoUpload(story);
 */

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const config = require('./config');

let _client = null;
let _ready = false;

/**
 * Get or create a Discord client instance.
 * Reuses the bot.js client if available, otherwise creates a lightweight one.
 */
function getClient() {
  // If bot.js is already running, reuse its client
  try {
    const bot = require('./bot');
    if (bot.client && bot.client.isReady()) return Promise.resolve(bot.client);
  } catch (e) { /* bot.js not loaded */ }

  // Create a lightweight client for posting only
  if (_client && _ready) return Promise.resolve(_client);

  if (_client) {
    return new Promise((resolve) => {
      _client.once('ready', () => {
        _ready = true;
        resolve(_client);
      });
    });
  }

  _client = new Client({ intents: [GatewayIntentBits.Guilds] });
  _ready = false;

  const promise = new Promise((resolve, reject) => {
    _client.once('ready', () => {
      _ready = true;
      console.log('[AutoPost] Discord client ready.');
      resolve(_client);
    });
    _client.once('error', reject);
  });

  const token = process.env.DISCORD_BOT_TOKEN || config.BOT_TOKEN;
  if (!token) {
    console.error('[AutoPost] No DISCORD_BOT_TOKEN set. Skipping Discord post.');
    return Promise.resolve(null);
  }

  _client.login(token).catch((err) => {
    console.error('[AutoPost] Failed to login:', err.message);
  });

  return promise;
}

/**
 * Determine the correct news channel based on story flair/classification.
 */
function getNewsChannel(story) {
  const flair = (story.flair || '').toLowerCase();
  const pillar = (story.content_pillar || '').toLowerCase();
  const breakingScore = story.breaking_score || 0;

  // High breaking score goes to #breaking-news
  if (breakingScore >= 80) return 'breaking-news';

  // Classification-based routing
  if (flair === 'verified' || flair === 'confirmed' || pillar.includes('confirmed')) {
    return 'confirmed';
  }
  if (flair === 'highly likely' || pillar.includes('source breakdown')) {
    return 'leaks';
  }
  if (flair === 'rumour' || flair === 'rumor' || pillar.includes('rumour')) {
    return 'rumours';
  }

  // Default to breaking-news for anything else
  return 'breaking-news';
}

/**
 * Map classification to embed colour.
 */
function classColour(flair) {
  const f = (flair || '').toLowerCase();
  if (f === 'verified' || f === 'confirmed') return config.COLOURS.GREEN;
  if (f === 'highly likely') return config.COLOURS.AMBER;
  if (f === 'rumour' || f === 'rumor') return config.COLOURS.RED;
  return config.COLOURS.GREY;
}

/**
 * Build the classification badge text.
 */
function badge(flair) {
  const f = (flair || '').toLowerCase();
  if (f === 'verified' || f === 'confirmed') return '✅ CONFIRMED';
  if (f === 'highly likely') return '🔶 HIGHLY LIKELY';
  if (f === 'rumour' || f === 'rumor') return '🔴 RUMOUR';
  return '📰 NEWS';
}

/**
 * Post a new story to the appropriate news channel.
 */
async function postNewStory(story) {
  try {
    const client = await getClient();
    if (!client) return null;

    const idMap = config.loadIdMap();
    const channelName = getNewsChannel(story);
    const channelId = idMap.channels && idMap.channels[channelName];

    if (!channelId) {
      console.error(`[AutoPost] Channel "${channelName}" not found in id_map.json. Run setup.js first.`);
      return null;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.error(`[AutoPost] Could not fetch channel ${channelId}.`);
      return null;
    }

    const embed = new EmbedBuilder()
      .setColor(classColour(story.flair))
      .setTitle(story.title || 'Untitled Story')
      .setURL(story.url || null)
      .setDescription(
        `${badge(story.flair)}\n\n` +
        (story.hook ? `**${story.hook}**\n\n` : '') +
        (story.body ? story.body.substring(0, 500) + (story.body.length > 500 ? '...' : '') : '')
      )
      .addFields(
        { name: 'Source', value: story.subreddit || story.source_type || 'Unknown', inline: true },
        { name: 'Pillar', value: story.content_pillar || 'News', inline: true },
      )
      .setFooter({ text: 'PULSE GAMING — Verified leaks. Every day.' })
      .setTimestamp(story.timestamp ? new Date(story.timestamp) : new Date());

    if (story.breaking_score) {
      embed.addFields({ name: 'Breaking Score', value: `${story.breaking_score}/100`, inline: true });
    }

    if (story.article_image) {
      embed.setThumbnail(story.article_image);
    }

    if (story.youtube_url) {
      embed.addFields({ name: '▶️ Watch', value: `[YouTube Short](${story.youtube_url})`, inline: false });
    }

    const msg = await channel.send({ embeds: [embed] });
    console.log(`[AutoPost] Posted story "${story.title}" to #${channelName}`);
    return msg;
  } catch (err) {
    console.error('[AutoPost] Failed to post story:', err.message);
    return null;
  }
}

/**
 * Post a new video upload notification to #video-drops.
 */
async function postVideoUpload(story) {
  try {
    const client = await getClient();
    if (!client) return null;

    const idMap = config.loadIdMap();
    const channelId = idMap.channels && idMap.channels['video-drops'];

    if (!channelId) {
      console.error('[AutoPost] Channel "video-drops" not found in id_map.json. Run setup.js first.');
      return null;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.error(`[AutoPost] Could not fetch video-drops channel.`);
      return null;
    }

    const embed = new EmbedBuilder()
      .setColor(config.COLOURS.AMBER)
      .setTitle(`🎬 New Video: ${story.title || 'Untitled'}`)
      .setURL(story.youtube_url || null)
      .setDescription(
        (story.hook ? `**${story.hook}**\n\n` : '') +
        (story.body ? story.body.substring(0, 300) : '') +
        '\n\n' +
        `${badge(story.flair)}`
      )
      .setFooter({ text: 'PULSE GAMING' })
      .setTimestamp();

    if (story.article_image) {
      embed.setImage(story.article_image);
    }

    // Add platform links
    const links = [];
    if (story.youtube_url) links.push(`[YouTube](${story.youtube_url})`);
    if (story.tiktok_post_id) links.push(`[TikTok](https://tiktok.com/@pulsegamingnews)`);
    if (story.instagram_media_id) links.push(`[Instagram](https://instagram.com/pulse.gmg)`);

    if (links.length > 0) {
      embed.addFields({ name: 'Watch On', value: links.join(' | '), inline: false });
    }

    const msg = await channel.send({
      content: '🔔 **NEW VIDEO JUST DROPPED!**',
      embeds: [embed],
    });

    console.log(`[AutoPost] Posted video upload for "${story.title}" to #video-drops`);
    return msg;
  } catch (err) {
    console.error('[AutoPost] Failed to post video upload:', err.message);
    return null;
  }
}

/**
 * Post a Story image to Discord for approval before publishing to Instagram.
 * Sends the image with Approve/Reject buttons to #video-drops.
 */
async function postStoryForApproval(story) {
  try {
    const client = await getClient();
    if (!client) return null;

    const fs = require('fs');
    const path = require('path');
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

    const idMap = config.loadIdMap();
    const channelId = idMap.channels && idMap.channels['video-drops'];

    if (!channelId) {
      console.error('[AutoPost] Channel "video-drops" not found in id_map.json.');
      return null;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.error('[AutoPost] Could not fetch video-drops channel.');
      return null;
    }

    // Load Story image
    const imagePath = story.story_image_path;
    if (!imagePath || !fs.existsSync(imagePath)) {
      console.log(`[AutoPost] No Story image for "${story.title}" — skipping approval post`);
      return null;
    }

    const filename = path.basename(imagePath);
    const attachment = new AttachmentBuilder(imagePath, { name: filename });

    const embed = new EmbedBuilder()
      .setColor(config.COLOURS.AMBER)
      .setTitle(`Instagram Story: ${story.title || 'Untitled'}`)
      .setDescription(
        `${badge(story.flair)}\n\n` +
        `**Approve or reject this Story image before it goes live.**\n\n` +
        (story.hook ? `> ${story.hook}` : '')
      )
      .setImage(`attachment://${filename}`)
      .addFields(
        { name: 'Source', value: story.subreddit || story.source_type || 'Unknown', inline: true },
        { name: 'Score', value: `${story.breaking_score || story.score || 0}`, inline: true },
      )
      .setFooter({ text: 'PULSE GAMING — Story Approval' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`story-approve_${story.id}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`story-reject_${story.id}`)
        .setLabel('Reject')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌'),
    );

    const msg = await channel.send({
      content: '📸 **STORY IMAGE — Awaiting Approval**',
      embeds: [embed],
      files: [attachment],
      components: [row],
    });

    console.log(`[AutoPost] Story approval posted for "${story.title}" to #video-drops`);
    return msg;
  } catch (err) {
    console.error('[AutoPost] Failed to post Story for approval:', err.message);
    return null;
  }
}

/**
 * Post a poll to #polls based on a story.
 * Generates a relevant question + 4 answer options from the story content.
 */
async function postStoryPoll(story) {
  try {
    const client = await getClient();
    if (!client) return null;

    const idMap = config.loadIdMap();
    const channelId = idMap.channels && idMap.channels['polls'];

    if (!channelId) {
      console.error('[AutoPost] Channel "polls" not found in id_map.json.');
      return null;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.error('[AutoPost] Could not fetch polls channel.');
      return null;
    }

    // Generate poll question and options from the story
    const { question, options } = generatePollFromStory(story);

    const { PollLayoutType } = require('discord.js');

    const msg = await channel.send({
      poll: {
        question: { text: question },
        answers: options.map(opt => ({ text: opt })),
        duration: 24,
        allowMultiselect: false,
        layoutType: PollLayoutType.Default,
      },
    });

    console.log(`[AutoPost] Poll posted for "${story.title}" to #polls`);
    return msg;
  } catch (err) {
    console.error('[AutoPost] Failed to post poll:', err.message);
    return null;
  }
}

/**
 * Generate a poll question + 4 options from a story.
 * Uses the story's flair, title and content to craft a relevant community question.
 */
function generatePollFromStory(story) {
  const title = story.title || 'this news';
  const flair = (story.flair || '').toLowerCase();

  // Rumour stories — "Do you believe it?"
  if (flair === 'rumour' || flair === 'rumor') {
    return {
      question: `${truncate(title, 280)} — Do you believe this rumour?`,
      options: [
        'Absolutely, it\'s happening',
        'Probably true, good sources',
        'Doubt it, seems fake',
        'No way, total rubbish',
      ],
    };
  }

  // Leak stories — "How hyped are you?"
  if (flair === 'highly likely') {
    return {
      question: `${truncate(title, 280)} — How hyped are you?`,
      options: [
        'Day one purchase',
        'Interested, need to see more',
        'Not for me but cool',
        'Couldn\'t care less',
      ],
    };
  }

  // Confirmed/verified — "Your take?"
  if (flair === 'verified' || flair === 'confirmed') {
    return {
      question: `${truncate(title, 280)} — Your reaction?`,
      options: [
        'Massive W, love this',
        'Good news, cautiously optimistic',
        'Meh, don\'t really care',
        'This is an L, disappointed',
      ],
    };
  }

  // Default — general opinion
  return {
    question: `${truncate(title, 280)} — What do you think?`,
    options: [
      'Excited about this',
      'Need more details first',
      'Not sure how to feel',
      'Not interested',
    ],
  };
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.substring(0, max - 3) + '...';
}

module.exports = { postNewStory, postVideoUpload, postStoryForApproval, postStoryPoll };
