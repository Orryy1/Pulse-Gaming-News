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
