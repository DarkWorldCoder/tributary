'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {createPathPrefix,pathPrefixFromText}=require('../core/path-prefix'),{readPathCommand}=require('../core/path-command'),{localHost}=require('../core/host'),{listFiles}=require('../core/git');
const {mkdtemp}=require('./helpers/tmp');
const fake=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();return child;};

test('path prefixes preserve UTF-8 across every byte boundary, names and duplicate order',()=>{
 const expected=['a b','two\nlines','quote\".ts','नमस्ते/😀.ts','a\rb'],payload=Buffer.from(['',...expected.slice(0,2),expected[0],...expected.slice(2),'extra'].join('\0')+'\0');
 for(let chunk=1;chunk<=payload.length;chunk++){const p=createPathPrefix(5);for(let i=0;i<payload.length;i+=chunk)p.write(payload.subarray(i,i+chunk));assert.deepEqual(p.finish(),expected);}
 const p=createPathPrefix(2,{stripDot:true});p.write(Buffer.from('./a\0./a\0./नयाँ\0unused\0'));assert.deepEqual(p.finish(),['a','नयाँ']);
 assert.deepEqual(pathPrefixFromText('a\0a\0b\0tail\0',2),['a','b']);
 assert.deepEqual(pathPrefixFromText('./a\n./b\n',1,{stripDot:true,separator:'\n'}),['a']);
});
test('fragmented records grow geometrically, enforce bounds and release on completion/disposal',()=>{
 const payload=Buffer.from('न'.repeat(20000));const p=createPathPrefix(2,{maxRecordBytes:payload.length});for(let i=0;i<payload.length;i++)p.write(payload.subarray(i,i+1));p.write(Buffer.from('\0'));assert.deepEqual(p.finish(),[payload.toString()]);p.write(Buffer.from('ignored\0'));assert.deepEqual(p.finish(),[]);
 for(const fragmented of [false,true]){const p=createPathPrefix(2,{maxRecordBytes:4});assert.throws(()=>{if(fragmented)p.write(Buffer.from('abc'));p.write(Buffer.from(fragmented?'de\0':'abcde\0'));},/record exceeds/);p.dispose();assert.deepEqual(p.finish(),[]);}
 const p2=createPathPrefix(0);p2.write(Buffer.alloc(100000));assert.deepEqual(p2.finish(),[]);
 const p3=createPathPrefix(2);p3.write(Buffer.from('complete\0unfinished'));assert.deepEqual(p3.finish({partial:false}),['complete']);
});
test('commands drain unused output and still observe a failure after the requested prefix',async()=>{
 const child=fake();let kills=0,done=false;const host={spawn:()=>child,kill:()=>kills++};
 const pending=readPathCommand(host,'git',[],{limit:1,timeout:1000,maxBytes:128}).then(r=>{done=true;return r;});
 child.stdout.write(Buffer.from('first\0unused\0'));await new Promise(setImmediate);assert.equal(done,false);child.stderr.write('late failure');child.emit('close',1);const r=await pending;
 assert.equal(r.ok,false);assert.equal(r.code,1);assert.deepEqual(r.files,['first']);assert.equal(kills,0);
 for(const stream of [child.stdout,child.stderr])for(const name of ['data','error'])assert.equal(stream.listenerCount(name),0);
 assert.equal(child.listenerCount('close'),0);assert.equal(child.listenerCount('error'),0);
});
test('stdout/stderr bounds, timeout and spawn/pipe failures settle once and drain safely',async()=>{
 for(const scenario of ['stdout','stderr','timeout','error','pipe']){
  const child=fake();let kills=0;const host={spawn:()=>child,kill:()=>{kills++;child.emit('close',null);}};
  const result=readPathCommand(host,'git',[],{limit:2,timeout:scenario==='timeout'?5:1000,maxBytes:8});
  if(scenario==='stdout'||scenario==='stderr')child[scenario].write(Buffer.alloc(9));else if(scenario==='error')child.emit('error',Error('cannot start'));else if(scenario==='pipe')child.stdout.emit('error',Error('lost pipe'));
  const r=await result;assert.equal(r.ok,false);assert.equal(kills,1);assert.ok(r.failure);assert.equal(child.stdout.listenerCount('data'),0);assert.equal(child.stderr.listenerCount('data'),0);assert.equal(child.listenerCount('error'),0);child.stdout.write('late');child.stderr.write('late');
 }
 const r=await readPathCommand({spawn(){throw Error('bad command');},kill(){}},'git',[],{limit:1});assert.equal(r.ok,false);
});
test('real local Git lists preserve the exact prefix and non-Git fallback respects its file limit',async()=>{
 const dir=mkdtemp('path-prefix');execFileSync('git',['init','-q'],{cwd:dir});
 for(const name of ['a.txt',process.platform==='win32'?'two lines.txt':'two\nlines.txt','नयाँ.ts','ignored.tmp'])fs.writeFileSync(path.join(dir,name),'');fs.writeFileSync(path.join(dir,'.gitignore'),'*.tmp\n');execFileSync('git',['add','.gitignore','a.txt'],{cwd:dir});
 const output=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:dir,encoding:'utf8'}),expected=[...new Set(output.split('\0').filter(Boolean))];
 for(const limit of [1,2,100])assert.deepEqual(await listFiles(dir,limit),expected.slice(0,limit));
 const plain=mkdtemp('plain-prefix');for(let i=0;i<30;i++)fs.writeFileSync(path.join(plain,`${i}.ts`),'');assert.equal((await listFiles(plain,7)).length,7);assert.deepEqual(await listFiles(plain,0),[]);
 await assert.rejects(listFiles(plain,-1),/file limit/);
 const custom={remote:false,path,exec:async()=>({code:0,stdout:'a\0a\0b\0c\0'})};assert.deepEqual(await listFiles(dir,2,{host:custom}),['a','b']);
});
test('Git index conflict stages deduplicate before applying the requested prefix',async()=>{
 const dir=mkdtemp('path-conflict');execFileSync('git',['init','-q'],{cwd:dir});
 const hash=execFileSync('git',['hash-object','-w','--stdin'],{cwd:dir,input:'x',encoding:'utf8'}).trim();
 execFileSync('git',['update-index','--index-info'],{cwd:dir,input:`100644 ${hash} 1\tconflict.txt\n100644 ${hash} 2\tconflict.txt\n100644 ${hash} 3\tconflict.txt\n100644 ${hash}\tnext.txt\n`});
 const raw=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:dir,encoding:'utf8'});
 assert.equal(raw.split('\0').filter(p=>p==='conflict.txt').length,3);
 assert.deepEqual(await listFiles(dir,2),['conflict.txt','next.txt']);
});
test('a real local command streams fragmented output and returns only its unique prefix',async()=>{
 const r=await readPathCommand(localHost,process.execPath,['-e',"process.stdout.write(Buffer.from('a\\0a\\0नयाँ\\0unused\\0'))"],{limit:2,timeout:3000});assert.equal(r.ok,true);assert.deepEqual(r.files,['a','नयाँ']);assert.ok(r.stdoutBytes>0);
});
test('a nonzero command after a valid prefix uses the directory fallback instead of partial Git results',async()=>{
 const dir=mkdtemp('late-git-failure');fs.writeFileSync(path.join(dir,'actual.ts'),'');
 const host={...localHost,spawn(){return localHost.spawn(process.execPath,['-e',"process.stdout.write('wrong.ts\\0');setTimeout(()=>process.exit(1),20)"]);}};
 assert.deepEqual(await listFiles(dir,1,{host}),['actual.ts']);
});
