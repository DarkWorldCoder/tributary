"use strict";
// Disposable synthetic stream through the actual desktop host and renderer.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { app } = require("electron");
const repo = path.resolve(__dirname, "../..");
const output = process.env.TRIBUTARY_AGGREGATE_OUTPUT;
if (!output || !path.isAbsolute(output))
  throw Error("Set an absolute TRIBUTARY_AGGREGATE_OUTPUT path.");
const core = require(path.join(repo, "core"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tributary-aggregate-native-"));
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



const {execFileSync}=require('node:child_process');const {pathToFileURL}=require('node:url');
const mode=process.env.TRIBUTARY_AGGREGATE_MODE||'bounded';if(!['baseline','bounded'].includes(mode))throw Error('Unknown mode');
let host=repo;
if(mode==='baseline'){
 host=path.join(root,'baseline');fs.mkdirSync(host);fs.cpSync(path.join(repo,'desktop'),path.join(host,'desktop'),{recursive:true});
 for(const name of ['core','assets','ui','node_modules'])fs.symlinkSync(path.join(repo,name),path.join(host,name),'dir');fs.copyFileSync(path.join(repo,'package.json'),path.join(host,'package.json'));
 fs.writeFileSync(path.join(host,'desktop/main.js'),execFileSync('git',['show','219b848:desktop/main.js'],{cwd:repo}));
}
let transport;const controller=require(path.join(host,'desktop/message-transport')),create=controller.createMessageTransport;controller.createMessageTransport=options=>(transport=create(options));
const Base=core.Hub;let hub;core.Hub=class extends Base{constructor(...args){super(...args);hub=this}async init(){this.agents=[];this.scanningAgents=false;this.emit('state');return this}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));const until=async(fn,label)=>{for(let i=0;i<300;i++){if(await fn())return;await delay(20)}throw Error('Timed out: '+label)};
const packets=[];let phase='setup',started=false;
const deadline=setTimeout(()=>{console.error('Aggregate desktop fixture timed out');app.exit(1)},60000);
app.on('browser-window-created',(_event,win)=>{
 const web=win.webContents,raw=web.send.bind(web);web.send=(channel,...args)=>{if(channel==='hub-message')packets.push({phase,name:args[0],bytes:Buffer.byteLength(JSON.stringify(args[1]))});return raw(channel,...args)};
 web.on('console-message',event=>{if(event.level==='error')console.error('RENDERER',event.message)});
 web.once('did-finish-load',()=>{if(started)return;started=true;(async()=>{
 const run=code=>web.executeJavaScript(code);await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});true`);
 const loaded=new Promise(resolve=>web.once('did-finish-load',resolve));web.reload();await loaded;
 await until(()=>run(`!!window.hub && !!document.querySelector('[aria-label="Search commands and chats"]')`),'app load');
 const thread=hub.withHistoryOperation(()=>hub.createThread(project,'Aggregate fixture'));
 await until(()=>run(`!!document.querySelector('[title="Aggregate fixture"]')`),'chat listing');await run(`document.querySelector('[title="Aggregate fixture"]').click()`);await delay(250);
 await run(`(async()=>{window.__aggregateReceived=new Map();const {applyPatch}=await import(${JSON.stringify(pathToFileURL(path.join(repo,'ui/src/lib/message-patch.mjs')).href)});window.hub.on('message',d=>window.__aggregateReceived.set(d.message.id,d.message));window.hub.on('message-patch',d=>window.__aggregateReceived.set(d.id,applyPatch(window.__aggregateReceived.get(d.id),d.patch)));return true})()`);
 await until(()=>transport.state().ready,'ready renderer');
 const title='AGGREGATE_BLOCK_'+Date.now();const began=new Promise(resolve=>{const listener=(_event,value)=>{if(value===title){web.off('page-title-updated',listener);resolve()}};web.on('page-title-updated',listener)});
 const blocked=run(`document.title=${JSON.stringify(title)};{const until=performance.now()+2000;while(performance.now()<until){}};true`);await began;phase='blocked';
 let replies,expected;
 await hub.withHistoryOperation(()=>{
  const t=hub.thread(thread.id);replies=Array.from({length:32},(_,i)=>({id:'aggregate-'+i,role:'assistant',agent:'fixture',mode:'read',kind:'chat',text:Buffer.alloc(6144,65+i%26).toString('base64'),thinking:'',thinkingLength:0,tools:[{id:'tool-'+i,name:'Read',input:{file_path:project+'/README.md'},status:'running',output:Buffer.alloc(3072,97+i%26).toString('base64')}],files:[],trace:[],permissions:[],notices:[],ok:null,ts:Date.now()}));
  t.messages.push(...replies);hub.store.save(true);for(const message of replies)hub.emit('message',{threadId:t.id,message});
  for(const message of replies){message.text+=' AGGREGATE_FINAL_'+message.id;message.ok=true;message.tools[0].status='done';message.permissions=[{id:'p',state:'allowed'}];hub.emit('message',{threadId:t.id,message})}hub.store.save(true);expected=JSON.stringify(replies);
 });
 const during=packets.filter(packet=>packet.phase==='blocked'),state=transport.state();const expectedPackets=mode==='bounded'?8:32;
 if(during.length!==expectedPackets||state.active!==expectedPackets)throw Error('Unexpected blocked packet count');phase='drain';const start=Date.now();await blocked;
 await until(()=>hub.histories.pins.size===0&&transport.state().active===0,'transport release');
 await until(()=>run(`document.body.textContent.includes('AGGREGATE_FINAL_aggregate-31')`),'rendered final marker');
 const actual=await run(`JSON.stringify(Array.from({length:32},(_,i)=>window.__aggregateReceived.get('aggregate-'+i)))`);if(actual!==expected)throw Error('Renderer final state differs');
 const report={date:new Date().toISOString(),mode,baseline:'219b848 desktop main with current preload/coalescer/UI; baseline main does not configure shared admission',replyCount:32,blockedMs:2000,blockedPackets:during.length,blockedSerializedBytes:during.reduce((sum,packet)=>sum+packet.bytes,0),totalPackets:packets.length,totalSerializedBytes:packets.reduce((sum,packet)=>sum+packet.bytes,0),stateWhileBlocked:state,elapsedFromBlockedSubmissionsThroughDrainMs:Date.now()-start,finalExact:true,finalDigest:crypto.createHash('sha256').update(actual).digest('hex'),historyPins:hub.histories.pins.size,scope:'Actual Electron IPC submissions for 32 distinct replies while JavaScript is blocked. JSON byte counts are diagnostic; no native RAM or global memory-ceiling claim.',runtime:process.versions,sourceHashes:Object.fromEntries(['core/message-delivery.js','desktop/message-transport.js','desktop/main.js','desktop/preload.js','ui/dist/assets/app.js','scripts/performance/native-aggregate-delivery.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]))};
 fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));clearTimeout(deadline);app.quit();
 })().catch(error=>{console.error(error.stack);app.exit(1)})});
});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require(path.join(host,'desktop/main.js'));
