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
