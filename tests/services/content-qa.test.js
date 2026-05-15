const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  runContentQa,
  DEFAULT_MIN_MP4_BYTES,
  classifyArticleContextRisk,
  BANNED_STOCK_PHRASES,
  GLUED_SENTENCE_RE,
  AMERICAN_TIME_RE,
} = require("../../lib/services/content-qa");

// Helpers to produce a known-good / known-bad fixture. All tests
// pass a fake `fs` so we don't touch the real filesystem unless
// the test is specifically about on-disk size.

function fakeFs(map) {
  // map: { "/path": { size: bytes } | null  }
  return {
    async pathExists(p) {
      return Object.prototype.hasOwnProperty.call(map, p) && map[p] !== null;
    },
    async stat(p) {
      if (!map[p]) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { size: map[p].size };
    },
  };
}

function goodStory(overrides = {}) {
  return {
    id: "test_good",
    title: "Test Story",
    exported_path: "/tmp/out.mp4",
    // ~130 words — mirrors the real Pulse target of 120-150 so
    // the word-count check passes without tripping the max bound.
    full_script:
      "A dead franchise just got resurrected and nobody saw it coming. Big studios are responding to a shift in the market that took three years to build and thirty seconds to explode. The numbers are staggering and the timing is surgical. Ubisoft confirmed the reveal is set for later this month and the embargo lifts at midday across every major territory. Sources have verified the timeline through two separate trade outlets and an internal calendar invite that leaked last week. Players are already speculating about what this means for the series going forward, and the marketing team is quietly scrubbing old posts in preparation for the new positioning. Follow Pulse Gaming so you never miss a beat.",
    tts_script: "Short clean tts variant for TTS pass.",
    image_path: "/tmp/card.png",
    render_lane: "legacy_multi_image",
    render_quality_class: "standard",
    downloaded_images: [
      { path: "/tmp/hero.jpg", type: "article_hero" },
      { path: "/tmp/logo.png", type: "company_logo" },
    ],
    ...overrides,
  };
}

// ---------- happy path ----------

test("runContentQa: a healthy story → pass", async () => {
  const story = goodStory();
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "pass");
  assert.deepStrictEqual(qa.failures, []);
  assert.deepStrictEqual(qa.warnings, []);
});

// ---------- hard-fail cases ----------

test("runContentQa: missing exported_path → fail:exported_mp4_missing", async () => {
  const story = goodStory({ exported_path: undefined });
  const qa = await runContentQa(story, { fs: fakeFs({}) });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("exported_mp4_missing"));
});

test("runContentQa: exported_path set but file absent → fail", async () => {
  const story = goodStory();
  const qa = await runContentQa(story, { fs: fakeFs({}) });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("exported_mp4_not_on_disk"));
});

