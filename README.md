# TON Notify Bot

Telegram bot on [grammY](https://grammy.dev/) and a TON Center v3 action scanner. It keeps the existing MongoDB `users`, `addresses`, `sessions`, and `counters` collections. Notification jobs go into a new `notification_deliveries` collection. No migration script is required.

## Local setup

1. Install Node.js 20 or newer and a MongoDB instance.
2. Run `npm ci`.
3. Copy `.env.example` to `.env` and fill in `BOT_TOKEN`, `MONGODB_URI`, and optionally `TON_INDEX_API_KEY`. `.env` is ignored by Git. Use a local development MongoDB database while testing. A running production poller must not use the same bot token simultaneously.
4. Run `npm run inspect` to read recent TON, jetton, and NFT activity on public addresses. You can pass one or more TON addresses to inspect specific wallets: `npm run inspect -- <address>`.
5. Run `npm test`.
6. In separate terminals, run `npm start` and `npm run scan`.

For an isolated MongoDB integration test, start a local MongoDB on port 27018 and run `npm run smoke`. It chooses recent public TON, jetton, and NFT transfers, scans their blocks, checks durable notifications, and removes only its disposable `ton-notify-smoke-*` database. It does not send Telegram messages.

Run `npm run smoke:bot` against that same local MongoDB to exercise the grammY add, list, settings, tag, delete, and undo flows using a mocked Telegram API. It does not contact Telegram.

The scanner uses TON Center v3 `/actions` and `/transactionsByMasterchainBlock` with full pagination. Classified actions provide TON, jetton, NFT, and other event details; uncovered raw messages and account changes are shown as generic activity. It processes indexed masterchain blocks with a configurable delay and replays recent blocks to catch late action classification. A block cursor advances only after its notification jobs have been written to MongoDB. Telegram failures stay in the durable queue for retry. A rare crash after Telegram accepts a message but before `sent` is recorded can cause one duplicate notification; Telegram does not provide an idempotency key for `sendMessage`.

`SCAN_START_SEQNO` can explicitly set a starting block for a local backfill. If omitted, a fresh scanner reads the old `lastCheckedBlock` counter when present, or starts from the latest indexed block. `SCAN_LAG_BLOCKS` and `SCAN_REPLAY_BLOCKS` tune classification delay and replay coverage. `SCAN_PAGE_SIZE` can be at most 1000. A TON Center API key is strongly recommended for continuous scanning.

The minimum amount setting applies to TON transfers. Jetton and NFT actions are always eligible and use the comment filters. Unknown classified action types are shown by their indexer name with available participants and amounts.

## Rollout

Keep the production bot and scanner running until the local build has been verified with a separate test bot and database. Record the current `lastCheckedBlock` counter, stop the old scanner and bot, back up MongoDB, then start the new scanner and bot against the existing database. Check the new `actions_scan_v1` cursor and `notification_deliveries` queue before opening traffic to all users. Keep `.env` only on the host and out of commits.
