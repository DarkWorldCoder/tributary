'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), baseline = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]), verify = process.argv[4] === 'verify', resume = process.argv.includes('--resume');
const limit = process.env.TRIBUTARY_BENCH_CASE_LIMIT === undefined ? Infinity : Number(process.env.TRIBUTARY_BENCH_CASE_LIMIT);
assert.ok(limit === Infinity || Number.isSafeInteger(limit) && limit > 0 && limit <= 18, 'Invalid case limit');
if (fs.existsSync(output) && !resume) throw Error('Report already exists. Choose a new output or pass --resume.');
if (resume && !fs.existsSync(output)) throw Error('No report to resume.');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-rendition-matrix-')), project = path.join(scratch, 'project'); fs.mkdirSync(project);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources = ['core/hub.js', 'desktop/preload.js', 'ui/src/types.ts', 'ui/src/components/markdown-image.tsx', 'ui/src/lib/image-resources.mjs', 'ui/src/hooks/use-image-resource.ts', 'ui/src/lib/image-visibility.mjs', 'ui/src/lib/image-rendition.mjs'];
const fingerprint = root => Object.fromEntries([...sources.filter(file => fs.existsSync(path.join(root, file))), ...fs.readdirSync(path.join(root, 'ui/dist/assets')).filter(file => file.endsWith('.js')).sort().map(file => 'ui/dist/assets/' + file)].map(file => [file, hash(path.join(root, file))]));
const fingerprints = { baseline: fingerprint(baseline), optimized: fingerprint(repo) }, harnessHashes = Object.fromEntries(['rendition-images.cjs', 'native-rendition-images.cjs', 'app-memory.cjs'].map(file => [file, hash(path.join(__dirname, file))]));
const cases = verify ? [{ surface: 'chat', count: 16, diagnostic: false }, { surface: 'file', count: 16, diagnostic: false }, { surface: 'chat', count: 4, diagnostic: false, noObserver: true }, { surface: 'chat', count: 4, diagnostic: false, noBitmap: true }] : [{ surface: 'chat', count: 1, diagnostic: false }, { surface: 'chat', count: 16, diagnostic: false }, { surface: 'chat', count: 16, diagnostic: true }];
try {
  const images = JSON.parse(execFileSync('/usr/bin/python3', ['-c', `from PIL import Image
import random,sys,os,json
root=sys.argv[1];rows=[]
for i in range(16):
 w,h=[(1536,1536),(2048,512),(512,2048),(32,32)][i%4]
 data=random.Random(942+i).randbytes(w*h*3);rel='image-'+str(i)+'.png';Image.frombytes('RGB',(w,h),data).save(os.path.join(root,rel),compress_level=0)
 rows.append(dict(rel=rel,width=w,height=h,pixel=list(data[:3])+[255]))
print(json.dumps(rows))`, project], { encoding: 'utf8' }));
  const imageHashes = Object.fromEntries(images.map(image => [image.rel, hash(path.join(project, image.rel))]));
  const report = resume ? JSON.parse(fs.readFileSync(output, 'utf8')) : { complete: false, verify, fingerprints, harnessHashes, imageHashes, runs: [], scope: 'Three alternating fresh pairs per memory scenario, or separate native functional cases. Memory excludes canvas pixel/hash and full-view checks. Four forward/reverse cycles, bottom revisit, clear/settle. Explicit diagnostic GC has a separate cohort. Per-case atomic checkpoints may resume only with identical mode, source, all built JS, harnesses and image bytes; only complete reports support cohort claims. No tests/builds overlap memory runs. Checkpoints are not continuous peaks, paint or GC pauses.' };
  assert.equal(report.verify, verify); assert.deepEqual(report.fingerprints, fingerprints); assert.deepEqual(report.harnessHashes, harnessHashes); assert.deepEqual(report.imageHashes, imageHashes);
  const checkpoint = () => { const temporary = output + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n'); fs.renameSync(temporary, output); };
  let executed = 0;
  checkpoint();
  casesLoop: for (const scenario of cases) for (let repeat = 0; repeat < (verify ? 1 : 3); repeat++) {
    let pair = report.runs.find(row => row.repeat === repeat && JSON.stringify(row.scenario) === JSON.stringify(scenario));
    if (!pair) { pair = { scenario, repeat }; report.runs.push(pair); }
    for (const mode of verify ? ['optimized'] : repeat % 2 ? ['optimized', 'baseline'] : ['baseline', 'optimized']) {
      if (pair[mode]) continue;
      if (executed >= limit) break casesLoop;
      const root = mode === 'baseline' ? baseline : repo; assert.deepEqual(fingerprint(root), fingerprints[mode]);
      for (const file of fs.readdirSync(project)) if (!images.some(image => image.rel === file)) fs.rmSync(path.join(project, file), { recursive: true, force: true });
      const file = path.join(scratch, 'result.json'), configuration = path.join(scratch, 'case.json');
      const config = { ...scenario, verify, repo: root, project, images: scenario.count === 1 ? [images[3]] : images.slice(0, scenario.count), profile: path.join(scratch, 'profile'), optimized: mode === 'optimized', output: file, failureOutput: output + '.failure.json', evidence: verify ? output.replace(/\.json$/, `-${scenario.surface}-${scenario.count}-${scenario.noBitmap ? 'no-bitmap' : scenario.noObserver ? 'no-observer' : 'observer'}.png`) : null };
      fs.writeFileSync(configuration, JSON.stringify(config));
      execFileSync('xvfb-run', ['-a', path.join(repo, 'node_modules/.bin/electron'), path.join(__dirname, 'native-rendition-images.cjs'), '--ozone-platform=x11'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], timeout: 260000, env: { ...process.env, TRIBUTARY_GALLERY_CASE: configuration } });
      const result = JSON.parse(fs.readFileSync(file)); assert.deepEqual(fingerprint(root), fingerprints[mode]);
      pair[mode] = result; executed++; checkpoint();
      fs.rmSync(config.profile, { recursive: true, force: true }); console.log('Completed rendition', scenario.count, scenario.diagnostic, scenario.surface, repeat, mode);
    }
  }
  assert.deepEqual(Object.fromEntries(Object.keys(harnessHashes).map(file => [file, hash(path.join(__dirname, file))])), harnessHashes);
  const completed = report.runs.reduce((total, pair) => total + ['baseline', 'optimized'].filter(mode => pair[mode]).length, 0);
  report.complete = completed === (verify ? 4 : 18); checkpoint();
  console.log(JSON.stringify({ complete: report.complete, completedCases: completed, executedCases: executed }));
} catch (error) { console.error(error.stack, { status: error.status, signal: error.signal }); process.exitCode = 1; }
finally { fs.rmSync(scratch, { recursive: true, force: true }); }
