"use strict";

// The Discord bot's XP and daily-streak files hold Discord user IDs, which are
// personal data, and this repo is public. They are runtime data only: never
// tracked, ignored by git, and created by the bot the first time it needs them.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const { XpManager, DailyManager } = require("../../discord/stores");

test("discord runtime data files are ignored and not tracked", () => {
  const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  for (const f of ["discord/data/xp.json", "discord/data/daily.json"]) {
    assert.ok(
      ignore.split(/\r?\n/).includes(f),
      `${f} must be listed in .gitignore`,
    );
    let tracked = "";
    try {
      tracked = execFileSync("git", ["ls-files", "--", f], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim();
    } catch {
      return; // not a git checkout (e.g. a packaged copy): the .gitignore check is enough
    }
    assert.equal(tracked, "", `${f} must not be tracked`);
  }
});

test("the XP store starts empty and creates its file on first use", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-discord-"));
  const file = path.join(dir, "xp.json");
  const xp = new XpManager(file);
  assert.equal(fs.existsSync(file), false);
  xp.addXp("123456789012345678", 20);
  assert.equal(fs.existsSync(file), true);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved["123456789012345678"].xp, 20);
  // A new manager reads it back.
  assert.equal(new XpManager(file).getUser("123456789012345678").xp, 20);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the daily store starts empty and creates its file on first claim", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-discord-"));
  const file = path.join(dir, "daily.json");
  const daily = new DailyManager(file);
  assert.equal(fs.existsSync(file), false);
  const first = daily.claim("123456789012345678");
  assert.equal(first.success, true);
  assert.equal(fs.existsSync(file), true);
  assert.equal(
    new DailyManager(file).claim("123456789012345678").success,
    false,
    "a second claim the same day is refused, so the file was read back",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the bot uses the shared stores rather than its own copies", () => {
  const bot = fs.readFileSync(path.join(ROOT, "discord", "bot.js"), "utf8");
  assert.match(bot, /require\('\.\/stores'\)/);
  assert.doesNotMatch(bot, /class XpManager|class DailyManager/);
});
