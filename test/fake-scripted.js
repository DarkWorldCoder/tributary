#!/usr/bin/env node
const fs=require('fs');const [stateFile, id]=process.argv.slice(2);
let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{
  const st=JSON.parse(fs.readFileSync(stateFile,'utf8')); const reply=(st[id]||[]).shift()||'ok'; fs.writeFileSync(stateFile, JSON.stringify(st));
  fs.appendFileSync(stateFile+'.prompts', JSON.stringify({id, prompt:s})+'\n');
  const m=/WRITE:(\S+)/.exec(reply); if(m) fs.appendFileSync(m[1], id+'\n');
  const out=o=>process.stdout.write(JSON.stringify(o)+'\n');
  out({type:'thread.started',thread_id:id+'-sess'}); out({type:'item.completed',item:{id:'i',type:'agent_message',text:reply}}); out({type:'turn.completed',usage:{}});
});