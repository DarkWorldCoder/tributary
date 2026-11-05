'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createMessageTransport,ownsMessageFrame}=require('../desktop/message-transport');
const {bindMessageDelivery}=require('../core/message-delivery');
const tick=()=>new Promise(setImmediate), wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await wait(2)}throw Error('Delivery did not settle')};
const clone=value=>JSON.parse(JSON.stringify(value));
const message=id=>({id,role:'assistant',text:'',thinking:'',tools:[],trace:[],ok:null});
function fixture(t){
 const hub=new EventEmitter(),packets=[],handshakes=[];let held=0,peak=0,dispose;
 hub.holdHistory=()=>{held++;peak=Math.max(peak,held);let live=true;return()=>{if(live){live=false;held--}}};
 const transport=createMessageTransport({send:(channel,...args)=>{if(channel==='hub-message')packets.push(clone({name:args[0],data:args[1],token:args[2]}));else handshakes.push(args[0])},onReady:()=>dispose.reset()});
 dispose=bindMessageDelivery(hub,(...args)=>transport.deliver(...args),1);
 t.after(()=>{dispose();transport.close()});
 return {hub,transport,dispose,packets,handshakes,held:()=>held,peak:()=>peak,ready:()=>transport.ready(transport.state().epoch,true),emit:(name,m,threadId='chat')=>hub.emit(name,{threadId,message:m}),ack:index=>transport.ack(packets[index].token,true)};
}

test('desktop waits for its consumer and bounds a stalled reply to one packet and one latest state',async t=>{
 const f=fixture(t),m=message('reply');f.emit('message',m);
 assert.equal(f.packets.length,0);assert.equal(f.held(),1);assert.equal(f.transport.state().interrupted,1);
 f.transport.handshake();assert.equal(f.handshakes[0],f.transport.state().epoch);f.ready();await until(()=>f.packets.length===1);
 for(let i=0;i<500;i++){m.text+=`word-${i} `;m.tools=[{id:'tool',output:String(i),status:'running'}];f.emit('event',m)}
 await wait(8);assert.equal(f.packets.length,1);assert.equal(f.held(),2);assert.equal(f.peak(),2);assert.equal(f.transport.state().active,1);
 m.ok=true;m.tools[0].status='done';m.trace.push({kind:'tool',toolIndex:0,textOffset:0});m.permissions=[{id:'p',state:'allowed'}];f.emit('message',m);
 f.ack(0);await until(()=>f.packets.length===2);assert.equal(f.packets[1].name,'message');assert.deepEqual(f.packets[1].data.message,clone(m));
 f.ack(1);await until(()=>f.held()===0);assert.equal(f.transport.state().active,0);
});

test('reload ignores stale acknowledgements and replays latest full state before releasing its history',async t=>{
 const f=fixture(t),m=message('reply');f.ready();f.emit('message',m);
 m.text='latest before reload';f.emit('event',m);await wait(5);const old=f.packets[0].token;
 f.transport.reset();const current=f.transport.state().epoch;assert.notEqual(current,old.epoch);
 f.transport.ack(old,true);f.transport.ready(old.epoch,true);await tick();assert.equal(f.packets.length,1);assert.equal(f.held(),2);
 m.text+=' plus final';m.ok=true;f.emit('message',m);f.ready();await until(()=>f.packets.length===2);
 assert.equal(f.packets[1].name,'message');assert.deepEqual(f.packets[1].data.message,clone(m));
 f.transport.ack(old,true);assert.equal(f.transport.state().active,1);f.ack(1);await until(()=>f.held()===0);
});

test('an interrupted final is replayed even when no new agent event arrives',async t=>{
 const f=fixture(t),m={...message('final'),ok:true,text:'complete'};f.ready();f.emit('message',m);
 f.transport.reset();f.transport.reset();assert.equal(f.transport.state().interrupted,1);f.ready();await until(()=>f.packets.length===2);
 assert.equal(f.packets[1].name,'message');assert.deepEqual(f.packets[1].data.message,m);f.ack(1);await until(()=>f.held()===0);
});

