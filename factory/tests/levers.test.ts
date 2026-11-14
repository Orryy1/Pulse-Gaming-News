// The platform levers (src/levers): answer packaging for long videos and their site pages, stream-archive links, the
// live watcher, Instagram trial reels, the Studio-only plans and the Partner Programme tracker.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerPack,
  factScore,
  isoDuration,
  keyFactLines,
  keyFacts,
  loopQuestions,
  questionChapters,
  questionTitle,
  summaryLead,
  withoutSummary,
} from "../src/levers/answer.ts";
import {
  archiveCommentLine,
  archiveDescriptionLine,
  archiveLinkFor,
  matchTwitch,
  recordingId,
  withArchiveTargets,
  type StreamArchive,
} from "../src/levers/archives.ts";
import {
  STREAM_AI_LINE,
  liveDescription,
  liveWatchTick,
  shiftChapters,
  streamDay,
  withChapters,
  type LiveWatchDeps,
} from "../src/levers/livewatch.ts";
import { leverSettings, leverSummary } from "../src/levers/settings.ts";
import {
  trialFor,
  trialParams,
  trialRefused,
  unitOf,
} from "../src/levers/trial.ts";
import {
  gameSearchName,
  planGameTitles,
  planShortsSeries,
} from "../src/levers/studio.ts";
import {
  kindByLength,
  mergeStatus,
  tallyMinutes,
  withYpp,
  yppDue,
  yppLine,
  yppProjection,
  yppReportLines,
  yppWindow,
  type YppMeasure,
} from "../src/levers/ypp.ts";
import { LeverApi, isoSeconds } from "../src/levers/ytapi.ts";
import { archiveFileName } from "../src/levers/job.ts";
import { postInstagramReel } from "../src/social/platforms.ts";
import { articlePage, clipsLd } from "../src/web/site.ts";
import { hasChapterMarks } from "../src/youtube/chapters.ts";
import { docToScript, type DocDraft } from "../src/editorial/documentary.ts";
import {
  longAnswerPack,
  segmentInputs,
  videoMetadata,
} from "../src/pipeline.ts";
import type { Episode } from "../src/episodes.ts";
import type { VodIndex } from "../src/vodindex/schema.ts";

// ------------------------------------------------------------------ fixtures

const CHAPTERS = [
  [
    "Grand Theft Auto",
    1997,
    "The Making of Grand Theft Auto",
    "DMA Design shipped the first Grand Theft Auto in 1997 from a small office in Dundee.",
  ],
  [
    "Grand Theft Auto III",
    2001,
    "GTA III and the Leap to 3D",
    "Grand Theft Auto III sold more than 14 million copies after its release in October 2001.",
  ],
  [
    "Grand Theft Auto: Vice City",
    2002,
    "Why Vice City Went Back to the Eighties",
    "Vice City cost about 5 million dollars to make and sold 17 million copies.",
  ],
  [
    "Grand Theft Auto V",
    2013,
    "The Story of Los Santos",
    "Grand Theft Auto V earned 800 million dollars on its first day in September 2013.",
  ],
] as const;

