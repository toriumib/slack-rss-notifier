---
name: slack-rss-notifier
description: Build, configure, test, and deploy a Cloudflare Worker that polls gadget and technology RSS feeds and sends new items to a personal Slack DM.
---

# Slack RSS Notifier

Use the bundled Worker template in `assets/worker-template/` when the user asks to set up or change this notifier. The template uses a scheduled Worker, a KV namespace for deduplication, and a Slack bot token. A personal DM requires the bot token flow (`conversations.open` followed by `chat.postMessage`); an Incoming Webhook alone is suitable for a fixed channel, not for discovering the user's DM.

## Setup

1. Copy `assets/worker-template/` into a new project directory.
2. Edit `wrangler.jsonc` and set a unique Worker name. Create a KV namespace and put its ID in the `RSS_STATE` binding.
3. Review `FEEDS` and `POLL_CRON` in `wrangler.jsonc`. The included feeds are gadget and consumer-tech sources; users can replace or extend them with any RSS or Atom URL.
4. Create a Slack app with a bot token and grant `chat:write` and `im:write`. Install it in the workspace. The bot must be allowed to DM the target user.
5. Store secrets with Wrangler, never in source files:

```text
wrangler secret put SLACK_BOT_TOKEN
wrangler secret put SLACK_USER_IDS
wrangler secret put ADMIN_TOKEN
```

6. Run `wrangler types`, then `npm test` and `wrangler deploy` from the Worker project.

`ADMIN_TOKEN` protects the manual `/run` endpoint. Keep it set in production. `GET /` is a non-sensitive health response. The scheduled handler skips already-seen items and limits each feed to the newest five entries so one bad or unusually large feed cannot create an unbounded send. For a small group in one Slack workspace, put comma-separated Slack User IDs in `SLACK_USER_IDS`; the Worker sends one digest DM per user per run.

## Configuration behavior

- `FEEDS` is a JSON array of `{name,url}` objects.
- The first scheduled run records the current feed entries without sending them when `BOOTSTRAP_SKIP_EXISTING` is `true`.
- Set `BOOTSTRAP_SKIP_EXISTING` to `false` only when the initial backlog should be delivered.
- Atom and RSS feeds are parsed without an XML package so the Worker stays small. Feed parsing is deliberately tolerant of CDATA, namespaces, and common missing fields.
- Slack errors and feed errors are returned in the manual run result and written as structured logs. Secrets and article bodies are never logged.

## Testing and deployment

Use `wrangler dev --test-scheduled` for a local scheduled invocation and `POST /run` with `Authorization: Bearer <ADMIN_TOKEN>` for a manual check. Use `wrangler deploy --dry-run` before production deployment when supported by the installed Wrangler version. After deployment, verify the Worker logs and send one manual run.

Do not add personal names, personal email addresses, or Slack tokens to the project, feed content fixtures, or documentation.
