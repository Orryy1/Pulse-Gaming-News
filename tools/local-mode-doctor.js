#!/usr/bin/env node
"use strict";

/**
 * tools/local-mode-doctor.js
 *
 * Pre-cutover diagnostic: verifies that THIS machine is correctly
 * configured to run Pulse Gaming as a local primary instance before
 * the operator stops the Railway service.
 *
 * Read-only. Never mutates env vars, never triggers OAuth, never
 * posts to platforms. Just reports what's wired and what isn't.
 *
 * Usage:
 *   node tools/local-mode-doctor.js
 *   node tools/local-mode-doctor.js --json
 */

const fs = require("fs-extra");
const path = require("node:path");
const { execSync } = require("node:child_process");

// 2026-04-30: when the doctor runs inside Claude Code's sandbox,
// the wrapper injects ANTHROPIC_API_KEY="" and ANTHROPIC_BASE_URL=...
// into every subprocess as a security guardrail (prevents the
// subprocess from reading the operator's Claude Code session token).
// dotenv's default no-override behaviour then preserves the empty
// value, producing a false-negative on this var even when .env is
// correctly configured. To report truthfully, the doctor reads
// .env DIRECTLY via dotenv.parse() and reports on what's IN .env,
// not on what's currently set in process.env. This matches the
// production runtime where the user starts node from a regular
// shell with no wrapper injection.
let dotenvParsed = {};
try {
  const dotenv = require("dotenv");
  const envPath = path.resolve(__dirname, "..", ".env");
  if (fs.pathExistsSync(envPath)) {
    dotenvParsed = dotenv.parse(fs.readFileSync(envPath));
  }
} catch {
  /* dotenv missing — fall back to process.env-only checks */
}

function checkEnvVarPresent(name) {
  // Prefer dotenv-parsed value (truth from .env) over process.env
  // when the latter is empty. This handles Claude Code's wrapper
  // injection AND legitimate cases where .env has the key but the
  // shell does not.
  const fromEnv = process.env[name];
  const fromDotenv = dotenvParsed[name];
  const present = !!fromEnv || !!fromDotenv;
  // Length reported from whichever source has the value.
  let length = 0;
  let source = "neither";
  if (fromEnv) {
    length = fromEnv.length;
    source = "process.env";
  } else if (fromDotenv) {
    length = fromDotenv.length;
    source = ".env";
  }
  return { name, present, length, source };
}

function buildEffectiveEnv(parsed = dotenvParsed, base = process.env) {
  // This doctor is specifically about the local `.env` runtime shape.
  // Prefer parsed `.env` values over the shell wrapper so mode/primary
  // checks match what `node server.js` will read after dotenv loads.
  return { ...base, ...parsed };
}

function tryExec(cmd) {
  try {
    const out = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: out.trim().split("\n")[0] };
  } catch (err) {
    return { ok: false, error: (err.message || "").slice(0, 120) };
  }
}

async function checkPathWritable(p) {
  try {
    await fs.ensureDir(p);
    const probe = path.join(p, ".pulse-doctor-probe");
    await fs.writeFile(probe, "ok");
    await fs.remove(probe);
    return { path: p, writable: true };
  } catch (err) {
    return { path: p, writable: false, error: err.message };
  }
}

