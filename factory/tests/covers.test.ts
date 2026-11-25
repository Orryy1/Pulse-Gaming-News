// SHORT_FULL_COVER (src/social/cover.ts): the profile grids showed half-built titles ("GAVE KRATOS" over "GOD OF WAR")
// because every cover was the first frame, which carries only the opening words and a caption page. These pin the fix:
// a cover still with the whole headline and no caption, and that cover handed to each platform the way it takes one.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { coverStillProps } from "../src/render/render.ts";
import { bufferVideoInput } from "../src/social/buffer.ts";
import {
  COVER_FILE,
  COVER_HOLD_SECONDS,
  COVER_OFFSET_MS,
  SOCIAL_FILE,
  coverOf,
  socialCut,
  socialCutArgs,
} from "../src/social/cover.ts";
import {
  coverParams,
  coverRefused,
  postInstagramReel,
  postTikTok,
} from "../src/social/platforms.ts";
import { crosspostTick } from "../src/social/crosspost.ts";
import { approvalLinks } from "../src/pipeline.ts";
import { goodScript, testConfig, testDb, tmpDir } from "./helpers.ts";

test("cover still: the whole headline in place of the opening words, and no caption", () => {
  const props: { headline: string; openingWords?: string; gameTitle: string; coverStill?: boolean } = {
    headline: "Why God of War Gave Kratos a Son",
    openingWords: "GAVE KRATOS",
    gameTitle: "God of War",
  };
  const cover = coverStillProps(props);
  assert.equal(
    cover.openingWords,
    undefined,
    "the opening words give way to the headline",
  );
  assert.equal("openingWords" in cover, false);
  assert.equal(
    cover.coverStill,
    true,
    "the composition leaves the caption out",
  );
  assert.equal(cover.headline, props.headline);
  assert.equal(cover.gameTitle, "God of War");
  assert.equal(
    props.openingWords,
    "GAVE KRATOS",
    "the Short's own props are untouched",
  );
});

test("Buffer: the cover moment goes in the video's thumbnailOffset, and nothing changes without one", () => {
  const plain = bufferVideoInput("ch1", "https://x.test/v.mp4", "caption");
  assert.deepEqual(plain.assets, [{ video: { url: "https://x.test/v.mp4" } }]);
  assert.equal(plain.mode, "shareNow");
  const covered = bufferVideoInput(
    "ch1",
    "https://x.test/s.mp4",
    "caption",
    200,
  );
  assert.deepEqual(covered.assets, [
    {
      video: {
        url: "https://x.test/s.mp4",
        metadata: { thumbnailOffset: 200 },
      },
    },
  ]);
  assert.equal(
    JSON.stringify(covered).includes("thumbnailUrl"),
    false,
    "Buffer refuses a picture for video",
  );
  assert.deepEqual(bufferVideoInput("ch1", "u", "c", Number.NaN).assets, [
    { video: { url: "u" } },
  ]);
});

test("social copy: the cover holds, cuts to the opening, and the cover moment sits inside the hold", () => {
  assert.ok(COVER_OFFSET_MS > 1000 / 30, "clear of the very first frame");
  assert.ok(
    COVER_OFFSET_MS < COVER_HOLD_SECONDS * 1000,
    "before the cut",
  );
  const args = socialCutArgs("in.mp4", "cover.jpg", "out.mp4");
  const graph = args[args.indexOf("-filter_complex") + 1]!;
  assert.doesNotMatch(graph, /fade/, "a cut: a fade ghosts the headline over the opening words");
  assert.match(
    graph,
    /overlay=0:0:eof_action=pass/,
    "the Short plays on beneath, timing untouched",
  );
  assert.equal(
    args[args.indexOf("-c:a") + 1],
    "copy",
    "the sound is the Short's own",
  );
  assert.equal(args.at(-1), "out.mp4");
  assert.equal(
    args[args.indexOf("-t") + 1],
    String(COVER_HOLD_SECONDS),
  );
});

