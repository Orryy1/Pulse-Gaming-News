"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("fs-extra");

const {
  materializeSourceIdentitySidecar,
  materializeSteamSourceIdentitySidecar,
} = require("../../lib/source-identity-sidecar-materializer");

test("materialises an identity-only YouTube oEmbed sidecar bound to current master bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-source-identity-"));
  const masterPath = path.join(root, "U-aWl8_7P58.mp4");
  const oembedPath = path.join(root, "U-aWl8_7P58.oembed.json");
  await fs.writeFile(masterPath, Buffer.from("real-master-bytes"));
  await fs.writeJson(oembedPath, {
    title: "Assassin's Creed Black Flag Resynced - PS5 Pro Immersion Trailer",
    author_name: "Assassin's Creed",
    author_url: "https://www.youtube.com/@assassinscreed",
    provider_name: "YouTube",
    provider_url: "https://www.youtube.com/",
  });

  const result = await materializeSourceIdentitySidecar({
    masterPath,
    youtubeVideoId: "U-aWl8_7P58",
    oembedPath,
    verifiedAt: "2026-07-15T09:30:00.000Z",
  });

  const sidecar = await fs.readJson(result.sidecar_path);
  assert.equal(sidecar.schema, "pulse_motion_source_identity_sidecar_v1");
  assert.equal(sidecar.canonical_source_url, "https://www.youtube.com/watch?v=U-aWl8_7P58");
  assert.equal(sidecar.youtube_video_id, "U-aWl8_7P58");
  assert.equal(sidecar.identity_scope, "source_identity_only");
  assert.equal(sidecar.rights_grant, false);
  assert.equal(
    sidecar.source_master_sha256,
    crypto.createHash("sha256").update(Buffer.from("real-master-bytes")).digest("hex"),
  );
  assert.equal(sidecar.evidence.oembed_snapshot_sha256, result.oembed_snapshot_sha256);
});

test("rejects incomplete oEmbed identity without writing a sidecar", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-source-identity-red-"));
  const masterPath = path.join(root, "PhQ3yQjUgAc.mp4");
  const oembedPath = path.join(root, "PhQ3yQjUgAc.oembed.json");
  await fs.writeFile(masterPath, Buffer.from("master"));
  await fs.writeJson(oembedPath, {
    title: "Official Game Overview Trailer",
    author_name: "unknown",
    provider_name: "YouTube",
  });

  await assert.rejects(
    materializeSourceIdentitySidecar({
      masterPath,
      youtubeVideoId: "PhQ3yQjUgAc",
      oembedPath,
    }),
    /oembed_identity_incomplete/,
  );
  assert.equal(
    await fs.pathExists(path.join(root, "PhQ3yQjUgAc.source-identity.json")),
    false,
  );
});

test("materialises an identity-only Steam sidecar bound to official media and current bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-steam-source-identity-"));
  const masterPath = path.join(root, "official-gameplay.mp4");
  const canonicalSourceUrl =
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2697940/extras/official-gameplay.mp4?t=1784002409";
  await fs.writeFile(masterPath, Buffer.from("official-steam-master-bytes"));

  const result = await materializeSteamSourceIdentitySidecar({
    masterPath,
    canonicalSourceUrl,
    sourceOwner: "Flyway Games",
    sourceType: "official_platform_product_page",
    steamAppId: "2697940",
    referenceUrl: "https://store.steampowered.com/app/2697940/Ascend_to_ZERO/",
    verifiedAt: "2026-07-16T21:45:00.000Z",
  });

  const sidecar = await fs.readJson(result.sidecar_path);
  assert.equal(sidecar.schema, "pulse_motion_source_identity_sidecar_v1");
  assert.equal(sidecar.platform, "steam");
  assert.equal(sidecar.canonical_source_url, canonicalSourceUrl);
  assert.equal(sidecar.source_owner, "Flyway Games");
  assert.equal(sidecar.source_type, "official_platform_product_page");
  assert.equal(sidecar.identity_scope, "source_identity_only");
  assert.equal(sidecar.rights_grant, false);
  assert.equal(sidecar.evidence.steam_app_id, "2697940");
  assert.equal(
    sidecar.source_master_sha256,
    crypto.createHash("sha256").update(Buffer.from("official-steam-master-bytes")).digest("hex"),
  );
});

test("rejects a Steam sidecar when official media and product-page app IDs disagree", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-steam-source-identity-red-"));
  const masterPath = path.join(root, "official-gameplay.mp4");
  await fs.writeFile(masterPath, Buffer.from("master"));

  await assert.rejects(
    materializeSteamSourceIdentitySidecar({
      masterPath,
      canonicalSourceUrl:
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2697940/extras/official-gameplay.mp4",
      sourceOwner: "Flyway Games",
      sourceType: "official_platform_product_page",
      steamAppId: "2697940",
      referenceUrl: "https://store.steampowered.com/app/9999999/Wrong_Game/",
    }),
    /steam_source_reference_app_id_mismatch/,
  );
});