async function buildReport() {
  const dm = require("../lib/deployment-mode");
  const { describeLlmState } = require("../lib/llm-key");
  const effectiveEnv = buildEffectiveEnv();
  const mode = dm.summary(effectiveEnv);
  const llmState = describeLlmState(effectiveEnv);

  // Binary checks
  const ffmpeg = tryExec("ffmpeg -version");
  const ffprobe = tryExec("ffprobe -version");
  const ytdlp = tryExec("yt-dlp --version");
  const node = tryExec("node --version");
  const npm = tryExec("npm --version");

  // Cloudflare Tunnel detection (cloudflared binary)
  const cloudflared = tryExec("cloudflared --version");

  // Env vars expected for local production
  const envPresence = {
    // Required for Pulse to generate scripts locally
    LLM_PROVIDER: checkEnvVarPresent("LLM_PROVIDER"),
    LOCAL_LLM_BASE_URL: checkEnvVarPresent("LOCAL_LLM_BASE_URL"),
    LOCAL_LLM_MODEL: checkEnvVarPresent("LOCAL_LLM_MODEL"),
    LOCAL_LLM_STRONG_MODEL: checkEnvVarPresent("LOCAL_LLM_STRONG_MODEL"),
    ANTHROPIC_API_KEY: checkEnvVarPresent("ANTHROPIC_API_KEY"),
    ELEVENLABS_API_KEY: checkEnvVarPresent("ELEVENLABS_API_KEY"),
    DISCORD_WEBHOOK_URL: checkEnvVarPresent("DISCORD_WEBHOOK_URL"),
    AMAZON_AFFILIATE_TAG: checkEnvVarPresent("AMAZON_AFFILIATE_TAG"),

    // Public URL — needed for OAuth callbacks + IG/FB media fetch
    PULSE_PUBLIC_URL: checkEnvVarPresent("PULSE_PUBLIC_URL"),
    LOCAL_PUBLIC_URL: checkEnvVarPresent("LOCAL_PUBLIC_URL"),
    RAILWAY_PUBLIC_URL: checkEnvVarPresent("RAILWAY_PUBLIC_URL"),

    // Persistence
    MEDIA_ROOT: checkEnvVarPresent("MEDIA_ROOT"),
    SQLITE_DB_PATH: checkEnvVarPresent("SQLITE_DB_PATH"),
    USE_SQLITE: checkEnvVarPresent("USE_SQLITE"),

    // Platform tokens (for upload_*)
    YOUTUBE_API_KEY: checkEnvVarPresent("YOUTUBE_API_KEY"),
    INSTAGRAM_ACCESS_TOKEN: checkEnvVarPresent("INSTAGRAM_ACCESS_TOKEN"),
    INSTAGRAM_BUSINESS_ACCOUNT_ID: checkEnvVarPresent(
      "INSTAGRAM_BUSINESS_ACCOUNT_ID",
    ),
    FACEBOOK_PAGE_TOKEN: checkEnvVarPresent("FACEBOOK_PAGE_TOKEN"),
    FACEBOOK_PAGE_ID: checkEnvVarPresent("FACEBOOK_PAGE_ID"),
    TIKTOK_CLIENT_KEY: checkEnvVarPresent("TIKTOK_CLIENT_KEY"),

    // Optional but useful
    TWITCH_CLIENT_ID: checkEnvVarPresent("TWITCH_CLIENT_ID"),
    TWITCH_CLIENT_SECRET: checkEnvVarPresent("TWITCH_CLIENT_SECRET"),
    PEXELS_API_KEY: checkEnvVarPresent("PEXELS_API_KEY"),

    // Deployment switches
    DEPLOYMENT_MODE: checkEnvVarPresent("DEPLOYMENT_MODE"),
    PULSE_PRIMARY_INSTANCE: checkEnvVarPresent("PULSE_PRIMARY_INSTANCE"),
    AUTO_PUBLISH: checkEnvVarPresent("AUTO_PUBLISH"),
    API_TOKEN: checkEnvVarPresent("API_TOKEN"),
  };

  // File path writability
  const configuredMediaRoot = dm.getMediaRoot(effectiveEnv);
  const configuredDbPath = dm.getSqliteDbPath(effectiveEnv);
  const targetMediaRoot =
    configuredMediaRoot || path.resolve(__dirname, "..", "data", "media-local");
  const targetDbDir = configuredDbPath
    ? path.dirname(configuredDbPath)
    : path.resolve(__dirname, "..", "data");
  const fsChecks = {
    media_root: await checkPathWritable(targetMediaRoot),
    db_dir: await checkPathWritable(targetDbDir),
  };

  // Verdict ladder
  const verdict = {
    overall: "green",
    blockers: [],
    advisory: [],
  };

  if (!ffmpeg.ok) verdict.blockers.push("ffmpeg binary not found on PATH");
  if (!ffprobe.ok) verdict.blockers.push("ffprobe binary not found on PATH");
  if (!node.ok) verdict.blockers.push("node binary not found");
  if (!llmState.ok) {
    verdict.blockers.push(`LLM provider not configured: ${llmState.reason}`);
  }
  if (!envPresence.ELEVENLABS_API_KEY.present)
    verdict.blockers.push("ELEVENLABS_API_KEY not set");
  if (!fsChecks.media_root.writable)
    verdict.blockers.push(
      `MEDIA_ROOT not writable: ${fsChecks.media_root.path}`,
    );
  if (!fsChecks.db_dir.writable)
    verdict.blockers.push(`DB dir not writable: ${fsChecks.db_dir.path}`);

  // Public URL: when DEPLOYMENT_MODE=local AND no PULSE_PUBLIC_URL /
  // LOCAL_PUBLIC_URL set, Cloudflare Tunnel hasn't been configured.
  if (mode.mode === "local") {
    const hasPublicUrl =
      envPresence.PULSE_PUBLIC_URL.present ||
      envPresence.LOCAL_PUBLIC_URL.present;
    if (!hasPublicUrl) {
      verdict.blockers.push(
        "DEPLOYMENT_MODE=local but no PULSE_PUBLIC_URL or LOCAL_PUBLIC_URL set — IG/FB/OAuth will fail",
      );
    }
    if (!cloudflared.ok) {
      verdict.advisory.push(
        "cloudflared binary not found — install Cloudflare Tunnel for stable public URL",
      );
    }
  }

  // Token advisories
  if (!envPresence.YOUTUBE_API_KEY.present) {
    verdict.advisory.push(
      "YOUTUBE_API_KEY not set — stats endpoint won't work",
    );
  }
  if (!envPresence.INSTAGRAM_ACCESS_TOKEN.present) {
    verdict.advisory.push(
      "INSTAGRAM_ACCESS_TOKEN not set — IG Reel uploads will fail",
    );
  }
  if (!envPresence.AUTO_PUBLISH.present) {
    verdict.advisory.push(
      "AUTO_PUBLISH not set — multi-platform uploads disabled (set =true to enable)",
    );
  }

  if (!ytdlp.ok) {
    verdict.advisory.push(
      "yt-dlp not on PATH — YouTube b-roll fallback (BROLL_YOUTUBE_FALLBACK) won't work",
    );
  }

  if (verdict.blockers.length > 0) verdict.overall = "red";
  else if (verdict.advisory.length > 0) verdict.overall = "amber";

  return {
    deployment_mode: mode,
    binaries: {
      node: node.ok ? node.output : null,
      npm: npm.ok ? npm.output : null,
      ffmpeg: ffmpeg.ok ? ffmpeg.output : null,
      ffprobe: ffprobe.ok ? ffprobe.output : null,
      yt_dlp: ytdlp.ok ? ytdlp.output : null,
      cloudflared: cloudflared.ok ? cloudflared.output : null,
    },
    env_presence: envPresence,
    fs_checks: fsChecks,
    verdict,
    generated_at: new Date().toISOString(),
  };
}

