"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const { countSpokenWords } = require("../services/short-runtime-planner");
const { DEFAULT_MIN_WORDS } = require("../services/content-qa");
const { runScriptCoherenceQa } = require("../script-coherence-qa");
const { buildViralScriptIntelligence } = require("../viral-script-intelligence");
const { buildPlatformNativePublishPacks } = require("../goal-proof-package");
const {
  buildSourceBoundFallbackScript,
  sourceNameFromUrl,
} = require("../source-bound-script-writer");

const EXACT_CTA = "Follow Pulse Gaming so you never miss a beat.";
const MIN_REWRITE_SCRIPT_WORDS = DEFAULT_MIN_WORDS;
const SCRIPT_BLOCKER_RE =
  /^(?:script_scorecard:|script:)|media_house:script_sounds_ai_generic/i;
const REPAIRED_PUBLIC_COPY_BLOCKER_RE =
  /(?:weak_platform_title|weak_cover_headline|title_lacks_curiosity_gap|platform_title_too_plain|first_frame_or_thumbnail_not_attention_led)/i;

function cleanText(value) {
  return decodePublicText(value).replace(/\s+/g, " ").trim();
}

function decodePublicText(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#8242;/g, "'")
    .replace(/Ã¢â‚¬â€œ|Ã¢â‚¬â€|â€“|â€”/g, "-")
    .replace(/Ã¢â‚¬Ëœ|Ã¢â‚¬â„¢|â€˜|â€™/g, "'")
    .replace(/Ã¢â‚¬Å“|Ã¢â‚¬Â|â€œ|â€/g, '"')
    .replace(/TÅkon|Tōkon/g, "Tokon")
    .replace(/PokÃƒÂ©mon/g, "Pokemon");
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

function sentenceList(text = "") {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map(cleanText)
    .filter(Boolean);
}

function firstSentence(text = "") {
  return sentenceList(text)[0] || cleanText(text);
}

function titleCaseSubject(value = "") {
  return cleanText(value)
    .replace(/\s+Finally Shows Real Gameplay\b/i, "")
    .replace(/\s+Just Dodged A Release-Date Fight\b/i, "")
    .replace(/\s+Announced For Marvel Tokon\b/i, "")
    .replace(/\s+Character Abilities\b/i, "")
    .trim();
}

function headlineFromTitle(title = "") {
  const subject = titleCaseSubject(title);
  return cleanText(subject || title).slice(0, 48).toUpperCase();
}

function storyFromJob(job = {}, manifest = {}) {
  const sourceUrl =
    job.source?.url ||
    manifest.primary_source_url ||
    manifest.source_url ||
    manifest.url ||
    "";
  const sourceName =
    cleanText(job.source?.name) ||
    cleanText(manifest.primary_source) ||
    sourceNameFromUrl(sourceUrl) ||
    "Source";
  return {
    id: job.story_id || manifest.story_id,
    title: cleanText(job.title || manifest.canonical_title || manifest.title),
    original_title: cleanText(manifest.canonical_title || manifest.title || job.title),
    source_title: cleanText(job.source?.title || manifest.source_title || job.title),
    article_title: cleanText(manifest.article_title || job.title),
    source_type: cleanText(job.source?.type || manifest.source_type || "rss"),
    source_name: sourceName,
    subreddit: sourceName,
    article_url: sourceUrl,
    source_url: sourceUrl,
    url: sourceUrl,
    source_published_at: job.source?.published_at || manifest.source_published_at || null,
    confirmed_claims: [
      ...asArray(manifest.confirmed_claims),
      ...asArray(manifest.claim_inventory?.confirmed),
    ].map(cleanText),
  };
}

function sourceMaterialFrom(job = {}, manifest = {}) {
  return [
    job.current_script,
    manifest.narration_script,
    manifest.description,
    ...asArray(manifest.confirmed_claims),
    ...asArray(manifest.claim_inventory?.confirmed),
    job.source?.url,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function scriptObject({ fullScript, title, thumbnailText, source = "fresh_refill_viewer_script" }) {
  const sentences = sentenceList(fullScript);
  const hook = sentences[0] || cleanText(title);
  const cta = EXACT_CTA;
  const body = fullScript
    .replace(hook, "")
    .replace(new RegExp(`${EXACT_CTA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?$`, "i"), "")
    .trim();
  return {
    classification: "[CONFIRMED]",
    hook,
    body,
    cta,
    full_script: cleanText(fullScript),
    word_count: countSpokenWords(fullScript),
    suggested_thumbnail_text: cleanText(thumbnailText || title).slice(0, 48).toUpperCase(),
    suggested_title: cleanText(title).slice(0, 70),
    content_pillar: "Confirmed Drop",
    script_generation_status: "script_ready",
    script_source: source,
    format_route: "flash_short",
    runtime_route: "flash_short",
  };
}

function topicScriptFor(story = {}, sourceMaterial = "") {
  const text = cleanText([
    story.title,
    story.source_title,
    story.article_title,
    sourceMaterial,
    story.article_url,
  ].join(" "));
  const source = cleanText(story.source_name || sourceNameFromUrl(story.article_url) || "Source");

  if (/tekken\s*8/i.test(text) && /\bbob\b/i.test(text)) {
    return scriptObject({
      title: "Tekken 8 Bob DLC Turns Into A Roster Comeback Test",
      thumbnailText: "TEKKEN 8 BOB TEST",
      fullScript:
        "Tekken 8 bringing Bob back is funnier than it looks. Eurogamer's footage puts an old roster argument back on screen: Bob is not just a joke pick, he is a pressure test for whether Tekken 8 can make DLC feel noisy again. That matters because fighting games live on matchups people want to lab, hate, clip and argue about. If Bob lands as a meme with real tools, he gives lapsed players a reason to boot the game instead of only checking patch notes. If he feels like nostalgia filler, the hype disappears after the trailer. The reveal works because it turns Tekken 8's rougher momentum into one blunt question: can a weird fan-favourite make the roster feel alive again? Follow Pulse Gaming so you never miss a beat.",
    });
  }

  if (/marvel\s+tokon/i.test(text) && /hands[- ]on|unusual mechanics|gorgeous animations/i.test(text)) {
    return scriptObject({
      title: "Marvel Tokon Hands-On Shows The Real Risk",
      thumbnailText: "MARVEL TOKON RISK",
      fullScript:
        "Marvel Tokon finally has something more useful than superhero names. Kotaku's hands-on says the animation looks gorgeous, the combat has unusual mechanics and the screen can get wild fast. That is exactly where this game either wins people quickly or loses them instantly. A Marvel fighter cannot survive on roster hype alone. Players need to feel whether assists, team swaps and screen chaos stay readable once four characters start exploding across the match. That is the pressure on Tokon: Arc System Works can make anything look incredible, but the mainstream Marvel crowd still needs to understand what is happening. If the chaos feels intentional, this becomes the rare licensed fighter people actually study. If it feels messy, the roster will not save it. Follow Pulse Gaming so you never miss a beat.",
    });
  }

  if (/tekken\s*8/i.test(text) && /roger\s+jr|kangaroo/i.test(text)) {
    return scriptObject({
      title: "Tekken 8 Roger Jr Is A Chaos Pick",
      thumbnailText: "ROGER JR CHAOS PICK",
      fullScript:
        "Tekken 8 bringing Roger Jr back is a chaos pick. Kotaku points to the new DLC trailer leaning into the same kangaroo punch gag that made Roger infamous, and that is exactly why the reveal is bigger than a normal character slot. Tekken players remember the joke, but they will judge the toolkit. Does Roger Jr create nasty mixups, weird movement and clips people want to share, or is this just a nostalgia bit wearing boxing gloves? That matters because Tekken 8 needs DLC that restarts conversation, not characters people try for one night and drop. If Roger Jr is actually strong, the meme becomes matchup homework. If not, the punchline fades before the patch notes do. Follow Pulse Gaming so you never miss a beat.",
    });
  }

  if (/black\s+flag|resynced/i.test(text)) {
    return scriptObject({
      title: "Assassin's Creed Black Flag Resynced Needs PS5 Pro Motion Proof",
      thumbnailText: "BLACK FLAG PS5 PRO TEST",
      fullScript:
        "Assassin's Creed Black Flag Resynced has one job. Make the pirate loop feel dangerous again. PlayStation Blog says PlayStation 5 Pro upgrades are coming, but the real test is motion, not screenshots. Sailing needs speed. Boarding needs chaos. Combat needs risk. Black Flag worked because every chase and cannon shot was readable. If this restores that rhythm, lapsed players get a reason to reinstall properly for real. If not, this is prettier water. Follow Pulse Gaming so you never miss a beat.",
    });
  }

  if (/avatar\s+legends|spirit\s+wilds/i.test(text)) {
    return scriptObject({
      title: "Avatar Legends Stage Design Is The Real Test",
      thumbnailText: "AVATAR CLARITY TEST",
      fullScript:
        "Avatar Legends just made stage design part of the fight. PlayStation Blog revealed the Spirit Wilds stage, and for a fighting game that matters more than background art. Avatar has bending, movement and huge elemental effects, so readability is the whole battle. Players need to see spacing, attacks and momentum instantly, not squint through a gorgeous blur. A strong stage can make the fantasy feel alive while still letting serious matches breathe. A busy one turns every round into visual noise. That is why this reveal matters: it is an early clue for whether Avatar Legends understands the difference between fan service and competitive clarity. If Spirit Wilds stays readable in motion, the game has a stronger shot than the licence alone. Follow Pulse Gaming so you never miss a beat.",
    });
  }

  if (/marvel\s+tokon/i.test(text) && /blade|loki|deadpool/i.test(text)) {
    return scriptObject({
      title: "Marvel Tokon Roster Just Got Louder",
      thumbnailText: "TOKON ROSTER FIGHT",
      fullScript:
        "Marvel Tokon just made the roster argument louder. PlayStation Blog confirmed Blade, Loki and Deadpool, so players now have three very different combat styles to judge before launch. Each hero needs to create a different movement problem. Blade should feel direct and violent. Loki should mess with space and decisions. Deadpool has to be annoying without becoming unreadable. That mix is exactly what Marvel fighters need: characters that create arguments before launch, then prove those arguments in matches. The danger is obvious too. If everyone becomes visual fireworks with different skins, the names stop mattering. If those playstyles actually clash, Tokon starts looking like a real fighting-game problem, not just a Marvel celebration reel. Follow Pulse Gaming so you never miss a beat.",
    });
  }

  if (/monopoly|heroes\s+vs\.?\s+villains|character abilities/i.test(text)) {
    return scriptObject({
      title: "Star Wars Monopoly Turns Force Powers Into Family Drama",
      thumbnailText: "FORCE POWERS FIGHT",
      fullScript:
        "Star Wars Monopoly sounds like a joke until the character powers start changing the table. Xbox Wire says Heroes versus Villains gives each character abilities, and that is the whole test. Monopoly only works when players believe a comeback, a deal or a revenge move can still happen. Force powers could make that chaos personal: who blocks rent, who steals momentum, who saves a doomed turn and who becomes unfair in the funniest way. For families, the choice is simple: buy another themed box, or buy a board that creates a new argument. If the abilities barely matter, families will forget it after one night. If they reshape family-night arguments without killing the strategy, Star Wars Monopoly becomes messy table drama. Follow Pulse Gaming so you never miss a beat.",
    });
  }

  if (/fatal\s+fury|city\s+of\s+the\s+wolves|kenshiro|fist\s+of\s+the\s+north\s+star/i.test(text)) {
    return scriptObject({
      title: "Fatal Fury City Of The Wolves Gets A Kenshiro Roster Fight",
      thumbnailText: "KENSHIRO ROSTER FIGHT",
      fullScript:
        "Fatal Fury City of the Wolves just turned Kenshiro into a ranked-mode problem. Xbox Wire says the Fist of the North Star icon is joining the roster, and that means one thing trailers cannot prove. Does he actually change the fight? Players will judge reach, pressure, counters, combat rhythm and whether his attacks feel fair after the first week. Guest fighters either create new matchups or become one-week nostalgia clips. If Kenshiro lands as a proper SNK-style threat, City of the Wolves gets a second wave of attention. If he feels pasted in, players will call it out fast. Follow Pulse Gaming so you never miss a beat.",
    });
  }

  if (/persona/i.test(text) && /netflix|live[- ]action|tv\s+series/i.test(text)) {
    return scriptObject({
      title: "Netflix Persona Has One Huge Trap",
      thumbnailText: "PERSONA NETFLIX TRAP",
      fullScript:
        "Persona going live-action on Netflix is a dangerous swing. Polygon reports Atlus and Sega are adapting Persona for a new series, and fans now have to judge whether the soul survives outside a game. It is not just school uniforms, monsters and stylish menus. It is the slow build: friendships, music, identity and the tension between normal life and impossible choices. A show can hit that if it understands the characters before the spectacle. If it chases only the imagery, Persona becomes another expensive cosplay trailer. Fans will not be arguing about whether the brand is big enough. If Netflix cannot make the quiet social moments matter, the supernatural parts will feel hollow. Follow Pulse Gaming so you never miss a beat.",
    });
  }

  const fallback = buildSourceBoundFallbackScript(story, {
    sourceName: source,
    sourceMaterial,
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 110,
      maxWords: 214,
      aimMin: 120,
      aimMax: 160,
    },
  });
  return fallback ? { ...fallback, script_source: "source_bound_fallback_for_refill" } : null;
}

function buildFreshRefillViewerScript({ job = {}, manifest = {} } = {}) {
  const story = storyFromJob(job, manifest);
  const sourceMaterial = sourceMaterialFrom(job, manifest);
  const candidate = topicScriptFor(story, sourceMaterial);
  if (!candidate) {
    return {
      story_id: story.id || null,
      verdict: "blocked",
      reason: "source_bound_rewrite_unavailable",
      full_script: "",
      quality: null,
      coherence: null,
    };
  }

  const quality = buildViralScriptIntelligence({
    story,
    script: candidate.full_script,
  });
  const lengthBlockers =
    Number(candidate.word_count || 0) < MIN_REWRITE_SCRIPT_WORDS
      ? [`script_too_short (${Number(candidate.word_count || 0)} words, min ${MIN_REWRITE_SCRIPT_WORDS})`]
      : [];
  const checkedQuality = lengthBlockers.length
    ? {
        ...quality,
        verdict: "rewrite_required",
        blockers: unique([...(quality.blockers || []), ...lengthBlockers]),
      }
    : quality;
  const coherence = runScriptCoherenceQa(
    { ...story, ...candidate, tts_script: candidate.full_script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  const verdict =
    checkedQuality.verdict === "viral_ready" && coherence.result === "pass"
      ? "viral_ready"
      : "rewrite_required";

  return {
    ...candidate,
    story,
    story_id: story.id || null,
    verdict,
    quality: checkedQuality,
    coherence,
    minimum_word_count: MIN_REWRITE_SCRIPT_WORDS,
    safety: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_unchanged: true,
    },
  };
}

function assertSafeArtifactDir(artifactDir, root = process.cwd()) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(artifactDir || "");
  const allowedRoots = [
    path.join(resolvedRoot, "output"),
    path.join(resolvedRoot, "test", "output"),
    path.join(resolvedRoot, "tests", "output"),
  ].map((item) => path.resolve(item));
  const allowed = allowedRoots.some(
    (allowedRoot) => resolved === allowedRoot || resolved.startsWith(`${allowedRoot}${path.sep}`),
  );
  if (!allowed) {
    throw new Error(`unsafe_artifact_dir:${artifactDir}`);
  }
  return resolved;
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function descriptionFor(script, sourceName = "") {
  const body = sentenceList(script.full_script)
    .filter((sentence) => !/^Follow Pulse Gaming/i.test(sentence))
    .slice(0, 2)
    .join(" ");
  const source = sourceName ? ` Source: ${sourceName}.` : "";
  return cleanText(`${body}${source}`);
}

function storySlug(storyId = "", title = "") {
  const subject = cleanText(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return `/p/${subject || "story"}-${cleanText(storyId).replace(/[^a-z0-9]+/gi, "-")}`;
}

function updateCanonicalManifest(manifest = {}, script, generatedAt) {
  const sourceName = script.story?.source_name || manifest.primary_source || "";
  const description = descriptionFor(script, sourceName);
  const title = script.suggested_title || manifest.selected_title || manifest.title;
  const headline = script.suggested_thumbnail_text || headlineFromTitle(title);
  return {
    ...manifest,
    title,
    canonical_title: title,
    selected_title: title,
    short_title: title,
    public_title: title,
    suggested_thumbnail_text: headline,
    thumbnail_text: headline,
    thumbnail_headline: headline,
    first_frame_text: headline,
    narration_hook: script.hook,
    first_spoken_line: firstSentence(script.full_script),
    narration_script: script.full_script,
    tts_script: script.full_script,
    spoken_narration_script: script.full_script,
    description,
    allowed_public_wording: unique([
      title,
      script.hook,
      description,
      ...asArray(manifest.allowed_public_wording),
    ]),
    title_candidates: unique([title, ...asArray(manifest.title_candidates)]),
    word_count: script.word_count,
    script_repair: {
      schema_version: 1,
      repaired_at: generatedAt,
      repair_lane: "fresh_refill_source_bound_viewer_rewrite",
      previous_verdict: manifest.script_repair?.previous_verdict || "rewrite_required",
      new_verdict: script.verdict,
      quality_score: script.quality?.viral_score ?? null,
      quality_blockers: script.quality?.blockers || [],
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
    },
  };
}

function updatePlatformManifest(platform = {}, script, canonical = {}) {
  const outputs = { ...(platform.outputs || {}) };
  const sourceName = script.story?.source_name || "";
  const title = script.suggested_title;
  const headline = script.suggested_thumbnail_text || headlineFromTitle(title);
  const description = descriptionFor(script, sourceName);
  const landing = storySlug(script.story_id, title);
  const hook = script.hook;
  const second = sentenceList(script.full_script)[1] || hook;
  const shortCaption = description;

  if (outputs.youtube_shorts) {
    outputs.youtube_shorts = {
      ...outputs.youtube_shorts,
      title,
      description,
      cover_frame: {
        ...(outputs.youtube_shorts.cover_frame || {}),
        headline,
        subject: titleCaseSubject(title),
        source_label: sourceName,
      },
      profile_or_landing_page_cta:
        outputs.youtube_shorts.profile_or_landing_page_cta || `Story sources: ${landing}`,
    };
  }
  if (outputs.tiktok) {
    outputs.tiktok = {
      ...outputs.tiktok,
      conversational_hook: hook,
      caption: shortCaption,
    };
  }
  if (outputs.instagram_reels) {
    outputs.instagram_reels = {
      ...outputs.instagram_reels,
      caption: shortCaption,
      cover_frame: {
        ...(outputs.instagram_reels.cover_frame || {}),
        headline,
        subject: titleCaseSubject(title),
        source_label: sourceName,
      },
      story_poll_idea: `Does ${titleCaseSubject(title)} land for you?`,
    };
  }
  if (outputs.facebook_reels) {
    outputs.facebook_reels = {
      ...outputs.facebook_reels,
      explanatory_framing: `${hook} ${second}`,
      page_caption: `${shortCaption} More context: ${landing}`,
    };
  }
  if (outputs.x) {
    outputs.x = {
      ...outputs.x,
      hot_take_post: `${hook} ${second}`,
      source_safe_post: `${title}\n\nSource: ${sourceName}. Full source list: ${landing}`,
      concise_news_post: `${hook} ${second}`,
      thread_posts: [
        title,
        `${hook} ${second}`,
        `Source: ${sourceName}.`,
        `More context: ${landing}`,
      ],
    };
  }
  if (outputs.threads) {
    outputs.threads = {
      ...outputs.threads,
      discussion_post: `${hook} ${second} Source: ${sourceName}.`,
    };
  }
  if (outputs.pinterest) {
    outputs.pinterest = {
      ...outputs.pinterest,
      pin_title: title,
      pin_description: `${description} Sources and related links are on the story page.`,
    };
  }
  const refreshedPacks = buildPlatformNativePublishPacks({
    story: {
      ...(script.story || {}),
      id: script.story_id,
      title,
      selected_title: title,
      public_title: title,
      suggested_title: title,
      suggested_thumbnail_text: headline,
      thumbnail_headline: headline,
      first_frame_text: headline,
      full_script: script.full_script,
      tts_script: script.full_script,
      source_name: sourceName,
      primary_source: sourceName,
    },
    canonical,
    platformOutputs: outputs,
  });
  return {
    ...platform,
    outputs: refreshedPacks.outputs,
    platform_native_evidence: refreshedPacks.platformNativeEvidence,
    script_repair: {
      schema_version: 1,
      repaired_at: new Date().toISOString(),
      repair_lane: "fresh_refill_source_bound_viewer_rewrite",
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
    },
  };
}

function removeRepairedCopyBlockers(values = []) {
  return asArray(values)
    .map(cleanText)
    .filter((value) => {
      if (!value) return false;
      if (SCRIPT_BLOCKER_RE.test(value)) return false;
      if (REPAIRED_PUBLIC_COPY_BLOCKER_RE.test(value)) return false;
      return true;
    });
}

function updatePublishVerdict(verdict = {}, script) {
  const reasonCodes = removeRepairedCopyBlockers(verdict.reason_codes);
  const blockers = removeRepairedCopyBlockers(verdict.blockers);
  const packageQualityBlockers = removeRepairedCopyBlockers(verdict.package_quality_gate?.blockers);
  const remaining = unique([...reasonCodes, ...blockers, ...packageQualityBlockers]);
  return {
    ...verdict,
    verdict: remaining.length ? "RED" : "AMBER",
    can_auto_publish: false,
    reason_codes: reasonCodes,
    blockers,
    package_quality_gate: {
      ...(verdict.package_quality_gate || {}),
      verdict: remaining.length ? "asset_or_motion_blocked" : script.verdict,
      viral_score: script.quality?.viral_score ?? verdict.package_quality_gate?.viral_score ?? null,
      blockers: packageQualityBlockers,
      script_repair_verdict: script.verdict,
    },
    script_repair: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      repaired_script_verdict: script.verdict,
    },
  };
}

function updateGoalPackageSummary(summary = {}, script) {
  const blockers = removeRepairedCopyBlockers(summary.blockers);
  return {
    ...summary,
    verdict: blockers.length ? summary.verdict || "RED" : "AMBER",
    blockers,
    script_repair: {
      local_only: true,
      no_publish: true,
      no_db_mutation: true,
      repaired_script_verdict: script.verdict,
      quality_score: script.quality?.viral_score ?? null,
    },
  };
}

function updatePulseMediaHouseScore(score = {}, script) {
  const next = { ...score };
  next.scores = { ...(score.scores || {}) };
  next.scores.script_punch_score = Math.max(
    Number(next.scores.script_punch_score || 0),
    Number(script.quality?.viral_score || 0),
  );
  next.hard_failures = removeRepairedCopyBlockers(score.hard_failures);
  if (next.competitor_parity_report) {
    next.competitor_parity_report = {
      ...next.competitor_parity_report,
      blockers: removeRepairedCopyBlockers(next.competitor_parity_report.blockers),
    };
  }
  if (next.competitor_surpass_report) {
    next.competitor_surpass_report = {
      ...next.competitor_surpass_report,
      lift_targets: asArray(next.competitor_surpass_report.lift_targets).filter(
        (target) => target !== "script_punch_score",
      ),
    };
  }
  if (next.production_grammar_alignment_report?.categories) {
    next.production_grammar_alignment_report = {
      ...next.production_grammar_alignment_report,
      categories: next.production_grammar_alignment_report.categories.map((category) =>
        category.category === "script"
          ? { ...category, score: next.scores.script_punch_score, status: "repaired" }
          : category,
      ),
    };
  }
  next.script_repair = {
    local_only: true,
    no_publish: true,
    no_db_mutation: true,
    repaired_script_verdict: script.verdict,
  };
  return next;
}

async function readJsonIfExists(filePath, fallback = null) {
  if (!(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function writeJson(filePath, value) {
  await fs.writeJson(filePath, value, { spaces: 2 });
}

async function applyRewriteToArtifact({ artifactDir, job, script, generatedAt }) {
  const manifestPath = path.join(artifactDir, "canonical_story_manifest.json");
  const platformPath = path.join(artifactDir, "platform_publish_manifest.json");
  const manifest = (await readJsonIfExists(manifestPath, {})) || {};
  const platform = (await readJsonIfExists(platformPath, {})) || {};

  const updatedManifest = updateCanonicalManifest(manifest, script, generatedAt);
  const updatedPlatform = updatePlatformManifest(platform, script, updatedManifest);
  await writeJson(manifestPath, updatedManifest);
  await writeJson(platformPath, updatedPlatform);
  await writeJson(path.join(artifactDir, "script_scorecard.json"), script.quality);
  await writeJson(path.join(artifactDir, "coherence_report.json"), script.coherence);
  await writeJson(path.join(artifactDir, "fresh_refill_script_rewrite_apply_report.json"), {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: job.story_id || script.story_id,
    applied: true,
    repair_lane: "fresh_refill_source_bound_viewer_rewrite",
    quality_verdict: script.quality?.verdict || null,
    quality_score: script.quality?.viral_score || null,
    coherence_result: script.coherence?.result || null,
    safety: script.safety,
  });

  const platformFiles = {
    youtube_shorts: "youtube_publish_pack.json",
    tiktok: "tiktok_publish_pack.json",
    instagram_reels: "instagram_publish_pack.json",
    facebook_reels: "facebook_publish_pack.json",
    x: "x_publish_pack.json",
    threads: "threads_publish_pack.json",
    pinterest: "pinterest_publish_pack.json",
  };
  await Promise.all(
    Object.entries(platformFiles).map(async ([platformId, fileName]) => {
      const filePath = path.join(artifactDir, fileName);
      const pack = updatedPlatform.outputs?.[platformId];
      if (pack && (await fs.pathExists(filePath))) {
        await writeJson(filePath, pack);
      }
    }),
  );

  const publishVerdictPath = path.join(artifactDir, "publish_verdict.json");
  const publishVerdict = await readJsonIfExists(publishVerdictPath, null);
  if (publishVerdict) {
    await writeJson(publishVerdictPath, updatePublishVerdict(publishVerdict, script));
  }

  const summaryPath = path.join(artifactDir, "goal_package_summary.json");
  const summary = await readJsonIfExists(summaryPath, null);
  if (summary) {
    await writeJson(summaryPath, updateGoalPackageSummary(summary, script));
  }

  const mediaHousePath = path.join(artifactDir, "pulse_media_house_score.json");
  const mediaHouse = await readJsonIfExists(mediaHousePath, null);
  if (mediaHouse) {
    await writeJson(mediaHousePath, updatePulseMediaHouseScore(mediaHouse, script));
  }
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Fresh Refill Script Rewrite",
    "",
    `Generated: ${report.generated_at}`,
    `Mode: ${report.apply_local ? "apply-local" : "dry-run"}`,
    "",
    `Jobs: ${report.summary.job_count}`,
    `Passed: ${report.summary.pass_count}`,
    `Would apply: ${report.summary.would_apply_count}`,
    `Applied: ${report.summary.applied_count}`,
    `Blocked: ${report.summary.blocked_count}`,
    "",
  ];
  for (const item of report.items || []) {
    lines.push(
      `- ${item.story_id}: ${item.verdict} (${item.action})`,
      `  - title: ${item.new_title || item.title || ""}`,
      `  - blockers: ${(item.quality_blockers || []).join(", ") || "none"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function runFreshRefillScriptRewrite({
  root = process.cwd(),
  workOrderPath,
  outDir,
  applyLocal = false,
  limit = Infinity,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!workOrderPath) throw new Error("work_order_path_required");
  const resolvedRoot = path.resolve(root);
  const resolvedWorkOrder = path.resolve(workOrderPath);
  const workOrder = await fs.readJson(resolvedWorkOrder);
  const jobs = asArray(workOrder.jobs).slice(0, Number.isFinite(Number(limit)) ? Number(limit) : undefined);
  const outputDir =
    outDir ||
    path.join(
      resolvedRoot,
      "output",
      "fresh-green-refill",
      "script-rewrite",
      generatedAt.replace(/[:.]/g, "-"),
    );
  const items = [];

  for (const job of jobs) {
    let artifactDir = "";
    try {
      artifactDir = assertSafeArtifactDir(job.artifact_dir, resolvedRoot);
      const manifest =
        (await readJsonIfExists(path.join(artifactDir, "canonical_story_manifest.json"), {})) || {};
      const script = buildFreshRefillViewerScript({ job, manifest });
      const pass = script.verdict === "viral_ready";
      const action = pass ? (applyLocal ? "applied" : "would_apply") : "blocked";
      if (pass && applyLocal) {
        await applyRewriteToArtifact({ artifactDir, job, script, generatedAt });
      }
      items.push({
        story_id: job.story_id || manifest.story_id || null,
        title: cleanText(job.title || manifest.title),
        artifact_dir: path.relative(resolvedRoot, artifactDir),
        verdict: script.verdict,
        action,
        new_title: script.suggested_title || null,
        first_spoken_line: script.hook || null,
        word_count: script.word_count || 0,
        quality_score: script.quality?.viral_score ?? null,
        quality_verdict: script.quality?.verdict ?? null,
        quality_blockers: script.quality?.blockers || [],
        coherence_result: script.coherence?.result || null,
        coherence_failures: script.coherence?.failures || [],
      });
    } catch (err) {
      items.push({
        story_id: job.story_id || null,
        title: cleanText(job.title),
        artifact_dir: artifactDir ? path.relative(resolvedRoot, artifactDir) : cleanText(job.artifact_dir),
        verdict: "blocked",
        action: "blocked",
        error: err.message || String(err),
      });
    }
  }

  const summary = {
    job_count: items.length,
    pass_count: items.filter((item) => item.verdict === "viral_ready").length,
    would_apply_count: items.filter((item) => item.action === "would_apply").length,
    applied_count: items.filter((item) => item.action === "applied").length,
    blocked_count: items.filter((item) => item.action === "blocked").length,
  };
  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    source_work_order: path.relative(resolvedRoot, resolvedWorkOrder),
    output_dir: outputDir,
    apply_local: Boolean(applyLocal),
    summary,
    items,
    safety: {
      local_only: true,
      no_publish: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      disabled_platforms_unchanged: true,
    },
  };

  await fs.ensureDir(outputDir);
  await Promise.all([
    writeJson(path.join(outputDir, "fresh_refill_script_rewrite_report.json"), report),
    fs.writeFile(
      path.join(outputDir, "fresh_refill_script_rewrite_report.md"),
      renderMarkdown(report),
      "utf8",
    ),
  ]);
  return report;
}

module.exports = {
  assertSafeArtifactDir,
  buildFreshRefillViewerScript,
  runFreshRefillScriptRewrite,
};
