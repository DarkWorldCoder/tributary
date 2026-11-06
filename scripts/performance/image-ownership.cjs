'use strict';
// Usage: node scripts/performance/image-ownership.cjs <built-baseline-root> <report.json> [verify]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), baseline = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
const verify = process.argv[4] === 'verify', scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tributary-image-matrix-'));
const project = path.join(scratch, 'project'); fs.mkdirSync(project);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = ['core/hub.js', 'desktop/main.js', 'ui/src/components/workspace-files.tsx', 'ui/src/components/image-preview.tsx', 'ui/src/lib/image-resources.mjs', 'ui/src/hooks/use-image-resource.ts'];
const fingerprint = root => Object.fromEntries([...files.filter(file => fs.existsSync(path.join(root, file))), ...fs.readdirSync(path.join(root, 'ui/dist/assets')).filter(name => name.endsWith('.js')).sort().map(name => 'ui/dist/assets/' + name)].map(file => [file, hash(path.join(root, file))]));
const fingerprints = { baseline: fingerprint(baseline), optimized: fingerprint(repo) };
const harnesses = ['scripts/performance/image-ownership.cjs', 'scripts/performance/native-image-ownership.cjs', 'scripts/performance/app-memory.cjs'];
const harnessHashes = Object.fromEntries(harnesses.map(file => [file, hash(path.join(repo, file))]));
try {
  const images = JSON.parse(execFileSync('/usr/bin/python3', ['-c', `from PIL import Image
import random,sys,os,json
root=sys.argv[1]; rows=[]
for i in range(6):
 data=random.Random(i+42).randbytes(1536*1536*3)
 image=Image.frombytes('RGB',(1536,1536),data)
 rel='image-'+str(i)+'.png'; image.save(os.path.join(root,rel),compress_level=0)
 rows.append(dict(rel=rel,width=1536,height=1536,pixel=list(data[:3])+[255],bytes=os.path.getsize(os.path.join(root,rel))))
data=bytearray(random.Random(42).randbytes(1536*1536*3));data[:3]=bytes([23,87,191])
Image.frombytes('RGB',(1536,1536),bytes(data)).save(os.path.join(root,'replacement.png'),compress_level=0)
print(json.dumps(rows))`, project], { encoding: 'utf8' }));
  fs.writeFileSync(path.join(project, 'main.ts'), 'export const retained = true;\n');
  const formats = verify ? JSON.parse(execFileSync(process.env.TRIBUTARY_IMAGE_PYTHON || '/usr/bin/python3', ['-c', `from PIL import Image
import sys,os,json
root=sys.argv[1];rows=[]
for ext in ['jpg','gif','webp','bmp','ico','avif']:
 image=Image.new('RGB',(32,32),(23,87,191));rel='format.'+ext
 image.save(os.path.join(root,rel))
 rows.append(dict(rel=rel,width=32,height=32))
open(os.path.join(root,'vector.svg'),'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#1757bf"/></svg>')
rows.append(dict(rel='vector.svg',width=32,height=32))
print(json.dumps(rows))`, project], { encoding: 'utf8' })) : [];
  if (verify) { fs.writeFileSync(path.join(project, 'too-large.png'), 'PNG fixture exceeds limit'); fs.truncateSync(path.join(project, 'too-large.png'), 16 * 1024 ** 2 + 1); }
  const runs = [];
  for (const diagnostic of verify ? [false] : [false, true]) for (let repeat = 0; repeat < (verify ? 1 : 3); repeat++) {
    const pair = { diagnostic, repeat };
    for (const mode of verify ? ['optimized'] : repeat % 2 ? ['optimized', 'baseline'] : ['baseline', 'optimized']) {
      const source = mode === 'baseline' ? baseline : repo;
      assert.deepEqual(fingerprint(source), fingerprints[mode], 'Source/built UI changed before run');
      const file = path.join(scratch, `${diagnostic}-${repeat}-${mode}.json`), config = path.join(scratch, 'case.json');
      fs.writeFileSync(config, JSON.stringify({ repo: source, project, images, formats, optimized: mode === 'optimized', diagnostic, verify, output: file, evidence: verify ? output.replace(/\.json$/, '.png') : null }));
      execFileSync('xvfb-run', ['-a', path.join(repo, 'node_modules/.bin/electron'), path.join(__dirname, 'native-image-ownership.cjs'), '--ozone-platform=x11'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'], timeout: 200000, env: { ...process.env, TRIBUTARY_IMAGE_CASE: config } });
      assert.deepEqual(fingerprint(source), fingerprints[mode], 'Source/built UI changed during run');
      pair[mode] = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log('Completed', diagnostic ? 'diagnostic' : 'unforced', repeat, mode);
    }
    runs.push(pair);
  }
  assert.deepEqual(Object.fromEntries(harnesses.map(file => [file, hash(path.join(repo, file))])), harnessHashes, 'Harness changed during matrix');
  fs.writeFileSync(output, JSON.stringify({ fingerprints, harnessHashes, images, runs, scope: 'Three alternating fresh app pairs per cohort; unforced and diagnostic-retained observations are separate fresh processes. Same fixtures/size/profile seed and dependency installation. Baseline and optimized compiled UIs differ only through source changes; hashes are recorded, never attributed solely to one module. PSS is accepted only for complete process-tree observations. No physical-device, model-memory or continuous peak/GC pause claim.' }, null, 2) + '\n');
  console.log('Report', output);
} catch (error) { console.error('Image matrix failed:', error.stack, { status: error.status, signal: error.signal, code: error.code }); if (error.stdout) console.error(String(error.stdout)); if (error.stderr) console.error(String(error.stderr)); process.exitCode = 1; }
finally { fs.rmSync(scratch, { recursive: true, force: true }); }
