"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

// server.js serves /privacy and /data-deletion from lib/privacy-notice.js.
const source = ["server.js", path.join("lib", "privacy-notice.js")]
  .map((f) => fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8"))
  .join("\n");
const privacyNotice = require("../../lib/privacy-notice");

test("public legal pages use the Pulse Gaming News identity", () => {
  assert.match(source, /Terms of Service - Pulse Gaming News/);
  assert.match(privacyNotice.privacyPage(), /Privacy Policy - Pulse Gaming News/);
  assert.match(
    privacyNotice.dataDeletionPage(),
    /Data Deletion Instructions - Pulse Gaming News/,
  );
  assert.doesNotMatch(source, /title>[^<]+ - Pulse Gaming<\/title>/);
});

test("public legal copy does not claim broad autonomous cross-platform publishing", () => {
  assert.doesNotMatch(
    source,
    /provides automated gaming news content across YouTube, TikTok and Instagram/i,
  );
  assert.match(
    source,
    /publishes reviewed gaming news, primarily on YouTube/i,
  );
});

test("privacy notice says what the code does with personal data", () => {
  const html = privacyNotice.privacyPage();
  // The old copy claimed no viewer data was collected or stored. The code reads
  // comments, sends them to Claude, keeps records, keeps Reddit usernames and
  // Discord user IDs.
  assert.doesNotMatch(
    html + privacyNotice.dataDeletionPage(),
    /do(es)? not (intentionally )?(collect|process|store)( or store)? (any )?personal (data|information)/i,
  );
  for (const must of [
    /a trading name of a UK sole trader/,
    /youtube\.com\/@PulseGMG/,
    /Anthropic/,
    /legitimate interests/i,
    /Reddit username/,
    /Our videos do not show Reddit usernames/,
    /Discord user ID/,
    /Cloudflare/,
    /How long we keep it/,
    /object to our use of it/,
    /acknowledge your complaint within 30 days/,
    /Data \(Use and Access\) Act 2025/,
    /Information Commission/,
    /https:\/\/ico\.org\.uk\/make-a-complaint\//,
  ])
    assert.match(html, must);
  // Burner identity: no email or postal address on the public notice.
  assert.doesNotMatch(html, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(html, /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/);
});
