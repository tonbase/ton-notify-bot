const { config } = require('./config')
const { Address, User, Delivery } = require('./models')
const { isIncomingDust } = require('./notification-filter')
const { safeError } = require('./runtime')
const { readyQuery, claimDelivery, updateBatch, releaseBatch } = require('./delivery-queue')
const { setCooldown, saveCooldown } = require('./delivery-state')
const { sendBatch, telegramError, DeliveryDeferred } = require('./telegram-sender')
const { prepareDigest, WINDOW_MS, DIGEST_DELAY_MS } = require('./digest')

function validateOptions(maxMessages, batchSize, concurrency = 1) {
  for (const [name, value] of Object.entries({ maxMessages, batchSize, concurrency })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`)
  }
  if (batchSize > 10) throw new Error('Notification group size must be <= 10')
}

async function eligible(delivery) {
  if (!delivery.address_id) return true
  const [address, user] = await Promise.all([
    Address.findById(delivery.address_id),
    User.findOne({ user_id: Number(delivery.user_id) }),
  ])
  let skipReason
  if (!address || !user || address.is_deleted || !address.notifications?.is_enabled || user.is_blocked || user.is_deactivated) {
    skipReason = 'inactive_subscription'
  } else if (isIncomingDust(address, delivery.filter_action)) skipReason = 'incoming_dust'
  if (!skipReason) return true
  await updateBatch([delivery], { $set: { status: 'skipped', skip_reason: skipReason }, $unset: { lease_until: 1 } })
  return false
}

async function collectBatch(first, batchSize, excludeDigests, digestNotBefore, deliveryLane) {
  const batch = [first]
  if (first.digest?.window_start) return batch
  let textLength = first.text.length
  let richLength = first.rich_html?.length || 0
  let allRich = Boolean(first.rich_html)
  for (let examined = 1; examined < batchSize; examined += 1) {
    const next = await claimDelivery({ chatId: first.chat_id, pendingOnly: true, excludeDigests, digestNotBefore, deliveryLane })
    if (!next) break
    if (!await eligible(next)) continue
    if (next.digest?.window_start) {
      await releaseBatch([next])
      break
    }
    const combinedTextLength = textLength + 2 + next.text.length
    const combinedRichLength = richLength + 1 + (next.rich_html?.length || 0)
    if (combinedTextLength > 3500 || (allRich && next.rich_html && combinedRichLength > 30000)) {
      await releaseBatch([next])
      break
    }
    batch.push(next)
    textLength = combinedTextLength
    richLength = combinedRichLength
    allRich &&= Boolean(next.rich_html)
  }
  return batch
}

// Remember accepted messages until their DB acknowledgment succeeds. A transient
// database failure must retry this write, not call Telegram again. A process
// crash before persistence still has the documented at-least-once semantics.
async function commitAccepted(state) {
  if (!state.accepted?.size) return
  if (!state.committing) {
    state.committing = (async () => {
      for (const [id, receipt] of state.accepted) {
        await updateBatch(receipt.batch, {
          $set: { status: 'sent', sent_at: receipt.sentAt },
          $unset: { lease_until: 1, last_error: 1 },
        })
        state.accepted.delete(id)
        for (const item of receipt.batch.filter((entry) => entry.address_id)) {
          try { await Address.updateOne({ _id: item.address_id }, { $inc: { 'counters.send_coins': 1 } }) }
          catch (error) { console.error(`Could not update address counter: ${safeError(error)}`) }
        }
      }
    })().finally(() => { state.committing = null })
  }
  await state.committing
}

async function handleSendFailure(error, batch, state) {
  if (error instanceof DeliveryDeferred) {
    await releaseBatch(batch, error.untilMs)
    return
  }
  const failure = telegramError(error)
  if (failure.code === 400 || failure.code === 403) {
    const delivery = batch[0]
    if (delivery.user_id && (failure.code === 403 || /chat not found|user is deactivated/i.test(failure.description))) {
      await User.updateOne({ user_id: Number(delivery.user_id) }, { $set: { is_blocked: true } })
    }
    await updateBatch(batch, {
      $set: { status: 'skipped', last_error: safeError(error).slice(0, 300) }, $unset: { lease_until: 1 },
    })
    return
  }
  const wait = failure.retryAfterMs || Math.min(60000 * 2 ** Math.min(batch[0].attempts || 1, 6), 3600000)
  const until = Date.now() + wait
  if (failure.code === 429) {
    // Memory is updated synchronously, before either DB write. If persistence
    // fails, the next cycle retries it while all requests stay paused.
    setCooldown(state, until)
    await saveCooldown(state)
  }
  await updateBatch(batch, {
    $set: { status: 'pending', next_attempt_at: new Date(until), last_error: safeError(error).slice(0, 300) },
    $unset: { lease_until: 1 },
  })
  console.error(`Delivery retry in ${Math.round(wait / 1000)}s: ${safeError(error)}`)
}

async function sendPending(api, state = {}, { maxMessages = 100, chatId, batchSize = 1, deliveryKind,
  excludeDigests = false, digestNotBefore, deliveryLane, signal, getDeliveryPolicy } = {}) {
  validateOptions(maxMessages, batchSize)
  await saveCooldown(state)
  await commitAccepted(state)
  let sent = 0
  state.chats ||= new Map()
  for (const [chat, until] of state.chats) if (until <= Date.now()) state.chats.delete(chat)
  for (let examined = 0; examined < 100 && sent < maxMessages; examined += 1) {
    if (signal?.aborted) break
    if (state.cooldownUntil > Date.now()) break
    if (chatId !== undefined && state.chats.get(String(chatId)) > Date.now()) break
    if (getDeliveryPolicy) ({ excludeDigests, digestNotBefore } = getDeliveryPolicy())
    if (deliveryKind === 'digest' && excludeDigests) break
    const delivery = await claimDelivery({ chatId, deliveryKind, excludeDigests, digestNotBefore, deliveryLane })
    if (!delivery) break
    const nextChatAt = state.chats.get(String(delivery.chat_id)) || 0
    if (nextChatAt > Date.now()) {
      await releaseBatch([delivery], nextChatAt)
      continue
    }
    if (!await eligible(delivery)) continue
    if (delivery.digest?.window_start) {
      Object.assign(delivery, await prepareDigest(delivery))
      const currentPolicy = getDeliveryPolicy?.()
      if (currentPolicy && (currentPolicy.excludeDigests ||
          (currentPolicy.digestNotBefore && delivery.digest.window_start < currentPolicy.digestNotBefore))) {
        await releaseBatch([delivery])
        break
      }
      await Delivery.updateOne({ _id: delivery._id }, { $set: { text: delivery.text } })
    }
    const batch = await collectBatch(delivery, batchSize, excludeDigests, digestNotBefore, deliveryLane)
    const sendPolicy = delivery.digest?.window_start && getDeliveryPolicy?.()
    if (sendPolicy && (sendPolicy.excludeDigests ||
        (sendPolicy.digestNotBefore && delivery.digest.window_start < sendPolicy.digestNotBefore))) {
      await releaseBatch(batch)
      break
    }
    const chatDelayMs = Number(delivery.chat_id) < 0 ? 3100 : 1100
    // Failed attempts still consume a chat's rate budget.
    state.chats.set(String(delivery.chat_id), Date.now() + chatDelayMs)
    try {
      const beforeSend = delivery.digest?.window_start && getDeliveryPolicy ? () => {
        const current = getDeliveryPolicy()
        if (current.excludeDigests || (current.digestNotBefore && delivery.digest.window_start < current.digestNotBefore)) {
          throw new DeliveryDeferred(Date.now() + 1000)
        }
      } : undefined
      await sendBatch(api, batch, state, config.channelId, beforeSend)
    } catch (error) {
      await handleSendFailure(error, batch, state)
      continue
    }
    const sentAt = new Date()
    state.chats.set(String(delivery.chat_id), sentAt.getTime() + chatDelayMs)
    state.lastSentAt = sentAt.toISOString()
    state.accepted ||= new Map()
    state.accepted.set(delivery._id, { batch, sentAt })
    await commitAccepted(state)
    sent += 1
  }
  return sent
}

async function sendPendingParallel(api, state = {}, { maxMessages = 100, batchSize = 1, concurrency = 4,
  excludeDigests = false, digestNotBefore, preferLive = false, signal, getDeliveryPolicy } = {}) {
  validateOptions(maxMessages, batchSize, concurrency)
  await saveCooldown(state)
  await commitAccepted(state)
  let sent = 0
  state.chats ||= new Map()
  for (let round = 0; round < Math.ceil(maxMessages / concurrency) && sent < maxMessages; round += 1) {
    if (signal?.aborted) break
    if (state.cooldownUntil > Date.now()) break
    if (getDeliveryPolicy) ({ excludeDigests, digestNotBefore, preferLive } = getDeliveryPolicy())
    const excludedChats = []
    for (const [chat, until] of state.chats) {
      if (until <= Date.now()) { state.chats.delete(chat); continue }
      excludedChats.push(chat)
      if (/^-?\d+$/.test(chat)) excludedChats.push(Number(chat))
    }
    const now = new Date()
    const digestDue = readyQuery(now, { excludedChats, deliveryKind: 'digest', digestNotBefore })
    if (digestNotBefore) digestDue.next_attempt_at.$gte = new Date(digestNotBefore.getTime() + WINDOW_MS + DIGEST_DELAY_MS)
    const digests = excludeDigests ? [] : await Delivery.find(digestDue)
      .sort({ next_attempt_at: 1 }).limit(concurrency).select({ chat_id: 1, _id: 0 }).lean()
    const due = readyQuery(now, { excludedChats, excludeDigests: excludeDigests || Boolean(digestNotBefore) })
    const live = preferLive ? await Delivery.find({ ...due, delivery_lane: 'live' })
      .sort({ created_at: 1 }).limit(200).select({ chat_id: 1, _id: 0 }).lean() : []
    const events = await Delivery.find(due)
      .sort({ created_at: 1 }).limit(200).select({ chat_id: 1, _id: 0 }).lean()
    const choices = new Map()
    for (const item of live) choices.set(String(item.chat_id), { chatId: item.chat_id, deliveryLane: 'live' })
    for (const item of digests) {
      if (!choices.has(String(item.chat_id))) choices.set(String(item.chat_id), { chatId: item.chat_id, deliveryKind: 'digest' })
    }
    for (const item of events) {
      if (!choices.has(String(item.chat_id))) choices.set(String(item.chat_id), { chatId: item.chat_id })
    }
    const chats = [...choices.values()].slice(0, Math.min(concurrency, maxMessages - sent))
    if (!chats.length) break
    const results = await Promise.allSettled(chats.map(({ chatId, deliveryKind, deliveryLane }) =>
      sendPending(api, state, { maxMessages: 1, chatId, batchSize, deliveryKind, deliveryLane, excludeDigests, digestNotBefore, signal, getDeliveryPolicy })))
    for (const result of results) if (result.status === 'fulfilled') sent += result.value
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) throw failed.reason
  }
  return sent
}

module.exports = { sendPending, sendPendingParallel }
