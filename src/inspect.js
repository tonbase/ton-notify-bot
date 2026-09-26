const { TonCenter } = require('./toncenter')
const { rawAddress } = require('./address')
const { participants, formatAction } = require('./events')

async function discoverAddresses(client) {
  const results = []
  for (const type of ['ton_transfer', 'jetton_transfer', 'nft_transfer']) {
    const page = await client.actions({ action_type: type, limit: 10, sort: 'desc' })
    const action = page.actions.find((item) => item.success !== false && participants(item).some((address) => address.startsWith('0:')))
    if (!action) continue
    const preferred = action.details?.source || action.details?.sender || action.details?.old_owner
    const address = rawAddress(preferred) || participants(action).find((item) => item.startsWith('0:'))
    if (address) results.push({ type, address })
  }
  return results
}

async function inspectAddress(client, address, label = 'address') {
  const raw = rawAddress(address)
  if (!raw) throw new Error(`Invalid address: ${address}`)
  const page = await client.actions({ account: raw, limit: 20, sort: 'desc', include_accounts: true })
  console.log(`\n${label}: ${raw} — ${page.actions.length} recent actions`)
  for (const action of page.actions.slice(0, 8)) {
    console.log(`\n${action.type} | ${new Date((action.end_utime || 0) * 1000).toISOString()} | ${action.action_id}`)
    console.log(formatAction(action, raw, null, page.metadata).replace(/<[^>]+>/g, ''))
  }
  return page.actions
}

async function main() {
  const client = new TonCenter()
  const inputs = process.argv.slice(2)
  const targets = inputs.length ? inputs.map((address) => ({ type: 'manual', address })) : await discoverAddresses(client)
  if (!targets.length) throw new Error('No recent addresses found')
  for (const target of targets) await inspectAddress(client, target.address, target.type)
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })

module.exports = { discoverAddresses, inspectAddress }
