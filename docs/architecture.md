# Application architecture

The application has two entry points: `src/bot.js` starts Telegram polling and `src/scanner.js` starts background workers. Modules do not start processes when imported. Run one bot poller and one scanner per production database and bot token.

## Responsibilities

| Module | Responsibility |
| --- | --- |
| `bot/handlers.js`, `bot/views.js` | Telegram commands, callbacks, replies and keyboards |
| `bot/subscriptions.js` | Ownership checks and subscription reads/writes, including legacy settings |
| `bot/session.js`, `bot/input.js` | Persistent conversation state, legacy scene restoration and input parsing |
| `block-scanner.js` | Indexer pagination, bounded replay and ordered cursor commits |
| `notification-router.js` | Select subscribers and queue one durable record per action/subscription |
| `notification-filter.js` | Notification policy: enabled settings, comments, minimum amounts and incoming dust |
| `events.js` | Format actions into rich and plain notification text |
| `delivery-queue.js` | Delivery IDs, enqueue operations, claims, leases, batch updates and indexes |
| `delivery.js` | Recipient rechecks, batching, delivery scheduling, acknowledgments and retry decisions |
| `delivery-state.js` | Persist the shared Telegram cooldown across restarts |
| `telegram-sender.js` | Pace API calls, enforce the cooldown at dispatch, format channel-only amounts/emoji and handle rich-message fallback |
| `digest.js` | Deduplicate high-volume actions into 15-minute subscription summaries before queueing Telegram messages |
| `digest-format.js`, `bot/digests.js` | Exact per-asset transfer totals, bounded summary/detail rendering and recipient-owned pagination |
| `request-limiter.js` | Limit concurrent requests and pace starts; shared by the indexer client and Telegram transport |
| `health.js` | Collect read-only health evidence and evaluate worker heartbeat, delivery progress and queue age |
| `runtime.js` | Database connection recovery, shutdown signals, worker retries and bounded health snapshots |

Preview tools use these same routing and delivery modules with a separate local database and owner-restricted sender. The formatter and notification filters have separate responsibilities. The bot writes subscriptions through one module instead of saving hydrated legacy documents from several handlers.

## Data guarantees

A block cursor advances only after its notifications have been saved. Concurrent block results commit in order, and replay uses deterministic delivery IDs. Indexer requests and Telegram delivery run independently.

Delivery claims have a two-minute lease. Batches contain only one chat, and every event keeps its own durable ID. Subscriptions and incoming-dust settings are checked before sending. Existing collection names, counters, IDs and settings shapes remain compatible.

Configured high-volume accounts bypass per-action private deliveries. Each action ID is added once to a 15-minute window per subscription, and one pending digest contains the maximum observed count. Newly busy accounts can enter this mode after a configurable number of actions per 15-minute window; previous-window activity keeps them in digest mode through the next window. The digest becomes eligible two minutes after its window closes and is sent only when the scanner has caught up. Due digests take priority over older per-event deliveries. A seven-day TTL removes window deduplication data after its count is stored in the durable delivery record. A configured cutover time suppresses older actions on explicitly reset accounts; it does not alter other subscriptions or the channel.

Detailed digests persist a compact event snapshot once per watched account/action before adding the action to a recipient window. Recipient action IDs retain filter boundaries; shared snapshots never contain private tags. Rendering resolves tags from the owner's subscriptions and sums integer base units with metadata decimals, without floating-point arithmetic. Failed/unknown outcomes, self transfers, swaps, NFTs and other actions do not enter sent/received currency totals. The snapshots have a seven-day TTL. Old windows and incomplete/expired snapshots use the legacy count display. Detail callbacks derive the delivery ID from its subscription/window and require the requesting user's ID in the database query.

A successful Telegram response and a successful MongoDB acknowledgment are separate steps. Accepted batches remain in worker memory until MongoDB records them as sent. A temporary database failure retries that acknowledgment before claiming more work, without sending the accepted batch again. If the process dies before the acknowledgment reaches MongoDB, a duplicate is still possible: delivery remains at least once.

Telegram `429` updates the in-memory cooldown immediately and persists the deadline. Requests already waiting for a pacing slot check it again before calling Telegram. Claimed but unsent batches return to the queue without consuming an attempt. Failed cooldown writes stay pending and are retried before further API calls. The process never clears a provider cooldown to force delivery.

Only an explicit rejection of rich formatting (`400`) permits a plain-text fallback. Timeouts and ambiguous network failures enter the durable retry path. The rate limiter reduces request volume; it does not guarantee Telegram will never return `429`.

## Health and operations

A worker heartbeat establishes that its loop is running. Delivery health additionally checks the database queue, latest accepted/sent timestamp and persisted cooldown. With notifications enabled, an active cooldown with waiting work, no delivery progress for five minutes with old queued work, or a backlog older than fifteen minutes makes the check fail. An empty queue can be healthy without recent sends.

Scanner startup creates the delivery indexes, including `{ status: 1, sent_at: -1 }` for the latest sent record. Health queries are read-only, use indexes and have a five-second database query deadline. Run the scanner's startup/index setup before evaluating a newly created database. No queue is deleted or reset by a health check or application startup.

Tests cover the pure behavior and failure boundaries. `npm run smoke:delivery` runs the routing, delivery and health modules together against a disposable local MongoDB and mocked Telegram API. `npm run smoke:recovery -- <mongod>` verifies recovery from a real local database interruption. `npm run smoke` verifies public indexer actions and replay without sending Telegram messages.