function draft(): DocDraft {
  const chapters = CHAPTERS.map(([title, year, chapter, fact], ci) => ({
    plan: {
      chapter_title: chapter,
      game_title: title,
      wiki_title: title,
      steam_search_term: title,
      year,
      platforms: "PC, PS2",
      focus: "the leap",
      photo_searches: [] as string[],
    },
    chapter: {
      paragraphs: [
        {
          narration: `${fact} You can still feel how small that team was in every corner of the map.`,
        },
        {
          narration:
            "And that is where it gets interesting for anyone who grew up with these games on a living room floor.",
        },
        {
          narration: `It changed what a city in a game could be, and people still argue about chapter ${ci + 1} today.`,
        },
      ].map((p) => ({
        ...p,
        callout: { kind: "none" as const, primary: "", secondary: "" },
        footage: { want: "gameplay" as const, keywords: [title] },
      })),
      claims: [{ claim: `${title} sold well`, section: "Sales" }],
    },
    source: {
      title,
      url: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}`,
      text: "## Overview\nReleased.",
    },
  }));
  return {
    topic: {
      kind: "franchise",
      franchise_index: 0,
      story_index: -1,
      franchise: "Grand Theft Auto",
      title_idea: "The Complete History of GTA",
      angle: "x",
      reason: "y",
    },
    outline: {
      question: "How did a Dundee studio's top-down game become GTA?",
      title: "The Complete History of Grand Theft Auto",
      kicker: "From Dundee to Leonida",
      franchise_wiki_title: "Grand Theft Auto",
      chapters: chapters.map((c) => c.plan),
      youtube: {
        title: "How a Dundee Studio Built Grand Theft Auto",
        description:
          "All of it, game by game. Rockstar North grew out of DMA Design in Dundee.",
        tags: ["GTA"],
      },
    },
    chapters,
    bookends: {
      intro: {
        narration:
          "On October 22, 2001, in a converted warehouse in Edinburgh, Sam Houser watched the first reviews of Grand Theft Auto III arrive. This is how a small Scottish studio built the biggest series in games.",
        on_screen: "From Dundee to Leonida",
      },
      outro: {
        label: "What comes next",
        narration:
          "Now Grand Theft Auto VI is almost here, and the series that started in Dundee goes back to Vice City.",
        on_screen: "Thirty years in",
      },
    },
  } as DocDraft;
}

function docEpisode(): Episode {
  const script = docToScript(draft());
  const all = segmentInputs(script).flatMap((x) =>
    x.text.split(/\s+/).filter(Boolean),
  );
  // 2.5 s a word stretches the short fixture over several minutes, so chapters land ten seconds and more apart.
  const w = all.map((text, i) => ({ text, start: i * 2.5, end: i * 2.5 + 2 }));
  return {
    id: "ep_doc",
    story_hash: "h",
    status: "uploaded",
    story_json: { headline: "x", items: [] } as never,
    script_json: script,
    factcheck_json: null,
    assets_json: { words: w, durationSeconds: w.at(-1)!.end + 0.5 },
    qa_json: null,
    approval_mode: null,
    approved_by: null,
    approval_requested_at: null,
    upload_session_uri: null,
    youtube_video_id: "vid_doc0001",
    youtube_status: null,
    publish_at: null,
    lane: "evergreen",
    priority: 50,
    slot_at: null,
    attempts: 0,
    last_error: null,
    next_attempt_at: null,
    created_at: "2026-10-30T10:00:00Z",
    updated_at: "2026-10-30T10:00:00Z",
  } as Episode;
}

// ------------------------------------------------------------------ settings

test("lever settings: everything that changes public output is off by default; the read-only ones are on", () => {
  const s = leverSettings({});
  assert.equal(s.answerPack, false);
  assert.equal(s.answerPages, false);
  assert.equal(s.streamArchiveLinks, false);
  assert.equal(s.liveAutofill, false);
  assert.equal(s.igTrialShare, 0);
  assert.equal(s.podcastPlaylist, "");
  assert.equal(s.yppTracker, true);
  assert.equal(s.yppDeadline, "2027-01-31");
  assert.equal(s.liveTwitch, "tinotv");
  const on = leverSettings({
    LIVE_AUTOFILL: "on",
    IG_TRIAL_SHARE: "2",
    IG_TRIAL_GRADUATION: "manual",
    YPP_DEADLINE: "nope",
  });
  assert.equal(on.igTrialShare, 1);
  assert.equal(on.igTrialGraduation, "MANUAL");
  assert.equal(on.yppDeadline, "2027-01-31");
  assert.match(leverSummary(on), /live autofill \(Grand Theft Auto VI/);
  assert.equal(
    leverSummary(leverSettings({ YPP_TRACKER: "off", STUDIO_PLANS: "off" })),
    "off",
  );
});

// ------------------------------------------------------------------ answer packaging

test("the summary is two or three plain sentences, no questions, under 320 characters", () => {
  const s = summaryLead({
    hook: "Grand Theft Auto VI is out on November 19. Here is why that matters?",
    point: "Rockstar moved the launch twice before landing on the date.",
    beats: [
      {
        narration: "The first trailer reached 90 million views in a day.",
      } as never,
    ],
    pulse_take: {
      label: "",
      narration: "Is it worth the wait? Probably.",
      on_screen: "",
    },
  });
  assert.equal(
    s,
    "Grand Theft Auto VI is out on November 19. Rockstar moved the launch twice before landing on the date. The first trailer reached 90 million views in a day.",
  );
  assert.ok(s.length <= 320);
  assert.doesNotMatch(s, /\?/);
  assert.equal(
    withoutSummary(
      "Rockstar moved the launch twice before landing on the date. Extra line.",
      s,
    ),
    "Extra line.",
  );
});

test("chapters become questions only where the grammar is certain; the documentary's own questions come first", () => {
  assert.equal(
    questionTitle("The Making of Grand Theft Auto"),
    "How Was Grand Theft Auto Made?",
  );
  assert.equal(
    questionTitle("Why Vice City Went Back to the Eighties"),
    "Why Vice City Went Back to the Eighties?",
  );
  assert.equal(
    questionTitle("The Story of Los Santos"),
    "What Is the Story of Los Santos?",
  );
  assert.equal(
    questionTitle("GTA III and the Leap to 3D"),
    "GTA III and the Leap to 3D",
  );
  assert.equal(questionTitle("#3 Vice City"), "#3 Vice City");
  assert.equal(questionTitle("Intro"), "Intro");
  const loops = loopQuestions({
    open_loops: [
      {
        question: "Why did Rockstar leave Dundee?",
        plant: { entry: -1, moment: 0 },
        payoff: { entry: 1, moment: 2 },
      },
    ],
  });
  assert.equal(loops[1], "Why did Rockstar leave Dundee?");
  const out = questionChapters(
    [
      "0:00 Intro",
      "1:00 The Making of GTA",
      "2:00 GTA III and the Leap to 3D",
      "3:00 What comes next",
    ],
    loops,
  );
  assert.deepEqual(out, [
    "0:00 Intro",
    "1:00 How Was GTA Made?",
    "2:00 Why did Rockstar leave Dundee?",
    "3:00 What comes next",
  ]);
});

test("key facts carry a figure, one a chapter, and never start a line with a time", () => {
  assert.ok(
    factScore(
      "Grand Theft Auto III sold more than 14 million copies after its release in 2001.",
    ) >= 2,
  );
  assert.equal(
    factScore(
      "And that is where it gets interesting for anyone who grew up with these games.",
    ),
    0,
  );
  const facts = keyFacts([
    {
      start: 0,
      text: "Welcome. This is a story about a city.",
      opensChapter: true,
    },
    {
      start: 65,
      text: "Grand Theft Auto III sold more than 14 million copies in 2001. It mattered.",
      opensChapter: true,
    },
    { start: 80, text: "Vice City sold 17 million copies by 2008." },
    {
      start: 130,
      text: "Grand Theft Auto V earned 800 million dollars on its first day.",
      opensChapter: true,
    },
  ]);
  assert.deepEqual(
    facts.map((f) => f.at),
    [65, 130],
  );
  const lines = keyFactLines(facts);
  assert.equal(lines[0], "Key facts:");
  assert.match(
    lines[1]!,
    /^• Grand Theft Auto III sold more than 14 million copies in 2001\. \(at 1:05\)$/,
  );
  assert.equal(hasChapterMarks(lines.join("\n")), false);
  assert.equal(isoDuration(3725), "PT1H2M5S");
  assert.equal(isoDuration(0), "PT0S");
});

test("ANSWER_PACK: a documentary's description opens on its summary, asks its chapters and lists key facts after them", () => {
  const ep = docEpisode();
  const off = videoMetadata(ep, "public");
  const on = videoMetadata(ep, "public", true, undefined, false, new Date(), {
    answerPack: true,
    streamArchiveLinks: false,
  });
  assert.doesNotMatch(off.description, /Key facts:/);
  const lines = on.description.split("\n");
  assert.match(
    lines[0]!,
    /^On October 22, 2001, in a converted warehouse in Edinburgh/,
  );
  assert.equal(lines[1], "");
  assert.match(lines[2]!, /^The complete history of Grand Theft Auto/);
  assert.match(on.description, /\nChapters:\n0:00 Intro\n/);
  assert.match(on.description, /How Was Grand Theft Auto Made\?/);
  const chapters = on.description.indexOf("Chapters:");
  const facts = on.description.indexOf("Key facts:");
  assert.ok(facts > chapters, "key facts sit after the chapter list");
  assert.match(
    on.description,
    /• Grand Theft Auto III sold more than 14 million copies after its release in October 2001\. \(at \d+:\d\d\)/,
  );
  // Exactly one block of lines that start with a time: YouTube reads one chapter list.
  const marks = lines.filter((l) => /^\d+:\d\d /.test(l));
  assert.equal(
    marks.length,
    on.description.slice(chapters).split("\n\n")[0]!.split("\n").length - 1,
  );
  assert.doesNotMatch(on.description, /—/);
  // The pack the site shows is the same.
  const pack = longAnswerPack(ep);
  assert.equal(pack.summary, lines[0]);
  assert.ok(pack.chapters.length >= 3 && pack.chapters[0]!.at === 0);
  assert.ok(pack.facts.length >= 2);
});

// ------------------------------------------------------------------ site page

test("ANSWER_PAGES: the long video's page shows the pack and marks the video up with Clips and SeekToAction", () => {
  const ep = docEpisode();
  const duration = ep.assets_json!.durationSeconds!;
  const pack = { ...longAnswerPack(ep), duration };
  const site = {
    id: "ep_20261030_doc12345",
    lane: "evergreen",
    youtube_video_id: "vid_doc0001",
    script_json: ep.script_json!,
    story_json: { items: [] },
    live_at: "2026-10-30T12:00:00.000Z",
  };
  const plain = articlePage(site, "https://pulsegmg.com", { uk: "pulsegamingnews-21" }, "US");
  assert.doesNotMatch(plain, /SeekToAction/);
  const html = articlePage(site, "https://pulsegmg.com", { uk: "pulsegamingnews-21" }, "US", {
    pack,
    seek: 125,
  });
  assert.match(html, /<h2>In short<\/h2><p class="lead">On October 22, 2001/);
  assert.match(html, /<h2>Key facts<\/h2>/);
  assert.match(
    html,
    /<h2>Chapters<\/h2><ol class="chapters"><li><a href="\?t=0">0:00<\/a> Intro<\/li>/,
  );
  assert.match(html, /embed\/vid_doc0001\?start=125&autoplay=1/);
  const ld = [
    ...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g),
  ].map((m) => JSON.parse(m[1]!));
  const video = ld.find((j) => j["@type"] === "VideoObject");
  assert.equal(video.duration, isoDuration(duration));
  assert.equal(video.potentialAction["@type"], "SeekToAction");
  assert.match(
    video.potentialAction.target,
    /\/news\/[a-z0-9-]+-doc12345\?t=\{seek_to_second_number\}$/,
  );
  assert.equal(video.hasPart[0]["@type"], "Clip");
  assert.equal(video.hasPart[0].startOffset, 0);
  assert.equal(video.hasPart[0].endOffset, video.hasPart[1].startOffset);
  assert.equal(video.hasPart.at(-1).endOffset, Math.floor(duration));
  assert.match(video.hasPart[1].url, /\?t=\d+$/);
  assert.deepEqual(clipsLd("https://x.test/a", [{ at: 0, title: "A" }]), [
    { "@type": "Clip", name: "A", startOffset: 0, url: "https://x.test/a?t=0" },
  ]);
});

// ------------------------------------------------------------------ stream archives

const ARCHIVES: StreamArchive[] = [
  {
    videoId: "ytArchive01",
    title: "GTA 6 LIVE Day 1: First Playthrough",
    startedAt: "2026-11-19T18:00:30Z",
    endedAt: "2026-11-19T22:00:00Z",
    twitchStream: "tw1",
    twitchStartedAt: "2026-11-19T18:00:00Z",
    vodId: "v100",
  },
];
const STREAMS = { tw1: { startedAt: "2026-11-19T18:00:00Z", vod: "v100" } };

test("a Short cut from a stream finds its archive and second, from the live stream, its recording or the archive itself", () => {
  const live = archiveLinkFor(
    {
      source: {
        file: "twitch live stream tw1",
        title: "",
        kind: "twitch_live",
      },
      clip: { file: "clip.mp4", start_in_source: 3600, seconds: 30 },
      live: { stream_id: "tw1", moment_at: "", decided_at: "", signals: [] },
    },
    STREAMS,
    ARCHIVES,
  );
  // 3,600 s into the Twitch stream is 3,570 s into the archive (started 30 s later), less the 8 s lead.
  assert.deepEqual(live, {
    videoId: "ytArchive01",
    seconds: 3562,
    title: ARCHIVES[0]!.title,
  });
  const vod = archiveLinkFor(
    {
      source: {
        file: "/rec/2026-11-19 GTA 6 [v100].mp4",
        title: "",
        kind: "twitch_vod",
      },
      clip: { file: "clip.mp4", start_in_source: 600, seconds: 30 },
    },
    {},
    ARCHIVES,
  );
  assert.equal(vod?.seconds, 562);
  const own = archiveLinkFor(
    {
      source: {
        file: "/rec/2026-11-19 GTA 6 LIVE Day 1 [yt-ytArchive01].mp4",
        title: "",
        kind: "twitch_vod",
      },
      clip: { file: "clip.mp4", start_in_source: 100, seconds: 30 },
    },
    {},
    ARCHIVES,
  );
  assert.equal(own?.seconds, 92);
  assert.equal(
    archiveLinkFor(
      {
        source: { file: "x.mp4", title: "", kind: "xbox" },
        clip: { file: "c", seconds: 30 },
      },
      STREAMS,
      ARCHIVES,
    ),
    undefined,
  );
  // A moment after the archive ended has no archive.
  assert.equal(
    archiveLinkFor(
      {
        source: { file: "", title: "", kind: "twitch_live" },
        clip: { file: "c", start_in_source: 20_000, seconds: 30 },
        live: { stream_id: "tw1", moment_at: "", decided_at: "", signals: [] },
      },
      STREAMS,
      ARCHIVES,
    ),
    undefined,
  );
  assert.equal(
    archiveDescriptionLine(live!),
    `Watch it happen in the full stream (from 59:22): ${ARCHIVES[0]!.title} https://youtu.be/ytArchive01?t=3562`,
  );
  assert.match(
    archiveCommentLine(live!),
    /from this exact moment \(59:22\): https:\/\/youtu\.be\/ytArchive01\?t=3562$/,
  );
  assert.equal(
    recordingId("/a/2026-11-19 GTA [yt-abc_DEF-12].mkv"),
    "yt-abc_DEF-12",
  );
  assert.deepEqual(matchTwitch("2026-11-19T18:10:00Z", STREAMS), {
    id: "tw1",
    startedAt: "2026-11-19T18:00:00Z",
    vod: "v100",
  });
  assert.equal(matchTwitch("2026-11-19T20:00:00Z", STREAMS), undefined);
});

test("the related-video plan points a stream Short at its archive and leaves the rest and clear items alone", () => {
  const plan = [
    {
      short: "short000001",
      title: "a",
      target: "long0000001",
      targetTitle: "Doc",
      reason: "same series",
    },
    {
      short: "short000002",
      title: "b",
      target: "long0000001",
      targetTitle: "Doc",
      reason: "newest long video",
    },
    {
      short: "short000003",
      title: "c",
      target: "",
      targetTitle: "",
      reason: "clear",
      action: "clear",
    },
  ];
  const out = withArchiveTargets(plan, [
    {
      youtube_video_id: "short000001",
      stream_archive: { videoId: "ytArchive01", seconds: 75, title: "Day 1" },
    },
    {
      youtube_video_id: "short000003",
      stream_archive: { videoId: "ytArchive01", seconds: 75, title: "Day 1" },
    },
  ]);
  assert.equal(out[0]!.target, "ytArchive01");
  assert.equal(out[0]!.reason, "cut from this stream archive at 1:15");
  assert.deepEqual(out[1], plan[1]);
  assert.deepEqual(out[2], plan[2]);
});

test("STREAM_ARCHIVE_LINKS: a Short's description gets the archive line only with the setting on", () => {
  const ep = docEpisode();
  const short = {
    ...ep,
    script_json: {
      ...ep.script_json!,
      runtime: "short" as const,
      evergreen_format: undefined,
    },
    story_json: {
      headline: "x",
      items: [],
      streamArchive: { videoId: "ytArchive01", seconds: 90, title: "Day 1" },
    } as never,
  };
  const off = videoMetadata(
    short,
    "public",
    true,
    undefined,
    false,
    new Date(),
    { answerPack: false, streamArchiveLinks: false },
  );
  const on = videoMetadata(
    short,
    "public",
    true,
    undefined,
    false,
    new Date(),
    { answerPack: false, streamArchiveLinks: true },
  );
  assert.doesNotMatch(off.description, /full stream/);
  assert.match(
    on.description,
    /Watch it happen in the full stream \(from 1:30\): Day 1 https:\/\/youtu\.be\/ytArchive01\?t=90/,
  );
});

// ------------------------------------------------------------------ live watcher

interface FakeApi {
  calls: string[];
  active: Array<Record<string, any>>;
  byId: Array<Record<string, any>>;
  videos: Array<Record<string, any>>;
}

function watchDeps(api: FakeApi, over: Partial<LiveWatchDeps> = {}) {
  let archives: StreamArchive[] = [];
  const notes: string[] = [];
  let units = 0;
  const deps: LiveWatchDeps = {
    api: {
      broadcasts: async (state) => (
        api.calls.push(`list:${state}`),
        api.active as never
      ),
      broadcastsById: async (ids) => (
        api.calls.push(`byId:${ids.join(",")}`),
        api.byId.filter((b) => ids.includes(b.id)) as never
      ),
      videos: async (ids) => (
        api.calls.push(`videos:${ids.join(",")}`),
        api.videos.filter((v) => ids.includes(v.id)) as never
      ),
      setSnippet: async (v, title, description) => {
        api.calls.push(`set:${v.id}`);
        const x = api.videos.find((y) => y.id === v.id)!;
        x.title = title;
        x.description = description;
      },
    },
    settings: {
      liveTitle: true,
      liveGame: "Grand Theft Auto VI",
      liveTwitch: "tinotv",
      liveArchiveDownload: true,
      liveArchiveWaitHours: 3,
    },
    dailyStart: "2026-11-19",
    timeZone: "Europe/London",
    now: () => new Date("2026-11-21T19:00:00Z"),
    readArchives: () => archives.map((a) => ({ ...a })),
    writeArchives: async (l) => void (archives = l),
    twitchStreams: () => ({
      tw9: { startedAt: "2026-11-21T18:00:00Z", vod: "v900" },
    }),
    readyIndex: async () => undefined,
    notify: async (t) => void notes.push(t),
    quota: async (n) => void (units += n),
    ...over,
  };
  return { deps, notes, archives: () => archives, units: () => units };
}

test("the live watcher names the stream as Day N with the disclosure and Twitch link, once, and never touches privacy", async () => {
  const api: FakeApi = {
    calls: [],
    active: [
      {
        id: "live0000001",
        title: "Live from Xbox",
        description: "",
        actualStartTime: "2026-11-21T18:00:20Z",
        privacyStatus: "public",
        recordFromStart: true,
      },
    ],
    byId: [],
    videos: [
      {
        id: "live0000001",
        title: "Live from Xbox",
        description: "",
        categoryId: "20",
        privacyStatus: "public",
      },
    ],
  };
  const w = watchDeps(api);
  const did = await liveWatchTick(w.deps);
  assert.deepEqual(did, [
    "recorded live0000001",
    "named live0000001: GTA 6 LIVE Day 3: First Playthrough",
  ]);
  const v = api.videos[0]!;
  assert.equal(v.title, "GTA 6 LIVE Day 3: First Playthrough");
  assert.match(v.description, /^GTA 6 live gameplay, day 3 \(2026-11-21\)/);
  assert.equal(
    v.description.split(STREAM_AI_LINE).length,
    2,
    "the disclosure once",
  );
  assert.match(
    v.description,
    /Also live on Twitch: https:\/\/www\.twitch\.tv\/tinotv/,
  );
  assert.doesNotMatch(v.description, /—/);
  assert.equal(w.notes.length, 0);
  // A second pass changes nothing more.
  api.active[0]!.title = v.title;
  api.active[0]!.description = v.description;
  api.calls.length = 0;
  await liveWatchTick(w.deps);
  assert.deepEqual(api.calls, ["list:active"]);
  // The API the watcher gets has no privacy or delete call at all.
  assert.equal("setPrivacy" in w.deps.api, false);
});

test("the live watcher keeps the relay's own title and reports a private stream or a stream with no archive, once, without changing it", async () => {
  const relayTitle = "GTA 6 LIVE Day 3: Escaping Five Stars";
  const api: FakeApi = {
    calls: [],
    active: [
      {
        id: "live0000002",
        title: relayTitle,
        description: liveDescription({
          game: "Grand Theft Auto VI",
          day: 3,
          date: "2026-11-21",
          twitch: "tinotv",
        }),
        actualStartTime: "2026-11-21T18:00:20Z",
        privacyStatus: "unlisted",
        recordFromStart: false,
      },
    ],
    byId: [],
    videos: [
      {
        id: "live0000002",
        title: relayTitle,
        description: "",
        privacyStatus: "unlisted",
      },
    ],
  };
  const w = watchDeps(api);
  await liveWatchTick(w.deps);
  await liveWatchTick(w.deps);
  assert.equal(
    api.calls.filter((c) => c.startsWith("set:")).length,
    0,
    "nothing rewritten",
  );
  assert.equal(w.notes.length, 2);
  assert.match(w.notes.join("\n"), /not to keep its recording/);
  assert.match(w.notes.join("\n"), /is unlisted.*Pulse never changes privacy/);
});

test("after the stream: the end, the Twitch match, chapters from the index on the YouTube clock, then the fetch when nothing is indexed", async () => {
  const api: FakeApi = {
    calls: [],
    active: [],
    byId: [
      {
        id: "live0000003",
        title: "GTA 6 LIVE Day 3",
        description: "",
        actualStartTime: "2026-11-21T18:00:30Z",
        actualEndTime: "2026-11-21T22:00:00Z",
        lifeCycleStatus: "complete",
      },
    ],
    videos: [
      {
        id: "live0000003",
        title: "GTA 6 LIVE Day 3",
        description: "Text.\n\n#GTA6",
        privacyStatus: "public",
        durationSeconds: 14_000,
      },
    ],
  };
  const index: Pick<VodIndex, "shots" | "duration"> = {
    duration: 14_000,
    shots: [
      { start: 30, end: 40, where: "Vice City beach", tags: [] },
      { start: 1300, end: 1310, where: "Port Gellhorn", tags: [] },
      { start: 2600, end: 2610, where: "Leonida Keys", tags: [] },
    ] as never,
  };
  const start: StreamArchive = {
    videoId: "live0000003",
    title: "GTA 6 LIVE Day 3",
    startedAt: "2026-11-21T18:00:30Z",
  };
  const w = watchDeps(api, {
    now: () => new Date("2026-11-21T23:00:00Z"),
    readyIndex: async (id) => (id === "v900" ? index : undefined),
  });
  await w.deps.writeArchives([start]);
  const did = await liveWatchTick(w.deps);
  assert.ok(did.includes("ended live0000003"));
  assert.ok(did.includes("chapters live0000003: 3"));
  const a = w.archives()[0]!;
  assert.equal(a.vodId, "v900");
  assert.equal(a.chaptersSet, true);
  // The Twitch stream started 30 s before YouTube: its 1,300 s mark is 1,270 s into the archive.
  assert.match(
    api.videos[0]!.description,
    /\n\nChapters\n0:00 Stream starts\n21:10 Port Gellhorn\n42:50 Leonida Keys\n\n#GTA6$/,
  );

  // With no recording indexed, the archive is fetched once the wait is over (four times as long when Twitch has one).
  const api2: FakeApi = {
    ...api,
    calls: [],
    byId: api.byId.map((b) => ({ ...b, id: "live0000004" })),
    videos: [{ ...api.videos[0]!, id: "live0000004" }],
  };
  const fetched: string[] = [];
  const w2 = watchDeps(api2, {
    twitchStreams: () => ({}),
    now: () => new Date("2026-11-22T02:00:00Z"),
    download: async (x) => (fetched.push(x.videoId), "file.mp4"),
  });
  await w2.deps.writeArchives([{ ...start, videoId: "live0000004" }]);
  await liveWatchTick(w2.deps);
  assert.deepEqual(fetched, ["live0000004"]);
  assert.equal(w2.archives()[0]!.downloaded, "file.mp4");
  await liveWatchTick(w2.deps);
  assert.deepEqual(fetched, ["live0000004"], "fetched once");
});

test("a saved stream that goes private or disappears is reported, never changed", async () => {
  const api: FakeApi = {
    calls: [],
    active: [],
    byId: [],
    videos: [
      {
        id: "live0000005",
        title: "x",
        description: "",
        privacyStatus: "private",
      },
    ],
  };
  const w = watchDeps(api);
  await w.deps.writeArchives([
    {
      videoId: "live0000005",
      title: "Day 2",
      startedAt: "2026-11-20T18:00:00Z",
      endedAt: "2026-11-20T22:00:00Z",
      chaptersSet: true,
      alerts: [],
    },
    {
      videoId: "live0000006",
      title: "Day 1",
      startedAt: "2026-11-19T18:00:00Z",
      endedAt: "2026-11-19T22:00:00Z",
      alerts: [],
    },
  ]);
  await liveWatchTick(w.deps);
  assert.match(
    w.notes.join("\n"),
    /"Day 1" \(live0000006\) is not on the channel any more/,
  );
  assert.equal(api.calls.filter((c) => c.startsWith("set:")).length, 0);
});

test("live helpers: day numbers, shifted chapters, chapter blocks replaced in place, archive file names", () => {
  assert.equal(streamDay("2026-11-19", "2026-11-19"), 1);
  assert.equal(streamDay("2026-11-19", "2026-11-25"), 7);
  assert.equal(streamDay("2026-11-19", "2026-11-17"), 1);
  assert.deepEqual(
    shiftChapters(
      [
        { at: 0, title: "A" },
        { at: 600, title: "B" },
        { at: 1200, title: "C" },
        { at: 1205, title: "D" },
      ],
      -30,
    ),
    [
      { at: 0, title: "A" },
      { at: 570, title: "B" },
      { at: 1170, title: "C" },
    ],
  );
  assert.deepEqual(
    shiftChapters(
      [
        { at: 0, title: "A" },
        { at: 5, title: "B" },
      ],
      0,
    ),
    [],
  );
  const st = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const d = withChapters(
    "Body\n\nChapters\n0:00 Old\n\n#Tag",
    [
      { at: 0, title: "New" },
      { at: 60, title: "Two" },
    ],
    st,
  );
  assert.equal(d, "Body\n\nChapters\n0:00 New\n1:00 Two\n\n#Tag");
  assert.equal(
    archiveFileName(
      {
        videoId: "abcdefghijk",
        title: 'GTA 6 LIVE Day 3: "Big" Heist',
        startedAt: "2026-11-21T23:30:00Z",
      },
      "Europe/London",
    ),
    "2026-11-21 GTA 6 LIVE Day 3 Big Heist [yt-abcdefghijk].mp4",
  );
});

// ------------------------------------------------------------------ YouTube client

test("the lever client sends only the snippet when renaming, and the playlist's own privacy with the podcast flag", async () => {
  const sent: Array<{ url: string; body?: any }> = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    sent.push({
      url,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  };
  const api = new LeverApi(async () => "token", fetchFn);
  await api.setSnippet(
    {
      id: "vid00000001",
      title: "",
      description: "",
      categoryId: "20",
      tags: ["a"],
      privacyStatus: "public",
    },
    "T",
    "D <b>",
  );
  assert.match(sent[0]!.url, /videos\?part=snippet$/);
  assert.deepEqual(Object.keys(sent[0]!.body), ["id", "snippet"]);
  assert.equal(sent[0]!.body.snippet.description, "D b");
  await api.enablePodcast({
    id: "PL1",
    title: "Docs",
    privacyStatus: "public",
  });
  assert.deepEqual(sent[1]!.body, {
    id: "PL1",
    status: { privacyStatus: "public", podcastStatus: "enabled" },
  });
  await assert.rejects(
    api.enablePodcast({ id: "PL2", title: "x" }),
    /privacy unknown/,
  );
  assert.equal(isoSeconds("PT1H2M3S"), 3723);
  assert.equal(isoSeconds("P1DT1S"), 86401);
  const failing = new LeverApi(
    async () => "t",
    async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "no",
            errors: [{ reason: "liveStreamingNotEnabled" }],
          },
        }),
        { status: 403 },
      ),
  );
  await assert.rejects(
    failing.broadcasts("active"),
    (e: any) =>
      e.reasons.includes("liveStreamingNotEnabled") && !/token/.test(e.message),
  );
});