function formatMarkdown(report) {
  const glyph = { red: "🔴", amber: "🟡", green: "🟢" };
  const lines = [];
  lines.push(
    `${glyph[report.verdict.overall] || "⚪"} **Pulse Gaming — Local Mode Doctor**`,
  );
  lines.push("");
  lines.push("**Deployment**");
  for (const [k, v] of Object.entries(report.deployment_mode)) {
    lines.push(`  • ${k}: ${v}`);
  }

  lines.push("");
  lines.push("**Binaries**");
  for (const [k, v] of Object.entries(report.binaries)) {
    const ok = v != null;
    lines.push(`  ${ok ? "✓" : "✗"} ${k}: ${ok ? v : "(not found)"}`);
  }

  lines.push("");
  lines.push("**Env presence**");
  for (const [k, v] of Object.entries(report.env_presence)) {
    lines.push(
      `  ${v.present ? "✓" : "✗"} ${k} ${v.present ? `(len ${v.length})` : ""}`,
    );
  }

  lines.push("");
  lines.push("**Filesystem**");
  for (const [k, v] of Object.entries(report.fs_checks)) {
    lines.push(
      `  ${v.writable ? "✓" : "✗"} ${k}: ${v.path}${v.error ? ` — ${v.error}` : ""}`,
    );
  }

  if (report.verdict.blockers.length > 0) {
    lines.push("");
    lines.push("**Blockers (RED)**");
    for (const b of report.verdict.blockers) lines.push(`  • ${b}`);
  }
  if (report.verdict.advisory.length > 0) {
    lines.push("");
    lines.push("**Advisory (AMBER)**");
    for (const a of report.verdict.advisory) lines.push(`  • ${a}`);
  }

  lines.push("");
  if (
    report.verdict.overall === "green" &&
    report.deployment_mode &&
    report.deployment_mode.primary === false
  ) {
    lines.push(
      "OK Local mirror prerequisites met. Safe to start observation-only; scheduler/posting stay disabled while `primary=false`.",
    );
    return lines.join("\n");
  }
  if (report.verdict.overall === "green") {
    lines.push(
      "✅ Local-mode prerequisites met. Safe to start `node server.js` here.",
    );
  } else if (report.verdict.overall === "amber") {
    lines.push(
      "🟡 Local mode will run but some optional features missing. See advisory above.",
    );
  } else {
    lines.push(
      "🔴 Local mode NOT ready. Resolve blockers above before stopping Railway.",
    );
  }

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  try {
    const report = await buildReport();
    if (json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      process.stdout.write(formatMarkdown(report) + "\n");
    }
    if (report.verdict.overall === "red") process.exit(2);
  } catch (err) {
    process.stderr.write(`[local-mode-doctor] ${err.stack || err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildEffectiveEnv,
  buildReport,
  formatMarkdown,
};
