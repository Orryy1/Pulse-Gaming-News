// Every runtime knob lives here and is read from the environment once.
// Nothing secret is ever logged; see redactedConfig().

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCameraSetting, type CameraTechnique } from "./render/camera.ts";
import { newsSlotsFor, parseHomeShelf, rumourShareFrom } from "./series.ts";
import { macVisionMode } from "./assets/macvision.ts";
import type { SoundCraft } from "./render/soundfx.ts";
import {
  defaultBackupDir,
  defaultCodexPython,
  defaultCodexRunnerDir,
  relocatedFile,
  usablePath,
} from "./platform.ts";
import {
  parseBand,
  parseShortLengths,
  shortLengthsSummary,
  type LengthBand,
  type ShortLengths,
} from "./shortlengths.ts";
import { streamAsksSettings, streamAsksSummary, type StreamAsksSettings } from "./streamasks/settings.ts";
import { liveClipsSettings, liveClipsSummary, type LiveClipsSettings } from "./liveclips/settings.ts";
import { gtaFileSummary } from "./gtafile.ts";
import { parseHomeFranchises } from "./editorial/why.ts";

// Local installs keep settings in factory/.env (never committed).
const ENV_FILE = path.resolve(process.env.PULSE_ENV_FILE ?? ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

/** GRAPHICS_AUDIT: off, measure and log only, or measure, fix and fail on a wrong graphic (src/qa/gfxaudit.ts). */
export type GraphicsAuditMode = "off" | "report" | "fix";

export function graphicsAuditMode(raw: string | undefined): GraphicsAuditMode {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "fix" || v === "true" || v === "on" || v === "1") return "fix";
  if (v === "report" || v === "log") return "report";
  return "off";
}

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n))
    throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

/** "HH:MM" times from a comma list, sorted, invalid ones dropped. */
export function slotList(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^\d\d:\d\d$/.test(t))
    .sort();
}

