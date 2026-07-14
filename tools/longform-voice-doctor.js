"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const channel = require("../channels/pulse-gaming");
const {
  evaluateLongformVoiceAvailability,
  resolveLongformVoiceProfile,
} = require("../lib/longform-voice-profile");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "output", "longform-voice");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "longform_voice_status.json");

async function runLongformVoiceDoctor({
  env = process.env,
  request = axios,
  generatedAt = new Date().toISOString(),
} = {}) {
  const profile = resolveLongformVoiceProfile({ channel, env, kind: "longform" });
  if (!env.ELEVENLABS_API_KEY) {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      verdict: "RED",
      blocker: "elevenlabs_api_key_missing",
      profile: { ...profile, voiceSettings: { ...profile.voiceSettings } },
    };
  }

  const response = await request.get("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
    timeout: 20000,
  });
  const availability = evaluateLongformVoiceAvailability({
    profile,
    voices: response.data?.voices || [],
  });
  return {
    schema_version: 1,
    generated_at: generatedAt,
    ...availability,
    profile: {
      provider: profile.provider,
      voice_id: profile.voiceId,
      voice_name: profile.name,
      accent: profile.accent,
      model_id: profile.modelId,
      use_scope: profile.useScope,
      voice_settings: profile.voiceSettings,
    },
    safety: {
      read_only_account_check: true,
      live_publish_attempted: false,
      credential_mutation: false,
      scheduler_touched: false,
    },
  };
}

async function main() {
  const report = await runLongformVoiceDoctor();
  await fs.ensureDir(OUTPUT_DIR);
  await fs.writeJson(OUTPUT_PATH, report, { spaces: 2 });
  console.log(JSON.stringify({ ...report, output_path: OUTPUT_PATH }, null, 2));
  if (report.verdict === "RED") process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ verdict: "RED", error: error.message }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  OUTPUT_PATH,
  runLongformVoiceDoctor,
};