// ------------------------------------------------------------------ Instagram trial reels

test("trial reels: a fixed share by episode, the container field, and an ordinary Reel when Instagram refuses", async () => {
  assert.equal(trialFor("ep_1", 0, "SS_PERFORMANCE"), undefined);
  assert.equal(trialFor("ep_1", 1, "MANUAL"), "MANUAL");
  const ids = Array.from({ length: 400 }, (_, i) => `ep_${i}`);
  const share =
    ids.filter((id) => trialFor(id, 0.5, "SS_PERFORMANCE")).length / ids.length;
  assert.ok(share > 0.4 && share < 0.6, String(share));
  assert.equal(unitOf("x"), unitOf("x"));
  assert.deepEqual(trialParams("SS_PERFORMANCE"), {
    trial_params: { graduation_strategy: "SS_PERFORMANCE" },
  });
  assert.deepEqual(trialParams(undefined), {});
  assert.ok(
    trialRefused("instagram container (link): (#100) Invalid parameter"),
  );

  // The poster: the first container asks for a trial and is refused; the second goes out without it.
  const bodies: any[] = [];
  let refused = "";
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/media")) {
      const b = JSON.parse(String(init.body));
      bodies.push(b);
      if (b.trial_params)
        return new Response(
          JSON.stringify({
            error: { message: "(#100) trial reels not available" },
          }),
          { status: 400 },
        );
      return new Response(JSON.stringify({ id: "c1" }), { status: 200 });
    }
    if (url.includes("/c1?fields=status"))
      return new Response(JSON.stringify({ status_code: "FINISHED" }), {
        status: 200,
      });
    if (url.endsWith("/media_publish"))
      return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const id = await postInstagramReel(
    {
      accountId: "1",
      token: "t",
      file: "",
      caption: "c",
      videoUrl: "https://x.test/v.mp4",
      trial: "SS_PERFORMANCE",
      onTrialRefused: (m) => (refused = m),
    },
    fetchFn as never,
    0,
  ).catch((e) => String(e));
  assert.equal(id, "m1");
  assert.equal(
    bodies[0].trial_params?.graduation_strategy ??
      bodies.find((b) => b.trial_params)?.trial_params.graduation_strategy,
    "SS_PERFORMANCE",
  );
  assert.ok(bodies.some((b) => !b.trial_params));
  assert.match(refused, /trial reels not available/);
});

