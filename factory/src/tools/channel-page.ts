// The series channel page (src/channelpage.ts, format plan item 8), applied once through the running factory, which
// holds the YouTube login. Without --apply it is a dry run: it reads the playlists and the shelves and prints the
// description, the banner and the shelf moves it would make, changing nothing. With --apply it changes the page only
// when SERIES_CHANNEL_PAGE is on (not before Sun 22 Nov) and the owner's publishing hold is off. Never changes a video.
// Usage (from factory\): node --import tsx src/tools/channel-page.ts [--apply]
process.loadEnvFile(".env");

const apply = process.argv.includes("--apply");
const port = process.env.PORT || "8080";
const res = await fetch(
  `http://127.0.0.1:${port}/admin/channel-page?apply=${apply ? 1 : 0}`,
  { method: "POST", headers: { "x-admin-key": process.env.ADMIN_TOKEN ?? "" } },
);
if (!res.ok) throw new Error(`channel page failed: HTTP ${res.status}`);
const report = (await res.json()) as { apply?: boolean; errors?: string[] };
console.log(JSON.stringify(report, null, 2));
console.log(
  report.apply
    ? "Applied."
    : "Dry run: nothing on the channel page changed. Add --apply with SERIES_CHANNEL_PAGE=true.",
);
