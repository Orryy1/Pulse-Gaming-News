const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  classifyThumbnailImage,
  rankThumbnailCandidates,
  selectThumbnailSubjectImage,
  runThumbnailPreUploadQa,
} = require("../../lib/thumbnail-safety");
const { buildThumbnailCandidatePng } = require("../../lib/thumbnail-candidate");

function story(overrides = {}) {
  return {
    id: "thumb_test",
    title: "Metro 2039 reveal trailer shows grim new gameplay",
    suggested_thumbnail_text: "METRO RETURNS",
    full_script:
      "Metro 2039 has a new reveal trailer and the footage is focused on the next game.",
    downloaded_images: [],
    ...overrides,
  };
}

test("thumbnail safety: unknown face is rejected", () => {
  const result = classifyThumbnailImage(story(), {
    path: "output/image_cache/story_unknown_face_portrait.jpg",
    type: "portrait",
    source: "article",
    human: true,
  });
  assert.strictEqual(result.safeForThumbnail, false);
  assert.ok(result.reasons.includes("unsafe_thumbnail_face"));
});

test("thumbnail safety: article author image is rejected", () => {
  const result = classifyThumbnailImage(story(), {
    path: "https://cdn.example.com/authors/jane-smith-headshot.jpg",
    type: "article_hero",
    source: "article",
  });
  assert.strictEqual(result.safeForThumbnail, false);
  assert.ok(result.reasons.includes("article_author_or_profile_image"));
});

test("thumbnail safety: game key art is preferred over article imagery", () => {
  const ranked = rankThumbnailCandidates(story(), [
    {
      path: "output/image_cache/thumb_test_article.jpg",
      type: "article_hero",
      source: "article",
      priority: 100,
    },
    {
      path: "output/image_cache/thumb_test_key_art_steam.jpg",
      type: "key_art",
      source: "steam",
      priority: 85,
    },
  ]);
  assert.strictEqual(ranked[0].image.type, "key_art");
});

test("thumbnail safety: repo path name does not make a generic article image game art", () => {
  const result = classifyThumbnailImage(story(), {
    path: "C:/Users/MORR/gaming-studio/pulse-gaming/output/images/story/candidate_0.jpg",
    type: "article_inline",
    source: "article",
  });

  assert.strictEqual(result.isGameAsset, false);
  assert.strictEqual(result.isPlatformAsset, false);
  assert.ok(result.score < 50);
});

test("thumbnail safety: article-source screenshot type is not trusted by type alone", () => {
  const result = classifyThumbnailImage(story(), {
    path: "output/images/story/candidate_0.jpg",
    type: "screenshot",
    source: "article",
  });

  assert.strictEqual(result.isGameAsset, false);
});

test("thumbnail safety: platform/logo image is preferred when game art is absent", () => {
  const selected = selectThumbnailSubjectImage(story(), [
    {
      path: "output/image_cache/thumb_test_reddit_thumb.jpg",
      type: "reddit_thumb",
      source: "reddit",
      priority: 40,
    },
    {
      path: "output/image_cache/thumb_test_xbox_logo.png",
      type: "platform_logo",
      source: "logo",
      priority: 30,
    },
  ]);
  assert.strictEqual(selected.image.type, "platform_logo");
});

test("thumbnail safety: entity-matched face allowed only when story is about that person", () => {
  const kojimaImage = {
    path: "output/image_cache/hideo-kojima-portrait.jpg",
    type: "portrait",
    source: "article",
    human: true,
    personName: "Hideo Kojima",
  };

  const unrelated = classifyThumbnailImage(story(), kojimaImage);
  assert.strictEqual(unrelated.safeForThumbnail, false);

  const related = classifyThumbnailImage(
    story({
      title: "Hideo Kojima confirms new OD trailer details",
      entities: [{ name: "Hideo Kojima" }],
    }),
    kojimaImage,
  );
  assert.strictEqual(related.safeForThumbnail, true);
  assert.ok(related.warnings.includes("entity_matched_face_allowed"));
});

test("thumbnail QA fails when every available subject is an unsafe face", async () => {
  const qa = await runThumbnailPreUploadQa(
    story({
      image_path: "output/images/thumb_test.png",
      downloaded_images: [
        {
          path: "output/image_cache/author_profile_face.jpg",
          type: "portrait",
          source: "article",
          human: true,
        },
      ],
    }),
  );
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("no_thumbnail_safe_subject_image"));
});

test("thumbnail_candidate.png is generated from a safe game image", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-thumb-"));
  const safeImage = path.join(dir, "metro_key_art_steam.jpg");
  const outPath = path.join(dir, "thumbnail_candidate.png");
  const sharp = require("sharp");
  await sharp({
    create: {
      width: 900,
      height: 600,
      channels: 3,
      background: "#16324f",
    },
  })
    .jpeg()
    .toFile(safeImage);

  const result = await buildThumbnailCandidatePng({
    story: story({
      downloaded_images: [
        {
          path: safeImage,
          type: "key_art",
          source: "steam",
        },
      ],
    }),
    outPath,
  });

  assert.strictEqual(result.path, outPath);
  assert.ok(await fs.pathExists(outPath));
  assert.strictEqual(result.qa.result, "pass");
});