// ------------------------------------------------------------------ Studio plans

test("Studio plans: game titles for one-game videos only, and the two Shorts series", () => {
  const rows = [
    {
      youtube_video_id: "v0000000001",
      lane: "gameplay",
      script_json: { game_title: "GTA 6", youtube: { title: "Can you swim?" } },
    },
    {
      youtube_video_id: "v0000000002",
      lane: "evergreen",
      script_json: { game_title: "Zelda", entries: [{}, {}] },
    },
    {
      youtube_video_id: "v0000000003",
      lane: "news",
      script_json: { game_title: "Gaming news" },
    },
    {
      youtube_video_id: "v0000000004",
      lane: "news",
      script_json: { game_title: "Hollow Knight: Silksong" },
    },
    {
      youtube_video_id: "v0000000005",
      lane: "evergreen",
      script_json: { game_title: "Steam", evergreen_format: "steam_deals" },
    },
  ];
  const plan = planGameTitles(rows, new Set(["v0000000004"]));
  assert.deepEqual(plan, [
    {
      video: "v0000000001",
      title: "Can you swim?",
      game: "GTA 6",
      search: "Grand Theft Auto VI",
    },
  ]);
  assert.equal(gameSearchName("RDR 2"), "Red Dead Redemption 2");
  const series = planShortsSeries(
    { daily: "GTA 6 Day by Day", why: "The Why" },
    new Set(["the-why"]),
  );
  assert.deepEqual(
    series.map((s) => s.key),
    ["gta-6-day-by-day"],
  );
});

