const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config({ override: true });

async function sendDiscord(message) {
  try {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url || url === 'placeholder') return;

    await axios.post(url, {
      content: message.substring(0, 2000),
    });
  } catch (err) {
    // Silently fail — Discord notifications are non-critical
  }
}

module.exports = sendDiscord;