test("social copy: made only with the switch on and a cover, once, and remade when the Short is newer", async () => {
  const dir = await tmpDir();
  const video = path.join(dir, "short.mp4");
  await fs.writeFile(video, "v");
  const runs: string[][] = [];
  const run = async (args: string[]) => {
    runs.push(args);
    await fs.writeFile(args.at(-1)!, "social");
  };
  assert.equal(
    await socialCut(true, video, run),
    undefined,
    "no cover: the Short as it is",
  );
  await fs.writeFile(path.join(dir, COVER_FILE), "jpg");
  assert.equal(
    await socialCut(false, video, run),
    undefined,
    "switch off: the Short as it is",
  );
  assert.equal(coverOf(false, dir), undefined);
  assert.equal(coverOf(true, dir), path.join(dir, COVER_FILE));
  const cut = await socialCut(true, video, run);
  assert.deepEqual(cut, {
    file: path.join(dir, SOCIAL_FILE),
    offsetMs: COVER_OFFSET_MS,
  });
  assert.equal(runs.length, 1);
  assert.equal(
    await fs.readFile(path.join(dir, SOCIAL_FILE), "utf8"),
    "social",
  );
  await socialCut(true, video, run);
  assert.equal(runs.length, 1, "a fresh copy is reused");
  const later = new Date(Date.now() + 60_000);
  await fs.utimes(video, later, later);
  await socialCut(true, video, run);
  assert.equal(runs.length, 2, "a re-rendered Short gets a new copy");
});

test("Instagram: the cover still goes as cover_url, and a refused cover never costs the Reel", async () => {
  assert.deepEqual(coverParams(undefined), {});
  assert.deepEqual(coverParams("https://x.test/c.jpg"), {
    cover_url: "https://x.test/c.jpg",
  });
  assert.ok(coverRefused("instagram container (link): Invalid cover_url"));
  assert.ok(coverRefused("instagram processing failed: ERROR"), "a processing failure may be the cover");
  assert.equal(coverRefused("instagram publish: (#9007) Media is not ready"), false, "never after a publish attempt");
  const bodies: any[] = [];
  let refuse = true;
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/media")) {
      const b = JSON.parse(String(init.body));
      bodies.push(b);
      if (b.cover_url && refuse)
        return new Response(
          JSON.stringify({
            error: { message: "(#100) The cover_url could not be fetched" },
          }),
          {
            status: 400,
          },
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
  const reel = {
    accountId: "1",
    token: "t",
    file: "",
    caption: "c",
    videoUrl: "https://x.test/v.mp4",
    coverUrl: "https://x.test/c.jpg",
  };
  assert.equal(await postInstagramReel(reel, fetchFn as never, 0), "m1");
  assert.ok(
    bodies.some((b) => b.cover_url === "https://x.test/c.jpg"),
    "the cover was offered",
  );
  assert.equal(
    bodies.at(-1).cover_url,
    undefined,
    "then the Reel went with its own frame",
  );
  bodies.length = 0;
  refuse = false;
  assert.equal(await postInstagramReel(reel, fetchFn as never, 0), "m1");
  assert.ok(
    bodies.every((b) => b.cover_url === "https://x.test/c.jpg"),
    "an accepted cover stays",
  );
  bodies.length = 0;
  await postInstagramReel(
    { ...reel, coverUrl: undefined },
    fetchFn as never,
    0,
  );
  assert.ok(
    bodies.every((b) => !("cover_url" in b)),
    "no cover: as before",
  );
});

test("TikTok's own API: the cover moment as video_cover_timestamp_ms, 1500 ms as before without one", async () => {
  const dir = await tmpDir();
  const file = path.join(dir, "v.mp4");
  await fs.writeFile(file, "video");
  const inits: any[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url.includes("/video/init/")) {
      inits.push(JSON.parse(String(init!.body)));
      return new Response(
        JSON.stringify({
          data: { publish_id: "p1", upload_url: "https://up.test/" },
        }),
        { status: 200 },
      );
    }
    if (url.startsWith("https://up.test/"))
      return new Response("", { status: 201 });
    if (url.includes("/status/fetch/"))
      return new Response(
        JSON.stringify({
          data: {
            status: "PUBLISH_COMPLETE",
            publicaly_available_post_id: ["7"],
          },
        }),
        {
          status: 200,
        },
      );
    return new Response("{}", { status: 200 });
  };
  await postTikTok(
    { accessToken: "a", file, title: "t", coverMs: 200 },
    fetchFn as never,
    0,
  ).catch(() => undefined);
  await postTikTok(
    { accessToken: "a", file, title: "t" },
    fetchFn as never,
    0,
  ).catch(() => undefined);
  assert.equal(inits[0].post_info.video_cover_timestamp_ms, 200);
  assert.equal(inits[1].post_info.video_cover_timestamp_ms, 1500);
});

