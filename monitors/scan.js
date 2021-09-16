f = (...args) => console.log(...args)
j = (obj) => f(JSON.stringify(obj, null, 2))

const mongoose = require('mongoose')

const config = require('../config')
const ton = require('../services/ton')
const log = require('../utils/log')
const Block = require('../models/block')

let IS_RUNNING = false

const scanAddresses = async () => {
  if (IS_RUNNING) {
    // log.warn('scan is running')
    return false
  }
  IS_RUNNING = true

  const shardsToEnqueue = []
  const processedBlockIds = []
  const transactionsQueue = []

  const masterchainInfo = await ton.provider.send('getMasterchainInfo', {})
  const lastEnqueuedMaster = await Block.findOne({ type: 'master' })
    .sort({ seqno: 'desc' })

  if (!lastEnqueuedMaster) { // initialize blocks db if there is no known master yet
    await Block.create({
      type: 'master',
      seqno: masterchainInfo.last.seqno,
    })
    const { shards } = await ton.provider.send('shards', { seqno: masterchainInfo.last.seqno })
    for (const shard of shards) {
      await Block.findOneAndUpdate({
        type: 'shard',
        workchain: shard.workchain,
        shard: shard.shard,
        seqno: shard.seqno,
        root_hash: shard.root_hash,
        file_hash: shard.file_hash,
      }, {}, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      })
      log.info(`Enqueued shard block ${shard.shard}#${shard.seqno}`)
    }
    await Block.updateMany({}, { $set: { processed: true } })
    return
  }

  log.info(`Enqueue master blocks ${lastEnqueuedMaster.seqno}-${masterchainInfo.last.seqno}`)

  const preparedMasters = []
  for (let i = lastEnqueuedMaster.seqno; i <= masterchainInfo.last.seqno; i += 1) {
    preparedMasters.push({
      type: 'master',
      seqno: i,
    })
  }
  await Block.create(preparedMasters)

  const enqueuedMasters = await Block
    .find({
      type: 'master',
      processed: false,
    })
    .sort({ seqno: 'asc' })
    .limit(30)

  for (const master of enqueuedMasters) {
    log.info(`Processing master block #${master.seqno}`)
    const { shards } = await ton.provider.send('shards', { seqno: master.seqno })
    for (const shard of shards) {
      shardsToEnqueue.push(shard)
    }
    processedBlockIds.push(master._id)
  }

  const enqueuedShards = await Block
    .find({
      type: 'shard',
      processed: false,
    })
    .sort({ seqno: 'asc' })

  for (const shard of enqueuedShards) {
    const blockHeader = await ton.provider.send('getBlockHeader', {
      workchain: shard.workchain,
      shard: shard.shard,
      seqno: shard.seqno,
      root_hash: shard.root_hash,
      file_hash: shard.file_hash,
    })

    for (const prev of blockHeader.prev_blocks) {
      shardsToEnqueue.push(prev)
    }

    const startGetBlockTxTime = new Date()
    const { transactions } = await ton.provider.send('getBlockTransactions', {
      workchain: shard.workchain,
      shard: shard.shard,
      seqno: shard.seqno,
      root_hash: shard.root_hash,
      file_hash: shard.file_hash,
    })
    log.info(`Processing shard block ${shard.shard}#${shard.seqno} - ${new Date() - startGetBlockTxTime} ms`)

    for (const transaction of transactions) {
      transaction.address = new ton.utils.Address(transaction.account).toString(true, true, true, false)
      log.info(`adding ${transaction.address} to queue`)
      transactionsQueue.push(transaction)
    }

    processedBlockIds.push(shard._id)
  }

  const startSaveShardsTime = new Date()
  for (const shard of shardsToEnqueue) {
    await Block.findOneAndUpdate({
      type: 'shard',
      workchain: shard.workchain,
      shard: shard.shard,
      seqno: shard.seqno,
      root_hash: shard.root_hash,
      file_hash: shard.file_hash,
    }, {}, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    })
  }
  log.info(`Save ${shardsToEnqueue.length} shards - ${new Date() - startSaveShardsTime} ms`)
  // update processed flag
  await Block.updateMany({
    _id: { $in: processedBlockIds },
  }, { $set: { processed: true } })

  j(transactionsQueue)
  for (const transaction of transactionsQueue) {
    const transactions = await ton.provider.send('getTransactions', {
      address: transaction.address,
      lt: transaction.lt,
      hash: ton.utils.bytesToHex(ton.utils.base64ToBytes(transaction.hash)),
      limit: 1,
    })

    j(transactions[0])
  }

  IS_RUNNING = false
}

mongoose
  .connect(config.get('db'))
  .then(() => setInterval(scanAddresses, config.get('synchronizer.interval')))
  .catch(console.error)