/** The Why slots: WHY_SLOTS when set, else a single WHY_SLOT, else the two-a-day default. */
export function whySlotsFrom(list: string, single: string): string[] {
  const many = slotList(list);
  if (many.length) return [...new Set(many)];
  const one = slotList(single);
  return one.length ? one : ["12:00", "18:30"];
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

/** The writers the friend pass runs for (src/editorial/friendpass.ts). */
export type FriendPassFormat = "shorts" | "documentary";
export const FRIEND_PASS_FORMATS: FriendPassFormat[] = ["shorts", "documentary"];

/**
 * FRIEND_PASS as a list (pure): unset means the default, Shorts and documentary chapters; "off", "none", "0" or
 * "false" means none; "on", "all", "1" or "true" means both; otherwise the named formats ("shorts,documentary").
 */
export function friendPassFrom(raw: string | undefined): FriendPassFormat[] {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return [...FRIEND_PASS_FORMATS];
  if (["off", "none", "0", "false", "no"].includes(v)) return [];
  if (["on", "all", "1", "true", "yes"].includes(v)) return [...FRIEND_PASS_FORMATS];
  const named = v
    .split(/[\s,]+/)
    .map((x) => (x === "short" ? "shorts" : ["doc", "docs", "documentaries"].includes(x) ? "documentary" : x));
  return FRIEND_PASS_FORMATS.filter((f) => named.includes(f));
}

/** ROUTINE_FILES_TO: "mac" or "pc" as set; otherwise the factory on a Mac serves the PC's browser, elsewhere the Mac's. */
export function routineFilesTo(raw: string, platform: string): "mac" | "pc" {
  const v = raw.trim().toLowerCase();
  if (v === "mac" || v === "pc") return v;
  return platform === "darwin" ? "pc" : "mac";
}

/** VOICE_TAGS on its own: the writers' prompts are built when their modules load, before any Config exists. */
export function voiceTagsSetting(): boolean {
  return bool("VOICE_TAGS", true);
}

export type ApprovalMode = "manual" | "timeout" | "auto";
export type PrivacyStatus = "public" | "unlisted" | "private";
// local: the Codex Liam clone only. elevenlabs: ElevenLabs only. auto: local first,
// ElevenLabs if the local server is down and the plan has credits for the script.
// elevenlabs-first: spend the credits already paid for on the real ElevenLabs voice
// while the month's balance covers the script, never beyond it, then the local clone.
export type VoiceProvider =
  "local" | "elevenlabs" | "auto" | "elevenlabs-first";
export const VOICE_PROVIDERS: VoiceProvider[] = [
  "local",
  "elevenlabs",
  "auto",
  "elevenlabs-first",
];
// Chromium GL backend for Remotion. "angle" uses the GPU (5x faster on the
// production PC, pixel-identical output); "swangle" is the software fallback.
export type RemotionGl =
  "swangle" | "angle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";
const REMOTION_GLS: RemotionGl[] = [
  "swangle",
  "angle",
  "egl",
  "swiftshader",
  "vulkan",
  "angle-egl",
];

export interface Config {
  port: number;
  publicUrl: string;
  siteUrl: string; // the website's own domain once it is live (SITE_URL); empty: the public URL
  dataDir: string;
  databaseUrl: string;
  appSecret: string;
  adminToken: string;

  anthropicModel: string;
  claudeModelMid: string; // picking footage, posts, story selection
  claudeModelLow: string; // simple filtering
  /** Codex (the owner's ChatGPT plan) answers the listed steps instead of Claude (src/editorial/codex.ts). */
  codexLlm: boolean;
  /** The steps routed: "doc.chapter", a family "doc", or "*". Empty: nothing, even with CODEX_LLM on. */
  codexCalls: string[];
  /** Listed steps that carry images (vision checks) go to Codex too; off until each check has its side-by-side. */
  codexVision: boolean;
  /**
   * VISION_PAID_FALLBACK: while the PC vision relay is down, picture checks may go to the paid Claude API. Off by
   * default (owner's rule after the 7-11 Nov 2026 outage): they go to Codex where CODEX_VISION allows, or are skipped.
   */
  visionPaidFallback: boolean;
  /** A Codex run is killed after this many minutes and Claude answers instead. */
  codexTimeoutMinutes: number;
  /** The Python that can import the orchestrator's codex_runner, and where that file lives. */
  codexPython: string;
  codexRunnerDir: string;
  voiceProvider: VoiceProvider;
  localTtsUrl: string;
  localVoiceId: string;
  localSpeakingRate: number;
  localTtsStart: string;
  syntheticMedia: boolean;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;
  voicePool: Array<{ id: string; name: string }>; // ElevenLabs voices rotated across Shorts; empty = always elevenLabsVoiceId
  voiceRotation: number; // Shorts per voice before moving to the next

  discordWebhookUrl: string;

  discordTiktokWebhookUrl: string; // #tiktok-posts: the TikTok draft links on their own
  healthcheckPingUrl: string;

  legacyTokenDir: string;
  googleClientId: string;
  googleClientSecret: string;
  youtubeRefreshToken: string;
  youtubePrivacy: PrivacyStatus;
  youtubeVetoMinutes: number;

  dailyTarget: number; // Shorts per day across all lanes
  timezone: string; // the owner's day and slot clock
  newsSlots: string[]; // "HH:MM" local publish slots for the news lane
  slotLeadMinutes: number; // start producing this long before a slot
  slotGraceMinutes: number; // a slot missed by less than this is still filled
  maxProducing: number; // episodes allowed mid-production at once (waiting ones never block)
  minUploadGapMinutes: number;
  discoverMinutes: number;
  breakingEnabled: boolean;
  breakingPerDay: number;
  breakingScoreMin: number;
  breakingMaxAgeMinutes: number;
  breakingCooldownHours: number;
  breakingApprovalMinutes: number;
  breakingWindow: string; // local "HH:MM-HH:MM"
  sprintExtra: number; // extra breaking Shorts allowed on a showcase day
  sprintScoreMin: number; // the breaking score bar for a showcase story
  quotaUnitsPerDay: number;
  /** videos.insert calls a day (its own bucket; check the project's Cloud Console for the real limit). */
  uploadCallsPerDay: number;
  /** search.list calls a day (its own bucket). */
  searchCallsPerDay: number;
  evergreenEnabled: boolean;
  evergreenDays: string[]; // local weekdays, e.g. tue,thu,sat
  evergreenSlot: string; // local "HH:MM"
  focusTopic: string; // a franchise the editors favour for a while (e.g. a huge launch), empty = none
  focusUntil: string; // ISO date the focus ends
  focusNote: string; // one line on why, for the editors
  /** Search questions with weak answers on YouTube (search_gaps.md), shown to the topic pickers; empty = none. */
  searchGapsFile: string;
  calendarFile: string; // dated angles the editors see as "planned for today" (src/calendar.ts); empty = none
  /** The desk experiment: a second presenter asks the viewer's question before the take, on a share of news Shorts. */
  deskVoiceId: string; // ElevenLabs voice of the desk partner; empty = off
  deskVoiceName: string;
  deskShare: number; // 0-1: the share of eligible Shorts that get the desk question
  /** The narrator test: a share of news Shorts narrated by another ElevenLabs voice. */
  narratorTestVoiceId: string; // empty = off
  narratorTestVoiceName: string;
  narratorTestShare: number;
  /** The new-look test: a share of Shorts get the editor's dressing (cut accents, punch-ins, period looks). */
  shortSuiteShare: number;
  /** Pip the mascot: a share of Shorts carry the code-drawn amber mascot (src/render/components/Pip.tsx). */
  mascotShare: number;
  /** The UK day the factory first judges its experiments (src/experiments.ts), as YYYY-MM-DD. */
  experimentVerdictDate: string;
  /** The weekly retention tests on news Shorts (src/growth.ts): one thing at a time, judged by the factory. */
  growthTests: boolean;
  /** News-lane Shorts a day (scheduled and breaking) before the remaining slots are held back; 0 = no cap (src/cadence.ts). */
  shortsPerDayMax: number;
  /** The share of a Short's narration that should have its own picture, clip or card (0-1); under it, a note (src/qa/mediarich.ts). */
  shortMediaRichTarget: number;
  narratorName: string; // the usual narrator's name, for the Discord card and the lessons
  focusMatch: string; // regex (case-insensitive) a story about the focus matches, e.g. "grand theft auto|\\bgta\\b"
  focusPlaylist: string; // a playlist every focus video joins while the focus runs, empty = none
  waveFrom: string; // ISO date a launch wave starts: extra Shorts on the focus, like a showcase sprint
  waveTo: string; // ISO date it ends (inclusive)
  whyEnabled: boolean; // the daily "Why" Short
  whyDays: string[];
  whySlot: string; // local "HH:MM": the first of whySlots, kept for older callers
  /** The day's "Why" slots, local "HH:MM" (WHY_SLOTS, else WHY_SLOT); src/storymix.ts. */
  whySlots: string[];
  /** Days a Why Short's game, topic and opening shape stay off limits for the next one (src/editorial/why.ts). */
  whyFreshDays: number;
  /** The Why as a numbered serial (src/editorial/why.ts, format redesign plan item 3): numbered, longer, home shelf (WHY_SERIAL_ENABLED). */
  whySerialEnabled: boolean;
  /** The serial Why's seconds (WHY_TARGET_SECONDS, "45-60"); applies only with WHY_SERIAL_ENABLED; undefined = unusable. */
  whyTargetSeconds: LengthBand | undefined;
  /** Share of Why slots, 0-1, that pick only from the home shelf (WHY_HOME_SHARE; serial only); 0 = off. */
  whyHomeShare: number;
  /** The home shelf's franchises (WHY_HOME_FRANCHISES, "|" between them; names from HOME_SHELF). */
  whyHomeFranchises: string[];
  /** The GTA File (src/gtafile.ts, plan item 4): the numbered daily GTA VI serial after launch (SERIES_GTA_FILE_ENABLED). */
  seriesGtaFileEnabled: boolean;
  /** Its slot, local "HH:MM": one of WHY_SLOTS, so no slot is added (SERIES_GTA_FILE_SLOT). */
  seriesGtaFileSlot: string;
  /** Its planned parts, a src/shortrun.ts file of "file" entries (SERIES_GTA_FILE_RUN_FILE). */
  seriesGtaFileRunFile: string;
  /** A target length per Short format (src/shortlengths.ts), from SHORT_LENGTHS, e.g. "news=22-35,why=22-35,gta_file=45-55"; empty = the old 25-40 s for every Short. */
  shortLengths: ShortLengths;
  /** Instagram skips a Short longer than this many seconds (INSTAGRAM_MAX_SECONDS); 0 = no limit. */
  instagramMaxSeconds: number;
  /** A breaking Short past BREAKING_PER_DAY is allowed once more only at or above this score; 0 = never (src/storymix.ts). */
  breakingBigScore: number;
  /** Big stories (src/bigstories.ts): off, report (say what it would do, change nothing) or make. */
  bigStoryMode: "off" | "report" | "make";
  /** Size at which a story is big: never held by the cap, the breaking allowance or the day's count. */
  bigStorySize: number;
  /** Size past which a story ignores the day's ceiling and the same-game rule, and the editor cannot pass on it. */
  bigStoryHuge: number;
  /** How long after its newest article a big story can still be made, angled on what has happened since. */
  bigStoryMaxAgeHours: number;
  /** Most big-story Shorts a day below BIG_STORY_HUGE, a ceiling on the cost. */
  bigStoryPerDay: number;
  /** Filler that gives way, one lane for each big story made today, in this order. */
  bigStoryBumps: string[];
  /** Hours after a dropped big story before one more go, which also needs an article the first go did not have. */
  bigStoryRetryHours: number;
  /** The day's count (SHORTS_PER_DAY) counts Shorts only: a long video does not use up a slot's turn. */
  dailyTargetShortsOnly: boolean;
  /** The launch calendar: reviews and launch days of known huge games (src/discovery/launches.ts); empty = none. */
  launchCalendarFile: string;
  /** Free chatter sources read for the story size (src/discovery/chatter.ts): bluesky, trends, youtube; empty = none. */
  chatterSources: string[];
  /** The Claude credit a month in dollars (src/claudecredit.ts); 0 turns the forecast off. */
  claudeMonthlyCredit: number;
  /** The day of the month the credit renews. */
  claudeCreditRenewDay: number;
  /** First warning when the credit would run out in under this many days. */
  claudeCreditWarnDays: number;
  /** The YouTube search demand check before evergreen, ranking and Why picks (src/discovery/searchdemand.ts). */
  demandCheck: boolean;
  /** Views on a topic's top recent YouTube hits (last week) below which it has no demand and is skipped. */
  demandMinViews: number;
  /** Search pages fetched per pick at most; the rest wait for the cache (24 h). */
  demandLookups: number;
  /** A title or hook phrase in this many of the last 30 days' Shorts already is sent back for a rewrite; 0 = off (src/authenticity.ts). */
  repeatMax: number;
  spareUploads: boolean; // spend the quota left before YouTube's daily reset on extra scheduled Shorts
  spareSlots: string[]; // local "HH:MM" publish times for those Shorts, the first free one is used
  evergreenApprovalMode: ApprovalMode;
  evergreenApprovalMinutes: number;
  evergreenMaxSeconds: number; // narration cap for the lane
  longformEnabled: boolean; // weekly 16:9 ranking video
  cutdownsEnabled: boolean; // Shorts cut from each long ranking
  cutdownSlot: string; // local publish time for them, one a day
  cutdownsPerLong: number;
  /** The Mac mini's jobs (src/macworker.ts), each off by default and each falling back to the PC. */
  macWorkerHost: string; // the ssh alias
  macMinFreeGb: number; // free disk the Mac always keeps (the orchestrator's floor)
  macWaitMinutes: number; // how long a job waits for the Mac's heavy turn before the PC does it
  macRenderConcurrency: number;
  macAsr: boolean; // narration word timings
  macRenderShorts: boolean; // Shorts, their poster and thumbnail
  macFootageGather: boolean; // the footage-first gather, all but the vision looks
  macStills: boolean; // long videos' thumbnails
  macGameplay: boolean; // the highlight finder and TinoTV VOD download (retire the PC tasks first)
  /** MAC_VISION (Mac mini only, off until switched on): picture checks on the Mac's own vision model
   * (mac/vision_server.py); "fallback" while the PC relay is down, "always" for every check (src/assets/macvision.ts). */
  macVision: "off" | "fallback" | "always";
  /** APPLE_AESTHETICS (Mac mini only, off until switched on): Apple Vision's aesthetics score ranks candidate frames for
   * Short covers, thumbnails and first frames (src/assets/appleaesthetics.ts). */
  appleAesthetics: boolean;
  /** APPLE_SOUND_TAGS (Mac mini only, off until switched on): Apple Sound Analysis tags game audio (explosions,
   * gunfire, laughter, speech...) for the highlight finder and flags spoken lines (src/assets/applesound.ts). */
  appleSoundTags: boolean;
  /** The Mac addresses allowed the /routine pages over the LAN, on routineLanPort; empty: loopback only, as ever. */
  routineLanAllow: string[];
  routineLanPort: number;
  /**
   * Where a LAN routine's files (thumbnails, community pictures) must be for the browser that asked: "mac" copies
   * them over ssh (the factory on the PC, the Mac's Brave), "pc" lists them for the PC's puller (the factory on the
   * Mac, the PC's Brave; windows/pull-routine-files.mjs). ROUTINE_FILES_TO; empty picks by this machine.
   */
  routineFilesTo: "mac" | "pc";
  /** The PC folder the puller fills, as the PC's browser sees it (ROUTINE_PC_DIR). */
  routinePcDir: string;
  /** The owner's own recordings, cut into an inbox by the Windows tasks in C:\Claude	inotv-vods. */
  elevenLabsLowCredits: number; // warn the owner under this many usable credits (ELEVENLABS_LOW_CREDITS, 0 off)
  elevenLabsLowDays: number; // and under this many days of the current pace (ELEVENLABS_LOW_DAYS, 0 off)
  gameplayEnabled: boolean;
  gameplayRoot: string; // holds inbox/ (written by the finder) and published/ (read by Leonida Intel)
  gameplayExperiments: string; // the numbered test list the reviewer matches clips against
  gameplaySlots: string[]; // local publish times, at most one gameplay Short each
  gameplayReviewsPerDay: number; // clips heard and looked at a day (each costs a vision call)
  gameplayMinScore: number; // the reviewer's 1-10 score a clip needs to reach the owner
  gameplayMinScoreOwn: number; // the same bar for a clip the owner saved on Xbox on purpose (GAMEPLAY_MIN_SCORE_OWN, defaults to the above)
  gameplayApprovalHours: number; // an unanswered gameplay Short expires after this; under the links' 72 hours
  keepFreeWindows: string; // whole stretches the PC is kept free: "lane|from|until;...", ISO times (pcschedule.ts)
  gameplayRemindHours: number; // one reminder with fresh links this long after the notice; 0 = none
  gameplayDirect: boolean; // GAMEPLAY_DIRECT: the rebuilt Short (src/gameplaydirect.ts): full screen, starts on the action, voice, payoff, loop; one more vision call a kept clip
  gameplayOneTap: boolean; // GAMEPLAY_ONE_TAP: the card's Approve and Reject act on the tap, with no confirmation page (src/server.ts)
  gameplayRehearsalUntil: string; // local YYYY-MM-DD: clips reviewed up to this date reach Discord and never publish; empty = off
  shortRunFile: string; // the launch run (src/shortrun.ts): topics planned by date and slot; empty = none
  /** EVERYGAME_ENABLED: "The Story of Every [series] Game" (src/everygame.ts), a Short and a long video per planned series. Off by default. */
  everyGameEnabled: boolean;
  /** EVERYGAME_FILE: the plan of series, dates and slots; empty = everygame.json beside package.json. Each entry has its own "on". */
  everyGameFile: string;
  /** RUN_PREMAKE_HOURS: a planned Why is made this long before its slot and held (src/shortrun.ts); 0 = only entries with their own make time. */
  runPremakeHours: number;
  /** RUN_PREMAKE_UPLOAD_HOURS: a pre-made Short is uploaded (scheduled on YouTube) this long before its slot, no earlier. */
  runPremakeUploadHours: number;
  /** RUN_SPARE_SLOTS: local "HH:MM" slots a ready spare from the run fills when nothing else has taken them. */
  runSpareSlots: string[];
  /** RUN_SPARE_MINUTES: a slot still empty this close to its time is given to a ready spare. */
  runSpareMinutes: number;
  /** UPLOAD_RETRY_MINUTES: a failed upload (YouTube or a cross-post) is tried again this long after, up to three tries. */
  uploadRetryMinutes: number;
  /** UPLOAD_MOVES: after three failed tries an upload moves to that platform's next free slot this many times, then gives up. */
  uploadMoves: number;
  /** BREAKING_BUMP_SCORE: an overnight breaking Short this big moves the morning's first planned Short to the next open slot; 0 = off. */
  breakingBumpScore: number;
  /** VISION_HOLD: with the PC picture checker down, a Short with unchecked third-party pictures waits for it. */
  visionHold: boolean;
  /** LEONIDA_LINK: GTA VI videos name the Leonida Intel page for the day in their description (src/launchprep.ts). */
  leonidaLink: boolean;
  /** RUN_DOC_PRIVATE_HOURS: a planned documentary should be uploaded (private, scheduled) this long before its slot; the owner hears if not. */
  runDocPrivateHours: number;
  longStockNotOnPeople: boolean; // no stock shot on a chapter card or a line naming a real person; on by default
  codeScenes: boolean; // src/render/codescene.ts: drawn scenes from a line's sourced data, over a plate or a repeated still, never over footage
  shortPlateMax: number; // 0-1, the share of a Short that may sit on the bare plate before more media is fetched and, failing that, it is stopped
  shortPlateMaxBig: number; // the same line for one of the day's big stories, which have no better story to give the slot to (SHORT_PLATE_MAX_BIG)
  shortPlateFirstSeconds: number; // no bare plate in this many opening seconds of a Short; 0 = off (SHORT_PLATE_FIRST_SECONDS)
  shortFootageFirst: boolean; // footage before stills on Shorts: src/render/plan.ts footageFirst, the fill in src/assets/clipscore.ts (SHORT_FOOTAGE_FIRST)
  shortFootageShare: number; // percent of a Short's narration the gather tries to cover with moving footage, within the publisher's cap (SHORT_FOOTAGE_SHARE)
  shortClipTextCheck: boolean; // read each Short clip with the local OCR and cut away big burned-in trailer text (SHORT_CLIP_TEXT_CHECK)
  shortStakeFirst: boolean; // the hook carries a stake for the viewer (SHORT_STAKE_FIRST, src/editorial/shortrules.ts)
  shortRefuseThin: boolean; // a script that admits it has nothing goes back, then the story is dropped, big stories excepted (SHORT_REFUSE_THIN)
  sourceMinChars: number; // a news Short whose richest source says fewer characters than this is dropped before writing; 0 = off (SOURCE_MIN_CHARS)
  shortEndPayoff: boolean; // the last line is a payoff or runs back into the hook, not a question or "next Why tomorrow" (SHORT_END_PAYOFF)
  shortTightScript: boolean; // fewer full stops and plainer words for a quicker read (SHORT_TIGHT_SCRIPT, off)
  shortArgumentShare: number; // 0-1, the share of news and Why Shorts written as one argument with no labelled take (SHORT_ARGUMENT_SHARE)
  shortMinWpm: number; // speed a Short's voice up to this many words a minute, 25% at most; 0 = as recorded. The owner's ear decides (SHORT_MIN_WPM, off)
  shortCappedStills: number; // the ceiling on trailer frames as stills for a tight-cap publisher (Rockstar), used only to fill what published art leaves blank; 0 = none (SHORT_CAPPED_STILLS)
  shortMediaBeforeVoice: boolean; // gather a Short's media before the voice, and refuse one that cannot be pictured before credit is spent (SHORT_MEDIA_BEFORE_VOICE)
  shortGatherMaxMinutes: number; // a Short's whole gather stops starting entries after this; past half of it a ranking's entries take no extra clips (SHORT_GATHER_MAX_MINUTES)
  shortEraMatch: boolean; // a Short about an older release shows that release, never its later remake (SHORT_ERA_MATCH, src/editorial/shortrules.ts)
  shortBright: boolean; // lighter top and bottom fades and vignette, brightest art and footage first (SHORT_BRIGHT)
  shortLabelsClean: boolean; // no NEWS or CONFIRMED on our own work, no stat chip the line does not mention, no card repeating the caption (SHORT_LABELS_CLEAN)
  planSlateMax: number; // 0-1, the share of a long video that may sit on the empty slate before its render is stopped
  releaseGateMaxSlate: number; // 0-1, the same on the finished picture at the release gate
  releaseGateMinFootage: number; // 0-1, a documentary's share of game footage when the game has plenty of it
  releaseGateMinFootageRanking: number; // 0-1, the same for a ranking
  writerNotesGuard: boolean; // writer's notes (src/editorial/writernotes.ts) are sent back, and stop the video before the voice and at release; on by default
  docTestEvidence: boolean; // a run documentary may use approved gameplay tests as a source (src/editorial/testevidence.ts)
  shortSkeletons: boolean; // news Shorts rotate structures (opening, order, length, ending), none shared by two of the newest 30 (SHORT_SKELETONS, src/editorial/skeletons.ts, off)
  shortArguesCheck: boolean; // before release a Short needs a point not in the picture and some of Pulse's own material, else it goes back to the writer once, then out with a note (SHORT_ARGUES_CHECK, src/qa/argues.ts, off)
  dropAngle: boolean; // an official drop keeps the usual slot and gets one reframing idea; no long trailer or screenshot breakdowns (DROP_ANGLE, src/editorial/dropangle.ts, off)
  dropAngleHours: number; // an official drop goes out by this many hours after it landed, slot or not (DROP_ANGLE_HOURS)
  commentReplies: boolean; // answer good comments in a video's first hours
  openOnMotion: boolean; // Shorts open on the hook clip, not the hero still
  /** SHORT_OPEN_FOOTAGE: every Short opens on the game's own moving footage, its first 7 s screened ad-safe (src/openingstep.ts). */
  shortOpenFootage: boolean;
  weeklyEnabled: boolean; // Release Radar, Free This Week and the Weekly Recap
  radarDays: string[];
  freeDays: string[];
  recapDays: string[];
  recapLong: boolean; // Friday's recap is a 6-10 minute long video instead of a Short
  weeklyExplainedTest: boolean; // the weekly long video alternates the round-up with one story explained (src/weeklytest.ts)
  weeklyExplainedLeadMinutes: number; // while the test runs, the weekly long video's production starts this long before its slot
  achievementDays: string[];
  climbersDays: string[]; // the weekly Steam climbers Short
  dealsDays: string[]; // the Steam deals Short
  dealsSlot: string; // its own local slot, so it never takes a weekly format's
  weeklySlot: string;
  longformDays: string[];
  longformSlot: string;
  longformSkip: string[]; // ISO dates (London) with no factory-made long video, e.g. one uploaded by hand
  longformApprovalMode: ApprovalMode;
  longformApprovalMinutes: number;
  longformMaxSeconds: number;
  longformClipsPerEntry: number;
  docEnabled: boolean; // monthly franchise documentary (long-form lane)
  /** ElevenLabs: the plan's monthly credits (Pro: 500,000); unused credits above two months' worth are lost at the reset. */
  elevenLabsMonthlyCredits: number;
  elevenLabsReserve: number; // credits never spent, a cushion against overage
  surplusDocDays: string[]; // extra documentary days while credits would otherwise be lost
  surplusDocChars: number; // what one documentary costs in credits, roughly
  bankWindow: string; // local "HH:MM-HH:MM" when a banked documentary may start (it holds the factory for hours)
  docDays: string[];
  docSlot: string;
  docWeeks: number[]; // weeks of the month it runs: 1 = the first such weekday
  docLeadMinutes: number; // how long before the slot production starts
  /** Long videos (rankings, documentaries) start this long before their slot: script and voice the day before,
   * so the owner can record what the shot list wants and the render finds a gap between Shorts (28 Oct 2026). */
  longLeadMinutes: number;
  /** Narration slower than this is sped up (by up to 25%, pitch kept): MIN_WORDS_PER_MINUTE, 0 turns it off. */
  minWordsPerMinute: number;
  /** Every Short's take played this much faster, pitch kept (SHORT_SPEED; 1 = as recorded, 1.25 at most). Chosen 5 Nov 2026: 1.15. */
  shortSpeed: number;
  /** Share of news and Why Shorts written in the personal, opinionated voice (VOICE_TEST_SHARE; owner's test, 6 Nov 2026). */
  voiceTestShare: number;
  /** Buffer's API key and its Pulse TikTok channel (BUFFER_API_KEY, BUFFER_TIKTOK_CHANNEL): TikTok posts go out with no tap. */
  bufferApiKey: string;
  bufferTiktokChannel: string;
  /** The speed-up for this take (set per call, from shortSpeed): 1 = none. */
  speedFactor?: number;
  /** Long ElevenLabs narration: each take's pitch and brightness is measured and a take that strays from the
   * others (5% in pitch, 10% in centroid) is re-voiced once, the closer kept, at most 3 a narration
   * (VOICE_TAKE_CHECK, default on; 31 Oct 2026). */
  voiceTakeCheck: boolean;
  /** ElevenLabs stability (VOICE_STABILITY, default 0.5, eleven_v3's "Natural"): the owner's pick, sample C,
   * 11 Nov 2026, over 1.0 ("Robust", sample B of 29 Oct). eleven_v3 takes only 0, 0.5 and 1. */
  voiceStability: number;
  /** Writers may add eleven_v3 delivery tags ([chuckles], [sighs]) that only the voice sees (VOICE_TAGS,
   * default on; src/voice/tags.ts). */
  voiceTags: boolean;
  /** The "creator mic" EQ, compression and room on every narration after the speed-up (VOICE_MIC_CHAIN,
   * default on; sample C). */
  voiceMicChain: boolean;
  docMaxSeconds: number;
  docClipsPerChapter: number;
  /** The documentary mix follows the writer's beats and plays an era bed under each chapter's opening
   * (DOC_SOUND_BEATS, default on): off, the beats are still written but the mix and the voice ignore them. */
  docSoundBeats: boolean;
  /** Documentaries end on a rendered twenty-second card ("Up next": the newest public documentary, the
   * mark, a subscribe nudge) and their description's second line carries that link: DOC_END_CARD, default on. */
  docEndCard: boolean;
  /** A long video's series-grid (motif) thumbnail that the thumbnail check fails gets one repair, the same
   * grid in its next layout with other pictures, before another design takes its place: THUMB_MOTIF_REPAIR,
   * default on (owner, 31 Oct 2026: keep the grid look). */
  thumbMotifRepair: boolean;
  /** The long-video thumbnail rule: one recognisable hero from the right game, 1-4 big words, no frames, visors or
   * small panels (src/qa/thumbrule.ts). The GTA cover grid stays as the approved special case; a thumbnail that
   * fails the check gives way to the next design and never holds a release: THUMB_HERO_RULE, default on
   * (owner, 3-4 Nov 2026). */
  thumbHeroRule: boolean;
  /** Documentaries open on the signature three seconds (sting, mark, one line of the hook): DOC_COLD_OPEN, default on. */
  docColdOpen: boolean;
  /** The documentary's title lands as a card on the cold open's last beat instead of over its first seconds
   * (src/render/structure.ts titleDropWindow): DOC_TITLE_DROP, default on. */
  docTitleDrop: boolean;
  /** Open loops: the outline lists 2-4 questions, the chapters raise and answer them (checked), and the render
   * recalls the earlier shot when one is answered (src/editorial/openloops.ts): DOC_OPEN_LOOPS, default on. */
  docOpenLoops: boolean;
  /** The outro ends on the cold open's first image, in words (checked) and in its last shot with the move
   * reversed (src/render/structure.ts bookendEcho): DOC_BOOKEND_ENDING, default on. */
  docBookendEnding: boolean;
  /** A slim chapter index (current chapter lit) and the chapter's year in the corner: DOC_CHAPTER_INDEX, default on. */
  docChapterIndex: boolean;
  /** Series playlists under the owner's rule (src/seriesplaylists.ts, plan item 8): a video joins its playlist only once
   * it is public, so a scheduled video joins when confirmPublished sees it go live, not while it is still private. Off,
   * videos join at upload as before: SERIES_PLAYLISTS, default off. */
  seriesPlaylists: boolean;
  /** Sequels to winners (src/sequels.ts, plan item 9): a Why Short well ahead of the channel's own norm becomes the next
   * documentary, ahead of the breakout score, and a ranking Short the next long ranking: SEQUEL_WINNERS, default off. */
  sequelWinners: boolean;
  /** The friend pass (src/editorial/friendpass.ts, owner 11 Nov 2026): after a script's facts are settled, one mid-model
   * rewrite of the delivery only (the narrator's own take, a joke or two at companies, spoken rhythm, delivery tags),
   * kept only when no figure, name or quote moved and the fact check passes again. FRIEND_PASS lists the writers it
   * runs for ("shorts", "documentary"), "off" for none: default Shorts and documentary chapters. */
  friendPass: FriendPassFormat[];
  /** FRIEND_PASS_TIER: the model for the friend pass. "top" (Opus) wrote the edgier, funnier lines in the 11 Nov tuning
   * at about three times the mid model's few cents per Short; "mid" is the cheaper fallback. */
  friendPassTier: "top" | "mid";
  /** The Pulse Check (src/editorial/newssegment.ts, plan item 10): every news Short's take ends on one of four readings,
   * the named segment viewers follow for. Why Shorts and rankings are untouched: NEWS_SEGMENT, default off. */
  newsSegment: boolean;
  /** The Pulse Check on every series Short too (format redesign plan item 6, src/series.ts): The Why and The GTA File
   * end their take on it, and Buy, Wait or Skip can ask for it (seriesPulseCheck). Kept apart from NEWS_SEGMENT, which is
   * already on for news, so nothing changes before 22 Nov: NEWS_SEGMENT_SERIES, default off. */
  newsSegmentSeries: boolean;
  /** The next-part line test (plan item 9, src/editorial/shortrules.ts nextLineRule): on The Why and The GTA File, one
   * spoken line naming the next part and its day, only when the launch run has that part planned and dated, on
   * alternate days (src/experiments.ts nextLineArm): SERIES_NEXT_LINE, default off. */
  seriesNextLine: boolean;
  /** Plan item 2: the day's rumour allowance scaled by this share; 0 stops rumour Shorts: RUMOUR_SHARE, default 1 (unchanged). */
  rumourShare: number;
  /** Plan item 2: the news writer's Shorts must reach this many seconds of narration (words at the narrator's pace); 0 is
   * off: SHORT_MIN_SECONDS, default 0. */
  shortMinSeconds: number;
  /** Plan item 2: false drops the late news slot (21:00 or later) from NEWS_SLOTS: NEWS_LATE_SLOT_ENABLED, default true. */
  newsLateSlotEnabled: boolean;
  /** Plan item 2: breaking news only on a HOME_SHELF game, or when the story desk rates it major: BREAKING_HOME_ONLY, default off. */
  breakingHomeOnly: boolean;
  /** The home shelf, "|"-separated names a headline would use: HOME_SHELF, default GTA and Resident Evil. */
  homeShelf: string[];
  /** The series cover strip (src/render/components/SeriesStrip.tsx, format plan item 5): an amber strip at the top of
   * a series Short's opening poster and search thumbnail naming its series ("THE WHY", "THE GTA FILE", "BUY, WAIT OR
   * SKIP"), always in the same place. "strip" draws it, "off" leaves covers as they are: SERIES_COVER_STYLE, default off. */
  seriesCoverStyle: "off" | "strip";
  /** The part number in the strip ("THE WHY #24"), counted from the series' earlier Shorts: SERIES_EPISODE_NUMBERS,
   * default off. Only drawn when the strip is on. */
  seriesEpisodeNumbers: boolean;
  /** Buy, Wait or Skip (src/editorial/verdict.ts, format plan item 7): one game, one price, one verdict, in the deals
   * slot on its days. Prices from Steam (dollars first, pounds and euros beside), scores from Steam reviews and the
   * store's Metacritic figure, the lowest price from CheapShark: SERIES_VERDICT_ENABLED, default off. */
  seriesVerdictEnabled: boolean;
  /** Its days (SERIES_VERDICT_DAYS, default "tue,thu,sat"); the slot is DEALS_SLOT. */
  seriesVerdictDays: string[];
  /** The series channel page (src/channelpage.ts, format plan item 8): banner, description, featured Short and shelf
   * order, applied once through the YouTube API by src/tools/channel-page.ts --apply. Off, the tool only prints what
   * it would change: SERIES_CHANNEL_PAGE, default off. */
  seriesChannelPage: boolean;
  /** The Short a new visitor sees first on the channel page (a YouTube video id), when the page is applied:
   * SERIES_FEATURED_VIDEO, default empty (the featured Short is left as it is). */
  seriesFeaturedVideo: string;
  /** The Hype ask (src/youtube/hype.ts, plan item 11): a short line in a documentary's end card and pinned comment. YouTube
   * offers Hype only to Partner Programme channels of 500-500,000 subscribers, so leave this off until Pulse has joined;
   * with it on, the subscriber count is still checked before each ask: HYPE_ASK, default off. */
  hypeAsk: boolean;
  /** The Sunday growth report (src/growthreport.ts, plan item 12): subscribers per 1,000 views for each format, week on
   * week, and one line on what to back, to the alerts channel on Sundays at 10:00: GROWTH_REPORT, default off. */
  growthReport: boolean;
  /** Click-through per video from YouTube's Reporting API (src/reach.ts), in the Sunday report and the test queue: REACH_REPORT, default off. */
  reachReport: boolean;
  /** The weekly cross-platform analytics loop (src/analyticsloop.ts): Mondays from 09:00 it reads every platform, writes
   * data/reports/analytics/latest.md and latest.json for the PC to pull, reads TikTok's numbers from Buffer every six
   * hours and tags each crosspost fit or not fit for the report's test: ANALYTICS_LOOP, default off. Report only. */
  analyticsLoop: boolean;
  /** Up to six advice lines from that report added to the writers' lessons (src/loopfeedback.ts): ANALYTICS_LOOP_LESSONS, default off. */
  analyticsLoopLessons: boolean;
  /** The report's posting choices: fit Shorts ranked up to 25% higher for TikTok, and formats with 30+ Reels and no breakout
   * held back from Instagram (still 1 post in 5): ANALYTICS_LOOP_POSTING, default off. */
  analyticsLoopPosting: boolean;
  /** The report's story-pick multiplier (0.85 to 1.15, moved 0.05 a week at most) on the news slot's candidates; breaking
   * news never: ANALYTICS_LOOP_SCORING, default off. */
  analyticsLoopScoring: boolean;
  /** Share of Shorts that get a thumbnail made for the search tile instead of their first frame (src/shortthumb.ts); 0.5 is a fair test: SHORT_SEARCH_THUMB_SHARE, default 0. */
  shortSearchThumbShare: number;
  /** YouTube autocomplete terms this video really answers, in its tags and one description line (src/searchterms.ts): SEARCH_TERMS, default off. */
  searchTerms: boolean;
  /** The Test & compare queue drops replaced uploads and puts the most clicks lost first (src/reach.ts abQueueView): AB_QUEUE_CLEAN, default off. */
  abQueueClean: boolean;
  /** Every post to the alerts channel also goes as one line to data/logs/alerts.jsonl (src/alertlog.ts): ALERT_LEDGER,
   * default off. */
  alertLedger: boolean;
  /** The daily digest of that ledger (src/alertdigest.ts): written to data/logs/alert_digest.md from 09:00 and posted
   * only when a kind of alert is new or rising: ALERT_DIGEST, default off. */
  alertDigest: boolean;
  /** The breakout documentary picker (src/docpick.ts, growth plan move 3): the next documentary is the candidate
   * that scores best on fame, a collapse-or-comeback arc, a news peg, demand and freshness, with no model call;
   * the score breakdown is logged and posted to Discord. Off, the writer picks from the lists as before:
   * DOC_BREAKOUT_PICKER, default on. */
  docBreakoutPicker: boolean;
  /** At most this many candidates get the slower lookups (Steam, Wikipedia, YouTube demand) a pick: DOC_PICK_LOOKUPS, default 8. */
  docPickLookups: number;
  /** DOC_PICK_SINGLE_SUBJECT: series surveys leave the running and a story is weighed by its shape: one person, one hunt or one failure (src/docpick.ts scoreShape). World-class audit fix 1. */
  docPickSingleSubject: boolean;
  /** FILM_SLATE_FILE: a ranked list of films (film_slate.json, from reports/Film slate November 2026.md); the first not yet made goes next. Empty = none. */
  filmSlateFile: string;
  /** Real evidence on screen (src/editorial/evidence.ts): on key beats (an announcement, a delay, an apology, a
   * review verdict, a sales milestone, a statement) the documentary shows the source's exact words as a full-frame
   * statement page, or the review aggregate as a score page, each with a source credit; never invented text:
   * DOC_EVIDENCE, default on. */
  docEvidence: boolean;
  /** Title shapes (src/editorial/titleshape.ts, growth plan moves 4 and 5): ranking and documentary titles that
   * lead with "Top N", a year, a count or "History of" are sent back to the writer, and a long video's failing
   * title gives way to a passing alternative before upload: TITLE_SHAPES, default on. */
  titleShapes: boolean;
  /** The Test & compare titles are three distinct angles (downfall, hidden side, comeback, why/how, claim):
   * TITLE_ANGLES, default on. */
  titleAngles: boolean;
  /** Title shapes a test has shown to work for this channel, let back in: TITLE_SHAPE_ALLOW (comma list of
   * top, year, count, history), default empty. */
  titleShapeAllow: string[];
  /** Tighter cuts in a documentary's first 3 minutes and a 10 s burst of quicker cuts every 2.5 minutes after
   * (src/render/structure.ts shotCap): DOC_CUT_RHYTHM, default on. */
  docCutRhythm: boolean;
  /** A documentary's first comment points at one chapter with its timestamp: DOC_PIN_MOMENT, default on. */
  docPinMoment: boolean;
  /** A community post and a poll are drafted for every documentary when it goes live, kept on the episode and
   * put in the publish notice for the owner to paste (the API cannot post them): COMMUNITY_DRAFTS, default on. */
  communityDrafts: boolean;
  crosspost: {
    facebook: boolean;
    instagram: boolean;
    tiktok: boolean;
    x: boolean;
    threads: boolean;
    bluesky: boolean;
  }; // which platforms get every public Short
  crosspostDelays: {
    facebook: number;
    instagram: number;
    tiktok: number;
    x: number;
    threads: number;
    bluesky: number;
  }; // minutes after the YouTube publish
  /** Threads login saved by /connect?account=threads ({ userId, token, refreshedAt }). */
  threadsLoginPath: string;
  threadsAppId: string;
  threadsAppSecret: string;
  /** Bluesky handle and app password saved by /connect?account=bluesky. */
  blueskyLoginPath: string;
  crosspostWindowHours: number; // how far back a Short is still worth posting
  /** TikTok gets only the day's strongest Shorts (by YouTube views per hour), this many a day; 0 = every Short. */
  tiktokDaily: number;
  /** Local hour (TIMEZONE) from which the day's TikTok picks are sent: 16 = US lunchtime. */
  tiktokFromHour: number;
  /** Fewest minutes between two TikTok posts (TIKTOK_GAP_MINUTES), so a backlog never lands as a burst; 0 = no gap. */
  tiktokGapMinutes: number;
  /** Hard daily caps for the other platforms (INSTAGRAM_DAILY, FACEBOOK_DAILY, THREADS_DAILY), counted over the last 24 hours; above 0 the day's best Shorts are picked as for TikTok; 0 = every Short, oldest first. */
  instagramDaily: number;
  facebookDaily: number;
  threadsDaily: number;
  /** Fewest minutes between two posts on each (INSTAGRAM_GAP_MINUTES, FACEBOOK_GAP_MINUTES, THREADS_GAP_MINUTES); 0 = no gap. */
  instagramGapMinutes: number;
  facebookGapMinutes: number;
  threadsGapMinutes: number;
  engageEnabled: boolean; // a daily community post on Facebook and Instagram
  /** The daily question picture on Instagram as well (ENGAGE_INSTAGRAM): off, 9 posts drew 0 likes by 29 Oct 2026. */
  engageInstagram: boolean;
  engageSlot: string; // local time it goes out
  /** The Short's first comment asks the video's own closing question (FIRST_COMMENT_QUESTION, src/social/firstcomment.ts). */
  firstCommentQuestion: boolean;
  /** Reads the public comment list to see whether first comments are really showing (FIRST_COMMENT_CHECK, src/social/commentcheck.ts). */
  firstCommentCheck: boolean;
  /** Replies lose their stock opener and do not all end on a question (REPLY_STYLE, src/youtube/replies.ts). */
  replyStyle: boolean;
  /** Answers a viewer who replies to our reply, up to REPLY_LIMITS.perThread in a thread (REPLY_FOLLOWUPS). */
  replyFollowups: boolean;
  /** Answers comments on our Instagram and Facebook reels (META_COMMENT_REPLIES, src/social/metacomments.ts). */
  metaCommentReplies: boolean;
  /**
   * The community engine (COMMUNITY_ENGINE, src/youtube/viewers.ts): every real viewer comment gets one friend-voice
   * reply, and hearts and one viewer pin per video are planned for the Studio routine (/routine/viewers). While on, it
   * replaces the older reply passes. Off by default.
   */
  communityEngine: boolean;
  /** Replies the engine sends in a day (COMMUNITY_REPLIES_PER_DAY) and in one 15-minute pass (COMMUNITY_REPLIES_PER_PASS). */
  communityRepliesPerDay: number;
  communityRepliesPerPass: number;
  /** Per-platform lines in the Sunday growth report and what went quiet in the alert digest (SOCIAL_SCOREBOARD). */
  socialScoreboard: boolean;
  /** A community post that found no pictures tries again instead of leaving the day empty (ENGAGE_RETRY). */
  engageRetry: boolean;
  /** Viewer requests are also read from the Shorts' comments the factory already holds (REQUESTS_FROM_SHORTS). */
  requestsFromShorts: boolean;
  /** The GTA VI launch's fixed community posts, 18-21 Nov (LAUNCH_COMMUNITY_POSTS, src/social/launchcommunity.ts). */
  launchCommunityPosts: boolean;
  /** The Meta login saved by /connect?account=meta; when present its page token wins over the .env tokens. */
  metaLoginPath: string;
  /** A Facebook Login for Business configuration id (FACEBOOK_LOGIN_CONFIG_ID), when the app uses one instead of scopes. */
  facebookLoginConfigId: string;
  /** Permissions the saved Meta login was granted (set from the login file; empty until the owner connects). */
  metaGranted?: string[];
  /** The YouTube link goes in the Facebook reel's first comment, not its caption, when the login may comment as the page. */
  facebookLinkComment: boolean;
  /** The Meta app the connect page signs in with (FACEBOOK_APP_ID, FACEBOOK_APP_SECRET). */
  facebookAppId: string;
  facebookAppSecret: string;
  facebookPageId: string;
  facebookPageToken: string;
  instagramAccountId: string;
  instagramToken: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
  tiktokTokenPath: string;
  tiktokBrowser: boolean; // post publicly through the signed-in Chrome profile (off: drafts go to the owner's TikTok inbox)
  twitchClientId: string; // IGDB pictures for games Steam cannot supply
  twitchClientSecret: string;
  xKeys: {
    consumerKey: string;
    consumerSecret: string;
    token: string;
    tokenSecret: string;
  };
  selectFromHourUtc: number;
  minGapHours: number;
  tickMinutes: number;
  maxStoryAgeHours: number;
  includeRumours: boolean;
  rumoursPerDay: number; // rumour Shorts a day at most, so the channel stays news first
  /** A Short taking off: this many times the usual views an hour in its first two days (src/hits.ts). */
  hitMultiple: number;
  /** ...and never fewer views an hour than this. */
  hitMinPerHour: number;
  /** How long the editors lean towards a hit's game. */
  hitHours: number;
  approvalMode: ApprovalMode;
  approvalTimeoutMinutes: number;
  publishWindowStartUtc: number;
  publishWindowEndUtc: number;
  visionQa: boolean;
  /** The Shorts' word-moment suite (src/render/wordlook.ts): off draws every word moment as the rubber stamp. */
  shortWordLooks: boolean;
  /** The long videos' craft on the Shorts (src/render/shortcraft.ts), each layer on its own: the Pulse-universe
   * cards in the rotation, the treatments of real photos, fillers for bare lines and the light camera moves. */
  shortCraftCards: boolean;
  shortCraftPhotos: boolean;
  shortCraftFillers: boolean;
  shortCraftCamera: boolean;
  /** The clean frame on every Short (src/render/cleanframe.ts): full-bleed, one overlay at a time, a small mark. */
  shortsClean: boolean;
  /** The graphics check before a long render (src/qa/graphicscheck.ts): every graphic as a cheap still, faulted
   * ones muted, so the full render runs once instead of again per faulted graphic. */
  graphicsPrepass: boolean;
  /** Long-video graphics fit their text and read as complete thoughts: the compare card's measured layout, kinetic lines whole, a scale card's giant word finishing its line (src/render/components/LongMoments.tsx, kinetic/words.ts). */
  graphicsFit: boolean;
  /** The pre-pass looks again at a faulted graphic and mutes it only if faulted twice (src/qa/graphicscheck.ts). Off: one look mutes. */
  graphicsSecondLook: boolean;
  /**
   * GRAPHICS_AUDIT (src/qa/gfxaudit.ts), at the plan stage of every Short and long video: "off"; "report" measures
   * reading time, clashes, fit, figures, alignment and meaning and logs them; "fix" also repairs what it can (holds,
   * moves, trims and drops) and fails a render only for a wrong graphic it cannot drop.
   */
  graphicsAudit: GraphicsAuditMode;
  /** GRAPHICS_FRAME_CHECK: after a Short renders, each card's settled frame is checked for clipped or overlapping text. */
  graphicsFrameCheck: boolean;
  graphicsPrepassMax: number; // graphics checked as stills before the render, at most
  /** Full re-renders the post-render graphics check may ask for; past that it accepts the video with the faults muted. */
  graphicsRerenderPasses: number;
  graphicsPostcheckMax: number; // graphics sampled from the finished video, at most
  /** The release gate for documentaries (src/qa/releaseGate.ts): every shot scored against the words over it. */
  releaseGate: boolean;
  releaseGateMinMean: number; // 0-3, the time-weighted mean a documentary needs to go out on its own
  releaseGateMaxZero: number; // 0-1, the share of screen time that may show the wrong thing
  /** A code reload (data/admin/reload-requested, src/reload.ts) never happens this close before a slot. */
  reloadMinutesBeforeSlot: number;
  /** A long video's media gather stops with what it has after this long (src/assets/gatherbudget.ts); 0 = no limit. */
  gatherMaxMinutes: number;
  /** Every yt-dlp and ffmpeg download child is killed after this long (src/lib/child.ts; read from the environment there too). */
  downloadTimeoutSeconds: number;
  /** A long-lane tick not completed for this long, with no render or upload running, is reported and its lease released. */
  longTickStallMinutes: number;
  /** Languages each video's title and description are also set in on YouTube (empty switches it off). */
  localizeLanguages: string[];
  /** Python with faster-whisper (PC) or MLX Whisper (Mac) for the narration check; empty switches it off. */
  whisperPython: string;
  /** Python for the depth layers (src/render/parallax.py): its own environment, so OpenCV and Pillow stay
   * out of the speech recogniser's locked runtime (adding them there broke PulseGaming-ASR on 27 Oct 2026). */
  parallaxPython: string;
  /** Where nightly encrypted restore points go: a folder synced off the PC (the owner's Google Drive). */
  backupDir: string;
  footage: boolean;
  maxClips: number;
  clipRanking: "llm" | "rule"; // how trailer moments are matched to narration lines
  officialTrailers: boolean; // games not on Steam: the publisher's own YouTube trailer
  cutsceneFootage: boolean; // CUTSCENE_FOOTAGE: opt in to screened YouTube cutscene sections
  cutsceneScenes: boolean; // CUTSCENE_SCENES: seek named scenes in the cutscene search (chapters, captions, scene uploads); off by default
  /** SCENE_MATCH: a line that names a moment ("Ganondorf rises") gets an indexed or located clip only once the free local vision model sees it there (src/assets/scenecheck.ts); off: the index and the search decide alone. */
  sceneMatch: boolean;
  cutsceneQuotes: boolean; // CUTSCENE_QUOTES: collect caption quotes for future review
  cutsceneMaxSeconds: number; // CUTSCENE_MAX_SECONDS: per-Short budget, scaled for long videos
  /** SCENE_INDEX: the per-game scene index (src/sceneindex): built in the background, looked up before cutscenes are searched. Off: nothing is built or read. */
  sceneIndex: boolean;
  sceneIndexProxyHeight: number; // SCENE_INDEX_PROXY_HEIGHT: the kept low-resolution copy; 480 keeps text boxes readable
  sceneIndexOcrFps: number; // SCENE_INDEX_OCR_FPS: frames a second the text reader looks at
  sceneIndexChunkMinutes: number; // SCENE_INDEX_CHUNK_MINUTES: minutes of the source indexed in one piece of work
  sceneIndexMaxHours: number; // SCENE_INDEX_MAX_HOURS: no source longer than this
  sceneIndexTurnSteps: number; // SCENE_INDEX_TURN_STEPS: pieces of work in one background turn
  sceneIndexMinConfidence: number; // SCENE_INDEX_MIN_CONFIDENCE: a lookup below this falls back to the cutscene search
  /** GAME_FETCH: full movies and no-commentary playthroughs of every big release fetched into the scene index (src/sceneindex/gamefetch.ts); needs SCENE_INDEX. */
  gameFetch: boolean;
  gameFetchTitles: string; // GAME_FETCH_TITLES: "Title@release~window end; Title2", always fetched first
  gameFetchSignals: string; // GAME_FETCH_SIGNALS: owner,calendar,bigstory,videos,radar (empty: all)
  gameFetchHours: number; // GAME_FETCH_HOURS: hours between searches from release until a clean upload is found
  gameFetchRecheckHours: number; // GAME_FETCH_RECHECK_HOURS: hours between looks for a longer or better upload
  gameFetchRecheckDays: number; // GAME_FETCH_RECHECK_DAYS: days after release the looks go on (at least the spoiler window)
  /** SPOILER_GUARD: no late-story footage, words or stream cutscenes during a game's spoiler window (src/sceneindex/spoilers.ts). */
  spoilerGuard: boolean;
  /** STREAM_ASKS and VOD_MINER: the living list of things to test on stream and the moment miner (src/streamasks). */
  streamAsks: StreamAsksSettings;
  /** LIVE_CLIPS: big moments found while the owner is live on Twitch, sent to the gameplay lane within minutes (src/liveclips). */
  liveClips: LiveClipsSettings;
  spoilerWindowDays: number; // SPOILER_WINDOW_DAYS: days after release a game's story is protected
  spoilerOpeningShare: number; // SPOILER_OPENING_SHARE: the share of the story, from its start, that counts as the opening
  /** CHARACTER_QUOTES: one real line from the game's cutscene, with its own voice, set up and answered by the narrator (src/charquotestep.ts). */
  characterQuotes: boolean;
  characterQuotesLong: number; // CHARACTER_QUOTES_LONG: the most quotes in one long video
  characterQuotesShort: number; // CHARACTER_QUOTES_SHORT: the most quotes in one Short (default 1; a second only when the story fits)
  /** GAME_AUDIO_BED (off by default; owner, 12 Nov 2026): the footage's own game sound under the narration, ducked
   * well under the voice, up in the gaps between sentences, silent under a character quote (src/assets/gameaudio.ts). */
  gameAudioBed: boolean;
  gameAudioShare: number; // GAME_AUDIO_SHARE: share of videos that get the bed, split by episode (default 0.5)
  gameAudioUnderLufs: number; // GAME_AUDIO_UNDER_LUFS: the bed's loudness under the voice (default -30; narration is -16)
  gameAudioGapLufs: number; // GAME_AUDIO_GAP_LUFS: the bed's loudness in the gaps between sentences (default -24)
  gameAudioTrailers: boolean; // GAME_AUDIO_TRAILERS: trailer clips' sound too, 8 dB lower (default off: trailer music)
  gameAudioMusicDip: number; // GAME_AUDIO_MUSIC_DIP: the music bed's level where the game sound plays (default 0.6)
  officialStillFrames: number; // stills-only publishers (Nintendo): frames of their trailer matched to lines; 0 is off
  docSandboxChapters: number; // DOC_SANDBOX_CHAPTERS: a sandbox writes only this many chapters; 0 is all
  shortVivid: boolean; // SHORT_VIVID: a Short's picture under a lighter scrim and vignette, for the clean frame
  /** APPLE_SMART_CROP (Mac mini only, off until switched on): Apple Vision follows the subject so a wide clip's
   * upright crop keeps the action in frame, not the middle third (src/render/smartcrop.ts). */
  appleSmartCrop: boolean;
  /** APPLE_SUBJECT_LIFT (Mac mini only, off until switched on): Apple Vision's foreground mask cuts the subject out
   * for thumbnails and the Short's opening poster, ahead of the depth model (src/assets/applevision.ts). */
  appleSubjectLift: boolean;
  /** APPLE_HW_ENCODE (Mac mini only, off until switched on): clip cuts and other in-between encodes on the Mac's
   * VideoToolbox encoder (src/lib/videoenc.ts); final masters stay on libx264. */
  appleHwEncode: boolean;
  ytdlpPath: string;
  /** Games the owner plays (and records): long videos about them send them a "record these moments" list. */
  ownerGames: string[];
  captureChecklist: boolean; // send that list on Discord when a long video or documentary covers one of their games
  footageLibrary: string; // the owner's own recordings (NVIDIA: Videos\\<Game>\\...); empty = off
  pexelsApiKey: string; // licensed stock for the real-world part of picture stories
  /**
   * More picture libraries (src/assets/libraries.ts, press.ts, stock.ts), each screened, licence-recorded and
   * credited like Wikimedia Commons and Pexels. All on by default (owner, 1 Nov 2026):
   *  - libraryPress (LIBRARY_PRESS): publishers' own press and newsroom sites (Xbox Wire, PlayStation Blog, Sony
   *    Interactive, CD PROJEKT RED, the Steam Deck press kit), editorial use, "Image: <Publisher> press" on screen;
   *  - libraryOpenverse (LIBRARY_OPENVERSE): Openverse (Flickr and other archives), CC0 / CC BY / CC BY-SA only;
   *  - libraryPixabay (LIBRARY_PIXABAY): Pixabay video and photos as a second stock library; needs PIXABAY_API_KEY
   *    (free), skipped without it;
   *  - libraryArchive (LIBRARY_ARCHIVE): Internet Archive films whose licence is public domain, CC0 or CC BY.
   */
  libraryPress: boolean;
  libraryOpenverse: boolean;
  libraryPixabay: boolean;
  pixabayApiKey: string;
  libraryArchive: boolean;
  amazonUkTag: string; // Amazon Associates UK tracking ID
  amazonUsTag: string; // Amazon Associates US tracking ID, when there is one
  amazonMoreTags: {
    ca?: string;
    de?: string;
    fr?: string;
    it?: string;
    es?: string;
    au?: string;
  }; // other national stores
  youtubeChannelId: string; // the only channel the factory may connect to
  /** The twin channel: every Short re-voiced in this language and uploaded to a second channel; "" = off. */
  twinLanguage: string;
  twinChannelId: string; // the second channel's id, checked when it is connected (/connect?account=es)
  twinDelayMinutes: number; // the twin follows the original by this long
  oauthRedirectUri: string; // where Google returns after consent; this PC's own address works for the desktop OAuth client
  musicBed: boolean;
  /** 2.5D depth layers for long videos' stills (src/render/parallax.ts). */
  parallax: boolean;
  /** Zoom-to-the-detail annotations on long videos' stills (src/assets/annotate.ts). */
  annotate: boolean;
  /** A long video's real-world photos (Commons photos, portraits, sketches) only on the sentence they were picked for,
   *  never as filler; unpinned ones not shown (src/render/longplan.ts realWorldImage). On by default. */
  realPhotosPinnedOnly: boolean;
  /** At most this many stock clips per theme ("office at night", "counting cash") in one video (src/assets/repeats.ts). */
  stockThemeMax: number;
  /** Finished episodes' media is deleted after this many days (src/retention.ts; the DB row stays). */
  mediaKeepDays: number;
  /** Below this much free disk, finished episodes' media goes sooner, oldest first (the Mac's 256 GB SSD). */
  mediaMinFreeGb: number;
  /** ...but never media younger than this many days (a just-published video's files stay for its checks). */
  mediaFloorDays: number;
  /**
   * Footage first for long videos (src/assets/footagefirst.ts): once per video, before the picture top-up, each
   * released game's chapter gathers Creative Commons gameplay until moving footage can fill FOOTAGE_SHARE_TARGET
   * percent of its narration; junk (mods, kids' videos, reactions, remasters, menus) is refused; the planner
   * never repeats a moment within a chapter. On by default (owner, 31 Oct 2026).
   */
  footageFirst: boolean;
  footageShareTarget: number; // percent of a game chapter's narrated time on moving footage
  footageSources: number; // CC BY videos per chapter at most
  footagePullSeconds: number; // seconds downloaded from each
  footageVisionMax: number; // segment frames checked on this PC per chapter at most
  footageFirstMaxMinutes: number; // the whole pass stops starting new chapters after this long; 0 = no limit
  /** Drawn concept sketches for documentary lines nothing filmed can show (src/assets/illustrate.ts); off by default. */
  illustrate: boolean;
  /** The ComfyUI server that draws them (this PC's FLUX.1 dev). */
  illustrateUrl: string;
  /** At most this many sketches per documentary, so a run cannot take all night. */
  illustrateMax: number;
  /** Each sketch's time to queue, draw and download; past it the job is dropped. */
  illustrateTimeoutSeconds: number;
  /** A placeholder PNG instead of the model: dry runs and the trial without the GPU. */
  illustrateStub: boolean;
  /** A few concept sketches of lines with movement brought to life by this PC's own video model (Wan 2.2 TI2V 5B through ComfyUI; src/assets/localvideo.ts); off by default. */
  illustrateVideo: boolean;
  /** At most this many AI motion clips per documentary: each holds the GPU about 3 minutes. */
  illustrateVideoMax: number;
  /** Each clip's time to upload, animate and download; past it the job is dropped from ComfyUI's queue. */
  illustrateVideoTimeoutSeconds: number;
  /** A slow-zoom clip of the sketch made by ffmpeg instead of the model: dry runs and tests without the GPU. */
  illustrateVideoStub: boolean;
  /** Sketches animated on screen (drawn on, stop-motion paper, flipbook, light table, cork board; src/render/sketchplan.ts). Off: the static framed print. */
  sketchAnimation: boolean;
  /** A filler visual (kinetic type, diagram, document, drawn scene, silhouettes, in-game reconstruction) for each documentary line still bare or on stock after the top-up (src/assets/fillers.ts). Off: those lines stay on the chapter's footage. */
  fillers: boolean;
  /** Photos and portraits in documentaries arriving as instant prints, tape, pins, trays, screens and more (src/render/photoplan.ts). Off: the static framed print and full-bleed screenshots. */
  photoTreatments: boolean;
  /**
   * The documentary's camera grammar (src/render/camera.ts): pushes and whips through the cut, hand-drawn
   * marks on named details, freeze frames, beat-driven pushes, two-stage Ken Burns, rack focus, a vertigo
   * push, a lens look and a texture flicker on explainers. Since 31 Oct 2026 it covers every long video
   * (documentaries, rankings, weekly recaps; src/longformat.ts). LONG_CAMERA: "all" (default), "off", or a
   * list; the older name DOC_CAMERA is read when LONG_CAMERA is not set.
   */
  longCamera: CameraTechnique[];
  /** A ranking's entries each get a short burst of quicker cuts at their middle, the pace a Short keeps
   * (src/render/structure.ts entryBursts), on top of DOC_CUT_RHYTHM: LONG_ENTRY_PACE, default on. */
  longEntryPace: boolean;
  /** The ranking writer opens on a 5-10 word first line, a Short's hook length, which the signature cold
   * open then shows (src/editorial/longform.ts): LONG_PUNCHY_HOOK, default on. Off: under 15 words, as before. */
  longPunchyHook: boolean;
  /**
   * The rules from the Inspiration study (reports/Inspiration playlist forensics.md; src/editorial/longrules.ts). All
   * off by default; a miss costs at most one revision and is then a style warning.
   * LONG_YOU_PER_1000: the least "you" per 1,000 words in a long video, measured on the script (0: not measured).
   * GUIDE_YOU_PER_1000: the same in a guide, used only when LONG_YOU_PER_1000 is on (default 35).
   */
  longYouPer1000: number;
  guideYouPer1000: number;
  /**
   * DOC_META_GUARD: a chapter that talks about its brief instead of the story ("this excerpt", "shouldn't be recorded")
   * is sent back, and dropped if it still does. The FFXIV documentary of 4 Nov carried one, voiced.
   */
  docMetaGuard: boolean;
  /** LONG_SENTENCE_GATE: the mean sentence stays under this many words on rankings and guides (0: not measured). */
  longSentenceGate: number;
  /** LONG_HOOK_YOU_MIN: the least "you" words in a long video's opening, which the whole-video floor cannot see (0: off). */
  longHookYouMin: number;
  /** LONG_HOOK_STACK: the opening stacks the stakes, 3 to this many named surprises, a trust line and a saved promise (0: the older opening). */
  longHookStack: number;
  /** LONG_OPEN_LOOPS_MAX: the most open loops a guide plans; rankings get real ones, up to 3 (0: as before). */
  longOpenLoopsMax: number;
  /** LOOP_NAME_PAYOFF: a payoff says out loud that it's the promise being kept. */
  loopNamePayoff: boolean;
  /** LONG_VERDICT_STAMPS: confirmed, reported and busted, spoken and stamped in a guide, under the rumour rules. */
  longVerdictStamps: boolean;
  /** LONG_GUIDE_FORMAT: a run entry with format "guide" (src/shortrun.ts) follows the player's journey. Off: it runs as a documentary. */
  longGuideFormat: boolean;
  /** GUIDE_CHAPTER_ACTION: each guide chapter ends in a job for day one. */
  guideChapterAction: boolean;
  /**
   * The weekly guide strand (src/longguide.ts, upgrade queue item 9): GUIDE_WEEKLY turns it on (off by default);
   * GUIDE_WEEKLY_FILE names the plan (guides.json beside package.json when empty). One long guide a week in one fixed
   * title frame, from the owner's own play first, fact-checked against the plan's confirmed facts file.
   */
  guideWeekly: boolean;
  guideWeeklyFile: string;
  /** GUIDE_OWN_FIRST: a weekly guide's chapters ask the owner's recordings for every footage target, not half. */
  guideOwnFirst: boolean;
  /**
   * The Shorts-to-long funnel test (src/funnel.ts, upgrade queue item 18): FUNNEL_TEST turns it on (off by default).
   * Each weekly guide gets FUNNEL_SHORTS Shorts cut from it, one a day in the cutdown slot within FUNNEL_DAYS of its
   * release; FUNNEL_SHARE of them (by episode id) say and show the link in their last 5 seconds and get the related
   * link, the rest are the control. With it on, the related-video routine links only Shorts cut from a long video
   * and lists the other Shorts it linked before (FUNNEL_CLEAR_DAYS back) for their link to be removed.
   */
  funnelTest: boolean;
  funnelShare: number;
  funnelShorts: number;
  funnelDays: number;
  funnelClearDays: number;
  /** LONG_SAME_PICTURE_MAX_SECONDS: no one still for more than this in any minute (src/render/picturecap.ts; 0: off). */
  longSamePictureMaxSeconds: number;
  /** LONG_CARD_SHARE: fillers may also take lines with a still of their own until this share of sentences carries a card, 0-1 (0: off). */
  longCardShare: number;
  /** LONG_STILL_XFADE_FRAMES: a long video's dissolve between stills, in frames: a test dial only (9: as today, 0: hard cuts). */
  longStillXfadeFrames: number;
  /** LONG_MIN_WPM: a test dial only: rankings slower than this are sped up, documentaries never (0: off). */
  longMinWpm: number;
  /**
   * A documentary's sound craft (src/render/soundfx.ts, 31 Oct 2026), each part on by default: SOUND_JL_CUTS
   * (a clip's game sound leads or trails its picture), SOUND_GAME_POCKETS (game sound up in long pauses),
   * SOUND_FOLEY (treatments and devices make their own small sounds), SOUND_RISERS (a riser into each
   * reveal beat), SOUND_CHAPTER_BUTTONS (a soft final hit on each chapter's last word), SOUND_PHRASE_EDITS
   * (bed changes on the bar line), SOUND_VOICE_POCKET (the music dips at 2-4 kHz under speech) and
   * SOUND_VOICE_FX (telephone band on message quotes, reverb swell on reveal lines). Off: the old mix.
   */
  soundCraft: SoundCraft;
  dryRun: boolean;
  maxAttempts: number;
  remotionConcurrency: number;
  remotionGl: RemotionGl;
  browserExecutable: string;
}

export function loadConfig(): Config {
  const approvalMode = str("APPROVAL_MODE", "timeout") as ApprovalMode;
  if (!["manual", "timeout", "auto"].includes(approvalMode)) {
    throw new Error(
      `APPROVAL_MODE must be manual, timeout or auto, got "${approvalMode}"`,
    );
  }
  if (
    !VOICE_PROVIDERS.includes(str("VOICE_PROVIDER", "auto") as VoiceProvider)
  ) {
    throw new Error(
      `VOICE_PROVIDER must be one of ${VOICE_PROVIDERS.join(", ")}`,
    );
  }
  const youtubePrivacy = str("YOUTUBE_PRIVACY", "public") as PrivacyStatus;
  if (!["public", "unlisted", "private"].includes(youtubePrivacy)) {
    throw new Error(
      `YOUTUBE_PRIVACY must be public, unlisted or private, got "${youtubePrivacy}"`,
    );
  }
  const remotionGl = str("REMOTION_GL", "swangle") as RemotionGl;
  if (!REMOTION_GLS.includes(remotionGl))
    throw new Error(
      `REMOTION_GL must be one of ${REMOTION_GLS.join(", ")}, got "${remotionGl}"`,
    );
  const railwayDomain = str("RAILWAY_PUBLIC_DOMAIN");
  // Logins saved by the factory's own connect pages sit beside the TikTok token, outside the repo.
  // A PC path copied to the Mac (D:/pulse-data/tokens/...) means the same file in data/tokens there.
  const tiktokTokenPath = relocatedFile(
    str("TIKTOK_TOKEN_PATH"),
    process.platform,
    path.resolve(str("DATA_DIR", "./data"), "tokens"),
  );
  const tokenDir = tiktokTokenPath
    ? path.dirname(tiktokTokenPath)
    : path.resolve(str("DATA_DIR", "./data"), "tokens");
  const cfg: Config = {
    port: int("PORT", 8080),
    publicUrl: str(
      "PUBLIC_URL",
      railwayDomain ? `https://${railwayDomain}` : "http://localhost:8080",
    ).replace(/\/$/, ""),
    siteUrl: str("SITE_URL").replace(/\/$/, ""),
    dataDir: path.resolve(str("DATA_DIR", "./data")),
    databaseUrl: str("DATABASE_URL"),
    appSecret: str("APP_SECRET"),
    adminToken: str("ADMIN_TOKEN"),

    anthropicModel: str("CLAUDE_MODEL", "claude-opus-5-5"),
    claudeModelMid: str("CLAUDE_MODEL_MID", "claude-sonnet-5-5"),
    claudeModelLow: str("CLAUDE_MODEL_LOW", "claude-haiku-5-5"),
    codexLlm: bool("CODEX_LLM", false),
    codexCalls: str("CODEX_CALLS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    codexVision: bool("CODEX_VISION", false),
    visionPaidFallback: bool("VISION_PAID_FALLBACK", false),
    codexTimeoutMinutes: int("CODEX_TIMEOUT_MINUTES", 20),
    codexPython: str("CODEX_PYTHON", defaultCodexPython(process.platform)),
    codexRunnerDir: str(
      "CODEX_RUNNER_DIR",
      defaultCodexRunnerDir(process.platform, os.homedir()),
    ),
    voiceProvider: str("VOICE_PROVIDER", "auto") as VoiceProvider,
    localTtsUrl: str("LOCAL_TTS_URL", "http://127.0.0.1:8765").replace(
      /\/$/,
      "",
    ),
    localVoiceId: str("LOCAL_TTS_VOICE_ID", "TX3LPaxmHKxFdv7VOQHJ"),
    localSpeakingRate: Number(str("LOCAL_TTS_SPEAKING_RATE", "1.0")),
    // The PC's start.bat means nothing on the Mac, which reaches the PC's Liam over the LAN instead.
    localTtsStart: usablePath(str("LOCAL_TTS_START"), process.platform),
    syntheticMedia: bool("SYNTHETIC_MEDIA_DISCLOSURE", true),
    elevenLabsApiKey: str("ELEVENLABS_API_KEY"),
    elevenLabsVoiceId: str("ELEVENLABS_VOICE_ID", "TX3LPaxmHKxFdv7VOQHJ"),
    elevenLabsModel: str("ELEVENLABS_MODEL", "eleven_multilingual_v2"),
    // "id:Name,id:Name,..."; names are for the Discord card and the analytics join.
    voicePool: str("ELEVENLABS_VOICE_POOL")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => {
        const [id, ...name] = v.split(":");
        return { id: id!.trim(), name: name.join(":").trim() || id!.trim() };
      }),
    voiceRotation: Math.max(1, int("VOICE_ROTATION", 2)),

    discordWebhookUrl: str("DISCORD_WEBHOOK_URL"),
    discordTiktokWebhookUrl: str("DISCORD_TIKTOK_WEBHOOK_URL"),
    healthcheckPingUrl: str("HEALTHCHECK_PING_URL"),

    legacyTokenDir: str("PULSE_TOKEN_DIR"),
    googleClientId: str("GOOGLE_CLIENT_ID", str("YOUTUBE_CLIENT_ID")),
    googleClientSecret: str(
      "GOOGLE_CLIENT_SECRET",
      str("YOUTUBE_CLIENT_SECRET"),
    ),
    youtubeRefreshToken: str("YOUTUBE_REFRESH_TOKEN"),
    youtubePrivacy,
    youtubeVetoMinutes: int("YOUTUBE_VETO_MINUTES", 0),

    dailyTarget: int("SHORTS_PER_DAY", int("DAILY_TARGET", 3)),
    timezone: str("TIMEZONE", "Europe/London"),
    newsSlots: newsSlotsFor(
      str("NEWS_SLOTS", "13:00,17:00,22:00")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => /^\d\d:\d\d$/.test(t))
      .sort(),
      bool("NEWS_LATE_SLOT_ENABLED", true),
    ),
    slotLeadMinutes: int("SLOT_LEAD_MINUTES", 75),
    slotGraceMinutes: int("SLOT_GRACE_MINUTES", 30),
    maxProducing: int("MAX_PRODUCING", 2),
    minUploadGapMinutes: int("MIN_UPLOAD_GAP_MINUTES", 60),
    discoverMinutes: int("DISCOVER_MINUTES", 3),
    breakingEnabled: bool("BREAKING_ENABLED", true),
    // One a day (owner, 1 Nov 2026); a second only at BREAKING_BIG_SCORE or above.
    breakingPerDay: int("BREAKING_PER_DAY", 1),
    breakingScoreMin: int("BREAKING_SCORE_MIN", 75),
    breakingMaxAgeMinutes: int("BREAKING_MAX_AGE_MINUTES", 90),
    breakingCooldownHours: int("BREAKING_COOLDOWN_HOURS", 2),
    sprintExtra: int("SPRINT_EXTRA", 3),
    sprintScoreMin: int("SPRINT_SCORE_MIN", 60),
    breakingApprovalMinutes: int("BREAKING_APPROVAL_MINUTES", 20),
    breakingWindow: str("BREAKING_WINDOW", "07:00-03:00"),
    quotaUnitsPerDay: int("QUOTA_UNITS_PER_DAY", 10000),
    uploadCallsPerDay: int("UPLOAD_CALLS_PER_DAY", 100),
    searchCallsPerDay: int("SEARCH_CALLS_PER_DAY", 100),
    evergreenEnabled: bool("EVERGREEN_ENABLED", true),
    evergreenDays: str("EVERGREEN_DAYS", "tue,sat")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    evergreenSlot: str("EVERGREEN_SLOT", "20:00"),
    focusTopic: str("FOCUS_TOPIC", ""),
    focusUntil: str("FOCUS_UNTIL", ""),
    focusNote: str("FOCUS_NOTE", ""),
    calendarFile: str("CALENDAR_FILE", "calendar.md"),
    searchGapsFile: str("SEARCH_GAPS_FILE", "search_gaps.md"),
    deskVoiceId: str("DESK_VOICE_ID", ""),
    deskVoiceName: str("DESK_VOICE_NAME", "Alice"),
    deskShare: Math.max(0, Math.min(1, Number(str("DESK_SHARE", "0.5")))),
    narratorTestVoiceId: str("NARRATOR_TEST_VOICE_ID", ""),
    narratorTestVoiceName: str("NARRATOR_TEST_VOICE_NAME", "Alice"),
    narratorTestShare: Math.max(
      0,
      Math.min(1, Number(str("NARRATOR_TEST_SHARE", "0.5"))),
    ),
    shortSuiteShare: Math.max(
      0,
      Math.min(1, Number(str("SHORT_SUITE_SHARE", "0.5"))),
    ),
    mascotShare: Math.max(0, Math.min(1, Number(str("MASCOT_SHARE", "0")))),
    experimentVerdictDate: str("EXPERIMENT_VERDICT_DATE", "2026-11-08"),
    growthTests: bool("GROWTH_TESTS", true),
    shortsPerDayMax: Math.max(0, int("SHORTS_PER_DAY_MAX", 0)),
    shortMediaRichTarget: Math.max(
      0,
      Math.min(1, Number(str("SHORT_MEDIA_RICH_TARGET", "0.85")) || 0.85),
    ),
    narratorName: str("NARRATOR_NAME", "Liam"),
    focusMatch: str("FOCUS_MATCH", ""),
    focusPlaylist: str("FOCUS_PLAYLIST", ""),
    waveFrom: str("LAUNCH_WAVE_FROM", ""),
    waveTo: str("LAUNCH_WAVE_TO", ""),
    whyEnabled: bool("WHY_ENABLED", true),
    whyDays: str("WHY_DAYS", "mon,tue,wed,thu,fri,sat,sun")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    // Story-first mix (owner, 1 Nov 2026): two Why Shorts a day by default. WHY_SLOTS wins; an older
    // WHY_SLOT alone still means that one slot.
    whySlot: whySlotsFrom(str("WHY_SLOTS"), str("WHY_SLOT"))[0]!,
    whySlots: whySlotsFrom(str("WHY_SLOTS"), str("WHY_SLOT")),
    whyFreshDays: Math.max(0, int("WHY_FRESH_DAYS", 14)),
    whySerialEnabled: bool("WHY_SERIAL_ENABLED", false),
    whyTargetSeconds: parseBand(str("WHY_TARGET_SECONDS", "45-60")),
    whyHomeShare: Math.min(1, Math.max(0, Number(str("WHY_HOME_SHARE", "0")) || 0)),
    whyHomeFranchises: parseHomeFranchises(
      str("WHY_HOME_FRANCHISES", "Grand Theft Auto|Resident Evil"),
    ),
    seriesGtaFileEnabled: bool("SERIES_GTA_FILE_ENABLED", false),
    seriesGtaFileSlot: str("SERIES_GTA_FILE_SLOT", "18:30"),
    seriesGtaFileRunFile: str("SERIES_GTA_FILE_RUN_FILE", ""),
    shortLengths: parseShortLengths(str("SHORT_LENGTHS", "")),
    instagramMaxSeconds: Math.max(0, int("INSTAGRAM_MAX_SECONDS", 0)),
    breakingBigScore: Math.max(0, int("BREAKING_BIG_SCORE", 95)),
    bigStoryMode: (["off", "report", "make"] as const).find(
      (m) => m === str("BIG_STORY_MODE", "report"),
    ) ?? "report",
    bigStorySize: Math.max(1, int("BIG_STORY_SIZE", 70)),
    bigStoryHuge: Math.max(1, int("BIG_STORY_HUGE", 90)),
    bigStoryMaxAgeHours: Math.max(1, int("BIG_STORY_MAX_AGE_HOURS", 36)),
    bigStoryPerDay: Math.max(0, int("BIG_STORY_PER_DAY", 3)),
    bigStoryBumps: str("BIG_STORY_BUMPS", "deals,spare,evergreen,why")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    bigStoryRetryHours: Math.max(0, int("BIG_STORY_RETRY_HOURS", 6)),
    dailyTargetShortsOnly: bool("DAILY_TARGET_SHORTS_ONLY", true),
    launchCalendarFile: str("LAUNCH_CALENDAR_FILE", ""),
    chatterSources: str("CHATTER_SOURCES", "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    claudeMonthlyCredit: Math.max(0, Number(str("CLAUDE_MONTHLY_CREDIT", "100")) || 0),
    claudeCreditRenewDay: Math.max(1, int("CLAUDE_CREDIT_RENEW_DAY", 1)),
    claudeCreditWarnDays: Math.max(1, int("CLAUDE_CREDIT_WARN_DAYS", 10)),
    demandCheck: bool("DEMAND_CHECK", true),
    demandMinViews: Math.max(0, int("DEMAND_MIN_VIEWS", 20000)),
    demandLookups: Math.max(0, int("DEMAND_LOOKUPS", 12)),
    repeatMax: Math.max(0, int("REPEAT_MAX", 3)),
    // Off: with uploads on their own bucket of 100 a day there is no use-it-or-lose-it quota to spend.
    spareUploads: bool("SPARE_UPLOADS", false),
    spareSlots: str("SPARE_SLOTS", "19:00,15:00,11:00")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    evergreenApprovalMode: str(
      "EVERGREEN_APPROVAL_MODE",
      "manual",
    ) as ApprovalMode,
    evergreenApprovalMinutes: int("EVERGREEN_APPROVAL_MINUTES", 120),
    evergreenMaxSeconds: int("EVERGREEN_MAX_SECONDS", 95),
    longformEnabled: bool("LONGFORM_ENABLED", true),
    cutdownsEnabled: bool("CUTDOWNS_ENABLED", false), // on once a sandbox run has been checked
    cutdownSlot: str("CUTDOWN_SLOT", "15:30"),
    cutdownsPerLong: int("CUTDOWNS_PER_LONG", 3),
    macWorkerHost: str("MAC_WORKER_HOST", "pulse-mac"),
    macMinFreeGb: int("MAC_MIN_FREE_GB", 40),
    macWaitMinutes: int("MAC_WAIT_MINUTES", 10),
    macRenderConcurrency: int("MAC_RENDER_CONCURRENCY", 6),
    macAsr: bool("MAC_ASR", false),
    macRenderShorts: bool("MAC_RENDER_SHORTS", false),
    macFootageGather: bool("MAC_FOOTAGE_GATHER", false),
    macStills: bool("MAC_STILLS", false),
    macGameplay: bool("MAC_GAMEPLAY", false),
    macVision: macVisionMode(str("MAC_VISION", "off")),
    appleAesthetics: bool("APPLE_AESTHETICS", false),
    appleSoundTags: bool("APPLE_SOUND_TAGS", false),
    routineLanAllow: str("ROUTINE_LAN_ALLOW", "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    routineLanPort: int("ROUTINE_LAN_PORT", 8081),
    routineFilesTo: routineFilesTo(str("ROUTINE_FILES_TO", ""), process.platform),
    routinePcDir: str("ROUTINE_PC_DIR", "C:\\PulseFactory\\routine-files"),
    elevenLabsLowCredits: int("ELEVENLABS_LOW_CREDITS", 100_000),
    elevenLabsLowDays: int("ELEVENLABS_LOW_DAYS", 5),
    // A dry run (every sandbox and rehearsal) leaves the owner's real inbox alone unless it asks otherwise: 4 Nov
    // 2026, a sandbox Short took clips out of the live inbox because nothing told it not to.
    gameplayEnabled: bool("GAMEPLAY_ENABLED", !bool("DRY_RUN", false)),
    gameplayRoot: str(
      "GAMEPLAY_ROOT",
      path.join(os.homedir(), "Videos", "Pulse Gameplay"),
    ),
    gameplayExperiments: str(
      "GAMEPLAY_EXPERIMENTS",
      path.join(
        os.homedir(),
        "gaming-studio",
        "pulse-gaming",
        "docs",
        "GTA6_EXPERIMENT_SHORTS.md",
      ),
    ),
    // US evening (16:00 and 18:30 Eastern), clear of the news, deals, evergreen and long-form slots.
    gameplaySlots: str("GAMEPLAY_SLOTS", "21:00,23:30")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => /^\d\d:\d\d$/.test(t))
      .sort(),
    gameplayReviewsPerDay: int("GAMEPLAY_REVIEWS_PER_DAY", 30),
    gameplayMinScore: int("GAMEPLAY_MIN_SCORE", 7),
    gameplayMinScoreOwn: int(
      "GAMEPLAY_MIN_SCORE_OWN",
      int("GAMEPLAY_MIN_SCORE", 7),
    ),
    gameplayApprovalHours: Math.min(70, int("GAMEPLAY_APPROVAL_HOURS", 48)),
    keepFreeWindows: str("KEEP_FREE_WINDOWS", ""),
    gameplayRemindHours: int("GAMEPLAY_REMIND_HOURS", 12),
    gameplayDirect: bool("GAMEPLAY_DIRECT", false),
    gameplayOneTap: bool("GAMEPLAY_ONE_TAP", false),
    gameplayRehearsalUntil: str("GAMEPLAY_REHEARSAL_UNTIL", ""),
    shortRunFile: str("SHORT_RUN_FILE", ""),
    everyGameEnabled: bool("EVERYGAME_ENABLED", false),
    everyGameFile: str("EVERYGAME_FILE", ""),
    runPremakeHours: Math.max(0, int("RUN_PREMAKE_HOURS", 0)),
    runPremakeUploadHours: Math.max(0, int("RUN_PREMAKE_UPLOAD_HOURS", 2)),
    runSpareSlots: str("RUN_SPARE_SLOTS", "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    runSpareMinutes: Math.max(16, int("RUN_SPARE_MINUTES", 45)),
    uploadRetryMinutes: Math.max(1, int("UPLOAD_RETRY_MINUTES", 10)),
    uploadMoves: Math.max(0, int("UPLOAD_MOVES", 1)),
    breakingBumpScore: Math.max(0, int("BREAKING_BUMP_SCORE", int("BREAKING_BIG_SCORE", 95))),
    visionHold: bool("VISION_HOLD", true),
    leonidaLink: bool("LEONIDA_LINK", true),
    runDocPrivateHours: Math.max(0, int("RUN_DOC_PRIVATE_HOURS", 2)),
    longStockNotOnPeople: bool("LONG_STOCK_NOT_ON_PEOPLE", true),
    codeScenes: bool("CODE_SCENES", false),
    shortPlateMax: Number(str("SHORT_PLATE_MAX", "0.10")) || 0.1,
    shortPlateMaxBig: Number(str("SHORT_PLATE_MAX_BIG", "0.35")) || 0.35,
    shortPlateFirstSeconds: Math.max(0, int("SHORT_PLATE_FIRST_SECONDS", 5)),
    shortFootageFirst: bool("SHORT_FOOTAGE_FIRST", true),
    shortFootageShare: Math.max(0, Math.min(85, int("SHORT_FOOTAGE_SHARE", 65))),
    shortClipTextCheck: bool("SHORT_CLIP_TEXT_CHECK", true),
    shortStakeFirst: bool("SHORT_STAKE_FIRST", true),
    shortRefuseThin: bool("SHORT_REFUSE_THIN", true),
    sourceMinChars: Math.max(0, int("SOURCE_MIN_CHARS", 600)),
    shortEndPayoff: bool("SHORT_END_PAYOFF", true),
    shortTightScript: bool("SHORT_TIGHT_SCRIPT", false),
    shortArgumentShare: Math.max(
      0,
      Math.min(1, Number(str("SHORT_ARGUMENT_SHARE", "0.5"))),
    ),
    shortMinWpm: Math.max(0, int("SHORT_MIN_WPM", 0)),
    shortCappedStills: Math.max(0, int("SHORT_CAPPED_STILLS", 6)),
    shortMediaBeforeVoice: bool("SHORT_MEDIA_BEFORE_VOICE", true),
    shortGatherMaxMinutes: Math.max(1, int("SHORT_GATHER_MAX_MINUTES", 25)),
    shortEraMatch: bool("SHORT_ERA_MATCH", true),
    shortBright: bool("SHORT_BRIGHT", true),
    shortLabelsClean: bool("SHORT_LABELS_CLEAN", true),
    planSlateMax: Number(str("PLAN_SLATE_MAX", "0.08")) || 0.08,
    releaseGateMaxSlate: Number(str("RELEASE_GATE_MAX_SLATE", "0.08")) || 0.08,
    releaseGateMinFootage: Number(str("RELEASE_GATE_MIN_FOOTAGE", "0.1")) || 0.1,
    releaseGateMinFootageRanking: Number(str("RELEASE_GATE_MIN_FOOTAGE_RANKING", "0.05")) || 0.05,
    writerNotesGuard: bool("WRITER_NOTES_GUARD", true),
    docTestEvidence: bool("DOC_TEST_EVIDENCE", false),
    shortSkeletons: bool("SHORT_SKELETONS", false),
    shortArguesCheck: bool("SHORT_ARGUES_CHECK", false),
    dropAngle: bool("DROP_ANGLE", false),
    dropAngleHours: Math.max(1, Number(str("DROP_ANGLE_HOURS", "12")) || 12),
    commentReplies: bool("COMMENT_REPLIES", true),
    openOnMotion: bool("OPEN_ON_MOTION", true),
    shortOpenFootage: bool("SHORT_OPEN_FOOTAGE", false),
    weeklyEnabled: bool("WEEKLY_ENABLED", true),
    radarDays: str("RADAR_DAYS", "mon")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    freeDays: str("FREE_DAYS", "thu")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    recapLong: bool("RECAP_LONG", false), // on once a sandbox run has been checked
    // The owner-approved test (1 Nov 2026): the weekly long video takes turns between the round-up and the week's
    // biggest story explained (src/weeklytest.ts). Needs RECAP_LONG and LONGFORM_ENABLED; false = round-up only.
    weeklyExplainedTest: bool("WEEKLY_EXPLAINED_TEST", true),
    // A 15-20 minute explainer takes longer to gather and render than a round-up; both arms start this early so
    // the test stays fair (the round-up on its own starts 300 minutes ahead).
    weeklyExplainedLeadMinutes: int("WEEKLY_EXPLAINED_LEAD_MINUTES", 480),
    recapDays: str("RECAP_DAYS", "fri")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    climbersDays: str("CLIMBERS_DAYS", "sun")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    dealsDays: str("DEALS_DAYS", "")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    dealsSlot: str("DEALS_SLOT", "16:30"),
    achievementDays: str("ACHIEVEMENT_DAYS", "wed")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    weeklySlot: str("WEEKLY_SLOT", "20:00"),
    longformDays: str("LONGFORM_DAYS", "sun")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    longformSlot: str("LONGFORM_SLOT", "19:00"),
    longformSkip: str("LONGFORM_SKIP", "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    longformApprovalMode: str("LONGFORM_APPROVAL_MODE", "auto") as ApprovalMode,
    longformApprovalMinutes: int("LONGFORM_APPROVAL_MINUTES", 180),
    longformMaxSeconds: int("LONGFORM_MAX_SECONDS", 1560), // 3,200 words at a natural pace, with room
    longformClipsPerEntry: int("LONGFORM_CLIPS_PER_ENTRY", 2),
    docEnabled: bool("DOC_ENABLED", true),
    elevenLabsMonthlyCredits: int("ELEVENLABS_MONTHLY_CREDITS", 500_000),
    elevenLabsReserve: int("ELEVENLABS_RESERVE", 10_000),
    surplusDocDays: str("SURPLUS_DOC_DAYS", "tue,thu,sat")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    surplusDocChars: int("SURPLUS_DOC_CHARS", 35_000),
    bankWindow: str("BANK_WINDOW", "23:45-03:00"),
    docDays: str("DOC_DAYS", "sat")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    docSlot: str("DOC_SLOT", "19:00"),
    docWeeks: str("DOC_WEEKS", "1")
      .split(",")
      .map((w) => Number(w.trim()))
      .filter((w) => w >= 1 && w <= 5),
    docLeadMinutes: int("DOC_LEAD_MINUTES", 600),
    longLeadMinutes: int("LONG_LEAD_MINUTES", 30 * 60),
    minWordsPerMinute: int("MIN_WORDS_PER_MINUTE", 145),
    bufferApiKey: str("BUFFER_API_KEY", ""),
    bufferTiktokChannel: str("BUFFER_TIKTOK_CHANNEL", ""),
    voiceTestShare: Math.min(1, Math.max(0, Number(str("VOICE_TEST_SHARE", "0")) || 0)),
    shortSpeed: Math.min(1.25, Math.max(1, Number(str("SHORT_SPEED", "1")) || 1)),
    voiceTakeCheck: bool("VOICE_TAKE_CHECK", true),
    // Not a number keeps the default rather than 0, the most erratic delivery.
    voiceStability: ((n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5))(Number(str("VOICE_STABILITY", "0.5"))),
    voiceTags: voiceTagsSetting(),
    voiceMicChain: bool("VOICE_MIC_CHAIN", true),
    docMaxSeconds: int("DOC_MAX_SECONDS", 3000),
    docClipsPerChapter: int("DOC_CLIPS_PER_CHAPTER", 4),
    docSoundBeats: bool("DOC_SOUND_BEATS", true),
    docEndCard: bool("DOC_END_CARD", true),
    thumbMotifRepair: bool("THUMB_MOTIF_REPAIR", true),
    thumbHeroRule: bool("THUMB_HERO_RULE", true),
    docColdOpen: bool("DOC_COLD_OPEN", true),
    docTitleDrop: bool("DOC_TITLE_DROP", true),
    docOpenLoops: bool("DOC_OPEN_LOOPS", true),
    docBookendEnding: bool("DOC_BOOKEND_ENDING", true),
    docChapterIndex: bool("DOC_CHAPTER_INDEX", true),
    seriesPlaylists: bool("SERIES_PLAYLISTS", false),
    sequelWinners: bool("SEQUEL_WINNERS", false),
    newsSegment: bool("NEWS_SEGMENT", false),
    newsSegmentSeries: bool("NEWS_SEGMENT_SERIES", false),
    seriesNextLine: bool("SERIES_NEXT_LINE", false),
    rumourShare: rumourShareFrom(str("RUMOUR_SHARE", "1")),
    shortMinSeconds: Math.max(0, int("SHORT_MIN_SECONDS", 0)),
    newsLateSlotEnabled: bool("NEWS_LATE_SLOT_ENABLED", true),
    breakingHomeOnly: bool("BREAKING_HOME_ONLY", false),
    homeShelf: parseHomeShelf(str("HOME_SHELF", "GTA|Grand Theft Auto|Resident Evil")),
    seriesCoverStyle: str("SERIES_COVER_STYLE", "off").toLowerCase() === "strip" ? "strip" : "off",
    seriesEpisodeNumbers: bool("SERIES_EPISODE_NUMBERS", false),
    seriesVerdictEnabled: bool("SERIES_VERDICT_ENABLED", false),
    seriesVerdictDays: str("SERIES_VERDICT_DAYS", "tue,thu,sat")
      .toLowerCase()
      .split(",")
      .map((d) => d.trim().slice(0, 3))
      .filter(Boolean),
    seriesChannelPage: bool("SERIES_CHANNEL_PAGE", false),
    seriesFeaturedVideo: str("SERIES_FEATURED_VIDEO", "").trim(),
    friendPass: friendPassFrom(process.env.FRIEND_PASS),
    friendPassTier: str("FRIEND_PASS_TIER", "top") === "mid" ? "mid" : "top",
    hypeAsk: bool("HYPE_ASK", false),
    growthReport: bool("GROWTH_REPORT", false),
    reachReport: bool("REACH_REPORT", false),
    analyticsLoop: bool("ANALYTICS_LOOP", false),
    analyticsLoopLessons: bool("ANALYTICS_LOOP_LESSONS", false),
    analyticsLoopPosting: bool("ANALYTICS_LOOP_POSTING", false),
    analyticsLoopScoring: bool("ANALYTICS_LOOP_SCORING", false),
    shortSearchThumbShare: Number(str("SHORT_SEARCH_THUMB_SHARE", "0")) || 0,
    searchTerms: bool("SEARCH_TERMS", false),
    abQueueClean: bool("AB_QUEUE_CLEAN", false),
    alertLedger: bool("ALERT_LEDGER", false),
    alertDigest: bool("ALERT_DIGEST", false),
    docBreakoutPicker: bool("DOC_BREAKOUT_PICKER", true),
    docPickLookups: int("DOC_PICK_LOOKUPS", 8),
    docPickSingleSubject: bool("DOC_PICK_SINGLE_SUBJECT", false),
    filmSlateFile: str("FILM_SLATE_FILE", ""),
    docEvidence: bool("DOC_EVIDENCE", true),
    titleShapes: bool("TITLE_SHAPES", true),
    titleAngles: bool("TITLE_ANGLES", true),
    titleShapeAllow: str("TITLE_SHAPE_ALLOW", "")
      .toLowerCase()
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    docCutRhythm: bool("DOC_CUT_RHYTHM", true),
    docPinMoment: bool("DOC_PIN_MOMENT", true),
    communityDrafts: bool("COMMUNITY_DRAFTS", true),
    crosspost: {
      facebook: bool("CROSSPOST_FACEBOOK", true),
      instagram: bool("CROSSPOST_INSTAGRAM", true),
      tiktok: bool("CROSSPOST_TIKTOK", true),
      x: bool("CROSSPOST_X", true),
      threads: bool("CROSSPOST_THREADS", true),
      bluesky: bool("CROSSPOST_BLUESKY", true),
    },
    crosspostDelays: {
      x: int("CROSSPOST_X_DELAY", 5),
      facebook: int("CROSSPOST_FACEBOOK_DELAY", 30),
      instagram: int("CROSSPOST_INSTAGRAM_DELAY", 60),
      tiktok: int("CROSSPOST_TIKTOK_DELAY", 90),
      threads: int("CROSSPOST_THREADS_DELAY", 45),
      bluesky: int("CROSSPOST_BLUESKY_DELAY", 20),
    },
    threadsLoginPath: str(
      "THREADS_LOGIN_PATH",
      path.join(tokenDir, "threads.json"),
    ),
    threadsAppId: str("THREADS_APP_ID"),
    threadsAppSecret: str("THREADS_APP_SECRET"),
    blueskyLoginPath: str(
      "BLUESKY_LOGIN_PATH",
      path.join(tokenDir, "bluesky.json"),
    ),
    crosspostWindowHours: int("CROSSPOST_WINDOW_HOURS", 36),
    tiktokDaily: int("TIKTOK_DAILY", 0),
    tiktokFromHour: int("TIKTOK_FROM_HOUR", 16),
    tiktokGapMinutes: int("TIKTOK_GAP_MINUTES", 0),
    instagramDaily: int("INSTAGRAM_DAILY", 0),
    facebookDaily: int("FACEBOOK_DAILY", 0),
    threadsDaily: int("THREADS_DAILY", 0),
    instagramGapMinutes: int("INSTAGRAM_GAP_MINUTES", 0),
    facebookGapMinutes: int("FACEBOOK_GAP_MINUTES", 0),
    threadsGapMinutes: int("THREADS_GAP_MINUTES", 0),
    engageEnabled: bool("ENGAGE_ENABLED", true),
    engageInstagram: bool("ENGAGE_INSTAGRAM", false),
    engageSlot: str("ENGAGE_SLOT", "15:00"),
    firstCommentQuestion: bool("FIRST_COMMENT_QUESTION", false),
    firstCommentCheck: bool("FIRST_COMMENT_CHECK", false),
    replyStyle: bool("REPLY_STYLE", false),
    replyFollowups: bool("REPLY_FOLLOWUPS", false),
    metaCommentReplies: bool("META_COMMENT_REPLIES", false),
    communityEngine: bool("COMMUNITY_ENGINE", false),
    communityRepliesPerDay: int("COMMUNITY_REPLIES_PER_DAY", 20),
    communityRepliesPerPass: int("COMMUNITY_REPLIES_PER_PASS", 4),
    socialScoreboard: bool("SOCIAL_SCOREBOARD", false),
    engageRetry: bool("ENGAGE_RETRY", false),
    requestsFromShorts: bool("REQUESTS_FROM_SHORTS", false),
    launchCommunityPosts: bool("LAUNCH_COMMUNITY_POSTS", false),
    metaLoginPath: str("META_LOGIN_PATH", path.join(tokenDir, "meta.json")),
    facebookLoginConfigId: str("FACEBOOK_LOGIN_CONFIG_ID"),
    facebookLinkComment: bool("FACEBOOK_LINK_COMMENT", true),
    facebookAppId: str("FACEBOOK_APP_ID"),
    facebookAppSecret: str("FACEBOOK_APP_SECRET"),
    facebookPageId: str("FACEBOOK_PAGE_ID"),
    facebookPageToken: str("FACEBOOK_PAGE_TOKEN"),
    instagramAccountId: str("INSTAGRAM_BUSINESS_ACCOUNT_ID"),
    instagramToken: str("INSTAGRAM_ACCESS_TOKEN"),
    tiktokClientKey: str("TIKTOK_CLIENT_KEY"),
    tiktokClientSecret: str("TIKTOK_CLIENT_SECRET"),
    tiktokTokenPath,
    // Off by default: every Short posted through the automated browser from 19 Oct got 0 views (no For You
    // distribution), while drafts the owner posts from the app reached 939 views a week.
    tiktokBrowser: bool("TIKTOK_BROWSER", false),
    twitchClientId: str("TWITCH_CLIENT_ID"),
    twitchClientSecret: str("TWITCH_CLIENT_SECRET"),
    xKeys: {
      consumerKey: str("TWITTER_API_KEY"),
      consumerSecret: str("TWITTER_API_SECRET"),
      token: str("TWITTER_ACCESS_TOKEN"),
      tokenSecret: str("TWITTER_ACCESS_SECRET"),
    },
    selectFromHourUtc: int("SELECT_FROM_HOUR_UTC", 9),
    minGapHours: int("MIN_GAP_HOURS", 4),
    tickMinutes: int("TICK_MINUTES", 10),
    maxStoryAgeHours: int("MAX_STORY_AGE_HOURS", 24),
    includeRumours: bool("INCLUDE_RUMOURS", false),
    rumoursPerDay: int("RUMOURS_PER_DAY", 1),
    hitMultiple: Number(str("HIT_MULTIPLE", "6")) || 6,
    hitMinPerHour: int("HIT_MIN_PER_HOUR", 40),
    hitHours: int("HIT_HOURS", 72),
    approvalMode,
    approvalTimeoutMinutes: int("APPROVAL_TIMEOUT_MINUTES", 60),
    publishWindowStartUtc: int("PUBLISH_WINDOW_START_UTC", 7),
    publishWindowEndUtc: int("PUBLISH_WINDOW_END_UTC", 22),
    visionQa: bool("VISION_QA", true),
    shortWordLooks: bool("SHORT_WORD_LOOKS", true),
    shortCraftCards: bool("SHORT_CRAFT_CARDS", true),
    shortCraftPhotos: bool("SHORT_CRAFT_PHOTOS", true),
    shortCraftFillers: bool("SHORT_CRAFT_FILLERS", true),
    shortCraftCamera: bool("SHORT_CRAFT_CAMERA", true),
    shortsClean: bool("SHORTS_CLEAN", true),
    graphicsPrepass: bool("GRAPHICS_PREPASS", true),
    graphicsFit: bool("GRAPHICS_FIT", true),
    graphicsSecondLook: bool("GRAPHICS_SECOND_LOOK", false),
    graphicsAudit: graphicsAuditMode(process.env.GRAPHICS_AUDIT),
    graphicsFrameCheck: bool("GRAPHICS_FRAME_CHECK", false),
    graphicsPrepassMax: int("GRAPHICS_PREPASS_MAX", 200),
    graphicsRerenderPasses: int("GRAPHICS_RERENDER_PASSES", 1),
    graphicsPostcheckMax: int("GRAPHICS_POSTCHECK_MAX", 32),
    releaseGate: bool("RELEASE_GATE", true),
    releaseGateMinMean: Number(str("RELEASE_GATE_MIN_MEAN", "2.0")) || 2.0,
    releaseGateMaxZero: Math.max(
      0,
      Math.min(1, Number(str("RELEASE_GATE_MAX_ZERO", "0.03")) || 0.03),
    ),
    reloadMinutesBeforeSlot: int("RELOAD_MINUTES_BEFORE_SLOT", 30),
    gatherMaxMinutes: int("GATHER_MAX_MINUTES", 45),
    downloadTimeoutSeconds: int("DOWNLOAD_TIMEOUT_SECONDS", 300),
    longTickStallMinutes: int("LONG_TICK_STALL_MINUTES", 150),
    localizeLanguages: str("LOCALIZE_LANGUAGES", "es,pt,de,fr,ja")
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
    whisperPython: str("WHISPER_PYTHON", defaultWhisperPython()),
    parallaxPython: str("PARALLAX_PYTHON", defaultParallaxPython()),
    backupDir: str(
      "BACKUP_DIR",
      defaultBackupDir(process.platform, os.homedir()),
    ),
    footage: bool("TRAILER_FOOTAGE", true),
    maxClips: int("MAX_TRAILER_CLIPS", 8), // enough for the hook, four beats, the take and the loop
    clipRanking: (str("CLIP_RANKING", "llm") === "rule" ? "rule" : "llm") as
      "llm" | "rule",
    officialTrailers: bool("OFFICIAL_TRAILERS", true),
    cutsceneFootage: bool("CUTSCENE_FOOTAGE", false),
    // Off unless asked for: the Mac runs CUTSCENE_FOOTAGE=true, and the scene search must not switch on with it unreviewed.
    cutsceneScenes: bool("CUTSCENE_SCENES", false),
    sceneMatch: bool("SCENE_MATCH", false),
    cutsceneQuotes: bool("CUTSCENE_QUOTES", false),
    cutsceneMaxSeconds: Math.max(0, int("CUTSCENE_MAX_SECONDS", 20)),
    sceneIndex: bool("SCENE_INDEX", false),
    sceneIndexProxyHeight: Math.min(1080, Math.max(240, int("SCENE_INDEX_PROXY_HEIGHT", 480))),
    sceneIndexOcrFps: Math.min(5, Math.max(0.5, Number(str("SCENE_INDEX_OCR_FPS", "2")) || 2)),
    sceneIndexChunkMinutes: Math.max(1, int("SCENE_INDEX_CHUNK_MINUTES", 10)),
    sceneIndexMaxHours: Math.max(1, int("SCENE_INDEX_MAX_HOURS", 12)),
    sceneIndexTurnSteps: Math.max(1, int("SCENE_INDEX_TURN_STEPS", 3)),
    sceneIndexMinConfidence: Math.min(1, Math.max(0, Number(str("SCENE_INDEX_MIN_CONFIDENCE", "0.45")) || 0.45)),
    gameFetch: bool("GAME_FETCH", false),
    gameFetchTitles: str("GAME_FETCH_TITLES", ""),
    gameFetchSignals: str("GAME_FETCH_SIGNALS", ""),
    gameFetchHours: Math.max(1, int("GAME_FETCH_HOURS", 3)),
    gameFetchRecheckHours: Math.max(6, int("GAME_FETCH_RECHECK_HOURS", 24)),
    gameFetchRecheckDays: Math.max(1, int("GAME_FETCH_RECHECK_DAYS", 28)),
    spoilerGuard: bool("SPOILER_GUARD", false),
    streamAsks: streamAsksSettings(process.env),
    liveClips: liveClipsSettings(process.env),
    spoilerWindowDays: Math.max(0, int("SPOILER_WINDOW_DAYS", 28)),
    spoilerOpeningShare: Math.min(0.5, Math.max(0.02, Number(str("SPOILER_OPENING_SHARE", "0.1")) || 0.1)),
    characterQuotes: bool("CHARACTER_QUOTES", false),
    characterQuotesLong: Math.max(0, int("CHARACTER_QUOTES_LONG", 3)),
    characterQuotesShort: Math.min(2, Math.max(1, int("CHARACTER_QUOTES_SHORT", 1))),
    gameAudioBed: bool("GAME_AUDIO_BED", false),
    gameAudioShare: Math.min(1, Math.max(0, Number(str("GAME_AUDIO_SHARE", "0.5")) || 0)),
    gameAudioUnderLufs: Math.min(-18, Math.max(-50, Number(str("GAME_AUDIO_UNDER_LUFS", "-30")) || -30)),
    gameAudioGapLufs: Math.min(-16, Math.max(-50, Number(str("GAME_AUDIO_GAP_LUFS", "-24")) || -24)),
    gameAudioTrailers: bool("GAME_AUDIO_TRAILERS", false),
    gameAudioMusicDip: Math.min(1, Math.max(0, Number(str("GAME_AUDIO_MUSIC_DIP", "0.6")) || 0)),
  officialStillFrames: int("OFFICIAL_STILL_FRAMES", 0),
  shortVivid: bool("SHORT_VIVID", false),
  appleSmartCrop: bool("APPLE_SMART_CROP", false),
  appleSubjectLift: bool("APPLE_SUBJECT_LIFT", false),
  appleHwEncode: bool("APPLE_HW_ENCODE", false),
  docSandboxChapters: int("DOC_SANDBOX_CHAPTERS", 0),
    ytdlpPath: usablePath(str("YTDLP_PATH"), process.platform) || "yt-dlp",
    ownerGames: str("OWNER_GAMES", "Grand Theft Auto V, Grand Theft Auto VI")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean),
    captureChecklist: bool("CAPTURE_CHECKLIST", true),
    footageLibrary: str(
      "FOOTAGE_LIBRARY",
      path.join(process.env.USERPROFILE ?? "", "Videos"),
    ),
    pexelsApiKey: str("PEXELS_API_KEY"),
    libraryPress: bool("LIBRARY_PRESS", true),
    libraryOpenverse: bool("LIBRARY_OPENVERSE", true),
    libraryPixabay: bool("LIBRARY_PIXABAY", true),
    pixabayApiKey: str("PIXABAY_API_KEY"),
    libraryArchive: bool("LIBRARY_ARCHIVE", true),
    amazonUkTag: str("AMAZON_AFFILIATE_TAG"),
    amazonUsTag: str("AMAZON_US_TAG"),
    amazonMoreTags: {
      ca: str("AMAZON_CA_TAG") || undefined,
      de: str("AMAZON_DE_TAG") || undefined,
      fr: str("AMAZON_FR_TAG") || undefined,
      it: str("AMAZON_IT_TAG") || undefined,
      es: str("AMAZON_ES_TAG") || undefined,
      au: str("AMAZON_AU_TAG") || undefined,
    },
    oauthRedirectUri: str(
      "OAUTH_REDIRECT_URI",
      "http://localhost:8080/oauth/callback",
    ),
    youtubeChannelId: str("YOUTUBE_CHANNEL_ID", "UCvgNDjtTezrpxL8oUe6mYwA"),
    twinLanguage: str("TWIN_LANGUAGE", "").toLowerCase().slice(0, 2),
    twinChannelId: str("TWIN_YOUTUBE_CHANNEL_ID", ""),
    twinDelayMinutes: int("TWIN_DELAY_MINUTES", 30),
    musicBed: bool("MUSIC_BED", true),
    parallax: bool("PARALLAX", true),
    annotate: bool("ANNOTATE", true),
    realPhotosPinnedOnly: bool("REAL_PHOTOS_PINNED_ONLY", true),
    stockThemeMax: int("STOCK_THEME_MAX", 2),
    mediaKeepDays: Math.max(1, int("MEDIA_KEEP_DAYS", 14)),
    mediaMinFreeGb: Math.max(0, int("MEDIA_MIN_FREE_GB", 40)),
    mediaFloorDays: Math.max(0, int("MEDIA_FLOOR_DAYS", 2)),
    footageFirst: bool("FOOTAGE_FIRST", true),
    footageShareTarget: Math.max(
      0,
      Math.min(100, int("FOOTAGE_SHARE_TARGET", 60)),
    ),
    footageSources: Math.max(1, int("FOOTAGE_SOURCES", 6)),
    footagePullSeconds: Math.max(60, int("FOOTAGE_PULL_SECONDS", 240)),
    footageVisionMax: Math.max(12, int("FOOTAGE_VISION_MAX", 120)),
    footageFirstMaxMinutes: Math.max(0, int("FOOTAGE_FIRST_MAX_MINUTES", 40)),
    illustrate: bool("ILLUSTRATE_ENABLED", false),
    illustrateUrl: str("ILLUSTRATE_URL", "http://127.0.0.1:8188"),
    illustrateMax: int("ILLUSTRATE_MAX", 24),
    illustrateTimeoutSeconds: int("ILLUSTRATE_TIMEOUT_SECONDS", 180),
    illustrateStub: bool("ILLUSTRATE_STUB", false),
    illustrateVideo: bool("ILLUSTRATE_VIDEO_ENABLED", false),
    illustrateVideoMax: int("ILLUSTRATE_VIDEO_MAX", 6),
    illustrateVideoTimeoutSeconds: int("ILLUSTRATE_VIDEO_TIMEOUT_SECONDS", 600),
    illustrateVideoStub: bool("ILLUSTRATE_VIDEO_STUB", false),
    sketchAnimation: bool("SKETCH_ANIMATION", true),
    fillers: bool("FILLERS_ENABLED", true),
    photoTreatments: bool("PHOTO_TREATMENTS", true),
    longCamera: parseCameraSetting(
      process.env.LONG_CAMERA ?? process.env.DOC_CAMERA,
    ),
    longEntryPace: bool("LONG_ENTRY_PACE", true),
    longPunchyHook: bool("LONG_PUNCHY_HOOK", true),
    longYouPer1000: int("LONG_YOU_PER_1000", 0),
    guideYouPer1000: int("GUIDE_YOU_PER_1000", 35),
    docMetaGuard: bool("DOC_META_GUARD", false),
    longSentenceGate: int("LONG_SENTENCE_GATE", 0),
    longHookStack: int("LONG_HOOK_STACK", 0),
    longHookYouMin: int("LONG_HOOK_YOU_MIN", 0),
    longOpenLoopsMax: int("LONG_OPEN_LOOPS_MAX", 0),
    loopNamePayoff: bool("LOOP_NAME_PAYOFF", false),
    longVerdictStamps: bool("LONG_VERDICT_STAMPS", false),
    longGuideFormat: bool("LONG_GUIDE_FORMAT", false),
    guideChapterAction: bool("GUIDE_CHAPTER_ACTION", false),
    guideWeekly: bool("GUIDE_WEEKLY", false),
    guideWeeklyFile: str("GUIDE_WEEKLY_FILE", ""),
    guideOwnFirst: bool("GUIDE_OWN_FIRST", true),
    funnelTest: bool("FUNNEL_TEST", false),
    funnelShare: Math.min(1, Math.max(0, Number(str("FUNNEL_SHARE", "0.5")) || 0)),
    funnelShorts: Math.min(3, Math.max(0, int("FUNNEL_SHORTS", 3))),
    funnelDays: Math.max(1, int("FUNNEL_DAYS", 3)),
    funnelClearDays: Math.max(0, int("FUNNEL_CLEAR_DAYS", 60)),
    longSamePictureMaxSeconds: int("LONG_SAME_PICTURE_MAX_SECONDS", 0),
    longCardShare: Number(str("LONG_CARD_SHARE", "0")) || 0,
    longStillXfadeFrames: int("LONG_STILL_XFADE_FRAMES", 9),
    longMinWpm: int("LONG_MIN_WPM", 0),
    soundCraft: {
      jl: bool("SOUND_JL_CUTS", true),
      pockets: bool("SOUND_GAME_POCKETS", true),
      foley: bool("SOUND_FOLEY", true),
      risers: bool("SOUND_RISERS", true),
      buttons: bool("SOUND_CHAPTER_BUTTONS", true),
      phrase: bool("SOUND_PHRASE_EDITS", true),
      voicePocket: bool("SOUND_VOICE_POCKET", true),
      voiceFx: bool("SOUND_VOICE_FX", true),
    },
    dryRun: bool("DRY_RUN", false),
    maxAttempts: int("MAX_ATTEMPTS", 3),
    remotionConcurrency: int("REMOTION_CONCURRENCY", 2),
    remotionGl,
    browserExecutable: str("REMOTION_BROWSER_EXECUTABLE"),
  };
  if (cfg.legacyTokenDir) adoptLegacyYouTubeTokens(cfg);
  applyMetaLogin(cfg);
  return cfg;
}

/** The Meta login saved by /connect?account=meta: a never-expiring page token and the accounts it reaches. */
export interface MetaLogin {
  pageId: string;
  pageName?: string;
  pageToken: string;
  instagramAccountId?: string;
  granted: string[];
  declined: string[];
  savedAt: string;
}

export function readMetaLogin(file: string): MetaLogin | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as MetaLogin;
    return j?.pageToken && j?.pageId ? j : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Puts the saved Meta login in place of the .env tokens, everywhere the factory reads them (crossposting,
 * the community posts, the numbers poller). A page token reaches the page's Instagram account as well.
 * Called at start-up and again by the connect page, so a new login works without a restart.
 */
export function applyMetaLogin(
  cfg: Config,
  login: MetaLogin | undefined = cfg.metaLoginPath
    ? readMetaLogin(cfg.metaLoginPath)
    : undefined,
): boolean {
  if (!login) return false;
  cfg.facebookPageId = login.pageId;
  cfg.facebookPageToken = login.pageToken;
  cfg.instagramToken = login.pageToken;
  if (login.instagramAccountId)
    cfg.instagramAccountId = login.instagramAccountId;
  cfg.metaGranted = login.granted ?? [];
  return true;
}

/**
 * Reuses the YouTube login the Codex pipeline already has on this PC
 * (tokens/youtube_credentials.json + tokens/youtube_token.json) so the
 * channel never needs re-connecting. Explicit env values win.
 */
export function adoptLegacyYouTubeTokens(cfg: Config): void {
  const read = (f: string): any => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(cfg.legacyTokenDir, f), "utf8"),
      );
    } catch {
      return undefined;
    }
  };
  const creds = read("youtube_credentials.json");
  const client = creds?.installed ?? creds?.web;
  if (client && !cfg.googleClientId) {
    cfg.googleClientId = client.client_id ?? "";
    cfg.googleClientSecret = client.client_secret ?? "";
  }
  const token = read("youtube_token.json");
  const refresh =
    token?.refresh_token ??
    token?.credentials?.refresh_token ??
    token?.tokens?.refresh_token;
  if (refresh && !cfg.youtubeRefreshToken) cfg.youtubeRefreshToken = refresh;
}

