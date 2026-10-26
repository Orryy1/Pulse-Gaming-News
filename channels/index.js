/*
  Multi-Channel Registry

  Usage:
    const { getChannel, listChannels } = require('./channels');
    const ch = getChannel('stacked');
    console.log(ch.name, ch.colours.PRIMARY);

  Each channel config provides: brand colours, voice settings, content sources,
  classification system, system prompt and YouTube metadata.
*/

const path = require("path");
const fs = require("fs");

const CHANNEL_DIR = __dirname;

// Auto-discover channel configs (any .js file except index.js)
const channels = {};
for (const file of fs.readdirSync(CHANNEL_DIR)) {
  if (file === "index.js" || !file.endsWith(".js")) continue;
  const id = file.replace(".js", "");
  channels[id] = require(path.join(CHANNEL_DIR, file));
}

function getChannel(id) {
  if (!id) id = process.env.CHANNEL || "pulse-gaming";
  const ch = channels[id];
  if (!ch)
    throw new Error(
      `Unknown channel: ${id}. Available: ${Object.keys(channels).join(", ")}`,
    );
  return ch;
}

// YouTube's "altered or synthetic content" declaration (status.containsSyntheticMedia).
// Every channel config must set `containsSyntheticMedia` explicitly to true or
// false; there is no default, so a channel that forgets it cannot upload with a
// silent "no". Mirrors the Sleepy Stories uploader, which refuses the same way.
function youtubeSyntheticMediaDeclaration(channel) {
  const ch = channel || getChannel();
  if (typeof ch.containsSyntheticMedia !== "boolean") {
    throw new Error(
      `Channel ${ch.id || "(unknown)"} must set containsSyntheticMedia to true or false before uploading to YouTube.`,
    );
  }
  return ch.containsSyntheticMedia;
}

function listChannels() {
  return Object.values(channels).map((ch) => ({
    id: ch.id,
    name: ch.name,
    niche: ch.niche,
    tagline: ch.tagline,
  }));
}

// Backwards-compatible: export brand-like interface for the active channel
function getActiveBrand() {
  const ch = getChannel();
  return {
    ...ch.colours,
    classificationColour: ch.classificationColour.bind(ch),
    CHANNEL_NAME: ch.name,
    TAGLINE: ch.tagline,
    CTA: ch.cta,
    FONT: "Space Grotesk",
    FONT_FALLBACK: "Inter",
    voiceId: ch.voiceId,
    voiceModel: ch.voiceModel,
    voiceSettings: ch.voiceSettings,
  };
}

module.exports = {
  getChannel,
  listChannels,
  getActiveBrand,
  youtubeSyntheticMediaDeclaration,
  channels,
};
