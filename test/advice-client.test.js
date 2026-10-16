'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../public/advice-client.js'), 'utf8');
function setup(Worker) {
  const context = { Worker, setTimeout, clearTimeout }; vm.createContext(context); vm.runInContext(source, context); return context.AdviceClient;
}
test('identical observations keep advice in flight; changed decisions discard old replies', () => {
  const workers=[];
  class Worker { constructor(){workers.push(this);} postMessage(data){this.data=data;} terminate(){this.stopped=true;} }
  const Client=setup(Worker), client=new Client(()=>{});
  client.request({street:0}); client.request({street:0});
  assert.equal(workers.length,1); assert.ok(!workers[0].stopped);
  client.request({street:1}); assert.equal(workers[0].stopped,true);
  workers[0].onmessage({data:{key:workers[0].data.key,result:{action:'raise'}}});
  assert.equal(client.result,null);
  workers[1].onmessage({data:{key:workers[1].data.key,result:{action:'call'}}});
  assert.equal(client.result.action,'call'); client.cancel();
});
test('worker startup failure automatically produces fallback advice', async () => {
  const Client=setup(class {constructor(){throw Error('unavailable');}});
  let client;
  await new Promise(resolve=>{client=new Client(resolve,()=>({action:'fold'}));client.request({street:0});});
  assert.equal(client.result.action,'fold'); assert.equal(client.error,null);client.cancel();
});
test('worker runtime failure recovers without manual retry', async () => {
  let worker;
  const Client=setup(class {constructor(){worker=this;}postMessage(){}terminate(){}});
  let client;
  await new Promise(resolve=>{client=new Client(resolve,()=>({action:'check'}));client.request({street:1});worker.onerror();});
  assert.equal(client.result.action,'check');client.cancel();
});
