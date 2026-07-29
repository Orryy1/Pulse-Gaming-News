"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  acquireEphemeralSourceMedia,
  validateEphemeralSourceMedia,
} = require("../../lib/services/governed-source-media-ephemeral");

const STORY_ID = "official_d86953ca92ca";
const SOURCES = Object.freeze([
  {
    componentId: "ffxiv-bastion-official-thumbnail",
    assetPath: "assets/official/bastion-official-thumbnail.jpg",
    url: "https://i.ytimg.com/vi/uaZlrprwSq4/maxresdefault.jpg",
  },
  {
    componentId: "ffxiv-bastion-concept-art",
    assetPath: "assets/official/bastion-concept-art.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/h/" +
      "WQDKabyATGkXE7PxktcDmWjBHI.jpg",
  },
  {
    componentId: "ffxiv-evolved-mode",
    assetPath: "assets/official/evolved-mode.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/K/" +
      "mR4RvzvRLTG23XBa2HwXoqWC6A.jpg",
  },
  {
    componentId: "ffxiv-naglfar-gameplay-01",
    assetPath: "assets/official/naglfar-gameplay-01.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/C/" +
      "xhgo2LNiT7aGiAmzwy1Jd3-O7M.jpg",
  },
  {
    componentId: "ffxiv-naglfar-gameplay-02",
    assetPath: "assets/official/naglfar-gameplay-02.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/3/" +
      "RE7XFlpGSnui4n6SWIXcq7dIQ8.jpg",
  },
  {
    componentId: "ffxiv-beyond-lifestream",
    assetPath: "assets/official/beyond-lifestream.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/t/" +
      "XB4O-xPrmB6n_wOvwrpDp07WmI.jpg",
  },
  {
    componentId: "ffxiv-evercold-key-art",
    assetPath: "assets/official/evercold-key-art.jpg",
    url:
      "https://lds-img.finalfantasyxiv.com/promo/h/f/" +
      "zmuw00jJ6Cltw9cXd43BUxHq3E.jpg",
  },
]);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function createFixture(t, mutateManifest = () => {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-source-media-ephemeral-"),
  );
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const bytesByUrl = new Map(
    SOURCES.map((source, index) => [
      source.url,
      Buffer.from(`official-image-${index + 1}`),
    ]),
  );
  const manifest = {
    schema_version: "pulse-governed-source-media-manifest-v1",
    story_id: STORY_ID,
    components: SOURCES.map((source) => ({
      component_id: source.componentId,
      media_type: "IMAGE",
      asset: {
        path: source.assetPath,
        sha256: sha256(bytesByUrl.get(source.url)),
      },
      source: {
        direct_media_url: source.url,
      },
    })),
  };
  mutateManifest(manifest);
  const manifestPath = path.join(root, "source-media-manifest.json");
  const manifestBytes = Buffer.from(
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  fs.writeFileSync(manifestPath, manifestBytes);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const bytes = bytesByUrl.get(url);
    return {
      ok: true,
      status: 200,
      url,
      headers: {
        get(name) {
          if (String(name).toLowerCase() === "content-type") {
            return "image/jpeg";
          }
          if (String(name).toLowerCase() === "content-length") {
            return String(bytes.length);
          }
          return null;
        },
      },
      async arrayBuffer() {
        return bytes;
      },
    };
  };
  return {
    root,
    calls,
    fetchImpl,
    manifest,
    manifestPath,
    manifestSha256: sha256(manifestBytes),
    bytesByUrl,
  };
}

test("LOCAL_PROOF acquisition materialises the seven exact official bytes", async (t) => {
  const fixture = createFixture(t);

  const result = await acquireEphemeralSourceMedia({
    mode: "LOCAL_PROOF",
    manifestPath: fixture.manifestPath,
    expectedManifestSha256: fixture.manifestSha256,
    expectedStoryId: STORY_ID,
    fetchImpl: fixture.fetchImpl,
  });

  assert.equal(result.verdict, "READY");
  assert.equal(result.mode, "LOCAL_PROOF");
  assert.equal(result.persistence, "EPHEMERAL_UNTRACKED");
  assert.equal(result.assets.length, 7);
  assert.equal(fixture.calls.length, 7);
  assert.deepEqual(
    fixture.calls.map(({ options }) => options.redirect),
    Array(7).fill("manual"),
  );
  for (const source of SOURCES) {
    const target = path.join(fixture.root, source.assetPath);
    assert.deepEqual(
      fs.readFileSync(target),
      fixture.bytesByUrl.get(source.url),
    );
  }
  assert.deepEqual(result.safety, {
    database_mutated: false,
    oauth_mutated: false,
    platform_contacted: false,
    published: false,
  });
});