test("signed links: the cover still and the social copy ride on the preview's token", () => {
  const cfg = testConfig("/tmp/x");
  const l = approvalLinks(cfg, "ep_1");
  const token = (u: string) => new URL(u).searchParams.get("t");
  assert.match(l.cover, /\/episodes\/ep_1\/cover\.jpg\?t=/);
  assert.match(l.social, /\/episodes\/ep_1\/social\.mp4\?t=/);
  assert.equal(token(l.cover), token(l.preview));
  assert.equal(token(l.social), token(l.preview));
});

async function publishedShort(
  db: Awaited<ReturnType<typeof testDb>>,
  id: string,
  minutesAgo: number,
) {
  await db.query(
    `INSERT INTO episodes (id, story_hash, story_json, status, lane, script_json, youtube_video_id, publish_at, updated_at)
     VALUES ($1, $1, '{"headline":"x","items":[]}', 'published', 'news', $2, $3, now() - make_interval(mins => $4), now())`,
    [id, JSON.stringify(goodScript()), `yt_${id}`, minutesAgo],
  );
}

test("crossposting with covers: TikTok gets the social copy and its moment, Instagram the cover still", async () => {
  for (const on of [true, false]) {
    const db = await testDb();
    const dir = await tmpDir();
    const cfg = testConfig(dir, { shortFullCover: on });
    await fs.mkdir(path.join(dir, "ep_c"), { recursive: true });
    await fs.writeFile(path.join(dir, "ep_c", "short.mp4"), "x");
    await fs.writeFile(path.join(dir, "ep_c", COVER_FILE), "jpg");
    await publishedShort(db, "ep_c", 180);
    const calls: Record<string, unknown[]> = {};
    const deps = {
      db,
      cfg,
      now: () => new Date(),
      isPublic: async () => true,
      notify: async () => true,
      episodeDir: (id: string) => path.join(dir, id),
      videoUrl: (id: string) => `https://f.test/${id}/video.mp4`,
      coverUrl: (id: string) => `https://f.test/${id}/cover.jpg`,
      socialUrl: (id: string) => `https://f.test/${id}/social.mp4`,
      socialCut: (async (enabled: boolean, video: string) =>
        enabled
          ? {
              file: path.join(path.dirname(video), SOCIAL_FILE),
              offsetMs: COVER_OFFSET_MS,
            }
          : undefined) as never,
      posters: {
        tiktok: async (...a: unknown[]) => ((calls.tiktok = a), "t1"),
        instagram: async (...a: unknown[]) => ((calls.instagram = a), "i1"),
      },
    };
    await crosspostTick(deps);
    assert.ok(calls.tiktok, "TikTok posted");
    if (on) {
      assert.equal(calls.tiktok![0], path.join(dir, "ep_c", SOCIAL_FILE));
      assert.equal(calls.tiktok![2], "https://f.test/ep_c/social.mp4");
      assert.equal(calls.tiktok![3], COVER_OFFSET_MS);
    } else {
      assert.equal(calls.tiktok![0], path.join(dir, "ep_c", "short.mp4"));
      assert.equal(calls.tiktok![2], "https://f.test/ep_c/video.mp4");
      assert.equal(calls.tiktok![3], undefined);
    }
    assert.ok(calls.instagram, "Instagram posted");
    assert.equal(
      calls.instagram![4],
      on ? "https://f.test/ep_c/cover.jpg" : undefined,
    );
    const [ev] = await db.query<{ detail: { cover?: string } }>(
      `SELECT detail FROM events WHERE kind = 'crosspost' AND detail->>'platform' = 'tiktok'`,
    );
    assert.equal(ev?.detail.cover, on ? "social" : undefined);
    await db.close();
  }
});

test("premade restore: the made video gets its own cover back, and copies made from the remake go", async () => {
  const { keepMadeFiles, putMadeFilesBack } = await import("../src/premakerefresh.ts");
  const dir = await tmpDir();
  await fs.writeFile(path.join(dir, "short.mp4"), "made");
  await fs.writeFile(path.join(dir, COVER_FILE), "made cover");
  await keepMadeFiles(dir);
  // The remake renders over both and a social copy is made from it.
  await fs.writeFile(path.join(dir, "short.mp4"), "remake");
  await fs.writeFile(path.join(dir, COVER_FILE), "remake cover");
  await fs.writeFile(path.join(dir, SOCIAL_FILE), "remake social");
  assert.equal(await putMadeFilesBack(dir), true);
  assert.equal(await fs.readFile(path.join(dir, COVER_FILE), "utf8"), "made cover");
  await assert.rejects(fs.stat(path.join(dir, SOCIAL_FILE)), "the remake's social copy is gone");
});
