# TON Notify Bot

Telegram bot on [grammY](https://grammy.dev/) with a [TON Center v3](https://toncenter.com/api/v3/index.html) scanner. Existing MongoDB `users`, `addresses`, `sessions`, and `counters` collections remain compatible. The application creates `notification_deliveries` for durable delivery; no migration scripts are needed.

## Local setup

1. Install Node.js 22 or newer and MongoDB. Run `npm ci`.
2. Copy `.env.example` to `.env`. Select a local development database and set `TON_INDEX_API_KEY`. Environment files and `.local/` are ignored by Git.
3. Run `npm run inspect` to discover recent public GRAM, jetton and NFT activity. Pass addresses explicitly with `npm run inspect -- <address>`.
4. Run `npm test` and the integration checks below.
5. Run `npm run scan`. With `SEND_NOTIFICATIONS=false`, this scans and queues notifications without contacting Telegram; no bot token is required.
6. To test Telegram interactively, set a separate test bot's `BOT_TOKEN`, set `SEND_NOTIFICATIONS=true`, and run `npm start` in a second terminal. Do not run two pollers using the same token.

The bot preserves address management, tags, minimum GRAM amounts, exact comment inclusion/exclusion filters, deletion/undo, and address sharing. The minimum GRAM setting does not suppress jetton or NFT actions.

The bot accepts wallet addresses and DNS names such as `tolya.ton` (TON DNS) and `tele.grm` (GRM DNS), each optionally followed by `:tag`. Both DNS systems use the wallet record when present, otherwise the domain owner. GRM DNS records are read directly from the current domain contract data on chain. The bot stores the resolved address for notifications and never substitutes the NFT contract. An explicit `:tag` on a DNS name updates the user's existing subscription if the name resolves to an address already tracked; a name without `:tag` preserves the existing label. A later DNS record or owner change requires adding the name again after removing the old subscription. GRM DNS was formerly called Gram DNS; user input uses `.grm`.

Successful incoming native transfers below 0.01 GRAM are hidden by default to reduce dust noise. This is an amount filter, not proof that a transaction is spam: small payments and fee returns are hidden too. Each address has a **Hide small incoming** switch in its notification settings. `MIN_INCOMING_GRAM` changes the global threshold; `0` disables it. The boundary amount itself is delivered. Outgoing, self and failed transfers, unknown outcomes, swaps, jettons, NFTs and raw contract messages retain their existing behavior. Exact comment inclusion does not bypass the dust filter; disable the switch to receive small matching payments. Existing minimum amount and comment settings still apply independently.

Filtering happens before queueing and again before sending, including events inside batches. New native-transfer queue entries retain typed action data for that check; skipped queued entries record `skip_reason: incoming_dust`. Older queue entries without action data keep their existing behavior, since notification HTML cannot reliably identify a native asset. Already sent notifications are unchanged.

Notifications use one rich text paragraph: amount or NFT on the first line, short participants and a native inline `tx` URL button on the next, and an optional quoted comment. Display tags are limited to 16 characters and comment excerpts to 48. A trailing payment reference is omitted from the excerpt when a transaction link is available; the full comment and exact amounts remain accessible there. NFT names link to their item pages and collections, with an NFT label or a purchase/sale action. Successful incoming/outgoing currency transfers use plus/minus signs; failed and self transfers do not imply a balance change. Failure headings identify the attempted action. Failed swaps show only the attempted input, and failed NFT purchases do not show a completed seller payout. Amounts, including swaps, preserve all significant digits without rounding or approximation markers. Long exchanges can wrap between the assets. Stored tags and exact-match filters keep their original values. Telegram may wrap long lines on narrow screens.

Native coin amounts use the GRAM ticker. TON remains the blockchain name, and provider names, API action types and configuration keys keep their existing identifiers. The delivery queue stores rich HTML with a plain HTML fallback. An explicit Telegram 400 rejection falls back to the plain message; timeouts and ambiguous failures use the usual retry path.

NFT purchases show the price to the buyer and the seller payout when supplied for a sale. Auction bids use native coin units. DNS updates, record deletion, domain renewal and system operations have readable action headings; DNS notifications link the affected domain contract.

Native GRAM amounts also show an approximate USD equivalent, for example `12.345 GRAM (≈ $24.69)`, in both rich and plain notifications. The scanner and live previews refresh the public [OKX GRAM/USDT ticker](https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-ticker) every minute, with a 3-second request timeout. OKX [migrated TON trading to GRAM in June 2026](https://www.okx.com/en-sg/help/okx-completed-ton-token-migration); the legacy TON instruments no longer exist. A failed refresh retains the previous quote for at most 5 minutes from its exchange timestamp; without a fresh quote, notifications continue with the exact GRAM amount alone. USD estimates round to cents without floating-point amount conversion; positive values under one cent show `<$0.01`. This restores the legacy approximate conversion using USDT as the dollar reference; unrelated jettons are not valued at the native coin's rate. Existing queued messages retain their original rendered content.

Each notification starts with one event icon: incoming/outgoing, swap, failure, mint/burn, staking, or another action. Transfers, swaps and failures use static icons from [BasicinterfaceEmoji](https://t.me/addemoji/BasicinterfaceEmoji). GRAM and USDt use logos from [CryptoBotAssets](https://t.me/addemoji/CryptoBotAssets) before the number, with the sign attached to the amount. USDt is matched by its official master contract; other jettons retain their ticker without a substituted logo. The plain fallback uses standard event emoji and asset names. Channel deliveries replace custom emoji with their standard alternatives while preserving rich paragraphs and inline `tx` buttons. This happens at send time, including older queued messages for `NOTIFICATIONS_CHANNEL_ID`; new queue entries also retain their chat type. Private notifications keep custom emoji. Telegram allows custom emoji with a Premium owner in directly sent private/group/supergroup messages, but channels require an additional username purchased on Fragment; see the [Bot API formatting rules](https://core.telegram.org/bots/api#html-style).

Channel posts omit the GRAM and USDT asset icons and the minus sign before their amounts, and truncate fractional GRAM and approximate USD amounts in each event heading. USDT amounts retain their exact decimals. This happens at send time for both rich and fallback posts, including events already queued for the channel. Private alerts keep their exact amounts, signs and asset icons. The channel title is managed separately in Telegram.

Busy-address summaries show exact sent/received totals per currency, up to five latest successful outgoing currency transfers with recipient labels and transaction links, and separate counts for swaps, NFTs, failed actions, self transfers and other events. The main summary shows up to three assets per direction. **All operations** opens a paginated view available only to the recipient; **Open wallet** opens the explorer. User tags override public account labels. Totals use confirmed successful GRAM/jetton transfers, keep contract identities separate, and show unknown amounts explicitly when token metadata is unavailable. They are transfer totals, not wallet balances: swaps, staking and fees are separate activity.

Event snapshots are shared per account/action and expire after seven days, alongside recipient deduplication windows. Delivery history and the sent summary remain durable. Existing windows finish in the previous count-only format; new windows use the detailed format. If detail data has expired or is incomplete, the application keeps the count summary and wallet link rather than presenting partial totals.

## Checks

### Vote on message designs in Telegram

Save a separate test bot token as `DESIGN_BOT_TOKEN` in the ignored `.env.design` file. Send that bot `/start`, run `npm run design -- --register` to record the unique recent private sender, then run `npm run design`. Registration leaves webhooks and other bot settings untouched; it refuses ambiguous senders. The design lab accepts messages and votes only from its registered private owner.

If Telegram no longer has that `/start` update, simply run `npm run design`: it prints a private one-time pairing link. Open the link and press Start. The lab records that sender and automatically sends the gallery; unrelated plain `/start` messages cannot claim the lab. The pairing link and owner registration live only in the ignored local folder.

The lab sends the current design round, including native Telegram Rich Messages. Cycle through five synthetic examples using the last button below each message. Vote like/dislike/finalist or leave a reply. Votes, comments, message IDs and registration remain in `.local/design-lab/`; none are published. `/results` displays saved votes, `/designs` sends missing designs, and `/again` resends the set. These controls are for design review, separate from the production scanner. The bot process must remain running to receive feedback.

Rich formatting uses the official [`sendRichMessage` API](https://core.telegram.org/bots/api#sendrichmessage). A successful API response confirms delivery; appearance and client support still need review in Telegram.

### Real notifications in the private test chat

With the design lab running and MongoDB listening on `127.0.0.1:27018`, run `npm run live`. This explicitly enables a bounded live session using the registered owner and `.env.design` token. It sends four recent real operations (GRAM, jetton, NFT, swap), then scans new blocks for those public addresses. Test addresses use shortened addresses without generated tags. It reuses the scanner and durable delivery queue, with a separate local `ton-notify-live-*` database. Production environment settings and services are unchanged.

Delivery is restricted to the registered private chat: up to 30 notifications, at least 20 seconds apart, for at most one hour. `/live_stop` or the introductory stop button ends the session; `/live_status` reports progress. Replies to real notifications are saved as feedback. Only the design lab polls Telegram updates; the live scanner only sends messages. Runtime state, public address selection and message history stay in ignored `.local/live-lab/`. To resume an interrupted session without selecting new addresses, run `node scripts/live-lab.js` without `--start` while its control remains enabled and unexpired.

`npm run live:all` starts a continuous preview feed for every known event category, including failures, DNS, auctions and validator operations. It samples the latest available action of each type, then newer actions, alternating public participant perspectives. This is a varied preview feed, not an exhaustive export of all network activity. It uses the same formatter, durable delivery queue, recipient checks and Telegram retry logic as the scanner. Each category has at most one pending delivery; per-type cursors survive restarts and failing API categories back off independently. Delivery is paced at one message per five seconds, with no duration or message limit, until `/live_stop`. The local supervisor restarts an interrupted worker, retaining its session and queue. Resume with `node scripts/live-supervisor.js` without `--start`. Its log is bounded to 32 KB; sent deliveries expire after seven days only in this isolated preview database, while type cursors remain. The latest 5,000 message references are retained for reply feedback. The computer and local MongoDB must remain running. After design approval, restarting the feedback bot does not send a new design gallery.

### Automated checks

- `npm run check`: syntax-check every source, script and test module, then run the automated suite.
- `npm test`: amount precision, formatting, pagination, cursor durability, rate limits/timeouts, block replay and Telegram retries.
- `npm run smoke`: requires local MongoDB on port 27018. Discovers nine recent action types, registers public addresses in a disposable `ton-notify-smoke-*` database, scans classified actions by block and checks replay deduplication. Writes notification examples to `.local/live-notifications.html`, then drops only its test database. No Telegram messages are sent.
- `npm run smoke:bot`: tests grammY address/settings/share/block flows against local MongoDB and a mocked Telegram API.
- `npm run smoke:delivery`: tests routing, batching, database acknowledgment recovery, persisted Telegram cooldown and delivery health against a disposable local MongoDB on port 27018 and a mocked Telegram API. No real messages are sent.
- `npm run smoke:recovery -- <path-to-mongod>`: starts isolated local processes, tests unavailable MongoDB at startup, interrupts that disposable MongoDB and verifies recovery without restarting the scanner. Does not touch an existing MongoDB process. Test logs/data remain under `.local/recovery/` for inspection.
- `npm run health`: checks worker heartbeat, scanner lag, database availability, delivery progress, queue age and free space on the application volume. With notifications enabled, a Telegram cooldown with pending work, stalled delivery for five minutes or a backlog older than fifteen minutes exits nonzero. An empty queue is healthy without recent sends. The scanner creates the required indexes at startup; the health command only reads them. Integrate this command with host monitoring.

Module responsibilities and recovery guarantees are described in [the architecture guide](docs/architecture.md).

## Scanner behavior

The scanner fully paginates `/actions` by masterchain block. Notifications include direction, participants, tags, escaped comments and explorer links. GRAM, jetton transfer/mint/burn, NFT transfer/mint, swaps, staking and liquidity actions have dedicated formatting. Jetton quantities use metadata decimals (0–255); loaded metadata that omits this optional field uses 9 as specified by [TEP-64](https://github.com/ton-blockchain/TEPs/blob/master/text/0064-token-data-standard.md#jetton-metadata-attributes). Missing metadata or invalid decimals show “amount unavailable” instead of exposing raw token integers as quantities. Other classified actions retain their type and available participants/amounts.

Only classified actions from the indexer generate notifications. A bounded recent-block replay can pick up actions that appear late; deterministic delivery IDs prevent repeated sends. There is no raw-transaction scan, trace queue, classification-wait worker or synthetic fallback notification. Actions that remain unclassified, or appear after their block leaves the replay window, are not notified. The retired `trace_tasks` collection, if present from an older release, is not read or changed by the application.

A block cursor advances only after its notifications are saved. Each recipient/action has a deterministic delivery ID. Scanner and Telegram delivery run independent loops: an indexer outage does not stop an existing notification queue from draining. MongoDB startup retries and driver reconnection handle temporary database outages. Bounded HTTP retries, request pacing and concurrency limits prevent upstream errors from entering amount calculations. Telegram 429 immediately pauses dispatch, including calls waiting inside the request limiter, and persists `retry_after` across restarts. Deleted/disabled subscriptions are checked before delivery.

When Telegram accepts a message but its database acknowledgment fails, the running worker remembers the accepted batch and retries the database write before claiming more work. Delivery is still at least once: a crash or network timeout after Telegram accepts a message but before MongoDB records `sent` can cause a duplicate. Telegram does not offer a `sendMessage` idempotency key. Persistent deduplication records are retained; account for their storage in disk monitoring and backups.

### Configuration

| Setting | Purpose |
| --- | --- |
| `SEND_NOTIFICATIONS` | `false` by default; explicitly set `true` to send queued notifications |
| `NOTIFICATION_BATCH_SIZE` | Maximum queued events per Telegram message for the same chat, 1 by default, at most 10. Busy subscriptions can group existing compact event paragraphs to stay within Telegram throughput limits. Each event retains its own delivery ID and tx link; disabled subscriptions are checked before grouping. Plain HTML is capped at 3500 characters per group. |
| `TON_REQUESTS_PER_SECOND` | Per-scanner ceiling, default 80; leave room if the key is shared |
| `TON_HTTP_CONCURRENCY` | Maximum simultaneous API requests, default 8 |
| `SCAN_BLOCK_CONCURRENCY` | Concurrent block scans, default 4; cursor commits remain ordered and catch-up batches run without the idle delay |
| `HTTP_TIMEOUT_MS` | Timeout for each HTTP attempt, default 15000 |
| `SCAN_START_SEQNO` | Starting block when creating the new cursor; does not override an existing cursor |
| `SCAN_LAG_BLOCKS` | Delay behind the indexer tip, default 16 blocks |
| `SCAN_REPLAY_BLOCKS` | Bounded recent-block replay window, default 120; set to 0 to disable |
| `SCAN_PAGE_SIZE` | Pagination size, maximum 1000 |
| `NOTIFICATIONS_CHANNEL_ID` | Optional channel for large GRAM and official TON USDT transfers |
| `MIN_TRANSACTION_AMOUNT` | Minimum GRAM value for that channel |
| `MIN_CHANNEL_USDT` | Notify the channel for successful official TON USDT transfers strictly above this amount; default `100000`. Exactly `100000` is excluded. Uses the official master contract and 6 decimal places, independent of provider metadata. Mint, burn, swap, failed and unconfirmed actions are excluded. |
| `MIN_INCOMING_GRAM` | Hide successful incoming native transfers below this GRAM amount for private subscriptions; default `0.01`, `0` disables globally. Can also be disabled per address. |
| `HOT_DIGEST_ADDRESSES` | Comma-separated watched accounts that use one summary per subscriber every 15 minutes instead of one delivery per action. |
| `HOT_DIGEST_CUTOVER_UTIME` | Unix time before which actions on configured digest accounts are ignored after a user-requested backlog reset. |
| `DIGEST_THRESHOLD_PER_15M` | Action count after which another busy account enters digest mode; 0 disables automatic detection. The first actions in a window retain their individual notifications. |

If the new cursor is absent and no start block is specified, the scanner resumes from the legacy `lastCheckedBlock` counter, or starts at the current indexed tip for an empty database. A stale legacy cursor can create a large backfill and many old notifications. Choose the intended starting point before rollout.

## Production rollout

1. Validate locally with a separate Telegram test bot. Back up the existing database and environment securely. Check disk space, MongoDB recovery and database version compatibility before starting new processes.
2. Upgrade older Node.js installations to Node.js 22 or newer. Install dependencies with `npm ci --omit=dev`.
3. Stop the old bot and scanner, choose the backlog policy, then configure the existing database and production bot token in the host's ignored `.env`. Enable `SEND_NOTIFICATIONS=true` only when ready to deliver.
4. Start `pm2 start ecosystem.config.cjs` with one bot and one scanner process. The configuration supplies restart backoff and a memory ceiling. Run `npm run health` and inspect cursor/queue progress before completing rollout.
5. Adapt `ops/logrotate.example` to the installation path and install it on the host. Run logrotate hourly so size limits are checked often; rotate MongoDB logs too. Monitor free disk space on both application and database volumes. Log rotation files in this repository are templates and do not install themselves.

Ordinary block progress is stored in bounded `.local/health/*.json` files instead of appended indefinitely to logs. Repeated failures are summarized. Runtime error messages redact configured credentials.

### Disk protection for the systemd deployment

The files in `ops/` include a disk guard and systemd drop-ins. Install `disk_guard.py` as `/usr/local/sbin/ton-notify-disk-guard`, the guard service/timer in `/etc/systemd/system/`, and each `*-protection.conf` in its matching `ton-notify-*.service.d/` directory. These templates do not install themselves.

The guard checks every ten seconds and stops the scanner before writing its own status. It stops ingestion when either protected volume has less than 4 GiB or 15% available, or when measurement fails. A short-interval check also stops when extrapolated time to a full disk is below 40 seconds, covering the deployment's ten-second polling interval, twenty-second stop deadline and a margin. Keep that horizon aligned with the actual service deadline. A missing history sample temporarily disables the forecast; the absolute threshold still applies. These bounds do not guarantee safety under arbitrary write acceleration. Its status lives in `/run`, and a failed status write cannot prevent the stop. The guard never starts the scanner. After a protective stop, inspect MongoDB, disk growth and the retained queue before manually starting it. Startup separately requires at least 6 GiB and 15% free; an automatic service restart can retry that startup check every thirty seconds.

Bot, scanner and health checker must share `HEALTH_DIRECTORY=/run/ton-notify-health`. The worker drop-ins preserve this shared runtime directory across service stops. Diagnostic-file failures remain visible as missing/stale health, but no longer abort database reconnection or worker retry. `journald-ton-notify.conf` caps the system journal at 256 MiB; keep application/MongoDB text-log rotation as well. The guard is a final safeguard, not a substitute for sufficient storage or external disk/database/delivery alerts.

Validate changes with `npm run check` and `python -m unittest discover -s test -p test_disk_guard.py` (use `python3` where required). These tests simulate storage failures; production recovery also requires database validation, preserved queue/cursor checks, real scanner progress and actual accepted deliveries. Never delete WiredTiger journal files to recover space or reset the notification cursor as an implicit repair step.

The optional `ton-notify-alert.service` and timer check every minute using a separate owner-approved Telegram bot. Store `ALERT_BOT_TOKEN` and the verified private `ALERT_CHAT_ID` in `/etc/ton-notify-alerts.env`, owned by root with mode `0600`. The service runs as `core`, checks all three services, disk reserve below 8 GiB, and the database/scanner/delivery health results. It reports changed problems and recovery with a minimum five-minute interval. Missing or malformed health output prevents a recovery message. State is kept in `/run/ton-notify-alerts`; the next-attempt deadline is saved before sending. A reboot loses that state, and a failed write cannot retain a newly returned provider cooldown. Use `ops/health-alert.js --test` under the service identity/environment to verify Telegram acceptance. This on-host sender cannot report complete host or network loss; an independent external monitor is still needed for those failures.

### Preserving history while restoring current notifications

`ENABLE_LIVE_RECOVERY=true` enables a recovery mode with one process, one shared API limiter and one Telegram sender. On first activation it saves an immutable boundary in `actions_live_recovery_v1`; the existing `actions_scan_v1` keeps its position and processes every remaining historical block through that boundary. The live cursor starts at the following block. Restarts reuse both counters, and missing/corrupt recovery cursors fail closed. Do not delete/reset either counter or change the start block during recovery.

New ordinary notifications have a separate indexed delivery lane and receive priority, while historical notifications remain queued and continue sending. Deterministic identities, leases, recipient filtering and Telegram cooldowns still apply. Digest writes are grouped by recipient/window before advancing any block cursor. Historical summaries remain held until their entire range completes; new summaries start only from the next complete 15-minute window after activation, with the existing two-minute delay. Digest eligibility is checked again inside the Telegram limiter before the network request. Process crashes still have at-least-once delivery semantics.

Health and owner alerts require both live and historical workers in this mode. Historical lag/old backlog continues to report an incomplete recovery even when current notifications are working. Verify live cursor lag, accepted-and-persisted deliveries, historical cursor progress and disk headroom separately. Disable the flag only as an explicit rollback: the old cursor will resume scanning the saved historical range and eventually reach already-processed live blocks; deterministic IDs suppress ordinary duplicates. Keep the live counter for resuming recovery.

During the November 2026 incident MongoDB TTL was temporarily disabled to preserve overdue digest details. Do not re-enable expiry solely because the process is running. First complete historical processing, verify no pending/sending historical or malformed digest remains, and preserve a verified backup. Expiry resumption is a separate maintenance action; the disk guard and owner alerts remain active while retention is paused. Capacity and an external host-loss monitor are still operational requirements.

During live recovery, historical ingestion separately pauses below 6 GiB or 15% free on either the application volume or `RECOVERY_DATA_VOLUME` (default `/var/lib/mongodb`). Starting/resuming backfill requires 7 GiB and 15%; failed measurements also require that larger reserve next time. Current scanning and delivery continue, subject to the independent global guard. Persisted historical completion is read before this capacity gate, so a finished range is not held after restart. The pause is visible as `backfill: worker_not_ready` with `paused_capacity` in the worker snapshot; checks repeat at most every ten seconds while paused. This reduces competition for disk but does not replace storage capacity planning.
