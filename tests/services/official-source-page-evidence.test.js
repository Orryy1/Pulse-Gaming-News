"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractOfficialSourcePageEvidence,
  fetchOfficialSourcePageEvidence,
} = require("../../lib/official-source-page-evidence");

test("official source evidence extracts article text and an end-of-day event window", () => {
  const evidence = extractOfficialSourcePageEvidence({
    url: "https://news.xbox.com/en-us/2026/07/09/free-play-days-07-09-2026/",
    publishedAt: "2026-07-09T15:00:00.000Z",
    html: `
      <html><head><title>Free Play Days - Xbox Wire</title></head><body>
        <article>
          <h1>Free Play Days</h1>
          <p>MLB The Show 26, The Alters and Stuffed are available from Thursday, July 9 until Sunday, July 12.</p>
        </article>
      </body></html>
    `,
  });

  assert.equal(evidence.status, "pass");
  assert.match(evidence.source_text, /The Alters and Stuffed/);
  assert.deepEqual(evidence.confirmed_event_window, {
    status: "confirmed",
    starts_at: "2026-07-09T00:00:00.000Z",
    ends_at: "2026-07-12T23:59:59.999Z",
    source_url: "https://news.xbox.com/en-us/2026/07/09/free-play-days-07-09-2026/",
    evidence_text: "from Thursday, July 9 until Sunday, July 12",
  });
});

test("official source evidence prefers visible article copy over stale JSON-LD", () => {
  const evidence = extractOfficialSourcePageEvidence({
    url: "https://news.xbox.com/en-us/2026/07/09/free-play-days-07-09-2026/",
    publishedAt: "2026-07-09T15:00:00.000Z",
    html: `
      <script type="application/ld+json">{
        "@type": "NewsArticle",
        "articleBody": "Old April offer runs from Thursday, April 9 until Sunday, April 12."
      }</script>
      <article>
        <h1>Free Play Days - MLB The Show 26, The Alters and Stuffed</h1>
        <p>The current games are available from Thursday, July 9 until Sunday, July 12.</p>
      </article>
    `,
  });

  assert.match(evidence.source_text, /current games.*July 9.*July 12/i);
  assert.doesNotMatch(evidence.source_text, /Old April offer/i);
  assert.equal(evidence.confirmed_event_window.ends_at, "2026-07-12T23:59:59.999Z");
});

test("official source evidence preserves explicit UTC event times", () => {
  const evidence = extractOfficialSourcePageEvidence({
    url: "https://news.xbox.com/en-us/2026/07/09/wreck-runners-join-the-xbox-insider-playtest/",
    publishedAt: "2026-07-09T17:00:00.000Z",
    html: `
      <article>
        <h1>Wreck Runners Insider Playtest</h1>
        <p>Start: Thursday, July 9 at 10:00 AM PT (17:00 UTC)</p>
        <p>End: Monday, July 13 at 10:00 AM PT (17:00 UTC)</p>
        <p>The full game launches on Xbox on July 16.</p>
      </article>
    `,
  });

  assert.equal(evidence.confirmed_event_window.starts_at, "2026-07-09T17:00:00.000Z");
  assert.equal(evidence.confirmed_event_window.ends_at, "2026-07-13T17:00:00.000Z");
  assert.match(evidence.source_text, /full game launches on Xbox on July 16/i);
});

test("official source fetch uses injected transport and reports a content hash", async () => {
  const evidence = await fetchOfficialSourcePageEvidence({
    url: "https://news.xbox.com/example",
    publishedAt: "2026-07-09T00:00:00.000Z",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => "<article><h1>Starward V3.1</h1><p>Pliszka can detach the Wing Rider Assembly mid-battle.</p></article>",
    }),
  });

  assert.equal(evidence.status, "pass");
  assert.match(evidence.source_text, /Pliszka can detach/);
  assert.match(evidence.source_text_sha256, /^[a-f0-9]{64}$/);
});
