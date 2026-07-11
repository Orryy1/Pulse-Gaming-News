#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const { CONTENT_IDENTITIES, selectIdentityVariant } = require("../lib/content-identity-system");
const { discoverPackConfigs, variantAssetsForRole } = require("../lib/audio-identity");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv) {
  const args = {
    outputDir: path.join(ROOT, "output", "content-identities"),
    channelId: "pulse-gaming",
    json: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output-dir") args.outputDir = path.resolve(argv[++index] || args.outputDir);
    else if (value === "--channel") args.channelId = String(argv[++index] || args.channelId);
    else if (value === "--json") args.json = true;
    else if (value === "--help") args.help = true;
  }
  return args;
}

function absoluteAssetPath(pack = {}, filename = "") {
  const root = path.isAbsolute(pack.root_path || "")
    ? pack.root_path
    : path.resolve(ROOT, pack.root_path || ".");
  return path.resolve(root, filename);
}

function resolveCatalogAsset(pack, identity, kind) {
  const selection = identity.audio[kind];
  if (!selection?.role) return null;
  const variants = variantAssetsForRole(pack, selection.role);
  const asset = selectIdentityVariant(variants, selection.variant_indexes, {
    identityId: identity.id,
    storySeed: `${identity.id}:catalog-proof`,
    role: kind,
  });
  if (!asset) return null;
  const absolutePath = absoluteAssetPath(pack, asset.filename);
  return {
    role: selection.role,
    filename: asset.filename,
    asset_id: asset.asset_id || null,
    provider_id: asset.provider_id || null,
    license: asset.license || pack.license || null,
    variant_index: asset.identity_variant_index,
    path: path.relative(ROOT, absolutePath).replace(/\\/g, "/"),
    exists: fs.existsSync(absolutePath),
  };
}

function buildContentIdentityCatalog({ channelId = "pulse-gaming", packConfigs = null } = {}) {
  const packs = Array.isArray(packConfigs) ? packConfigs : discoverPackConfigs();
  const pack = packs.find((candidate) => String(candidate.channel_id || "") === channelId);
  const identities = Object.values(CONTENT_IDENTITIES).map((identity) => ({
    ...identity,
    resolved_assets: {
      bed: pack ? resolveCatalogAsset(pack, identity, "bed") : null,
      sting: pack ? resolveCatalogAsset(pack, identity, "sting") : null,
    },
  }));
  const blockers = [];
  if (!pack) blockers.push(`channel_audio_pack_missing:${channelId}`);
  for (const identity of identities) {
    if (!identity.resolved_assets.bed?.exists) blockers.push(`${identity.id}:bed_missing`);
    if (identity.audio.sting && !identity.resolved_assets.sting?.exists) blockers.push(`${identity.id}:sting_missing`);
  }
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    channel_id: channelId,
    pack_id: pack?.id || null,
    verdict: blockers.length ? "RED" : "GREEN",
    summary: {
      identity_count: identities.length,
      resolved_bed_count: identities.filter((identity) => identity.resolved_assets.bed?.exists).length,
      resolved_sting_count: identities.filter((identity) => identity.resolved_assets.sting?.exists).length,
      blocker_count: blockers.length,
    },
    identities,
    blockers,
    safety: {
      local_only: true,
      no_generation: true,
      no_external_publish: true,
      no_oauth_or_token_mutation: true,
    },
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Pulse Content Identity Catalog",
    "",
    `Verdict: **${report.verdict}**`,
    `Channel: \`${report.channel_id}\``,
    `Audio pack: \`${report.pack_id || "missing"}\``,
    "",
    "| Identity | Label | Playlist | Bed | Sting | Accent |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const identity of report.identities) {
    lines.push(`| ${identity.id} | ${identity.label} | ${identity.audio.playlist_name} | ${identity.resolved_assets.bed?.filename || "missing"} | ${identity.resolved_assets.sting?.filename || "none"} | ${identity.brand.accent} |`);
  }
  if (report.blockers.length) lines.push("", "## Blockers", "", ...report.blockers.map((blocker) => `- ${blocker}`));
  lines.push("", "Local proof only. No audio was generated and no platform action occurred.", "");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log("Usage: node tools/content-identity-catalog.js [--channel pulse-gaming] [--output-dir path] [--json]");
    return;
  }
  const report = buildContentIdentityCatalog({ channelId: args.channelId });
  await fs.ensureDir(args.outputDir);
  await fs.writeJson(path.join(args.outputDir, "content_identity_catalog.json"), report, { spaces: 2 });
  await fs.writeFile(path.join(args.outputDir, "content_identity_catalog.md"), renderMarkdown(report), "utf8");
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(`[content-identity] ${report.verdict} identities=${report.summary.identity_count} output=${args.outputDir}`);
  if (report.verdict !== "GREEN") process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[content-identity] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildContentIdentityCatalog,
  parseArgs,
  renderMarkdown,
};
