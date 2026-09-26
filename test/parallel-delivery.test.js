const test=require('node:test'),assert=require('node:assert/strict')
const {Delivery}=require('../src/models')
const {sendPendingParallel}=require('../src/scanner')

test('parallel delivery sends to distinct chats while enforcing the message budget',async(t)=>{
  const sent=[];let active=0,maximum=0
  t.mock.method(Delivery,'find',()=>({sort:()=>({limit:()=>({select:()=>({lean:async()=>[123,123,456,789,999].map(chat_id=>({chat_id}))})})})}))
  t.mock.method(Delivery,'findOneAndUpdate',async query=>({_id:String(query.chat_id),chat_id:query.chat_id,text:'event'}))
  t.mock.method(Delivery,'updateOne',async()=>{})
  const count=await sendPendingParallel({sendMessage:async(chat)=>{
    active++;maximum=Math.max(maximum,active);sent.push(chat)
    await new Promise(resolve=>setImmediate(resolve));active--
  }},{},{maxMessages:3})
  assert.equal(count,3);assert.equal(maximum,3);assert.deepEqual(sent,[123,456,789])
})

test('a shared Telegram cooldown prevents another parallel delivery round',async(t)=>{
  let selections=0,calls=0
  t.mock.method(Delivery,'find',()=>{selections++;return {sort:()=>({limit:()=>({select:()=>({lean:async()=>[123,456].map(chat_id=>({chat_id}))})})})}})
  t.mock.method(Delivery,'findOneAndUpdate',async query=>({_id:String(query.chat_id),chat_id:query.chat_id,text:'event'}))
  t.mock.method(Delivery,'updateOne',async()=>{})
  t.mock.method(console,'error',()=>{})
  const state={}
  await sendPendingParallel({sendMessage:async()=>{calls++;throw {error_code:429,parameters:{retry_after:30}}}},state)
  assert.equal(selections,1);assert.equal(calls,2)
  assert(state.cooldownUntil>Date.now()+29000)
})
