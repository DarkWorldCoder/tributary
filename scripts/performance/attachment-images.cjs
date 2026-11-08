'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),baseline=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]),verify=process.argv.includes('verify'),resume=process.argv.includes('--resume');
const limit=process.env.TRIBUTARY_BENCH_CASE_LIMIT===undefined?Infinity:Number(process.env.TRIBUTARY_BENCH_CASE_LIMIT);assert.ok(limit===Infinity||Number.isInteger(limit)&&limit>0&&limit<=24);
if(fs.existsSync(output)&&!resume)throw Error('Report exists; choose another output or resume.');if(resume&&!fs.existsSync(output))throw Error('No report to resume.');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-attachment-matrix-')),project=path.join(temp,'project'),imagesRoot=path.join(temp,'images');fs.mkdirSync(project);fs.mkdirSync(imagesRoot);fs.writeFileSync(path.join(project,'README.md'),'# Attachment fixture\n');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources=['core/attachments.js','core/hub.js','desktop/main.js','desktop/preload.js','ui/src/components/chat-attachments.tsx','ui/src/components/markdown-image.tsx','ui/src/components/image-pixels.tsx','ui/src/hooks/use-image-resource.ts','ui/src/lib/image-resources.mjs','ui/src/lib/image-visibility.mjs','ui/src/lib/image-rendition.mjs'];
const fingerprint=root=>Object.fromEntries([...sources.filter(f=>fs.existsSync(path.join(root,f))),...fs.readdirSync(path.join(root,'ui/dist/assets')).filter(f=>/\.(js|css)$/.test(f)).sort().map(f=>'ui/dist/assets/'+f)].map(f=>[f,hash(path.join(root,f))]));
const fingerprints={baseline:fingerprint(baseline),optimized:fingerprint(repo)},harnessHashes=Object.fromEntries(['attachment-images.cjs','native-attachment-images.cjs','app-memory.cjs'].map(f=>[f,hash(path.join(__dirname,f))]));
try{
  const images=JSON.parse(execFileSync('/usr/bin/python3',['-c',`from PIL import Image,ImageDraw
import random,os,sys,json
root=sys.argv[1];verify=sys.argv[2]=='true';rows=[]
if verify:
 a=Image.new('RGB',(900,300),'red');d=ImageDraw.Draw(a);d.rectangle((300,0,599,299),fill='blue');d.rectangle((600,0,899,299),fill='lime');a.save(os.path.join(root,'image-0.png'),compress_level=0);rows.append(dict(rel='image-0.png',width=900,height=300,owned=True,centerPixel=[0,0,255,255]))
 a=Image.new('RGB',(300,900),'red');d=ImageDraw.Draw(a);d.rectangle((0,300,299,599),fill='lime');a.save(os.path.join(root,'image-1.png'),compress_level=0);rows.append(dict(rel='image-1.png',width=300,height=900,owned=True,centerPixel=[0,255,0,255]))
 a=Image.new('RGBA',(900,900),(12,100,240,127));a.save(os.path.join(root,'image-2.png'),compress_level=0);rows.append(dict(rel='image-2.png',width=900,height=900,owned=True,centerPixel=[12,100,240,127]))
 a=Image.new('RGB',(32,32),'red');a.save(os.path.join(root,'image-3.png'));rows.append(dict(rel='image-3.png',width=32,height=32,owned=False))
 a=Image.new('RGB',(900,700),'red');b=Image.new('RGB',(900,700),'lime')
 for name,fmt in [('animated.png','PNG'),('animated.gif','GIF'),('animated.webp','WEBP')]:
  a.save(os.path.join(root,name),format=fmt,save_all=True,append_images=[b],duration=180,loop=0,lossless=True);rows.append(dict(rel=name,width=900,height=700,animated=True,owned=False))
 exif=Image.Exif();exif[274]=6;a.save(os.path.join(root,'oriented.jpg'),exif=exif,quality=95);rows.append(dict(rel='oriented.jpg',width=700,height=900,owned=True,centerPixel=[254,0,0,255]))
 a=Image.new('I;16',(900,700),40000);a.save(os.path.join(root,'precision.png'));rows.append(dict(rel='precision.png',width=900,height=700,owned=False))
else:
 for i in range(16):
  w,h=[(1536,1536),(2048,512),(512,2048),(32,32)][i%4];data=random.Random(1240+i).randbytes(w*h*3);rel='image-'+str(i)+'.png';Image.frombytes('RGB',(w,h),data).save(os.path.join(root,rel),compress_level=0);rows.append(dict(rel=rel,width=w,height=h,owned=w>64 or h>64))
print(json.dumps(rows))`,imagesRoot,String(verify)],{encoding:'utf8'}));
  const imageHashes=Object.fromEntries(images.map(row=>[row.rel,hash(path.join(imagesRoot,row.rel))])),report=resume?JSON.parse(fs.readFileSync(output)):{complete:false,verify,fingerprints,harnessHashes,imageHashes,runs:[],scope:'Separate functional cases or three alternating fresh pairs per tiny/16-source ordinary/16-source diagnostic/repeated-text scenario. Images repeat only by metadata ID for duplicate sharing. Four total forward/reverse cycles and clear/settle; no pixel/hash/dialog checks in memory cohorts. No overlapping local tests/builds. Checkpoints are not continuous peaks, GC pauses, paint or model memory.'};
  for(const key of ['fingerprints','harnessHashes','imageHashes'])assert.deepEqual(report[key],({fingerprints,harnessHashes,imageHashes})[key]);assert.equal(report.verify,verify);
  const checkpoint=()=>{fs.writeFileSync(output+'.tmp',JSON.stringify(report,null,2)+'\n');fs.renameSync(output+'.tmp',output);};checkpoint();
  const scenarios=verify?[{}, {noObserver:true}, {noBitmap:true}]:[{count:1,diagnostic:false},{count:16,diagnostic:false},{count:16,diagnostic:true},{count:1,diagnostic:false,textOnly:true}];let executed=0;
  outer:for(const scenario of scenarios)for(let repeat=0;repeat<(verify?1:3);repeat++){
    let pair=report.runs.find(r=>r.repeat===repeat&&JSON.stringify(r.scenario)===JSON.stringify(scenario));if(!pair){pair={scenario,repeat};report.runs.push(pair);}
    for(const mode of verify?['optimized']:repeat%2?['optimized','baseline']:['baseline','optimized']){
      if(pair[mode])continue;if(executed>=limit)break outer;
      const profile=path.join(temp,'profile'),configuration=path.join(temp,'case.json'),result=path.join(temp,'result.json');fs.rmSync(profile,{recursive:true,force:true});
      const config={...scenario,verify,optimized:mode==='optimized',repo:mode==='baseline'?baseline:repo,project,imagesRoot,images:verify?images:scenario.count===1?[images[3]]:images,profile,cycles:3,output:result,failureOutput:output+'.failure.json',evidence:verify?output.replace(/\.json$/,`-${scenario.noObserver?'no-observer':scenario.noBitmap?'no-bitmap':'normal'}.png`):null};fs.writeFileSync(configuration,JSON.stringify(config));
      execFileSync('xvfb-run',['-a',path.join(repo,'node_modules/.bin/electron'),path.join(__dirname,'native-attachment-images.cjs'),'--ozone-platform=x11'],{cwd:repo,stdio:['ignore','inherit','inherit'],timeout:260000,env:{...process.env,TRIBUTARY_ATTACHMENT_CASE:configuration}});
      pair[mode]=JSON.parse(fs.readFileSync(result));executed++;checkpoint();assert.deepEqual(fingerprint(config.repo),fingerprints[mode]);console.log('Completed attachment',JSON.stringify(scenario),repeat,mode);
    }
  }
  for(const f of Object.keys(harnessHashes))assert.equal(hash(path.join(__dirname,f)),harnessHashes[f]);
  const completed=report.runs.reduce((n,r)=>n+['baseline','optimized'].filter(m=>r[m]).length,0);report.complete=completed===(verify?3:24);checkpoint();console.log(JSON.stringify({complete:report.complete,completed,executed}));
}catch(error){console.error(error.stack,{status:error.status,signal:error.signal});process.exitCode=1;}finally{fs.rmSync(temp,{recursive:true,force:true});}
