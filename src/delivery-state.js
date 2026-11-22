const { Counter } = require('./models')

const DELIVERY_COOLDOWN_NAME = 'telegram_delivery_cooldown_v1'

function setCooldown(state, untilMs) {
  state.cooldownUntil = Math.max(state.cooldownUntil || 0, untilMs)
  state.cooldownDirty = true
}

async function saveCooldown(state) {
  if (!state.cooldownDirty || !state.persistCooldown) return
  const until = state.cooldownUntil
  await state.persistCooldown(until)
  // Another request may have extended the pause while this write was pending.
  if (state.cooldownUntil === until) state.cooldownDirty = false
}

async function loadDeliveryState() {
  const saved = await Counter.findOne({ name: DELIVERY_COOLDOWN_NAME }).lean()
  return {
    cooldownUntil: Number(saved?.data?.untilMs) || 0,
    persistCooldown: (until) => Counter.updateOne({ name: DELIVERY_COOLDOWN_NAME },
      { $max: { 'data.untilMs': until } }, { upsert: true }),
  }
}

module.exports = { DELIVERY_COOLDOWN_NAME, loadDeliveryState, setCooldown, saveCooldown }
