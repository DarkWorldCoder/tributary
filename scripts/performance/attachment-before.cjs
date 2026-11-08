'use strict';
// Reproduce the two preview lifetime failures in the frozen pre-change build.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),baseline=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-attachment-before-')),project=path.join(temp,'project'),imagesRoot=path.join(temp,'images');fs.mkdirSync(project);fs.mkdirSync(imagesRoot);fs.writeFileSync(path.join(project,'README.md'),'# Attachment lifetime fixture\n');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
try{
 const images=JSON.parse(execFileSync('/usr/bin/python3',['-c',`from PIL import Image
import random,os,sys,json
root=sys.argv[1];rows=[]
for i in range(4):
 w,h=[(1536,1536),(2048,512),(512,2048),(32,32)][i];rel='image-'+str(i)+'.png';Image.frombytes('RGB',(w,h),random.Random(1240+i).randbytes(w*h*3)).save(os.path.join(root,rel),compress_level=0);rows.append(dict(rel=rel,width=w,height=h))
print(json.dumps(rows))`,imagesRoot],{encoding:'utf8'}));
 let source=fs.readFileSync(path.join(__dirname,'native-attachment-images.cjs'),'utf8');
 const edits=[["require('./app-memory.cjs')",'require('+JSON.stringify(path.join(__dirname,'app-memory.cjs'))+')'],["(config.verify || config.textOnly) ? 'Reference 日本語 Ω\\n'.repeat(300000)","(config.verify || config.textOnly || config.reproduce) ? 'Reference 日本語 Ω\\n'.repeat(300000)"]];
 for(const [before,after]of edits){assert.equal(source.split(before).length,2);source=source.replace(before,after);}
 const marker="checks.push('Every attachment card decodes with a stable 48-by-48 display footprint.');";assert.equal(source.split(marker).length,2);
 source=source.replace(marker,marker+`\n    if(config.reproduce){
      const tail=hub.thread(thread.id).messages.find(m=>m.id==='user-999');tail.text+='\\n\\n'+Array.from({length:80},(_,i)=>'Plain tail paragraph '+i+'.').join('\\n\\n');hub.emit('message',{threadId:thread.id,message:tail});
      await reveal(originals[0].rel);await run(selector(originals[0].rel)+'.click();true');await until(()=>run(\"!!document.querySelector('[role=dialog] img')?.naturalWidth\"),'baseline original opened');
      const src=await run(\"document.querySelector('[role=dialog] img').src\");await run('document.querySelector('+JSON.stringify(viewport)+').scrollTop=100000;document.activeElement?.blur();true');
      await until(()=>run(\"document.querySelectorAll('[role=dialog] img').length===0\"),'baseline offscreen original removed');
      const dialog={imageElements:await run(\"document.querySelectorAll('[role=dialog] img').length\"),originalUrlLive:await run('window.__attachmentUrls.live.has('+JSON.stringify(src)+')')};assert.equal(dialog.imageElements,0);assert.equal(dialog.originalUrlLive,false);await closeDialog();
      await run(selector(text.name)+\".scrollIntoView({block:'center'});\"+selector(text.name)+'.click();true');await until(()=>run(\"document.querySelector('pre')?.textContent.startsWith('TEXT_PREVIEW_START')\"),'baseline full-read text displayed');await closeDialog();await delay(250);
      const closed=await state(),transfer=reads.filter(r=>r.id===text.id).at(-1);assert.ok(closed.textPreviewChars>0);assert.ok(transfer.base64Chars>256*1024);assert.equal(transfer.kind,'legacy');
      fs.writeFileSync(config.output,JSON.stringify({reproduced:true,dialog,closedTextPreviewChars:closed.textPreviewChars,textTransfer:transfer,versions:process.versions,scope:'Native correctness counterexample on pre-change c568e30, not a RAM benchmark. The full dialog loses its source when its card scrolls away; a closed text dialog retains its prefix in React state after transferring the full base64 body.'},null,2)+'\\n');clearTimeout(timeout);web.debugger.detach();app.quit();return;
    }
 `);
 const generated=path.join(temp,'native.cjs');fs.writeFileSync(generated,source);const config={reproduce:true,verify:false,optimized:false,repo:baseline,project,imagesRoot,images,profile:path.join(temp,'profile'),cycles:0,output:path.join(temp,'result.json'),failureOutput:output+'.failure.json'};const file=path.join(temp,'case.json');fs.writeFileSync(file,JSON.stringify(config));
 execFileSync('xvfb-run',['-a',path.join(repo,'node_modules/.bin/electron'),generated,'--ozone-platform=x11'],{cwd:repo,stdio:['ignore','inherit','inherit'],timeout:260000,env:{...process.env,TRIBUTARY_ATTACHMENT_CASE:file}});
 const result=JSON.parse(fs.readFileSync(config.output));result.source='c568e3076e72f6270f91a889ba48e5212797828e';result.harnessSha256={driver:hash(__filename),baseNative:hash(path.join(__dirname,'native-attachment-images.cjs')),generatedNative:hash(generated)};result.baselineSha256=Object.fromEntries(['core/attachments.js','ui/src/components/chat-attachments.tsx',...fs.readdirSync(path.join(baseline,'ui/dist/assets')).filter(f=>/\.(js|css)$/.test(f)).sort().map(f=>'ui/dist/assets/'+f)].map(f=>[f,hash(path.join(baseline,f))]));fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({reproduced:result.reproduced,dialog:result.dialog,closedTextPreviewChars:result.closedTextPreviewChars,fullTextBase64Chars:result.textTransfer.base64Chars}));
}catch(error){console.error(error.stack);process.exitCode=1;}finally{fs.rmSync(temp,{recursive:true,force:true});}