test("runContentQa: tiny MP4 → fail", async () => {
  const story = goodStory();
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) => f.startsWith("exported_mp4_too_small")),
    `expected exported_mp4_too_small, got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: missing full_script → fail:script_missing", async () => {
  const story = goodStory({ full_script: "", tts_script: "" });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("script_missing"));
});

test("runContentQa: tiny script word count → fail:script_too_short", async () => {
  const story = goodStory({
    full_script: "One two three four five six seven eight nine ten.",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) => f.startsWith("script_too_short")),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: banned 'let me know in the comments' → fail", async () => {
  const story = goodStory({
    full_script:
      goodStory().full_script + " Let me know in the comments what you think.",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) => f.startsWith("banned_phrase")),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: glued sentence token in full_script → fail", async () => {
  const story = goodStory({
    full_script: goodStory().full_script.replace(". Ubisoft", ".Ubisoft"),
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("glued_sentence_in_full_script"));
});

test("runContentQa: glued sentence in tts_script → fail", async () => {
  const story = goodStory({ tts_script: "The game launched.Players rushed." });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("glued_sentence_in_tts_script"));
});

test("runContentQa: damaged protected brand name in TTS script → fail", async () => {
  const story = goodStory({
    full_script: goodStory().full_script + " Pok\u00e9mon returns this month.",
    tts_script: "Pokmon returns this month.",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) =>
      f.includes("brand_name:protected_name_damaged:Pok\u00e9mon:tts_script:Pokmon"),
    ),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: overlong audio duration hard-fails before publish", async () => {
  const story = goodStory({ audio_duration: 125.86 });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });

  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) => f.startsWith("audio_duration_too_long")),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: unusable subtitle timing hard-fails before publish", async () => {
  const story = goodStory({
    audio_duration: 68.2,
    duration_seconds: 69.2,
    subtitle_timing_source: "synthetic_fallback",
    subtitle_timing_inspection: {
      usable: false,
      reason: "max_gap_too_large",
      maxGapSeconds: 27.7,
      zeroDurationWordRatio: 0.7,
    },
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.includes("subtitle_timing_unusable:max_gap_too_large"),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: deliberate extended Short can pass above Flash Lane ceiling", async () => {
  const story = goodStory({
    audio_duration: 84,
    duration_seconds: 85,
    duration_lane: "pulse_extended_short",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });

  assert.notStrictEqual(qa.result, "fail", JSON.stringify(qa));
  assert.ok(
    !qa.failures.some((f) => f.startsWith("audio_duration_too_long")),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: general Reddit posts cannot invent insider/source attribution", async () => {
  const story = goodStory({
    source_type: "reddit",
    subreddit: "gaming",
    full_script:
      goodStory().full_script +
      " Industry insiders suggest the sequel is now stuck on the back burner.",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });

  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.includes("unsupported_source_claim:community_reddit_attribution"),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: legacy approved direct Reddit media community posts fail preflight", async () => {
  const story = goodStory({
    title: "Came across a much simpler time in gaming today",
    source_type: "reddit",
    subreddit: "gaming",
    article_url: "https://i.redd.it/example.jpeg",
    full_script:
      "Players are revisiting a nostalgic gaming image today. It is a community media post, not a sourced news development, so it should not become a Pulse Gaming news Short. Follow Pulse Gaming so you never miss a beat.",
  });

  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });

  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.includes("community_reddit_media_not_news"),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: coherence gate blocks vague filler and non-exact CTA", async () => {
  const story = goodStory({
    full_script:
      "Nintendo confirmed a new Switch 2 bundle and the price is already locked. The community is buzzing because this raises more questions than answers. Follow Pulse Gaming so you never miss a drop.",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });

  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:missing_exact_cta_in_script"),
    `got: ${qa.failures.join(", ")}`,
  );
  assert.ok(
    qa.failures.includes("script_coherence:vague_filler:community_is_buzzing"),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: coherence gate blocks repeated script sentences", async () => {
  const repeated =
    "Nintendo confirmed the Switch 2 bundle at a fixed price for summer.";
  const story = goodStory({
    full_script: `${repeated} ${repeated} Retailers are listing the bundle with a named game choice and a clear value bump. Follow Pulse Gaming so you never miss a beat.`,
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });

  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.some((f) => f.startsWith("script_coherence:repeated_sentence")),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: coherence gate blocks Subnautica early-access EA misread as Electronic Arts", async () => {
  const story = goodStory({
    title: "2 million copies of Subnautica 2 EA has been sold within 12 hours",
    full_script:
      "Subnautica 2 has sold two million Early Access copies in twelve hours. Electronic Arts has officially confirmed the milestone, according to Reddit. Follow Pulse Gaming so you never miss a beat.",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });

  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.includes("script_coherence:misexpanded_ea_as_electronic_arts"),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: GamingLeaksAndRumours may carry clearly-labelled source language", async () => {
  const story = goodStory({
    source_type: "reddit",
    subreddit: "GamingLeaksAndRumours",
    full_script:
      goodStory().full_script +
      " Sources suggest the timing could move, so treat this as unconfirmed.",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });

  assert.ok(
    !qa.failures.includes("unsupported_source_claim:community_reddit_attribution"),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: legacy approved off-topic entertainment fails topicality recheck", async () => {
  const story = goodStory({
    title: "House of the Dragon Season 3 Trailer and Launch Date Confirmed",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });

  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.includes("pulse_gaming_off_topic_entertainment"),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: gaming adaptation remains review warning, not topicality failure", async () => {
  const story = goodStory({
    title: "Elden Ring Movie Casting Update Names a New Actor",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });

  assert.strictEqual(qa.result, "warn", JSON.stringify(qa));
  assert.ok(
    qa.warnings.includes(
      "topicality_review:gaming_adaptation_needs_manual_review",
    ),
    `got: ${qa.warnings.join(", ")}`,
  );
  assert.ok(
    !qa.failures.some((f) => f.startsWith("pulse_gaming_")),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: pending Studio v2.1 render requires human visual review", async () => {
  const story = goodStory({
    render_engine: "studio-v21",
    human_visual_review_required: true,
    render_review_status: "pending",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
    env: { RENDER_ENGINE: "studio-v21" },
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.includes("human_visual_review_required:studio-v21"),
    `got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: approved Studio v2.1 visual review is allowed through QA", async () => {
  const story = goodStory({
    render_engine: "studio-v21",
    human_visual_review_required: true,
    render_review_status: "approved",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
    env: { RENDER_ENGINE: "studio-v21" },
  });
  assert.strictEqual(qa.result, "pass", JSON.stringify(qa));
});

