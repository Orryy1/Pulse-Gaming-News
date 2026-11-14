// The owner's one-click Meta login (/connect?account=meta): Facebook's sign-in dialog for the Pulse app, asking
// for posting and, newly, the numbers (insights) and comments. The callback swaps the code for a long-lived
// user token, takes the page's never-expiring page token and its Instagram business account, and saves them
// owner-only beside the other logins (config.ts applyMetaLogin then prefers them to the .env tokens). Nothing
// secret is logged or shown.

import fs from "node:fs";
import path from "node:path";
import type { Config, MetaLogin } from "../config.ts";
import { GRAPH } from "./platforms.ts";

type FetchLike = typeof fetch;

/** What the login asks for, each with what it lets the factory do, in the owner's words. */
export const META_PERMISSIONS: ReadonlyArray<{ scope: string; does: string }> =
  [
    {
      scope: "publish_video",
      does: "post Shorts as reels on the Facebook page",
    },
    {
      scope: "pages_show_list",
      does: "find the Pulse page among the pages you manage",
    },
    {
      scope: "pages_read_engagement",
      does: "read the page's posts, likes and comments",
    },
    { scope: "pages_manage_posts", does: "post and edit on the page" },
    {
      scope: "pages_manage_engagement",
      does: "comment as the page (the YouTube link goes in the first comment)",
    },
    {
      scope: "read_insights",
      does: "read each Facebook reel's numbers: plays, watch time, reach",
    },
    { scope: "instagram_basic", does: "see the Instagram account" },
    {
      scope: "instagram_content_publish",
      does: "post Shorts as Instagram reels",
    },
    {
      scope: "instagram_manage_insights",
      does: "read Instagram numbers: views, reach, watch time, when followers are online",
    },
    {
      scope: "instagram_manage_comments",
      does: "read and answer Instagram comments",
    },
    {
      scope: "business_management",
      does: "reach a page owned through Meta Business",
    },
  ];

export function metaRedirect(
  cfg: Pick<Config, "siteUrl" | "publicUrl">,
): string {
  return `${(cfg.siteUrl || cfg.publicUrl).replace(/\/$/, "")}/oauth/meta`;
}

/** Facebook's sign-in dialog; asks again for anything refused last time. */
export function metaAuthorizeUrl(
  cfg: Pick<
    Config,
    "siteUrl" | "publicUrl" | "facebookAppId" | "facebookLoginConfigId"
  >,
  state: string,
): string {
  const q = new URLSearchParams({
    client_id: cfg.facebookAppId,
    redirect_uri: metaRedirect(cfg),
    state,
    response_type: "code",
    auth_type: "rerequest",
  });
  // An app set up for Facebook Login for Business names a configuration instead of a list of scopes.
  if (cfg.facebookLoginConfigId) q.set("config_id", cfg.facebookLoginConfigId);
  else q.set("scope", META_PERMISSIONS.map((p) => p.scope).join(","));
  return `https://www.facebook.com/v21.0/dialog/oauth?${q}`;
}

async function getJson(
  url: string,
  what: string,
  fetchFn: FetchLike,
): Promise<any> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(20_000) });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.error)
    throw new Error(
      `${what}: ${String(body?.error?.message ?? `HTTP ${res.status}`).slice(0, 300)}`,
    );
  return body;
}

/**
 * Code to saved login: the short-lived user token, the long-lived one, the permissions as granted, then the
 * page's own token (it never expires when taken with a long-lived user token) and its Instagram account.
 */
