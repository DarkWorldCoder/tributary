'use strict';
// Separate longer-lifetime probe. Does not modify the frozen ordinary harness.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),baseline=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]),mode=process.argv[4];assert.ok(['baseline','optimized'].includes(mode));
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tributary-rendition-long-')),project=path.join(scratch,'project');fs.mkdirSync(project);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources=['core/hub.js','desktop/preload.js','ui/src/types.ts','ui/src/components/markdown-image.tsx','ui/src/lib/image-resources.mjs','ui/src/lib/image-rendition.mjs','ui/src/hooks/use-image-resource.ts'];
const fingerprint=root=>Object.fromEntries([...sources.filter(file=>fs.existsSync(path.join(root,file))),...fs.readdirSync(path.join(root,'ui/dist/assets')).filter(file=>file.endsWith('.js')).sort().map(file=>'ui/dist/assets/'+file)].map(file=>[file,hash(path.join(root,file))]));
const fingerprints={baseline:fingerprint(baseline),optimized:fingerprint(repo)};
try{
  const nativeFile=path.join(__dirname,'native-rendition-images.cjs');let native=fs.readFileSync(nativeFile,'utf8');
  for(const [before,after] of [["require('./app-memory.cjs')",'require('+JSON.stringify(path.join(__dirname,'app-memory.cjs'))+')'],['cycle<=3;','cycle<=19;']]){assert.equal(native.split(before).length,2,'One exact probe adaptation');native=native.replace(before,after);}
  const generated=path.join(scratch,'native.cjs');fs.writeFileSync(generated,native);
  const harnessHashes={driver:hash(__filename),originalNative:hash(nativeFile),generatedNative:hash(generated),sampler:hash(path.join(__dirname,'app-memory.cjs'))};
  const images=JSON.parse(execFileSync('/usr/bin/python3',['-c',`from PIL import Image
import random,sys,os,json
root=sys.argv[1];rows=[]
for i in range(16):
 w,h=[(1536,1536),(2048,512),(512,2048),(32,32)][i%4]
 data=random.Random(942+i).randbytes(w*h*3);rel='image-'+str(i)+'.png';Image.frombytes('RGB',(w,h),data).save(os.path.join(root,rel),compress_level=0);rows.append(dict(rel=rel,width=w,height=h,pixel=list(data[:3])+[255]))
print(json.dumps(rows))`,project],{encoding:'utf8'}));
  const imageHashes=Object.fromEntries(images.map(image=>[image.rel,hash(path.join(project,image.rel))]));
  const report=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):{complete:false,fingerprints,harnessHashes,imageHashes,scope:'One fresh baseline/optimized pair with twenty forward/reverse cycles, a bottom revisit and clear/settle. No forced GC, canvas pixel/hash checks or full viewer. Source app Linux/Xvfb; not a three-pair cohort or universal plateau/latency certification. Original native harness adapted only for loop count and absolute sampler import; generated SHA recorded.'};
  for(const key of ['fingerprints','harnessHashes','imageHashes'])assert.deepEqual(report[key],({fingerprints,harnessHashes,imageHashes})[key]);assert.ok(!report[mode],'Case already recorded');
  const config={surface:'chat',count:16,diagnostic:false,verify:false,repo:mode==='baseline'?baseline:repo,project,images,profile:path.join(scratch,'profile'),optimized:mode==='optimized',output:path.join(scratch,'result.json'),failureOutput:output+'.failure.json'};
  const file=path.join(scratch,'case.json');fs.writeFileSync(file,JSON.stringify(config));
  execFileSync('xvfb-run',['-a',path.join(repo,'node_modules/.bin/electron'),generated,'--ozone-platform=x11'],{cwd:repo,stdio:['ignore','inherit','inherit'],timeout:260000,env:{...process.env,TRIBUTARY_GALLERY_CASE:file}});
  assert.deepEqual(fingerprint(repo),fingerprints.optimized);assert.deepEqual(fingerprint(baseline),fingerprints.baseline);
  report[mode]=JSON.parse(fs.readFileSync(config.output));report.complete=!!report.baseline&&!!report.optimized;
  fs.writeFileSync(output+'.tmp',JSON.stringify(report,null,2)+'\n');fs.renameSync(output+'.tmp',output);console.log(JSON.stringify({complete:report.complete,mode}));
}catch(error){console.error(error.stack);process.exitCode=1;}finally{fs.rmSync(scratch,{recursive:true,force:true});}
