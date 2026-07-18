#!/usr/bin/env node
"use strict";

const {
  materializeSourceIdentitySidecar,
  materializeSteamSourceIdentitySidecar,
} = require("../lib/source-identity-sidecar-materializer");

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

async function main() {
  const args = process.argv.slice(2);
  const steamAppId = argValue(args, "--steam-app-id");
  const result = steamAppId
    ? await materializeSteamSourceIdentitySidecar({
        masterPath: argValue(args, "--master"),
        canonicalSourceUrl: argValue(args, "--source-url"),
        sourceOwner: argValue(args, "--source-owner"),
        sourceType: argValue(args, "--source-type") || "official_platform_product_page",
        steamAppId,
        referenceUrl: argValue(args, "--reference-url"),
        verifiedAt: argValue(args, "--verified-at") || new Date().toISOString(),
      })
    : await materializeSourceIdentitySidecar({
        masterPath: argValue(args, "--master"),
        youtubeVideoId: argValue(args, "--youtube-video-id"),
        oembedPath: argValue(args, "--oembed-json"),
        verifiedAt: argValue(args, "--verified-at") || new Date().toISOString(),
      });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `[source-identity-sidecar-materializer] ${error.stack || error.message}\n`,
    );
    process.exitCode = 1;
  });
}
