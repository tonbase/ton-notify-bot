const test=require('node:test')
const assert=require('node:assert/strict')
const {Delivery,Address,User}=require('../src/models')
const {sendPending}=require('../src/scanner')

test('grouped delivery claims only one chat and commits every event after one native send',async(t)=>{
  const events=[1,2,3].map(n=>({_id:`event-${n}`,chat_id:123,text:`event ${n}`,rich_html:`<p>event ${n}</p>`}))
  let claims=0,calls=0;const updates=[]
  t.mock.method(Delivery,'findOneAndUpdate',async(filter)=>{
    if(claims++)assert.equal(filter.chat_id,123)
    return events.shift()||null
  })
  t.mock.method(Delivery,'updateMany',async(filter,update)=>updates.push({filter,update}))
  const sent=await sendPending({sendRichMessage:async(chat,body)=>{
    assert.equal(chat,123);assert.equal(body.html,'<p>event 1</p>\n<p>event 2</p>\n<p>event 3</p>');calls++
  }},{},{maxMessages:1,batchSize:3})
  assert.equal(sent,1);assert.equal(calls,1)
  assert.deepEqual(updates[0].filter._id.$in,['event-1','event-2','event-3'])
  assert.equal(updates[0].update.$set.status,'sent')
})

test('groups exclude disabled subscriptions and release events that exceed the text limit',async(t)=>{
  const events=[{_id:'first',chat_id:123,text:'a'.repeat(2000)},
    {_id:'disabled',chat_id:123,text:'hidden',address_id:'address',user_id:'123'},
    {_id:'large',chat_id:123,text:'b'.repeat(2000)}]
  const updates=[]
  t.mock.method(Delivery,'findOneAndUpdate',async()=>events.shift()||null)
  t.mock.method(Delivery,'updateOne',async(filter,update)=>updates.push({filter,update}))
  t.mock.method(Address,'findById',async()=>({notifications:{is_enabled:false}}))
  t.mock.method(User,'findOne',async()=>({}))
  await sendPending({sendMessage:async(_chat,text)=>assert.equal(text,'a'.repeat(2000))},{},{maxMessages:1,batchSize:3})
  assert.deepEqual(updates.map(x=>[x.filter._id,x.update.$set.status]),[['disabled','skipped'],['large','pending'],['first','sent']])
  assert.equal(updates[1].update.$inc.attempts,-1)
})

test('Telegram 429 retains every event in a group and applies one shared cooldown',async(t)=>{
  const events=[1,2].map(n=>({_id:`event-${n}`,chat_id:123,text:`event ${n}`}))
  const updates=[];let calls=0
  t.mock.method(Delivery,'findOneAndUpdate',async()=>events.shift()||null)
  t.mock.method(Delivery,'updateMany',async(filter,update)=>updates.push({filter,update}))
  t.mock.method(console,'error',()=>{})
  const state={}
  const api={sendMessage:async()=>{calls++;throw {error_code:429,parameters:{retry_after:10}}}}
  assert.equal(await sendPending(api,state,{batchSize:2}),0)
  assert.equal(await sendPending(api,state,{batchSize:2}),0)
  assert.equal(calls,1)
  assert.deepEqual(updates[0].filter._id.$in,['event-1','event-2'])
  assert.equal(updates[0].update.$set.status,'pending')
  assert(updates[0].update.$set.next_attempt_at.getTime()>Date.now()+9900)
})
