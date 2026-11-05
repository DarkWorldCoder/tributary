"use strict";
// Disposable synthetic stream through the actual desktop host and renderer.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { app } = require("electron");
const repo = path.resolve(__dirname, "../..");
const output = process.env.TRIBUTARY_DELIVERY_OUTPUT;
if (!output || !path.isAbsolute(output))
  throw Error("Set an absolute TRIBUTARY_DELIVERY_OUTPUT path.");
const core = require(path.join(repo, "core"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tributary-delivery-native-"));
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

const Base=core.Hub;let fixtureHub;
core.Hub=class extends Base { constructor(...args){super(...args);fixtureHub=this;}async init(){this.agents=[];this.scanningAgents=false;this.emit('state');return this;} };
const delay=ms=>new Promise(r=>setTimeout(r,ms));let started=false;
fs.writeFileSync(path.join(project,'.env.local'),'EXAMPLE=synthetic\n');
const deadline=setTimeout(()=>{console.error('Delivery UI check timed out');app.exit(1)},60000);
app.on('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',()=>{if(started)return;started=true;(async()=>{
 const web=win.webContents;web.on('console-message',event=>{if(event.level==='error')console.log('RENDERER_ERROR',event.message)});const run=code=>web.executeJavaScript(code);const until=async(code)=>{for(let i=0;i<200;i++){if(await run(code))return;await delay(100)}throw Error('Missing UI: '+code+'; '+await run('document.body.innerText.slice(-1800)'))};
 await run(`localStorage.setItem('tributary.project',${JSON.stringify(JSON.stringify(project))});localStorage.setItem('tributary.workspaceViews.v1',JSON.stringify({[${JSON.stringify(project)}]:{layout:'editor',expanded:false,panel:{open:true,tab:'files'}}}))`);const loaded=new Promise(r=>web.once('did-finish-load',r));web.reload();await loaded;
 await until(`!!window.hub && !!document.querySelector('[data-tree-path=".env.local"]')`);
 const thread=fixtureHub.withHistoryOperation(()=>fixtureHub.createThread(project,'Delivery fixture'));
 await until(`!!document.querySelector('[title="Delivery fixture"]')`);
 await run(`document.querySelector('[title="Delivery fixture"]').click()`);
 await delay(300);
 await run(`window.__deliveryProof={full:0,patches:0,user:0};window.hub.on('message',d=>{window.__deliveryProof.full++;if(d.message.role==='user')window.__deliveryProof.user++});window.hub.on('message-patch',()=>window.__deliveryProof.patches++);true`);
 const expected=await fixtureHub.withHistoryOperation(async()=>{
  const t=fixtureHub.thread(thread.id);const user={id:'native-user',role:'user',target:'fixture',kind:'chat',attachments:[],text:'Read the synthetic fixture.',ts:Date.now()};const reply={id:'native-reply',role:'assistant',agent:'fixture',mode:'read',kind:'chat',text:'',thinking:'',thinkingLength:0,tools:[],files:[],trace:[],permissions:[],notices:[],ok:null,ts:Date.now()};t.messages.push(user,reply);fixtureHub.store.save(true);
  fixtureHub.emit('message',{threadId:t.id,message:user});fixtureHub.emit('message',{threadId:t.id,message:reply});
  for(let i=0;i<40;i++){fixtureHub.apply(t,reply,{kind:'text',text:`step-${i} `});fixtureHub.emit('event',{threadId:t.id,message:reply});await delay(8)}
  fixtureHub.apply(t,reply,{kind:'tool',id:'read-1',name:'Read',input:{file_path:project+'/README.md'},status:'done',output:'Synthetic fixture.'});fixtureHub.emit('event',{threadId:t.id,message:reply});
  fixtureHub.apply(t,reply,{kind:'text',text:'NATIVE_DELIVERY_COMPLETE'});reply.ok=true;reply.durationMs=320;fixtureHub.store.save(true);fixtureHub.emit('message',{threadId:t.id,message:reply});return reply.text;
 });
 await until(`document.body.textContent.includes('NATIVE_DELIVERY_COMPLETE')`);
 const report=await run(`({...window.__deliveryProof,rendered:document.body.textContent.includes('NATIVE_DELIVERY_COMPLETE')})`);
 if(report.patches<1||report.user!==1)throw Error('Streaming or prompt events missing');
 await delay(150);report.remainingHistoryPins=fixtureHub.histories.pins.size;report.releasedHistories=fixtureHub.histories.trim(Infinity);report.persistedTextMatches=fixtureHub.readThread(thread.id).messages.at(-1).text===expected;
 if(report.remainingHistoryPins!==0||!report.persistedTextMatches)throw Error('History ownership did not settle');
 report.date=new Date().toISOString();report.runtime=process.versions;report.platform=process.platform;report.scope='Actual desktop IPC and rendering with synthetic Hub events; no provider request or native-memory claim. The blocked async transport is measured separately.';report.sourceHashes=Object.fromEntries(['core/message-patch.js','core/message-delivery.js','desktop/main.js','ui/src/store.tsx','ui/dist/assets/app.js','scripts/performance/native-message-delivery.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')]));fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));clearTimeout(deadline);app.quit();
})().catch(e=>{console.error(e.stack);app.exit(1)})}));
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));require(path.join(repo,'desktop/main.js'));
