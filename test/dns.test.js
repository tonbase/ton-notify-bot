const test = require('node:test')
const assert = require('node:assert/strict')
const { beginCell, Dictionary, Address } = require('@ton/core')
const { parseAddressInput } = require('../src/bot')
const { resolveDnsAddress } = require('../src/dns')
const { rawAddress } = require('../src/address')

const A = `0:${'A'.repeat(64)}`
const B = `0:${'B'.repeat(64)}`

test('TON and GRM names accept tags and reject malformed names', () => {
  assert.deepEqual(parseAddressInput('TOLYA.TON:tolya.ton'), { address: 'tolya.ton', tag: 'tolya.ton' })
  assert.deepEqual(parseAddressInput('1kilo.grm:wallet'), { address: '1kilo.grm', tag: 'wallet' })
  for (const name of ['x.gram', '.ton', '-bad.ton', 'bad..grm', 'bad_name.ton', 'bad.ton:']) {
    assert.equal(parseAddressInput(name), null)
  }
})

test('TON DNS selects the exact wallet record, then the owner when no wallet is set', async () => {
  const calls = []
  const tonClient = { get: async (path, params) => {
    calls.push({ path, params })
    return { records: [
      { domain: 'other.ton', dns_wallet: B },
      { domain: 'tolya.ton', nft_item_address: B, nft_item_owner: B, dns_wallet: A },
    ] }
  } }
  assert.deepEqual(await resolveDnsAddress('tolya.ton', { tonClient }), { address: A, kind: 'wallet' })
  assert.deepEqual(calls, [{ path: '/dns/records', params: { domain: 'tolya.ton' } }])
  tonClient.get = async () => ({ records: [{ domain: 'tolya.ton', nft_item_address: B, nft_item_owner: A }] })
  assert.deepEqual(await resolveDnsAddress('tolya.ton', { tonClient }), { address: A, kind: 'owner' })
})

const collection = rawAddress('EQAic3zPce496ukFDhbco28FVsKKl2WUX_iJwaL87CBxSiLQ')
const walletKey = Buffer.from('e8d44050873dba865aa7c170ab4cce64d90839a34dcfd6cf71d14e0205443b1b', 'hex')
function grmClient(name, { wallet = null, owner = B, recordedName = name, nftIndex = null } = {}) {
  const indexHash = beginCell().storeStringTail(name).endCell().hash()
  const index = BigInt(`0x${indexHash.toString('hex')}`).toString()
  const records = Dictionary.empty(Dictionary.Keys.Buffer(32), Dictionary.Values.Cell())
  if (wallet) records.set(walletKey, beginCell().storeUint(40915, 16)
    .storeAddress(Address.parseRaw(wallet)).storeUint(0, 8).endCell())
  const content = beginCell().storeUint(0, 8).storeDict(records).endCell()
  const data = beginCell().storeUint(BigInt(index), 256).storeAddress(Address.parseRaw(collection))
    .storeAddress(owner ? Address.parseRaw(owner) : null).storeRef(content)
    .storeRef(beginCell().storeStringTail(recordedName).endCell()).storeMaybeRef(null).storeUint(0, 64).endCell()
  const contract = `0:${'C'.repeat(64)}`
  const calls = []
  return { calls, get: async (path, params) => {
    calls.push({ path, params })
    if (path === '/nft/items') return { nft_items: [{ address: contract, collection_address: collection,
      index: nftIndex || index, init: true }] }
    if (path === '/accountStates') return { accounts: [{ address: contract, status: 'active',
      data_boc: data.toBoc().toString('base64') }] }
    throw new Error(`Unexpected path: ${path}`)
  } }
}

test('GRM DNS reads the current contract wallet record before the owner', async () => {
  const wallet = rawAddress('EQDpeUlg_7y9t5dqrpN3n94abe0Yl1xMwTT0Dk1D2lnuv8pr')
  const staleApiWallet = `0:${'801D2F292C1FF797B6F2ED55D26EF3FBC34DBDA312EB8998269E81C9A87B4B3D'}`
  const client = grmClient('tele', { wallet, owner: B })
  const result = await resolveDnsAddress('tele.grm', { grmClient: client })
  assert.deepEqual(result, { address: '0:E9794960FFBCBDB7976AAE93779FDE1A6DED18975C4CC134F40E4D43DA59EEBF', kind: 'wallet' })
  assert.notEqual(result.address, staleApiWallet)
  assert.deepEqual(client.calls.map(({ path }) => path), ['/nft/items', '/accountStates'])
  assert.equal(client.calls[0].params.collection_address, collection)
})

test('GRM DNS falls back to the on-chain owner only without a wallet record', async () => {
  assert.deepEqual(await resolveDnsAddress('1kilo.grm', { grmClient: grmClient('1kilo') }),
    { address: B, kind: 'owner' })
  assert.equal(await resolveDnsAddress('1kilo.grm', { grmClient: grmClient('1kilo', { owner: null }) }), null)
})

test('GRM DNS rejects another item index or a mismatched on-chain domain', async () => {
  assert.equal(await resolveDnsAddress('tele.grm', { grmClient: grmClient('tele', { nftIndex: '1' }) }), null)
  await assert.rejects(resolveDnsAddress('tele.grm', {
    grmClient: grmClient('tele', { recordedName: 'other' }),
  }), /Invalid GRM DNS contract data/)
})