/** Safe-to-log view: booleans for secrets, values for everything else. */
export function redactedConfig(c: Config): Record<string, unknown> {
  return {
    publicUrl: c.publicUrl,
    dataDir: c.dataDir,
    database: Boolean(c.databaseUrl),
    anthropicModel: c.anthropicModel,
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    codexLlm: c.codexLlm,
    codexCalls: c.codexCalls,
    codexVision: c.codexVision,
    visionPaidFallback: c.visionPaidFallback,
    voiceProvider: c.voiceProvider,
    localTtsUrl: c.localTtsUrl,
    elevenLabsFallback: Boolean(c.elevenLabsApiKey),
    discord: Boolean(c.discordWebhookUrl),
    youtubeOAuthClient: Boolean(c.googleClientId && c.googleClientSecret),
    youtubePrivacy: c.youtubePrivacy,
    dailyTarget: c.dailyTarget,
    shortsPerDayMax: c.shortsPerDayMax || "no cap",
    growthTests: c.growthTests,
    weeklyExplainedTest: c.weeklyExplainedTest && c.recapLong && c.longformEnabled,
    newsSlots: c.newsSlots.join(","),
    breaking: c.breakingEnabled
      ? `${c.breakingPerDay}/day, score>=${c.breakingScoreMin}, <=${c.breakingMaxAgeMinutes}min old${c.breakingBigScore ? `, one more at score>=${c.breakingBigScore}` : ""}`
      : "off",
    bigStories: c.bigStoryMode === "off"
      ? "off"
      : `${c.bigStoryMode}, size>=${c.bigStorySize}, up to ${c.bigStoryPerDay}/day, ${c.bigStoryMaxAgeHours}h window`,
    whySlots: c.whyEnabled ? c.whySlots.join(",") : "off",
    streamAsks: streamAsksSummary(c.streamAsks),
    liveClips: liveClipsSummary(c.liveClips),
    whySerial: c.whySerialEnabled
      ? `numbered, ${c.whyTargetSeconds ? `${c.whyTargetSeconds.min}-${c.whyTargetSeconds.max}s` : "default length"}, home shelf ${Math.round(c.whyHomeShare * 100)}% (${c.whyHomeFranchises.join(", ")})`
      : "off",
    gtaFile: gtaFileSummary(c),
    shortLengths: shortLengthsSummary(c.shortLengths, c.instagramMaxSeconds),
    runPremake: `${c.runPremakeHours}h ahead, upload ${c.runPremakeUploadHours}h before the slot`,
    runSpareSlots: (c.runSpareSlots.length ? c.runSpareSlots : c.whySlots).join(","),
    uploadRetry: `${c.uploadRetryMinutes} min apart, ${c.uploadMoves} move(s)`,
    breakingBumpScore: c.breakingBumpScore || "off",
    visionHold: c.visionHold,
    leonidaLink: c.leonidaLink,
    demandCheck: c.demandCheck,
    approvalMode: c.approvalMode,
    approvalTimeoutMinutes: c.approvalTimeoutMinutes,
    includeRumours: c.includeRumours,
    visionQa: c.visionQa,
    dryRun: c.dryRun,
  };
}

/** The Python that has Whisper on this machine: the PC's speech runtime or the Mac's MLX one. */
/**
 * The parallax environment, else the Whisper Python: D:/pulse-tools/parallax-venv on the PC (the runtime's
 * torch plus its own OpenCV and Pillow), ~/PulseFactory/parallax on the Mac (mac/migrate.sh prepare: torch,
 * transformers, OpenCV and Pillow on Apple's GPU). The Mac's Whisper environment has no OpenCV, so without
 * its own the stills stayed flat there.
 */
function defaultParallaxPython(): string {
  const venvs = [
    "D:/pulse-tools/parallax-venv/Scripts/python.exe",
    `${os.homedir()}/PulseFactory/parallax/bin/python`,
  ];
  return venvs.find((p) => fs.existsSync(p)) ?? defaultWhisperPython();
}

function defaultWhisperPython(): string {
  const candidates = [
    "D:/pulse-tools/pulse-python-runtime/Scripts/python.exe",
    `${process.env.HOME ?? ""}/PulseFactory/asr/bin/python`,
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? "";
}
