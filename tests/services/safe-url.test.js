const { test } = require("node:test");
const assert = require("node:assert");

const {
  classifyOutboundUrl,
  isSafeOutboundUrl,
  assertSafeOutboundUrl,
  MAX_URL_LENGTH,
} = require("../../lib/safe-url");

// ---------- accepts ----------

test("classifyOutboundUrl: accepts a normal https URL", () => {
  const r = classifyOutboundUrl("https://example.com/path?q=1");
  assert.deepStrictEqual(r, { ok: true });
});

test("classifyOutboundUrl: accepts http as well (some sources don't TLS yet)", () => {
  assert.strictEqual(
    isSafeOutboundUrl("http://plainhost.example.com/feed.rss"),
    true,
  );
});

test("classifyOutboundUrl: accepts upper-case TLD", () => {
  assert.strictEqual(isSafeOutboundUrl("https://EXAMPLE.CO.UK/"), true);
});

test("classifyOutboundUrl: accepts public IPv4 like Cloudflare", () => {
  // 1.1.1.1 is publicly routed — we only block private ranges.
  assert.strictEqual(isSafeOutboundUrl("https://1.1.1.1/dns-query"), true);
});

test("classifyOutboundUrl: accepts real Steam / Reddit / Wikipedia hosts", () => {
  const urls = [
    "https://cdn.akamai.steamstatic.com/steam/apps/3727390/header.jpg",
    "https://www.reddit.com/r/GamingLeaksAndRumours/new.json",
    "https://en.wikipedia.org/api/rest_v1/page/summary/Alex_Garland",
    "https://i.ytimg.com/vi/LBxjH-lZjEo/maxresdefault.jpg",
    "https://api.pexels.com/v1/search?query=test",
    "https://graph.facebook.com/v21.0/me/photos",
    "https://open.tiktokapis.com/v2/oauth/token/",
    "https://api.elevenlabs.io/v1/tts",
  ];
  for (const url of urls) {
    assert.strictEqual(
      isSafeOutboundUrl(url),
      true,
      `must accept known source: ${url}`,
    );
  }
});

// ---------- scheme rejects ----------

test("classifyOutboundUrl: rejects file: / javascript: / data: / gopher: / ftp:", () => {
  const cases = {
    "file:///etc/passwd": "scheme_file",
    "javascript:alert(1)": "scheme_javascript",
    "data:text/html,<script>alert(1)</script>": "scheme_data",
    "gopher://example.com/": "scheme_gopher",
    "ftp://files.example.com/": "scheme_ftp",
  };
  for (const [url, expectedReason] of Object.entries(cases)) {
    const r = classifyOutboundUrl(url);
    assert.strictEqual(r.ok, false, `must reject: ${url}`);
    assert.strictEqual(r.reason, expectedReason);
  }
});

// ---------- IPv4 private blocks ----------

test("classifyOutboundUrl: rejects 169.254.x.x (cloud metadata endpoints)", () => {
  // GCP / AWS / Azure metadata is on 169.254.169.254 — the most
  // common SSRF target in the real world.
  const r = classifyOutboundUrl("http://169.254.169.254/metadata/instance");
  assert.deepStrictEqual(r, {
    ok: false,
    reason: "ipv4_private_or_reserved",
  });
});

test("classifyOutboundUrl: rejects 127.0.0.1 / loopback", () => {
  assert.strictEqual(
    classifyOutboundUrl("http://127.0.0.1:8080/").reason,
    "ipv4_private_or_reserved",
  );
});

test("classifyOutboundUrl: rejects RFC1918 private ranges", () => {
  for (const host of [
    "10.0.0.5",
    "10.255.255.255",
    "172.16.0.1",
    "172.20.5.5",
    "172.31.254.254",
    "192.168.1.1",
    "192.168.254.100",
  ]) {
    assert.strictEqual(
      classifyOutboundUrl(`http://${host}/`).ok,
      false,
      `must reject private IP ${host}`,
    );
  }
});

test("classifyOutboundUrl: accepts 172.15.x.x and 172.32.x.x (just outside RFC1918)", () => {
  // RFC1918 range for 172. is 16-31 inclusive. Boundaries matter.
  assert.strictEqual(isSafeOutboundUrl("http://172.15.0.1/"), true);
  assert.strictEqual(isSafeOutboundUrl("http://172.32.0.1/"), true);
});

test("classifyOutboundUrl: rejects 0.0.0.0", () => {
  assert.strictEqual(classifyOutboundUrl("http://0.0.0.0:3000/").ok, false);
});

test("classifyOutboundUrl: rejects 100.64.0.0/10 (CGNAT)", () => {
  for (const host of ["100.64.0.1", "100.100.100.100", "100.127.255.254"]) {
    assert.strictEqual(
      classifyOutboundUrl(`http://${host}/`).ok,
      false,
      `must reject CGNAT ${host}`,
    );
  }
});

// ---------- IPv6 private blocks ----------

test("classifyOutboundUrl: rejects ::1 IPv6 loopback", () => {
  assert.strictEqual(classifyOutboundUrl("http://[::1]/").ok, false);
});

test("classifyOutboundUrl: rejects fe80:: link-local IPv6", () => {
  assert.strictEqual(classifyOutboundUrl("http://[fe80::1]/").ok, false);
});

test("classifyOutboundUrl: rejects fc00:: unique-local IPv6", () => {
  assert.strictEqual(classifyOutboundUrl("http://[fc00::1]/").ok, false);
});

// ---------- localhost hostname rejects ----------

test("classifyOutboundUrl: rejects 'localhost' and subdomains", () => {
  for (const host of ["localhost", "foo.localhost", "LOCALHOST"]) {
    assert.strictEqual(
      classifyOutboundUrl(`http://${host}/`).ok,
      false,
      `must reject ${host}`,
    );
  }
});

// ---------- misc ----------

test("classifyOutboundUrl: rejects empty, null, non-string input", () => {
  assert.strictEqual(classifyOutboundUrl("").ok, false);
  assert.strictEqual(classifyOutboundUrl(null).ok, false);
  assert.strictEqual(classifyOutboundUrl(undefined).ok, false);
  assert.strictEqual(classifyOutboundUrl(12345).ok, false);
});

test("classifyOutboundUrl: rejects malformed URLs", () => {
  const r = classifyOutboundUrl("not a url");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "url_parse_failed");
});

test("classifyOutboundUrl: rejects URL longer than MAX_URL_LENGTH", () => {
  const r = classifyOutboundUrl("https://x.com/" + "a".repeat(MAX_URL_LENGTH));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "url_too_long");
});

test("assertSafeOutboundUrl: throws with the reason when unsafe", () => {
  assert.throws(
    () => assertSafeOutboundUrl("http://169.254.169.254/"),
    /ipv4_private_or_reserved/,
  );
});

test("assertSafeOutboundUrl: is a no-op for safe URLs", () => {
  assert.doesNotThrow(() => assertSafeOutboundUrl("https://en.wikipedia.org/"));
});
