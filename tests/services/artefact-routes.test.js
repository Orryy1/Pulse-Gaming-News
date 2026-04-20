const { test } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const http = require("node:http");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

// Contract tests for the public-vs-draft gate on the artefact routes
// after the 2026-04-20 exposure audit:
//   GET /api/story-image/:id
//   GET /api/download/:id
//
// The real server.js handler reads its story list via readNews() and
// enforces a strict output/ path containment check. For these tests
// we rebuild minimal handlers that match the production logic exactly
// but take the story list and file roots via closure, so we can
// exercise every branch (public / draft / missing / auth-match / auth-
// mismatch / path-escape) without touching SQLite or the real
// filesystem layout.

const {
  isPubliclyVisible,
  sanitizeStoriesForPublic,
} = require("../../lib/public-story");

function isAuthenticatedRequest(req, secret) {
  if (!secret) return true;
  const header = req.headers && req.headers.authorization;
  if (typeof header !== "string") return false;
  return header.replace(/^Bearer\s+/, "") === secret;
}

function buildTestApp({ stories, apiToken, allowedBase }) {
  const app = express();

  app.get("/api/story-image/:id", (req, res) => {
    const story = stories.find((s) => s.id === req.params.id);
    if (
      !story ||
      (!isPubliclyVisible(story) && !isAuthenticatedRequest(req, apiToken))
    ) {
      return res.status(404).json({ error: "story image not found" });
    }
    if (!story.story_image_path) {
      return res.status(404).json({ error: "story image not found" });
    }
    const filePath = path.resolve(story.story_image_path);
    if (
      !filePath.startsWith(allowedBase + path.sep) &&
      filePath !== allowedBase
    ) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "file not found on disk" });
    }
    res.setHeader("Content-Type", "image/png");
    fs.createReadStream(filePath).pipe(res);
  });

  app.get("/api/download/:id", (req, res) => {
    const story = stories.find((s) => s.id === req.params.id);
    if (
      !story ||
      (!isPubliclyVisible(story) && !isAuthenticatedRequest(req, apiToken))
    ) {
      return res.status(404).json({ error: "video not found" });
    }
    if (!story.exported_path) {
      return res.status(404).json({ error: "video not found" });
    }
    const filePath = path.resolve(story.exported_path);
    if (
      !filePath.startsWith(allowedBase + path.sep) &&
      filePath !== allowedBase
    ) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "file not found on disk" });
    }
    const stat = fs.statSync(filePath);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=pulse-gaming-${req.params.id}.mp4`,
    );
    fs.createReadStream(filePath).pipe(res);
  });

  // Public /api/news behaviour is unchanged — pin it here so the
  // test in this file fails if this task accidentally regresses it.
  app.get("/api/news", (_req, res) => {
    res.json(sanitizeStoriesForPublic(stories));
  });

  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            buffer: Buffer.concat(chunks),
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------- fixtures ----------

// MUST be async + `return await run(...)` — if this function returns
// the run Promise synchronously, the `finally` fires and rmSync's the
// temp dir before the HTTP server has finished streaming the artefact.
async function withTempArtefacts(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-artefact-"));
  const outputDir = path.join(base, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const storyImage = path.join(outputDir, "live_story.png");
  const draftImage = path.join(outputDir, "draft_story.png");
  const liveVideo = path.join(outputDir, "live_video.mp4");
  const draftVideo = path.join(outputDir, "draft_video.mp4");
  fs.writeFileSync(storyImage, Buffer.from("PUBLISHED-PNG-BYTES"));
  fs.writeFileSync(draftImage, Buffer.from("DRAFT-PNG-BYTES"));
  fs.writeFileSync(liveVideo, Buffer.from("PUBLISHED-MP4-BYTES"));
  fs.writeFileSync(draftVideo, Buffer.from("DRAFT-MP4-BYTES"));

  const stories = [
    {
      id: "pub_live",
      title: "A real published story",
      youtube_post_id: "iRWg2GWVdfY",
      youtube_url: "https://youtube.com/shorts/iRWg2GWVdfY",
      publish_status: "published",
      story_image_path: storyImage,
      exported_path: liveVideo,
    },
    {
      id: "pub_partial",
      title: "YT up, others pending — still public enough",
      youtube_post_id: "xxx",
      publish_status: "partial",
      story_image_path: storyImage,
      exported_path: liveVideo,
    },
    {
      id: "draft_idle",
      title: "Queued for produce, nothing uploaded yet",
      publish_status: "idle",
      story_image_path: draftImage,
      exported_path: draftVideo,
    },
    {
      id: "draft_failed",
      title: "Publish attempt failed on every platform",
      publish_status: "failed",
      story_image_path: draftImage,
      exported_path: draftVideo,
    },
    {
      id: "draft_noyt",
      title: "Produced but not uploaded anywhere",
      story_image_path: draftImage,
      exported_path: draftVideo,
    },
    {
      id: "no_artefact",
      title: "Exists but has no story_image / mp4 on disk",
      youtube_post_id: "abc",
      publish_status: "published",
    },
  ];

  try {
    return await run({ stories, allowedBase: path.resolve(outputDir), base });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ---------- /api/story-image/:id ----------

test("story-image: published story is fetchable unauthenticated (IG server path)", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/story-image/pub_live");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers["content-type"], "image/png");
      assert.strictEqual(res.body, "PUBLISHED-PNG-BYTES");
    } finally {
      server.close();
    }
  });
});

test("story-image: partial-publish story is also reachable (IG fetch during mid-publish)", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/story-image/pub_partial");
      assert.strictEqual(res.status, 200);
    } finally {
      server.close();
    }
  });
});

test("story-image: draft story without auth returns 404 (NOT 401 — no enumeration)", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      for (const id of ["draft_idle", "draft_failed", "draft_noyt"]) {
        const res = await get(port, `/api/story-image/${id}`);
        assert.strictEqual(res.status, 404, `id=${id} should 404`);
        // Body must not reveal the image bytes.
        assert.strictEqual(res.body.includes("DRAFT-PNG-BYTES"), false);
      }
    } finally {
      server.close();
    }
  });
});

test("story-image: draft story WITH valid Bearer succeeds (operator dashboard)", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/story-image/draft_idle", {
        Authorization: "Bearer tok_verysecret123",
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body, "DRAFT-PNG-BYTES");
    } finally {
      server.close();
    }
  });
});

test("story-image: draft story WITH wrong Bearer returns 404 (matches unauth)", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/story-image/draft_idle", {
        Authorization: "Bearer wrong_token",
      });
      assert.strictEqual(res.status, 404);
    } finally {
      server.close();
    }
  });
});

test("story-image: unknown story id returns 404 (no distinction from draft-without-auth)", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/story-image/nope_never_existed");
      assert.strictEqual(res.status, 404);
    } finally {
      server.close();
    }
  });
});

test("story-image: published story without an on-disk image returns 404", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/story-image/no_artefact");
      assert.strictEqual(res.status, 404);
    } finally {
      server.close();
    }
  });
});

// ---------- /api/download/:id ----------

test("download: published MP4 is fetchable unauthenticated (IG URL-fallback path)", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/download/pub_live");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers["content-type"], "video/mp4");
      assert.match(
        String(res.headers["content-disposition"] || ""),
        /pulse-gaming-pub_live\.mp4/,
      );
      assert.strictEqual(res.body, "PUBLISHED-MP4-BYTES");
    } finally {
      server.close();
    }
  });
});

test("download: draft MP4 without auth returns 404 (bytes never leave the server)", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      for (const id of ["draft_idle", "draft_failed", "draft_noyt"]) {
        const res = await get(port, `/api/download/${id}`);
        assert.strictEqual(res.status, 404, `id=${id} should 404`);
        assert.strictEqual(res.body.includes("DRAFT-MP4-BYTES"), false);
      }
    } finally {
      server.close();
    }
  });
});

test("download: draft MP4 with valid Bearer succeeds (operator dashboard)", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/download/draft_idle", {
        Authorization: "Bearer tok_verysecret123",
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body, "DRAFT-MP4-BYTES");
    } finally {
      server.close();
    }
  });
});

test("download: unknown story id returns 404", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/download/never_exists");
      assert.strictEqual(res.status, 404);
    } finally {
      server.close();
    }
  });
});

// ---------- regression: /api/news contract unchanged ----------

test("public /api/news still hides drafts and strips sensitive fields (no regression)", async () => {
  await withTempArtefacts(async ({ stories, allowedBase }) => {
    // Give the published stories some sensitive fields to confirm
    // the /api/news sanitiser is still in force for this gate patch.
    stories[0].full_script = "SECRET_SCRIPT";
    stories[0].pinned_comment = "SECRET_COMMENT";
    const app = buildTestApp({
      stories,
      apiToken: "tok_verysecret123",
      allowedBase,
    });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/news");
      assert.strictEqual(res.status, 200);
      const body = JSON.parse(res.body);
      // Drafts absent.
      const ids = body.map((s) => s.id);
      assert.ok(ids.includes("pub_live"));
      assert.ok(ids.includes("pub_partial"));
      assert.ok(!ids.includes("draft_idle"));
      assert.ok(!ids.includes("draft_failed"));
      assert.ok(!ids.includes("draft_noyt"));
      // Editorial/internal fields still stripped.
      assert.strictEqual(res.body.includes("SECRET_SCRIPT"), false);
      assert.strictEqual(res.body.includes("SECRET_COMMENT"), false);
    } finally {
      server.close();
    }
  });
});
