const test=require('node:test'),assert=require('node:assert/strict')
const {Delivery}=require('../src/models')
const {routeAction,deliveryId}=require('../src/scanner')
const A=`0:${'A'.repeat(64)}`,B=`0:${'B'.repeat(64)}`
const records=[1,2,3].map(n=>({_id:String(n),user_id:n,address:A,notifications:{is_enabled:true,min_amount:'0'}}))
const watched={map:new Map([[A,records]]),active:new Set([1,2,3])}
const action={action_id:'fanout',type:'ton_transfer',details:{source:A,destination:B,value:'1'}}

test('fanout preserves each subscription ID and avoids rewriting already queued events',async(t)=>{
  const existing=deliveryId('fanout','1');let calls=0
  t.mock.method(Delivery,'find',()=>({select:()=>({lean:async()=>[{_id:existing}]})}))
  t.mock.method(Delivery,'bulkWrite',async(operations,options)=>{
    calls++;assert.equal(options.ordered,false)
    assert.deepEqual(operations.map(x=>x.updateOne.filter._id),['2','3'].map(id=>deliveryId('fanout',id)))
    assert.deepEqual(operations.map(x=>x.updateOne.update.$setOnInsert.chat_id),[2,3])
    assert(operations.every(x=>x.updateOne.upsert))
  })
  await routeAction(action,{},watched)
  assert.equal(calls,1)
})

test('partial fanout write failure is retried; only duplicate-key races are ignored',async(t)=>{
  t.mock.method(Delivery,'find',()=>({select:()=>({lean:async()=>[]})}))
  let error={writeErrors:[{code:11000}]}
  t.mock.method(Delivery,'bulkWrite',async()=>{throw error})
  await routeAction(action,{},watched)
  error={writeErrors:[{code:11000},{code:6}]}
  await assert.rejects(routeAction(action,{},watched))
  error={writeErrors:[{code:11000}],writeConcernErrors:[{code:64}]}
  await assert.rejects(routeAction(action,{},watched))
})
