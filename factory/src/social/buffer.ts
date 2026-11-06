// Buffer's GraphQL API (developers.buffer.com, 6 Nov 2026): TikTok has approved Buffer for public posting, which
// Pulse's own TikTok app is not, so a Short goes out with no tap. Buffer fetches the video itself from the same
// signed public link Instagram and Threads use, and publishes it straight away.

import { fetchWithTimeout } from "../lib/util.ts";

const API = "https://api.buffer.com";

/** Posts a video to one Buffer channel now; returns Buffer's post id. */
export async function bufferPostVideo(
  apiKey: string,
  channelId: string,
  videoUrl: string,
  text: string,
): Promise<string> {
  const query = `mutation Post($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess { post { id } }
      ... on MutationError { message }
    }
  }`;
  const input = {
    channelId,
    text,
    schedulingType: "automatic",
    mode: "shareNow",
    needsApproval: false,
    assets: [{ video: { url: videoUrl } }],
  };
  const res = await fetchWithTimeout(
    API,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { input } }),
    },
    60_000,
  );
  const j = (await res.json().catch(() => ({}))) as {
    data?: { createPost?: { post?: { id?: string }; message?: string } };
    errors?: Array<{ message?: string }>;
  };
  const id = j.data?.createPost?.post?.id;
  if (!res.ok || !id)
    throw new Error(
      `buffer post failed: ${j.data?.createPost?.message ?? j.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`}`.slice(0, 300),
    );
  return `buffer:${id}`;
}