test("runContentQa: strict local publish rejects local audio without accepted Liam evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-voice-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  const audio = path.join(tmp, "voice.mp3");
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024));
  await fs.writeFile(audio, Buffer.from("fake audio"));
  await fs.writeJson(audio.replace(/\.mp3$/, "_timestamps.json"), {
    characters: ["F", "o", "l", "l", "o", "w"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    meta: {
      provider: "local",
      source: "local-tts-server",
      approvedLocalVoice: true,
      transcript:
        "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
      acoustic: { medianPitchHz: 118 },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -14 },
    },
  });

  try {
    const qa = await runContentQa(goodStory({ exported_path: mp4, audio_path: audio }), {
      env: {
        DEPLOYMENT_MODE: "local",
        AUTO_PUBLISH: "true",
        STUDIO_V2_LOCAL_VOICE_APPROVED: "true",
      },
    });
    assert.strictEqual(qa.result, "fail");
    assert.ok(
      qa.failures.includes("approved_voice:local_tts_voice_reference_unverified"),
      `got: ${qa.failures.join(", ")}`,
    );
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("runContentQa: strict local publish accepts approved Sleepy Liam evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-voice-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  const audio = path.join(tmp, "voice.mp3");
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024));
  await fs.writeFile(audio, Buffer.from("fake audio"));
  await fs.writeJson(audio.replace(/\.mp3$/, "_timestamps.json"), {
    characters: ["F", "o", "l", "l", "o", "w"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    meta: {
      provider: "local",
      source: "local-tts-server",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "a".repeat(40),
      },
      transcript:
        "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
      acoustic: { medianPitchHz: 118 },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -14 },
    },
  });

  try {
    const qa = await runContentQa(goodStory({ exported_path: mp4, audio_path: audio }), {
      env: {
        DEPLOYMENT_MODE: "local",
        AUTO_PUBLISH: "true",
        STUDIO_V2_LOCAL_VOICE_APPROVED: "true",
      },
    });
    assert.strictEqual(qa.result, "pass", JSON.stringify(qa));
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("runContentQa: strict local publish blocks repaired local caption timings", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-voice-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  const audio = path.join(tmp, "voice.mp3");
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024));
  await fs.writeFile(audio, Buffer.from("fake audio"));
  await fs.writeJson(audio.replace(/\.mp3$/, "_timestamps.json"), {
    characters: ["F", "o", "l", "l", "o", "w"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    meta: {
      provider: "local",
      source: "local-tts-server",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "a".repeat(40),
      },
      transcript:
        "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
      acoustic: { medianPitchHz: 118 },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -14 },
      timestampRepair: {
        repaired: true,
        reason: "max_gap_too_large",
      },
    },
  });

  try {
    const qa = await runContentQa(goodStory({ exported_path: mp4, audio_path: audio }), {
      env: {
        DEPLOYMENT_MODE: "local",
        AUTO_PUBLISH: "true",
        STUDIO_V2_LOCAL_VOICE_APPROVED: "true",
      },
    });
    assert.strictEqual(qa.result, "fail");
    assert.ok(
      qa.failures.includes("approved_voice:caption_timing_repaired:max_gap_too_large"),
      `got: ${qa.failures.join(", ")}`,
    );
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("runContentQa: strict local publish blocks repaired local caption timings by default even when usable", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-voice-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  const audio = path.join(tmp, "voice.mp3");
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024));
  await fs.writeFile(audio, Buffer.from("fake audio"));
  await fs.writeJson(audio.replace(/\.mp3$/, "_timestamps.json"), {
    characters: ["F", "o", "l", "l", "o", "w"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    meta: {
      provider: "local",
      source: "local-tts-server",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "a".repeat(40),
      },
      transcript:
        "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
      acoustic: { medianPitchHz: 118 },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -14 },
      timestampRepair: {
        repaired: true,
        reason: "max_gap_too_large",
        repairedInspection: { usable: true, reason: "usable" },
      },
    },
  });

  try {
    const qa = await runContentQa(goodStory({ exported_path: mp4, audio_path: audio }), {
      env: {
        DEPLOYMENT_MODE: "local",
        AUTO_PUBLISH: "true",
        STUDIO_V2_LOCAL_VOICE_APPROVED: "true",
      },
    });
    assert.strictEqual(qa.result, "fail", JSON.stringify(qa));
    assert.ok(
      qa.failures.includes("approved_voice:caption_timing_repaired:max_gap_too_large"),
      `got failures: ${qa.failures.join(", ")}`,
    );
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("runContentQa: strict local publish can opt into warning-only repaired caption timings", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-voice-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  const audio = path.join(tmp, "voice.mp3");
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024));
  await fs.writeFile(audio, Buffer.from("fake audio"));
  await fs.writeJson(audio.replace(/\.mp3$/, "_timestamps.json"), {
    characters: ["F", "o", "l", "l", "o", "w"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    meta: {
      provider: "local",
      source: "local-tts-server",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "a".repeat(40),
      },
      transcript:
        "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
      acoustic: { medianPitchHz: 118 },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -14 },
      timestampRepair: {
        repaired: true,
        reason: "max_gap_too_large",
        repairedInspection: { usable: true, reason: "usable" },
      },
    },
  });

  try {
    const qa = await runContentQa(goodStory({ exported_path: mp4, audio_path: audio }), {
      env: {
        DEPLOYMENT_MODE: "local",
        AUTO_PUBLISH: "true",
        STUDIO_V2_LOCAL_VOICE_APPROVED: "true",
        ALLOW_REPAIRED_CAPTION_TIMING_FOR_PUBLISH: "true",
      },
    });
    assert.strictEqual(qa.result, "warn", JSON.stringify(qa));
    assert.ok(
      qa.warnings.includes("approved_voice:caption_timing_repaired:max_gap_too_large"),
      `got: ${qa.warnings.join(", ")}`,
    );
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("runContentQa: non-strict publish warns on repaired local caption timings", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-voice-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  const audio = path.join(tmp, "voice.mp3");
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024));
  await fs.writeFile(audio, Buffer.from("fake audio"));
  await fs.writeJson(audio.replace(/\.mp3$/, "_timestamps.json"), {
    characters: ["F", "o", "l", "l", "o", "w"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    meta: {
      provider: "local",
      source: "local-tts-server",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "a".repeat(40),
      },
      transcript:
        "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
      acoustic: { medianPitchHz: 118 },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -14 },
      timestampRepair: {
        repaired: true,
        reason: "trailing_caption_gap_too_large",
      },
    },
  });

  try {
    const qa = await runContentQa(goodStory({ exported_path: mp4, audio_path: audio }), {
      env: { DEPLOYMENT_MODE: "production", AUTO_PUBLISH: "true" },
    });
    assert.strictEqual(qa.result, "warn", JSON.stringify(qa));
    assert.ok(
      qa.warnings.includes(
        "approved_voice:caption_timing_repaired:trailing_caption_gap_too_large",
      ),
      `got: ${qa.warnings.join(", ")}`,
    );
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("runContentQa: strict local publish uses full aligned transcript when segment transcript is short", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-voice-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  const audio = path.join(tmp, "voice.mp3");
  const fullTranscript =
    "A clean gaming update. Follow Pulse Gaming so you never miss a beat.";
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024));
  await fs.writeFile(audio, Buffer.from("fake audio"));
  await fs.writeJson(audio.replace(/\.mp3$/, "_timestamps.json"), {
    characters: Array.from(fullTranscript),
    character_start_times_seconds: fullTranscript
      .split("")
      .map((_, index) => index * 0.05),
    character_end_times_seconds: fullTranscript
      .split("")
      .map((_, index) => index * 0.05 + 0.04),
    meta: {
      provider: "local",
      source: "local-tts-server",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        fileName: "pulse_liam_sleepy.wav",
        referencePresent: true,
        referenceHash: "a".repeat(40),
      },
      transcript: "A clean gaming update.",
      acoustic: { medianPitchHz: 118 },
      voiceMastering: { ok: true, code: "voice_mastered", targetLufs: -14 },
    },
  });

  try {
    const qa = await runContentQa(goodStory({ exported_path: mp4, audio_path: audio }), {
      env: {
        DEPLOYMENT_MODE: "local",
        AUTO_PUBLISH: "true",
        STUDIO_V2_LOCAL_VOICE_APPROVED: "true",
      },
    });
    assert.strictEqual(qa.result, "pass", JSON.stringify(qa));
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("runContentQa: strict local publish blocks missing voice sidecar", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-voice-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  const audio = path.join(tmp, "voice.mp3");
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024));
  await fs.writeFile(audio, Buffer.from("fake audio"));

  try {
    const qa = await runContentQa(goodStory({ exported_path: mp4, audio_path: audio }), {
      env: { DEPLOYMENT_MODE: "local", AUTO_PUBLISH: "true" },
    });
    assert.strictEqual(qa.result, "fail");
    assert.ok(qa.failures.includes("approved_voice:metadata_missing"));
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

test("runContentQa: non-strict publish reports voice provenance issues as warnings", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-voice-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  const audio = path.join(tmp, "voice.mp3");
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024));
  await fs.writeFile(audio, Buffer.from("fake audio"));

  try {
    const qa = await runContentQa(goodStory({ exported_path: mp4, audio_path: audio }), {
      env: { DEPLOYMENT_MODE: "production", AUTO_PUBLISH: "true" },
    });
    assert.strictEqual(qa.result, "warn", JSON.stringify(qa));
    assert.ok(qa.warnings.includes("approved_voice:metadata_missing"));
    assert.ok(!qa.failures.includes("approved_voice:metadata_missing"));
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});