// ------------------------------------------------------------------ Partner Programme tracker

const MEASURE: YppMeasure = {
  measuredAt: "2026-11-14T12:00:00.000Z",
  from: "2025-11-13",
  to: "2026-11-12",
  longHours: 290,
  liveHours: 22,
  recentHours: 112,
  notPublicHours: 5,
  shortsHours: 900,
  leavingHours: 0,
  subscribers: 49,
  recentSubs: 16,
  method: "content type",
};

test("the tracker counts public long and live hours only, and projects the 28-day pace to the deadline", () => {
  assert.deepEqual(yppWindow(new Date("2026-11-14T12:00:00Z")), {
    from: "2025-11-13",
    to: "2026-11-12",
    recentFrom: "2026-10-16",
  });
  const t = tallyMinutes(
    [
      { videoId: "a", minutes: 600, kind: "long" },
      { videoId: "b", minutes: 120, kind: "live" },
      { videoId: "c", minutes: 60, kind: "long" },
      { videoId: "d", minutes: 9000, kind: "short" },
    ],
    new Map([
      ["a", "public"],
      ["b", "public"],
      ["c", "unlisted"],
    ]),
  );
  assert.deepEqual(t, { long: 600, live: 120, short: 9000, notPublic: 60 });
  assert.equal(kindByLength({ durationSeconds: 59 }), "short");
  assert.equal(
    kindByLength({ durationSeconds: 900, liveBroadcastContent: "none" }),
    "long",
  );
  assert.equal(
    kindByLength({ durationSeconds: 900, liveBroadcastContent: "completed" }),
    "live",
  );
  const p = yppProjection(MEASURE, "2027-01-31");
  assert.equal(p.daysLeft, 80);
  assert.equal(p.publicHours, 312);
  assert.equal(p.perDay, 4);
  assert.equal(p.projectedHours, 632);
  assert.equal(p.neededPerDay, 46.1);
  assert.equal(p.tierNeededPerDay, 33.6);
  assert.equal(p.projectedSubs, 95);
  const line = yppLine(p);
  assert.match(
    line,
    /^Partner Programme: 312 public watch hours in the last 365 days \(long videos 290, saved streams 22; Shorts never count\)\. At the last 28 days' pace \(4\.0 a day\) that is about 632 by 31 Jan 2027, short of 4,000: it needs 46 hours a day from now; the 3,000-hour fan-funding tier needs 34 a day\. Subscribers 49, about 95 by then/,
  );
  assert.doesNotMatch(line, /—/);
  const big = yppProjection(
    { ...MEASURE, longHours: 3900, recentHours: 2800 },
    "2027-01-31",
  );
  assert.match(
    yppLine(big),
    /enough for the 4,000-hour bar; the 3,000-hour fan-funding tier is on course/,
  );
  // Leaving hours come off the projection.
  assert.equal(
    yppProjection({ ...MEASURE, leavingHours: 32 }, "2027-01-31")
      .projectedHours,
    600,
  );
});

