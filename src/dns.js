const { beginCell, Cell, Dictionary } = require('@ton/core')
const { rawAddress } = require('./address')
const { TonCenter } = require('./toncenter')

const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:ton|grm)$/i
const GRM_COLLECTION = rawAddress('EQAic3zPce496ukFDhbco28FVsKKl2WUX_iJwaL87CBxSiLQ')
const WALLET_CATEGORY = Buffer.from('e8d44050873dba865aa7c170ab4cce64d90839a34dcfd6cf71d14e0205443b1b', 'hex')

function domainName(value) {
  if (typeof value !== 'string' || value.length > 126 || !DNS_NAME.test(value)) return null
  return value.toLowerCase()
}

async function resolveTonDomain(domain, client = new TonCenter()) {
  const data = await client.get('/dns/records', { domain })
  const record = data.records?.find((item) => item.domain?.toLowerCase() === domain)
  const wallet = rawAddress(record?.dns_wallet)
  if (wallet) return { address: wallet, kind: 'wallet' }
  const owner = rawAddress(record?.nft_item_owner)
  return owner ? { address: owner, kind: 'owner' } : null
}

async function resolveGrmDomain(domain, client = new TonCenter()) {
  const name = domain.slice(0, -4)
  const indexHash = beginCell().storeStringTail(name).endCell().hash()
  const index = BigInt(`0x${indexHash.toString('hex')}`).toString()
  const items = await client.get('/nft/items', { collection_address: GRM_COLLECTION, index, limit: 1 })
  const item = items.nft_items?.find((candidate) => candidate.index === index
    && rawAddress(candidate.collection_address) === GRM_COLLECTION)
  const itemAddress = rawAddress(item?.address)
  if (!itemAddress || item.init === false) return null

  const states = await client.get('/accountStates', { address: itemAddress, include_boc: true })
  const account = states.accounts?.find((candidate) => rawAddress(candidate.address) === itemAddress)
  if (!account || account.status !== 'active' || !account.data_boc) return null
  const data = Cell.fromBoc(Buffer.from(account.data_boc, 'base64'))[0].beginParse()
  if (data.loadUintBig(256).toString() !== index || rawAddress(data.loadAddress().toRawString()) !== GRM_COLLECTION) {
    throw new Error('GRM DNS contract identity mismatch')
  }
  const owner = rawAddress(data.loadMaybeAddress()?.toRawString())
  const content = data.loadRef().beginParse()
  const recordedName = data.loadRef().beginParse().loadStringTail()
  if (recordedName !== name || content.loadUint(8) !== 0) throw new Error('Invalid GRM DNS contract data')
  const records = content.loadDict(Dictionary.Keys.Buffer(32), Dictionary.Values.Cell())
  const walletCell = records.get(WALLET_CATEGORY)
  if (walletCell) {
    const wallet = walletCell.beginParse()
    if (wallet.loadUint(16) !== 40915) throw new Error('Invalid GRM DNS wallet record')
    const address = rawAddress(wallet.loadAddress().toRawString())
    if (address) return { address, kind: 'wallet' }
  }
  return owner ? { address: owner, kind: 'owner' } : null
}

async function resolveDnsAddress(domain, options = {}) {
  const name = domainName(domain)
  if (!name) return null
  return name.endsWith('.ton')
    ? resolveTonDomain(name, options.tonClient)
    : resolveGrmDomain(name, options.grmClient)
}

module.exports = { domainName, resolveDnsAddress, resolveTonDomain, resolveGrmDomain }