// ---------- warnings (don't block) ------------------------------

test("runContentQa: American time format → warn, not fail", async () => {
  const story = goodStory({
    full_script:
      "The reveal lifts at 12:15 PM ET today. " + goodStory().full_script,
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "warn");
  assert.ok(qa.warnings.includes("american_time_format"));
  assert.deepStrictEqual(qa.failures, []);
});

test("runContentQa: only logo image available → warn", async () => {
  const story = goodStory({
    downloaded_images: [{ path: "/tmp/logo.png", type: "company_logo" }],
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "warn");
  assert.ok(qa.warnings.includes("only_logo_image_available"));
});

test("runContentQa: risky article-context dominated deck blocks publish", async () => {
  const story = goodStory({
    downloaded_images: [
      {
        path: "/tmp/article-1.jpg",
        type: "article_inline",
        source: "article",
        thumbnail_safety_warnings: ["article_image_relevance_review"],
      },
      {
        path: "/tmp/article-2.jpg",
        type: "article_inline",
        source: "article",
        thumbnail_safety_warnings: ["article_image_relevance_review"],
      },
      {
        path: "/tmp/article-3.jpg",
        type: "article_inline",
        source: "article",
        thumbnail_safety_warnings: ["article_image_relevance_review"],
      },
      {
        path: "/tmp/article-4.jpg",
        type: "article_inline",
        source: "article",
        thumbnail_safety_warnings: ["article_image_relevance_review"],
      },
      { path: "/tmp/xbox.jpg", type: "wiki_image", source: "wiki" },
    ],
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(
    qa.failures.some((failure) =>
      failure.startsWith("risky_article_context_dominated_deck"),
    ),
    `expected risky article-context failure, got: ${qa.failures.join(", ")}`,
  );
});

test("runContentQa: risky article-context images warn when safer assets support deck", async () => {
  const story = goodStory({
    downloaded_images: [
      {
        path: "/tmp/article-1.jpg",
        type: "article_inline",
        source: "article",
        thumbnail_safety_warnings: ["article_image_relevance_review"],
      },
      {
        path: "/tmp/article-2.jpg",
        type: "article_inline",
        source: "article",
        thumbnail_safety_warnings: ["article_image_relevance_review"],
      },
      {
        path: "/tmp/article-3.jpg",
        type: "article_inline",
        source: "article",
        thumbnail_safety_warnings: ["article_image_relevance_review"],
      },
      { path: "/tmp/steam-hero.jpg", type: "steam_hero", source: "steam" },
      { path: "/tmp/steam-shot.jpg", type: "steam_screenshot", source: "steam" },
      { path: "/tmp/platform.jpg", type: "platform_ui", source: "official" },
    ],
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "warn");
  assert.ok(qa.warnings.includes("risky_article_context_images (3)"));
  assert.ok(
    !qa.failures.some((failure) =>
      failure.startsWith("risky_article_context_dominated_deck"),
    ),
  );
});

test("classifyArticleContextRisk: accepts JSON-string image lists from SQLite rows", () => {
  const images = JSON.stringify([
    {
      path: "/tmp/article-1.jpg",
      type: "article_inline",
      source: "article",
      thumbnail_safety_warnings: ["article_image_relevance_review"],
    },
    {
      path: "/tmp/article-2.jpg",
      type: "article_inline",
      source: "article",
      thumbnail_safety_warnings: ["article_image_relevance_review"],
    },
    {
      path: "/tmp/article-3.jpg",
      type: "article_inline",
      source: "article",
      thumbnail_safety_warnings: ["article_image_relevance_review"],
    },
    {
      path: "/tmp/article-4.jpg",
      type: "article_inline",
      source: "article",
      thumbnail_safety_warnings: ["article_image_relevance_review"],
    },
    { path: "/tmp/hero.jpg", type: "steam_hero", source: "steam" },
  ]);
  const risk = classifyArticleContextRisk(images);
  assert.strictEqual(risk.blocked, true);
  assert.strictEqual(risk.risky_count, 4);
  assert.strictEqual(risk.safe_non_article_count, 1);
});

test("runContentQa: story_card_path set but file missing → warn", async () => {
  const story = goodStory({ story_image_path: "/tmp/card.png" });
  // MP4 exists, card does not.
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "warn");
  assert.ok(qa.warnings.includes("story_card_path_set_but_missing"));
});

test("runContentQa: entity overlay coverage <50% → warn", async () => {
  const story = goodStory({
    mentions_computed: true,
    mentions: [
      { name: "Alex Garland", image_path: "/tmp/alex.jpg", start: 10, end: 11 },
      { name: "Cailee Spaeny", image_path: null, start: 20, end: 21 },
      { name: "Ben Whishaw", image_path: null, start: 30, end: 31 },
    ],
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "warn");
  assert.ok(
    qa.warnings.some((w) => w.startsWith("entity_overlay_coverage_low")),
    `got: ${qa.warnings.join(", ")}`,
  );
});

test("runContentQa: no mentions at all (not a people story) → no warn", async () => {
  const story = goodStory({ mentions_computed: true, mentions: [] });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "pass");
});

// ---------- safety / defensive ----------------------------------

test("runContentQa: null story → fail:no_story", async () => {
  const qa = await runContentQa(null);
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("no_story"));
});

test("runContentQa: regex whitelist sanity — BANNED_STOCK_PHRASES catches the common ones", () => {
  const shouldMatch = [
    "Hey guys, welcome back to the channel",
    "Don't forget to smash that like button",
    "In this video I'll show you",
  ];
  for (const s of shouldMatch) {
    assert.ok(
      BANNED_STOCK_PHRASES.some((re) => re.test(s)),
      `expected banned-phrase match for: ${s}`,
    );
  }
});

test("runContentQa: GLUED_SENTENCE_RE doesn't false-match legitimate abbreviations", () => {
  const legitimate = [
    "U.S. gaming market grew",
    "e.g. Nintendo",
    "i.e. the new console",
    "No period.No space either — this SHOULD match",
  ];
  assert.strictEqual(GLUED_SENTENCE_RE.test(legitimate[0]), false);
  assert.strictEqual(GLUED_SENTENCE_RE.test(legitimate[1]), false);
  assert.strictEqual(GLUED_SENTENCE_RE.test(legitimate[2]), false);
  assert.strictEqual(GLUED_SENTENCE_RE.test(legitimate[3]), true);
});

test("runContentQa: AMERICAN_TIME_RE doesn't match 24h time", () => {
  assert.strictEqual(AMERICAN_TIME_RE.test("at 14:30"), false);
  assert.strictEqual(AMERICAN_TIME_RE.test("at 14:30 UTC"), false);
  assert.strictEqual(AMERICAN_TIME_RE.test("at 2:30 PM"), true);
});

test("DEFAULT_MIN_MP4_BYTES is conservative (200KB)", () => {
  assert.strictEqual(DEFAULT_MIN_MP4_BYTES, 200 * 1024);
});

test("runContentQa: processor script-validation fallback is a hard fail", async () => {
  const story = goodStory({
    body: "Script validation failed. Manual review required before production.",
    script_generation_status: "review_required",
    script_review_reason: "script_validation_failed",
  });
  const qa = await runContentQa(story, {
    fs: fakeFs({ [story.exported_path]: { size: 5 * 1024 * 1024 } }),
  });
  assert.strictEqual(qa.result, "fail");
  assert.ok(qa.failures.includes("script_validation_review_required"));
});

// ---------- real filesystem check ------------------------------
// Single smoke test with a real temp file to confirm the
// production code path works end-to-end with actual fs-extra.

test("runContentQa: real filesystem path — happy case", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-qa-"));
  const mp4 = path.join(tmp, "out.mp4");
  await fs.writeFile(mp4, Buffer.alloc(5 * 1024 * 1024)); // 5MB
  try {
    const story = goodStory({ exported_path: mp4 });
    const qa = await runContentQa(story);
    assert.strictEqual(qa.result, "pass", JSON.stringify(qa));
  } finally {
    await fs.remove(tmp).catch(() => {});
  }
});
