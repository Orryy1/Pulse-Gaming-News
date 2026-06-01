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
  assert.match(source, /LOCAL_TTS_ALLOW_CONSOLE/i);
  assert.match(source, /pythonw\.exe not found/i);
  assert.match(source, /pulse-gaming tts_server starting/i);
  assert.match(source, /ConvertTo-Json/i);
  assert.match(source, /started_at/i);
  assert.match(source, /127\.0\.0\.1:8765\/health/i);
  assert.match(source, /already running/i);
  assert.doesNotMatch(source, /^call\s+venv\\Scripts\\activate\.bat\s*$/im);
  assert.doesNotMatch(source, /^python\s+-m\s+uvicorn\s+server:app/im);
  assert.doesNotMatch(source, /if\s+not\s+exist\s+"%TTS_PYTHON%"\s+set\s+"TTS_PYTHON=.*python\.exe"/i);
});

test("tts_server start.bat hides every helper powershell probe", () => {
  const source = fs.readFileSync(startBat, "utf8");
  const powershellLines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^powershell(?:\.exe)?\b/i.test(line));

  assert.ok(powershellLines.length > 0, "expected powershell helper calls in start.bat");
  for (const line of powershellLines) {
    assert.match(line, /-WindowStyle\s+Hidden/i, line);
  }
});


test("tts_server start.bat self-relaunches through a hidden inner batch invocation", () => {
  const source = fs.readFileSync(startBat, "utf8");

  assert.match(source, /--pulse-hidden-inner/i);
  assert.match(source, /LOCAL_TTS_ALLOW_LAUNCHER_CONSOLE/i);
  assert.match(source, /TTS_START_SCRIPT/i);
  assert.match(source, /Start-Process[\s\S]*\$env:ComSpec/i);
  assert.match(source, /-WindowStyle\s+Hidden/i);
});