test("the tracker's record, weekly due check, report lines and status dashboard entry", () => {
  const p = yppProjection(MEASURE, "2027-01-31");
  const first = withYpp(undefined, p);
  assert.equal(first.history.length, 1);
  assert.equal(yppDue(first, new Date("2026-11-20T12:00:00Z")), false);
  assert.equal(yppDue(first, new Date("2026-11-21T01:00:00Z")), true);
  assert.equal(yppDue(undefined, new Date()), true);
  const next = withYpp(
    first,
    yppProjection(
      { ...MEASURE, measuredAt: "2026-11-21T12:00:00.000Z", longHours: 330 },
      "2027-01-31",
    ),
  );
  const lines = yppReportLines(next);
  assert.match(
    lines[1]!,
    /^🎯 Partner Programme: 352 public watch hours.*\(\+40 hours since 2026-11-14\)$/,
  );
  const status = mergeStatus(
    {
      project: "Pulse Gaming",
      numbers: [1, 2, 3, 4, 5].map((n) => ({
        label: `n${n}`,
        value: String(n),
      })),
    },
    p,
    new Date("2026-11-14T13:00:00.123Z"),
  );
  assert.equal(status.numbers.length, 5);
  assert.equal(
    status.numbers[0]!.label,
    "Public watch hours, 365 days (YPP needs 4,000 by 31 Jan)",
  );
  assert.equal(status.numbers[0]!.value, "312");
  assert.equal(status.updated, "2026-11-14T13:00:00Z");
  const again = mergeStatus(status, p, new Date());
  assert.equal(
    again.numbers.filter((x) => x.label.startsWith("Public watch hours"))
      .length,
    1,
  );
});

