const { Address } = require('../models')
const { rawAddress } = require('../address')

const PAGE_SIZE = 5

function normalizeSettings(record) {
  const settings = record.toObject ? record.toObject().notifications : record.notifications
  return { is_enabled: settings !== false, filter_dust: true, min_amount: '0', exceptions: [], inclusion: [],
    ...(settings && typeof settings === 'object' ? settings : {}) }
}

async function getOwned(userId, id, allowDeleted = false) {
  if (!/^[a-f0-9]{24}$/i.test(id || '')) return null
  const record = await Address.findOne({ _id: id, user_id: userId })
  return record && (allowDeleted || !record.is_deleted) ? record : null
}

async function listAddresses(userId, page = 0) {
  const filter = { user_id: userId, is_deleted: false }
  const count = await Address.countDocuments(filter)
  if (!count) return { addresses: [], page: 0, pages: 0 }
  const pages = Math.ceil(count / PAGE_SIZE)
  const safePage = Math.min(Math.max(Number(page) || 0, 0), pages - 1)
  const addresses = await Address.find(filter).sort({ _id: 1 }).skip(safePage * PAGE_SIZE).limit(PAGE_SIZE)
  return { addresses, page: safePage, pages }
}

async function addressPage(record) {
  const preceding = await Address.countDocuments({ user_id: record.user_id, is_deleted: false, _id: { $lt: record._id } })
  return Math.floor(preceding / PAGE_SIZE)
}

async function updateFields(record, fields) {
  // Legacy records can contain notifications:false. Write only the requested
  // fields: saving a hydrated document may write nested defaults into that boolean.
  await Address.updateOne({ _id: record._id, user_id: record.user_id }, { $set: fields })
  Object.assign(record, fields)
  return record
}

async function changeSettings(record, fields) {
  // Replace the legacy boolean only when its owner edits notification settings.
  return updateFields(record, { notifications: { ...normalizeSettings(record), ...fields } })
}

async function subscribe(userId, { address, tag }, { replaceExistingTag = false } = {}) {
  const existing = await Address.find({ user_id: userId })
  const raw = rawAddress(address)
  const matches = existing.filter((entry) => rawAddress(entry.address) === raw)
  let record = matches.find((entry) => !entry.is_deleted) || matches[0]
  if (record && !record.is_deleted) {
    if (replaceExistingTag && record.tag !== tag) await updateFields(record, { tag })
    return { record, added: false }
  }
  if (!record) {
    try { record = await Address.create({ user_id: userId, address, tag }) }
    catch (error) {
      if (error.code !== 11000) throw error
      record = await Address.findOne({ user_id: userId, address })
    }
  } else {
    await updateFields(record, { is_deleted: false, tag })
  }
  if (!record) throw new Error('Could not create address')
  return { record, added: true }
}

module.exports = { normalizeSettings, getOwned, listAddresses, addressPage, updateFields, changeSettings, subscribe }
