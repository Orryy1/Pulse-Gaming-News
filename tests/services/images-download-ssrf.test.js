const { test } = require("node:test");
const assert = require("node:assert");

// Regression coverage for the 2026-04-21 safe-url wiring into
// images_download.js. The helper itself is covered by
// tests/services/safe-url.test.js — this suite confirms the wiring:
// that downloadImage / downloadVideoClip refuse unsafe URLs early
// (before axios fires), log a skip reason, and return null without
// crashing the enclosing scrape loop.

// We mock axios so we can prove the unsafe branch NEVER hits the
// network. A real axios.get to 169.254.169.254 would time out
// rather than prove anything.

const axios = require("axios");
const path = require("path");
const os = require("node:os");
const fs = require("fs-extra");

async function withMockedAxios(fn) {
  const origGet = axios.get;
  let called = false;
  let calledUrl = null;
  axios.get = async (url) => {
    called = true;
    calledUrl = url;
    return { data: Buffer.alloc(0) };
  };
  try {
    return await fn({
      getCalled: () => called,
      getUrl: () => calledUrl,
    });
  } finally {
    axios.get = origGet;
  }
}

// Fresh module load per test so each test gets a clean cache
// resolution. We use process.chdir to a temp dir so cache paths
// are isolated.
async function withTempCwd(fn) {
  const prev = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-img-test-"));
  try {
    process.chdir(tmp);
    // Force-reload the module with the temp cwd in place so its
    // CACHE_DIR / VIDEO_CACHE_DIR resolve under the temp directory.
    delete require.cache[require.resolve("../../images_download")];
    const mod = require("../../images_download");
    return await fn(mod);
  } finally {
    process.chdir(prev);
    fs.rmSync(tmp, { recursive: true, force: true });
    delete require.cache[require.resolve("../../images_download")];
  }
}

// ---------- downloadImage ----------

test("downloadImage: rejects file:// before hitting axios", async () => {
  await withMockedAxios(async (spy) => {
    await withTempCwd(async (mod) => {
      const result = await mod.downloadImage("file:///etc/passwd", "test.jpg");
      assert.strictEqual(result, null);
      assert.strictEqual(
        spy.getCalled(),
        false,
        "must not hit axios for file:// URL",
      );
    });
  });
});

test("downloadImage: rejects http://127.0.0.1 before hitting axios", async () => {
  await withMockedAxios(async (spy) => {
    await withTempCwd(async (mod) => {
      const result = await mod.downloadImage(
        "http://127.0.0.1:3000/secret.jpg",
        "test.jpg",
      );
      assert.strictEqual(result, null);
      assert.strictEqual(spy.getCalled(), false);
    });
  });
});

test("downloadImage: rejects GCP metadata endpoint 169.254.169.254", async () => {
  await withMockedAxios(async (spy) => {
    await withTempCwd(async (mod) => {
      const result = await mod.downloadImage(
        "http://169.254.169.254/metadata/instance",
        "metadata.jpg",
      );
      assert.strictEqual(result, null);
      assert.strictEqual(
        spy.getCalled(),
        false,
        "cloud metadata endpoint must be blocked before axios",
      );
    });
  });
});

test("downloadImage: rejects localhost hostname", async () => {
  await withMockedAxios(async (spy) => {
    await withTempCwd(async (mod) => {
      const result = await mod.downloadImage(
        "http://localhost:8080/x.png",
        "test.jpg",
      );
      assert.strictEqual(result, null);
      assert.strictEqual(spy.getCalled(), false);
    });
  });
});

test("downloadImage: rejects malformed URL without crashing", async () => {
  await withMockedAxios(async (spy) => {
    await withTempCwd(async (mod) => {
      const result = await mod.downloadImage("not a url", "test.jpg");
      assert.strictEqual(result, null);
      assert.strictEqual(spy.getCalled(), false);
    });
  });
});

test("downloadImage: lets a known-good public https URL through to axios", async () => {
  await withMockedAxios(async (spy) => {
    await withTempCwd(async (mod) => {
      // The mock returns an empty buffer, which the min-size check
      // in downloadImage will reject AFTER the fetch. That still
      // means axios WAS called — which is what we want to prove.
      await mod.downloadImage(
        "https://cdn.akamai.steamstatic.com/steam/apps/3727390/header.jpg",
        "ok.jpg",
      );
      assert.strictEqual(
        spy.getCalled(),
        true,
        "known-good Steam URL must reach axios",
      );
      assert.match(spy.getUrl(), /steamstatic\.com/);
    });
  });
});

// ---------- downloadVideoClip ----------

test("downloadVideoClip: rejects unsafe URLs before hitting axios", async () => {
  await withMockedAxios(async (spy) => {
    await withTempCwd(async (mod) => {
      const cases = [
        "file:///etc/shadow",
        "http://169.254.169.254/metadata",
        "http://10.0.0.5/secret.mp4",
        "http://[::1]/loopback.mp4",
        "javascript:alert(1)",
      ];
      for (const url of cases) {
        const result = await mod.downloadVideoClip(url, "x.mp4");
        assert.strictEqual(result, null, `must reject ${url}`);
      }
      assert.strictEqual(
        spy.getCalled(),
        false,
        "none of the unsafe URLs should reach axios",
      );
    });
  });
});

test("downloadVideoClip: known Steam movie URL reaches axios", async () => {
  await withMockedAxios(async (spy) => {
    await withTempCwd(async (mod) => {
      await mod.downloadVideoClip(
        "https://cdn.akamai.steamstatic.com/steam/apps/256855888/movie480.mp4",
        "ok.mp4",
      );
      assert.strictEqual(spy.getCalled(), true);
    });
  });
});

// ---------- belt and braces: log format ----------

test("downloadImage: skip log reason is a safe enum tag, not the raw URL", async () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await withMockedAxios(async () => {
      await withTempCwd(async (mod) => {
        await mod.downloadImage(
          "http://169.254.169.254/token=SECRETVALUE",
          "x.jpg",
        );
      });
    });
  } finally {
    console.log = origLog;
  }
  const logText = logs.join("\n");
  // The log should contain the reason tag but NOT the full raw URL
  // (which could contain tokens or long path noise).
  assert.match(logText, /skipping unsafe image URL/);
  assert.match(logText, /ipv4_private_or_reserved/);
  assert.strictEqual(
    logText.includes("SECRETVALUE"),
    false,
    "raw URL query params must not leak into skip logs",
  );
});