test("exact existing assets are reused without any network call", async (t) => {
  const fixture = createFixture(t);
  for (const source of SOURCES) {
    const target = path.join(fixture.root, source.assetPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fixture.bytesByUrl.get(source.url));
  }
  const unexpectedFetch = async () => {
    throw new Error("network must not be used");
  };

  const result = await acquireEphemeralSourceMedia({
    mode: "LOCAL_PROOF",
    manifestPath: fixture.manifestPath,
    expectedManifestSha256: fixture.manifestSha256,
    expectedStoryId: STORY_ID,
    fetchImpl: unexpectedFetch,
  });

  assert.deepEqual(
    [...new Set(result.assets.map((asset) => asset.status))],
    ["REUSED_EXISTING_EXACT"],
  );
  assert.equal(result.official_asset_hosts_contacted, false);
});

test("manifest hash mismatch fails before network or file promotion", async (t) => {
  const fixture = createFixture(t);

  await assert.rejects(
    acquireEphemeralSourceMedia({
      mode: "LOCAL_PROOF",
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: "0".repeat(64),
      expectedStoryId: STORY_ID,
      fetchImpl: fixture.fetchImpl,
    }),
    (error) =>
      error.codes?.includes(
        "source_media_manifest_sha256_mismatch",
      ),
  );

  assert.equal(fixture.calls.length, 0);
  assert.equal(
    fs.existsSync(path.join(fixture.root, SOURCES[0].assetPath)),
    false,
  );
});

test("only explicit LOCAL_PROOF mode can acquire media", async (t) => {
  const fixture = createFixture(t);

  await assert.rejects(
    acquireEphemeralSourceMedia({
      mode: "AUTO_PUBLISH",
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: fixture.manifestSha256,
      expectedStoryId: STORY_ID,
      fetchImpl: fixture.fetchImpl,
    }),
    (error) =>
      error.codes?.includes(
        "source_media_mode_must_be_local_proof",
      ),
  );

  assert.equal(fixture.calls.length, 0);
});

test("HTTP source URLs are refused before acquisition", async (t) => {
  const fixture = createFixture(t, (manifest) => {
    manifest.components[0].source.direct_media_url =
      SOURCES[0].url.replace("https://", "http://");
  });

  await assert.rejects(
    acquireEphemeralSourceMedia({
      mode: "LOCAL_PROOF",
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: fixture.manifestSha256,
      expectedStoryId: STORY_ID,
      fetchImpl: fixture.fetchImpl,
    }),
    (error) =>
      error.codes?.includes(
        "ffxiv-bastion-official-thumbnail_source_url_not_https",
      ),
  );

  assert.equal(fixture.calls.length, 0);
});

test("other HTTPS URLs are outside the exact official allowlist", async (t) => {
  const fixture = createFixture(t, (manifest) => {
    manifest.components[0].source.direct_media_url =
      "https://i.ytimg.com/vi/unreviewed/maxresdefault.jpg";
  });

  await assert.rejects(
    acquireEphemeralSourceMedia({
      mode: "LOCAL_PROOF",
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: fixture.manifestSha256,
      expectedStoryId: STORY_ID,
      fetchImpl: fixture.fetchImpl,
    }),
    (error) =>
      error.codes?.includes(
        "ffxiv-bastion-official-thumbnail_source_url_not_allowlisted",
      ),
  );

  assert.equal(fixture.calls.length, 0);
});

test("a bad downloaded hash promotes none of the staged assets", async (t) => {
  const fixture = createFixture(t);
  const lastUrl = SOURCES.at(-1).url;
  const corruptingFetch = async (url, options) => {
    const response = await fixture.fetchImpl(url, options);
    if (url !== lastUrl) return response;
    return {
      ...response,
      headers: {
        get(name) {
          if (String(name).toLowerCase() === "content-type") {
            return "image/jpeg";
          }
          if (String(name).toLowerCase() === "content-length") {
            return "7";
          }
          return null;
        },
      },
      async arrayBuffer() {
        return Buffer.from("corrupt");
      },
    };
  };

  await assert.rejects(
    acquireEphemeralSourceMedia({
      mode: "LOCAL_PROOF",
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: fixture.manifestSha256,
      expectedStoryId: STORY_ID,
      fetchImpl: corruptingFetch,
    }),
    (error) =>
      error.codes?.includes(
        "ffxiv-evercold-key-art_download_sha256_mismatch",
      ),
  );

  for (const source of SOURCES) {
    assert.equal(
      fs.existsSync(path.join(fixture.root, source.assetPath)),
      false,
    );
  }
  const officialDir = path.join(
    fixture.root,
    "assets",
    "official",
  );
  assert.deepEqual(
    fs.existsSync(officialDir)
      ? fs.readdirSync(officialDir)
      : [],
    [],
  );
});

