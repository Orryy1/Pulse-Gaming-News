"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  buildSceneInput,
  dispatchSceneFilter,
} = require("../../lib/studio/ffmpeg-scene-renderer");
const { buildQuoteBodyLayout } = require("../../lib/scenes/quote-card");

test("visual scenes get compact entity popups instead of anonymous cover slides", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: { title: "Take-Two legacy franchise story" },
    scene: {
      type: SCENE_TYPES.CLIP_FRAME,
      duration: 4,
      source: "frame.jpg",
      entity: "BioShock",
      sourceType: "official_trailer_frame",
    },
  });

  assert.match(filter, /BIOSHOCK/);
  assert.match(filter, /OFFICIAL FRAME/);
  assert.match(filter, /box=1:boxcolor=black@0\.46/);
  assert.match(filter, /alpha='if\(lt\(t\\,0\.12\)/);
  assert.doesNotMatch(filter, /drawbox=x=52:y=108:w=420:h=74/);
});

test("opener hook overlay is compact and avoids the old full-width top slab", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: { hook: "Take-Two killed a legacy sequel. They will not say which one." },
    scene: {
      type: SCENE_TYPES.OPENER,
      duration: 4,
      source: "gta-trailer.m3u8",
      isClipBacked: true,
      entity: "GTA",
      sourceType: "steam_movie",
    },
  });

  assert.doesNotMatch(filter, /h=172:color=black@0\.86/);
  assert.match(filter, /w=760:h=118:color=black@0\.58/);
  assert.match(filter, /GTA/);
});

test("opener entity badge sits below the hook safe area", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: { hook: "GTA just changed the release window." },
    scene: {
      type: SCENE_TYPES.OPENER,
      duration: 4,
      source: "gta-trailer.m3u8",
      isClipBacked: true,
      entity: "GTA",
      sourceType: "steam_movie",
    },
  });

  assert.match(filter, /drawbox=x=72:y=102:w=760:h=118/);
  assert.doesNotMatch(filter, /text='OFFICIAL CLIP'[^,]*:x=74:y=112/);
  assert.doesNotMatch(filter, /text='GTA'[^,]*:x=74:y=152/);
  assert.match(filter, /text='OFFICIAL CLIP'[^,]*:x=74:y=250/);
  assert.match(filter, /text='GTA'[^,]*:x=74:y=290/);
});

test("official clip inputs seek to the selected trailer beat instead of trailer start", () => {
  const input = buildSceneInput({
    type: SCENE_TYPES.CLIP,
    duration: 4,
    source: "https://video.example/trailer.m3u8",
    mediaStartS: 31.2,
  });

  assert.match(input, /^-ss 31\.20 -t 5\.00 -i "https:\/\/video\.example\/trailer\.m3u8"$/);
});

test("official clip inputs do not read past validated safe windows", () => {
  const input = buildSceneInput({
    type: SCENE_TYPES.CLIP,
    duration: 4.2,
    source: "https://video.example/trailer.m3u8",
    mediaStartS: 42.45,
    clipDurationS: 2.85,
  });

  assert.match(input, /^-ss 42\.45 -t 2\.85 -i "https:\/\/video\.example\/trailer\.m3u8"$/);
});

test("speed-ramp inputs are capped to validated clip windows", () => {
  const input = buildSceneInput({
    type: SCENE_TYPES.SPEED_RAMP,
    duration: 4,
    source: "https://video.example/trailer.m3u8",
    mediaStartS: 48.45,
    clipDurationS: 2.95,
  });

  assert.match(input, /^-ss 48\.45 -t 2\.95 -i "https:\/\/video\.example\/trailer\.m3u8"$/);
});

test("clip filters pad safe-window clips instead of pulling later trailer slates", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: { title: "Marathon update" },
    scene: {
      type: SCENE_TYPES.CLIP,
      duration: 4.2,
      source: "https://video.example/trailer.m3u8",
      entity: "Marathon",
      sourceType: "steam_movie",
      clipDurationS: 2.85,
    },
  });

  assert.match(filter, /tpad=stop_mode=clone:stop_duration=1\.35/);
  assert.match(filter, /trim=duration=4\.2,setpts=PTS-STARTPTS/);
});

test("quote card layout downgrades overlong text inside safe bounds", () => {
  const layout = buildQuoteBodyLayout(
    [
      "This quote contains a deliberately excessive community reaction that would keep running",
      "past the safe card body if rendered without a smaller fallback size and truncation.",
      "SupercalifragilisticexpialidociousLongestUnbrokenTokenShouldNotEscape",
    ].join(" "),
  );

  assert.equal(layout.downgraded, true);
  assert.ok(layout.truncated || layout.lines.some((line) => line.includes("...")));
  assert.ok(layout.lines.length <= layout.maxLines);
  assert.ok(layout.lines.every((line) => line.length <= layout.lineMax + 6), layout.lines.join(" | "));
  assert.ok(layout.blockTop >= layout.safeBounds.top);
  assert.ok(layout.blockBottom <= layout.safeBounds.bottom);
});

test("freeze-frame captions wrap long text instead of drawing one cut-off line", () => {
  const filter = dispatchSceneFilter({
    slot: 0,
    fontOpt: "fontfile=Arial",
    story: { title: "Take-Two legacy franchise story" },
    scene: {
      type: SCENE_TYPES.FREEZE_FRAME,
      duration: 4,
      source: "bioshock-trailer.mp4",
      entity: "BioShock",
      sourceType: "steam_movie",
      caption: "Developer passion has become a hard veto for one of the company legacy franchises",
    },
  });

  assert.doesNotMatch(filter, /DEVELOPER PASSION HAS BECOME A HARD VETO FOR ONE OF THE COMPANY LEGACY FRANCHISES/);
  assert.match(filter, /DEVELOPER PASSION HAS/);
  assert.match(filter, /BECOME A HARD VETO/);
  assert.match(filter, /fontsize=48/);
  assert.match(filter, /h=300/);
});
