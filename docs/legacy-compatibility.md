# Legacy compatibility

Audited against commit `2580764184bb815872351078a7b84aa47296e18a`.

## Preserved behavior

| Area | Current behavior | Verification |
| --- | --- | --- |
| Address identity | Compare normalized `workchain:HEX`, retaining the workchain. Bounceable, non-bounceable, test flag, Base64/Base64URL and hex case do not create a new account identity. | `test/compatibility.test.js`, bot smoke |
| Address validation | Check the full raw syntax or friendly CRC. Raw int32 workchains that cannot fit in a friendly address remain raw; never wrap them into another account. | compatibility tests |
| Network selection | Determined by the configured indexer. As in the old monitor, a test-only wrapper does not select another network. This service monitors accounts and never sends funds. | address tests and configuration |
| Adding an existing address | Open the existing active record without changing its tag/settings. Prefer an active equivalent record over a deleted one. | bot smoke |
| Re-adding a deleted address | Reactivate the record, replace its tag with the supplied tag (or empty), retain notification settings and counters. | bot smoke |
| Amount input | Accept decimal/scientific forms such as `.1`, `1.`, `1e-3`, and leading zeroes without floating-point conversion. Require a whole number of nano units. The address threshold remains between 0 and 5 billion GRAM inclusive. | compatibility tests, bot smoke |
| Threshold matching | Greater than or equal, including the boundary. Decimal128 exponent notation is accepted. Invalid stored amounts fail closed. | compatibility tests |
| Comment filters | Exact, case-sensitive full-comment comparison; exclusions win. Preserve empty-comment filters (`-`/`+`) and the old newline handling. | compatibility tests, bot smoke |
| Tags | Store full tags. Escape HTML and shorten only the displayed label. Never expose another user's private tag or use one in channel output. | bot smoke, compatibility tests |
| Known account names | Restore the public Tonscan address book and the current user's counterparty labels. Failed refreshes retain the last in-memory snapshot and do not stop scanning. | compatibility tests |
| Excluded accounts | Restore the five legacy exclusions for native transfers, comparing normalized identities and applying them before user and channel delivery. New staking/NFT/jetton action types remain supported. | compatibility tests |
| Legacy settings shape | Read `notifications:false` as disabled. Replace it with structured settings only when its owner edits them; editing a threshold does not enable delivery. | bot smoke with a raw legacy MongoDB document |
| Legacy sessions/buttons | Resume `editTag`, `editMinAmount`, `editExceptions` from `__scenes`; respect expiry. Support old Reset/Clear buttons using the owner's persisted address context. Keep existing callback IDs, list pages, delete/undo and deep links. | compatibility tests, bot smoke |
| Access checks | Private chats only; every address mutation checks ownership and deleted state. Blocking and unblocking retain their semantics. | bot smoke and delivery tests |
| Storage | Existing collections and field names. No bulk conversion, deletion, database drop, automatic subscription merge, or cursor reset. | implementation and deployment procedure |

## Deliberate changes

- Use the approved compact design, GRAM ticker, asset/event icons and inline `tx` link. Wallet balances and USD estimates from the old verbose template are absent.
- Show exact token amounts; trim trailing zeroes only. The old truncation of transfers at 10 native coins is not retained. Thousands use the approved comma grouping.
- Minimum GRAM amounts apply to native transfers. Jetton/NFT/staking events are not silently compared with a GRAM threshold or converted at an assumed exchange rate.
- Validate addresses locally, so adding an address does not depend on a successful node RPC.
- Use durable event delivery IDs, paginated scanning, reconciliation and retry queues instead of the old in-memory transaction hash cache.

## Limits

- Historical duplicate subscriptions remain separate database records. This audit does not merge their tags, counters or potentially different filters.
- Invalid historical addresses are not guessed or rewritten. They cannot be matched until corrected by their owner.
- Already queued messages retain their original rendered content. Fixes to labels and exclusions apply to newly processed actions; the queue is not discarded or rewritten.
- Unit tests cover explicit edge cases and local smoke tests use synthetic updates with mocked Telegram delivery. These checks do not prove every possible blockchain contract or future indexer action is supported.

Run `npm test` and `npm run smoke:bot`. The bot smoke requires a local MongoDB on `127.0.0.1:27018`, uses a uniquely named database, retains it for inspection and never contacts Telegram.

Address representation reference: [TEP-2](https://github.com/ton-blockchain/TEPs/blob/master/text/0002-address.md).
