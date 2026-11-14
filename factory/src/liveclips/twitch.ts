// Twitch for near-live clips (LIVE_CLIPS): is the owner live (Helix, the factory's own app login, the same one IGDB
// uses), the clips viewers make, the VOD a finished stream became, and the chat (the anonymous read-only IRC login
// Twitch documents for reading public chat: no account, nothing is ever sent to the channel).

import type { ChatLine, ViewerClip } from "./detect.ts";

export interface LiveStream {
  id: string;
  startedAt: string;
  title: string;
  game: string;
  viewers: number;
}

type Fetch = typeof fetch;

export class Helix {
  private token = "";
  private expires = 0;
  private userIds = new Map<string, string>();

  constructor(
    private clientId: string,
    private secret: string,
    private fetchFn: Fetch = fetch,
  ) {}

  get ready(): boolean {
    return Boolean(this.clientId && this.secret);
  }

  private async auth(): Promise<string> {
    if (this.token && Date.now() < this.expires - 60_000) return this.token;
    const r = await this.fetchFn(
      `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(this.clientId)}&client_secret=${encodeURIComponent(this.secret)}&grant_type=client_credentials`,
      { method: "POST", signal: AbortSignal.timeout(15_000) },
    );
    if (!r.ok) throw new Error(`Twitch login ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.token = j.access_token;
    this.expires = Date.now() + j.expires_in * 1000;
    return this.token;
  }

  async get<T>(pathAndQuery: string): Promise<T> {
    const r = await this.fetchFn(
      `https://api.twitch.tv/helix/${pathAndQuery}`,
      {
        headers: {
          "Client-Id": this.clientId,
          Authorization: `Bearer ${await this.auth()}`,
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (r.status === 401) this.token = "";
    if (!r.ok)
      throw new Error(`Twitch ${pathAndQuery.split("?")[0]} ${r.status}`);
    return (await r.json()) as T;
  }

  async userId(login: string): Promise<string> {
    const known = this.userIds.get(login);
    if (known) return known;
    const j = await this.get<{ data: Array<{ id: string }> }>(
      `users?login=${encodeURIComponent(login)}`,
    );
    const id = j.data[0]?.id;
    if (!id) throw new Error(`no Twitch user ${login}`);
    this.userIds.set(login, id);
    return id;
  }

  /** The stream when the channel is live, otherwise undefined. */
  async live(login: string): Promise<LiveStream | undefined> {
    const j = await this.get<{
      data: Array<{
        id: string;
        started_at: string;
        title: string;
        game_name: string;
        viewer_count: number;
        type: string;
      }>;
    }>(`streams?user_id=${await this.userId(login)}`);
    const s = j.data.find((x) => x.type === "live");
    return s
      ? {
          id: s.id,
          startedAt: s.started_at,
          title: s.title,
          game: s.game_name,
          viewers: s.viewer_count,
        }
      : undefined;
  }

  /** Clips viewers made since a time (Helix lists them within a minute or two of being made). */
  async clipsSince(login: string, since: string): Promise<ViewerClip[]> {
    const j = await this.get<{
      data: Array<{
        id: string;
        url: string;
        title: string;
        creator_name: string;
        created_at: string;
      }>;
    }>(
      `clips?broadcaster_id=${await this.userId(login)}&started_at=${encodeURIComponent(since)}&first=50`,
    );
    return j.data.map((c) => ({
      id: c.id,
      url: c.url,
      title: c.title,
      creator: c.creator_name,
      at: Date.parse(c.created_at),
    }));
  }

  /** The past broadcast a stream became ("v123"), once Twitch lists it. */
  async vodFor(login: string, streamId: string): Promise<string | undefined> {
    const j = await this.get<{
      data: Array<{ id: string; stream_id: string | null }>;
    }>(`videos?user_id=${await this.userId(login)}&type=archive&first=5`);
    const v = j.data.find((x) => x.stream_id === streamId);
    return v ? `v${v.id}` : undefined;
  }
}

/** A chat message from one IRC line with tags, or undefined for anything else (pure). */
export function parseIrcLine(line: string): ChatLine | undefined {
  const m = line.match(/^@(\S+) :([^!\s]+)!\S+ PRIVMSG #\S+ :(.*)$/);
  if (!m) return undefined;
  const tags = Object.fromEntries(
    m[1]!.split(";").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
  const at = Number(tags["tmi-sent-ts"]) || Date.now();
  return {
    at,
    user: tags["display-name"] || m[2]!,
    text: m[3]!.replace(/\r$/, ""),
  };
}

export interface ChatReader {
  close(): void;
}

/**
 * Reads the channel's chat over Twitch's WebSocket IRC as an anonymous "justinfan" user (read only: Twitch accepts it
 * without a login and it can never post). Reconnects with a growing wait when the connection drops.
 */
export function readChat(
  channel: string,
  onLine: (l: ChatLine) => void,
  onState: (s: string) => void = () => undefined,
): ChatReader {
  let ws: WebSocket | undefined;
  let closed = false;
  let wait = 2_000;
  const connect = () => {
    if (closed) return;
    ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    ws.onopen = () => {
      wait = 2_000;
      ws!.send("CAP REQ :twitch.tv/tags");
      ws!.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      ws!.send(`JOIN #${channel}`);
      onState("connected");
    };
    ws.onmessage = (ev) => {
      for (const line of String(ev.data).split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) ws!.send(line.replace("PING", "PONG"));
        const l = parseIrcLine(line);
        if (l) onLine(l);
      }
    };
    ws.onclose = () => {
      onState("disconnected");
      if (closed) return;
      setTimeout(connect, wait);
      wait = Math.min(120_000, wait * 2);
    };
    ws.onerror = () => ws?.close();
  };
  connect();
  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}
