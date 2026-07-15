"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CREATIVE_SYSTEM_VERSION,
  applyPulseVisualIdentityToHtml,
  inspectPulseVisualIdentityHtml,
  resolvePulseTransitionCycle,
  resolvePulseVisualIdentity,
} = require("../../lib/studio/v5/pulse-visual-identity");

const BASE_HTML = `<!doctype html>
<html>
  <head><style>.stage { position: absolute; }</style></head>
  <body>
    <div id="root" data-composition-id="main" data-duration="4.0">
      <div class="clip" data-start="0" data-duration="4.0" data-track-index="0">
        <div class="backdrop"></div>
        <div class="shade"></div>
        <div id="quote-mark">&quot;</div>
        <div class="stage"><div class="headline"><span class="word">TEST</span></div></div>
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.to(".headline", { opacity: 1, duration: 0.2 }, 0);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;

test("Pulse visual identity maps story classes to distinct production grammars", () => {
  const cases = [
    [{ title: "GTA VI cover art revealed", content_pillar: "Confirmed Drop" }, "reveal"],
    [{ title: "Halo update adds three new missions" }, "update"],
    [{ title: "A leaked Resident Evil date is reportedly circulating" }, "rumour"],
    [{ title: "Fable review scores land", body: "Metacritic verdict" }, "review"],
    [{ title: "Game Pass adds five games free this week" }, "deal"],
    [{ title: "The Mound launches on July 15" }, "release"],
    [{ title: "Breaking: Xbox studio closes", breaking_score: 95 }, "breaking"],
  ];

  const identities = cases.map(([story, expected]) => {
    const identity = resolvePulseVisualIdentity(story);
    assert.equal(identity.category, expected);
    assert.match(identity.primary, /^#[0-9a-f]{6}$/i);
    assert.match(identity.secondary, /^#[0-9a-f]{6}$/i);
    assert.notEqual(identity.primary.toLowerCase(), identity.secondary.toLowerCase());
    assert.ok(identity.segment_name);
    assert.ok(identity.transition_family);
    return identity;
  });

  assert.ok(new Set(identities.map((identity) => identity.palette_id)).size >= 6);
});

test("Pulse visual identity gives each category an FFmpeg-safe edit transition cycle", () => {
  const reveal = resolvePulseTransitionCycle({ title: "GTA VI gameplay reveal trailer" });
  const update = resolvePulseTransitionCycle({ title: "Halo update adds three missions" });
  const allowed = new Set([
    "fade",
    "fadeblack",
    "smoothleft",
    "smoothright",
    "smoothup",
    "wipeleft",
    "wipeup",
    "slideleft",
    "slideup",
    "circleopen",
    "dissolve",
    "hblur",
    "revealleft",
    "revealup",
  ]);

  assert.equal(reveal.length >= 3, true);
  assert.equal(update.length >= 3, true);
  assert.equal(reveal.every((transition) => allowed.has(transition)), true);
  assert.equal(update.every((transition) => allowed.has(transition)), true);
  assert.notDeepEqual(reveal, update);
  assert.equal(new Set(reveal).size, reveal.length);
});

test("Pulse visual identity injects a seek-safe living brand layer into one timeline", () => {
  const identity = resolvePulseVisualIdentity({
    title: "A leaked Resident Evil date is reportedly circulating",
  });
  const html = applyPulseVisualIdentityToHtml(BASE_HTML, {
    identity,
    kind: "quote",
    durationS: 4.4,
  });

  assert.match(html, new RegExp(`data-pulse-creative-system="${CREATIVE_SYSTEM_VERSION}"`));
  assert.match(html, /data-pulse-category="rumour"/);
  assert.match(html, /id="pulse-depth-a"/);
  assert.match(html, /id="pulse-depth-b"/);
  assert.match(html, /id="pulse-light-sweep"[^>]*data-layout-allow-overflow="true"/);
  assert.match(html, /id="pulse-brand-bug"/);
  assert.match(html, /id="pulse-signal-rail"/);
  assert.match(html, /--pulse-primary:\s*#[0-9a-f]{6}/i);
  assert.match(html, /top:\s*252px/);
  assert.match(html, /\.micro\s*\{[\s\S]*background:\s*rgba\(7,\s*9,\s*13,\s*0\.86\)\s*!important/);
  assert.match(html, /\.sub\s*\{[\s\S]*color:\s*var\(--pulse-paper\)\s*!important/);
  assert.match(html, /\.sub\s*\{[\s\S]*background:\s*rgba\(7,\s*9,\s*13,\s*0\.86\)\s*!important/);
  assert.match(html, /\.step\s*\{[\s\S]*background:\s*rgba\(7,\s*9,\s*13,\s*0\.86\)\s*!important/);
  assert.match(html, /\.cta\s*\{[\s\S]*background:\s*rgba\(7,\s*9,\s*13,\s*0\.90\)\s*!important/);
  assert.match(html, /\.arrow\s*\{[\s\S]*background:\s*rgba\(7,\s*9,\s*13,\s*0\.90\)\s*!important/);
  assert.match(html, /\.pulse\s*\{[\s\S]*background:\s*rgba\(7,\s*9,\s*13,\s*0\.90\)\s*!important/);
  assert.match(html, /\.quote-mark\s*\{[\s\S]*top:\s*330px\s*!important/);
  assert.match(html, /id="quote-mark"[^>]*data-layout-allow-overlap="true"[^>]*data-layout-allow-occlusion="true"/);
  assert.equal((html.match(/gsap\.timeline\s*\(/g) || []).length, 1);
  assert.ok((html.match(/\.(?:to|fromTo)\s*\(/g) || []).length >= 8);

  const report = inspectPulseVisualIdentityHtml(html, { expectedCategory: "rumour" });
  assert.equal(report.status, "pass");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.evidence.depth_layer_count, 2);
  assert.equal(report.evidence.safe_zone_branding, true);
  assert.equal(report.evidence.single_timeline, true);
});

test("Pulse visual identity QA rejects a static generic card shell", () => {
  const report = inspectPulseVisualIdentityHtml(BASE_HTML, { expectedCategory: "news" });

  assert.equal(report.status, "fail");
  assert.ok(report.blockers.includes("pulse_creative_system_missing"));
  assert.ok(report.blockers.includes("pulse_parallax_depth_layers_missing"));
  assert.ok(report.blockers.includes("pulse_signature_brand_bug_missing"));
  assert.ok(report.blockers.includes("pulse_signal_rail_missing"));
});
