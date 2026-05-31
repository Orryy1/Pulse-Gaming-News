const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const startBat = path.join(root, "tts_server", "start.bat");

test("tts_server start.bat uses a windowless idempotent launcher", () => {
  const source = fs.readFileSync(startBat, "utf8");

  assert.match(source, /pythonw\.exe/i);
  assert.match(source, /server_stdout\.log/i);
  assert.match(source, /server_stderr\.log/i);
  assert.match(source, /server_start\.lock/i);
  assert.match(source, /TTS_START_LOCK_TTL_MINUTES=30/i);
  assert.match(source, /pulse-gaming tts_server starting/i);
  assert.match(source, /ConvertTo-Json/i);
  assert.match(source, /started_at/i);
  assert.match(source, /127\.0\.0\.1:8765\/health/i);
  assert.match(source, /already running/i);
  assert.doesNotMatch(source, /^call\s+venv\\Scripts\\activate\.bat\s*$/im);
  assert.doesNotMatch(source, /^python\s+-m\s+uvicorn\s+server:app/im);
});