export async function finishMetaLogin(
  cfg: Pick<
    Config,
    | "siteUrl"
    | "publicUrl"
    | "facebookAppId"
    | "facebookAppSecret"
    | "facebookPageId"
  >,
  code: string,
  fetchFn: FetchLike = fetch,
  now = new Date(),
): Promise<MetaLogin> {
  const app = `client_id=${encodeURIComponent(cfg.facebookAppId)}&client_secret=${encodeURIComponent(cfg.facebookAppSecret)}`;
  const short = await getJson(
    `${GRAPH}/oauth/access_token?${app}&redirect_uri=${encodeURIComponent(metaRedirect(cfg))}&code=${encodeURIComponent(code)}`,
    "sign-in code",
    fetchFn,
  );
  const long = await getJson(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&${app}&fb_exchange_token=${encodeURIComponent(short.access_token)}`,
    "long-lived token",
    fetchFn,
  );
  const user = `access_token=${encodeURIComponent(long.access_token)}`;
  const perms = await getJson(
    `${GRAPH}/me/permissions?${user}`,
    "permissions",
    fetchFn,
  );
  const granted: string[] = [];
  const declined: string[] = [];
  for (const p of perms.data ?? [])
    (p.status === "granted" ? granted : declined).push(String(p.permission));
  // The configured page when the login reaches it; else the only page the owner picked.
  type PageRow = {
    id: string;
    name?: string;
    access_token?: string;
    instagram_business_account?: { id: string };
  };
  let page: PageRow | undefined;
  if (cfg.facebookPageId)
    page = await getJson(
      `${GRAPH}/${encodeURIComponent(cfg.facebookPageId)}?fields=id,name,access_token,instagram_business_account&${user}`,
      "page",
      fetchFn,
    ).catch(() => undefined);
  if (!page?.access_token) {
    const pages: PageRow[] =
      (
        await getJson(
          `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=50&${user}`,
          "pages",
          fetchFn,
        )
      ).data ?? [];
    page =
      pages.find((p) => p.id === cfg.facebookPageId) ??
      (cfg.facebookPageId
        ? undefined
        : pages.length === 1
          ? pages[0]
          : undefined);
  }
  if (!page?.access_token)
    throw new Error(
      cfg.facebookPageId
        ? "the sign-in did not include the Pulse page; start again and tick the page when Facebook asks which pages to share"
        : "no single Facebook page was shared; start again and pick only the Pulse page",
    );
  return {
    pageId: String(page.id),
    pageName: page.name,
    pageToken: page.access_token,
    instagramAccountId: page.instagram_business_account?.id,
    granted,
    declined: [
      ...new Set([
        ...declined,
        ...META_PERMISSIONS.map((p) => p.scope).filter(
          (s) => !granted.includes(s) && !declined.includes(s),
        ),
      ]),
    ],
    savedAt: now.toISOString(),
  };
}

export function saveMetaLogin(file: string, login: MetaLogin): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(login), { mode: 0o600 });
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** The page the owner sees afterwards: what the factory can now do, and what it still cannot. */
export function metaResultHtml(login: MetaLogin): string {
  const item = (scope: string) =>
    `<li>${esc(META_PERMISSIONS.find((p) => p.scope === scope)?.does ?? scope)} <small>(${esc(scope)})</small></li>`;
  const asked = META_PERMISSIONS.map((p) => p.scope);
  const yes = asked.filter((s) => login.granted.includes(s));
  const no = asked.filter((s) => !login.granted.includes(s));
  return `<h1>Facebook and Instagram are connected${login.pageName ? ` as ${esc(login.pageName)}` : ""}.</h1>
<p>${login.instagramAccountId ? "The Instagram account came with it." : "<b>No Instagram account is linked to this page</b>, so Instagram posting and numbers will not work until it is linked in the page's settings."}</p>
<h2>Allowed</h2><ul>${yes.map(item).join("") || "<li>nothing</li>"}</ul>
${no.length ? `<h2>Refused or not offered</h2><ul>${no.map(item).join("")}</ul><p>To allow these, open <a href="/connect?account=meta">/connect?account=meta</a> again and leave every box ticked. If one is never offered, the Pulse app on developers.facebook.com needs it added first.</p>` : "<p>Everything asked for was allowed. You can close this tab.</p>"}`;
}
