// Simulcast prep (src/liveclips/simulcast.ts). Read only: nothing is created on YouTube and no setting changes.
//   npx tsx src/tools/simulcast-prep.ts eligibility
//       is live streaming on for the channel the factory's YouTube login belongs to (YOUTUBE_CLIENT_ID, _SECRET and
//       _REFRESH_TOKEN from .env; the database is never opened, so it is safe while the factory runs)
//   npx tsx src/tools/simulcast-prep.ts template --day 1 --date 2026-11-18 [--plan "escaping 5 stars on foot"]
//       [--index data/vodindex/v123/index.json]   the day's title and description, with chapters once indexed

import fs from "node:fs/promises";
import { parseVodIndex } from "../vodindex/schema.ts";
import {
  chaptersFromIndex,
  liveEligibility,
  streamDescription,
  streamTitle,
} from "../liveclips/simulcast.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
try {
  process.loadEnvFile(".env");
} catch {
  // the variables may already be set
}

if (process.argv[2] === "eligibility") {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:
        process.env.GOOGLE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID || "",
      client_secret:
        process.env.GOOGLE_CLIENT_SECRET ||
        process.env.YOUTUBE_CLIENT_SECRET ||
        "",
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN || "",
      grant_type: "refresh_token",
    }),
  });
  const body = (await r.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
  };
  if (!body.access_token) {
    console.error(`no YouTube access: ${body.error ?? r.status}`);
    process.exit(1);
  }
  const result = await liveEligibility(body.access_token);
  console.log(
    JSON.stringify({ ...result, scopes: body.scope?.split(" ") }, null, 2),
  );
} else if (process.argv[2] === "template") {
  const game = arg("game") ?? "Grand Theft Auto VI";
  const day = Number(arg("day") ?? 1);
  const index = arg("index")
    ? parseVodIndex(JSON.parse(await fs.readFile(arg("index")!, "utf8")))
    : undefined;
  console.log(streamTitle({ game, day, plan: arg("plan") }));
  console.log("");
  console.log(
    streamDescription({
      game,
      day,
      date: arg("date") ?? new Date().toISOString().slice(0, 10),
      chapters: index ? chaptersFromIndex(index) : undefined,
      twitch: arg("twitch") ?? "tinotv",
    }),
  );
} else {
  console.error(
    "usage: simulcast-prep.ts eligibility | template --day N --date YYYY-MM-DD [--plan text] [--index file]",
  );
  process.exit(1);
}
