# Slack RSS Notifier Worker

ガジェット系ニュースのRSSをCloudflare WorkersのCronで定期取得し、新着記事をSlackの自分DM、または同じSlackワークスペース内の友達のDMへ送る小さなWorkerです。記事IDはKVに保存するので、同じ記事を何度も通知しません。

![Slack RSS Notifier architecture](docs/architecture.svg)

## できること

- The Verge、Engadget、TechCrunch、9to5Google、ギズモード・ジャパン、AV Watch、ITmedia Mobileを初期登録
- RSS 2.0とAtomを処理
- 1フィードあたり最新5件を確認
- KVで既読記事を管理
- 初回実行時は既存記事を送らず、既読状態だけ登録
- Cron以外に、認証付きの`POST /run`で手動実行
- 複数のSlack User IDを登録して、友達ごとにダイジェストDMを送信
- Workers LogsとTracesを有効化

## 必要なもの

- Cloudflareアカウント
- Node.js 20以上
- Slackワークスペースでアプリを作成できる権限
- SlackアプリのBot Token Scopes: `chat:write`、`im:write`

Slackの個人DMを宛先にするため、Incoming WebhookではなくBot Tokenを使います。Webhookは固定チャンネルへの投稿には便利ですが、個人DMを開く処理には向きません。

## セットアップ

### 1. プロジェクトを用意

このディレクトリをコピーして、Worker用のGitリポジトリにします。

```powershell
Copy-Item -Recurse assets/worker-template C:/work/slack-rss-notifier-worker
Set-Location C:/work/slack-rss-notifier-worker
npm install
```

### 2. KV namespaceを作成

```powershell
npx wrangler kv namespace create RSS_STATE
```

表示されたnamespace IDを`wrangler.jsonc`の`REPLACE_WITH_KV_NAMESPACE_ID`に入れます。ローカルテスト用には次も作成できます。

```powershell
npx wrangler kv namespace create RSS_STATE --preview
```

### 3. Slackアプリを作成

Slack APIのCreate New AppからFrom scratchでアプリを作り、OAuth & PermissionsのBot Token Scopesに次を追加します。

1. `chat:write`
2. `im:write`

ワークスペースへInstallし、`xoxb-`で始まるBot User OAuth Tokenを取得します。Slack User IDはSlackプロフィールの「メンバーIDをコピー」で確認できます。BotがDMできるワークスペースユーザーを指定してください。

### 4. Secretを登録

値をソースコードや`wrangler.jsonc`へ書かず、Wrangler Secretとして登録します。

```powershell
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_USER_IDS
npx wrangler secret put ADMIN_TOKEN
```

`SLACK_USER_IDS`には通知したい人のSlack User IDをカンマ区切りで入れます。例: `U01234567,U07654321`。`ADMIN_TOKEN`は`/run`の手動実行を保護する任意の長いランダム文字列です。

### 友達を追加

友達にはSlackプロフィールから「メンバーIDをコピー」を実行してもらい、そのIDを管理者が`SLACK_USER_IDS`へ追加します。再デプロイは不要で、Secretを更新すれば次のCronから反映されます。

```powershell
npx wrangler secret put SLACK_USER_IDS
```

この共有モードでは、同じRSS設定を全員へ配信します。友達ごとに異なるフィードや通知時間が必要になったら、ユーザー別設定とQueueを追加する段階です。

### 5. フィードを調整

`wrangler.jsonc`の`FEEDS`をJSON配列として編集します。

```json
[
  {"name":"ギズモード・ジャパン","url":"https://www.gizmodo.jp/index.xml"},
  {"name":"My Gadget Feed","url":"https://example.com/feed.xml"}
]
```

Cronは初期設定で毎時0分です。変更する場合は`triggers.crons`を編集してください。`POLL_CRON`は説明用の変数なので、Cronの実体は`triggers.crons`です。

### 6. 型生成・テスト・デプロイ

```powershell
npx wrangler types
npm test
npx wrangler deploy --dry-run
npx wrangler deploy
```

デプロイ後の最初のCron実行は、現在の最新記事を既読として登録するだけで通知しません。既存記事も送りたい場合は、Cloudflare DashboardまたはWranglerで`BOOTSTRAP_SKIP_EXISTING=false`を設定してから一度実行し、完了後に`true`へ戻してください。1回の実行で送る新着は最大20件で、全員へ1回のダイジェストDMとして送信します。

## 動作確認

Worker URLにアクセスするとヘルスチェックが返ります。

```powershell
Invoke-RestMethod https://<worker-name>.<account>.workers.dev/
```

手動実行は`ADMIN_TOKEN`を使います。

```powershell
$headers = @{ Authorization = "Bearer <ADMIN_TOKEN>" }
Invoke-RestMethod -Method Post -Headers $headers https://<worker-name>.<account>.workers.dev/run
```

成功すると`sent`、`skipped`、`errors`が返ります。通知されない場合は、SlackアプリのScope、Slack User ID、Worker Logs、フィードURLの順に確認してください。

## ファイル構成

```text
.
├── src/index.ts       # Cron、RSS/Atomパーサー、Slack DM送信
├── src/index.test.ts  # パーサーのテスト
├── wrangler.jsonc     # Cron、KV、フィード設定
└── package.json
```

## ライセンスと運用上の注意

各ニュースサイトのRSS利用条件と記事リンク先の規約に従ってください。このWorkerは記事タイトル、公開日時、リンクだけをSlackへ送ります。Bot Tokenや個人情報はGitへコミットしないでください。
