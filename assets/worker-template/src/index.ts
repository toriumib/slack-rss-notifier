export interface Env {
  RSS_STATE: KVNamespace;
  SLACK_BOT_TOKEN: string;
  SLACK_USER_ID: string;
  ADMIN_TOKEN: string;
  FEEDS: string;
  BOOTSTRAP_SKIP_EXISTING: string;
}

type Feed = { name: string; url: string };
type Item = { id: string; title: string; url: string; published?: string };

const MAX_ITEMS_PER_FEED = 5;
const MAX_SEEN_PER_FEED = 100;

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, "").trim();
}

function field(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

export function parseFeed(xml: string, feedName: string): Item[] {
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  return blocks.slice(0, MAX_ITEMS_PER_FEED).map((block, index) => {
    const title = field(block, "title") || "Untitled article";
    const url = field(block, "link") || block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || "";
    const id = field(block, "guid") || field(block, "id") || url || `${feedName}:${title}:${index}`;
    const published = field(block, "pubDate") || field(block, "published") || field(block, "updated");
    return { id, title, url, published };
  }).filter((item) => item.url);
}

async function slack(env: Env, method: string, body: unknown): Promise<void> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  });
  const result = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(`Slack ${method} failed: ${result.error ?? response.status}`);
}

async function notify(env: Env, feed: Feed, item: Item): Promise<void> {
  const dm = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ users: env.SLACK_USER_ID })
  });
  const dmResult = await dm.json() as { ok?: boolean; error?: string; channel?: { id?: string } };
  if (!dm.ok || !dmResult.ok || !dmResult.channel?.id) throw new Error(`Slack conversations.open failed: ${dmResult.error ?? dm.status}`);
  const text = `*${feed.name}*\n<${item.url}|${item.title}>${item.published ? `\n_${item.published}_` : ""}`;
  await slack(env, "chat.postMessage", { channel: dmResult.channel.id, text, unfurl_links: false });
}

function feedsFrom(env: Env): Feed[] {
  const feeds = JSON.parse(env.FEEDS) as Feed[];
  return feeds.filter((feed) => feed.name && /^https?:\/\//i.test(feed.url));
}

export async function run(env: Env): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const result = { sent: 0, skipped: 0, errors: [] as string[] };
  for (const feed of feedsFrom(env)) {
    try {
      const response = await fetch(feed.url, { headers: { "User-Agent": "slack-rss-notifier/1.0" } });
      if (!response.ok) throw new Error(`feed returned ${response.status}`);
      const items = parseFeed(await response.text(), feed.name);
      const key = `seen:${encodeURIComponent(feed.url)}`;
      const seen = await env.RSS_STATE.get<string[]>(key, "json") ?? [];
      const fresh = items.filter((item) => !seen.includes(item.id));
      const shouldSkip = env.BOOTSTRAP_SKIP_EXISTING !== "false" && seen.length === 0;
      if (shouldSkip) { await env.RSS_STATE.put(key, JSON.stringify(items.map((item) => item.id).slice(0, MAX_SEEN_PER_FEED))); result.skipped += fresh.length; continue; }
      for (const item of fresh.reverse()) { await notify(env, feed, item); result.sent++; }
      await env.RSS_STATE.put(key, JSON.stringify([...items.map((item) => item.id), ...seen].slice(0, MAX_SEEN_PER_FEED)));
    } catch (error) { result.errors.push(`${feed.name}: ${error instanceof Error ? error.message : "unknown error"}`); }
  }
  console.log(JSON.stringify({ event: "rss_run", sent: result.sent, skipped: result.skipped, errors: result.errors.length }));
  return result;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(run(env)); },
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/run") {
      if (request.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("Unauthorized", { status: 401 });
      return Response.json(await run(env));
    }
    return Response.json({ ok: true, service: "slack-rss-notifier" });
  }
};
