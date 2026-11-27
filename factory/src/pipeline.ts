// The factory: one idempotent state machine advanced by a periodic tick.
// Each step reads its inputs from Postgres/disk and writes its outputs before
// the status moves, so any step can crash and be retried safely.

import { captureCtr, ctrCaptureDue, type ReachClient } from "./reach.ts";
import { packBeforeUpload, pickHookWords, rankTitles } from "./packaging/lab.ts";
import { loadModel } from "./packaging/score.ts";
import { strandThumbWords, strandTitleProblems } from "./strandframe.ts";
import { runSecondChance } from "./packaging/secondchance.ts";
import { packagingAtLeast } from "./packaging/settings.ts";
import { openSession, growFromSteam, growFromResearch, growFromArticles } from "./factvault/session.ts";
import { applyFixes as applyVaultFixes, type Fix as VaultFix } from "./factvault/check.ts";
import { repairBlockers } from "./factrepair.ts";
import { longWords, repairLongform } from "./longrepair.ts";
import { disciplineChapter, docFactLine } from "./docfacts.ts";
import { countedTitle, disciplineLongform, preFlagFeedback, titleClaimsEvery } from "./editorial/longfacts.ts";
import { pickThumbImage, shortThumbArm, thumbWords } from "./shortthumb.ts";
import { coverWorth, scoreAesthetics } from "./assets/appleaesthetics.ts";
import { searchLine, searchTermsFor } from "./searchterms.ts";
import type { renderShortThumb } from "./render/render.ts";
import { firstComment, shortComment, strictShortComment } from "./social/firstcomment.ts";
import { pollBlock, readPoll } from "./social/poll.ts";
import {
  selectWhyTopic,
  whyCandidates,
  whyAnswerProblems,
  whyFollowProblems,
  whyFreshProblems,
  whyHookProblems,
  whyPinnedLine,
  whySlug,
} from "./editorial/why.ts";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { COVER_FILE, SOCIAL_FILE } from "./social/cover.ts";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { withLease } from "./db.ts";
import {
  INHERIT_MINUTES,
  longRenderMinutes,
  PcTurnTimeout,
  shortWindows,
} from "./pcschedule.ts";
import type { Llm } from "./editorial/llm.ts";
import type { StoryCluster } from "./discovery/cluster.ts";
import { thinSourceProblem, type ArticleText } from "./discovery/article.ts";
import type { Narration } from "./voice/elevenlabs.ts";
import type { VisualAsset, SteamApp, SteamFacts } from "./assets/steam.ts";
import { factsText } from "./assets/steam.ts";
import { steamEditionOf } from "./assets/steamedition.ts";
import { namedSubjects } from "./assets/namedart.ts";
import { pictureKey } from "./render/stillcap.ts";
import { capFootage, defaultFootageSeconds, footageBudgetSeconds } from "./assets/footage.ts";
import { targetsFor, type FootageTarget } from "./assets/clipscore.ts";
import type { OfficialMedia } from "./assets/officialTrailer.ts";
import { cutsceneBudgetSeconds, cutscenePublisher, gatherCutsceneSources, reconcileCutsceneBudgets, type CutsceneClip, type CutsceneJob } from "./assets/cutscenes.ts";
import { hasUsableIndex } from "./sceneindex/footage.ts";
import { backgroundFor, embedderFor } from "./semantic/hook.ts";
import { pinChapterMoments, pinShortStills, type ShortPins } from "./semantic/stills.ts";
import { gamesOfScript, requestSceneIndexes } from "./sceneindex/job.ts";
import { hasSpoilerWarning, spoilerProblems as storySpoilerProblems, spoilerWindows, windowFor } from "./sceneindex/spoilers.ts";
import {
  adSafeGateProblems,
  checkFirstSeconds,
  chooseOpening,
  coverProblem,
  lookOpeningFrame,
  openingCaption,
} from "./openingstep.ts";
import { streamClipSpoiler } from "./sceneindex/spoilerclips.ts";
import type { RadarGame, FreeGame } from "./discovery/weekly.ts";
import { rarest, type Achievement } from "./discovery/achievements.ts";
import {
  EVERGREEN_MIN_SECONDS,
  ACHIEVEMENT_ENTRIES,
  ACHIEVEMENT_FORMATS,
  achievementProblems,
  evergreenToScript,
  selectEvergreenTopic,
  validateEvergreen,
  writeEvergreen,
  type EvergreenCandidate,
  type EvergreenTopic,
} from "./editorial/evergreen.ts";
import {
  longformToScript,
  selectLongformTopic,
  validateLongform,
  narrationOfLongform,
  rankingRules,
  writeLongform,
} from "./editorial/longform.ts";
import { trailerMatchesGame } from "./assets/commons.ts";
import { captureHold } from "./capture.ts";
import { rankStills } from "./assets/stillscore.ts";
import { PUBLISHER_CHANNELS } from "./assets/officialTrailer.ts";
import { coverageShare, fillSentencePictures } from "./assets/fill.ts";
import {
  footageShareNotice,
  measureFootage,
  runFootageFirst,
} from "./assets/footagestep.ts";
import { footageOptions } from "./assets/footagefirst.ts";
import { capStockTargets } from "./assets/repeats.ts";
import { stockCredit, stockCreditLines, stockQuery } from "./assets/stock.ts";
import {
  isPressProvenance,
  photoCreditLine,
  photoCreditOf,
  photoProvenance,
  photoSourcesLine,
} from "./assets/libraries.ts";
import { pressForShort, reportLibraries } from "./assets/librarystep.ts";
import { createSketchRun, sketchReachable } from "./assets/illustrate.ts";
import {
  animateSketches,
  chooseEpisodeFillers,
  episodeClipCheck,
} from "./assets/fillerstep.ts";

/** The share of a long video's sentences that should have a picture, clip or graphic of their own. */
export const MEDIA_RICH_TARGET = 0.85;
import { makeMeshes, makeParallax, LAYERED_KINDS, SHORT_DEPTH_MAX, shortDepthArm, shortDepthWanted } from "./render/parallax.ts";
import { planBlender, fetchBlenderClips, type BlenderClip } from "./render/blender.ts";
import { appleCut, readBoxes, smartCrop } from "./assets/applevision.ts";
import { frameTarget } from "./render/smartcrop.ts";
import {
  depthDeps,
  meshStills,
  upscaleOldFootage,
  upscaleOldStills,
} from "./depthstep.ts";
import { annotationLabel, locate } from "./assets/annotate.ts";
import { unloadLocalVision } from "./assets/localvision.ts";
import {
  tightenPauses,
  chapterGaps,
  gapSpans,
  insertSilence,
  openWords,
} from "./voice/pauses.ts";
import { quietBeatGaps } from "./voice/quietbeats.ts";
import { soundDesignLine, soundDesignSummary } from "./render/sounddesign.ts";
import { GAME_UNDER, soundCraftLine } from "./render/soundfx.ts";
import { prepareSoundCraft, type SoundCraftPrep } from "./render/voicefx.ts";

/** Seconds of breather before each documentary chapter: narrator silent, music up, the chapter's title full screen. */
const DOC_BREAK_SECONDS = 4;
import { sentencesOf } from "./editorial/longform.ts";
import {
  pickPhotos,
  selectDocTopic,
  outlineDoc,
  writeChapter,
  chapterRefusal,
  DOC_CHAPTER_SOURCE_CHARS,
  DOC_OUTLINE_SOURCE_CHARS,
  DOC_WIDE_SOURCE_CHARS,
  checkChapter,
  checkChapterItems,
  groundCallouts,
  validateChapter,
  chapterRuleProblems,
  narrationOfDoc,
  writeBookends,
  validateBookends,
  docToScript,
  writeDocMoments,
  groundDocMoments,
  type DocMoment,
  docWordCount,
  DOC_WORDS_MIN,
  DOC_WORDS_MAX,
  type DocTopic,
  type DocDraft,
  placeDocLoops,
  loopsOfScript,
} from "./editorial/documentary.ts";
import { groundOpenLoops, openLoopsLine } from "./editorial/openloops.ts";
import {
  chooseLongformTopic,
  loopsWithoutChapter,
  pollWinnerOf,
  refusedChapterFate,
  sameSeries,
} from "./editorial/longrescue.ts";
import {
  LONG_RULE_REVISIONS,
  writerNoteProblems,
  hookStackProblems,
  longRulesFor,
  longRulesOn,
  longRuleWarnings,
  scriptMeasures,
} from "./editorial/longrules.ts";
import { openingPace, structureLine, structureSummary } from "./render/structure.ts";
import { contractRules, openingQuotes, recordLongChecks, type LongRecord } from "./longcontractstep.ts";
import { stockOpenerProblems, takeProblems, takesGuard } from "./editorial/longcontract.ts";
import { groundFinishLine, type OpenLoop } from "./editorial/openloops.ts";
import {
  DOC_CHECKPOINT_VERSION,
  clearDocCheckpoint,
  docTopicKey,
  loadDocCheckpoint,
  pruneDocCheckpoints,
  relinkPlans,
  saveDocCheckpoint,
  type DocCheckpoint,
} from "./editorial/doccheckpoint.ts";
import { wholeLineFiller } from "./render/fillerplan.ts";
import {
  longCraft,
  longCraftEvent,
  longKindLabel,
  loopsFor,
} from "./longformat.ts";
import {
  packageRecap,
  recapToScript,
  validateRecapChapter,
  writeRecapBookends,
  writeRecapChapter,
  RECAP_STORIES_MAX,
  RECAP_STORIES_MIN,
  type RecapStory,
} from "./editorial/recap.ts";
import {
  selectExplainedEpisode,
  stepScriptExplained,
} from "./explainedstep.ts";
import { seriesCoverOf, seriesTagOf } from "./seriescover.ts";
import {
  recentVerdicts,
  stepScriptVerdict,
  verdictCluster,
  verdictSelection,
} from "./verdictstep.ts";
import type { ExplainedStory } from "./editorial/explained.ts";
import { recordWeeklyArm, weeklyArm, weeklyVerdict, fallbackNotice } from "./weeklytest.ts";
import {
  buildLongPlan,
  chapterPictureAudit,
  momentKeys,
  planGaps,
  openChaptersAtBreaks,
  momentWindows,
  LONG_FPS,
  chapterLines,
  LONG_TAIL_SECONDS,
  entryOf,
  realWorldImage,
  splitSentences,
} from "./render/longplan.ts";
import { markGameMaps, stageGameMaps } from "./assets/gamemaps.ts";
import type { LongRenderInput, LongStillsInput } from "./render/render.ts";
import { motifPictureOrder } from "./render/motifpictures.ts";
import { heroLook } from "./assets/localvision.ts";
import { repairPictures, thumbOutcome } from "./qa/thumbrepair.ts";
import {
  artVerdict,
  cutoutProblems,
  heroRuleDesigns,
  designProblems,
  heroRuleFallback,
  posterProblems,
} from "./qa/thumbrule.ts";
import type { renderCutdown, renderGameplayShort } from "./render/render.ts";
import {
  blackSpans,
  cleanLine,
  directClip,
  directCut,
  directFilter,
  directFrames,
  directProblems,
  directTiming,
  DIRECT_MIN_WPM,
  fitLines,
  loopLeadIn,
  loopDangles,
  loopRepeatsHook,
} from "./gameplaydirect.ts";
import { dayNOverlay } from "./hudreader/dayn.ts";
import { clipFacts, profileFor } from "./hudreader/job.ts";
import {
  CUTDOWN_TAIL_SECONDS,
  cutdownRanks,
  cutdownScript,
  cutdownWindow,
  wordsIn,
  writeCutdownCopy,
} from "./editorial/cutdown.ts";
import { FFMPEG, FFPROBE } from "./lib/bin.ts";
import {
  FUNNEL_TAIL_SECONDS,
  funnelCta,
  funnelKind,
  funnelLine,
  funnelParent,
  chapterBeats,
  funnelArm,
  funnelPicks,
  funnelScript,
  funnelWindow,
  mixFunnelLine,
  writeFunnelCopy,
} from "./funnel.ts";
import { cutPortrait } from "./assets/localvision.ts";
import { normTitle } from "./assets/igdb.ts";
import type { RenderInput } from "./render/render.ts";
import type { TechQa } from "./qa/media.ts";
import type { FactCheck, VisionQa } from "./editorial/schema.ts";
import { narrationSummary, type NarrationCheck } from "./qa/narration.ts";
import type { YouTubeClient } from "./youtube/upload.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { COLOURS } from "./approval/discord.ts";
import {
  selectStory,
  writeScript,
  factCheck,
  cardText,
  factCheckRanking,
  validateScript,
  WORDS_MIN,
  WORDS_MAX,
} from "./editorial/editorial.ts";
import {
  friendPassOn,
  friendPass,
  friendShort,
  friendShortProblems,
  friendChapter,
  friendChapterProblems,
  newProblems,
  shortText,
  friendCheckVerdict,
  shortSettledText,
} from "./editorial/friendpass.ts";
import {
  humaniseShort,
  humaniseShortProblems,
  humaniseChapter,
  humaniseDrift,
} from "./editorial/humanise/humanise.ts";
import { humaniseStep } from "./humanisestep.ts";
import { anatomyPictures, explainersOn, explainerTexts, longExplainersStep, shortExplainersStep } from "./explainerstep.ts";
import {
  clarityGate,
  clarityLog,
  judgeClarity,
  clarityRewriteShort,
  clarityShortProblems,
  clarityRewriteChapter,
  clarityChapterProblems,
  shortLines,
} from "./editorial/clarity.ts";
import {
  narrationOf,
  tidyLoopLine,
  wordCount,
  type Script,
} from "./editorial/schema.ts";
import { translateMetadata } from "./editorial/localize.ts";
import { hotBlock, readHotTopic, watchHits } from "./hits.ts";
import type { Deal } from "./discovery/deals.ts";
import { trendingBlock } from "./discovery/demand.ts";
import { screenFrames } from "./assets/localvision.ts";
import { isVisionPaused, whenVisionPaused } from "./assets/visionrelay.ts";
import { readRequests, requestsBlock } from "./social/requests.ts";
import {
  buildTags,
  tagChars,
  hashtags,
  keywordLead,
  pinnedComment,
  polishTitle,
  thumbTitle,
} from "./editorial/seo.ts";
import {
  affiliateBlock,
  affiliateCommentLine,
  type AffiliateTags,
} from "./editorial/affiliate.ts";
import { pickVoice, speedUp } from "./voice/index.ts";
import { withAlertScope } from "./alertlog.ts";
import { withYtPriority, type YtPriority } from "./lib/ytguard.ts";
import {
  turnDownBreaths,
  voiceProblems,
  wordsPerMinute,
} from "./voice/breathcheck.ts";
import { speakable, speakContext } from "./voice/speakable.ts";
import {
  pronunciationPlan,
  recordUnknown,
  unknownFile,
} from "./voice/pronounce.ts";
import {
  buildSegments,
  srtFromWords,
  type Segment,
  type SegmentInput,
} from "./render/timeline.ts";
import { buildPlan, TAIL_SECONDS, MAX_SFX } from "./render/plan.ts";
import { readShortMemory, restoreV3Sound, shapeShort, soundShort, soundStepDue } from "./untemplatestep.ts";
import { planPanelStep } from "./planpanelstep.ts";
import { frameFocusStep } from "./framefocusstep.ts";
import { leadFrames, LEVEL, MOOD_BEDS, SFX, sfxFile } from "./render/soundscape.ts";
import { BEDS } from "./render/soundscape.ts";
import { bedSeed, chooseBed } from "./render/bedrotation.ts";
import { shortMusic, signatureFor, signatureSeriesOf, withSignatureSting } from "./render/signature.ts";
import { SIGNATURE_LIBRARY } from "./render/signaturelib.ts";
import { ACE_LIBRARY } from "./render/acebedlib.ts";
import { aceExtraBeds, aceIdent, acePool, aceShortMood, withIdent } from "./render/acebeds.ts";
import { cameraNotice } from "./render/camera.ts";
import { findTextDetails } from "./assets/ocr.ts";
import { formatOpen } from "./formats.ts";
import { blurPlate, meanLuma } from "./assets/plates.ts";
import { framedStills, prepareImages, remoteAsk } from "./gpuvis/client.ts";
import { thumbCandidateStep } from "./gpuvis/thumbstep.ts";
import { TIGHT_CAP_SECONDS } from "./assets/officialTrailer.ts";
import { cardWindow } from "./render/shortcraft.ts";
import { CLIP_DETAIL_FLOOR_KB, clipDetailKb, stillBigText } from "./assets/cliptext.ts";
import { framesNeeded } from "./qa/mediarich.ts";
import {
  argumentArm,
  cardFigureProblems,
  eraConflict,
  lineNamesLaterVersion,
  sourceTag,
  endingProblems,
  videoPlugProblems,
  nextLineProblems,
  nextLineRule,
  evergreenRuleNote,
  shortRuleNote,
  thinProblems,
  absenceProblems,
  preorderProblems,
} from "./editorial/shortrules.ts";
import { scorePlan, rubricSummary } from "./qa/rubric.ts";
import {
  captureMetrics,
  captureRetention,
  hookLessons,
  longLessons,
  captureCurves,
  captureReach,
  reachAlert,
  performanceNotes,
  retentionNotes,
  socialLessons,
  visualLessons,
} from "./analytics.ts";
import {
  guessKind,
  loopLessonLines,
  loopWeights,
  pickWeight,
  strongFandom,
  withoutFandomWeight,
} from "./loopfeedback.ts";
import {
  captureCalls,
  writerRecord,
  writerSplit,
  type WriterProvider,
} from "./editorial/authorship.ts";
import { siteListed, withCodexCap, withRoute } from "./editorial/codex.ts";
import type { UsageLine } from "./editorial/llm.ts";
import { retentionLearnTick } from "./retentionlearn.ts";
import { directorStep, retrainTick } from "./retentionstep.ts";
import {
  REPLY_LIMITS,
  factsText as replyFacts,
  filedQuestions,
  hookForRepetition,
  pickQuestion,
  replyCluster,
  replyDescriptionLine,
  replyProblems,
  repliesToday,
  usedComments,
} from "./commentreply.ts";
import { accessToken, storedRefreshToken } from "./youtube/oauth.ts";

/** The stored login's settings for RETENTION_LEARN's scope check: no .env fallback, so the env token is never judged. */
function learnOauth(cfg: Config) {
  return {
    clientId: cfg.googleClientId,
    clientSecret: cfg.googleClientSecret,
    redirectUri: cfg.oauthRedirectUri || `${cfg.publicUrl}/oauth/callback`,
    appSecret: cfg.appSecret,
    envRefreshToken: "",
  };
}
import {
  deskShareNow,
  experimentVerdicts,
  MASCOT_LANES,
  mascotFor,
  mascotShareNow,
  primeTimeVerdict,
  rumoursPerDayNow,
  nextLineArm,
} from "./experiments.ts";
import { SERIOUS as PIP_SERIOUS } from "./render/mascot.ts";
import {
  growthAssign,
  growthDefaults,
  growthNotes,
  growthProblems,
  growthVerdict,
  pinnedGrowthDefaults,
} from "./growth.ts";
import { withLearn } from "./learn/scope.ts";
import { holdoutOf } from "./learn/holdout.ts";
import { banditForShort, pickHook, playbookForShort } from "./learn/writer.ts";
import { learnTick } from "./learn/tick.ts";
import { holdSlotForCap, holdWhyForCap } from "./cadence.ts";
import { whySeatOpen } from "./whyseat.ts";
import {
  refreshChatter,
  bigCluster,
  coveredHashes,
  EDITOR_REPEAT,
  noteEditorRepeat,
  readEditorRepeats,
  runEntryCovered,
  bigEditorNote,
  bigMadeToday,
  bumpFiller,
  currentStories,
  judgeBigStories,
  recentCover,
  recordVerdicts,
  type BigVerdict,
} from "./bigstories.ts";
import {
  breakingAllowance,
  breakingHeldLine,
  breakingScore,
  whySlotsAhead,
} from "./storymix.ts";
import {
  franchiseClip,
  GTA_FILE_ALIASES,
  GTA_FILE_GAME,
  gtaFileEntry,
  gtaFileFrom,
  gtaFileProblems,
  gtaFileRunProblems,
  gtaFileSeries,
  gtaFileTitle,
  isGtaFileSlot,
  openOnOwnClip,
  type GtaFile,
} from "./gtafile.ts";
import { filterCapped, fullCap, gameCountsToday, reserveFor } from "./gamecap.ts";
import {
  askFirst,
  claimDay,
  dailyCommentLine,
  dailyDescriptionLines,
  dailySeries,
  dailySpoilerProblems,
  dailyTheme,
  dailyTitle,
  dailyTitleProblems,
  dateOfDay,
  dayOf,
  gtaDailyFrom,
  isGtaVi,
  liveClaims,
  nextDay,
  previousDay,
  slotOfDay,
  targetDay,
  withNextLink,
  withPreviousLink,
  GTA_DAILY_PLAYLIST,
  type GtaDailyStory,
} from "./gtadaily.ts";
import {
  applyChallenge,
  challengeCounter,
  challengeShelf,
  linkChallenge,
  nextEpisodeMade,
  refreshChallengeLinks,
} from "./challengestep.ts";
import { challengeCommentLine, challengeDescriptionLines } from "./challenge.ts";
import { addPremiere, isPremiereDoc, premiereNotice, premierePrivacy } from "./premiere.ts";
import {
  recapDue,
  recapHeldUntil,
  recapProblems,
  recapTitleProblems,
  recapTopic,
  recapWindows,
  streamedStory,
} from "./storyrecap.ts";
import { sceneSlug as recapSlug } from "./sceneindex/schema.ts";
import {
  lengthArm,
  lengthFormatOf,
  SHORT_NARRATION_CAP_SECONDS,
  shortTarget,
  withLengthArm,
  withWhyTarget,
  type LengthArm,
  type ShortLengths,
} from "./shortlengths.ts";
import { inboxFiles, ownClipVisible, sampledLumas } from "./assets/library.ts";
import {
  fitDescription,
  recentShortTexts,
  repetitionProblems,
} from "./authenticity.ts";
import { followFor } from "./youtube/longlink.ts";
import { disclosureLine, gateAiImages, sourcesLine, syntheticMediaFor, writeRecords } from "./reviewer.ts";
import { MOMENT_MARK, cadenceChapters, framedVariants, pinStrandLayout } from "./strandframe.ts";
import { lossThumb, pickWhyDied } from "./whydied.ts";
import { proposeCompleteCuts, stanceProblems } from "./stance.ts";
import { applyShortTitleGameFirst, applyStrandFrame } from "./strandstep.ts";
import {
  dbDemandBudget,
  dbDemandCache,
  demandFor,
  demandLine,
  demandSearchers,
  rankByDemand,
  type Demand,
} from "./discovery/searchdemand.ts";
import { slotLabel } from "./cadence.ts";
import {
  homeCandidates,
  isHomeSlot,
  nextWhyNumber,
  recentWhyHooks,
  sameGame,
  whySerialProblems,
} from "./editorial/why.ts";
import { mediaRichNotice, shortMediaRichness } from "./qa/mediarich.ts";
import { craftForShort, shortsCleanStep } from "./shortcraftstep.ts";
import { cardCheckTimes, faultedCards, graphicsGateLong, graphicsGateShort } from "./gfxauditstep.ts";
import { gfxInputOf, longMoments } from "./qa/gfxgate.ts";
import { arbitrate, overlaySpans, shortLayout } from "./render/cleanframe.ts";
import { kitTexts } from "./render/gtakit.ts";
import { longGtaKitProp, shortBlenderStep, shortUpgradesFor, type ShortBlenderState } from "./shortupgradestep.ts";
import { checksClearOfUpgrades } from "./render/shortupgrades.ts";
import { probe as probeMedia } from "./qa/media.ts";
import {
  cardRequirement,
  entryCardProblems,
  entryHolds,
  fitRequirement,
} from "./render/rankcard.ts";
import {
  normTitle as normRankTitle,
  patchSpoilers,
  spoilerProblems,
  underFigure,
} from "./editorial/spoilers.ts";
import { ccCredit } from "./render/cleanframe.ts";
import { offendingMedia, dropOffending, rememberUnsafe, flattenDepthFaults } from "./qa/retry.ts";
import { CREDIT_RULE, givenSources, scrubScriptCredits } from "./editorial/credits.ts";
import { shortSampleTimes, framesNamed } from "./qa/vision.ts";
import {
  checkFrame,
  clearOfEntrances,
  graphicChecks,
  graphicsNotice,
  faultsByKind,
  badTextAlert,
  badTextMutes,
  judgeGraphics,
  muteFaults,
  passDecision,
} from "./qa/graphicscheck.ts";
import { releaseGateStep } from "./qa/releaseGate.ts";
import { releaseWriterNotes, writerNoteHits } from "./editorial/writernotes.ts";
import { guardScript, scriptSpoilers, stopForWriterNotes } from "./writerguard.ts";
import { isContentFault, pausesEveryLane, platformAlert } from "./faultclass.ts";
import { planSlate } from "./qa/slate.ts";
import { distinguishing, sameNumberedGame } from "./assets/commons.ts";
import { mergeArticles } from "./discovery/wikipedia.ts";
import { descriptionSources } from "./discovery/wikirefs.ts";
import {
  attributionProblems,
  scrubNarration,
} from "./editorial/attribution.ts";
import {
  GatherBudget,
  GatherOutOfTime,
  reportGatherStop,
} from "./assets/gatherbudget.ts";
import {
  LONG_LEASE,
  LONG_LEASE_TTL_S,
  LONG_URGENT_HOURS,
  isUrgentLong,
  orderLongEpisodes,
} from "./longlane.ts";
import { titleVariants } from "./editorial/titles.ts";
import { pickBreakoutDoc } from "./docpick.ts";
import {
  HYPE_COMMENT_LINE,
  HYPE_END_LINE,
  hypeAllowed,
} from "./youtube/hype.ts";
import {
  pulseCheckFor,
  pulseCheckProblems,
  seriesPulseCheckNote,
} from "./editorial/newssegment.ts";
import {
  isSerial,
  FLOOR_LANES,
  breakingAllowed,
  floorBackFactor,
  seriesTagFor,
  shortFloorProblems,
  shortFloorRule,
} from "./series.ts";
import { gtaFileParts, nextPartFor } from "./nextpart.ts";
import { rankingSequels, sequelWinners } from "./sequels.ts";
import { markEvidence } from "./editorial/evidence.ts";
import { applyTitleShape, writerTitleProblems } from "./titlestep.ts";
import { paletteOf } from "./assets/palette.ts";
import { longReslot, whenLabel } from "./longreslot.ts";
import {
  addDays,
  localTime,
  dayKey,
  LANE_PRIORITY,
  QUOTA,
  QUOTA_RESERVE_FOR_UPLOAD,
  quotaCall,
  quotaCalls,
  dueSlot,
  evergreenDue,
  evergreenWhyNot,
  franchiseKey,
  inWindow,
  isBreaking,
  SHOWCASE,
  showcaseLive,
  slotsLeftToday,
  weekday,
  storyText,
  lastPublishAt,
  publishTimes,
  publishHeld,
  staleAfterHours,
  nextWindowStart,
  quotaAdd,
  quotaResetAt,
  quotaUsed,
  type Sighting,
} from "./lanes.ts";
import { buildResource, markerTag, SessionGone } from "./youtube/upload.ts";
import { signToken } from "./lib/crypto.ts";
import { FatalError, codeFaultStack, errorMessage, log, shortId } from "./lib/util.ts";
import type { RecentShapes } from "./editorial/editorial.ts";
import { SKELETON_WINDOW, hookStyleOpenings, pickSkeleton, skeletonProblems } from "./editorial/skeletons.ts";
import {
  firstFrameText,
  payoffApplies,
  payoffArm,
  payoffFeedback,
  payoffFindings,
  payoffKeepNote,
  payoffRecord,
  readFindings,
  readPayoff,
  SEGMENT_OPENERS,
  ABSENCE_PROBLEM,
  type PayoffArm,
  type PayoffFinding,
  type PayoffRead,
} from "./editorial/payoff.ts";
import {
  DESK_REWRITE_SITE,
  deskArm,
  deskChecks,
  deskKill,
  deskLines,
  deskRecord,
  deskShortProblems,
  judgeDesk,
  runDesk,
  type DeskArm,
  type DeskRecord,
} from "./editorial/desk.ts";
import { roomArm, roomRecord, type RoomArm, type RoomRecord } from "./editorial/room.ts";
import {
  roomCheckStep,
  roomControlRecord,
  roomEvent,
  roomWriteStep,
  recentShapesFrom,
  type RoomStepInput,
} from "./roomstep.ts";
import { leadPrimaries, readWikiLeads, wikiLeadsRoot } from "./sources/wikileads.ts";
import { ensureWikiLeads } from "./sources/refresh.ts";
import {
  firstSecondArmFor,
  firstSecondEvent,
  readFirstEditor,
  readFirstViewer,
  runFirstSecond,
  writeFirst,
  type FirstSecondArm,
} from "./panel/firstsecond.ts";
import {
  loadReferenceTitles,
  packagingCandidates,
  packagingPanelEvent,
  packagingPanelRuns,
  readPackaging,
  runPackagingPanel,
} from "./panel/packagingpanel.ts";
import { FEEDS } from "./discovery/feeds.ts";
import { fetchOutboundLinks } from "./discovery/article.ts";
import { detailListProblems, dropWait, isOfficialDrop } from "./editorial/dropangle.ts";
import { arguesCheck, arguesWriterProblems } from "./qa/argues.ts";
import { cleanBookends, cutSentences, resolveTestRecords, testOutlineNote, unbackedTestClaims, withTestRecords } from "./editorial/testevidence.ts";
import { calendarBlock, readCalendar, type CalendarLane } from "./calendar.ts";
import {
  docRunDue,
  premakeDue,
  readRun,
  runRepeatGame,
  spareFits,
  sparesDue,
  whyRunEntry,
  type RunDoc,
  type RunSpare,
  type RunFile,
  type RunWhy,
} from "./shortrun.ts";
import {
  everyLongDue,
  everyShortDue,
  readEveryGamePlan,
  type EveryGameEntry,
} from "./everygame.ts";
import {
  applyGuideFrame,
  guideSourceText,
  guideWeekDue,
  isWeeklyGuide,
  readGuidePlan,
} from "./longguide.ts";
import {
  DEFAULT_GUIDE_FACTS,
  GTA_GAME,
  GUIDE_DEMAND_DAYS,
  GUIDE_QUERIES,
  gtaGuideSlot,
  guideDemand,
  guidePlanProblems,
  guideProblems,
  guideToScript,
  guideQualityWarnings,
  cleanGuideMoments,
  GUIDE_STILL_MAX_SHOWS,
  isGtaGuide,
  kindOf,
  pickGuideTopic,
  playEvidence,
  readFactPack,
  type GtaGuideTopic,
} from "./gtaguide.ts";
import { guideLogo, loadGuideAsks, loadHudFacts, loadPlayRecordings, pickGuideFrame } from "./gtaguidestep.ts";
import { GuideTooThinError, writeGtaGuide } from "./editorial/gtaguidewriter.ts";
import { OPENING_WORDS_MAX as GUIDE_OPENING_MAX } from "./editorial/longcontract.ts";
import { applyPlannedChapters, factsPath, plannedFactsText, plannedTitle } from "./plannedoc.ts";
import { isRetrospective, readRetroPlan, retroDue, retroIndexProblems } from "./retrospective.ts";
import { editionOf } from "./assets/junk.ts";
import { movingShare } from "./qa/movingshare.ts";
import {
  retroChapterProblems,
  retroChapterSource,
  retroFootageSpans,
  retroFootageCaps,
  retroIndex,
  retroRemasterChapters,
  RETRO_MOVING_CLIPS,
  longChapterFootageCaps,
  retroOutlineFor,
  retroQuoteOptions,
  retroResearchFocus,
  retroSandboxChapters,
  retroServices,
} from "./retrostep.ts";
import { withRetroWarning } from "./editorial/retrospective.ts";
import { requestSceneIndex } from "./sceneindex/job.ts";
import {
  auditEveryGameAssets,
  gatherEveryGameEntry,
  loadEveryGameRoster,
} from "./everygamestep.ts";
import { maybeSelectSearch, searchMadeToday, searchProblems, SEARCH_CHECK_SITE, SEARCH_WRITE_SITE } from "./searchq/step.ts";
import { searchTitleFor } from "./searchq/brief.ts";
import { gameAliases } from "./sceneindex/spoilers.ts";
import {
  EVERY_SHOT_TARGET,
  chapterList,
  eraStampsFor,
  everyGameDocOutline,
  everyGameDocTopic,
  everyGameToScript,
  honestyProblems,
  mustFixEveryGame,
  outlineEveryGame,
  rosterBrief,
  shortEntries,
  validateEveryGameOutline,
  validateEveryGameShort,
  writeEveryGameShort,
  type EveryGameShort,
  type SeriesRoster,
} from "./editorial/everygame.ts";
import {
  airTimeProblems,
  isGta6,
  leonidaLine,
  nextOpenSlot,
  releaseDateProblems,
} from "./launchprep.ts";
import { VISION_SKIPPED } from "./qa/vision.ts";
import { stampColour } from "./render/brand.ts";
import { chooseWordLook, motifIdFor, wordSoundCue } from "./render/wordlook.ts";
import {
  translateScript,
  twinFooter,
  twinNarration,
} from "./editorial/twin.ts";
import {
  captionable,
  gameplayScript,
  gameplayWindow,
  GameplayReviewSchema,
  writeWhole,
  type GameplayReview,
  articleFields,
  cleanWindow,
  hdrFilter,
  isRehearsal,
  minScoreFor,
  parseBlackSpans,
  newClips,
  parseExperiments,
  readMeta,
  reviewClip,
  wordsInWindow,
  worthPosting,
  writeManifest,
  writeMeta,
  type GameplayStatus,
  type GameplayMeta,
} from "./gameplay.ts";
import { pruneCommentRecords } from "./youtube/replies.ts";
import { pruneForSpace } from "./retention.ts";
import { finishChapters } from "./youtube/chapters.ts";
import { docPinnedComment } from "./youtube/pinned.ts";
import {
  answerPack,
  keyFactLines,
  questionChapters,
  loopQuestions,
  summaryLead,
  withoutSummary,
  keyFacts,
  type TimedLine,
} from "./levers/answer.ts";
import {
  archiveCommentLine,
  archiveDescriptionLine,
  archiveLinkFor,
  readArchives,
  readTwitchStreams,
} from "./levers/archives.ts";
import type { LeverSettings } from "./levers/settings.ts";
import { latestPublicDocumentary, nextLine } from "./youtube/nextdoc.ts";
import { communityBlock, communityDrafts } from "./social/community.ts";
import {
  coldOpenLine,
  coldOpenTiming,
  END_CARD_SECONDS,
} from "./render/bookends.ts";
import {
  type Episode,
  type EpisodeAssets,
  countToday,
  createEpisode,
  dueEpisodes,
  getEpisode,
  logEvent,
  markSeen,
  recentHeadlines,
  recordFailure,
  seenHashes,
  transition,
  countProducing,
  takenSlots,
} from "./episodes.ts";
import { footageGate, libraryHasFootage, markLibraryFaults, shortLibraryMedia, type ShortLibraryMedia } from "./assets/shortlibrary.ts";
import { namesGame } from "./assets/linevisuals.ts";
import { stingPlacement } from "./render/cleanframe.ts";
import { nameSpokenAt, placeTracklist, soundtrackStory, MAX_PEOPLE } from "./render/people.ts";
import { peopleCandidates, tracksFromScript } from "./assets/people.ts";
import { mentionsOnWords, type MentionsFound, type MentionInput } from "./assets/mentions.ts";
import { readLaunches } from "./discovery/launches.ts";
import {
  footageRetryAssets,
  footageWaitPlan,
  FOOTAGE_RETRY_DAYS,
  isFootageHold,
  keepMadeFiles,
  planFootageShare,
  premakeNextLook,
  premakeRefreshDecision,
  putMadeFilesBack,
  refreshAssets,
  remakeVerdict,
  restoredAssets,
} from "./premakerefresh.ts";
import { mentionCap, mentionSlots, type MentionKind, type MentionLayout, type MentionInset, type MentionSlot } from "./render/mentions.ts";
import { comparedGames, hardwareStory, isHardwareAsset } from "./assets/linevisuals.ts";
import { libraryRoot, recordUsage } from "./assets/gamelib.ts";
import { askExperiments } from "./streamasks/job.ts";
import {
  endingArmFor,
  endingFormProblems,
  endingFormRule,
  endingRecord,
  pickEndingForm,
  recentEndingForms,
  type EndingForm,
} from "./editorial/endingforms.ts";
import { gateCandidates, premiseArmFor } from "./editorial/premisegate.ts";
import {
  fitClipsAroundQuotes,
  quotesAfterGaps,
  openQuotes,
  prepareQuotes,
  quoteLongStep,
  quoteRenderFiles,
  dialogueOn,
  quoteScriptStep,
} from "./charquotestep.ts";
import {
  buildShortBed,
  clipSoundKind,
  heardInBed,
  longSoundClips,
} from "./assets/gameaudio.ts";
import { prepareEvidence } from "./evidencestep.ts";

export interface Services {
  db: Db;
  cfg: Config;
  llm: Llm;
  discover(): Promise<StoryCluster[]>;
  discoverEvergreen(): Promise<EvergreenCandidate[]>;
  fetchArticle(url: string): Promise<ArticleText | undefined>;
  /** SCRIPT_ROOM_LINKS: an article's outbound links (absent: src/discovery/article.ts fetchOutboundLinks). */
  fetchLinks?(url: string): Promise<string[]>;
  synthesise(
    text: string,
    outPath: string,
    voice?: { id: string; name: string },
    opts?: { provider?: Config["voiceProvider"]; minWpm?: number; speed?: number; hookTakes?: boolean },
  ): Promise<
    Narration & {
      voice?: { provider: "local" | "elevenlabs"; id: string; name: string };
    }
  >;
  findGame(term: string): Promise<SteamApp | undefined>;
  gameFacts(app: SteamApp): Promise<SteamFacts>;
  fetchArt(
    app: SteamApp,
    episodeDir: string,
    maxScreens?: number,
  ): Promise<VisualAsset[]>;
  /** Freely licensed archive photos for a search: Wikimedia Commons, then Openverse and Pixabay when on. */
  searchPhotos(
    query: string,
  ): Promise<import("./assets/commons.ts").CommonsImage[]>;
  /** PEOPLE_INSETS: a named person's licensed face photo in the episode folder (src/assets/people.ts); absent in tests. */
  personPortrait?(
    c: import("./assets/people.ts").NameCandidate,
    dir: string,
    slot: number,
  ): Promise<import("./assets/people.ts").PersonPortrait | undefined>;
  /** The anonymous YouTube lane's bot-check pause (src/lib/ytguard.ts), for SHORT_FOOTAGE_WAIT; absent in tests. */
  youtubePause?(): Promise<{ since?: number; until?: number } | undefined>;
  /** MENTION_*: the pictures behind the mention insets (src/assets/mentions.ts); absent in tests. */
  findMentions?(
    input: import("./assets/mentions.ts").MentionInput,
  ): Promise<import("./assets/mentions.ts").MentionAsset[]>;
  /** Publishers' press pictures of a game (src/assets/press.ts, LIBRARY_PRESS); absent in tests. */
  searchPress?(
    game: string,
  ): Promise<import("./assets/commons.ts").CommonsImage[]>;
  /** Official screenshots, key art and cover from IGDB for a game by exact title (empty without Twitch keys). */
  igdbArt(
    title: string,
    year: number | undefined,
    episodeDir: string,
    max: number,
    /** IGDB picture ids already held: a top-up skips them and brings the next ones. */
    skip?: ReadonlySet<string>,
  ): Promise<VisualAsset[]>;
  /**
   * LONG_NAMED_ART: the official IGDB picture of a character a sentence names, only when IGDB lists them in a game of
   * this series (src/assets/namedart.ts). Optional: undefined in tests and wherever IGDB is not set up.
   */
  characterArt?(
    name: string,
    /** The games whose series the character must be in (any of them). */
    gameTitles: string[],
    episodeDir: string,
  ): Promise<(VisualAsset & { named: string }) | undefined>;
  /** Licensed gameplay (Creative Commons, then the publisher's own uploads) matched to the given lines. */
  gameplayClips(
    game: string,
    franchise: string,
    year: number | undefined,
    episodeDir: string,
    targets: FootageTarget[],
    maxClips: number,
    scope?: "campaign",
  ): Promise<Array<VisualAsset & { credit: string }>>;
  /** The outside calls of the footage-first gather (src/assets/footagedeps.ts); absent in tests, which skips it. */
  footageFirstDeps?(): import("./assets/footagefirst.ts").FootageFirstDeps;
  /** Moments from the owner's own recordings of this game (none when there are none). */
  ownClips(
    game: string,
    franchise: string,
    episodeDir: string,
    targets: FootageTarget[],
    maxClips: number,
  ): Promise<VisualAsset[]>;
  /** True when a video title is footage of exactly this game (and, for a campaign video, of its campaign). */
  judgeFootage(
    game: string,
    year: number | undefined,
    title: string,
    scope?: "campaign",
  ): Promise<boolean>;
  downloadPhoto(
    img: import("./assets/commons.ts").CommonsImage,
    dest: string,
  ): Promise<boolean>;
  fetchClips(
    app: SteamApp,
    episodeDir: string,
    targets: FootageTarget[],
    maxClips: number,
    scope?: "campaign",
    /** Footage first on Shorts: more clean moments up to these seconds, and the local text check. */
    fill?: { seconds?: number; textCheck?: boolean },
  ): Promise<VisualAsset[]>;
  fetchOfficialMedia(
    gameTitle: string,
    episodeDir: string,
    targets: FootageTarget[],
    maxClips: number,
    hint?: string,
    story?: { text: string; after: Date },
    fill?: { seconds?: number; textCheck?: boolean },
  ): Promise<OfficialMedia>;
  /** Screened, muted sections of YouTube cutscenes, after Steam and official trailers. */
  fetchCutscenes?(options: {
    gameTitle: string;
    recentRelease?: boolean;
    episodeDir: string;
    targets: FootageTarget[];
    maxClips: number;
    maxSeconds: number;
    publisher?: string;
    /** SPOILER_GUARD: a long video, and whether it opens with a spoiler warning (src/sceneindex/spoilers.ts). */
    long?: boolean;
    spoilerWarned?: boolean;
    /** LONG_INDEX_FIRST: the scene index's clips alone ("index"), or the cutscene search alone ("search"). */
    mode?: "index" | "search";
    /** The stream recordings' own allowance (src/sceneindex/footage.ts indexFirstCutscenes). */
    ownMaxSeconds?: number;
  }): Promise<CutsceneClip[]>;
  /**
   * SCENE_MATCH for a stills-only publisher (Nintendo): one checked still of each named moment from the game's scene
   * index, placed on the name as it is said (src/sceneindex/footage.ts indexedSceneStills).
   */
  fetchSceneStills?(options: import("./sceneindex/footage.ts").SceneStillOptions): Promise<VisualAsset[]>;
  /** A tight-cap publisher's trailer as last-resort stills, once published art has been counted. */
  trailerFrames?(
    trailer: { videoId: string; title: string; channelTitle: string; url: string },
    episodeDir: string,
    gameTitle: string,
    count: number,
    textCheck: boolean,
  ): Promise<VisualAsset[]>;
  fetchStock(
    episodeDir: string,
    targets: FootageTarget[],
    gameWords: string[],
    maxClips: number,
    /** Pexels page URLs already in the video: never picked again. */
    avoidUrls?: string[],
  ): Promise<VisualAsset[]>;
  releaseRadar(from: Date): Promise<RadarGame[]>;
  freeGames(now: Date): Promise<{ now: FreeGame[]; next: FreeGame[] }>;
  achievements(appId: number): Promise<Achievement[]>;
  /** This week's biggest climbers on Steam's most-played chart, with their official news. */
  steamClimbers(now: Date): Promise<import("./discovery/charts.ts").Climber[]>;
  /** Today's best Steam deals, skipping games featured recently. */
  steamDeals(exclude: string[]): Promise<import("./discovery/deals.ts").Deal[]>;
  /** Buy, Wait or Skip candidates confirmed on Steam (src/discovery/verdicts.ts); absent in tests. */
  verdictCandidates?(
    exclude: string[],
  ): Promise<import("./editorial/verdict.ts").VerdictData[]>;
  /** YouTube's most-popular US charts (Gaming and everything), cached hourly, for the editor. */
  trending(): Promise<import("./discovery/demand.ts").TrendingVideo[]>;
  /** One demand search (a results-page URL) answered by the Data API (src/discovery/demandapi.ts); absent in tests. */
  searchDemand?(
    url: string,
  ): Promise<import("./discovery/searchdemand.ts").SearchRow[]>;
  /** Several topics' demand searches at once on the Data API, view counts batched; an Error for a failed one. */
  searchDemandMany?(
    queries: string[],
  ): Promise<Map<string, import("./discovery/searchdemand.ts").SearchRow[] | Error>>;
  /** A Wikipedia article's useful sections, by title or else by search (documentary research). */
  research(
    title: string,
    fallbackQuery: string,
    maxChars?: number,
    /** What the text is for: the sections that mention it come first and whole. */
    focus?: string,
  ): Promise<import("./discovery/wikipedia.ts").WikiArticle | undefined>;
  downloadImage(url: string, dest: string): Promise<boolean>;
  imageAspect(file: string): Promise<number>;
  render(input: RenderInput): Promise<void>;
  renderLong(input: LongRenderInput): Promise<void>;
  /** Single frames of the long composition for the graphics check before the render (absent in tests). */
  renderLongStills?(input: LongStillsInput): Promise<void>;
  renderShortThumb?: typeof renderShortThumb;
  /** A game on the hardware of its day, as one still, for an every-game Short (absent in tests). */
  renderEraFrame?: typeof import("./render/render.ts").renderEraFrame;
  /** Every IGDB entry of a series, for the every-game format's roster (absent in tests). */
  igdbSeries?(series: string): Promise<import("./assets/igdb.ts").IgdbSeriesRow[]>;
  /** The Reporting API with this channel's login (src/reach.ts). */
  reachClient?: () => ReachClient;
  renderCutdown?: typeof renderCutdown;
  renderGameplayShort?: typeof renderGameplayShort;
  normalise(input: string, output: string): Promise<void>;
  technicalQa(
    file: string,
    expectedSeconds: number,
    band?: {
      minSeconds: number;
      maxSeconds: number;
      width?: number;
      height?: number;
      chapterStarts?: number[];
    },
  ): Promise<TechQa>;
  extractFrames(
    file: string,
    outDir: string,
    times: number[],
  ): Promise<string[]>;
  /** True while the PC picture checker is down and nothing paid may stand in (src/services.ts); absent: never. */
  visionDown?(): Promise<boolean>;
  visionQa(
    frames: string[],
    ctx: {
      headline: string;
      gameTitle: string;
      format?: "short" | "long" | "graphics" | "thumbs" | "shortgraphics";
      heroRule?: boolean;
      narration?: string;
      cardTexts?: string[];
    },
  ): Promise<VisionQa>;
  /** The ElevenLabs cycle: what is left and what would be lost at the reset (undefined when unknown). */
  creditPlan?(): Promise<import("./voice/credits.ts").CreditPlan | undefined>;
  /** Joins voiced takes into one narration with the word timings shifted onto one timeline. */
  stitchTakes?(parts: Narration[], outPath: string): Promise<Narration>;
  /** What Whisper hears in a gameplay clip, word by word (empty when no Whisper is set up). */
  hearClip?(
    file: string,
  ): Promise<Array<{ text: string; start: number; end: number }>>;
  /** What the voice actually says against its script (undefined when no Whisper is set up). */
  checkNarration?(
    file: string,
    words: Array<{ text: string; start: number; end: number }>,
  ): Promise<NarrationCheck | undefined>;
  /** The YouTube client for the main channel, or for a named second account (the Spanish twin, "es"). */
  youtube(account?: string): YouTubeClient;
  /** Whether a login is stored for the account (undefined in tests: treated as connected). */
  youtubeConnected?(account?: string): Promise<boolean>;
  /** true = delivered, false = failed, undefined/void = Discord not configured. */
  notify(msg: DiscordMessage): Promise<boolean | undefined | void>;
  /** True when PUBLIC_URL answers (or is local), so approval links could have been used. */
  publicReachable(): Promise<boolean>;
  now(): Date;
}

const IN_FLIGHT = [
  "selected",
  "scripted",
  "voiced",
  "rendered",
  "awaiting_approval",
  "approved",
  "uploading",
];

export function episodeDir(cfg: Config, id: string): string {
  return path.join(cfg.dataDir, "episodes", id);
}

/** A gameplay card's links: with GAMEPLAY_ONE_TAP, Approve and Reject act on the tap (src/server.ts). */
export function gameplayLinks(cfg: Config, id: string, live = false) {
  const links = approvalLinks(cfg, id);
  // A clip from the live stream is always one tap (LIVE_CLIPS): its topic is hot for an hour or two, not a day.
  return cfg.gameplayOneTap || live
    ? {
        ...links,
        approve: `${links.approve}&now=1`,
        reject: `${links.reject}&now=1`,
      }
    : links;
}

export function approvalLinks(cfg: Config, id: string) {
  const ttl = 3 * 24 * 3600;
  const t = (action: string) =>
    signToken(`${action}:${id}`, cfg.appSecret, ttl);
  return {
    approve: `${cfg.publicUrl}/episodes/${id}/approve?t=${t("approve")}`,
    reject: `${cfg.publicUrl}/episodes/${id}/reject?t=${t("reject")}`,
    preview: `${cfg.publicUrl}/episodes/${id}/video.mp4?t=${t("preview")}`,
    // SHORT_FULL_COVER (src/social/cover.ts): the cover still and the social copy, on the preview's own token.
    cover: `${cfg.publicUrl}/episodes/${id}/cover.jpg?t=${t("preview")}`,
    social: `${cfg.publicUrl}/episodes/${id}/social.mp4?t=${t("preview")}`,
  };
}

// ---------------------------------------------------------------- selection

/**
 * Discovery on its own clock: fetch the feeds, cluster, and remember when each
 * story was first seen. Selection reads these sightings and never refetches.
 */
export async function discoverTick(s: Services): Promise<number> {
  const clusters = await s.discover();
  const now = s.now();
  for (const c of clusters) {
    await s.db.query(
      `INSERT INTO cluster_sightings (hash, headline, first_seen, last_seen, item_count, has_official, max_score, cluster_json)
       VALUES ($1, $2, least($3::timestamptz, $8::timestamptz), $3, $4, $5, $6, $7)
       ON CONFLICT (hash) DO UPDATE SET last_seen = EXCLUDED.last_seen, item_count = EXCLUDED.item_count,
         has_official = cluster_sightings.has_official OR EXCLUDED.has_official,
         max_score = greatest(cluster_sightings.max_score, EXCLUDED.max_score), cluster_json = EXCLUDED.cluster_json, headline = EXCLUDED.headline`,
      // first_seen never predates the poll but never postdates the newest article either, so a
      // restart does not make every old story look minutes old.
      [
        c.hash,
        c.headline,
        now,
        c.items.length,
        c.hasOfficial,
        c.score,
        JSON.stringify(c),
        new Date(c.newestAt),
      ],
    );
  }
  // Age is measured on the pipeline's clock (s.now()), the same one that stamped last_seen.
  await s.db.query(
    `DELETE FROM cluster_sightings WHERE last_seen < $1::timestamptz - interval '7 days'`,
    [now],
  );
  await refreshChatter(s.db, s.cfg, now, () => s.trending()).catch((err) =>
    log("warn", "chatter read failed", { error: errorMessage(err) }),
  );
  return clusters.length;
}

async function recentSightings(
  s: Services,
): Promise<Array<{ cluster: StoryCluster; sighting: Sighting }>> {
  const rows = await s.db.query<Sighting & { cluster_json: StoryCluster }>(
    // Judged by the factory's clock, like every other hold, so the scheduler is testable.
    `SELECT hash, first_seen, last_seen, item_count, has_official, max_score, cluster_json FROM cluster_sightings WHERE last_seen > $2::timestamptz - ($1 || ' hours')::interval ORDER BY max_score DESC`,
    [String(s.cfg.maxStoryAgeHours), s.now()],
  );
  // Discovery may hold older articles for a late big story (BIG_STORY_MAX_AGE_HOURS); the usual lanes stay fresh.
  const oldest = s.now().getTime() - s.cfg.maxStoryAgeHours * 3_600_000;
  return rows
    .filter((r) => new Date(r.cluster_json.newestAt).getTime() >= oldest)
    .map((r) => ({ cluster: r.cluster_json, sighting: r }));
}

/**
 * Uploads still due before YouTube's quota resets (midnight Pacific): the news slots, the evening
 * feature, and the deals and long-video slots on their days. Slots after the reset spend the next
 * day's quota, so they are not counted against this one.
 */
export function uploadsLeftToday(cfg: Config, now: Date): number {
  const reset = quotaResetAt(now).getTime();
  const today = dayKey(now, cfg.timezone);
  let n = 0;
  for (const d of [today, addDays(today, 1)]) {
    const day = weekday(localTime(d, "12:00", cfg.timezone), cfg.timezone);
    const slots = [...cfg.newsSlots, cfg.weeklySlot];
    if (
      cfg.dealsDays.includes(day) ||
      (cfg.seriesVerdictEnabled && cfg.seriesVerdictDays.includes(day))
    )
      slots.push(cfg.dealsSlot);
    if (cfg.longformEnabled && cfg.longformDays.includes(day))
      slots.push(cfg.longformSlot);
    if (cfg.whyEnabled && cfg.whyDays.includes(day))
      slots.push(...cfg.whySlots);
    for (const slot of slots) {
      const t = localTime(d, slot, cfg.timezone).getTime();
      if (t > now.getTime() && t < reset) n++;
    }
  }
  return n;
}

/** Episodes that will still upload: in production, awaiting approval or waiting to upload. */
async function uploadsInFlight(db: Db): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE status IN ('selected','scripted','voiced','rendered','awaiting_approval','approved','uploading')`,
  );
  return Number(row?.n ?? 0);
}

/** Units this quota day can still spend on an extra upload once every due and in-flight upload is covered. */
export function spareUnits(
  cfg: Config,
  used: number,
  dueUploads: number,
  inFlight: number,
): number {
  return (
    cfg.quotaUnitsPerDay -
    used -
    QUOTA_RESERVE_FOR_UPLOAD * (dueUploads + inFlight)
  );
}

// The spare-quota lane runs in the last hours before the reset, and starts nothing in the final hour
// (production takes up to about forty minutes and the upload must land before the reset).
const SPARE_WINDOW_MINUTES = 180;
const SPARE_LAST_START_MINUTES = 60;

/**
 * Spare quota. Whatever YouTube quota is unspent at the reset is lost, so in the last hours of the
 * quota day (about 05:00 to 07:00 in London) the factory makes an extra evergreen Short with what is
 * left and uploads it scheduled for a good publish time later that day. The upload spends today's
 * quota; the publish lands at a US-friendly hour. One a tick, while the spare covers another upload.
 */
export async function maybeSelectSpare(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.spareUploads || !cfg.evergreenEnabled) return undefined;
  const now = s.now();
  if (await bumpFiller(db, cfg, "spare", now)) return undefined;
  const minutesLeft = (quotaResetAt(now).getTime() - now.getTime()) / 60_000;
  if (
    minutesLeft > SPARE_WINDOW_MINUTES ||
    minutesLeft < SPARE_LAST_START_MINUTES
  )
    return undefined;
  const spare = spareUnits(
    cfg,
    await quotaUsed(db, now),
    uploadsLeftToday(cfg, now),
    await uploadsInFlight(db),
  );
  if (spare < QUOTA_RESERVE_FOR_UPLOAD) return undefined;
  // At most one editor call every 20 minutes: a topic the editor passes on is not retried every tick.
  if (await weeklyTried(db, `spare:${Math.floor(now.getTime() / 1_200_000)}`))
    return undefined;
  const taken = new Set((await takenSlots(db)).map((t) => t.getTime()));
  const today = dayKey(now, cfg.timezone);
  const slotAt = [today, addDays(today, 1)]
    .flatMap((d) => cfg.spareSlots.map((x) => localTime(d, x, cfg.timezone)))
    // In the order given (best US hour first), today before tomorrow.
    .find(
      (t) =>
        t.getTime() > now.getTime() + 3 * 3_600_000 && !taken.has(t.getTime()),
    );
  if (!slotAt) return undefined;
  const id = await createEvergreen(s, slotAt, true);
  if (id)
    log("info", "spare quota Short selected", {
      id,
      spare,
      slot: slotAt.toISOString(),
    });
  return id;
}

/** Units free for optional work (comment replies, sprints) once every upload still due today is covered. */
export async function quotaHeadroom(
  db: Db,
  cfg: Config,
  now: Date,
): Promise<number> {
  return (
    cfg.quotaUnitsPerDay -
    (await quotaUsed(db, now)) -
    QUOTA_RESERVE_FOR_UPLOAD * uploadsLeftToday(cfg, now)
  );
}

/**
 * A franchise the channel leans into for a while (GTA in the four weeks before GTA 6): told to every
 * editor that picks a story or a topic, as a tie-breaker and a source of angles, never a reason to run
 * a weak story or repeat one.
 */
export function focusBlock(cfg: Config, now: Date): string {
  if (!cfg.focusTopic) return "";
  if (
    cfg.focusUntil &&
    now.getTime() > new Date(`${cfg.focusUntil}T23:59:59Z`).getTime()
  )
    return "";
  const wave = launchWave(cfg, now)
    ? ` LAUNCH WEEK: this is the launch wave for ${cfg.focusTopic}. Cover it from every angle (reviews, performance, hidden details, what fans are finding, how it compares, prices and editions) and prefer a strong ${cfg.focusTopic} story over anything of equal weight.`
    : "";
  return `Channel focus${cfg.focusUntil ? ` until ${cfg.focusUntil}` : ""}: ${cfg.focusTopic}.${cfg.focusNote ? ` ${cfg.focusNote}` : ""} When a ${cfg.focusTopic} story or topic is as strong as the alternatives, pick it, and prefer fresh angles (history, hidden details, why things happened, what fans argue about) over repeating news already covered. Never pick a weak story or invent one because of the focus.${wave}`;
}

/** The fastest a Short's voice may run before the checks call it rushed: higher once SHORT_MIN_WPM or SHORT_SPEED lifts it. */
export function shortWpmMax(cfg: Pick<Config, "shortMinWpm" | "shortSpeed">): number {
  return Math.max(190, cfg.shortMinWpm ? cfg.shortMinWpm + 25 : 0, cfg.shortSpeed > 1 ? Math.round(205 * cfg.shortSpeed) : 0);
}

/** The personal voice for the voice test: a take, honestly held, never an invented experience. */
export const PERSONAL_VOICE =
  "Voice for this Short: a gamer talking to a friend, not a news report. Say the news plainly first, so the viewer knows the point; once they have the facts, give Pulse's verdict in the take as a flat claim with its reason, then one first-person line that owns it (\"That's steep. I'd wait for a sale.\"); the beats carry no \"I\" lines, and one \"I think\" or \"honestly\" at most, never stacked and never in the first sentence. When the story has a downside, say it before the praise, so the praise is believed, and be warm more often than sharp. One light joke gamers would get is welcome only if it follows straight from the line before and makes sense heard once, aimed at a company, a price or the situation; no joke beats a confusing one. Tie the story to the biggest game of the moment only when the sources make the link real. End on the kicker the brief asks for, never on \"let me know\" or a general \"what do you think?\". Never claim to have played, owned, watched or felt anything, and never put words in anyone's mouth: opinions only, and every fact stays exactly as the sources give it.";

/** A stable 0-1 number for an id (FNV-1a), for splitting episodes between test sides. */
export function unitHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 4294967296;
}

/**
 * GAME_AUDIO_BED's test side for an episode (src/assets/gameaudio.ts): on for GAME_AUDIO_SHARE of videos, split by
 * episode like the voice test (its own key, so the two splits are independent), so a retry keeps its side.
 */
export function gameAudioOn(
  cfg: Pick<Config, "gameAudioBed" | "gameAudioShare">,
  id: string,
  /** A retrospective always has the game's sound under it while GAME_AUDIO_BED is on (owner: "use game audio generously"). */
  always = false,
): boolean {
  return (
    cfg.gameAudioBed &&
    (always ||
      (cfg.gameAudioShare > 0 &&
        unitHash(`gameaudio:${id}`) < cfg.gameAudioShare))
  );
}

/** True when a story or title is about the channel focus (FOCUS_MATCH). */
export function focusMatch(cfg: Config, text: string): boolean {
  if (!cfg.focusMatch) return false;
  try {
    return new RegExp(cfg.focusMatch, "i").test(text);
  } catch {
    return false;
  }
}

/** True during a launch wave (LAUNCH_WAVE_FROM to LAUNCH_WAVE_TO, London dates): extra Shorts on the focus. */
export function launchWave(cfg: Config, now: Date): boolean {
  if (!cfg.waveFrom || !cfg.waveTo || !cfg.focusTopic) return false;
  const day = dayKey(now, cfg.timezone);
  return day >= cfg.waveFrom && day <= cfg.waveTo;
}

// Named series shelves. The channels that grew fastest file every video in a playlist named the way
// people search, and point their end screens at them; a series also tells YouTube who the video is for.
const SERIES = {
  rankedLong: {
    title: "Every Game Ranked: Worst to Best",
    description:
      "Pulse Gaming's full rankings: every game in a series, ranked on one clear rule and explained. A new ranking every Saturday.",
  },
  weekly: {
    title: "The Pulse Weekly: This Week in Gaming",
    description:
      "The week's biggest gaming stories, checked and explained. Every Friday.",
  },
  docs: {
    title: "Gaming Documentaries",
    description: "The stories behind the games, checked and explained.",
  },
  why: {
    title: "The Why: Gaming's Biggest Questions",
    description:
      "One question fans argue about, answered from the record in under a minute. A new one every day.",
  },
  rankedShort: {
    title: "Ranked in 60 Seconds",
    description: "Game rankings in under a minute, one clear rule each.",
  },
  news: {
    title: "Gaming News Today",
    description:
      "Fast gaming news, checked and explained. New Shorts every day.",
  },
  // The daily GTA 6 series from the owner's own streams (from launch, 19 Nov 2026): the channel page's first shelf.
  // SERIES_GTA_DAILY_TITLE names the playlist if the series files under another title.
  gtaDaily: {
    title: process.env.SERIES_GTA_DAILY_TITLE || "GTA 6 Day by Day",
    description:
      "GTA 6, one day at a time: a new numbered episode every day from launch, cut from real play on our own streams. No story spoilers.",
  },
  // The two new series shelves (format plan, 11 Nov 2026, item 8), filed only with SERIES_PLAYLISTS on.
  gtaFile: {
    title: "The GTA File",
    description:
      "The one GTA VI thing worth knowing today and what it means for you as a player. Confirmed facts only, a new numbered part every day.",
  },
  verdict: {
    title: "Buy, Wait or Skip",
    description:
      "Before you spend: one game, one price and one straight verdict. Prices from Steam, scores from Steam reviews. Tuesday, Thursday and Saturday.",
  },
};

/** The new series shelves' titles, in the channel page's order (src/channelpage.ts). */
export const SERIES_SHELF_TITLES = {
  gtaDaily: SERIES.gtaDaily.title,
  gtaFile: SERIES.gtaFile.title,
  why: SERIES.why.title,
  verdict: SERIES.verdict.title,
  docs: SERIES.docs.title,
  rankedLong: SERIES.rankedLong.title,
} as const;
export const SERIES_SHELF_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  Object.values(SERIES).map((x) => [x.title, x.description]),
);

/** The playlists a published video belongs to. */
export function seriesFor(
  cfg: Config,
  ep: Episode,
  now: Date,
): Array<{ title: string; description: string }> {
  const sc = ep.script_json;
  if (!sc) return [];
  const out: Array<{ title: string; description: string }> = [];
  // The series build's tag (src/seriescover.ts): with SERIES_PLAYLISTS on, a GTA File part and a verdict file on
  // their own shelves, and only there.
  const tag = cfg.seriesPlaylists ? seriesTagOf(sc, ep.story_hash) : undefined;
  if (tag === "gta_file") out.push(SERIES.gtaFile);
  else if (tag === "verdict") out.push(SERIES.verdict);
  // A challenge episode (src/challenge.ts): its own challenge's shelf, in order.
  else if (ep.story_json?.challenge) out.push(challengeShelf(ep.story_json.challenge));
  // GTA 6 Day N (src/gtadaily.ts): every episode on the daily's own shelf, in order.
  else if (ep.story_json?.gtaDaily) out.push(dailySeries());
  // The explainer takes the weekly slot in turn with the recap (src/weeklytest.ts), so it shares the weekly shelf.
  else if (sc.recap || sc.explained) out.push(SERIES.weekly);
  else if (sc.runtime === "long")
    out.push(
      sc.evergreen_format === "documentary" ? SERIES.docs : SERIES.rankedLong,
    );
  else if (ep.story_hash?.startsWith("why:")) out.push(SERIES.why);
  // A GTA File part (src/gtafile.ts) is a serial, not news: it goes on its own shelf only.
  else if (ep.story_json?.gtaFile)
    out.push(gtaFileSeries(ep.story_json.gtaFile.name));
  else if (
    ep.lane === "cutdown" ||
    (ep.lane === "evergreen" &&
      sc.entries?.length &&
      // A deals list or a release list has entries but ranks nothing: it stays off the rankings shelf.
      !["steam_deals", "release_radar", "steam_climbers", "weekly_recap", "buy_wait_skip"].includes(
        sc.evergreen_format ?? "",
      ))
  )
    out.push(SERIES.rankedShort);
  else if (ep.lane === "news" || ep.lane === "news_breaking")
    out.push(SERIES.news);
  const focusOn =
    cfg.focusPlaylist &&
    (!cfg.focusUntil || dayKey(now, cfg.timezone) <= cfg.focusUntil);
  if (
    focusOn &&
    focusMatch(
      cfg,
      `${sc.game_title} ${sc.headline} ${sc.youtube?.title ?? ""}`,
    )
  )
    out.push({
      title: cfg.focusPlaylist,
      description: `${cfg.focusTopic} news, explainers and rankings from Pulse Gaming.${cfg.focusNote ? ` ${cfg.focusNote}` : ""}`,
    });
  return out;
}

/** The YouTube login an episode belongs to: "" for the main channel, the twin's account for a twin. */
export function accountOf(ep: Pick<Episode, "story_json">): string {
  return ep.story_json.twin?.account ?? "";
}

/**
 * Files a published video in its series playlists (50 units each, plus 50 the first time a playlist is made).
 * With SERIES_PLAYLISTS on (src/seriesplaylists.ts) only a video seen public joins: a scheduled one is filed by
 * confirmPublished when it goes live, and one the owner keeps private never joins. Nothing here changes a video.
 */
export async function addToSeries(
  s: Services,
  ep: Episode,
  privacy?: string,
): Promise<void> {
  if (ep.lane === "twin") return; // the twin channel's playlists are not set up
  if (s.cfg.seriesPlaylists && privacy !== "public") return;
  const yt = s.youtube() as Partial<{
    findOrCreatePlaylist: (
      t: string,
      d: string,
    ) => Promise<{ id: string; created: boolean }>;
    addToPlaylist: (p: string, v: string) => Promise<void>;
  }>;
  if (!yt.findOrCreatePlaylist || !yt.addToPlaylist || !ep.youtube_video_id)
    return;
  for (const series of seriesFor(s.cfg, ep, s.now())) {
    try {
      // Filed once: the check after a scheduled video goes live must not add it a second time.
      if (
        s.cfg.seriesPlaylists &&
        (
          await s.db.query(
            `SELECT 1 FROM events WHERE episode_id = $1 AND kind = 'playlist' AND detail->>'title' = $2 LIMIT 1`,
            [ep.id, series.title],
          )
        ).length
      )
        continue;
      const key = `playlist:${series.title}`;
      const [row] = await s.db.query<{ value: string }>(
        `SELECT value FROM settings WHERE key = $1`,
        [key],
      );
      let id = row?.value;
      if (!id) {
        const made = await yt.findOrCreatePlaylist(
          series.title,
          series.description,
        );
        await quotaAdd(s.db, s.now(), made.created ? 51 : 1);
        id = made.id;
        await s.db.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, id],
        );
      }
      await yt.addToPlaylist(id, ep.youtube_video_id);
      await quotaAdd(s.db, s.now(), QUOTA.comment);
      await logEvent(s.db, ep.id, "playlist", { title: series.title });
    } catch (err) {
      log("warn", "playlist add failed", {
        episode: ep.id,
        playlist: series.title,
        error: errorMessage(err),
      });
    }
  }
}

/** For ranking topic pickers: YouTube's trending gaming videos and what viewers asked us to rank. */
/** The calendar's plan for a lane: today's entries, and the next days' for the news desk. */
export function calendarFor(
  cfg: Config,
  now: Date,
  lane: CalendarLane,
  aheadDays = 0,
): string {
  if (!cfg.calendarFile) return "";
  const today = dayKey(now, cfg.timezone);
  const ahead = Array.from({ length: aheadDays }, (_, i) =>
    addDays(today, i + 1),
  );
  return calendarBlock(readCalendar(cfg.calendarFile), today, lane, ahead);
}

/**
 * Questions people type into YouTube where the answers are old, off-target or long videos (search_gaps.md,
 * from the 26 Oct 2026 demand study): almost none had a Short among the top 20 results.
 */
export function searchGapsBlock(file: string): string {
  if (!file) return "";
  let md = "";
  try {
    md = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const lines = md
    .split(/\r?\n/)
    .filter((l) => l.startsWith("- "))
    .slice(0, 60);
  if (!lines.length) return "";
  return `Questions people search for on YouTube where the answers are stale, off-target or 20-minute videos (almost no Shorts answer them). When a candidate can honestly answer one, prefer it and use the searcher's own words in the question and the title:\n${lines.join("\n")}`;
}

async function topicDemand(
  s: Services,
  lane: CalendarLane = "any",
): Promise<string> {
  return [
    focusBlock(s.cfg, s.now()),
    hotBlock(await readHotTopic(s.db, s.now()).catch(() => undefined)),
    calendarFor(s.cfg, s.now(), lane),
    searchGapsBlock(s.cfg.searchGapsFile),
    trendingBlock(await s.trending().catch(() => []), 25),
    requestsBlock(await readRequests(s.db).catch(() => undefined)),
    pollBlock(await readPoll(s.db).catch(() => undefined), s.now()),
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function createFromChoice(
  s: Services,
  candidates: StoryCluster[],
  lane: { lane: string; priority: number; slotAt?: Date },
  why: string,
  /** A big story (src/bigstories.ts): what the editor is told, and whether its pass is overruled. */
  big?: {
    note: string;
    force: boolean;
    alsoSeen: string[];
    onPass: (reason: string) => void;
    /** Our own dropped attempts at this story: never published, so not "already covered". */
    notCovered: string[];
  },
): Promise<string | undefined> {
  const { db } = s;
  const pool = candidates;
  const choice = await selectStory(
    s.llm,
    pool,
    (await recentHeadlines(db)).filter((h) => !big?.notCovered.includes(h)),
    [
      big?.note ?? "",
      focusBlock(s.cfg, s.now()),
      hotBlock(await readHotTopic(db, s.now()).catch(() => undefined)),
      calendarFor(s.cfg, s.now(), "news", 3),
      await performanceNotes(db, s.now()).catch(() => ""),
      await retentionNotes(db, s.now()).catch(() => ""),
      await socialLessons(db, s.now(), loopLessonLines(s.cfg, s.now())).catch(
        () => "",
      ),
      trendingBlock(await s.trending().catch(() => [])),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  let picked = pool[choice.candidate_index];
  if (!picked) {
    log("info", "editor passed on every candidate", {
      lane: lane.lane,
      reason: choice.reason,
    });
    big?.onPass(choice.reason);
    // Too big to pass, unless the editor says it has been told already.
    if (!big?.force || EDITOR_REPEAT.test(choice.reason)) return undefined;
    picked = pool[0]!;
    choice.reason = `editor overruled, the story is too big to pass: ${choice.reason}`;
  }
  const id = shortId();
  const created = await createEpisode(
    db,
    id,
    {
      ...picked,
      gameHint: choice.game_title || undefined,
      visualNeed: choice.visual_dependency,
    },
    lane,
  );
  await markSeen(
    db,
    picked.hash,
    picked.headline,
    created ? "selected" : "duplicate",
    choice.reason,
  );
  // Every split of a big story is the same story: none of them comes back through a news slot.
  for (const h of big?.alsoSeen ?? [])
    await markSeen(db, h, picked.headline, "big_story", "the same story as a big story made");
  if (!created) return undefined;
  await logEvent(db, id, "selected", {
    headline: picked.headline,
    reason: choice.reason,
    story_type: choice.story_type,
    score: picked.score,
    lane: lane.lane,
    slot_at: lane.slotAt?.toISOString() ?? null,
    why,
  });
  log("info", "story selected", {
    id,
    lane: lane.lane,
    headline: picked.headline,
    slot: lane.slotAt?.toISOString(),
  });
  return id;
}

/**
 * The big-story desk, ahead of every allowance (src/bigstories.ts): judges the day's biggest stories, records what is
 * happening to each, and makes the biggest one not yet covered. It fills a news slot when one is open, else it goes
 * out like a breaking Short. Report mode and a blocked factory still judge and record, so nothing is passed silently.
 */
let lastBigCovered = new Set<string>();

async function maybeSelectBig(
  s: Services,
  blocked?: string,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (cfg.bigStoryMode === "off") return undefined;
  const now = s.now();
  const stories = await currentStories(db, cfg, now);
  const context = {
    now,
    episodes: await recentCover(db, now),
    run: readRun(cfg.shortRunFile),
    rumoursToday: cfg.includeRumours
      ? await countRumoursToday(db, cfg.timezone)
      : 0,
    rumourCap: await rumoursPerDayNow(db, cfg),
    includeRumours: cfg.includeRumours,
    bigMadeToday: await bigMadeToday(db, cfg.timezone),
    editorRepeats: await readEditorRepeats(db, now),
    ...(blocked ? { blocked } : {}),
  };
  const verdicts = judgeBigStories(stories, cfg, context);
  lastBigCovered = coveredHashes(verdicts);
  const make = verdicts.find((v) => v.action === "make");
  if (make) {
    // The quota is the one limit a big story cannot overrule: an upload past it just fails.
    const headroom = await quotaHeadroom(db, cfg, now);
    if (headroom < QUOTA_RESERVE_FOR_UPLOAD) {
      make.action = "held";
      make.reason = `YouTube's upload quota for today is spoken for (${headroom} units spare)`;
    }
  }
  if (make && make.action === "make" && cfg.dropAngle) {
    const wait = dropWait(make.story, now, {
      hours: cfg.dropAngleHours,
      leadHours: cfg.slotLeadMinutes / 60,
      slotDue: !!(await bigSlot(s, now)),
    });
    if (wait) {
      make.action = "held";
      make.reason = wait;
    }
  }
  // GAME_DAY_CAP (src/gamecap.ts): a big story that would fill a news slot is a news Short, so a game whose Shorts for
  // the day are used up holds it; with no slot due it is made as breaking news, which the cap never holds.
  if (make && make.action === "make" && cfg.gameDayCap.length && (await bigSlot(s, now))) {
    const counts = await gameCapCounts(s).catch(() => undefined);
    const full = counts && fullCap(cfg.gameDayCap, counts, `${make.story.headline} ${make.story.name}`);
    if (full) {
      make.action = "held";
      make.reason = `${full.name} already has its ${full.perDay} Short${full.perDay === 1 ? "" : "s"} today (GAME_DAY_CAP)`;
    }
  }
  await recordVerdicts(db, cfg, verdicts, now);
  if (!make || make.action !== "make") return undefined;
  return createBig(s, make);
}

/** The news slot a big story would fill now, if one is due. */
async function bigSlot(s: Services, now: Date): Promise<Date | undefined> {
  const { db, cfg } = s;
  return dueSlot(
    now,
    {
      slots: cfg.newsSlots,
      leadMinutes: cfg.slotLeadMinutes,
      graceMinutes: cfg.slotGraceMinutes,
      timeZone: cfg.timezone,
    },
    await takenSlots(db),
  );
}

/** One editor call per story every three hours: a pass is reported, not retried each tick. */
async function createBig(s: Services, v: BigVerdict): Promise<string | undefined> {
  const { db, cfg } = s;
  const now = s.now();
  const bucket = Math.floor(now.getTime() / (3 * 3_600_000));
  if (await weeklyTried(db, `big:${v.story.key}:${v.attempt}:${bucket}`)) return undefined;
  const cluster = bigCluster(v, now);
  const slot = await bigSlot(s, now);
  // A follow-up to a story already covered is the editor's call, however big.
  const force = v.story.size >= cfg.bigStoryHuge && !v.development;
  let passed: string | undefined;
  const id = await createFromChoice(
    s,
    [cluster],
    slot
      ? { lane: "news", priority: LANE_PRIORITY.news, slotAt: slot }
      : { lane: "news_breaking", priority: LANE_PRIORITY.news_breaking },
    `big story: size ${v.story.size} (${v.story.why})`,
    {
      note: bigEditorNote(v.story),
      force,
      alsoSeen: v.story.hashes,
      onPass: (reason) => {
        passed = reason;
      },
      notCovered: (await recentCover(db, now))
        .filter(
          (e) =>
            e.story_json.bigStory?.key === v.story.key &&
            (e.status === "failed" || e.status === "rejected"),
        )
        .flatMap((e) => [e.story_json.headline, e.script_headline ?? ""]),
    },
  );
  if (!id) {
    if (passed !== undefined && EDITOR_REPEAT.test(passed))
      await noteEditorRepeat(db, v.story.key, passed, now);
    if (passed !== undefined)
      await recordVerdicts(
        db,
        cfg,
        [{ ...v, action: "held", reason: `the editor passed on it: ${passed.slice(0, 200)}` }],
        now,
      );
    return undefined;
  }
  if (!slot) {
    const ep = await getEpisode(db, id);
    await db.query(
      `INSERT INTO breaking_log (story_hash, franchise, episode_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [ep!.story_hash, franchiseKey(ep!.story_json), id],
    );
  }
  await recordVerdicts(db, cfg, [{ ...v, action: "made", reason: "in production", episode: id }], now);
  await s.notify({
    level: "info",
    content: `Big story picked: "${v.story.headline}" (size ${v.story.size}: ${v.story.outlets.length} outlets, ${v.story.articles} articles)${cluster.bigStory?.lateHours ? `, ${cluster.bigStory.lateHours} hours old, so the angle is what has happened since` : ""}.`,
  });
  return id;
}

/**
 * Two lanes, one producer. The breaking lane fires on a massive official story
 * seen for the first time minutes ago, any time inside its window, at most a
 * few times a day with a per-franchise cooldown. The news lane fills fixed
 * daily slots: an episode is started a lead time before its slot and
 * publishes at the slot. Episodes waiting on approval or YouTube never block
 * the next one; only MAX_PRODUCING episodes are mid-production at once.
 */
/**
 * The long lanes once the day's Shorts allowance is used: a documentary or a long ranking still takes its slot, each by
 * its own rules (lead time, banking window, slot free), then the weekly long video; no Short is made here.
 */
export async function maybeSelectLongAfterTarget(s: Services): Promise<string | undefined> {
  return (
    (await maybeSelectDocumentary(s)) ??
    (await maybeSelectLongform(s)) ??
    // LONG_WEEKLY_AFTER_TARGET: Friday's long round-up or explainer too. Shorts made ahead for a Friday count on
    // Friday from midnight, so the allowance can be used before the 12:00 window opens and the slot would pass empty.
    (s.cfg.longWeeklyAfterTarget ? await maybeSelectWeeklyLong(s) : undefined) ??
    undefined
  );
}

/** The day's Shorts that count toward SHORTS_PER_DAY: spare, big-story and search Shorts (and, with
 * DAILY_TARGET_SHORTS_ONLY, long videos) are extra. */
async function shortsTowardTarget(db: Db, cfg: Config): Promise<number> {
  return (
    (await countToday(db, cfg.timezone)) -
    (await countSpareToday(db, cfg.timezone)) -
    (await bigMadeToday(db, cfg.timezone)) -
    (await searchMadeToday(db, cfg.timezone)) -
    (cfg.dailyTargetShortsOnly ? await countToday(db, cfg.timezone, "longform") : 0)
  );
}

/** Today's Shorts allowance: SHORTS_PER_DAY, plus SPRINT_EXTRA in a launch wave. */
function dailyTargetNow(cfg: Config, now: Date): number {
  return cfg.dailyTarget + (launchWave(cfg, now) ? cfg.sprintExtra : 0);
}

/**
 * GAME_DAY_CAP (src/gamecap.ts): today's Shorts per capped game. The day's planned GTA File part counts while it is not
 * yet made and its slot is less than two hours past, so the news gives way to the series instead of the series losing
 * a numbered part; a part that could not be made frees its place.
 */
export async function gameCapCounts(s: Services): Promise<Map<string, number>> {
  const { db, cfg } = s;
  const now = s.now();
  let reserved = new Map<string, number>();
  const file = gtaFileFrom(cfg);
  if (file) {
    const today = dayKey(now, cfg.timezone);
    const part = readRun(file.runFile).find((e): e is RunFile => e.kind === "file" && e.date === today);
    const slot = part ? localTime(part.date, part.slot ?? file.slot, cfg.timezone) : undefined;
    // Only a part whose slot can still run holds a place: a Why day, a Why slot, and no other Short already in it.
    const canRun =
      !!part &&
      !!slot &&
      slot.getTime() > now.getTime() - 2 * 3_600_000 &&
      cfg.whyEnabled &&
      cfg.whySlots.includes(part.slot ?? file.slot) &&
      cfg.whyDays.includes(weekday(slot, cfg.timezone));
    if (part && slot && canRun) {
      const [made] = await db.query(
        `SELECT 1 AS made FROM episodes WHERE story_hash = $1 AND status NOT IN ('failed','rejected') LIMIT 1`,
        [`gtafile:${part.part}`],
      );
      const [taken] = made
        ? [undefined]
        : await db.query(
            `SELECT 1 AS taken FROM episodes WHERE slot_at = $1 AND status NOT IN ('failed','rejected') LIMIT 1`,
            [slot],
          );
      if (!made && !taken)
        reserved = reserveFor(cfg.gameDayCap, `${gtaFileTitle(part.part, part.title)} ${part.game ?? GTA_FILE_GAME}`);
    }
  }
  return gameCountsToday(db, cfg.gameDayCap, cfg.timezone, now, reserved);
}

export async function maybeSelect(s: Services): Promise<string | undefined> {
  const { db, cfg } = s;
  const now = s.now();
  const paused = await selectionPause(db, now);
  // A big story that cannot go yet is still judged and recorded; a fault here must never stop the usual lanes.
  const bigStep = (blocked?: string) =>
    maybeSelectBig(s, blocked).catch((err) => {
      log("warn", "big story desk failed", { error: errorMessage(err) });
      return undefined;
    });
  if (paused) {
    log("info", "story selection paused", { reason: paused });
    await bigStep(`story selection is paused: ${paused}`);
    return undefined;
  }
  const producing = await countProducing(db);
  if (producing >= cfg.maxProducing) {
    // WHY_SLOT_SEAT (src/whyseat.ts): a Why slot whose window is open gets one seat past the limit, so two slow
    // Shorts no longer empty it (25 Nov 2026: 17:16 to 19:01 every tick waited, and the 18:30 Why never started).
    const seated =
      whySeatOpen(cfg.whySlotSeat, producing, cfg.maxProducing) &&
      (await shortsTowardTarget(db, cfg)) < dailyTargetNow(cfg, now)
        ? await maybeSelectWhy(s).catch((err) => {
            if (err instanceof FatalError) throw err; // announced by tick(), as on the usual path
            log("warn", "why seat selection failed", { error: errorMessage(err) });
            return undefined;
          })
        : undefined;
    if (seated) {
      log("info", "why slot took the spare production seat", { id: seated, producing, max: cfg.maxProducing });
      await logEvent(db, seated, "why_seat", { producing, max: cfg.maxProducing });
      return seated;
    }
    await bigStep(`waiting: ${cfg.maxProducing} Shorts are already in production`);
    return undefined;
  }
  const big = await bigStep();
  if (big) return big;
  const cut = await maybeSelectCutdown(s).catch((err) => {
    log("warn", "cutdown selection failed", { error: errorMessage(err) });
    return undefined;
  });
  if (cut) return cut;
  // The funnel test's Shorts, cut from this week's guide (src/funnel.ts, FUNNEL_TEST); off: nothing.
  const funnelCut = await maybeSelectFunnelCut(s).catch((err) => {
    log("warn", "funnel cut selection failed", { error: errorMessage(err) });
    return undefined;
  });
  if (funnelCut) return funnelCut;
  const premade = await maybeSelectPremade(s).catch((err) => {
    log("warn", "pre-make selection failed", { error: errorMessage(err) });
    return undefined;
  });
  if (premade) return premade;
  // SEARCH_SHORTS (src/searchq): a search slot due now takes the best makeable query of the last harvest. Its own
  // slots and its own allowance: it never takes a news slot, and it is not counted in the daily target below.
  // GAME_DAY_CAP: counted once a tick, before the search and news slots read it; a fault leaves the cap open.
  const capCounts = cfg.gameDayCap.length
    ? await gameCapCounts(s).catch((err) => {
        log("warn", "game day cap count failed", { error: errorMessage(err) });
        return undefined;
      })
    : undefined;
  const searched = await maybeSelectSearch({
    db,
    cfg,
    now: s.now,
    skipText: capCounts
      ? (text) => filterCapped([text], (t) => t, cfg.gameDayCap, capCounts).dropped.length > 0
      : undefined,
    ownFootage: (game) =>
      franchiseOwnFootage(cfg, { aliases: gameAliases(game) }),
  }).catch((err) => {
    log("warn", "search selection failed", { error: errorMessage(err) });
    return undefined;
  });
  if (searched) return searched;
  // COMMENT_REPLY_SHORTS: the day's video reply to a viewer's question, near its own slot (src/commentreply.ts).
  const replied = await maybeSelectCommentReply(s).catch((err) => {
    log("warn", "reply Short selection failed", { error: errorMessage(err) });
    return undefined;
  });
  if (replied) return replied;
  // Spare-quota Shorts are extra: they never take one of the day's planned Shorts. Nor does a big story, and a long
  // video is not a Short at all (4 Nov 2026: a documentary and a ranking used up the 22:00 slot's turn, silently).
  const total = await shortsTowardTarget(db, cfg);
  // A long video is not one of the day's Shorts, so the Shorts allowance never holds it back (24-25 Nov 2026: the
  // documentary failed in the afternoon and, with the day's Shorts made, nothing could pick its replacement until
  // the next day; the 19:00 slot passed empty). Documentary first, then the long ranking, then spare Shorts.
  if (total >= dailyTargetNow(cfg, now))
    return (await maybeSelectLongAfterTarget(s)) ?? (await maybeSelectSpare(s)) ?? undefined;

  const seen = await seenHashes(db);
  const sightings = (await recentSightings(s)).filter(
    (x) =>
      !seen.has(x.cluster.hash) &&
      // A story the big-story desk has made or sees planned is not picked again by a slot under another of its hashes.
      !(cfg.bigStoryMode === "make" && lastBigCovered.has(x.cluster.hash)),
  );
  // Rumours are capped a day: once today's is in, stories carrying rumour signals wait for tomorrow.
  const rumoursToday = cfg.includeRumours
    ? await countRumoursToday(db, cfg.timezone)
    : 0;
  const rumourCap = await rumoursPerDayNow(db, cfg); // the leak verdict may have lowered it (src/experiments.ts)
  const eligible = sightings
    .filter(
      (x) =>
        x.cluster.corroborated ||
        (cfg.includeRumours && x.cluster.rumourSignals),
    )
    .filter((x) => !(x.cluster.rumourSignals && rumoursToday >= rumourCap))
    .filter((x) => x.cluster.score > 0);

  // 1. Breaking lane. During a live showcase (a Direct, a State of Play) it sprints: a few more
  // Shorts that day and a lower bar for the showcase's own stories, but only while the quota still
  // covers every upload already scheduled for today.
  const showcase = showcaseLive(eligible, now);
  const wave = launchWave(cfg, now);
  const sprint =
    (!!showcase || wave) &&
    (await quotaHeadroom(db, cfg, now)) >= QUOTA_RESERVE_FOR_UPLOAD;
  // One a day; a second only for a very big story (BREAKING_BIG_SCORE, src/storymix.ts).
  const allowance = breakingAllowance(
    await countToday(db, cfg.timezone, "news_breaking"),
    cfg.breakingPerDay + (sprint ? cfg.sprintExtra : 0),
    cfg.breakingBigScore,
  );
  if (cfg.breakingEnabled && allowance.open) {
    const rule = {
      scoreMin: cfg.breakingScoreMin,
      maxAgeMinutes: cfg.breakingMaxAgeMinutes,
      window: cfg.breakingWindow,
      timeZone: cfg.timezone,
    };
    const cooled = new Set(
      (
        await db.query<{ franchise: string }>(
          `SELECT franchise FROM breaking_log WHERE fired_at > $2::timestamptz - ($1 || ' hours')::interval`,
          [String(cfg.breakingCooldownHours), now],
        )
      ).map((r) => r.franchise),
    );
    // BREAKING_HOME_ONLY (format redesign plan item 2): only home-shelf games, or a story the desk rates major.
    const major = cfg.breakingHomeOnly
      ? new Set(
          (await currentStories(db, cfg, now).catch(() => []))
            .filter((st) => st.size >= cfg.bigStorySize)
            .flatMap((st) => st.hashes),
        )
      : new Set<string>();
    const qualified = eligible.filter(
      (x) =>
        breakingAllowed(cfg, storyText(x.cluster), major.has(x.cluster.hash)) &&
        (isBreaking(x.cluster, x.sighting, now, rule) ||
          (sprint &&
            (SHOWCASE.test(storyText(x.cluster)) ||
              (wave && focusMatch(cfg, storyText(x.cluster)))) &&
            isBreaking(x.cluster, x.sighting, now, {
              ...rule,
              scoreMin: cfg.sprintScoreMin,
            }))) &&
        !cooled.has(franchiseKey(x.cluster)) &&
        // DROP_ANGLE: an official drop keeps the usual news slot instead of racing.
        !(cfg.dropAngle && isOfficialDrop(x.cluster)),
    );
    const big = qualified.filter(
      (x) => breakingScore(x.cluster, x.sighting) >= allowance.minScore,
    );
    // A story that would have broken but for the one-a-day rule: logged, and one evening-summary line a day.
    const passed = qualified.find((x) => !big.includes(x));
    if (
      passed &&
      !(await weeklyTried(db, `breaking_held:${dayKey(now, cfg.timezone)}`))
    ) {
      const score = breakingScore(passed.cluster, passed.sighting);
      await logEvent(db, null, "breaking_held", {
        headline: passed.cluster.headline,
        score,
        bar: allowance.minScore,
      });
      await s.notify({
        level: "info",
        content: breakingHeldLine(
          passed.cluster.headline,
          score,
          cfg.breakingPerDay,
          allowance.minScore,
        ),
      });
    }
    const breaking = big.map((x) => x.cluster).slice(0, 4);
    if (breaking.length) {
      const id = await createFromChoice(
        s,
        breaking,
        { lane: "news_breaking", priority: LANE_PRIORITY.news_breaking },
        "breaking: official, fresh and scored above the bar",
      );
      if (id) {
        const ep = await getEpisode(db, id);
        await db.query(
          `INSERT INTO breaking_log (story_hash, franchise, episode_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [ep!.story_hash, franchiseKey(ep!.story_json), id],
        );
        // The 03:00 rule: a big overnight story moves the morning's first planned Short to the next open slot.
        const chosen = big.find((x) => x.cluster.hash === ep!.story_hash);
        if (chosen)
          await bumpForBreaking(s, id, breakingScore(chosen.cluster, chosen.sighting)).catch((err) =>
            log("warn", "overnight slot move failed", { error: errorMessage(err) }),
          );
        await s.notify({
          level: "info",
          content: `Breaking story picked${sprint ? ` (${showcase ?? `${cfg.focusTopic} launch wave`})` : ""}: "${ep!.story_json.headline}"`,
        });
        return id;
      }
    }
  }

  // 2. News lane: the next slot whose lead time has begun.
  const slot = dueSlot(
    now,
    {
      slots: cfg.newsSlots,
      leadMinutes: cfg.slotLeadMinutes,
      graceMinutes: cfg.slotGraceMinutes,
      timeZone: cfg.timezone,
    },
    await takenSlots(db),
  );
  // SHORTS_PER_DAY_MAX (src/cadence.ts): once the day's news allowance is used, the slot is held back and the
  // stories that were waiting for it are named once in the evening summary. The slot also leaves room for
  // the Why slots still to come today (story first, src/storymix.ts).
  const capped =
    !!slot &&
    (await holdSlotForCap(
      db,
      cfg,
      now,
      slot,
      eligible.map((x) => ({
        headline: x.cluster.headline,
        score: x.cluster.score,
      })),
      (m) => s.notify(m),
      whySlotsAhead(cfg, now, await takenSlots(db)),
    ).catch((err) => {
      log("warn", "news cap check failed", { error: errorMessage(err) });
      return false;
    }));
  if (!slot || capped)
    return (
      (await maybeSelectDocumentary(s)) ??
      (await maybeSelectEveryGame(s)) ??
      (await maybeSelectEvergreen(s)) ??
      (await maybeSelectWeekly(s)) ??
      (await maybeSelectLongform(s)) ??
      (await maybeSelectWhy(s)) ??
      (await maybeSelectSpare(s))
    );
  // ANALYTICS_LOOP_SCORING (src/loopfeedback.ts): the weekly report's small multiplier per story type and format
  // reorders the slot's candidates (sightings arrive best score first, so with no multipliers nothing moves).
  // Breaking news above never passes through it: speed matters more than format.
  // LOOP_FANDOM_WEIGHT: the report's strong-fandom key lifts (or lowers) a story in a strong-identity fandom too.
  const loopW = loopWeights(cfg, now);
  const weights = cfg.loopFandomWeight ? loopW : withoutFandomWeight(loopW);
  const weighted = (x: (typeof eligible)[number]) => {
    const k = guessKind(x.cluster.headline, x.cluster.rumourSignals);
    return (
      breakingScore(x.cluster, x.sighting) *
      pickWeight(
        weights,
        k.storyType,
        k.format,
        strongFandom({ title: x.cluster.headline, game: x.cluster.gameHint }),
      )
    );
  };
  const ranked = (
    Object.keys(weights).length
      ? [...eligible].sort((a, b) => weighted(b) - weighted(a))
      : eligible
  ).map((x) => x.cluster);
  // GAME_DAY_CAP (src/gamecap.ts): a story naming a game whose Shorts for the day are used up leaves the slot's list
  // before the best twelve are taken; when every story names one, the slot keeps them all (an empty slot costs more).
  const capCut = capCounts
    ? filterCapped(ranked, (c) => `${c.headline} ${c.gameHint ?? ""}`, cfg.gameDayCap, capCounts)
    : undefined;
  const candidates = (capCut?.kept ?? ranked).slice(0, 12);
  if ((capCut?.dropped.length || capCut?.allCapped) && !(await weeklyTried(db, `gamecap:${slot.toISOString()}`))) {
    log("info", "game day cap held stories back", {
      slot: slot.toISOString(),
      dropped: capCut.dropped.slice(0, 12).map((d) => `${d.game}: ${d.item.headline}`),
      allCapped: capCut.allCapped,
    });
    await logEvent(db, null, "game_day_cap", {
      slot: slot.toISOString(),
      dropped: capCut.dropped.slice(0, 12).map((d) => ({ game: d.game, headline: d.item.headline })),
      allCapped: capCut.allCapped,
      counts: Object.fromEntries(capCounts ?? []),
    }).catch(() => undefined);
  }
  if (candidates.length === 0) {
    log("info", "no eligible stories for the slot", {
      slot: slot.toISOString(),
      sightings: sightings.length,
    });
    return undefined;
  }
  // STORY_PREMISE_GATE_SHARE (src/editorial/premisegate.ts): on the "gate" side of the slot split, a story whose whole
  // point is that nothing is known, a price or edition list, patch notes or an outage, with no conflict or surprise,
  // is dropped before the editor sees the slot; when every candidate would go, the slot keeps them all.
  const premiseArm =
    cfg.storyPremiseGateShare > 0
      ? premiseArmFor(unitHash(`premise:${slot.toISOString()}`), cfg.storyPremiseGateShare)
      : undefined;
  const gated = premiseArm ? gateCandidates(candidates, premiseArm) : undefined;
  const id = await createFromChoice(
    s,
    gated?.kept ?? candidates,
    { lane: "news", priority: LANE_PRIORITY.news, slotAt: slot },
    `news slot ${slot.toISOString()}`,
  );
  // Logged per slot, made or not (the slot is the unit of the test): the episode it made, else none. A dropped story
  // stays eligible, so it may be made in a later "open" slot; the dropped headlines let the verdict see that.
  if (premiseArm && gated) {
    await logEvent(db, id ?? null, "premise_gate", {
      arm: premiseArm,
      slot: slot.toISOString(),
      dropped: gated.dropped,
      allFlagged: gated.allFlagged,
      candidates: candidates.length,
    }).catch(() => undefined);
    if (gated.dropped.length)
      log("info", "premise gate dropped stories", {
        id: id ?? null,
        dropped: gated.dropped.map((d) => `${d.kind}: ${d.headline}`),
      });
  }
  return id;
}

/** Whether the gameplay inbox holds a clip of the franchise, so a GTA File part can open on the owner's footage. */
export async function franchiseOwnFootage(
  cfg: Pick<Config, "footage" | "gameplayRoot">,
  file: Pick<GtaFile, "aliases">,
): Promise<boolean> {
  if (!cfg.footage || !cfg.gameplayRoot) return false;
  return Boolean(franchiseClip(file, await inboxFiles(cfg.gameplayRoot)));
}

/**
 * The Short length lanes with The Why's serial band laid over them (WHY_SERIAL_ENABLED, WHY_TARGET_SECONDS), and on
 * a short-arm day of the Why length test (WHY_LENGTH_AB) The Why and The GTA File at 30-35 s.
 */
export function lengthsFor(
  cfg: Pick<Config, "shortLengths" | "whySerialEnabled" | "whyTargetSeconds">,
  arm?: LengthArm,
): ShortLengths {
  return withLengthArm(
    withWhyTarget(cfg.shortLengths, cfg.whySerialEnabled, cfg.whyTargetSeconds),
    arm,
  );
}

/**
 * A Short's arm in the Why length test (WHY_LENGTH_AB): the one on its script once written, so the voice step and a
 * rewrite keep it; else, for a serial Why or GTA File part, the UTC day of its slot (or of its making). Undefined for
 * every other Short, and while the test or the serial is off.
 */
export function lengthArmFor(
  cfg: Pick<Config, "whyLengthAb" | "whySerialEnabled" | "whyTargetSeconds">,
  ep: Pick<Episode, "lane" | "story_json" | "script_json" | "slot_at" | "created_at">,
): LengthArm | undefined {
  if (ep.script_json?.length_arm) return ep.script_json.length_arm.arm;
  if (!cfg.whyLengthAb || !cfg.whySerialEnabled || !cfg.whyTargetSeconds) return undefined;
  const format = lengthFormatOf(ep);
  if (format !== "why" && format !== "gta_file") return undefined;
  const day = ep.slot_at ?? ep.created_at;
  return day ? lengthArm(new Date(day).toISOString()) : undefined;
}

/** A Why's place in the numbered series (WHY_SERIAL_ENABLED); undefined when the serial is off. */
async function whySerialFor(
  s: Services,
  home: boolean,
): Promise<{ number: number; home: boolean } | undefined> {
  if (!s.cfg.whySerialEnabled) return undefined;
  return { number: await nextWhyNumber(s.db), home };
}

/**
 * A part of The GTA File (src/gtafile.ts) from its run file: like a planned Why, its sources are read and its angle
 * set by hand, so the editor, the freshness rule and the demand check stay out of it. The callback quotes what the
 * last part said when it went out; the hook opens on the owner's GTA VI footage when the inbox has a clip.
 */
export async function selectGtaFilePart(
  s: Services,
  file: GtaFile,
  e: RunFile,
  due: Date,
): Promise<string | undefined> {
  const now = s.now();
  const read = await Promise.all(
    e.sources.map((u) => s.fetchArticle(u.url).catch(() => undefined)),
  );
  const items = e.sources
    .map((u, i) => ({ u, a: read[i] }))
    .filter((x) => x.a)
    .map(({ u, a }) => ({
      title: a!.title,
      url: u.url,
      summary: "",
      publishedAt: now.toISOString(),
      source: u.source,
      sourceKind: u.official ? ("official" as const) : ("outlet" as const),
    }));
  // Confirmed facts only: with no official source readable, the part waits rather than run on outlets alone.
  if (!items.some((i) => i.sourceKind === "official")) {
    log("warn", "GTA File part has no readable official source", {
      part: e.part,
    });
    return undefined;
  }
  const [prev] = await s.db.query<{
    title: string | null;
    take: string | null;
  }>(
    `SELECT script_json->'youtube'->>'title' AS title, script_json->'pulse_take'->>'narration' AS take FROM episodes
      WHERE story_hash = $1 AND status NOT IN ('failed','rejected') AND script_json IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [`gtafile:${e.part - 1}`],
  );
  const ownFootage = await franchiseOwnFootage(s.cfg, file).catch(() => false);
  const cluster: StoryCluster = {
    hash: `gtafile:${e.part}`,
    headline: gtaFileTitle(e.part, e.title),
    items,
    sources: [...new Set(items.map((i) => i.source))],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: e.game ?? GTA_FILE_GAME,
    visualNeed: "game_footage",
    run: true,
    why: { question: e.question, angle: e.angle, follow: { kind: "series" } },
    gtaFile: {
      name: file.name,
      franchise: file.franchise,
      part: e.part,
      recap: e.recap,
      ...(prev?.title
        ? {
            previous: `"${prev.title}"${prev.take ? `, verdict: "${prev.take}"` : ""}`,
          }
        : {}),
      facts: e.facts,
      ownFootage,
    },
  };
  const id = shortId();
  if (
    !(await createEpisode(s.db, id, cluster, {
      lane: "news",
      priority: LANE_PRIORITY.news,
      slotAt: due,
    }))
  )
    return undefined;
  await logEvent(s.db, id, "selected", {
    headline: cluster.headline,
    lane: "gta_file",
    part: e.part,
    own_footage: ownFootage,
    slot_at: due.toISOString(),
  });
  log("info", "GTA File part selected", { id, part: e.part });
  return id;
}

/**
 * Evergreen lane: on its days, a lead time before its slot, pick a ranking
 * topic from what people are buying and the franchise seeds, avoiding topics
 * covered in the last six months.
 */
/** What an every-game Short's episode carries from its selection to its script (factcheck_json.every_game). */
export interface EveryGameJob {
  series: string;
  /** The Short's YouTube title, word for word, when the plan fixes one. */
  title?: string;
  wiki?: string;
  scope: "every" | "mainline";
  roster: SeriesRoster;
}

/**
 * "The Story of Every [series] Game" as a Short (src/everygame.ts): behind EVERYGAME_ENABLED and the entry's own
 * "on", a planned series takes its slot inside the evergreen lane's lead time. Nothing planned, nothing changes.
 */
export async function maybeSelectEveryGame(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.everyGameEnabled) return undefined;
  const due = everyShortDue(
    readEveryGamePlan(cfg.everyGameFile),
    true,
    s.now(),
    await takenSlots(db),
    {
      timeZone: cfg.timezone,
      leadMinutes: cfg.slotLeadMinutes + 45,
      graceMinutes: cfg.slotGraceMinutes,
    },
  );
  if (!due) return undefined;
  return createEveryGameShort(s, due.entry, due.at);
}

/** Creates the Short's episode for one planned series: its roster is read from IGDB now and kept with it. */
export async function createEveryGameShort(
  s: Services,
  entry: EveryGameEntry,
  due: Date,
): Promise<string | undefined> {
  const { db } = s;
  const now = s.now();
  const roster = await loadEveryGameRoster(s, entry);
  const picked = shortEntries(roster);
  if (picked.scope === "too_few" || picked.scope === "too_many") {
    if (!(await weeklyTried(db, `everygame:${entry.series}`)))
      await s.notify({
        content: `The every-game Short for ${entry.series} will not run: IGDB lists ${roster.entries.length} games, ${picked.scope === "too_few" ? "too few for the format" : "too many for 60 seconds even as main games only"}.`,
      });
    return undefined;
  }
  const slug = entry.series
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const headline = entry.short_video?.title ?? entry.title;
  const cluster: StoryCluster = {
    hash: `everygame:short:${slug}`,
    headline,
    items: [],
    sources: ["IGDB"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: entry.series,
  };
  const id = shortId();
  const created = await createEpisode(db, id, cluster, {
    lane: "evergreen",
    priority: LANE_PRIORITY.evergreen,
    slotAt: due,
  });
  if (!created) return undefined;
  const job: EveryGameJob = {
    series: entry.series,
    ...(entry.short_video?.title ? { title: entry.short_video.title } : {}),
    ...(entry.wiki ? { wiki: entry.wiki } : {}),
    scope: picked.scope,
    roster,
  };
  await db.query(
    `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
    [
      id,
      JSON.stringify({
        topic: {
          candidate_index: 0,
          format: "every_game",
          theme: entry.series,
          title_idea: headline,
          criterion: "release order",
          reason: "Planned in the every-game schedule",
        },
        every_game: job,
      }),
    ],
  );
  await logEvent(db, id, "selected", {
    headline,
    lane: "evergreen",
    format: "every_game",
    theme: entry.series,
    games: picked.entries.length,
    scope: picked.scope,
    left_out: roster.dropped.length,
    slot_at: due.toISOString(),
  });
  log("info", "every-game Short selected", {
    id,
    series: entry.series,
    games: picked.entries.length,
  });
  return id;
}

/**
 * Writes an every-game Short: the roster kept exactly, the house rules, then the fact check against the roster and
 * the series' article. What may never ship (a changed roster, an invented experience, a title outside the honest
 * frame) stops the step; the rest is a style warning after the rewrites.
 */
async function stepScriptEveryGame(
  s: Services,
  ep: Episode,
  job: EveryGameJob,
): Promise<void> {
  const roster = job.roster;
  const entries =
    job.scope === "mainline"
      ? roster.entries.filter((e) => e.kind !== "expansion")
      : roster.entries;
  const background = await s
    .research(job.wiki ?? roster.series, `${roster.series} video game series`, 9000)
    .catch(() => undefined);
  const opts = {
    ...(job.title ? { title: job.title } : {}),
    ...(background?.text ? { background: background.text } : {}),
    scope: job.scope,
  };
  let draft: EveryGameShort | undefined;
  let feedback: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    draft = await writeEveryGameShort(s.llm, roster, entries, { ...opts, feedback });
    feedback = validateEveryGameShort(draft, roster, entries, opts);
    if (!feedback.length) break;
  }
  if (!draft) throw new Error("every-game script produced nothing");
  const facts = [
    {
      title: "The roster this Short was built from (IGDB: titles, release years, platforms, the order)",
      facts: rosterBrief(roster, entries),
    },
    ...(background?.text
      ? [{ title: `Background notes: ${background.title}`, facts: background.text }]
      : []),
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const factual = await adjudicateRanking(
      s,
      ep,
      everyGameToScript(draft, roster, entries),
      [],
      attempt,
      facts,
      (fx) => {
        const r = applyVaultFixes(draft!, fx);
        draft = r.value;
        return r.applied;
      },
    );
    if (!factual.length) break;
    draft = await writeEveryGameShort(s.llm, roster, entries, {
      ...opts,
      feedback: [...factual, ...validateEveryGameShort(draft, roster, entries, opts)],
    });
  }
  const left = validateEveryGameShort(draft, roster, entries, opts);
  const must = mustFixEveryGame(draft, roster, entries, opts);
  if (must.length) throw new Error(`every-game script not fit to voice: ${must[0]}`);
  if (left.length) await logEvent(s.db, ep.id, "style_warnings", { problems: left });
  const script = everyGameToScript(draft, roster, entries);
  await guardScript(s, ep, script, "after writing");
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      ...(ep.factcheck_json as Record<string, unknown> | null),
      every_game: job,
    },
  });
}

/**
 * The long video's outline for an every-game documentary: one chapter per roster game in release order, sent back
 * once when it breaks that; an outline that still leaves a game out stops the step.
 */
async function everyGameOutlineFor(
  s: Services,
  ep: Episode,
  topic: DocTopic,
  notes: string,
): Promise<import("./editorial/documentary.ts").DocOutline> {
  const roster = topic.roster!;
  let outline = await outlineEveryGame(s.llm, roster, topic.title_idea, topic.angle, notes);
  let problems = validateEveryGameOutline(outline, roster);
  if (problems.length) {
    outline = await outlineEveryGame(s.llm, roster, topic.title_idea, topic.angle, notes, {
      feedback: problems,
    });
    problems = validateEveryGameOutline(outline, roster);
  }
  await logEvent(s.db, ep.id, "every_game_outline", {
    chapters: chapterList(outline, roster),
    problems,
  });
  if (problems.length)
    throw new Error(`every-game outline not fit to write: ${problems[0]}`);
  return everyGameDocOutline(outline, roster, topic.title_idea);
}

export async function maybeSelectEvergreen(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.evergreenEnabled) return undefined;
  const now = s.now();
  const due = evergreenDue(
    now,
    {
      days: cfg.evergreenDays,
      slot: cfg.evergreenSlot,
      leadMinutes: cfg.slotLeadMinutes + 45,
      graceMinutes: cfg.slotGraceMinutes,
      timeZone: cfg.timezone,
    },
    await takenSlots(db),
  );
  if (!due) return undefined;
  if (await bumpFiller(db, cfg, "evergreen", now)) return undefined;
  return createEvergreen(s, due);
}

/** Picks an evergreen ranking topic and creates its episode for `due`; `spare` marks a spare-quota Short. */
async function createEvergreen(
  s: Services,
  due: Date,
  spare = false,
): Promise<string | undefined> {
  const { db } = s;
  const now = s.now();
  const covered = (
    await db.query<{ headline: string }>(
      `SELECT story_json->>'headline' AS headline FROM episodes WHERE lane = 'evergreen' AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '180 days'`,
      [now],
    )
  ).map((r) => r.headline);
  // Ranked by recent YouTube demand, topics with none skipped (src/discovery/searchdemand.ts).
  const { candidates, demand, skipped } = await demandRanked(
    s,
    await s.discoverEvergreen(),
  );
  if (!candidates.length) return undefined;
  const topic = await selectEvergreenTopic(
    s.llm,
    candidates,
    covered,
    await topicDemand(s, "evergreen"),
  );
  if (topic.candidate_index < 0 || !candidates[topic.candidate_index]) {
    log("info", "editor passed on every evergreen candidate", {
      reason: topic.reason,
    });
    return undefined;
  }
  const pickedDemand = demand.get(candidates[topic.candidate_index]!.name);
  const slug = topic.theme
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const cluster: StoryCluster = {
    hash: `evergreen:${topic.format}:${slug}:${now.toISOString().slice(0, 7)}`,
    headline: topic.title_idea,
    items: [],
    sources: ["Steam"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: topic.theme,
  };
  const id = shortId();
  const created = await createEpisode(db, id, cluster, {
    lane: "evergreen",
    priority: LANE_PRIORITY.evergreen,
    slotAt: due,
  });
  if (!created) return undefined;
  await db.query(
    `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
    [id, JSON.stringify(spare ? { topic, spare: true } : { topic })],
  );
  await logEvent(db, id, "selected", {
    headline: topic.title_idea,
    lane: "evergreen",
    spare,
    format: topic.format,
    theme: topic.theme,
    criterion: topic.criterion,
    reason: topic.reason,
    demand: pickedDemand ?? null,
    demand_skipped: skipped.map((c) => c.name),
    slot_at: due.toISOString(),
  });
  await reportDemand(
    s,
    `ranking Short at ${slotLabel(due, s.cfg.timezone)}`,
    topic.theme,
    pickedDemand,
    skipped.length,
  );
  log("info", "evergreen topic selected", {
    id,
    format: topic.format,
    theme: topic.theme,
  });
  return id;
}

/**
 * The "Why" lane: on its days, a lead time before its slot, the editor picks one question about a
 * well-known game that its Wikipedia article can answer; the Short is then written and fact-checked
 * like a news Short, from that article.
 */
const WHY_DROP_RETRIES = 2;

/**
 * A Why Short from the launch run. The topic, its sources and its angle come from the plan, so the editor, the
 * two-week freshness rule and the demand check stay out of it; the writer and the fact check run as usual against
 * the entry's own sources. With no source readable there is nothing to check against, so the slot goes to the editor.
 */
export async function selectRunWhy(
  s: Services,
  e: RunWhy | RunSpare,
  due: Date | undefined,
  /** premade: made ahead of its slot and held; spare: no slot until a slot would go out empty (src/shortrun.ts). */
  how: { premade?: boolean; spare?: boolean } = {},
): Promise<string | undefined> {
  const now = s.now();
  const read = await Promise.all(
    e.sources.map((u) => s.fetchArticle(u.url).catch(() => undefined)),
  );
  const items = e.sources
    .map((u, i) => ({ u, a: read[i] }))
    .filter((x) => x.a)
    .map(({ u, a }) => ({
      title: a!.title,
      url: u.url,
      summary: "",
      publishedAt: now.toISOString(),
      source: u.source,
      sourceKind: u.official ? ("official" as const) : ("outlet" as const),
    }));
  if (!items.length) {
    log("warn", "launch run topic has no readable source", { topic: e.question });
    return undefined;
  }
  const follow = await followFor(s.db, e.game, now).catch(() => ({
    kind: "series" as const,
  }));
  const serial = await whySerialFor(s, false);
  const cluster: StoryCluster = {
    hash: `why:${whySlug(e.question)}`,
    headline: e.title,
    items,
    sources: [...new Set(items.map((i) => i.source))],
    hasOfficial: items.some((i) => i.sourceKind === "official"),
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: e.game,
    visualNeed: "game_footage",
    run: true,
    why: {
      question: e.question,
      angle: e.angle,
      arc: e.arc,
      // 18 Nov: the owner's "How to Play GTA 6 Without a PS5 or Series X" went up as the writer's own title.
      ...(e.title ? { title: e.title } : {}),
      follow,
      ...(how.premade && due ? { airs_at: due.toISOString() } : {}),
      ...(e.kind === "why" && e.key_date ? { key_date: e.key_date } : {}),
      ...(serial ? { serial } : {}),
    },
    ...(how.premade ? { premade: true } : {}),
    ...(how.spare && e.kind === "spare"
      ? { spare: { ...(e.from ? { from: e.from } : {}), ...(e.until ? { until: e.until } : {}) } }
      : {}),
  };
  const id = shortId();
  if (
    !(await createEpisode(s.db, id, cluster, {
      lane: "news",
      // Made ahead: today's own Shorts go first on every tick.
      priority: how.premade || how.spare ? LANE_PRIORITY.news - 10 : LANE_PRIORITY.news,
      ...(due ? { slotAt: due } : {}),
    }))
  )
    return undefined;
  await logEvent(s.db, id, "selected", {
    headline: e.title,
    lane: "why",
    run: true,
    question: e.question,
    game: e.game,
    slot_at: due?.toISOString() ?? null,
    ...(how.premade ? { premade: true } : {}),
    ...(how.spare ? { spare: true } : {}),
  });
  log("info", "launch run topic selected", { id, question: e.question });
  return id;
}

/**
 * Pre-make (launch plan, 11 Nov 2026): a planned Why whose make time has come (make_at, make_hours_before or
 * RUN_PREMAKE_HOURS) is written, voiced, rendered and picture-checked days ahead, then held and uploaded at its slot,
 * so a Mac, PC or checker failure in launch week cannot stop a scheduled post. Then the run's spares, made and held
 * with no slot. Only while nothing else is being made, so today's own Shorts always go first; one a tick.
 */
export async function maybeSelectPremade(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.whyEnabled || !cfg.shortRunFile) return undefined;
  const run = readRun(cfg.shortRunFile);
  if (!run.length) return undefined;
  if ((await countProducing(db)) > 0) return undefined;
  const now = s.now();
  const today = dayKey(now, cfg.timezone);
  const due = premakeDue(
    run,
    now,
    await takenSlots(db),
    cfg.timezone,
    cfg.runPremakeHours,
    cfg.slotLeadMinutes + 30,
  );
  for (const { entry, at } of due) {
    // One try a day per slot: a topic whose sources cannot be read is left to the slot's own lead time.
    if (await weeklyTried(db, `premake:${at.toISOString()}:${today}`)) continue;
    const id = await selectRunWhy(s, entry, at, { premade: true }).catch(
      (err) => {
        log("warn", "pre-make failed", {
          topic: entry.title,
          error: errorMessage(err),
        });
        return undefined;
      },
    );
    if (id) {
      log("info", "planned Why pre-made ahead of its slot", {
        id,
        slot: at.toISOString(),
      });
      return id;
    }
  }
  const made = new Set(
    (
      await db.query<{ hash: string }>(
        `SELECT story_hash AS hash FROM episodes WHERE story_hash LIKE 'why:%'`,
      )
    ).map((r) => r.hash),
  );
  for (const e of sparesDue(run, now)) {
    if (made.has(`why:${whySlug(e.question)}`)) continue;
    if (e.until && today > e.until) continue;
    if (await weeklyTried(db, `spare:${whySlug(e.question)}:${today}`))
      continue;
    const id = await selectRunWhy(s, e, undefined, { spare: true }).catch(
      (err) => {
        log("warn", "spare Short failed", {
          topic: e.title,
          error: errorMessage(err),
        });
        return undefined;
      },
    );
    if (id) return id;
  }
  return undefined;
}

/**
 * COMMENT_REPLY_SHORTS (src/commentreply.ts): once a day, from SLOT_LEAD_MINUTES + 90 before COMMENT_REPLY_SLOT, the
 * best viewer question the community engine filed this week becomes a Short in that slot, made by the news pipeline
 * from the original video's sources. An extra, like a spare: it never takes one of the day's planned Shorts. Nothing
 * suitable, a slot already taken or the slot passed: nothing today.
 */
export async function maybeSelectCommentReply(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.commentReplyShorts || !/^\d{1,2}:\d{2}$/.test(cfg.commentReplySlot)) return undefined;
  const now = s.now();
  const today = dayKey(now, cfg.timezone);
  const slot = localTime(today, cfg.commentReplySlot, cfg.timezone);
  const ahead = slot.getTime() - now.getTime();
  if (ahead <= 0 || ahead > (cfg.slotLeadMinutes + 90) * 60_000) return undefined;
  if ((await repliesToday(db, cfg.timezone)) >= REPLY_LIMITS.perDay) return undefined;
  // The search Shorts have their own slots (SEARCH_SLOTS): a reply never shares one.
  if (cfg.searchShorts?.enabled && cfg.searchShorts.slots.includes(cfg.commentReplySlot)) return undefined;
  if ((await takenSlots(db)).some((t) => t.getTime() === slot.getTime())) return undefined;
  const filed = await filedQuestions(db, now);
  const eps = new Map<string, Episode>();
  for (const id of new Set(filed.map((c) => c.episodeId))) {
    const ep = await getEpisode(db, id);
    if (ep?.script_json) eps.set(id, ep);
  }
  const pick = pickQuestion(
    filed,
    (id) => (eps.get(id) ? replyFacts(eps.get(id)!) : undefined),
    await usedComments(db),
    cfg.ruleOfTwo,
  );
  if (!pick) {
    // The pick reads only the database, so it is tried every tick of the window; said once a day.
    if (!(await weeklyTried(db, `reply-none:${today}`)))
      log("info", "no viewer question to answer with a Short yet today", { filed: filed.length });
    return undefined;
  }
  const original = eps.get(pick.episodeId)!;
  const cluster = replyCluster(original, pick);
  const id = shortId();
  if (
    !(await createEpisode(db, id, cluster, {
      lane: "news",
      priority: LANE_PRIORITY.news - 10,
      slotAt: slot,
    }))
  )
    return undefined;
  // Counted as a spare, so the day's planned Shorts are all still made (countSpareToday also knows it by its hash,
  // since the fact check replaces this record).
  await db.query(`UPDATE episodes SET factcheck_json = $2 WHERE id = $1`, [
    id,
    JSON.stringify({ spare: true, reply: true }),
  ]);
  await logEvent(db, id, "selected", {
    headline: cluster.headline,
    lane: "reply",
    comment: pick.commentId,
    video: pick.videoId,
    handle: cluster.reply!.handle,
    overlap: pick.overlap,
    slot_at: slot.toISOString(),
  });
  log("info", "viewer question selected for a reply Short", {
    id,
    question: cluster.reply!.card,
    slot: slot.toISOString(),
  });
  return id;
}

/**
 * A slot about to go out empty (RUN_SPARE_SLOTS, default WHY_SLOTS) gets the first ready spare: a run spare already
 * rendered, checked and approved, waiting with no slot (launch plan section 3). Nothing ready: nothing changes.
 */
export async function fillSpareGaps(s: Services): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.shortRunFile) return undefined;
  const now = s.now();
  const slots = cfg.runSpareSlots.length ? cfg.runSpareSlots : cfg.whySlots;
  const taken = await takenSlots(db);
  const today = dayKey(now, cfg.timezone);
  const gap = [today, addDays(today, 1)]
    .flatMap((d) => slots.map((sl) => localTime(d, sl, cfg.timezone)))
    .filter(
      (t) =>
        t.getTime() - now.getTime() <= cfg.runSpareMinutes * 60_000 &&
        t.getTime() - now.getTime() > -cfg.slotGraceMinutes * 60_000 &&
        !taken.some((x) => x.getTime() === t.getTime()),
    )
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (!gap) return undefined;
  // A slot the 03:00 rule emptied on purpose stays empty.
  const [bumped] = await db.query(`SELECT 1 FROM settings WHERE key = $1`, [
    `weekly_tried:bumped:${gap.toISOString()}`,
  ]);
  if (bumped) return undefined;
  const ready = await db.query<Episode>(
    `SELECT * FROM episodes WHERE status = 'approved' AND slot_at IS NULL AND story_json ? 'spare'
      ORDER BY created_at ASC`,
  );
  const day = dayKey(gap, cfg.timezone);
  const pick = ready.find((e) => spareFits(e.story_json.spare ?? {}, day));
  if (!pick) return undefined;
  const [moved] = await db.query<{ id: string }>(
    `UPDATE episodes SET slot_at = $2, next_attempt_at = NULL WHERE id = $1 AND slot_at IS NULL RETURNING id`,
    [pick.id, gap],
  );
  if (!moved) return undefined;
  await logEvent(db, pick.id, "spare_filled", { slot_at: gap.toISOString() });
  log("info", "a spare Short fills an empty slot", {
    id: pick.id,
    slot: gap.toISOString(),
  });
  await s
    .notify({
      level: "info",
      content: `The ${slotLabel(gap, cfg.timezone)} slot had nothing ready, so the spare "${pick.script_json?.youtube.title ?? pick.story_json.headline}" goes out in it.`,
    })
    .catch(() => undefined);
  return pick.id;
}

/**
 * The 03:00 story rule (launch plan section 4): an overnight breaking Short at or above BREAKING_BUMP_SCORE is bigger
 * than the morning's first planned Short, so that Short moves to the next open slot and the breaking story has the
 * morning to itself. Only a Short not yet sent to YouTube moves; one a day.
 */
export async function bumpForBreaking(
  s: Services,
  breakingId: string,
  score: number,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.breakingBumpScore || score < cfg.breakingBumpScore) return undefined;
  const now = s.now();
  const today = dayKey(now, cfg.timezone);
  const first = [...cfg.whySlots].sort()[0];
  if (!first) return undefined;
  const slot = localTime(today, first, cfg.timezone);
  // Overnight: before the first Why slot's own lead time began.
  if (slot.getTime() - now.getTime() < (cfg.slotLeadMinutes + 30) * 60_000)
    return undefined;
  const [ep] = await db.query<Episode>(
    `SELECT * FROM episodes WHERE slot_at = $1 AND status NOT IN ('failed','rejected','published','uploaded')
        AND youtube_video_id IS NULL AND upload_session_uri IS NULL AND id <> $2`,
    [slot, breakingId],
  );
  if (!ep) return undefined;
  if (await weeklyTried(db, `breaking_bump:${today}`)) return undefined;
  const slots = [...new Set([...cfg.whySlots, ...cfg.newsSlots])];
  const busy = [...(await takenSlots(db)), ...(await publishTimes(db, now))];
  const to = nextOpenSlot(
    slot,
    slots,
    busy,
    cfg.minUploadGapMinutes,
    (d, hhmm) => localTime(d, hhmm, cfg.timezone),
    (d) => dayKey(d, cfg.timezone),
  );
  if (!to) return undefined;
  // The morning stays the breaking story's: the Why lane and the spares leave the vacated slot alone.
  await weeklyTried(db, `why:${slot.toISOString()}`);
  await weeklyTried(db, `bumped:${slot.toISOString()}`);
  await db.query(
    `UPDATE episodes SET slot_at = $2, publish_at = CASE WHEN publish_at IS NULL THEN NULL ELSE $2::timestamptz END,
        next_attempt_at = CASE WHEN status = 'approved' AND next_attempt_at IS NOT NULL THEN $3::timestamptz ELSE next_attempt_at END
      WHERE id = $1`,
    [ep.id, to, new Date(to.getTime() - cfg.runPremakeUploadHours * 3600_000)],
  );
  await logEvent(db, ep.id, "slot_moved", {
    from: slot.toISOString(),
    to: to.toISOString(),
    reason: "overnight breaking story",
    breaking: breakingId,
  });
  await s
    .notify({
      level: "info",
      content: `An overnight story is bigger than the ${slotLabel(slot, cfg.timezone)} Short, so "${ep.story_json.headline}" moves to ${slotLabel(to, cfg.timezone)}.`,
    })
    .catch(() => undefined);
  return ep.id;
}

/**
 * A planned documentary is meant to be on YouTube, private and scheduled, RUN_DOC_PRIVATE_HOURS before its slot
 * (launch plan section 4: uploaded by 15:00 for 17:00, two hours to fix a failure). The factory's scheduled publish
 * already does the switch to public; this tells the owner once when the upload is late.
 */
export async function docUploadLate(s: Services): Promise<boolean> {
  const { db, cfg } = s;
  if (!cfg.shortRunFile || cfg.runDocPrivateHours <= 0) return false;
  const now = s.now();
  for (const e of readRun(cfg.shortRunFile)) {
    if (e.kind !== "doc") continue;
    const at = localTime(e.date, e.slot, cfg.timezone);
    const by = at.getTime() - cfg.runDocPrivateHours * 3600_000;
    if (now.getTime() < by || now.getTime() >= at.getTime()) continue;
    const [ep] = await db.query<Episode>(
      `SELECT * FROM episodes WHERE slot_at = $1 AND lane = 'longform' AND status NOT IN ('failed','rejected')`,
      [at],
    );
    if (ep?.youtube_video_id) continue;
    if (await weeklyTried(db, `doc_late:${at.toISOString()}`)) continue;
    await s.notify({
      ping: true,
      content: `The ${slotLabel(at, cfg.timezone)} documentary "${e.title}" is not on YouTube yet (${ep ? `it is at "${ep.status}"` : "it has not started"}). It was due up as private by ${slotLabel(new Date(by), cfg.timezone)}.`,
    });
    return true;
  }
  return false;
}
export async function maybeSelectWhy(s: Services): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.whyEnabled) return undefined;
  const now = s.now();
  // WHY_SLOTS: the first slot whose lead time has begun and no episode has taken (src/storymix.ts).
  const taken = await takenSlots(db);
  const due = cfg.whySlots
    .map((slot) =>
      evergreenDue(
        now,
        {
          days: cfg.whyDays,
          slot,
          leadMinutes: cfg.slotLeadMinutes + 30,
          graceMinutes: cfg.slotGraceMinutes,
          timeZone: cfg.timezone,
        },
        taken,
      ),
    )
    .find((d): d is Date => !!d);
  if (!due) return undefined;
  // One editor call per slot: a pass is not retried every tick. A pick dropped for failing its fact-check gets
  // a fresh game instead, up to WHY_DROP_RETRIES (1 Nov 2026: Diablo II failed at 16:55 and 18:30 went empty).
  const dropped = await db.query<{ game: string | null }>(
    `SELECT story_json->>'gameHint' AS game FROM episodes
      WHERE story_hash LIKE 'why:%' AND status = 'rejected'
        AND created_at > $1::timestamptz - interval '3 hours'`,
    [now],
  );
  if (dropped.length > WHY_DROP_RETRIES) return undefined;
  const tryKey = `why:${due.toISOString()}${dropped.length ? `:${dropped.length}` : ""}`;
  if (await weeklyTried(db, tryKey)) return undefined;
  // The news slots already gave way to this one; it is held only once the cap itself is reached.
  if (
    await holdWhyForCap(db, cfg, now, due, (m) => s.notify(m)).catch(
      () => false,
    )
  )
    return undefined;
  // The GTA File (src/gtafile.ts) owns its slot: the part planned for today, else the slot goes to the Why editor.
  const file = gtaFileFrom(cfg);
  if (file && isGtaFileSlot(file, due, cfg.timezone)) {
    const run = readRun(file.runFile);
    const part = gtaFileEntry(run, due, file, cfg.timezone);
    const planProblems = gtaFileRunProblems(run);
    if (planProblems.length)
      log("warn", "GTA File run file has problems", { problems: planProblems });
    if (part) {
      const made = await selectGtaFilePart(s, file, part, due).catch((err) => {
        log("warn", "GTA File part failed", {
          part: part.part,
          error: errorMessage(err),
        });
        return undefined;
      });
      if (made) return made;
    }
    log("info", "no GTA File part for the slot; the Why editor picks", {
      slot: due.toISOString(),
      part: part?.part ?? null,
    });
    await s
      .notify({
        level: "info",
        content: `The GTA File has ${part ? `part ${part.part} planned, but it could not be made (no official source readable, or it was made and dropped before)` : "no part planned"} for ${slotLabel(due, cfg.timezone)}; that slot gets an ordinary Why Short instead.`,
      })
      .catch(() => undefined);
  }
  // GAME_DAY_CAP (src/gamecap.ts): past the GTA File (never held), a Why on a game whose Shorts for the day are used up
  // is not made: a planned topic gives way to the editor, and the editor's list leaves that game out.
  const whyCaps = cfg.gameDayCap.length
    ? await gameCapCounts(s).catch((err) => {
        log("warn", "game day cap count failed", { error: errorMessage(err) });
        return undefined;
      })
    : undefined;
  const whyFull = (text: string) => !!whyCaps && !!fullCap(cfg.gameDayCap, whyCaps, text);
  // A topic planned for this slot (the launch run, src/shortrun.ts) goes first; with none usable the editor picks.
  let planned = whyRunEntry(readRun(cfg.shortRunFile), due, cfg.timezone);
  if (planned && whyFull(`${planned.title} ${planned.game}`)) {
    log("info", "planned Why held by the game day cap", { topic: planned.title, game: planned.game });
    planned = undefined;
  }
  // The news got there first: a big Short already said it, so the slot goes to the editor's pick.
  const beaten =
    planned && cfg.bigStoryMode === "make"
      ? runEntryCovered(planned, await recentCover(db, now), now)
      : undefined;
  if (planned && beaten) {
    log("info", "planned Why gives way to a big story already made", {
      topic: planned.title,
      episode: beaten.id,
    });
    await logEvent(db, beaten.id, "run_topic_superseded", { topic: planned.title });
    planned = undefined;
  }
  if (planned) {
    const made = await selectRunWhy(s, planned, due).catch((err) => {
      log("warn", "launch run topic failed", {
        topic: planned.question,
        error: errorMessage(err),
      });
      return undefined;
    });
    if (made) return made;
  }
  // Only a free pick gives way to a big story: a planned run topic never does.
  if (await bumpFiller(db, cfg, "why", now)) return undefined;
  const covered = (
    await db.query<{ headline: string }>(
      `SELECT story_json->>'headline' AS headline FROM episodes WHERE story_hash LIKE 'why:%' AND created_at > $1::timestamptz - interval '120 days'`,
      [now],
    )
  ).map((r) => r.headline);
  // Freshness (WHY_FRESH_DAYS, src/editorial/why.ts): no game or topic of the last two weeks' Why Shorts.
  const fresh = await db.query<{ game: string | null; hash: string }>(
    `SELECT story_json->>'gameHint' AS game, story_hash AS hash FROM episodes
      WHERE story_hash LIKE 'why:%' AND status NOT IN ('failed','rejected')
        AND created_at > $1::timestamptz - ($2 || ' days')::interval`,
    [now, String(cfg.whyFreshDays)],
  );
  const recent = {
    games: fresh.map((r) => r.game ?? "").filter(Boolean),
    slugs: fresh.map((r) => r.hash.replace(/^why:/, "")),
  };
  recent.games.push(...dropped.map((r) => r.game ?? "").filter(Boolean));
  // Well-loved games with a story arc first (WHY_SEEDS), then the evergreen list; recent games left out. A home slot
  // of the numbered serial (WHY_HOME_SHARE) offers only the home shelf's games (src/editorial/why.ts HOME_SHELF).
  const today = dayKey(now, cfg.timezone);
  const homeList =
    cfg.whySerialEnabled &&
    isHomeSlot(cfg.whyHomeShare, today, slotLabel(due, cfg.timezone))
      ? homeCandidates(cfg.whyHomeFranchises, today).filter(
          (c) => !recent.games.some((g) => sameGame(g, c.name)),
        )
      : [];
  const home = homeList.length > 0;
  const fresher = (
    home ? homeList : whyCandidates(await s.discoverEvergreen(), today)
  ).filter((c) => !recent.games.some((g) => sameGame(g, c.name)));
  const uncapped = fresher.filter((c) => !whyFull(c.name));
  const base = uncapped.length ? uncapped : fresher;
  const { candidates, demand, skipped } = await demandRanked(s, base);
  if (!candidates.length) return undefined;
  const demandText = await topicDemand(s, "why");
  let topic = await selectWhyTopic(
    s.llm,
    candidates,
    covered,
    demandText,
    recent.games,
  );
  let stale =
    topic.candidate_index >= 0
      ? whyFreshProblems(topic, recent, cfg.whyFreshDays)
      : [];
  if (stale.length) {
    // One more low-tier call with the reason; a second miss passes on the slot.
    topic = await selectWhyTopic(
      s.llm,
      candidates,
      covered,
      demandText,
      recent.games,
      stale,
    );
    stale =
      topic.candidate_index >= 0
        ? whyFreshProblems(topic, recent, cfg.whyFreshDays)
        : [];
  }
  if (topic.candidate_index < 0 || stale.length) {
    log("info", "editor passed on every why question", {
      reason: stale.length ? stale.join(" ") : topic.reason,
    });
    await logEvent(db, null, "why_passed", {
      slot_at: due.toISOString(),
      reason: stale.length ? stale.join(" ") : topic.reason,
    });
    return undefined;
  }
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(topic.wikipedia_title.replace(/ /g, "_"))}`;
  const article = await s.fetchArticle(url);
  if (!article) {
    log("info", "why question has no usable Wikipedia article", {
      title: topic.wikipedia_title,
    });
    return undefined;
  }
  // PRIMARY_SOURCES: the originals the article cites are read and become the Short's own sources, so the writer
  // credits IGN or the studio, never Wikipedia (src/discovery/wikirefs.ts). The article stays as background.
  const originals = s.cfg.primarySources
    ? ((
        await s
          .research(topic.wikipedia_title, topic.game, 9000, topic.question)
          .catch(() => undefined)
      )?.primaries ?? [])
    : [];
  const slug = whySlug(topic.question);
  // The reason to follow in the last line: our documentary or ranking on the game, else the series.
  const follow = await followFor(db, topic.game, now).catch(() => ({
    kind: "series" as const,
  }));
  const serial = await whySerialFor(s, home);
  const cluster: StoryCluster = {
    hash: `why:${slug}`,
    headline: topic.title,
    items: [
      {
        title: article.title,
        url,
        summary: "",
        publishedAt: now.toISOString(),
        source: s.cfg.primarySources ? "Background notes" : "Wikipedia",
        sourceKind: "outlet",
      },
      ...originals.map((o) => ({
        title: o.title,
        url: o.url,
        summary: "",
        publishedAt: now.toISOString(),
        source: o.outlet,
        sourceKind: "outlet" as const,
      })),
    ],
    sources: originals.length
      ? [...new Set(originals.map((o) => o.outlet))]
      : [s.cfg.primarySources ? "Background notes" : "Wikipedia"],
    hasOfficial: false,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: topic.game,
    visualNeed: "game_footage",
    why: {
      question: topic.question,
      angle: topic.angle,
      arc: topic.arc,
      follow,
      ...(serial ? { serial } : {}),
    },
  };
  const id = shortId();
  if (
    !(await createEpisode(db, id, cluster, {
      lane: "news",
      priority: LANE_PRIORITY.news,
      slotAt: due,
    }))
  )
    return undefined;
  const picked = candidates[topic.candidate_index];
  const pickedDemand = picked ? demand.get(picked.name) : undefined;
  await logEvent(db, id, "selected", {
    headline: topic.title,
    lane: "why",
    question: topic.question,
    game: topic.game,
    arc: topic.arc,
    follow,
    ...(serial ? { serial: serial.number, home } : {}),
    reason: topic.reason,
    demand: pickedDemand ?? null,
    demand_skipped: skipped.map((c) => c.name),
    slot_at: due.toISOString(),
  });
  await reportDemand(
    s,
    `Why Short at ${slotLabel(due, cfg.timezone)}`,
    topic.game,
    pickedDemand,
    skipped.length,
  );
  log("info", "why question selected", {
    id,
    question: topic.question,
    game: topic.game,
  });
  return id;
}

/**
 * Candidates ranked by recent YouTube demand, the topics with none left out (src/discovery/searchdemand.ts).
 * With DEMAND_CHECK off or no search service (tests), the list is unchanged.
 */
async function demandRanked(
  s: Services,
  base: EvergreenCandidate[],
): Promise<{
  candidates: EvergreenCandidate[];
  demand: Map<string, Demand>;
  skipped: EvergreenCandidate[];
}> {
  if (!s.cfg.demandCheck || (!s.searchDemand && !s.searchDemandMany))
    return { candidates: base, demand: new Map(), skipped: [] };
  const demand = await demandFor(base, {
    ...demandSearchers(s),
    budget: dbDemandBudget(s.db, s.cfg.demandApiPerDay, () => s.now()),
    label: "pick",
    cache: dbDemandCache(s.db, () => s.now(), (s.cfg.demandCacheDays ?? 7) * 24),
    lookups: s.cfg.demandLookups,
    minViews: s.cfg.demandMinViews,
    now: s.now(),
    staleDays: s.cfg.demandStaleDays,
  }).catch((err) => {
    log("warn", "demand check failed", { error: errorMessage(err) });
    return new Map<string, Demand>();
  });
  const { kept, skipped } = rankByDemand(base, demand, s.cfg.demandMinViews);
  if (skipped.length)
    log("info", "topics skipped for no recent YouTube demand", {
      skipped: skipped.map((c) => c.name),
    });
  return { candidates: kept, demand, skipped };
}

/** A pick's one Discord line about its demand; none when the check is off. */
async function reportDemand(
  s: Services,
  lane: string,
  picked: string,
  d: Demand | undefined,
  skipped: number,
): Promise<void> {
  if (!s.cfg.demandCheck || (!s.searchDemand && !s.searchDemandMany)) return;
  await s
    .notify({ content: demandLine(lane, picked, d, skipped, s.now()) })
    .catch(() => undefined);
}

/** Spare-quota Shorts created today (owner's day), which sit outside the daily target. */
async function countSpareToday(db: Db, timeZone: string): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
        AND status NOT IN ('failed','rejected') AND (factcheck_json->>'spare' = 'true' OR story_hash LIKE 'reply:%')`,
    [timeZone],
  );
  return Number(row?.n ?? 0);
}

/** Once per day and kind: a weekly lane that found too little data does not retry every tick. */
async function weeklyTried(db: Db, key: string): Promise<boolean> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [`weekly_tried:${key}`],
  );
  if (row) return true;
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, 'yes') ON CONFLICT (key) DO NOTHING`,
    [`weekly_tried:${key}`],
  );
  return false;
}

/**
 * The weekly long video on its own: Friday's round-up of the week's most-watched Shorts, or the explainer on its
 * test weeks (RECAP_LONG). maybeSelectWeekly tries it in its usual place; maybeSelectLongAfterTarget tries it once
 * the day's Shorts allowance is used (LONG_WEEKLY_AFTER_TARGET), since a long video is not one of the day's Shorts.
 */
export async function maybeSelectWeeklyLong(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.weeklyEnabled) return undefined;
  const now = s.now();
  const today = dayKey(now, cfg.timezone);
  const plan = (days: string[]) => ({
    days,
    slot: cfg.weeklySlot,
    leadMinutes: cfg.slotLeadMinutes + 30,
    graceMinutes: cfg.slotGraceMinutes,
    timeZone: cfg.timezone,
  });
  const taken = await takenSlots(db);
  const base = (
    hash: string,
    headline: string,
    gameHint: string,
  ): StoryCluster => ({
    hash,
    headline,
    items: [],
    sources: ["Steam"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint,
  });

  // Weekly Recap as a long video: the week's most-watched Shorts, one chapter each. Production
  // starts five hours before the slot; with too few stories it falls back to the Short below.
  if (cfg.recapLong && cfg.longformEnabled) {
    const longDue = evergreenDue(
      now,
      {
        ...plan(cfg.recapDays),
        // The weekly shape test (src/weeklytest.ts): both arms start early enough for a 15-20 minute explainer.
        leadMinutes: cfg.weeklyExplainedTest
          ? Math.max(300, cfg.weeklyExplainedLeadMinutes)
          : 300,
      },
      taken,
    );
    if (longDue && !(await weeklyTried(db, `recaplong:${today}`))) {
      // An explainer week (src/weeklytest.ts) makes one story in depth; with no story strong and safe enough,
      // the round-up below takes the slot and counts as a round-up week.
      let fallback: string | undefined;
      if (
        (await weeklyArm(db, cfg, now, (m) => s.notify(m)).catch(
          () => "roundup" as const,
        )) === "explained"
      ) {
        const made = await selectExplainedEpisode(s, now, longDue, today).catch(
          (err) => ({ id: undefined, reason: errorMessage(err) }),
        );
        if (made.id) return made.id;
        fallback = made.reason ?? "no story";
        log("info", "weekly explainer fell back to the round-up", { reason: fallback });
        await s.notify({ content: fallbackNotice(fallback) }).catch(() => undefined);
      }
      const stories = await recapStoryIds(db, now);
      if (stories.length >= RECAP_STORIES_MIN) {
        const id = shortId();
        const cluster = base(
          `weekly:recaplong:${today}`,
          "This Week in Gaming",
          "Gaming news",
        );
        if (
          await createEpisode(db, id, cluster, {
            lane: "longform",
            priority: LANE_PRIORITY.longform,
            slotAt: longDue,
          })
        ) {
          await db.query(
            `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
            [id, JSON.stringify({ recap: true, stories })],
          );
          await logEvent(db, id, "selected", {
            headline: cluster.headline,
            lane: "longform",
            recap: true,
            stories,
            slot_at: longDue.toISOString(),
          });
          await recordWeeklyArm(db, cfg, id, "roundup", now, fallback).catch(
            () => undefined,
          );
          log("info", "weekly recap video selected", {
            id,
            stories: stories.length,
          });
          return id;
        }
      } else
        log("info", "weekly recap video skipped: too few stories", {
          found: stories.length,
        });
    }
  }
  return undefined;
}

/**
 * The weekly lanes, each on its own day at the weekly slot: Release Radar
 * (Steam's popular releases this week), Free This Week (Epic's giveaway, a
 * news-style Short from the store's own data) and the Weekly Recap (the
 * week's biggest corroborated stories from the factory's own sightings).
 */
export async function maybeSelectWeekly(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.weeklyEnabled) return undefined;
  const now = s.now();
  const today = dayKey(now, cfg.timezone);
  const plan = (days: string[]) => ({
    days,
    slot: cfg.weeklySlot,
    leadMinutes: cfg.slotLeadMinutes + 30,
    graceMinutes: cfg.slotGraceMinutes,
    timeZone: cfg.timezone,
  });
  const taken = await takenSlots(db);
  const make = async (
    kind: string,
    cluster: StoryCluster,
    due: Date,
    factcheck: Record<string, unknown> | null,
    lane: "evergreen" | "free",
  ) => {
    const id = shortId();
    if (
      !(await createEpisode(db, id, cluster, {
        lane,
        priority: LANE_PRIORITY[lane],
        slotAt: due,
      }))
    )
      return undefined;
    if (factcheck)
      await db.query(
        `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
        [id, JSON.stringify(factcheck)],
      );
    await logEvent(db, id, "selected", {
      headline: cluster.headline,
      lane,
      weekly: kind,
      slot_at: due.toISOString(),
    });
    log("info", "weekly lane selected", {
      id,
      kind,
      headline: cluster.headline,
    });
    return id;
  };
  const base = (
    hash: string,
    headline: string,
    gameHint: string,
  ): StoryCluster => ({
    hash,
    headline,
    items: [],
    sources: ["Steam"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint,
  });

  // Steam's biggest climbers: real chart movement, each with the publisher's own news for the why.
  const climbDue = (await formatOpen(db, "steam_climbers", now))
    ? evergreenDue(now, plan(cfg.climbersDays), taken)
    : undefined;
  if (climbDue && !(await weeklyTried(db, `climbers:${today}`))) {
    const games = await s.steamClimbers(now);
    if (games.length >= 4) {
      const topic = {
        candidate_index: 0,
        format: "steam_climbers" as const,
        theme: "Steam charts",
        title_idea: "The Games That Exploded on Steam This Week",
        criterion: "Places climbed on Steam's most-played chart this week",
        reason: "weekly Steam climbers",
      };
      const brief = games
        .map(
          (g) =>
            `- ${g.name} | ${g.lastRank === undefined ? `new to the top 100 at #${g.rank}` : `#${g.rank} this week, #${g.lastRank} last week (up ${g.climb})`} | peak ${g.peak} players | released ${g.year ?? "unknown"} | Steam news: ${g.news.length ? g.news.join(" || ") : "none in the last two weeks"}`,
        )
        .join("\n");
      const climbers = games.map((g) => ({
        name: g.name,
        rank: g.rank,
        lastRank: g.lastRank,
        climb: g.climb,
        peak: g.peak,
        year: g.year,
      }));
      return make(
        "climbers",
        base(`weekly:climbers:${today}`, topic.title_idea, "Steam charts"),
        climbDue,
        { topic, brief, climbers },
        "evergreen",
      );
    }
    log("info", "steam climbers skipped: too few games climbed", {
      found: games.length,
    });
  }

  // Release Radar
  const radarDue = (await formatOpen(db, "release_radar", now))
    ? evergreenDue(now, plan(cfg.radarDays), taken)
    : undefined;
  if (radarDue && !(await weeklyTried(db, `radar:${today}`))) {
    const games = await s.releaseRadar(now);
    if (games.length >= 4) {
      const topic = {
        candidate_index: 0,
        format: "release_radar" as const,
        theme: "New games this week",
        title_idea: `${games.length} Big Games Out This Week`,
        criterion: "Release order, earliest first",
        reason: "weekly release radar",
      };
      const brief = games
        .map(
          (g) =>
            `- ${g.name} | out ${g.date} | ${g.price ?? "price not listed"} | developer ${g.developer ?? "unknown"} | Steam app ${g.appId}`,
        )
        .join("\n");
      return make(
        "radar",
        base(`weekly:radar:${today}`, topic.title_idea, "New games"),
        radarDue,
        { topic, brief },
        "evergreen",
      );
    }
    log("info", "release radar skipped: too few dated releases this week", {
      found: games.length,
    });
  }

  // Free This Week
  const freeDue = (await formatOpen(db, "free", now))
    ? evergreenDue(now, plan(cfg.freeDays), taken)
    : undefined;
  if (freeDue && !(await weeklyTried(db, `free:${today}`))) {
    const free = await s.freeGames(now);
    if (free.now.length) {
      const until = (iso?: string) =>
        iso
          ? new Intl.DateTimeFormat("en-US", {
              timeZone: "America/New_York",
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(iso)) + " Eastern"
          : "next week";
      const nextLine = free.next.length
        ? ` Next week's free ${free.next.length > 1 ? "games are" : "game is"} ${free.next.map((g) => g.title).join(" and ")}, from ${until(free.next[0]!.starts)}.`
        : "";
      const items = free.now.map((g) => ({
        title: `${g.title} is free to keep on the Epic Games Store`,
        url: g.url,
        summary: `${g.title} is free to keep on the Epic Games Store until ${until(g.until)}.${g.originalPrice ? ` It normally costs ${g.originalPrice}.` : ""}${g.seller ? ` Published by ${g.seller}.` : ""} ${g.description}${nextLine}`,
        publishedAt: now.toISOString(),
        source: "Epic Games Store",
        sourceKind: "official" as const,
        imageUrl: g.imageUrl,
      }));
      const headline = `Free To Keep This Week: ${free.now.map((g) => g.title).join(" And ")}`;
      const cluster: StoryCluster = {
        ...base(
          `weekly:free:${today}:${free.now
            .map((g) => g.title)
            .join("|")
            .toLowerCase()}`,
          headline,
          free.now[0]!.title,
        ),
        items,
        sources: ["Epic Games Store"],
        visualNeed: "game_footage",
      };
      return make("free", cluster, freeDue, null, "free");
    }
    log("info", "free this week skipped: nothing free on Epic right now");
  }

  // Achievement Hunt: odd ISO weeks the rarest in one big game, even weeks the hardest across today's biggest games.
  const achDue = (await formatOpen(db, "achievements", now))
    ? evergreenDue(now, plan(cfg.achievementDays), taken)
    : undefined;
  if (achDue && !(await weeklyTried(db, `achievements:${today}`))) {
    const week = Math.floor(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        Date.UTC(now.getUTCFullYear(), 0, 1)) /
        (7 * 86_400_000),
    );
    const across = week % 2 === 0;
    const covered = (
      await db.query<{ headline: string }>(
        `SELECT story_json->>'headline' AS headline FROM episodes WHERE lane = 'evergreen' AND created_at > $1::timestamptz - interval '120 days'`,
        [now],
      )
    ).map((r) => r.headline.toLowerCase());
    // Established games first (the franchise seeds), then what is selling now.
    const candidates = await s.discoverEvergreen();
    const pool = [
      ...candidates.filter((c) => c.source !== "steam top sellers"),
      ...candidates.filter((c) => c.source === "steam top sellers"),
    ]
      .map((c) => c.name)
      .filter(
        (n) =>
          !/steam deck|steam machine|controller|bundle|soundtrack/i.test(n),
      );
    const games: Array<{
      game: string;
      appId: number;
      year?: number;
      list: Achievement[];
    }> = [];
    for (const name of pool.slice(0, 24)) {
      const app = await s.findGame(name).catch(() => undefined);
      if (!app) continue;
      // An achievement Steam gives no description for can't say what it asks: it stays out, never made up.
      const list = rarest(
        (await s.achievements(app.appId)).filter((a) => a.description.trim()),
        ACHIEVEMENT_ENTRIES,
      );
      if (list.length < (across ? 1 : ACHIEVEMENT_ENTRIES)) continue;
      const year =
        Number(
          String(app.details?.release_date?.date ?? "").match(
            /\b(19|20)\d\d\b/,
          )?.[0],
        ) || undefined;
      // A game out for under a year has "rare" achievements only because few have finished it yet.
      if (!year || year > now.getUTCFullYear() - 1) continue;
      if (!across && (list.at(-1)?.percent ?? 0) < 0.5) continue;
      // Steam names carry trademark marks ("Call of Duty®"), which look sloppy on a card.
      const game = app.name.replace(/[®™©]/g, "").replace(/\s+/g, " ").trim();
      games.push({ game, appId: app.appId, year, list });
      if (!across && !covered.some((h) => h.includes(game.toLowerCase())))
        break;
      if (across && games.length >= 8) break;
    }
    const single = !across
      ? games.find(
          (g) =>
            g.list.length >= 5 &&
            !covered.some((h) => h.includes(g.game.toLowerCase())),
        )
      : undefined;
    const rows = across
      ? games
          .map((g) => ({ ...g.list[0]!, game: g.game, year: g.year }))
          .filter((r) => r.percent <= 10)
          .sort((a, b) => a.percent - b.percent)
          .slice(0, ACHIEVEMENT_ENTRIES)
      : (single?.list ?? []).map((a) => ({
          ...a,
          game: single!.game,
          year: single!.year,
        }));
    if (rows.length >= 4) {
      const format = across
        ? ("hardest_achievements" as const)
        : ("rarest_achievements" as const);
      const theme = across ? "Achievements" : single!.game;
      const topic = {
        candidate_index: 0,
        format,
        theme,
        title_idea: across
          ? "The Hardest Achievements in Gaming Right Now"
          : `The Rarest Achievements in ${single!.game}`,
        criterion: "Share of players who unlocked it (Steam global stats)",
        reason: "weekly achievement hunt",
      };
      const brief = rows
        .map(
          (r) =>
            `- ${r.name} | ${r.game}${r.year ? ` (${r.year})` : ""} | ${r.percent}% of players | ${r.description}`,
        )
        .concat(
          `Hook figure: every achievement here is held by under ${underFigure(rows.map((r) => r.percent))}% of players. The hook may use that; it never gives the rarest one's percentage.`,
        )
        .join("\n");
      const achievements = rows.map((r) => ({
        name: r.name,
        game: r.game,
        percent: r.percent,
        icon: r.icon,
        year: r.year,
        description: r.description,
      }));
      return make(
        "achievements",
        base(`weekly:achievements:${today}`, topic.title_idea, theme),
        achDue,
        { topic, brief, achievements },
        "evergreen",
      );
    }
    log("info", "achievement hunt skipped: not enough achievement data", {
      games: games.length,
    });
  }

  // Buy, Wait or Skip (SERIES_VERDICT_ENABLED, src/verdictstep.ts): one game, one price, one verdict, in the deals slot
  // on its days. It takes the slot ahead of the deals list, and is judged by the series test, not the format trials.
  const verdictDue = cfg.seriesVerdictEnabled
    ? evergreenDue(
        now,
        { ...plan(cfg.seriesVerdictDays), slot: cfg.dealsSlot },
        taken,
      )
    : undefined;
  if (
    verdictDue &&
    s.verdictCandidates &&
    !(await weeklyTried(db, `verdict:${today}`))
  ) {
    const recent = await recentVerdicts(db, now);
    const pick = verdictSelection(
      await s.verdictCandidates(recent.games),
      recent.verdicts,
    );
    if (pick)
      return make(
        "verdict",
        verdictCluster(today, pick, now),
        verdictDue,
        pick as unknown as Record<string, unknown>,
        "evergreen",
      );
    log("info", "buy, wait or skip skipped: no game confirmed on Steam", {});
  }

  // Steam deals: their own daily slot, only when at least four strong deals are new to the channel.
  // Each format's slot is open only while it earns it (src/formats.ts); deals always run in a Steam sale.
  const dealsDue = (await formatOpen(db, "steam_deals", now))
    ? evergreenDue(now, { ...plan(cfg.dealsDays), slot: cfg.dealsSlot }, taken)
    : undefined;
  if (
    dealsDue &&
    !(await bumpFiller(db, cfg, "deals", now)) &&
    !(await weeklyTried(db, `deals:${today}`))
  ) {
    const recent = await db.query<{ script_json: Script }>(
      `SELECT script_json FROM episodes WHERE lane = 'evergreen' AND script_json->>'evergreen_format' = 'steam_deals' AND created_at > $1`,
      [new Date(now.getTime() - 14 * 86_400_000)],
    );
    const exclude = recent.flatMap(
      (r) => r.script_json?.entries?.map((e) => e.game_title) ?? [],
    );
    const deals = await s.steamDeals(exclude);
    if (deals.length >= 4) {
      const topic = {
        candidate_index: 0,
        format: "steam_deals" as const,
        theme: "Steam deals",
        title_idea: `${deals.length} Great Steam Games on Sale Right Now`,
        criterion: "The biggest cut on the best-reviewed games",
        reason: "daily Steam deals",
      };
      const brief = deals
        .map(
          (d) =>
            `- ${d.name} | ${d.usd.final}, down from ${d.usd.initial} (${d.usd.pct}% off) | ${d.rating}% positive from ${d.reviews.toLocaleString("en-US")} Steam reviews | released ${d.year ?? "unknown"}`,
        )
        .join("\n");
      return make(
        "deals",
        base(`daily:deals:${today}`, topic.title_idea, "Steam deals"),
        dealsDue,
        { topic, brief, deals },
        "evergreen",
      );
    }
    log("info", "steam deals skipped: too few fresh deals", {
      found: deals.length,
    });
  }

  // Weekly Recap as a long video (maybeSelectWeeklyLong); with too few stories it falls back to the Short below.
  const weeklyLong = await maybeSelectWeeklyLong(s);
  if (weeklyLong) return weeklyLong;

  // Weekly Recap
  const recapDue = (await formatOpen(db, "weekly_recap", now))
    ? evergreenDue(now, plan(cfg.recapDays), taken)
    : undefined;
  if (recapDue && !(await weeklyTried(db, `recap:${today}`))) {
    const rows = await db.query<{
      headline: string;
      max_score: number;
      item_count: number;
      has_official: boolean;
      cluster_json: StoryCluster;
      first_seen: string;
    }>(
      `SELECT headline, max_score, item_count, has_official, cluster_json, first_seen FROM cluster_sightings
       WHERE first_seen > $1 AND (has_official OR item_count >= 2) ORDER BY max_score DESC LIMIT 12`,
      [new Date(now.getTime() - 7 * 86_400_000)],
    );
    const stories = rows.filter((r) => !r.cluster_json?.rumourSignals);
    if (stories.length >= 5) {
      const topic = {
        candidate_index: 0,
        format: "weekly_recap" as const,
        theme: "This week in gaming",
        title_idea: "The 5 Biggest Gaming Stories This Week",
        criterion: "How much each story changes things for players",
        reason: "weekly recap",
      };
      const brief = stories
        .slice(0, 10)
        .map(
          (r) =>
            `- ${r.headline} | reported by ${(r.cluster_json?.sources ?? []).slice(0, 3).join(", ") || "outlets"}${r.has_official ? " (official)" : ""} | first seen ${new Date(r.first_seen).toISOString().slice(0, 10)} | ${(r.cluster_json?.items?.[0]?.summary ?? "").slice(0, 220)}`,
        )
        .join("\n");
      return make(
        "recap",
        base(`weekly:recap:${today}`, topic.title_idea, "Gaming news"),
        recapDue,
        { topic, brief },
        "evergreen",
      );
    }
    log("info", "weekly recap skipped: too few corroborated stories", {
      found: stories.length,
    });
  }
  return undefined;
}

/**
 * A documentary paid for by credits that would otherwise be lost: the plan says at least one
 * documentary's worth would go at the reset, there are days enough to make it, and no documentary is
 * already in production.
 */
export async function surplusDocumentary(s: Services): Promise<boolean> {
  const plan = await s.creditPlan?.().catch(() => undefined);
  if (!plan || plan.wasteAtReset < s.cfg.surplusDocChars || plan.daysLeft < 1)
    return false;
  const [busy] = await s.db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE lane = 'longform' AND factcheck_json->>'doc' = 'true'
       AND status IN ('selected','scripted','voiced','rendered','awaiting_approval','approved')`,
  );
  if (Number(busy?.n ?? 0) > 0) return false;
  log(
    "info",
    "surplus documentary: ElevenLabs credits would be lost at the reset",
    { waste: plan.wasteAtReset, daysLeft: plan.daysLeft },
  );
  return true;
}

/**
 * Where a banked documentary goes: the first documentary evening (SURPLUS_DOC_DAYS at DOC_SLOT) at least
 * 20 hours away (it takes hours to make), clear of the monthly documentary's own evening and an hour from
 * any other scheduled video.
 */
export function nextBankSlot(
  cfg: Config,
  now: Date,
  taken: Date[],
): Date | undefined {
  const today = dayKey(now, cfg.timezone);
  const earliest = now.getTime() + 20 * 3600_000;
  for (let d = 0; d < 180; d++) {
    const at = localTime(addDays(today, d), cfg.docSlot, cfg.timezone);
    if (at.getTime() < earliest) continue;
    const wd = weekday(at, cfg.timezone);
    if (!cfg.surplusDocDays.includes(wd)) continue;
    if (
      cfg.docDays.includes(wd) &&
      cfg.docWeeks.includes(weekOfMonth(at, cfg.timezone))
    )
      continue;
    if (taken.some((t) => Math.abs(t.getTime() - at.getTime()) < 3600_000))
      continue;
    return at;
  }
  return undefined;
}

/** Week of the month (1-5) for a date in the channel's time zone. */
function weekOfMonth(now: Date, timeZone: string): number {
  const day = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric" }).format(now),
  );
  return Math.ceil(day / 7);
}

/**
 * The monthly documentary: a franchise history, game by game, in the long-form
 * lane. Production starts hours before its slot because a 30-minute video takes
 * a while to write, voice and render.
 */
export async function maybeSelectDocumentary(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  const quiet = (reason: string, extra?: Record<string, unknown>) => {
    quietLog("documentary", reason, extra, s.now().getTime());
    return undefined;
  };
  if (!cfg.docEnabled || !cfg.longformEnabled)
    return quiet(
      cfg.docEnabled ? "LONGFORM_ENABLED is off" : "DOC_ENABLED is off",
    );
  const now = s.now();
  // A long video planned by date (the launch run, src/shortrun.ts): started early enough to be finished and
  // scheduled well ahead, so the PC is free when it goes out.
  let plannedDoc = docRunDue(
    readRun(cfg.shortRunFile),
    now,
    await takenSlots(db),
    cfg.timezone,
    cfg.longArgues,
  );
  // The weekly guide (src/longguide.ts, GUIDE_WEEKLY): this week's guide, planned by date as a run's documentary is,
  // so a guide built on our own tests goes through the same evidence check just below.
  if (!plannedDoc && cfg.guideWeekly) plannedDoc = await weeklyGuideDue(s, now);
  // A full game retrospective (src/retrospective.ts, RETRO_ENABLED): its slot's game, once its spoiler window has
  // ended and its full-story movie is filed in the scene index.
  if (!plannedDoc && cfg.retroEnabled) plannedDoc = await retrospectiveDue(s, now);
  // The story recap from the owner's own play (src/storyrecap.ts, STORY_RECAP): after the spoiler window, once the
  // story has been streamed.
  if (!plannedDoc && cfg.storyRecap.enabled) plannedDoc = await storyRecapDue(s, now);
  // A planned documentary built on our own tests needs enough approved ones (DOC_TEST_EVIDENCE); without them it does
  // not run at all, once told, and the slot goes back to the usual lanes.
  if (plannedDoc?.entry.min_evidence || plannedDoc?.entry.evidence?.length) {
    const entry = plannedDoc.entry;
    const { records, refused } = cfg.docTestEvidence
      ? await resolveTestRecords(db, entry.evidence ?? [], entry.franchise)
      : { records: [], refused: ["DOC_TEST_EVIDENCE is off"] };
    if (records.length < Math.max(1, entry.min_evidence ?? 1)) {
      if (!(await weeklyTried(db, `doc_evidence:${entry.date}:${entry.slot}`)))
        await s.notify({
          content: `"${entry.title}" will not run: ${records.length} usable test${records.length === 1 ? "" : "s"}, ${entry.min_evidence ?? 1} needed.${refused.length ? ` Not used: ${refused.join("; ").slice(0, 900)}.` : ""}`,
        });
      plannedDoc = undefined;
    } else {
      plannedDoc.topic.test_records = records;
      if (refused.length)
        await s.notify({
          level: "info",
          content: `"${entry.title}": tests not used: ${refused.join("; ").slice(0, 900)}.`,
        });
    }
  }
  // "The Story of Every [series] Game" as a long video (src/everygame.ts): planned by date like a run's
  // documentary, behind EVERYGAME_ENABLED and its entry's own "on"; its roster is read from IGDB now.
  const everyLong = plannedDoc
    ? undefined
    : everyLongDue(
        readEveryGamePlan(cfg.everyGameFile),
        cfg.everyGameEnabled,
        now,
        await takenSlots(db),
        cfg.timezone,
      );
  const everyTopic = everyLong
    ? await loadEveryGameRoster(s, everyLong.entry)
        .then((roster) =>
          everyGameDocTopic(roster, everyLong.entry.title, everyLong.entry.angle, everyLong.entry.wiki),
        )
        .catch((err) => {
          log("warn", "every-game roster failed", { series: everyLong.entry.series, error: errorMessage(err) });
          return undefined;
        })
    : undefined;
  // The monthly documentary on its own week and day; otherwise, while ElevenLabs credits would be lost at
  // the reset, a banked one: made overnight now, while the credits are there, and scheduled for the next
  // free documentary evening, weeks ahead if need be (the owner's idea, 25 Oct 2026).
  let due = plannedDoc
    ? plannedDoc.at
    : everyLong && everyTopic
    ? everyLong.at
    : cfg.docWeeks.includes(weekOfMonth(now, cfg.timezone))
    ? evergreenDue(
        now,
        {
          days: cfg.docDays,
          slot: cfg.docSlot,
          leadMinutes: Math.max(cfg.docLeadMinutes, cfg.longLeadMinutes),
          graceMinutes: cfg.slotGraceMinutes,
          timeZone: cfg.timezone,
        },
        await takenSlots(db),
      )
    : undefined;
  let banked = false;
  if (!due) {
    const week = weekOfMonth(now, cfg.timezone);
    const why = cfg.docWeeks.includes(week)
      ? evergreenWhyNot(
          now,
          {
            days: cfg.docDays,
            slot: cfg.docSlot,
            leadMinutes: Math.max(cfg.docLeadMinutes, cfg.longLeadMinutes),
            graceMinutes: cfg.slotGraceMinutes,
            timeZone: cfg.timezone,
          },
          await takenSlots(db),
        )
      : { reason: `week ${week} of the month is not in DOC_WEEKS` };
    const extra = {
      days: cfg.docDays.join(","),
      weeks: cfg.docWeeks.join(","),
      slot: "slot" in why ? why.slot?.toISOString() : undefined,
      opensAt: "opensAt" in why ? why.opensAt?.toISOString() : undefined,
    };
    // Overnight only: a documentary holds the factory for hours, and the day's Shorts come first.
    if (!inWindow(now, cfg.bankWindow, cfg.timezone))
      return quiet(`${why.reason}; outside the banking window`, extra);
    if (!(await surplusDocumentary(s)))
      return quiet(`${why.reason}; no credit surplus to bank one`, extra);
    due = nextBankSlot(cfg, now, await takenSlots(db));
    if (!due)
      return quiet(`${why.reason}; no free evening to bank one into`, extra);
    banked = true;
  }
  const covered = (
    await db.query<{ franchise: string }>(
      `SELECT factcheck_json->'topic'->>'franchise' AS franchise FROM episodes WHERE lane = 'longform' AND factcheck_json->>'doc' = 'true' AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '3 years'`,
      [now],
    )
  )
    .map((r) => r.franchise)
    .filter(Boolean);
  const inTheNews = (
    await db.query<{ headline: string }>(
      `SELECT story_json->>'headline' AS headline FROM episodes WHERE lane IN ('news','news_breaking') AND created_at > $1::timestamptz - interval '14 days' ORDER BY created_at DESC LIMIT 40`,
      [now],
    )
  ).map((r) => r.headline);
  // The breakout picker (src/docpick.ts, DOC_BREAKOUT_PICKER) scores every candidate and takes the best with no
  // model call; the writer's pick from the lists stays the fallback.
  // RANKING_STANCE (src/stance.ts): once enough films of one series are public, the "complete" cut is put to the owner once.
  await proposeCompleteCuts(s).catch((err) =>
    log("warn", "complete cut check failed", { error: errorMessage(err) }),
  );
  // WHY_DIED_ENABLED (src/whydied.ts): a "why it died" film from the news desk, when one is due, ahead of the score pick.
  const whyDied =
    plannedDoc || everyTopic
      ? undefined
      : await pickWhyDied(s, now, covered).catch((err) => {
          log("warn", "why-it-died pick failed", { error: errorMessage(err) });
          return undefined;
        });
  if (whyDied)
    await s
      .notify({
        level: "info",
        content: `Next documentary, "why it died" strand: "${whyDied.topic.title_idea}" (${whyDied.proposals.length} proposal${whyDied.proposals.length === 1 ? "" : "s"} from the news desk).`,
      })
      .catch(() => undefined);
  const breakout = plannedDoc || everyTopic || whyDied
    ? undefined
    : s.cfg.docBreakoutPicker
    ? await pickBreakoutDoc(s).catch((err) => {
        log("warn", "breakout documentary picker failed", {
          error: errorMessage(err),
        });
        return undefined;
      })
    : undefined;
  // LONG_ARGUES=fix: the picker sees no franchise list (a franchise history needs a brief it cannot write), and if that
  // finds nothing it asks again with the full list rather than leave the month empty.
  const pickDocTopic = async () => {
    const demand = await topicDemand(s, "doc");
    const stories =
      s.cfg.longArgues === "fix"
        ? await selectDocTopic(s.llm, covered, inTheNews, [], undefined, demand)
        : undefined;
    return stories ?? selectDocTopic(s.llm, covered, inTheNews, undefined, undefined, demand);
  };
  const topic =
    plannedDoc?.topic ??
    everyTopic ??
    whyDied?.topic ??
    breakout?.topic ??
    (await pickDocTopic());
  if (!topic) {
    log("info", "no documentary topic this month");
    return undefined;
  }
  // A documentary that failed today is replaced under a fresh key (25 Nov 2026 review: the day's key collided with the
  // failed row, so a same-day replacement was refused and the slot stayed empty). A live one still blocks a twin.
  const docBase = `documentary:${dayKey(now, cfg.timezone)}:${topic.franchise.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const [docFailed] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE (story_hash = $1 OR story_hash LIKE $2) AND status IN ('failed','rejected')`,
    [docBase, `${docBase}:r%`],
  );
  const docTries = Number(docFailed?.n ?? 0);
  const cluster: StoryCluster = {
    hash: docTries ? `${docBase}:r${docTries}` : docBase,
    headline: topic.title_idea,
    items: [],
    sources: ["Wikipedia"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: topic.franchise,
  };
  const id = shortId();
  const created = await createEpisode(db, id, cluster, {
    lane: "longform",
    priority: LANE_PRIORITY.longform,
    slotAt: due,
  });
  if (!created)
    return quiet("an episode with the same documentary and day already exists", {
      hash: cluster.hash,
    });
  await db.query(
    `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
    [id, JSON.stringify({ doc: true, topic })],
  );
  await logEvent(db, id, "selected", {
    headline: topic.title_idea,
    lane: "longform",
    documentary: true,
    franchise: topic.franchise,
    reason: topic.reason,
    slot_at: due.toISOString(),
    banked,
  });
  if (breakout) {
    await logEvent(db, id, "doc_pick", breakout.detail);
    await s.notify({ level: "info", content: breakout.line });
  }
  log(
    "info",
    banked
      ? "documentary banked: made now on credits that would be lost, scheduled ahead"
      : "documentary topic selected",
    {
      id,
      franchise: topic.franchise,
      publishes: due.toISOString(),
    },
  );
  quietReset("documentary");
  return id;
}

/** This week's guide (src/longguide.ts) when its window is open; the guides it passed over are told once a day. */
async function weeklyGuideDue(
  s: Services,
  now: Date,
): Promise<{ at: Date; topic: DocTopic; entry: RunDoc } | undefined> {
  const { db, cfg } = s;
  const made = (
    await db.query<{ key: string }>(
      `SELECT factcheck_json->'topic'->'guide'->>'key' AS key FROM episodes WHERE lane = 'longform' AND factcheck_json->'topic'->'guide'->>'key' IS NOT NULL AND status NOT IN ('failed','rejected')`,
    )
  ).map((r) => r.key);
  const { due, waiting } = guideWeekDue(
    readGuidePlan(cfg.guideWeeklyFile),
    cfg.guideWeekly,
    now,
    await takenSlots(db),
    made,
    cfg.timezone,
  );
  if (!due && waiting.length && !(await weeklyTried(db, `guide_wait:${dayKey(now, cfg.timezone)}`)))
    await s.notify({
      level: "info",
      content: `This week's guide is waiting: ${waiting.join("; ").slice(0, 900)}.`,
    });
  if (!due) return undefined;
  log("info", "weekly guide due", { key: due.entry.key, title: due.topic.title_idea, at: due.at.toISOString() });
  return { at: due.at, topic: due.topic, entry: due.run };
}

/**
 * This slot's retrospective (src/retrospective.ts) when its making window is open. A game whose movie is not filed
 * yet is queued for the scene index; the games passed over are told once a day.
 */
async function retrospectiveDue(
  s: Services,
  now: Date,
): Promise<{ at: Date; topic: DocTopic; entry: RunDoc } | undefined> {
  const { db, cfg } = s;
  const plan = readRetroPlan(cfg.retroFile);
  if (!plan) return undefined;
  const made = (
    await db.query<{ key: string }>(
      `SELECT factcheck_json->'topic'->'retro'->>'key' AS key FROM episodes WHERE lane = 'longform' AND factcheck_json->'topic'->'retro'->>'key' IS NOT NULL AND status NOT IN ('failed','rejected')`,
    )
  ).map((r) => r.key);
  // Each game's scene index, read once: the movie must be filed and nearly all of it indexed.
  const filed = new Map<string, string[]>();
  for (const g of plan.games) {
    if (!g.on || made.includes(g.key)) continue;
    const index = await retroIndex(cfg, g.game).catch(() => undefined);
    const problems = retroIndexProblems(index, { minShare: cfg.retroMinIndexed, minHeard: cfg.retroMinHeard });
    filed.set(g.key, problems);
    if (problems.length && cfg.sceneIndex)
      await requestSceneIndex(cfg, g.game, "a planned retrospective", false, now);
  }
  const windows = spoilerWindows();
  const { due, waiting } = retroDue(plan, cfg.retroEnabled, now, await takenSlots(db), made, cfg.timezone, (g, at) => ({
    filed: filed.get(g.key) ?? [],
    windowOpen: Boolean(windowFor(windows, g.game, at)),
  }));
  if (!due && waiting.length && !(await weeklyTried(db, `retro_wait:${dayKey(now, cfg.timezone)}`)))
    await s.notify({
      level: "info",
      content: `This slot's retrospective is waiting: ${waiting.join("; ").slice(0, 900)}.`,
    });
  if (!due) return undefined;
  log("info", "retrospective due", { key: due.game.key, title: due.topic.title_idea, at: due.at.toISOString() });
  const entry: RunDoc = {
    kind: "doc",
    date: dayKey(due.at, cfg.timezone),
    slot: plan.slot,
    make_hours_before: plan.make_hours_before,
    title: due.topic.title_idea,
    franchise: due.game.game,
    wiki: due.game.wiki,
    angle: due.game.angle,
  };
  return { at: due.at, topic: due.topic, entry };
}

/** The story recap (src/storyrecap.ts) when its making window is open, the window closed and the story streamed. */
async function storyRecapDue(
  s: Services,
  now: Date,
): Promise<{ at: Date; topic: DocTopic; entry: RunDoc } | undefined> {
  const { db, cfg } = s;
  const entries = readRun(cfg.shortRunFile).filter((e): e is RunDoc => e.kind === "doc" && Boolean(e.story_recap));
  const taken = await takenSlots(db);
  for (const entry of entries) {
    const r = entry.story_recap!;
    const key = `recap-${recapSlug(r.game)}`;
    const [made] = await db.query(
      `SELECT 1 FROM episodes WHERE lane = 'longform' AND factcheck_json->'topic'->'retro'->>'key' = $1 AND status NOT IN ('failed','rejected') LIMIT 1`,
      [key],
    );
    let story: Awaited<ReturnType<typeof streamedStory>> | undefined;
    const due = recapDue(entry, now, taken, cfg.timezone, Boolean(made), () => ({
      windows: recapWindows(spoilerWindows(), cfg.gameFetchTitles, r.game, cfg.spoilerWindowDays),
      problems: [],
    }));
    let waiting = due.waiting;
    if (due.at) {
      story = await streamedStory(cfg.dataDir, r.game);
      const problems = [
        ...recapProblems(story.index, cfg.storyRecap),
        ...recapTitleProblems(entry.title, r.short),
      ];
      if (!problems.length) {
        log("info", "story recap due", { title: entry.title, at: due.at.toISOString(), streams: story.vods.length });
        return { at: due.at, topic: recapTopic(entry, story.vods, due.at.getUTCFullYear()), entry };
      }
      waiting = problems.join("; ");
    }
    if (waiting && !(await weeklyTried(db, `recap_wait:${key}:${dayKey(now, cfg.timezone)}`)))
      await s.notify({ level: "info", content: `"${entry.title}" is waiting: ${waiting.slice(0, 900)}.` });
  }
  return undefined;
}

/**
 * More to write from: the chapter's own article at greater length, the story's main article and the other articles
 * the outline names. A chapter short of evidence gets this rather than a tighter restriction.
 */
export async function widerDocSource(
  s: Pick<Services, "research">,
  plan: { wiki_title: string; game_title: string; year: number; focus: string; chapter_title: string },
  mainTitle: string | undefined,
  otherTitles: readonly string[],
): Promise<import("./discovery/wikipedia.ts").WikiArticle | undefined> {
  const focus = `${plan.chapter_title} ${plan.focus}`;
  const titles = [
    ...new Set(
      [plan.wiki_title, mainTitle, ...otherTitles].filter(
        (t): t is string => Boolean(t),
      ),
    ),
  ].slice(0, 4);
  const found: Array<import("./discovery/wikipedia.ts").WikiArticle> = [];
  for (const [i, title] of titles.entries()) {
    const a = await s
      .research(
        title,
        i === 0 ? `${plan.game_title} ${plan.year} video game` : title,
        DOC_WIDE_SOURCE_CHARS,
        focus,
      )
      .catch(() => undefined);
    if (a) found.push(a);
  }
  return mergeArticles(found);
}

/**
 * Writes the documentary: outline, then each chapter against its own Wikipedia
 * article with a fact-check pass and up to two rewrites, then the intro and
 * outro from what the chapters actually say.
 */
async function stepScriptDocumentary(
  s: Services,
  ep: Episode,
  topic: DocTopic,
): Promise<void> {
  // DOC_CHAPTER_CHECKPOINT (src/editorial/doccheckpoint.ts): the outline and finished chapters are kept on disk, so a
  // restart resumes them. Only a cut-off run resumes: once every chapter is written, a failure starts afresh.
  const ck = docCheckpointer(s, ep, topic);
  try {
    await stepScriptDocumentaryBody(s, ep, topic, ck);
    ck.clear();
  } catch (err) {
    // A timeout after the chapters keeps them for the retry; a script that failed on its content starts afresh.
    if (ck.loopDone && (err instanceof FatalError || isContentFault(errorMessage(err)))) ck.clear();
    throw err;
  }
}

interface DocCheckpointer {
  resume?: DocCheckpoint;
  loopDone: boolean;
  save: (state: Omit<DocCheckpoint, "version" | "episode" | "topicKey" | "savedAt">) => void;
  clear: () => void;
}

function docCheckpointer(s: Services, ep: Episode, topic: DocTopic): DocCheckpointer {
  // A retrospective or every-game outline writes state onto the topic while drafting (sections, acts, roster), which a
  // resumed run would not have: those formats always write afresh.
  const on = s.cfg.docChapterCheckpoint && topic.format !== "retro" && topic.format !== "everygame";
  const dir = s.cfg.dataDir;
  const key = docTopicKey(topic);
  const hours = s.cfg.docCheckpointHours;
  if (on) pruneDocCheckpoints(dir, s.now(), Math.max(hours, 72));
  return {
    resume: on ? loadDocCheckpoint(dir, ep.id, key, s.now(), hours) : undefined,
    loopDone: false,
    save: (state) => {
      if (!on) return;
      try {
        saveDocCheckpoint(dir, {
          version: DOC_CHECKPOINT_VERSION,
          episode: ep.id,
          topicKey: key,
          savedAt: s.now().toISOString(),
          ...state,
        });
      } catch (err) {
        log("warn", "documentary checkpoint not saved", { episode: ep.id, error: errorMessage(err) });
      }
    },
    clear: () => {
      if (on) clearDocCheckpoint(dir, ep.id);
    },
  };
}

async function stepScriptDocumentaryBody(
  s: Services,
  ep: Episode,
  topic: DocTopic,
  ck: DocCheckpointer,
): Promise<void> {
  // A full game retrospective (src/retrospective.ts): every model call under its own "retro." site, its own outline
  // from the scene index's acts, and each chapter's own sources (its section's reading, its press, its act's lines).
  const retro = topic.format === "retro" ? topic.retro : undefined;
  if (retro) s = retroServices(s);
  const retroIdx = retro ? await retroIndex(s.cfg, topic.franchise, topic.recap) : undefined;
  // Our own tests as a source, for this documentary alone and under a stricter check (src/editorial/testevidence.ts).
  const records = s.cfg.docTestEvidence ? (topic.test_records ?? []) : [];
  const strict = records.length > 0;
  // The Inspiration rules (src/editorial/longrules.ts), all off by default; a guide is a planned entry's own format.
  // LONG_OPENING_CONTRACT=fix and a "claims" entry under LONG_ARGUES add their rules (src/longcontractstep.ts).
  const rules = contractRules(
    {
      ...longRulesFor(s.cfg, "documentary", topic.format === "guide"),
      ...(retro ? { retro: true } : {}),
    },
    { contract: s.cfg.longOpeningContract, argues: s.cfg.longArgues, format: topic.format },
  );
  // A planned entry's own sources, beside each chapter's article, so a verdict can name who said it.
  const runSources = await readRunSources(s, topic);
  // A retrospective's press goes only to the sections it belongs to (a review to reception), not to every chapter.
  const press = retro ? runSources.parts : [];
  if (retro) runSources.text = "";
  // A weekly guide also writes from the confirmed facts file and the owner's play notes (src/longguide.ts).
  if (topic.guide && s.cfg.guideWeekly) {
    const g = guideSourceText(topic.guide);
    if (g.text) runSources.text = [g.text, runSources.text].filter(Boolean).join("\n\n");
    runSources.missed.push(...g.missed);
  }
  // A search-led planned entry (src/plannedoc.ts) writes from its confirmed facts file too, whatever the guide setting.
  if (topic.planned?.facts_file) {
    const f = plannedFactsText(factsPath(topic.planned.facts_file, s.cfg.shortRunFile));
    if (f.text) runSources.text = [f.text, runSources.text].filter(Boolean).join("\n\n");
    runSources.missed.push(...f.missed);
  }
  const withRunSources = (a: import("./discovery/wikipedia.ts").WikiArticle) =>
    runSources.text ? { ...a, text: `${a.text}\n\n${runSources.text}` } : a;
  // A single story starts from its overview article; a franchise from the series article.
  const franchiseArticle = await s.research(
    topic.wiki ?? topic.franchise,
    topic.kind === "story"
      ? topic.franchise
      : `${topic.franchise} video game series`,
    retro ? DOC_WIDE_SOURCE_CHARS : DOC_OUTLINE_SOURCE_CHARS,
    ...(retro ? ["development plot story gameplay reception legacy"] : []),
  );
  const franchise = franchiseArticle
    ? withRunSources(withTestRecords(franchiseArticle, records))
    : franchiseArticle;
  // A resumed run keeps the outline it was writing to: a new outline would not match the chapters already written.
  const resume = ck.resume;
  const drafted = resume
    ? undefined
    : topic.format === "everygame" && topic.roster
      ? await everyGameOutlineFor(s, ep, topic, franchise?.text ?? "")
      : retro
      ? await retroOutlineFor(s, ep, topic, franchise?.text ?? "")
      : await outlineDoc(
    s.llm,
    topic,
    `${franchise?.text ?? ""}${strict ? testOutlineNote(records) : ""}`,
    { openLoops: s.cfg.docOpenLoops, rules },
  );
  // A search-led planned entry keeps its planned chapters: they are the YouTube chapters people search.
  const held = drafted
    ? applyPlannedChapters(drafted, topic.planned, topic.wiki ?? topic.franchise)
    : { outline: resume!.outline, changed: [] as string[] };
  const outline = held.outline;
  if (held.changed.length) await logEvent(s.db, ep.id, "planned_chapters", { changed: held.changed });
  // Only outlineDoc's outline can carry a finish line, and only with DOC_OPEN_LOOPS on: a retrospective or every-game
  // outline has no such mark, so the contract neither asks for one nor counts its absence there.
  const finishCarried = s.cfg.docOpenLoops && !retro && !(topic.format === "everygame" && topic.roster);
  // The questions it raises and answers (src/editorial/openloops.ts), kept only when they can work.
  const openLoops: { loops: OpenLoop[]; removed: string[] } = resume
    ? structuredClone(resume.openLoops)
    : s.cfg.docOpenLoops
    ? groundOpenLoops(outline.open_loops, outline.chapters.length, {
        max: rules.loopsMax,
        coldOpen: rules.loopsMax ? Math.max(2, rules.hookStack) : 0,
      })
    : { loops: [], removed: [] };
  // LONG_OPENING_CONTRACT=fix: one loop keeps the finish-line mark, raised in the cold open and paid in the last chapter.
  if (!resume && rules.contract && finishCarried && openLoops.loops.length) {
    const finish = groundFinishLine(openLoops.loops, outline.chapters.length);
    openLoops.loops = finish.loops;
    openLoops.removed.push(...finish.removed);
  }
  // A rule-led revision is one call; a video gets a few at most, then a miss is a style warning (longRuleWarnings).
  let ruleRevisions = resume?.ruleRevisions ?? LONG_RULE_REVISIONS;
  // An earlier documentary on the same franchise: its wording and opening are not reused.
  const priorDoc = await priorDocNarration(s.db, ep.id, topic.franchise).catch(
    () => undefined,
  );
  // Each kept chapter's plan is the outline's own object again (open loops are placed by identity, placeDocLoops).
  const chapters: DocDraft["chapters"] = resume ? relinkPlans(resume, outline) : [];
  const warnings: string[] = resume ? [...resume.warnings] : [];
  // A retrospective sandbox may pick its chapters (RETRO_SANDBOX_CHAPTERS, "1,story:1"); the outline index of each
  // chapter as written is kept, in order, for its footage and quotes.
  const pick = retro ? retroSandboxChapters(s.cfg.retroSandboxChapters, retro.chapters ?? []) : undefined;
  const written: number[] = resume ? [...resume.written] : [];
  // A sandbox writes only the opening chapters (DOC_SANDBOX_CHAPTERS, 0 in production).
  const order =
    pick ??
    (s.cfg.docSandboxChapters
      ? outline.chapters.slice(0, s.cfg.docSandboxChapters)
      : outline.chapters
    ).map((_, i) => i);
  // Chapters dropped because the writer still refused them after widening (DOC_DROP_REFUSED_CHAPTER).
  const droppedRefused: number[] = resume ? [...resume.droppedRefused] : [];
  // Outline indices already settled (written, dropped or without a source), kept after each one.
  const done = new Set<number>(resume?.done ?? []);
  const checkpoint = () =>
    ck.save({
      outline,
      openLoops,
      done: [...done],
      chapters,
      written,
      droppedRefused,
      warnings,
      ruleRevisions,
    });
  if (resume) {
    log("info", "documentary resumed from checkpoint", {
      episode: ep.id,
      chapters: chapters.length,
      settled: done.size,
      of: outline.chapters.length,
    });
    await logEvent(s.db, ep.id, "doc_checkpoint_resumed", {
      chapters: chapters.length,
      settled: [...done].map((i) => i + 1),
      of: outline.chapters.length,
      saved_at: resume.savedAt,
    });
  } else checkpoint();
  for (const [position, index] of order.entries()) {
    if (done.has(index)) continue;
    const plan = outline.chapters[index]!;
    const article = await s.research(
      plan.wiki_title,
      `${plan.game_title} ${plan.year} video game`,
      DOC_CHAPTER_SOURCE_CHARS,
      retro ? retroResearchFocus(retro, index, plan) : `${plan.chapter_title} ${plan.focus}`,
    );
    if (!article) {
      warnings.push(
        `No Wikipedia article for ${plan.game_title}; chapter dropped.`,
      );
      done.add(index);
      checkpoint();
      continue;
    }
    const sourceOf = (a: import("./discovery/wikipedia.ts").WikiArticle) =>
      retro
        ? retroChapterSource(retro, index, withTestRecords(a, records), press, retroIdx)
        : withRunSources(withTestRecords(a, records));
    let source = sourceOf(article);
    let widened = false;
    // Short of evidence: more to write from, on the first sign. A refusal or a list of unsupported lines is what a
    // thin brief produces; asking again with the same brief and a tighter rule turned a chapter into its own refusal.
    const widen = async () => {
      if (widened) return;
      widened = true;
      const wider = await widerDocSource(
        s,
        plan,
        topic.wiki ?? franchiseArticle?.title,
        outline.chapters.map((c) => c.wiki_title),
      ).catch(() => undefined);
      if (wider) source = sourceOf(wider);
      await logEvent(s.db, ep.id, "doc_source_widened", {
        chapter: index + 1,
        also: wider?.also ?? [],
        chars: source.text.length,
      });
    };
    let feedback: string[] = [];
    let chapter: import("./editorial/documentary.ts").DocChapter | undefined;
    // In a documentary with records: what is still unsupported after the rewrites, and whether the check ever ran.
    let stillUnsupported: string[] = [];
    let checkRan = false;
    // DOC_FACT_DISCIPLINE, without records: the last check's disputed lines (undefined when it could not run).
    let disputed: Array<{ quote: string; problem: string }> | undefined;
    // Only the rules asked for this revision: if its edits don't land the draft stands, and it isn't checked again.
    let ruleOnly = false;
    // The last fact check came back clean with no other problem: only then does the friend pass touch the chapter.
    let clean = false;
    let attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const previous = chapter;
      chapter = await writeChapter(s.llm, {
        franchise: topic.franchise,
        plan,
        index,
        outline,
        source,
        previousEnding: chapters.at(-1)?.chapter.paragraphs.at(-1)?.narration,
        feedback,
        earlier: chapters,
        priorDoc,
        // A refusal is not a draft to patch: it is written again from the wider sources.
        draft:
          attempt > 0 && chapter && !chapterRefusal(chapter).length
            ? chapter
            : undefined,
        loops: openLoops.loops,
        rules,
        keepDraft: ruleOnly,
      });
      if (ruleOnly && chapter === previous) break;
      // The writer says it can't, or wrote notes instead: no fact check to spend, more sources and again.
      const refused = chapterRefusal(chapter);
      if (refused.length && s.cfg.writerNotesGuard) {
        await logEvent(s.db, ep.id, "doc_chapter_refused", {
          chapter: index + 1,
          attempt,
          why: refused.slice(0, 3),
        });
        // Its last try may be the first to refuse: the wider sources always get one go.
        if (!widened) attempts = Math.max(attempts, attempt + 2);
        await widen();
        feedback = [
          "The SOURCE below now holds more of the record. Tell the chapter from it, as a story.",
          ...refused,
        ];
        continue;
      }
      const problems = validateChapter(chapter, {
        earlier: chapters,
        priorDoc,
        loops: openLoops.loops,
        chapter: index + 1,
      });
      // An every-game video never claims the games were played (src/editorial/everygame.ts): sent back like any fault.
      if (topic.format === "everygame")
        problems.push(
          ...honestyProblems(chapter.paragraphs.map((x) => x.narration).join(" ")),
        );
      // A retrospective's quoted reviews and lines are word for word from the source and say who said them.
      if (retro)
        problems.push(
          ...retroChapterProblems(chapter.paragraphs.map((x) => x.narration).join(" "), source, topic.franchise),
        );
      // A story spoiler for a game in its spoiler window goes back to the writer here, every draft, rather than
      // stopping the finished script at the door (20 Nov 2026: one "how the game ends" stopped a whole long video).
      problems.push(
        ...storySpoilerProblems(
          chapter.paragraphs
            .map((x) => [x.narration, x.callout?.primary, x.callout?.secondary].filter(Boolean).join(". "))
            .join(" "),
          s.now(),
          [topic.franchise, ...outline.chapters.map((c) => c.game_title)],
        ),
      );
      // A note to the editor instead of narration goes back every time (DOC_META_GUARD).
      if (s.cfg.docMetaGuard)
        problems.push(
          ...writerNoteProblems(
            chapter.paragraphs.map((x) => x.narration).join(" "),
          ),
        );
      // Credits across the whole video (ATTRIBUTION_GUARD, src/editorial/attribution.ts): Wikipedia on air, one frame
      // within a minute or over three times. Sent back once, on the first draft; the friend pass varies what is left.
      if (attempt === 0 && s.cfg.attributionGuard)
        problems.push(
          ...attributionProblems(
            chapter.paragraphs.map((x) => x.narration).join(" "),
            {
              before: chapters
                .map((c) => c.chapter.paragraphs.map((x) => x.narration).join(" "))
                .join(" "),
            },
          ),
        );
      // The rules read the first draft only, so each costs one revision at most.
      let misses: string[] = [];
      if (attempt === 0 && ruleRevisions > 0) {
        misses = chapterRuleProblems(chapter, {
          rules,
          written: chapters.map((c) =>
            c.chapter.paragraphs.map((x) => x.narration).join(" "),
          ),
          loops: openLoops.loops,
          chapter: index + 1,
        });
        if (misses.length) {
          ruleRevisions--;
          problems.push(...misses);
        }
      }
      // LONG_OPENING_CONTRACT=fix: two honest takes a chapter, asked once, on the first draft.
      if (attempt === 0 && rules.takesMin) {
        const said = chapter.paragraphs.map((x) => x.narration).join(" ");
        problems.push(
          ...takeProblems(said, rules.takesMin),
          // No stock opener ("I think", "Honestly") opens more than two takes in the whole video.
          ...stockOpenerProblems(
            chapters.map((c) => c.chapter.paragraphs.map((x) => x.narration).join(" ")).join(" "),
            said,
          ),
        );
      }
      let unsupported: string[];
      if (strict) {
        const items = await checkChapterItems(s.llm, chapter, source).catch(
          (err) => {
            log("warn", "documentary fact check failed", {
              error: errorMessage(err),
            });
            return undefined;
          },
        );
        checkRan = items !== undefined;
        const unbacked = chapter.paragraphs.flatMap((p) =>
          unbackedTestClaims(p.narration, records),
        );
        stillUnsupported = [...(items ?? []).map((u) => u.quote), ...unbacked];
        unsupported = [
          ...(items ?? []).map((u) => `"${u.quote}": ${u.problem}`),
          ...unbacked.map(
            (q) => `"${q}": it reports a test of ours with no record behind it`,
          ),
          ...(items ? [] : ["The fact check could not run on this draft."]),
        ];
      } else if (s.cfg.docFactDiscipline) {
        // DOC_FACT_DISCIPLINE: each disputed line kept apart, so what survives the rewrites can be mended or cut
        // (src/docfacts.ts); a check that could not run is undefined, never a pass.
        disputed = await checkChapterItems(s.llm, chapter, source).catch(
          (err) => {
            log("warn", "documentary fact check failed", {
              error: errorMessage(err),
            });
            return undefined;
          },
        );
        unsupported = (disputed ?? []).map((u) => `"${u.quote}": ${u.problem}`);
      } else
        unsupported = await checkChapter(s.llm, chapter, source).catch(
          (err) => {
            log("warn", "documentary fact check failed", {
              error: errorMessage(err),
            });
            return [] as string[];
          },
        );
      feedback = [
        ...problems,
        ...unsupported.map(
          (u) => `Not supported by the source, remove or correct it: ${u}`,
        ),
      ];
      clean = !feedback.length;
      if (!feedback.length) break;
      ruleOnly = misses.length > 0 && feedback.length === misses.length;
      // Under DOC_FACT_DISCIPLINE the disputed lines are settled after the rewrites (mended, cut or the chapter
      // dropped), so only the other problems stay as warnings.
      if (attempt === attempts - 1)
        warnings.push(
          ...(!strict && s.cfg.docFactDiscipline ? problems : feedback).map(
            (f) => `${plan.game_title}: ${f}`,
          ),
        );
      // Lines the source doesn't back: the next try has more of the record in front of it.
      else if (unsupported.length && s.cfg.writerNotesGuard) await widen();
    }
    // Still a refusal after the wider sources: this chapter can't be told. Never a warning: it is dropped and the
    // rest goes on while the documentary can still reach DOC_MIN_CHAPTERS (18 Nov 2026: chapter 7 of "GTA 6 Map
    // Explained: Leonida" stopped a documentary with six chapters already written), otherwise the video stops here.
    if (s.cfg.writerNotesGuard) {
      const refused = chapterRefusal(chapter!);
      if (refused.length) {
        const title = outline.title;
        await logEvent(s.db, ep.id, "doc_chapter_refused", {
          chapter: index + 1,
          final: true,
          why: refused.slice(0, 3),
        });
        const fate = refusedChapterFate({
          on: s.cfg.docDropRefusedChapter,
          // Nothing written yet (an earlier chapter had no article) counts as the first: the video can't open two in.
          position: chapters.length ? position : 0,
          written: chapters.length,
          left: order.length - position - 1,
          // A sandbox or a picked set of chapters has no minimum at the end either.
          min: s.cfg.docSandboxChapters || pick ? 1 : s.cfg.docMinChapters,
        });
        if (fate.drop) {
          droppedRefused.push(index + 1);
          // A question raised or answered in this chapter would be left hanging: it goes with the chapter.
          const kept = loopsWithoutChapter(openLoops.loops, index + 1);
          openLoops.loops = kept.loops;
          openLoops.removed.push(...kept.removed);
          // A question an earlier chapter already asked now has no answer: named for the release checks.
          warnings.push(...kept.hanging.map((h) => `${plan.game_title}: ${h}`));
          warnings.push(
            `${plan.game_title}: chapter ${index + 1} ("${plan.chapter_title}") dropped, the writer still refused it after widening its sources.`,
          );
          await logEvent(s.db, ep.id, "doc_chapter_dropped", {
            chapter: index + 1,
            title: plan.chapter_title,
            why: refused.slice(0, 3),
            fate: fate.why,
            loopsRemoved: kept.removed,
            loopsHanging: kept.hanging,
          });
          done.add(index);
          checkpoint();
          await s.notify({
            content: `✂️ "${title}": dropped chapter ${index + 1} ("${plan.chapter_title}"), it still can't be written after widening its sources; the documentary goes on without it (${fate.why}). ${refused[0]!.slice(0, 240)}`,
          });
          continue;
        }
        await s.notify({
          ping: true,
          content: `🛑 Stopped the documentary "${title}": chapter ${index + 1} ("${plan.chapter_title}") still can't be written after widening its sources, and it can't be dropped: ${fate.why}. ${refused[0]!.slice(0, 300)}`,
        });
        throw new FatalError(
          `documentary chapter ${index + 1} refused after widening its sources: ${refused[0]!.slice(0, 200)}`,
        );
      }
    }
    // Still a note and not narration after every rewrite: no chapter is better than that one.
    if (
      s.cfg.docMetaGuard &&
      writerNoteProblems(
        chapter!.paragraphs.map((x) => x.narration).join(" "),
      ).length
    ) {
      warnings.push(
        `${plan.game_title}: chapter dropped, the writer returned a note instead of narration.`,
      );
      done.add(index);
      checkpoint();
      continue;
    }
    if (strict) {
      // Nothing unchecked or unsupported goes out here: no check, no chapter; unsupported sentences are cut.
      const cut = cutSentences(chapter!, stillUnsupported);
      if (!checkRan || cut.lost) {
        warnings.push(
          `${plan.game_title}: chapter dropped, ${checkRan ? "an unsupported line could not be cut" : "the fact check could not run"}.`,
        );
        done.add(index);
        checkpoint();
        continue;
      }
      if (stillUnsupported.length)
        warnings.push(
          `${plan.game_title}: ${stillUnsupported.length} unsupported line${stillUnsupported.length === 1 ? "" : "s"} cut.`,
        );
      chapter = cut.chapter;
    } else if (s.cfg.docFactDiscipline) {
      // DOC_FACT_DISCIPLINE (src/docfacts.ts): no line the fact check disputes goes on. What survived the rewrites
      // is mended or its sentence cut, within the chapter's cap, and checked once more; only a clean check keeps the
      // chapter. Otherwise it is dropped where a refused chapter could be (DOC_DROP_REFUSED_CHAPTER), or the video stops.
      const settled = await disciplineChapter({
        chapter: chapter!,
        disputed,
        check: (c) => checkChapterItems(s.llm, c, source),
        maxCutShare: s.cfg.docFactCutPercent / 100,
      });
      await logEvent(s.db, ep.id, "doc_fact_discipline", {
        chapter: index + 1,
        ok: settled.ok,
        disputed: disputed?.length ?? null,
        repairs: settled.repairs,
        ...(settled.ok ? { cut_words: settled.cut, of_words: settled.base } : { why: settled.why, left: settled.left }),
      }).catch(() => undefined);
      if (settled.ok) {
        if (settled.repairs.length) {
          chapter = settled.chapter;
          // Mended text: the friend, clarity and humaniser passes stay off it, as for any chapter that wasn't clean.
          clean = false;
          warnings.push(docFactLine(`${plan.game_title}: chapter ${index + 1}`, settled.repairs));
        }
      } else {
        // The check itself could not run: no verdict, so the step is tried again later (finished chapters resume).
        if (settled.errored)
          throw new Error(`documentary chapter ${index + 1}: ${settled.why}; trying again later`);
        const title = outline.title;
        const fate = refusedChapterFate({
          on: s.cfg.docDropRefusedChapter,
          position: chapters.length ? position : 0,
          written: chapters.length,
          left: order.length - position - 1,
          min: s.cfg.docSandboxChapters || pick ? 1 : s.cfg.docMinChapters,
        });
        if (!fate.drop) {
          await s.notify({
            ping: true,
            content: `🛑 Stopped the documentary "${title}": chapter ${index + 1} ("${plan.chapter_title}") still has lines its fact check disputes after the rewrites and the cuts (${settled.why}), and it can't be dropped: ${fate.why}.`,
          });
          throw new FatalError(
            `documentary chapter ${index + 1} fails its fact check after rewrites and cuts: ${settled.why.slice(0, 220)}`,
          );
        }
        const kept = loopsWithoutChapter(openLoops.loops, index + 1);
        openLoops.loops = kept.loops;
        openLoops.removed.push(...kept.removed);
        warnings.push(...kept.hanging.map((h) => `${plan.game_title}: ${h}`));
        warnings.push(
          `${plan.game_title}: chapter ${index + 1} ("${plan.chapter_title}") dropped, its fact check still disputes it after the rewrites and the cuts: ${settled.why}.`,
        );
        await logEvent(s.db, ep.id, "doc_chapter_dropped", {
          chapter: index + 1,
          title: plan.chapter_title,
          why: [settled.why],
          fate: fate.why,
          facts: true,
          loopsRemoved: kept.removed,
          loopsHanging: kept.hanging,
        });
        done.add(index);
        checkpoint();
        await s.notify({
          content: `✂️ "${title}": dropped chapter ${index + 1} ("${plan.chapter_title}"), its fact check still disputes it after the rewrites and the cuts (${settled.why.slice(0, 240)}); the documentary goes on without it (${fate.why}).`,
        });
        continue;
      }
    }
    // Wikipedia never reaches the voice: a line that still names it loses the credit (src/editorial/attribution.ts).
    {
      const scrubbed = scrubNarration(chapter!.paragraphs);
      if (scrubbed.changed) {
        chapter = { ...chapter!, paragraphs: scrubbed.lines };
        warnings.push(
          `${plan.game_title}: Wikipedia taken off the air in ${scrubbed.changed} line${scrubbed.changed === 1 ? "" : "s"}.`,
        );
      }
    }
    // The credits that still repeat across the video, for the friend pass to reword.
    const credits = s.cfg.attributionGuard
      ? attributionProblems(
          chapter!.paragraphs.map((x) => x.narration).join(" "),
          {
            before: chapters
              .map((c) => c.chapter.paragraphs.map((x) => x.narration).join(" "))
              .join(" "),
          },
        )
      : [];
    // LONG_OPENING_CONTRACT=fix: a later pass that leaves the chapter with fewer takes than it had and needs (takesGuard).
    const takesLost = (before: { paragraphs: Array<{ narration: string }> }, after: typeof before): string[] =>
      rules.takesMin
        ? takesGuard(
            before.paragraphs.map((x) => x.narration).join(" "),
            after.paragraphs.map((x) => x.narration).join(" "),
            rules.takesMin,
          )
        : [];
    // The friend pass (FRIEND_PASS) on a chapter the fact check passed clean: the delivery only, kept when no figure,
    // name or quote moved, no chapter rule newly breaks and the fact check passes it again.
    if (clean && friendPassOn(s.cfg, "documentary")) {
      const before = chapter!;
      const rulesFor = (c: typeof before) =>
        validateChapter(c, {
          earlier: chapters,
          priorDoc,
          loops: openLoops.loops,
          chapter: index + 1,
        });
      const friend = await friendPass({
        before,
        write: () =>
          friendChapter(s.llm, before, {
            tier: s.cfg.friendPassTier,
            credits,
            ...(rules.takesMin ? { takesMin: rules.takesMin } : {}),
          }),
        guard: (after) => [
          ...friendChapterProblems(before, after),
          // The pass may reword credits, never add a repeat or put Wikipedia back on air.
          ...(s.cfg.attributionGuard
            ? newProblems(
                attributionProblems(before.paragraphs.map((x) => x.narration).join(" ")),
                attributionProblems(after.paragraphs.map((x) => x.narration).join(" ")),
              )
            : []),
          ...newProblems(rulesFor(before), rulesFor(after)),
          // LONG_OPENING_CONTRACT=fix: the pass may reword a take, never cut the chapter below its takes.
          ...takesLost(before, after),
          ...chapterRefusal(after),
        ],
        check: (after) => checkChapter(s.llm, after, source),
      });
      chapter = friend.value;
      await logEvent(s.db, ep.id, "doc_friend_pass", {
        chapter: index + 1,
        kept: friend.kept,
        why: friend.why.slice(0, 4),
      }).catch(() => undefined);
    }
    // The clarity gate (CLARITY_GATE) per chapter: a cold read, then the flagged lines rewritten in the narrator's voice
    // (under CLARITY_MIN) or plainly, each version kept only when no fact moved, no chapter rule newly breaks and the
    // fact check passes it.
    if (clean && friendPassOn({ friendPass: s.cfg.clarityGate }, "documentary")) {
      const settled = chapter!;
      const rulesFor = (c: typeof settled) =>
        validateChapter(c, {
          earlier: chapters,
          priorDoc,
          loops: openLoops.loops,
          chapter: index + 1,
        });
      let lastRead: Awaited<ReturnType<typeof judgeClarity>> | undefined;
      const clarity = await clarityGate<typeof settled>({
        value: settled,
        min: s.cfg.clarityMin,
        judge: async (v) =>
          (lastRead = await judgeClarity(s.llm, {
            lines: v.paragraphs.map((x) => x.narration),
            title: plan.chapter_title,
            format: "chapter",
          })),
        writer: (v) =>
          lastRead
            ? clarityRewriteChapter(s.llm, v, lastRead, { min: s.cfg.clarityMin })
            : Promise.reject(new Error("no cold read to revise from")),
        rewrite: (v, j, plain) =>
          clarityRewriteChapter(s.llm, v, j, { plain, min: s.cfg.clarityMin }),
        accept: async (before, after) => {
          const guard = [
            ...clarityChapterProblems(before, after),
            ...(s.cfg.attributionGuard
              ? newProblems(
                  attributionProblems(before.paragraphs.map((x) => x.narration).join(" ")),
                  attributionProblems(after.paragraphs.map((x) => x.narration).join(" ")),
                )
              : []),
            ...newProblems(rulesFor(before), rulesFor(after)),
            ...takesLost(before, after),
            ...chapterRefusal(after),
          ];
          return guard.length ? guard : checkChapter(s.llm, after, source);
        },
      });
      chapter = clarity.value;
      await logEvent(s.db, ep.id, "doc_clarity_gate", {
        chapter: index + 1,
        ...clarityLog(clarity),
        kept: clarity.value !== settled,
      }).catch(() => undefined);
    }
    // The humaniser per chapter (HUMANISE): names already said in earlier chapters count, so "Grand Theft Auto VI"
    // is said in full once in the whole video. The chapter's fact check reads the humanised words.
    if (clean && s.cfg.humanise !== "off") {
      const earlier = chapters
        .map((c) => c.chapter.paragraphs.map((x) => x.narration).join(" "))
        .join(" ");
      const games = outline.chapters.map((c) => c.game_title).filter(Boolean);
      const publishAt = ep.slot_at ? new Date(ep.slot_at) : undefined;
      const settled = chapter!;
      const rulesFor = (c: typeof settled) =>
        validateChapter(c, {
          earlier: chapters,
          priorDoc,
          loops: openLoops.loops,
          chapter: index + 1,
        });
      const human = await humaniseStep<typeof settled>({
        mode: s.cfg.humanise,
        value: settled,
        run: (v, mode) => {
          const r = humaniseChapter(v, { mode, earlier, games, ...(publishAt ? { publishAt } : {}) });
          return { value: r.chapter, result: r.result };
        },
        problems: (before, after, removed) => [
          ...humaniseDrift(
            before.paragraphs.map((x) => x.narration).join(" "),
            after.paragraphs.map((x) => x.narration).join(" "),
            { removedFigures: removed },
          ),
          ...newProblems(rulesFor(before), rulesFor(after)),
          ...takesLost(before, after),
          ...chapterRefusal(after),
        ],
        rewrite: (v, notes) =>
          friendChapter(s.llm, v, {
            tier: s.cfg.friendPassTier,
            humanNotes: notes,
            site: "humanise.rewrite",
            ...(rules.takesMin ? { takesMin: rules.takesMin } : {}),
          }),
        check: (after) => checkChapter(s.llm, after, source),
      });
      chapter = human.value;
      await logEvent(s.db, ep.id, "doc_humanise", {
        chapter: index + 1,
        ...human.log,
      }).catch(() => undefined);
    }
    const grounded = groundCallouts(chapter!, source);
    if (grounded.removed.length)
      warnings.push(
        ...grounded.removed.map(
          (r) =>
            `${plan.game_title}: on-screen ${r} not in the source, removed`,
        ),
      );
    // The shot list: a picture, graphic, caption or B-roll for every sentence (one mid-tier call a chapter).
    let moments: DocMoment[] | undefined;
    try {
      const sentences = grounded.chapter.paragraphs.flatMap((p) =>
        sentencesOf(p.narration),
      );
      const shot = groundDocMoments(
        await writeDocMoments(s.llm, {
          game: plan.game_title,
          chapterTitle: plan.chapter_title,
          sentences,
          source,
          games: outline.chapters.map((c) => c.game_title),
          lessons: await visualLessons(s.db, s.now(), segmentInputs).catch(
            () => "",
          ),
          evidence: s.cfg.docEvidence,
          verdicts: rules.verdicts,
        }),
        source,
        outline.chapters.map((c) => c.game_title),
        sentences,
        rules.verdicts,
      );
      moments = shot.moments;
      // DOC_EVIDENCE: the key beats show the record itself, word for word from the source (src/editorial/evidence.ts).
      if (s.cfg.docEvidence) {
        const ev = markEvidence(moments, sentences, source);
        moments = ev.moments;
        if (ev.added.length)
          await logEvent(s.db, ep.id, "doc_evidence", {
            chapter: index + 1,
            added: ev.added,
          });
      }
      if (shot.removed.length)
        warnings.push(
          ...shot.removed.map(
            (r) =>
              `${plan.game_title}: on-screen ${r} not in the source, removed`,
          ),
        );
    } catch (err) {
      log("warn", "documentary shot list failed", {
        episode: ep.id,
        chapter: index + 1,
        error: errorMessage(err),
      });
    }
    chapters.push({ plan, chapter: grounded.chapter, source, moments });
    written.push(index);
    done.add(index);
    checkpoint();
    log("info", "documentary chapter written", {
      episode: ep.id,
      chapter: index + 1,
      game: plan.game_title,
    });
  }
  // Every chapter is settled: a failure from here on writes the documentary afresh, it doesn't resume.
  ck.loopDone = true;
  if (!s.cfg.docSandboxChapters && !pick && chapters.length < s.cfg.docMinChapters)
    throw new FatalError(
      `documentary has only ${chapters.length} chapters with sources${droppedRefused.length ? ` (chapter${droppedRefused.length === 1 ? "" : "s"} ${droppedRefused.join(", ")} dropped after refusals)` : ""}`,
    );
  // LONG_OPENING_CONTRACT and LONG_ARGUES: with both off nothing below reads, measures or calls anything new, so an
  // older or mocked outline (no youtube block, no sources) runs exactly as before.
  const longOn = s.cfg.longOpeningContract !== "off" || s.cfg.longArgues !== "off";
  const sourceTexts = () => [franchise?.text ?? "", ...chapters.map((c) => c.source?.text ?? "")];
  // The title the opening serves, as it will go out, and the source's dated quotes (contract "fix" only).
  const finalTitle = rules.contract
    ? topic.format === "everygame" || topic.why_died
      ? topic.title_idea
      : (retro?.title ?? topic.planned?.title ?? outline.youtube?.title ?? outline.title ?? topic.title_idea)
    : "";
  const quotes = s.cfg.longOpeningContract === "off" ? [] : openingQuotes(sourceTexts());
  const ends = {
    priorDoc,
    loops: openLoops.loops,
    echo: s.cfg.docBookendEnding,
    rules,
    chapters: chapters.map((c) =>
      c.chapter.paragraphs.map((x) => x.narration).join(" "),
    ),
    ...(rules.contract
      ? {
          quotes,
          contract: {
            title: finalTitle,
            quotes,
            sources: sourceTexts(),
            finishLine: finishCarried,
          },
        }
      : {}),
  };
  let bookends = await writeBookends(
    s.llm,
    outline,
    chapters,
    franchise?.text ?? "",
    ends,
  );
  const endProblems = validateBookends(bookends, ends);
  // LONG_OPENING_CONTRACT=fix: what the opening missed, sent back with the rest once; then it stands, with a note.
  const contractSentBack = rules.contract ? endProblems : [];
  if (endProblems.length)
    bookends = await writeBookends(
      s.llm,
      outline,
      chapters,
      franchise?.text ?? "",
      { ...ends, feedback: endProblems },
    );
  if (strict) {
    const clean = cleanBookends(bookends, records);
    bookends = clean.bookends;
    if (clean.removed.length)
      warnings.push(
        ...clean.removed.map((r) => `Bookend line with no test behind it cut: ${r}`),
      );
  }
  // A retrospective opens on its spoiler warning, its very first line, and keeps which chapters were written.
  if (retro) {
    bookends = {
      ...bookends,
      intro: { ...bookends.intro, narration: withRetroWarning(bookends.intro.narration, retro.short) },
    };
    retro.written = written;
  }
  const draft: DocDraft = { topic, outline, chapters, bookends };
  if (s.cfg.docOpenLoops) {
    const placed = placeDocLoops(draft, openLoops.loops);
    draft.loops = placed.placed;
    warnings.push(...openLoops.removed, ...placed.removed);
    await logEvent(s.db, ep.id, "open_loops", {
      planned: openLoops.loops.length,
      placed: placed.placed,
      removed: [...openLoops.removed, ...placed.removed],
    });
    await s.notify({
      content: openLoopsLine(
        outline.title,
        placed.placed,
        openLoops.loops.length,
      ),
    });
  }
  const words = docWordCount(draft);
  if (words < DOC_WORDS_MIN || words > DOC_WORDS_MAX)
    warnings.push(
      `Documentary is ${words} words (aim ${DOC_WORDS_MIN}-${DOC_WORDS_MAX}).`,
    );
  if (warnings.length)
    await logEvent(s.db, ep.id, "style_warnings", { problems: warnings });
  // The fact check's last word used to be a line in the log nobody reads, and the FFXIV refusals were in it.
  // DOC_FACT_DISCIPLINE: what was mended or cut, never a disputed line kept (25 Nov 2026: Cyberpunk 2077 kept 18).
  const factLines = warnings.filter((w) => /: fact check: \d+ disputed line/.test(w));
  if (factLines.length)
    await s.notify({
      content: `✂️ "${outline.title}": the fact check's disputed lines were mended or cut, then checked clean, in ${factLines.length} chapter${factLines.length === 1 ? "" : "s"}. ${factLines[0]!.slice(0, 300)}`,
    });
  const stillUnbacked = warnings.filter((w) => /Not supported by the source/.test(w));
  if (stillUnbacked.length && !strict && s.cfg.docFactDiscipline)
    // Can't happen: every disputed line was settled above. If it ever does, nothing disputed goes to the voice.
    throw new FatalError(
      `documentary still holds ${stillUnbacked.length} disputed line${stillUnbacked.length === 1 ? "" : "s"} after the fact discipline: ${stillUnbacked[0]!.slice(0, 200)}`,
    );
  // With records (strict) those lines were cut above, sentence by sentence; without, only DOC_FACT_DISCIPLINE off keeps them.
  if (stillUnbacked.length)
    await s.notify({
      content: strict
        ? `✂️ "${outline.title}": ${stillUnbacked.length} line${stillUnbacked.length === 1 ? "" : "s"} the fact check still disputed after the rewrites ${stillUnbacked.length === 1 ? "was" : "were"} cut. First: ${stillUnbacked[0]!.slice(0, 280)}`
        : `⚠️ "${outline.title}": the fact check still disputes ${stillUnbacked.length} line${stillUnbacked.length === 1 ? "" : "s"} after the rewrites, and they stay in (DOC_FACT_DISCIPLINE is off). First: ${stillUnbacked[0]!.slice(0, 280)}`,
    });
  if (longRulesOn(rules)) {
    const said = narrationOfDoc(draft);
    warnings.push(...longRuleWarnings(said, rules));
    await logEvent(s.db, ep.id, "long_rules", {
      kind: rules.kind,
      measures: scriptMeasures(said),
      revisionsLeft: ruleRevisions,
      hookStack: bookends.intro.hook_stack,
      runSources: runSources.read,
      runSourcesMissed: runSources.missed,
    });
  }
  // CHARACTER_QUOTES (src/charquotestep.ts): a few of the game's own lines, each set up and answered by the narrator.
  const script = await quoteLongStep(
    s,
    ep,
    docToScript(draft),
    retro ? retroQuoteOptions(s.cfg, retro, topic.franchise) : {},
  );
  // An every-game video keeps its planned title: none of the test titles a model writes is in the honest frame by rule.
  if (topic.format === "everygame") {
    script.youtube.title = topic.title_idea;
    script.youtube.title_variants = [];
  }
  // A "why it died" film keeps its framed title, carrying the loss, and the loss figure is its thumbnail word.
  if (topic.why_died) {
    script.why_died = topic.why_died;
    script.youtube.title = topic.title_idea;
    script.youtube.title_variants = framedVariants("whydied", script.youtube.title_variants ?? [], topic.why_died.game);
    script.youtube.thumb_text = lossThumb(topic.why_died.loss);
  }
  // A weekly guide keeps its fixed frame: one title shape and one set of thumbnail words for the strand.
  if (topic.guide && s.cfg.guideWeekly) applyGuideFrame(script, topic.guide);
  // A retrospective keeps its planned title (it says it spoils) and thumbnail words.
  if (retro) {
    script.youtube.title = retro.title;
    script.youtube.title_variants = [];
    if (retro.thumb) script.youtube.thumb_text = retro.thumb;
  }
  // A search-led planned entry: its title through the search title step, and its planned thumbnail words.
  if (topic.planned) {
    const planned = topic.planned;
    const keeps = (t: string) => plannedTitle(t, planned, topic.franchise) === t;
    const title = plannedTitle(script.youtube.title, planned, topic.franchise);
    // The title test only tries titles that keep the search's words too.
    script.youtube.title_variants = (script.youtube.title_variants ?? []).filter(
      (t) => t !== title && keeps(t),
    );
    script.youtube.title = title;
    if (topic.planned.thumb) script.youtube.thumb_text = topic.planned.thumb;
  }
  if (franchise && !script.sources?.includes(franchise.url))
    script.sources = [franchise.url, ...(script.sources ?? [])];
  for (const u of runSources.urls)
    if (!script.sources?.includes(u)) (script.sources ??= []).push(u);
  // LONG_OPENING_CONTRACT and LONG_ARGUES on the record (check and fix); off, nothing is measured or called.
  // A finish line the outline planned but placement dropped (findFinishPlant, findFinishPayoff): a finding.
  const finishGone = longOn
    ? warnings.find((w) => /^finish line ".*": never (raised|answered)$/.test(w))
    : undefined;
  const finishQuestion = longOn ? openLoops.loops.find((l) => l.finish_line)?.question : undefined;
  const longChecks: LongRecord = longOn
    ? await recordLongChecks(s, ep.id, script, {
        // A "claims" entry is measured as one under check too; only fix writes it as one.
        kind: topic.format === "claims" ? "claims" : rules.guide ? "guide" : "documentary",
        quotes,
        topic,
        fixed: contractSentBack,
        finishLine: finishCarried,
        sources: sourceTexts(),
        sourceUrls: [
          franchise?.url ?? "",
          ...chapters.map((c) => c.source?.url ?? ""),
          ...(runSources.urls ?? []),
        ],
        ...(finishQuestion && finishGone
          ? {
              finishMissing: {
                question: finishQuestion,
                why: finishGone.endsWith("never answered") ? ("not paid" as const) : ("not planted" as const),
              },
            }
          : {}),
      })
    : { warnings: [] };
  if (longChecks.warnings.length) warnings.push(...longChecks.warnings);
  await guardScript(s, ep, script, "after writing");
  ck.clear();
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      doc: true,
      topic,
      words,
      sources: script.sources,
      warnings,
      ...(longChecks.long_contract ? { long_contract: longChecks.long_contract } : {}),
      ...(longChecks.long_argues ? { long_argues: longChecks.long_argues } : {}),
    },
  });
}

/** A planned entry's own sources as source text under "[Outlet] title" headers (sourceCredit reads those); a page that won't open is left out and named. */
async function readRunSources(
  s: Services,
  topic: DocTopic,
): Promise<{ text: string; urls: string[]; read: number; missed: string[]; parts: Array<{ url: string; text: string }> }> {
  const list = topic.sources ?? [];
  const claims = topic.format === "claims" && s.cfg.longArgues === "fix";
  if (!list.length || (!claims && topic.format !== "retro" && (topic.format !== "guide" || !s.cfg.longGuideFormat)))
    return { text: "", urls: [], read: 0, missed: [], parts: [] };
  const got = await Promise.all(
    list.map((u) =>
      s.cfg.primarySources && /wikipedia\.org\//.test(u.url)
        ? Promise.resolve(undefined)
        : s.fetchArticle(u.url).catch(() => undefined),
    ),
  );
  const parts: string[] = [];
  const urls: string[] = [];
  const missed: string[] = [];
  const each: Array<{ url: string; text: string }> = [];
  list.forEach((u, i) => {
    // Wikipedia is the map (PRIMARY_SOURCES): its article is each chapter's research, with the references it cites,
    // so a "[Wikipedia]" section would only teach the writer to say "according to Wikipedia" (10 Nov 2026).
    if (s.cfg.primarySources && /wikipedia\.org\//.test(u.url)) return;
    const a = got[i];
    if (!a?.text?.trim()) return void missed.push(u.url);
    // A retrospective's press (a review, a making-of feature) is read at more length: its quotes are the chapter's.
    const text = `[${u.source}] ${a.title}\n${a.text.slice(0, topic.format === "retro" ? 6000 : 2500)}`;
    parts.push(text);
    each.push({ url: u.url, text });
    urls.push(u.url);
  });
  return { text: parts.join("\n\n"), urls, read: urls.length, missed, parts: each };
}

/**
 * The remake (owner, 28 Oct 2026: "remake the documentaries that haven't posted yet, saving their
 * narration ... with this whole new massive visual overhaul"). A long video keeps its narration (no new
 * ElevenLabs credits) and gets what it was made without: a shot list for every sentence (one mid-tier call a
 * chapter, grounded in its Wikipedia source), the breathers before each chapter (silence put into the same
 * voice file), and fresh media matched to the shot list. Its old upload goes private for the owner to delete
 * (never deleted here) and the pipeline renders and uploads it again into its original slot.
 */
export async function prepareRemake(
  s: Services,
  id: string,
): Promise<{ moments: number; breaks: number; oldVideo?: string }> {
  const ep = await getEpisode(s.db, id);
  if (!ep?.script_json || !ep.assets_json?.audio)
    throw new Error("no voiced episode with that id");
  if (ep.script_json.runtime !== "long")
    throw new Error("only long videos are remade");
  if (ep.status === "uploading")
    throw new Error("it is uploading now; try again once that finishes");
  const dir = episodeDir(s.cfg, ep.id);
  const script = structuredClone(ep.script_json);
  const assets: EpisodeAssets = { ...ep.assets_json };
  const doc = script.evergreen_format === "documentary";
  let moments = 0;
  // 1. The shot list, chapter by chapter, for a documentary made before it existed.
  if (
    doc &&
    script.entries?.length &&
    !script.entries.some((e) => e.moments?.length)
  ) {
    const chapterBeats: string[][] = [];
    for (const b of script.beats) {
      if (b.visual?.kind === "chapter" || !chapterBeats.length)
        chapterBeats.push([]);
      chapterBeats[chapterBeats.length - 1]!.push(b.narration);
    }
    const games = script.entries.map((e) => e.game_title);
    const norm = (t: string) =>
      decodeURIComponent(t)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    for (const [ci, entry] of script.entries.entries()) {
      const sentences = (chapterBeats[ci] ?? []).flatMap((n) => sentencesOf(n));
      if (!sentences.length) continue;
      const url = (script.sources ?? []).find(
        (u) => norm(u.split("/wiki/")[1] ?? "") === norm(entry.game_title),
      );
      const source = await s.research(
        url
          ? decodeURIComponent(url.split("/wiki/")[1]!).replace(/_/g, " ")
          : entry.game_title,
        `${entry.game_title} ${entry.year} video game`,
        9000,
      );
      if (!source) continue;
      const chapterTitle =
        script.beats.filter((b) => b.visual?.kind === "chapter")[ci]?.visual
          ?.primary ?? entry.game_title;
      const shot = groundDocMoments(
        await writeDocMoments(s.llm, {
          game: entry.game_title,
          chapterTitle,
          sentences,
          source,
          games,
          lessons: await visualLessons(s.db, s.now(), segmentInputs).catch(
            () => "",
          ),
        }),
        source,
        games,
        sentences,
      );
      entry.moments = shot.moments;
      moments += shot.moments.filter((m) => m.graphic.kind !== "none").length;
    }
  }
  // 2. The breathers before each chapter, put into the narration it already has.
  let breaks = 0;
  if (doc && !assets.breaks?.length && assets.words?.length) {
    const words = assets.words;
    const duration = assets.durationSeconds ?? words[words.length - 1]!.end;
    const segs = buildSegments(segmentInputs(script), words, duration);
    const firstWords = segs
      .filter((g) => g.kind === "beat" && g.visual?.kind === "chapter")
      .map((g) => words.findIndex((w) => w.start >= g.start - 0.05))
      .filter((k) => k > 0);
    const gaps = chapterGaps(words, firstWords, DOC_BREAK_SECONDS);
    if (gaps.length) {
      await insertSilence(path.join(dir, assets.audio!), gaps);
      assets.words = openWords(words, gaps);
      assets.durationSeconds =
        duration + gaps.reduce((n, g) => n + g.seconds, 0);
      let added = 0;
      assets.breaks = gaps.map((g) => {
        const start = g.at + added;
        added += g.seconds;
        return { start, end: start + g.seconds };
      });
      await fs.writeFile(
        path.join(dir, "captions.srt"),
        srtFromWords(assets.words),
        "utf8",
      );
      breaks = gaps.length;
    }
  }
  // 3. Fresh media matched to the shot list, and a new plan, details and thumbnails.
  for (const k of [
    "images",
    "clips",
    "plan",
    "longPlan",
    "annotations",
    "thumb",
  ] as const)
    delete (assets as Record<string, unknown>)[k];
  // 4. The old upload goes private (the owner deletes it); the episode renders again into its slot.
  const oldVideo = ep.youtube_video_id ?? undefined;
  if (oldVideo)
    await s
      .youtube(accountOf(ep))
      .setPrivacy(oldVideo, "private")
      .catch(() => undefined);
  await s.db.query(
    `UPDATE episodes SET status = 'voiced', script_json = $2, assets_json = $3, youtube_video_id = NULL,
            youtube_status = NULL, upload_session_uri = NULL, qa_json = NULL, attempts = 0, last_error = NULL,
            next_attempt_at = NULL WHERE id = $1`,
    [ep.id, JSON.stringify(script), JSON.stringify(assets)],
  );
  await logEvent(s.db, ep.id, "remake", {
    moments,
    breaks,
    oldVideo,
    publishAt: ep.publish_at,
  });
  return { moments, breaks, oldVideo };
}

/** The weekly long-form ranking video: same topic pool as the evergreen Shorts, its own slot and lane. */
/** The ranking Shorts that did well and have no long ranking yet (src/sequels.ts). */
async function longSequels(s: Services, now: Date) {
  const { winners, norm } = await sequelWinners(s.db, now);
  const made = await s.db.query<{ theme: string | null }>(
    `SELECT story_json->>'gameHint' AS theme FROM episodes WHERE lane = 'longform' AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '180 days'`,
    [now],
  );
  return rankingSequels(
    winners,
    norm,
    made.map((r) => r.theme ?? ""),
  );
}

/**
 * One info line when a lane goes quiet, naming why (20 Nov 2026: the long ranking lane published nothing for a week
 * and the log said nothing at all; LONGFORM_DAYS was "sat" only). Said again only when the reason changes or after
 * `everyMs`, so the selection tick, which runs every few minutes, does not repeat it. Returns whether it was said.
 */
const quietSaid = new Map<string, { reason: string; at: number }>();
export function quietLog(
  lane: string,
  reason: string,
  extra: Record<string, unknown> = {},
  now = Date.now(),
  everyMs = 6 * 3_600_000,
): boolean {
  const was = quietSaid.get(lane);
  if (was && was.reason === reason && now - was.at < everyMs) return false;
  quietSaid.set(lane, { reason, at: now });
  log("info", `${lane}: nothing picked`, { reason, ...extra });
  return true;
}

/** A lane picked something: its next quiet spell is said afresh. */
export function quietReset(lane: string): void {
  quietSaid.delete(lane);
}

/** Who holds a slot, for the quiet log: "news ep_..." or undefined. */
async function slotHolder(
  db: Db,
  slot: Date | undefined,
): Promise<string | undefined> {
  if (!slot) return undefined;
  const [row] = await db.query<{ id: string; lane: string }>(
    `SELECT id, lane FROM episodes WHERE slot_at = $1 AND status NOT IN ('failed','rejected') LIMIT 1`,
    [slot],
  );
  return row ? `${row.lane} ${row.id}` : undefined;
}

/**
 * The long ranking's shortlist after the demand check: the topics it kept or, when it would drop every one (fresh
 * "no demand" readings for all of them), the whole pool, so the demand check alone never leaves a long slot empty.
 * A topic whose search could not run (YouTube's bot check) is already kept as "not checked" (rankByDemand).
 */
export function longShortlist<T>(
  kept: T[],
  base: T[],
): { list: T[]; demandIgnored: boolean } {
  if (kept.length || !base.length) return { list: kept, demandIgnored: false };
  return { list: base, demandIgnored: true };
}

/** The shortlist without topics that failed recently: a candidate goes when its name and a failed theme overlap. */
export function dropFailedThemes<T extends { name: string }>(list: T[], failedThemes: string[]): T[] {
  // Bracketed descriptions are set aside: a failed theme is stored as "Half-Life and Portal (Valve's shared universe:
  // ...)", which matched no shorter name, so the same topic was picked four times on 20 Nov.
  const norm = (x: string) => x.replace(/\([^)]*\)?/g, " ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const failed = failedThemes.map(norm).filter(Boolean);
  if (!failed.length) return list;
  // Whole words only, so "Ys" is not left out because a failed theme says "Days Gone".
  const has = (x: string, y: string) => ` ${x} `.includes(` ${y} `);
  return list.filter((c) => {
    const n = norm(c.name);
    return !n || !failed.some((f) => has(f, n) || has(n, f));
  });
}

/**
 * The picker writes its own theme, so a topic that failed can come back under a new name ("Valve's Half-Life and
 * Portal games" after three Half-Life and Portal failures, 20 Nov). A picked theme that overlaps a recent failure is
 * swapped for the top shortlist topic that neither failed nor was ranked lately; undefined when there is none.
 */
export function avoidFailedTheme(
  topic: EvergreenTopic,
  candidates: EvergreenCandidate[],
  failedThemes: string[],
  covered: string[],
): EvergreenTopic | undefined {
  if (!failedThemes.length || dropFailedThemes([{ name: topic.theme }], failedThemes).length) return topic;
  const clean = new Set(dropFailedThemes(candidates, failedThemes));
  const ok = (c: EvergreenCandidate | undefined) => !!c && clean.has(c) && !covered.some((h) => sameSeries(h, c.name));
  // The picker's own candidate first: often only its free-text theme overlapped the failure.
  const at = ok(candidates[topic.candidate_index]) ? topic.candidate_index : candidates.findIndex(ok);
  if (at < 0) return undefined;
  const best = candidates[at]!;
  return {
    candidate_index: at,
    format: "ranking",
    theme: best.name,
    title_idea: `Every ${best.name} Game Ranked Worst to Best`.slice(0, 60),
    criterion: "How each game plays today, what it changed and whether it still holds up.",
    reason: `Swapped from "${topic.theme}": that topic failed in the last two days.`,
  };
}

export async function maybeSelectLongform(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  const quiet = (reason: string, extra?: Record<string, unknown>) => {
    quietLog("long ranking", reason, extra, s.now().getTime());
    return undefined;
  };
  if (!cfg.longformEnabled) return quiet("LONGFORM_ENABLED is off");
  const now = s.now();
  if (cfg.longformSkip.includes(dayKey(now, cfg.timezone)))
    return quiet("today is in LONGFORM_SKIP", {
      day: dayKey(now, cfg.timezone),
    });
  const plan = {
    days: cfg.longformDays,
    slot: cfg.longformSlot,
    // Fifteen to twenty minutes of footage takes four hours or more to gather, voice and render; the day
    // before, so the owner's recordings can join and the render can wait for a gap between Shorts.
    leadMinutes: Math.max(cfg.slotLeadMinutes + 420, cfg.longLeadMinutes),
    graceMinutes: cfg.slotGraceMinutes,
    timeZone: cfg.timezone,
  };
  const taken = await takenSlots(db);
  const due = evergreenDue(now, plan, taken);
  if (!due) {
    const why = evergreenWhyNot(now, plan, taken);
    return quiet(why.reason, {
      days: cfg.longformDays.join(","),
      slot: why.slot?.toISOString(),
      opensAt: why.opensAt?.toISOString(),
      heldBy: /taken/.test(why.reason)
        ? await slotHolder(db, why.slot)
        : undefined,
    });
  }
  // GTA_GUIDES (src/gtaguide.ts): a share of the long slots goes to a post-launch GTA 6 guide list, decided per slot.
  // Off (the default), gtaGuideSlot is false and nothing here runs. No guide topic left: the ranking takes the slot.
  if (gtaGuideSlot(cfg, due)) {
    const id = await selectGtaGuide(s, due).catch((err) => {
      log("warn", "gta guide: selection failed, the ranking takes the slot", { error: errorMessage(err) });
      return undefined;
    });
    if (id) return id;
  }
  const covered = (
    await db.query<{ headline: string }>(
      `SELECT story_json->>'headline' AS headline FROM episodes WHERE lane IN ('evergreen','longform') AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '180 days' AND factcheck_json->'gta_guide' IS NULL`,
      [now],
    )
  ).map((r) => r.headline);
  // Ranked by recent YouTube demand, topics with none skipped (src/discovery/searchdemand.ts).
  const base = await s.discoverEvergreen();
  const ranked = await demandRanked(s, base);
  const { demand, skipped } = ranked;
  // Never emptied by the demand check alone: with every topic dropped, the whole pool stays on the list.
  const pool = longShortlist(ranked.candidates, base);
  if (pool.demandIgnored)
    log("info", "long ranking: every topic showed no demand, so the demand check is set aside for this pick", {
      topics: base.length,
    });
  // The long version of a ranking Short that did well (SEQUEL_WINNERS, src/sequels.ts): already proven on our own
  // channel, so it joins the list whatever the demand check says, and its Short does not count as covering it.
  const sequels = s.cfg.sequelWinners ? await longSequels(s, now) : undefined;
  // A topic whose long ranking failed in the last two days (fact-check, QA) is left out of this pick: chosen again,
  // the same day's duplicate check refuses it and the slot stays empty (Half-Life and Portal, 20 Nov).
  const failedThemes = (
    await db.query<{ theme: string | null }>(
      `SELECT story_json->>'gameHint' AS theme FROM episodes WHERE lane = 'longform' AND status IN ('failed','rejected') AND created_at > $1::timestamptz - interval '2 days' AND factcheck_json->'gta_guide' IS NULL`,
      [now],
    )
  )
    .map((r) => r.theme ?? "")
    .filter(Boolean);
  if (failedThemes.length) log("info", "long ranking: recently failed topics left out", { themes: failedThemes });
  const shortlist = dropFailedThemes(
    [
      ...(sequels?.candidates ?? []),
      ...pool.list.filter(
        (c) => !sequels?.candidates.some((x) => x.name === c.name),
      ),
    ],
    failedThemes,
  );
  if (!shortlist.length)
    return quiet("no topic candidates: the evergreen topic pool is empty", {
      slot: due.toISOString(),
    });
  const notCovered = covered.filter((h) => !sequels?.headlines.includes(h));
  const demandText = [await topicDemand(s, "long"), sequels?.block ?? ""]
    .filter(Boolean)
    .join("\n\n");
  // The viewer poll's winner joins the shortlist (LONG_POLL_CANDIDATE), and a refusal that leans on the poll is asked
  // again without it, then falls back to the top of the shortlist (LONG_POLL_FALLBACK), src/editorial/longrescue.ts.
  const poll = await readPoll(db).catch(() => undefined);
  const pollWinner = pollWinnerOf(poll, now);
  const winnerFailed = !!pollWinner && dropFailedThemes([{ name: pollWinner.name }], failedThemes).length === 0;
  if (winnerFailed) log("info", "long ranking: the poll winner failed recently, so it is not pushed this pick", { winner: pollWinner!.name });
  const chosen = await chooseLongformTopic({
    select: (c, d) => selectLongformTopic(s.llm, c, notCovered, d),
    candidates: shortlist,
    // The poll block is part of the demand notes too (topicDemand): with the winner held back it comes out of both,
    // or the picker is told to pick a topic it may not have and refuses the week (code review, 20 Nov).
    demand: winnerFailed ? demandText.replace(pollBlock(poll, s.now()), "").trim() : demandText,
    // A poll winner whose ranking failed in the last two days is not pushed again (it failed four times on 20 Nov).
    pollLine: winnerFailed ? "" : pollBlock(poll, now),
    winner: winnerFailed ? undefined : pollWinner,
    covered: notCovered,
    addWinner: cfg.longPollCandidate,
    fallback: cfg.longPollFallback,
  });
  const candidates = chosen.candidates;
  const swapped = chosen.how === "none" ? chosen.topic : avoidFailedTheme(chosen.topic, candidates, failedThemes, notCovered);
  if (!swapped) return quiet("the picked topic failed recently and no other topic is left", { theme: chosen.topic.theme });
  if (swapped !== chosen.topic)
    log("info", "long ranking: picked topic failed recently, swapped", { from: chosen.topic.theme, to: swapped.theme });
  const topic = swapped;
  if (chosen.how === "none") {
    log("info", "no long-form topic today", { reason: topic.reason });
    // Kept as an event so the output audit (src/outputaudit.ts) can say why a long slot went empty.
    await logEvent(db, null, "long_topic_skipped", {
      reason: topic.reason,
      // The picker runs every tick while the slot is due: the audit counts slots, not ticks.
      slot_at: due.toISOString(),
      pollWinnerAdded: chosen.added,
    }).catch(() => undefined);
    return undefined;
  }
  if (chosen.how !== "picked" || chosen.added)
    await logEvent(db, null, "long_topic_rescue", {
      how: chosen.how,
      pollWinnerAdded: chosen.added,
      theme: topic.theme,
      refusal: chosen.refusal ?? null,
    }).catch(() => undefined);
  const cluster: StoryCluster = {
    hash: `longform:${dayKey(now, cfg.timezone)}:${topic.theme.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    headline: topic.title_idea,
    items: [],
    sources: ["Steam"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: topic.theme,
  };
  const id = shortId();
  const created = await createEpisode(db, id, cluster, {
    lane: "longform",
    priority: LANE_PRIORITY.longform,
    slotAt: due,
  });
  if (!created)
    return quiet("an episode with the same topic and day already exists", {
      hash: cluster.hash,
    });
  await db.query(
    `UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`,
    [id, JSON.stringify({ topic })],
  );
  await logEvent(db, id, "selected", {
    headline: topic.title_idea,
    lane: "longform",
    theme: topic.theme,
    criterion: topic.criterion,
    reason: topic.reason,
    demand: demand.get(candidates[topic.candidate_index]!.name) ?? null,
    demand_skipped: skipped.map((c) => c.name),
    slot_at: due.toISOString(),
  });
  await reportDemand(
    s,
    "long ranking",
    topic.theme,
    demand.get(candidates[topic.candidate_index]!.name),
    skipped.length,
  );
  log("info", "long-form topic selected", { id, theme: topic.theme });
  // GTA_GUIDES' other arm: the rankings made while it is on, for the verdict (gtaGuideVerdict).
  if (cfg.gtaGuides) await logEvent(db, id, "gta_guide", { arm: "ranking", slot_at: due.toISOString() }).catch(() => undefined);
  quietReset("long ranking");
  return id;
}

/**
 * GTA_GUIDES: the guide for a long slot (src/gtaguide.ts): the kind with the most demand, viewer questions and comments
 * that was not made in the last 30 days (nor failed in the last two), as a longform episode whose factcheck carries it.
 * Undefined when no kind is left, so the ranking takes the slot.
 */
async function guideDemandReading(s: Services, now: Date): Promise<Map<string, number>> {
  const [row] = await s.db
    .query<{ value: string }>(`SELECT value FROM settings WHERE key = 'gta_guide_demand'`)
    .catch(() => [] as Array<{ value: string }>);
  try {
    const kept = row ? (JSON.parse(row.value) as { at: string; demand: Record<string, number> }) : undefined;
    // A reading that found something is kept a week; an empty one (every search failed or found nothing) six hours.
    const keep = kept && Object.keys(kept.demand).length ? GUIDE_DEMAND_DAYS * 86_400_000 : 6 * 3_600_000;
    if (kept && now.getTime() - Date.parse(kept.at) < keep) return new Map(Object.entries(kept.demand));
  } catch {
    // An unreadable reading is measured again.
  }
  if (!s.cfg.demandCheck || !s.searchDemandMany) return new Map();
  const rows = await s.searchDemandMany(GUIDE_QUERIES).catch(() => undefined);
  if (!rows) return new Map();
  const demand = guideDemand(rows);
  await s.db
    .query(
      `INSERT INTO settings (key, value) VALUES ('gta_guide_demand', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ at: now.toISOString(), demand: Object.fromEntries(demand) })],
    )
    .catch(() => undefined);
  return demand;
}

async function selectGtaGuide(s: Services, due: Date): Promise<string | undefined> {
  const { db, cfg } = s;
  const now = s.now();
  // A guide that already failed for this slot hands it to the ranking: never a second guide's spend on the same slot.
  const failedHere = await db.query(
    `SELECT 1 FROM episodes WHERE lane = 'longform' AND slot_at = $1 AND status IN ('failed','rejected') AND factcheck_json->'gta_guide' IS NOT NULL LIMIT 1`,
    [due],
  );
  if (failedHere.length) {
    quietLog("gta guide", "a guide already failed for this slot, so the ranking takes it", { slot: due.toISOString() }, now.getTime());
    return undefined;
  }
  const made = await db.query<{ kind: string | null; at: string; status: string }>(
    `SELECT factcheck_json->'gta_guide'->>'kind' AS kind, created_at AS at, status FROM episodes
      WHERE lane = 'longform' AND factcheck_json->'gta_guide'->>'kind' IS NOT NULL
        AND created_at > $1::timestamptz - interval '30 days'
        AND (status NOT IN ('failed','rejected') OR created_at > $1::timestamptz - interval '2 days'
             OR (COALESCE(last_error, '') LIKE '%too thin for this kind%' AND created_at > $1::timestamptz - interval '7 days'))`,
    [now],
  );
  // The demand lookups (the Data API): one search a kind, the reading kept a week in settings so a slot never pays
  // for it twice; trouble means no reading, and the stream asks decide alone.
  const asks = await loadGuideAsks(cfg.dataDir).catch(() => []);
  const madeKinds = made.filter((r) => r.kind).map((r) => ({ kind: r.kind!, at: r.at }));
  // No kind free: nothing is searched.
  const free = pickGuideTopic({ now, made: madeKinds, demand: new Map(), asks });
  const demand = free ? await guideDemandReading(s, now) : new Map<string, number>();
  const pick = pickGuideTopic({
    now,
    made: made.filter((r) => r.kind).map((r) => ({ kind: r.kind!, at: r.at })),
    demand,
    asks,
  });
  if (!pick) {
    quietLog("gta guide", "every guide kind was made in the last 30 days", { slot: due.toISOString() }, now.getTime());
    return undefined;
  }
  const topic: GtaGuideTopic = {
    kind: pick.kind.key,
    why: pick.why,
    asks: pick.asks,
    demandViews: pick.demandViews,
    slot_at: due.toISOString(),
  };
  const cluster: StoryCluster = {
    hash: `gtaguide:${dayKey(now, cfg.timezone)}:${pick.kind.key}`,
    headline: `${GTA_GAME}: ${pick.kind.name}`,
    items: [],
    sources: ["Rockstar Games"],
    hasOfficial: true,
    corroborated: true,
    rumourSignals: false,
    newestAt: now.toISOString(),
    score: 0,
    gameHint: GTA_GAME,
  };
  const id = shortId();
  if (!(await createEpisode(db, id, cluster, { lane: "longform", priority: LANE_PRIORITY.longform, slotAt: due }))) return undefined;
  await db.query(`UPDATE episodes SET script_json = NULL, factcheck_json = $2 WHERE id = $1`, [id, JSON.stringify({ gta_guide: topic })]);
  await logEvent(db, id, "selected", { headline: cluster.headline, lane: "longform", theme: GTA_GAME, reason: pick.why.join("; "), slot_at: due.toISOString() });
  // The record the verdict reads (gtaGuideVerdict, src/gtaguide.ts). Pass mark: with 6 published videos per arm, the
  // guides' median 7-day views AND median thumbnail CTR (from Test & compare) beat the long rankings' medians over the
  // same weeks; under that the share goes back to 0, and a clear win raises GTA_GUIDE_SHARE.
  await logEvent(db, id, "gta_guide", {
    arm: "guide",
    kind: pick.kind.key,
    score: Math.round(pick.score * 10) / 10,
    why: pick.why,
    asks: pick.asks.length,
    demand_views: pick.demandViews,
    slot_at: due.toISOString(),
  });
  log("info", "gta guide selected", { id, kind: pick.kind.key });
  quietReset("gta guide");
  return id;
}

// ------------------------------------------------------------------ cutdowns

/**
 * One Short a day cut from a recent long ranking (published at least a day
 * ago, still public): the last place first, then number two, then number one.
 */
export async function maybeSelectCutdown(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.cutdownsEnabled || cfg.cutdownsPerLong <= 0) return undefined;
  const now = s.now();
  const due = evergreenDue(
    now,
    {
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      slot: cfg.cutdownSlot,
      leadMinutes: cfg.slotLeadMinutes,
      graceMinutes: cfg.slotGraceMinutes,
      timeZone: cfg.timezone,
    },
    await takenSlots(db),
  );
  if (!due) return undefined;
  const parents = await db.query<Episode>(
    `SELECT e.* FROM episodes e
      WHERE e.lane = 'longform' AND e.status = 'published' AND e.youtube_video_id IS NOT NULL
        AND COALESCE(e.script_json->>'evergreen_format', '') <> 'documentary'
        AND e.script_json->'gta_guide' IS NULL
        AND COALESCE(e.publish_at, e.updated_at) < $1::timestamptz - interval '20 hours'
        AND COALESCE(e.publish_at, e.updated_at) > $1::timestamptz - interval '21 days'
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('made_private','crosspost_skip') AND COALESCE(v.detail->>'reason','') IN ('not public on YouTube',''))
      ORDER BY COALESCE(e.publish_at, e.updated_at) DESC`,
    [now],
  );
  for (const parent of parents) {
    const entries = parent.script_json?.entries ?? [];
    if (!entries.length) continue;
    if (
      !(await fs
        .stat(path.join(episodeDir(cfg, parent.id), "short.mp4"))
        .catch(() => undefined))
    )
      continue;
    const done = new Set(
      (
        await db.query<{ rank: string }>(
          `SELECT story_json->'cutdown'->>'rank' AS rank FROM episodes WHERE lane = 'cutdown' AND story_json->'cutdown'->>'parent' = $1`,
          [parent.id],
        )
      ).map((r) => Number(r.rank)),
    );
    const rank = cutdownRanks(
      entries.map((e) => e.rank),
      cfg.cutdownsPerLong,
    ).find((r) => !done.has(r));
    if (rank === undefined) continue;
    const entry = entries.find((e) => e.rank === rank)!;
    const cluster: StoryCluster = {
      hash: `cutdown:${parent.id}:${rank}`,
      headline: `${entry.game_title}: number ${rank} of ${entries.length}`,
      items: [],
      sources: ["Pulse Gaming"],
      hasOfficial: true,
      corroborated: true,
      rumourSignals: false,
      newestAt: now.toISOString(),
      score: 0,
      gameHint: entry.game_title,
      cutdown: { parent: parent.id, rank },
    };
    const id = shortId();
    if (
      !(await createEpisode(db, id, cluster, {
        lane: "cutdown",
        priority: LANE_PRIORITY.cutdown,
        slotAt: due,
      }))
    )
      continue;
    await logEvent(db, id, "selected", {
      lane: "cutdown",
      parent: parent.id,
      rank,
      slot_at: due.toISOString(),
    });
    log("info", "cutdown selected", { id, parent: parent.id, rank });
    return id;
  }
  return undefined;
}

/**
 * The funnel test (src/funnel.ts): one Short a day in the cutdown slot, cut from a weekly guide's chapter while the
 * guide is under FUNNEL_DAYS old, FUNNEL_SHORTS a guide. Its arm is fixed by its id and recorded.
 */
export async function maybeSelectFunnelCut(s: Services): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!cfg.funnelTest || cfg.funnelShorts <= 0) return undefined;
  const now = s.now();
  const due = evergreenDue(
    now,
    {
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      slot: cfg.cutdownSlot,
      leadMinutes: cfg.slotLeadMinutes,
      graceMinutes: cfg.slotGraceMinutes,
      timeZone: cfg.timezone,
    },
    await takenSlots(db),
  );
  if (!due) return undefined;
  const parents = await db.query<Episode>(
    `SELECT e.* FROM episodes e
      WHERE e.lane = 'longform' AND e.status = 'published' AND e.youtube_video_id IS NOT NULL
        AND ($4::boolean OR e.factcheck_json->'topic'->'guide'->>'key' IS NOT NULL)
        AND COALESCE(e.script_json->>'runtime', '') = 'long'
        AND COALESCE(e.publish_at, e.updated_at) < $1::timestamptz
        AND COALESCE(e.publish_at, e.updated_at) > $2::timestamptz - make_interval(days => $3)
      ORDER BY COALESCE(e.publish_at, e.updated_at) DESC`,
    [now, due, cfg.funnelDays, cfg.funnelAllLongs],
  );
  for (const parent of parents) {
    if (!parent.script_json?.beats?.length) continue;
    // FUNNEL_ALL_LONGS: every long strand with chapters; a ranking keeps its own cutdowns.
    if (!funnelParent(parent.script_json, isWeeklyGuide(parent.factcheck_json), cfg.funnelAllLongs)) continue;
    if (!(await fs.stat(path.join(episodeDir(cfg, parent.id), "short.mp4")).catch(() => undefined))) continue;
    const done = (
      await db.query<{ beat: string }>(
        `SELECT story_json->'cutdown'->>'beat' AS beat FROM episodes WHERE lane = 'cutdown' AND story_json->'cutdown'->>'parent' = $1`,
        [parent.id],
      )
    ).map((r) => Number(r.beat));
    const [beat] = funnelPicks(parent.script_json, cfg.funnelShorts, done);
    if (beat === undefined) continue;
    const rank = chapterBeats(parent.script_json).indexOf(beat) + 1;
    const id = shortId();
    const arm = funnelArm(unitHash(`funnel:${id}`), cfg.funnelShare);
    const chapter = String(parent.script_json.beats[beat]?.visual?.primary ?? "");
    const cluster: StoryCluster = {
      hash: `cutdown:${parent.id}:beat${beat}`,
      headline: `${parent.script_json.game_title}: ${chapter || `chapter ${rank}`}`,
      items: [],
      sources: ["Pulse Gaming"],
      hasOfficial: true,
      corroborated: true,
      rumourSignals: false,
      newestAt: now.toISOString(),
      score: 0,
      gameHint: parent.script_json.game_title,
      cutdown: { parent: parent.id, rank, beat, funnel: arm },
    };
    if (!(await createEpisode(db, id, cluster, { lane: "cutdown", priority: LANE_PRIORITY.cutdown, slotAt: due })))
      continue;
    await logEvent(db, id, "selected", { lane: "cutdown", parent: parent.id, beat, slot_at: due.toISOString() });
    await logEvent(db, id, "funnel_arm", { arm, parent: parent.id, parent_video: parent.youtube_video_id, beat });
    log("info", "funnel cut selected", { id, parent: parent.id, beat, arm });
    return id;
  }
  return undefined;
}

/** Cuts the entry's section from the long video (with a blurred fill for the background) and writes its packaging. */
async function stepScriptCutdown(s: Services, ep: Episode): Promise<void> {
  const ref = ep.story_json.cutdown;
  if (!ref) throw new FatalError("cutdown episode has no parent");
  const parent = await getEpisode(s.db, ref.parent);
  const pScript = parent?.script_json;
  if (!parent?.youtube_video_id || !pScript?.entries?.length)
    throw new FatalError("the long video for this cutdown is gone");
  // A funnel cut (src/funnel.ts) names its chapter's first beat; a ranking's cutdown names its rank.
  const funnelCut = ref.beat !== undefined;
  const beatIndex = funnelCut ? ref.beat! : pScript.entries.findIndex((e) => e.rank === ref.rank);
  if (beatIndex < 0)
    throw new FatalError(`the long video has no number ${ref.rank}`);
  const pAssets = parent.assets_json ?? {};
  const words = pAssets.words ?? [];
  const duration = (pAssets.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
  const segments = buildSegments(segmentInputs(pScript), words, duration);
  const win = funnelCut
    ? funnelWindow(segments, chapterBeats(pScript), beatIndex, words)
    : cutdownWindow(segments, beatIndex, words);
  if (!win) throw new FatalError("the entry does not fit in a Short");
  // A funnel cut keeps 5 seconds after its last word: the end card, and in the link arm the spoken link line.
  const tailSeconds = funnelCut ? FUNNEL_TAIL_SECONDS : CUTDOWN_TAIL_SECONDS;
  const source = path.join(episodeDir(s.cfg, parent.id), "short.mp4");
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
  const len = win.end - win.start;
  const total = len + tailSeconds;
  const run = promisify(execFile);
  // The picture runs on under the end card; the narration fades out where the entry ends.
  // The section ends on its own last frame, held under the end card: running on would show the next entry (and give it away).
  const hold = (tailSeconds + 0.1).toFixed(2);
  const vLen = Math.min(len, win.videoEnd - win.start);
  const vHold = (total - vLen + 0.1).toFixed(2);
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      win.start.toFixed(3),
      "-t",
      vLen.toFixed(3),
      "-i",
      source,
      "-ss",
      win.start.toFixed(3),
      "-t",
      len.toFixed(3),
      "-i",
      source,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-vf",
      `tpad=stop_mode=clone:stop_duration=${vHold}`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-af",
      `afade=t=out:st=${Math.max(0, len - 0.12).toFixed(3)}:d=0.12,apad=pad_dur=${hold}`,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-t",
      total.toFixed(3),
      path.join(dir, "cut.mp4"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      win.start.toFixed(3),
      "-t",
      vLen.toFixed(3),
      "-i",
      source,
      "-an",
      "-vf",
      `scale=-2:1920,crop=1080:1920,boxblur=28:3,eq=brightness=-0.10:saturation=1.15,fps=30,tpad=stop_mode=clone:stop_duration=${vHold}`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-pix_fmt",
      "yuv420p",
      path.join(dir, "bg.mp4"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const narration = pScript.beats[beatIndex]?.narration ?? "";
  const arm = ref.funnel ?? "none";
  // FUNNEL_ALL_LONGS: a documentary's cut says "the full documentary", a guide's "the full guide".
  const kindOfParent = funnelKind(pScript, isWeeklyGuide(parent.factcheck_json));
  // The link arm says the link over the end card, in the long video's own voice (src/funnel.ts).
  if (funnelCut && arm === "link") {
    const lineFile = path.join(dir, "link_line.mp3");
    const voice = pAssets.voice ? { id: pAssets.voice.id, name: pAssets.voice.name } : undefined;
    await s.synthesise(funnelLine(kindOfParent), lineFile, voice);
    await mixFunnelLine(FFMPEG, path.join(dir, "cut.mp4"), lineFile, len + 0.4);
  }
  const copy = funnelCut
    ? await writeFunnelCopy(s.llm, {
        game: pScript.game_title,
        guideTitle: pScript.youtube.title,
        chapterTitle: String(pScript.beats[beatIndex]?.visual?.primary ?? ""),
        narration,
        kind: kindOfParent,
      })
    : await writeCutdownCopy(
    s.llm,
    pScript,
    pScript.entries[beatIndex]!,
    narration,
    pScript.entries.length,
  );
  const script = funnelCut
    ? funnelScript(pScript, beatIndex, copy, parent.youtube_video_id, arm, kindOfParent)
    : cutdownScript(pScript, beatIndex, copy, parent.youtube_video_id);
  script.cutdown!.theme = pScript.game_title;
  // The footage credits travel with the clips seen in this section.
  const plan = pAssets.longPlan;
  const fps = plan?.fps ?? 30;
  const seen = new Set(
    (plan?.shots ?? [])
      .filter(
        (sh) =>
          sh.media.type === "clip" &&
          sh.end / fps > win.start &&
          sh.start / fps < win.end,
      )
      .map((sh) => sh.media.index),
  );
  const clips = (pAssets.clips ?? [])
    .filter((_, i) => seen.has(i))
    .map((c) => ({ ...c, file: "" }));
  await guardScript(s, ep, script, "after writing");
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    assets_json: {
      words: wordsIn(words, win),
      durationSeconds: total,
      clips,
      officialTrailer: pAssets.officialTrailer,
      cutdown: {
        start: win.start,
        end: win.end,
        video: "cut.mp4",
        background: "bg.mp4",
      },
    },
  });
  await logEvent(s.db, ep.id, "cutdown_cut", {
    parent: parent.id,
    rank: ref.rank,
    start: win.start,
    end: win.end,
    title: copy.youtube_title,
  });
}

/**
 * GTA 6 Day N's HUD graphics (HUD_PIN, HUD_TICKER, HUD_END_MAP; src/hudreader/dayn.ts): the pin, the wanted ticker and
 * the every-spot map, from the source clip's own HUD. Off, unsure or failed: undefined, and the Short renders as before.
 */
async function gameplayHud(
  s: Services,
  ep: Episode,
  dir: string,
  duration: number,
  timing: { hookEnd: number; payoffAt: number },
) {
  const h = s.cfg.hud;
  const story = ep.story_json.gtaDaily;
  const ref = ep.story_json.gameplay;
  const segments = ep.script_json?.gameplay?.direct?.segments;
  if (!h.enabled || !(h.pin || h.ticker || h.endMap) || !story || !ref || !segments?.length) return undefined;
  const game = profileFor(ref.review.game_title) ?? "gta6";
  const meta = await readMeta(gameplayDir(s.cfg, ref.id));
  if (!meta) return undefined;
  const r = await dayNOverlay({
    hud: h,
    dataDir: s.cfg.dataDir,
    episodeDir: dir,
    episode: ep.id,
    day: story.day,
    game,
    clipFile: path.join(gameplayDir(s.cfg, ref.id), meta.clip.file || "clip.mp4"),
    segments,
    durationSeconds: duration,
    hookEnd: timing.hookEnd,
    payoffAt: timing.payoffAt,
    accent: "#FF6B1A",
    liveEpisodes: async (ids) =>
      new Set(
        (
          await s.db.query<{ id: string }>(
            `SELECT id FROM episodes WHERE id = ANY($1) AND status NOT IN ('rejected','failed')`,
            [ids],
          )
        ).map((x) => x.id),
      ),
    now: s.now(),
  });
  await logEvent(s.db, ep.id, "hud_overlay", {
    drawn: r.props ? Object.keys(r.props).filter((k) => k !== "accent") : [],
    why: r.why,
    pin: r.pin,
    findings: r.findings.slice(0, 20),
  });
  return r.props;
}

/** The rebuilt gameplay Short's render: its faults stop it here, before the owner is asked. */
async function stepRenderGameplayDirect(s: Services, ep: Episode): Promise<void> {
  if (!s.renderGameplayShort) throw new Error("this build cannot render gameplay Shorts");
  const dir = episodeDir(s.cfg, ep.id);
  const script = ep.script_json!;
  const assets = ep.assets_json ?? {};
  const g = script.gameplay!;
  const timing = assets.gameplayShort!;
  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  const duration = assets.durationSeconds ?? 20;
  const hud = await gameplayHud(s, ep, dir, duration, timing);
  await s.renderGameplayShort({
    episodeDir: dir,
    props: {
      videoFile: assets.cutdown?.video ?? "cut.mp4",
      voiceFile: "voice.mp3",
      words: assets.words ?? [],
      durationSeconds: duration,
      hook: g.direct!.hook,
      hookEnd: timing.hookEnd,
      resultLine: g.result_line,
      payoffAt: timing.payoffAt,
      voiced: timing.voiced,
      accent: "#FF6B1A",
      ...(hud ? { hud } : {}),
      // CHALLENGE_SERIES: the episode, the rule and the measured running count (src/challenge.ts).
      ...(s.cfg.challenge.enabled && ep.story_json.challenge
        ? { challenge: challengeCounter(ep.story_json.challenge, timing.hookEnd, duration) }
        : {}),
    },
    outFile: raw,
    posterFile: path.join(dir, "poster.jpg"),
    concurrency: s.cfg.remotionConcurrency,
    gl: s.cfg.remotionGl,
    browserExecutable: s.cfg.browserExecutable,
  });
  await s.normalise(raw, final);
  await fs.rm(raw, { force: true });
  const tech = await s.technicalQa(final, duration, {
    minSeconds: 8,
    maxSeconds: 59.5,
  });
  const problems = [
    ...tech.problems,
    ...directProblems({
      blacks: await blackSpans(final),
      firstWordAt: assets.words?.[0]?.start,
      payoffAt: timing.payoffAt,
      seconds: duration,
      answerAt: timing.answerAt,
      loopLine: g.direct!.loop_line,
    }),
  ];
  const qa = {
    technical: { ...tech, ok: problems.length === 0, problems },
    vision: null,
    checked_at: s.now().toISOString(),
  };
  if (problems.length) {
    await s.db.query(`UPDATE episodes SET qa_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(qa),
    ]);
    throw new Error(`QA failed: ${problems.join(" | ")}`);
  }
  await transition(s.db, ep.id, "voiced", "rendered", {
    assets_json: { ...assets, video: "short.mp4", poster: "poster.jpg" },
    qa_json: qa,
  });
  await gameplayStatus(s.cfg, ep, "rendered");
}

async function stepRenderCutdown(s: Services, ep: Episode): Promise<void> {
  if (ep.script_json?.gameplay?.direct) return stepRenderGameplayDirect(s, ep);
  if (!s.renderCutdown) throw new Error("this build cannot render cutdowns");
  const dir = episodeDir(s.cfg, ep.id);
  const script = ep.script_json!;
  const assets = ep.assets_json ?? {};
  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  const duration = assets.durationSeconds ?? 30;
  // A gameplay Short asks its question from the first frame and answers it on the end card.
  const g = script.gameplay;
  await s.renderCutdown({
    episodeDir: dir,
    props: {
      videoFile: assets.cutdown?.video ?? "cut.mp4",
      backgroundFile: assets.cutdown?.background ?? null,
      words: assets.words ?? [],
      durationSeconds: duration,
      title: script.headline.toUpperCase(),
      kicker: g
        ? g.experiment_number
          ? `TEST #${g.experiment_number}`
          : "WE TESTED IT"
        : script.cutdown?.funnel
          ? `${script.cutdown.kind && script.cutdown.kind !== "guide" ? "CHAPTER" : "GUIDE"} ${script.cutdown.rank} OF ${script.cutdown.total}`
        : `#${script.cutdown?.rank ?? ""} OF ${script.cutdown?.total ?? ""}`,
      // A funnel cut (src/funnel.ts): the link card for its last 5 seconds in the link arm, the chapter's name in the control.
      cta: g
        ? g.result_line.toUpperCase()
        : script.cutdown?.funnel === "link"
          ? funnelCta(script.cutdown.kind)
          : script.cutdown?.funnel
            ? (script.pulse_take.on_screen || script.headline).toUpperCase()
            : "FULL RANKING ON THE CHANNEL",
      ...(script.cutdown?.funnel ? { ctaSeconds: FUNNEL_TAIL_SECONDS } : {}),
      accent: "#FF6B1A",
      emphasis: g ? [] : emphasisWords(script),
      // Gameplay is the point: a band a quarter taller than the full 16:9 (cropped a little at the sides), still clear of the Shorts buttons.
      ...(g ? { videoHeight: 760 } : {}),
    },
    outFile: raw,
    posterFile: path.join(dir, "poster.jpg"),
    concurrency: s.cfg.remotionConcurrency,
    gl: s.cfg.remotionGl,
    browserExecutable: s.cfg.browserExecutable,
  });
  await s.normalise(raw, final);
  await fs.rm(raw, { force: true });
  const tech = await s.technicalQa(final, duration, {
    minSeconds: 8,
    maxSeconds: 59.5,
  });
  const qa = {
    technical: tech,
    vision: null,
    checked_at: s.now().toISOString(),
  };
  if (!tech.ok) {
    await s.db.query(`UPDATE episodes SET qa_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(qa),
    ]);
    throw new Error(`QA failed: ${tech.problems.join(" | ")}`);
  }
  await transition(s.db, ep.id, "voiced", "rendered", {
    assets_json: { ...assets, video: "short.mp4", poster: "poster.jpg" },
    qa_json: qa,
  });
  if (ep.lane === "gameplay") await gameplayStatus(s.cfg, ep, "rendered");
}

// ------------------------------------------------------------------ gameplay lane

async function gameplayExperiments(cfg: Config) {
  const md = await fs.readFile(cfg.gameplayExperiments, "utf8").catch(() => "");
  const listed = parseExperiments(md);
  // STREAM_ASKS: what people want tested right now, after the hand-made list (src/streamasks).
  if (!cfg.streamAsks.enabled) return listed;
  const next = listed.reduce((n, e) => Math.max(n, e.number), 0) + 1;
  return [...listed, ...(await askExperiments(cfg.dataDir, next))];
}

/** The full verdict a clip got in the last day, when its file write never landed. */
async function priorGameplayReview(
  db: Db,
  id: string,
): Promise<GameplayReview | undefined> {
  const [row] = await db.query<{ review: unknown }>(
    `SELECT detail->'review' AS review FROM events
      WHERE kind = 'gameplay_reviewed' AND detail->>'id' = $1 AND detail->'review' IS NOT NULL
        AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 1`,
    [id],
  );
  const parsed = GameplayReviewSchema.safeParse(row?.review);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Hears and looks at new inbox clips (a few a tick, a daily cap on vision calls) and makes an episode
 * from each one worth posting. One gameplay Short is in production at a time, so a long stream's dozen
 * clips never crowd the news renders; the rest wait in the inbox as "new".
 */
export async function ingestGameplay(
  s: Services,
  perTick = 3,
): Promise<string[]> {
  const { db, cfg } = s;
  if (!cfg.gameplayEnabled || !cfg.gameplayRoot) return [];
  const [busy] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE lane = 'gameplay' AND status IN ('selected','scripted','voiced','rendered')`,
  );
  if (Number(busy?.n ?? 0) > 0) return [];
  const [reviewed] = await db.query<{ n: string | number }>(
    // The database's own clock, as the rows are stamped with it.
    `SELECT count(*) AS n FROM events WHERE kind = 'gameplay_reviewed' AND created_at > now() - interval '24 hours'`,
  );
  let left = Math.min(
    perTick,
    cfg.gameplayReviewsPerDay - Number(reviewed?.n ?? 0),
  );
  if (left <= 0) return [];
  const experiments = await gameplayExperiments(cfg);
  const made: string[] = [];
  const clips = await newClips(cfg.gameplayRoot);
  // GTA_DAILY: a clip that answers a stream ask is looked at first, so the day's episode answers what people asked.
  for (const { dir, meta } of gtaDailyFrom(cfg) ? askFirst(clips) : clips) {
    if (left-- <= 0) break;
    try {
      await writeMeta(dir, { status: "reviewing" });
      // A verdict whose file write failed (a locked folder) is not paid for or lost: the event holds it, and an
      // episode already made from it is the same episode (4 Nov 2026: clips reviewed up to five times over).
      const prior = await priorGameplayReview(db, meta.id);
      let review: GameplayReview;
      if (prior) review = prior;
      else {
        const clip = path.join(dir, meta.clip.file || "clip.mp4");
        // HUD_FACTS: the clip's HUD measured first, so the reviewer can use a measured figure.
        const hud = await clipFacts(cfg.hud, cfg.dataDir, { file: clip, title: `${meta.source.title} ${meta.review?.game ?? ""}`, work: dir }).catch(() => undefined);
        if (hud) {
          meta.hud = hud;
          await writeMeta(dir, { hud });
        }
        const words = (await s.hearClip?.(clip).catch(() => [])) ?? [];
        await writeWhole(path.join(dir, "words.json"), JSON.stringify(words));
        review = await reviewClip(
          s.llm,
          dir,
          meta,
          words.map((w) => w.text).join(" "),
          experiments,
        );
        await logEvent(db, null, "gameplay_reviewed", {
          id: meta.id,
          keep: review.keep,
          score: review.score,
          reason: review.reason,
          review,
        });
      }
      let keep =
        worthPosting(review, minScoreFor(meta, cfg)) ||
        Boolean(meta.rehearsal && meta.rehearsal_force);
      // SPOILER_GUARD: during the game's spoiler window a clip that looks like a story cutscene from beyond the
      // opening waits until the window closes (src/sceneindex/spoilerclips.ts); gameplay moments go on.
      let spoilerHeld: string | undefined;
      if (keep && cfg.spoilerGuard) {
        const held = await streamClipSpoiler(cfg, dir, meta, review.game_title, review.spoiler, s.now());
        if (held?.hold) {
          keep = false;
          spoilerHeld = held.until;
          await logEvent(db, null, "gameplay_spoiler_held", { id: meta.id, reason: held.reason, until: held.until });
        }
      }
      const [made_before] = await db.query<{ id: string }>(
        `SELECT id FROM episodes WHERE story_hash = $1`,
        [`gameplay:${meta.id}`],
      );
      let episode: string | undefined = made_before?.id;
      if (keep && !episode) {
        const cluster: StoryCluster = {
          hash: `gameplay:${meta.id}`,
          headline: review.question,
          items: [],
          sources: ["Pulse Gaming"],
          hasOfficial: true,
          corroborated: true,
          rumourSignals: false,
          newestAt: s.now().toISOString(),
          score: review.score,
          gameHint: review.game_title,
          gameplay: {
            id: meta.id,
            dir,
            review,
            rehearsal: isRehearsal(
              meta,
              dayKey(s.now(), cfg.timezone),
              cfg.gameplayRehearsalUntil,
            ),
            ...(meta.source.kind === "twitch_live" ? { live: true } : {}),
          },
        };
        episode = shortId();
        if (
          await createEpisode(db, episode, cluster, {
            lane: "gameplay",
            priority: LANE_PRIORITY.gameplay,
          })
        ) {
          await logEvent(db, episode, "selected", {
            lane: "gameplay",
            clip: meta.id,
            score: review.score,
            question: review.question,
          });
          made.push(episode);
        } else episode = undefined;
      }
      await writeMeta(dir, {
        status: keep && episode ? "picked" : "rejected",
        review: {
          at: s.now().toISOString(),
          keep: Boolean(keep && episode),
          reason: spoilerHeld ? `held for spoilers until ${spoilerHeld.slice(0, 10)}: ${review.reason}` : review.reason,
          ...(spoilerHeld ? { spoiler_held_until: spoilerHeld } : {}),
          episode,
          radio: review.radio_audible,
          game: review.game_title,
        },
      });
      log("info", "gameplay clip reviewed", {
        id: meta.id,
        keep,
        score: review.score,
      });
      // One in production at a time: the next clip waits for this one to reach the owner.
      if (episode) break;
    } catch (err) {
      // A failed look is tried again later, never thrown away (a write that fails here leaves "reviewing", which
      // newClips also comes back to).
      await writeMeta(dir, { status: "new" }).catch(() => undefined);
      // The PC vision relay being down is said once per outage; the clip simply waits for it.
      if (!isVisionPaused(err))
        log("warn", "gameplay review failed", {
          id: meta.id,
          error: errorMessage(err),
        });
      break;
    }
  }
  return made;
}

/** Trims the clip to the reviewer's window, with a blurred 9:16 fill behind it; the game's own sound is kept. */
async function stepScriptGameplay(s: Services, ep: Episode): Promise<void> {
  const ref = ep.story_json.gameplay;
  if (!ref) throw new FatalError("gameplay episode has no clip");
  const clipDir = gameplayDir(s.cfg, ref.id);
  const meta = await readMeta(clipDir);
  if (!meta) throw new FatalError("the gameplay clip is gone from the inbox");
  const source = path.join(clipDir, meta.clip.file || "clip.mp4");
  const run = promisify(execFile);
  // Dead air out and the payoff in (cleanWindow): a failed look at the clip keeps the reviewer's window.
  const blacks = await run(
    FFMPEG,
    ["-hide_banner", "-nostats", "-i", source, "-vf", "blackdetect=d=0.2:pix_th=0.08", "-an", "-f", "null", "-"],
    { maxBuffer: 16 * 1024 * 1024 },
  )
    .then((r) => parseBlackSpans(r.stderr))
    .catch(() => []);
  const win = cleanWindow(
    gameplayWindow(ref.review, meta.clip.seconds),
    blacks,
    meta.clip.seconds,
  );
  // The rebuilt Short: a second look times the attempt and the outcome and writes the lines; the cut waits for the
  // voice, since the answer's real length decides how the ending runs.
  // With the PC vision relay down (and the paid fallback off) there is no second look: the reviewer's window is cut
  // the old way below, and the Short still waits for the owner's tap.
  const look = path.join(episodeDir(s.cfg, ep.id), "look");
  const direction = s.cfg.gameplayDirect
    ? await directClip(
        s.llm,
        await directFrames(source, meta.clip.seconds, look),
        ref.review,
        blacks,
        meta.source.credit ?? "",
      ).catch(whenVisionPaused(undefined))
    : undefined;
  if (s.cfg.gameplayDirect) await fs.rm(look, { recursive: true, force: true });
  if (direction) {
    direction.hook = cleanLine(direction.hook);
    direction.setup = cleanLine(direction.setup);
    direction.payoff_line = cleanLine(direction.payoff_line);
    direction.loop_line = cleanLine(direction.loop_line);
    // A loop that says the hook again sounds like a stutter on the replay: a lead-in takes its place.
    if (loopRepeatsHook(direction.loop_line, direction.hook) || loopDangles(direction.loop_line))
      direction.loop_line = loopLeadIn(ref.id);
    await logEvent(s.db, ep.id, "gameplay_direction", { clip: ref.id, direction });
    if (!direction.payoff_visible && !(meta.rehearsal && meta.rehearsal_force))
      throw new FatalError("no clean payoff: the clip stops before anything is answered");
    const cut = directCut(direction, blacks, meta.clip.seconds);
    const lines = fitLines(direction, cut.payoffAt);
    const script = gameplayScript(
      ref.review,
      ref.id,
      await gameplayExperiments(s.cfg),
      ref.live,
      meta.source.credit ?? "",
    );
    script.hook = lines.hook;
    script.beats = [
      {
        narration: lines.setup,
        visual: { kind: "none", primary: "", secondary: "" },
      },
    ];
    script.pulse_take.narration = direction.payoff_line.trim();
    script.loop_line = direction.loop_line.trim();
    script.gameplay!.direct = {
      hook: lines.hook,
      setup: lines.setup,
      payoff_line: direction.payoff_line.trim(),
      loop_line: direction.loop_line.trim(),
      segments: cut.segments,
      seconds: cut.seconds,
      payoff_at: cut.payoffAt,
      focus_start: direction.focus_start,
      focus_payoff: direction.focus_payoff,
    };
    // CHALLENGE_SERIES (src/challenge.ts): a tagged stream's clip is a challenge episode, and then never a Day N.
    // The owner's own series ("GTA 6 Day N", challenges) never take another streamer's play.
    if (!meta.source.credit && !(await applyChallenge(s, ep, script, meta))) await applyGtaDaily(s, ep, script, meta);
    await guardScript(s, ep, script, "after writing");
    await transition(s.db, ep.id, "selected", "scripted", {
      script_json: script,
      assets_json: { words: [], durationSeconds: cut.seconds, clips: [] },
    });
    await logEvent(s.db, ep.id, "gameplay_cut", {
      clip: ref.id,
      segments: cut.segments,
      payoff_at: cut.payoffAt,
      title: script.youtube.title,
    });
    return;
  }
  const len = win.end - win.start;
  // An HDR capture is tone-mapped so it does not look washed out.
  const tone = hdrFilter(
    await run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer", "-of", "csv=p=0", source])
      .then((r) => r.stdout.trim())
      .catch(() => ""),
  );
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      win.start.toFixed(3),
      "-t",
      len.toFixed(3),
      "-i",
      source,
      "-vf",
      `${tone}scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-af",
      `afade=t=in:d=0.08,afade=t=out:st=${Math.max(0, len - 0.25).toFixed(3)}:d=0.25`,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      path.join(dir, "cut.mp4"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      win.start.toFixed(3),
      "-t",
      len.toFixed(3),
      "-i",
      source,
      "-an",
      "-vf",
      `${tone}scale=-2:1920,crop=1080:1920,boxblur=28:3,eq=brightness=-0.10:saturation=1.15,fps=30`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-pix_fmt",
      "yuv420p",
      path.join(dir, "bg.mp4"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const heard = JSON.parse(
    await fs
      .readFile(path.join(clipDir, "words.json"), "utf8")
      .catch(() => "[]"),
  ) as Array<{ text: string; start: number; end: number }>;
  const inWindow = wordsInWindow(heard, win);
  const words = ref.review.captions_ok && captionable(inWindow) ? inWindow : [];
  const script = gameplayScript(
    ref.review,
    ref.id,
    await gameplayExperiments(s.cfg),
    ref.live,
    meta.source.credit ?? "",
  );
  // The owner's own series ("GTA 6 Day N", challenges) never take another streamer's play.
  if (!meta.source.credit && !(await applyChallenge(s, ep, script, meta))) await applyGtaDaily(s, ep, script, meta);
  await guardScript(s, ep, script, "after writing");
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    assets_json: {
      words,
      durationSeconds: len,
      clips: [],
      cutdown: {
        start: win.start,
        end: win.end,
        video: "cut.mp4",
        background: "bg.mp4",
      },
    },
  });
  await logEvent(s.db, ep.id, "gameplay_cut", {
    clip: ref.id,
    start: win.start,
    end: win.end,
    title: script.youtube.title,
  });
}

/** Keeps the inbox clip's status in step with its episode, for the finder's owner and Leonida Intel. */
async function gameplayStatus(
  cfg: Config,
  ep: Episode,
  status: GameplayStatus,
): Promise<void> {
  const id = ep.story_json.gameplay?.id;
  if (id)
    await writeMeta(gameplayDir(cfg, id), { status }).catch(() => undefined);
}

/** A clip's inbox folder, found by id under GAMEPLAY_ROOT (so it survives the move to the Mac). */
function gameplayDir(cfg: Config, id: string): string {
  return path.join(cfg.gameplayRoot, "inbox", id);
}

/** Once a gameplay Short is public: published/<id>.json for Leonida Intel's article. */
async function gameplayLive(s: Services, ep: Episode): Promise<void> {
  const g = ep.script_json?.gameplay;
  if (ep.lane !== "gameplay" || !g || !ep.youtube_video_id) return;
  // A scheduled video is not watchable yet: the go-live check writes it after its slot.
  if (ep.publish_at && new Date(ep.publish_at) > s.now()) return;
  const wrote = await writeManifest(s.cfg.gameplayRoot, {
    id: g.inbox_id,
    youtube_id: ep.youtube_video_id,
    title: polishTitle(ep.script_json!),
    ...articleFields(g, ep.script_json!.game_title),
    experiment_slug: g.experiment_slug,
    published_at: (ep.publish_at
      ? new Date(ep.publish_at)
      : s.now()
    ).toISOString(),
  }).catch((err) => {
    log("warn", "gameplay manifest failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return false;
  });
  await gameplayStatus(s.cfg, ep, "published");
  if (wrote)
    await logEvent(s.db, ep.id, "gameplay_manifest", { clip: g.inbox_id });
}

// ------------------------------------------------------------------ GTA 6 Day N (src/gtadaily.ts)

/**
 * GTA_DAILY: a GTA VI gameplay Short becomes the next free "GTA 6 Day N", pinned to the daily slot (one of
 * GAMEPLAY_SLOTS, so no volume is added) and titled for its day. A clip that is not GTA VI, a rehearsal, one that
 * fails the no-story gate or one with no free day left stays an ordinary gameplay Short. The day is claimed in the
 * settings table and kept on the story, so a restart or a retried step never renumbers it.
 */
export async function applyGtaDaily(
  s: Services,
  ep: Episode,
  script: Script,
  meta: Pick<GameplayMeta, "rehearsal" | "stream_ask" | "live" | "review">,
): Promise<void> {
  const daily = gtaDailyFrom(s.cfg);
  const ref = ep.story_json.gameplay;
  if (!daily || !ref || ref.rehearsal || meta.rehearsal) return;
  const ask = meta.stream_ask?.question ?? meta.live?.ask;
  const had = ep.story_json.gtaDaily;
  if (had) {
    // A retried step: the day is already this episode's.
    script.series = "gta_daily";
    script.youtube.title = dailyTitle(had.day, [script.youtube.title, ref.review.question], { ask: !!had.ask });
    return;
  }
  if (ep.slot_at) return; // already given a time by something else
  if (!isGtaVi(`${ref.review.game_title} ${script.game_title}`)) return;
  const problems = dailySpoilerProblems(
    daily,
    [script.youtube.title, script.headline, ref.review.question, ref.review.result, ref.review.result_line, ref.review.description, ask],
    s.now(),
    {
      reviewerSawStory: ref.review.spoiler,
      spoilerHeld: !!meta.review?.spoiler_held_until,
      live: s.cfg.spoilerGuard ? spoilerWindows() : [],
    },
  );
  if (problems.length) {
    await logEvent(s.db, ep.id, "gta_daily_skipped", { why: problems.slice(0, 4) });
    return;
  }
  const rows = await s.db.query<{ at: string }>(
    `SELECT COALESCE(publish_at, slot_at) AS at FROM episodes
      WHERE COALESCE(publish_at, slot_at) IS NOT NULL AND COALESCE(publish_at, slot_at) > $1::timestamptz - interval '1 hour'
        AND status NOT IN ('failed','rejected') AND id <> $2`,
    [s.now(), ep.id],
  );
  const target = targetDay(
    daily,
    s.now(),
    new Set(await liveClaims(s.db)),
    rows.map((r) => new Date(r.at)),
    s.cfg.minUploadGapMinutes,
  );
  if (!target || !(await claimDay(s.db, target.day, ep.id))) {
    await logEvent(s.db, ep.id, "gta_daily_skipped", { why: ["no free day in the next days"] });
    return;
  }
  let title = dailyTitle(target.day, [script.youtube.title, ref.review.question], { ask: !!ask });
  if (dailyTitleProblems(title, target.day).length) title = dailyTitle(target.day, "", { ask: !!ask });
  script.series = "gta_daily";
  script.youtube.title = title;
  const story: GtaDailyStory = {
    day: target.day,
    date: dateOfDay(daily.start, target.day),
    slot: daily.slot,
    theme: dailyTheme(`${ref.review.question} ${ref.review.result} ${ask ?? ""}`),
    ...(ask ? { ask } : {}),
  };
  await s.db.query(
    `UPDATE episodes SET slot_at = $2, story_json = story_json || jsonb_build_object('gtaDaily', $3::jsonb) WHERE id = $1`,
    [ep.id, target.at, JSON.stringify(story)],
  );
  ep.story_json.gtaDaily = story;
  ep.slot_at = target.at.toISOString();
  await logEvent(s.db, ep.id, "gta_daily_numbered", { day: target.day, slot_at: target.at.toISOString(), title });
}

/** A public challenge episode's links (src/challengestep.ts), never during the owner's publishing hold. */
async function linkChallengePublic(s: Services, ep: Episode): Promise<void> {
  if (await publishHeld(s.db)) return;
  await linkChallenge(
    s,
    ep,
    s.youtube(accountOf(ep)) as Partial<{
      rewriteDescriptions: (id: string, fn: (d: string, lang: string) => string) => Promise<number>;
    }>,
    (n) => quotaAdd(s.db, s.now(), n),
  );
}

/** With GTA_DAILY on, the daily slot on the run's days is kept for the day's episode: other gameplay Shorts go elsewhere. */
export function gtaDailyKept(cfg: Config): (at: Date) => boolean {
  const daily = gtaDailyFrom(cfg);
  if (!daily) return () => false;
  return (at) => {
    const day = dayOf(daily, at);
    return day !== undefined && at.getTime() === slotOfDay(daily, day).getTime();
  };
}

/** The daily playlist's id once it exists (made on the first add by addToSeries). */
async function gtaDailyPlaylistId(s: Services): Promise<string | undefined> {
  const [row] = await s.db.query<{ value: string }>(`SELECT value FROM settings WHERE key = $1`, [
    `playlist:${GTA_DAILY_PLAYLIST}`,
  ]);
  return row?.value || undefined;
}

/** Just before upload: the day before (out or scheduled ahead of this one) and the playlist, for the description. */
export async function refreshGtaDailyLinks(s: Services, ep: Episode): Promise<Episode> {
  const story = ep.story_json.gtaDaily;
  const daily = gtaDailyFrom(s.cfg);
  if (!story || !daily) return ep;
  const prev = await previousDay(s.db, story.day, slotOfDay(daily, story.day));
  const playlistId = await gtaDailyPlaylistId(s);
  const next: GtaDailyStory = {
    ...story,
    ...(prev ? { previous: { day: prev.day, videoId: prev.videoId, title: prev.title } } : {}),
    ...(playlistId ? { playlistId } : {}),
  };
  await s.db.query(
    `UPDATE episodes SET story_json = story_json || jsonb_build_object('gtaDaily', $2::jsonb) WHERE id = $1`,
    [ep.id, JSON.stringify(next)],
  );
  return { ...ep, story_json: { ...ep.story_json, gtaDaily: next } };
}

/** The daily's line for the first comment: Day N+1 and its day when it is already made, and the playlist. */
export async function gtaDailyComment(s: Services, ep: Episode): Promise<string> {
  const story = ep.story_json.gtaDaily;
  const daily = gtaDailyFrom(s.cfg);
  if (!story || !daily) return "";
  return dailyCommentLine(
    story.day,
    nextDay(daily, story.day, await liveClaims(s.db)),
    await gtaDailyPlaylistId(s),
  );
}

/**
 * Once Day N is public: the day before gets its "Next:" line pointing here, and Day N's own "Previous:" line is put
 * right if the day before went up after it was uploaded. One videos.update each (50 units, plus 1 to read), done
 * once, never during the owner's publishing hold. A failure is logged and never blocks anything.
 */
export async function linkGtaDaily(s: Services, ep: Episode): Promise<void> {
  const story = ep.story_json.gtaDaily;
  if (!story || !ep.youtube_video_id || !gtaDailyFrom(s.cfg) || s.cfg.dryRun) return;
  if (await publishHeld(s.db)) return;
  const yt = s.youtube(accountOf(ep)) as Partial<{
    rewriteDescriptions: (id: string, fn: (d: string, lang: string) => string) => Promise<number>;
  }>;
  if (!yt.rewriteDescriptions) return;
  const [done] = await s.db.query(
    `SELECT 1 FROM events WHERE episode_id = $1 AND kind = 'gta_daily_linked' LIMIT 1`,
    [ep.id],
  );
  if (done) return;
  const prev = await previousDay(s.db, story.day, s.now());
  try {
    if (prev) {
      await yt.rewriteDescriptions(prev.videoId, (d) => withNextLink(d, { day: story.day, videoId: ep.youtube_video_id! }));
      await quotaAdd(s.db, s.now(), QUOTA.localize + QUOTA.poll);
      if (story.previous?.videoId !== prev.videoId) {
        await yt.rewriteDescriptions(ep.youtube_video_id, (d) => withPreviousLink(d, prev));
        await quotaAdd(s.db, s.now(), QUOTA.localize + QUOTA.poll);
      }
    }
    await logEvent(s.db, ep.id, "gta_daily_linked", { day: story.day, previous: prev?.day ?? null });
  } catch (err) {
    log("warn", "gta daily link failed", { episode: ep.id, error: errorMessage(err) });
    await logEvent(s.db, ep.id, "gta_daily_link_failed", { error: errorMessage(err).slice(0, 300) });
  }
}

/** Rejected, expired or failed gameplay episodes mark their clip "skipped" so nobody wonders about it. */
export async function syncGameplaySkips(s: Services): Promise<void> {
  if (!s.cfg.gameplayEnabled) return;
  const rows = await s.db.query<Episode>(
    `SELECT * FROM episodes WHERE lane = 'gameplay' AND status IN ('rejected','failed') AND updated_at > now() - interval '3 days'`,
  );
  for (const ep of rows) {
    const id = ep.story_json.gameplay?.id;
    if (!id) continue;
    const dir = gameplayDir(s.cfg, id);
    const meta = await readMeta(dir);
    if (meta && meta.status !== "skipped" && meta.status !== "published")
      await writeMeta(dir, { status: "skipped" });
  }
}

/**
 * The gameplay slot for an approved Short: the first of GAMEPLAY_SLOTS, today or on the next days, that is
 * at least 20 minutes away, holds no other gameplay Short and is a full upload gap from every other
 * scheduled video. Gameplay is extra, so it moves out of the planned lanes' way, never the reverse.
 */
export function nextGameplaySlot(
  cfg: Config,
  now: Date,
  scheduled: Date[],
  gameplayTaken: Date[],
  /** Slots kept for something else: GTA 6 Day N keeps its daily slot on the run's days (src/gtadaily.ts). */
  kept: (at: Date) => boolean = () => false,
): Date | undefined {
  const gap = cfg.minUploadGapMinutes * 60_000;
  const today = dayKey(now, cfg.timezone);
  for (let d = 0; d < 14; d++) {
    for (const hhmm of cfg.gameplaySlots) {
      const at = localTime(addDays(today, d), hhmm, cfg.timezone);
      if (at.getTime() - now.getTime() < 20 * 60_000) continue;
      if (kept(at)) continue;
      if (gameplayTaken.some((t) => t.getTime() === at.getTime())) continue;
      if (scheduled.some((t) => Math.abs(t.getTime() - at.getTime()) < gap))
        continue;
      return at;
    }
  }
  return undefined;
}

/** Rumour Shorts made today: written as a rumour, or still unwritten from a story with rumour signals. */
export async function countRumoursToday(
  db: Db,
  timeZone: string,
): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1
        AND status NOT IN ('failed','rejected')
        AND (script_json->>'is_rumour' = 'true' OR (script_json IS NULL AND story_json->>'rumourSignals' = 'true'))`,
    [timeZone],
  );
  return Number(row?.n ?? 0);
}

// ------------------------------------------------------------------ the twin channel

/** The twin channel is on and its login is stored. */
async function twinReady(s: Services): Promise<boolean> {
  if (!s.cfg.twinLanguage) return false;
  return (await s.youtubeConnected?.(s.cfg.twinLanguage)) ?? true;
}

/**
 * A twin for every Short that went public on the main channel in the last three days and has none yet:
 * the same story and media, re-written in the twin language, uploaded to the twin channel a little after
 * the original. One in production at a time, behind every other lane.
 */
export async function maybeSelectTwin(
  s: Services,
): Promise<string | undefined> {
  const { db, cfg } = s;
  if (!(await twinReady(s))) return undefined;
  const lang = cfg.twinLanguage;
  const [busy] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE lane = 'twin' AND status IN ('selected','scripted','voiced','rendered')`,
  );
  if (Number(busy?.n ?? 0) > 0) return undefined;
  const now = s.now();
  const parents = await db.query<Episode>(
    `SELECT e.* FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.script_json IS NOT NULL
        AND e.lane IN ('news','news_breaking','evergreen','free')
        AND COALESCE(e.script_json->>'runtime', 'short') = 'short'
        AND COALESCE(e.publish_at, e.updated_at) <= $1::timestamptz - interval '15 minutes'
        AND COALESCE(e.publish_at, e.updated_at) > $1::timestamptz - interval '3 days'
        AND NOT EXISTS (SELECT 1 FROM episodes t WHERE t.story_hash = 'twin:' || $2 || ':' || e.id)
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('made_private','crosspost_skip') AND COALESCE(v.detail->>'reason','') IN ('not public on YouTube',''))
      ORDER BY COALESCE(e.publish_at, e.updated_at) DESC LIMIT 5`,
    [now, lang],
  );
  for (const parent of parents) {
    // The original's folder must still be there (pruned, whole, after two weeks).
    if (!(await fs.stat(episodeDir(cfg, parent.id)).catch(() => undefined)))
      continue;
    const id = shortId();
    const live = new Date(parent.publish_at ?? parent.updated_at);
    const slotAt = new Date(
      Math.max(
        now.getTime() + 20 * 60_000,
        live.getTime() + cfg.twinDelayMinutes * 60_000,
      ),
    );
    const cluster: StoryCluster = {
      ...parent.story_json,
      hash: `twin:${lang}:${parent.id}`,
      twin: { parent: parent.id, language: lang, account: lang },
    };
    if (
      !(await createEpisode(db, id, cluster, {
        lane: "twin",
        priority: LANE_PRIORITY.twin,
        slotAt,
      }))
    )
      continue;
    await logEvent(db, id, "selected", {
      lane: "twin",
      parent: parent.id,
      language: lang,
      slot_at: slotAt.toISOString(),
    });
    log("info", "twin selected", { id, parent: parent.id, language: lang });
    return id;
  }
  return undefined;
}

/** Translates the original's script and copies its media, so the twin is voiced and rendered like any Short. */
async function stepScriptTwin(s: Services, ep: Episode): Promise<void> {
  const ref = ep.story_json.twin;
  if (!ref) throw new FatalError("twin episode has no original");
  const parent = await getEpisode(s.db, ref.parent);
  if (!parent?.script_json || !parent.youtube_video_id)
    throw new FatalError("the original Short is gone");
  const { script, problems } = await translateScript(
    s.llm,
    parent.script_json,
    ref.language,
    {
      parent: parent.id,
      parentVideo: parent.youtube_video_id,
    },
  );
  if (problems.length) {
    // A translation that changes a figure is not a twin: drop it rather than say something the original did not.
    await transition(s.db, ep.id, "selected", "rejected", {
      last_error: problems.join(" | "),
    });
    await logEvent(s.db, ep.id, "rejected", { by: "translation", problems });
    log("warn", "twin dropped: translation changed a figure", {
      episode: ep.id,
      problems,
    });
    return;
  }
  // The original's media, file for file, so the render finds everything under this episode's folder.
  const from = episodeDir(s.cfg, parent.id);
  const dir = episodeDir(s.cfg, ep.id);
  const pa = parent.assets_json ?? {};
  const files = [
    ...(pa.images ?? []).flatMap((i) => [i.file, i.blurFile]),
    ...(pa.clips ?? []).flatMap((c) => [c.file, c.blurFile]),
  ].filter((f): f is string => Boolean(f));
  for (const f of files) {
    await fs.mkdir(path.dirname(path.join(dir, f)), { recursive: true });
    await fs
      .copyFile(path.join(from, f), path.join(dir, f))
      .catch(() => undefined);
  }
  await guardScript(s, ep, script, "after writing");
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: parent.factcheck_json,
    assets_json: {
      images: pa.images,
      clips: pa.clips,
      steam: pa.steam,
      officialTrailer: pa.officialTrailer,
      rich: pa.rich,
    },
  });
  await logEvent(s.db, ep.id, "twin_translated", {
    parent: parent.id,
    language: ref.language,
    title: script.youtube.title,
  });
}

/** The script's stamp, timed to the first spoken word that matches it (none when the word was not found). */
export function stampsFor(
  script: Pick<Script, "stamp">,
  words: Array<{ text: string; start: number }>,
): Array<{
  at: number;
  text: string;
  sub?: string;
  colour: string;
  tone?: string;
}> {
  const st = script.stamp;
  if (!st?.word?.trim() || !st.text?.trim()) return [];
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$]/g, "");
  // The voice reads figures in words ("19" may come out "nineteenth"): match the spoken form's first token too.
  const wants = [
    norm(st.word),
    norm(speakable(st.word).split(/\s+/)[0] ?? ""),
  ].filter(Boolean);
  const hit = words.find((w) =>
    wants.some((x) => norm(w.text) === x || norm(w.text).startsWith(x)),
  );
  if (!hit) return [];
  return [
    {
      at: hit.start,
      text: st.text.toUpperCase().slice(0, 14),
      sub: st.sub?.trim() ? st.sub.toUpperCase() : undefined,
      colour: stampColour(st.tone),
      tone: st.tone,
    },
  ];
}

/** How the last eight Shorts opened their take and closed, so the writer and the validator keep the shapes varied. */
export async function recentShapes(
  db: Db,
  exceptId: string,
): Promise<RecentShapes> {
  const rows = await db.query<{ take: string | null; loop: string | null }>(
    `SELECT script_json->'pulse_take'->>'narration' AS take, script_json->>'loop_line' AS loop
       FROM episodes WHERE script_json IS NOT NULL AND id <> $1 AND status NOT IN ('failed','rejected')
         AND COALESCE(script_json->>'runtime', 'short') = 'short'
       ORDER BY created_at DESC LIMIT 8`,
    [exceptId],
  );
  // The last 20 Shorts' whole spoken scripts: the concession, data-feed and repeated-story checks read them.
  const full = await db.query<{ script: Script }>(
    `SELECT script_json AS script FROM episodes WHERE script_json IS NOT NULL AND id <> $1 AND status NOT IN ('failed','rejected')
         AND COALESCE(script_json->>'runtime', 'short') = 'short'
       ORDER BY created_at DESC LIMIT 20`,
    [exceptId],
  );
  // The newest Shorts' structures (SHORT_SKELETONS, src/editorial/skeletons.ts), "" for one written without.
  const structures = await db.query<{ skeleton: string | null }>(
    `SELECT script_json->>'skeleton' AS skeleton FROM episodes WHERE script_json IS NOT NULL AND id <> $1 AND status NOT IN ('failed','rejected')
         AND COALESCE(script_json->>'runtime', 'short') = 'short'
       ORDER BY created_at DESC LIMIT ${SKELETON_WINDOW}`,
    [exceptId],
  );
  const scripts = full.flatMap((r) => {
    try {
      return r.script?.hook && r.script.pulse_take
        ? [narrationOf({ ...r.script, beats: r.script.beats ?? [] })]
        : [];
    } catch {
      return [];
    }
  });
  return {
    takes: rows
      .map((r) => (r.take ?? "").trim().split(/\s+/).slice(0, 4).join(" "))
      .filter(Boolean),
    loops: rows.map((r) => (r.loop ?? "").trim()).filter(Boolean),
    scripts,
    skeletons: structures.map((r) => r.skeleton ?? ""),
  };
}

/**
 * The narration of the newest earlier documentary on the same franchise ("Grand Theft Auto" matches
 * "Grand Theft Auto VI"), so a new one reuses none of its wording; undefined when there is none.
 */
export async function priorDocNarration(
  db: Db,
  exceptId: string,
  franchise: string,
): Promise<string | undefined> {
  const rows = await db.query<{ script: Script }>(
    `SELECT script_json AS script FROM episodes
      WHERE id <> $1 AND script_json->>'evergreen_format' = 'documentary' AND status NOT IN ('failed','rejected')
        AND (position(lower($2) in lower(coalesce(script_json->>'game_title', ''))) > 0
             OR position(lower(coalesce(script_json->>'game_title', '~')) in lower($2)) > 0)
      ORDER BY created_at DESC LIMIT 1`,
    [exceptId, franchise],
  );
  const sc = rows[0]?.script;
  if (!sc) return undefined;
  return (
    [
      sc.hook,
      ...(sc.beats ?? []).map((b) => b.narration),
      sc.pulse_take?.narration ?? "",
    ]
      .join(" ")
      .trim() || undefined
  );
}

/** The week's published news Shorts, most watched first (their best captured view count), rumours left out. */
export async function recapStoryIds(db: Db, now: Date): Promise<string[]> {
  const rows = await db.query<{
    id: string;
    views: number | null;
    game: string | null;
  }>(
    `SELECT e.id, (SELECT max(m.views) FROM video_metrics m WHERE m.episode_id = e.id) AS views,
            e.script_json->>'game_title' AS game
       FROM episodes e
      WHERE e.lane IN ('news','news_breaking') AND e.status = 'published' AND e.youtube_video_id IS NOT NULL
        AND coalesce(e.publish_at, e.updated_at) > $1::timestamptz - interval '7 days'
        AND coalesce((e.script_json->>'is_rumour')::boolean, false) = false
      ORDER BY 2 DESC NULLS LAST, coalesce(e.publish_at, e.updated_at) DESC
      LIMIT 40`,
    [now],
  );
  // One story per game, its most-watched: two chapters on the same game read as a repeat.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const key = (r.game ?? r.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.id);
    if (out.length >= RECAP_STORIES_MAX) break;
  }
  return out;
}

/**
 * Writes the weekly recap: packaging, then each story against its own sources (the Short's checked
 * narration and the articles it came from) with a fact-check pass and up to two rewrites, then the
 * intro and outro.
 */
async function stepScriptRecap(
  s: Services,
  ep: Episode,
  ids: string[],
): Promise<void> {
  const stories: RecapStory[] = [];
  for (const id of ids) {
    const short = await getEpisode(s.db, id);
    const script = short?.script_json;
    if (!short || !script) continue;
    const articles: string[] = [];
    for (const item of (short.story_json?.items ?? []).slice(0, 3)) {
      const a = await s.fetchArticle(item.url).catch(() => undefined);
      if (a?.text)
        articles.push(`[${item.source}] ${a.title}\n${a.text.slice(0, 3500)}`);
    }
    const urls = (short.story_json?.items ?? []).slice(0, 3).map((i) => i.url);
    stories.push({
      episodeId: id,
      headline: script.youtube?.title ?? script.headline,
      game: script.game_title || short.story_json.headline,
      steamTerm: script.steam_search_term ?? "",
      views: 0,
      source: {
        title: short.story_json.sources.slice(0, 3).join(" / ") || "outlets",
        url: urls[0] ?? "",
        text: [
          `[Pulse Short, fact-checked against these sources] ${narrationOf(script)}`,
          ...articles,
        ].join("\n\n"),
      },
    });
  }
  if (stories.length < RECAP_STORIES_MIN)
    throw new FatalError(
      `weekly recap has only ${stories.length} stories with sources`,
    );
  const packaging = await packageRecap(
    s.llm,
    stories,
    dayKey(s.now(), s.cfg.timezone),
  );
  const titles = stories.map(
    (st, i) => packaging.chapter_titles[i] ?? st.headline,
  );
  const chapters: import("./editorial/documentary.ts").DocChapter[] = [];
  const recapMoments: Array<DocMoment[] | undefined> = [];
  const warnings: string[] = [];
  for (const [index, story] of stories.entries()) {
    let feedback: string[] = [];
    let chapter: import("./editorial/documentary.ts").DocChapter | undefined;
    // DOC_FACT_DISCIPLINE: the last check's disputed lines, undefined when that check could not run.
    let disputed: Array<{ quote: string; problem: string }> | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      chapter = await writeRecapChapter(s.llm, {
        story,
        title: titles[index]!,
        index,
        titles,
        previousEnding: chapters.at(-1)?.paragraphs.at(-1)?.narration,
        feedback,
      });
      let unsupported: string[];
      if (s.cfg.docFactDiscipline) {
        disputed = await checkChapterItems(s.llm, chapter, story.source).catch(() => undefined);
        unsupported = (disputed ?? []).map((u) => `"${u.quote}": ${u.problem}`);
      } else
        unsupported = await checkChapter(
          s.llm,
          chapter,
          story.source,
        ).catch(() => [] as string[]);
      const others = validateRecapChapter(chapter, chapters);
      feedback = [
        ...others,
        ...unsupported.map(
          (u) => `Not supported by the sources, remove or correct it: ${u}`,
        ),
      ];
      if (!feedback.length) break;
      // Under DOC_FACT_DISCIPLINE the disputed lines are settled below, never kept as a warning.
      if (attempt === 2)
        warnings.push(...(s.cfg.docFactDiscipline ? others : feedback).map((f) => `${story.game}: ${f}`));
    }
    if (s.cfg.writerNotesGuard && chapterRefusal(chapter!).length)
      throw new FatalError(
        `recap story "${story.game}" refused: ${chapterRefusal(chapter!)[0]!.slice(0, 200)}`,
      );
    // DOC_FACT_DISCIPLINE (src/docfacts.ts): no disputed line goes on. Mended or cut within the story's cap and
    // checked once more; a story still disputed stops the recap (its stories, titles and packaging go together).
    if (s.cfg.docFactDiscipline) {
      const settled = await disciplineChapter({
        chapter: chapter!,
        disputed,
        check: (c) => checkChapterItems(s.llm, c, story.source),
        maxCutShare: s.cfg.docFactCutPercent / 100,
      });
      await logEvent(s.db, ep.id, "doc_fact_discipline", {
        story: index + 1,
        ok: settled.ok,
        disputed: disputed?.length ?? null,
        repairs: settled.repairs,
        ...(settled.ok ? { cut_words: settled.cut, of_words: settled.base } : { why: settled.why, left: settled.left }),
      }).catch(() => undefined);
      if (!settled.ok && settled.errored)
        throw new Error(`recap story "${story.game}": ${settled.why}; trying again later`);
      if (!settled.ok)
        throw new FatalError(
          `recap story "${story.game}" fails its fact check after rewrites and cuts: ${settled.why.slice(0, 220)}`,
        );
      if (settled.repairs.length) {
        chapter = settled.chapter;
        warnings.push(docFactLine(story.game, settled.repairs));
      }
    }
    const grounded = groundCallouts(chapter!, story.source);
    if (grounded.removed.length)
      warnings.push(
        ...grounded.removed.map(
          (r) => `${story.game}: on-screen ${r} not in the sources, removed`,
        ),
      );
    chapters.push(grounded.chapter);
    // The recap's shot list, as a documentary chapter's: graphics, clippings of the coverage, captions.
    try {
      const shot = groundDocMoments(
        await writeDocMoments(s.llm, {
          game: story.game,
          chapterTitle: titles[index]!,
          sentences: grounded.chapter.paragraphs.flatMap((p) =>
            sentencesOf(p.narration),
          ),
          source: story.source,
          games: stories.map((st) => st.game),
          lessons: await visualLessons(s.db, s.now(), segmentInputs).catch(
            () => "",
          ),
        }),
        story.source,
        stories.map((st) => st.game),
        grounded.chapter.paragraphs.flatMap((p) => sentencesOf(p.narration)),
      );
      recapMoments[index] = shot.moments;
    } catch (err) {
      log("warn", "recap shot list failed", {
        episode: ep.id,
        story: index + 1,
        error: errorMessage(err),
      });
    }
    log("info", "recap story written", {
      episode: ep.id,
      story: index + 1,
      game: story.game,
    });
  }
  const bookends = await writeRecapBookends(
    s.llm,
    packaging,
    chapters.map((chapter, i) => ({ title: titles[i]!, chapter })),
  );
  const script = recapToScript(
    packaging,
    stories,
    chapters,
    bookends,
    Number(dayKey(s.now(), s.cfg.timezone).slice(0, 4)),
    recapMoments,
  );
  script.sources = [
    ...new Set(stories.flatMap((st) => (st.source.url ? [st.source.url] : []))),
  ];
  if (warnings.length)
    await logEvent(s.db, ep.id, "style_warnings", { problems: warnings });
  await guardScript(s, ep, script, "after writing");
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      recap: true,
      stories: ids,
      warnings,
      sources: script.sources,
    },
  });
}

/**
 * A game's fact sheet with a short Wikipedia background (development, release, sales, reception, legacy),
 * so a ranking has more to say than store numbers; games off Steam get a sheet of their own this way.
 */
async function withBackground(
  s: Services,
  title: string,
  facts: SteamFacts | undefined,
  maxChars = 2200,
): Promise<SteamFacts | undefined> {
  const wiki = await s
    .research(title, `${title} video game`, maxChars)
    .catch(() => undefined);
  // FACT_VAULT=write: what this step fetched grows the vault (the research is followed to its cited sources in the
  // background, so the writer never waits on it); FACT_VAULT=read and above: the vault's verified facts join the sheet.
  await growFromSteam(s.db, s.cfg.factVault, title, facts);
  void growFromResearch(s.db, s.cfg.factVault, title, wiki, s.cfg.factVaultFetchMax);
  const vault = await openSession(s.db, s.cfg.factVault, [title], [], s.now());
  if (!facts && !wiki && !vault?.brief) return undefined;
  return {
    ...(facts ?? {
      name: title,
      storeUrl: "",
      fetchedAt: s.now().toISOString(),
    }),
    ...(wiki ? { background: wiki.text, backgroundUrl: wiki.url } : {}),
    ...(vault?.brief ? { vault: vault.brief } : {}),
  };
}

/** Writes the long-form ranking against live Steam facts for each entry, with one rewrite on problems. */
/**
 * The final factual adjudication of a ranking or long video: a blocker goes back to the writer once as
 * feedback (returned); a blocker that survives the rewrite fails the episode so nothing wrong goes out.
 */
async function adjudicateRanking(
  s: Services,
  ep: Episode,
  script: Script,
  facts: Array<{ title: string; facts: SteamFacts }>,
  attempt: number,
  extra: Array<{ title: string; facts: string }> = [],
  /** Applies the Fact Vault's fixes to the caller's draft (FACT_VAULT=enforce); without it a fixable blocker stands. */
  fix?: (fixes: VaultFix[]) => void | number,
  /** LONG_FACT_DISCIPLINE: the long ranking's own draft, so a surviving blocker is mended on its cards and moments too. */
  long?: LongRepairHooks,
): Promise<string[]> {
  // FACT_VAULT: the vault's facts for these games (unless each sheet already carries them) and what it verified.
  const spoken = [narrationOf(script), script.youtube.title, ...script.beats.map((b) => cardText(b.visual))];
  const vault = await openSession(s.db, s.cfg.factVault, [...facts.map((f) => f.title), ...extra.map((e) => e.title)], spoken, s.now());
  const verified = vault?.verified(spoken).trim() ?? "";
  const vaultFacts = [
    ...(vault?.brief && !facts.some((f) => f.facts.vault) ? [{ title: "Pulse Fact Vault", facts: vault.brief }] : []),
    ...(verified ? [{ title: "Pulse Fact Vault pre-check", facts: verified }] : []),
  ];
  const factList = [
    ...facts.map((f) => ({ title: f.title, facts: factsText(f.facts) })),
    ...extra,
    ...vaultFacts,
  ];
  const check = await factCheckRanking(s.llm, script, factList);
  let vaultFixes: VaultFix[] = [];
  let blockers = check.issues
    .filter((i) => i.severity === "blocker")
    .map((i) => `Fact-check: "${i.quote}" - ${i.problem}`);
  await logEvent(s.db, ep.id, "factcheck", {
    attempt,
    verdict: check.verdict,
    blockers,
    summary: check.summary,
  });
  // FACT_VAULT=enforce: a blocker the vault supports passes, one it contradicts takes the vault's value.
  if (vault && blockers.length) {
    const settled = await vault.settle(script, blockers, ep.id, `ranking attempt ${attempt}`);
    const fixedOnes = settled.resolutions.filter((r) => r.status === "fixed");
    if (fixedOnes.length && fix) {
      for (const vf of settled.fixes) {
        const took = fix([vf]);
        if (typeof took !== "number" || took >= 1) vaultFixes.push(vf);
      }
    }
    const unfixable = fix ? [] : fixedOnes.map((r) => `Fact-check: "${r.blocker.quote}" - ${r.blocker.problem}`);
    const before = blockers.length;
    blockers = [...settled.remaining, ...unfixable];
    if (!blockers.length && before > 0) return [];
  }
  if (check.verdict !== "fail" && !blockers.length) return [];
  if (attempt === 0)
    return blockers.length ? blockers : [`Fact-check failed: ${check.summary}`];
  // FACT_REPAIR (src/factrepair.ts): one or two lines still wrong after the rewrite are mended without a model
  // and the mended script is checked again; only a clean second check saves the episode.
  // LONG_FACT_DISCIPLINE (src/longrepair.ts): a long ranking is mended on its structured draft, with the last resort
  // of cutting the blocked sentences inside the 15% cap; the draft already carries any vault fixes.
  if (long && blockers.length) {
    if (await repairLongRanking(s, ep, long, blockers, factList)) return [];
  } else if (s.cfg.factRepair && fix && blockers.length) {
    const base = vaultFixes.length ? applyVaultFixes(script, vaultFixes).value : script;
    if (await repairRanking(s, ep, base, blockers, factList, fix)) return [];
  }
  throw new FatalError(
    `fact-check still failing after a rewrite: ${(blockers[0] ?? check.summary).slice(0, 300)}`,
  );
}

/** The long ranking's draft as LONG_FACT_DISCIPLINE's repair reads and replaces it. */
interface LongRepairHooks {
  draft: () => import("./editorial/longform.ts").LongformScript;
  set: (d: import("./editorial/longform.ts").LongformScript) => void;
}

const blockersOf = (c: { issues: Array<{ severity: string; quote: string; problem: string }> }) =>
  c.issues.filter((i) => i.severity === "blocker").map((i) => `Fact-check: "${i.quote}" - ${i.problem}`);

/**
 * LONG_FACT_DISCIPLINE: the surviving blockers mended on the long draft (line, card and moment together) and checked
 * again; when that fails, the last resort cuts the blocked sentences (src/longrepair.ts) and checks once more. Only a
 * clean check replaces the caller's draft, so nothing the checker rejected goes out.
 */
async function repairLongRanking(
  s: Services,
  ep: Episode,
  long: LongRepairHooks,
  blockers: string[],
  factList: Array<{ title: string; facts: string }>,
): Promise<boolean> {
  const start = long.draft();
  const ctx = speakContext(longformToScript(start).say_as);
  const speak = (t: string) => speakable(t, ctx);
  const recheck = async (d: typeof start) => {
    const c = await factCheckRanking(s.llm, longformToScript(d), factList);
    const left = blockersOf(c);
    return { passed: c.verdict !== "fail" && !left.length, left, summary: c.summary };
  };
  const first = repairLongform(start, blockers, speak);
  let from = start;
  let cut = 0;
  let open = blockers;
  if (!first.unrepaired.length && first.repairs.length) {
    const r = await recheck(first.draft);
    await logEvent(s.db, ep.id, "fact_repair", {
      outcome: r.passed ? "repaired" : "recheck_failed",
      long: true,
      repairs: first.repairs,
      left: r.left,
      summary: r.summary,
    });
    if (r.passed) {
      long.set(first.draft);
      log("info", "long fact-check blockers repaired", {
        id: ep.id,
        repairs: first.repairs.map((x) => `${x.kind}: ${x.quote}`),
      });
      return true;
    }
    if (!r.left.length) return false;
    from = first.draft;
    cut = first.cut;
    open = r.left;
  } else {
    await logEvent(s.db, ep.id, "fact_repair", {
      outcome: "not_repairable",
      long: true,
      blockers,
      unrepaired: first.unrepaired,
    });
  }
  // The last resort: cut the blocked sentences rather than lose the whole video (never past the 15% cap of the
  // draft as it stood before any repair).
  const baseWords = longWords(start);
  const last = repairLongform(from, open, speak, { lastResort: true, baseWords, alreadyCut: cut });
  if (last.unrepaired.length || !last.repairs.length) {
    await logEvent(s.db, ep.id, "fact_repair", {
      outcome: "cut_not_possible",
      long: true,
      blockers: open,
      unrepaired: last.unrepaired,
    });
    return false;
  }
  const r2 = await recheck(last.draft);
  await logEvent(s.db, ep.id, "fact_repair", {
    outcome: r2.passed ? "repaired_by_cut" : "cut_recheck_failed",
    long: true,
    repairs: last.repairs,
    cut_words: last.cut,
    left: r2.left,
    summary: r2.summary,
  });
  log(r2.passed ? "info" : "warn", r2.passed ? "long fact-check blockers cut" : "long fact cut did not pass the re-check", {
    id: ep.id,
    repairs: last.repairs.map((x) => `${x.kind}: ${x.quote}`),
  });
  if (!r2.passed) return false;
  long.set(last.draft);
  return true;
}

/** FACT_REPAIR: mends the surviving blockers, re-checks, and hands the fixes to the caller's draft on a pass. */
async function repairRanking(
  s: Services,
  ep: Episode,
  script: Script,
  blockers: string[],
  factList: Array<{ title: string; facts: string }>,
  fix: (fixes: VaultFix[]) => void | number,
): Promise<boolean> {
  const ctx = speakContext(script.say_as);
  const fields = [script.hook, ...script.beats.map((b) => b.narration), script.pulse_take.narration, script.loop_line];
  const mended = repairBlockers(fields, blockers, (t) => speakable(t, ctx));
  if (mended.unrepaired.length || !mended.fixes.length) {
    await logEvent(s.db, ep.id, "fact_repair", { outcome: "not_repairable", blockers, unrepaired: mended.unrepaired });
    return false;
  }
  const fixes: VaultFix[] = mended.fixes.map((f) => ({ ...f, factId: 0, why: "fact repair" }));
  // Every fix must land at least once in the script that gets re-checked.
  let mendedScript = script;
  let missed = false;
  for (const f of fixes) {
    const r = applyVaultFixes(mendedScript, [f]);
    if (r.applied < 1) missed = true;
    mendedScript = r.value;
  }
  if (missed) {
    await logEvent(s.db, ep.id, "fact_repair", { outcome: "not_applied", repairs: mended.repairs });
    return false;
  }
  const recheck = await factCheckRanking(s.llm, mendedScript, factList);
  const left = recheck.issues
    .filter((i) => i.severity === "blocker")
    .map((i) => `Fact-check: "${i.quote}" - ${i.problem}`);
  const passed = recheck.verdict !== "fail" && !left.length;
  await logEvent(s.db, ep.id, "fact_repair", {
    outcome: passed ? "repaired" : "recheck_failed",
    repairs: mended.repairs,
    left,
    summary: recheck.summary,
  });
  log(passed ? "info" : "warn", passed ? "fact-check blockers repaired" : "fact repair did not pass the re-check", {
    id: ep.id,
    repairs: mended.repairs.map((r) => `${r.kind}: ${r.quote}`),
  });
  if (!passed) return false;
  // The draft must take every fix, or the line the checker rejected would still go out.
  for (const f of fixes) {
    const took = fix([f]);
    if (typeof took === "number" && took < 1) {
      await logEvent(s.db, ep.id, "fact_repair", { outcome: "draft_mismatch", from: f.from });
      return false;
    }
  }
  return true;
}

/**
 * GTA_GUIDES: the guide's script (src/gtaguide.ts, src/editorial/gtaguidewriter.ts). Facts from the fact pack only,
 * first-hand lines only from the owner's own recordings, HUD readings and stream checks; the list shape and the story
 * guard sent back once, then the long ranking's fact-check (with the pack and the play evidence as its facts) decides.
 */
async function stepScriptGtaGuide(s: Services, ep: Episode, topic: GtaGuideTopic): Promise<void> {
  const kind = kindOf(topic.kind);
  if (!kind) throw new FatalError(`unknown GTA guide kind "${topic.kind}"`);
  const pack = readFactPack(s.cfg.gtaGuideFacts.length ? s.cfg.gtaGuideFacts : DEFAULT_GUIDE_FACTS, kind.key);
  if (!pack.confirmed) throw new FatalError("GTA guide: the fact pack is empty or unreadable");
  const recordings = await loadPlayRecordings(s.cfg.dataDir).catch(() => []);
  const dates = new Map(recordings.map((r) => [r.vodId, r.recordedOn ?? ""] as [string, string]));
  const asks = await loadGuideAsks(s.cfg.dataDir).catch(() => []);
  const hud = await loadHudFacts(s.cfg.dataDir, dates).catch(() => []);
  const evidence = playEvidence({ recordings, hudFacts: hud, asks });
  const rumours = asks
    .filter((a) => a.rumour && !a.spoiler && a.status === "open")
    .slice(0, 8)
    .map((a) => a.claim || a.question);
  const brief = { kind, facts: pack, evidence, asks: topic.asks, rumours };
  const openingCap = s.cfg.longOpeningContract === "fix" || s.cfg.longArgues === "fix";
  const opts = { openingCap, discipline: s.cfg.longFactDiscipline };
  const ctx = { kind, evidence, ...(openingCap ? { introMax: GUIDE_OPENING_MAX } : {}) };
  // The fact-check's facts: the pack's two parts, kept apart, and the play evidence.
  const extra = [
    { title: "GTA VI fact pack, confirmed", facts: pack.confirmed },
    ...(pack.reported ? [{ title: "GTA VI fact pack, reported (only ever said as reported)", facts: pack.reported }] : []),
    ...(evidence.length ? [{ title: "Pulse's own play (the owner's recordings, HUD readings and stream checks)", facts: evidence.join("\n") }] : []),
    ...(rumours.length ? [{ title: "Rumours viewers repeat (only ever said as rumours)", facts: rumours.join("\n") }] : []),
  ];
  let draft: import("./gtaguide.ts").GuideDraft | undefined;
  let feedback: string[] = [];
  // The last draft's checks: a rewrite whose plan comes back too thin keeps that draft only when nothing factual or
  // hard was wrong with it (the first plan may have been fine; the rewrite must never kill it).
  let lastFactual: string[] = [];
  let lastHard: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      draft = await writeGtaGuide(s.llm, brief, feedback, opts, (plan) => guidePlanProblems(plan, kind, evidence));
    } catch (err) {
      if (attempt > 0 && err instanceof GuideTooThinError && draft && !lastFactual.length && !lastHard.length) {
        await logEvent(s.db, ep.id, "style_warnings", { problems: [err.message, ...feedback] });
        break;
      }
      throw err;
    }
    const script = guideToScript(draft, kind);
    const problems = [
      ...guideProblems(draft, ctx),
      ...scriptSpoilers(script, spoilerWindows(), s.now()).map(
        (x) => `Story spoiler (${x.where}): "${x.phrase}" gives away ${x.what}; GTA VI's story is held until December 18.`,
      ),
    ];
    const factual = await adjudicateRanking(s, ep, script, [], attempt, extra);
    lastFactual = factual;
    lastHard = problems.filter((p) => /^Story spoiler|speaks first-hand|no play evidence/.test(p));
    if (!problems.length && !factual.length) break;
    if (attempt === 1 && problems.length) {
      const hard = lastHard;
      if (hard.length) throw new FatalError(`GTA guide still breaks a hard rule after the rewrite: ${hard[0]!.slice(0, 300)}`);
      await logEvent(s.db, ep.id, "style_warnings", { problems });
    }
    feedback = [...factual, ...problems];
  }
  if (!draft) throw new Error("GTA guide produced nothing");
  const script = guideToScript(draft, kind);
  // Item quality: the plan check sent it back once and dropped what it could; what is left is noted, never a rewrite.
  const thin = guideQualityWarnings(draft, kind);
  if (thin.length) await logEvent(s.db, ep.id, "style_warnings", { problems: thin });
  const longChecks = await recordLongChecks(s, ep.id, script, { kind: "ranking" });
  if (longChecks.warnings.length) await logEvent(s.db, ep.id, "style_warnings", { problems: longChecks.warnings });
  await guardScript(s, ep, script, "after writing");
  const meta = script.gta_guide!;
  await logEvent(s.db, ep.id, "gta_guide", {
    stage: "scripted",
    kind: kind.key,
    title: script.youtube.title,
    items: meta.items,
    labels: {
      confirmed: meta.labels.filter((l) => l.label === "confirmed").length,
      reported: meta.labels.filter((l) => l.label === "reported").length,
      rumour: meta.labels.filter((l) => l.label === "rumour").length,
    },
    my_playthrough: meta.labels.filter((l) => l.play).length,
    evidence_lines: evidence.length,
    facts_missed: pack.missed,
    thumb: meta.thumb,
  });
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      gta_guide: topic,
      evidence,
      ...(longChecks.long_contract ? { long_contract: longChecks.long_contract } : {}),
      ...(longChecks.long_argues ? { long_argues: longChecks.long_argues } : {}),
    },
  });
}

async function stepScriptLongform(s: Services, ep: Episode): Promise<void> {
  const fc = ep.factcheck_json as {
    doc?: boolean;
    recap?: boolean;
    explained?: boolean;
    story?: ExplainedStory;
    stories?: string[];
    topic?: import("./editorial/evergreen.ts").EvergreenTopic;
    gta_guide?: GtaGuideTopic;
  } | null;
  // GTA_GUIDES: a GTA 6 guide list (src/gtaguide.ts), written on its own, rendered as a ranking.
  if (fc?.gta_guide && kindOf(fc.gta_guide.kind)) return stepScriptGtaGuide(s, ep, fc.gta_guide);
  if (fc?.recap && fc.stories?.length)
    return stepScriptRecap(s, ep, fc.stories);
  // The week's biggest story, explained (src/explainedstep.ts).
  if (fc?.explained && fc.story)
    return stepScriptExplained(s, ep, fc.story, {
      segmentInputs: (sc) => segmentInputs(sc),
    });
  if (fc?.doc && fc.topic)
    return stepScriptDocumentary(s, ep, fc.topic as unknown as DocTopic);
  const topic = fc?.topic;
  if (!topic) throw new FatalError("long-form episode has no topic");
  let facts: Array<{ title: string; facts: SteamFacts }> = [];
  let feedback: string[] = [];
  let draft: import("./editorial/longform.ts").LongformScript | undefined;
  // The plan names the games; their Steam facts are looked up once and every entry is written with them.
  const lookup = async (
    entries: Array<{ game_title: string; steam_search_term: string }>,
  ) => {
    if (facts.length) return facts;
    for (const entry of entries) {
      try {
        const app = entry.steam_search_term
          ? await s.findGame(entry.steam_search_term)
          : undefined;
        const f = await withBackground(
          s,
          entry.game_title,
          app ? await s.gameFacts(app) : undefined,
        );
        if (f) facts.push({ title: entry.game_title, facts: f });
      } catch (err) {
        log("warn", "long-form steam lookup failed", {
          game: entry.game_title,
          error: errorMessage(err),
        });
      }
    }
    return facts;
  };
  // What earlier long videos taught us about holding viewers, entry by entry (empty until there is a curve).
  const lessons = await longLessons(s.db, s.now()).catch(() => "");
  // The Inspiration rules (src/editorial/longrules.ts): measured while it's written, so they never force a whole new draft.
  // Under the contract's 90-word opening the stacked hook gives way (rankingRules); off, these are the rules as before.
  const rules = rankingRules(longRulesFor(s.cfg, "ranking"), {
    argues: s.cfg.longArgues,
    contract: s.cfg.longOpeningContract,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    draft = await writeLongform(s.llm, topic, lookup, feedback, lessons, {
      punchyHook: s.cfg.longPunchyHook,
      soundBeats: s.cfg.docSoundBeats,
      rules,
      argues: s.cfg.longArgues,
      contract: s.cfg.longOpeningContract,
      discipline: s.cfg.longFactDiscipline,
    });
    // LONG_FACT_DISCIPLINE (src/editorial/longfacts.ts): the checks that need no model, before the fact-check reads it.
    let preFeedback: string[] = [];
    if (s.cfg.longFactDiscipline) {
      // No fact pack carries a series' complete list today, so an "Every X" title is always counted (rule a).
      const pre = disciplineLongform(
        draft,
        facts.map((f) => ({ title: f.title, facts: factsText(f.facts) })),
      );
      draft = pre.draft;
      preFeedback = preFlagFeedback(pre.flags);
      if (pre.flags.length)
        await logEvent(s.db, ep.id, "long_precheck", {
          attempt,
          fixed: pre.flags.filter((f) => f.fixed).map((f) => `${f.kind}: ${f.quote}`),
          named: preFeedback,
        });
    }
    const problems = [
      ...validateLongform(draft, rules, {
        argues: s.cfg.longArgues === "fix",
        openingCap: s.cfg.longArgues === "fix" || s.cfg.longOpeningContract === "fix",
      }),
      ...writerTitleProblems(s.cfg, draft.youtube.title),
      // RANKING_STANCE (src/stance.ts): the ranking's title takes a side, and nothing past Part 2.
      ...(s.cfg.rankingStance
        ? stanceProblems(draft.youtube.title).filter((p) => !writerTitleProblems(s.cfg, draft!.youtube.title).includes(p))
        : []),
    ];
    const factual = await adjudicateRanking(
      s,
      ep,
      longformToScript(draft),
      facts,
      attempt,
      [],
      (fx) => {
        const r = applyVaultFixes(draft!, fx);
        draft = r.value;
        return r.applied;
      },
      s.cfg.longFactDiscipline
        ? {
            draft: () => draft!,
            set: (d) => {
              draft = d;
            },
          }
        : undefined,
    );
    if (!problems.length && !factual.length) break;
    // One rewrite with the problems named; style misses that survive are logged, facts are not (adjudicateRanking throws).
    if (attempt === 1 && problems.length)
      await logEvent(s.db, ep.id, "style_warnings", { problems });
    // The pre-check's named lines ride along with a rewrite that is happening anyway; alone they never cost one.
    feedback = [...factual, ...problems, ...preFeedback];
  }
  if (!draft) throw new Error("long-form script produced nothing");
  if (longRulesOn(rules)) {
    const said = narrationOfLongform(draft);
    const missed = [
      ...longRuleWarnings(said, rules),
      ...hookStackProblems(
        draft.intro.narration,
        draft.intro.hook_stack,
        rules.hookStack,
        [...draft.entries]
          .sort((a, b) => b.rank - a.rank)
          .map((x) => x.narration),
        draft.outro.narration,
      ),
    ];
    await logEvent(s.db, ep.id, "long_rules", {
      kind: rules.kind,
      measures: scriptMeasures(said),
      loops: draft.placed_loops?.length ?? 0,
      hookStack: draft.intro.hook_stack,
      missed,
    });
    if (missed.length)
      await logEvent(s.db, ep.id, "style_warnings", { problems: missed });
  }
  const script = await quoteLongStep(s, ep, withSpoilerWarning(longformToScript(draft)));
  // LONG_ARGUES and LONG_OPENING_CONTRACT on the record (check and fix); off, nothing is measured.
  const longChecks = await recordLongChecks(s, ep.id, script, { kind: "ranking" });
  if (longChecks.warnings.length)
    await logEvent(s.db, ep.id, "style_warnings", { problems: longChecks.warnings });
  await guardScript(s, ep, script, "after writing");
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      topic,
      facts: facts.map((f) => ({ title: f.title, facts: f.facts })),
      ...(longChecks.long_contract ? { long_contract: longChecks.long_contract } : {}),
      ...(longChecks.long_argues ? { long_argues: longChecks.long_argues } : {}),
    },
  });
}

/**
 * Achievement entries come from Steam's numbers, not the writer's memory: an
 * entry that names no achievement in the data is dropped, the rest take the
 * data's exact name, percentage and icon, and ranks follow rarity (1 = rarest).
 */
/** The criterion line under a ranking's thumbnail headline: "By campaign strength", never "By ranked by...". */
export function thumbCriterion(criterion: string): string {
  const core = criterion
    .trim()
    .replace(/[.]$/, "")
    .replace(/^(ranked\s+|judged\s+|sorted\s+)?(by|on)\s+/i, "");
  const line = `By ${core.charAt(0).toLowerCase()}${core.slice(1)}`;
  if (line.length <= 48) return line;
  const cut = line.slice(0, 48);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:\s]+$/, "");
}

/** A euro price as Steam formats it ("5,99€") written for an English screen ("€5.99"). */
export function euro(v: string): string {
  const m = v.replace(/\s/g, "").match(/^([\d.,]+)€$/);
  return m ? `€${m[1]!.replace(/\.(?=\d{3})/g, "").replace(",", ".")}` : v;
}

/**
 * Deal entries take Steam's prices, never the writer's: name and year from the data, the screen
 * shows the dollar price with pounds and euros beside it and the original price, and an entry that
 * names no game in the data is dropped.
 */
export function groundDeals<
  T extends {
    entries: Array<{
      rank: number;
      game_title: string;
      steam_search_term: string;
      platforms: string;
      year: number;
      verdict_chip: string;
      price?: string;
      was?: string;
    }>;
  },
>(draft: T, data: Deal[]): T {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[\u00ae\u2122\u00a9]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const kept = draft.entries
    .map((e) => {
      const d =
        data.find((x) => norm(x.name) === norm(e.game_title)) ??
        data.find(
          (x) =>
            norm(e.game_title).includes(norm(x.name)) ||
            norm(x.name).includes(norm(e.game_title)),
        );
      if (!d) return undefined;
      const name = d.name.replace(/[\u00ae\u2122\u00a9]/g, "").trim();
      return {
        ...e,
        game_title: name,
        steam_search_term: name,
        year: d.year ?? e.year,
        platforms: "PC (Steam)",
        // The dollar price and the cut are the big chip; the card line carries pounds, euros and the old price.
        verdict_chip: `${d.usd.final} · ${d.usd.pct}% OFF`,
        price:
          [d.gbp, d.eur ? euro(d.eur) : undefined]
            .filter(Boolean)
            .join(" · ") || "PC (STEAM)",
        was: `WAS ${d.usd.initial}`,
      };
    })
    .filter((e): e is NonNullable<typeof e> => !!e);
  // The writer's order stands (rank 1 = its best pick); ranks are closed up after any drop.
  kept.sort((a, b) => a.rank - b.rank).forEach((e, i) => (e.rank = i + 1));
  return { ...draft, entries: kept };
}

export interface ClimberData {
  name: string;
  rank: number;
  lastRank?: number;
  climb: number;
  peak: number;
  year?: number;
}

/**
 * Climber entries take the chart's numbers, never the writer's: name, year,
 * the climb label and the peak come from Steam, ranks follow places climbed
 * (1 = biggest), and an entry that names no game in the data is dropped.
 */
export function groundClimbers<
  T extends {
    entries: Array<{
      rank: number;
      game_title: string;
      steam_search_term: string;
      platforms: string;
      year: number;
      peak?: number;
    }>;
  },
>(draft: T, data: ClimberData[]): T {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[\u00ae\u2122\u00a9]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const kept = draft.entries
    .map((e) => {
      const d =
        data.find((x) => norm(x.name) === norm(e.game_title)) ??
        data.find(
          (x) =>
            norm(e.game_title).includes(norm(x.name)) ||
            norm(x.name).includes(norm(e.game_title)),
        );
      if (!d) return undefined;
      const name = d.name.replace(/[\u00ae\u2122\u00a9]/g, "").trim();
      return {
        ...e,
        game_title: name,
        steam_search_term: name,
        year: d.year ?? e.year,
        platforms:
          d.lastRank === undefined
            ? `NEW AT #${d.rank}`
            : `UP ${d.climb} TO #${d.rank}`,
        peak: d.peak,
        climb: d.climb,
      };
    })
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .filter(
      (e, i, a) => a.findIndex((x) => x.game_title === e.game_title) === i,
    )
    .sort((a, b) => b.climb - a.climb);
  return {
    ...draft,
    entries: kept.map(({ climb: _c, ...e }, i) => ({ ...e, rank: i + 1 })),
  };
}

/** What the card says you must do: Steam's words if they fit, the writer's shorter ones if not, always within the card. */
export function achievementRequirement(
  description: string | undefined,
  written: string | undefined,
): string {
  const steam = (description ?? "").trim();
  if (steam && fitRequirement(steam).fits) return steam;
  const own = (written ?? "").trim();
  if (own && fitRequirement(own).fits) return own;
  return cardRequirement(steam || own);
}

export function groundAchievements<
  T extends {
    entries: Array<{
      rank: number;
      game_title: string;
      steam_search_term: string;
      platforms: string;
      year: number;
      percent?: number;
      icon?: string;
      requirement?: string;
    }>;
  },
>(
  draft: T,
  data: Array<{
    name: string;
    game: string;
    percent: number;
    icon?: string;
    year?: number;
    description?: string;
  }>,
): T {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const kept = draft.entries
    .map((e) => {
      const d =
        data.find((x) => norm(x.name) === norm(e.game_title)) ??
        data.find(
          (x) =>
            norm(e.game_title).includes(norm(x.name)) ||
            norm(x.name).includes(norm(e.game_title)),
        );
      return d
        ? {
            ...e,
            game_title: d.name,
            steam_search_term: d.game,
            platforms: d.game,
            year: d.year ?? e.year,
            percent: d.percent,
            icon: d.icon,
            // The card's words: Steam's own when they fit three readable lines, else the writer's plain version.
            requirement: achievementRequirement(d.description, e.requirement),
          }
        : undefined;
    })
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  const unique = kept.filter(
    (e, i) =>
      kept.findIndex(
        (x) =>
          x.game_title === e.game_title &&
          x.steam_search_term === e.steam_search_term,
      ) === i,
  );
  unique
    .sort((a, b) => (a.percent ?? 100) - (b.percent ?? 100))
    .forEach((e, i) => (e.rank = i + 1));
  return { ...draft, entries: unique };
}

/** Writes a ranking Short against live Steam facts for each entry, with one rewrite on problems. */
async function stepScriptEvergreen(s: Services, ep: Episode): Promise<void> {
  // "The Story of Every [series] Game" has its own writer and rules (src/editorial/everygame.ts).
  const everyGame = (ep.factcheck_json as { every_game?: EveryGameJob } | null)
    ?.every_game;
  if (everyGame) return stepScriptEveryGame(s, ep, everyGame);
  const topic = (
    ep.factcheck_json as {
      topic?: import("./editorial/evergreen.ts").EvergreenTopic;
    } | null
  )?.topic;
  // Weekly formats carry the week's data for the writer.
  const brief = (ep.factcheck_json as { brief?: string } | null)?.brief ?? "";
  if (!topic) throw new FatalError("evergreen episode has no topic");
  // Buy, Wait or Skip has its own writer and the data's own verdict (src/verdictstep.ts).
  if ((topic.format as string) === "buy_wait_skip")
    return stepScriptVerdict(s, ep, (script, attempt, data) =>
      adjudicateRanking(s, ep, script, [], attempt, data),
    );
  let facts: Array<{ title: string; facts: SteamFacts }> = [];
  let feedback: string[] = [];
  let draft: import("./editorial/evergreen.ts").EvergreenScript | undefined;
  // The recent Shorts' scripts, so an evergreen Short never retells one of them.
  const recentScripts =
    (await recentShapes(s.db, ep.id).catch(() => undefined))?.scripts ?? [];
  const recentTexts = await recentShortTexts(s.db, ep.id, s.now()).catch(
    () => [],
  );
  // The format's own data (Steam's chart, deals or achievement rates) replaces the writer's numbers.
  const data = (
    ep.factcheck_json as {
      achievements?: Array<{
        name: string;
        game: string;
        percent: number;
        icon?: string;
        year?: number;
        description?: string;
      }>;
    } | null
  )?.achievements;
  const climbers = (ep.factcheck_json as { climbers?: ClimberData[] } | null)
    ?.climbers;
  const deals = (ep.factcheck_json as { deals?: Deal[] } | null)?.deals;
  const ground = (d: NonNullable<typeof draft>) => {
    let g = d;
    if (data?.length) g = groundAchievements(g, data);
    if (climbers?.length) g = groundClimbers(g, climbers);
    if (deals?.length) g = groundDeals(g, deals);
    return g;
  };
  // What may never ship: number one given away, an achievement that goes unnamed or a condition made up. Read on
  // the grounded script, because ranks and figures come from the data, not the writer.
  const mustFix = (d: NonNullable<typeof draft>) => {
    const g = ground(d);
    return [
      ...spoilerProblems(g),
      ...(ACHIEVEMENT_FORMATS.has(g.format)
        ? achievementProblems(
            g,
            data?.length
              ? new Map(
                  data
                    .filter((x) => x.description)
                    .map((x) => [normRankTitle(x.name), x.description!]),
                )
              : undefined,
          )
        : []),
    ];
  };
  // The audit's writer rules for a Short's list (src/editorial/shortrules.ts); a long video's brief is left alone.
  const ruleNote = ep.lane !== "longform" ? evergreenRuleNote(s.cfg) : "";
  const ruledBrief = ruleNote ? [brief, ruleNote].filter(Boolean).join("\n\n") : brief;
  for (let attempt = 0; attempt < 2; attempt++) {
    draft = await writeEvergreen(s.llm, topic, facts, feedback, ruledBrief);
    const problems = [
      ...new Set([
      ...validateEvergreen(draft, recentScripts),
        ...mustFix(draft),
      ]),
      ...writerTitleProblems(s.cfg, draft.youtube.title, topic.format),
    ];
    // No title or hook phrase a few recent Shorts already used (REPEAT_MAX, src/authenticity.ts).
    problems.push(
      ...repetitionProblems(
        { title: draft.youtube.title, hook: draft.hook, game: draft.theme },
        recentTexts,
        s.cfg.repeatMax,
      ),
    );
    // Fetch the facts for the entries the writer chose, then rewrite once against them.
    if (attempt === 0) {
      facts = [];
      for (const entry of draft.entries) {
        try {
          const app = entry.steam_search_term
            ? await s.findGame(entry.steam_search_term)
            : undefined;
          const f = await withBackground(
            s,
            entry.game_title,
            app ? await s.gameFacts(app) : undefined,
            1200,
          );
          if (f) facts.push({ title: entry.game_title, facts: f });
        } catch (err) {
          log("warn", "evergreen steam lookup failed", {
            game: entry.game_title,
            error: errorMessage(err),
          });
        }
      }
      feedback = [
        ...problems,
        ...(facts.length
          ? [
              "Check every year, score and price against the Steam facts now provided and correct any that differ.",
            ]
          : []),
      ];
      if (!feedback.length) break;
      continue;
    }
    if (problems.length)
      await logEvent(s.db, ep.id, "style_warnings", { problems });
  }
  if (!draft) throw new Error("evergreen script produced nothing");
  // The final adjudication, on the grounded script and against everything the writer was given: the Steam
  // facts and the format's own data (the chart's climbs, the deal prices). Without the data, a climbers
  // Short was dropped for chart moves that came from the chart itself (25 Oct 2026). One rewrite, then fail.
  const dataFacts = brief.trim()
    ? [
        {
          title:
            "The data this Short was built from (the format's own source, e.g. Steam's chart or store)",
          facts: brief,
        },
      ]
    : [];
  let factRepaired = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const factual = await adjudicateRanking(
      s,
      ep,
      evergreenToScript(ground(draft)),
      facts,
      attempt,
      dataFacts,
      (fx) => {
        if (fx.some((x) => x.why === "fact repair")) factRepaired = true;
        const r = applyVaultFixes(draft!, fx);
        draft = r.value;
        return r.applied;
      },
    );
    if (!factual.length) break;
    draft = await writeEvergreen(s.llm, topic, facts, factual, brief);
  }
  // The fact-check's rewrite and a stubborn writer both get a last look: one more rewrite, then the plain wording.
  let left = mustFix(draft);
  // FACT_REPAIR mended this draft after its last check: a fresh rewrite would ship unchecked, so run the step again.
  if (left.length && factRepaired) throw new Error(`ranking script not fit to voice after fact repair: ${left[0]}`);
  if (left.length) {
    await logEvent(s.db, ep.id, "style_warnings", { problems: left });
    draft = await writeEvergreen(s.llm, topic, facts, left, brief);
  }
  draft = patchSpoilers(ground(draft));
  left = mustFix(draft);
  // An entry that still names number one or goes unnamed has no plain wording to fall back on: the step runs again.
  if (left.length) throw new Error(`ranking script not fit to voice: ${left[0]}`);
  const script = evergreenToScript(draft);
  await guardScript(s, ep, script, "after writing");
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: {
      topic,
      facts: facts.map((f) => ({ title: f.title, facts: f.facts })),
    },
  });
}

// --------------------------------------------------------------------- steps

/** The run the next-part line reads: The GTA File's own run file for its parts, else the launch run (SHORT_RUN_FILE). */
function nextPartRun(cfg: Config, series: string | undefined) {
  const file = series === "gta_file" ? gtaFileFrom(cfg) : undefined;
  return file ? gtaFileParts(readRun(file.runFile), file.slot) : readRun(cfg.shortRunFile);
}

async function stepScript(s: Services, ep: Episode): Promise<void> {
  if (ep.lane === "cutdown") return stepScriptCutdown(s, ep);
  if (ep.lane === "gameplay") return stepScriptGameplay(s, ep);
  if (ep.lane === "twin") return stepScriptTwin(s, ep);
  if (ep.lane === "evergreen") return stepScriptEvergreen(s, ep);
  if (ep.lane === "longform") return stepScriptLongform(s, ep);
  const cluster = ep.story_json;
  const items = [...cluster.items]
    .sort(
      (a, b) =>
        (a.sourceKind === "official" ? -1 : 1) -
        (b.sourceKind === "official" ? -1 : 1),
    )
    // A planned run topic lists its sources on purpose (src/shortrun.ts), so all of them are read.
    .slice(0, cluster.run ? 8 : 4);
  const articles = (
    await Promise.all(items.map((i) => s.fetchArticle(i.url)))
  ).filter((a): a is ArticleText => Boolean(a));
  const mustLabelRumour = !cluster.corroborated;
  // A news Short is written from what its sources say, never from a headline. Elden Ring's questline (4 Nov 2026)
  // reached the writer as a Steam reprint's teaser, read as a mystery product, and went out as misinformation.
  // The richest of the story's sources has to say enough; a second outlet's article counts. Why and run topics
  // carry their own picked sources.
  const thinSource =
    (ep.lane === "news" || ep.lane === "news_breaking") && !cluster.why && !cluster.run
      ? thinSourceProblem(articles, cluster.items, s.cfg.sourceMinChars)
      : undefined;
  if (thinSource) {
    await markSeen(s.db, cluster.hash, cluster.headline, "rejected", "source too thin");
    await transition(s.db, ep.id, "selected", "rejected", {
      last_error: thinSource,
    });
    await logEvent(s.db, ep.id, "thin_source", { why: thinSource });
    await s.notify({
      level: "info",
      content: `Dropped before writing, the slot goes to the next story: "${cluster.headline}". ${thinSource}`,
    });
    return;
  }

  // Live Steam numbers give the take something the headline doesn't have.
  let steam: EpisodeAssets["steam"];
  if (cluster.gameHint) {
    try {
      const app = await s.findGame(cluster.gameHint);
      if (app)
        steam = {
          appId: app.appId,
          name: app.name,
          facts: await s.gameFacts(app),
        };
    } catch (err) {
      log("warn", "steam lookup failed", {
        game: cluster.gameHint,
        error: errorMessage(err),
      });
    }
  }
  const storeData = steam ? factsText(steam.facts) : undefined;

  let script: Script | undefined;
  let feedback: string[] = [];
  let check;
  // Draft, check house rules, fact-check; one fix with the problems fed back (edits to the draft, or a
  // whole new draft when the edits do not apply).
  const recent = await recentShapes(s.db, ep.id).catch(() => undefined);
  // The weekly retention test (src/growth.ts): this Short's variant of the thing under test, and the rules the
  // finished tests settled. Recorded on the episode so the judge can find it; a failure here never stops a Short.
  // A planned run topic's angle sets its opener, so it stays out of the opening-line test.
  // A holdout Short (LEARN_HOLDOUT_SHARE, src/learn/holdout.ts) is the factory as pinned: no test arm, and the winners
  // the tests had settled when the baseline was pinned.
  const holdout = holdoutOf(s.cfg);
  // SCRIPT_ROOM (src/editorial/room.ts, src/roomstep.ts): the same Shorts the desk covers, split by episode into the
  // room's arm and the control arm. Under "on" the room writes its arm's script on its own short brief, so the stacked
  // experiments (the growth test, the voice test) are not assigned to that arm and stay clean; a fallback to the normal
  // writer writes without them.
  const roomArmOf: RoomArm | undefined =
    s.cfg.scriptRoom !== "off" &&
    payoffApplies({
      lane: ep.lane,
      why: !!cluster.why,
      reply: !!cluster.reply,
      search: !!cluster.search,
      gtaFile: !!cluster.gtaFile,
    })
      ? roomArm(ep.id, s.cfg.scriptRoomShare)
      : undefined;
  const roomOn = roomArmOf === "room" && s.cfg.scriptRoom === "on";
  const testAssigned = await (cluster.run || cluster.reply || holdout || roomOn
    ? Promise.resolve(undefined)
    : growthAssign(s.db, s.cfg, s.now(), ep, (m) => s.notify(m))
  ).catch((err) => {
    log("warn", "growth test assignment failed", { error: errorMessage(err) });
    return undefined;
  });
  const testDefaultsBase = holdout
    ? pinnedGrowthDefaults(holdout.growthDefaults)
    : await growthDefaults(s.db).catch(() => []);
  // LEARN_BANDIT (src/learn/bandit.ts): every open growth factor tested at once by Thompson sampling. On, the running
  // test's variant and the other factors' arms come from the bandit; shadow records its draws only. growth.ts's
  // bootstrap stays the verdict, reading assets_json.test as before.
  const { test, defaults: testDefaults } =
    holdout || cluster.run || cluster.reply || roomOn
      ? { test: testAssigned, defaults: testDefaultsBase }
      : await banditForShort(s, ep, testAssigned, testDefaultsBase);
  // LEARN_PLAYBOOK=on (src/learn/playbook.ts): the tracked lessons, recorded against this Short; never for a holdout.
  const playbook = holdout ? "" : await playbookForShort(s, ep.id);
  // The audit's writer rules (src/editorial/shortrules.ts) come after the test's variant, nearest the draft.
  const argument = argumentArm(s.cfg, ep);
  if (argument)
    await logEvent(s.db, ep.id, "short_argument", { arm: "argument" });
  // DROP_ANGLE (src/editorial/dropangle.ts): an official drop is written as one reframing idea, never a detail list.
  const drop = s.cfg.dropAngle && !cluster.why && !cluster.reply && isOfficialDrop(cluster);
  // SHORT_PAYOFF_GATE (src/editorial/payoff.ts): news, breaking and Why Shorts split by episode into the gate's arm
  // (one question planned, the answer held past 60% and kept out of the hook, headline and title) and the control arm.
  // The arm is kept on the script so the weekly report can compare them; a retry keeps its arm.
  const payoffArmOf: PayoffArm | undefined =
    s.cfg.shortPayoffGate !== "off" &&
    payoffApplies({
      lane: ep.lane,
      why: !!cluster.why,
      reply: !!cluster.reply,
      search: !!cluster.search,
      gtaFile: !!cluster.gtaFile,
    })
      ? payoffArm(ep.id, s.cfg.shortPayoffShare)
      : undefined;
  const payoffGated = payoffArmOf === "gate";
  // "fix": the deterministic rules join the house rules (the draft goes back once, then out with a note).
  const payoffFix = payoffGated && s.cfg.shortPayoffGate === "fix";
  const payoffSentBack: string[] = [];
  let payoffFallback: { script: Script; check: FactCheck } | undefined;
  // SCRIPT_DESK (src/editorial/desk.ts): the same Shorts split by episode into the desk's arm (the writer states its
  // angle first, an editor reads the settled script and, under "fix", the biggest weakness is rewritten) and the control
  // arm (read once, unchanged), so the weekly report can set the desk's score against real retention.
  const deskArmOf: DeskArm | undefined =
    s.cfg.scriptDesk !== "off" &&
    payoffApplies({
      lane: ep.lane,
      why: !!cluster.why,
      reply: !!cluster.reply,
      search: !!cluster.search,
      gtaFile: !!cluster.gtaFile,
    })
      ? deskArm(ep.id, s.cfg.scriptDeskShare)
      : undefined;
  const deskPlanned = deskArmOf === "desk";
  const deskFix = deskPlanned && s.cfg.scriptDesk === "fix";
  let deskKilled: DeskRecord["kill"] | undefined;
  // SHORT_SKELETONS (src/editorial/skeletons.ts): a news Short's structure, none of the newest 30 Shorts' own. A Why
  // Short and a planned run topic keep the structure their own brief sets; a running hook-style test keeps its hook.
  const skeleton =
    s.cfg.shortSkeletons && !cluster.why && !cluster.run && !cluster.reply
      ? pickSkeleton(cluster.hash, recent?.skeletons ?? [], {
          questionEndings: !s.cfg.shortEndPayoff,
          argument,
          openings: hookStyleOpenings(test, testDefaults),
          ...(drop ? { orders: ["call_then_proof", "one_detail"] } : {}),
          ...(payoffGated ? { payoff: true } : {}),
        })
      : undefined;
  // The voice test (6 Nov 2026): the owner's examples, same story and day, 260k views against our 130, all lead
  // with a person's take. Half the Shorts get that voice; assignment by episode, so a retry keeps its side.
  const personal = !roomOn && s.cfg.voiceTestShare > 0 && unitHash(ep.id) < s.cfg.voiceTestShare;
  if (s.cfg.voiceTestShare > 0 && !roomOn)
    await logEvent(s.db, ep.id, "voice_test", { personal }).catch(() => undefined);
  // The series this Short belongs to (format redesign plan, src/series.ts): saved on the script for the weekly report.
  const series = seriesTagFor(ep);
  // The Pulse Check is the news desk's own segment; with NEWS_SEGMENT_SERIES every series Short ends on it too.
  const pulseCheckPlanned = pulseCheckFor(s.cfg, {
    lane: ep.lane,
    why: !!cluster.why,
    argument,
    series,
  });
  // ENDING_FORMS_SHARE (src/editorial/endingforms.ts): half the Pulse Check Shorts drop the spoken "My verdict:" and
  // end the take on a varied closing form instead. A room Short skips the Pulse Check already, so it is not in the test.
  const endingArm =
    pulseCheckPlanned && !roomOn && s.cfg.endingFormsShare > 0
      ? endingArmFor(unitHash(`endings:${ep.id}`), s.cfg.endingFormsShare)
      : undefined;
  let endingForm: EndingForm | undefined;
  if (endingArm === "forms") {
    const recentForms = await recentEndingForms(s.db, ep.id, s.now()).catch(() => ({ used: [] as string[], kept: undefined }));
    endingForm = pickEndingForm(unitHash(`endform:${ep.id}`), recentForms.used, recentForms.kept);
  }
  if (endingArm)
    await logEvent(s.db, ep.id, "ending_forms", { arm: endingArm, ...(endingForm ? { form: endingForm } : {}) }).catch(() => undefined);
  const pulseCheck = pulseCheckPlanned && endingArm !== "forms";
  // The next-part line test (SERIES_NEXT_LINE, plan item 9): The Why and The GTA File, on alternate days, and only
  // when the run has the next part planned and dated (src/nextpart.ts). No plan, no line.
  const lineArm =
    s.cfg.seriesNextLine && (series === "why" || series === "gta_file") && ep.slot_at
      ? nextLineArm(dayKey(new Date(ep.slot_at), s.cfg.timezone))
      : undefined;
  const nextPart =
    lineArm === "line" && ep.slot_at
      ? nextPartFor(nextPartRun(s.cfg, series), new Date(ep.slot_at), s.cfg.timezone)
      : undefined;
  // SHORT_MIN_SECONDS (plan item 2): the news writer's Shorts reach the floor.
  const floor = FLOOR_LANES.includes(ep.lane) ? s.cfg.shortMinSeconds : 0;
  const variantNote = [
    growthNotes(test, testDefaults),
    shortRuleNote(s.cfg, ep),
    personal ? PERSONAL_VOICE : "",
    shortFloorRule(floor, s.cfg.shortSpeed),
    pulseCheck && s.cfg.newsSegmentSeries ? seriesPulseCheckNote(series) : "",
    endingForm ? endingFormRule(endingForm) : "",
    nextPart ? nextLineRule(nextPart) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const recentTexts = await recentShortTexts(s.db, ep.id, s.now()).catch(
    () => [],
  );
  const whyHooks = cluster.why
    ? await recentWhyHooks(s.db, ep.id, s.now(), s.cfg.whyFreshDays).catch(
        () => [],
      )
    : [];
  // SHORT_LENGTHS (src/shortlengths.ts): the lane's seconds, word budget and beats; unset, the old 25-40 s and 70-100 words.
  // WHY_LENGTH_AB: on a short-arm day a serial Why or GTA File part is written to 30-35 s; the arm goes on the script.
  const lengthAb = lengthArmFor(s.cfg, ep);
  const length = shortTarget(lengthsFor(s.cfg, lengthAb), lengthFormatOf(ep), s.cfg.shortSpeed);
  // Every house rule a news Short answers to, besides the fact check: run on each draft and on the friend pass.
  const houseProblems = (sc: Script) => {
    // SHORT_PAYOFF_GATE's arm may keep a source's own quoted question ("Wait, what's this?"); elsewhere as before.
    const problems = validateScript(sc, recent, length, payoffGated ? { quotedQuestionsOk: true } : {});
    // A GTA File part (src/gtafile.ts) never reads as an announcement and says its part number first; a numbered
    // Why is titled "Why [game] [claim]" and opens on a claim (src/editorial/why.ts).
    if (cluster.gtaFile)
      problems.push(...gtaFileProblems(sc, cluster.gtaFile.part));
    else if (cluster.why?.serial) problems.push(...whySerialProblems(sc));
    const thin = s.cfg.shortRefuseThin
      ? thinProblems(narrationOf(sc), sc.thin_reason)
      : [];
    problems.push(...thin);
    // Never what a source leaves out, and no buying advice for something nobody sells (src/editorial/shortrules.ts).
    problems.push(
      ...absenceProblems(narrationOf(sc)),
      ...preorderProblems(
        narrationOf(sc),
        [
          ...articles.map((a) => a.text),
          ...cluster.items.map((i) => `${i.title} ${i.summary}`),
        ].join("\n"),
      ),
    );
    if (s.cfg.shortLabelsClean) problems.push(...cardFigureProblems(sc.beats));
    // GTA VI's release date in public copy: from November 18 in New Zealand, not just November 19 (src/launchprep.ts).
    problems.push(...releaseDateProblems(publicText(sc)));
    if (s.cfg.shortEndPayoff)
      problems.push(...endingProblems(sc.loop_line, nextPart));
    // No plug for another video in a news or Why Short (owner, 13 Nov 2026); only a funnel cut points to its long video.
    problems.push(...videoPlugProblems(narrationOf(sc)));
    if (lineArm) problems.push(...nextLineProblems(sc.loop_line, nextPart));
    // Under SHORT_MIN_SECONDS after the rewrite, a Short stops like a thin one: a big story still goes out.
    const short = shortFloorProblems(wordCount(narrationOf(sc)), floor, s.cfg.shortSpeed);
    problems.push(...short);
    thin.push(...short);
    if (pulseCheck) problems.push(...pulseCheckProblems(sc));
    if (endingForm) problems.push(...endingFormProblems(sc));
    if (skeleton) problems.push(...skeletonProblems(sc, skeleton));
    if (payoffFix) {
      const gateFindings = payoffFindings({
        script: sc,
        recentTakes: recent?.scripts?.length ? recent.scripts : recent?.takes,
        exemptOpeners: pulseCheck ? SEGMENT_OPENERS : [],
        endingChecked: s.cfg.shortEndPayoff,
        planned: true,
      }).findings;
      problems.push(...payoffFeedback(gateFindings));
      // An answer that is only "the sources don't say" is a thin story: after the one rewrite its slot goes to the
      // next story (a big story still goes out, as with any thin one), never a held-back non-answer.
      if (gateFindings.some((f) => f.rule === "absence_answer")) thin.push(ABSENCE_PROBLEM);
    }
    if (drop) problems.push(...detailListProblems(sc));
    // SHORT_ARGUES_CHECK (src/qa/argues.ts): a draft that only narrates its picture goes back to the writer once.
    if (s.cfg.shortArguesCheck) problems.push(...arguesWriterProblems(sc, ep.lane));
    // The test variant is a house rule for this Short: a draft that ignored it is sent back like any other.
    problems.push(...growthProblems(sc, test, testDefaults));
    // A video reply to a viewer's question opens "You asked" and never says the handle (src/commentreply.ts).
    if (cluster.reply) problems.push(...replyProblems(sc, cluster.reply));
    // No title or hook phrase a few recent Shorts already used (REPEAT_MAX, src/authenticity.ts); a Why
    // Short also opens unlike the last two weeks' and gives its reason to follow (src/editorial/why.ts).
    problems.push(
      ...repetitionProblems(
        {
          title: sc.youtube.title,
          // Every reply Short opens "You asked": the question after it is what must not repeat.
          hook: cluster.reply ? hookForRepetition(sc.hook) : sc.hook,
          game: runRepeatGame(sc.game_title, cluster.run),
        },
        recentTexts,
        s.cfg.repeatMax,
      ),
    );
    // A GTA File part opens "GTA File, part N" every day and ends on its own question: the Why's opening and
    // follow rules would refuse both, so it answers only to the plea guard.
    if (cluster.why)
      problems.push(
        ...(cluster.gtaFile ? [] : whyHookProblems(sc.hook, whyHooks)),
        ...whyFollowProblems(
          sc.loop_line,
          cluster.why.follow,
          s.cfg.shortEndPayoff || !!cluster.gtaFile,
        ),
        ...whyAnswerProblems(narrationOf(sc)),
      );
    // A search Short (src/searchq): no story spoiler, and the searcher's words in the title.
    if (cluster.search)
      problems.push(...searchProblems(sc, cluster.search, cluster.gameHint ?? "", s.now()));
    // A report card is credited to an outlet: it must be one of this story's own sources.
    const outlets = cluster.items.map((i) => i.source.toLowerCase());
    for (const b of sc.beats)
      if (
        b.visual.kind === "report" &&
        !outlets.some(
          (o) =>
            o.includes(b.visual.secondary.toLowerCase().trim()) ||
            b.visual.secondary.toLowerCase().includes(o),
        )
      )
        problems.push(
          `Report card names "${b.visual.secondary}", which is not one of this story's sources (${[...new Set(cluster.items.map((i) => i.source))].join(", ")}).`,
        );
    return { problems, thin };
  };
  // FACT_VAULT (src/factvault): the vault's facts for this story's game go to the writer and the fact check, its
  // articles grow the vault (write), and a blocker the vault settles is passed or fixed instead of dropping the story.
  const newsVault = await openSession(
    s.db,
    s.cfg.factVault,
    [cluster.gameHint ?? ""],
    [cluster.headline, ...cluster.items.map((i) => i.title)],
    s.now(),
  );
  void growFromArticles(
    s.db,
    s.cfg.factVault,
    cluster.gameHint,
    articles.map((a) => {
      const item = cluster.items.find((i) => i.url === a.url);
      return {
        url: a.url,
        title: a.title,
        text: a.text,
        ...(item ? { outlet: item.source, published: item.publishedAt.slice(0, 10), official: item.sourceKind === "official" } : {}),
      };
    }),
  );
  const vaultNote = (sc: Script) => {
    if (!newsVault) return undefined;
    const said = [narrationOf(sc), sc.headline, sc.youtube.title, ...sc.beats.map((b) => cardText(b.visual))];
    return `${newsVault.brief}${newsVault.verified(said)}`.trim() || undefined;
  };
  // SCRIPT_ROOM's variety memory: the kept shapes of the last room Shorts, from their records ("on" only).
  const roomRecent = roomOn
    ? recentShapesFrom(
        (
          await s.db
            .query<{ room: RoomRecord | null }>(
              `SELECT script_json->'room' AS room FROM episodes
                WHERE id <> $1 AND script_json->'room'->>'wrote' = 'true'
                ORDER BY created_at DESC LIMIT 8`,
              [ep.id],
            )
            .catch(() => [])
        ).map((r) => r.room),
      )
    : [];
  // WIKI_LEADS: primary sources that back fan wiki leads about this game, read from the stored leads (no fetch here).
  // A missing or week-old leads file is refreshed in the background for the next story about the game.
  if (s.cfg.wikiLeads && cluster.gameHint) void ensureWikiLeads(wikiLeadsRoot(s.cfg.dataDir), cluster.gameHint).catch(() => false);
  const leadSources =
    s.cfg.wikiLeads && cluster.gameHint
      ? await readWikiLeads(wikiLeadsRoot(s.cfg.dataDir), cluster.gameHint)
          .then((f) => leadPrimaries(f, 2, [cluster.headline, ...cluster.items.map((i) => `${i.title} ${i.summary}`)].join("\n")))
          .catch(() => [])
      : [];
  // SCRIPT_ROOM's inputs: the story's sources, the vault and the length lane, as the normal writer has them.
  const roomInput = (): RoomStepInput => ({
    ...(leadSources.length ? { leadPrimaries: leadSources } : {}),
    recent: roomRecent,
    llm: s.llm,
    cfg: s.cfg,
    cluster,
    articles,
    ...(storeData ? { storeData } : {}),
    vaultBrief: newsVault?.brief || CREDIT_RULE,
    ...(newsVault?.brief ? { vaultNote: newsVault.brief } : {}),
    ...(length ? { length } : {}),
    mustLabelRumour,
    feedUrls: FEEDS.map((f) => f.url),
    fetchLinks: (u) => (s.fetchLinks ? s.fetchLinks(u) : fetchOutboundLinks(u)),
    fetchArticle: (u) => s.fetchArticle(u),
  });
  // SCRIPT_ROOM=on, the room's arm: the room writes the Short. Its script meets the fact check, rumour labelling, the
  // air-time words and the house safety checks (one edits-only repair); otherwise the normal writer writes it below.
  let roomRec: RoomRecord | undefined;
  let roomWrote = false;
  if (roomOn) {
    const airsAt = cluster.why?.airs_at ?? ep.slot_at;
    const outlets = cluster.items.map((i) => i.source.toLowerCase());
    const room = await roomWriteStep(
      roomInput(),
      {
        // The house rules that guard facts, money and the render, not the stacked style rules.
        safety: (sc) => [
          ...validateScript(sc, undefined, length).filter((p) => ROOM_SAFETY.test(p)),
          ...absenceProblems(narrationOf(sc)),
          ...preorderProblems(
            narrationOf(sc),
            [...articles.map((a) => a.text), ...cluster.items.map((i) => `${i.title} ${i.summary}`)].join("\n"),
          ),
          ...(s.cfg.shortLabelsClean ? cardFigureProblems(sc.beats) : []),
          ...releaseDateProblems(publicText(sc)),
          ...videoPlugProblems(narrationOf(sc)),
          ...sc.beats
            .filter(
              (b) =>
                b.visual.kind === "report" &&
                !outlets.some(
                  (o) =>
                    o.includes(b.visual.secondary.toLowerCase().trim()) ||
                    b.visual.secondary.toLowerCase().includes(o),
                ),
            )
            .map((b) => `Report card names "${b.visual.secondary}", which is not one of this story's sources.`),
        ],
        factCheck: (sc) => factCheck(s.llm, sc, cluster, articles, storeData, undefined, vaultNote(sc)),
        airTime: (sc) => (airsAt ? airTimeProblems(publicText(sc), new Date(airsAt)) : []),
        ...(newsVault
          ? { settle: (sc: Script, blockers: string[]) => newsVault.settle(sc, blockers, ep.id, "room") }
          : {}),
        ...(s.cfg.creditScrub
          ? {
              scrub: (sc: Script) =>
                scrubScriptCredits(
                  sc,
                  givenSources({
                    outlets: [
                      ...cluster.items.map((i) => i.source),
                      ...articles.map((a) => a.via),
                      storeData ? "Steam" : undefined,
                    ],
                    vault: newsVault?.brief,
                  }),
                ).script,
            }
          : {}),
      },
      roomSkipped(s.cfg, { pulseCheck, skeleton: !!skeleton }),
    ).catch((err) => {
      log("warn", "writers' room failed; the normal writer writes the Short", { episode: ep.id, error: errorMessage(err) });
      return {
        record: roomRecord({ arm: "room", mode: "on", fallback: `the room failed: ${errorMessage(err)}`.slice(0, 300), wrote: false }),
        script: undefined,
        check: undefined,
        warnings: undefined,
      };
    });
    roomRec = room.record;
    if (room.script && room.check) {
      script = room.script;
      check = room.check;
      roomWrote = true;
      if (room.warnings?.length)
        await logEvent(s.db, ep.id, "style_warnings", { problems: room.warnings, room: true }).catch(() => undefined);
    }
  }
  // WRITER_SPLIT (src/editorial/authorship.ts): Claude for the Shorts most likely to travel, Codex for the rest. The
  // writer is recorded on the script either way, from the model calls the main draft made.
  const split = s.cfg.writerSplit
    ? writerSplit({
        maxSeconds: length?.seconds.max,
        strongFandom: strongFandom({ title: cluster.headline, game: cluster.gameHint }),
        serial: isSerial(series),
      })
    : undefined;
  const writerCalls: UsageLine[] = [];
  if (!roomWrote)
  for (let attempt = 0; attempt < 2; attempt++) {
    script = await captureCalls(writerCalls, () => withRoute(split?.route, async () => writeScript(s.llm, cluster, articles, {
      // The credit rule reaches every Short writer, also when the vault had nothing on the game (it lived only in the
      // vault's brief until 14 Nov 2026, so most invented-credit drops were stories the vault knew nothing about).
      vault: newsVault?.brief || CREDIT_RULE,
      desk: s.cfg.deskShare > 0,
      variantNote,
      // YouTube's lessons, then how the same Shorts did on Instagram, Facebook, Threads and TikTok.
      lessons: [
        await hookLessons(s.db, s.now(), segmentInputs).catch(() => ""),
        await socialLessons(
          s.db,
          s.now(),
          loopLessonLines(s.cfg, s.now()),
        ).catch(() => ""),
        playbook,
      ]
        .filter(Boolean)
        .join("\n\n"),
      mustLabelRumour,
      feedback,
      storeData,
      recent,
      draft: attempt > 0 ? script : undefined,
      segment: pulseCheck,
      noSeriesFollow: s.cfg.shortEndPayoff,
      skeleton,
      dropAngle: drop,
      length,
      ...(payoffGated ? { payoff: true } : {}),
      ...(deskPlanned ? { deskPlan: true } : {}),
      // The search lane and a reply Short each write on their own step, so CODEX_CALLS can route them.
      ...(cluster.search
        ? { site: SEARCH_WRITE_SITE }
        : cluster.reply
          ? { site: "reply.write" }
          : {}),
    })));
    // LEARN_HOOKS (src/learn/breadth.ts): 4 to 6 hooks from distinct angle briefs in one call, refused when they break a
    // house rule the draft kept or read like the last 30 hooks, scored and clarity-judged; the winner is fact-checked
    // below like every other word. A plain news Short's first draft only; never a holdout Short.
    if (
      attempt === 0 &&
      !holdout &&
      s.cfg.learn.hooks !== "off" &&
      !cluster.why &&
      !cluster.run &&
      !cluster.reply &&
      !cluster.search &&
      !cluster.gtaFile
    )
      script = await pickHook(s, ep, script, {
        rules: variantNote,
        recentHooks: recentTexts.map((t) => t.hook).filter(Boolean),
        problemsWith: (sc) => houseProblems(sc).problems.length,
      });
    // A search Short keeps the searcher's words in its title: a title that drops them gives way to the planned one.
    if (cluster.search)
      script = {
        ...script,
        youtube: {
          ...script.youtube,
          title: searchTitleFor(script.youtube.title, cluster.search, cluster.gameHint ?? ""),
        },
      };
    // A GTA File part's title follows the plan's pattern whatever the writer gave: "GTA VI File #7: [claim]".
    if (cluster.gtaFile)
      script = {
        ...script,
        youtube: {
          ...script.youtube,
          title: gtaFileTitle(cluster.gtaFile.part, script.youtube.title),
        },
      };
    // CREDIT_SCRUB (src/editorial/credits.ts): a credit to an outlet or document the writer was not given comes off
    // before the fact check, which drops a Short for it; the fact stays.
    if (s.cfg.creditScrub) {
      const scrubbed = scrubScriptCredits(
        script,
        givenSources({
          outlets: [
            ...cluster.items.map((i) => i.source),
            ...articles.map((a) => a.via),
            storeData ? "Steam" : undefined,
          ],
          vault: newsVault?.brief,
        }),
      );
      if (scrubbed.removed.length) {
        script = scrubbed.script;
        await logEvent(s.db, ep.id, "credits_scrubbed", { attempt, removed: scrubbed.removed });
      }
    }
    // SCRIPT_DESK: the writer's own answer said whether the story can carry a Short. Under "fix" a killed story takes the
    // thin route before its fact check is paid for (a big story still goes out, with a note); "check" only records it.
    if (deskPlanned && attempt === 0 && !deskKilled) {
      const k = deskKill(script.desk_plan, script.payoff);
      if (k) {
        deskKilled = { ...k, acted: deskFix, ...(cluster.bigStory ? { big_story: true } : {}) };
        await logEvent(s.db, ep.id, "desk_kill", { ...deskKilled }).catch(() => undefined);
        if (deskFix && !cluster.bigStory) {
          await markSeen(s.db, cluster.hash, cluster.headline, "rejected", "too thin");
          await transition(s.db, ep.id, "selected", "rejected", {
            script_json: {
              ...script,
              desk: deskRecord({ arm: "desk", mode: "fix", plan: script.desk_plan, kill: deskKilled }),
            },
            last_error: `too thin: editor's desk: ${k.why}`,
          });
          await s.notify({
            level: "info",
            content: `Dropped as too thin, the slot goes to the next story: "${cluster.headline}". The editor's desk: ${k.why}`.slice(0, 900),
          });
          return;
        }
        if (deskFix)
          await s.notify({
            level: "info",
            content: `Big story "${cluster.headline}" can't carry a Short by the editor's desk but is going out, since big stories are always made: ${k.why}`.slice(0, 900),
          });
      }
    }
    const { problems, thin } = houseProblems(script);
    check = await factCheck(
      s.llm,
      script,
      cluster,
      articles,
      storeData,
      cluster.search ? SEARCH_CHECK_SITE : undefined,
      vaultNote(script),
    );
    const blockers = check.issues
      .filter((i) => i.severity === "blocker")
      .map((i) => `Fact-check: "${i.quote}" - ${i.problem}`);
    // A time word must be true when the Short goes public (a pre-made Short airs days after it is written).
    const airsAt = cluster.why?.airs_at ?? ep.slot_at;
    if (airsAt) blockers.push(...airTimeProblems(publicText(script), new Date(airsAt)));
    // FACT_VAULT=enforce: blockers the vault supports pass and ones it contradicts take its value; the rest stand.
    if (newsVault && blockers.length) {
      const settled = await newsVault.settle(script, blockers, ep.id, `news attempt ${attempt}`);
      if (settled.remaining.length < blockers.length) {
        script = settled.script;
        blockers.splice(0, blockers.length, ...settled.remaining);
        if (!blockers.length && check.verdict === "fail")
          check = {
            ...check,
            verdict: "pass",
            issues: check.issues.filter((i) => i.severity !== "blocker"),
            summary: `${check.summary} (The Pulse Fact Vault settled every blocker.)`,
          };
      }
    }
    // A line that repeats a claim our fact check already rejected goes back to the writer (FACT_VAULT=read and above).
    if (newsVault) problems.push(...newsVault.warnings([narrationOf(script)]));
    // SHORT_PAYOFF_GATE=fix: the first draft's title, first-frame text and hook read cold (the one model step); what
    // gives the answer away, or leaves the subject unclear, goes back to the writer with the rest.
    if (payoffFix && attempt === 0 && script.payoff) {
      const draft = script;
      const read = await readPayoff(s.llm, {
        title: draft.youtube.title,
        firstFrame: firstFrameText(draft),
        hook: draft.hook,
        question: draft.payoff!.question,
        answer: draft.payoff!.answer,
      }).catch((err) => {
        log("warn", "payoff cold read failed; the draft goes on unread", { episode: ep.id, error: errorMessage(err) });
        return undefined;
      });
      if (read) problems.push(...payoffFeedback(readFindings(read)));
    }
    const factsPassed = check.verdict === "pass" && check.rumour_labelling_ok && blockers.length === 0;
    if (factsPassed && problems.length === 0) break;
    feedback = [
      ...blockers,
      ...problems,
      ...(check.rumour_labelling_ok ? [] : ["Rumour labelling is inadequate."]),
    ];
    // A first draft whose facts passed and that went back only for the held-answer rules is kept: if the rewrite then
    // fails its fact check, this draft goes out instead, so the gate never costs a story its slot.
    if (attempt === 0 && payoffFix) {
      payoffSentBack.push(...problems.filter((p) => p.startsWith("Held answer: ")));
      if (
        factsPassed &&
        problems.every((p) => p.startsWith("Held answer: ")) &&
        !problems.some((p) => p.includes(ABSENCE_PROBLEM))
      )
        // The facts passed, so its verdict is "pass" (the vault's override widens the inferred type to string).
        payoffFallback = { script, check: { ...check, verdict: "pass" as const } };
    }
    if (
      attempt === 1 &&
      payoffFallback &&
      (check.verdict === "fail" || blockers.length > 0 || !check.rumour_labelling_ok)
    ) {
      await logEvent(s.db, ep.id, "payoff_gate_fallback", {
        why: feedback.slice(0, 6),
      }).catch(() => undefined);
      script = payoffFallback.script;
      check = payoffFallback.check;
      break;
    }
    if (attempt === 1) {
      // House-style misses alone are accepted with a warning; facts are not.
      if (
        check.verdict === "fail" ||
        blockers.length > 0 ||
        !check.rumour_labelling_ok
      ) {
        await markSeen(
          s.db,
          cluster.hash,
          cluster.headline,
          "rejected",
          "failed fact-check",
        );
        await transition(s.db, ep.id, "selected", "rejected", {
          script_json: script,
          factcheck_json: check,
          last_error: feedback.join(" | "),
        });
        log("info", "story dropped: failed fact-check twice", {
          episode: ep.id,
          headline: cluster.headline,
          problems: feedback.slice(0, 4),
        });
        await s.notify({
          level: "info",
          embeds: [
            {
              title: `🛑 Dropped: ${cluster.headline}`,
              description: `Failed fact-check twice.\n${feedback
                .slice(0, 6)
                .map((f) => `• ${f}`)
                .join("\n")}`,
              color: COLOURS.warn,
            },
          ],
        });
        return;
      }
      await logEvent(s.db, ep.id, "style_warnings", { problems });
      // Thin after a rewrite: nothing to watch for. A big story is the channel's duty to cover, so it goes on and the
      // owner is told why it reads thin; anything else gives its slot to the next story, and he is told that too.
      if (thin.length) {
        await logEvent(s.db, ep.id, "thin_story", {
          big: !!cluster.bigStory,
          why: thin,
        });
        if (cluster.bigStory) {
          await s.notify({
            level: "info",
            content: `Big story "${cluster.headline}" reads thin but is going out, since big stories are always made: ${thin.join(" ").slice(0, 500)}`,
          });
        } else {
          await markSeen(
            s.db,
            cluster.hash,
            cluster.headline,
            "rejected",
            "too thin",
          );
          await transition(s.db, ep.id, "selected", "rejected", {
            script_json: script,
            factcheck_json: check,
            last_error: `too thin: ${thin.join(" | ")}`,
          });
          await s.notify({
            level: "info",
            content: `Dropped as too thin, the slot goes to the next story: "${cluster.headline}". ${thin.join(" ").slice(0, 500)}`,
          });
          return;
        }
      }
    }
  }
  if (!script || !check) throw new Error("script step produced nothing");
  // The friend pass (FRIEND_PASS): with the facts settled, one rewrite of the delivery, kept only when nothing
  // factual moved, no house rule newly breaks and the fact check passes it again.
  if (
    !roomWrote &&
    friendPassOn(s.cfg, "shorts") &&
    check.verdict === "pass" &&
    check.rumour_labelling_ok &&
    !check.issues.some((i) => i.severity === "blocker")
  ) {
    const before = script;
    const beforeProblems = houseProblems(before).problems;
    let afterCheck: typeof check | undefined;
    const friend = await friendPass({
      before,
      write: () =>
        friendShort(s.llm, before, {
          tier: s.cfg.friendPassTier,
          segment: pulseCheck,
          endStatement: s.cfg.shortEndPayoff,
          recent,
          wordsMin: length?.wordsMin ?? WORDS_MIN,
          wordsMax: length?.wordsMax ?? WORDS_MAX,
        }),
      guard: (after) => [
        ...friendShortProblems(before, after, {
          wordsMin: length?.wordsMin ?? WORDS_MIN,
          wordsMax: length?.wordsMax ?? WORDS_MAX,
        }),
        ...newProblems(beforeProblems, houseProblems(after).problems),
      ],
      // Judged on what the pass changed: a blocker on a line the settled check already passed doesn't count.
      check: async (after) => {
        const v = friendCheckVerdict(
          await factCheck(s.llm, after, cluster, articles, storeData, undefined, vaultNote(after)),
          shortSettledText(before),
        );
        afterCheck = v.check;
        return v.blockers;
      },
    });
    if (friend.kept && afterCheck) {
      script = friend.value;
      check = afterCheck;
      // The friend pass speaks more like a friend; a search Short's title still carries the searcher's words.
      if (cluster.search)
        script = {
          ...script,
          youtube: {
            ...script.youtube,
            title: searchTitleFor(script.youtube.title, cluster.search, cluster.gameHint ?? ""),
          },
        };
    }
    await logEvent(s.db, ep.id, "friend_pass", {
      kept: friend.kept,
      why: friend.why.slice(0, 6),
      before: shortText(before),
      ...(friend.kept ? { tags: (script.voice_tags ?? []).length } : {}),
    }).catch(() => undefined);
  }
  // The clarity gate (CLARITY_GATE, src/editorial/clarity.ts): a judge reads the settled Short cold. Flagged lines get a
  // plain rewrite; under CLARITY_MIN the writer revises once first. Each version is kept only when no fact moved, no
  // house rule newly breaks and the fact check passes it, so the worst case is the script as it was.
  if (
    !roomWrote &&
    friendPassOn({ friendPass: s.cfg.clarityGate }, "shorts") &&
    check.verdict === "pass" &&
    check.rumour_labelling_ok &&
    !check.issues.some((i) => i.severity === "blocker")
  ) {
    const wordsLimits = {
      wordsMin: length?.wordsMin ?? WORDS_MIN,
      wordsMax: length?.wordsMax ?? WORDS_MAX,
    };
    let gateCheck: typeof check | undefined;
    const settled = script;
    const accept = async (before: Script, after: Script): Promise<string[]> => {
      const guard = [
        ...clarityShortProblems(before, after, wordsLimits),
        ...newProblems(houseProblems(before).problems, houseProblems(after).problems),
      ];
      if (guard.length) return guard;
      const v = friendCheckVerdict(
        await factCheck(s.llm, after, cluster, articles, storeData, undefined, vaultNote(after)),
        shortSettledText(before),
      );
      const airsAt = cluster.why?.airs_at ?? ep.slot_at;
      const late = airsAt ? airTimeProblems(publicText(after), new Date(airsAt)) : [];
      if (v.blockers.length || late.length) return [...v.blockers, ...late];
      gateCheck = v.check;
      return [];
    };
    const clarity = await clarityGate<Script>({
      value: settled,
      min: s.cfg.clarityMin,
      judge: (v) =>
        judgeClarity(s.llm, {
          lines: shortLines(v),
          intended: v.point,
          title: v.youtube.title,
        }),
      writer: async (v, notes) =>
        writeScript(s.llm, cluster, articles, {
          desk: s.cfg.deskShare > 0,
          variantNote,
          mustLabelRumour,
          feedback: notes,
          storeData,
          recent,
          draft: v,
          segment: pulseCheck,
          noSeriesFollow: s.cfg.shortEndPayoff,
          skeleton,
          dropAngle: drop,
          length,
          ...(payoffGated ? { payoff: true } : {}),
          ...(deskPlanned ? { deskPlan: true } : {}),
          ...(cluster.search
            ? { site: SEARCH_WRITE_SITE }
            : cluster.reply
              ? { site: "reply.write" }
              : {}),
        }),
      rewrite: (v, j, plain) =>
        clarityRewriteShort(s.llm, v, j, {
          plain,
          min: s.cfg.clarityMin,
          wordsMax: wordsLimits.wordsMax,
          // SHORT_PAYOFF_GATE: a plainer hook still plants the question; the answer stays where the writer held it.
          ...(payoffGated && v.payoff ? { extra: [payoffKeepNote(v.payoff)] } : {}),
        }),
      accept,
    });
    if (clarity.value !== settled && gateCheck) {
      script = clarity.value;
      check = gateCheck;
      if (cluster.search)
        script = {
          ...script,
          youtube: {
            ...script.youtube,
            title: searchTitleFor(script.youtube.title, cluster.search, cluster.gameHint ?? ""),
          },
        };
    }
    await logEvent(s.db, ep.id, "clarity_gate", {
      ...clarityLog(clarity),
      kept: script !== settled,
      before_text: shortText(settled),
    }).catch(() => undefined);
  }
  // The editor's desk (SCRIPT_DESK, src/editorial/desk.ts): an editor reads the settled Short as a viewer meets it
  // (title, first-frame text, narration; never the plan or the sources) and scores it. "fix" on the desk's arm: under
  // the bar, one instruction a round (the biggest weakness) through the edit-based reviser, the fact guard, the house
  // rules (the payoff gate's included) and the fact check, then a fresh read; the best version that passed is kept.
  // "check" and the control arm: one read, recorded, nothing changed. The record goes on the script at the end.
  let deskRec: DeskRecord | undefined;
  if (deskArmOf) {
    const factsOk =
      check.verdict === "pass" &&
      check.rumour_labelling_ok &&
      !check.issues.some((i) => i.severity === "blocker");
    const wordsLimits = {
      wordsMin: length?.wordsMin ?? WORDS_MIN,
      wordsMax: length?.wordsMax ?? WORDS_MAX,
    };
    const airsAt = cluster.why?.airs_at ?? ep.slot_at;
    let deskFactChecks = 0;
    const passedCheck = new Map<Script, typeof check>();
    const loop = await runDesk<Script>({
      value: script,
      // A room script is read and recorded, never rewritten for style.
      mode: deskFix && factsOk && !deskKilled && !roomWrote ? "fix" : "check",
      min: s.cfg.scriptDeskMin,
      rounds: s.cfg.scriptDeskRounds,
      angle: script.desk_plan?.angle,
      judge: (v) =>
        judgeDesk(s.llm, {
          title: v.youtube.title,
          firstFrame: firstFrameText(v),
          narration: deskLines(v),
        }),
      checks: (v) => deskChecks({ lines: deskLines(v), game: v.game_title, segment: pulseCheck }),
      rewrite: async (v, instruction) => ({
        ...v,
        ...(await writeScript(s.llm, cluster, articles, {
          desk: s.cfg.deskShare > 0,
          variantNote,
          mustLabelRumour,
          feedback: [instruction],
          storeData,
          recent,
          draft: v,
          segment: pulseCheck,
          noSeriesFollow: s.cfg.shortEndPayoff,
          skeleton,
          dropAngle: drop,
          length,
          ...(payoffGated ? { payoff: true } : {}),
          ...(deskPlanned ? { deskPlan: true } : {}),
          site: DESK_REWRITE_SITE,
          editsOnly: true,
        })),
      }),
      accept: async (before, after) => {
        const guard = [
          ...deskShortProblems(before, after, wordsLimits),
          ...newProblems(houseProblems(before).problems, houseProblems(after).problems),
        ];
        if (guard.length) return guard;
        deskFactChecks++;
        const v = friendCheckVerdict(
          await factCheck(s.llm, after, cluster, articles, storeData, undefined, vaultNote(after)),
          shortSettledText(before),
        );
        const late = airsAt ? airTimeProblems(publicText(after), new Date(airsAt)) : [];
        if (v.blockers.length || late.length) return [...v.blockers, ...late];
        passedCheck.set(after, v.check);
        return [];
      },
      // SHORT_PAYOFF_GATE: a rewrite keeps the held answer where the writer put it.
      extra: (v) => (payoffGated && v.payoff ? [payoffKeepNote(v.payoff)] : []),
    });
    const keptCheck = passedCheck.get(loop.value);
    if (loop.value !== script && keptCheck) {
      script = loop.value;
      check = keptCheck;
    }
    deskRec = deskRecord({
      arm: deskArmOf,
      mode: s.cfg.scriptDesk === "fix" ? "fix" : "check",
      plan: script.desk_plan,
      kill: deskKilled,
      loop,
      checks: deskFactChecks,
    });
    await logEvent(s.db, ep.id, "script_desk", {
      arm: deskRec.arm,
      mode: deskRec.mode,
      scores: deskRec.rounds.map((r) => r.scores?.overall ?? null),
      kept: deskRec.kept,
      cleared: deskRec.cleared,
      stop: deskRec.stop,
      calls: deskRec.calls,
      ...(deskRec.kill ? { kill: deskRec.kill.kind } : {}),
      ...(deskRec.source_gap ? { source_gap: deskRec.source_gap } : {}),
    }).catch(() => undefined);
  }
  // The humaniser (HUMANISE, src/editorial/humanise): the full name once and the short form after, no repeated openings,
  // contractions, no AI-tell words or em dashes, relative dates against the publish time. Runs last before voicing;
  // the fact check then reads the humanised words, and anything that fails leaves the settled script as it was.
  if (
    s.cfg.humanise !== "off" &&
    check.verdict === "pass" &&
    check.rumour_labelling_ok &&
    !check.issues.some((i) => i.severity === "blocker")
  ) {
    const airsAt = cluster.why?.airs_at ?? ep.slot_at;
    const publishAt = airsAt ? new Date(airsAt) : undefined;
    const wordsLimits = {
      wordsMin: length?.wordsMin ?? WORDS_MIN,
      wordsMax: length?.wordsMax ?? WORDS_MAX,
    };
    let humanCheck: typeof check | undefined;
    const human = await humaniseStep<Script>({
      // A room script is measured and logged, never rewritten for style.
      mode: roomWrote && s.cfg.humanise === "fix" ? "check" : s.cfg.humanise,
      value: script,
      run: (v, mode) => {
        const r = humaniseShort(v, { mode, ...(publishAt ? { publishAt } : {}) });
        return { value: r.script, result: r.result };
      },
      problems: (before, after, removed) => [
        ...humaniseShortProblems(before, after, removed),
        ...newProblems(houseProblems(before).problems, houseProblems(after).problems),
        ...(publishAt ? airTimeProblems(publicText(after), publishAt) : []),
      ],
      rewrite: (v, notes) =>
        friendShort(s.llm, v, {
          tier: s.cfg.friendPassTier,
          segment: pulseCheck,
          endStatement: s.cfg.shortEndPayoff,
          recent,
          ...wordsLimits,
          humanNotes: notes,
          site: "humanise.rewrite",
        }),
      ...(friendPassOn({ friendPass: s.cfg.clarityGate }, "shorts")
        ? {
            clear: async (v: Script) =>
              (
                await judgeClarity(s.llm, {
                  lines: shortLines(v),
                  intended: v.point,
                  title: v.youtube.title,
                })
              ).score >= s.cfg.clarityMin,
          }
        : {}),
      check: async (after) => {
        const v = friendCheckVerdict(
          await factCheck(s.llm, after, cluster, articles, storeData, undefined, vaultNote(after)),
          shortSettledText(script!),
        );
        humanCheck = v.check;
        return v.blockers;
      },
    });
    if (human.stage !== "settled" && humanCheck) {
      script = human.value;
      check = humanCheck;
    }
    await logEvent(s.db, ep.id, "humanise", human.log).catch(() => undefined);
  }
  // RUMOUR_SHARE=0 (format redesign plan item 2) stops rumour Shorts the same way.
  if (
    (script.is_rumour || mustLabelRumour) &&
    (!s.cfg.includeRumours || s.cfg.rumourShare <= 0)
  ) {
    log("info", "story dropped: a rumour, and rumours are off", {
      episode: ep.id,
      headline: cluster.headline,
    });
    await markSeen(
      s.db,
      cluster.hash,
      cluster.headline,
      "rejected",
      "rumour while INCLUDE_RUMOURS=false",
    );
    await transition(s.db, ep.id, "selected", "rejected", {
      script_json: script,
      factcheck_json: check,
      last_error: "rumour story; rumours are disabled",
    });
    return;
  }
  // CHARACTER_QUOTES (src/charquotestep.ts): one real line from the game's cutscene, set up and answered by the narrator.
  // A room script keeps its words: no cutscene line is woven into it, unless GAME_SPEECH_DIALOGUE is on (the quote
  // writer keeps every fact and house rule of the beat it touches, and the owner asked for the exchange everywhere).
  if (!roomWrote || s.cfg.gameSpeechDialogue)
    script = await quoteScriptStep(s, ep, script, {
      house: (sc) => houseProblems(sc).problems,
      wordsMax: length?.wordsMax ?? WORDS_MAX,
      capSeconds: length?.capSeconds ?? SHORT_NARRATION_CAP_SECONDS,
      story: cluster.headline,
    });
  else if (s.cfg.characterQuotes)
    await logEvent(s.db, ep.id, "character_quote", { used: false, why: "a room-written script keeps its words" }).catch(
      () => undefined,
    );
  // The series tag (src/series.ts) and the next-part line's arm go on the script: the weekly report reads both.
  const tag = seriesTagFor(ep, script);
  if (tag) script = { ...script, series: tag };
  // Who wrote it (always recorded): the main draft's calls; a room-written script is the room's.
  if (!roomWrote) {
    const site = cluster.search ? SEARCH_WRITE_SITE : cluster.reply ? "reply.write" : "editorial";
    const intended: WriterProvider | undefined =
      split?.route ??
      (s.cfg.codexLlm ? (siteListed(site, s.cfg.codexCalls) ? "codex" : "claude") : "claude");
    script = { ...script, writer: writerRecord(writerCalls, intended, split?.why) };
  }
  if (endingArm) script = { ...script, ending: endingRecord(endingArm, endingForm, script) };
  if (lengthAb && length)
    script = { ...script, length_arm: { arm: lengthAb, band: `${length.seconds.min}-${length.seconds.max}` } };
  if (lineArm)
    script = {
      ...script,
      next_line: {
        arm: lineArm,
        said: !!nextPart && !nextLineProblems(script.loop_line, nextPart).length,
        ...(nextPart ? { part: nextPart.part, day: nextPart.day } : {}),
      },
    };
  // FIRST_SECOND_PANEL (src/panel/firstsecond.ts): the same Shorts the desk covers, split by episode. What a viewer
  // meets in the first second (the first sentence, the first-frame text, the opening picture as planned) read blind:
  // "check" and the control arm, one audience read recorded and nothing changed; "on" for the panel's arm, alternative
  // first-frame texts (and first sentences, never on a room script) from one call, marked blind by the audience and the
  // editor critic, the best kept and the current version winning ties. A new first sentence must pass the house rules
  // and the air-time check unchanged; a failure anywhere leaves the script as it was.
  const firstArm: FirstSecondArm | undefined = firstSecondArmFor(
    s.cfg.firstSecondPanel,
    s.cfg.firstSecondShare,
    ep.id,
    s.cfg.firstSecondPanel !== "off" &&
      payoffApplies({
        lane: ep.lane,
        why: !!cluster.why,
        reply: !!cluster.reply,
        search: !!cluster.search,
        gtaFile: !!cluster.gtaFile,
      }),
  );
  if (firstArm) {
    const before = script;
    const airsAt = cluster.why?.airs_at ?? ep.slot_at;
    const first = await runFirstSecond({
      script,
      narration: narrationOf(script),
      episodeId: ep.id,
      arm: firstArm,
      mode: s.cfg.firstSecondPanel === "on" ? "on" : "check",
      roomWrote,
      deps: {
        viewer: (content) => readFirstViewer(s.llm, content),
        editor: (content) => readFirstEditor(s.llm, content),
        write: (sentences) => writeFirst(s.llm, before, narrationOf(before), sentences),
        accept: (after) => [
          ...newProblems(houseProblems(before).problems, houseProblems(after).problems),
          ...(airsAt ? airTimeProblems(publicText(after), new Date(airsAt)) : []),
        ],
      },
    }).catch((err) => {
      log("warn", "first-second panel failed; the opening stands", { episode: ep.id, error: errorMessage(err) });
      return undefined;
    });
    if (first) {
      script = { ...first.script, first_second: first.record };
      await logEvent(s.db, ep.id, "first_second", firstSecondEvent(first.record)).catch(() => undefined);
    }
  }
  await guardScript(s, ep, script, "after writing");
  // SHORT_PAYOFF_GATE: the finished script measured against the held-answer rules, recorded on it with its arm (the
  // weekly report compares the arms). The gate's arm gets the cold read of title, first frame and hook too; the control
  // arm only the rules that need no plan. Measuring never changes the script.
  if (payoffArmOf) {
    // A room script carries no payoff plan: it is measured on the rules that need none.
    const gated = payoffArmOf === "gate" && !roomWrote;
    const measured = payoffFindings({
      script,
      recentTakes: recent?.scripts?.length ? recent.scripts : recent?.takes,
            exemptOpeners: pulseCheck ? SEGMENT_OPENERS : [],
      endingChecked: false,
      planned: gated,
    });
    const settledScript = script;
    const read: PayoffRead | undefined =
      gated && settledScript.payoff
        ? await readPayoff(s.llm, {
            title: settledScript.youtube.title,
            firstFrame: firstFrameText(settledScript),
            hook: settledScript.hook,
            question: settledScript.payoff.question,
            answer: settledScript.payoff.answer,
          }).catch((err) => {
            log("warn", "payoff cold read failed; recorded without it", { episode: ep.id, error: errorMessage(err) });
            return undefined;
          })
        : undefined;
    const record = payoffRecord({
      arm: payoffArmOf,
      mode: s.cfg.shortPayoffGate === "fix" ? "fix" : "check",
      findings: measured.findings,
      answerAt: measured.answerAt,
      pivot: measured.pivot,
      read,
      sentBack: payoffSentBack,
    });
    script = { ...script, payoff_gate: record };
    await logEvent(s.db, ep.id, "payoff_gate", {
      arm: record.arm,
      mode: record.mode,
      pass: record.pass,
      rules: record.findings.map((f: PayoffFinding) => f.rule),
      findings: record.findings.slice(0, 8).map((f: PayoffFinding) => f.problem),
      answer_at: record.answer_at,
      pivot_at: record.pivot_at,
      sent_back: payoffSentBack.length,
    }).catch(() => undefined);
  }
  // SCRIPT_DESK: the desk's record rides on the script beside payoff_gate (the weekly report reads arm and score).
  if (deskRec) script = { ...script, desk: deskRec };
  // SCRIPT_ROOM: "check" builds the room's pack beside the published script (one call, nothing changed); the control arm
  // is recorded with no call; "on" carries what the room did, or why the normal writer wrote it.
  if (roomArmOf) {
    if (!roomOn)
      roomRec =
        roomArmOf === "room"
          ? await roomCheckStep(roomInput(), script).catch(() => undefined)
          : roomControlRecord(s.cfg.scriptRoom === "on" ? "on" : "check");
    if (roomRec) {
      // The desk's mark on the published script rides beside the room's own critics', so the weekly report compares all three.
      const deskOverall = deskRec?.scores?.overall;
      if (typeof deskOverall === "number") roomRec = { ...roomRec, desk_overall: deskOverall };
      script = { ...script, room: roomRec };
      await logEvent(s.db, ep.id, "script_room", roomEvent(roomRec)).catch(() => undefined);
    }
  }
  // The structure is kept on the script: the next Shorts' writer and the weekly analytics read it.
  if (skeleton && !roomWrote) script = { ...script, skeleton: skeleton.key };
  await transition(s.db, ep.id, "selected", "scripted", {
    script_json: script,
    factcheck_json: check,
    assets_json:
      steam || test
        ? { ...(steam ? { steam } : {}), ...(test ? { test } : {}) }
        : null,
  });
}

/** SCRIPT_ROOM: the house rules from validateScript that guard facts, money and the render (not the stacked style). */
const ROOM_SAFETY =
  /^Banned phrase matched|^A rumour script must attribute|^The stamp|^There must be|card|^On-screen text|^The YouTube title is over|^The on-screen headline is longer|^The Pulse take is empty|^The loop line .* is unfinished/;

/** SCRIPT_ROOM: what a room script skipped or ran record-only, for its record (pure). */
function roomSkipped(cfg: Config, o: { pulseCheck: boolean; skeleton: boolean }): string[] {
  return [
    "take_shape",
    "desk_question",
    "loop_question",
    ...(o.skeleton ? ["skeleton"] : []),
    ...(o.pulseCheck ? ["pulse_check"] : []),
    ...(cfg.voiceTestShare > 0 ? ["voice_test"] : []),
    "growth_test",
    ...(cfg.learn.hooks !== "off" ? ["learn_hooks"] : []),
    ...(friendPassOn(cfg, "shorts") ? ["friend_pass"] : []),
    ...(friendPassOn({ friendPass: cfg.clarityGate }, "shorts") ? ["clarity_gate"] : []),
    ...(cfg.shortPayoffGate === "fix" ? ["payoff_fix (record only)"] : []),
    ...(cfg.scriptDesk === "fix" ? ["desk_fix (record only)"] : []),
    ...(cfg.humanise === "fix" ? ["humanise (record only)"] : []),
    "character_quotes",
  ];
}

/**
 * The rebuilt gameplay Short's voice and cut. Two takes: the question and stake over the attempt, the answer and loop
 * after the outcome, with the game's own sound alone between them. The answer's real length decides whether the
 * ending replays slowed (directTiming), so the picture is cut here.
 */
async function stepVoiceGameplayDirect(s: Services, ep: Episode): Promise<void> {
  const script = ep.script_json!;
  const g = script.gameplay!;
  const d = g.direct!;
  const ref = ep.story_json.gameplay!;
  const clipDir = gameplayDir(s.cfg, ref.id);
  const meta = await readMeta(clipDir);
  if (!meta) throw new FatalError("the gameplay clip is gone from the inbox");
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
  const ctx = speakContext();
  const voice = { id: s.cfg.elevenLabsVoiceId, name: s.cfg.narratorName };
  const question = await s.synthesise(
    speakable([d.hook, d.setup].filter(Boolean).join(" "), ctx),
    path.join(dir, "voice_a.mp3"),
    voice,
    { minWpm: DIRECT_MIN_WPM },
  );
  const answer = await s.synthesise(
    speakable([d.payoff_line, d.loop_line].filter(Boolean).join(" "), ctx),
    path.join(dir, "voice_b.mp3"),
    voice,
    { minWpm: DIRECT_MIN_WPM },
  );
  const timing = directTiming(
    d.seconds,
    d.payoff_at,
    question.durationSeconds,
    answer.durationSeconds,
  );
  const run = promisify(execFile);
  const source = path.join(clipDir, meta.clip.file || "clip.mp4");
  const tone = hdrFilter(
    await run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer", "-of", "csv=p=0", source])
      .then((r) => r.stdout.trim())
      .catch(() => ""),
  );
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-filter_complex",
      directFilter(
        { segments: d.segments, seconds: d.seconds, payoffAt: d.payoff_at },
        {
          tone,
          focusStart: d.focus_start,
          focusPayoff: d.focus_payoff,
          replaySource: timing.replaySource,
        },
      ),
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      path.join(dir, "cut.mp4"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  // The two takes on one clock, padded to the film's length.
  await run(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-i",
      path.join(dir, "voice_a.mp3"),
      "-i",
      path.join(dir, "voice_b.mp3"),
      "-filter_complex",
      `[1]adelay=${Math.round(timing.answerAt * 1000)}:all=1[b];[0][b]amix=inputs=2:normalize=0:duration=longest,apad,atrim=0:${timing.seconds}[out]`,
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      path.join(dir, "voice.mp3"),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const hookWords = d.hook.trim().split(/\s+/).length;
  const hookEnd =
    question.words[Math.min(hookWords, question.words.length) - 1]?.end ?? 0;
  const words = [
    ...question.words,
    ...answer.words.map((w) => ({
      ...w,
      start: w.start + timing.answerAt,
      end: w.end + timing.answerAt,
    })),
  ];
  await logEvent(s.db, ep.id, "voice", {
    provider: question.voice?.provider ?? "unknown",
    id: question.voice?.id,
    name: question.voice?.name,
  });
  await transition(s.db, ep.id, "scripted", "voiced", {
    assets_json: {
      ...(ep.assets_json ?? {}),
      words,
      durationSeconds: timing.seconds,
      clips: [],
      audio: "voice.mp3",
      voice: question.voice,
      cutdown: {
        start: 0,
        end: timing.seconds,
        video: "cut.mp4",
        background: "",
      },
      gameplayShort: {
        hookEnd: Math.round(hookEnd * 100) / 100,
        payoffAt: d.payoff_at,
        answerAt: timing.answerAt,
        voiced: [
          { start: 0, end: question.durationSeconds },
          {
            start: timing.answerAt,
            end: timing.answerAt + answer.durationSeconds,
          },
        ],
      },
    },
  });
}

async function stepVoice(s: Services, ep: Episode): Promise<void> {
  // The last door before any credit is spent, whatever the lane and however the script got here.
  await guardScript(s, ep, ep.script_json, "before the voice");
  if (ep.script_json?.gameplay?.direct) return stepVoiceGameplayDirect(s, ep);
  // A cutdown speaks with the long video's own narration, cut with its section; a gameplay Short keeps the game's sound.
  if (ep.lane === "cutdown" || ep.lane === "gameplay") {
    await transition(s.db, ep.id, "scripted", "voiced");
    return;
  }
  const dir = episodeDir(s.cfg, ep.id);
  await fs.mkdir(dir, { recursive: true });
  // The pictures before the credit: a Short that cannot be pictured is refused before anything is voiced.
  if (
    s.cfg.shortMediaBeforeVoice &&
    ["news", "news_breaking", "free", "evergreen"].includes(ep.lane) &&
    !ep.assets_json?.images
  ) {
    const estSeconds =
      (narrationOf(ep.script_json!).split(/\s+/).filter(Boolean).length / 160) * 60;
    const probe = {
      ...ep,
      assets_json: { ...(ep.assets_json ?? {}), durationSeconds: estSeconds },
    } as Episode;
    const media: Pick<EpisodeAssets, "images" | "clips" | "officialTrailer" | "eraDropped"> & { rich?: boolean } =
      await gatherMedia(s, probe, dir);
    const limit = ep.story_json.bigStory
      ? Math.max(s.cfg.shortPlateMax, s.cfg.shortPlateMaxBig)
      : s.cfg.shortPlateMax;
    // The real planner on evenly spaced stand-in word timings: what the render step will decide, before the credit.
    const estimate = (m: typeof media): number => {
      try {
        const script = ep.script_json!;
        const toks = narrationOf(script).split(/\s+/).filter(Boolean);
        const per = estSeconds / Math.max(1, toks.length);
        const words = toks.map((text, i) => ({
          text,
          start: i * per,
          end: i * per + per * 0.85,
        }));
        const duration = estSeconds + TAIL_SECONDS;
        const plan = buildPlan({
          segments: buildSegments(segmentInputs(script, false), words, duration),
          words,
          durationSeconds: duration,
          images: (m.images ?? []).map((i) => ({
            kind: i.kind,
            aspect: i.aspect,
            beatIndex: i.beatIndex,
            wordy: i.wordy,
            frame: i.frame,
          })),
          clips: (m.clips ?? []).map((c) => ({
            durationSeconds: c.durationSeconds,
            motion: c.motion,
            luma: c.luma,
            beatIndex: c.beatIndex,
            role: c.role,
          })),
          storyType: script.is_rumour ? "rumour" : script.story_type,
          isRumour: script.is_rumour,
          attribution: script.attribution,
          variant: variantOf(ep.id),
          openOnClip: s.cfg.openOnMotion,
          footageFirst: s.cfg.shortFootageFirst,
        });
        return (
          plan.shots
            .filter((x) => x.media.type === "plate")
            .reduce((n, x) => n + x.end - x.start, 0) / plan.totalFrames
        );
      } catch (err) {
        // A check that cannot run never stops a Short: the render step's gate still stands.
        log("warn", "media estimate failed", { error: errorMessage(err) });
        return 0;
      }
    };
    let share = estimate(media);
    if (share > limit) {
      Object.assign(media, await gatherMedia(s, probe, dir, true), { rich: true });
      share = estimate(media);
    }
    await logEvent(s.db, ep.id, "media_before_voice", {
      images: (media.images ?? []).length,
      clips: (media.clips ?? []).length,
      plateEstimate: Math.round(share * 100) / 100,
      limit,
    });
    if (share > limit) {
      const why = `about ${Math.round(share * 100)}% of the Short would be an empty panel${media.eraDropped ? `: the only footage and art are of a later version than the ${ep.script_json?.story_year} game it is about` : ""}`;
      await markSeen(s.db, ep.story_hash, ep.story_json.headline, "rejected", why);
      await transition(s.db, ep.id, "scripted", "rejected", {
        last_error: `not voiced, too little media: ${why}`,
      });
      await s.notify({
        level: "info",
        content: `Dropped before the voice, no credit spent: "${ep.story_json.headline}". ${why}, even after looking for more. The slot goes to the next story.`,
      });
      return;
    }
    ep = { ...ep, assets_json: { ...(ep.assets_json ?? {}), ...media } as Episode["assets_json"] };
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(ep.assets_json),
    ]);
  }
  // CHARACTER_QUOTES (src/charquotestep.ts): each quote's clip is made before the voice, so the voice leaves its exact
  // length; a quote that cannot be played is taken out of the script first, so no setup line points at a silence.
  const quoteClips = await prepareQuotes(s, ep, ep.script_json!, dir);
  if (quoteClips.script !== ep.script_json) ep = { ...ep, script_json: quoteClips.script };
  // Voice rotation: the n-th Short the channel has made picks the n-th voice of the pool, so a few Shorts in a row share a voice and the analytics can say which one sticks.
  const [ord] = await s.db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes WHERE created_at < $1 AND status NOT IN ('failed','rejected')`,
    [ep.created_at],
  );
  // The narrator test: half of news Shorts are narrated by the test voice (Alice), the rest by the usual one.
  const voice = narratorFor(s.cfg, ep) ?? pickVoice(s.cfg, Number(ord?.n ?? 0));
  // A twin reads its figures in its own language (no English number-to-words pass) and only ElevenLabs
  // speaks it: the local clone speaks English.
  const twin = ep.lane === "twin";
  const desk0 = deskFor(
    { ...s.cfg, deskShare: await deskShareNow(s.db, s.cfg) },
    ep,
  );
  // When the desk partner would be the narrator, the usual narrator asks the question instead.
  const desk =
    desk0 && desk0.voice.id === voice.id
      ? { voice: { id: s.cfg.elevenLabsVoiceId, name: s.cfg.narratorName } }
      : desk0;
  // A Short outside the desk test still has a take written as the reply to its question, so the narrator asks
  // it himself. 3 Nov 2026: the GTA 6 pre-load Short said "No. That box holds a download code" to nobody.
  if (!desk && !twin && ep.script_json?.desk_question?.trim()) {
    const sc = ep.script_json;
    sc.pulse_take.narration = `${sc.desk_question!.trim()} ${sc.pulse_take.narration}`;
    delete sc.desk_question;
    await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(sc),
    ]);
  }
  let narration: Awaited<ReturnType<Services["synthesise"]>>;
  if (desk && s.stitchTakes) {
    // The desk experiment: the narrator up to the facts, the desk partner's question in a second voice,
    // the narrator's take and close; three takes stitched onto one timeline.
    const sc = ep.script_json!;
    const ctx = speakContext(sc.say_as); // the same order as segmentInputs, so the timings match the voice
    const partA = speakable(
      [sc.hook, ...sc.beats.map((b) => b.narration)].join(" "),
      ctx,
    );
    const partQ = speakable(sc.desk_question!, ctx);
    const partB = speakable(
      [sc.pulse_take.narration, tidyLoopLine(sc.loop_line)].join(" "),
      ctx,
    );
    const a = await s.synthesise(partA, path.join(dir, "voice_a.mp3"), voice, {
      provider: "elevenlabs",
      ...(s.cfg.shortMinWpm ? { minWpm: s.cfg.shortMinWpm } : {}),
    });
    const q = await s.synthesise(
      partQ,
      path.join(dir, "voice_q.mp3"),
      desk.voice,
      { provider: "elevenlabs" },
    );
    const b = await s.synthesise(partB, path.join(dir, "voice_b.mp3"), voice, {
      provider: "elevenlabs",
      ...(s.cfg.shortMinWpm ? { minWpm: s.cfg.shortMinWpm } : {}),
    });
    const joined = await s.stitchTakes([a, q, b], path.join(dir, "voice.mp3"));
    narration = { ...joined, voice: a.voice };
    await logEvent(s.db, ep.id, "desk", {
      voice: desk.voice.name,
      question: sc.desk_question,
    });
  } else {
    narration = await s.synthesise(
      // The one text that carries the writer's delivery tags: the voice acts them, nothing else sees them.
      twin
        ? twinNarration(ep.script_json!)
        : narrationOf(ep.script_json!, { tags: true }),
      path.join(dir, "voice.mp3"),
      voice,
      twin
        ? { provider: "elevenlabs" }
        : // A test dial, off by default: documentaries keep their natural pace whatever it says.
          s.cfg.longMinWpm && ep.script_json?.evergreen_format === "ranking"
          ? { minWpm: s.cfg.longMinWpm }
          : ep.lane !== "longform" && (s.cfg.shortMinWpm || s.cfg.shortSpeed > 1 || s.cfg.hookTakes > 0)
            ? {
                // SHORT_MIN_WPM lifts a slow take; SHORT_SPEED plays every Short faster (owner's pick, 5 Nov 2026).
                ...(s.cfg.shortMinWpm ? { minWpm: s.cfg.shortMinWpm } : {}),
                ...(s.cfg.shortSpeed > 1 ? { speed: s.cfg.shortSpeed } : {}),
                // HOOK_TAKES: the Short's hook line may be retaken and the best read kept (src/voice/hooktakes.ts).
                ...(s.cfg.hookTakes > 0 ? { hookTakes: true } : {}),
              }
            : undefined,
    );
  }
  await logEvent(s.db, ep.id, "voice", {
    provider: narration.voice?.provider ?? "unknown",
    id: narration.voice?.id,
    name: narration.voice?.name,
  });
  // The voice sometimes stalls mid-sentence: cut those silences to a natural beat, with the word timings shifted to match.
  const tight = await tightenPauses(
    path.join(dir, "voice.mp3"),
    narration.words,
    narration.durationSeconds,
  ).catch((err) => {
    log("warn", "pause tightening failed; keeping the voice as recorded", {
      error: errorMessage(err),
    });
    return undefined;
  });
  if (tight && tight.removedSeconds > 0) {
    narration.words = tight.words;
    narration.durationSeconds = tight.durationSeconds;
    await logEvent(s.db, ep.id, "pauses_tightened", {
      seconds: Math.round(tight.removedSeconds * 10) / 10,
    });
  }
  // SHORT_MIN_SECONDS holds after SHORT_SPEED too (12 Nov 2026: an 87-word news Short came out at 28.5 s at 1.1x):
  // a take the speed-up (or the pause tightening) left under the floor plays back slower, up to the pace it was voiced
  // at and never slower. Still short after that, it goes out as it is: the writer's floor already held.
  const floorSeconds = !twin && FLOOR_LANES.includes(ep.lane) ? s.cfg.shortMinSeconds : 0;
  const back = floorBackFactor(narration.durationSeconds, floorSeconds, s.cfg.shortSpeed);
  if (back < 1) {
    await speedUp(path.join(dir, "voice.mp3"), back);
    narration.words = narration.words.map((w) => ({ ...w, start: w.start / back, end: w.end / back }));
    narration.durationSeconds = narration.durationSeconds / back;
    await logEvent(s.db, ep.id, "short_floor_pace", {
      factor: Math.round(back * 1000) / 1000,
      seconds: Math.round(narration.durationSeconds * 10) / 10,
    });
  }
  // The narration check: what the voice says against its script, before anything is rendered on it.
  // A fault re-voices once; a second one is reported and the episode goes on (a misheard line should
  // not cost a week's long video). Caught the GTA ranking's "Sayus" and drifting timings (23 Oct 2026).
  const check = await (
    twin
      ? undefined
      : s.checkNarration?.(path.join(dir, "voice.mp3"), narration.words)
  )?.catch((err) => {
    log("warn", "narration check unavailable", { error: errorMessage(err) });
    return undefined;
  });
  // What the voice actually said, as much as the script: this fails closed, unlike a misheard word below.
  if (s.cfg.writerNotesGuard) {
    const found = [
      ...writerNoteHits(check?.heard ?? "").map((h) => ({
        ...h,
        where: "the voice as heard",
      })),
      ...releaseWriterNotes({ words: narration.words }),
    ];
    if (found.length)
      await stopForWriterNotes(s, ep, "at the narration check", found);
  }
  // The letter watch (owner, 12 Nov 2026, after "GOTY" was read G-O-T-Y): capitals the voice spelled out that are
  // not said as letters. A spoken form the tables or the script know goes into script_json.say_as and the take is
  // voiced once more; an unknown token read cleanly as letters is logged for the tables and the alert digest.
  if (check?.letters?.length && !twin && ep.script_json) {
    const sc = ep.script_json;
    const plan = pronunciationPlan(check.letters, sc);
    await logEvent(s.db, ep.id, "pronunciation", {
      spelled: check.letters.slice(0, 10),
      say_as: plan.sayAs,
      why: plan.why,
      unknown: plan.unknown.map((u) => u.token),
    });
    if (plan.unknown.length) {
      await recordUnknown(
        unknownFile(s.cfg.dataDir),
        plan.unknown,
        ep.id,
        s.now(),
      ).catch((err) =>
        log("warn", "pronunciation list not written", {
          error: errorMessage(err),
        }),
      );
      const names = [...new Set(plan.unknown.map((u) => u.token))];
      await s.notify({
        content: `🔤 The voice spelled out ${names.map((n) => `"${n}"`).join(", ")} letter by letter in "${sc.headline ?? ep.id}", and the pronunciation tables do not know ${names.length === 1 ? "it" : "them"} yet: logged in data/admin/pronunciation_unknown.json for src/voice/speakable.ts.`,
      });
    }
    const fresh = Object.entries(plan.sayAs).filter(
      ([k, v]) => sc.say_as?.[k] !== v,
    );
    if (fresh.length) {
      sc.say_as = { ...sc.say_as, ...Object.fromEntries(fresh) };
      await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [
        ep.id,
        JSON.stringify(sc),
      ]);
      // A fault like any other: voiced again once, then reported and kept.
      check.ok = false;
      for (const [token, said] of fresh)
        check.issues.push({
          at: check.letters.find((l) => l.token === token)?.at ?? 0,
          meant: token,
          heard: `${token} spelled out letter by letter (next take says "${said}")`,
        });
    }
  }
  if (check) {
    await logEvent(s.db, ep.id, "narration_check", {
      ok: check.ok,
      drift: check.drift,
      matched: Math.round(check.matched * 1000) / 1000,
      issues: check.issues.slice(0, 10),
      pauses: check.pauses.slice(0, 10),
    });
    if (check.pauses.length)
      log("warn", "mid-sentence pauses in the narration", {
        episode: ep.id,
        pauses: check.pauses
          .slice(0, 5)
          .map((p) => `${p.seconds}s between "${p.before}" and "${p.after}"`),
      });
    if (!check.ok) {
      const [prior] = await s.db.query<{ n: string | number }>(
        `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'narration_check' AND detail->>'ok' = 'false'`,
        [ep.id],
      );
      if (Number(prior?.n ?? 0) <= 1)
        throw new Error(
          `narration check failed, voicing again: ${narrationSummary(check)}`,
        );
      log("warn", "narration check failed twice; going on", {
        episode: ep.id,
        problems: narrationSummary(check),
      });
      await s.notify({
        content: `🎙️ The narration for "${ep.script_json?.headline ?? ep.id}" still has a fault after a second take, so it goes ahead: ${narrationSummary(check)}`,
      });
    } else
      log("info", "narration check passed", {
        episode: ep.id,
        drift: check.drift,
      });
  }
  // How the take sounds, measured (owner, 30 Oct 2026: "run tests on everything as you generate it"; the
  // new voice's intakes of breath were "quite off-putting"). Audible breaths are found on the loudness
  // envelope and turned down in place (timings unchanged); a take still breathy after that, or a rushed
  // one, is reported. The old narrator measured 0.3 audible breaths a minute, the new one 6 before this.
  if (!twin) {
    try {
      const file = path.join(dir, "voice.mp3");
      const turned = await turnDownBreaths(file);
      const breath = turned.after;
      const before = turned.before.loudPerMinute;
      const wpm = wordsPerMinute(narration.words);
      const problems = voiceProblems(
        breath,
        wpm,
        ep.lane !== "longform" ? shortWpmMax(s.cfg) : 190,
      );
      await logEvent(s.db, ep.id, "voice_quality", {
        ok: problems.length === 0,
        wpm,
        loudBreathsPerMinute: breath.loudPerMinute,
        loudBreathsBefore: before,
        breathPasses: turned.passes,
        breaths: breath.breaths,
        loudest: breath.loudest,
        problems,
      });
      if (problems.length) {
        log("warn", "voice quality check failed; going on", {
          episode: ep.id,
          problems,
        });
        await s.notify({
          content: `🎙️ The narration for "${ep.script_json?.headline ?? ep.id}" sounds off and goes ahead anyway: ${problems.join("; ")}`,
        });
      } else
        log("info", "voice quality check passed", {
          episode: ep.id,
          wpm,
          loudBreathsPerMinute: breath.loudPerMinute,
          loudBreathsBefore: before,
        });
    } catch (err) {
      log("warn", "voice quality check unavailable", {
        error: errorMessage(err),
      });
    }
  }
  const maxSeconds =
    ep.lane === "evergreen"
      ? s.cfg.evergreenMaxSeconds
      : ep.lane === "longform"
        ? ep.script_json?.evergreen_format === "documentary"
          ? s.cfg.docMaxSeconds
          : s.cfg.longformMaxSeconds
        : // SHORT_LENGTHS and WHY_TARGET_SECONDS: a lane past the minute needs room; every other Short keeps 58 s.
          (shortTarget(lengthsFor(s.cfg, lengthArmFor(s.cfg, ep)), lengthFormatOf(ep))?.capSeconds ??
          SHORT_NARRATION_CAP_SECONDS);
  if (narration.durationSeconds > maxSeconds)
    throw new FatalError(
      `narration is ${narration.durationSeconds.toFixed(1)}s, over the ${maxSeconds}s cap for the ${ep.lane} lane`,
    );
  // CHARACTER_QUOTES: the quotes' silences go into the voice and every later word moves (src/voice/quotegap.ts).
  const opened = await openQuotes(
    s,
    ep,
    ep.script_json!,
    dir,
    { file: path.join(dir, "voice.mp3"), words: narration.words, durationSeconds: narration.durationSeconds },
    quoteClips.prepared,
    maxSeconds,
  );
  if (opened) {
    narration.words = opened.words;
    narration.durationSeconds = opened.durationSeconds;
  }
  // A documentary breathes before each chapter: a few seconds with the narrator silent, the music up
  // and the chapter's title full screen (owner, 27 Oct 2026: "very narrative and word heavy"). Every long
  // video's quiet beats take a breath (31 Oct 2026); only chapter cards get breathers, so a ranking gets none.
  let breaks: EpisodeAssets["breaks"];
  if (
    ep.script_json &&
    (ep.script_json.evergreen_format === "documentary" ||
      ep.lane === "longform") &&
    narration.words.length
  ) {
    try {
      const segs = buildSegments(
        segmentInputs(ep.script_json),
        narration.words,
        narration.durationSeconds,
      );
      const firstWords = segs
        .filter((g) => g.kind === "beat" && g.visual?.kind === "chapter")
        .map((g) => narration.words.findIndex((w) => w.start >= g.start - 0.05))
        .filter((k) => k > 0);
      // The writer's quiet beats take a breath after their sentence too (src/voice/quietbeats.ts).
      const quiet = s.cfg.docSoundBeats
        ? quietBeatGaps(ep.script_json, narration.words, segs)
        : [];
      const gaps = [
        ...chapterGaps(narration.words, firstWords, DOC_BREAK_SECONDS),
        ...quiet,
      ];
      if (gaps.length) {
        await insertSilence(path.join(dir, "voice.mp3"), gaps);
        narration.words = openWords(narration.words, gaps);
        // The quotes and the caption words were timed before the breathers went in: they move with the narration
        // (13 Nov 2026: a quote after one chapter breather played 4 s early, over the narrator, and its own gap stayed silent).
        if (opened) {
          opened.quotes = quotesAfterGaps(opened.quotes ?? [], gaps);
          if (opened.captionWords) opened.captionWords = openWords(opened.captionWords, gaps);
        }
        narration.durationSeconds += gaps.reduce((n, g) => n + g.seconds, 0);
        breaks = gapSpans(gaps)
          .filter((g) => g.kind === "chapter")
          .map((g) => ({ start: g.start, end: g.end }));
        if (quiet.length)
          await logEvent(s.db, ep.id, "quiet_beats", {
            breaths: quiet.length,
            seconds:
              Math.round(quiet.reduce((n, g) => n + g.seconds, 0) * 10) / 10,
        });
      }
    } catch (err) {
      log("warn", "documentary breathers skipped", {
        episode: ep.id,
        error: errorMessage(err),
      });
    }
  }
  await fs.writeFile(
    path.join(dir, "captions.srt"),
    srtFromWords(opened?.captionWords ?? narration.words),
    "utf8",
  );
  const assets: EpisodeAssets = {
    ...(ep.assets_json ?? {}),
    audio: "voice.mp3",
    words: narration.words,
    durationSeconds: narration.durationSeconds,
    srt: "captions.srt",
    voice: narration.voice,
    quotes: opened?.quotes,
    ...(breaks?.length ? { breaks } : {}),
    ...(desk && s.stitchTakes
      ? {
          desk: { voice: desk.voice, question: ep.script_json!.desk_question! },
        }
      : {}),
  };
  await transition(s.db, ep.id, "scripted", "voiced", { assets_json: assets });
}

/**
 * Whether this Short gets the desk partner's question: the experiment is on, the writer gave one, the lane
 * is news, and the episode falls in the experiment's share (by a stable hash of its id, so a re-voice gets
 * the same answer). Returns the partner's voice.
 */
/**
 * The narrator test: on news, breaking and free Shorts, NARRATOR_TEST_SHARE of them (by a stable hash of
 * the episode id, salted so it is independent of the desk test's split) are narrated by the test voice.
 * Returns that voice, or undefined for the usual narrator.
 */
export function narratorFor(
  cfg: Config,
  ep: Pick<Episode, "id" | "lane">,
): { id: string; name: string } | undefined {
  if (!cfg.narratorTestVoiceId || cfg.narratorTestShare <= 0) return undefined;
  if (!["news", "news_breaking", "free"].includes(ep.lane)) return undefined;
  let h = 7;
  for (const c of `narrator:${ep.id}`) h = (h * 131 + c.charCodeAt(0)) >>> 0;
  if (h % 1000 >= cfg.narratorTestShare * 1000) return undefined;
  return { id: cfg.narratorTestVoiceId, name: cfg.narratorTestVoiceName };
}

/**
 * The new-look test (owner, 27 Oct 2026: "a huge channel overhaul"): SHORT_SUITE_SHARE of Shorts (by a
 * stable hash of the episode id, salted so it is independent of the other tests) get the editor's dressing.
 * The Spanish twin copies its source and is left out.
 */
export function suiteFor(
  cfg: Config,
  ep: Pick<Episode, "id" | "lane">,
): boolean {
  if (cfg.shortSuiteShare <= 0 || ep.lane === "twin") return false;
  let h = 11;
  for (const c of `suite:${ep.id}`) h = (h * 137 + c.charCodeAt(0)) >>> 0;
  return h % 1000 < cfg.shortSuiteShare * 1000;
}

export function deskFor(
  cfg: Config,
  ep: Pick<Episode, "id" | "lane" | "script_json">,
): { voice: { id: string; name: string } } | undefined {
  if (!cfg.deskVoiceId || cfg.deskShare <= 0) return undefined;
  if (!ep.script_json?.desk_question?.trim()) return undefined;
  if (!["news", "news_breaking", "free"].includes(ep.lane)) return undefined;
  let h = 0;
  for (const c of ep.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  if (h % 1000 >= cfg.deskShare * 1000) return undefined;
  return { voice: { id: cfg.deskVoiceId, name: cfg.deskVoiceName } };
}

/** Clips kept within each capped publisher's total for one Short (src/assets/officialTrailer.ts PUBLISHER_CHANNELS). */
export function capPublisherTotal<T extends { provenance: string; durationSeconds: number; beatIndex?: number }>(clips: T[]): T[] {
  const used = new Map<string, number>();
  const order = [...clips].sort(
    (a, b) =>
      Number(b.beatIndex === undefined) - Number(a.beatIndex === undefined) ||
      (b.beatIndex ?? 0) - (a.beatIndex ?? 0),
  );
  const keep = new Set<T>();
  for (const c of order) {
    const rule = PUBLISHER_CHANNELS.find((r) => c.provenance.includes(`publisher: ${r.name}`));
    if (!rule) {
      keep.add(c);
      continue;
    }
    const sofar = used.get(rule.name) ?? 0;
    if (sofar + c.durationSeconds > rule.clipSeconds) continue;
    used.set(rule.name, sofar + c.durationSeconds);
    keep.add(c);
  }
  return clips.filter((c) => keep.has(c));
}

/** The game's name for picture searches: a writer's "(Switch 2 remake)" hides an exact title match. */
export function mediaTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "").trim() || title;
}

export async function gatherMedia(
  s: Services,
  ep: Episode,
  dir: string,
  /** The second pass after a red media rubric: more screenshots and clips so the plan can vary. */
  rich = false,
): Promise<
  Pick<EpisodeAssets, "images" | "clips" | "officialTrailer" | "eraDropped">
> {
  const script = ep.script_json!;
  // The gather's time budget (GATHER_MAX_MINUTES, src/assets/gatherbudget.ts): past it the entry loop below
  // stops with what it has; and a long video yields the lane early to an urgent one (a slot within hours,
  // still unscripted) rather than keep it waiting behind hours of downloads (30 Oct 2026, the missed recap).
  // A Short's slot is 75 to 120 minutes off: its gather gets its own, shorter limit.
  const gatherBudget = new GatherBudget(ep.lane === "longform" ? s.cfg.gatherMaxMinutes : Math.min(s.cfg.gatherMaxMinutes, s.cfg.shortGatherMaxMinutes), async () => {
    if (ep.lane !== "longform") return undefined;
    const other = (await dueEpisodes(s.db, s.now())).find(
      (e) => e.id !== ep.id && isLongEpisode(e) && isUrgentLong(e, s.now()),
    );
    return other
      ? `"${other.script_json?.headline ?? other.story_json.headline}" is due within ${LONG_URGENT_HOURS} hours and still unscripted`
      : undefined;
  });
  let budgetReported = false;
  // Prefer the exact store name resolved at script time so art and clips come from the same app as the facts.
  // An every-game Short has no topic page: a series' name finds a remaster or its newest game on the store, and
  // each beat brings its own game's pictures (src/everygamestep.ts).
  const term = script.every_game
    ? ""
    : ep.assets_json?.steam?.name ||
    script.steam_search_term ||
    script.game_title ||
    ep.story_json.gameHint ||
    "";
  const app = term ? await s.findGame(term).catch(() => undefined) : undefined;
  const art = app
    ? await s.fetchArt(app, dir, rich ? 8 : 4).catch(() => [] as VisualAsset[])
    : [];
  // Official trailer B-roll: short muted clips, at most MAX_TRAILER_CLIPS.
  // Beat-matched trailer moments: the hook and each beat ask for what they name.
  // A ranking Short's entries bring their own moments; the topic's page supplies only the hook moment.
  const ranking = Boolean(script.entries?.length);
  const topicTargets = ranking
    ? targetsFor(script).filter((t) => t.key === "hook")
    : targetsFor(script);
  // Footage first on a Short: past one moment per line, more clean moments up to this much of the narration.
  const shortFill =
    ep.lane !== "longform" && s.cfg.shortFootageFirst
      ? {
          seconds: ranking
            ? 0
            : ((ep.assets_json?.durationSeconds ?? 45) *
                s.cfg.shortFootageShare) /
              100,
          textCheck: s.cfg.shortClipTextCheck,
        }
      : undefined;
  const clipAssets =
    app && s.cfg.footage && s.cfg.maxClips > 0 && topicTargets.length
      ? await s
          .fetchClips(
            app,
            dir,
            topicTargets,
            ranking ? 1 : s.cfg.maxClips + (rich ? 2 : 0),
            undefined,
            shortFill,
          )
          .catch((err) => {
            log("warn", "trailer clips failed", {
              episode: ep.id,
              error: errorMessage(err),
            });
            return [] as VisualAsset[];
          })
      : [];
  // Per-publisher footage budget (Rockstar: about 6 s per Short). Clips beyond it are dropped, in order.
  const narrationSeconds = ep.assets_json?.durationSeconds ?? 45;
  // Not on Steam (GTA VI, Nintendo titles): the publisher's own YouTube trailer stands in, under that publisher's cap.
  // A picture story: the publisher's own video of it comes first, whether or not the game is on Steam.
  const pictureStory = ep.story_json.visualNeed === "real_world_images";
  const storyAfter = new Date(
    new Date(ep.story_json.newestAt ?? s.now().toISOString()).getTime() -
      7 * 86_400_000,
  );
  // Footage first: a Steam page whose trailers gave well under the target also tries the publisher's own trailer.
  const steamSeconds = clipAssets.reduce(
    (n, c) => n + (c.durationSeconds ?? 0),
    0,
  );
  const steamShort =
    !ranking && !!shortFill?.seconds && steamSeconds < shortFill.seconds * 0.6;
  const official: OfficialMedia =
    // The publisher's own YouTube trailer: for games not on Steam, picture stories, and Steam pages with no
    // usable trailer (Metal Gear Solid matched an old bundle whose one video would not download, 25 Oct 2026).
    (pictureStory || !app || clipAssets.length < 2 || steamShort) &&
    s.cfg.footage &&
    !script.every_game &&
    script.game_title
      ? await s
          .fetchOfficialMedia(
            mediaTitle(script.game_title),
            dir,
            topicTargets,
            ranking ? 1 : s.cfg.maxClips,
            "",
            pictureStory
              ? {
                  text: `${ep.story_json.headline} ${script.headline}`,
                  after: storyAfter,
                }
              : undefined,
            shortFill
              ? {
                  ...shortFill,
                  seconds: Math.max(0, (shortFill.seconds ?? 0) - steamSeconds),
                }
              : undefined,
          )
          .catch((err) => {
            log("warn", "official trailer media failed", {
              episode: ep.id,
              error: errorMessage(err),
            });
            return { clips: [], stills: [] } as OfficialMedia;
          })
      : { clips: [], stills: [] };
  if (official.trailer)
    await logEvent(s.db, ep.id, "official_trailer", {
      videoId: official.trailer.videoId,
      publisher: official.trailer.publisher,
      title: official.trailer.title,
      clips: official.clips.length,
      still: official.stills.length > 0,
    });
  const steamBudget = app
    ? Math.max(
        footageBudgetSeconds(app),
        clipAssets.length < 2 ? (official.trailer?.clipSeconds ?? 0) : 0,
      )
    : (official.trailer?.clipSeconds ?? 0);
  // Up to 85% of the narration may run on footage (the owner raised the cap, 24 Oct 2026); this line held
  // it at 40% after the publisher budget was raised, so Shorts stayed at about a third footage.
  const budget = Math.min(steamBudget, Math.max(10, narrationSeconds * 0.85));
  const clips: NonNullable<EpisodeAssets["clips"]> = capFootage(
    official.storyVideo || !app
      ? official.clips
      : clipAssets.length < 2 || steamShort
        ? [...clipAssets, ...official.clips]
        : clipAssets,
    budget,
    3.4,
    s.cfg.shortFootageFirst,
  ).map((c) => ({
    file: c.file,
    sourceUrl: c.sourceUrl,
    provenance: c.provenance,
    durationSeconds: c.durationSeconds ?? 3.4,
    beatIndex: c.beatIndex,
    role: c.role,
    motion: c.motion,
    luma: c.luma,
    label: c.label,
    reason: c.reason,
    startSeconds: c.startSeconds,
    stock: c.stock,
  }));
  // A GTA File part (src/gtafile.ts) opens on the owner's own gameplay when the inbox holds a clip of the game.
  const gtaPart = ep.story_json.gtaFile;
  // A search Short (src/searchq) opens on the owner's own footage of its game the same way: owner footage first.
  const searchOwn = ep.story_json.search?.ownFootage
    ? ep.story_json.gameHint ?? script.game_title
    : undefined;
  const ownOpen = gtaPart?.ownFootage
    ? { franchise: gtaPart.franchise, aliases: GTA_FILE_ALIASES, event: "gta_file_own_footage", part: gtaPart.part as number | undefined }
    : searchOwn
      ? { franchise: searchOwn, aliases: gameAliases(searchOwn), event: "search_own_footage", part: undefined }
      : undefined;
  if (ownOpen && s.cfg.footage) {
    const hook = targetsFor(script).find((t) => t.key === "hook") ?? {
      key: "hook",
      text: script.hook,
      want: "gameplay" as const,
      energy: "high" as const,
      keywords: [],
    };
    // The game as the inbox's reviewer named it, so the library finds the same clip the selection saw.
    const clipGame = s.cfg.gameplayRoot
      ? franchiseClip(
          { aliases: ownOpen.aliases },
          await inboxFiles(s.cfg.gameplayRoot).catch(() => []),
        )?.game
      : undefined;
    const [own] = await s
      .ownClips(
        clipGame || script.game_title || ownOpen.franchise,
        ownOpen.franchise,
        dir,
        [hook],
        1,
      )
      .catch(() => [] as VisualAsset[]);
    if (own) {
      clips.splice(
        0,
        clips.length,
        ...openOnOwnClip(clips, {
          file: own.file,
          sourceUrl: own.sourceUrl,
          provenance: own.provenance,
          durationSeconds: Math.min(own.durationSeconds ?? 4, 8),
          motion: own.motion,
          luma: own.luma,
          label: own.label,
          reason: own.reason,
          startSeconds: own.startSeconds,
          audio: own.audio,
        }),
      );
      await logEvent(s.db, ep.id, ownOpen.event, {
        ...(ownOpen.part !== undefined ? { part: ownOpen.part } : {}),
        clip: own.provenance,
      });
    } else
      log("info", "no own clip to open on", {
        episode: ep.id,
        franchise: ownOpen.franchise,
        ...(ownOpen.part !== undefined ? { part: ownOpen.part } : {}),
      });
  }
  // Licensed stock for the real-world lines of a picture story that has no publisher video of it.
  if (pictureStory && !official.storyVideo) {
    // Every fact line can carry an illustrative shot: quiet lines show it in the framed panel under their card.
    const realLines = targetsFor(script).filter((t) =>
      t.key.startsWith("beat:"),
    );
    const stock = await s
      .fetchStock(
        dir,
        realLines,
        script.game_title.split(/\s+/),
        Math.min(3, realLines.length),
      )
      .catch((err) => {
        log("warn", "stock footage failed", {
          episode: ep.id,
          error: errorMessage(err),
        });
        return [] as VisualAsset[];
      });
    for (const c of stock)
      clips.push({
        file: c.file,
        sourceUrl: c.sourceUrl,
        provenance: c.provenance,
        durationSeconds: c.durationSeconds ?? 4,
        beatIndex: c.beatIndex,
        role: undefined,
        motion: 0.5,
        luma: undefined,
        label: c.label,
        reason: c.reason,
        startSeconds: 0,
        stock: true,
      });
  }
  if (clips.length < clipAssets.length)
    log("info", "footage capped", {
      episode: ep.id,
      budgetSeconds: budget,
      dropped: clipAssets.length - clips.length,
    });
  // Off Steam (GTA VI, Nintendo, console exclusives): IGDB's official stills for the story's game.
  const igdb =
    !app && !ranking && script.game_title
      ? await s
          .igdbArt(mediaTitle(script.game_title), undefined, dir, 8)
          .catch(() => [] as VisualAsset[])
      : [];
  // In a ranking, the topic page's screenshots would land under the wrong entry: keep its hero and header only.
  const images = [
    ...igdb,
    ...art.filter(
      (a) =>
        a.kind !== "logo" &&
        (!ranking || a.kind === "hero" || a.kind === "header"),
    ),
    ...official.stills,
  ];
  // Trailer frames in hand (OFFICIAL_STILL_FRAMES): the thumbnail, with its logos, is no longer needed, and an IGDB
  // entry years older than today is the old game of a remake, kept for the words about the old game (thenWindows).
  if (official.stills.length >= 4) {
    const nowYear = s.now().getUTCFullYear();
    for (const a of igdb) {
      const y = Number(a.provenance.match(/\((\d{4})\)/)?.[1]);
      if (y && y <= nowYear - 5) a.then = true;
    }
    const thumb = images.findIndex((a) => a.file.endsWith("official_trailer.jpg"));
    if (thumb >= 0) images.splice(thumb, 1);
    // The picture editor puts the pool on the lines it shows (the ocarina on "hum its songs"), and each frame is
    // cropped on its subject for the vertical screen. Neither stops the Short if it fails.
    const frames = official.stills.filter((a) => !a.file.endsWith("official_trailer.jpg"));
    const clauses = (text: string) =>
      text
        .split(/(?<=[,.;?!])\s+/)
        .reduce<string[]>((out, c) => {
          // A short tail stays with the clause before it: it would be under a shot's length.
          if (out.length && c.split(/\s+/).length < 3) out[out.length - 1] += ` ${c}`;
          else out.push(c);
          return out;
        }, []);
    // One target for each clause of a line, in order, so a line with two ideas cuts to two pictures.
    const targets = targetsFor(script)
      .filter((t) => t.key === "hook" || t.key.startsWith("beat:"))
      .flatMap((t) => {
        const parts = clauses(t.text);
        return parts.map((sentence, k) => ({
          key: `${t.key}#${k}`,
          // The writer's keywords describe the whole line; a clause of it asks for what it says itself.
          show:
            t.key === "hook"
              ? "the most striking picture of the main character: large in the frame, face visible, easy to read on a phone"
              : parts.length > 1
                ? "exactly what this clause says"
                : [t.want, ...t.keywords].join(", "),
          sentence,
        }));
      });
    clauses(script.pulse_take.narration).forEach((sentence, k) =>
      targets.push({ key: `take#${k}`, show: "what the line says", sentence }),
    );
    const order = new Map<VisualAsset, number>();
    try {
      const ranked = await rankStills(
        s.llm,
        targets,
        frames.map((a) => ({ file: path.join(dir, a.file) })),
        path.join(dir, "stillscore"),
        undefined,
        "frames",
      );
      for (const p of ranked.picks) {
        const a = frames[p.image]!;
        a.label = p.label;
        const [line, clause] = p.key.split("#");
        order.set(a, targets.findIndex((t) => t.key === p.key));
        a.forWords = targets.find((t) => t.key === p.key)?.sentence;
        if (line === "hook") {
          a.role = "hook";
          a.beatIndex = undefined;
        } else if (line!.startsWith("beat:")) {
          a.role = undefined;
          a.beatIndex = Number(line!.slice(5));
        }
        else a.beatIndex = undefined;
        void clause;
      }
      for (const [i, x] of ranked.focus?.entries() ?? [])
        if (frames[i]) frames[i]!.focusX = x;
      // A frame with no clear subject (spray, fog) shows nothing once it is cropped tall.
      if (ranked.focus?.size)
        for (const [i, a] of frames.entries())
          if (!ranked.focus.has(i) && !order.has(a) && images.includes(a) && images.length > 12)
            images.splice(images.indexOf(a), 1);
      for (const i of ranked.withText) {
        const at = images.indexOf(frames[i]!);
        if (at >= 0 && images.length > 12) images.splice(at, 1);
      }
    } catch (err) {
      log("warn", "trailer frames not ranked", { episode: ep.id, error: errorMessage(err) });
    }
    await fs.rm(path.join(dir, "stillscore"), { recursive: true, force: true }).catch(() => undefined);
    // The frames the editor chose lead, in the order of the lines, ahead of the moments and the pool.
    images.sort((x, y) => (order.get(x) ?? 999) - (order.get(y) ?? 999));
  }
  // First-party newsroom images (PlayStation Blog, Xbox Wire) are press
  // material meant for coverage. Outlet images are never used.
  {
    const official = ep.story_json.items.filter(
      (i) => i.sourceKind === "official",
    );
    let k = 0;
    for (const item of official) {
      // A newsroom post's whole gallery (Rockstar Newswire), else its one share image.
      const article =
        item.imageUrl && !/rockstargames\.com/.test(item.url)
          ? undefined
          : await s.fetchArticle(item.url);
      const urls = [
        ...new Set(
          [item.imageUrl, ...(article?.images ?? []), article?.ogImage].filter(
            (u): u is string => Boolean(u),
          ),
        ),
      ].slice(0, 6);
      for (const og of urls) {
        const file = path.join("assets", `official_${k}.jpg`);
        await fs.mkdir(path.join(dir, "assets"), { recursive: true });
        if (await s.downloadImage(og, path.join(dir, file))) {
          images.push({
            kind: "article",
            file,
            sourceUrl: og,
            provenance: `Official press image from ${item.source} (${item.url})`,
          });
          k++;
        }
      }
    }
  }
  // Publishers' press pictures of the story's game (src/assets/press.ts, LIBRARY_PRESS): an announcement's key
  // art and screenshots from Xbox Wire, the PlayStation Blog and the other press sites, credited on screen.
  if (!ranking && script.game_title)
    images.push(
      ...(await pressForShort(
        {
          searchPress: s.searchPress && ((g) => s.searchPress!(g)),
          downloadPhoto: (i, d) => s.downloadPhoto(i, d),
        },
        dir,
        script.game_title,
        new Set(images.map((i) => i.sourceUrl)),
      )),
    );
  // Last, and only for what the published art leaves blank: frames of a tight-cap publisher's own trailer (Rockstar).
  if (
    !ranking &&
    s.cfg.shortCappedStills > 0 &&
    s.trailerFrames &&
    official.trailer &&
    official.trailer.clipSeconds > 0 &&
    official.trailer.clipSeconds <= TIGHT_CAP_SECONDS
  ) {
    const count = framesNeeded(
      narrationSeconds,
      clips.reduce((n, c) => n + c.durationSeconds, 0),
      images.filter((i) => !i.file.endsWith("official_trailer.jpg")).length,
      s.cfg.shortCappedStills,
    );
    if (count > 0) {
      const frames = await s
        .trailerFrames(official.trailer, dir, script.game_title, count, s.cfg.shortClipTextCheck)
        .catch((err) => {
          log("warn", "trailer frames failed", { error: errorMessage(err) });
          return [] as VisualAsset[];
        });
      images.push(...frames);
      await logEvent(s.db, ep.id, "trailer_frames", { wanted: count, used: frames.length });
    }
  }
  // Cutscenes are a separate opt-in and share the remaining budget with the footage already gathered.
  // LONG_INDEX_FIRST (13 Nov 2026): a long video's chapters whose game has a scene index gather from the game's own
  // movie first, before its trailers and generic gameplay below (the retrospective's chapter allowance was being
  // spent on trailers first); the other chapters gather here after them, as before.
  const cutscenesDone = new Set<number>();
  const gatherCutscenes = async (indexedOnly: boolean): Promise<void> => {
    if (!(s.cfg.cutsceneFootage && s.fetchCutscenes && !gatherBudget.over())) return;
      const jobs: CutsceneJob[] = [];
      // A retrospective (src/retrospective.ts): each chapter its own footage allowance, scaled from the publisher's
      // per-Short cap, and a story chapter's lines looked for only inside its act of the scene index, in order.
      const retroT = isRetrospective(ep.factcheck_json)
        ? (ep.factcheck_json as unknown as { topic: DocTopic }).topic.retro
        : undefined;
      // LONG_CHAPTER_FOOTAGE: any long video's chapters get their own allowance the same way (longChapterFootageCaps).
      const retroCaps = retroT
        ? retroFootageCaps(s.cfg, script, script.game_title)
        : s.cfg.longChapterFootage && isLongEpisode(ep) && script.entries?.length
          ? longChapterFootageCaps(s.cfg, script)
          : [];
      const perChapter = retroCaps.length > 0;
      const retroSpans = retroT ? retroFootageSpans(retroT, retroT.written ?? []) : [];
      // RETRO_REMASTER_FOOTAGE: the reception and legacy chapters may take the remaster's footage, credited as such.
      const remasterOk = retroT && s.cfg.retroRemasterFootage ? retroRemasterChapters(retroT, retroT.written ?? []) : [];
      if (script.entries?.length) {
        const entries = [...script.entries].sort((a, b) => b.rank - a.rank);
        for (const [beatIndex, entry] of entries.entries()) {
          if (!entry.game_title || entry.year > s.now().getFullYear() ||
              (script.evergreen_format === "documentary" && upcomingGame(entry.year, s.now(), entry.game_title, readLaunches(s.cfg.launchCalendarFile)))) continue;
          // LONG_INDEX_FIRST: the first pass takes the scene index's clips alone, for the chapters whose game has one;
          // the second pass searches cutscene uploads for those chapters' lines the index left (after the trailers
          // and gameplay, so the slow search never spends the gather's time first) and does the rest as before.
          const indexedBefore = cutscenesDone.has(beatIndex);
          const recent = entry.year >= s.now().getFullYear() - 1 || Boolean(remasterOk[beatIndex]);
          if (indexedOnly && !(s.cfg.sceneIndex && (await hasUsableIndex(s.cfg.dataDir, entry.game_title, recent)))) continue;
          if (indexedOnly) cutscenesDone.add(beatIndex);
          const eapp = await steamAppForEntry(s, entry).catch(() => undefined);
          const shots = docShotTargets(entry, chapterSentences(script, beatIndex), beatIndex);
          const want = script.beats[beatIndex]?.footage;
          const targets: FootageTarget[] = shots.length ? shots : want?.want === "none" ? [] : [{
            key: `beat:${beatIndex}`, text: script.beats[beatIndex]?.narration ?? entry.game_title,
            want: want?.want ?? "cinematic", energy: "medium", keywords: want?.keywords ?? [entry.game_title],
          }];
          const span = retroSpans[beatIndex];
          const allPlaced = span
            ? targets.map((t, k) => ({ ...t, within: { ...span, at: targets.length > 1 ? k / (targets.length - 1) : 0.5 } }))
            : targets;
          // The search pass after an index pass: only the lines the index found no clip for.
          const filled = new Set(
            clips.filter((c) => c.beatIndex === beatIndex && /^Cutscenes for "/.test(c.provenance))
              .map((c) => `beat:${beatIndex}${c.moment === undefined ? "" : `#m${c.moment}`}`),
          );
          const placed = indexedBefore ? allPlaced.filter((t) => !filled.has(t.key)) : allPlaced;
          if (!placed.length) continue;
          jobs.push({ gameTitle: entry.game_title,
            ...(indexedOnly ? { mode: "index" as const } : indexedBefore ? { mode: "search" as const } : {}), recentRelease: entry.year >= s.now().getFullYear() - 1 || Boolean(remasterOk[beatIndex]), episodeDir: path.join(dir, `entry_${beatIndex}`),
            // LONG_MOVING_FIRST: a retrospective's chapter may carry a clip for every line, not 24 at most.
            ...(retroT && s.cfg.longMovingFirst ? { maxClips: Math.min(RETRO_MOVING_CLIPS, Math.max(24, targets.length)) } : {}),
            pathPrefix: `entry_${beatIndex}`, beatIndex, targets: placed,
            publisherNames: [...(eapp?.details?.publishers ?? []), ...(eapp?.details?.developers ?? [])],
            ...(perChapter ? { ownSeconds: retroCaps[beatIndex] ?? 0 } : {}) });
        }
      } else if (script.game_title && !indexedOnly) {
        jobs.push({ gameTitle: script.game_title, episodeDir: dir, targets: topicTargets,
          // A Short about the remake says so; then the remake's cutscenes are the right ones, not the original's.
          recentRelease: /\b(remake|remaster(?:ed)?|reimagined)\b/i.test([script.headline, script.hook, ...script.beats.map((b) => b.narration)].join(" ")),
          publisherNames: [...(app?.details?.publishers ?? []), ...(app?.details?.developers ?? []), ...(official.trailer ? [official.trailer.publisher] : [])] });
      }
      if (!jobs.length) return;
      const added = await gatherCutsceneSources({
        enabled: true,
        videoLimit: perChapter
          ? retroCaps.reduce((n, x) => n + x, 0)
          : isLongEpisode(ep) ? cutsceneBudgetSeconds(s.cfg.cutsceneMaxSeconds, narrationSeconds) : s.cfg.cutsceneMaxSeconds,
        jobs, existing: clips, shouldStop: () => gatherBudget.over(),
        // Stream recordings (the owner's own, then permitted channels') fill up to 85% of the narration on their own
        // allowance, outside every publisher's cap (owner, 25 Nov 2026).
        ...(s.cfg.semantic?.vodTags ? { streamSeconds: Math.max(10, narrationSeconds * 0.85) } : {}),
        fetch: (job) => s.fetchCutscenes!({ gameTitle: job.gameTitle, recentRelease: job.recentRelease, episodeDir: job.episodeDir,
          targets: job.targets, maxClips: Math.min(job.maxClips ?? 24, Math.max(job.targets.length, Math.ceil(job.maxSeconds / 4.8))),
          maxSeconds: job.maxSeconds, publisher: job.publisher, ...(job.mode ? { mode: job.mode } : {}),
          ...(job.ownMaxSeconds !== undefined ? { ownMaxSeconds: job.ownMaxSeconds } : {}),
          // A weekly guide never shows late story, warning or not (src/longguide.ts).
          long: isLongEpisode(ep), spoilerWarned: !isWeeklyGuide(ep.factcheck_json) && !isGtaGuide(ep.factcheck_json) && hasSpoilerWarning([script.hook, script.beats[0]?.narration]) }),
      });
      clips.push(
        ...added.map((c) => {
          // A remaster's footage in a chapter that allows it says which edition it is, on screen and in the record.
          const edition = c.beatIndex !== undefined && remasterOk[c.beatIndex] ? editionOf(c.youtubeSource?.title ?? "") : undefined;
          const game = jobs.find((j) => j.beatIndex === c.beatIndex)?.gameTitle ?? script.game_title;
          return {
            ...c,
            durationSeconds: c.durationSeconds ?? 4.8,
            ...(edition
              ? { credit: `${edition} FOOTAGE: ${game.toUpperCase().slice(0, 40)} / YOUTUBE`, provenance: `${c.provenance}, ${edition.toLowerCase()} footage` }
              : {}),
          };
        }),
      );
      // SCENE_MATCH: a stills-only publisher's game (Nintendo) plays no cutscene, so each named moment comes as a
      // checked still of that exact scene, on the name as it is said. A Short about one game only.
      const job = jobs.length === 1 && !script.entries?.length && !indexedOnly ? jobs[0] : undefined;
      if (s.cfg.sceneMatch && s.fetchSceneStills && job && cutscenePublisher(job.gameTitle, job.publisherNames).seconds === 0) {
        const stills = await s
          .fetchSceneStills({ gameTitle: job.gameTitle, recentRelease: job.recentRelease, episodeDir: dir, targets: job.targets,
            max: job.targets.length, long: isLongEpisode(ep), spoilerWarned: hasSpoilerWarning([script.hook, script.beats[0]?.narration]) })
          .catch((err) => {
            log("warn", "scene stills failed", { episode: ep.id, error: errorMessage(err) });
            return [] as VisualAsset[];
          });
        if (stills.length) await logEvent(s.db, ep.id, "scene_stills", { count: stills.length, lines: stills.map((a) => a.reason) });
        images.push(...stills);
      }
  };
  if (s.cfg.longIndexFirst && isLongEpisode(ep) && script.entries?.length) await gatherCutscenes(true);
  // Ranking Shorts: each entry brings its own box art and one trailer moment, tagged with its line.
  if (script.entries?.length) {
    const sorted = [...script.entries].sort((a, b) => b.rank - a.rank);
    for (const [beatIndex, entry] of sorted.entries()) {
      // Footage first on a Short: the entries share the publisher's budget, a few clean moments each.
      const entryFill =
        shortFill && ep.lane !== "longform" && gatherBudget.elapsedMinutes() < s.cfg.shortGatherMaxMinutes / 2
          ? { ...shortFill, seconds: defaultFootageSeconds() / Math.max(1, sorted.length) }
          : undefined;
      // An achievement's own icon is its card's box art (Steam community assets, official).
      if (entry.icon) {
        const file = path.join(
          `entry_${beatIndex}`,
          "assets",
          "achievement_icon.jpg",
        );
        await fs.mkdir(path.join(dir, `entry_${beatIndex}`, "assets"), {
          recursive: true,
        });
        if (
          await s
            .downloadImage(entry.icon, path.join(dir, file))
            .catch(() => false)
        )
          images.push({
            kind: "capsule",
            file,
            sourceUrl: entry.icon,
            provenance: `Steam achievement icon for "${entry.game_title}" (${entry.platforms})`,
            beatIndex,
          });
      }
      try {
        // Out of time, or an urgent long video waiting for the lane: this and the entries after it get no
        // gather of their own (the thin-entry top-up and the plate cover them), reported once.
        if (await gatherBudget.exhausted()) {
          if (!budgetReported) {
            budgetReported = true;
            await reportGatherStop(
              s.db,
              (m) => s.notify(m),
              ep,
              gatherBudget,
              sorted.length - beatIndex,
            );
          }
          continue;
        }
        // A long-form entry with a shot list: a picture for every sentence.
        if (
          ep.lane === "longform" &&
          entry.moments?.length &&
          script.evergreen_format !== "documentary"
        ) {
          await gatherBudget.within(
            gatherLongEntryMedia(
            s,
            script,
            entry,
            beatIndex,
            dir,
            images,
            clips,
              gatherBudget,
            ),
            undefined,
          );
          continue;
        }
        // A recap chapter reuses its Short's media, already picked and passed by QA.
        if (
          entry.from_episode &&
          (await copyShortMedia(
            s,
            entry.from_episode,
            beatIndex,
            dir,
            images,
            clips,
          ))
        )
          continue;
        // A documentary chapter runs minutes: its own gallery, matched footage and archive photos.
        if (script.evergreen_format === "documentary") {
          await gatherBudget.within(
            gatherChapterMedia(
            s,
            script,
            entry,
            beatIndex,
            dir,
            images,
            clips,
              gatherBudget,
              // A weekly guide is the owner's own play: his recordings are asked for every target (GUIDE_OWN_FIRST);
              // a retrospective asks them first too (RETRO_OWN_FIRST).
              {
                ownFirst:
                  (s.cfg.guideOwnFirst && isWeeklyGuide(ep.factcheck_json)) ||
                  (s.cfg.retroOwnFirst && isRetrospective(ep.factcheck_json)),
              },
            ),
            undefined,
          );
          continue;
        }
        // An every-game beat: that game's own era and nothing else (src/everygamestep.ts).
        if (script.every_game) {
          await gatherBudget.within(
            gatherEveryGameEntry(s, script, entry, beatIndex, dir, images, clips),
            undefined,
          );
          continue;
        }
        // An empty Steam term means the writer knows the game is not on Steam: straight to the publisher's trailer.
        const eapp = await steamAppForEntry(s, entry);
        if (!eapp) {
          if (!s.cfg.footage) continue;
          const want = script.beats[beatIndex]?.footage;
          const edir = path.join(dir, `entry_${beatIndex}`);
          const om = await s.fetchOfficialMedia(
            entry.game_title,
            edir,
            [
              {
                key: `beat:${beatIndex}`,
                text: entry.game_title,
                want: want?.want ?? "gameplay",
                energy: "medium",
                keywords: want?.keywords ?? [entry.game_title],
              },
            ],
            1,
            entry.year ? String(entry.year) : "",
            undefined,
            entryFill,
          );
          for (const a of om.stills)
            images.push({
              ...a,
              file: path.join(`entry_${beatIndex}`, a.file),
              beatIndex,
            });
          // Off Steam, IGDB supplies the box art and stills the card and shots need.
          for (const a of await s
            .igdbArt(entry.game_title, entry.year, edir, 3)
            .catch(() => [] as VisualAsset[]))
            images.push({
              ...a,
              file: path.join(`entry_${beatIndex}`, a.file),
              beatIndex,
            });
          for (const c of capFootage(om.clips, om.trailer?.clipSeconds ?? 0))
            clips.push({
              file: path.join(`entry_${beatIndex}`, c.file),
              sourceUrl: c.sourceUrl,
              provenance: c.provenance,
              durationSeconds: Math.min(
                c.durationSeconds ?? 4,
                entryFill?.seconds ? 4.8 : 4,
              ),
              beatIndex,
              role: undefined,
              motion: c.motion,
              luma: c.luma,
              label: c.label,
              reason: c.reason,
              startSeconds: c.startSeconds,
            });
          continue;
        }
        const doc = (script.evergreen_format as string) === "documentary"; // documentaries take gatherChapterMedia above
        // A documentary chapter runs minutes, not seconds: it needs the game's whole gallery.
        // A Short's entry keeps its hero, its box art and three screenshots: when the trailer yields no
        // usable moment (pixel art reads as text, dark games fail the luma floor) the line still cuts.
        let screens = 0;
        const art = (
          await s.fetchArt(eapp, path.join(dir, `entry_${beatIndex}`))
        ).filter((a) =>
          doc
            ? a.kind !== "logo"
            : (a.kind === "capsule" && !entry.icon) ||
              a.kind === "hero" ||
              // A new release often has no hero art yet: its store header is the last-resort still.
              a.kind === "header" ||
              (a.kind === "screenshot" && screens++ < (rich ? 6 : 3)),
        );
        for (const a of art)
          images.push({
            ...a,
            file: path.join(`entry_${beatIndex}`, a.file),
            beatIndex,
          });
        const want = doc
          ? chapterFootage(script, beatIndex)[0]
          : script.beats[beatIndex]?.footage;
        const long = ep.lane === "longform";
        const perEntry = doc
          ? Math.max(1, s.cfg.docClipsPerChapter)
          : long
            ? Math.max(1, s.cfg.longformClipsPerEntry)
            : 1;
        const entryTargets: FootageTarget[] = [
          {
            key: `beat:${beatIndex}`,
            text: entry.game_title,
            want: want?.want ?? "gameplay",
            energy: "medium",
            keywords: want?.keywords ?? [entry.game_title],
          },
        ];
        // A documentary chapter asks for the moments its paragraphs name.
        if (doc)
          for (const [k, f] of chapterFootage(script, beatIndex)
            .slice(1, perEntry)
            .entries())
            entryTargets.push({
              key: `beat:${beatIndex}#${k + 2}`,
              text: `${entry.game_title}: ${f.keywords.join(", ")}`,
              want: f.want,
              energy: "medium",
              keywords: [entry.game_title, ...f.keywords].slice(0, 4),
            });
        // A long entry runs 30-45 s: a second, different moment keeps it moving.
        else if (perEntry > 1)
          entryTargets.push({
            key: `beat:${beatIndex}#2`,
            text: `${entry.game_title}, a different moment`,
            want: want?.want === "gameplay" ? "cinematic" : "gameplay",
            energy: "medium",
            keywords: [entry.game_title, "gameplay"],
          });
        const fetched = await s.fetchClips(
          eapp,
          path.join(dir, `entry_${beatIndex}`),
          entryTargets,
          perEntry,
          undefined,
          entryFill,
        );
        // Footage stays subordinate: a documentary chapter gets the same publisher budget a Short does.
        const got = doc
          ? capFootage(fetched, footageBudgetSeconds(eapp), 4.8)
          : fetched;
        for (const c of got)
          clips.push({
            file: path.join(`entry_${beatIndex}`, c.file),
            sourceUrl: c.sourceUrl,
            provenance: c.provenance,
            durationSeconds: Math.min(
              c.durationSeconds ?? 4,
              long || entryFill?.seconds ? 4.8 : 4,
            ),
            beatIndex,
            role: undefined,
            motion: c.motion,
            luma: c.luma,
            label: c.label,
            reason: c.reason,
            startSeconds: c.startSeconds,
          });
      } catch (err) {
        log("warn", "entry media failed", {
          game: entry.game_title,
          error: errorMessage(err),
        });
      }
    }
  }
  // A Short about an older release shows that release: the store page and the publisher's trailer are of its later
  // remake, so they go (a line that names the later version keeps its own clip) and IGDB's stills of the right year
  // come in. Owner's rule, 5 Nov 2026: 2012 pictures over the 2005 story are a failure, better caught before the voice.
  let eraDropped = false;
  const storeDate = app?.details?.release_date?.date as string | undefined;
  if (
    s.cfg.shortEraMatch &&
    !ranking &&
    ep.lane !== "longform" &&
    eraConflict(script.story_year, storeDate)
  ) {
    eraDropped = true;
    const keptClips = clips.filter(
      (c) =>
        c.beatIndex !== undefined &&
        lineNamesLaterVersion(script.beats[c.beatIndex]?.narration, storeDate),
    );
    const lateArt = new Set([...art, ...official.stills].map((a) => a.file));
    const before = { clips: clips.length, images: images.length };
    clips.splice(0, clips.length, ...keptClips);
    images.splice(
      0,
      images.length,
      ...images.filter((a) => !lateArt.has(a.file)),
    );
    for (const a of await s
      .igdbArt(mediaTitle(script.game_title), script.story_year, dir, rich ? 12 : 8)
      .catch(() => [] as VisualAsset[])) {
      const y = Number(a.provenance.match(/\((\d{4})\)/)?.[1]);
      if (!y || Math.abs(y - script.story_year!) <= 2) images.push(a);
    }
    await logEvent(s.db, ep.id, "era_match", {
      story: script.story_year,
      store: storeDate,
      before,
      after: { clips: clips.length, images: images.length },
    });
  }
  // SCENE_INDEX: every game a video is about gets its scene index built in the background (src/sceneindex/job.ts).
  if (s.cfg.sceneIndex) void requestSceneIndexes(s.cfg, gamesOfScript(script, s.now()), "a video about it");
  // The cutscene pass for the chapters the index-first pass left (gatherCutscenes above).
  await gatherCutscenes(false);
  // A story about a person shows the person: a freely licensed photo from Wikimedia Commons,
  // credited on screen, on the first line that names them (else wherever a still is needed).
  if (script.person?.trim())
    await personPhoto(s, ep, dir, script.person.trim(), images);
  // GAME_LIBRARY (src/assets/shortlibrary.ts): every sentence gets the best-fitting scene and still from the game it is
  // about (a comparison's sentence from the other game), picked by what the library's vision tags say each shows and
  // pushed away from what the game's last ten Shorts showed; the title's subject leads as the hero and the thumbnail.
  let library: ShortLibraryMedia | undefined;
  if (s.cfg.gameLibrary && !ranking && !script.every_game && ep.lane !== "longform" && script.game_title) {
    library = await shortLibraryMedia({
      dataDir: s.cfg.dataDir,
      episodeId: ep.id,
      episodeDir: dir,
      script,
      maxClipSeconds: Math.max(10, narrationSeconds * 0.85),
    });
    // The library's per-sentence scenes replace the trailer matcher's picks from the same site trailers, so one trailer
    // moment never shows twice; footage from anywhere else stays.
    if (library.clips.length >= 2) {
      const siteCut = clips.filter((c) => c.provenance.includes("own site ("));
      if (siteCut.length) clips.splice(0, clips.length, ...clips.filter((c) => !siteCut.includes(c)));
    }
    clips.push(...library.clips);
    images.push(...library.images);
    if (library.picks)
      await logEvent(s.db, ep.id, "game_library", {
        games: library.games,
        clips: library.clips.length,
        images: library.images.length,
        compared: comparedGames(script),
        footageExists: library.footageExists,
      });
  }
  // No hardware or merchandise in a game story (15 Nov 2026: a PlayStation controller opened a Short about roads and
  // sat in its thumbnail): press pictures of controllers, consoles, boxes, editions and merch go, unless the story is
  // about that hardware itself.
  // A hardware story still never shows one maker's hardware on a line about the other's (18 Nov 2026: a PlayStation
  // controller sat on "using Xbox Series S settings" in the Xbox cloud Short), nor on a line naming no platform.
  if (hardwareStory(script)) {
    const ps = /\b(playstation|ps[345]|dualsense|ps portal)\b/i;
    const xb = /\b(xbox|series [xs]|game pass)\b/i;
    const wrong = images.filter((a) => {
      if (!isHardwareAsset(a)) return false;
      const what = [a.provenance, a.sourceUrl, a.file, a.label].filter(Boolean).join(" ").replace(/[-_/]+/g, " ");
      const line = a.forWords ?? "";
      if (ps.test(what) && !ps.test(line)) return true;
      if (xb.test(what) && !xb.test(line)) return true;
      return false;
    });
    if (wrong.length) {
      images.splice(0, images.length, ...images.filter((a) => !wrong.includes(a)));
      await logEvent(s.db, ep.id, "hardware_dropped", { files: wrong.map((a) => a.file), why: "platform not on its line" });
    }
  }
  if (!hardwareStory(script)) {
    const dropped = images.filter((a) => isHardwareAsset(a));
    if (dropped.length) {
      images.splice(0, images.length, ...images.filter((a) => !isHardwareAsset(a)));
      await logEvent(s.db, ep.id, "hardware_dropped", { files: dropped.map((a) => a.file) });
    }
  }
  // Screenshots get the same local screen as clip frames: a webcam or gore is never used, and
  // one with menu or HUD text across it ("SET V'S APPEARANCE") is used only after the clean ones.
  // Key art and article images are screened for text only: one with the game's logo printed
  // across it should not open the Short under the headline (QA notes, 26 Oct 2026: the
  // headline collided with the FINAL FANTASY VII REMAKE INTERGRADE logo on frame 1).
  const shots = images.filter(
    (a) => a.kind === "screenshot" || a.kind === "hero" || a.kind === "article",
  );
  const flags = shots.length
    ? await screenFrames(shots.map((a) => path.join(dir, a.file))).catch(
        () => [],
      )
    : [];
  const unusable = new Set<string>();
  const wordy = new Set<string>();
  for (const [k, f] of flags.entries()) {
    if (!f) continue;
    // A press picture is screened like a screenshot: a webcam or gore is never used.
    if (
      (f.webcam || f.gore) &&
      (shots[k]!.kind === "screenshot" || isPressProvenance(shots[k]!.provenance))
    )
      unusable.add(shots[k]!.file);
    // FOOTAGE_AD_SCREEN: anything suggestive fails the final check whatever the picture's kind.
    else if (f.suggestive) unusable.add(shots[k]!.file);
    else if (f.text) wordy.add(shots[k]!.file);
  }
  if (unusable.size || wordy.size)
    log("info", "screenshots screened", {
      episode: ep.id,
      dropped: unusable.size,
      wordy: wordy.size,
    });
  const out: NonNullable<EpisodeAssets["images"]> = [];
  for (const a of images) {
    if (unusable.has(a.file)) continue;
    out.push({
      file: a.file,
      kind: a.kind,
      sourceUrl: a.sourceUrl,
      provenance: a.provenance,
      aspect: await s.imageAspect(path.join(dir, a.file)),
      beatIndex: a.beatIndex,
      moment: a.moment,
      label: a.label,
      ...(wordy.has(a.file) ? { wordy: true } : {}),
      ...(a.then ? { then: true } : {}),
      ...(a.frame ? { frame: true } : {}),
      ...(a.focusX !== undefined ? { focusX: a.focusX } : {}),
      ...(a.forWords ? { forWords: a.forWords } : {}),
      ...(a.role ? { role: a.role } : {}),
      // LONG_NAMED_ART: the character the picture shows travels with it to the planner.
      ...(a.named ? { named: a.named } : {}),
      ...((a as { libKey?: string }).libKey ? { libKey: (a as { libKey?: string }).libKey } : {}),
    });
  }
  // What the newer picture libraries gave this Short, in its log and the owner's note (long videos: after the top-up).
  if (!isLongEpisode(ep) && !rich)
    await reportLibraries(s, ep.id, `Short "${script.headline}"`, out, clips);
  // Lead with the most cinematic art; screenshots fill the middle.
  const rank: Record<string, number> = {
    hero: 0,
    photo: 1,
    article: 2,
    capsule: 3,
    screenshot: 4,
    header: 5,
  };
  // A Short's whole footage from a capped publisher stays under that cap, however many entries asked for some: the
  // opening moment, then the winner backwards (a ranking of one publisher's series got 45 s of Rockstar, 5 Nov 2026).
  const shortClips = isLongEpisode(ep) ? clips : capPublisherTotal(clips);
  return {
    images: out.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)),
    // A copy: an entry's gather left behind by the budget may still push into the live array for a while.
    clips: [...shortClips],
    officialTrailer: official.trailer,
    ...(eraDropped ? { eraDropped } : {}),
  };
}

/**
 * "Steve Hammond / CC BY-SA 2.0 / Wikimedia Commons" for a licensed photo (Commons, Flickr, Openverse, Pixabay),
 * "Image: Xbox press" for a publisher's press picture, else nothing (src/assets/libraries.ts photoCreditOf).
 */
export function photoCredit(i: {
  kind: string;
  provenance?: string;
}): string | undefined {
  return photoCreditOf(i);
}

/** A video about single-player campaigns keeps multiplayer footage out of every pick. */
/** A story ranking warns about spoilers in its first spoken lines. */
export function withSpoilerWarning(script: Script): Script {
  if (scopeOf(script) !== "campaign" || /spoiler/i.test(script.hook))
    return script;
  return {
    ...script,
    // The script may already say "Fair warning" about the ranking itself: never twice in one intro.
    hook: `${script.hook.trim()} ${/fair warning/i.test(script.hook) ? "And expect story spoilers." : "Fair warning: story spoilers ahead."}`,
  };
}

export function scopeOf(script: Script): "campaign" | undefined {
  // A week's recap covers many games: one story's "campaign" must not scope the whole video.
  if (script.recap) return undefined;
  const t = `${script.criterion ?? ""} ${script.headline} ${script.kicker ?? ""} ${script.youtube?.title ?? ""}`;
  return /\bcampaigns?\b|story mode|single[- ]player/i.test(t)
    ? "campaign"
    : undefined;
}

/**
 * Copies a published Short's images and clips into a recap chapter (entry_<beat>/short_*), tagged for
 * that chapter. False when the Short's media is gone (pruned after 14 days), so the chapter gathers its own.
 */
async function copyShortMedia(
  s: Services,
  episodeId: string,
  beatIndex: number,
  dir: string,
  images: Array<VisualAsset & { beatIndex?: number }>,
  clips: NonNullable<EpisodeAssets["clips"]>,
): Promise<boolean> {
  const short = await getEpisode(s.db, episodeId);
  const a = short?.assets_json;
  if (!a) return false;
  const from = episodeDir(s.cfg, episodeId);
  const sub = `entry_${beatIndex}`;
  await fs.mkdir(path.join(dir, sub), { recursive: true });
  const copy = async (file: string): Promise<string | undefined> => {
    const dest = path.join(sub, `short_${file.replace(/[\\/]/g, "_")}`);
    try {
      await fs.copyFile(path.join(from, file), path.join(dir, dest));
      return dest;
    } catch {
      return undefined;
    }
  };
  let n = 0;
  for (const img of a.images ?? []) {
    if (img.kind === "logo") continue;
    const file = await copy(img.file);
    if (!file) continue;
    images.push({
      ...img,
      file,
      beatIndex,
      moment: undefined,
    } as VisualAsset & { beatIndex?: number });
    n++;
  }
  for (const c of a.clips ?? []) {
    const file = await copy(c.file);
    if (!file) continue;
    clips.push({ ...c, file, beatIndex, role: undefined, moment: undefined });
    n++;
  }
  return n >= 3;
}

/** Up to two licensed photos of a named person for a Short, chosen by a cheap model from a Commons search. */
async function personPhoto(
  s: Services,
  ep: Episode,
  dir: string,
  person: string,
  images: Array<VisualAsset & { beatIndex?: number }>,
): Promise<void> {
  const script = ep.script_json!;
  try {
    const candidates = (await s.searchPhotos(person).catch(() => []))
      .filter((c) => c.width >= 800)
      .slice(0, 20);
    if (!candidates.length) return;
    const keep = (
      await pickPhotos(
        s.llm,
        {
          franchise: person,
          game: script.game_title,
          title: script.headline,
          opening: `A news story about ${person}: ${script.hook}`,
        },
        candidates,
      )
    ).slice(0, 2);
    const surname = person.split(/\s+/).pop()!.toLowerCase();
    const line = script.beats.findIndex((b) =>
      b.narration.toLowerCase().includes(surname),
    );
    await fs.mkdir(path.join(dir, "assets"), { recursive: true });
    for (const [k, i] of keep.entries()) {
      const img = candidates[i]!;
      const file = path.join("assets", `person_${k}.jpg`);
      if (!(await s.downloadPhoto(img, path.join(dir, file)))) continue;
      images.push({
        kind: "photo",
        file,
        sourceUrl: img.pageUrl,
        provenance: photoProvenance(img),
        label: person,
        ...(line >= 0 && k === 0 ? { beatIndex: line } : {}),
      } as VisualAsset & { beatIndex?: number });
    }
    log("info", "person photo added", {
      episode: ep.id,
      person,
      photos: keep.length,
    });
  } catch (err) {
    log("warn", "person photo failed", {
      episode: ep.id,
      person,
      error: errorMessage(err),
    });
  }
}

/**
 * PEOPLE_INSETS: the real people a Short names, each with a licensed face photo (src/assets/people.ts), at most
 * MAX_PEOPLE. A person the Short already shows full-frame (its `person` photo) gets no inset as well.
 */
async function gatherPeople(
  s: Services,
  episodeId: string,
  dir: string,
  script: Script,
  images: Array<{ kind: string; label?: string }>,
): Promise<NonNullable<EpisodeAssets["people"]>> {
  const shown = new Set(images.filter((i) => i.kind === "photo" && i.label).map((i) => i.label!.toLowerCase()));
  const out: NonNullable<EpisodeAssets["people"]> = [];
  const tried: string[] = [];
  for (const c of peopleCandidates(script)) {
    if (out.length >= MAX_PEOPLE) break;
    if (shown.has(c.name.toLowerCase())) continue;
    tried.push(c.name);
    const p = await s.personPortrait!(c, dir, out.length).catch(() => undefined);
    if (p) out.push(p);
  }
  await logEvent(s.db, episodeId, "people_insets", {
    tried,
    found: out.map((p) => ({ name: p.name, qid: p.qid, license: p.license, page: p.pageUrl })),
  }).catch(() => undefined);
  return out;
}

/** MENTION_*: the mention kinds switched on (src/render/mentions.ts), in a fixed order. */
export function mentionKinds(cfg: Pick<Config, "mentionGames" | "mentionLogos" | "mentionCharacters" | "mentionRealPlaces" | "mentionPlatforms" | "mentionReceipts" | "mentionOutlets" | "mentionInworld">): MentionKind[] {
  const on: Array<[MentionKind, boolean]> = [
    ["game", cfg.mentionGames],
    ["logo", cfg.mentionLogos],
    ["character", cfg.mentionCharacters],
    ["realplace", cfg.mentionRealPlaces],
    ["platform", cfg.mentionPlatforms],
    ["receipt", cfg.mentionReceipts],
    ["outlet", cfg.mentionOutlets],
    ["inworld", cfg.mentionInworld],
  ];
  return on.filter(([, v]) => v).map(([k]) => k);
}

/** What the mention gather reads from a script, a story and its assets (pure). */
export function mentionInputOf(o: {
  dir: string;
  kinds: MentionKind[];
  script: {
    hook?: string;
    beats?: Array<{ narration?: string; footage?: { keywords?: string[] } }>;
    pulse_take?: { narration?: string };
    loop_line?: string;
    game_title?: string;
    attribution?: string;
    youtube?: { tags?: string[] };
    sources?: string[];
  };
  story?: { items?: Array<{ url?: string; title?: string; source?: string; summary?: string; sourceKind?: string; publishedAt?: string }> } | null;
  assets: { steam?: { appId: number; name: string }; images?: Array<{ file: string; label?: string; kind?: string; sourceUrl?: string; provenance?: string; aspect?: number }> };
  docSources?: Array<string | { url?: string; source?: string }>;
}): MentionInput {
  const sc = o.script;
  const spoken = [sc.hook ?? "", ...(sc.beats ?? []).map((b) => b.narration ?? ""), sc.pulse_take?.narration ?? "", sc.loop_line ?? ""].join(" ");
  return {
    dir: o.dir,
    kinds: o.kinds,
    spoken,
    listed: [...(sc.beats ?? []).flatMap((b) => b.footage?.keywords ?? []), ...(sc.youtube?.tags ?? [])],
    mainGame: sc.game_title ?? "",
    ...(o.assets.steam ? { mainSteam: { appId: o.assets.steam.appId, name: o.assets.steam.name } } : {}),
    attribution: sc.attribution,
    items: o.story?.items ?? [],
    docSources: o.docSources ?? sc.sources,
    images: o.assets.images,
  };
}

/** Whether the gather kept in an episode's assets looked for these kinds (otherwise it runs again). */
export const mentionsCover = (found: MentionsFound | undefined, kinds: MentionKind[]): boolean =>
  !!found && kinds.every((k) => found.kinds.includes(k));

/**
 * MENTION_*: the mention insets of a video on its words, scheduled (src/render/mentions.ts mentionSlots), the pictures
 * as episode-relative paths. [] when every kind is off. A long video passes no schedule here: its composition fits the
 * insets around its own sentence graphics (Long.tsx), so it gets the placed list and the cap instead.
 */
export function mentionPlacement(
  cfg: Parameters<typeof mentionKinds>[0] & Pick<Config, "mentionMaxPerShort">,
  found: MentionsFound | undefined,
  words: Array<{ text: string; start: number }>,
  plan: { fps: number; totalFrames: number },
  layout: MentionLayout,
  /** Frames something else always holds (a Short's hook headline): never entered. */
  taken: Array<{ from: number; to: number }> = [],
): { insets: MentionInset[]; slots: MentionSlot[]; max: number } {
  const kinds = new Set(mentionKinds(cfg));
  const max = mentionCap(layout, cfg.mentionMaxPerShort, plan.totalFrames / plan.fps);
  if (!kinds.size || !max) return { insets: [], slots: [], max };
  const insets = mentionsOnWords(found?.items ?? [], words, { kinds });
  return { insets, slots: mentionSlots(insets, { fps: plan.fps, totalFrames: plan.totalFrames, max, layout, taken }), max };
}

/** The people with a photo whose names are said, with when (seconds); one never said gets no inset. */
export function peopleOnWords(
  people: NonNullable<EpisodeAssets["people"]>,
  words: Array<{ text: string; start: number }>,
): Array<{ name: string; file: string; credit: string; at: number }> {
  return people.flatMap((p) => {
    const at = nameSpokenAt(words, p.name);
    return at === undefined ? [] : [{ name: p.name, file: p.file, credit: p.credit, at }];
  });
}

/** The tracklist card of a soundtrack, album or tracklist story (src/render/people.ts), or undefined. */
export function tracklistOf(
  script: Script,
  segments: Segment[],
  words: Array<{ text: string; start: number }>,
  plan: { fps: number; totalFrames: number },
  insetTimes: number[],
) {
  const about = `${script.headline} ${script.hook} ${script.beats.map((b) => b.narration).join(" ")}`;
  if (!soundtrackStory(about)) return undefined;
  return placeTracklist({
    segments,
    words,
    fps: plan.fps,
    totalFrames: plan.totalFrames,
    tracks: tracksFromScript(script),
    // A rumour, or a list the narration calls reported or leaked, is labelled as reported.
    rumour: script.is_rumour || /\b(reported(ly)?|leak(ed)?|rumou?r(ed)?)\b/i.test(about),
    subtitle: mediaTitle(script.game_title),
    insetTimes,
  });
}

/** The footage asks of one documentary chapter's paragraphs, in order. */
export function chapterFootage(
  script: Script,
  chapter: number,
): Array<{ want: FootageTarget["want"]; keywords: string[] }> {
  const out: Array<{ want: FootageTarget["want"]; keywords: string[] }> = [];
  let c = -1;
  for (const b of script.beats) {
    if (b.visual?.kind === "chapter") c++;
    if (c === chapter && b.footage && b.footage.want !== "none")
      out.push({ want: b.footage.want, keywords: b.footage.keywords });
  }
  return out;
}

/**
 * A chapter's sentences in order: the ones its shot list (entry.moments) was written for. A ranking's chapters
 * are its entries, one "rank" beat each (31 Oct 2026: before, a ranking's came back empty, so its picture top-up
 * and graphics for bare lines worked without the words).
 */
export function chapterSentences(script: Script, chapter: number): string[] {
  const out: string[] = [];
  let c = -1;
  for (const b of script.beats) {
    if (b.visual?.kind === "chapter" || b.visual?.kind === "rank") c++;
    if (c === chapter) out.push(...sentencesOf(b.narration));
  }
  return out;
}

/**
 * The footage asks of a documentary chapter, one per in-game sentence of its shot list, so a matched clip
 * plays on the sentence that names it (29 Oct 2026: chapters played their footage in gathering order and
 * barely one shot in ten showed what the narrator said). Real-world sentences (B-roll) get photos instead.
 */
export function docShotTargets(
  entry: NonNullable<Script["entries"]>[number],
  sentences: string[],
  beatIndex: number,
): FootageTarget[] {
  return (entry.moments ?? []).flatMap((m, k) =>
    m.broll?.trim()
      ? []
      : [
          {
            key: `beat:${beatIndex}#m${k}`,
            text: `${sentences[k] ?? ""} (show: ${m.show})`,
            want: "gameplay" as const,
            energy: "medium" as const,
            // A named real person is left out of the keywords: licensed gameplay has no footage of Sam
            // Houser, and the search for a "mission" by that name costs YouTube quota (29 Oct 2026).
            keywords: [
              entry.game_title,
              ...m.keywords.filter((x) => x !== m.person),
            ].slice(0, 4),
          },
        ],
  );
}

/** Up to n items spread evenly across a list, so a chapter's late sentences are asked for too. */
function spreadPick<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from(
    { length: n },
    (_, i) => xs[Math.floor((i * xs.length) / n)]!,
  );
}

function titleCaseLabel(label: string): string {
  return label.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

/**
 * One long-form ranking entry's media, sentence by sentence: the store
 * gallery (topped up from IGDB), a trailer moment matched to each sentence's
 * shot note, then a vision pass that gives each sentence the still showing
 * what it names and drops any picture with text in it.
 */
export async function gatherLongEntryMedia(
  s: Services,
  script: Script,
  entry: NonNullable<Script["entries"]>[number],
  beatIndex: number,
  dir: string,
  images: Array<VisualAsset & { beatIndex?: number }>,
  clips: NonNullable<EpisodeAssets["clips"]>,
  /** The gather's time budget: past it the slow fetches (own recordings, licensed gameplay) are skipped. */
  budget?: GatherBudget,
): Promise<void> {
  const edir = path.join(dir, `entry_${beatIndex}`);
  const rel = (f: string) => path.join(`entry_${beatIndex}`, f);
  const moments = entry.moments ?? [];
  const sentences = sentencesOf(script.beats[beatIndex]?.narration ?? "");
  const scope = scopeOf(script);
  // LONG_ENTRY_CLIP_TARGETS: every sentence (up to the dial) asks the trailers for its own moment; the first six alone
  // did before, and the rest of a 21-sentence entry only ever got stills (Mass Effect ranking, 25 Nov 2026).
  const targets: FootageTarget[] = moments
    .slice(0, script.evergreen_format === "ranking" ? (s.cfg.longEntryClipTargets ?? 6) : 6)
    .map((m, k) => ({
    key: `beat:${beatIndex}#m${k}`,
    text: `${sentences[k] ?? ""} (show: ${m.show})${scope === "campaign" ? " [single-player campaign footage only: no multiplayer, Zombies or Warzone, no multiplayer HUD]" : ""}`,
    want: script.beats[beatIndex]?.footage?.want ?? "gameplay",
    energy: "medium",
    // A named person leads the keywords so their own footage is searched for (and a portrait can be cut from it).
    keywords: [
      entry.game_title,
      ...(m.person ? [m.person] : []),
      ...m.keywords.filter((k) => k !== m.person),
    ].slice(0, 4),
  }));
  const pushClip = (c: VisualAsset) =>
    clips.push({
      file: rel(c.file),
      sourceUrl: c.sourceUrl,
      provenance: c.provenance,
      durationSeconds: Math.min(c.durationSeconds ?? 4, 4.8),
      beatIndex,
      moment: c.moment,
      role: undefined,
      motion: c.motion,
      luma: c.luma,
      label: c.label,
      reason: c.reason,
      startSeconds: c.startSeconds,
    });
  const mine: Array<VisualAsset & { beatIndex?: number }> = [];
  try {
    const eapp = await steamAppForEntry(s, entry).catch(() => undefined);
    if (eapp) {
      mine.push(
        ...(await s.fetchArt(eapp, edir, 12)).filter((a) => a.kind !== "logo"),
      );
      if (s.cfg.footage && targets.length)
        for (const c of capFootage(
          await s.fetchClips(
            eapp,
            edir,
            targets,
            targets.length,
            scopeOf(script),
            // LONG_MIN_MOVING_SHARE: past the sentences' own moments, clean moments of the trailers up to that share
            // of the chapter, untagged (the meaning match pins them to lines later, the planner spreads the rest).
            entryFillSeconds(
              script.beats[beatIndex]?.narration ?? "",
              // Only a ranking plans its footage first under LONG_MIN_MOVING_SHARE, so only a ranking asks for it.
              script.evergreen_format === "ranking" ? (s.cfg.longMinMovingShare ?? 0) : 0,
            ),
          ),
          Math.max(
            footageBudgetSeconds(eapp),
            Math.min(45, footageBudgetSeconds(eapp) * 2.25),
          ),
          4.8,
        ))
          pushClip(c);
    } else if (s.cfg.footage && targets.length) {
      const om = await s
        .fetchOfficialMedia(
          entry.game_title,
          edir,
          targets,
          targets.length,
          entry.year ? String(entry.year) : "",
        )
        .catch(() => ({ clips: [], stills: [] }) as OfficialMedia);
      if (
        om.trailer &&
        trailerMatchesGame(
          om.trailer.title,
          entry.game_title,
          script.game_title || entry.game_title,
        ) &&
        (await s.judgeFootage(
          entry.game_title,
          entry.year,
          om.trailer.title,
          scope,
        ))
      )
        for (const c of capFootage(om.clips, om.trailer.clipSeconds ?? 0))
          pushClip(c);
      else if (om.trailer)
        log("info", "official trailer refused for this entry", {
          game: entry.game_title,
          trailer: om.trailer.title,
        });
    }
    // Past the gather budget the entry keeps its art and stops here: no own recordings, no licensed gameplay.
    if (budget?.over()) throw new GatherOutOfTime();
    // The owner's own recordings come first: the best footage there is.
    for (const c of await s
      .ownClips(
        entry.game_title,
        script.game_title || entry.game_title,
        edir,
        targets.slice(0, 12),
        12,
      )
      .catch(() => [] as VisualAsset[]))
      clips.push({
        file: rel(c.file),
        sourceUrl: c.sourceUrl,
        provenance: c.provenance,
        durationSeconds: Math.min(c.durationSeconds ?? 4, 8),
        beatIndex,
        moment: c.moment,
        role: undefined,
        motion: c.motion,
        luma: c.luma,
        label: c.label,
        reason: c.reason,
        startSeconds: c.startSeconds,
        audio: c.audio,
      });
    // Licensed gameplay for every sentence (real missions and moments, credited), on top of any trailer moment:
    // a sentence then plays as footage, not a still.
    // Two different moments per sentence: footage for the whole line, not one clip and then a still.
    const missing = targets.slice(0, 10).flatMap((t) => [
      t,
      {
        ...t,
        key: t.key.replace(/#m(\d+)$/, "#alt#m$1"),
        text: `${t.text}, a different moment`,
      },
    ]);
    if (missing.length && !budget?.over())
      for (const c of await s
        .gameplayClips(
          entry.game_title,
          script.game_title || entry.game_title,
          entry.year,
          edir,
          missing,
          missing.length,
          scope,
        )
        .catch(() => [] as Array<VisualAsset & { credit: string }>))
        clips.push({
          file: rel(c.file),
          sourceUrl: c.sourceUrl,
          provenance: c.provenance,
          durationSeconds: Math.min(c.durationSeconds ?? 4, 8),
          beatIndex,
          moment: c.moment,
          role: undefined,
          motion: c.motion,
          luma: c.luma,
          label: c.label,
          reason: c.reason,
          startSeconds: c.startSeconds,
          credit: c.credit,
          audio: c.audio,
        });
    // IGDB tops up a thin gallery (and supplies everything for games off Steam).
    const have = mine.filter((a) => a.kind !== "capsule").length;
    if (have < 10)
      for (const a of await s
        .igdbArt(entry.game_title, entry.year, edir, 12 - have)
        .catch(() => [] as VisualAsset[]))
        if (a.kind !== "capsule" || !mine.some((m) => m.kind === "capsule"))
          mine.push(a);
  } catch (err) {
    if (!(err instanceof GatherOutOfTime))
    log("warn", "long entry media failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // The picture editor: a still per sentence, and no picture with text behind the graphics.
  const stills = mine.filter((a) => a.kind !== "capsule");
  try {
    const ranked = await rankStills(
      s.llm,
      moments.map((m, k) => ({
        key: `m${k}`,
        show: m.show,
        sentence: sentences[k] ?? "",
      })),
      stills.map((a) => ({ file: path.join(edir, a.file) })),
      path.join(edir, "stillscore"),
      scope,
    );
    for (const [i, a] of stills.entries()) {
      a.label = ranked.labels.get(i);
      if (ranked.withText.has(i)) (a as { drop?: boolean }).drop = true;
    }
    for (const p of ranked.picks)
      stills[p.image]!.moment = Number(p.key.slice(1));
    // A handheld game shows its interface in every screenshot: dropping them all left GTA Advance on the
    // blank plate for 70 s (GTA ranking, 23 Oct 2026). Below three clean stills, the first few stay.
    const clean = stills.filter((a) => !(a as { drop?: boolean }).drop).length;
    if (clean < 3)
      for (const a of stills
        .filter((x) => (x as { drop?: boolean }).drop)
        .slice(0, 4 - clean))
        delete (a as { drop?: boolean }).drop;
    // A story video uses no store screenshots: for shooters they are mostly multiplayer maps, and
    // no picture editor can tell a map from a campaign level by eye (a Vanguard map passed as a
    // campaign shot). Footage carries the story; key art stays for the rank card.
    if (scope === "campaign")
      for (const a of stills)
        if (a.kind === "screenshot") (a as { drop?: boolean }).drop = true;
  } catch (err) {
    log("warn", "still ranking failed; stills keep entry order", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  for (const a of mine)
    if (!(a as { drop?: boolean }).drop)
      images.push({ ...a, file: rel(a.file), beatIndex });
  // LONG_NAMED_ART: the character a sentence names gets their own official picture on that sentence (IGDB's
  // character pictures, only for a character IGDB lists in this series; src/assets/namedart.ts).
  if (s.cfg.longNamedArt && s.characterArt) {
    const asked = new Map<string, (VisualAsset & { named: string }) | undefined>();
    let got = 0;
    // Lookups, found or not, are bounded too: a line-by-line roll of unknown names must not hold the gather.
    const most = s.cfg.longNamedArtMax ?? 8;
    for (const [k, m] of moments.entries()) {
      if (got >= most || asked.size >= most * 2 || budget?.over()) break;
      for (const name of namedSubjects(m, entry.game_title)) {
        const key = name.toLowerCase();
        if (!asked.has(key)) {
          if (asked.size >= most * 2) break;
          // The series of the entry's own title or of the video's (a ranking's title may be a topic): one search.
          asked.set(
            key,
            await s
              .characterArt(name, [entry.game_title, script.game_title].filter(Boolean), edir)
              .catch(() => undefined),
          );
        }
        const pic = asked.get(key);
        if (!pic) continue;
        images.push({ ...pic, file: rel(pic.file), beatIndex, moment: k });
        got++;
        break;
      }
    }
    if (got)
      log("info", "named character pictures", {
        game: entry.game_title,
        pictures: got,
        names: [...asked].filter(([, p]) => p).map(([n]) => n),
      });
  }
  // A face for every sentence that names a person, cut from the footage chosen for that sentence.
  for (const [k, m] of moments.entries()) {
    const person = (m as { person?: string }).person?.trim();
    if (!person) continue;
    // Only footage from a video whose title names this person: a face from anywhere else could be anyone, and a wrong name is misinformation.
    const named = (t: string) => normTitle(t).includes(normTitle(person));
    const clip = clips.find(
      (c) => c.beatIndex === beatIndex && c.moment === k && named(c.provenance),
    );
    if (!clip) continue;
    const file = path.join("assets", `portrait_m${k}.jpg`);
    const ok = await cutPortrait(
      path.join(dir, clip.file),
      path.join(edir, file),
    ).catch(() => false);
    if (!ok) continue;
    images.push({
      kind: "portrait",
      file: rel(file),
      sourceUrl: clip.sourceUrl,
      provenance: `Portrait of ${person} cut from: ${clip.provenance}`,
      beatIndex,
      moment: k,
      label: person.toUpperCase(),
      width: 960,
      height: 540,
    });
    log("info", "character portrait", {
      game: entry.game_title,
      person,
      moment: k,
    });
  }
}

/**
 * One documentary chapter's media. Steam first (the writer's term, then the
 * game's re-release names), only when the store page is this game and not a
 * sibling; its whole screenshot gallery and footage matched to the chapter's
 * paragraphs, within the publisher's budget. Off Steam, the publisher's trailer
 * only when its title names this game, and never its thumbnail. Then archive
 * photos of the real studio, people and places, picked by an editor pass.
 */
export async function gatherChapterMedia(
  s: Services,
  script: Script,
  entry: NonNullable<Script["entries"]>[number],
  beatIndex: number,
  dir: string,
  images: Array<VisualAsset & { beatIndex?: number }>,
  clips: NonNullable<EpisodeAssets["clips"]>,
  /** The gather's time budget: past it each remaining fetch block (footage, gameplay, photos, stock) is skipped. */
  budget?: GatherBudget,
  /** ownFirst: the owner's recordings are asked for every footage target, not half (a weekly guide). */
  opts?: { ownFirst?: boolean },
): Promise<void> {
  const franchise = script.game_title;
  const edir = path.join(dir, `entry_${beatIndex}`);
  const rel = (f: string) => path.join(`entry_${beatIndex}`, f);
  const terms = [
    ...new Set(
      [
        entry.steam_search_term,
        `${entry.game_title} Definitive Edition`,
        `${entry.game_title} Remastered`,
        entry.game_title,
      ].filter(Boolean),
    ),
  ];
  let eapp: SteamApp | undefined;
  for (const t of terms) {
    const a = await s.findGame(t).catch(() => undefined);
    if (
      a &&
      (trailerMatchesGame(a.name, entry.game_title, franchise) ||
        sameNumberedGame(a.name, franchise))
    ) {
      eapp = a;
      break;
    }
  }
  // Footage from a re-release says so on screen instead of wearing the original's year (29 Oct 2026 review:
  // 2021 Definitive Edition footage captioned 2001).
  const RERELEASE = /definitive|remaster|trilogy|enhanced|\bHD\b|anniversary/i;
  // So does footage from the living version of a game whose first release is gone (FFXIV's 2010 chapters).
  const laterVersion =
    eapp &&
    !trailerMatchesGame(eapp.name, entry.game_title, franchise) &&
    sameNumberedGame(eapp.name, franchise);
  const sameTitle =
    eapp &&
    eapp.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ===
      entry.game_title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const remaster =
    eapp &&
    ((RERELEASE.test(eapp.name) && !RERELEASE.test(entry.game_title)) ||
      laterVersion ||
      (distinguishing(entry.game_title, franchise).length === 0 && !sameTitle))
      ? `FOOTAGE: ${eapp.name.toUpperCase()} · STEAM`
      : undefined;
  const pushClip = (c: VisualAsset) =>
    clips.push({
      file: rel(c.file),
      sourceUrl: c.sourceUrl,
      provenance: c.provenance,
      durationSeconds: Math.min(c.durationSeconds ?? 4, 4.8),
      beatIndex,
      moment: c.moment,
      credit: remaster,
      role: undefined,
      motion: c.motion,
      luma: c.luma,
      label: c.label,
      reason: c.reason,
      startSeconds: c.startSeconds,
    });
  // Footage is asked for sentence by sentence from the shot list; a chapter written before the shot list
  // existed falls back to its paragraphs.
  const sentences = chapterSentences(script, beatIndex);
  const shots = docShotTargets(entry, sentences, beatIndex);
  const paragraphTargets = (n: number, tag: string): FootageTarget[] =>
    chapterFootage(script, beatIndex)
      .slice(0, n)
      .map((f, k) => ({
        key: `beat:${beatIndex}#${tag}${k + 1}`,
        text: `${entry.game_title}: ${f.keywords.join(", ")}`,
        want: f.want,
        energy: "medium" as const,
        keywords: [entry.game_title, ...f.keywords].slice(0, 4),
      }));
  const tagged = () =>
    new Set(
      clips
        .filter((c) => c.beatIndex === beatIndex && c.moment !== undefined)
        .map((c) => c.moment!),
    );
  if (!budget?.over())
  try {
    if (eapp) {
      for (const a of (await s.fetchArt(eapp, edir, 12)).filter(
        (a) => a.kind !== "logo",
      ))
        images.push({ ...a, file: rel(a.file), beatIndex });
      if (s.cfg.footage) {
        const targets: FootageTarget[] = shots.length
          ? spreadPick(shots, 24)
          : paragraphTargets(Math.max(1, s.cfg.docClipsPerChapter), "");
        if (targets.length)
          for (const c of capFootage(
            await s.fetchClips(
              eapp,
              edir,
              targets,
                Math.max(
                  s.cfg.docClipsPerChapter,
                  Math.min(16, targets.length),
                ),
              scopeOf(script),
            ),
            footageBudgetSeconds(eapp),
            4.8,
          ))
            pushClip(c);
      }
    } else if (s.cfg.footage) {
      const want = chapterFootage(script, beatIndex)[0];
      const asks: FootageTarget[] = shots.length
        ? spreadPick(shots, 12)
        : [
            {
              key: `beat:${beatIndex}`,
              text: entry.game_title,
              want: want?.want ?? "gameplay",
              energy: "medium",
              keywords: want?.keywords ?? [entry.game_title],
            },
          ];
      const om = await s
        .fetchOfficialMedia(
          entry.game_title,
          edir,
          asks,
          asks.length,
          entry.year ? String(entry.year) : "",
        )
        .catch(() => ({ clips: [], stills: [] }) as OfficialMedia);
      if (
        om.trailer &&
        trailerMatchesGame(om.trailer.title, entry.game_title, franchise) &&
        (await s.judgeFootage(
          entry.game_title,
          entry.year,
          om.trailer.title,
          scopeOf(script),
        ))
      )
        for (const c of capFootage(om.clips, om.trailer.clipSeconds ?? 0))
          pushClip(c);
      else if (om.trailer)
        log("info", "documentary trailer rejected: it names another game", {
          game: entry.game_title,
          trailer: om.trailer.title,
        });
    }
  } catch (err) {
    log("warn", "documentary chapter media failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // Licensed gameplay: real moments for the in-game sentences no trailer shot matched, credited.
  // Not for a game from this year on (30 Oct 2026 review: the GTA VI chapter's "gameplay" was a fake upload full
  // of Spider-Man, Sonic and Minions mods, and re-uploads of Rockstar's trailers wrongly marked Creative Commons).
  // Before a game is out, uploaded "gameplay" can only be fake or someone else's trailer.
  const upcoming = upcomingGame(entry.year, s.now(), entry.game_title, readLaunches(s.cfg.launchCalendarFile));
  if (upcoming)
    log("info", "documentary gameplay skipped: the game is not out", {
      game: entry.game_title,
      year: entry.year,
    });
  if (!upcoming && !budget?.over())
    try {
      const done = tagged();
      const open = shots.filter(
        (t) => !done.has(Number(t.key.match(/#m(\d+)$/)?.[1])),
      );
      const have = clips.filter((c) => c.beatIndex === beatIndex).length;
      const targets: FootageTarget[] = shots.length
        ? spreadPick(open, 16)
        : have < 6
          ? paragraphTargets(4, "g")
          : [];
      if (targets.length) {
        // The owner's own recordings of this game come first (owner, 28 Oct 2026); licensed gameplay fills the rest.
        const own = await s
          .ownClips(
            entry.game_title,
            franchise,
            edir,
            targets,
            opts?.ownFirst ? targets.length : Math.ceil(targets.length / 2),
          )
          .catch(() => [] as VisualAsset[]);
        for (const c of own)
          clips.push({
            file: rel(c.file),
            sourceUrl: c.sourceUrl,
            provenance: c.provenance,
            durationSeconds: Math.min(c.durationSeconds ?? 4, 8),
            beatIndex,
            moment: c.moment,
            role: undefined,
            motion: c.motion,
            luma: c.luma,
            label: c.label,
            reason: c.reason,
            startSeconds: c.startSeconds,
            audio: c.audio,
          });
        for (const c of await s.gameplayClips(
          entry.game_title,
          franchise,
          entry.year,
          edir,
          targets,
          Math.max(1, targets.length - own.length),
        ))
          clips.push({
            file: rel(c.file),
            sourceUrl: c.sourceUrl,
            provenance: c.provenance,
            durationSeconds: Math.min(c.durationSeconds ?? 4, 8),
            beatIndex,
            moment: c.moment,
            role: undefined,
            motion: c.motion,
            luma: c.luma,
            label: c.label,
            reason: c.reason,
            startSeconds: c.startSeconds,
            credit: c.credit,
            audio: c.audio,
          });
      }
    } catch (err) {
      log("warn", "documentary gameplay failed", {
        game: entry.game_title,
        error: errorMessage(err),
      });
    }
  // IGDB: official screenshots and key art for games Steam cannot supply, or a thin Steam gallery.
  try {
    const have = images.filter(
      (i) => i.beatIndex === beatIndex && i.kind !== "capsule",
    ).length;
    if (have < 8)
      for (const a of await s.igdbArt(
        entry.game_title,
        entry.year,
        edir,
        12 - have,
      ))
        if (
          a.kind !== "capsule" ||
          !images.some((i) => i.beatIndex === beatIndex && i.kind === "capsule")
        )
          images.push({ ...a, file: rel(a.file), beatIndex });
  } catch (err) {
    log("warn", "documentary IGDB art failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // Archive photos: the real places and people, freely licensed and credited on screen.
  if (!budget?.over())
  try {
    const queries = (
      entry.photos?.length ? entry.photos : [`${entry.game_title} video game`]
    ).slice(0, 4);
    const seen = new Set<string>();
    const candidates = (
      await Promise.all(queries.map((q) => s.searchPhotos(q).catch(() => [])))
    )
      .flat()
      .filter((c) => !seen.has(c.title) && seen.add(c.title))
      .slice(0, 30);
    const opening =
      script.beats.filter((b) => b.visual?.kind === "chapter")[beatIndex]
        ?.narration ?? "";
    const keep = await pickPhotos(
      s.llm,
      {
        franchise,
        game: entry.game_title,
        title:
          script.beats.filter((b) => b.visual?.kind === "chapter")[beatIndex]
            ?.visual.primary ?? entry.game_title,
        opening,
      },
      candidates,
    );
    for (const [k, i] of keep.entries()) {
      const img = candidates[i]!;
      const file = rel(path.join("assets", `photo_${k}.jpg`));
      if (await s.downloadPhoto(img, path.join(dir, file)))
        images.push({
          kind: "photo",
          file,
          sourceUrl: img.pageUrl,
          provenance: photoProvenance(img),
          beatIndex,
        } as VisualAsset & { beatIndex?: number });
    }
  } catch (err) {
    log("warn", "documentary photos failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // The people the narration names, on the sentence that names them (29 Oct 2026 review: Sam Houser,
  // Leslie Benzies and the critics only ever got a name tag on an unrelated picture).
  if (!budget?.over())
  try {
    const people = new Map<string, number>();
    for (const [k, m] of (entry.moments ?? []).entries()) {
      const p = m.person?.trim();
      if (p && p.split(/\s+/).length >= 2 && !people.has(p)) people.set(p, k);
    }
    let n = 0;
    for (const [person, k] of [...people].slice(0, DOC_PEOPLE_PER_CHAPTER)) {
        const found = (await s.searchPhotos(person).catch(() => [])).slice(
          0,
          8,
        );
      if (!found.length) continue;
      const [pick] = await pickPhotos(
        s.llm,
        {
          franchise,
          game: entry.game_title,
          title: `${person}, the real person`,
          opening: `${sentences[k] ?? ""} Keep only a photo of ${person} themself, never a game character, a building or someone else.`,
        },
        found,
      ).catch(() => [] as number[]);
      const img = pick === undefined ? undefined : found[pick];
      if (!img) continue;
      const file = rel(path.join("assets", `person_${n++}.jpg`));
      if (await s.downloadPhoto(img, path.join(dir, file)))
        images.push({
          kind: "photo",
          file,
          sourceUrl: img.pageUrl,
          provenance: photoProvenance(img),
          beatIndex,
          moment: k,
          label: person.toUpperCase(),
        } as VisualAsset & { beatIndex?: number });
    }
  } catch (err) {
    log("warn", "documentary people photos failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // Real-world B-roll: licensed stock for the sentences the shot list marks (the studio, money, a leak),
  // played on its own sentence and labelled illustrative on screen.
  if (!budget?.over())
  try {
    const asked: FootageTarget[] = (entry.moments ?? [])
      .map((m, k) => ({ m, k }))
      .filter((x) => x.m.broll?.trim())
      .map(({ m, k }) => ({
        key: `beat:${beatIndex}#m${k}`,
        // The sentence itself, so the picture editor judges the preview against what is said.
        text: `${sentences[k] ?? ""} (show: ${m.broll})`,
        want: "cinematic" as const,
        energy: "medium" as const,
        keywords: [m.broll!],
      }));
    // A stock theme ("office at night") at most STOCK_THEME_MAX times in the whole video (src/assets/repeats.ts).
    const capped = capStockTargets(
      asked,
      clips,
      (t) => stockQuery(t, franchise.split(/\s+/)),
      s.cfg.stockThemeMax,
    );
    if (capped.dropped.length)
      log("info", "documentary B-roll: repeated stock themes skipped", {
        game: entry.game_title,
        skipped: capped.dropped.map((t) => t.keywords[0]),
      });
    const targets = capped.kept.slice(0, DOC_BROLL_PER_CHAPTER);
    if (targets.length)
      for (const c of await s.fetchStock(
        edir,
        targets,
        franchise.split(/\s+/),
        targets.length,
        clips.map((c) => c.sourceUrl).filter((u): u is string => !!u),
      ))
        clips.push({
          file: rel(c.file),
          sourceUrl: c.sourceUrl,
          provenance: c.provenance,
          durationSeconds: c.durationSeconds ?? 4,
          beatIndex,
          role: undefined,
          motion: 0.5,
          luma: undefined,
          label: c.label,
          reason: c.reason,
          startSeconds: 0,
          stock: true,
          moment: c.moment,
          credit: stockCredit(c.provenance),
        });
  } catch (err) {
    log("warn", "documentary B-roll failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
  // The picture editor, as the ranked videos have it: every still and photo of the chapter is looked at and
  // each sentence gets the one showing what it names; pictures carrying text are kept off the screen.
  const moments = entry.moments ?? [];
  if (!moments.length) return;
  try {
    const stills = images.filter(
      (i) =>
        i.beatIndex === beatIndex &&
        i.kind !== "capsule" &&
        i.moment === undefined,
    );
    const placed = new Set(
      images
        .filter((i) => i.beatIndex === beatIndex && i.moment !== undefined)
        .map((i) => i.moment!),
    );
    const noText = new Set<VisualAsset>();
    for (let b = 0; b < stills.length; b += 24) {
      const batch = stills.slice(b, b + 24);
      const want = moments
        .map((m, k) => ({
          key: `m${k}`,
          show: m.show,
          sentence: sentences[k] ?? "",
        }))
        .filter((t) => !placed.has(Number(t.key.slice(1))));
      if (!want.length) break;
      const ranked = await rankStills(
        s.llm,
        want,
        batch.map((a) => ({ file: path.join(dir, a.file) })),
        path.join(edir, `stillscore_${b}`),
        scopeOf(script),
        "documentary",
      );
      for (const [i, a] of batch.entries()) {
        a.label ??= ranked.labels.get(i);
        if (ranked.withText.has(i)) noText.add(a);
      }
      for (const p of ranked.picks) {
        batch[p.image]!.moment = Number(p.key.slice(1));
        placed.add(Number(p.key.slice(1)));
      }
    }
    // Text-laden pictures leave, unless that would leave the chapter almost bare.
    if (stills.length - noText.size >= 3)
      for (const a of noText) {
        const at = images.indexOf(a as never);
        if (at >= 0 && a.moment === undefined) images.splice(at, 1);
      }
    log("info", "documentary chapter pictures matched", {
      game: entry.game_title,
      sentences: moments.length,
      withPicture: placed.size,
      withFootage: tagged().size,
      stills: stills.length,
      textDropped: noText.size,
    });
  } catch (err) {
    log("warn", "documentary still ranking failed", {
      game: entry.game_title,
      error: errorMessage(err),
    });
  }
}

/**
 * A game from this calendar year or later: its uploaded "gameplay" is not trusted in a documentary. A game the launch
 * calendar says is out (launches.json, launch day passed) is not upcoming any more: GTA VI's documentaries skipped
 * real gameplay after its 19 Nov 2026 launch because it was still "this year's".
 */
export function upcomingGame(
  year: number | undefined,
  now = new Date(),
  title?: string,
  launches: Array<{ match: string; launch: string }> = [],
): boolean {
  if (!year || year < now.getFullYear()) return false;
  const out = title
    ? launches.find((l) => {
        try {
          return new RegExp(l.match, "i").test(title) && Date.parse(`${l.launch}T00:00:00Z`) <= now.getTime();
        } catch {
          return false;
        }
      })
    : undefined;
  return !out;
}

/** The share of a long video's sentences with a clip or still chosen for that sentence (moments[entry][k]). */
export function matchedShare(
  moments: unknown[][],
  images: Array<{ beatIndex?: number; moment?: number }>,
  clips: Array<{ beatIndex?: number; moment?: number }>,
): number {
  const total = moments.reduce((n, m) => n + m.length, 0);
  if (!total) return 0;
  const hit = new Set(
    [...images, ...clips]
      .filter((x) => x.beatIndex !== undefined && x.moment !== undefined)
      .map((x) => `${x.beatIndex}:${x.moment}`),
  );
  let n = 0;
  for (const [e, ms] of moments.entries())
    for (let k = 0; k < ms.length; k++) if (hit.has(`${e}:${k}`)) n++;
  return n / total;
}

/**
 * Which of a long video's chapters are about one game: a series whose name ends in its number means one game in all
 * its versions, so its chapters may share their footage. A franchise's chapters are different games, and stay apart.
 */
export function sameGameGroups(
  script: Pick<Script, "entries" | "game_title">,
): Array<number | undefined> | undefined {
  const sorted = [...(script.entries ?? [])].sort((a, b) => b.rank - a.rank);
  const groups = sorted.map((e) =>
    sameNumberedGame(e.game_title, script.game_title) ? 0 : undefined,
  );
  return groups.some((g) => g !== undefined) ? groups : undefined;
}

/**
 * The sentences a stock shot must keep off: those that name a real person the shot list knows about, by the moment's
 * own "person" or by surname anywhere in the sentence. A stock man at a desk under "Yoshida" reads as Yoshida.
 */
export function linesNamingPeople(
  moments: ReadonlyArray<{ person?: string }>,
  sentences: readonly string[],
  all: ReadonlyArray<{ person?: string }> = moments,
): boolean[] {
  const surnames = [
    ...new Set(
      all
        .flatMap((m) => (m.person ?? "").split(/[,&]| and /))
        .map((p) => p.trim().split(/\s+/).at(-1) ?? "")
        .filter((n) => n.length >= 3),
    ),
  ];
  return moments.map((m, k) => {
    if (m.person?.trim()) return true;
    const line = sentences[k] ?? "";
    return surnames.some((n) =>
      new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line),
    );
  });
}

/** Licensed stock shots a documentary chapter may use for its real-world sentences. */
const DOC_BROLL_PER_CHAPTER = 5;
/** Named real people a documentary chapter looks up photos of. */
const DOC_PEOPLE_PER_CHAPTER = 5;

/** Spoken words a second in a long video (about 160 a minute): how long a chapter runs before its voice exists. */
export const LONG_WORDS_PER_SECOND = 2.7;

/**
 * LONG_MIN_MOVING_SHARE: how many seconds of footage a ranking entry asks its trailers for, as fetchClips' fill
 * (pure): the share of the chapter's estimated length. Undefined (no fill) when the share is 0 or the chapter empty.
 */
export function entryFillSeconds(
  narration: string,
  share: number,
): { seconds: number } | undefined {
  const words = narration.split(/\s+/).filter(Boolean).length;
  if (share <= 0 || !words) return undefined;
  return { seconds: Math.round((words / LONG_WORDS_PER_SECOND) * share) };
}

/**
 * The Steam page for a ranking entry, only when it is that release: Steam's
 * search hands "Call of Duty 4: Modern Warfare" (2007) the 2019 reboot, and
 * "Resident Evil 4" the remake. A page more than a year off the entry's year
 * is refused, and the entry's pictures come from IGDB by exact title instead.
 */
export async function steamAppForEntry(
  s: Pick<Services, "findGame"> & { cfg?: { steamEditions?: boolean } },
  entry: { steam_search_term: string; year?: number; game_title: string },
): Promise<SteamApp | undefined> {
  if (!entry.steam_search_term) return undefined;
  const app = await s.findGame(entry.steam_search_term);
  if (!app || !entry.year) return app;
  const appYear =
    Number(
      String(app.details?.release_date?.date ?? "").match(
        /\b(19|20)\d\d\b/,
      )?.[0],
    ) || undefined;
  if (appYear && Math.abs(appYear - entry.year) > 1) {
    // STEAM_EDITIONS: a later edition of the same game, or the series collection that contains it, is still this
    // game (src/assets/steamedition.ts); a remake or a reboot is not.
    const edition =
      s.cfg?.steamEditions !== false
        ? steamEditionOf(
            entry.game_title,
            app.name,
            appYear - entry.year,
            entry.steam_search_term,
            entry.year,
          )
        : undefined;
    if (edition) {
      log("info", "steam page taken: a later edition of the game", {
        entry: entry.game_title,
        year: entry.year,
        store: app.name,
        storeYear: appYear,
        edition,
      });
      return app;
    }
    log("info", "steam page refused: another release of the game", {
      entry: entry.game_title,
      year: entry.year,
      store: app.name,
      storeYear: appYear,
    });
    return undefined;
  }
  return app;
}

/** EXPLAINERS: a beat's or the take's explainer, as a segment field (none: nothing added, so old scripts render as before). */
function explainerOf(script: Script, part: "beat" | "take", index: number) {
  const x = script.explainers?.find((e) => e.part === part && e.index === index);
  return x ? { explainer: x.explainer } : {};
}

export function segmentInputs(script: Script, desk = false): SegmentInput[] {
  // One context in spoken order, as the voice was given it (narrationOf and the desk parts do the same).
  const ctx = speakContext(script.say_as);
  return [
    // The same speakable text the voice was given, so segment timings line up word for word.
    { kind: "hook", text: speakable(script.hook, ctx) },
    ...script.beats.map((b, i) => ({
      kind: "beat" as const,
      text: speakable(b.narration, ctx),
      visual: b.visual,
      ...explainerOf(script, "beat", i),
    })),
    // The desk partner's question sits between the facts and the take when the Short has one.
    ...(desk && script.desk_question
      ? [{ kind: "desk" as const, text: speakable(script.desk_question, ctx) }]
      : []),
    {
      kind: "take",
      text: speakable(script.pulse_take.narration, ctx),
      label: script.pulse_take.label,
      visual: {
        kind: "title" as const,
        primary: script.pulse_take.on_screen,
        secondary: "",
      },
      ...explainerOf(script, "take", 0),
    },
    // The same tidied last line the voice was given, so timings line up.
    { kind: "loop", text: speakable(tidyLoopLine(script.loop_line), ctx) },
  ];
}

/** Words the captions keep lit after they are spoken: the game title and the on-screen card text. */
export function emphasisWords(script: Script): string[] {
  const out = new Set<string>();
  const add = (t: string) => {
    for (const w of t.toLowerCase().split(/[^a-z0-9£$%']+/))
      if (w.length > 2) out.add(w);
  };
  add(script.game_title);
  for (const b of script.beats)
    if (b.visual && b.visual.kind !== "none") add(b.visual.primary);
  return [...out];
}

/** One live number for the end of the take, if Steam has a good one. */
export function steamStat(
  f?: SteamFacts,
): { value: string; label: string } | null {
  if (!f) return null;
  if (f.currentPlayers && f.currentPlayers >= 1000)
    return {
      value: f.currentPlayers.toLocaleString("en-US"),
      label: "playing on Steam right now",
    };
  if (f.positivePercent !== undefined && (f.totalReviews ?? 0) >= 500)
    return {
      value: `${f.positivePercent}%`,
      label: `positive Steam reviews (${f.reviewSummary})`,
    };
  return null;
}

export function variantOf(id: string): number {
  return [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % 4;
}

/** Pictures a Short needs before it is worth making: two distinct real images or clips. */
export const MEDIA_FLOOR = 2;

/**
 * A Short with nothing real to show (only the brand plate) is not published:
 * the story is dropped, its slot freed for the next story, and Discord told.
 */
async function belowMediaFloor(
  s: Services,
  ep: Episode,
  assets: EpisodeAssets,
): Promise<boolean> {
  const count = (assets.images?.length ?? 0) + (assets.clips?.length ?? 0);
  // A picture story needs pictures of the story: the publisher's video of it, or illustrative stock for its lines.
  const pictureStory = ep.story_json.visualNeed === "real_world_images";
  const storyPictures =
    (assets.clips ?? []).filter((c) => c.stock).length +
    (assets.officialTrailer &&
    pictureStory &&
    (assets.clips ?? []).some(
      (c) => !c.stock && /YouTube channel/.test(c.provenance),
    )
      ? 2
      : 0);
  if (count >= MEDIA_FLOOR && (!pictureStory || storyPictures >= 2))
    return false;
  const headline = ep.story_json.headline;
  await markSeen(
    s.db,
    ep.story_hash,
    headline,
    "rejected",
    `only ${count} pictures to show`,
  );
  await transition(s.db, ep.id, "voiced", "rejected", {
    last_error: pictureStory
      ? `picture story with nothing safe to show: no publisher video of it and ${storyPictures} stock clips`
      : `nothing worth showing: ${count} official images or clips (need ${MEDIA_FLOOR})`,
  });
  await logEvent(s.db, ep.id, "media_floor", { count, floor: MEDIA_FLOOR });
  log("warn", "story dropped: not enough pictures", {
    episode: ep.id,
    headline,
    count,
  });
  await s.notify({
    level: "info",
    embeds: [
      {
        title: `🛑 Dropped: ${headline}`,
        description: `Only ${count} official image or clip to show, so it would have run on a blank background. The slot goes to the next story.`,
        color: COLOURS.warn,
      },
    ],
  });
  return true;
}

/**
 * The PC goes to the Shorts first: a long render does not start while a Short's window (the same windows the PC
 * orchestrator keeps free, src/pcschedule.ts) is open or would open before it is done. It looks again in five
 * minutes (undefined); on a busy afternoon that can mean the evening, and a long video past its slot goes out
 * once made. In a gap it returns how long its turn may wait in the orchestrator's queue (behind an Orryy
 * render, say): until half an hour before the next Short's window, after which it would take that Short's place.
 */
async function longRenderGap(
  s: Services,
  ep: Episode,
): Promise<number | undefined> {
  const minutes = longRenderMinutes();
  const now = s.now().getTime();
  const ahead = await shortWindows(
    s.db,
    s.cfg,
    s.now(),
    ep.slot_at ? new Date(ep.slot_at) : undefined,
  );
  const clash = ahead.find((w) => Date.parse(w.from) < now + minutes * 60_000);
  if (!clash) {
    const next = Math.min(...ahead.map((w) => Date.parse(w.from)));
    return Math.min(180, (next - now) / 60_000 - INHERIT_MINUTES);
  }
  await deferLong(s, ep);
  log("info", "long render waits for a Short's slot", {
    episode: ep.id,
    lane: clash.lane,
    window: `${clash.from} to ${clash.until}`,
    note: clash.note,
    minutes: Math.round(minutes),
  });
  return undefined;
}

/** Looks again in five minutes; not a failure, so no attempt is used. */
async function deferLong(s: Services, ep: Episode): Promise<void> {
  await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [
    ep.id,
    new Date(s.now().getTime() + 5 * 60_000),
  ]);
}

function allowedEpisodeCutscenes(cfg: Config, script: Script, assets: EpisodeAssets, long: boolean, retro = false): NonNullable<EpisodeAssets["clips"]> {
  // A retrospective's chapters each keep their own allowance (src/retrospective.ts).
  const caps = retro
    ? retroFootageCaps(cfg, script, script.game_title)
    : long && cfg.longChapterFootage && script.entries?.length
      ? longChapterFootageCaps(cfg, script)
      : [];
  const perChapter = caps.length > 0;
  const jobs = script.entries?.length
    ? [...script.entries]
        .sort((a, b) => b.rank - a.rank)
        .map((entry, beatIndex) => ({ gameTitle: entry.game_title, beatIndex, ...(perChapter ? { ownSeconds: caps[beatIndex] ?? 0 } : {}) }))
    : [{ gameTitle: script.game_title }];
  const limit = !cfg.cutsceneFootage ? 0 : perChapter
    ? caps.reduce((n, x) => n + x, 0)
    : long
    ? cutsceneBudgetSeconds(cfg.cutsceneMaxSeconds, assets.durationSeconds ?? 45)
    : cfg.cutsceneMaxSeconds;
  // LONG_INDEX_FIRST: the game's own scenes keep a chapter's allowance; its trailers and gameplay give way instead.
  return reconcileCutsceneBudgets(assets.clips ?? [], jobs, limit, { cutscenesFirst: long && cfg.longIndexFirst && perChapter });
}

/** The long-form 16:9 render: its own plan, composition, QA band and thumbnail. */
async function stepRenderLong(s: Services, ep: Episode): Promise<void> {
  const dir = episodeDir(s.cfg, ep.id);
  const script = ep.script_json!;
  const assets = { ...(ep.assets_json ?? {}) };
  if (!assets.images) {
    // The shot list is final: the owner gets a "record these moments" list when it covers a game they play.
    // A video about the owner's games waits for their recordings: the list goes out now, and the footage
    // is gathered CAPTURE_GATHER_LEAD_HOURS before the slot.
    const holdUntil = await captureHold(s, ep);
    if (holdUntil) {
      await s.db.query(
        `UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`,
        [ep.id, holdUntil],
      );
      log("info", "footage waits for the owner's recordings", {
        episode: ep.id,
        until: holdUntil.toISOString(),
      });
      return;
    }
    Object.assign(assets, await gatherMedia(s, ep, dir));
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(assets),
    ]);
  }
  // Murky own play gathered before the brightness floor (or kept by a re-render) is left out here too.
  if (assets.clips?.length) {
    const kept = [];
    for (const c of assets.clips)
      if (!/^Pulse's own gameplay capture/.test(c.provenance ?? "") || ownClipVisible(await sampledLumas(path.join(dir, c.file))))
        kept.push(c);
    if (kept.length < assets.clips.length) {
      log("info", "own gameplay too dark, left out of the render", { episode: ep.id, clips: assets.clips.length - kept.length });
      assets.clips = kept;
      await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(assets)]);
    }
  }
  // Which long-video craft this format gets (src/longformat.ts), each behind its own setting.
  const craft = longCraft(script, s.cfg);
  const kind = longKindLabel(craft.format);
  // Footage first (src/assets/footagestep.ts; owner, 31 Oct 2026: "loads of gameplay footage" instead of stills):
  // before the picture top-up, each released game's chapter gathers licensed gameplay until moving footage can
  // carry FOOTAGE_SHARE_TARGET of its narration, junk refused at intake. Once per video (FOOTAGE_FIRST).
  if (
    s.cfg.footageFirst &&
    s.footageFirstDeps &&
    !assets.footageFirst &&
    assets.images &&
    script.entries?.some((e) => e.moments?.length)
  ) {
    assets.clips ??= [];
    // RETRO_REMASTER_FOOTAGE: a retrospective's reception and legacy chapters may take the remaster's gameplay.
    const retroTopic = isRetrospective(ep.factcheck_json)
      ? (ep.factcheck_json as unknown as { topic: DocTopic }).topic.retro
      : undefined;
    const remasterFootage =
      retroTopic && s.cfg.retroRemasterFootage ? retroRemasterChapters(retroTopic, retroTopic.written ?? []) : [];
    assets.footageFirst = await runFootageFirst({
      deps: s.footageFirstDeps(),
      chapters: [...script.entries]
        .sort((a, b) => b.rank - a.rank)
        .map((e, i) => ({
          entry: i,
          game: e.game_title,
          franchise: script.game_title || e.game_title,
          year: e.year,
          moments: e.moments ?? [],
          sentences: chapterSentences(script, i),
          ...(remasterFootage[i] ? { remasterOk: true } : {}),
        })),
      clips: assets.clips,
      dir,
      options: footageOptions(s.cfg),
      headline: script.headline,
      logEvent: (kind, detail) => logEvent(s.db, ep.id, kind, detail),
      notify: (m) => s.notify(m),
    });
    // A plan made before the new clips existed would never play them.
    if (assets.footageFirst.kept) delete assets.longPlan;
    // Old games' small sources redrawn at 1080 by the local upscaler (src/depthstep.ts, UPSCALE).
    await upscaleOldFootage(
      depthDeps(
        s.cfg,
        (k, d) => logEvent(s.db, ep.id, k, d),
        (m) => s.notify(m),
      ),
      { headline: script.headline, episodeDir: dir, clips: assets.clips },
    ).catch((err) =>
      log("warn", "footage upscaling failed; plain resize kept", {
        error: errorMessage(err),
      }),
    );
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(assets),
    ]);
  }
  // The footage-first pass may add more of the same publisher after cutscenes were gathered.
  if (assets.clips?.some((c) => /^Cutscenes for "/.test(c.provenance))) {
    const allowed = allowedEpisodeCutscenes(s.cfg, script, assets, true, isRetrospective(ep.factcheck_json));
    if (JSON.stringify(allowed) !== JSON.stringify(assets.clips)) {
      assets.clips = allowed;
      delete assets.longPlan;
      await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(assets)]);
    }
  }
  // Every sentence still without a picture or graphic of its own is searched for on its own, once per video
  // (src/assets/fill.ts; owner, 30 Oct 2026: "all videos must be fully media rich all the way through").
  if (
    !assets.filled &&
    assets.images &&
    script.entries?.some((e) => e.moments?.length)
  ) {
    const chapters = [...script.entries]
      .sort((a, b) => b.rank - a.rank)
      .map((e, i) => ({
        entry: i,
        game: e.game_title,
        year: e.year,
        moments: e.moments ?? [],
        sentences: chapterSentences(script, i),
      }));
    assets.clips ??= [];
    // Scene lines nothing filmed can show get a drawn concept sketch, tagged ILLUSTRATION, when switched on
    // (ILLUSTRATE_ENABLED, off by default; src/assets/illustrate.ts). Off, nothing here changes. A server that
    // does not answer (the Mac's sketch service down or its weights missing, or ComfyUI closed on the PC) skips them
    // for this video, said once; a sketch that is late or fails later leaves its line on the normal footage.
    const sketchesUp =
      s.cfg.illustrate &&
      (s.cfg.illustrateStub ||
        (await sketchReachable(s.cfg.illustrateUrl, s.cfg.illustrateBackend)));
    if (s.cfg.illustrate && !sketchesUp) {
      await logEvent(s.db, ep.id, "sketches_skipped", {
        url: s.cfg.illustrateUrl,
      });
      await s.notify({
        level: "info",
        content: `${kind} "${script.headline}": no concept sketches this time, because the sketch server (${s.cfg.illustrateBackend === "comfy" ? "ComfyUI" : "the sketch service, mac/sketch.sh"} at ${s.cfg.illustrateUrl}) is not answering. Those lines get a graphic or stay on the game's pictures. Setting: ILLUSTRATE_URL.`,
      });
    }
    const sketches = sketchesUp
      ? createSketchRun({
          llm: s.llm,
          dir,
          episodeId: ep.id,
          url: s.cfg.illustrateUrl,
          backend: s.cfg.illustrateBackend,
          max: s.cfg.illustrateMax,
          stub: s.cfg.illustrateStub,
          timeoutMs: s.cfg.illustrateTimeoutSeconds * 1000,
          budgetMs: s.cfg.illustrateBudgetSeconds * 1000,
        })
      : undefined;
    // MATCH_SEMANTIC: the chapter's own pictures and clips the meaning model is sure of are pinned before the editor's
    // pass over the bin (src/semantic/stills.ts); the services are borrowed as they are, only the pin is added.
    const semDeps = s.cfg.semantic.enabled
      ? Object.assign(Object.create(s) as typeof s, {
          semanticPin: async (ch: Parameters<typeof pinChapterMoments>[3], open: number[], images: Parameters<typeof pinChapterMoments>[5], clips: Parameters<typeof pinChapterMoments>[6]) => {
            const pins = await pinChapterMoments(embedderFor(s.cfg.dataDir, s.cfg.semantic), dir, path.join(dir, `entry_${ch.entry}`, "fill"), ch, open, images, clips, { ...s.cfg.semantic, background: await backgroundFor(s.cfg.dataDir, s.cfg.semantic, ch.game ?? "") });
            if (pins.length) await logEvent(s.db, ep.id, "semantic_pins", { entry: ch.entry, pins }).catch(() => undefined);
            return pins.length;
          },
        })
      : s;
    const r = await fillSentencePictures(
      semDeps,
      dir,
      chapters,
      assets.images,
      assets.clips,
      script.game_title || script.headline,
      scopeOf(script),
      sketches?.forChapter,
      { stockThemeMax: s.cfg.stockThemeMax },
    );
    assets.filled = { before: r.before, after: r.after };
    // AI_IMAGE_GATE (src/reviewer.ts): no AI-made picture that could pass for official game material or a photo.
    if (s.cfg.aiImageGate && assets.images?.length) {
      const dropped = await gateAiImages(assets.images, dir);
      if (dropped.length) await logEvent(s.db, ep.id, "ai_image_gate", { dropped });
    }
    // What the newer picture libraries gave the whole video, in its log and the owner's note.
    await reportLibraries(
      s,
      ep.id,
      `${kind} "${script.headline}"`,
      assets.images ?? [],
      assets.clips ?? [],
    );
    if (r.stockCapped) {
      await logEvent(s.db, ep.id, "stock_themes_capped", {
        skipped: r.stockCapped,
        max: s.cfg.stockThemeMax,
      });
      await s.notify({
        level: "info",
        content: `${kind} "${script.headline}": ${r.stockCapped} stock clip${r.stockCapped === 1 ? "" : "s"} not fetched because the video already has ${s.cfg.stockThemeMax} of that theme (such as "office at night"); those lines get a graphic or stay on the game's footage. Setting: STOCK_THEME_MAX.`,
      });
    }
    if (sketches) {
      const sum = sketches.summary();
      assets.sketches = sum;
      await logEvent(s.db, ep.id, "sketches", {
        ...sum,
        animated: s.cfg.sketchAnimation,
      });
      if (sum.asked)
        await s.notify({
          level: "info",
          content: `${kind} "${script.headline}": ${sum.kept} concept sketch${sum.kept === 1 ? "" : "es"} drawn for lines nothing filmed can show (${sum.asked} asked, ${sum.dropped} refused by the picture editor, ${sum.failed} not drawn; ${sum.seconds}s). Each is tagged ILLUSTRATION on screen${s.cfg.sketchAnimation ? " and animated: drawn on, stop-motion paper, flipbook, light table or cork board (SKETCH_ANIMATION)" : " as a framed print (SKETCH_ANIMATION=false)"}. Setting: ILLUSTRATE_ENABLED.`,
        });
      // A few kept sketches of lines with movement come to life on this PC's video model (off by default).
      if (s.cfg.illustrateVideo && sum.kept)
        await animateSketches({
          chapters: chapters as never,
          images: assets.images,
          clips: assets.clips as never,
          dir,
          episodeId: ep.id,
          url: s.cfg.illustrateVideoUrl,
          max: s.cfg.illustrateVideoMax,
          stub: s.cfg.illustrateVideoStub,
          timeoutMs: s.cfg.illustrateVideoTimeoutSeconds * 1000,
          headline: script.headline,
          logEvent: (kind, detail) => logEvent(s.db, ep.id, kind, detail),
          notify: (m) => s.notify(m),
        });
    }
    // The graphics pass writes into the shot list (script.entries[].moments), so the script is kept too.
    await s.db.query(
      `UPDATE episodes SET assets_json = $2, script_json = $3 WHERE id = $1`,
      [ep.id, JSON.stringify(assets), JSON.stringify(script)],
    );
  }
  // A filler visual for each long video's line still bare or on stock (kinetic type, a diagram, a document, a
  // drawn scene, silhouettes or an in-game reconstruction; src/assets/fillers.ts), once per video and behind
  // FILLERS_ENABLED. The picks are written on the shot list, so the plan is made again with them.
  if (
    craft.fillers &&
    !assets.fillersChosen &&
    assets.images &&
    script.entries?.some((e) => e.moments?.length)
  ) {
    // EXPLAINERS (src/explainerstep.ts): the chapters' "how it works" lines are marked first, so the chooser gives
    // them explainer shots. The guard checks every word against the documentary's own narration and graphics.
    const asked = assets as { explainersAsked?: boolean };
    if (explainersOn(s.cfg.explainers, "long") && !asked.explainersAsked) {
      const ordered = [...script.entries].sort((a, b) => b.rank - a.rank);
      await longExplainersStep(
        s,
        ep,
        ordered.map((e, i) => ({
          game: e.game_title,
          sentences: chapterSentences(script, i),
          // Each chapter is checked against its own narration and graphics only.
          source: ((e.moments ?? []) as Array<{ graphic?: { primary?: string; secondary?: string; items?: string[] } }>)
            .flatMap((m) => (m.graphic ? [m.graphic.primary ?? "", m.graphic.secondary ?? "", ...(m.graphic.items ?? [])] : []))
            .join(" "),
          moments: (e.moments ?? []) as never,
          // The chapter's own pictures, so a callout never lands on another game.
          pictures: anatomyPictures(
            (assets.images ?? []).filter((x) => (x as { beatIndex?: number }).beatIndex === i) as never,
            dir,
          ),
        })),
      );
      asked.explainersAsked = true;
      await s.db.query(`UPDATE episodes SET assets_json = $2, script_json = $3 WHERE id = $1`, [
        ep.id,
        JSON.stringify(assets),
        JSON.stringify(script),
      ]);
    }
    const done = await chooseEpisodeFillers({
      explainers: explainersOn(s.cfg.explainers, "long"),
      cardShare: s.cfg.longCardShare,
      // A chapter short of pictures under the cap gets cards before repeats (LONG_THIN_CARD_SHARE).
      ...((s.cfg.longThinCardShare ?? 0) > 0 && (s.cfg.longStillMaxShows ?? 0) > 0
        ? { thin: { share: s.cfg.longThinCardShare, maxShows: s.cfg.longStillMaxShows } }
        : {}),
      chapters: [...script.entries]
        .sort((a, b) => b.rank - a.rank)
        .map((e, i) => ({
          entry: i,
          game: e.game_title,
          year: e.year,
          moments: (e.moments ?? []) as never,
          sentences: chapterSentences(script, i),
        })),
      images: assets.images,
      clips: assets.clips ?? [],
      variant: variantOf(ep.id),
      sketches: s.cfg.illustrate,
      pickedWords: !s.cfg.graphicsFit,
      check: episodeClipCheck(dir),
      now: s.now(),
      headline: script.headline,
      kind,
      logEvent: (kind, detail) => logEvent(s.db, ep.id, kind, detail),
      notify: (m) => s.notify(m),
    });
    if (done) {
      assets.fillersChosen = done;
      delete assets.longPlan;
      await s.db.query(
        `UPDATE episodes SET assets_json = $2, script_json = $3 WHERE id = $1`,
        [ep.id, JSON.stringify(assets), JSON.stringify(script)],
      );
    }
  }
  // Media are kept; everything from here on works this PC, so it waits for a gap between the Shorts.
  if ((await longRenderGap(s, ep)) === undefined) return;
  const duration = (assets.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
  const words = assets.words ?? [];
  // A documentary's breathers open each chapter (assets.breaks, put in when it was voiced).
  const segments = openChaptersAtBreaks(
    buildSegments(segmentInputs(script, Boolean(assets.desk)), words, duration),
    assets.breaks,
  );
  const variant = variantOf(ep.id);
  // The bed none of the last few long videos played (src/render/bedrotation.ts); the house beds rotate from it.
  const musicFile = s.cfg.musicBed
    ? chooseBed(s.cfg.dataDir, BEDS.map((b) => b.file), { ep: ep.id, lane: "long", seed: bedSeed(ep.id) })
    : null;
  // Small old stills upscaled first, so the layers and 3D photos are cut from the sharper copy (src/depthstep.ts).
  const depth = depthDeps(
    s.cfg,
    (k, d) => logEvent(s.db, ep.id, k, d),
    (m) => s.notify(m),
  );
  if (assets.images?.length)
    await upscaleOldStills(depth, {
      headline: script.headline,
      episodeDir: dir,
      images: assets.images,
    }).catch((err) =>
      log("warn", "still upscaling failed", { error: errorMessage(err) }),
    );
  // 2.5D: the wide stills get depth layers on this machine's GPU, once per video (kept in assets).
  if (s.cfg.parallax && s.cfg.parallaxPython && assets.images?.length) {
    const want = assets.images.filter(
      (i) => !i.layers && LAYERED_KINDS.has(i.kind) && i.aspect >= 1.2,
    );
    if (want.length) {
      const made = await makeParallax(
        s.cfg.parallaxPython,
        dir,
        want.map((i) => i.file),
      );
      for (const i of assets.images) {
        const l = made.get(i.file.split(path.sep).join("/"));
        if (l) i.layers = l;
      }
      if (made.size)
        await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
          ep.id,
          JSON.stringify(assets),
        ]);
    }
    // The 3D photo maps for the orbit and the subject pop-out (src/depthstep.ts; DEPTH_ORBIT, SUBJECT_POP).
    const meshed = await meshStills(depth, {
      headline: script.headline,
      episodeDir: dir,
      images: assets.images,
    }).catch(() => 0);
    if (meshed)
      await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
        ep.id,
        JSON.stringify(assets),
      ]);
  }
  // Some pictures were stored without their shape (older episodes, some entry art); measure them now, since
  // the framing and the zoom-to-detail maths need it.
  for (const i of assets.images ?? [])
    if (!Number.isFinite(i.aspect))
      i.aspect = await s
        .imageAspect(path.join(dir, i.file))
        .catch(() => 16 / 9);
  // FILL_FRAME / UPSCALE_STILLS (src/gpuvis/client.ts): portrait pictures extended to 16:9 and low-resolution ones
  // enlarged on the PC's GPU before the long render.
  {
    const gp = await prepareImages(s.cfg, dir, assets.images ?? [], "long");
    if (gp.filled || gp.upscaled) await logEvent(s.db, ep.id, "gpu_pictures", gp);
  }
  const images = (assets.images ?? []).map((i) => ({
    file: i.file,
    sourceUrl: i.sourceUrl,
    named: i.named,
    kind: i.kind,
    aspect: i.aspect,
    beatIndex: i.beatIndex,
    credit: photoCredit(i),
    moment: i.moment,
    label: i.label,
    layers: i.layers,
    // Copies made while a switch was on are not shown once it is off (a retried or re-rendered episode).
    fillFile: s.cfg.fillFrame ? i.fillFile : undefined,
    upFile: s.cfg.upscaleStills ? i.upFile : undefined,
  }));
  // The shot list per entry, in on-screen order (lowest rank first), for sentence-level pictures and graphics.
  const moments = [...(script.entries ?? [])]
    .sort((a, b) => b.rank - a.rank)
    .map((e) => e.moments ?? []);
  // A guide's cards are cleaned again here: later steps add graphics to bare sentences after the script is written.
  if (script.gta_guide)
    for (let e = 0; e < moments.length; e++)
      moments[e] = cleanGuideMoments(script.beats[e]?.narration ?? "", moments[e] as Parameters<typeof cleanGuideMoments>[1]) as (typeof moments)[number];
  const hasMoments = moments.some((m) => m.length);
  // MAP_PINS (src/assets/gamemaps.ts): a sentence naming a place in its game, with nothing else on screen, shows the
  // game's own map in 3D with that place pinned. Only places the game's table has checked; never a guessed spot.
  if (s.cfg.mapPins && hasMoments) {
    const ranked = [...(script.entries ?? [])].sort((a, b) => b.rank - a.rank);
    for (let e = 0; e < moments.length; e++) {
      const sentences = segments.flatMap((seg, i) =>
        seg.kind === "beat" && entryOf(segments, i) === e ? splitSentences(seg.text) : [],
      );
      const game = ranked[e]?.game_title ?? script.game_title;
      if (!moments[e]!.length || sentences.length !== moments[e]!.length) continue;
      const marked = markGameMaps(moments[e]!, sentences, game);
      if (!marked.added.length) continue;
      const staged = await stageGameMaps(marked.moments, dir, path.join(s.cfg.dataDir, "gamemaps"), { before: moments[e] });
      moments[e] = staged.moments;
      await logEvent(s.db, ep.id, "game_maps", { entry: e, game, added: marked.added, failed: staged.failed }).catch(() => undefined);
    }
  }
  // GAME_AUDIO_BED (src/assets/gameaudio.ts): on the test's side, the cutscenes' own sound goes into their clips and
  // the long render's game-sound envelope plays it (under the voice, up in long pauses, silent under a quote).
  const gameAudio = gameAudioOn(s.cfg, ep.id, isRetrospective(ep.factcheck_json));
  const sounded =
    gameAudio && assets.clips?.length
      ? await longSoundClips({
          dir,
          dataDir: s.cfg.dataDir,
          ytdlp: s.cfg.ytdlpPath,
          clips: assets.clips,
          underLufs: s.cfg.gameAudioUnderLufs,
          underGain: GAME_UNDER,
          trailers: s.cfg.gameAudioTrailers,
          trailerVoice: s.cfg.trailerQuotes,
          sfxStems: s.cfg.gameSfxStems,
        })
      : undefined;
  if (s.cfg.gameAudioBed)
    await logEvent(s.db, ep.id, "game_audio", {
      on: gameAudio,
      hearable: (assets.clips ?? []).filter((c) => clipSoundKind(c) !== "none")
        .length,
      ...(sounded
        ? { heard: sounded.heard, skipped: sounded.skipped.slice(0, 12) }
        : {}),
    }).catch(() => undefined);
  const clips = (sounded?.clips ?? assets.clips ?? []).map((c) => ({
    file: c.file,
    durationSeconds: c.durationSeconds,
    beatIndex: c.beatIndex,
    role: c.role,
    moment: c.moment,
    cutsceneMatch: c.cutsceneMatch,
    credit: c.credit,
    audio: c.audio,
    stock: c.stock,
    // The picture check's words for the clip: a freeze frame's label (src/render/camera.ts freezeLabel).
    label: c.label,
    span: c.span,
  }));
  // A sentence's filler visual, read afresh each time: one the graphics check faulted is left out.
  const fillerAt = (e: number, m: number) => {
    if (!s.cfg.fillers || (assets.quietMoments ?? []).includes(`${e}:${m}`))
      return undefined;
    const f = moments[e]?.[m]?.filler;
    return f && s.cfg.graphicsFit
      ? wholeLineFiller(f, moments[e]?.[m]?.emphasis)
      : f;
  };
  const makePlan = () =>
    buildLongPlan({
      segments,
      words,
      durationSeconds: duration,
      images: images.map((i) => ({
        kind: i.kind,
        aspect: i.aspect,
        beatIndex: i.beatIndex,
        moment: i.moment,
        file: i.file,
        sourceUrl: i.sourceUrl,
        named: i.named,
      })),
      clips: clips.map((c) => ({
        durationSeconds: c.durationSeconds,
        beatIndex: c.beatIndex,
        role: c.role,
        moment: c.moment,
        cutsceneMatch: c.cutsceneMatch,
        span: c.span,
        stock: c.stock,
      })),
      // Footage first: a chapter never replays a moment it has shown (FOOTAGE_FIRST).
      noRepeats: s.cfg.footageFirst,
      sameGame: sameGameGroups(script),
      noStockOn: s.cfg.longStockNotOnPeople
        ? moments.map((e, i) =>
            linesNamingPeople(e, chapterSentences(script, i), moments.flat()),
          )
        : undefined,
      // No one still too long in any minute (LONG_SAME_PICTURE_MAX_SECONDS, src/render/picturecap.ts).
      samePictureMaxSeconds: s.cfg.longSamePictureMaxSeconds,
      stillXfadeFrames: s.cfg.longStillXfadeFrames,
      variant,
      // Real-world photos only on their own sentence (REAL_PHOTOS_PINNED_ONLY; 31 Oct 2026 owner review).
      realPinnedOnly: s.cfg.realPhotosPinnedOnly,
      momentCounts: hasMoments ? moments.map((m) => m.length) : undefined,
      momentKeys: hasMoments
        ? moments.map((e) => e.map(momentKeys))
        : undefined,
      // Each sentence's filler visual (src/assets/fillers.ts) opens it on its own shot.
      momentFillers: hasMoments
        ? moments.map((e, ei) => e.map((_, mi) => fillerAt(ei, mi)))
        : undefined,
      // What each sentence says, shows and names, so the cold open can preview its chapters: a cold-open line
      // that restates a chapter's fact ("production was meant to end by July 1, 1996") finds that sentence's
      // own picture (30 Oct 2026 shot audit: the cold open matched nothing and played unrelated photos).
      momentShows: hasMoments
        ? moments.map((e, i) => {
            const said = chapterSentences(script, i);
            return e.map(
              (m, k) =>
                `${said[k] ?? ""} ${m.show} ${m.person ?? ""} ${m.keywords?.join(" ") ?? ""}`,
            );
          })
        : undefined,
      takeEntry: script.take_entry,
      // The cut rhythm, a ranking's per-entry pace and the bookend ending (src/render/structure.ts).
      rhythm: craft.rhythm,
      entryPace: craft.entryPace,
      bookend: craft.bookend,
      coldOpenFrames: craft.coldOpen ? coldOpenTiming(LONG_FPS).frames : 0,
      // Footage before stills, stills as brief accents (LONG_MOVING_FIRST, LONG_ACCENT_STILL_SECONDS).
      movingFirst: s.cfg.longMovingFirst,
      accentStillFrames: Math.round(s.cfg.longAccentStillSeconds * LONG_FPS),
      // A clip cut short keeps its unseen rest for a later shot (LONG_CLIP_REMAINDERS).
      clipRemainders: s.cfg.longClipRemainders,
      // A retrospective is one game: its opening and closing may play footage from its chapters (LONG_MOVING_FIRST).
      oneGame: isRetrospective(ep.factcheck_json) || Boolean(script.gta_guide),
      // LONG_OPENING_CONTRACT=fix: the first two minutes cut about twice as fast as the body (src/render/structure.ts).
      twoSpeed: s.cfg.longOpeningContract === "fix",
      // No picture on screen past LONG_STILL_MAX_SHOWS times, every copy counted as one (src/render/stillcap.ts).
      stillMaxShows: script.gta_guide ? GUIDE_STILL_MAX_SHOWS : (s.cfg.longStillMaxShows ?? 0),
      // A ranking chapter's footage before its stills (LONG_MIN_MOVING_SHARE): only a ranking's gather asks its
      // trailers for that share, so documentaries and the rest keep LONG_MOVING_FIRST's own say.
      minMovingShare: script.evergreen_format === "ranking" ? (s.cfg.longMinMovingShare ?? 0) : 0,
    });
  const freshPlan = !assets.longPlan;
  let plan = assets.longPlan ?? makePlan();
  // LONG_OPENING_CONTRACT check or fix: the plan's two speeds go on the record (openingPace), the plan unchanged by it.
  if (freshPlan && s.cfg.longOpeningContract !== "off")
    await logEvent(s.db, ep.id, "long_contract_pace", {
      mode: s.cfg.longOpeningContract,
      ...openingPace(plan),
    });
  if (!assets.longPlan) {
    // Real-world photos pinned to no sentence stay off screen (REAL_PHOTOS_PINNED_ONLY): say how many.
    const withheld =
      hasMoments && s.cfg.realPhotosPinnedOnly
        ? images.filter((i) => realWorldImage(i) && i.moment === undefined)
            .length
      : 0;
    if (withheld)
      await logEvent(s.db, ep.id, "real_photos_withheld", { count: withheld });
    // An entry left on the plate or looping its few clips gets official screenshots from IGDB, then a new plan.
    const ranked = [...(script.entries ?? [])].sort((a, b) => b.rank - a.rank);
    const gaps = planGaps(
      plan,
      segments,
      script.take_entry,
      s.cfg.longSamePictureMaxSeconds,
      // With LONG_STILL_MAX_SHOWS on, every copy of one picture counted as one (src/render/stillcap.ts).
      (s.cfg.longStillMaxShows ?? 0) > 0 ? images : undefined,
    );
    let added = 0;
    for (const g of gaps) {
      const entry = ranked[g.entry];
      if (!entry) continue;
      // The IGDB pictures this entry already has are skipped: IGDB lists a game's pictures in one order, so the
      // top-up used to download the first eight again and add nothing new (Mass Effect ranking, 25 Nov 2026).
      const held = new Set(
        (assets.images ?? []).flatMap((i) => {
          const k = pictureKey(i);
          return k.startsWith("igdb:") ? [k.slice(5)] : [];
        }),
      );
      const more = await s
        .igdbArt(
          entry.game_title,
          entry.year,
          path.join(dir, `entry_${g.entry}`, "more"),
          8,
          held,
        )
        .catch(() => [] as VisualAsset[]);
      for (const a of more.filter((x) => x.kind !== "capsule")) {
        const file = path.join(`entry_${g.entry}`, "more", a.file);
        if ((assets.images ?? []).some((i) => i.file === file)) continue;
        // The same IGDB picture the entry already has, under a new folder, is no new picture (Mass Effect ranking,
        // 25 Nov 2026: every "more" picture was a second copy, and each copy was counted and shown apart).
        const key = pictureKey({ sourceUrl: a.sourceUrl, file });
        if ((assets.images ?? []).some((i) => pictureKey(i) === key)) continue;
        const aspect = await s
          .imageAspect(path.join(dir, file))
          .catch(() => 16 / 9);
        const img = { ...a, file, aspect, beatIndex: g.entry };
        (assets.images ??= []).push(img);
        images.push({
          file,
          sourceUrl: a.sourceUrl,
          named: undefined,
          kind: a.kind,
          aspect,
          beatIndex: g.entry,
          credit: photoCredit(img),
          moment: undefined,
          label: undefined,
          layers: undefined,
          fillFile: undefined,
          upFile: undefined,
        });
        added++;
      }
    }
    if (added) plan = makePlan();
    const left = planGaps(
      plan,
      segments,
      script.take_entry,
      s.cfg.longSamePictureMaxSeconds,
      // With LONG_STILL_MAX_SHOWS on, every copy of one picture counted as one (src/render/stillcap.ts).
      (s.cfg.longStillMaxShows ?? 0) > 0 ? images : undefined,
    );
    if (gaps.length)
      log(left.length ? "warn" : "info", "thin entries topped up", {
        episode: ep.id,
        before: gaps,
        added,
        after: left,
      });
    if (left.length)
      await s.notify({
        content: `🖼️ "${script.headline}" is short of pictures for ${left.map((g) => ranked[g.entry]?.game_title ?? `entry ${g.entry}`).join(", ")} (${left.map((g) => (g.plateSeconds > 15 ? `${g.plateSeconds}s on the plain background` : `a shot shown ${g.maxRepeat} times`)).join("; ")}). It renders anyway.`,
      });
  }
  assets.longPlan = plan;
  // A video never renders on the empty slate: everything to fill it has been tried by here, so this one stops and says.
  if (hasMoments) {
    const slate = planSlate({
      plan,
      windows: momentWindows(
        segments,
        words,
        moments.map((m) => m.length),
        moments.map((e) => e.map(momentKeys)),
      ),
      moments,
      quiet: assets.quietMoments,
      clips: assets.clips,
    });
    await logEvent(s.db, ep.id, "slate_share", {
      share: Math.round(slate.share * 1000) / 1000,
      plate: Math.round(slate.plateShare * 1000) / 1000,
      footage: Math.round(slate.footageShare * 1000) / 1000,
    });
    if (slate.share > s.cfg.planSlateMax) {
      const line = `${Math.round(slate.share * 100)}% of the video would sit on the empty slate (the most allowed is ${Math.round(s.cfg.planSlateMax * 100)}%)`;
      await s.notify({
        ping: true,
        content: `🛑 Stopped "${script.headline}" before its render: ${line}. Its chapters have too little media. Nothing was rendered.`,
      });
      throw new FatalError(`empty slate: ${line}`);
    }
  }
  // Every long render: the share of its narration over moving footage and of its runtime on stills (src/qa/movingshare.ts),
  // for the growth report's QA line.
  if (freshPlan) {
    const ms = movingShare({ shots: plan.shots, fps: plan.fps, words, clips: assets.clips ?? [] });
    await logEvent(s.db, ep.id, "moving_share", {
      ...ms,
      // What the planner did: LONG_MOVING_FIRST, or a ranking under LONG_MIN_MOVING_SHARE.
      movingFirst:
        s.cfg.longMovingFirst ||
        (script.evergreen_format === "ranking" && (s.cfg.longMinMovingShare ?? 0) > 0),
    }).catch(() => undefined);
    // LONG_STILL_MAX_SHOWS and LONG_MIN_MOVING_SHARE: each chapter's share of moving footage, the most any one picture
    // was shown (every copy counted as one) and what went past the cap, so a thin chapter is named, not guessed at.
    const audit = chapterPictureAudit(plan, segments, images, script.take_entry);
    await logEvent(s.db, ep.id, "still_cap", {
      max: s.cfg.longStillMaxShows ?? 0,
      minMovingShare: s.cfg.longMinMovingShare ?? 0,
      notes: plan.notes ?? null,
      ...audit,
    }).catch(() => undefined);
  }
  // How much of the game chapters' narration plays on moving game footage, against FOOTAGE_SHARE_TARGET.
  if (freshPlan && hasMoments && s.cfg.footageFirst) {
    const fm = measureFootage({
      shots: plan.shots,
      fps: plan.fps,
      segments,
      entryOf: (i) => entryOf(segments, i, script.take_entry),
      clips: assets.clips ?? [],
    });
    await logEvent(s.db, ep.id, "footage_share", {
      share: Math.round(fm.share * 1000) / 1000,
      target: s.cfg.footageShareTarget,
      stock: Math.round(fm.stock),
      perChapter: Object.fromEntries(
        [...fm.perChapter].map(([c, x]) => [c, Math.round(x * 100) / 100]),
      ),
    });
    await s.notify({
      level: "info",
      content: footageShareNotice(
        script.headline,
        fm,
        s.cfg.footageShareTarget,
        [...(script.entries ?? [])]
          .sort((a, b) => b.rank - a.rank)
          .map((e) => e.game_title),
      ),
    });
  }
  // How much of the narration has something chosen for its own words on screen: a picture or clip of its own,
  // or a graphic (29 Oct 2026 review: barely one shot in ten matched; 30 Oct, owner: every video must be media
  // rich all the way through). Logged for every long video; the owner hears when under MEDIA_RICH_TARGET.
  if (hasMoments) {
    const own = matchedShare(moments, images, clips);
    const covered = coverageShare(
      moments.map((m, i) => ({
        entry: i,
        game: "",
        moments: m,
        sentences: [],
      })),
      images,
      clips,
    );
    log(
      covered < MEDIA_RICH_TARGET ? "warn" : "info",
      "sentences with their own picture",
      {
        episode: ep.id,
        share: Math.round(own * 100),
        covered: Math.round(covered * 100),
      },
    );
    if (covered < MEDIA_RICH_TARGET)
      await s.notify({
        content: `🎞️ "${script.headline}": ${Math.round(covered * 100)}% of its sentences have something chosen for their own words (${Math.round(own * 100)}% a picture or clip of their own, the rest a graphic), under the ${Math.round(MEDIA_RICH_TARGET * 100)}% target. It renders anyway; the rest sit on the chapter's footage.`,
      });
  }
  // Each game's own colour, from its key art (src/assets/palette.ts): its chapter's footage is washed in it.
  if (!assets.palette) {
    const entries = [
      ...new Set(
        images
          .map((i) => i.beatIndex)
          .filter((b): b is number => b !== undefined),
      ),
    ];
    const palette: Array<string | null> = [];
    for (const b of entries) {
      const art =
        images.find((i) => i.beatIndex === b && i.kind === "hero") ??
        images.find(
          (i) => i.beatIndex === b && i.aspect >= 1.2 && i.kind !== "photo",
        );
      palette[b] = (art && (await paletteOf(path.join(dir, art.file)))) || null;
    }
    assets.palette = palette;
  }
  // Zoom to the detail: a sentence that names something on screen gets the camera pushed in on it, with a
  // label, when the local vision model finds it in that picture. At most one every 40 s, 30 a video.
  if (s.cfg.annotate && hasMoments && !assets.annotations) {
    const ws = momentWindows(
      segments,
      words,
      moments.map((m) => m.length),
      moments.map((e) => e.map(momentKeys)),
    );
    const ranked = [...(script.entries ?? [])].sort((a, b) => b.rank - a.rank);
    const found: NonNullable<EpisodeAssets["annotations"]> = [];
    let lastAt = -Infinity;
    for (const w of ws) {
      if (found.length >= 30) break;
      const m = moments[w.entry]?.[w.moment];
      if (!m || m.graphic.kind !== "none" || w.moment === 0) continue;
      const from = Math.round(Math.max(w.start, w.at - 0.15) * LONG_FPS);
      if (from - lastAt < 40 * LONG_FPS) continue;
      const shot = plan.shots.find((x) => from >= x.start && from < x.end);
      if (
        !shot ||
        shot.media.type !== "image" ||
        shot.end - from < 3.5 * LONG_FPS
      )
        continue;
      const img = assets.images?.[shot.media.index];
      if (!img || !LAYERED_KINDS.has(img.kind)) continue;
      const label = annotationLabel(
        m,
        ranked[w.entry]?.game_title ?? script.game_title,
      );
      if (!label) continue;
      const box = await locate(path.join(dir, img.file), label);
      if (!box) continue;
      found.push({
        entry: w.entry,
        moment: w.moment,
        image: shot.media.index,
        box,
        label,
      });
      lastAt = from;
    }
    assets.annotations = found;
    await unloadLocalVision();
    log("info", "detail annotations", { episode: ep.id, count: found.length });
  }
  // Named details written in the pictures (src/assets/ocr.ts): a sign or shop front the narrator names gets
  // a hand-drawn circle or arrow from the long video's camera (LONG_CAMERA detail). Once per video.
  // The orbit needs its own switch: the depth camera's maps (PARALLAX_DEEP) must not start orbits on their own.
  const docCamera = s.cfg.depthOrbit ? craft.camera : craft.camera.filter((t) => t !== "orbit");
  if (docCamera.length && hasMoments && !assets.textDetails) {
    assets.textDetails = !docCamera.includes("detail")
      ? []
      : await findTextDetails({
      dir,
      fps: LONG_FPS,
      windows: momentWindows(
        segments,
        words,
        moments.map((m) => m.length),
        moments.map((e) => e.map(momentKeys)),
      ),
      moments,
      keys: (e, m) => (moments[e]?.[m] ? momentKeys(moments[e]![m]!) : []),
      shots: plan.shots,
      images,
      brands: [
        script.game_title,
        ...(script.entries ?? []).map((x) => x.game_title),
        "Rockstar",
        "Take-Two",
      ],
      });
    await logEvent(s.db, ep.id, "camera", {
      techniques: docCamera,
      textDetails: assets.textDetails.map((d) => d.label),
    });
    await s.notify({
      level: "info",
      content: cameraNotice(
        script.headline,
        docCamera,
        assets.textDetails.length,
        kind,
      ),
    });
  }
  await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
    ep.id,
    JSON.stringify(assets),
  ]);
  const doc = script.evergreen_format === "documentary";
  // Which craft this long video gets, for the log (src/longformat.ts); once per render attempt.
  await logEvent(s.db, ep.id, "long_craft", longCraftEvent(craft));
  // What the mix will do with the writer's beats and the era beds (src/render/sounddesign.ts), logged and
  // told to the owner in one line; DOC_SOUND_BEATS off means neither.
  if (craft.soundBeats && hasMoments) {
    const sound = soundDesignSummary(
      moments,
      [...(script.entries ?? [])]
        .sort((a, b) => b.rank - a.rank)
        .map((e) => e.year),
      true,
    );
    await logEvent(s.db, ep.id, "sound_design", { ...sound });
    if (sound.total || sound.chapters)
      await s.notify({
        content: soundDesignLine(script.headline, sound, kind),
      });
  }
  // The structure devices (src/render/structure.ts): title drop, chapter index and year, callbacks, cut
  // rhythm, bookend ending; logged and told to the owner in one line. A plan made before them keeps its cuts.
  const docLoops = loopsFor(craft, script.open_loops, () =>
    loopsOfScript(script),
  );
  {
    const structure = structureSummary({
      segments,
      words,
      windows: hasMoments
        ? momentWindows(
            segments,
            words,
            moments.map((m) => m.length),
            moments.map((e) => e.map(momentKeys)),
          )
        : [],
      fps: LONG_FPS,
      breaks: (assets.breaks ?? []).map((b) => ({
        from: Math.round(b.start * LONG_FPS),
        to: Math.round(b.end * LONG_FPS),
      })),
      loops: docLoops,
      plan,
      on: {
        titleDrop: craft.titleDrop,
        chapterIndex: craft.chapterIndex,
        loops: craft.loops !== "off",
        rhythm: craft.rhythm && freshPlan,
        bookend: craft.bookend,
        entryPace: craft.entryPace,
      },
    });
    await logEvent(s.db, ep.id, "doc_structure", {
      ...structure,
      format: craft.format,
    });
    await s.notify({
      content: structureLine(script.headline, structure, kind),
    });
  }
  // The documentary's sound craft (src/render/soundfx.ts, SOUND_* settings): the voice's texture slices made
  // now, and what the mix will place, logged and told to the owner in one line.
  const soundCraft = doc ? s.cfg.soundCraft : undefined;
  let voiceFxFiles: SoundCraftPrep["voiceFxFiles"] = [];
  if (soundCraft && Object.values(soundCraft).some(Boolean)) {
    const prep = await prepareSoundCraft({
      episodeDir: dir,
      voiceFile: assets.audio,
      craft: soundCraft,
      segments,
      words,
      moments: moments.map((ms) =>
        ms.map((m) => ({
          ...m,
          beat: s.cfg.docSoundBeats ? m.beat : undefined,
        })),
      ),
      breaks: assets.breaks,
      shots: plan.shots,
      clips,
      fps: LONG_FPS,
    }).catch((err) => {
      log("warn", "sound soundCraft prep failed", {
        episode: ep.id,
        error: errorMessage(err),
      });
      return undefined;
    });
    voiceFxFiles = prep?.voiceFxFiles ?? [];
    await logEvent(s.db, ep.id, "sound_craft", {
      settings: soundCraft,
      counts: prep?.counts,
      failedSlices: prep?.failed ?? 0,
    });
    if (prep)
      await s.notify({
        level: "info",
        content: soundCraftLine(script.headline, soundCraft, prep.counts),
      });
  }
  // Two alternative titles for the Test & compare (one mid-tier call; a failure only means no title test).
  if (!script.youtube.title_variants) {
    // TITLE_ANGLES: three angles written, the two most distinct from the current title kept (src/editorial/titles.ts).
    const variants = await titleVariants(s.llm, script, {
      angles: s.cfg.titleAngles,
      allow: s.cfg.titleShapeAllow,
    }).catch(() => [] as string[]);
    script.youtube.title_variants = variants;
    // LONG_FACT_DISCIPLINE: a Test & compare variant written after the fact-check never brings back an unproven
    // "Every X" title: it is counted like the main title was, or left out.
    if (s.cfg.longFactDiscipline && script.runtime === "long" && script.evergreen_format === "ranking") {
      const n = script.entries?.length ?? 0;
      script.youtube.title_variants = variants
        .map((v) => countedTitle(v, n) ?? v)
        .filter((v) => !titleClaimsEvery(v));
    }
    await applyTitleShape(s, ep, script);
    await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(script),
    ]);
  }
  // STRAND_FRAMES (src/strandframe.ts): the strand's one title shape and its thumbnail word count, before the designs.
  const strand = await applyStrandFrame(
    s,
    ep,
    script,
    (ep.factcheck_json as { topic?: { format?: string; guide?: unknown } } | null)?.topic,
  );
  if (strand)
    await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(script)]);
  // PACKAGING_PANEL (src/panel/packagingpanel.ts), long videos: the factory's own title candidates (the Packaging Lab's
  // top five when it is on, else the current title and its variants) and thumbnail words, read blind by the audience
  // critic among reference titles when data/frontier/reference_titles.json exists. "check" records its order beside the
  // factory's choice; "on" uses its first choice among our own (never a reference), held to the strand's frame. Before
  // the designs, so the thumbnails carry the words it chose. A failure leaves the packaging as it was.
  const packagingMode = s.cfg.packagingPanel;
  if (packagingPanelRuns(packagingMode, { long: true, script })) {
    const model = packagingAtLeast(s.cfg.packaging, "score") ? loadModel(s.cfg.dataDir) : undefined;
    const lab = model
      ? rankTitles(model, script, s.cfg.packaging.candidates)
          .filter((r) => r.clarity.ok)
          .slice(0, 5)
          .map((r) => ({ text: r.text, origin: r.origin }))
      : undefined;
    const game = script.why_died?.game ?? script.game_title;
    const panel = await runPackagingPanel({
      script,
      mode: packagingMode,
      episodeId: ep.id,
      candidates: packagingCandidates(script, lab),
      references: loadReferenceTitles(s.cfg.dataDir),
      read: (content) => readPackaging(s.llm, content),
      ...(strand
        ? {
            eligible: {
              // The guide's plan fixes its title: only its thumbnail words may move.
              title: (t: string) => strand !== "guide" && !strandTitleProblems(strand, t, game).length,
              thumb: (t: string) => strandThumbWords(strand, t) === t,
            },
          }
        : {}),
    }).catch((err) => {
      log("warn", "packaging panel failed; the packaging stands", { episode: ep.id, error: errorMessage(err) });
      return undefined;
    });
    if (panel) {
      script.youtube = panel.script.youtube;
      script.packaging_panel = panel.record;
      await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(script)]);
      await logEvent(s.db, ep.id, "packaging_panel", packagingPanelEvent(panel.record)).catch(() => undefined);
    }
  }
  const footageCredit = !clips.length
    ? ""
    : script.gta_guide
      ? // GTA_GUIDES: the owner's own play first; a permitted streamer's footage carries its own credit on screen too.
        ["FOOTAGE: PULSE'S OWN PLAY · ROCKSTAR GAMES", ...new Set((sounded?.clips ?? assets.clips ?? []).filter((c) => /^Permitted stream capture/.test(c.provenance ?? "") && c.credit).map((c) => c.credit!.toUpperCase()))].join(" · ")
      : "FOOTAGE: OFFICIAL TRAILERS · STEAM";
  // The thumbnail: the winner's widest art, else the topic's.
  const winnerBeat = (script.entries?.length ?? 0) - 1;
  const thumbArt =
    images.find((i) => i.beatIndex === winnerBeat && i.kind === "hero") ??
    images.find((i) => i.beatIndex === winnerBeat && i.aspect >= 1.2) ??
    images.find((i) => i.beatIndex === undefined && i.aspect >= 1.2) ??
    images[0];
  // Two more designs for YouTube's Test & compare, on the same key art so the test measures the
  // design: full-bleed art and, for a ranking, last place against the winner.
  const wide = (b: number) =>
    images.find((i) => i.beatIndex === b && i.kind === "hero") ??
    images.find((i) => i.beatIndex === b && i.aspect >= 1.2);
  const lastArt = !doc && winnerBeat > 0 ? wide(0) : undefined;
  // The second design: the subject cut out in front of the headline when the art has depth layers (the
  // big creators' trick), else the full-bleed art. The third: last place against the winner for a ranking,
  // the headline as a newspaper cutting for a documentary.
  // APPLE_SUBJECT_LIFT (Mac mini): Apple Vision's foreground mask cuts the thumbnail art's subject out, cleaner
  // than the depth model's nearest layer on busy scenes; the depth layers stay the fallback.
  const lifted =
    s.cfg.appleSubjectLift && thumbArt ? await appleCut(dir, thumbArt.file) : undefined;
  const depthArt =
    (lifted && thumbArt
      ? {
          ...thumbArt,
          layers: { bg: "", mid: "", ...thumbArt.layers, fg: lifted.fg, fgx: lifted.x },
        }
      : undefined) ??
    (thumbArt?.layers ? thumbArt : undefined) ??
    images.find(
      (i) =>
        i.layers &&
        i.kind === "hero" &&
        (i.beatIndex === winnerBeat || i.beatIndex === undefined),
    );
  // The thumbnail overhaul (src/render/ThumbStudio.tsx): every design that suits this video, best first;
  // the first is the thumbnail, the next two go to YouTube's Test & compare. The niche study ranked them:
  // a huge subject with a rim and a few words, a giant number, an old game's nostalgia, a hard versus, a
  // circle on the thing that matters; the older designs stay as fallbacks.
  const tag = script.recap ? "THIS WEEK" : doc ? "DOC" : script.gta_guide ? "GUIDE" : "RANKED";
  const text = thumbTitle(script);
  const entryInfo = (b: number | undefined) => {
    if (b === undefined) return undefined;
    const k = segments.findIndex(
      (x, i) =>
        x.kind === "beat" &&
        (x.visual?.kind === "rank" || x.visual?.kind === "chapter") &&
        entryOf(segments, i) === b,
    );
    const v = k >= 0 ? segments[k]!.visual : undefined;
    return v
      ? {
          year: Number(v.items?.[0]) || undefined,
          game: (v.kind === "rank" ? v.primary : v.secondary) ?? "",
        }
      : undefined;
  };
  // An old game: the thumbnail art's own entry, else the oldest entry with wide art.
  const oldEntry = [thumbArt?.beatIndex, ...images.map((i) => i.beatIndex)]
    .map((b) => ({ b, info: entryInfo(b) }))
    .find((x) => x.info?.year && x.info.year <= 2006 && wide(x.b!));
  const thumbIndex = thumbArt ? images.indexOf(thumbArt) : -1;
  const circled = (assets.annotations ?? []).find(
    (a) => a.image === thumbIndex,
  );
  const base = { headline: text, kicker: tag, game: "", accent: "#FF6B1A" };
  type Candidate = {
    layout: string;
    thumb: Record<string, unknown> & { imageFile: string | null };
  };
  // The video's own look first (src/render/components/motifs): its series', console's or genre's card with
  // the thumbnail's words. Loaded on demand so a motif can never stop a render.
  const motif = await import("./render/components/motifs/index.ts")
    .then(
      (m) =>
        m.motifsFor({
          title: script.headline,
          platforms: "",
          theme: script.recap ? script.headline : script.game_title,
        })[0],
    )
    .catch(() => undefined);
  // Panel-shaped pictures first, one per chapter in turn, logo banners last (src/render/motifpictures.ts):
  // the first six used to be Steam library banners whose empty middle filled the grid's biggest panel.
  const sourceOf = new Map((assets.images ?? []).map((i) => [i.file, i]));
  // Under the hero rule, never a picture of another game (the GTA 6 documentary's Red Dead chapter).
  const motifPictures = motifPictureOrder(
    s.cfg.thumbHeroRule
      ? images.filter((i) => artVerdict(sourceOf.get(i.file)?.provenance, script.game_title) !== "other")
      : images,
  ).map((i) => i.file);
  const candidates: Candidate[] = [
    ...(motif?.card && motifPictures.length
      ? [
          {
            layout: "motif",
            thumb: {
              ...base,
              layout: "motif" as const,
              motif: motif.id,
              game: script.recap ? "" : script.game_title,
              imageFile: thumbArt?.file ?? null,
              fgFile: depthArt?.layers?.fg ?? null,
              pictureFiles: motifPictures,
            },
          },
        ]
      : []),
    ...(depthArt?.layers
      ? [
          {
            layout: "hero",
            thumb: {
              ...base,
              layout: "hero" as const,
              imageFile: depthArt.file,
              fgFile: depthArt.layers.fg,
              subjectX: depthArt.layers.fgx,
            },
          },
        ]
      : []),
    ...(/\d/.test(text) && thumbArt
      ? [
          {
            layout: "number",
            thumb: {
              ...base,
              layout: "number" as const,
              imageFile: thumbArt.file,
            },
          },
        ]
      : []),
    ...(oldEntry
      ? [
          {
            layout: "retro",
            thumb: {
              ...base,
              layout: "retro" as const,
              game: oldEntry.info!.game,
              year: String(oldEntry.info!.year),
              imageFile: wide(oldEntry.b!)!.file,
            },
          },
        ]
      : []),
    // A guide's items are not ranks: no last-against-first clash.
    ...(lastArt && thumbArt && !script.gta_guide
      ? [
          {
            layout: "clash",
            thumb: {
              ...base,
              layout: "clash" as const,
              imageFile: lastArt.file,
              image2File: thumbArt.file,
              labels: [`#${script.entries![0]!.rank}`, "#1"] as [
                string,
                string,
              ],
            },
          },
        ]
      : []),
    ...(circled && thumbArt
      ? [
          {
            layout: "mystery",
            thumb: {
              ...base,
              layout: "mystery" as const,
              imageFile: thumbArt.file,
              focus: [
                circled.box[0],
                circled.box[1],
                circled.box[2] - circled.box[0],
                circled.box[3] - circled.box[1],
              ] as [number, number, number, number],
            },
          },
        ]
      : []),
    ...(doc && thumbArt
      ? [
          {
            layout: "clipping",
            thumb: {
              ...base,
              kicker: "",
              game: script.recap ? "This week" : script.game_title,
              layout: "clipping" as const,
              imageFile: thumbArt.file,
            },
          },
        ]
      : []),
    {
      layout: "split",
      thumb: {
        headline: text,
        kicker: script.recap ? "THIS WEEK" : doc ? "DOCUMENTARY" : "RANKED",
        game: doc
          ? (script.kicker ?? script.game_title).slice(0, 48)
          : script.criterion
            ? thumbCriterion(script.criterion)
            : script.game_title,
        accent: "#FF6B1A",
        imageFile: thumbArt?.file ?? null,
      },
    },
  ];
  // The hero rule (THUMB_HERO_RULE, src/qa/thumbrule.ts): the GTA grid where it applies, then posters on the art
  // that belongs to the game; with no picture to use, the older designs below carry the release.
  const ruled = s.cfg.thumbHeroRule
    ? await heroRuleDesigns({
        images: images.map((i) => ({
          ...i,
          provenance: sourceOf.get(i.file)?.provenance,
          sourceUrl: sourceOf.get(i.file)?.sourceUrl,
        })),
        script,
        dir,
        grid: candidates.find((c) => c.layout === "motif"),
        motifId: motif?.id,
        look: heroLook,
      }).catch(() => [])
    : [];
  const designsAll: Candidate[] = ruled.length
    ? ruled
    : s.cfg.thumbHeroRule
      ? heroRuleFallback(
          candidates.find((c) => c.layout === "split")!,
          script,
          sourceOf.get(thumbArt?.file ?? "")?.provenance,
        )
      : candidates;
  // STRAND_FRAMES: the strand's layout first, and its Test & compare variants the same layout on other art.
  const designs: Candidate[] = strand ? pinStrandLayout(designsAll, strand) : designsAll;
  // GTA_GUIDES: the guide's own thumbnail (src/render/ThumbStudio.tsx GuideThumb) leads, so Test & compare runs it
  // against the current style's two best designs. Without a frame of the owner's footage the designs stay as they are.
  const guideDesign =
    script.gta_guide && isGtaGuide(ep.factcheck_json)
      ? await gtaGuideDesign(s, dir, sounded?.clips ?? assets.clips ?? [], script.gta_guide).catch((err) => {
          log("warn", "gta guide: thumbnail design failed, the current designs stand", { episode: ep.id, error: errorMessage(err) });
          return undefined;
        })
      : undefined;
  if (guideDesign)
    await logEvent(s.db, ep.id, "gta_guide", {
      stage: "thumbnail",
      frame: guideDesign.frame,
      lifted: Boolean(guideDesign.thumb.fgFile),
      logo: Boolean(guideDesign.thumb.image2File),
      words: guideDesign.thumb.headline,
      against: designs.slice(0, 2).map((d) => d.layout),
    }).catch(() => undefined);
  const [mainThumb, ...restThumbs] = guideDesign ? [guideDesign as Candidate, ...designs] : designs;
  const thumbVariants = restThumbs.slice(0, 2).map((c, i) => ({
    file: path.join(dir, i === 0 ? "thumb_b.jpg" : "thumb_c.jpg"),
    thumb: c.thumb as never,
  }));
  // The series grid's own repair (THUMB_MOTIF_REPAIR, src/qa/thumbrepair.ts): its next layout with the
  // pictures in another order, rendered beside it so a failed grid can be swapped for a grid.
  const motifRepair =
    mainThumb?.layout === "motif" && s.cfg.thumbMotifRepair
      ? {
          file: path.join(dir, "thumb_grid_b.jpg"),
          thumb: {
            ...mainThumb.thumb,
            variant: 1,
            pictureFiles: repairPictures(motifPictures),
          } as never,
        }
      : undefined;
  // A poster's repair is the next poster, on another picture, rendered beside it the same way.
  const thumbRepair =
    motifRepair ??
    (ruled.length && mainThumb?.layout === "poster" && restThumbs[2]
      ? {
          file: path.join(dir, "thumb_hero_b.jpg"),
          thumb: restThumbs[2].thumb as never,
        }
      : undefined);
  log("info", "thumbnail designs", {
    episode: ep.id,
    designs: designs.map((c) => c.layout).slice(0, 3),
  });
  // A documentary's end card (DOC_END_CARD): the newest public documentary, decided now and kept on the
  // episode so the description's "Next" line matches the card; its thumbnail is copied in beside the render.
  const endCard = doc && s.cfg.docEndCard;
  const hypeLine = endCard && (await hypeOn(s, script));
  let nextDoc: EpisodeAssets["nextDoc"];
  let nextThumb: string | null = null;
  if (endCard) {
    const next = await latestPublicDocumentary(s.db, s.now(), ep.id);
    nextDoc = next ?? null;
    if (next?.thumb) {
      try {
        await fs.copyFile(
          path.join(episodeDir(s.cfg, next.id), next.thumb),
          path.join(dir, "next_thumb.jpg"),
        );
        nextThumb = "next_thumb.jpg";
      } catch {
        /* that thumbnail is gone (older episodes are pruned): the card shows the title alone */
      }
    }
    assets.nextDoc = nextDoc;
    await logEvent(s.db, ep.id, "end_card", {
      next: next ? { id: next.id, title: next.title } : null,
      thumb: Boolean(nextThumb),
    });
  }
  // The render runs past the narration's tail by the end card; the plan and the chapter marks do not change.
  const renderSeconds = duration + (endCard ? END_CARD_SECONDS : 0);
  // MENTION_* (src/assets/mentions.ts): the mention insets' pictures, found once for the kinds switched on, from what
  // the narration actually says; the composition fits them around its own sentence graphics (Long.tsx).
  {
    const kinds = mentionKinds(s.cfg);
    if (kinds.length && s.findMentions && !mentionsCover(assets.mentions, kinds)) {
      const input = mentionInputOf({ dir, kinds, script: script as never, story: ep.story_json as never, assets: assets as never });
      input.spoken = words.map((w) => w.text).join(" ");
      const items = await s.findMentions(input).catch(() => []);
      assets.mentions = { kinds, items };
      await logEvent(s.db, ep.id, "mention_insets", {
        kinds,
        found: items.map((i) => ({ kind: i.kind, key: i.key, from: i.pictures.map((p) => p.sourceUrl) })),
      }).catch(() => undefined);
    }
  }
  const longMentions = mentionPlacement(s.cfg, assets.mentions, words, { fps: 30, totalFrames: Math.round(renderSeconds * 30) }, "long");
  // BLENDER_SCENES (src/render/blender.ts): the PC renders original 3D for the reveals, breathers, charts, maps and
  // the ending; whatever is not back in time keeps its flat graphic. Never stops the video.
  let blenderFiles: BlenderClip[] = [];
  if (s.cfg.blender.on) {
    try {
      const plan3d = planBlender({
        episodeId: ep.id,
        documentary: doc,
        segments,
        windows: hasMoments
          ? momentWindows(segments, words, moments.map((m) => m.length), moments.map((e) => e.map(momentKeys)))
          : [],
        graphicOf: (e, m) =>
          (assets.quietMoments ?? []).includes(`${e}:${m}`) ? undefined : moments[e]?.[m]?.graphic,
        breaks: assets.breaks,
        images: images.map((i) => ({ file: i.file, kind: i.kind, beatIndex: i.beatIndex })),
        entryOf: (i) => entryOf(segments, i),
        durationSeconds: renderSeconds,
        narrationEnd: words.length ? words[words.length - 1]!.end : duration,
        settings: s.cfg.blender,
        titleDrop: craft.titleDrop,
      });
      if (plan3d.length) {
        blenderFiles = await fetchBlenderClips(plan3d, s.cfg.blender, dir);
        await logEvent(s.db, ep.id, "blender_clips", {
          planned: plan3d.map((r) => ({ scene: r.scene, at: Math.round(r.at), key: r.key })),
          made: blenderFiles.length,
        }).catch(() => undefined);
      }
    } catch (err) {
      log("warn", "3D clips skipped", { episode: ep.id, error: errorMessage(err) });
      blenderFiles = [];
    }
  }
  // EVIDENCE_STYLE (src/evidencestep.ts): a mystery or lore long video in the board arm gets the date cards, the case
  // cards, the red stamps, runs of its stills on the evidence board and the board as every chapter's breather; the
  // plan follows the shot plan as it stands (the graphics check may make it again). Off or plain arm: nothing changes.
  const evidence = await prepareEvidence({
    cfg: s.cfg,
    episodeId: ep.id,
    frame: "long",
    fps: LONG_FPS,
    headline: script.headline,
    title: script.youtube?.title,
    game: script.game_title,
    chapters: segments.flatMap((g) => (g.visual?.kind === "chapter" && g.visual.primary ? [g.visual.primary] : [])),
    kind: doc ? "documentary" : undefined,
    words,
    segments,
    images: (assets.images ?? []).map((i) => ({ file: i.file, kind: i.kind, provenance: i.provenance })),
    dir,
    breaks: assets.breaks,
    event: (kind, detail) => logEvent(s.db, ep.id, kind, detail),
  });
  if (evidence) assets.evidenceArm = evidence.arm;
  // The composition's props, read afresh each time: the graphics check below mutes faulted graphics
  // (quietMoments, quietBreaks) and the render must see the lists as they stand then.
  const longPropsNow = (): LongRenderInput["props"] => ({
        title: script.headline,
        kicker: script.kicker ?? "",
        criterion: script.criterion ?? "",
        spoilers: scopeOf(script) === "campaign",
        recap: !!script.recap,
        guide: !!script.gta_guide,
        theme: script.recap ? script.headline : script.game_title,
        footageCredit,
        endLine: script.recap
          ? "The week's biggest stories every Friday · Shorts every day"
          : script.explained
            ? "The biggest gaming story, explained · Shorts every day"
          : hypeLine
            ? HYPE_END_LINE
          : doc
            ? "A new documentary every month · Shorts every day"
            : "A new ranking every week · Shorts every day",
        moments: hasMoments
          ? moments.map((ms, ei) =>
              ms.map((m, mi) => ({
                show: m.show,
                // A graphic the graphics check faulted is left out (the sentence keeps its picture).
                graphic: (assets.quietMoments ?? []).includes(`${ei}:${mi}`)
                  ? {
                      kind: "none" as const,
                      primary: "",
                      secondary: "",
                      items: [],
                    }
                  : m.graphic,
                emphasis: m.emphasis,
                person: m.person || undefined,
                // The sound editor's cue (src/render/musicplan.ts), when the setting is on.
                beat: s.cfg.docSoundBeats ? m.beat : undefined,
            // The sentence's filler visual (src/assets/fillers.ts), unless the graphics check muted it.
            filler: fillerAt(ei, mi),
              })),
            )
          : undefined,
        segments,
        words,
        durationSeconds: renderSeconds,
        ...(blenderFiles.length ? { blenderFiles } : {}),
        // The documentary bookends (src/render/bookends.ts): the signature opening's line and the end card.
        // A weekly guide opens on its subject: no cold open with the mark (upgrade queue item 18).
        coldOpenLine: craft.coldOpen && !isWeeklyGuide(ep.factcheck_json) ? coldOpenLine(script.hook) : undefined,
    // The structure devices (src/render/structure.ts), each behind its setting, for every long format.
    codeScenes: s.cfg.codeScenes,
    // GAME_LOOK (src/render/gamelook.ts): the graphics in the game's own look where it has a style profile.
    gameLook: s.cfg.gameLook,
    titleDrop: craft.titleDrop,
    chapterIndex: craft.chapterIndex,
    loops: docLoops,
    cutRhythm: craft.rhythm,
    entryPace: craft.entryPace,
    bookendEnding: craft.bookend,
        next: endCard
          ? nextDoc
            ? { title: nextDoc.title, thumbFile: nextThumb }
            : null
          : undefined,
        variant,
        audioFile: assets.audio ?? null,
        musicFile,
        // SIGNATURE_MUSIC: documentaries open on the docs sting, lead with its bed and rise into chapters.
        signature: s.cfg.signatureMusic && doc ? signatureFor(SIGNATURE_LIBRARY, "docs") : undefined,
        // ACE_BEDS: Pulse's own era and genre beds join the music plan's choice (src/render/acebeds.ts).
        extraBeds: s.cfg.aceBeds ? aceExtraBeds(ACE_LIBRARY) : undefined,
        imageFiles: images,
        clipFiles: clips,
        plan,
        ...(() => {
          const board = evidence?.plan(plan.shots, plan.totalFrames);
          return board ? { board } : {};
        })(),
        renderDate: s.now().toISOString().slice(0, 10),
        quoteFiles: quoteRenderFiles(assets, { dialogue: dialogueOn(s.cfg) }),
        ...(longMentions.insets.length ? { mentionFiles: longMentions.insets, mentionMax: longMentions.max } : {}),
        breaks: assets.breaks,
        quietBreaks: assets.quietBreaks,
        palette: assets.palette,
        // The vision model's boxes, then the details read from the pictures' text (src/assets/ocr.ts).
    annotations: [...(assets.annotations ?? []), ...(assets.textDetails ?? [])],
        // The camera grammar (src/render/camera.ts, LONG_CAMERA), every long format.
        camera: docCamera,
        eraBeds: craft.eraBeds,
        // Concept sketches drawn on, stepped, flipped, dissolved or pinned up (src/render/sketchplan.ts).
        sketchAnimation: s.cfg.sketchAnimation,
    // Photos and portraits as instant prints, tape, pins, trays and screens; screenshots in the display
    // of their day (src/render/photoplan.ts).
    photoTreatments: s.cfg.photoTreatments,
    // The depth craft (src/depthstep.ts), each behind its own switch: the subject pop-out, the 3D boxes and the
    // depth camera (SUBJECT_POP, BOX_3D, PARALLAX_DEEP).
    subjectPop: s.cfg.subjectPop,
    box3d: s.cfg.box3d,
    parallaxDeep: s.cfg.parallaxDeep,
    // The research devices (src/render/boldideas.ts), each behind its own switch.
    chapterWall: s.cfg.chapterWall,
    depthType: s.cfg.depthType,
    compareWipe: s.cfg.compareWipe,
    // GTA_KIT (src/render/gtakit.ts): a GTA story's place cards, cash readouts and head-to-heads. Off: absent.
    ...longGtaKitProp(s.cfg.gtaKit, script.game_title),
    // Graphics measure their text to fit (GRAPHICS_FIT).
    graphicsFit: s.cfg.graphicsFit,
    // The documentary's sound craft and the narration's texture slices (src/render/soundfx.ts, voicefx.ts).
    soundCraft,
    voiceFxFiles,
  });
  // GRAPHICS_AUDIT on the sentence graphics (src/gfxauditstep.ts): in fix mode a graphic gone in under half its
  // reading time, or with a wrong figure, is muted like a faulted one (assets.quietMoments).
  if (s.cfg.graphicsAudit !== "off" && hasMoments) {
    const lm = longMoments(script, assets, segmentInputs);
    const mute = await graphicsGateLong(s, ep.id, [lm.moments, lm.narration, lm.sources, lm.spoken]);
    if (mute.length) assets.quietMoments = [...new Set([...(assets.quietMoments ?? []), ...mute])];
  }
  // The graphics check before the render (src/qa/graphicscheck.ts): every graphic and breather as a still
  // from the same composition and props, faulted ones muted, so the full render runs once instead of again
  // per fault. Once per episode; a check that cannot run (no stills service, a browser fault) never stops
  // the render, and the check on the finished video below still catches what it would have.
  const graphicsCtx = {
    headline: script.headline,
    gameTitle: script.game_title,
    format: "graphics" as const,
  };
  // Which sentence graphics the renderer draws at all (src/render/gfxdraws.ts); loaded on demand like the
  // motifs, so the style registry can never stop a render (without it every useful graphic is checked).
  const drawsGraphic = await import("./render/gfxdraws.ts")
    .then((m) =>
      m.graphicDrawsFor(
        segments,
        script.recap ? script.headline : script.game_title,
      ),
    )
    .catch(() => undefined);
  const graphicsInput = () => ({
    windows: hasMoments
      ? momentWindows(
          segments,
          words,
          moments.map((m) => m.length),
          moments.map((e) => e.map(momentKeys)),
        )
      : [],
    graphicOf: (e: number, m: number) => moments[e]?.[m]?.graphic,
    breaks: assets.breaks,
    durationSeconds: duration,
    // Filler shots are checked at their own settle frame (src/render/fillerplan.ts fillerSettle).
    shots: plan.shots,
    // Each graphic at the span the renderer draws it for, and only if it draws (src/render/momentspan.ts).
    momentOf: (e: number, m: number) => moments[e]?.[m],
    draws: drawsGraphic
      ? (e: number, m: number) =>
          !moments[e]?.[m] || drawsGraphic(e, moments[e]![m]!.graphic)
      : undefined,
  });
  // Filler visuals chosen after an earlier pre-pass are checked on their own (the rest were checked then).
  const fillersOnly =
    !!assets.graphicsPrepass &&
    !!assets.fillersChosen &&
    !assets.fillersChosen.checked;
  const fillerKeys = new Set(
    plan.shots
      .filter((sh) => sh.media.type === "filler")
      .map((sh) => `${sh.media.entry}:${sh.media.index}`),
  );
  if (
    s.cfg.visionQa &&
    s.cfg.graphicsPrepass &&
    s.renderLongStills &&
    (!assets.graphicsPrepass || fillersOnly)
  ) {
    const checks = graphicChecks(
      graphicsInput(),
      assets,
      s.cfg.graphicsPrepassMax,
    ).filter((c) => !fillersOnly || fillerKeys.has(c.what));
    if (checks.length) {
      const stillDir = path.join(dir, "qa", "prepass");
      await fs.rm(stillDir, { recursive: true, force: true });
      const items = checks.map((c, i) => ({
        ...c,
        file: path.join(stillDir, `g${i}.jpg`),
      }));
      try {
        await s.renderLongStills({
          episodeDir: dir,
          props: longPropsNow(),
          stills: items.map((c) => ({
            frame: checkFrame(c, LONG_FPS),
            file: c.file,
          })),
          gl: s.cfg.remotionGl,
          browserExecutable: s.cfg.browserExecutable,
        });
        const r = await judgeGraphics(
          items,
          (frames) => s.visionQa(frames, graphicsCtx),
          { secondLook: s.cfg.graphicsSecondLook },
        );
        const muted = muteFaults(assets, r.faulted);
        assets.quietMoments = muted.quietMoments;
        assets.quietBreaks = muted.quietBreaks;
        // A faulted filler gives its sentence back to the chapter's pictures: the plan is made again without it.
        if (
          plan.shots.some(
            (sh) =>
              sh.media.type === "filler" &&
              r.faulted.includes(`${sh.media.entry}:${sh.media.index}`),
          )
        ) {
          plan = makePlan();
          assets.longPlan = plan;
        }
        const prior = fillersOnly ? assets.graphicsPrepass : undefined;
        assets.graphicsPrepass = {
          checked: (prior?.checked ?? 0) + items.length,
          muted: (prior?.muted ?? 0) + r.faulted.length,
          at: s.now().toISOString(),
        };
        if (assets.fillersChosen) assets.fillersChosen.checked = true;
        await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
          ep.id,
          JSON.stringify(assets),
        ]);
        const problems = r.problems.flatMap((p) => p.problems);
        // What drew each fault, biggest first, for the alert and for ranking the causes later.
        const byKind = faultsByKind(r.faulted, (e, m) => {
          const mo = moments[e]?.[m];
          return mo?.filler?.family
            ? `${mo.filler.family} card`
            : mo?.graphic?.kind;
        });
        await logEvent(s.db, ep.id, "graphics_prepass", {
          checked: items.length,
          faulted: r.faulted,
          problems: r.problems,
          byKind,
          ...(r.cleared ? { cleared: r.cleared } : {}),
        });
        log(
          r.faulted.length ? "warn" : "info",
          "graphics checked before the render",
          { episode: ep.id, checked: items.length, muted: r.faulted },
        );
        const content = graphicsNotice(
          script.headline,
          "prepass",
          items.length,
          r.faulted,
          problems,
          byKind,
        );
        const bad = badTextMutes(problems);
        await s.notify(
          bad.length
            ? { ping: true, content: `${badTextAlert(script.headline, bad)}\n${content}` }
            : r.faulted.length
              ? { content }
              : { level: "info", content },
        );
      } catch (err) {
        log("warn", "graphics pre-pass skipped", {
          episode: ep.id,
          error: errorMessage(err),
        });
        await logEvent(s.db, ep.id, "graphics_prepass", {
          skipped: errorMessage(err).slice(0, 300),
        });
      }
      await fs
        .rm(stillDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
  // Again just before the turn is asked for: a breaking Short may have started while the stills were prepared.
  const turnWait = await longRenderGap(s, ep);
  if (turnWait === undefined) return;
  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  const rendered = await s
    .renderLong({
      turnWaitMinutes: turnWait,
      episodeDir: dir,
      outFile: raw,
      posterFile: path.join(dir, "poster.jpg"),
      thumbFile: path.join(dir, "thumb.jpg"),
      thumb: mainThumb!.thumb as never,
      thumbVariants: thumbRepair ? [...thumbVariants, thumbRepair] : thumbVariants,
      concurrency: s.cfg.remotionConcurrency,
      speed: s.cfg.renderSpeed,
      gl: s.cfg.remotionGl,
      browserExecutable: s.cfg.browserExecutable,
      props: longPropsNow(),
    })
    .then(
      () => true,
      (err) => {
        if (err instanceof PcTurnTimeout) return false;
        throw err;
      },
    );
  if (!rendered) {
    log("info", "long render's turn did not come before a Short's window", {
      episode: ep.id,
    });
    return deferLong(s, ep);
  }
  await s.normalise(raw, final);
  await fs.rm(raw, { force: true });
  const tech = await s.technicalQa(final, renderSeconds, {
    minSeconds: 180,
    // The breathers are on top of the narration cap.
    maxSeconds:
      (doc ? s.cfg.docMaxSeconds : s.cfg.longformMaxSeconds) +
      60 +
      (assets.breaks ?? []).reduce((n, b) => n + b.end - b.start, 0),
    width: 1920,
    height: 1080,
    // An old game's last shot switches off like a tube just before the next chapter: meant, not a flash.
    chapterStarts: segments
      .filter(
        (g, i) =>
          i > 0 &&
          g.kind === "beat" &&
          (g.visual?.kind === "chapter" || g.visual?.kind === "rank"),
      )
      .map((g) => g.start),
  });
  let vision: VisionQa | undefined;
  let times: number[] = [];
  if (tech.ok && s.cfg.visionQa) {
    const marks = segments
      .map((g) => g.start + 2)
      .filter((t) => t > 1 && t < duration - 2);
    const step = Math.max(1, Math.ceil(marks.length / 6));
    times = [
      1.5,
      ...marks.filter((_, i) => i % step === 0),
      duration - 2,
    ].slice(0, 8);
    // Never mid-way through a graphic's entrance (src/qa/graphicscheck.ts clearOfEntrances).
    times = clearOfEntrances(times, graphicsInput().windows);
    await fs.rm(path.join(dir, "qa"), { recursive: true, force: true });
    const frames = await s.extractFrames(final, path.join(dir, "qa"), times);
    vision = await s.visionQa(frames, {
      headline: script.headline,
      gameTitle: script.game_title,
      format: "long",
    });
  }
  const qa = {
    technical: tech,
    vision: vision ?? null,
    rubric: null,
    checked_at: s.now().toISOString(),
  };
  const visionProblems =
    vision?.verdict === "fail"
      ? vision.problems.length
        ? vision.problems
        : [`vision QA failed: ${vision.notes || "no reason given"}`]
      : [];
  const problems = [...tech.problems, ...visionProblems];
  if (problems.length > 0) {
    const { longPlan: _dropped, ...withoutPlan } = assets;
    const off = offendingMedia(
      // The technical check's black stretches name where they are: the clip on screen there is swapped too.
      [...visionProblems, ...tech.problems.filter((p) => /black frames \(at /.test(p))],
      times,
      plan,
      { adSwap: s.cfg.qaAdSwap },
    );
    // QA_AD_SWAP: a moment faulted for ad safety is remembered, so no later gather picks it again.
    const banned = rememberUnsafe(
      withoutPlan.clips ?? [],
      off,
      visionProblems.join(" | "),
    );
    if (banned)
      await logEvent(s.db, ep.id, "unsafe_moments_remembered", { keys: banned });
    const dropped = dropOffending(withoutPlan, off);
    if (dropped.clips || dropped.images) {
      log("warn", "faulted media dropped for the retry", {
        episode: ep.id,
        ...dropped,
      });
      await logEvent(s.db, ep.id, "media_dropped", dropped);
    }
    await s.db.query(
      `UPDATE episodes SET qa_json = $2, assets_json = $3 WHERE id = $1`,
      [ep.id, JSON.stringify(qa), JSON.stringify(withoutPlan)],
    );
    throw new Error(`QA failed: ${problems.join(" | ")}`);
  }
  // The graphics check on the finished video (owner, 28 Oct 2026: "do all safely"), now the safety net
  // behind the stills pre-pass above: a sample of the graphics and breathers (GRAPHICS_POSTCHECK_MAX) goes to
  // the vision checker. A fault mutes the graphic and may ask for one more full render, at most
  // GRAPHICS_RERENDER_PASSES times an episode; past that the video is accepted as rendered, the faults stay
  // muted for any later render, and the owner hears which and why either way (src/qa/graphicscheck.ts).
  // A faulted thumbnail is dropped, and a passing design takes the main thumbnail's place if it was that one.
  let thumbFiles = thumbVariants.map((v) => path.basename(v.file));
  let acceptedFaults: string[] | undefined;
  if (s.cfg.visionQa) {
    const sample = graphicChecks(
      graphicsInput(),
      assets,
      s.cfg.graphicsPostcheckMax,
      );
    const frames = sample.length
      ? await s.extractFrames(
        final,
          path.join(dir, "qa", "gfx"),
          sample.map((c) => c.t),
        )
      : [];
    const r = await judgeGraphics(
      sample.map((c, i) => ({ ...c, file: frames[i]! })),
      (fs) => s.visionQa(fs, graphicsCtx),
      );
    for (const p of r.problems)
      await logEvent(s.db, ep.id, "graphics_check", p);
    if (r.faulted.length) {
      const muted = muteFaults(assets, r.faulted);
      assets.quietMoments = muted.quietMoments;
      assets.quietBreaks = muted.quietBreaks;
      const passes = assets.graphicsPasses ?? 0;
      const decision = passDecision(passes, s.cfg.graphicsRerenderPasses);
      await logEvent(s.db, ep.id, "graphics_faulted", {
        faulted: r.faulted,
        decision,
        passes,
        max: s.cfg.graphicsRerenderPasses,
        });
      log("warn", "graphics faulted on the finished video", {
        episode: ep.id,
        faulted: r.faulted,
        decision,
        passes,
      });
      const badText = badTextMutes(r.problems.flatMap((p) => p.problems));
      await s.notify({
        ...(badText.length ? { ping: true } : {}),
        content: `${badText.length ? `${badTextAlert(script.headline, badText)}\n` : ""}${graphicsNotice(
          script.headline,
          decision,
          sample.length,
          r.faulted,
          r.problems.flatMap((p) => p.problems),
        )}`,
      });
      if (decision === "rerender") {
        assets.graphicsPasses = passes + 1;
      const { longPlan: _dropped, ...again } = assets;
      await s.db.query(
        `UPDATE episodes SET qa_json = $2, assets_json = $3 WHERE id = $1`,
        [
          ep.id,
            JSON.stringify({ ...qa, graphics: r.faulted }),
          JSON.stringify(again),
        ],
      );
      throw new Error(
          `graphics check: ${r.faulted.length} graphic(s) left out, rendering again (re-render ${passes + 1} of ${s.cfg.graphicsRerenderPasses})`,
      );
    }
      acceptedFaults = r.faulted;
    }
  }
  const repair = thumbRepair ? path.basename(thumbRepair.file) : undefined;
    const thumbs = ["thumb.jpg", ...thumbFiles, ...(repair ? [repair] : [])];
  const tv = s.cfg.visionQa
    ? await s
      .visionQa(
        thumbs.map((f) => path.join(dir, f)),
        {
          headline: script.headline,
          gameTitle: script.game_title,
          format: "thumbs",
            heroRule: s.cfg.thumbHeroRule,
        },
      )
        .catch(() => undefined)
    : undefined;
  const bad = new Set<string | undefined>(
      tv?.verdict === "fail"
        ? framesNamed(tv.problems)
            .map((n) => thumbs[n - 1])
            .filter(Boolean)
        : [],
    );
  // The rule's own measurements (the words at 168x94), which need no model. Never a block: a failed design only
  // gives way to the next, and with none left the thumbnail stays as rendered.
  const ruleProblems: string[] = [];
  {
    const rendered: Array<[string, unknown]> = [
      ["thumb.jpg", mainThumb!.thumb],
      ...thumbVariants.map((v): [string, unknown] => [path.basename(v.file), v.thumb]),
      ...(thumbRepair ? [[path.basename(thumbRepair.file), thumbRepair.thumb] as [string, unknown]] : []),
    ];
    for (const [name, thumb] of rendered) {
      const t = thumb as { layout?: string; fgFile?: string | null; imageFile?: string | null };
      // The design itself under the rule (19 Nov 2026 review): words that repeat the title, more than three
      // pictures, lines too small to read at 168x94, words cut off.
      let problems: string[] = s.cfg.thumbHeroRule
        ? designProblems(thumb as Record<string, unknown>, script, motif?.id)
        : [];
      if (t.layout === "poster")
        problems = [...problems, ...(await posterProblems(path.join(dir, name), thumb as never))];
      // Any older design that draws a depth cut-out must keep the face whole, rule or no rule.
      else if ((t.layout === "hero" || t.layout === "depth") && t.fgFile && t.imageFile) {
        const face = await heroLook(path.join(dir, t.imageFile));
        if (face?.kind === "face" && face.box)
          problems = await cutoutProblems(path.join(dir, t.fgFile), face.box);
      }
      if (!problems.length) continue;
      bad.add(name);
      ruleProblems.push(`${name}: ${problems.join(", ")}`);
    }
  }
    if (bad.size) {
      await logEvent(s.db, ep.id, "thumbnail_check", {
      problems: [...(tv?.problems ?? []), ...ruleProblems],
      });
      const out = thumbOutcome({ main: "thumb.jpg", variants: thumbFiles, repair, bad });
      if (out.mainFrom)
        await fs.copyFile(path.join(dir, out.mainFrom), path.join(dir, "thumb.jpg"));
      thumbFiles = out.variants;
      if (repair && bad.has("thumb.jpg")) {
        await logEvent(s.db, ep.id, "thumbnail_repair", {
          repaired: out.repaired,
          replacedBy: out.mainFrom ?? null,
        });
      const what = mainThumb?.layout === "motif" ? "series-grid" : "hero";
      const second = mainThumb?.layout === "motif" ? "its second layout with other pictures" : "the next picture";
        await s.notify({
          level: "info",
          content: out.repaired
          ? `🖼️ "${script.headline}": the thumbnail check failed the ${what} thumbnail, so ${second} replaced it (it passed the same check).`
          : `🖼️ "${script.headline}": the thumbnail check failed the ${what} thumbnail and ${second} too, so ${out.mainFrom ? "another design" : mainThumb?.layout === "motif" ? "the grid, as rendered," : "the first design, as rendered,"} is the thumbnail.`,
        });
      }
    }
  // THUMB_CANDIDATES (src/gpuvis/thumbstep.ts): the main poster's art extended and relit on the PC's GPU, drawn as
  // the same poster, and every passing design scored by the local vision model; the top three become the thumbnail
  // and the Test & compare variants. Off, or with the PC's service down, the order above stands.
  if (s.cfg.thumbCandidates && mainThumb?.layout === "poster" && !bad.has("thumb.jpg")) {
    try {
      const { renderLongThumbs } = await import("./render/render.ts");
      const picked = await thumbCandidateStep(dir, mainThumb.thumb as never, ["thumb.jpg", ...thumbFiles], {
        url: s.cfg.gpuvisUrl,
        // The judge runs through the GPU service, inside its orchestrator turn (a 30B model on the shared 4090).
        // The whole step has 15 minutes: the extension, the plate and the ranking rounds share them.
        until: Date.now() + 15 * 60_000,
        ask: remoteAsk(s.cfg.gpuvisUrl, Date.now() + 15 * 60_000),
        render: (file, thumb) => renderLongThumbs({ episodeDir: dir, thumbs: [{ file, thumb: thumb as never }] }),
        // The episode's own seed, so each video's relit candidate has its own light.
        seed: [...ep.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100000,
        // The same checks the rendered designs had: the rule (under THUMB_HERO_RULE), the poster's measures and the
        // release's vision check on thumbnails, which matters most here because these margins were drawn by AI.
        check: async (file, thumb) => {
          const problems = [
            ...(s.cfg.thumbHeroRule ? designProblems(thumb as Record<string, unknown>, script, motif?.id) : []),
            ...(await posterProblems(file, thumb as never)),
          ];
          if (s.cfg.visionQa) {
            const v = await s
              .visionQa([file], { headline: script.headline, gameTitle: script.game_title, format: "thumbs", heroRule: s.cfg.thumbHeroRule })
              .catch(() => undefined);
            if (!v) problems.push("the thumbnail vision check did not answer");
            else if (v.verdict === "fail") problems.push(...(v.problems.length ? v.problems : ["failed the thumbnail vision check"]));
          }
          return problems;
        },
      });
      if (picked) {
        thumbFiles = picked.variants;
        await logEvent(s.db, ep.id, "thumb_candidates", { ...picked });
      }
    } catch (err) {
      log("warn", "THUMB_CANDIDATES step failed; the usual thumbnails stand", { episode: ep.id, error: errorMessage(err) });
    }
  }
  await transition(s.db, ep.id, "voiced", "rendered", {
    assets_json: {
      ...assets,
      video: "short.mp4",
      poster: "poster.jpg",
      thumb: "thumb.jpg",
      thumbVariants: thumbFiles,
      musicFile,
      // When each entry begins (seconds), so its retention can be read off the curve later.
      entryStarts: segments
        .filter(
          (g, i) =>
            g.kind === "beat" &&
            (g.visual?.kind === "rank" || g.visual?.kind === "chapter") &&
            i > 0,
        )
        .map((g) => Math.round(g.start * 10) / 10),
    },
    qa_json: acceptedFaults
      ? { ...qa, graphics: { faulted: acceptedFaults, accepted: true } }
      : qa,
  });
}

/** Everything a Short says in public: title, description, narration, headline and card text, for the launch rules. */
export function publicText(sc: Script): string {
  return [
    sc.youtube.title,
    sc.youtube.description,
    sc.headline,
    narrationOf(sc),
    sc.pulse_take?.on_screen ?? "",
    ...sc.beats.map((b) =>
      [b.visual.primary, b.visual.secondary, ...(b.visual.items ?? [])].filter(Boolean).join(" "),
    ),
  ].join("\n");
}

/** True when the picture check could not look (the PC relay down, VISION_PAID_FALLBACK off: src/qa/vision.ts). */
export function visionSkipped(v: VisionQa | undefined | null): boolean {
  return !!v && (v === VISION_SKIPPED || v.notes === VISION_SKIPPED.notes);
}

/** Waits a quarter of an hour for the picture checker; the owner hears once per Short. */
async function holdForVision(s: Services, ep: Episode): Promise<void> {
  await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [
    ep.id,
    new Date(s.now().getTime() + 15 * 60_000),
  ]);
  const [told] = await s.db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'vision_hold'`,
    [ep.id],
  );
  if (Number(told?.n ?? 0) > 0) return;
  await logEvent(s.db, ep.id, "vision_hold", {});
  await s
    .notify({
      level: "info",
      content: `"${ep.story_json.headline}" waits for the PC picture checker: it uses third-party pictures, so it is not rendered or posted unchecked. It goes ahead by itself when the checker is back.`,
    })
    .catch(() => undefined);
}

/** A Short that is our own reading, not a report of someone else's news: a ranking, a list, a Why. */
export function ownWorkShort(
  script: Pick<Script, "evergreen_format" | "story_type" | "is_rumour">,
): boolean {
  return (
    !script.is_rumour &&
    (!!script.evergreen_format || script.story_type === "explainer")
  );
}

async function stepRender(s: Services, ep: Episode): Promise<void> {
  if (ep.lane === "longform") return stepRenderLong(s, ep);
  if (ep.lane === "cutdown" || ep.lane === "gameplay")
    return stepRenderCutdown(s, ep);
  // The PC picture checker is down and nothing paid may stand in: a Short built on third-party pictures waits for it
  // rather than render now and go out unchecked. Shorts already checked, and the owner's gameplay, are not held.
  if (s.cfg.visionQa && s.cfg.visionHold && (await s.visionDown?.().catch(() => false))) {
    await holdForVision(s, ep);
    return;
  }
  const dir = episodeDir(s.cfg, ep.id);
  const script = ep.script_json!;
  const assets = { ...(ep.assets_json ?? {}) };
  if (!assets.images) {
    Object.assign(assets, await gatherMedia(s, ep, dir));
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(assets),
    ]);
  }
  if (assets.clips?.some((c) => /^Cutscenes for "/.test(c.provenance))) {
    const allowed = allowedEpisodeCutscenes(s.cfg, script, assets, false);
    if (JSON.stringify(allowed) !== JSON.stringify(assets.clips)) {
      assets.clips = allowed;
      delete assets.plan;
      await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(assets)]);
    }
  }
  // CHARACTER_QUOTES: a quote counts against its publisher's footage cap and the cutscene budget like any clip.
  if (assets.quotes?.length && assets.clips?.length) {
    const fitted = fitClipsAroundQuotes(assets.clips, assets.quotes, s.cfg.cutsceneFootage ? s.cfg.cutsceneMaxSeconds : Infinity);
    if (fitted.length !== assets.clips.length) {
      assets.clips = fitted;
      delete assets.plan;
      await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(assets)]);
    }
  }
  // An every-game Short: every beat shows its own game's era or it does not render (src/everygamestep.ts).
  if (script.every_game) {
    const era = auditEveryGameAssets(script, assets);
    if (era.dropped.length) {
      assets.images = era.images;
      assets.clips = era.clips;
      delete assets.plan;
      await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(assets)]);
    }
    await logEvent(s.db, ep.id, "every_game_era", {
      beats: era.audit.map((a) => `${a.year} ${a.title}: ${a.shows}`),
      dropped: era.dropped,
      problems: era.problems,
    });
    if (era.problems.length)
      throw new Error(`every-game pictures not fit to render: ${era.problems[0]}`);
  }
  if (await belowMediaFloor(s, ep, assets)) return;
  // EXPLAINERS (src/explainerstep.ts): lines that explain how something works get an animated explainer, once.
  await shortExplainersStep(s, ep, script, assets, dir);
  const duration = (assets.durationSeconds ?? 30) + TAIL_SECONDS;
  const words = assets.words ?? [];
  const segments = buildSegments(
    // Switched off, explainers kept from an earlier render are not drawn.
    segmentInputs(explainersOn(s.cfg.explainers, "short") ? script : { ...script, explainers: undefined }, Boolean(assets.desk)),
    words,
    duration,
  );
  // The argument test: the conclusion is spoken, not labelled, so the take has no card of its own.
  if (argumentArm(s.cfg, ep))
    for (const g of segments)
      if (g.kind === "take") g.visual = undefined;
  const variant = variantOf(ep.id);
  // The bed none of the last eight Shorts played (src/render/bedrotation.ts), so no two Shorts in a row share music.
  let musicFile: string | null = s.cfg.musicBed
    ? chooseBed(s.cfg.dataDir, BEDS.map((b) => b.file), { ep: ep.id, lane: "short", seed: bedSeed(ep.id) })
    : null;
  // ACE_BEDS (src/render/acebeds.ts): a Short about an old game, Vice City or a fantasy world plays an era or genre bed:
  // Pulse's own ACE beds of that mood with the house mood beds of the same mood, by the same rotation (none of the last
  // few Shorts' beds while the pool allows, else the one heard longest ago). A Short whose series has its own sting
  // keeps the series music (SIGNATURE_MUSIC below), so no ACE bed is chosen for it.
  const seriesSting =
    s.cfg.signatureMusic &&
    !!signatureFor(SIGNATURE_LIBRARY, signatureSeriesOf({ series: seriesTagFor(ep, script) ?? script.series ?? ep.story_json?.series }))?.sting;
  const aceMood =
    s.cfg.aceBeds && musicFile && !seriesSting
      ? aceShortMood(
          {
            text: [script.headline, ...segments.map((g) => g.text)].join(" "),
            year: Number(assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0]) || undefined,
          },
          ACE_LIBRARY,
        )
      : undefined;
  if (aceMood) {
    const pool = [...acePool(aceMood, ACE_LIBRARY), ...MOOD_BEDS[aceMood].map((b) => b.file)];
    musicFile = chooseBed(s.cfg.dataDir, pool, { ep: ep.id, lane: "short", seed: bedSeed(ep.id) }) ?? musicFile;
    await logEvent(s.db, ep.id, "ace_bed", { mood: aceMood, bed: musicFile }).catch(() => undefined);
  }
  // Blurred plates sit behind framed footage; made once per asset, idempotent on retry.
  for (const img of assets.images ?? [])
    if (!img.blurFile)
      img.blurFile = await blurPlate(dir, img.file).catch(() => undefined);
  for (const clip of assets.clips ?? [])
    if (!clip.blurFile)
      clip.blurFile = await blurPlate(dir, clip.file).catch(() => undefined);
  const steamLite = assets.steam?.facts
    ? {
        currentPlayers: assets.steam.facts.currentPlayers,
        positivePercent: assets.steam.facts.positivePercent,
        totalReviews: assets.steam.facts.totalReviews,
        price: assets.steam.facts.price,
        prices: assets.steam.facts.prices,
        releaseDate: assets.steam.facts.releaseDate,
        metacritic: assets.steam.facts.metacritic,
      }
    : null;
  // Plan then render: the plan is persisted so a retry renders the identical Short.
  // A red rubric rebuilds the plan once with another variant, then fails the episode.
  if (s.cfg.shortBright)
    for (const img of assets.images ?? [])
      if (img.luma === undefined)
        img.luma = await meanLuma(path.join(dir, img.file));
  // Art with big lettering in what the crop keeps ("LDEN RIN" over the verdict) goes while enough other pictures are
  // left; the vision check would fail it and cost a whole render to find out.
  if (s.cfg.shortClipTextCheck && !script.entries?.length) {
    for (const img of assets.images ?? [])
      if (img.kind !== "capsule" && img.bigText === undefined)
        img.bigText = (await stillBigText(path.join(dir, img.file))).length > 0;
    const clean = (assets.images ?? []).filter((i) => !i.bigText);
    if (clean.length >= 4 && clean.length < (assets.images ?? []).length) {
      await logEvent(s.db, ep.id, "lettered_art_dropped", {
        files: (assets.images ?? []).filter((i) => i.bigText).map((i) => i.file),
      });
      assets.images = clean;
    }
  }
  // A ranking's old games: a clip with no detail left in the crop is a 240p smear, worse than a sharp still. Lists only:
  // the same measure reads foggy or dark modern footage as low (Silent Hill 2 lost all six clips), and a blur measure
  // separated them no better. Elsewhere a blurred clip is left to the vision check, whose fault drops it for the retry.
  if (s.cfg.shortClipTextCheck && script.entries?.length) {
    for (const c of assets.clips ?? [])
      if (c.detailKb === undefined)
        c.detailKb = await clipDetailKb(path.join(dir, c.file), c.durationSeconds);
    const sharp = (assets.clips ?? []).filter(
      (c) => c.detailKb === undefined || c.detailKb >= CLIP_DETAIL_FLOOR_KB,
    );
    if (sharp.length < (assets.clips ?? []).length) {
      await logEvent(s.db, ep.id, "smeared_clips_dropped", {
        files: (assets.clips ?? []).filter((c) => !sharp.includes(c)).map((c) => c.file),
      });
      assets.clips = sharp;
    }
  }
  // Never CONFIRMED on an estimate or a report, on the chip or on a stamp: a rule, not a setting.
  const tag = sourceTag(
    `${script.headline} ${script.youtube?.title ?? ""} ${narrationOf(script)}`,
    (ep.story_json.items ?? []).some((i) => i.sourceKind === "official"),
  );
  if (tag !== "CONFIRMED" && script.stamp && /confirm/i.test(`${script.stamp.text} ${script.stamp.sub ?? ""}`)) {
    await logEvent(s.db, ep.id, "stamp_dropped", { stamp: script.stamp.text, tag });
    script.stamp = undefined;
  }
  // APPLE_AESTHETICS (Mac only, off until switched on): Apple's aesthetics score for each still, once, so the most
  // striking clean picture opens the Short and leads its search tile (src/assets/appleaesthetics.ts).
  if (s.cfg.appleAesthetics) {
    const todo = (assets.images ?? []).filter((i) => i.aesthetic === undefined);
    const scores = await scoreAesthetics(
      true,
      todo.map((i) => path.join(dir, i.file)),
    );
    for (const i of todo) {
      const a = coverWorth(scores.get(path.join(dir, i.file)));
      if (a !== undefined) i.aesthetic = a;
    }
  }
  // MATCH_SEMANTIC (src/semantic/stills.ts): a still nobody tagged for a line is tagged for the beat it clearly shows,
  // so "a phone app that delivers your car" is no longer shown over a controller. Fresh plans only, rankings excluded
  // (their art belongs to its entry); a still the model is unsure of stays in turn as before.
  if (s.cfg.semantic.enabled && !assets.plan && !script.entries?.length && (assets.images ?? []).length) {
    const got = await pinShortStills(
      embedderFor(s.cfg.dataDir, s.cfg.semantic),
      dir,
      assets.images ?? [],
      (script.beats ?? []).map((b) => ({
        text: b.narration,
        note: [b.footage?.want, ...(b.footage?.keywords ?? [])].filter(Boolean).join(", "),
      })),
      { ...s.cfg.semantic, background: await backgroundFor(s.cfg.dataDir, s.cfg.semantic, script.game_title ?? "") },
    ).catch((err): ShortPins => {
      log("warn", "semantic: Short stills not pinned", { episode: ep.id, error: errorMessage(err) });
      return { pins: [], offTopic: [] };
    });
    if (got.pins.length)
      await logEvent(s.db, ep.id, "semantic_pins", {
        pins: got.pins.map((p) => ({ file: assets.images![p.image]!.file, beat: p.beat, score: p.score })),
      }).catch(() => undefined);
    // Stills about something else than every line (a controller press shot under a story about a phone app) go while
    // at least four other pictures are left, like lettered art above.
    const keep = (assets.images ?? []).filter((_, i) => !got.offTopic.includes(i));
    if (got.offTopic.length && keep.length >= 4) {
      await logEvent(s.db, ep.id, "semantic_offtopic_dropped", {
        files: got.offTopic.map((i) => assets.images![i]!.file),
      }).catch(() => undefined);
      assets.images = keep;
    }
  }
  // SHORT_OPEN_FOOTAGE (src/openingstep.ts): frame one is the game's own moving footage, cut out and tagged for the hook.
  let openingStale = false;
  const opening =
    s.cfg.shortOpenFootage && !assets.plan
      ? await chooseOpening(
          dir,
          assets,
          {
            game: script.game_title,
            entries: script.entries?.length ?? 0,
            spoilerWindow: s.cfg.spoilerGuard && !!windowFor(spoilerWindows(), script.game_title, s.now()),
          },
          { blur: blurPlate },
        )
      : undefined;
  const planInput = {
    segments,
    words,
    durationSeconds: duration,
    images: (assets.images ?? []).map((i) => ({
      kind: i.kind,
      aspect: i.aspect,
      beatIndex: i.beatIndex,
      wordy: i.wordy,
      luma: i.luma,
      aesthetic: i.aesthetic,
      frame: i.frame,
      then: i.then,
      forWords: i.forWords,
      role: i.role,
    })),
    clips: (assets.clips ?? []).map((c) => ({
      durationSeconds: c.durationSeconds,
      motion: c.motion,
      luma: c.luma,
      beatIndex: c.beatIndex,
      role: c.role,
      cutsceneMatch: c.cutsceneMatch,
      ...(c.forWords ? { forWords: c.forWords } : {}),
      // GAME_AUDIO_BED: a mild preference for footage whose own sound the bed can carry (trailers stay silent).
      ...(gameAudioOn(s.cfg, ep.id, isRetrospective(ep.factcheck_json)) && heardInBed(c, s.cfg.gameAudioTrailers) ? { heard: true } : {}),
    })),
    storyType: script.is_rumour ? "rumour" : script.story_type,
    isRumour: script.is_rumour,
    attribution: script.attribution,
    variant,
    steam: steamLite,
    openOnClip: s.cfg.openOnMotion,
    footageFirst: s.cfg.shortFootageFirst,
    sourceTag: tag,
    noSourceChip: s.cfg.shortLabelsClean && ownWorkShort(script),
    statsWhenSpoken: s.cfg.shortLabelsClean,
    preferBright: s.cfg.shortBright,
    ...(script.every_game ? { beatTarget: EVERY_SHOT_TARGET } : {}),
    codeScenes: s.cfg.codeScenes
      ? {
          ctx: {
            sourced: [
              ...segments.map((x) => x.text),
              ...(script.claims ?? []).map((c: { claim: string }) => c.claim),
            ].join(" "),
            game: script.game_title,
            today: new Date(s.now()).toISOString().slice(0, 10),
          },
          stampsAt: stampsFor(script, words).map((x) => x.at),
        }
      : undefined,
  };
  const footageSeconds = (assets.clips ?? []).reduce(
    (n, c) => n + c.durationSeconds,
    0,
  );
  const footageBudget = Math.max(20, footageSeconds); // clips were already trimmed to the publisher budget in gatherMedia
  const rubricFor = (plan: ReturnType<typeof buildPlan>) =>
    scorePlan({
      plan,
      segments,
      words,
      footageSeconds,
      footageBudgetSeconds: footageBudget,
      hookWords: script.hook.split(/\s+/).filter(Boolean).length,
      // 5 Nov 2026: of 25 failed news Shorts in 45 days, 20 had their slot or one within 3 hours filled by another Short
      // (the other 5 were one day's render bug), so a stop costs little. A big story has no better story to yield to.
      plateShareMax: ep.story_json.bigStory
        ? Math.max(s.cfg.shortPlateMax, s.cfg.shortPlateMaxBig)
        : s.cfg.shortPlateMax,
      plateFirstSeconds: s.cfg.shortPlateFirstSeconds,
      shelfOptional: s.cfg.shortLabelsClean,
      wpmMax: shortWpmMax(s.cfg),
    });
  let plan = assets.plan ?? buildPlan(planInput);
  // SHORT_SOUND_PLAN (src/untemplatestep.ts): a stored sparse plan now on the v3 side gets its v3 cues back here, so the
  // word stamp, the series sting and the ident below land on it as on any v3 plan.
  if (assets.plan) restoreV3Sound({ cfg: s.cfg, id: ep.id, plan, assets, v3: () => buildPlan(planInput).sfx });
  let rubric = rubricFor(plan);
  // SHOT_PLAN_PANEL (src/planpanelstep.ts, off by default): a blind picture editor critic reads the plan as text before
  // any render; under "on" up to three plans from the same media are marked and the best kept. A red plan is never
  // kept, so the rebuild below and every later gate see the panel's plan exactly as they would any other.
  if (!assets.plan && s.cfg.shotPlanPanel !== "off") {
    plan = await planPanelStep(s, ep, {
      assets,
      script,
      words,
      segments,
      input: planInput,
      plan,
      rubric: rubricFor,
      segmentsOf: segmentInputs,
      gameAudio: { on: gameAudioOn(s.cfg, ep.id, isRetrospective(ep.factcheck_json)) },
    });
    rubric = rubricFor(plan);
  }
  if (rubric.grade === "red" && !assets.plan) {
    log("warn", "plan rejected by rubric, rebuilding", {
      episode: ep.id,
      problems: rubricSummary(rubric),
    });
    plan = buildPlan({ ...planInput, variant: (variant + 1) % 4 });
    rubric = rubricFor(plan);
    const mediaRed = rubric.metrics.some(
      (m) =>
        m.grade === "red" &&
        /^(unique_media_ratio|max_media_repeat|adjacent_repeats|plate_share|plate_opening_seconds)$/.test(m.name),
    );
    if (rubric.grade === "red" && mediaRed && !assets.rich) {
      // Too little media to vary with: fetch more (screenshots, another clip) and plan again.
      log("info", "red media rubric: gathering more media", { episode: ep.id });
      Object.assign(assets, await gatherMedia(s, ep, dir, true), {
        rich: true,
      });
      // The opening was chosen from the media before this gather: a "nothing to open on" from then says nothing about
      // the footage just added (15 Nov 2026: the police Short was held with 66% footage for it).
      if (opening && !opening.ok) openingStale = true;
      for (const img of assets.images ?? [])
        if (!img.blurFile)
          img.blurFile = await blurPlate(dir, img.file).catch(() => undefined);
      for (const clip of assets.clips ?? [])
        if (!clip.blurFile)
          clip.blurFile = await blurPlate(dir, clip.file).catch(
            () => undefined,
          );
      if (s.cfg.shortBright)
        for (const img of assets.images ?? [])
          if (img.luma === undefined)
            img.luma = await meanLuma(path.join(dir, img.file));
      const richInput = {
        ...planInput,
        images: (assets.images ?? []).map((i) => ({
          kind: i.kind,
          aspect: i.aspect,
          beatIndex: i.beatIndex,
          wordy: i.wordy,
          luma: i.luma,
          frame: i.frame,
          then: i.then,
          forWords: i.forWords,
          role: i.role,
        })),
        clips: (assets.clips ?? []).map((c) => ({
          durationSeconds: c.durationSeconds,
          motion: c.motion,
          luma: c.luma,
          beatIndex: c.beatIndex,
          role: c.role,
          cutsceneMatch: c.cutsceneMatch,
          ...(c.forWords ? { forWords: c.forWords } : {}),
        })),
      };
      const tries = [0, 1, 2, 3].map((k) =>
        buildPlan({ ...richInput, variant: (variant + k) % 4 }),
      );
      const order = { green: 0, amber: 1, red: 2 } as const;
      const best = tries
        .map((p) => ({ p, r: rubricFor(p) }))
        .sort((a, b) => order[a.r.grade] - order[b.r.grade])[0]!;
      plan = best.p;
      rubric = best.r;
      await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
        ep.id,
        JSON.stringify(assets),
      ]);
    }
    const plateRed = rubric.metrics.find(
      (m) => m.name === "plate_share" && m.grade === "red",
    );
    if (plateRed)
      // Unlike the other notes this one is what the viewer sees: an empty screen. The story's slot goes to the next one,
      // at once: the retries would plan the same media again and hold the slot while they did.
      throw new FatalError(
        `QA failed: ${Math.round(Number(plateRed.value) * 100)}% of the Short would be an empty panel: too little media`,
      );
    const openingRed = rubric.metrics.find(
      (m) => m.name === "plate_opening_seconds" && m.grade === "red",
    );
    if (openingRed)
      throw new FatalError(
        `QA failed: the Short would open on an empty panel for ${openingRed.value} s: too little media`,
      );
    if (rubric.grade === "red") {
      // A slot is worth more than a perfect plan: render anyway and say so.
      log("warn", "rubric still red after rebuild; rendering anyway", {
        episode: ep.id,
        problems: rubricSummary(rubric),
      });
      await s.notify({
        level: "info",
        content: `Quality note: "${script.headline}" renders with a red rubric (${rubricSummary(rubric)}). Worth a look.`,
      });
    }
  }
  await logEvent(s.db, ep.id, "rubric", {
    grade: rubric.grade,
    summary: rubricSummary(rubric) || "all green",
  });
  // The word moment's look (src/render/wordlook.ts): one of the suite, never the previous Short's, with a
  // memory of the channel's last twelve; off (SHORT_WORD_LOOKS=false) it is always the rubber stamp.
  const [stamp] = stampsFor(script, words);
  if (stamp && !plan.wordLook) {
    const gameYear =
      Number(assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0]) ||
      undefined;
    const chosen = s.cfg.shortWordLooks
      ? await chooseWordLook(s.db, stamp, {
          year: gameYear,
          motif: await motifIdFor(script.game_title, gameYear),
          day: s.now().toISOString().slice(0, 10),
          seed: variant,
        })
      : { look: "Stamp", recent: [] };
    plan.wordLook = chosen.look;
    await logEvent(s.db, ep.id, "word_look", {
      look: chosen.look,
      text: stamp.text,
      tone: stamp.tone,
      recent: chosen.recent,
    });
  }
  // The moment lands with its look's sound (the stamp's landing by default), peak on the word, when the mix has room for it.
  for (const st of stampsFor(script, words)) {
    const cue = wordSoundCue(plan.wordLook);
    const name = cue.name;
    const f = Math.max(
      0,
      Math.round(st.at * plan.fps) - leadFrames(name, plan.fps),
    );
    if (
      plan.sfx.length < MAX_SFX &&
      plan.sfx.every((c) => Math.abs(c.frame - f) >= 60)
    )
      plan.sfx.push({ file: sfxFile(name), frame: f, volume: cue.volume });
  }
  // SIGNATURE_MUSIC: a named series opens and closes on its own sting over its own bed (src/render/signature.ts).
  if (s.cfg.signatureMusic && musicFile) {
    const id = signatureSeriesOf({ series: seriesTagFor(ep, script) ?? script.series ?? ep.story_json?.series });
    const sig = signatureFor(SIGNATURE_LIBRARY, id);
    if (sig?.sting) {
      plan.sfx = withSignatureSting(plan.sfx, sig.sting);
      musicFile = shortMusic(sig, musicFile, (k) => BEDS.find((b) => b.key === k)?.file ?? null, (f) => BEDS.find((b) => b.file === f)?.key);
      await logEvent(s.db, ep.id, "signature_music", { series: id, sting: sig.sting, bed: musicFile });
    }
  }
  // ACE_BEDS: the Pulse ident on the opening sting, in the bed's key (src/render/acebeds.ts); a series sting stays.
  if (s.cfg.aceBeds) {
    const ident = aceIdent(ACE_LIBRARY, bedSeed(ep.id));
    if (ident) plan.sfx = withIdent(plan.sfx, sfxFile(SFX.sting), sfxFile(ident.sting));
  }
  // RETENTION_DIRECTOR (src/retentionstep.ts): the retention model's predicted curve for this plan, its weakest moments
  // and, under "fix", the safe fixes (fresh footage for stills, the strongest picture first, shorter card text), before
  // the first-seconds check and the render, so no re-render is ever needed. Off by default; never throws.
  await directorStep(s, ep, {
    assets,
    script,
    words,
    segments,
    plan,
    gameAudio: { on: gameAudioOn(s.cfg, ep.id, isRetrospective(ep.factcheck_json)) },
    segmentsOf: segmentInputs,
  });
  // ...and nothing in the first 7 s is what YouTube limits ads on; a failing later shot gives way to a picture that passes.
  if (opening) {
    const seconds = await checkFirstSeconds(dir, plan, assets, { openingChecked: opening.clip });
    opening.seconds = seconds;
    await logEvent(s.db, ep.id, "opening_footage", { ...opening, seconds });
    const bad = seconds.replaced.filter((r) => !r.with);
    if (!opening.ok || seconds.openingStill || bad.length)
      log("warn", "short opening not on screened footage", {
        episode: ep.id,
        why: opening.why,
        openingStill: seconds.openingStill,
        unsafe: bad.map((r) => `shot ${r.shot}: ${r.problem}`),
      });
  }
  // SHORT_FOOTAGE_GATE (15 Nov 2026): "Why did Rockstar narrow GTA 6's roads?" went out with no moving footage at all
  // (footage share 0, opening check failed, rubric amber). When footage of the game exists, such a Short gathers once
  // more, richer; still without footage it is held, the slot goes to the next ready Short and the alerts say why.
  if (s.cfg.shortFootageGate && !script.entries?.length && !script.every_game && ["news", "news_breaking", "free", "evergreen"].includes(ep.lane)) {
    const clipFrames = plan.shots.filter((x) => x.media.type === "clip").reduce((n, x) => n + x.end - x.start, 0);
    const footageShare = clipFrames / Math.max(1, plan.totalFrames);
    const footageExists =
      (await libraryHasFootage(s.cfg.dataDir, script.game_title)) || (assets.officialTrailer?.clipSeconds ?? 0) > 0;
    // An opening the vision model never looked at (the PC relay busy) is not a failed opening: the picture check holds
    // the Short until it can look (VISION_HOLD); 15 Nov 2026 the PS4 Short was held at 63% footage for this alone.
    const verdict = footageGate({ footageShare, openingOk: opening?.unchecked || openingStale ? undefined : opening?.ok, footageExists, alreadyRich: Boolean(assets.rich) });
    await logEvent(s.db, ep.id, "footage_gate", { verdict, footageShare: Math.round(footageShare * 100) / 100, opening: opening?.ok, footageExists });
    if (verdict === "regather") {
      Object.assign(assets, await gatherMedia(s, ep, dir, true), { rich: true });
      delete assets.plan;
      // The richer gathering is the next step, not a failure: planning again on the next pass must not spend one of
      // MAX_ATTEMPTS (26 Nov 2026: GTA VI File #3 met the gate on its third try, so the throw gave up on it before its
      // richer plan was ever made, and the 18:30 slot went empty). attempts and last_error stay as they were.
      await s.db.query(`UPDATE episodes SET assets_json = $2, next_attempt_at = $3 WHERE id = $1`, [ep.id, JSON.stringify(assets), s.now()]);
      log("info", "footage gate: no moving footage on screen; gathered again, richer, and planning once more", { id: ep.id, footageShare: Math.round(footageShare * 100) / 100 });
      return;
    }
    // A YouTube download pause that still has hours to run (24-26 Nov 2026: two days, nothing published for 24 hours)
    // is not worth waiting out: the Short goes out on its stills, filmed by the depth camera, rather than not at all.
    const pause = verdict === "hold" ? await s.youtubePause?.().catch(() => undefined) : undefined;
    const longPause = Boolean(pause?.until && pause.until - s.now().getTime() > s.cfg.shortFootageWaitMaxHours * 3_600_000);
    if (verdict === "hold" && longPause) {
      log("info", "footage gate: YouTube downloads are paused for hours, so the Short goes out on its stills", { id: ep.id, until: new Date(pause!.until!).toISOString() });
      await logEvent(s.db, ep.id, "footage_gate_stills", { until: new Date(pause!.until!).toISOString(), footageShare: Math.round(footageShare * 100) / 100 }).catch(() => undefined);
    }
    if (verdict === "hold" && !longPause && s.cfg.shortFootageWait && (await waitForYouTube(s, ep, assets))) return;
    if (verdict === "hold" && !longPause) {
      const why = `"${script.headline}" is held: no moving footage of ${script.game_title} on screen (footage share ${Math.round(footageShare * 100)}%${opening?.ok === false ? `, no footage to open on: ${opening.why ?? "none"}` : ""}) although footage of the game exists. The slot goes to the next ready Short.`;
      await s.notify({ level: "info", content: `🎞️ ${why}` });
      throw new FatalError(`QA held: ${why}`);
    }
  }
  assets.plan = plan;
  // The clean frame (SHORTS_CLEAN) shows every shot full-bleed, so under it no still is framed and none is filled.
  const shortClean = await shortsCleanStep(s, ep.id, assets.test);
  // FILL_FRAME / UPSCALE_STILLS (src/gpuvis/client.ts), once the plan is final: only the stills the plan shows in the
  // framed panel are extended (a still shown full-bleed is cover-cropped, so a fill would never show), and
  // low-resolution and old games' stills are enlarged; anything the service cannot do keeps its blurred plate and size.
  {
    const gp = await prepareImages(s.cfg, dir, assets.images ?? [], "short", {}, {
      fillOnly: shortClean ? new Set<number>() : framedStills(plan),
      year: Number(assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0]) || undefined,
    });
    if (gp.filled || gp.upscaled) await logEvent(s.db, ep.id, "gpu_pictures", gp);
  }
  // SHORT_BLENDER (src/shortupgradestep.ts): a ranking's number one on the vertical 3D podium. A Short whose slot leaves
  // the Mac's Blender time asks for it and comes back for it (never holding the Shorts tick); any other renders now.
  const blenderState = (assets as { shortBlender?: ShortBlenderState }).shortBlender;
  const blender3d = await shortBlenderStep({
    cfg: s.cfg,
    episodeDir: dir,
    segments,
    now: s.now(),
    slotAt: ep.slot_at,
    state: blenderState,
    probe: probeMedia,
    fps: plan.fps,
  });
  if (blender3d.verdict === "wait") {
    (assets as { shortBlender?: ShortBlenderState }).shortBlender = blender3d.state;
    await s.db.query(`UPDATE episodes SET assets_json = $2, next_attempt_at = $3 WHERE id = $1`, [
      ep.id,
      JSON.stringify(assets),
      blender3d.retryAt,
    ]);
    if (!blenderState) await logEvent(s.db, ep.id, "short_blender_wait", { until: blender3d.retryAt.toISOString(), keys: blender3d.state.keys }).catch(() => undefined);
    return;
  }
  // The wait is over (clips back, or not to be had): a later re-render never resumes it.
  if (blenderState) delete (assets as { shortBlender?: ShortBlenderState }).shortBlender;
  if (blender3d.asked)
    await logEvent(s.db, ep.id, "short_blender", { asked: blender3d.asked, made: blender3d.clips.length }).catch(() => undefined);
  // How much of the narration has something chosen for its own words on screen (src/qa/mediarich.ts): measured
  // on every Short and kept in qa_json; under SHORT_MEDIA_RICH_TARGET it is a line in the evening summary.
  // The long videos' craft on the new-look Shorts (src/shortcraftstep.ts): planned once, stored on the plan.
  const craftFills = await craftForShort(s, ep.id, {
    suite: suiteFor(s.cfg, ep),
    segments,
    words,
    plan,
    images: (assets.images ?? []).map((i) => ({
      kind: i.kind,
      credit: photoCredit(i),
      beatIndex: i.beatIndex,
    })),
    clips: assets.clips ?? [],
    stamps: stampsFor(script, words),
    game: script.game_title,
    gameYear:
      Number(assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0]) ||
      undefined,
    seed: variant,
  });
  const mediaRich = shortMediaRichness(
    segments,
    plan,
    assets.images ?? [],
    assets.clips ?? [],
    craftFills,
  );
  log(
    mediaRich.covered < s.cfg.shortMediaRichTarget ? "warn" : "info",
    "short media richness",
    {
      episode: ep.id,
      covered: Math.round(mediaRich.covered * 100),
      own: Math.round(mediaRich.own * 100),
      target: Math.round(s.cfg.shortMediaRichTarget * 100),
    },
  );
  await logEvent(s.db, ep.id, "media_rich", {
    covered: mediaRich.covered,
    own: mediaRich.own,
    graphicOnly: mediaRich.graphicOnly,
    target: s.cfg.shortMediaRichTarget,
  });
  if (mediaRich.covered < s.cfg.shortMediaRichTarget)
    await s.notify({
      level: "info",
      content: mediaRichNotice(
        script.headline,
        mediaRich,
        s.cfg.shortMediaRichTarget,
      ),
    });
  assets.suite = suiteFor(s.cfg, ep);
  // Pip the mascot (src/experiments.ts, src/render/mascot.ts): recorded either way only while the test runs on a
  // news or why Short, and kept on a re-render. Serious stories (layoffs, deaths, court cases) sit out on both
  // sides, so the two groups stay alike.
  const mascotShare = await mascotShareNow(s.db, s.cfg);
  if (
    assets.mascot === undefined &&
    mascotShare > 0 &&
    MASCOT_LANES.includes(ep.lane) &&
    !PIP_SERIOUS.test(segments.map((g) => g.text).join(" "))
  )
    assets.mascot = mascotFor(mascotShare, ep);
  // The new-look opening poster (src/render/components/HookPoster.tsx): the hero art's subject cut out once.
  const heroImage = assets.images?.[plan.heroIndex];
  const heroFirst =
    heroImage &&
    plan.shots[0]?.media.type === "image" &&
    plan.shots[0].media.index === plan.heroIndex;
  // APPLE_SUBJECT_LIFT (Mac mini): Apple Vision's foreground mask first, the depth model after.
  if (assets.suite && !assets.heroCut && s.cfg.appleSubjectLift && heroFirst) {
    const cut = await appleCut(dir, heroImage.file);
    if (cut) assets.heroCut = cut;
  }
  // APPLE_SMART_CROP (Mac mini): each full-bleed clip's upright crop follows its subject (src/render/smartcrop.ts).
  if (s.cfg.appleSmartCrop)
    for (const c of assets.clips ?? [])
      if (!c.crop) {
        const crop = await smartCrop(path.join(dir, c.file));
        if (crop) c.crop = crop;
      }
  // The same for wide stills with no subject found yet (library, press and store pictures): the upright crop sits
  // on Apple Vision's subject rather than the picture's middle (owner, 15 Nov 2026: Shorts not on the focal content).
  if (s.cfg.appleSmartCrop) {
    const wide = (assets.images ?? []).filter((i) => i.focusX === undefined && (i.aspect ?? 0) > 0.6);
    const boxes = await readBoxes(wide.map((i) => path.join(dir, i.file))).catch(() => new Map());
    for (const i of wide) {
      const b = boxes.get(path.join(dir, i.file));
      if (!b?.width || !b.height) continue;
      const x = frameTarget(b, 0.5625 / (b.width / b.height));
      if (x !== undefined) i.focusX = x;
    }
  }
  // SHORT_PARALLAX: the wide stills get depth layers too, once per Short (kept in assets), so they drift like
  // footage; viewers left 1.3 times as fast while a flat still was up (Sunday retention curves, 15 Nov).
  // A share of Shorts while it is tested (SHORT_PARALLAX_SHARE); the arm is kept so retention can be split by it.
  const depthArm = shortDepthArm(ep.id, s.cfg.shortParallaxShare);
  if (s.cfg.shortParallaxShare > 0) assets.shortDepthArm = depthArm;
  if (depthArm === "depth" && s.cfg.parallaxPython && assets.images?.length) {
    const want = shortDepthWanted(
      assets.images.map((i) => ({ ...i, noDepth: isHardwareAsset(i) || i.depthFault === true })),
    );
    if (want.length) {
      const made = await makeParallax(
        s.cfg.parallaxPython,
        dir,
        want.map((i) => i.file),
      );
      for (const i of assets.images) {
        const l = made.get(i.file.split(path.sep).join("/"));
        if (l) i.layers = l;
      }
      log("info", "short depth layers", { ep: ep.id, wanted: want.length, made: made.size });
    }
    // PARALLAX_DEEP: the layered stills also get the depth camera's maps, painted from the background only.
    if (s.cfg.parallaxDeep) {
      const deep = assets.images
        .filter((i) => i.layers && !i.layers.mesh && !i.wordy)
        .slice(0, SHORT_DEPTH_MAX);
      if (deep.length) {
        const maps = await makeMeshes(
          s.cfg.parallaxPython,
          dir,
          deep.map((i) => i.file),
          undefined,
          "pushpull",
        );
        for (const i of deep) {
          const m = maps.get(i.file.split(path.sep).join("/"));
          if (m && i.layers) i.layers.mesh = m;
        }
        log("info", "short depth camera maps", { ep: ep.id, wanted: deep.length, made: maps.size });
      }
    }
  }
  if (
    assets.suite &&
    !assets.heroCut &&
    s.cfg.parallax &&
    s.cfg.parallaxPython &&
    heroImage &&
    plan.shots[0]?.media.type === "image" &&
    plan.shots[0].media.index === plan.heroIndex
  ) {
    const made = await makeParallax(s.cfg.parallaxPython, dir, [
      heroImage.file,
    ]);
    const cut = made.get(heroImage.file);
    if (cut) assets.heroCut = { fg: cut.fg, x: cut.fgx };
  }
  // PEOPLE_INSETS (src/assets/people.ts): each real person the Short names gets their own licensed face photo, found
  // once per Short (kept in assets, so a re-render shows the same people).
  if (
    s.cfg.peopleInsets &&
    s.personPortrait &&
    assets.people === undefined &&
    !script.entries?.length &&
    !script.every_game
  )
    assets.people = await gatherPeople(s, ep.id, dir, script, assets.images ?? []);
  // MENTION_* (src/assets/mentions.ts): the pictures behind the mention insets, found once for the kinds switched on
  // (kept in assets, so a re-render shows the same pictures).
  {
    const kinds = mentionKinds(s.cfg);
    if (kinds.length && s.findMentions && !script.every_game && !mentionsCover(assets.mentions, kinds)) {
      const items = await s
        .findMentions(mentionInputOf({ dir, kinds, script, story: ep.story_json as never, assets }))
        .catch(() => []);
      assets.mentions = { kinds, items };
      await logEvent(s.db, ep.id, "mention_insets", {
        kinds,
        found: items.map((i) => ({ kind: i.kind, key: i.key, from: i.pictures.map((p) => p.sourceUrl) })),
      }).catch(() => undefined);
    }
  }
  await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
    ep.id,
    JSON.stringify(assets),
  ]);
  const publisher = String(
    (assets.steam
      ? (await s.findGame(assets.steam.name).catch(() => undefined))?.details
          ?.publishers?.[0]
      : assets.officialTrailer?.publisher) ?? "",
  );
  // A person's licensed photo is credited on screen, as its licence asks.
  const photoLine = photoCreditLine((assets.images ?? []).map(photoCredit));
  const footageCredit = [
    (assets.clips ?? []).length
      ? // A list has no one game to credit: "Steam Deals" is not a publisher.
        s.cfg.shortLabelsClean && !publisher && script.entries?.length
        ? "Footage: official trailers"
        : `Footage: ${publisher || script.game_title} · official trailer`
      : "",
    photoLine,
  ]
    .filter(Boolean)
    .join("   ");
  const year = assets.steam?.facts?.releaseDate?.match(/\b(19|20)\d\d\b/)?.[0];
  // The store page's year can be a re-release's, and a Why about the 2005 game read "Electronic Arts · 2020".
  const gameSubtitle = [
    publisher,
    s.cfg.shortLabelsClean && ownWorkShort(script) ? undefined : year,
  ]
    .filter(Boolean)
    .join(" · ");

  const raw = path.join(dir, "render_raw.mp4");
  const final = path.join(dir, "short.mp4");
  if (assets.suite) assets.shortThumb = "thumb_short.jpg";
  // SHORT_FULL_COVER: a Short without the new-look thumbnail gets its cover still as the custom thumbnail too, so the
  // Shorts shelf shows the whole title rather than a frame YouTube picks; the designed search tile still wins its arm.
  else if (s.cfg.shortFullCover) assets.shortThumb = COVER_FILE;
  // Switched off since an earlier render: the cover is no longer made, so it is no longer the thumbnail.
  else if (assets.shortThumb === COVER_FILE) assets.shortThumb = undefined;
  // A new render: the social copy made from the last one is stale (crosspost makes it again from this one).
  for (const f of [SOCIAL_FILE, "social.part.mp4"]) await fs.rm(path.join(dir, f), { force: true }).catch(() => undefined);
  // The word stamp, and an every-game Short's year stamps: one at the first game and at each change of era.
  const shownStamps = [
    ...stampsFor(script, words),
    ...eraStampsFor(
      script,
      segments.filter((g) => g.kind === "beat").map((g) => g.start),
      stampColour("neutral"),
    ),
  ];
  // The series strip on the opening poster and the search thumbnail (SERIES_COVER_STYLE, src/seriescover.ts).
  const seriesCover = await seriesCoverOf(s.db, s.cfg, ep, script);
  // GRAPHICS_AUDIT (src/qa/gfxaudit.ts, src/gfxauditstep.ts): every overlay measured as it will be drawn; in fix mode
  // cards are moved onto their words, held, trimmed or dropped, repeats and unreadable strips go, and a wrong graphic
  // that cannot be dropped fails the render. What it returns is what renders.
  // PEOPLE_INSETS: each person's photo on the first spoken word of their name; the tracklist on the line about the list.
  const people = s.cfg.peopleInsets ? peopleOnWords(assets.people ?? [], words) : [];
  const tracklist = s.cfg.peopleInsets
    ? tracklistOf(script, segments, words, plan, people.map((p) => p.at))
    : undefined;
  // SHORT_LAYOUTS / SHORT_SOUND_PLAN (src/untemplatestep.ts): the newest Shorts' shapes and effect sequences, read once.
  const untemplateMemory =
    s.cfg.shortLayouts || s.cfg.shortSoundPlan === "sparse" ? await readShortMemory(s.db, ep.id).catch(() => undefined) : undefined;
  // SHORT_LAYOUTS: the opening and closing (before the graphics gate, which measures them); SHORT_FIRST_SHOT_MIN_S, its
  // own test, holds the first shot (today 0.4 s on a still opening: plan.ts STING_FRAMES).
  const shape = shapeShort({
    cfg: s.cfg,
    id: ep.id,
    plan,
    clean: shortClean,
    rumour: Boolean(script.is_rumour),
    headline: script.headline,
    memory: untemplateMemory,
    assets,
  });
  if (assets.shortShape) await logEvent(s.db, ep.id, "short_shape", assets.shortShape);
  if (assets.shortFirstShot) await logEvent(s.db, ep.id, "short_first_shot", assets.shortFirstShot);
  // MENTION_*: the mention insets on their words, scheduled once here so the audit and the render agree.
  const mentions = mentionPlacement(s.cfg, assets.mentions, words, plan, "short", [
    { from: 0, to: shortLayout(segments, plan.fps, plan.totalFrames, plan.tailFrames).hookEnd },
  ]).slots;
  const gfxIn = () => ({
    ...gfxInputOf({ script, assets, segments, words, plan, stamps: shownStamps, clean: shortClean, shape }),
    people: people.map((p) => ({ name: p.name, src: p.file, credit: p.credit, at: p.at })),
    tracklist,
    mentions,
  });
  const gated = await graphicsGateShort(s, ep.id, gfxIn(), assets.gfxMuted ?? []);
  if (gated) {
    segments.splice(0, segments.length, ...gated.segments);
    shownStamps.splice(0, shownStamps.length, ...(gated.stamps as typeof shownStamps));
    plan.shelf = gated.shelf;
    plan.craft = gated.craft;
  }
  const entrySpans = overlaySpans({
    segments,
    words,
    plan,
    layout: shortLayout(segments, plan.fps, plan.totalFrames, plan.tailFrames),
    stamps: shownStamps,
    sting: false,
    shape,
    people: people.map((p) => ({ name: p.name, src: p.file, credit: p.credit, at: p.at })),
    tracklist,
    mentions,
  });
  // The game collage card's place (cleanframe.ts stingPlacement), worked out once for the upgrades and the render.
  const stingAt = assets.suite
    ? (stingPlacement({
        segments,
        words,
        fps: plan.fps,
        totalFrames: plan.totalFrames,
        names: (t) => namesGame(t, script.game_title),
        pictures: (assets.images ?? []).filter((i) => i.aspect >= 1.2 && !isHardwareAsset(i)).length,
      }) ?? null)
    : undefined;
  // SHORT_* upgrades (src/shortupgradestep.ts): the game map, depth type, orbit, compare wipe, look and 3D box,
  // placed round every overlay the Short keeps. Mention insets of a place the map pins give way to it.
  const shortLayoutNow = shortLayout(segments, plan.fps, plan.totalFrames, plan.tailFrames);
  const upgraded = await shortUpgradesFor({
    cfg: s.cfg,
    episodeDir: dir,
    game: script.game_title,
    segments,
    words,
    plan: { ...plan, scenes: plan.scenes ?? [] },
    layout: shortLayoutNow,
    images: (assets.images ?? []).map((i) => ({
      kind: i.kind,
      aspect: i.aspect,
      wordy: i.wordy,
      focusX: i.focusX,
      beatIndex: i.beatIndex,
      ...(depthArm === "depth" && i.layers
        ? { layers: { ...i.layers, mesh: s.cfg.parallaxDeep ? i.layers.mesh : undefined } }
        : {}),
    })),
    stamps: shownStamps,
    kept: [
      ...(shortClean ? arbitrate(entrySpans) : entrySpans),
      ...(stingAt ? [{ key: "sting", kind: "sting", from: stingAt.from, to: stingAt.from + stingAt.frames }] : []),
    ],
    mentions,
    blender: blender3d.clips,
    isRumour: !!script.is_rumour,
  }).catch((err) => {
    log("warn", "Short upgrades skipped", { episode: ep.id, error: errorMessage(err) });
    return undefined;
  });
  if (upgraded) {
    mentions.splice(0, mentions.length, ...upgraded.mentions);
    await logEvent(s.db, ep.id, "short_upgrades", {
      devices: Object.keys(upgraded.upgrades).filter((k) => (upgraded.upgrades as Record<string, unknown>)[k]),
      notes: upgraded.notes,
    }).catch(() => undefined);
  }
  // SHORT_SOUND_PLAN (src/untemplatestep.ts): on the sparse side, effects only where the gated cards and stamps land.
  if (soundStepDue(s.cfg, plan)) {
    const stampSound = wordSoundCue(plan.wordLook);
    const sound = soundShort({
      cfg: s.cfg,
      id: ep.id,
      plan,
      segments,
      words,
      stamps: shownStamps,
      clean: shortClean,
      stampSound,
      shape,
      people: people.map((p) => ({ name: p.name, src: p.file, credit: p.credit, at: p.at })),
      tracklist,
      mentions,
      // The game collage card, where the render draws it (motifSting below): it arrives like a card where it shows.
      sting: stingAt ?? false,
      memory: untemplateMemory,
      assets,
      // A stored sparse plan on the v3 side was given its v3 cues back where the plan was loaded (restoreV3Sound).
      v3: () => plan.sfx,
    });
    await logEvent(s.db, ep.id, "short_sound", sound);
  }
  if (assets.shortShape || assets.shortSoundArm || assets.shortFirstShot || plan.soundPlan)
    await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(assets)]);
  // GAME_AUDIO_BED (src/assets/gameaudio.ts): on the test's side, the footage's own sound as one bed, cut with the
  // plan, ducked under the voice, up between sentences and silent under a quote; logged for the weekly split.
  const gameAudio = gameAudioOn(s.cfg, ep.id, isRetrospective(ep.factcheck_json));
  const gameBed =
    gameAudio && assets.clips?.length
      ? await buildShortBed({
          dir,
          dataDir: s.cfg.dataDir,
          ytdlp: s.cfg.ytdlpPath,
          clips: assets.clips,
          plan,
          words,
          quotes: assets.quotes ?? [],
          underLufs: s.cfg.gameAudioUnderLufs,
          gapLufs: s.cfg.gameAudioGapLufs,
          trailers: s.cfg.gameAudioTrailers,
          trailerVoice: s.cfg.trailerQuotes,
          sfxStems: s.cfg.gameSfxStems,
        })
      : undefined;
  if (s.cfg.gameAudioBed)
    await logEvent(s.db, ep.id, "game_audio", {
      on: gameAudio,
      hearable: (assets.clips ?? []).filter((c) => clipSoundKind(c) !== "none")
        .length,
      ...(gameBed
        ? {
            seconds: gameBed.seconds,
            heard: gameBed.heard,
            skipped: gameBed.skipped.slice(0, 12),
          }
        : {}),
    }).catch(() => undefined);
  // EVIDENCE_STYLE (src/evidencestep.ts): a mystery or lore Short in the board arm gets the date cards, the case card,
  // the red stamps and its stills on the evidence board; off, ineligible or the plain arm: no plan, nothing changes.
  const evidence = await prepareEvidence({
    cfg: s.cfg,
    episodeId: ep.id,
    frame: "short",
    fps: plan.fps,
    headline: script.headline,
    title: script.youtube?.title,
    game: script.game_title,
    chapters: segments.flatMap((g) => (g.visual?.primary ? [g.visual.primary] : [])),
    words,
    segments,
    images: (assets.images ?? []).map((i) => ({ file: i.file, kind: i.kind, provenance: i.provenance })),
    dir,
    avoid: [
      [0, shortLayoutNow.hookEnd],
      [shortLayoutNow.loopFrom, plan.totalFrames],
      ...shownStamps.map((st): [number, number] => [Math.round(st.at * plan.fps) - 15, Math.round(st.at * plan.fps) + 84]), // the word stamp's 2.8 s (components/Stamp.tsx STAMP_FRAMES)
    ],
    event: (kind, detail) => logEvent(s.db, ep.id, kind, detail),
  });
  if (evidence) assets.evidenceArm = evidence.arm;
  const shortBoard = evidence?.plan(plan.shots, plan.totalFrames);
  await s.render({
    episodeDir: dir,
    outFile: raw,
    posterFile: path.join(dir, "poster.jpg"),
    thumbFile: assets.shortThumb
      ? path.join(dir, assets.shortThumb)
      : undefined,
    // SHORT_FULL_COVER: the whole headline with no caption, the cover the platforms show (src/social/cover.ts).
    coverFile: s.cfg.shortFullCover ? path.join(dir, COVER_FILE) : undefined,
    concurrency: s.cfg.remotionConcurrency,
    speed: s.cfg.renderSpeed,
    gl: s.cfg.remotionGl,
    browserExecutable: s.cfg.browserExecutable,
    props: {
      headline: script.headline,
      // The game collage card only on a line that names the game, held 2.5 s, never with hardware (cleanframe.ts).
      ...(assets.suite
        ? {
            motifSting: stingAt ?? null,
          }
        : {}),
      // SHORT_OPEN_WORDS: an opening on the game's footage carries a short caption (hook words or the headline's subject), never the headline.
      ...(s.cfg.shortOpenWords > 0 && opening?.ok && plan.shots[0]?.media.type === "clip"
        ? {
            openingWords: openingCaption(
              { thumbText: script.youtube?.thumb_text, headline: script.headline, game: script.game_title },
              s.cfg.shortOpenWords,
            ),
          }
        : {}),
      storyType: script.is_rumour ? "rumour" : script.story_type,
      gameTitle: mediaTitle(script.game_title),
      isRumour: script.is_rumour,
      attribution:
        s.cfg.shortLabelsClean && ownWorkShort(script) ? "" : script.attribution,
      bright: s.cfg.shortBright,
      quickFigures: s.cfg.shortLabelsClean,
      ownWork: s.cfg.shortLabelsClean && !!script.evergreen_format,
      gameSubtitle,
      vivid: s.cfg.shortVivid,
      footageCredit,
      segments,
      words,
      durationSeconds: duration,
      variant,
      audioFile: assets.audio ?? null,
      musicFile,
      imageFiles: (assets.images ?? []).map((i) => ({
        file: i.file,
        kind: i.kind,
        aspect: i.aspect,
        blurFile: i.blurFile,
        // Copies made while a switch was on are not shown once it is off (a retried or re-rendered episode).
        fillFile: s.cfg.fillFrame ? i.fillFile : undefined,
        upFile: s.cfg.upscaleStills ? i.upFile : undefined,
        beatIndex: i.beatIndex,
        credit: photoCredit(i),
        focusX: i.focusX,
        ...(isHardwareAsset(i) ? { noCollage: true } : {}),
        // SHORT_PARALLAX: the depth layers made above; the long render's layers ride along only when it is on.
        ...(depthArm === "depth" && i.layers
          ? {
              layers: {
                bg: i.layers.bg,
                mid: i.layers.mid,
                fg: i.layers.fg,
                ...(s.cfg.parallaxDeep && i.layers.mesh ? { mesh: i.layers.mesh } : {}),
              },
            }
          : {}),
      })),
      clipFiles: (assets.clips ?? []).map((c) => ({
        file: c.file,
        durationSeconds: c.durationSeconds,
        blurFile: c.blurFile,
        beatIndex: c.beatIndex,
        role: c.role,
        motion: c.motion,
        luma: c.luma,
        stock: c.stock,
        credit: c.credit ?? ccCredit(c.provenance),
        crop: c.crop,
      })),
      steam: steamLite,
      emphasis: emphasisWords(script),
      deskName: assets.desk?.voice.name,
      stamps: shownStamps,
      chrono: Boolean(script.every_game),
      plan,
      suite: assets.suite,
      // The clean frame (src/render/cleanframe.ts): SHORTS_CLEAN, or the clean-frame retention test's arm or winner.
      clean: shortClean,
      mascot: assets.mascot,
      heroCutFile: assets.heroCut,
      ...(seriesCover ? { seriesCover } : {}),
      renderDate: s.now().toISOString().slice(0, 10),
      // COMMENT_REPLY_SHORTS: the viewer's comment as a card over the opening (src/render/components/CommentCard.tsx).
      ...(ep.story_json.reply
        ? { reply: { handle: ep.story_json.reply.handle, text: ep.story_json.reply.card } }
        : {}),
      quoteFiles: quoteRenderFiles(assets, { dialogue: dialogueOn(s.cfg) }),
      ...(people.length ? { peopleFiles: people } : {}),
      ...(tracklist ? { tracklist } : {}),
      ...(mentions.length ? { mentionFiles: mentions } : {}),
      // SHORT_LAYOUTS: the chosen opening and closing (src/render/untemplate.ts); absent, today's card at both ends.
      ...(shape ? { shape } : {}),
      ...(upgraded && Object.keys(upgraded.upgrades).length ? { upgrades: upgraded.upgrades } : {}),
      ...(shortBoard ? { board: shortBoard } : {}),
      ...(gameBed
        ? {
            gameBedFile: {
              file: gameBed.file,
              spans: gameBed.spans,
              dip: s.cfg.gameAudioMusicDip,
            },
          }
        : {}),
    },
  });
  await s.normalise(raw, final);
  await fs.rm(raw, { force: true });
  await designShortThumb(s, ep.id, dir, script, assets, plan.heroIndex, seriesCover);
  // GAME_LIBRARY: what this Short showed from the libraries, so the game's next Shorts show something else.
  {
    const keys = [
      ...new Set(
        plan.shots
          .map((x) => (x.media.type === "clip" ? assets.clips?.[x.media.index]?.libKey : x.media.type === "image" ? assets.images?.[x.media.index]?.libKey : undefined))
          .filter((k): k is string => Boolean(k)),
      ),
    ];
    const hero = assets.images?.[plan.heroIndex]?.libKey;
    if (hero && !keys.includes(hero)) keys.push(hero);
    if (keys.length)
      for (const game of [script.game_title, ...comparedGames(script)])
        await recordUsage(libraryRoot(s.cfg.dataDir), { episode: ep.id, game, at: s.now().toISOString(), keys }).catch((err) =>
          log("warn", "library usage not recorded", { error: errorMessage(err) }),
        );
  }

  const tech = await s.technicalQa(
    final,
    duration,
    ep.lane === "evergreen"
      ? { minSeconds: EVERGREEN_MIN_SECONDS, maxSeconds: 179 }
      : undefined,
  );
  let vision: VisionQa | undefined;
  let times: number[] = [];
  if (tech.ok && s.cfg.visionQa) {
    // Sampled after each card's counters have landed (24 frames) so a mid-count figure is never judged.
    // A card now lands on its word, not at its line's start: judged after it has landed, or an empty panel still
    // building up reads as a fault (ep_20261105_d8d0e098 at 0:05.3).
    times = shortSampleTimes(
      segments.map((g, i) =>
        g.explainer || (g.visual && g.visual.kind !== "none")
          ? Math.max(
              g.start,
              cardWindow(segments, words, i, plan.fps, plan.totalFrames).from /
                plan.fps -
                0.3,
            )
          : g.start,
      ),
      duration,
    );
    await fs.rm(path.join(dir, "qa"), { recursive: true, force: true });
    const frames = await s.extractFrames(final, path.join(dir, "qa"), times);
    vision = await s.visionQa(frames, {
      headline: script.headline,
      gameTitle: script.game_title,
      narration: narrationOf(script),
      cardTexts: segments.flatMap((g) => [
        ...(g.visual && g.visual.kind !== "none"
          ? [g.visual.primary, g.visual.secondary, ...(g.visual.items ?? [])].filter(
              (t): t is string => !!t,
            )
          : []),
        // EXPLAINERS: the explainer's own words and its kicker are graphics, not burned-in text.
        ...(g.explainer ? explainerTexts(g.explainer) : []),
      ]).concat((upgraded?.upgrades.kit ?? []).flatMap((k) => kitTexts(k.data))),
    });
  }
  // GRAPHICS_FRAME_CHECK: each card at its settled frame, for text cut off, overlapping or unreadable. A faulted card
  // is remembered (assets.gfxMuted) so the retry's audit leaves it out.
  const frameProblems: string[] = [];
  if (tech.ok && s.cfg.visionQa && s.cfg.graphicsFrameCheck) {
    // SHORT_* upgrades: never a card sampled under the map or the 3D podium (src/render/shortupgrades.ts).
    const checked = checksClearOfUpgrades(cardCheckTimes(gfxIn()), upgraded?.upgrades, plan.fps);
    if (checked.length) {
      const gfxFrames = await s.extractFrames(final, path.join(dir, "qa", "gfx"), checked.map((c) => c.t));
      const look = await s.visionQa(gfxFrames, {
        headline: script.headline,
        gameTitle: script.game_title,
        format: "shortgraphics",
        narration: narrationOf(script),
      });
      if (look.verdict === "fail") {
        const keys = faultedCards(look.problems, checked);
        assets.gfxMuted = [...new Set([...(assets.gfxMuted ?? []), ...keys])];
        frameProblems.push(...look.problems.map((p) => `graphics: ${p}`));
        await logEvent(s.db, ep.id, "graphics_frame_check", { problems: look.problems, muted: keys });
      }
    }
  }
  // Every rank card must stay up for its whole entry, in text the card can show (src/render/rankcard.ts).
  const entryCards = entryHolds(
    segments,
    shortClean ? arbitrate(entrySpans) : entrySpans,
    plan.fps,
    plan.totalFrames,
  );
  const entryProblems = entryCardProblems(entryCards, segments);
  const qa = {
    technical: tech,
    vision: vision ?? null,
    rubric,
    media_rich: mediaRich,
    ...(entryCards.length ? { entry_cards: entryCards } : {}),
    checked_at: s.now().toISOString(),
  };
  const visionProblems =
    vision?.verdict === "fail"
      ? vision.problems.length
        ? vision.problems
        : [`vision QA failed: ${vision.notes || "no reason given"}`]
      : [];
  // SHORT_AD_SAFE_GATE (src/openingstep.ts): nothing YouTube limits ads on in the first 7 s or as the cover. A designed
  // search tile that fails gives way to the first frame; a failing first frame or an unreplaced shot fails QA.
  const adSafe: string[] = [];
  if (tech.ok && s.cfg.shortAdSafeGate && opening) {
    if (assets.shortThumb === "thumb_search.jpg") {
      const tile = coverProblem(await lookOpeningFrame(path.join(dir, assets.shortThumb)));
      if (tile) {
        assets.shortThumb = s.cfg.shortFullCover && existsSync(path.join(dir, COVER_FILE)) ? COVER_FILE : undefined;
        assets.shortThumbArm = "frame";
        await logEvent(s.db, ep.id, "ad_safe_tile_dropped", { problem: tile });
      }
    }
    const [cover] = await s
      .extractFrames(final, path.join(dir, "qa", "cover"), [0])
      .catch(() => [] as string[]);
    const coverLook = cover ? await lookOpeningFrame(cover) : undefined;
    adSafe.push(...adSafeGateProblems(opening.seconds, coverLook));
    await logEvent(s.db, ep.id, "ad_safe_gate", {
      pass: !adSafe.length,
      problems: adSafe,
      coverScreened: Boolean(coverLook),
    });
  }
  const problems = [...tech.problems, ...visionProblems, ...entryProblems, ...frameProblems, ...adSafe];
  // The check was skipped (the relay went down mid-render): held, the render kept on disk, checked again when back.
  if (
    s.cfg.visionHold &&
    visionSkipped(vision) &&
    (assets.clips?.length ?? 0) + (assets.images?.length ?? 0) > 0
  ) {
    await s.db.query(`UPDATE episodes SET qa_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(qa)]);
    await holdForVision(s, ep);
    return;
  }
  if (problems.length > 0) {
    // The retry re-plans from scratch (the planner or the components may have changed since) and judges fresh frames.
    const { plan: _dropped, ...withoutPlan } = assets;
    // A moment the checker faulted for text, a logo, the wrong game or (QA_AD_SWAP) ad safety is not tried again; an
    // ad-safety moment is also remembered in the footage screen cache (src/assets/screencache.ts), so no later
    // gather picks it. 13-14 Nov 2026: one bent-over GTA VI shot failed five Shorts, three renders each.
    const off = offendingMedia(
      // The technical check's black stretches name where they are: the clip on screen there is swapped too.
      [...visionProblems, ...tech.problems.filter((p) => /black frames \(at /.test(p))],
      times,
      plan,
      { adSwap: s.cfg.qaAdSwap },
    );
    // The ad-safe gate names shots, not frames: an unreplaced clip there is swapped the same way.
    if (s.cfg.qaAdSwap)
      for (const p of adSafe) {
        const m = p.match(/\bshot (\d+)\b/);
        const shot = m ? plan.shots[Number(m[1])] : undefined;
        if (shot?.media.type === "clip") {
          off.clips.add(shot.media.index);
          off.unsafeClips?.add(shot.media.index);
        }
      }
    // QA_FLATTEN_DEPTH: a layered still faulted for its edges (a torn cut-out, repeated strips) renders flat on the retry
    // and keeps its place, instead of the same tear again or a good picture thrown away (src/qa/retry.ts).
    if (s.cfg.qaFlattenDepth) {
      const flat = flattenDepthFaults(visionProblems, times, plan, withoutPlan.images ?? [], off);
      if (flat.length) {
        log("warn", "depth layers dropped for the retry", { episode: ep.id, images: flat });
        await logEvent(s.db, ep.id, "depth_flattened", { images: flat });
      }
    }
    const banned = rememberUnsafe(
      withoutPlan.clips ?? [],
      off,
      [...visionProblems, ...adSafe].join(" | "),
    );
    if (banned)
      await logEvent(s.db, ep.id, "unsafe_moments_remembered", { keys: banned });
    // The game library remembers faulted moments too, so a fresh gather cannot pick them again.
    const libKeys = [
      ...[...off.clips].map((i) => (withoutPlan.clips ?? [])[i]?.libKey),
      ...[...off.images].map((i) => (withoutPlan.images ?? [])[i]?.libKey),
    ].filter((k): k is string => !!k);
    if (libKeys.length && script.game_title)
      await markLibraryFaults(s.cfg.dataDir, script.game_title, libKeys, [...visionProblems, ...adSafe].join(" | "))
        .then((n) => (n ? logEvent(s.db, ep.id, "library_faults_marked", { keys: libKeys, marked: n }) : undefined))
        .catch(() => undefined);
    const dropped = dropOffending(withoutPlan, off);
    if (dropped.clips || dropped.images) {
      log("warn", "faulted media dropped for the retry", {
        episode: ep.id,
        ...dropped,
      });
      await logEvent(s.db, ep.id, "media_dropped", dropped);
    }
    await s.db.query(
      `UPDATE episodes SET qa_json = $2, assets_json = $3 WHERE id = $1`,
      [ep.id, JSON.stringify(qa), JSON.stringify(withoutPlan)],
    );
    throw new Error(`QA failed: ${problems.join(" | ")}`);
  }
  // FRAME_FOCUS (src/framefocusstep.ts, off by default): one frame per spoken line to the free local vision model, asking
  // whether the line's subject is visible, large and centred. Recorded on assets.frame_focus; the video never changes and
  // a failure or a slow model never fails or holds the episode (time-boxed inside the step).
  if (s.cfg.frameFocus !== "off")
    await frameFocusStep(s, ep, {
      assets,
      game: script.game_title,
      segments,
      duration,
      video: final,
      dir,
    });
  await transition(s.db, ep.id, "voiced", "rendered", {
    assets_json: {
      ...assets,
      video: "short.mp4",
      poster: "poster.jpg",
      musicFile,
    },
    qa_json: qa,
  });
}

async function stepRequestApproval(s: Services, ep: Episode): Promise<void> {
  const script = ep.script_json!;
  const links = approvalLinks(s.cfg, ep.id);
  // At release, every lane: the script, the words as voiced and the captions. Fails, never holds for a tap.
  if (s.cfg.writerNotesGuard) {
    const srtFile = ep.assets_json?.srt
      ? path.join(episodeDir(s.cfg, ep.id), ep.assets_json.srt)
      : undefined;
    const srt = srtFile
      ? await fs.readFile(srtFile, "utf8").catch(() => undefined)
      : undefined;
    const found = releaseWriterNotes({
      script,
      words: ep.assets_json?.words,
      srt,
    });
    if (found.length) await stopForWriterNotes(s, ep, "at release", found);
  }
  // The release gate (src/qa/releaseGate.ts): every long video's shots (documentary, ranking, recap) are
  // scored against the words spoken over them before it may go out on its own, with the same thresholds.
  // A held one waits here for the owner like a manual approval.
  if (
    ep.lane === "longform" &&
    longCraft(script, s.cfg).releaseGate &&
    ep.assets_json?.longPlan
  ) {
    const a = ep.assets_json;
    const segments = openChaptersAtBreaks(
      buildSegments(
        segmentInputs(script, Boolean(a.desk)),
        a.words ?? [],
        (a.durationSeconds ?? 0) + LONG_TAIL_SECONDS,
      ),
      a.breaks,
    );
    const chapters = [...(script.entries ?? [])]
      .sort((x, y) => y.rank - x.rank)
      .map((e) => ({ game: e.game_title, year: e.year }));
    const held = await releaseGateStep(
      {
        db: s.db,
        cfg: s.cfg,
        llm: s.llm,
        notify: (m) => s.notify(m),
        now: () => s.now(),
        episodeDir: (id) => episodeDir(s.cfg, id),
      },
      ep,
      { segments, chapters, links },
    );
    if (held) return;
  }
  // SHORT_TITLE_GAME_FIRST (src/strandstep.ts): the Short's title opens on the game's name, then the why or how.
  if (await applyShortTitleGameFirst(s, ep, script))
    await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(script)]);
  // SHORT_ARGUES_CHECK (src/qa/argues.ts): a Short with no point beyond its picture, or none of Pulse's own
  // material, was already sent back to the writer once; here it is released under the lane's usual mode with a
  // note on the notice, never held for the owner. A twin repeats a Short already through it.
  const argues =
    s.cfg.shortArguesCheck && ep.lane !== "longform" && ep.lane !== "twin"
      ? arguesCheck(script, ep.assets_json, ep.lane)
      : undefined;
  if (argues)
    await logEvent(s.db, ep.id, "argues_check", {
      pass: argues.pass,
      point: argues.point,
      own: argues.own,
      describing: argues.describing,
      sentences: argues.sentences,
      problems: argues.problems,
    }).catch(() => undefined);
  // A single-source story always waits for a human. A rumour that two outlets (or an official source)
  // carry is reported as a labelled report ("reportedly" throughout, the title says so) under the lane's
  // usual mode: from 25 Oct 2026 the channel covers leaks and reports, clearly marked.
  const risky = !ep.story_json.corroborated;
  // The owner taps every gameplay Short: their own recordings never publish on a timer.
  // A twin repeats a Short the owner already approved: it goes out on its own.
  const mode =
    ep.lane === "twin"
      ? "auto"
      : risky || ep.lane === "gameplay"
        ? "manual"
        : ep.lane === "evergreen"
          ? s.cfg.evergreenApprovalMode
          : ep.lane === "longform"
            ? s.cfg.longformApprovalMode
            : s.cfg.approvalMode;
  const when =
    mode === "auto"
      ? "Auto mode: publishing now."
      : mode === "timeout"
        ? `Publishes automatically in ${ep.lane === "news_breaking" ? s.cfg.breakingApprovalMinutes : s.cfg.approvalTimeoutMinutes} min unless rejected.`
        : "Waiting for your approval.";
  const dir = episodeDir(s.cfg, ep.id);
  // Auto mode needs nothing from the owner: a short "going out" note with a Watch link, no buttons.
  const g = script.gameplay;
  const tap = gameplayLinks(s.cfg, ep.id, Boolean(g?.live));
  const rehearsal = ep.lane === "gameplay" && !!ep.story_json.gameplay?.rehearsal;
  const description = rehearsal && g
    ? [
        "🧪 **Rehearsal: nothing here can publish.**",
        `**Question:** ${g.question}`,
        `**Result:** ${g.result}`,
        `**Game:** ${script.game_title}`,
        `**Why it was picked:** ${ep.story_json.gameplay?.review.reason ?? "n/a"} (score ${ep.story_json.gameplay?.review.score ?? "?"}/10)`,
        ...(ep.story_json.gameplay?.review.keep
          ? []
          : ["The reviewer would have passed on this; it was sent on to test the lane."]),
        "",
        `▶️ [Watch preview](${links.preview})`,
      ]
    : g
    ? [
        ...(g.live
          ? [
              `🔴 **From today's live stream**, cut minutes after it happened. One tap on Approve and it goes out ${s.cfg.liveClips.publishNow ? "at the next free gap" : "in the next gameplay slot"}.`,
            ]
          : []),
        `**Question:** ${g.question}`,
        `**Result:** ${g.result}`,
        `**Game:** ${script.game_title}${g.experiment_number ? `  ·  test #${g.experiment_number} on the list` : "  ·  a fresh test"}`,
        `**Why it was picked:** ${ep.story_json.gameplay?.review.reason ?? "n/a"} (score ${ep.story_json.gameplay?.review.score ?? "?"}/10)`,
        g.radio
          ? "⚠️ **Radio or licensed music may be audible.** That can trigger a Content ID claim; reject if you would rather not risk it."
          : "No licensed music heard.",
        "",
        `▶️ [Watch preview](${links.preview})  ·  ✅ [Approve](${tap.approve})  ·  ❌ [Reject](${tap.reject})`,
        when,
      ]
    : mode === "auto"
      ? [
          `**Hook:** ${script.hook}`,
          `Fact-checked against ${ep.story_json.sources.length} source${ep.story_json.sources.length === 1 ? "" : "s"}. Going out automatically, nothing for you to do.`,
          `▶️ [Watch](${links.preview})`,
        ]
      : [
          `**Hook:** ${script.hook}`,
          `**Pulse take:** ${script.pulse_take.narration}`,
          `**Sources:** ${ep.story_json.sources.join(", ")}${ep.story_json.hasOfficial ? " (official)" : ""}`,
          `**Fact-check:** ${ep.factcheck_json?.summary ?? "n/a"}`,
          "",
          `▶️ [Watch preview](${links.preview})  ·  ✅ [Approve](${links.approve})  ·  ❌ [Reject](${links.reject})`,
          when,
        ];
  if (argues && !argues.pass)
    description.unshift(
      `**Released with a note (argues, not describes):** ${argues.problems.join("; ")}. Nothing for you to do.`,
    );
  const delivered = await s.notify({
    // Gameplay notices buzz the phone: the Maze Bank Short sat unseen for 48 hours among the channel's alerts.
    ping: ep.lane === "gameplay",
    embeds: [
      {
        title: `🎬 ${rehearsal ? "[REHEARSAL] " : ""}${script.youtube.title}`,
        url: links.preview,
        description: description.join("\n"),
        color: script.is_rumour ? COLOURS.alert : COLOURS.brand,
        image: { url: "attachment://poster.jpg" },
      },
    ],
    files: [path.join(dir, "poster.jpg")],
  });
  // Never start a publish countdown nobody was told about.
  if (delivered === false && mode === "timeout")
    throw new Error(
      "approval notice could not be posted to Discord; retrying before any auto-publish",
    );
  // The owner's tap is the only way a gameplay Short moves: a notice that never arrived is tried again.
  if (delivered === false && ep.lane === "gameplay")
    throw new Error(
      "gameplay approval notice could not be posted to Discord; trying again",
    );
  if (rehearsal) {
    // Told, and finished: with no approval state left, nothing can publish it.
    await transition(s.db, ep.id, "rendered", "rejected", {
      last_error: "rehearsal: reached Discord, nothing published",
    });
    await logEvent(s.db, ep.id, "gameplay_rehearsal", {
      clip: g?.inbox_id,
      delivered: delivered ?? null,
    });
    return;
  }
  if (mode === "auto") {
    await transition(s.db, ep.id, "rendered", "approved", {
      approval_mode: mode,
      approved_by: "auto",
      approval_requested_at: s.now(),
    });
  } else {
    await transition(s.db, ep.id, "rendered", "awaiting_approval", {
      approval_mode: mode,
      approval_requested_at: s.now(),
    });
    if (ep.lane === "gameplay")
      await gameplayStatus(s.cfg, ep, "awaiting_approval");
  }
}

const MANUAL_APPROVAL_EXPIRY_HOURS = 48; // the Discord links last 3 days

async function stepAwaitApproval(s: Services, ep: Episode): Promise<void> {
  if (!ep.approval_requested_at) return;
  const waited =
    s.now().getTime() - new Date(ep.approval_requested_at).getTime();
  if (ep.approval_mode === "manual") {
    const gameplay = ep.lane === "gameplay";
    const expiryHours = gameplay
      ? s.cfg.gameplayApprovalHours
      : MANUAL_APPROVAL_EXPIRY_HOURS;
    // One nudge with fresh links, since a gameplay Short has no other way forward.
    if (
      gameplay &&
      s.cfg.gameplayRemindHours > 0 &&
      waited >= s.cfg.gameplayRemindHours * 3600_000 &&
      waited < expiryHours * 3600_000
    ) {
      const [told] = await s.db.query<{ n: string | number }>(
        `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'gameplay_reminded'`,
        [ep.id],
      );
      if (Number(told?.n ?? 0) === 0) {
        const links = gameplayLinks(s.cfg, ep.id, Boolean(ep.script_json?.gameplay?.live));
        await logEvent(s.db, ep.id, "gameplay_reminded", {});
        await s.notify({
          ping: true,
          content: `🎮 Still waiting for your tap: "${ep.script_json?.youtube.title ?? ep.story_json.headline}". It expires ${Math.round(expiryHours - waited / 3600_000)} hours from now.\n▶️ [Watch preview](${links.preview})  ·  ✅ [Approve](${links.approve})  ·  ❌ [Reject](${links.reject})`,
        });
      }
    }
    // An unanswered episode must not block tomorrow's Short forever.
    if (
      waited >= expiryHours * 3600_000 &&
      (await transition(s.db, ep.id, "awaiting_approval", "rejected", {
        last_error: "approval expired unanswered",
      }))
    ) {
      await logEvent(s.db, ep.id, "rejected", { by: "expiry" });
      await s.notify({
        ...(gameplay ? {} : { level: "info" as const }),
        content: `⌛ "${ep.script_json?.youtube.title ?? ep.story_json.headline}" expired after ${expiryHours}h without approval; ${gameplay ? "the clip stays in the inbox." : "moving on to new stories."}`,
      });
    }
    return;
  }
  if (ep.approval_mode !== "timeout") return;
  const timeoutMinutes =
    ep.lane === "news_breaking"
      ? s.cfg.breakingApprovalMinutes
      : ep.lane === "evergreen"
        ? s.cfg.evergreenApprovalMinutes
        : ep.lane === "longform"
          ? s.cfg.longformApprovalMinutes
          : s.cfg.approvalTimeoutMinutes;
  if (waited >= timeoutMinutes * 60_000) {
    // The countdown only publishes if the owner could actually have tapped Reject: when the
    // public URL (the tunnel) is down the Discord links are dead, so the episode is held.
    if (!(await s.publicReachable())) {
      log("warn", "approval timeout held: public URL unreachable", {
        episode: ep.id,
        url: s.cfg.publicUrl,
      });
      return;
    }
    if (
      await transition(s.db, ep.id, "awaiting_approval", "approved", {
        approved_by: "timeout",
      })
    ) {
      await logEvent(s.db, ep.id, "approved", { by: "timeout" });
    }
  }
}

/** Publish now if inside the window, otherwise at the next window opening. */
/**
 * When this episode goes live: breaking publishes now inside its window (else
 * at the window's next opening); news publishes at its slot (now if the slot
 * has passed); every lane keeps MIN_UPLOAD_GAP_MINUTES clear of any other publish.
 * Returns undefined for "now".
 */
export function choosePublishAt(
  cfg: Config,
  now: Date,
  ep?: Pick<Episode, "lane" | "slot_at">,
  /** Other publish times on the same channel, past and scheduled (src/lanes.ts publishTimes). */
  published?: Date | Date[],
): Date | undefined {
  let at: Date | undefined;
  if (ep?.lane === "news_breaking") {
    at = inWindow(now, cfg.breakingWindow, cfg.timezone)
      ? undefined
      : nextWindowStart(now, cfg.breakingWindow, cfg.timezone);
  } else if (ep?.slot_at) {
    const slot = new Date(ep.slot_at);
    at = slot > now ? slot : undefined;
  } else {
    // Legacy window behaviour for episodes without a slot.
    const earliest = new Date(now.getTime() + cfg.youtubeVetoMinutes * 60_000);
    const h = earliest.getUTCHours();
    if (h < cfg.publishWindowStartUtc)
      at = new Date(
        Date.UTC(
          earliest.getUTCFullYear(),
          earliest.getUTCMonth(),
          earliest.getUTCDate(),
          cfg.publishWindowStartUtc,
        ),
      );
    else if (h >= cfg.publishWindowEndUtc)
      at = new Date(
        Date.UTC(
          earliest.getUTCFullYear(),
          earliest.getUTCMonth(),
          earliest.getUTCDate() + 1,
          cfg.publishWindowStartUtc,
        ),
      );
    else if (cfg.youtubeVetoMinutes > 0) at = earliest;
  }
  // Clear of every other publish by the gap, past or scheduled. Only publishes near this one move it: a
  // documentary scheduled two days out once held every Short behind it (27-28 Oct 2026, nine videos queued).
  const others = (
    Array.isArray(published) ? published : published ? [published] : []
  )
    .map((d) => d.getTime())
    .sort((x, y) => x - y);
  const gap = cfg.minUploadGapMinutes * 60_000;
  let t = (at ?? now).getTime();
  for (let moved = true, i = 0; moved && i < 200; i++) {
    moved = false;
    for (const o of others)
      if (Math.abs(o - t) < gap) {
        t = o + gap;
        moved = true;
      }
  }
  if (t > (at ?? now).getTime()) at = new Date(t);
  // YouTube needs scheduled times comfortably in the future; otherwise go now.
  if (at && at.getTime() - now.getTime() < 15 * 60_000) return undefined;
  return at;
}

/**
 * PREMAKE_REFRESH: a held pre-made Short is made again when its game came out (or its story's date passed) after its
 * media was gathered, or it is under half moving footage, and the slot leaves time (src/premakerefresh.ts). A remake
 * back here is kept when it has at least the made video's footage, otherwise the made video is put back. True when
 * the Short went back to be made again (this step is done for now).
 */
export async function premakeRefreshStep(s: Services, ep: Episode): Promise<boolean> {
  const assets = (ep.assets_json ?? {}) as Record<string, unknown>;
  const record = ep.assets_json?.premadeRefresh;
  if (record?.state === "remaking") {
    const verdict = remakeVerdict({
      status: "approved",
      now: s.now(),
      slotAt: ep.slot_at!,
      originalShare: record.share,
      newShare: planFootageShare(ep.assets_json?.plan),
    });
    if (verdict.action === "restore") await restorePremade(s, ep, verdict.why);
    else {
      const { original: _drop, originalQa: _qa, ...kept } = record;
      await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
        ep.id,
        JSON.stringify({ ...assets, premadeRefresh: { ...kept, state: "done", outcome: verdict.why } }),
      ]);
      await logEvent(s.db, ep.id, "premake_refresh", { outcome: "kept", why: verdict.why }).catch(() => undefined);
    }
    return false;
  }
  if (record) return false;
  const decision = premakeRefreshDecision({
    now: s.now(),
    slotAt: ep.slot_at!,
    gatheredAt: ep.created_at ?? s.now().toISOString(),
    launches: readLaunches(s.cfg.launchCalendarFile),
    // The writer's game and the story's own hint (the run entry's game) both count.
    game: [ep.script_json?.game_title, ep.story_json.gameHint].filter(Boolean).join(" | "),
    headline: [ep.script_json?.headline, ep.story_json.headline].filter(Boolean).join(" | "),
    keyDate: ep.story_json.why?.key_date,
    plan: ep.assets_json?.plan,
  });
  if (!decision.refresh) return false;
  const dir = episodeDir(s.cfg, ep.id);
  const kept = await keepMadeFiles(dir);
  if (!kept.video) return false;
  const next = refreshAssets(assets, { at: s.now(), why: decision.why, share: decision.share, qa: ep.qa_json ?? undefined, ...kept });
  if (!(await transition(s.db, ep.id, "approved", "voiced", { assets_json: next }))) return false;
  await logEvent(s.db, ep.id, "premake_refresh", { outcome: "remaking", why: decision.why, share: decision.share }).catch(() => undefined);
  log("info", "pre-made Short made again before upload", { id: ep.id, why: decision.why });
  await s
    .notify({
      level: "info",
      content: `🔁 The pre-made "${ep.script_json?.youtube?.title ?? ep.story_json.headline}" is being made again before it goes out: ${decision.why}. If the remake is not ready, or is worse, it goes out as made.`,
    })
    .catch(() => undefined);
  return true;
}

/** Puts a pre-made Short's made video, poster, assets and quality record back (the remake failed, was worse or late). */
async function restorePremade(s: Services, ep: Episode, why: string): Promise<boolean> {
  const back = restoredAssets((ep.assets_json ?? {}) as Record<string, unknown>, why);
  if (!back) return false;
  if (!(await putMadeFilesBack(episodeDir(s.cfg, ep.id)))) {
    log("warn", "pre-made Short: the made video is gone, the remake stays", { id: ep.id, why });
    return false;
  }
  const qa = ep.assets_json?.premadeRefresh?.originalQa;
  await s.db.query(
    `UPDATE episodes SET status = 'approved', attempts = 0, next_attempt_at = NULL, last_error = NULL, updated_at = now(),
            assets_json = $3${qa !== undefined ? ", qa_json = $4" : ""} WHERE id = $1 AND status = $2`,
    [ep.id, ep.status, JSON.stringify(back), ...(qa !== undefined ? [JSON.stringify(qa)] : [])],
  );
  await logEvent(s.db, ep.id, "premake_refresh", { outcome: "restored", why }).catch(() => undefined);
  log("info", "pre-made Short goes out as made", { id: ep.id, why });
  return true;
}

/**
 * SHORT_FOOTAGE_WAIT: a Short the footage gate would hold while the anonymous YouTube lane is paused (or was, during its
 * gather) waits for the pause to lift and gathers again from nothing, once. A slot it would miss goes to the next ready
 * Short and it becomes a spare for the next empty one. True when it was set to wait (src/premakerefresh.ts).
 */
async function waitForYouTube(s: Services, ep: Episode, assets: EpisodeAssets): Promise<boolean> {
  // A pre-made Short being made again fails as before, so the made video goes back and keeps its slot.
  if (assets.premadeRefresh?.state === "remaking") return false;
  const pause = await s.youtubePause?.().catch(() => undefined);
  const now = s.now().getTime();
  const plan = footageWaitPlan({
    now,
    blockUntil: pause?.until,
    // The pause ended within the last hour: the gather that just ran most likely met it.
    metPause: Boolean(pause?.until && pause.until > now - 3_600_000),
    waitedBefore: Boolean(assets.footageWait),
  });
  if (!plan.wait) return false;
  // A slot it would miss can only be made up as a spare, and spares go out only for Why and launch run Shorts with a
  // run file (fillSpareGaps); anything else is held as before.
  const loses = Boolean(ep.slot_at && new Date(ep.slot_at).getTime() < plan.at.getTime() + 45 * 60_000);
  if (loses && !canBeSpare(s, ep)) return false;
  await requeueForFootage(s, ep, assets as Record<string, unknown>, plan.at, "YouTube downloads were paused while its footage was gathered");
  await s
    .notify({
      level: "info",
      content: `🎞️ "${ep.script_json?.headline ?? ep.story_json.headline}" has no moving footage only because YouTube downloads are paused; it gathers again after ${plan.at.toISOString().slice(11, 16)} UTC${ep.slot_at && new Date(ep.slot_at).getTime() < plan.at.getTime() + 45 * 60_000 ? " and waits as a spare for the next empty slot (its own slot goes to the next ready Short)" : ""}.`,
    })
    .catch(() => undefined);
  return true;
}

/** Whether a Short may wait as a spare: a Why or launch run Short while a run file fills empty slots (fillSpareGaps). */
const canBeSpare = (s: Services, ep: Episode): boolean =>
  Boolean(s.cfg.shortRunFile) && (Boolean(ep.story_json.why) || Boolean(ep.story_json.run));

/**
 * Back to "voiced" with the gathered media dropped, gathering at `at`; a slot it cannot make (or, with `spare`, any
 * slot: a held Short's slot may have gone to another Short since) goes and it waits as a spare.
 */
async function requeueForFootage(s: Services, ep: Episode, assets: Record<string, unknown>, at: Date, why: string, spare = false): Promise<void> {
  const loseSlot = spare || Boolean(ep.slot_at && new Date(ep.slot_at).getTime() < at.getTime() + 45 * 60_000);
  const story = loseSlot ? { ...ep.story_json, spare: ep.story_json.spare ?? {} } : ep.story_json;
  await s.db.query(
    `UPDATE episodes SET status = 'voiced', attempts = 0, last_error = NULL, next_attempt_at = $2, updated_at = now(),
            assets_json = $3, story_json = $4${loseSlot ? ", slot_at = NULL" : ""} WHERE id = $1 AND status = $5`,
    [ep.id, at, JSON.stringify(footageRetryAssets(assets, { at: s.now(), why })), JSON.stringify(story), ep.status],
  );
  await logEvent(s.db, ep.id, "footage_wait", { until: at.toISOString(), why, spare: loseSlot }).catch(() => undefined);
  log("info", "Short waits for YouTube to gather footage again", { id: ep.id, at: at.toISOString(), spare: loseSlot });
}

/**
 * SHORT_FOOTAGE_WAIT for Shorts the footage gate already held: a Why or evergreen Short held for no moving footage in the
 * last FOOTAGE_RETRY_DAYS days is tried once more, from nothing, as a spare, once the anonymous YouTube lane is open
 * (17 Nov 2026: two Shorts held only because every fetch met the bot-check pause). One a tick.
 */
export async function retryFootageHolds(s: Services): Promise<string | undefined> {
  const pause = await s.youtubePause?.().catch(() => undefined);
  const now = s.now();
  if (pause?.until && pause.until > now.getTime()) return undefined;
  const rows = await s.db.query<Episode>(
    `SELECT * FROM episodes WHERE status = 'failed' AND updated_at > $1::timestamptz - make_interval(days => $2)
        AND assets_json ? 'audio' AND NOT (assets_json ? 'footageWait') AND last_error LIKE 'QA held:%'
      ORDER BY updated_at DESC`,
    [now, FOOTAGE_RETRY_DAYS],
  );
  // Only Shorts that can wait as a spare: a failed Short's slot is free for others, so it never takes it back.
  const ep = rows.find((e) => isFootageHold(e.last_error) && canBeSpare(s, e));
  if (!ep) return undefined;
  await requeueForFootage(s, ep, (ep.assets_json ?? {}) as Record<string, unknown>, now, "held for no moving footage while YouTube downloads were paused; tried once more", true);
  await s
    .notify({
      level: "info",
      content: `🎞️ "${ep.script_json?.headline ?? ep.story_json.headline}" was held for no moving footage while YouTube downloads were paused. It is gathering again now and waits as a spare for the next empty slot.`,
    })
    .catch(() => undefined);
  return ep.id;
}

/**
 * Every remaking pre-made Short not back at approval: the made video goes back when the remake failed or is not ready
 * PREMAKE_FALLBACK_MINUTES before the slot (src/premakerefresh.ts remakeVerdict). Runs each tick.
 */
export async function settlePremakeRefreshes(s: Services): Promise<number> {
  const rows = await s.db.query<Episode>(
    `SELECT * FROM episodes WHERE assets_json->'premadeRefresh'->>'state' = 'remaking'
        AND status NOT IN ('approved','uploading','uploaded','published','rejected') AND slot_at IS NOT NULL`,
  );
  let n = 0;
  for (const ep of rows) {
    const record = ep.assets_json?.premadeRefresh;
    if (!record) continue;
    const verdict = remakeVerdict({ status: ep.status, now: s.now(), slotAt: ep.slot_at!, originalShare: record.share });
    if (verdict.action === "restore" && (await restorePremade(s, ep, verdict.why))) n++;
  }
  return n;
}

async function stepApproved(s: Services, ep: Episode): Promise<void> {
  // A spare from the launch run waits, approved and checked, until a slot would go out empty (fillSpareGaps).
  if (ep.story_json.spare && !ep.slot_at) {
    await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [
      ep.id,
      new Date(s.now().getTime() + 30 * 60_000),
    ]);
    return;
  }
  // Made days ahead (RUN_PREMAKE_HOURS): held here, approved and checked, and scheduled on YouTube only
  // RUN_PREMAKE_UPLOAD_HOURS before the slot, so a slot moved by the 03:00 rule or a late correction never meets a
  // video already scheduled, and nothing that spaces uploads sees a publish time days out.
  if (ep.story_json.premade && ep.slot_at) {
    // PREMAKE_REFRESH (src/premakerefresh.ts): made again first when its game came out since, or it is short of footage.
    if (s.cfg.premakeRefresh && (await premakeRefreshStep(s, ep))) return;
    const holdUntil = new Date(
      new Date(ep.slot_at).getTime() - s.cfg.runPremakeUploadHours * 3600_000,
    );
    if (holdUntil > s.now()) {
      await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [
        ep.id,
        premakeNextLook(holdUntil, s.now(), s.cfg.premakeRefresh && !ep.assets_json?.premadeRefresh),
      ]);
      return;
    }
  }
  // A gameplay Short takes the first free gameplay slot, clear of everything already scheduled.
  if (ep.lane === "gameplay" && !ep.slot_at) {
    const rows = await s.db.query<{ at: string; lane: string }>(
      `SELECT COALESCE(publish_at, slot_at) AS at, lane FROM episodes
        WHERE COALESCE(publish_at, slot_at) IS NOT NULL AND COALESCE(publish_at, slot_at) > $1::timestamptz - interval '1 hour'
          AND status NOT IN ('failed','rejected') AND id <> $2`,
      [s.now(), ep.id],
    );
    // LIVE_CLIPS_PUBLISH_NOW: a clip from the live stream goes out while its topic is hot, at the first time clear of
    // every other publish (choosePublishAt keeps the gap), not in the evening's gameplay slot.
    const slot =
      ep.story_json.gameplay?.live && s.cfg.liveClips.publishNow
        ? new Date(s.now().getTime() + 60_000)
        : nextGameplaySlot(
      s.cfg,
      s.now(),
      rows.filter((r) => r.lane !== "gameplay").map((r) => new Date(r.at)),
      rows.filter((r) => r.lane === "gameplay").map((r) => new Date(r.at)),
      gtaDailyKept(s.cfg),
    );
    if (slot) {
      await s.db.query(`UPDATE episodes SET slot_at = $2 WHERE id = $1`, [
        ep.id,
        slot,
      ]);
      ep = { ...ep, slot_at: slot.toISOString() };
    }
  }
  // GTA 6 Day N: the day before and the playlist, for the description's links.
  if (ep.story_json.gtaDaily) ep = await refreshGtaDailyLinks(s, ep);
  // A challenge episode: the one before and the playlist (src/challenge.ts).
  if (ep.story_json.challenge) ep = await refreshChallengeLinks(s, ep);
  // LONG_RESLOT (src/longreslot.ts): a long video finished well after its slot goes out when its planned hour next
  // comes round, not the moment it is ready (Cyberpunk documentary, 26 Nov). Only the publish time moves.
  const lateTo =
    ep.lane === "longform" && ep.slot_at && s.cfg.longReslot
      ? longReslot(new Date(ep.slot_at), s.now(), s.cfg.timezone, s.cfg.longReslotGraceHours)
      : undefined;
  // A late video also keeps clear of the slots planned videos still in production hold, so it never takes their hour.
  const planned = lateTo
    ? (
        await s.db.query<{ slot_at: string }>(
          `SELECT slot_at FROM episodes WHERE slot_at > $1 AND id <> $2
            AND status NOT IN ('failed','rejected','uploading','uploaded','published')`,
          [s.now(), ep.id],
        )
      ).map((r) => new Date(r.slot_at))
    : [];
  const publishAt = choosePublishAt(
    s.cfg,
    s.now(),
    lateTo ? { ...ep, slot_at: lateTo.toISOString() } : ep,
    [...(await publishTimes(s.db, s.now(), ep.lane === "twin")), ...planned],
  );
  if (lateTo && publishAt) {
    await logEvent(s.db, ep.id, "late_long_rescheduled", {
      slot_at: ep.slot_at,
      publish_at: publishAt.toISOString(),
    });
    await s
      .notify({
        level: "info",
        content: `"${ep.script_json?.youtube.title ?? ep.story_json.headline}" was finished after its ${whenLabel(new Date(ep.slot_at!), s.cfg.timezone)} slot, so it is scheduled for ${whenLabel(publishAt, s.cfg.timezone)}.`,
      })
      .catch(() => undefined);
  }
  // Public uploads are scheduled on YouTube (private until publish_at). Anything else
  // cannot be scheduled there, so the upload itself waits until the slot.
  // A Premiere documentary (PREMIERE_DOCS) uploads private as soon as it is made, for the Studio premiere step.
  const holdUpload =
    publishAt && s.cfg.youtubePrivacy !== "public" && !isPremiereDoc(s.cfg.premiereDocs, ep.factcheck_json);
  await transition(s.db, ep.id, "approved", "uploading", {
    publish_at: publishAt ?? null,
    ...(holdUpload ? { next_attempt_at: publishAt } : {}),
  });
  if (publishAt)
    await logEvent(s.db, ep.id, "scheduled", {
      publish_at: publishAt.toISOString(),
      lane: ep.lane,
    });
}

/**
 * The description's footage credit, built from each clip's provenance: Steam
 * trailers grouped by game, publisher YouTube trailers listed with their link,
 * the Xbox content rules line when Microsoft material is involved.
 */
/** Chapter lines for the long-form description: the intro at 0:00, each entry, the pick. */
export function longChapters(ep: Episode): string[] {
  const script = ep.script_json;
  const words = ep.assets_json?.words ?? [];
  if (!script || !words.length) return [];
  const duration = (ep.assets_json?.durationSeconds ?? 0) + LONG_TAIL_SECONDS;
  const segments = openChaptersAtBreaks(
    buildSegments(
      segmentInputs(script, Boolean(ep.assets_json?.desk)),
      words,
      duration,
    ),
    ep.assets_json?.breaks,
  );
  // LONG_CHAPTER_CADENCE (src/strandframe.ts): the writer's moment marks fill the gaps between chapters, thinned so
  // every mark stands at least a minute from the next; none on the script: the list is the chapters, as before.
  const marks = new Map((script.moment_marks ?? []).map((m) => [m.beat, m.label]));
  let beat = -1;
  const lines = chapterLines(segments, (seg) => {
    if (seg.kind === "beat") beat++;
    const mark = seg.kind === "beat" && seg.visual?.kind !== "chapter" && seg.visual?.kind !== "rank" ? marks.get(beat) : undefined;
    return mark ? `${MOMENT_MARK}${mark}` : chapterLabel(seg);
  });
  return marks.size ? cadenceChapters(lines) : lines;
  function chapterLabel(seg: (typeof segments)[number]): string | undefined {
    return seg.kind === "hook"
      ? "Intro"
      : seg.kind === "beat" && seg.visual?.kind === "rank"
        ? `#${seg.visual.value_a} ${seg.visual.primary}`
        : seg.kind === "beat" && seg.visual?.kind === "chapter"
          ? seg.visual.primary
          : seg.kind === "take"
            ? script!.evergreen_format === "documentary" || script!.gta_guide
              ? titleCaseLabel(script!.pulse_take.label)
              : "Our pick"
            : undefined;
  }
}

/**
 * The long video's narration with the time each stretch starts (ANSWER_PACK, src/levers/answer.ts): the same segments
 * longChapters times, each marked when it opens a chapter (a chapter card or a ranking entry).
 */
export function longTimedLines(ep: Episode): TimedLine[] {
  const script = ep.script_json;
  const words = ep.assets_json?.words ?? [];
  if (!script || !words.length) return [];
  const duration = (ep.assets_json?.durationSeconds ?? 0) + LONG_TAIL_SECONDS;
  const segments = openChaptersAtBreaks(
    buildSegments(segmentInputs(script, Boolean(ep.assets_json?.desk)), words, duration),
    ep.assets_json?.breaks,
  );
  // The segments carry the spoken form ("two thousand one"); the facts quote the script as written ("2001"), so each
  // segment takes the written line of its kind in the same order (empty lines are never segments).
  const written: Record<string, string[]> = {
    hook: [script.hook],
    beat: script.beats.map((x) => x.narration).filter((t) => t.trim()),
    desk: script.desk_question ? [script.desk_question] : [],
    take: [script.pulse_take.narration],
    loop: [script.loop_line ?? ""],
  };
  const used: Record<string, number> = {};
  return segments
    .map((seg) => {
      const i = used[seg.kind] ?? 0;
      used[seg.kind] = i + 1;
      return { seg, text: written[seg.kind]?.[i] ?? seg.text };
    })
    .filter(({ text }) => text.trim())
    .map(({ seg, text }) => ({
      start: seg.start,
      text,
      opensChapter:
        seg.kind === "take" ||
        (seg.kind === "beat" && (seg.visual?.kind === "rank" || seg.visual?.kind === "chapter")),
    }));
}

/** The answer pack of a long video (src/levers/answer.ts): its summary, question chapters and key facts, for the site. */
export function longAnswerPack(ep: Episode) {
  const script = ep.script_json!;
  return answerPack(script, finishChapters(longChapters(ep)), longTimedLines(ep));
}

export function footageCredits(
  script: Script,
  clips: Array<{ provenance: string }>,
  official: EpisodeAssets["officialTrailer"] | undefined,
  publisher: string | undefined,
  headline: string,
): string {
  if (!clips.length && !official) return "";
  const steamGames = new Set<string>();
  const cutsceneGames = new Set<string>();
  const channels = new Map<string, string>(); // channel -> url
  for (const c of clips) {
    const cutscene = c.provenance.match(/^Cutscenes for "([^"]+)" from YouTube video /);
    if (cutscene) cutsceneGames.add(cutscene[1]!);
    const steam = c.provenance.match(
      /^Official Steam trailer "[^"]*" for "([^"]+)"/,
    );
    if (steam) steamGames.add(steam[1]!);
    const yt = c.provenance.match(
      /from the (.+?) YouTube channel, publisher: [^(]+\((https?:[^)]+)\)/,
    );
    const social = c.provenance.match(
      /^Official post "[^"]*" by (.+? on TikTok), publisher: [^(]+\((https?:[^)]+)\)/,
    );
    if (social) channels.set(social[1]!, social[2]!);
    if (yt) channels.set(yt[1]!, yt[2]!);
  }
  if (official) channels.set(official.channelTitle, official.url);
  const lines: string[] = [];
  // Clips whose provenance names no trailer (older episodes, test fixtures) still get the generic credit.
  if (!steamGames.size && !channels.size && !cutsceneGames.size && clips.length)
    lines.push(
      `Footage: ${script.game_title} official trailer${publisher ? ` (${publisher})` : ""}, via Steam. Store art: Steam.`,
    );
  if (steamGames.size === 1 && !script.entries?.length)
    lines.push(
      `Footage: ${[...steamGames][0]} official trailer${publisher ? ` (${publisher})` : ""}, via Steam, a few seconds. Store art: Steam.`,
    );
  else if (steamGames.size)
    lines.push(
      `Footage: official Steam trailers, a few seconds each: ${[...steamGames].join(", ")}. Store art: Steam.`,
    );
  for (const game of cutsceneGames) lines.push(`Footage: ${game} cutscenes, via YouTube.`);
  for (const [channel, url] of channels)
    lines.push(
      /on TikTok$/.test(channel)
        ? `Footage: official post by ${channel} (${url}).`
        : `Footage and still: the official ${channel} YouTube channel (${url}).`,
    );
  const cc = new Map<string, string>();
  for (const c of clips) {
    const m = c.provenance.match(
      /^Gameplay "[^"]*" by (.+?), Creative Commons Attribution licence \(CC BY\) \((https?:[^)]+)\)/,
    );
    if (m) cc.set(m[1]!, m[2]!);
  }
  for (const [channel, url] of cc)
    lines.push(`Gameplay: ${channel}, licensed CC BY (${url}).`);
  // Stock and archive footage, one line per library (src/assets/stock.ts).
  lines.push(...stockCreditLines(clips));
  if (
    /microsoft|xbox game studios|bethesda/i.test(
      `${publisher ?? ""} ${headline}`,
    )
  )
    lines.push(
      "Game footage used under Microsoft's Game Content Usage Rules: https://www.xbox.com/en-US/developers/rules",
    );
  return lines.length ? `\n${lines.join("\n")}` : "";
}

/** REVIEWER_PACK: the website the sources pages live on, or nothing when the pack is off. */
export function reviewerPackFor(cfg: Pick<Config, "reviewerPack" | "siteUrl" | "publicUrl">): { siteBase: string } | undefined {
  const siteBase = (cfg.siteUrl || cfg.publicUrl || "").replace(/\/$/, "");
  return cfg.reviewerPack && siteBase ? { siteBase } : undefined;
}

/** Owner rule: never an em dash in anything public (19 Nov 2026: a writer's "Steam News — https://..." reached a
 * description). Before a link it becomes a colon, elsewhere a comma; a spaced en dash is treated the same. */
export const noDash = (s: string): string =>
  s.replace(/[ 	]*(?:—|[ 	]–)[ 	]*(?=https?:)/g, ": ").replace(/[ 	]*(?:—|[ 	]–[ 	])[ 	]*/g, ", ");

export function videoMetadata(
  ep: Episode,
  privacy: Config["youtubePrivacy"],
  syntheticMedia = true,
  affiliate?: AffiliateTags,
  /** LEONIDA_LINK, and the time to judge the day by when the video has no publish time. */
  leonidaLink = false,
  now = new Date(),
  /** REVIEWER_PACK (src/reviewer.ts): the standard AI line and the video's sources page on the website. */
  pack?: { siteBase: string },
  /** The platform levers this description follows (ANSWER_PACK, STREAM_ARCHIVE_LINKS); absent: neither. */
  levers?: Pick<LeverSettings, "answerPack" | "streamArchiveLinks">,
) {
  const script = ep.script_json!;
  const credits = ep.story_json.items
    .slice(0, 4)
    .map((i) => `• ${i.source}: ${i.url}`)
    .join("\n");
  if (script.twin) {
    // The twin's description in its language: the body, the original, the sources, the fixed lines.
    const parentUrl = `https://youtube.com/shorts/${script.twin.parent_video}`;
    const hashtags = (script.hashtags ?? [])
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .slice(0, 5)
      .join(" ");
    return {
      title: script.youtube.title.slice(0, 100),
      description: [
        script.youtube.description
          .trim()
          .replace(/#\w+/g, "")
          .replace(/\s{2,}/g, " ")
          .trim(),
        credits ? `\nFuentes:\n${credits}` : "",
        ...twinFooter(script.twin.language, parentUrl).map((l) => `\n${l}`),
        hashtags,
      ]
        .filter((line) => line !== "")
        .join("\n")
        .slice(0, 4950),
      tags: script.youtube.tags.slice(0, 15),
      categoryId: "20",
      privacyStatus: privacy,
      publishAt: ep.publish_at
        ? new Date(ep.publish_at).toISOString()
        : undefined,
      containsSyntheticMedia: syntheticMedia,
      defaultLanguage: script.twin.language,
    };
  }
  const clips = ep.assets_json?.clips ?? [];
  const publisher =
    clips[0]?.provenance.match(/publisher[^:]*:\s*([^;)]+)/i)?.[1]?.trim() ??
    ep.assets_json?.officialTrailer?.publisher;
  const official = ep.assets_json?.officialTrailer;
  const footage = footageCredits(
    script,
    clips,
    official,
    publisher,
    ep.story_json.headline,
  );
  const writerBody = script.youtube.description
    .trim()
    .replace(/#\w+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const long = script.runtime === "long";
  // ANSWER_PACK (src/levers/answer.ts): a long video opens on a 2 to 3 sentence summary, asks its chapters as the
  // questions people search where that is natural, and lists its key facts with their times after the chapters.
  const answerOn = Boolean(levers?.answerPack && long && !script.recap);
  const summary = answerOn ? summaryLead(script) : "";
  const body = summary ? withoutSummary(writerBody, summary) : writerBody;
  // The chapter marks YouTube reads (src/youtube/chapters.ts): 0:00 first, three or more, ten seconds apart.
  const plainChapters = long ? finishChapters(longChapters(ep), writerBody) : [];
  const chapters = answerOn ? questionChapters(plainChapters, loopQuestions(script)) : plainChapters;
  const facts = answerOn && plainChapters.length ? keyFactLines(keyFacts(longTimedLines(ep))) : [];
  // STREAM_ARCHIVE_LINKS (src/levers/archives.ts): a Short cut from a stream points at the archive at its moment.
  const archive = levers?.streamArchiveLinks ? ep.story_json.streamArchive : undefined;
  // Shop links for every game and piece of hardware the video names, right under the summary.
  const shop = affiliateBlock(script, affiliate, { free: ep.lane === "free" });
  // A Why Short's long video on the same game (src/youtube/longlink.ts), under the summary.
  const follow = ep.story_json.why?.follow;
  // GTA VI launch: the Leonida Intel page for the day the video goes public (src/launchprep.ts).
  const leonida =
    leonidaLink &&
    isGta6(`${script.game_title} ${ep.story_json.gameHint ?? ""} ${script.headline}`)
      ? leonidaLine(ep.publish_at ? new Date(ep.publish_at) : now)
      : undefined;
  // The disclosure and channel lines always survive the length cut (src/authenticity.ts fitDescription).
  const description = fitDescription(
    [
      // fitDescription drops empty lines, so the blank line after the summary travels inside it.
      ...(summary ? [`${summary}
`] : []),
      keywordLead(script),
      ...(ep.assets_json?.searchTerms?.length ? [searchLine(ep.assets_json.searchTerms)] : []),
      // A documentary's second line: the same "next" its end card shows (src/youtube/nextdoc.ts).
      nextLine(ep.assets_json?.nextDoc ?? undefined),
      "",
      body,
      // A video reply to a viewer's question: who asked, and the video they asked under (src/commentreply.ts).
      ep.story_json.reply ? `\n${replyDescriptionLine(ep.story_json.reply)}` : "",
      leonida ? `\n${leonida}` : "",
      // GTA 6 Day N (src/gtadaily.ts): the day before and the whole run, in order.
      ep.story_json.gtaDaily ? `\n${dailyDescriptionLines(ep.story_json.gtaDaily).join("\n")}` : "",
      // A challenge episode (src/challenge.ts): the one before, the series in order and the count so far.
      ep.story_json.challenge ? `\n${challengeDescriptionLines(ep.story_json.challenge).join("\n")}` : "",
      follow?.videoId && follow.title
        ? `\nThe whole story, in our ${follow.kind}: ${follow.title} https://youtu.be/${follow.videoId}`
        : "",
      shop,
      script.is_rumour
        ? "\nThis story is unconfirmed. We will update if it is confirmed or denied."
        : "",
      archive ? `\n${archiveDescriptionLine(archive)}` : "",
      chapters.length ? `\nChapters:\n${chapters.join("\n")}` : "",
      facts.length ? `\n${facts.join("\n")}` : "",
      credits ? `\nSources:\n${credits}` : "",
      script.sources?.length
        ? `\nSources:\n${descriptionSources(script.sources).join("\n")}`
        : "",
      // The photo libraries used, named (only Commons: the line the channel always had).
      affiliate?.shopUrl
        ? photoSourcesLine(
            ep.assets_json?.images ?? [],
            affiliate.shopUrl.replace(/\/shop\//, "/credits/"),
          )
        : "",
      footage,
    ],
    [
      pack
        ? `\n${disclosureLine(script)}\n${sourcesLine(pack.siteBase, ep.id)}`
        : script.gameplay?.direct
        ? `\nGameplay recorded by Pulse Gaming on Xbox Series X from our own copy of ${script.game_title}. Narration: AI-generated synthetic voice.`
        : script.gameplay
        ? `\nGameplay recorded by Pulse Gaming on Xbox Series X from our own copy of ${script.game_title}. No AI voice: the sound is the game's own.`
        : "\nNarration: AI-generated synthetic voice. Visuals: official publisher material, credited.",
      script.gameplay
        ? "\nPulse Gaming: we test what games let you do, one question at a time. Tell us what to test next in the comments."
        : script.recap
          ? "\nPulse Gaming News: gaming news, checked and explained. The week's biggest stories every Friday, a new ranking every week, Shorts every day."
          : script.explained
            ? "\nPulse Gaming News: gaming news, checked and explained. The biggest story in gaming explained in depth, a new ranking every week, Shorts every day."
          : script.evergreen_format === "documentary"
            ? "\nPulse Gaming News: the stories behind the games, checked and explained. A new documentary every month, a new ranking every week, Shorts every day."
            : long
              ? "\nPulse Gaming News: rankings, news and takes, checked and explained. A new ranking every week, Shorts every day."
              : "\nPulse Gaming News: fast gaming news, checked and explained. New Shorts every day.",
      (long
        ? hashtags(script)
            .filter((h) => h !== "#Shorts")
            .concat("#Gaming")
        : hashtags(script)
      ).join(" "),
    ],
  );
  return {
    // A launch-run Why keeps the title the run planned (story_json.why.title), word for word.
    title: noDash(ep.story_json.why?.title?.trim() || polishTitle(script)),
    description: noDash(description),
    tags: [
      ...new Set([
        ...buildTags(script).slice(0, 2),
        ...(ep.assets_json?.searchTerms ?? []),
        ...buildTags(script).slice(2),
      ]),
    ].filter((_, i, all) => tagChars(all.slice(0, i + 1)) <= 490),
    categoryId: "20",
    privacyStatus: privacy,
    publishAt: ep.publish_at
      ? new Date(ep.publish_at).toISOString()
      : undefined,
    // The narrator is a cloned voice, so disclose it (as Codex did). The
    // label does not affect reach or monetisation.
    containsSyntheticMedia: syntheticMedia,
    defaultLanguage: "en",
  };
}

/** Asks autocomplete once for this video's terms (src/searchterms.ts); no terms is fine, and the twin lane has its own. */
async function addSearchTerms(s: Services, ep: Episode): Promise<void> {
  const script = ep.script_json;
  if (!s.cfg.searchTerms || !script || script.twin || !script.game_title) return;
  if (ep.assets_json?.searchTerms) return;
  const text = [
    script.headline,
    script.hook,
    script.youtube?.title,
    script.youtube?.description,
    ...(script.beats ?? []).map((b) => b.narration),
    ...(script.entries ?? []).map((e) => JSON.stringify(e)),
  ].join(" ");
  const terms = await searchTermsFor(
    script.game_title,
    text,
    fetch,
    script.youtube?.title ?? "",
    [script.headline, script.hook, script.youtube?.title].join(" "),
  ).catch(() => []);
  ep.assets_json = { ...ep.assets_json!, searchTerms: terms };
  await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
    ep.id,
    JSON.stringify(ep.assets_json),
  ]);
}

/**
 * STREAM_ARCHIVE_LINKS (src/levers/archives.ts): a gameplay Short cut from one of the owner's streams records the
 * YouTube archive and second it came from, before its description is written. Nothing happens until the live watcher
 * has recorded an archive, and a Short already linked keeps its link. Never blocks the upload.
 */
async function attachStreamArchive(s: Services, ep: Episode): Promise<void> {
  try {
    const g = ep.script_json?.gameplay;
    if (!s.cfg.levers?.streamArchiveLinks || ep.lane !== "gameplay" || !g || ep.story_json.streamArchive) return;
    const archives = readArchives(s.cfg.dataDir);
    if (!archives.length) return;
    const meta = await readMeta(gameplayDir(s.cfg, g.inbox_id));
    if (!meta) return;
    const link = archiveLinkFor(meta, readTwitchStreams(s.cfg.dataDir), archives);
    if (!link) return;
    ep.story_json = { ...ep.story_json, streamArchive: link };
    await s.db.query(`UPDATE episodes SET story_json = $2 WHERE id = $1`, [ep.id, JSON.stringify(ep.story_json)]);
    await logEvent(s.db, ep.id, "stream_archive_linked", { ...link });
  } catch (err) {
    log("warn", "stream archive link failed", { episode: ep.id, error: errorMessage(err) });
  }
}

async function stepUpload(s: Services, ep: Episode): Promise<void> {
  if (s.cfg.dryRun) {
    await transition(s.db, ep.id, "uploading", "published", {
      youtube_status: "dry_run",
    });
    await s.notify({
      content: `🧪 DRY_RUN: "${ep.script_json!.youtube.title}" would have been uploaded now.`,
    });
    return;
  }
  // STORY_RECAP (src/storyrecap.ts): a full-spoiler recap never goes out while its game's spoiler window is open,
  // whatever happened before; it waits for the window's end.
  const recapGame = (ep.factcheck_json as { topic?: DocTopic } | null)?.topic?.recap?.game;
  if (recapGame) {
    const at = ep.publish_at ? new Date(ep.publish_at) : s.now();
    const until = recapHeldUntil(
      recapWindows(spoilerWindows(), s.cfg.gameFetchTitles, recapGame, s.cfg.spoilerWindowDays),
      [s.now(), at],
    );
    if (until) {
      await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [ep.id, new Date(until)]);
      await logEvent(s.db, ep.id, "recap_spoiler_hold", { until });
      return;
    }
  }
  // The owner's publishing hold: wait, and look again in a quarter of an hour.
  if (await publishHeld(s.db)) {
    await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [
      ep.id,
      new Date(s.now().getTime() + 15 * 60_000),
    ]);
    return;
  }
  const used = await quotaCalls(s.db, s.now(), "upload");
  if (used >= s.cfg.uploadCallsPerDay) {
    const resetAt = quotaResetAt(s.now());
    log("warn", "YouTube quota nearly spent; upload deferred", {
      episode: ep.id,
      used,
      resetAt: resetAt.toISOString(),
    });
    await s.db.query(`UPDATE episodes SET next_attempt_at = $2 WHERE id = $1`, [
      ep.id,
      resetAt,
    ]);
    await logEvent(s.db, ep.id, "quota_deferred", {
      used,
      reset_at: resetAt.toISOString(),
    });
    return;
  }
  await attachStreamArchive(s, ep);
  const yt = s.youtube(accountOf(ep));
  const marker = markerTag(ep.id);
  const file = path.join(episodeDir(s.cfg, ep.id), "short.mp4");

  // A previous attempt may have sent some or all of the bytes. With its session still on record, the
  // session itself says how much arrived and the rest is sent below. A video found only by its marker
  // tag can be a stub whose bytes never finished (three sat at "Processing will begin shortly" after a
  // dropped connection and restarts, 26 Oct 2026), so it is adopted only when YouTube has the whole file.
  if (!ep.upload_session_uri && ep.attempts > 0) {
    const existing = await yt.findByMarker(marker);
    const st = existing
      ? await yt.status(existing).catch(() => undefined)
      : undefined;
    const complete =
      !!st &&
      (st.uploadStatus === "processed" ||
        st.processingStatus === "succeeded" ||
        (st.partsProcessed ?? 0) > 0);
    if (existing && !complete)
      await logEvent(s.db, ep.id, "upload_stub_skipped", {
        videoId: existing,
        uploadStatus: st?.uploadStatus,
        processingStatus: st?.processingStatus,
      });
    if (existing && complete) {
      // Adopting it makes no new upload call, so nothing is charged.
      await transition(s.db, ep.id, "uploading", "uploaded", {
        youtube_video_id: existing,
      });
      await logEvent(s.db, ep.id, "upload_adopted", { videoId: existing });
      return;
    }
  }
  // A time word checked again at upload, against the moment it goes public, for every Short (scheduled or going
  // out now): one written days earlier, or from a day-old article, can still say "before launch" after launch (two
  // did on 19 Nov 2026). Only the owner's approval of a draft this check already held lets it through unchanged.
  {
    const now = s.now();
    const airs =
      ep.publish_at && new Date(ep.publish_at).getTime() > now.getTime()
        ? new Date(ep.publish_at)
        : now;
    const late = airTimeProblems(publicText(ep.script_json!), airs);
    const ownerPassed =
      late.length > 0 &&
      ep.approved_by === "human" &&
      (
        await s.db.query(
          `SELECT 1 FROM events WHERE episode_id = $1 AND kind = 'stale_review' AND detail ? 'reason' LIMIT 1`,
          [ep.id],
        )
      ).length > 0;
    if (late.length && !ownerPassed) {
      await transition(s.db, ep.id, "uploading", "awaiting_approval", {
        approval_mode: "manual",
        approval_requested_at: now,
        publish_at: null,
        upload_session_uri: null,
      });
      const links = approvalLinks(s.cfg, ep.id);
      await logEvent(s.db, ep.id, "stale_review", {
        planned: ep.publish_at ?? null,
        reason: late[0],
      });
      await s.notify({
        content: `⏳ "${ep.script_json!.youtube.title}" was held before upload: ${late[0]} It stays unpublished unless you approve it.
▶️ [Watch](${links.preview}) · ✅ [Approve](${links.approve}) · ❌ [Reject](${links.reject})`,
      });
      return;
    }
  }
  // A delayed Short: news or deals past their moment go back to the owner; anything else whose planned
  // time has passed gets a fresh slot spaced from the last publish. A scheduled time in the past makes
  // YouTube publish at once, so a backlog would otherwise all go live together.
  if (ep.publish_at) {
    const now = s.now();
    const planned = new Date(ep.publish_at);
    const staleHours = staleAfterHours(
      ep.lane,
      ep.script_json?.evergreen_format,
    );
    if (
      staleHours !== undefined &&
      now.getTime() - planned.getTime() > staleHours * 3600_000
    ) {
      await transition(s.db, ep.id, "uploading", "awaiting_approval", {
        approval_mode: "manual",
        approval_requested_at: now,
        publish_at: null,
        upload_session_uri: null,
      });
      const links = approvalLinks(s.cfg, ep.id);
      await logEvent(s.db, ep.id, "stale_review", {
        planned: planned.toISOString(),
      });
      await s.notify({
        content: `⏳ "${ep.script_json!.youtube.title}" was due at ${ukTime(planned, now)} but was held up, so it may be out of date now. It stays unpublished unless you approve it.
▶️ [Watch](${links.preview}) · ✅ [Approve](${links.approve}) · ❌ [Reject](${links.reject})`,
      });
      return;
    }
    if (planned.getTime() - now.getTime() < 15 * 60_000) {
      const [other] = await s.db.query<{ t: string | null }>(
        `SELECT max(publish_at) AS t FROM episodes WHERE id <> $1 AND status IN ('uploading','uploaded','published') AND publish_at IS NOT NULL AND youtube_status IS DISTINCT FROM 'dry_run'`,
        [ep.id],
      );
      let at = new Date(now.getTime() + 20 * 60_000);
      const gapEnd = other?.t
        ? new Date(
            new Date(other.t).getTime() + s.cfg.minUploadGapMinutes * 60_000,
          )
        : undefined;
      if (gapEnd && gapEnd > at) at = gapEnd;
      await s.db.query(
        `UPDATE episodes SET publish_at = $2, upload_session_uri = NULL WHERE id = $1`,
        [ep.id, at],
      );
      await logEvent(s.db, ep.id, "rescheduled", {
        from: planned.toISOString(),
        to: at.toISOString(),
      });
      ep = {
        ...ep,
        publish_at: at.toISOString(),
        upload_session_uri: null,
      } as Episode;
    }
  }
  let session = ep.upload_session_uri;
  // PACKAGING_LAB (src/packaging/lab.ts): the title (and a long video's main thumbnail) scored and, under "pick",
  // chosen before the first byte goes up. Once per episode; any trouble leaves the writer's packaging as it was.
  if (!session) await packBeforeUpload(s, ep, episodeDir(s.cfg, ep.id));
  if (!session) {
    const size = (await fs.stat(file)).size;
    session = await yt.createSession(
      buildResource(
        videoMetadata(
          ep,
          // PREMIERE_DOCS (src/premiere.ts): a Premiere documentary goes up private and unscheduled; Studio sets it.
          premierePrivacy(isPremiereDoc(s.cfg.premiereDocs, ep.factcheck_json), s.cfg.youtubePrivacy),
          // The altered-content flag: the AI voice, or a kept AI picture under AI_IMAGE_GATE (src/reviewer.ts).
          syntheticMediaFor(
            ep.lane === "gameplay" && !ep.script_json?.gameplay?.direct
              ? false
              : s.cfg.syntheticMedia,
            ep.assets_json,
            s.cfg.aiImageGate,
          ),
          affiliateTags(s.cfg, ep.id),
          s.cfg.leonidaLink,
          s.now(),
          reviewerPackFor(s.cfg),
          s.cfg.levers,
        ),
        marker,
      ),
      size,
    );
    // Opening the session is the videos.insert call: it counts even if the bytes never arrive.
    await quotaCall(s.db, s.now(), "upload");
    await s.db.query(
      `UPDATE episodes SET upload_session_uri = $2 WHERE id = $1 AND status = 'uploading'`,
      [ep.id, session],
    );
  }
  try {
    const videoId = await yt.uploadToSession(session, file);
    await transition(s.db, ep.id, "uploading", "uploaded", {
      youtube_video_id: videoId,
    });
    await logEvent(s.db, ep.id, "uploaded", { videoId });
    await localizeMetadata(s, ep, videoId, yt);
    // REVIEWER_PACK: the private production log, footage ledger and claims log (src/reviewer.ts); never blocks.
    if (s.cfg.reviewerPack)
      await s.db
        .query<{ kind: string; at: string; detail: unknown }>(
          `SELECT kind, created_at::text AS at, detail FROM events WHERE episode_id = $1 ORDER BY id`,
          [ep.id],
        )
        .then((events) =>
          writeRecords(s.cfg.dataDir, { ...ep, youtube_video_id: videoId } as never, events, s.now()),
        )
        .catch((err) => log("warn", "records not written", { episode: ep.id, error: errorMessage(err) }));
  } catch (err) {
    if (err instanceof SessionGone) {
      await s.db.query(
        `UPDATE episodes SET upload_session_uri = NULL WHERE id = $1`,
        [ep.id],
      );
    }
    throw err;
  }
}

/**
 * The title and description in the channel's other languages (LOCALIZE_LANGUAGES): one small model call
 * and one 50-unit videos.update, right after the upload. YouTube shows the matching pair to viewers whose
 * interface is in that language and indexes the video for their searches. Never blocks the upload.
 */
async function localizeMetadata(
  s: Services,
  ep: Episode,
  videoId: string,
  yt: ReturnType<Services["youtube"]>,
): Promise<void> {
  const langs = s.cfg.localizeLanguages.filter((l) => l.toLowerCase() !== "en");
  if (!langs.length || ep.lane === "twin") return;
  try {
    await addSearchTerms(s, ep);
    const meta = videoMetadata(
      ep,
      s.cfg.youtubePrivacy,
      s.cfg.syntheticMedia,
      affiliateTags(s.cfg, ep.id),
      s.cfg.leonidaLink,
      s.now(),
      reviewerPackFor(s.cfg),
      s.cfg.levers,
    );
    const loc = await translateMetadata(
      s.llm,
      { title: meta.title, description: meta.description },
      langs,
    );
    const done = Object.keys(loc);
    if (!done.length) return;
    await yt.setLocalizations(videoId, loc);
    await quotaAdd(s.db, s.now(), QUOTA.localize);
    await logEvent(s.db, ep.id, "localized", { languages: done });
  } catch (err) {
    log("warn", "localisation skipped", {
      episode: ep.id,
      error: errorMessage(err),
    });
    await logEvent(s.db, ep.id, "localize_failed", {
      error: errorMessage(err).slice(0, 300),
    }).catch(() => undefined);
  }
}

/**
 * Videos published before localisation existed get their titles and descriptions in the other
 * languages too: one every half hour, newest first, only while the day's spare quota covers it
 * comfortably. A video that failed is not tried again for a week.
 */
export async function localizeBackfill(s: Services): Promise<boolean> {
  if (!s.cfg.localizeLanguages.some((l) => l.toLowerCase() !== "en"))
    return false;
  const now = s.now();
  if ((await quotaHeadroom(s.db, s.cfg, now)) < 500) return false;
  if (
    await weeklyTried(s.db, `localize:${Math.floor(now.getTime() / 1_800_000)}`)
  )
    return false;
  const [row] = await s.db.query<{ id: string }>(
    `SELECT e.id FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane <> 'twin'
        AND coalesce(e.publish_at, e.updated_at) > $1::timestamptz - interval '120 days'
        AND coalesce(e.publish_at, e.updated_at) < $1::timestamptz
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind = 'localized')
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind = 'localize_failed' AND v.created_at > $1::timestamptz - interval '7 days')
      ORDER BY coalesce(e.publish_at, e.updated_at) DESC LIMIT 1`,
    [now],
  );
  const ep = row ? await getEpisode(s.db, row.id) : undefined;
  if (!ep?.youtube_video_id) return false;
  await localizeMetadata(s, ep, ep.youtube_video_id, s.youtube(accountOf(ep)));
  return true;
}

/** Every Associates ID the channel has, plus the video's shop page when the public address works from outside. */
export function affiliateTags(cfg: Config, episodeId: string): AffiliateTags {
  const publicOk =
    cfg.publicUrl &&
    !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(cfg.publicUrl);
  return {
    uk: cfg.amazonUkTag,
    us: cfg.amazonUsTag || undefined,
    ...cfg.amazonMoreTags,
    shopUrl: publicOk
      ? `${(cfg.siteUrl || cfg.publicUrl).replace(/\/$/, "")}/shop/${episodeId}`
      : undefined,
  };
}

/**
 * Ten minutes after a scheduled publish time, checks the video really went
 * public. Public: the first comment goes up now (YouTube refuses comments on
 * private videos). Still private: the owner is told once and never overridden,
 * since they may have made it private themselves.
 */
export async function confirmPublished(s: Services): Promise<void> {
  const due = await s.db.query<{
    id: string;
    youtube_video_id: string;
    title: string | null;
    account: string;
  }>(
    // Every tick for the first two hours after the slot, then once an hour for three days: an outage or
    // a slow YouTube no longer ends the check, so "published" is only ever confirmed, not assumed.
    `SELECT e.id, e.youtube_video_id, e.script_json->'youtube'->>'title' AS title, COALESCE(e.story_json->'twin'->>'account', '') AS account FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.publish_at IS NOT NULL
        AND e.publish_at < $1::timestamptz - interval '10 minutes' AND e.publish_at > $1::timestamptz - interval '72 hours'
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind IN ('public_confirmed','made_public'))
        AND NOT (e.publish_at < $1::timestamptz - interval '2 hours'
                 AND EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind = 'public_pending' AND v.created_at > $1::timestamptz - interval '55 minutes'))`,
    [s.now()],
  );
  for (const ep of due) {
    const st = await s.youtube(ep.account).status(ep.youtube_video_id);
    if (st?.privacyStatus === "public") {
      // The time we saw it public: the truthful release time for the site and the analytics, which the
      // planned slot only approximates (YouTube can run late, and a delayed video keeps its old slot).
      await logEvent(s.db, ep.id, "public_confirmed", {
        at: s.now().toISOString(),
      });
      const live = await getEpisode(s.db, ep.id);
      if (live) await gameplayLive(s, live);
      if (live?.story_json.gtaDaily) await linkGtaDaily(s, live);
      if (live?.story_json.challenge) await linkChallengePublic(s, live);
      // Now it is public it can join its series playlist (SERIES_PLAYLISTS; off, it joined at upload).
      if (live && s.cfg.seriesPlaylists) await addToSeries(s, live, "public");
    } else if (st?.privacyStatus === "private") {
      // Never publish it ourselves: the owner may have made it private on purpose, and YouTube cannot say who did.
      await logEvent(s.db, ep.id, "made_public", {
        skipped: true,
        was: st.privacyStatus,
      });
      log("warn", "scheduled video is still private after its slot", {
        episode: ep.id,
        video: ep.youtube_video_id,
      });
      await s.notify({
        ping: true,
        content: `⚠️ Needs you? "${ep.title ?? ep.id}" is still private after its scheduled time. If you made it private, ignore this. If not, set it to public in YouTube Studio: https://studio.youtube.com/video/${ep.youtube_video_id}/edit`,
      });
      continue;
    } else {
      // Not public yet (still processing, or YouTube running late): noted, and looked at again.
      await logEvent(s.db, ep.id, "public_pending", {
        was: st?.privacyStatus ?? "unknown",
      });
      continue;
    }
    // The first comment waits until the video is public.
    const [posted] = await s.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'comment_posted'`,
      [ep.id],
    );
    const full =
      Number(posted?.n ?? 0) === 0 ? await getEpisode(s.db, ep.id) : undefined;
    if (full) await addPinnedComment(s, full);
  }
}

/** Whether this video asks for a Hype (HYPE_ASK, src/youtube/hype.ts): one quota unit for the look-up, only when it could. */
async function hypeOn(s: Services, script: Script): Promise<boolean> {
  return hypeAllowed(s.cfg.hypeAsk, script, async () => {
    const n = await s.youtube().subscriberCount();
    await quotaAdd(s.db, s.now(), QUOTA.poll);
    return n;
  });
}

/** Posts the channel's own first comment (the owner pins it from the app; the API cannot pin). Never blocks a live video. */
async function addPinnedComment(s: Services, ep: Episode): Promise<void> {
  if (await publishHeld(s.db)) return; // the owner's publishing hold
  try {
    // Comment links are clickable on long videos (not on Shorts): the long video's pin carries its top pick.
    // A documentary's comment points at one chapter with its timestamp (DOC_PIN_MOMENT, src/youtube/pinned.ts).
    const script = ep.script_json!;
    // A Short gets the channel's comment only when it ends on its own real question (src/social/firstcomment.ts).
    // GTA 6 Day N: the next day (when already made) and the playlist (src/gtadaily.ts).
    // FIRST_COMMENT_STRICT (item 19): any Short gets its own closing question alone, or nothing; the GTA Daily links
    // stay in its description.
    if (s.cfg.firstCommentStrict && script.runtime !== "long" && !script.twin) {
      const q = strictShortComment(script);
      if (!q) {
        await logEvent(s.db, ep.id, "comment_skipped", { why: "no question of its own" });
        return;
      }
      const id = await s.youtube(accountOf(ep)).insertComment(ep.youtube_video_id!, q);
      await quotaAdd(s.db, s.now(), QUOTA.comment);
      await logEvent(s.db, ep.id, "comment_posted", { id, text: q });
      return;
    }
    const daily = ep.story_json.gtaDaily
      ? await gtaDailyComment(s, ep)
      : ep.story_json.challenge
        ? challengeCommentLine(ep.story_json.challenge, await nextEpisodeMade(s.db, ep.story_json.challenge))
        : "";
    if (s.cfg.firstCommentQuestion && script.runtime !== "long" && !script.twin && !script.evergreen_format) {
      // STREAM_ARCHIVE_LINKS: the full stream from this moment, under the Short's own question.
      const archive = s.cfg.levers?.streamArchiveLinks && ep.story_json.streamArchive;
      const q = [shortComment(script), daily, archive ? archiveCommentLine(archive) : ""].filter(Boolean).join("\n\n");
      if (!q) {
        await logEvent(s.db, ep.id, "comment_skipped", { why: "no question of its own" });
        return;
      }
      const id = await s.youtube(accountOf(ep)).insertComment(ep.youtube_video_id!, q);
      await quotaAdd(s.db, s.now(), QUOTA.comment);
      await logEvent(s.db, ep.id, "comment_posted", { id, text: q });
      return;
    }
    const text =
      (script.twin?.pinned ||
        (script.evergreen_format === "documentary" && s.cfg.docPinMoment
          ? docPinnedComment(script, longChapters(ep))
          : s.cfg.firstCommentQuestion
            ? firstComment(script)
            : pinnedComment(script))) +
      (!script.twin && (await hypeOn(s, script))
        ? ` ${HYPE_COMMENT_LINE}`
        : "") +
      (ep.script_json!.runtime === "long"
        ? affiliateCommentLine(ep.script_json!, affiliateTags(s.cfg, ep.id))
        : "") +
      // A Why Short's comment names our long video on the same game, found now in case one came out since.
      (ep.story_json.why && !script.twin
        ? whyPinnedLine(
            await followFor(
              s.db,
              ep.story_json.gameHint || script.game_title,
              s.now(),
            ).catch(() => ep.story_json.why?.follow),
          )
        : "") +
      (daily ? `\n\n${daily}` : "") +
      (s.cfg.levers?.streamArchiveLinks && ep.story_json.streamArchive
        ? `\n\n${archiveCommentLine(ep.story_json.streamArchive)}`
        : "");
    const id = await s
      .youtube(accountOf(ep))
      .insertComment(ep.youtube_video_id!, text);
    await quotaAdd(s.db, s.now(), QUOTA.comment);
    await logEvent(s.db, ep.id, "comment_posted", { id, text });
  } catch (err) {
    log("warn", "pinned comment failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    await logEvent(s.db, ep.id, "comment_failed", { error: errorMessage(err) });
  }
}

/** Uploads the SRT as the video's English caption track. Captions are an enhancement: a failure is logged, never blocks a video that is already live. */
async function addCaptions(s: Services, ep: Episode): Promise<void> {
  const file = path.join(episodeDir(s.cfg, ep.id), ep.assets_json!.srt!);
  try {
    const yt = s.youtube(accountOf(ep));
    if (
      (await yt.listCaptions(ep.youtube_video_id!)).some(
        (c) => c.language === "en" || c.language === "en-GB",
      )
    )
      return;
    const id = await yt.insertCaption(
      ep.youtube_video_id!,
      file,
      "en",
      "English",
    );
    await quotaAdd(s.db, s.now(), QUOTA.captions);
    await logEvent(s.db, ep.id, "captions_uploaded", { id });
  } catch (err) {
    log("warn", "caption upload failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    await logEvent(s.db, ep.id, "captions_failed", {
      error: errorMessage(err),
    });
  }
}

/** The long-form video's custom thumbnail; a refusal (unverified channel) is logged, never fatal. */
/**
 * Hands a long video's Test & compare to the Studio browser task (scheduled task pulse-studio-abtest):
 * data/abtests/pending.json lists the video, its title and the alternatives, and its thumbnails.
 */
/**
 * GTA_GUIDES: the guide thumbnail's design (src/render/ThumbStudio.tsx GuideThumb): the best frame of the owner's own
 * clips in this video (a permitted streamer's when he has none), its subject lifted with APPLE_SUBJECT_LIFT when the
 * Mac can, the 2-3 words the script carries and the official GTA VI logo. Undefined without a usable frame.
 */
async function gtaGuideDesign(
  s: Services,
  dir: string,
  clips: Array<{ file: string; provenance?: string; durationSeconds?: number }>,
  meta: import("./gtaguide.ts").GtaGuideMeta,
): Promise<
  | {
      layout: "guide";
      frame: "own" | "permitted";
      thumb: Record<string, unknown> & { imageFile: string | null; headline: string; fgFile?: string | null; image2File?: string | null };
    }
  | undefined
> {
  // The edition guide shows the official art (the editions' own artwork), never a gameplay frame.
  if (meta.kind === "which-edition") return undefined;
  const frame = await pickGuideFrame(dir, clips, s.cfg.appleSubjectLift ? (f) => appleCut(dir, f) : undefined);
  if (!frame) return undefined;
  const logo = await guideLogo(s.cfg.dataDir, dir);
  return {
    layout: "guide",
    frame: frame.owner,
    thumb: {
      layout: "guide",
      headline: meta.thumb.big,
      kicker: "",
      subline: meta.thumb.small,
      game: "",
      accent: "#FF6B1A",
      imageFile: frame.file,
      fgFile: frame.fg ?? null,
      image2File: logo ?? null,
      ...(frame.x !== undefined ? { subjectX: frame.x } : {}),
    },
  };
}

async function queueAbTest(s: Services, ep: Episode): Promise<void> {
  try {
    const dir = episodeDir(s.cfg, ep.id);
    const file = path.join(s.cfg.dataDir, "abtests", "pending.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const list = JSON.parse(
      await fs.readFile(file, "utf8").catch(() => "[]"),
    ) as Array<{ videoId: string }>;
    if (list.some((x) => x.videoId === ep.youtube_video_id)) return;
    // The main thumbnail first (PACKAGING_LAB=pick may have promoted a variant), then the other designs.
    const thumbs = [ep.assets_json?.thumb ?? "thumb.jpg", ...(ep.assets_json?.thumbVariants ?? [])].map(
      (f) => path.join(dir, f),
    );
    list.push({
      videoId: ep.youtube_video_id!,
      episode: ep.id,
      titles: [
        ep.script_json!.youtube.title,
        ...(ep.script_json!.youtube.title_variants ?? []),
      ],
      thumbs,
      publishAt: ep.publish_at,
      added: s.now().toISOString(),
    } as { videoId: string });
    await fs.writeFile(file, JSON.stringify(list, null, 2), "utf8");
    await logEvent(s.db, ep.id, "abtest_queued", { thumbs: thumbs.length });
  } catch (err) {
    log("warn", "a/b test hand-off failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
  }
}

/**
 * The search tile's thumbnail for a Short on the test's designed side (src/shortthumb.ts). Any trouble leaves the Short
 * on its first frame, and it counts on that side of the test: a thumbnail can never stop a video.
 */
export async function designShortThumb(
  s: Services,
  id: string,
  dir: string,
  script: Script,
  assets: NonNullable<Episode["assets_json"]>,
  heroIndex: number | undefined,
  series?: import("./render/seriesstrip.ts").SeriesCover,
): Promise<void> {
  const share = s.cfg.shortSearchThumbShare;
  if (share <= 0 || !s.renderShortThumb) return;
  assets.shortThumbArm = shortThumbArm(id, share);
  if (assets.shortThumbArm !== "designed") return;
  // PACKAGING_LAB=pick: the best-scoring hook words that pass the clarity check (src/packaging/lab.ts), else the writer's.
  const words = thumbWords(pickHookWords(s.cfg.packaging, s.cfg.dataDir, script));
  const image = pickThumbImage(assets.images, heroIndex);
  if (!words || !image) {
    assets.shortThumbArm = "frame";
    return;
  }
  try {
    await s.renderShortThumb({
      episodeDir: dir,
      outFile: path.join(dir, "thumb_search.jpg"),
      imageFile: image.file,
      words,
      label: script.is_rumour ? "REPORTED" : undefined,
      ...(series ? { series } : {}),
      gl: s.cfg.remotionGl,
      browserExecutable: s.cfg.browserExecutable,
    });
    assets.shortThumb = "thumb_search.jpg";
  } catch (err) {
    assets.shortThumbArm = "frame";
    log("warn", "search thumbnail failed", {
      episode: id,
      error: errorMessage(err),
    });
  }
}

async function setThumbnail(
  s: Services,
  ep: Episode,
  file = ep.assets_json!.thumb!,
): Promise<void> {
  try {
    await s
      .youtube(accountOf(ep))
      .setThumbnail(
        ep.youtube_video_id!,
        path.join(episodeDir(s.cfg, ep.id), file),
      );
    await quotaAdd(s.db, s.now(), QUOTA.comment);
    await logEvent(s.db, ep.id, "thumbnail", { ok: true });
  } catch (err) {
    log("warn", "thumbnail upload failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    await logEvent(s.db, ep.id, "thumbnail", {
      ok: false,
      error: errorMessage(err).slice(0, 300),
    });
  }
}

async function stepConfirm(s: Services, ep: Episode): Promise<void> {
  const st = await s.youtube(accountOf(ep)).status(ep.youtube_video_id!);
  await quotaAdd(s.db, s.now(), QUOTA.poll);
  if (!st) throw new Error("uploaded video not found yet");
  if (st.uploadStatus === "rejected" || st.uploadStatus === "failed") {
    await transition(s.db, ep.id, "uploaded", "failed", {
      youtube_status: st.uploadStatus,
      last_error: st.rejectionReason ?? st.failureReason ?? st.uploadStatus,
    });
    throw new FatalError(
      `YouTube ${st.uploadStatus} the video: ${st.rejectionReason ?? st.failureReason ?? "no reason given"}`,
    );
  }
  if (st.uploadStatus !== "processed") {
    await s.db.query(
      `UPDATE episodes SET youtube_status = $2, next_attempt_at = now() + interval '5 minutes' WHERE id = $1`,
      [ep.id, st.uploadStatus],
    );
    return;
  }
  // Captions go up on long videos only: YouTube captions a Short itself, and the 450 units each
  // upload cost pay for a fifth daily video (the deals Short) instead.
  if (ep.assets_json?.srt && ep.script_json?.runtime === "long")
    await addCaptions(s, ep);
  // YouTube refuses comments on a video that is still private: a scheduled one is commented once it is public.
  if (!ep.publish_at || new Date(ep.publish_at) <= s.now())
    await addPinnedComment(s, ep);
  if (ep.assets_json?.thumb) {
    await setThumbnail(s, ep);
    await queueAbTest(s, ep);
  }
  // The new-look Short's frame 0 as its custom thumbnail (custom Shorts thumbnails opened in July 2026; if
  // the API refuses them for Shorts the refusal is logged and the Short keeps the frame YouTube picks).
  else if (ep.assets_json?.shortThumb && ep.script_json?.runtime !== "long")
    await setThumbnail(s, ep, ep.assets_json.shortThumb);
  await addToSeries(s, ep, st.privacyStatus);
  await transition(s.db, ep.id, "uploaded", "published", {
    youtube_status: st.privacyStatus,
  });
  if (st.privacyStatus === "public") await gameplayLive(s, ep);
  if (st.privacyStatus === "public" && ep.story_json.gtaDaily) await linkGtaDaily(s, ep);
  if (st.privacyStatus === "public" && ep.story_json.challenge) await linkChallengePublic(s, ep);
  // PREMIERE_DOCS: on the premiere list for the browser task, and Discord told (src/premiere.ts).
  if (isPremiereDoc(s.cfg.premiereDocs, ep.factcheck_json) && st.privacyStatus === "private" && ep.youtube_video_id) {
    const entry = addPremiere(
      s.cfg.dataDir,
      {
        episode: ep.id,
        videoId: ep.youtube_video_id,
        title: ep.script_json!.youtube.title,
        at: new Date(ep.publish_at ?? ep.slot_at ?? s.now()),
      },
      s.now(),
    );
    await logEvent(s.db, ep.id, "premiere_pending", { video: entry.videoId, at: entry.at });
    await s.notify({ content: premiereNotice(entry), ping: true });
  }
  const url = `https://youtube.com/shorts/${ep.youtube_video_id}`;
  const longVideo = ep.script_json?.runtime === "long";
  // A documentary's community post and poll (COMMUNITY_DRAFTS, src/social/community.ts): drafted now from
  // its chapters, kept on the episode and put in this notice for the owner to paste; the API cannot post them.
  let community = "";
  if (
    ep.script_json?.evergreen_format === "documentary" &&
    s.cfg.communityDrafts
  ) {
    const drafts = communityDrafts(ep.script_json, ep.youtube_video_id!);
    await s.db.query(
      `UPDATE episodes SET assets_json = COALESCE(assets_json, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [ep.id, JSON.stringify({ community: drafts })],
    );
    await logEvent(s.db, ep.id, "community_drafted", {
      post: drafts.post,
      poll: drafts.poll ?? null,
    });
    community = `\n\n${communityBlock(drafts)}\n\nThe first comment goes up when the video is public; pin it from YouTube Studio (the API cannot pin).`;
  }
  await s.notify({
    content: `✅ ${ep.publish_at && new Date(ep.publish_at) > s.now() ? `Uploaded, goes live ${ukTime(new Date(ep.publish_at), s.now())}` : "Live now"}${longVideo ? " (long video)" : ""}: ${ep.script_json!.youtube.title}\n${longVideo ? `https://youtu.be/${ep.youtube_video_id}` : url}${community}`,
  });
}

/** "19:00 UK" (or "Thu 19:00 UK" when it is not today). */
function ukTime(d: Date, now = new Date()): string {
  const fmt = (o: Intl.DateTimeFormatOptions, x: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      ...o,
    }).format(x);
  const sameDay =
    fmt({ dateStyle: "short" }, d) === fmt({ dateStyle: "short" }, now);
  return `${sameDay ? "" : `${fmt({ weekday: "short" }, d)} `}${fmt({ hour: "2-digit", minute: "2-digit", hour12: false }, d)} UK`;
}

const STEPS: Partial<
  Record<Episode["status"], (s: Services, ep: Episode) => Promise<void>>
> = {
  selected: stepScript,
  scripted: stepVoice,
  voiced: stepRender,
  rendered: stepRequestApproval,
  awaiting_approval: stepAwaitApproval,
  approved: stepApproved,
  uploading: stepUpload,
  uploaded: stepConfirm,
};

/** Runs one step, with whatever it posts filed under this video in the alert ledger. */
export async function advance(s: Services, ep: Episode): Promise<boolean> {
  return withAlertScope(
    {
      episode: ep.id,
      title: ep.script_json?.headline ?? ep.story_json?.headline,
    },
    // The learning core (src/learn/scope.ts): the holdout's baseline settings, and the step's prompts, models, settings
    // and commit stamped on the episode. Off (no LEARN_STAMPS, no LEARN_HOLDOUT_SHARE), the step runs straight through.
    // A slot-bound Short's step caps each Codex run at CODEX_SHORT_TIMEOUT_MINUTES (src/editorial/codex.ts withCodexCap);
    // long videos and evergreen Shorts keep the full CODEX_TIMEOUT_MINUTES.
    // The YouTube guard's order on the signed-in lane (src/lib/ytguard.ts): a Short's own fetches first, then long
    // videos; anything outside an episode's step is background.
    () =>
      withYtPriority(ytPriorityFor(ep), () =>
        withCodexCap(shortCodexCapMs(s.cfg, ep), () =>
          withLearn(s, ep, (run) => advanceStep(run, ep)),
        ),
      ),
  );
}

/**
 * The YouTube priority of an episode's fetches (pure): a slot-bound Short (its lines, named missions and characters)
 * "short"; long videos and evergreen Shorts, made days ahead, "long".
 */
export function ytPriorityFor(ep: Pick<Episode, "lane">): YtPriority {
  return isLongEpisode(ep) || ep.lane === "evergreen" ? "long" : "short";
}

/**
 * The Codex cap for one episode's step (pure): CODEX_SHORT_TIMEOUT_MINUTES for a slot-bound Short, none for a long video
 * or an evergreen Short (made days ahead, and its writer's good runs take up to 18 minutes).
 */
export function shortCodexCapMs(
  cfg: Pick<Config, "codexShortTimeoutMinutes">,
  ep: Pick<Episode, "lane">,
): number | undefined {
  if (isLongEpisode(ep) || ep.lane === "evergreen") return undefined;
  const min = cfg.codexShortTimeoutMinutes;
  return Number.isFinite(min) && min > 0 ? min * 60_000 : undefined;
}

/** True when a failure is about one video's own content (fact check, QA, clarity, spoilers), never the platform. */
export { isContentFault } from "./faultclass.ts";

/** On failure records it and backs off, alerting once it gives up. */
async function advanceStep(s: Services, ep: Episode): Promise<boolean> {
  const step = STEPS[ep.status];
  if (!step) return false;
  try {
    await step(s, ep);
    const after = await getEpisode(s.db, ep.id);
    return Boolean(after && after.status !== ep.status);
  } catch (err) {
    const msg = errorMessage(err);
    const fatal = err instanceof FatalError;
    // An upload is tried again UPLOAD_RETRY_MINUTES apart (launch plan section 4: three tries, ten minutes apart).
    const attempts = await recordFailure(
      s.db,
      ep.id,
      msg,
      ep.status === "uploading"
        ? s.cfg.uploadRetryMinutes
        : Math.min(60, 5 * 2 ** ep.attempts),
    );
    // Then it moves to YouTube's next free slot rather than giving up; a platform's login fault never moves.
    if (
      !fatal &&
      ep.status === "uploading" &&
      attempts >= s.cfg.maxAttempts &&
      (await moveUpload(s, ep, msg).catch(() => false))
    )
      return false;
    log("error", "step failed", {
      id: ep.id,
      status: ep.status,
      attempts,
      fatal,
      error: msg,
      // A code fault carries where it broke (22-23 Nov: "reading 'primary'" lost two news Shorts with no trace).
      ...codeFaultStack(err),
    });
    // Only a platform-wide fault (credentials, quota, policy) justifies pausing new stories;
    // a fatal error inside one episode's own content must not take the whole day with it.
    // 14 Nov 2026: a ranking whose fact check failed twice at "uploading" paused every lane for 12 hours
    // and told the owner YouTube had refused the upload; a fault in the video's own content drops that video only.
    // "refused" alone caught an explainer part the writer refused for missing evidence and paused every lane
    // for 12 hours (6 Nov 2026); only a platform's refusal of our login counts (src/faultclass.ts), read outside
    // the quoted words of the video itself (14 Nov 2026: "quotation" in a fact check matched "quota").
    const platformFault = fatal && pausesEveryLane(msg, ep.status, ep.lane);
    if (platformFault) {
      await pauseSelection(s.db, s.now(), FATAL_PAUSE_HOURS, msg);
      // A pause stops every lane, so it is never silent (6 Nov 2026: a wrong one cost a day's Shorts unseen).
      await s
        .notify({
          level: "info",
          content: `⏸️ New stories are paused for ${FATAL_PAUSE_HOURS} hours after "${(ep.story_json?.headline ?? ep.id).slice(0, 90)}" failed: ${msg.slice(0, 200)}. No Shorts will start until it lapses or the factory is unpaused.`,
        })
        .catch(() => undefined);
    }
    if (fatal || attempts >= s.cfg.maxAttempts) {
      const fresh = await getEpisode(s.db, ep.id);
      if (
        fresh &&
        !["failed", "published", "rejected"].includes(fresh.status)
      ) {
        await transition(s.db, ep.id, fresh.status, "failed", {
          last_error: msg,
        });
      }
      const where =
        (ep.status === "uploading"
          ? "\nThe upload may be incomplete; the next run will search the channel before re-uploading."
          : "") +
        (platformFault
          ? `\nNew stories are paused for ${FATAL_PAUSE_HOURS}h (or until it is fixed and the factory unpaused).`
          : "");
      if (platformFault)
        await s.notify({
          ping: true,
          content: `${platformAlert(msg, ep.status, FATAL_PAUSE_HOURS)}${where}`,
        });
      else
        await s.notify({
          level: "info",
          content: `Gave up on "${ep.script_json?.headline ?? ep.story_json.headline}" at ${ep.status}: ${msg.slice(0, 200)}`,
        });
    }
    return false;
  }
}

const FATAL_PAUSE_HOURS = 12;

/**
 * Three failed upload tries: the Short moves to the channel's next free slot (WHY_SLOTS and NEWS_SLOTS, clear of every
 * other publish by MIN_UPLOAD_GAP_MINUTES) with its tries reset, up to UPLOAD_MOVES times. Skip the slot, not the day.
 */
async function moveUpload(s: Services, ep: Episode, error: string): Promise<boolean> {
  const { db, cfg } = s;
  if (cfg.uploadMoves <= 0) return false;
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM events WHERE episode_id = $1 AND kind = 'upload_moved'`,
    [ep.id],
  );
  if (Number(row?.n ?? 0) >= cfg.uploadMoves) return false;
  const now = s.now();
  const from = ep.publish_at ? new Date(ep.publish_at) : now;
  const after = from > now ? from : now;
  const busy = [
    ...(await takenSlots(db)),
    ...(await publishTimes(db, now, ep.lane === "twin")),
  ].filter((t) => !ep.slot_at || t.getTime() !== new Date(ep.slot_at).getTime());
  const to = nextOpenSlot(
    after,
    [...new Set([...cfg.whySlots, ...cfg.newsSlots])],
    busy,
    cfg.minUploadGapMinutes,
    (d, hhmm) => localTime(d, hhmm, cfg.timezone),
    (d) => dayKey(d, cfg.timezone),
  );
  if (!to) return false;
  // The upload is tried again half an hour before the new slot, scheduled to go public at it.
  const retry = new Date(Math.max(now.getTime() + cfg.uploadRetryMinutes * 60_000, to.getTime() - 30 * 60_000));
  await db.query(
    `UPDATE episodes SET attempts = 0, publish_at = $2, slot_at = $2, next_attempt_at = $3 WHERE id = $1 AND status = 'uploading'`,
    [ep.id, to, retry],
  );
  await logEvent(db, ep.id, "upload_moved", {
    from: from.toISOString(),
    to: to.toISOString(),
    error: error.slice(0, 300),
  });
  await s
    .notify({
      level: "info",
      content: `YouTube refused "${ep.script_json?.youtube.title ?? ep.story_json.headline}" three times (${error.slice(0, 120)}), so it moves to ${slotLabel(to, cfg.timezone)} and tries again then.`,
    })
    .catch(() => undefined);
  return true;
}

export async function pauseSelection(
  db: Db,
  now: Date,
  hours: number,
  reason: string,
): Promise<void> {
  const value = JSON.stringify({
    until: new Date(now.getTime() + hours * 3600_000).toISOString(),
    reason: reason.slice(0, 300),
  });
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('selection_pause', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [value],
  );
}

export async function clearSelectionPause(db: Db): Promise<void> {
  await db.query(`DELETE FROM settings WHERE key = 'selection_pause'`);
}

/** The pause reason while selection is paused, otherwise undefined. */
export async function selectionPause(
  db: Db,
  now: Date,
): Promise<string | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'selection_pause'`,
  );
  if (!row) return undefined;
  try {
    const p = JSON.parse(row.value) as { until: string; reason: string };
    return new Date(p.until).getTime() > now.getTime() ? p.reason : undefined;
  } catch {
    return undefined;
  }
}

/** Deletes media for finished episodes after two weeks so the volume never fills. */
export async function pruneMedia(s: Services, days = 14): Promise<number> {
  const rows = await s.db.query<{ id: string }>(
    `SELECT id FROM episodes WHERE status IN ('published','rejected','failed') AND updated_at < now() - make_interval(days => $1)`,
    [days],
  );
  let n = 0;
  for (const { id } of rows) {
    const dir = episodeDir(s.cfg, id);
    try {
      await fs.access(dir);
    } catch {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
    n++;
  }
  return n;
}

/** Long videos (rankings, documentaries, recaps, remakes): made in their own lane (tickLong), never in the Shorts tick. */
export function isLongEpisode(ep: Pick<Episode, "lane">): boolean {
  return ep.lane === "longform";
}

/**
 * Pushes one episode as far as it can go (script → upload); it stops on its own at a wait (approval,
 * processing, a slot, a quota reset) or a failure.
 */
async function pushEpisode(s: Services, ep: Episode): Promise<void> {
  let current: Episode | undefined = ep;
  for (let i = 0; i < 10 && current; i++) {
    const moved = await advance(s, current);
    if (!moved) break;
    current = await getEpisode(s.db, ep.id);
    if (current?.next_attempt_at && new Date(current.next_attempt_at) > s.now())
      break;
  }
}

/**
 * The long-form lane. A long video takes hours to gather and render, and inside the Shorts tick it once held
 * every Short back (28 Oct 2026: a documentary remake from 15:31 cost the 17:00 and 18:30 slots). It has its
 * own lease, so one long video is worked on at a time and the Shorts tick never waits for it; a crashed holder
 * is cleared at boot with the other leases. Selection stays in the Shorts tick.
 */
export async function tickLong(
  s: Services,
): Promise<{ ran: boolean; episodes?: string[] }> {
  const result = await withLease(s.db, LONG_LEASE, LONG_LEASE_TTL_S, async (lease) => {
    // One step at a time, the lane re-ordered after each (src/longlane.ts): the nearest slot first, and an
    // unscripted video due within hours ahead of everything, so another's gather or render never queues it
    // (30 Oct 2026: the recap for 20:00 sat behind the Halo ranking's gather and missed its slot). An episode
    // that did not move (a wait, a failure) rests for the remainder of this pass; the pass ends when nothing
    // is left to do or the lease is gone (the lane watchdog released it).
    const worked: string[] = [];
    const resting = new Set<string>();
    for (let guard = 0; guard < 60; guard++) {
      if (!(await lease.held())) {
        log("warn", "long tick stopping: its lease was released", { worked });
        break;
      }
      const due = orderLongEpisodes(
        (await dueEpisodes(s.db, s.now())).filter(isLongEpisode),
        s.now(),
      ).filter((e) => !resting.has(e.id));
      const ep = due[0];
      if (!ep) break;
      if (!worked.includes(ep.id)) worked.push(ep.id);
      const moved = await advance(s, ep);
      const after = await getEpisode(s.db, ep.id);
      if (
        !moved ||
        !after ||
        (after.next_attempt_at && new Date(after.next_attempt_at) > s.now())
      )
        resting.add(ep.id);
    }
    return { episodes: worked };
  });
  return result ? { ran: true, ...result } : { ran: false };
}

export async function tick(
  s: Services,
): Promise<{ ran: boolean; selected?: string }> {
  // Shorts only: long videos advance in tickLong. A crashed holder is cleared at boot.
  const result = await withLease(s.db, "tick", 180 * 60, async () => {
    let selected: string | undefined;
    try {
      await discoverTick(s);
      selected = await maybeSelect(s);
    } catch (err) {
      log("error", "selection failed", { error: errorMessage(err) });
      if (err instanceof FatalError)
        await s.notify({
          level: "info",
          content: `Story selection failed once: ${errorMessage(err)}`,
        });
    }
    await fillSpareGaps(s).catch((err) =>
      log("warn", "spare gap fill failed", { error: errorMessage(err) }),
    );
    if (s.cfg.premakeRefresh)
      await settlePremakeRefreshes(s).catch((err) =>
        log("warn", "pre-made remake check failed", { error: errorMessage(err) }),
      );
    if (s.cfg.shortFootageWait)
      await retryFootageHolds(s).catch((err) =>
        log("warn", "footage hold retry failed", { error: errorMessage(err) }),
      );
    await docUploadLate(s).catch((err) =>
      log("warn", "documentary deadline check failed", { error: errorMessage(err) }),
    );
    // A long video selected above is left to its own lane.
    for (const ep of await dueEpisodes(s.db, s.now()))
      if (!isLongEpisode(ep)) await pushEpisode(s, ep);
    // The owner's recordings: new clips heard and looked at, picked ones started on (they ride the same tick next time).
    await ingestGameplay(s).catch((err) =>
      log("warn", "gameplay intake failed", { error: errorMessage(err) }),
    );
    // The twin channel: every Short that went public gets its translated twin.
    await maybeSelectTwin(s).catch((err) =>
      log("warn", "twin selection failed", { error: errorMessage(err) }),
    );
    await syncGameplaySkips(s).catch((err) =>
      log("warn", "gameplay status sync failed", { error: errorMessage(err) }),
    );
    await pruneMedia(s, s.cfg.mediaKeepDays).catch((err) =>
      log("warn", "prune failed", { error: errorMessage(err) }),
    );
    // Sooner, oldest first, when the disk runs low (the Mac's 256 GB SSD; src/retention.ts).
    await pruneForSpace(s, (id) => episodeDir(s.cfg, id)).catch((err) =>
      log("warn", "space prune failed", { error: errorMessage(err) }),
    );
    // Records of comments we judged are kept 90 days (the privacy notice says so), then deleted.
    await pruneCommentRecords(s.db, s.now()).catch((err) =>
      log("warn", "comment record prune failed", { error: errorMessage(err) }),
    );
    // Public numbers for every published Short at fixed ages (one unit per fifty videos).
    if (!s.cfg.dryRun)
      await captureMetrics(s.db, s.youtube(), s.now()).catch((err) =>
        log("warn", "metrics capture failed", { error: errorMessage(err) }),
      );
    // The twin channel's numbers, with its own login.
    if (!s.cfg.dryRun && (await twinReady(s)))
      await captureMetrics(
        s.db,
        s.youtube(s.cfg.twinLanguage),
        s.now(),
        s.cfg.twinLanguage,
      ).catch((err) =>
        log("warn", "twin metrics capture failed", {
          error: errorMessage(err),
        }),
      );
    // After each scheduled slot: confirm the video went public and post its first comment, or tell the owner it did not.
    if (!s.cfg.dryRun && s.cfg.youtubePrivacy === "public")
      await confirmPublished(s).catch((err) =>
        log("warn", "publish check failed", { error: errorMessage(err) }),
      );
    // How much of each Short people watched, once Analytics has the numbers (needs the analytics scope).
    if (!s.cfg.dryRun)
      await captureRetention(s.db, s.youtube(), s.now()).catch((err) =>
        log("warn", "retention capture failed", { error: errorMessage(err) }),
      );
    if (!s.cfg.dryRun && (await twinReady(s)))
      await captureRetention(
        s.db,
        s.youtube(s.cfg.twinLanguage),
        s.now(),
        s.cfg.twinLanguage,
      ).catch((err) =>
        log("warn", "twin retention capture failed", {
          error: errorMessage(err),
        }),
      );
    // A Short taking off: checked every 20 minutes in its first two days; the editors lean into its game.
    if (
      !s.cfg.dryRun &&
      !(await weeklyTried(
        s.db,
        `hits:${Math.floor(s.now().getTime() / 1_200_000)}`,
      ))
    )
      await watchHits({
        db: s.db,
        cfg: s.cfg,
        now: s.now,
        stats: (ids) => s.youtube().stats(ids),
        notify: (m) => s.notify(m),
      }).catch((err) =>
        log("warn", "take-off check failed", { error: errorMessage(err) }),
      );
    // Older videos: titles and descriptions in the other languages, one every half hour from spare quota.
    if (!s.cfg.dryRun)
      await localizeBackfill(s).catch((err) =>
        log("warn", "localisation backfill failed", {
          error: errorMessage(err),
        }),
      );
    // Long videos: the whole retention curve a week after going live, for the long-form writer's lessons.
    if (!s.cfg.dryRun)
      await captureCurves(s.db, s.youtube(), s.now()).catch((err) =>
        log("warn", "retention curve capture failed", {
          error: errorMessage(err),
        }),
      );
    // RETENTION_LEARN (src/retentionlearn.ts): every video's curve again at 48 hours, for the drop-cause lessons.
    if (!s.cfg.dryRun && s.cfg.retentionLearn)
      await retentionLearnTick({
        db: s.db,
        now: s.now(),
        yt: s.youtube(),
        storedToken: async () =>
          (await storedRefreshToken(s.db, learnOauth(s.cfg)))
            ? accessToken(s.db, learnOauth(s.cfg))
            : undefined,
      }).catch((err) =>
        log("warn", "48-hour retention curves failed", {
          error: errorMessage(err),
        }),
      );
    // RETENTION_DIRECTOR (src/retentionstep.ts): the retention model retrained weekly from the stored curves.
    if (!s.cfg.dryRun && s.cfg.retentionDirector !== "off")
      await retrainTick({ db: s.db, cfg: s.cfg, now: s.now, segmentsOf: segmentInputs, notify: (m) => s.notify(m) });
    // The experiments' verdicts: once on EXPERIMENT_VERDICT_DATE, then weekly while the desk test is undecided.
    if (!s.cfg.dryRun)
      await experimentVerdicts(s.db, s.cfg, s.now(), (m) => s.notify(m)).catch(
        (err) =>
          log("warn", "experiment verdicts failed", {
            error: errorMessage(err),
          }),
      );
    // The posting-time test's report on its last day (src/experiments.ts). The other platforms' numbers are read on their own clock (server.ts).
    if (!s.cfg.dryRun)
      await primeTimeVerdict(s.db, s.cfg, s.now(), (m) => s.notify(m)).catch(
        (err) =>
          log("warn", "posting-time report failed", {
            error: errorMessage(err),
          }),
      );
    // The weekly retention test on news Shorts (src/growth.ts): judged a week after it starts, then weekly until called.
    if (!s.cfg.dryRun)
      await growthVerdict(s.db, s.cfg, s.now(), (m) => s.notify(m)).catch(
        (err) =>
          log("warn", "growth test verdict failed", {
            error: errorMessage(err),
          }),
      );
    // The weekly long video's shape test (src/weeklytest.ts): each finished week, then the verdict.
    if (!s.cfg.dryRun)
      await weeklyVerdict(s.db, s.cfg, s.now(), (m) => s.notify(m)).catch(
        (err) =>
          log("warn", "weekly shape verdict failed", {
            error: errorMessage(err),
          }),
      );
    // Shorts: whether the Shorts feed served each one, and a warning when it stops (read-only).
    if (!s.cfg.dryRun) {
      await captureReach(s.db, s.youtube(), s.now()).catch((err) =>
        log("warn", "reach capture failed", { error: errorMessage(err) }),
      );
      await reachAlert(s.db, s.now(), (m) => s.notify(m)).catch((err) =>
        log("warn", "reach alert failed", { error: errorMessage(err) }),
      );
      // PACKAGING_LAB=retitle: one second chance for an under-performing public video, and the verdicts on earlier ones.
      if (packagingAtLeast(s.cfg.packaging, "retitle"))
        await runSecondChance({
          cfg: s.cfg,
          db: s.db,
          now: () => s.now(),
          youtube: (ep) => s.youtube(accountOf(ep)),
          notify: (m) => s.notify(m),
        }).catch((err) => log("warn", "packaging second chance failed", { error: errorMessage(err) }));
      // Click-through per video, once a day (src/reach.ts).
      if (s.cfg.reachReport && s.reachClient && (await ctrCaptureDue(s.db, s.now()))) {
        await logEvent(s.db, null, "reach_report_tick", {});
        await captureCtr(
          s.db,
          s.reachClient(),
          s.now(),
        );
      }
    }
    // The learning core (src/learn/tick.ts): the change ledger, the holdout's pin and the weekly learning jobs.
    await learnTick(s).catch((err) =>
      log("warn", "learning core tick failed", { error: errorMessage(err) }),
    );
    return { selected };
  });
  return result ? { ran: true, ...result } : { ran: false };
}
