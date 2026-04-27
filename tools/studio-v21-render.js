"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const storyId = process.argv[2] || "1sn9xhe";

const result = spawnSync(
  process.execPath,
  [path.join(ROOT, "tools", "studio-v2-render.js"), storyId],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      STUDIO_V21_HERO: "true",
      STUDIO_V2_OUTPUT_SUFFIX: "_v21",
      STUDIO_V2_AUTHORED: "false",
      STUDIO_V2_SKIP_LLM: process.env.STUDIO_V2_SKIP_LLM || "true",
      STUDIO_V2_VOICE: process.env.STUDIO_V2_VOICE || "production",
      STUDIO_V2_ALLOW_VOICE_FALLBACK:
        process.env.STUDIO_V2_ALLOW_VOICE_FALLBACK || "true",
    },
  },
);

if (result.status !== 0) {
  process.exit(result.status || 1);
}
