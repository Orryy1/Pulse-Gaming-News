const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scriptPath = path.resolve(__dirname, "..", "..", "tools", "local-live-cloudflared-tunnel.ps1");

test("local live tunnel launcher starts cloudflared as a durable hidden process", () => {
  const script = fs.readFileSync(scriptPath, "utf8");

  assert.match(script, /Start-Process\s+-FilePath\s+\$cloudflared/);
  assert.match(script, /-WindowStyle\s+Hidden/);
  assert.match(script, /-RedirectStandardOutput\s+\$logPath/);
  assert.match(script, /-RedirectStandardError\s+\$errPath/);
  assert.match(script, /cloudflared exited immediately/);
  assert.match(script, /\[switch\]\$Foreground/);
  assert.match(script, /if\s+\(\$Foreground\)\s+\{\s*&\s+\$cloudflared\s+tunnel\s+--config\s+\$ConfigPath\s+run\s+\*>>\s+\$logPath/s);
});
