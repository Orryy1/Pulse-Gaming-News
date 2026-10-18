import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFile, stockQuery } from "../src/assets/stock.ts";
import { pickStoryVideo, storyWords, parseSocialListing, pickSocialPost } from "../src/assets/officialTrailer.ts";

test("stock: the smallest file that is still 1080p, and a query without game words", () => {
  const v = { id: 1, url: "u", duration: 12, video_files: [
    { link: "a", width: 3840, height: 2160, file_type: "video/mp4" },
    { link: "b", width: 1920, height: 1080, file_type: "video/mp4" },
    { link: "c", width: 960, height: 540, file_type: "video/mp4" },
  ] };
  assert.equal(pickFile(v)?.link, "b");
  assert.equal(pickFile({ ...v, video_files: [v.video_files[2]!] })?.link, "c");
  assert.equal(stockQuery({ key: "beat:0", text: "", want: "vehicle", energy: "medium", keywords: ["Vice City police Lamborghini", "Miami"] }, ["GTA", "6", "Vice", "City"]), "police Lamborghini Miami");
});

test("story video: only a publisher channel, only since the story, and the title must share a story word", () => {
  const after = new Date("2026-10-10T00:00:00Z");
  const subs = new Map([["rs", 10_000_000], ["fan", 5_000_000]]);
  const item = (o: Partial<{ videoId: string; title: string; channelId: string; channelTitle: string; publishedAt: string }>) => ({ videoId: "v", title: "Grand Theft Auto VI comes to Miami", channelId: "rs", channelTitle: "Rockstar Games", publishedAt: "2026-10-16T00:00:00Z", ...o });
  const story = "GTA 6 cars appear in real life as part of a Miami marketing push";
  assert.deepEqual(storyWords(story, "Grand Theft Auto VI"), ["gta", "cars", "appear", "real", "life", "part", "miami", "marketing", "push"]);
  assert.equal(pickStoryVideo([item({})], "Grand Theft Auto VI", story, after, subs)?.videoId, "v");
  assert.equal(pickStoryVideo([item({ publishedAt: "2026-09-01T00:00:00Z" })], "Grand Theft Auto VI", story, after, subs), undefined, "too old");
  assert.equal(pickStoryVideo([item({ channelId: "fan", channelTitle: "GTA Fan Hub" })], "Grand Theft Auto VI", story, after, subs), undefined, "not a publisher");
  assert.equal(pickStoryVideo([item({ title: "Grand Theft Auto VI Trailer 3" })], "Grand Theft Auto VI", story, after, subs), undefined, "not about the story");
  assert.equal(pickStoryVideo([item({})], "Grand Theft Auto VI", story, after, subs)?.clipSeconds, 6, "Rockstar's cap holds");
});

test("official social posts: parsed from yt-dlp's listing, matched to the story, never older than it", () => {
  const listing = "7696925363795938573 | 20261015 | Watch the Grand Theft Auto VI Launch Trailer, featuring Vice City\n7701000000000000000 | 20261016 | Vice City came to Miami: GTA VI cars on real streets #GTAVI\nnot a line";
  const posts = parseSocialListing(listing, "rockstargames");
  assert.equal(posts.length, 2);
  assert.equal(posts[1]!.url, "https://www.tiktok.com/@rockstargames/video/7701000000000000000");
  assert.equal(posts[1]!.date, "2026-10-16");
  const story = "GTA 6 cars appear in real life as part of a Miami marketing push";
  assert.equal(pickSocialPost(posts, "Grand Theft Auto VI", story, new Date("2026-10-10T00:00:00Z"))?.date, "2026-10-16");
  assert.equal(pickSocialPost(posts, "Grand Theft Auto VI", story, new Date("2026-10-17T00:00:00Z")), undefined, "nothing since the story");
});
