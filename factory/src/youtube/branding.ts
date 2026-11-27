// The channel's banner, set through the API: upload the image, then point the
// channel's branding at it, keeping every other branding field as it was.

import fs from "node:fs/promises";
import { fetchWithTimeout } from "../lib/util.ts";

const API = "https://www.googleapis.com/youtube/v3";

export async function setChannelBanner(
  token: string,
  file: string,
  description?: string,
): Promise<{ channelId: string; bannerUrl: string }> {
  const auth = { authorization: `Bearer ${token}` };
  const image = await fs.readFile(file);
  const up = await fetchWithTimeout(
    "https://www.googleapis.com/upload/youtube/v3/channelBanners/insert?uploadType=media",
    {
      method: "POST",
      headers: {
        ...auth,
        "content-type": file.endsWith(".png") ? "image/png" : "image/jpeg",
      },
      body: image,
    },
    120_000,
  );
  const upBody = (await up.json()) as {
    url?: string;
    error?: { message?: string };
  };
  if (!up.ok || !upBody.url)
    throw new Error(
      `banner upload failed: HTTP ${up.status} ${upBody.error?.message ?? ""}`,
    );
  const list = await fetchWithTimeout(
    `${API}/channels?part=brandingSettings&mine=true`,
    { headers: auth },
  );
  const listBody = (await list.json()) as {
    items?: Array<{ id: string; brandingSettings?: Record<string, any> }>;
    error?: { message?: string };
  };
  const channel = listBody.items?.[0];
  if (!list.ok || !channel)
    throw new Error(
      `channel lookup failed: HTTP ${list.status} ${listBody.error?.message ?? ""}`,
    );
  const brandingSettings = {
    ...(channel.brandingSettings ?? {}),
    image: {
      ...(channel.brandingSettings?.image ?? {}),
      bannerExternalUrl: upBody.url,
    },
    ...(description
      ? { channel: { ...(channel.brandingSettings?.channel ?? {}), description: description.slice(0, 1000) } }
      : {}),
  };
  const upd = await fetchWithTimeout(`${API}/channels?part=brandingSettings`, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ id: channel.id, brandingSettings }),
  });
  if (!upd.ok)
    throw new Error(
      `banner update failed: HTTP ${upd.status} ${(await upd.text()).slice(0, 300)}`,
    );
  return { channelId: channel.id, bannerUrl: upBody.url };
}

// ------------------------------------------------------------------ the series channel page (format plan item 8)

export interface ChannelSection {
  id: string;
  type: string;
  position: number;
  playlists: string[];
}

/** The channel page's shelves, as the channelSections API holds them (1 unit). */
export async function listChannelSections(
  token: string,
): Promise<ChannelSection[]> {
  const res = await fetchWithTimeout(
    `${API}/channelSections?part=snippet,contentDetails&mine=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const body = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet?: { type?: string; position?: number };
      contentDetails?: { playlists?: string[] };
    }>;
    error?: { message?: string };
  };
  if (!res.ok)
    throw new Error(
      `channelSections.list failed: HTTP ${res.status} ${body.error?.message ?? ""}`,
    );
  return (body.items ?? []).map((x) => ({
    id: x.id,
    type: x.snippet?.type ?? "",
    position: x.snippet?.position ?? 0,
    playlists: x.contentDetails?.playlists ?? [],
  }));
}

/** Puts one playlist shelf at a position: a new section, or an existing one moved (50 units). */
export async function putPlaylistSection(
  token: string,
  op: { id?: string; playlistId: string; position: number },
): Promise<void> {
  const res = await fetchWithTimeout(
    `${API}/channelSections?part=snippet,contentDetails`,
    {
      method: op.id ? "PUT" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...(op.id ? { id: op.id } : {}),
        snippet: { type: "singlePlaylist", position: op.position },
        contentDetails: { playlists: [op.playlistId] },
      }),
    },
  );
  if (!res.ok)
    throw new Error(
      `channelSections.${op.id ? "update" : "insert"} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`,
    );
}

/**
 * The channel's description and the video new visitors see first (brandingSettings.channel.unsubscribedTrailer),
 * keeping every other branding field as it was (1 + 50 units).
 */
export async function setChannelText(
  token: string,
  o: { description?: string; trailer?: string },
): Promise<{ channelId: string }> {
  const auth = { authorization: `Bearer ${token}` };
  const list = await fetchWithTimeout(
    `${API}/channels?part=brandingSettings&mine=true`,
    { headers: auth },
  );
  const listBody = (await list.json()) as {
    items?: Array<{ id: string; brandingSettings?: Record<string, any> }>;
    error?: { message?: string };
  };
  const channel = listBody.items?.[0];
  if (!list.ok || !channel)
    throw new Error(
      `channel lookup failed: HTTP ${list.status} ${listBody.error?.message ?? ""}`,
    );
  const brandingSettings = {
    ...(channel.brandingSettings ?? {}),
    channel: {
      ...(channel.brandingSettings?.channel ?? {}),
      ...(o.description ? { description: o.description.slice(0, 1000) } : {}),
      ...(o.trailer ? { unsubscribedTrailer: o.trailer } : {}),
    },
  };
  const upd = await fetchWithTimeout(`${API}/channels?part=brandingSettings`, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ id: channel.id, brandingSettings }),
  });
  if (!upd.ok)
    throw new Error(
      `channel update failed: HTTP ${upd.status} ${(await upd.text()).slice(0, 300)}`,
    );
  return { channelId: channel.id };
}

/** The channel's playlist with this title, read only (1 unit). */
export async function findPlaylistId(
  token: string,
  title: string,
): Promise<string | undefined> {
  const res = await fetchWithTimeout(
    `${API}/playlists?part=snippet&mine=true&maxResults=50`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok)
    throw new Error(`playlists.list failed: HTTP ${res.status}`);
  const items = ((await res.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string } }>;
  }).items ?? [];
  return items.find((p) => p.snippet?.title === title)?.id;
}