test("a promotion failure rolls back every asset already promoted in the transaction", async (t) => {
  const fixture = createFixture(t);
  let promotionCount = 0;

  await assert.rejects(
    acquireEphemeralSourceMedia({
      mode: "LOCAL_PROOF",
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: fixture.manifestSha256,
      expectedStoryId: STORY_ID,
      fetchImpl: fixture.fetchImpl,
      promoteImpl(sourcePath, targetPath) {
        promotionCount += 1;
        if (promotionCount === 2) {
          throw new Error("injected_promotion_failure");
        }
        fs.renameSync(sourcePath, targetPath);
      },
    }),
    /injected_promotion_failure/,
  );

  assert.equal(promotionCount, 2);
  for (const source of SOURCES) {
    assert.equal(
      fs.existsSync(path.join(fixture.root, source.assetPath)),
      false,
    );
  }
});

test("streaming downloads are byte-capped before the complete response is buffered", async (t) => {
  const fixture = createFixture(t);
  const oversizedFetch = async (url) => {
    let reads = 0;
    return {
      ok: true,
      status: 200,
      url,
      headers: {
        get(name) {
          if (String(name).toLowerCase() === "content-type") {
            return "image/jpeg";
          }
          return null;
        },
      },
      body: {
        getReader() {
          return {
            async read() {
              reads += 1;
              if (reads === 1) {
                return {
                  done: false,
                  value: Buffer.alloc(24 * 1024 * 1024),
                };
              }
              return {
                done: false,
                value: Buffer.alloc(2 * 1024 * 1024),
              };
            },
            async cancel() {},
          };
        },
      },
    };
  };

  await assert.rejects(
    acquireEphemeralSourceMedia({
      mode: "LOCAL_PROOF",
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: fixture.manifestSha256,
      expectedStoryId: STORY_ID,
      fetchImpl: oversizedFetch,
    }),
    (error) =>
      error.codes?.includes(
        "ffxiv-bastion-official-thumbnail_download_too_large",
      ),
  );
});

test("download timeout aborts a stalled official-media request", async (t) => {
  const fixture = createFixture(t);
  const stalledFetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    });

  await assert.rejects(
    acquireEphemeralSourceMedia({
      mode: "LOCAL_PROOF",
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: fixture.manifestSha256,
      expectedStoryId: STORY_ID,
      fetchImpl: stalledFetch,
      downloadTimeoutMs: 20,
    }),
    (error) =>
      error.codes?.includes(
        "ffxiv-bastion-official-thumbnail_download_timeout",
      ),
  );
});

test("existing hash drift is never overwritten", async (t) => {
  const fixture = createFixture(t);
  const target = path.join(
    fixture.root,
    SOURCES[0].assetPath,
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "operator-local-drift");

  await assert.rejects(
    acquireEphemeralSourceMedia({
      mode: "LOCAL_PROOF",
      manifestPath: fixture.manifestPath,
      expectedManifestSha256: fixture.manifestSha256,
      expectedStoryId: STORY_ID,
      fetchImpl: fixture.fetchImpl,
    }),
    (error) =>
      error.codes?.includes(
        "ffxiv-bastion-official-thumbnail_existing_asset_hash_drift",
      ),
  );

  assert.equal(fs.readFileSync(target, "utf8"), "operator-local-drift");
  assert.equal(fixture.calls.length, 0);
});

test("validation is network-free and requires every exact asset", (t) => {
  const fixture = createFixture(t);
  for (const source of SOURCES) {
    const target = path.join(fixture.root, source.assetPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fixture.bytesByUrl.get(source.url));
  }

  const result = validateEphemeralSourceMedia({
    mode: "LOCAL_PROOF",
    manifestPath: fixture.manifestPath,
    expectedManifestSha256: fixture.manifestSha256,
    expectedStoryId: STORY_ID,
  });

  assert.equal(
    result.operation,
    "VALIDATE_EPHEMERAL_SOURCE_MEDIA",
  );
  assert.deepEqual(
    [...new Set(result.assets.map((asset) => asset.status))],
    ["EXACT"],
  );
  fs.rmSync(
    path.join(fixture.root, SOURCES.at(-1).assetPath),
  );
  assert.throws(
    () =>
      validateEphemeralSourceMedia({
        mode: "LOCAL_PROOF",
        manifestPath: fixture.manifestPath,
        expectedManifestSha256: fixture.manifestSha256,
        expectedStoryId: STORY_ID,
      }),
    (error) =>
      error.codes?.includes(
        "ffxiv-evercold-key-art_asset_not_materialised",
      ),
  );
});
