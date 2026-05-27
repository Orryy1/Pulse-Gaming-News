const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const AUTO_POST_PATH = path.join(__dirname, "..", "..", "discord", "auto_post.js");
const autoPost = require(AUTO_POST_PATH);

test("Discord auto-post login timeout is bounded and configurable", () => {
  assert.equal(autoPost._private.discordLoginTimeoutMs({}), 15000);
  assert.equal(
    autoPost._private.discordLoginTimeoutMs({
      DISCORD_AUTO_POST_LOGIN_TIMEOUT_MS: "2500",
    }),
    2500,
  );
  assert.equal(
    autoPost._private.discordLoginTimeoutMs({
      DISCORD_AUTO_POST_LOGIN_TIMEOUT_MS: "not-a-number",
    }),
    15000,
  );
});

test("Discord auto-post standalone client is not kept by default", () => {
  assert.equal(autoPost._private.keepStandaloneClient({}), false);
  assert.equal(
    autoPost._private.keepStandaloneClient({
      DISCORD_AUTO_POST_KEEP_CLIENT: "true",
    }),
    true,
  );
});

test("Discord auto-post does not import the full bot by default", () => {
  assert.equal(autoPost._private.reuseBotClient({}), false);
  assert.equal(
    autoPost._private.reuseBotClient({
      DISCORD_AUTO_POST_REUSE_BOT_CLIENT: "true",
    }),
    true,
  );
});

test("postVideoUpload has its own public-drop eligibility guard", () => {
  const source = fs.readFileSync(AUTO_POST_PATH, "utf8");
  assert.match(
    source,
    /shouldPostVideoDrop/,
    "postVideoUpload should reuse the same QA/script-failure gate as publisher.js",
  );
  const start = source.indexOf("async function postVideoUpload");
  assert.notEqual(start, -1, "postVideoUpload missing");
  const next = source.indexOf("\nasync function ", start + 1);
  const body = source.slice(start, next === -1 ? source.length : next);
  assert.match(
    body,
    /if\s*\(\s*!\s*shouldPostVideoDrop\s*\(\s*story\s*\)\s*\)/,
    "direct postVideoUpload calls must not bypass QA/script-failure eligibility",
  );
});

test("postNewStory has its own public-news eligibility guard", () => {
  const source = fs.readFileSync(AUTO_POST_PATH, "utf8");
  assert.match(
    source,
    /shouldPostNewStory/,
    "postNewStory should reuse the same script-failure gate as video-drop posts",
  );
  const start = source.indexOf("async function postNewStory");
  assert.notEqual(start, -1, "postNewStory missing");
  const next = source.indexOf("\nasync function ", start + 1);
  const body = source.slice(start, next === -1 ? source.length : next);
  assert.match(
    body,
    /if\s*\(\s*!\s*shouldPostNewStory\s*\(\s*story\s*\)\s*\)/,
    "direct postNewStory calls must not bypass script-failure eligibility",
  );
});

test("postStoryPoll has its own public-poll eligibility guard", () => {
  const source = fs.readFileSync(AUTO_POST_PATH, "utf8");
  assert.match(
    source,
    /shouldPostStoryPoll/,
    "postStoryPoll should reuse the same QA/script-failure gate as publisher.js",
  );
  const start = source.indexOf("async function postStoryPoll");
  assert.notEqual(start, -1, "postStoryPoll missing");
  const next = source.indexOf("\nasync function ", start + 1);
  const body = source.slice(start, next === -1 ? source.length : next);
  assert.match(
    body,
    /if\s*\(\s*!\s*shouldPostStoryPoll\s*\(\s*story\s*\)\s*\)/,
    "direct postStoryPoll calls must not bypass QA/script-failure eligibility",
  );
});

test("postStoryForApproval never falls back to public video-drops", () => {
  const source = fs.readFileSync(AUTO_POST_PATH, "utf8");
  const start = source.indexOf("async function postStoryForApproval");
  assert.notEqual(start, -1, "postStoryForApproval missing");
  const next = source.indexOf("\nasync function ", start + 1);
  const body = source.slice(start, next === -1 ? source.length : next);
  assert.match(body, /idMap\.channels\["mod-log"\]/);
  assert.doesNotMatch(
    body,
    /idMap\.channels\["video-drops"\]/,
    "approval posts must not fall back to the public video-drops channel",
  );
});

test("pingEarlyAccess has its own public-drop eligibility guard", () => {
  const source = fs.readFileSync(AUTO_POST_PATH, "utf8");
  const start = source.indexOf("async function pingEarlyAccess");
  assert.notEqual(start, -1, "pingEarlyAccess missing");
  const next = source.indexOf("\nasync function ", start + 1);
  const body = source.slice(start, next === -1 ? source.length : next);
  assert.match(
    body,
    /if\s*\(\s*!\s*shouldPostVideoDrop\s*\(\s*storyForGate\s*\)\s*\)/,
    "early-access pings must not bypass the video-drop QA/script-failure gate",
  );
});

test("server cron publish summary uses canonical renderer", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "server.js"),
    "utf8",
  );
  const marker = 'dispatchSource: "server_cron_publish_window"';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "server cron publish dispatch missing");
  const body = source.slice(start, start + 1200);
  assert.match(body, /renderPublishSummary/);
  assert.doesNotMatch(
    body,
    /\*\*Pulse Gaming Published\*\* \(\$\{windowLabels\[i\]\}\)/,
    "server cron must not hand-roll a success summary for blocked/failed publish results",
  );
});

test("breaking fast lane summary uses canonical renderer when publishing runs", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "breaking_queue.js"),
    "utf8",
  );
  assert.match(source, /renderPublishSummary\(publishResult\)/);
  assert.doesNotMatch(
    source,
    /\*\*BREAKING NEWS: Fast Pipeline\*\*/,
    "breaking lane must not always announce a completed pipeline as breaking-news published",
  );
  assert.match(source, /\*\*BREAKING FAST PIPELINE RESULT\*\*/);
  assert.match(source, /\*\*BREAKING FAST PIPELINE READY\*\*/);
});

test("Discord auto-post public helpers release standalone clients", () => {
  const source = fs.readFileSync(AUTO_POST_PATH, "utf8");
  assert.match(
    source,
    /if\s*\(\s*reuseBotClient\(\)\s*\)\s*{[\s\S]*require\("\.\/bot"\)/,
    "bot.js import should be guarded behind explicit opt-in",
  );
  for (const helper of [
    "postNewStory",
    "postVideoUpload",
    "postStoryForApproval",
    "postStoryPoll",
    "pingEarlyAccess",
    "getPollResults",
  ]) {
    const start = source.indexOf(`async function ${helper}`);
    assert.notEqual(start, -1, `${helper} missing`);
    const next = source.indexOf("\nasync function ", start + 1);
    const body = source.slice(start, next === -1 ? source.length : next);
    assert.match(
      body,
      /finally\s*{[\s\S]*releaseStandaloneClient\(\);[\s\S]*}/,
      `${helper} should release the temporary Discord client`,
    );
  }
});
