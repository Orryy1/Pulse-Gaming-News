// How the owner reads the list (pure): a phone-sized private page (served unlinked and noindex at /asks/<key>), the
// same list as a markdown file, and the one short Discord message before he goes live (the top five, one line each
// on how to test). Rumours always say so; a verdict always says which stream showed it.

import crypto from "node:crypto";
import { openAsks, type StreamAsk } from "./asks.ts";

/** The page's unguessable path part, made from the factory's secret (stable across restarts). */
export function asksKey(secret: string): string {
  return crypto
    .createHmac("sha256", `pulse-asks:${secret || "unset"}`)
    .update("streamasks")
    .digest("base64url")
    .slice(0, 22);
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

const label = (a: StreamAsk) => (a.rumour ? "RUMOUR, unconfirmed: " : "");

const srcLine = (a: StreamAsk) => {
  const names = [
    ...new Set(
      a.mentions.map((m) =>
        m.name.replace(/^YouTube comments: .*/, "YouTube comments"),
      ),
    ),
  ];
  return names.slice(0, 4).join(", ");
};

const verdictLine = (a: StreamAsk) =>
  a.verdict
    ? `${a.verdict.result === "proved" ? "PROVED" : "DISPROVED"} on the ${a.verdict.recordedOn || a.verdict.vodId} stream at ${clock(a.verdict.at)} (${Math.round(a.verdict.confidence * 100)}% sure): ${a.verdict.reason}`
    : "";

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

/** The list as markdown: open asks per game best first, then what the streams settled. */
export function asksMarkdown(
  asks: StreamAsk[],
  now: Date,
  notes: string[] = [],
): string {
  const games = [...new Set(asks.map((a) => a.game))];
  const out: string[] = [
    `# Stream asks (${now.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
    "",
    "What people want tested, from the press, Bluesky, YouTube comments and Pulse's own viewers, best first. Rumours are labelled; nothing here is a fact until a stream shows it. No story spoilers: story questions wait until the spoiler window closes.",
    "",
  ];
  for (const game of games) {
    const open = openAsks(asks, game);
    out.push(`## ${game}: ${open.length} open`, "");
    out.push(
      "| # | Ask | How to test | Why it is here | Sources |",
      "| --- | --- | --- | --- | --- |",
    );
    open.forEach((a, i) =>
      out.push(
        `| ${i + 1} | ${label(a)}${a.question.replace(/\|/g, "/")} | ${a.howToTest.replace(/\|/g, "/")} | ${(a.why ?? []).join(", ")}; score ${a.score ?? 0} | ${srcLine(a).replace(/\|/g, "/")} |`,
      ),
    );
    const done = asks.filter(
      (a) =>
        a.game === game && (a.status === "proved" || a.status === "disproved"),
    );
    if (done.length) {
      out.push("", "### Settled by the streams", "");
      for (const a of done) out.push(`- ${a.question} ${verdictLine(a)}`);
    }
    const held = asks.filter((a) => a.game === game && a.status === "held");
    if (held.length)
      out.push(
        "",
        `${held.length} story question(s) held until the spoiler window closes.`,
      );
    out.push("");
  }
  if (notes.length) out.push("Sources this refresh: " + notes.join("; "), "");
  return out.join("\n");
}

/** The private page: plain HTML, readable on a phone, noindex. */
export function asksHtml(asks: StreamAsk[], now: Date): string {
  const games = [...new Set(asks.map((a) => a.game))];
  const card = (
    a: StreamAsk,
    i: number,
  ) => `<li><b>${i + 1}. ${a.rumour ? '<span class="r">RUMOUR</span> ' : ""}${esc(a.question)}</b>
<div class="t">Test: ${esc(a.howToTest)}</div>
<div class="m">${esc((a.why ?? []).join(" · "))}${srcLine(a) ? ` · ${esc(srcLine(a))}` : ""}</div>${
    a.mentions[0] && a.mentions[0].source !== "seed"
      ? `<div class="q">"${esc(a.mentions[0].text.slice(0, 160))}"${a.mentions[0].url ? ` <a href="${esc(a.mentions[0].url)}" rel="nofollow noreferrer">source</a>` : ""}</div>`
      : ""
  }</li>`;
  const body = games
    .map((g) => {
      const open = openAsks(asks, g);
      const done = asks.filter(
        (a) =>
          a.game === g && (a.status === "proved" || a.status === "disproved"),
      );
      return `<h2>${esc(g)}</h2><ol>${open.map(card).join("\n")}</ol>${
        done.length
          ? `<h3>Settled by your streams</h3><ul>${done.map((a) => `<li>${esc(a.question)} <i>${esc(verdictLine(a))}</i></li>`).join("")}</ul>`
          : ""
      }`;
    })
    .join("\n");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Stream asks</title>
<style>body{font:16px/1.4 system-ui,sans-serif;margin:0 auto;max-width:42rem;padding:1rem;background:#0f1115;color:#eee}h1{font-size:1.3rem}h2{color:#ff6b1a}li{margin:.9rem 0}.t{margin:.2rem 0}.m,.q{color:#aaa;font-size:.85rem}.r{background:#ffc21a;color:#000;padding:0 .3rem;border-radius:3px;font-size:.75rem}a{color:#ff9a5a}</style>
</head><body><h1>Stream asks</h1><p class="m">Updated ${esc(now.toISOString().slice(0, 16).replace("T", " "))} UTC. What people want tested, best first. Rumours are labelled; story questions wait for the spoiler window.</p>${body}</body></html>`;
}

/** The daily message: the top asks with one line each on how to test, and the page's link. */
export function dailyMessage(
  asks: StreamAsk[],
  top: number,
  link: string,
): string {
  const open = asks.filter((a) => a.status === "open").slice(0, top);
  if (!open.length) return "";
  const lines = open.map(
    (a, i) => `${i + 1}. ${label(a)}${a.question}\n   Test: ${a.howToTest}`,
  );
  return [
    `Stream asks for today: what people want you to test (${open[0]!.game}${new Set(open.map((a) => a.game)).size > 1 ? " and more" : ""}).`,
    ...lines,
    'Say the test out loud on stream ("Testing: ...") and I will find the moment in tonight\'s VOD.',
    link ? `Full list: ${link}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1900);
}