test("answer pack pieces join up for a ranking too: ranks keep their names", () => {
  const pack = answerPack(
    {
      hook: "These are the five best GTA games, ranked by how they changed the series.",
      beats: [],
      pulse_take: { label: "", narration: "", on_screen: "" },
    },
    ["0:00 Intro", "1:00 #5 GTA IV", "2:00 #4 Vice City", "3:00 Our pick"],
    [],
  );
  assert.deepEqual(
    pack.chapters.map((c) => c.title),
    ["Intro", "#5 GTA IV", "#4 Vice City", "Our pick"],
  );
  assert.equal(pack.facts.length, 0);
});

test("the writer's own description leads the summary when it says enough; conditional and structural lines are never key facts", () => {
  const script = {
    hook: "Your console's storage screen could decide how your first evening begins.",
    beats: [],
    pulse_take: { label: "", narration: "", on_screen: "" },
    youtube: {
      description:
        "We check 30 GTA 6 claims in the order you'll meet them, from buying to police, money and cars. Every verdict names its source and separates confirmed details from reports. More at https://pulsegmg.com.",
    },
  };
  assert.equal(
    summaryLead(script),
    "We check 30 GTA 6 claims in the order you'll meet them, from buying to police, money and cars. Every verdict names its source and separates confirmed details from reports.",
  );
  assert.equal(summaryLead({ ...script, youtube: { description: "All of it. Game by game." } }), "Your console's storage screen could decide how your first evening begins.");
  // Under 2 never makes the list (keyFacts).
  assert.ok(factScore("If you play Grand Theft Auto 5 on current consoles, you may expect a 60 fps option.") < 2);
  assert.ok(factScore("Check 14 is Reported through GamesRadar's account of a Rockstar demonstration in 2026.") < 2);
  assert.ok(factScore("Rockstar confirms the preload requires up to 212 GB, depending on your device.") >= 2);
});
