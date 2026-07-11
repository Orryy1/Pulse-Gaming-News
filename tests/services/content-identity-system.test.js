"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONTENT_IDENTITIES,
  resolveContentIdentity,
  selectIdentityVariant,
} = require("../../lib/content-identity-system");
const { buildContentIdentityCatalog } = require("../../tools/content-identity-catalog");

test("content identity system classifies the core Pulse editorial formats", () => {
  const cases = [
    [{ title: "Rockstar Issues A Breaking GTA VI Update", breaking_score: 92 }, "breaking_alert"],
    [{ title: "A New Halo Build Leaked Online", flair: "Leak" }, "leak_file"],
    [{ title: "Fable Release Reportedly Moved", flair: "Rumour" }, "rumour_watch"],
    [{ title: "Nintendo Officially Confirms Switch 2 Feature", flair: "Verified" }, "confirmed_drop"],
    [{ title: "Resident Evil Requiem Gameplay Reveal Trailer" }, "major_reveal"],
    [{ title: "Sea Of Thieves Season 18 Update Adds A New Voyage" }, "game_update"],
    [{ title: "Forza Horizon 6 Review Scores Split Critics" }, "review_verdict"],
    [{ title: "Fable Release Date Is Now Locked" }, "release_radar"],
    [{ title: "Switch 2 Gets Its Biggest Price Cut Yet" }, "deal_drop"],
    [{ title: "Bethesda Workers Protest Xbox Layoffs" }, "industry_watch"],
    [{ title: "Black Flag Resynced Steam Backlash Grows" }, "community_debate"],
    [{ title: "The Best RPGs To Play In 2026", content_pillar: "Guide" }, "evergreen_guide"],
  ];

  for (const [story, expected] of cases) {
    assert.equal(resolveContentIdentity(story).id, expected, story.title);
  }
});

test("every Pulse content identity has a complete recognisable production signature", () => {
  const required = [
    "breaking_alert",
    "leak_file",
    "rumour_watch",
    "confirmed_drop",
    "major_reveal",
    "game_update",
    "review_verdict",
    "release_radar",
    "deal_drop",
    "industry_watch",
    "community_debate",
    "evergreen_guide",
  ];

  for (const id of required) {
    const identity = CONTENT_IDENTITIES[id];
    assert.ok(identity, id);
    assert.ok(identity.label);
    assert.match(identity.brand.accent, /^#[0-9A-F]{6}$/i);
    assert.ok(identity.brand.motion_language);
    assert.ok(identity.audio.playlist_name);
    assert.ok(identity.audio.bed.role);
    assert.ok(identity.audio.bed.variant_indexes.length >= 1);
    assert.ok(identity.audio.sfx_roles.length >= 2);
    assert.ok(identity.audio.mix.energy >= 0 && identity.audio.mix.energy <= 1);
  }

  const signatures = required.map((id) => {
    const identity = CONTENT_IDENTITIES[id];
    return [
      identity.audio.bed.role,
      identity.audio.bed.variant_indexes.join(","),
      identity.audio.sting?.role || "none",
      identity.audio.sting?.variant_indexes?.join(",") || "none",
    ].join("|");
  });
  assert.equal(new Set(signatures).size, required.length);
});

test("identity playlist selection is deterministic and constrained to its category playlist", () => {
  const variants = ["a", "b", "c", "d", "e", "f"].map((filename) => ({ filename }));
  const identity = CONTENT_IDENTITIES.game_update;
  const first = selectIdentityVariant(variants, identity.audio.bed.variant_indexes, {
    identityId: identity.id,
    storySeed: "story-123",
    role: "bed",
  });
  const second = selectIdentityVariant(variants, identity.audio.bed.variant_indexes, {
    identityId: identity.id,
    storySeed: "story-123",
    role: "bed",
  });

  assert.deepEqual(first, second);
  assert.ok(identity.audio.bed.variant_indexes.includes(first.identity_variant_index));
  assert.equal(first.identity_id, "game_update");
});

test("content identity catalog proves every category resolves licensed local audio", () => {
  const report = buildContentIdentityCatalog({ channelId: "pulse-gaming" });

  assert.equal(report.verdict, "GREEN", report.blockers.join(", "));
  assert.equal(report.summary.identity_count, 12);
  assert.equal(report.summary.resolved_bed_count, 12);
  assert.equal(report.summary.resolved_sting_count, 11);
  assert.equal(report.identities.every((identity) => identity.resolved_assets.bed.exists), true);
  assert.equal(report.safety.no_external_publish, true);
});