test('a ready replacement invalidates already acknowledged bases and unrelated replies remain independent',async t=>{
 const f=fixture(t),a=message('a'),b=message('b');f.ready();f.emit('message',a);f.ack(0);await until(()=>f.held()===0);
 a.text='delta';f.emit('event',a);await until(()=>f.packets.length===2);assert.equal(f.packets[1].name,'message-patch');f.ack(1);await until(()=>f.held()===0);
 f.transport.reset();f.ready();a.text+=' replacement';f.emit('event',a);await until(()=>f.packets.length===3);assert.equal(f.packets[2].name,'message');
 f.emit('message',b,'other');assert.equal(f.packets.length,4);f.ack(3);await tick();assert.equal(f.held(),1);f.ack(2);await until(()=>f.held()===0);
});

test('listener replacement suspends delivery and duplicate readiness and acknowledgements do not replay twice',async t=>{
 const f=fixture(t),m=message('reply');f.ready();f.emit('message',m);const epoch=f.transport.state().epoch;
 f.transport.ready(epoch,false);f.transport.ack(f.packets[0].token,true);await tick();assert.equal(f.held(),1);
 f.ready();f.ready();await until(()=>f.packets.length===2);assert.equal(f.packets[1].name,'message');f.ack(1);f.ack(1);await until(()=>f.held()===0);assert.equal(f.packets.length,2);
});

test('closing and disposing release cold, active and pending ownership without resurrection',async t=>{
 for(const ready of [true,false]){
  const f=fixture(t),m=message('reply');if(ready)f.ready();f.emit('message',m);m.text='queued';f.emit('event',m);await wait(5);
  const count=f.packets.length;f.dispose();f.transport.close();f.transport.close();f.ready();await until(()=>f.held()===0);assert.equal(f.packets.length,count);
  assert.equal(f.transport.deliver('message',{}),false);assert.equal(f.transport.state().interrupted,0);assert.equal(f.transport.state().active,0);
 }
});

test('failed IPC sends settle false, and only the live main frame owns message acknowledgements',async()=>{
 const transport=createMessageTransport({send:()=>{throw Error('closed')}});transport.ready(transport.state().epoch,true);
 assert.equal(await transport.deliver('message',{}),false);assert.equal(transport.state().active,0);transport.close();
 const frame={},contents={mainFrame:frame,isDestroyed:()=>false};assert.equal(ownsMessageFrame({sender:contents,senderFrame:frame},contents),true);
 for(const event of [{sender:{},senderFrame:frame},{sender:contents,senderFrame:{}},{sender:contents,senderFrame:null}])assert.equal(ownsMessageFrame(event,contents),false);
 assert.equal(ownsMessageFrame({sender:contents,senderFrame:frame},{...contents,isDestroyed:()=>true}),false);
});

test('sandboxed preload acknowledges synchronous listener dispatch without exposing acknowledgement tokens',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const ipc=new EventEmitter(),sent=[],errors=[];let bridge;
 ipc.send=(...args)=>sent.push(args);ipc.invoke=(...args)=>Promise.resolve(args);
 vm.runInNewContext(fs.readFileSync(require.resolve('../desktop/preload'),'utf8'),{require:()=>({ipcRenderer:ipc,contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value}}}),process:{platform:'linux'},queueMicrotask,console:{error:(...args)=>errors.push(args)}});
 assert.deepEqual(Object.keys(bridge).sort(),['call','on','os','platform']);
 const received=[];const offFull=bridge.on('message',value=>received.push(value));ipc.emit('hub-message-handshake',{},'one');assert.equal(sent.length,0);
 const offPatch=bridge.on('message-patch',()=>{});assert.deepEqual(sent[0],['hub-message-ready','one',true]);
 const token={epoch:'one',id:1};ipc.emit('hub-message',{},'message',{text:'full'},token);assert.equal(received.length,1);assert.equal(sent.length,1);await tick();assert.deepEqual(sent[1],['hub-message-ack',token,true]);
 offPatch();assert.deepEqual(sent[2],['hub-message-ready','one',false]);offFull();
 const offBad=bridge.on('message',()=>{throw Error('handler failed')});const offOther=bridge.on('message-patch',()=>{});
 ipc.emit('hub-message',{},'message',{}, {epoch:'one',id:2});await tick();assert.equal(sent.at(-1)[2],false);assert.equal(errors.length,1);
 const count=sent.length;ipc.emit('hub-message',{},'message',{}, {epoch:'old',id:3});await tick();assert.equal(sent.length,count);
 ipc.emit('hub-message-handshake',{},'two');assert.deepEqual(sent.at(-1),['hub-message-ready','two',true]);offBad();offOther();
});
