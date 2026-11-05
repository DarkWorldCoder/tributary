"use strict";
// Disposable synthetic stream through the actual desktop host and renderer.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { app } = require("electron");
const repo = path.resolve(__dirname, "../..");
const output = process.env.TRIBUTARY_IPC_OUTPUT;
if (!output || !path.isAbsolute(output))
  throw Error("Set an absolute TRIBUTARY_IPC_OUTPUT path.");
const core = require(path.join(repo, "core"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tributary-ipc-native-"));
const profile = path.join(root, "profile"),
  project = path.join(root, "project");
fs.mkdirSync(project);
fs.writeFileSync(
  path.join(project, "README.md"),
  "# Delivery transport fixture\n",
);
process.env.TRIBUTARY_DATA_DIR = profile;
const seed = new core.SqliteStore(profile, {
  version: 1,
  projects: [{ path: project, name: "Delivery project fixture", trusted: true }],
  threads: [],
  gateways: [],
  notifications: [],
  settings: { mode: "read" },
});
seed.data.projects = [
  { path: project, name: "Delivery project fixture", trusted: true },
];
seed.save(true);
seed.close();


const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const mode=process.env.TRIBUTARY_IPC_MODE || 'acknowledged';
if(!['baseline','acknowledged'].includes(mode))throw Error('Unknown IPC mode');
let host=repo;
if(mode==='baseline'){
 host=path.join(root,'baseline');fs.mkdirSync(host);fs.cpSync(path.join(repo,'desktop'),path.join(host,'desktop'),{recursive:true});
 for(const name of ['core','assets','ui','node_modules'])fs.symlinkSync(path.join(repo,name),path.join(host,name),'dir');
 fs.copyFileSync(path.join(repo,'package.json'),path.join(host,'package.json'));
 for(const file of ['desktop/main.js','desktop/preload.js'])fs.writeFileSync(path.join(host,file),execFileSync('git',['show','93f5e5c:'+file],{cwd:repo}));
}
let transport;
if(mode==='acknowledged'){
 const controller=require(path.join(repo,'desktop/message-transport'));
 const create=controller.createMessageTransport;
 controller.createMessageTransport=(options)=>(transport=create(options));
}
const Base=core.Hub;let hub;
core.Hub=class extends Base{constructor(...args){super(...args);hub=this}async init(){this.agents=[];this.scanningAgents=false;this.emit('state');return this}};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{for(let i=0;i<300;i++){if(await fn())return;await delay(20)}throw Error('Timed out: '+label)};
const packets=[];let phase='setup',started=false;
const deadline=setTimeout(()=>{console.error('IPC fixture timed out');app.exit(1)},60000);
app.on('browser-window-created',(_event,win)=>{
 const web=win.webContents,rawSend=web.send.bind(web);
 web.send=(channel,...args)=>{
  const name=channel==='hub-message'?args[0]:channel==='hub-event'?args[0]:null;
  if(['message','message-patch'].includes(name))packets.push({phase,name,id:args[1].id||args[1].message?.id,bytes:Buffer.byteLength(JSON.stringify(args[1])),token:channel==='hub-message'?args[2]:null});
  return rawSend(channel,...args);
 };
 web.once('did-finish-load',()=>{if(started)return;started=true;(async()=>{
 web.on('console-message',event=>{if(event.level==='error')console.error('RENDERER',event.message)});const run=code=>web.executeJavaScript(code).catch(error=>{throw Error(error.message+'; script: '+code.slice(0,180))});
 await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});true`);
 let loaded=new Promise(r=>web.once('did-finish-load',r));web.reload();await loaded;
 await until(()=>run(`!!window.hub && !!document.querySelector('[aria-label="Search commands and chats"]')`),'app load');
 const thread=hub.withHistoryOperation(()=>hub.createThread(project,'IPC fixture'));
 await until(()=>run(`!!document.querySelector('[title="IPC fixture"]')`),'chat listing');
 await run(`document.querySelector('[title="IPC fixture"]').click()`);await delay(250);
 await run(`(async()=>{window.__ipcReceived=null;const {applyPatch}=await import(${JSON.stringify(pathToFileURL(path.join(repo,'ui/src/lib/message-patch.mjs')).href)});window.hub.on('message',d=>{if(d.message.id==='ipc-reply')window.__ipcReceived=d.message});window.hub.on('message-patch',d=>{if(d.id==='ipc-reply')window.__ipcReceived=applyPatch(window.__ipcReceived,d.patch)});return true})()`);
 if(transport)await until(()=>transport.state().ready,'consumer readiness');
 const block=async ms=>{
  const title='IPC_BLOCK_'+Date.now();
  const seen=new Promise(resolve=>{const listener=(_event,value)=>{if(value===title){web.off('page-title-updated',listener);resolve()}};web.on('page-title-updated',listener)});
  const done=run(`document.title=${JSON.stringify(title)};{const until=performance.now()+${ms};while(performance.now()<until){}};true`).catch(()=>false);
  await seen;return {done};
 };
 let reply,expected;const blockState=await block(2000);phase='blocked';let peakOwners=0;
 await hub.withHistoryOperation(async()=>{
  const t=hub.thread(thread.id);reply={id:'ipc-reply',role:'assistant',agent:'fixture',mode:'read',kind:'chat',text:'',thinking:'',thinkingLength:0,tools:[],files:[],trace:[],permissions:[],notices:[],ok:null,ts:Date.now()};t.messages.push(reply);hub.store.save(true);hub.emit('message',{threadId:t.id,message:reply});
  for(let i=0;i<100;i++){hub.apply(t,reply,{kind:'text',text:`${i}:`+'synthetic '.repeat(200)});hub.emit('event',{threadId:t.id,message:reply});peakOwners=Math.max(peakOwners,hub.histories.pins.get(t.id)||0);await delay(10)}
  hub.apply(t,reply,{kind:'tool',id:'tool',name:'Read',input:{file_path:project+'/README.md'},status:'done',output:'Synthetic fixture'});hub.apply(t,reply,{kind:'text',text:'IPC_EXACT_FINAL'});reply.ok=true;hub.store.save(true);hub.emit('message',{threadId:t.id,message:reply});expected=JSON.stringify(reply);
 });
 const blockedPackets=packets.filter(p=>p.phase==='blocked');const outstandingAtBlockEnd=transport?.state();if(transport&&(blockedPackets.length!==1||outstandingAtBlockEnd.active!==1))throw Error('Renderer stall was not bounded');phase='drain';await blockState.done;
 await until(()=>run('document.body.textContent.includes("IPC_EXACT_FINAL")'),'final DOM');
 await until(()=>hub.histories.pins.size===0,'released history');
 const rendered=await run('JSON.stringify(window.__ipcReceived)');if(rendered!==expected)throw Error('Final renderer state mismatch');
 const stream={updates:100,blockedMs:2000,packetsWhileBlocked:blockedPackets.length,serializedBytesWhileBlocked:blockedPackets.reduce((sum,p)=>sum+p.bytes,0),totalPackets:packets.filter(p=>p.id==='ipc-reply').length,totalSerializedBytes:packets.filter(p=>p.id==='ipc-reply').reduce((sum,p)=>sum+p.bytes,0),transportAtBlockEnd:outstandingAtBlockEnd||null,peakOwnerCountDuringOperation:peakOwners,finalExact:true};
 let reload=null;
 if(transport){
  const held=await block(2000);phase='reload';
  await hub.withHistoryOperation(()=>{const t=hub.thread(thread.id);reply=hub.thread(thread.id).messages.at(-1);reply.ok=null;reply.text+=' BEFORE_RELOAD';hub.store.save(true);hub.emit('message',{threadId:t.id,message:reply})});
  await until(()=>transport.state().active===1,'inflight before reload');const epoch=transport.state().epoch;
  await hub.withHistoryOperation(()=>{const t=hub.thread(thread.id);reply.text+=' IPC_RELOAD_FINAL';reply.ok=true;hub.store.save(true);hub.emit('message',{threadId:t.id,message:reply})});
  loaded=new Promise(r=>web.once('did-finish-load',r));web.reload();await loaded;await held.done;
  await until(()=>transport.state().ready&&hub.histories.pins.size===0,'reload replay');
  web.send('hub-event','open-thread',thread.id);
  await until(()=>run('document.body.textContent.includes("IPC_RELOAD_FINAL")'),'reloaded final DOM');
  const replay=packets.filter(p=>p.phase==='reload');reload={newEpoch:transport.state().epoch!==epoch,packets:replay.map(p=>({name:p.name,epoch:p.token?.epoch})),fullReplay:replay.length===2&&replay.every(p=>p.name==='message'),historyPins:hub.histories.pins.size,persistedExact:hub.readThread(thread.id).messages.at(-1).text===reply.text,rendered:true};
  if(!reload.newEpoch||!reload.fullReplay||!reload.persistedExact)throw Error('Reload ownership failed');
 }
 const report={date:new Date().toISOString(),mode,baseline:'93f5e5c desktop main/preload with the same current core coalescer and UI',stream,reload,historyPins:hub.histories.pins.size,runtime:process.versions,platform:process.platform,scope:'Real Electron IPC with a blocked JavaScript renderer and synthetic Hub events. Packet and serialized-byte counts, not process RAM, React paint completion, provider flow control or a global memory ceiling.',sourceHashes:Object.fromEntries(['core/message-delivery.js','desktop/message-transport.js','desktop/main.js','desktop/preload.js','ui/src/store.tsx','ui/dist/assets/app.js','scripts/performance/native-ipc-delivery.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]))};
 fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));clearTimeout(deadline);app.quit();
 })().catch(error=>{console.error(error.stack);app.exit(1)})});
});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require(path.join(host,'desktop/main.js'));
