'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), baseline = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]), verify = process.argv[4] === 'verify';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-gallery-matrix-')), project = path.join(scratch, 'project'); fs.mkdirSync(project);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources = ['ui/src/components/markdown-image.tsx', 'ui/src/lib/image-resources.mjs', 'ui/src/hooks/use-image-resource.ts', 'ui/src/lib/image-visibility.mjs'];
const fingerprint = root => Object.fromEntries([...sources.filter(file => fs.existsSync(path.join(root, file))), ...fs.readdirSync(path.join(root, 'ui/dist/assets')).filter(file => file.endsWith('.js')).sort().map(file => 'ui/dist/assets/' + file)].map(file => [file, hash(path.join(root, file))]));
const fingerprints = { baseline: fingerprint(baseline), optimized: fingerprint(repo) }, harnessHashes = Object.fromEntries(['gallery-images.cjs', 'native-gallery-images.cjs', 'app-memory.cjs'].map(file => [file, hash(path.join(__dirname, file))]));
try {
  const images = JSON.parse(execFileSync('/usr/bin/python3', ['-c', `from PIL import Image
import random,sys,os,json
root=sys.argv[1];rows=[]
for i in range(16):
 w,h=[(1536,1536),(2048,512),(512,2048),(32,32)][i%4]
 data=random.Random(942+i).randbytes(w*h*3);rel='image-'+str(i)+'.png';Image.frombytes('RGB',(w,h),data).save(os.path.join(root,rel),compress_level=0)
 rows.append(dict(rel=rel,width=w,height=h,pixel=list(data[:3])+[255]))
print(json.dumps(rows))`, project], { encoding: 'utf8' }));
  const runs = [];
  const cases = verify ? [{ surface: 'chat', count: 16, diagnostic: false }, { surface: 'file', count: 16, diagnostic: false }, { surface: 'chat', count: 1, diagnostic: false, noObserver: true }] : [{ surface: 'chat', count: 1, diagnostic: false }, { surface: 'chat', count: 16, diagnostic: false }, { surface: 'chat', count: 16, diagnostic: true }];
  for (const scenario of cases) for (let repeat = 0; repeat < (verify ? 1 : 3); repeat++) {
    const pair = { scenario, repeat };
    for (const mode of verify ? ['optimized'] : repeat % 2 ? ['optimized', 'baseline'] : ['baseline', 'optimized']) {
      const root = mode === 'baseline' ? baseline : repo; assert.deepEqual(fingerprint(root), fingerprints[mode]);
      const file = path.join(scratch, 'result.json'), configuration = path.join(scratch, 'case.json');
      const config = { ...scenario, verify, repo: root, project, images: scenario.count === 1 ? [images[3]] : images, profile: path.join(scratch, 'profile'), optimized: mode === 'optimized', output: file, failureOutput: output + '.failure.json', evidence: verify ? output.replace(/\.json$/, `-${scenario.surface}-${scenario.count}-${scenario.noObserver ? 'fallback' : 'observer'}.png`) : null };
      fs.writeFileSync(configuration, JSON.stringify(config));
      execFileSync('xvfb-run', ['-a', path.join(repo, 'node_modules/.bin/electron'), path.join(__dirname, 'native-gallery-images.cjs'), '--ozone-platform=x11'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], timeout: 260000, env: { ...process.env, TRIBUTARY_GALLERY_CASE: configuration } });
      pair[mode] = JSON.parse(fs.readFileSync(file)); assert.deepEqual(fingerprint(root), fingerprints[mode]);
      fs.rmSync(config.profile, { recursive: true, force: true }); console.log('Completed gallery', scenario.count, scenario.diagnostic, scenario.surface, repeat, mode);
    }
    runs.push(pair);
  }
  assert.deepEqual(Object.fromEntries(Object.keys(harnessHashes).map(file => [file, hash(path.join(__dirname, file))])), harnessHashes);
  fs.writeFileSync(output, JSON.stringify({ fingerprints, harnessHashes, runs, scope: 'Fresh serial source-app pairs with identical files and dependencies. Three alternating pairs per memory scenario, or explicit native functional scenarios. Profiles are removed after child exit. Source and all built JS hashes must stay fixed. Checkpoints are not continuous peaks or GC pauses.' }, null, 2) + '\n');
} catch (error) { console.error(error.stack, { status: error.status, signal: error.signal }); process.exitCode = 1; }
finally { fs.rmSync(scratch, { recursive: true, force: true }); }
