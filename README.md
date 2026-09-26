# TON Notify Bot

Telegram bot on [grammY](https://grammy.dev/) with a [TON Center v3](https://toncenter.com/api/v3/index.html) scanner. Existing MongoDB `users`, `addresses`, `sessions`, and `counters` collections remain compatible. The application creates `notification_deliveries` and `trace_tasks` for durable work; no migration scripts are needed.

## Local setup

1. Install Node.js 22 or newer and MongoDB. Run `npm ci`.
2. Copy `.env.example` to `.env`. Select a local development database and set `TON_INDEX_API_KEY`. Environment files and `.local/` are ignored by Git.
3. Run `npm run inspect` to discover recent public GRAM, jetton and NFT activity. Pass addresses explicitly with `npm run inspect -- <address>`.
4. Run `npm test` and the integration checks below.
5. Run `npm run scan`. With `SEND_NOTIFICATIONS=false`, this scans and queues notifications without contacting Telegram; no bot token is required.
6. To test Telegram interactively, set a separate test bot's `BOT_TOKEN`, set `SEND_NOTIFICATIONS=true`, and run `npm start` in a second terminal. Do not run two pollers using the same token.

The bot preserves address management, tags, minimum GRAM amounts, exact comment inclusion/exclusion filters, deletion/undo, and address sharing. The minimum GRAM setting does not suppress jetton or NFT actions.

Notifications use one rich text paragraph: amount or NFT on the first line, short participants and a native inline `tx` URL button on the next, and an optional quoted comment. Display tags are limited to 16 characters and comment excerpts to 48. A trailing payment reference is omitted from the excerpt when a transaction link is available; the full comment and exact amounts remain accessible there. NFT names link to their item pages and collections, with an NFT label or a purchase/sale action. Successful incoming/outgoing currency transfers use plus/minus signs; failed and self transfers do not imply a balance change. Failure headings identify the attempted action. Failed swaps show only the attempted input, and failed NFT purchases do not show a completed seller payout. Amounts, including swaps, preserve all significant digits without rounding or approximation markers. Long exchanges can wrap between the assets. Stored tags and exact-match filters keep their original values. Telegram may wrap long lines on narrow screens.

Native coin amounts use the GRAM ticker. TON remains the blockchain name, and provider names, API action types and configuration keys keep their existing identifiers. The delivery queue stores rich HTML with a plain HTML fallback. An explicit Telegram 400 rejection falls back to the plain message; timeouts and ambiguous failures use the usual retry path.

NFT purchases show the price to the buyer and the seller payout when supplied for a sale. Auction bids use native coin units. DNS updates, record deletion, domain renewal and system operations have readable action headings; DNS notifications link the affected domain contract.

Each notification starts with one event icon: incoming/outgoing, swap, failure, mint/burn, staking, or another action. Transfers, swaps and failures use static icons from [BasicinterfaceEmoji](https://t.me/addemoji/BasicinterfaceEmoji). GRAM and USDt use logos from [CryptoBotAssets](https://t.me/addemoji/CryptoBotAssets) before the number, with the sign attached to the amount. USDt is matched by its official master contract; other jettons retain their ticker without a substituted logo. The plain fallback uses standard event emoji and asset names. Telegram requires the bot to be eligible for custom emoji (a Premium owner for directly sent private/group messages, or an additional username purchased on Fragment); see the [Bot API formatting rules](https://core.telegram.org/bots/api#html-style).

## Checks

### Vote on message designs in Telegram

Save a separate test bot token as `DESIGN_BOT_TOKEN` in the ignored `.env.design` file. Send that bot `/start`, run `npm run design -- --register` to record the unique recent private sender, then run `npm run design`. Registration leaves webhooks and other bot settings untouched; it refuses ambiguous senders. The design lab accepts messages and votes only from its registered private owner.

If Telegram no longer has that `/start` update, simply run `npm run design`: it prints a private one-time pairing link. Open the link and press Start. The lab records that sender and automatically sends the gallery; unrelated plain `/start` messages cannot claim the lab. The pairing link and owner registration live only in the ignored local folder.

The lab sends the current design round, including native Telegram Rich Messages. Cycle through five synthetic examples using the last button below each message. Vote like/dislike/finalist or leave a reply. Votes, comments, message IDs and registration remain in `.local/design-lab/`; none are published. `/results` displays saved votes, `/designs` sends missing designs, and `/again` resends the set. These controls are for design review, separate from the production scanner. The bot process must remain running to receive feedback.

Rich formatting uses the official [`sendRichMessage` API](https://core.telegram.org/bots/api#sendrichmessage). A successful API response confirms delivery; appearance and client support still need review in Telegram.

### Real notifications in the private test chat

With the design lab running and MongoDB listening on `127.0.0.1:27018`, run `npm run live`. This explicitly enables a bounded live session using the registered owner and `.env.design` token. It sends four recent real operations (GRAM, jetton, NFT, swap), then scans new blocks for those public addresses. Test addresses use shortened addresses without generated tags. It reuses the scanner, trace reconciliation and durable delivery queue, with a separate local `ton-notify-live-*` database. Production environment settings and services are unchanged.

Delivery is restricted to the registered private chat: up to 30 notifications, at least 20 seconds apart, for at most one hour. `/live_stop` or the introductory stop button ends the session; `/live_status` reports progress. Replies to real notifications are saved as feedback. Only the design lab polls Telegram updates; the live scanner only sends messages. Runtime state, public address selection and message history stay in ignored `.local/live-lab/`. To resume an interrupted session without selecting new addresses, run `node scripts/live-lab.js` without `--start` while its control remains enabled and unexpired.

### Automated checks

- `npm test`: amount precision, formatting, pagination, cursor durability, rate limits/timeouts, trace reconciliation and Telegram retries.
- `npm run smoke`: requires local MongoDB on port 27018. Discovers nine recent action types, registers public addresses in a disposable `ton-notify-smoke-*` database, scans full blocks, reconciles traces and checks replay deduplication. Writes notification examples to `.local/live-notifications.html`, then drops only its test database. No Telegram messages are sent.
- `npm run smoke:bot`: tests grammY address/settings/share/block flows against local MongoDB and a mocked Telegram API.
- `npm run smoke:recovery -- <path-to-mongod>`: starts isolated local processes, tests unavailable MongoDB at startup, interrupts that disposable MongoDB and verifies recovery without restarting the scanner. Does not touch an existing MongoDB process. Test logs/data remain under `.local/recovery/` for inspection.
- `npm run health`: checks worker progress files, scanner lag, database availability, queue sizes and free space on the application volume. Exits nonzero when unhealthy. Integrate this command with host monitoring; PM2 `online` alone does not establish that scanning works.

## Scanner behavior

The scanner fully paginates `/actions` and `/transactionsByMasterchainBlock`. Notifications include direction, participants, tags, escaped comments and explorer links. GRAM, jetton transfer/mint/burn, NFT transfer/mint, swaps, staking and liquidity actions have dedicated formatting. Jetton quantities use metadata decimals; missing decimals are explicitly shown as base units. Other classified actions retain their type and available participants/amounts.

Transactions for watched accounts are also registered in a persistent trace queue. `/traces` reconciliation waits for a complete trace, fetches all its classified actions, and emits generic messages/account changes for uncovered transactions. Incomplete or not-yet-classified traces remain pending across restarts. Thus a trace spanning several blocks does not immediately become a misleading raw transfer. Provider classification availability still determines when those details can be shown.

A block cursor advances only after its notifications and trace tasks are saved. Each recipient/action has a deterministic delivery ID. Scanner, trace reconciliation and Telegram delivery run independent loops: an indexer outage does not stop an existing notification queue from draining. MongoDB startup retries and driver reconnection handle temporary database outages. Bounded HTTP retries, request pacing and concurrency limits prevent upstream errors from entering amount calculations. Telegram 429 uses `retry_after`, with global and per-chat pacing. Deleted/disabled subscriptions are checked before delivery.

Delivery is at least once: a crash or network timeout after Telegram accepts a message but before MongoDB records `sent` can cause a duplicate. Telegram does not offer a `sendMessage` idempotency key. Persistent deduplication records are retained; account for their storage in disk monitoring and backups.

### Configuration

| Setting | Purpose |
| --- | --- |
| `SEND_NOTIFICATIONS` | `false` by default; explicitly set `true` to send queued notifications |
| `TON_REQUESTS_PER_SECOND` | Per-scanner ceiling, default 80; leave room if the key is shared |
| `TON_HTTP_CONCURRENCY` | Maximum simultaneous API requests, default 8 |
| `SCAN_BLOCK_CONCURRENCY` | Concurrent block scans, default 4; cursor commits remain ordered and catch-up batches run without the idle delay |
| `HTTP_TIMEOUT_MS` | Timeout for each HTTP attempt, default 15000 |
| `SCAN_START_SEQNO` | Starting block when creating the new cursor; does not override an existing cursor |
| `SCAN_LAG_BLOCKS` | Delay behind the indexer tip, default 16 blocks |
| `SCAN_REPLAY_BLOCKS` | Recent-block replay window, default 120; persistent trace tasks handle unresolved watched transactions |
| `SCAN_PAGE_SIZE` | Pagination size, maximum 1000 |
| `NOTIFICATIONS_CHANNEL_ID` | Optional large-GRAM-transfer channel |
| `MIN_TRANSACTION_AMOUNT` | Minimum GRAM value for that channel |

If the new cursor is absent and no start block is specified, the scanner resumes from the legacy `lastCheckedBlock` counter, or starts at the current indexed tip for an empty database. A stale legacy cursor can create a large backfill and many old notifications. Choose the intended starting point before rollout.

## Production rollout

1. Validate locally with a separate Telegram test bot. Back up the existing database and environment securely. Check disk space, MongoDB recovery and database version compatibility before starting new processes.
2. Upgrade older Node.js installations to Node.js 22 or newer. Install dependencies with `npm ci --omit=dev`.
3. Stop the old bot and scanner, choose the backlog policy, then configure the existing database and production bot token in the host's ignored `.env`. Enable `SEND_NOTIFICATIONS=true` only when ready to deliver.
4. Start `pm2 start ecosystem.config.cjs` with one bot and one scanner process. The configuration supplies restart backoff and a memory ceiling. Run `npm run health` and inspect cursor/queue progress before completing rollout.
5. Adapt `ops/logrotate.example` to the installation path and install it on the host. Run logrotate hourly so size limits are checked often; rotate MongoDB logs too. Monitor free disk space on both application and database volumes. Log rotation files in this repository are templates and do not install themselves.

Ordinary block progress is stored in bounded `.local/health/*.json` files instead of appended indefinitely to logs. Repeated failures are summarized. Runtime error messages redact configured credentials.
